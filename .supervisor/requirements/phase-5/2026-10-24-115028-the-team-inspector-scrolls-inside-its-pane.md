# 28 — The Team inspector scrolls inside its own pane

## Status: ready

**Priority:** Polish · D9 (window layout, DESIGN.md "What the mockups commit phase 5 to")

**As** the owner,
**I want** scrolling a long inspector to scroll only the inspector,
**so that** the sidebar, title bar and cards stay in place.

## Problem

In the live run, scrolling the Team inspector for a crew member (to reach Turn off) scrolled the whole window. The sidebar and Team header scrolled out of view, content slid under the traffic lights, and the page stayed shifted after returning to the inspector's top. The approved layout has a fixed 240px sidebar, a 52px title bar and a 320px inspector (`docs/design/brand-book.md` §Layout).

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. The inspector is its own scroll container (fixed height, `overflow: auto`). The window and its other columns never scroll. Check the shell's root container too, and fix it there if the window itself can scroll.
2. Keep the inspector's actions (Open thread, Turn off) reachable: pin them to the inspector's bottom, or keep them in the scrolled content with keyboard access.

## Non-goals

- Changing the inspector's content.

## Acceptance criteria

- [ ] Given a long inspector, when it is scrolled, then the sidebar, title bar and cards don't move (an e2e that compares their positions before and after).
- [ ] Given any screen, then the document's scroll position stays 0.
- [ ] Polish-gate screenshots are in the PR.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- The cause is a missing scroll container, not Electron. Verify in the running app.

## Risks

- A shell-level fix affects every screen. Smoke-test each one.

## Depends on
2026-10-24-115026-crew-members-are-told-apart-on-screen.md

## Touches
app/src/screens/team/Inspector.tsx
app/src/screens/team/team.css
app/src/shell/
app/e2e/team.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-25T06:31:22Z
- **Brief:** .supervisor/jobs/done/2026-10-25-team-inspector-scrolls-inside-its-pane.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/137
