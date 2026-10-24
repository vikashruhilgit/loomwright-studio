# 25 — The playbook card shows and sets every field honestly, and stays after Turn off

## Status: ready

**Priority:** MVP, blocking the phase 5 rerun · D4, D9 · ROADMAP phase 5

**As** the owner,
**I want** the playbook card to show unset values as unset, let me set any field where I'd look for it, and stay visible after I turn the playbook off,
**so that** I can drive a playbook from Chat without guessing where a control is.

## Problem

Found in the live run (the owner's screenshots, 2026-10-24):
- **"default" for an unset model.** The card shows Model "default" when it's unset (`app/src/screens/chat/cards.tsx:224`, `playbook.model ?? "default"`). There is no default: the kernel refused the dry run ("the playbook has no model, and the kernel never picks one").
- **The model field is hidden.** It's reachable only by changing a separate Field dropdown (`cards.tsx:168`, :250-276). The owner couldn't find it.
- **The form is misaligned.** With a text Value, the hint "none clears it" makes the Value column taller, so FIELD, VALUE and the Set button don't line up.
- **A turned-off playbook loses its card.** After Turn off, the card reads "Playbook 3 is not in the kernel's playbook list", because the app reads `GET /playbooks` (`app/src/store/resources.ts:63`), which leaves out a disabled playbook. Its trigger (still on) can no longer be reached from Chat.
- **Kernel messages look like the owner's.** In Wright's thread, the kernel's decision message ("approved approval 6: …") renders as an owner bubble ("You").

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24, after the phase 5 live exit run (harness `phase-5-exit-live`: all six flows passed its store checks). The owner asked for the run's findings to be written up as phase-5 items, and for a recommendation on when to test them. The recommendation (pending the owner's OK on the plan doc):

- **Fix before phase 6, then a short rerun.** These items (22–30) and the gap items (19–21) land before phase 6's foundation, then a short phase 5 live rerun checks them. Phase 6 builds on the same notifier, threads and cards (connector notifications, draft cards), and its foundation edits `kernel/src/console/threads.ts`. Testing everything after phase 6 would mix two phases' failures, against ROADMAP's rule that every phase ends with a check in the running system.
- **Blocking for the rerun:** 22 (the notification click opens the app), 23 (Wright points to the app, not the CLI), 24 (Stop/Kill on a starting session) and 25 (the playbook card). 26–30 are polish, and run in the same waves because they're small.
- **Phase 5's own decisions stand.** In particular: "the kernel posts [notifications], and the app opens their links" (phase 5 item 01), and the exit criterion "everything in phases 2–4 can be done from the app, with nothing typed in a terminal".

## Scope

1. **Unset is "not set"**, for model and every other policy field. A field the kernel requires before a dry run (model) shows "not set: needed before a dry run".
2. **Set where you look.** Each policy row gets its own Set action (an inline edit on the row), replacing the separate Field dropdown. A hint sits under the row and doesn't move the controls. The keyboard path stays (Tab to a row, Enter to edit). This is a layout change: the PR carries light and dark screenshots for the owner's polish gate, in the approved card style.
3. **The card survives Turn off.** The store reads the kernel's playbook list including disabled playbooks. Check the route in `kernel/src/playbooks/`, and if it offers no such option, stop and say so (it's a kernel change outside this item). An off playbook's card shows `disabled`, with Turn on where the kernel allows it, and its trigger card stays.
4. **Decision messages are attributed to the kernel.** A message whose source is the kernel's approval decision renders as a system card ("Approval 6 approved once by you: the kernel enabled …"), not as the owner's bubble. Decide by the message's source field, never by its text.

## Non-goals

- A Playbooks screen (phase 7).

## Acceptance criteria

- [ ] Given a playbook with no model, then the card shows "not set: needed before a dry run", never "default".
- [ ] Given the card, when the owner edits the Model row inline and confirms, then `POST /playbooks/:id/set {field: model, value}` is sent, and the row shows the value "set by owner".
- [ ] Given a text field's hint, then the row's controls stay aligned (a screenshot in the PR).
- [ ] Given Turn off, then the card stays, shows `disabled`, and its trigger card is still reachable.
- [ ] Given an approval decision message in the thread, then it renders as a kernel card, not a "You" bubble.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- The kernel's playbook list can include disabled playbooks, as `/triggers?all=1` does. Not yet verified.

## Risks

- A layout change to an approved component. Keep to the design system's tokens and show it in the PR.

## Depends on
2026-10-24-101650-a-trigger-has-its-card-from-the-moment-it-is-registered.md

## Touches
app/src/screens/chat/cards.tsx
app/src/screens/chat/cards.test.tsx
app/src/screens/chat/Thread.tsx
app/src/screens/chat/thread.test.tsx
app/src/screens/chat/chat.css
app/src/store/resources.ts
app/e2e/chat.spec.ts
app/e2e/fixtures/chat.ts
