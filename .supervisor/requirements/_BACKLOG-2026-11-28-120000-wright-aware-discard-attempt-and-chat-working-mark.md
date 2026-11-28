# Wright knows Studio, a failed run attempt can be discarded, and chat shows working — plan doc (index document, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now
Dispatched on 2026-11-28 (orca task `task_e4e7c64ce287`): ship the unshipped requirement items below through ONE `/loomwright:automate` run in safe mode, in dependency order.

## Order
| # | Item | Depends on |
|---|---|---|
| 1 | wa-a — the kernel-built Studio guide; `role.md` holds only who the agent is | none |
| 2 | wa-c — an unedited proposed tool list gets the current proposed tools | none |
| 3 | wa-b — an unedited old `role.md` becomes the persona file | wa-a |
| 4 | wa-d — every prompt says what is in Studio right now | wa-a |
| 5 | wa-e — agents can look up sessions, events, approvals, budget and settings | wa-c, wa-d |
| 6 | wa-f — agents propose lessons; the owner approves them | wa-a, wa-c |
| 7 | 23s — a failed run attempt can be discarded from Studio | none |
| 8 | Chat 1 — chat shows working (two-ring mark) and where replies land | none |

The wright-aware order is the one in `wright-aware/_BACKLOG-2026-11-21-230600-wright-knows-studio-and-learns.md`, run sequentially here.

## Run
`/loomwright:automate --backlog .supervisor/requirements/_BACKLOG-2026-11-28-120000-wright-aware-discard-attempt-and-chat-working-mark.md --limit 8`, safe mode: no `--auto-merge`, no `--parallel`. Every PR parks `awaiting_merge`; the owner merges.

## Considered and not queued
- **phase-7 item 29** (`phase-7/2026-11-02-090029-memory-edit-conflict-and-keymap-adopt-the-shared-crumb.md`): already shipped by PR #214 (`9e372aa5`, 2026-11-02). Memory Edit, Memory Conflict and the Keyboard map render `shell/Crumb.tsx` on `main`.
- **phase-8 item 21f** (`phase-8-21/2026-11-14-150000-f-wright-drafts-a-members-playbook-only-when-the-owner-asked.md`): already shipped by PR #280 (`ff127a5d`, merged 2026-11-14). Its Validation 2 (a running-system check) has no evidence file on `main`, so that live check is still owed.

## Checklist
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230000-wa-a-the-kernel-builds-each-agents-studio-guide-and-role-md-holds-only-who-it-is.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230200-wa-c-an-unedited-proposed-tool-list-gets-the-current-proposed-tools.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230100-wa-b-an-unedited-old-role-md-becomes-the-persona-file.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230300-wa-d-every-prompt-says-what-is-in-studio-right-now.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230400-wa-e-agents-can-look-up-sessions-events-approvals-budget-and-settings.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230500-wa-f-agents-propose-lessons-and-the-owner-approves-them.md
- [ ] .supervisor/requirements/phase-8-23/2026-11-18-030000-s-a-failed-run-attempt-can-be-discarded-from-studio.md
- [ ] .supervisor/requirements/auth-switch/2026-11-12-121226-chat-shows-working-and-where-replies-land.md
