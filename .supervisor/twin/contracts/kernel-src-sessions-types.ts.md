SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/sessions/types.ts"
invariants:
  - "SessionStatus includes abandoned; TERMINAL_STATUSES is exactly completed, failed, failed:auth, stopped, abandoned. interrupted and orphaned are non-terminal."
  - "abandoned is reachable only from an orphaned row whose latest orphaning reason was leader_unverified (abandonSession); the kernel never resumes it, re-examines it or signals its group."
  - "SessionErrorCode includes not_abandonable; codes are stable, messages are for humans."
  - "SessionManagerDeps.readGroupLeaderAsync is the non-blocking leader probe at spawn and must reject, never resolve absent, when ps failed."
  - "ToolPolicy docs state that a Bash prefix allowlist stops chaining but NOT a program that runs other programs (find, xargs, env, git, npx, npm, sed, awk, sh, bash); the kernel adds no blocklist (invariant 1)."
  - "AllowedPermissionMode excludes bypassPermissions (D5). Imports from the Agent SDK are type-only."
dependencies:
  - "kernel/src/auth/types.ts"
  - "kernel/src/store/store.ts"
behavioral_specs:
  - "isTerminalStatus(status) is true exactly for TERMINAL_STATUSES members."
  - "SessionRow.leader_started_at is written asynchronously after pgid and may be null; kill_incomplete_at flags a terminal row for kill retry."
  - "MAX_RESUME_ATTEMPTS = 3, DEFAULT_STOP_GRACE_MS = 2000."
provenance:
  derived_from: "c044695c2032cc2b2e598d20fab41d2facb41142 (git diff origin/main...c044695)"
  written_at: "2026-10-04T17:15:00Z"
  source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"
