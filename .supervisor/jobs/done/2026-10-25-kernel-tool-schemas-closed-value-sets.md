# Supervisor Job: Kernel tool schemas show their closed value sets, so a model doesn't guess

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-24-064605/L11
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-24-115029-kernel-tool-schemas-show-their-closed-value-sets.md
- **Base commit:** 9137fb39a4fe7028af13e1504e622bf139b09f5c

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + zod 4 (`^4.6.5`) + `@anthropic-ai/claude-agent-sdk` 0.3.284, all already in `kernel/package.json`. |
| 2 | Dependency Availability | GO | No new dependency. Probed 2026-10-25 against the kernel's own lockfile (scratch `npm ci`, real `createSdkMcpServer` + MCP `Client` over `InMemoryTransport`): both a `z.enum` / `.int().positive()` shape AND a `z.unknown().meta(<JSON Schema from z.toJSONSchema(...)>)` override list through `tools/list` with `enum` arrays and `"type":"integer","exclusiveMinimum":0` intact. `kernel_trigger_register` already ships `z.enum(TRIGGER_KINDS)` and lists green in `tools-sdk-list.test.ts`. |
| 3 | Architecture Fit | GO | Mechanism only (invariant 1): no value set changes; the kernel's own checks (`validateCharter`, `checkPolicyValue`) stay as defence in depth. |
| 4 | Scope vs Supervisor Capability | GO | ~6 files, well under the `context-bound` bound; single subtask. |
| 5 | Hard Blockers | GO | None. |

**Overall Verdict:** GO

## Task
**Goal:** Every shipped kernel tool's published input schema (what `tools/list` offers a session) lists each closed value set the kernel's checks enforce as a JSON-Schema `enum`, and each positive-count bound as a positive integer, with a walk test that fails when one is missing.

**Problem Statement:**
The owner needs Wright to draft a valid kernel tool call the first time because every refused call costs a session turn.
Currently, `kernel_agent_create` publishes its `charter` as a bare `{"type":"object"}` (`charter-tools.ts`: `z.unknown()….meta({ type: "object" })`), and `kernel_agent_update` types `avatar` as `z.object({ shape: z.string(), hue: z.string() })`, `never` as `z.array(z.string())`, `permission_mode` as `z.string()` and limits as `z.number()`; `kernel_playbook_create`/`_update` type `dedupe_key` items as `z.string()` and `token_limit` as `z.number().int()`. The closed sets are only checked after the call (`validateCharter`, `checkPolicyValue`), so the model never sees them. In the phase 5 live run Wright's `kernel_agent_create` was refused four times (avatar.shape, avatar.hue, tool_policy.never.0, limits.delegation_depth) before the fifth call was held.
Success looks like: `tools/list` shows those sets as enums and the bounds as positive integers, a test walks all 22 shipped tools and fails on any enforced closed set not published as an enum, and the SDK listing still succeeds.

