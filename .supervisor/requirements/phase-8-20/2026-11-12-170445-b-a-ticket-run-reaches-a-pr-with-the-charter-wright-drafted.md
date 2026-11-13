# 20b — The kernel launches a crew member's /automate run (D43), and the exit checks see the real path

**As** the owner of Loomwright Studio,
**I want** a live ticket playbook for a Wright-drafted crew member to reach a PR with nothing granted by hand, and the exit checks to test that same path,
**so that** the phase 8 walk works, and CI fails the next time a real charter can't do what a fixture can.

## Why

In the phase 8 exit live run, 2026-11-12 (commit `cfb3d428`, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live; sessions 125, 126, 129), no ticket reached `/automate` (see the Decision below). Two things hid it:
- **The CI walks** (`kernel/test/phase-8-exit.test.ts`, `app/e2e/phase-8-exit.spec.ts`) give the crew member a hand-written policy, not one the drafting code builds.
- **The live harness** (`kernel/test/phase-8-exit-live.test.ts`) printed nothing for about 75 minutes past vitest's `RUN` line. It reports through `console.log`, which vitest buffers until the test ends, so the owner saw no summary path and no check changes.

## Decision (D43, the owner's choice 2026-11-12)

**The kernel launches `/automate` itself.** A crew member's ticket session only prepares (`kernel_automate_prepare`), tracks and reports. The kernel starts the `/automate` run as its own headless run, the way Loomwright runs its own phases. It never hands a crew session `Skill` or shell prefixes for Loomwright's scripts. This keeps invariant 2 ("an LLM never owns its own lifecycle"): the kernel owns the run's start, stop, budget and attribution. Rejected: (a) a scoped grant (`Skill` limited to named Loomwright skills, plus exact helper and git/gh prefixes), because every ticket-handling crew member would carry a growing shell grant, against invariant 3.

## Parts

- **Part 0 — the decision on record:** D43 in `docs/DECISIONS.md` (choice, reasoning, the rejected option, what it supersedes), and `docs/architecture/automate.md` describing the path end to end: who starts the run, which permission policy and approval gate apply to its writes, where its tokens and budget count, how Stop and Kill reach it, and how a gate question raised inside it reaches the owner.
- **Part A — the run:** a live ticket playbook's crew session prepares the backlog, and the kernel starts `/automate` for it, which opens a PR on the sandbox repo. The "Hand tickets to /automate" and "Triage PR comments" jobs grant no `Skill` and no Loomwright shell prefixes.
- **Part B — the CI walks use a drafted policy:** both exit walks build the crew member's policy from the jobs catalogue, the code path a real charter takes.
- **Part C — the live harness reports as it runs:** its summary path and every check change reach the terminal within seconds, and its summary file is written as the run goes.

## Acceptance Criteria

**Happy path:**
- [ ] Given this PR, when the owner reads `docs/DECISIONS.md`, then D43 records the kernel-owned launch as the owner's choice, with the reasoning and the rejected scoped grant.
- [ ] Given a crew member Wright drafted with "Hand tickets to /automate" and nothing added by hand, when its live ticket playbook fires on an issue, then the session prepares the backlog, the kernel starts `/automate`, and a PR is opened on the sandbox repo (in the CI walk, with the drafted policy).
- [ ] Given that run, then the crew session's policy holds no `Skill` and no Loomwright helper, git-write or `gh` prefix, and the run's events, budget and Tasks row are attributed to the crew member and its playbook.
- [ ] Given the exit walks, when a job's grant is removed from the catalogue, then the walk fails (it no longer passes on a hand-written policy).
- [ ] Given the runbook's harness command as written, when it starts, then the summary path prints within seconds, and each check change prints as it happens.

**Edge cases:**
- [ ] Given a gate question raised inside the run, then it reaches the owner in Approvals (the runbook's "A gate may be raised mid-run").
- [ ] Given the harness stopped early (Ctrl-C), then its summary file holds the checks seen so far.

**Error scenarios:**
- [ ] Given an outward write in the run, then it still passes the rail and the approval gate, and `gh pr merge` stays `merge_blocked` (D40).
- [ ] Given Stop or Kill on the playbook's session, then the run stops, and its tokens count against the crew member and the playbook.

## Non-goals
- Option (a), the scoped grant (rejected in D43).
- The permission-needs system for any job (20c).

## Owner decisions
- 2026-11-12: Proceed anyway at PO-ASSUME.
- 2026-11-12: D43 is (b), the kernel launches `/automate`; the owner chose it in chat, and 20a (the separate decision story) was folded in here so the backlog runs in two waves.
- 2026-11-12: stop the live run at walk step 1 and file the findings rather than widening the crew member's policy by hand.

## Priority: MVP
**Rationale:** The phase 8 exit's walk cannot pass without it.

## Assumptions
- The CI walk can run `/automate` against a fixture (as it does today) once the policy is drafted; if the chosen path needs a new fixture, it is part of this story.

## Dependencies
- Depends on: none
- Blocks: 20c

## Risks
- A kernel-owned run touches session ownership: Stop/Kill, budget and the cap must cover it, or the run escapes the kernel.
- Loomwright's `/automate` asks questions (gates); a headless kernel-started run must relay them to Approvals, or it stalls.

## Validation (must pass before merge)
1. **Static — docs check:** `bash scripts/check-docs.sh` (D43 and `automate.md`).
2. **Static — kernel suite:** `cd kernel && npm ci && npm run typecheck && npm test`.
3. **Static — app suite and exit e2e:** `cd app && npm run typecheck && npm test`, and `app/e2e/phase-8-exit.spec.ts` passing with the drafted policy.
4. **Running system — the harness reports live:** start the runbook's harness command and see the summary path and a check-change line printed while it runs. Record the output in `docs/evidence/phase-8-20b-harness-reports.md` with `Verdict: PASS for Validation 4`.

## Depends on
none

## Touches
docs/DECISIONS.md
docs/ARCHITECTURE.md
kernel/src/automate
kernel/src/features/catalogue.ts
kernel/test/automate-runner.test.ts
kernel/test/phase-8-exit.test.ts
kernel/test/phase-8-exit-live.test.ts
app/e2e/phase-8-exit.spec.ts
docs/architecture/automate.md
docs/evidence/phase-8-exit-runbook.md
docs/evidence/phase-8-20b-harness-reports.md

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-13-kernel-launches-automate-run.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.
