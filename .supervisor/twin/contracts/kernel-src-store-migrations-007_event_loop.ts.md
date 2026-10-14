SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/store/migrations/007_event_loop.ts"
invariants:
  - "Migration version 7 (event_loop), registered last in kernel/src/store/migrations/index.ts."
  - "event_queue holds the loop's processing state because events is append-only; status CHECK is pending/done/failed; source_ref is UNIQUE (the dedupe anchor for derived rows); kind has no CHECK so kinds are added in code without a rebuild."
  - "work_steps gains failure_reason (interrupted | error) and rerunnable INTEGER NOT NULL DEFAULT 0; the existing work_steps status CHECK is untouched."
dependencies:
  - "kernel/src/store/migrations/types.ts"
behavioral_specs:
  - "Creates index event_queue_status_id on (status, id) to support the id-ordered pending scan."
  - "enqueued_at defaults to ISO-8601 UTC with millisecond precision."
provenance:
  derived_from: "a03facf63cf82f37698883bdf26dfa1465d181df (git diff origin/main...a03facf)"
  written_at: "2026-10-02T11:45:00Z"
  source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"
