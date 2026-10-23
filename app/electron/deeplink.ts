// `loomwright-studio://` deep links (item 17): the kernel's notifications
// carry these links, and a click opens the app on that approval or thread,
// launching the window if it was closed.
//
// The scheme itself is registered by the packaged app's Info.plist
// (`CFBundleURLTypes`, from `build.protocols` in app/package.json), so
// LaunchServices routes it to `Loomwright Studio.app`. A deep link is
// untrusted input (invariant 3): it is mapped to an app route through a closed
// list (`parseDeepLink`) and never passed anywhere else. Only
// `notification/<id>` or `invalid-link` reaches the renderer; the raw URL never
// does, and a link is navigation only, never an action.
//
// Delivery order:
// - A link that arrives before `app.whenReady()` is held, and delivered on the
//   turn after ready (`setImmediate`), so `main.ts`'s own code after its
//   `await app.whenReady()` (which creates the window) has run first: a flush
//   inside `.then` would find no window, create one through `navigate`, and
//   `main.ts` would then create a second.
// - `navigate` sends straight after showing the window, so a window that is
//   still loading, or that `navigate` itself just created, may drop it. This
//   module waits for that window's `did-finish-load` and delivers then. Only
//   the no-window case can deliver a route twice (once on create, once after
//   load); the renderer drops the repeat.
import { BrowserWindow, app } from "electron";
import type { WebContents } from "electron";
import { navigateRouteFor, parseDeepLink } from "../src/screens/menubar/state";

/** The URL scheme the app registers. */
export const DEEP_LINK_SCHEME = "loomwright-studio";

export interface DeepLinkDeps {
  /** Open the main window on an app route (sent to the renderer's `api.onNavigate`). */
  readonly navigate: (route: string) => void;
}

/** A window that has loaded its page (one whose `loadFile` has not started yet has no URL, so it counts as loading). */
function isLoaded(contents: WebContents): boolean {
  return !contents.isLoading() && contents.getURL() !== "";
}

function liveWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}

/** Listens for deep links. Call before `app.whenReady()`: macOS sends the launch link before ready. */
export function registerDeepLinks(deps: DeepLinkDeps): void {
  let ready = false;
  /** The latest link from before ready: the one the user clicked last. */
  let held: string | undefined;

  const deliver = (route: string): void => {
    const window = liveWindow();
    if (window === undefined) {
      // `navigate` creates the window; its own send may be dropped, so send again once it has loaded.
      deps.navigate(route);
      const created = liveWindow();
      if (created !== undefined && !isLoaded(created.webContents)) created.webContents.once("did-finish-load", () => deps.navigate(route));
      return;
    }
    if (isLoaded(window.webContents)) {
      deps.navigate(route);
      return;
    }
    window.webContents.once("did-finish-load", () => deps.navigate(route));
  };

  app.on("open-url", (event, url) => {
    event.preventDefault();
    const route = navigateRouteFor(parseDeepLink(url));
    if (!ready) {
      held = route;
      return;
    }
    deliver(route);
  });

  const flush = (): void => {
    ready = true;
    const route = held;
    held = undefined;
    if (route !== undefined) deliver(route);
  };
  // Never a flush inside `.then`: `main.ts`'s code after its await must run first.
  void app.whenReady().then(() => setImmediate(flush));
}
