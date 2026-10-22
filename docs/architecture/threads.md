# Threads

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 06** (a thread route interleaves an agent's messages with one-line event cards), in the console's `threads.ts` part (`kernel/src/console/threads.ts`): the item shapes, the event list and the paging.

**Routes:** `GET /threads/:agent`.

**Contract types it fills** (`app/src/api/contract.ts`): `ThreadsQuery`, `ThreadItem` and `ThreadResponse`.

Chat (Wright's thread) and each Crew thread render exactly one agent's thread (D25, and change 5 in [DESIGN.md](../DESIGN.md#what-the-review-changed-and-why)): what was said to and by the agent, and one-line cards for what the kernel did about it, with the agent's pending approvals at the end. The route is a mechanism (invariant 1) and read-only: it writes nothing and adds no table, column or index.

## The route

`GET /threads/:agent[?before=<cursor>][&limit=N]` answers JSON:

| Answer | When |
|---|---|
| `200 {items, next_before, pending_approvals}` | A page of the thread (see [Paging](#paging)). |
| `400 {error: "invalid_limit"}` | `limit` is not a whole number from 1 to 200 written in digits. |
| `400 {error: "invalid_before"}` | `before` is not a cursor this route wrote. |
| `404 {error: "no_such_agent"}` | `:agent` is neither `wright` nor a registered crew member (`active` or `off`: an `off` member's thread is still readable). |

The query is checked before the agent, as `POST /ask` checks its body first. `pending_approvals` is every `pending` approval whose `requesting_agent` is the agent, oldest first, each as `GET /approvals` shows one; it is the same on every page.

## Items

Every item is one of two shapes (the contract's `ThreadItem`):

- **A message:** `{type: "message", …row}`, one `brain_messages` row with all its fields, for every row whose `agent` or `from_agent` is the agent. A delegation from Wright to `mason` is the row `agent: "mason", from_agent: "wright"`, so it is in both threads; its `from_agent` marks it, in Wright's thread, as what Wright sent. `text`, `reply_text` and `detail` are untrusted data, passed on as stored.
- **An event card:** `{type: "event", id, at, kind, summary, ref}`, one `events` row. `summary` is one kernel-written line; `ref` names the row the event is about (`{session_id}`, `{playbook_id}`, `{approval_id}`, `{agent_id}` or `{trigger_id}`, `null` when the payload lacks it) and is never the payload itself.

### The event kinds

Only the kinds in the closed list `THREAD_EVENT_KINDS` are cards, each tied to an agent as follows. Any other kind (for example `session_output_appended`) is never a card, and neither is an event tied to another agent.

| Kind | Tied to the agent when | Summary (example) |
|---|---|---|
| `session_status` | its `session_id`'s session has `sessions.agent` = the agent, and its payload's `to` is `running` (a start) or a terminal status (`isTerminalStatus`: an end) | `Session 4 started`, `Session 4 ended: failed (result_error)` |
| `playbook_created`, `playbook_updated`, `playbook_enabled`, `playbook_disabled` | its payload's `playbook_id` names a playbook whose `owning_agent` is the agent | `Playbook triage created (version 1)` |
| `approval_requested`, `approval_decided` | its payload's `id` names an approval whose `requesting_agent` is the agent | `Approval 7 requested: open_pr`, `Approval 7 denied: open_pr` |
| `agent_created`, `agent_renamed`, `agent_settings_set`, `agent_status_changed` | its payload's `id` is the agent | `Agent mason renamed from Mason to Stone` |
| `trigger_fired` | its payload's `trigger_id` names a trigger whose `owning_agent` is the agent | `Trigger 3 fired (notify)` |

`memory_updated` is not in the list: no kernel code writes that kind today, and this item adds no event kind (the gap with the approved design is logged in [open questions](../OPEN_QUESTIONS.md#deferred-decisions)). A new kind becomes a card only by adding it to `THREAD_EVENT_KINDS` with its tie (and its sentence beside the others in `threads.ts`).

### Summaries are escaped

Payloads and stored names are untrusted data (invariant 3). A summary is built from the kind and typed stored fields only: a field that is absent or of the wrong type (or a payload that is not JSON) leaves it out, for a generic sentence such as `Trigger 3 fired`, never a throw. Every stored string inside a summary (a playbook's slug, an approval's action, an agent's id or names, a setting's field, a status, a reason) passes through `shown` (`kernel/src/approvals/cli.ts`), the escaping the CLI uses: control characters, a newline included, become `\xNN` (`\n` for a newline) and bidi controls `\uNNNN`. So a summary is always one line and can't reorder or recolour what the app shows.

## Paging

The two sources share one order, by `(at, type, id)`: a message's `created_at` and an event's `at` are both ISO-8601 UTC text with milliseconds, so comparing them as text is comparing time (a row whose time some writer stored in another spelling sorts by its text, and paging stays exact because the cursor compares the same text); at the same instant an `event` sorts before a `message`, and then the lower id first. Every item has a distinct key, so the order is total.

- A page is the newest `limit` items (default 50, at most 200) strictly before the cursor, or the newest of all with no `before`, returned oldest first.
- `next_before` is the cursor for the page before it: the key of the page's oldest item, encoded. It is `null` when no older item remains, so following `next_before` until it is `null` reads every item exactly once, even when items share a timestamp.
- The cursor is opaque: the app passes back the `next_before` it got and never builds one. Today it is the base64url of the JSON `[at, type, id]`; a `before` that is not one, in its canonical spelling, is `400 invalid_before`, never a silent first page.
- A new item arriving between two page reads is newer than every cursor already handed out, so paging backwards never sees it or skips anything because of it; the app reads the newest page again (or follows the [event feed](feed.md)) to see it.

Each page reads at most `limit + 1` rows from each source, both newest first under the same strict `(at, type, id) <` cursor test, merges them and cuts at `limit`: the extra row tells whether an older item remains. `events` has no index on `kind` and `brain_messages` none on `agent` or `from_agent`, so each read scans its table's candidate rows; adding an index needs a migration, which is out of this item's scope.
