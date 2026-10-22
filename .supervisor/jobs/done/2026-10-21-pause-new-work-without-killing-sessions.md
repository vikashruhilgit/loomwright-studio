# Supervisor Job: Pause all — a durable pause that stops new work while running sessions finish their turn

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-21-052020/L4
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140005-pause-new-work-without-killing-running-sessions.md
- **Base commit:** 2b31dd8218e2008e2ad7375d9ad7c16e06c35dd4

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest + better-sqlite3 in `kernel/`; no new dependency. |
| 2 | Dependency Availability | GO | Everything needed exists: the kill switch's event-log pattern (`kernel/src/api/kill-switch.ts`), the loop's park rule (`#park` in `kernel/src/loop/loop.ts`), the console part seam (`kernel/src/console/types.ts`), and the app contract's `PauseResponse` / `StatusBody.paused` (item 01, merged). |
| 3 | Architecture Fit | GO | A generic kernel mechanism (invariant 1) and owner-only control over the safety kernel (invariant 3): durable state in the append-only `events` log, refused at the existing admission seam. |
| 4 | Scope vs Supervisor Capability | GO | 9 files modified + 1 created, well under the context-bound threshold (12 files / 800 lines); single agent. |
| 5 | Hard Blockers | CAUTION | Three files outside the requirement's Touches must change: `kernel/src/sessions/types.ts` (the closed `AdmissionRefusalReason` union), `kernel/test/console-foundation.test.ts` (pins `pausePart` empty) and two docs (`docs/architecture/triggers.md`, `docs/ARCHITECTURE.md`). No same-wave item owns any of them (wave peers 06 and 07 touch `console/threads.ts`, `agents/roster.ts` and their own tests/docs), so the requirement's stop rule does not fire; but item 06 edits the same pinned lines (see Risk Assessment). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Add an owner-only, durable "pause new work" mechanism to the kernel: while paused no trigger fires and no session starts or resumes, running sessions are untouched, and `POST /unpause` or `POST /resume` releases it.

**Problem Statement:**
The owner needs one Pause that quiets the kernel without the kill switch's hard stop, because the approved menu bar's "Pause all" means "pause new work" (owner decision 2026-10-20, D2/D5/D11).
Currently, the kernel's only brake is the kill switch (`kernel/src/api/kill-switch.ts`), which stops the loop and every live session. This forces the owner to kill in-flight work just to stop new work from starting.
Success looks like: `POST /pause` makes every trigger instant record `missed_paused`, every session start or resume refuse `paused` (and its event parked once, no second notify), running sessions end normally, the state survives a restart, `GET /status` shows `paused`, and `POST /unpause` or `POST /resume` releases it so parked work runs at once.

