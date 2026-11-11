// The Electron main process: thin on purpose (D10). It owns the window, the
// kernel connection (api.json, the pid check, the Keychain token), the tray
// and the `loomwright-studio://` scheme. The renderer reaches the kernel only
// through the preload's `window.api`, and every API call is made here, so the
// token never enters the renderer, which is the surface that renders
// untrusted text (invariant 3).
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, session, shell } from "electron";
import type { BrowserWindowConstructorOptions, IpcMainInvokeEvent, OpenDialogOptions, WebContents } from "electron";
import type { ApiRequest, FeedRelayFrame, KernelLogReveal } from "../src/api/contract";
import { CHANNELS } from "./channels";
import { registerDeepLinks } from "./deeplink";
import { showsWindow } from "./hidden-window";
import { createKernelConnection, resolveDataDir, tokenReaderFor } from "./kernel-connection";
import type { FeedHandle, KernelConnection } from "./kernel-connection";
import { NO_KERNEL_URLS, isAllowedExternal, rememberKernelUrl } from "./open-external";
import type { KernelUrls } from "./open-external";
import { createPreferences } from "./settings";
import type { Preferences } from "./settings";
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

/**
 * The kernel service's own log, under the data dir. Mirrors `STDERR_LOG_FILENAME` in `kernel/src/service/launchd.ts`
 * (kept under `<dataDir>/logs/`); the app does not import kernel sources.
 */
const KERNEL_LOG_FILE = join("logs", "kernel.err.log");

/** Wires the bridge's channels to `kernel`, answering only `owner`'s window. */
function handleBridge(kernel: KernelConnection, prefs: Preferences, dataDir: string, owner: () => WebContents | undefined): void {
  const fromOwner = (event: IpcMainInvokeEvent): boolean => event.sender === owner();
  let feed: FeedHandle | undefined;
  // The addresses the kernel itself answered (an MCP authorize URL, the App upgrade URL): the open-external
  // allowlist's one dynamic input. Recorded from the request handler, read by the open handler.
  let kernelUrls: KernelUrls = NO_KERNEL_URLS;
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
    const result = await kernel.request(request);
    // Record the answer, never alter it: the renderer gets exactly what the kernel said.
    kernelUrls = rememberKernelUrl(kernelUrls, request, result, Date.now());
    return result;
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
  // The one way out to the system browser. It answers `false` (never throws) for anything off the
  // allowlist, and for a kernel that is not connected, because the kernel's start page is only valid
  // on the port the kernel has now. The address is re-checked here and never trusted from the renderer.
  ipcMain.handle(CHANNELS.openExternal, async (event, url: unknown) => {
    if (!fromOwner(event)) throw new Error("refused");
    if (typeof url !== "string") return false;
    const where = await kernel.connection();
    if (where.state !== "connected") return false;
    if (!isAllowedExternal(url, where.port, kernelUrls, Date.now())) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      // Reasons only: never the address, whose query carries the setup `state`.
      console.warn("loomwright-studio: could not open the system browser");
      return false;
    }
  });
  // The app's own preferences (`settings.ts`). `set` validates its patch; Reveal takes no argument at all,
  // so a path from the renderer is never opened: the main process opens the data dir it resolved itself.
  ipcMain.handle(CHANNELS.prefsGet, async (event) => {
    if (!fromOwner(event)) throw new Error("refused");
    return prefs.get();
  });
  ipcMain.handle(CHANNELS.prefsSet, async (event, patch: unknown) => {
    if (!fromOwner(event)) throw new Error("refused");
    return prefs.set(patch);
  });
  ipcMain.handle(CHANNELS.revealDataDir, async (event) => {
    if (!fromOwner(event)) throw new Error("refused");
    return prefs.revealDataDir();
  });
  // Argument-free like Reveal: the path is the main process's own (`<dataDir>/logs/kernel.err.log`), never one from
  // the renderer. A log that is not there is answered, not revealed (there is nothing for Finder to select).
  ipcMain.handle(CHANNELS.revealKernelLog, async (event): Promise<KernelLogReveal> => {
    if (!fromOwner(event)) throw new Error("refused");
    const path = join(dataDir, KERNEL_LOG_FILE);
    try {
      if (!(await stat(path)).isFile()) return "missing";
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (code === "ENOENT" || code === "ENOTDIR") return "missing";
      // Reasons only: never the path.
      console.warn("loomwright-studio: could not read the kernel log");
      return "failed";
    }
    shell.showItemInFolder(path);
    return "revealed";
  });
  // Read-only and argument-free: the main process answers its own home folder, never a path from the renderer.
  ipcMain.handle(CHANNELS.homeDir, async (event) => {
    if (!fromOwner(event)) throw new Error("refused");
    return app.getPath("home");
  });
  // The owner's folder picker (phase 8 item 18c), argument-free like the home folder: whatever the renderer sends is
  // dropped. A choose-a-folder sheet on the owner's window; it answers the chosen absolute path, or `null` when the
  // owner cancels. The renderer never reads the disk: the kernel checks the folder when the path is saved. A dialog
  // that can't be shown rejects, so the renderer says so instead of reading it as a cancel.
  ipcMain.handle(CHANNELS.chooseFolder, async (event): Promise<string | null> => {
    if (!fromOwner(event)) throw new Error("refused");
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(parent, options);
    const [chosen] = result.filePaths;
    return result.canceled || chosen === undefined || !isAbsolute(chosen) ? null : chosen;
  });
}

/** The renderer may never navigate away, open a window, or be granted a permission. */
function lockDown(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

async function main(): Promise<void> {
  const dataDir = resolveDataDir(process.env);
  const kernel = createKernelConnection({
    dataDir,
    readToken: tokenReaderFor(process.env, app.isPackaged),
    // Reasons only: never a token or a response body.
    log: (line) => console.warn(`loomwright-studio: ${line}`),
  });
  const prefs = createPreferences({ env: process.env, isPackaged: app.isPackaged, dataDir });
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

  handleBridge(kernel, prefs, dataDir, () => window?.webContents);
  registerDeepLinks({
    navigate: (route) => {
      showWindow();
      window?.webContents.send(CHANNELS.navigate, route);
    },
  });

  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) => decide(false));
  // The theme goes on before any window exists, so the first paint is already in the owner's theme.
  await prefs.load();
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
