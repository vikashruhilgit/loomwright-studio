# Supervisor Job: Mount the screen shortcuts, the ⌘K palette and the Keyboard map view (phase 7, item 13)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-042119/L3
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090013-keyboard-map-palette-and-screen-shortcuts.md
- **Base commit:** daed1eab9fafe3f5429ca2d3f6efd13609bc7ada

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React 19 + Electron 44 renderer, vitest units, Playwright e2e through `app/e2e/electron-harness.ts`; everything needed is already in `app/package.json`. |
| 2 | Dependency Availability | GO | The keyboard map (`app/src/commands/keyboard.ts`: `installKeyboardMap`, `isEditableTarget`, `isComposingKey`, `RESERVED_SHORTCUTS`), the palette (`app/src/components/CommandPalette/CommandPalette.tsx`: `CommandPalette`, `CommandPaletteHost`) and the registry already exist and are tested. Every nav screen already declares its `nav.shortcut` (`⌘1`…`⌘9`, `⌘,`) and `App.tsx` already registers them as `Screens` commands. Only the mount is missing. |
| 3 | Architecture Fit | GO | Screens are discovered by `import.meta.glob("./screens/*/index.tsx")`, so `screens/keymap/` plugs in with no shared list edit. A screen with no `nav` is reached only by route or palette (`screens/types.ts`), which is exactly the mockup's `keymap` (`k:''`, `parent:'settings'`). |
| 4 | Scope vs Supervisor Capability | GO | One worker: about 6 source/test files to create and 5 to modify, all coupled through the one shell mount. No split reason fires. |
| 5 | Hard Blockers | GO | Dependency item 090011 (shell frame) merged as PR #192 (`a5307b9`). The Electron main process sets no application menu (`electron/` has no `setApplicationMenu`), so no menu accelerator competes for ⌘1–⌘9 / ⌘, / ⌘K today. |

**Overall Verdict:** GO

## Task
**Goal:** Mount one global keyboard map and the existing ⌘K palette in the app shell, add the Keyboard map screen (`#/keymap`, opened with `?` and from the palette), and close item 10's `keymap` known gap.

**Problem Statement:**
The owner needs ⌘1–⌘9, ⌘, and ⌘K to work as the sidebar labels and the GUI v2 mockup promise, and a Keyboard map opened with `?`, because UI.md makes the app keyboard-first and the 2026-11-01 phase 7 exit live run failed on both.
Currently `app/src/App.tsx` registers each sidebar entry as a palette command, but nothing mounts `installKeyboardMap` or a palette, so every ⌘ key and ⌘K does nothing in a launched window, and the mockup's `keymap` view has no screen (`KNOWN_GAPS = ["keymap"]` in `app/e2e/phase-7-exit.spec.ts`). J/K on Tasks, Playbooks and Memory was never checked with the window in the foreground.
Success looks like: every labelled shortcut opens its screen, ⌘K or `/` opens the palette with the screens and the current screen's commands, `?` opens the Keyboard map, text fields keep typing, `KNOWN_GAPS` is empty, and the polish-gate screenshots are committed.

**Owner decisions that bind this item (copied from the requirement, 2026-10-30 and 2026-11-01):** D3, D4, D9, D12, D22, D24, D26–D29, D34, D36 and invariants 1–9 hold. One GUI v2 mockup (`docs/design/mockups/gui-v2.html`) is the polish reference and the owner approves the PR as the gate (D9). Live-run screenshots of real data stay outside the repo; this item's screenshots come from the fixture kernel only. **Nothing is patched outside the item's Touches; a lane that needs another file stops and says so.** The requirement's Touches are `app/src/App.tsx`, `app/src/shell`, `app/src/screens/keymap`, `app/e2e/keyboard.spec.ts`, `app/e2e/phase-7-exit.spec.ts` and `docs/OPEN_QUESTIONS.md`. This brief adds only the two paths those six force: `app/src/App.test.tsx`, because its exact `toEqual` command-list pin breaks when the shell registers the "Keyboard map" command; and `docs/evidence/phase-7-polish/keyboard/`, which the evidence-file form of the polish-gate criterion requires. Both are listed in the File Impact Map with that reason. Stale statements elsewhere (`docs/architecture/app.md`, the shell evidence README, six e2e spec headers) are recorded as follow-ups in `docs/OPEN_QUESTIONS.md` (AC9) and are not edited.

