# Supervisor Job: Session manager (spawn, gate, stop, reap, resume)

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariants 2, 3 and 6 apply directly)
- **Git:** clean except the tracked automate run file (`.supervisor/automate/*.md`, written by the engine — never stage it in this job), branch: main @ 04746e1
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 / 10.9.2
- **Blockers:** 0 | **Warnings:** 1 (dirty tracked run file — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1/05-session-manager.md
- **Base commit:** 04746e1

## Feasibility
- **Verdict:** CAUTION — the SDK (`@anthropic-ai/claude-agent-sdk` 0.3.284, already a dependency) exposes every option the requirement needs (`spawnClaudeCodeProcess`, `hooks`, `includeHookEvents`, `settingSources`, `plugins`, `env`, `resume`, `sessionId`), and items 03/04 supply the store and the auth providers. The four behaviours the design rests on were probed live at planning time (2026-10-02, results below). CAUTION because this is the largest phase-1 item (the requirement allows splitting AC 5–6 out) and process-group handling is macOS-targeted (Linux CI runs the same POSIX calls; differences are noted, not engineered around).

## Task
**Goal:** Implement `kernel/src/sessions/`: a `SessionManager` that starts isolated SDK `query()` sessions through a kernel-owned process-group spawner, records each group id before the first message is awaited, gates every tool call through a kernel `PreToolUse` hook callback driven by a per-session deny-by-default policy, stops a session by closing its input then killing its whole process group, reaps groups left alive by a previous kernel, resumes `interrupted` sessions with bounded retries that record every failure's full text, fails a session fast on an auth failure, and resolves the Loomwright plugin path from config or the newest valid cached install.

**Problem Statement:**
The kernel must own every Claude session's lifecycle (invariant 2) and gate every tool call with a policy the brain cannot edit (invariant 3). Q5 showed a `kill -9` of the kernel orphans the CLI child rather than stopping it, `canUseTool` is skipped for read-only commands such as `echo`, and one resume failed with its error lost in minified SDK output. Q4 showed an invalid credential took over 60 s to surface while the CLI retried.
Currently `kernel/src/sessions/index.ts` exports nothing.
Success looks like a tested session layer that item 07 (event loop, kernel tools) and item 09 (crash resume) build on: no session can outlive the kernel's record of it, no tool runs without a recorded kernel decision, and auth failures park instead of spinning.

## Acceptance Criteria
- [ ] AC1 — Given `startSession({agent, task, prompt, model, permissionMode, cwd})`, when it runs, then it calls SDK `query()` with `settingSources: []`; `plugins: [{type: 'local', path: <Loomwright path>}]`; `env` from the auth provider (item 04); an explicit `model` and `permissionMode` (both required, no defaults — the CLI default model is Opus, Q1); `includeHookEvents: true`; and a **streaming** async-iterable prompt, so in-process kernel tools work (Q5).
- [ ] AC2 — Given the spawn, when the CLI child starts, then the kernel launches it through `spawnClaudeCodeProcess` as the leader of a **new process group**, and the group id is written to `sessions.pgid` **before** the first message is awaited.
- [ ] AC3 — Given a session, when any tool is called, then a kernel `PreToolUse` hook callback decides allow or deny from a per-session policy object (phase 1: an allowlist of tool names and Bash command prefixes, deny by default); every decision is appended to `events`; `bypassPermissions` can't be set; and this holds even for read-only commands such as `echo`, which Q5 showed skip `canUseTool`.
- [ ] AC4 — Given a running session, when `stopSession(id)` runs, then the kernel closes the input, waits up to 2 s, then kills the whole process group; the session ends `stopped` and no process from the group remains (a test checks with `kill -0`).
- [ ] AC5 — Given kernel start-up, when `sessions` has rows in `starting`/`running` whose process group is still alive, then the reaper kills each group, marks the session `interrupted` and appends an event; groups that are gone are just marked `interrupted`.
- [ ] AC6 — Given an `interrupted` session with an `sdk_session_id`, when it's resumed, then the kernel calls `query({resume})` with the same isolation options; resume is **retryable**, up to 3 attempts with backoff, and the full error text of each failure is recorded (Q5's lost error).
- [ ] AC7 — Given an auth failure (a 401 or `authentication_failed`), when it occurs, then the kernel's own timeout (default 30 s) aborts the session instead of waiting on the CLI's retries (>60 s seen in Q4), marks it `failed:auth` and emits a notify event; it never retries in a loop.
- [ ] AC8 — Given the Loomwright path, when it's resolved, then it comes from config, with a fallback to the newest `~/.claude/plugins/cache/atelier/loomwright/<version>/`, and is recorded on the session row.
- [ ] AC9 — Unit tests inject a fake `query` and a fake spawner. One opt-in live test (`STUDIO_LIVE=1`, Haiku) runs a real session that tries `touch gated.txt` under a policy that denies it, and asserts the file doesn't exist.

