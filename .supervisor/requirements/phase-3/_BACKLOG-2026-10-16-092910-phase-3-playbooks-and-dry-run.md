# Phase 3 — self-authored playbooks and dry run — plan doc (index document, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now
Phase 2 shipped Wright, triggers, approvals and notifications (wave PR #62, fixes #63, live exit evidence #64; only step 2's 17:00 fire was pending on 2026-10-16). ROADMAP phase 3: "A plain-English request becomes a stored playbook whose dry-run output is shown before it's enabled; dedupe key, priority and model come from the user, with Wright only proposing defaults." Nothing playbook-shaped exists in code: no `playbooks` table (store.test.ts pins its absence), no dedupe-key check (main loop step 3 unimplemented), `always` approvals refused (`always_not_supported`), the D28 fallback read from a kernel-wide placeholder.

## Owner decisions
Recorded 2026-10-16 in the product-owner session; each item carries a copy under its own "Owner decisions" heading.
- Dry run is a read-only agent run (outward or persistent calls denied and recorded as "would do").
- Storage is the SQLite `playbooks` table plus a read-only markdown mirror under `memory/playbooks/`.
- Wright requests enabling via `kernel_playbook_enable`, which the gate always holds, and the owner approves it once. Enabling needs a dry run of that version. An edit returns the playbook to draft.
- Triggers are once/cron schedules plus an owner "run now". Event triggers wait for phase 6 connectors.
- A fire wakes the owning agent with the playbook, under its model, priority, approvals and limits.
- Priority is `low` / `normal` / `high`.
- In scope: priority ordering, always-allow per playbook, per-playbook token limits, per-playbook API-key fallback (D28).

## Order
| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| 01 | Migration 013, the `kernel/src/playbooks/` shell with per-item sub-files, per-feature test pins (feature-seams.test.ts stops pinning every feature), reserved tool names, `kernel_playbook_enable` always held, sessions carry their playbook, stub doc pages | none | nothing (it's first) |
| 02 | Wright creates/updates/lists/disables drafts; versions; markdown mirror; linked trigger; `studio playbooks list/show/set/off` | 01 | 03, 04, 05, 06 |
| 03 | Dry-run session mode: reads run, actions denied and recorded | 01 | 02, 04, 05, 06 |
| 04 | Event queue ordered by priority | 01 | 02, 03, 05, 06 |
| 05 | "Always" approvals scoped to one playbook version and action; revoke | 01 | 02, 03, 04, 06 |
| 06 | Per-playbook token metering, daily limit, API-key fallback | 01 | 02, 03, 04, 05 |
| 07 | `kernel_playbook_dry_run` and `kernel_playbook_enable` (dry run shown in the approval) | 02, 03 | 08 |
| 08 | Linked triggers fire the playbook; run now; dedupe-key skip; sessions run under the playbook's model and id | 02 | 07 |
| 09 | Exit check: deterministic test, live harness and runbook, evidence, ROADMAP/ARCHITECTURE/OPEN_QUESTIONS | 02–08 | nothing (it's last) |

No two items in a wave share a `Touches` path, with `.agent/companions.json` expansion applied (checked with `plan-waves --max 5 --explain` on 2026-10-16): every item waits only on its dependencies, never on a file conflict. Shared hotspots are owned by 01 alone: migrations + store.test.ts, features/index.ts + feature-seams.test.ts, brain settings/templates/brain.md, sessions/policy.ts, ARCHITECTURE.md. Later items edit only their own module, test and doc page.

## Run
Four runs, as in phase 2: a one-item wave still pays the full lane cost, so 01 and 09 run sequentially.

1. `/automate --backlog .supervisor/requirements/phase-3/_BACKLOG-run-1-foundation.md`. Sequential, item 01. The owner merges it.
2. `/automate --backlog .supervisor/requirements/phase-3/_BACKLOG-run-2-features.md --parallel 5`. Items 02–06, one wave of five, one wave PR.
3. `/automate --backlog .supervisor/requirements/phase-3/_BACKLOG-run-3-runs.md --parallel 2`. Items 07 and 08, one wave of two.
4. `/automate --backlog .supervisor/requirements/phase-3/_BACKLOG-run-4-exit.md`. Sequential, item 09, with the live run (D33: an agent may run it while the owner watches).

Safe mode throughout (no `--auto-merge`). Before a lane can read these items, push them to the metadata branch (`meta-sync.sh push --paths-from`), as for phase 2. If a lane needs a file outside its Touches that another lane in the same wave owns, it stops and says so; it does not edit it. New findings join this plan doc as new items.

## Considered and not queued
- Wright enabling playbooks without approval: rejected by the owner on 2026-10-16. It would reopen D3 and invariant 3.
- A static-only dry run (no model): rejected. It cannot show what the agent would actually do.
- The markdown file as the source of truth: rejected. A hand edit could break it or bypass review.
- A notify-only playbook action: not chosen. A phase 2 `notify` trigger already covers cheap reminders.
- Approval levels beyond hold / always (the mockup's "still ask when blocking"): later.
- A starvation guard for low-priority work: documented as a limit in item 04, not built.
- Field-level playbook editing in a GUI: phase 7 (DESIGN.md defers it to GUI v2).

## Revisit when
- Connectors land (phase 6): event triggers and more dedupe-key fields.
- Crew lands (phase 4): playbooks owned by agents other than Wright.

## Checklist
- [ ] .supervisor/requirements/phase-3/2026-10-16-092901-phase-3-foundation-schema-seams-and-per-feature-pins.md
- [ ] .supervisor/requirements/phase-3/2026-10-16-092902-wright-drafts-playbooks-the-owner-reads-changes-and-turns-off.md
- [ ] .supervisor/requirements/phase-3/2026-10-16-092903-a-dry-run-session-can-read-but-never-act.md
- [ ] .supervisor/requirements/phase-3/2026-10-16-092904-pending-work-runs-by-priority.md
- [ ] .supervisor/requirements/phase-3/2026-10-16-092905-always-allow-scoped-to-one-playbook.md
- [ ] .supervisor/requirements/phase-3/2026-10-16-092906-token-limits-and-api-key-fallback-per-playbook.md
- [ ] .supervisor/requirements/phase-3/2026-10-16-092907-wright-dry-runs-a-playbook-and-asks-to-enable-it.md
- [ ] .supervisor/requirements/phase-3/2026-10-16-092908-enabled-playbooks-fire-on-schedule-or-on-demand-once-per-dedupe-key.md
- [ ] .supervisor/requirements/phase-3/2026-10-16-092909-phase-3-exit-check.md
