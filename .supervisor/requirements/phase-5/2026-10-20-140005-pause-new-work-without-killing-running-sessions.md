# 05 — Pause new work, without killing running sessions

## Status: ready

**Priority:** MVP · phase 5 menu bar (Pause all) · D2, D5, D11

**As** the owner,
**I want** one Pause that stops anything new from starting while running work finishes its turn,
**so that** I can quiet the kernel without the kill switch's hard stop.

## Problem

The kernel has the kill switch only (`kernel/src/api/kill-switch.ts`): durable through `kill_switch_engaged` / `kill_switch_released` events, it stops the loop and every live session, and triggers don't fire while it is engaged (`kernel/src/triggers/store.ts`). The approved menu bar also has "Pause all", and the owner chose that it pause new work.

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

1. **Durable state** (`kernel/src/console/pause.ts`): `pause_engaged` / `pause_released` events (`by: owner`, `via`). `isPaused(store)` reads the latest, like the kill switch. No restart releases it.
2. **What pause does:**
   - No trigger fires. A trigger's instants inside a pause are recorded `missed_paused` and never fired, exactly as for the kill switch (`kernel/src/triggers/store.ts`).
   - No new session starts or resumes. Admission (`admissionFor` in `kernel/src/kernel.ts`) refuses with reason `paused`, and the loop parks the event under the existing park rule (no second notify), so it runs after the release.
   - Running sessions are untouched and finish their turn.
   - `POST /ask` still queues: the message waits.
3. **Routes and CLI:**
   - `POST /pause` and `POST /unpause` (this item's part).
   - `POST /resume` (the kill switch's release, in `kernel/src/api/server.ts`) also releases a pause, since the owner chose that resume clears it.
   - `GET /status` gains `paused`.
   - `studio pause` and `studio unpause`, contributed.
4. **Docs:** `docs/architecture/pause.md` (item 01's stub).

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- Changing the kill switch.
- Any automatic pause (a schedule or a cap): owner action only.

## Acceptance criteria

- [ ] Given `POST /pause`, when a trigger comes due, then it is recorded `missed_paused` and nothing fires. After `POST /unpause`, later instants fire.
- [ ] Given a pause, when a queued message would start a session, then admission refuses `paused`, the event is parked once with no second notify, and after unpause it runs.
- [ ] Given a running session, when the owner pauses, then it finishes its turn and ends normally.
- [ ] Given a pause, when the kernel restarts, then it is still paused. Given `POST /resume`, then both the kill switch and the pause are released.
- [ ] `GET /status` shows `paused`, and `pause.md` documents it. `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- None beyond the owner decisions above.

## Risks

- A lane that finds the contract (item 01) does not fit stops and says so rather than changing the contract.

## Depends on
2026-10-20-140001-phase-5-foundation-app-scaffold-api-seams-and-contract.md

## Touches
kernel/src/console/pause.ts
kernel/src/triggers/store.ts
kernel/src/kernel.ts
kernel/src/api/server.ts
kernel/test/console-pause.test.ts
docs/architecture/pause.md
