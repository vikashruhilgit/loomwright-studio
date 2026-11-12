# 20b — The kernel starts a crew member's /automate run (build D43)

**As** the owner of Loomwright Studio,
**I want** a live ticket playbook's run to reach a PR with the crew member's charter as Wright drafted it,
**so that** the phase 8 walk works without hand-widening a crew member's tool policy.

## Why

the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live): every ticket session stopped before `/automate` ran (see 20a). 20a decides how; this item builds it.

## Acceptance Criteria

- [ ] AC1: A live ticket playbook's run, for a crew member whose charter Wright drafted with "Hand tickets to /automate" and nothing added by hand, reaches `/automate` and opens a PR on the sandbox repo in the CI walk, with a policy built by the drafting code, not a hand-written fixture.
- [ ] AC2: `app/e2e/phase-8-exit.spec.ts` and `kernel/test/phase-8-exit.test.ts` build the crew member's policy from the jobs catalogue (the code path a real charter uses), so a missing grant fails CI.
- [ ] AC3: Every outward write in the run still passes the rail and the approval gate; `gh pr merge` stays `merge_blocked` (D40).
- [ ] AC4: Stop and Kill on the playbook's session stop the run; the run's tokens count against the crew member and the playbook.
- [ ] AC5: A gate question raised inside the run reaches the owner in Approvals (the phase 8 runbook's "A gate may be raised mid-run").

## Dependencies
- Depends on: 20a

## Validation (must pass before merge)
1. **Static:** `cd kernel && npm ci && npm run typecheck && npm test`; `cd app && npm run typecheck && npm test`; the phase 8 e2e walk.
2. **Running system:** covered by the phase 8 exit re-run (item 14's runbook), not here.

## Depends on
2026-11-12-164402-20a-kernel-runs-automate-for-a-crew-member-decision.md

## Touches
kernel/src/automate
kernel/src/features/catalogue.ts
kernel/test/phase-8-exit.test.ts
kernel/test/automate-runner.test.ts
app/e2e/phase-8-exit.spec.ts
docs/architecture/automate.md
