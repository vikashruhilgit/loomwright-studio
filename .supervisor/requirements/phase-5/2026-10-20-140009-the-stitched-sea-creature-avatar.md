# 09 — The stitched sea-creature avatar, with its thread carrying the kernel state

## Status: ready

**Priority:** MVP · phase 5 (shared by the screens) · D9, D23 (avatar), WCAG 2.1 AA

**As** the owner,
**I want** the approved Avatar built once, exactly as the design system specifies,
**so that** every screen uses the same components and passes its polish gate.

## Problem

The design system (`docs/design/design-system/components/<Name>/README.md` + `preview.html`, tokens in `docs/design/tokens.json`, rules in `docs/design/brand-book.md`) specifies these components. None is built. Item 01 provides the scaffold, generated `tokens.css`, the test rig and every dependency.

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

1. **Build** Avatar, each in `app/src/components/<Name>/` (component, styles using only `tokens.css` variables, and a test), matching its README's rules and its `preview.html`'s states, in light and dark mode. No barrel file: screens import each component by path.
2. **Port the approved avatar** (`docs/design/avatar/avatar.css`, `avatar.js`, the Avatar README, D23):
   - the creatures (shark, seahorse, octopus, turtle, jellyfish, fish, crab, and Wright's crowned whale), each in its `crew-*` hue (Wright alone wears `accent`);
   - the loose thread end showing each kernel state (sways, sews, rises to you, hangs slack, ties a bow, is cut);
   - each state legible with motion off.
   The gestures follow the README using only the spring library item 01 installed.
3. **Accessibility:** WCAG 2.1 AA. Contrast holds in both themes (the token notes say which pairs), every control has a screen-reader label, focus is visible, everything is keyboard-reachable, and the reduced-motion rule holds (brand book §Motion).
4. **Evidence:** a `app/e2e/components.<group>.spec.ts` Playwright page that renders every state, and screenshots of each in light and dark mode, committed under `docs/evidence/phase-5-polish/components/`.

Item 01 alone owns the shared files (see its Touches). If this item needs a file outside its Touches that another item in the same wave owns, or a new npm dependency, stop and say so; don't edit it.

## Non-goals

- Screens (items 13–17).
- Changing the design: a mismatch with the README or `preview.html` is a finding for the owner, not a redesign.

## Acceptance criteria

- [ ] Given each component's README states, when its test renders them, then each state matches the README's rules: variants, sizes, disabled, focus, empty and error where specified.
- [ ] Given each kernel state, when motion is reduced, then the thread's static shape still shows the state.
- [ ] Given `wright`, then only the whale with its crown, in `accent`.
- [ ] Given dark mode, then every component uses the dark tokens, with no hard-coded colour (a test greps for hex literals outside `tokens.css`).
- [ ] Given keyboard only, then every interactive component is reachable and operable, with visible focus.
- [ ] `cd app && npm run typecheck && npm test` passes, and the screenshots are committed.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`

## Assumptions

- None beyond the owner decisions above.

## Risks

- A lane that finds the contract (item 01) does not fit stops and says so rather than changing the contract.

## Depends on
2026-10-20-140001-phase-5-foundation-app-scaffold-api-seams-and-contract.md

## Touches
app/src/components/Avatar/
app/e2e/components.avatar.spec.ts
docs/evidence/phase-5-polish/components/avatar/
