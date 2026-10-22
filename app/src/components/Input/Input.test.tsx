/// <reference types="node" />
// @vitest-environment jsdom
// Input: text, search (leading icon, trailing kbd hint), select (trailing
// chevron) and the composer; the visible label above every non-composer
// field, the hint, and the error wiring (aria-invalid + aria-describedby at the
// rendered message); composer keys (Enter sends, Shift+Enter is a newline),
// growth and streaming; and the token-only source rule (AC7, AC9). CSS is read
// from disk with readFileSync, never `?raw` (vitest's css-disable plugin empties it).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer, SelectField, TextField } from "./Input";
import { states } from "./Input.states";

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const css = read("./Input.css");
const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
};

/** The ids an element's aria-describedby points at, resolved to their text. */
function descriptions(element: HTMLElement): string[] {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? `<missing #${id}>`);
}

afterEach(cleanup);

describe("TextField", () => {
  it("renders a visible label above the field, wired with htmlFor/id", () => {
    const { container } = render(<TextField id="agent-name" label="Agent name" defaultValue="Mason" />);
    const input = screen.getByRole("textbox", { name: "Agent name" }) as HTMLInputElement;
    expect(input.id).toBe("agent-name");
    expect(input.value).toBe("Mason");
    const label = container.querySelector("label");
    expect(label?.htmlFor).toBe("agent-name");
    expect(label?.compareDocumentPosition(input) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(rule(".field-label")).toMatch(/color:\s*var\(--ink-tertiary\)/);
    expect(rule(".field-label")).toMatch(/font-size:\s*var\(--type-label-size\)/);
  });

  it("generates an id when none is given", () => {
    render(<TextField label="Agent name" />);
    expect(screen.getByRole("textbox", { name: "Agent name" }).id).not.toBe("");
  });

  it("shows an optional hint under the field, described by it", () => {
    render(<TextField id="agent-name" label="Agent name" hint="Shown in chat and in the menu bar." />);
    expect(descriptions(screen.getByRole("textbox", { name: "Agent name" }))).toEqual(["Shown in chat and in the menu bar."]);
  });

  it("error sets aria-invalid and aria-describedby pointing at the rendered message", () => {
    const message = "Unknown field. Try pr.number or pr.head_sha in braces: {pr.head_sha}";
    const { container } = render(<TextField id="dedupe" label="Dedupe key" defaultValue="pr.head_sha" error={message} />);
    const input = screen.getByRole("textbox", { name: "Dedupe key" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(descriptions(input)).toEqual([message]);
    expect(container.querySelector(".field")?.getAttribute("data-invalid")).toBe("true");
    expect(rule('.field[data-invalid="true"]')).toMatch(/border-color:\s*var\(--danger\)/);
    expect(rule(".field-error")).toMatch(/color:\s*var\(--danger\)/);
  });

  it("keeps a caller's aria-describedby alongside the error and hint", () => {
    render(<TextField id="k" label="Key" hint="Braces expand." error="Unknown field." aria-describedby="extra" />);
    expect(screen.getByRole("textbox", { name: "Key" }).getAttribute("aria-describedby")).toBe("k-error k-hint extra");
  });

  it("search has a leading icon, a trailing kbd hint and the searchbox role", () => {
    const { container } = render(
      <TextField id="s" variant="search" label="Search sessions" placeholder="Agent, task or PR…" kbd="/" />,
    );
    const input = screen.getByRole("searchbox", { name: "Search sessions" });
    const field = container.querySelector(".field");
    expect(field?.getAttribute("data-variant")).toBe("search");
    expect(field?.firstElementChild?.className).toBe("field-icon");
    expect(field?.firstElementChild?.querySelector("svg")).not.toBeNull();
    expect(field?.lastElementChild?.tagName).toBe("KBD");
    expect(field?.lastElementChild?.textContent).toBe("/");
    expect(input.getAttribute("placeholder")).toBe("Agent, task or PR…");
  });

  it("rests on surface-sunken with no visible border and lifts to surface with an accent edge on focus", () => {
    expect(rule(".field")).toMatch(/background:\s*var\(--surface-sunken\)/);
    expect(rule(".field")).toMatch(/border:\s*1px solid transparent/);
    expect(rule(".field:focus-within")).toMatch(/background:\s*var\(--surface\)/);
    expect(rule(".field:focus-within")).toMatch(/border-color:\s*var\(--accent\)/);
  });

  it("is reachable with Tab and takes typed text", () => {
    const onChange = vi.fn();
    render(<TextField label="Agent name" onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: "Agent name" }) as HTMLInputElement;
    expect(input.tabIndex).toBe(0);
    input.focus();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Mason" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("SelectField", () => {
  it("is a labelled native select with a trailing chevron, a hint and error wiring", () => {
    const { container } = render(
      <SelectField id="model" label="Model" defaultValue="opus" hint="Policy is yours." error="Pick a model.">
        <option value="sonnet">Sonnet 5</option>
        <option value="opus">Opus 5.5</option>
      </SelectField>,
    );
    const select = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect(select.value).toBe("opus");
    expect(container.querySelector(".field")?.lastElementChild?.classList.contains("field-chevron")).toBe(true);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(descriptions(select)).toEqual(["Pick a model.", "Policy is yours."]);
  });
});

describe("Composer", () => {
  it("is named by its required aria-label and has no visible label", () => {
    const { container } = render(<Composer aria-label="Message Wright" onSend={() => undefined} />);
    expect(screen.getByRole("textbox", { name: "Message Wright" }).tagName).toBe("TEXTAREA");
    expect(container.querySelector("label")).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("refuses to typecheck without an aria-label", () => {
    // @ts-expect-error the composer has no visible label, so aria-label is required
    const composer = <Composer onSend={() => undefined} />;
    expect(composer).toBeTruthy();
  });

  it("Enter sends and clears; Shift+Enter does not send and keeps the platform's newline", () => {
    const onSend = vi.fn();
    render(<Composer aria-label="Message Wright" onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "Message Wright" }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Review PR 412" } });

    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(box, { key: "Enter", shiftKey: true })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(false);
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Review PR 412");
    expect(box.value).toBe("");
  });

  it("Enter on empty text sends nothing", () => {
    const onSend = vi.fn();
    render(<Composer aria-label="Message Wright" onSend={onSend} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Wright" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("the Send button sends, and a controlled composer leaves clearing to its owner", () => {
    const onSend = vi.fn();
    render(<Composer aria-label="Message Wright" value="Hello" onValueChange={() => undefined} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledExactlyOnceWith("Hello");
    expect((screen.getByRole("textbox", { name: "Message Wright" }) as HTMLTextAreaElement).value).toBe("Hello");
  });

  it("while streaming, Send becomes Stop and Enter does not send", () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<Composer aria-label="Message Wright" defaultValue="next" onSend={onSend} onStop={onStop} streaming />);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Wright" }), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("whitespace-only text, a disabled composer, or a caller's preventDefault sends nothing", () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer aria-label="Message Wright" defaultValue={"  \n "} onSend={onSend} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Wright" }), { key: "Enter" });
    rerender(<Composer aria-label="Message Wright" value="hi" onSend={onSend} disabled />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Wright" }), { key: "Enter" });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Composer aria-label="Message Wright" value="hi" onSend={onSend} onKeyDown={(e) => e.preventDefault()} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Wright" }), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send mid-IME composition", () => {
    const onSend = vi.fn();
    render(<Composer aria-label="Message Wright" defaultValue="にほん" onSend={onSend} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Message Wright" }), { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("uses the chat type and grows to six lines, then scrolls", () => {
    const body = rule(".composer-input");
    expect(body).toMatch(/font-size:\s*var\(--type-chat-size\)/);
    expect(body).toMatch(/field-sizing:\s*content/);
    expect(body).toMatch(/max-height:\s*calc\(var\(--type-chat-line\) \* 6\)/);
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(rule(".composer")).toMatch(/background:\s*var\(--surface\)/);
  });
});

describe("Input gallery states", () => {
  it("every state renders, and every field has an accessible name", () => {
    expect(new Set(states.map((s) => s.id)).size).toBe(states.length);
    for (const state of states) {
      const { container, unmount } = render(state.render());
      for (const control of container.querySelectorAll<HTMLElement>("input, select, textarea")) {
        const named = control.getAttribute("aria-label") ?? container.querySelector(`label[for="${control.id}"]`)?.textContent;
        expect(named?.trim()).toBeTruthy();
      }
      unmount();
    }
  });
});

describe("Input source (AC7, AC9)", () => {
  const sources = { "Input.css": css, "Input.tsx": read("./Input.tsx"), "Input.states.tsx": read("./Input.states.tsx") };

  it.each(Object.entries(sources))("%s is non-empty and has no hard-coded colour", (_name, source) => {
    expect(source.trim().length).toBeGreaterThan(0);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:rgba?|hsla?)\(/);
  });

  it("zeroes transitions under prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.composer\s*\{[^}]*transition-duration:\s*0s/);
  });
});
