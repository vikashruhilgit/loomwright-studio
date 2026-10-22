// @vitest-environment jsdom
// The global keyboard map (brand book §Keyboard): bindings derived from the
// registry with exact modifiers, the reserved ⌘K and ⌘⇧K, the confirm-first
// kill switch, collisions refused and reported, single keys kept out of text
// fields and the open palette, and the J/K list helper.
import { afterEach, describe, expect, it, vi } from "vitest";
import { installKeyboardMap, isEditableTarget, listMove, parseShortcut, RESERVED_SHORTCUTS } from "./keyboard";
import type { KeyboardMapOptions, KillSwitch } from "./keyboard";
import { createCommandRegistry } from "./registry";
import type { Command, CommandRegistry } from "./registry";

interface Mods {
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

function press(key: string, mods: Mods = {}, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(event);
  return event;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A kill-switch test double whose confirm renders a `role="alertdialog"` with Stop / Cancel. */
function confirmDouble(): { killSwitch: KillSwitch; engage: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> } {
  const engage = vi.fn();
  const confirm = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        const dialog = document.createElement("div");
        dialog.setAttribute("role", "alertdialog");
        dialog.setAttribute("aria-label", "Stop every session?");
        for (const [label, answer] of [
          ["Stop everything", true],
          ["Cancel", false],
        ] as const) {
          const button = document.createElement("button");
          button.textContent = label;
          button.addEventListener("click", () => {
            dialog.remove();
            resolve(answer);
          });
          dialog.append(button);
        }
        document.body.append(dialog);
      }),
  );
  return { killSwitch: { confirm, engage }, engage, confirm };
}

