# 08 — The Settings screen: auth provider (read-only), data location, launch at login, notifications, theme

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, D27, D29, invariants 6, 7

**As** the owner,
**I want** one Settings screen with the auth provider and its health, the data location, launch at login, notifications and theme,
**so that** I can check and change how Studio runs without the terminal, except for credentials.

## Problem

`GET /status` already reports each auth provider's health; nothing in the app shows the data location or lets the owner set launch at login, notifications or the theme.

## Owner decisions (2026-10-30, binding)

Recorded 2026-10-30 in the phase 7 product-owner session, over two rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D9, D12, D22, D24, D26, D27, D28, D29, D34, D36 and invariants 1–9 stay as they are. Phase 5 and phase 6 decisions (in their items) still hold.

- **Hooks is deferred to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback; ROADMAP phase 9). `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts:9`), so phase 7 builds no Hooks screen. UI.md and DESIGN.md get a note recording this, as phase 6 did for Integrations.
- **Tasks shows today's kernel data.** The board groups tasks, playbook runs and sessions by state and clicks through to their history and session logs. Linked PRs and tickets, approvals counts and CI state join in phase 8 (acceptance test 2), which the UI.md card example describes.
- **Integrations is polish only.** No new connector: Slack, Calendar and Mail stay in phase 9. Known gap from the 2026-10-30 live run: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9).** One clickable file, `docs/design/mockups/gui-v2.html`, holds every phase 7 screen and every state (empty, loading, error, waiting on you, kernel unreachable), light and dark, with its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging its PR. Every screen item depends on it, and its polish gate matches it. This mirrors phase 0.
- **Each screen's kernel routes ride with that screen's item.** Tasks, Memory, Budget & audit, playbook run history and trigger firing history have no read route today (the API serves `/playbooks`, `/triggers`, `/events`, `/status` and the phase 5–6 routes). Each screen item adds the routes it reads, in its own feature part, against the contract item 01 declares. Memory's write route is guarded (below).
- **Settings shows the auth provider read-only.** Settings shows the active provider, its health and its token's state, plus the terminal commands that change it (`claude setup-token`, `studio auth …`), as phase 5 does. No secret entry in Settings, and never a claude.ai sign-in (invariant 6).

## Scope

1. **Route (the `settings` part).** `GET /settings`: the active auth provider, its health and token state (never a secret), the data directory, the notifier in use (terminal-notifier, osascript, or none), and the Loomwright install the adapter resolved.
2. **The screen** (`app/src/screens/settings/`), built to item 02's mockup: the auth provider read-only with the terminal commands that change it (owner decision); data location with Reveal in Finder; launch at login (Electron `app.setLoginItemSettings`, in the main process); notifications on/off as the app's own preference; theme (system, light, dark). App preferences live in the app's own settings, never in the kernel's store.
3. No sign-in control, no secret field (owner decision; invariant 6). Nothing says or looks like "Claude Code" (invariant 7).
4. **Polish gate.** The PR commits screenshots from the running app, in light and dark, of every state the mockup shows for this screen, and names the mockup state each matches. The owner's approval of the PR is the gate (D9; phase 5's polish-gate decision).

## Non-goals

- Changing the auth provider or entering any credential in the app.
- Moving the data directory.

## Acceptance criteria

- [ ] Given the fixture kernel, then the provider, its health and token state show, with the commands that change it, and no secret appears anywhere on screen or in the renderer's store.
- [ ] Given launch at login toggled, then the main process sets the login item, and the toggle reflects the OS state on reopen.
- [ ] Given a theme change, then the app re-themes at once and keeps it on relaunch.
- [ ] Given the screen, then it has no sign-in control and no secret field (a test asserts it).
- [ ] Given the kernel unreachable, then the shared band shows and the screen keeps its last data without a throw.
- [ ] Given the keyboard only, then every action on the screen is reachable, and the palette lists the screen's commands.
- [ ] Given a live event on the feed that changes what the screen shows, then it updates without a reload and without layout shift.
- [ ] Given VoiceOver, then every control and status has a label, and both themes meet WCAG 2.1 AA contrast.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup state.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- The Playwright e2e for the screen (launched only through `app/e2e/electron-harness.ts`).
- `cd kernel && npm ci && npm run typecheck && npm test` (the screen's routes).
- `bash scripts/check-docs.sh`

## Assumptions

- Electron's login-item API works for the ad-hoc-signed, unnotarised build; verify in the running app and record the result.

## Risks

- An unsigned app's login item may be refused or need a prompt on macOS 26. If so, the toggle states it honestly and the finding goes to OPEN_QUESTIONS.

## Depends on
2026-10-30-140001-phase-7-foundation-contract-route-seams-and-screen-stubs.md
2026-10-30-140002-the-gui-v2-mockup.md

## Touches
kernel/src/gui/settings.ts
kernel/test/gui-settings.test.ts
app/src/screens/settings
app/electron/settings.ts
app/e2e/settings.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-31T03:50:04Z
- **Brief:** .supervisor/jobs/done/2026-10-30-the-settings-screen.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/186
