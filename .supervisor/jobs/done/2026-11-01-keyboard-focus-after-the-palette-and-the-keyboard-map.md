# Supervisor Job: Keyboard — focus lands in the screen the palette opened, and the Keyboard map opens at its top with its opener marked in the sidebar

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-171537/L3
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090022-keyboard-focus-after-the-palette-and-the-keyboard-map.md
- **Base commit:** 59275c832a77f65975ebdf020e34a3dcc552519a

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript renderer (`app/src`), vitest unit tests, Playwright e2e through `app/e2e/electron-harness.ts`. No new dependency. |
| 2 | Dependency Availability | GO | Everything needed exists: `KeyboardHost` (palette host), `opener.ts` (`openerHash`, `FALLBACK_HASH`), `Sidebar` (`currentId` → `aria-current="page"`), and the evidence mechanism in `keyboard.spec.ts` (`KEYBOARD_EVIDENCE`, `VIEWS`, `EVIDENCE_DIR`). |
| 3 | Architecture Fit | CAUTION | `App.tsx` is outside Touches ("Nothing is patched outside an item's Touches"), so the fix must live in `KeyboardHost`, `Sidebar` and the keymap folder. The screen commands' `run` (`go(s.id)`) is defined in `App.tsx`, so the palette-run focus move is done by the host, not the command. Scope 4 requires committed screenshots, and they can only live in the evidence dir that `keyboard.spec.ts` pins (`docs/evidence/phase-7-polish/keyboard/`). That dir is not in Touches, but the item's own Scope 4 and AC4 require it (the same as every phase 7 polish item). |
| 4 | Scope vs Supervisor Capability | GO | About 8 source/test files plus 4 PNGs, well under 800 changed lines. Single subtask. |
| 5 | Hard Blockers | GO | None. Screenshots need macOS (the README's regenerate command). The lane runs on macOS. |

**Overall Verdict:** CAUTION

## Task
**Goal:** After the ⌘K palette runs a command that opens a screen, focus moves into that screen. The Keyboard map always opens scrolled to its top, and while it is open the sidebar marks the screen it was opened from. Back still returns there, and light and dark screenshots of the changed mockup views are committed as polish evidence.

**Problem Statement:**
The owner needs keyboard use to follow the mockup's focus rules (`docs/design/mockups/gui-v2.html`: `goScr` focuses `#col`, and `navHTML` marks `SCREENS[V().scr].parent`).
The phase 7 exit live re-run (2026-11-01, `59275c8`) found three problems:
- After ⌘K runs "Memory", the focus ring stays on the previous screen's sidebar item (Tasks). This happens because `CommandPalette`'s `restoreFocus` puts focus back on the opener and then `queueMicrotask(() => runCommand(command))` changes the hash without moving focus.
- `?` from a scrolled Settings opens the map at Settings' scroll offset, because `.content` (`overflow: auto` in `app/src/styles/app.css`) is one element shared across screens.
- While the map is open the sidebar marks nothing (`currentId` is `keymap`, which has no `nav`).

The phase 7 polish gate fails until this is fixed. Success means:
- the palette opening Memory leaves focus inside Memory, with no sidebar item focused;
- `?` from a scrolled Settings shows the map at `scrollTop === 0`;
- the sidebar marks Settings while the map is open from Settings;
- the screenshots are committed.

**Design (grounded; the worker may refine but must stay inside the lanes):**
1. **Focus after a palette run, in `KeyboardHost`.** Pass `CommandPalette` a wrapped registry view in the same style as `guardRegistry`, whose commands' `run` records that the palette ran a command. When a `hashchange` follows that run, move focus into the opened screen after its render (for example after two animation frames, or a layout effect keyed on the hash). The target is the first focusable control inside the opened screen's root (`.content [data-testid^="screen-"]`; every screen root carries a `screen-<id>` test id), never the KernelBand's button, which is `.content`'s first child when the band shows. If the screen root has no focusable control, focus the screen root itself, with `KeyboardHost` setting `tabindex="-1"` on it at runtime when it has none. **Never edit `app/src/App.tsx` for this.** It is outside Touches, and `<main className="main">` there has no tabIndex. Always pass `{ preventScroll: true }`. Skip the move when `document.activeElement` is already inside `.content`. This covers the Keyboard map's own Back autofocus and a screen that focuses its own field. Also skip it when `isEditableTarget(document.activeElement)` holds. A run that changes no hash (Pause all, Kill switch…) keeps today's restore-to-opener behaviour. Do not change `CommandPalette`'s Esc restore: Esc still returns focus to the opener (requirement Assumption). `CommandPalette` itself changes only if the wrapper cannot work. It is in Touches (`app/src/components/CommandPalette`), so a new optional prop is allowed, but it must keep every existing `CommandPalette.test.tsx` case green.
2. **Map at its top, in `app/src/screens/keymap/KeymapScreen.tsx`.** On mount, before paint (`useLayoutEffect`), set the nearest scrolling ancestor's `scrollTop` (`.content`) to 0. Keep the existing `back.current?.focus({ preventScroll: true })`.
3. **Sidebar mark, in `app/src/shell/Sidebar.tsx` plus `app/src/screens/keymap/opener.ts`.** Add a pure exported helper to `opener.ts`, for example `openerScreenId(): string`. It maps `openerHash()` to a screen id with the same `^#\/([a-z][a-z0-9-]*)` shape as `App.tsx`'s `screenForHash`, and `""` maps to `"chat"`. Add a comment naming `DEFAULT_SCREEN` in `App.tsx`, and do not import `App.tsx`, which would make an import cycle. When `currentId === "keymap"` (use `KEYMAP_SCREEN` from `KeyboardHost.tsx` or the literal), `Sidebar` marks the entry whose id is `openerScreenId()`. The mark is `selected` plus `aria-current="page"`, as the mockup's `navHTML` gives the parent `sel` and `aria-current="page"`. A deep link onto the map marks Settings (`FALLBACK_HASH`), which matches the mockup's `parent:'settings'`. `opener.ts`'s `hashchange` listener is installed at module load and ignores the map's own hash, so `openerHash()` is already right when `App` re-renders. No new subscription is needed.

## Acceptance Criteria
- [ ] AC1: Given the palette runs a screen command (for example "Memory" from Tasks), then focus is inside the opened screen's root (`[data-testid="screen-memory"]`), and no sidebar `.nav-item` is `document.activeElement` or shows a focus ring. Asserted in `app/e2e/keyboard.spec.ts` and in `app/src/shell/KeyboardHost.test.tsx`. Given the palette is closed with Esc, then focus is back on the control that opened it (unchanged). Given a palette command that changes no hash, then focus returns to the opener (unchanged). Given focus is in a text field when the screen changes, then the field keeps focus. Given a navigation that is not a palette run (`⌘6`, or Enter or a click on a sidebar item), then focus stays where it was (the sidebar item keeps focus after its own click or Enter), so only a palette run moves focus. Each of these is asserted in `app/src/shell/KeyboardHost.test.tsx`, and the ⌘6 / sidebar-Enter case also in `app/e2e/keyboard.spec.ts`.
- [ ] AC2: Given a Settings screen scrolled down (`.content` `scrollTop > 0`), when `?` opens the Keyboard map, then `.content`'s `scrollTop` is 0 and the map's top is in view. Asserted in `app/e2e/keyboard.spec.ts` and in a unit test in `app/src/screens/keymap/keymap.test.tsx`.
- [ ] AC3: Given the Keyboard map opened from Settings, then the sidebar's Settings entry has `aria-current="page"` and class `selected`, and no other entry has either, matching the mockup's `keymap` view in light and dark. Back returns to `#/settings`. The same holds for any opener (Tasks → Tasks marked). A deep link onto `#/keymap` marks Settings. Asserted in `app/e2e/keyboard.spec.ts`, whose existing `aria-current="page"` count-0 pin in the "AC4: ? opens the Keyboard map from Tasks" test becomes "Tasks marked", and in a unit test in `app/src/screens/keymap/keymap.test.tsx`.
- [ ] AC4 (polish gate, evidence-file form): Given the change, then the committed evidence file `docs/evidence/phase-7-polish/keyboard/README.md` names each screenshot against its `gui-v2.html` view, and the PR body links to it. The screenshots are taken from the running app (fixture kernel, through `app/e2e/electron-harness.ts`, with `KEYBOARD_EVIDENCE=1`) in light and dark. They are `keymap-light.png` / `keymap-dark.png`, re-shot with the map opened by `?` from a scrolled Settings, showing it at its top with Settings marked, and the new `memory-populated-light.png` / `memory-populated-dark.png`, Memory opened by the palette with focus inside it and no sidebar focus ring. `tasks-populated-palette-*.png` stays. `VIEWS` in `keyboard.spec.ts` gains `memory-populated`. The README's "What this PR changes" and "Known remaining differences" are updated, so its existing pin tests stay green. "Known remaining differences" records that the mockup's `navHTML` marks the map's static parent (`parent:'settings'`, always Settings), while the app marks the actual opener, per requirement Scope 3. It also records that the screenshots are fixture-kernel captures, which the owner's "screenshots stay outside the repo" decision (about live-run captures of the real store) does not cover.
- [ ] AC5: Validation passes: `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, and `bash scripts/check-docs.sh`.

**Evidence rule:** AC4's evidence lives in the diff (`docs/evidence/phase-7-polish/keyboard/README.md` plus the PNGs), never only in the PR body. The README is an existing evidence file that the spec already pins as the one index for that directory, so it is modified, not created. The spec's README test fails on any PNG the README does not name, so a second index file there would also need naming.

## File Impact Map

| Path | Action | Lines at base | Confidence | Why |
|------|--------|---------------|------------|-----|
| `app/src/shell/KeyboardHost.tsx` | MODIFY | 187 | HIGH | The palette-run focus move (wrapped registry passed to `CommandPalette`, `hashchange` → focus into `.content`/`main`). Home: this file, beside `guardRegistry`; it already owns the palette and the global keys. |
| `app/src/shell/KeyboardHost.test.tsx` | MODIFY | 319 | HIGH | Unit tests for AC1: run → focus inside the screen; Esc → opener; no-hash command → opener; an editable field keeps focus. |
| `app/src/shell/Sidebar.tsx` | MODIFY | 160 | HIGH | Mark `openerScreenId()` while `currentId` is `keymap` (AC3). |
| `app/src/screens/keymap/opener.ts` | MODIFY | 30 | HIGH | New pure helper `openerScreenId()` (hash → screen id, `""` → `chat`). Home: this file already owns the opener. |
| `app/src/screens/keymap/KeymapScreen.tsx` | MODIFY | 197 | HIGH | `useLayoutEffect` resets the scrolling ancestor's `scrollTop` (AC2). |
| `app/src/screens/keymap/keymap.test.tsx` | MODIFY | 190 | HIGH | Unit tests for `openerScreenId`, scroll-to-top, and the Sidebar mark (rendered with `currentId="keymap"`). `app/src/shell/frame.test.tsx` is outside Touches, so the Sidebar unit test lives here. |
| `app/e2e/keyboard.spec.ts` | MODIFY | 538 | HIGH | AC1/AC2/AC3 e2e tests. Flip the count-0 `aria-current` pin to "Tasks marked". `VIEWS` gains `memory-populated`. AC8's screenshot test shoots the map from a scrolled Settings and Memory after a palette run. |
| `docs/evidence/phase-7-polish/keyboard/README.md` | MODIFY | 41 | HIGH | AC4 evidence index (names `keymap` and `memory-populated` against their mockup views; regenerate command unchanged). |
| `docs/evidence/phase-7-polish/keyboard/keymap-light.png`, `keymap-dark.png` | MODIFY (re-shot) | binary | HIGH | AC4. |
| `docs/evidence/phase-7-polish/keyboard/memory-populated-light.png`, `memory-populated-dark.png` | CREATE | — | HIGH | AC4. |
| `app/src/components/CommandPalette/CommandPalette.tsx` | MODIFY only if the wrapper approach cannot work | 399 | LOW | Fallback home for an optional `onRun` prop. Every `CommandPalette.test.tsx` case must stay green. |

Module layout (`skills/supervisor-readiness/SKILL.md` §"Module layout"): `app/e2e/keyboard.spec.ts` (538) is at or past the threshold. New tests are appended to it because it is the single home for the keyboard and Keyboard-map e2e tests and owns the evidence `VIEWS` / `screenshots()` helper, so splitting would duplicate the launch and screenshot helpers. Every other MODIFY path is below the threshold. The new pure helper `openerScreenId` lives in `opener.ts`, which already owns the opener, and the focus move lives in `KeyboardHost.tsx`, which already owns the palette and global keys. No helper is copied by 2+ siblings, so no extract row is needed.

## Touched-file invariants

> Grounded at base `59275c8`. The worker re-checks these before hand-back.

- **`app/src/shell/KeyboardHost.tsx`** — keep the kill-confirm hold: `if (confirming()) return;` in `openPalette` and the `guardRegistry` view passed to `installKeyboardMap` (`registry: guarded,`). Keep the bare-key guard `if (isComposingKey(event) || isEditableTarget(event.target)) return;`. Reuse `isEditableTarget` from `../commands/keyboard` for the "don't steal from a text field" check. The palette still receives the real registry's commands (the `CommandPalette registry={registry}` line may change to a wrapped view, but titles, groups, `enabled` and order must be identical). Pinned by `app/src/shell/KeyboardHost.test.tsx` ("the palette's own Kill switch… command: the palette closes, the confirm opens, and the keys are held"): the wrapped `run` must still let `Kill switch…` close the palette and open the confirm.
- **`app/src/components/CommandPalette/CommandPalette.tsx`** (only if touched) — keep: `queueMicrotask(() => runCommand(command));` after `onClose()` ("After the close commits and focus is back on the opener, so a command that moves focus keeps it."), and the Esc restore `if (opener instanceof HTMLElement && opener.isConnected) opener.focus();`. Pinned by `CommandPalette.test.tsx`.
- **`app/src/shell/Sidebar.tsx`** — keep: `aria-current={selected ? "page" : undefined}` and `className={selected ? "nav-item selected" : "nav-item"}`, the one current-entry mark (pinned by `app/src/shell/frame.test.tsx` `.filter((b) => b.getAttribute("aria-current") === "page")` → `["Tasks"]` and the contrast row `".nav-item.selected"`). Outside the map, the marked entry is still exactly `currentId`.
- **`app/src/screens/keymap/opener.ts`** — keep: `const KEYMAP_HASH = /^#\/keymap(?![a-z0-9-])/;`, `export const FALLBACK_HASH = "#/settings";` and `if (!KEYMAP_HASH.test(hash)) opener = hash;` (the map never records itself as its own opener). `openerHash()` keeps its contract (pinned by `keymap.test.tsx` and e2e "Back returns there").
- **`app/src/screens/keymap/KeymapScreen.tsx`** — keep: `back.current?.focus({ preventScroll: true });` (pinned by e2e `await expect(byId(page, KEYMAP.back)).toBeFocused();`). Keep `KEYMAP_TEST_IDS` unchanged.
- **`app/e2e/keyboard.spec.ts`** — keep: the CI guard test "without KEYBOARD_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run" and the README pin `expect(readme).toContain("KEYBOARD_EVIDENCE=1");`. Keep `screenshots()`'s `expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);`. The `phase-7-exit.spec.ts` click-through map entry `keymap: { spec: "keyboard.spec.ts", title: "AC4: ? opens the Keyboard map" }` matches a test title by prefix, so the test titled "AC4: ? opens the Keyboard map from Tasks…" must keep that prefix.
- **`app/src/shell/KeyboardHost.test.tsx`** — keep every existing case green, notably the AC7b block (`describe("the kill confirm holds everything behind it (AC7b)"`) and "⌘K opens it; a second ⌘K keeps one palette; Esc closes it with focus back on the opener". Reuse its `afterEach(() => {` teardown so a host mounted by a new test is unmounted and leaves no window listener behind.
- **`app/src/screens/keymap/keymap.test.tsx`** — keep its hash and opener-tracker lifecycle: the module-level `let stop: (() => void) | undefined;`, set in `beforeEach` and torn down in `afterEach` by `stop?.();`. New `openerScreenId` and Sidebar-mark tests install the tracker the same way (`stop = installOpenerTracker()`) and set `window.location.hash` before rendering, so no test inherits another's opener. Keep the existing `expect(keymapScreen.nav).toBeUndefined();`, because the map stays out of the sidebar.

## Closed enumerations touched

> Sibling grep at base `59275c8`: `grep -rnF 'tasks-populated-palette' --exclude-dir=node_modules . | grep -v '\.png'` → 2 hits in 1 tracked source file, plus the README table row (`docs/evidence/phase-7-polish/keyboard/README.md`, link text `tasks-populated-palette-light.png`). The `.supervisor/` stream-log hits are this run's own log, not repo content.

- **`memory-populated`** (sibling: `tasks-populated-palette`) — must be named in:
  - `app/e2e/keyboard.spec.ts` — the closed list `const VIEWS = ["keymap", "tasks-populated-palette"] as const;`. Extend it. The PNG-count pin `VIEWS.length * THEMES.length` then goes from 4 to 6.
  - `app/e2e/keyboard.spec.ts` — `await screenshots(page, "tasks-populated-palette", testInfo);` is a call site, not a closed list. No change: a new `screenshots(page, "memory-populated", testInfo)` call is added beside it.
  - `docs/evidence/phase-7-polish/keyboard/README.md` — the `## Screenshots` table, which must link every PNG (pinned by `the README links ${file}`). Extend it with a `memory-populated` row and update the "(4 files)" count to 6.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/e2e/keyboard.spec.ts` — the new AC1 "palette runs a screen command, focus inside the opened screen" test | delete the focus-move call added in `app/src/shell/KeyboardHost.tsx` (the line that focuses the `.content` target) → focus stays on the sidebar item and the test goes red |
| `app/src/shell/KeyboardHost.test.tsx` — the new AC1 unit test | same mutation as above → red |
| `app/src/screens/keymap/keymap.test.tsx` — the new scroll-to-top test | delete the `scrollTop = 0` line added in `app/src/screens/keymap/KeymapScreen.tsx` → red |
| `app/src/screens/keymap/keymap.test.tsx` — the new Sidebar-mark test | flip the `currentId === "keymap"` check in `app/src/shell/Sidebar.tsx` to `false` → no entry marked, red |
| `app/e2e/keyboard.spec.ts` — the changed "AC4: ? opens the Keyboard map from Tasks" pin (was `[aria-current="page"]` count 0, now Tasks marked) | same Sidebar flip → red |
| `app/src/shell/KeyboardHost.test.tsx` — the new "a text field keeps focus when the screen changes" test | delete the `isEditableTarget(document.activeElement)` skip added in `app/src/shell/KeyboardHost.tsx` → the field loses focus, red |
| `app/src/shell/KeyboardHost.test.tsx` and `app/e2e/keyboard.spec.ts` — the new "⌘6 / sidebar Enter leaves focus where it was" tests | drop the "the palette ran a command" flag check in `app/src/shell/KeyboardHost.tsx`, so every `hashchange` moves focus → the sidebar item loses focus, red |
| `app/src/shell/KeyboardHost.test.tsx` — the new "a palette command that changes no hash returns focus to the opener" test | make the focus move run on every palette close instead of only after a hash change → focus leaves the opener, red |
| `app/src/screens/keymap/keymap.test.tsx` — the new `openerScreenId` tests (`""` → `chat`; deep link → `settings`) | flip the `""` → `"chat"` mapping in `app/src/screens/keymap/opener.ts` to return `""` → red. Flip `FALLBACK_HASH = "#/settings"` to `"#/tasks"` → the deep-link case is red. |
| `app/e2e/keyboard.spec.ts` — the new AC2 "map at its top after `?` from a scrolled Settings" assertion | delete the `scrollTop = 0` line added in `app/src/screens/keymap/KeymapScreen.tsx` → `.content` keeps Settings' offset, red |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Palette-run focus, map scroll-to-top, sidebar opener mark, tests and polish evidence | AC1–AC5 | 10 modify, 2 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — keyboard focus after the palette and the Keyboard map (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/shell/KeyboardHost.tsx"}
  - {kind: "symbol", path: "app/src/shell/KeyboardHost.tsx", name: "KeyboardHost"}
  - {kind: "symbol", path: "app/src/screens/keymap/opener.ts", name: "openerScreenId"}
  - {kind: "symbol", path: "app/src/shell/Sidebar.tsx", name: "Sidebar"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/keyboard/memory-populated-light.png"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/keyboard/memory-populated-dark.png"}
  - {kind: "symbol", path: "docs/evidence/phase-7-polish/keyboard/README.md", name: "memory-populated"}
requires: []
lanes:
  - "app/src/shell/KeyboardHost.tsx"
  - "app/src/shell/KeyboardHost.test.tsx"
  - "app/src/shell/Sidebar.tsx"
  - "app/src/components/CommandPalette/**"
  - "app/src/screens/keymap/**"
  - "app/e2e/keyboard.spec.ts"
  - "docs/evidence/phase-7-polish/keyboard/**"
external_requires:
  - "macOS host for the KEYBOARD_EVIDENCE=1 screenshot run (README's regenerate command)"
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

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Moving focus on a screen change steals focus from a text field the owner is typing in (requirement Risk). | HIGH | Move focus only after a palette run (never on a sidebar click, ⌘1–⌘9 or any other hash change). Skip the move when `document.activeElement` is already inside `.content` or `isEditableTarget(document.activeElement)` holds. Add a unit test for the editable case. |
| `App.tsx` and `frame.test.tsx` are outside Touches (owner rule: "Nothing is patched outside an item's Touches. A lane that needs another file stops and says so."). — source: Feasibility (Phase 2.5) | MEDIUM | The design keeps every change in `KeyboardHost`, `Sidebar`, `CommandPalette` and the keymap folder. Sidebar unit tests go in `keymap.test.tsx`. If a change to `App.tsx` turns out unavoidable, stop and say so in the PR instead of patching it. |
| The evidence dir `docs/evidence/phase-7-polish/keyboard/` is not listed in Touches, but Scope 4 / AC4 require committed screenshots and `keyboard.spec.ts` (in Touches) pins that dir as their home. — source: Feasibility (Phase 2.5) | LOW | Treat it as implied by Scope 4, as the other phase 7 polish items did (`docs/evidence/phase-7-polish/settings/`, `…/tasks/`). Say so in the PR body. |
| Focus is moved before the new screen has rendered, so it lands on a node that unmounts, or on `body`. | MEDIUM | Focus after the screen commits (two rAFs, or a layout effect keyed on the hash). Assert with `toBeFocused()` / `document.activeElement` inside `screen-memory` in e2e, not just "not on the sidebar". |
| The wrapped registry changes what the palette lists or breaks `Kill switch…` (which closes the palette and opens the confirm in the same tick). | MEDIUM | Wrap only `run` and pass everything else through. The existing AC7b KeyboardHost tests and `CommandPalette.test.tsx` must stay green. |
| The `phase-7-exit.spec.ts` click-through map looks up the keymap test by title prefix "AC4: ? opens the Keyboard map". | LOW | Keep that test title's prefix. If the title changes, keep the prefix match. |
| Sidebar's mark depends on `openerHash()` being current at render time. | LOW | `installOpenerTracker()` runs at module load (eager screen import), so its `hashchange` listener precedes `App`'s. Cover a sequence in the unit test: Tasks → Settings → map marks Settings. |
| Screenshots differ between macOS and CI. | LOW | Already handled: the spec never compares pixels, and `KEYBOARD_EVIDENCE` is unset in CI. Capture on macOS only. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-keyboard-focus-after-the-palette-and-the-keyboard-map.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T18:30:56Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/204
- **Branch:** feature/keyboard-focus-after-the-palette-and-the-keyboard-map
- **Files changed:** 12
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Palette-run focus move (KeyboardHost trackPaletteRuns), Keyboard map scroll-to-top (KeymapScreen useLayoutEffect), sidebar marks the map's opener (openerScreenId), unit + e2e tests, light/dark evidence PNGs and README. Phase 4.5 code review PASS on first iteration (2 LOW dismissed below MEDIUM floor); required CI green; rules none; risk high (size/content heuristic, advisory).

## Not verified
- **AC1/AC3 in an OS-foreground macOS window** — the harness keeps windows hidden, so focus is Playwright's page-focus emulation, not a real foreground window (subtask 1)
