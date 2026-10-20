# Supervisor Job: Every kernel tool's schema serialises through the Agent SDK, CI lists them the SDK's way, and the kernel refuses to start when it can't

## Environment
- **Project:** loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (stale detached worktree `.claude/worktrees/xenodochial-kapitsa-320120`, unrelated, left alone)
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-20-004500-every-kernel-tool-schema-serialises-through-the-sdk-and-the-kernel-checks-it-at-start.md
- **Base commit:** 68e7a64f250f3ef8e483786171d61e77cd55a1c4

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel, vitest. Tools are built by `kernelToolDefinitions` / `createKernelMcpServer` (`kernel/src/tools/server.ts`) with the SDK's `tool()` and `createSdkMcpServer`. |
| 2 | Dependency Availability | CAUTION | A real MCP client needs `@modelcontextprotocol/sdk` (`Client`, `InMemoryTransport`). It is installed (1.31.0, `"peer": true` in `kernel/package-lock.json`) as the Agent SDK's required peer (`"@modelcontextprotocol/sdk": "^1.29.0"`), but is not a declared dependency of the kernel. The start-time check runs in the daemon, so it becomes a runtime import: declare it (Design 4). |
| 3 | Architecture Fit | GO | Probed at base with the installed SDK 0.3.284, zod 4.6.5, MCP SDK 1.31.0: a tool whose shape holds `z.record(z.string(), z.unknown())` makes `client.listTools()` fail with `MCP error -32603: Cannot read properties of undefined (reading 'push')`; the same tool with `z.unknown().refine(<object>).meta({type: "object"})` (the `kernel_approval_request` payload pattern, `kernel/src/approvals/tool.ts:56`) lists as `{"charter":{"type":"object"}}`. `startKernel` already rejects malformed contributions before the store opens (`mergeContributions`, `approvalApplierOf`), and `kernel/src/daemon-exit.ts` already maps `InvalidContributionError` to a permanent start failure. |
| 4 | Scope vs Supervisor Capability | GO | One subsystem (tool server + start), 8 modify, 1 create. One subtask: no split reason applies. |
| 5 | Hard Blockers | GO | None. No migration, no SDK/zod version change. |

**Overall Verdict:** CAUTION (finding 2 is resolved by Design 4; it feeds the Risk Assessment)

## Task
**Goal:** Make `kernel_agent_create`'s `charter` input a shape the Agent SDK serialises, add a CI test that lists every shipped kernel tool through the SDK's own MCP server with a real MCP client, and make `startKernel` run that same listing once before the store opens and refuse the start with an `InvalidContributionError` naming any tool whose schema fails.

**Problem Statement:**
The 2026-10-19 phase 4 live exit failed at step 2: Wright's session was offered no kernel tool (evidence `docs/evidence/phase-4-exit-live-2026-10-19.json`). `kernel_agent_create`'s `charter: z.record(z.string(), z.unknown())` (`kernel/src/agents/charter-tools.ts:298`) throws inside the SDK's bundled zod-to-JSON-Schema walker, and one throwing schema fails the whole `tools/list`, so every session gets zero kernel tools while the server still reports `connected`.
Nothing caught it: kernel-tool tests call handlers directly, exit tests use stand-in sessions, and the kernel's own `z.toJSONSchema` converts the shape fine.
Success looks like: all 22 kernel tools listed through the SDK in CI; a deliberately unserialisable fixture tool fails that listing; and a kernel given such a tool refuses to start, naming it, before the store opens.

