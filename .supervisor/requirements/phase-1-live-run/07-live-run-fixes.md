# H07+H08: Phase 1 live-run fixes (launchd install and start check, protected folders, tool process containment)

## Status: ready

**Priority:** MVP · **Blocks the phase 1 live exit run** · invariants 2 and 3, D31

One item, one PR (owner decision, 2026-10-06). It combines H07 and H08 because neither unblocks the live run on its own and both are tested together in that run. Build part A first: part B's live test runs under the fixed install path.

## Story

As the owner, I want two things:
- the background kernel runs from a place launchd can read, and install reports success only when the kernel actually answers;
- stopping a session, the kill switch, and the reaper after a crash kill every process a session's tools started.

So that the kernel works under launchd no matter where the repo lives, a broken install is never reported as working (D31), no tool command outlives its session (invariant 2), and `studio stop --all` really stops everything (invariant 3).

## Evidence

### Part A: launchd install (verified on the owner's Mac, 2026-10-06, `main` at 77775c8)

- The plist runs the build in place. `daemonPath` defaults to the repo's `dist/daemon.js` (`kernel/src/service/launchd.ts:320`) and `nodePath` defaults to `process.execPath` (`:191-192`). This repo is in `~/Documents`, so the kernel exited at once under launchd with `EPERM … open '…/kernel/dist/daemon.js'`. A throwaway `launchctl submit` job with the same `node` reproduced it: reading the repo file failed with `EPERM`, while reading a file in `/private/tmp` succeeded. The terminal can read `~/Documents`; a background launchd job can't (macOS privacy protection, TCC).
- `service install` printed "installed and loaded" (`kernel/src/cli/index.ts:353`) while launchd showed `last exit code = 1` and `state = spawn scheduled`. Nothing checks that the kernel came up.
- The plist's `node` was `/Users/vikashruhil/.nvm/versions/node/v22.14.0/bin/node`. That's an nvm path, which breaks if that version is removed.

### Part B: tool processes (verified 2026-10-06 with `probes/p8-tool-process-group.mjs`, SDK 0.3.284, CLI 2.1.284)

