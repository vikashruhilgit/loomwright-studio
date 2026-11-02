# Supervisor Job: Memory — agent avatars, file icons and long folder names (phase 7 item 26)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-171537/L8
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (disk 88% used, 56 GiB free — above the 1 GB floor)
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090026-memory-avatars-file-icons-and-long-folder-names.md
- **Base commit:** 42c403c8f9fdd2bfe3d14baabcba47366388b4c0

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + TypeScript renderer in `app/`, vitest unit tests, Playwright e2e through `app/e2e/electron-harness.ts` — all already used by the Memory screen. |
| 2 | Dependency Availability | GO | Item 21's icon set is merged (`app/src/components/icons/index.tsx`, commit 06fb913, names `file` and `shared`); the avatar component exists (`app/src/components/Avatar/Avatar.tsx`); the roster is the live store's existing `agents` resource (`useResource("agents", api)`, as `app/src/screens/budget/BudgetScreen.tsx` reads it). No new route, no new package. |
| 3 | Architecture Fit | GO | Pure renderer change inside `app/src/screens/memory` plus its e2e spec and evidence folder; kernel untouched. |
| 4 | Scope vs Supervisor Capability | GO | ~8 files, well under the context-bound threshold; one coherent group → single subtask. |
| 5 | Hard Blockers | GO | None. Dependency item 21 (`2026-11-01-090021-shell-one-back-crumb-and-the-in-content-icon-set.md`) is closed out `done` (PR #205). |

**Overall Verdict:** GO

## Task
**Goal:** Draw each agent's avatar (and the shared icon for Shared) on every Memory group header and every "Pick a file" row, a file icon on every file row, and make a long agent folder name truncate cleanly on one line — matching the GUI v2 mockup's `memory-populated` view in light and dark.

**Problem Statement:**
The owner needs Memory to pass its phase 7 polish gate because the 2026-11-01 live re-run failed it.
Currently, `app/src/screens/memory` imports no avatar or icon, so the tree's group headers, its file rows and the overview's rows draw text only, while the mockup (`docs/design/mockups/gui-v2.html`, `memoryScreen`: `${g.ag?avatarHTML(AGENTS[g.ag],20):I.team}` on headers and overview rows, `${I.mem}` on each file row) draws them; and a long agent folder (`phase4-exit-mvg8wle4cf8f26/`) wraps its header to two lines so its first file row sits tight under it.
Success looks like: the screenshots of `memory-populated` and `memory-file`, light and dark, show the avatars and icons, and a long folder header keeps the same height and spacing as a short one, with its full name on hover and to assistive tech.

**Non-goals:** changing which folders or files Memory lists; changing a folder's label text (it stays the capitalised folder name — `labelOf` in `model.ts`); the file view's header avatar (`memoryFile`'s `dhead`), which the requirement's Scope does not name.

**Owner constraint (binding):** "Nothing is patched outside an item's Touches. A lane that needs another file stops and says so." Touches: `app/src/screens/memory`, `app/e2e/memory.spec.ts`. Scope 4 (the polish gate) makes the spec rewrite its committed screenshots and README under `docs/evidence/phase-7-polish/memory/` — the spec's own `EVIDENCE_DIR`, as every sibling phase 7 polish item did for its screen (e.g. PR #207 for `docs/evidence/phase-7-polish/schedules/`). No other file outside Touches may change; in particular **not** `app/e2e/fixtures/memory.ts`, `app/e2e/fixture-kernel.ts`, `app/src/components/**`, `app/src/store/**` or the kernel. Fixture differences (a `GET /agents` roster, a long folder) are added inside `memory.spec.ts` through `startFixtureKernel`'s `routes` override, as `app/e2e/playbooks.spec.ts` does for `"GET /agents"`.

## Acceptance Criteria
- [ ] **AC1 — avatars and file icons.** Given Memory with the fixture tree and a `GET /agents` roster, when the tree and "Pick a file" are shown, then every agent group header in the tree and every agent row in "Pick a file" renders that agent's `Avatar` (`app/src/components/Avatar/Avatar.tsx`, shape and hue from the roster entry whose `id` equals the folder; Wright's whale for `wright`; the component's own fish/slate fallback when the roster has no entry or has not answered), the Shared group header and the Shared overview row render `Icon name="shared"` instead, and every file row in the tree starts with `Icon name="file"` — in light and dark. The avatar and icons are decorative (the folder name and the file button's existing `aria-label` still name the thing), and no file button's accessible name changes.
- [ ] **AC2 — long folder names.** Given an agent whose folder name does not fit the tree's width (e.g. `phase4-exit-mvg8wle4cf8f26`), when the tree is shown, then its group header stays one line (name truncated with an ellipsis, the `<folder>/` caption not pushing the row taller), the header's height and the gap to its first file row equal those of a short header (measured with `boundingBox()` in `app/e2e/memory.spec.ts`), and the full name is available on hover (`title`) and to assistive tech (the full text stays in the DOM and in the group's `aria-label`).
- [ ] **AC3 — no regression.** Given the existing Memory behaviour, then every existing check still passes: the AC11 live-refetch test (row and header boxes identical before and after a `memory_updated`), the keyboard walk (J/K/arrows/Enter/Esc), the unreachable state, `contrast.test.ts` (every colour-setting rule in `memory.css` listed and ≥ 4.5:1 / 3:1), and the no-hex check.
- [ ] **AC4 — polish-gate evidence (evidence file).** Given the change, then a committed evidence file `docs/evidence/phase-7-polish/memory/README.md` lists the regenerated screenshots of every mockup state this item changes — at least `memory-populated` and `memory-file`, light and dark, captured from the running app (fixture kernel through `app/e2e/electron-harness.ts`, `MEMORY_EVIDENCE=1`) — each named against its `gui-v2.html` view, its "Departures from the mockup" no longer says "there is no avatar", and the PR body links to it.

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`, and `bash scripts/check-docs.sh` from the repo root.

## Phase 3: File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|---------------------------------|-----------------|------------|
| memory-screen | `app/src/screens/memory/MemoryViews.tsx` (543), `app/src/screens/memory/MemoryScreen.tsx` (485), `app/src/screens/memory/memory.css` (498) | `app/src/screens/memory/FolderMark.tsx` | HIGH |
| memory-tests | `app/src/screens/memory/MemoryScreen.test.tsx` (1069) — only if adding the `agents` read makes its fake bridge need a `GET /agents` answer; `app/src/screens/memory/contrast.test.ts` (129) — only if a new `memory.css` rule sets a colour | `app/src/screens/memory/FolderMark.test.tsx` | MEDIUM |
| memory-e2e | `app/e2e/memory.spec.ts` (688) | — | HIGH |
| evidence | `docs/evidence/phase-7-polish/memory/README.md` (82), `docs/evidence/phase-7-polish/memory/memory-populated-light.png`, `…/memory-populated-dark.png`, `…/memory-file-light.png`, `…/memory-file-dark.png` (regenerated; other PNGs regenerate too under `MEMORY_EVIDENCE=1` — keep exactly the 16 names the README pins) | — | HIGH |

**Module layout (`skills/supervisor-readiness/SKILL.md` §"Module layout"):**
- **New responsibility "which mark a folder gets" (roster lookup → `Avatar`, or the shared `Icon`)** → home: CREATE `app/src/screens/memory/FolderMark.tsx` (exports `FolderMark`, taking the folder, its label and the roster). `MemoryViews.tsx` (543, past the threshold) only imports it and gains the call sites in `MemoryTree` and `MemoryOverview` plus the file row's `Icon` — a few lines, no new function there.
- **The file icon on a file row** → reuse the shared `Icon` from `app/src/components/icons/index.tsx` (item 21's single home for the set); one JSX line in `MemoryTree`'s file button. Never a local copy of the path data.
- **Roster read** → reuse the live store's existing `agents` resource in `MemoryScreen.tsx` (485): `useResource("agents", api)` as `BudgetScreen.tsx` does; MemoryScreen already owns the screen's reads, so it is the one place to add it and pass `roster` down to `MemoryTree` / `MemoryOverview`.
- **Styles** (icon/avatar slot in `.memory-folder`, `.memory-file`, `.memory-box > li`; one-line truncation of `.memory-folder-name`) → append to `memory.css` (498 — the screen's single stylesheet, and `contrast.test.ts` reads exactly this file to list every colour rule; a second stylesheet would escape that check). If the additions take it past 500 lines that is accepted for this reason.
- **Unit tests for `FolderMark`** → CREATE `app/src/screens/memory/FolderMark.test.tsx`; `MemoryScreen.test.tsx` (1069, past the threshold) gets at most the `GET /agents` fake answer it needs, never the new tests.
- **E2E** → append to `app/e2e/memory.spec.ts` (688 — the requirement's Touches names it as the screen's only spec, and its `screenshots()` helper, `STATES` and the evidence-dir guards live there; a second spec would need a second evidence guard).
- No helper is copied: `printable` (`../approvals/printable`) and `Avatar`/`Icon` are imported, not re-implemented.

**Total estimated files:** 5–7 modify + 2 create (+ 4 regenerated PNGs, README).

## Touched-file invariants

> Grounded at base `42c403c8f9fdd2bfe3d14baabcba47366388b4c0`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/memory/MemoryViews.tsx`** — keep: kernel strings stay text, never markup — `a React text child, never markup`; every folder name and file name still goes through `printable(` (e.g. `{printable(group.folder)}/`); the file button keeps its name `aria-label={fileLabel(file, now)}` and roving tab stop `tabIndex={file.path === tabPath ? 0 : -1}` — the icon is decorative (`Icon` renders through `Glyph`, `aria-hidden`), so neither changes; keep `data-testid={IDS.folder}` and `data-testid={IDS.fileButton}` on the same elements (the spec measures their boxes). Reuse: `Icon` from `../../components/icons` with a class this screen styles (`icons/index.tsx`: "the caller passes the class its screen styles").
- **`app/src/screens/memory/MemoryScreen.tsx`** — keep: the screen's own reads stay screen-local (`three are screen-local reads`); the roster is the store's existing `agents` resource, read with `useResource("agents", api)` exactly as `app/src/screens/budget/BudgetScreen.tsx` does — no new route, no new store resource; a roster that has not answered or failed never blocks or changes the tree (avatars fall back, the tree still draws, the empty/error states are unchanged); `useLiveStore(api)` stays; the header comment's Data bullet gains one line saying the screen also reads the live store's existing `agents` resource, for avatars only (the `three are screen-local reads` stay as they are).
- **`app/src/screens/memory/memory.css`** — keep: fixed row heights so a refetch moves nothing — `.memory-folder` keeps `height: var(--row-height);` (the long-name fix truncates inside it, never wraps); every colour is a token (no hex — pinned by `contrast.test.ts` and the e2e no-hex check); any new rule that sets `color` must be added to `contrast.test.ts`'s `TEXT` list (`every rule that sets a colour is listed`), with its ground.
- **`app/src/screens/memory/contrast.test.ts`** (only if touched) — keep its three checks (`every rule that sets a colour is listed`); a new colour rule gets a row in `const TEXT:` only, never a loosened ratio.
- **`app/e2e/memory.spec.ts`** — keep: screenshots go to the tracked dir only under `MEMORY_EVIDENCE=1`, else to the test output dir; the guard tests `AC13: the evidence README lists exactly the 16 screenshots` and the untouched-dir guard stay green (if a screenshot is added, the README and the 16-count pin change together); the AC11 live test that compares `boundingBox()` of rows and headers before/after stays green with avatars present; fixture differences are `routes` overrides passed to `startFixtureKernel` inside this file — never edits to `e2e/fixtures/memory.ts` or `e2e/fixture-kernel.ts`.
- **`app/src/screens/memory/MemoryScreen.test.tsx`** (only if touched) — keep every existing test; reuse its scripted bridge (`import { fakeBridge, ok } from "../../store/fake-bridge";`) and add only a `fake.route(` answer for `GET /agents` beside the existing `fake.route("GET /memory"`, nothing else.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/memory/FolderMark.test.tsx` — an agent folder with a roster entry renders an avatar (found with the `.bot` class selector via `querySelector`, not by role, since the slot is `aria-hidden`) | delete `<Avatar` in `app/src/screens/memory/FolderMark.tsx` |
| `app/src/screens/memory/FolderMark.test.tsx` — the `shared` folder renders the shared icon, not an avatar | flip `name="shared"` → `name="file"` in `app/src/screens/memory/FolderMark.tsx` |
| `app/e2e/memory.spec.ts` — every file row in the tree contains the file icon | delete `<Icon name="file"` in `app/src/screens/memory/MemoryViews.tsx` |
| `app/e2e/memory.spec.ts` — the long folder header carries its full name as `title` | flip `title={group.label}` → `title={undefined}` in `app/src/screens/memory/MemoryViews.tsx` |
| `app/e2e/memory.spec.ts` — the long folder header's height and gap to its first file row equal a short header's | remove `white-space: nowrap` from the `.memory-folder-name` rule in `app/src/screens/memory/memory.css` (reviewer-applied: the literal is not unique in the file) |

The worker writes the code so each mutation literal above exists exactly once in its file (`<Avatar` in `FolderMark.tsx`, `name="shared"` in `FolderMark.tsx`, `<Icon name="file"` and `title={group.label}` in `MemoryViews.tsx`), or updates this table's literal in the PR to the one it wrote.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Memory avatars, file icons, one-line long folder headers, evidence | all | 5–7 modify, 2 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/memory/FolderMark.tsx"}
  - {kind: "symbol", path: "app/src/screens/memory/FolderMark.tsx", name: "FolderMark"}
  - {kind: "file", path: "app/src/screens/memory/FolderMark.test.tsx"}
  - {kind: "symbol", path: "app/src/screens/memory/MemoryViews.tsx", name: "FolderMark"}
  - {kind: "symbol", path: "app/src/screens/memory/MemoryScreen.tsx", name: "useResource"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/memory/README.md"}
requires: []
lanes:
  - "app/src/screens/memory/**"
  - "app/e2e/memory.spec.ts"
  - "docs/evidence/phase-7-polish/memory/**"
external_requires: []
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
| A 20px avatar or icon makes `.memory-folder` / `.memory-file` taller than `--row-height`, shifting rows and breaking the AC11 box-identity test | MEDIUM | Size the slots inside the fixed height (`flex: none`, explicit width/height); run the AC11 test; screenshot check. |
| The default fixture kernel has no `GET /agents`, so the store's `agents` resource errors and every avatar falls back to the fish | MEDIUM | Add a `"GET /agents"` route with a roster (Wright whale, Ada, Mason with shapes/hues) via `startFixtureKernel`'s `routes` override in `memory.spec.ts`, as `playbooks.spec.ts` does; assert the fallback path in `FolderMark.test.tsx`. |
| An `Avatar` keeps `role="img"` with a state word ("Mason · idle") as both `aria-label` and `title`, so it claims a state Memory does not know | LOW | `FolderMark` passes `state="idle"` (the neutral state Integrations and Chat also pass) and wraps the avatar in an `aria-hidden="true"` slot (decorative, like `Icon`; the group's `aria-label` names the folder). The hover tooltip "<Name> · idle" still shows, because changing `Avatar` is outside Touches: record it in the evidence README's "Departures from the mockup" as a known difference, not a fix. |
| Needing a file outside Touches (fixture data, a component) | MEDIUM | Owner rule: stop and say so in the PR instead of patching it. Everything planned here fits `app/src/screens/memory`, `app/e2e/memory.spec.ts` and the screen's evidence dir. |
| `MEMORY_EVIDENCE=1` regenerates all 16 PNGs; pixel churn on unchanged states | LOW | Expected (the README says so); commit only the 16 pinned names; regenerate on macOS with the README's command. |
| Screenshot shows a home path or real data | LOW | The spec already answers `GET /settings` with a home-relative `data_dir`; the roster added is fixture names only. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-02-memory-avatars-file-icons-long-folders.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-02T07:54:15Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/209
- **Branch:** feature/memory-avatars-file-icons-long-folders
- **Files changed:** 24
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 0
- **Heal reason:** needs_human
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Memory draws roster avatars (shared icon for Shared) on tree headers and Pick-a-file rows, a file icon on every file row, and one-line truncated long folder headers with title; 16 evidence PNGs + README regenerated. Code Reviewer PASS (AC1–AC4 addressed; 2773 unit, 27 memory e2e green; required CI green). Escalated on one new MEDIUM (rosterEntry() test-helper now copied into a third spec, app/e2e/memory.spec.ts:70): every dedupe edits app/e2e/fixtures/** or playbooks.spec.ts, outside this item's Touches, which the binding owner constraint forbids — stopped and reported on the PR, no fixer run. Owner: accept as a follow-up or widen Touches.

## Not verified
- **fish/slate avatar fallback in the built app** — covered only in FolderMark.test.tsx (jsdom), not driven in Electron (subtask 1)
- **pin mutations 3–4 (delete the file Icon, flip the title)** — not mutated; judged from e2e spec text only (pins 1–2 held by hand, pin 5 failed AC2 as expected) (subtask 1)
