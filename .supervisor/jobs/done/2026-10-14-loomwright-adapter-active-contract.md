# Supervisor Job: Loomwright adapter — sessions load the ACTIVE Loomwright, read its `capabilities.json` contract, and run in host mode

## Environment
- **Project:** loomwright-studio (lane clone L1 of `~/Documents/work/AI/loomwright-studio`)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (wave lanes L2 notifications and L3 triggers run in parallel; their declared Touches are their own feature dirs, see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-14-094202-loomwright-adapter-reads-the-active-contract.md
- **Base commit:** 41425e0778cf31a3912694f32bc0a742b6ebf41e

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript, zod, vitest, `node:fs`; all already in `kernel/package.json`. |
| 2 | Dependency Availability | GO | No new dependency. The real contract exists at the active install (17.2.0, `contract_schema_version` 1). |
| 3 | Architecture Fit | GO | Item 01 shipped the `loomwrightContribution` seam (`kernel/src/loomwright/index.ts`) and migration 11; D32 fixes the mechanism. |
| 4 | Scope vs Supervisor Capability | CAUTION | ~22 files (adapter module, tool, fixtures, probes, evidence, session-manager integration, `/status`, test helpers): over the one-worker bound, so the brief splits (`context-bound`, two sequential groups). |
| 5 | Hard Blockers | GO | None. Plugin-scope precedence is documented (see Design decision 2). The two probes are the owner's to run (source requirement Scope §6). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Every Studio session loads the Loomwright install Claude Code treats as active (from `~/.claude/plugins/installed_plugins.json`, never the newest cache folder), reads and validates that install's `capabilities.json` contract (refusing the session with a typed, reported error when it is missing or invalid), runs with the contract's host switch on and a per-session state dir under the Studio data dir, and gets a `kernel_loomwright_capabilities` tool that reports what that Loomwright can do; `GET /status` shows the adapter's state.

**Problem Statement:**
The owner needs Wright to plan with Loomwright's real, current capabilities, without any Studio agent writing Loomwright's hook files into the owner's repos.
Today `kernel/src/sessions/loomwright-path.ts` picks the numerically newest cache folder (D32 rules that out: the cache holds 24 versions, and 17.0.0 — briefly active on 2026-10-13 — shipped without `capabilities.json`), nothing reads the contract, and sessions run without `LOOMWRIGHT_HOST_MODE`, so Loomwright's SessionStart writes `.claude/settings.local.json` and `.supervisor/logs/` into the session's repo (probe p9, 2026-10-06).
Success looks like: a session row's `loomwright_path` is the active install; a missing or bad contract refuses the session with one `session_refused` event and nothing spawned; the child env carries the contract-named host switch; the kernel still starts and answers `/status` when Loomwright is missing.

## Acceptance Criteria
- [ ] AC1 — Given an `installed_plugins.json` naming `loomwright@atelier` 17.2.0 (user scope) and a cache holding 17.2.0 and a newer folder 99.0.0, when a session starts with no configured path, then it loads 17.2.0: the row's `loomwright_path` and the SDK `plugins` option both name the 17.2.0 `installPath`.
- [ ] AC2 — Given the active install has no `capabilities.json` (fixture modelled on the real 17.0.0 copy), when a session starts, then `startSession` throws `SessionError` with code `loomwright_contract` whose message names the install path and the text `capabilities.json missing`; nothing is spawned, no `sessions` row is written, exactly one `session_refused` event is appended (`{reason: "loomwright_contract", detail: "contract_missing", path}`), and `GET /status` shows `loomwright: {status: "error", reason: "contract_missing", …}`; no other install's contract is used.
- [ ] AC3 — Given a contract with `contract_schema_version` 0, or missing `plugin_version`, or not JSON, then the same refusal with the specific reason (`contract_schema_too_old`, `contract_invalid` naming `plugin_version`, `contract_not_json`).
- [ ] AC4 — Given a contract with extra unknown top-level fields and extra unknown per-hook fields, then it is accepted and the unknown fields are ignored (absent from the parsed contract and from the tool's output).
- [ ] AC5 — Given `installed_plugins.json` missing or unparseable and no configured path, then sessions are refused (`loomwright_not_found`) with a message naming that file, one `session_refused` event, nothing spawned; `startKernel` itself still succeeds and `GET /status` answers 200 with `loomwright.status: "error"`.
- [ ] AC6 — Given a valid contract, when a session starts, then the child env has `<host_switch.env>=1` and `<host_switch.state_dir_env>=<dataDir>/loomwright-state/session-<sessions.id>`, that directory exists (mode 0700) before the spawn, and the names come from the contract: a fixture contract that renames them (`TEST_HOST_FLAG` / `TEST_HOST_STATE`) puts exactly those names in the env and not `LOOMWRIGHT_HOST_MODE`. A resume rebuilds the same two variables from the contract at the row's recorded `loomwright_path` (same state dir).
- [ ] AC7 — Given a contract without `host_switch`, then the session is refused with `SessionError` code `loomwright_no_host_switch` (one `session_refused` event, reason `loomwright_no_host_switch`, nothing spawned).
- [ ] AC8 — `kernel_loomwright_capabilities` (a tool of `loomwrightContribution`, reached through the kernel MCP server) returns, for the session's own install, the fixture contract's `plugin_version`, `contract_schema_version`, the agent / command / skill / result-schema names with their one-line descriptions (`description` when the contract entry has one, else `null`), and the hook count by `host_mode`; its output contains no path other than the install path (no hook `script`/`scripts`/`writes`/`matcher`, no `generated_by`). `loomwrightManifestSummary(contract)` returns names + one-liners bounded to at most 4000 characters with a `(truncated)` marker when cut.
- [ ] AC9 — `docs/evidence/phase-2-loomwright-host-mode.md` exists with a section for the p9 rerun with host mode on (the exact command, the `git status --porcelain --ignored` before/after to paste, and the state-dir listing to paste) and a section for the p10 desktop/scope findings (the exact command and the output to paste), plus the documentation findings already verified (Design decision 2); the PR body links it. The probe outputs themselves are pasted by the owner (source requirement Scope §6: "run by the owner") — until then each section says `Owner run: pending`, and the evidence file has a `## Not verified` section listing the p9 host-mode rerun and the p10 desktop/scope probe as `Owner run: pending`.
- [ ] AC10 — `cd kernel && npm ci && npm run typecheck && npm test` passes; `bash scripts/check-docs.sh` passes. Existing tests pass unchanged except the pins listed under "Touched-file invariants" that this change forces (the two exact child-env pins in `kernel/test/sessions.test.ts`, the `resolveLoomwrightPath (AC8)` cache-scan tests that D32 removes, and the shipped-contribution pins in `kernel/test/feature-seams.test.ts`).

## Design decisions the workers must follow

1. **Contract reading (`kernel/src/loomwright/contract.ts`, Subtask 1).** `readLoomwrightContract(installPath: string): LoomwrightContract` reads `<installPath>/capabilities.json` and throws `LoomwrightContractError` (`code = "loomwright_contract_error"`, `reason: LoomwrightContractErrorReason`, `path: string`; message names the path and a human reason, e.g. `capabilities.json missing`) when the file is missing (`contract_missing`), unreadable (`contract_unreadable`), not JSON (`contract_not_json`), not an object or missing/mistyped a required field (`contract_invalid`, naming the field), or `contract_schema_version` below `MIN_CONTRACT_SCHEMA_VERSION` (= 1; `contract_schema_too_old`). Required: `plugin_name` (string, must equal `"loomwright"`), `plugin_version` (non-empty string), `contract_schema_version` (integer), `agents` / `commands` / `skills` / `result_schemas` (arrays whose entries have a non-empty string `name`), `hooks` (array whose entries have string `event` and string `host_mode`). Optional, read when present: an entry's string `description`; a result schema's integer `schema_version`. `host_switch`: absent ⇒ the parsed contract has `host_switch: null` (NOT an error here — `requireHostSwitch(contract)` throws reason `no_host_switch`, so `/status` and the tool can still report such a contract); present ⇒ `env` and `state_dir_env` must be distinct strings matching `^[A-Z][A-Z0-9_]*$` and `effect` a string, else `contract_invalid`. Unknown fields at every level are dropped, never an error (the parsed object is built field by field; nothing is spread from the raw JSON). Bounded read: a file over 4 MiB is `contract_unreadable`. Never parse Loomwright's `plugin.json`, frontmatter, `hooks.json` or `CHANGELOG.md` (D32).
2. **Active install (`kernel/src/loomwright/active-install.ts`, Subtask 1).** `resolveLoomwrightInstall({configured?, installedPluginsPath?, projectPath?}): {installPath, contract, source: "configured" | "installed_plugins", scope: string | null}`. A non-empty `configured` wins (resolved to absolute); it must hold a valid contract (no other check — the `plugin.json` existence check goes, D32), and a bad one is an error, never a fallback. Otherwise read `installedPluginsPath` (default `defaultInstalledPluginsPath()` = `~/.claude/plugins/installed_plugins.json`; tests ALWAYS inject it — no test may read the real home file): missing ⇒ `installed_plugins_missing`; unreadable, not JSON, no `plugins` object, or a `loomwright@<marketplace>` value that is not an array of `{scope: string, installPath: absolute string, version: string}` ⇒ `installed_plugins_unreadable` (naming the key). Candidates: every entry under a key matching `^loomwright@[^@]+$` (so `loomwright-lanes@atelier` never matches) whose `scope` is `user`, or whose `scope` is `project`/`local` AND whose string `projectPath` equals `path.resolve(projectPath)` of the session; an entry with any other scope, or a `project`/`local` entry without a string `projectPath`, is `installed_plugins_unreadable` (fail closed — the file is an internal format, OPEN_QUESTIONS). **Precedence is Claude Code's documented one**, quoted in the code comment and the doc page: "When the same plugin is set at several scopes, the local setting overrides the project setting, and the project setting overrides the user setting." (https://code.claude.com/docs/en/plugins/install.md, "Choose an install scope", read 2026-10-14). Take the highest scope present; more than one candidate at that scope (e.g. two marketplaces) ⇒ `ambiguous_install` naming every candidate (`key scope installPath`) — never guess. No candidate ⇒ `not_installed` naming the file. The winner's `installPath` must be an existing directory, else `install_path_invalid`. Then `readLoomwrightContract(installPath)` (Design decision 1). All parsing of `installed_plugins.json` lives in this one function (source requirement Assumptions). **The cache-scan path is removed entirely** (`defaultPluginCacheRoot`, the `VERSION_DIR` scan, `compareVersions`, the `pluginCacheRoot` option).
3. **Adapter status (Subtask 1, `kernel/src/loomwright/active-install.ts`).** `loomwrightAdapterStatus({configured?, installedPluginsPath?}): LoomwrightAdapterStatus` — never throws: `{status: "ok", install_path, plugin_version, contract_schema_version, host_switch: boolean}` or `{status: "error", reason: LoomwrightContractErrorReason, path: string, message: string}` (for `/status`, resolved with no `projectPath`, i.e. the user-scope view). Read fresh on every call (two small file reads), so `/status` reflects the current active install.
4. **The tool and the manifest (`kernel/src/loomwright/capabilities.ts`, Subtask 1).** `loomwrightCapabilities(contract, installPath)` returns `{install_path, plugin_version, contract_schema_version, agents: [{name, description}], commands: [...], skills: [...], result_schemas: [{name, schema_version}], hooks_by_host_mode: {<host_mode>: count}, host_switch: {env, state_dir_env} | null}` — nothing else (no hook script/matcher/writes, no `generated_by`). `capabilitiesTool` (a `ContributedTool` via `defineTool`, name `kernel_loomwright_capabilities`, empty zod shape, a one-line description) reads the contract at the CALLING session's own install — `ctx.sessions.getSession(ctx.sessionId)?.loomwright_path` (the install that session runs with) — and returns `loomwrightCapabilities(...)`; no row or no path ⇒ throw (the tool server turns it into an `isError` result). `loomwrightManifestSummary(contract, {maxChars = 4000})` returns one header line (`Loomwright <version> (contract <n>)`) then one line per group (`Agents: …`, `Commands: name — description; …`, `Skills: …`, `Result schemas: …`), cut at `maxChars` with a trailing `(truncated)` marker; item 06 puts it into Wright's context (export only — nothing calls it yet). `kernel/src/loomwright/index.ts`: `loomwrightContribution = Object.freeze({ name: "loomwright", tools: [capabilitiesTool] })` and re-exports the adapter API. Every module under `kernel/src/loomwright/` imports only `node:*`, zod and type-level kernel modules: the `studio` CLI loads it (the `feature-seams.test.ts` SDK-free module-graph pin must stay green).
5. **Session integration (`kernel/src/sessions/`, Subtask 2).** `kernel/src/sessions/loomwright-path.ts` becomes the session-side wrapper: `resolveSessionLoomwright(options)` calls `resolveLoomwrightInstall` + `requireHostSwitch` and maps `LoomwrightContractError` to `SessionError`: reasons `installed_plugins_missing` / `installed_plugins_unreadable` / `not_installed` / `ambiguous_install` / `install_path_invalid` ⇒ code `loomwright_not_found`; `contract_*` ⇒ `loomwright_contract`; `no_host_switch` ⇒ `loomwright_no_host_switch`; the `SessionError` message is the adapter error's message; the wrapper also exposes the reason and path for the event. `SessionErrorCode` gains `loomwright_contract` and `loomwright_no_host_switch`. `SessionManagerOptions`: `pluginCacheRoot` is replaced by `installedPluginsPath?: string`; `KernelOptions.sessions`' `Pick` list in `kernel/src/kernel.ts` follows. `startSession` resolves at the existing spot (after `#refuseProtectedCwd` and param checks, before `#admit`) with `projectPath: params.cwd`; any refusal appends ONE `session_refused` event (`session_id` null, payload `{reason: <SessionError code>, detail: <adapter reason>, path}`) through `#recordSafely`, then throws — no row, no auth env, no spawn (the `protected_cwd` pattern, `#refuseProtectedCwd`). After `buildEnv`, if either host-switch name is already a key of the auth-built env ⇒ the same refusal with code `loomwright_contract`, detail `contract_invalid` (a contract may never overwrite an auth variable). After the row insert and before `#launch`, `mkdirSync(<store.dataDir>/loomwright-state/session-<id>, {recursive: true, mode: 0o700})` (the `Store` exposes `dataDir`); a mkdir failure takes the existing spawn-failure path (the `catch` around `#launch`). The launch env is `{...authEnv, [env]: "1", [state_dir_env]: <dir>}`. `resumeSession` reads the contract at the row's `loomwright_path` (no re-resolution: a session keeps the Loomwright it started with), before `#admit`, refusing like a start but with the session's id on the event and the row untouched; each resume attempt rebuilds the same two variables and re-creates the dir. `SessionManager.loomwrightStatus(): LoomwrightAdapterStatus` returns `loomwrightAdapterStatus({configured, installedPluginsPath})`.
6. **`/status` (Subtask 2).** `StatusBody` gains an additive optional `loomwright?: LoomwrightAdapterStatus` field (doc comment: additive, an older CLI ignores it). `ApiServerOptions.sessions` becomes `Pick<SessionManager, "stopAll" | "abandonSession"> & Partial<Pick<SessionManager, "loomwrightStatus">>` so existing fakes keep compiling; `readStatus` takes a new optional last argument `loomwrightStatus?: () => LoomwrightAdapterStatus`: absent ⇒ the `loomwright` field is omitted (API fakes, the existing 4-argument caller); present ⇒ the field is always included. `startApiServer` passes `sessions.loomwrightStatus` (bound) when the sessions object has it; `startKernel` needs no new wiring (it already passes the manager as `sessions`). A `loomwrightStatus` that throws is reported as `{status: "error", reason: "status_threw", path: "", message: <clipped error>}`, never a 500 (the `healthOf`/`health_threw` precedent). `LoomwrightAdapterStatus["reason"]` therefore also allows `"status_threw"`.
7. **Not in this item:** writing `loomwright_contract_seen` rows and the version-change note (item 07); putting the manifest into Wright's context (item 06); any change to `docs/ARCHITECTURE.md` — the feature is documented on `docs/architecture/loomwright.md` (item 01's convention), which states the resolution rule, the precedence quote and its URL, the refusal codes and reason table, the host-mode env and state dir, the tool's output, `/status`'s `loomwright` field, and the desktop/synced limit.
8. **Probes (Subtask 1).** `probes/p9-loomwright-hooks.mjs` gains a `--host-mode` flag: when set, it creates a temp state dir (`mkdtempSync`), passes `env: {...process.env, LOOMWRIGHT_HOST_MODE: "1", LOOMWRIGHT_HOST_STATE_DIR: <dir>}` to `query()`, prints `git status --porcelain --ignored` of `PROBE_CWD` before and after (`execFileSync('git', [...], {cwd})`), and lists the files under the state dir after; without the flag the probe's output is unchanged. New `probes/p10-desktop-plugin-install.mjs` (read-only, no SDK, no network, writes nothing): prints every `installed_plugins.json` entry (key, scope, version, installPath, and the names of any other fields such as `projectPath`), whether `~/.claude/plugins/synced/` exists and what it holds (names only), and a closing line stating what it cannot tell (whether a desktop-app install is recorded in the file). `probes/README.md` gains one line per changed probe only if it lists probes individually (it does not today — then leave it). The workers do NOT run p9 (it spends the owner's subscription in a real session) or p10 (the requirement assigns both to the owner).

