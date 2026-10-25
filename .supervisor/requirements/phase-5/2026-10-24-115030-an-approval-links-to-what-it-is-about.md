# 30 — An approval links to what it's about

## Status: ready

**Priority:** Polish · phase 5 item 15 (Approvals)

**As** the owner,
**I want** an approval about a playbook to link to that playbook's card, and its source label to read clearly,
**so that** after Allow once I can go straight to Run now.

## Problem

In the live run, after allowing the held `kernel_playbook_enable` (approval 6), nothing linked the approval to the playbook's card, where Run now is, and the owner asked where Run now was. The approval read "Not from a playbook". That's true, since the call came from Wright's chat session, but it reads wrongly on an approval about a playbook.

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. An approval whose payload names a playbook (enable, set, run) or a crew member (create) shows a link: "Open playbook <slug>" scrolls Wright's thread to the card, and "Open in Team" goes to the member.
2. The source label reads "Requested by Wright in chat" (or "by playbook <slug>") instead of "Not from a playbook".
3. The same link appears on the thread's inline pending-approval card.

## Non-goals

- Any kernel change: read the existing payload fields.

## Acceptance criteria

- [ ] Given an approval shaped like approval 6 (enabling playbook 3, from chat), then it shows "Requested by Wright in chat" and "Open playbook phase5-exit-1024", which opens Chat on that card.
- [ ] Given a `kernel_agent_create` approval, then it shows "Open in Team" once it's decided.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- Each approval kind's payload carries the playbook id or member id. It does for enable and create; check the others.

## Risks

- Scrolling the thread to the card needs a stable anchor, and item 25 owns the card. If the anchor is missing, stop and say so.

## Depends on
2026-10-24-115025-the-playbook-card-shows-and-sets-every-field-honestly.md

## Touches
app/src/screens/approvals/
app/e2e/approvals.spec.ts
app/e2e/fixtures/approvals.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-25T06:32:29Z
- **Brief:** .supervisor/jobs/done/2026-10-25-an-approval-links-to-what-it-is-about.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/138
