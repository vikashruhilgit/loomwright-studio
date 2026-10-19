# 07 — Wright drafts a charter from a sentence, and the kernel creates (or changes) the crew member when the owner approves

## Status: ready

**Priority:** MVP · ROADMAP phase 4 "A specialist created from chat" · D22, D3, D4, invariants 1, 2, 3, 9

**As** the owner,
**I want** to say in chat "I want a reviewer that comments on PRs and never pushes" and approve the charter Wright drafts,
**so that** a crew member comes to exist from one sentence, with every boundary shown to me before it exists, and nothing depends on Wright retrying after I approve.

## Problem

Item 02 gives the owner `studio agents create --from <file>` and the shared `createAgent`. Nothing lets Wright propose an agent. Item 01 has already made `kernel_agent_create` and `kernel_agent_update` always held and kernel-applied, but neither tool exists, so an approval for one would be refused `no_applier`. Phase 3's 2026-10-17 live run showed why the kernel must apply an approved state change itself: Wright never retried the approved enable (`docs/architecture/approvals.md` "Kernel-applied actions").

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

1. **`kernel_agent_create(charter, idempotency_key)`** (`kernel/src/agents/charter-tools.ts`, in its part). `charter` is item 02's shape. The tool's description guides the model: draft from the owner's words; every value the owner didn't state is a proposal; put the owner's "never …" boundaries into both the prose `boundaries` and the enforced `never` list; propose limits and a `delegation_depth`, never leave the owner thinking they're set.
   - **`beforeHold`** (store reads only):
     - it parses the input with the tool's shape and runs item 02's `validateCharter`;
     - it refuses `id_taken`, a reserved id, a caller that is not `wright` (`not_lead`: crew members never create agents) and a used idempotency key;
     - otherwise it returns a `display`: the `role.md` that would be written, the settings JSON, and one line naming every enforced boundary (`never: git_push, …`, the allowed tools and Bash prefixes). The owner sees the whole charter in `studio approvals` (escaped, as every display is).
   - **`applyOnApproval`** (the owner's `once`):
     - it re-validates, and in the savepoint inserts the row and the `agent_created` event, with `created_by: wright` and the approval id;
     - it names the file writes as the follow-up, so a failed write self-heals through item 02's `ensureAgentFiles`;
     - it answers the applied sentence `The kernel created crew member <id> (<display name>) on approval <id>.`, or a refusal from the closed list: `id_taken`, `files_exist`, `invalid_input`, `not_lead`.

     The decision's message to Wright then says what was done and not to repeat the call (phase 3 item 10's wording).
2. **`kernel_agent_update(id, changes, expected_sha256, idempotency_key)`**.
   - `changes` is a partial of item 02's settings fields (`model`, `effort`, `permission_mode`, `tool_policy`, `never`, `limits`, `workspaces`) plus `display_name` and `avatar`.
   - `expected_sha256` is the settings file's content hash from `kernel_agent_list`, so an approval can never overwrite an owner's edit made after Wright read the file.
   - `beforeHold` refuses an unknown or `off` target, `wright` (`reserved`: the owner edits `wright.json`), a caller that is not `wright`, a stale hash (`config_changed`) and an invalid result. Otherwise its display is a per-field old → new diff.
   - `applyOnApproval` re-checks the hash (`config_changed` if the file changed between the hold and the decision), writes the merged file atomically (a temporary sibling, then a rename) and updates the row's display name and avatar. It answers `The kernel updated crew member <id> on approval <id>: <fields>.`
3. **`kernel_agent_list()`** (read-only, not held): the roster, each member with its status, display name, avatar, parsed settings and settings `sha256`, and Wright's own settings without a hash. Any agent whose policy lists it may call it.
4. **Docs:** `docs/architecture/agents.md` gains the three tools, the display, the applied sentences and the refusal tokens. The `role.md` example block from item 02 stays pinned and unchanged (the companions rule adds `charter-files.ts` and its test to this item's Touches; edit them only if the pin forces it, and say so).

## Non-goals

- `always` for either tool (refused by item 01's `ALWAYS_HELD_TOOLS`).
- Wright changing its own settings.
- Crew members creating agents.

## Acceptance criteria

- [ ] Given a Wright session (stand-in) that calls `kernel_agent_create` with a valid comment-only reviewer charter (`never: ["git_push", …]`), then the call is held and `studio approvals` shows the display with the `role.md` text and the `never` line. No row or file exists yet.
- [ ] Given the owner's `studio approve <id> once`, then in the decision the kernel inserts the `mason` row (`created_by: wright`, `approval_id`), writes its files, records `approval_used` with `by: "kernel"`, and prints `studio: the kernel applied it: The kernel created crew member mason …`. Wright's message says "Nothing to repeat."
- [ ] Given the owner created `mason` by hand between the hold and the approval, when the owner approves, then `apply_refused: id_taken` is recorded and nothing is written. Given the follow-up file write failing, then the row exists and the next `ensureAgentFiles` writes the files.
- [ ] Given a crew session calling `kernel_agent_create` (its policy listing it), then it is refused `held_refused` (`not_lead`) with no approval row.
- [ ] Given `kernel_agent_update` with an `expected_sha256` that no longer matches because the owner edited the file, then it is refused at hold. Given an edit after the hold, then the approval is recorded `apply_refused: config_changed` and the file is unchanged.
- [ ] Given a valid update of `limits.tokens_per_day`, when the owner approves, then only that field changes, `readAgentSettings` returns it, and the display showed old → new.
- [ ] Given `kernel_agent_list`, then each member's `sha256` equals the hash of its file's bytes.
- [ ] `agents.md` documents the tools, and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- "The caller is `wright`" is read from the requesting session's `sessions.agent`, which the kernel wrote, never from the tool input.

## Risks

- The display is model-written text shown to the owner. It is escaped like every display, and the enforced `never` and allowlist line is generated by the kernel from the parsed charter, never copied from prose, so the prose cannot misstate what is enforced.

## Depends on
2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md
2026-10-18-041102-the-owner-creates-lists-renames-sets-and-turns-off-crew-members.md

## Touches
kernel/src/agents/charter-tools.ts
kernel/test/agents-charter-tools.test.ts
docs/architecture/agents.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-19T06:30:20Z
- **Brief:** .supervisor/jobs/done/2026-10-19-wright-charter-tools-create-update-list.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/91
