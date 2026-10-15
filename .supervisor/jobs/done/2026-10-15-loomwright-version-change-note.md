# Supervisor Job: A Loomwright version change produces a "new features" note built from the contract diff

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-14-212726/L6
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-14-094207-loomwright-version-change-note.md
- **Base commit:** 5b0b60b101a151ba8e441609d86b438c0956ad2d

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest kernel; the change is plain TS over `node:fs`/`node:path` and the existing store. |
| 2 | Dependency Availability | GO | No new dependency. Uses item 01's `loomwright_contract_seen` table (migration 11), item 02's adapter (`resolveLoomwrightInstall`, `readLoomwrightContract`) and item 03's `recordNotification`, all merged on `main`. |
| 3 | Architecture Fit | CAUTION | The feature seam's `DueWorkContext` carries only `{store, now}`; the watcher must resolve the SAME install the session manager does (`loomwrightPath` / `installedPluginsPath`), so one optional field is threaded through the loop (`loop/types.ts`, `loop/loop.ts`) and set by `kernel.ts`. Small central edit outside the feature dir. |
| 4 | Scope vs Supervisor Capability | GO | ~10 files, well under the context-bound threshold: single subtask. |
| 5 | Hard Blockers | CAUTION | Requirement scope 4 says a contract schema version above what the kernel supports makes "item 02 refuse sessions". On `main` the adapter refuses only BELOW `MIN_CONTRACT_SCHEMA_VERSION` (1) and, per D32, tolerates newer contracts ("requires a minimum contract version, tolerates fields it doesn't know, and reports a version change rather than breaking"). The premise is stale; this brief follows D32 (see Risk Assessment). |

**Overall Verdict:** CAUTION

## Task
**Goal:** When the active Loomwright install changes (install path, plugin version or contract schema version), the kernel records the new contract, writes a markdown note of what was added, removed or changed (built only from the old/new `capabilities.json` diff) under `memory/shared/loomwright-updates/`, and creates one notification — breaking signals first.

**Problem Statement:**
The owner needs to learn about new Loomwright capabilities within minutes because Loomwright changes often (D13's goal, D32's mechanism).
Currently, nothing records which contract the kernel saw: `loomwright_contract_seen` (migration 11) exists but has no writer, and a version change goes unnoticed.
Success looks like: within one minute of a version change one note file and one notification exist, later ticks create nothing more, and the first observation ever is recorded silently.

