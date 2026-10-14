SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/loop/queue.ts"
invariants:
  - "An event is written to SQLite before anything acts on it: the event_queue row and its event_enqueued audit row commit in one transaction (a savepoint when nested)."
  - "enqueueEvent validates before any write: kind must be in EVENT_KINDS, payload must be a plain JSON object, sourceRef must be a non-empty string or null; otherwise TypeError."
  - "sourceRef is the only dedupe: a second enqueue with an existing sourceRef writes nothing and returns {id: <first row id>, created: false}."
  - "enqueueMessage requires non-empty (trimmed) text and an agent that is a non-empty string or null; payload is exactly {text, agent} with kind 'message' and no sourceRef."
  - "nextPendingRow returns only status='pending' rows with id > afterId and not_before NULL or <= now, ordered by id (no other ordering)."
dependencies:
  - "kernel/src/loop/internal.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/src/store/migrations/007_event_loop.ts"
behavioral_specs:
  - "toQueuedEvent throws TypeError when a stored payload_json is not a JSON object (the loop then fails that row)."
  - "getQueueRow returns the stored row or undefined."
  - "enqueueMessage is the entry point the API/CLI (item 08) call."
provenance:
  derived_from: "a03facf63cf82f37698883bdf26dfa1465d181df (git diff origin/main...a03facf)"
  written_at: "2026-10-02T11:45:00Z"
  source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"
