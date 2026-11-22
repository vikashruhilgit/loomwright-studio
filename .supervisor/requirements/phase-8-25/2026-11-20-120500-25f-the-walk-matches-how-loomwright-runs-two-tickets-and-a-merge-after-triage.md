# 25f — Walk probes: The runbook's walk matches how Loomwright runs two tickets, a merge after triage, and the merge block

**As the** owner,
**I want** the phase 8 runbook's walk order and setup to match what Loomwright 18.1.2 and the kernel actually do, each claim probed,
**so that** the next live walk can pass as written instead of failing on its own order.

## Why
Three walk assumptions were read from code on 2026-11-20 and are unproven:
- **R1 (step 1, 5):** item 23i merges concurrent ticket handovers into one backlog, so both tickets run in one `/automate` run (observed: session 249's backlog held #21 and ClickUp `86bd5gdbq`). In safe mode the run parks `awaiting_merge` on the first PR (single open PR, 18.1.2 `skills/automate-loop/modes-and-merge-gate.md:7`), so PR B would appear only after PR A merges and the owner resumes (`resume.md:14`). The runbook expects two PRs at step 1.
- **R2 (step 4 after step 2):** `--merge-parked` parks on `head_sha_moved` and on `ready_stale_feedback` (a comment newer than `ready_at`; 18.1.2 `skills/automate-loop/resume.md:41-48`). Step 2 adds three comments and a fix push to PR A before step 4 merges it; a standalone `/review-pr` does not move the run file's `ready_sha`, and the kernel's merge check reads the old one (`kernel/src/automate/merge-check.ts:164-170`). Step 4 may be impossible in the runbook's order.
- **Step 6:** the rail runs only after the session's policy admits the call (`kernel/src/sessions/manager.ts:2865`); a session with no `gh pr` prefix records `bash_prefix_not_allowed`, which the harness counts as a fail (`kernel/test/phase-8-exit-live.test.ts:548`). The runbook does not say which session to use.

## Acceptance criteria
- [ ] R1: a test drives Loomwright 18.1.2's `automate-next-step.sh` (scratch repo, stubbed `gh`) through a two-item safe-mode backlog and records when the second item's PR can start; the runbook's steps 1 and 5 are rewritten to that order (for example: PR A from the first ticket, merge it under Solo, Resume, then PR B under Approve in Studio).
- [ ] R2: a test drives `--merge-parked` on a parked run whose PR has a comment newer than `ready_at` and a moved head, and records the answer; if it parks, the runbook orders the merge of PR A before the triage comments (triage on PR B, or merge then triage), or a story is filed for a re-drain path. Either way the walk is passable as written.
- [ ] Step 6: the runbook names a session that can issue `gh pr merge` (one whose policy admits the `gh pr` prefix, for example a ticket run's continuation), and the harness's `no_kernel_merge` check documents that `bash_prefix_not_allowed` is not the expected deny.
- [ ] Tickets: the runbook's ticket text makes the requested change exercised by the repo's declared check (25d), for example "add `drum.sh` printing `boom` and make `npm test` run it".
- [ ] `docs/OPEN_QUESTIONS.md` records the claims answered since 2026-11-18 (23j Resume continued a paused run live in sessions 214 and 226; the plugin-root path matched in session 249; item 04(c)'s token evidence from the 2026-11-18 run) and points the R1/R2 results at the runbook.

## Part B — does the kernel-started triage fix act on the fix comment? (was 25e)
D45 starts the triage fix as `/loomwright:review-pr <pr url>` with no flag (`kernel/src/automate/launch.ts:367-368`, `reviewPrRunPrompt`). Read from Loomwright 18.1.2: without `--until-mergeable`, `/review-pr` runs the default diff-only loop (a `code-reviewer` over `git diff <base>...HEAD`, `commands/review-pr.md` "What This Does"), which reads no PR comments; only `--until-mergeable`'s drain reads every review channel. If so, walk step 2's `fix: rename ping to pong` is routed to a session that never sees it. Never run live.

### Acceptance criteria (Part B)
- [ ] Given a PR with an owner comment `fix: rename ping to pong` and the triage playbook's `kernel_pr_route` answering `automate_fix`, when the kernel launches the fix session (in a test with the real route and launch code), then the test records the exact prompt, the policy, and every place the comment's text reaches (prompt, run file, sidecar, a channel the session's instructions read).
- [ ] Given Loomwright 18.1.2's `/review-pr` instructions for that exact prompt, when they are walked (a driver call against a scratch repo with a stubbed `gh` that returns the comment, as Loomwright's own tests do), then the probe states whether any step reads issue or review comments; the answer is recorded as `comment reached: yes|no`, with file:line.
- [ ] The result is written to `docs/evidence/phase-8-25e-triage-fix-probe.md`: what was run, what was seen, and, if the comment is lost, a proposed D45 amendment (`--until-mergeable`, or the kernel passing the comment) for the owner to decide. Nothing in D45 or `launch.ts` changes in this story.

## Non-goals
- Changing the triage route, its prompt or D45 (Part B only reports).
- Changing Loomwright's single-open-PR rule or the merge guard.

## Owner decisions
- 2026-11-20: Part B is "probe first, then decide" on D45's triage-fix prompt (owner, /product-owner session).

## Priority: MVP
Without it a fixed kernel can still fail the walk on order.

### Assumptions
- Defect evidence: read, unverified (R1, R2, step 6) — written as probes; R1's one-run backlog is observed (session 249).

## Validation (must pass before merge)
1. **Static — probes:** the R1 and R2 tests run in `cd kernel && npm test` (or the repo's script tests) and pass, asserting what they observed.
2. **Static — docs:** `bash scripts/check-docs.sh` passes.
3. **Running system — next live walk:** the walk runs in the runbook's new order with no step blocked by order.

## Depends on
none

## Touches
kernel/test/phase-8-walk-order-probe.test.ts
kernel/test/phase-8-triage-fix-probe.test.ts
docs/evidence/phase-8-25e-triage-fix-probe.md
docs/evidence/phase-8-exit-runbook.md
docs/OPEN_QUESTIONS.md
kernel/test/phase-8-exit-live.test.ts

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-21-25f-walk-order-probes.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-22T12:16:51Z
- **Brief:** .supervisor/jobs/done/2026-11-21-25f-walk-order-probes.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/300
