// The e2e hidden-window seam: one definition, imported by the main process
// and by the e2e harness (app/e2e/electron-harness.ts), so the two can never
// disagree on the name. No `electron` import, so plain Node can load it.

/** Set to "1" by the e2e harness so a test run never shows the window. */
export const HIDDEN_WINDOW_ENV = "STUDIO_APP_HIDDEN_WINDOW";

/** Whether the app shows its window: always when packaged; an unpackaged run hides it only under `HIDDEN_WINDOW_ENV`. */
export function showsWindow(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): boolean {
  return isPackaged || env[HIDDEN_WINDOW_ENV] !== "1";
}
