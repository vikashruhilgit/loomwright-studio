SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/loop/wakeups.ts"
invariants:
  - "A wake-up fires at most once by id: the pending->fired UPDATE (guarded on status='pending') and the queued wakeup event (sourceRef 'wakeup:<id>', unique) commit in one transaction, so a crash or two racing ticks cannot fire it twice."
  - "A wake-up due while the kernel was down fires on the first tick after restart."
  - "scheduleWakeup validates before any write: at must be an ISO-8601 instant with Z or an offset (local times refused), reason 1..MAX_WAKEUP_REASON (500) chars and non-blank, task_id (if given) must exist; else TypeError."
  - "Wake-up meaning belongs to the handler; budget-written rows (cap_reset:*, cap_recheck:*) fire the same way with no special-casing."
  - "Only pending rows fire: a row the budget module marked superseded (replaced by a later cap wake-up of the same provider and limit type) never fires."
  - "A cap_* wake-up means 'ask admission again', never 'the park ended': a handler must not release parked work on it; the park ends only when admission admits."
dependencies:
  - "kernel/src/loop/internal.ts"
  - "kernel/src/loop/queue.ts"
  - "kernel/src/store/migrations/007_event_loop.ts"
behavioral_specs:
  - "scheduleWakeup inserts a pending row plus a wakeup_scheduled audit row in one transaction and returns {wakeupId, dueAt} with dueAt normalized to UTC milliseconds; a past time is allowed and fires next tick."
  - "fireDueWakeups fires every pending row with due_at <= now, ordered by due_at then id, queuing payload {wakeupId, reason, dueAt}, and returns [{wakeupId, queueId}] for rows it actually fired."
provenance:
  derived_from: "e3abd74 (git diff origin/main...HEAD on feature/hardening-h05-budget-cap-park-keys)"
  written_at: "2026-10-05T01:45:00Z"
  source: "53058ecd-5cba-4796-a71a-6fb922c1e275"
