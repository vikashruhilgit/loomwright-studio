// The ⌘K palette (docs/design/design-system/components/CommandPalette): every
// registered command, grouped Actions → Screens → Agents → Playbooks →
// Sessions → Tasks, fuzzy-matched on title and linked ids, run from the
// keyboard. `CommandPalette` is controlled (`open` / `onClose`);
// `CommandPaletteHost` owns the open state and installs the global keyboard
// map, so the shell mounts exactly one element.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { installKeyboardMap, parseShortcut, reportCollision, runCommand } from "../../commands/keyboard";
import type { KeyboardMapOptions, KillSwitch } from "../../commands/keyboard";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry, RegisteredCommand } from "../../commands/registry";
import { GROUP_ROW_CAP, groupCommands } from "./fuzzy";
import "./CommandPalette.css";

export interface CommandPaletteProps {
  readonly registry: CommandRegistry;
  readonly open: boolean;
  readonly onClose: () => void;
  /** `⌘Enter` on a row; without it, `⌘Enter` acts as `Enter`. */
  readonly onOpenInInspector?: (command: RegisteredCommand) => void;
}

type Row =
  | { readonly kind: "command"; readonly key: string; readonly command: RegisteredCommand; readonly enabled: boolean }
  | { readonly kind: "show-all"; readonly key: string; readonly group: string; readonly total: number; readonly reveals: string };

interface Section {
  readonly name: string;
  readonly rows: readonly Row[];
}

const isEnabled = (command: RegisteredCommand): boolean => command.enabled?.() !== false;
const selectable = (row: Row): boolean => row.kind === "show-all" || row.enabled;

/** `⌘⇧K` → `Meta+Shift+K` (the `aria-keyshortcuts` format). */
function ariaKeyShortcuts(shortcut: string): string | undefined {
  const parsed = parseShortcut(shortcut);
  if (parsed === undefined) return undefined;
  const key = parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key.replace(/^arrow(.)/, (_, c: string) => `Arrow${c.toUpperCase()}`);
  return [parsed.meta && "Meta", parsed.ctrl && "Control", parsed.alt && "Alt", parsed.shift && "Shift", key].filter(Boolean).join("+");
}

/** The longest running animation on `element`, in ms (0 when none, as in jsdom). */
function animationMs(element: Element | null): number {
  if (element === null) return 0;
  const durations = getComputedStyle(element).animationDuration.split(",");
  return Math.max(0, ...durations.map((d) => (d.trim().endsWith("ms") ? parseFloat(d) : parseFloat(d) * 1000)).filter(Number.isFinite));
}

/** The controlled palette. Renders nothing while closed (after its close fade). */
export function CommandPalette(props: CommandPaletteProps) {
  const [mounted, setMounted] = useState(props.open);
  if (props.open && !mounted) setMounted(true);
  const onClosed = useCallback(() => setMounted(false), []);
  if (!mounted) return null;
  return <PaletteBody {...props} closing={!props.open} onClosed={onClosed} />;
}

