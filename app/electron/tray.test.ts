// The tray pin (item 17, AC1, AC2, AC3, AC5): the tray shows only what the
// kernel said (a pause shows only after `GET /status` says so), the kill
// switch sends nothing unless confirmed, Quit never calls the kernel, a
// malformed answer is a failed read (never a throw), its feed is single
// flight, and a packaged app never exposes the e2e seam.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { ApiResult, FeedRelayFrame } from "../src/api/contract";
import { TRAY_SEAM_ENV, TRAY_SEAM_GLOBAL } from "../src/screens/menubar/state";
import type { TrayModel, TraySeam } from "../src/screens/menubar/state";
import type { KernelConnection } from "./kernel-connection";

interface TemplateItem {
  readonly id?: string;
  readonly label?: string;
  readonly enabled?: boolean;
  readonly type?: string;
  readonly click?: () => void;
}

const electron = vi.hoisted(() => {
  const trays: { image: unknown; title?: string; tooltip?: string; tooltips: string[]; menu?: { template: TemplateItem[] } }[] = [];
  return {
    trays,
    trayThrows: false,
    app: { isPackaged: false, quit: (): void => undefined },
    dialog: { showMessageBox: async (_options: Record<string, unknown>): Promise<{ response: number }> => ({ response: 0 }) },
  };
});

vi.mock("electron", () => {
  class Tray {
    readonly record: (typeof electron.trays)[number];
    constructor(image: unknown) {
      if (electron.trayThrows) throw new Error("no tray here");
      this.record = { image, tooltips: [] };
      electron.trays.push(this.record);
    }
    setImage(image: unknown): void {
      this.record.image = image;
    }
    setTitle(title: string): void {
      this.record.title = title;
    }
    setToolTip(tooltip: string): void {
      this.record.tooltip = tooltip;
      this.record.tooltips.push(tooltip);
    }
    setContextMenu(menu: { template: TemplateItem[] }): void {
      this.record.menu = menu;
    }
  }
  return {
    Tray,
    Menu: { buildFromTemplate: (template: TemplateItem[]) => ({ template }) },
    nativeImage: { createFromBitmap: (buffer: Buffer, options: unknown) => ({ buffer, options }) },
    app: electron.app,
    dialog: electron.dialog,
  };
});

const { createTray, dotBitmap, KILL_CONFIRM_BUTTONS, TRAY_FEED_THROTTLE_MS, TRAY_POLL_MS } = await import("./tray");

// ---- a fake kernel ------------------------------------------------------------------

interface World {
  paused: boolean;
  engaged: boolean;
  sessions: number;
  pending: number;
}

type Answer = (method: string, path: string) => ApiResult<unknown> | undefined;

function restingStatus(world: World): unknown {
  return {
    kernel: { version: "0.0.0", uptime_s: 1, pid: 1 },
    kill_switch: { engaged: world.engaged, since: null },
    paused: world.paused,
    auth: [],
    sessions: Array.from({ length: world.sessions }, (_, i) => ({ id: i + 1 })),
    kill_unconfirmed: [],
    orphaned: [],
    queue: { pending: 0, events: [] },
    wakeups: { pending: 0, items: [] },
    tokens_today: { day: "2026-10-23", agents: [] },
    cap_state: [],
  };
}

/**
 * A kernel over `world`. `/pause`, `/unpause`, `/stop-all` and `/resume` change
 * the world only when `obeys` (a kernel that answers but has not changed yet).
 * `override` answers first when it returns a result.
 */
