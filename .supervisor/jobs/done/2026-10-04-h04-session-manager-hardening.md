# Supervisor Job: H04 — session manager: no stray kill, no stuck row, no blocking probe, honest stop-all output

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariant 3 applies: the kill path and the per-role permission policy are part of the fixed safety kernel; invariant 1: the kernel ships mechanism, the user sets policy, so AC2 documents and never blocklists; invariant 2: durable state lives on disk)
- **Git:** clean except the automate engine's trail files (`.supervisor/automate/automate-2026-10-03-180512.md` and `.supervisor/postmortem/results.jsonl`, modified) and two untracked owner files (`.supervisor/requirements/h01-launchd-start-failure-and-reinstall-plan.md`, `.supervisor/requirements/phase-1-hardening/_BACKLOG.md`). Never stage any of them in this job; commit with explicit paths only. Branch: main @ ae6823f
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 (CI: ubuntu-latest, `node-version: 22`; `.github/workflows/ci.yml` runs `bash scripts/check-docs.sh`, then in `kernel/` `npm ci`, `npm run typecheck`, `npm test`, `npm run build` — tests run BEFORE the build, so no test may depend on `kernel/dist`)
- **Blockers:** 0 | **Warnings:** 1 (dirty automate trail files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1-hardening/04-session-manager-hardening.md
- **Base commit:** ae6823ff6cd2dee90fc48f36cc799936d255d3d8

## Feasibility
- **Verdict:** GO
- Tech stack — GO: strict TypeScript kernel (NodeNext, vitest), `@anthropic-ai/claude-agent-sdk`, better-sqlite3; no new package (`node:child_process` `execFile` for the async probe, `node:readline` or an injected prompt for the CLI confirmation).
- Dependencies — GO: none new.
- Architecture fit — GO: every change stays inside the session manager's existing seams (spawner hooks, `SessionManagerDeps`, `StopAllOutcome`, the loopback API's route table, the CLI's `parse`/`runCli`). `sessions.status` has no CHECK constraint (`kernel/src/store/migrations/001_initial.ts:36`), so a new terminal status needs no migration.
- Scope — GO: one worker; ~9 source/doc files modified, ~5 test files modified, 0–1 created.
- Hard blockers — none.

## Task
**Goal:** The session manager never signals a process group after its CLI child has exited (the SDK's forwarded-abort listener is removed on exit); a session row stuck `orphaned` with `leader_unverified` can be abandoned by the owner (CLI with confirmation + API route) into a new terminal status without the kernel ever signalling its group; the leader start-time probe at spawn/resume no longer blocks the event loop on `ps`; the tool-policy docs say plainly that allowing a program that runs other programs grants arbitrary execution; `studio stop --all` reports a session that had already ended on its own as already ended, from a field the manager puts in the stop-all outcome; and a kill-switch stop of a `failed:auth` session cancels its auth timer, with the `stopAll` comment corrected.

**Problem Statement:** The owner needs the kill path and the permission policy to do what their docs claim, because they are the safety kernel (invariant 3): a late SDK abort can SIGKILL a reused pgid, an unverifiable orphan row has no exit but a daemon restart, a hung `ps` freezes the kernel for up to 2 s per spawn, an allowlisted `find`/`git`/`sh` silently grants arbitrary execution, and `stop --all` exits non-zero for a session that simply failed on its own.

## Acceptance Criteria
- [ ] AC1 — Given a session child that has exited, when the SDK later aborts the forwarded signal, then no signal is sent: `spawnInNewProcessGroup` removes its `abort` listener when the child exits (`child.once("exit", …)` → `options.signal.removeEventListener("abort", killGroup)`), and never before. A test spawns a short real child (`/bin/sh -c "exit 0"` via `spawnInNewProcessGroup`), waits for `exit`, aborts the controller, and asserts no kill was sent (e.g. the group was never signalled after exit — spy `process.kill`, or assert the listener count on the signal is 0). The existing "kills the whole group when the SDK's forwarded signal aborts" test (`kernel/test/sessions-process-group.test.ts:152`) stays green (abort BEFORE exit still kills).
- [ ] AC2 — Given `ToolPolicy`'s doc comment (`kernel/src/sessions/types.ts:41-58`), `decideToolUse`'s doc comment (`kernel/src/sessions/policy.ts:16-37`) and `docs/ARCHITECTURE.md`'s permission-policy text (the "Per-agent permission policy" bullet under "## Safety kernel (fixed; D5)"), when someone reads them, then they say that a Bash prefix allowlist matches at word boundaries and refuses shell control/substitution characters, BUT that allowing a program which runs other programs grants arbitrary execution, listing examples: `find` (`-exec`), `xargs`, `env`, `git` (aliases, `-c`, hooks), `npx`, `npm` (scripts), `sed` (`e`/`w`), `awk` (`system()`), `sh`, `bash`. The text says the kernel adds no blocklist because the policy is the user's (invariant 1). No code behaviour changes for AC2; `kernel/test/sessions-policy.test.ts` stays green unchanged.
- [ ] AC3 — Given a spawn or a resume attempt, when the leader's start time is read, then the event loop is not blocked by a synchronous child process: the probe in `#spawnFor`'s `onSpawn` (`kernel/src/sessions/manager.ts:950-958`, today `#leaderStartIso` → `readGroupLeader` → `execFileSync("/bin/ps", …, {timeout: 2000})`, `spawner.ts:252-272`) becomes asynchronous (an async `readGroupLeader` variant using `execFile` with the same args, env, 2 s timeout and the same absent/throw semantics), started from `onSpawn` without being awaited there. `pgid` is still written synchronously inside `onSpawn` (AC2 of item 05 — unchanged); `leader_started_at` is written when the probe resolves, guarded so it lands only while the row still records that pgid (`… WHERE id = ? AND pgid = ?`), and a probe that fails, times out or reports `absent` leaves it `null` exactly as today. A store write that throws after the kernel closed the store is swallowed. A test injects a slow async probe (e.g. one that resolves only when the test releases it) and proves other work runs meanwhile (e.g. `startSession` resolves and a `setImmediate`/timer callback fires before the probe resolves), then that `leader_started_at` lands once it resolves; the existing test `kernel/test/sessions.test.ts:1335-1342` ("records the leader's start time with the pgid") asserts `leader_started_at` right after `await startSession` — make it `await vi.waitFor(…)` (and likewise any other assertion that read it synchronously); a second test proves a probe resolving after the row's pgid changed (a later resume attempt) does not overwrite the new attempt's row. **The phase 1 exit test stays deterministic:** `kernel/test/crash-resume.test.ts` ("kill -9 mid-session, then restart (phase 1 exit, deterministic)") asserts the restarted kernel's reaper logs `group_killed` (:124-129), which it does only when `leader_started_at` was recorded before the kill -9; with the probe async, the kill can race the probe. (a) The AC3 case (:152-171) gates its pre-kill `waitFor` (:155-161) on `leader_started_at IS NOT NULL` too (add the column to `SessionRowView`/`sessionRow`, :76-87). (b) The AC4 case (:174-195) is killed by the harness itself inside the stand-in's `kernel_task_create` INSERT (`kernel/test/fixtures/crash-harness.mjs:68-90`), so no test-side wait can precede it: make it deterministic in the fixture (e.g. the fault fires only once the session row's `leader_started_at` is non-null, and if it is still null at that point the harness fails loudly with a named precondition error instead of letting the reap assertion fail obscurely — or another gate the worker chooses that orders the probe before the fault). Then run `npx vitest run test/crash-resume.test.ts` at least 10 times in a row and record the pass count in the PR body. `kernel/test/exit-live.test.ts` (waits for a `sleep` in the group first) must stay green; run it too.
- [ ] AC4 — Given a session row that is `orphaned` and whose orphaning reason is `leader_unverified`, when the owner runs an explicit abandon action, then the row moves to a new terminal status `abandoned` and a `session_status` event (from `orphaned` to `abandoned`) records who abandoned it (`by: "owner"`, `via: "cli"|"api"`) and when (the event's `at`); the kernel never signals the group (no kill, no `isGroupAlive`/`ps` needed for the decision), and the abandon also clears `kill_incomplete_at` so no later `reapOrphans`/`#retryTerminalKills` ever signals that group. The action is: (a) `SessionManager.abandonSession(id, { via })`; (b) an API route `POST /sessions/<id>/abandon` (authenticated like every route, before any path matching; a path that does not match `^/sessions/(\d+)/abandon$` ⇒ 404 like any unknown path; a matching id that is not a safe positive integer (e.g. `0`, or digits beyond `Number.MAX_SAFE_INTEGER`) ⇒ 400 `{error: "invalid_id"}`; no such row ⇒ 404 `{error: "not_found"}`; refusal ⇒ 409 with a stable error code; success ⇒ 200 with the row's id and new status); (c) a CLI command `studio session abandon <id>` that asks for confirmation on the terminal (`y`/`yes` proceeds, anything else aborts with exit 1 and no request sent) and accepts `--yes` to skip the prompt for scripts; with no TTY on stdin and no `--yes`, it refuses without prompting (exit 2, usage hint) rather than hanging. The action refuses (`SessionError` with a stable code, e.g. `not_abandonable`) any row that is live in this manager, any row whose status is not `orphaned`, and any `orphaned` row whose latest orphaning reason is not `leader_unverified`. The orphaning reason is read from the kernel's own record: the newest event for that session among `session_status` (to `orphaned`), `session_reap_deferred` and `session_resume_refused`, by `id DESC`, and its payload's `reason` must equal `leader_unverified`. `/status` gains an additive `orphaned` list (id, agent, pgid, reason from that same lookup, updated_at) so the owner can find the row to abandon; an older CLI ignores it. `formatStatus` (`kernel/src/cli/index.ts:182-222`) prints an `orphaned` block when the list is non-empty — one line per row with id, agent, pgid and reason, plus a hint that `studio session abandon <id>` releases a `leader_unverified` row — using `?? []` for an older daemon that sends no field (as `kill_unconfirmed` already does). Tests cover: the success path (status, event payload and actor fields, `kill_incomplete_at` cleared, no kill/probe call made), refusal of a live row, a non-orphaned row (e.g. `interrupted`, `failed`), and an `orphaned` row whose reason is `reap_error`/`kill_incomplete`; the API route (200, 409, 404, 401 unauthenticated); `formatStatus` (the `orphaned` block printed when non-empty, absent when empty or when the field is missing); the CLI (`--yes` sends the request, a "no" answer sends nothing, no-TTY-without-`--yes` refuses, a 409/404/400 prints ONE stderr line that includes the API's stable `error` code — e.g. `studio: session 7 not abandoned: not_abandonable` — read from the JSON body, never echoing request text or the token, and exits 1); `resumeSession` refuses an `abandoned` row (`not_resumable`); `reapOrphans` neither re-examines nor signals it.
- [ ] AC5 — Given `studio stop --all` with a session that had already ended on its own (its stream had ended — `live.verdict` set, e.g. `failed` with `result_error`, `completed` — or it was already terminal like `failed:auth`) and whose group the stop confirmed gone, when the output prints, then that session is reported as already ended, not "not confirmed stopped", and the exit code reflects only sessions that are really unconfirmed. The difference is carried in the stop-all outcome, not guessed in the CLI: `StopAllOutcome` (`kernel/src/sessions/manager.ts:120-122`) gains an additive field (e.g. `ended_on_its_own: true`, present only when true) set by the manager when the session's own stream had already ended before the stop AND the group is confirmed gone (`!groupMayBeAlive(attempt)`); a `failed` with reason `kill_incomplete` never carries it. `summarizeStopAll` (`kernel/src/cli/index.ts:157-179`) counts an outcome as already ended when it carries that field, keeps `stopped` as stopped, and treats everything else as unconfirmed; the CLI cannot tell an older daemon from a newer one, so the rule is stated as a union: an outcome is already ended when it carries the field OR its status is in the legacy `ALREADY_ENDED` set (`completed`, `interrupted`, `failed:auth`) — safe, because a new daemon's `completed`/`failed:auth` outcomes that are really ended carry the field anyway, and a `failed:auth` whose group is not confirmed gone is reported `stop_failed`, never `failed:auth`. Document the union in the `summarizeStopAll` comment. `docs/ARCHITECTURE.md`'s kill-switch paragraph says so. Tests: a manager test where a session's result is an error and a stop arrives while its group is being cleaned up (or `stopAll` after its verdict), asserting the outcome carries the field with `status: "failed"`; a CLI test where a `failed` outcome with the field is "already ended" and the exit code is 0, and a `failed` outcome without it is still unconfirmed (exit 1).
- [ ] AC6 — Given a kill-switch stop (`stopAll`, either mode) of a `failed:auth` attempt whose group is confirmed gone, when stop-all settles it, then the auth timer is cancelled (`attempt.authTimer?.()` in `#stopForAll`'s already-terminal branch, `manager.ts:537-551`, after the kill), and the `stopAll` doc comment (`manager.ts:514-523`, "the timer would die with a stopping kernel") describes what actually happens: in kill-switch mode the kernel keeps running, so the stop kills the group now and cancels the pending auth timer. A test asserts the scheduled auth-timer cancel function is called (inject `schedule` and record cancels) and that the timer callback never runs a second kill after `stopAll` returns.

## Implementation Notes (verified at planning time, main @ ae6823f)
**Files read:**
- `kernel/src/sessions/spawner.ts` (277 lines): `spawnInNewProcessGroup` (:102-127) adds `options.signal.addEventListener("abort", killGroup, { once: true })` (:123) and never removes it; the doc comment (:84-101) describes the forwarded signal — update it to say the listener is removed once the leader exits. `readGroupLeader` (:252-272) is synchronous (`execFileSync`, `PS_TIMEOUT_MS = 2_000` :221) — keep it (the reaper and the resume pre-check use it) and add an async sibling with identical parsing (`parseLeaderLine` :228-234) and identical absent/throw rules (`absent` ONLY on exit status 1 with empty stdout and stderr; anything else throws `LeaderProbeError`). This is the only module under `src/sessions/` allowed to import `node:child_process` (header :1-2) — keep it so.
- `kernel/src/sessions/manager.ts` (1609 lines): `StopAllOutcome` (:115-122); `stopAll` + doc (:502-533); `#stopForAll` (:535-553); `#stopLive` (:555-569) — a non-live terminal row returns its status, a non-live non-terminal row throws `not_live` (the F05-8 dead end, :559-562); `resumeSession` (:607-679) refuses anything but `interrupted`/`orphaned` (:616-621) and refuses `leader_unverified` (:637-643, event `session_resume_refused` with `reason` for an `orphaned` row); reaper `#reapAll` (:729-761) selects `starting`/`running`/`orphaned` and writes `session_reap_deferred` with `{reason, pgid}` when nothing changes (:751-753); `#retryTerminalKills` (:771-807) retries terminal rows with `kill_incomplete_at`; `#checkGroup` (:827-838); `#markRow` (:845-860, one transaction with the `session_status` event, writes `ended_at` for a terminal `to`); `#spawnFor`/`onSpawn` (:936-964); `#authFail` (:1175-1193, `attempt.authTimer = this.#schedule(…)`); `#conclude` (:1200-1236, sets `live.verdict` before cleanup); `#stop` (:1268-1291, `stop_requested_after_end` when a verdict exists, :1288); `#killAttemptGroup` (:1311-1335); `#leaderStartIso` (:1378-1386); `#appendEvent` (:1593-1597) hard-codes `actor = 'kernel'` — the abandon event may pass the actor through a small variant or carry `by`/`via` in its payload (the worker's call; the payload must carry them either way).
- `kernel/src/sessions/types.ts` (317 lines): `SessionStatus` (:24-32) and `TERMINAL_STATUSES` (:35) — add `abandoned` to both (and document it beside `interrupted`/`orphaned` in the :13-23 comment); `SessionErrorCode` (:113-120) — add the refusal code; `ToolPolicy` doc (:41-58, AC2); `SessionManagerDeps` (:245-264) — add the async probe dep (e.g. `readGroupLeaderAsync?: (pgid) => Promise<GroupLeader>`). Existing tests inject a sync `readGroupLeader` (e.g. `kernel/test/session-fakes.ts:161`): when only the sync dep is injected, the async probe should default to wrapping it (`async (p) => injectedSync(p)`) so fake-pgid tests never shell out to the real `ps`; otherwise default to the real async probe.
- `kernel/src/sessions/policy.ts` (68 lines): `decideToolUse` doc (:25-37) and the metacharacter note (:16-22) — AC2 wording.
- `kernel/src/sessions/index.ts` (57 lines): public re-exports — export anything new that callers need (e.g. the error code type is already re-exported via types).
- `kernel/src/cli/index.ts` (340 lines): `parse` (:81-89) — add `session abandon <id> [--yes]` (id a positive integer; anything else ⇒ usage, exit 2); `USAGE` (:47) — add it; `ALREADY_ENDED` + `summarizeStopAll` (:148-179, AC5); `runCli` (:238-323) — the request path/method selection (:278-280) and the result printing (:309-317) need the new command; `CliDeps` (:54-70) — add an injectable confirmation (e.g. `confirm?: (question: string) => Promise<boolean>` and `isInteractive?: () => boolean`, defaulting to a `node:readline` prompt on `process.stdin` and `process.stdin.isTTY === true`). Ask for confirmation after the `api.json` pid check and always BEFORE the request is sent (so "no" sends nothing); never print the token.
- `kernel/src/api/server.ts` (348 lines): `ApiServerOptions.sessions` is `Pick<SessionManager, "stopAll">` (:24) — widen to include the abandon method; `routes` (:289-296) is an exact-path table, so add a small matcher for `^/sessions/(\d+)/abandon$` (POST only; GET ⇒ 405 like the others), keeping "authenticate first, then route" (:298-303); the two POSTs are `serialized` (:262-267) — run abandon through the same serializer; `readStatus` (:165-229) — add the `orphaned` list and its `StatusBody` type (:55-106). Abandon refusal ⇒ 409 `{error: "<code>"}`, unknown id ⇒ 404 `{error: "not_found"}`; never echo request text.
- `kernel/src/kernel.ts` (223 lines): wires `startApiServer({ sessions: manager, … })` (:194-197) — the real manager already satisfies the widened `Pick`; reaper runs once at start (:187).
- `kernel/src/tools/server.ts`: uses `Pick<SessionManager, "stopSession" | "getSession">` (:59) — unaffected; confirm it never treats an unknown status as live.
- `docs/ARCHITECTURE.md` (locate sentences by their text; the line numbers below are approximate, ±1): "## Session manager (Q5)" (:80-98) — the orphaned bullet (:85) gains "until the owner abandons it (`studio session abandon <id>`, never signalled)"; the SDK-abort sentence (:86) gains "the listener is removed once the leader exits"; the leader start-time sentence (:84) says the probe is asynchronous; "## Safety kernel" "Per-agent permission policy" bullet (:101) — AC2 text; the kill-switch paragraph (:109) — AC5's "already ended" field. Keep `bash scripts/check-docs.sh` green.
- Tests: `kernel/test/sessions-process-group.test.ts` (AC1 — real child, `spawnOptions`/`startGroup` helpers :103-120), `kernel/test/sessions.test.ts` (AC3, AC4 manager paths; existing `leader_unverified` fixtures at :1012, :1263, :1555, :1658 show how to create such a row), `kernel/test/sessions-stop-all.test.ts` (AC5 manager outcome, AC6 timer; existing `toEqual([{ id, status }])` assertions at e.g. :172, :189, :212 stay valid only if the new field is omitted when false — keep it omitted, and update any assertion whose session genuinely ended on its own), `kernel/test/api.test.ts` (route + `/status` `orphaned`; fakes pass `sessions: { stopAll }` at :56/:143 — add the abandon method where the widened type requires it), `kernel/test/cli.test.ts` (AC4 CLI, AC5 summary).

**Design (recommended; the worker may deviate with a recorded reason):**
1. **AC1:** register `child.once("exit", () => options.signal.removeEventListener("abort", killGroup))` right after `addEventListener`, inside the `isValidPgid` branch. Do not remove it on `close` or on stream end — only on `exit` (the requirement's risk: never before the child has really exited). Background shells that outlive the leader are still killed by the manager's own `#reapAttemptGroup` in `#conclude`; the listener was never the only cleanup. Say so in the spawner doc comment.
2. **AC3:** `onSpawn` keeps its synchronous pgid write, then fires `void this.#recordLeaderStart(live.id, pgid)` which awaits the async probe and writes `leader_started_at` with `WHERE id = ? AND pgid = ?`, swallowing every error (a closed store included). The crash window widens slightly (a kernel killed before the probe resolves leaves `leader_started_at` null ⇒ the reaper leaves the group alone and the row `orphaned`/`leader_unverified` — the existing documented fail-safe, and exactly the row AC4 now gives an exit for). Leave the reaper's and `resumeSession`'s pre-launch `#checkGroup` probes synchronous: resume's check is deliberately synchronous "from here to the launch" (:628) so no reap or resume interleaves; record this scope choice in the PR body.
3. **AC4:** `abandonSession(id, { via })`: refuse if `this.#live.has(id)`; read the row (`not_found` if absent); refuse unless `status === "orphaned"`; read the newest reason event (see AC4) and refuse unless `leader_unverified`; then `#markRow(id, "orphaned", "abandoned", { reason: "abandoned_by_owner", by: "owner", via, pgid, orphaned_reason: "leader_unverified" })` (one transaction; `ended_at` written since `abandoned` is terminal) and clear `kill_incomplete_at` in the same transaction (extend `#markRow` or do it alongside). A `#markRow` that finds the row no longer `orphaned` (a concurrent reap) ⇒ refuse with the same code. Every status consumer: `isTerminalStatus` ⇒ `#stopLive` returns `abandoned` for that row (never `not_live`); `resumeSession` already refuses it (status check :616); the reaper's `SELECT … status IN ('starting','running','orphaned')` already skips it; `#retryTerminalKills` would include it only with `kill_incomplete_at` set, which the abandon clears; `/status`'s `sessions` list shows only `starting`/`running`. Add a test per consumer named in the requirement's Risks (API `/status`, CLI status output, crash-resume via `resumeSession`/`reapOrphans`).
4. **AC5:** compute the field in `#stopForAll` (and the `stopSession` path it delegates to) from manager state, not from the status string: "ended on its own" = `live.verdict !== undefined` at stop time, or the live entry was already terminal when the stop arrived (the `failed:auth` branch); plus group confirmed gone. Return it alongside the status (e.g. `#stopForAll` returns `{ status, endedOnItsOwn }` and `stopAll` maps it into the outcome; `stopSession`'s public `Promise<SessionStatus>` signature stays unchanged).
5. **AC6:** in `#stopForAll`'s terminal branch, call `attempt.authTimer?.()` after `#killAttemptGroup` (the timer's own callback would re-kill and re-settle; `#settle` is idempotent but the cancel is the honest fix). Rewrite the :514-523 comment accordingly.

## Subtask Structure

| # | Title | Criteria | Est. Files | Skills | Status |
|---|-------|----------|-----------|--------|--------|
| 1 | Session manager hardening: abort-listener removal, async leader probe, abandon action, policy docs, honest stop-all outcome, auth-timer cancel | AC1–AC6 | ~9 modify (src/docs), ~5 modify (tests), 0–1 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts
```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/sessions/spawner.ts", name: "spawnInNewProcessGroup"}
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "abandonSession"}
  - {kind: "type", path: "kernel/src/sessions/manager.ts", name: "StopAllOutcome"}
  - {kind: "type", path: "kernel/src/sessions/types.ts", name: "SessionStatus"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "TERMINAL_STATUSES"}
  - {kind: "symbol", path: "kernel/src/cli/index.ts", name: "summarizeStopAll"}
  - {kind: "type", path: "kernel/src/api/server.ts", name: "StatusBody"}
  - {kind: "file", path: "docs/ARCHITECTURE.md"}
requires: []
lanes:
  - "kernel/src/sessions/**"
  - "kernel/src/cli/index.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/sessions-process-group.test.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/test/sessions-stop-all.test.ts"
  - "kernel/test/session-fakes.ts"
  - "kernel/test/api.test.ts"
  - "kernel/test/cli.test.ts"
  - "kernel/test/sessions-abandon.test.ts"
  - "kernel/test/crash-resume.test.ts"
  - "kernel/test/crash-helpers.ts"
  - "kernel/test/fixtures/crash-harness.mjs"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "macOS /bin/ps -o lstart= -o comm= semantics (unchanged; already relied on by readGroupLeader)"
  - "Node child 'exit' event is emitted after the leader is reaped (spawner.ts header :7-8, already relied on)"
```
Modified (est.): `kernel/src/sessions/spawner.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/sessions/types.ts`, `kernel/src/sessions/policy.ts`, `kernel/src/sessions/index.ts`, `kernel/src/cli/index.ts`, `kernel/src/api/server.ts`, `docs/ARCHITECTURE.md`, possibly `kernel/src/kernel.ts` (only if the widened `sessions` type needs it); tests `kernel/test/sessions-process-group.test.ts`, `kernel/test/sessions.test.ts`, `kernel/test/sessions-stop-all.test.ts`, `kernel/test/api.test.ts`, `kernel/test/cli.test.ts`, possibly `kernel/test/session-fakes.ts`; `kernel/test/crash-resume.test.ts` and `kernel/test/fixtures/crash-harness.mjs` (AC3 determinism), possibly `kernel/test/crash-helpers.ts`. Created (est.): optionally `kernel/test/sessions-abandon.test.ts` for the abandon action's manager tests (the worker's call; keeping them in `kernel/test/sessions.test.ts` is equally fine).

## Parallelism Analysis
### Dependency Graph
```
Subtask 1 (independent)
```
### File Overlap Matrix
| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |
### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Phase 3 analysis notes
### Cited-line premise check
| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/sessions/spawner.ts:117` | yes | HOLDS | `options.signal.addEventListener("abort", killGroup, { once: true });` (:123) | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:1179` | yes | HOLDS | `attempt.abortController.abort();` | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:305` | yes | HOLDS | `checkPolicy` validates `allowedBashPrefixes` only | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:953` | yes | HOLDS | `const leaderStartedAt = this.#leaderStartIso(pgid);` | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/spawner.ts:256` | yes | HOLDS | `execFileSync("/bin/ps", …)` | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:559` | yes | HOLDS | non-live non-terminal row ⇒ `not_live` (:562) | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:637` | yes | HOLDS | `if (check === "ours" \|\| check === "leader_unverified")` | tip 5 minutes ago, fetched <1h |
| `kernel/src/cli/index.ts:155` | yes | HOLDS (moved to 157) | `const ALREADY_ENDED … ["completed", "interrupted", "failed:auth"]` | tip 5 minutes ago, fetched <1h |
| `kernel/src/api/server.ts:282` | yes | HOLDS (moved to 289) | routes table has only `/status`, `/stop-all`, `/resume` | tip 5 minutes ago, fetched <1h |
| `kernel/src/kernel.ts:187` | yes | HOLDS | `await manager.reapOrphans();` | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:1288` | yes | HOLDS | `stop_requested_after_end: true` | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:518` | yes | HOLDS | "the timer would die with a stopping kernel" | tip 5 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:1313` | yes | HOLDS | `if (pgid === undefined \|\| attempt.groupGone) return Promise.resolve();` | tip 5 minutes ago, fetched <1h |

### Blast-Radius / Impact Prediction
| Touched Subsystem | Depends On | Depended-on-by | Incident History |
|-------------------|------------|----------------|------------------|
| `kernel/src/sessions/manager.ts` | `kernel/src/sessions/types.ts` | `kernel/src/kernel.ts`, `kernel/src/tools/server.ts` | — |
| `kernel/src/cli/index.ts` | `kernel/src/api/server.ts`, `kernel/src/api/token.ts`, `kernel/src/auth/keychain.ts`, `kernel/src/service/launchd.ts`, `kernel/src/store/store.ts` | `docs/ARCHITECTURE.md` | — |
| `kernel/src/api/server.ts` | — | `kernel/src/cli/index.ts`, `kernel/src/kernel.ts` | — |

**Predicted ripple beyond directly-touched files:** `kernel/src/tools/server.ts` (consumes `stopSession`/`getSession`; must not treat `abandoned` as live — verify, no change expected).

## Skill References
- `skills/unit-testing/SKILL.md` — vitest, injected `schedule`/probe fakes (no timing races), real short-lived child for AC1, temp data dirs
- `skills/error-handling/SKILL.md` — stable `SessionError` codes, fail closed, every refusal writes nothing, swallowed store errors only where the existing code already swallows them

## Risk Assessment
| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| AC4's new terminal status is read as resumable or live somewhere | HIGH | LOW | Add `abandoned` to `TERMINAL_STATUSES`; test every consumer named in the requirement (API `/status`, CLI status, `resumeSession`, `reapOrphans`, `#retryTerminalKills`, `#stopLive`) | Requirement "Risks" |
| AC1 removes the abort listener before the child really exited, leaving a legitimate abort unhandled | HIGH | LOW | Remove only on the child's `exit` event (emitted after Node reaps the leader); the existing abort-before-exit test stays green; background shells are still killed by the manager's `#reapAttemptGroup` | Requirement "Risks" |
| AC4 abandons a row whose group is still the session's and alive, leaving that group running unsupervised | MEDIUM | MEDIUM | By design and stated in the CLI prompt and docs: abandon is the owner's explicit act on a row the kernel cannot verify; the kernel never signals it (it might not be its group); the confirmation text names the pgid so the owner can inspect it first | Requirement AC4 |
| The abandon eligibility check trusts a stale event (the group's state changed since the last reap) | LOW | MEDIUM | Eligibility is "the kernel last recorded `leader_unverified`", which is exactly the stuck state; a row whose group has since gone stays abandonable and ends terminal (harmless); a later reap would have moved it to `interrupted` first and made it ineligible | Phase 3 |
| AC3's async probe widens the window in which a kernel crash leaves `leader_started_at` null | LOW | LOW | Null already means "never kill, leave orphaned" (fail-safe); AC4 now gives that row an exit | Phase 3 |
| AC3's async probe turns the deterministic phase 1 exit test (`kernel/test/crash-resume.test.ts`) into a timing race: a kill -9 before the probe resolves leaves `leader_started_at` null, so the reap logs `orphaned`/`leader_unverified` instead of `group_killed` (flaky CI) | MEDIUM | MEDIUM | AC3 case gates its pre-kill wait on `leader_started_at`; AC4 case's self-kill fault in `crash-harness.mjs` is ordered after the probe (or fails with a named precondition); ≥10 consecutive local runs recorded in the PR body | Plan Review attempt 2 (MEDIUM) |
| AC3's late probe overwrites a newer attempt's start time | MEDIUM | LOW | Write guarded by `WHERE id = ? AND pgid = ?`; dedicated test | Phase 3 |
| AC5's new outcome field breaks existing deep-equal stop-all assertions | LOW | HIGH | Omit the field when false; update only the assertions whose session genuinely ended on its own | Phase 3 (`sessions-stop-all.test.ts`, `api.test.ts:383`) |
| Plain `studio status` never shows an abandonable row, so the owner cannot find the id without `--json` | MEDIUM | HIGH | `formatStatus` prints the `orphaned` block (AC4) with a cli.test assertion | Plan Review attempt 1 (MEDIUM) |
| The CLI confirmation hangs in a non-interactive context (launchd, CI, a pipe) | MEDIUM | MEDIUM | No TTY and no `--yes` ⇒ refuse with usage (exit 2), never prompt; injected `isInteractive`/`confirm` in tests | Phase 3 |
| AC2 doc edits break `scripts/check-docs.sh` (a relative link) | LOW | LOW | Run `bash scripts/check-docs.sh` locally | Phase 3 |
| A route matcher for `/sessions/<id>/abandon` lets an unauthenticated caller probe routes | MEDIUM | LOW | Keep authentication first, before any path matching (`server.ts:300-303`); 401 test for the new path | Phase 3 |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-04-h04-session-manager-hardening.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-04T17:13:27Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/29
- **Branch:** feature/hardening-h04-session-manager
- **Files changed:** 18
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Session manager hardening AC1-AC6: the SDK abort listener is removed on child exit; the leader start-time ps probe is async with a pgid-guarded write (the crash-resume exit test is gated on it); new terminal status abandoned via abandonSession, POST /sessions/<id>/abandon and studio session abandon (confirmation, never signals the group), with an orphaned list in /status; tool-policy docs warn about programs that run programs; stop-all outcomes carry ended_on_its_own; a kill-switch stop cancels the auth timer. One gate retry (exec race in a new test). Phase 4.5 review iteration 1 FAIL (2 HIGH: a reap racing an abandon, EOF at the confirm prompt) fixed in c044695; iteration 2 PASS. 5 findings dismissed below the fix floor (2 MEDIUM, 2 LOW, 1 nit).

## Not verified
- **kernel/test/exit-live.test.ts** — skipped; needs its live opt-in (real SDK/Keychain) (subtask 1)
- **studio session abandon default readline prompt on a real TTY** — tests inject confirm/isInteractive (Phase 4.5 iteration 2 drove it on a real pty in scratch) (subtask 1)
- **Linux CI run of the AC1 listener and readGroupLeaderAsync tests** — run on macOS only (subtask 1)
