// The Electron main process: thin on purpose (D10). It owns the window, the
// kernel connection (api.json, the pid check, the Keychain token), the tray
// and the `loomwright-studio://` scheme. The renderer reaches the kernel only
// through the preload's `window.api`, and every API call is made here, so the
// token never enters the renderer, which is the surface that renders
// untrusted text (invariant 3).
import { join } from "node:path";
import { BrowserWindow, app, ipcMain, session } from "electron";
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent, WebContents } from "electron";
import type { ApiRequest, FeedRelayFrame } from "../src/api/contract";
import { CHANNELS } from "./channels";
import { registerDeepLinks } from "./deeplink";
import { showsWindow } from "./hidden-window";
import { createKernelConnection, resolveDataDir, tokenReaderFor } from "./kernel-connection";
import type { FeedHandle, KernelConnection } from "./kernel-connection";
import { createTray } from "./tray";

/** The window's options. The three security settings are pinned by `electron/main.test.ts`. */
export function windowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    title: "Loomwright Studio",
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    show: false,
    // The approved layout: a 52px title bar with inset traffic lights over a vibrancy sidebar.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  };
}

/** Wires the bridge's channels to `kernel`, answering only `owner`'s window. */
function handleBridge(kernel: KernelConnection, owner: () => WebContents | undefined): void {
  const fromOwner = (event: IpcMainInvokeEvent): boolean => event.sender === owner();
  let feed: FeedHandle | undefined;
  // Bumped by every subscribe and unsubscribe: a socket opened for a request a later one superseded is closed, never kept.
  let generation = 0;
  const closeFeed = (): void => {
    generation += 1;
    feed?.close();
    feed = undefined;
  };

  ipcMain.handle(CHANNELS.connection, async (event) => {
    if (!fromOwner(event)) throw new Error("refused");
    return kernel.connection();
  });
  ipcMain.handle(CHANNELS.request, async (event, request: ApiRequest) => {
    if (!fromOwner(event)) throw new Error("refused");
    return kernel.request(request);
  });
  ipcMain.handle(CHANNELS.feedSubscribe, async (event, after: unknown) => {
    if (!fromOwner(event)) throw new Error("refused");
    closeFeed();
    const mine = generation;
    const from = typeof after === "number" && Number.isSafeInteger(after) && after >= 0 ? after : 0;
    const target = event.sender;
    const opened = await kernel.openFeed(from, (frame: FeedRelayFrame) => {
      if (mine === generation && !target.isDestroyed()) target.send(CHANNELS.feedFrame, frame);
    });
    if (mine !== generation) {
      // A later subscribe or an unsubscribe arrived while this one was opening.
      opened.handle?.close();
      return opened.state;
    }
    feed = opened.handle;
    return opened.state;
  });
  ipcMain.handle(CHANNELS.feedUnsubscribe, async (event) => {
    if (!fromOwner(event)) throw new Error("refused");
    closeFeed();
  });
}

/** The renderer may never navigate away, open a window, or be granted a permission. */
function lockDown(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

async function main(): Promise<void> {
  const kernel = createKernelConnection({
    dataDir: resolveDataDir(process.env),
    readToken: tokenReaderFor(process.env, app.isPackaged),
    // Reasons only: never a token or a response body.
    log: (line) => console.warn(`loomwright-studio: ${line}`),
  });
  let window: BrowserWindow | undefined;
  const shows = showsWindow(process.env, app.isPackaged);

  const createWindow = (): BrowserWindow => {
    const created = new BrowserWindow(windowOptions(join(app.getAppPath(), "dist-electron", "preload.cjs")));
    lockDown(created);
    // Hidden, the window's timers run unthrottled. Its frames do not on Linux: a never-mapped
    // X11 window renders about one frame a second, so the e2e harness shows it on Linux CI.
    if (shows) created.once("ready-to-show", () => created.show());
    else created.webContents.setBackgroundThrottling(false);
    created.on("closed", () => {
      if (window === created) window = undefined;
    });
    void created.loadFile(join(app.getAppPath(), "dist", "index.html"));
    window = created;
    return created;
  };
  const showWindow = (): void => {
    if (window === undefined) createWindow();
    else if (shows) window.show();
  };

  handleBridge(kernel, () => window?.webContents);
  registerDeepLinks({
    navigate: (route) => {
      showWindow();
      window?.webContents.send(CHANNELS.navigate, route);
    },
  });

  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) => decide(false));
  createTray({ kernel, showWindow });
  createWindow();
  // macOS: closing the window keeps the app (and, after item 17, the tray) running.
  app.on("activate", showWindow);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

main().catch((err: unknown) => {
  console.error(`loomwright-studio: could not start (${err instanceof Error ? err.name : "error"})`);
  app.quit();
});
