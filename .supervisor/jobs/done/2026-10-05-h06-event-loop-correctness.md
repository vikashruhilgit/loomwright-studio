# Supervisor Job: H06 — event loop and work steps behave the same on every path

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariant 2: the kernel owns the loop's lifecycle, so the timer chain must be deterministic; invariant 1: the kernel ships mechanism only, so no handler or playbook behaviour is added; one crash ⇒ one notification is a correctness property of that mechanism, not a playbook policy)
- **Git:** clean except the automate engine's run file (`.supervisor/automate/automate-2026-10-03-180512.md`, modified) and three untracked owner files (`.supervisor/requirements/h01-launchd-start-failure-and-reinstall-plan.md`, `.supervisor/requirements/h05-budget-cap-park-keys-plan.md`, `.supervisor/requirements/phase-1-hardening/_BACKLOG.md`). Never stage any of them in this job; commit with explicit paths only. Branch: main @ fa31f9d
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 (CI: ubuntu-latest, `node-version: 22`; `.github/workflows/ci.yml` runs `bash scripts/check-docs.sh`, then in `kernel/` `npm ci`, `npm run typecheck`, `npm test`, `npm run build` — tests run BEFORE the build, so no test may depend on `kernel/dist`)
- **Blockers:** 0 | **Warnings:** 1 (dirty automate run file + untracked owner files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1-hardening/06-event-loop-correctness.md
- **Base commit:** fa31f9dac809a9317094786092d9545f226fc33e

## Feasibility
- **Verdict:** GO
- Tech stack — GO: strict TypeScript kernel (NodeNext, vitest), better-sqlite3; no new package.
- Dependencies — GO: none new.
- Architecture fit — GO: every change stays inside `kernel/src/loop/` (mechanism) plus one doc paragraph; no handler is added (out of scope per the requirement).
- Scope — GO: six small, related correctness fixes in two source files and their tests; one worker.
- Hard blockers — GO: none. No migration needed (AC4 reads the existing `work_steps.rerunnable` column).

## Task
**Goal:** Make the event loop's timer chain, parking, failure notices and work-step replay behave the same on every call path, so the first playbook handler does not inherit doubled ticks, park-row spam, double notifications, caller-dependent replay, or results that change type between the first call and a repeat. Fix the architecture doc's idempotency-key sentence to match the tool schemas.

**Problem statement:** the owner (and every future playbook handler) needs the kernel loop's mechanism to be deterministic because handlers will rely on it; today six latent defects (F07-1..6) are unreachable only because phase 1 ships no handlers.

## Acceptance Criteria
- [ ] **AC1 — one timer chain.** Given `stop()` followed by `start()` without awaiting the stop, during a running tick, when the tick finishes, then exactly one timer chain is live and a later `stop()` cancels it. A per-chain generation token (or equivalent) stops the old chain's `.finally` from rescheduling. A test reproduces the old double chain (injected scheduler: count live, un-cancelled scheduled entries after the old tick settles) and now sees one; the existing `start()`/`stop()` tests in `kernel/test/loop-queue.test.ts` still pass.
- [ ] **AC2 — no park in the past.** Given an `AdmissionRefusedError` whose `retryAt` is now or in the past, when the event is parked, then `not_before` is strictly later than now: a past-or-now `retryAt` is treated as missing (`now + DEFAULT_PARK_MS`) or floored — the implementer picks one and documents it in the `#park` doc comment and the class doc. Repeated ticks (with the injected clock not advanced past `not_before`) add no further `event_parked` rows. A future `retryAt` behaves exactly as today (existing test "AdmissionRefusedError parks the row until retryAt" unchanged).
- [ ] **AC3 — one notification per interrupted step.** Given a crash-interrupted step that is not re-runnable, reached through a handler's `ctx.runStep`/`ctx.runStepAsync`, when the handler's event fails, then the owner gets exactly ONE `notify` event, and both facts are still recorded as `events` rows (the interrupted step — e.g. a `work_step_interrupted` audit row or the existing notify carrying that reason — and the `event_failed` row). A direct `runStep`/`runStepAsync` call outside the loop (as `kernel/src/tools/server.ts` makes) still produces exactly one notify for an interrupted step (no regression to zero). **No path may produce zero:** when a handler calls `ctx.runStep` inside its own `store.transaction` (or inside another `ctx.runStep`), the step nests as a savepoint and the outer rollback undoes its interrupted mark AND its notify (`steps.ts:248-249`), so the loop must still notify in that case. Test all three: loop path (exactly one notify), direct path (exactly one notify), and loop path with `ctx.runStep` nested in `store.transaction` (exactly one notify). The notify that survives must be traceable to the event: `event_failed` carries the step key (and the queue id, as today).
- [ ] **AC4 — the stored `rerunnable` decides replay.** Given a `work_steps` row left `started` with one stored `rerunnable` value and replayed by a caller passing the other, when `claim()` decides, then it uses the STORED value (as `007_event_loop.ts` documents: "whether the step was declared re-runnable … when it was started"), and no longer rewrites the stored column from the caller's option. Tests cover both mismatch directions (stored true + caller false ⇒ re-runs; stored false + caller true ⇒ `failed:interrupted`), for both `runStep` and `runStepAsync`. The doc comments that describe the old caller-decides rule are updated to say the value stored when the step was first started decides replay, and `opts.rerunnable` only sets it on the first claim: `StepOptions.rerunnable` (`kernel/src/loop/types.ts:38-42`), the `steps.ts` header (`:14-16`), the `runStep` doc (`:240-242`) and the `runStepAsync` doc (`:283-286`). Existing tests that hand-insert a `started` row and expect a re-run must seed `rerunnable = 1`; `kernel/test/loop-steps.test.ts:158-166` is rewritten for the stored-value rule (see Implementation Notes).
- [ ] **AC5 — same value on first call and repeat.** Given `runStep`/`runStepAsync` returning a non-JSON value (e.g. a `Date`, an object with an `undefined` property, a class instance), when it is called for the first time and then repeated, then both calls return the same JSON round-tripped value (`toEqual` and same `typeof`/constructor for the `Date` case: a string both times). Alternatively the generic type is restricted to JSON-safe values and the compiler enforces it; the implementer picks ONE, documents it in the `steps.ts` header and the `EventContext` doc in `types.ts`, and adds a test (runtime round-trip test, or a `// @ts-expect-error` type test that `npm run typecheck` checks). A `fn` returning `undefined` still yields `undefined` on both calls.
- [ ] **AC6 — the doc matches the schemas.** `docs/ARCHITECTURE.md` (the kernel-tools paragraph, currently line 65, "Each tool that creates something takes a caller-chosen `idempotency_key`") lists which kernel tools REQUIRE an `idempotency_key` (`kernel_task_create`, `kernel_schedule_wakeup`, `kernel_request_stop`), which take one OPTIONALLY (`kernel_task_update`) and which have NONE (`kernel_task_list`, `kernel_task_get`), matching `shapes` in `kernel/src/tools/server.ts`; the header comment of `kernel/src/tools/server.ts` (lines 10–16) says the same. `bash scripts/check-docs.sh` passes.

Global: `cd kernel && npm run typecheck && npm test && npm run build` green; `bash scripts/check-docs.sh` green. Docs that describe changed behaviour (the `work_steps` row and the "Main loop" paragraph in `docs/ARCHITECTURE.md`) are updated in the same PR.

## Implementation Notes (verified at planning time, main @ fa31f9d)
- **AC1** `kernel/src/loop/loop.ts:83-106`: `start()` sets `#started` and schedules `#loop`; `stop()` clears `#started`, cancels `#cancel`, awaits `#running`. `#loop`'s `.finally(() => { if (this.#started) this.#cancel = this.#schedule(this.#loop, this.#tickMs) })` checks only the boolean, so an old chain whose tick was in flight across `stop()`→`start()` reschedules beside the new chain and overwrites `#cancel`. Suggested shape: a `#generation` counter bumped by both `start()` and `stop()`; `#loop` captures the generation it was scheduled under and reschedules only while it is still current. The only production `stop`→`start` (`POST /stop-all` → `POST /resume`, `kernel/src/api/server.ts:310-330`) is serialized and awaits `stop()`, so production is safe today; the test must call `start()` without awaiting `stop()`.
- **AC2** `loop.ts:197-208` (`#park`): `normalizeInstant(err.retryAt) ?? now + DEFAULT_PARK_MS` has no floor. Production admission only returns future `retryAt` (`activeParks` filters `resets_at > now`, `kernel/src/budget/internal.ts:112-118`; agent limit uses the next day start), so this is reachable only by a future handler/refusal source. Keep `retry_at` in the `event_parked` payload as the raw refusal value (audit) and `not_before` as the effective one.
- **AC3** `kernel/src/loop/steps.ts:140-144` (`markInterrupted`) appends `notify {reason: "work_step_interrupted", key}`; the rethrown `WorkStepInterruptedError` reaches `loop.ts:139-140` → `#fail` (`:210-221`), which appends `event_failed` + a second `notify {reason: "event_failed"}`. Any fix must keep exactly one notify on the direct (tools) path too, since `kernel/src/tools/server.ts` calls `runStep`/`runStepAsync` without the loop. One option: in `#fail`, when the error is a `WorkStepInterruptedError` AND the step's interrupted mark actually committed — read it back, `getWorkStep(store, err.key)?.label === "failed:interrupted"` at `#fail` time (same read-back pattern as the `failedByRefusal` check at `loop.ts:171-177`; a read failure ⇒ notify, fail toward notifying) — append `event_failed` with the step key and skip the loop's own notify; otherwise (mark rolled back by an outer transaction, row still `started`) the loop sends its own notify as today. The step's notify carries `NO_REF` and no queue id while the loop's carries both, so `event_failed` must carry the step key to link them; the implementer may choose another design that meets the AC (e.g. a step option that suppresses the step notify when the caller will notify), and documents it in the `EventHandler`/`EventContext` docs.
- **AC4** `steps.ts:170-184` (`claim`) branches on the caller's `rerunnable` and, when true, runs `UPDATE work_steps SET rerunnable = 1` (line 182). Use `row.rerunnable === 1` instead and drop that UPDATE. The row's value is written by `insertStarted` (`:122-126`) from the first call's option. **Caller audit done at planning:** `kernel/src/tools/server.ts` calls `runStep` (sync, one transaction: a `started` row never survives a crash, so the stored value is never consulted for replay) for `kernel_task_create`/`kernel_task_update`/`kernel_schedule_wakeup`, and `runStepAsync` with a constant `{ rerunnable: true }` for `kernel_request_stop` (`:356-376`); tool keys are prefixed per tool, so no key is shared between a re-runnable and a non-re-runnable caller. So switching to the stored value changes no production replay. Existing tests `kernel/test/loop-steps.test.ts:81-87` and `:113-118` hand-insert `started` rows with the default `rerunnable = 0` and then call with `rerunnable: true` expecting a re-run — they must seed `rerunnable = 1` (adjust the local `insertStarted` helper at `:20-22` to take the value). A third test, `:158-166` ("noEffect on a re-run crash leftover keeps it started"), cannot just be re-seeded: it seeds `rerunnable = 0`, re-runs with `{ rerunnable: true, noEffect }` (`:162`), then asserts a later call WITHOUT `rerunnable` is interrupted (`:165`) — the old caller-decides rule. Rewrite it for the stored-value rule while keeping its intent (a `noEffect` release of a re-run leftover does NOT delete the row): seed `rerunnable = 1`, keep the `:162`/`:163` assertions (row stays `started`), and change `:165` so a later call — whatever the caller passes — re-runs the leftover because it was declared re-runnable when started (e.g. resolves to `1`, row `done`). Check `kernel/test/fixtures/crash-harness.mjs` and `kernel/test/crash-resume.test.ts` for the same assumption.
- **AC5** `steps.ts:251-274` (`runStep`) returns `value` (live) on the first call (`:263-264`) and `parseResult(row.result_json)` on a repeat (`:176`); `runStepAsync` does the same (`:308-309`, `:323-324`). `markDone` (`:128-134`) already stringifies; returning the parsed stored JSON (or `JSON.parse(json)` of what was just stringified) makes both calls identical. Note `JSON.stringify` of a value with a `toJSON`/`BigInt`: a `BigInt` throws today inside `markDone` — keep that behaviour (it is a `fn` result the step cannot store) and do not widen scope. `tools/server.ts` callers return JSON-safe objects already, so their observable results do not change.
- **AC6** `docs/ARCHITECTURE.md:65` and `kernel/src/tools/server.ts:10-16`; schemas at `kernel/src/tools/server.ts:90-136` (`idempotency_key: idempotencyKey` on create/schedule_wakeup/request_stop, `idempotencyKey.optional()` on update, absent on list/get). `kernel_request_stop` creates no row but writes the handoff note and a `stop_requested` event; describe it as "requires one" without calling it a creating tool.
- Do not add handlers, change `DEFAULT_TICK_MS` or `DEFAULT_PARK_MS` (out of scope).

## Subtask Structure

| # | Title | Criteria | Est. Files | Skills | Status |
|---|-------|----------|-----------|--------|--------|
| 1 | Event loop + work-step correctness (timer chain, park floor, single notify, stored rerunnable, JSON-stable results, idempotency-key doc) | AC1–AC6 | 5 modify (+0–2 possible) | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

## Subtask Contracts
```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/loop/loop.ts", name: "EventLoop"}
  - {kind: "symbol", path: "kernel/src/loop/steps.ts", name: "runStep"}
  - {kind: "symbol", path: "kernel/src/loop/steps.ts", name: "runStepAsync"}
  - {kind: "type", path: "kernel/src/loop/types.ts", name: "EventContext"}
  - {kind: "file", path: "kernel/test/loop-queue.test.ts"}
  - {kind: "file", path: "kernel/test/loop-steps.test.ts"}
  - {kind: "file", path: "docs/ARCHITECTURE.md"}
requires: []
lanes:
  - "kernel/src/loop/loop.ts"
  - "kernel/src/loop/steps.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/test/loop-queue.test.ts"
  - "kernel/test/loop-steps.test.ts"
  - "kernel/test/loop-helpers.ts"
  - "kernel/test/crash-resume.test.ts"
  - "kernel/test/fixtures/crash-harness.mjs"
  - "kernel/test/kernel-tools.test.ts"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "vitest fake scheduler pattern already used by loop-queue.test.ts (injected schedule/now deps)"
```
Modified (est.): `kernel/src/loop/loop.ts`, `kernel/src/loop/steps.ts`, `kernel/src/loop/types.ts` (docs; types only if AC5 picks the compile-time option), `kernel/src/tools/server.ts` (header comment only, AC6), `docs/ARCHITECTURE.md`; tests `kernel/test/loop-queue.test.ts`, `kernel/test/loop-steps.test.ts`, possibly `kernel/test/loop-helpers.ts`, `kernel/test/crash-resume.test.ts` / `kernel/test/fixtures/crash-harness.mjs` (only if they rely on the caller-rerunnable upgrade), `kernel/test/kernel-tools.test.ts` (only if a tool test asserts notify counts). Created: none.

## Parallelism Analysis
### Dependency Graph
```
Subtask 1 (independent)
```
### File Overlap Matrix
Single subtask — no overlap.
### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Phase 3 analysis notes
### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/loop/loop.ts:83-105` | yes | HOLDS | `.finally(() => { if (this.#started) this.#cancel = this.#schedule(this.#loop, this.#tickMs); })` (104) | tip 3 minutes ago, fetched <1h |
| `api/server.ts:265` | yes | HOLDS (moved to 310) | `const stopAll = (): Promise<…> => serialized(async () => {` | tip 3 minutes ago, fetched <1h |
| `api/server.ts:277` | yes | HOLDS (moved to 322) | `const resume = (): Promise<{ engaged: false }> => serialized(async () => {` | tip 3 minutes ago, fetched <1h |
| `kernel/src/loop/loop.ts:197-199` | yes | HOLDS | `normalizeInstant(err.retryAt) ?? new Date(now.getTime() + DEFAULT_PARK_MS)` (199) | tip 3 minutes ago, fetched <1h |
| `budget/internal.ts:114` | yes | HOLDS (moved to 117) | `WHERE account = ? AND status = 'rejected' AND (resets_at IS NULL OR resets_at > ?)` | tip 3 minutes ago, fetched <1h |
| `steps.ts:141-143` | yes | HOLDS | `appendEvent(store, "notify", NO_REF, { reason: "work_step_interrupted", key }, at);` (143) | tip 3 minutes ago, fetched <1h |
| `loop.ts:140` | yes | HOLDS | `if (!(err instanceof AdmissionRefusedError)) return this.#fail(row, ref, err);` | tip 3 minutes ago, fetched <1h |
| `loop.ts:218` | yes | HOLDS | `appendEvent(this.#store, "notify", ref, { reason: "event_failed", … })` | tip 3 minutes ago, fetched <1h |
| `steps.ts:170-182` | yes | HOLDS | `store.prepare("UPDATE work_steps SET rerunnable = 1, …")` (182) | tip 3 minutes ago, fetched <1h |
| `steps.ts:107` | yes | HOLDS | `rerunnable: row.rerunnable === 1,` | tip 3 minutes ago, fetched <1h |
| `007_event_loop.ts:22` | yes | HOLDS | `` - `work_steps.rerunnable`: whether the step was declared re-runnable `` (22-23) | tip 3 minutes ago, fetched <1h |
| `steps.ts:264` | yes | HOLDS | `return { interrupted: false, value };` | tip 3 minutes ago, fetched <1h |
| `steps.ts:176` | yes | HOLDS | `if (row.status === "done") return { kind: "done", value: parseResult(row.result_json) };` | tip 3 minutes ago, fetched <1h |
| `steps.ts:309` | yes | HOLDS (moved to 308-309) | `if (c.kind === "done") return c.value as T;` | tip 3 minutes ago, fetched <1h |
| `steps.ts:324` | yes | HOLDS (moved to 323-324) | `store.transaction(() => markDone(…)); return value;` | tip 3 minutes ago, fetched <1h |
| `docs/ARCHITECTURE.md:65` | yes | HOLDS | `Each tool that creates something takes a caller-chosen \`idempotency_key\`` | tip 3 minutes ago, fetched <1h |
| `tools/server.ts:111` | yes | HOLDS | `idempotency_key: idempotencyKey.optional(),` | tip 3 minutes ago, fetched <1h |
| `tools/server.ts:128` | yes | HOLDS (moved to 134) | `idempotency_key: idempotencyKey,` (kernel_request_stop) | tip 3 minutes ago, fetched <1h |

No STALE rows.

### Blast-Radius / Impact Prediction

> Advisory — from `twin-graph.sh`, subordinate to `CLAUDE.md`.

| Touched Subsystem | Depends On | Depended-on-by | Source Contract | Incident History |
|-------------------|-----------|----------------|-----------------|------------------|
| `kernel/src/loop/loop.ts` | internal.ts, queue.ts, steps.ts, types.ts, wakeups.ts, sessions/types.ts, 007_event_loop.ts | docs/ARCHITECTURE.md, api/server.ts, kernel.ts | — | — |
| `kernel/src/loop/steps.ts` | internal.ts, types.ts, 007_event_loop.ts | docs/ARCHITECTURE.md, loop.ts, tools/server.ts | — | — |

**Predicted ripple beyond directly-touched files:** `kernel/src/api/server.ts` (stop-all/resume call `loop.stop()`/`loop.start()` — behaviour unchanged, covered by `kernel/test/api.test.ts` / `kill-switch.test.ts`), `kernel/src/kernel.ts` (starts/stops the loop), `kernel/src/tools/server.ts` (runStep callers — AC4/AC5 change no observable result for its JSON-safe returns; run `kernel/test/kernel-tools.test.ts`).

## Skill References
- `skills/unit-testing/SKILL.md` — injected clock/scheduler tests, both mismatch directions.
- `skills/error-handling/SKILL.md` — one notification per failure, error identity across layers.

## Risk Assessment
| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| AC4 changes replay for existing `work_steps` rows | MEDIUM | LOW | Planning-time caller audit: the only `runStepAsync` caller passes a constant `rerunnable: true` and its rows were stored `1`; `runStep` never leaves a `started` row (one transaction). Worker re-greps `runStep(`/`runStepAsync(` before switching and states the result in the PR body | Requirement "Risks" |
| AC3 fix drops the interrupted notify on the direct (tools) path, so an interrupted kernel-tool step notifies nobody | HIGH | LOW | AC3 requires a test on both paths: loop path ⇒ exactly one notify; direct `runStep`/`runStepAsync` ⇒ exactly one notify | Phase 3 |
| AC3 fix keys on `instanceof WorkStepInterruptedError` and misses a handler that wraps/re-throws a different error, giving two notifies again | LOW | LOW | Document in `EventHandler` doc that re-throwing the step's error keeps one notify; a wrapped error is the handler's own failure and gets the loop's notify (acceptable: different fact) | Phase 3 |
| AC3 skips the loop notify for a `WorkStepInterruptedError` whose step mark was rolled back by an outer transaction (handler called `ctx.runStep` inside `store.transaction`), so the owner gets ZERO notifications (today: one) | HIGH | LOW | Skip the loop notify only when the read-back shows the step `failed:interrupted` (committed); a nested-transaction loop-path test asserts exactly one notify | Plan Review attempt 2 (MEDIUM) |
| AC1 generation token breaks the existing `start()` idempotency or `stop()`-during-tick test | MEDIUM | LOW | Keep `start()` idempotent while started; run the full `loop-queue.test.ts` suite; add the unawaited `stop()`→`start()` test | Phase 3 |
| AC5 round-trip changes a `tools/server.ts` result shape | LOW | LOW | All tool results are plain JSON objects; `kernel-tools.test.ts` covers them | Phase 3 |
| Doc edits break `scripts/check-docs.sh` | LOW | LOW | Run `bash scripts/check-docs.sh` locally | Phase 3 |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-05-h06-event-loop-correctness.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-05T04:31:30Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/33
- **Branch:** feature/hardening-h06-event-loop-correctness
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** H06 AC1-AC6: per-chain generation token (one timer chain across an unawaited stop->start); a past-or-now retryAt parks for DEFAULT_PARK_MS; #fail reads back a committed failed:interrupted mark so one crash gives one notify on every path (event_failed carries the step key); claim() replays on the stored rerunnable; runStep/runStepAsync return the JSON round-trip on the first call; idempotency_key per tool documented. Single-agent worker, one commit (bf8d527); 717 tests green. Phase 4.5 iteration 1 PASS (diff_review, adversarial repros held); 4 findings dismissed below the fix floor (1 MEDIUM crash-window double notify, 3 LOW). risk_classification high_risk=true (size 473 lines, advisory).

## Not verified
- **kernel/test/fixtures/crash-harness.mjs live kill -9 run** — ran only as the normal suite does (2 gated tests skipped); the harness's step is never left started across a kill (subtask 1)
