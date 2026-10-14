SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/loop/types.ts"
invariants:
  - "EventKind is a closed set checked in code (phase 1: 'wakeup' | 'message'); there is no SQL CHECK so a later phase adds a kind without a table rebuild."
  - "Internal events (e.g. notify) are audit rows in events only: logged, never queued, and not EventKinds."
  - "QueueStatus is exactly pending | done | failed, matching the event_queue CHECK in migration 007."
  - "The EventHandler contract is at-least-once delivery: handlers must make their own effects idempotent through ctx.runStep / ctx.runStepAsync keyed on the event id."
  - "StepOptions.noEffect is the caller's statement that fn had no effect; absent, every rejection is failed:error (terminal for the key)."
dependencies:
  - "kernel/src/sessions/types.ts"
  - "kernel/src/store/store.ts"
behavioral_specs:
  - "isEventKind(value) is true only for strings in EVENT_KINDS."
  - "Handler outcomes: resolve -> done; AdmissionRefusedError -> parked (pending until retryAt) with the originating runStepAsync step released; anything else -> failed + one notify."
  - "EventLoopDeps defaults: now = new Date(), schedule = setTimeout/clearTimeout, tickMs = 1000."
incident_history:
  - {date: "2026-10-02T11:45:00Z", kind: self_heal_fix, summary: "self-heal fixed 1 issue(s) in kernel/src/loop/types.ts", source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"}
provenance:
  derived_from: "a03facf63cf82f37698883bdf26dfa1465d181df (git diff origin/main...a03facf)"
  written_at: "2026-10-02T11:45:00Z"
  source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"
