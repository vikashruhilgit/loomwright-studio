# Supervisor Job: H07+H08 — launchd install location and start check, protected folders, tool process containment

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariant 2: no tool command may outlive its session, the kernel owns lifecycle; invariant 3: the kill switch must really stop everything; invariant 1: protected-folder refusal is a fixed safety mechanism (D31), not a playbook policy)
- **Git:** clean except two untracked owner files (`.supervisor/requirements/h01-launchd-start-failure-and-reinstall-plan.md`, `.supervisor/requirements/h05-budget-cap-park-keys-plan.md`) and the automate engine's run file under `.supervisor/automate/`. Never stage any of them; commit with explicit paths only. Branch: main @ aaba744
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 (CI: ubuntu-latest, `node-version: 22`; `.github/workflows/ci.yml` runs `bash scripts/check-docs.sh`, then in `kernel/` `npm ci`, `npm run typecheck`, `npm test`, `npm run build` — tests run BEFORE the build, so no unit test may depend on `kernel/dist`; CI is Linux, so any test that needs macOS `ps`/`launchctl` behaviour must inject it)
- **Blockers:** 0 | **Warnings:** 1 (untracked owner files + automate run file — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1-live-run/07-live-run-fixes.md
- **Base commit:** aaba74430b22c8b05ab3ad80948cd9b71ffb55c6

## Feasibility
- **Verdict:** GO
- Tech stack — GO: strict TypeScript kernel (NodeNext, vitest), better-sqlite3; no new package.
- Dependencies — GO: none new. The production dependency closure for the install copy is derivable offline from `kernel/package-lock.json` (lockfile v3 marks dev-only entries `"dev": true`).
- Architecture fit — GO: Part A stays in `kernel/src/service/` + the CLI + one session-manager guard; Part B stays in `kernel/src/sessions/` + one store migration. `spawner.ts` stays the only module under `src/sessions/` that imports `node:child_process`.
- Scope — GO (split): ~22 files across two coherent parts; two sequential subtasks (`context-bound`).
- Hard blockers — GO: none. The descendant-walk premise (tool shell is a descendant of the CLI by parentage, in a new session and group) was verified by `probes/p8-tool-process-group.mjs` (recorded in `docs/OPEN_QUESTIONS.md`, Phase 1 exit step 6).

## Task
**Goal:** Make the background kernel run from an unprotected, versioned install copy and have `studio service install` report success only when the kernel actually answers; refuse sessions whose `cwd` is in a macOS-protected folder (D31); and make stop, the kill switch and the reaper kill every process group a session's tools started, not only the CLI's own group.

**Problem statement:** the owner's first phase 1 live exit run (2026-10-06, `main` at 77775c8) failed: under launchd the kernel exited at once with `EPERM` reading `kernel/dist/daemon.js` from `~/Documents` (TCC), while `service install` printed "installed and loaded"; and the Bash tool's `sleep` ran in a new session/group outside the CLI's group, so `kill(-pgid)` of the CLI (stop, reaper, kill switch) left it running. The owner repeats the live run after this PR merges.

## Acceptance Criteria

### Part A — launchd install location, start check, protected folders (subtask 1)
- [ ] **A1 — versioned install copy.** Given `studio service install`, when it runs, then it copies the built kernel (`dist/`, `package.json` — `kernelVersion()` reads `../package.json` relative to `dist/`, `kernel/src/version.ts:9-10` — plus the production `node_modules` needed at runtime, including `better-sqlite3`'s compiled `.node` and the installed `@anthropic-ai/claude-agent-sdk-*` platform package that holds the CLI binary) to `<dataDir>/app/<kernel version>/` (`<dataDir>` = `~/.loomwright-studio`, or `STUDIO_DATA_DIR` when set — `resolveDataDir`), and the plist's `ProgramArguments` daemon path points at `<copy>/dist/daemon.js`. The copy is written to a temporary sibling directory and renamed into place; a half-written copy is never used. Re-installing the same version replaces it. Older version directories under `<dataDir>/app/` are removed only after the new agent passed the A3 start check.
- [ ] **A2 — protected install target refused.** Given an install target (the `<dataDir>/app/…` copy dir, after symlink resolution) inside `~/Documents`, `~/Desktop`, `~/Downloads` or `~/Library/Mobile Documents`, when install runs, then it refuses before copying, writing or loading anything, with one line naming D31. The protected list lives in ONE exported constant with a comment linking D31, shared with A5.
- [ ] **A3 — verified start.** Given a loaded agent, when install finishes the bootstrap, then it waits (bounded, ≤ 15 s, injected clock/sleep) until the new kernel answers `GET /status` on the loopback API with 200 (token from the Keychain through the CLI's existing injectable `keychain`/`fetch`/`isPidAlive` deps). A stale `api.json` left by the previous kernel must never count as the new kernel answering (e.g. require `api.json`'s pid to equal the pid `launchctl print` reports for the job, or another check the implementer documents). Until the deadline, a missing or unreadable `api.json`, a pid mismatch, a missing or empty API token (on a first install the `loomwright-studio-api` Keychain item exists only once the new kernel has created it, `OPEN_QUESTIONS.md:27`), a refused connection or a non-200 answer all mean "not up yet" and the check keeps polling — never the CLI's immediate "kernel daemon is not running" failure (`cli/index.ts:376-384`). On success it prints the installed path and the kernel version; "installed and loaded" is printed only on a verified start. On failure it prints the last 20 lines of `<dataDir>/logs/kernel.err.log` and the agent's `last exit code` from `launchctl print`, **boots the agent out** (so it cannot restart in a loop) **and removes the plist** (as `uninstall` does, so `RunAtLoad` cannot start the broken kernel again at the next login; the install copy and `<dataDir>` are kept), and exits non-zero. When the log tail shows a Keychain read/write failure or timeout, the failure output adds one hint line: a Keychain prompt for `security` may be waiting — choose **Always Allow**, then run `service install` again (the 15 s bound stays).
- [ ] **A4 — version-manager node warning.** Given a `nodePath` under `~/.nvm/`, `~/.volta/`, `~/.asdf/`, `~/.fnm/`, `~/.nodenv/` or `~/.local/share/fnm/` (one constant), when install runs, then it prints a one-line warning that the agent breaks if that Node version is removed. Install still proceeds; no new flag.
- [ ] **A5 — protected `cwd` refused.** Given `startSession` or `resumeSession`, when `params.cwd` (after symlink resolution where it exists) is inside a protected location (A2's list), then the manager throws `SessionError("protected_cwd", …)` naming D31, before admission, auth or any spawn; nothing is spawned; the refusal is appended to `events` (kind e.g. `session_refused`, payload `{reason: "protected_cwd", cwd}`; `session_id` NULL for a start, the session's id for a resume — `#recordSafely`/`#appendEvent` (`manager.ts:1481`, `:1713`) take `sessionId: number` today, so widen to `number | null` or write the row directly). `"protected_cwd"` is added to `SessionErrorCode`.
- [ ] **A6 — uninstall removes the app dir.** Given `studio service uninstall`, when it runs, then it also removes `<dataDir>/app/`. Data, logs and the store are kept.
- [ ] **A7 — unit tests (injected exec and filesystem; no test runs `launchctl`, the Keychain or a model):** the copy and its atomic rename (incl. same-version replace, old versions removed only after a verified start); the protected-target refusal; the start check passing (including a token that appears only after N polls), and failing with log tail + `last exit code` + bootout + plist removed + non-zero exit; a stale `api.json` not accepted; the nvm warning; the `protected_cwd` refusal on start and on resume, with its `events` row and no spawn.
- [ ] **A8 — docs.** `README.md` ("Run the kernel as a launchd agent", lines 14-34) states the install location `<dataDir>/app/<version>/`, the start check (and its failure output, unload and plist removal), D31's rule about repo locations, the Keychain-prompt hint (answer the first `security` prompt within the start check, or re-run install), and replaces the bullet saying the plist points at this checkout's `dist/daemon.js`. `docs/ARCHITECTURE.md` (the launchd bullet at line 129 and the CLI bullet at line 117, which says `service` needs no `api.json` or Keychain — no longer true for the start check) and the Session manager section say the same. `bash scripts/check-docs.sh` passes.

### Part B — tool process containment (subtask 2)
- [ ] **B1 — record descendant groups.** Given a running session, when the kernel polls (every ≤ 1 s; one manager-wide poll over all live sessions per tick is fine) a single `LC_ALL=C TZ=UTC ps -A -o pid=,ppid=,pgid=,lstart=,comm=` snapshot (comm last: it may contain spaces), and walks parent pids from the CLI leader (`attempt.pgid` == the CLI's pid), then every descendant process group other than the CLI's own that was not seen before is recorded in a new `session_groups` table: `session_id`, `pgid`, the group leader's executable path, the group leader's start time (from `lstart`), `first_seen`. The write is committed before the next poll. A group whose leader is not in the snapshot cannot be ownership-checked later and is not recorded (say so in code). The new store migration is `010` (`kernel/src/store/migrations/010_session_groups.ts`, appended to `migrations` in `index.ts`). The poll never blocks the event loop (async `ps`), uses the injected scheduler, and stops when the session's attempt ends.
- [ ] **B2 — kill recorded groups.** Given `stopSession`, the kill switch (`stopAll`, both `stop` and `shutdown` modes) or the reaper — and, since they share `#killAttemptGroup`, a session's natural end and crash cleanup too — when it kills a session, then it kills the CLI's group **and** every recorded group of that session, each through `killGroupUntilGone`. A recorded group is signalled ONLY if `readGroupLeader(pgid)` shows its leader still has the recorded executable and start time (same tolerance as `LEADER_START_TOLERANCE_MS`, `manager.ts:72`); otherwise (another executable/start time, leader absent, or `ps` failed) it is skipped and never signalled. Every kill and skip is appended to `events` (e.g. `session_group_killed`, `session_group_skipped` with `reason`, `session_group_kill_incomplete`). An `abandoned` row's groups are never signalled.
- [ ] **B3 — reaper.** Given kernel start-up (`reapOrphans`), when an orphaned session's CLI is still alive and proven the session's (`#checkGroup` → `ours`), then the reaper first walks the CLI's descendants once more (one snapshot) and records any new groups, then kills everything as in B2. When the CLI has already exited (`group_gone`, `no_pgid`, or `pgid_reused`), then it still kills the recorded groups, with the B2 ownership check. A recorded group that survives its kill deadline stays flagged so the next reap retries it — see the kill-flag note in Implementation Notes (the existing `kill_incomplete_at` code is keyed on the CLI's pgid and cannot be reused as is).
- [ ] **B4 — tests find the tool command.** `kernel/test/exit-live.test.ts` (opt-in, `STUDIO_LIVE=1`) waits for `sleep` among the session's recorded groups (`session_groups`) or the CLI's descendants, not only in the CLI's group (line 122), and after the restart and reap asserts that the `sleep` process is gone. The deterministic `kernel/test/crash-resume.test.ts` stand-in session (`standInQuery` in `kernel/test/fixtures/crash-harness.mjs`) forks a child into a **new session and group** (as the CLI does, e.g. a `detached: true` spawn), and the test asserts that child's group is recorded and is gone after the restart and reap.
- [ ] **B5 — documented limit.** A group created after the kernel died whose CLI then exited before the restart can't be found by the reaper. This limit is documented in code at the reaper and in `docs/ARCHITECTURE.md` (Session manager), with the reason (launchd restarts the kernel within seconds: small window, not zero). Also documented: a group living less than one poll interval may be missed (it is gone anyway); Linux is not targeted (note the gap). Never claim the gaps are covered.
- [ ] **B6 — unit tests (injected `ps`/`kill`/scheduler; no real `ps` parsing of the host, no model):** descendant discovery across a new session and group (leader → shell in a new group → command); the reused-pgid skip (recorded exe or start time differs ⇒ never signalled, skip event); stop, kill switch and reaper each killing recorded groups; the CLI-already-exited reaper path; the snapshot parser (locale-safe `lstart`, comm with spaces).
- [ ] **B7 — open question answered.** `docs/OPEN_QUESTIONS.md` "Phase 1 exit: live run" step 5(c) says it is answered (tool commands are *not* in the CLI's group) and that H08 contains them (use the phrase "H08 contains them").

Global: `cd kernel && npm run typecheck && npm test && npm run build` green; `bash scripts/check-docs.sh` green. Unit tests never call the real SDK, a model, `launchctl` or the Keychain. Live tests stay opt-in (`STUDIO_LIVE=1`) and are not run by the worker.

## Implementation Notes (verified at planning time, main @ aaba744)

### Part A (subtask 1)
- `kernel/src/service/launchd.ts:316-341` `installService` is synchronous (`Atomics.wait` sleep, `defaultSleep` `:169-171`); `:320` defaults `daemonPath` to the module-relative `../daemon.js` (the checkout's `kernel/dist`), `:326` passes `options.nodePath ?? process.execPath`. The copy source root is the kernel dir the running module came from (`new URL("../..", import.meta.url)` from `dist/service/launchd.js`); keep `options.daemonPath`/source overridable for tests. If the source root already IS the install target (install run from an installed copy), do not copy onto itself — refuse with one line or skip the copy; pick one and test it.
- **Names (the outputs gate checks them):** export `copyKernelApp` (the A1 copy) and `verifyServiceStart` (the A3 check) from `kernel/src/service/launchd.ts`, and `PROTECTED_LOCATIONS` + `isProtectedPath` from `kernel/src/protected-paths.ts`.
- **Copy recipe (recommended, offline):** read `kernel/package-lock.json` `packages`; copy every `node_modules/<name>` entry that is not `"dev": true` and exists on disk (optional platform packages for other architectures are absent and skipped), plus `dist/` and `package.json`; skip `node_modules/.bin`. Use `fs.cpSync(…, {recursive: true, verbatimSymlinks: true})` or equivalent. Do NOT run `npm ci` during install (network, slow). The SDK platform package is ~216 MB; expect a slow first copy.
- **Atomic rename:** temp dir `<dataDir>/app/.<version>.<pid>.tmp`, rename to `<dataDir>/app/<version>`; for a same-version reinstall rename the old dir aside first, rename the new one in, then remove the old one; a failure removes the temp dir and leaves any existing copy intact. Note: the running agent's daemon has its files open from the old copy — replacing the dir before `bootout` is fine on macOS (open files survive rename/unlink), but write the plist + bootout/bootstrap after the new copy is in place.
- **Protected list (A2/A5):** a new leaf module, e.g. `kernel/src/protected-paths.ts`, exporting the list (relative to the home dir) and `isProtectedPath(path, homeDir)`: resolve with `fs.realpathSync.native` on the longest existing ancestor (the target may not exist yet), then compare case-insensitively on a path-segment boundary (APFS is case-insensitive by default). `sessions/manager.ts` imports it; it imports nothing from `service/` or `sessions/`.
- **A3 start check:** `launchctl` stdout is never read today (`defaultExec`, `:158-167`, stdout `"ignore"`; `ServiceExecResult` doc `:148`); the check needs `launchctl print`'s `pid = N` and `last exit code = N` lines. Extend the exec contract (e.g. an optional stdout capture used only for `print`, bounded, parsing only those two keys) and update the module header comment (`:15-17`). The HTTP probe is async: either make install async or add an async verifier the CLI calls after `installService`; the CLI already has `keychain`, `fetch`, `isPidAlive` deps and `readApiInfo` (`kernel/src/cli/index.ts:63-81`, `:358-360`, `:376-398`) — reuse them. `kernel/src/cli/index.ts:347-357` is the `service` dispatch; `:353` prints "installed and loaded" unconditionally today. Under launchd an unfixable start failure exits 0 (not restarted) and other failures retry once a minute (README `:30`), so the 15 s wait sees one start attempt; bootout on failure stops the retries.
- **A4:** `nodePath` is `process.execPath` by default; compare against `homeDir`-relative version-manager dirs (one constant).
- **A5:** `startSession` validates params at `kernel/src/sessions/manager.ts:440-446` then resolves Loomwright and admits (`:448-453`); `resumeSession` validates at `:638-640`. Insert the check right after the `cwd` validation in both, before admission/auth/spawn. `SessionErrorCode` is at `kernel/src/sessions/types.ts:125-133`; the API maps `SessionError` codes only for abandon (`kernel/src/api/server.ts:346`), so no API change is needed. `events.session_id` is nullable (`001_initial.ts:54-62`).
- **A6:** `uninstallService` (`launchd.ts:346-352`) needs the data dir: accept `options.dataDir`/`env` like install and remove `<dataDir>/app/` only (never `logs/`, the store or anything else).
- Tests: `kernel/test/service-launchd.test.ts` (injected exec/uid/homeDir/platform; extend with an injected fs or a temp HOME/data dir) and `kernel/test/cli.test.ts` (service install output now depends on the start check — inject it).

### Part B (subtask 2)
- Export `snapshotProcessTable`, `parseProcessTable` and `descendantGroups` from `kernel/src/sessions/spawner.ts` (the outputs gate checks them).
- `kernel/src/sessions/spawner.ts:1-2` — the ONLY module under `src/sessions/` that imports `node:child_process`: the `ps -A` snapshot function and its parser live here (e.g. `snapshotProcessTable()` async + a pure `parseProcessTable(text)`, and a pure `descendantGroups(table, leaderPid)`). Reuse the `lstart` regex/month table (`:253-255`) and `PS_ENV` (`:229`, `LC_ALL=C`, `TZ=UTC`). `ps -o sess` prints 0 on macOS — never use it.
- **Kill seam:** `#killAttemptGroup` (`manager.ts:1422-1446`) is shared by `#stop` (`:1379-1405`, used by `stopSession`/`stopAll`), `#conclude` via `#reapAttemptGroup` (`:1340`, `:1407-1412`), `#crash` (`:1355-1377`) and resume failures; extend it (or a sibling it calls) to kill the session's recorded groups after the CLI group, recording events through `#recordSafely`. `stopAll` is called by `POST /stop-all` (`kernel/src/api/server.ts:311-315`) and by kernel shutdown in `shutdown` mode (`kernel/src/kernel.ts:157`).
- **Reaper:** `#reapAll` (`manager.ts:812-863`) → `#reapOne` (`:916-926`) → `#checkGroup` (`:934-945`). Add the B3 descendant walk only on `ours` with the leader present; kill recorded groups on every reap outcome except `abandoned` rows (never selected) — including `group_gone`/`no_pgid`/`pgid_reused`. `#retryTerminalKills` (`:865-914`) should also retry flagged recorded groups.
- **Kill-flag trap (Plan Review):** `#flagKillIncomplete` (`manager.ts:1469-1478`) updates `WHERE id = ? AND pgid = ?` with the CLI's pgid, so a recorded group's pgid matches no row; and `#retryTerminalKills` clears the flag `WHERE id = ? AND pgid IS ?` (`:909`) once the CLI group is gone or foreign, even while a recorded group may still live. Keep a per-group `kill_incomplete_at` on `session_groups` (or flag the row by session id) and clear a row's retry state only when the CLI group AND every recorded group are confirmed gone or skipped. Unit test: CLI group gone, recorded group survives its kill ⇒ still flagged, and the next `reapOrphans` retries and kills it.
- **Ownership check:** compare the recorded exe path with `readGroupLeader(pgid).command` (macOS prints the full path; Linux procps prints a ≤15-char name — both sides are read on the same host, so keep it an exact-string compare of the two `comm` values and add no path-only logic) and start times within `LEADER_START_TOLERANCE_MS`. Leader `absent` ⇒ skip (B2 is explicit), even though `#checkGroup` treats a leaderless live CLI group as ours — see Risk Assessment.
- **Poll:** start it when `onSpawn` records the pgid (`manager.ts:1044-1066`), stop on `attempt.exited`; one in-flight snapshot at a time; `INSERT OR IGNORE` keyed on `(session_id, pgid, leader_started_at)`.
- **Tests:** existing `kernel/test/sessions-process-group.test.ts`, `kill-switch.test.ts`, `sessions-stop-all.test.ts` and `kernel/test/session-fakes.ts` inject `killGroup`/`isGroupAlive`/`readGroupLeader`; add an injectable snapshot dep (`SessionManagerDeps`). `kernel/test/crash-helpers.ts:178` `groupHasCommand` already reads `ps -A -o pgid=,comm=`. The harness stand-in (`crash-harness.mjs:151-160`) spawns the leader via `options.spawnClaudeCodeProcess` with `-e setTimeout(...)`; make that leader script spawn a detached grandchild (new session + group) whose pid it writes somewhere the test can read, or have the test find it through `session_groups`.
- Docs: `docs/ARCHITECTURE.md` "Session manager (Q5)" (line 81 on) and the kill-switch bullet (`:109`); `docs/OPEN_QUESTIONS.md` step 5(c) (line 21) and the step 6 finding (line 25) that says "Fix: H08 tracks the descendants".

## Subtask Structure

| # | Title | Criteria | Est. Files | Skills | Status |
|---|-------|----------|-----------|--------|--------|
| 1 | Part A: versioned launchd install copy, verified start, protected install target and session cwd (D31), docs | A1–A8 | 9–12 modify + 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Part B: record tool process groups (`session_groups`), kill them on stop / kill switch / reaper with ownership check, crash and live tests, docs | B1–B7 | 14–16 modify + 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | BLOCKED by #1 |

## Subtask Contracts
```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/protected-paths.ts"}
  - {kind: "symbol", path: "kernel/src/protected-paths.ts", name: "isProtectedPath"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "protected_cwd"}
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "protected_cwd"}
  - {kind: "symbol", path: "kernel/src/protected-paths.ts", name: "PROTECTED_LOCATIONS"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "copyKernelApp"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "verifyServiceStart"}
  - {kind: "symbol", path: "README.md", name: "D31"}
requires: []
lanes:
  - "kernel/src/protected-paths.ts"
  - "kernel/src/service/launchd.ts"
  - "kernel/src/service/index.ts"
  - "kernel/src/cli/index.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/index.ts"
  - "kernel/test/service-launchd.test.ts"
  - "kernel/test/cli.test.ts"
  - "kernel/test/protected-paths.test.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/test/session-fakes.ts"
  - "README.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "macOS launchctl print output keys `pid =` and `last exit code =` (parsed, never run in tests)"
```

```yaml
# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/store/migrations/010_session_groups.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/010_session_groups.ts", name: "session_groups"}
  - {kind: "symbol", path: "kernel/src/store/migrations/index.ts", name: "010_session_groups"}
  - {kind: "symbol", path: "kernel/src/sessions/spawner.ts", name: "descendantGroups"}
  - {kind: "symbol", path: "kernel/src/sessions/spawner.ts", name: "parseProcessTable"}
  - {kind: "symbol", path: "kernel/src/sessions/spawner.ts", name: "snapshotProcessTable"}
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "session_groups"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "H08 contains them"}
requires:
  # Serializes the shared manager.ts / types.ts / ARCHITECTURE.md edits (file-conflict) after Part A.
  - {from: "1", kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "protected_cwd"}
lanes:
  - "kernel/src/sessions/spawner.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/index.ts"
  - "kernel/src/store/migrations/010_session_groups.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/test/sessions-process-group.test.ts"
  - "kernel/test/sessions-tool-groups.test.ts"
  - "kernel/test/kill-switch.test.ts"
  - "kernel/test/sessions-stop-all.test.ts"
  - "kernel/test/session-fakes.ts"
  - "kernel/test/store.test.ts"
  - "kernel/test/crash-resume.test.ts"
  - "kernel/test/crash-helpers.ts"
  - "kernel/test/fixtures/crash-harness.mjs"
  - "kernel/test/exit-live.test.ts"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "macOS ps -A -o pid=,ppid=,pgid=,lstart=,comm= output (injected in unit tests; real only in crash-resume and the opt-in live test)"
```

Modified (est.): subtask 1 — `kernel/src/service/launchd.ts`, `kernel/src/cli/index.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/sessions/types.ts`, `README.md`, `docs/ARCHITECTURE.md`, tests `kernel/test/service-launchd.test.ts`, `kernel/test/cli.test.ts`, `kernel/test/sessions.test.ts`; created `kernel/src/protected-paths.ts`, `kernel/test/protected-paths.test.ts`. Subtask 2 — `kernel/src/sessions/spawner.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/sessions/types.ts`, `kernel/src/store/migrations/index.ts`, `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`, tests `kernel/test/sessions-process-group.test.ts`, `kernel/test/kill-switch.test.ts`, `kernel/test/sessions-stop-all.test.ts`, `kernel/test/session-fakes.ts`, `kernel/test/crash-resume.test.ts`, `kernel/test/crash-helpers.ts`, `kernel/test/fixtures/crash-harness.mjs`, `kernel/test/exit-live.test.ts`, possibly `kernel/test/store.test.ts`; created `kernel/src/store/migrations/010_session_groups.ts`, `kernel/test/sessions-tool-groups.test.ts`.

## Parallelism Analysis
### Dependency Graph
```
Subtask 1 ──▶ Subtask 2   (file overlap: kernel/src/sessions/manager.ts, kernel/src/sessions/types.ts, kernel/src/sessions/index.ts, docs/ARCHITECTURE.md, kernel/test/session-fakes.ts)
```
### File Overlap Matrix
| | 1 | 2 |
|---|---|---|
| 1 | — | manager.ts, types.ts, sessions/index.ts, session-fakes.ts, ARCHITECTURE.md |
| 2 | (same) | — |
### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after subtask 1 is merged into the feature branch)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References
- `skills/unit-testing/SKILL.md` — injected exec/fs/ps/kill/scheduler, deterministic stand-in processes.
- `skills/error-handling/SKILL.md` — fail closed on unverifiable ownership, one-line CLI failures, bounded waits.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/service/launchd.ts:320` | yes | HOLDS | `const daemonPath = options.daemonPath ?? fileURLToPath(new URL("../daemon.js", import.meta.url));` | tip 6 minutes ago, fetched <1h |
| `kernel/src/service/launchd.ts:191` (`:191-192`) | yes | HOLDS | `/** Defaults to \`process.execPath\`. */` (`nodePath?: string`, 192) | tip 6 minutes ago, fetched <1h |
| `kernel/src/cli/index.ts:353` | yes | HOLDS | ``stdout.write(`studio: service ${r.label} installed and loaded (${r.plistPath})\n`);`` | tip 6 minutes ago, fetched <1h |
| `kernel/src/sessions/spawner.ts:106` (`:106-115`) | yes | HOLDS | `export function spawnInNewProcessGroup(` … `detached: true,` (114) | tip 6 minutes ago, fetched <1h |
| `exit-live.test.ts:122` | yes | HOLDS | `await waitFor("sleep running in the session's process group", () => (groupHasCommand(pgid, "sleep") ? true : undefined), 30_000, 100);` | tip 6 minutes ago, fetched <1h |

No STALE rows.

### Blast-Radius / Impact Prediction

> Advisory — from `twin-graph.sh`, subordinate to `CLAUDE.md`.

| Touched Subsystem | Depends On | Depended-on-by | Source Contract | Incident History |
|-------------------|-----------|----------------|-----------------|------------------|
| `kernel/src/service/launchd.ts` | auth/provider-env.ts, daemon.ts, store/store.ts | docs/ARCHITECTURE.md, cli/index.ts | — | — |
| `kernel/src/sessions/manager.ts` | auth/types.ts, loomwright-path.ts, orphans.ts, policy.ts, spawner.ts, types.ts, store/store.ts | docs/ARCHITECTURE.md, api/server.ts, kernel.ts, sessions/index.ts, tools/server.ts | — | — |
| `kernel/src/sessions/spawner.ts` | sessions/types.ts | docs/ARCHITECTURE.md, cli/index.ts, sessions/index.ts, manager.ts | — | — |

**Predicted ripple beyond directly-touched files:** `kernel/src/api/server.ts` (`/stop-all` → `stopAll`; `/status` may want to list recorded groups — not required), `kernel/src/kernel.ts` (shutdown `stopAll({mode: "shutdown"})`, start-up `reapOrphans()`), `kernel/src/daemon.ts` (the install copy must be self-contained for it). Run the whole suite.

## Risk Assessment
| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| B2 ownership check fails open and SIGKILLs an unrelated process that reused a pgid | HIGH | LOW | Signal only when exe path AND start time match; `ps` failure or absent leader ⇒ skip + event; the reused-pgid test is the most important test in this PR | Requirement "Risks" |
| Leaderless recorded group skipped: a tool shell exits while its background child lives on in the shell's group, so B2's literal rule leaves it running (the CLI group precedent, `#checkGroup`, treats a live leaderless group as ours because a pid is not reused while its group exists) | MEDIUM | MEDIUM | Follow B2 literally in this PR (skip, `reason: "leader_gone"` event so it is visible); name it in the PR body as an owner decision for a follow-up, do not silently widen B2 | Phase 3 |
| Install copy misses a runtime file (native `.node`, the SDK platform package with the CLI binary, `package.json` for `kernelVersion()`), so the agent fails under launchd | HIGH | MEDIUM | Derive the closure from `package-lock.json` (non-dev, present on disk); A3's start check catches it and unloads; a unit test asserts `better_sqlite3.node`, the platform package dir and `package.json` are in the copy | Requirement "Risks" |
| A3 accepts a stale `api.json` from the previous kernel and reports success for a kernel that never started | HIGH | MEDIUM | Bind the probe to the new job (pid from `launchctl print` == `api.json` pid, or a freshness check); explicit stale-`api.json` test | Phase 3 |
| Reading `launchctl print` stdout widens the "stdout is never read" contract | LOW | LOW | Parse only `pid =` / `last exit code =`, bounded; update the module header and ARCHITECTURE | Phase 3 |
| Poller cost/leaks: `ps -A` every second, timer kept alive after the session ends, overlapping snapshots | MEDIUM | LOW | One manager-wide snapshot per tick, one in flight, injected scheduler, stop on attempt exit; tests with fake scheduler | Phase 3 |
| `ps` parsing breaks on locale or a comm with spaces | MEDIUM | LOW | `LC_ALL=C TZ=UTC`, comm last, pure parser with tests | Requirement "Risks" |
| Protected-path check bypassed by symlinks or case (`~/documents`) | MEDIUM | LOW | `realpathSync.native` on the longest existing ancestor; case-insensitive segment-boundary compare; tests for both | Phase 3 |
| Crash-resume test becomes flaky waiting for the poller to record the grandchild group | MEDIUM | MEDIUM | Wait for the `session_groups` row before the kill; bounded waits as the existing helpers do; afterEach kills the grandchild by its own recorded pgid | Phase 3 |
| A3's 15 s start check boots out a healthy kernel that is waiting on the first Keychain prompt (`keychain.ts:17-18`: 10 s per read/write; the first start reads the OAuth token, then writes and reads back the never-created `loomwright-studio-api` item, `OPEN_QUESTIONS.md:27`), so the owner's repeat live run fails at install | MEDIUM | MEDIUM | Keep the 15 s bound; the failure output names the likely cause when `kernel.err.log` shows a Keychain read/timeout and says to choose Always Allow and re-run; README says the same; unit test for the hint | Plan Review attempt 1 |
| `crash-resume.test.ts` has no platform skip, so it runs the real `ps` snapshot and descendant walk on Linux CI (procps: short `comm`, same `lstart` shape, `spawner.ts:254`) | MEDIUM | MEDIUM | Parser accepts procps output; ownership compare is exact-string `comm` vs `readGroupLeader`'s `comm` (same host on both sides); run the test locally on macOS and rely on CI for Linux | Plan Review attempt 1 |
| Recorded-group kill failures never flagged/retried because the existing flag is keyed on the CLI pgid | MEDIUM | HIGH (if reused as is) | Per-group flag; clear only when all groups confirmed; dedicated unit test (Implementation Notes) | Plan Review attempt 1 |
| Part A and Part B both edit `manager.ts`/`types.ts`/`ARCHITECTURE.md` | LOW | MEDIUM | Sequential batches (subtask 2 BLOCKED by 1) | Phase 4 |
| Doc edits break `scripts/check-docs.sh` | LOW | LOW | Run it locally | Phase 3 |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Split reason:** context-bound
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-06-h07-h08-live-run-fixes.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-06T04:05:32Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/37
- **Branch:** feature/h07-h08-live-run-fixes
- **Files changed:** 22
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** H07 (A1–A8) + H08 (B1–B7) in two sequential subtasks: 09fc4ae (versioned launchd install copy, verified start with bootout + plist removal on failure, D31 protected install target and session cwd, uninstall removes app dir) and 1a9e26a (session_groups migration 010, 1 s ps -A descendant poll, recorded tool groups killed with the CLI group on stop / kill switch / natural end / crash / reaper with an exe + start-time ownership check, per-group retry flags, crash-resume grandchild test). 783 tests green. Phase 4.5 iteration 1 PASS (diff_review; adversarial repros a–f held); 6 findings dismissed below the fix floor (2 MEDIUM: firmlink /System/Volumes/Data bypass of the D31 check; kill switch reports stopped while a flagged tool group may live — 4 LOW/nit). risk_classification high_risk=true (size 2904 lines/22 files, migration, auth/token content; advisory). Until-mergeable drain suppressed by /automate (owned inline drain follows).

## Not verified
- **studio service install / uninstall on a real Mac under launchd (copy size and time, launchctl print output keys, start check, rollback)** — unit tests inject launchctl, the Keychain and fetch; needs the owner's live run (subtask 1)
- **kernel/test/exit-live.test.ts against the real CLI and model** — opt-in STUDIO_LIVE=1; workers must not run live tests (subtask 2)
- **crash-resume.test.ts tool-group recording and reap on Linux procps** — only run locally on macOS; relies on CI ubuntu (subtask 2)
