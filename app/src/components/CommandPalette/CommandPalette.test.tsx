// @vitest-environment jsdom
// The ⌘K palette (CommandPalette README + preview.html): its states, the
// combobox roles, the fuzzy matcher, its keys and focus, the host that owns the
// keyboard map, and the tokens-only guard over the shipped code.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KillSwitch } from "../../commands/keyboard";
import { createCommandRegistry } from "../../commands/registry";
import type { Command, CommandRegistry, RegisteredCommand } from "../../commands/registry";
import { CommandPalette, CommandPaletteHost } from "./CommandPalette";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const command = (id: string, extra: Partial<Command> = {}): Command => ({ id, title: id, group: "Actions", run: vi.fn(), ...extra });

interface Setup {
  readonly registry: CommandRegistry;
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly input: HTMLInputElement;
}

function setup(commands: readonly Command[], props: { onOpenInInspector?: (c: RegisteredCommand) => void; owner?: string } = {}): Setup {
  const registry = createCommandRegistry();
  if (commands.length > 0) registry.register(props.owner ?? "test", commands);
  const onClose = vi.fn();
  render(
    <CommandPalette registry={registry} open onClose={onClose} {...(props.onOpenInInspector === undefined ? {} : { onOpenInInspector: props.onOpenInInspector })} />,
  );
  return { registry, onClose, input: screen.getByRole("textbox", { name: "Command" }) as HTMLInputElement };
}

const options = (): HTMLElement[] => screen.queryAllByRole("option");
const titles = (): (string | null | undefined)[] => options().map((o) => o.querySelector(".cp-label")?.textContent);
const groupHeaders = (): (string | null)[] => [...screen.getByRole("listbox").querySelectorAll(".cp-group")].map((h) => h.textContent);
const selected = (): HTMLElement | undefined => options().find((o) => o.getAttribute("aria-selected") === "true");
const type = (input: HTMLInputElement, value: string): void => {
  fireEvent.change(input, { target: { value } });
};
/** Lets a run deferred past the close commit (one microtask) happen. */
const flush = (): Promise<void> => act(async () => undefined);
const key = (input: HTMLInputElement, k: string, mods: { metaKey?: boolean } = {}): void => {
  fireEvent.keyDown(input, { key: k, ...mods });
};

