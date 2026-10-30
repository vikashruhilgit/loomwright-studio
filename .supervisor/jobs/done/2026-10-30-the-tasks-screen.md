# Supervisor Job: The Tasks screen: today's work grouped by state, with history and session logs (phase 7 item 03)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-192357/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140003-the-tasks-screen.md
- **Base commit:** f2fdc984476c914dfa2971eb9f014258e99ac846

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TS kernel (vitest) + React/Electron app (vitest, Playwright); the routes fill an existing empty `gui` part, the screen replaces an existing placeholder |
| 2 | Dependency Availability | GO | No new dependency. The contract shapes (`TasksResponse`, `TaskHistoryResponse`, `TaskBoardItem`, `PlaybookRun`, `SessionSummary`, `Approval`, `EventFrame`) are already in `app/src/api/contract.ts`; the fixture kernel already answers both routes empty |
| 3 | Architecture Fit | GO | Same shape as phase 6's drafts part (`kernel/src/integrations/drafts.ts`) and phase 5's Sessions screen (StreamingLog, `SessionOutputReader`, Stop/Kill routes) |
| 4 | Scope vs Supervisor Capability | CAUTION | ~13 source files plus 14 committed screenshots: above one worker's bound. Split two ways (kernel / app) with zero file overlap |
| 5 | Hard Blockers | CAUTION | The mockup (`docs/design/mockups/gui-v2.html`) shows four columns ("Waiting on you", "Working", "Parked", "Done today"), while `GET /tasks` groups by each source's verbatim state, and `tasks.state` is free text ("the kernel defines no states", `kernel/src/tools/server.ts`). The app owns the state→column mapping in one module, pinned by a unit test. An unknown task state needs a column; this brief fixes it (below) |

**Overall Verdict:** CAUTION

## Task
**Goal:** Serve `GET /tasks` and `GET /tasks/:kind/:id` from the `gui` feature's `tasks` part, and replace the Tasks placeholder with the board the GUI v2 mockup designs: tasks, playbook runs and sessions grouped by state, each card opening to its history and session log (a running session's log streams; Stop and Kill reuse phase 5's session routes). Commit light and dark screenshots of every Tasks state the mockup shows.

**Problem Statement:**
The owner has no single view of what the kernel is doing or did. The kernel has `tasks`, `playbook_runs` and `sessions`, but no route lists tasks or an item's history (the API serves `/sessions` and `/sessions/:id/output` only), and the Tasks screen is still the phase 7 foundation's "Coming in this phase" placeholder.
On the owner's machine on 2026-10-30, `tasks` holds no rows, so playbook runs and sessions are what the board mostly shows today.
Success looks like ⌘6 opening a board that shows what is waiting, running, parked or done today, without the CLI. The board is honest: green only for what the kernel recorded as done. It is live from the feed and keeps its last data when the kernel goes away.

## Acceptance Criteria
- [ ] **AC1 (kernel, list):** Given a store with tasks, playbook runs and sessions in several states, when `GET /tasks` is called, then it answers `TasksResponse`:
  - Every row is a `TaskBoardItem` with its source's own state, verbatim.
  - Rows are ordered newest first by `updated`, then by `kind`, then by `id` descending.
  - Rows are grouped by `state` in the order each state first appears.
  - A session that a task owns (`sessions.task_id` set, or named by a `tasks.owner_session_id`) or that a playbook run owns (`playbook_runs.session_id`) is not its own card.
  - `limit` defaults to 50, at most 200. `before` is the opaque cursor from `next_before`, and `next_before` is `null` once the oldest row is in the page.
  - A bad `limit` or `before` answers 400 `invalid_query`.
  - `kernel/test/gui-tasks.test.ts` pins each of these.
