// @vitest-environment jsdom
// IconButton (phase 8 item 18d; docs/DESIGN.md "Tooltip"): the label is the accessible name and the tooltip's
// words; the tooltip is aria-hidden; the first Esc hides it (and stops there) until the pointer or focus leaves.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "./IconButton";

afterEach(cleanup);

describe("IconButton", () => {
  it("is a button named by its label, with the same words in an aria-hidden tooltip and a decorative icon", () => {
    const onClick = vi.fn();
    render(<IconButton icon="copy" label="Copy all text" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Copy all text" });
    expect(button.getAttribute("type")).toBe("button");
    const tip = screen.getByTestId("iconbtn-tip");
    expect(tip.textContent).toBe("Copy all text");
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Esc hides the tooltip until the pointer or focus leaves; only the first Esc stops at the button", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <IconButton icon="expand" label="Show full details" tipAlign="right" />
      </div>,
    );
    const button = screen.getByRole("button", { name: "Show full details" });
    expect(screen.getByTestId("iconbtn-tip").classList.contains("iconbtn-tip-right")).toBe(true);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button.classList.contains("iconbtn-tip-dismissed")).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(button);
    expect(button.classList.contains("iconbtn-tip-dismissed")).toBe(false);
    fireEvent.keyDown(button, { key: "Escape" });
    fireEvent.blur(button);
    expect(button.classList.contains("iconbtn-tip-dismissed")).toBe(false);
  });

  it("shows the ok colour once done (a copy's check)", () => {
    render(<IconButton icon="copied" label="Copy role.md" done />);
    expect(screen.getByRole("button", { name: "Copy role.md" }).classList.contains("iconbtn-done")).toBe(true);
    expect(screen.getByRole("button").querySelector("svg")?.dataset.icon).toBe("copied");
  });
});
