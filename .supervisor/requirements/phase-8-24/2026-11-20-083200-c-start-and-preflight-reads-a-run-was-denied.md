# 24c — Start-step and preflight reads a ticket run was denied

## Status: superseded by 25b and 25c

**Observed live (2026-11-20, session 249, Loomwright 18.1.2).** Each was denied and the session went on without it:
- `bash …/automate-helpers.sh closeout-others` (start step; event 37854, `bash_prefix_not_allowed`). The session ran `resume-glob --finalize` next and found no incomplete run. Harmless here (the 11-17 run was already done), but a start step was skipped.
- `git ls-tree -r --name-only origin/main` (Supervisor preflight-sync; 38014, `bash_prefix_not_allowed`). Preflight still reported CLEAR from the other reads.
- `SendMessage` after a context-keeper hand-back (38037, `tool_not_allowed`).
- Two compound or quoted commands (`H=…; bash $H lane-info; echo …`, 37844; `supervisor-next-step.sh --result '{…}'`, 38082), each `bash_shell_metacharacter`; the session retried each in an admitted form (37847/37849; 38085).

**Ask.** For each, decide admit or keep denied from what it does: `closeout-others` (writes other runs' close-out lines: a run-state write under the run policy, so likely keep denied and say so to the session), `git ls-tree` (read-only; likely admit with the other read-only git commands), `SendMessage` (keep denied unless a Loomwright step needs it; find which step asked). Record each decision in `docs/architecture/automate.md`.

## Status: done_with_escalation — ABANDONED (replaced by 25b, quoted text read as text, PR #301, and 25c, git ls-tree admitted and SendMessage kept denied, PR #304)
