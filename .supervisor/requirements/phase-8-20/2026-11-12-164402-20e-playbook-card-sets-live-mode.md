# 20e — The owner sets a playbook live from its card

**As** the owner, **I want** to switch a playbook between draft and live on its card, **so that** going live never needs the CLI.

## Why

the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live): Wright reported "only you can set it, and the card shows the mode but doesn't edit it"; the run used `studio playbooks set 7 mode live`. Setting live on an enabled playbook makes a new draft version that needs its own dry run and held enable (D39); the owner was not told that, and the run spent a third dry run (about 121k tokens) finding out.

## Acceptance Criteria
- [ ] AC1: The playbook card has a Mode control (Draft, Live) for the owner; Live is offered only when the playbook is enabled (the kernel's `live_needs_enable`).
- [ ] AC2: Before it applies, the control says what happens: a new version, back in draft, that needs a dry run and an enable approval before it runs live.
- [ ] AC3: After the change the card shows the new version's state and offers to ask Wright for the dry run and enable.
- [ ] AC4: A ⌘K command exists for it.

## Validation (must pass before merge)
1. **Static:** `cd app && npm run typecheck && npm test`; the Playbooks e2e.

## Depends on
none

## Touches
app/src/screens/playbooks/PlaybookDetail.tsx
app/src/screens/playbooks/PlaybookEdit.tsx
app/src/screens/playbooks/model.ts
app/src/screens/playbooks/commands.ts
app/src/screens/playbooks/PlaybooksScreen.test.tsx
