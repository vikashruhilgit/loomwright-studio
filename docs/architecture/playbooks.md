# Playbooks

A playbook is recurring work an agent does for the owner ("every weekday at 9, summarise what changed in repo X"), written down where the owner can read it, with every value about how it runs set by the owner. Code: `kernel/src/playbooks/` (this page covers the `drafts` part, `drafts.ts`, `store.ts` and `mirror.ts`, and the `enable` part, `enable.ts`; the dry run, `dry-run.ts`, is on [dry runs](dry-run.md#a-playbooks-dry-run)). Tables: `playbooks` and `playbook_versions` (migration 13, see the [data model](../ARCHITECTURE.md#data-model)).

This is mechanism only (invariant 1). No playbook ships preinstalled. Wright drafts one and every policy value it gives is a proposal; the owner reads it, changes any value and turns it off at any time. A playbook starts as a `draft`; Wright dry-runs it and asks to enable it, and only the owner's approval enables it ([below](#enabling)). An enabled playbook runs when its linked trigger fires or the owner runs it now, under its own model, priority and dedupe key ([playbook runs](playbook-runs.md)).

**Statuses** (`PLAYBOOK_STATUSES`): `draft` (every new playbook, and every edited one), `enabled` (only through the owner-approved enable below), `disabled` (turned off by its agent or the owner).

## Wright's tools

Four kernel tools. Their input is untrusted data, and every refusal is an error result whose text names the field or the problem, never a throw through the SDK. A refused call stores nothing: no row, no version, no trigger, no event, no work step, no mirror file. The owning agent is the calling session's agent, unless Wright drafts for a crew member ([below](#crew-owned-playbooks)); a session that runs no named agent is refused. Each tool acts only on the caller's own playbooks, and Wright's also on a registered crew member's (`not_owner` otherwise).

- **`kernel_playbook_create(name, intent, trigger, dedupe_key?, priority?, model?, token_limit?, mode?, agent?, idempotency_key)`** stores a `draft` at version 1 and its linked trigger, and returns `{id, slug, status, version, trigger_id, next_fire_at, changed, mirror}` (`next_fire_at` in UTC, `mirror` the file's path under the data dir). It refuses, naming the field:
  - `name`: 1-200 characters, not blank, one line with no control character.
  - `intent`: not empty after trimming, at most 2000 characters, no NUL.
  - `trigger`: `{kind: once, spec}` or `{kind: cron, spec, tz}`, validated only by the triggers feature ([triggers](triggers.md)); its refusal comes back as `trigger: <message>`. A `poll` trigger (phase 6) is `{kind: poll, spec}` with the `PollSpec` as JSON text and no `tz`; its validation, refusals and per-item fire are in [poll triggers](triggers.md#poll-triggers).
  - `dedupe_key`: a non-empty list of distinct fields from `DEDUPE_KEY_FIELDS`: `playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at`, `date`, `item.id`, `item.revision` (stored as a JSON array in `dedupe_key_spec`). `item.id` and `item.revision` are a polled item's (phase 6): a key naming them is stored, the dry-run preview shows each as `<per item>`, a polled item's message fills them, and an event that carries no item (a time-based fire, a run now) refuses the key `dedupe_spec_invalid` rather than leaving the field out ([per-item runs](playbook-runs.md#per-item-runs)).
  - `priority`: `low`, `normal` or `high`. `model`: 1-200 characters with no whitespace or control character. `token_limit`: a positive whole number of tokens per day (`token_limit_per_day`). `mode`: one of `PLAYBOOK_MODES` (`draft` / `live`, default `draft`; migration 17), and only `draft` is accepted: `live` is refused `live_mode_not_in_phase_6` on every path, create, update and the owner's `set` ([draft mode](draft-mode.md)).
  - `agent` (optional, at most 64 characters): omitted, the playbook is the caller's. Only a Wright session may give it (any other caller: `agent: only Wright drafts a playbook for another agent`); `wright` is Wright itself; otherwise it must be an `active` registered crew member: an `off` one is `agent_off: <id> is off; turn it on before drafting its playbooks`, anything else `agent: "<id>" is not an active registered crew member`.
- **`kernel_playbook_update(id, changes, idempotency_key)`** changes any of `name`, `intent`, `trigger`, `dedupe_key`, `priority`, `model`, `token_limit`, `mode` (at least one). It refuses the same values as create, a policy field the owner set (the message names the field and says the owner set it), and a playbook the owner turned off.
- **`kernel_playbook_list()`** lists the caller's playbooks, every status, in id order, each with its `owning_agent`, its linked `trigger_id` and `next_fire_at`. For Wright it also lists every registered crew member's (`active` or `off`), never an unregistered agent id's.
- **`kernel_playbook_disable(id, idempotency_key)`** turns the caller's playbook off. It refuses one the owner turned off.

Create, update and disable run as a work step keyed `<tool>:session-<id>:<idempotency_key>`, so a repeat in the same session returns the first result. The exception, as for triggers: a repeat after the owner turned the playbook off returns the `owner_off` error, not the stored success. Likewise the crew checks run before the step on every call: a repeat from a crew session is `crew_cannot_draft`, and a repeat of a create for a crew member that has been turned off since is `agent_off`, not the stored success.

Two more tools come from the other parts: `kernel_playbook_dry_run(id, idempotency_key)` ([dry runs](dry-run.md#a-playbooks-dry-run)) and `kernel_playbook_enable(id, idempotency_key)` ([below](#enabling)).

## Crew-owned playbooks

A crew member's scheduled duty is a playbook the member owns (`owning_agent` is its id), bounded by the member's own policy, `never` list and limits rather than Wright's (phase 4 item 08). Code: one rule in `kernel/src/playbooks/drafts.ts` that every part uses. "Crew member" here always means a row in the `agents` table ([agents](agents.md)): an agent id with no row is not crew, its own playbooks stay its own, and Wright's checks against them stay `not_owner`.

- **Wright drafts, the member runs.** Wright drafts a playbook for an `active` crew member with create's `agent`; its linked trigger is owned by the member too, and `playbook_created` names it as `owning_agent`. The playbook's dry run and every fire and run now run as the member ([dry runs](dry-run.md#a-playbooks-dry-run), [playbook runs](playbook-runs.md#the-run)).
- **A crew member never drafts.** A session whose agent is a registered crew member is refused `crew_cannot_draft` by `kernel_playbook_create`, `kernel_playbook_update`, `kernel_playbook_disable`, `kernel_playbook_dry_run` and `kernel_playbook_enable` (the text is `<tool>: crew_cannot_draft: crew members don't draft playbooks; Wright drafts a crew member's playbooks`), before anything is written; for the enable, the gate's pre-hold check refuses it, so nothing is held. `kernel_playbook_list` still answers a member with its own playbooks.
- **Wright manages its crew's playbooks.** `kernel_playbook_update`, `kernel_playbook_disable`, `kernel_playbook_dry_run` and `kernel_playbook_enable` from Wright act on any registered crew member's playbook as on its own, `active` or `off` member alike (an `off` member's playbook can still be listed, updated or disabled; its dry run and fires refuse `agent_off`). Every value Wright gives is still a proposal (`*_set_by = 'wright'`), and the owner's off is still final.

The refusals this adds, beside `not_owner` and `owner_off`: `crew_cannot_draft` (a crew session called a drafting tool) and `agent_off` (the member a playbook is for is `off`: at create, at the dry run, and as a fire's run-row error).

## Enabling

Enabling is Wright's request and the owner's one approval (D3, invariant 3). Code: `kernel/src/playbooks/enable.ts`. `kernel_playbook_enable` is in the fixed `ALWAYS_HELD_TOOLS` set, so the kernel's gate holds every call for the owner, and in `KERNEL_APPLIED_ACTIONS`, so the owner's approval enables it: the kernel applies the held call itself ([approvals: kernel-applied actions](approvals.md#kernel-applied-actions)). Wright never repeats the call. The tool's part only narrows the hold, and gives the kernel the checks and the enable.

**Before the hold** (the tool's `beforeHold`, [the pre-hold check](approvals.md#the-pre-hold-check)). The call is refused, with no approval written, when the caller is a crew member (`crew_cannot_draft`), when the playbook is missing, not one the caller may manage (its own, or for Wright a registered crew member's), turned off by the owner or not a `draft`, when its idempotency key already has a work step in this session (an earlier enable used it; the refusal says `idempotency_key already used for an enable in this session; use a new key`), or when its current version has no dry run that ended `done` (the refusal says `a dry run of version <n> is required`). Otherwise it is held with a display that `studio approvals` prints: the playbook's name, slug and id, `version <n>`, its agent and schedule, every policy value (`model`, `priority`, `dedupe_key`, `token_limit`, `effort`, `api_key_fallback`) or `not set`, each marked ` (proposed)` where Wright set it and ` (set by owner)` where the owner did, and the dry run's summary. The version is recorded on the approval as `subject_version`.

**On the owner's approval** (the tool's `applyOnApproval`, run by the approvals decision when the owner answers `once`, inside the decision's transaction). `enableApproved` checks, in this order, and enables nothing on the first that fails:

1. the playbook exists (`not_found`);
2. the requesting agent, as the approval's `approval_requested` event names it, is not a registered crew member (`crew_cannot_draft`: a defence, since the pre-hold check never holds a crew session's call);
3. the playbook is the requesting agent's, or the requesting agent is Wright and the playbook is a registered crew member's (`not_owner`);
4. the owner did not turn it off (`turned_off_by_owner`);
5. it is a `draft` (`not_draft`);
6. the approval's `subject_version` is the playbook's current version, and no `playbook_updated` for the playbook has a higher event id than the approval's `approval_requested` (event ids only grow, so a same-second edit is still seen) (`version_changed`);
7. the current version has a `done` dry run (`no_dry_run`).

Then `enablePlaybook` sets `status = 'enabled'`, only while the row is still a `draft` at that version, and appends `playbook_enabled`, linked to the requesting session. The approval records `applied: The kernel enabled playbook <slug> (#<id>) at version <n> on approval <id>.`, Wright's message says so and `Nothing to repeat.`, and the mirror is rewritten once the decision committed. A refusal is recorded on the approval (`apply_refused` with the reason above, and `apply_detail: The kernel did not enable playbook <slug> (#<id>): <reason> (<detail>).`) and said in Wright's message with `Do not repeat the call.`; the playbook stays as it was. Either way the kernel records the owner's grant as used, so no later call spends it.

**The handler: a defence path only.** It runs only when the gate let a call through on a one-shot grant, which the kernel's own use never leaves (a composition that decides with no applier). A retry after the kernel enabled the playbook is refused before the hold: it is no longer a `draft`. The handler enables only on its **own** approval: the newest approval consumed (`approval_used`) in this session for this tool, held by the rail, whose held input named this playbook and this idempotency key. Two enables in one session never borrow each other's approval, and with none the call is refused. Then it runs the same checks and enable (`enableApproved`) inside the tool's work step, and refuses the checks' failures with the texts it always gave (`version changed: …`). Each request to the owner needs a new idempotency key: the key's step stores this result, so after an edit returns the playbook to `draft`, a same-key call would only replay it. The pre-hold check therefore refuses a used key (no approval written), and as a defence behind it the handler replays a `done` step only when its stored result is for this playbook and its stored `approval_id` is this call's own consumed approval. A key is scoped to the session, not to a playbook: a stored result for another playbook is refused naming that playbook (`idempotency_key already used in this session for the enable of playbook <a>; use a new key to ask again for playbook <b>; nothing was enabled`), and when a newer approval was consumed for the key, it refuses (`its stored result is for approval <a>, not approval <b>; nothing was enabled`). Either way it never returns the old result as this call's success. The owner's off is re-checked after the step and the mirror rewritten, as for the other tools. An edit after the request makes a new version: the owner's approval of the old one is refused `version_changed`, and the playbook needs a new dry run and a new approval. Wright's same call is then refused before the hold when the new version has no dry run, and otherwise held as a new approval (the kernel already used the old grant). An edit of an `enabled` playbook makes it a `draft` again (below). The linked trigger is not touched: it already exists, and item 08 makes it fire.

## The owner's verbs and routes

The owner sees and changes every playbook, whoever drafted it. Each verb calls only its route on the loopback API (bearer token). Times are shown in the owner's local zone, and every stored string is printed quoted with control characters replaced, so text an agent wrote can't drive the owner's terminal.

| Verb | Route | Answer |
|---|---|---|
| `studio playbooks list [--all] [--json]` | `GET /playbooks[?all=1]` | `200 {playbooks}`: `draft` and `enabled` ones; `all=1` adds `disabled` |
| `studio playbooks show <id\|slug> [--json]` | `GET /playbooks/:ref` | `200 {playbook, versions: [{version, created_at}], trigger}`, or `404 not_found` |
| `studio playbooks set <id> <field> <value>` | `POST /playbooks/:id/set` body `{field, value}` | `200 {playbook, changed}`, or `400 {error: invalid_input, message}` naming the field |
| `studio playbooks off <id>` | `POST /playbooks/:id/off` | `200 {playbook, changed}` |
| `studio playbooks run <id>` | `POST /playbooks/:id/run` | `200 {queue_id, created, playbook, version, scheduled_at}`, or `409 not_enabled` (see [playbook runs](playbook-runs.md#what-fires-a-playbook)) |

`set` takes `dedupe_key` (comma-separated fields), `priority`, `model`, `token_limit` (a decimal integer) or `mode` (`draft` only: `live` is refused `live_mode_not_in_phase_6`, by the verb before calling the API and by the route as `409 {error: live_mode_not_in_phase_6, message}`), and `none` clears a nullable field (`priority` and `mode` can't be cleared). The verb checks the field and the value before calling the API: an unknown field, or a value the field refuses, is one stderr line naming it and exit 2, with nothing sent. Any other usage error is also one stderr line and exit 2. A refusal from the API is printed on stderr and exits 1. `400 invalid_id` / `invalid_body` and `404 not_found` follow the triggers routes.

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
- `playbook_dry_run`: `{playbook_id, version, run_id, status, tokens, would_do}` (`would_do` is the count; [dry runs](dry-run.md#a-playbooks-dry-run))
- `playbook_enabled`: `{playbook_id, version, approval_id, by: "owner"}` (the owner approved it; the kernel carried it out in the decision, linked to the requesting session)

## Who set it

Each policy field has a `*_set_by` column. A value an agent gives records `wright`, shown as `(proposed)`; a value the owner sets records `owner`. An omitted field stays null with a null setter (`priority` keeps its default `normal`, and `mode` its default `draft`, with `mode_set_by` null). The owner setting the value an agent proposed counts as a change: the field becomes the owner's. An agent can never overwrite a value the owner set; only the owner changes it. `effort` and the API-key fallback are not settable here ([budget](budget.md) owns the fallback).

## The owner's off

`studio playbooks off` sets `status = disabled` and records `playbook_disabled` with `by: owner`. There is no `disabled_by` column: who turned a playbook off is read from the append-only log, the newest `playbook_disabled` for it, as triggers read their toggles.

The owner's off is final for agents. An agent can't change, disable or re-enable a playbook the owner turned off, and `refuseIfOwnerTurnedOff(store, id)` (exported from `kernel/src/playbooks/store.ts`) is the one guard every agent path calls, `kernel_playbook_dry_run` and `kernel_playbook_enable` included. A `disabled` playbook counts as the owner's off unless the newest `playbook_disabled` for it is an agent's: a gap in the evidence never unlocks it. An agent's own off leaves the playbook the agent's to change. The owner turning off a playbook an agent already turned off records the owner's off (`changed: true`), so it becomes final. The owner may still `set` values on a disabled playbook: a new version, still disabled.

## The linked trigger

Each playbook has one trigger, registered through the triggers feature in the playbook's own transaction and linked by slug (`triggers.playbook`, migration 11). It is owned by the playbook's agent, with `action: wake_agent` and text `Playbook <slug>`. `studio triggers` lists it with `; playbook <slug>` on its block. A trigger change through `kernel_playbook_update` re-schedules the same row in place (`updateTriggerSpec`: same id, new kind, spec and next fire, one `trigger_updated` event), so a playbook never has a second linked trigger. A `once` that is off only because it was spent (it fired, or its instant was recorded as a miss, such as `playbook_not_enabled`) is re-armed by the new schedule: the same row is turned back on with the new next fire, and an instant it already fired or recorded is refused. A trigger that someone turned off stays off when re-scheduled, with no next fire until it is turned on. If the agent removed the linked trigger, the next trigger change links a new one. The owner's off of the trigger itself is final for agents, as for any trigger.

**A linked trigger never starts work unless its playbook is `enabled`.** When its instant comes due and the playbook is `draft` or `disabled` (or missing), the instant is handled inside the same per-instant work step a fire would use (`trigger:<id>:<instant>`): no notification and no queue row, one `trigger_missed` event with `reason: playbook_not_enabled` and the slug, and the next fire scheduled as after a fire (a `cron` moves to its next future instant, a `once` is spent). Because the step is done, that instant is never fired later, even if the playbook is enabled afterwards. `last_result` is left as it was; it keeps its closed set. When the playbook is `enabled`, the fire queues the playbook's message instead of the stored text ([playbook runs](playbook-runs.md)). A trigger with no playbook fires exactly as before.

## Markdown mirror

Every playbook has a read-only markdown file at `<dataDir>/memory/playbooks/<slug>.md` (invariant 8: memory is inspectable files). The slug is derived once from the name at create (lowercase, runs of other characters become `-`, trimmed, cut to 48 characters, `playbook` when empty, `playbook-<digits>` when it is all digits, because a ref of only digits is read as an id; a collision appends `-2`, `-3`, …) and never changes, so the file keeps its name across renames. It matches `^[a-z0-9][a-z0-9-]{0,63}$`, so it can't escape the directory.

The file holds, in order:

1. An H1 with the name.
2. A line saying the file is generated by the Studio kernel from its `playbooks` table and that edits here are not read.
3. Status and version, then `- Agent: <id>` for a crew member's playbook (a Wright playbook's file has no agent line, byte for byte as before).
4. The intent.
5. The trigger (`cron <expr> in <zone>` or `once at <instant>`) and its next fire in the owner's local time, as of when the file was written.
6. One line per policy field (dedupe key, priority, model, token limit per day, effort, API-key fallback) with its value or `not set`, followed by `(proposed)` when an agent set it.
7. The last dry run: `Last dry run: <summary>` (the newest dry run of the current version that ended `done`, as one inert code span), `Last dry run: No dry run of version <n> yet.` when only earlier versions have one, or `Last dry run: No dry run yet.` ([dry runs](dry-run.md#a-playbooks-dry-run)). A resync renders it from the stored runs too, so a restart never wipes it.

**Inert text.** Every stored string is data (invariant 3). A one-line value is a CommonMark code span whose backtick fence is one longer than its longest backtick run, and the intent is a fenced code block whose fence is longer than any backtick run inside it, so nothing an agent wrote becomes a live heading, link or HTML. Control characters (other than the intent's line breaks and tabs) and bidi overrides are written as `?`, so `cat`-ing the file can't drive a terminal.

**Rewritten after every change.** Each create, update, set, off, dry run and enable rewrites the file after its transaction commits, for every status, `disabled` included. The write is atomic (a temp file, then a rename), and a file that already holds the same bytes is not rewritten. If the write fails, the change is still stored; the tool result or route answer carries a `mirror_error`.

**Resynced after a restart.** A crash between the row's commit and the file write leaves the file missing or stale. The drafts part's due work runs once per `Store` (each kernel start opens a new one): on its first tick it renders every playbook from its row and rewrites each file whose bytes differ. The row is the truth. It appends no event, and one playbook's failure doesn't stop the others; they are reported together as one `due_work_failed`.

**Edits are not read.** The kernel never reads the file back. Editing it changes nothing, and the next change or restart overwrites the edit. To change a playbook, use `studio playbooks set` or `off`.

The honest limit: the next fire in the file is the one at the last change or restart. A cron trigger's later instants move on without rewriting the file; `studio triggers` and `studio playbooks show` show the live schedule.
