// `loomwright-studio://` deep links: a stub. Phase 5 item 17 builds it: the
// kernel's notifications carry these links, and a click opens the app on that
// approval or thread, launching it if it was closed.
//
// The scheme itself is registered by the packaged app's Info.plist
// (`CFBundleURLTypes`, from `build.protocols` in app/package.json), so
// LaunchServices routes it to `Loomwright Studio.app`. A deep link is
// untrusted input (invariant 3): item 17 maps it to an app route through a
// closed list and never passes it anywhere else.

/** The URL scheme the app registers. */
export const DEEP_LINK_SCHEME = "loomwright-studio";

export interface DeepLinkDeps {
  /** Open the main window on an app route (sent to the renderer's `api.onNavigate`). */
  readonly navigate: (route: string) => void;
}

/** Listens for deep links. Stub: listens for nothing yet (item 17). */
export function registerDeepLinks(_deps: DeepLinkDeps): void {
  // Item 17.
}
