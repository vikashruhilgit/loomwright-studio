# Supervisor Job: Wright answers `studio ask` — role and memory files, message routing, and a reply in the terminal

## Environment
- **Project:** loomwright-studio (lane clone L5 of wave automate-2026-10-14-212726)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (sibling lanes L4 = item 05 approvals and L6 = item 07 version note run in parallel; neither touches `kernel/src/brain/`, `kernel/src/loop/`, `kernel/src/kernel.ts` or the migrations)
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-14-094206-wright-answers-studio-ask.md
- **Base commit:** 5b0b60b101a151ba8e441609d86b438c0956ad2d

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, vitest, zod, better-sqlite3; same stack as items 02–04 |
| 2 | Dependency Availability | GO | No new dependency. SDK `result` messages carry `result: string` on success |
| 3 | Architecture Fit | CAUTION | The feature seam gives handlers no SessionManager (`EventContext` = event, store, runStep, runStepAsync) and the manager never keeps a session's final text. Both need a small, generic kernel mechanism (below), outside the requirement's `Touches` list |
| 4 | Scope vs Supervisor Capability | CAUTION | ~18 files across kernel seams + a new feature + docs: over the 12-file single-worker bound, so split `context-bound` |
| 5 | Hard Blockers | GO | None. A real Wright session still needs a Loomwright install (phase 1 `loomwright_not_found` refusal) — tests use `makePluginDir` as phase 1 does |

**Overall Verdict:** CAUTION

## Task
**Goal:** The owner types `studio ask "<text>"` and gets Wright's reply in the terminal; a `message` event for agent `wright` starts (or resumes) a short Wright session through the existing SessionManager, built from role and memory files the owner can read and edit, and the reply is stored and retrievable through the API.

**Problem Statement:**
The owner needs to talk to Wright in plain English, and Wright must act only through kernel tools.
Currently there is no `studio ask`, no handler for `message` events (a queued message ends `event_unhandled`), no role or memory files beyond phase 1 handoff notes, and no place a session's final text is kept. This blocks phase 2's exit check (item 08).
Success looks like: `studio ask "remind me at 5pm to check X"` with a stand-in session prints the reply, leaves one trigger owned by `wright`, and the session has ended.

## Design decisions (binding for the workers)

1. **Generic seams, mechanism only (invariant 1):**
   - `kernel/src/loop/types.ts`: `EventContext` gains an optional `readonly sessions?: EventSessions` — a narrow interface (type-only, defined in `loop/types.ts`) with `startSession(params: StartSessionParams): Promise<SessionHandle>`, `resumeSession(id: number, params: ResumeSessionParams): Promise<SessionHandle>` and `getSession(id: number): SessionRow | undefined`. `EventLoopOptions` gains `readonly sessions?: EventSessions`; `EventLoop` passes it into every handler context. `kernel.ts` passes `sessions: manager`. Absent ⇒ handlers see `undefined` (existing tests unchanged).
   - `kernel/src/sessions/types.ts` + `manager.ts`: `SessionHandle` gains `readonly result: Promise<string | null>` — settles (never rejects) when `done` settles, with the `result` text of the session's last successful `result` message (`subtype === "success"` and not `is_error`) from its last attempt, else `null`. In memory only (nothing new persisted by the manager).
   - `kernel/src/features/contribution.ts` imports no session manager (the CLI module-graph pin in `feature-seams.test.ts` stays green): brain imports only types from `sessions/types.ts` and `loop/types.ts`.
