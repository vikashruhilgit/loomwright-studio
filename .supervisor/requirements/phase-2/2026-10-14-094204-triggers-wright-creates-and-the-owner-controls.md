# 04 — Triggers: agents create one-shot and cron triggers; the owner sees every one and turns it on or off

## Status: ready

**Priority:** MVP · ROADMAP phase 2 exit check (a) "Wright creates the trigger itself and it fires at 5pm" · D2, D3, D4

**As** the owner,
**I want** Wright to create time-based triggers when I ask ("remind me at 5pm to check X"), and one place to see every trigger and turn any of them off or on,
**so that** reminders and scheduled work happen on time without a session staying alive, and nothing runs that I can't see and stop.

## Problem

Phase 1 has wake-ups (`kernel_schedule_wakeup`), which only queue a `wakeup` event that nothing handles. There is no trigger, no recurring schedule, and no owner-facing list.

## Owner decisions (2026-10-14, binding)

- Triggers have their own table now (item 01), with a nullable playbook; phase 3 attaches them to playbooks.
- Two fire actions, chosen by the agent when it creates the trigger and visible to the owner: `notify` (the kernel posts the stored text as a notification; no Claude session, no tokens) and `wake_agent` (queues a `message` event to the owning agent with the stored text, which item 06 handles).
- Creating a trigger needs **no approval**. Every trigger is listed in `studio triggers`, and `studio triggers on|off <id>` toggles it. Turning one off is the owner's action, recorded in the audit log, and an agent can't turn it back on.
- GUI comes later (the phase 7 Schedules screen reuses the same API).

## Scope

1. **Tools** (item 01 seam): `kernel_trigger_register(kind, spec, action, text, idempotency_key)`, `kernel_trigger_remove(id, idempotency_key)`, `kernel_trigger_list()`. `once` takes an ISO-8601 instant **with a time zone** (as `kernel_schedule_wakeup` does); `cron` takes a 5-field expression plus an IANA time zone. Invalid input returns an error result (never throws), e.g. a `once` instant in the past, an unknown time zone, an invalid cron field. Registering returns the id and the computed next fire time, so the agent can tell the user exactly when it will fire. An agent can remove only triggers it owns; it can't re-enable one the owner turned off (error result says the owner turned it off).
2. **Firing** (due-work contribution): each tick fires every enabled trigger whose next fire time has come, once per scheduled instant. Firing and the follow-up commit together: for `notify`, the notification row (item 03's record function); for `wake_agent`, the `event_queue` row (`kind: 'message'`, payload `{ text, agent, trigger_id }`). Then `last_fired`, `last_result` and the next fire time (`cron`) or `enabled = false` with `last_result = 'fired'` (`once`). A crash at any point fires an instant at most once (phase 1 `work_steps`, keyed on trigger id + scheduled instant).
3. **Missed fires** (kernel down, machine asleep): a `once` trigger that came due while the kernel was down fires once on the first tick after; a `cron` trigger fires at most once for all instants it missed (coalesced), then schedules the next future instant; the audit event records how many were missed. While the kill switch is engaged nothing fires (the loop doesn't run); after `studio resume`, instants missed during the kill switch are recorded as `missed_kill_switch` and NOT fired.
4. **Owner control** (CLI + API, seam): `studio triggers [--all] [--json]` lists id, owning agent, kind and spec, action and its text, enabled, next fire (in the owner's local time), last fired and result, created by and when, and who last toggled it. `studio triggers on <id>` / `off <id>` toggle with `by: owner` in the audit event. Turning on a past-due `once` trigger asks for confirmation that it will fire now (refuses without a terminal unless `--yes`, like `session abandon`).
5. Every register, remove, fire, miss and toggle is an audit event. Doc page `docs/architecture/triggers.md`.

## Non-goals

- Poll, webhook, git-hook or Claude Code hook triggers (later phases).
- Playbooks, dedupe keys, priorities (phase 3).
- Delivering notifications (item 03) or running the agent (item 06): this item only creates their rows.

## Acceptance criteria

- [ ] Given `kernel_trigger_register(once, "2026-10-14T17:00:00+05:30", notify, "check X")`, then a row exists with next fire 11:30Z, and at the first tick at or after it exactly one notification row with source `trigger:<id>` and body "check X" exists; the trigger is now disabled with result `fired`.
- [ ] Given a `cron` trigger `0 9 * * 1-5` in `Asia/Kolkata`, then next fire times are correct across a weekend and across a DST change in a zone that has one (tested with `America/New_York`).
- [ ] Given a `wake_agent` trigger, when it fires, then one `message` event for its agent with the text and trigger id is queued, and nothing else.
- [ ] Given the kernel is killed with `kill -9` after a fire committed and before the tick ended, when it restarts, then the instant is not fired again (test with the phase 1 crash harness pattern).
- [ ] Given a `cron` trigger that missed 5 instants while the kernel was down, when it restarts, then it fires once, and the audit event says 5 missed.
- [ ] Given the owner ran `studio triggers off 7`, when an agent calls `kernel_trigger_register` again or tries to re-enable 7, then 7 stays off and the agent gets an error result saying the owner turned it off.
- [ ] Given an invalid spec (past `once`, bad zone, bad cron), then an error result naming the problem, and no row.
- [ ] Given the kill switch engaged over a `once` trigger's time and then released, then it is recorded `missed_kill_switch` and does not fire.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Cron evaluation is implemented without a new dependency (`kernel/package.json` belongs to item 03 in this wave). If one turns out to be needed, raise it before building, because it moves this item out of the parallel wave.
- "Missed" behaviour above is a kernel mechanism default; making it per-trigger configurable can come with playbooks (phase 3).

## Risks

- Time-zone and DST errors make reminders fire an hour off. The DST tests above are the guard.

## Depends on
2026-10-14-094201-phase-2-foundation-schema-and-feature-seams.md

## Touches
kernel/src/triggers/
kernel/test/triggers.test.ts
docs/architecture/triggers.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-15T02:25:53Z
- **Brief:** .supervisor/jobs/done/2026-10-14-triggers-wright-creates-and-the-owner-controls.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/49
