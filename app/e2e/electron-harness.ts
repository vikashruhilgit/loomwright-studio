// The one way an e2e spec starts Electron, with every window hidden. A
// visible window takes focus on macOS each time a spec launches it, and the
// suites relaunch often (Linux CI hides this under xvfb, so only a local run
// shows it). Playwright drives, reads and screenshots a hidden window the same
// as a shown one. `scripts/hidden-windows.test.ts` fails any spec that calls
// `electron.launch` or `new BrowserWindow` itself.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { HIDDEN_WINDOW_ENV } from "../electron/hidden-window";

export const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

/** This process's environment without its unset keys, the shape `electron.launch({ env })` takes. */
export function processEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return env;
}

/** Launches the built app (`npm run build` first) with its window hidden. */
export async function launchApp(env: Readonly<Record<string, string>>): Promise<ElectronApplication> {
  return electron.launch({ args: [APP_DIR], cwd: APP_DIR, env: { ...env, [HIDDEN_WINDOW_ENV]: "1" } });
}

export type GalleryTarget = { readonly url: string } | { readonly file: string };

export interface Gallery {
  readonly app: ElectronApplication;
  readonly page: Page;
  /** Closes the app and removes the throwaway main. */
  close(): Promise<void>;
}

// A bare window over a gallery page: hidden, sandboxed, no preload, nothing
// exposed. Not throttled while hidden, so timers and animation frames run as
// they would on screen.
const GALLERY_MAIN = `const { app, BrowserWindow } = require("electron");
const gallery = JSON.parse(process.env.E2E_GALLERY);
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: gallery.width,
    height: gallery.height,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  void (gallery.url !== undefined ? win.loadURL(gallery.url) : win.loadFile(gallery.file));
});
app.on("window-all-closed", () => app.quit());
`;

/** Opens `target` (a URL or a built HTML file) in one hidden window of the given size. */
export async function launchGallery(
  target: GalleryTarget,
  size: { readonly width: number; readonly height: number },
): Promise<Gallery> {
  const dir = mkdtempSync(join(tmpdir(), "studio-e2e-gallery-"));
  const main = join(dir, "main.cjs");
  writeFileSync(main, GALLERY_MAIN);
  const env = { ...processEnv(), E2E_GALLERY: JSON.stringify({ ...target, ...size }) };
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [main], cwd: APP_DIR, env });
    const page = await app.firstWindow();
    const launched = app;
    return {
      app: launched,
      page,
      close: async () => {
        await launched.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}
