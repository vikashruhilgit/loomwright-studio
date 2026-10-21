# 01 — Phase 5 foundation: the app scaffold, the kernel's GUI seams, and one contract every later item codes against

## Status: ready

**Priority:** MVP · ROADMAP phase 5 (prerequisite for every other item) · D9, D10, D11, D16, invariants 3, 6, 7

**As** the owner,
**I want** phase 5's shared files, dependencies, stubs and API contract created in ONE change first,
**so that** items 02–17 each edit only their own module, test and doc page, and run in parallel waves without merge conflicts.

## Problem

Nothing of the app exists: there's no `app/` directory, no Electron, React or Vite, and CI builds only `kernel/`. The kernel has no WebSocket (`kernel/src/api/server.ts` serves HTTP only), keeps no session output, and gives contributed routes only the store and the clock (`ContributedRouteRequest`, `kernel/src/features/contribution.ts:192`), so a contributed route can't stop a session. The phase 1 routes (`/stop-all`, `/resume`, `/sessions/:id/abandon`) live in `server.ts`. Every later item would need the same files: the migrations list, `features/index.ts` (pinned by `feature-seams.test.ts`), `server.ts`, `sessions/manager.ts`, `app/package.json` and its lockfile, the app's router, CI and `docs/ARCHITECTURE.md`. Unless one item owns them, no two items can share a wave.

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