## Acceptance Criteria
- [ ] Given the shipped contributions, when `kernel/test/tools-sdk-list.test.ts` lists tools through `createKernelMcpServer(<stub ctx>, mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools)` and a real MCP `Client` over `InMemoryTransport`, then every name in `kernelToolNames(merged.tools)` is listed (22 in all), each with an `inputSchema` whose `type` is `"object"`.
- [ ] Given the old shape reproduced as a fixture tool (`{charter: z.record(z.string(), z.unknown())}`), when it is listed the same way (alone, and beside the shipped tools), then the listing rejects. A test comment records the versions that showed the failure: `@anthropic-ai/claude-agent-sdk` 0.3.284, `zod` 4.6.5, `@modelcontextprotocol/sdk` 1.31.0.
- [ ] Given the fixed `kernel_agent_create`, when every existing test runs (`agents-charter-tools`, `agents-roster`, `agents-foundation`, `phase-4-exit`, `approvals`, `kernel-tools`, `feature-seams` included), then each passes with no edit to its assertions: the same refusals, display, applier and messages.
- [ ] Given a charter carrying an own `__proto__` key (e.g. parsed from `'{"__proto__": {...}, ...}'`), when it reaches `kernel_agent_create`'s `beforeHold`, then it is refused `invalid_input` naming the `"__proto__"` unknown key (the charter is passed to `validateCharter` as given, never rebuilt into a `{}` that drops the key). Test in `kernel/test/agents-charter-tools.test.ts`.
- [ ] Given contributions with one tool whose shape cannot serialise, when `startKernel` runs, then it rejects with `InvalidContributionError` whose message names that tool and includes the listing error's first line, and the store was never opened (an `openStore` dep that records calls is never called). Given two such tools, both are named.
- [ ] Given that same failure under `--launchd`, then `startFailureExit(err, true)` is `{status: 0, line}` with one line naming the tool (not restarted); asserted on the error `startKernel` rejected with.
- [ ] Given the shipped contributions, when `startKernel` runs, then the self-check passes and the start is otherwise unchanged (existing `startKernel` tests pass untouched).
- [ ] The CLI's merge is unchanged: no listing runs on the CLI path (`kernel/src/cli/*` untouched), so `studio stop --all` still runs.
- [ ] `docs/ARCHITECTURE.md` (Phase 2 features / Tools) states the shape rule — every tool's shape must serialise through the SDK; checked in CI and at start — and why (one failing schema empties `tools/list`); `docs/architecture/agents.md` shows `kernel_agent_create`'s input as now declared; `bash scripts/check-docs.sh` passes.
- [ ] `cd kernel && npm ci && npm run typecheck && npm test` passes.

### Design (binding for the worker)

