# 03 — The kernel keeps a bounded output log for every session

## Status: ready

**Priority:** MVP · phase 5 Sessions screen · D10, invariants 3, 8

**As** the owner,
**I want** every session's output kept by the kernel, bounded and readable after it ends,
**so that** the Sessions screen can stream and replay what an agent did without the app reading CLI files.

## Problem

The kernel keeps no session output. The SDK's messages pass through the session manager (its `onMessage` feeds the budget meter) and are dropped. Item 01 adds the `session_output` table (migration 016), an `onOutput(sessionId, message)` sink in the manager and a no-op `recordSessionOutput` in `kernel/src/console/output.ts`.

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

1. **Record** (`kernel/src/console/output.ts`): for each SDK message, append zero or more rows:
   - `assistant_text` (each text block, cut to 8,000 characters with a cut note);
   - `tool_call` (name plus input, the JSON cut to 4,000 characters);
   - `tool_decision` (copied from the kernel's own `tool_decision` decision for that call: allow, deny with reason, held with approval id);
   - `tool_result` (cut to 4,000 characters, with error-ness kept);
   - `result` (subtype, the counted tokens);
   - `system` (init: model and tool count only).
   Per session, at most 2,000 rows and 2 MiB. Past either, one `system` row says output was cut and nothing more is kept. Every write is one small transaction, never awaited by the stream. A write failure is logged once per session and never fails the session (the output log is a record, not a control).
2. **Untrusted:** every stored string is data. Rows are never interpreted, and stored text is escaped wherever it is printed.
3. **Routes** (this item's part in `console`): `GET /sessions?status=<s>&limit=<n>` (id, agent, status, model, started, ended, tokens, `cwd`, playbook) and `GET /sessions/:id/output?after=<seq>&limit=<n>` (rows in order). New rows also reach the app through the feed as `session_output_appended` events (one per batch, not per row, at most one per 250 ms per session).
4. **CLI:** `studio sessions [--json]` and `studio sessions output <id> [--follow]`, contributed.
5. **Docs:** `docs/architecture/session-output.md` (item 01's stub).

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- Any change to how sessions run, are metered or are gated.
- Retention policy beyond the per-session caps (later; the owner sets it).

## Acceptance criteria

- [ ] Given a stand-in session that emits text, a Bash call the gate denies, a result, then ends, when `GET /sessions/:id/output` is read, then the rows are `system`, `assistant_text`, `tool_call`, `tool_decision` (deny, reason), `result`, in order.
- [ ] Given 2,500 messages, then 2,000 rows are kept, plus one cut note, and the session is unaffected.
- [ ] Given the store refusing a write (an injected fault), then the session still completes, with one logged warning.
- [ ] Given a text block with an escape sequence, when `studio sessions output` prints it, then it is escaped.
- [ ] Given a running session, when rows are appended, then the feed carries `session_output_appended` at most every 250 ms.
- [ ] `session-output.md` documents it, and `bash scripts/check-docs.sh` passes.

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
kernel/src/console/output.ts
kernel/test/console-output.test.ts
docs/architecture/session-output.md