**Non-goals:** new commands beyond those the screens already declare (the shell's one "Keyboard map" command is the mockup's own `mk('Help',…,'Keyboard map','?',…)` entry); rebinding keys; changes to `app/src/commands/`, `app/src/components/CommandPalette/`, any other screen's folder, or `app/electron/`; the Settings "Keyboard map — Open ?" row (Settings is outside Touches; AC9 records it as a follow-up in `docs/OPEN_QUESTIONS.md`).

## Acceptance Criteria
- [ ] AC1. Given any screen, when I press ⌘1–⌘9 or ⌘,, then the labelled screen opens (Chat ⌘1 … Memory ⌘9, Settings ⌘,), exactly once per press.
- [ ] AC2. Given any screen, when I press ⌘K, then the palette opens, lists the Screens group and the current screen's own registered commands, filters as I type, runs the selected command on Enter and closes on Esc with focus back where it was. `/` outside a text field also opens it, as the mockup's keymap says ("⌘K or /").
- [ ] AC3. Given focus in a text field (the Chat composer, the Memory edit textarea), when I press J, K, `/` or `?`, then the character is typed and nothing navigates or opens.
- [ ] AC4. Given `?` outside a text field, then the Keyboard map opens at `#/keymap` and matches the mockup's `keymap` view in light and dark: a Back control that returns to the screen it was opened from, the "Go to a screen" table (each nav screen with its shortcut, or "none" / "palette only" for Budget & audit), the "Anywhere" keys table, and "Palette commands by screen". The palette also lists a "Keyboard map" command that opens it.
- [ ] AC5. Given Tasks, Playbooks and Memory with the window focused (Playwright drives the launched window in the foreground), when I press J / K, then the selection moves; Enter opens the selected item; Esc returns to the list with focus on that item.
- [ ] AC6. Given `app/e2e/phase-7-exit.spec.ts`, then `KNOWN_GAPS` is empty, `keymap` is a `CLICK_THROUGH` view mapped to a test in `app/e2e/keyboard.spec.ts` by its title prefix, and both AC3 mockup-coverage tests pass.
- [ ] AC7. Given ⌘ keys reach both the Electron menu and the page, then each of ⌘1–⌘9, ⌘, and ⌘K has exactly one owner, the renderer's keyboard map, pinned by a test that reads the launched app's application menu (`electronApp.evaluate`) and finds no item whose accelerator is one of those chords.
- [ ] AC7b. Given the kill confirm is open, however it was opened (⌘⇧K, the palette's "Kill switch…" command, or `menubarActions.askKill()` directly as the menubar button does), when I press ⌘K, `/`, ⌘3 or a registered single-key command (Approvals' `A`), then nothing runs behind it until the confirm closes. ⌘⇧K while a stop-all is already in flight settles at once and leaves no shortcut held. The keyboard host never calls `engage` itself. Unit pins for each case are in `app/src/shell/KeyboardHost.test.tsx`.
- [ ] AC8. Given the polish gate (D9), then a committed evidence file `docs/evidence/phase-7-polish/keyboard/README.md` names each committed screenshot (light and dark) against its `gui-v2.html` view (at least `keymap`, and the palette open over the view the shot was taken on), each taken by `app/e2e/keyboard.spec.ts` against the fixture kernel through `app/e2e/electron-harness.ts`, and the PR body links to it.
- [ ] AC9. Given `docs/OPEN_QUESTIONS.md`'s "Phase 7 exit: live run (item 10, owner)" entry, then it records both gaps (the ⌘ shortcuts and ⌘K, and the Keyboard map view) and the J/K foreground check as fixed by this item, and lists as a follow-up the six e2e spec headers made stale by the mount ("The shell does not mount the ⌘K palette…" in `budget`, `integrations`, `integrations-switch`, `memory`, `schedules` and `settings` `.spec.ts`, which are outside Touches and not edited here). The same follow-up list also names: `docs/architecture/app.md`'s "(a hint only: the palette is item 13's)"; `docs/evidence/phase-7-polish/shell/README.md`'s "The shell does not mount the palette or bind `⌘K` yet"; and the Settings screen's mockup row "Keyboard map — Open ?" if Settings lacks it. All three are outside Touches and not edited here.
- [ ] AC10. Validation passes: `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, and `bash scripts/check-docs.sh`.

**Implementation notes (verified at the base commit, for the worker):**
- `CommandPaletteHost` keeps its open state private and opens only on `⌘K`, so `/` cannot reach it from outside. The shell's host (`app/src/shell/KeyboardHost.tsx`) therefore composes the exported primitives: the controlled `CommandPalette` plus `installKeyboardMap({ registry, openPalette, isPaletteOpen, killSwitch })`, following `CommandPaletteHost`'s open, `focusRequest` and close logic. It also adds one listener for the two bare keys the map does not own, `/` (palette) and `?` (keymap). That listener skips `isEditableTarget(event.target)`, `isComposingKey(event)`, any modifier other than ⇧, and an open palette. Reuse those helpers from `commands/keyboard.ts`; do not reimplement them.
- `?` arrives as `key: "?"` with `shiftKey: true` on a US layout. `parseShortcut("?")` has `shift: false`, so a command registered with `shortcut: "?"` is display-only and never fires through the map. The shell listener owns `?`. Pin that one `?` opens the keymap once.
- Kill switch (`⌘⇧K`, reserved in `RESERVED_SHORTCUTS`): the main window already has one kill confirm, `menubarActions.askKill()` in `screens/menubar/MenubarHost.tsx`, which is always mounted as the menubar screen's `SidebarSection` and renders its confirm through a portal. The same confirm also opens without ⌘⇧K: from the palette's "Kill switch…" command (`if (action === "kill-switch") actions.askKill();` in MenubarHost.tsx, which this item makes reachable by mounting the palette) and from the menubar panel button. The hold therefore depends on **`menubarActions.getSnapshot().confirmingKill`**, never on which opener was used:
  - **Guarded registry view (the one home of the hold).** `installKeyboardMap` re-reads each command's `enabled` at keypress (`isEnabled`), so the host passes it a view of the registry. The view's `list()` / `get()` return each command with `enabled: () => !menubarActions.getSnapshot().confirmingKill && original.enabled?.() !== false`, and its `subscribe` and `register` delegate to the real registry. This holds back every registry binding while the confirm is open: ⌘1–⌘9, ⌘,, Approvals' `A` / `⇧A` / `D`, and any other screen's chord. The palette itself is given the real registry.
  - The host's `openPalette` and its `/` / `?` listener do nothing while `confirmingKill` is true.
  - `killSwitch.confirm` calls `menubarActions.askKill()`, then reads `getSnapshot().confirmingKill` straight away. If that is `false` (a stop-all was already in flight, so `askKill` returned without opening anything), it resolves `false` at once. Otherwise it resolves `false` once `subscribe` reports `confirmingKill === false`, and then unsubscribes. This meets KillSwitch's contract that `confirm` "must settle … however the confirm goes away".
  - `engage` is a no-op, because the confirm's own button sends `POST /stop-all` through `confirmKill`. This keeps one confirm, not two.
  - Both `getSnapshot` and `subscribe` are public on `MenubarActions`, so importing `menubarActions` edits nothing in `screens/menubar/`.
- AC7's menu test walks `Menu.getApplicationMenu()` recursively, including submenus, and checks both `item.accelerator` and `item.role`. Electron installs a default role-based menu when none is set, and a role's built-in accelerator may not appear in `accelerator`.
- The keymap screen is `app/src/screens/keymap/index.tsx` exporting `screen: ScreenDefinition` with `id: "keymap"`, `title: "Keyboard map"` and **no `nav`** (so it is not a sidebar entry and not a `screens.*` command). Its "Go to a screen" rows come from the shell's `SCREENS` and their `nav.shortcut`, and its palette-commands table lists what the registry holds, so the view does not drift from the keys.

## Touched-file invariants

> Grounded at base `daed1eab9fafe3f5429ca2d3f6efd13609bc7ada`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/App.tsx`** (92). Keep: screen discovery by glob, never a hand list: `import.meta.glob<ScreenModule>("./screens/*/index.tsx", { eager: true })` and the header line `so no item edits this file`. Keep the default route `export const DEFAULT_SCREEN = "chat";` and the nav-only screen commands `SCREENS.filter((s) => s.nav !== undefined)`. Reuse: the one navigation helper `function go(id: string)` (`window.location.hash = \`#/${id}\``) for ⌘ keys, `?` and the palette, never a second router. Keep `registry = commandRegistry` as the injectable default, so `App.test.tsx` keeps rendering with its own registry and the shell host must take the same `registry` prop. Pinned by: `app/src/App.test.tsx` `it("registers each sidebar entry as a palette command"` (an exact `toEqual` list of 11 `screens.*` rows) and `it("routes each entry to its screen, Chat first"`.
- **`app/src/App.test.tsx`** (108). Keep: the exact-list pin style (`expect(registry.list().map((c) => [c.id, c.group, c.shortcut])).toEqual([`). Extend it with the shell's keymap command row; do not loosen it to `toContain`.
- **`app/e2e/phase-7-exit.spec.ts`** (1021, ≥500: appended to, not split, because it is the single authority for the mockup-coverage classification and this item only changes values in it). Keep: the three-way classification `walked`, `click-through` or `gap` with "exactly one" (`views counted twice (walked, mapped or a gap, not two of them)`). Keep the README anchors `expect.soft(views.at(-1)).toBe("keymap");` and `toHaveLength(51)`, and `expect.soft(walked, "40 states are walked").toHaveLength(40);` unchanged. Mirror: `CLICK_THROUGH` maps a view to `{ spec, title }` and the second AC3 test greps `test("${title}` in `join(SPEC_DIR, spec)`, so the `keymap` entry's title must be the literal prefix of a `test("…` in `app/e2e/keyboard.spec.ts`. Change: `const KNOWN_GAPS: readonly string[] = ["keymap"];` becomes empty. `expect.soft(KNOWN_GAPS, "the known gaps are exactly the Keyboard map").toEqual(["keymap"]);` becomes an empty-list assertion. `expect.soft(clicked, "10 views are mapped to a click-through").toHaveLength(10);` becomes 11. The doc comment above `KNOWN_GAPS` ("the shell mounts no global keyboard map or command palette") is rewritten.
- **`app/src/commands/keyboard.ts` and `app/src/components/CommandPalette/CommandPalette.tsx`** (read-only for this item, outside Touches). Reuse, do not edit: `export const RESERVED_SHORTCUTS: readonly string[] = ["⌘K", "⌘⇧K"];`, `export function isEditableTarget`, `export function isComposingKey`, `export function installKeyboardMap`, `export function CommandPalette(props: CommandPaletteProps)`. Keep the map's rule `// A single-key shortcut (no modifier, or ⇧ alone) never fires into a text` in the shell's own `/` and `?` listener too.

