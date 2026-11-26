# 23k — An inline-phases run may call its own phase scripts

## Status: in_progress

**Observed live (2026-11-17, session 214, the first owner Resume, kernel `fix/service-path-gh-git`).** The resumed run `automate-2026-11-17-001` got past the trail gate (23h works: `gh` found), picked the cheer.sh item, wrote the Launch Pad brief and passed plan review on its second attempt. It then stopped:
- `bash <install>/scripts/supervisor-next-step.sh --session-id resume-sess-001 --job .supervisor/jobs/pending/2026-11-17-add-cheer-sh.md --sequential` was denied `bash_prefix_not_allowed` twice, so the Supervisor phase could not start.
- `bash <install>/scripts/launch-pad-phase.sh 5 …` was denied too, and `git remote -v` was denied as an unlisted prefix.

**Mechanism.** `AUTOMATE_RUN_SCRIPTS` (`kernel/src/automate/launch.ts`) was derived from `commands/automate.md`, `skills/automate-loop/` and `automate-next-step.sh` only. Under `--inline-phases`, the run executes `/autonomous --single-iteration`, which runs `/launch-pad` and `/supervisor` and their skills and drivers. Their scripts were never in the derivation.

A grep over `commands/{autonomous,launch-pad,supervisor}.md`, their skills and drivers names 28 candidate scripts. Several act past the kernel and must stay out, for example `dispatch-pr-review.sh` (spawns `claude`), `send-webhook.sh` (outward) and repo-only scripts.

**Ask.**
- The run policy admits exactly the scripts the inline phases need, reviewed one by one against invariants 2 and 3, with each exclusion named.
- The derivation is recorded so the next Loomwright version can be re-derived.
- Per `launch.ts`, a missing script is "a live-run finding, never a wider grant": this widening is an owner decision.

**Fix (branch `fix/service-path-gh-git`, uncommitted).** Owner-approved list (2026-11-17): `INLINE_PHASE_SCRIPTS` in `kernel/src/automate/launch.ts` adds 24 scripts to `AUTOMATE_RUN_POLICY`. The derivation and each exclusion are recorded there and in `docs/architecture/automate.md`. The session's own `--skip-children-check` / `--skip-preflight-sync` is refused. The left-out capabilities go to 23m. Not yet verified live.

**Live run 1 (session 215, 2026-11-17 15:15–15:18Z, the owner's Resume).**
- What worked: `supervisor-next-step.sh` and the Launch Pad phase were admitted. The job `.supervisor/jobs/in-progress/2026-11-17-add-cheer-sh.md` was written and the driver printed its `init` step.
- What failed: every `supervisor-next-step.sh … --result '<json>'` answer was refused with `bash_prefix_not_allowed` (seq 108, 111, 114). The session stopped mid-item, so the run was stranded again (23l listed it again).
- Cause: this fix put the driver in `LOOMWRIGHT_DENIED_SUBCOMMANDS`, whose check refused any word holding a quote or a brace, and every answer is JSON. The test used `--result ok` and so missed it.
- Fix: `asksDeniedSubcommand` reads words exactly as bash passes them (`shellWords`). A quoted denied name, a glob or a brace is still refused. The live calls are pinned in `kernel/test/sessions-policy.test.ts`. Reinstalled as pid 29948, not yet verified live.
- Also seen, not fixed: the session's debugging `grep -n -e "--result" <install>/scripts/supervisor-next-step.sh` was refused as `settings_write` (the rail reads any Bash command naming `~/.claude/` as one; p8-22's never list forbids it). It is not on the flow's path, so it is a 23m/rail finding.
