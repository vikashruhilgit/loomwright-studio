// The hidden-window pin: only an unpackaged run with the env set to exactly
// "1" hides the window; a packaged app always shows it.
import { describe, expect, it } from "vitest";
import { HIDDEN_WINDOW_ENV, showsWindow } from "./hidden-window";

describe("showsWindow", () => {
  it("hides the window only in an unpackaged run with the env set to 1; a packaged app always shows it", () => {
    expect(showsWindow({}, false)).toBe(true);
    expect(showsWindow({ [HIDDEN_WINDOW_ENV]: "1" }, false)).toBe(false);
    expect(showsWindow({ [HIDDEN_WINDOW_ENV]: "true" }, false)).toBe(true);
    expect(showsWindow({ [HIDDEN_WINDOW_ENV]: "1" }, true)).toBe(true);
  });
});
