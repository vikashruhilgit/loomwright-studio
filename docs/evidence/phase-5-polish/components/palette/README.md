# Evidence: the ⌘K CommandPalette and the global keyboard map (phase 5, item 11)

This item builds the approved palette ([`CommandPalette/README.md`](../../../../design/design-system/components/CommandPalette/README.md), [`preview.html`](../../../../design/design-system/components/CommandPalette/preview.html)) and the keyboard map (brand book §Keyboard) over item 01's command registry.

- Palette: [`CommandPalette.tsx`](../../../../../app/src/components/CommandPalette/CommandPalette.tsx) (`CommandPalette`, `CommandPaletteHost`), [`CommandPalette.css`](../../../../../app/src/components/CommandPalette/CommandPalette.css), matcher [`fuzzy.ts`](../../../../../app/src/components/CommandPalette/fuzzy.ts)
- Keyboard map: [`keyboard.ts`](../../../../../app/src/commands/keyboard.ts) (`installKeyboardMap`, `parseShortcut`, `listMove`, `RESERVED_SHORTCUTS`)
- Tests: [`CommandPalette.test.tsx`](../../../../../app/src/components/CommandPalette/CommandPalette.test.tsx), [`keyboard.test.ts`](../../../../../app/src/commands/keyboard.test.ts), e2e [`components.palette.spec.ts`](../../../../../app/e2e/components.palette.spec.ts) over the gallery [`gallery.html`](../../../../../app/src/components/CommandPalette/gallery.html) / [`gallery.tsx`](../../../../../app/src/components/CommandPalette/gallery.tsx)

## Screenshots

The e2e spec starts a Vite dev server on the gallery page, loads it in Electron through a throwaway main script, and drives every state by keyboard. It writes screenshots only when **`PALETTE_SCREENSHOTS=1`** is set, so a plain `npm run e2e` (locally or in CI) never changes the tree. To regenerate them:

```sh
cd app
node node_modules/electron/install.js   # first time only
PALETTE_SCREENSHOTS=1 npx playwright test e2e/components.palette.spec.ts --workers=1
```

| Light | Dark | State | Matches |
|---|---|---|---|
| [light-open.png](light-open.png) | [dark-open.png](dark-open.png) | Opened with `⌘K`, empty query | README "Groups, in order" (Actions → Screens → Agents → Playbooks → Sessions → Tasks), the first row selected (`accent-soft` / `accent`), `⌘1`–`⌘4` / `⌘N` kbd chips, a disabled row, the `Esc` chip, the footer and the attribution. The list scrolls inside the shell. |
| [light-query.png](light-query.png) | [dark-query.png](dark-query.png) | Query `rev` | `preview.html`'s own query: Actions, Playbooks, Sessions (and Tasks) matches, with the title prefix "Review approval…" selected above the word start "New duty: review PRs…" |
| [light-disabled.png](light-disabled.png) | [dark-disabled.png](dark-disabled.png) | Query `retry`: one disabled command | `aria-disabled="true"` in `ink-disabled`; `Enter` does nothing (asserted in the spec) |
| [light-show-all.png](light-show-all.png) | [dark-show-all.png](dark-show-all.png) | Query `task`: 11 Tasks | README **Don't**: at most eight rows, then a "Show all" row with the count |
| [light-expanded.png](light-expanded.png) | [dark-expanded.png](dark-expanded.png) | `Enter` on "Show all" | Every row of the group; the selection lands on the first revealed row (LW-109) |
| [light-empty.png](light-empty.png) | [dark-empty.png](dark-empty.png) | Query `zzzz` | Empty-match state ("No commands match “zzzz”.") in a `role="status"` line |
| [light-open-reduced-motion.png](light-open-reduced-motion.png) | n/a | Opened under `prefers-reduced-motion: reduce` | Brand book §Motion: no scale (`.cp-shell` animation and transform are `none`) and the overlay fades on `--duration-instant` with `--ease-enter`. The spec asserts the computed styles. |

The spec also checks, in Electron and by keyboard only: focus lands in the input on `⌘K` and returns to the opener after `Esc` clears and then closes. `aria-activedescendant` names the selected option. `Enter` runs the best match for a linked id (`412`). `⌘Enter` opens in the inspector instead of running. A registered `⌘3` runs its command. A click on the footer or a group header leaves focus in the input, so `Esc` still closes. `⌘⇧K` opens a `role="alertdialog"` confirm and engages nothing; a second press opens no second confirm, `⌘K` and `⌘1` while it is pending open no palette and run nothing, Cancel never engages, and confirming engages once.

## Validation

All of these were run in this worktree on macOS (Darwin 25.6, Electron 44 from `node_modules`):

| Command | Result |
|---|---|
| `cd app && npm ci` | ok |
| `npm run typecheck` | ok (both tsconfigs) |
| `npm test` | 9 files, 112 tests passed (palette 47, keyboard 27, plus the existing 38) |
| `npm run build` | ok. `dist/` holds `index.html` and its assets only; the gallery is not built. |
| `npm run e2e` | 7 passed (4 palette, 3 smoke), no files written |
| `PALETTE_SCREENSHOTS=1 npx playwright test e2e/components.palette.spec.ts --workers=1` | 4 passed, 13 screenshots written |

Every pin in the brief's pin-mutation table was applied one at a time, and each turned its named test red (33 of 33), then was reverted.

## Findings for the owner

None of these was patched: each sits outside this item's files or is a design call.

