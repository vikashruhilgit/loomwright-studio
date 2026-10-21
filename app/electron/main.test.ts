// The window pin (Criterion 8): the main process's one window is
// context-isolated, with no Node integration, sandboxed, and loads the
// preload; the renderer can't open windows or navigate away; and the main
// process answers the bridge's channels only for its own window.
import { beforeAll, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const windows: {
    options: Record<string, unknown>;
    contents?: unknown;
    sent: [string, unknown][];
    openHandler?: () => unknown;
    navigate?: (e: { preventDefault(): void }) => void;
    loaded?: string;
  }[] = [];
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return { windows, handlers, permission: undefined as undefined | ((c: unknown, p: string, decide: (ok: boolean) => void) => void) };
});

/** The kernel connection, faked: each `openFeed` waits until the test opens it. */
const kernel = vi.hoisted(() => {
  const feeds: { after: number; onFrame: (f: unknown) => void; closed: boolean; open: () => void }[] = [];
  return { feeds };
});

vi.mock("./kernel-connection", () => ({
  resolveDataDir: () => "/the/data",
  tokenReaderFor: () => async () => undefined,
  createKernelConnection: () => ({
    connection: async () => ({ state: "connected", port: 1 }),
    request: async () => ({ ok: true, status: 200, body: {} }),
    openFeed: (after: number, onFrame: (f: unknown) => void) =>
      new Promise((done) => {
        const feed = {
          after,
          onFrame,
          closed: false,
          open: () => done({ state: { state: "connected", port: 1 }, handle: { close: () => void (feed.closed = true) } }),
        };
        kernel.feeds.push(feed);
      }),
  }),
}));

vi.mock("electron", () => {
  class BrowserWindow {
    readonly webContents: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      const record: (typeof electron.windows)[number] = { options, sent: [] };
      electron.windows.push(record);
      this.webContents = {
        setWindowOpenHandler: (handler: () => unknown) => {
          record.openHandler = handler;
        },
        on: (event: string, listener: (e: { preventDefault(): void }) => void) => {
          if (event === "will-navigate") record.navigate = listener;
        },
        send: (channel: string, value: unknown) => void record.sent.push([channel, value]),
        isDestroyed: () => false,
      };
      record.contents = this.webContents;
      Object.assign(this, { loadFile: async (path: string) => void (record.loaded = path) });
    }
    once(): void {}
    on(): void {}
    show(): void {}
  }
  return {
    BrowserWindow,
    app: {
      isPackaged: false,
      getAppPath: () => "/the/app",
      whenReady: async () => undefined,
      on: () => undefined,
      quit: () => undefined,
    },
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
        electron.handlers.set(channel, handler);
      },
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (handler: (c: unknown, p: string, decide: (ok: boolean) => void) => void) => {
          electron.permission = handler;
        },
      },
    },
  };
});

beforeAll(async () => {
  await import("./main");
  await vi.waitFor(() => expect(electron.windows).toHaveLength(1));
});

describe("the main window", () => {
  it("is context-isolated, with no Node integration, sandboxed", () => {
    const prefs = electron.windows[0]?.options.webPreferences as Record<string, unknown>;
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.webSecurity).toBe(true);
  });

  it("loads the built preload and the built renderer from the app", () => {
    const prefs = electron.windows[0]?.options.webPreferences as Record<string, unknown>;
    expect(prefs.preload).toBe("/the/app/dist-electron/preload.cjs");
    expect(electron.windows[0]?.loaded).toBe("/the/app/dist/index.html");
  });

  it("denies every new window, every navigation and every permission", () => {
    expect(electron.windows[0]?.openHandler?.()).toEqual({ action: "deny" });
    const prevented = vi.fn();
    electron.windows[0]?.navigate?.({ preventDefault: prevented });
    expect(prevented).toHaveBeenCalledOnce();
    const decide = vi.fn();
    electron.permission?.(undefined, "media", decide);
    expect(decide).toHaveBeenCalledWith(false);
  });

  it("handles exactly the bridge's channels, and refuses a caller that is not its window", async () => {
    expect([...electron.handlers.keys()].sort()).toEqual(["studio:connection", "studio:feed:subscribe", "studio:feed:unsubscribe", "studio:request"]);
    const handler = electron.handlers.get("studio:request");
    await expect(Promise.resolve(handler?.({ sender: {} }, { method: "GET", path: "/status" }))).rejects.toThrow("refused");
    await expect(Promise.resolve(handler?.({ sender: electron.windows[0]?.contents }, { method: "GET", path: "/status" }))).resolves.toEqual({
      ok: true,
      status: 200,
      body: {},
    });
  });
});

describe("the feed relay", () => {
  const subscribe = (after: unknown) => electron.handlers.get("studio:feed:subscribe")?.({ sender: electron.windows[0]?.contents }, after) as Promise<unknown>;
  const unsubscribe = () => electron.handlers.get("studio:feed:unsubscribe")?.({ sender: electron.windows[0]?.contents }) as Promise<unknown>;

  it("forwards the open feed's frames to the window, from a sanitised `after`", async () => {
    kernel.feeds.length = 0;
    const done = subscribe(-3);
    kernel.feeds[0]?.open();
    await done;
    expect(kernel.feeds[0]?.after).toBe(0);
    kernel.feeds[0]?.onFrame({ type: "heartbeat", latest_id: 1 });
    expect(electron.windows[0]?.sent.at(-1)).toEqual(["studio:feed:frame", { type: "heartbeat", latest_id: 1 }]);
    await unsubscribe();
    expect(kernel.feeds[0]?.closed).toBe(true);
  });

  it("closes a feed that a later subscribe or an unsubscribe superseded while it was opening", async () => {
    kernel.feeds.length = 0;
    electron.windows[0]?.sent.splice(0);
    const first = subscribe(1);
    const second = subscribe(2);
    kernel.feeds[1]?.open();
    kernel.feeds[0]?.open();
    await Promise.all([first, second]);
    expect(kernel.feeds[0]?.closed).toBe(true);
    expect(kernel.feeds[1]?.closed).toBe(false);
    kernel.feeds[0]?.onFrame({ type: "heartbeat", latest_id: 9 });
    expect(electron.windows[0]?.sent).toEqual([]);

    const third = subscribe(3);
    await unsubscribe();
    kernel.feeds[2]?.open();
    await third;
    expect(kernel.feeds[1]?.closed).toBe(true);
    expect(kernel.feeds[2]?.closed).toBe(true);
  });
});
