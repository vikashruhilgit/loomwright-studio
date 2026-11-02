// The shell's keyboard host: the one place the window's keys and the ⌘K palette are mounted (phase 7, item 13).
//
// It composes the exported primitives, since `CommandPaletteHost` keeps its open state private and so cannot be
// opened by `/`: the controlled `CommandPalette`, `installKeyboardMap` (⌘1 … ⌘9, ⌘,, ⌘K, ⌘⇧K and every registered
// shortcut) and one listener for the two bare keys the map does not own, `/` (the palette) and `?` (the Keyboard
// map). `?` arrives as `key: "?"` with Shift held, and `parseShortcut("?")` has no Shift, so a command registered
// with `shortcut: "?"` is display-only through the map and this listener owns the key.
//
// A palette run that opens a screen moves focus into it (`trackPaletteRuns`, `focusOpenedScreen`); any other
// navigation (⌘1 … ⌘9, a sidebar click) leaves focus where it was.
//
// The kill confirm is the menu bar's (`menubarActions.askKill()`, rendered by `MenubarHost`), which also opens
// without ⌘⇧K: from the palette's "Kill switch…" command and from the menu bar panel's button. So the hold
// depends on `menubarActions.getSnapshot().confirmingKill`, never on which opener was used:
//   - the map is given a guarded view of the registry whose `enabled` is false while the confirm is open, which
//     holds back ⌘1 … ⌘9, ⌘, and every single-key command (Approvals' `A`);
//   - `openPalette` and the bare-key listener do nothing while it is open;
//   - `killSwitch.confirm` settles when the confirm goes away, or at once when a stop-all was already in flight
//     and `askKill` opened nothing;
//   - `engage` is a no-op: the confirm's own button sends `POST /stop-all` (`confirmKill`), so there is one
//     confirm, and this host never sends a stop itself.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { installKeyboardMap, isComposingKey, isEditableTarget } from "../commands/keyboard";
import { commandRegistry } from "../commands/registry";
import type { CommandRegistry, RegisteredCommand } from "../commands/registry";
import { CommandPalette } from "../components/CommandPalette/CommandPalette";
import { menubarActions } from "../screens/menubar/MenubarHost";
import type { MenubarActions } from "../screens/menubar/MenubarHost";

/** The Keyboard map screen's id (`#/keymap`). */
export const KEYMAP_SCREEN = "keymap";

/** The registry owner of the host's command, and its id: the mockup's `mk('Help', …, 'Keyboard map', '?', …)`. */
export const KEYBOARD_OWNER = "shell";
export const KEYMAP_COMMAND_ID = "shell.keymap";

/**
 * A view of `registry` for the keyboard map: each command reads as disabled while the kill confirm is open, so
 * no registered shortcut runs behind it. Registering and subscribing go to the real registry.
 */
export function guardRegistry(registry: CommandRegistry, actions: MenubarActions): CommandRegistry {
  const guard = (command: RegisteredCommand): RegisteredCommand => ({
    ...command,
    enabled: () => !actions.getSnapshot().confirmingKill && command.enabled?.() !== false,
  });
  return {
    register: (owner, commands) => registry.register(owner, commands),
    list: () => registry.list().map(guard),
    get: (id) => {
      const command = registry.get(id);
      return command === undefined ? undefined : guard(command);
    },
    subscribe: (listener) => registry.subscribe(listener),
  };
}

/**
 * A view of `registry` for the palette: every command is the registered one (same title, group, `enabled`, keys and
 * order) except that its `run` calls `onNavigated` when the run changed `location.hash` before it returned, which is
 * how a screen command (`go(id)`) reads. A run that changes no hash (Pause all, Kill switch…) calls nothing.
 * Registering and subscribing go to the real registry. The list is cached on the registry's own snapshot, since the
 * palette reads it through `useSyncExternalStore`.
 */
export function trackPaletteRuns(registry: CommandRegistry, onNavigated: () => void): CommandRegistry {
  const wrap = (command: RegisteredCommand): RegisteredCommand => ({
    ...command,
    run: () => {
      const before = window.location.hash;
      try {
        return command.run();
      } finally {
        if (window.location.hash !== before) onNavigated();
      }
    },
  });
  let seen: readonly RegisteredCommand[] | undefined;
  let wrapped: readonly RegisteredCommand[] = [];
  return {
    register: (owner, commands) => registry.register(owner, commands),
    list: () => {
      const current = registry.list();
      if (current !== seen) {
        seen = current;
        wrapped = current.map(wrap);
      }
      return wrapped;
    },
    get: (id) => {
      const command = registry.get(id);
      return command === undefined ? undefined : wrap(command);
    },
    subscribe: (listener) => registry.subscribe(listener),
  };
}

/** What a control must match to take focus: the first of these inside the opened screen. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Moves focus into the screen on show (`.content`'s screen root, the `screen-<id>` test id every screen carries):
 * its first focusable control, else the root itself (given `tabindex="-1"` here when it has none, since the shell's
 * `<main>` is not this host's to change). Never the KernelBand's button, which precedes the root. Does nothing when
 * focus is already inside `.content` (a screen that focused its own control, the Keyboard map's Back) or in a text field.
 */