1. **Kernel: migration 016** (append-only, contiguous, no SQL CHECK; value sets closed in code). `session_output`: id, session, seq (per session), kind (`assistant_text` / `tool_call` / `tool_decision` / `tool_result` / `result` / `system`), payload JSON (bounded), created. Update the `store.test.ts` pins. Item 03 fills it.
2. **Kernel: a `console` feature for the GUI.** `kernel/src/console/` with `index.ts` merging EMPTY parts from `events.ts` (item 02's `GET /events` read route), `output.ts` (item 03), `control.ts` (item 04), `pause.ts` (item 05) and `threads.ts` (item 06). Register it in `SHIPPED_CONTRIBUTIONS` after `agents`, and pin its parts in a new `kernel/test/console-foundation.test.ts`.
3. **Kernel: give contributed routes the kernel's controls.** `ContributedRouteRequest` gains `sessions` (the `SessionManager`, or undefined in a composition without one) and `killSwitch` (read only), so items 04 and 05 add routes by contribution and never edit `server.ts`.
4. **Kernel: two seams wired now, with stub bodies.**
   - **The WebSocket upgrade.** In `server.ts`, `GET /events/stream` with `Upgrade: websocket` is authenticated exactly like every route (bearer token, constant-time compare, before routing), then handed to `handleEventFeed(socket, req, ctx)` in a new `kernel/src/api/feed.ts`, which for now closes with code 1013 ("not yet"). Add the `ws` package to `kernel/package.json`. Item 02 fills `feed.ts`.
   - **The output sink.** In `sessions/manager.ts` (and `types.ts`), the manager calls an optional `onOutput(sessionId, message)` option for every SDK message, beside the existing `onMessage`. `kernel.ts` wires it to `recordSessionOutput` in `console/output.ts`, a no-op for now. Item 03 fills it.
5. **App: the scaffold** (`app/`, its own package).
   - Electron main (`app/electron/main.ts`, `preload.ts`): a context-isolated preload exposing only an `api` bridge, with no `nodeIntegration`.
   - The kernel connection (`app/electron/kernel-connection.ts`): read `<dataDir>/api.json` (pid + port, never a token), check the pid is alive, read the `loomwright-studio-api` Keychain item with `/usr/bin/security`, and talk only to `127.0.0.1`, as the CLI does (ARCHITECTURE, Loopback API). Never log the token, and never give it to the renderer: the main process makes the calls.
   - `app/electron/tray.ts` and `deeplink.ts` as stubs for item 17.
   - React + Vite renderer (`app/src/main.tsx`, `App.tsx`): the approved window layout (DESIGN.md "What the mockups commit phase 5 to": a 240px vibrancy sidebar with Chat, a Crew group, Team, Approvals and Sessions; a 52px title bar; the inspector and list-pane widths as tokens), routing to one stub screen per item (`app/src/screens/{chat,team,approvals,sessions}/index.tsx`, each a placeholder), and the designed "kernel unreachable" band and "kernel not installed" state with the exact setup commands.
   - Design tokens: `app/scripts/tokens.mjs` generates `app/src/styles/tokens.css` (light + dark custom properties) from `docs/design/tokens.json`, checked in and pinned so they can't drift.
   - The palette's command registry (`app/src/commands/registry.ts`): each screen registers its own commands, so no later item edits a shared list.
   - Install now every dependency later items need, so none of them touches `app/package.json`: react, react-dom, electron, vite, typescript, vitest, @testing-library/react, jsdom, @playwright/test, electron-builder, and one small spring library for the avatar gestures (DESIGN.md allows it).
   - Packaging: `npm run package` builds an ad-hoc-signed `Loomwright Studio.app` locally (electron-builder, `identity: null` or ad-hoc), registering the `loomwright-studio://` scheme. Branding: "Wright, powered by Claude" is allowed, and nothing may say or look like "Claude Code" (invariant 7).
6. **App: the contract** (`app/src/api/contract.ts`): TypeScript types for every route the app calls, the existing ones and items 02–07's new ones, as documented in their stub pages, plus the feed's frame shape. Each kernel item makes its route match the contract, and a kernel-side test (`kernel/test/console-contract.test.ts`, owned here) pins the paths and methods.
7. **App: the test rig.** vitest + React Testing Library (jsdom) under `app/src/**`, and a Playwright Electron smoke (`app/e2e/smoke.spec.ts`) against `app/e2e/fixture-kernel.ts`: a fake loopback API plus feed serving canned data, so screen items render every designed state without a real kernel. Each screen adds its own `app/e2e/fixtures/<screen>.ts`.
8. **CI:** `.github/workflows/ci.yml` gains an `app` job: `npm ci`, typecheck, vitest, build, and the Playwright Electron smoke under xvfb on ubuntu.
9. **Docs:** `docs/ARCHITECTURE.md` gets the app (main/renderer split, the token never reaching the renderer), the `session_output` table, the feed and the console feature, plus a "Phase 5 features" section linking stub pages `docs/architecture/app.md` (01, 12–17), `feed.md` (02), `session-output.md` (03), `session-control.md` (04), `pause.md` (05) and `threads.md` (06). Item 07 edits `agents.md`.

## Non-goals

- Any screen, component or kernel behaviour beyond the stubs (items 02–17).
- Notarisation, auto-update, launch at login (commercial readiness or GUI v2).

## Acceptance criteria

- [ ] Given a fresh store, when migrations run, then migration 016 creates `session_output`. Given a store at 015, when it upgrades, nothing else changes.
- [ ] Given the shipped contributions, when they merge, then `console` is registered with no tools, routes or verbs, and `console-foundation.test.ts` pins that.
- [ ] Given a request to `GET /events/stream` with an upgrade and no token, then it is refused 401 before any upgrade. With the token, it is upgraded and closed 1013 by the stub.
- [ ] Given a contributed route, when it runs, then its request carries `sessions` and `killSwitch`.
- [ ] Given `npm ci && npm run typecheck && npm test && npm run build` in `app/`, then all pass. The Playwright smoke opens the window against the fixture kernel and shows the sidebar's five entries. With no fixture kernel running, it shows the "kernel unreachable" band.
- [ ] Given `npm run package` on macOS, then `Loomwright Studio.app` is built and opens from Finder with no terminal (recorded once in the PR, since CI runs ubuntu).
- [ ] Given the renderer, then no code path in it can read the API token: the preload exposes only the `api` bridge, which a test pins.
- [ ] `tokens.css` equals the generator's output from `tokens.json` (pinned), and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- `bash scripts/check-docs.sh`

## Assumptions

- The main process making every API call (the renderer asks through the bridge) keeps the token out of renderer memory. The renderer is the surface that renders untrusted text.
- One spring library is acceptable for the avatar (DESIGN.md); item 09 may only use the one installed here.

## Risks

- A large scaffold diff. Review that nothing beyond the stubs ships behaviour.

## Depends on
none

## Touches
kernel/src/store/migrations/
kernel/test/store.test.ts
kernel/src/console/
kernel/test/console-foundation.test.ts
kernel/test/console-contract.test.ts
kernel/src/features/index.ts
kernel/src/features/contribution.ts
kernel/test/feature-seams.test.ts
kernel/src/api/server.ts
kernel/src/api/feed.ts
kernel/test/api.test.ts
kernel/src/sessions/manager.ts
kernel/src/sessions/types.ts
kernel/test/sessions.test.ts
kernel/src/kernel.ts
kernel/package.json
kernel/package-lock.json
app/
.github/workflows/ci.yml
docs/ARCHITECTURE.md
docs/architecture/app.md
docs/architecture/feed.md
docs/architecture/session-output.md
docs/architecture/session-control.md
docs/architecture/pause.md
docs/architecture/threads.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-21T05:16:44Z
- **Brief:** .supervisor/jobs/done/2026-10-21-phase-5-foundation-app-scaffold-seams.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/101
