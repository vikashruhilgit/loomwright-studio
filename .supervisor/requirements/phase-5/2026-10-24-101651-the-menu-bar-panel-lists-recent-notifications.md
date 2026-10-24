# 20 — The menu-bar panel lists recent notifications, each opening what it links to

## Status: ready

**Priority:** MVP (phase 5 follow-up, found by the exit e2e) · ROADMAP phase 5 · D11, DESIGN.md (menu bar)

**As** the owner,
**I want** the menu-bar panel to list my recent notifications with their delivery status,
**so that** a notification I missed on screen, or one that had no click action, can still be seen and opened from the app.

## Problem

A notification is seen only on screen. Its click (its `loomwright-studio://` link) opens the app on the thread or approval it names, and the app has no row of it anywhere (`docs/OPEN_QUESTIONS.md`, "Known gaps the e2e found" (2); `docs/evidence/phase-5-exit-runbook.md` flow 1). The kernel already serves `GET /notifications` and `GET /notifications/:id` (`app/src/api/contract.ts:54-55`, `kernel/src/notifications/routes.ts`). The menu-bar panel (`app/src/screens/menubar/MenubarPanel.tsx`) reads only `/notifications/:id`, for a clicked deep link (`menubar.test.tsx:128`).

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24 in the phase 6 requirements session, when the owner asked for the gaps the phase 5 exit e2e found (`docs/OPEN_QUESTIONS.md`, "Known gaps the e2e found") to be written up as items. The owner chose the proposed option each time. Each item carries this copy. Phase 5's 2026-10-20 decisions (item 01) still hold.

- **Gap 1, the trigger card = a card at creation.** A trigger gets its full card (schedule, next fire, On/Off) in its agent's thread as soon as it's registered, from its `trigger_registered` event. The app reads `GET /triggers?all=1`, so a spent or off trigger still shows its state. The one-line "fired" card stays as it is.
- **Gap 2, the notification list = the menu-bar panel.** The menu-bar panel shows the most recent notifications (e.g. the last 20), each with its delivery status. Each row opens what it links to, through the same `loomwright-studio://` link the notification's click would.
- **Gap 3, the notifier guards Playwright recursion = fixed in the guard.** This one needs no owner decision: the fix belongs in `kernel/test/notifier-guard.ts`, and the spec's workaround goes.
- **These land before phase 6.** Phase 6's foundation also edits `kernel/src/console/threads.ts`. These items run first, as phase-5 items.

## Scope

1. **The panel's list.** A "Recent" section in `MenubarPanel.tsx` reads `GET /notifications` (newest first, the latest 20). Each row shows the title, its age and a delivery-status badge (`delivered`, `unsupported`, `failed`), in the existing design-system components and tokens. The list updates from the feed when a notification is recorded.
2. **Opening a row** goes through the same deep-link handler a notification click uses (`app/src/screens/menubar/links.ts`), so a row and a click open the same thread or approval.
3. **Designed states:** empty ("No notifications yet"), loading, kernel unreachable (the shared band). Keyboard: rows are reachable with arrows, and Enter opens one. Polish-gate screenshots go in the PR, light and dark.
4. **The runbook:** update flow 1's note in `docs/evidence/phase-5-exit-runbook.md`.

**Not here:** the gap's `docs/OPEN_QUESTIONS.md` entry is updated in the phase 5 close-out commit (with the live run's evidence), so items 19–21 don't conflict on it. Say what's fixed in the PR body.

## Non-goals

- A Notifications screen, dismissing or marking read, or any kernel change.

## Acceptance criteria

- [ ] Given three notifications in the fixture kernel, when the menu-bar panel opens, then three rows show newest first, each with its delivery status.
- [ ] Given a row for an approval's notification, when it is opened (click or Enter), then the app comes forward on that approval, exactly as the deep link would.
- [ ] Given no notifications, then the empty state shows.
- [ ] Given a new notification on the feed, then a row appears without a reload or layout shift.
- [ ] `menubar.test.tsx` and `menubar.spec.ts` pass. The polish-gate screenshots are in the PR.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- `bash scripts/check-docs.sh`
- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- `GET /notifications` returns rows newest first, with `deep_link` and `delivery_status`. If it doesn't, stop and say so: that's a kernel change outside this item.

## Risks

- The panel growing too tall. Cap it at 20 rows, scrolling within the panel.

## Depends on
none

## Touches
app/src/screens/menubar/
app/e2e/menubar.spec.ts
app/e2e/fixtures/menubar.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-24T14:28:56Z
- **Brief:** .supervisor/jobs/done/2026-10-24-menu-bar-recent-notifications.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/129
