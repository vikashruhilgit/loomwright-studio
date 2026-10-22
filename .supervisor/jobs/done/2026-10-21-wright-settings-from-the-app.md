# Supervisor Job: The owner sets Wright's model, effort and limits through `POST /agents/wright/set`

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-21-052020/L6
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (one existing pin must change; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140007-the-owner-sets-wrights-model-and-limits-from-the-app.md
- **Base commit:** 2b31dd8218e2008e2ad7375d9ad7c16e06c35dd4

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest in `kernel/`; the change extends the existing `set` handler in `kernel/src/agents/roster.ts`. |
| 2 | Dependency Availability | GO | No new npm dependency. It reuses `readAgentSettings` (`kernel/src/agents/settings.ts`), `modelSchema`/`effortSchema` (`charter-files.ts`) and `appendEvent`. |
| 3 | Architecture Fit | CAUTION | The dependency (item 01, PR #101) is merged. Its contract `app/src/api/contract.ts` already declares `WrightSetField` and says "Item 07 adds no route: it widens the existing `POST /agents/:id/set` to accept `wright`", so this item fits the contract unchanged. The requirement's AC "every existing roster test passes unchanged" conflicts with one existing pin: `kernel/test/agents-roster.test.ts` asserts `["set", "wright", "model", "m"]` is refused `reserved`, and this item reverses exactly that behaviour. |
| 4 | Scope vs Supervisor Capability | GO | One handler branch, one new test file, one existing argv entry removed, and one doc page. Single agent. |
| 5 | Hard Blockers | GO | None. No migration, and no credentials (the tests use `loopEnv` and `startApiServer` with stubs). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Widen `POST /agents/:id/set` (and so `studio agents set`) so that, for `wright`, the owner can set `model`, `effort`, `limits.tokens_per_day`, `limits.sessions_at_once` and `limits.delegation_depth` in `config/agents/wright.json`, with the same atomic rewrite and one audit event that crew members get. Every other field and every other lifecycle verb stays `reserved` for Wright.

**Problem Statement:**
The owner needs to change Wright's model, effort and limits from Team's inspector (phase 5, D4, D24), so that setup is the only time a terminal is needed.
Today `memberOf` in `roster.ts` refuses every `set` on `wright` with `409 reserved` ("the owner edits `wright.json`"), so the app has no route to call. That forces the owner back to a text editor for the most common change.
Success: `POST /agents/wright/set {field, value}` changes exactly that key in `wright.json` (every other key keeps its value), records one `agent_settings_set` event with old and new, and keeps `tool_policy`, `permission_mode`, `off`, `on`, `rename` and `show` refused `reserved`.

## Acceptance Criteria

AC1–AC5 are carried forward from the requirement. AC6–AC8 are derived from its Scope (items 1–3) and the owner decisions.

- [ ] **AC1.** Given a `wright.json` with a model, when `POST /agents/wright/set {field: "model", value: "claude-sonnet-5-5"}` runs, then `wright.json`'s `model` is `claude-sonnet-5-5`. Every other key is deep-equal to before (`tool_policy` with its `status`, `permission_mode`, `effort`, `limits`, and any unknown key the owner added, because Wright's reader drops unknown keys but `set` rewrites from the raw parsed bytes). The answer is `200 {agent, field, old, new, changed: true}`, where `agent` is Wright's roster entry. Exactly one `agent_settings_set` event is recorded with payload `{id: "wright", field: "model", old: <previous>, new: "claude-sonnet-5-5", by: "owner"}`. Setting the same value again answers `changed: false` and records no event.
- [ ] **AC2.** Given `field: "tool_policy"` or `field: "permission_mode"` (or any other field not in the five) for `wright`, then the answer is `409 reserved`. Its message keeps the existing reserved form, ending in the file's path: `Wright is not a crew member: set takes only model, effort, limits.tokens_per_day, limits.sessions_at_once or limits.delegation_depth for it; edit the rest in <dataDir>/config/agents/wright.json`. `wright.json`'s bytes are unchanged, and no event is recorded. Given no `wright.json` yet, the refusal does not create one.
- [ ] **AC3.** Given `wright.json` with `limits.sessions_at_once: 2`, when `POST /agents/wright/set {field: "limits.sessions_at_once", value: "none"}` runs, then the `sessions_at_once` key is removed (`limits` stays, even when it becomes empty), `readAgentSettings(dataDir, "wright")` reads ok with no `sessions_at_once`, and the event records `old: 2, new: null`. `effort none` clears effort in the same way. `model none`, `0`, a non-integer or a negative limit are refused `400 invalid_input` naming the field, with the file unchanged.
- [ ] **AC4.** Given every existing roster test (`kernel/test/agents-roster.test.ts`), then each passes. The one exception is the `["set", "wright", "model", "m"]` argv entry in the test "off, rename, set (and show) on wright are refused reserved…": this item reverses that behaviour, so that one entry is **replaced** with `["set", "wright", "tool_policy", "x"]`. The test title stays true, and its stderr regex and `existsSync(wrightFile)).toBe(false)` keep covering a refused Wright `set` through the CLI. A one-line comment beside the argv list records the reversal in the diff (`// item 07: set wright model is now allowed; a reserved field is still refused`). Every other line of that test stays (off, on, rename and show on wright are still refused `reserved`, no event, and no `wright.json` created). No other existing test changes. `kernel/test/agents-charter-tools.test.ts`'s "`kernel_agent_update: reserved`" pin for `wright` still passes unchanged: the non-goal is that no agent, Wright included, changes Wright's settings.
- [ ] **AC5.** Given the change, then `docs/architecture/brain.md`'s `config/agents/wright.json` row adds "or first `POST /agents/wright/set`" to when the file is created, and `docs/architecture/agents.md` documents Wright's settable fields: the five fields, `reserved` for every other field and for `show`/`rename`/`off`/`on`, the Wright event's `by: "owner"`, and that a fresh data dir's `wright.json` is created by the first Wright `set` (as by the brain's first message). The two now-false statements are corrected: "For `wright`, `show`, `rename`, `set`, `off` and `on` are refused `409 reserved`" and "has no limits: Wright's file refuses them". `bash scripts/check-docs.sh` passes, and the `settings-example` block that `agents-roster.test.ts` pins is not touched.
- [ ] **AC6.** Given `studio agents set wright model claude-sonnet-5-5` (the CLI calls only its route), then it exits 0 and prints `studio: agent wright model set to claude-sonnet-5-5 (was …)`. Given `studio agents set wright tool_policy x`, then it exits 1 and stderr is `studio: agent wright not changed: reserved: …wright.json\n`. Given `studio agents set wright limits.tokens_per_day 0`, then it exits 1 with `invalid_input`.
- [ ] **AC7.** Given a fresh data dir with no `wright.json`, when `POST /agents/wright/set {field: "model", value: "m1"}` runs, then `wright.json` is created with Wright's default content through the settings reader's exclusive create. The set then applies on top of it: `model_unset` does not block setting a model, but blocks `effort` or a limit, the same rule crew members follow. The result reads ok.
- [ ] **AC8.** Given `wright.json` sets `limits.tokens_per_day` and `limits.sessions_at_once`, when `GET /agents` runs, then Wright's entry reports those values (null when unset, and also null when the file is absent: a listing never creates it). The inspector can then show what the owner just set. Origin: AC5's corrected doc must hold. `kernel/src/agents/settings.ts` already reads and applies Wright's limits (budget admission, `delegate.ts`), but `wrightEntry` hard-codes both to `null`, and its comment ("Wright's file refuses limits") is stale. A `model_unset` file's `limits` count too (the reader returns them). The change stays in `roster.ts`.

## File Impact Map

| File | Action | Confidence | Why |
|------|--------|------------|-----|
| `kernel/src/agents/roster.ts` | modify | HIGH | `set`: a Wright branch before `memberOf`, using a new exported `WRIGHT_SET_FIELDS`, then the same validate → temp sibling → re-read → event + rename path. `wrightEntry`: read limits. Header comments updated. |
| `kernel/test/agents-wright-settings.test.ts` | create | HIGH | AC1–AC3 and AC6–AC8, using the same harness as `agents-roster.test.ts` (`loopEnv`, `startApiServer`, `runCli`, `events`). It imports `WRIGHT_SET_FIELDS` from `../src/agents/roster.js` directly, so `kernel/src/agents/index.ts` is not touched. |
| `kernel/test/agents-roster.test.ts` | modify | HIGH | Replace only the `["set", "wright", "model", "m"]` argv entry with `["set", "wright", "tool_policy", "x"]`, plus a one-line comment (AC4). |
| `docs/architecture/agents.md` | modify | HIGH | AC5. |
| `docs/architecture/brain.md` | modify | HIGH | AC5: one row, the `wright.json` creation moments. |

Not touched: `app/src/api/contract.ts` (it already declares `WrightSetField` and `AgentSetResponse.agent: AgentRow | RosterEntry`), `kernel/test/console-contract.test.ts` (no route is added), and `kernel/src/agents/settings.ts` (the one reader stays as it is).

## Touched-file invariants

- **`kernel/src/agents/roster.ts`**
  - keep: `memberOf` still refuses `wright` for `show`, `rename`, `off` and `on` (`if (id === WRIGHT_ID) {` and `refusal(409, "reserved", `). Only `set` branches on Wright, before calling `memberOf`, through `const isWright = req.params.id === WRIGHT_ID;`, so `if (id === WRIGHT_ID) {` stays the one occurrence in the file.
  - prescribed literals (the pin mutations below apply to them; write them exactly):
    - the allow-list: `export const WRIGHT_SET_FIELDS = Object.freeze([`, the five fields in the contract's order, `] as const);`
    - Wright's field check: `if (!(WRIGHT_SET_FIELDS as readonly string[]).includes(rawField))`
    - the event's extra key: `const eventBy = isWright ? { by: "owner" } : {};`, spread into the one payload
    - in `wrightEntry`: `const wrightLimits =` (from `read.settings.limits` when ok, or `read.limits` on `model_unset`), then `tokens_per_day: wrightLimits?.tokens_per_day ?? null,` and `sessions_at_once: wrightLimits?.sessions_at_once ?? null,`
  - keep: the field check and the value parse run before anything touches the filesystem, so a refused field never creates `wright.json` (`readAgentSettings` creates it with `wx`).
  - reuse: ONE write path for crew and Wright, not a copy. Specifically `parseSetValue`, `valueAt`, `withValue`, the `ConcurrentEditError` re-read (`if (!readFileSync(file).equals(base)) throw new ConcurrentEditError();`), the temp sibling (`writeFileSync(temp, text, { flag: "wx", mode: 0o600 });`) and `renameSync(temp, file);` inside the event's transaction. There must stay exactly one `appendEvent(req.store, "agent_settings_set"` call site.
  - keep: the whole-file validation gate (`if (!check.ok && !(check.error === "model_unset" && field === "model")) {`), which for Wright reads through `readAgentSettings(dataDir, "wright")`.
  - keep: the crew event payload's shape, exactly `{id, field, old, new}` with no `by`. The roster.ts expression itself may change to the shared form. Only Wright's payload adds `by: "owner"`. Pinned by `agents-roster.test.ts`'s `[{ id: "mason", field: "limits.sessions_at_once", old: 1, new: 2 }]`.
  - keep: imports limited to types, zod, `node:*` and leaf modules, never the Agent SDK or `kernel.ts` (``The `studio` CLI loads this module, so it imports only types, zod, `node:*` ``; pinned by `kernel/test/feature-seams.test.ts`).
  - mirror: `WRIGHT_SET_FIELDS` equals the contract's `export type WrightSetField = "model" | "effort" | "limits.tokens_per_day" | "limits.sessions_at_once" | "limits.delegation_depth";` in `app/src/api/contract.ts`.
- **`kernel/test/agents-roster.test.ts`**
  - keep: every assertion and the title of `off, rename, set (and show) on wright are refused reserved`, including `expect(existsSync(wrightFile)).toBe(false);` and `expect(events(env.store)).toEqual([]);`. Only the one argv entry is swapped to `["set", "wright", "tool_policy", "x"]`.
- **`docs/architecture/agents.md`, `docs/architecture/brain.md`**
  - keep: the `<!-- settings-example:start -->` … `<!-- settings-example:end -->` block in agents.md byte-unchanged (pinned by `docBlock` in `agents-roster.test.ts`). In brain.md, change only the `| \`config/agents/wright.json\` |` row. Every link must resolve (`scripts/check-docs.sh`).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/agents-wright-settings.test.ts`: AC1 model changes, rest deep-equal, one event | delete `renameSync(temp, file);` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`: AC3 `limits.sessions_at_once none` removes the key | flip `if (value === null) delete limits[key];` → `if (value === undefined) delete limits[key];` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`: AC2 `permission_mode` refused `reserved`, file unchanged | flip `export const WRIGHT_SET_FIELDS = Object.freeze([` → `export const WRIGHT_SET_FIELDS = Object.freeze(["permission_mode", ` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`: AC2 `tool_policy` refused `reserved` (not `invalid_input`) | flip `if (!(WRIGHT_SET_FIELDS as readonly string[]).includes(rawField))` → `if (false)` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`: AC2 a refused field on a fresh data dir creates no `wright.json` | move Wright's `readAgentSettings(dataDir, WRIGHT_ID)` call above the field check in `kernel/src/agents/roster.ts` (not machine-applicable; reviewer applies it) |
| `kernel/test/agents-wright-settings.test.ts`: AC1 the Wright event's `by: "owner"` | flip `const eventBy = isWright ? { by: "owner" } : {};` → `const eventBy = {};` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`: AC7 `model_unset` still blocks `effort` / a limit on a fresh file | flip `check.error === "model_unset" && field === "model"` → `check.error === "model_unset"` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`: AC6 the CLI's stderr on a refused Wright set | flip `` `agent ${shown(id)} not changed` `` → `` `agent ${shown(id)} unchanged` `` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`: AC8 Wright's `tokens_per_day` | flip `tokens_per_day: wrightLimits?.tokens_per_day ?? null,` → `tokens_per_day: null,` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-wright-settings.test.ts`: AC8 Wright's `sessions_at_once` | flip `sessions_at_once: wrightLimits?.sessions_at_once ?? null,` → `sessions_at_once: null,` in `kernel/src/agents/roster.ts` |
| `kernel/test/agents-roster.test.ts`: changed pin (the argv entry swapped to `tool_policy x`) | flip `if (id === WRIGHT_ID) {` → `if (id === "not-wright") {` in `kernel/src/agents/roster.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Wright's settable fields through `POST /agents/:id/set` + docs | AC1–AC8 | 4 modify, 1 create (roster.ts, agents-roster.test.ts, agents.md, brain.md; agents-wright-settings.test.ts) | `unit-testing`, `error-handling` | LAUNCHABLE |

```yaml
# Subtask 1 — Wright's settable fields through POST /agents/:id/set (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/agents/roster.ts", name: "WRIGHT_SET_FIELDS"}
  - {kind: "file", path: "kernel/test/agents-wright-settings.test.ts"}
  - {kind: "file", path: "docs/architecture/agents.md"}
requires: []
lanes:
  - "kernel/src/agents/roster.ts"
  - "kernel/test/agents-wright-settings.test.ts"
  - "kernel/test/agents-roster.test.ts"
  - "docs/architecture/agents.md"
  - "docs/architecture/brain.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
Subtask 1 (no dependencies). Its external dependency, item 01 (PR #101), is merged at the base commit.

### File Overlap Matrix
A single subtask, so there is no overlap. Within wave w2 of this automate run, no other phase 5 requirement lists these files in its Touches. Item 01 owns the contract, which is not edited here.

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the requirement's "every existing roster test passes unchanged" contradicts the pin `["set", "wright", "model", "m"]` → `reserved` in `agents-roster.test.ts`. | MEDIUM | Swap only that argv entry to `["set", "wright", "tool_policy", "x"]` (AC4), keep every other assertion, and record the reversal in a one-line comment in the diff and in the PR body. Do not edit any other existing test. If more existing tests turn red, stop and report rather than editing them. |
| A copied Wright write path drifts from the crew path (a second `appendEvent`, a missing re-read). | MEDIUM | Touched-file invariant: one write path and one `appendEvent(… "agent_settings_set"` call site. Wright differs only in the field allow-list, how the settings are read (`readAgentSettings(dataDir, "wright")`), the event's `by`, and the `agent` in the answer. |
| A refused Wright request creates `wright.json` as a side effect (`readAgentSettings` exclusive-creates it). | MEDIUM | Check the field and value before any filesystem call. AC2's fresh-data-dir case in the new test guards this, and so does the existing `existsSync(wrightFile)).toBe(false)` pin, which still runs a refused `set wright tool_policy x` after the AC4 swap. |
| Letting an agent change Wright's settings by accident (non-goal). | HIGH | Only the owner's route changes. `kernel_agent_update`'s `reserved` for `wright` (`charter-tools.ts`) is not touched, and its pin in `agents-charter-tools.test.ts` must stay green. |
| Prior churn: `docs/architecture/agents.md` (5), `roster.ts` (2) and `agents-roster.test.ts` (2) had self-heal churn (read-postmortem). | LOW | Keep doc edits precise (the two false sentences, the `set` bullet, the events line), and run `bash scripts/check-docs.sh` locally. |
| `set` reformats `wright.json` as two-space JSON (a hand-formatted file loses its layout). | LOW | This matches the crew rule ("every other byte of its content parses as before", phase 4 item 02). Document it in agents.md and the Honest limits. |
| A lane that finds the contract (item 01) does not fit. | LOW | `WrightSetField` and `AgentSetResponse` already fit. If anything else is needed in `app/src/api/contract.ts`, stop and say so; do not edit it. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Validation (must pass before merge)
- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-21-wright-settings-from-the-app.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-21T16:30:35Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/106
- **Branch:** feature/wright-settings-from-the-app
- **Files changed:** 5
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** POST /agents/:id/set accepts wright for model, effort and the three limits through the one crew write path (event adds by:"owner"); every other field and show/rename/off/on stay 409 reserved, a refused request never creates wright.json, and GET /agents reports Wright's limits. One roster pin reversed per AC4; agents.md/brain.md updated. Phase 4.5: iteration 1 fixed one MEDIUM (fs errors on Wright's pre-create answered 500 → now 409 settings_invalid naming the file); iteration 2 PASS. 3 LOW findings dismissed (2 below floor, 1 pre-existing symlink replacement). Typecheck + 1906 tests + check-docs green; required CI green.

## Not verified
- **Team inspector UI calling POST /agents/wright/set** — no app runtime here; only the kernel route and the CLI ran (subtask 1)
