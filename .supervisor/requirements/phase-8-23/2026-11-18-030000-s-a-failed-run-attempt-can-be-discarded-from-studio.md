# 23s — A failed run attempt can be discarded from Studio

## Status: open (requirement; not built)

**Why.** A Parked or stranded run card offers only Resume, which carries on from whatever the last attempt left behind. After 23r's attempt, starting `automate-2026-11-17-001` cleanly needed several hand steps from an agent shell:
- delete the attempt's local and remote branch (`feature/cheer-sh`, `3599b52`);
- leave a duplicate approval (56) undecided;
- remove an untracked scratch file;
- live with a stale Supervisor `state.md`.

A step that needs a shell is a product gap, not an owner instruction.

**Observed gaps (2026-11-18).**
1. **No Studio action discards an attempt.** The branch cleanup was done by hand: local `git branch -D`, then `git push origin --delete` on the owner's word.
2. **Loomwright 17.38.0 has no sanctioned manual close for a stranded Supervisor run.**
   - `close-stranded-run.sh` runs only as the owning session's SessionEnd hook.
   - `supervisor-next-step.sh` has no close/abandon flag.
   - `/janitor` (`janitor-report.sh`) does not list a stale `running` `state.md` at all. Its only "stale run state" row was the run's config backup.
   - The sandbox `state.md` still reads `studio-resume-002`, `status: running`, `branch: feature/add-cheer-sh` (a branch that no longer exists). It is left as is: hand-writing a `session_end` would forge Loomwright's log.
3. **Reproduced in a test and live (2026-11-18); fixed.** `approvals/store.ts` (~l.680, 23o). Any decision on a run session's request queues a `continue` of the requesting session. `launch.ts` skips only a gone, mismatched or live session. So denying a stale request from a superseded session (approval 56, from session 226, after 227/228 ran) starts a new run session on 226's SDK session.
   - **Live:** the owner denied 56 at 02:23:34Z. Event 809 continued session 226 as **session 229**, which made no tool calls and ended in 37 s saying it would not push. No harm, but it was a stray run session.
   - **Test:** `kernel/test/automate-resume.test.ts`, "a decision on a superseded run session's request continues nothing once a later Resume ran the run", before the fix a third session started with `continueFrom: 301` (the superseded session) after the later Resume ran in 302. Plus `kernel/test/run-sessions.test.ts` for which later sessions count.
   - **Fix (branch `fix/service-path-gh-git`, uncommitted):** `automate/run-sessions.ts` `laterRunSessionOf` finds a later kernel run session of the same run (same checkout, and the same `run_id`, backlog, or repo and PR). `launch.ts` skips the continuation with `continue_session_superseded: session N's run went on in session M`. A continuation's own held call still continues it, because no later session exists.
   - **Honest limit:** a backlog launch names no run id, so a later Resume of the run it created is not matched to it, and that case still continues.

**Requirement (owner to shape).**
- **A Discard attempt action on a parked or stranded run card.** Before acting, it lists exactly what it will remove: the attempt's local branch, and its remote branch if pushed, which needs a separate confirmation because it is outward-facing.
- **Pending approvals raised by the discarded attempt's sessions are withdrawn.** They are not decided, so no continuation is queued.
- **Loomwright leftovers are cleared only through Loomwright's own sanctioned steps** (janitor `act`, run-close paths). Where none exists (gap 2), Studio shows it and files a Loomwright finding. It never edits Loomwright's files itself.
- **After a discard, Resume runs the item fresh.**

**Exit check.** From a run card in a state like 23r's, one Discard leaves:
- no attempt branch, local or remote;
- no pending approval from that attempt, with no session started by withdrawing it;
- the next Resume reaching the driver's `run` spawn on a clean checkout.
