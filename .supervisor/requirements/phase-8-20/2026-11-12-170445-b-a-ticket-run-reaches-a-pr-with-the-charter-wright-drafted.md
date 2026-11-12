# 20b — A ticket run reaches a PR with the charter Wright drafted, and the exit checks see the real path

**As** the owner of Loomwright Studio,
**I want** a live ticket playbook for a Wright-drafted crew member to reach a PR with nothing granted by hand, and the exit checks to test that same path,
**so that** the phase 8 walk works, and CI fails the next time a real charter can't do what a fixture can.

## Why

In the phase 8 exit live run, 2026-11-12 (commit `cfb3d428`, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live; sessions 125, 126, 129), no ticket reached `/automate` (see 20a). Two things hid it:
- **The CI walks** (`kernel/test/phase-8-exit.test.ts`, `app/e2e/phase-8-exit.spec.ts`) give the crew member a hand-written policy, not one the drafting code builds.
- **The live harness** (`kernel/test/phase-8-exit-live.test.ts`) printed nothing for about 75 minutes past vitest's `RUN` line. It reports through `console.log`, which vitest buffers until the test ends, so the owner saw no summary path and no check changes.

## Parts

- **Part A — the run (builds D43):** a live ticket playbook's run reaches `/automate` and opens a PR on the sandbox repo under the path 20a chose.
- **Part B — the CI walks use a drafted policy:** both exit walks build the crew member's policy from the jobs catalogue, the code path a real charter takes.
- **Part C — the live harness reports as it runs:** its summary path and every check change reach the terminal within seconds, and its summary file is written as the run goes.

## Acceptance Criteria

**Happy path:**
- [ ] Given a crew member Wright drafted with "Hand tickets to /automate" and nothing added by hand, when its live ticket playbook fires on an issue, then `/automate` runs and a PR is opened on the sandbox repo (in the CI walk, with the drafted policy).
- [ ] Given the exit walks, when a job's grant is removed from the catalogue, then the walk fails (it no longer passes on a hand-written policy).
- [ ] Given the runbook's harness command as written, when it starts, then the summary path prints within seconds, and each check change prints as it happens.

**Edge cases:**
- [ ] Given a gate question raised inside the run, then it reaches the owner in Approvals (the runbook's "A gate may be raised mid-run").
- [ ] Given the harness stopped early (Ctrl-C), then its summary file holds the checks seen so far.

**Error scenarios:**
- [ ] Given an outward write in the run, then it still passes the rail and the approval gate, and `gh pr merge` stays `merge_blocked` (D40).
- [ ] Given Stop or Kill on the playbook's session, then the run stops, and its tokens count against the crew member and the playbook.

## Non-goals
- Deciding the path (20a).
- The permission-needs system for any job (20c).

## Owner decisions
- 2026-11-12: Proceed anyway at PO-ASSUME; this story waits on D43.

## Priority: MVP
**Rationale:** The phase 8 exit's walk cannot pass without it.

## Assumptions
- The CI walk can run `/automate` against a fixture (as it does today) once the policy is drafted; if the chosen path needs a new fixture, it is part of this story.

## Dependencies
- Depends on: 20a
- Blocks: 20c

## Risks
- A kernel-owned run (path b) touches session ownership; Stop/Kill and budget must cover it, or the run escapes the kernel.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm ci && npm run typecheck && npm test`.
2. **Static — app suite and exit e2e:** `cd app && npm run typecheck && npm test`, and `app/e2e/phase-8-exit.spec.ts` passing with the drafted policy.
3. **Running system — the harness reports live:** start the runbook's harness command and see the summary path and a check-change line printed while it runs. Record the output in `docs/evidence/phase-8-20b-harness-reports.md` with `Verdict: PASS for Validation 3`.

## Depends on
2026-11-12-170445-a-crew-member-s-ticket-run-starts-automate-the-way-d43-decides.md

## Touches
kernel/src/automate
kernel/src/features/catalogue.ts
kernel/test/automate-runner.test.ts
kernel/test/phase-8-exit.test.ts
kernel/test/phase-8-exit-live.test.ts
app/e2e/phase-8-exit.spec.ts
docs/architecture/automate.md
docs/evidence/phase-8-exit-runbook.md
docs/evidence/phase-8-20b-harness-reports.md
