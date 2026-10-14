SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/sessions/spawner.ts"
invariants:
  - "The only module under kernel/src/sessions/ that imports node:child_process; every process-group operation lives here. Its Agent SDK import is type-only (SpawnOptions)."
  - "spawnInNewProcessGroup spawns the CLI detached (its own process group) and never passes options.signal to spawn(); on abort it kills the whole group with killGroupUntilGone."
  - "The SDK abort listener is removed on the child's exit event (after Node reaps the leader), never before, so a late abort can never SIGKILL a reused pgid; an already-aborted signal kills at once."
  - "onSpawn(pgid) is called synchronously right after spawn and only for a valid pgid (integer > 1); stderr is always drained."
  - "isValidPgid rejects 0, 1, negatives and non-integers; every signalling function throws RangeError for an invalid pgid."
  - "killGroupUntilGone treats EPERM as not gone yet, never gone; it stops at the first ESRCH and is bounded by a round count (deadline / interval)."
  - "readGroupLeader and readGroupLeaderAsync share the ps command, env (PATH=/usr/bin:/bin, TZ=UTC, LC_ALL=C), the 2 s timeout and leaderFromPs: absent ONLY for exit status 1 with empty stdout and stderr; any other failure throws/rejects LeaderProbeError, never absent."
  - "readGroupLeaderAsync uses execFile and never blocks the event loop."
dependencies:
  - "kernel/src/sessions/types.ts"
behavioral_specs:
  - "KILL_GROUP_DEADLINE_MS = 2000, KILL_GROUP_INTERVAL_MS = 25, LEADER_EXIT_WAIT_MS = 1000, STDERR_TAIL_BYTES = 64 KiB."
  - "killProcessGroup returns true when signalled, false on ESRCH, rethrows anything else; isProcessGroupAlive returns false on ESRCH and true on success or EPERM."
  - "parseLeaderLine parses a ctime-shaped lstart plus comm line printed with TZ=UTC; unparseable output throws LeaderProbeError."
provenance:
  derived_from: "c044695c2032cc2b2e598d20fab41d2facb41142 (git diff origin/main...c044695)"
  written_at: "2026-10-04T17:15:00Z"
  source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"
