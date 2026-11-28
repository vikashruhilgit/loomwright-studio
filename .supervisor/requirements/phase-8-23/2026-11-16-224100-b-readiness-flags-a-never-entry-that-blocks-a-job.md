# 23b — Readiness flags a never entry that blocks one of the member's own jobs

## Status: in_progress

**Observed live (2026-11-16, setup step 6).** Wright's first two drafts of `p8-22` (approvals 44, 45) put `gh_pr_create` in the charter's `never` list, and the card's readiness said every duty was "covered". The ticket run the kernel starts inherits the member's `never` list (`kernel/src/automate/launch.ts:470`), and Loomwright's Supervisor opens its PR with a plain `gh pr create` in that session (17.38.0 `skills/async-orchestration/finalize.md:62`), so the run could never open its PR. The owner had Wright redraft without it (approval 46).

**Ask.** The readiness check (and Wright's drafting guidance) knows which never categories each kernel-launched command needs, and flags a `never` entry that defeats a duty's own job in plain words, before the owner approves. Open: which categories each Loomwright route needs (at least `gh_pr_create` and `git push` for the ticket run) — read from the scripts, verified in the live run.

<!-- loomwright:requirement-closeout -->
## Status: done_with_escalation
- **Completed:** 2026-11-28T07:31:50Z
- **Brief:** unknown
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/302
- **Owed:** live check: a charter whose never list holds gh_pr_create or git_push is flagged on the card before approval in the running app (unit tests only)