- [ ] **AC2 (kernel, history):** Given an item, when `GET /tasks/:kind/:id` is called, then it answers `TaskHistoryResponse`:
  - The `item`, plus its sessions (a task's own sessions, a run's session, or the session itself).
  - The events that name the item or one of its sessions, oldest first. At most the newest 500 are kept, and `session_output_appended` is excluded: the log shows output.
  - Its playbook runs: a run's own row, or the runs of its sessions.
  - The approvals whose `requesting_session` is one of its sessions, pending first. The contract's doc comment also says "or playbook". This item deliberately leaves out approvals named only by playbook, because a playbook spans many runs. `contract.ts` is not edited here, and the kernel tests and the app fixtures both follow this narrower rule.
  - A `kind` outside `task`, `playbook_run`, `session` answers 400 `invalid_kind`. A non-positive or non-integer id answers 400 `invalid_id`. A missing row answers 404 `not_found`.
  - Every stored string is returned as data, never interpreted.
- [ ] **AC3 (kernel, seams):** Given the `gui` feature, when its pins run, then:
  - `tasksRoutes` holds exactly `GET /tasks` and `GET /tasks/:kind/:id`, and neither sets `unauthenticated`.
  - `kernel/test/gui-foundation.test.ts` is rewritten (below) so it still pins that every gui part holds no tools, subcommands, handlers or due work and serves no unauthenticated route, without asserting that a part's routes are empty.
  - `kernel/test/feature-seams.test.ts` (the CLI module-graph pin) and `kernel/test/console-contract.test.ts` pass unchanged.
