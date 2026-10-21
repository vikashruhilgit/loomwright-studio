// `window.api`, the preload's one key (app/electron/preload.ts). The renderer
// has no other way to the kernel: no Node, no fetch to the loopback API (the
// page's CSP sets `connect-src 'none'`), and never the token.
import type { StudioBridge } from "./contract";

declare global {
  interface Window {
    readonly api: StudioBridge;
  }
}

/** The bridge, read at call time (a test installs a fake on `window.api`). */
export function getBridge(): StudioBridge {
  return window.api;
}
