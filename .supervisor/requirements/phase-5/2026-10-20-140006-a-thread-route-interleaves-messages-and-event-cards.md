# 06 — A thread route interleaves an agent's messages with one-line event cards

## Status: ready

**Priority:** MVP · phase 5 Chat and Crew threads · D25, DESIGN.md §5

**As** the owner,
**I want** one route that returns an agent's thread: its messages and the kernel events about it, in time order, paged backwards,
**so that** Chat and each Crew thread show what was said and what the kernel did, as the approved mockup does.

## Problem

`GET /messages` lists message rows, and the events log holds what the kernel did, but nothing joins them per agent. The mockup's thread interleaves EventCards (session started, playbook created, memory updated with its path, approval decided) with messages and ends with the agent's pending approval inline.

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

1. **Route** (this item's part, `kernel/src/console/threads.ts`): `GET /threads/:agent?before=<cursor>&limit=<n>` (default 50, max 200) answers `{items, next_before, pending_approvals}`.
   - Each item is `{type: "message", …the brain_messages row}` or `{type: "event", id, at, kind, summary, ref}`.
   - The event kinds come from a closed list in code: session started and ended, playbook created, updated, enabled or disabled, approval requested and decided, agent created, renamed, set or turned off, `memory_updated` (when one exists), and trigger fired.
   - `summary` is a one-line kernel-written sentence, and stored names inside it are escaped.
   - `pending_approvals` are the agent's pending approvals.
   - `wright` and every registered agent are valid. Unknown → `404`.
   - Delegations and replies (`from_agent`) appear in both agents' threads, marked as quoted data from their source.
2. **Ordering and paging:** by time, then id, and stable. The cursor is opaque. The feed's events (item 02) tell the app when to refetch the head.
3. **Docs:** `docs/architecture/threads.md` (item 01's stub): the item shapes, the event list and the paging.

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- Rendering (item 13).
- New event kinds: this lists existing ones only.

## Acceptance criteria

- [ ] Given Wright's three messages and the events in between (session started, playbook created, approval requested), when `GET /threads/wright`, then items interleave in time order with one-line summaries, and `pending_approvals` lists the pending one.
- [ ] Given 120 items, when paging with `limit=50`, then three pages cover them all with no duplicates.
- [ ] Given a delegation from Wright to `mason`, then it appears in both threads, marked `from_agent: wright`.
- [ ] Given an unknown agent, then `404`. Given a playbook name with a control character, then its summary escapes it.
- [ ] `threads.md` documents it, and `bash scripts/check-docs.sh` passes.

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
kernel/src/console/threads.ts
kernel/test/console-threads.test.ts
docs/architecture/threads.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-22T02:13:21Z
- **Brief:** .supervisor/jobs/done/2026-10-21-thread-route-messages-event-cards.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/108
