# 16 — Schedules & triggers: the firing history, Upcoming · Today, and triggers whose playbook is off

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9

**As** the owner,
**I want** Schedules to show the firing history of all triggers and to tell me when a trigger is on but its playbook is off,
**so that** I can see what fired, what didn't and why, without opening each trigger.

## Problem

Live run 2026-11-01, `schedules-populated`, light and dark:

- The right pane shows the selected trigger's detail and its own history; the mockup's shows one **Firing history** table for all triggers with an All / Not fired filter.
- The Upcoming list has no "· Today" label, and its titles are cut ("Review open PRs on studio-sand…").
- **On vs on (owner decision 2026-11-01).** Playbooks says "6 playbooks · 0 on" while Schedules says "3 triggers on", and the audit log shows those triggers firing and being skipped (`trigger_missed` · `playbook_not_enabled`). Neither screen says why.

**Kernel unreachable and the title bar (2026-11-01).** With the kernel stopped, Schedules & triggers replaced everything with "Status unknown"; its count line sits under the title instead of beside it. The shell parts (the shared band, the titlebar subtitle slot, the `~` formatter) are item 11's; each screen item adopts them in its own folder, so the screen items run in parallel.

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

1. **Adopt the shell (item 11).** Schedules & triggers keeps its last data under the shared band when the kernel is unreachable, matching `schedules-unreachable`, with no raw request text; and it hands its count line to the titlebar subtitle slot instead of drawing its own band.
2. **Firing history** for all triggers with the All / Not fired filter, as the mockup shows; a trigger's own detail stays reachable from its row.
3. **Upcoming · Today** label and titles that fit (wrap to two lines, never cut mid-word without a tooltip).
4. **Playbook off.** A trigger whose playbook is off says so on its row and in the upcoming list ("playbook off: fires are skipped"); its skipped fires read that reason in the history.
5. **Polish gate.** The PR commits screenshots from the running app (fixture kernel, through `app/e2e/electron-harness.ts`), light and dark, of every mockup state the item changes, each named against its `gui-v2.html` view. The owner's approval of the PR is the gate (D9).

## Non-goals

- Turning triggers or playbooks on or off from this screen.

## Acceptance criteria

- [ ] Given Schedules & triggers loaded, when the fixture kernel's listener stops, then it keeps its data under the shared band with write controls disabled, matching `schedules-unreachable`, and refreshes when the listener restarts.
- [ ] Given Schedules & triggers, then its count line sits beside the title in the title bar, matching `schedules-populated`.
- [ ] Given fires from several triggers, then the history table lists them all, newest first, and Not fired filters to the misses, matching `schedules-populated`.
- [ ] Given upcoming fires today, then the list is headed "Upcoming · Today" and no title is cut without a tooltip.
- [ ] Given a trigger that is on whose playbook is off, then its row and its upcoming entry say the playbook is off and fires are skipped, and its skipped fires show that reason.
- [ ] The polish-gate screenshots are in the PR body, each named against its mockup view.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`
- `cd kernel && npm ci && npm run typecheck && npm test`

## Assumptions

- A trigger's playbook and its enabled flag are readable with the schedule (`kernel/src/gui/schedules.ts`).

## Risks

- The mockup has no "playbook off" row; the item adds it to the `schedules-populated` screenshot set and names the difference in the PR for the owner.

## Depends on
2026-11-01-090011-shell-shared-unreachable-band-sidebar-titlebar-slot-and-home-paths.md

## Touches
app/src/screens/schedules
kernel/src/gui/schedules.ts
kernel/test/gui-schedules.test.ts
app/e2e/schedules.spec.ts

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-01T13:53:14Z
- **Brief:** .supervisor/jobs/done/2026-11-01-schedules-firing-history-and-playbook-off-triggers.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/200