**Design (owner decisions are binding; the rest is this brief's plan):**
- **State** (`kernel/src/console/pause.ts`): `PAUSE_ENGAGED = "pause_engaged"` and `PAUSE_RELEASED = "pause_released"` events, payload `{by: "owner", via}`. `pauseState(store): {paused, since}` and `isPaused(store)` read the latest of the two, exactly as `killSwitchState` / `isKillSwitchEngaged` do; never held in memory, so no restart releases it. `engagePause(store, at, via)` appends `pause_engaged` (every call audited, like the kill switch). `releasePause(store, at, via)` is called only while paused and, in ONE transaction, appends `pause_released` and wakes every queue row parked for the pause: `UPDATE event_queue SET not_before = ? …` (now) for `status = 'pending'` rows whose latest `event_parked` has `reason = "paused"`. Without the wake a paused refusal (`retryAt: null`) waits `DEFAULT_PARK_MS` (1 h) after the release.
- **`via`:** `"cli"` when the request body's `via` is `"cli"`, else `"api"` (contributed routes get no headers, and the app contract declares no body for `POST /pause` / `POST /unpause`, so the app's pauses record `api` until a later item changes the contract; this lane never changes `app/src/api/contract.ts`). `POST /resume` releasing a pause records `via` from `CLIENT_HEADER` the same way the abandon route does (`cli` / `api`): `resume` gains a `via` argument, and the built-in routes table's `run` widens to `run: (req: IncomingMessage) => Promise<unknown>` (called as `route.run(req)`), with `/resume` computing `via` from `req.headers[CLIENT_HEADER]` and the other built-in routes ignoring the argument (today only the abandon branch reads the header and `resume` takes no argument): a planned edit to `kernel/src/api/server.ts`.
- **Routes and CLI** (the `pausePart`, CLI-loadable): `POST /pause` → `200 {paused: true}`; `POST /unpause` → releases only when paused (a no-op unpause appends nothing) → `200 {paused: false}`. Both run their change through the request's `serialized` (503 `{error: "serialized_unavailable"}` when absent), so they never interleave with stop-all, resume, abandon, stop or kill. `studio pause` and `studio unpause` are the part's `subcommands`, each one `client.request("POST", …, {via: "cli"})`, printing the state and exiting 0 on 200, else the error and 1.
- **Admission** (`kernel/src/kernel.ts`): `admissionFor` gains an optional third parameter `paused?: () => boolean` (existing two-argument callers keep compiling). When it returns true the check answers `{admitted: false, reason: "paused", retryAt: null}` before the budget is asked, so no `admission_refused` event or `notify` is written by the budget; the loop parks the event under its existing rule (one `event_parked`, no notify). `startKernel` wires `admissionFor(budget, authProvider.id, () => isPaused(store))`. The loop keeps running while paused (unlike the kill switch); `if (!isKillSwitchEngaged(store)) eventLoop.start();` is unchanged. `AdmissionRefusalReason` gains `"paused"`.
- **Triggers** (`kernel/src/triggers/store.ts`): pause windows are read like kill-switch windows (first `pause_engaged` after a release to the next `pause_released`, open while paused). Each due instant is counted kill-switch first, then pause, else fireable, with `missedPaused++` on its own line. All instants missed: `last_result = 'missed_kill_switch'` when any fell in a kill-switch window, else `'missed_paused'`, and one `trigger_missed` (`reason: "kill_switch"` or `"paused"`, carrying `missed_paused` when non-zero); some fireable: it fires once and `trigger_fired` also carries `missed_paused` when non-zero. While paused, due triggers ARE processed (the loop runs), so an instant inside the open window is recorded at once, never fired later. `TRIGGER_RESULTS` gains `"missed_paused"`. The playbook-not-enabled check stays first, as it is today.
- **Status and resume** (`kernel/src/api/server.ts`): `readStatus` adds `paused: isPaused(store)`. `POST /resume` releases the kill switch when engaged (as today) AND releases the pause when paused (the owner chose that resume clears it); it still answers `{engaged: false}`.
- **Running sessions:** nothing in the pause path calls `stopSession`, `stopAll` or `loop.stop()`. A session whose stream is live finishes its turn. A resume *retry* (the session manager re-asking admission before attempt 2+ of an auto-resume, `#parkIfRefused` in `kernel/src/sessions/manager.ts`) is a new launch, so a pause refuses it with reason `paused`: the session goes back to `interrupted` (`admission_refused`) and stays resumable. This is intended.
- **Long pauses:** a paused refusal has `retryAt: null`, so a parked row is redelivered every `DEFAULT_PARK_MS` (1 h) while the pause lasts and re-parked with another `event_parked` (never a notify); `pause.md` documents this.