function PaletteBody({ registry, closing, onClose, onClosed, onOpenInInspector }: CommandPaletteProps & { closing: boolean; onClosed: () => void }) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const commands = useSyncExternalStore(registry.subscribe, registry.list);
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  // Focus: into the input on open, back to whatever had it before on close.
  // The restore runs in an effect body, not a cleanup: React restores the
  // pre-commit focus after the mutation phase (where cleanups run), which
  // would put focus straight back in the input.
  const openerRef = useRef<Element | null>(null);
  const restoreFocus = useCallback((): void => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, []);
  useLayoutEffect(() => {
    if (closing) {
      restoreFocus();
      return;
    }
    openerRef.current = document.activeElement;
    inputRef.current?.focus();
  }, [closing, restoreFocus]);
  // Unmounted while still open (the parent went away): restore too.
  useLayoutEffect(() => restoreFocus, [restoreFocus]);

  // Close: fade out on `--duration-fast` (instant under reduced motion), then unmount.
  useLayoutEffect(() => {
    if (!closing) return;
    const ms = animationMs(overlayRef.current);
    if (ms <= 0) {
      onClosed();
      return;
    }
    const timer = window.setTimeout(onClosed, ms);
    return () => window.clearTimeout(timer);
  }, [closing, onClosed]);

  const sections = useMemo<readonly Section[]>(
    () =>
      groupCommands(commands, query).map(({ name, commands: matched }) => {
        const collapsed = matched.length > GROUP_ROW_CAP && !expanded.has(name);
        const shown = collapsed ? matched.slice(0, GROUP_ROW_CAP) : matched;
        const rows: Row[] = shown.map((command) => ({ kind: "command", key: command.id, command, enabled: isEnabled(command) }));
        if (collapsed) {
          rows.push({ kind: "show-all", key: `show-all:${name}`, group: name, total: matched.length, reveals: matched[GROUP_ROW_CAP]?.id ?? "" });
        }
        return { name, rows };
      }),
    [commands, query, expanded],
  );
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const active = rows.find((r) => r.key === activeKey) ?? rows.find(selectable) ?? rows[0];
  const optionId = (row: Row): string => `${uid}-option-${rows.indexOf(row)}`;
  const activeId = active === undefined ? undefined : optionId(active);

  useEffect(() => {
    if (activeId === undefined) return;
    const element = document.getElementById(activeId) as (HTMLElement & { scrollIntoView?: (o: object) => void }) | null;
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const move = (step: 1 | -1): void => {
    const candidates = rows.filter(selectable);
    if (candidates.length === 0) return;
    const at = active === undefined ? -1 : candidates.indexOf(active);
    const next = at === -1 ? (step === 1 ? 0 : candidates.length - 1) : (at + step + candidates.length) % candidates.length;
    setActiveKey((candidates[next] as Row).key);
  };

  const activate = (row: Row | undefined): void => {
    if (row === undefined) return;
    if (row.kind === "show-all") {
      setExpanded((prev) => new Set(prev).add(row.group));
      setActiveKey(row.reveals);
      return;
    }
    if (row.command.enabled?.() === false) return;
    onClose();
    // After the close commits and focus is back on the opener, so a command that moves focus keeps it.
    const { command } = row;
    queueMicrotask(() => runCommand(command));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (closing) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Enter":
        event.preventDefault();
        if (event.metaKey && onOpenInInspector !== undefined && active?.kind === "command") {
          const { command } = active;
          onClose();
          queueMicrotask(() => onOpenInInspector(command));
          return;
        }
        activate(active);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (query !== "") {
          setQuery("");
          setActiveKey(null);
        } else {
          onClose();
        }
        return;
      case "Tab":
        // The input is the palette's one tab stop; focus stays in it until close.
        event.preventDefault();
        return;
      default:
        return;
    }
  };

  const onOverlayMouseDown = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div
      ref={overlayRef}
      className={closing ? "cp-overlay is-closing" : "cp-overlay"}
      data-testid="command-palette"
      inert={closing}
      onMouseDown={onOverlayMouseDown}
      onAnimationEnd={(event) => {
        if (closing && event.target === event.currentTarget) onClosed();
      }}
    >
      <div className="cp-shell" role="combobox" aria-label="Command palette" aria-expanded="true" aria-haspopup="listbox">
        <div className="cp-search">
          <svg className="cp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            aria-label="Command"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={activeId}
            placeholder="Search actions, screens and sessions"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveKey(null);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="cp-kbd" aria-hidden="true">
            Esc
          </kbd>
        </div>
        <div className="cp-list" id={listId} role="listbox" aria-label="Commands">
          {sections.map((section) => (
            <div key={section.name} role="presentation">
              <div className="cp-group" role="presentation">
                {section.name}
              </div>
              {section.rows.map((row) => {
                const selected = row === active;
                const className = selected ? "cp-row is-selected" : "cp-row";
                if (row.kind === "show-all") {
                  return (
                    <div
                      key={row.key}
                      id={optionId(row)}
                      className={`${className} cp-show-all`}
                      role="option"
                      aria-selected={selected}
                      aria-label={`Show all ${row.total} ${row.group}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActiveKey(row.key)}
                      onClick={() => activate(row)}
                    >
                      <span className="cp-lead" aria-hidden="true" />
                      <span className="cp-label">Show all</span>
                      <span className="cp-right">
                        <span className="cp-meta">{row.total}</span>
                      </span>
                    </div>
                  );
                }
                const { command } = row;
                return (
                  <div
                    key={row.key}
                    id={optionId(row)}
                    className={className}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={row.enabled ? undefined : true}
                    aria-keyshortcuts={command.shortcut === undefined ? undefined : ariaKeyShortcuts(command.shortcut)}
                    data-command-id={command.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => {
                      if (row.enabled) setActiveKey(row.key);
                    }}
                    onClick={() => activate(row)}
                  >
                    {/* The registry has no icon or status yet (evidence README finding); the 16px slot stays reserved. */}
                    <span className="cp-lead" aria-hidden="true" />
                    <span className="cp-label">{command.title}</span>
                    {command.shortcut === undefined ? null : (
                      <span className="cp-right">
                        <kbd className="cp-kbd">{command.shortcut}</kbd>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="cp-empty" role="status">
            {query.trim() === "" ? "No commands yet." : `No commands match “${query.trim()}”.`}
          </p>
        ) : null}
        <div className="cp-footer">
          <span>
            <kbd className="cp-kbd">↑↓</kbd> move
          </span>
          <span>
            <kbd className="cp-kbd">⏎</kbd> open
          </span>
          {onOpenInInspector === undefined ? null : (
            <span>
              <kbd className="cp-kbd">⌘⏎</kbd> open in inspector
            </span>
          )}
          <span className="cp-attribution">Wright, powered by Claude</span>
        </div>
      </div>
    </div>
  );
}

export interface CommandPaletteHostProps {
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
  /** `⌘⇧K`: confirm first, engage only on `true`. Item 17 wires the real Dialog and `POST /stop-all`. */
  readonly killSwitch: KillSwitch;
  readonly onOpenInInspector?: (command: RegisteredCommand) => void;
  /** Where the key listener goes (default: `window`). */
  readonly keyTarget?: EventTarget;
  readonly onCollision?: KeyboardMapOptions["onCollision"];
}

/** The one element the shell mounts: owns the palette's open state and the global keyboard map. */
export function CommandPaletteHost({ registry = commandRegistry, killSwitch, onOpenInInspector, keyTarget, onCollision }: CommandPaletteHostProps) {
  const [open, setOpen] = useState(false);
  // Read by the key listener, so it flips in the same tick as the key, not on the next render.
  const openRef = useRef(false);
  const latest = useRef({ killSwitch, onCollision });
  useLayoutEffect(() => {
    latest.current = { killSwitch, onCollision };
  });

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  useEffect(
    () =>
      installKeyboardMap({
        registry,
        ...(keyTarget === undefined ? {} : { target: keyTarget }),
        openPalette: () => {
          openRef.current = true;
          setOpen(true);
        },
        isPaletteOpen: () => openRef.current,
        killSwitch: {
          // Dialogs never stack: the palette closes before the confirm opens.
          confirm: () => {
            close();
            return latest.current.killSwitch.confirm();
          },
          engage: () => latest.current.killSwitch.engage(),
        },
        onCollision: (shortcut, commands) => (latest.current.onCollision ?? reportCollision)(shortcut, commands),
      }),
    [registry, keyTarget, close],
  );

  return <CommandPalette registry={registry} open={open} onClose={close} {...(onOpenInInspector === undefined ? {} : { onOpenInInspector })} />;
}
