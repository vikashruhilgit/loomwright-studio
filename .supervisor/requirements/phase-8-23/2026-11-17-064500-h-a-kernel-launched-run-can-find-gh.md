# 23h — A kernel-launched run can find `gh`

## Status: in_progress

**Observed live (2026-11-17, walk step 1, kernel `7ed3f0cd` as the launchd service on the API key).** Run session 213 (playbook 17) created its first run file with Write (23e works), then its driver's first `--start pick` parked at `trail-gate`: `PARK — gh unavailable`, `pause_reason: trail_pr_open`. The session's own `gh auth status` answered `command not found: gh` (exit 127). `gh` is at `/opt/homebrew/bin/gh`; the service plist sets only `STUDIO_DATA_DIR` and `STUDIO_AUTH_PROVIDER`, so the daemon and every session it starts get launchd's minimal `PATH` (no `/opt/homebrew/bin`). Every Loomwright step that reads or writes GitHub needs `gh` (trail gate, PR create, drains), so no kernel-launched run can get past its first step on this machine.

Also seen in the same walk: the two launch events (348, 349) were refused `agent_sessions_at_once` (p8-22 allows 1 session at once, and its crew session was still live) and retried until the crew session ended; 348's run then started. A run session's `bash <install>/scripts/gate-auto.sh list` was denied `bash_prefix_not_allowed` (not an admitted script); the session used it only to diagnose.

**Ask.** A kernel-launched run finds the `gh` (and `git`) the owner uses, by a mechanism the kernel owns and the owner can see, not by inheriting whatever `PATH` launchd gives. Open: how (a `PATH` recorded at `service install` from the installer's resolved `gh`/`git`, or the kernel resolving each by absolute path at launch and prepending only those directories to the session's `PATH`). Then resume the parked run `automate-2026-11-17-001`.

**Fix (2026-11-17, branch `fix/service-path-gh-git`, uncommitted).** `studio service install` resolves `gh` and `git` through the installing shell's `PATH` and writes a plist `PATH` of only the dirs they were found in (installer order), then launchd's default (`resolveServiceToolPath`, `kernel/src/service/launchd.ts`). Install's success line names where each was found; a missing one is a warning. Kernel suite green (4883). Not yet installed live.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-28T07:31:56Z
- **Brief:** unknown
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/291
