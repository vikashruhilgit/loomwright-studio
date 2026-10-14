SYSTEM_CONTRACT:
schema_version: 1
subsystem: "docs/ARCHITECTURE.md"
invariants:
  - "SCOPE NOTE: derived from the item-07 diff (work_steps, wakeups, event_queue table rows; handoff path; Kernel tools phase-1 paragraph; Main loop 'How it is built' paragraph), the item-09 diff (studio CLI line; Auth launchd-agent paragraph) and the H04 session-manager-hardening diff (spawn/leader-probe, reaper and kill bullets; Per-agent permission policy bullet; Kill switch bullet; Loopback API Routes line) only."
  - "The work_steps row must state the exactly-once vs at-most-once limit (exactly once only for SQLite effects in the step's own transaction; external effects at most once, re-run after a crash only when declared re-runnable) and that failed is terminal for a key, matching kernel/src/loop/steps.ts."
  - "The event_queue and Main loop text must match kernel/src/loop/loop.ts: id-order processing, injected handlers only, done only after handler effects commit, unhandled kinds marked done with event_unhandled, admission refusal parks with no second notify (D17, default one hour), other failures marked failed with one notify and never block the queue."
  - "The Kernel tools text must match kernel/src/tools/server.ts: six phase-1 tools, server named kernel, full names mcp__kernel__kernel_*, never auto-added to a tool policy, fresh server per launch attempt, idempotency key scoped <tool>:session-<id>:<key>."
  - "Handoff notes live at memory/<agent>/handoffs/<task>.md (_unassigned / session-<id> fallbacks), matching kernel/src/tools/handoff.ts."
  - "The launchd paragraph must match kernel/src/service/launchd.ts: macOS only; exactly one plist ~/Library/LaunchAgents/com.loomwright.studio.kernel.plist loaded with `launchctl bootstrap gui/<uid>` and removed by uninstall (bootout); nothing else in LaunchAgents/ read or touched."
  - "The launchd paragraph must state KeepAlive = {SuccessfulExit: false} with RunAtLoad (restart after crash or kill -9, not after graceful SIGTERM), absolute node path + built daemon.js, and logs at <dataDir>/logs/kernel.{out,err}.log."
  - "The launchd paragraph must state the plist environment holds only STUDIO_DATA_DIR (always the absolute data dir the logs go under) and, when set, STUDIO_AUTH_PROVIDER, never a token; credentials come from the Keychain at start."
  - "Keychain reachability under launchd without a terminal (Q2) stays documented as an open owner to-do pointing at docs/OPEN_QUESTIONS.md 'Phase 1 exit: live run', not claimed verified."
  - "The studio CLI line must say `service install|uninstall` runs locally and needs no daemon, api.json or Keychain, matching kernel/src/cli/index.ts."
  - "The spawn bullet must say the leader start time is read with an asynchronous ps that never blocks the event loop and is recorded only while the row still records that group, null when ps could not read it, matching the pgid-guarded write in kernel/src/sessions/manager.ts."
  - "The reaper bullet must say an orphaned row is re-examined until its group is gone or the owner abandons it (studio session abandon <id> or POST /sessions/<id>/abandon), allowed only while its latest orphaning reason is leader_unverified; it becomes the terminal abandoned with by: owner and via in its event and its kill flag cleared, and the kernel never signals that group."
  - "The kill bullet must say the SDK-abort listener is removed once the leader exits, so a later abort never signals a possibly reused pgid, matching kernel/src/sessions/spawner.ts."
  - "The Per-agent permission policy bullet must say a Bash prefix allowlist refuses shell control and substitution characters but allowing a program that runs other programs (find, xargs, env, git, npx, npm, sed, awk, sh, bash) grants arbitrary execution, with no kernel blocklist (invariant 1), matching kernel/src/sessions/policy.ts."
  - "The Kill switch bullet must say an outcome carries ended_on_its_own: true only when the session had already ended before the stop and the stop confirmed its group gone, that the stop cancels a pending auth kill timer, and that studio stop --all reports such a session as already ended."
  - "The Routes line must list the orphaned field of GET /status and POST /sessions/<id>/abandon with 400 invalid_id, 404 not_found and 409 <stable code>, and say the studio CLI confirms first unless --yes and refuses without a terminal, matching kernel/src/api/server.ts and kernel/src/cli/index.ts."
dependencies:
  - "kernel/src/loop/loop.ts"
  - "kernel/src/loop/steps.ts"
  - "kernel/src/loop/wakeups.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/src/tools/handoff.ts"
  - "kernel/src/store/migrations/007_event_loop.ts"
  - "kernel/src/service/launchd.ts"
  - "kernel/src/cli/index.ts"
  - "docs/OPEN_QUESTIONS.md"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/spawner.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/api/server.ts"
behavioral_specs:
  - "Documents event_queue as a separate table from the append-only events log, with every queue transition also audited in events."
  - "Documents the kernel as a per-user launchd agent (item 09, D11) installed and removed by `studio service install|uninstall`."
  - "Documents abandoned as the owner-released terminal state of a leader_unverified orphan (H04 AC4)."
incident_history:
  - {date: "2026-10-02T11:45:00Z", kind: self_heal_fix, summary: "self-heal fixed 1 issue(s) in docs/ARCHITECTURE.md", source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"}
  - {date: "2026-10-03T03:01:18Z", kind: self_heal_fix, summary: "self-heal fixed 2 issue(s) in docs/ARCHITECTURE.md", source: "2a862f5f-b84e-4eea-9b81-4865d87034c0"}
provenance:
  derived_from: "c044695c2032cc2b2e598d20fab41d2facb41142 (git diff origin/main...c044695)"
  written_at: "2026-10-04T17:15:00Z"
  source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"
