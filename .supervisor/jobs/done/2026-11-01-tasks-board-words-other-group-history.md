# Supervisor Job: Tasks — the board words, an honest Other group, and a readable history

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-042119/L4
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090014-tasks-board-words-other-group-and-honest-history.md
- **Base commit:** daed1eab9fafe3f5429ca2d3f6efd13609bc7ada

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest), React + Electron app (vitest, Playwright e2e). No new stack. |
| 2 | Dependency Availability | GO | No new dependency. |
| 3 | Architecture Fit | GO | Mechanism only (invariant 1): the kernel still accepts any state word (D3); the board's grouping stays in the app. The shell parts this item adopts (`KernelBand`, `useKernelReach`, `ScreenDefinition.Subtitle`) merged in PR #192 (item 11, this item's dependency). |
| 4 | Scope vs Supervisor Capability | CAUTION | About 20 files plus 16 generated PNGs: past the 12-file `context-bound` bound, so 3 subtasks. |
| 5 | Hard Blockers | CAUTION | The requirement's assumption is false: `kernel_task_create` never writes `tasks.owner_session_id` (its INSERT omits the column), so the creating session is recorded only as the `task_created` event's `session_id`. The owner chose the design (Launch Pad LP-CLARIFY, 2026-11-01, below), which adds `app/src/api/contract.ts` and `app/e2e/fixtures/tasks.ts` to the item's Touches. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the Tasks board tell the truth: a task in `waiting` shows under "Waiting on you", any other unrecognized task state shows in a visible "Other" group with its raw word, Wright's tools name the four board words, a card names the agent whose session created it, the history reads as sentences with actors, and the screen adopts item 11's shell (band, titlebar count line, honest cap line).

**Problem Statement:**
The owner needs the board to never say "Nothing waits on you" when something does. In the 2026-11-01 live run, Wright created a task with state `waiting on owner`. The board sorts only `waiting`, `working`, `parked` and `done` (`app/src/screens/tasks/model.ts`, "Anything not listed goes to Working"), so the card sat in Working. The tool description says "state is free text you choose; the kernel defines no states", so nothing told Wright which words the board reads. The cards also read "unknown agent", the history showed raw JSON payloads, and the session panel said "No session is attached" although the audit log records `task_created` in session 81. With the kernel stopped, the screen showed its own "Couldn't load tasks" card instead of its last data under the shared band, and its count line sat under the title instead of beside it.
Success looks like a board where every task state lands somewhere visible and honest, with the history readable by a person.

**Owner design decision (Launch Pad LP-CLARIFY, 2026-11-01, binding for this brief):** "New creator fields". `app/src/api/contract.ts` and `app/e2e/fixtures/tasks.ts` join this item's Touches (along with the tasks polish evidence folder `docs/evidence/phase-7-polish/tasks/`, which the polish gate writes). **Second owner answer (LP-CLARIFY round 2, 2026-11-01, after Plan Review attempt 1):** "Add both files": `app/e2e/fixture-kernel.ts` (two `null` fields on its default `GET /tasks/:kind/:id` item, which `satisfies TaskHistoryResponse`) and `app/src/shell/frame.test.tsx` (its pin `no screen declares one yet` lists the screens that declare a `Subtitle`; Tasks is added) also join the Touches. `GET /tasks` (and the `item` of `GET /tasks/:kind/:id`) gives every card two new fields:
- `creator_agent: string | null`: for a task, the `agent` of the session named by the task's FIRST `task_created` event (lowest `events.id` with `kind = 'task_created' AND task_id = t.id`), joined to `sessions`; `null` when that event has no session, the session row is gone, or the card is a playbook run or a session.
- `creator_session: number | null`: for a task, that event's `session_id`; `null` otherwise.
`agent` stays the assignee (the Assignee fact stays true) and `session` stays `owner_session_id`. The creating session is NOT added to the history's `sessions`, its events are NOT pulled into the task's history, the board's session-exclusion rule stays keyed on `owner_session_id` (Wright's chat session stays its own card), and the creator's Stop / Kill are never attached to the task.

