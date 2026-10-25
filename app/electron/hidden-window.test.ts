// The hidden-window pin: only an unpackaged run with the env set to exactly
// "1" hides the window; a packaged app always shows it.
import { describe, expect, it } from "vitest";
import { HIDDEN_WINDOW_ENV, hidesAppWindow, showsWindow } from "./hidden-window";

describe("showsWindow", () => {
  it("hides the window only in an unpackaged run with the env set to 1; a packaged app always shows it", () => {
    expect(showsWindow({}, false)).toBe(true);
    expect(showsWindow({ [HIDDEN_WINDOW_ENV]: "1" }, false)).toBe(false);
    expect(showsWindow({ [HIDDEN_WINDOW_ENV]: "true" }, false)).toBe(true);
    expect(showsWindow({ [HIDDEN_WINDOW_ENV]: "1" }, true)).toBe(true);
  });
});

describe("hidesAppWindow", () => {
  it("shows the app's window only on Linux CI (xvfb), where a never-mapped window renders about a frame a second", () => {
    expect(hidesAppWindow({ CI: "true" }, "linux")).toBe(false);
    expect(hidesAppWindow({ CI: "1" }, "linux")).toBe(false);
    expect(hidesAppWindow({}, "linux")).toBe(true);
    expect(hidesAppWindow({ CI: "" }, "linux")).toBe(true);
    expect(hidesAppWindow({ CI: "false" }, "linux")).toBe(true);
    expect(hidesAppWindow({ CI: "true" }, "darwin")).toBe(true);
    expect(hidesAppWindow({}, "darwin")).toBe(true);
  });
});
