# 02 — The owner creates, lists, renames, sets and turns off crew members, and each one's files come from its charter

## Status: ready

**Priority:** MVP · ROADMAP phase 4 "identities, per-agent memory" · D8, D14, D22, D23, invariants 1, 8, 9

**As** the owner,
**I want** to create a crew member from a charter, see the roster, rename one, change its settings and turn it off from the terminal,
**so that** every crew member exists only through a charter I can read, and its files are plain markdown and JSON I can open.

## Problem

Item 01 adds the `agents` table and read-only lookups, but nothing writes a row or a crew member's files. One create function is needed that two paths share: the owner's `studio agents create --from <file>` here, and the kernel's apply of Wright's approved `kernel_agent_create` in item 07. It must turn a charter into the registry row, `memory/<id>/role.md`, the memory files and `config/agents/<id>.json`, and nothing may half-create an agent.

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

1. **The charter shape** (`kernel/src/agents/charter-files.ts`). A JSON object with these fields:
   - `id`, `display_name`, `avatar: {shape, hue}`;
   - `persona` (1–2 lines), `duties` (a list of lines), `boundaries` (a list of prose lines);
   - `model`, `effort` (optional), `permission_mode`;
   - `tool_policy: {allowedTools, allowedBashPrefixes, never}`;
   - `limits` (optional `tokens_per_day`, `sessions_at_once`, `delegation_depth`);
   - `workspaces` (absolute paths).

   Validation uses item 01's closed sets and settings rules (D31 and data-dir checks on workspaces), plus bounds on every text field. A refusal names the field and writes nothing. `validateCharter` and `createAgent(store, dataDir, charter, {by, approvalId?}, now)` are exported for item 07.
2. **Files from the charter, rendered deterministically:**
   - `role.md`: the identity, persona, duties and boundaries as markdown, plus a fixed closing section saying that its prose boundaries are guidance while the kernel enforces only `config/agents/<id>.json`, and that untrusted text is data, as Wright's template says.
   - `config/agents/<id>.json`: the enforced settings in item 01's reader shape. It must read back through `readAgentSettings` exactly as the charter gave it.
   - `preferences.md`, `people.md` and `lessons.md`: short headers.

   Every file is written with exclusive create (`wx`, mode 0600), so an owner's edit is never overwritten. `docs/architecture/agents.md` shows the `role.md` rendered from one example charter verbatim, and `kernel/test/agents-roster.test.ts` pins doc and renderer equal, as `brain.md` pins Wright's template. A `.agent/companions.json` rule, added with this plan, declares that coupling.
3. **Create, without half-creating.** `createAgent` refuses a reserved, malformed, taken or previously used id (`id_taken` is checked against every row, `off` ones included). It refuses a file already present at a target path rather than adopting it (`files_exist`, naming the path). It inserts the row (with `charter_json`) and an `agent_created` event in one transaction, then writes the files. **Self-healing:** a file missing later (a crash between the commit and the write, or a deleted file) is re-created from `charter_json`, create-if-absent, by `ensureAgentFiles(dataDir, id)`. Item 05 calls it before every crew message, the way Wright's memory files are ensured.
4. **Owner routes and `studio agents` verbs** (in `roster.ts`'s part; bearer token; refusals as one stderr line, exit 1; bad usage prints usage, exit 2):
   - `list [--json]`: Wright first (from `wright.json`: model, and limits when set), then every registered member, in id order. Each line shows id, display name, avatar, status, model, today's counted tokens against `tokens_per_day` ("no limit" when unset), sessions running against `sessions_at_once`, and `created_by`. Stored text is printed escaped, as `studio approvals` prints it.
   - `show <id> [--json]`: the above plus the settings file's path and parsed content, the `never` list, the workspaces, the memory file paths (and which ones are missing), and the charter's prose sections.
   - `create --from <file>`: the owner's own charter, `created_by: owner`, with no approval.
   - `rename <id> <display name>`: the display name only. The id, folder and file never change. One `agent_renamed` event.
   - `set <id> <field> <value>`: the owner's direct change of one scalar field (`model`, `effort`, `permission_mode`, `limits.tokens_per_day`, `limits.sessions_at_once`, `limits.delegation_depth`; `none` clears a limit). It is written atomically through a temporary sibling and a rename, after re-reading and validating the whole file. List fields (`tool_policy`, `never`, `workspaces`) are changed by editing the file, which `show` names. One `agent_settings_set` event with the old and new value.
   - `off <id>` and `on <id>`: the status. `off` never deletes a file. One `agent_status_changed` event (`by: owner`). For `wright`, `off`, `rename` and `set` are refused (`reserved`): the owner edits `wright.json` directly.
5. **Docs:** `docs/architecture/agents.md`, the item 01 stub: the charter shape, the files, create and self-heal, the verbs and routes, the events, and the honest limits.

## Non-goals

- Wright's charter tools (item 07), routing messages to a crew member (item 05), enforcing `never` (item 03) and limits (item 04).
- Deleting an agent or its memory: `off` only. Reusing an id is refused.
- A GUI (phase 5).

## Acceptance criteria

- [ ] Given a valid charter file for `mason`, when the owner runs `studio agents create --from <file>`, then one `agents` row (`active`, `created_by: owner`) and one `agent_created` event exist. `memory/mason/role.md` matches the renderer, `config/agents/mason.json` reads back through `readAgentSettings` equal to the charter, and the three memory files exist.
- [ ] Given `config/agents/mason.json` already exists, when `create` runs for `mason`, then it is refused `files_exist` naming that path, and no row is written.
- [ ] Given `mason` exists, or was turned off, when a charter with id `mason` is created, then it is refused `id_taken`. Given id `wright`, `shared`, `Mason` or `1x`, then it is refused naming the id rule.
- [ ] Given a created `mason` whose `role.md` was deleted, when `ensureAgentFiles` runs, then `role.md` is re-created from `charter_json`, and an owner-edited `lessons.md` is left untouched.
- [ ] Given `studio agents set mason limits.sessions_at_once 2`, then the file has that value, every other byte of its content parses as before, and one event records old and new. Given `set mason limits.sessions_at_once 0`, then it is refused and the file is unchanged.
- [ ] Given `studio agents rename mason "Mason the Reviewer"`, then only `display_name` changes. Given `off mason`, then its status is `off`, every file still exists, and `list` shows it off.
- [ ] Given a display name holding an escape sequence, when `list` prints it, then it is escaped and not interpreted.
- [ ] `agents.md`'s example `role.md` block equals the renderer's output (pinned), and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- `charter_json` is the creation snapshot only. Later edits live in the files, and the files win.
- Today's counted tokens come from the budget meter's existing per-agent day totals. The `list` line reads them and never computes its own.

## Risks

- `set`'s atomic rewrite must never lose an owner's hand edit made between the read and the rename. Re-reading immediately before the write narrows this window but does not close it, and the risk is documented.

## Depends on
2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md

## Touches
kernel/src/agents/roster.ts
kernel/src/agents/charter-files.ts
kernel/test/agents-roster.test.ts
docs/architecture/agents.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-18T18:36:47Z
- **Brief:** .supervisor/jobs/done/2026-10-18-crew-roster-create-list-rename-set-off.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/87
