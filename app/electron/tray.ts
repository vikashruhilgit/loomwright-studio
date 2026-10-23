// The menu-bar tray (item 17): a dot for the kernel's state, the pending
// approval count beside it, and a menu with the status line, Open, Pause all
// (or Unpause), Kill switch… (confirmed), Resume and Quit.
//
// The lifecycle the owner chose: closing the window leaves the tray running,
// Quit is in the tray, and there is no autostart. Quit only quits the app: the
// kernel is a separate daemon and keeps running (D11), so nothing here sends a
// kernel call on Quit or `before-quit`.
//
// What it shows is only what the kernel said. State is re-read (`GET /status`,
// `GET /approvals`) on start, after each action's answer, on each frame of the
// tray's own feed, and on a slow poll while that feed is down. An action's
// answer never sets the state (no optimistic flip): the dot reads `paused`
// only after a `GET /status` says `paused: true`.
//
// Every answer is an untrusted shape: a body that fails its check is a failed
// read (the state stays as last read, the reason is logged, nothing throws).
import { Menu, Tray, app, dialog, nativeImage } from "electron";
import type { MenuItemConstructorOptions, NativeImage } from "electron";
import type { ApiResult, FeedRelayFrame, StatusBody } from "../src/api/contract";
import { MENUBAR_DOTS, MENUBAR_WORDS, TRAY_SEAM_ENV, TRAY_SEAM_GLOBAL, menubarState } from "../src/screens/menubar/state";
import type { MenubarDotState, TrayItemId, TrayModel, TrayModelItem, TrayModelState, TraySeam } from "../src/screens/menubar/state";
import type { FeedHandle, KernelConnection } from "./kernel-connection";

export interface TrayDeps {
  /** The main process's kernel connection (the tray's calls go through it, like every call). */
  readonly kernel: KernelConnection;
  /** Show (or create) the main window. */
  readonly showWindow: () => void;
}

/** How often the tray re-reads, and retries its feed, while the feed is down. */
export const TRAY_POLL_MS = 10_000;

/** The kill confirm's buttons: Cancel is the default and the cancel answer. */
export const KILL_CONFIRM_BUTTONS = Object.freeze(["Cancel", "Engage kill switch"] as const);
const KILL_CONFIRM_CANCEL = 0;
const KILL_CONFIRM_ENGAGE = 1;

const STATE_WORD_UNKNOWN = "kernel not reached";

// ---- shape checks (every kernel answer is untrusted) ---------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The parts of a `GET /status` body the tray reads, checked before use. */
function isStatusBody(body: unknown): body is StatusBody {
  if (!isRecord(body)) return false;
  const kill = body.kill_switch;
  if (!isRecord(kill) || typeof kill.engaged !== "boolean") return false;
  if (body.paused !== undefined && typeof body.paused !== "boolean") return false;
  if (!Array.isArray(body.sessions) || !Array.isArray(body.cap_state)) return false;
  return body.cap_state.every((account: unknown) => isRecord(account) && Array.isArray(account.limits) && account.limits.every((limit: unknown) => isRecord(limit)));
}

/** The pending count in a `GET /approvals` body, or `undefined` when the body is not that shape. */
function pendingCount(body: unknown): number | undefined {
  if (!isRecord(body) || !Array.isArray(body.approvals)) return undefined;
  return body.approvals.filter((a: unknown) => isRecord(a) && a.status === "pending").length;
}

/** Why a call failed, in words safe to log: a status or a connection reason, never a body. */
function failure(result: ApiResult<unknown>): string {
  if ("connection" in result) return result.connection.state === "unreachable" ? `unreachable (${result.connection.reason})` : result.connection.state;
  return `HTTP ${result.status}`;
}

// ---- the icon --------------------------------------------------------------------------

/** The dot's colours (light-theme tokens in `src/styles/tokens.css`), as RGB. */
const DOT_RGB: Readonly<Record<MenubarDotState, readonly [number, number, number]>> = {
  idle: [0x66, 0x66, 0x7c],
  working: [0x46, 0x50, 0xc8],
  waiting: [0x99, 0x57, 0x0a],
  paused: [0x6d, 0x5a, 0xa8],
  failed: [0xb8, 0x32, 0x2a],
};

const ICON_POINTS = 16;
const ICON_SCALE = 2;

/**
 * A dot drawn in code (no asset files), as a premultiplied BGRA bitmap (the
 * byte order `NativeImage.toBitmap` uses). `idle` is a ring, `paused` carries
 * a bar, as `StatusDot` draws them.
 */
