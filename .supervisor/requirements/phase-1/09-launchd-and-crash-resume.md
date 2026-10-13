# 09: launchd service and the phase 1 exit test (crash → resume, no duplicated work)

## Status: ready

**Priority:** MVP · **Phase 1 exit criterion**

## Story

As the owner, I want the kernel to run as a launchd agent and to prove that a `kill -9` mid-session loses at most the current step, so that phase 1 is done by the roadmap's own definition.

## Acceptance criteria

1. **Given** `studio service install`, **when** it runs, **then** it writes `~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`:
   - `RunAtLoad` and `KeepAlive` on crash;
   - stdout and stderr go to files under the data dir;
   - the plist is loaded with `launchctl bootstrap gui/$UID`.

   `studio service uninstall` reverses all of this. Neither command touches any other plist.
2. **Given** the kernel running under launchd, **when** it reads the Keychain token (item 04), **then** it works without a terminal. This closes the Q2 follow-up "login reachable under launchd". If macOS shows an access prompt, the steps for granting access once are documented in the README. Record the result in `docs/OPEN_QUESTIONS.md`.
3. **Given** the exit test, an opt-in live test (`STUDIO_LIVE=1`, Haiku, the owner's machine only), **when** it runs, **then** it:
   1. starts the daemon;
   2. enqueues a message that makes a session call `kernel_task_create` with a fixed idempotency key and then run a slow allowlisted command (`sleep 20`);
   3. `kill -9`s the daemon mid-command;
   4. restarts it.

   It then asserts:
   - the orphaned session's process group was reaped;
   - the session resumed or was cleanly marked `interrupted`;
   - **exactly one** task row exists for the key;
   - no event is processed twice;
   - the work continues to completion.
4. **Given** the same test with the kill during `kernel_task_create` itself (a fault-injection hook in test builds only), **when** it restarts, **then** there's still exactly one task.
5. **Given** a successful run, **when** it finishes, **then** its output is saved as evidence under `probes/` or `docs/evidence/`, with tokens redacted, and `docs/ROADMAP.md` phase 1 is marked done with the date.

## Out of scope

Auto-update, code signing (commercial readiness), the always-on host (phase 10).

## Dependencies

All of 01–08.

## Risks

- Running launchd in CI isn't possible, so AC 1–4 are owner-machine tests.
- A Keychain prompt under launchd may need a one-time manual grant. Document it; never work around it by storing the token in a file.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-03T03:01:16Z
- **Brief:** .supervisor/jobs/done/2026-10-02-09-launchd-and-crash-resume.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/21
