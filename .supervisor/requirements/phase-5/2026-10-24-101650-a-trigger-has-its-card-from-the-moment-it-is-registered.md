# 19 — A trigger has its card in Chat from the moment it's registered, not only after it fires

## Status: ready

**Priority:** MVP (phase 5 follow-up, found by the exit e2e) · ROADMAP phase 5 ("everything in phases 2–4 can be done from the app") · D4, invariant 1

**As** the owner,
**I want** each reminder or trigger to show its full card, with On and Off, in its agent's thread as soon as it's registered,
**so that** I can turn off a trigger that hasn't fired yet from the app, without typing `studio triggers off` in a terminal.

## Problem

Chat's `TriggerCard` (with On and Off) is attached only under a `trigger_fired` event (`app/src/screens/chat/Thread.tsx:330`). The thread kinds tie only `trigger_fired` to a trigger (`kernel/src/console/threads.ts:70`), although the store records `trigger_registered` (`kernel/src/triggers/store.ts:92`). The app reads `GET /triggers` without `all=1` (`app/src/store/resources.ts:64`), and the route returns enabled triggers only unless `all=1` (`kernel/src/triggers/routes.ts:5`, :49). The result:
- a trigger has no card before it fires;
- a fired one-time reminder (spent) shows only the one-line "fired" card;
- a trigger that is still on and never fired can't be turned off from Chat.

The phase 5 runbook records this gap (`docs/evidence/phase-5-exit-runbook.md:172`).

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24 in the phase 6 requirements session, when the owner asked for the gaps the phase 5 exit e2e found (`docs/OPEN_QUESTIONS.md`, "Known gaps the e2e found") to be written up as items. The owner chose the proposed option each time. Each item carries this copy. Phase 5's 2026-10-20 decisions (item 01) still hold.

- **Gap 1, the trigger card = a card at creation.** A trigger gets its full card (schedule, next fire, On/Off) in its agent's thread as soon as it's registered, from its `trigger_registered` event. The app reads `GET /triggers?all=1`, so a spent or off trigger still shows its state. The one-line "fired" card stays as it is.
- **Gap 2, the notification list = the menu-bar panel.** The menu-bar panel shows the most recent notifications (e.g. the last 20), each with its delivery status. Each row opens what it links to, through the same `loomwright-studio://` link the notification's click would.
- **Gap 3, the notifier guards Playwright recursion = fixed in the guard.** This one needs no owner decision: the fix belongs in `kernel/test/notifier-guard.ts`, and the spec's workaround goes.
- **These land before phase 6.** Phase 6's foundation also edits `kernel/src/console/threads.ts`. These items run first, as phase-5 items.

## Scope

1. **Kernel:** `THREAD_EVENT_KINDS` gains `trigger_registered`, tied by `trigger` (its payload's `trigger_id`, the trigger's `owning_agent`), so `GET /threads/:agent` returns a one-line "Trigger <id> registered" card. Pin it in `console-threads.test.ts`.
2. **App:** the store's `triggers` resource reads `GET /triggers?all=1`. `Thread.tsx` attaches the `TriggerCard` under the `trigger_registered` card, once per trigger: under the latest of its registered or fired cards, so a recurring trigger shows one live card, not one per fire. A spent or off trigger's card shows that state, with On where turning it on is allowed. The card updates from the feed (`trigger_toggled` / `trigger_fired`) without a reload or layout shift.
3. **The runbook:** update `docs/evidence/phase-5-exit-runbook.md` flows 1 and 5 and its cleanup note to describe the card that now shows.

**Not here:** the gap's `docs/OPEN_QUESTIONS.md` entry is updated in the phase 5 close-out commit (with the live run's evidence), so items 19–21 don't conflict on it. Say what's fixed in the PR body.

## Non-goals

- A Schedules screen (phase 7). A new event kind: `trigger_registered` already exists.

## Acceptance criteria

- [ ] Given Wright registers a reminder, when its thread loads, then a "registered" card with the full `TriggerCard` (schedule, next fire, On/Off) shows before it fires.
- [ ] Given that card's Off, then `POST /triggers/:id/off` is called, and the card shows it off without a reload.
- [ ] Given a one-time reminder that fired, then its card shows it spent (off), and the one-line "fired" card still shows.
- [ ] Given a cron trigger that fired three times, then exactly one `TriggerCard` shows, under the latest card.
- [ ] Phase 5's chat tests and `phase-5-exit.spec.ts` pass (updated where they asserted the old absence).

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- `bash scripts/check-docs.sh`
- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- `trigger_registered`'s payload carries `trigger_id`, as the other trigger events' payloads do (`threads.ts:267`). If it doesn't, stop and say so.

## Risks

- A busy thread with many triggers. One card per trigger bounds it.

## Depends on
none

## Touches
kernel/src/console/threads.ts
kernel/test/console-threads.test.ts
app/src/store/resources.ts
app/src/screens/chat/Thread.tsx
app/src/screens/chat/thread.test.tsx
app/src/screens/chat/cards.test.tsx
app/e2e/chat.spec.ts
app/e2e/fixtures/chat.ts
app/e2e/phase-5-exit.spec.ts
docs/evidence/phase-5-exit-runbook.md
