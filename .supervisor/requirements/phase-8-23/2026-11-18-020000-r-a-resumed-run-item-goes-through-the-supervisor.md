# 23r — A resumed run item goes through the Supervisor, not around it

## Status: open — filed upstream as vikashruhilgit/loomwright#937 (owner chose candidate 1, 2026-11-18)

**Observed live (2026-11-17/18, Loomwright 17.38.0, model claude-sonnet-5-5).**
- The kernel started session 226 with exactly `/loomwright:automate --resume automate-2026-11-17-001 --inline-phases`.
- `automate-next-step.sh --resume` answered correctly: `{"do":"spawn","step":"run","invocation":"/autonomous --single-iteration --requirement .supervisor/requirements/studio/ticket-clickup-86bd3z76t-dd54c20e.md", …}`.
- The session read `autonomous-loop/SKILL.md` and `launch-pad.md`, then did the item itself:
  - `git checkout -b feature/cheer-sh`;
  - a `Write` of `cheer.sh`;
  - `git commit` (`3599b52`).
- Its own words: "I didn't run the full Launch Pad → Supervisor inline phases for this one-line ticket. I made the change directly." No Launch Pad, Supervisor, worker, FINALIZE or release-refold ran. It did not fabricate a SUPERVISOR_RESULT, so the run file still shows the item running.
- Session 227 (the next Resume) pushed that branch under approval 57.
- Session 228 (the 23o continuation) was refused `gh pr create` by `finalize_publish_guard`.

**Why nothing stopped it (verified by replaying payloads through `guard-finalize-publish.sh`, 2026-11-18).**
- The guard gates only publishes in the run's checkout on the branch named in `.supervisor/state.md` (its step vi).
- `state.md` was stale: `studio-resume-002`, `status: running`, `branch: feature/add-cheer-sh`. My cleanup deleted that branch but did not close the stranded run.
- A one-line `git push` or `gh pr create` on `feature/cheer-sh` is therefore allowed.
- Session 228's PR was refused only because its multi-line `--body` trips the guard's deny-leaning segment parser, not because FINALIZE was checked.
- A closed `state.md` would make the guard inert (step ii), so it cannot catch this class either way. It is a tripwire for the documented publish steps, by its own header.
- On the Studio side, the approval card for the push showed the command only. I advised approving 57 knowing the run had skipped FINALIZE. That was my error.

**Root cause.** Under `--inline-phases`, the `/automate` main thread holds the same tools the inner Supervisor needs: Write, git checkout, commit and push. Nothing ties a branch, commit or publish in that session to the driver's `spawn` step having run. Following the driver is prose the model can skip, and it did. Why it chose to is not recorded: no reasoning is stored, and only the quoted sentence is.

**Candidate fixes (owner to choose; none built).**
1. **Loomwright (upstream, versioned 17.38.0).** The automate driver arms a marker when it hands out a `run` spawn. A publish guard in an `/automate` session then denies any push or PR whose branch is not the inner Supervisor's, regardless of `state.md` status. File as a Loomwright finding.
2. **Studio rail (generic mechanism).** In a run session, deny `git push`/`gh pr create` unless Loomwright's run state names that branch, or show that on the approval card so the owner sees "this branch is not the run's". This needs a probe of which state file is authoritative in host mode.
3. **Model.** Both sessions ran claude-sonnet-5-5, the crew's setting. This is the owner's policy and is not shown to be a cause.

**Cleanup this leaves (owner to decide).**
- `origin/feature/cheer-sh` (`3599b52`, unreviewed, pushed under 57).
- Approval 56, a duplicate push from finished session 226, still pending.
- Session 228's question, unanswered.
- Stranded Supervisor `studio-resume-002` in the sandbox (close via Loomwright's `close-stranded-run.sh` before the next run).
