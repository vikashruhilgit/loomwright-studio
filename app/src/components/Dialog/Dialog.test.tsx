/// <reference types="node" />
// @vitest-environment jsdom
// Dialog: the confirm (alertdialog) and decision (dialog, mono well, optional
// checkbox) kinds with exactly two action buttons; the focus trap, initial
// focus on the first non-destructive control and focus restore to the opener
// (AC3); Escape cancels a decision but never a destructive confirm (AC3); the
// inline gallery form; keyboard naming (AC8); and the token-only source and
// reduced-motion rules (AC7, AC9). CSS is read from disk with readFileSync,
// never `?raw`: vitest's css-disable plugin turns `*.css?raw` into "".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../Button/Button";
import { Dialog, type DialogKind } from "./Dialog";
import { states } from "./Dialog.states";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const css = read("./Dialog.css");

/** The declarations of the first top-level rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
}

const TABBABLE = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Presses Tab the way a browser does: dispatch keydown, and when nothing
 * prevented it, move focus to the next (or previous) tabbable in document
 * order, wrapping at the ends. jsdom does not move focus on Tab by itself.
 */
function tab(shift = false) {
  const active = (document.activeElement as HTMLElement | null) ?? document.body;
  const notPrevented = fireEvent.keyDown(active, { key: "Tab", shiftKey: shift });
  if (!notPrevented) return;
  const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE));
  const index = all.indexOf(active);
  const next = shift ? (index <= 0 ? all.length - 1 : index - 1) : (index + 1) % all.length;
  all[next]?.focus();
}

const activeElement = () => document.activeElement as HTMLElement;

function Harness({ kind, withCheckbox = false, onCancel = () => {} }: { kind: DialogKind; withCheckbox?: boolean; onCancel?: () => void }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const close = () => {
    onCancel();
    setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Elsewhere</button>
      {open ? (
        <Dialog
          kind={kind}
          title={kind === "confirm" ? "Kill everything?" : "Always allow for this playbook?"}
          description="Aborts 2 running sessions and disables all 4 triggers."
          payload={kind === "decision" ? "action: github.pr.review.post" : undefined}
          checkbox={withCheckbox ? { label: "Still ask when the review is blocking", checked, onChange: setChecked } : undefined}
          action={{ label: kind === "confirm" ? "Kill all" : "Always allow", kbd: "⌘⏎", onAction: () => setOpen(false) }}
          onCancel={close}
        />
      ) : null}
      <button type="button">After</button>
    </>
  );
}