## Acceptance Criteria
- [ ] **AC1** — Given `listKernelTools(SHIPPED)` (the SDK `tools/list` path), when `kernel_agent_create`'s `inputSchema` is read, then `properties.charter` lists `avatar.shape` as an `enum` equal to `AVATAR_SHAPES`, `avatar.hue` as an `enum` equal to `AVATAR_HUES`, `permission_mode` as an `enum` equal to `CHARTER_PERMISSION_MODES`, `tool_policy.never.items` as an `enum` equal to `NEVER_CATEGORIES`, and each of `limits.tokens_per_day`, `limits.sessions_at_once`, `limits.delegation_depth` as `"type": "integer"` with `exclusiveMinimum: 0` (or `minimum: 1`).
- [ ] **AC2** — Given the same listing, when `kernel_agent_update`'s `inputSchema` is read, then `properties.changes` lists `avatar.shape`/`avatar.hue`, `permission_mode` and `never.items` as enums equal to the same four constants, and each `limits.*` as a positive integer (nullable: `null` still clears a limit).
- [ ] **AC3** — Given the same listing, when `kernel_playbook_create` and `kernel_playbook_update` (`changes`) are read, then `dedupe_key.items` is an `enum` equal to `DEDUPE_KEY_FIELDS`, `priority` an `enum` equal to `PLAYBOOK_PRIORITIES`, `trigger.kind` an `enum` equal to `TRIGGER_KINDS`, and `token_limit` a positive integer; and `kernel_trigger_register`'s `kind`/`action` are enums equal to `TRIGGER_KINDS`/`TRIGGER_ACTIONS`.
- [ ] **AC4** — Given a new walk test in `kernel/test/tools-sdk-list.test.ts` holding a table `CLOSED_VALUE_SETS` keyed by tool name (a tool with no closed set maps to an empty list), when it runs, then it (a) fails if the table's keys are not exactly `kernelToolNames(SHIPPED)` (all 22, so a new tool must be classified), and (b) for every entry resolves the path in the listed `inputSchema` and fails unless it is an `enum` whose values equal the source constant (or, for a bound entry, `"type":"integer"` with a positive lower bound); for a nullable entry (zod 4 publishes `.nullable()` as `anyOf: [<schema>, {"type":"null"}]`, e.g. `kernel_agent_update`'s three limits) the resolver checks the non-null `anyOf` branch; the test passes for every shipped tool.
- [ ] **AC5** — Given a charter the model sends with an own `__proto__` key, or any value outside a closed set, when the pre-hold check runs, then it is still refused exactly as on the base commit: `validateCharter` sees the charter as sent (`charter` stays a runtime `z.unknown()` whose published schema comes from `.meta(...)`), and `validateCharter` / `checkPolicyValue` / the store checks are unchanged (no value set is added, removed or reordered).
- [ ] **AC6** — Given `cd kernel && npm ci && npm run typecheck && npm test`, when it runs, then it passes, including `tools-sdk-list.test.ts` (no `z.record` anywhere in a tool shape; the old `toEqual({ type: "object" })` charter pin is replaced by AC1's assertions, keeping a check that `charter` is not a record: `charter.additionalProperties` is absent or `false` (never an object schema — `.strict()` publishes `false`) and `charter.properties` is an object). Any existing pin whose refusal now comes from argument validation (`<tool>: invalid input: …`) instead of the domain check (`<tool>: invalid_input: …`) is updated to the new source in the same commit, keeping its field-name assertion.

## Touched-file invariants

> Grounded at base `9137fb39a4fe7028af13e1504e622bf139b09f5c`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/agents/charter-tools.ts`** — keep: `charter` is parsed at runtime as `z.unknown()` with the object refine (`.refine((v) => typeof v === "object" && v !== null && !Array.isArray(v), { message: "charter must be a JSON object" })`) so `validateCharter` sees the charter as sent and refuses `__proto__` — only its `.meta(...)` argument changes, from `{ type: "object" }` to the charter's JSON Schema; keep the "Not `z.record`" comment's reason; keep `CHARTER_TOOL_REFUSALS` and its order unchanged; keep the header's import rule (never the Agent SDK, the session manager or `kernel.ts`: `the session manager or \`kernel.ts\` (\`kernel/test/feature-seams.test.ts\`)`) — importing `NEVER_CATEGORIES` from `../sessions/policy.js` is safe (`charter-files.ts` already imports it), and the worker adds `../sessions/policy.js` to the header's listed imports in the same edit. reuse: `AVATAR_SHAPES`, `AVATAR_HUES` (already imported from `./types.js`), `CHARTER_PERMISSION_MODES` (already imported from `./charter-files.js`) and `NEVER_CATEGORIES` — never a copied literal list. Prescribed spellings in `changesSchema` (each once in the file, for the Pin mutations rows): `shape: z.enum(AVATAR_SHAPES)`, `hue: z.enum(AVATAR_HUES)`, `permission_mode: z.enum(CHARTER_PERMISSION_MODES as [AllowedPermissionMode, ...AllowedPermissionMode[]]).optional()`, `never: z.array(z.enum(NEVER_CATEGORIES))`, and `const limitChange = z.number().int().positive().nullable().optional();`. mirror: `changesSchema` stays `.strict()` with the `.refine((c) => Object.values(c).some((v) => v !== undefined), "name at least one field to change")`; `limitChange` stays `.nullable().optional()` (null clears a limit). pinned by: `kernel/test/agents-charter-tools.test.ts` — kept: `'unknown key "__proto__"'`, `/^kernel_agent_create: invalid input: /`; **updated per AC6** (not kept): `/^kernel_agent_update: invalid_input: the result would not be a valid charter: tool_policy\.never\.0: /`, which moves to `kernel_agent_update: invalid input: …` naming `never` once `changes.never` is an enum.
- **`kernel/src/agents/charter-files.ts`** — keep: `charterSchema` (the `validateCharter` rule) byte-identical in its rules: `avatar: z.object({ shape: z.enum(AVATAR_SHAPES), hue: z.enum(AVATAR_HUES) }).strict(),`, `const limit = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);`, `.strict()` everywhere. Only add an export of the charter's JSON Schema derived from it (`CHARTER_JSON_SCHEMA = z.toJSONSchema(charterSchema)` minus its top-level `$schema` key), so the published schema and the check share one source. This module is loaded by the `studio` CLI: import nothing beyond what it already imports (zod is already there).
- **`kernel/src/playbooks/drafts.ts`** — keep: `policyShape`'s keys and optionality (`dedupe_key`, `priority`, `model`, `token_limit`) and `triggerShape`'s `kind: z.enum(TRIGGER_KINDS)`; keep the `LIMITS` / `REPEAT` description strings; the store's `checkPolicyValue` in `kernel/src/playbooks/store.ts` stays the domain check (`dedupe_key must be a non-empty list of distinct fields from`) and is not edited. reuse: `DEDUPE_KEY_FIELDS` from `./types.js` (as `store.ts` imports it). pinned by: `kernel/test/playbooks-drafts.test.ts` (`[{ dedupe_key: ["playbook.id", "repo.sha"] }, "dedupe_key"]`, `[{ token_limit: 0 }, "token_limit"]`, `expect(text.startsWith("kernel_playbook_create: "), text).toBe(true);`).
- **`kernel/test/agents-charter-tools.test.ts`, `kernel/test/playbooks-drafts.test.ts`** (edited only where a pin's refusal source moves) — keep: every moved pin still asserts its field name and its `kernel_<tool>: ` prefix; the create pins do not move, because `charter` stays a runtime `z.unknown()`: `'unknown key "__proto__"'` and `/^kernel_agent_create: invalid_input: tool_policy\.never\.0: .*\(nothing was held for the owner\)$/` stay byte-identical; the playbook refusal table (`[{ dedupe_key: ["playbook.id", "repo.sha"] }, "dedupe_key"]`, `[{ token_limit: 0 }, "token_limit"]`) stays green under `kernel_playbook_create: invalid input: …` since the message still names the field, and `expect(text.startsWith("kernel_playbook_create: "), text).toBe(true);` still holds; `expect(errorText(await create({ intent: "" }))).toBe("kernel_playbook_create: intent must not be empty");` is unaffected (intent is not a closed set). No assertion is deleted to make the suite pass.
- **`kernel/test/tools-sdk-list.test.ts`** — keep: `expect(expected).toHaveLength(22);`, the record fixture `recordTool` and every `(b)`–`(e)` case unchanged; the walk test lists through `listKernelTools(SHIPPED)` (the real SDK path), never through the kernel's own `z.toJSONSchema` alone (the header explains why).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/tools-sdk-list.test.ts` — AC1 create `avatar.shape` enum | flip `shape: z.enum(AVATAR_SHAPES), hue` → `shape: z.string(), hue` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC1 create `avatar.hue` enum | flip `hue: z.enum(AVATAR_HUES)` → `hue: z.string()` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC1 create `permission_mode` enum | flip `permission_mode: z.enum(CHARTER_PERMISSION_MODES as [AllowedPermissionMode, ...AllowedPermissionMode[]])` → `permission_mode: z.string()` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC1 create `tool_policy.never.items` enum | flip `.array(z.enum(NEVER_CATEGORIES))` → `.array(z.string())` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC1 create `limits.*` positive integer | flip `const limit = z.number().int().positive()` → `const limit = z.number().int()` in `kernel/src/agents/charter-files.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC2 update `avatar.shape` enum | flip `shape: z.enum(AVATAR_SHAPES)` → `shape: z.string()` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC2 update `avatar.hue` enum | flip `hue: z.enum(AVATAR_HUES)` → `hue: z.string()` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC2 update `permission_mode` enum | flip `permission_mode: z.enum(CHARTER_PERMISSION_MODES as [AllowedPermissionMode, ...AllowedPermissionMode[]]).optional()` → `permission_mode: z.string().optional()` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC2 update `never.items` enum; and the moved `kernel/test/agents-charter-tools.test.ts` update-`never` pin (AC6) | flip `never: z.array(z.enum(NEVER_CATEGORIES))` → `never: z.array(z.string())` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC2 update `limits.*` positive integer | flip `z.number().int().positive().nullable()` → `z.number().nullable()` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC3 playbook `dedupe_key.items` enum | flip `z.array(z.enum(DEDUPE_KEY_FIELDS))` → `z.array(z.string())` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC3 playbook `token_limit` positive integer | flip `token_limit: z.number().int().positive()` → `token_limit: z.number().int()` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC3 playbook `priority` enum | flip `priority: z.enum(PLAYBOOK_PRIORITIES)` → `priority: z.string()` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC3 playbook `trigger.kind` enum | flip `kind: z.enum(TRIGGER_KINDS)` → `kind: z.string()` in `kernel/src/playbooks/drafts.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC3 `kernel_trigger_register` `action` enum | flip `action: z.enum(TRIGGER_ACTIONS)` → `action: z.string()` in `kernel/src/triggers/tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC3 `kernel_trigger_register` `kind` enum | flip `kind: z.enum(TRIGGER_KINDS)` → `kind: z.string()` in `kernel/src/triggers/tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC6 `charter` has `properties` and is not a record (replaces the `toEqual({ type: "object" })` pin) | flip `.meta(CHARTER_JSON_SCHEMA)` → `.meta({ type: "object" })` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` — AC4(a) table keys equal `kernelToolNames(SHIPPED)` (an unclassified tool fails) | flip `name: AGENT_LIST_TOOL_NAME,` → `name: "kernel_agent_list_unclassified",` in `kernel/src/agents/charter-tools.ts` |

For these rows to apply mechanically the code must use exactly these spellings, each once in its file: in `charter-tools.ts` `.meta(CHARTER_JSON_SCHEMA)` (on `kernel_agent_create`'s `charter`) and (in `changesSchema`) `shape: z.enum(AVATAR_SHAPES)`, `hue: z.enum(AVATAR_HUES)`, `permission_mode: z.enum(CHARTER_PERMISSION_MODES as [AllowedPermissionMode, ...AllowedPermissionMode[]]).optional()` (the same cast `charter-files.ts` uses; import the type `AllowedPermissionMode` from where `charter-files.ts` imports it), `never: z.array(z.enum(NEVER_CATEGORIES))` and `const limitChange = z.number().int().positive().nullable().optional();`; in `drafts.ts` `dedupe_key: z.array(z.enum(DEDUPE_KEY_FIELDS))` and `token_limit: z.number().int().positive().optional()`. The `charter-files.ts`, `triggers/tools.ts`, `priority`/`kind` rows in `drafts.ts` and the `name: AGENT_LIST_TOOL_NAME,` row match base-commit code, once each (checked at base). `kernel/src/triggers/tools.ts` is not edited by this job; its rows are mutants applied only in a scratch copy.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Publish the closed value sets in every kernel tool schema, with a walk test | all | 6 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| charter tools | `kernel/src/agents/charter-tools.ts`, `kernel/src/agents/charter-files.ts` | — | HIGH |
| playbook drafts | `kernel/src/playbooks/drafts.ts` | — | HIGH |
| tests | `kernel/test/tools-sdk-list.test.ts` | — | HIGH |
| tests (pins that may move to argument validation) | `kernel/test/agents-charter-tools.test.ts`, `kernel/test/playbooks-drafts.test.ts` | — | MEDIUM |

Survey of all 22 shipped tools (`kernelToolNames(SHIPPED)`) for closed sets the kernel enforces after parse — the `CLOSED_VALUE_SETS` table's content:
- `kernel_agent_create` (`charter.*`): avatar.shape `AVATAR_SHAPES`, avatar.hue `AVATAR_HUES`, permission_mode `CHARTER_PERMISSION_MODES`, tool_policy.never items `NEVER_CATEGORIES`; limits.{tokens_per_day, sessions_at_once, delegation_depth} positive integer.
- `kernel_agent_update` (`changes.*`): the same four sets (never at `changes.never`) and the three limits (nullable).
- `kernel_playbook_create` / `kernel_playbook_update` (`changes.*` for update): dedupe_key items `DEDUPE_KEY_FIELDS`, priority `PLAYBOOK_PRIORITIES` (already an enum), trigger.kind `TRIGGER_KINDS` (already an enum), token_limit positive integer.
- `kernel_trigger_register`: kind `TRIGGER_KINDS`, action `TRIGGER_ACTIONS` (already enums).
- No closed set (empty entry): `kernel_task_create`, `kernel_task_update`, `kernel_task_list`, `kernel_task_get` (task `state`/`kind` are the user's vocabulary — invariant 1), `kernel_schedule_wakeup`, `kernel_request_stop`, `kernel_trigger_remove`, `kernel_trigger_list`, `kernel_notify`, `kernel_approval_request` (`payload` is free JSON), `kernel_loomwright_capabilities`, `kernel_playbook_list`, `kernel_playbook_disable`, `kernel_playbook_dry_run`, `kernel_playbook_enable`, `kernel_agent_list`, `kernel_agent_message` (`workspace` is checked against the target's own settings list — per-member, not a closed set).

### Design (recommended; the worker may deviate only with the reason in the PR)
- `kernel_agent_create`: keep `charter` as the runtime `z.unknown()` + refine, and change its `.meta({ type: "object" })` to `.meta(CHARTER_JSON_SCHEMA)` exported from `charter-files.ts`. The SDK listing then shows the full charter schema with enums, while the runtime parse (and `__proto__` refusal through `validateCharter`) is unchanged. Probed: the SDK passes a `.meta()` JSON Schema through to `tools/list` verbatim.
- `kernel_agent_update` and the playbook draft tools: tighten the zod shape itself (`z.enum(...)`, `.int().positive()`), since these shapes are already plain `z.object`s. A bad value is then refused at argument validation (`<tool>: invalid input: …`) before the domain check — for the held `kernel_agent_update` by `heldToolCheckOf`'s `z.object(t.shape).safeParse(input ?? {})` in `kernel/src/tools/server.ts`, and for the unheld `kernel_playbook_create`/`_update` by the contributed tool handler's `safeParse` in the same file (same prefix), and the domain check stays as defence in depth.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/agents/charter-files.ts", name: "CHARTER_JSON_SCHEMA"}
  - {kind: "symbol", path: "kernel/test/tools-sdk-list.test.ts", name: "CLOSED_VALUE_SETS"}
  - {kind: "file", path: "kernel/src/agents/charter-tools.ts"}
  - {kind: "file", path: "kernel/src/playbooks/drafts.ts"}
requires: []
lanes:
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/src/agents/charter-files.ts"
  - "kernel/src/playbooks/drafts.ts"
  - "kernel/test/tools-sdk-list.test.ts"
  - "kernel/test/agents-charter-tools.test.ts"
  - "kernel/test/playbooks-drafts.test.ts"
external_requires:
  - "@anthropic-ai/claude-agent-sdk 0.3.284 (createSdkMcpServer serialises z.enum and .meta() JSON Schema; probed 2026-10-25)"
```

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/agents/charter-tools.ts:327` | yes | HOLDS | `avatar: z.object({ shape: z.string(), hue: z.string() }).strict().optional(),` (in `kernel_agent_update`'s `changesSchema`; `kernel_agent_create`'s `charter` is the `.meta({ type: "object" })` at its shape) | tip 7 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tightening a zod shape moves a pinned refusal from the domain check (`invalid_input: …`) to argument validation (`invalid input: …`); e.g. `agents-charter-tools.test.ts`'s update `never: ["git_pushh"]` pin. | MEDIUM | AC6: update each moved pin in the same commit, keeping its field-name assertion; run the full suite. Keep `kernel_agent_create`'s runtime parse unchanged (`.meta()` only) so its refusals and the `__proto__` refusal do not move. |
| `z.toJSONSchema(charterSchema)` emits a top-level `$schema` and refine-only rules are dropped (they cannot be expressed). | LOW | Strip `$schema`; refines stay enforced by `validateCharter` (defence in depth). The walk test asserts only enums and integer bounds. |
| A future tool adds a closed set but no table entry. | LOW | AC4(a): the table's keys must equal `kernelToolNames(SHIPPED)`, so a new tool fails the test until classified. |
| Longer schemas cost a few tokens per session. | LOW | Accepted by the requirement: small next to four refused calls. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-25-kernel-tool-schemas-closed-value-sets.md
```

## Plan Review: PASS (attempt 3/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | LOW | File Impact Map (22-tool survey) | The reviewer did not re-read the shapes of `kernel_notify`, `kernel_approval_request`, `kernel_loomwright_capabilities` and `kernel_agent_message`. AC4(a) catches a tool missing from the table, but not a tool wrongly mapped to an empty list. | deferred: before filling `CLOSED_VALUE_SETS`, the worker re-checks those four tools' handlers for any closed set enforced after parse. |
| 2 | LOW | AC1/AC4 integer bounds | `z.toJSONSchema` may emit a `maximum` (`Number.MAX_SAFE_INTEGER`) beside the lower bound. | deferred: the AC4 bound check passes when `exclusiveMinimum >= 0` or `minimum >= 1`, and ignores any `maximum`. |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-25T04:46:28Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/139
- **Branch:** feature/kernel-tool-schemas-closed-value-sets
- **Files changed:** 6
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Kernel tool schemas now publish closed value sets as enums and positive bounds as positive integers (charter via CHARTER_JSON_SCHEMA from charterSchema; update changes, playbook dedupe_key/token_limit). A CLOSED_VALUE_SETS walk test covers all 22 shipped tools. Phase 4.5: iteration 1 PASS + 1 MEDIUM doc-precision finding (agents.md update-refusal text), fixed in 6ee7fab; iteration 2 PASS, nit only. Reviewer applied all 18 pin mutations by hand, all went red. Resumed via --continue after a children_unsettled park: worker-1 was a label for agent aabb4ebaf36bd180d, which had settled; Worker Results record corrected.

## Not verified
- **live Wright session kernel_agent_create first-try success** — needs live subscription session (subtask 1)
