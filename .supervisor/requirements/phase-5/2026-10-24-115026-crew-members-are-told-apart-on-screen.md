# 26 — Crew members can be told apart on screen, and each Team card shows the live state

## Status: ready

**Priority:** Polish · D22, D25, D34

**As** the owner,
**I want** two crew members with the same display name to be distinguishable, members that are off to look off, and each Team card to show what the agent is doing now,
**so that** Team and the Crew sidebar never mislead me.

## Problem

From the live run (the owner's screenshot, 2026-10-24): Team and the Crew sidebar show two "Comment-only Reviewer" members with the same turtle and colour. They are `phase4-exit-mvg8wle4cf8f26` (off, created 2026-10-20) and `phase5-exit-1024` (active), and nothing on screen tells them apart. The off member sits in the Crew sidebar with nothing marking it as off. Wright's card showed "Write me a 5000-word short story…" as its current task after that session was killed and Wright was idle.

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. **The id when names collide.** When two members share a display name, their cards, Crew rows and thread header show the id in muted mono under the name, and a tooltip always shows it.
2. **Off members look off.** In the Crew sidebar, off members sort after active ones and are dimmed, with "off" on the row. Their threads stay readable.
3. **The current task is live.** A card's task line comes from the agent's running session. With none running, it shows the idle state, never the last request.
4. **Wright proposing a distinct name** when one is taken is a kernel template change (item 23's file). Note it in the PR as a follow-up; don't edit it here.

## Non-goals

- Renaming (it exists) or deleting members (D34 keeps them).

## Acceptance criteria

- [ ] Given two members with the same name, then both cards and both Crew rows show their ids.
- [ ] Given an off member, then its Crew row is dimmed, says off, and sorts after the active ones.
- [ ] Given Wright idle after a killed session, then its card shows idle, not the killed request.
- [ ] Polish-gate screenshots (light and dark) are in the PR.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- `GET /agents` gives each member's status, and the live store gives running sessions per agent.

## Risks

- None notable.

## Depends on
none

## Touches
app/src/screens/team/TeamView.tsx
app/src/screens/team/model.ts
app/src/screens/team/team.test.tsx
app/src/screens/chat/CrewSection.tsx
app/src/screens/chat/crew.test.tsx
app/e2e/team.spec.ts
app/e2e/fixtures/team.ts
