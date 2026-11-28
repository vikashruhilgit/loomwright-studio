# 23n — A stopped session's run lock is released, or Resume says when it opens

## Status: in_progress

**Observed live (2026-11-17).**
- Session 215 ended mid-item at 20:48. It left `.supervisor/run.lock/meta` with pid 30666 (session 215's process group, now dead) and `session_id auto-2026-11-17-resume`.
- 23l listed the run as stranded and offered Resume. The owner pressed it at 21:06.
- Session 216 started, and Loomwright parked the run `pause_reason: run_lock_held`. Session 216 rightly did not force-unlock.

**Root cause.**
- The kernel runs Loomwright in host mode (D40). In host mode, Loomwright 17.38.0's SessionEnd close-out (`close-stranded-run.sh`) deliberately skips releasing the run lock.
- Loomwright's acquire reclaims a dead holder's lock only once it is `LOCK_TTL_SECONDS` (1800 s) old.
- Studio's 23l check read "holder dead" as "not held", so it offered a Resume that Loomwright had to refuse.

**Decision.** D46 (owner, 2026-11-17).

**Fix (branch `fix/service-path-gh-git`, uncommitted).**
- New module `kernel/src/loomwright/run-lock.ts`:
  - `deadLockOf` reads whether the lock is the kernel's own: its pid is the process group of an ended kernel session in this checkout.
  - `releaseKernelLock` runs Loomwright's `run-lock.sh liveness --pid`, then, only on `dead`, `release --session-id`. It never uses `--force-unlock`.
- `startRun` releases the kernel's own dead lock before every launch and records `released_lock_of`. Any other young dead lock is refused `lock_settling`.
- `GET /automate/paused-runs` blocks such a run `lock_settling`, with `resume_at`. The card says "Can resume at HH:MM".
- Tests: `kernel/test/automate-resume.test.ts`, "a dead holder's run lock (D46)", which uses the session 215 values. The lock fixture now writes `ts` in epoch seconds, as 17.38.0 does.

**Not yet verified live.**

<!-- loomwright:requirement-closeout -->
## Status: done_with_escalation
- **Completed:** 2026-11-28T07:32:01Z
- **Brief:** unknown
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/291
- **Owed:** live check: a kernel session's dead run lock is released through run-lock.sh before the next launch, and a foreign lock shows Can resume at