describe("the palette's states (AC1)", () => {
  it("group order Actions → Screens → Agents → Playbooks → Sessions → Tasks, others after", () => {
    setup([
      command("t", { group: "Tasks" }),
      command("z", { group: "Zeta" }),
      command("s", { group: "Sessions" }),
      command("p", { group: "Playbooks" }),
      command("al", { group: "Alpha" }),
      command("ag", { group: "Agents" }),
      command("sc", { group: "Screens" }),
      command("ac", { group: "Actions" }),
    ]);
    expect(groupHeaders()).toEqual(["Actions", "Screens", "Agents", "Playbooks", "Sessions", "Tasks", "Zeta", "Alpha"]);
    expect(titles()).toEqual(["ac", "sc", "ag", "p", "s", "t", "z", "al"]);
  });

  it("group headers are presentation, never options", () => {
    setup([command("a1"), command("s1", { group: "Screens" })]);
    const headers = [...screen.getByRole("listbox").querySelectorAll(".cp-group")];
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header.getAttribute("role")).toBe("presentation");
      expect(options()).not.toContain(header);
    }
  });

  it("more than 8 rows shows Show all", () => {
    setup(Array.from({ length: 9 }, (_, i) => command(`task.${i}`, { group: "Tasks" })));
    expect(titles()).toEqual([...Array.from({ length: 8 }, (_, i) => `task.${i}`), "Show all"]);
    expect(screen.getByRole("option", { name: "Show all 9 Tasks" })).toBeTruthy();
  });

  it("exactly 8 rows shows no Show all", () => {
    setup(Array.from({ length: 8 }, (_, i) => command(`task.${i}`, { group: "Tasks" })));
    expect(options()).toHaveLength(8);
    expect(screen.queryByRole("option", { name: /^Show all/ })).toBeNull();
  });

  it("activating Show all lists every row of that group", () => {
    setup([command("a1"), ...Array.from({ length: 11 }, (_, i) => command(`task.${i}`, { group: "Tasks" }))]);
    fireEvent.click(screen.getByRole("option", { name: "Show all 11 Tasks" }));
    expect(titles()).toEqual(["a1", ...Array.from({ length: 11 }, (_, i) => `task.${i}`)]);
    expect(screen.queryByRole("option", { name: /^Show all/ })).toBeNull();
  });

  it("Enter on Show all expands the group and selects the first revealed row", () => {
    const { input } = setup(Array.from({ length: 10 }, (_, i) => command(`task.${i}`, { group: "Tasks" })));
    key(input, "ArrowUp"); // wraps to the last selectable row: Show all
    expect(selected()?.getAttribute("aria-label")).toBe("Show all 10 Tasks");
    key(input, "Enter");
    expect(options()).toHaveLength(10);
    expect(selected()?.dataset.commandId).toBe("task.8");
  });

  it("combobox aria: the selected row carries aria-selected and the selected class, named by aria-activedescendant", () => {
    const { input } = setup([command("a1"), command("a2")]);
    const shell = screen.getByRole("combobox");
    expect(shell.getAttribute("aria-expanded")).toBe("true");
    expect(shell.getAttribute("aria-haspopup")).toBe("listbox");
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);

    const first = selected();
    expect(first?.dataset.commandId).toBe("a1");
    expect(first?.classList.contains("is-selected")).toBe(true);
    expect(input.getAttribute("aria-activedescendant")).toBe(first?.id);
    expect(options().filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);

    key(input, "ArrowDown");
    const second = selected();
    expect(second?.dataset.commandId).toBe("a2");
    expect(second?.classList.contains("is-selected")).toBe(true);
    expect(first?.classList.contains("is-selected")).toBe(false);
    expect(document.getElementById(input.getAttribute("aria-activedescendant") ?? "")).toBe(second);
  });

  it("Enter on a disabled command does nothing", async () => {
    const blocked = command("a.retry", { title: "Retry failed session", enabled: () => false });
    const { input, onClose } = setup([blocked]);
    const row = options()[0];
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(row?.id);
    key(input, "Enter");
    fireEvent.click(row as HTMLElement);
    await flush();
    expect(blocked.run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a non-matching query shows the empty state", () => {
    const { input } = setup([command("a1", { title: "Approve once" })]);
    type(input, "zzzz");
    expect(options()).toHaveLength(0);
    expect(screen.getByRole("status").textContent).toBe("No commands match “zzzz”.");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("shows the Esc chip, the footer keys and the attribution", () => {
    setup([command("a1")], { onOpenInInspector: vi.fn() });
    const shell = screen.getByRole("combobox");
    const chips = [...shell.querySelectorAll("kbd")].map((k) => k.textContent);
    expect(chips).toEqual(expect.arrayContaining(["Esc", "↑↓", "⏎", "⌘⏎"]));
    const footer = shell.querySelector(".cp-footer");
    expect(footer?.textContent).toBe("↑↓ move⏎ open⌘⏎ open in inspectorWright, powered by Claude");
    expect(shell.textContent).not.toMatch(/Claude Code/);
  });

  it("a row shows its shortcut as a kbd chip and exposes it as aria-keyshortcuts", () => {
    setup([command("screens.approvals", { title: "Approvals", group: "Screens", shortcut: "⌘3" }), command("a.always", { shortcut: "⇧A" })]);
    const [approve, approvals] = options();
    expect(approvals?.querySelector("kbd")?.textContent).toBe("⌘3");
    expect(approvals?.getAttribute("aria-keyshortcuts")).toBe("Meta+3");
    expect(approve?.getAttribute("aria-keyshortcuts")).toBe("Shift+A");
  });

  it("follows the registry live", () => {
    const { registry } = setup([command("a1")]);
    act(() => {
      registry.register("approvals", [command("a2")]);
    });
    expect(titles()).toEqual(["a1", "a2"]);
  });
});

describe("the palette's matcher (AC3)", () => {
  const approvalsCommands = (): Command[] => [
    command("approvals.bulk", { title: "Bulk approve all" }),
    command("approvals.snapshot", { title: "Snapshot preview" }),
  ];

  function withApproveOnce(): Setup {
    const s = setup(approvalsCommands());
    act(() => {
      s.registry.register("approvals", [command("approvals.approve-once", { title: "Approve once", keywords: ["#412"], shortcut: "A" })]);
    });
    return s;
  }

  it("fuzzy prefix", () => {
    const { input } = withApproveOnce();
    type(input, "appr");
    // A title prefix outranks a word start ("Bulk approve all") registered earlier.
    expect(titles()[0]).toBe("Approve once");
    expect(titles()).toContain("Bulk approve all");
  });

  it("word-start match (`once`)", () => {
    const { input } = withApproveOnce();
    type(input, "once");
    expect(titles()).toEqual(["Approve once"]);
  });

  it("in-order subsequence (`apon`)", () => {
    const { input } = withApproveOnce();
    type(input, "apon");
    expect(titles()).toEqual(["Approve once"]);
  });

  it("linked id match (`412` finds `keywords: [\"#412\"]`)", () => {
    const { input } = withApproveOnce();
    type(input, "412");
    expect(titles()).toEqual(["Approve once"]);
  });

  it("title-prefix match ranks above a subsequence match", () => {
    const registry = createCommandRegistry();
    registry.register("test", [command("snap", { title: "Snapshot preview" }), command("appr", { title: "Approve once" })]);
    render(<CommandPalette registry={registry} open onClose={vi.fn()} />);
    type(screen.getByRole("textbox", { name: "Command" }) as HTMLInputElement, "appr");
    // "Snapshot preview" is a-p-p-r in order (a subsequence) but registered first.
    expect(titles()).toEqual(["Approve once", "Snapshot preview"]);
  });

  it("an empty query lists every command in group order, registration order within a group", () => {
    setup([command("s1", { group: "Screens" }), command("a1"), command("s2", { group: "Screens" }), command("a2")]);
    expect(titles()).toEqual(["a1", "a2", "s1", "s2"]);
  });
});

describe("the palette's keys and focus (AC5)", () => {
  it("`↑`/`↓` skip disabled rows and headers", () => {
    const { input } = setup([
      command("a1"),
      command("a2", { enabled: () => false }),
      command("s1", { group: "Screens" }),
      command("s2", { group: "Screens", enabled: () => false }),
    ]);
    expect(selected()?.dataset.commandId).toBe("a1");
    key(input, "ArrowDown");
    expect(selected()?.dataset.commandId).toBe("s1");
    key(input, "ArrowDown");
    expect(selected()?.dataset.commandId).toBe("a1");
    key(input, "ArrowUp");
    expect(selected()?.dataset.commandId).toBe("s1");
  });

  it("`Enter` runs the selected command and closes", async () => {
    const a1 = command("a1");
    const a2 = command("a2");
    const { input, onClose } = setup([a1, a2]);
    key(input, "ArrowDown");
    key(input, "Enter");
    await flush();
    expect(a2.run).toHaveBeenCalledTimes(1);
    expect(a1.run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a rejecting run is logged, never thrown into the key handler", async () => {
    const failing = command("a1", { run: () => Promise.reject(new Error("nope")) });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { input, onClose } = setup([failing]);
    key(input, "Enter");
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("command a1 failed", expect.any(Error));
    error.mockRestore();
  });

  it("`⌘Enter` calls `onOpenInInspector`, else acts as `Enter`", async () => {
    const a1 = command("a1");
    const inspect = vi.fn();
    const { input, onClose } = setup([a1], { onOpenInInspector: inspect });
    key(input, "Enter", { metaKey: true });
    await flush();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect((inspect.mock.calls[0]?.[0] as RegisteredCommand).id).toBe("a1");
    expect(a1.run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const b1 = command("b1");
    const second = setup([b1]);
    key(second.input, "Enter", { metaKey: true });
    await flush();
    expect(b1.run).toHaveBeenCalledTimes(1);
    expect(second.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox").querySelector(".cp-footer")?.textContent).not.toContain("inspector");
  });

  it("`Esc` clears a non-empty query, then closes", () => {
    const { input, onClose } = setup([command("a1", { title: "Approve once" })]);
    type(input, "zz");
    key(input, "Escape");
    expect(input.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    expect(titles()).toEqual(["Approve once"]);
    key(input, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opening puts focus in the input", () => {
    const registry = createCommandRegistry();
    const { rerender } = render(<CommandPalette registry={registry} open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    rerender(<CommandPalette registry={registry} open onClose={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Command" }));
  });

  it("focus returns on close", () => {
    const registry = createCommandRegistry();
    const Page = ({ open }: { open: boolean }) => (
      <>
        <button type="button">Opener</button>
        <CommandPalette registry={registry} open={open} onClose={vi.fn()} />
      </>
    );
    const { rerender } = render(<Page open={false} />);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    rerender(<Page open />);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Command" }));
    rerender(<Page open={false} />);
    expect(document.activeElement).toBe(opener);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("a command that moves focus keeps it: run happens after the close restores focus", async () => {
    const registry = createCommandRegistry();
    registry.register("test", [command("a.focus-field", { run: () => document.getElementById("field")?.focus() })]);
    let open = true;
    const Page = () => (
      <>
        <button type="button">Opener</button>
        <input id="field" aria-label="Field" />
        <CommandPalette registry={registry} open={open} onClose={() => (open = false)} />
      </>
    );
    const { rerender } = render(<Page />);
    open = false;
    rerender(<Page />);
    open = true;
    screen.getByRole("button", { name: "Opener" }).focus();
    rerender(<Page />);
    const input = screen.getByRole("textbox", { name: "Command" }) as HTMLInputElement;
    key(input, "Enter");
    rerender(<Page />);
    await flush();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Field" }));
  });

  it("a mouse-down on the overlay outside the shell closes; one inside does not", () => {
    const { onClose } = setup([command("a1")]);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByTestId("command-palette"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tab keeps focus in the input (the palette's one tab stop)", () => {
    const { input } = setup([command("a1")]);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("clicking an enabled row runs it and closes", async () => {
    const a2 = command("a2");
    const { onClose } = setup([command("a1"), a2]);
    fireEvent.click(options()[1] as HTMLElement);
    await flush();
    expect(a2.run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reopening starts fresh: empty query, first row selected", () => {
    const registry = createCommandRegistry();
    registry.register("test", [command("a1"), command("a2")]);
    const { rerender } = render(<CommandPalette registry={registry} open onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Command" }) as HTMLInputElement;
    type(input, "a2");
    rerender(<CommandPalette registry={registry} open={false} onClose={vi.fn()} />);
    rerender(<CommandPalette registry={registry} open onClose={vi.fn()} />);
    expect((screen.getByRole("textbox", { name: "Command" }) as HTMLInputElement).value).toBe("");
    expect(selected()?.dataset.commandId).toBe("a1");
  });
});

describe("CommandPaletteHost", () => {
  function killDouble() {
    const kill = { confirm: vi.fn(() => new Promise<boolean>(() => undefined)), engage: vi.fn<() => void>() };
    return kill satisfies KillSwitch;
  }

  it("⌘K outside a text field opens it with focus in the input; Esc closes and focus returns", () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { title: "Approve once", shortcut: "A" });
    registry.register("approvals", [approve]);
    render(
      <>
        <button type="button">Opener</button>
        <CommandPaletteHost registry={registry} killSwitch={killDouble()} />
      </>,
    );
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    fireEvent.keyDown(opener, { key: "k", metaKey: true });
    const input = screen.getByRole("textbox", { name: "Command" });
    expect(document.activeElement).toBe(input);

    // While open, the single key `A` is text for the palette, not the approval.
    fireEvent.keyDown(opener, { key: "a" });
    expect(approve.run).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.activeElement).toBe(opener);

    fireEvent.keyDown(opener, { key: "a" });
    expect(approve.run).toHaveBeenCalledTimes(1);
  });

  it("⌘⇧K closes the palette before the confirm opens, and never engages on its own", async () => {
    const kill = killDouble();
    render(<CommandPaletteHost registry={createCommandRegistry()} killSwitch={kill} />);
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(screen.getByRole("combobox")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "K", metaKey: true, shiftKey: true });
    await act(async () => undefined);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(kill.confirm).toHaveBeenCalledTimes(1);
    expect(kill.engage).not.toHaveBeenCalled();
  });

  it("unmounting uninstalls the keyboard map", () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { shortcut: "A" });
    registry.register("approvals", [approve]);
    const { unmount } = render(<CommandPaletteHost registry={registry} killSwitch={killDouble()} />);
    unmount();
    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(approve.run).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC4: tokens only. Reads the shipped code under test (never *.test.*, gallery.* or tokens.css).
// ---------------------------------------------------------------------------

// Read from disk: vitest serves a `.css` import (even `?raw`) as an empty string, which would make
// every CSS guard pass vacuously. `src/` is typed for the browser, so Node's fs is loaded untyped.
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as { readFileSync(path: URL, encoding: "utf8"): string };
const read = (relative: string): string => fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const paletteCss = read("./CommandPalette.css");
const tokensCss = read("../../styles/tokens.css");
const SHIPPED: Readonly<Record<string, string>> = {
  "CommandPalette.css": paletteCss,
  "CommandPalette.tsx": read("./CommandPalette.tsx"),
  "fuzzy.ts": read("./fuzzy.ts"),
  "keyboard.ts": read("../../commands/keyboard.ts"),
};

const NAMED_COLOURS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue " +
    "chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey " +
    "darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray " +
    "darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen " +
    "fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki " +
    "lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen " +
    "lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime " +
    "limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
    "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive " +
    "olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum " +
    "powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
    "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke " +
    "yellow yellowgreen"
  ).split(" "),
);
const COLOUR_PROPERTY = /^(color|background(-color)?|border(-(top|right|bottom|left|block|inline))?(-color)?|outline(-color)?|fill|stroke|caret-color|accent-color|box-shadow|text-shadow|text-decoration(-color)?|column-rule(-color)?)$/;

/** Every hard-coded colour in `source`: hex, rgb()/hsl() calls, and named colours as a colour property value. */
function colourLiterals(source: string, kind: "css" | "ts"): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) found.push(m[0]);
  for (const m of source.matchAll(/\b(rgba?|hsla?)\(/gi)) found.push(m[0]);
  if (kind === "css") {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
      for (const declaration of (block[1] ?? "").split(";")) {
        const at = declaration.indexOf(":");
        if (at === -1) continue;
        const property = declaration.slice(0, at).trim().toLowerCase();
        if (!COLOUR_PROPERTY.test(property)) continue;
        const words = declaration.slice(at + 1).replace(/var\([^)]*\)/g, " ").toLowerCase().match(/[a-z]+/g) ?? [];
        for (const word of words) if (NAMED_COLOURS.has(word)) found.push(`${property}: ${word}`);
      }
    }
  } else {
    for (const m of source.matchAll(/\b(color|background|backgroundColor|borderColor|fill|stroke|outlineColor)\s*[:=]\s*["'`]\s*([a-zA-Z]+)\s*["'`]/g)) {
      if (NAMED_COLOURS.has((m[2] ?? "").toLowerCase())) found.push(m[0]);
    }
  }
  return found;
}

/** Every `var(--name)` in `css` that `tokens` does not define. */
function undefinedVars(css: string, tokens: string): string[] {
  const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  return [...new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1] as string))].filter((name) => !defined.has(name));
}

/** Each `selector { body }` rule in `css` (innermost blocks, so rules inside @media count). */
function rules(css: string): { selector: string; body: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: (m[1] ?? "").trim(), body: m[2] ?? "" }));
}

describe("tokens only (AC4)", () => {
  it("the guard itself catches each kind of literal", () => {
    expect(colourLiterals(".a { color: #000; }", "css")).toEqual(["#000"]);
    expect(colourLiterals(".a { background: rgb(0 0 0); border-color: hsla(0, 0%, 0%, 1); }", "css")).toEqual(["rgb(", "hsla("]);
    expect(colourLiterals(".a { border: 1px solid red; color: var(--ink); }", "css")).toEqual(["border: red"]);
    expect(colourLiterals(".a { animation: cp-open 1s; fill: none; stroke: currentColor; }", "css")).toEqual([]);
    expect(colourLiterals('const s = { color: "white" };', "ts")).toEqual(['color: "white"']);
    expect(undefinedVars(".a { color: var(--not-a-token); }", ":root { --ink: x; }")).toEqual(["--not-a-token"]);
  });

  it("reads every shipped file (no guard passes on an empty source)", () => {
    for (const [name, source] of Object.entries(SHIPPED)) expect({ name, length: source.length > 200 }).toEqual({ name, length: true });
    expect(tokensCss).toMatch(/--focus:/);
  });

  it("hex-literal guard", () => {
    for (const [name, source] of Object.entries(SHIPPED)) {
      expect({ name, found: source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [] }).toEqual({ name, found: [] });
    }
  });

  it("rgb()/hsl() literal guard", () => {
    for (const [name, source] of Object.entries(SHIPPED)) {
      expect({ name, found: source.match(/\b(rgba?|hsla?)\(/gi) ?? [] }).toEqual({ name, found: [] });
    }
  });

  it("named-colour guard (and every literal kind together)", () => {
    for (const [name, source] of Object.entries(SHIPPED)) {
      expect({ name, found: colourLiterals(source, name.endsWith(".css") ? "css" : "ts") }).toEqual({ name, found: [] });
    }
  });

  it("undefined var(--name) fails", () => {
    const css = paletteCss;
    expect(css).toMatch(/var\(--/);
    expect(undefinedVars(css, tokensCss)).toEqual([]);
  });

  it("`:focus-visible` outline uses `var(--focus)`", () => {
    const focus = rules(paletteCss).filter((r) => r.selector.includes(":focus-visible"));
    expect(focus.length).toBeGreaterThan(0);
    for (const rule of focus) {
      expect(rule.body).toMatch(/outline:\s*2px solid var\(--focus\)/);
      expect(rule.body).toMatch(/outline-offset:\s*2px/);
    }
  });

  it("the palette uses the README's surface, radius, shadow and overlay tokens", () => {
    const css = rules(paletteCss);
    const body = (selector: string): string => css.find((r) => r.selector === selector)?.body ?? "";
    expect(body(".cp-shell")).toMatch(/background: var\(--surface-raised\)/);
    expect(body(".cp-shell")).toMatch(/border-radius: var\(--radius-lg\)/);
    expect(body(".cp-shell")).toMatch(/box-shadow: var\(--shadow-3\)/);
    expect(body(".cp-shell")).toMatch(/width: 560px/);
    expect(body(".cp-shell")).toMatch(/animation: cp-open var\(--duration-slow\) var\(--ease-palette\)/);
    expect(body(".cp-overlay")).toMatch(/background: var\(--overlay\)/);
    expect(body(".cp-row.is-selected")).toMatch(/background: var\(--accent-soft\);\s*color: var\(--accent\)/);
    expect(body('.cp-row[aria-disabled="true"]')).toMatch(/color: var\(--ink-disabled\)/);
  });

  it("under reduced motion nothing scales and fades cap at --duration-instant", () => {
    const css = paletteCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at);
    expect(block).not.toMatch(/scale|cp-open/);
    expect([...block.matchAll(/animation:[^;]*/g)].map((m) => m[0])).toEqual([
      "animation: cp-fade-in var(--duration-instant) var(--ease-enter)",
      "animation: cp-fade-out var(--duration-instant) var(--ease-enter) forwards",
      "animation: none",
    ]);
  });
});
