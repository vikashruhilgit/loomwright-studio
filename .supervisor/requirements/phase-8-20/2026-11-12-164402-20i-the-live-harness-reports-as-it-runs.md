# 20i — The phase 8 live harness shows its progress while it runs

**As** the owner running the exit walk, **I want** the harness's summary path and check changes printed as they happen, **so that** I can follow the run.

## Why

the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live): the harness (`STUDIO_LIVE=1 npx vitest run test/phase-8-exit-live.test.ts`) ran for about 75 minutes and printed nothing past vitest's `RUN` line: no summary path, no check changes. The runbook says it prints both. Vitest buffers a test's console output until the test ends.

## Acceptance Criteria
- [ ] AC1: The summary path and every check change reach the terminal within seconds (written to `process.stderr` directly, or the harness run with a reporter that does not buffer), and the runbook's command produces them as written.
- [ ] AC2: The summary file is written as the run goes, so a run stopped early still leaves it.

## Validation (must pass before merge)
1. **Static:** `cd kernel && npm test` (the harness's offline tests).

## Depends on
none

## Touches
kernel/test/phase-8-exit-live.test.ts
docs/evidence/phase-8-exit-runbook.md