1. **The schema fix** (`kernel/src/agents/charter-tools.ts`, the `createTool` shape only). Replace `charter: z.record(z.string(), z.unknown())` with the `kernel_approval_request` payload pattern: `z.unknown().refine((v) => typeof v === "object" && v !== null && !Array.isArray(v), { message: "charter must be a JSON object" }).meta({ type: "object" })`, with a two-line comment saying why it is not `z.record` (the SDK's bundled serialiser throws on a record and empties `tools/list`; a record also rebuilds the object and drops an own `__proto__` key — `validateCharter` must see the charter as sent, and its strict schema refuses `__proto__` as an unknown key). Do not declare the charter's fields here: `validateCharter` stays the only rule (item 02), so every refusal and message is unchanged. Nothing else in the tool changes (description, `beforeHold`, `applyOnApproval`, handler, held/kernel-applied status). The shape's inferred `charter` type becomes `unknown` while `type CreateArgs = { readonly charter: Record<string, unknown>; … }` stays; if `npm run typecheck` rejects that, widen `CreateArgs.charter` to `unknown` (every reader already treats it as untrusted: `charterIdText`, `validateCharter`) — no other type change. Then grep `kernel/src` for any other `z.record` in a tool shape (base: none — `rg -n "z\.record" kernel/src` hits only line 298 and the comment at `approvals/tool.ts:56`).
2. **The listing helper** (`kernel/src/tools/server.ts`). Export `async function listKernelTools(contributed: readonly ContributedTool[]): Promise<{ name: string; inputSchema: unknown }[]>`: build `createKernelMcpServer(LISTING_CTX, contributed)`, connect `config.instance` to one end of `InMemoryTransport.createLinkedPair()` and a `Client({name: "kernel-self-check", version: kernelVersion()})` to the other, `await client.listTools()`, and close both in a `finally`. **The stub context:** `kernelToolDefinitions` reads `ctx`'s members eagerly at definition time (`const { store, sessions, sessionId } = ctx;` in `kernelToolHandlers` and in `contributedToolContext`), so reading a member must succeed and only USING one may throw. `LISTING_CTX` is a plain object: `sessionId: 0`; `store` a `Proxy` over `{}` whose `get` trap throws `new Error("tool listing only")` for any property; `sessions` `{ stopSession: () => { throw … }, getSession: () => { throw … } }` with the same message; no `now`, no `schedule` (their defaults are lazy closures). Cast it to `KernelToolContext` with a one-line comment saying why. Use the public `instance.connect(transport)` route (probed: `createSdkMcpServer` returns `{type, name, instance}` and `instance.connect` is a function); no private SDK field.
3. **The self-check** (`kernel/src/tools/server.ts` + `kernel/src/kernel.ts`). Export `async function assertKernelToolsList(contributed)`: call `listKernelTools(contributed)`; on a throw, list each contributed tool alone (`listKernelTools([t])`) and collect the names that throw (if none does alone, name all contributed tools and say the combination fails); throw `new InvalidContributionError(<failing names joined ", ">, "tool", "its input schema does not serialise through the Agent SDK, so tools/list would offer sessions no kernel tool: <first line of the error>")`. In `startKernel`, call `await assertKernelToolsList(contributions.tools)` right after `approvalApplierOf(...)` and before `openStore`; update the `startKernel` doc comment's order sentence to include it. A listing that succeeds but omits a name of `kernelToolNames(contributed)` throws the same error naming the missing tools.
4. **The dependency** (`kernel/package.json`, `kernel/package-lock.json`). Add `"@modelcontextprotocol/sdk": "1.31.0"` to `dependencies` (the exact version already in the lock; it is the Agent SDK's required peer, so this declares what is already installed). Update the lock's root `packages[""].dependencies` with `npm install --package-lock-only` and confirm `npm ci` resolves the same `node_modules/@modelcontextprotocol/sdk` 1.31.0 (the `"peer": true` flag on that entry may drop; no other lock entry may change). Import paths: `@modelcontextprotocol/sdk/client/index.js` and `@modelcontextprotocol/sdk/inMemory.js`.
5. **The CI test** (`kernel/test/tools-sdk-list.test.ts`, new). (a) Shipped: `listKernelTools(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools)` returns exactly `kernelToolNames(...)` (order-insensitive equality) — 22 names — each `inputSchema.type === "object"`. (b) Fixture: a `defineTool` with `shape: {charter: z.record(z.string(), z.unknown())}` — `listKernelTools([fixture])` rejects, and `listKernelTools([...shipped, fixture])` rejects. (c) `assertKernelToolsList([...shipped, fixture])` rejects with `InvalidContributionError` naming only the fixture. (d) `startKernel({contributions: [...SHIPPED_CONTRIBUTIONS, <a contribution holding the fixture>] ...}, {openStore: <spy>})` rejects with that error and the spy was never called; `startFailureExit(err, true)` is status 0 and its line contains the fixture's name. (e) Listing the shipped tools with `LISTING_CTX` resolves (proves no handler, store or session member is used while listing). Comment the versions (AC 2). `kernel/test/kernel-daemon.test.ts` is deliberately untouched: `daemon-exit`'s existing tests already cover the path from `startFailureExit`'s line to `kernel.err.log`, so (d) asserts only that this error maps to a permanent exit whose line names the tool.
   - **The `__proto__` case** (`kernel/test/agents-charter-tools.test.ts`): take the file's existing valid charter fixture, `JSON.stringify` it, splice in `"__proto__": {"x": 1}` and `JSON.parse` the result (an own `__proto__` key, every other field valid, so it is the only issue); call `kernel_agent_create`'s `beforeHold` (or the gate path the file already uses) and assert `held_refused` with text containing `invalid_input` and `unknown key "__proto__"`, and no approval row.
6. **Docs.** `docs/ARCHITECTURE.md`: in the Phase 2 features section where contributed tools are described, one short paragraph — the shape rule and why, naming the CI test and the start check. `docs/architecture/agents.md`: in the `kernel_agent_create` row/section, say the `charter` input is declared as a JSON object (not a record) and `validateCharter` is its only rule; an own `__proto__` key is refused as an unknown key. No other doc edits.

## Touched-file invariants

> Grounded at base `68e7a64`. The worker re-checks each entry before hand-back.

- **`kernel/src/agents/charter-tools.ts`** — keep everything except the one `shape:` line of `createTool` (`shape: { charter: z.record(z.string(), z.unknown()), idempotency_key: z.string().min(1).max(200) },`). `idempotency_key` keeps its rule. The `__proto__` care mirrors `kernel/src/approvals/tool.ts:56` (`// Not \`z.record\`: it rebuilds the object in a plain \`{}\`, dropping a \`__proto__\` key`).
- **`kernel/src/tools/server.ts`** — keep: `export function createKernelMcpServer(ctx: KernelToolContext, contributed: readonly ContributedTool[] = []): McpSdkServerConfigWithInstance {` (signature and per-launch freshness); `export const KERNEL_TOOL_NAMES = PHASE1_TOOL_NAMES;`; `approvalApplierOf` unchanged. New exports only. Mirror: `const { store, sessions, sessionId } = ctx;` (read eagerly — Design 2's stub).
- **`kernel/src/kernel.ts`** — keep: `// Before the store opens: a deterministically broken composition has no side effect.` — the new check goes in that same pre-store block; the teardown and everything after `openStore` unchanged.
- **`kernel/src/daemon-exit.ts`** — no change expected: `if (err instanceof InvalidContributionError) return "a feature contribution is malformed";` already makes it permanent.
- **`kernel/test/feature-seams.test.ts`** (not modified) — rule: nothing reachable from `features/index.js` (which the CLI imports) may load the Agent SDK; anchors `const registry = load("features/index.js");` and `SDK_IN_GRAPH @anthropic-ai/claude-agent-sdk`. Its guard matches only the Agent SDK, so it would not catch `@modelcontextprotocol/sdk`: keep both new helpers and the MCP client import in `tools/server.ts` (daemon side; `load("tools/server.js")` is already the guard's refused control), never in `features/` or `agents/`.
- **`kernel/test/agents-charter-tools.test.ts`** — every existing test and assertion stays byte-identical (e.g. `kernel_agent_update: invalid_input: the result would not be a valid charter`); only the `__proto__` case is added.
- **`kernel/package.json`** — keep `"@anthropic-ai/claude-agent-sdk": "0.3.284"` and `"zod": "^4.6.5"`; only `dependencies` gains `"@modelcontextprotocol/sdk": "1.31.0"`.
- **`kernel/package-lock.json`** — only `packages[""].dependencies` gains the new entry, and `"peer": true` may drop from `node_modules/@modelcontextprotocol/sdk`; its `"version": "1.31.0"` and `"integrity"` stay, and no other entry changes (`git diff --stat` shows a few lines).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/tools-sdk-list.test.ts` (a) — every shipped tool listed | put the charter shape back to `z.record(z.string(), z.unknown())` in `kernel/src/agents/charter-tools.ts` |
| `kernel/test/tools-sdk-list.test.ts` (b) — the record fixture's listing rejects | catch and swallow the `listTools` error in `listKernelTools` (return `[]`) |
| `kernel/test/tools-sdk-list.test.ts` (c) — only the fixture is named | delete the per-tool isolation (`listKernelTools([t])`) in `assertKernelToolsList` and name every contributed tool |
| `kernel/test/tools-sdk-list.test.ts` (d) — start refused before the store opens | delete `await assertKernelToolsList(contributions.tools);` in `kernel/src/kernel.ts` (or move it after `openStore`) |
| `kernel/test/tools-sdk-list.test.ts` (e) — listing with the stub ctx resolves | make `LISTING_CTX.sessionId` a throwing getter |
| `kernel/test/agents-charter-tools.test.ts` — own `__proto__` key refused `invalid_input` | flip the charter shape back to `z.record(...)` (it drops the key, so the charter is accepted and held) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Charter shape fix, SDK-way listing test, start-time self-check, dependency and docs | all | 8 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/tools/server.ts", name: "listKernelTools"}
  - {kind: "symbol", path: "kernel/src/tools/server.ts", name: "assertKernelToolsList"}
  - {kind: "file", path: "kernel/test/tools-sdk-list.test.ts"}
requires: []
lanes:
  - "kernel/src/agents/charter-tools.ts"
  - "kernel/src/tools/server.ts"
  - "kernel/src/kernel.ts"
  - "kernel/package.json"
  - "kernel/package-lock.json"
  - "kernel/test/tools-sdk-list.test.ts"
  - "kernel/test/agents-charter-tools.test.ts"
  - "docs/ARCHITECTURE.md"
  - "docs/architecture/agents.md"
external_requires: []
```

## File Impact Map

| File | Action | Confidence |
|------|--------|-----------|
| kernel/src/agents/charter-tools.ts | modify (one shape line + comment) | HIGH |
| kernel/src/tools/server.ts | modify (`listKernelTools`, `assertKernelToolsList`) | HIGH |
| kernel/src/kernel.ts | modify (call the check before the store; doc comment) | HIGH |
| kernel/package.json | modify (declare `@modelcontextprotocol/sdk` 1.31.0) | HIGH |
| kernel/package-lock.json | modify (root dependency entry only) | HIGH |
| kernel/test/tools-sdk-list.test.ts | create | HIGH |
| kernel/test/agents-charter-tools.test.ts | modify (add the `__proto__` case only) | HIGH |
| docs/ARCHITECTURE.md | modify (one paragraph) | HIGH |
| docs/architecture/agents.md | modify (the create input sentence) | HIGH |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans relative links in `docs/`. `kernel/test/agents-roster.test.ts` pins the example blocks of `docs/architecture/agents.md` (`<!-- charter-example:start -->` etc.) — do not touch them.

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
| Feasibility (Phase 2.5): `@modelcontextprotocol/sdk` becomes a declared runtime dependency | MEDIUM | Pinned to the exact version already installed as the Agent SDK's required peer; only the lock's root entry changes; `npm ci` verified. |
| The SDK's bundled serialiser is not documented API; a later SDK may serialise differently | MEDIUM | That is what the CI test and the start check catch; versions recorded in the test comment. |
| The start check adds latency to every start | LOW | One in-memory listing of 22 tools, no network; measured in the worker's report. |
| A per-tool fallback could fail to isolate a combination-only failure | LOW | Design 3 names all contributed tools and says the combination fails. |
| Passing the charter through unrebuilt changes behaviour for an own `__proto__` key | LOW | Intended: refused `invalid_input` as an unknown key (validateCharter's strict schema) instead of silently dropped; AC 4 pins it. Every other input behaves as before. |

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
/supervisor job: .supervisor/jobs/pending/2026-10-20-kernel-tools-list-sdk-schema-check.md
```

## Plan Review
- **Decision:** PASS (attempt 2/3; attempt 1 PASS with 3 MEDIUM fixed — the stub ctx shape (ctx is destructured eagerly), the missing Pin mutations, and missing touched-file invariants for the test and package files — plus 4 LOW fixed)
- **Owner:** Save and exit

## Outcome
- **Status:** completed
- **Completed:** 2026-10-20T02:44:20Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/95
- **Branch:** feature/kernel-tools-list-sdk-schema-check
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** kernel_agent_create's charter now uses the approval-payload object pattern (lists as {type: object}; validateCharter unchanged; an own __proto__ key is refused). tools/server.ts gains LISTING_CTX, listKernelTools (real MCP Client over InMemoryTransport) and assertKernelToolsList (per-tool isolation, phase-1 probe, omission check); startKernel runs it before openStore. @modelcontextprotocol/sdk 1.31.0 declared. Heal: it1 PASS+2 MEDIUM (ARCHITECTURE.md parity claim; untested combination/omission branches) fixed 4a79542; it2 PASS+1 MEDIUM (phase-1 failure blamed on contributed tools) fixed ce5e2ae; it3 PASS, 1 LOW nit. typecheck clean, vitest 1678 passed / 9 skipped, check-docs OK, PR CI green. risk_classification: high_risk true (agents/ path; 531 changed lines).

## Not verified
- **assertKernelToolsList combination-only and listing-omits-a-name branches against the real SDK** — covered by stub-lister tests only; no natural fixture triggers them (subtask 1)
- **A live Wright session's tools/list through the real claude CLI** — needs the owner's phase 4 live rerun (STUDIO_LIVE=1) (subtask 1)
