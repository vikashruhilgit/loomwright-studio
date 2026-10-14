SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/loop/steps.ts"
invariants:
  - "Exactly once holds ONLY for SQLite effects committed inside runStep's single transaction (started write + fn + done write); external effects are at most once, never exactly once."
  - "A done key returns the stored JSON result without calling fn; a failed key throws WorkStepFailedError without calling fn (failed is terminal per key)."
  - "A started row with no in-flight call in this process is a crash leftover: re-run only when declared rerunnable, otherwise marked failed:interrupted with exactly one notify (work_step_interrupted) and WorkStepInterruptedError, committed before the throw."
  - "runStep refuses an async fn (thenable result -> TypeError, rolled back) and refuses a key already in flight via runStepAsync in this process."
  - "runStepAsync commits started before awaiting fn and done after; a rejection becomes failed:error unless the caller's noEffect predicate returns true, in which case a fresh claim is deleted (released) and a re-run crash leftover stays started."
  - "A throwing noEffect predicate is treated as false (safe default failed:error). The module never decides which errors mean no effect; the caller does."
  - "Concurrent runStepAsync calls for the same key in one process share one promise; fn runs once."
dependencies:
  - "kernel/src/loop/internal.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/src/store/migrations/007_event_loop.ts"
behavioral_specs:
  - "If runStep's fn throws, the transaction rolls back, no row remains, and a later call runs fn again."
  - "getWorkStep reports label failed:<reason> for failed rows, result only when done, rerunnable as boolean."
  - "A step with an undefined result stores result_json NULL."
incident_history:
  - {date: "2026-10-02T11:45:00Z", kind: self_heal_fix, summary: "self-heal fixed 1 issue(s) in kernel/src/loop/steps.ts", source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"}
provenance:
  derived_from: "a03facf63cf82f37698883bdf26dfa1465d181df (git diff origin/main...a03facf)"
  written_at: "2026-10-02T11:45:00Z"
  source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"
