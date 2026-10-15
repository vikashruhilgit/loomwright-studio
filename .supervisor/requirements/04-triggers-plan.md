# 04-triggers — Task Plan

Source brief: .supervisor/jobs/in-progress/2026-10-14-triggers-wright-creates-and-the-owner-controls.md

## EPIC 04-triggers: Triggers (agents create once/cron; owner lists and toggles)

- [ ] **04-triggers-1** (TASK, single worker, no worktree split): build the triggers feature contribution end to end.
  - Acceptance criteria: all of them, verbatim from the brief's `## Acceptance Criteria` (12 items).
  - Blocked by: nothing.
  - Lanes and provides: as in the brief's `## Subtask Contracts` (Subtask 1).
  - Skills: skills/unit-testing/SKILL.md, skills/error-handling/SKILL.md.
  - Gate: outputs_verified + `cd kernel && npm ci && npm test` (type-check included); Phase 4.5 integrated review after FINALIZE. No per-task review subtask.