export function dotBitmap(dot: MenubarDotState): { readonly buffer: Buffer; readonly size: number } {
  const size = ICON_POINTS * ICON_SCALE;
  const buffer = Buffer.alloc(size * size * 4);
  const [r, g, b] = DOT_RGB[dot];
  const centre = size / 2;
  const radius = 7 * ICON_SCALE;
  const ring = 2 * ICON_SCALE;
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      let cover = clamp(radius + 0.5 - d);
      if (dot === "idle") cover *= clamp(d - (radius - ring) + 0.5);
      if (dot === "paused" && Math.abs(x + 0.5 - centre) < 1.5 * ICON_SCALE && Math.abs(y + 0.5 - centre) < 3.5 * ICON_SCALE) cover = 0;
      const a = Math.round(cover * 255);
      const at = (y * size + x) * 4;
      buffer[at] = Math.round((b * a) / 255);
      buffer[at + 1] = Math.round((g * a) / 255);
      buffer[at + 2] = Math.round((r * a) / 255);
      buffer[at + 3] = a;
    }
  }
  return { buffer, size };
}

function dotImage(dot: MenubarDotState): NativeImage {
  const { buffer, size } = dotBitmap(dot);
  return nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: ICON_SCALE });
}

// ---- the tray --------------------------------------------------------------------------

/** Held so the native tray is never garbage-collected (which would remove it). */
let tray: Tray | undefined;