## Touched-file invariants

> Grounded at base `41425e0778cf31a3912694f32bc0a742b6ebf41e`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/loomwright/index.ts`** — keep: `so it imports only types and zod: never the Agent SDK.` (header comment; the imports may now also include `node:*` and the new sibling modules); `Object.freeze({ name: "loomwright"` stays the contribution's shape plus `tools`. Pinned by: `kernel/test/feature-seams.test.ts` `expect(SHIPPED_CONTRIBUTIONS.map((c) => c.name)).toEqual(["loomwright", "notifications", "triggers", "approvals", "brain"]);` (unchanged) and the SDK-free module-graph pin (AC9 of item 01, unchanged).
- **`kernel/test/feature-seams.test.ts`** — pinned (these move with this change, Subtask 1): `for (const c of SHIPPED_CONTRIBUTIONS) expect(Object.keys(c)).toEqual(["name"]);` (becomes: every shipped contribution except `loomwright` has only `name`; `loomwright` has `name` and `tools`), `expect(kernelToolNames(kernel.contributions.tools)).toEqual([...KERNEL_TOOL_NAMES]);` and `expect(Object.keys(await launchedTools(kernel, fakes))).toEqual([...KERNEL_TOOL_NAMES]);` (become `[...KERNEL_TOOL_NAMES, "kernel_loomwright_capabilities"]`), `expect(Object.keys(tools)).toEqual([...KERNEL_TOOL_NAMES, "kernel_probe_echo"]);` (gains `"kernel_loomwright_capabilities"` before `"kernel_probe_echo"`). The test title `registers no kernel tool, API route, CLI subcommand, event handler or due work beyond phase 1's` is reworded to name the one shipped tool; the route / subcommand / handler / due-work halves stay exactly as they are.
- **`kernel/src/features/contribution.ts`** (read-only reference) — reuse: `defineTool`, `ContributedToolContext` (`sessions.getSession(id)`, `sessionId`), `TOOL_NAME = /^kernel_[a-z0-9_]{1,64}$/`; the tool's handler throw becomes an `isError` result (`a throw is an \`isError\` result with its message`).
- **`kernel/src/sessions/loomwright-path.ts`** — replaced, keep: `a bad configured path is an error — never` + `a silent fallback to the cache` (two anchors, lines 37–38; the configured path still wins and still never falls back); remove `defaultPluginCacheRoot`, `VERSION_DIR`, `compareVersions` (D32: never scan the cache).
- **`kernel/src/sessions/index.ts`** — keep its re-export style; `export { defaultPluginCacheRoot, resolveLoomwrightPath } from "./loomwright-path.js";` and `export type { ResolveLoomwrightPathOptions }` change to the new names. `grep -rn "defaultPluginCacheRoot\|resolveLoomwrightPath\|pluginCacheRoot" kernel/src kernel/test` must be empty after Subtask 2.
- **`kernel/src/sessions/manager.ts`** — keep: `#refuseProtectedCwd` order (refusal before admission, auth or any spawn) and `#recordSafely("session_refused", …)` for refusals; `const loomwrightPath = resolveLoomwrightPath({` call site stays before `this.#admit(`; the auth-failure branch (`"failed:auth"` row + `#appendNotify`) unchanged; `plugins: [{ type: "local", path: config.loomwrightPath }],` and `settingSources: [],` in `#launch` unchanged; resume keeps `the row's \`model\` and \`loomwright_path\` are reused`. The `#launch` `env: config.env,` line stays — host vars are merged into `config.env` by the callers (start and `#launchResumeAttempt`).
- **`kernel/src/sessions/types.ts`** — keep: `SessionErrorCode` union style with a doc comment per new member (like `protected_cwd`); `SessionManagerOptions` doc comments (`/** The configured Loomwright plugin dir. …` is reworded: configured path wins, else the active install from `installed_plugins.json`).
- **`kernel/src/kernel.ts`** — keep: `Pick<SessionManagerOptions, "loomwrightPath" | "pluginCacheRoot" | "stopGraceMs" | "authTimeoutMs" | "resumeBackoffMs">` changes only `"pluginCacheRoot"` → `"installedPluginsPath"`; start order and `Mechanism only (invariant 1)` wording untouched. Pinned by: `kernel/test/kernel-daemon.test.ts` (`daemon.ts never passes handlers`).
- **`kernel/src/daemon.ts`** (expected unchanged) — pinned by `kernel/test/kernel-daemon.test.ts` `not.toMatch(/handlers/)` on its full source.
- **`kernel/src/api/server.ts`** — keep: `Every request is authenticated first, whatever its path or method`; the `/status` route stays `method: "GET"`; `healthOf` / `{status: "error", reason: "health_threw"}` precedent for a throwing reader (`never a 500`); `StatusBody` additive-field doc style (`(additive: an older CLI ignores it)`). `readStatus(` callers: `kernel/test/sessions-tool-groups.test.ts` calls it with 4 arguments — the new argument is optional so that call compiles unchanged. Pinned by: `kernel/test/api.test.ts`.
- **`kernel/test/sessions.test.ts`** — pinned (these move): `expect(options.env).toEqual({ PATH: "/usr/bin", ANTHROPIC_API_KEY: SECRET });` and `expect(call.options.env).toEqual({ PATH: "/usr/bin", ANTHROPIC_API_KEY: SECRET });` (each gains the two host-mode variables, values asserted exactly); the `describe("resolveLoomwrightPath (AC8)"` block (its cache-scan tests `picks the numerically newest cached version that has a manifest` and `throws loomwright_not_found when nothing valid is cached` are replaced by the installed_plugins.json tests; `prefers a configured path, resolved to absolute` and `refuses to start, with no row, when no Loomwright install is found` keep their intent); the local `makePluginVersion(` helper writes a valid `capabilities.json` (copied from the fixture) so every other test keeps its configured `pluginDir`. The `session_refused` tests at `startSession refuses before admission, auth or any spawn, with one session_refused event and no row` stay unchanged (protected_cwd).
- **`kernel/test/session-fakes.ts`** — keep: `export function makePluginDir(root: string): string {` signature and return value; it additionally writes the valid fixture contract (so `api.test.ts`, `cli.test.ts`, `crash-resume.test.ts`, `kernel-daemon.test.ts`, `feature-seams.test.ts`, `sessions-abandon.test.ts`, `sessions-stop-all.test.ts`, `sessions-tool-groups.test.ts` stay unchanged).
- **`kernel/test/budget-admission.test.ts`**, **`kernel/test/sessions-process-group.test.ts`** — each writes its own plugin dir (`writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), …)`); each gains one call writing the fixture contract there, nothing else.
- **`probes/p9-loomwright-hooks.mjs`** — keep: `Run from a throwaway git repo:  PROBE_CWD=<dir> node p9-loomwright-hooks.mjs`; `settingSources: ['user']`; the existing two sections' output unchanged without `--host-mode`.

## Closed enumerations touched

> Sibling grep at base `41425e0778cf31a3912694f32bc0a742b6ebf41e`: `grep -rnF 'protected_cwd' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.supervisor .` → 16 hits in 6 files (`docs/ARCHITECTURE.md`, `README.md`, `kernel/test/sessions.test.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/sessions/types.ts`, `kernel/src/protected-paths.ts`); `grep -rnF '"loomwright_not_found"' …` → 5 hits in 3 files.

- **`loomwright_contract`, `loomwright_no_host_switch`** (`SessionErrorCode`; sibling `protected_cwd`) — must be named in:
  - `kernel/src/sessions/types.ts` — the `SessionErrorCode` union — extend (Subtask 2).
  - `kernel/src/sessions/manager.ts` — the `startSession` doc comment listing refusals (`folder (\`protected_cwd\`, D31: one \`session_refused\` event, no row) or a`) — extend (Subtask 2).
  - `docs/architecture/loomwright.md` — the refusal list — new (Subtask 2).
  - `docs/ARCHITECTURE.md`, `README.md` — protected_cwd prose only — no change: not a list of codes.
  - `kernel/src/protected-paths.ts` — no change: not a list of codes.
- **`session_refused` payload `reason` values** (sibling `"protected_cwd"` in `#recordSafely("session_refused", sessionId, { reason: "protected_cwd", cwd })`) — the reason set is written only by `manager.ts`; no consumer switches on it (`grep -rn "session_refused" kernel/src` → `manager.ts` only) — extend in `manager.ts` and document on the page.
- **`LoomwrightContractErrorReason`** — new closed union in `kernel/src/loomwright/contract.ts` (Subtask 1); every value must appear in `docs/architecture/loomwright.md`'s reason table (Subtask 2) and in a test.
- **`loomwright` key in `StatusBody`** (sibling `cap_state`) — the `/status` body is consumed by `kernel/src/cli/index.ts` `studio status` (prints the JSON) — no change needed there (additive).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions.test.ts` — AC1: installed_plugins.json 17.2.0 wins over a newer 99.0.0 cache folder | re-add a newest-folder scan as a fallback in `resolveLoomwrightInstall` in `kernel/src/loomwright/active-install.ts` |
| `kernel/test/loomwright-adapter.test.ts` — `loomwright-lanes@atelier` is never a candidate | change `^loomwright@[^@]+$` to `^loomwright` in `kernel/src/loomwright/active-install.ts` |
| `kernel/test/loomwright-adapter.test.ts` — local > project > user precedence | reverse the scope order list in `kernel/src/loomwright/active-install.ts` |
| `kernel/test/loomwright-adapter.test.ts` — two candidates at the winning scope ⇒ `ambiguous_install` | return the first candidate instead of throwing in `kernel/src/loomwright/active-install.ts` |
| `kernel/test/loomwright-adapter.test.ts` — missing `capabilities.json` ⇒ `contract_missing` | treat ENOENT as an empty contract in `readLoomwrightContract` in `kernel/src/loomwright/contract.ts` |
| `kernel/test/loomwright-adapter.test.ts` — schema 0 ⇒ `contract_schema_too_old` | set `MIN_CONTRACT_SCHEMA_VERSION` to 0 in `kernel/src/loomwright/contract.ts` |
| `kernel/test/loomwright-adapter.test.ts` — missing `plugin_version` ⇒ `contract_invalid` | delete the `plugin_version` check in `kernel/src/loomwright/contract.ts` |
| `kernel/test/loomwright-adapter.test.ts` — unknown fields are dropped | build the parsed contract with `...raw` in `kernel/src/loomwright/contract.ts` |
| `kernel/test/loomwright-adapter.test.ts` — tool output carries no hook script/writes/matcher | add `hooks: contract.hooks` to `loomwrightCapabilities` in `kernel/src/loomwright/capabilities.ts` |
| `kernel/test/loomwright-adapter.test.ts` — manifest summary ≤ 4000 chars with `(truncated)` | remove the `maxChars` cut in `loomwrightManifestSummary` in `kernel/src/loomwright/capabilities.ts` |
| `kernel/test/sessions.test.ts` — AC2: missing contract ⇒ `loomwright_contract`, one `session_refused`, no row, no spawn | move the resolve call after `#insertRow` in `startSession` in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions.test.ts` — AC6: host-mode names come from the contract (renamed fixture) | hard-code `"LOOMWRIGHT_HOST_MODE"` instead of `host_switch.env` in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions.test.ts` — AC6: the state dir exists before the spawn | move the `mkdirSync` after `#launch` in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions.test.ts` — AC7: no `host_switch` ⇒ `loomwright_no_host_switch` | drop the `requireHostSwitch` call in `kernel/src/sessions/loomwright-path.ts` |
| `kernel/test/sessions.test.ts` — a host-switch name equal to an auth env key is refused | delete the collision check after `buildEnv` in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions.test.ts` — resume rebuilds host env from the row's install | pass the auth env without host vars in `#launchResumeAttempt` in `kernel/src/sessions/manager.ts` |
| `kernel/test/api.test.ts` — AC5: `/status` answers 200 with `loomwright.status: "error"` when installed_plugins.json is missing | let `loomwrightStatus` throw out of `readStatus` in `kernel/src/api/server.ts` |
| `kernel/test/loomwright-adapter.test.ts` — AC3: not JSON ⇒ `contract_not_json` | catch the `JSON.parse` error and return an empty contract in `readLoomwrightContract` in `kernel/src/loomwright/contract.ts` |
| `kernel/test/loomwright-adapter.test.ts` — `plugin_name` must equal `"loomwright"` | delete the `plugin_name` check in `kernel/src/loomwright/contract.ts` |
| `kernel/test/loomwright-adapter.test.ts` — a configured path with a bad contract is an error, never a fallback | fall back to `installed_plugins.json` when the configured contract is invalid in `resolveLoomwrightInstall` in `kernel/src/loomwright/active-install.ts` |
| `kernel/test/sessions.test.ts` — AC5: installed_plugins.json missing ⇒ `loomwright_not_found` naming the file, one `session_refused`, nothing spawned | drop the `#recordSafely("session_refused", …)` call for resolution refusals in `startSession` in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions.test.ts` — AC6: the state dir has mode 0700 | drop `mode: 0o700` from the state-dir `mkdirSync` in `kernel/src/sessions/manager.ts` |
| `kernel/test/feature-seams.test.ts` — every shipped contribution except `loomwright` has only `name`; `loomwright` has `name` and `tools` | add `tools: []` to `notificationsContribution` in `kernel/src/notifications/index.ts` |
| `kernel/test/feature-seams.test.ts` — the shipped daemon's tools are phase 1's plus `kernel_loomwright_capabilities` | remove `tools: [capabilitiesTool]` from `loomwrightContribution` in `kernel/src/loomwright/index.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Adapter module (contract reader, active-install resolver, adapter status, capabilities tool + manifest summary), fixtures, adapter tests, probes p9/p10, evidence file | AC3, AC4, AC8, AC9, AC10 (adapter + feature-seams pins) | 3 modify, ~10 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Session integration (resolution + refusals + host env + state dir in the session manager, `/status` field, test helpers), and the `docs/architecture/loomwright.md` page | AC1, AC2, AC5, AC6, AC7, AC10 (session pins) | 12 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/loomwright/contract.ts"}
  - {kind: "symbol", path: "kernel/src/loomwright/contract.ts", name: "readLoomwrightContract"}
  - {kind: "symbol", path: "kernel/src/loomwright/contract.ts", name: "requireHostSwitch"}
  - {kind: "symbol", path: "kernel/src/loomwright/contract.ts", name: "LoomwrightContractError"}
  - {kind: "symbol", path: "kernel/src/loomwright/contract.ts", name: "MIN_CONTRACT_SCHEMA_VERSION"}
  - {kind: "type", path: "kernel/src/loomwright/contract.ts", name: "LoomwrightContract"}
  - {kind: "type", path: "kernel/src/loomwright/contract.ts", name: "LoomwrightContractErrorReason"}
  - {kind: "file", path: "kernel/src/loomwright/active-install.ts"}
  - {kind: "symbol", path: "kernel/src/loomwright/active-install.ts", name: "resolveLoomwrightInstall"}
  - {kind: "symbol", path: "kernel/src/loomwright/active-install.ts", name: "defaultInstalledPluginsPath"}
  - {kind: "symbol", path: "kernel/src/loomwright/active-install.ts", name: "loomwrightAdapterStatus"}
  - {kind: "type", path: "kernel/src/loomwright/active-install.ts", name: "LoomwrightAdapterStatus"}
  - {kind: "file", path: "kernel/src/loomwright/capabilities.ts"}
  - {kind: "symbol", path: "kernel/src/loomwright/capabilities.ts", name: "loomwrightCapabilities"}
  - {kind: "symbol", path: "kernel/src/loomwright/capabilities.ts", name: "loomwrightManifestSummary"}
  - {kind: "symbol", path: "kernel/src/loomwright/capabilities.ts", name: "capabilitiesTool"}
  - {kind: "symbol", path: "kernel/src/loomwright/index.ts", name: "loomwrightContribution"}
  - {kind: "file", path: "kernel/test/fixtures/loomwright/capabilities.json"}
  - {kind: "file", path: "kernel/test/loomwright-adapter.test.ts"}
  - {kind: "file", path: "probes/p10-desktop-plugin-install.mjs"}
  - {kind: "file", path: "docs/evidence/phase-2-loomwright-host-mode.md"}
requires: []
lanes:
  - "kernel/src/loomwright/*.ts"
  - "kernel/test/fixtures/loomwright/*"
  - "kernel/test/loomwright-adapter.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "probes/p9-loomwright-hooks.mjs"
  - "probes/p10-desktop-plugin-install.mjs"
  - "docs/evidence/phase-2-loomwright-host-mode.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/sessions/loomwright-path.ts", name: "resolveSessionLoomwright"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "loomwright_contract"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "loomwright_no_host_switch"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "installedPluginsPath"}
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "loomwrightStatus"}
  - {kind: "symbol", path: "kernel/src/api/server.ts", name: "loomwright"}
  - {kind: "symbol", path: "docs/architecture/loomwright.md", name: "# Loomwright"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/loomwright/active-install.ts", name: "resolveLoomwrightInstall"}
  - {from: "1", kind: "symbol", path: "kernel/src/loomwright/active-install.ts", name: "loomwrightAdapterStatus"}
  - {from: "1", kind: "type", path: "kernel/src/loomwright/active-install.ts", name: "LoomwrightAdapterStatus"}
  - {from: "1", kind: "symbol", path: "kernel/src/loomwright/contract.ts", name: "requireHostSwitch"}
  - {from: "1", kind: "symbol", path: "kernel/src/loomwright/contract.ts", name: "LoomwrightContractError"}
  - {from: "1", kind: "file", path: "kernel/test/fixtures/loomwright/capabilities.json"}
lanes:
  - "kernel/src/sessions/loomwright-path.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/index.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/api/server.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/test/session-fakes.ts"
  - "kernel/test/budget-admission.test.ts"
  - "kernel/test/sessions-process-group.test.ts"
  - "kernel/test/api.test.ts"
  - "docs/architecture/loomwright.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 2 ──→ Subtask 1
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (Subtask 2 imports Subtask 1's modules) | YES (dependency) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1 — imports its adapter API and fixture)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): scope exceeds one worker | MEDIUM | Split into two sequential subtasks (`context-bound`); the adapter API is fixed in Design decisions 1–4 so Subtask 2 only wires it. |
| Host mode does NOT keep the repo clean (source requirement Risks) | HIGH | Out of this item's control: the owner's p9 rerun records it in the evidence file and the owner decides; nothing here works around it. The evidence file's `## Not verified` section says the p9 result is pending. |
| `installed_plugins.json` is an internal Claude Code format (OPEN_QUESTIONS); project/local entries' `projectPath` field is unverified | MEDIUM | All parsing in one function (Design decision 2), fail closed (`installed_plugins_unreadable`) on any entry shape it does not know; p10 reports the real fields for the owner. |
| Plugins synced from claude.ai / the desktop app have no install record ("Each of these plugins loads as `<name>@synced`, with no marketplace and no install record", https://code.claude.com/docs/en/plugins/loading.md, read 2026-10-14) | MEDIUM | Such an install is invisible to the adapter: sessions refuse with `not_installed` naming the file, and a configured `loomwrightPath` is the escape hatch; recorded in the evidence file and the doc page. |
| Wave lanes L2 (notifications) and L3 (triggers) run in parallel; this item edits central files `kernel/src/kernel.ts` and `kernel/src/api/server.ts` outside its declared Touches | MEDIUM | Both lanes declare only their own feature dirs, tests and doc pages; keep each central edit to the lines named in Design decisions 5–6 so a wave merge is textual at worst. |
| Contract `host_switch` names could overwrite an auth variable (e.g. `ANTHROPIC_API_KEY`) | MEDIUM | Refused before the row (Design decision 5); names must match `^[A-Z][A-Z0-9_]*$` (Design decision 1). |
| A test reading the owner's real `~/.claude/plugins/installed_plugins.json` | MEDIUM | Every test injects `installedPluginsPath` or a configured path (Design decision 2); the shared `makePluginDir` writes a valid contract. |
| `docs/architecture/loomwright.md` written before or apart from the code | LOW | It is in Subtask 2, which runs after Subtask 1 and holds the session integration. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-14-loomwright-adapter-active-contract.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-14T18:13:20Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/48
- **Branch:** feature/phase-2-loomwright-adapter-active-contract
- **Files changed:** 27
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Loomwright adapter (contract reader, active-install resolver with documented scope precedence, adapter status, kernel_loomwright_capabilities + manifest summary) and session integration (refusals with one session_refused event, contract-named host-mode env + per-session 0700 state dir, /status loomwright field). Phase 4.5: 3 reviews; iteration 1 FAIL (HIGH: contract host_switch names could re-inject credential/billing env vars; MEDIUM: inherited host-switch var refused every session), iteration 2 FAIL (HIGH: deny-list missed code-loading vars like BASH_ENV/PYTHONPATH), iteration 3 PASS. Also fixed a branch-load test race (readGroupLeaderAsync). 883 tests pass, check-docs OK. Detached drain suppressed by /automate (owned drain follows).

## Not verified
- **probes/p9-loomwright-hooks.mjs --host-mode** — owner runs it; syntax-checked only (subtask 1)
- **probes/p10-desktop-plugin-install.mjs** — owner runs it; syntax-checked only (subtask 1)
- **Claude Code doc quotes (install.md precedence, loading.md synced)** — read 2026-10-14 via the docs; not re-fetched by the worker (subtask 1)
- **studio status short summary (kernel/src/cli/index.ts formatStatus)** — outside lanes; only --json shows the loomwright field (subtask 2)
- **real SDK session under host mode** — the p9 rerun is the owner's; not run (subtask 2)
- **host-switch name deny-list completeness** — iteration 3 adversarial name probe was not run (a safety classifier stopped that step); a LOOMWRIGHT_-namespace allowlist would close the class and is an owner decision (Phase 4.5)
