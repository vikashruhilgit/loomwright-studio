# Supervisor Job: Event loop, wake-ups, idempotent work steps, and kernel tools

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariants 1, 2, 3 and 8 apply directly)
- **Git:** dirty only with the automate engine's own trail files (`.supervisor/automate/*`, `.supervisor/postmortem/results.jsonl`, `.supervisor/requirements/phase-1/06-budget-meter-and-cap.md`, `.supervisor/jobs/done/2026-10-02-06-budget-meter-and-cap.md`, `.supervisor/requirements/proposed/*`, `.supervisor/requirements/phase1-06-budget-meter-and-cap-plan.md`) — never stage them in this job; commit with explicit paths only. Branch: main @ 050196b
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0
- **Blockers:** 0 | **Warnings:** 1 (dirty trail files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1/07-event-loop-and-kernel-tools.md
- **Base commit:** 050196b1c54fc40182305851ba10c0c0287e819b

## Feasibility
- **Verdict:** CAUTION
- Tech stack — GO: TypeScript kernel, `better-sqlite3` (synchronous transactions, D30), `@anthropic-ai/claude-agent-sdk` 0.3.284 pinned; `createSdkMcpServer` and `tool` are runtime exports of `sdk.mjs` and declared in `sdk.d.ts` (:608, :9607). `zod` ^4.6.5 is already a dependency (installed 4.6.5; `tool()` accepts a zod v3 or v4 raw shape).
- Dependencies — GO: no new package.
- Architecture fit — GO with two schema facts that shape the design: `events` is append-only (triggers `events_no_update` / `events_no_delete` / `events_no_replace`, 001_initial.ts:64–78), so an event cannot be "marked done" in `events`; and `work_steps.status` has `CHECK (status IN ('started','done','failed'))`, so the literal `failed:interrupted` cannot be stored as a status. Both are solved additively in migration 7 (below). `tasks`, `wakeups`, `work_steps` exist (migration 1). In-process MCP with streaming input is verified (OPEN_QUESTIONS Q5, probe p5); the session manager already uses a streaming `InputChannel`.
- Scope — GO: one worker; 8 modified + 13 created files.
- Hard blockers — CAUTION: not probed live — whether the PreToolUse hook fires for `mcp__` tools, and calling `stopSession` from inside a tool handler of the same session (it would wait on its own exit). The design avoids depending on either (see risks).

## Task
**Goal:** Give the kernel a durable event queue processed in order, scheduled wake-ups fired exactly once by id (including ones missed while the kernel was down), a `runStep(key, fn)` idempotency mechanism over `work_steps`, and an in-process SDK MCP server named `kernel` exposing `kernel_task_create`, `kernel_task_update`, `kernel_task_list`, `kernel_task_get`, `kernel_schedule_wakeup(at, reason)` and `kernel_request_stop(handoff)` — D2, D3, D4, invariants 1, 2 and 8. Mechanism only: no playbook, trigger type, dedupe policy, priority rule or task-state vocabulary is built in.

## Acceptance Criteria
- [ ] AC1 — Given an event (user message, wake-up due), when it is enqueued, then it is written to SQLite first (an `event_queue` row plus an `event_enqueued` audit row in `events`, one transaction). The loop processes pending queue rows in id order and marks each `done` only after its handler's effects are committed. After a restart (close the `Store`, open a new one on the same data dir), unfinished (`pending`) rows are processed again. "Internal" events are the kernel's own audit rows in `events` (e.g. `notify`); they are logged, not queued.
- [ ] AC2 — Given a work step with key `k`, when `runStep(k, fn)` runs, then: if `work_steps[k]` is `done` it returns the stored result without calling `fn`; if it is `started` (left by a crash) `fn` runs again only if the step is declared re-runnable, otherwise the row is marked `failed` with `failure_reason = 'interrupted'` (reported as `failed:interrupted`) and one `notify` event is emitted; otherwise it records `started`, runs `fn`, and records `done` with the result — in one transaction with the step's own writes when `fn` is synchronous and local.
- [ ] AC3 — Given the in-process MCP server `kernel`, when a session starts, then it exposes `kernel_task_create`, `kernel_task_update`, `kernel_task_list`, `kernel_task_get`, `kernel_schedule_wakeup(at, reason)` and `kernel_request_stop(handoff)`. Each tool that creates something takes a caller-supplied `idempotency_key` and goes through `runStep`; repeating a call with the same key returns the first result.
- [ ] AC4 — Given `kernel_request_stop`, when a session calls it, then the kernel writes the handoff text to `<dataDir>/memory/<agent>/handoffs/<task>.md` (markdown, invariant 8), ends the session through the session manager, and records a `stop_requested` event.
- [ ] AC5 — Given a wake-up whose time has passed, including one missed while the kernel was down, when the loop ticks, then it fires exactly once, deduplicated by wake-up id.
- [ ] AC6 — Given the loop, when it runs, then it only provides mechanisms: handlers are injected; no playbook, trigger type, dedupe policy or priority rule is built in. Phase 1 queues only the `wakeup` and `message` kinds.
- [ ] AC7 — Unit tests cover a crash between `started` and `done` (simulated by throwing), repeated tool calls with the same key, and a missed wake-up firing once after a restart.
- [ ] AC8 — The limit "exactly once holds only for effects inside SQLite; external effects are at most once only through the idempotency key plus the check" is documented in code where `runStep` is defined (requirement Risks).

## Implementation Notes (verified at planning time)

**Files read:** `kernel/src/store/migrations/001_initial.ts` (`events` append-only triggers :64–78, no status column; `work_steps` :103–111 with the status CHECK and no reason column; `wakeups` :113–122 `status` default `'pending'`, no CHECK, index `(status, due_at)`; `tasks` :16–29, `state TEXT NOT NULL` with no CHECK, `dedupe_key` not unique), `kernel/src/store/migrations/index.ts` (append-only list, versions contiguous from 1 — `store.ts:139–145`; next is **7**), `kernel/src/store/store.ts` (`transaction<T>(fn: () => T): T` is synchronous and nests as savepoints; `readonly dataDir` field; `resolveDataDir` → `STUDIO_DATA_DIR` or `~/.loomwright-studio`), `kernel/src/budget/internal.ts` (`scheduleWakeupOnce` already writes `pending` rows with reasons `cap_reset:<account>` / `cap_recheck:<account>` that nothing consumes yet; `appendEvent`/`appendNotify` are exported from `budget/internal.ts` but are not the budget module's public API — the loop writes its own audit rows), `kernel/src/sessions/manager.ts` (`startSession` inserts the row at :432 **before** `#launch` at :440, so the row id is known when SDK options are built; `#launch` builds `Options` at :833–845 with no `mcpServers`; `stopSession(id)` is idempotent and awaits the CLI's exit; `#gate` PreToolUse allows a non-Bash tool only when its exact name is in `policy.allowedTools`), `kernel/src/sessions/types.ts` (`SessionManagerOptions` :255–288), `kernel/src/sessions/manager.ts:220–245` (module-private `LaunchConfig`; `ResumeContext` already carries agent and task id), `kernel/test/sessions.test.ts:396–402` (asserts hooks keys and the absence of `allowedTools`/`canUseTool` in options — adding `mcpServers` keeps it green), `kernel/test/budget-helpers.ts` (temp store + injected clock helpers), `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`createSdkMcpServer(options: {name, version?, tools?, ...}): McpSdkServerConfigWithInstance`; `tool(name, description, rawShape, handler: (args, extra) => Promise<CallToolResult>)`; `Options.mcpServers?: Record<string, McpServerConfig>`), `docs/ARCHITECTURE.md` §Data model / §Kernel tools / §Main loop, `docs/OPEN_QUESTIONS.md` Q5, `docs/DECISIONS.md` D2/D3/D4/D17.

**Design (the worker may refine names, not behaviour):**

1. **Migration 7** (`kernel/src/store/migrations/007_event_loop.ts`, appended to the list; shipped migrations are never edited):
   - `CREATE TABLE event_queue (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL, source_ref TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')), not_before TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, task_id INTEGER, session_id INTEGER, enqueued_at TEXT NOT NULL DEFAULT NOW, done_at TEXT)` plus `CREATE INDEX event_queue_status_id ON event_queue (status, id)`. `source_ref` is the dedupe anchor for queue rows the kernel derives from something else (`wakeup:<id>`); user messages leave it null. `kind` is validated in code against the closed union `"wakeup" | "message"` (no SQL CHECK, so a later phase adds kinds without a table rebuild).
   - `ALTER TABLE work_steps ADD COLUMN failure_reason TEXT` and `ALTER TABLE work_steps ADD COLUMN rerunnable INTEGER NOT NULL DEFAULT 0`. `failed:interrupted` is reported by the API as `status: "failed", failureReason: "interrupted"` (the existing CHECK stays untouched).
   - Update `kernel/test/store.test.ts`'s default-migration-list assertion (:181–188) and table-set assertion (:177).
2. **`kernel/src/loop/` module** (replaces the `export {}` stub):
   - `steps.ts` — `runStep<T>(store, key, fn, opts?: { rerunnable?: boolean; now?: () => Date }) : T` for synchronous local work: one `store.transaction` that reads the row; `done` ⇒ return parsed `result_json` without calling `fn`; `started` ⇒ (crash leftover; a synchronous step can only leave one if a previous process died mid-way outside a transaction, i.e. from `runStepAsync`) apply the interrupted rule below; absent ⇒ insert `started`, call `fn()` inside the same transaction, update to `done` with `JSON.stringify(result)`. If `fn` throws, the transaction rolls back — no row remains, and the error propagates (a later call runs `fn` again; nothing was committed). `runStepAsync<T>(store, key, fn: () => Promise<T>, opts)` for work with external effects (files, session stop): commit `started` (with `rerunnable`) in its own transaction, `await fn()`, commit `done` + result. If `fn` rejects, the row is updated to `failed` with `failure_reason = 'error'` and the error propagates; a later call on a `failed` row returns/throws a `WorkStepFailedError` carrying the key and reason without calling `fn` (failed is terminal for that key — the caller picks a new key to try again). **Interrupted rule** (row is `started` when a call begins and no in-process call for that key is in flight): if the caller declares `rerunnable: true`, run `fn` again (async path: keep `started`, then `done`); otherwise update to `failed` / `failure_reason = 'interrupted'`, append one `notify` event (`actor 'kernel'`, payload `{ reason: 'work_step_interrupted', key }`) and throw `WorkStepInterruptedError`. In-process concurrency: a module-level map keyed by `store` + key holds in-flight promises, so a concurrent `runStepAsync` for a key already running returns the same promise instead of being misread as a crash. The header comment states the AC8 limit verbatim in substance: exactly once only for effects inside SQLite committed in the step's transaction; external effects (a file write, a `gh` comment) are at most once only through the key plus this check, and a crash between the external effect and `done` leaves `started` (re-run only when declared re-runnable, i.e. the effect is idempotent).
   - `queue.ts` — `enqueueEvent(store, { kind, payload, taskId?, sessionId?, sourceRef? }, at)`: validates `kind`, inserts the `event_queue` row and an `event_enqueued` audit row in one transaction; with a `sourceRef` that already exists it inserts nothing and returns the existing row id (dedupe). `enqueueMessage(store, { text, agent?, taskId? }, at)` is the convenience entry item 08's API/CLI will call (`kind: 'message'`).
   - `wakeups.ts` — `scheduleWakeup(store, { at, reason, taskId? }, now)` (validates `at` is a parseable ISO-8601 instant, normalizes to UTC ISO with ms like `NOW`; a past time is allowed and fires on the next tick) and `fireDueWakeups(store, now)`: selects `pending` rows with `due_at <= now` ordered by `due_at, id`; for each, in one transaction: `UPDATE wakeups SET status='fired', fired_at=?, updated_at=? WHERE id=? AND status='pending'` and only when that changed exactly 1 row, `enqueueEvent({ kind: 'wakeup', payload: { wakeupId, reason, dueAt }, taskId, sourceRef: 'wakeup:<id>' })`. The status guard plus the unique `source_ref` make a wake-up fire exactly once even if two ticks race or a crash lands between the two statements (they commit together). Rows written by the budget module (`cap_reset:*`, `cap_recheck:*`) fire the same way.
   - `loop.ts` — `class EventLoop { constructor(opts: { store; handlers: Partial<Record<EventKind, EventHandler>> }, deps: { now?; schedule?: (fn, ms) => cancel; tickMs? }) ; tick(): Promise<TickResult>; start(); stop(): Promise<void> }`. `tick()` is single-flight (an overlapping call awaits the running one): (1) `fireDueWakeups`; (2) loop over `pending` rows with `not_before` null or `<= now` in id order: call the handler for its kind with `{ event, runStep: bound helpers keyed under 'event:<id>:' }`; on success, in one transaction set `status='done', done_at` and append `event_done`; a missing handler for a kind ⇒ `done` with an `event_unhandled` audit row (mechanism only — no default behaviour is invented); a handler that throws `AdmissionRefusedError` (item 06) ⇒ the row stays `pending` with `not_before = retryAt` (or now + 1 h when `retryAt` is null) and an `event_parked` audit row — no second notify (admission already notified, D17: park, no retry loop); any other throw ⇒ `failed` with `last_error`, `attempts + 1`, an `event_failed` audit row and one `notify` (`reason: 'event_failed'`), and the loop continues with the next row (a failing event never blocks the queue). Handlers must make their own effects idempotent through `runStep` keyed on the event id, because a crash after effects and before `done` re-delivers the event — documented on `EventHandler`. `start()` schedules `tick()` every `tickMs` (default 1000) through the injected scheduler; `stop()` cancels and awaits an in-flight tick.
   - `types.ts`, `index.ts` — export `EventLoop`, `EventKind`, `EventHandler`, `QueuedEvent`, `runStep`, `runStepAsync`, `WorkStepInterruptedError`, `WorkStepFailedError`, `enqueueEvent`, `enqueueMessage`, `scheduleWakeup`, `fireDueWakeups`.
3. **`kernel/src/tools/` module (new) — the in-process MCP server:**
   - `server.ts` — `KERNEL_MCP_SERVER_NAME = "kernel"`, `KERNEL_TOOL_NAMES` (the six short names) and `kernelToolFullNames()` → `mcp__kernel__<name>` (what a user's `ToolPolicy.allowedTools` lists; the kernel never adds them to a policy itself — invariant 1/3). `createKernelMcpServer(ctx: { store; sessions: Pick<SessionManager, 'stopSession' | 'getSession'>; sessionId: number; now?: () => Date; schedule?: (fn: () => void) => void })` returns `createSdkMcpServer({ name: 'kernel', version, tools: [...] })`. Each tool is defined with `tool(name, description, zodRawShape, handler)` and its handler is also exported as a plain function (`kernelToolHandlers(ctx)`) so tests call handlers directly without a model. Tool input is untrusted (invariant 3): zod validates every field (string lengths bounded, integers positive, `idempotency_key` 1–200 chars); a validation or domain error returns `{ isError: true, content: [{ type: 'text', text }] }`, never throws through the SDK. Results are `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`.
   - Idempotency key scope: `runStep` key = `<tool>:session-<sessionId>:<idempotency_key>` — scoped to the session row. `resumeSession(id)` reuses the same row id, so a repeat with the same key in the same session, including after a resume, returns the first result; a different session (even of the same agent) reusing a model-chosen key such as `stop-1` is NOT deduplicated against another session's call — agent scope would turn a later session's `kernel_request_stop` into a silent no-op that writes no handoff and stops nothing (Plan Review attempt 1). A repeat with different arguments in the same session still returns the first result (documented in each tool description).
   - `kernel_task_create { title, state, kind?, assignee_agent?, parent_task_id?, links?: string[], dedupe_key?, next_check_at?, idempotency_key }` → synchronous `runStep` inserting into `tasks` + a `task_created` audit row in the same transaction; returns the task row. `state` is required free text — no state vocabulary is invented. `parent_task_id` must exist (FK).
   - `kernel_task_update { id, title?, state?, kind?, assignee_agent?, links?, dedupe_key?, next_check_at?, idempotency_key? }` → updates only the given fields + `updated_at`, appends `task_updated`; through `runStep` when a key is given. Unknown id ⇒ error result.
   - `kernel_task_list { state?, assignee_agent?, parent_task_id?, limit? (1–200, default 50) }` and `kernel_task_get { id }` — read-only.
   - `kernel_schedule_wakeup { at, reason, task_id?, idempotency_key }` → synchronous `runStep` calling `scheduleWakeup`; returns `{ wakeupId, dueAt }`.
   - `kernel_request_stop { handoff, idempotency_key }` → `runStepAsync` declared **re-runnable** (rewriting the same file is idempotent): resolve the session row (agent, task); path = `<store.dataDir>/memory/<agentDir>/handoffs/<taskName>.md` where `agentDir` = the agent id (must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, else error result — no path traversal) or `_unassigned` when null, and `taskName` = the task id or `session-<id>` when the session has no task; `mkdir -p` (mode 0700) and an atomic temp-file + rename write of the markdown (a short header naming agent, task, session and time, then the handoff text verbatim); append a `stop_requested` event (`session_id`, `task_id`, payload `{ path }`); then **schedule** `sessions.stopSession(sessionId)` through `ctx.schedule` (default `setImmediate`) instead of awaiting it — awaiting it inside the handler would wait on the session's own exit (not probed, see risks); a rejected stop is caught and recorded as a `stop_failed` event. Returns `{ path, stopping: true }`.
   - `handoff.ts` — the path validation and atomic markdown write (pure helpers, unit-tested).
   - `index.ts` — exports.
4. **Session manager wiring (narrow):** add optional `SessionManagerOptions.mcpServers?: (ctx: { sessionId: number; agent: string | null; task: number | null }) => Record<string, McpServerConfig>` (type imported from the SDK). The factory is called **once per launch attempt, inside `#launch`** (or `#launchResumeAttempt`, manager.ts ~881–905), never once per `startSession`/`resumeSession` call: a resume retries up to `MAX_RESUME_ATTEMPTS` launches, and `createSdkMcpServer` returns an `McpSdkServerConfigWithInstance` holding a live `McpServer` (sdk.d.ts:1201–1203) whose MCP `Protocol.connect` throws "Already connected to a transport" when reused — so every `query()` must get a fresh server instance. Extend the module-private `LaunchConfig` in manager.ts (:220) with what the factory needs (row id, agent, task; the resume path's `ResumeContext` already carries agent and task id). Absent option ⇒ no `mcpServers` key at all (byte-identical options; every existing test unchanged). Do not add `allowedTools`/`canUseTool` (sessions.test.ts:396–402). Tool gating stays the existing PreToolUse `#gate` + the user's `ToolPolicy`. Update the `kernel/src/sessions/types.ts:37` allowedTools doc example from `mcp__studio__kernel_record_task` to `mcp__kernel__kernel_task_create`.
5. **Daemon:** no change — wiring store + sessions + budget + loop into `daemon.ts` is items 08/09.
6. **Docs:** `docs/ARCHITECTURE.md` — §Data model: `event_queue` row (pending/done/failed, `source_ref` dedupe, `not_before` park), `work_steps` row gains `failure_reason` (`interrupted` / `error`) and `rerunnable`; memory paragraph names the handoff path `memory/<agent>/handoffs/<task>.md` under the data dir; §Kernel tools: server name `kernel` (full names `mcp__kernel__kernel_*`), idempotency-key scope, `kernel_request_stop` schedules the stop rather than awaiting it; §Main loop: queue rows vs append-only `events`, handlers injected, a parked event (admission refusal) waits for `not_before`, a failed event never blocks the queue.

**Tests (no real SDK, no model calls; temp store + injected clock as in `kernel/test/budget-helpers.ts`; "restart" = close the `Store`, open a new one on the same data dir):**
- `kernel/test/loop-steps.test.ts`: `done` returns stored result without calling `fn`; sync `fn` throwing rolls back (no row) and a retry runs `fn`; **crash between `started` and `done`** simulated by an async `fn` that throws after `started` was committed **and** by a hand-inserted `started` row followed by a restart → non-rerunnable ⇒ `failed`/`interrupted`, one `notify`, `WorkStepInterruptedError`, `fn` not called; rerunnable ⇒ `fn` runs again, `done`; async rejection ⇒ `failed`/`error`, later call ⇒ `WorkStepFailedError` without calling `fn`; concurrent same-key `runStepAsync` calls run `fn` once.
- `kernel/test/loop-queue.test.ts`: enqueue writes queue + audit rows; processing in id order; `done` only after the handler resolved; a handler that throws a plain error ⇒ `failed`, one notify, next event still processed; `AdmissionRefusedError` ⇒ stays `pending` with `not_before`, processed after the clock passes it; missing handler ⇒ `done` + `event_unhandled`; **pending events re-processed after a restart**; unknown kind rejected; `events` rows are never updated (append-only triggers stay intact).
- `kernel/test/loop-wakeups.test.ts`: due wake-up fires once into a `wakeup` queue row; **a wake-up whose due time passed while the kernel was closed fires exactly once after the restart**, and a second tick / a second loop on the reopened store does not fire it again; a future wake-up does not fire until due; a pre-existing `cap_reset:*` row (written via the budget helper) fires the same way; `scheduleWakeup` rejects an unparseable `at`.
- `kernel/test/kernel-tools.test.ts`: the server is named `kernel` and lists exactly the six tools; **repeated `kernel_task_create` / `kernel_schedule_wakeup` / `kernel_request_stop` with the same key in the same session return the first result and create one row/file** (also across a restart); two sessions of the same agent calling `kernel_request_stop` (and `kernel_task_create`) with the same key each write/stop/create independently; validation errors return `isError` without throwing; `kernel_task_update` / `list` / `get`; `kernel_request_stop` writes the markdown file at the exact path, records `stop_requested`, calls the fake `stopSession` once via the injected scheduler (never awaited inside the handler), rejects an agent id with `/` or `..`, uses `_unassigned` / `session-<id>` fallbacks.
- `kernel/test/sessions.test.ts`: with `mcpServers` set, `startSession` and `resumeSession` pass the factory's result as `options.mcpServers` and the factory receives the row id, agent and task; **a resume that retries gets a distinct `mcpServers` object (fresh factory call) on each attempt**; without the option, `options` has no `mcpServers` key.
- `kernel/test/store.test.ts`: migration 7 in the default migration-list assertion (:181–188); `event_queue` added to the table-set assertion (:177, `PHASE1_TABLES` :25–34); `event_queue` columns and the `work_steps` new columns exist.
- `npm test` and `npm run typecheck` (or `npx tsc -p tsconfig.json`) green in `kernel/`.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Event queue, wake-ups, runStep, kernel MCP server, migration 7, session-manager mcpServers hook, tests, docs | AC 1–8 | 8 modify, 13 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1 — event loop, work steps and kernel tools (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/store/migrations/007_event_loop.ts"}
  - {kind: "file", path: "kernel/src/loop/index.ts"}
  - {kind: "file", path: "kernel/src/loop/types.ts"}
  - {kind: "file", path: "kernel/src/loop/steps.ts"}
  - {kind: "file", path: "kernel/src/loop/queue.ts"}
  - {kind: "file", path: "kernel/src/loop/wakeups.ts"}
  - {kind: "file", path: "kernel/src/loop/loop.ts"}
  - {kind: "file", path: "kernel/src/tools/index.ts"}
  - {kind: "file", path: "kernel/src/tools/server.ts"}
  - {kind: "file", path: "kernel/src/tools/handoff.ts"}
  - {kind: "file", path: "kernel/test/loop-steps.test.ts"}
  - {kind: "file", path: "kernel/test/loop-queue.test.ts"}
  - {kind: "file", path: "kernel/test/loop-wakeups.test.ts"}
  - {kind: "file", path: "kernel/test/kernel-tools.test.ts"}
  - {kind: "symbol", path: "kernel/src/loop/steps.ts", name: "runStep"}
  - {kind: "symbol", path: "kernel/src/loop/steps.ts", name: "runStepAsync"}
  - {kind: "symbol", path: "kernel/src/loop/steps.ts", name: "WorkStepInterruptedError"}
  - {kind: "symbol", path: "kernel/src/loop/loop.ts", name: "EventLoop"}
  - {kind: "symbol", path: "kernel/src/loop/queue.ts", name: "enqueueMessage"}
  - {kind: "symbol", path: "kernel/src/loop/wakeups.ts", name: "fireDueWakeups"}
  - {kind: "symbol", path: "kernel/src/tools/server.ts", name: "createKernelMcpServer"}
  - {kind: "symbol", path: "kernel/src/tools/server.ts", name: "KERNEL_MCP_SERVER_NAME"}
  - {kind: "type", path: "kernel/src/loop/types.ts", name: "EventHandler"}
requires: []
lanes:
  - "kernel/src/loop/**"
  - "kernel/src/tools/**"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/index.ts"
  - "kernel/src/store/migrations/**"
  - "kernel/test/**"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "@anthropic-ai/claude-agent-sdk 0.3.284 runtime exports createSdkMcpServer and tool (verified present in sdk.mjs / sdk.d.ts at planning time)"
  - "zod ^4.6.5 (already a kernel dependency; tool() accepts a zod v4 raw shape)"
```

Modified files (8): `kernel/src/loop/index.ts` (was `export {}`), `kernel/src/store/migrations/index.ts` (append migration 7), `kernel/src/sessions/manager.ts` (`mcpServers` factory called inside `#launch` once per launch attempt; the module-private `LaunchConfig` at manager.ts:220 carries row id, agent, task), `kernel/src/sessions/types.ts` (`SessionManagerOptions.mcpServers` and the :37 doc example only), `kernel/src/sessions/index.ts` (export the new type if any), `kernel/test/store.test.ts`, `kernel/test/sessions.test.ts` (the `mcpServers` passthrough cases), `docs/ARCHITECTURE.md`. No `package.json`/`package-lock.json` change.

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
- `skills/unit-testing/SKILL.md` — vitest, injected clock, restart by reopening the store, fake `stopSession`
- `skills/error-handling/SKILL.md` — tool errors returned as `isError` results, a failing event never blocks the queue

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| `events` is append-only; marking an event done there is impossible | HIGH | HIGH | Separate `event_queue` table for processing state; `events` stays the audit log (one audit row per transition) | Feasibility (Phase 2.5) |
| `work_steps.status` CHECK rejects `failed:interrupted` | MEDIUM | HIGH | Store `failed` + `failure_reason = 'interrupted'`; the API reports `failed:interrupted`; CHECK untouched | Feasibility (Phase 2.5) |
| `stopSession` awaited inside the same session's tool handler would wait on its own exit (not probed) | HIGH | MEDIUM | `kernel_request_stop` commits the handoff + event, then schedules the stop out of band and returns; a failed stop is recorded | Feasibility (Phase 2.5) |
| Whether the PreToolUse hook fires for `mcp__` tools is not probed | MEDIUM | MEDIUM | Kernel tools are listed by full name in the user's `ToolPolicy`; nothing relies on the gate seeing them; listed under "Not verified" in the PR | Feasibility (Phase 2.5) |
| Exactly-once only holds for SQLite effects | MEDIUM | HIGH | Documented at `runStep`; external effects use `runStepAsync` with re-runnable declared only when idempotent (handoff file rewrite) | Requirement |
| A handler's effects re-run when a crash lands after effects and before `done` | MEDIUM | MEDIUM | Handlers get `runStep` helpers keyed on the event id; documented on `EventHandler` | Phase 3 |
| Path traversal through an agent id in the handoff path | HIGH | LOW | Strict agent-id pattern, fixed `_unassigned` / `session-<id>` fallbacks, tested | Phase 3 |
| Session-manager regression (items 05/06 heavily reviewed) | HIGH | LOW | One optional factory option; absent ⇒ no `mcpServers` key; the whole existing suite must stay green | Phase 3 |
| A reused in-process MCP server instance cannot reconnect on a resume retry | HIGH | MEDIUM | Factory called per launch attempt; test asserts a distinct object per attempt | Plan Review (attempt 1) |
| Model-chosen idempotency keys collide across sessions | MEDIUM | MEDIUM | Keys scoped to the session row (stable across resume), tested across two sessions | Plan Review (attempt 1) |
| Invariant 1 drift (inventing task states, priorities, default handlers) | MEDIUM | MEDIUM | `state` required free text; missing handler ⇒ `event_unhandled`, no default behaviour; no ordering other than id | Requirement |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-02-07-event-loop-and-kernel-tools.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-02T11:42:26Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/17
- **Branch:** feature/phase1-07-event-loop-and-kernel-tools
- **Files changed:** 23
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** kernel/src/loop/ — durable event_queue (migration 7; queue row + event_enqueued audit row in one transaction, id order, done only after the handler's effects commit, pending re-processed after restart, AdmissionRefusedError parks until retryAt, other failures fail the row with one notify and never block the queue), wake-ups fired once by id (status-guarded UPDATE + unique source_ref), runStep/runStepAsync (done → stored result; crash-left started → re-run only when re-runnable, else failed:interrupted + one notify; noEffect predicate releases a provably no-effect claim; AC8 limit documented); kernel/src/tools/ — in-process SDK MCP server `kernel` with six zod-validated tools, session-scoped idempotency keys, kernel_request_stop writing memory/<agent>/handoffs/<task>.md atomically and scheduling the stop; SessionManagerOptions.mcpServers factory once per launch attempt. Self-heal FAIL→fix a03facf→PASS (1 HIGH fixed: admission refusal inside a ctx work step failed a parked event permanently); no rubric; red_team_advisory: disabled; MEDIUM/LOW findings dismissed for owner decision.

## Not verified
- **PreToolUse gate firing for mcp__kernel__* tool calls** — not probed live; unit tests never call the real SDK or a model (subtask 1)
- **kernel_request_stop's scheduled stopSession for a live session from inside its own tool handler** — no live runtime; tests use a fake stopSession and an injected scheduler (subtask 1)
- **createKernelMcpServer served through a real query() launch** — tests called handlers directly (subtask 1)
