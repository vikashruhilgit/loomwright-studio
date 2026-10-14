SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/test/fixtures/crash-harness.mjs"
invariants:
  - "Test-only composition: nothing in kernel/src/ imports or knows about it, so the shipped daemon can reach none of its handlers, stand-in query or fault injection."
  - "Runs as its own node process against the BUILT kernel (<outDir>/kernel.js etc.), not the .ts sources."
  - "The --fault task-create SIGKILL is installed only here, after `INSERT INTO tasks` runs and before runStep's transaction commits, proving the step/task/event commit atomically."
  - "Resume, never duplicate: a redelivered message event resumes the session recorded by the non-rerunnable start-session step instead of starting a second one; the stand-in calls kernel_task_create with the same idempotency key on resume and must get the first task back."
  - "The API token is held in memory only (memoryKeychain), never written to the real Keychain; --live reads the subscription token through the real Keychain READ path only."
  - "stdout carries exactly one line {\"ready\":true,\"pid\":<pid>} once the kernel is up; SIGTERM stops the kernel gracefully and exits 0 (1 on stop failure)."
  - "Never a silent skip: a first launch waits (up to LEADER_RECORDED_TIMEOUT_MS = 5000) until the session row records leader_started_at before calling the tool, and exits 1 with a named crash-harness: precondition failed error otherwise, because the async leader probe could otherwise race the kill -9."
  - "The --fault task-create backstop re-checks, after the INSERT runs and before the SIGKILL, that no session row has a pgid with a null leader_started_at, and fails the precondition (exit 1) if one does."
dependencies:
  - "kernel/src/kernel.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/loop/queue.ts"
  - "kernel/src/api/token.ts"
  - "kernel/src/auth/keychain.ts"
behavioral_specs:
  - "Args: --out-dir, --data-dir, --cwd required; --leader required without --live; optional --plugin-dir, --sleep-ms (default 30000), --enqueue, --fault task-create, --live; unknown args throw."
  - "Deterministic mode replaces SDK query with a stand-in that spawns a real process group led by --leader via spawnClaudeCodeProcess, uses a stub auth provider, and passes handlers {message} to startKernel with stopGraceMs 100."
  - "--enqueue enqueues one message event in openStore before startKernel starts the loop."
  - "standInQuery takes leaderStartedAt(sdkSessionId), which reads sessions.leader_started_at by sdk_session_id from the harness's own store handle."
provenance:
  derived_from: "c044695c2032cc2b2e598d20fab41d2facb41142 (git diff origin/main...c044695)"
  written_at: "2026-10-04T17:15:00Z"
  source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"
