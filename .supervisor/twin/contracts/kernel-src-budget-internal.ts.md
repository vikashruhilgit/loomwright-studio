SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/budget/internal.ts"
invariants:
  - "activeParks(store, key, nowIso) takes the provider's stable id (never its label) and returns every cap_state row with status rejected and resets_at null or > nowIso, ordered by rate_limit_type."
  - "Cap wake-up reasons have the typed form <kind>:<providerId>:<rate_limit_type> (capWakeupReason), kind in {cap_reset, cap_recheck}."
  - "scheduleCapWakeup is the only writer of wakeups.status = 'superseded': before inserting, it marks superseded every pending wake-up of the same provider and limit type (both kinds), the same for each alsoSupersede type, and the provider's legacy untyped cap_reset:<id> / cap_recheck:<id> rows; so at most one cap wake-up is pending per provider and type."
  - "A pending row with exactly the same reason and due time is kept, not superseded or duplicated (scheduleWakeupOnce's rule)."
  - "scheduleCapWakeup must be called inside a transaction so the supersede and the insert commit together."
dependencies:
  - "kernel/src/budget/types.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/store/migrations/009_cap_keys_provider_id.ts"
behavioral_specs:
  - "scheduleWakeupOnce(store, reason, dueAt, at) inserts a pending wakeups row and returns true, or returns false when a pending row with the same reason and due_at exists."
  - "scheduleCapWakeup({kind, key, type, dueAt, alsoSupersede?}, at) returns scheduleWakeupOnce's result for reason capWakeupReason(kind, key, type)."
provenance:
  derived_from: "e3abd74 (git diff origin/main...HEAD on feature/hardening-h05-budget-cap-park-keys)"
  written_at: "2026-10-05T01:45:00Z"
  source: "53058ecd-5cba-4796-a71a-6fb922c1e275"
