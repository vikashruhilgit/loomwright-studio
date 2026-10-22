/// <reference types="node" />
// @vitest-environment jsdom
// Toast, ToastStack and Band: the toast (role="status", a StatusDot, one bold
// and one plain clause, at most one action, a named dismiss), the stack (at
// most three, older ones collapsed, fixed so it never moves content) and its
// 6 s auto-dismiss paused on hover (AC6, fake timers), the bands (danger is an
// alert, none auto-dismisses), keyboard naming (AC8), and the token-only source
// and reduced-motion rules (AC7, AC9). The limits are asserted as the literals
// 3 and 6000, never by importing the constants, so changing a constant fails
// here. CSS is read with readFileSync, never `?raw` (vitest empties `*.css?raw`).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Band, Toast, ToastStack, type ToastItem } from "./Toast";
import { states } from "./Toast.states";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const css = read("./Toast.css");

/** The declarations of every rule whose selector list ends with the line `selector`, concatenated. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g")), (match) => match[1] ?? "").join("\n");
}

const item = (n: number): ToastItem => ({
  id: `t${n}`,
  status: { state: "idle", label: "stopped" },
  title: `Session ${n} stopped.`,
  body: "The task stays.",
});

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast (AC1)", () => {
  it("is a status with a StatusDot, a bold clause then a plain clause, one accent action and a named dismiss", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toast
        duration={null}
        status={{ state: "waiting" }}
        title="Ada is waiting on you."
        body="Post review on PR 405?"
        action={{ label: "Review", onAction }}
        onDismiss={onDismiss}
      />,
    );
    const toast = screen.getByRole("status");
    expect(toast.querySelector(".status-dot")?.getAttribute("data-state")).toBe("waiting");
    expect(screen.getByRole("img", { name: "waiting on you" })).toBeTruthy();
    expect(toast.querySelector("b")?.textContent).toBe("Ada is waiting on you.");
    expect(toast.querySelector(".toast-text")?.textContent).toBe("Ada is waiting on you. Post review on PR 405?");

    const buttons = Array.from(toast.querySelectorAll("button"));
    expect(buttons).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("without an action has only the dismiss", () => {
    render(<Toast duration={null} status={{ state: "failed", label: "killed" }} title="Session killed." onDismiss={() => {}} />);
    const toast = screen.getByRole("status");
    expect(toast.querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("a verified ok shows its verification time beside the dot, the same rule as List and Card (AC5)", () => {
    render(<Toast duration={null} status={{ state: "ok", label: "enabled", verified: { at: "14:03" } }} title="Playbook enabled." onDismiss={() => {}} />);
    const toast = screen.getByRole("status");
    expect(toast.querySelector(".status-dot[data-state='ok']")).toBeTruthy();
    expect(toast.querySelector(".status-meta")?.textContent).toBe("· verified 14:03");
    expect(css).not.toMatch(/\.status-meta/);
  });

  it("an unverified ok shows the honest guess form, not an ok dot", () => {
    render(<Toast duration={null} status={{ state: "ok", label: "enabled" }} title="Playbook enabled." onDismiss={() => {}} />);
    const toast = screen.getByRole("status");
    expect(toast.querySelector(".status-dot")).toBeNull();
    expect(toast.querySelector(".status-guess")?.textContent).toBe("enabled");
  });

  it("is 360px on surface-raised with shadow-2; the action is accent, the dismiss ink-tertiary", () => {
    const toast = rule(".toast");
    expect(toast).toMatch(/width:\s*360px/);
    expect(toast).toMatch(/background:\s*var\(--surface-raised\)/);
    expect(toast).toMatch(/box-shadow:\s*var\(--shadow-2\)/);
    expect(rule(".toast-action")).toMatch(/color:\s*var\(--accent\)/);
    expect(rule(".toast-dismiss")).toMatch(/color:\s*var\(--ink-tertiary\)/);
  });

  it("enters on duration-base ease-enter and leaves on duration-fast ease-exit", () => {
    expect(rule(".toast")).toMatch(/animation:\s*toast-enter var\(--duration-base\) var\(--ease-enter\)/);
    expect(rule('.toast[data-state="leaving"]')).toMatch(/animation:\s*toast-leave var\(--duration-fast\) var\(--ease-exit\)/);
  });
});

describe("Toast auto-dismiss (AC6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("dismisses itself after 6 s", () => {
    const onDismiss = vi.fn();
    render(<Toast status={{ state: "idle" }} title="Session stopped." onDismiss={onDismiss} />);
    advance(5999);
    expect(onDismiss).not.toHaveBeenCalled();
    advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("a stacked toast is dismissed by id after 6000 ms", () => {
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[item(1)]} onDismiss={onDismiss} />);
    advance(6000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("hovering pauses the countdown; leaving resumes the time that was left", () => {
    const onDismiss = vi.fn();
    render(<Toast status={{ state: "idle" }} title="Session stopped." onDismiss={onDismiss} />);
    const toast = screen.getByRole("status");
    advance(2000);
    fireEvent.mouseEnter(toast);
    advance(6000 * 3);
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(toast);
    advance(3999);
    expect(onDismiss).not.toHaveBeenCalled();
    advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("focusing a control inside pauses the countdown too (nothing depends on hover)", () => {
    const onDismiss = vi.fn();
    render(<Toast status={{ state: "idle" }} title="Session stopped." onDismiss={onDismiss} />);
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    act(() => dismiss.focus());
    advance(6000 * 3);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => dismiss.blur());
    advance(6000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("moving focus between its own controls keeps it paused", () => {
    const onDismiss = vi.fn();
    render(<Toast status={{ state: "idle" }} title="Session stopped." action={{ label: "Undo", onAction: () => {} }} onDismiss={onDismiss} />);
    act(() => screen.getByRole("button", { name: "Undo" }).focus());
    act(() => screen.getByRole("button", { name: "Dismiss" }).focus());
    advance(6000 * 3);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismissing plays the leave animation once, then calls onDismiss once", () => {
    const computed = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
      const style = computed(el);
      return { ...style, getPropertyValue: (p: string) => (p === "animation-duration" ? "0.12s" : style.getPropertyValue(p)) } as CSSStyleDeclaration;
    });
    const onDismiss = vi.fn();
    render(<Toast duration={null} status={{ state: "idle" }} title="Session stopped." onDismiss={onDismiss} />);
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    fireEvent.click(dismiss);
    fireEvent.click(dismiss);
    expect(screen.getByRole("status").getAttribute("data-state")).toBe("leaving");
    advance(119);
    expect(onDismiss).not.toHaveBeenCalled();
    advance(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("duration={null} never auto-dismisses", () => {
    const onDismiss = vi.fn();
    render(<Toast duration={null} status={{ state: "idle" }} title="Session stopped." onDismiss={onDismiss} />);
    advance(6000 * 100);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("status").getAttribute("data-auto-dismiss")).toBe("off");
  });
});

describe("ToastStack (AC6)", () => {
  it("shows at most three toasts, the newest, and collapses the older ones", () => {
    render(<ToastStack duration={null} toasts={[1, 2, 3, 4, 5].map(item)} onDismiss={() => {}} />);
    const shown = screen.getAllByRole("status");
    expect(shown).toHaveLength(3);
    expect(shown.map((toast) => toast.querySelector("b")?.textContent)).toEqual(["Session 3 stopped.", "Session 4 stopped.", "Session 5 stopped."]);
    expect(screen.getByText("2 earlier")).toBeTruthy();
  });

  it("with three or fewer toasts shows them all and no collapsed line", () => {
    const { container } = render(<ToastStack duration={null} toasts={[1, 2, 3].map(item)} onDismiss={() => {}} />);
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(container.querySelector(".toast-collapsed")).toBeNull();
  });

  it("a collapsed toast surfaces when a slot frees", () => {
    const { rerender } = render(<ToastStack duration={null} toasts={[1, 2, 3, 4].map(item)} onDismiss={() => {}} />);
    expect(screen.queryByText("Session 1 stopped.")).toBeNull();
    rerender(<ToastStack duration={null} toasts={[1, 2, 3].map(item)} onDismiss={() => {}} />);
    expect(screen.getByText("Session 1 stopped.")).toBeTruthy();
  });

  it("is the persistent polite live region; each toast stays role=status but is silenced inside it", () => {
    const { rerender } = render(<ToastStack duration={null} toasts={[]} onDismiss={() => {}} />);
    const stack = screen.getByRole("region", { name: "Notifications" });
    expect(stack.getAttribute("aria-live")).toBe("polite");
    expect(stack.getAttribute("aria-relevant")).toBe("additions");
    rerender(<ToastStack duration={null} toasts={[item(1)]} onDismiss={() => {}} />);
    // Same node: the region existed before the toast arrived, so the arrival is announced.
    expect(screen.getByRole("region", { name: "Notifications" })).toBe(stack);
    const toast = screen.getByRole("status");
    expect(toast.getAttribute("aria-live")).toBe("off");
  });

  it("is a named region positioned fixed bottom-right, so toasts never move the main content", () => {
    render(<ToastStack toasts={[]} onDismiss={() => {}} />);
    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy();
    const stack = rule(".toast-stack");
    expect(stack).toMatch(/position:\s*fixed/);
    expect(stack).toMatch(/right:/);
    expect(stack).toMatch(/bottom:/);
    expect(stack).toMatch(/pointer-events:\s*none/);
  });
});

describe("Band (AC1)", () => {
  it("danger is an alert; parked and attention are statuses; each on its soft ground with its strong colour", () => {
    render(
      <>
        <Band tone="danger" action={{ label: "Kernel log", onAction: () => {} }}>
          Couldn't reach the kernel.
        </Band>
        <Band tone="parked">Paused at cap.</Band>
        <Band tone="attention">3 approvals waiting on you.</Band>
      </>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the kernel.");
    expect(screen.getAllByRole("status").map((band) => band.getAttribute("data-tone"))).toEqual(["parked", "attention"]);
    for (const tone of ["danger", "parked", "attention"]) {
      const body = rule(`.toast-band[data-tone="${tone}"]`);
      expect(body).toMatch(new RegExp(`background:\\s*var\\(--${tone}-soft\\)`));
      expect(body).toMatch(new RegExp(`color:\\s*var\\(--${tone}\\)`));
    }
    expect(rule(".toast-band")).toMatch(/width:\s*100%/);
    expect(screen.getByRole("button", { name: "Kernel log" })).toBeTruthy();
  });

  it("never auto-dismisses", () => {
    vi.useFakeTimers();
    render(<Band tone="danger">Couldn't reach the kernel.</Band>);
    advance(6000 * 100);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("Toast keyboard (AC8)", () => {
  it("the action and dismiss are native, named, tabbable buttons with a focus-visible ring", () => {
    const onAction = vi.fn();
    render(
      <>
        <Toast duration={null} status={{ state: "idle" }} title="Stopped." action={{ label: "Undo", onAction }} onDismiss={() => {}} />
        <Band tone="parked" action={{ label: "Show parked", onAction }}>
          Paused at cap.
        </Band>
      </>,
    );
    for (const name of ["Undo", "Dismiss", "Show parked"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.type).toBe("button");
      expect(button.tabIndex).toBe(0);
    }
    expect(css).toMatch(/\.toast-action:focus-visible,\s*\.toast-dismiss:focus-visible,\s*\.toast-band-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  });
});

describe("Toast focus hand-off (AC8)", () => {
  function Stack({ initial, onAction }: { readonly initial: readonly ToastItem[]; readonly onAction?: (id: string) => void }) {
    const [toasts, setToasts] = useState<readonly ToastItem[]>(initial);
    const drop = (id: string) => setToasts((prev) => prev.filter((toast) => toast.id !== id));
    return (
      <>
        <button type="button">Origin</button>
        <ToastStack
          duration={null}
          toasts={toasts.map((toast) =>
            onAction ? { ...toast, action: { label: `Undo ${toast.id}`, onAction: () => (onAction(toast.id), drop(toast.id)) } } : toast,
          )}
          onDismiss={drop}
        />
      </>
    );
  }

  it("dismissing the focused toast with the keyboard focuses the adjacent toast's dismiss, never <body>", () => {
    render(<Stack initial={[item(1), item(2)]} />);
    const [first, second] = screen.getAllByRole("button", { name: "Dismiss" });
    if (!first || !second) throw new Error("two dismiss buttons");
    act(() => second.focus());
    fireEvent.keyDown(second, { key: "Enter" });
    fireEvent.click(second);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.activeElement).toBe(first);
  });

  it("dismissing the last focused toast returns focus to where it came from", () => {
    render(<Stack initial={[item(1)]} />);
    const origin = screen.getByRole("button", { name: "Origin" });
    act(() => origin.focus());
    const dismiss = screen.getByRole("button", { name: "Dismiss" });
    act(() => dismiss.focus());
    fireEvent.click(dismiss);
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(document.activeElement).toBe(origin);
  });

  it("the origin survives a chain: dismissing two toasts in turn ends back at the origin", () => {
    render(<Stack initial={[item(1), item(2)]} />);
    const origin = screen.getByRole("button", { name: "Origin" });
    act(() => origin.focus());
    const second = screen.getAllByRole("button", { name: "Dismiss" })[1];
    if (!second) throw new Error("second dismiss");
    act(() => second.focus());
    fireEvent.click(second);
    const remaining = screen.getByRole("button", { name: "Dismiss" });
    expect(document.activeElement).toBe(remaining);
    fireEvent.click(remaining);
    expect(document.activeElement).toBe(origin);
  });

  it("a toast the caller removes while it holds focus (its action) hands focus on too", () => {
    const onAction = vi.fn();
    render(<Stack initial={[item(1), item(2)]} onAction={onAction} />);
    const undo = screen.getByRole("button", { name: "Undo t2" });
    act(() => undo.focus());
    fireEvent.click(undo);
    expect(onAction).toHaveBeenCalledWith("t2");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Dismiss" }));
  });

  it("calls onDismiss exactly once when the hand-off moves focus away mid-leave", () => {
    vi.useFakeTimers();
    const computed = window.getComputedStyle.bind(window);
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
      const style = computed(el);
      return { ...style, getPropertyValue: (p: string) => (p === "animation-duration" ? "0.12s" : style.getPropertyValue(p)) } as CSSStyleDeclaration;
    });
    const onDismiss = vi.fn();
    render(
      <>
        <Toast status={{ state: "idle" }} title="One." onDismiss={() => {}} />
        <Toast status={{ state: "idle" }} title="Two." onDismiss={onDismiss} />
      </>,
    );
    const second = screen.getAllByRole("button", { name: "Dismiss" })[1];
    if (!second) throw new Error("second dismiss");
    act(() => second.focus());
    fireEvent.click(second);
    // Focus left the leaving toast; its blur must not restart the 6 s timer.
    advance(6000 * 3);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("Toast gallery states (containment)", () => {
  it("every state renders statically: auto-dismiss off and the stack inside a transform frame", () => {
    vi.useFakeTimers();
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
    expect(states.map((s) => s.id)).toEqual(expect.arrayContaining(["toasts", "stack", "band-danger", "band-parked", "band-attention"]));
    for (const state of states) {
      const { container, unmount } = render(state.render());
      const toasts = Array.from(container.querySelectorAll(".toast"));
      for (const toast of toasts) expect(toast.getAttribute("data-auto-dismiss")).toBe("off");
      advance(6000 * 10);
      expect(container.querySelectorAll(".toast")).toHaveLength(toasts.length);
      for (const toast of container.querySelectorAll(".toast")) expect(toast.getAttribute("data-state")).toBe("open");
      const stack = container.querySelector<HTMLElement>(".toast-stack");
      if (stack) {
        const frame = stack.parentElement as HTMLElement;
        expect(frame.style.position).toBe("relative");
        expect(frame.style.transform).toBe("translateZ(0)");
        expect(stack.querySelectorAll(".toast")).toHaveLength(3);
      }
      for (const button of container.querySelectorAll("button")) {
        expect((button.getAttribute("aria-label") ?? button.textContent ?? "").trim()).toBeTruthy();
      }
      unmount();
    }
  });
});

describe("component CSS vs the shell's app.css", () => {
  // Every component's classes carry its own prefix; none may reuse a class the
  // shell's global stylesheet styles (Toast's Band once used `.band`).
  const classesOf = (source: string) => new Set(Array.from(source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([a-zA-Z][\w-]*)/g), (m) => m[1]));
  const shell = classesOf(read("../../styles/app.css"));
  const dirs = readdirSync(join(dirname(fileURLToPath(import.meta.url)), ".."), { withFileTypes: true }).filter((entry) => entry.isDirectory());

  it("finds the shell's classes and every component stylesheet", () => {
    expect(shell.has("band")).toBe(true);
    expect(dirs.length).toBeGreaterThanOrEqual(8);
  });

  it.each(dirs.map((entry) => entry.name))("%s.css shares no class with app.css", (name) => {
    const own = classesOf(read(`../${name}/${name}.css`));
    expect([...own].filter((cls) => shell.has(cls))).toEqual([]);
  });
});

describe("Toast source (AC7, AC9)", () => {
  const sources = { "Toast.css": css, "Toast.tsx": read("./Toast.tsx"), "Toast.states.tsx": read("./Toast.states.tsx") };

  it.each(Object.entries(sources))("%s is non-empty and has no hard-coded colour", (_name, source) => {
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it("under prefers-reduced-motion, toasts only fade, capped at duration-instant", () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
    expect(block).toMatch(/\.toast\s*\{[^}]*animation-name:\s*toast-fade-in[^}]*animation-duration:\s*var\(--duration-instant\)/);
    expect(block).toMatch(/\.toast\[data-state="leaving"\]\s*\{[^}]*animation-name:\s*toast-fade-out[^}]*animation-duration:\s*var\(--duration-instant\)/);
    for (const name of ["toast-fade-in", "toast-fade-out"]) {
      const frames = new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\}\\s*\\}`).exec(css)?.[1] ?? "";
      expect(frames).toMatch(/opacity/);
      expect(frames).not.toMatch(/transform/);
    }
    for (const duration of block.matchAll(/(?:animation|transition)-duration:\s*([^;]+);/g)) {
      expect(["0s", "var(--duration-instant)"]).toContain(duration[1]?.trim());
    }
  });
});
