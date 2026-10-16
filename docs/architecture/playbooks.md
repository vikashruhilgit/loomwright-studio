# Playbooks

A playbook is recurring work an agent does for the owner ("every weekday at 9, summarise what changed in repo X"), written down where the owner can read it, with every value about how it runs set by the owner. Code: `kernel/src/playbooks/` (this page covers the `drafts` part, `drafts.ts`, `store.ts` and `mirror.ts`). Tables: `playbooks` and `playbook_versions` (migration 13, see the [data model](../ARCHITECTURE.md#data-model)).

This is mechanism only (invariant 1). No playbook ships preinstalled. Wright drafts one and every policy value it gives is a proposal; the owner reads it, changes any value and turns it off at any time. A playbook starts as a `draft`. Enabling it after a dry run is item 07's ([dry runs](dry-run.md)); what a fire of an enabled playbook does is item 08's ([playbook runs](playbook-runs.md)). Until then no playbook starts work.

## Wright's tools

Four kernel tools. Their input is untrusted data, and every refusal is an error result whose text names the field or the problem, never a throw through the SDK. A refused call stores nothing: no row, no version, no trigger, no event, no work step, no mirror file. The owning agent is the calling session's agent; a session that runs no named agent is refused. Each tool acts only on the caller's own playbooks (`not_owner` otherwise).

- **`kernel_playbook_create(name, intent, trigger, dedupe_key?, priority?, model?, token_limit?, idempotency_key)`** stores a `draft` at version 1 and its linked trigger, and returns `{id, slug, status, version, trigger_id, next_fire_at, changed, mirror}` (`next_fire_at` in UTC, `mirror` the file's path under the data dir). It refuses, naming the field:
  - `name`: 1-200 characters, not blank, one line with no control character.
  - `intent`: not empty after trimming, at most 2000 characters, no NUL.
  - `trigger`: `{kind: once, spec}` or `{kind: cron, spec, tz}`, validated only by the triggers feature ([triggers](triggers.md)); its refusal comes back as `trigger: <message>`.
  - `dedupe_key`: a non-empty list of distinct fields from `playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at`, `date` (stored as a JSON array in `dedupe_key_spec`).
  - `priority`: `low`, `normal` or `high`. `model`: 1-200 characters with no whitespace or control character. `token_limit`: a positive whole number of tokens per day (`token_limit_per_day`).
- **`kernel_playbook_update(id, changes, idempotency_key)`** changes any of `name`, `intent`, `trigger`, `dedupe_key`, `priority`, `model`, `token_limit` (at least one). It refuses the same values as create, a policy field the owner set (the message names the field and says the owner set it), and a playbook the owner turned off.
- **`kernel_playbook_list()`** lists the caller's playbooks, every status, in id order, each with its linked `trigger_id` and `next_fire_at`.
- **`kernel_playbook_disable(id, idempotency_key)`** turns the caller's playbook off. It refuses one the owner turned off.

Create, update and disable run as a work step keyed `<tool>:session-<id>:<idempotency_key>`, so a repeat in the same session returns the first result. The exception, as for triggers: a repeat after the owner turned the playbook off returns the `owner_off` error, not the stored success.

## The owner's verbs and routes

The owner sees and changes every playbook, whoever drafted it. Each verb calls only its route on the loopback API (bearer token). Times are shown in the owner's local zone, and every stored string is printed quoted with control characters replaced, so text an agent wrote can't drive the owner's terminal.

| Verb | Route | Answer |
|---|---|---|
| `studio playbooks list [--all] [--json]` | `GET /playbooks[?all=1]` | `200 {playbooks}`: `draft` and `enabled` ones; `all=1` adds `disabled` |
| `studio playbooks show <id\|slug> [--json]` | `GET /playbooks/:ref` | `200 {playbook, versions: [{version, created_at}], trigger}`, or `404 not_found` |
| `studio playbooks set <id> <field> <value>` | `POST /playbooks/:id/set` body `{field, value}` | `200 {playbook, changed}`, or `400 {error: invalid_input, message}` naming the field |
| `studio playbooks off <id>` | `POST /playbooks/:id/off` | `200 {playbook, changed}` |

`set` takes `dedupe_key` (comma-separated fields), `priority`, `model` or `token_limit` (a decimal integer), and `none` clears a nullable field (`priority` can't be cleared). The verb checks the field and the value before calling the API: an unknown field, or a value the field refuses, is one stderr line naming it and exit 2, with nothing sent. Any other usage error is also one stderr line and exit 2. A refusal from the API is printed on stderr and exits 1. `400 invalid_id` / `invalid_body` and `404 not_found` follow the triggers routes.

## Versions

Every change is one transaction holding the row, its version snapshot, the linked trigger's change and exactly one audit event, so all of it commits or rolls back together.

- Create writes version 1 and its `playbook_versions` row.
- Every update or owner `set` that changes something makes the next version: `version` goes up by one, `updated_at` moves, and one `playbook_versions` row holds the full row after the change, every column, as `snapshot_json`. An `enabled` playbook goes back to `draft`, so the owner reviews a changed playbook before it runs again. A `disabled` one stays `disabled`.
- A change that changes nothing (the same values) writes nothing and returns `changed: false`.
- Turning a playbook off makes no version.

Audit events (actor `kernel`; `session_id` is the calling session for a tool, null for the owner). Payloads carry field names, never the free text an agent wrote; the snapshot holds the values.

- `playbook_created`: `{playbook_id, slug, owning_agent, version: 1, by: "wright", trigger_id}`
- `playbook_updated`: `{playbook_id, version, by, fields}`
- `playbook_disabled`: `{playbook_id, by}`

## Who set it

Each policy field has a `*_set_by` column. A value an agent gives records `wright`, shown as `(proposed)`; a value the owner sets records `owner`. An omitted field stays null with a null setter (`priority` keeps its default `normal`). The owner setting the value an agent proposed counts as a change: the field becomes the owner's. An agent can never overwrite a value the owner set; only the owner changes it. `effort` and the API-key fallback are not settable here ([budget](budget.md) owns the fallback).

## The owner's off

`studio playbooks off` sets `status = disabled` and records `playbook_disabled` with `by: owner`. There is no `disabled_by` column: who turned a playbook off is read from the append-only log, the newest `playbook_disabled` for it, as triggers read their toggles.

The owner's off is final for agents. An agent can't change, disable or re-enable a playbook the owner turned off, and `refuseIfOwnerTurnedOff(store, id)` (exported from `kernel/src/playbooks/store.ts`) is the one guard every agent path calls; item 07's `kernel_playbook_enable` must call it too. A `disabled` playbook counts as the owner's off unless the newest `playbook_disabled` for it is an agent's: a gap in the evidence never unlocks it. An agent's own off leaves the playbook the agent's to change. The owner turning off a playbook an agent already turned off records the owner's off (`changed: true`), so it becomes final. The owner may still `set` values on a disabled playbook: a new version, still disabled.

## The linked trigger

Each playbook has one trigger, registered through the triggers feature in the playbook's own transaction and linked by slug (`triggers.playbook`, migration 11). It is owned by the playbook's agent, with `action: wake_agent` and text `Playbook <slug>`. `studio triggers` lists it with `; playbook <slug>` on its block. A trigger change through `kernel_playbook_update` re-schedules the same row in place (`updateTriggerSpec`: same id, new kind, spec and next fire, one `trigger_updated` event), so a playbook never has a second linked trigger. A trigger that is off stays off when re-scheduled, with no next fire until it is turned on. If the agent removed the linked trigger, the next trigger change links a new one. The owner's off of the trigger itself is final for agents, as for any trigger.

**A linked trigger never starts work unless its playbook is `enabled`.** When its instant comes due and the playbook is `draft` or `disabled` (or missing), the instant is handled inside the same per-instant work step a fire would use (`trigger:<id>:<instant>`): no notification and no queue row, one `trigger_missed` event with `reason: playbook_not_enabled` and the slug, and the next fire scheduled as after a fire (a `cron` moves to its next future instant, a `once` is spent). Because the step is done, that instant is never fired later, even if the playbook is enabled afterwards. `last_result` is left as it was; it keeps its closed set. A trigger with no playbook fires exactly as before.

## Markdown mirror

Every playbook has a read-only markdown file at `<dataDir>/memory/playbooks/<slug>.md` (invariant 8: memory is inspectable files). The slug is derived once from the name at create (lowercase, runs of other characters become `-`, trimmed, cut to 48 characters, `playbook` when empty; a collision appends `-2`, `-3`, …) and never changes, so the file keeps its name across renames. It matches `^[a-z0-9][a-z0-9-]{0,63}$`, so it can't escape the directory.

The file holds, in order:

1. An H1 with the name.
2. A line saying the file is generated by the Studio kernel from its `playbooks` table and that edits here are not read.
3. Status and version.
4. The intent.
5. The trigger (`cron <expr> in <zone>` or `once at <instant>`) and its next fire in the owner's local time, as of when the file was written.
6. One line per policy field (dedupe key, priority, model, token limit per day, effort, API-key fallback) with its value or `not set`, followed by `(proposed)` when an agent set it.
7. `Last dry run: No dry run yet.` (item 07 fills it).

**Inert text.** Every stored string is data (invariant 3). A one-line value is a CommonMark code span whose backtick fence is one longer than its longest backtick run, and the intent is a fenced code block whose fence is longer than any backtick run inside it, so nothing an agent wrote becomes a live heading, link or HTML. Control characters (other than the intent's line breaks and tabs) and bidi overrides are written as `?`, so `cat`-ing the file can't drive a terminal.

**Rewritten after every change.** Each create, update, set and off rewrites the file after its transaction commits, for every status, `disabled` included. The write is atomic (a temp file, then a rename), and a file that already holds the same bytes is not rewritten. If the write fails, the change is still stored; the tool result or route answer carries a `mirror_error`.

**Resynced after a restart.** A crash between the row's commit and the file write leaves the file missing or stale. The drafts part's due work runs once per `Store` (each kernel start opens a new one): on its first tick it renders every playbook from its row and rewrites each file whose bytes differ. The row is the truth. It appends no event, and one playbook's failure doesn't stop the others; they are reported together as one `due_work_failed`.

**Edits are not read.** The kernel never reads the file back. Editing it changes nothing, and the next change or restart overwrites the edit. To change a playbook, use `studio playbooks set` or `off`.

The honest limit: the next fire in the file is the one at the last change or restart. A cron trigger's later instants move on without rewriting the file; `studio triggers` and `studio playbooks show` show the live schedule.
