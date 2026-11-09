# Threads

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 06** (a thread route interleaves an agent's messages with one-line event cards), in the console's `threads.ts` part (`kernel/src/console/threads.ts`): the item shapes, the event list and the paging.

**Routes:** `GET /threads/:agent`; phase 8 item 17 adds `POST /threads/:agent/:thread/summarize`, `GET /threads/:agent/:thread/summary`, `POST /threads/:agent/:thread/start-fresh` and `POST /threads/:agent/:thread/rename` ([below](#phase-8-item-17-continuity-figures-titles-and-the-write-routes)).

**Contract types it fills** (`app/src/api/contract.ts`): `ThreadsQuery`, `ThreadItem` and `ThreadResponse`; item 17's `ThreadMessageFields`, `ThreadFigures`, `ThreadSummarizeResponse`, `ThreadSummaryResponse`, `ThreadStartFreshBody` / `ThreadStartFreshResponse` and `ThreadRenameBody` / `ThreadRenameResponse`.

Chat (Wright's thread) and each Crew thread render exactly one agent's thread (D25, and change 5 in [DESIGN.md](../DESIGN.md#what-the-review-changed-and-why)): what was said to and by the agent, and one-line cards for what the kernel did about it, with the agent's pending approvals at the end. `GET /threads/:agent` is a mechanism (invariant 1) and read-only: it writes nothing. Item 17's thread data lives in migration 22's tables ([brain](brain.md#threads)).

## The route

`GET /threads/:agent[?before=<cursor>][&limit=N]` answers JSON:

| Answer | When |
|---|---|
| `200 {items, next_before, pending_approvals, thread_summarize_hint_tokens, threads}` | A page of the thread (see [Paging](#paging)); the last two are item 17's ([below](#phase-8-item-17-continuity-figures-titles-and-the-write-routes)). |
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
| `trigger_registered`, `trigger_fired` | its payload's `trigger_id` names a trigger whose `owning_agent` is the agent | `Trigger 3 registered`, `Trigger 3 fired (notify)` |
| `draft_output_recorded` (tie `session`) | its `session_id`'s session has `sessions.agent` = the agent | one line naming the draft and its session (sentence in `threads.ts`) |
| `poll_item_skipped`, `poll_item_queued` (tie `playbook`) | its payload's `playbook_id` names a playbook whose `owning_agent` is the agent | one line naming the playbook and whether the item was skipped or queued (sentence in `threads.ts`) |
| `connector_status` (tie `owner`) | the agent is Wright (`ASK_AGENT`): a connector is the owner's, not an agent's, so it shows in Wright's thread only | one line naming the connector's new status (sentence in `threads.ts`) |

The last four kinds were added by the phase 6 foundation, with their ties, before any code writes them, so the items that write them (03 `connector_status`, 04 and 05 the poll kinds, 07 `draft_output_recorded`) and the item that draws their cards (12) never edit `threads.ts`. `owner` is the one tie that names no stored row: it puts the event in Wright's thread. See [integrations](integrations.md) and [draft mode](draft-mode.md).

`memory_updated` is not in the list: the kernel now writes that kind, but only for the owner's own writes (`PUT /memory/file`, payload `{path, by: "owner", size, content_hash}`, tied to no session or task), and it has no thread tie yet, so it stays out of `THREAD_EVENT_KINDS` (the gap with the approved design is logged in [open questions](../OPEN_QUESTIONS.md#deferred-decisions)). A new kind becomes a card only by adding it to `THREAD_EVENT_KINDS` with its tie (and its sentence beside the others in `threads.ts`).

### Summaries are escaped

Payloads and stored names are untrusted data (invariant 3). A summary is built from the kind and typed stored fields only: a field that is absent or of the wrong type (or a payload that is not JSON) leaves it out, for a generic sentence such as `Trigger 3 fired`, never a throw. Every stored string inside a summary (a playbook's slug, an approval's action, an agent's id or names, a setting's field, a status, a reason) passes through `shown` (`kernel/src/approvals/cli.ts`), the escaping the CLI uses: control characters, a newline included, become `\xNN` (`\n` for a newline) and bidi controls `\uNNNN`. So a summary is always one line and can't reorder or recolour what the app shows.

## Paging

The two sources share one order, by `(at, type, id)`: a message's `created_at` and an event's `at` are both ISO-8601 UTC text with milliseconds, so comparing them as text is comparing time (a row whose time some writer stored in another spelling sorts by its text, and paging stays exact because the cursor compares the same text); at the same instant an `event` sorts before a `message`, and then the lower id first. Every item has a distinct key, so the order is total.

- A page is the newest `limit` items (default 50, at most 200) strictly before the cursor, or the newest of all with no `before`, returned oldest first.
- `next_before` is the cursor for the page before it: the key of the page's oldest item, encoded. It is `null` when no older item remains, so following `next_before` until it is `null` reads every item exactly once, even when items share a timestamp.
- The cursor is opaque: the app passes back the `next_before` it got and never builds one. Today it is the base64url of the JSON `[at, type, id]`; a `before` that is not one, in its canonical spelling, is `400 invalid_before`, never a silent first page.
- A new item arriving between two page reads is newer than every cursor already handed out, so paging backwards never sees it or skips anything because of it; the app reads the newest page again (or follows the [event feed](feed.md)) to see it.

Each page reads at most `limit + 1` rows from each source, both newest first under the same strict `(at, type, id) <` cursor test, merges them and cuts at `limit`: the extra row tells whether an older item remains. `events` has no index on `kind` and `brain_messages` none on `agent` or `from_agent`, so each read scans its table's candidate rows; adding an index needs a migration, which is out of this item's scope.

## Phase 8 item 17: continuity, figures, titles and the write routes

Thread continuity itself (replies, references, the replay) is the brain's ([brain](brain.md#threads)); this part reads it and adds the owner's thread routes. Everything is in tokens, never dollars (D24).

**Message fields.** Every message item adds, after its row's fields (the contract's `ThreadMessageFields`): `thread_id`, its thread's id (the thread's first row's; a row with no thread data is its own thread); `continuation`, how its session continued the thread (`resumed`, `replayed`, or `null` for a first message and before a session starts); and `session_title`, the title its session carries (`null` when the row had no session).

**Thread figures.** `threads` holds one `ThreadFigures` per thread a message item of the page is in, by thread id: `{id, agent, title, renamed, messages, latest_reply_tokens, summary_estimated_tokens}`. `messages` is how many rows the thread holds. `latest_reply_tokens` is what the session of the thread's newest replied row read: input + cache-read + cache-write tokens over every model in its `sessions.model_usage_json` (D26's counting; output tokens are not context), `null` when no replied row has a reading. `summary_estimated_tokens` is the summary file's size (`memory/<agent>/threads/<thread>.md`, read at answer time) in characters divided by 4, rounded up: an ESTIMATE, as its name says, never a count; `null` when there is no summary file. `thread_summarize_hint_tokens` is the agent's owner setting of that name (an optional field of `config/agents/<id>.json`, which no session may write, D34), `null` when unset or the file is refused; the app highlights Summarize past it. The kernel never sets it.

**Titles.** `title` (and every `session_title`, and `GET /sessions`' and `GET /tasks/:kind/:id`'s `SessionSummary.title`) comes from one module, `kernel/src/brain/titles.ts`, derived at read time with no model call:

| Start kind | Title |
|---|---|
| Chat or Crew message | its first non-blank line, at most 80 characters (a longer one ends in `…`) |
| a reply (and a summary request) | its thread's title |
| a playbook run | the playbook's name (`sessions.playbook` → `playbooks.name`), never its id |
| a delegation | `From <agent>: <first line>` |
| a trigger's message | `Trigger #<id>: <first line>` |
| an approval's message | `Approval #<id>: <the approval's action>` |
| a fresh thread from a summary | the old thread's title marked ` (continued)` |
| a task's session | the task's title |
| any other session | `Session #<id>` |

The owner's rename wins over the derived title, for the thread and every session in it (a fresh thread started from it shows the rename marked continued). Every title is one line: control and bidi characters stripped, whitespace collapsed. No session start path writes a title, so playbook-run code is unchanged; the only stored title is the rename, `brain_threads.title`. A title is untrusted text shown to the owner, never put into a prompt, and no agent tool renames.

**The write routes** (`:thread` is a thread id; `400 invalid_thread` when it is not a positive integer, `404 no_such_thread` when it is not one of the agent's thread ids, `404 no_such_agent`):

| Route | Answers |
|---|---|
| `POST /threads/:agent/:thread/summarize` | `202 {message_id, queue_id, thread, file}`: queues one owner message continuing the thread's newest started row; its reply is written to `file`. It runs in the continued row's workspace, which must still be listed. `409` `kill_switch_engaged`, `agent_off`, `summary_exists {file}`, `summary_unreadable {file, problem}`, `nothing_to_summarize`, `workspace_not_listed`. |
| `GET /threads/:agent/:thread/summary` | `200 {thread, file, text, truncated}`: the file as it is on disk now. `404 no_summary {file}`, `409 summary_unreadable {file, problem}`. |
| `POST /threads/:agent/:thread/start-fresh` body `{summary?, text?}` | `202 {message_id, queue_id, thread, from, file}`: writes the owner's `summary` to the file when given, then starts a new thread quoting the file as data and marks the old one summarized into it. The new thread runs in the old thread's workspace (its newest started row's, else its first row's), which must still be listed. `400 invalid_body`; `409` `kill_switch_engaged`, `agent_off`, `already_started_fresh {summarized_into}`, `workspace_not_listed`, `no_summary {file}`, `summary_unreadable {file, problem}`, `history_too_large {thread, size, bound}`, `summary_unwritable {file, code}`. |
| `POST /threads/:agent/:thread/rename` body `{title}` | `200 {thread, title, renamed}`: stores the owner's title (one line, 1 to 80 characters after stripping), or clears it with `title: null`, and answers the thread's title now. Writes no event, queues nothing and starts no session. `400 invalid_body` (no `title`, not a string or null, blank, or over 80 characters, naming the size and the bound). |

An agent's session runs with its memory folder as its working directory, so it could plant a symbolic link there. The kernel never writes or reads a summary through one: a link at `memory/<agent>`, at `threads/` or at the file is refused (`symlink_refused`, also a file with more than one hard link: `hard_link_refused`), so the routes answer `summary_unreadable` / `summary_unwritable`, a summarize reply fails to save on its row, and a `summary` reference falls back to the thread's exchanges with the problem stated.

Summarize and start-fresh queue `message` events through `enqueueEvent`; the loop's handler starts the session (invariant 2). The rename is an owner metadata edit, so the kill switch and an `off` agent do not refuse it.