## Acceptance Criteria
- [ ] AC1: Given no prior observation (empty `loomwright_contract_seen`), when the kernel starts with 17.2.0 active (fixture `installed_plugins.json` + install dir with `capabilities.json`), then after the first loop tick exactly one `loomwright_contract_seen` row exists (install path, `17.2.0`, schema 1, `contract_json` = the file's text as read) and no note file and no notification exist.
- [ ] AC2: Given 17.2.0 was seen and the fixture `installed_plugins.json` now names 17.3.0 whose contract adds one command and removes one skill, when the loop ticks with the clock advanced by at least 60 s, then exactly one note file `<dataDir>/memory/shared/loomwright-updates/17.2.0-to-17.3.0.md` lists both items (each with its one-line description), exactly one notification exists with source `kernel:loomwright_version`, title `Loomwright 17.2.0 → 17.3.0`, and a body holding the added/removed counts and the note's path; further ticks (clock advanced again) create no further row, file or notification.
- [ ] AC3: Given 17.2.0 was seen and the new active contract changes `host_switch.env`, when the loop ticks after the transition (clock advanced at least 60 s), then the note's first section (before any other change group) is a breaking section that names the `host_switch` change, and the notification body starts with the breaking count.
- [ ] AC4: Given the new active contract removes a command or an agent, when the loop ticks after the transition (clock advanced at least 60 s), then each is listed in the breaking section (and still counted as a removal).
- [ ] AC5: Given the new active contract's `contract_schema_version` is above `KNOWN_CONTRACT_SCHEMA_VERSION` (the highest version this kernel was written against, 1), when the loop ticks after the transition (clock advanced at least 60 s), then the breaking section names it and states that the adapter still reads the contract and does not refuse sessions (D32: tolerate, report rather than break).
- [ ] AC6: Given the new active install has no `capabilities.json`, when the loop ticks after the transition (clock advanced at least 60 s), then no note is written and no `loomwright_contract_seen` row is added; `loomwrightAdapterStatus` (what `/status` shows) reports `contract_missing`; and exactly one notification (source `kernel:loomwright_version`) says the active Loomwright has no contract, naming the install path — repeated ticks do not add a second one for the same install path.
- [ ] AC7: Given the note file `17.2.0-to-17.3.0.md` already exists from an earlier transition (or was written by the owner), when the loop ticks after the transition (clock advanced at least 60 s), then it is not overwritten (bytes unchanged) and the note is written to the first free suffixed name (`17.2.0-to-17.3.0-2.md`, then `-3`, …); given a crash after the note was written but before the row commit, the next tick reuses the file it already wrote (a provenance marker line identifies the transition) and writes no duplicate.
- [ ] AC8: Given the new plugin version is lower than the old (`17.3.0` → `17.2.0`, including a return to a previously seen triple), when the loop ticks after the transition (clock advanced at least 60 s), then the same note is produced, its title and the notification title name it a downgrade (`Loomwright downgrade 17.3.0 → 17.2.0`), and the row for the active triple becomes the latest row (no UNIQUE-constraint failure).
- [ ] AC9: Given the new active contract adds or removes hooks, or keeps a hook's identity but changes its `host_mode` or `writes`, when the loop ticks after the transition (clock advanced at least 60 s), then the note's hooks group reports them by event and change kind; unknown contract fields at every level are ignored (a contract carrying extra fields diffs the same as one without them).
- [ ] AC10: Given a new plugin version string that is not a safe file-name component (for example containing `/` or `..`), when the loop ticks after the transition (clock advanced at least 60 s), then the note file name is sanitised to `[A-Za-z0-9._-]` and the file is still written inside `memory/shared/loomwright-updates/`.
- [ ] AC11: Given the new active contract changes only descriptions, when the loop ticks after the transition (clock advanced at least 60 s), then they are grouped last in the note and the notification's counts include only additions and removals.
- [ ] AC12: Given this item's diff, when `bash scripts/check-docs.sh` runs, then it passes and `docs/architecture/loomwright.md` has a section describing detection, the diff, the note, the notification, breaking signals, downgrade, the no-contract notification and the limits.
- [ ] AC13: Given the existing kernel test suite, when `npm test` runs, then no test reads the real `~/.claude/plugins/installed_plugins.json`: every `startKernel` call in tests (including `kernel/test/fixtures/crash-harness.mjs`'s non-live default) injects `loomwrightPath` or `installedPluginsPath`, and the whole suite passes.

## Touched-file invariants

> Grounded at base `5b0b60b101a151ba8e441609d86b438c0956ad2d`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/loomwright/contract.ts`** — keep: the field-by-field parse with nothing spread from raw JSON (`nothing is spread from the`), the closed reason list `LOOMWRIGHT_CONTRACT_ERROR_REASONS` unchanged (this item adds no reason), the 4 MiB bound `MAX_CONTRACT_BYTES = 4 * 1024 * 1024`, and the module's import rule (`Imports only \`node:*\` and the dependency-free credential list`); reuse: `readBounded` for any file read; mirror: `readLoomwrightContract`'s public behaviour must stay byte-identical (any refactor that splits parse from read keeps every error reason and message); pinned by: `kernel/test/loomwright-adapter.test.ts`.
- **`kernel/src/loomwright/index.ts`** — keep: the module-graph rule (`it imports only types and zod: never the Agent SDK`) — guarded by the SDK-free module-graph pin in `kernel/test/feature-seams.test.ts`, which must stay green — and `Object.freeze` on the contribution; update: the header's other half (`zod, its modules import only`) is reworded to name the new allowed runtime imports, `../notifications/record.js` and, through it, `../loop/internal.js` (neither loads the Agent SDK); reuse: re-export new public names the way the file already groups `export { … } from "./…js"`; pinned by: `kernel/test/loomwright-adapter.test.ts` (`expect(loomwrightContribution.tools).toEqual([capabilitiesTool])`) and `kernel/test/feature-seams.test.ts` (`loomwright: ["name", "tools"]`).
- **`kernel/src/loop/types.ts`** — keep: `DueWorkContext`'s existing `store` and `now` fields (`export interface DueWorkContext {`); any new field is optional so existing due work and tests compile unchanged.
- **`kernel/src/loop/loop.ts`** — keep: due work runs in its own try/catch and a throw appends one `due_work_failed` row (`this.#recordSafely("due_work_failed"`); the abort check `if (this.#abortTick) return;`; mirror: the context passed in `#runDueWork` must carry exactly the options the loop was constructed with.
- **`kernel/src/kernel.ts`** — keep: contributions merged before the store opens (`// Before the store opens: a deterministically broken composition has no side effect.`), the start/teardown order; mirror: the watcher's install settings must be the same `options.sessions` values the `SessionManager` receives (`...options.sessions,`), so the watcher, sessions and `/status` resolve the same install; fired by: `startKernel` callers (`daemon.ts`, `kernel/test/kernel-daemon.test.ts`, `kernel/test/fixtures/crash-harness.mjs`).
- **`kernel/test/feature-seams.test.ts`** — `SHIPPED_CONTRIBUTIONS` lists loomwright first, so its new due work lands at index 0. Five pins change, every other pin is kept: the loomwright keys pin (`loomwright: ["name", "tools"]` → add `"dueWork"`); the two owner pins (`expect(merged.dueWork.map((d) => d.owner)).toEqual(["notifications", "triggers"])` and `expect(kernel.contributions.dueWork.map((w) => w.owner)).toEqual(["notifications", "triggers"])` → `["loomwright", "notifications", "triggers"]`); and the two index pins (`expect(merged.dueWork[0]?.run).toBe(deliveryDueWork)` and `expect(kernel.contributions.dueWork[0]?.run).toBe(deliveryDueWork)` → index 1, plus an index-0 pin on `versionWatchDueWork`). The two test titles that say no due work beyond the notifications and triggers ones, and the file header comment, are reworded to match.
- **Existing `startKernel` test callers** (`kernel/test/fixtures/crash-harness.mjs`, `kernel/test/kernel-daemon.test.ts`, `kernel/test/loomwright-adapter.test.ts`, `kernel/test/feature-seams.test.ts`, `kernel/test/api.test.ts`, `kernel/test/exit-live.test.ts`) — keep the fixture convention in `kernel/test/fixtures/loomwright/README.md` (`No test reads the real`): every `startKernel` call in tests injects `loomwrightPath` or `installedPluginsPath`. `crash-harness.mjs` today injects `loomwrightPath` only when `--plugin-dir` is given (`args.pluginDir === undefined ? {}`); its default must inject a missing-file `installedPluginsPath` under its data dir (reason `installed_plugins_missing` ⇒ the watcher creates nothing). The harness's live mode (`args.live`) is the owner's real-machine run and may read the real file.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/feature-seams.test.ts` — loomwright contribution keys now include `dueWork` | delete `dueWork: Object.freeze([versionWatchDueWork]),` in `kernel/src/loomwright/index.ts` |
| `kernel/test/feature-seams.test.ts` — merged due-work owners start with `loomwright` (both sites: `mergeContributions` and the started kernel's `contributions`) | delete `dueWork: Object.freeze([versionWatchDueWork]),` in `kernel/src/loomwright/index.ts` |
| `kernel/test/feature-seams.test.ts` — `dueWork[0]?.run` is `versionWatchDueWork` and `dueWork[1]?.run` is `deliveryDueWork` (both sites) | delete `dueWork: Object.freeze([versionWatchDueWork]),` in `kernel/src/loomwright/index.ts` |
| `kernel/test/loomwright-version-note.test.ts` — AC2 later ticks create nothing more | flip `latest.plugin_version === observed.plugin_version` → `false` in `kernel/src/loomwright/version-note.ts` |
| `kernel/test/loomwright-version-note.test.ts` — AC7 kept file not overwritten | flip `flag: "wx"` → `flag: "w"` in `kernel/src/loomwright/version-note.ts` |
| `kernel/test/loomwright-version-note.test.ts` — AC1 first observation is silent (no note, no notification) | delete the `latest === undefined` baseline early return in `kernel/src/loomwright/version-note.ts` (the first observation then writes a note) |
| `kernel/test/loomwright-version-note.test.ts` — AC3 breaking section comes first | move the Breaking section's render after the Added section in `kernel/src/loomwright/version-note.ts` |
| `kernel/test/loomwright-version-note.test.ts` — AC5 schema version above known is breaking | flip `> KNOWN_CONTRACT_SCHEMA_VERSION` → `> Number.MAX_SAFE_INTEGER` in `kernel/src/loomwright/version-note.ts` |
| `kernel/test/loomwright-version-note.test.ts` — AC6 one no-contract notification per install path | delete the existing-notification lookup before the no-contract `recordNotification` in `kernel/src/loomwright/version-note.ts` |
| `kernel/test/loomwright-version-note.test.ts` — AC7 crash recovery reuses its own file | delete the marker-equality reuse check in `kernel/src/loomwright/version-note.ts` (a retry then writes `-2`) |
| `kernel/test/loomwright-version-note.test.ts` — AC8 downgrade title and re-seen triple becomes latest | delete the same-triple `DELETE FROM loomwright_contract_seen` inside the transaction in `kernel/src/loomwright/version-note.ts` (UNIQUE then fails) |
| `kernel/test/loomwright-version-note.test.ts` — AC10 sanitised name stays inside the directory | delete the character replacement (`/[^A-Za-z0-9._-]/g`) or the resolved-path containment check in `kernel/src/loomwright/version-note.ts` — each mutant must turn a pin red (two cases: a `/`-bearing version and a `..` version) |
| `kernel/test/loomwright-version-note.test.ts` — AC11 counts exclude description changes | add description-change entries to the notification's added count in `kernel/src/loomwright/version-note.ts` |

(The exact literals in the version-note rows are the implementer's to choose; keep each row machine-applicable by quoting a literal that exists in the final code, and update this table in the PR body if it differs.)

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Version watcher, contract diff, note, notification, docs | all | 9-12 modify (contract.ts, loomwright-adapter.test.ts, api.test.ts, exit-live.test.ts only if needed), 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Design (binding for the worker; deviations named in the PR body)

1. **New module `kernel/src/loomwright/version-note.ts`** (imports only `node:*`, its siblings, `../notifications/record.js` and type-level kernel modules — never the Agent SDK; the `studio` CLI loads `loomwright/index.ts`).
   - `diffLoomwrightContracts(oldText, newText)`: parses both raw contract texts **tolerantly and field by field** (never spreads raw JSON; unknown fields ignored) into: agents / commands / skills / result schemas keyed by `name` (added, removed, description changed; result schemas also `schema_version` changed); hooks keyed by identity `event` + `matcher` + `script` (multiset: duplicates get an ordinal), reported added / removed / `host_mode` changed / `writes` changed (writes compared as a sorted set); `host_switch` changed (any of `env`, `state_dir_env`, `effect`, or presence); `contract_schema_version` changed. Returns a plain structure plus the breaking list.
   - **Breaking signals:** removed command, removed agent, any `host_switch` change, new `contract_schema_version` above `KNOWN_CONTRACT_SCHEMA_VERSION` (exported constant, `1`).
   - `renderVersionNote(...)`: markdown, sections in this order: Breaking (only when non-empty), Added, Removed, Changed (hooks, result-schema versions, schema version), Description changes (last). Each entry shows its name and its one-line description (or `(no description)`). Hooks are shown by event and change kind with counts of `writes` paths added/removed — never their script, matcher or write paths (same rule as `capabilities.ts`: nothing a hook does reaches a model; memory files go into Wright's context). Includes a provenance marker line `<!-- loomwright-version-note from:<old row id> to:<install_path>|<plugin_version>|<contract_schema_version> -->`.
   - `checkLoomwrightVersion(ctx, settings)` — the due-work body:
     - At most once per 60 s per due-work instance (in-memory last-check time; the first tick after start always checks — "at kernel start").
     - Resolves the active install with item 02's `resolveLoomwrightInstall({configured, installedPluginsPath})` (no `projectPath`: the user-scope view `/status` uses), then reads `<installPath>/capabilities.json` once with `readBounded` and validates that same text with the adapter's parser, so the stored `contract_json` is exactly the validated bytes.
     - Compares (install path, plugin version, schema version) with the latest `loomwright_contract_seen` row (highest `id`). Table empty ⇒ insert silently (baseline). Same triple ⇒ nothing. Different triple ⇒ if plugin version and schema version are both unchanged (install path only), record the row silently; otherwise write the note, then in ONE transaction delete any older row with the same triple (UNIQUE constraint; a re-activated triple becomes the latest row) and insert the new row and `recordNotification` (source `kernel:loomwright_version`).
     - Note file: `<store.dataDir>/memory/shared/loomwright-updates/<old>-to-<new>.md`, directories created if absent (mode 0700 dirs), version components sanitised to `[A-Za-z0-9._-]` (any other character → `_`, a leading `.` stripped, empty → `unknown`), resolved path verified to stay inside the directory. Written with exclusive create (`wx`); `EEXIST` ⇒ if that file's marker line equals this transition's marker, reuse it (crash recovery), else try `-2`, `-3`, … . Never overwrites.
     - Title `Loomwright <old> → <new>`, or `Loomwright downgrade <old> → <new>` when the new version is lower (numeric dot-segment comparison of `MAJOR.MINOR.PATCH`; a non-numeric version is never called a downgrade). Clipped to `MAX_NOTIFICATION_TITLE`. Body: breaking count first when non-zero, then `<n> added, <m> removed`, then the note's path; clipped to `MAX_NOTIFICATION_BODY`.
     - Contract error (`LoomwrightContractError` whose reason starts `contract_`): no note, no row; one notification titled `The active Loomwright has no usable contract`, body naming the install path and the adapter message — created only when no notification with the same source, title and body exists (crash-safe dedupe from the table, so once per install path, which is once per version for marketplace installs). Any other adapter reason (`not_installed`, `installed_plugins_missing`, …): nothing (that is `/status`'s job).
   - Exported `createVersionWatchDueWork(options?)` (injectable minimum interval) and the default `versionWatchDueWork`.
2. **`kernel/src/loomwright/index.ts`:** the contribution gains `dueWork: Object.freeze([versionWatchDueWork])`; re-export the new public names.
3. **Settings plumbing:** `DueWorkContext` and `EventLoopOptions` gain an optional `loomwright?: { readonly configured?: string; readonly installedPluginsPath?: string }`; `EventLoop` passes it into each due-work call; `startKernel` sets it from `options.sessions?.loomwrightPath` / `options.sessions?.installedPluginsPath`. Absent ⇒ the adapter's defaults (the real `installed_plugins.json`), the same exposure `/status` already has.
4. **`kernel/src/loomwright/contract.ts`:** may export a parse-from-text function split out of `readLoomwrightContract` (behaviour of `readLoomwrightContract` unchanged).
5. **Docs:** `docs/architecture/loomwright.md` gets a "Version changes" section (replace the "Not in this item" limit line); `docs/ARCHITECTURE.md`'s `loomwright_contract_seen` row notes that a re-activated triple's row is replaced so the latest row is the active contract.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/loomwright/version-note.ts"}
  - {kind: "symbol", path: "kernel/src/loomwright/version-note.ts", name: "diffLoomwrightContracts"}
  - {kind: "symbol", path: "kernel/src/loomwright/version-note.ts", name: "renderVersionNote"}
  - {kind: "symbol", path: "kernel/src/loomwright/version-note.ts", name: "checkLoomwrightVersion"}
  - {kind: "symbol", path: "kernel/src/loomwright/version-note.ts", name: "createVersionWatchDueWork"}
  - {kind: "symbol", path: "kernel/src/loomwright/version-note.ts", name: "KNOWN_CONTRACT_SCHEMA_VERSION"}
  - {kind: "symbol", path: "kernel/src/loomwright/index.ts", name: "versionWatchDueWork"}
  - {kind: "file", path: "kernel/test/loomwright-version-note.test.ts"}
  - {kind: "symbol", path: "docs/architecture/loomwright.md", name: "Version changes"}
requires: []
lanes:
  - "kernel/src/loomwright/**"
  - "kernel/src/loop/types.ts"
  - "kernel/src/loop/loop.ts"
  - "kernel/src/kernel.ts"
  - "kernel/test/loomwright-version-note.test.ts"
  - "kernel/test/feature-seams.test.ts"
  - "kernel/test/loomwright-adapter.test.ts"
  - "kernel/test/kernel-daemon.test.ts"
  - "kernel/test/api.test.ts"
  - "kernel/test/exit-live.test.ts"
  - "kernel/test/fixtures/crash-harness.mjs"
  - "docs/architecture/loomwright.md"
  - "docs/ARCHITECTURE.md"
external_requires: []
```

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
| Requirement premise: "a contract schema version above what this kernel supports (then item 02 refuses sessions)". On `main` the adapter refuses only below the minimum and D32 says it tolerates newer contracts (source: Feasibility (Phase 2.5)). | MEDIUM | Follow D32: flag the higher schema version as breaking, state in the note that sessions are NOT refused, and name the premise mismatch in the PR body for the owner. Do not add a maximum-version refusal to the adapter. |
| Feature-seam plumbing touches central files (`loop/types.ts`, `loop/loop.ts`, `kernel.ts`) that sibling wave lanes may also touch (source: Feasibility (Phase 2.5)). | MEDIUM | Keep the edit to one optional field and one pass-through; no reordering; wave integration resolves marker-only conflicts. |
| Kernel tests that start the kernel without `installedPluginsPath` make the watcher read the real `~/.claude/plugins/installed_plugins.json` (same as `/status` today). | MEDIUM | AC13: every `startKernel` test path injects a fixture `loomwrightPath` or `installedPluginsPath` (the crash harness's non-live default gets a missing-file path), so the README convention `No test reads the real` keeps holding. Only `contract_*` errors notify. The shipped daemon reads the real file, as `/status` does. |
| Hook scripts, matchers or write paths leaking into Wright's context through the note. | MEDIUM | Render hooks by event and change kind with counts only (the `capabilities.ts` rule). |
| Untrusted `plugin_version` used in a file path (traversal). | HIGH | Sanitise to `[A-Za-z0-9._-]`, strip leading dots, verify the resolved path stays in the directory (AC10). |
| Description-only churn makes noisy notes. | LOW | Description changes grouped last; notification counts only additions and removals (AC11). |
| Deleting an older row with the same triple loses its first sighting time. | LOW | Documented in `docs/ARCHITECTURE.md` and the doc page; the latest row is then always the active contract. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-15-loomwright-version-change-note.md
```

## Plan Review: PASS (attempt 3/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | MEDIUM | Pin mutations | AC4 (removed command/agent is breaking) and AC9 (hook diff, unknown fields ignored) have no Pin mutations row | deferred — worker adds rows and lists them in the PR body |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-15T04:35:59Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/53
- **Branch:** feature/07-loomwright-version-note
- **Files changed:** 11
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Version watcher due work, contract diff, note under memory/shared/loomwright-updates/, one kernel:loomwright_version notification (breaking first, downgrade title, deduped no-contract notice), loop/kernel settings plumbing, crash-harness fixture default, docs. Phase 4.5: iteration 1 FAIL (1 HIGH long-marker crash-retry duplicate, 1 MEDIUM hook-only body) fixed in 1acb1b7; iteration 2 PASS. 4 LOW findings dismissed below the fix floor.

## Not verified
- **shipped daemon reading the real ~/.claude/plugins/installed_plugins.json** — tests always inject fixture paths by design (AC13); no real-machine run (subtask 1)
