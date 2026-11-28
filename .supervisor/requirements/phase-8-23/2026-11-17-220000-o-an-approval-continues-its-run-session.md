# 23o — An approval continues the run session that asked

## Status: in_progress

**Observed live (2026-11-17).**
- Run session 217 committed `ac930cb` and was held at `git push -u origin feature/add-cheer-sh` (approval 53). It ended its turn.
- Approving 53 woke the crew member's own thread (session 218). It tried the push itself and was refused `bash_prefix_not_allowed`.
- Resume ran session 219, which pushed under approval 53 and was held at `gh pr create` (approval 54). Approving 54 woke session 220, which also tried the call and was refused.
- The next Resume (session 221) ran the item again from a fresh Supervisor. `/autonomous` mints a new session id on every run, so the Supervisor started over at ACQUIRE and parked `acquire_branch_collision` on the branch the first attempt had pushed. The run file now records "no PR: supervisor_failed_other".

**Root cause.** A decision went to the crew thread, never to the run session that held the call. Only a Resume could continue the run, and a Resume restarts the item.

**Decision.** D47 (owner, 2026-11-17).

**Fix (branch `fix/service-path-gh-git`, uncommitted).**
- `approvals/store.ts` queues an `automate_run` `continue` event for a run session's approval. `automate/run-sessions.ts` finds the launch behind the session.
- `automate/launch.ts` continues that session with `continueFrom`, under its launch kind's policy.
- Tests: `kernel/test/automate-resume.test.ts`, "an approval held by a run session continues that session (23o)". Four of its tests fail without the routing change.

**Not yet verified live.** `automate-2026-11-17-001` itself needs a separate recovery: its run file says no PR, while Supervisor checkpoint `auto-2026-11-17-resume` is still at publish.

**Verified live (2026-11-18).** Run session 227 was held at `git push -u origin feature/cheer-sh` (approval 57) and ended its turn. The owner approved 57 once at 01:58:44Z. The kernel queued event 800 (`automate_run.kind: continue`, `of: resume`, `session: 227`) and started session 228 1.4 s later on the same SDK session (`4b6dcb5e…`), with no Resume. The rail allowed the push as `approval_granted`. (The run itself had left Loomwright's flow by then; see 23r.)

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-28T07:32:03Z
- **Brief:** unknown
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/291
