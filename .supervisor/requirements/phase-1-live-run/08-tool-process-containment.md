# H08: Stopping or reaping a session also kills the processes its tools started

## Status: ready

**Priority:** MVP · **Blocks the phase 1 live exit run** · invariants 2 and 3

## Story

As the owner, I want stopping a session, the kill switch, and the reaper after a crash to kill every process a session's tools started, not just the CLI's own process group, so that no tool command outlives its session (invariant 2) and `studio stop --all` really stops everything (invariant 3).

## Evidence (verified 2026-10-06 with `probes/p8-tool-process-group.mjs`, SDK 0.3.284, CLI 2.1.284)

- The kernel spawns the CLI with `detached: true` (`kernel/src/sessions/spawner.ts:106-115`), so the CLI leads its own session and group (`sid = pgid = 37241`). Stopping, reaping and the kill switch all use `kill(-pgid)` of that group (`killGroupUntilGone`, `spawner.ts`).
- The CLI starts each Bash tool shell with a **new session and a new process group**: the shell was `zsh`, `sid = pgid = 50064`. The tool command (`sleep`) runs in the shell's group, as a descendant of the CLI by parentage only. So `kill(-37241)` doesn't reach it. This is why the live exit test timed out (`exit-live.test.ts:122`, waiting for `sleep` in the session's group) and why Q5 saw a background job outlive a killed kernel.
- **Unproven, so don't rely on it:** finding processes by an environment tag. A variable set on the CLI was not visible on the tool shell through `ps -E`, and neither was any of the CLI's own variables, so the result can't be read either way.
- `ps -o sess` prints `0` for every process on macOS. Use `getsid()` (or `ps -o pgid`) wherever a session or group id is needed.

## Acceptance criteria

1. **Given** a running session, **when** the kernel polls (every ≤ 1 s) for the CLI leader's descendants, found by walking parent pids from a single `ps -A -o pid=,ppid=,pgid=,lstart=` snapshot, **then** every descendant process group not seen before is recorded in a new `session_groups` table with these columns:
   - `session_id`;
   - `pgid`;
   - the group leader's executable path;
   - the group leader's start time (from `lstart`);
   - `first_seen`.

   The write is committed before the next poll. The new store migration takes the next free number.
2. **Given** `stopSession`, the kill switch or the reaper, **when** it kills a session, **then** it kills the CLI's group **and** every recorded group of that session, each through `killGroupUntilGone`. A recorded group is signalled **only** if its leader still has the recorded executable and start time; otherwise the pgid may have been reused, and it's skipped, never signalled. Every kill and skip is appended to `events`.
3. **Given** kernel start-up (the reaper), **when** an orphaned session's CLI is still alive, **then** the reaper first walks the CLI's descendants once more and records any new groups, then kills everything as in AC 2. **When** the CLI has already exited, **then** it kills the recorded groups, still checking ownership.
4. **Given** the live exit test (`exit-live.test.ts`), **when** it waits for the tool command, **then** it looks for `sleep` among the session's recorded groups (or among the CLI's descendants), not only in the CLI's group. **After** the restart and reap, it asserts that the `sleep` process is gone. The deterministic test (`crash-resume.test.ts`) gets a stand-in session that forks a child into a **new session and group** (as the CLI does), and asserts the same thing.
5. **Given** a group created after the kernel died, whose CLI then exited before the kernel restarted, **when** the reaper runs, **then** it can't be found. This limit is documented in code at the reaper and in `docs/ARCHITECTURE.md` (Session manager), with the reason: launchd restarts the kernel within seconds, which keeps the window small but not zero. Don't claim it's covered.
6. Unit tests use an injected `ps`/`kill`, and cover:
   - descendant discovery across a new session and group;
   - the reused-pgid skip;
   - stop, kill switch and reaper each killing recorded groups;
   - the CLI-already-exited reaper path.
7. `docs/OPEN_QUESTIONS.md` step 5(c) is updated to say that it's answered (they're *not* in the group) and that H08 contains them.

## Out of scope

Environment-tag containment, unless a probe first proves the tag reaches tool shells. Linux (the kernel targets macOS; note the gap). Any change to the CLI itself.

## Dependencies

H07 (the live test runs under the fixed install path), and the store migrations from H03 and H05.

## Risks

- Polling can miss a group that lives less than one poll interval. That's acceptable, since such a group is gone anyway. Say so in code.
- `ps` output parsing must be locale-safe (`LC_ALL=C`) and must handle `lstart`'s fixed format.
- The ownership check is what keeps the kernel from killing an unrelated process that reused a pgid. Its test is the most important one here.