- The kernel spawns the CLI with `detached: true` (`kernel/src/sessions/spawner.ts:106-115`), so the CLI leads its own session and group (`sid = pgid = 37241`). Stopping, reaping and the kill switch all use `kill(-pgid)` of that group (`killGroupUntilGone`, `spawner.ts`).
- The CLI starts each Bash tool shell with a **new session and a new process group**: the shell was `zsh`, `sid = pgid = 50064`. The tool command (`sleep`) runs in the shell's group, as a descendant of the CLI by parentage only. So `kill(-37241)` doesn't reach it. This is why the live exit test timed out (`exit-live.test.ts:122`, waiting for `sleep` in the session's group) and why Q5 saw a background job outlive a killed kernel.
- **Unproven, so don't rely on it:** finding processes by an environment tag. A variable set on the CLI was not visible on the tool shell through `ps -E`, and neither was any of the CLI's own variables, so the result can't be read either way.
- `ps -o sess` prints `0` for every process on macOS. Use `getsid()` (or `ps -o pgid`) wherever a session or group id is needed.

## Acceptance criteria

### Part A: launchd install location, start check, protected folders (was H07)

A1. **Given** `studio service install`, **when** it runs, **then** it copies the built kernel (`dist/` plus the production `node_modules` it needs at runtime, including `better-sqlite3`'s native binary) to `~/.loomwright-studio/app/<kernel version>/`, or under `STUDIO_DATA_DIR` when that's set, and points `ProgramArguments` at the copy. The copy is written to a temporary directory and renamed into place, so a half-written copy is never used. Re-installing the same version replaces it. Older versions are removed only after the new agent has started.

A2. **Given** the install target, **when** it resolves to a macOS-protected location (under `~/Documents`, `~/Desktop`, `~/Downloads`, or `~/Library/Mobile Documents`), **then** install refuses and names D31. This guards against `STUDIO_DATA_DIR` pointing into one.

A3. **Given** a loaded agent, **when** install finishes, **then** it waits (bounded, ≤ 15 s) until the kernel answers `GET /status` on the loopback API.
   - If it answers, install prints the installed path and the kernel version.
   - If it doesn't, install prints the last 20 lines of `kernel.err.log` and the agent's `last exit code` from `launchctl print`, exits non-zero, and **unloads the agent** so it can't restart in a loop.

   "Installed and loaded" is printed only on a verified start.

A4. **Given** `nodePath` under `~/.nvm/`, `~/.volta/`, `~/.asdf/`, or another version-manager directory, **when** install runs, **then** it prints a one-line warning that the agent breaks if that Node version is removed. Install still proceeds; there's no new flag.

A5. **Given** a session start (item 05's `startSession` and resume), **when** its `cwd` is inside a protected location (same list as A2), **then** the session manager refuses with `SessionError("protected_cwd", …)` naming D31. Nothing is spawned. The refusal is appended to `events`.

A6. **Given** `studio service uninstall`, **when** it runs, **then** it also removes `~/.loomwright-studio/app/`. Data, logs and the store are kept.

A7. Unit tests, with injected `exec` and filesystem, cover:
   - the copy and its atomic rename;
   - the protected-target refusal;
   - the start check passing, and failing with log tail plus unload;
   - the nvm warning;
   - the `protected_cwd` refusal.

   No test runs `launchctl`.

A8. `README.md` ("Run the kernel as a launchd agent") states the install location, the start check and D31's rule about repo locations.

### Part B: tool process containment (was H08)

B1. **Given** a running session, **when** the kernel polls (every ≤ 1 s) for the CLI leader's descendants, found by walking parent pids from a single `ps -A -o pid=,ppid=,pgid=,lstart=` snapshot, **then** every descendant process group not seen before is recorded in a new `session_groups` table with these columns:
   - `session_id`;
   - `pgid`;
   - the group leader's executable path;
   - the group leader's start time (from `lstart`);
   - `first_seen`.

   The write is committed before the next poll. The new store migration takes the next free number.

B2. **Given** `stopSession`, the kill switch or the reaper, **when** it kills a session, **then** it kills the CLI's group **and** every recorded group of that session, each through `killGroupUntilGone`. A recorded group is signalled **only** if its leader still has the recorded executable and start time; otherwise the pgid may have been reused, and it's skipped, never signalled. Every kill and skip is appended to `events`.

B3. **Given** kernel start-up (the reaper), **when** an orphaned session's CLI is still alive, **then** the reaper first walks the CLI's descendants once more and records any new groups, then kills everything as in B2. **When** the CLI has already exited, **then** it kills the recorded groups, still checking ownership.

B4. **Given** the live exit test (`exit-live.test.ts`), **when** it waits for the tool command, **then** it looks for `sleep` among the session's recorded groups (or among the CLI's descendants), not only in the CLI's group. **After** the restart and reap, it asserts that the `sleep` process is gone. The deterministic test (`crash-resume.test.ts`) gets a stand-in session that forks a child into a **new session and group** (as the CLI does), and asserts the same thing.

B5. **Given** a group created after the kernel died, whose CLI then exited before the kernel restarted, **when** the reaper runs, **then** it can't be found. This limit is documented in code at the reaper and in `docs/ARCHITECTURE.md` (Session manager), with the reason: launchd restarts the kernel within seconds, which keeps the window small but not zero. Don't claim it's covered.

B6. Unit tests use an injected `ps`/`kill`, and cover:
   - descendant discovery across a new session and group;
   - the reused-pgid skip;
   - stop, kill switch and reaper each killing recorded groups;
   - the CLI-already-exited reaper path.

B7. `docs/OPEN_QUESTIONS.md` step 5(c) is updated to say that it's answered (they're *not* in the group) and that H08 contains them.

## Out of scope

- Part A: A signed app bundle, a login item through `SMAppService`, and Full Disk Access (all excluded by D31).
- Part B: Environment-tag containment, unless a probe first proves the tag reaches tool shells. Linux (the kernel targets macOS; note the gap). Any change to the CLI itself.

## Dependencies

H01–H06 merged, and the store migrations from H03 and H05. Part B's new migration takes the next free number.

## Risks

### Part A

- Copying `node_modules` must include `better-sqlite3`'s compiled `.node` file for this machine's architecture. Verify by starting the copy, which is exactly what A3 does.
- The protected-folder list is macOS policy and may grow; keep it in one constant with a comment linking D31.

### Part B

- Polling can miss a group that lives less than one poll interval. That's acceptable, since such a group is gone anyway. Say so in code.
- `ps` output parsing must be locale-safe (`LC_ALL=C`) and must handle `lstart`'s fixed format.
- The ownership check is what keeps the kernel from killing an unrelated process that reused a pgid. Its test is the most important one here.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-06T04:05:32Z
- **Brief:** .supervisor/jobs/done/2026-10-06-h07-h08-live-run-fixes.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/37
