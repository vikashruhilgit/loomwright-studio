// The menu-bar tray (item 17): a glyph for the kernel's state (the app icon's
// Möbius ribbon, drawn by `tray-glyph.ts`), the pending approval count beside
// it, and a menu with the status line, Open, Pause all (or Unpause), Kill
// switch… (confirmed), Resume and Quit.
//
// The lifecycle the owner chose: closing the window leaves the tray running,
// Quit is in the tray, and there is no autostart. Quit only quits the app: the
// kernel is a separate daemon and keeps running (D11), so nothing here sends a
// kernel call on Quit or `before-quit`.
//
// What it shows is only what the kernel said. State is re-read (`GET /status`,
// `GET /approvals`) on start, after each action's answer, on each frame of the
// tray's own feed, and on a slow poll while that feed is down. An action's
// answer never sets the state (no optimistic flip): the glyph reads `paused`
// only after a `GET /status` says `paused: true`.
//
// Every answer is an untrusted shape: a body that fails its check is a failed
// read (the state stays as last read, the reason is logged, nothing throws).
// While the latest read has failed, the status line and the tooltip say so
// ("kernel not reached (last: …)") until a read answers again: a last-read
// state is never shown as if it were live.
//
// Feed frames are throttled: at most one re-read per `TRAY_FEED_THROTTLE_MS`
// (the first frame reads at once, later ones fold into one trailing read), and
// a heartbeat that does not advance the cursor reads nothing.
import { Menu, Tray, app, dialog, nativeImage, systemPreferences } from "electron";
import type { MenuItemConstructorOptions, NativeImage } from "electron";
import type { ApiResult, FeedRelayFrame, StatusBody } from "../src/api/contract";
import { MENUBAR_DOTS, MENUBAR_WORDS, TRAY_SEAM_ENV, TRAY_SEAM_GLOBAL, menubarState } from "../src/screens/menubar/state";
import type { MenubarDotState, TrayItemId, TrayModel, TrayModelItem, TrayModelState, TraySeam } from "../src/screens/menubar/state";
import type { FeedHandle, KernelConnection } from "./kernel-connection";
import { GLYPH_FRAME_MS, GLYPH_SCALE, glyphBitmap, isAnimated } from "./tray-glyph";
import type { GlyphState } from "./tray-glyph";

export interface TrayDeps {
  /** The main process's kernel connection (the tray's calls go through it, like every call). */
  readonly kernel: KernelConnection;
  /** Show (or create) the main window. */
  readonly showWindow: () => void;
}

/** How often the tray re-reads, and retries its feed, while the feed is down. */
export const TRAY_POLL_MS = 10_000;

/** How often a moving glyph held still by reduce motion re-checks the setting. */
export const TRAY_MOTION_RECHECK_MS = 1000;

/** At most one re-read per this many ms from feed frames (the window store's `REFETCH_THROTTLE_MS`). */
export const TRAY_FEED_THROTTLE_MS = 250;

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

/** The glyph each dot state draws as. The kill switch is a stop, so `failed` is the cut ribbon. */
const GLYPHS: Readonly<Record<MenubarDotState, GlyphState>> = {
  idle: "idle",
  working: "working",
  waiting: "waiting",
  paused: "paused",
  failed: "killed",
};

/** The glyph as a template image: black with alpha, which macOS recolours for the bar and the highlight. */
function glyphImage(state: GlyphState, timeMs: number, still: boolean): NativeImage {
  const { buffer, size } = glyphBitmap(state, timeMs, still);
  const image = nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: GLYPH_SCALE });
  image.setTemplateImage(true);
  return image;
}

/** The system's reduce-motion setting, read each frame so a change applies without a restart. */
function reducedMotion(): boolean {
  try {
    return systemPreferences.getAnimationSettings().prefersReducedMotion;
  } catch {
    return false;
  }
}

// ---- the tray --------------------------------------------------------------------------

/** Held so the native tray is never garbage-collected (which would remove it). */
let tray: Tray | undefined;

/**
 * Creates the tray and starts reading the kernel. Never throws: a tray the platform cannot show still keeps its model.
 * Returns a stop that ends its timers and feed (the app keeps its tray for its lifetime; a test stops each one, or a
 * moving glyph's frame loop outlives it and draws onto the next test's tray).
 */
