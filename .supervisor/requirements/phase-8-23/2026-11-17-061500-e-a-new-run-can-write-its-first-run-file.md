# 23e — A kernel-started run can write its first run file

## Status: in_progress

**Observed live (2026-11-17 01:58 UTC, kernel `7184d57d` with 23a's fix).** The queued ClickUp ticket run (session 205, playbook 18) passed every start step 23a unblocked (`lane-info`, `meta-entry`, `automate-next-step.sh --resume`, `mkdir -p .supervisor/automate`, `pick-guard`, `resolve-backlog`, `queue-confirm`), then stopped before its run file existed (`studio sessions output 205`, seq 58–65):

- It wrote the run file's content to `/tmp/automate-new-run.md` (Write, allowed) and ran `bash …/automate-helpers.sh runfile-write .supervisor/automate/auto-2026-11-16-studio.md < /tmp/automate-new-run.md`: denied `bash_shell_metacharacter` (`<`).
- 17.38.0's `runfile-write` reads its content on stdin only (`skills/automate-loop/helpers.md`, `run-file.md` "Crash-safety contract"), and the kernel refuses every pipe and redirect, so a kernel run can never call it with content.
- The one-time first-run-file Write exception (`loomwright_run_file_created`, PR #286) was never taken: the session follows Loomwright's skill, which says never to write the run file yourself, and nothing tells it the kernel allows that one Write.

**Owner decision needed (options):** (a) Loomwright's `runfile-write` takes its content from a file path argument (`--from <file>`), and the run policy admits it; (b) the kernel's run prompt tells the session that its first run file is written with Write, once, in safe mode; (c) the kernel creates the run file from the backlog before the session starts. Loomwright is the owner's own plugin, so (a) is a Loomwright change.
