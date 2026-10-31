// The window pin (Criterion 8): the main process's one window is
// context-isolated, with no Node integration, sandboxed, and loads the
// preload; the renderer can't open windows or navigate away; and the main
// process answers the bridge's channels only for its own window.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const windows: {
    options: Record<string, unknown>;
    contents?: unknown;
    sent: [string, unknown][];
    openHandler?: () => unknown;
    navigate?: (e: { preventDefault(): void }) => void;
    loaded?: string;
    /** `nativeTheme.themeSource` at the moment this window was constructed. */
    themeAtCreation?: string;
  }[] = [];
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  // The app's own preferences live in a throwaway dir (the unpackaged-run seam), seeded with a dark theme.
  const fs = process.getBuiltinModule("node:fs");
  const prefsDir = fs.mkdtempSync(`${process.getBuiltinModule("node:os").tmpdir()}/studio-main-test-`);
  fs.writeFileSync(`${prefsDir}/prefs.json`, JSON.stringify({ notifications: true, theme: "dark" }));
  process.env.STUDIO_APP_PREFS_DIR = prefsDir;
  // What the mocked OS holds and was asked: the login item, the theme and the folders `shell.openPath` was handed.
  const os = { login: { openAtLogin: false, status: "not-registered" }, loginSets: [] as unknown[], themeSource: "system", opened: [] as string[] };
  return {
    windows,
    handlers,
    prefsDir,
    os,
    permission: undefined as undefined | ((c: unknown, p: string, decide: (ok: boolean) => void) => void),
  };
});

/** The kernel connection, faked: each `openFeed` waits until the test opens it. */
const kernel = vi.hoisted(() => {
  const feeds: { after: number; onFrame: (f: unknown) => void; closed: boolean; open: () => void }[] = [];
  // What `connection()` answers; a test sets it to try a kernel that is not connected.
  const where: { current: unknown } = { current: { state: "connected", port: 1 } };
  // Every address `shell.openExternal` was handed.
  const opened: string[] = [];
  return { feeds, where, opened };
});

vi.mock("./kernel-connection", () => ({
  API_HOST: "127.0.0.1",
  resolveDataDir: () => "/the/data",
  tokenReaderFor: () => async () => undefined,
  createKernelConnection: () => ({
    connection: async () => kernel.where.current,
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
      const record: (typeof electron.windows)[number] = { options, sent: [], themeAtCreation: electron.os.themeSource };
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
      getPath: () => electron.prefsDir,
      getLoginItemSettings: () => ({ ...electron.os.login }),
      setLoginItemSettings: (settings: { openAtLogin: boolean }) => {
        electron.os.loginSets.push(settings);
        electron.os.login = { openAtLogin: settings.openAtLogin, status: settings.openAtLogin ? "enabled" : "not-registered" };
      },
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
    Tray: class {
      setImage(): void {}
      setTitle(): void {}
      setToolTip(): void {}
      setContextMenu(): void {}
    },
    Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
    nativeImage: { createFromBitmap: () => ({}) },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    nativeTheme: {
      get themeSource() {
        return electron.os.themeSource;
      },
      set themeSource(value: string) {
        electron.os.themeSource = value;
      },
    },
    shell: {
      openExternal: async (url: string) => {
        kernel.opened.push(url);
      },
      openPath: async (path: string) => {
        electron.os.opened.push(path);
        return "";
      },
    },
  };
});

beforeAll(async () => {
  await import("./main");
  await vi.waitFor(() => expect(electron.windows).toHaveLength(1));
});

afterAll(() => {
  process.getBuiltinModule("node:fs").rmSync(electron.prefsDir, { recursive: true, force: true });
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
    expect([...electron.handlers.keys()].sort()).toEqual([
      "studio:connection",
      "studio:feed:subscribe",
      "studio:feed:unsubscribe",
      "studio:open-external",
      "studio:prefs:get",
      "studio:prefs:set",
      "studio:request",
      "studio:reveal-data-dir",
    ]);
    const handler = electron.handlers.get("studio:request");
    await expect(Promise.resolve(handler?.({ sender: {} }, { method: "GET", path: "/status" }))).rejects.toThrow("refused");
    await expect(Promise.resolve(handler?.({ sender: electron.windows[0]?.contents }, { method: "GET", path: "/status" }))).resolves.toEqual({
      ok: true,
      status: 200,
      body: {},
    });
  });
});