## Acceptance Criteria
- [ ] AC1: Given `POST /pause`, when a `once` and a `cron` trigger come due while paused, then each is recorded `last_result = missed_paused` with one `trigger_missed` (`reason: "paused"`) and no notification or message is queued; after `POST /unpause`, the cron trigger's next instant fires (`trigger_fired`, `last_result = fired`).
- [ ] AC2: Given a pause, when a queued `message` (`POST /ask`) would start a session, then `POST /ask` still answers and queues it, admission refuses with reason `paused`, exactly one `event_parked` (`reason: "paused"`) is recorded for a pause shorter than `DEFAULT_PARK_MS` and no `notify` and no `admission_refused` event is written; after `POST /unpause`, the parked row's `not_before` is no later than the release and the message starts its session on the next tick. A queued brain message whose agent has an `interrupted` session (the brain handler's `resumeSession` path) is refused `paused` the same way.
- [ ] AC3: Given a running session, when the owner calls `POST /pause`, then the session is not stopped (no `session_stop_requested`, no `stopSession`/`stopAll` call) and it ends with its own outcome (`completed`). Given an auto-resume retry asking admission while paused, then it is refused `paused` and the session is left `interrupted` (resumable), not `failed`.
- [ ] AC4: Given a pause, when the kernel restarts (a new `startKernel` over the same data dir), then `GET /status` still shows `paused: true` and a due trigger is still recorded `missed_paused`. Given `POST /resume` while both the kill switch and the pause are engaged, then both are released (`kill_switch_released` and `pause_released` appended, `GET /status` shows `kill_switch.engaged: false` and `paused: false`), and `POST /resume` with only a pause releases it too.
- [ ] AC5: `GET /status` shows `paused` (false before any pause, true while paused); `POST /pause` / `POST /unpause` answer `PauseResponse` (`{paused}`) and record `{by: "owner", via}`; `studio pause` / `studio unpause` call them; `docs/architecture/pause.md` documents the events, routes, CLI, triggers, admission and resume behaviour; `docs/architecture/triggers.md` lists `missed_paused` and `reason: paused`; `bash scripts/check-docs.sh` passes.
- [ ] AC6: `cd kernel && npm ci && npm run typecheck && npm test` passes, including the updated `console-foundation.test.ts` pin (pause part filled: two routes and two subcommands, no tools, handlers or due work), the unchanged `feature-seams.test.ts` module-graph pin and the unchanged kill-switch tests in `triggers.test.ts`.

## Touched-file invariants

