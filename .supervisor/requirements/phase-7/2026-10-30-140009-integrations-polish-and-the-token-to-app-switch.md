# 09 — Integrations polish: the token-to-App switch without Disconnect, and the polish gate

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, D36, invariant 5

**As** the owner connected with a token,
**I want** to set up the GitHub App from the connected screen without disconnecting first,
**so that** switching methods never leaves GitHub disconnected mid-way.

## Problem

On 2026-10-30 the owner had to press Disconnect (event 2811) before setting up the App, because the token-connected detail (`TokenDetail` in `app/src/screens/integrations/IntegrationsView.tsx`) offers only Replace and Disconnect. The kernel already supports it: a successful `recordInstallation` deletes the token's item and switches the row to `method: app`, and a failed setup leaves the token in use (`docs/architecture/integrations.md`, "The port").

## Owner decisions (2026-10-30, binding)

Recorded 2026-10-30 in the phase 7 product-owner session, over two rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D9, D12, D22, D24, D26, D27, D28, D29, D34, D36 and invariants 1–9 stay as they are. Phase 5 and phase 6 decisions (in their items) still hold.

- **Hooks is deferred to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback; ROADMAP phase 9). `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts:9`), so phase 7 builds no Hooks screen. UI.md and DESIGN.md get a note recording this, as phase 6 did for Integrations.
- **Tasks shows today's kernel data.** The board groups tasks, playbook runs and sessions by state and clicks through to their history and session logs. Linked PRs and tickets, approvals counts and CI state join in phase 8 (acceptance test 2), which the UI.md card example describes.
- **Integrations is polish only.** No new connector: Slack, Calendar and Mail stay in phase 9. Known gap from the 2026-10-30 live run: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9).** One clickable file, `docs/design/mockups/gui-v2.html`, holds every phase 7 screen and every state (empty, loading, error, waiting on you, kernel unreachable), light and dark, with its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging its PR. Every screen item depends on it, and its polish gate matches it. This mirrors phase 0.
- **Each screen's kernel routes ride with that screen's item.** Tasks, Memory, Budget & audit, playbook run history and trigger firing history have no read route today (the API serves `/playbooks`, `/triggers`, `/events`, `/status` and the phase 5–6 routes). Each screen item adds the routes it reads, in its own feature part, against the contract item 01 declares. Memory's write route is guarded (below).
- **Settings shows the auth provider read-only.** Settings shows the active provider, its health and its token's state, plus the terminal commands that change it (`claude setup-token`, `studio auth …`), as phase 5 does. No secret entry in Settings, and never a claude.ai sign-in (invariant 6).

## Scope

1. **The switch.** The token-connected detail gains "Switch to GitHub App", opening the existing App setup sheet over the token connection, as item 02's mockup shows. The token stays in use until the install succeeds; a cancel or failure leaves it connected.
2. **Polish fixes** the 2026-10-30 run found or the mockup names for this screen, each listed in the PR.
3. **Polish gate.** The PR commits screenshots from the running app, in light and dark, of every state the mockup shows for this screen, and names the mockup state each matches. The owner's approval of the PR is the gate (D9; phase 5's polish-gate decision).

## Non-goals

- Any new connector (phase 9).
- Changing the App's name or the setup pages (owner, 2026-10-30: not needed).

## Acceptance criteria

- [ ] Given a token connection, then "Switch to GitHub App" opens the App setup sheet, and GitHub stays connected through the token while it runs.
- [ ] Given the setup cancelled or failed, then the token connection is unchanged.
- [ ] Given the install succeeds, then the screen shows the App connection and the token item is gone (the port's existing behaviour, pinned by the e2e against the fixture).
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

- The kernel needs no change: the port's documented behaviour already covers a setup over a token connection.

## Risks

- If the e2e shows the kernel refuses a setup while a token is connected, that is a kernel finding: stop and record it rather than working around it.

## Depends on
2026-10-30-140002-the-gui-v2-mockup.md

## Touches
app/src/screens/integrations
app/e2e/integrations.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-31T07:17:33Z
- **Brief:** .supervisor/jobs/done/2026-10-31-integrations-token-to-app-switch.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/188
