# Task Plan: token-limits-sessions-at-once-per-agent

Source brief: .supervisor/jobs/in-progress/2026-10-18-token-limits-sessions-at-once-per-agent.md (authoritative for ACs, invariants, pin mutations, design notes 1-7).

## EPIC token-limits-sessions-at-once-per-agent

- [ ] **token-limits-1** Per-agent limits from settings, sessions-at-once admission, docs (single worker, no worktree fan-out)
  - ACs: AC1-AC11 (all), per brief.
  - Blocked by: nothing.
  - Lanes: kernel/src/budget/**, kernel/src/kernel.ts, kernel/src/agents/settings.ts, kernel/src/brain/settings.ts, kernel/src/sessions/{types,manager}.ts (manager: two resume request literals only), kernel/test/**, docs/architecture/budget.md.
  - Gate: `cd kernel && npm run typecheck && npm test`; `bash scripts/check-docs.sh`; pin mutations in brief each turn a test red.
  - Skills: skills/unit-testing/SKILL.md, skills/error-handling/SKILL.md.

Review: no per-subtask review; deterministic gate + Supervisor Phase 4.5 integrated review.
