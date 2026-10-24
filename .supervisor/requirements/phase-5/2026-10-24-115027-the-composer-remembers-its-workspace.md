# 27 — A crew member's composer remembers the chosen workspace

## Status: ready

**Priority:** Polish · phase 5 item 13 (composer workspaces)

**As** the owner,
**I want** the Workspace I chose in a crew member's composer to stay chosen when I leave the thread and come back,
**so that** I don't send a request without the workspace I meant.

## Problem

In the live run, the workspace chosen for `phase5-exit-1024` reset to "No workspace" after a visit to Sessions, and had to be chosen again before the second request. The composer keeps the choice in component state (`app/src/screens/chat/ChatComposer.tsx:29-40`), which is lost when the thread unmounts.

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. Keep the choice per agent in the app's store for the app's lifetime. If the member has exactly one workspace, preselect it.
2. If a remembered workspace is no longer in the member's list, drop it and show "No workspace".

## Non-goals

- Persisting the choice across app restarts.

## Acceptance criteria

- [ ] Given a choice made, when the owner opens Sessions and returns, then the same workspace is selected.
- [ ] Given a member with one workspace, then it's preselected.
- [ ] Given a remembered workspace that has been removed from the charter, then the composer shows "No workspace".

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`

## Assumptions

- Preselecting a single workspace is acceptable, since the owner can still pick "No workspace".

## Risks

- None notable.

## Depends on
none

## Touches
app/src/screens/chat/ChatComposer.tsx
app/src/screens/chat/composer.test.tsx