function focusOpenedScreen(): void {
  const content = document.querySelector(".content");
  if (content === null) return;
  const active = document.activeElement;
  if (active instanceof Element && content.contains(active)) return;
  if (isEditableTarget(active)) return;
  const root = content.querySelector<HTMLElement>('[data-testid^="screen-"]');
  if (root === null) return;
  const control = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => el.closest("[hidden], [inert]") === null);
  if (control !== undefined) {
    control.focus({ preventScroll: true });
    return;
  }
  if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
  root.focus({ preventScroll: true });
}

export interface KeyboardHostProps {
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
  /** The shell's one navigation helper (`go` in `App.tsx`): sets the hash to `#/<id>`. */
  readonly onGo: (id: string) => void;
  /** Defaults to the window's one set of menu bar actions (the kill confirm's home). */
  readonly actions?: MenubarActions;
  /** Where the key listeners go (default: `window`). */
  readonly keyTarget?: EventTarget;
}

/** Mounts the palette and the global keys. Renders only the palette's overlay. */
export function KeyboardHost({ registry = commandRegistry, onGo, actions = menubarActions, keyTarget }: KeyboardHostProps) {
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  // Read by the key listeners, so it flips in the same tick as the key, not on the next render.
  const openRef = useRef(false);
  const goRef = useRef(onGo);
  useLayoutEffect(() => {
    goRef.current = onGo;
  });

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  const guarded = useMemo(() => guardRegistry(registry, actions), [registry, actions]);

  // Only a palette run that changed the hash arms the focus move; ⌘1 … ⌘9, a sidebar click and any other hash change
  // never do. The move waits for the new screen to render (two animation frames after the `hashchange`).
  const armed = useRef(false);
  const paletteView = useMemo(
    () =>
      trackPaletteRuns(registry, () => {
        armed.current = true;
      }),
    [registry],
  );
  useEffect(() => {
    let frame = 0;
    const onHashChange = (): void => {
      if (!armed.current) return;
      armed.current = false;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(focusOpenedScreen);
      });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(
    () =>
      registry.register(KEYBOARD_OWNER, [
        {
          id: KEYMAP_COMMAND_ID,
          title: "Keyboard map",
          group: "Help",
          // Display only through the map (see the header); the bare-key listener below owns `?`.
          shortcut: "?",
          keywords: ["keys", "shortcuts", "help", "keyboard"],
          run: () => goRef.current(KEYMAP_SCREEN),
        },
      ]),
    [registry],
  );

  useEffect(() => {
    const target = keyTarget ?? window;
    const confirming = (): boolean => actions.getSnapshot().confirmingKill;
    // Confirms waiting for the kill confirm to go away; a teardown settles them, so none hangs.
    const waiting = new Set<() => void>();
    let disposed = false;

    const openPalette = (): void => {
      // Dialogs never stack: no palette over the kill confirm.
      if (confirming()) return;
      // Already open: ⌘K brings focus back to the input instead of doing nothing.
      if (openRef.current) setFocusRequest((n) => n + 1);
      openRef.current = true;
      setOpen(true);
    };

    const uninstallMap = installKeyboardMap({
      registry: guarded,
      ...(keyTarget === undefined ? {} : { target: keyTarget }),
      openPalette,
      isPaletteOpen: () => openRef.current,
      killSwitch: {
        // The palette closes before the confirm opens, one microtask apart as `CommandPaletteHost` does it, so the
        // close's focus restore lands first and the confirm keeps the focus it takes.
        confirm: () => {
          close();
          return new Promise<void>((resolve) => queueMicrotask(resolve)).then(
            () =>
              new Promise<boolean>((resolve) => {
                if (disposed) {
                  resolve(false);
                  return;
                }
                actions.askKill();
                // A stop-all already in flight opens nothing: settle at once, or the map would hold every key.
                if (!confirming()) {
                  resolve(false);
                  return;
                }
                const settle = (): void => {
                  waiting.delete(settle);
                  off();
                  resolve(false);
                };
                const off = actions.subscribe(() => {
                  if (!confirming()) settle();
                });
                waiting.add(settle);
              }),
          );
        },
        // The confirm's own button sends `POST /stop-all`; this host never engages.
        engage: () => undefined,
      },
    });

    // The two bare keys the map does not own. The map's listener (capture, registered first) has already run;
    // a key it handled is `defaultPrevented` and is not handled twice.
    const onBareKey = (raw: Event): void => {
      const event = raw as KeyboardEvent;
      if (event.defaultPrevented || typeof event.key !== "string") return;
      if (event.key !== "/" && event.key !== "?") return;
      // A single-key shortcut (no modifier, or ⇧ alone) never fires into a text field, out of an IME
      // composition or past the open palette; and none fires behind the kill confirm.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isComposingKey(event) || isEditableTarget(event.target)) return;
      if (openRef.current || confirming()) return;
      event.preventDefault();
      if (event.key === "/") openPalette();
      else goRef.current(KEYMAP_SCREEN);
    };
    target.addEventListener("keydown", onBareKey, true);

    // The kill confirm opened some other way while the palette was up: the palette goes, nothing stacks.
    const offActions = actions.subscribe(() => {
      if (confirming() && openRef.current) close();
    });

    return () => {
      disposed = true;
      target.removeEventListener("keydown", onBareKey, true);
      offActions();
      uninstallMap();
      for (const settle of [...waiting]) settle();
    };
  }, [guarded, actions, keyTarget, close]);

  return <CommandPalette registry={paletteView} open={open} onClose={close} focusRequest={focusRequest} />;
}
