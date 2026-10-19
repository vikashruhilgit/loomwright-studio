# 08 — Wright drafts playbooks a crew member owns, and their dry runs and fires run as that member

## Status: ready

**Priority:** MVP · ROADMAP phase 4 · D3, D4, D22 ("Duties: plain English; Wright turns each into playbooks"), invariants 1, 3

**As** the owner,
**I want** Wright to turn a crew member's duty into a playbook that member owns, with its dry run and every fire running as that member,
**so that** a scheduled duty is bounded by the crew member's policy, `never` list and limits, never by Wright's.

## Problem

Phase 3's playbooks are Wright's alone:
- `owningAgent(ctx)` is the calling session's agent (`kernel/src/playbooks/drafts.ts:151`);
- a dry run uses Wright's settings and `memory/wright` (`dry-run.ts:423-438`);
- a fire of any agent not in `BRAIN_AGENTS` fails `agent_not_routed` (`runs.ts:347`) and otherwise uses Wright's settings and memory dir (`runs.ts:460-502`).

The phase 3 plan doc's "Revisit when crew lands (phase 4): playbooks owned by agents other than Wright".

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

1. **Drafting for a crew member** (`drafts.ts`):
   - `kernel_playbook_create` gains optional `agent`, the owning agent, accepted only from a `wright` session and only for an `active` registered id (`isRoutable`). Omitted, it is the caller, as today.
   - Every playbook tool's ownership check becomes "the session's agent owns the playbook, or the session's agent is `wright` and the owner is a registered crew member". `kernel_playbook_list` from Wright lists the crew's playbooks too, each with its owning agent.
   - A crew session calling `kernel_playbook_create`, `update`, `disable`, `dry_run` or `enable` is refused `crew_cannot_draft`. Crew members don't draft playbooks.
2. **The dry run runs as the owner** (`dry-run.ts`): the playbook's model (unchanged), plus the owning agent's permission mode and policy (its `never` included) from `readAgentSettings`, with cwd `agentMemoryDir(owning agent)` and `agent` set to the owning agent on the session row. An `off` owning agent is refused `agent_off`, and a settings refusal names the owning agent's file.
3. **Enable** (`enable.ts`): the `not_owner` check and its applier accept Wright's request for a crew-owned playbook under the rule in Scope 1. Everything else about enabling is unchanged: always held, a dry run of the current version required, kernel-applied.
4. **Fires and run-now run as the owner** (`runs.ts`): `agent_not_routed` applies only to an id that `isRoutable` rejects. An `off` owning agent fails the run row `agent_off` with one notify. Otherwise the session runs as the owning agent: its settings, policy, `never`, cwd and session row `agent`. Its admission is that agent's limits, `sessions_at_once` included (item 04): a parked fire stays parked. The mirror file and `studio playbooks show` name the owning agent.
5. **Docs:** `docs/architecture/playbooks.md`, `dry-run.md` and `playbook-runs.md` for crew ownership and the refusals.

## Non-goals

- Crew members drafting their own playbooks (the owner chose Wright only).
- A playbook naming a workspace. A crew playbook session runs in `memory/<id>`. A workspace per playbook is a later item, recorded in the plan doc.
- Changing who decides an enable: always the owner.

## Acceptance criteria

- [ ] Given a stand-in Wright session, when it calls `kernel_playbook_create({…, agent: "mason"})`, then the draft's `owning_agent` is `mason` and the mirror names Mason. Given `agent: "ghost"` or an `off` agent, then it is refused, and nothing is written.
- [ ] Given that draft, when Wright dry-runs it, then the dry-run session row has `agent: "mason"`, cwd `memory/mason`, Mason's policy with its `never`, and the playbook's model. A push in it is denied `agent_boundary` (item 03 merged) or `dry_run`, never held.
- [ ] Given the owner approves Wright's enable request for it, then the kernel enables it, with no `not_owner` refusal.
- [ ] Given the enabled crew playbook fires, then its session runs as `mason` under Mason's settings. Given `mason` is `off` at fire time, then the run row is `failed: agent_off` with one notify, and no session starts.
- [ ] Given a crew session calling `kernel_playbook_create`, then it is refused `crew_cannot_draft`.
- [ ] Given Wright's own playbooks, then every phase 3 playbook test passes unchanged.
- [ ] The three pages document crew ownership, and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Standing `always` grants from a crew playbook's sessions belong to the crew member (the requester rule is unchanged), so Wright's sessions never use them.
- The tests create crew members with item 02's `createAgent`, not hand-written files.

## Risks

- Three of the playbook sub-files change in one item. Phase 3's per-file pins are the guard, and Wright's path must stay unchanged.

## Depends on
2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md
2026-10-18-041102-the-owner-creates-lists-renames-sets-and-turns-off-crew-members.md
2026-10-18-041103-a-crew-members-never-list-is-denied-outright.md
2026-10-18-041104-token-limits-and-sessions-at-once-per-agent.md

## Touches
kernel/src/playbooks/
kernel/test/playbooks-crew.test.ts
docs/architecture/playbooks.md
docs/architecture/dry-run.md
docs/architecture/playbook-runs.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-19T06:30:38Z
- **Brief:** .supervisor/jobs/done/2026-10-19-crew-playbooks-drafted-by-wright-run-as-member.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/90
