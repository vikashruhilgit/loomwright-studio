# 25g — Readiness flags a `never` entry that blocks one of the member's own jobs (23b)

**As the** owner approving a crew charter,
**I want** the charter card's readiness to tell me, in plain words, when a `never` entry defeats a job the member is being given,
**so that** I don't approve a member whose ticket run can't open its PR.

## Why
Observed 2026-11-16 (setup step 6, approvals 44 and 45): Wright's drafts of `p8-22` put `gh_pr_create` in `never` while readiness said every duty was "covered". The kernel-launched ticket run inherits the member's `never` list (D45; `kernel/src/automate/launch.ts`), and Loomwright's Supervisor opens its PR with `gh pr create` in that session. No check today compares `never` with a job's needs (`kernel/src/features/job-needs.ts`).

## Acceptance criteria
- [ ] Given a charter whose `never` list would refuse a command or tool a granted job needs (at least: the ticket run's `git push` and `gh pr create`; read from each job's kernel-launched policy, not a hand list), when readiness runs, then the card shows one plain line per conflict (for example "Hand tickets to /automate needs to open a PR; the charter's never list forbids it") and the duty is not "covered".
- [ ] Given no conflict, then readiness reads as today.
- [ ] Given Wright drafts a charter, when its draft carries such a conflict, then the draft result's `fit` names it, as it does for a missing tool.

## Non-goals
- Rewriting `never` lists in existing charters.

## Owner decisions
- none recorded

## Priority: Phase 2
The reused `p8-22` charter has no such entry today (checked 2026-11-20), so it does not block the next walk.

### Assumptions
- Defect evidence: observed — 2026-11-16 approvals 44, 45 (phase 8 item 23b).

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test` with a readiness case per conflict and a no-conflict case.
2. **Static — app:** the charter card test shows the plain line (`cd app && npm test`).

## Depends on
none

## Touches
kernel/src/features/job-needs.ts
kernel/src/agents/roster.ts
kernel/test/charter-readiness.test.ts
app/src/screens/chat/CharterCard.tsx
app/src/screens/chat/CharterCard.test.tsx
