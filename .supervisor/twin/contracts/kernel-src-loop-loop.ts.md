SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/loop/loop.ts"
invariants:
  - "EventLoop is mechanism only: it has no handler of its own and invents no behaviour for a kind nobody handles (an unhandled kind is marked done with an event_unhandled audit row)."
  - "A queue row is marked done only after its handler resolved; the status update and its audit row (event_done / event_unhandled / event_parked / event_failed) commit in one transaction, each UPDATE guarded on status = 'pending'."
  - "An AdmissionRefusedError parks the row (stays pending, not_before = normalized retryAt or now + DEFAULT_PARK_MS of 1h, attempts + 1) with NO second notify (D17: park, no retry loop)."
  - "Any other handler error marks the row failed (attempts + 1, clipped last_error) with exactly one event_failed and one notify row, and the loop continues: a failing event never blocks the queue."
  - "Rows are processed strictly in increasing id order within a tick; a row parked this tick is not revisited in it, a row a handler enqueues (higher id) is processed in the same tick."
  - "tick() is single-flight (an overlapping call returns the running tick); start()/stop() are idempotent; stop() finishes the current event and starts no other."
  - "ctx.runStep / ctx.runStepAsync keys are scoped to event:<id>:<name>; ctx.runStepAsync always treats AdmissionRefusedError as noEffect so a refused step is released and re-run on redelivery."
  - "Handlers are copied at construction; the caller cannot swap handlers under a running loop. tickMs must be a positive finite number."
dependencies:
  - "kernel/src/loop/queue.ts"
  - "kernel/src/loop/steps.ts"
  - "kernel/src/loop/wakeups.ts"
  - "kernel/src/loop/internal.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/store/migrations/007_event_loop.ts"
behavioral_specs:
  - "Each tick first calls fireDueWakeups(now), then drains eligible pending rows (not_before NULL or <= now) and returns TickResult {wakeupsFired, done, unhandled, parked, failed}."
  - "Delivery is at least once: a crash after handler effects and before done redelivers the row after restart."
  - "A tick error from the background loop is recorded as a loop_error audit row (best effort) and the next tick is still scheduled while started."
incident_history:
  - {date: "2026-10-02T11:45:00Z", kind: self_heal_fix, summary: "self-heal fixed 1 issue(s) in kernel/src/loop/loop.ts", source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"}
provenance:
  derived_from: "a03facf63cf82f37698883bdf26dfa1465d181df (git diff origin/main...a03facf)"
  written_at: "2026-10-02T11:45:00Z"
  source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"
