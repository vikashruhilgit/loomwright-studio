// The e2e hidden-window seam: one definition, imported by the main process
// and by the e2e harness (app/e2e/electron-harness.ts), so the two can never
// disagree on the name. No `electron` import, so plain Node can load it.

/** Set to "1" by the e2e harness so a test run never shows the window (except on Linux CI: `hidesAppWindow`). */
export const HIDDEN_WINDOW_ENV = "STUDIO_APP_HIDDEN_WINDOW";

/** Whether the app shows its window: always when packaged; an unpackaged run hides it only under `HIDDEN_WINDOW_ENV`. */
export function showsWindow(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): boolean {
  return isPackaged || env[HIDDEN_WINDOW_ENV] !== "1";
}

/**
 * Whether the e2e harness hides the app's window: everywhere but Linux CI. There
 * xvfb is the screen, so a shown window takes no one's focus, and a hidden one
 * must not be used: an X11 window that was never mapped renders about one frame
 * a second (setBackgroundThrottling(false) does not lift it), so each wheel event
 * and animation frame costs a second and a scrolling test blows its timeout.
 */
export function hidesAppWindow(env: Readonly<Record<string, string | undefined>>, platform: string): boolean {
  const ci = env.CI !== undefined && env.CI !== "" && env.CI !== "false";
  return !(platform === "linux" && ci);
}
