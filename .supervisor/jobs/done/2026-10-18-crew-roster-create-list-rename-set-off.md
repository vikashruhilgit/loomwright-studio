# Supervisor Job: The owner creates, lists, renames, sets and turns off crew members, and each one's files come from its charter

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-18-135554/L1 (lane L1 clone of loomwright-studio)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-18-041102-the-owner-creates-lists-renames-sets-and-turns-off-crew-members.md
- **Base commit:** 0fbe903b7c64522529ae04eea81ac5d3af146729

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest + zod + better-sqlite3, all already in `kernel/package.json`; no new dependency. |
| 2 | Dependency Availability | GO | Item 01 (PR #83, merged at the base commit) ships `agents` table (migration 14), `readAgentSettings`, `ensureAgentMemoryFiles`, `getAgent`/`listAgents`, the closed sets and the empty `rosterPart`. |
| 3 | Architecture Fit | GO | Fills the pre-built `roster` part of the agents feature seam (`kernel/src/agents/index.ts` merges `AGENT_PARTS`); routes get `store` (with `store.dataDir`) and `now` through `ContributedRouteRequest`. |
| 4 | Scope vs Supervisor Capability | CAUTION | ~6 files and likely 900–1300 changed lines (tests dominate) — near the `context-bound` bound, but the renderer, create path, verbs and tests are one tightly coupled unit; kept single-agent. |
| 5 | Hard Blockers | GO | None. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Fill the agents feature's `roster` part: a charter shape with one validator, a deterministic renderer of a crew member's files, an all-or-nothing `createAgent`, a self-healing `ensureAgentFiles`, owner API routes and the `studio agents list|show|create|rename|set|off|on` verbs, plus `docs/architecture/agents.md`.

**Problem Statement:**
The owner needs to create a crew member from a charter, see the roster, rename one, change a scalar setting and turn one off from the terminal, because every crew member must exist only through a charter the owner can read (D22, invariant 9) and its files must be plain markdown/JSON (invariant 8).
Currently, item 01 added the `agents` table and read-only lookups, but nothing writes a row or a crew member's files (`kernel/src/agents/roster.ts` is an empty part). This blocks items 03–08, and item 07 needs one shared `createAgent`.
Success looks like `studio agents create --from <file>` producing exactly one row, one `agent_created` event, `memory/<id>/role.md` + three memory files and `config/agents/<id>.json` that reads back through `readAgentSettings` equal to the charter — with every refusal writing nothing.

**Owner decisions (binding, from the source requirement):** storage is role.md + a config JSON + a table row; the kernel enforces only the JSON and the table, never the prose; the owner changes settings by editing the file or `studio agents set`; `off` never deletes; the id is stable, never reused, `wright` reserved; no role presets; limits optional (unset = no limit). Mechanism only — the kernel picks no model, limit or workspace (invariant 1).

## Acceptance Criteria
1. - [ ] Given a valid charter file for `mason`, when the owner runs `studio agents create --from <file>`, then one `agents` row (`status: active`, `created_by: owner`, `approval_id: null`, `charter_json` = the validated charter) and one `agent_created` event exist; `memory/mason/role.md` equals `renderRoleMd(charter)`; `config/agents/mason.json` reads back through `readAgentSettings` with model, effort, permission mode, tool policy, `never`, limits and workspaces equal to the charter; and `preferences.md`, `people.md`, `lessons.md` exist under `memory/mason/`, every file mode 0600.
2. - [ ] Given `config/agents/mason.json` (or any other target file) already exists, when `create` runs for `mason`, then it is refused `files_exist` naming that path, no row or event is written, and no other file is created.
3. - [ ] Given `mason` exists (active, or turned `off`), when a charter with id `mason` is created, then it is refused `id_taken`. Given id `wright`, `shared`, `Mason` or `1x`, then it is refused naming the id rule (`agent_id_invalid`). A refusal for any invalid field (`validateCharter`) names the field and writes nothing.
4. - [ ] Given a created `mason` whose `role.md` was deleted, when `ensureAgentFiles` runs, then `role.md` is re-created byte-equal from `charter_json` (create-if-absent), and an owner-edited `lessons.md` is left byte-for-byte untouched.
5. - [ ] Given `studio agents set mason limits.sessions_at_once 2`, then the file has that value, every other key of its parsed content is deep-equal to before, the write went through a temporary sibling + rename, and one `agent_settings_set` event records field, old and new value. Given `set mason limits.sessions_at_once 0` (or a non-integer, or an unknown field), then it is refused, exit 1, and the file is byte-unchanged. `none` clears a limit.
6. - [ ] Given `studio agents rename mason "Mason the Reviewer"`, then only `display_name` (and `updated_at`) change and one `agent_renamed` event is written; id, folder and files are unchanged. Given `off mason`, then its status is `off`, every file still exists, one `agent_status_changed` event (`by: owner`) is written, and `list` shows it off; `on mason` reverses it. `off`/`rename`/`set` on `wright` are refused `reserved` (intentionally distinct from create's `agent_id_invalid`: Wright exists but is edited through `wright.json`, while a create names an id no crew member may take).
7. - [ ] Given a display name holding an escape sequence (e.g. `\u001b[31m`), when `list` (and `show`) prints it, then it is shown escaped (the `shown`/`printable` idiom `studio approvals` uses) and not interpreted.
8. - [ ] Given Wright and registered members, when the owner runs `list [--json]`, then it prints Wright first (from `wright.json`: model) then every registered member re-sorted by id (not `listAgents`' `created_at, id` order), each with id, display name, avatar, status, model, today's counted tokens against `tokens_per_day` (`no limit` when unset), running sessions against `sessions_at_once`, and `created_by`; `show <id> [--json]` adds the settings path and parsed content, `never`, workspaces, memory file paths (and which are missing) and the charter's prose sections. Today's tokens come from the budget's existing per-agent day total (`agentCountedTokens` with `localDay`), never a new computation.
9. - [ ] `docs/architecture/agents.md` documents the charter shape, the files, create and self-heal, the verbs and routes, the events and the honest limits, and shows the `role.md` rendered from one example charter verbatim between `<!-- role-example:start -->` / `<!-- role-example:end -->` markers; `kernel/test/agents-roster.test.ts` pins that block equal to the renderer's output; `bash scripts/check-docs.sh` passes.
10. - [ ] `cd kernel && npm ci && npm run typecheck && npm test` passes, including the updated `kernel/test/agents-foundation.test.ts`; `kernel/test/feature-seams.test.ts` still passes, unchanged (the `studio` CLI's module graph still never loads the Agent SDK).

## Touched-file invariants

> Grounded at base `0fbe903b7c64522529ae04eea81ac5d3af146729`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/agents/roster.ts`** — keep: the part shape and freezing, `export const rosterPart: AgentPart = Object.freeze({` with `name: "roster"`, and only this file's part grows (`./index.ts` merges every part in `AGENT_PARTS`); a verb may not be named `help` (`the verb "${AGENTS_HELP_VERB}" is the built-in help` in `index.ts`); keep the CLI-loadable import rule — the `studio` CLI loads this module, so it imports only types, zod, `node:*` and leaf modules, never the Agent SDK (`kernel/src/budget/cap.ts` and `kernel/src/budget/index.ts` load `@anthropic-ai/claude-agent-sdk` at runtime, so import `agentCountedTokens` / `localDay` from `kernel/src/budget/internal.ts` only — never `../budget/index.js` or `BudgetMeter`); reuse: `shown` / `payloadText` from `kernel/src/approvals/cli.ts` (or `printable` from `kernel/src/notifications/cli.ts`) for every stored string printed, `appendEvent` from `kernel/src/loop/internal.ts` for audit rows; mirror: `ContributedRoute` (`handler(req: ContributedRouteRequest)`, a JSON body, status 200–599 not 204/205/304) and `CliApiClient.request(method, path, body?)`; pinned by: `kernel/test/agents-foundation.test.ts` (`expect(AGENTS_HELP).toBe("studio agents <verb>");`, `no verbs yet`) and `kernel/test/feature-seams.test.ts` (`SDK_IN_GRAPH`).
- **`kernel/src/agents/index.ts`** — keep: `AGENT_PARTS` order `[rosterPart, delegatePart, charterToolsPart]`, `agentsHelp` stripping the `studio agents ` prefix, the help line at most 200 characters (`needs a one-line help (at most 200 characters)` in `kernel/src/features/contribution.ts`); reuse: the existing re-export block — add `validateCharter`, `createAgent`, `ensureAgentFiles`, `renderRoleMd` and the charter types as re-exports beside `export { rosterPart } from "./roster.js";`; companions: `.agent/companions.json` already couples `kernel/src/agents/index.ts` with `kernel/test/agents-foundation.test.ts`; pinned by: `kernel/test/agents-foundation.test.ts` (`expect(Object.keys(agentsContribution)).toEqual(["name", "subcommands"]);`).
- **`kernel/src/agents/memory.ts`** (read, not modified) — mirror: `ensureAgentMemoryFiles` creates `preferences.md`/`people.md`/`lessons.md` with `flag: "wx", mode: 0o600` and returns `charter_missing` when `role.md` is absent ("It never creates `role.md`"); `ensureAgentFiles` writes `role.md` (and `config/agents/<id>.json`) create-if-absent from `charter_json` and then calls `ensureAgentMemoryFiles`, never re-implementing the three memory templates.
- **`kernel/src/agents/settings.ts`** (read, not modified) — mirror: the crew schema is `.strict()` at the top level and in `tool_policy` (`const crewSchema = z.object({ ...shape, tool_policy: z.object(toolPolicyShape).strict() }).strict();`), limits are positive safe integers (`const limit = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);`), workspaces go through `workspaceProblem` (D31 + data dir); the rendered `config/agents/<id>.json` must use exactly these keys (`model`, `effort`, `permission_mode`, `tool_policy: {status?, allowedTools, allowedBashPrefixes}`, `never`, `limits`, `workspaces`) and stay under `MAX_SETTINGS_BYTES`, so `readAgentSettings` reads it back ok; `set` re-validates the whole rewritten file with `readAgentSettings` semantics before the rename.
- **`kernel/test/agents-foundation.test.ts`** — keep every assertion about the delegate and charter-tools parts, the merge refusals, the settings reader and the memory reader; change ONLY the assertions that pin the roster part empty (`expect(AGENTS_HELP).toBe("studio agents <verb>");`, `expect(mergeAgentParts(AGENT_PARTS).verbs).toEqual([]);`, the `for (const part of AGENT_PARTS)` empty-part loop, `` `${AGENTS_HELP}\nno verbs yet\n` ``, `expect(Object.keys(agentsContribution)).toEqual(["name", "subcommands"]);`, `expect(merged.routes).toEqual([]);`, the help-line pin `expect(merged.subcommands.map((s) => [s.name, s.help])).toEqual([["agents", "studio agents <verb>"]]);`, and the now-false test titles `one verb-less agents subcommand, no tool, route`, `is built from three frozen, empty parts` and `` the help then `no verbs yet` on stdout ``) so they now pin the roster's verbs/routes and the delegate and charter-tools parts still empty.

## Closed enumerations touched

> Sibling grep at base `0fbe903b7c64522529ae04eea81ac5d3af146729`: `grep -rnF 'playbook_created' kernel/src kernel/test` → the per-feature audit-kind lists `PLAYBOOK_AUDIT_KINDS` (`kernel/src/playbooks/store.ts`), `TRIGGER_AUDIT_KINDS` (`kernel/src/triggers/store.ts`), `APPROVAL_AUDIT_KINDS` (`kernel/src/approvals/store.ts`), each pinned by its feature's test (`expect(PLAYBOOK_AUDIT_KINDS).toEqual([` in `kernel/test/playbooks-drafts.test.ts`). There is no global list of event kinds (`events.kind` is free TEXT), so no existing list is extended.

- **`agent_created`, `agent_renamed`, `agent_settings_set`, `agent_status_changed`** (sibling: `playbook_created`) — must be named in:
  - `kernel/src/agents/charter-files.ts` — a NEW `export const AGENT_AUDIT_KINDS = ["agent_created", "agent_renamed", "agent_settings_set", "agent_status_changed"] as const;` following the per-feature pattern — create; every `appendEvent` call in the roster uses a member of it.
  - `kernel/test/agents-roster.test.ts` — pins `AGENT_AUDIT_KINDS` with `toEqual` — create.
  - `kernel/src/playbooks/store.ts`, `kernel/src/triggers/store.ts`, `kernel/src/approvals/store.ts` — no change: per-feature lists, not shared.
- **Refusal codes `id_taken`, `files_exist`, `reserved`** (sibling: `agent_id_invalid`, `settings_invalid`) — must be named in:
  - `kernel/src/agents/charter-files.ts` — the `CreateAgentRefusal` / roster refusal union type (closed in TypeScript) — create.
  - `kernel/src/agents/settings.ts` (`AgentSettingsRefusal`) and `kernel/src/agents/memory.ts` (`EnsureAgentMemoryResult`) — no change: their own reader refusals, not the create path's.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-roster.test.ts` — the `role-example` docs block equals `renderRoleMd` (AC9) | change one character of the fixed closing section text in `renderRoleMd` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/agents-roster.test.ts` — every created file is mode 0600 and never overwritten (AC1, AC2, AC4) | flip `flag: "wx"` → `flag: "w"` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/agents-roster.test.ts` — `set` writes through a temporary sibling + rename and leaves the file byte-unchanged on refusal (AC5) | replace the `renameSync(` of the temp sibling with a direct `writeFileSync(` of the settings path in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-roster.test.ts` — escaped display name in `list`/`show` (AC7) | delete the `shown(` wrapper around the display name in the `list` line formatter in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-roster.test.ts` — `id_taken` against an `off` row (AC3) | add `AND status = 'active'` to the id-taken query in `kernel/src/agents/charter-files.ts` |
| `kernel/test/agents-roster.test.ts` — a refused create writes no row and no event (AC2) | move the `files_exist` check after the row insert in `createAgent` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/agents-roster.test.ts` — `AGENT_AUDIT_KINDS` | delete `"agent_status_changed"` from `AGENT_AUDIT_KINDS` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/agents-foundation.test.ts` — the roster's verbs in `AGENTS_HELP` (changed pin) | delete the `off` verb from `rosterPart`'s `verbs` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-foundation.test.ts` — `merged.routes` / `Object.keys(agentsContribution)` pin the roster's routes (changed pins) | delete the `POST /agents/:id/off` route from `rosterPart`'s `routes` in `kernel/src/agents/roster.ts` |

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| agents roster | `kernel/src/agents/roster.ts`, `kernel/src/agents/index.ts` | `kernel/src/agents/charter-files.ts` | HIGH |
| tests | `kernel/test/agents-foundation.test.ts` | `kernel/test/agents-roster.test.ts` | HIGH |
| docs | `docs/architecture/agents.md` (extend the existing 3-line stub; keep its `# Agents` heading) | — | HIGH |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Charter, files, create/self-heal, roster routes + verbs, docs, tests | all | 4 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/agents/charter-files.ts"}
  - {kind: "symbol", path: "kernel/src/agents/charter-files.ts", name: "validateCharter"}
  - {kind: "symbol", path: "kernel/src/agents/charter-files.ts", name: "createAgent"}
  - {kind: "symbol", path: "kernel/src/agents/charter-files.ts", name: "ensureAgentFiles"}
  - {kind: "symbol", path: "kernel/src/agents/charter-files.ts", name: "renderRoleMd"}
  - {kind: "type", path: "kernel/src/agents/charter-files.ts", name: "Charter"}
  - {kind: "symbol", path: "kernel/src/agents/roster.ts", name: "rosterPart"}
  - {kind: "file", path: "kernel/test/agents-roster.test.ts"}
  - {kind: "symbol", path: "docs/architecture/agents.md", name: "role-example:start"}
requires: []
lanes:
  - "kernel/src/agents/charter-files.ts"
  - "kernel/src/agents/roster.ts"
  - "kernel/src/agents/index.ts"
  - "kernel/test/agents-roster.test.ts"
  - "kernel/test/agents-foundation.test.ts"
  - "docs/architecture/agents.md"
external_requires: []
```

### Design notes (for the worker)

- **Charter shape** (`charter-files.ts`): `id`, `display_name`, `avatar: {shape, hue}` (`AVATAR_SHAPES` / `AVATAR_HUES`), `persona` (1–2 lines), `duties` (string[]), `boundaries` (string[]), `model`, `effort?`, `permission_mode`, `tool_policy: {allowedTools, allowedBashPrefixes, never}` (`never` ⊆ `NEVER_CATEGORIES`), `limits?` (`tokens_per_day`, `sessions_at_once`, `delegation_depth`, each a positive safe integer), `workspaces` (absolute paths). Strict zod: unknown keys refused; bounds on every text field (lengths, line counts, no control characters except where stated). `validateCharter(input, {dataDir, homeDir?})` returns `{ok:true, charter}` or `{ok:false, error, field, message}` — refusal names the field.
- **Settings file mapping:** `config/agents/<id>.json` = `{model, effort?, permission_mode, tool_policy: {status: "proposed"?, allowedTools, allowedBashPrefixes}, never, limits?, workspaces}` — the charter's `tool_policy.never` maps to the top-level `never` key (the crew reader's `tool_policy` is strict and has no `never`). Rendered with stable key order and `JSON.stringify(…, null, 2) + "\n"`.
- **`createAgent(store, dataDir, charter, {by, approvalId?}, now)`:** validate → refuse `agent_id_invalid` / `id_taken` (checked against every row, `off` ones included) / `files_exist` (any target path present, named) → insert the row (`charter_json`) and the `agent_created` event in ONE `store` transaction → then write the files with `wx` + mode 0600 (dirs 0700). A crash after the commit is healed by `ensureAgentFiles`. Exported for item 07 (`by: "wright"`, `approvalId`).
- **`ensureAgentFiles(store, dataDir, id)`:** the requirement writes `ensureAgentFiles(dataDir, id)`, but `charter_json` lives in the store, so the function takes the store too (`store.dataDir` may be used as the data dir). It re-renders `role.md` and `config/agents/<id>.json` from `charter_json` create-if-absent, then calls `ensureAgentMemoryFiles`. Never overwrites an existing file.
- **Routes** (bearer token, under `/agents`): `GET /agents`, `GET /agents/:id`, `POST /agents` (body: the charter), `POST /agents/:id/rename`, `POST /agents/:id/set`, `POST /agents/:id/off`, `POST /agents/:id/on`. Refusals are 4xx with `{error, field?, file?, message}`. The CLI reads `--from <file>` locally (JSON, size-capped) and POSTs it; every refusal is one stderr line, exit 1; bad usage prints the verb's usage, exit 2.
- **Events** (`events` table via `appendEvent`): `agent_created {id, by, approval_id}`, `agent_renamed {id, old, new}`, `agent_settings_set {id, field, old, new}`, `agent_status_changed {id, old, new, by: "owner"}`.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Scope near the `context-bound` bound (~6 files, possibly >800 changed lines, mostly tests) — Feasibility (Phase 2.5) | MEDIUM | Keep tests table-driven; reuse existing helpers (`appendEvent`, `shown`, `agentCountedTokens`, `ensureAgentMemoryFiles`, the agents-foundation test's temp-dir/`studio()` harness pattern) instead of new ones. |
| `set`'s atomic rewrite can lose an owner hand edit made between the re-read and the rename | MEDIUM | Re-read and re-validate immediately before writing through a temporary sibling + `rename`; document the window as an honest limit in `docs/architecture/agents.md` (requirement Risks). |
| Half-created agent: crash between the row commit and the file writes | MEDIUM | Row + event in one transaction, then `wx` file writes; `ensureAgentFiles` re-creates any missing file from `charter_json`; test the crash shape by deleting a file after create. |
| Pulling the Agent SDK into the `studio` CLI's module graph (e.g. importing `BudgetMeter` or the session manager into `roster.ts`) | HIGH | Import `agentCountedTokens` / `localDay` from `kernel/src/budget/internal.ts` and session counts by a direct `store` query; `kernel/test/feature-seams.test.ts`'s `SDK_IN_GRAPH` guard must stay green. |
| Terminal injection through stored display names / charter prose | MEDIUM | Print every stored string through `shown`/`printable`; AC7 pins it. |
| Other wave lanes (phase 4 items 03–08) also edit `kernel/src/agents/*` or `agents-foundation.test.ts` | LOW | This item edits only the roster part, `charter-files.ts`, the index re-exports and the roster-specific foundation assertions; the wave build merges lane PRs and stops on a real conflict. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-18-crew-roster-create-list-rename-set-off.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-18T10:30:24Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/87
- **Branch:** feature/phase4-02-crew-roster
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Filled the agents roster part: charter validator and renderers, all-or-nothing createAgent, ensureAgentFiles self-heal, seven /agents routes and studio agents verbs, agents.md with renderer-pinned examples. Phase 4.5 iteration 1 (PASS + 1 MEDIUM test-coverage gap) fixed in 091facf; iteration 2 PASS. 6 LOW findings dismissed below the MEDIUM fix floor. Required CI green.

## Not verified
- **set's settings_changed refusal on a concurrent hand edit** — no seam to inject an edit between the read and the rename (subtask 1; the iteration-1 fix later added a test for it through a transaction spy)
- **studio agents verbs against a live daemon (startKernel)** — verified only via runCli against a real startApiServer (subtask 1)
