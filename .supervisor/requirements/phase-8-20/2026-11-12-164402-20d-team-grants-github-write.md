# 20d — Team can grant a crew member GitHub write

**As** the owner, **I want** to grant GitHub write to a crew member in Team, **so that** I never need the CLI for a grant the charter tells me to make in Team.

## Why

the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live): approval 29's readiness said "GitHub write access for Hand tickets to /automate …: only you can grant it (Team, in the member's inspector)". The inspector's GitHub row offers only Grant (read) and Revoke: `setAgentConnectors` in `app/src/screens/team/actions.ts` sends `"github" | "none"`. The kernel already accepts `github:write` (`kernel/src/agents/roster.ts`, item 04); the run used `studio agents set studio-sandbox-dev connectors github:write`.

## Acceptance Criteria
- [ ] AC1: The GitHub row shows the grant as None, Read or Write and changes it in place; Write explains in one line that it lets the member's live playbooks push and comment through the gate.
- [ ] AC2: Changing it keeps the member's other connector grants (ClickUp, Jira) unchanged.
- [ ] AC3: A ⌘K command exists for each change, as for the existing grant.
- [ ] AC4: The charter readiness line's wording matches the control's real name.

## Validation (must pass before merge)
1. **Static:** `cd app && npm run typecheck && npm test`; the Team e2e.

## Depends on
none

## Touches
app/src/screens/team/Connectors.tsx
app/src/screens/team/actions.ts
app/src/screens/team/commands.ts
app/src/screens/team/connectors.test.tsx
