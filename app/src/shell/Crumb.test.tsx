// @vitest-environment jsdom
// The shared Back crumb "‹ Parent / Current": one focusable button named "Back to <parent>" that
// holds the chevron (the icon set's `back`) and the parent's name; a hidden `/` and the current
// name, plain text, follow it. The copy is pinned here on its own (not imported from the component).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Crumb } from "./Crumb";

afterEach(cleanup);

function draw(onBack: () => void = () => undefined) {
  return render(<Crumb parent="Budget & audit" current="Audit log" onBack={onBack} className="demo-crumb" glyphClassName="demo-glyph" testId="demo-back" />);
}

/** Every element a keyboard can reach. */
function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'));
}

describe("Crumb", () => {
  it("reads '‹ Budget & audit / Audit log' with no 'Back' word and no '·'", () => {
    const { container } = draw();
    const crumb = container.firstElementChild;
    if (crumb === null) throw new Error("no crumb");
    expect(crumb.className).toBe("demo-crumb");
    expect(crumb.textContent).toBe("Budget & audit/Audit log");
    expect(crumb.textContent).not.toContain("Back");
    expect(crumb.textContent).not.toContain("·");
  });

  it("is one focusable button whose accessible name is 'Back to Budget & audit'", () => {
    const { container } = draw();
    const reached = focusable(container);
    expect(reached).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const back = screen.getByRole("button", { name: "Back to Budget & audit" });
    expect(back.tagName).toBe("BUTTON");
    expect(reached).toEqual([back]);
    expect(back.getAttribute("data-testid")).toBe("demo-back");
    // The visible label is inside the name (label-in-name).
    expect(back.textContent).toContain("Budget & audit");
    expect(back.textContent).not.toContain("Audit log");
  });

  it("calls onBack once when it is activated (Enter on a button is a click)", () => {
    const onBack = vi.fn();
    draw(onBack);
    const back = screen.getByRole("button", { name: "Back to Budget & audit" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("draws the chevron with the icon set's back icon, decorative and in the caller's class", () => {
    const { container } = draw();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    const svg = container.querySelector("svg");
    if (svg === null) throw new Error("no svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).toBe("demo-glyph");
    expect(svg.innerHTML).toBe('<path d="m15 18-6-6 6-6"></path>');
    // The chevron is inside the button, so it is one control.
    expect(screen.getByRole("button").contains(svg)).toBe(true);
  });

  it("hides the '/' separator and leaves the current name as plain, unfocusable text", () => {
    const { container } = draw();
    const slash = Array.from(container.querySelectorAll("span")).find((s) => s.textContent === "/");
    expect(slash?.getAttribute("aria-hidden")).toBe("true");
    const current = screen.getByText("Audit log");
    expect(current.tagName).toBe("SPAN");
    expect(current.closest("button")).toBeNull();
    expect(current.hasAttribute("tabindex")).toBe(false);
    expect(focusable(container)).not.toContain(current);
  });

  it("hands its ref to the button, so a screen can focus it", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Crumb ref={ref} parent="Budget & audit" current="Audit log" onBack={() => undefined} className="demo-crumb" glyphClassName="demo-glyph" />);
    expect(ref.current).toBe(screen.getByRole("button", { name: "Back to Budget & audit" }));
    expect(ref.current?.hasAttribute("data-testid")).toBe(false);
  });

  it("names another parent from its own prop", () => {
    render(<Crumb parent="Tasks" current="Task #1" onBack={() => undefined} className="demo-crumb" glyphClassName="demo-glyph" />);
    expect(screen.getByRole("button", { name: "Back to Tasks" }).textContent).toBe("Tasks");
  });
});