function openWithKeyboard() {
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Dialog kinds (AC1)", () => {
  it("confirm is an alertdialog named by its question, with Cancel and a danger action only", () => {
    render(<Harness kind="confirm" />);
    openWithKeyboard();
    const dialog = screen.getByRole("alertdialog", { name: "Kill everything?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Aborts 2 running sessions and disables all 4 triggers.",
    );
    expect(dialog.querySelector(".dialog-icon")?.getAttribute("aria-hidden")).toBe("true");
    const buttons = Array.from(dialog.querySelectorAll(".dialog-actions button"));
    expect(buttons.map((b) => b.querySelector(".btn-label")?.textContent)).toEqual(["Cancel", "Kill all"]);
    expect(buttons[1]?.getAttribute("data-variant")).toBe("danger");
    expect(dialog.querySelectorAll("button")).toHaveLength(2);
  });

  it("a destructive confirm's Cancel shows no Esc chip, since Escape does not trigger it", () => {
    render(<Harness kind="confirm" />);
    openWithKeyboard();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel.querySelector("kbd")).toBeNull();
    expect(screen.getByRole("button", { name: "Kill all" }).querySelector("kbd")?.textContent).toBe("⌘⏎");
  });

  it("decision is a dialog with a mono well, an optional checkbox, Cancel (Esc) and the primary", () => {
    render(<Harness kind="decision" withCheckbox />);
    openWithKeyboard();
    const dialog = screen.getByRole("dialog", { name: "Always allow for this playbook?" });
    expect(dialog.querySelector(".dialog-icon")).toBeNull();
    const well = dialog.querySelector("pre.dialog-well");
    expect(well?.textContent).toBe("action: github.pr.review.post");
    expect(rule(".dialog-well")).toMatch(/font-family:\s*var\(--type-mono-family\)/);
    expect(rule(".dialog-well")).toMatch(/background:\s*var\(--surface-sunken\)/);

    const checkbox = screen.getByRole("checkbox", { name: "Still ask when the review is blocking" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    const actions = Array.from(dialog.querySelectorAll(".dialog-actions button"));
    expect(actions).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cancel" }).querySelector("kbd")?.textContent).toBe("Esc");
    expect(screen.getByRole("button", { name: "Always allow" }).getAttribute("data-variant")).toBe("primary");
  });

  it("is 360px (480px wide) on surface-raised, radius-lg, shadow-3, space-5, over the overlay", () => {
    const panel = rule(".dialog-panel");
    expect(panel).toMatch(/width:\s*360px/);
    expect(panel).toMatch(/background:\s*var\(--surface-raised\)/);
    expect(panel).toMatch(/border-radius:\s*var\(--radius-lg\)/);
    expect(panel).toMatch(/box-shadow:\s*var\(--shadow-3\)/);
    expect(panel).toMatch(/padding:\s*var\(--space-5\)/);
    expect(rule('.dialog-panel[data-wide="true"]')).toMatch(/width:\s*480px/);
    expect(rule(".dialog-overlay")).toMatch(/background:\s*var\(--overlay\)/);
    expect(rule(".dialog-icon")).toMatch(/background:\s*var\(--danger-soft\)/);
    expect(rule(".dialog-title")).toMatch(/font-size:\s*var\(--type-title-2-size\)/);
    expect(rule(".dialog-description")).toMatch(/color:\s*var\(--ink-secondary\)/);
  });

  it("opens on duration-slow ease-enter from scale 0.98 and closes on duration-fast", () => {
    expect(rule(".dialog-panel")).toMatch(/animation:\s*dialog-enter var\(--duration-slow\) var\(--ease-enter\)/);
    expect(css).toMatch(/@keyframes dialog-enter\s*\{\s*from\s*\{[^}]*transform:\s*scale\(0\.98\)/);
    expect(rule('.dialog-overlay[data-state="closing"] .dialog-panel')).toMatch(/animation:\s*dialog-exit var\(--duration-fast\)/);
  });

  it("open={false} removes the dialog (after its exit animation) and restores focus", () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>
            Toggle
          </button>
          <Dialog kind="decision" open={open} title="Allow?" description="Once." action={{ label: "Allow", onAction: () => setOpen(false) }} onCancel={() => setOpen(false)} />
        </>
      );
    }
    render(<Controlled />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Toggle" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "Allow?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(activeElement()).toBe(toggle);
  });
});

