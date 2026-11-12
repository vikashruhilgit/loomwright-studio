# 20c — A crew member's charter is checked against what its work actually needs

**As** the owner of Loomwright Studio,
**I want** the kernel to know exactly which permissions a crew member needs for the work I describe, and to show any gap before I approve the charter or enable a playbook,
**so that** a crew member set up for any task works on its first real run, instead of being refused one tool at a time.

## Why

The owner's words in the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live): "we need a way to know exactly what permission a crew requires, or a system to identify which permission a crew needs to perform a task, because a user can ask to set up a crew for anything."

Today the readiness check (`kernel/src/agents/charter-readiness.ts`, item 18b) answers "does the charter hold the kernel tools its jobs list?". It never asks what the command a job runs needs. The charter passed every check, and the run was then refused `Skill`, Bash prefixes and `kernel_notify` in turn (20a). The playbook's dry run (`draft-mode` session) never reaches those calls, so it could not show the gap either: dry runs 154, 156 and 158 each reported "it would do 1 call: kernel_automate_state".

## Acceptance Criteria

- [ ] AC1: Each job in `kernel/src/features/catalogue.ts` declares what its work needs: kernel tools, Claude tools (for example `Skill`, `Agent`), Bash prefixes, connectors and their levels, and workspace. A job that runs a Loomwright command takes that command's needs from Loomwright's contract (`capabilities.json`) where the contract declares them, and from a pinned table in the kernel where it does not. A job may not be added without its declared needs (a test enforces it).
- [ ] AC2: The readiness block on a charter (create and update) lists, per duty, any declared need the charter does not grant, as a `flagged` line naming the job and the missing permission in plain words, with the raw name only in the enforced line.
- [ ] AC3: A playbook's dry run reports, for its real (non-draft) path, every call the run would make that the crew member's policy would refuse, before the enable. A playbook whose run would be refused is not enabled without the owner saying to enable it anyway (the `charter_gap` pattern of item 16).
- [ ] AC4: Wright, drafting a charter or a playbook, proposes the declared needs and says which ones only the owner can grant (GitHub write, connectors, live mode).
- [ ] AC5: The 2026-11-12 crew member (`studio-sandbox-dev` before approval 32) is a test fixture: the readiness check flags its missing needs for "Hand tickets to /automate" under whichever path D43 chose.

## Dependencies
- Depends on: 20a (what a ticket job needs depends on D43), 20b (the catalogue edit lands there first)

## Validation (must pass before merge)
1. **Static:** kernel and app suites; `bash scripts/check-docs.sh`.
2. **Running system:** in the packaged app, ask Wright for a crew member for a task with a job whose needs are not all granted; the card's readiness names each gap before approval. Record it in `docs/evidence/phase-8-20c-charter-needs.md` with a `Verdict: PASS for Validation 2` line.

## Depends on
2026-11-12-164402-20b-kernel-runs-automate-for-a-crew-member.md

## Touches
kernel/src/features/catalogue.ts
kernel/src/agents/charter-readiness.ts
kernel/src/agents/charter-tools.ts
kernel/src/playbooks/dry-run.ts
kernel/test/agents-charter-readiness.test.ts
docs/architecture/agents.md
docs/architecture/dry-run.md
docs/evidence/phase-8-20c-charter-needs.md
