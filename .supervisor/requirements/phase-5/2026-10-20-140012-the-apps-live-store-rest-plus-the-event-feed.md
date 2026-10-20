# 12 — The app's live store: REST reads plus the event feed, with reconnect and the kernel-unreachable state

## Status: ready

**Priority:** MVP · phase 5 (every screen's data) · D11, invariant 3

**As** the owner,
**I want** one live store in the app that loads from REST, follows the feed, and resumes after the kernel restarts,
**so that** every screen shows current state, and a kernel restart never leaves the app silently stale.

## Problem

Item 01 provides the REST client (the main process makes calls through the preload bridge), the contract types and the fixture kernel. Item 02 builds the feed against item 01's contract. No screen has a data layer.

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

1. **The store** (`app/src/store/`): per resource (status, approvals, agents, messages, threads, sessions, playbooks, triggers, notifications) it does a REST load, then applies feed events (by `kind`) to update or refetch the affected resource. It keeps the last event id and resubscribes with `after` on reconnect, with backoff (0.5 s → 10 s).
2. **The connection states** drive the shell's designed states (item 01): connecting, live, reconnecting (the band, with the last-updated time), and kernel unreachable or not installed (the setup state).
3. **Honest status:** nothing shows `ok` unless the kernel said so. Stale data is labelled stale while reconnecting.
4. **Testing:** against item 01's fixture kernel. Kill and restart the fixture, then assert resume with no missed or duplicated events.

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- Screen rendering (items 13–17).

## Acceptance criteria

- [ ] Given the fixture kernel, when an approval event arrives on the feed, then the approvals resource has it within one frame and no refetch storm (at most one refetch per resource per 250 ms).
- [ ] Given the fixture restarted mid-stream, then the store shows reconnecting, resubscribes from its last id, and ends with exactly the fixture's events.
- [ ] Given no fixture kernel, then the store reports unreachable, and the shell shows the setup commands.
- [ ] `cd app && npm run typecheck && npm test` passes.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`

## Assumptions

- None beyond the owner decisions above.

## Risks

- A lane that finds the contract (item 01) does not fit stops and says so rather than changing the contract.

## Depends on
2026-10-20-140001-phase-5-foundation-app-scaffold-api-seams-and-contract.md

## Touches
app/src/store/
app/e2e/store.spec.ts
