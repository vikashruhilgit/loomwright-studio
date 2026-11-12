# 20c — A crew member's charter is checked against what its work needs

**As** the owner of Loomwright Studio,
**I want** the system to know exactly which permissions a crew member needs for the work I describe, and to show any gap before I approve its charter or enable a playbook,
**so that** a crew member set up for any task works on its first real run, instead of being refused one tool at a time.

## Why

The owner's words in the phase 8 exit live run, 2026-11-12 (commit `cfb3d428`, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live; sessions 125, 126, 129): "we need a way to know exactly what permission a crew requires, or a system to identify which permission a crew needs to perform a task, because a user can ask to set up a crew for anything."

**What failed:**
- The readiness check (`kernel/src/agents/charter-readiness.ts`, item 18b) asks only whether the charter holds the kernel tools its jobs list. It never asks what the command a job runs needs.
- The playbook's dry run runs in draft mode, so it never reaches those calls. Dry runs 154, 156 and 158 each reported only "it would do 1 call: kernel_automate_state".
- So the charter passed every check, and the real run was then refused three times.

## Acceptance Criteria

**Happy path:**
- [ ] Given any job in `kernel/src/features/catalogue.ts`, then it declares what its work needs:
  - kernel tools;
  - Claude tools (for example `Skill`, `Agent`);
  - Bash prefixes;
  - connectors and their levels;
  - a workspace.
- [ ] Given a job that runs a Loomwright command, then that command's needs come from Loomwright's contract (`capabilities.json`) where it declares them, and from a pinned kernel table where it does not.
- [ ] Given a charter (create or update) missing a declared need, when the card shows, then its readiness block has a `flagged` line naming the job and the missing permission in plain words, with the raw name only in the enforced line.
- [ ] Given a playbook whose real (non-draft) run would make a call its crew member's policy refuses, when it is dry-run, then the result lists each such call before the enable. The enable is refused unless the owner says to enable it anyway (the `charter_gap` pattern of item 16).
- [ ] Given Wright drafting a charter or a playbook, then it proposes the declared needs and says which only the owner can grant (GitHub write, connectors, live mode).

**Edge cases:**
- [ ] Given a new job added with no declared needs, then a test fails.
- [ ] Given the 2026-11-12 charter (`studio-sandbox-dev` before approval 32) as a fixture, then readiness flags its missing needs for "Hand tickets to /automate" under D43 (kernel-owned launch): the gap it flags is the missing GitHub write and workspace, never `Skill`.

## Non-goals
- How a ticket run starts (20b, D43).
- Granting anything automatically: the system shows gaps, and the owner or Wright's held update closes them.

## Owner decisions
- 2026-11-12: the owner asked for this system during the live run, since a crew member can be set up for anything.
- 2026-11-12: Proceed anyway at PO-ASSUME.
- 2026-11-12: D43 is the kernel-owned launch, so a ticket job's declared needs hold no `Skill` or Loomwright shell prefixes.

## Priority: MVP
**Rationale:** Without it, every new kind of crew member repeats the 2026-11-12 run: approved, then refused at run time.

## Assumptions
- Loomwright's `capabilities.json` does not yet declare per-command needs; the kernel's pinned table covers that until it does (a Loomwright change is out of this repo's scope).

## Dependencies
- Depends on: 20b (D43 and the catalogue change land there first)

## Risks
- The pinned table drifts from Loomwright's real needs after a Loomwright upgrade; the version-change note (phase 2) should name it.

## Validation (must pass before merge)
1. **Static — kernel and app suites:** `cd kernel && npm test`; `cd app && npm test`; `bash scripts/check-docs.sh`.
2. **Running system — a gap shows before approval:** in the packaged app, ask Wright for a crew member whose job needs a permission the draft lacks. The card's readiness names the gap before approval, and a playbook's dry run names the call a real run would be refused. Record it in `docs/evidence/phase-8-20c-charter-needs.md` with `Verdict: PASS for Validation 2`.

## Depends on
2026-11-12-170445-b-a-ticket-run-reaches-a-pr-with-the-charter-wright-drafted.md

## Touches
kernel/src/features/catalogue.ts
kernel/src/agents/charter-readiness.ts
kernel/src/agents/charter-tools.ts
kernel/src/playbooks/dry-run.ts
kernel/test/agents-charter-readiness.test.ts
kernel/test/playbooks-dry-run.test.ts
docs/architecture/agents.md
docs/architecture/dry-run.md
docs/evidence/phase-8-20c-charter-needs.md
