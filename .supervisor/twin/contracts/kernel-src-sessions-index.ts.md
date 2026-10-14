SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/sessions/index.ts"
invariants:
  - "The public surface of the session layer; it re-exports manager.ts, which loads the Agent SDK at runtime, so SDK-free callers (the studio CLI) must import the leaf modules (spawner.ts, types.ts, orphans.ts) instead of this index."
  - "Exports AbandonVia, ReapResult and StopAllOutcome types from manager.ts, latestOrphanReason/orphanedSessions from orphans.ts, and readGroupLeaderAsync alongside readGroupLeader from spawner.ts."
dependencies:
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/orphans.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/spawner.ts"
  - "kernel/src/sessions/loomwright-path.ts"
  - "kernel/src/sessions/types.ts"
behavioral_specs:
  - "Re-exports only; defines nothing of its own."
provenance:
  derived_from: "c044695c2032cc2b2e598d20fab41d2facb41142 (git diff origin/main...c044695)"
  written_at: "2026-10-04T17:15:00Z"
  source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"