export function createTray(deps: TrayDeps): () => void {
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
  /** The latest `/status` or `/approvals` read failed: what is shown is the last state read, not a live one. */
  let staleRead = false;
  const busy = new Set<TrayItemId>();

  // ---- the model, and the native tray that renders it ----

  const model = (): TrayModel => {
    const state: TrayModelState = status === undefined ? "unknown" : menubarState(status, pending);
    const word = state === "unknown" ? STATE_WORD_UNKNOWN : staleRead ? `${STATE_WORD_UNKNOWN} (last: ${MENUBAR_WORDS[state]})` : MENUBAR_WORDS[state];
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
    return { state, stale: state !== "unknown" && staleRead, count: pending, title: pending > 0 ? String(pending) : "", tooltip: `Loomwright Studio: ${word}`, items };
  };

  // ---- the glyph: drawn once per change, or every frame while it moves ----

  let glyph: GlyphState | undefined;
  let animation: ReturnType<typeof setTimeout> | undefined;
  let animationStart = 0;
  /** The frame on screen is the reduced-motion one: nothing to redraw until the setting changes. */
  let drawnStill = false;
  const drawGlyph = (): void => {
    if (tray === undefined || glyph === undefined) return;
    const still = !isAnimated(glyph) || reducedMotion();
    if (still && drawnStill) return;
    drawnStill = still;
    try {
      tray.setImage(glyphImage(glyph, performance.now() - animationStart, still));
    } catch (err) {
      log("render", `could not update the menu-bar icon (${err instanceof Error ? err.name : "error"})`);
    }
  };
  const showGlyph = (next: GlyphState): void => {
    if (next === glyph) return;
    glyph = next;
    drawnStill = false;
    animationStart = performance.now();
    if (animation !== undefined) clearTimeout(animation);
    animation = undefined;
    drawGlyph();
    if (!isAnimated(next)) return;
    // Every frame while it moves; under reduce motion only a slow re-check, so a
    // held still frame costs one wakeup a second, not fifteen.
    const tick = (): void => {
      animation = setTimeout(() => {
        drawGlyph();
        tick();
      }, drawnStill ? TRAY_MOTION_RECHECK_MS : GLYPH_FRAME_MS);
      animation.unref();
    };
    tick();
  };

  let stopped = false;
  let rendered = "";
  const render = (): void => {
    if (stopped) return;
    const current = model();
    const key = JSON.stringify(current);
    if (key === rendered || tray === undefined) return;
    rendered = key;
    try {
      showGlyph(GLYPHS[current.state === "unknown" ? "idle" : MENUBAR_DOTS[current.state]]);
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
    staleRead = nextStatus === undefined || nextPending === undefined;
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

  // A throttle for feed-driven reads: never more than one per window, and never a lost last frame. The window is a
  // timer started with each read, never arithmetic on `Date.now()`: that is the wall clock, and a backward step (a
  // manual change, an NTP step after wake) would hold every read for the size of the jump (the store's `pump` does
  // the same, `src/store/store.ts`).
  let feedWindow: ReturnType<typeof setTimeout> | undefined;
  /** A frame arrived inside the open window: one read is owed when it closes. */
  let feedOwed = false;
  const readAndOpenWindow = (): void => {
    feedOwed = false;
    feedWindow = setTimeout(() => {
      feedWindow = undefined;
      if (feedOwed) readAndOpenWindow();
    }, TRAY_FEED_THROTTLE_MS);
    feedWindow.unref();
    void refresh();
  };
  const refreshFromFeed = (): void => {
    if (feedWindow !== undefined) {
      feedOwed = true;
      return;
    }
    readAndOpenWindow();
  };

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
      } else if (frame.type === "heartbeat") {
        // A heartbeat that does not advance the cursor says nothing changed: no read.
        if (!Number.isSafeInteger(frame.latest_id) || frame.latest_id <= cursor) return;
        cursor = frame.latest_id;
      }
      refreshFromFeed();
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
    tray = new Tray(glyphImage("idle", 0, true));
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

  return () => {
    // A read still in flight renders nothing after this, so no new frame loop starts.
    stopped = true;
    if (animation !== undefined) clearTimeout(animation);
    animation = undefined;
    if (feedWindow !== undefined) clearTimeout(feedWindow);
    feedWindow = undefined;
    clearInterval(poll);
    // A feed still opening closes its handle when it lands; an open one is closed now.
    feedGeneration += 1;
    feed?.close();
    feed = undefined;
  };
}