const dialogs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="alertdialog"]')];
const answer = (label: string): void => {
  const button = [...(dialogs()[0]?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no ${label} button in the confirm`);
  button.click();
};

const command = (id: string, extra: Partial<Command> = {}): Command => ({ id, title: id, group: "Actions", run: vi.fn(), ...extra });

let uninstall: (() => void) | undefined;

function install(registry: CommandRegistry, overrides: Partial<KeyboardMapOptions> = {}) {
  const openPalette = vi.fn();
  const onCollision = vi.fn();
  const { killSwitch, engage, confirm } = confirmDouble();
  uninstall = installKeyboardMap({ registry, openPalette, isPaletteOpen: () => false, killSwitch, onCollision, ...overrides });
  return { openPalette, onCollision, engage, confirm };
}

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  document.body.innerHTML = "";
});

describe("parseShortcut", () => {
  it("reads the modifier glyphs and one key, case-insensitively", () => {
    expect(parseShortcut("⌘3")).toEqual({ meta: true, shift: false, alt: false, ctrl: false, key: "3" });
    expect(parseShortcut("⌘⇧K")).toEqual({ meta: true, shift: true, alt: false, ctrl: false, key: "k" });
    expect(parseShortcut("⇧A")).toEqual({ meta: false, shift: true, alt: false, ctrl: false, key: "a" });
    expect(parseShortcut("⌥⌃.")).toEqual({ meta: false, shift: false, alt: true, ctrl: true, key: "." });
    expect(parseShortcut("↓")?.key).toBe("arrowdown");
  });

  it("refuses anything that is not modifiers plus exactly one key", () => {
    for (const bad of ["", "⌘", "⌘KK", "Ctrl+K", "⌘⌘K"]) expect(parseShortcut(bad)).toBeUndefined();
  });
});

describe("the keyboard map", () => {
  it("⌘K outside a text field opens the palette", () => {
    const { openPalette } = install(createCommandRegistry());
    const event = press("k", { metaKey: true });
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("⌘⇧K never engages before confirm", async () => {
    const { engage, confirm } = install(createCommandRegistry());
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(1);
    expect(engage).not.toHaveBeenCalled();

    answer("Stop everything");
    await settle();
    expect(engage).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
  });

  it("cancelling never engages", async () => {
    const { engage } = install(createCommandRegistry());
    press("k", { metaKey: true, shiftKey: true });
    await settle();
    answer("Cancel");
    await settle();
    expect(engage).not.toHaveBeenCalled();
  });

  it("second ⌘⇧K while pending opens no second confirm", async () => {
    const { confirm, engage } = install(createCommandRegistry());
    press("K", { metaKey: true, shiftKey: true });
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(1);
    answer("Stop everything");
    await settle();
    expect(engage).toHaveBeenCalledTimes(1);

    // Once the first confirm is answered, the key opens a fresh one.
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("while the confirm is pending, ⌘K opens no palette over it and no registry shortcut runs behind it", async () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { shortcut: "A" });
    const approvals = command("screens.approvals", { shortcut: "⌘3" });
    registry.register("test", [approve, approvals]);
    const { openPalette } = install(registry);
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(dialogs()).toHaveLength(1);

    // Focus sits on the confirm's button (not a text field), as with the real Dialog.
    const stop = dialogs()[0]?.querySelector("button") as HTMLButtonElement;
    stop.focus();
    expect(press("k", { metaKey: true }, stop).defaultPrevented).toBe(true);
    expect(openPalette).not.toHaveBeenCalled();
    // The confirm keeps its own keys: nothing it needs is prevented.
    expect(press("a", {}, stop).defaultPrevented).toBe(false);
    press("3", { metaKey: true }, stop);
    for (const k of ["Enter", " ", "Tab", "Escape"]) expect(press(k, {}, stop).defaultPrevented).toBe(false);
    expect(approve.run).not.toHaveBeenCalled();
    expect(approvals.run).not.toHaveBeenCalled();

    // Answered: everything is live again.
    answer("Cancel");
    await settle();
    press("k", { metaKey: true });
    expect(openPalette).toHaveBeenCalledTimes(1);
    press("a");
    press("3", { metaKey: true });
    expect(approve.run).toHaveBeenCalledTimes(1);
    expect(approvals.run).toHaveBeenCalledTimes(1);
  });

  it("a rejected confirm frees ⌘K and the registry shortcuts too", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { shortcut: "A" });
    registry.register("test", [approve]);
    const openPalette = vi.fn();
    uninstall = installKeyboardMap({
      registry,
      openPalette,
      isPaletteOpen: () => false,
      killSwitch: { confirm: () => Promise.reject(new Error("dialog crashed")), engage: vi.fn() },
    });
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    press("k", { metaKey: true });
    press("a");
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(approve.run).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("a confirm that rejects (or resolves anything but true) engages nothing and frees the key", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const engage = vi.fn();
    const answers: Promise<boolean>[] = [Promise.reject(new Error("dialog crashed")), Promise.resolve("yes" as unknown as boolean)];
    const confirm = vi.fn(() => answers.shift() ?? Promise.resolve(false));
    uninstall = installKeyboardMap({ registry: createCommandRegistry(), openPalette: vi.fn(), isPaletteOpen: () => false, killSwitch: { confirm, engage } });
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(engage).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith("kill switch failed", expect.any(Error));
    error.mockRestore();
  });

  it("a hung engage frees ⌘K and the registry shortcuts once the confirm settles, and ⌘⇧K stays a no-op until it does", async () => {
    const registry = createCommandRegistry();
    const approvals = command("screens.approvals", { shortcut: "⌘1" });
    const approve = command("approvals.approve-once", { shortcut: "A" });
    registry.register("test", [approvals, approve]);
    const openPalette = vi.fn();
    let finishEngage: () => void = () => undefined;
    const confirm = vi.fn(() => Promise.resolve(true));
    const engage = vi.fn(() => new Promise<void>((resolve) => (finishEngage = resolve)));
    uninstall = installKeyboardMap({ registry, openPalette, isPaletteOpen: () => false, killSwitch: { confirm, engage } });
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(engage).toHaveBeenCalledTimes(1);

    // engage() is still running (a wedged kernel): no dialog is up, so nothing else is held off.
    press("k", { metaKey: true });
    press("1", { metaKey: true });
    press("a");
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(approvals.run).toHaveBeenCalledTimes(1);
    expect(approve.run).toHaveBeenCalledTimes(1);

    // ⌘⇧K during engage opens no second confirm and engages nothing twice.
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(engage).toHaveBeenCalledTimes(1);

    // Once engage settles, ⌘⇧K asks again.
    finishEngage();
    await settle();
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("a confirm that throws synchronously frees every guard", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const openPalette = vi.fn();
    const confirm = vi.fn((): Promise<boolean> => {
      throw new Error("dialog crashed");
    });
    uninstall = installKeyboardMap({ registry: createCommandRegistry(), openPalette, isPaletteOpen: () => false, killSwitch: { confirm, engage: vi.fn() } });
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    press("k", { metaKey: true });
    expect(openPalette).toHaveBeenCalledTimes(1);
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(confirm).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("a registered ⌘⇧K command is not run by the key, whatever the glyph order", async () => {
    const registry = createCommandRegistry();
    const reordered = command("sessions.kill-all-2", { shortcut: "⇧⌘K" });
    registry.register("sessions", [reordered]);
    const { confirm } = install(registry);
    press("K", { metaKey: true, shiftKey: true });
    await settle();
    expect(reordered.run).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("a registered ⌘⇧K command is not run by the key", async () => {
    const registry = createCommandRegistry();
    const sneaky = command("sessions.kill-all", { shortcut: "⌘⇧K" });
    const palette = command("actions.palette", { shortcut: "⌘K" });
    registry.register("sessions", [sneaky, palette]);
    const { confirm, openPalette } = install(registry);
    expect(RESERVED_SHORTCUTS).toEqual(["⌘K", "⌘⇧K"]);

    press("K", { metaKey: true, shiftKey: true });
    await settle();
    // ⌘K opens nothing over a pending confirm, so answer it first.
    answer("Cancel");
    await settle();
    press("k", { metaKey: true });
    expect(sneaky.run).not.toHaveBeenCalled();
    expect(palette.run).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(openPalette).toHaveBeenCalledTimes(1);
  });

  it("screen-registered shortcut binds with no edit", () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { title: "Approve once", shortcut: "A" });
    registry.register("approvals", [approve]);
    install(registry);
    const row = document.createElement("div");
    document.body.append(row);
    press("a", {}, row);
    expect(approve.run).toHaveBeenCalledTimes(1);
  });

  it("⌘3 runs screens.approvals, plain 3 does not", () => {
    const registry = createCommandRegistry();
    const approvals = command("screens.approvals", { title: "Approvals", group: "Screens", shortcut: "⌘3" });
    registry.register("shell", [approvals]);
    install(registry);
    press("3");
    expect(approvals.run).not.toHaveBeenCalled();
    press("3", { metaKey: true });
    expect(approvals.run).toHaveBeenCalledTimes(1);
  });

  it("a command registered after install is bound", () => {
    const registry = createCommandRegistry();
    install(registry);
    const deny = command("approvals.deny", { shortcut: "D" });
    const off = registry.register("approvals", [deny]);
    press("d");
    expect(deny.run).toHaveBeenCalledTimes(1);
    // And unregistering unbinds it.
    off();
    press("d");
    expect(deny.run).toHaveBeenCalledTimes(1);
  });

  it("modifiers match exactly (⇧A ≠ A, ⌘K ≠ K)", () => {
    const registry = createCommandRegistry();
    const once = command("approvals.approve-once", { shortcut: "A" });
    const always = command("approvals.approve-always", { shortcut: "⇧A" });
    const up = command("list.up", { shortcut: "K" });
    registry.register("approvals", [once, always, up]);
    const { onCollision, openPalette } = install(registry);

    press("A", { shiftKey: true });
    expect(always.run).toHaveBeenCalledTimes(1);
    expect(once.run).not.toHaveBeenCalled();

    press("a");
    expect(once.run).toHaveBeenCalledTimes(1);
    expect(always.run).toHaveBeenCalledTimes(1);

    press("a", { metaKey: true });
    press("a", { altKey: true });
    press("a", { ctrlKey: true });
    expect(once.run).toHaveBeenCalledTimes(1);

    press("k", { metaKey: true });
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(up.run).not.toHaveBeenCalled();
    expect(listMove(new KeyboardEvent("keydown", { key: "k", metaKey: true }))).toBe(0);
    expect(onCollision).not.toHaveBeenCalled();
  });

  it("single-key shortcut ignored in an input", () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { shortcut: "A" });
    const always = command("approvals.approve-always", { shortcut: "⇧A" });
    const stop = command("sessions.stop", { shortcut: "⌘." });
    registry.register("approvals", [approve, always, stop]);
    install(registry);
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.append(inner);
    document.body.append(input, editable);

    for (const target of [input, inner]) {
      press("a", {}, target);
      press("A", { shiftKey: true }, target);
    }
    expect(approve.run).not.toHaveBeenCalled();
    expect(always.run).not.toHaveBeenCalled();
    // A chord with ⌘ still works from a text field.
    press(".", { metaKey: true }, input);
    expect(stop.run).toHaveBeenCalledTimes(1);
  });

  it("single-key shortcuts suppressed while the palette is open", () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { shortcut: "A" });
    registry.register("approvals", [approve]);
    let open = true;
    install(registry, { isPaletteOpen: () => open });
    press("a");
    expect(approve.run).not.toHaveBeenCalled();
    open = false;
    press("a");
    expect(approve.run).toHaveBeenCalledTimes(1);
  });

  it("single-key shortcuts (Enter too) never fire out of an IME composition; modifier chords still do", () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { shortcut: "A" });
    const enter = command("list.open", { shortcut: "⏎" });
    const approvals = command("screens.approvals", { shortcut: "⌘3" });
    registry.register("test", [approve, enter, approvals]);
    install(registry);
    press("a", { isComposing: true });
    press("Enter", { isComposing: true });
    // Safari / Chromium: the keydown an IME consumes carries keyCode 229, sometimes without isComposing.
    press("a", { keyCode: 229 });
    press("Enter", { keyCode: 229 });
    expect(approve.run).not.toHaveBeenCalled();
    expect(enter.run).not.toHaveBeenCalled();
    press("3", { metaKey: true, isComposing: true });
    expect(approvals.run).toHaveBeenCalledTimes(1);

    press("a");
    press("Enter");
    expect(approve.run).toHaveBeenCalledTimes(1);
    expect(enter.run).toHaveBeenCalledTimes(1);
  });

  it("colliding shortcut runs neither and reports", () => {
    const registry = createCommandRegistry();
    const first = command("approvals.deny", { shortcut: "D" });
    const second = command("team.delete", { shortcut: "D" });
    registry.register("approvals", [first]);
    registry.register("team", [second]);
    const { onCollision } = install(registry);
    press("d");
    expect(first.run).not.toHaveBeenCalled();
    expect(second.run).not.toHaveBeenCalled();
    expect(onCollision).toHaveBeenCalledTimes(1);
    expect(onCollision.mock.calls[0]?.[0]).toBe("D");
    expect((onCollision.mock.calls[0]?.[1] as { id: string }[]).map((c) => c.id)).toEqual(["approvals.deny", "team.delete"]);
  });

  it("a collision with a disabled command is not a collision: the enabled one runs", () => {
    const registry = createCommandRegistry();
    const first = command("approvals.deny", { shortcut: "D", enabled: () => false });
    const second = command("team.delete", { shortcut: "D" });
    registry.register("approvals", [first, second]);
    const { onCollision } = install(registry);
    press("d");
    expect(first.run).not.toHaveBeenCalled();
    expect(second.run).toHaveBeenCalledTimes(1);
    expect(onCollision).not.toHaveBeenCalled();
  });

  it("the default collision report is console.error naming both owners", () => {
    const registry = createCommandRegistry();
    registry.register("approvals", [command("approvals.deny", { shortcut: "D" })]);
    registry.register("team", [command("team.delete", { shortcut: "D" })]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    uninstall = installKeyboardMap({ registry, openPalette: vi.fn(), isPaletteOpen: () => false, killSwitch: confirmDouble().killSwitch });
    press("d");
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/approvals\.deny \(approvals\) and team\.delete \(team\)/));
    error.mockRestore();
  });

  it("a held key (repeat) and a disabled command run nothing", () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { shortcut: "A" });
    const deny = command("approvals.deny", { shortcut: "D", enabled: () => false });
    registry.register("approvals", [approve, deny]);
    install(registry);
    press("a", { repeat: true });
    press("d");
    expect(approve.run).not.toHaveBeenCalled();
    expect(deny.run).not.toHaveBeenCalled();
  });

  it("a command that throws or rejects is logged, never re-thrown into the key handler", async () => {
    const registry = createCommandRegistry();
    registry.register("approvals", [
      command("a.throws", { shortcut: "T", run: () => { throw new Error("boom"); } }),
      command("a.rejects", { shortcut: "R", run: () => Promise.reject(new Error("later")) }),
    ]);
    install(registry);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => press("t")).not.toThrow();
    press("r");
    await settle();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("uninstall removes the listener and stops re-deriving", () => {
    const registry = createCommandRegistry();
    const approve = command("approvals.approve-once", { shortcut: "A" });
    registry.register("approvals", [approve]);
    const { openPalette } = install(registry);
    uninstall?.();
    uninstall = undefined;
    press("a");
    press("k", { metaKey: true });
    expect(approve.run).not.toHaveBeenCalled();
    expect(openPalette).not.toHaveBeenCalled();
  });
});

describe("listMove", () => {
  it("`listMove` maps `J`/`↓` to +1, `K`/`↑` to −1", () => {
    const key = (k: string, mods: Mods = {}) => new KeyboardEvent("keydown", { key: k, ...mods });
    expect(listMove(key("j"))).toBe(1);
    expect(listMove(key("J"))).toBe(1);
    expect(listMove(key("ArrowDown"))).toBe(1);
    expect(listMove(key("k"))).toBe(-1);
    expect(listMove(key("ArrowUp"))).toBe(-1);
    expect(listMove(key("x"))).toBe(0);
    expect(listMove(key("J", { shiftKey: true }))).toBe(0);
    expect(listMove(key("j", { metaKey: true }))).toBe(0);
  });

  it("arrows inside an IME composition pick a candidate, not a row", () => {
    const key = (k: string, mods: Mods = {}) => new KeyboardEvent("keydown", { key: k, ...mods });
    expect(listMove(key("ArrowDown", { isComposing: true }))).toBe(0);
    expect(listMove(key("ArrowUp", { keyCode: 229 }))).toBe(0);
    expect(listMove(key("j", { isComposing: true }))).toBe(0);
  });

  it("J and K typed into a text field are text, not moves; arrows still move", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const typed = (k: string) => {
      let result = 0;
      input.addEventListener("keydown", (e) => (result = listMove(e)), { once: true });
      input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      return result;
    };
    expect(isEditableTarget(input)).toBe(true);
    expect(typed("j")).toBe(0);
    expect(typed("k")).toBe(0);
    expect(typed("ArrowDown")).toBe(1);
  });
});
