# Supervisor Job: Phase 4 foundation — migration 14 (agents table, four brain_messages columns), one settings and one memory reader for every agent, an empty agents contribution with three parts, the closed `never` categories and the boundary call site, the two charter tools always held and kernel-applied, Wright's four reserved tool names

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 2 (an app-made detached worktree `.claude/worktrees/xenodochial-kapitsa-320120` exists, not ours, leave it; a leftover worktree `../loomwright-studio-p4-companions` on the already-merged branch `chore/phase-4-companions` (PR #82), not ours, leave it)
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-18-041101-phase-4-foundation-agent-registry-schema-seams-and-shared-settings.md
- **Base commit:** 82f5ef2715c6f74af1c6e5c12631432a78d244f1

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + better-sqlite3 + zod + vitest, all in `kernel/package.json`. |
| 2 | Dependency Availability | GO | No new dependency. |
| 3 | Architecture Fit | GO | Phase 3 set the pattern this mirrors: function-form migration 13 with `PRAGMA table_info` guards, `PLAYBOOK_PARTS` / `mergePlaybookParts`, `ALWAYS_HELD_TOOLS`, `KERNEL_APPLIED_ACTIONS` with the `no_applier` fail-closed path. |
| 4 | Scope vs Supervisor Capability | CAUTION | ~31 files (migration + store pins, sessions policy/manager, approvals, a new `kernel/src/agents/` module of 8 files, brain settings/template, docs). Over one worker's bound (> 12 files), so the brief splits (`context-bound`). |
| 5 | Hard Blockers | GO | None. `cd kernel && npm test` and `bash scripts/check-docs.sh` run locally; `kernel/node_modules` is present. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Create phase 4's schema, shared readers and extension points in ONE change so items 02–08 each edit only their own files: migration 14 (`agents`, and `brain_messages.from_agent` / `depth` / `reply_to` / `workspace`); `kernel/src/agents/` with the closed value sets, `readAgentSettings`, the per-agent memory reader, read-only registry lookups and an empty `agents` contribution of three parts; the closed `never` categories and a `boundaryDecision` stub called by the session gate; `kernel_agent_create` / `kernel_agent_update` always held and kernel-applied; and Wright's four `kernel_agent_*` names reserved.

**Problem Statement:**
The owner running phase 4 through `/automate --parallel` needs the shared kernel files to gain their phase 4 seams first. Today no `agents` table exists (migration 001: "No phase-2+ tables: agents, …"), the only settings reader is `readWrightSettings` for `config/agents/wright.json`, and the migrations list, the features registry, the session policy's fixed sets, the approvals' kernel-applied set, Wright's tool list and `docs/ARCHITECTURE.md` would be edited by every item, so no two items could share a wave.
Success looks like: the shipped daemon behaves exactly as today plus one `studio agents` subcommand that prints help; Wright's settings, memory, messages, dry runs and fires are byte-identical.

## Acceptance Criteria
- [ ] AC1 — Given a fresh store, when migrations run, then `schema_migrations` reaches version 14 (name `agents`), `agents` exists with exactly the columns Design decision 1 lists, and `brain_messages` has the four new columns. Given a store at version 13 with `brain_messages` rows (and earlier rows), when it upgrades, then every existing `brain_messages` row reads `from_agent` null, `depth` 0, `reply_to` null, `workspace` null and keeps every other value; every object other than `brain_messages` keeps its stored text; and the integrity check passes before and after.
- [ ] AC2 — Migration 14 is safe to re-run on a database that already has its objects (the existing "deleted top row(s)" and "a re-run of migrations 11 to …" store tests re-run it as a no-op and pass).
- [ ] AC3 — Given the shipped contributions, when they merge, then `agents` is the seventh contributor (after `playbooks`) and registers no tool, route, handler or due work; its only part is the one `agents` subcommand with zero verbs. `runCli(["agents"])` prints the agents help to stdout and returns 0; an unknown verb prints the help to stderr and returns 2; both pass the `api.json` pid check first. `kernel/test/agents-foundation.test.ts` pins this, and `feature-seams.test.ts` pins only the contributor order.
- [ ] AC4 — Given `config/agents/mason.json` with a valid `never`, `limits` and `workspaces`, when `readAgentSettings(dataDir, "mason")` runs, then it returns them. Given an unknown `never` category, a non-positive-integer limit, a relative workspace, or a workspace inside a `PROTECTED_LOCATIONS` folder or inside the data dir, then it refuses `settings_invalid` naming the file and the field. Given no file for `mason`, then it refuses `settings_missing` naming the file and creates nothing. Given an id that breaks the id grammar, then it refuses `agent_id_invalid` and reads nothing.
- [ ] AC5 — Given a fresh data dir, when Wright's settings are read, then `wright.json` is created with today's content plus the four `kernel_agent_*` names (and no `never`, `limits` or `workspaces`), and every existing `brain.test.ts` pin passes unchanged apart from that list; `readWrightSettings` returns exactly today's result shapes (`model_unset`, `settings_invalid` without a `field` key).
- [ ] AC6 — Given a crew id whose `memory/<id>/role.md` is absent, when `ensureAgentMemoryFiles(dataDir, id)` runs, then it creates `preferences.md`, `people.md` and `lessons.md` with exclusive create (an existing file keeps its bytes), never `role.md`, and reports `charter_missing`; for `wright` it does exactly what `ensureMemoryFiles` does today.
- [ ] AC7 — Given a session policy with `never: ["git_push"]`, when the manager validates it (`startSession` / `resumeSession`), then it is accepted and the frozen policy keeps `never`; given `never: ["push_everything"]` (or a non-array), then the session is refused `invalid_params` before any row or spawn.
- [ ] AC8 — Given a session whose policy allows `mcp__kernel__kernel_agent_create` (and, separately, `…_update`), when it calls the tool, then the call is classified outward and held as a pending approval; an `always` decision on it is refused `always_not_supported`; and a `once` decision with no applier registered is recorded `apply_refused: no_applier`.
- [ ] AC9 — With `boundaryDecision` returning "no boundary" for every call, every existing session-gate test passes unchanged (a held outward call is still held, a granted one still uses its grant).
- [ ] AC10 — `docs/ARCHITECTURE.md` rewrites the `agents` data-model row (registry in the table, enforced settings in `config/agents/<id>.json`, charter in `memory/<id>/role.md`), adds the four columns to the `brain_messages` row, replaces the planned `kernel_agent_create / kernel_agent_update` bullet with the four phase 4 tools, and adds a "Phase 4 features" section linking `docs/architecture/agents.md` and `docs/architecture/delegation.md` (each a heading plus "Documented by the item that builds it"); `docs/architecture/approvals.md`'s three "today only …" sentences name the three always-held tools / two more kernel-applied actions; `bash scripts/check-docs.sh` passes.
- [ ] AC11 — `cd kernel && npm ci && npm run typecheck && npm test` passes. Existing tests pass unchanged except the pins listed under Closed enumerations touched and Touched-file invariants (schema version 14, contributor `agents`, the three kernel-applied/always-held lists, the proposed tool list, the two `playbooks-foundation.test.ts` pins).

## Design decisions the workers must follow (from the source requirement + analysis)

1. **Migration 14 (`kernel/src/store/migrations/014_agents.ts`, export `agentRegistry`, version 14, name `agents`)**, appended after `playbooks` in `index.ts`. Copy migration 13's shape: ISO-8601 UTC TEXT with the same `NOW` idiom, a header saying it creates no SQL trigger and is safe to re-run, **no SQL CHECK** (value sets closed in code), `CREATE TABLE IF NOT EXISTS`, and a FUNCTION `up` that runs the table DDL then adds each column only when `pragma_table_info` does not list it (the `COLUMNS` array idiom).
   - `agents`: `id TEXT PRIMARY KEY`, `display_name TEXT NOT NULL`, `avatar_shape TEXT NOT NULL`, `avatar_hue TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'active'` (`active` / `off`), `created_by TEXT NOT NULL` (`owner` / `wright`), `approval_id INTEGER REFERENCES approvals(id)` (nullable), `charter_json TEXT NOT NULL`, `created_at TEXT NOT NULL DEFAULT NOW`, `updated_at TEXT NOT NULL DEFAULT NOW`.
   - `brain_messages` columns: `from_agent TEXT` (nullable), `depth INTEGER NOT NULL DEFAULT 0`, `reply_to INTEGER REFERENCES brain_messages(id)` (nullable), `workspace TEXT` (nullable). SQLite fills every existing row with the default.
   - Do not touch `events` or its triggers (`APPEND_ONLY_OBJECTS`).
2. **Closed value sets and the message contract (`kernel/src/agents/types.ts`)**, `readonly` frozen arrays plus union types: `AGENT_STATUSES` (`active`, `off`), `AGENT_CREATED_BY` (`owner`, `wright`), `RESERVED_AGENT_IDS` (`wright`, `shared`, `_unassigned`), `AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/` with `isValidAgentId(id)` (grammar AND not reserved — `wright` is valid only through the explicit Wright paths below), `AVATAR_SHAPES` (`shark`, `seahorse`, `octopus`, `turtle`, `jellyfish`, `fish`, `crab`; `whale` is Wright's and not in the list), `AVATAR_HUES` (`crew-teal`, `crew-sky`, `crew-berry`, `crew-olive`, `crew-slate` — the `crew-*` names in `docs/design/tokens.json`), `MESSAGE_PHASE4_FIELDS` (`from_agent`, `depth`, `reply_to`, `workspace`) with an `AgentMessageFields` interface (`from_agent: string | null; depth: number; reply_to: number | null; workspace: string | null`), and the `AgentPart` / `AgentVerb` types (the `PlaybookPart` / `PlaybookVerb` shape from `kernel/src/playbooks/types.ts`). A header comment says the id is never reused, even after `off`. Imports: types and zod only.
3. **One settings reader (`kernel/src/agents/settings.ts`)**: `readAgentSettings(dataDir: string, id: string, options?: { homeDir?: string }): AgentSettingsResult` (`homeDir` defaults to `os.homedir()`, a seam for tests). It reads `config/agents/<id>.json` with today's wright.json schema, size limit and JSON/unreadable handling (move that logic here from `brain/settings.ts`, do not copy it), plus three optional fields: `never` (array of `NEVER_CATEGORIES` values, imported from `kernel/src/sessions/policy.ts`), `limits` (object with optional `tokens_per_day`, `sessions_at_once`, `delegation_depth`, each a positive safe integer) and `workspaces` (array of absolute paths; each must be absolute, `!isProtectedPath(path, homeDir)` from `kernel/src/protected-paths.ts`, and not equal to or inside `dataDir` after `resolve`). Results: `{ ok: true, file, settings }` (the same `file` today's Wright ok result carries) | `model_unset` (today's shape, `field: "model"`) | `{ ok: false, error: "settings_invalid", file, field, message }` (`field` = the zod issue path joined with `.`, or `"the file"`, and the message keeps today's `${file}: ${where}: …` text) | `{ ok: false, error: "settings_missing", file, message }` | `{ ok: false, error: "agent_id_invalid", message }`. For `wright` only: create-if-absent exactly as today (`wx`, `0o600`, dir `0o700`). For any other id: an id failing `isValidAgentId` ⇒ `agent_id_invalid` before any filesystem call; a missing file ⇒ `settings_missing`, nothing created. `readWrightSettings(dataDir)` in `kernel/src/brain/settings.ts` becomes a thin call to `readAgentSettings(dataDir, "wright")` that maps a `settings_invalid` result back to today's shape (no `field` key) and keeps its exported types, so every caller (`brain/routes.ts`, `brain/handler.ts`, `playbooks/dry-run.ts`, `playbooks/runs.ts`) and every pin is unchanged. `defaultWrightSettingsJson` gains no `never`, `limits` or `workspaces` (invariant 1). Update `brain/settings.ts`'s header (`zod, \`node:*\` and types (the \`studio\` CLI loads this module).`): it now also imports `../agents/settings.js` (which imports the leaf `sessions/policy.ts`), still never the SDK, the session manager or `kernel.ts`.
4. **One memory reader (`kernel/src/agents/memory.ts`)**: `agentMemoryDir(dataDir, id)` (`wrightMemoryDir` for `wright`, else `join(memoryDir(dataDir), id)`) and `ensureAgentMemoryFiles(dataDir, id)`. For `wright` it calls `ensureMemoryFiles(dataDir)` and returns `{ ok: true }`. For a crew id (must pass `isValidAgentId`, else `agent_id_invalid`): create the dir (`0o700`), then `preferences.md`, `people.md`, `lessons.md` with `{ flag: "wx", mode: 0o600 }` ignoring `EEXIST` (short one-line templates of the crew member's own), never `role.md`; when `role.md` is absent return `{ ok: false, error: "charter_missing", file }` (after creating the other three). `kernel/src/brain/memory.ts` keeps all its exports unchanged.
5. **Registry lookups (`kernel/src/agents/registry.ts`)**, read-only: `AgentRow` (the table's columns), `getAgent(store, id): AgentRow | undefined`, `listAgents(store): AgentRow[]` (ordered by `created_at, id`), `isRoutable(store, id): boolean` (true for `wright`, true for a registered row with `status = 'active'`, false otherwise, including an invalid id). No write functions (item 02's).
6. **The agents shell (`kernel/src/agents/`)**: `roster.ts` (item 02), `delegate.ts` (item 06), `charter-tools.ts` (item 07) each export one EMPTY frozen `AgentPart` (`rosterPart`, `delegatePart`, `charterToolsPart`; part names `roster`, `delegate`, `charter-tools`). `index.ts` exports `AGENT_PARTS` (those three, in that order), `mergeAgentParts(parts)` (refuses a verb or handler kind claimed by two parts with `ContributionConflictError` naming both parts, `part: "subcommand"` / `"handler"`, and a verb named `help` with `InvalidContributionError` — exactly `mergePlaybookParts`'s rules), `AGENTS_HELP` (`studio agents <verb>` then each verb's help joined with ` | `; today exactly `studio agents <verb>`; ≤ 200 chars, one line), and `agentsContribution` carrying only its non-empty keys (today `name` and `subcommands`). The subcommand `agents`: `run([])` / `run(["help"])` prints the help line then `no verbs yet` to stdout, returns 0; an unknown verb prints `studio agents: unknown verb "<v>"` and the help to stderr, returns 2. It also re-exports the public API of `types.ts`, `settings.ts`, `memory.ts`, `registry.ts`. Import rule: never the Agent SDK, the session manager or `kernel.ts` (the CLI loads this module; `feature-seams.test.ts`'s module-graph pin covers it). Note `settings.ts` imports `sessions/policy.ts`, which is a leaf (node:path, protected-paths, a type) — allowed.
7. **Registration.** `kernel/src/features/index.ts` appends `agentsContribution` as the SEVENTH entry of `SHIPPED_CONTRIBUTIONS` and updates its header comment.
8. **The closed `never` categories (`kernel/src/sessions/policy.ts`)**: `export const NEVER_CATEGORIES` (frozen) with `NeverCategory` type, one category per outward form the rail already emits (the doc comment maps each to its rail labels, which item 03 matches):
   - `git_push` — every `GIT_OUTWARD` label and `git p4 submit` (`git push`, `git send-pack`, `git http-push`, `git svn dcommit`, `git svn set-tree`, `git send-email`, `git imap-send`, `git cvsexportcommit`, `git p4 submit`): every git form that sends commits or patches off the machine;
   - `alias_define` — `git alias` and `gh alias set|import`;
   - `gh_pr_create`, `gh_pr_comment`, `gh_pr_review`, `gh_pr_edit`, `gh_pr_close`;
   - `gh_issue_create`, `gh_issue_comment`, `gh_issue_edit`, `gh_issue_close` (the rail has no `gh issue review` form, so there is no such category — say so in the comment);
   - `gh_api_write` — `gh api <VERB>` other than GET, and `gh api (flag unread)`;
   - `settings_write` — the `~/.claude/` and `a settings*.json file` targets, Bash and Write/Edit/NotebookEdit forms;
   - `hooks_write` — the `a hooks file` target, both forms.
   Also in `policy.ts`: `ToolDecisionReason` (or the reason union the gate's `GateReason` extends) gains `"agent_boundary"`; `export function boundaryDecision(policy: ToolPolicy, rail: Extract<ToolCallClass, { kind: "outward" }>): { kind: "none" } | { kind: "boundary"; category: NeverCategory }` that returns `{ kind: "none" }` for every call today (doc: item 03 fills it with the rail's own matchers; a boundary is denied outright, never held, never covered by a grant); and `freezePolicy` copies `never` (frozen) when present — today it copies only `allowedTools` and `allowedBashPrefixes` and would silently drop it.
9. **`ToolPolicy` and the manager.** `ToolPolicy` (`kernel/src/sessions/types.ts`) gains `readonly never?: readonly NeverCategory[]` (import the type from `policy.ts`; `types.ts` is type-only, avoid a cycle by `import type`). `checkPolicy` (`manager.ts`) refuses a present `never` that is not an array of `NEVER_CATEGORIES` values with `SessionError("invalid_params", …)` naming the bad value, before any row or spawn. The gate (`manager.ts` around the `else if (rail.kind === "outward")` branch): when `rail.kind === "outward"`, call `boundaryDecision(policy, rail)` FIRST — before the dry-run branch (so a never-listed call is denied in a dry run too, not recorded as a would-do) and before `heldToolCheck` / `holdOrUseGrant`. On `{ kind: "boundary" }` deny the call through the same deny path a rail `deny` takes (`decision = "deny"`, `reason = "agent_boundary"`), so the `tool_decision` event's reason and the hook's `permissionDecisionReason` are the bare token `agent_boundary` exactly as `protected_kernel_path` is; the `tool_decision` event (`toolDecisionPayload(tool, decision, reason, command, approvalId)`) has no detail slot, so the category is NOT recorded in it here — item 03 adds it if wanted. No approval row, no grant lookup. Type `boundaryDecision`'s second parameter as the `outward` member of `ToolCallClass` (`Extract<ToolCallClass, { kind: "outward" }>`). On `{ kind: "none" }` nothing changes. `manager.ts` is otherwise unchanged.
10. **Charter tools always held and kernel-applied.** Append `mcp__kernel__kernel_agent_create` and `mcp__kernel__kernel_agent_update` to `ALWAYS_HELD_TOOLS` (`policy.ts`) and to `KERNEL_APPLIED_ACTIONS` (`kernel/src/approvals/store.ts`), after the enable. No applier is registered (item 07), so an owner `once` is recorded `apply_refused: no_applier` by the existing path; `tools/server.ts`'s composition check (every kernel-applied action is always held) keeps passing. Update the pins in `sessions-policy.test.ts` (title "today only kernel_playbook_enable" and the `toEqual`), `approvals.test.ts` (`KERNEL_APPLIED_ACTIONS` `toEqual`) and `kernel-tools.test.ts` (the applier-set checks: the shipped composition's only applier is still the enable's), and add the AC8 tests: the held half in `sessions.test.ts`, mirroring `it("kernel_playbook_enable is always held: an allowing policy only gets a pending approval` (around line 2814) for `kernel_agent_create` and `kernel_agent_update`; the `always_not_supported` and `apply_refused: no_applier` halves in `approvals.test.ts` beside the existing always-held / kernel-applied tests.
11. **Wright's reserved tool names.** Append, in this order, `mcp__kernel__kernel_agent_create`, `…_update`, `…_list`, `…_message` to `PROPOSED_ALLOWED_TOOLS` AFTER `mcp__kernel__kernel_request_stop` and before `Read` (so `brain.test.ts`'s position pin `allowed.slice(after, after + 7)` and the `["Read", "Glob", "Grep"]` pin hold unchanged). Add `- crew: kernel_agent_create, kernel_agent_update, kernel_agent_list, kernel_agent_message` to `ROLE_TEMPLATE`'s tool list (after `- playbooks:`), plus a short `## Your crew` section: when the owner asks for a crew member, draft a charter with `kernel_agent_create`; mark every value the owner did not state as proposed; put each "never …" into the enforced `never` list as well as the prose; delegate with `kernel_agent_message`; never act as a crew member or claim its work. Update BOTH blocks in `docs/architecture/brain.md` (role template between the markers, byte-equal; the `wright.json` JSON block) and the "reserved for phase 3" sentence with one for the four agent names (`wright.json` is create-if-absent, so an existing data dir keeps its old policy; the owner adds the names). Add a `brain.test.ts` assertion that the template carries the `- crew:` line and the doc carries each of the four names, mirroring the playbook assertions.
12. **Docs.** As AC10. The "Phase 4 features" section is short: the agents feature lives in `kernel/src/agents/` (`agentsContribution`, seventh, after playbooks) with one sub-file per item contributing through `AGENT_PARTS`; migration 14 creates `agents` and the four columns; the shared readers (`readAgentSettings`, `ensureAgentMemoryFiles`, registry lookups); `NEVER_CATEGORIES` and the `boundaryDecision` call site; the two charter tools always held and kernel-applied; links to the two stub pages; items 03, 04, 05 and 08 document on `approvals.md`, `budget.md`, `brain.md` and the playbook pages. Do not fix brain.md's other stale sentences (lines ~73, ~180) here.

## Touched-file invariants

> Grounded at base `82f5ef2715c6f74af1c6e5c12631432a78d244f1`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/store/migrations/index.ts`** — keep: `Append only; never edit a shipped one.`; migration 14 is appended after `playbooks,`, 001–013 untouched.
- **`kernel/src/store/migrations/013_playbooks.ts`** (read-only reference) — reuse: `const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";`, `SELECT name FROM pragma_table_info(?)` and `if (existing.all(table).includes(column)) continue;`, and the header wording `Creates no SQL trigger: the integrity check refuses any trigger the kernel`.
- **`kernel/test/store.test.ts`** — pinned by: `toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);` (six places) → add 14; the default-list test (title "… (migration 13)", table list ending `"playbook_runs",` → add `"agents"`, the loop `for (const later of ["agents", "hooks_installed", "connectors"]) {` → drop `"agents"`, the row `[13, "playbooks"],` → add `[14, "agents"]`); the three `.at(-1)` pins `toEqual([13, "playbooks"]);` → `[14, "agents"]`; the integrity strings `records versions 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, not a contiguous run from 1` and `records versions 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, not a contiguous run from 1` → add `, 14`; the comments `9 to 13 (no append-only object)`, `awaiting migrations 8 to 13`, `(9 to 13 are no-op re-runs)` → 14; the title `a re-run of migrations 11 to 13` → 14 (its `version >= 11` delete now re-runs 14 too); `expect(err.knownVersion).toBe(13);` (the "refuses a schema version newer than the kernel knows" test) → 14. **Forced by the ALTER:** the migration-12 test pins `.at(-1)` and `expect(columns(store, "brain_messages")).toEqual([` (11 columns) in the SAME test over `open()` — keep `open()`, make its `.at(-1)` `[14, "agents"]` like the other two, and extend that column list with the four new columns (do NOT slice this one); the migration-13 upgrade test asserts every non-`ALTERED` object keeps its stored text (`ALTERED` = sessions, approvals, event_queue) over `open()`; and the migration-13 re-run test runs `DELETE FROM schema_migrations WHERE version = 13` (with 14 recorded that leaves a gap). For those two, follow the precedent `// The upgrade this describe pins is to 12: migration 13 ALTERs sessions,` / `const V12 = migrations.slice(0, 12);` — run the migration-13 upgrade test at `migrations.slice(0, 13)`, and make the re-run test delete `version >= 13` — keep every other assertion, and say what you did in the hand-back. The migration-1-only loop (`["agents", "playbooks", "triggers", "approvals", "hooks_installed", "connectors"]`) stays unchanged. Mirror `describe("migration 13: playbooks"` for a new `describe("migration 14: agents"`.
- **`kernel/src/brain/settings.ts`** — keep: `export function readWrightSettings(dataDir: string): WrightSettingsResult {`, the result union (`error: "model_unset"; readonly file: string; readonly field: "model"` and `error: "settings_invalid"; readonly file: string; readonly message: string` — no `field`), `writeFileSync(file, defaultWrightSettingsJson(), { flag: "wx", mode: 0o600 });`, `MAX_SETTINGS_BYTES = 64 * 1024`, the message `Wright has no model: set "model" in ${file} (the kernel never picks one)`; `PROPOSED_ALLOWED_TOOLS` frozen with `Read`, `Glob`, `Grep` last.
- **`kernel/src/brain/templates.ts` / `docs/architecture/brain.md`** — pinned by `brain.test.ts` ``expect(`${block.slice(open + 1, close).join("\n")}\n`).toBe(ROLE_TEMPLATE);`` (doc == template byte for byte, between `<!-- role-template:start -->` / `<!-- role-template:end -->`), ``expect(ROLE_TEMPLATE).toContain(`\n- playbooks: ${PLAYBOOK_TOOL_NAMES.join(", ")}\n`);``, the fresh-file pin `expect(written).toEqual({`, the position pin `` expect(allowed.slice(after, after + 7)).toEqual([...PLAYBOOK_TOOL_NAMES.map((n) => `mcp__kernel__${n}`), "mcp__kernel__kernel_schedule_wakeup"]); `` and `expect(PROPOSED_ALLOWED_TOOLS.filter((t) => !t.startsWith("mcp__kernel__"))).toEqual(["Read", "Glob", "Grep"]);`.
- **`kernel/src/brain/memory.ts`** (read-only) — keep every export: `memoryDir`, `wrightMemoryDir`, `MEMORY_FILES`, `ensureMemoryFiles`, `readMemoryFile`; reuse `writeFileSync(path, file.template, { flag: "wx", mode: 0o600 });`.
- **`kernel/src/features/index.ts`** — keep: `` `SHIPPED_CONTRIBUTIONS` by default. The CLI imports this module, so neither `` / `` it nor anything it loads may import the Agent SDK, the session manager or `` (the comment wraps); `Object.freeze([` around the list; update `` 2 features, then phase 3's `playbooks`), in a fixed order. `` to name phase 4's `agents`.
- **`kernel/src/playbooks/index.ts`** (read-only reference) — reuse: ``throw new ContributionConflictError("subcommand", `${PLAYBOOKS_NAME} ${verb.name}`, [first, part.name]);``, `throw new ContributionConflictError("handler", kind, [first, part.name]);`, ``output.stdout.write(`${help}\n${verbs.length === 0 ? "no verbs yet\n" : ""}`);``.
- **`kernel/src/features/contribution.ts`** (read-only) — `const SUBCOMMAND_NAME = /^[a-z][a-z0-9-]{0,63}$/;` and the help rule `s.help.length > 200`.
- **`kernel/test/feature-seams.test.ts`** — pinned: `expect(SHIPPED_CONTRIBUTIONS.map((c) => c.name)).toEqual(["loomwright", "notifications", "triggers", "approvals", "brain", "playbooks"]);`, `expect(merged.contributors).toEqual([`, `expect(kernel.contributions.contributors).toEqual([` → each gains `"agents"`; the "the six features" title → seven. Keep every non-list test (collisions, naming, non-empty keys, module graph).
- **`kernel/test/playbooks-foundation.test.ts`** (outside the requirement's Touches, forced) — `expect(SHIPPED_CONTRIBUTIONS).toHaveLength(6);` and ``expect(r.stderr.endsWith(` | ${PLAYBOOKS_HELP}\n`)).toBe(true);`` break once a seventh contribution appends its help after it. Rewrite them so no later feature edits this file again: keep `expect(SHIPPED_CONTRIBUTIONS[5]).toBe(playbooksContribution);`, drop the length pin (the contributor order lives in `feature-seams.test.ts`), and assert the usage text contains `` ` | ${PLAYBOOKS_HELP}` `` as one whole `|`-separated entry. The new `agents-foundation.test.ts` must NOT pin "last line of the usage text" either (assert containment the same way).
- **`kernel/src/sessions/policy.ts`** — keep: `Kept here as literals so this module stays a leaf;` (imports only `node:path`, `../protected-paths.js`, a type); `classifyToolCall`'s branch order and doc steps 0–3; the labels `GIT_OUTWARD`, `GH_PR_OUTWARD`, `GH_ISSUE_OUTWARD`, `GIT_ALIAS_CONFIG` unchanged; `export const ALWAYS_HELD_TOOLS: readonly string[] = Object.freeze(["mcp__kernel__kernel_playbook_enable"]);` gains two names; `export function freezePolicy(policy: ToolPolicy): ToolPolicy {` must copy `never`.
- **`kernel/src/sessions/types.ts`** — `export interface ToolPolicy {` keeps `readonly allowedTools: readonly string[];` and `readonly allowedBashPrefixes: readonly string[];`; `never` is optional so every existing caller compiles.
- **`kernel/src/sessions/manager.ts`** — keep: `throw new SessionError("invalid_params", "policy must have string arrays allowedTools and allowedBashPrefixes");` and `return freezePolicy(p as ToolPolicy);`; `type GateReason = ToolDecisionReason | "kernel_gate_error" | "dry_run" | "held_refused";`; the outward branch's `heldToolCheck` and `const o = holdOrUseGrant(this.#store, call, this.#now());` inside `this.#store.transaction` unchanged.
- **`kernel/src/approvals/store.ts`** — keep: `` if (held !== undefined) return `always never covers ${held}: the owner decides every call to it; approve it once`; ``, `throw new ApprovalError("always_not_supported", refused);`, `` return outcome ?? { refused: "no_applier", text: `the kernel has no applier for ${tool}; nothing was done` }; ``; `export const KERNEL_APPLIED_ACTIONS = ["mcp__kernel__kernel_playbook_enable"] as const;` gains two names.
- **`kernel/test/sessions-policy.test.ts`** — pinned: `it("is the closed list of tools every call to which is held: today only kernel_playbook_enable", () => {` / `expect(ALWAYS_HELD_TOOLS).toEqual(["mcp__kernel__kernel_playbook_enable"]);`; the loop `for (const name of PROPOSED_ALLOWED_TOOLS) {` (outward iff in `ALWAYS_HELD_TOOLS`) passes automatically once Subtask 2 adds the names.
- **`kernel/test/approvals.test.ts`** — pinned: `expect(KERNEL_APPLIED_ACTIONS).toEqual(["mcp__kernel__kernel_playbook_enable"]);` (→ the three names) and the line after it, `for (const tool of KERNEL_APPLIED_ACTIONS) expect(ALWAYS_HELD_TOOLS).toContain(tool);` (keep).
- **`kernel/test/sessions.test.ts`** — keep the always-held behaviour test `it("kernel_playbook_enable is always held: an allowing policy only gets a pending approval (action kernel_playbook_enable, payload {tool, input, cwd}), and the call does not run", async () => {` unchanged; the AC8 held tests for `kernel_agent_create` / `kernel_agent_update` mirror it (`expect(approval[0]).toMatchObject({ status: "pending", action: "kernel_playbook_enable", requesting_session: handle.id });` with the agent action). The AC7 `never` tests go beside the existing invalid-params policy tests; no test pins the `policy must have string arrays allowedTools and allowedBashPrefixes` message, so a new `never` message may be added freely.
- **`kernel/test/kernel-tools.test.ts`** — keep: `for (const tool of KERNEL_APPLIED_ACTIONS) expect(ALWAYS_HELD_TOOLS).toContain(tool);` and `expect(() => approvalApplierOf([])).not.toThrow();` (the real sets pass — so both agent names must be in BOTH sets); the test `it("the shipped composition builds: its only applier is the enable's, a member of the set", () => {` with its `` .toEqual([`${KERNEL_MCP_SERVER_NAME}:kernel_playbook_enable`]) `` stays exactly as is (no agent applier is registered here) and gains `expect(KERNEL_APPLIED_ACTIONS).toContain("mcp__kernel__kernel_agent_create");` / `_update`.
- **`docs/architecture/approvals.md`** — the three sentences `(today only \`mcp__kernel__kernel_playbook_enable\`) gets one more step`, `full SDK tool names: today only \`mcp__kernel__kernel_playbook_enable\`.`, `` (`kernel/src/sessions/policy.ts`: `mcp__kernel__kernel_playbook_enable`). The owner decides every enable. `` — name the three tools and say item 07 registers the agent appliers.
- **`docs/ARCHITECTURE.md`** — keep the `## Data model` table format; rewrite (not duplicate) the `agents` row and the planned `` `kernel_agent_create / kernel_agent_update` `` bullet; links must resolve under `scripts/check-docs.sh` rule 1, so create the two stub pages in the same subtask.

## Closed enumerations touched

> Sibling grep at base `82f5ef2`: `grep -rnF '[13, "playbooks"]' kernel/test` → `kernel/test/store.test.ts` (4 hits); `grep -rnF '"brain", "playbooks"]' kernel/test` → `kernel/test/feature-seams.test.ts` (3 hits); `grep -rlF 'mcp__kernel__kernel_playbook_enable' kernel/src kernel/test docs` → `kernel/src/sessions/policy.ts`, `kernel/src/brain/settings.ts`, `kernel/src/approvals/store.ts`, `kernel/test/sessions.test.ts` (line 2814, the always-held behaviour test — the model for AC8's held test; not a list pin), `kernel/test/kernel-tools.test.ts`, `kernel/test/approvals.test.ts`, `kernel/test/phase-3-exit-live.test.ts` (playbook-tool lists for the phase 3 runbook; not a closed list of always-held tools — leave it), `kernel/test/sessions-policy.test.ts`, `docs/architecture/brain.md`, `docs/architecture/approvals.md`, `docs/evidence/phase-3-exit-runbook.md` and `docs/evidence/phase-3-exit-live-2026-10-18.json` (dated evidence — never edit); `grep -rnF 'toHaveLength(6)' kernel/test` → `kernel/test/playbooks-foundation.test.ts`.

- **schema version 14** (sibling: `13`) — `kernel/test/store.test.ts`, every pin in its Touched-file entry — extend.
- **contributor / subcommand `agents`** (sibling: `playbooks`) — `kernel/src/features/index.ts` `SHIPPED_CONTRIBUTIONS`; `kernel/test/feature-seams.test.ts` (three order pins); `kernel/test/playbooks-foundation.test.ts` (two pins, rewritten generically). Everything else computes from `SHIPPED_CONTRIBUTIONS`.
- **`ALWAYS_HELD_TOOLS`** (sibling: `mcp__kernel__kernel_playbook_enable`) — `policy.ts`, `sessions-policy.test.ts`, `approvals.md`.
- **`KERNEL_APPLIED_ACTIONS`** (sibling: same) — `approvals/store.ts`, `approvals.test.ts`, `kernel-tools.test.ts`, `approvals.md`.
- **`PROPOSED_ALLOWED_TOOLS` / role template tool list** (sibling: `mcp__kernel__kernel_request_stop`) — `brain/settings.ts`, `brain/templates.ts`, `docs/architecture/brain.md` (both blocks), `brain.test.ts`.
- **gate reason `agent_boundary`** (sibling: `protected_kernel_path`) — the `ToolDecisionReason` union in `policy.ts` (and any exhaustive switch over it the typecheck finds).
- **`NEVER_CATEGORIES`** (new closed list) — `policy.ts` only; `agents/settings.ts` and `manager.ts` import it.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/store.test.ts` — fresh store reaches 14 with `agents` and the four columns | delete `agentRegistry,` from the list in `kernel/src/store/migrations/index.ts` |
| `kernel/test/store.test.ts` — `knownVersion` is 14 for a too-new schema | delete `agentRegistry,` from the list in `kernel/src/store/migrations/index.ts` (the pin reads 13) |
| `kernel/test/store.test.ts` — a v13 store with message rows upgrades, `depth` 0 | change `DEFAULT 0` to `DEFAULT 1` for `depth` in `014_agents.ts` |
| `kernel/test/store.test.ts` — re-run of the top migrations is a no-op | remove the `pragma_table_info` guard before the `ADD COLUMN` in `014_agents.ts` |
| `kernel/test/agents-foundation.test.ts` — `agents` registered with one verb-less subcommand, no tools/routes/handlers | add a dummy verb to `rosterPart` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-foundation.test.ts` — `studio agents` prints help, exit 0 | make the no-verb branch of the agents subcommand return 2 |
| `kernel/test/agents-foundation.test.ts` — a verb claimed by two parts is refused naming both | delete the duplicate-verb throw in `mergeAgentParts` |
| `kernel/test/agents-foundation.test.ts` — a handler kind claimed by two parts is refused naming both | delete the duplicate-handler throw in `mergeAgentParts` |
| `kernel/test/agents-foundation.test.ts` — a verb named `help` is refused | delete the `help`-verb `InvalidContributionError` in `mergeAgentParts` |
| `kernel/test/agents-foundation.test.ts` — `studio agents <unknown>` prints help to stderr, exit 2 | make the unknown-verb branch return 0 |
| `kernel/test/agents-foundation.test.ts` — a bad id refuses `agent_id_invalid` with no filesystem call | make `isValidAgentId` return true |
| `kernel/test/agents-foundation.test.ts` — crew memory keeps an existing file's bytes | drop the `wx` flag in `agents/memory.ts` |
| `kernel/test/agents-foundation.test.ts` (or `brain.test.ts`) — a fresh `wright.json` has no `never` / `limits` / `workspaces` | add `never: []` to `defaultWrightSettingsJson` |
| `kernel/test/agents-foundation.test.ts` — unknown `never` category refused `settings_invalid` with field `never.0` | drop the `NEVER_CATEGORIES` enum check from the `never` schema in `agents/settings.ts` |
| `kernel/test/agents-foundation.test.ts` — a workspace inside `~/Documents` refused | delete the `isProtectedPath` check in `agents/settings.ts` |
| `kernel/test/agents-foundation.test.ts` — a workspace inside the data dir refused | delete the data-dir containment check in `agents/settings.ts` |
| `kernel/test/agents-foundation.test.ts` — missing crew file ⇒ `settings_missing`, nothing created | let the crew path fall through to the Wright create-if-absent branch |
| `kernel/test/agents-foundation.test.ts` — crew memory never creates `role.md`, reports `charter_missing` | add `role.md` to the crew file list in `agents/memory.ts` |
| `kernel/test/agents-foundation.test.ts` — `isRoutable` false for an `off` member | drop the `status = 'active'` condition in `registry.ts` |
| `kernel/test/feature-seams.test.ts` — contributor order ends with `agents` | delete `agentsContribution,` from `SHIPPED_CONTRIBUTIONS` |
| `kernel/test/brain.test.ts` — proposed policy includes the four agent names | delete `"mcp__kernel__kernel_agent_message",` from `PROPOSED_ALLOWED_TOOLS` |
| `kernel/test/brain.test.ts` — doc == template | delete the `- crew:` line from `ROLE_TEMPLATE` |
| `kernel/test/sessions-policy.test.ts` — `ALWAYS_HELD_TOOLS` is the three names | delete `"mcp__kernel__kernel_agent_update",` from `ALWAYS_HELD_TOOLS` |
| `kernel/test/sessions.test.ts` — `never: ["push_everything"]` refused before any row | delete the `never` check from `checkPolicy` |
| `kernel/test/sessions.test.ts` — `never: ["git_push"]` survives into the frozen policy | delete the `never` copy from `freezePolicy` |
| `kernel/test/approvals.test.ts` — `KERNEL_APPLIED_ACTIONS` is the three names; `once` on `kernel_agent_create` ⇒ `apply_refused: no_applier` | delete `"mcp__kernel__kernel_agent_create",` from `KERNEL_APPLIED_ACTIONS` |
| `kernel/test/approvals.test.ts` — `always` on a held `kernel_agent_create` / `_update` call ⇒ `always_not_supported` | delete `"mcp__kernel__kernel_agent_create",` from `ALWAYS_HELD_TOOLS` (and, for `_update`, its line) |
| `kernel/test/sessions.test.ts` — an allowing policy only gets a pending approval for `kernel_agent_create` / `kernel_agent_update` | delete that name from `ALWAYS_HELD_TOOLS` in `policy.ts` |
| `kernel/test/kernel-tools.test.ts` — every kernel-applied action is always held; the real sets pass | delete `"mcp__kernel__kernel_agent_update",` from `ALWAYS_HELD_TOOLS` (leaving it in `KERNEL_APPLIED_ACTIONS`) |
| `kernel/test/sessions.test.ts` / `sessions-policy.test.ts` (AC9) — existing outward calls are still held / still use their grant | make `boundaryDecision` return `{ kind: "boundary", category: "git_push" }` for every call |
| `kernel/test/playbooks-foundation.test.ts` — the usage text carries `PLAYBOOKS_HELP` as one whole entry | drop the playbooks subcommand from `playbooksContribution` (empty `subcommands`) |
| `kernel/test/playbooks-foundation.test.ts` — `SHIPPED_CONTRIBUTIONS[5]` is `playbooksContribution` | move `agentsContribution,` before `playbooksContribution,` in `SHIPPED_CONTRIBUTIONS` |
| `kernel/test/agents-foundation.test.ts` — `readWrightSettings` keeps today's `settings_invalid` shape (no `field` key) and its ok `file` | stop the wrapper mapping in `brain/settings.ts` (return `readAgentSettings`'s result as is) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Migration 14 + store pins, `NEVER_CATEGORIES` / `boundaryDecision` / `freezePolicy` / `ToolPolicy.never` / `checkPolicy` / the gate call site, charter tools always held + kernel-applied, architecture docs + two stubs | AC1, AC2, AC7, AC8, AC9, AC10, AC11 (store/sessions/approvals pins) | 12 modify, 3 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | `kernel/src/agents/` (types, settings, memory, registry, three empty parts, index), registration, `readWrightSettings` as a thin call, Wright's reserved names + "Your crew", foundation test | AC3, AC4, AC5, AC6, AC11 (feature/brain pins) | 7 modify, 9 create | `skills/unit-testing/SKILL.md` | BLOCKED |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/014_agents.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/014_agents.ts", name: "agentRegistry"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "NEVER_CATEGORIES"}
  - {kind: "type", path: "kernel/src/sessions/policy.ts", name: "NeverCategory"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "boundaryDecision"}
  - {kind: "file", path: "docs/architecture/agents.md"}
  - {kind: "file", path: "docs/architecture/delegation.md"}
requires: []
lanes:
  - "kernel/src/store/migrations/014_agents.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/test/store.test.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/src/approvals/store.ts"
  - "kernel/test/approvals.test.ts"
  - "kernel/test/kernel-tools.test.ts"
  - "docs/architecture/approvals.md"
  - "docs/ARCHITECTURE.md"
  - "docs/architecture/agents.md"
  - "docs/architecture/delegation.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/agents/index.ts"}
  - {kind: "symbol", path: "kernel/src/agents/index.ts", name: "agentsContribution"}
  - {kind: "symbol", path: "kernel/src/agents/index.ts", name: "mergeAgentParts"}
  - {kind: "symbol", path: "kernel/src/agents/index.ts", name: "AGENT_PARTS"}
  - {kind: "symbol", path: "kernel/src/agents/types.ts", name: "AVATAR_SHAPES"}
  - {kind: "type", path: "kernel/src/agents/types.ts", name: "AgentPart"}
  - {kind: "symbol", path: "kernel/src/agents/settings.ts", name: "readAgentSettings"}
  - {kind: "symbol", path: "kernel/src/agents/memory.ts", name: "ensureAgentMemoryFiles"}
  - {kind: "symbol", path: "kernel/src/agents/registry.ts", name: "isRoutable"}
  - {kind: "symbol", path: "kernel/src/agents/roster.ts", name: "rosterPart"}
  - {kind: "symbol", path: "kernel/src/agents/delegate.ts", name: "delegatePart"}
  - {kind: "symbol", path: "kernel/src/agents/charter-tools.ts", name: "charterToolsPart"}
  - {kind: "file", path: "kernel/test/agents-foundation.test.ts"}
requires:
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "NEVER_CATEGORIES", from: 1}
  - {kind: "symbol", path: "kernel/src/store/migrations/014_agents.ts", name: "agentRegistry", from: 1}
lanes:
  - "kernel/src/agents/*.ts"
  - "kernel/test/agents-foundation.test.ts"
  - "kernel/src/features/index.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/playbooks-foundation.test.ts"
  - "kernel/src/brain/settings.ts"
  - "kernel/src/brain/templates.ts"
  - "docs/architecture/brain.md"
  - "kernel/test/brain.test.ts"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
  └─> Subtask 2 (requires NEVER_CATEGORIES and migration 14 from 1)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (dependency only) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1 merges into the feature branch)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): scope exceeds one worker | MEDIUM | Split into two zero-overlap subtasks (`context-bound`), serialized by a real dependency. |