/** Creates the tray and starts reading the kernel. Never throws: a tray the platform cannot show still keeps its model. */
export function createTray(deps: TrayDeps): void {
  const { kernel } = deps;
  // Reasons only: never a token, never a response body. A repeated reason is logged once.
  const lastLogged = new Map<string, string>();
  const log = (key: string, line: string): void => {
    if (lastLogged.get(key) === line) return;
    lastLogged.set(key, line);
    console.warn(`loomwright-studio: tray: ${line}`);
  };
  const logged = (key: string): void => void lastLogged.delete(key);

  let status: StatusBody | undefined;
  let pending = 0;
  const busy = new Set<TrayItemId>();

  // ---- the model, and the native tray that renders it ----

  const model = (): TrayModel => {
    const state: TrayModelState = status === undefined ? "unknown" : menubarState(status, pending);
    const word = state === "unknown" ? STATE_WORD_UNKNOWN : MENUBAR_WORDS[state];
    const paused = status?.paused === true;
    const killed = status?.kill_switch.engaged === true;
    const items: TrayModelItem[] = [
      { id: "status", label: `${word} · ${pending} waiting on you`, enabled: false },
      { id: "open", label: "Open Loomwright Studio", enabled: true },
      paused ? { id: "unpause", label: "Unpause", enabled: true } : { id: "pause-all", label: "Pause all", enabled: true },
      { id: "kill-switch", label: "Kill switch…", enabled: !killed },
      { id: "resume", label: "Resume", enabled: killed || paused },
      { id: "quit", label: "Quit Loomwright Studio", enabled: true },
    ];
    return { state, count: pending, title: pending > 0 ? String(pending) : "", tooltip: `Loomwright Studio: ${word}`, items };
  };

  let rendered = "";
  const render = (): void => {
    const current = model();
    const key = JSON.stringify(current);
    if (key === rendered || tray === undefined) return;
    rendered = key;
    try {
      const dot: MenubarDotState = current.state === "unknown" ? "idle" : MENUBAR_DOTS[current.state];
      tray.setImage(dotImage(dot));
      tray.setTitle(current.title);
      tray.setToolTip(current.tooltip);
      const template: MenuItemConstructorOptions[] = [];
      for (const item of current.items) {
        template.push({ id: item.id, label: item.label, enabled: item.enabled, click: () => void press(item.id) });
        if (item.id === "status" || item.id === "resume") template.push({ type: "separator" });
      }
      tray.setContextMenu(Menu.buildFromTemplate(template));
    } catch (err) {
      log("render", `could not update the menu-bar icon (${err instanceof Error ? err.name : "error"})`);
    }
  };

  // ---- reads (single flight, coalesced) ----

  const read = async <T>(path: "/status" | "/approvals", check: (body: unknown) => T | undefined): Promise<T | undefined> => {
    let result: ApiResult<unknown>;
    try {
      result = await kernel.request({ method: "GET", path });
    } catch (err) {
      log(path, `GET ${path} failed (${err instanceof Error ? err.name : "error"})`);
      return undefined;
    }
    if (!result.ok) {
      log(path, `GET ${path} failed: ${failure(result)}`);
      return undefined;
    }
    const value = check(result.body);
    if (value === undefined) {
      log(path, `GET ${path} answered a body of the wrong shape`);
      return undefined;
    }
    logged(path);
    return value;
  };

  const readOnce = async (): Promise<void> => {
    const [nextStatus, nextPending] = await Promise.all([
      read("/status", (body) => (isStatusBody(body) ? body : undefined)),
      read("/approvals", pendingCount),
    ]);
    if (nextStatus !== undefined) status = nextStatus;
    if (nextPending !== undefined) pending = nextPending;
    render();
  };

  let reading: Promise<void> | undefined;
  let queued: Promise<void> | undefined;
  /** Settles after a read that started after this call. At most one read runs, and one more waits. */
  const refresh = (): Promise<void> => {
    if (reading === undefined) {
      reading = readOnce()
        .catch(() => undefined)
        .finally(() => {
          reading = undefined;
        });
      return reading;
    }
    queued ??= reading.then(() => {
      queued = undefined;
      return refresh();
    });
    return queued;
  };

  // ---- the feed (single flight: never a second `openFeed` while one is pending) ----

  let feed: FeedHandle | undefined;
  let feedOpening = false;
  let feedGeneration = 0;
  let cursor = 0;

  const openFeed = (): void => {
    if (feedOpening || feed !== undefined) return;
    feedOpening = true;
    feedGeneration += 1;
    const mine = feedGeneration;
    const onFrame = (frame: FeedRelayFrame): void => {
      if (mine !== feedGeneration) return;
      if (frame.type === "closed") {
        feed = undefined;
        feedGeneration += 1;
        log("feed", `feed closed (${frame.code})`);
      } else if (frame.type === "event" && Number.isSafeInteger(frame.id) && frame.id > cursor) {
        cursor = frame.id;
      } else if (frame.type === "heartbeat" && Number.isSafeInteger(frame.latest_id) && frame.latest_id > cursor) {
        cursor = frame.latest_id;
      }
      void refresh();
    };
    let opening: ReturnType<KernelConnection["openFeed"]>;
    try {
      opening = kernel.openFeed(cursor, onFrame);
    } catch (err) {
      feedOpening = false;
      log("feed", `could not open the feed (${err instanceof Error ? err.name : "error"})`);
      return;
    }
    opening.then(
      (opened) => {
        feedOpening = false;
        if (mine !== feedGeneration) {
          // Closed while opening: the handle is not kept.
          opened.handle?.close();
          return;
        }
        if (opened.handle === undefined) {
          log("feed", `feed not open: ${opened.state.state === "unreachable" ? `unreachable (${opened.state.reason})` : opened.state.state}`);
          return;
        }
        logged("feed");
        feed = opened.handle;
      },
      (err: unknown) => {
        feedOpening = false;
        log("feed", `could not open the feed (${err instanceof Error ? err.name : "error"})`);
      },
    );
  };

  const poll = setInterval(() => {
    if (feed !== undefined) return;
    void refresh();
    openFeed();
  }, TRAY_POLL_MS);
  poll.unref();

  // ---- actions ----

  /** An action's call. Its answer only triggers a re-read: it never sets the state. */
  const act = async (path: "/pause" | "/unpause" | "/stop-all" | "/resume"): Promise<void> => {
    let result: ApiResult<unknown> | undefined;
    try {
      result = await kernel.request({ method: "POST", path });
    } catch (err) {
      log(`POST ${path}`, `POST ${path} failed (${err instanceof Error ? err.name : "error"})`);
    }
    if (result !== undefined && !result.ok) log(`POST ${path}`, `POST ${path} failed: ${failure(result)}`);
    else if (result !== undefined) logged(`POST ${path}`);
    await refresh();
  };

  const killSwitch = async (): Promise<void> => {
    let response: number;
    try {
      ({ response } = await dialog.showMessageBox({
        type: "warning",
        message: "Engage the kill switch?",
        detail: "Every running session is stopped and no new work starts until you choose Resume. The kernel keeps running.",
        buttons: [...KILL_CONFIRM_BUTTONS],
        defaultId: KILL_CONFIRM_CANCEL,
        cancelId: KILL_CONFIRM_CANCEL,
        noLink: true,
      }));
    } catch (err) {
      log("kill-switch", `the kill confirm could not open (${err instanceof Error ? err.name : "error"})`);
      return;
    }
    if (response !== KILL_CONFIRM_ENGAGE) return;
    await act("/stop-all");
  };

  const run = (id: TrayItemId): Promise<void> => {
    switch (id) {
      case "open":
        deps.showWindow();
        return Promise.resolve();
      case "quit":
        // The app only: the kernel keeps running (D11).
        app.quit();
        return Promise.resolve();
      case "pause-all":
        return act("/pause");
      case "unpause":
        return act("/unpause");
      case "resume":
        return act("/resume");
      case "kill-switch":
        return killSwitch();
      case "status":
        return Promise.resolve();
    }
  };

  /** Presses `id` if the current menu has it enabled. The same item pressed again while its call runs does nothing. */
  const press = async (id: string): Promise<void> => {
    const item = model().items.find((i) => i.id === id);
    if (item === undefined || !item.enabled || busy.has(item.id)) return;
    busy.add(item.id);
    try {
      await run(item.id);
    } catch (err) {
      log(item.id, `${item.id} failed (${err instanceof Error ? err.name : "error"})`);
    } finally {
      busy.delete(item.id);
    }
  };

  // ---- start ----

  try {
    tray = new Tray(dotImage("idle"));
  } catch (err) {
    // A platform that cannot show a tray (a headless CI) keeps the model and the seam.
    tray = undefined;
    log("tray", `the menu-bar icon is not available (${err instanceof Error ? err.name : "error"})`);
  }
  render();

  if (!app.isPackaged && process.env[TRAY_SEAM_ENV] === "1") {
    const seam: TraySeam = { model, click: press };
    (globalThis as Record<string, unknown>)[TRAY_SEAM_GLOBAL] = seam;
  }

  openFeed();
  void refresh();
}
