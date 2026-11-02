// @vitest-environment jsdom
// The shell's keyboard host (phase 7 item 13): ⌘K and `/` open the palette, `?` opens the Keyboard map, every
// registered ⌘ shortcut runs once per press, a text field keeps its keys, and, whichever way the menu bar's kill
// confirm was opened (⌘⇧K, the palette's "Kill switch…" command, `askKill()` as the menu bar button calls it),
// nothing runs behind it until it closes (AC7b). The host never sends a stop itself.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommandRegistry } from "../commands/registry";
import type { Command, CommandRegistry } from "../commands/registry";
import { createMenubarActions } from "../screens/menubar/MenubarHost";
import type { MenubarActions } from "../screens/menubar/MenubarHost";
import { fakeBridge, ok } from "../store/fake-bridge";
import type { FakeBridge } from "../store/fake-bridge";
import { KEYMAP_COMMAND_ID, KeyboardHost, guardRegistry } from "./KeyboardHost";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

interface Mounted {
  readonly registry: CommandRegistry;
  readonly actions: MenubarActions;
  readonly onGo: ReturnType<typeof vi.fn<(id: string) => void>>;
  readonly runs: Record<string, ReturnType<typeof vi.fn>>;
  readonly bridge: FakeBridge;
}

/** The host over its own registry and kill-confirm state, with ⌘1 … ⌘9, ⌘, and Approvals' `A` registered as commands. */
function mount(): Mounted {
  const registry = createCommandRegistry();
  const actions = createMenubarActions();
  const onGo = vi.fn<(id: string) => void>();
  const runs: Record<string, ReturnType<typeof vi.fn>> = {};
  const command = (id: string, shortcut: string, group = "Screens"): Command => {
    runs[id] = vi.fn();
    return { id, title: id, group, shortcut, run: runs[id] as () => void };
  };
  registry.register("test", [
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => command(`screens.${n}`, `⌘${n}`)),
    command("screens.settings", "⌘,"),
    command("approvals.approve-once", "A", "Approvals"),
  ]);
  const bridge = fakeBridge();
  bridge.route("POST /stop-all", () => ok({ engaged: true, sessions: [] }));
  render(<KeyboardHost registry={registry} actions={actions} onGo={onGo} />);
  return { registry, actions, onGo, runs, bridge };
}

/** One key press on `target` (the body by default); false when something called `preventDefault`. */
function press(key: string, init: KeyboardEventInit = {}, target: Element = document.body): boolean {
  return fireEvent.keyDown(target, { key, ...init });
}
const cmd = (key: string): boolean => press(key, { metaKey: true });
/** Lets the kill confirm's one-microtask hand-off and any run deferred past a close happen. */
const flush = (): Promise<void> => act(async () => undefined);
const palette = (): HTMLElement | null => screen.queryByTestId("command-palette");
const paletteInput = (): HTMLInputElement => screen.getByRole("textbox", { name: "Command" });

function field(tag: "input" | "textarea"): HTMLElement {
  const el = document.createElement(tag);
  document.body.append(el);
  el.focus();
  return el;
}

describe("⌘ shortcuts (AC1)", () => {
  it("⌘1 … ⌘9 and ⌘, each run their command exactly once per press", () => {
    const m = mount();
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(cmd(String(n))).toBe(false);
      expect(m.runs[`screens.${n}`]).toHaveBeenCalledTimes(1);
    }
    press(",", { metaKey: true });
    expect(m.runs["screens.settings"]).toHaveBeenCalledTimes(1);
  });

  it("a held key does not run a command twice", () => {
    const m = mount();
    press("3", { metaKey: true });
    press("3", { metaKey: true, repeat: true });
    expect(m.runs["screens.3"]).toHaveBeenCalledTimes(1);
  });
});