1. **The registry has no icon, status, meta or "destructive" field.** The README's **Provide** line asks for "label, group, icon or status, shortcut, run handler, optional meta". `app/src/commands/registry.ts`'s `Command` has `title`, `group`, `shortcut`, `keywords`, `enabled` and `run` only. So the 16px leading slot is reserved but empty, no StatusDot is drawn, and the right-slot meta text (`preview.html`'s "waiting on you", "on · ran 2 min ago", "4m 12s") is not rendered. "Actions (pending approvals first)" can't be ordered by status either: rows within a group follow match rank, then registration order. The README's **Don't** ("put destructive actions in the palette without their confirm") can't be enforced generically without a flag. Today each destructive command must confirm inside its own `run`. Extending the contract is item 01's file and your call.
2. **`CommandPaletteHost` is not mounted.** `app/src/App.tsx` (item 01's shell) has no mount point, so in the running app `⌘K` opens nothing. Nothing binds `⌘1`–`⌘4` either: the shell's `screens.*` commands carry those shortcuts, but they only bind once the host's keyboard map is installed. The fix is one element in the shell, `<CommandPaletteHost killSwitch={…} />`, with the default registry. It needs a real kill switch (finding 4).
3. **The `⌘Enter` inspector seam.** `CommandPalette` / `CommandPaletteHost` take an optional `onOpenInInspector(command)`. No inspector exists yet. Without the prop, `⌘Enter` acts as `Enter`, and the footer hides the "⌘⏎ open in inspector" hint so it never promises a missing action. `preview.html` always shows that hint. `⌘Enter` opens a disabled command in the inspector too, because inspecting isn't running it.
4. **The kill switch is a seam, wired by item 17.** `installKeyboardMap({ killSwitch: { confirm, engage } })`: `⌘⇧K` awaits `confirm()` and calls `engage()` only on `true`. A second `⌘⇧K` while a confirm is pending does nothing. Dialogs never stack, in either order: the host closes the palette before the confirm opens, and while the confirm is pending the keyboard map opens no palette on `⌘K` and runs no registry shortcut (single-key or chord), so `A` / `D` can't approve or deny behind the modal. Other keys are not prevented, so the confirm's own Tab, Enter, Space and Esc still work. `confirm()` must therefore always settle (resolve or reject) when its dialog goes away; a promise left pending would hold `⌘K` and every shortcut off. Item 17 supplies item 08's Dialog (`role="alertdialog"`) as `confirm` and `POST /stop-all` as `engage`. This item never imports from `app/src/components/Dialog/`. The tests and the gallery use a double that renders a `role="alertdialog"`.
5. **README vs `preview.html` (and the brief), and what was built:**
   - `preview.html` puts `aria-owns="pl"` on the shell. The README asks for `aria-activedescendant` on the input. Built: `aria-controls` + `aria-activedescendant` on the input and no `aria-owns`, because the listbox is already a DOM descendant of the combobox.
   - `preview.html` sets `outline: 0` on the input. The brief's focus rule (tokens.json `focus` usage: 2px solid `--focus` at a 2px offset on `:focus-visible`) applies to every focusable. Built: the ring, so the input shows an accent ring while the palette is open (visible in every screenshot). If you want the preview's ring-less input, that is a one-rule change in `CommandPalette.css`, and the `:focus-visible` pin test would need to change with it.
   - Group headers: the brief says "caption style", while `preview.html`'s header values (11/14, weight 600, 0.06em, uppercase) are the `label` token. Built with the `label` tokens to match the approved preview.
   - `preview.html` shows a `⏎` chip on the selected Actions row. That is a hint, not a shortcut, so it is not rendered. Registering `⏎` as a command's shortcut would bind a bare `Enter` app-wide.
   - The README says reduced motion uses "plain `ease-enter`", and the brand book says every duration is 0 except opacity fades capped at `duration-instant`. Built per the brand book: no scale, an opacity fade on `--duration-instant` with `--ease-enter`.
   - The README's **Provide** also lists "the entity search". The palette lists registered commands only. Entities (sessions, PRs, tasks) appear when a screen registers them as commands with linked ids in `keywords`. No entity-search source exists yet.
6. **Keyboard-map behaviours to review (mechanism, not policy):**
   - The listener is on `window` in the capture phase, so no component can swallow `⌘K` or `⌘⇧K`.
   - Shortcuts with `⌘`, `⌥` or `⌃` fire from text fields and while the palette is open. Single-key ones (`A`, `⇧A`, `D`, `J`, `K`) never do.
   - A held key (`event.repeat`) runs no registry command, so holding `A` can't approve twice.
   - Keys inside an IME composition (`isComposing`, or `keyCode` 229) belong to the IME: no single-key shortcut (`A`, `⏎`) fires, `listMove` returns 0, and the palette's input ignores Enter, Esc and the arrows until the composition ends. Chords with `⌘`, `⌥` or `⌃` still fire.
   - A mouse-down anywhere in the palette's shell except the input is prevented, so focus never leaves the input that owns the palette's keys. `⌘K` while the palette is already open puts focus back in the input.
   - Collisions are judged at key time among the currently enabled commands, so a disabled twin is no collision. They are reported through `onCollision` (default `console.error`) when the key is pressed, not when the commands are registered.
   - Matching follows the brief, against `KeyboardEvent.key`. On macOS, `⌥` plus a letter produces a composed character (`⌥A` gives `å`), so a `⌥`-letter shortcut never matches. No such shortcut exists today; matching on `event.code` would fix it but would break non-QWERTY layouts.
   - `⌘,` (Settings, brand book §Keyboard) is unbound until a screen registers a command with that shortcut.
   - A command runs one microtask after the palette closes. That way, a command that moves focus (for example, to a field on its screen) keeps it instead of losing it to the close's focus restore.
7. **Not observed:** the e2e ran on macOS only. The CI `app` job (Linux, xvfb) runs the same spec but was not observed for this change. VoiceOver output was not checked; the roles and attributes are asserted in the tests.
