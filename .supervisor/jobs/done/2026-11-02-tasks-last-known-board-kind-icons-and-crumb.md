# Supervisor Job: Tasks — the last-known board across a remount, kind icons on cards, the shared crumb (item 23)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-171537/L6
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090023-tasks-last-known-board-across-remounts-kind-icons-and-crumb.md
- **Base commit:** 42c403c8f9fdd2bfe3d14baabcba47366388b4c0
- **Dependency:** item 21 (`2026-11-01-090021-shell-one-back-crumb-and-the-in-content-icon-set.md`) is merged at base (PR #205): `app/src/shell/Crumb.tsx` and `app/src/components/icons/index.tsx` (`ICON_NAMES` includes `task`, `session`, `run`, `back`) exist. `app/src/screens/budget/AuditLog.tsx:230` is the one adopter so far.

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React renderer + vitest (jsdom) + Playwright/Electron e2e, all already in `app/`. No new dependency. |
| 2 | Dependency Availability | GO | Item 21's `Crumb` and `Icon` are on `main`. Settings' per-bridge store (`app/src/screens/settings/lastKnown.ts`, a `WeakMap<StudioBridge, SettingsView>`) is the pattern to copy. The e2e fixture already has `started.stop()` / `started.restart()` (`app/e2e/tasks.spec.ts` AC1 test), and remounting by hash change is already done in `app/e2e/settings.spec.ts:489–494` (`#/tasks` then `#/settings`). |
| 3 | Architecture Fit | CAUTION | (a) The crumb's accessible name is `Back to Tasks` (`Crumb.tsx`: ``aria-label={`Back to ${parent}`}``). `TasksScreen.test.tsx` finds Back five times with `getByRole("button", { name: "Back" })`, which in Testing Library is an exact match, so those queries must change to `"Back to Tasks"`. That is an update to the new name, not a weakening. The e2e `getByRole("button", { name: "Back" })` (lines 399, 500, 574) is a substring match in Playwright and still finds it. But `app/e2e/tasks.spec.ts:573` `await tabTo(page, /^Back$/);` matches the focused element's `aria-label` with an anchored regex (`tabTo`, lines 152–163), so it must change to `/^Back to Tasks$/`. (b) The requirement says "Stop and Kill disabled" on the board. On the board, Stop and Kill appear only in an open card's log bar; the board's writes are the cards themselves, which are `aria-disabled` while offline (`TasksViews.tsx`, and a click does not open one). The existing AC1 e2e already asserts `toBeDisabled()` on `task:9`. This brief reads the AC as "cards disabled, no detail opens, so no Stop or Kill is reachable", matching `tasks-unreachable`. |
| 4 | Scope vs Supervisor Capability | GO | 4 source files, 1 new module + its test, the e2e spec, and the evidence folder. One worker; no split reason fires. |
| 5 | Hard Blockers | GO | None. The committed screenshots that Scope 4 requires live in `docs/evidence/phase-7-polish/tasks/`, outside the requirement's Touches. Scope 4 itself requires them, so this brief treats that folder as part of the item (see "Scope boundary"), as item 25's brief did for `docs/evidence/phase-7-polish/schedules/`. |

**Overall Verdict:** CAUTION (findings carried to Risk Assessment)

## Task
**Goal:** Opening Tasks again while the kernel is unreachable shows the last board read in this window, marked "· last known", with every card disabled. Each card's kind line starts with its kind icon. A card's detail uses the shell's crumb, "‹ Tasks / Task #1".

**Problem Statement:**
The owner needs Tasks never to go blank on a restart, and to match the GUI v2 mockup, so that Tasks passes its phase 7 polish gate (D9).

Currently:
- `app/src/screens/tasks/TasksScreen.tsx` holds the board only in component state (`const [data, setData] = useState<TasksResponse | undefined>();`, kept by `setData((last) => (result.status === 0 ? last : result.ok ? result.body : last));`). Switching screens unmounts it, so a remount starts with `data === undefined`. Its first unanswered read then draws `TasksFailure` ("Couldn't load tasks"), and the title line reads `"tasks"` (`subtitleOf`: `if (!loaded || board === undefined) return failed ? "tasks" : "";`).
- Memory (`screens/memory/held.ts`) and Settings (`screens/settings/lastKnown.ts`) keep a copy outside the component that survives a remount; Tasks has none.
- The card kind line (`TasksViews.tsx`, `<span className="tasks-card-kind">`) draws `{KIND_LABEL[item.kind]} #{item.id}` with no icon. The mockup draws `KIND_ICON2[c.kind]` first (`docs/design/mockups/gui-v2.html:924–927`: `const KIND_ICON2={task:I.list,run:I.book,session:I.term};`).
- The detail's crumb (`TaskDetail.tsx:95–105`) is a "Back" button, then "/ Tasks / Task #1". The mockup draws `<button class="btn ghost sm" id="back" …>${I.back}Tasks</button><span aria-hidden="true">/</span><span>${KIND_LABEL[c.kind]} #${c.id}</span>` (`gui-v2.html:967`).

Success: the e2e spec remounts Tasks with the listener stopped and sees the last board marked last known, cards show their icons, the crumb reads "Tasks / Task #9", and the committed light/dark evidence shows all three.

**Scope boundary (owner decision: "Nothing is patched outside an item's Touches"):**
- The requirement's Touches are `app/src/screens/tasks` and `app/e2e/tasks.spec.ts`.
- The evidence folder `docs/evidence/phase-7-polish/tasks/` (its README and PNGs) is edited because Scope 4 requires committed screenshots, and the spec's own README guards (`the evidence README lists every state's screenshot…`) read it. Precedent: item 25's brief and item 16.
- Nothing else is edited. In particular, `app/src/shell/Crumb.tsx`, `app/src/components/icons/index.tsx`, `app/src/shell/last-known.ts`, `app/e2e/fixtures/tasks.ts` and `docs/design/mockups/gui-v2.html` stay untouched. They are used as they are.
- A worker that finds it needs another file stops and says so in its result. It does not patch that file.
- The requirement's sentence "The screenshots stay outside the repo …; none is committed by these items" refers to the owner's 2026-10-31 decision on the **live-run, real-data** screenshots. It does not cover the fixture-kernel evidence that Scope 4 asks this PR to commit.

**Non-goals:** the session log's header in a task's history (owner decision 2026-11-01 re-run: accepted as built). No new kernel route, no fixture change, no new mockup view.

## Acceptance Criteria
- [ ] **AC1** Given Tasks loaded once, when the fixture kernel's listener stops and the owner switches to another screen and back to Tasks, then the last board shows under the band with "· last known" in the title line and the cards disabled (no detail opens, so Stop and Kill are not reachable), matching `tasks-unreachable`.
  - `app/e2e/tasks.spec.ts` gets a new test. It loads the populated board, calls `started.stop()`, waits for `kernel-unreachable-band`, sets `window.location.hash = "#/chat"` and waits until `screen-tasks` has count 0 (the screen really unmounted), then sets `"#/tasks"`. It asserts:
    - `screen-tasks` has `data-state="populated"`;
    - `tasks-subtitle` reads `"8 cards · 3 working · last known"`;
    - `card(page, "task:9")` is visible and disabled, and a click on it opens no `task-detail`;
    - `tasks-error` and `tasks-empty` have count 0, and the band has count 1.
  - A unit test in `TasksScreen.test.tsx` does the same with `fakeBridge`: render, answer `GET /tasks`, `unmount()`, render again on the **same** bridge with the next read answering status 0, and expect the board (not `tasks-error`) with the subtitle marked last known.
- [ ] **AC2** Given that state, when the listener restarts (`started.restart()`), then Tasks reads the board again, the band goes, `tasks-subtitle` reads `"8 cards · 3 working"`, `task:9` is enabled, and `boardReads(started)` has grown.
- [ ] **AC3** Given a window that never read the board, when the kernel is unreachable, then Tasks shows the error card as today. The existing e2e (`With no kernel at all, the screen says the kernel isn't answering`) and the existing unit tests for `TasksFailure` stay green unchanged. A new unit test checks that a remount on a **different** bridge that never answered shows `tasks-error`, not another bridge's board.
  - A unit test checks the refused-read case: remount on the same bridge with the next `GET /tasks` answering 500 `store_unreadable`. It expects the remembered board plus `tasks-stale`, and no `tasks-error`. A seeded board is never replaced by the error card on a refusal.
- [ ] **AC4** Given the board, then each card's kind line starts with its kind icon from item 21's set: `task` → `Icon name="task"`, `playbook_run` → `Icon name="run"`, `session` → `Icon name="session"`. The icon is drawn before the "Task #9" text, as `tasks-populated` draws it, light and dark.
  - A unit test checks each kind's card holds one `svg[aria-hidden="true"]` inside `.tasks-card-kind` whose markup matches that icon's path. Reuse `ICON_NAMES`/`Icon` and render the expected icon to compare; never copy the path strings.
  - The e2e checks that each of the populated board's 8 cards has one svg in its kind line, placed before the label text. It compares the svg's bounding box with a `Range` over the label's text node (`"Task #9"`), not with the span that holds both: `svg.right ≤ textRange.left`.
  - The card's accessible name (`aria-label`) is unchanged: the AC10 regex `^(Task|Playbook run|Session) \d+: .+, .+$` still passes.
- [ ] **AC5** Given a task's detail, then the crumb is item 21's `Crumb` with `parent="Tasks"` and `current="Task #1"` (it reads "‹ Tasks / Task #1", with no word "Back" in the visible text). Activating it returns to the board with focus on that card.
  - Both Back controls use `Crumb`: `TaskDetail.tsx`'s, and `TasksScreen.tsx`'s "no longer on the board" view (lines 300–317). The latter passes ``current={`${KIND_LABEL[open.kind]} #${open.id}`}``. A new unit test covers that view: it opens a card, drops the card from the next `GET /tasks` before its history answers, and checks the crumb's button is named "Back to Tasks" and returns to the board.
  - The `data-testid="task-back"` is kept through `Crumb`'s `testId`.
  - The visible crumb text is `"Tasks/Task #9"` (`textContent` of the crumb row, whitespace aside), and the button's accessible name is `"Back to Tasks"`.
  - The existing AC6 and AC8 e2e tests (Back and Esc return with focus on the card; Tab reaches Back, Stop and Kill) pass. To track the new name, without weakening anything:
    - the five unit-test queries for `{ name: "Back" }` (`TasksScreen.test.tsx` lines 602, 625, 762, 847, 861) change to `{ name: "Back to Tasks" }`;
    - `app/e2e/tasks.spec.ts:573` `tabTo(page, /^Back$/)` changes to `tabTo(page, /^Back to Tasks$/)`.
- [ ] **AC6** The polish-gate evidence is the committed file `docs/evidence/phase-7-polish/tasks/README.md`, which names a light and a dark screenshot from the running app (fixture kernel, through `app/e2e/electron-harness.ts`, regenerated with the README's `TASKS_EVIDENCE=1` command) for every mockup view this item changes: at least `tasks-populated` (kind icons), `tasks-history` (crumb) and `tasks-unreachable` (last-known board). The PR body links the README.
  - All 16 PNGs are regenerated on macOS. The `unreachable` capture keeps its setup (a fresh launch with `GET /status` answering 503 from the start, `tasks.spec.ts:767–778`, README line 32), so its row's description stays the same. The regenerated pair shows the kind icons. The remount behaviour is checked by the new AC1 e2e and the README's AC7 row, not by pixels.
  - The README's `history` row says "crumb ‹ Tasks / Task #9" instead of "crumb with Back".
  - The `populated` row mentions the kind icons.
  - The AC7 row in "What the spec checks" adds the remount check.
  - The "Screen" and "Unit tests" source lines (README lines 5–6) also list `lastKnown.ts` and `lastKnown.test.ts`.
  - The capture date is updated.
  - The spec's README tests (`the evidence README lists every state's screenshot in both themes, and the folder holds nothing else`) still pass.
- [ ] **AC7** Given the change, then `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` and `bash scripts/check-docs.sh` all pass. No existing test is deleted or weakened.

## Phase 3: ANALYZE (summary)

**Tech stack:** TypeScript (strict), Electron + React 19, vitest (jsdom), Playwright/Electron e2e.

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| last-known board | `app/src/screens/tasks/TasksScreen.tsx` (386 lines). Seed `data` from the new store (`useState<TasksResponse \| undefined>(() => getLastBoard(api))`). On every `ok` read, call `setLastBoard(api, result.body)`. The "no longer on the board" Back becomes `Crumb`. | `app/src/screens/tasks/lastKnown.ts`: a per-bridge `WeakMap<StudioBridge, TasksResponse>` with `getLastBoard`, `setLastBoard` and `resetLastBoards`, modelled on `screens/settings/lastKnown.ts`. No React, no subscription needed: the subtitle is still written by the screen. `app/src/screens/tasks/lastKnown.test.ts`. | HIGH |
| kind icons + crumb | `app/src/screens/tasks/TasksViews.tsx` (271 lines): a kind → `IconName` map and `<Icon … className="tasks-glyph" />` first in `.tasks-card-kind`'s label span. `app/src/screens/tasks/TaskDetail.tsx` (238 lines): `Crumb` replaces the Back/Tasks/Task row. `app/src/screens/tasks/tasks.css` (490 lines): a `.tasks-glyph` rule (14×14, `flex: none`, as `.budget-glyph`), the label span made `inline-flex` with `gap: var(--space-2)`, and `.tasks-crumb .btn { margin-left: calc(var(--space-2) * -1); }` (mockup `.crumb .btn`). | — | HIGH |
| tests + evidence | `app/src/screens/tasks/TasksScreen.test.tsx` (1007 lines), `app/e2e/tasks.spec.ts` (807 lines), `docs/evidence/phase-7-polish/tasks/README.md` and its 16 PNGs. | — | HIGH |

> **Module layout** (`skills/supervisor-readiness/SKILL.md` §"Module layout"; line counts by `wc -l` at base):
> - The new responsibility (keeping the board across a remount) gets its own CREATE module, `lastKnown.ts`, named after Settings' sibling.
> - The kind → icon map lives in `TasksViews.tsx` (271), the only file that draws cards. It is not added to `model.ts` (388), which holds data rules, not markup.
> - `TasksScreen.test.tsx` (1007) and `tasks.spec.ts` (807) are past the threshold. The store's own tests go in the new `lastKnown.test.ts`. Appending the remount, icon and crumb tests to `TasksScreen.test.tsx` (1007 — the single home of the screen's render tests and its `fakeBridge` harness) and `tasks.spec.ts` (807 — the single home of the screen's e2e, its `startKernel`/`openWith`/`card` helpers and its evidence writer) is the one reason: splitting the harness for three tests would duplicate it.
> - Extract row: none. `screens/settings/lastKnown.ts` and the new module are two copies of a ~20-line WeakMap pattern over different value types. A shared generic is out of Touches (`app/src/shell/` is item 21's), so it is recorded as a follow-up, not done here.

> **Validator-owned surfaces:**
> - `bash scripts/check-docs.sh` scans `docs/`, so the evidence README is the file it may flag (relative links must resolve).
> - `tasks.spec.ts`'s README test requires exactly the 16 PNGs plus `README.md` in the folder, and `tasks-${state}` named in the README.
> - A unit test reads `tasks.css` and rejects hex, `rgb(` and `hsl(`, so new rules use tokens only.

### File Overlap Detection

Single subtask, so there is no overlap.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | base 42c403c |
| `docs/design/mockups/gui-v2.html:924` | yes | HOLDS | `const KIND_ICON2={task:I.list,run:I.book,session:I.term};` | base 42c403c |
| `docs/design/mockups/gui-v2.html:967` | yes | HOLDS | `<div class="crumb"><button class="btn ghost sm" id="back" data-act="back-tasks">${I.back}Tasks</button>` | base 42c403c |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins). Consulted with `read-rules.sh --with-ids` on the File Impact Map.

- E2E specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), which keeps every window hidden; never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts` enforces it). The remount uses a hash change in the already-launched window, never a second launch.
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory

## Touched-file invariants

> Grounded at base `42c403c8f9fdd2bfe3d14baabcba47366388b4c0`. The worker re-checks each entry before hand-back.

- **`app/src/screens/tasks/TasksScreen.tsx`** — keep:
  - "A read the kernel did not answer (or refused) never replaces what is on screen": `setData((last) => (result.status === 0 ? last : result.ok ? result.body : last));`. Only an `ok` body is written to the store; a status-0 read or a refusal never clears or overwrites it.
  - The stale-read guard `if (!mounted.current || mine !== seq.current) return;` runs **before** the store write, so a read from an unmounted screen never writes.
  - One band only: `const band = offline && !reach.shellBand ? <KernelBand testId="tasks-kernel-band" /> : null;`.
  - `subtitleOf`'s no-board branch, `return failed ? "tasks" : "";`, is still what a window that never read the board shows (AC3). A seeded board goes through the `withLastKnown(…, offline)` branch like a live one.
  - `const offline = reach.offline || readError?.kind === "connection";`: this is what marks a seeded board last known on a remount whose first read answers status 0 before the shell notices.
  - The title line is cleared on unmount: `useLayoutEffect(() => () => setSubtitleLine(""), []);`.
- **`app/src/screens/tasks/TaskDetail.tsx`** — keep:
  - The detail region takes focus on open (`regionRef.current?.focus();`), so Tab reaches the crumb's button first.
  - `data-testid="task-back"`, passed through `Crumb`'s `testId`.
  - Every kernel string stays a text child. `current` is built from `KIND_LABEL` and a number only.
- **`app/src/screens/tasks/TasksViews.tsx`** — keep:
  - The card's `aria-label={cardLabel(item)}` (the icon is `aria-hidden` through `Glyph`) and `aria-disabled={offline ? true : undefined}` with `if (!offline) onOpen(card);`.
  - The state badge stays at the kind line's right (`justify-content: space-between`).
- **`app/src/screens/tasks/tasks.css`** — keep: colours from tokens only. `TasksScreen.test.tsx:999–1005` reads the file (`const css = read("./tasks.css");`) in `it("uses only design tokens: no hex, rgb( or hsl( colour", …)`. The existing `.tasks-card-kind {` rule keeps `justify-content: space-between;`. Every size uses existing `var(--space-*)` tokens or a literal px, as `.budget-glyph` does.
- **`app/e2e/tasks.spec.ts`** — keep:
  - `const EVIDENCE = process.env.TASKS_EVIDENCE === "1";`, so CI never writes the tracked folder.
  - `const STATES = ["empty", "loading", "populated", "waiting", "other", "error", "unreachable", "history"] as const;` stays unchanged (no new state).
  - The README test.
  - `launchApp` as the only launch path.
- **`docs/evidence/phase-7-polish/tasks/README.md`** — keep:
  - the regenerate command `TASKS_EVIDENCE=1 npx playwright test e2e/tasks.spec.ts --workers=1 -g AC11`;
  - the table naming each pair against its `gui-v2.html` view id;
  - "exactly the sixteen files".

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| e2e + unit — AC1: a remount with the listener stopped shows the last board, last known | flip `useState<TasksResponse \| undefined>(() => getLastBoard(api))` → `useState<TasksResponse \| undefined>()` in `app/src/screens/tasks/TasksScreen.tsx` |
| unit — AC1: an `ok` read is remembered for the next mount | delete `setLastBoard(api, result.body);` in `app/src/screens/tasks/TasksScreen.tsx` |
| unit — AC3: a refused read on a remount keeps the seeded board with `tasks-stale` | flip `result.ok ? result.body : last))` → `result.ok ? result.body : undefined))` in `app/src/screens/tasks/TasksScreen.tsx` |
| e2e — AC2: the restart clears the mark | flip `withLastKnown(\`${board.total} ${board.total === 1 ? "card" : "cards"} · ${board.working} working\`, offline)` → `withLastKnown(\`${board.total} ${board.total === 1 ? "card" : "cards"} · ${board.working} working\`, true)` in `app/src/screens/tasks/TasksScreen.tsx` |
| unit — AC3: a different bridge that never answered shows the error card | flip `const keyOf = (api: StudioBridge): object => api;` → `const keyOf = (api: StudioBridge): object => globalThis;` in `app/src/screens/tasks/lastKnown.ts` |
| unit — AC5: the "no longer on the board" view uses the crumb | flip ``current={`${KIND_LABEL[open.kind]} #${open.id}`}`` → `current=""` in `app/src/screens/tasks/TasksScreen.tsx`; also revert-to-base mutant: the `<Button … data-testid="task-back">Back</Button>` (name "Back", not "Back to Tasks") turns the new unit test red |
| unit + e2e — AC4: each card's kind line starts with its kind icon | delete `<Icon name={KIND_ICON[item.kind]} className="tasks-glyph" />` in `app/src/screens/tasks/TasksViews.tsx` |
| unit + e2e — AC4: the icon matches the kind | flip `session: "session"` → `session: "task"` in the kind → icon map in `app/src/screens/tasks/TasksViews.tsx` |
| unit + e2e — AC5: the crumb reads "Tasks / Task #N" | flip `parent="Tasks"` → `parent="Back"` in `app/src/screens/tasks/TaskDetail.tsx` |

**Making each row machine-applicable.** Before hand-back, the worker replaces every "worker-filled" row with one literal from its final diff. Each literal must be unique in its file and have the form `` delete `<literal>` in `<path>` `` or `` flip `<A>` → `<B>` in `<path>` ``, with nothing conditional. The worker also confirms that each pin goes red on its mutant, using a scratch run of the one test.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Keep Tasks' last board per bridge across a remount, draw kind icons on cards, adopt the shared crumb, with unit + e2e checks and regenerated light/dark evidence | AC1, AC2, AC3, AC4, AC5, AC6, AC7 | 7 modify (+ 16 PNGs), 2 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/tasks/lastKnown.ts"}
  - {kind: "symbol", path: "app/src/screens/tasks/lastKnown.ts", name: "getLastBoard"}
  - {kind: "symbol", path: "app/src/screens/tasks/lastKnown.ts", name: "setLastBoard"}
  - {kind: "symbol", path: "app/src/screens/tasks/lastKnown.ts", name: "resetLastBoards"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/tasks/README.md"}
requires: []
external_requires:
  - {kind: "symbol", path: "app/src/shell/Crumb.tsx", name: "Crumb"}
  - {kind: "symbol", path: "app/src/components/icons/index.tsx", name: "Icon"}
lanes:
  - "app/src/screens/tasks/**"
  - "app/e2e/tasks.spec.ts"
  - "docs/evidence/phase-7-polish/tasks/**"
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
| A cached board can be stale (requirement risk). | MEDIUM | Writes go to the store only from `ok` reads. The refused-read case is pinned under AC3. A seeded board shows "· last known" whenever `offline`, and the cards are disabled. The next answered read replaces it (AC2). |
| A seeded board on a remount whose first read the kernel **refuses** (500) shows the board with the existing `tasks-stale` note, not the error card. | LOW | This is intended, the same as a mounted screen today ("This board is from the last read that answered…"). A unit test pins it. |
| The crumb changes Back's accessible name to "Back to Tasks", so the exact-name queries break. Source: Feasibility (Phase 2.5). | LOW | Update the five `TasksScreen.test.tsx` queries and `tasks.spec.ts:573`'s `tabTo(page, /^Back$/)` to the new name. The e2e `getByRole` substring queries keep working as they are. No assertion is dropped. |
| "Stop and Kill disabled" on the board has no Stop/Kill element to check; the board's writes are the cards. Source: Feasibility (Phase 2.5). | LOW | AC1 asserts the cards are disabled and a click opens no detail, as `tasks-unreachable` draws. The detail's Stop/Kill already turn off with `offline` (`stopApplies`). |
| The store is module state; unit tests that reuse a bridge across tests could leak a board. | LOW | `resetLastBoards()` in the test file's `afterEach`. `fakeBridge()` builds a new bridge per test, and the WeakMap is keyed on it. |
| `TASKS_EVIDENCE=1 npm run e2e` would rewrite other screens' tracked PNGs. | LOW | Regenerate with the README's single-spec command. Commit only `docs/evidence/phase-7-polish/tasks/**`. |
| Screenshot fonts differ between macOS and CI. | LOW | The spec checks behaviour and DOM boxes, never pixels. Regenerate the PNGs on macOS. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-02-tasks-last-known-board-kind-icons-and-crumb.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-02T08:01:12Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/210
- **Branch:** feature/tasks-last-known-board-kind-icons-and-crumb
- **Files changed:** 19
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Tasks keeps its last board per bridge (new `lastKnown.ts`) so a remount while the kernel is unreachable shows it "· last known" with cards disabled; cards draw their kind icon; TaskDetail and the gone view use the shared Crumb. Phase 4.5 code review PASS on the first pass (2 LOW nits dismissed); all 9 pin mutations killed by unit tests in the reviewer's scratch copy; the automated pin script left all 9 unverified because it executes only `*.sh` pins. Unit tests 2776/2776, typecheck, build and check-docs green; required CI green. The drain dispatch was skipped (`.supervisor/config.json` `auto_review: false`).

## Not verified
- **full `npm run e2e` all-green** — `chat.spec.ts` AC9 ("Tab reaches Pim") failed once under load in the 9-minute run; it passes alone and is outside this lane (subtask 1)
- **regenerated evidence PNGs** — the worker viewed only populated-light and history-dark; the other changed PNGs come from the same run, which asserted DOM boxes only (subtask 1)