describe("the open-external channel", () => {
  const START = "http://127.0.0.1:1/connectors/github/app/start?state=abc";
  const owner = () => ({ sender: electron.windows[0]?.contents });
  const open = (url: unknown, event: unknown = owner()) => Promise.resolve(electron.handlers.get("studio:open-external")?.(event, url));
  const connected = { state: "connected", port: 1 };

  beforeEach(() => {
    kernel.opened.length = 0;
    kernel.where.current = connected;
  });
  afterEach(() => {
    kernel.where.current = connected;
  });

  it("opens each of the three allowed forms in the system browser and answers true", async () => {
    for (const url of [START, "https://github.com/settings/installations", "https://github.com/settings/apps/my-app"]) {
      await expect(open(url)).resolves.toBe(true);
    }
    expect(kernel.opened).toEqual([START, "https://github.com/settings/installations", "https://github.com/settings/apps/my-app"]);
  });

  it("refuses a caller that is not the window, and opens nothing", async () => {
    await expect(open(START, { sender: {} })).rejects.toThrow("refused");
    await expect(open(START, { sender: undefined })).rejects.toThrow("refused");
    expect(kernel.opened).toEqual([]);
  });

  it("answers false for an address off the allowlist, and opens nothing", async () => {
    for (const url of [
      "https://example.com/",
      "https://github.com/settings/apps",
      "http://127.0.0.1:2/connectors/github/app/start?state=abc",
      "http://localhost:1/connectors/github/app/start?state=abc",
      "javascript:alert(1)",
      "file:///etc/passwd",
    ]) {
      await expect(open(url)).resolves.toBe(false);
    }
    expect(kernel.opened).toEqual([]);
  });

  it("answers false for an argument that is not a string, and opens nothing", async () => {
    for (const arg of [undefined, null, 7, { href: START }, [START]]) {
      await expect(open(arg)).resolves.toBe(false);
    }
    expect(kernel.opened).toEqual([]);
  });

  it("answers false while the kernel is not connected, even for an allowed address, and opens nothing", async () => {
    for (const state of [
      { state: "not_installed", dataDir: "/the/data" },
      { state: "unreachable", reason: "api_unreachable" },
    ]) {
      kernel.where.current = state;
      await expect(open(START)).resolves.toBe(false);
      await expect(open("https://github.com/settings/installations")).resolves.toBe(false);
    }
    expect(kernel.opened).toEqual([]);
  });

  it("follows the kernel's current port at call time", async () => {
    kernel.where.current = { state: "connected", port: 2 };
    await expect(open(START)).resolves.toBe(false);
    await expect(open("http://127.0.0.1:2/connectors/github/app/start?state=abc")).resolves.toBe(true);
    expect(kernel.opened).toEqual(["http://127.0.0.1:2/connectors/github/app/start?state=abc"]);
  });

  it("answers false when the system browser can't be opened, without leaking the address", async () => {
    const { shell } = await import("electron");
    const original = shell.openExternal;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    shell.openExternal = async () => {
      throw new Error(`no handler for ${START}`);
    };
    try {
      await expect(open(START)).resolves.toBe(false);
      expect(warn.mock.calls.flat().join(" ")).not.toContain("state=abc");
    } finally {
      shell.openExternal = original;
      warn.mockRestore();
    }
  });

  it("leaves the window's navigation and window-open guards in place", () => {
    expect(electron.windows[0]?.openHandler?.()).toEqual({ action: "deny" });
  });
});

describe("the preferences channels", () => {
  const owner = () => ({ sender: electron.windows[0]?.contents });
  const call = (channel: string, event: unknown, ...args: unknown[]) => Promise.resolve(electron.handlers.get(channel)?.(event, ...args));

  beforeEach(() => {
    electron.os.loginSets.length = 0;
    electron.os.opened.length = 0;
  });

  it("applies the stored theme before the window is created", () => {
    expect(electron.windows[0]?.themeAtCreation).toBe("dark");
    expect(electron.os.themeSource).toBe("dark");
  });

  it("refuses a caller that is not the window, on each channel, and changes and opens nothing", async () => {
    for (const sender of [{}, undefined]) {
      await expect(call("studio:prefs:get", { sender })).rejects.toThrow("refused");
      await expect(call("studio:prefs:set", { sender }, { theme: "light", launchAtLogin: true })).rejects.toThrow("refused");
      await expect(call("studio:reveal-data-dir", { sender })).rejects.toThrow("refused");
    }
    expect(electron.os.loginSets).toEqual([]);
    expect(electron.os.opened).toEqual([]);
    expect(electron.os.themeSource).toBe("dark");
  });

  it("answers the window's get and applies its valid set", async () => {
    await expect(call("studio:prefs:get", owner())).resolves.toEqual({ launchAtLogin: { enabled: false, status: "not-registered" }, notifications: true, theme: "dark" });
    await expect(call("studio:prefs:set", owner(), { launchAtLogin: true, theme: "light" })).resolves.toEqual({
      launchAtLogin: { enabled: true, status: "enabled" },
      notifications: true,
      theme: "light",
    });
    expect(electron.os.loginSets).toEqual([{ openAtLogin: true }]);
    expect(electron.os.themeSource).toBe("light");
  });

  it("refuses an invalid patch without throwing, answering the unchanged state", async () => {
    await expect(call("studio:prefs:set", owner(), { theme: "purple", launchAtLogin: false })).resolves.toMatchObject({ theme: "light", launchAtLogin: { enabled: true } });
    await expect(call("studio:prefs:set", owner(), "dark")).resolves.toMatchObject({ theme: "light" });
    expect(electron.os.loginSets).toEqual([]);
  });

  it("reveals the main process's own data dir and ignores any argument the renderer sends", async () => {
    await expect(call("studio:reveal-data-dir", owner())).resolves.toBe(true);
    await expect(call("studio:reveal-data-dir", owner(), "/Users/o/.ssh")).resolves.toBe(true);
    expect(electron.os.opened).toEqual(["/the/data", "/the/data"]);
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
