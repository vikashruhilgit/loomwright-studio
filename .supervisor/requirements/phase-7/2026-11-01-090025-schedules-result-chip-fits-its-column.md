# 25 — Schedules: the firing history's result chip fits its column

## Status: ready

**Priority:** MVP (polish) · ROADMAP phase 7 · D9

**As** the owner,
**I want** every result in Schedules' firing history readable at the window's default size,
**so that** Schedules passes its polish gate.

## Problem

Live re-run 2026-11-01, `schedules-populated` in light and dark at the window's default size: the firing history's Result chip "playbook off: fires are skipped" (item 16) is cut off at the window's right edge — it reads "…fires are skippe" — with no wrap and no ellipsis, on every row. The mockup's result chips fit their column. The history on the owner's store is dominated by these rows (an off playbook's trigger polls every 2 minutes), so the cut chip is most of what the table shows.

## Owner decisions (2026-10-30, binding)

Recorded 2026-10-30 in the phase 7 product-owner session, over two rounds of AskUserQuestion. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D9, D12, D22, D24, D26, D27, D28, D29, D34, D36 and invariants 1–9 stay as they are. Phase 5 and phase 6 decisions (in their items) still hold.

- **Hooks is deferred to phase 9.** The Hooks screen is built with the hook-management mechanism it shows (propose, apply with backup, verified to fire, rollback; ROADMAP phase 9). `hooks_installed` does not exist yet (`kernel/src/store/migrations/001_initial.ts:9`), so phase 7 builds no Hooks screen. UI.md and DESIGN.md get a note recording this, as phase 6 did for Integrations.
- **Tasks shows today's kernel data.** The board groups tasks, playbook runs and sessions by state and clicks through to their history and session logs. Linked PRs and tickets, approvals counts and CI state join in phase 8 (acceptance test 2), which the UI.md card example describes.
- **Integrations is polish only.** No new connector: Slack, Calendar and Mail stay in phase 9. Known gap from the 2026-10-30 live run: a token connection has no path to the GitHub App without Disconnect (`TokenDetail` offers only Replace and Disconnect).
- **One GUI v2 mockup first (D9).** One clickable file, `docs/design/mockups/gui-v2.html`, holds every phase 7 screen and every state (empty, loading, error, waiting on you, kernel unreachable), light and dark, with its token block the verbatim output of `node app/scripts/tokens.mjs`. The owner approves it by merging its PR. Every screen item depends on it, and its polish gate matches it. This mirrors phase 0.
- **Each screen's kernel routes ride with that screen's item.** Tasks, Memory, Budget & audit, playbook run history and trigger firing history have no read route today (the API serves `/playbooks`, `/triggers`, `/events`, `/status` and the phase 5–6 routes). Each screen item adds the routes it reads, in its own feature part, against the contract item 01 declares. Memory's write route is guarded (below).
- **Settings shows the auth provider read-only.** Settings shows the active provider, its health and its token's state, plus the terminal commands that change it (`claude setup-token`, `studio auth …`), as phase 5 does. No secret entry in Settings, and never a claude.ai sign-in (invariant 6).

## Owner decisions (2026-11-01, binding)

Recorded 2026-11-01 in the phase 7 findings product-owner session (AskUserQuestion, one round). The owner chose the proposed option every time. Each finding item carries this copy.

- **Source.** These items come from the phase 7 exit live run on 2026-11-01 (item 10's runbook, packaged app opened from Finder at `d754f83`, the owner's real store, light and dark, the kernel stopped for the unreachable state, run by the agent with the owner's word per D33/D35). It failed the polish gate. The screenshots stay outside the repo (the owner's 2026-10-31 screenshot decision); none is committed by these items.
- **Task states stay free text (D3).** `kernel_task_create`'s description names the four words the board sorts (`waiting`, `working`, `parked`, `done`) for Wright to use. The board shows any other state in its own visible "Other" group with the raw word, never silently in Working. No closed list in the kernel, no guessed synonyms.
- **"On" vs "on" is explained in Schedules.** A trigger whose playbook is off says so on its row and in the upcoming list (its fires are skipped, `playbook_not_enabled`). No separate item.
- **The login-item note is out of scope.** "macOS can't find this app's login item" is the designed honest note for a build run from `app/release/`; the re-run checks Settings from an installed copy.
- **Nothing is patched outside an item's Touches.** A lane that needs another file stops and says so.

## Owner decisions (2026-11-01 re-run, binding)

Recorded 2026-11-01 in the phase 7 re-run findings product-owner session (AskUserQuestion, one round). The owner chose the proposed option every time. Each item from this round carries this copy.

- **Source.** These items come from the phase 7 exit live re-run on 2026-11-01 (item 19's runbook, packaged app opened from Finder at `59275c8`, the owner's real store, light and dark, the kernel booted out for the unreachable state, the global keys checked in the foreground, run by the agent with the owner's word and the owner watching per D33/D35). It failed the polish gate. The screenshots stay outside the repo (the owner's 2026-10-31 screenshot decision); none is committed by these items.
- **Tasks history keeps the session viewer.** The session log in a task's history keeps the phase 6 viewer's header (Read latest, Stop, Kill); it is accepted as built, not a mismatch, and no item changes it.
- **Settings Health is marked last known.** While the kernel is unreachable, Settings shows Health's last value with a "last known" mark and no green dot. `gui-v2.html`'s `settings-unreachable` view changes first (D9).
- **Kernel log reveals the service's own log.** The band's "Kernel log" action reveals the kernel service's log file (`<dataDir>/logs/kernel.err.log`, where `studio service install` points launchd's stderr) in Finder, through a main-process channel that takes no path from the renderer, as Reveal data dir does. It works with the kernel down, which is when the band shows.
- **One Back control.** Every click-through view uses one shared crumb from the shell, drawn as the mockup draws it: "‹ Parent / Current" (for example "‹ Tasks / Task #9"), without the word "Back". Each screen adopts it in its own item.
- **Nothing is patched outside an item's Touches.** A lane that needs another file stops and says so.

## Scope

1. **The chip fits.** At the window's default size and wider, every Result chip in the firing history shows its whole text inside the table, in both themes: the column or chip wraps or the table lays out so nothing is clipped by the window edge. The raw reason line (`playbook_not_enabled`) stays under it.
2. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- Thinning or grouping repeated skipped fires in the history (a behaviour change, not polish).

## Acceptance criteria

- [ ] Given the firing history holds a "playbook off: fires are skipped" row, when the window is at its default size, then the chip's whole text is visible inside the table, light and dark (`app/e2e/schedules.spec.ts` asserts the chip is not clipped).
- [ ] Given the window at its minimum size, then no Result chip is clipped by the window edge.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Assumptions

- The window's default size is the one `app/electron/main.ts` opens.

## Risks

- Wrapping a long chip changes row height; the table must stay aligned.

## Depends on
none

## Touches
app/src/screens/schedules
app/e2e/schedules.spec.ts