function fakeKernel(init: Partial<World> = {}, opts: { obeys?: boolean; override?: Answer } = {}) {
  const world: World = { paused: false, engaged: false, sessions: 0, pending: 0, ...init };
  const calls: string[] = [];
  const feeds: { after: number; onFrame: (f: FeedRelayFrame) => void; open: (handle?: boolean) => void; closed: boolean }[] = [];
  const obeys = opts.obeys ?? true;
  const answer = (method: string, path: string): ApiResult<unknown> => {
    const over = opts.override?.(method, path);
    if (over !== undefined) return over;
    if (method === "GET" && path === "/status") return { ok: true, status: 200, body: restingStatus(world) };
    if (method === "GET" && path === "/approvals") {
      return {
        ok: true,
        status: 200,
        body: { approvals: Array.from({ length: world.pending }, (_, i) => ({ id: i + 1, status: "pending" })) },
      };
    }
    if (method === "POST" && obeys) {
      if (path === "/pause") world.paused = true;
      if (path === "/unpause") world.paused = false;
      if (path === "/stop-all") world.engaged = true;
      if (path === "/resume") {
        world.engaged = false;
        world.paused = false;
      }
    }
    if (method === "POST") return { ok: true, status: 200, body: { paused: world.paused } };
    return { ok: false, status: 404, body: { error: "not_found" } };
  };
  const kernel: KernelConnection = {
    connection: async () => ({ state: "connected", port: 1 }),
    request: async (req) => {
      calls.push(`${req.method} ${req.path}`);
      return answer(req.method, req.path);
    },
    openFeed: (after, onFrame) =>
      new Promise((done) => {
        const feed = {
          after,
          onFrame,
          closed: false,
          open: (handle = true) =>
            done(
              handle
                ? { state: { state: "connected", port: 1 }, handle: { close: () => void (feed.closed = true) } }
                : { state: { state: "unreachable", reason: "connection_failed" } },
            ),
        };
        feeds.push(feed);
      }),
  };
  return { kernel, world, calls, feeds };
}

