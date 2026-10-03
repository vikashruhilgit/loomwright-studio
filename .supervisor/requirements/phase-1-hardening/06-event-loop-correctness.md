# H06: event loop and work steps behave the same on every path

## Status: ready

**Priority:** MVP · **Latent: none of these is reachable from the shipped daemon today (no handlers), all are reachable once playbooks add handlers**

## Story

As the owner, I want the event loop's timer, parking, failure notices and work-step replay to behave the same on every call path, so that the first playbook handler doesn't inherit doubled ticks, notification spam or replay results that change type.

## Evidence (verified against `main` at 4429d4b on 2026-10-03; F07-1..5 reproduced)

- **F07-1 (still present).** `kernel/src/loop/loop.ts:83-105`: `stop()` clears `#started`, so `start()` passes its guard. The old chain's `.finally(() => { if (this.#started) this.#cancel = this.#schedule(...) })` then reschedules next to the new chain. Two timer chains run, and `#cancel` tracks only one. The only production `stop`→`start` sequence (`POST /stop-all` → `POST /resume`, `api/server.ts:265,277`) awaits `stop()` through `serialized`, so it's safe today.
- **F07-2 (still present).** `loop.ts:197-199` (`#park`): `normalizeInstant(err.retryAt) ?? new Date(now + DEFAULT_PARK_MS)` has no floor. A past `retryAt` adds one `event_parked` row on every tick. Production admission only returns future times (`budget/internal.ts:114`).
- **F07-3 (still present).** `steps.ts:141-143` (`markInterrupted`) appends a `work_step_interrupted` notify. The rethrown `WorkStepInterruptedError` then reaches `#fail` (`loop.ts:140,218`), which appends a second notify (`event_failed`), so one crash produces two notifications.
- **F07-4 (still present).** `steps.ts:170-182`: `claim()` decides re-runnability from the caller's current `opts.rerunnable`. The stored `work_steps.rerunnable` is read only by `getWorkStep` (`:107`), although the migration doc says the column records the value "when it was started" (`007_event_loop.ts:22`).
- **F07-5 (still present).** `runStep` returns the live value on the first call (`steps.ts:264`) and `parseResult(row.result_json)` on a repeat (`:176`); `runStepAsync` does the same at `:309,324`. A `Date` comes back as a Date the first time and a string afterwards. Current callers in `tools/server.ts` return JSON-safe values, but the loop context exposes `runStep` to future handlers.
- **F07-6 (still present, docs).** `docs/ARCHITECTURE.md:65` says "each tool that creates something takes a caller-chosen `idempotency_key`". In `tools/server.ts`, `kernel_task_update` takes the key as optional (`:111`) and `kernel_request_stop`, which creates nothing, requires one (`:128`).

## Acceptance criteria

1. **Given** `stop()` followed by `start()` without awaiting the stop, during a running tick, **when** the tick finishes, **then** exactly one timer chain is live and `stop()` cancels it. A per-chain generation token, or an equivalent, stops the old chain from rescheduling. A test reproduces the old double chain and now sees one.
2. **Given** a refusal whose `retryAt` is now or in the past, **when** the event is parked, **then** `not_before` is later than now: the past `retryAt` is treated as missing (`DEFAULT_PARK_MS`) or floored. Repeated ticks add no further `event_parked` rows until that time.
3. **Given** a crash-interrupted step that isn't re-runnable, **when** the handler's event fails, **then** the owner gets exactly one notification, and both facts (the interrupted step and the failed event) are still recorded as events.
4. **Given** a work step stored with one `rerunnable` value and replayed by a caller passing another, **when** `claim()` decides, **then** it uses the stored value, as the migration doc says. A test covers both mismatch directions.
5. **Given** `runStep`/`runStepAsync` returning a non-JSON value, **when** it is called for the first time and then repeated, **then** both calls return the same JSON round-tripped value. Alternatively the type is restricted to JSON-safe values and the compiler enforces it; the implementer picks one and documents it.
6. **Given** `docs/ARCHITECTURE.md:65`, **when** someone reads it, **then** it lists which kernel tools require an idempotency key, which take one optionally and which have none, matching the schemas in `tools/server.ts`.

## Out of scope

Adding playbook handlers. Changing the tick interval or default park length.

## Dependencies

Phase 1 items 01–09 (merged). Independent of H01–H05.

## Risks

- AC 4 changes replay behaviour for existing `work_steps` rows. The only real caller passes a constant `rerunnable: true`, but check that every stored row's value matches what its caller passes before switching.

## Source

Dismissed review findings from run `automate-2026-09-30-211858`, re-verified 2026-10-03: `proposed/…--07-event-loop-and-kernel-tools-24803c--dismissed-summary.md` entries 1–6.