describe("the palette (AC2)", () => {
  it("⌘K opens it; a second ⌘K keeps one palette; Esc closes it with focus back on the opener", async () => {
    mount();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    expect(cmd("k")).toBe(false);
    expect(palette()).not.toBeNull();
    expect(document.activeElement).toBe(paletteInput());
    cmd("k");
    expect(screen.getAllByTestId("command-palette")).toHaveLength(1);
    fireEvent.keyDown(paletteInput(), { key: "Escape" });
    await flush();
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("lists the Screens commands, filters as you type and runs the selected one on Enter", async () => {
    const m = mount();
    cmd("k");
    expect(screen.getAllByRole("option").map((o) => o.querySelector(".cp-label")?.textContent)).toContain("Keyboard map");
    fireEvent.change(paletteInput(), { target: { value: "screens.4" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(paletteInput(), { key: "Enter" });
    await flush();
    expect(m.runs["screens.4"]).toHaveBeenCalledTimes(1);
    expect(palette()).toBeNull();
  });

  it("/ outside a text field opens it and types nothing into it", () => {
    mount();
    expect(press("/")).toBe(false);
    expect(palette()).not.toBeNull();
    expect(paletteInput().value).toBe("");
  });

  it("/ while the palette is open is left to the input", () => {
    mount();
    cmd("k");
    expect(press("/", {}, paletteInput())).toBe(true);
    expect(screen.getAllByTestId("command-palette")).toHaveLength(1);
  });

  it("/ with ⌘, ⌃ or ⌥ held opens nothing", () => {
    mount();
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) press("/", init);
    expect(palette()).toBeNull();
  });
});

describe("focus after a palette run (AC1)", () => {
  const teardown: (() => void)[] = [];
  afterEach(() => {
    for (const undo of teardown.splice(0)) undo();
    window.location.hash = "";
  });

  /** Lets a hash change, the two animation frames after it and a late focus move all happen. */
  const later = (): Promise<void> => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 120)));

  interface Shell {
    readonly item: HTMLButtonElement;
    readonly content: HTMLElement;
  }

  /**
   * The shell's frame as `App` draws it: a sidebar item that holds focus, and `.content` where a hash change shows
   * the screen (a root carrying `screen-<id>`; `controls` buttons inside it), after the KernelBand's own button.
   */
  function shell(controls: number): Shell {
    const aside = document.createElement("aside");
    const item = document.createElement("button");
    item.className = "nav-item";
    item.textContent = "Tasks";
    aside.append(item);
    const content = document.createElement("div");
    content.className = "content";
    const band = document.createElement("div");
    const bandButton = document.createElement("button");
    bandButton.textContent = "Retry";
    band.append(bandButton);
    content.append(band);
    document.body.append(aside, content);
    const show = (): void => {
      const id = /^#\/([a-z]+)/.exec(window.location.hash)?.[1] ?? "chat";
      const shown = content.querySelector('[data-testid^="screen-"]');
      // A screen already on show stays (a stale hashchange from an earlier reset must not rebuild it).
      if (shown?.getAttribute("data-testid") === `screen-${id}`) return;
      shown?.remove();
      const root = document.createElement("section");
      root.setAttribute("data-testid", `screen-${id}`);
      for (let n = 0; n < controls; n += 1) {
        const button = document.createElement("button");
        button.textContent = `${id} ${n}`;
        root.append(button);
      }
      content.append(root);
    };
    window.addEventListener("hashchange", show);
    teardown.push(() => window.removeEventListener("hashchange", show));
    item.focus();
    return { item, content };
  }

  /** The host over the usual registry plus Memory (a screen command) and Pause all (one that changes no hash). */
  function mountWith(extra: Partial<Command> = {}): Mounted {
    const m = mount();
    m.registry.register("shell-test", [
      { id: "screens.memory", title: "Memory", group: "Screens", shortcut: "⌘M", run: () => void (window.location.hash = "#/memory"), ...extra },
      { id: "kernel.pause", title: "Pause all", group: "Kernel", run: () => undefined },
    ]);
    return m;
  }

  /** ⌘K, type `query`, Enter. */
  async function runFromPalette(query: string): Promise<void> {
    cmd("k");
    fireEvent.change(paletteInput(), { target: { value: query } });
    fireEvent.keyDown(paletteInput(), { key: "Enter" });
    await flush();
  }

  it("a screen command run from the palette leaves focus on the first control inside the opened screen, not on the sidebar or the KernelBand", async () => {
    const s = shell(2);
    mountWith();
    await runFromPalette("Memory");
    await later();
    expect(window.location.hash).toBe("#/memory");
    const root = s.content.querySelector('[data-testid="screen-memory"]') as HTMLElement;
    expect(document.activeElement).toBe(root.querySelector("button"));
    expect(document.activeElement).not.toBe(s.item);
  });

  it("a screen with no focusable control takes focus on its root, which gets tabindex -1", async () => {
    const s = shell(0);
    mountWith();
    await runFromPalette("Memory");
    await later();
    const root = s.content.querySelector('[data-testid="screen-memory"]') as HTMLElement;
    expect(root.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(root);
  });

  it("a screen that focused its own field keeps it", async () => {
    const s = shell(2);
    mountWith({
      run: () => {
        window.location.hash = "#/memory";
        const focusOwn = (): void => {
          // A stale hashchange (the previous test's reset) must not stand in for this one.
          if (window.location.hash !== "#/memory") return;
          window.removeEventListener("hashchange", focusOwn);
          queueMicrotask(() => (s.content.querySelectorAll("button")[2] as HTMLElement).focus());
        };
        window.addEventListener("hashchange", focusOwn);
        teardown.push(() => window.removeEventListener("hashchange", focusOwn));
      },
    });
    await runFromPalette("Memory");
    await later();
    expect(document.activeElement?.textContent).toBe("memory 1");
  });

  it("a text field that holds focus when the screen changes keeps it", async () => {
    shell(2);
    const input = document.createElement("input");
    document.body.append(input);
    mountWith({
      run: () => {
        window.location.hash = "#/memory";
        input.focus();
      },
    });
    await runFromPalette("Memory");
    await later();
    expect(window.location.hash).toBe("#/memory");
    expect(document.activeElement).toBe(input);
  });

  it("Esc closes the palette with focus back on the control that opened it, and nothing moves it later", async () => {
    const s = shell(2);
    mountWith();
    cmd("k");
    fireEvent.keyDown(paletteInput(), { key: "Escape" });
    await flush();
    await later();
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(s.item);
  });

  it("a palette command that changes no hash returns focus to the opener, and arms nothing for the next navigation", async () => {
    const s = shell(2);
    const m = mountWith();
    await runFromPalette("Pause all");
    await later();
    expect(document.activeElement).toBe(s.item);
    // The next hash change is not a palette run: focus stays where it was.
    cmd("m");
    expect(m.registry.get("screens.memory")).toBeDefined();
    await later();
    expect(window.location.hash).toBe("#/memory");
    expect(document.activeElement).toBe(s.item);
  });

  it("a navigation that is not a palette run (⌘ shortcut, sidebar click) leaves focus where it was", async () => {
    const s = shell(2);
    mountWith();
    cmd("m");
    await later();
    expect(window.location.hash).toBe("#/memory");
    expect(document.activeElement).toBe(s.item);
    window.location.hash = "#/tasks";
    await later();
    expect(document.activeElement).toBe(s.item);
    // A click on the focused sidebar item that changes the hash, as `Sidebar`'s onClick does.
    s.item.addEventListener("click", () => void (window.location.hash = "#/budget"));
    fireEvent.click(s.item);
    await later();
    expect(window.location.hash).toBe("#/budget");
    expect(document.activeElement).toBe(s.item);
  });
});

describe("text fields keep their keys (AC3)", () => {
  it.each(["input", "textarea"] as const)("J, K, / and ? typed into a %s are left alone: nothing opens, navigates or is prevented", (tag) => {
    const m = mount();
    const el = field(tag);
    for (const [key, init] of [["j", {}], ["k", {}], ["/", {}], ["?", { shiftKey: true }], ["a", {}]] as const) {
      expect(press(key, init, el), `${key} in a ${tag}`).toBe(true);
    }
    expect(palette()).toBeNull();
    expect(m.onGo).not.toHaveBeenCalled();
    expect(m.runs["approvals.approve-once"]).not.toHaveBeenCalled();
  });

  it("a contenteditable region and a key from an IME composition are left alone too", () => {
    const m = mount();
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(editable);
    expect(press("/", {}, editable)).toBe(true);
    expect(press("?", { shiftKey: true, isComposing: true })).toBe(true);
    expect(palette()).toBeNull();
    expect(m.onGo).not.toHaveBeenCalled();
  });
});

describe("the Keyboard map (AC4)", () => {
  it("? (with Shift, as a US layout sends it) opens the map exactly once", () => {
    const m = mount();
    expect(press("?", { shiftKey: true })).toBe(false);
    expect(m.onGo.mock.calls).toEqual([["keymap"]]);
  });

  it("? without Shift reaches the display-only command through the map and is still handled once", () => {
    const m = mount();
    press("?");
    expect(m.onGo.mock.calls).toEqual([["keymap"]]);
  });

  it("? with ⌘ or ⌃ held, or while the palette is open, opens nothing", () => {
    const m = mount();
    press("?", { shiftKey: true, metaKey: true });
    press("?", { shiftKey: true, ctrlKey: true });
    cmd("k");
    press("?", { shiftKey: true }, paletteInput());
    expect(m.onGo).not.toHaveBeenCalled();
  });

  it("registers one Keyboard map command (group Help, shown as ?) that opens it, and removes it with the host", () => {
    const m = mount();
    const command = m.registry.get(KEYMAP_COMMAND_ID);
    expect([command?.title, command?.group, command?.shortcut]).toEqual(["Keyboard map", "Help", "?"]);
    void command?.run();
    expect(m.onGo.mock.calls).toEqual([["keymap"]]);
    cleanup();
    expect(m.registry.get(KEYMAP_COMMAND_ID)).toBeUndefined();
  });
});

describe("the kill confirm holds everything behind it (AC7b)", () => {
  /** Nothing the keys can start runs or opens while the confirm is up. */
  function expectHeld(m: Mounted): void {
    const before = Object.values(m.runs).reduce((n, run) => n + run.mock.calls.length, 0);
    for (const key of ["3", "k", ","]) press(key, { metaKey: true });
    press("a");
    press("A", { shiftKey: true });
    press("/");
    press("?", { shiftKey: true });
    expect(Object.values(m.runs).reduce((n, run) => n + run.mock.calls.length, 0), "no command ran").toBe(before);
    expect(palette(), "no palette opened").toBeNull();
    expect(m.onGo, "nothing navigated").not.toHaveBeenCalled();
  }

  /** The keys work again once the confirm is closed. */
  function expectFree(m: Mounted): void {
    cmd("3");
    expect(m.runs["screens.3"]).toHaveBeenCalledTimes(1);
    press("a");
    expect(m.runs["approvals.approve-once"]).toHaveBeenCalledTimes(1);
    cmd("k");
    expect(palette()).not.toBeNull();
  }

  it("⌘⇧K opens the confirm; ⌘K, /, ?, ⌘3 and A run nothing until it closes; the host sends no stop", async () => {
    const m = mount();
    expect(press("k", { metaKey: true, shiftKey: true })).toBe(false);
    await flush();
    expect(m.actions.getSnapshot().confirmingKill).toBe(true);
    expectHeld(m);
    m.actions.cancelKill();
    await flush();
    expectFree(m);
    expect(m.bridge.requestsTo("POST /stop-all")).toEqual([]);
  });

  it("the confirm's own button is the one stop: exactly one POST /stop-all, none from the host", async () => {
    const m = mount();
    press("k", { metaKey: true, shiftKey: true });
    await flush();
    await act(async () => {
      await m.actions.confirmKill(m.bridge.bridge);
    });
    expect(m.bridge.requestsTo("POST /stop-all")).toHaveLength(1);
    expect(m.actions.getSnapshot().confirmingKill).toBe(false);
    cmd("3");
    expect(m.runs["screens.3"]).toHaveBeenCalledTimes(1);
  });

  it("a second ⌘⇧K while the confirm is open asks for no second confirm", async () => {
    const m = mount();
    const ask = vi.spyOn(m.actions, "askKill");
    press("k", { metaKey: true, shiftKey: true });
    await flush();
    press("k", { metaKey: true, shiftKey: true });
    await flush();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(m.actions.getSnapshot().confirmingKill).toBe(true);
  });

  it("a confirm opened by askKill() directly (the palette command, the menu bar button) holds ⌘3, A, ⌘K and /", async () => {
    const m = mount();
    m.actions.askKill();
    await flush();
    expectHeld(m);
    m.actions.cancelKill();
    await flush();
    expectFree(m);
  });

  it("the palette's own Kill switch… command: the palette closes, the confirm opens, and the keys are held", async () => {
    const m = mount();
    m.registry.register("menubar", [{ id: "menubar.kill-switch", title: "Kill switch…", group: "Kernel", run: () => m.actions.askKill() }]);
    cmd("k");
    fireEvent.change(paletteInput(), { target: { value: "kill" } });
    fireEvent.keyDown(paletteInput(), { key: "Enter" });
    await flush();
    expect(m.actions.getSnapshot().confirmingKill).toBe(true);
    expectHeld(m);
  });

  it("a confirm that opens while the palette is up closes the palette", async () => {
    const m = mount();
    cmd("k");
    expect(palette()).not.toBeNull();
    act(() => m.actions.askKill());
    await flush();
    expect(palette()).toBeNull();
  });

  it("⌘⇧K while a stop-all is already in flight settles at once and leaves no shortcut held", async () => {
    const m = mount();
    m.bridge.route("POST /stop-all", () => new Promise(() => undefined));
    m.actions.askKill();
    void m.actions.confirmKill(m.bridge.bridge);
    await flush();
    expect(m.actions.getSnapshot().busy.has("kill-switch")).toBe(true);
    expect(m.actions.getSnapshot().confirmingKill).toBe(false);

    press("k", { metaKey: true, shiftKey: true });
    await flush();
    expect(m.actions.getSnapshot().confirmingKill).toBe(false);
    cmd("3");
    press("a");
    expect(m.runs["screens.3"]).toHaveBeenCalledTimes(1);
    expect(m.runs["approvals.approve-once"]).toHaveBeenCalledTimes(1);
    expect(m.bridge.requestsTo("POST /stop-all")).toHaveLength(1);
  });

  it("the guarded view reads each command as disabled only while the confirm is open", () => {
    const registry = createCommandRegistry();
    const actions = createMenubarActions();
    registry.register("test", [
      { id: "a", title: "a", group: "G", run: () => undefined },
      { id: "b", title: "b", group: "G", enabled: () => false, run: () => undefined },
    ]);
    const view = guardRegistry(registry, actions);
    expect(view.list().map((c) => c.enabled?.())).toEqual([true, false]);
    actions.askKill();
    expect(view.list().map((c) => c.enabled?.())).toEqual([false, false]);
    expect(view.get("a")?.enabled?.()).toBe(false);
    expect(view.get("missing")).toBeUndefined();
    // Registering goes to the real registry.
    view.register("x", [{ id: "c", title: "c", group: "G", run: () => undefined }]);
    expect(registry.get("c")?.owner).toBe("x");
  });
});
