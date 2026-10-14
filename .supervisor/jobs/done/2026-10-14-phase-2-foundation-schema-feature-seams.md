# Supervisor Job: Phase 2 foundation — migration 11 (triggers, notifications, approvals, loomwright_contract_seen) and one empty, wired contribution per phase 2 feature

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (open PR #46 also edits `docs/ARCHITECTURE.md`; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-14-094201-phase-2-foundation-schema-and-feature-seams.md
- **Base commit:** 05d0e611facf5a91c5594653abdee7a14eb76a2a

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + better-sqlite3 + zod + vitest, all already in `kernel/package.json`. |
| 2 | Dependency Availability | GO | No new dependency (requirement non-goal). |
| 3 | Architecture Fit | GO | Phase 1 already composes in `kernel/src/kernel.ts`; migrations are append-only TypeScript modules (`kernel/src/store/migrations/index.ts`: "Append only; never edit a shipped one"). |
| 4 | Scope vs Supervisor Capability | CAUTION | ~25 files changed (5 new feature dirs, 5 doc stubs, 8 central files, migration, 2 tests): over the one-worker bound, so the brief splits (`context-bound`, two zero-overlap groups). |
| 5 | Hard Blockers | GO | None. `bash scripts/check-docs.sh` and `cd kernel && npm test` run locally. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Give the kernel its phase 2 extension points in ONE change: migration 11 adds the `triggers`, `notifications`, `approvals` and `loomwright_contract_seen` tables, and five feature directories (`loomwright`, `notifications`, `triggers`, `approvals`, `brain`) each export an EMPTY contribution that the tool server, API router, CLI, event loop and kernel composition already merge, so items 02–07 each change only their own directory, tests and doc page.

**Problem Statement:**
The owner running phase 2 through `/automate --parallel` needs the shared kernel files to gain their phase 2 seams first, because every phase 2 feature would otherwise edit the same central files (`kernel/src/tools/server.ts`, `kernel/src/api/server.ts`, `kernel/src/cli/index.ts`, `kernel/src/kernel.ts`, `kernel/src/loop/loop.ts`, `kernel/src/store/migrations/index.ts`, `docs/ARCHITECTURE.md`) and `plan-waves` would put each in its own wave.
Currently, phase 1 hard-codes its six kernel tools (`KERNEL_TOOL_NAMES`), three routes plus abandon, five CLI commands and an injected `handlers` map, and migrations 001–010 create none of the phase 2 tables. This serialises phase 2 into one PR at a time.
Success looks like: the shipped daemon behaves exactly as today (nothing preinstalled), while a test composes a kernel with a contribution from outside and reaches each part through the normal path.

## Acceptance Criteria
- [ ] AC1 — Given a fresh data dir, when the kernel starts, then `schema_migrations` reaches version 11 (name `phase_2_tables`) and the four tables exist with exactly the columns Design decision 9 lists (`triggers`, `notifications`, `approvals`, `loomwright_contract_seen`).
- [ ] AC2 — Given a store at version 10 with phase 1 rows, when the kernel starts, then it migrates to 11 with every phase 1 row intact and the integrity check passes before and after.
- [ ] AC3 — Given the shipped daemon (`startKernel` with no `contributions` option, i.e. the five shipped feature contributions), when it starts, then no kernel tool, API route, CLI subcommand, event handler or due-work function beyond phase 1's is registered (a test lists each set and compares it to phase 1's).
- [ ] AC4 — Given a test contribution with one tool, one route, one subcommand, one handler and one due-work function, when a kernel is composed with it from outside (no edit to a central file), then: the tool is reachable through the kernel MCP server with the `kernel_` prefix and zod validation; the route answers only with the bearer token (401 without); the subcommand runs through `studio` (`runCli`) after the `api.json` pid check and before any token read; the handler runs for its event kind; the due-work function runs once per tick.
- [ ] AC5 — Given two contributions registering the same tool name (or route method+path, subcommand name, handler kind), when the kernel starts, then `startKernel` rejects with `ContributionConflictError` naming both contributors before the store opens (never a silent override); a contribution colliding with a phase 1 tool, route, subcommand or an `options.handlers` kind is refused the same way, naming `phase1` (or `options.handlers`) as the other owner. On the CLI side `runCli` keeps its contract (`Never throws, never sets \`process.exitCode\``): a subcommand collision prints ONE stderr line naming both owners and returns exit code 1. Under launchd the daemon treats `ContributionConflictError` (and `UnknownEventKindError`) as a PERMANENT start failure (`permanentReason` in `kernel/src/daemon-exit.ts`), so launchd does not restart a deterministically broken kernel.
- [ ] AC6 — Given a due-work function that throws, when the loop ticks, then the tick still processes the queue, and exactly one `due_work_failed` event (in `events`) names the contributor.
- [ ] AC7 — `docs/ARCHITECTURE.md`: in "Data model" the existing planned `triggers` row (`type (poll / cron / hook / webhook / git-hook)`) and `approvals` row (`decision (once / always-for-this-playbook / deny)`) are REWRITTEN to match migration 11 (no duplicate rows), and `notifications` and `loomwright_contract_seen` rows are added; a short "Phase 2 features" section says each feature is documented on its own page, describes the contribution seam (tools, routes, subcommands, handlers, due work; collisions refuse to start; `due_work_failed`) and links the five stub pages `docs/architecture/{loomwright,notifications,triggers,approvals,brain}.md` (each a heading plus "Documented by the item that builds it"); the Loopback API bullet `Request bodies are ignored.` is qualified (phase 1 routes ignore bodies; contributed routes receive a bounded parsed JSON body, malformed ⇒ 400 `invalid_json`); the Kernel tools section and the `studio` CLI bullet each gain one sentence that later items add tools/subcommands through contributions. The "Loomwright adapter" section is NOT edited. `bash scripts/check-docs.sh` passes.
- [ ] AC8 — `cd kernel && npm ci && npm run typecheck && npm test` passes; existing tests pass unchanged EXCEPT the schema-version and table-set pins in `kernel/test/store.test.ts` that migration 11 forces to change (listed under "Closed enumerations touched" → schema version 11), and the new `permanentReason` case in `kernel/test/daemon-exit.test.ts`.
- [ ] AC9 — Given `kernel/src/features/index.ts` (the registry the `studio` CLI imports) loaded in a fresh child Node process, then `@anthropic-ai/claude-agent-sdk` is not in the loaded module graph (a pin in `kernel/test/feature-seams.test.ts`), so later contributions cannot silently pull the SDK into `studio`.

