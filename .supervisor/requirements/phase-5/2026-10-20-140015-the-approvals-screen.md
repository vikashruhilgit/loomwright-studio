# 15 — The Approvals screen: the inbox, the exact payload, Allow once, Always for this playbook, Deny, and grants

## Status: ready

**Priority:** MVP · phase 5 (Approvals) · D3, D5, D7, invariant 3

**As** the owner,
**I want** every pending approval in one inbox showing exactly what will happen, decided with one key,
**so that** I never need `studio approvals`, `approve`, `deny` or `revoke` again.

## Problem

Item 01 leaves a stub at `app/src/screens/approvals/index.tsx`. The routes are `GET /approvals[?all=1]`, `POST /approvals/:id/approve` (`once` / `always`), `/:id/deny`, `/approvals/grants` and `/grants/:id/revoke`.

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

1. **List pane** (360px): pending first, oldest first, then decided ones on request. New approvals arrive without moving the list (DESIGN.md).
2. **Detail:** the action; the requesting agent and session; `from playbook <slug> v<n>`; the display (for example the charter preview, or a dry run) and the exact payload, both as untrusted text (escaped, monospace, never interpreted); the cwd; for a kernel-applied action, what the kernel will do.
3. **Decisions:**
   - Allow once (A), Always for this playbook (⇧A, only when the kernel would accept it; otherwise the button explains why), and Deny (D).
   - After a decision: the kernel's applied or refused line, and the message the agent gets.
4. **Grants:** a section listing standing grants, `current: false` marked, with Revoke, which asks for confirmation.
5. **⌘K commands:** approve or deny the selected one, show grants.
**Polish-gate evidence (owner decision):** commit screenshots from the running app, captured against the fixture kernel, in light and dark mode for every designed state (empty, loading, error with the kernel-unreachable band, waiting on you, and the populated state), under `docs/evidence/phase-5-polish/<screen>/`. The PR names the mockup screen (`docs/design/mockups/gui-v1.html`) each matches. The owner's approval of the PR is the screen's polish gate.

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- Other screens. Kernel changes: a missing route or field is a finding, so stop and say so.

## Acceptance criteria

- [ ] Given two pending approvals, then the oldest shows first. A third arriving doesn't move the selection.
- [ ] Given A on a charter create, then `approve … once` is called, and the kernel's "applied" sentence shows.
- [ ] Given ⇧A on a non-playbook approval, then it is disabled with the kernel's reason, and nothing is sent.
- [ ] Given a payload with an escape sequence or a bidi override, then it shows escaped.
- [ ] Given Revoke on a grant, then the confirm dialog opens, and on confirm `revoke` is called.
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
2026-10-20-140002-the-kernel-streams-its-events-over-a-websocket-feed.md
2026-10-20-140008-app-primitives-button-badge-input-statusdot-dialog-list-card-toast.md
2026-10-20-140010-conversation-components-chatbubble-eventcard-charter-diffview-streaminglog.md
2026-10-20-140011-the-command-palette-and-keyboard-map.md
2026-10-20-140012-the-apps-live-store-rest-plus-the-event-feed.md

## Touches
app/src/screens/approvals/
app/e2e/fixtures/approvals.ts
app/e2e/approvals.spec.ts
docs/evidence/phase-5-polish/approvals/