describe("Dialog focus (AC3)", () => {
  it("on open, focus lands on the first non-destructive control, never the danger primary", () => {
    render(<Harness kind="confirm" />);
    openWithKeyboard();
    expect(activeElement()).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(activeElement().getAttribute("data-variant")).not.toBe("danger");
  });

  it("on open, a decision with a checkbox focuses the checkbox (its first control)", () => {
    render(<Harness kind="decision" withCheckbox />);
    openWithKeyboard();
    expect(activeElement()).toBe(screen.getByRole("checkbox"));
  });

  it("skips a destructive control that comes first and focuses the next non-destructive one", () => {
    render(
      <Dialog kind="confirm" title="Delete the playbook?" description="Removes 1 playbook and its 2 triggers." action={{ label: "Delete", onAction: () => {} }} onCancel={() => {}}>
        <Button variant="danger">Delete its history too</Button>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Delete its history too" }).compareDocumentPosition(screen.getByRole("button", { name: "Cancel" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(activeElement()).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("Tab and Shift+Tab, pressed repeatedly, never leave the dialog", () => {
    render(<Harness kind="decision" withCheckbox />);
    openWithKeyboard();
    const dialog = screen.getByRole("dialog");
    const checkbox = screen.getByRole("checkbox");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const allow = screen.getByRole("button", { name: "Always allow" });

    const forward: HTMLElement[] = [];
    for (let i = 0; i < 7; i++) {
      tab();
      expect(dialog.contains(activeElement())).toBe(true);
      forward.push(activeElement());
    }
    expect(forward.slice(0, 4)).toEqual([cancel, allow, checkbox, cancel]);

    allow.focus();
    const backward: HTMLElement[] = [];
    for (let i = 0; i < 7; i++) {
      tab(true);
      expect(dialog.contains(activeElement())).toBe(true);
      backward.push(activeElement());
    }
    expect(backward.slice(0, 4)).toEqual([cancel, checkbox, allow, cancel]);
  });

  it("Tab on the last control wraps to the first; Shift+Tab on the first wraps to the last", () => {
    render(<Harness kind="confirm" />);
    openWithKeyboard();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const kill = screen.getByRole("button", { name: "Kill all" });
    kill.focus();
    tab();
    expect(activeElement()).toBe(cancel);
    tab(true);
    expect(activeElement()).toBe(kill);
  });

  it("focus that escapes (a programmatic focus outside) is pulled back into the dialog", () => {
    render(<Harness kind="decision" />);
    openWithKeyboard();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    expect(activeElement()).toBe(cancel);
  });

  it("closing with Cancel returns focus to the opener", () => {
    render(<Harness kind="confirm" />);
    const opener = openWithKeyboard();
    expect(activeElement()).not.toBe(opener);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(activeElement()).toBe(opener);
  });

  it("closing from an action handler returns focus to the opener", () => {
    render(<Harness kind="decision" />);
    const opener = openWithKeyboard();
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(activeElement()).toBe(opener);
  });

  it("Escape closes a decision through its cancel handler and returns focus to the opener", () => {
    const onCancel = vi.fn();
    render(<Harness kind="decision" onCancel={onCancel} />);
    const opener = openWithKeyboard();
    fireEvent.keyDown(activeElement(), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(activeElement()).toBe(opener);
  });

  it("Escape already handled by a control inside (preventDefault) does not cancel a decision", () => {
    const onCancel = vi.fn();
    render(
      <Dialog kind="decision" title="Rename the playbook?" description="Only its name changes." action={{ label: "Rename", onAction: () => {} }} onCancel={onCancel}>
        <input aria-label="Name" onKeyDown={(event) => event.key === "Escape" && event.preventDefault()} />
      </Dialog>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(activeElement()).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("with a real exit duration, focus returns at once while the inert panel plays out, then it unmounts", () => {
    vi.useFakeTimers();
    const computed = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
      const style = computed(el);
      return { ...style, getPropertyValue: (p: string) => (p === "animation-duration" ? "0.12s" : style.getPropertyValue(p)) } as CSSStyleDeclaration;
    });
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog kind="decision" open={open} title="Allow?" description="Once." action={{ label: "Allow", onAction: () => setOpen(false) }} onCancel={() => setOpen(false)} />
        </>
      );
    }
    render(<Controlled />);
    const opener = openWithKeyboard();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(activeElement()).toBe(opener);
    const overlay = document.querySelector(".dialog-overlay");
    expect(overlay?.getAttribute("data-state")).toBe("closing");
    expect(overlay?.hasAttribute("inert")).toBe(true);
    act(() => vi.advanceTimersByTime(119));
    expect(document.querySelector(".dialog-overlay")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector(".dialog-overlay")).toBeNull();
    spy.mockRestore();
  });

  it("Escape does not close a destructive confirm", () => {
    const onCancel = vi.fn();
    render(<Harness kind="confirm" onCancel={onCancel} />);
    openWithKeyboard();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.keyDown(activeElement(), { key: "Escape" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Kill everything?" })).toBeTruthy();
    expect(activeElement()).toBe(cancel);
  });
});

describe("Dialog inline (gallery containment)", () => {
  it("renders in flow with no overlay, no aria-modal, no focus move, and ignores Escape and Tab", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <div data-testid="frame">
        <Dialog inline kind="decision" title="Allow?" description="Once." action={{ label: "Allow", onAction: () => {} }} onCancel={onCancel} />
      </div>,
    );
    const dialog = screen.getByRole("dialog", { name: "Allow?" });
    expect(screen.getByTestId("frame").contains(dialog)).toBe(true);
    expect(container.ownerDocument.querySelector(".dialog-overlay")).toBeNull();
    expect(dialog.hasAttribute("aria-modal")).toBe(false);
    expect(activeElement()).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    const allow = screen.getByRole("button", { name: "Allow" });
    allow.focus();
    expect(fireEvent.keyDown(allow, { key: "Tab" })).toBe(true);
  });

  it("every gallery state is inline, static and has at most two named action buttons", () => {
    vi.useFakeTimers();
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
    expect(states.map((s) => s.id)).toEqual(expect.arrayContaining(["confirm", "decision"]));
    for (const state of states) {
      const { container, unmount } = render(state.render());
      act(() => vi.advanceTimersByTime(60_000));
      const panel = container.querySelector(".dialog-panel");
      expect(panel?.getAttribute("data-inline")).toBe("true");
      expect(document.querySelector(".dialog-overlay")).toBeNull();
      expect(activeElement()).toBe(document.body);
      const actions = Array.from(container.querySelectorAll(".dialog-actions button"));
      expect(actions.length).toBeLessThanOrEqual(2);
      for (const button of container.querySelectorAll("button")) expect(button.querySelector(".btn-label")?.textContent?.trim()).toBeTruthy();
      unmount();
    }
  });
});

describe("Dialog keyboard (AC8)", () => {
  it("every control is a native, named, tabbable control with a focus-visible ring", () => {
    render(<Harness kind="decision" withCheckbox />);
    openWithKeyboard();
    for (const control of [
      screen.getByRole("checkbox", { name: "Still ask when the review is blocking" }),
      screen.getByRole("button", { name: "Cancel" }),
      screen.getByRole("button", { name: "Always allow" }),
    ]) {
      expect(control.tabIndex).toBe(0);
    }
    expect(rule(".dialog-checkbox:focus-visible")).toMatch(/outline:\s*2px solid var\(--focus\)/);
  });
});

describe("Dialog source (AC7, AC9)", () => {
  const sources = { "Dialog.css": css, "Dialog.tsx": read("./Dialog.tsx"), "Dialog.states.tsx": read("./Dialog.states.tsx") };

  it.each(Object.entries(sources))("%s is non-empty and has no hard-coded colour", (_name, source) => {
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it("under prefers-reduced-motion, drops the scale and caps the opacity fades at duration-instant", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/\.dialog-panel\s*\{[^}]*animation-name:\s*dialog-fade-in/);
    expect(block).toMatch(/\.dialog-panel\s*\{[^}]*animation-duration:\s*var\(--duration-instant\)/);
    expect(block).toMatch(/\.dialog-panel\s*\{[^}]*transition-duration:\s*0s/);
    expect(block).toMatch(/\.dialog-overlay\[data-state="closing"\] \.dialog-panel\s*\{[^}]*animation-name:\s*dialog-fade-out[^}]*animation-duration:\s*var\(--duration-instant\)/);
    // The fades it switches to animate opacity only.
    for (const name of ["dialog-fade-in", "dialog-fade-out"]) {
      const frames = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\}\\s*\\}`).exec(css)?.[1] ?? "";
      expect(frames).toMatch(/opacity/);
      expect(frames).not.toMatch(/transform/);
    }
    for (const duration of block.matchAll(/(?:animation|transition)-duration:\s*([^;]+);/g)) {
      expect(["0s", "var(--duration-instant)"]).toContain(duration[1]?.trim());
    }
  });
});
