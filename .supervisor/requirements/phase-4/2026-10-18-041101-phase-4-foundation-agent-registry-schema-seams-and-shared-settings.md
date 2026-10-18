# 01 — Phase 4 foundation: the agent registry schema, one home per phase 4 feature, and one settings reader for every agent

## Status: ready

**Priority:** MVP · ROADMAP phase 4 (prerequisite for every other item) · invariants 1, 3, 8, 9 · D8, D22, D24, D25

**As** the owner,
**I want** phase 4's schema, shared readers and extension points created in ONE small change first,
**so that** items 02–08 each edit only their own files and run in parallel waves without merge conflicts.

## Problem

Phase 4 needs an agent registry, and none exists. The ARCHITECTURE data model lists an `agents` table, but migration 001 says "No phase-2+ tables: agents, …", and no migration since has created one. Several facts are hard-coded to Wright: the brain routes only `wright` (`BRAIN_AGENTS` in `kernel/src/brain/messages.ts`); there is one settings reader, `readWrightSettings` in `kernel/src/brain/settings.ts`, for `config/agents/wright.json`; and dry runs and fires use Wright's settings and memory dir (`kernel/src/playbooks/dry-run.ts:423`, `runs.ts:468`). Per-agent limits exist only as a static `agentDailyTokenLimits` map in `kernel/src/budget/types.ts`, which the kernel never feeds (`new Budget({store, authProvider}, {now})` in `kernel/src/kernel.ts`). No sessions-at-once limit exists anywhere. The files every phase 4 feature would edit are the migrations list, the features registry (pinned by `feature-seams.test.ts`), Wright's proposed tools and role template (pinned to `brain.md` by `brain.test.ts`), the fixed sets in `kernel/src/sessions/policy.ts` and `kernel/src/approvals/store.ts` (pinned by `sessions-policy.test.ts`, `approvals.test.ts` and `kernel-tools.test.ts`), and `docs/ARCHITECTURE.md`. If every item edited those, no two items could share a wave.

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

1. **Migration 014** (append-only and contiguous, no SQL CHECK; value sets are closed in code, as migrations 011 and 013 did):
   - `agents`: `id` (the stable id, primary key), `display_name`, `avatar_shape`, `avatar_hue`, `status` (`active` / `off`), `created_by` (`owner` / `wright`), `approval_id` (nullable: the approval a kernel-applied create came from), `charter_json` (the charter exactly as created, kept so that item 02 can re-create a missing file from it), `created_at`, `updated_at`.
   - `brain_messages`: `from_agent` (nullable: the sending agent of a delegation or a reply), `depth` (integer, default 0), `reply_to` (nullable `brain_messages.id`: the delegation a reply answers), `workspace` (nullable: the absolute cwd the message named). Every existing row reads `from_agent` null and `depth` 0.
   - Update the `kernel/test/store.test.ts` pins.
2. **Closed value sets and the message contract**, in `kernel/src/agents/types.ts`:
   - Agent statuses, `created_by` values, and the reserved ids (`wright`, plus `shared` and `_unassigned`, which are memory dir names).
   - The id grammar: lowercase ASCII letters, digits and `-`, starting with a letter, 1–32 characters. An id is never reused, even after `off`.
   - The avatar shapes from D23 (`shark`, `seahorse`, `octopus`, `turtle`, `jellyfish`, `fish`, `crab`; `whale` is reserved for Wright) and the hues, which are the `crew-*` token names in `docs/design/tokens.json` (`crew-teal`, `crew-sky`, `crew-berry`, `crew-olive`, `crew-slate`).
   - The `message` payload fields phase 4 adds: `from_agent`, `depth`, `reply_to`, `workspace`. Items 05 and 06 both code against this contract and never edit each other's files.
3. **One settings reader for every agent**, `kernel/src/agents/settings.ts`: `readAgentSettings(dataDir, id)`. It reads `config/agents/<id>.json`, the shape of today's `wright.json` plus these optional fields:
   - `never`: a list of the closed categories in Scope 6.
   - `limits`: `tokens_per_day`, `sessions_at_once` and `delegation_depth`, each a positive integer or absent.
   - `workspaces`: absolute paths. Each is checked when the settings are read: it must be absolute, outside `PROTECTED_LOCATIONS` (D31, `kernel/src/protected-paths.ts`) and outside the data dir.

   A value outside these shapes is refused as `settings_invalid`, naming the file and the field, so the reader fails closed. For `wright`, the reader keeps today's behaviour exactly: the file is created if absent, `model_unset` and `settings_invalid` work as now, and every existing `brain.test.ts` pin still holds. `readWrightSettings` becomes a thin call to it. For a crew id, a missing file is `settings_missing`, naming the file, and the reader never creates a crew file (item 02 does). The fresh `wright.json` proposal gains no `never`, `limits` or `workspaces` field: none is proposed by default (invariant 1).
