# 06 — Wright delegates to a crew member with `kernel_agent_message`, within a chain depth the owner sets

## Status: ready

**Priority:** MVP · ROADMAP phase 4 · D8 ("a chief-of-staff lead with specialists", D7), invariants 1, 2

**As** the owner,
**I want** Wright to hand work to a crew member through one kernel tool, with a chain-depth limit I set,
**so that** Wright leads the crew without ever acting as them, and a delegation loop can't run all night against the shared weekly cap.

## Problem

Wright has no way to reach another agent. A delegation must be a kernel mechanism: Wright changes the world only through kernel tools (ARCHITECTURE, Three layers). It must never be a session Wright owns, because an LLM never owns a lifecycle (invariant 2). Item 01 defines the message contract (`from_agent`, `depth`, `reply_to`, `workspace`) and the empty `delegate.ts` part. Item 05 handles the queued message on the receiving side and returns the reply.

## Owner decisions (2026-10-18, binding)

Recorded 2026-10-18 in the product-owner session (every option the owner chose was the one proposed). Each item carries this copy.

- **Creation from chat = a held tool the kernel applies.** Wright drafts a charter from the owner's sentence and calls `kernel_agent_create`. The gate always holds it, and `studio approvals` shows the whole charter. The owner's `once` makes the kernel create the agent itself, as a kernel-applied action: phase 3 item 10's lesson is that an approved state change never depends on a model retrying a call. The owner can also create a member from a charter file of their own: `studio agents create --from <file>`. No role presets (D22, invariant 9).
- **Storage = role.md + a config JSON + a table row.** `memory/<id>/role.md` is the prose charter the agent reads: identity, persona, duties, boundaries. `config/agents/<id>.json` holds the enforced settings in `wright.json`'s shape: model, effort, permission mode, tool policy, the `never` list, limits and workspaces. It sits under `config/`, which no session may write. An `agents` table row is the registry: id, display name, avatar, status. The kernel enforces only the JSON and the table, never the prose.
- **Changes = the owner directly; Wright only proposes.** The owner changes a member's settings by editing the file or with `studio agents set`. Wright may propose a change with `kernel_agent_update`, which is always held and applied by the kernel on the owner's `once`. A crew member can never change its own settings or anyone else's.
- **Limits (D24) are optional, and unset means no limit.** `limits.tokens_per_day` and `limits.sessions_at_once`. Wright proposes values in a draft (shown as proposed), and the kernel picks none (invariant 1). At the sessions-at-once limit, a new start for that agent is parked and runs once one of its sessions ends, the same way the daily limit parks.
- **Boundaries = the allowlist plus a kernel-enforced `never` list.** The tool policy stays an allowlist (tools and Bash prefixes). The settings add a per-agent `never` list drawn from a closed set of the rail's outward categories: push, PR and issue writes, `gh api` writes, alias definitions, settings and hooks writes. A matching call is denied outright (`agent_boundary`). It is never held as an approval and no grant ever covers it. Because it uses the rail's own matchers, `git -c alias…` and other forms the rail recognises are caught too.
- **Routing (D25) = `studio ask --agent <id> "<text>"`.** It queues a message for that crew member, whose own session runs from its own charter, memory and settings. Wright never answers for it. The message rows and exit codes are the same as today's `studio ask`.
- **Delegation = `kernel_agent_message(agent, text)`, not held.** The kernel queues the text for that member, wrapped as untrusted data from `agent:<sender>`. The member's session runs under its own policy, and its reply returns to the sender as a new message.
- **Loop guard = a chain depth the owner sets.** Every delegation and reply carries its chain depth. A delegation past the sending agent's `limits.delegation_depth` is refused (`delegation_depth`, one notify). The field is optional (unset means no limit), Wright proposes a value, and the token limits still apply on top.
- **Crew playbooks = Wright drafts them for a crew member.** Wright may draft a playbook whose owning agent is a crew member. Its dry run, enable and fires run as that member, under its model, policy and limits. Crew members don't draft playbooks.
- **Memory = the member's own files plus shared.** Creating a member creates `memory/<id>/role.md`, `preferences.md`, `people.md` and `lessons.md`. Each is created only if absent, so the owner's edits win. A member's context is its own four files plus `memory/shared/*.md`, never Wright's or another member's. Honest limit: Read, Glob and Grep are allowed by name, not by path.
- **Workspaces = absolute repo paths listed in the settings.** The settings list zero or more absolute repo paths, set by the owner and checked against D31's protected folders and the data dir. A message or delegation may name one of them as the session's cwd. Any other path is refused. With none named, the session runs in `memory/<id>`.
- **Identity = a stable id, a renamable display name, and off.** The id is lowercase and stable: it names the member's folder and config file and is never reused, and `wright` is reserved. The display name and avatar (a D23 creature and a `crew-*` hue; the whale is Wright's) are proposed by Wright and changed by the owner. `studio agents rename` changes only the display name. `studio agents off <id>` stops new sessions and messages for it and never deletes its memory. `studio agents list` and `studio agents show` print the roster.
- **Live exit check = a local repo with a local bare remote.** The repo is a throwaway outside the protected folders, so no GitHub is needed (invariant 5). The owner asks Wright in chat for a comment-only reviewer and approves the create, then tells the reviewer to push. The kernel denies the push (`agent_boundary`, no approval row) and the bare remote's ref is unchanged. The reviewer's `gh pr comment` attempt is held as an approval, which shows commenting is allowed, and the owner denies it.

