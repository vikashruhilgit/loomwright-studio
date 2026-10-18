# Delegation

One agent hands work to another through one kernel tool, `kernel_agent_message` (phase 4 item 06, D7, D8). Code: `kernel/src/agents/delegate.ts`, the `delegate` part of the [agents](agents.md) feature. Tests: `kernel/test/agents-delegation.test.ts`.

Delegation is a kernel mechanism, never a session the sender owns (invariant 2). The tool queues a message and returns. The target's own session runs later, under the target's own charter, model, policy and limits, and its reply comes back as a new message. It is not held for approval (owner decision): the target's own policy and the rail decide every action the target takes. The loop guard is a chain depth that the owner sets per agent. The kernel picks no limit (invariant 1).

## The tool

`kernel_agent_message(agent, text, workspace?, idempotency_key)`

| Argument | Rule |
|---|---|
| `agent` | 1-64 characters. `wright` or a registered crew member's id, never the caller's own. |
| `text` | 1-8000 characters. A NUL is refused at argument validation, as `kernel_notify` refuses one. Stored as given: it is untrusted data (invariant 3). |
| `workspace` | Optional. It must be an exact member of the TARGET's settings `workspaces` (`config/agents/<id>.json`), so a bad one is refused before anything is queued. |
| `idempotency_key` | 1-200 characters. |

On success it queues one `message` event with the payload `{agent, text, from_agent, depth, workspace?}` (`workspace` only when given), linked to the calling session. In the same work step it appends one `agent_message_queued` event. It returns `{queue_id, agent, depth, note}`, where `note` tells the model that the reply arrives later as a new message and that it should end its turn. It never waits for the reply. No `message_id` is returned, because no `brain_messages` row is written here: the receiving side writes it (item 05).

The success is one work step keyed `kernel_agent_message:session-<id>:<key>`. The queue row and the `agent_message_queued` event commit together, so a repeat with the same key returns the first result and queues nothing, even when other arguments differ. A repeat is answered from the stored step before any check runs, so a delegation that was queued is never reported as refused later, for example after the target was turned off.

## The checks

They run in this order. The first one that fails refuses the call:

| Reason | When |
|---|---|
| `no_agent` | The calling session has no agent. |
| `self_delegation` | The target is the caller. |
| `no_such_agent` | The target is neither `wright` nor a registered crew member (an unknown, invalid or reserved id). |
| `agent_off` | The target is registered but `off`. |
| `workspace_not_listed` | A `workspace` was given and it is not exactly one of the target's settings `workspaces`. Unreadable target settings, or none listed, also refuse it. Wright's file never lists workspaces, so a delegation to Wright with a workspace is always refused. |
| `delegation_depth` | The caller's own `limits.delegation_depth` is set and the new depth exceeds it. |

In code the six reasons are one frozen list, `DELEGATION_REFUSALS` in `delegate.ts`. The tool description is built from it, and `agents-delegation.test.ts` pins both the list and the description, so the table above is the only restated copy.

A refusal is an error result whose text starts with the reason (`delegation_depth: wright may delegate to depth 1; this delegation would be depth 2; nothing was queued`). Nothing is queued. The handler throws `DelegationRefused` (its `reason` is the code) and the tool server turns that into the error result. Before the throw, one `agent_message_refused` event is committed in its own transaction, so the audit row survives the refusal.

A refusal is not a work step. A refused call repeated with the same key is checked again, not replayed, so it can succeed once the cause is gone (the owner turned the target back on, for example).

## Depth

Every delegation carries its chain depth.

- The caller's depth is that of the message its session is handling: the `depth` of the newest `brain_messages` row with this `session_id`. An owner's message is 0. A session with no message row (a playbook fire, a dry run) counts 0.
- The new delegation's depth is the caller's depth plus 1.
- The limit is the CALLER's own `limits.delegation_depth`, read through the one settings reader (`readAgentSettings`). The target's limit plays no part. The delegation is refused when its depth is greater than the limit, so a limit of 1 allows a depth 1 delegation and refuses depth 2.
- Unset means no limit. Caller settings that do not read `ok` (a missing or invalid file, or no model) also mean no limit. The kernel never guesses a value. A caller whose settings do not read `ok` cannot have a session started from them, but a session already running when its caller's settings become invalid (the owner edits the file mid-session) delegates without a limit until it ends. That gap closes at the caller's next message: the brain refuses to start a session from an invalid settings file (`settings_invalid`), so the caller does not run, or delegate, again until the owner fixes the file. Targets it already delegated to run under their own settings and limits.
- A reply (item 05) keeps the delegation's depth, so a reply-handling session that delegates again goes one level deeper.

