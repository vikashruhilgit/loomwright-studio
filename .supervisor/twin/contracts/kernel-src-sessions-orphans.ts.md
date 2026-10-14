SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/sessions/orphans.ts"
invariants:
  - "A leaf module with no Agent SDK import (imports only the Store type), shared by the session manager's abandon check and the loopback API's /status."
  - "Read-only: it only runs SELECTs against sessions and events; it never writes, probes or signals."
  - "The latest orphaning reason is the payload reason of the newest event (by id DESC) among session_status with to = orphaned, session_reap_deferred and session_resume_refused for that session; null when none exists or the value is not a string."
dependencies:
  - "kernel/src/store/store.ts"
behavioral_specs:
  - "latestOrphanReason(store, id) returns that reason whatever the row's status, or null."
  - "orphanedSessions(store) lists every status = 'orphaned' row ordered by id as {id, agent, pgid, reason, updated_at}."
provenance:
  derived_from: "c044695c2032cc2b2e598d20fab41d2facb41142 (git diff origin/main...c044695)"
  written_at: "2026-10-04T17:15:00Z"
  source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"
