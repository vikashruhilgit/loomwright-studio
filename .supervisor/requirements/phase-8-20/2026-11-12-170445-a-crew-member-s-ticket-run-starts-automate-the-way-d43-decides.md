# 20a — Decide how a crew member's ticket run starts /automate (D43)

**As** the owner of Loomwright Studio,
**I want** one recorded decision on how a crew member's ticket run reaches Loomwright's `/automate`,
**so that** the build that follows neither hands a crew session a wide shell grant by accident nor takes the run out of the kernel's control.

## Why

In the phase 8 exit live run, 2026-11-12 (commit `cfb3d428`, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live; sessions 125, 126, 129), every ticket session prepared its backlog with `kernel_automate_prepare`, then was refused at `/automate`:
- `Skill` was denied `tool_not_allowed` in sessions 125 and 126.
- With `Skill` granted by approval 32, session 129 loaded `loomwright:automate` and was refused again at its first helper call. `automate-helpers.sh lane-info` was denied `bash_prefix_not_allowed`, a compound start command was denied `bash_shell_metacharacter`, and `kernel_notify` was denied `tool_not_allowed`.

`/automate` needs Loomwright's helper scripts, `git` writes, `gh`, the project's tests and the Agent tool. The CI walk (`app/e2e/phase-8-exit.spec.ts`) never met this, because its fixture policy allows `Skill` and the walk's Bash by hand. Two paths remain:
- **(a) A scoped grant:** the rail allows `Skill` only for named Loomwright skills, plus exact helper and git/gh prefixes.
- **(b) A kernel-owned launch:** the kernel starts `/automate` as its own run, and the crew session only prepares, tracks and reports.

Path (a) pulls against invariant 3. Path (b) fits invariant 2 ("an LLM never owns its own lifecycle").

## Acceptance Criteria

**Happy path:**
- [ ] Given this item's PR, when the owner reads `docs/DECISIONS.md`, then D43 states the chosen path, the reasoning, the rejected path and what it supersedes. The owner approves by merging.
- [ ] Given D43, when the owner reads `docs/architecture/automate.md`, then it shows the chosen path end to end: who starts the run, which permission policy and approval gate apply to its writes, where its tokens and budget count, how Stop and Kill reach it, and how a gate question raised inside it reaches the owner.
- [ ] Given D43, when an implementer reads it, then it names what 20b builds (tools, routes, events) and what the "Hand tickets to /automate" and "Triage PR comments" jobs grant afterwards.

**Edge cases:**
- [ ] Given path (a), then the decision names every skill, prefix and tool granted and why each is needed; anything not named stays denied.
- [ ] Given path (b), then the decision says how a run started by the kernel is still attributed to the crew member and its playbook (budget, audit, Tasks).

## Non-goals
- Building either path (20b).
- The general permission-needs system (20c).

## Owner decisions
- 2026-11-12: stop the live run at walk step 1 and file the findings rather than widening the crew member's policy by hand.
- 2026-11-12: Proceed anyway at PO's assumption check (PO-ASSUME), with D43 a prerequisite of 20b and 20c.

## Priority: MVP
**Rationale:** No ticket can become a PR through a Wright-drafted crew member until this is decided; it blocks phase 8's exit.

## Assumptions
- Loomwright's phase sessions (`phase-launch`) are a model for a kernel-owned run; whether Studio can reuse them is for the decision to settle.

## Dependencies
- Depends on: none
- Blocks: 20b, 20c

## Risks
- Path (a) drift: a later job adds prefixes until a crew member holds a general shell.

## Validation (must pass before merge)
1. **Static — docs check:** `bash scripts/check-docs.sh` passes.

## Depends on
none

## Touches
docs/DECISIONS.md
docs/architecture/automate.md
docs/ARCHITECTURE.md
