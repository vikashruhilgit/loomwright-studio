# H01: launchd start failures don't loop, reinstall is reliable, the live exit test can't flake or leak

## Status: ready

**Priority:** MVP · **Do before the owner's phase 1 live exit run**

## Story

As the owner, I want a kernel that fails to start under launchd to stop cleanly instead of restarting every 10 seconds, and `studio service install` to work when run a second time, so that the live exit run and the Keychain-under-launchd check (item 09's owner to-dos) test the kernel, not a restart loop.

## Evidence (verified against `main` at 4429d4b on 2026-10-03)

- **F09-2 (still present).** The plist sets `KeepAlive {SuccessfulExit: false}` with no `ThrottleInterval` (`kernel/src/service/launchd.ts:102-106`). `daemon.ts:40` calls `process.exit(1)` on any start failure. Two start failures reach that path: a held store lock (`StoreLockedError`, `kernel.ts:141`) and a Keychain read in `ensureApiToken` (`kernel.ts:164-169,194-196`). launchd's default throttle is one spawn per 10 s (`man launchd.plist`), so the kernel restarts every ~10 s forever, `kernel.err.log` keeps growing, and the Keychain may prompt each time. A teardown error during a graceful stop also exits 1 (`daemon.ts:51`) and restarts.
- **F09-1 (unhandled in code; real-world behaviour unverified).** `launchd.ts:228-230` runs `bootout` and then `bootstrap` immediately, with no wait for the job to be gone and no retry on exit status 5. The README's reinstall path (`README.md:31`, "run `service install` again") takes exactly this path.
- **F09-3 (still present).** `kernel/test/exit-live.test.ts:69-87` sends the kill when the `tool_decision` allow row appears. The permission gate writes that row (`manager.ts:1443`) before the SDK spawns `sleep`, so the `groupAlive` check at `:89` can race. `afterEach` (`:52-54`) doesn't kill the process group of an already-killed harness (`crash-helpers.ts:106`), so a failed live run leaves a real CLI group running and leaks `tmp` (`rmSync` runs only on success, `:144`). `crash-resume.test.ts:59` already uses `killOwnGroup` for this.
- **F09-4 (still present).** `test/service-launchd.test.ts` always injects `exec`. As a result, these launchd.ts paths are untested:
  - `defaultExec`'s spawn-error and killed-by-signal paths (`:122-130`)
  - the invalid-uid refusal (`:169`)
  - the relative `daemonPath` refusal (`:216`)
  - the `writePlistAtomic` cleanup (`:191-203`)

  Separately, `cli/index.ts:245` (the CLI's production `dataDir`, i.e. `deps.dataDir === undefined`) is untested.

## Acceptance criteria

1. **Given** a start failure that a retry can't fix, **when** the daemon exits, **then** launchd doesn't restart it. The canonical case is the store lock held by another live kernel. The daemon writes one line to stderr naming the cause.
2. **Given** a start failure that may clear by itself (for example the Keychain is locked or unreadable), **when** the daemon exits, **then** launchd restarts it no more than once every 60 s, and each failure writes one line naming the cause. The plist sets `ThrottleInterval`, and the unit test that reads the generated plist pins the value.
3. **Given** a graceful SIGTERM whose teardown throws, **when** the daemon exits, **then** the exit doesn't start a restart loop. The teardown error is logged.
4. **Given** `studio service install` with the job already loaded, **when** it runs, **then** after `bootout` it polls `launchctl print` until the job is gone, for a bounded time (≤ 5 s). It then runs `bootstrap` and retries once if `bootstrap` exits with status 5. If it still fails, it reports the real exit status and stderr. Unit tests cover the poll, the retry and the final failure with an injected `exec`.
5. **Given** the live exit test (`STUDIO_LIVE=1`), **when** it sends the kill, **then** it first confirms that `sleep` is running in the session's process group, for example with a `ps` of the group. The comment "(the command is running)" is then true.
6. **Given** a live exit run that fails at any point, **when** `afterEach` runs, **then** it kills the tracked process group with `killOwnGroup` and removes `tmp`, so no CLI process outlives the test.
7. **Given** `test/service-launchd.test.ts` and `cli.test.ts`, **when** they run, **then** they cover the five paths named under F09-4. The `defaultExec` tests use a fake binary, never the real `launchctl`.
8. `docs/ARCHITECTURE.md` (the launchd section) and the README say how a start failure behaves under launchd, which failures restart, and at what rate.

## Out of scope

Running the live exit test, `studio service install` on the owner's machine and the Keychain-under-launchd check. Those stay owner to-dos from item 09, and this item makes them safe to run. Code signing.

## Dependencies

Phase 1 items 01–09 (merged).

## Risks

- CI can't run launchd, so AC 4's real-world behaviour (whether `bootout` is asynchronous) stays unverified until the owner's run. Record the result in `docs/OPEN_QUESTIONS.md` when it's known.
- The exit-code split in AC 1–2 must never hide a failure: every exit path writes its cause to `kernel.err.log`.

## Source

Dismissed review findings from run `automate-2026-09-30-211858`, re-verified 2026-10-03: `proposed/automate-2026-09-30-211858--09-launchd-and-crash-resume-e54f71--dismissed-summary.md` entries 1–4.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-03T14:49:37Z
- **Brief:** .supervisor/jobs/done/2026-10-03-h01-launchd-start-failure-and-reinstall.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/23
