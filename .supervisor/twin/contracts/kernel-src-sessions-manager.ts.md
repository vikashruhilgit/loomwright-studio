SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/sessions/manager.ts"
invariants:
  - "SCOPE NOTE: derived from the item-07 diff (the mcpServers seam), the H04 session-manager-hardening diff (abandon, reaper/kill-retry re-read, async leader probe, stop-all ended_on_its_own, auth-timer cancel) and the H05 cap-park-keys diff (AdmissionRequest provider) only; not a full contract for the session manager."
  - "The optional SessionManagerOptions.mcpServers factory is called once per launch attempt (start and every resume retry), never once per start/resume, with {sessionId (the sessions row id, kept by a resume), agent, task}."
  - "When the factory is absent, no mcpServers option is passed to query() at all."
  - "Tool gating is unchanged by the factory: the PreToolUse gate and the session's ToolPolicy still decide which mcp__kernel__* tools may run."
  - "abandoned is a terminal status (in TERMINAL_STATUSES): the kernel never resumes it (resumeSession accepts only interrupted or orphaned), never re-examines it (#reapAll selects only starting/running/orphaned) and never retries its kill (#markRow clears kill_incomplete_at when moving to abandoned or interrupted)."
  - "abandonSession never signals or probes a process group: it only reads the row and latestOrphanReason, then moves orphaned -> abandoned via #markRow in one transaction with a session_status event {reason: abandoned_by_owner, by: owner, via, pgid, orphaned_reason}."
  - "abandonSession refuses with SessionError and writes nothing: invalid_params (id not a safe positive integer, via not cli|api), not_abandonable (row live in this manager, row being reaped right now, status not orphaned, latest orphaning reason not leader_unverified, or the row changed status before the write), not_found."
  - "The reaper (#reapAll) re-reads each row just before examining it and skips it, unprobed and unsignalled, unless it still has the status and pgid that were read; #reapingRow marks the row under examination for the duration of #reapOne so abandonSession can refuse it."
  - "The terminal kill retry (#retryTerminalKills) re-reads each row and skips it (no probe, no signal, no event) unless it still has the status, pgid and a non-null kill_incomplete_at that were read."
  - "The leader probe at spawn is async (#readLeaderAsync, default readGroupLeaderAsync) and not awaited; its UPDATE of leader_started_at is guarded by WHERE id = ? AND pgid = ?, so a later attempt's group is never paired with this leader; a failed, timed-out or absent probe leaves leader_started_at null and #recordLeaderStart never rejects."
  - "When only deps.readGroupLeader is injected, the async probe wraps it, so a test fake never reaches the real ps; the reaper and resume's group check keep the synchronous #readLeader."
  - "A stop-all outcome carries ended_on_its_own: true only when the session had already ended before the stop (a verdict set before any stop, or an already-terminal failed:auth live entry) AND the stop confirmed its group gone (!groupMayBeAlive); a failed:auth whose group may be alive is thrown as kill_incomplete and reported stop_failed."
  - "A stop-all of a live failed:auth session cancels its pending auth kill timer (attempt.authTimer) after the kill, so the timer never runs after the stop returned."
  - "Every AdmissionRequest the manager builds (start, resume, and the resume-retry admission re-check) carries provider = this.#auth.id (the key admission checks parks on) beside account = this.#auth.account (display label only); the row's frozen auth_account is never used for admission."
  - "Admission runs before the group check on resume, so a refused resume leaves the row and its events untouched."
dependencies:
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/spawner.ts"
  - "kernel/src/sessions/orphans.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/loomwright-path.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/auth/types.ts"
behavioral_specs:
  - "getSession(id) and stopSession(id) are the two methods the kernel tools server depends on; stopSession is idempotent."
  - "abandonSession(id, {via}) returns 'abandoned' on success; via is 'cli' or 'api' (AbandonVia)."
  - "stopAll() returns one StopAllOutcome per live session: {id, status}, {id, status, ended_on_its_own: true}, or {id, status: 'stop_failed', error}."
  - "reapOrphans() returns the in-flight reap when called during one; a row whose re-examination changes nothing appends session_reap_deferred instead of a second status event."
  - "A resume retry whose admission re-check refuses records payload {reason: admission_refused, refusal, retry_at, attempt}."
incident_history:
  - {date: "2026-10-04T17:15:00Z", kind: self_heal_fix, summary: "self-heal fixed 2 issue(s) in kernel/src/sessions/manager.ts", source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"}
provenance:
  derived_from: "e3abd74 (git diff origin/main...HEAD on feature/hardening-h05-budget-cap-park-keys)"
  written_at: "2026-10-05T01:45:00Z"
  source: "53058ecd-5cba-4796-a71a-6fb922c1e275"
