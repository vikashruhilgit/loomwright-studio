# Phase 2: Brain + Loomwright adapter (plan doc, an index, not an implementable item)

## Status: done (index document — nothing to implement)

## Why now

Phase 1 (the kernel) passed its live exit run on 2026-10-06. Phase 2 is next in `docs/ROADMAP.md`. Done when `studio ask "remind me at 5pm to check X"` makes Wright create the trigger itself and it fires at 5pm, and a Loomwright version change produces a "new features" note. Baseline on 2026-10-14: there is no `studio ask`, no handler for a `message` event, no triggers, notifications reach no one, there's no approval gate, and the session manager loads the *newest* cached Loomwright rather than the active one (contrary to D32).

## Owner decisions

none recorded

<!-- Decisions the owner gave in the /product-owner session on 2026-10-14, copied into each affected item's "Owner decisions" section (the owner may restate them here):
- Triggers: own table now, nullable playbook, one-shot + cron (items 01, 04).
- Delivery: native macOS notification + `studio notifications`; every notification deep-links `loomwright-studio://notifications/<id>`; in phase 2 a click opens Terminal on `studio notifications show <id>`; the phase 5 app takes over the scheme (items 01, 03).
- No approval to create a trigger; the gate covers outward/persistent actions. `studio triggers` lists every trigger; `studio triggers on|off <id>` toggles it; the owner's "off" can't be undone by an agent; GUI later in the phase 7 Schedules screen (items 01, 04, 05).
- Fire actions: `notify` (no session) or `wake_agent`; Wright picks per trigger, visible to the owner (items 01, 04).
- "New features" note = diff of old vs new `capabilities.json` (items 01, 07). -->

## Order

| Item | Delivers | Depends on | Can run in parallel with |
|---|---|---|---|
| 01 | Migration 11 (triggers, notifications, approvals, contract seen) and one wired-in home per feature, so later items never touch a shared file | none | nothing (it's first) |
| 02 | Adapter: active install from `installed_plugins.json`, validated `capabilities.json`, host mode on every session, `kernel_loomwright_capabilities`, probes p9 (host mode) and p10 (desktop install) | 01 | 03, 04, 05, 06 |
| 03 | Native macOS notifications with deep link, `kernel_notify`, `studio notifications [show]`, notifier probe under launchd | 01 | 02, 04, 05, 06 |
| 04 | Triggers: register/remove/list tools, once + cron, notify / wake_agent, crash-safe firing, missed-fire rules, `studio triggers [on\|off]` | 01 | 02, 03, 05, 06 |
| 05 | Approval gate: `kernel_approval_request`, fixed outward set held for approval, protected kernel paths denied, `studio approvals / approve / deny` | 01 | 02, 03, 04, 06 |
| 06 | Wright: memory files, settings file (model unset ⇒ refuse), message routing, `studio ask` with reply | 01 | 02, 03, 04, 05 |
| 07 | Version-change note from the contract diff, in `memory/shared/loomwright-updates/` + a notification | 01, 02 | 03, 04, 05, 06 |
| 08 | Exit check: deterministic test + owner's live run, evidence, ROADMAP/OPEN_QUESTIONS/ARCHITECTURE updated | 02–07 | nothing (it's last) |

No two items share a Touches path, so only dependencies and width bound the waves. 01 and 08 are one-item steps and run sequentially (see Run).

## Run

Three runs. A one-item wave gets no parallelism and still pays the full lane cost (a clone, `wave-build`'s 15+ minute local CI, its own wave PR, `fleet-closeout`); Loomwright 17.2.0 has no one-item shortcut. So 01 and 08 run sequentially, and only 02–07 run in parallel.

1. `/automate --backlog .supervisor/requirements/phase-2/_BACKLOG-run-1-foundation.md`. Sequential, item 01, one PR; the owner merges it.
2. `/automate --backlog .supervisor/requirements/phase-2/_BACKLOG-run-2-features.md --parallel 3`. Items 02–07 in two waves of three (02, 03, 04, then 05, 06, 07; checked with `plan-waves` on a copy with 01 stamped done). Before 01 is merged, every item reads `blocked`, which is expected. One wave PR per wave; the owner merges each. Not `--parallel 5`: that gives a five-item wave and then 07 alone.
3. `/automate --backlog .supervisor/requirements/phase-2/_BACKLOG-run-3-exit.md`. Sequential, item 08, with the owner's live run.

Safe mode throughout (no `--auto-merge`; `--parallel` refuses it anyway). Items 02, 03 and 08 have owner-run steps (probes, live run) and park for them; a parked lane holds its wave's close until it's done. New findings from those runs join this plan doc as new items, not as fixes folded into a running item.

## Considered and not queued

- Reusing `kernel_schedule_wakeup` for reminders instead of a triggers table: the owner chose a triggers table now (2026-10-14).
- Approval for every trigger creation: the owner chose visibility plus on/off control instead.
- Building the "new features" note from Loomwright's `CHANGELOG.md`: the installed plugin has none, and D32 forbids parsing Loomwright's files. A release-notes field in the contract would be a Loomwright change.
- A minimal GUI trigger list in phase 2: deferred to the phase 7 Schedules screen; the CLI and API come now.
- Each item editing `docs/ARCHITECTURE.md` directly: that would serialise every wave. Each feature documents on its own `docs/architecture/<feature>.md` page instead; item 08 updates the main doc.

## Revisit when

- Item 02's p9 rerun shows host mode does NOT keep the repo clean (Studio must not run Loomwright in the owner's repos until Loomwright fixes it).
- Item 03's probe finds no click-capable notifier under launchd (click delivery ships as `unsupported` until the phase 5 app).
- Loomwright's `contract_schema_version` moves past 1.

## Checklist

- [ ] .supervisor/requirements/phase-2/2026-10-14-094201-phase-2-foundation-schema-and-feature-seams.md
- [ ] .supervisor/requirements/phase-2/2026-10-14-094202-loomwright-adapter-reads-the-active-contract.md
- [ ] .supervisor/requirements/phase-2/2026-10-14-094203-notifications-with-deep-links.md
- [ ] .supervisor/requirements/phase-2/2026-10-14-094204-triggers-wright-creates-and-the-owner-controls.md
- [ ] .supervisor/requirements/phase-2/2026-10-14-094205-approval-gate-from-the-cli.md
- [ ] .supervisor/requirements/phase-2/2026-10-14-094206-wright-answers-studio-ask.md
- [ ] .supervisor/requirements/phase-2/2026-10-14-094207-loomwright-version-change-note.md
- [ ] .supervisor/requirements/phase-2/2026-10-14-094208-phase-2-exit-check.md
