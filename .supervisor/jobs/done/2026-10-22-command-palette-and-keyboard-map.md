# Supervisor Job: Build the ⌘K CommandPalette and the global keyboard map over item 01's command registry

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-22-023903/L4
- **CLAUDE.md:** ✓ Found (fresh — `kernel/` + `app/` layout, invariants and conventions match the tree at the base commit)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140011-the-command-palette-and-keyboard-map.md
- **Base commit:** 58c2e4cad24d521b0880f36b9d0f22690847a9b8

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` is Electron + React 19 + TS + Vite with vitest + React Testing Library (`app/src/App.test.tsx` uses `// @vitest-environment jsdom`) and `@playwright/test` (Electron smoke in `app/e2e/smoke.spec.ts`). |
| 2 | Dependency Availability | GO | Everything needed is already a devDependency in `app/package.json` (react, @testing-library/react, vitest, jsdom, vite, @vitejs/plugin-react, electron, @playwright/test). No new npm dependency is needed or allowed. |
| 3 | Architecture Fit | CAUTION | The registry (`app/src/commands/registry.ts`, item 01's file) has no `icon`, `status`, `meta` or "destructive" field, although the palette README's **Provide** line lists icon/status/meta. `App.tsx` (item 01's shared file) has no mount point for a global overlay or key listener. The Dialog component the kill-switch confirm should use is item 08, which runs in parallel in this wave and is not on `main`. None of these files is in this item's Touches. |
| 4 | Scope vs Supervisor Capability | GO | One coherent group (palette dir + `keyboard.ts` + one e2e spec + evidence), about 9 code files, well under the context-bound split threshold. Single agent. |
| 5 | Hard Blockers | GO | No migration, credentials or missing modules. `app/node_modules` is not installed in this checkout; `npm ci` in `app/` installs it. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Build the approved CommandPalette (`app/src/components/CommandPalette/`) and the global keyboard map (`app/src/commands/keyboard.ts`) over item 01's command registry, exactly as the design system specifies, with unit tests, a Playwright page rendering every state, and committed light/dark screenshots.

**Problem Statement:**
The owner needs one palette and one keyboard map that every screen (items 13–17) reuses, because the brand book requires every action to be reachable without the mouse and each screen's polish gate checks this.
Currently, `app/src/commands/registry.ts` holds registered commands (with a display-only `shortcut`), but nothing lists them, searches them, or binds a key. This blocks the keyboard-only acceptance criteria of every screen item.
Success looks like this: a screen calls `commandRegistry.register(...)` and, with no edit to this item's files, its command shows up in the palette under its group, can be found by a fuzzy prefix, and runs from its `shortcut`. ⌘⇧K always goes through a confirm first.

### Design contract (from `docs/design/design-system/components/CommandPalette/README.md` + `preview.html`, `docs/design/brand-book.md` §Keyboard / §Motion, `docs/design/tokens.json`)
- **Palette shell:** 560px on `--surface-raised`, `--radius-lg`, `--shadow-3`, over `--overlay`, centred horizontally at 20% from the top. Open: `--duration-slow` `--ease-palette`, scaling from 0.98. Close: `--duration-fast`. Under `prefers-reduced-motion`, there is no scale. Per brand book §Motion, every duration is 0 except opacity fades, which are capped at `--duration-instant`, using `--ease-enter`. The list never animates on filter.
- **Anatomy:** a 44px search row (`title-2` size input, a 16px search icon as inline SVG with `stroke: currentColor`, an `Esc` kbd chip). A grouped list of 32px rows: a 16px leading slot, the label, and a right slot holding the `shortcut` as a kbd chip. A footer with `↑↓ move`, `⏎ open`, `⌘⏎ open in inspector`, and the attribution "Wright, powered by Claude". The kbd chip uses `--type-kbd-*`, `--surface-sunken`, a 1px `--hairline` border and `--ink-tertiary`. Group headers use the caption style in `--ink-tertiary`. The selected row is `--accent-soft` with `--accent` text.
- **Groups, in order:** Actions, Screens, Agents, Playbooks, Sessions, Tasks. Any other group name comes after these, in first-registration order. At most 8 rows show per group. Past 8, a "Show all" row expands that group (the README's **Don't** rule).
- **Matching:** fuzzy over each command's `title` and `keywords` (which carry linked ids such as PR numbers and ticket keys). Ranking: a prefix match on the title is best, then a word-start match, then an in-order subsequence. Ties keep registration order. An empty query lists every command in group order.
- **Keys inside the palette:** `↑`/`↓` move the selection, skipping group headers and disabled rows. `Enter` runs the selected command and closes. `⌘Enter` calls the optional `onOpenInInspector(command)` prop and closes; with no prop, it behaves as `Enter`. `Esc` clears a non-empty query, and closes when the query is empty (brand book: "`Esc` closes or clears"). Closing returns focus to the element focused before opening.
- **Disabled:** a command whose `enabled?.()` returns `false` renders `aria-disabled="true"` in `--ink-disabled`. `Enter` on it does nothing, and `↑`/`↓` skip it.
- **Accessibility (README §Accessibility):** `role="combobox"` on the shell with `aria-expanded` and `aria-haspopup="listbox"`. An input with `aria-label="Command"`, `aria-controls` pointing at the listbox, and `aria-activedescendant` set to the selected row's id. A `role="listbox"` list. `role="option"` rows with `aria-selected` on the active one. Group headers are `role="presentation"` and never options. Every control has a screen-reader label. Visible focus is `:focus-visible` with a 2px solid `--focus` outline at a 2px offset (tokens.json `focus` usage).
- **Global keyboard map (brand book §Keyboard):** `⌘K` opens the palette from anywhere. `⌘1`–`⌘4` switch screens: these are the `screens.*` commands that `App.tsx` already registers with `shortcut: "⌘1"`…`"⌘4"`, so binding registry shortcuts covers them. `J`/`K` (and `↓`/`↑`) move in lists through an exported helper a list can call. `A`, `⇧A` and `D` on approvals, and `⌘.` to stop the selected session, are bound when those screens register commands carrying those shortcuts. `⌘⇧K` is the kill switch: it always opens a confirm and never acts directly.

### Implementation constraints (binding)
- **Do not edit any file outside the File Impact Map.** In particular, do not edit `app/src/commands/registry.ts`, `app/src/App.tsx`, `app/src/main.tsx`, `app/vite.config.ts`, `app/package.json`, or anything under `app/src/components/<other>/`. A gap is recorded as a finding in the evidence file, never patched (requirement: "a lane that finds the contract (item 01) does not fit stops and says so rather than changing the contract").
- **No barrel file:** no `index.ts` re-export in `app/src/components/` or `app/src/components/CommandPalette/`. Consumers import `./components/CommandPalette/CommandPalette` by path.
- **Bindings come from the registry:** `keyboard.ts` derives every non-reserved binding from `CommandRegistry.list()`'s `shortcut` strings, and it re-derives on `subscribe`. A screen adds a key by registering a command; no edit to `keyboard.ts` is needed. `⌘K` and `⌘⇧K` are reserved, so a registered command carrying either shortcut is not bound to it.
- **Shortcut parsing:** glyphs `⌘` (metaKey), `⇧` (shiftKey), `⌥` (altKey) and `⌃` (ctrlKey), followed by one key (`K`, `1`, `.`, `A`), matched case-insensitively against `KeyboardEvent.key`. A binding matches only when the event's `metaKey`/`shiftKey`/`altKey`/`ctrlKey` set **equals** the parsed modifier set exactly. So `⇧A` never runs the `A` command or the reverse, and `⌘K`/`⌘⇧K` never reach the `K` list-move. The collision rule compares the full (modifiers + key) chord, so `A` and `⇧A` are not a collision. The app is macOS-only, so `⌘` is `metaKey`.
- **Collisions are refused, never silently overridden** (the registry's own rule): when two currently enabled commands share a shortcut, the key runs neither, and `keyboard.ts` reports the pair through an `onCollision` option (the default is `console.error`).
- **Single-key shortcuts** (no modifier, or `⇧` only: `J`, `K`, `A`, `⇧A`, `D`) never fire when the event target is editable (`input`, `textarea`, `select`, `[contenteditable]`) or while the palette is open.
- **Kill switch seam:** `installKeyboardMap` takes `killSwitch: { confirm: () => Promise<boolean>; engage: () => void | Promise<void> }`. `⌘⇧K` calls `confirm()` and calls `engage()` only when it resolves `true`. A second `⌘⇧K` while a confirm is pending opens nothing new (dialogs never stack, Dialog README). The real confirm (item 08's Dialog with `role="alertdialog"`) and the real engage (`POST /stop-all`) are wired by item 17, which depends on this item and item 08. This item ships the seam and proves it with a test double that renders a `role="alertdialog"`.
- **Host component:** `CommandPaletteHost` (in the palette dir) owns the open state and installs the keyboard map on mount (uninstalling it on unmount), so the shell needs exactly one element to mount. Mounting it in `App.tsx` is outside this item's Touches. Record that as a finding for the owner.
- **Colours:** styles use only `var(--…)` tokens from `app/src/styles/tokens.css`: no hex, `rgb()`, `hsl()` or named-colour literals. The leading-slot SVG uses `currentColor`.
- **E2E harness without new config or deps:** `app/e2e/components.palette.spec.ts` starts Vite programmatically (`createServer` from `vite`, already a devDependency, `root` = `app/`, port 0), loads a gallery page that lives in the palette dir (`app/src/components/CommandPalette/gallery.html` + `gallery.tsx`, which import `tokens.css` and render every state with fixture commands), and drives it in Electron through `_electron.launch` with a throwaway main script the spec writes to a temp dir. No edit to `vite.config.ts` or any Playwright config. `vite build` only builds `index.html`, so the gallery never ships. Themes: set `data-theme="light"` / `data-theme="dark"` on `<html>` (tokens.css supports both). Reduced motion: `page.emulateMedia({ reducedMotion: "reduce" })`. Screenshots are written only when an opt-in env var (named in the evidence README) is set, so a plain `npm run e2e`, locally or in CI, never dirties the tree.

## Acceptance Criteria
- [ ] **AC1 (states):** Given the palette README's and `preview.html`'s states, when `CommandPalette.test.tsx` renders each one, then each matches the README's rules: group order Actions → Screens → Agents → Playbooks → Sessions → Tasks (others after), at most 8 rows per group plus a "Show all" row that expands it, the selected row carrying `aria-selected="true"` and the selected class, a disabled command rendered `aria-disabled="true"` and not run on `Enter`, an empty-match state, the `Esc` chip, the footer keys and the "Wright, powered by Claude" attribution, and the combobox roles (`role="combobox"`, `aria-activedescendant` naming the selected `role="option"`, group headers not options).
- [ ] **AC2 (kill switch):** Given the keyboard map installed with a `killSwitch` test double, when `⌘⇧K` is pressed, then the confirm opens (the double renders a `role="alertdialog"`) and `engage` has not been called. Confirming calls `engage` exactly once, cancelling never calls it, a second `⌘⇧K` while pending opens no second confirm, and a registered command carrying shortcut `⌘⇧K` is not run by the key (`keyboard.test.ts`).
- [ ] **AC3 (fuzzy):** Given a command a screen registered through `createCommandRegistry().register("approvals", [...])` (for example `title: "Approve once"`, `keywords: ["#412"]`), when the palette's query is a prefix (`"appr"`), a word-start (`"once"`), an in-order subsequence (`"apon"`) or a linked id (`"412"`), then the palette lists it, a title-prefix match ranks above a subsequence match, and a non-matching query shows the empty state (`CommandPalette.test.tsx`).
- [ ] **AC4 (tokens only):** Given dark mode, then every component uses the dark tokens with no hard-coded colour. A test reads the shipped code under test: `CommandPalette.css`, `CommandPalette.tsx`, `fuzzy.ts` (when it exists) and `app/src/commands/keyboard.ts`. It excludes `*.test.*` files, `gallery.*` (whose fixtures legitimately carry ids such as `#412`) and `tokens.css`. It fails on any hex colour literal (`#[0-9a-fA-F]{3,8}\b`), any `rgb(`/`rgba(`/`hsl(`/`hsla(` call, or any named colour as a colour property value. It also fails if any `var(--name)` used in `CommandPalette.css` is not defined in `app/src/styles/tokens.css`.
- [ ] **AC5 (keyboard only):** Given keyboard only, when `⌘K` is pressed outside a text field, then the palette opens with focus in the input. `↑`/`↓` move the selection (skipping headers and disabled rows), `Enter` runs it, `⌘Enter` calls `onOpenInInspector` when given, `Esc` clears and then closes, and focus returns to the element focused before opening. A shortcut registered by a screen owner runs its command with no edit to `keyboard.ts`. The pin registers through `createCommandRegistry().register("approvals", [{ id: "approvals.approve-once", shortcut: "A", ... }])`, under a non-`"shell"` owner, and dispatches the key on a non-editable target. A second case registers `screens.approvals` with `shortcut: "⌘3"` and checks that `⌘3` runs it while a plain `3` does not. A third case registers a command **after** `installKeyboardMap` has been called and checks that its shortcut is bound (re-derive on `subscribe`). Modifiers match exactly: `⇧A` does not run the `A` command, `A` does not run the `⇧A` command, and `⌘K` does not move a list. Single-key shortcuts do not fire while `isPaletteOpen()` is true; a single-key shortcut (`A`) does not fire inside an `<input>`; two enabled commands sharing a shortcut run neither and report the collision; the list helper maps `J`/`↓` to +1 and `K`/`↑` to −1; and focusable elements carry a `:focus-visible` outline using `var(--focus)` (`keyboard.test.ts`, `CommandPalette.test.tsx`).
- [ ] **AC6 (evidence and validation):** Given `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, and `npm run e2e` passes `components.palette.spec.ts` (every state rendered in light and dark, plus the open state under reduced motion), then the screenshots are committed under `docs/evidence/phase-5-polish/components/palette/`. A committed evidence file `docs/evidence/phase-5-polish/components/palette/README.md` lists each screenshot with the `preview.html` / README state it matches, the env var that regenerates them, and the findings for the owner: the registry has no icon/status/meta fields, so the leading slot and meta text are not rendered; `App.tsx` has no mount point, so `CommandPaletteHost` is not yet mounted; the `⌘Enter` inspector seam; the kill-switch confirm to be wired by item 17 with item 08's Dialog; and any README-vs-preview mismatch found. The PR body links to it.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/commands/keyboard.test.ts` — "⌘⇧K never engages before confirm" | in `app/src/commands/keyboard.ts`, call `killSwitch.engage()` before awaiting `killSwitch.confirm()` → the test must go red |
| `app/src/commands/keyboard.test.ts` — "screen-registered shortcut binds with no edit" (owner `"approvals"`, shortcut `A`) | in `app/src/commands/keyboard.ts`, skip commands whose `owner` is not `"shell"` when deriving bindings → red |
| `app/src/commands/keyboard.test.ts` — "cancelling never engages" | in `app/src/commands/keyboard.ts`, call `killSwitch.engage()` regardless of the `confirm()` result → red |
| `app/src/commands/keyboard.test.ts` — "second ⌘⇧K while pending opens no second confirm" | in `app/src/commands/keyboard.ts`, delete the pending-confirm guard → red |
| `app/src/commands/keyboard.test.ts` — "a registered ⌘⇧K command is not run by the key" | in `app/src/commands/keyboard.ts`, delete `⌘⇧K` from `RESERVED_SHORTCUTS` → red |
| `app/src/commands/keyboard.test.ts` — "colliding shortcut runs neither and reports" | in `app/src/commands/keyboard.ts`, run the first matching command on a collision instead of refusing → red |
| `app/src/commands/keyboard.test.ts` — "single-key shortcut ignored in an input" | in `app/src/commands/keyboard.ts`, delete the editable-target guard line → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "Enter on a disabled command does nothing" | in the palette's `Enter` handler, drop the `enabled?.()` check → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "more than 8 rows shows Show all" | change the per-group row cap from `8` to `Infinity` → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "undefined var(--name) fails" | in `app/src/components/CommandPalette/CommandPalette.css`, use `var(--not-a-token)` in one declaration → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "focus returns on close" | in `app/src/components/CommandPalette/CommandPalette.tsx`, delete the focus-restore call → red |
| `app/src/commands/keyboard.test.ts` — "a command registered after install is bound" | in `app/src/commands/keyboard.ts`, derive bindings once at install and drop the `registry.subscribe` re-derive → red |
| `app/src/commands/keyboard.test.ts` — "modifiers match exactly (`⇧A` ≠ `A`, `⌘K` ≠ `K`)" | in `app/src/commands/keyboard.ts`, check only the modifiers the shortcut requires instead of equality → red |
| `app/src/commands/keyboard.test.ts` — "`⌘3` runs `screens.approvals`, plain `3` does not" | in `app/src/commands/keyboard.ts`'s `parseShortcut`, ignore the `⌘` glyph (no `metaKey` requirement) → red |
| `app/src/commands/keyboard.test.ts` — "single-key shortcuts suppressed while the palette is open" | in `app/src/commands/keyboard.ts`, delete the `isPaletteOpen()` guard → red |
| `app/src/commands/keyboard.test.ts` — "`listMove` maps `J`/`↓` to +1, `K`/`↑` to −1" | in `app/src/commands/keyboard.ts`'s `listMove`, swap `+1` and `-1` → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "group order Actions → Screens → Agents → Playbooks → Sessions → Tasks, others after" | in the palette's group-order constant, swap `"Actions"` and `"Screens"` → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "`Esc` clears a non-empty query, then closes" | in the palette's `Esc` handler, always call `onClose()` → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "`⌘Enter` calls `onOpenInInspector`, else acts as `Enter`" | in the palette's key handler, delete the `onOpenInInspector` branch → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "title-prefix match ranks above a subsequence match" | in the matcher, give a subsequence match a higher score than a prefix match → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "`↑`/`↓` skip disabled rows and headers" | in the palette's move handler, drop the disabled-row skip → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "a non-matching query shows the empty state" | in `app/src/components/CommandPalette/CommandPalette.tsx`, render nothing when there are zero matches → red |
| `app/src/commands/keyboard.test.ts` — "`⌘K` outside a text field opens the palette" | in `app/src/commands/keyboard.ts`, delete the `⌘K` → `openPalette()` binding → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "opening puts focus in the input" | in `app/src/components/CommandPalette/CommandPalette.tsx`, delete the focus-the-input call on open → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "`Enter` runs the selected command and closes" | in the palette's `Enter` handler, delete the `run()` call → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "activating Show all lists every row of that group" | in `app/src/components/CommandPalette/CommandPalette.tsx`, make Show all a no-op (never set the expanded group) → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "rgb()/hsl() literal guard" | add `background: rgb(0 0 0);` to any rule in `app/src/components/CommandPalette/CommandPalette.css` → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "`:focus-visible` outline uses `var(--focus)`" | in `app/src/components/CommandPalette/CommandPalette.css`, delete the `:focus-visible` outline declaration → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "word-start match (`once`)" | in the matcher, drop the word-start tier and require the query to be a title prefix or a subsequence starting at index 0 → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — "linked id match (`412` finds `keywords: [\"#412\"]`)" | in the matcher, match on `title` only (ignore `keywords`) → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — hex-literal guard | add `color: #000;` to any rule in `app/src/components/CommandPalette/CommandPalette.css` → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — fuzzy prefix | in the palette's matcher, require `title.toLowerCase() === query` → red |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` — combobox aria | delete the `aria-activedescendant` attribute in `app/src/components/CommandPalette/CommandPalette.tsx` → red |

## File Impact Map

| Path | Action | Confidence | Notes |
|------|--------|------------|-------|
| `app/src/components/CommandPalette/CommandPalette.tsx` | create | HIGH | `CommandPalette` (controlled: `registry`, `open`, `onClose`, optional `onOpenInInspector`) and `CommandPaletteHost` (owns open state, installs the keyboard map). Parent dir `app/src/components/` is created with it. |
| `app/src/components/CommandPalette/CommandPalette.css` | create | HIGH | Token-only styles, reduced-motion block. |
| `app/src/components/CommandPalette/fuzzy.ts` | create | MEDIUM | `fuzzyMatch(query, command)` scoring and `groupCommands(...)` ordering. May be folded into `CommandPalette.tsx` if small. |
| `app/src/components/CommandPalette/CommandPalette.test.tsx` | create | HIGH | AC1, AC3, AC4, AC5 (palette side). jsdom env pragma as in `app/src/App.test.tsx`. |
| `app/src/components/CommandPalette/gallery.html` | create | MEDIUM | E2E-only page served by the spec's Vite dev server; never built. |
| `app/src/components/CommandPalette/gallery.tsx` | create | MEDIUM | Renders every state with fixture commands; imports `../../styles/tokens.css`. |
| `app/src/commands/keyboard.ts` | create | HIGH | `parseShortcut`, `installKeyboardMap({ registry, target?, openPalette, isPaletteOpen, killSwitch, onCollision? })` → uninstall, `listMove(event)` helper, `RESERVED_SHORTCUTS`. |
| `app/src/commands/keyboard.test.ts` | create | HIGH | AC2, AC5 (key side). Starts with the `// @vitest-environment jsdom` pragma, as `app/src/App.test.tsx` does. There is no vitest config, so the default environment is node. |
| `app/e2e/components.palette.spec.ts` | create | MEDIUM | Vite `createServer` + `_electron.launch`; light/dark/reduced-motion; opt-in screenshot writing. Typechecked by `app/tsconfig.node.json` (`"include": [..., "e2e", ...]`). |
| `docs/evidence/phase-5-polish/components/palette/README.md` | create | HIGH | AC6 evidence file and owner findings. |
| `docs/evidence/phase-5-polish/components/palette/*.png` | create | MEDIUM | One per state per theme (about 12 images). |

Existing files read, not modified: `app/src/commands/registry.ts` (`export interface Command`, `createCommandRegistry`), `app/src/App.tsx` (`useScreenCommands` registers `screens.*` with `shortcut`), `app/src/styles/tokens.css`, `app/e2e/smoke.spec.ts` (`_electron as electron` launch pattern), `app/package.json` (`"test": "vitest run src electron scripts"`, `"e2e": "playwright test e2e --workers=1"`).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | CommandPalette, keyboard map, e2e gallery and evidence | all | 0 modify, 11 create (+ screenshots) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — CommandPalette + keyboard map + e2e gallery + evidence (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/components/CommandPalette/CommandPalette.tsx"}
  - {kind: "symbol", path: "app/src/components/CommandPalette/CommandPalette.tsx", name: "CommandPalette"}
  - {kind: "symbol", path: "app/src/components/CommandPalette/CommandPalette.tsx", name: "CommandPaletteHost"}
  - {kind: "file", path: "app/src/components/CommandPalette/CommandPalette.css"}
  - {kind: "file", path: "app/src/components/CommandPalette/CommandPalette.test.tsx"}
  - {kind: "file", path: "app/src/components/CommandPalette/gallery.html"}
  - {kind: "file", path: "app/src/components/CommandPalette/gallery.tsx"}
  - {kind: "file", path: "app/src/commands/keyboard.ts"}
  - {kind: "symbol", path: "app/src/commands/keyboard.ts", name: "installKeyboardMap"}
  - {kind: "symbol", path: "app/src/commands/keyboard.ts", name: "parseShortcut"}
  - {kind: "file", path: "app/src/commands/keyboard.test.ts"}
  - {kind: "file", path: "app/e2e/components.palette.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/components/palette/README.md"}
requires: []
lanes:
  - "app/src/components/CommandPalette/**"
  - "app/src/commands/keyboard.ts"
  - "app/src/commands/keyboard.test.ts"
  - "app/e2e/components.palette.spec.ts"
  - "docs/evidence/phase-5-polish/components/palette/**"
external_requires:
  - "Item 01 (merged, PR #101): app/src/commands/registry.ts CommandRegistry API, read-only"
  - "Item 08 Dialog (parallel, not on main): NOT imported; the kill-switch confirm is an injected seam"
  - "Electron binary download for npm run e2e (node node_modules/electron/install.js)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the registry (item 01's `registry.ts`) lacks the README's icon/status/meta fields and any "destructive" flag | MEDIUM | Do not edit `registry.ts`. Render label + kbd chip with the 16px leading slot reserved, and record the gap as an owner finding in the evidence README. Extending the contract is the owner's call. |
| Feasibility (Phase 2.5): `App.tsx` has no mount point for the palette or the key listener, and it is item 01's shared file, outside these Touches | MEDIUM | Ship `CommandPaletteHost` as the single element to mount, prove it in tests and the gallery, and record "not yet mounted in the shell" as an owner finding. Do not edit `App.tsx`. |
| Feasibility (Phase 2.5): item 08's Dialog runs in parallel and is not on `main` | MEDIUM | The kill switch is an injected `confirm`/`engage` seam proven with a `role="alertdialog"` test double. Item 17 (depends on 08 and 11) wires the real Dialog and `POST /stop-all`. Never import from `app/src/components/Dialog/`. |
| A palette that closes on `Enter` before an async `run()` settles, or a `run()` that throws, could leave the palette in a bad state | LOW | Close first, then `await` `run()`; a rejection is caught and logged, never re-thrown into the key handler. |
| E2E harness: Vite `createServer` + a temp Electron main under xvfb in CI is new in this repo | MEDIUM | Mirror `app/e2e/smoke.spec.ts`'s launch and teardown (`afterEach` closes app and server). Use port 0. Keep `sandbox: true` in the temp main, as CI already allows user namespaces for the smoke. Screenshot writing is opt-in via env var. |
| `⌘` is `metaKey` only (macOS app), while CI e2e runs on Linux | LOW | Playwright `page.keyboard.press("Meta+K")` sets `metaKey` on Linux Electron too. Unit tests dispatch `KeyboardEvent` with `metaKey: true`. |
| README vs `preview.html` mismatch (for example `preview.html` uses `aria-owns`, the README says `aria-activedescendant`) | LOW | Follow the README's rules (they include both: `aria-controls` + `aria-activedescendant`) and record any mismatch as a finding, never a redesign (requirement Non-goals). |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-22-command-palette-and-keyboard-map.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-22T05:16:32Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/111
- **Branch:** feature/command-palette-and-keyboard-map
- **Files changed:** 23
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Built CommandPalette/CommandPaletteHost and the registry-derived keyboard map (exact modifiers, refused collisions, ⌘⇧K confirm-first seam), plus an Electron gallery e2e, 13 screenshots and an evidence README. Three heal iterations: 1) fixed 3 HIGH (keys leaking past the pending confirm, chrome click stranding focus, IME Enter); 2) fixed a fix-1 regression (hung engage froze the keys) and pinned the ranking tiers; 3) reviewer PASS with 2 MEDIUM at the floor (stale README counts, confirm focus lost to the opener), fixed in de7af4f, which was NOT re-reviewed (final iteration). 120 unit tests and 7 e2e pass locally; required CI green on every checked head. 3 LOW dismissed below the floor.

## Not verified
- **CI app job (Linux xvfb) running components.palette.spec.ts** — e2e observed on macOS only; no CI run for this change (subtask 1)
- **palette inside the real shell (App.tsx)** — CommandPaletteHost is not mounted; App.tsx is outside this item's Touches (subtask 1)
- **VoiceOver announcements of the combobox** — roles and attributes asserted; screen-reader output needs a manual run (subtask 1)