/** Lets every pending promise and the next macrotask run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((done) => setImmediate(done));
}

function seam(): TraySeam {
  const found = (globalThis as Record<string, unknown>)[TRAY_SEAM_GLOBAL] as TraySeam | undefined;
  if (found === undefined) throw new Error("no seam");
  return found;
}

const model = (): TrayModel => seam().model();
const item = (id: string) => model().items.find((i) => i.id === id);
const lastTray = () => electron.trays.at(-1);
const menuItem = (id: string) => lastTray()?.menu?.template.find((i) => i.id === id);

const showWindow = vi.fn();
let warn: MockInstance<typeof console.warn>;

async function start(kernel: KernelConnection): Promise<void> {
  createTray({ kernel, showWindow });
  await settle();
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>)[TRAY_SEAM_GLOBAL];
  vi.stubEnv(TRAY_SEAM_ENV, "1");
  electron.app.isPackaged = false;
  electron.trayThrows = false;
  electron.trays.length = 0;
  electron.app.quit = vi.fn();
  electron.dialog.showMessageBox = vi.fn(async () => ({ response: 0 }));
  showWindow.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  warn.mockRestore();
});

describe("what the tray shows", () => {
  it("AC1: two pending approvals at rest read waiting, count 2, title 2", async () => {
    const { kernel } = fakeKernel({ pending: 2 });
    await start(kernel);
    expect(model()).toMatchObject({ state: "waiting", count: 2, title: "2" });
    expect(lastTray()?.title).toBe("2");
    expect(lastTray()?.tooltip).toBe("Loomwright Studio: waiting on you");
    expect(menuItem("status")).toMatchObject({ label: "waiting on you · 2 waiting on you", enabled: false });
  });

  it("an empty title at 0, and only pending approvals count", async () => {
    const { kernel } = fakeKernel({ sessions: 1 }, {
      override: (method, path) =>
        method === "GET" && path === "/approvals"
          ? { ok: true, status: 200, body: { approvals: [{ id: 1, status: "approved" }, { id: 2, status: "denied" }] } }
          : undefined,
    });
    await start(kernel);
    expect(model()).toMatchObject({ state: "working", count: 0, title: "" });
    expect(lastTray()?.title).toBe("");
  });

  it("is unknown until a GET /status answer is read", async () => {
    const { kernel } = fakeKernel({}, { override: (method, path) => (path === "/status" ? { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } } : undefined) });
    await start(kernel);
    expect(model().state).toBe("unknown");
    expect(item("kill-switch")?.enabled).toBe(true);
    expect(item("resume")?.enabled).toBe(false);
  });

  it("draws a coloured dot per state, in code", () => {
    const pixel = (dot: Parameters<typeof dotBitmap>[0], x: number, y: number) => {
      const { buffer, size } = dotBitmap(dot);
      const at = (y * size + x) * 4;
      return [...buffer.subarray(at, at + 4)];
    };
    // BGRA: the kill switch's red at the centre, a transparent corner.
    expect(pixel("failed", 16, 16)).toEqual([0x2a, 0x32, 0xb8, 255]);
    expect(pixel("failed", 0, 0)).toEqual([0, 0, 0, 0]);
    // Idle is a ring: its centre is transparent, its edge is not.
    expect(pixel("idle", 16, 16)[3]).toBe(0);
    expect(pixel("idle", 16, 3)[3]).toBeGreaterThan(0);
    expect(dotBitmap("working").size).toBe(32);
  });

  it("re-renders the icon when the state changes", async () => {
    const { kernel, world, feeds } = fakeKernel();
    await start(kernel);
    const idleImage = lastTray()?.image;
    world.engaged = true;
    feeds[0]?.open();
    await settle();
    feeds[0]?.onFrame({ type: "heartbeat", latest_id: 3 });
    await settle();
    expect(model().state).toBe("killed");
    expect(lastTray()?.image).not.toEqual(idleImage);
  });
});

describe("Pause all and Unpause (AC2)", () => {
  it("the dot reads paused only after GET /status says paused: true", async () => {
    const { kernel, calls } = fakeKernel({}, { obeys: false });
    await start(kernel);
    calls.length = 0;
    await seam().click("pause-all");
    expect(calls.filter((c) => c === "POST /pause")).toHaveLength(1);
    // The kernel answered the pause but its /status still says paused: false.
    expect(calls).toContain("GET /status");
    expect(model().state).toBe("idle");
    // Not even for a moment between the answer and the re-read.
    expect(lastTray()?.tooltips.filter((t) => t.includes("paused"))).toEqual([]);
    expect(item("pause-all")).toBeDefined();
    expect(item("unpause")).toBeUndefined();
  });

  it("one click sends exactly one POST /pause; the re-read after it shows paused, and the item reads Unpause", async () => {
    const { kernel, calls } = fakeKernel();
    await start(kernel);
    calls.length = 0;
    await seam().click("pause-all");
    expect(calls.filter((c) => c === "POST /pause")).toHaveLength(1);
    expect(calls.indexOf("GET /status")).toBeGreaterThan(calls.indexOf("POST /pause"));
    expect(model().state).toBe("paused");
    expect(item("pause-all")).toBeUndefined();
    expect(item("unpause")).toMatchObject({ label: "Unpause", enabled: true });
    expect(menuItem("unpause")?.label).toBe("Unpause");

    calls.length = 0;
    await seam().click("unpause");
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /unpause"]);
    expect(model().state).toBe("idle");
  });

  it("a second press while the first call runs sends nothing more", async () => {
    const { kernel, calls } = fakeKernel();
    await start(kernel);
    calls.length = 0;
    await Promise.all([seam().click("pause-all"), seam().click("pause-all")]);
    expect(calls.filter((c) => c === "POST /pause")).toHaveLength(1);
  });

  it("a failed action keeps the state as read and logs only the reason", async () => {
    const { kernel } = fakeKernel({}, { override: (method) => (method === "POST" ? { ok: false, status: 409, body: { error: "secret-body-text" } } : undefined) });
    await start(kernel);
    await seam().click("pause-all");
    expect(model().state).toBe("idle");
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain("loomwright-studio: tray: POST /pause failed: HTTP 409");
    expect(lines.join("\n")).not.toContain("secret-body-text");
  });
});

describe("the kill switch and Resume (AC3)", () => {
  it("Cancel on the confirm sends nothing", async () => {
    const { kernel, calls } = fakeKernel();
    await start(kernel);
    calls.length = 0;
    await seam().click("kill-switch");
    expect(electron.dialog.showMessageBox).toHaveBeenCalledOnce();
    const options = vi.mocked(electron.dialog.showMessageBox).mock.calls[0]?.[0];
    expect(options).toMatchObject({ defaultId: 0, cancelId: 0 });
    expect((options?.buttons as string[])[0]).toBe("Cancel");
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    expect(model().state).toBe("idle");
  });

  it("only a confirm sends exactly one POST /stop-all", async () => {
    electron.dialog.showMessageBox = vi.fn(async () => ({ response: KILL_CONFIRM_BUTTONS.indexOf("Engage kill switch") }));
    const { kernel, calls } = fakeKernel();
    await start(kernel);
    calls.length = 0;
    await seam().click("kill-switch");
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /stop-all"]);
    expect(model().state).toBe("killed");
    expect(item("kill-switch")?.enabled).toBe(false);
  });

  it("a confirm that cannot open sends nothing and throws nothing", async () => {
    electron.dialog.showMessageBox = vi.fn(async () => {
      throw new Error("no dialog");
    });
    const { kernel, calls } = fakeKernel();
    await start(kernel);
    calls.length = 0;
    await expect(seam().click("kill-switch")).resolves.toBeUndefined();
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("Resume is enabled when killed or paused, and sends POST /resume", async () => {
    const { kernel, calls } = fakeKernel({ engaged: true });
    await start(kernel);
    expect(item("resume")?.enabled).toBe(true);
    calls.length = 0;
    await seam().click("resume");
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual(["POST /resume"]);
    expect(model().state).toBe("idle");

    const paused = fakeKernel({ paused: true });
    await start(paused.kernel);
    expect(item("resume")?.enabled).toBe(true);
  });

  it("Resume at rest is disabled and a press sends nothing", async () => {
    const { kernel, calls } = fakeKernel();
    await start(kernel);
    expect(item("resume")?.enabled).toBe(false);
    expect(menuItem("resume")?.enabled).toBe(false);
    calls.length = 0;
    await seam().click("resume");
    expect(calls).toEqual([]);
  });
});

describe("Open and Quit (AC5)", () => {
  it("Open shows the window", async () => {
    const { kernel } = fakeKernel();
    await start(kernel);
    menuItem("open")?.click?.();
    expect(showWindow).toHaveBeenCalledOnce();
  });

  it("Quit calls app.quit() and no kernel.request", async () => {
    const { kernel, calls } = fakeKernel();
    await start(kernel);
    calls.length = 0;
    menuItem("quit")?.click?.();
    await settle();
    expect(electron.app.quit).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
  });
});

describe("untrusted answers", () => {
  it("a {} /status body throws nothing and keeps the state as last read", async () => {
    let malformed = false;
    const { kernel, calls } = fakeKernel({ engaged: true }, { override: () => (malformed ? { ok: true, status: 200, body: {} } : undefined) });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await start(kernel);
      expect(model().state).toBe("killed");
      malformed = true;
      calls.length = 0;
      await seam().click("resume");
      expect(calls).toContain("GET /status");
      expect(model()).toMatchObject({ state: "killed", count: 0 });
      expect(warn.mock.calls.map((c) => String(c[0]))).toContain("loomwright-studio: tray: GET /status answered a body of the wrong shape");
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it.each([
    ["a non-boolean engaged", { kill_switch: { engaged: "yes" }, sessions: [], cap_state: [] }],
    ["a non-boolean paused", { kill_switch: { engaged: false }, paused: "no", sessions: [], cap_state: [] }],
    ["no sessions array", { kill_switch: { engaged: false }, cap_state: [] }],
    ["a cap entry with no limits", { kill_switch: { engaged: false }, sessions: [], cap_state: [{}] }],
    ["null", null],
  ])("a /status body with %s from the start is a failed read", async (_name, body) => {
    const { kernel } = fakeKernel({ pending: 1 }, { override: (method, path) => (path === "/status" ? { ok: true, status: 200, body } : undefined) });
    await start(kernel);
    expect(model()).toMatchObject({ state: "unknown", count: 1 });
  });

  it("a good read, then an unreachable one: the state stays as last read, and the status line and tooltip say it is stale until a read answers", async () => {
    let down = false;
    const { kernel } = fakeKernel(
      { pending: 1 },
      { override: (method) => (down && method === "GET" ? { ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } } : undefined) },
    );
    await start(kernel);
    expect(model()).toMatchObject({ state: "waiting", stale: false, tooltip: "Loomwright Studio: waiting on you" });
    down = true;
    await seam().click("pause-all");
    expect(model()).toMatchObject({ state: "waiting", count: 1, title: "1", stale: true, tooltip: "Loomwright Studio: kernel not reached (last: waiting on you)" });
    expect(item("status")?.label).toBe("kernel not reached (last: waiting on you) · 1 waiting on you");
    expect(lastTray()?.tooltip).toBe("Loomwright Studio: kernel not reached (last: waiting on you)");
    expect(menuItem("status")?.label).toBe("kernel not reached (last: waiting on you) · 1 waiting on you");
    // The kernel is back: the next read clears it (the earlier POST /pause did land, so it now reads paused).
    down = false;
    await seam().click("pause-all");
    expect(model()).toMatchObject({ state: "paused", stale: false, tooltip: "Loomwright Studio: paused" });
  });

  it("a failed /approvals read alone also marks the tray stale", async () => {
    let malformed = false;
    const { kernel } = fakeKernel({}, { override: (_m, path) => (malformed && path === "/approvals" ? { ok: true, status: 200, body: {} } : undefined) });
    await start(kernel);
    malformed = true;
    await seam().click("pause-all");
    expect(model()).toMatchObject({ state: "paused", stale: true, tooltip: "Loomwright Studio: kernel not reached (last: paused)" });
  });

  it("a malformed /approvals body keeps the count as last read", async () => {
    let malformed = false;
    const { kernel } = fakeKernel({ pending: 2 }, { override: (_m, path) => (malformed && path === "/approvals" ? { ok: true, status: 200, body: { approvals: "x" } } : undefined) });
    await start(kernel);
    malformed = true;
    await seam().click("pause-all");
    expect(model()).toMatchObject({ state: "paused", count: 2 });
  });

  it("a request that rejects is a failed read, never an unhandled rejection", async () => {
    const kernel: KernelConnection = {
      connection: async () => ({ state: "connected", port: 1 }),
      request: async () => {
        throw new Error("boom");
      },
      openFeed: () => Promise.reject(new Error("no feed")),
    };
    await start(kernel);
    await seam().click("pause-all");
    expect(model().state).toBe("unknown");
  });
});

describe("the feed", () => {
  it("is single flight: no second openFeed while the first is pending", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { kernel, feeds } = fakeKernel();
    await start(kernel);
    expect(feeds).toHaveLength(1);
    vi.advanceTimersByTime(TRAY_POLL_MS * 3);
    await settle();
    expect(feeds).toHaveLength(1);
  });

  it("re-reads on each frame, and reopens from the last id after a close, on the next poll", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { kernel, feeds, calls } = fakeKernel();
    await start(kernel);
    feeds[0]?.open();
    await settle();
    calls.length = 0;
    // The feed is up: the poll does not read.
    vi.advanceTimersByTime(TRAY_POLL_MS);
    await settle();
    expect(calls).toEqual([]);

    feeds[0]?.onFrame({ type: "event", id: 41, at: "2026-10-23T00:00:00Z", kind: "x", session_id: null, task_id: null, payload: null });
    await settle();
    expect(calls).toContain("GET /status");

    feeds[0]?.onFrame({ type: "closed", code: 1011, reason: "" });
    await settle();
    expect(feeds).toHaveLength(1);
    vi.advanceTimersByTime(TRAY_POLL_MS);
    await settle();
    expect(feeds).toHaveLength(2);
    expect(feeds[1]?.after).toBe(41);
  });

  it("throttles feed-driven reads: a burst of frames reads at most once per window, and the last frame is never lost", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const { kernel, feeds, calls, world } = fakeKernel();
    await start(kernel);
    feeds[0]?.open();
    await settle();
    calls.length = 0;
    const frame = (id: number): FeedRelayFrame => ({ type: "event", id, at: "2026-10-23T00:00:00Z", kind: "x", session_id: null, task_id: null, payload: null });
    for (let id = 1; id <= 500; id += 1) feeds[0]?.onFrame(frame(id));
    await settle();
    // The first frame reads at once; the rest fold into one trailing read.
    expect(calls.filter((c) => c === "GET /status")).toHaveLength(1);
    world.paused = true;
    feeds[0]?.onFrame(frame(501));
    vi.advanceTimersByTime(TRAY_FEED_THROTTLE_MS);
    await settle();
    expect(calls.filter((c) => c === "GET /status")).toHaveLength(2);
    expect(model().state).toBe("paused");
    vi.advanceTimersByTime(TRAY_FEED_THROTTLE_MS * 4);
    await settle();
    expect(calls.filter((c) => c === "GET /status")).toHaveLength(2);
  });

  it("a backward wall-clock step never holds feed-driven reads: the next frame after the window still reads", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const { kernel, feeds, calls, world } = fakeKernel({ pending: 3 });
    await start(kernel);
    feeds[0]?.open();
    await settle();
    calls.length = 0;
    const frame = (id: number): FeedRelayFrame => ({ type: "event", id, at: "2026-10-23T00:00:00Z", kind: "x", session_id: null, task_id: null, payload: null });
    feeds[0]?.onFrame(frame(1));
    await settle();
    expect(calls.filter((c) => c === "GET /status")).toHaveLength(1);
    vi.advanceTimersByTime(TRAY_FEED_THROTTLE_MS);
    // The clock steps back an hour (an NTP step after wake).
    vi.setSystemTime(Date.now() - 60 * 60 * 1000);
    world.paused = true;
    feeds[0]?.onFrame(frame(2));
    await settle();
    expect(calls.filter((c) => c === "GET /status")).toHaveLength(2);
    expect(model().state).toBe("paused");
    expect(model().stale).toBe(false);
    // A frame inside the window is owed, and read when the window closes, not an hour later.
    world.paused = false;
    feeds[0]?.onFrame(frame(3));
    vi.advanceTimersByTime(TRAY_FEED_THROTTLE_MS);
    await settle();
    expect(calls.filter((c) => c === "GET /status")).toHaveLength(3);
    expect(model().state).toBe("waiting");
  });

  it("a heartbeat that does not advance the cursor reads nothing; one that does reads", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const { kernel, feeds, calls } = fakeKernel();
    await start(kernel);
    feeds[0]?.open();
    await settle();
    calls.length = 0;
    for (let i = 0; i < 50; i += 1) feeds[0]?.onFrame({ type: "heartbeat", latest_id: 0 } as FeedRelayFrame);
    vi.advanceTimersByTime(TRAY_FEED_THROTTLE_MS * 2);
    await settle();
    expect(calls).toEqual([]);
    feeds[0]?.onFrame({ type: "heartbeat", latest_id: 3 } as FeedRelayFrame);
    await settle();
    expect(calls).toContain("GET /status");
  });

  it("an action's re-read is immediate, not throttled", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { kernel, feeds, calls } = fakeKernel();
    await start(kernel);
    feeds[0]?.open();
    await settle();
    const frame: FeedRelayFrame = { type: "event", id: 1, at: "2026-10-23T00:00:00Z", kind: "x", session_id: null, task_id: null, payload: null };
    feeds[0]?.onFrame(frame);
    await settle();
    calls.length = 0;
    await seam().click("pause-all");
    expect(calls).toEqual(["POST /pause", "GET /status", "GET /approvals"]);
    expect(model().state).toBe("paused");
  });

  it("polls while the feed is down", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { kernel, feeds, calls } = fakeKernel();
    await start(kernel);
    feeds[0]?.open(false);
    await settle();
    calls.length = 0;
    vi.advanceTimersByTime(TRAY_POLL_MS);
    await settle();
    expect(calls).toContain("GET /status");
    expect(feeds).toHaveLength(2);
  });

  it("starts no timer that keeps the process alive", async () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const timeouts = vi.spyOn(globalThis, "setTimeout");
    try {
      const { kernel, feeds } = fakeKernel();
      await start(kernel);
      feeds[0]?.open();
      await settle();
      // Two frames inside one throttle window start the trailing timer.
      feeds[0]?.onFrame({ type: "heartbeat", latest_id: 1 } as FeedRelayFrame);
      feeds[0]?.onFrame({ type: "heartbeat", latest_id: 2 } as FeedRelayFrame);
      const handles = spy.mock.results.map((r) => r.value as NodeJS.Timeout);
      expect(handles.length).toBeGreaterThan(0);
      for (const handle of handles) {
        expect(handle.hasRef()).toBe(false);
        clearInterval(handle);
      }
      const throttle = timeouts.mock.calls.findIndex((c) => c[1] !== undefined && c[1] > 0 && c[1] <= TRAY_FEED_THROTTLE_MS);
      expect(throttle).toBeGreaterThanOrEqual(0);
      const handle = timeouts.mock.results[throttle]?.value as NodeJS.Timeout;
      expect(handle.hasRef()).toBe(false);
      clearTimeout(handle);
    } finally {
      spy.mockRestore();
      timeouts.mockRestore();
    }
  });
});

describe("the e2e seam", () => {
  it("a packaged app sets no seam, even with the env var", async () => {
    electron.app.isPackaged = true;
    const { kernel } = fakeKernel();
    await start(kernel);
    expect((globalThis as Record<string, unknown>)[TRAY_SEAM_GLOBAL]).toBeUndefined();
  });

  it("an unpackaged app without the env var sets no seam", async () => {
    vi.stubEnv(TRAY_SEAM_ENV, "");
    const { kernel } = fakeKernel();
    await start(kernel);
    expect((globalThis as Record<string, unknown>)[TRAY_SEAM_GLOBAL]).toBeUndefined();
  });

  it("keeps the model and the seam when the platform has no tray", async () => {
    electron.trayThrows = true;
    const { kernel } = fakeKernel({ pending: 1 });
    await start(kernel);
    expect(electron.trays).toHaveLength(0);
    expect(model()).toMatchObject({ state: "waiting", count: 1 });
  });
});
