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
| `409 {error: "kill_switch_engaged"}` | the kill switch is engaged (as `POST /ask` refuses); nothing is queued |

The verb prints `queued playbook #<id> version <v> (event <queue_id>)` and exits 0. A refusal prints the kernel's message (or its error code, such as `kill_switch_engaged`) as one safe line on stderr and exits 1; an id that is not a positive integer prints the usage on stderr and exits 2 without calling the API.

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
   - The owning agent. A registered crew member whose status is `off` ⇒ `failed` (`agent_off`), and exactly one notification (source `kernel:agent_off`, title `Playbook not run: <agent> is off`, a body naming the playbook, the instant and `studio agents on <agent>`), recorded inside this step so a redelivery replays the stored row and records none more. An id that is neither `wright` nor a registered crew member (`isRoutable`) ⇒ `failed` (`agent_not_routed`). The snapshot has no model ⇒ `failed` (`model_unset`): the kernel never picks one.
   - The dedupe key (below). A matching run that ended `done` ⇒ `skipped_duplicate` with the key, and nothing starts.
   - Otherwise a `running` row with the key.
   Every refusal and skip is a row written inside the step, never a throw, so it commits with the step.
3. **One work step, `start-session`**, which decides whether the session starts and stores what it decided. The four parts below run inside it, in order, and the row is written after it from the stored result only (step 4).
   - **Settings.** For Wright's playbook: Wright's memory files (created when absent) and settings file. A settings file without a model, or one the kernel can't read, is a stored failure with the same detail the brain writes (`model_unset: set "model" in <file>`, `settings_invalid: …`). Memory or settings that can't be written (`memory_unwritable: …`, `settings_unwritable: …`) is a stored failure that also fails the event (one `notify`). For a crew member's playbook, the member's own, in order: the member is re-read and an `off` one is a stored `agent_off` failure with the same one notification (it may have been turned off since step 2, while the event was parked); its memory files (`memory/<id>`, created when absent; `memory_unwritable: …` fails the event too; a missing `role.md` is `charter_missing: <file>`); its own settings file (`config/agents/<id>.json`: `model_unset: set "model" in <file>`, `settings_invalid: …`, `settings_missing: …`). A kernel composed without a session manager is a stored failure (`no_session_manager`). Only the permission mode and tool policy (and a member's `never` list) are used; the model is the playbook's.
   - **The live row.** The step reads the live playbook row again, since the `running` row from step 2 may be stale by now (the event was parked, or the kernel died between the two steps). If the playbook is no longer `enabled` or is at another version, the stored skip is `skipped_not_enabled` with the live `{status, version}`. If a run with the same dedupe key ended `done` meanwhile, it is `skipped_duplicate`. Either way no session starts.
   - **The prompt.** `## Playbook <slug> (#<id>, version <v>, enabled by the owner)`, then "Run this playbook. Its intent is your instruction for this session:" and the version's intent (an `<untrusted-data` tag inside it defused). The owner approved this exact version when enabling it, and any edit returns it to draft, so the intent is the owner's approved instruction. Then, for Wright's playbook (`playbookPrompt`), Wright's usual context ([brain](brain.md#the-context-a-session-gets)): memory, Loomwright and the time, with a kernel-built message (`Playbook <slug> fired for <scheduled_at>.` or `Playbook <slug> run now by the owner.`) wrapped as data from `playbook:<id>`. For a crew member's playbook, the crew prompt (`crewPlaybookPrompt`): the member's own memory files (`memory/<id>/role.md`, `preferences.md`, `people.md`, `lessons.md`, each under a `## memory/<id>/<file>` heading, each cut at the brain's file limit, a missing or unreadable one noted), then `## Now` with the local time and the same kernel-built line, not wrapped (it is kernel text: the slug and the instant). It never reads `memory/wright`: Wright's memory is not the member's. The whole prompt is at most the brain's context limit (`MAX_CONTEXT_CHARS`): the heading, the intent, the time and the line are always kept, and the memory sections fill the rest in order, the first that does not fit cut and the rest dropped, each with a note.
   - **The session.** `startSession({agent, prompt, model: <the snapshot's model>, permissionMode, cwd, policy, playbook: <id>, playbookVersion: <version>})`, so the session row carries `sessions.playbook` and `playbook_version` (an approval the session asks for records them, see [approvals](approvals.md)). For Wright's playbook, `cwd` is `<dataDir>/memory/wright` and the policy Wright's. For a crew member's, the session runs as the member: `agent` is its id, `cwd` `<dataDir>/memory/<id>`, the permission mode and policy its own with its `never` list (the gate denies a call in one of those categories `agent_boundary`, never held), and admission applies its limits ([budget](budget.md)). There is no resume path. The stored result is the session's id.
   - An admission refusal (a parked account cap, a daily limit) is rethrown from inside the step, which is released rather than done. The row stays `running` with `result_json` `{"parked": <reason>, "retry_at": <iso or null>}`, the loop parks the event, and its redelivery runs the whole step again on the same row.
   - Any other throw fails the step, the row (`session_refused: <first line>`) and the event.
4. **The row, from the stored result.** A stored skip or failure moves the row, only while it is `running` with no session, to that skip or to `failed`; a stored session id is written to the row's `session_id`. Every write is guarded, so a redelivery that replays the done step repeats it harmlessly and never reads the settings or the live row again.
5. **The ending.** A listener on the session's end (never awaited, held only by the delivery that started the session) writes the row's outcome, its `tokens` (the session's counted budget tokens: input, output and cache writes, never cache reads) and `ended_at`. Only a row still `running` is updated.

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
| `item.id`, `item.revision` | a polled item's ref and revision (phase 6). No event carries an item until item 05, so a spec naming either fails the run `dedupe_spec_invalid`, never builds a key that leaves the field out |

The key is that object's JSON (`{"date":"2026-10-14"}`). A spec that is not a list of distinct known fields, or a zone the runtime doesn't know, fails the run (`dedupe_spec_invalid`, `dedupe_zone_invalid`). Only a `fire` or `run_now` run of the same playbook, with the same key, that ended `done` makes a later one a duplicate: a run that failed, was skipped or is still running never does. `date` comes from the event's instant, not from when it is handled, so a fire the kernel handles late (a coalesced instant after a restart) still keys on its own day.

## Crash safety

- The trigger's instant is one `runStep` keyed `trigger:<id>:<scheduled_at>` holding the enqueue, and the enqueue itself dedupes on `sourceRef` `playbook:<id>:<scheduled_at>` ([triggers](triggers.md#firing)).
- The handler's checks and run row are one work step (`playbook-run`) and the session start another (`start-session`), both keyed on the event id. A redelivery replays the stored `playbook-run` result and never evaluates the checks again, so one event writes exactly one run row whatever happened between deliveries (the playbook was disabled meanwhile, or the run already ended `done`: no second skip row against its own run).
- A replayed `start` is never trusted on its own. Until `start-session` has run, the `start-session` step re-reads the settings, the live playbook (status, version) and the dedupe key's `done` runs before it starts anything, and stores what it decided. Once it is done, a redelivery writes the row from that stored result alone: a kill -9 between the step and the row's write, followed by a change to the settings or the playbook, still records the session that started (or the skip or failure decided), never a fresh refusal. An event parked by admission, or redelivered after a crash between the two steps, whose playbook was disabled or edited meanwhile, ends its one row as a skip and starts no session. It never starts the old version's model.
- So a crash after the event is queued and before the session starts delivers the event again and starts at most one session for that instant. A crash while the session was being started leaves the `start-session` step interrupted: the redelivery starts nothing and fails the row (`session_refused: work step … was interrupted …`), with the one `notify` the work-step layer sends.

## Honest limits

- **Two events with the same key can both run.** Only a run that ended `done` is a duplicate, so a second fire (or a run now) while the first run is still `running` starts a second session. The key is checked again just before the session starts, so a parked event whose twin has ended `done` by then is skipped.
- **A run whose kernel restarted mid-session stays `running`**, as a brain message does: the listener lives in the kernel process, and a redelivery finds the stored `start-session` step and doesn't reattach one.
- **A playbook run needs its agent's settings file to be valid, model included** (Wright's for Wright's playbook, the member's for a crew member's), though it uses the playbook's model, not the settings'.
- **A crew playbook's prompt has no shared notes and no Loomwright summary.** It carries the member's own four memory files, the time and the kernel's line only. The crew context builder (phase 4 item 05, `kernel/src/brain/context.ts`) is built in a parallel item; until it lands, `crewPlaybookPrompt` is a local, narrower builder. Follow-up: switch the crew prompt to that builder once it is on `main`, keeping the heading and intent lines.
- **A crew member turned off after its session started is not stopped.** `off` is checked when the event is handled and again just before the session starts; a session already running finishes as any session does (the kill switch or `studio stop --all` stops it).
- **`date` uses the kernel host's zone**, not a cron trigger's `tz`: for a trigger in another zone, "today" is the host's today.
- **An admission-parked event keeps its run row `running`** (with `parked` and `retry_at` in `result_json`) until the redelivery starts the session or ends the row as a skip.
- **The live re-check happens once, just before the session starts.** A disable that lands after `startSession` was called doesn't stop that session. It's a normal session from then on, and stopping it belongs to the kill switch or `studio stop --all`.
