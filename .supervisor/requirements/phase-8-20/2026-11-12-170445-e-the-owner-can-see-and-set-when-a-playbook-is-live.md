# 20e — The owner can see and set when a playbook is live

**As** the owner of Loomwright Studio,
**I want** to switch a playbook between draft and live on its card, and to see on every card and approval when it is live,
**so that** going live never needs the CLI, and I never approve or watch a write-capable playbook without knowing it.

## Why

In the phase 8 exit live run, 2026-11-12 (commit `cfb3d428`, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live; sessions 125, 126, 129):
- **Live mode needed the CLI.** Wright said "only you can set it, and the card shows the mode but doesn't edit it", so the run used `studio playbooks set 7 mode live`.
- **Nobody explained the extra round.** Setting live on an enabled playbook makes a new draft version that needs its own dry run and held enable (D39). The run spent a third dry run (about 121k tokens) finding that out.
- **The enable card left the mode out.** Approval 31 enabled playbook 7 v3 in `live` mode, and its display never said so. `kernel/src/playbooks/enable.ts` builds no `mode` line.
- **The card says the opposite of the truth.** Its Mode row always reads "outward calls are recorded, never sent" (`app/src/screens/playbooks/PlaybookDetail.tsx`, line 205), even when the playbook is live.

## Parts

- **Part A — the card (app):** a Mode control, and a Mode row that tells the truth.
- **Part B — the enable approval (kernel):** a `mode` line, and a first line that says LIVE.

## Acceptance Criteria

**Happy path:**
- [ ] Given an enabled playbook, when I open its card, then a Mode control offers Draft and Live, and Live is offered only when the playbook is enabled (the kernel's `live_needs_enable`).
- [ ] Given I choose Live, before it applies, then the card says what happens: a new version, back in draft, that needs a dry run and an enable approval before it runs live. Afterwards it offers to ask Wright for that dry run and enable.
- [ ] Given a live playbook, then the Mode row says its runs push and comment through the approval gate. Given a draft one, then it says outward calls are recorded, never sent.
- [ ] Given an enable approval, then its display has a `mode:` line (`draft` or `live`, with who set it) first among the values. A live enable's first line says it plainly, for example "Enable playbook … at version 3, LIVE".

**Edge cases:**
- [ ] Given a disabled playbook, then the Mode control explains that it must be enabled first.

**Always:**
- [ ] Every change has a ⌘K command.

## Non-goals
- Changing the D39 rule that a live version needs its own dry run and enable.
- Cutting the dry run's token cost.

## Owner decisions
none recorded

## Priority: MVP
**Rationale:** Going live is the phase 8 walk's step 1; the owner must see it and do it in the app.

## Assumptions
- The kernel's owner `set` route takes `mode` from the app as from the CLI.

## Dependencies
- Depends on: none

## Risks
- An approval text change can break tests that pin the display; update them in this story.

## Validation (must pass before merge)
1. **Static — kernel and app suites:** `cd kernel && npm test` (the enable display for a draft and a live playbook); `cd app && npm run typecheck && npm test` (the Mode control and row).

## Depends on
none

## Touches
app/src/screens/playbooks/PlaybookDetail.tsx
app/src/screens/playbooks/PlaybookEdit.tsx
app/src/screens/playbooks/model.ts
app/src/screens/playbooks/commands.ts
app/src/screens/playbooks/PlaybooksScreen.test.tsx
kernel/src/playbooks/enable.ts
kernel/test/playbooks-foundation.test.ts

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-12-playbook-live-mode-on-card.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-13T11:23:11Z
- **Brief:** .supervisor/jobs/done/2026-11-12-playbook-live-mode-on-card.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/268
