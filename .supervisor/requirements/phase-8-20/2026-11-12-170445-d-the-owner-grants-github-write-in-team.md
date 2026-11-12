# 20d — The owner grants a crew member GitHub write in Team

**As** the owner of Loomwright Studio,
**I want** to grant a crew member GitHub read or write in its Team inspector,
**so that** I never need the CLI for a grant the charter tells me to make in Team.

## Why

In the phase 8 exit live run, 2026-11-12 (commit `cfb3d428`, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live; sessions 125, 126, 129), approval 29's readiness said "GitHub write access for Hand tickets to /automate …: only you can grant it (Team, in the member's inspector)". But the inspector's GitHub row offers only Grant (read) and Revoke: `setAgentConnectors` in `app/src/screens/team/actions.ts` sends `"github" | "none"`. The kernel already accepts `github:write` (`kernel/src/agents/roster.ts`, item 04), so the run fell back on `studio agents set studio-sandbox-dev connectors github:write`.

## Acceptance Criteria

**Happy path:**
- [ ] Given a crew member, when I open its inspector, then the GitHub row shows the grant as None, Read or Write and changes it in place.
- [ ] Given I choose Write, then one line says it lets the member's live playbooks push and comment through the approval gate.

**Edge cases:**
- [ ] Given the member holds ClickUp or Jira tools, when I change the GitHub grant, then those grants are unchanged.
- [ ] Given Wright (the lead), then the row behaves as today (Wright holds no GitHub write).

**Error scenarios:**
- [ ] Given the kernel refuses the change, then the row says why in words and keeps the old value.

**Always:**
- [ ] Every change has a ⌘K command, as the existing grant does.

## Non-goals
- Changing what a write grant allows (D39 is unchanged).

## Owner decisions
none recorded

## Priority: MVP
**Rationale:** The phase 8 walk needs a write-granted crew member, and the owner must not need the CLI.

## Assumptions
- The kernel's set route accepts `github:write` from the app as it does from the CLI; if not, the route change is part of this story.

## Dependencies
- Depends on: none

## Risks
- None beyond a mis-set grant, which the existing approval gate still covers for every write.

## Validation (must pass before merge)
1. **Static — app suite:** `cd app && npm run typecheck && npm test`, including the Team connectors tests.

## Depends on
none

## Touches
app/src/screens/team/Connectors.tsx
app/src/screens/team/actions.ts
app/src/screens/team/commands.ts
app/src/screens/team/connectors.test.tsx
