// @vitest-environment jsdom
// Skeleton and Glyph take the screen's class prefix, so a screen keeps its own stylesheet hooks.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Glyph, WarnGlyph } from "./Glyph";
import { Skeleton } from "./Skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("renders four rows under the caller's prefix with a status line", () => {
    render(<Skeleton prefix="demo" testId="sk" what="usage" />);
    const root = screen.getByTestId("sk");
    expect(root.className).toBe("demo-skels");
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.querySelectorAll(".demo-skel")).toHaveLength(4);
    expect(screen.getByRole("status").textContent).toBe("Loading usage");
    expect(screen.getByRole("status").className).toBe("demo-sr-only");
  });
});

describe("Glyph", () => {
  it("is decorative and carries the caller's class", () => {
    const { container } = render(
      <>
        <Glyph className="demo-glyph">
          <path d="M0 0" />
        </Glyph>
        <WarnGlyph className="demo-glyph" />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    svgs.forEach((s) => {
      expect(s.getAttribute("class")).toBe("demo-glyph");
      expect(s.getAttribute("aria-hidden")).toBe("true");
    });
  });
});
