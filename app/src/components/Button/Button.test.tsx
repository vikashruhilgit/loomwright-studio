/// <reference types="node" />
// @vitest-environment jsdom
// Button: the README's four variants, two sizes, disabled, loading and kbd
// chip; keyboard reach and naming; and the token-only source rule (AC7, AC9).
// CSS is read from disk with readFileSync, never `?raw`: vitest's css-disable
// plugin turns `*.css?raw` into an empty string, which would make this vacuous.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, type ButtonVariant } from "./Button";
import { states } from "./Button.states";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const css = read("./Button.css");

/** The declarations of the first top-level rule whose selector list is exactly `selector`. */
function ruleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  if (!match?.[1]) throw new Error(`no rule for ${selector}`);
  return match[1];
}

afterEach(cleanup);

describe("Button", () => {
  it.each<[ButtonVariant]>([["primary"], ["secondary"], ["ghost"], ["danger"]])("renders the %s variant", (variant) => {
    render(<Button variant={variant}>Enable playbook</Button>);
    const button = screen.getByRole("button", { name: "Enable playbook" });
    expect(button.getAttribute("data-variant")).toBe(variant);
    expect(ruleBody(css, `.btn[data-variant="${variant}"]`)).toMatch(/color:\s*var\(--/);
  });

  it("has two sizes: 32px standalone (control-height) and 28px in rows (row-height)", () => {
    render(
      <>
        <Button>Standalone</Button>
        <Button size="row">In a row</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Standalone" }).getAttribute("data-size")).toBe("standalone");
    expect(screen.getByRole("button", { name: "In a row" }).getAttribute("data-size")).toBe("row");
    expect(ruleBody(css, ".btn")).toMatch(/height:\s*var\(--control-height\)/);
    expect(ruleBody(css, '.btn[data-size="row"]')).toMatch(/height:\s*var\(--row-height\)/);
  });

  it("disabled uses the native attribute, keeps its label and does not fire", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Stop
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Stop");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(css).toMatch(/\.btn:disabled[^{]*\{[^}]*color:\s*var\(--ink-disabled\)[^}]*background:\s*var\(--surface-sunken\)/);
  });

  it("loading sets aria-busy, swaps the icon for the spinner and keeps the label", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button icon={<svg data-testid="plus" />} onClick={onClick}>
        New agent
      </Button>,
    );
    expect(screen.getByTestId("plus")).toBeTruthy();
    expect(screen.queryByTestId("btn-spinner")).toBeNull();
    expect(screen.getByRole("button", { name: "New agent" }).getAttribute("aria-busy")).toBeNull();

    rerender(
      <Button icon={<svg data-testid="plus" />} onClick={onClick} loading>
        New agent
      </Button>,
    );
    const button = screen.getByRole("button", { name: "New agent" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("btn-spinner")).toBeTruthy();
    expect(screen.queryByTestId("plus")).toBeNull();
    expect(button.textContent).toBe("New agent");
    // Still focusable (not natively disabled) but inert to clicks while busy.
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows an optional kbd chip after the label without changing the accessible name", () => {
    render(
      <Button variant="danger" kbd="⌘⇧K" aria-keyshortcuts="Meta+Shift+K">
        Kill
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Kill" });
    const kbd = button.querySelector("kbd");
    expect(kbd?.textContent).toBe("⌘⇧K");
    expect(button.lastElementChild).toBe(kbd);
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+K");
  });

  it("is a native type=button, reachable with Tab, with the focus ring on :focus-visible", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Send</Button>);
    const button = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    // A native <button> is activated by Enter and Space by the platform.
    expect(button.tagName).toBe("BUTTON");
    expect(button.type).toBe("button");
    expect(button.tabIndex).toBe(0);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(ruleBody(css, ".btn:focus-visible")).toMatch(/outline:\s*2px solid var\(--focus\)/);
  });

  it("renders every gallery state with a named button", () => {
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
    for (const state of states) {
      const { unmount } = render(state.render());
      for (const button of screen.getAllByRole("button")) expect(button.textContent?.trim()).not.toBe("");
      unmount();
    }
  });
});

describe("Button source (AC7, AC9)", () => {
  const sources = { "Button.css": css, "Button.tsx": read("./Button.tsx"), "Button.states.tsx": read("./Button.states.tsx") };

  it.each(Object.entries(sources))("%s is non-empty and has no hard-coded colour", (_name, source) => {
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it("zeroes transitions and stops the spinner under prefers-reduced-motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/\.btn\s*\{[^}]*transition-duration:\s*0s/);
    expect(block).toMatch(/\.btn-spinner\s*\{[^}]*animation:\s*none/);
  });
});
