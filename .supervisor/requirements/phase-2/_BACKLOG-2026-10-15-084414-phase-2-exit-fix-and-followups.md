# Phase 2 exit fix and follow-ups — plan doc (index document, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now
The owner's live phase 2 exit run on 2026-10-15 (commit 05e5362) failed steps 1, 3 and 5: Wright could not load its kernel tools, because the SDK offers MCP tools through its `ToolSearch` meta-tool and the kernel's gate denied it (`tool_decision ToolSearch deny tool_not_allowed`, 3 of 3 Wright sessions). Step 4 passed. Phase 2 stays not done until item 09 merges and a rerun passes all five steps. Items 10–12 turn the six kept review-summary drafts from phase 2's runs into work; 10 is a real correctness bug (a lost reply), 11 and 12 are hardening and doc accuracy.

## Owner decisions
none recorded

## Order
| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| 09 | Wright can load and call its kernel tools; the live harness is ready for the rerun | none | 10, 11, 12 |
| 10 | A redelivered ask never drops a live session's reply; brain nits | none | 09, 11, 12 |
| 11 | Notifications refuse what they cannot deliver; safe printing | none | 09, 10, 12 |
| 12 | Loomwright version notes flag only new breaking changes; docs match code | none | 09, 10, 11 |

## Run
/automate --backlog .supervisor/requirements/phase-2/_BACKLOG-2026-10-15-084414-phase-2-exit-fix-and-followups.md --parallel 4
Safe mode (one wave PR the owner merges). The four items' Touches are disjoint, so `plan-waves --max 4` puts all four in one wave. After the wave merges, the owner reruns the phase 2 live exit (`docs/evidence/phase-2-exit-runbook.md`); the rerun is not a queue item.

## Considered and not queued
- `#makeLoomwrightStateDir` (`kernel/src/sessions/manager.ts`) uses `mkdirSync({recursive: true, mode: 0o700})`, which does not tighten an already-existing directory — the directory is created by the kernel itself under its own data dir, so a looser mode needs another writer first. Queuing it would put a second item on `sessions/manager.ts` beside 09 and force a second wave.
- No test for the launch-time `hostSwitchNameProblem` re-check in `hostSwitchCollision` — defence in depth behind a validated contract; same file as 09.
- `mergeContributions` lets one contribution collide with itself, so `ContributionConflictError.owners` names the same owner twice — only the error message of a broken contribution is affected.
- The notification delivery step key uses the row id, and a rowid without AUTOINCREMENT can be reused — only if rows are ever deleted, and nothing deletes them.

## Revisit when
- A second writer can create the Loomwright state directory, or the session manager's launch path is next changed (then fold in the two `manager.ts` items above).
- Contributions come from outside the shipped set (then the self-collision message matters).
- Anything starts deleting `notifications` rows.

## Checklist
- [ ] .supervisor/requirements/phase-2/2026-10-15-084410-wright-can-load-its-kernel-tools.md
- [ ] .supervisor/requirements/phase-2/2026-10-15-084411-a-redelivered-ask-never-drops-a-live-reply.md
- [ ] .supervisor/requirements/phase-2/2026-10-15-084412-notifications-refuse-what-they-cannot-deliver.md
- [ ] .supervisor/requirements/phase-2/2026-10-15-084413-loomwright-version-notes-say-only-what-changed.md