A worked chain, with Wright's `limits.delegation_depth` unset:

| Step | Message | Depth |
|---|---|---|
| 1 | The owner asks Wright: "review PR 12". | 0 |
| 2 | Wright, handling it, delegates to Mason. | 1 |
| 3 | Mason replies to Wright (item 05). | 1 |
| 4 | Wright, handling the reply, delegates to Mason again. | 2 |

With Wright's `limits.delegation_depth: 1`, step 2 is queued (depth 1 does not exceed 1) and step 4 is refused `delegation_depth`.

### One notify per refused chain

A `delegation_depth` refusal also records one notification through `recordNotification`, source `kernel:delegation_depth`. Its body names the caller, the target and the limit. The notification is a work step keyed on the caller's message row, `kernel_agent_message:depth-notify:message-<row id>`. Repeated refused attempts while handling that message (with any key) append one `agent_message_refused` event each, but notify only once. A different message row is a different chain and notifies once more. The fallback key, `kernel_agent_message:depth-notify:session-<id>` for a session with no message row, is never reached today: such a session's delegations are depth 1, and a limit is at least 1.

## Wright's `delegation_depth`

Wright's `wright.json` reads its `limits`: this tool applies `delegation_depth` to Wright's delegations, and the budget applies `tokens_per_day` and `sessions_at_once` at admission ([budget](budget.md)), so `{"limits": {"delegation_depth": 1}}` reads `ok`, alone or beside the other two. It still refuses `never` and `workspaces`, because nothing applies them to Wright's sessions yet (see [the brain](brain.md)). `readWrightSettings` still returns only its five settings.

## Events

| Event | Payload | When |
|---|---|---|
| `agent_message_queued` | `{from, to, depth, queue_id}` | A delegation was queued, in the same step as the queue row (with its own `event_enqueued`). |
| `agent_message_refused` | `{from, to, depth, reason}` | Each refused call. `from` is null for `no_agent`, and `depth` is the depth the delegation would have had. |
| `notification_created` | `{id, source: "kernel:delegation_depth"}` | The first `delegation_depth` refusal of a chain. |

Each event is linked to the calling session.

## Honest limits

- **The receiving side is the brain's** ([routing](brain.md#routing)). The brain handler runs the delegation in the target's own session (its own charter, memory, settings and workspace), wraps the text as untrusted data from `agent:<sender>`, and queues exactly one reply (or failure) back to the sender, with the same depth and `reply_to` set; a reply is never replied to. A target turned `off` (or gone) after the delegation was queued fails its row `agent_off` (or `no_such_agent`) when the message is handled, and that failure is what goes back.
- **The depth guard rests on the row's depth.** The caller's depth is read from its `brain_messages` row; the receiving side copies the queued `payload.depth` and `from_agent` onto the row (`ensureBrainMessage`, `kernel/src/brain/messages.ts`), and a reply keeps the delegation's depth, so the chain does not restart at a Wright hop. A row written another way (`studio ask`, a trigger) is depth 0.
- **A crew member may delegate too** once its sessions run and its policy lists the tool. The depth check applies to it in the same way, against its own `limits.delegation_depth`.
- **Depth bounds a chain, not the total work.** Many delegations at the same depth are all allowed. Only the token limits (`limits.tokens_per_day`, and the shared weekly cap) bound total work.
- **The text is not checked beyond its length and the NUL.** It is stored as given and is never instructions to the kernel.
- **The workspace check is an exact string match** against the target's listed workspaces: a trailing slash or a sub-folder is refused. The target's settings reader has already refused a listed workspace that is relative, inside a macOS-protected folder, or the data dir.
