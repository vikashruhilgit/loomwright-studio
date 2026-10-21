// The menu-bar tray: a stub. Phase 5 item 17 builds it (the status ring,
// Pause all, the kill switch, Quit). The lifecycle the owner chose: closing
// the window leaves the tray running, Quit is in the tray, and there is no
// autostart. Until item 17 lands, the app keeps the macOS default (closing
// the window does not quit; Quit is in the app menu).
import type { KernelConnection } from "./kernel-connection";

export interface TrayDeps {
  /** The main process's kernel connection (the tray's calls go through it, like every call). */
  readonly kernel: KernelConnection;
  /** Show (or create) the main window. */
  readonly showWindow: () => void;
}

/** Creates the tray. Stub: creates nothing yet (item 17). */
export function createTray(_deps: TrayDeps): void {
  // Item 17.
}
