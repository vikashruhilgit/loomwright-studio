# Triggers

Time-based triggers: an agent creates a one-shot (`once`) or recurring (`cron`) trigger with a kernel tool, the kernel fires each scheduled instant at most once from its due work, and the owner sees every trigger and turns any of them on or off. A playbook's trigger can also be a `poll` (phase 6), which lists a source at the user's interval and queues one playbook message per item it finds ([poll triggers](#poll-triggers)). Code: `kernel/src/triggers/`. Table: `triggers` (migration 11, see the [data model](../ARCHITECTURE.md#data-model)).

This is mechanism only (invariant 1). No trigger is preinstalled, the kernel invents none, and what a trigger is for belongs to whoever created it. The missed-fire rules below are kernel defaults; per-trigger settings can come with playbooks (phase 3). Creating a trigger needs no approval, but nothing runs that the owner can't see in `studio triggers` and turn off.

## Tools

Agents get three kernel tools. Their input is untrusted data, and every refusal is an error result naming the problem, never a throw. A refused call stores nothing: no row, no event, no work step.

- **`kernel_trigger_register(kind, spec, tz?, action, text, idempotency_key)`** creates an enabled trigger owned by the calling session's agent (`created_by: agent`). A session that runs no named agent is refused. It returns `{id, next_fire_at}` (UTC), so the agent can tell the user exactly when the trigger will fire.
  - `kind: once`: `spec` is an ISO-8601 instant with an explicit `Z` or offset (`2026-10-14T17:00:00+05:30`), strictly in the future, and `tz` must be absent. The spec is stored as given.
  - `kind: cron`: `spec` is a 5-field expression and `tz` is an IANA zone name (`Asia/Kolkata`), stored as given. A bare offset such as `+05:30` is refused. An expression that never fires within eight years (`0 0 31 2 *`) is refused too.
  - `kind: poll` (phase 6) belongs to a playbook, so this tool refuses it (`invalid_input`, "a poll trigger must belong to a playbook"). It is created as a playbook's trigger and validated as described in [poll triggers](#poll-triggers).
  - `action: notify` posts `text` as a notification. `action: wake_agent` queues `text` as a `message` to the owning agent (item 06 handles it). `text` is 1-2000 characters with no NUL, and the owning agent's name holds no NUL either: a `notify` text is a notification's body, which the notifications record refuses a NUL in ([notifications](notifications.md)). Either is refused as `invalid_input` before anything is written.
- **`kernel_trigger_remove(id, idempotency_key)`** deletes a trigger the calling agent owns. It refuses another agent's trigger and one the owner turned off, because remove-then-re-register would undo the owner's off.
- **`kernel_trigger_list()`** lists the calling agent's own triggers, enabled and disabled, in id order.

Register and remove run as a work step keyed `<tool>:session-<id>:<idempotency_key>`, so a repeat in the same session returns the first result. The one exception: a register repeated after the owner turned that trigger off returns the `owner_off` error, not the stored `{id, next_fire_at}`.

Trigger ids are never reused. A new trigger's id is one above the highest any trigger ever had, counting the rows and the `trigger_registered` / `trigger_removed` events, so an old notification's `source` `trigger:<id>`, an audit event's `trigger_id`, a work-step key and `studio triggers off <id>` never point at a different trigger.

**The owner's off is final for agents.** A trigger the owner turned off (`enabled = 0` and `enabled_changed_by = owner`, unless it is a `once` that was spent after its last turn-on) can't be re-enabled, re-registered or removed by an agent. The error result says the owner turned it off.

Re-registering means the same agent, kind, schedule, action and text. The schedule is compared by meaning, not by text: a `once` by its instant (the same instant written with another offset counts), a `cron` by the value sets its fields parse to and the day rule (`1-5`, `1,2,3,4,5` and `5,4,3,2,1` are the same) and by the zone as ICU resolves it (`Asia/Kolkata`, `asia/kolkata` and `Asia/Calcutta` are the same; the zone is still stored as given). The honest limit: a schedule that is written to mean something different is a different trigger, even when it happens to fire at the same instants (`0 9 1-31 * 1-5` fires every day under the day rule, so it is not `0 9 * * 1-5`). The owner sees every trigger, and can turn that one off too.

### Cron

The five fields are minute, hour, day of month, month and day of week, with `*`, lists, ranges and steps (`*/15`, `9-17/4`, `n/step` running to the field's maximum). Day of week runs 0-7, and both 0 and 7 are Sunday. Names and `@` macros are not accepted.

The two day fields follow the standard (Vixie) rule: when both are restricted (neither starts with `*`), a day matches if either one matches; otherwise both must match.

Every instant is computed from wall-clock time in the trigger's zone, using Node's built-in ICU and no dependency. Nothing uses one offset fixed at registration: 09:00 in New York is 14:00Z in winter and 13:00Z in summer. Across a daylight-saving change:

- A wall-clock time skipped by a spring-forward gap (02:30 on the night New York jumps from 02:00 to 03:00) does not fire that day.
- A wall-clock time repeated by a fall-back overlap (01:30 on the night New York goes back from 02:00 to 01:00) fires once, at its first instant.

## Firing

The contribution's due work runs once per loop tick. It fires every enabled `once` and `cron` trigger whose `next_fire_at` is at or before now, earliest first, and then the due `poll` triggers ([poll triggers](#poll-triggers)). The two run every tick even when the first throws; the first failure is thrown after both, so the loop records one `due_work_failed` and a failing cron trigger never skips a due poll (or the reverse). The rest of this section is the time-based fire; a `poll` row never reaches it. Each due trigger runs in one `runStep` work step keyed `trigger:<id>:<scheduled instant>` (its stored `next_fire_at`). That step's single transaction holds four things:

- The effect:
  - `notify`: one notification recorded by the notifications feature's `recordNotification`, joining the step's transaction, with `source` `trigger:<id>`, title `Trigger <id> (<agent>)` (clipped to 200 characters with `…`) and `body` the stored text: a `pending` row with its `deep_link` and one `notification_created` event. Delivering it belongs to the notifications feature.
  - `wake_agent`: one `event_queue` row (`kind: message`, payload `{text, agent, trigger_id}`, `source_ref` `trigger:<id>:<instant>`), plus the queue's own `event_enqueued` row.
  - A trigger linked to an `enabled` playbook, whatever its `action`: the playbook's message instead of the stored text, with no notification. One `event_queue` row (`kind: message`, payload `{agent, playbook, version, trigger_id, scheduled_at}` with the playbook's owning agent, id and current version, at the playbook's `priority`, `source_ref` `playbook:<playbook id>:<instant>`), plus `event_enqueued`. A stored priority outside `low` / `normal` / `high` fails the step (reported once by the loop) rather than queue at a guessed one. What the message does is in [playbook runs](playbook-runs.md). The status, version, priority and owning agent are read with raw SQL: the triggers feature never imports the playbooks feature.
- The bookkeeping: `last_fired_at` and `last_result = fired`. A `cron` trigger also gets its next future instant as `next_fire_at`. A `once` trigger is spent: `enabled = 0` and no next fire. Its `enabled_changed_by` / `enabled_changed_at` stay, so `studio triggers` still shows who last toggled it. A spent `once` is told from an off by the log: when the newest `trigger_toggled` for it turned it on, it was spent, not turned off. Without such an event, a toggle recorded in the columns counts as that toggler's off, so a gap in the evidence never unlocks an owner's off.
- The `trigger_fired` audit event.
- The step's `done` row.

So a `kill -9` at any point either committed all of it, and the instant is never fired again, or none of it, and the next tick fires it. Both cases are tested against a separate `node` process in `kernel/test/triggers-crash.test.ts`. A step that finds its trigger no longer enabled, or no longer due at that instant, does nothing.

An instant whose work step already exists is never scheduled again, because its step would only replay the stored result and the trigger would stay due at it for ever. This can happen when the wall clock steps back: an hourly trigger fired at 10:00, the clock reads 09:59, and the owner turns it off and on. Every next fire (after a fire, and on turning a trigger on) skips instants already taken, and a `once` whose instant is taken counts as past due. As a last guard, a due trigger that is still due at the same instant after its step ran was replayed. It is moved past that instant in one transaction with one `trigger_missed` (`reason: already_done`): a `cron` gets its next free instant, and a `once` is spent.

One trigger's failure never stops the others. A trigger whose stored spec the kernel can't evaluate (a corrupt row, or a zone the runtime no longer knows), or whose `notify` the notifications record refuses (a NUL stored before registration refused one), is parked: its `next_fire_at` is cleared, so it stops coming due, and the failure is reported once as the loop's `due_work_failed` rather than on every tick. It stays listed, and the owner's off-then-on recomputes it.

### Missed fires

- **Kernel down or machine asleep.** A `once` trigger that came due while the kernel was down fires once on the first tick after. A `cron` trigger that missed instants fires once for all of them (coalesced), then schedules its next future instant. `trigger_fired` carries `missed`: how many due instants this one fire stands for (0 when only one was due, which is an ordinary fire however late). Counting stops at 10 000 instants (`missed_at_least: true`).
- **Kill switch.** Nothing fires while it is engaged: the loop doesn't run, and the due work checks the switch too. After `studio resume`, a due instant that fell inside an engagement window is recorded and not fired. Engagement windows are read from `kill_switch_engaged` / `kill_switch_released` in the append-only `events` log, from the first engagement to the next release.
  - If every due instant fell inside a window, the trigger gets `last_result = missed_kill_switch` and one `trigger_missed` event. A `once` trigger is then spent.
  - If some fell outside, it fires once, and `trigger_fired` also carries `missed_kill_switch` (the count left unfired).
- **Pause.** While the owner's pause (`POST /pause`, `studio pause`) is on, nothing fires, but the loop keeps running, so due triggers are processed. A due instant inside a pause window (from the first `pause_engaged` to the next `pause_released`, open while paused), or any instant processed while paused, is recorded at once and never fired, even after the release. Each instant is counted for the kill switch first, then the pause, else it fires.
  - If every due instant fell inside a kill-switch or pause window, the trigger gets `last_result = missed_kill_switch` when any fell inside a kill-switch window, else `missed_paused`, and one `trigger_missed` event (`reason: kill_switch` or `paused`). A `once` trigger is then spent.
  - If some fell outside, it fires once, and `trigger_fired` also carries `missed_paused` (the count left unfired). The pause itself is in [pause](pause.md#triggers).
- **Playbook not enabled.** A trigger linked to a playbook (`triggers.playbook`, the slug) whose playbook is not `enabled` (`draft`, `disabled`, or missing) when it comes due starts no work. Inside the same per-instant work step a fire would use, it records one `trigger_missed` (`reason: playbook_not_enabled`) and schedules its next fire as after a fire: a `cron` moves to its next future instant, and a `once` is spent. `last_result` stays as it was. Because the step is done, that instant is never fired later, even if the playbook is enabled afterwards. This check comes before the kill-switch and pause ones. The playbook-side rules are in [playbooks](playbooks.md#the-linked-trigger).

## Poll triggers

A `poll` trigger (phase 6 item 04) lists a source at the interval the user set and queues one playbook `message` per item it finds, so a review duty sees each open pull request without a model deciding when to look, and a quiet poll costs no tokens. Code: `kernel/src/triggers/poll.ts`. The interval, the repos and the filters are the user's, stored as given (invariant 1); the kernel adds only the safety bounds below. The deterministic kernel decides when to look (invariant 2).

### Spec and validation

A poll belongs to a playbook: `registerTrigger` / `updateTriggerSpec` with `kind: poll` and no playbook link is refused `invalid_input`, because its fire's `source_ref` is the playbook's. It is created and re-scheduled through the playbook's trigger ([playbooks](playbooks.md#the-linked-trigger)). Its `spec` is the `PollSpec` as JSON text, and `tz` must be absent:

```json
{"source": "github.pulls", "repos": ["owner/name"], "filters": {"draft": false, "author": "alice"}, "interval_seconds": 300}
```

It is stored normalized as `{source, repos, filters, interval_seconds}`, with repos and filter values exactly as given (an absent `filters` is stored as `{}`), so re-saving the same spec is no change. Every refusal comes before any write:

- `invalid_spec`: not a JSON object, an unknown field, a `source` other than `github.pulls`, `repos` empty or not `owner/name` strings (neither part `.` or `..`) or listing one twice (case-insensitively), a filter value of the wrong type (`state` and `author` are strings of 1-200 characters, `draft` a boolean), `interval_seconds` not a whole number, or a `tz`.
- `poll_filter_unknown`: a filter key other than `state`, `draft` or `author`, naming it.
- `poll_interval_below_floor`: `interval_seconds` under the 60 second floor (a kernel safety bound, not a default: there is no default interval).
- `poll_connector_missing`: no usable GitHub connector.
- `poll_repo_not_reachable`: a repo the connector does not reach, naming every such repo.

The four `poll_*` messages start with their code, so a playbook's `trigger: <message>` still names it. The connector is read with raw SQL over `connectors` (migration 17), never through the integrations feature: usable means a `kind = 'github'` row whose status is `connected` or `expiring` (the newest such row decides); anything else (no row, `disconnected`, `expired`, `rejected`) is missing. The repos it reaches are that row's `reachable_repos_json`, read as a JSON array of `owner/name` strings (the shape `GET /connectors/github/repos` answers) and compared case-insensitively; an unparseable value reaches no repo.

Registration, a re-schedule and turning a poll on all set `next_fire_at = now + interval_seconds`.

### The fire

Each due poll is fired in two phases, because the GitHub client is asynchronous and a work step is one synchronous transaction:

1. **Phase A writes nothing.** It decides whether to fetch, then lists every repo in spec order, one after the other, outside any transaction, through `GitHubClient.listOpenPulls(repo, filters)`. It fetches nothing when the instant's step is already done, the linked playbook is not `enabled`, the instant falls in a kill-switch window, the kernel is paused or the instant falls in a pause window, or the connector is missing or no client is wired.
2. **Phase B is one `runStep` keyed `trigger:<id>:<instant>`**, the same key as every fire. It re-reads the row (still enabled and due at the instant, else `skipped` with nothing written for it), and re-checks the kill switch, the playbook, the windows and the connector. Then it writes the effect, the bookkeeping and the events in one transaction.

So a `kill -9` during Phase A leaves nothing on disk, and the next tick fetches the same instant again. During Phase B it commits all or nothing. After it, the done step replays, and a due poll whose step was already done is moved past the instant (`trigger_missed`, `reason: already_done`) without fetching. `enqueueEvent`'s per-`source_ref` idempotency makes a second queue row for an item impossible. When the kill switch is engaged during the fetch, or the instant becomes fetchable after Phase A decided not to fetch, the step is rolled back with nothing written (`deferred`) and the next tick redoes it.

**Items.** Each listed pull request passes the spec's filters again in the kernel, so the client's filtering is never the only one: `draft` and `author` match exactly, and `state` is compared to `open` (the listing returns open pull requests only, so any other `state` matches nothing). An entry without a positive whole number and a head SHA is dropped. An item is a `SourceItem` `{ref: "github:<owner>/<repo>#<n>", revision: <head SHA>, title, url, updated_at}`; `title` is author-controlled text, data and never instructions. Items come in spec repo order, pull requests by ascending number, at most `MAX_POLL_ITEMS` (100) per instant. That cap is a kernel safety bound like the 10 000 counted instants: beyond it the rest are dropped, and `trigger_fired` carries `items_capped: true` and `items_found`.

**Effect per item**, only when the linked playbook is `enabled`: one `event_queue` row (`kind: message`, payload `{agent, playbook, version, trigger_id, scheduled_at, item}`, which is the time-based playbook fire's payload plus `item`, at the playbook's `priority`, `source_ref` `playbook:<playbook id>:<instant>:<item.ref>`), plus `event_enqueued`, then one `poll_item_queued` event `{trigger_id, playbook_id, item_ref, revision, queue_id}` (the console thread ties it to the playbook). Then `last_fired_at`, `last_result = fired`, the next fire, and one `trigger_fired` with `items` (the count queued). When nothing is found, the same `trigger_fired` has `items: 0`; nothing is queued and no session starts.

**Schedule.** After every processed instant the next fire is `now + interval_seconds`, never the scheduled instant plus the interval, so downtime coalesces into one poll with no catch-up burst.

### Misses, backoff and parking

All or nothing per instant: the first repo answering a failure stops the fetch, and nothing is queued for that instant, not even an earlier repo's items. There is no retry within the tick.

| What happened | `last_result` | `trigger_missed` | Next fire |
|---|---|---|---|
| Linked playbook not `enabled` (checked first) | unchanged | `reason: playbook_not_enabled`, `playbook`, `playbook_status` | `now + interval_seconds` |
| Instant in a kill-switch window | `missed_kill_switch` | `reason: kill_switch` | `now + interval_seconds` |
| Paused, or the instant in a pause window | `missed_paused` | `reason: paused` | `now + interval_seconds` |
| No usable connector, or no client wired | `connector_missing` | `reason: connector_missing`, `connector_status`, `client`, `notification_id` (first missing instant only) | `now + interval_seconds` |
| `rate_limited` | `rate_limited` | `reason: rate_limited`, `repo`, `resets_at` | `max(now + interval_seconds, resets_at)` |
| `http_error`, `unreachable`, or a client that throws (`client_error`) | `source_error` | `reason: source_error`, `repo`, `error`, `status` (when any), `message` (`client_error` only) | `now + interval_seconds` |

While the kill switch is engaged nothing runs at all, as for every trigger.

**Parking and notify-once.** A missing connector parks the poll: each instant is recorded `connector_missing` with no fetch, so a poll never throws or retry-loops for want of a connector. One notification (source `trigger:<id>`, title `Poll trigger <id>: GitHub not connected`) is recorded through `recordNotification`, joining the step's transaction, only when the trigger's previous `last_result` was not already `connector_missing`. Consecutive missing instants add none, and the first other result ends the outage, so the next outage notifies again. A poll whose stored spec can't be read is parked like an unreadable time-based trigger: its `next_fire_at` is cleared and the failure is reported once.

**The client seam.** The client reaches the due work as `DueWorkContext.github`, passed by the loop (`EventLoopOptions.github`) from `startKernel`'s `KernelDeps.githubClient`. It defaults to none, so until the real client (phase 6 item 03) is wired into that default, a due poll records `connector_missing`. Wiring it is item 03's one-line change in `kernel/src/kernel.ts` (or this item's, whichever lands second). Tests use `FakeGitHubClient` and never reach the network.

## Owner control

`studio triggers` (one help line: `studio triggers [--all] [--json] | studio triggers on|off <id> [--yes]`) calls the loopback API. Like every contributed subcommand, it runs after the `api.json` pid check and before the Keychain read.

- **`studio triggers [--all] [--json]`** lists enabled triggers. `--all` adds disabled ones, and `--json` prints the API's answer. Each entry shows the id, owning agent, kind and spec, action and its text, on or off, next fire in the owner's local time (`2026-10-14 17:00 +05:30`), last fired and its result, who created it and when, and who last toggled it and when. A trigger linked to a playbook ends its first line with `; playbook <slug>`. Stored text is data, never terminal control: it is printed JSON-quoted, with control and bidi characters escaped or replaced.
- **`studio triggers on|off <id>`** turns a trigger on or off. The toggle sets `enabled_changed_by = owner` and `enabled_changed_at` and appends `trigger_toggled` with `by: owner`. A repeat is no change: nothing is written and no event is added. Turning a trigger off clears its next fire. Turning one on computes the next fire from now: a `cron` trigger does not fire the instants it missed while off, and a future `once` gets its own instant back.
- **A past-due `once`.** Turning on a `once` whose time has passed would fire it now, so it needs confirmation, like `studio session abandon`. The command asks on a terminal: `y`/`yes` proceeds, and anything else, or stdin ending, is a no (exit 1). With no terminal and no `--yes` it refuses with exit 2 instead of waiting. `--yes` skips the question. Once confirmed, the trigger fires on the next tick, under a new instant (now), so it gets a new work-step key.

The routes, reached only with the bearer token, are what the CLI calls and what the phase 7 Schedules screen will reuse:

- `GET /triggers[?all=1]` answers `{triggers: [...]}`.
- `POST /triggers/:id/on` takes the body `{"confirm": true}`. A past-due `once` without it gets `409 {"error":"needs_confirmation", "fires_at": …}` and nothing changes.
- `POST /triggers/:id/off`.
- Either toggle answers `{trigger, changed}`. A bad id is `400 invalid_id`, a body that is not a JSON object is `400 invalid_body`, and an unknown id is `404 not_found`.

## Audit events

Every register, remove, fire, miss, toggle and re-schedule appends exactly one event of its own `trigger_*` kind (actor `kernel`) in the same transaction as the change, so the change and its record commit or roll back together:

- `trigger_registered`: `trigger_id`, `owning_agent`, `kind`, `spec`, `action`, `text`, `created_by`, `next_fire_at`, and `playbook` when the trigger is linked to one. The row's `session_id` is the calling session.
- `trigger_removed`: `trigger_id`, `owning_agent`, `kind`, `spec`, `action`, `enabled`, `by: agent`.
- `trigger_fired`: `trigger_id`, `action`, `playbook` (the slug) and `playbook_id` (only for a trigger linked to an enabled playbook, whose fire queues the playbook's message), `scheduled_at` (the first due instant, the step's key), `latest_due_at`, `missed`, `missed_kill_switch` (only when non-zero), `missed_paused` (only when non-zero), `missed_at_least` (only when counting stopped), `enabled` (false for a spent `once`), `next_fire_at`, and `notification_id` or `queue_id`. A poll's has `trigger_id`, `action`, `playbook`, `playbook_id`, `scheduled_at`, `items`, `items_capped` and `items_found` (only when capped), `enabled` and `next_fire_at`.
- `trigger_missed`: `trigger_id`, `reason`, `scheduled_at`, `enabled`, `next_fire_at`. With `reason: kill_switch` it also has `latest_due_at` and `missed_kill_switch`, plus `missed_paused` when non-zero. With `reason: paused` it also has `latest_due_at` and `missed_paused`. `reason: already_done` means the instant's work step was already done and the trigger was moved past it. With `reason: playbook_not_enabled` it also has `playbook` (the slug), `playbook_status` (the status read, or null when the playbook is missing) and, for a time-based trigger, `latest_due_at`, plus `missed_at_least` when counting stopped. A poll adds three reasons ([misses](#misses-backoff-and-parking)): `connector_missing` (with `connector_status`, `client`, and `notification_id` on the first missing instant), `rate_limited` (with `repo` and `resets_at`) and `source_error` (with `repo`, `error`, and `status` or `message` when there is one). The full list of reasons: `kill_switch`, `paused`, `already_done`, `playbook_not_enabled`, `connector_missing`, `rate_limited`, `source_error`.
- `poll_item_queued`: one per item a poll queued: `trigger_id`, `playbook_id`, `item_ref`, `revision`, `queue_id`.
- `trigger_toggled`: `trigger_id`, `enabled`, `was_enabled`, `by` (`owner`), `next_fire_at`.
- `trigger_updated`: appended when an agent's own trigger is re-scheduled in place (`updateTriggerSpec`, same id; today only through a playbook's trigger change, see [playbooks](playbooks.md#the-linked-trigger)). `trigger_id`, `playbook` (only when linked), `kind`, `spec`, `previous_kind`, `previous_spec`, `enabled`, `rearmed: true` (only when a spent `once` was turned back on by the new schedule), `next_fire_at`, `by: agent`. The row's `session_id` is the calling session. A re-schedule to the stored kind and spec is no change: nothing is written and no event is added.

## Values

These sets are closed in code (`kernel/src/triggers/store.ts`), not by SQL:

- `kind`: `once`, `cron`, `poll` (a `poll` belongs to a playbook)
- `action`: `notify`, `wake_agent`
- `created_by`: `agent`, `owner`. Owner-created triggers come later; only agents create them now.
- `enabled_changed_by`: `owner`, `agent`, or null until someone toggles it. A spent `once` keeps it.
- `last_result`: `fired`, `missed_kill_switch`, `missed_paused`, `rate_limited`, `connector_missing`, `source_error` (the last three are a poll's)

The `spec_json` shapes are `once` `{at}`, `cron` `{cron, tz}` and `poll` `{source, repos, filters, interval_seconds}`. `action_payload` is the stored text.
