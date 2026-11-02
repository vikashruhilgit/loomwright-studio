# Supervisor Job: Schedules — the firing history's Result chip fits its column (item 25)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-171537/L4
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090025-schedules-result-chip-fits-its-column.md
- **Base commit:** 59275c832a77f65975ebdf020e34a3dcc552519a

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | A CSS/markup fix in the React renderer (`app/src/screens/schedules`) plus a Playwright/Electron e2e check. No new dependency. |
| 2 | Dependency Availability | GO | The fixture kernel already serves `playbook_not_enabled` misses (`app/e2e/fixtures/schedules.ts`: the poll's recorded reasons include `"playbook_not_enabled"` four times), so no fixture change is needed. The spec can resize the window through `app.evaluate(({ BrowserWindow }) => …setSize(…))`, as `app/e2e/settings.spec.ts` already does. |
| 3 | Architecture Fit | CAUTION | Two layout facts constrain the fix. (a) History rows have a fixed height (`.schedules-fire { height: 64px; }`) so a refetch moves nothing; a chip that wraps must not break that guarantee (AC7). (b) At the minimum window (900 px wide, `app/electron/main.ts` `minWidth: 900`), the detail pane is about 900 − 240 (`--sidebar-width`) − 360 (`--list-pane-width`) = 300 px minus its padding, which is less than the fixed When (96 px) + Result (176 px) columns plus a usable Trigger column. With `table-layout: fixed; width: 100%`, the table can lay out wider than its pane, and the window edge clips it. The worker must fix both widths, not only the default one. |
| 4 | Scope vs Supervisor Capability | GO | 2–3 source files plus the e2e spec and the evidence directory. One worker (no split reason fires). |
| 5 | Hard Blockers | GO | None. The committed screenshots that Scope 2 requires live in `docs/evidence/phase-7-polish/schedules/`, which is outside the requirement's Touches list. Scope 2 itself requires them ("The PR commits screenshots…"), so this brief treats that directory as part of the item (see "Scope boundary" below). No other out-of-Touches file is edited. |

**Overall Verdict:** CAUTION (findings carried to Risk Assessment)

## Task
**Goal:** Every Result chip in Schedules' firing history shows its whole text inside the table, light and dark, at the window's default size (1180×760) and at its minimum size (900×560). The raw reason line stays under the chip, and the rows stay aligned.

**Problem Statement:**
The owner needs every result in Schedules' firing history to be readable at the window's default size so that Schedules passes its phase 7 polish gate (D9).
Currently, the Result chip "playbook off: fires are skipped" is cut off at the window's right edge ("…fires are skippe"), with no wrap and no ellipsis, on every row. The cause is in the CSS:
- The Result column is a fixed 176 px (`.schedules-c3 { width: 176px; }`).
- The `Badge` component never wraps (`app/src/components/Badge/Badge.css`: `white-space: nowrap;` and `height: 20px;`).
- The cell hides overflow (`.schedules-fire td { … overflow: hidden; }`).

On the owner's store, an off playbook's trigger polls every 2 minutes, so these rows fill most of the history and the cut chip is most of what the table shows.
Success looks like this: the e2e spec measures every Result chip inside its cell and inside the window, at both sizes and in both themes, and committed light/dark screenshots show it.

**Scope boundary (owner decision: "Nothing is patched outside an item's Touches"):**
- The requirement's Touches are `app/src/screens/schedules` and `app/e2e/schedules.spec.ts`.
- The evidence directory `docs/evidence/phase-7-polish/schedules/` (the README and PNGs) is edited because the requirement's Scope 2 and AC3 require committed screenshots, and the spec's own README guards live there.
- Nothing else is edited. In particular, `app/src/components/Badge/Badge.css` (a shared design-system component), `app/electron/main.ts` (the window size is read, not changed), `app/e2e/fixtures/schedules.ts` and `docs/design/mockups/gui-v2.html` stay untouched. Any chip override is a selector scoped under the schedules table in `schedules.css`.
- A worker that finds it needs another file stops and says so in its result. It does not patch that file.
- Precedent: item 16's Touches also left out `docs/evidence`, and it regenerated this same directory (README line 3: "Item 16 regenerated all 14 files").
- The requirement's sentence "The screenshots stay outside the repo …; none is committed by these items" refers to the owner's 2026-10-31 decision on the **live-run, real-data** screenshots (`docs/evidence/phase-7-exit-runbook.md` §"Screenshots (the owner's 2026-10-31 decision)"). It does not cover the fixture-kernel evidence that Scope 2 asks this PR to commit.

**Non-goals:** thinning or grouping repeated skipped fires (a behaviour change). No change to the label text, the tone, or `reasonView`.

## Acceptance Criteria
- [ ] **AC1** Given the firing history holds a `playbook_not_enabled` row (its chip reads "playbook off: fires are skipped"), when the window is at its default size (1180×760, `app/electron/main.ts`), then the chip's whole text is visible inside the table, in light and in dark.
  - **Where the rows are.** In the fixture, the poll's four `playbook_not_enabled` reasons are on its second page (`app/e2e/fixtures/schedules.ts`, `// page two`). The spec reaches them with two "Load older" clicks in the all-triggers table, as the existing AC5 test does (`for (const shown of ["All · 23+", "All · 36+"])`), or with one click in the poll's own history, where they group to one "×4" row.
  - **What is measured.** The checks run on **the `.badge` element inside each `IDS.fireBadge` wrapper**, which holds the text. They do not run on the wrapper `<span>`.
  - **The checks** (the "chip checks"), for every `.badge` on every loaded row, the `playbook_not_enabled` rows included, in the all-triggers table and in the poll trigger's own history:
    1. `badge.scrollWidth ≤ badge.clientWidth` and `badge.scrollHeight ≤ badge.clientHeight`;
    2. the badge's computed `text-overflow` is not `ellipsis`, and a `Range` over its text has a bounding rect inside its `td`'s box;
    3. the badge's bounding box lies inside its `td`'s box;
    4. the `td`'s right edge is ≤ `window.innerWidth`.

  The `IDS.fireReason` line (`playbook_not_enabled`) is still rendered under the chip, inside the same cell, and its box does not overlap the badge's box.
- [ ] **AC2** Given the window at its minimum size (900×560, set in the spec through `BrowserWindow.setSize`, the same path `app/e2e/settings.spec.ts` uses), when the firing history shows (paged to include a `playbook_not_enabled` row), then no Result chip is clipped and the table fits its pane, in light and dark:
  - every `.badge` inside an `IDS.fireBadge` passes AC1's four chip checks;
  - the `.schedules-pane` holding the table has `scrollWidth ≤ clientWidth` (no horizontal scroll);
  - the table's `offsetWidth` is ≤ its parent's `clientWidth`;
  - the Trigger column keeps a usable width: its header cell is ≥ 96 px wide, and every row's trigger-name `<b>` has a width > 0.
- [ ] **AC3** Given a chip that now wraps or a column that is now wider, then the table stays aligned:
  - each header cell (`When`, `Trigger`, `Result`) shares its left and right x with that column's cells;
  - the existing AC7 test (`a trigger_fired and a wakeup_scheduled event update … no row already shown moving`) passes unchanged;
  - a new check at 900×560: with the history paged so that a `playbook_not_enabled` row is shown, the spec calls the fixture's existing `fx.fireOnPoll()`, which changes a shown row's count. The test then asserts that every already-shown `IDS.allFire` row's bounding box is unchanged (the existing `boxes` helper);
  - every other existing `app/e2e/schedules.spec.ts` and `app/src/screens/schedules/*.test.ts(x)` test passes, with no test deleted or weakened.
- [ ] **AC4** Given the polish gate, the committed evidence file `docs/evidence/phase-7-polish/schedules/README.md` names a light and a dark screenshot from the running app for every mockup view this item changes. The screenshots are taken against the fixture kernel through `app/e2e/electron-harness.ts`, regenerated with `SCHEDULES_EVIDENCE=1`. At minimum:
  - **Two new `STATES` entries**, `populated-skipped` (1180×760) and `populated-skipped-min` (900×560), both named in the README against the mockup view `schedules-populated`. Each pages the all-triggers history (two "Load older" clicks) and scrolls the first `playbook_not_enabled` row into view (`scrollIntoViewIfNeeded`) before the capture, so a whole "playbook off: fires are skipped" chip is in the frame. (No existing capture shows such a row: they are on page two, below the fold.)
  - **The existing pairs** (`populated`, `not-fired`, and the rest) are regenerated as they are. They change only where the new layout changes their pixels.

  Each PNG is committed beside the README. The README edits are:
  - the "Row text clips." known-difference line says what now happens to a long Result chip;
  - the Limits line that says "the screenshots show the poll's recorded `playbook_not_enabled` misses once paged" is corrected to name the new `populated-skipped` pair;
  - the file counts "(14 files)" and "All 14 files" become 18, with the capture date updated.

  The PR body links the README. The spec's existing AC9 README tests still pass: every PNG is named, and the count equals `STATES.length * THEMES.length`.
- [ ] **AC5** Given the change, then `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` and `bash scripts/check-docs.sh` all pass.

## Phase 3: ANALYZE (summary)

**Tech stack:** TypeScript (strict). The app is Electron + React + vitest (jsdom) + Playwright/Electron e2e. jsdom does no layout, so a clipping check can only live in e2e.

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| schedules screen | `app/src/screens/schedules/schedules.css` (564 lines). The fix lands here: the history table's column widths, the `.schedules-result` layout, a scoped chip override such as `.schedules-result .badge`, and the `.schedules-fire` row height. `app/src/screens/schedules/History.tsx` (264 lines) changes only if the markup must change, for example moving the `×N` count or giving the chip a wrapper; `FireRow`/`FireTable` are shared with `AllHistory.tsx`, so one edit covers both tables. | — | HIGH (CSS), MEDIUM (whether `History.tsx` needs an edit) |
| e2e + evidence | `app/e2e/schedules.spec.ts` (696 lines). The new AC1/AC2/AC3 checks go here, reusing its `openPopulated`, `byId`, `boxes` and `screenshots` helpers, with a min-size state added to `STATES`. `docs/evidence/phase-7-polish/schedules/README.md` (≈95 lines). The PNGs in `docs/evidence/phase-7-polish/schedules/` are regenerated, and one new light/dark pair is added. | — | HIGH |

> **Module layout:** no new responsibility needs a new module. The fix is styling, and its one home is `schedules.css`, the screen's only stylesheet. The new checks sit in the spec that already owns this screen's layout checks and screenshot helper. `schedules.spec.ts` is 696 lines; the new checks reuse its helpers rather than adding new ones.

> **Validator-owned surfaces:**
> - `bash scripts/check-docs.sh` scans `docs/`, so the evidence README is the file it may flag.
> - `app/e2e/schedules.spec.ts`'s test `AC9: the evidence README names a light and a dark screenshot of every state` requires every PNG to be named in the README, and the PNG count to equal `STATES.length * THEMES.length`.
> - `app/src/screens/schedules/contrast.test.ts` reads `schedules.css` (`readFileSync(new URL("./schedules.css", import.meta.url), "utf8")`).
> - The spec's AC8 test requires every colour in the stylesheet to come from a token.

### File Overlap Detection

Single subtask, so there is no overlap.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 12 hours ago |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins). Consulted with `read-rules.sh --with-ids` on the File Impact Map.

