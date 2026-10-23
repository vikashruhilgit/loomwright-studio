# 17 — The menu bar, deep links, Pause all and the kill switch

## Status: ready

**Priority:** MVP · phase 5 (menu bar) · D11, D5, invariant 2

**As** the owner,
**I want** a menu-bar icon that shows the kernel's state and approval count, with Open, Pause all, Kill switch and Resume, and notifications that open the right place,
**so that** I can see and steer the kernel at a glance, and a notification click takes me straight to it.

## Problem

Item 01 leaves `app/electron/tray.ts` and `app/electron/deeplink.ts` as stubs and registers the `loomwright-studio://` scheme in packaging. The kernel has `/stop-all`, `/resume`, `/status` and pause (item 05). The kernel already posts notifications whose deep links are `loomwright-studio://notifications/<id>`.

## Owner decisions (2026-10-20, binding)

Recorded 2026-10-20 in the product-owner session (every option the owner chose was the one proposed). Each item carries this copy. The approved design (D9, DESIGN.md, `docs/design/`) and D10, D11, D22–D25 stay as they are.

- **Live feed = one WebSocket event feed.** It runs on the existing 127.0.0.1 API server, behind the same bearer token, as ARCHITECTURE's diagram says. It streams the kernel's append-only `events` by id, so after a reconnect the app resumes from the last id it saw and never misses one. REST stays for reads and actions.
- **Session output = a bounded log the kernel keeps.** While a session streams, the kernel stores its assistant text, each tool call with the kernel's decision, and the results, each cut to size and marked as untrusted data. The app reads it and follows it live, so an ended session can still be reviewed. The app never reads the CLI's own files (D10: a thin shell).
- **v1 coverage = Chat cards and the ⌘K palette.** The Playbooks, Schedules and Memory screens stay GUI v2 (phase 7). In v1, a playbook or trigger appears in Chat as a card with Run now, Turn off and Set <field>. Every owner verb from phases 2–4 is also a ⌘K command. Approvals lists and revokes standing grants.
- **Setup stays in the terminal; Wright's model moves into the app.** The subscription token stays in the owner's own terminal (D27), and so does `studio service install`; the app shows a designed "kernel not installed / unreachable" state with the exact commands. Wright's model, effort and limits become editable from Team's inspector through a new owner route, because today `studio agents set` refuses `wright`. The phase 5 exit criterion starts after setup.
- **Packaging = a local, ad-hoc-signed `Loomwright Studio.app`.** `npm run package` in `app/` builds it on the owner's Mac, and the owner opens it from Finder or the Dock. It's never published, not a release (D20), and not notarised (that stays with commercial readiness).
- **Stack = `app/`: Electron + React + TypeScript + Vite.** It's a new package beside `kernel/`. The Electron main process is thin: window, menu-bar tray, the Keychain token and `api.json`, the `loomwright-studio://` URL scheme. The React renderer talks to the kernel only over the loopback API. Tests use vitest with React Testing Library, plus a Playwright Electron smoke run in CI.
- **Polish gate = evidence on each screen's PR.** Each screen's PR commits screenshots from the running app in light and dark mode, plus every designed state (empty, loading, error, waiting on you), and names the mockup screen they match. The owner's approval of that PR is the screen's polish gate (D9). The exit check then covers whole flows.
- **Pause all = pause new work.** This is a new kernel mechanism: no trigger fires and no new session starts, while running sessions finish their turn. It's durable in the events log, as the kill switch is, and `resume` clears it. The kill switch stays the immediate stop-and-kill.
- **Notifications: the kernel posts them, and the app opens their links.** The kernel keeps posting (D11: it never depends on the GUI). The app registers the `loomwright-studio://` scheme the deep links already use, so a click opens the app on that approval or thread, launching it if it was closed.
- **Stop is graceful; Kill is immediate.** Stop is today's stop: stdin EOF, then the group kill after the ~2 s grace, ending `stopped`. Kill kills the CLI's group and every recorded tool group at once, with no grace, and always asks for confirmation. Both are new per-session owner routes.
- **Threads = messages plus event cards.** A thread shows the agent's message rows (the owner's, its replies, and delegations and replies as quoted data) interleaved with one-line event cards from the events log: sessions, playbooks, memory, approvals. All of its history is there, paged backwards, with a pending approval inline at the end (DESIGN.md §5).
- **Lifecycle = the tray stays, and there's no autostart.** Closing the window leaves the menu-bar icon running; Quit is in the tray. Launch at login is a Settings toggle (GUI v2). The kernel runs regardless (D11).

