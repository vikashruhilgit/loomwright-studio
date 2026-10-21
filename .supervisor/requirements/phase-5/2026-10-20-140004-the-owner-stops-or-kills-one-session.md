# 04 — The owner stops or kills one session from the app

## Status: ready

**Priority:** MVP · phase 5 Sessions screen (Stop / Kill) · D2, D5, invariant 2

**As** the owner,
**I want** to stop one session gracefully, or kill it at once, without engaging the kill switch,
**so that** I can end one runaway agent and leave the rest running.

## Problem

Only the kill switch (`POST /stop-all`) and an orphan's abandon (`POST /sessions/:id/abandon`) are routes. `SessionManager.stopSession(id)` exists (stdin EOF, ~2 s grace, then the group kill-until-gone) but no route calls it, and no kill path skips the grace. Item 01 gives contributed routes the session manager.

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

1. **Kill now** in the manager (`kernel/src/sessions/manager.ts`): `stopSession(id, {mode: "kill"})` skips the grace. It kills the CLI's group and every recorded tool group with the existing kill-until-gone and identity checks (H08), ending `stopped` with `reason: "owner_kill"`, or `failed`/`kill_incomplete` exactly as any kill that can't confirm the group gone. `mode: "stop"` stays today's behaviour, reason `owner_stop`.
2. **Routes** (this item's part, `kernel/src/console/control.ts`):
   - `POST /sessions/:id/stop` and `POST /sessions/:id/kill` answer `200 {id, status, reason}`.
   - They refuse `400 invalid_id`, `404 not_found`, and `409 not_running` with the current status.
   - Each records `session_stop_requested` (`by: owner`, `mode`).
   - They run one at a time with the other POSTs, as `stop-all` does.
3. **CLI:** `studio session stop <id>` and `studio session kill <id> [--yes]`. Kill asks for confirmation unless `--yes`, and refuses without a terminal.
4. **Docs:** `docs/architecture/session-control.md` (item 01's stub).

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- The kill switch, which is unchanged.
- Stopping a session the kernel did not start.

## Acceptance criteria

- [ ] Given a running stand-in session, when `POST /sessions/:id/stop`, then it ends `stopped` (`owner_stop`) after its grace, and its groups are gone.
- [ ] Given a running session with a recorded tool group, when `POST /sessions/:id/kill`, then the CLI's group and the tool group are killed with no grace, and it ends `stopped` (`owner_kill`).
- [ ] Given a kill whose group can't be confirmed gone, then it ends `failed`/`kill_incomplete`, flagged for the reaper, as any kill does.
- [ ] Given a completed session, then `409 not_running`. Given an unknown id, then `404`.
- [ ] Given `studio session kill 5` with no terminal and no `--yes`, then it refuses with exit 2.
- [ ] `session-control.md` documents it, and `bash scripts/check-docs.sh` passes.

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
kernel/src/sessions/manager.ts
kernel/src/console/control.ts
kernel/test/console-control.test.ts
kernel/test/sessions-stop-all.test.ts
docs/architecture/session-control.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-21T15:22:59Z
- **Brief:** .supervisor/jobs/done/2026-10-21-owner-stops-or-kills-one-session.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/103
