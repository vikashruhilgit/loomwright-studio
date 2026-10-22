// The global keyboard map (brand book §Keyboard). Every binding but two comes
// from the command registry: a screen adds a key by registering a command with
// a `shortcut`, and this file re-derives its bindings whenever the registry
// changes, so no screen edits this file.
//
// Two chords are reserved and never bound to a registered command: `⌘K` opens
// the palette, and `⌘⇧K` is the kill switch, which always asks `confirm()`
// first and calls `engage()` only when the confirm resolves `true`.
//
// Mechanism only: two currently enabled commands sharing a shortcut are a
// collision. The key runs neither and the pair is reported, never silently
// resolved, as the registry refuses two owners of one id.
import type { CommandRegistry, RegisteredCommand } from "./registry";

/** A parsed shortcut: the exact modifier set plus one key, lower-cased. */
export interface ParsedShortcut {
  readonly meta: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly ctrl: boolean;
  /** Compared case-insensitively against `KeyboardEvent.key`. */
  readonly key: string;
}

/** The parts of a key event the map reads (a DOM or a React keyboard event). */
export interface KeyLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly target: EventTarget | null;
}

/** `⌘K` opens the palette; `⌘⇧K` is the kill switch. Never bound to a registered command. */
export const RESERVED_SHORTCUTS: readonly string[] = ["⌘K", "⌘⇧K"];

const OPEN_PALETTE = "⌘K";
const KILL_SWITCH = "⌘⇧K";

const MODIFIER_GLYPHS: Readonly<Record<string, "meta" | "shift" | "alt" | "ctrl">> = {
  "⌘": "meta",
  "⇧": "shift",
  "⌥": "alt",
  "⌃": "ctrl",
};

/** Glyphs and names a shortcut may use for a key whose `KeyboardEvent.key` is a word. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  "↑": "arrowup",
  "↓": "arrowdown",
  "←": "arrowleft",
  "→": "arrowright",
  "⏎": "enter",
  "↩": "enter",
  "⎋": "escape",
  esc: "escape",
  "⌫": "backspace",
  space: " ",
};

/**
 * Parses a display shortcut such as `⌘3`, `⇧A`, `⌘⇧K` or `⌘.`: modifier
 * glyphs (`⌘` meta, `⇧` shift, `⌥` alt, `⌃` ctrl) followed by exactly one key.
 * Returns `undefined` for anything else, so an unparseable shortcut stays
 * display-only and binds nothing.
 */
export function parseShortcut(shortcut: string): ParsedShortcut | undefined {
  const mods = { meta: false, shift: false, alt: false, ctrl: false };
  const chars = Array.from(shortcut.trim());
  let i = 0;
  for (; i < chars.length; i += 1) {
    const mod = MODIFIER_GLYPHS[chars[i] as string];
    if (mod === undefined) break;
    if (mods[mod]) return undefined;
    mods[mod] = true;
  }
  const rest = chars.slice(i).join("");
  if (rest === "") return undefined;
  const named = NAMED_KEYS[rest.toLowerCase()];
  if (named !== undefined) return { ...mods, key: named };
  if (Array.from(rest).length !== 1) return undefined;
  return { ...mods, key: rest.toLowerCase() };
}

/** The full chord (modifiers + key) as one comparable string. */
function chordOf(parsed: ParsedShortcut): string {
  return `${parsed.meta ? "meta+" : ""}${parsed.ctrl ? "ctrl+" : ""}${parsed.alt ? "alt+" : ""}${parsed.shift ? "shift+" : ""}${parsed.key}`;
}

/** True when the event is exactly this shortcut: the same key and the same modifier set, no more and no fewer. */
export function matchesShortcut(parsed: ParsedShortcut, event: KeyLike): boolean {
  return (
    event.key.toLowerCase() === parsed.key &&
    event.metaKey === parsed.meta &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt &&
    event.ctrlKey === parsed.ctrl
  );
}

function matches(shortcut: string, event: KeyLike): boolean {
  const parsed = parseShortcut(shortcut);
  return parsed !== undefined && matchesShortcut(parsed, event);
}

const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/** True when the event's target takes typed text, so a single-key shortcut must not fire there. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return typeof element?.closest === "function" && element.closest(EDITABLE) !== null;
}

/**
 * The list-move helper a list calls from its own key handler: `J` or `↓` is
 * +1, `K` or `↑` is −1, anything else (including `⌘K`, `⇧J` and a `J` typed
 * into a text field) is 0.
 */
export function listMove(event: KeyLike): -1 | 0 | 1 {
  if (matches("↓", event)) return 1;
  if (matches("↑", event)) return -1;
  if (isEditableTarget(event.target)) return 0;
  if (matches("J", event)) return 1;
  if (matches("K", event)) return -1;
  return 0;
}