| Touching the reader every Wright message uses changes Wright's behaviour (source requirement Risks) | HIGH | Design decision 3: `readWrightSettings` keeps its signature and result shapes (no `field` key on its `settings_invalid`), the logic moves rather than forks; every `brain.test.ts` and `playbooks-runs.test.ts` pin must pass unchanged apart from the tool list. |
| `freezePolicy` silently drops `never` (found at base: it copies only two fields) | HIGH | Design decision 8 + the `freezePolicy` pin mutation. |
| Migration 14's `ALTER TABLE brain_messages` breaks the migration-12 column pin, the migration-13 upgrade test's stored-text assertion, and the re-run tests | HIGH | Function-form `up` with `pragma_table_info` guards; the three named store tests run at their own slice (Touched-file invariants), each reported. |
| Adding two names to `KERNEL_APPLIED_ACTIONS` before their appliers exist | MEDIUM | Relies on the tested `no_applier` fail-closed path; AC8 pins it for `kernel_agent_create`; `tools/server.ts`'s composition check needs both names in `ALWAYS_HELD_TOOLS` too (same subtask). |
| The `boundaryDecision` stub's call site changes gate order (before the dry-run branch) | MEDIUM | It returns `none` for every call, so behaviour is unchanged (AC9); the full sessions suite runs. The deny branch for a boundary answer is unreachable until item 03 and covered only by the typecheck — honest limit, item 03 tests it. |
| A seventh contribution breaks pins outside the requirement's Touches (`playbooks-foundation.test.ts` found at base) or other usage-text pins (`cli.test.ts`, `kernel-daemon.test.ts`, `phase-*-exit.test.ts`) | MEDIUM | `playbooks-foundation.test.ts` is in Subtask 2's lanes with a generic rewrite; each worker runs the FULL suite and reports (does not edit) any other breaking pin outside its lanes. |
| A `studio` module-graph regression (`kernel/src/agents/*` importing the SDK, the session manager or `kernel.ts`) | MEDIUM | Design decision 6 import rule; the existing module-graph pin in `feature-seams.test.ts`. |
| The requirement says "the same for `gh issue`" but the rail has no `gh issue review` | LOW | Design decision 8 omits that category and says why in the doc comment. |
| `.agent/companions.json` maps `docs/architecture/agents.md` to item 02's `charter-files.ts` / `agents-roster.test.ts` | LOW | Planning metadata only; this item creates the stub page and does not create item 02's files. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-18-phase-4-foundation-agent-registry-seams.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-18T05:49:27Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/83
- **Branch:** feature/phase-4-foundation-agent-registry-seams
- **Files changed:** 34
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Migration 14 (agents table + four brain_messages columns, re-runnable), kernel/src/agents/ (closed sets, readAgentSettings, crew memory reader, registry lookups, three empty parts, verb-less studio agents, seventh contributor), NEVER_CATEGORIES + boundaryDecision stub at the gate, kernel_agent_create/update always held and kernel-applied (no applier), Wright's four reserved names + Your crew section, ARCHITECTURE + two stubs. Phase 4.5: 3 rounds, 6 at-floor findings fixed (4 HIGH), each round raised a new one; round 3's HIGH (crew id playbooks colliding with the mirror folder) fixed in 10106e3 but not re-reviewed in-loop. 1479 passed / 8 skipped, check-docs OK. 3 LOW dismissed. Risk classification high (migration, size, path) — advisory. Detached drain suppressed by /automate (owned drain follows).

## Not verified
- **ARCHITECTURE.md Phase 4 section naming agentsContribution, AGENT_PARTS and the shared readers** — built by subtask 2; not present in the tree when subtask 1 wrote it (subtask 1)
- **studio agents against a running kernel daemon** — tested through runCli with a hand-written api.json and stubbed fetch/Keychain only (subtask 2)
