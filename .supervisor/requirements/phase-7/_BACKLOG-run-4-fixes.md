# Phase 7, run 4: live-run fixes 11–18, then the live re-run 19 (run list, an index, not an implementable item)

## Status: ready (index document — nothing to implement)

Plan, order and owner decisions: _BACKLOG-2026-10-30-140011-phase-7-gui-v2.md (section "Findings from the 2026-11-01 live run"). Each item carries the 2026-10-30 and 2026-11-01 owner-decision blocks.

## Why now
Item 10's live half ran on 2026-11-01 (packaged app from Finder at `d754f83`, the owner's store, light and dark, kernel stopped for the unreachable state) and failed the polish gate. The runbook says every mismatch becomes a new phase 7 item and phase 7 stays not done until a re-run has none open.

## Checklist
- [ ] .supervisor/requirements/phase-7/2026-11-01-090011-kernel-unreachable-band-over-last-known-data-on-every-screen.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090012-shell-polish-sidebar-titlebar-subtitle-and-crew-rows.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090013-keyboard-map-palette-and-screen-shortcuts.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090014-tasks-board-words-other-group-and-honest-history.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090015-playbooks-table-tokens-today-and-short-model-names.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090016-schedules-firing-history-and-playbook-off-triggers.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090017-budget-and-audit-readable-log-and-honest-cap.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090018-settings-and-memory-home-paths-and-auth-polish.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090019-phase-7-exit-live-re-run.md

## Order
| Item | Delivers | Finding | Depends on |
|---|---|---|---|
| 11 | Shared unreachable band over last-known data on all seven screens; e2e stops the listener | B (bug) | 10 |
| 12 | Sidebar icons, groups, "Schedules & triggers", status row, crew rows; titlebar subtitle slot; Tasks cap line | C | 11 |
| 13 | ⌘1–⌘9, ⌘, and ⌘K palette mounted; Keyboard map view; `KNOWN_GAPS` emptied; foreground J/K check | I (known gaps) | 12 |
| 14 | Board words in the task tools, an Other group, creator on cards, readable history | A (bug) | 12 |
| 15 | Playbooks: tokens today against the limit, short model names, owner by name | E | 12 |
| 16 | Schedules: global firing history, Upcoming · Today, "playbook off" on triggers | F + on-vs-on | 12 |
| 17 | Budget & audit: sentences and actors in the log, count and paging, stale cap marked | G | 12 |
| 18 | `~` home paths in Memory and Settings, account name, command blocks, theme text | D + H | 12 |
| 19 | Item 10's live half again; close phase 7 on a pass | — | 11–18 |

## Run
Checked with `automate-helpers.sh plan-waves <these 9 items> --max 3 --explain` on 2026-11-01 (Loomwright 17.23.1). `--lint` passes for all 9; `right-size` reads 11–18 as ok and 19 as small (kept on its own: it is the owner's live run and phase 7's close, like item 10).

```
wave 1: 11
wave 2: 12
wave 3: 13 14 15
wave 4: 16 17 18
wave 5: 19
```

Waves 1 and 2 are one item each because 11 and 12 touch every screen's main file and the shell; every later screen item depends on 12. Wave 3 is full at N=3, which pushes 16–18 to wave 4.

1. `/automate --backlog .supervisor/requirements/phase-7/_BACKLOG-run-4-fixes.md --parallel 3 --cheap --limit 8`: items 11–18, four waves. Each screen PR carries polish-gate screenshots the owner reviews.
2. Then item 19 with the live run (D33/D35), sequential: `/automate --backlog .supervisor/requirements/phase-7/_BACKLOG-run-4-fixes.md --cheap` once 11–18 are merged (done items are skipped).

Rules for every run: safe mode (no `--auto-merge`); branch mode is on (`loomwright-meta`), so push these items with `meta-sync.sh push --paths-from` before a lane reads them; a lane that needs a file outside its Touches stops and says so.

## Considered and not queued
- A closed task-state list in the kernel, and app-side synonym guessing (owner decision 2026-11-01: board words + Other).
- The Settings login-item note (owner decision 2026-11-01: out of scope; checked from an installed copy in 19).
- Integrations' token, App-connected and switch views: not a finding (the store had GitHub not connected); 19 exercises them if the owner names the connect click.

## Revisit when
- The re-run (19) finds a new mismatch: it becomes a new phase 7 item here.

## Owner decisions
none recorded
