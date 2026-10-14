SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/loop/internal.ts"
invariants:
  - "Not part of the loop module's public surface; shared only by the loop and the kernel tools."
  - "appendEvent always writes actor 'kernel' rows to the append-only events table."
  - "normalizeInstant accepts only an ISO-8601 date-time with an explicit Z or +/-hh:mm offset and returns UTC ISO with milliseconds; anything else (including offset-less local time) returns undefined."
  - "Free text copied into events/queue rows is clipped to MAX_EVENT_TEXT (2000) chars with an ellipsis."
dependencies:
  - "kernel/src/store/store.ts"
behavioral_specs:
  - "errorMessage returns err.message for an Error, else String(err)."
  - "NO_REF is {sessionId: null, taskId: null}."
provenance:
  derived_from: "a03facf63cf82f37698883bdf26dfa1465d181df (git diff origin/main...a03facf)"
  written_at: "2026-10-02T11:45:00Z"
  source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"
