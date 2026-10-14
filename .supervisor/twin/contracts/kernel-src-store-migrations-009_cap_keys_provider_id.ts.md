SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/store/migrations/009_cap_keys_provider_id.ts"
invariants:
  - "Migration version 9 (cap_keys_provider_id) moves label-keyed cap state to the auth provider's stable id: for each auth_providers row whose account label differs from its id, every cap_state row keyed on the label moves to the id and the label rows are deleted."
  - "On a (account, rate_limit_type) primary-key conflict the more conservative row is kept (fail closed): rejected beats non-rejected; between two rejected rows the later resets_at wins with NULL counting as latest; a tie or neither rejected keeps the existing id row."
  - "Only pending cap_reset:<label> / cap_recheck:<label> wake-ups are rewritten to cap_reset:<id> / cap_recheck:<id>; fired and other non-pending rows are history and untouched."
  - "A label shared by several providers is copied to every one of them (fail closed: every provider that may have been parked stays parked)."
  - "A label equal to ANY provider id is skipped entirely, so moving its rows can never lift that provider's park (fail open avoided); rows keyed on a value that is no provider's label are untouched."
  - "events (append-only) is never modified and sessions.auth_account stays the frozen display label."
  - "Idempotent: re-running on an already-migrated database is a no-op (the kernel writes only ids and typed cap_*:<id>:<type> reasons), which the store integrity check relies on when migrations 8 and 9 re-run."
dependencies:
  - "kernel/src/store/migrations/types.ts"
  - "kernel/src/store/migrations/index.ts"
  - "better-sqlite3"
behavioral_specs:
  - "Registered last in the migrations list (index.ts) after eventsExplicitIdGuard (8)."
  - "up(db) reads auth_providers ordered by id and, per qualifying label, runs moveCapRows then moveWakeups; a provider whose label equals its own id is a no-op."
provenance:
  derived_from: "e3abd74 (git diff origin/main...HEAD on feature/hardening-h05-budget-cap-park-keys)"
  written_at: "2026-10-05T01:45:00Z"
  source: "53058ecd-5cba-4796-a71a-6fb922c1e275"
