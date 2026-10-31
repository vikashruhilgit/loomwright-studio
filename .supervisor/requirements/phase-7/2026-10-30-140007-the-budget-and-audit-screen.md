# 07 — The Budget & audit screen: usage against limits, cap state, and the full event log

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, D24, D26, D28

**As** the owner,
**I want** usage per day, agent and playbook against each limit, the cap state, and the full event log with filters,
**so that** I can see where tokens went and audit everything the kernel did.

## Problem

The `budget` table records tokens per session, agent, playbook and model per day (and a `cost_usd` estimate); `cap_state` holds the subscription windows, read by `GET /status`. No route aggregates usage, and `GET /events` takes only `after` and `limit`.

## Owner decisions (2026-10-30, binding)

Recorded 2026-10-30 in the phase 7 product-owner session, over two rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D9, D12, D22, D24, D26, D27, D28, D29, D34, D36 and invariants 1–9 stay as they are. Phase 5 and phase 6 decisions (in their items) still hold.

- **Hooks is deferred to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback; ROADMAP phase 9). `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts:9`), so phase 7 builds no Hooks screen. UI.md and DESIGN.md get a note recording this, as phase 6 did for Integrations.
- **Tasks shows today's kernel data.** The board groups tasks, playbook runs and sessions by state and clicks through to their history and session logs. Linked PRs and tickets, approvals counts and CI state join in phase 8 (acceptance test 2), which the UI.md card example describes.
- **Integrations is polish only.** No new connector: Slack, Calendar and Mail stay in phase 9. Known gap from the 2026-10-30 live run: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9).** One clickable file, `docs/design/mockups/gui-v2.html`, holds every phase 7 screen and every state (empty, loading, error, waiting on you, kernel unreachable), light and dark, with its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging its PR. Every screen item depends on it, and its polish gate matches it. This mirrors phase 0.
- **Each screen's kernel routes ride with that screen's item.** Tasks, Memory, Budget & audit, playbook run history and trigger firing history have no read route today (the API serves `/playbooks`, `/triggers`, `/events`, `/status` and the phase 5–6 routes). Each screen item adds the routes it reads, in its own feature part, against the contract item 01 declares. Memory's write route is guarded (below).
- **Settings shows the auth provider read-only.** Settings shows the active provider, its health and its token's state, plus the terminal commands that change it (`claude setup-token`, `studio auth …`), as phase 5 does. No secret entry in Settings, and never a claude.ai sign-in (invariant 6).

## Scope

1. **Routes (the `budget-audit` part).** `GET /budget/usage?days=` (per day, agent and playbook: tokens counted per D26, cache reads shown but not counted, sessions at once against each limit; dollars only as an estimate labelled "≈ at API rates", D24) and `GET /audit` (events filtered by kind, agent, playbook and time range, paged, newest first).
2. **The screen** (`app/src/screens/budget/`), built to item 02's mockup: usage charts and tables against limits, the cap state with its reset time, and the event log with filters.
3. **Polish gate.** The PR commits screenshots from the running app, in light and dark, of every state the mockup shows for this screen, and names the mockup state each matches. The owner's approval of the PR is the gate (D9; phase 5's polish-gate decision).

## Non-goals

- Setting limits here (Team sets an agent's limits; the playbook screen a playbook's).
- Exporting the log.

## Acceptance criteria

- [ ] Given fixture usage across days, agents and playbooks, then totals match the `budget` rows under D26's counting, pinned by a route test.
- [ ] Given an agent at its daily token limit, then the screen shows it at the limit, in tokens; any dollar figure is labelled "≈ at API rates".
- [ ] Given a cap in `cap_state`, then its status and reset time show as the mockup shows.
- [ ] Given audit filters, then the list shows only matching events, paged.
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

- D26's counting is the meter's own; the route reuses it rather than re-deriving it.

## Risks

- A chart that implies a dollar budget. Charts are in tokens; the mockup review checks this.

## Depends on
2026-10-30-140001-phase-7-foundation-contract-route-seams-and-screen-stubs.md
2026-10-30-140002-the-gui-v2-mockup.md

## Touches
kernel/src/gui/budget-audit.ts
kernel/test/gui-budget-audit.test.ts
app/src/screens/budget
app/e2e/budget.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-31T04:15:31Z
- **Brief:** .supervisor/jobs/done/2026-10-30-the-budget-and-audit-screen.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/184