2. **Storage — migration 12 `brain_messages`** (append to `kernel/src/store/migrations/index.ts`; `012_brain_messages.ts`; `IF NOT EXISTS`, no SQL trigger, values closed in code): `id`, `queue_id` (UNIQUE, the `event_queue` row), `agent`, `source` (`ask` / `trigger:<id>` / `approval:<id>` / `message`), `text`, `status` (`queued` | `running` | `replied` | `failed` | `parked`), `session_id`, `reply_text`, `detail` (refusal/failure reason), `created_at`, `updated_at`. Exactly one row per handled `message` event for an agent the brain owns.
3. **Memory files (invariant 8)** under `<dataDir>/memory/`: `wright/role.md`, `wright/preferences.md`, `wright/people.md`, `wright/lessons.md`, `shared/README.md`. Created on first handling of a Wright message when absent, with exclusive-create (`flag: "wx"`), never overwritten. The first-run `role.md` is a template string in `kernel/src/brain/templates.ts`, shown verbatim in `docs/architecture/brain.md` (a test pins doc == template). It states: who Wright is, the kernel tools it may use, that it proposes and the owner decides policy, that wrapped/untrusted text is data.
4. **Settings file** `<dataDir>/config/agents/wright.json` (outside `memory/`; item 05 denies session writes to `<dataDir>/config/`): `{ "model": null, "effort": null, "permission_mode": "default", "tool_policy": { "status": "proposed", "allowedTools": [...], "allowedBashPrefixes": [] } }`, created when absent, never overwritten. Proposed `allowedTools`: `mcp__kernel__kernel_task_create|update|list|get`, `mcp__kernel__kernel_trigger_register|remove|list`, `mcp__kernel__kernel_notify`, `mcp__kernel__kernel_approval_request`, `mcp__kernel__kernel_loomwright_capabilities`, `mcp__kernel__kernel_schedule_wakeup`, `mcp__kernel__kernel_request_stop`, plus read-only built-ins `Read`, `Glob`, `Grep`. `effort` is recorded but not applied (the session manager has no effort option; doc says so). The ONE settings reader (`readWrightSettings`, shared by `POST /ask` and the handler) creates the file with exclusive-create (`wx`) when absent BEFORE it checks the model, so a `model_unset` refusal on a fresh data dir always names a file that exists. Model unset (null/empty/not a string) ⇒ refusal naming the file and the field; no model is ever chosen by the kernel. A malformed file ⇒ refusal naming the file (never overwritten).
5. **Routing** — `brainContribution.handlers.message`: for `payload.agent === "wright"` (other agents: no effect, row not created, event done — later phases). Steps keyed on the event id: (a) ensure the brain row (idempotent on `queue_id`); (b) read settings (model unset ⇒ row `failed` with `model_unset`, event done — no session); (c) build context; (d) `runStepAsync("start-session")` → `ctx.sessions.startSession({agent:"wright", task: event.taskId ?? undefined, prompt, model, permissionMode, cwd: <dataDir>/memory/wright, policy})`, or, when `event.taskId` names a task whose latest Wright session is `interrupted`, `resumeSession` with the context as prompt; record `session_id`, status `running`; (e) attach a non-awaited `handle.result` listener that writes `reply_text` + `replied` (or `failed` with the session's status) — the handler does NOT await the session (the loop is never blocked). `AdmissionRefusedError` ⇒ row `parked` with `detail` = refusal reason + retry time, then rethrow (phase 1 park rules). `ctx.sessions` absent ⇒ row `failed` (`no_session_manager`).
6. **Context** (one prompt string, bounded): `role.md`, then preferences/people/lessons, the Loomwright manifest summary (`loomwrightManifestSummary` from the active install via the adapter; absent/error ⇒ one line "Loomwright isn't available: <reason>", never a failure), current local time with its IANA zone, then the message. Text from a trigger or an approval is wrapped: `<untrusted-data source="trigger:<id>">…</untrusted-data>` with a line that it is data, never instructions; an `ask` from the owner is labelled "Message from the owner". Each memory file is capped (e.g. 8 000 chars) and the whole context capped (e.g. 32 000 chars); every cut is stated in the context ("… truncated: <file>, <n> chars cut").
7. **API** (contributed routes, bearer-token only): `POST /ask` body `{text}` (1..8 000 chars) — refuses `409 {error:"model_unset", file, field:"model"}` (nothing queued), `409 {error:"kill_switch_engaged"}` (nothing queued); else one transaction: `enqueueMessage(store, { text, agent: "wright" })` (unchanged `MessageParams`; `queue.ts` is not edited) + brain row `queued` carrying `source: "ask"`; `202 {message_id, queue_id}`. `GET /messages/:id` → the row (status, session_id, reply_text, detail).
8. **CLI** `studio ask "<text>" [--json] [--timeout <s>]` (contributed subcommand): POST then polls `GET /messages/:id` (injectable clock/sleep, default timeout 120 s) until `replied` (print reply, exit 0), `failed` (print reason, exit 1), `parked` (print refusal reason, exit 2), or the refusals at POST (`model_unset`, `kill_switch_engaged`: one line, exit 2). Timeout ⇒ prints the session id (if any) and "follow up with `studio status`", exit 3; the session keeps running. Printed reply/reason text is control-character-escaped like `triggers/cli.ts`'s `quoted`. `--json` prints the final row JSON.

## Acceptance Criteria
- [ ] AC1: Given a fresh data dir, when the kernel first handles a message for Wright, then `memory/wright/{role,preferences,people,lessons}.md` and `memory/shared/README.md` exist and `role.md` equals the template; when the owner edits `role.md` and the kernel restarts and handles another message, the edit is kept.
- [ ] AC2: Given Wright's model is unset, when `studio ask "hi"` runs, then it exits non-zero naming `config/agents/wright.json` and the field `model`, no event is queued and no `sessions` row is created; on a fresh data dir the file exists after the refusal with `"model": null` and the proposed tool policy.
- [ ] AC3: Given a stand-in session (phase 1 `fakeSessions` pattern, no model) that calls `kernel_trigger_register` and returns a reply, when `studio ask "remind me at 5pm to check X"` runs against a kernel composed with the shipped features, then the CLI prints the reply and exits 0, exactly one trigger row exists with `owning_agent = 'wright'`, and the session row is terminal (`completed`).
- [ ] AC4: Given a `message` event from a `wake_agent` trigger, then the prompt the stand-in session receives labels the trigger text as data from trigger `<id>`, not as an instruction.
- [ ] AC5: Given admission refuses (a cap park fixture), then `studio ask` prints the refusal and exits 2, no session is spawned, and the queue row stays `pending` with `not_before` set.
- [ ] AC6: Given the reply takes longer than `--timeout 1`, then the CLI exits 3 printing the session id, and the session is not stopped.
- [ ] AC7: Given the Loomwright adapter reports no install, then the context carries one "Loomwright isn't available" line and building the context does not throw.
- [ ] AC8: Given a stand-in session whose last result is a success with text "T", when it ends, then `handle.result` resolves "T" (and `null` for a failed or stopped session, never rejecting); given an `EventLoop` built with `sessions`, when a handler runs, then `ctx.sessions` is that object, and without it `ctx.sessions` is `undefined`.
- [ ] AC9: Given the change, when `bash scripts/check-docs.sh` and the template pin run, then they pass: `docs/architecture/brain.md` documents the files, the verbatim template (pinned equal to `templates.ts` by a test), the settings file, the context a session gets, routing, the API/CLI and honest limits.

## Touched-file invariants

> Grounded at base `5b0b60b101a151ba8e441609d86b438c0956ad2d`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/loop/types.ts`** — keep: `EVENT_KINDS` unchanged (`export const EVENT_KINDS: readonly EventKind[] = ["wakeup", "message"];`); the new field is optional so `export type EventHandler = (ctx: EventContext) => void | Promise<void>;` callers compile unchanged; type-only imports from `../sessions/types.js` (the CLI graph pin forbids a runtime import of the manager).
- **`kernel/src/loop/loop.ts`** — keep: handlers copied (`this.#handlers = { ...options.handlers };`), unhandled → `event_unhandled`, park/fail semantics untouched; reuse the existing ctx construction (`runStepAsync: (name, fn, opts) => {`) — add `sessions` beside it only.
- **`kernel/src/kernel.ts`** — keep: contributions merged before the store opens (`const contributions = mergeContributions(options.contributions ?? SHIPPED_CONTRIBUTIONS, {`), teardown order, `onMessage: budget.observe` unchanged; add `sessions: manager` to the `new EventLoop(` options only.
- **`kernel/src/sessions/types.ts` / `kernel/src/sessions/manager.ts`** — keep: `done` "Settles with the terminal status. Never rejects."; `result` must never reject either; verdict logic (`if (result === undefined) verdict = { to: "failed", payload: { reason: "ended_without_result" } };`) unchanged; the manager persists nothing new.
- **`kernel/src/store/migrations/index.ts`** — keep: "Append only; never edit a shipped one." (`/** Every migration, in ascending version order. Append only; never edit a shipped one. */`); version 12 contiguous; no SQL trigger (integrity check refuses unknown triggers).
- **`kernel/src/brain/index.ts`** — keep: imports only types and zod-level modules, never the Agent SDK (`so it imports only types and zod: never the Agent SDK.`); the contribution stays frozen (`Object.freeze`).
- **`kernel/test/store.test.ts`** — mirror: the applied-migration pins (`expect(store.appliedMigrations().map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);` and the last-migration pin `[11, "phase_2_tables"]`) are extended to 12 / `brain_messages` everywhere they appear (every `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]` list, the contiguity messages, and `expect(err.knownVersion).toBe(11);` → 12); the default-list test names migration 12.
- **`kernel/test/feature-seams.test.ts`** — mirror: the shipped-kernel assertion (`expect(kernel.contributions.handlers).toEqual({});`), the shipped route/subcommand lists, and the per-contribution keys map (`notifications: ["name", "tools", "routes", "subcommands", "dueWork"],` — add `brain: ["name", "routes", "subcommands", "handlers"]`) are updated to the brain's `message` handler, `POST /ask`, `GET /messages/:id` and `ask`. The agent-less message pin (`expect(events(kernel.store, "event_unhandled")).toHaveLength(1);`, enqueued by `enqueueMessage(store, { text: "hello" })`) flips on purpose: the brain handles `message`, so the event ends `done` with no `event_unhandled` row and no `brain_messages` row (agent is not `wright`). The module-graph pin (no Agent SDK reachable from `features/index.js`) must stay green.
- **Tests that compose the default contributions and also own `message`** — the brain now owns the `message` kind inside `SHIPPED_CONTRIBUTIONS`, and a second owner is refused at composition (a pinned behaviour: `[{ name: "alpha", handlers: { message: () => {} } }, { name: "beta", handlers: { message: () => {} } }, "handler", "message"],`). Mirror, keeping each test's intent:
  - `kernel/test/kernel-daemon.test.ts` — the no-handler case (`expect(kinds).toEqual(["event_unhandled"]);`) composes `contributions: SHIPPED_CONTRIBUTIONS.filter((c) => c.name !== "brain")` so it still proves the daemon adds no handler of its own; the `handlers: { message: (ctx) => void seen.push(ctx.event.payload) }` case composes the same filtered list.
  - `kernel/test/fixtures/crash-harness.mjs` — its `startKernel({` call with `handlers: { message },` passes the same filtered `contributions` (the harness stands in for a playbook, not for the brain).
  - `kernel/test/feature-seams.test.ts` "a contribution composed from outside (AC4)" — composes `[...SHIPPED_CONTRIBUTIONS, contribution]` with a `message` handler (`handlers: { message: (ctx) => void seen.messages.push(ctx.event.payload) },`): filter the brain out of that list too.
  - `kernel/test/triggers.test.ts` — the usage pin (`${USAGE} | ${NOTIFICATIONS_HELP} | ${TRIGGERS_HELP}`) gains the brain's `ASK_HELP`; `kernel/test/feature-seams.test.ts`'s literal usage string (`studio triggers on|off <id> [--yes]\n`) gains the `studio ask` help text.
  - Any other suite that turns red only because the brain now owns `message` or adds `ask` is updated the same way (filter the brain out, or extend the shipped list); no assertion is deleted to get green.
- **`kernel/src/kernel.ts` comment** — the line (`` `event_unhandled` unless a contribution handles its kind (none shipped).``) is corrected: the brain handles `message`.
- **`docs/ARCHITECTURE.md`** — keep relative links valid (check-docs); add a `brain_messages` row to the data model table and update the "Each ships only what its own item has built" sentence to include the brain.

## Closed enumerations touched

> Sibling grep at base `5b0b60b`: `grep -rnF 'phase_2_tables' kernel/` → hits in `kernel/src/store/migrations/011_phase_2_tables.ts`, `kernel/src/store/migrations/index.ts`, `kernel/test/store.test.ts`.

- **migration `12` / `brain_messages`** (sibling: `11` / `phase_2_tables`) — must be named in:
  - `kernel/src/store/migrations/index.ts` — the `migrations` list (`phase2Tables,`) — extend.
  - `kernel/test/store.test.ts` — every applied-version list, the last-migration pin, the default-list test name, `knownVersion` — extend.
  - `kernel/src/store/migrations/011_phase_2_tables.ts` — the sibling's own module — no change: shipped migrations are never edited.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/brain.test.ts` — doc == template | flip one character of the template string in `kernel/src/brain/templates.ts` |
| `kernel/test/sessions-result.test.ts` — result is the last successful result's text | make the manager resolve `result` from the first result instead of the last successful one in `kernel/src/sessions/manager.ts` |
| `kernel/test/loop-sessions.test.ts` — ctx.sessions passed through | delete the `sessions` field from the handler ctx in `kernel/src/loop/loop.ts` |
| `kernel/test/brain.test.ts` — role.md never overwritten | drop the `wx` flag in the memory-file writer in `kernel/src/brain/memory.ts` |
| `kernel/test/brain.test.ts` — trigger text wrapped as data | remove the `<untrusted-data` wrapper in `kernel/src/brain/context.ts` |
| `kernel/test/feature-seams.test.ts` — shipped handlers include the brain's `message` | drop `handlers` from `brainContribution` in `kernel/src/brain/index.ts` |
| `kernel/test/brain.test.ts` — model_unset queues nothing | move the enqueue before the settings check in `kernel/src/brain/routes.ts` |
| `kernel/test/brain.test.ts` — timeout exits 3 and does not stop the session | call the stop route on timeout in `kernel/src/brain/cli.ts` |
| `kernel/test/brain.test.ts` — admission refusal exits 2, row parked | swallow the `AdmissionRefusedError` instead of rethrowing in `kernel/src/brain/handler.ts` |
| `kernel/test/brain.test.ts` — one trigger owned by wright after studio ask | pass a different `agent` than `"wright"` to `startSession` in `kernel/src/brain/handler.ts` |
| `kernel/test/store.test.ts` — applied versions end at 12 | delete `brainMessages,` in `kernel/src/store/migrations/index.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel seams: handler sessions, session result text, migration 12 | AC8 | 7 modify, 3 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Brain feature: memory/settings/context, message handler, `/ask` routes, `studio ask`, docs | AC1–AC7, AC9 | 7+ modify, 8 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | BLOCKED (by #1) |

### Subtask contracts

```yaml
# Subtask 1
provides:
  - {kind: "type", path: "kernel/src/loop/types.ts", name: "EventSessions"}
  - {kind: "symbol", path: "kernel/src/loop/loop.ts", name: "sessions"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "result"}
  - {kind: "file", path: "kernel/src/store/migrations/012_brain_messages.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/012_brain_messages.ts", name: "brainMessages"}
  - {kind: "file", path: "kernel/test/loop-sessions.test.ts"}
  - {kind: "file", path: "kernel/test/sessions-result.test.ts"}
requires: []
lanes:
  - "kernel/src/loop/types.ts"
  - "kernel/src/loop/loop.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/src/store/migrations/012_brain_messages.ts"
  - "kernel/test/loop-sessions.test.ts"
  - "kernel/test/sessions-result.test.ts"
  - "kernel/test/store.test.ts"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/brain/memory.ts"}
  - {kind: "file", path: "kernel/src/brain/settings.ts"}
  - {kind: "file", path: "kernel/src/brain/context.ts"}
  - {kind: "file", path: "kernel/src/brain/templates.ts"}
  - {kind: "file", path: "kernel/src/brain/handler.ts"}
  - {kind: "file", path: "kernel/src/brain/routes.ts"}
  - {kind: "file", path: "kernel/src/brain/cli.ts"}
  - {kind: "symbol", path: "kernel/src/brain/index.ts", name: "brainContribution"}
  - {kind: "file", path: "kernel/test/brain.test.ts"}
  - {kind: "file", path: "docs/architecture/brain.md"}
requires:
  - {from: "1", kind: "type", path: "kernel/src/loop/types.ts", name: "EventSessions"}
  - {from: "1", kind: "symbol", path: "kernel/src/sessions/types.ts", name: "result"}
  - {from: "1", kind: "symbol", path: "kernel/src/store/migrations/012_brain_messages.ts", name: "brainMessages"}
lanes:
  - "kernel/src/brain/**"
  - "kernel/test/brain.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/kernel-daemon.test.ts"
  - "kernel/test/triggers.test.ts"
  - "kernel/test/fixtures/crash-harness.mjs"
  - "kernel/test/*.test.ts"
  - "docs/architecture/brain.md"
  - "docs/ARCHITECTURE.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (2 consumes 1's types) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Kernel seams outside the requirement's Touches (loop, kernel.ts, sessions, migrations) — Feasibility (Phase 2.5) | MEDIUM | Keep each change minimal and optional; existing tests unchanged; the PR body names the deviation and why (the seam gives handlers no session manager, and no final text is kept) |
| Context size grows with memory files and the manifest — Requirement risk | MEDIUM | Per-file and total caps; every cut stated in the context and documented |
| Reply lost if the kernel dies between the session's result and the row write (in-memory `result`) | LOW | Row stays `running`; `studio ask` times out with the session id; documented as an honest limit |
| Concurrent lanes L4 (05 approvals) and L6 (07 version note) merge into the same wave branch: all three must edit the shipped-contribution pins in `kernel/test/feature-seams.test.ts` and the "Each ships only what its own item has built" sentence in `docs/ARCHITECTURE.md`, so the wave merge will conflict there | MEDIUM | Also `kernel/test/kernel-daemon.test.ts`, `kernel/test/triggers.test.ts` and `kernel/test/fixtures/crash-harness.mjs` (L4 adds approvals routes/subcommands and may touch the same usage pins). Keep edits to the minimal list entries and one sentence clause; conflicts are resolved at wave integration (marker-only) or escalated to the owner, never force-resolved. Migration 12 is claimed only here (05 and 07 add none per their Touches) |
| A shell-less Wright cannot read memory outside `cwd` | LOW | `cwd` = `<dataDir>/memory/wright`; memory content is already in the prompt |
| Session needs a Loomwright install (phase 1 refusal) | LOW | Tests use `makePluginDir`; a refusal marks the row `failed` with the reason |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-15-wright-answers-studio-ask.md
```

## Plan Review: PASS (attempt 3/3; owner chose "Save and exit")

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | MEDIUM | Pin mutations | Usage pins (triggers.test.ts / feature-seams literal), the agent-less message flip, the AC7 "Loomwright isn't available" line and the shipped route list have no pin-mutation row | deferred — workers/reviewers add the mutation check |
| 2 | LOW | Touched-file invariants | The `kernel.ts` comment edit (and header comment at line 5) is made by Subtask 1 together with `sessions: manager` | deferred (assign to Subtask 1) |
| 3 | LOW | Parallelism Analysis | Subtask 2's `kernel/test/*.test.ts` lane overlaps Subtask 1's test files; legal (ordered by requires) | deferred |
| 4 | LOW | Subtask contracts | `result` / `sessions` provide names are generic; AC8 tests are the real check | deferred |
| 5 | LOW | Design decisions | `mcp__kernel__kernel_approval_request` is in the proposed policy before item 05 ships it; brain.md notes it takes effect once item 05 ships | deferred (doc note) |
| 6 | LOW | Skill References | skills come from the Loomwright plugin | warning |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-15T04:53:19Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/54
- **Branch:** feature/06-wright-answers-studio-ask
- **Files changed:** 26
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** studio ask + brain feature (memory/settings files, message handler, /ask and /messages routes, reply record) on two generic kernel seams (EventContext.sessions, SessionHandle.result) and migration 12; heal fixed a false config-deny claim (attributed to item 05/PR #52 + honest limit), recorded the feature-seams test diagnosis, and added 3 branch tests; 1008 tests pass, check-docs OK; risk_classification high_risk=true (advisory: migration, size).

## Not verified
- **A real Wright session over the Agent SDK with a model** — tests use fake spawner/query and a stub EventSessions (subtask 2)
- **studio ask against a launchd-run daemon** — only in-process startKernel with in-memory Keychain (subtask 2)
- **kernel_approval_request in the proposed policy** — item 05 not on this branch (subtask 2)
- **docs/ARCHITECTURE.md brain_messages row** — Subtask 2's lane (subtask 1; done by subtask 2)
