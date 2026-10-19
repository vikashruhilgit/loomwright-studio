# 10 — Every kernel tool's schema serialises through the Agent SDK, CI lists them the SDK's way, and the kernel refuses to start when it can't

## Status: ready

**Priority:** MVP · blocks the phase 4 live exit (evidence `docs/evidence/phase-4-exit-live-2026-10-19.json`) · invariants 2, 3 · D5

**As** the owner,
**I want** every kernel tool to reach every session, and a broken tool schema caught in CI and refused at kernel start,
**so that** one tool can never silently strip a session of all its kernel tools again.

## Problem

The 2026-10-19 live exit run failed at step 2. Wright's session was offered no kernel tool at all: its reply said its task, trigger, notify and approval tools were unavailable, and the store holds no `tool_decision` for that session. A probe of three sessions isolated the cause; the record is in the evidence file.

- With all 16 contributed tools, a session's `system/init` listed 0 kernel tools, while the `kernel` MCP server still reported `connected`. That held on Loomwright 17.10.0 and on 17.6.1.
- Without the `agents` contribution, the same session listed all 18 kernel tools.
- Calling the server's own `tools/list` handler with no model shows that `kernel_agent_create` alone makes it throw `TypeError: Cannot read properties of undefined (reading 'push')`.

**The mechanism.** The tool's shape is `charter: z.record(z.string(), z.unknown())` (`kernel/src/agents/charter-tools.ts:298`), the only `z.record` among shipped tools. Agent SDK 0.3.284 builds each tool's JSON Schema with a zod walker bundled in `sdk.mjs`, which hands a record to the kernel's zod 4.6.5 `recordProcessor` (`zod/v4/core/json-schema-processors.js:640`), and that throws. One throwing schema fails the whole `tools/list`, so the session gets none of the kernel's tools. Every Wright session since item 07 (#91) merged is affected, not only crew creation.

**Why nothing caught it.**
- No test lists tools through the SDK's `createSdkMcpServer`: the kernel-tool tests call handlers directly, and the exit tests use stand-in sessions.
- The kernel's own `z.toJSONSchema` converts every shape without error, because there both sides are the same zod.
- At run time the failure is silent: the server is `connected` and simply offers nothing.

## Owner decisions (2026-10-20, binding)

- The fix has three parts, all in this item: the schema fix, a CI test that lists every shipped tool the SDK's way, and a start-time self-check.
- Phase 4's owner decisions are unchanged ([the plan doc](_BACKLOG-2026-10-18-041110-phase-4-agent-roster.md)). The fix changes how the charter is declared, not what a charter is.

## Scope

1. **The schema fix** (`kernel/src/agents/charter-tools.ts`).
   - `kernel_agent_create`'s `charter` input becomes a shape the SDK serialises: item 02's charter fields declared as a `z.object`, or another non-record form. A record nested anywhere in the shape counts too.
   - Validation stays item 02's `validateCharter`, exactly as today, so a charter is accepted or refused for the same reasons with the same messages. The `beforeHold` display and the applier are unchanged.
   - Keep the `__proto__` care that `kernel/src/approvals/tool.ts:56` documents: an own `__proto__` key must not be silently dropped where it matters.
   - Nothing else about the tool changes: still always held, still kernel-applied.
2. **A CI test that lists tools the SDK's way** (`kernel/test/tools-sdk-list.test.ts`).
   - It builds the kernel MCP server exactly as `kernel/src/kernel.ts` does (`createKernelMcpServer` over the tools merged from `SHIPPED_CONTRIBUTIONS`) and asks it for `tools/list` through the SDK's own server. Prefer a real MCP client over `@modelcontextprotocol/sdk`'s in-memory transport (installed as the SDK's peer). If the only route is a private field of the server, use it, and pin why.
   - It asserts that every shipped tool name is listed, each with an object `inputSchema`.
   - A second case feeds one deliberately unserialisable tool (a `z.record` shape) and asserts the listing fails. This proves the test can see the failure it guards against. Today's `charter` shape must fail it before the fix.
3. **The start-time self-check** (`kernel/src/tools/server.ts`, `kernel/src/kernel.ts`).
   - `startKernel` runs that same `tools/list` once over the merged contributed tools, after the contributions merge and before the store opens.
   - A throw refuses the start with an `InvalidContributionError` naming the tool or tools whose schema fails. It finds them by listing each tool alone when the whole list fails, and includes the error's first line.
   - Under launchd that is a permanent start failure (`kernel/src/daemon-exit.ts` already maps it), so a kernel that would offer sessions no tools never comes up silently.
   - `kernel.err.log` names the tool.
   - The CLI's own merge is unchanged: a phase 1 command such as `studio stop --all` still runs.
4. **Docs.**
   - `docs/ARCHITECTURE.md` "Phase 2 features" / Tools: the shape rule (every tool's shape must serialise through the SDK; checked in CI and at start) and why (one failing schema empties `tools/list`).
   - `docs/architecture/agents.md`: `kernel_agent_create`'s input as now declared.

## Non-goals

- Changing the SDK or zod versions. Pinning or upgrading either is its own change. Record in the test's comment which versions showed the failure.
- The live rerun. After this merges, the owner reruns the phase 4 live exit from `docs/evidence/phase-4-exit-runbook.md`; that rerun is not a queue item.
- Any other phase 4 behaviour.

## Acceptance criteria

- [ ] Given the shipped contributions, when the SDK-way `tools/list` test runs, then every shipped tool (22 kernel tools in all) is listed with an object input schema.
- [ ] Given the old `charter: z.record(...)` shape (reproduced in the test as a fixture tool), when it is listed, then the listing fails. That shows the test detects the defect.
- [ ] Given the fixed `kernel_agent_create`, when every existing charter-tools, roster and phase 4 exit test runs, then each passes unchanged: the same refusals, display, applier and messages.
- [ ] Given a contribution whose tool shape cannot serialise, when `startKernel` runs, then it rejects with `InvalidContributionError` naming that tool before the store opens. Under `--launchd`, the daemon exits 0 with one `kernel.err.log` line naming it, and is not restarted.
- [ ] Given the shipped contributions, when `startKernel` runs, then the self-check passes and the start is otherwise unchanged.
- [ ] `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Listing tools needs no store and no session, so the start-time check can run on a server built with a stub context, before the store opens.

## Risks

- The SDK's bundled serialiser is not part of its documented API. A later SDK may serialise differently, which is exactly what the CI test and the start check are there to catch.

## Depends on
none

## Touches
kernel/src/agents/charter-tools.ts
kernel/test/agents-charter-tools.test.ts
kernel/test/tools-sdk-list.test.ts
kernel/src/tools/server.ts
kernel/src/kernel.ts
kernel/test/kernel-daemon.test.ts
docs/ARCHITECTURE.md
docs/architecture/agents.md