## Closed enumerations touched

> Sibling grep at base `daed1eab`: `grep -rnF '"budget"' app/src app/electron app/e2e app/scripts` → 7 hits in 7 files (`budget` is the one other nav screen whose shortcut is absent, the nearest sibling of a new screen id).

- **`keymap`** (new screen id; sibling: `budget`). It must be named in:
  - `app/e2e/phase-7-exit.spec.ts`: `CLICK_THROUGH` (the closed view→spec map, `const CLICK_THROUGH: Readonly<Record<string, { readonly spec: string; readonly title: string }>> = {`). Extend: add `keymap`. Remove it from `KNOWN_GAPS`.
  - `app/src/App.test.tsx` `for (const id of ["team", "approvals", …, "chat"])`: the nav-screen click loop. No change: keymap has no sidebar entry.
  - `app/e2e/phase-7-exit.spec.ts` `id: "budget",` (in `CASES`, the walked states). No change: keymap is a click-through, not a walked state.
  - `app/e2e/fixtures/phase-7-exit.ts` `from("budget", …)`: the fixture routes per screen. No change: keymap reads no kernel route.
  - `app/src/screens/budget/*` (4 hits): the screen's own id and owner. No change.
  - `app/src/shell/Sidebar.tsx` `NAV_GLYPHS` (keyed by screen id): no change, because it covers nav entries only and keymap has none.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/e2e/keyboard.spec.ts`: ⌘1–⌘9 / ⌘, open the labelled screen (AC1) | delete `useScreenCommands(registry);` in `app/src/App.tsx` |
| `app/e2e/keyboard.spec.ts`: ⌘K opens the palette (AC2) | delete `<KeyboardHost` in `app/src/App.tsx` |
| `app/e2e/keyboard.spec.ts`: `/` outside a text field opens the palette (AC2) | delete the `/` branch of the bare-key listener in `app/src/shell/KeyboardHost.tsx` |
| `app/e2e/keyboard.spec.ts`: Esc closes the palette with focus back on the element that had it (AC2) | drop the palette's `onClose` wiring (pass a no-op instead of the host's `close`) in `app/src/shell/KeyboardHost.tsx` (Esc then leaves the palette open) |
| `app/e2e/keyboard.spec.ts`: the keymap's Back returns to the screen it was opened from (AC4) | make Back navigate to `DEFAULT_SCREEN` instead of the remembered opener in `app/src/screens/keymap/KeymapScreen.tsx` (a test that opens the keymap from Tasks then turns red) |
| `app/e2e/keyboard.spec.ts`: J / K move, Enter opens, Esc returns focus on Tasks, Playbooks and Memory (AC5) | scratch-only, never committed: in a scratch copy, delete the `case "j":` arm in `app/src/screens/tasks/TasksScreen.tsx` (and, separately, the `event.key !== "j" && event.key !== "k"` guard's J branch in `app/src/screens/playbooks/PlaybooksScreen.tsx`); the AC5 test for that screen must turn red |
| `app/e2e/keyboard.spec.ts`: J / K / `/` / `?` typed into a text field navigate nowhere (AC3) | delete the `isEditableTarget(event.target)` early return in the `/`-and-`?` listener of `app/src/shell/KeyboardHost.tsx` |
| `app/e2e/keyboard.spec.ts`: `?` opens the Keyboard map once (AC4) | flip `"keymap"` → `"chat"` in the `?` branch of `app/src/shell/KeyboardHost.tsx` |
| `app/e2e/keyboard.spec.ts`: no application-menu accelerator owns ⌘1–⌘9 / ⌘, / ⌘K (AC7) | add a menu item with `accelerator: "CmdOrCtrl+1"` to the app's menu at startup (scratch copy of `app/electron/main.ts`), which must turn the pin red |
| `app/e2e/phase-7-exit.spec.ts`: `KNOWN_GAPS` is empty (AC6) | flip `KNOWN_GAPS: readonly string[] = []` → `KNOWN_GAPS: readonly string[] = ["keymap"]` in `app/e2e/phase-7-exit.spec.ts` (fails "views counted twice") |
| `app/e2e/phase-7-exit.spec.ts`: the `keymap` click-through test exists by title prefix (AC6) | flip the `keymap` test's `test("AC4:` → `test("AC4x:` in `app/e2e/keyboard.spec.ts` |
| `app/src/App.test.tsx`: the exact palette-command list, now with the keymap command | delete the keymap command's `id:` line in `app/src/shell/KeyboardHost.tsx` |
| `app/src/shell/KeyboardHost.test.tsx`: while the menubar kill confirm is open (`confirmingKill: true`), ⌘K and a registered `A` command do not run (AC7b) | make the host's `confirm` resolve `false` immediately after `menubarActions.askKill()`, without waiting for `confirmingKill === false`, in `app/src/shell/KeyboardHost.tsx` |
| `app/src/shell/KeyboardHost.test.tsx`: confirm opened by `menubarActions.askKill()` directly (the palette / menubar-button path): ⌘3, `A` and ⌘K do not run (AC7b) | drop the `!menubarActions.getSnapshot().confirmingKill &&` term from the guarded registry view's `enabled` wrapper in `app/src/shell/KeyboardHost.tsx` (⌘3 and `A` then run) |
| `app/src/shell/KeyboardHost.test.tsx`: same opener, ⌘K and `/` open no palette (AC7b) | delete the `confirmingKill` early return in the host's `openPalette` in `app/src/shell/KeyboardHost.tsx` |
| `app/src/shell/KeyboardHost.test.tsx`: ⌘⇧K while `busy` holds `"kill-switch"` settles at once and ⌘3 still navigates (AC7b) | delete the immediate `getSnapshot().confirmingKill` check after `askKill()` in the host's `confirm` in `app/src/shell/KeyboardHost.tsx` (the Promise then hangs and ⌘3 is held) |
| `app/src/shell/KeyboardHost.test.tsx`: the host never calls `engage` (AC7b) | make `engage` call `menubarActions.confirmKill(api)` in `app/src/shell/KeyboardHost.tsx` (the test asserts no `POST /stop-all` from the host) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Shell keyboard host, ⌘K palette mount, Keyboard map screen, e2e + gap closure, polish evidence | AC1–AC10 (incl. AC7b) | 4 modify, ~10 create (incl. PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|-------------------------------|-----------------|------------|
| shell | `app/src/App.tsx` (92): mount `<KeyboardHost registry={registry} />` once | `app/src/shell/KeyboardHost.tsx` (new home: palette state, `installKeyboardMap`, `/` and `?` listener, kill-switch adapter, the "Keyboard map" command); `app/src/shell/KeyboardHost.test.tsx` | HIGH |
| shell tests | `app/src/App.test.tsx` (108): exact command-list pin gains the keymap command | — | HIGH |
| keymap screen | — | `app/src/screens/keymap/index.tsx`, `app/src/screens/keymap/KeymapScreen.tsx`, `app/src/screens/keymap/keymap.css`, `app/src/screens/keymap/keymap.test.tsx` | HIGH |
| e2e | `app/e2e/phase-7-exit.spec.ts` (1021, ≥500: appended because it is the single authority for the coverage classification; value changes only, no new responsibility) | `app/e2e/keyboard.spec.ts` (new home: AC1–AC5, AC7, the polish screenshots; follows `app/e2e/shell.spec.ts`'s `SHELL_EVIDENCE` pattern as `KEYBOARD_EVIDENCE=1`, with its own module-local `setTheme` / `screenshots` helpers as the 9 sibling specs do) | HIGH |
| docs | `docs/OPEN_QUESTIONS.md` (155): the phase 7 live-run entry, including the AC9 follow-up list | `docs/evidence/phase-7-polish/keyboard/README.md` + its `*-light.png` / `*-dark.png` (at least `keymap-light.png`, `keymap-dark.png`) | MEDIUM (exact PNG set depends on the views the worker shoots) |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans the docs tree. Files it scans (`docs/OPEN_QUESTIONS.md`, the new evidence README) may need link or format updates it flags.

**Module layout** (`skills/supervisor-readiness/SKILL.md` §"Module layout"): one new responsibility per CREATE home above. The keyboard host is a shell module, not appended to `App.tsx`, because it is a separate concern. The keymap view lives in its own screen folder. The e2e lives in its own spec, `keyboard.spec.ts`, because it is not appended to the 1021-line `phase-7-exit.spec.ts`. Source helpers are reused, not copied: the host reuses `commands/keyboard.ts` and the `CommandPalette` component, and the e2e reuses `launchApp` / `startFixtureKernel`. The per-spec e2e helpers (`setTheme`, `screenshots`, evidence-dir checks) are module-local in every spec today: `async function setTheme(` appears in 19 specs and `screenshots(` in 9, and `shell.spec.ts` exports nothing. So `keyboard.spec.ts` follows that existing per-spec convention. Extracting a shared e2e helper module would edit specs outside Touches, so it is not done here. It is noted as a follow-up in the `docs/OPEN_QUESTIONS.md` entry instead.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/shell/KeyboardHost.tsx"}
  - {kind: "symbol", path: "app/src/shell/KeyboardHost.tsx", name: "KeyboardHost"}
  - {kind: "file", path: "app/src/screens/keymap/index.tsx"}
  - {kind: "symbol", path: "app/src/screens/keymap/index.tsx", name: "screen"}
  - {kind: "file", path: "app/e2e/keyboard.spec.ts"}
  - {kind: "symbol", path: "app/e2e/phase-7-exit.spec.ts", name: "KNOWN_GAPS"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/keyboard/README.md"}
requires: []
lanes:
  - "app/src/App.tsx"
  - "app/src/App.test.tsx"
  - "app/src/shell/**"
  - "app/src/screens/keymap/**"
  - "app/e2e/keyboard.spec.ts"
  - "app/e2e/phase-7-exit.spec.ts"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/evidence/phase-7-polish/keyboard/**"
external_requires:
  - "Playwright Electron (`_electron`) via app/e2e/electron-harness.ts, focused window"
  - "macOS for the committed screenshots (fonts differ on the Ubuntu CI run; the spec asserts behaviour, never pixels)"
```


## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/e2e/phase-7-exit.spec.ts:943` | yes | HOLDS (moved to 944) | `const KNOWN_GAPS: readonly string[] = ["keymap"];` | tip 5 minutes ago, fetched <1h |
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 5 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Electron menu accelerators and the page's key handler both fire on a ⌘ key (requirement risk) | MEDIUM | Today no application menu is set. AC7 pins one owner per chord by reading `Menu.getApplicationMenu()` in the launched app. If Electron's default menu claims one of the chords, stop and say so: `app/electron/` is outside Touches. |
| `/` cannot open the shared `CommandPaletteHost` from outside (its open state is private) | MEDIUM | The shell host composes `CommandPalette` + `installKeyboardMap` itself (implementation notes). Do not edit `components/CommandPalette/` (outside Touches). Keep its `CommandPalette.test.tsx` and `components.palette.spec.ts` green. |
| `?` registered as a command `shortcut` never fires (`parseShortcut("?")` has no ⇧, the event does) | MEDIUM | The shell's bare-key listener owns `?`. The command's shortcut is display-only. A pin asserts one `?` opens the keymap exactly once. |
| Two kill-switch confirms, or shortcuts firing behind the open kill confirm (safety kernel, invariant 3) | HIGH | The hold reads `menubarActions.getSnapshot().confirmingKill` through the host's guarded registry view, its `openPalette` and its bare-key listener, so it works whichever opener was used (⌘⇧K, the palette's "Kill switch…", the menubar button). `confirm` settles at once when `askKill` opened nothing. AC7b's unit pins cover each opener and each has a mutation row. |
| Six e2e spec headers become stale ("The shell does not mount the ⌘K palette…" in budget, integrations, integrations-switch, memory, schedules, settings) | LOW | They are outside Touches and not edited. AC9 records them as a follow-up in the `docs/OPEN_QUESTIONS.md` entry. |
| J/K on Tasks/Playbooks/Memory may not move with a foreground window (unverified in the live run) | MEDIUM | AC5's e2e settles it. If a screen's own handler is broken, the fix lives in that screen's folder, which is outside Touches: stop and say so, and do not patch it here. |
| A screen's own window `keydown` handler (Tasks, Playbooks) and the keyboard map both act on one key | LOW | The map listens in the capture phase and ignores bare keys that are not bound. AC5/AC3 e2e cover the interaction. |
| The polish-gate screenshots dirty tracked files in CI | LOW | Mirror `shell.spec.ts`: write to `docs/evidence/phase-7-polish/keyboard/` only with `KEYBOARD_EVIDENCE=1`, otherwise to Playwright's output dir, and add a test that fails if a tracked evidence file is newer than the run's start. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-keyboard-map-palette-screen-shortcuts.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T08:13:38Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/194
- **Branch:** feature/keyboard-map-palette-screen-shortcuts
- **Files changed:** 20
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** KeyboardHost mounts the ⌘1–⌘9, ⌘,, ⌘K, / and ? keys with the kill-confirm hold. Adds the #/keymap screen, keyboard.spec.ts, an empty KNOWN_GAPS, the polish evidence and the OPEN_QUESTIONS follow-ups. Phase 4.5 iteration 1 found 2 MEDIUM and 1 LOW. The fix (0ba5ce7) made KeymapScreen use the shared Badge Kbd. Re-review PASS with 2 nits. Known AC5 gap, not fixed: the Playbooks detail has no Esc handler. The fix is in app/src/screens/playbooks/, outside Touches per the brief's Risk Assessment, and was posted to the PR for the owner. 17 pin mutations are unverified by the runner (unsupported/not machine-applicable); a reviewer scratch run had rows 12–16 go red and row 17 stay green. The review-drain dispatch was skipped because .supervisor/config.json has auto_review false.

## Not verified
- **AC5 J/K with the OS-foreground window** — the harness keeps windows hidden by house rule; verified with Playwright page focus (subtask 1)
- **Native menu accelerator dispatch of the chords** — Playwright keys bypass the native menu; AC7 reads Menu.getApplicationMenu() instead (subtask 1)
