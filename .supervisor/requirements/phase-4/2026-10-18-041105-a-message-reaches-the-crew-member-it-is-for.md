# 05 — A message reaches the crew member it is for, runs in that member's own session, and a delegation's reply returns to its sender

## Status: ready

**Priority:** MVP · ROADMAP phase 4 "A specialist created from chat can do only what its policy allows" · D25, D8, invariants 2, 3, 8

**As** the owner,
**I want** `studio ask --agent mason "…"` to run Mason's own session from Mason's charter, memory and settings, and a delegation's reply to come back to whoever delegated,
**so that** each crew member is a real boundary: its own context, its own policy, its own working directory.

## Problem

The brain's `message` handler routes only `wright` (`BRAIN_AGENTS`, `kernel/src/brain/messages.ts`; any other agent "is left alone: no row, the event ends `done`", `docs/architecture/brain.md` "Routing"). Context, settings and cwd are all Wright's: `memory/wright` and `wright.json`. Item 01 adds `readAgentSettings`, `agentMemoryDir` and `isRoutable` and the message contract (`from_agent`, `depth`, `reply_to`, `workspace`). Item 02 adds `ensureAgentFiles`. Item 06 queues delegations against that contract. Nothing yet runs them.

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

1. **Route every routable agent.** The handler takes a message whose `agent` passes `isRoutable` (`wright`, or an `active` registered id) through today's steps, unchanged for Wright, with the agent's own pieces:
   - `ensureAgentFiles` (item 02) for a crew member;
   - its settings from `readAgentSettings`. A refusal (`model_unset`, `settings_invalid`, `settings_missing`, `charter_missing`) fails the row naming the agent's file, exactly as Wright's do today;
   - its context: its own `role.md`, `preferences.md`, `people.md` and `lessons.md`, then every `memory/shared/*.md` in name order (owner-written, so headed "Shared notes" and not wrapped as untrusted), then the Loomwright summary, the time and the message, under today's bounds and cut notes;
   - its session: `startSession({agent: <id>, …, model, permissionMode, cwd, policy})`, where `policy` includes the settings' `never` and `cwd` is the named workspace or else `memory/<id>`.

   A message for an `off` agent fails its row with `agent_off`, and one for an unknown or unroutable id with `no_such_agent`. Each writes a row so the owner can see it, never silently `done`. Wright's context and routing stay byte-identical: no shared notes for Wright in this phase (a non-goal).
2. **Who sent it.** A message whose payload has `from_agent` gets the source `agent:<from_agent>` and is wrapped as untrusted data from that source, in the same wrapper and defusing as `trigger:<id>`. It is never headed as the owner's. Its row records `from_agent`, `depth`, `reply_to` and `workspace`.
3. **A workspace must be listed.** A message naming a `workspace` that is not exactly one of the agent's settings `workspaces` (compared as absolute, normalised paths) fails the row with `workspace_not_listed`, and nothing starts. The session manager's D31 check still runs.
4. **A delegation's reply returns to its sender.** A message with `from_agent` set and no `reply_to` is a delegation. When its session ends:
   - if it `replied`, one new message is queued for `from_agent` with the reply as its text, `from_agent` set to this member, the same `depth`, and `reply_to` set to the delegation's row id;
   - if it `failed` (any reason above, or the session's ending), one message is queued saying that the delegation failed and why.

   This is keyed on the delegation's row, so a redelivery never queues it twice. A reply (a message with `reply_to` set) is never itself replied to, so a reply can't start a ping-pong. Only a new delegation, which item 06 depth-checks, continues a chain.
5. **Owner surfaces** (D25's Crew thread, terminal edition):
   - `POST /ask` accepts optional `agent` (default `wright`) and `workspace`. It refuses `404 no_such_agent`, `409 agent_off` and `409 workspace_not_listed` before queueing.
   - `studio ask [--agent <id>] [--workspace <path>] "<text>"` keeps today's exits and output.
   - New `studio messages [--agent <id>] [--all] [--json]` lists recent message rows (newest last, at most 200): agent, source, status, depth, `reply_to`, text and reply, escaped like every stored text. That is how the owner reads a delegation chain and its replies.
6. **Docs:** `docs/architecture/brain.md` "Routing", "The context a session gets" and "API and CLI" for crew members, sources, workspaces, reply-back and `studio messages`. The role-template block is unchanged (item 01 owns it).

## Non-goals

- The delegation tool and its depth check (item 06), Wright's charter tools (item 07), and playbook runs for crew (item 08). Leave `kernel/src/playbooks/` alone, including its `BRAIN_AGENTS` import: keep that export's value and meaning as they are.
- Shared notes in Wright's own context: unchanged in phase 4.

## Acceptance criteria

- [ ] Given an active `mason` with a model set, when the owner runs `studio ask --agent mason "hi"`, then one session starts with `agent: "mason"`, cwd `memory/mason`, Mason's model, permission mode and policy (its `never` included), and a prompt holding Mason's four files and `memory/shared/*.md`, with none of Wright's memory. The row ends `replied` with the reply printed.
- [ ] Given `mason` is `off`, when the owner asks it, then `POST /ask` answers `409 agent_off` and nothing is queued. Given the same message reaching the handler through the queue, then its row is `failed: agent_off`.
- [ ] Given `mason`'s settings list `/repos/demo`, when asked with `--workspace /repos/demo`, then the session's cwd is `/repos/demo`. Given `--workspace /repos/other`, then it is refused `workspace_not_listed` and nothing starts.
- [ ] Given a queued message `{agent: "mason", from_agent: "wright", depth: 1}`, when it is handled, then its prompt wraps the text as `<untrusted-data source="agent:wright">`. When its session replies, then exactly one message `{agent: "wright", from_agent: "mason", depth: 1, reply_to: <row id>}` is queued, and redelivering the delegation queues no second one.
- [ ] Given that reply is handled by Wright and Wright's session replies, then nothing is queued back to `mason`.
- [ ] Given the delegation's session fails, then one failure message is queued to `wright` naming the reason.
- [ ] Given `studio ask "hi"` with no `--agent`, then Wright's handling, context bytes and every existing brain test are unchanged.
- [ ] Given a chain of rows, when the owner runs `studio messages --agent mason`, then each row prints with source, depth and `reply_to`, and stored control characters are escaped.
- [ ] `brain.md` documents the routing, and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- A crew member resumes its own interrupted session for a task the same way Wright does (latest session of that agent and task).
- `memory/shared/*.md` is the owner's text. Agents write memory only through tools their policy allows, and the rail does not protect `memory/`. If an agent's policy lets it write there, what it writes reaches every crew context unwrapped. That honest limit is documented.

## Risks

- The handler is shared by every message. Wright's path must stay byte-identical, and the `brain.test.ts` pins are the guard.

## Depends on
2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md
2026-10-18-041102-the-owner-creates-lists-renames-sets-and-turns-off-crew-members.md

## Touches
kernel/src/brain/handler.ts
kernel/src/brain/messages.ts
kernel/src/brain/context.ts
kernel/src/brain/routes.ts
kernel/src/brain/cli.ts
kernel/src/brain/index.ts
kernel/test/brain-crew-routing.test.ts
docs/architecture/brain.md
