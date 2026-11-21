# Wright knows Studio and learns from its mistakes — plan doc (index document, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now
The owner asked on 2026-11-21 for a Wright that is smart, learns from its mistakes, and is aware of all of Studio (sessions, chat, crew, settings, schedules, events, triggers). Reading the kernel showed three gaps, all checked that day:
- **The manual goes stale and gets cut.** `role.md` mixes the owner's persona with a kernel manual and is written once. The owner's copy (Oct 29) lacks five later sections. A fresh install's copy is 9,469 characters against an 8,000 limit, so "Untrusted text" and "Memory" are cut from the prompt (reproduced).
- **No view of Studio.** None of the 38 kernel tools reads sessions, events, approvals, budget or settings.
- **No learning.** No agent can write memory. The owner's `preferences.md`, `people.md` and `lessons.md` are still empty templates. The tool list in `wright.json` is also written once, so new tools would never reach an existing Wright.

The cut safety section is why this runs now, as a side track alongside phase 8.

## Owner decisions
- 2026-11-21: run as a side track now, alongside phase 8.
- 2026-11-21: crew is in scope together with Wright.
- 2026-11-21: an old `role.md` is replaced only when it exactly matches a past template, with a backup; an edited one is flagged (wa-b).
- 2026-11-21: an unedited proposed tool list is upgraded, with a backup and an audit event; an edited one is flagged in Settings (wa-c).
- 2026-11-21: a crew member's Studio view and read tools show only its own items; Wright sees all (wa-d, wa-e).
- 2026-11-21: every lesson, preference or people entry is held for the owner's approval, and the kernel writes it (wa-f).

## Order
| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| wa-a | The kernel-built Studio guide (with glossary) for Wright and crew; `role.md` becomes persona only; fixes the cut | none | wa-c |
| wa-c | An unedited proposed tool list follows the current proposal | none | wa-a |
| wa-b | An unedited old `role.md` becomes the persona file; an edited one is flagged | wa-a | wa-d |
| wa-d | "Studio right now" and "Recent mistakes" in every prompt | wa-a | wa-b |
| wa-e | Read-only tools for sessions, events, approvals, budget and settings | wa-c, wa-d | — |
| wa-f | `kernel_memory_propose`: lessons held for approval, written by the kernel | wa-a, wa-c | — |

## Run
`/automate --backlog .supervisor/requirements/wright-aware/_BACKLOG-2026-11-21-230600-wright-knows-studio-and-learns.md --parallel 2`, safe mode, no new follow-up items.
- **Why `--parallel 2`:** waves 1 and 2 each have two independent items.
- **The waves** (`plan-waves --max 3`): wave 1 = wa-a, wa-c; wave 2 = wa-b, wa-d; wave 3 = wa-e; wave 4 = wa-f.
- **Serialisation:** `kernel/src/brain/settings.ts` (wa-e, then wa-f), whose companion rule adds `templates.ts`, `docs/architecture/brain.md` and `brain.test.ts`; `kernel/src/brain/memory.ts` (wa-b, then wa-f).
- **One drain at a time:** a `/automate` run currently holds this checkout's run lock (`automate-2026-11-20-174137`). Start this set only after that run ends; never alongside it.
- **Branch mode:** push these requirement files to `loomwright-meta` before `--parallel`, or lane-create aborts.
- **After the set:** reinstall the kernel, then do the Running system checks in wa-a to wa-f on the owner's install.

## Considered and not queued
- **Edit-then-approve on the approval card:** the owner edits in the Memory screen after approving, or denies with a note; a new approval mechanism isn't needed for this.
- **A preinstalled reflection playbook:** no playbooks ship preinstalled (invariant 1); wa-f's guide text lets Wright draft one when the owner asks.
- **Upgrading crew tool lists or charters:** a crew member's tools come only from its approved charter.
- **Agent proposals to `memory/shared/`:** not asked for.
- **Saving a working procedure as a skill (D7 "skills learned from use"):** the next step after lessons prove useful.

## Revisit when
- **wa-f is live and lessons pile up:** decide pruning and merging of `lessons.md` (the 8,000-character file limit refuses new entries first).
- **The guide's limit is tight:** decide whether the whole-context limit (`MAX_CONTEXT_CHARS`) rises.
- **Crew members want lessons across agents:** decide whether a proposal may target `memory/shared/`.

## Checklist
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230000-wa-a-the-kernel-builds-each-agents-studio-guide-and-role-md-holds-only-who-it-is.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230200-wa-c-an-unedited-proposed-tool-list-gets-the-current-proposed-tools.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230100-wa-b-an-unedited-old-role-md-becomes-the-persona-file.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230300-wa-d-every-prompt-says-what-is-in-studio-right-now.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230400-wa-e-agents-can-look-up-sessions-events-approvals-budget-and-settings.md
- [ ] .supervisor/requirements/wright-aware/2026-11-21-230500-wa-f-agents-propose-lessons-and-the-owner-approves-them.md
