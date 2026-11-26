# Task Plan: phase-2-foundation-schema-feature-seams

Source brief: .supervisor/jobs/in-progress/2026-10-14-phase-2-foundation-schema-feature-seams.md (base 05d0e61). Split reason: context-bound. Review gate: deterministic outputs_verified + typecheck/test/check-docs per task; Phase 4.5 integrated review once after FINALIZE (no per-subtask review).

## EPIC phase-2-foundation-schema-feature-seams

- [ ] **st1: Migration 11 + store tests + architecture docs** (AC1, AC2, AC7, AC8 store pins). Blocked by: nothing.
  - Create: kernel/src/store/migrations/011_phase_2_tables.ts; docs/architecture/{loomwright,notifications,triggers,approvals,brain}.md
  - Modify: kernel/src/store/migrations/index.ts, kernel/test/store.test.ts, docs/ARCHITECTURE.md (integrity.ts only if needed; none expected)
  - Skills: skills/unit-testing/SKILL.md
- [ ] **st2: Feature contribution seams** (AC3, AC4, AC5, AC6, AC8, AC9). Blocked by: nothing.
  - Create: kernel/src/features/{contribution,index}.ts; kernel/src/{loomwright,notifications,triggers,approvals,brain}/index.ts; kernel/test/feature-seams.test.ts
  - Modify: kernel/src/tools/server.ts, kernel/src/api/server.ts, kernel/src/cli/index.ts, kernel/src/kernel.ts, kernel/src/loop/loop.ts, kernel/src/daemon-exit.ts, kernel/test/daemon-exit.test.ts (loop/types.ts and daemon.ts expected unchanged)
  - Skills: skills/unit-testing/SKILL.md, skills/error-handling/SKILL.md

Batch 1: st1 + st2 in parallel (zero lane overlap, empty requires).
