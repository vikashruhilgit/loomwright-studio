# Supervisor Job: Phase 3 foundation — migration 13 (playbooks, versions, runs, new columns), one empty playbooks contribution with per-sub-file parts, per-feature test pins, reserved Wright tool names, sessions carry their playbook, kernel_playbook_enable always held

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (an app-made detached worktree `.claude/worktrees/xenodochial-kapitsa-320120` exists; not ours, leave it)
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092901-phase-3-foundation-schema-seams-and-per-feature-pins.md
- **Base commit:** decedbf1f9b4e0b75c2e4019e14e936f689052c2

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + better-sqlite3 + zod + vitest, all in `kernel/package.json`. |
| 2 | Dependency Availability | GO | No new dependency. |
| 3 | Architecture Fit | GO | Phase 2 built the contribution seam (`kernel/src/features/contribution.ts`, `SHIPPED_CONTRIBUTIONS`); migrations are append-only TypeScript modules. |
| 4 | Scope vs Supervisor Capability | CAUTION | ~25 files (a large mechanical pin move across six test files, plus migration, sessions, policy, docs). Over one worker's bound, so the brief splits (`context-bound`, two zero-overlap groups). |
| 5 | Hard Blockers | GO | None. `cd kernel && npm test` and `bash scripts/check-docs.sh` run locally. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Create phase 3's schema and extension points in ONE change so items 02–08 each edit only their own files: migration 13 (`playbooks`, `playbook_versions`, `playbook_runs`, `sessions.playbook` / `playbook_version`, `event_queue.priority`, `approvals.playbook`); an empty `playbooks` contribution built from four sub-files; each phase 2 feature's pinned lists moved out of `kernel/test/feature-seams.test.ts` into that feature's own test; the six `mcp__kernel__kernel_playbook_*` names reserved in Wright's proposed tool policy; sessions that record their playbook; and `kernel_playbook_enable` in the fixed outward set.

