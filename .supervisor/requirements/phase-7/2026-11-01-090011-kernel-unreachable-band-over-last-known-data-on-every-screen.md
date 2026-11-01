# 11 — Kernel unreachable: the shared band over last-known data, on every phase 7 screen

## Status: ready

**Priority:** MVP (bug) · ROADMAP phase 7 · D9, UI.md honest status

**As** the owner,
**I want** every phase 7 screen to keep showing what it last read, under the one "Couldn't reach the kernel" band, while the kernel restarts,
**so that** a kernel restart never blanks my screen or shows me a raw request error.

## Problem

Live run 2026-11-01, kernel stopped with `launchctl bootout` after every screen had loaded. The mockup's `<screen>-unreachable` view is the red "Couldn't reach the kernel. It may be restarting; this window reconnects on its own." band over the last-known data, with "last known" marks and disabled write controls. What each screen did:

| Screen | Live (dark) | Mockup |
|---|---|---|
| Integrations | the band, over the GitHub row | match |
| Playbooks | rows kept, Last run and Tokens turn to "unknown · could not be read", no band | mismatch |
| Tasks | board replaced by a "Couldn't load tasks" error card | mismatch |
| Memory | error card showing `GET /memory · no answer · not_installed` | mismatch |
| Schedules & triggers, Budget & audit, Settings | content replaced by "Status unknown" | mismatch |

Every screen also shows the small "Reconnecting to the kernel… Last updated" line (`app/src/shell/KernelStates.tsx:41`). After `launchctl bootstrap` all seven reconnected on their own (match). The item 03–09 acceptance criterion "the shared band shows and the screen keeps its last data" passed on fixture data but not live, so the fixture's unreachable path differs from the real one (a request that never answers versus a fixture flag).

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

## Scope

1. **One shared behaviour.** Each phase 7 screen keeps its last successful read while the connection is `reconnecting`, `unreachable` or `not_installed`, renders the shared band (the one Integrations already shows) above it, marks values as last known as the mockup does, and disables write controls. A raw request line (method, path, connection state) is never shown to the owner.
2. **Every screen:** Tasks, Playbooks, Schedules & triggers, Memory, Budget & audit, Settings and Integrations, against each one's `<screen>-unreachable` view.
3. **Pin it the live way.** The e2e stops the fixture kernel's listener (requests then fail as they do live) after each screen has loaded, instead of a fixture flag, so the test fails the way the live run did.
4. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- Loading and error views for a first read that never succeeded (they stay as designed).
- Any change to how the app detects the kernel's state.

## Acceptance criteria

- [ ] Given each of the seven screens loaded on the fixture kernel, when the kernel's listener stops, then the screen keeps its data, shows the shared band and its "last known" marks, and disables its write controls, as its `<screen>-unreachable` view shows, in light and dark.
- [ ] Given that state on Memory, then no request text (`GET /memory`, `no answer`, `not_installed`) is visible anywhere on the screen.
- [ ] Given the listener restarts, then every screen reconnects and refreshes without a reload.
- [ ] Given a screen that never loaded before the kernel stopped, then its designed loading or error state shows (unchanged).
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Assumptions

- The Integrations screen's band is the reference behaviour; the other screens adopt it rather than a new pattern.

## Risks

- Seven screen directories in one PR. Each screen's change is small (keep data, render the band); the e2e covers all seven in one loop.

## Depends on
2026-10-30-140010-phase-7-exit-check.md

## Touches
app/src/shell/KernelStates.tsx
app/src/store/connection.ts
app/src/screens/tasks/TasksScreen.tsx
app/src/screens/playbooks/PlaybooksScreen.tsx
app/src/screens/schedules/SchedulesScreen.tsx
app/src/screens/memory/MemoryScreen.tsx
app/src/screens/budget/BudgetScreen.tsx
app/src/screens/settings/SettingsScreen.tsx
app/e2e/fixture-kernel.ts
app/e2e/kernel-unreachable.spec.ts
