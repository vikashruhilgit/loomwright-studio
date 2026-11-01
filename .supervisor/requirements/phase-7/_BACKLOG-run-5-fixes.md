# Phase 7, run 5: live re-run fixes 20–27 (two waves), then the second live re-run 28 (run list, an index, not an implementable item)

## Status: ready (index document — nothing to implement)

Plan, order and owner decisions: _BACKLOG-2026-10-30-140011-phase-7-gui-v2.md (section "Findings from the 2026-11-01 live re-run"). Each item carries the 2026-10-30, 2026-11-01 and 2026-11-01 re-run owner-decision blocks.

## Why now
Item 19's live re-run ran on 2026-11-01 (packaged app from Finder at `59275c8`, the owner's store, light and dark, kernel booted out for the unreachable state, global keys in the foreground) and failed the polish gate. Most of the first run's findings are fixed; what is left is one bug (Tasks loses its board on a remount with the kernel down) and polish. The runbook says every mismatch becomes a new phase 7 item and phase 7 stays not done until a re-run has none open. Item 19 was checked off `# skipped:` in run `automate-2026-11-01-042119` (owner-attended; walked interactively).

## Checklist
- [ ] .supervisor/requirements/phase-7/2026-11-01-090020-shell-kernel-log-in-the-band.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090021-shell-one-back-crumb-and-the-in-content-icon-set.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090022-keyboard-focus-after-the-palette-and-the-keyboard-map.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090025-schedules-result-chip-fits-its-column.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090027-settings-health-marked-last-known-when-unreachable.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090023-tasks-last-known-board-across-remounts-kind-icons-and-crumb.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090024-playbooks-detail-short-model-schedules-link-chips-and-icons.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090026-memory-avatars-file-icons-and-long-folder-names.md
- [ ] .supervisor/requirements/phase-7/2026-11-01-090028-phase-7-exit-second-live-re-run.md

## Order
| Item | Delivers | Finding | Depends on |
|---|---|---|---|
| 20 | Shell: the band's Kernel log action, revealing `<dataDir>/logs/kernel.err.log` through an argument-free main-process channel | 2 | none |
| 21 | Shell: one "‹ Parent / Current" crumb (Budget's audit log adopts it) and the shared in-content icon set | 4 + 8 (shell parts) | none |
| 22 | Keyboard: focus lands in the opened screen after the palette; the Keyboard map opens at its top and marks its opener in the sidebar | 9 + 10 + 11 | none |
| 23 | Tasks: last-known board across a remount (bug), kind icons on cards, the shared crumb | 1 + 4 + 8 | 21 |
| 24 | Playbooks: short model name in the detail, Schedules & triggers link, right-aligned provenance chips, button icons, the shared crumb | 5 + 6 + 7 + 4 + 8 | 21 |
| 25 | Schedules: the firing history's result chip fits its column | 3 | none |
| 26 | Memory: agent avatars, file icons, long folder names | 4 + 12 | 21 |
| 27 | Settings: Health marked last known while unreachable (mockup first) | owner design decision | none |
| 28 | Phase 7 exit, second live re-run | — | 20–27 |

Findings are numbered as in the re-run notes. Finding 13 (Tasks history's session log header) is accepted as built (owner decision 2026-11-01 re-run); no item.

## Run
Checked with `automate-helpers.sh plan-waves <these 9 items> --max 7` on 2026-11-01 (Loomwright 17.23.1). `--lint` passes for all 9; `right-size` reads 20–27 as ok and 28 as small (kept on its own: it is the owner's live run and phase 7's close, like items 10 and 19).

**Shaped for parallel waves (2026-11-01).** The first draft had one shell item (Kernel log, crumb, icons, keyboard focus); `right-size` read it as large (31 files). It is split by file into 20 (band + electron channel), 21 (crumb + icons + Budget's adoption) and 22 (keyboard host, sidebar, palette, Keyboard map), which share no file. Each screen item stays inside its own folder and e2e spec. No two items in a wave share a file.

```
wave 1: 20 21 22 25 27
wave 2: 23 24 26
wave 3: 28
```

1. `/automate --backlog .supervisor/requirements/phase-7/_BACKLOG-run-5-fixes.md --parallel 5 --cheap --limit 8`: items 20–27 in two waves (five at once, then three).
2. Then item 28 with the live run (D33/D35), sequential: `/automate --backlog .supervisor/requirements/phase-7/_BACKLOG-run-5-fixes.md --cheap` once 20–27 are merged (done items are skipped). Or walk it interactively, as item 19 was.

Rules for every run: safe mode (no `--auto-merge`); branch mode is on (`loomwright-meta`), so push these items with `meta-sync.sh push --paths-from` before a lane reads them; a lane that needs a file outside its Touches stops and says so.

## Considered and not queued
- Tasks history's session log header (Read latest, Stop, Kill): accepted as built (owner decision 2026-11-01 re-run).
- A log viewer inside the app for Kernel log: the action reveals the file in Finder only (owner decision 2026-11-01 re-run).
- Thinning repeated skipped fires in Schedules' firing history: a behaviour change, not polish.
- Integrations' token, App-connected and switch views: not a finding (the store had GitHub not connected); 28 exercises them if the owner names the connect click.

## Revisit when
- The second re-run (28) finds a new mismatch: it becomes a new phase 7 item here.

## Owner decisions
none recorded