**Problem Statement:**
The owner running phase 3 through `/automate --parallel` needs the shared kernel files to gain their phase 3 seams first. Otherwise every phase 3 item edits the migrations list, the features registry, `feature-seams.test.ts` (which today pins EVERY feature's tools, routes and subcommands in one test), Wright's tool list, the outward set and `docs/ARCHITECTURE.md`, and `plan-waves` must put each in its own wave.
Success looks like: the shipped daemon behaves exactly as today plus one `studio playbooks` subcommand that prints help; every phase 2 pin still asserts the same values, now in its feature's own test file.

## Acceptance Criteria
- [ ] AC1 — Given a fresh store, when migrations run, then `schema_migrations` reaches version 13 (name `playbooks`) and `playbooks`, `playbook_versions`, `playbook_runs` exist with exactly the columns Design decision 1 lists, `sessions` has nullable `playbook` and `playbook_version`, `approvals` has nullable `playbook`, and `event_queue.priority` is `TEXT NOT NULL DEFAULT 'normal'`.
- [ ] AC2 — Given a store at version 12 with queued `event_queue` rows (and phase 1/2 rows), when it upgrades, then every existing `event_queue` row reads `priority = 'normal'`; every object other than `sessions`, `approvals` and `event_queue` keeps its stored text; those three gain exactly the listed columns; every pre-existing row keeps its values (the new columns null, or `'normal'` for `priority`); and the integrity check passes before and after.
- [ ] AC3 — Migration 13 is safe to re-run on a database that already has its objects (the existing "deleted top row(s)" store tests re-run migrations 9–13 as no-ops and must pass).
- [ ] AC4 — Given the shipped contributions, when they merge, then `playbooks` is the sixth contributor and registers no tool, route, handler or due work; its only part is the one `playbooks` subcommand, and that subcommand has zero verbs. `runCli(["playbooks"])` prints the playbooks help to stdout and returns 0; an unknown verb prints the help to stderr and returns 2. Both pass the `api.json` pid check first, like every contributed subcommand.
- [ ] AC5 — Given the moved pins, when the suite runs, then each phase 2 feature's tools, routes, subcommand names, help lines, handler kinds, due work and contribution keys are pinned in that feature's own test file (`loomwright-adapter`, `notifications`, `triggers`, `approvals`, `brain`) with the same values as before, `kernel/test/playbooks-foundation.test.ts` pins the playbooks shell, and `feature-seams.test.ts` pins no feature's list (only the contributor order, collision/naming rules and the merge mechanics, computed from `SHIPPED_CONTRIBUTIONS`).
- [ ] AC6 — Given a fresh data dir, when `wright.json` is created, then its proposed tool policy includes the six names `mcp__kernel__kernel_playbook_create`, `_update`, `_list`, `_disable`, `_dry_run`, `_enable`; the role template (`kernel/src/brain/templates.ts`) and `docs/architecture/brain.md` list them, and the existing doc-equals-template pin passes.
- [ ] AC7 — Given `startSession` with `playbook: 3` and `playbookVersion: 2`, when the session row is read (`getSession`), then it carries both; given no playbook, both are null. `resumeSession` with `playbook`/`playbookVersion` writes them; without them it leaves the row's values unchanged. `dryRun` is accepted and ignored (item 03).
- [ ] AC8 — Given a session whose policy allows `mcp__kernel__kernel_playbook_enable`, when it calls it, then `classifyToolCall` answers `outward` (action `kernel_playbook_enable`, payload `{tool, input, cwd}`) and the call is held as a pending approval, not run, exactly as any outward-set call; the tool name is exported in a closed list `ALWAYS_HELD_TOOLS` that a future "always" grant must never cover.
- [ ] AC9 — `docs/ARCHITECTURE.md` rewrites the planned `playbooks` data-model row to migration 13 (no duplicate row), adds `playbook_versions` and `playbook_runs` rows and the new columns to the `sessions`, `approvals` and `event_queue` rows, replaces the planned `kernel_playbook_*` tool bullet with the six phase 3 tools, and adds a "Phase 3 features" section linking `docs/architecture/playbooks.md`, `dry-run.md`, `queue.md`, `budget.md`, `playbook-runs.md` (each a heading plus "Documented by the item that builds it"); `bash scripts/check-docs.sh` passes.
- [ ] AC10 — `cd kernel && npm ci && npm run typecheck && npm test` passes. Existing tests pass unchanged except: the schema-version and table-set pins in `kernel/test/store.test.ts` that migration 13 forces (listed under Closed enumerations), the pins moved between test files (same values), the `wright.json` / `PROPOSED_ALLOWED_TOOLS` pins that gain the six names, and lists that gain the `playbooks` contributor/subcommand.

## Design decisions the workers must follow (from the source requirement + analysis)

1. **Migration 13 (`kernel/src/store/migrations/013_playbooks.ts`, export `playbooks`, version 13, name `playbooks`)**, appended after `brainMessages`. Timestamps ISO-8601 UTC TEXT with the `NOW` idiom from migration 11/12 (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`). Value sets closed in code, **no SQL CHECK**, **no SQL TRIGGER** (the integrity check refuses any trigger the kernel did not list). Tables use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
   - **Re-runnable column adds (load-bearing).** `ALTER TABLE … ADD COLUMN` fails on a re-run ("duplicate column name"), and `kernel/test/store.test.ts` deletes the top `schema_migrations` rows and expects the pending migrations to re-run as no-ops (`9 to 12 are no-op re-runs`). So `up` is a FUNCTION (`(db) => void`, allowed by `Migration.up`): it runs the table DDL, then adds each column only when `PRAGMA table_info(<table>)` does not list it.
   - `playbooks`: `id INTEGER PRIMARY KEY`, `slug TEXT NOT NULL UNIQUE`, `name TEXT NOT NULL`, `owning_agent TEXT NOT NULL`, `intent TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'draft'` (`draft` / `enabled` / `disabled`), `version INTEGER NOT NULL DEFAULT 1`, `dedupe_key_spec TEXT` (nullable), `dedupe_key_set_by TEXT`, `priority TEXT NOT NULL DEFAULT 'normal'` (`low` / `normal` / `high`), `priority_set_by TEXT`, `model TEXT`, `model_set_by TEXT`, `effort TEXT` (recorded only), `effort_set_by TEXT`, `token_limit_per_day INTEGER` (nullable), `token_limit_set_by TEXT`, `api_key_fallback_json TEXT` (nullable; the `ApiKeyFallbackPolicy` shape in `kernel/src/budget/types.ts`), `api_key_fallback_set_by TEXT`, `created_at TEXT NOT NULL DEFAULT NOW`, `updated_at TEXT NOT NULL DEFAULT NOW`. Every `*_set_by` is `wright` / `owner`, null while the field is unset.
   - `playbook_versions`: `playbook INTEGER NOT NULL REFERENCES playbooks(id)`, `version INTEGER NOT NULL`, `snapshot_json TEXT NOT NULL` (the full playbook row at that version), `created_at TEXT NOT NULL DEFAULT NOW`, `PRIMARY KEY (playbook, version)`.
   - `playbook_runs`: `id INTEGER PRIMARY KEY`, `playbook INTEGER NOT NULL REFERENCES playbooks(id)`, `version INTEGER NOT NULL`, `kind TEXT NOT NULL` (`dry_run` / `fire` / `run_now`), `status TEXT NOT NULL DEFAULT 'running'`, `session_id INTEGER REFERENCES sessions(id)`, `dedupe_key TEXT`, `result_json TEXT`, `tokens INTEGER`, `started_at TEXT NOT NULL DEFAULT NOW`, `ended_at TEXT`; index on `(playbook, kind, id)`.
   - Columns: `sessions.playbook INTEGER REFERENCES playbooks(id)`, `sessions.playbook_version INTEGER`, `approvals.playbook INTEGER REFERENCES playbooks(id)`, `event_queue.priority TEXT NOT NULL DEFAULT 'normal'` (SQLite fills every existing row with the default). `triggers.playbook` already exists (migration 11, TEXT) and is NOT changed here.
   - Do not touch `events` or its triggers (`APPEND_ONLY_OBJECTS` in `kernel/src/store/integrity.ts`).
2. **The playbooks shell (`kernel/src/playbooks/`).** `types.ts` holds the closed value sets as `readonly` arrays plus their union types: `PLAYBOOK_STATUSES` (`draft`, `enabled`, `disabled`), `PLAYBOOK_PRIORITIES` (`low`, `normal`, `high`), `PLAYBOOK_RUN_KINDS` (`dry_run`, `fire`, `run_now`), `DEDUPE_KEY_FIELDS` (`playbook.id`, `playbook.version`, `trigger.id`, `trigger.scheduled_at`, `date`), `POLICY_SETTERS` (`wright`, `owner`), and a `PlaybookPart` type: `{ readonly name: string; readonly tools: readonly ContributedTool[]; readonly routes: readonly ContributedRoute[]; readonly verbs: readonly PlaybookVerb[]; readonly handlers: Readonly<Partial<Record<EventKind, EventHandler>>> }`, where `PlaybookVerb` is `{ name, help, run(args, client, output): Promise<number> }` (the `ContributedSubcommand` call shape). `drafts.ts` (item 02), `dry-run.ts` and `enable.ts` (item 07) and `runs.ts` (item 08) each export one EMPTY frozen `PlaybookPart` (`draftsPart`, `dryRunPart`, `enablePart`, `runsPart`). `index.ts` exports `PLAYBOOK_PARTS` (those four, in that order) and `playbooksContribution`: tools and routes concatenated in part order, handlers merged, and ONE subcommand `playbooks` whose verbs are the parts' verbs. A pure exported `mergePlaybookParts(parts)` refuses a verb name or handler kind claimed by two parts with `ContributionConflictError` naming both parts as owners (the part names `drafts`, `dry-run`, `enable`, `runs`), with `part: "subcommand"` for a verb conflict and `part: "handler"` for a handler-kind conflict (`ContributionPart` is a closed union with no `verb` value, and `contribution.ts` is not edited). It runs at module load; with four empty parts it cannot throw. The contribution object carries ONLY the keys that are non-empty (today `name` and `subcommands`), like the phase 2 features. Imports: types and zod only, plus `../features/contribution.js`; never the Agent SDK, the session manager or `kernel.ts` (the CLI loads this module; the AC9 child-process pin in `feature-seams.test.ts` already covers the whole registry graph).
3. **The `studio playbooks` subcommand.** Help line `PLAYBOOKS_HELP` = `studio playbooks <verb>` followed by each verb's help joined with ` | ` (today no verbs, so exactly `studio playbooks <verb>`); it must stay one line ≤ 200 characters (the `mergeContributions` help rule). `run([])` and `run(["help"])` print a short help (the help line, then `no verbs yet` when there are none) to stdout and return 0; an unknown verb prints `studio playbooks: unknown verb "<v>"` and the help to stderr and returns 2; a known verb dispatches with the remaining args. No API call is made by the shell itself.
4. **Registration.** `kernel/src/features/index.ts` imports `playbooksContribution` and appends it as the SIXTH entry of `SHIPPED_CONTRIBUTIONS` (after `brain`), and updates its header comment (it says "every phase 2 feature's contribution").
5. **Per-feature pins (a move, not a rewrite).** For each phase 2 feature, the feature's own test file gains (or already has, then keeps) assertions on: its contribution's tool names, routes as `"<METHOD> <path>"`, subcommand names and help constants (`NOTIFICATIONS_HELP`, `TRIGGERS_HELP`, `APPROVALS_HELP`, `APPROVE_HELP`, `DENY_HELP`, `ASK_HELP`, with the exact literals pinned today), handler kinds (+ identity for the brain's `message`), due work (`versionWatchDueWork`, `deliveryDueWork`, triggers' one entry) and `Object.keys(<contribution>)` — the same values `feature-seams.test.ts` pins today. `feature-seams.test.ts` then keeps: the contributor order (`["loomwright", "notifications", "triggers", "approvals", "brain", "playbooks"]`), the collision/naming/malformed-part rules, the due-work loop mechanics, the AC4 outside-composition tests, the AC5 refusals, the AC9 module-graph pin, and merge mechanics written GENERICALLY (e.g. merged tool names equal `SHIPPED_CONTRIBUTIONS.flatMap((c) => (c.tools ?? []).map((t) => t.name))`, the shipped kernel's launched tools equal `[...KERNEL_TOOL_NAMES, ...that]`, the usage text equals `usageText(kernel.contributions.subcommands)`), so a later feature item never edits it. The feature-specific behaviour checks inside "the shipped kernel (AC3)" test (the brain answering a `message` for no agent; `GET /notifications` → 200 `{notifications: []}`) move to `brain.test.ts` / `notifications.test.ts`, or stay only if rewritten without a feature literal. **Count `expect(` calls removed from `feature-seams.test.ts` and added to the feature tests and report both numbers in the hand-back**: none may be dropped.
6. **Wright's reserved tool names.** Append, in this order, `mcp__kernel__kernel_playbook_create`, `…_update`, `…_list`, `…_disable`, `…_dry_run`, `…_enable` to `PROPOSED_ALLOWED_TOOLS` in `kernel/src/brain/settings.ts` (after `mcp__kernel__kernel_loomwright_capabilities`, before `mcp__kernel__kernel_schedule_wakeup`, keeping `Read`, `Glob`, `Grep` last), add a `- playbooks: kernel_playbook_create, kernel_playbook_update, kernel_playbook_list, kernel_playbook_disable, kernel_playbook_dry_run, kernel_playbook_enable` line to the role template's tool list in `templates.ts`, and update BOTH blocks in `docs/architecture/brain.md` (the role template between `<!-- role-template:start -->` / `<!-- role-template:end -->`, and the `wright.json` JSON block). Add one sentence to brain.md: `wright.json` is create-if-absent, so an existing data dir keeps its old policy until the owner adds the names.
7. **Sessions carry their playbook.** `StartSessionParams` and `ResumeSessionParams` (`kernel/src/sessions/types.ts`) gain optional `playbook?: number`, `playbookVersion?: number`, `dryRun?: boolean` (documented "ignored until item 03"). `SessionRow` gains `playbook: number | null` and `playbook_version: number | null`. `startSession`'s `INSERT INTO sessions` writes them (null when absent); `getSession`'s SELECT returns them; `resumeSession` writes them only when given. Validate: a given value must be a positive integer, else the existing invalid-params `SessionError` before any row or spawn. Every existing caller is unchanged.
8. **`kernel_playbook_enable` always held.** In `kernel/src/sessions/policy.ts`, export `ALWAYS_HELD_TOOLS: readonly string[] = ["mcp__kernel__kernel_playbook_enable"]` (documented: every call is held for the owner; an "always" grant may never cover a name in this list — item 05 must check it). `classifyToolCall` answers `{ kind: "outward", action: <name without the mcp__kernel__ prefix>, payload: { tool: toolName, input: toolInput, cwd: payloadCwd } }` for a name in the list, before the WRITE_TOOLS branch (Bash handling unchanged). Extend the function's numbered doc comment (step 3, `outward`) with this rule.
9. **Docs.** As AC9. The "Phase 3 features" section is short: the playbooks feature lives in `kernel/src/playbooks/` with one sub-file per item, each contributing tools/routes/`studio playbooks` verbs/handlers through `PLAYBOOK_PARTS`; migration 13 creates the tables; `kernel_playbook_enable` is in the fixed outward set (always held); links to the five stub pages; approvals keep `approvals.md`. Do NOT edit the "Loomwright adapter" or "Phase 2 features" sections beyond what AC9 needs.

## Touched-file invariants

> Grounded at base `decedbf1f9b4e0b75c2e4019e14e936f689052c2`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/store/migrations/index.ts`** — keep: `Append only; never edit a shipped one`; migration 13 is appended after `brainMessages`, 001–012 untouched.
- **`kernel/src/store/migrations/012_brain_messages.ts`** (read-only reference) — reuse: `Safe to re-run (\`IF NOT EXISTS\`)` and `Creates no SQL trigger`; migration 13's header says the same, plus why its column adds are guarded by `PRAGMA table_info`.
- **`kernel/src/store/migrations/types.ts`** (read-only) — `readonly up: string | ((db: Database.Database) => void);` and `Runs inside a transaction` — the function form is the sanctioned way to guard column adds.
- **`kernel/src/store/integrity.ts`** (expected unchanged) — `APPEND_ONLY_OBJECTS` lists only `events` and its triggers; migration 13 must not touch them.
- **`kernel/test/store.test.ts`** — pinned by: `toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])` (several places), `expect(err.knownVersion).toBe(12)`, the default-list test title (`… and brain_messages (migration 12)`), its exact table set, its `not.toContain` loop over `"agents", "playbooks", "hooks_installed", "connectors"` (drop `"playbooks"`), its list end `[12, "brain_messages"]`, the two `.at(-1)` pins `toEqual([12, "brain_messages"])`, the integrity strings `records versions 2, 3, …, 12, not a contiguous run from 1` and `records versions 1, 2, 4, …, 12, not a contiguous run from 1`, and the comments `awaiting migrations 8 to 12` / `(9 to 12 are no-op re-runs)` — all move to 13. The migration-1-only loop (`for (const later of ["agents", "playbooks", "triggers", "approvals", "hooks_installed", "connectors"])`) stays unchanged. Mirror `describe("migration 12: brain_messages"` for a new `describe("migration 13: playbooks"`. **Forced by the ALTERs:** the migration-11 upgrade test (`migrates a v10 store with phase 1 rows to 11`, around lines 820–847) asserts that rows equal the pre-upgrade rows (around line 836) and that every earlier object keeps its stored text (around lines 839–841). Migration 13 changes `sessions`, `approvals` and `event_queue` (stored SQL and row shape), so that test must either run at `migrations.slice(0, 12)` (an upgrade to 12, which is what it pins) or exclude exactly those three tables. Choose one, keep every other assertion, and say which in the hand-back.
- **`kernel/src/features/index.ts`** — keep: `The CLI imports this module, so neither it nor anything it loads may import the Agent SDK, the session manager or \`kernel.ts\``; `Object.freeze([` around the list.
- **`kernel/src/features/contribution.ts`** (read-only for both subtasks) — `SUBCOMMAND_NAME = /^[a-z][a-z0-9-]{0,63}$/` and the help rule `needs a one-line help (at most 200 characters)`.
- **`kernel/test/feature-seams.test.ts`** — keep every non-list test (collisions, naming, malformed parts, due-work mechanics, AC4 outside composition, AC5 refusals, AC9 module graph). Its header comment lists each feature's parts — rewrite it to say the per-feature lists live in each feature's own test.
- **Feature tests already pinning their own parts (extend, never duplicate):** `kernel/test/loomwright-adapter.test.ts` (`expect(loomwrightContribution.tools).toEqual([capabilitiesTool]);`, `expect(SHIPPED_CONTRIBUTIONS[0]).toBe(loomwrightContribution);`), `kernel/test/approvals.test.ts` (`expect(Object.keys(approvalsContribution).sort()).toEqual(["name", "routes", "subcommands", "tools"]);`), `kernel/test/brain.test.ts` (`expect(Object.keys(brainContribution)).toEqual(["name", "routes", "subcommands", "handlers"]);`), `kernel/test/loomwright-version-note.test.ts` (`expect(loomwrightContribution.dueWork).toEqual([versionWatchDueWork]);`, not in a lane — read-only).
- **`kernel/src/brain/settings.ts`** — keep: `PROPOSED_ALLOWED_TOOLS` frozen; `Read`, `Glob`, `Grep` the only non-`mcp__kernel__` entries (pinned by `brain.test.ts` `filter((t) => !t.startsWith("mcp__kernel__"))).toEqual(["Read", "Glob", "Grep"])`).
- **`kernel/src/brain/templates.ts` / `docs/architecture/brain.md`** — pinned by `brain.test.ts` `shows role.md's first-run template verbatim (doc == templates.ts)`: the doc block must equal `ROLE_TEMPLATE` byte for byte.
- **`kernel/src/sessions/policy.ts`** — keep: `classifyToolCall` Bash branch order (unreadable → too large → protected → merge → outward form → outward label); `PROTECTED_DATA_FILES` literals (pinned against owners' constants in `approvals.test.ts`); the module stays a leaf (`Kept here as literals so this module stays a leaf`).
- **`kernel/src/sessions/manager.ts`** — keep: `Throws \`SessionError\` before any row or` (… spawn for invalid params; the comment wraps); the `INSERT INTO sessions (agent, task_id, sdk_session_id, status, model, auth_account, loomwright_path, started_at, ended_at, updated_at)` gains two columns, nothing else in the insert changes; `getSession`'s SELECT gains two columns.
- **`docs/ARCHITECTURE.md`** — keep the `## Data model` table format; links must resolve under `scripts/check-docs.sh` rule 1 (`a relative markdown link in docs/, CLAUDE.md or README.md whose target does not exist`).

## Closed enumerations touched

> Sibling grep at base `decedbf`: `grep -rnF '[12, "brain_messages"]' kernel/test` → `kernel/test/store.test.ts` (3 hits); `grep -rnF '"approvals", "approve", "deny", "ask"' kernel/test` → `kernel/test/feature-seams.test.ts` (2 hits); `grep -rnF 'mcp__kernel__kernel_loomwright_capabilities' kernel/src docs` → `kernel/src/brain/settings.ts`, `docs/architecture/brain.md`.

- **schema version 13** (sibling: `12`) — must be named in `kernel/test/store.test.ts`, every pin in its Touched-file entry — extend to 13.
- **contributor `playbooks`** (sibling: `brain`) — must be named in: `kernel/src/features/index.ts` `SHIPPED_CONTRIBUTIONS` — extend; `kernel/test/feature-seams.test.ts` contributor-order pins (three: around lines 84, 86 and 467) — extend; everything else computes from `SHIPPED_CONTRIBUTIONS`.
- **subcommand `playbooks`** (sibling: `ask`) — closed lists that see it: (1) `kernel/test/feature-seams.test.ts` "the shipped kernel (AC3)" subcommand list and usage literal — rewritten generically (Design decision 5); (2) `kernel/test/feature-seams.test.ts` around line 811, in the AC4 outside-composition test, pins `["notifications", "triggers", "approvals", "approve", "deny", "probe"]` (SHIPPED minus brain, plus probe) — rewrite it generically from `SHIPPED_CONTRIBUTIONS` (e.g. the shipped subcommand names except those of the contribution the test removes, then `probe`), not by appending `playbooks`; (3) `kernel/test/triggers.test.ts` around line 151 pins the full shipped usage `${USAGE} | ${NOTIFICATIONS_HELP} | ${TRIGGERS_HELP} | ${APPROVALS_HELP} | ${APPROVE_HELP} | ${DENY_HELP} | ${ASK_HELP}\n` through `runCli` with the default contributions — rewrite it as `usageText(...)` over the shipped subcommands plus an assertion that `TRIGGERS_HELP` appears in it, so a later feature never edits triggers.test.ts. `kernel/test/playbooks-foundation.test.ts` pins `PLAYBOOKS_HELP` and the name. A further pin found in the full run is handled the same way (generic rewrite inside the lanes; outside the lanes, stop and report).
- **tool names `mcp__kernel__kernel_playbook_*`** (sibling: `mcp__kernel__kernel_loomwright_capabilities`) — must be named in `kernel/src/brain/settings.ts` `PROPOSED_ALLOWED_TOOLS`, `kernel/src/brain/templates.ts` role template, `docs/architecture/brain.md` (template block + JSON block) — extend.
- **`ALWAYS_HELD_TOOLS` / outward action `kernel_playbook_enable`** (sibling: outward actions like `git push`) — named in `kernel/src/sessions/policy.ts` (list + `classifyToolCall` doc step 3) and `docs/ARCHITECTURE.md` "Phase 3 features".

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/store.test.ts` — fresh store reaches 13 with the three tables and four columns | delete `playbooks,` from the list in `kernel/src/store/migrations/index.ts` |
| `kernel/test/store.test.ts` — a v12 store with queued rows upgrades, every row `normal` | change `DEFAULT 'normal'` to `DEFAULT 'high'` for `event_queue.priority` in `013_playbooks.ts` |
| `kernel/test/store.test.ts` — deleted top rows re-run migrations 9–13 as no-ops | remove the `PRAGMA table_info` guard before one `ADD COLUMN` in `013_playbooks.ts` |
| `kernel/test/playbooks-foundation.test.ts` — `playbooks` registered with no tools/routes/handlers/due work, one verb-less subcommand | add a dummy verb to `draftsPart` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/playbooks-foundation.test.ts` — `studio playbooks` prints help, exit 0 | make the no-verb branch of the playbooks subcommand return 2 |
| `kernel/test/playbooks-foundation.test.ts` — a verb claimed by two parts is refused naming both | delete the duplicate-verb throw in `mergePlaybookParts` |
| `kernel/test/feature-seams.test.ts` — contributor order ends with `playbooks` | delete `playbooksContribution,` from `SHIPPED_CONTRIBUTIONS` |
| `kernel/test/triggers.test.ts` (and each feature test) — the feature's tool/route/subcommand list | delete one tool from `triggerTools` in `kernel/src/triggers/tools.ts` |
| `kernel/test/brain.test.ts` — proposed policy includes the six playbook names | delete `"mcp__kernel__kernel_playbook_enable",` from `PROPOSED_ALLOWED_TOOLS` |
| `kernel/test/brain.test.ts` — doc == template | delete the `- playbooks:` line from `ROLE_TEMPLATE` in `templates.ts` |
| `kernel/test/sessions.test.ts` — a session started with playbook 3 / version 2 reads both back | drop `playbook` from the `INSERT INTO sessions` column list in `manager.ts` |
| `kernel/test/sessions-policy.test.ts` — `kernel_playbook_enable` is outward and held | delete the `ALWAYS_HELD_TOOLS` branch in `classifyToolCall` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Migration 13 + store pins, sessions carry their playbook, `kernel_playbook_enable` always held, architecture docs + five stubs | AC1, AC2, AC3, AC7, AC8, AC9, AC10 (store/sessions pins) | 8 modify, 6 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Playbooks shell + registration, per-feature pin move, Wright's reserved tool names | AC4, AC5, AC6, AC10 (moved pins) | 10 modify, 7 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/013_playbooks.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/013_playbooks.ts", name: "playbooks"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "ALWAYS_HELD_TOOLS"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "playbookVersion"}
  - {kind: "symbol", path: "docs/ARCHITECTURE.md", name: "## Phase 3 features"}
  - {kind: "file", path: "docs/architecture/playbooks.md"}
  - {kind: "file", path: "docs/architecture/dry-run.md"}
  - {kind: "file", path: "docs/architecture/queue.md"}
  - {kind: "file", path: "docs/architecture/budget.md"}
  - {kind: "file", path: "docs/architecture/playbook-runs.md"}
requires: []
lanes:
  - "kernel/src/store/migrations/013_playbooks.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/test/store.test.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "docs/ARCHITECTURE.md"
  - "docs/architecture/playbooks.md"
  - "docs/architecture/dry-run.md"
  - "docs/architecture/queue.md"
  - "docs/architecture/budget.md"
  - "docs/architecture/playbook-runs.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/playbooks/index.ts"}
  - {kind: "symbol", path: "kernel/src/playbooks/index.ts", name: "playbooksContribution"}
  - {kind: "symbol", path: "kernel/src/playbooks/index.ts", name: "mergePlaybookParts"}
  - {kind: "symbol", path: "kernel/src/playbooks/index.ts", name: "PLAYBOOK_PARTS"}
  - {kind: "symbol", path: "kernel/src/playbooks/types.ts", name: "DEDUPE_KEY_FIELDS"}
  - {kind: "type", path: "kernel/src/playbooks/types.ts", name: "PlaybookPart"}
  - {kind: "symbol", path: "kernel/src/playbooks/drafts.ts", name: "draftsPart"}
  - {kind: "symbol", path: "kernel/src/playbooks/dry-run.ts", name: "dryRunPart"}
  - {kind: "symbol", path: "kernel/src/playbooks/enable.ts", name: "enablePart"}
  - {kind: "symbol", path: "kernel/src/playbooks/runs.ts", name: "runsPart"}
  - {kind: "file", path: "kernel/test/playbooks-foundation.test.ts"}
requires: []
lanes:
  - "kernel/src/playbooks/*.ts"
  - "kernel/src/features/index.ts"
  - "kernel/test/playbooks-foundation.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/loomwright-adapter.test.ts"
  - "kernel/test/notifications.test.ts"
  - "kernel/test/triggers.test.ts"
  - "kernel/test/approvals.test.ts"
  - "kernel/test/brain.test.ts"
  - "kernel/src/brain/settings.ts"
  - "kernel/src/brain/templates.ts"
  - "docs/architecture/brain.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel — both have empty `requires`, zero lane overlap)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): scope exceeds one worker | MEDIUM | Split into two zero-overlap subtasks (`context-bound`). |
| Moving pins drops an assertion silently (source requirement Risks) | HIGH | Design decision 5: a move, not a rewrite; the worker reports the `expect(` count removed and added; Phase 4.5 review compares the two. |
| Migration 13's `ALTER TABLE ADD COLUMN` breaks the "deleted top rows re-run as no-ops" store tests | HIGH | Design decision 1: function-form `up` guarding each column with `PRAGMA table_info`; AC3 and its pin mutation. |
| `event_queue.priority` changes the row shape the store upgrade tests snapshot | MEDIUM | Subtask 1 updates only the store pins the new column forces and says which in the hand-back. |
| `docs/ARCHITECTURE.md` (Subtask 1) describes Subtask 2's shell before it lands | LOW | Subtask 1 writes the description from Design decisions 2–4 only (names: `PLAYBOOK_PARTS`, `studio playbooks`, `playbooksContribution`); Phase 4.5 review checks it against the integrated code. |
| A `studio` module-graph regression (the playbooks shell importing the SDK) | MEDIUM | Design decision 2 import rule; the existing AC9 child-process pin covers the whole registry. |
| Other test files (e.g. `kernel/test/phase-2-exit.test.ts`, `kernel/test/kernel-daemon.test.ts`, `kernel/test/cli.test.ts`) pin a shipped list or the usage text and now see `playbooks` | MEDIUM | Each worker runs the FULL suite; a pin outside its lanes that breaks is reported, not edited (stop and say so). Analysis at base found none, but verify. |
| Integration-only failure: Subtask 2 adds `mcp__kernel__kernel_playbook_enable` to `PROPOSED_ALLOWED_TOOLS` while Subtask 1 makes it outward; a test in `kernel/test/sessions-policy.test.ts` (it builds a policy from `PROPOSED_ALLOWED_TOOLS`) or `kernel/test/sessions-tool-loading.test.ts` that expects every proposed tool to run `ordinary` would fail only on the merged branch | MEDIUM | Subtask 1's worker checks both files for loops over `PROPOSED_ALLOWED_TOOLS` and makes such an assertion exclude `ALWAYS_HELD_TOOLS` (a file outside its lanes is reported, not edited); Phase 4.5 runs the full suite on the integrated branch. |
| `triggers.playbook` is TEXT (migration 11) while `playbooks.id` is INTEGER | LOW | Out of scope here (item 08 links triggers); noted in `docs/ARCHITECTURE.md`'s `triggers` row is not required. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-16-phase-3-foundation-schema-seams-pins.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-16T09:00:26Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/66
- **Branch:** feature/phase-3-foundation-schema-seams-pins
- **Files changed:** 31
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Migration 13 (playbooks, playbook_versions, playbook_runs, four nullable/defaulted columns, re-runnable), empty playbooks contribution (sixth, one verb-less studio playbooks subcommand), phase 2 feature pins moved into each feature's own test, six reserved kernel_playbook_* tool names, sessions carry their playbook, kernel_playbook_enable always held, ARCHITECTURE + five stubs. Phase 4.5: iteration 1 FAIL on one HIGH (approvals.test.ts whole-row pin lacked playbook: null), fixed in bf32808; iteration 2 PASS (1177 passed / 7 skipped, check-docs OK, CI required checks green). All 12 pin mutations applied by hand: 12 held. 2 LOW findings dismissed below the fix floor. Risk classification high (migration, size) — advisory. Detached drain suppressed by /automate (owned drain follows).

## Not verified
- **kernel/test/approvals.test.ts:691 on the integrated branch** — needs playbook: null (subtask 1) — since fixed in Phase 4.5 (bf32808)
- **sessions-policy and brain tests with Subtask 2's PROPOSED_ALLOWED_TOOLS on the merged branch** — merged-branch run belonged to Phase 4.5, which passed (subtask 1)
- **kernel/src/playbooks/enable.ts comment citing ALWAYS_HELD_TOOLS** — Subtask 1's symbol, not visible in Subtask 2's worktree (subtask 2)