## Scope

1. **`kernel_agent_message(agent, text, workspace?, idempotency_key)`** (`kernel/src/agents/delegate.ts`, in its part):
   - `text` is 1–8,000 characters and is refused at argument validation with a NUL, as `kernel_notify` is. `agent` is any routable id other than the caller's own. `workspace` is optional, and checked against the target's settings `workspaces` here as well, so a bad one is refused before anything is queued.
   - It runs as one work step keyed `kernel_agent_message:session-<id>:<key>`: a repeat returns the first result, and the queued message is written once.
   - It queues one `message` event `{agent, text, from_agent: <caller's agent>, depth, workspace?}` and returns `{message_id?, queue_id, agent, depth}`, with a line telling the model that the reply arrives later as a new message and to end its turn. It never waits for the reply.
   - It is not held (owner decision). The target's own policy and the rail decide every action it takes.
2. **Depth.**
   - The caller's current depth is that of the message its session is handling (`brain_messages.depth` for the session's row; an owner's message is 0). A session with no message row (a playbook fire or dry run) counts 0.
   - The new delegation's depth is the caller's plus 1. It is refused `delegation_depth`, with one `notify` per refused chain naming the caller, the target and the limit, when it exceeds the CALLER's `limits.delegation_depth` from its own settings. Unset means no limit.
   - A reply (item 05) keeps the delegation's depth, so a reply-handling session that delegates again goes one level deeper.
3. **Refusals** are error results, never throws: `no_such_agent`, `agent_off`, `self_delegation`, `workspace_not_listed`, `delegation_depth`, and a caller with no agent (`no_agent`). Each appends one `agent_message_refused` event, and a success appends `agent_message_queued` (`{from, to, depth, queue_id}`).
4. **Docs:** `docs/architecture/delegation.md`, the item 01 stub: the tool, depth with a worked chain (owner → Wright 0 → Mason 1 → reply 1 → Wright delegates again: 2), the events, and the honest limits. A crew member whose policy lists the tool may delegate too, and the depth check applies to it; only token limits bound total work.

## Non-goals

- Handling the queued message, or the reply-back (item 05). The tests here assert the queued payload and the refusals, and the end-to-end chain is item 09's.
- Holding delegations for approval (the owner chose "not held").

## Acceptance criteria

- [ ] Given a Wright session handling the owner's message (depth 0), when it calls `kernel_agent_message({agent: "mason", text: "review x", idempotency_key: "k1"})`, then one `message` event with payload `{agent: "mason", text, from_agent: "wright", depth: 1}` is queued and one `agent_message_queued` event recorded. Calling again with `k1` returns the same result and queues nothing.
- [ ] Given Wright's `limits.delegation_depth: 1` and a Wright session handling a reply of depth 1, when it delegates, then it is refused `delegation_depth`, nothing is queued, and exactly one `notify` is sent. Given no `delegation_depth`, then the delegation is queued at depth 2.
- [ ] Given `mason` is `off`, unknown, or the caller itself, then the call returns `agent_off`, `no_such_agent` or `self_delegation` and queues nothing.
- [ ] Given `workspace: "/repos/x"` not in `mason`'s `workspaces`, then the call returns `workspace_not_listed` and queues nothing.
- [ ] Given text holding a NUL, then the call fails argument validation.
- [ ] `delegation.md` documents the tool and the depth rule, and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- "One notify per refused chain" is keyed on the caller's message row, so repeated refused attempts in one session notify once.

## Risks

- The depth is read from the session's message row. If item 05 has not yet written `depth` on rows, the tests here insert rows with the column set directly (it exists from item 01's migration).

## Depends on
2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md

## Touches
kernel/src/agents/delegate.ts
kernel/test/agents-delegation.test.ts
docs/architecture/delegation.md
