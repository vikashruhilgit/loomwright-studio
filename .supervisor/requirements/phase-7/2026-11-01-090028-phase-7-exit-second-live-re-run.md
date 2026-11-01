# 28 — Phase 7 exit, second live re-run: walk every screen again after items 20–27

## Status: ready

**Priority:** MVP · ROADMAP phase 7 · D9, D33, D35

**As** the owner,
**I want** item 19's live polish gate run again on the packaged app once items 20–27 have merged,
**so that** phase 7 is marked done only on a live run with no open mismatch.

## Problem

Item 19's live re-run ran on 2026-11-01 (packaged app at `59275c8`) and failed: items 20–27 hold its findings. The runbook (`docs/evidence/phase-7-exit-runbook.md`) says phase 7 stays not done until a re-run has no open mismatch. The re-run still could not exercise Integrations' token, App-connected and switch views (GitHub was not connected), nor the loading and error views (not reachable on a real store; the fixture spec covers them).

What the 2026-11-01 re-run already saw pass is walked again, not skipped: a fix in one item can move another screen.

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

1. **Re-run the runbook as written** (no new spec): build, reinstall the service, package, open from Finder, walk every screen in light and dark, the unreachable state (open every screen first, then switch screens with the kernel down), the global keys in the foreground (⌘1–⌘9, ⌘, ⌘K, `?`), and the band's Kernel log action (item 20).
2. **Integrations:** connect GitHub first only if the owner names that click before the run; the owner completes any GitHub sign-in themself. Otherwise record those views `not_exercised` again.
3. **Close on a pass.** With no open mismatch: the evidence JSON, the approved screenshots, the ROADMAP phase 7 row and OPEN_QUESTIONS in one commit (the runbook's "Closing phase 7"). Any new mismatch becomes a new phase 7 item, and nothing is patched in this PR.

## Non-goals

- Fixing what the re-run finds (new items).
- A new e2e spec (item 10's exists).

## Acceptance criteria

- [ ] Given items 20–27 merged, then every screen's live check records match or mismatch against its mockup view, light and dark, with screenshots staged outside the repo.
- [ ] Given Tasks with the kernel down after switching screens, then the last-known board shows (item 21's fix, checked live).
- [ ] Given the screenshots, then the owner reviews each before commit, and one showing private content stays local with its sha256 recorded.
- [ ] Given a passing run, then the evidence file, the ROADMAP row and OPEN_QUESTIONS change in one commit; never before a passing run.
- [ ] `bash scripts/check-docs.sh` passes.


## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`
- `bash scripts/check-docs.sh`

## Assumptions

- The owner's store still has the rows the first run used (two Tasks rows from 2026-11-01, playbooks, memory files).

## Risks

- A screen that matches on fixture data only. The live half exists to catch that.
- Global keys need the foreground: an agent run needs the owner's approval for full-screen control.

## Depends on
2026-11-01-090020-shell-kernel-log-in-the-band.md
2026-11-01-090021-shell-one-back-crumb-and-the-in-content-icon-set.md
2026-11-01-090022-keyboard-focus-after-the-palette-and-the-keyboard-map.md
2026-11-01-090023-tasks-last-known-board-across-remounts-kind-icons-and-crumb.md
2026-11-01-090024-playbooks-detail-short-model-schedules-link-chips-and-icons.md
2026-11-01-090025-schedules-result-chip-fits-its-column.md
2026-11-01-090026-memory-avatars-file-icons-and-long-folder-names.md
2026-11-01-090027-settings-health-marked-last-known-when-unreachable.md

## Touches
docs/evidence/phase-7-exit-runbook.md
docs/ROADMAP.md
docs/OPEN_QUESTIONS.md