4. **One memory reader for every agent**, `kernel/src/agents/memory.ts`: `agentMemoryDir(dataDir, id)` and `ensureAgentMemoryFiles(dataDir, id)`. For a crew id, it creates `preferences.md`, `people.md` and `lessons.md` with exclusive create, never `role.md`: a crew member's `role.md` comes from its charter (item 02), and when it is missing the reader reports `charter_missing`. Wright's files and behaviour are unchanged, and `kernel/src/brain/memory.ts` keeps its exports.
5. **One home per phase 4 feature, empty and wired in now.** `kernel/src/agents/index.ts` merges three EMPTY parts (`AGENT_PARTS`), from `roster.ts` (item 02), `delegate.ts` (item 06) and `charter-tools.ts` (item 07). Each exports empty `tools`, `routes`, `handlers` and verbs of ONE contributed `studio agents` subcommand, which prints its help until an item adds a verb. The pattern is phase 3's `PLAYBOOK_PARTS`. Also:
   - `kernel/src/agents/registry.ts` holds the read-only lookups: `getAgent(store, id)`, `listAgents(store)` and `isRoutable(store, id)` (true for `wright` and for an `active` registered id). Writes are item 02's.
   - Register `agentsContribution` in `SHIPPED_CONTRIBUTIONS` after `playbooks`.
   - Pin its parts in a new `kernel/test/agents-foundation.test.ts`, and keep only the contributor order in `feature-seams.test.ts`.
6. **The closed `never` categories, and the gate's call site, in `kernel/src/sessions/`.**
   - `NEVER_CATEGORIES` in `policy.ts` is the closed list, one category per outward form the rail already recognises: every push-like git form as one `git_push`; alias definitions; `gh pr create`, `comment`, `review`, `edit` and `close`, each its own; the same for `gh issue`; `gh api` writes; and writes to settings or hooks.
   - `ToolPolicy` (`types.ts`) gains an optional `never`, and the manager's `checkPolicy` validates it, refusing an unknown category.
   - The gate in `manager.ts` calls `boundaryDecision(policy, classification)` (`policy.ts`). It runs after the rail has classified a call as outward and BEFORE any grant or hold. For now it returns "no boundary" for every call, and item 03 fills it in. Because the call site and the stub land here, item 03 edits `policy.ts` only.
   - `manager.ts` is otherwise unchanged.
7. **The two charter tools are always held and kernel-applied.**
   - Add `mcp__kernel__kernel_agent_create` and `mcp__kernel__kernel_agent_update` to `ALWAYS_HELD_TOOLS` (`policy.ts`) and to `KERNEL_APPLIED_ACTIONS` (`kernel/src/approvals/store.ts`). An `always` grant can then never cover them, and an owner's `once` is applied by the kernel. Until item 07 registers the appliers, an approval for one is refused `no_applier` (fail closed). In practice no session can call them before then anyway, because the tools don't exist yet.
   - Update the pins in `approvals.test.ts`, `kernel-tools.test.ts` and `sessions-policy.test.ts`, and the "today only …" sentences in `docs/architecture/approvals.md`.