export interface KillSwitch {
  /** Opens the confirm; resolves `true` only when the user confirms. */
  confirm(): Promise<boolean>;
  /** Stops everything. Called only after `confirm()` resolved `true`. */
  engage(): void | Promise<void>;
}

export interface KeyboardMapOptions {
  readonly registry: CommandRegistry;
  /** Where the key listener goes (default: `window`). */
  readonly target?: EventTarget;
  readonly openPalette: () => void;
  readonly isPaletteOpen: () => boolean;
  readonly killSwitch: KillSwitch;
  /** Two enabled commands share the pressed shortcut; neither ran (default: `console.error`). */
  readonly onCollision?: (shortcut: string, commands: readonly RegisteredCommand[]) => void;
}

interface Binding {
  readonly parsed: ParsedShortcut;
  readonly shortcut: string;
  readonly commands: readonly RegisteredCommand[];
}

function deriveBindings(commands: readonly RegisteredCommand[]): readonly Binding[] {
  const reserved = new Set(RESERVED_SHORTCUTS.map((s) => parseShortcut(s)).filter((p) => p !== undefined).map(chordOf));
  const byChord = new Map<string, { parsed: ParsedShortcut; shortcut: string; commands: RegisteredCommand[] }>();
  for (const command of commands) {
    if (command.shortcut === undefined) continue;
    const parsed = parseShortcut(command.shortcut);
    if (parsed === undefined) continue;
    const chord = chordOf(parsed);
    if (reserved.has(chord)) continue;
    const binding = byChord.get(chord);
    if (binding === undefined) byChord.set(chord, { parsed, shortcut: command.shortcut, commands: [command] });
    else binding.commands.push(command);
  }
  return [...byChord.values()];
}

const isEnabled = (command: RegisteredCommand): boolean => command.enabled?.() !== false;

/** Runs a command; a throw or a rejection is logged, never re-thrown into a key handler. */
export function runCommand(command: RegisteredCommand): void {
  const report = (error: unknown): void => console.error(`command ${command.id} failed`, error);
  try {
    Promise.resolve(command.run()).catch(report);
  } catch (error) {
    report(error);
  }
}

/** The default `onCollision`: names the shortcut and both commands with their owners. */
export function reportCollision(shortcut: string, commands: readonly RegisteredCommand[]): void {
  console.error(`shortcut ${shortcut} is claimed by ${commands.map((c) => `${c.id} (${c.owner})`).join(" and ")}; it runs neither`);
}

/**
 * Installs the keyboard map on `target` (default `window`) and returns the
 * uninstall. The listener runs in the capture phase so no component can
 * swallow `⌘K` or the kill switch.
 */
export function installKeyboardMap(options: KeyboardMapOptions): () => void {
  const { registry, openPalette, isPaletteOpen, killSwitch } = options;
  const target = options.target ?? window;
  const onCollision = options.onCollision ?? reportCollision;

  let bindings = deriveBindings(registry.list());
  const unsubscribe = registry.subscribe(() => {
    bindings = deriveBindings(registry.list());
  });

  let confirmPending = false;
  const pressKillSwitch = async (): Promise<void> => {
    // Dialogs never stack: a second press while the confirm is open does nothing.
    if (confirmPending) return;
    confirmPending = true;
    try {
      const confirmed = await killSwitch.confirm();
      if (confirmed === true) await killSwitch.engage();
    } catch (error) {
      console.error("kill switch failed", error);
    } finally {
      confirmPending = false;
    }
  };

  const onKeyDown = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (typeof event.key !== "string") return;

    const reserved = RESERVED_SHORTCUTS.find((shortcut) => matches(shortcut, event));
    if (reserved !== undefined) {
      event.preventDefault();
      if (reserved === OPEN_PALETTE) openPalette();
      else if (reserved === KILL_SWITCH) void pressKillSwitch();
      return;
    }

    // A single-key shortcut (no modifier, or ⇧ alone) never fires into a text field or past the open palette.
    const singleKey = !event.metaKey && !event.altKey && !event.ctrlKey;
    if (singleKey && isEditableTarget(event.target)) return;
    if (singleKey && isPaletteOpen()) return;

    const matched = bindings.filter((b) => matchesShortcut(b.parsed, event));
    if (matched.length === 0) return;
    const enabled = matched.flatMap((b) => b.commands).filter(isEnabled);
    if (enabled.length === 0) return;
    event.preventDefault();
    // Holding a key down must not run a command twice (an approval, a stop).
    if (event.repeat) return;
    if (enabled.length > 1) {
      onCollision(matched[0]?.shortcut ?? "", enabled);
      return;
    }
    runCommand(enabled[0] as RegisteredCommand);
  };

  target.addEventListener("keydown", onKeyDown, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    unsubscribe();
  };
}
