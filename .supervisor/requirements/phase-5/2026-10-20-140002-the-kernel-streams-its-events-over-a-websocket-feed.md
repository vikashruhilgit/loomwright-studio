# 02 — The kernel streams its events over a WebSocket feed the app can resume

## Status: ready

**Priority:** MVP · phase 5 (live updates for every screen) · D11, invariants 2, 3

**As** the owner,
**I want** the app to see each new approval, reply and session change the moment the kernel records it,
**so that** no screen ever shows stale state or makes me refresh.

## Problem

Item 01 routes an authenticated `GET /events/stream` upgrade to a stub `handleEventFeed` in `kernel/src/api/feed.ts` that closes at once. The kernel's `events` table is append-only, ids follow append order, and triggers refuse rewrites (ARCHITECTURE, `events`), so it is a natural resumable feed.

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

1. **The feed** (`kernel/src/api/feed.ts`):
   - The client's first frame is `{"type": "subscribe", "after": <event id or 0>}`. The server sends every event with id > `after`, oldest first, in pages of at most 500 frames, then each new event as it is appended: `{"type": "event", "id", "at", "kind", "session_id", "task_id", "payload"}`.
   - A `{"type": "heartbeat", "latest_id"}` goes every 15 s.
   - New events are found by polling `events` for `id > last` every 250 ms per process (one shared poll for all clients, stopped while none is connected), never by hooking writers.
2. **Bounds and safety:**
   - At most 4 clients. A fifth is refused with close code 1013.
   - A client too slow to keep up is closed with 1011 and resumes from its last id.
   - Payloads are sent as stored, as JSON values (untrusted data, never interpreted). A frame over 1 MiB is replaced with `{"type": "event", "id", "kind", "truncated": true}`, which tells the client to fetch the row through REST.
   - A malformed client frame closes with 1003.
   - The token check stays in `server.ts` (item 01), before the upgrade.
   - The feed stops cleanly on graceful stop and on the kill switch.
3. **A read route for gaps:** `GET /events?after=<id>&limit=<n>` (in item 01's `kernel/src/console/events.ts` part) returns the same frames as JSON (at most 500), for a client that missed a truncated or late frame.
4. **Docs:** `docs/architecture/feed.md` (item 01's stub): the protocol, the bounds, close codes and resume.

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- What the app does with events (item 12).
- Pushing anything other than `events` rows.

## Acceptance criteria

- [ ] Given events 1–10, when a client subscribes with `after: 7`, then it receives 8, 9 and 10 in order, then each new event within 500 ms of its append.
- [ ] Given a client that disconnects after 12 and resubscribes with `after: 12` while 13–15 were appended, then it receives exactly 13–15, none twice and none missed.
- [ ] Given no token, then no upgrade happens (item 01's check, still pinned). Given a fifth client, then 1013. Given a malformed frame, then 1003.
- [ ] Given an event payload over 1 MiB, then the frame is the truncated form and `GET /events?after=` returns the row.
- [ ] Given no client connected, then no poll timer runs.
- [ ] `feed.md` documents it, and `bash scripts/check-docs.sh` passes.

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
kernel/src/api/feed.ts
kernel/src/console/events.ts
kernel/test/api-feed.test.ts
docs/architecture/feed.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-21T15:22:04Z
- **Brief:** .supervisor/jobs/done/2026-10-21-kernel-event-feed-websocket.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/104