## Scope

1. **Tray** (`app/electron/tray.ts`):
   - The status dot: idle, working, waiting on you, paused at cap, and paused or killed, from `/status` and the feed.
   - The pending-approval count.
   - Menu items: Open; Pause all (→ `POST /pause`) or Unpause; Kill switch (→ a confirm, then `POST /stop-all`); Resume (releases both); Quit app.
   - Closing the window keeps the tray running. Quitting never stops the kernel (D11).
2. **Deep links** (`app/electron/deeplink.ts`): `loomwright-studio://notifications/<id>` opens the app (launching it if closed) on what that notification is about: the approval, the thread or the playbook card, resolved through `GET /notifications/:id`. An unknown or malformed link opens the app with a toast and nothing else. A link is untrusted input, so it can never cause an action, only navigation.
3. **⌘K commands:** pause or unpause, kill switch (confirm), resume.
**Polish-gate evidence (owner decision):** commit screenshots from the running app, captured against the fixture kernel, in light and dark mode for every designed state (empty, loading, error with the kernel-unreachable band, waiting on you, and the populated state), under `docs/evidence/phase-5-polish/<screen>/`. The PR names the mockup screen (`docs/design/mockups/gui-v1.html`) each matches. The owner's approval of the PR is the screen's polish gate.

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- Other screens. Kernel changes: a missing route or field is a finding, so stop and say so.

## Acceptance criteria

- [ ] Given the fixture kernel with two pending approvals, then the tray shows a count of 2 and the waiting state.
- [ ] Given Pause all, then `POST /pause` is called, and the dot shows paused only after `/status` says so.
- [ ] Given Kill switch, then a confirm dialog opens, and only on confirm is `/stop-all` called.
- [ ] Given `loomwright-studio://notifications/7` for an approval, then the app opens on that approval with nothing decided. Given `loomwright-studio://approve/7`, or any unknown path, then nothing happens beyond a toast.
- [ ] Given the window closed, then the tray stays. Given Quit, then the app exits and the kernel keeps running (asserted against the fixture).
- [ ] Every designed state is screenshotted in both themes and committed, and keyboard-only use reaches every action.
- [ ] `cd app && npm run typecheck && npm test && npm run build` passes, and so does the screen's Playwright spec.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`

## Assumptions

- None beyond the owner decisions above.

## Risks

- A lane that finds the contract (item 01) does not fit stops and says so rather than changing the contract.

## Depends on
2026-10-20-140001-phase-5-foundation-app-scaffold-api-seams-and-contract.md
2026-10-20-140005-pause-new-work-without-killing-running-sessions.md
2026-10-20-140008-app-primitives-button-badge-input-statusdot-dialog-list-card-toast.md
2026-10-20-140009-the-stitched-sea-creature-avatar.md
2026-10-20-140011-the-command-palette-and-keyboard-map.md
2026-10-20-140012-the-apps-live-store-rest-plus-the-event-feed.md

## Touches
app/electron/tray.ts
app/electron/deeplink.ts
app/src/screens/menubar/
app/e2e/fixtures/menubar.ts
app/e2e/menubar.spec.ts
docs/evidence/phase-5-polish/menubar/

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-23T16:27:14Z
- **Brief:** .supervisor/jobs/done/2026-10-22-menu-bar-deep-links-pause-kill-switch.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/122