> Grounded at base `2b31dd8218e2008e2ad7375d9ad7c16e06c35dd4`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/console/pause.ts`** — keep: the part stays exported under its name, replacing `export const pausePart: ConsolePart = emptyConsolePart("pause");` with a filled part built from `emptyConsolePart("pause")`; reuse: control's CLI-loadable idiom — value imports only `./types.js` and the store helper `../loop/internal.js` (control.ts: `value imports are \`./types.js\` and the store helper \`../loop/internal.js\``), plus `appendEvent` for the events; mirror: the kill switch's derived-state reader (`kernel/src/api/kill-switch.ts`: `SELECT id, at, kind FROM events WHERE kind IN (?, ?) ORDER BY id DESC LIMIT 1`); fired by: `CONSOLE_PARTS` in `kernel/src/console/index.ts` (`Object.freeze([eventsPart, outputPart, controlPart, pausePart, threadsPart])`); pinned by: `kernel/test/feature-seams.test.ts` (`SDK_IN_GRAPH`) — never import the session manager, the Agent SDK or `kernel.ts` as a value.
- **`kernel/src/triggers/store.ts`** — keep: one audit event per change in the change's own transaction (`appends exactly one audit event of its own \`trigger_*\` kind in`), the per-instant work step (`runStep(store, fireStepKey(row.id, scheduledAt)`), the kill switch's early return `if (isKillSwitchEngaged(store)) return [];` and its `missed_kill_switch` results, and `this module never imports the playbooks` (pause.ts must not import triggers either); reuse: the window idiom `function killSwitchWindows(store: Store): KillSwitchWindow[]` / `inKillSwitchWindow` for pause windows; mirror: `TRIGGER_RESULTS` is re-exported by `kernel/src/triggers/index.ts`; pinned by: `kernel/test/triggers.test.ts` (`last_result: "missed_kill_switch"`), which must stay green unchanged.
- **`kernel/src/kernel.ts`** — keep: `admissionFor`'s fail-closed provider check (`refusing (fail closed)`), the loop start gate `if (!isKillSwitchEngaged(store)) eventLoop.start();` (pause never stops the loop); mirror: the admission seam's type `AdmissionDecision` in `kernel/src/sessions/types.ts`; pinned by: `kernel/test/sessions-playbook-admission.test.ts` (`admissionFor({ checkPlaybook: () => ({ admitted: true, provider: PROVIDER.id }) }, PROVIDER.id)`) — the new parameter must be optional.
- **`kernel/src/api/server.ts`** — keep: every state change on the one POST queue (`serialized(async () => {`), resume's kill-switch branch `if (killSwitchState(store).engaged) {` with `loop.start()`, and resume's answer `{ engaged: false }`; contributed routes stay read-only on the kill switch (`Read-only: a route may read the switch, never engage or release it.`); reuse: the abandon route's `via` idiom `req.headers[CLIENT_HEADER] === "cli" ? "cli" : "api"`; mirror: the app contract `app/src/api/contract.ts` (`readonly paused?: boolean;`, `export interface ResumeResponse {`); pinned by: `kernel/test/api.test.ts` (`kill_switch).toEqual({ engaged: false, since: null })`).
- **`kernel/src/sessions/types.ts`** — keep: the closed union `export type AdmissionRefusalReason =` documented reason by reason; extend it with `"paused"` and its doc line only.
- **`kernel/test/console-foundation.test.ts`** — keep: every other part's own pin (events, output, control) unchanged; update every expectation that lists the console's routes or subcommands to include the pause part's two routes and two subcommands: `expect(consoleContribution.routes).toEqual([...eventsPart.routes, ...outputPart.routes, ...controlPart.routes]);`, `expect(consoleContribution.subcommands).toEqual(outputPart.subcommands);`, the console-owned merged-route list ending at `POST /sessions/:id/kill`, the merged subcommand names `.toEqual(["sessions"])`, the empty-parts loop `for (const part of [pausePart, threadsPart]) {` (pause leaves it; threads stays), and the merged expectation (`routes: [...eventsPart.routes, ...outputPart.routes, ...controlPart.routes],`, `subcommands: outputPart.subcommands,`); add a pause-part pin (exactly `POST /pause`, `POST /unpause`, subcommands `pause`, `unpause`, no tools, handlers or due work); retitle the tests whose names say `the rest are empty`.
- **`docs/architecture/pause.md`, `docs/architecture/triggers.md`, `docs/ARCHITECTURE.md`** — keep: relative links resolvable (`bash scripts/check-docs.sh`); `docs/ARCHITECTURE.md`'s console paragraph's filled-parts sentence is updated as a whole: the parts count (`Today three parts are filled`), the pause part added to the list of filled parts (linking [pause](architecture/pause.md)), the empty clause (`\`pause.ts\` and \`threads.ts\` are empty`, now only `threads.ts`) and the totals (`those five routes and that subcommand`, now seven routes and three subcommands); nothing else in the file.

## Closed enumerations touched

> Sibling grep at base `2b31dd8218e2008e2ad7375d9ad7c16e06c35dd4`: `grep -rnF 'missed_kill_switch' --exclude=CHANGELOG.md .` → 19 hits in 4 files; `grep -rnF 'agent_sessions_at_once' --exclude=CHANGELOG.md .` → 51 hits in 7 files; `grep -rnF 'playbook_not_enabled' --exclude=CHANGELOG.md .` → 20 hits in 10 files (each run with `--exclude-dir` `node_modules`, `.supervisor`, `dist`).

- **`missed_paused`** (sibling: `missed_kill_switch`) — must be named in:
  - `kernel/src/triggers/store.ts` — `export const TRIGGER_RESULTS = ["fired", "missed_kill_switch"] as const;` — extend.
  - `docs/architecture/triggers.md` — `` - `last_result`: `fired`, `missed_kill_switch` `` — extend.
  - `kernel/test/triggers.test.ts` — assertions on kill-switch behaviour — no change: test expectations, not a closed list.
  - `docs/ARCHITECTURE.md` — prose on the kill switch — no change: not a list of results.
