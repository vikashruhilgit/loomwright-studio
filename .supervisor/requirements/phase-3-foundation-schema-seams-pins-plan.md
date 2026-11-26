# Task Plan: phase-3-foundation-schema-seams-pins

Source brief: `.supervisor/jobs/in-progress/2026-10-16-phase-3-foundation-schema-seams-pins.md` (authoritative for ACs, design decisions, lanes, pin mutations).
Split: 2 tasks, parallel, zero lane overlap (split reason: context-bound). Gate per task: outputs_verified + `cd kernel && npm ci && npm run typecheck && npm test` (+ `bash scripts/check-docs.sh` for task 1). No per-task review; Supervisor Phase 4.5 integrated review once after FINALIZE.

## EPIC phase-3-foundation

- [ ] **p3f-store-sessions** (Subtask 1) — migration 13 + store pins, sessions carry playbook, `ALWAYS_HELD_TOOLS`, ARCHITECTURE.md + five stubs. ACs: AC1, AC2, AC3, AC7, AC8, AC9, AC10 (store/sessions pins). Blocked by: none.
- [ ] **p3f-shell-pins-tools** (Subtask 2) — `kernel/src/playbooks/` shell + registration as 6th contributor, per-feature pin move (report expect( counts removed/added), six reserved Wright tool names. ACs: AC4, AC5, AC6, AC10 (moved pins). Blocked by: none.

Skills: `skills/unit-testing/SKILL.md` (both).