- E2E specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), which keeps every window hidden. Never call `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts` enforces this). Resizing the already-launched window through `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(…))` is allowed; `app/e2e/settings.spec.ts` does it.
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory

## Touched-file invariants

> Grounded at base `59275c832a77f65975ebdf020e34a3dcc552519a`. The worker re-checks each entry before hand-back.

- **`app/src/screens/schedules/schedules.css`** — keep:
  - Every colour is a design token. The spec's AC8 test is `the screen's stylesheet takes every colour from the design tokens`, and `contrast.test.ts` computes the screen's text pairs from this file. Any new rule uses only existing tokens (`var(--space-*)`, `var(--ink-*)`, …), never a literal colour.
  - History rows do not move on a refetch: `.schedules-fire {` with `height: 64px;`. The file's header promises the same thing: `a refetch that changes a count or a time changes text inside a row and moves nothing`. A row's height must not change when its count or its times change on a refetch, at 1180 px or at 900 px. That includes the `×N` span appearing on a 1→2 count (`group.count > 1` in `History.tsx`) or growing. A row's height may depend only on its chip label and on whether it has a reason line.
    - The safe ways to meet this: a fixed row height that already fits the wrapped chip and the reason line, or a reserved slot for the `×N` count, so it never pushes the chip onto another line.
    - Not allowed: a content-sized `min-height` row where `×N` shares the chip's line, and putting `×N` on a new line under the chip with no space reserved for it.
  - The table keeps `table-layout: fixed;` and its `colgroup` widths, or replaces them with column widths that fit the pane at 900 px. The trigger name keeps its single-line ellipsis (`.schedules-fire td b {` … `text-overflow: ellipsis;`).

  Reuse: the existing `.schedules-result` flex row and `.schedules-reason`. Override the badge under a schedules selector. Never edit `app/src/components/Badge/Badge.css`.
- **`app/src/screens/schedules/History.tsx`** (only if edited) — keep: `FireRow` and `FireTable` are shared by both tables (`One fire row, shared by this trigger's table and the all-triggers table`). Keep the test ids `IDS.fireBadge` and `IDS.fireReason` and the row's `data-kind`/`data-reason`/`data-count` attributes, because the spec and `AllHistory.test.tsx` select on them. Kernel strings stay React text children through `safe(...)`.
- **`app/e2e/schedules.spec.ts`** — keep:
  - The evidence guard `const evidence = process.env.SCHEDULES_EVIDENCE === "1";`, so CI never writes the tracked dir.
  - The `AC9:` README tests, kept green by adding the new state to `STATES` and naming its files in the README.
  - The `test.afterEach` page-error drain.
  - `launchApp` as the only launch path (house rule above).
  - A resize to minimum happens after launch, inside the test.
- **`docs/evidence/phase-7-polish/schedules/README.md`** — keep: the regenerate command line `cd app && npm run build && SCHEDULES_EVIDENCE=1 npx playwright test e2e/schedules.spec.ts --workers=1`, the table naming each light/dark pair against its `gui-v2.html` view (`schedules-populated`, …), and the capture-date sentence, updated to the new run.

## Closed enumerations touched

> Sibling grep at base `59275c832a77f65975ebdf020e34a3dcc552519a`: `grep -rnF 'not-fired' --exclude-dir=node_modules --exclude=CHANGELOG.md app docs` → 2 code hits in `app/e2e/schedules.spec.ts`. The PNG names `schedules-not-fired-*.png` also appear in `docs/evidence/phase-7-polish/schedules/README.md`'s screenshot table.

- **`populated-skipped`, `populated-skipped-min`** (sibling: `not-fired`) — must be named in:
  - `app/e2e/schedules.spec.ts` — the closed list `const STATES = ["empty", "loading", "populated", "not-fired", "confirm", "error", "unreachable"] as const;` — extend.
  - `app/e2e/schedules.spec.ts` — `await screenshots(page, "not-fired", testInfo);` — no change: it is a call site, not a list. The new states get their own `screenshots(page, "populated-skipped…", testInfo)` calls.
  - `docs/evidence/phase-7-polish/schedules/README.md` — the screenshot table (one row per light/dark pair, named against its mockup view) — extend.
  - `docs/evidence/phase-7-polish/schedules/README.md` — the prose counts `(14 files)` and `All 14 files were captured on macOS` — extend to 18.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/e2e/schedules.spec.ts` — AC1: every Result chip's text is whole inside its cell at 1180×760 | flip `width: 248px;` → `width: 96px;` in `app/src/screens/schedules/schedules.css` (worker-filled; observed red: `light: no chip is clipped`) |
| `app/e2e/schedules.spec.ts` — AC2: at 900×560 the pane has no horizontal scroll and the Trigger column keeps ≥ 96 px | flip `width: 112px;` → `width: 176px;` in `app/src/screens/schedules/schedules.css` (the base's Result width, together with the base's 96 px When column) |
| `app/e2e/schedules.spec.ts` — AC3: each header cell shares its left and right x with its column's cells | flip `.schedules-table th {` → `.schedules-table th { margin-left: 8px; display: block;` in `app/src/screens/schedules/schedules.css` |

**Making each row machine-applicable.** Before hand-back, the worker replaces each `<…>` placeholder with one literal from its final diff. Each literal must:
- be **unique** in `schedules.css` after the fix. At base, `white-space: normal;` already appears under `.schedules-clamp`, so a bare `white-space: normal;` is **not** acceptable;
- have the form `` delete `<literal>` in `<path>` `` or `` flip `<A>` → `<B>` in `<path>` ``, with nothing conditional.

The worker also confirms that each pin goes red on its mutant, using a scratch run of the one spec test.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Fit the firing history's Result chip at default and minimum window sizes, with e2e clipping checks and regenerated light/dark evidence | AC1, AC2, AC3, AC4, AC5 | 3–4 modify (+ PNGs), 0 create | `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/schedules/schedules.css"}
  - {kind: "symbol", path: "app/src/screens/schedules/schedules.css", name: ".schedules-result"}
  - {kind: "symbol", path: "app/e2e/schedules.spec.ts", name: "STATES"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/schedules/README.md"}
requires: []
external_requires: []
lanes:
  - "app/src/screens/schedules/**"
  - "app/e2e/schedules.spec.ts"
  - "docs/evidence/phase-7-polish/schedules/**"
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
| 1 | `skills/frontend-ui/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| A wrapped chip changes the row height, and the table must stay aligned (requirement risk). History rows are a fixed 64 px so a refetch moves nothing. Source: Feasibility (Phase 2.5). | MEDIUM | The row height must not change when a refetch changes the count or a time. See the `schedules.css` invariant for the allowed layouts: a fixed height that already fits the wrapped chip and the reason line, or a reserved `×N` slot. AC3 checks that header and column edges line up, keeps the AC7 no-move test green, and adds a 900 px count-change no-move check. |
| At 900 px wide, the detail pane (~250 px usable, ~237 px if Linux CI draws a ~15 px vertical scrollbar) is narrower than the fixed When + Result columns, so the table can be wider than its pane and the window edge clips it. Source: Feasibility (Phase 2.5). | MEDIUM | AC2 checks for no horizontal scroll in the pane, the table width against its parent, and a Trigger column ≥ 96 px. The fix makes the columns fit at that width, for example by wrapping the chip onto several lines or shrinking When. If an unclipped chip and a Trigger column ≥ 96 px cannot both fit using only `schedules.css` (and `History.tsx`), the worker stops and reports it. It does not loosen the 96 px rule, edit `Badge.css`, or touch any file outside its lanes. |
| The chip override must not leak to other screens' badges | LOW | Scope the selector under `.schedules-result` / `.schedules-table`. `Badge.css` is not edited. |
| The mockup (`gui-v2.html`, `.hist .c3{width:150px}`) has no playbook-off chip, so it does not show a wrapped Result | LOW | The evidence README lists the chip's layout under known remaining differences for the owner's D9 review. |
| `SCHEDULES_EVIDENCE=1 npm run e2e` rewrites other screens' tracked PNGs | LOW | Regenerate with the README's own single-spec command. Commit only `docs/evidence/phase-7-polish/schedules/**`. |
| Screenshots differ by font between macOS and the CI run | LOW | The spec checks behaviour, never pixels (existing convention). Take the clipping checks from DOM boxes, which are robust to the font. Regenerate the PNGs on macOS. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-02-schedules-result-chip-fits-its-column.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-02T04:07:50Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/207
- **Branch:** feature/schedules-result-chip-fits-its-column
- **Files changed:** 16
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** The Result chip now shows its whole text at 1180x760 and 900x560, light and dark. The Result column is 248px at the default size; below 1140px the When/Result columns are narrower, rows are a fixed 144px, the ×N count sits in a reserved 5ch slot with a title, and the chip wraps inside a scoped override. The e2e spec adds chip, pane-fit, alignment, no-move and count/time-invariant height checks in the default and Verdana fonts. Evidence is regenerated (18 files). There were 3 heal iterations:
  - Iteration 1: the count changed the row height at 900px.
  - Iteration 2: the count slot was unpinned and clipped in wide fonts.
  - Iteration 3: the 128px row was too short in a wide font. Iteration 3 also fixed a BLOCKING Linux CI `app` failure: `innerHeight` ≠ window size under xvfb, so all 5 item-25 tests had failed since the first commit. The failure was missed because `app` is not a required check.

  Iteration 3's fix (ad14862) was not LLM re-reviewed. CI `app` and `ci` are both green on ad14862. Remaining issues: the 2 findings that ad14862 fixed but no review re-checked.

## Not verified
- **Linux CI rendering of the narrow table** — only macOS was run locally. Scrollbar and fallback-font widths were reasoned about, not observed. Partly superseded: CI `app` (Linux/xvfb) is green on ad14862. (subtask 1)
- **populated-skipped-min-dark and populated-skipped-light PNG frames** — the worker viewed only 2 of the 4 new captures; DOM checks passed for all four. (subtask 1)
