// The deep-link pin (item 17, AC4b): a `loomwright-studio://` link reaches the
// renderer only as `notification/<id>` or `invalid-link`; a link from before
// ready waits for ready and for `main.ts`'s own window (exactly one window);
// a cold window gets the route again after it loads; a loaded window gets it
// once.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEEP_LINK_PREFIX } from "../src/screens/menubar/state";

type Listener = (...args: unknown[]) => void;

const electron = vi.hoisted(() => ({
  listeners: new Map<string, Listener[]>(),
  ready: Promise.resolve() as Promise<void>,
  resolveReady: (() => undefined) as () => void,
  /** Every window constructed (`BrowserWindow.getAllWindows()`). */
  windows: [] as unknown[],
}));

vi.mock("electron", () => {
  class BrowserWindow {
    destroyed = false;
    loading = true;
    url = "";
    sent: string[] = [];
    loadListeners: Listener[] = [];
    readonly webContents = {
      isLoading: () => this.loading,
      getURL: () => this.url,
      once: (event: string, listener: Listener) => {
        if (event === "did-finish-load") this.loadListeners.push(listener);
      },
    };
    constructor() {
      electron.windows.push(this);
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    static getAllWindows(): BrowserWindow[] {
      return electron.windows as BrowserWindow[];
    }
  }
  return {
    BrowserWindow,
    app: {
      on: (event: string, listener: Listener) => {
        electron.listeners.set(event, [...(electron.listeners.get(event) ?? []), listener]);
      },
      whenReady: () => electron.ready,
    },
  };
});

const { BrowserWindow } = await import("electron");
const { DEEP_LINK_SCHEME, registerDeepLinks } = await import("./deeplink");

interface FakeWindow {
  destroyed: boolean;
  loading: boolean;
  url: string;
  sent: string[];
  loadListeners: Listener[];
}

const windows = (): FakeWindow[] => electron.windows as FakeWindow[];

/** The page finishes loading: `did-finish-load` fires once per listener. */
function finishLoad(window: FakeWindow | undefined): void {
  if (window === undefined) throw new Error("no window");
  window.loading = false;
  window.url = "file:///the/app/dist/index.html";
  const listeners = window.loadListeners.splice(0);
  for (const listener of listeners) listener();
}

/** `main.ts`, simulated: one window, created on ready or by `showWindow`; `navigate` shows the window then sends at once. */
function mainProcess() {
  let window: FakeWindow | undefined;
  const createWindow = (): FakeWindow => {
    window = new BrowserWindow() as unknown as FakeWindow;
    return window;
  };
  const navigate = vi.fn((route: string) => {
    if (window === undefined || window.destroyed) createWindow();
    window?.sent.push(route);
  });
  return { createWindow, navigate };
}

function openUrl(url: string): { preventDefault: ReturnType<typeof vi.fn> } {
  const event = { preventDefault: vi.fn() };
  for (const listener of electron.listeners.get("open-url") ?? []) listener(event, url);
  return event;
}

/** The turn after ready: the deferred flush runs. */
async function nextTurn(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((done) => setImmediate(done));
}

beforeEach(() => {
  electron.listeners.clear();
  electron.windows.splice(0);
  electron.ready = new Promise<void>((done) => {
    electron.resolveReady = done;
  });
});

describe("the link grammar at the boundary", () => {
  it("the scheme matches the kernel's link prefix and the packaged app's registered scheme", () => {
    expect(DEEP_LINK_PREFIX.startsWith(`${DEEP_LINK_SCHEME}://`)).toBe(true);
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { build: { protocols: { schemes: string[] }[] } };
    expect(pkg.build.protocols.flatMap((p) => p.schemes)).toEqual([DEEP_LINK_SCHEME]);
  });

  it("sends only notification/<id> or invalid-link, never the raw URL, and prevents the default", async () => {
    const main = mainProcess();
    registerDeepLinks({ navigate: main.navigate });
    electron.resolveReady();
    await nextTurn();
    main.createWindow();
    finishLoad(windows()[0]);
    const links = [
      "loomwright-studio://notifications/7",
      "loomwright-studio://approve/7",
      "loomwright-studio://notifications/abc",
      "loomwright-studio://notifications/7?approve=1",
      "https://example.com/notifications/7",
    ];
    const events = links.map(openUrl);
    for (const event of events) expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(main.navigate.mock.calls.map((c) => c[0])).toEqual(["notification/7", "invalid-link", "invalid-link", "invalid-link", "invalid-link"]);
  });
});

describe("delivery order (AC4b)", () => {
  it("(i) a pre-ready link waits for ready and main.ts's window, leaves exactly one window, and arrives after did-finish-load", async () => {
    const main = mainProcess();
    registerDeepLinks({ navigate: main.navigate });
    openUrl("loomwright-studio://notifications/7");
    // main.ts's order: its code after `await app.whenReady()` is registered after registerDeepLinks.
    void electron.ready.then(() => main.createWindow());
    await nextTurn();
    expect(main.navigate).not.toHaveBeenCalled();
    expect(windows()).toHaveLength(0);

    electron.resolveReady();
    await nextTurn();
    expect(windows()).toHaveLength(1);
    // The window is still loading: nothing is sent until it has loaded.
    expect(main.navigate).not.toHaveBeenCalled();

    finishLoad(windows()[0]);
    expect(main.navigate.mock.calls).toEqual([["notification/7"]]);
    expect(windows()).toHaveLength(1);
    expect(windows()[0]?.sent).toEqual(["notification/7"]);
  });

  it("only the latest pre-ready link is delivered", async () => {
    const main = mainProcess();
    registerDeepLinks({ navigate: main.navigate });
    openUrl("loomwright-studio://notifications/7");
    openUrl("loomwright-studio://notifications/8");
    void electron.ready.then(() => main.createWindow());
    electron.resolveReady();
    await nextTurn();
    finishLoad(windows()[0]);
    expect(main.navigate.mock.calls).toEqual([["notification/8"]]);
  });

  it("(ii) with no window, navigate is called, then again after the new window's did-finish-load", async () => {
    const main = mainProcess();
    registerDeepLinks({ navigate: main.navigate });
    electron.resolveReady();
    await nextTurn();
    expect(windows()).toHaveLength(0);

    openUrl("loomwright-studio://notifications/7");
    expect(main.navigate).toHaveBeenCalledTimes(1);
    expect(windows()).toHaveLength(1);

    finishLoad(windows()[0]);
    expect(main.navigate.mock.calls).toEqual([["notification/7"], ["notification/7"]]);
    expect(windows()).toHaveLength(1);
  });

  it("(ii) a closed window counts as no window", async () => {
    const main = mainProcess();
    registerDeepLinks({ navigate: main.navigate });
    electron.resolveReady();
    await nextTurn();
    main.createWindow();
    finishLoad(windows()[0]);
    const closed = windows()[0];
    if (closed !== undefined) closed.destroyed = true;

    openUrl("loomwright-studio://notifications/7");
    const created = windows().find((w) => !w.destroyed);
    expect(created).toBeDefined();
    finishLoad(created);
    expect(main.navigate.mock.calls).toEqual([["notification/7"], ["notification/7"]]);
  });

  it("(iii) with a loaded window, navigate is called exactly once", async () => {
    const main = mainProcess();
    registerDeepLinks({ navigate: main.navigate });
    electron.resolveReady();
    await nextTurn();
    main.createWindow();
    finishLoad(windows()[0]);

    openUrl("loomwright-studio://notifications/7");
    finishLoad(windows()[0]);
    await nextTurn();
    expect(main.navigate.mock.calls).toEqual([["notification/7"]]);
  });

  it("a window still loading gets the route once, after did-finish-load", async () => {
    const main = mainProcess();
    registerDeepLinks({ navigate: main.navigate });
    electron.resolveReady();
    await nextTurn();
    main.createWindow();

    openUrl("loomwright-studio://notifications/7");
    expect(main.navigate).not.toHaveBeenCalled();
    finishLoad(windows()[0]);
    expect(main.navigate.mock.calls).toEqual([["notification/7"]]);
  });

  it("a window whose page has not started loading (no URL) counts as loading", async () => {
    const main = mainProcess();
    registerDeepLinks({ navigate: main.navigate });
    electron.resolveReady();
    await nextTurn();
    const window = main.createWindow();
    window.loading = false;

    openUrl("loomwright-studio://notifications/7");
    expect(main.navigate).not.toHaveBeenCalled();
    finishLoad(window);
    expect(main.navigate.mock.calls).toEqual([["notification/7"]]);
  });
});