## Acceptance Criteria
1. [ ] Given Tasks loaded, when the fixture kernel's listener stops, then the screen keeps its last board under the shell's shared band (`KernelBand`, drawn by the shell; the screen draws its own only when `!useKernelReach(api).shellBand`), with write controls disabled and no raw request text (no `GET /tasks`, no status, no code) visible, matching `tasks-unreachable`; and when the listener restarts it reads the board again.
2. [ ] Given Tasks, then its count line ("N cards · M working", plus " · last known" while offline, via `withLastKnown`) is drawn by the title bar beside the title through `ScreenDefinition.Subtitle` (`data-testid="titlebar-subtitle"`), matching `tasks-populated`, and the screen no longer draws its own `tasks-bar` count band. The titlebar `Subtitle` renders the line inside an element with `data-testid="tasks-subtitle"` (so `app/e2e/phase-7-exit.spec.ts`'s `byId(page, "tasks-subtitle")` checks pass untouched), and `app/src/shell/frame.test.tsx`'s Subtitle pin lists `["tasks"]`.
3. [ ] Given fewer cards on the board than the board's cap (`TASKS_LIMIT`, 200), then no cap line ("Showing the newest 200 cards…") shows, even when `next_before` is non-null; given the board holds the cap and `next_before` is non-null, it does.
4. [ ] Given a task with state `waiting`, then it shows under "Waiting on you" and the attention band counts it.
5. [ ] Given a task with state `waiting on owner` (any task state outside `waiting`, `working`, `parked`, `done`), then it shows in a visible "Other" group with that exact word (escaped by `printable`, neutral badge), not in Working and not hidden, matching the new `tasks-other` view; the group is absent when no card is in it. A playbook run or session status this app does not know also goes to Other, never Working. No synonym is guessed (`waiting on owner` is never mapped to Waiting).
6. [ ] Given `kernel_task_create`'s and `kernel_task_update`'s tool descriptions, then both name the four board words `waiting`, `working`, `parked`, `done` and say any other word shows under Other, and both tools still accept any state string (a kernel test in `kernel/test/kernel-tools.test.ts` pins both descriptions through `kernelToolDefinitions(ctx).find((d) => d.name === "kernel_task_create")?.description` and the same for `kernel_task_update`, as the suite already does at its `kernelToolDefinitions` use, and creates and updates a task with state `waiting on owner` successfully).
7. [ ] Given a task created by Wright's session with no assignee, then `GET /tasks` returns `creator_agent: "wright"` and `creator_session: <that session's id>` for it (a kernel test in `kernel/test/gui-tasks.test.ts`), and its card names Wright (the roster's display name when on the roster), not "unknown agent"; given neither an assignee nor a creator agent, the card says "No agent recorded" (the words the updated mockup uses), never "unknown agent".
8. [ ] Given a task's history, then each entry is a sentence and an actor, matching `tasks-history`: for example `task_created` reads "Created “<title>” · state <state>", `task_updated` reads "Changed <fields> · state <state>"; the actor is the agent of the event's session (from the history's sessions, else the card's `creator_agent` when the session is `creator_session`), "kernel" when the event has no session, else "session #N"; an event kind with no sentence reads "<kind> recorded" with no payload text. No JSON object (no `{`, no `"title":`) is visible in the history.
9. [ ] Given a task whose `creator_session` is recorded, then its detail shows a "Created in" fact linking session #N, which opens that session's own card (its log) on Tasks when the session is on the board, and is plain text otherwise; the task's own session panel keeps its "no session is attached" note when the task has no owned session (its Stop / Kill never act on the creator's session).
10. [ ] Given the polish gate, then a committed evidence file `docs/evidence/phase-7-polish/tasks/README.md` lists the screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state this item changes (at least `tasks-populated`, `tasks-waiting`, `tasks-unreachable`, `tasks-history` and the new `tasks-other`), each named against its `gui-v2.html` view id, the PNGs are committed beside it, and the PR body links to the README.
11. [ ] Given `docs/design/mockups/gui-v2.html`, then it gains a `tasks-other` view (in `VIEWS`, grouped under Tasks) that shows a task in state `waiting on owner` in the "Other" group with its raw word, uses "No agent recorded" for a card with neither assignee nor creator, and its existing token block stays the verbatim output of `node app/scripts/tokens.mjs`.

**Validation (must pass before merge):**
- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`
- `cd kernel && npm ci && npm run typecheck && npm test`

## Phase 3 analysis

**Tech Stack:** TypeScript (strict) kernel on better-sqlite3 + Claude Agent SDK, vitest; Electron + React app, vitest + Playwright e2e.
**Architecture:** the kernel's `gui` feature part `tasks` serves `GET /tasks` and `GET /tasks/:kind/:id` (one UNION of task / run / session SELECTs); the app's `app/src/screens/tasks/` screen is discovered by `import.meta.glob`, and its pure model `model.ts` is the one home of the state → column table.

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel + contract | `kernel/src/tools/server.ts` (634 — the one home of the tool descriptions), `kernel/test/kernel-tools.test.ts` (424), `kernel/src/gui/tasks.ts` (260), `kernel/test/gui-tasks.test.ts` (566 — the one suite for the tasks gui part; append), `app/src/api/contract.ts` (1446 — the single authority for the API contract; two fields appended to `TaskBoardItem`), `app/e2e/fixtures/tasks.ts` (258), `app/e2e/fixture-kernel.ts` (368) | — | HIGH |
| mockup | `docs/design/mockups/gui-v2.html` (1572 — D9's one clickable mockup file; the view is appended to its tasks block) | — | HIGH |
| app screen | `app/src/screens/tasks/model.ts` (395), `app/src/screens/tasks/model.test.ts` (375), `app/src/screens/tasks/TasksScreen.tsx` (337), `app/src/screens/tasks/TasksScreen.test.tsx` (770 — the one screen suite; append), `app/src/screens/tasks/TasksViews.tsx` (276), `app/src/screens/tasks/TaskDetail.tsx` (219), `app/src/screens/tasks/index.tsx` (27), `app/src/screens/tasks/tasks.css` (486), `app/e2e/tasks.spec.ts` (656 — the one Tasks e2e suite; append), `app/src/shell/frame.test.tsx` (315; one pin line), `docs/evidence/phase-7-polish/tasks/README.md` | `app/src/screens/tasks/history.ts` (the history sentences and actors: a separate concern, kept out of `model.ts`), `app/src/screens/tasks/history.test.ts`, `app/src/screens/tasks/subtitle.ts` (the titlebar count-line store the prop-less `Subtitle` component reads), `docs/evidence/phase-7-polish/tasks/other-light.png`, `docs/evidence/phase-7-polish/tasks/other-dark.png` (the other PNGs in that folder are regenerated) | HIGH |

**Module layout:** new responsibilities and their homes: the Other group → `model.ts` (395; the one home of the state → column table, stays under 500); history sentences + actor → CREATE `history.ts`; titlebar count line → CREATE `subtitle.ts` (a tiny `useSyncExternalStore`-style store the screen writes and `screen.Subtitle` reads); creator fields → `kernel/src/gui/tasks.ts` SELECTs; board words → `server.ts` `descriptions`. No helper is copied by 2+ siblings (the band, `withLastKnown`, `useKernelReach` are reused from `app/src/shell/`).

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| kernel + contract | app screen | none, but app reads `TaskBoardItem.creator_agent` / `creator_session` from `app/src/api/contract.ts` and the fixture's `item()` | YES (requires) |
| mockup | app screen | none, but app matches the `tasks-other` view and its words | YES (requires) |
| kernel + contract | mockup | none | NO |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/screens/tasks/model.ts:49` | yes | HOLDS | `const TASK_COLUMNS = table<ColumnId>({ waiting: "wait", working: "work", parked: "park", done: "done" });` | tip 2 hours ago, fetched >1h |
| `kernel/src/tools/server.ts:161` | yes | HOLDS | ``kernel_task_create: `Create a task row. state is free text you choose; the kernel defines no states. ${REPEAT}`,`` | tip 2 hours ago, fetched >1h |
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 2 hours ago, fetched >1h |

**Total estimated files:** 19 modify + 5 create (+ 14 regenerated PNGs)

## Touched-file invariants

> Grounded at base `daed1eab9fafe3f5429ca2d3f6efd13609bc7ada`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/tools/server.ts`** — keep: the state input stays free text, `state: short,` in `kernel_task_create` (no enum, no refine: D3); keep every description's idempotency sentence, `const REPEAT = "Repeating a call with the same idempotency_key`; reuse: the one `descriptions: Record<KernelToolName, string>` table (the SDK tool is built from it: `tool(name, descriptions[name], shapes[name]`); pinned by: `kernel/test/kernel-tools.test.ts` (imports `approvalApplierOf` from `../src/tools/server.js`) — the new pin reads the descriptions through `kernelToolDefinitions(ctx)` (`listKernelTools` returns names and schemas only), never by copying the strings.
- **`kernel/src/gui/tasks.ts`** — keep: mechanism only, `every card carries its source's own state word, verbatim, and the kernel never` (no state mapping in the kernel); keep the ordering `ORDER BY updated DESC, kind, id DESC`; keep `AND kind <> 'session_output_appended'` and the history's event filter `WHERE (task_id = ? OR session_id IN (SELECT value FROM json_each(?)))` over the OWNED sessions only (the creator session must not join `sessionIds`); keep the board's exclusion `s.id NOT IN (SELECT owner_session_id FROM tasks WHERE owner_session_id IS NOT NULL)` keyed on `owner_session_id`; keep the import rule `never the Agent SDK, the session manager or` (`kernel/test/feature-seams.test.ts` pins the module graph); mirror: every SELECT in the UNION answers the same columns in `BoardRow`'s order (`The columns every source SELECT answers, in`), so a card's two new fields are added after `updated` for every kind (`null` for runs and sessions) — whether merged in TypeScript after the page query (the Risk Assessment's one-query rule) or as columns — and the field order must equal the contract's `TaskBoardItem`, in both `GET /tasks` and the history's `item`; pinned by: `kernel/test/gui-tasks.test.ts` `["kind", "id", "title", "state", "agent", "playbook", "item_ref", "session", "tokens", "started", "ended", "updated"]` (extend with the two new keys at the end, in the contract's order) and its `toEqual({` card literals.
- **`app/src/api/contract.ts`** — keep: `export interface TaskBoardItem {` fields readonly, each with a doc comment naming its source column; append `creator_agent` and `creator_session` after `updated`, documented as "the agent / session of the task's first `task_created` event; `null` for a run, a session, or when not recorded"; mirror: `kernel/src/gui/tasks.ts` `BoardRow`.
- **`app/e2e/fixtures/tasks.ts`** — keep: `Every body is typed by the contract.` and the helper `export function item(kind: TaskBoardKind, id: number, state: string` (give the two new fields `null` defaults there, so every existing spec still typechecks); mirror: the kernel's history rule (the fixture's `GET /tasks/:kind/:id` keeps answering the owned sessions only).
- **`app/e2e/fixture-kernel.ts`** — keep: `` `satisfies` its contract response type, so `npm run typecheck` checks it. `` — the default `"GET /tasks/:kind/:id": ({ params }) =>` item gains `creator_agent: null, creator_session: null` after `updated`; nothing else in the file changes (it is a shared hotspot: item 11 and other screen items edit it).
- **`app/src/shell/frame.test.tsx`** — keep: the Titlebar tests above the pin; change only `it("no screen declares one yet (each screen's item moves its own count line)"` to assert the screens that declare a `Subtitle` are exactly `["tasks"]` (renamed accordingly); parallel screen items edit the same line, so rebase and union the list, never drop another screen's id.
- **`app/src/screens/tasks/model.ts`** — keep: `A table with no prototype` (`function table<V>(`) for every lookup, and `printable` on every untrusted string; keep `BOARD_COLUMNS` as the mockup's four `COLS` in order (Other is a separate group, never a fifth fixed column that shows empty); change: the comments `Anything not listed goes to Working` and `it sits in Working with a neutral badge and its own word` must be rewritten to say Other; pinned by: `app/src/screens/tasks/model.test.ts` `["wait", "work", "park", "done"]` and its state → column rows.
- **`app/src/screens/tasks/TasksScreen.tsx`** — keep: `A read the kernel did not answer (or refused) never replaces what is on screen.`; keep `export const TASKS_LIMIT = "200";` as the cap the cap line compares against; keep the stale refusal note `data-testid="tasks-stale"` for a refused read while data is on screen (the band replaces only the connection case); reuse: `useKernelReach` and `withLastKnown` from `../../shell/last-known` and `KernelBand` from `../../shell/KernelStates` (as `IntegrationsView.tsx` does: `offline && !reach.shellBand ? <KernelBand`), never a new band.
- **`app/src/screens/tasks/TasksViews.tsx` / `TaskDetail.tsx`** — keep: `data-testid="screen-tasks"` on the root and every string as a text child only (`rendered as a text child only`); keep the no-log note `No session is attached to this` for a task with no owned session; reuse: `avatarAgent` for the creator's roster name and hue.
- **`app/src/screens/tasks/index.tsx`** — keep: `export const screen: ScreenDefinition = {` with `id: "tasks"`; add `Subtitle` (the shell's `Titlebar` renders `<Subtitle />` with no props); the component renders its text in an element with `data-testid="tasks-subtitle"` (pinned by `app/e2e/phase-7-exit.spec.ts` `byId(page, "tasks-subtitle")`, by `app/e2e/tasks.spec.ts` and by `TasksScreen.test.tsx`).
- **`app/e2e/tasks.spec.ts`** — keep: `The folder holds exactly this run's screenshots` and the README check `the evidence README lists every state's screenshot in both themes, and the folder holds nothing else`; extend `const STATES = ["empty", "loading", "populated", "waiting", "error", "unreachable", "history"] as const;` with `"other"` and `expect(expected).toHaveLength(14);` to 16; the evidence is written only under `TASKS_EVIDENCE=1`.
- **`docs/design/mockups/gui-v2.html`** — keep: the token block `the verbatim stdout of \`node app/scripts/tokens.mjs\`` untouched; add the view in `const VIEWS={` beside `'tasks-history':{scr:'tasks',st:'history'`; reuse `boardHTML` / `cardHTML` and the mockup's `CARDS` data; pinned by: `app/e2e/shell.spec.ts` (`The mockup's views (\`gui-v2.html\`, \`#view=<name>\`)`).

## Closed enumerations touched

> Sibling grep at base `daed1eab9fafe3f5429ca2d3f6efd13609bc7ada`: `grep -rnF '"park"' app/src app/e2e` → 20 hits in 6 files.

- **`"other"`** (the board's Other group id; sibling: `"park"`) — must be named in:
  - `app/src/screens/tasks/model.ts` — `export type ColumnId = "wait" | "work" | "park" | "done";` and the board's group list — extend (Other is a group the board shows only when it has cards).
  - `app/src/screens/tasks/TasksViews.tsx` — `const COLUMN_AVATAR: Readonly<Record<ColumnId, AvatarState>>` — extend (the type forces it).
  - `app/src/screens/tasks/tasks.css` — `.tasks-dot[data-column="park"] {` — extend with an Other dot.
  - `app/src/screens/tasks/model.test.ts` — `["wait", "work", "park", "done"]` — extend for the board's groups when an Other card exists; the four-column order stays pinned.
  - `app/e2e/tasks.spec.ts` — `const column = (page: Page, id: "wait" | "work" | "park" | "done")` and `keysIn` — extend with `"other"`.
  - `app/src/screens/tasks/TasksScreen.test.tsx` — `keysIn("park")` — no change: usage, not a closed list.
  - `app/src/screens/menubar/MenubarHost.tsx` — `"pause-all": ["pause", "park", "stop new work"]` — no change: palette keywords, unrelated.
- **`tasks`** in the screens that declare a titlebar `Subtitle` (sibling: none yet; grep `s.Subtitle !== undefined`) — `app/src/shell/frame.test.tsx` `.toEqual([])` — extend to `["tasks"]`.
- **`"other"`** e2e/evidence state (sibling: `"history"`) — `app/e2e/tasks.spec.ts` `const STATES` — extend; `docs/evidence/phase-7-polish/tasks/README.md` screenshot table — extend with the `tasks-other` row.
- **`creator_agent` / `creator_session`** (sibling field: `"item_ref"`) — `kernel/test/gui-tasks.test.ts` key-order pin and `BoardRow` / the three SELECTs in `kernel/src/gui/tasks.ts`, `TaskBoardItem` in `app/src/api/contract.ts`, `item()` in `app/e2e/fixtures/tasks.ts` — extend; the default history `item:` literal in `app/e2e/fixture-kernel.ts` (beside its `item_ref: null`, checked by `satisfies TaskHistoryResponse`) — extend; every in-folder test helper that builds a `TaskBoardItem` literal in `app/src/screens/tasks/*.test.ts(x)` — extend.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/kernel-tools.test.ts` — the descriptions name `waiting`, `working`, `parked`, `done` and Other | delete the `kernel_task_create:` description line in `kernel/src/tools/server.ts` and replace it with the base text `Create a task row. state is free text you choose; the kernel defines no states.` (must turn red) |
| `kernel/test/gui-tasks.test.ts` — a task created in Wright's session has `creator_agent: "wright"` | flip `kind = 'task_created'` → `kind = 'task_updated'` in `kernel/src/gui/tasks.ts` |
| `kernel/test/gui-tasks.test.ts` — the creator session's events are not in the task's history | add the creator session id to `sessionIds` in `kernel/src/gui/tasks.ts` (must turn red) |
| `app/src/screens/tasks/model.test.ts` — `waiting on owner` goes to Other | flip `?? "other"` → `?? "work"` in `app/src/screens/tasks/model.ts` |
| `app/src/screens/tasks/history.test.ts` — no `{` in any history line | make the fallback sentence return `payloadText(payload)` in `app/src/screens/tasks/history.ts` (must turn red) |
| `app/src/screens/tasks/TasksScreen.test.tsx` — no cap line with fewer cards than the cap | delete the board-total comparison from the cap-line condition in `app/src/screens/tasks/TasksScreen.tsx` (leaving `data.next_before === null`) |
| `app/src/shell/frame.test.tsx` — the screens declaring a Subtitle are `["tasks"]` | delete the `Subtitle` line in `app/src/screens/tasks/index.tsx` |
| `app/e2e/tasks.spec.ts` — `expect(expected).toHaveLength(16);` | delete the `tasks-other` row from `docs/evidence/phase-7-polish/tasks/README.md` (or delete `docs/evidence/phase-7-polish/tasks/other-light.png`): the README / folder check must turn red |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: board words in the task tools, creator fields on cards; contract + fixtures | 6, 7 (kernel half) | 7 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Mockup: the `tasks-other` view and the "No agent recorded" words in `gui-v2.html` | 11 | 1 modify, 0 create | `skills/frontend-ui/SKILL.md` | LAUNCHABLE |
| 3 | App: Other group, creator on cards, readable history, creator link, shell adoption, cap line, e2e + polish evidence | 1, 2, 3, 4, 5, 7 (app half), 8, 9, 10 | 11 modify, 5 create (+ regenerated PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1, #2) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/gui/tasks.ts", name: "creator_agent"}
  - {kind: "symbol", path: "kernel/src/gui/tasks.ts", name: "creator_session"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "creator_agent"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "creator_session"}
  - {kind: "symbol", path: "app/e2e/fixtures/tasks.ts", name: "creator_agent"}
  - {kind: "symbol", path: "kernel/src/tools/server.ts", name: "parked"}
  - {kind: "symbol", path: "kernel/test/kernel-tools.test.ts", name: "waiting on owner"}
  - {kind: "symbol", path: "kernel/test/gui-tasks.test.ts", name: "creator_agent"}
requires: []
lanes:
  - "kernel/src/tools/server.ts"
  - "kernel/test/kernel-tools.test.ts"
  - "kernel/src/gui/tasks.ts"
  - "kernel/test/gui-tasks.test.ts"
  - "app/src/api/contract.ts"
  - "app/e2e/fixtures/tasks.ts"
  - "app/e2e/fixture-kernel.ts"
external_requires: []

# Subtask 2
provides:
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "tasks-other"}
  - {kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "No agent recorded"}
requires: []
lanes:
  - "docs/design/mockups/gui-v2.html"
external_requires: []

# Subtask 3
provides:
  - {kind: "file", path: "app/src/screens/tasks/history.ts"}
  - {kind: "file", path: "app/src/screens/tasks/history.test.ts"}
  - {kind: "file", path: "app/src/screens/tasks/subtitle.ts"}
  - {kind: "symbol", path: "app/src/screens/tasks/model.ts", name: "other"}
  - {kind: "symbol", path: "app/src/screens/tasks/index.tsx", name: "Subtitle"}
  - {kind: "symbol", path: "app/src/screens/tasks/TaskDetail.tsx", name: "Created in"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/tasks/other-light.png"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/tasks/other-dark.png"}
  - {kind: "symbol", path: "docs/evidence/phase-7-polish/tasks/README.md", name: "tasks-other"}
  - {kind: "symbol", path: "app/e2e/tasks.spec.ts", name: "other"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/api/contract.ts", name: "creator_agent"}
  - {from: "1", kind: "symbol", path: "app/src/api/contract.ts", name: "creator_session"}
  - {from: "1", kind: "symbol", path: "app/e2e/fixtures/tasks.ts", name: "creator_agent"}
  - {from: "2", kind: "symbol", path: "docs/design/mockups/gui-v2.html", name: "tasks-other"}
lanes:
  - "app/src/screens/tasks/**"
  - "app/e2e/tasks.spec.ts"
  - "app/src/shell/frame.test.tsx"
  - "docs/evidence/phase-7-polish/tasks/**"
external_requires:
  - "Electron + Playwright e2e on this Mac (npm run build, then npm run e2e; TASKS_EVIDENCE=1 for the committed screenshots)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 3
Subtask 2 ──→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |
| Subtask 1 | Subtask 3 | none (3 reads 1's contract and fixture) | YES (requires) |
| Subtask 2 | Subtask 3 | none (3 matches 2's view) | YES (requires) |

**Intermediate validation (between batches):** Subtask 1 makes the contract fields required, so the in-folder test helpers `item()` (`app/src/screens/tasks/model.test.ts`) and `card()` (`TasksScreen.test.tsx`), which are Subtask 3's lanes, do not typecheck until Subtask 3 runs. Subtask 1 hands back green on `cd kernel && npm run typecheck && npm test` and `cd app && npx tsc -p tsconfig.node.json` (the e2e half, which its lanes cover); the full app validation (`tsc -p tsconfig.json`, `npm test`, `npm run e2e`) is checked after Subtask 3. Subtask 3 adds the two `null` fields to those helpers first.

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel — both have empty `requires`, no shared file)
- **Batch 2:** Subtask 3 (after Subtasks 1 and 2)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): scope past the context bound (about 20 files + PNGs) | MEDIUM | Three subtasks along the kernel / mockup / app seam; each worker owns only its lanes. |
| Feasibility (Phase 2.5): the requirement's `owner_session_id` assumption is false; the owner chose new `creator_agent` / `creator_session` fields, adding `app/src/api/contract.ts` and `app/e2e/fixtures/tasks.ts` to Touches | MEDIUM | Follow the owner decision in `## Task` exactly; never write `owner_session_id` from `kernel_task_create`; never pull the creator session's events into the history. |
| A task's first `task_created` event may be gone (an event table wiped or pruned) or have no session (a CLI-created task) | LOW | `creator_agent` / `creator_session` are `null`; the card says "No agent recorded" and the detail shows no "Created in" fact. A kernel test covers a task with no `task_created` event. |
| Changing the tool descriptions changes what Wright writes from now on; rows created before keep their words and land in Other (the requirement's own risk) | LOW | This is the honest outcome; the Other group shows the raw word. |
| The store has no index on `events.task_id` (the migrations' only `CREATE INDEX` lines are on wakeups, event_queue, session_groups, playbook_runs, triggers, notifications, approvals), and `GET /tasks` refetches on most feed events | MEDIUM | Resolve the creators in ONE query per request, for the page's task ids only, after the page is chosen (`kind = 'task_created' AND task_id IN (SELECT value FROM json_each(?))`, lowest id per task), merged into the rows in TypeScript — never a correlated subquery per row. An index migration is outside this item's Touches: if the worker finds the read too slow, it stops and says so (owner decision 2026-11-01). |
| Parallel screen items edit the same `app/src/shell/frame.test.tsx` Subtitle pin line and `app/e2e/fixture-kernel.ts` | MEDIUM | Rebase on `main` before the PR; union the pin's screen list, never drop another screen's id; keep the fixture-kernel edit to the two fields. |
| The phase-7 exit coverage walk (`app/e2e/phase-7-exit.spec.ts`) reads its views from `docs/evidence/gui-v2-mockup/README.md`, not from the HTML, so `tasks-other` is outside that walk | LOW | Out of this item's Touches; note it in the PR body as a follow-up for the exit re-run item (19). |
| Parallel lanes (items 12, 13, 15–18) also edit `docs/design/mockups/gui-v2.html` | MEDIUM | Keep the edit local to the `VIEWS` table's tasks rows and the tasks block (`tasksScreen` / `CARDS`); rebase on `main` before the PR and re-run the mockup's view checks (`app/e2e/shell.spec.ts`). |
| The cap line rule (AC3) hides the line when the board shows fewer cards than the cap even if older non-terminal rows exist beyond the page | LOW | Follows the requirement's AC verbatim; note it in the PR body. |
| Stop / Kill acting on the wrong session if the creator session is wired into the log panel | HIGH | The creator is a link to that session's own card only; `logSessionOf` keeps reading `item.session` and the history's owned sessions; a test asserts the task detail's panel stays the no-log note when the task has no owned session. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-tasks-board-words-other-group-history.md
```

## Plan Review: PASS (attempt 3/3)
- Attempt 1 FAIL (2 HIGH lane gaps: app/e2e/fixture-kernel.ts, app/src/shell/frame.test.tsx — fixed after the owner extended Touches); attempt 2 PASS with 1 MEDIUM + 1 LOW (fixed); attempt 3 PASS, 0 issues. Owner chose Save and exit (LP-SAVE).

## Outcome
- **Status:** completed
- **Completed:** 2026-11-01T10:36:59Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/198
- **Branch:** feature/tasks-board-words-other-group-history
- **Files changed:** 38
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Resumed (--continue) after the prior execute-manager checkpoint: gated and merged subtasks 1 (kernel board words + creator fields) and 2 (tasks-other mockup view), ran subtask 3 (app Other group, creator on cards, readable history, Created-in link, shell band + title-bar count line, cap line, e2e + 16 evidence PNGs). Phase 4.5: 3 reviews, 2 test-only fixes (subtitle loading/error states; Created-in offline guard), 2 LOWs dismissed (PR comment).

## Not verified
- **app/e2e/shell.spec.ts** — app/node_modules absent in the subtask 2 worktree (subtask 2); the full e2e later passed in subtask 3
- **phase-5-polish and phase-6-polish evidence PNGs** — a full npm run e2e rewrites them regardless of TASKS_EVIDENCE; reverted, not regenerated (subtask 3)
- **screenshot pixels** — evidence PNGs are not pixel-compared; checked by eye for other-light and history-light/dark (subtask 3)