## Outcomes Rubric
- `kernel/src/sessions/` exports a `SessionManager` whose `startSession` passes `settingSources: []`, a single local Loomwright plugin, the auth provider's env, explicit `model`/`permissionMode`, `includeHookEvents: true`, a `PreToolUse` hook and a `spawnClaudeCodeProcess` function to `query()`, with an async-iterable prompt — asserted on the options a fake `query` receives.
- Exactly one file under `kernel/src/sessions/` imports `node:child_process`, it spawns with `detached: true`, and a test shows `sessions.pgid` is already set when the fake `query` yields its first message.
- Tests show the policy allows an allowlisted tool and an allowlisted Bash prefix, denies everything else (including `echo` when not allowlisted, a compound command whose first word is allowlisted, and an unknown tool), writes one `events` row per decision, and that `permissionMode: "bypassPermissions"` is refused before any spawn.
- A test starts a real process group (fake spawner command, no SDK), calls `stopSession`, and asserts `process.kill(-pgid, 0)` throws `ESRCH` and the row reads `stopped`.
- Tests cover the reaper (alive group killed + `interrupted` + event; gone group marked `interrupted`), resume (3 attempts with backoff, each failure's full error text in `events`, success on a later attempt) and the auth path (`failed:auth` + one `notify` event, no further attempt).
- Tests cover Loomwright path resolution: a configured path wins; otherwise the numerically newest cached version that has `.claude-plugin/plugin.json` (15.115.0 over 15.98.0; a version dir without the manifest is skipped); the chosen path is on the session row.

## Implementation Notes (verified at planning time)

**Planning probes (2026-10-02, SDK 0.3.284 / CLI 2.1.284, macOS, Node v22.14.0) — record all four in `docs/OPEN_QUESTIONS.md` under the Q5 "Background sessions" bullet, each with its reproduction (see the docs bullet at the end):**
1. **A `PreToolUse` hook callback gates read-only commands too.** With `permissionMode: "default"`, a hook callback in `options.hooks.PreToolUse` (one matcher, no `matcher` string) was invoked for BOTH `echo probe-hi` and `touch gated.txt`; returning `{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: …}}` for `touch` kept `gated.txt` from being created, and `permissionDecision: "allow"` for `echo` let it run. (This ran with `settingSources: ["user"]`, whose `defaultMode` is `auto`, so the hook's deny wins even over the auto classifier.)
2. **`spawnClaudeCodeProcess` is called synchronously at `query()` creation** (~2 ms, before the caller iterates). A Node `spawn(command, args, {cwd, env, stdio, detached: true})` returned by it makes the CLI its own group leader (`ps -o pid=,pgid=` shows pid == pgid). `process.kill(-pgid, "SIGKILL")` removed the whole group (`process.kill(-pgid, 0)` then threw `ESRCH`), and the pending `next()` rejected with `Claude Code process terminated by signal SIGKILL`.
3. **An auth failure is visible within ~1 s as a `system`/`api_retry` message.** With `settingSources: []` and an invalid `ANTHROPIC_API_KEY`, the stream gave `system/init` at 0.5 s, then `{type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, error_status: 401, error: "authentication_failed"}` at 1.1 s, and further 401 retries at 1.9 s, 3.4 s, 6.0 s, 10.7 s, 20.4 s (backoff doubling). The final error would only arrive after all 10 retries — that is Q4's ">60 s". Aborting via `abortController` ended the stream ~2 s later with `Claude Code process aborted by user`.
4. **`options.sessionId` pre-assigns the SDK session id.** A `randomUUID()` passed as `sessionId` came back unchanged as the `system/init` `session_id`; the same init listed plugins `loomwright` (the local path) plus the CLI builtins `agents-md` and `telemetry` with `settingSources: []`.

**Module layout (all under `kernel/src/sessions/`):**
- `types.ts` — `SessionStatus` (`"starting" | "running" | "completed" | "failed" | "failed:auth" | "stopped" | "interrupted"`), `ToolPolicy`, `StartSessionParams`, `SessionManagerDeps`, `SessionManagerOptions`, `SessionError` (typed, with a `code`).
- `policy.ts` — pure `decideToolUse(policy, toolName, toolInput) → {decision: "allow" | "deny", reason}`. No I/O.
- `spawner.ts` — the ONLY file in `sessions/` that imports `node:child_process`: `spawnInNewProcessGroup(spawnOptions, {onSpawn, stderrTail})`, `killProcessGroup(pgid, signal)`, `isProcessGroupAlive(pgid)`, `readGroupLeaderCommand(pgid)`.
- `loomwright-path.ts` — `resolveLoomwrightPath({configured, cacheRoot})`.
- `manager.ts` — `SessionManager` (`startSession`, `stopSession`, `resumeSession`, `reapOrphans`, `getSession`).
- `index.ts` — public re-exports (replaces `export {}`).

**`startSession` (AC1, AC2, AC8):**
- Params: `{agent: string, task?: number, prompt: string, model: string, permissionMode, cwd: string, policy: ToolPolicy}`. `model` and `permissionMode` have NO defaults: a missing/empty `model` or missing `permissionMode` throws `SessionError` (`code: "invalid_params"`) before any row or spawn. `permissionMode === "bypassPermissions"` throws `SessionError` (`code: "forbidden_permission_mode"`) before any row or spawn — type the param as `Exclude<PermissionMode, "bypassPermissions">` AND check at runtime (callers may be JS). Never pass `allowDangerouslySkipPermissions`, `allowedTools`, `canUseTool` or `settingSources` other than `[]`.
- Manager options: `{store: Store, authProvider: AuthProvider, loomwrightPath?: string, pluginCacheRoot?: string, baseEnv?: BaseEnv (default process.env), stopGraceMs?: number (default 2_000), authTimeoutMs?: number (default 30_000), resumeBackoffMs?: readonly number[] (default [1_000, 2_000, 4_000]), onMessage?: (sessionId: number, message: SDKMessage) => void}`. Deps (all injectable for tests): `{query?: typeof query, spawn?: typeof spawnInNewProcessGroup, killGroup?, isGroupAlive?, readGroupLeaderCommand?, sleep?: (ms) => Promise<void>, now?: () => Date, randomUUID?: () => string}`. `onMessage` is the seam item 06 (budget meter, `rate_limit_event`) and item 07 attach to; it is called for every message and an observer that throws is caught and recorded as an event, never allowed to break the session loop.
- Order: (1) resolve the Loomwright path (AC8); (2) `authProvider.buildEnv(baseEnv)` — an `AuthProviderError` (`missing`/`invalid_shape`) OR a `KeychainError` (a locked Keychain, or the unverified launchd context, Q2 — `kernel/src/auth/subscription-token.ts:40` lets it propagate) is handled the same: nothing is spawned; insert the row as `failed:auth`, append one `notify` event (`payload.reason: "auth_failed"`, `code`: the error's code or `keychain_error` — never env or credential data), and rethrow. A test covers both with stub providers that throw; (3) `sdkSessionId = randomUUID()`; (4) INSERT the `sessions` row: `agent`, `task_id`, `status: "starting"`, `model`, `auth_account: authProvider.account`, `loomwright_path`, `sdk_session_id`, `started_at`; (5) build the input channel and call `query({prompt: channel, options})` with `options = {model, permissionMode, cwd, settingSources: [], plugins: [{type: "local", path}], env, includeHookEvents: true, sessionId: sdkSessionId, hooks: {PreToolUse: [{hooks: [gate]}]}, abortController, spawnClaudeCodeProcess: (o) => spawn(o, {onSpawn: (pgid) => UPDATE sessions SET pgid = ?}), …}`; (6) push the prompt as the first `SDKUserMessage`; (7) start the background consume loop. Probe 2 shows the spawn callback runs synchronously inside `query()`, and better-sqlite3 writes are synchronous, so `pgid` is in the row before any message is awaited (AC2). The test asserts it from inside the fake `query`'s first `yield`.
- Pre-assigning `sessionId` (probe 4) means `sdk_session_id` is on disk before the CLI starts, so a kernel killed before the init message still leaves a resumable id (item 09). On the `system/init` message, set `status: "running"`; if its `session_id` differs from the pre-assigned one, store the init value and append an event (never silently keep a wrong id).
- **Input channel:** a small push-based async iterable (queue + pending resolver) the manager owns. `close()` ends it; the SDK then ends the CLI's stdin. Streaming input is required for in-process MCP tools (Q5).
- **Phase-1 lifecycle after a `result`:** by default (`closeInputOnResult: true` on the start params) the manager closes the input after the first `result` message, so the CLI finishes and exits; the session ends `completed` when that result's `subtype` is `success`, else `failed`. Item 07 can pass `false` to keep a session open for `kernel_request_stop`. Every status change is written to the row (`updated_at`, and `ended_at` on a terminal status) AND appended to `events` (`kind: "session_status"`, `actor: "kernel"`, `session_id`, `payload_json: {from, to, reason?}`) in one `store.transaction`.
- The consume loop never throws out: an iterator rejection after `stopSession`/`authAbort` keeps the status those set (`stopped`/`failed:auth`); any other rejection ⇒ `failed` with the error message (and the stderr tail) in the event payload. `startSession` returns `{id, sdkSessionId, pgid, done: Promise<SessionStatus>}` where `done` settles with the terminal status.

**Process-group spawner (AC2, AC4, AC5):**
- `spawnInNewProcessGroup(o, {onSpawn})` = `spawn(o.command, o.args, {cwd: o.cwd, env: o.env, stdio: ["pipe", "pipe", "pipe"], detached: true})`. Do NOT pass `o.signal` to `spawn()` (Node would kill only the leader); instead `o.signal.addEventListener("abort", () => killProcessGroup(pgid, "SIGKILL"), {once: true})` — the SDK fires that signal only after its own stdin-EOF + ~2 s grace (see `SpawnOptions.signal` in `sdk.d.ts`). Call `onSpawn(child.pid)` synchronously right after `spawn` returns (when `child.pid` is undefined the spawn failed: do not call it; the `error` event surfaces through the SDK). Always drain stderr (a full pipe blocks the CLI) into a bounded tail buffer (last 64 KiB) the manager reads when recording a failure. Do not `unref()` the child. Return the `ChildProcess` (it satisfies `SpawnedProcess`).
- `killProcessGroup(pgid, signal)` = `process.kill(-pgid, signal)`, treating `ESRCH` as "already gone" (returns `false`) and rethrowing anything else. `isProcessGroupAlive(pgid)` = `process.kill(-pgid, 0)` → `true`; `ESRCH` → `false`; `EPERM` → `true` (exists, not ours — the reaper then refuses to kill, below). Guard `pgid` is an integer > 1 everywhere (a `0` or `-1` would signal the kernel's own group or every process).
- `readGroupLeaderCommand(pgid)` = `execFileSync("/bin/ps", ["-o", "comm=", "-p", String(pgid)], {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]})` trimmed; `undefined` when `ps` exits non-zero (no such process). macOS prints the full executable path, Linux the (≤15-char) name, so compare the basename.

**`stopSession(id)` (AC4):** set an in-memory `stopping` flag, close the input channel, wait for the child's `exit` OR `stopGraceMs` (2 s), then `killProcessGroup(pgid, "SIGKILL")` unconditionally — the group can hold background shells that outlive the leader (Q5) — then await the leader's `exit` event (bounded, 1 s: until Node reaps it the killed leader is a zombie that still holds the pgid, and on Linux `kill(-pgid, 0)` on a zombie-held group succeeds), then `query.close()`, then write `stopped`. Idempotent: stopping a session that already reached a terminal status is a no-op returning that status. The AC4 test uses a fake `query` whose fake spawner path calls the REAL `spawnInNewProcessGroup` with `command: "/bin/sh", args: ["-c", "sleep 60 & sleep 60"]` (a real two-process group, no SDK, no model), then POLLS `process.kill(-pgid, 0)` until it throws `ESRCH` (deadline ~2 s — the backgrounded `sleep` is reparented and reaped by init/launchd asynchronously; `kernel/test/store.test.ts:75-80` already awaits `exit` after a SIGKILL for the same reason) and asserts the row reads `stopped`. Never assert ESRCH once, immediately. Give it a 10 s timeout; in `afterEach`, kill any group the test created.

**Tool policy + gate (AC3):**
- `ToolPolicy = {allowedTools: readonly string[], allowedBashPrefixes: readonly string[]}`. Decision order: tool name `Bash` → allowed only when `tool_input.command` is a string, contains NONE of the shell control/substitution characters `; & | < > ( ) $` backtick, newline or carriage return, and equals an allowlisted prefix or starts with it followed by a space (word boundary: prefix `echo` allows `echo hi`, not `echoX` or `echo hi; rm x`); `Bash` itself in `allowedTools` does NOT allow arbitrary commands (Bash is gated by prefix only — say so in a doc comment). Any other tool → allowed only when its exact name is in `allowedTools`. Everything else → deny. Prefix matching is a phase-1 mechanism; a parser-grade Bash gate is out of scope — the metacharacter refusal is what makes a prefix allowlist safe enough, so test it entry by entry.
- The hook callback: `async (input) => …` — the SDK types it `HookCallback` over the whole `HookInput` union (`sdk.d.ts:957`), so narrow on `input.hook_event_name === "PreToolUse"` (anything else ⇒ `deny`, `kernel_gate_error`), then read `input.tool_name`/`input.tool_input` (`tool_input` is `unknown`: runtime-check `command` is a string), call `decideToolUse`, append ONE `events` row (`kind: "tool_decision"`, `actor: "kernel"`, `session_id`, `payload_json: {tool, decision, reason, command?}` with the Bash command truncated to 500 chars), return `{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason}}`. Fail closed: any exception inside the callback (policy bug, store error) returns `deny` with reason `kernel_gate_error` (and records it if the store still works). Tool input is untrusted data: never interpolate it into SQL (bound parameters only) or a shell.
- The policy object is per session, held by the kernel in memory, frozen at start (`Object.freeze` on a defensive copy) — the brain has no path to change it (invariant 3).

**Reaper (AC5):** `reapOrphans()` — for each row with `status IN ('starting','running')`: no `pgid` ⇒ mark `interrupted` (event `payload.reason: "no_pgid"`); group gone (`isProcessGroupAlive` false) ⇒ mark `interrupted` (`reason: "group_gone"`); group alive ⇒ if its leader is alive (`readGroupLeaderCommand` returns a value) and the basename is not `claude`, the pgid was reused by an unrelated process: do NOT kill, mark `interrupted` (`reason: "pgid_reused"`); otherwise (leader is `claude`, or the leader exited but the group lives on — a pid is never reused while its process group still exists, so the group is still ours) `killProcessGroup(pgid, "SIGKILL")` and mark `interrupted` (`reason: "group_killed"`). **EPERM is per row, never fatal:** `isProcessGroupAlive` → `EPERM` (exists, not ours), or `killProcessGroup` throwing `EPERM`, ⇒ do NOT kill, mark `interrupted` (`reason: "group_not_ours"`) and continue the loop; any other unexpected error on one row is recorded on that row's event (`reason: "reap_error"`, message) and the loop continues, so one bad row never leaves later rows unmarked. A unit test injects a `killGroup` that throws `EPERM`. Each marking is one transaction with its `session_status` event; the event also carries `{pgid}`. Returns a summary list. The manager does not call it on its own: the daemon (item 09) calls it at start-up before accepting work — say so in a doc comment. Unit tests inject `isGroupAlive`/`killGroup`/`readGroupLeaderCommand`. Two tests use a REAL `/bin/sh -c "sleep 60"` group started via `spawnInNewProcessGroup`: one injects `readGroupLeaderCommand` returning `claude` and asserts (polling, as in the AC4 test) the group is gone (`ESRCH`) and the row is `interrupted` with `reason: "group_killed"`; the other keeps the real `ps` reading and asserts the `pgid_reused` branch leaves the group alive — assert only that the leader's basename is NOT `claude` (a shell may exec a single `-c` command in place, so the leader reads `sleep` on both macOS and Ubuntu's dash; never pin `sh`). Cleanup kills both groups.

**Resume (AC6):** `resumeSession(id, {prompt?: string})` — only for a row whose `status` is `interrupted` and whose `sdk_session_id` is set (else `SessionError`, `code: "not_resumable"`). Same isolation options as `startSession` (rebuild env from the auth provider, re-resolve nothing: reuse the row's `model`, `loomwright_path` and the policy passed in again by the caller — the policy is not persisted in phase 1, so `resumeSession` takes `{policy, permissionMode, cwd}` too), plus `resume: sdk_session_id` and NO `sessionId`. Default prompt: `"The kernel restarted. Continue the task from where you left off."`. An attempt FAILS when the stream rejects or ends before a `system/init` message, or the first `result` is an error with no prior assistant output; on failure append `kind: "session_resume_failed"` with `payload_json: {attempt, error: <full err.message>, stack: <err.stack>, stderr: <the spawner's stderr tail>}` (do not truncate the message; cap stack and stderr at 64 KiB each), kill that attempt's group, then `sleep(resumeBackoffMs[attempt-1])` and retry; at most 3 attempts total. All 3 failing ⇒ `failed` with `reason: "resume_failed"`. An auth failure during resume follows AC7 and is NOT retried. Tests use an injected `sleep` that records the delays (`[1000, 2000]` between three attempts) instead of real timers.

**Auth failure (AC7):** the consume loop treats as an auth signal: a `system`/`api_retry` message with `error_status === 401` or `error === "authentication_failed"` (probe 3), or an assistant message with `error === "authentication_failed"`. On the FIRST signal: set `authFailed`, close the input, `abortController.abort()`, and arm a timer of `authTimeoutMs` (30 s) after which the group is SIGKILLed regardless — so the session is terminal within `authTimeoutMs` of the signal whatever the CLI does, instead of waiting out its 10 retries; then write `failed:auth` and append ONE `notify` event (`actor: "kernel"`, `session_id`, `payload_json: {reason: "auth_failed", provider: authProvider.id, account, error_status, error}` — never env or credential values). No retry, no resume. `authTimeoutMs` applies to the auth path only; a healthy slow session is never timed out by it. Test with a fake `query` that yields `init` then an `api_retry` 401 and then never ends: assert `failed:auth`, exactly one `notify` row, the abort fired, and with injected timers that the kill ran.

**Loomwright path (AC8):** `resolveLoomwrightPath({configured, cacheRoot = join(homedir(), ".claude/plugins/cache/atelier/loomwright")})`: a non-empty `configured` (the manager option `loomwrightPath` — the kernel's config entry point until a config file exists; the daemon passes it) wins after `resolve()`; it must contain `.claude-plugin/plugin.json`, else `SessionError` (`code: "loomwright_not_found"`) — never silently fall back from a bad configured path. Otherwise list `cacheRoot`'s entries, keep names matching `^\d+\.\d+\.\d+$` that are directories containing `.claude-plugin/plugin.json`, sort NUMERICALLY by (major, minor, patch) and take the highest. The cache really holds stale leftovers (on this machine `15.61.0` has no `.claude-plugin/`, and a lexical sort would pick `15.98.0` over `15.115.0`) — both are test cases, built in a `mkdtemp` dir. None ⇒ `SessionError` (`loomwright_not_found`). The resolved absolute path goes into `sessions.loomwright_path`.

**Migration 3 (AC8):** add `kernel/src/store/migrations/003_session_loomwright_path.ts` (`version: 3`, `name: "session_loomwright_path"`, `up: "ALTER TABLE sessions ADD COLUMN loomwright_path TEXT;"`) and append it to `migrations/index.ts`. `kernel/test/store.test.ts` WILL need its default-list assertion (lines ~175–185: the applied list `[[1,"initial"],[2,"auth_providers"]]`) extended with `[3, "session_loomwright_path"]` and a column check that `sessions` now ends with `loomwright_path`; keep the migration-1 exact-set test (pinned to `[initial]`) unchanged. No other schema change: `status` is free text (no CHECK), so `failed:auth` needs none.

**Tests (AC9) — never the real SDK or a model in unit tests:**
- `kernel/test/sessions.test.ts` — fake `query` (a function that records its `{prompt, options}`, calls `options.spawnClaudeCodeProcess` with fake `SpawnOptions` the way the SDK does, then yields scripted `SDKMessage`s), fake spawner (records calls, returns an `EventEmitter`-based fake process with `pid`), a `mkdtemp` `Store` per test (copy the `afterEach` close pattern from `kernel/test/store.test.ts`), and a stub `AuthProvider` (`buildEnv` returns a fixed env, no Keychain). Covers AC1–AC3, AC5–AC8.
- `kernel/test/sessions-policy.test.ts` — `decideToolUse` table tests (allowlisted tool, unknown tool, `Bash` with each metacharacter, prefix word boundary, non-string command, `echo` denied when not allowlisted).
- `kernel/test/sessions-process-group.test.ts` — real `/bin/sh` process groups via `spawnInNewProcessGroup` (AC4, the live-group reaper case). Works on CI's Linux too (POSIX `kill(-pgid)`).
- `kernel/test/sessions-live.test.ts` — `describe.skipIf(process.env.STUDIO_LIVE !== "1")`: a real `SessionManager` with the real `query`, the `subscription-token` provider via `selectAuthProvider` (needs the owner's Keychain token — opt-in only, never CI), `model: "claude-haiku-4-5"`, `permissionMode: "default"`, a `mkdtemp` cwd and store, policy `{allowedTools: [], allowedBashPrefixes: []}`, prompt "Run the Bash command `touch gated.txt`, then reply DONE."; await `done`, then assert `gated.txt` does not exist in the cwd and at least one `tool_decision` deny event exists. 120 s timeout. Do not run it in this job (no live token use by the worker); state that in the PR body.

**Docs (keep them true — prior items drew review rounds for drift and for unrecorded probes):**
- `docs/OPEN_QUESTIONS.md`, under the Q5 "Background sessions" bullet: one sub-bullet "**Session-manager probes (2026-10-02, SDK 0.3.284; for item 05)**" recording probes 1–4 above with the observed numbers and a one-line reproduction each.
- `docs/ARCHITECTURE.md` §Data model `sessions` row: add "Loomwright path it ran with" ; §Session manager: add that an auth failure surfaces within ~1 s as an `api_retry` 401 and the kernel fails the session on the first one (`failed:auth`, notify, no retry), and that `sessionId` is pre-assigned so the id is recorded before the CLI starts. Run `bash scripts/check-docs.sh` after editing.

**ESM conventions in this package:** relative imports use the `.js` suffix, type-only imports use `import type` (`verbatimModuleSyntax`), `noUncheckedIndexedAccess` is on, strict mode. Import SDK types with `import type { … } from "@anthropic-ai/claude-agent-sdk"` and the runtime `query` only in `manager.ts` (as the default for the injectable dep). `npm test` and `npm run typecheck` must pass from `kernel/`, plus `npm run build` and `node dist/daemon.js --version` (CI's smoke).

**Out of scope:** approval UI (phase 2 — phase 1 denies anything not allowlisted), agent roster/charters (phase 4), the budget meter and `cap_state` (item 06 — it attaches through `onMessage`; this job does not write `model_usage_json` or `budget`), the kernel MCP tools and `kernel_request_stop` (item 07), calling `reapOrphans` from the daemon and the `kill -9` exit test (item 09). Linux process-group differences: target macOS, note the gap in a doc comment on `spawner.ts`.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Session manager: process-group spawner, tool gate, stop, reaper, resume, auth fail-fast, Loomwright path, migration 3, tests, docs | AC 1–9 | 5 modify, 11 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1 — session manager (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/sessions/index.ts"}
  - {kind: "file", path: "kernel/src/sessions/types.ts"}
  - {kind: "file", path: "kernel/src/sessions/policy.ts"}
  - {kind: "file", path: "kernel/src/sessions/spawner.ts"}
  - {kind: "file", path: "kernel/src/sessions/loomwright-path.ts"}
  - {kind: "file", path: "kernel/src/sessions/manager.ts"}
  - {kind: "file", path: "kernel/src/store/migrations/003_session_loomwright_path.ts"}
  - {kind: "file", path: "kernel/test/sessions.test.ts"}
  - {kind: "file", path: "kernel/test/sessions-policy.test.ts"}
  - {kind: "file", path: "kernel/test/sessions-process-group.test.ts"}
  - {kind: "file", path: "kernel/test/sessions-live.test.ts"}
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "SessionManager"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "decideToolUse"}
  - {kind: "symbol", path: "kernel/src/sessions/spawner.ts", name: "spawnInNewProcessGroup"}
  - {kind: "symbol", path: "kernel/src/sessions/loomwright-path.ts", name: "resolveLoomwrightPath"}
requires: []
lanes:
  - "kernel/src/sessions/**"
  - "kernel/src/store/migrations/**"
  - "kernel/test/**"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires: []
```

Modified files: `kernel/src/sessions/index.ts` (was `export {}`), `kernel/src/store/migrations/index.ts` (append migration 3), `kernel/test/store.test.ts` (default-list assertion gains migration 3 and the `loomwright_path` column), `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`. No `package.json`/`package-lock.json` change (the SDK is already a dependency).

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

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `unit-testing` (vitest, fake `query`/spawner, injected sleep/timers, `mkdtemp` stores, real `/bin/sh` process groups with cleanup), `error-handling` (typed `SessionError`, fail-closed gate, never-throwing consume loop). Read `CLAUDE.md` invariants 2/3/6, `docs/ARCHITECTURE.md` §Session manager and §Safety kernel, `docs/OPEN_QUESTIONS.md` Q1/Q4/Q5, `kernel/src/auth/types.ts` (the `AuthProvider` this job consumes) |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): largest phase-1 item; may outgrow one reviewable PR | MEDIUM | Single worker, tight module split; the requirement allows moving AC 5–6 (reaper, resume) to a follow-up — if the worker must, it says so in the PR body and the run records it |
| A Bash prefix allowlist is bypassed by a compound command (`echo hi; rm -rf x`) | HIGH | Refuse any command containing `; & \| < > ( ) $` backtick or a newline before prefix matching; word-boundary prefix match; table tests per character |
| Killing a recycled pgid that now belongs to an unrelated process | HIGH | `pgid > 1` guard everywhere; the reaper kills only when the group leader's basename is `claude` or the leader is gone while the group lives (a pid is never reused while its group exists); `EPERM` never kills |
| A gate bug lets a tool through | HIGH | The hook callback fails closed (`deny`, `kernel_gate_error`) on any exception; deny-by-default; one `events` row per decision |
| An auth failure spins in CLI retries | MEDIUM | First `api_retry` 401 / `authentication_failed` ⇒ abort + `failed:auth` + notify (probe 3: visible at ~1.1 s); `authTimeoutMs` bounds the teardown |
| The kernel's stderr pipe fills and blocks the CLI | MEDIUM | The spawner always drains stderr into a bounded tail buffer |
| Feasibility (Phase 2.5): real process-group tests behave differently on Linux CI — zombie leaders still holding the pgid, `ps -o comm=` printing a short name, `/bin/sh` being dash | MEDIUM | `stopSession` awaits the leader's `exit` after the SIGKILL; tests poll for `ESRCH` with a ~2 s deadline; the reaper test asserts "not `claude`", never a specific basename |
| Real process-group tests leak `sleep` processes on failure | LOW | `afterEach` kills every group a test created; short sleeps; test timeouts |
| Prior churn (postmortem ledger): `docs/ARCHITECTURE.md`, `kernel/src/store/migrations/index.ts`, `kernel/test/store.test.ts`, `docs/OPEN_QUESTIONS.md` and `kernel/src/sessions/index.ts` carried self_heal_churn (4) and drain_churn (2) in items 03/04 — doc drift and unrecorded probes drew review rounds | MEDIUM | Update ARCHITECTURE.md and OPEN_QUESTIONS.md in this PR (lanes include both), record the four planning probes, run `scripts/check-docs.sh` |
| Committing the engine's tracked run file with the feature | MEDIUM | Stage explicit `kernel/` and `docs/` paths only |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-02-05-session-manager.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-02T06:08:32Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/13
- **Branch:** feature/phase1-05-session-manager
- **Files changed:** 16
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** kernel/src/sessions/ — SessionManager over SDK query() with isolated options, a process-group spawner that records pgid (and the leader's start time) before the first message, a fail-closed deny-by-default PreToolUse gate with one event per decision, stop with kill-until-gone of the whole group, a start-time-verified boot reaper (orphaned status for unprovable live groups), resume with 3 retried attempts and full error text, auth fail-fast to failed:auth + notify, Loomwright path resolution; migrations 3 and 4. Self-heal fixed two reproduced HIGHs in iteration 1 (single SIGKILL racing a fork; name-only pid-reuse guard) and one in iteration 2 (left-alive groups were resumable); rubric 6/6; 11 MEDIUM/LOW findings dismissed for owner decision.

## Not verified
- **kernel/test/sessions-live.test.ts (real SDK + Haiku, denied touch gated.txt)** — job forbids live token use; opt-in STUDIO_LIVE=1 test not run (subtask 1)
- **real process-group tests on Linux CI** — macOS-only local runtime (subtask 1); note: CI on ubuntu at 8a7726e passed the process-group tests
