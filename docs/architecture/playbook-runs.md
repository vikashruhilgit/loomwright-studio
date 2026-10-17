# Playbook runs

An enabled playbook wakes its agent on its schedule or when the owner asks, runs under the model, priority and dedupe key the owner set, and never does work its dedupe key says is already done (phase 3 item 08). Code: `kernel/src/playbooks/runs.ts` (the run-now route and verb, and `handlePlaybookMessage`), the fire in `kernel/src/triggers/store.ts` (`fireOne`) and the routing in `kernel/src/brain/handler.ts`. Table: `playbook_runs` (migration 13, see the [data model](../ARCHITECTURE.md#data-model)). Tests: `kernel/test/playbooks-runs.test.ts`.

This is mechanism only (invariant 1). The kernel fires only what the owner enabled, and runs it under the playbook's own values: it picks no model, sets no priority and has no built-in idea of "already done". What counts as a duplicate is the dedupe key the owner set, field by field. The session's lifecycle stays the kernel's session manager's (invariant 2): nothing here awaits or stops a session.

## What fires a playbook

Two things, and only for a playbook whose status is `enabled` ([playbooks](playbooks.md); enabling is [dry runs](dry-run.md)' item):

- **Its linked trigger comes due.** Whatever the trigger's `action`, the fire queues the playbook's message instead of the stored text: no notification and no plain wake-up text ([triggers](triggers.md#firing)). A trigger of a `draft`, `disabled` or missing playbook queues nothing: its instant is recorded as a `trigger_missed` (`playbook_not_enabled`), and no run row is written for it.
- **The owner runs it now.** `studio playbooks run <id>` posts to `POST /playbooks/:id/run` (owner only, body absent or `{}`), which queues the same event with no `trigger_id` and `scheduled_at` = the kernel's now.

| Route answer | When |
|---|---|
| `200 {queue_id, created, playbook, version, scheduled_at}` | queued (`created: false` when that instant was already queued) |
| `400 invalid_id` / `400 invalid_body` | the id is not a positive integer, or the body is not absent or `{}` |
| `404 not_found` | no such playbook |
| `409 {error: "not_enabled", message}` | the playbook is `draft` or `disabled`; nothing is queued |

The verb prints `queued playbook #<id> version <v> (event <queue_id>)` and exits 0. A refusal prints the kernel's message as one safe line on stderr and exits 1; an id that is not a positive integer prints the usage on stderr and exits 2 without calling the API.

## The event

One `message` event:

- payload `{agent, playbook, version, trigger_id, scheduled_at}`: the playbook's owning agent, its id, its current version, the trigger's id (absent for a run now) and the instant (the trigger's scheduled instant, or the run-now time);
- `priority`: the playbook's `priority` (`low`, `normal` or `high`), so the queue orders it with everything else ([queue](queue.md)). A stored priority outside that set makes the enqueue throw: a fire's step fails (reported once by the loop) and a run-now answers 500, and nothing is ever queued at a guessed priority;
- `sourceRef` `playbook:<id>:<scheduled_at>`: the queue keeps one row per playbook and instant.

## The run

The brain's `message` handler hands any message whose payload carries `playbook` to `handlePlaybookMessage` before anything else. A playbook's message writes no `brain_messages` row; its record is the `playbook_runs` row. With each step keyed on the event id, since delivery is at least once:

1. **The payload.** `playbook` and `version` must be positive integers, `scheduled_at` an instant, `trigger_id` absent or a positive integer, `agent` a string. Anything else fails the event (one `notify`). The run's `kind` is `fire` when `trigger_id` is present, else `run_now`.
2. **One work step, `playbook-run`**, which evaluates the next four checks and writes exactly one run row for the event:
   - The live playbook row and the version's snapshot (`playbook_versions` at the event's version). No snapshot ⇒ a `failed` row (`{"error":"not_found"}`). A payload naming no playbook row at all fails the event instead (one `notify`): a run row references its playbook, so there is nothing to record it against.
   - The live status is not `enabled`, or the live version is not the event's (the owner turned it off, or it was edited and went back to draft, after the event was queued) ⇒ `skipped_not_enabled`, with the live `{status, version}`.
   - The agent is not one the brain runs (only `wright` until crew members, phase 4) ⇒ `failed` (`agent_not_routed`). The snapshot has no model ⇒ `failed` (`model_unset`): the kernel never picks one.
   - The dedupe key (below). A matching run that ended `done` ⇒ `skipped_duplicate` with the key, and nothing starts.
   - Otherwise a `running` row with the key.
   Every refusal and skip is a row written inside the step, never a throw, so it commits with the step.
3. **Settings.** Wright's memory files (created when absent) and settings file. A settings file without a model, or one the kernel can't read, fails the row with the same detail the brain writes (`model_unset: set "model" in <file>`, `settings_invalid: …`). Only the permission mode and tool policy are used; the model is the playbook's.
4. **The prompt.** `## Playbook <slug> (#<id>, version <v>, enabled by the owner)`, then "Run this playbook. Its intent is your instruction for this session:" and the version's intent (an `<untrusted-data` tag inside it defused), then Wright's usual context ([brain](brain.md#the-context-a-session-gets)): memory, Loomwright and the time, with a kernel-built message (`Playbook <slug> fired for <scheduled_at>.` or `Playbook <slug> run now by the owner.`) wrapped as data from `playbook:<id>`. The owner approved this exact version when enabling it, and any edit returns it to draft, so the intent is the owner's approved instruction.
5. **The session, one work step `start-session`:** `startSession({agent, prompt, model: <the snapshot's model>, permissionMode, cwd: <dataDir>/memory/wright, policy, playbook: <id>, playbookVersion: <version>})`, so the session row carries `sessions.playbook` and `playbook_version` (an approval the session asks for records them, see [approvals](approvals.md)). There is no resume path. A kernel composed without a session manager fails the row (`no_session_manager`).
   - An admission refusal (a parked account cap, a daily limit) leaves the row `running` with `result_json` `{"parked": <reason>, "retry_at": <iso or null>}` and is rethrown, so the loop parks the event; its redelivery starts the session on the same row.
   - Any other refusal fails the row (`session_refused: <first line>`) and the event.
6. **The ending.** The row gets the `session_id`. A listener on the session's end (never awaited) writes the row's outcome, its `tokens` (the session's counted budget tokens: input, output and cache writes, never cache reads) and `ended_at`. Only a row still `running` is updated.

### `done` and `failed`

A run is `done` when its session ends `completed`, or ends `stopped` after the session's own `kernel_request_stop` (a `stop_requested` event for that session). Any other ending is `failed` with `{"error": "session_<status>"}` (`session_failed`, `session_stopped` when the stop was not the session's own, `session_interrupted`, …).

### Run statuses

`PLAYBOOK_RUN_STATUSES` in `runs.ts` closes the set (migration 13 has no SQL CHECK; every write is checked against it):

| Status | Meaning |
|---|---|
| `running` | the run row is written; its session is starting or running (or the event is parked) |
| `done` | the session ended `completed`, or `stopped` on its own request |
| `failed` | refused (`result_json` names why) or the session ended any other way |
| `skipped_duplicate` | a run with the same dedupe key already ended `done`; nothing started |
| `skipped_not_enabled` | the playbook was off, or at a newer version, when the event was handled; nothing started |

A row's `kind` is `fire` or `run_now` here (`dry_run` is the dry run's).

## The dedupe key

The owner (or Wright's proposal the owner kept) sets `dedupe_key` as a list of fields. No key ⇒ no check: every fire runs. Otherwise `evaluateDedupeKey` (exported and pure: the event's values only, never the clock) builds an object from the fields in the order the spec lists them:

| Field | Value |
|---|---|
| `playbook.id` | the playbook's id |
| `playbook.version` | the event's version |
| `trigger.id` | the trigger's id, or `null` for a run now |
| `trigger.scheduled_at` | the event's `scheduled_at` |
| `date` | the `YYYY-MM-DD` calendar date of `scheduled_at` in the kernel host's time zone |

The key is that object's JSON (`{"date":"2026-10-14"}`). A spec that is not a list of distinct known fields, or a zone the runtime doesn't know, fails the run (`dedupe_spec_invalid`, `dedupe_zone_invalid`). Only a `fire` or `run_now` run of the same playbook, with the same key, that ended `done` makes a later one a duplicate: a run that failed, was skipped or is still running never does. `date` comes from the event's instant, not from when it is handled, so a fire the kernel handles late (a coalesced instant after a restart) still keys on its own day.

## Crash safety

- The trigger's instant is one `runStep` keyed `trigger:<id>:<scheduled_at>` holding the enqueue, and the enqueue itself dedupes on `sourceRef` `playbook:<id>:<scheduled_at>` ([triggers](triggers.md#firing)).
- The handler's checks and run row are one work step (`playbook-run`) and the session start another (`start-session`), both keyed on the event id. A redelivery replays the stored `playbook-run` result and never evaluates the checks again, so one event writes exactly one run row whatever happened between deliveries (the playbook was disabled meanwhile, or the run already ended `done`: no second skip row against its own run).
- So a crash after the event is queued and before the session starts delivers the event again and starts at most one session for that instant. A crash while the session was being started leaves the `start-session` step interrupted: the redelivery starts nothing and fails the row (`session_refused: work step … was interrupted …`), with the one `notify` the work-step layer sends.

## Honest limits

- **Two events with the same key can both run.** Only a run that ended `done` is a duplicate, so a second fire (or a run now) while the first run is still `running` starts a second session.
- **A run whose kernel restarted mid-session stays `running`**, as a brain message does: the listener lives in the kernel process, and a redelivery finds the stored `start-session` step and doesn't reattach one.
- **A playbook run needs Wright's settings file to be valid, model included**, though it uses the playbook's model, not the settings'.
- **`date` uses the kernel host's zone**, not a cron trigger's `tz`: for a trigger in another zone, "today" is the host's today.
- **An admission-parked event keeps its run row `running`** (with `parked` and `retry_at` in `result_json`) until the redelivery starts the session.
- **The run-now route queues even while the kill switch is engaged**; nothing runs until the owner resumes, because the loop does not run.
