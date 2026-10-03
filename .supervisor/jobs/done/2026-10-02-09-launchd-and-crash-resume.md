# Supervisor Job: launchd service and the phase 1 crash → resume exit test

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariants 1, 2, 3 and 6 apply directly)
- **Git:** dirty only with the automate engine's own trail files (`.supervisor/automate/*`, `.supervisor/requirements/phase1-0{6,7,8}-*-plan.md`) — never stage them in this job; commit with explicit paths only. Branch: main @ 3f9ea61
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 (CI: ubuntu-latest, `.github/workflows/ci.yml`)
- **Blockers:** 0 | **Warnings:** 1 (dirty trail files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1/09-launchd-and-crash-resume.md
- **Base commit:** 3f9ea614bafc40dc54518bdc8062a439d8705294

## Feasibility
- **Verdict:** CAUTION
- Tech stack — GO: TypeScript kernel (strict, NodeNext, vitest). The plist is plain XML written with `node:fs`; `launchctl` runs through an injected exec; the crash test builds the kernel with the existing `scripts/build.mjs --out-dir <tmp>` and spawns it with `node:child_process`. No new package.
- Dependencies — GO: no new dependency.
- Architecture fit — GO: D11 (`docs/DECISIONS.md:17`) — the kernel runs as a launchd service; `docs/ARCHITECTURE.md:13` draws it. `startKernel` (`kernel/src/kernel.ts:124`) already reaps orphans at start (:178) and the loop already redelivers a row a crash left `pending` (`kernel/src/loop/loop.ts:46-47`). Kernel tool idempotency is scoped to the session row, which a resume keeps (`kernel/src/tools/server.ts:10-16`), and `kernel_task_create` runs its INSERT inside `runStep`'s single transaction (`kernel/src/tools/server.ts:284`, `kernel/src/loop/steps.ts:3-9`), so a kill during it commits all or nothing.
- Scope — GO: one worker; 7 modified + 6 created files (+1 optional helper; below).
- Hard blockers — CAUTION: (1) **Owner decision (2026-10-02, this planning run):** this PR carries the code, the opt-in live exit test and the docs. The owner runs the live exit test (`STUDIO_LIVE=1`), `studio service install` and the Keychain-under-launchd check himself. AC2's recorded result and AC5 (evidence + `docs/ROADMAP.md` phase 1 marked done) land in a later PR, after that run passes. The run makes no model call, runs no `launchctl` and reads or writes no real Keychain item. (2) The deterministic crash test is the first test that runs the kernel as a separate OS process and `kill -9`s it; it must pass on macOS (local) and Linux (CI).

## Task
**Goal:** Run the kernel as a per-user launchd agent (`studio service install|uninstall`) and prove the phase 1 exit criterion: a `kill -9` mid-session loses at most the current step. After the restart, the orphaned session's process group is reaped, the session is resumed (or cleanly `interrupted`), exactly one task exists for the idempotency key, no event completes twice, and the work finishes. The proof is a deterministic crash test that runs in CI with a stand-in session (no model), plus an opt-in live test on the owner's machine. Mechanism only (invariant 1): the shipped daemon still installs no event handler. The handler that starts and resumes the session lives in the test harness, like a playbook would.

## Acceptance Criteria
- [ ] AC1 — Given `studio service install`, when it runs (macOS only), then it writes `~/Library/LaunchAgents/com.loomwright.studio.kernel.plist` with `RunAtLoad` true, `KeepAlive` restarting on crash (`<dict><key>SuccessfulExit</key><false/></dict>`), and `StandardOutPath`/`StandardErrorPath` under `<dataDir>/logs/`. It then loads it with `launchctl bootstrap gui/<uid> <plist>`. `studio service uninstall` runs `launchctl bootout gui/<uid>/com.loomwright.studio.kernel` and removes that plist. Neither command reads, writes or names any other plist.
- [ ] AC2 — Given the kernel running under launchd, when it reads the Keychain token (item 04), then it works without a terminal. **This PR:** README documents how to install and run the service, where the logs are, and how to grant Keychain access once if macOS shows a prompt. `docs/OPEN_QUESTIONS.md` records the check as an open owner to-do with the exact commands. **Deferred (owner decision):** running the check and recording its result.
- [ ] AC3 — Given the exit test, when it runs, then it starts the daemon. It enqueues a message whose handler starts a session that calls `kernel_task_create` with a fixed idempotency key and then runs an allowlisted slow command (`sleep 20`). It `kill -9`s the daemon mid-command and restarts it. It then asserts all of these:
  - the orphaned session's process group was reaped;
  - the session resumed or was cleanly marked `interrupted`;
  - exactly one task row exists for the key;
  - no event completed twice (`event_done` once per queue row);
  - the work continued to completion.

  **This PR:** a deterministic CI variant (stand-in session, no model) that runs and passes in `npm test`, and the live variant (`STUDIO_LIVE=1`, Haiku), written and skipped by default. **Deferred:** the owner's live run.
- [ ] AC4 — Given the same test with the kill during `kernel_task_create` itself, when the daemon restarts, then there is still exactly one task. The fault-injection hook lives in the test harness only. No code in `kernel/src/` that `daemon.ts` reaches can trigger it.
- [ ] AC5 — **Deferred (owner decision):** after a successful live run, its output (tokens redacted) is saved under `probes/` or `docs/evidence/`, and `docs/ROADMAP.md` marks phase 1 done with the date. **This PR:** `docs/OPEN_QUESTIONS.md` lists this as the owner's next step; `docs/ROADMAP.md` is NOT edited.

## Implementation Notes (verified at planning time)
**Files read:**
- `kernel/src/daemon.ts` (:1-66 — `--version`, else `startKernel(parseArgs)`, SIGTERM/SIGINT → `kernel.stop()` → exit 0; a start failure prints one line and exits 1).
- `kernel/src/kernel.ts`:
  - `KernelOptions` :38-51; `KernelDeps` :54-70, which include `sessionDeps` and `loopDeps`.
  - `startKernel` :124-214: reaps orphans at :178; builds `new EventLoop({ store, handlers: {} }, …)` at :181 — no handler injection point yet; `api.json` at :193.
- `kernel/src/cli/index.ts`:
  - `parse` :73-80; `USAGE` :42; `runCli(argv, deps)` :220.
  - `isEntryPoint` :295 — the CLI runs `main` only as the entry point.
- `kernel/src/store/store.ts:18-25` — `resolveDataDir(env, homeDir)`: `STUDIO_DATA_DIR`, else `~/.loomwright-studio`.
- `kernel/src/store/lock.ts` — the single-writer lock is a SQLite lock db, released by the OS when the holder dies, so a `kill -9`'d daemon never strands it.
- `kernel/src/loop/loop.ts:24-47` — a crash leaves a row `pending`, and it is processed again after the restart.
- `kernel/src/loop/types.ts`:
  - `EventContext.runStep`/`runStepAsync` (work steps keyed `event:<id>:<name>`).
  - `StepOptions.rerunnable` — a `started` row left by a crash becomes `failed:interrupted` unless the step is re-runnable.
- `kernel/src/loop/steps.ts:3-28` — exactly once holds only for effects inside the step's own transaction.
- `kernel/src/tools/server.ts`:
  - :10-16 — idempotency key scope `<tool>:session-<sessionId>:<key>`, which a resume keeps.
  - :212-238 `createTask` — INSERT + `task_created` event, run inside `runStep` at :284.
  - `KERNEL_TOOL_NAMES` :32; `kernelToolFullNames()` :48.
- `kernel/src/sessions/manager.ts`:
  - `CLI_BASENAME = "claude"` :64 — the reaper kills a recorded group only when its leader's basename is `claude` AND its start time matches the recorded one (:687, :824-832); otherwise `interrupted` (`pgid_reused`) or `orphaned`.
  - `resumeSession(id, params)` :607 — accepts `interrupted`/`orphaned` rows with an `sdk_session_id`.
  - `reapOrphans()` :720.
  - `spawnClaudeCodeProcess` is wired to the manager's spawner :928, and per-session `mcpServers` come from the factory :890.
- `kernel/src/sessions/types.ts`:
  - `SessionManagerDeps` :245-264 (`query`, `spawn`, `killGroup`, `isGroupAlive`, `readGroupLeader`, …).
  - `StartSessionParams` :63-78; `ResumeSessionParams` :80-88.
  - `DEFAULT_RESUME_PROMPT` :96.
- `kernel/src/sessions/spawner.ts`:
  - `readGroupLeader` :252 runs `TZ=UTC LC_ALL=C ps -o lstart= -o comm= -p <pgid>`: macOS prints the full path, Linux a short name, so compare with `leaderBasename`.
  - `KILL_GROUP_DEADLINE_MS` :30.
- `kernel/src/sessions/policy.ts` — Bash is gated only by `allowedBashPrefixes`.
- `kernel/test/session-fakes.ts` — `FakeChild`, `fakeSessions()`, `makePluginDir(root)` :177, `stubProvider()` :184.
- `kernel/test/sessions-live.test.ts` — the existing opt-in live-test shape: `describe.skipIf(process.env.STUDIO_LIVE !== "1")`, `selectAuthProvider(SUBSCRIPTION_TOKEN_ID, { store })`, `claude-haiku-4-5`.
- `kernel/test/kernel-daemon.test.ts` — `startKernel` with a temp data dir, fake keychain and fake spawner.
- `kernel/scripts/build.mjs` + `scripts/out-dir-guard.mjs` — `node scripts/build.mjs --out-dir <dir>`: a fresh empty dir outside `kernel/` is allowed (layers 1–5).
- `kernel/tsconfig.json` (`include: ["src", "test"]`, no `allowJs`); `kernel/tsconfig.build.json` (`rootDir: src`).
- `docs/DECISIONS.md:17` (D11); `docs/ARCHITECTURE.md:13`, `:117` (CLI), `:128` ("credentials under launchd — not verified yet").
- `docs/OPEN_QUESTIONS.md:22` (Q2 launchd follow-up), `:50` (the `security -i` write path, with item 09's launchd follow-up).
- `docs/ROADMAP.md` (phase 1 row).
- `README.md` (sections: Status, Docs, License).

**Design (the worker may refine names, not behaviour):**

1. **launchd service module — new `kernel/src/service/launchd.ts`, re-exported from `kernel/src/service/index.ts`:**
   - `SERVICE_LABEL = "com.loomwright.studio.kernel"`.
   - `plistPath(homeDir) = <homeDir>/Library/LaunchAgents/com.loomwright.studio.kernel.plist`.
   - `renderPlist({ nodePath, daemonPath, dataDir, env })`: pure. It returns the XML plist with:
     - `Label`;
     - `ProgramArguments` = `[nodePath, daemonPath]` (both absolute; launchd's PATH is minimal);
     - `RunAtLoad` true;
     - `KeepAlive` = `{ SuccessfulExit: false }` (restart after a crash or `kill -9`; a graceful SIGTERM exit 0 is not restarted);
     - `StandardOutPath` `<dataDir>/logs/kernel.out.log` and `StandardErrorPath` `<dataDir>/logs/kernel.err.log`;
     - `EnvironmentVariables` holding ONLY `STUDIO_DATA_DIR` (when set at install time) and `STUDIO_AUTH_PROVIDER` (when set) — never a token or any other variable.

     Every string is XML-escaped (`& < > " '`). A path containing a newline or NUL is refused.
   - `installService(opts, deps)`:
     - creates `<dataDir>/logs` (mode 0700);
     - writes the plist atomically (temp file + rename, mode 0644) to exactly `plistPath(homeDir)`;
     - when `launchctl print gui/<uid>/<label>` exits 0 (already loaded), first runs `launchctl bootout gui/<uid>/<label>`;
     - then runs `launchctl bootstrap gui/<uid> <plistPath>`.

     A failing `bootstrap` throws a one-line error naming the exit status, not launchctl's full output.
   - `uninstallService(opts, deps)`:
     - when loaded, runs `launchctl bootout gui/<uid>/<label>`;
     - then removes `plistPath(homeDir)` if it exists (absent ⇒ fine, idempotent).

     It never globs, lists or touches any other file in `LaunchAgents/`.
   - Deps: `exec` (`execFileSync`-like; `/bin/launchctl` by absolute path), `uid` (default `process.getuid()`), `homeDir`, `platform` (default `process.platform`), and fs writes through the module.
   - `nodePath` defaults to `process.execPath`. `daemonPath` defaults to the built `daemon.js` resolved from the CLI module's own URL (`new URL("../daemon.js", import.meta.url)`), and is refused unless it exists.
   - `platform !== "darwin"` ⇒ a one-line error (`studio service is macOS only`) and no exec.
2. **CLI (`kernel/src/cli/index.ts`):**
   - `parse` gains `service install` and `service uninstall`; `USAGE` is extended.
   - Both run locally through the service module. They need no daemon, no `api.json` and no Keychain read, so they are dispatched BEFORE `readApiInfo`.
   - `CliDeps` gains an optional `service` dep (so tests inject the exec, uid, homeDir and platform).
   - Success prints one line naming the plist path and the label. A failure prints one stderr line and exits 1. `studio service` with anything else prints usage and exits 2.
   - Existing commands are byte-identical in behaviour.
3. **Handler injection for compositions other than the daemon (`kernel/src/kernel.ts`):**
   - `KernelOptions` gains an optional `handlers?: EventHandlers`, passed to `new EventLoop({ store, handlers: options.handlers ?? {} }, …)`.
   - `daemon.ts` never sets it, so the shipped daemon still has no handler (invariant 1). A test asserts the daemon entry passes no handlers (e.g. `kernel-daemon.test.ts` checks that an event enqueued before `startKernel()` without `handlers` ends `event_unhandled`).
   - Nothing else in `startKernel` changes.
4. **Crash harness — new `kernel/test/fixtures/crash-harness.mjs`, plain ESM JS, NOT TypeScript:**
   - Why JS: it runs as its own `node` process against a kernel BUILT into a temp dir, because `tsconfig.json` has no `allowJs` and Node 22.14 cannot run the `.ts` sources with their `.js` specifiers. A test helper in TS (below) builds the kernel once per file into a NESTED dir, `node scripts/build.mjs --out-dir <root>/dist` (`<root>` = a fresh mkdtemp; `out-dir-guard.mjs:41-87` accepts a not-yet-existing out dir under an existing ancestor). It passes `<root>/dist` to the harness by argv/env.
     **A plain tsc emit does not load by itself** (Plan Review attempts 1–2; `build.mjs:46` bundles nothing). The helper must copy the real `kernel/{package.json,node_modules,dist}` layout that `kernel/src/version.ts:6-10` relies on (`kernelVersion()` reads `new URL("../package.json", import.meta.url)`, i.e. the PARENT of the dir holding `version.js`):
     - write `<root>/package.json` = `{"type":"module","version":<kernel/package.json version>}`. Node finds the module type by walking up from `<root>/dist`, and `kernelVersion()` — called by `createKernelMcpServer` on every session launch (`tools/server.ts:393`) — finds a string version. Writing it into `<root>/dist/package.json` instead would leave `kernelVersion()` throwing ENOENT;
     - symlink `<root>/node_modules` → `kernel/node_modules`, so the bare `better-sqlite3`, `@anthropic-ai/claude-agent-sdk` and `zod` imports resolve by the same walk-up.
   - The harness `import()`s `<outDir>/kernel.js` and calls `startKernel({ dataDir, env, handlers: { message: handler }, sessions: { loomwrightPath: <temp plugin dir like makePluginDir> } }, deps)`, with a fake in-memory keychain (`KeychainReader`/`KeychainWriter`) so the real Keychain is never touched.
   - **Ordering (Plan Review attempt 1):** `startKernel` starts the loop (`kernel.ts:183`; first tick on a `setTimeout 0`, `loop.ts:86`) BEFORE it awaits the API server and returns. With `--enqueue`, the first tick can therefore deliver the message before the harness holds the `Kernel`. The handler first awaits a deferred that the harness resolves right after `startKernel` returns. `startKernel` itself does not change for this.
   - The `message` handler is the "playbook" (fault store: `KernelDeps.openStore` lets the harness hand `startKernel` the wrapped store for `--fault`):
     - it starts ONE session for the event and links it durably to the event (e.g. `agent: "exit-test:event-<id>"`);
     - on redelivery after a crash, it finds that session row instead of starting a second one, and resumes it with `kernel.sessions.resumeSession(id, …)` when it is `interrupted`/`orphaned`;
     - it awaits the session's `done` and resolves only when the session `completed`.

     **Step shape (Plan Review attempt 1):**
     - ONE non-rerunnable `ctx.runStepAsync("start-session", …)` that only starts the session and returns its id. `startSession` returns right after launch (`manager.ts:484`), so that step is `done` long before the kill.
     - Looking the session up, resuming it and awaiting its `done` happen OUTSIDE any non-rerunnable step (or in a step marked `rerunnable: true`). A non-rerunnable step left `started` by the kill becomes `failed:interrupted` on redelivery (`steps.ts:178-180`) and would fail the event.
     - Redelivery reads the `start-session` step's stored result (its session id) or the event-linked `agent` label.
   - The session policy is `{ allowedTools: ["mcp__kernel__kernel_task_create", "Bash"], allowedBashPrefixes: ["sleep"] }`, with `permissionMode: "default"`.
   - Modes (argv): `--enqueue` (the first start appends one `message` row before the loop starts); `--fault task-create` (AC4 — see below); `--live` (the live test).
   - In deterministic mode (no `--live`), the harness injects `deps.sessionDeps.query`: a **stand-in session** that takes the place of the SDK `query`. Given the options the manager passes, it:
     1. launches a real process group through `options.spawnClaudeCodeProcess`. The leader is a copy of a real long-sleeping binary named `claude` in a temp dir (e.g. a copy of `/bin/sleep` run as `claude 20`), so the reaper's identity check (basename `claude` + recorded start time, `manager.ts:832`) treats the group as the session's own and KILLS it. A shell script named `claude` is not enough: `ps -o comm=` may report the interpreter. **Verify the leader's `ps -o comm=` basename is `claude` on macOS AND Linux before relying on it.**
     2. emits the init message with an SDK session id;
     3. calls the kernel MCP server's `kernel_task_create` handler (from `options.mcpServers.kernel`) with `idempotency_key: "exit-test-key"`;
     4. waits for the leader to exit, then emits a `result`.

     On a resume (`options.resume` set), it calls `kernel_task_create` again with the SAME key, skips the sleep and emits a `result`. The "same task" assertion lives in the TEST, which reads the db (one task row, the `work_steps` row `done`), not in the stand-in: in Scenario B the first call never returned, and a restarted process has no memory of it.
     - **Calling the tool:** `McpSdkServerConfigWithInstance` has no public call method. Follow the repo precedent (`kernel/test/kernel-tools.test.ts:76`) and call `options.mcpServers.kernel.instance._registeredTools.kernel_task_create`'s handler, or use an MCP client over an in-memory transport. It must be the per-launch server instance the manager passed in, so the session-scoped idempotency key is exercised.
     - **Check:** the manager's conclude/cleanup path with a resume attempt that spawns no child (no pgid). Mirror how the existing fakes in `sessions.test.ts` handle it, or have the resumed stand-in also spawn a short-lived `claude` leader. Mirror the message shapes in `kernel/test/session-fakes.ts` and the `p3-result.json` fixture.
   - `--fault task-create` (AC4, test-only): wrap the store so the statement that INSERTs into `tasks` runs and then the process `SIGKILL`s itself BEFORE `runStep`'s transaction commits (e.g. wrap `store.prepare` for that SQL and call `process.kill(process.pid, "SIGKILL")` after `.run()`). The hook is installed ONLY in this fixture. Nothing in `kernel/src/` gains a fault hook, so `daemon.ts` cannot reach one. If the worker finds a `src` seam unavoidable, it must be an optional injected dep that `daemon.ts` never sets, with a test asserting that. The harness must not install the fault on its restart run.
   - The harness prints one JSON line on stdout once the kernel is up (`{ "ready": true, "pid": … }`) and does nothing else on stdout.
5. **Deterministic crash test — new `kernel/test/crash-resume.test.ts`, runs in `npm test`, CI-safe, no model, no Keychain:**
   - Build once (`beforeAll`, generous timeout).
   - **Scenario A (AC3):**
     1. Spawn the harness with `--enqueue`.
     2. Poll the data dir's SQLite read-only (`better-sqlite3`, `readonly: true`) until the `task_created` event exists AND the stand-in's process group is alive.
     3. `kill -9` the harness pid.
     4. Assert the stand-in group is still alive (the orphan exists).
     5. Spawn the harness again without `--enqueue` and wait for the event row to be `done`.
     6. Then assert:
        - a `session_status` event selected by payload `reason = "group_killed"` (not the first or only `session_status` row: a later resume also writes them, `manager.ts:640`/`:644`) with `to: "interrupted"` (written by the reaper via `#markRow`, `manager.ts:754`) recorded the kill, and `kill(-pgid, 0)` throws `ESRCH`;
        - the session row went through `interrupted` and ended `completed` after a resume;
        - `SELECT count(*) FROM tasks` for the task created via `exit-test-key` is exactly 1, and the `work_steps` row `kernel_task_create:session-<id>:exit-test-key` is `done`;
        - `event_done` was appended exactly once for the queue row, and no second session row exists for the event;
        - the final status of the event row is `done`.
   - **Scenario B (AC4):** the same, with `--fault task-create` on the first start (the process dies inside the transaction). Then:
     - the restart redelivers, and the resumed (or restarted) stand-in calls `kernel_task_create` again;
     - exactly one task row exists;
     - no `task_created` event duplicates.
   - Stop every spawned harness in `afterEach` (SIGTERM, then SIGKILL) and kill any stand-in group left alive, so a failing test leaks no process.
   - Use generous per-test timeouts (the stand-in sleeps; keep the sleep short in deterministic mode, e.g. 5 s, passed by argv).
6. **Live exit test — new `kernel/test/exit-live.test.ts`, skipped unless `STUDIO_LIVE=1`:**
   - Same harness with `--live`: no stand-in `query`; the real subscription-token provider; the real Keychain reader (read-only); `claude-haiku-4-5`.
   - Prompt: call `mcp__kernel__kernel_task_create` with title "exit test" and `idempotency_key: "exit-test-key"`, then run the Bash command `sleep 20`, then reply DONE.
   - Kill -9 when the `tool_decision` allow for the `sleep` Bash call is recorded, then restart. Same assertions as Scenario A, except a resumed model may re-run `sleep`; assert the work completed.
   - The test redacts any token-shaped string (`sk-ant-…`) from what it writes, and writes a run summary (timings, row counts, event kinds; never env or tokens) to a path printed at the end. The owner commits it as AC5 evidence later; this PR commits none.
   - The header comment carries the exact command: `cd kernel && npm run build && STUDIO_LIVE=1 npx vitest run test/exit-live.test.ts`.
7. **Docs:**
   - **README:** a short "Run the kernel as a launchd agent" section:
     - `npm run build`, `npx studio service install`/`uninstall`;
     - the plist path and label; logs in `<dataDir>/logs/`;
     - `launchctl print gui/$(id -u)/com.loomwright.studio.kernel` to check it;
     - if macOS shows a Keychain prompt for `/usr/bin/security` (the kernel reads the Keychain through it), choose "Always Allow" once — never store the token in a file.
   - **`docs/ARCHITECTURE.md`:** replace the :128 "not verified yet" line with what this PR ships (launchd agent, KeepAlive on crash) and note that the launchd Keychain check is the owner's open to-do. Add the `studio service` commands to the CLI bullet (:117).
   - **`docs/OPEN_QUESTIONS.md`:**
     - add an open owner to-do "Phase 1 exit: live run" with the exact commands: install the service; `studio status` from a terminal and with the agent running under launchd; the live exit test command; then commit the summary under `docs/evidence/` and mark ROADMAP phase 1 done;
     - in the Q2 entry (:22) and the `security -i` entry (:50), point to that to-do. Do not mark anything verified that was not run.
   - **`docs/ROADMAP.md`:** NOT modified.

**Tests (vitest; no real SDK in `npm test`, no model call, no real Keychain, no real `launchctl`; temp dirs):**
- `kernel/test/service-launchd.test.ts` (new):
  - `renderPlist`: label, absolute `ProgramArguments`, `RunAtLoad`, `KeepAlive.SuccessfulExit=false`, both log paths under `<dataDir>/logs`, only the allowed env keys, XML escaping of `&`/`<` in a path, refusal of a newline.
  - `installService` with an injected exec and a temp `homeDir`:
    - writes exactly one file at `plistPath(homeDir)` (and nothing else in `LaunchAgents/` — a pre-existing sibling plist is byte-unchanged);
    - creates `<dataDir>/logs`;
    - calls `print` then `bootstrap gui/<uid> <plistPath>` with `/bin/launchctl` by absolute path;
    - when `print` exits 0, calls `bootout gui/<uid>/<label>` before `bootstrap`;
    - a failing bootstrap throws one line.
  - `uninstallService`:
    - boots out the label and removes only that plist (the sibling is untouched);
    - is idempotent when absent.
  - `platform: "linux"` ⇒ the macOS-only error and no exec.
- `kernel/test/cli.test.ts`:
  - `studio service install` / `uninstall` through `runCli` with an injected `service` dep print one line and exit 0, and never read `api.json` or the keychain;
  - an injected failure exits 1 with one stderr line;
  - `studio service` alone exits 2 with usage;
  - every existing test stays green.
- `kernel/test/kernel-daemon.test.ts`:
  - `startKernel` without `handlers` leaves an enqueued `message` row `event_unhandled`;
  - with `handlers: { message }` the handler runs.
- `kernel/test/crash-resume.test.ts` (new) — Scenarios A and B above, passing on macOS and Linux.
- `kernel/test/exit-live.test.ts` (new) — skipped by default; it imports cleanly, so typecheck covers it.
- `npm test` and `npm run typecheck` green in `kernel/`. `npm run build` still emits `dist/daemon.js` and `dist/cli/index.js`.

## Subtask Structure
| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | launchd service module + `studio service` CLI, handler injection in `startKernel`, crash harness, deterministic crash-resume test (AC3/AC4), opt-in live exit test, docs | AC 1, 3, 4 (+ the AC2/AC5 doc parts) | 7 modify, 6 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts
```yaml
# Subtask 1 — launchd service and the crash → resume exit test (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/service/launchd.ts"}
  - {kind: "file", path: "kernel/src/service/index.ts"}
  - {kind: "file", path: "kernel/test/service-launchd.test.ts"}
  - {kind: "file", path: "kernel/test/crash-resume.test.ts"}
  - {kind: "file", path: "kernel/test/exit-live.test.ts"}
  - {kind: "file", path: "kernel/test/fixtures/crash-harness.mjs"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "SERVICE_LABEL"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "renderPlist"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "installService"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "uninstallService"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "startKernel"}
  - {kind: "symbol", path: "kernel/src/cli/index.ts", name: "runCli"}
requires: []
lanes:
  - "kernel/src/service/**"
  - "kernel/src/cli/**"
  - "kernel/src/kernel.ts"
  - "kernel/src/daemon.ts"
  - "kernel/test/**"
  - "README.md"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "macOS /bin/launchctl bootstrap|bootout|print with the gui/<uid> domain (man launchctl) — not run by this job; unit tests inject the exec"
  - "/bin/ps -o lstart= -o comm= on macOS and Linux procps (already used by the reaper)"
  - "Node >= 22 built-ins node:child_process, node:fs; better-sqlite3 read-only open of the data dir db from the test process"
```
Modified files (7): `kernel/src/kernel.ts` (`KernelOptions.handlers` only), `kernel/src/cli/index.ts` (`service install|uninstall`), `kernel/test/cli.test.ts`, `kernel/test/kernel-daemon.test.ts`, `README.md`, `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`. `kernel/src/daemon.ts` is in the lane but should need no change. Created (6, +1 optional): `kernel/src/service/{launchd,index}.ts`, `kernel/test/{service-launchd,crash-resume,exit-live}.test.ts`, `kernel/test/fixtures/crash-harness.mjs`, plus an optional small TS build/spawn helper (e.g. `kernel/test/crash-helpers.ts`).

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
- `skills/unit-testing/SKILL.md` — vitest, temp dirs, injected exec/uid/homeDir/platform, a real child process killed with SIGKILL, read-only SQLite assertions, leak-free `afterEach`
- `skills/error-handling/SKILL.md` — one-line CLI failures, launchctl failures without dumping output, macOS-only refusal

## Risk Assessment
| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| Owner-run steps (live exit test, `launchctl bootstrap`, Keychain under launchd) are not executed by this job; AC2's result and AC5 stay open after merge | MEDIUM | HIGH | Owner decision. The PR body and `docs/OPEN_QUESTIONS.md` list the exact commands. ROADMAP is not touched; the item's closeout must not be read as "phase 1 done" | Feasibility (Phase 2.5) |
| The stand-in leader is not recognised as the session's CLI, so the reaper marks it `pgid_reused` and never kills it (AC3's "group reaped" fails, or a `sleep` leaks) | HIGH | MEDIUM | A copy of a real binary named `claude` (not a script). Verify `ps -o comm=` on macOS and Linux. The test asserts `group_killed` and `ESRCH`; `afterEach` kills any surviving group | Phase 3 (`manager.ts:832`) |
| The process-level test is flaky or slow on CI (build time, timing of the kill, Linux `ps` differences) | MEDIUM | MEDIUM | Build once per file; poll the db for readiness instead of sleeping; a short stand-in sleep; generous timeouts. The kill fires only after `task_created` + a live group are observed | Feasibility (Phase 2.5) |
| The redelivered handler starts a second session (duplicated work) | HIGH | MEDIUM | The session is linked to the event durably; redelivery looks it up and resumes it. The test asserts one session row per event and `event_done` once | Phase 3 |
| A fault hook reachable from the shipped daemon | HIGH | LOW | The hook lives only in `test/fixtures/crash-harness.mjs` (store wrapper); nothing in `src/` | Requirement (AC4) |
| `KernelOptions.handlers` used to ship a default handler (invariant 1 drift) | MEDIUM | LOW | `daemon.ts` never sets it; a test asserts an unhandled event without handlers | Requirement / CLAUDE.md invariant 1 |
| `studio service` touches another plist, or writes a secret into the plist | HIGH | LOW | One fixed path, no glob or listing. `EnvironmentVariables` is restricted to two non-secret keys. Tests assert a sibling plist is byte-unchanged and the env keys | Requirement (AC1) |
| launchd starts the daemon with a minimal PATH/env; a relative node or daemon path fails | MEDIUM | MEDIUM | Absolute `process.execPath` and the resolved `daemon.js`, refused when missing | Phase 3 |
| KeepAlive restart loop when the daemon fails at start (e.g. no Keychain access under launchd) | MEDIUM | MEDIUM | `SuccessfulExit=false` plus launchd's default throttle. The README says where the logs are and how to uninstall. The owner's live check covers it | Phase 3 |
| Typecheck pulling in the `.mjs` fixture | LOW | LOW | `tsconfig.json` has no `allowJs`, so `.mjs` is ignored; the TS tests only spawn it | Phase 3 |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-02-09-launchd-and-crash-resume.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-03T03:01:16Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/21
- **Branch:** feature/phase1-09-launchd-and-crash-resume
- **Files changed:** 15
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** studio service install|uninstall as a per-user launchd agent (one fixed plist, RunAtLoad, KeepAlive SuccessfulExit=false, logs under <dataDir>/logs, env limited to STUDIO_DATA_DIR + STUDIO_AUTH_PROVIDER), KernelOptions.handlers (daemon passes none), deterministic kill -9 crash→resume test (AC3 mid-command, AC4 inside kernel_task_create; fault only in the test harness), opt-in live exit test (not run), README/ARCHITECTURE/OPEN_QUESTIONS docs; ROADMAP untouched (AC2 result + AC5 deferred by owner decision). Self-heal FAIL→fix b4edca8 (plist log dir vs daemon data dir could diverge; one shared auth-provider env check)→PASS. No rubric; red_team_advisory: disabled; risk_classification high_risk true (auth/token/secret/size). 4 LOW + 1 pre_existing dismissed for owner decision.

## Not verified
- **real launchctl bootstrap/bootout/print (studio service install/uninstall)** — owner decision: no real launchctl this run; exec injected in unit tests (subtask 1)
- **Keychain reads under launchd without a terminal (AC2 result)** — owner-run after merge; step 2 of the "Phase 1 exit: live run" to-do in docs/OPEN_QUESTIONS.md (subtask 1)
- **kernel/test/exit-live.test.ts (STUDIO_LIVE=1, Haiku)** — owner decision: no model calls; written, typechecked, skipped by default (subtask 1)
- **crash-resume.test.ts on Linux CI** — not run locally on Linux; the code reviewer reports the PR's ubuntu CI run passed it (subtask 1)
- **AC5 evidence + ROADMAP phase 1 entry** — deferred by owner decision; ROADMAP.md not edited (subtask 1)