8. **Wright's tool names, reserved now.** Add `mcp__kernel__kernel_agent_create`, `_update`, `_list` and `_message` to `PROPOSED_ALLOWED_TOOLS` and to the role template's tool list, together with the matching `docs/architecture/brain.md` block (the existing pin must pass). The template also gains a short "Your crew" paragraph: when the owner asks for a crew member, draft a charter with `kernel_agent_create`, mark every value the owner did not state as proposed, put each "never …" into the enforced `never` list as well as the prose, and delegate with `kernel_agent_message`. Never act as a crew member or claim its work. `wright.json` is create-if-absent, so an existing data dir keeps its old policy, and the owner adds the names (item 09's runbook says how).
9. **Docs.** `docs/ARCHITECTURE.md`:
   - the `agents` data-model row, rewritten to match the owner's storage decision: the registry in the table, the enforced settings in `config/agents/<id>.json`, and the charter in `role.md`;
   - the new `brain_messages` columns;
   - the four phase 4 tools;
   - a "Phase 4 features" section linking one stub page per item: `docs/architecture/agents.md` (items 02 and 07) and `docs/architecture/delegation.md` (item 06). Items 03, 04, 05 and 08 edit their existing pages (`approvals.md`, `budget.md`, `brain.md`, and the playbook pages).

## Non-goals

- Any phase 4 behaviour (items 02–08): the empty parts register nothing.
- Changing how Wright's messages, dry runs or fires behave. Every existing test passes unchanged, apart from the pins this item moves or extends.
- Connectors or "allowed integrations" per agent (phase 6, D12). The charter's Tools section for connectors waits for them.

## Acceptance criteria

- [ ] Given a fresh store, when migrations run, then migration 014 creates `agents` and the four `brain_messages` columns. Given a store at migration 013 with message rows, when it upgrades, then every existing row reads `from_agent` null and `depth` 0, and nothing else changes.
- [ ] Given the shipped contributions, when they merge, then `agents` is registered with no tools, routes, verbs or handlers, `studio agents` prints its help without error, and `agents-foundation.test.ts` pins that.
- [ ] Given `config/agents/mason.json` with a valid `never`, `limits` and `workspaces`, when `readAgentSettings(dataDir, "mason")` runs, then it returns them. Given an unknown `never` category, a non-integer limit, or a workspace inside `~/Documents` or the data dir, then it refuses `settings_invalid`, naming the file and the field. Given no file for `mason`, then it refuses `settings_missing` and creates nothing.
- [ ] Given a fresh data dir, when Wright's settings are read, then `wright.json` is created with today's content plus the four `kernel_agent_*` names, with no `never`, `limits` or `workspaces`, and the brain's tests pass unchanged apart from that list.
- [ ] Given a session policy with `never: ["git_push"]`, when the manager validates it, then it is accepted; given `never: ["push_everything"]`, then the session is refused before anything is spawned.
- [ ] Given a session whose policy allows `mcp__kernel__kernel_agent_create`, when it calls the tool, then the call is held, an `always` decision on it is refused `always_not_supported`, and a `once` decision with no applier is recorded `apply_refused: no_applier`.
- [ ] `docs/ARCHITECTURE.md` lists the phase 4 table, columns and tools and links the two stub pages, and `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- `wright` stays out of the `agents` table: it is the reserved lead, always routable, and its settings live in `wright.json` as now. `studio agents list` (item 02) shows it first from its file, not from a row.
- The closed `never` categories mirror the rail's action labels one-to-one, so the classifier that already holds a call is the one that denies it. No second matcher is written.

## Risks

- Touching the reader that every Wright message uses is the riskiest part. Wright's path must stay byte-identical (the `brain.test.ts` pins are the guard).
- Adding two names to `KERNEL_APPLIED_ACTIONS` before their appliers exist relies on the decision's `no_applier` fail-closed path, which phase 3 item 10 built and tested.

## Depends on
none

## Touches
kernel/src/store/migrations/
kernel/test/store.test.ts
kernel/src/agents/index.ts
kernel/src/agents/types.ts
kernel/src/agents/settings.ts
kernel/src/agents/memory.ts
kernel/src/agents/registry.ts
kernel/src/agents/roster.ts
kernel/src/agents/delegate.ts
kernel/src/agents/charter-tools.ts
kernel/test/agents-foundation.test.ts
kernel/src/features/index.ts
kernel/test/feature-seams.test.ts
kernel/src/brain/settings.ts
kernel/src/brain/templates.ts
docs/architecture/brain.md
kernel/test/brain.test.ts
kernel/src/sessions/policy.ts
kernel/test/sessions-policy.test.ts
kernel/src/sessions/manager.ts
kernel/src/sessions/types.ts
kernel/test/sessions.test.ts
kernel/src/approvals/store.ts
kernel/test/approvals.test.ts
kernel/test/kernel-tools.test.ts
docs/architecture/approvals.md
docs/ARCHITECTURE.md
docs/architecture/agents.md
docs/architecture/delegation.md