## Design decisions the workers must follow (from the source requirement + analysis)

1. **One contribution type, one registry.** Create `kernel/src/features/contribution.ts` holding the `FeatureContribution` type (name + optional `tools`, `routes`, `subcommands`, `handlers`, `dueWork`), a `mergeContributions(...)` that validates every part and throws `ContributionConflictError` (a typed error with `code`, the part kind, the colliding name and both owner names) on any collision, and `kernel/src/features/index.ts` exporting `SHIPPED_CONTRIBUTIONS` — the five feature contributions in a fixed order. This is a new file outside the requirement's Touches list; it is the shared seam (no later item edits it) and it must NOT import the SDK, the session manager or `kernel.ts`, because `kernel/src/cli/index.ts` (a separate process) imports it.
2. **Each feature directory** (`kernel/src/{loomwright,notifications,triggers,approvals,brain}/index.ts`) exports one `FeatureContribution` constant named after it (e.g. `loomwrightContribution`, `name: "loomwright"`) with every part empty/absent. Invariant 1: nothing is preinstalled.
3. **Tools:** a contributed tool declares `name` (must start with `kernel_`, refused otherwise), a description, a zod raw shape, and a handler receiving the phase 1 `KernelToolContext` fields (store, sessions, sessionId, now) PLUS a `stepKey(idempotencyKey)` helper that returns `<tool>:session-<id>:<key>` (the `kernelStepKey` shape) — passed through the handler context so a contribution never imports `kernel/src/tools/server.ts` (which imports the SDK). The tool server builds contributed tools per launch exactly like phase 1's (`createKernelMcpServer` is still called once per launch), validates arguments with zod (`safeParse`) inside its wrapper (an `isError` result, never a throw through the SDK). The contribution's tool TYPE is declared in `kernel/src/features/contribution.ts` using only `zod` and local types. `KERNEL_TOOL_NAMES` stays the phase 1 list; add an accessor that lists phase 1 + contributed names for the AC3 test.
4. **Routes:** a contributed route declares `method`, an exact `path` (or a path pattern with `:param` segments) and a handler `(req: {params, query, body}) => Promise<{status, body}>`. The router authenticates before routing (unchanged), then matches phase 1 routes, then contributed routes; unknown path ⇒ 404, wrong method ⇒ 405. Contributed handlers receive the parsed JSON body (bounded size, 1 MiB ⇒ 413 `body_too_large` beyond; malformed JSON ⇒ 400 `invalid_json`) — phase 1 routes keep ignoring bodies. Order inside `handle` (an ORDER, not a line position): run `isAuthorized` first (it reads headers only); on failure `req.resume()` then 401; then match the route — phase 1 routes and the abandon path call `req.resume()` before doing anything else, exactly as today (the abandon path's client-gone logic depends on a drained body); only a matched contributed route reads the bounded body instead of draining it. Later items (approvals) need bodies, so the seam must carry them now.
5. **CLI subcommands:** a contributed subcommand declares `name`, a one-line `help` (appended to the usage text) and `run(args, client)`, where `client` performs an authenticated API call (`client.request(method, path, body?)`). `runCli` gains `deps.contributions` (default `SHIPPED_CONTRIBUTIONS`); a contributed subcommand is dispatched only after the `api.json` pid check and before the Keychain token read, through the same path as phase 1 commands. Phase 1 `USAGE` text is unchanged when no contribution adds a subcommand.
6. **Event handlers:** contributed handlers are keyed by an existing `EventKind` (`wakeup` / `message`); a contribution naming a kind outside `EVENT_KINDS` is refused at composition with `UnknownEventKindError` (declared in `kernel/src/features/contribution.ts`, naming the contributor and the kind; no queue change in this item). They merge with `options.handlers`; a collision is refused (AC5).
7. **Due work:** `EventLoopOptions` gains `dueWork?: readonly {owner: string; run: (ctx: {store, now}) => void | Promise<void>}[]`. Each tick runs them after `fireDueWakeups` and before queue processing, each in its own try/catch; a throw appends one `due_work_failed` event (`actor` `kernel`, payload `{contributor, error}` clipped with the loop's `clip(errorMessage(err))`) and the tick goes on.
8. **Composition:** `KernelOptions` gains `contributions?: readonly FeatureContribution[]` (default `SHIPPED_CONTRIBUTIONS`). `startKernel` merges them ONCE before the store opens (a conflict throws before any side effect) and threads the merged tools to the MCP factory, routes to `startApiServer`, handlers + dueWork to `EventLoop`. `daemon.ts` passes nothing new (it gets the shipped empty contributions by default) and needs no edit; keep `kernel/src/kernel.ts`'s header wording (`Mechanism only (invariant 1)`) true. `kernel/src/daemon-exit.ts`'s `permanentReason` gains one case each for `ContributionConflictError` and `UnknownEventKindError` (both deterministic: a retry cannot fix them).
9. **Migration 11 schema (`kernel/src/store/migrations/011_phase_2_tables.ts`, export `phase2Tables`, version 11, name `phase_2_tables`)** — inlined from the source requirement's Scope §1 and binding owner decisions (2026-10-14), so no worker needs the gitignored requirement file. Timestamps are ISO-8601 UTC TEXT; `NOW` default idiom from migration 7. Value sets are **closed in code, no SQL CHECK** (precedent `kernel/src/loop/types.ts`: `Closed in code (no SQL CHECK)`), so a later item adds a value without a table rebuild; the item that builds a feature validates its values. Migration 11 creates **no SQL TRIGGER** (the integrity check refuses any trigger the kernel did not list); "an owner's off can't be undone by an agent" is enforced in code by the triggers item using the `enabled_changed_by` column. Use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`.
   - `triggers`: `id INTEGER PRIMARY KEY`, `owning_agent TEXT NOT NULL`, `playbook TEXT` (nullable; playbooks are phase 3), `kind TEXT NOT NULL` (`once` / `cron`), `spec_json TEXT NOT NULL` (once: `{at}` an instant with time zone; cron: `{cron, tz}` with an IANA time zone), `action TEXT NOT NULL` (`notify` / `wake_agent`), `action_payload TEXT NOT NULL` (the stored text), `created_by TEXT NOT NULL` (`agent` / `owner`), `enabled INTEGER NOT NULL DEFAULT 1`, `enabled_changed_by TEXT` (`owner` / `agent`, null until changed), `enabled_changed_at TEXT`, `next_fire_at TEXT`, `last_fired_at TEXT`, `last_result TEXT`, `created_at TEXT NOT NULL DEFAULT NOW`; index on `(enabled, next_fire_at)`.
   - `notifications`: `id INTEGER PRIMARY KEY`, `source TEXT NOT NULL` (`trigger:<id>` / `agent:<name>` / `kernel:<reason>`), `title TEXT NOT NULL`, `body TEXT NOT NULL`, `deep_link TEXT NOT NULL` (`loomwright-studio://notifications/<id>`, written by the notifications item), `created_at TEXT NOT NULL DEFAULT NOW`, `delivery_status TEXT NOT NULL DEFAULT 'pending'` (`pending` / `delivered` / `failed` / `unsupported`), `delivery_detail TEXT`, `delivered_at TEXT`; index on `(delivery_status, id)`.
   - `approvals`: `id INTEGER PRIMARY KEY`, `requesting_agent TEXT NOT NULL`, `requesting_session INTEGER` (references `sessions(id)`), `action TEXT NOT NULL`, `payload_json TEXT NOT NULL` (the exact payload), `requested_at TEXT NOT NULL DEFAULT NOW`, `status TEXT NOT NULL DEFAULT 'pending'` (`pending` / `approved` / `denied`), `decision TEXT` (`once` / `always` / `deny`), `decided_by TEXT`, `decided_at TEXT`; index on `(status, id)`.
   - `loomwright_contract_seen`: `id INTEGER PRIMARY KEY`, `install_path TEXT NOT NULL`, `plugin_version TEXT NOT NULL`, `contract_schema_version INTEGER NOT NULL`, `contract_json TEXT NOT NULL` (as read), `first_seen_at TEXT NOT NULL DEFAULT NOW`, `UNIQUE (install_path, plugin_version, contract_schema_version)`.

## Touched-file invariants

> Grounded at base `05d0e611facf5a91c5594653abdee7a14eb76a2a`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/store/migrations/index.ts`** — keep: append-only ordering, quoting `Append only; never edit a shipped one`; migration 11 is appended after `sessionGroups`, 001–010 untouched.
- **`kernel/src/store/migrations/010_session_groups.ts`** (read-only reference) — reuse: the re-runnable DDL idiom, quoting `Safe to re-run (\`IF NOT EXISTS\`)`; migration 11 uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` for the same reason, and the `NOW` default idiom from `kernel/src/store/migrations/007_event_loop.ts` (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).
- **`kernel/src/store/integrity.ts`** — keep: `APPEND_ONLY_OBJECTS` lists only `events` and its triggers; quoting `that ALTERs or recreates one of these objects`: migration 11 must not touch `events` or its triggers. Change this file only if the new tables need an integrity rule (none expected). Migration 11 creates no trigger (Design decision 9).
- **`kernel/test/store.test.ts`** — pinned by: `toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])` (four places), `expect(err.knownVersion).toBe(10)`, the default-list test (`session_groups (migration 10) and no phase-2 table`, its exact table set, its `not.toContain` loop over `"triggers", "approvals"`, and its `[10, "session_groups"]` list end), and the integrity problem strings `records versions 2, 3, 4, 5, 6, 7, 8, 9, 10, not a contiguous run from 1` and `records versions 1, 2, 4, 5, 6, 7, 8, 9, 10, not a contiguous run from 1`; all move to 11 (the default-list `not.toContain` loop keeps `agents`, `playbooks`, `hooks_installed`, `connectors`). The migration-1-only test's loop (`open({ migrations: [initial] })`) stays unchanged. Comments `awaiting migrations 8 to 10` and `(9 and 10 are no-op re-runs)` update to 11 (`9, 10 and 11 are no-op re-runs` — this relies on migration 11's `IF NOT EXISTS` DDL). Mirror: the v7 -> v8 upgrade test pattern named in `kernel/src/store/integrity.ts` (`the v7 -> v8 upgrade test pattern`) for the new v10 -> v11 test.
- **`kernel/src/tools/server.ts`** — keep: `Tool input is untrusted data (invariant 3)`; `throw through the SDK.` (a validation or domain error is an `isError` result); per-launch construction (`session manager's \`mcpServers\` factory calls this once per launch attempt`); the step key shape `${toolName}:session-${sessionId}:${idempotencyKey}`. Pinned by: `kernel/test/kernel-tools.test.ts` `expect([...KERNEL_TOOL_NAMES]).toEqual(expected)` — `KERNEL_TOOL_NAMES` stays the phase 1 six.
- **`kernel/src/api/server.ts`** — keep: `Every request is authenticated first, whatever its path or method`; 401 body with `WWW-Authenticate: Bearer`; `unknown path ⇒ 404, wrong method ⇒ 405`; the 500 handler `No error text`; the serialized POST control chain for phase 1 POSTs; `req.resume();` still drains the body of every unauthenticated request and every phase 1 / abandon request before that path does anything else (Design decision 4 gives the order: `isAuthorized` → resume+401, or route match → resume for phase 1, bounded read for a contributed route). Pinned by: `kernel/test/api.test.ts`.
- **`kernel/src/cli/index.ts`** — keep: `Never throws, never sets \`process.exitCode\``; `read or send the Keychain token only after checking` that api.json's pid is alive; `The CLI never prints the token`; bad usage ⇒ `USAGE` on stderr, exit 2; `service` dispatched before api.json is read. Pinned by: `kernel/test/cli.test.ts` `expect(c.stderr.text()).toBe(\`${USAGE}\n\`)` and `expect(USAGE).toContain("studio service install|uninstall")`.
- **`kernel/src/loop/loop.ts`** — keep: `failing event never blocks the queue`; `const wakeupsFired = fireDueWakeups(this.#store, this.#now()).length;` runs first in `#runTick`; single-flight `tick()`; `#recordSafely` for loop-level audit rows. Due work goes between those two steps.
- **`kernel/src/loop/types.ts`** — keep: `export const EVENT_KINDS: readonly EventKind[] = ["wakeup", "message"];` (closed in code; unchanged here).
- **`kernel/src/kernel.ts`** — keep: start order and reverse teardown (`A failure after the store opened undoes what had started, in reverse`); `The daemon passes no handler (invariant 1)`; `options.handlers` semantics. Pinned by: `kernel/test/kernel-daemon.test.ts` `daemon.ts never passes handlers`.
- **`kernel/src/daemon.ts`** (expected unchanged) — keep: `import { startKernel } from "./kernel.js";` and the call `startKernel(parseArgs(args))` with no contributions argument; pinned by `kernel/test/kernel-daemon.test.ts` `not.toMatch(/handlers/)` on the file's FULL source — never write the word `handlers` there, not even in a comment.
- **`kernel/src/daemon-exit.ts`** — keep: `Why a retry can't fix \`err\` (an explicit allowlist)`; add one `if (err instanceof …)` line per new deterministic composition error in `permanentReason`; everything else stays transient. Pinned by: `kernel/test/daemon-exit.test.ts`.
- **`docs/ARCHITECTURE.md`** — keep: the `## Data model` table format (`| \`session_groups\` |` row style); links must resolve under `scripts/check-docs.sh` rule 1 (`a relative markdown link in docs/, CLAUDE.md or README.md whose target does not exist`).

## Closed enumerations touched

> Sibling grep at base `05d0e611facf5a91c5594653abdee7a14eb76a2a`: `grep -rnF 'event_unhandled' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.supervisor .` → 11 hits in 5 files.

- **`due_work_failed`** (sibling: `event_unhandled`, a loop-written `events.kind`) — must be named in:
  - `kernel/src/loop/loop.ts` — the loop's doc comment that lists its audit rows (`no handler for the kind ⇒ \`done\` + \`event_unhandled\``) — extend with the due-work failure row.
  - `docs/ARCHITECTURE.md` — the Main loop paragraph (`a kind with no handler is marked \`done\` with an \`event_unhandled\` row`) — extend in the new "Phase 2 features" section (one sentence) rather than the loop paragraph, to keep the diff small.
  - `kernel/src/kernel.ts` — comment only — no change: not a list of event kinds.
  - `kernel/test/loop-queue.test.ts`, `kernel/test/kernel-daemon.test.ts` — assertions on other kinds — no change: not closed lists.
- **schema version 11** (sibling: `10` in the version pins) — must be named in:
  - `kernel/test/store.test.ts` — every pin listed in its Touched-file entry (version lists, `knownVersion`, the default-list table set and `[10, "session_groups"]` end, the two integrity problem strings) — extend to 11.
- **`invalid_json`** (and `body_too_large`) API error codes (sibling: `invalid_id`; `grep -rnF 'invalid_id' kernel/src docs` → `kernel/src/api/server.ts`, `docs/ARCHITECTURE.md`) — must be named in:
  - `kernel/src/api/server.ts` — the `startApiServer` doc comment listing answers (`\`400 {"error":"invalid_id"}\``) — extend.
  - `docs/ARCHITECTURE.md` — the Loopback API bullets — extend (AC7).
- **`ContributionConflictError` / `UnknownEventKindError` as permanent start failures** (sibling: `StoreSchemaTooNewError` in `permanentReason`) — must be named in:
  - `kernel/src/daemon-exit.ts` — `permanentReason`'s allowlist (`if (err instanceof StoreSchemaTooNewError) return`) — extend.
  - `kernel/test/daemon-exit.test.ts` — its permanent-kind cases — extend.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/feature-seams.test.ts` — shipped daemon registers nothing beyond phase 1 (AC3) | add a dummy tool to `loomwrightContribution` in `kernel/src/loomwright/index.ts` |
| `kernel/test/feature-seams.test.ts` — contributed tool without `kernel_` prefix is refused | delete the `kernel_` prefix check in `kernel/src/features/contribution.ts` |
| `kernel/test/feature-seams.test.ts` — contributed route answers 401 without the token | move the contributed-route match above `isAuthorized` in `kernel/src/api/server.ts` |
| `kernel/test/feature-seams.test.ts` — duplicate tool / route / subcommand / handler refused naming both owners | delete the collision throw in `mergeContributions` in `kernel/src/features/contribution.ts` |
| `kernel/test/feature-seams.test.ts` — throwing due work ⇒ tick still processes the queue + one `due_work_failed` | delete the try/catch around a due-work call in `kernel/src/loop/loop.ts` |
| `kernel/test/feature-seams.test.ts` — contributed subcommand runs only after the pid check | move the contributed-subcommand dispatch above `readApiInfo` in `kernel/src/cli/index.ts` |
| `kernel/test/store.test.ts` — fresh store reaches version 11 with the four tables | delete `phase2Tables,` in `kernel/src/store/migrations/index.ts` |
| `kernel/test/store.test.ts` — a v10 store with phase 1 rows migrates to 11, rows intact, integrity passes before and after | delete `CREATE TABLE IF NOT EXISTS approvals (` in `kernel/src/store/migrations/011_phase_2_tables.ts` |
| `kernel/test/feature-seams.test.ts` — a contributed tool's bad arguments return `isError`, never throw | replace `safeParse` with `parse` in the contributed-tool wrapper in `kernel/src/tools/server.ts` |
| `kernel/test/feature-seams.test.ts` — malformed JSON to a contributed route ⇒ 400 `invalid_json` | delete the `JSON.parse` try/catch around the contributed body in `kernel/src/api/server.ts` |
| `kernel/test/feature-seams.test.ts` — a handler for a kind outside `EVENT_KINDS` is refused at composition | delete the `isEventKind` check in `mergeContributions` in `kernel/src/features/contribution.ts` |
| `kernel/test/feature-seams.test.ts` — a contribution colliding with a phase 1 tool / `options.handlers` kind is refused naming `phase1` / `options.handlers` | skip the phase 1 name set in the collision check in `kernel/src/features/contribution.ts` |
| `kernel/test/feature-seams.test.ts` — the registry loads without the SDK (AC9) | add `import "@anthropic-ai/claude-agent-sdk";` to `kernel/src/features/index.ts` |
| `kernel/test/daemon-exit.test.ts` — `ContributionConflictError` is a permanent start failure | delete the `ContributionConflictError` line in `permanentReason` in `kernel/src/daemon-exit.ts` |
| `kernel/test/daemon-exit.test.ts` — `UnknownEventKindError` is a permanent start failure | delete the `UnknownEventKindError` line in `permanentReason` in `kernel/src/daemon-exit.ts` |
| `kernel/test/feature-seams.test.ts` — a contributed handler runs for its event kind | drop the contributed handlers from the `EventLoop` handler merge in `kernel/src/kernel.ts` |
| `kernel/test/feature-seams.test.ts` — due work runs once per tick, after `fireDueWakeups` and before the queue | move the due-work loop after the queue loop in `#runTick` in `kernel/src/loop/loop.ts` |
| `kernel/test/feature-seams.test.ts` — `runCli` on a subcommand collision prints one stderr line and returns 1 without throwing | rethrow `ContributionConflictError` out of `runCli` in `kernel/src/cli/index.ts` |
| `kernel/test/feature-seams.test.ts` — a contributed-route body over 1 MiB ⇒ 413 `body_too_large` | remove the size bound in the contributed-body reader in `kernel/src/api/server.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Migration 11 + store tests + architecture docs | AC1, AC2, AC7, AC8 (store pins) | 3 modify, 6 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Feature contribution seams (type, five empty contributions, tool/API/CLI/loop/kernel merge, daemon-exit case, seams test) | AC3, AC4, AC5, AC6, AC8, AC9 | 8 modify, 8 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/011_phase_2_tables.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/011_phase_2_tables.ts", name: "phase2Tables"}
  - {kind: "symbol", path: "kernel/src/store/migrations/index.ts", name: "phase2Tables"}
  - {kind: "symbol", path: "docs/ARCHITECTURE.md", name: "## Phase 2 features"}
  - {kind: "file", path: "docs/architecture/loomwright.md"}
  - {kind: "file", path: "docs/architecture/notifications.md"}
  - {kind: "file", path: "docs/architecture/triggers.md"}
  - {kind: "file", path: "docs/architecture/approvals.md"}
  - {kind: "file", path: "docs/architecture/brain.md"}
requires: []
lanes:
  - "kernel/src/store/migrations/011_phase_2_tables.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/src/store/integrity.ts"
  - "kernel/test/store.test.ts"
  - "docs/ARCHITECTURE.md"
  - "docs/architecture/*.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/features/contribution.ts"}
  - {kind: "type", path: "kernel/src/features/contribution.ts", name: "FeatureContribution"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "mergeContributions"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "ContributionConflictError"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "UnknownEventKindError"}
  - {kind: "symbol", path: "kernel/src/features/index.ts", name: "SHIPPED_CONTRIBUTIONS"}
  - {kind: "symbol", path: "kernel/src/loomwright/index.ts", name: "loomwrightContribution"}
  - {kind: "symbol", path: "kernel/src/notifications/index.ts", name: "notificationsContribution"}
  - {kind: "symbol", path: "kernel/src/triggers/index.ts", name: "triggersContribution"}
  - {kind: "symbol", path: "kernel/src/approvals/index.ts", name: "approvalsContribution"}
  - {kind: "symbol", path: "kernel/src/brain/index.ts", name: "brainContribution"}
  - {kind: "file", path: "kernel/test/feature-seams.test.ts"}
requires: []
lanes:
  - "kernel/src/features/*.ts"
  - "kernel/src/loomwright/index.ts"
  - "kernel/src/notifications/index.ts"
  - "kernel/src/triggers/index.ts"
  - "kernel/src/approvals/index.ts"
  - "kernel/src/brain/index.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/src/api/server.ts"
  - "kernel/src/cli/index.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/daemon.ts"
  - "kernel/src/daemon-exit.ts"
  - "kernel/test/daemon-exit.test.ts"
  - "kernel/src/loop/loop.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/test/feature-seams.test.ts"
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
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): scope exceeds one worker | MEDIUM | Split into two zero-overlap subtasks (`context-bound`); Subtask 2 is the larger one and should keep each central-file change minimal (merge + dispatch only). |
| A seam shaped wrong forces a later item back into a central file and serialises the waves (source requirement Risks) | HIGH | Follow the Design decisions above (route handlers receive parsed bodies and params; tools get the phase 1 context and step-key helper; CLI subcommands get an authenticated client); AC4's test exercises every part a later item needs. |
| Prior churn (postmortem ledger): `docs/ARCHITECTURE.md` (16), `kernel/src/store/migrations/index.ts` (8), `kernel/src/cli/index.ts` (6), `kernel/src/api/server.ts` (4) — recurring `self_heal_churn` / `drain_churn` | MEDIUM | Workers run the full `npm run typecheck && npm test` and `bash scripts/check-docs.sh` before hand-back; keep docs prose short and exact (past churn was review rounds on doc precision). |
| Open PR #46 (`docs/loomwright-contract-published`) also edits `docs/ARCHITECTURE.md` (the "Loomwright adapter" section) | MEDIUM | Subtask 1 edits only the Data model rows, the Loopback API / Kernel tools sentences and a new section — never the "Loomwright adapter" section — so a later merge is a simple textual merge. |
| `docs/ARCHITECTURE.md` (Subtask 1's lane) must describe Subtask 2's seam before Subtask 2 lands | LOW | Subtask 1 writes the seam description from Design decisions 3–8 only (names: `FeatureContribution`, `ContributionConflictError`, `due_work_failed`, `invalid_json`); Phase 4.5 review checks the doc against the integrated code. |
| `CLI` imports the feature registry in a separate process; an import of SDK/session code from a contribution file would slow or break `studio` | MEDIUM | `kernel/src/features/*.ts` and the five feature `index.ts` files import only types and zod; the step-key helper is passed in the tool handler context (Design decision 3); AC9's child-process pin fails if the SDK enters the registry's module graph. |
| Contributed handler for an event kind outside `EVENT_KINDS` | LOW | Refused at composition with a typed error (Design decision 6); widening kinds is a later item's change to `kernel/src/loop/types.ts` and `kernel/src/loop/queue.ts`. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-14-phase-2-foundation-schema-feature-seams.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-14T12:44:17Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/47
- **Branch:** feature/phase-2-foundation-schema-feature-seams
- **Files changed:** 25
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Migration 11 (four phase 2 tables) + five empty feature contributions merged by the tool server, API, CLI, loop and startKernel; 3 review rounds, 7 MEDIUM+ findings fixed (1 HIGH); final-round fixes (2c1a4b4) not re-reviewed in-loop. 829 tests pass, check-docs OK. Detached drain suppressed by /automate (owned drain follows).

## Not verified
- **docs/ARCHITECTURE.md Phase 2 features seam description** — written from the brief's Design decisions 3-8 before subtask 2's code existed (subtask 1)
- **docs/ARCHITECTURE.md Phase 2 features section (subtask 1)** — other worktree's lane; written without seeing this code (subtask 2)