- **`paused`** as an `AdmissionRefusalReason` (sibling: `agent_sessions_at_once`) — must be named in:
  - `kernel/src/sessions/types.ts` — `export type AdmissionRefusalReason =` — extend.
  - `kernel/src/budget/playbook.ts` / `kernel/src/budget/internal.ts` — the budget's own refusal unions — no change: the budget never returns `paused` (the check runs before it).
  - `docs/architecture/budget.md` — the budget's `admission_refused` reasons — no change: a pause writes no `admission_refused` event.
  - `kernel/test/budget-agent-limits.test.ts`, `kernel/test/phase-4-exit.test.ts` — expectations — no change.
- **`paused`** as a `trigger_missed` reason (sibling: `playbook_not_enabled`) — must be named in:
  - `docs/architecture/triggers.md` — the `` `trigger_missed`: `trigger_id`, `reason`, … `` field line — extend (`reason: paused` with `latest_due_at` and `missed_paused`), and the "Missed fires" list gains a **Pause** bullet.
  - `kernel/src/triggers/store.ts` — inline reason literals, not a closed list — no change beyond the new branch.
  - `docs/architecture/playbooks.md`, `docs/architecture/playbook-runs.md`, `docs/evidence/*` and the playbooks tests — playbook-specific prose and expectations — no change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-pause.test.ts` — AC1 trigger recorded `missed_paused` while paused | delete `missedPaused++` in `kernel/src/triggers/store.ts` |
| `kernel/test/console-pause.test.ts` — AC2 admission refuses `paused` and parks once | delete `reason: "paused"` in `kernel/src/kernel.ts` |
| `kernel/test/console-pause.test.ts` — AC2 parked message runs right after unpause | delete `UPDATE event_queue SET not_before` in `kernel/src/console/pause.ts` |
| `kernel/test/console-pause.test.ts` — AC3 running session not stopped | add `await req.sessions?.stopAll();` inside the `POST /pause` handler in `kernel/src/console/pause.ts` (reviewer-applied) |
| `kernel/test/console-pause.test.ts` — AC4 resume releases the pause | delete `releasePause(store` in `kernel/src/api/server.ts` |
| `kernel/test/console-pause.test.ts` — AC4 still paused after restart | make `pauseState` return `{ paused: false, since: null }` unconditionally in `kernel/src/console/pause.ts` (reviewer-applied) |
| `kernel/test/console-pause.test.ts` — AC5 `GET /status` shows `paused` | delete `paused: isPaused(store)` in `kernel/src/api/server.ts` |
| `kernel/test/console-foundation.test.ts` — pause part has two routes | delete `path: "/unpause"` in `kernel/src/console/pause.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Durable pause: state, routes, CLI, admission, triggers, status/resume, docs | all | 9 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/console/pause.ts"}
  - {kind: "symbol", path: "kernel/src/console/pause.ts", name: "isPaused"}
  - {kind: "symbol", path: "kernel/src/console/pause.ts", name: "pauseState"}
  - {kind: "symbol", path: "kernel/src/console/pause.ts", name: "engagePause"}
  - {kind: "symbol", path: "kernel/src/console/pause.ts", name: "releasePause"}
  - {kind: "symbol", path: "kernel/src/console/pause.ts", name: "PAUSE_ENGAGED"}
  - {kind: "symbol", path: "kernel/src/console/pause.ts", name: "PAUSE_RELEASED"}
  - {kind: "symbol", path: "kernel/src/console/pause.ts", name: "pausePart"}
  - {kind: "symbol", path: "kernel/src/triggers/store.ts", name: "missed_paused"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "paused"}
  - {kind: "symbol", path: "kernel/src/api/server.ts", name: "paused"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "isPaused"}
  - {kind: "file", path: "kernel/test/console-pause.test.ts"}
  - {kind: "file", path: "docs/architecture/pause.md"}
requires: []
lanes:
  - "kernel/src/console/pause.ts"
  - "kernel/src/triggers/store.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/test/console-pause.test.ts"
  - "kernel/test/console-foundation.test.ts"
  - "docs/architecture/pause.md"
  - "docs/architecture/triggers.md"
  - "docs/ARCHITECTURE.md"
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
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): files outside the requirement's Touches (`kernel/src/sessions/types.ts`, `kernel/test/console-foundation.test.ts`, `docs/architecture/triggers.md`, `docs/ARCHITECTURE.md`) | MEDIUM | None is owned by a same-wave item (06: `console/threads.ts`; 07: `agents/roster.ts`), so the requirement's stop rule does not fire. Edit only the lines named in Touched-file invariants and list each in the PR body as outside Touches. If any turns out to be owned by a same-wave item, stop and say so (requirement §Scope). |
| Same-wave merge conflict: item 06 (threads) must also edit the same `console-foundation.test.ts` expectations (the console route/subcommand lists, the merged-route list, the empty-parts loop `for (const part of [pausePart, threadsPart]) {` and the merged expectation) and the same filled-parts sentence in `docs/ARCHITECTURE.md` | MEDIUM | Keep the edits minimal and line-local; whichever lane merges second rebases and resolves the two lines (both parts filled). Never force-resolve: escalate a non-trivial conflict. |
| A paused refusal parks with `retryAt: null` (1 h `DEFAULT_PARK_MS`), so parked work would sit an hour after unpause | HIGH | `releasePause` clears `not_before` on `pending` rows whose latest `event_parked` reason is `paused`, in the same transaction as `pause_released`; AC2 asserts it, and its pin mutation deletes the wake. |
| Pause accidentally stops running work (reusing kill-switch code paths that call `loop.stop()` / `stopAll`) | HIGH | The pause path never calls `loop.stop()`, `stopAll` or `stopSession`; AC3 asserts the running session ends `completed` with no `session_stop_requested`. |
| An auto-resume retry (`#parkIfRefused` in `kernel/src/sessions/manager.ts`) is refused by a pause mid-retry | LOW | Intended: a retry is a new launch. The session returns to `interrupted` and stays resumable; AC3's second case asserts it. |
| Pause bypassed by a start path that skips admission | MEDIUM | All starts and resumes (brain, playbooks, delegation, dry run, auto-resume) go through `SessionManager`'s `#admit` / resume admission, which `startKernel` wires through `admissionFor`; AC2 covers start and resume. |
| Trigger precedence between an overlapping kill-switch window and a pause window changes kill-switch results | MEDIUM | Count kill switch first; `triggers.test.ts` kill-switch tests stay green unchanged (AC6). |
| `console/pause.ts` pulls a heavy module into the CLI's graph (it is server- and kernel-imported now) | MEDIUM | Value imports limited to `./types.js` and `../loop/internal.js`; `feature-seams.test.ts` `SDK_IN_GRAPH` pin stays green. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-21-pause-new-work-without-killing-sessions.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-21T16:39:04Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/107
- **Branch:** feature/pause-new-work-without-killing-sessions
- **Files changed:** 15
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Durable owner-only pause (events log): POST /pause|/unpause + studio pause/unpause; admission refuses `paused` before the budget (parks once, no notify); triggers record missed_paused; GET /status shows paused; POST /resume releases it and the release wakes paused-parked rows; running sessions untouched. Phase 4.5: iteration 1 PASS with 3 MEDIUM (CLI resume/status output, stale console header, ARCHITECTURE lists) fixed in 4485e7f; iteration 2 PASS (2 LOW). 1913 tests pass; all 8 pin mutations held (reviewer-applied). 4 LOW findings dismissed below the MEDIUM floor (marker comment posted).

## Not verified
- **studio status human summary** — did not print the pause (cli/index.ts out of lane); addressed after the worker by fix-1 (4485e7f), which adds a `paused:` line (subtask 1)
- **app consumers of PauseResponse and StatusBody.paused** — no app code changed or run; the kernel side is pinned against contract.ts text only (subtask 1)