- [ ] **AC4 (board, honest status):** Given the fixture kernel with tasks, runs and sessions in several states, when the Tasks screen opens, then the cards sit in the mockup's four columns, in its order: "Waiting on you", "Working", "Parked", "Done today". The mapping is the one table below, held in `app/src/screens/tasks/model.ts` and pinned by `model.test.ts`. A badge is green (`ok` tone) only for task `done`, run `done` or session `completed`. Every state is shown as the kernel's own word.
- [ ] **AC5 (empty):** Given no rows, when the screen opens, then the designed empty state shows ("No tasks yet." and the mockup's note), never an empty board.
- [ ] **AC6 (detail):** Given a card, when it is opened (click or Enter), then:
  - Its facts, its history (the response's events) and its session's log render, the log through `StreamingLog`, read with `SessionOutputReader` from `GET /sessions/:id/output`.
  - A card with no session shows the mockup's "no log yet" note.
  - A running session's log appends new rows when the feed announces `session_output_appended` for it.
  - For a live session, Stop and Kill (Kill asks first) post `POST /sessions/:id/stop` / `kill`, and the status shown is the kernel's answer.
  - Back (or Esc) returns to the board with focus on the card that opened it.
- [ ] **AC7 (unreachable):** Given the kernel becomes unreachable, when the board or a card is showing, then the shell's `kernel-unreachable-band` shows, the screen keeps its last data (subtitle "last known") with cards and controls disabled, and nothing throws. The screen never falls back to the empty state.
- [ ] **AC8 (keyboard and palette):** Given the keyboard only, then ⌘6 opens Tasks, J/K and ↓/↑ move between cards across columns, Enter opens a card, Tab reaches Back, Stop and Kill, and Esc returns. The ⌘K palette lists `Open Tasks` (`screens.tasks`, ⌘6) and, while a card with a live session is open, `tasks.stop` and `tasks.kill` (group "Tasks", owner `tasks`, unregistered on unmount).
- [ ] **AC9 (live):** Given the board is showing, when the feed delivers an event of any kind except `session_output_appended`, then the screen refetches `GET /tasks` and moves the card without a reload. Cards and column headers that did not change keep their position (the e2e compares their bounding boxes before and after).
- [ ] **AC10 (accessibility):** Given VoiceOver, then:
  - Every card button has an accessible name: kind, id, title and state, as the mockup's `aria-label`.
  - Every column is a labelled region, every badge's state is text, and the log is a `role="log"` with a label.
  - In both themes, the spec's contrast check gives at least 4.5:1 for card title, meta and badge text against their background.
  - `tasks.css` uses only design tokens (no hex or rgb literals).
- [ ] **AC11 (polish gate):** Given the built app, when `TASKS_EVIDENCE=1 npx playwright test e2e/tasks.spec.ts --workers=1` runs on macOS, then light and dark screenshots of each of the mockup's seven Tasks states (empty, loading, populated, waiting, error, unreachable, history) are written to `docs/evidence/phase-7-polish/tasks/`. A committed evidence file `docs/evidence/phase-7-polish/tasks/README.md` names each screenshot pair against its mockup view id (`tasks-empty` … `tasks-history`) and how the state was produced, and the PR body links to it. A spec test pins that the README lists exactly the 14 files and that the folder holds nothing else.
- [ ] **AC12 (validation):** Given the validation commands, when run, then all of these pass:
  - `cd kernel && npm ci && npm run typecheck && npm test`
  - `cd app && npm ci && npm run typecheck && npm test && npm run build`
  - `cd app && npx playwright test e2e/tasks.spec.ts e2e/smoke.spec.ts --workers=1`, which launches only through `app/e2e/electron-harness.ts`
  - `bash scripts/check-docs.sh`

### The state→column mapping (AC4)

| Source | Waiting on you | Working | Parked | Done today (only if `ended ?? updated` is today, local time) |
|---|---|---|---|---|
| task (`tasks.state`, free text) | `waiting` | `working`, and **any other value** (neutral badge, verbatim word) | `parked` | `done` (green) |
| playbook run (`PLAYBOOK_RUN_STATUSES`) | — | `running` | `parked` | `done` (green), `failed` (danger), `skipped_duplicate`, `skipped_not_enabled` (neutral) |
| session (`SessionStatus`) | `failed:auth` (danger: paused on the token, as the mockup) | `starting`, `running` | `interrupted`, `orphaned` | `completed` (green), `failed` (danger), `stopped`, `abandoned` (neutral) |

Badge tones follow the mockup's `STATE_BADGE`: `waiting` attention, `working`/`running` accent, `parked`/`interrupted` parked, `done`/`completed` ok, `failed`/`failed:auth` danger, anything else neutral (including `starting` and `orphaned`, which the mockup's `STATE_BADGE` has no key for; `orphaned` still sits in the Parked column). A terminal card that ended before today is not on the board (the mockup's column is "Done today"). When "Waiting on you" is non-empty, the column takes the attention style and the screen shows the mockup's attention band with the count. Column labels and empty notes are the mockup's `COLS` strings.

### Kernel route rules (AC1, AC2)

- `GET /tasks`: build the union in SQL, one `SELECT` per source.
  - Task: `title`; `assignee_agent` as `agent`; `owner_session_id` as `session`; `created_at` as `started`; `ended` null; `updated_at` as `updated`.
  - Run: `playbooks.name` as `title`; `playbooks.owning_agent` as `agent`; `playbook`, `item_ref`, `session_id`, `tokens`, `started_at`, `ended_at`; `coalesce(ended_at, started_at)` as `updated`.
  - Session: `title` null; `agent`, `playbook`, `started_at`, `ended_at`, `updated_at`; tokens as `sum(budget.counted_tokens)`, as `listSessions` in `kernel/src/console/output.ts` does.
  - The cursor encodes `(updated, kind, id)` of the page's last row. Its format is the kernel's own, and the app treats it as opaque.
- `GET /tasks/:kind/:id`: events via `eventFrameOf` (`kernel/src/console/events.ts`), sessions in `SessionSummary`'s field order, runs in the contract's `PlaybookRun` field order, approvals via `approvalView` (`kernel/src/approvals/store.ts`). If the module-graph pin rejects an import, query the columns directly instead.
- Validate the query like `kernel/src/integrations/drafts.ts` does (`positiveInteger`, `invalidQuery`), with the error codes above.

## Touched-file invariants

> Grounded at base `f2fdc984476c914dfa2971eb9f014258e99ac846`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/gui/tasks.ts`**
  - Keep: the header rule ending `none sets \`unauthenticated\`` (it spans two comment lines). Keep the exported names `tasksRoutes` and `tasksPart`; `kernel/src/gui/index.ts` re-exports them (`export { tasksPart, tasksRoutes } from "./tasks.js";`). Keep the part shape `name: "tasks"` with `tools`, `subcommands`, `handlers` and `dueWork` frozen and empty, and `routes: tasksRoutes`. `GUI_PARTS` order is unchanged.
  - Imports: only types, the feature seam, `../console/events.js` and helpers that load no SDK. `kernel/src/gui/index.ts` says so (`never the Agent SDK, the session`), and `kernel/test/feature-seams.test.ts` pins the registry's module graph.
  - Reuse: the drafts part's handler idiom (`function listHandler(req: ContributedRouteRequest): Promise<ContributedRouteResponse>`, `positiveInteger`, `invalidQuery`, routes array `satisfies ContributedRoute[]`).
  - Pinned by: `kernel/test/gui-foundation.test.ts`, `kernel/test/feature-seams.test.ts`.
- **`kernel/test/gui-foundation.test.ts`**
  - Keep: `is tenth and last in the registry, after integrations, and merges with no conflict`, `names its six parts in a fixed order`, `serves no gui route unauthenticated` (it already reads `GUI_PARTS.flatMap((p) => p.routes)`) and `builds a contribution from the parts it is given`.
  - Rewrite: `holds every part empty: no tools, routes, subcommands, handlers or due work (until each screen item fills its part)` becomes `holds no tools, subcommands, handlers or due work in any part: gui parts serve routes only`. Drop `expect(part.routes, part.name).toEqual([]);` and replace `expect(Object.keys(guiContribution)).toEqual(["name"]);` with a check that the keys are `["name"]` when no part has a route and `["name", "routes"]` otherwise. This is generic on purpose, so items 04–08 need no further edit to this pin.
  - Update the file's header comment, which says each item `edits this file's pins for it (the empty-part pin, below)`.
- **`app/src/screens/tasks/index.tsx`**
  - Keep `export const screen: ScreenDefinition` with `id: "tasks"`, `title: "Tasks"` and `nav: { label: "Tasks", order: 6, shortcut: "⌘6" }`. The shell discovers it through `import.meta.glob` in `App.tsx`, and `App.test.tsx` and `app/e2e/smoke.spec.ts` pin the sidebar entry `Tasks⌘6` and the palette row `["screens.tasks", "Screens", "⌘6"]`.
  - The screen root keeps `data-testid="screen-tasks"`: `App.test.tsx`'s routing loop asserts `screen.getByTestId(\`screen-${id}\`)` with no bridge.
  - With no `window.api`, the screen renders a plain state, never a throw (the `IntegrationsScreen` idiom: `getBridge() as StudioBridge | undefined`).
  - Stop importing `../placeholder`. `app/src/screens/placeholder.tsx` stays: the other five stubs use it.
- **Reused as-is (read, not modified):**
  - `app/src/screens/sessions/model.ts` (`isLive`, `effectiveStatus`, `ControlState`, `rowToLine`) and `app/src/screens/sessions/output.ts` (`SessionOutputReader`, `OUTPUT_PAGE_LIMIT`).
  - `app/src/components/StreamingLog/StreamingLog.tsx`, `Badge`, `Button`, `Dialog`, `Avatar`.
  - `app/src/store/react.ts` (`useLiveStore`, for `connection` and `eventLog`) and `app/src/commands/registry.ts`.
  - `app/e2e/fixture-kernel.ts`: per-spec `routes` merge over `DEFAULT_ROUTES`, and `appendEvent`.
  - `app/e2e/fixtures/sessions.ts` (`outputRow`, `sessionEvent`).
  - No subtask edits any of these files.

## Closed enumerations touched

> Sibling grep at base `f2fdc98`: `grep -rnF 'invalid_query' app/src kernel/src docs` → `kernel/src/integrations/drafts.ts` (2), `kernel/src/console/output.ts` (1), `docs/architecture/draft-mode.md` (1), `docs/architecture/session-output.md` (2). `grep -rnF 'invalid_kind' app kernel docs` → no hits.

- **`invalid_kind`** (a new `ApiError.error` code; sibling: `invalid_query`). `ApiError.error` in `app/src/api/contract.ts` is an open `string`, so no closed union exists. Each hit:
  - `kernel/src/integrations/drafts.ts`: the drafts part's own `invalidQuery` helper. No change: it is local to its part.
  - `kernel/src/console/output.ts`: the `INVALID_QUERY` response of `/sessions`. No change: local to its route.
  - `docs/architecture/draft-mode.md`, `docs/architecture/session-output.md`: each route's own prose. No change: they document other routes.
- The board's column ids (`wait`, `work`, `park`, `done`) and the refetch predicate are new closed sets in the new `app/src/screens/tasks/model.ts`. They extend no existing list.

## Pin mutations

> The new code's literals named here are fixed by this brief: each worker writes them exactly as quoted, so each mutation applies verbatim.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/gui-tasks.test.ts` — newest first by `updated` | flip `ORDER BY updated DESC, kind, id DESC` → `ORDER BY updated ASC, kind, id DESC` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — tie-break by `kind`, then `id` descending | flip `ORDER BY updated DESC, kind, id DESC` → `ORDER BY updated DESC, kind, id ASC` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — each card's state is its source's own word, verbatim (a fixture task state `Waiting On Review` comes back unchanged) | flip `t.state AS state` → `lower(t.state) AS state` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — groups in first-appearance order | flip `groups.push(group)` → `groups.unshift(group)` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — an owned session is not its own card | delete `AND s.id NOT IN (SELECT session_id FROM playbook_runs WHERE session_id IS NOT NULL)` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — a task-owned session is not its own card | delete `AND s.task_id IS NULL AND s.id NOT IN (SELECT owner_session_id FROM tasks WHERE owner_session_id IS NOT NULL)` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — `limit` defaults to 50 | flip `const DEFAULT_LIMIT = 50;` → `const DEFAULT_LIMIT = 500;` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — `limit` at most 200 | flip `const MAX_LIMIT = 200;` → `const MAX_LIMIT = 2000;` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — bad `limit`/`before` answers 400 `invalid_query` | flip `error: "invalid_query"` → `error: "bad_query"` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — paging ends with `next_before: null` | flip `next_before: rows.length > limit ? cursorOf(page[page.length - 1]) : null` → `next_before: cursorOf(page[page.length - 1])` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — history: bad kind answers 400 `invalid_kind` | flip `error: "invalid_kind"` → `error: "invalid_query"` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — history: bad id answers 400 `invalid_id` | flip `error: "invalid_id"` → `error: "invalid_query"` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — history: missing row answers 404 `not_found` | flip `status: 404, body: { error: "not_found" }` → `status: 200, body: { error: "not_found" }` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — history keeps at most the newest 500 events | flip `const MAX_HISTORY_EVENTS = 500;` → `const MAX_HISTORY_EVENTS = 5;` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — history excludes `session_output_appended` | delete `AND kind <> 'session_output_appended'` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — approvals pending first | flip `ORDER BY status = 'pending' DESC, id DESC` → `ORDER BY id DESC` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — `tasksRoutes` holds exactly the two routes | delete `{ method: "GET", path: "/tasks/:kind/:id", handler: historyHandler },` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-foundation.test.ts` — no unauthenticated gui route | flip `{ method: "GET", path: "/tasks", handler: listHandler },` → `{ method: "GET", path: "/tasks", handler: listHandler, unauthenticated: true },` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-foundation.test.ts` — gui parts hold no handlers | flip `handlers: Object.freeze({}),` → `handlers: Object.freeze({ message: () => undefined }),` in `kernel/src/gui/tasks.ts` |
| `app/src/screens/tasks/model.test.ts` — green only for done | flip `failed: "danger",` → `failed: "ok",` in `app/src/screens/tasks/model.ts` |
| `app/src/screens/tasks/model.test.ts` — an unknown task state goes to Working | flip `return TASK_COLUMNS[state] ?? "work";` → `return TASK_COLUMNS[state] ?? "park";` in `app/src/screens/tasks/model.ts` |
| `app/src/screens/tasks/model.test.ts` — Done today only | delete `if (column === "done" && !isToday(item.ended ?? item.updated, now)) continue;` in `app/src/screens/tasks/model.ts` |
| `app/src/screens/tasks/model.test.ts` — feed refetch skips output events | flip `kind !== "session_output_appended"` → `true` in `app/src/screens/tasks/model.ts` |
| `app/src/screens/tasks/TasksScreen.test.tsx` — no bridge renders a plain state | delete `if (api === undefined) return <TasksNoKernel />;` in `app/src/screens/tasks/index.tsx` |
| `app/src/screens/tasks/TasksScreen.test.tsx` — empty state when no rows | delete `if (board.total === 0) return <TasksEmpty />;` in `app/src/screens/tasks/TasksScreen.tsx` |
| `app/src/screens/tasks/TasksScreen.test.tsx` — palette commands `tasks.stop`/`tasks.kill`, unregistered on unmount | delete `return () => registry.unregister(TASKS_OWNER);` in `app/src/screens/tasks/TasksScreen.tsx` |
| `app/src/screens/tasks/TasksScreen.test.tsx` — tasks.css uses tokens only | add `.tasks-card { color: #777; }` to `app/src/screens/tasks/tasks.css` (the test reads the file as text and rejects `#hex`, `rgb(` and `hsl(`) |
| `app/e2e/tasks.spec.ts` — live update without reload | delete `useEffect(() => { void refetch(); }, [refetch, feedMark]);` in `app/src/screens/tasks/TasksScreen.tsx` |
| `app/e2e/tasks.spec.ts` — unreachable keeps last data, never the empty state | flip `setData((last) => (result.status === 0 ? last : result.ok ? result.body : last));` → `setData(result.ok ? result.body : undefined);` in `app/src/screens/tasks/TasksScreen.tsx` |
| `app/e2e/tasks.spec.ts` — keyboard J/K move between cards | delete `case "j":` in `app/src/screens/tasks/TasksScreen.tsx` |
| `app/e2e/tasks.spec.ts` — contrast ≥ 4.5:1 in both themes | flip `color: var(--ink);` → `color: var(--ink-tertiary);` on `.tasks-card-title` in `app/src/screens/tasks/tasks.css` (red if `--ink-tertiary` on `--surface` is below 4.5:1; if it is not, the worker names the token pair that is and records it in the spec comment) |
| `app/e2e/tasks.spec.ts` — README lists the 14 screenshots | delete `history-dark.png` in `docs/evidence/phase-7-polish/tasks/README.md` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `GET /tasks` and `GET /tasks/:kind/:id` in the gui `tasks` part | AC1, AC2, AC3, AC12 (kernel) | 2 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | App: the Tasks board, card detail, palette commands, e2e and polish-gate evidence | AC4–AC11, AC12 (app + docs) | 1 modify, 9 create (+14 PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 kernel-tasks | `kernel/src/gui/tasks.ts` (17), `kernel/test/gui-foundation.test.ts` (54) | `kernel/test/gui-tasks.test.ts` | HIGH |
| 2 app-tasks | `app/src/screens/tasks/index.tsx` (17) | `app/src/screens/tasks/TasksScreen.tsx` (the view: board, detail, log, Stop/Kill), `app/src/screens/tasks/model.ts` (the one home of the state→column mapping, tones, today filter, refetch predicate, card labels; pure TS), `app/src/screens/tasks/model.test.ts`, `app/src/screens/tasks/TasksScreen.test.tsx`, `app/src/screens/tasks/tasks.css`, `app/e2e/tasks.spec.ts`, `app/e2e/fixtures/tasks.ts` (the fixture board, history and output rows), `docs/evidence/phase-7-polish/tasks/README.md`, `docs/evidence/phase-7-polish/tasks/*.png` (14: `{empty,loading,populated,waiting,error,unreachable,history}-{light,dark}.png`) | HIGH |

Module layout: no MODIFY path is near the 500-line threshold. Each new responsibility gets one home. The routes go in `kernel/src/gui/tasks.ts`, the part item 01 made for them. The mapping goes in `model.ts`, the view in `TasksScreen.tsx`, and fixtures in `app/e2e/fixtures/tasks.ts`, as `fixtures/sessions.ts` and `fixtures/integrations.ts` do. Session output reading and session status logic are reused from `app/src/screens/sessions/{model,output}.ts`, never copied. Stop/Kill's small `send` wrapper is local to `TasksScreen.tsx` (the Sessions screen's `send` is module-private in a 1019-line file this item does not touch). If `TasksScreen.tsx` grows past 500 lines, the detail pane moves to `TaskDetail.tsx` in the same directory.

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` check 1 scans every `docs/**/*.md` for relative links, so `docs/evidence/phase-7-polish/tasks/README.md` must link only to paths that exist (e.g. `../../../design/mockups/gui-v2.html`).

**Total estimated files:** 3 modify + 10 create (+14 generated PNGs)

### Subtask Contracts

```yaml
# Subtask 1 — kernel tasks routes (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/gui/tasks.ts", name: "tasksRoutes"}
  - {kind: "symbol", path: "kernel/src/gui/tasks.ts", name: "tasksPart"}
  - {kind: "symbol", path: "kernel/src/gui/tasks.ts", name: "/tasks/:kind/:id"}
  - {kind: "file", path: "kernel/test/gui-tasks.test.ts"}
  - {kind: "symbol", path: "kernel/test/gui-foundation.test.ts", name: "gui parts serve routes only"}
requires: []
lanes:
  - "kernel/src/gui/tasks.ts"
  - "kernel/test/gui-foundation.test.ts"
  - "kernel/test/gui-tasks.test.ts"
external_requires: []

# Subtask 2 — app Tasks screen (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "app/src/screens/tasks/index.tsx", name: "screen"}
  - {kind: "symbol", path: "app/src/screens/tasks/TasksScreen.tsx", name: "TasksScreen"}
  - {kind: "symbol", path: "app/src/screens/tasks/model.ts", name: "columnOf"}
  - {kind: "symbol", path: "app/src/screens/tasks/model.ts", name: "BOARD_COLUMNS"}
  - {kind: "file", path: "app/src/screens/tasks/model.test.ts"}
  - {kind: "file", path: "app/src/screens/tasks/TasksScreen.test.tsx"}
  - {kind: "file", path: "app/src/screens/tasks/tasks.css"}
  - {kind: "file", path: "app/e2e/tasks.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/tasks.ts"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/tasks/README.md"}
requires: []
lanes:
  - "app/src/screens/tasks/**"
  - "app/e2e/tasks.spec.ts"
  - "app/e2e/fixtures/tasks.ts"
  - "docs/evidence/phase-7-polish/tasks/**"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```

No build-time dependency between the two. The app codes against `app/src/api/contract.ts`, which this item does not change. The e2e runs against the fixture kernel (`app/e2e/fixture-kernel.ts` plus per-spec routes from `app/e2e/fixtures/tasks.ts`), never against the real kernel. The kernel never imports the app. The shared interface is the contract's existing shapes and the route rules in this brief: error codes `invalid_query`, `invalid_kind`, `invalid_id`, `not_found`; grouping by verbatim state; owned sessions excluded. Subtask 2's fixtures must answer in exactly that form.

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 22 minutes ago, fetched <1h |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Three state vocabularies, one of them free text: a mapping split across files, or a guessed column, shows a dishonest status — Feasibility (Phase 2.5) and requirement Risks | HIGH | One table in `model.ts` (above), pinned row by row in `model.test.ts`. Green only for `done`/`done`/`completed`. An unknown task state shows verbatim, neutral, in Working, never green and never hidden. The mockup records "whether the kernel closes the set" as an owner open point; this item does not close it |
| Scope vs Supervisor capability: ~13 source files plus 14 screenshots — Feasibility (Phase 2.5) | MEDIUM | Split kernel / app on `genuine-parallelism` with zero overlap. The app subtask reuses the Sessions screen's model, output reader and StreamingLog instead of rebuilding them |
| Sibling lanes (items 04–08) also fill a gui part and also break the `holds every part empty` pin in `kernel/test/gui-foundation.test.ts` | MEDIUM | Subtask 1 rewrites the pin generically ("gui parts serve routes only"; contribution keys `["name"]` or `["name", "routes"]`), so a later sibling needs no edit. A sibling that lands first with its own rewrite is a merge conflict on the same few lines: keep the generic form |
| `PlaybookRun`'s row view is written here and again by item 04 (`playbook-history.ts`) in a parallel lane | LOW | Two small views in different parts. Do not create a shared module now, since it would be a cross-lane file. A follow-up can extract it once both have landed |
| The mockup's history view shows no Stop/Kill and says "Tasks has no command of its own", while the requirement says Stop and Kill reuse phase 5's session actions | LOW | Follow the requirement. Stop and Kill appear only on an open card with a live session, in the log bar, with `tasks.stop` and `tasks.kill` in the palette. The evidence README notes the addition against the `tasks-history` state, for the owner's approval of the PR (D9) |
| Screenshots are macOS-only and pixel-unstable; CI is Ubuntu | MEDIUM | As `sessions.spec.ts` does: write to `docs/evidence/…` only with `TASKS_EVIDENCE=1`, otherwise to Playwright's output dir. The spec asserts behaviour, never pixels. Dark mode is checked by a differing `--ground` |
| Layout-shift assertion is flaky if the board re-renders wholesale on refetch | MEDIUM | Key cards by `kind:id` (never index), keep column order fixed, and compare bounding boxes of an unaffected card and of the column headers before and after the event |
| Prior churn on touched paths: `app/e2e/fixture-kernel.ts` (3), `app/src/screens/tasks/index.tsx`, `kernel/src/gui/tasks.ts`, `kernel/test/gui-foundation.test.ts` (1 each) — Prior churn (postmortem ledger) | MEDIUM | The recurring class is `self_heal_churn`. Mirror each file's idiom exactly (Touched-file invariants), leave `fixture-kernel.ts` untouched (per-spec routes only), and run every validation command before hand-back |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** genuine-parallelism

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-the-tasks-screen.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T14:53:27Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/180
- **Branch:** feature/the-tasks-screen
- **Files changed:** 29
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Kernel `GET /tasks` and `GET /tasks/:kind/:id` in the gui tasks part, plus the Tasks board (four columns, card detail with history and a streaming log, Stop/Kill, palette commands, last-known when unreachable), e2e, and 14 light/dark evidence screenshots. Heal iteration 1 fixed the e2e fixture, which had clamped `limit` above 200 where the kernel answers 400; iteration 2 passed. CI's red on fabe532 was a pre-existing ~1%-per-run key-dependent flake in kernel/test/integrations-github-app-token.test.ts:250 (follow-up); CI is green on 13a001e. The run resumed past a spurious Execute Manager checkpoint (it had no TaskOutput to poll its workers); the Supervisor ran the outputs_verified, children-settled and lane gates itself before merging.

## Not verified
- **⌘6 and ⌘K in a launched Electron window** — the shell mounts neither the palette nor the keyboard map in e2e; covered by unit tests only (subtask 2)
- **The screen against the real kernel's GET /tasks** — the e2e uses the fixture kernel that follows the brief's route rules (subtask 2)
- **The screenshots on Linux CI** — generated on macOS only; CI runs the spec without TASKS_EVIDENCE (subtask 2)
