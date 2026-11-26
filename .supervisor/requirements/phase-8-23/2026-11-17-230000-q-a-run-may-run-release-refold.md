# 23q — A run may run release-refold.sh when it runs no repo code

## Status: in_progress

**Observed live (2026-11-17, session 224).** The run committed `d156b1a` (cheer.sh) on `feature/add-cheer-sh`. The Supervisor's FINALIZE then told the session to run `release-refold.sh`, and the run policy refused it (`bash_prefix_not_allowed`). FINALIZE parked the item `release_refold_refused`: no push, no PR, and the brief moved to `jobs/failed/`.

**Root cause.** 23k left `release-refold.sh` out on the belief that the driver runs it itself. It does not. `supervisor-next-step.sh` (FINALIZE commit procedure) tells the session to run it, and the review-heal drain runs it before each push.

**Fix (branch `fix/service-path-gh-git`, uncommitted).**
- `release-refold.sh` is admitted to the inline-phase and review-pr script lists.
- The session gate (`kernel/src/loomwright/release-refold-gate.ts`) refuses the call `loomwright_repo_code` in two cases:
  - a `scripts/bump-version.sh` exists where the script would run it;
  - the arguments are anything but none or `--root <absolute dir>`.
- Tests: `kernel/test/release-refold-gate.test.ts` (it includes session 224's call), plus the script-list tests.

**Honest limit.** The check is made when the call is decided.

**Not yet verified live.**
Still unverified (2026-11-18). Resumed sessions 226–228 never reached FINALIZE, so `release-refold.sh` was never called (23r).
