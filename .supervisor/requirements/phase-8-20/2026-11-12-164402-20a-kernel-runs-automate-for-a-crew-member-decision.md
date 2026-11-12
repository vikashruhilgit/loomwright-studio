# 20a — A crew member's ticket run starts /automate through the kernel (decision D43 and contract)

**As** the owner of Loomwright Studio,
**I want** the kernel to start and own a ticket's `/automate` run, with the crew member's session only preparing and tracking it,
**so that** a crew member Wright drafts can hand tickets to Loomwright without a wide shell grant, and an LLM never owns the run's lifecycle.

## Why

Found in the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live). Sessions 125, 126 and 129 (issues #14 and #15):
- `kernel_automate_prepare` wrote the backlog and answered `/automate --backlog <file> --inline-phases`.
- The session then called `Skill` (`loomwright:automate`): denied `tool_not_allowed` (125, 126), because the "Hand tickets to /automate" job grants only `kernel_automate_prepare` and `kernel_automate_state`.
- With `Skill` granted (approval 32), session 129 loaded the skill and was refused at its first helper call: `automate-helpers.sh lane-info` denied `bash_prefix_not_allowed`, a compound start command denied `bash_shell_metacharacter`, and `kernel_notify` denied `tool_not_allowed`.

`/automate` needs Loomwright's helper scripts, `git` writes, `gh`, the project's tests and the Agent tool for its sub-agents. Granting all of that to a crew session one charter update at a time is the opposite of the rail's purpose. `app/e2e/phase-8-exit.spec.ts` never saw this: its fixture policy allows `Skill` and the walk's Bash by hand.

## Scope

A decision item (the shape of item 01 and Auth 2): write D43 and the contract; no runtime change.

## Acceptance Criteria

- [ ] AC1: `docs/DECISIONS.md` has D43, choosing between (a) a scoped grant (the job adds `Skill` limited by the rail to named Loomwright skills, plus the exact helper and git/gh prefixes /automate needs) and (b) a kernel-owned launch (a kernel tool or the trigger itself starts `/automate` as its own headless run, the way Loomwright's `phase-launch` runs a phase, and the crew session only prepares, tracks and reports). The entry states the owner's choice, the reasoning and what it supersedes.
- [ ] AC2: `docs/architecture/automate.md` describes the chosen path end to end: who starts the run, whose permission policy and approval gate apply to its writes, where the run's token and budget are counted, how Stop/Kill reach it, and how a gate question raised inside it reaches the owner.
- [ ] AC3: The contract names what item 20b builds (tools, routes, events) and what the "Hand tickets to /automate" and "Triage PR comments" jobs grant after it.
- [ ] AC4: The owner's choice is recorded in this item's `## Owner decisions` and the decision's PR.

## Owner decisions
- 2026-11-12 (live run): stop the run here and file this; the owner asked for a system that knows what a crew member needs (item 20c), since a crew member can be set up for anything.

## Priority: MVP
**Rationale:** Blocks phase 8's exit: no ticket can become a PR through a Wright-drafted crew member.

## Dependencies
- Depends on: none
- Blocks: 20b, 20c

## Validation (must pass before merge)
1. **Static:** `bash scripts/check-docs.sh`.

## Depends on
none

## Touches
docs/DECISIONS.md
docs/architecture/automate.md
docs/ARCHITECTURE.md
