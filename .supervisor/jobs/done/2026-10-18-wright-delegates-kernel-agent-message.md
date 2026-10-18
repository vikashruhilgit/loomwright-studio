# Supervisor Job: Wright delegates to a crew member with `kernel_agent_message`, within a chain depth the owner sets

## Environment
- **Project:** loomwright-studio (lane clone L4 of run automate-2026-10-18-135554)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (sibling lane item 04 also needs Wright's `limits` and may edit the same refusal in `kernel/src/agents/settings.ts`; see Risks)
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-18-041106-wright-delegates-to-a-crew-member-within-a-chain-depth.md
- **Base commit:** 0fbe903

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest. Item 01 reserved the empty part `kernel/src/agents/delegate.ts` (`delegatePart`), merged by `AGENT_PARTS` in `kernel/src/agents/index.ts`. |
| 2 | Dependency Availability | GO | No new dependency. `enqueueEvent` (`kernel/src/loop/queue.ts`), `runStep` (`kernel/src/loop/steps.ts`), `recordNotification` (`kernel/src/notifications/record.ts`), `isRoutable` / `getAgent` (`kernel/src/agents/registry.ts`), `readAgentSettings` (`kernel/src/agents/settings.ts`) and migration 14's `brain_messages.depth` column exist. `ctx.store.dataDir` reaches the data dir (as `kernel/src/playbooks/dry-run.ts` uses it). |
| 3 | Architecture Fit | CAUTION | `readAgentSettings` refuses ANY `limits` key in `wright.json` ("not supported for Wright yet"), so AC 2 (Wright's `limits.delegation_depth: 1`) cannot pass without a narrow change there. Owner decision (2026-10-18, this lane): lift the refusal for `limits.delegation_depth` only. |
| 4 | Scope vs Supervisor Capability | GO | 6 files. One subtask; none of the three split reasons applies. |
| 5 | Hard Blockers | GO | None. No migration (migration 14 already added `depth`, `from_agent`, `workspace`). |

**Overall Verdict:** CAUTION (finding 3 is resolved by Design 4; it feeds the Risk Assessment)

## Task
**Goal:** Fill `kernel/src/agents/delegate.ts` with the tool `kernel_agent_message(agent, text, workspace?, idempotency_key)`. It queues one `message` event for a crew member (or Wright) carrying `{agent, text, from_agent, depth, workspace?}`, records `agent_message_queued`, and returns at once without waiting for a reply. It refuses (error result, nothing queued, one `agent_message_refused` event) on `no_agent`, `no_such_agent`, `agent_off`, `self_delegation`, `workspace_not_listed` and `delegation_depth`; a depth refusal sends exactly one notify per refused chain. Document it in `docs/architecture/delegation.md`.

**Problem Statement:**
Wright has no way to hand work to a crew member. Delegation must be a kernel mechanism, never a session Wright owns (invariant 2), and a delegation loop must be bounded by a chain depth the owner sets (D24 limit, unset = no limit; invariant 1). Item 01 reserved the part and the tool name (already in Wright's proposed tools, `kernel/src/brain/settings.ts`, and classified ordinary by `kernel/src/sessions/policy.ts`). Item 05 handles the queued message on the receiving side.

## Acceptance Criteria
- [ ] Given a Wright session handling the owner's message (depth 0), when it calls `kernel_agent_message({agent: "mason", text: "review x", idempotency_key: "k1"})`, then one `message` event with payload `{agent: "mason", text, from_agent: "wright", depth: 1}` is queued and one `agent_message_queued` event recorded. Calling again with `k1` returns the same result and queues nothing.
- [ ] Given Wright's `limits.delegation_depth: 1` and a Wright session handling a reply of depth 1, when it delegates, then it is refused `delegation_depth`, nothing is queued, and exactly one `notify` is sent (a second refused attempt in that session sends none). Given no `delegation_depth`, then the delegation is queued at depth 2.
- [ ] Given `mason` is `off`, unknown, or the caller itself, then the call returns `agent_off`, `no_such_agent` or `self_delegation` and queues nothing.
- [ ] Given `workspace: "/repos/x"` not in `mason`'s `workspaces`, then the call returns `workspace_not_listed` and queues nothing.
- [ ] Given text holding a NUL, then the call fails argument validation.
- [ ] Given `wright.json` with `limits: {delegation_depth: 1}`, then `readAgentSettings(dataDir, "wright")` is `ok` with that limit; a `wright.json` with `limits.tokens_per_day` or `limits.sessions_at_once` is still `settings_invalid` (the existing pin in `kernel/test/agents-foundation.test.ts` stays green unchanged).
- [ ] `docs/architecture/delegation.md` documents the tool, the depth rule with a worked chain, the events and the honest limits, and `bash scripts/check-docs.sh` passes.
- [ ] Tests in `kernel/test/agents-delegation.test.ts` (store-level, no model, no live session).

### Design (binding for the worker)

1. **Tool shape** (`defineTool`, `kernel/src/features/contribution.ts`): `agent` = `z.string().min(1).max(64)`; `text` = `z.string().min(1).max(8000).refine(noNul, …)` exactly like `kernel_notify` (`kernel/src/notifications/tool.ts`: `const noNul = (text: string): boolean => !text.includes("\u0000");`); `workspace` optional string; `idempotency_key` = `z.string().min(1).max(200)`. Description tells the model the reply arrives later as a new message and to end its turn. Add it to `delegatePart.tools`; `routes`, `verbs`, `handlers` stay empty.
2. **Caller and depth.** Caller agent = `ctx.sessions.getSession(ctx.sessionId)?.agent`; null/empty ⇒ `no_agent`. Caller depth = `depth` of the `brain_messages` row whose `session_id = ctx.sessionId` (most recent by id; read with its own `SELECT depth, id FROM brain_messages WHERE session_id = ? ORDER BY id DESC LIMIT 1` — do NOT edit `kernel/src/brain/messages.ts`, item 05 owns it). No row (a playbook fire or dry run) ⇒ 0. New depth = caller depth + 1.
3. **Checks, in order:** `no_agent`; `self_delegation` (target == caller); `no_such_agent` (target is neither `wright` nor a registered row: `getAgent`); `agent_off` (registered but not `isRoutable`); `workspace_not_listed` (when `workspace` given: it must be an exact member of the TARGET's `readAgentSettings(...).settings.workspaces`; unreadable settings or none listed ⇒ refused); `delegation_depth` (CALLER's `readAgentSettings(ctx.store.dataDir, caller).settings.limits?.delegation_depth` is set and new depth exceeds it; unreadable caller settings ⇒ unset, never a guess — record which in `delegation.md`).
4. **Wright's `delegation_depth` (owner decision, narrow lift)** in `kernel/src/agents/settings.ts`: in the `if (isWright)` refusal loop, `limits` stays refused unless its ONLY key is `delegation_depth`. `never`, `workspaces`, `limits.tokens_per_day`, `limits.sessions_at_once` stay refused with the exact existing message. Update the header comment to say so. Touch no other line.
5. **Refusal** = one `agent_message_refused` audit event (`appendEvent`, `kernel/src/loop/internal.ts`; payload `{from, to, depth, reason}`; linked to `ctx.sessionId`) committed in its own transaction, then throw a typed `DelegationRefused` error (`code` = the reason) — the tool server turns it into an `isError` result naming the code (same pattern as `EnableRefused` in `kernel/src/playbooks/enable.ts`). For `delegation_depth`, before throwing, run one `runStep` keyed `kernel_agent_message:depth-notify:message-<row id>` (or `…:session-<sessionId>` with no row) that calls `recordNotification` with source `kernel:delegation_depth`, a title, and a body naming the caller, the target and the limit — so repeated refused attempts in one chain notify once.
6. **Success** = `runStep(ctx.store, ctx.stepKey(idempotency_key), …)`: one `enqueueEvent({kind: "message", payload: {agent, text, from_agent, depth, ...(workspace ? {workspace} : {})}, sessionId: ctx.sessionId})` and one `agent_message_queued` event `{from, to, depth, queue_id}` in the step; returns `{queue_id, agent, depth, note}` (`message_id` omitted: no `brain_messages` row is written here — item 05 writes it on the receiving side). `text` is stored as given (untrusted data); the receiving side (item 05) wraps it as data from `agent:<sender>`.
7. **Headers:** update the `delegate.ts` header (no longer "empty until …") and the `kernel/src/agents/index.ts` header sentence "today all three are empty" so it says the delegate part has `kernel_agent_message` (touch only that sentence).
8. **Refusal text:** the `DelegationRefused` message starts with the reason code (`delegation_depth: …`), since the tool server's isError text is the message only (`kernel/src/tools/server.ts` `guarded`); the class carries `reason` (the `EnableRefused` field name).
9. **Existing pins in `kernel/test/agents-foundation.test.ts`:** adding the tool makes three pins fail for certain: `Object.keys(agentsContribution)` equals `["name", "subcommands"]` (now also `tools`), `merged.tools` equals `[]`, and the "three frozen, empty parts" loop. Change them to assert per part: the delegate part has exactly the tool `kernel_agent_message`, and roster and charter-tools are each asserted on their own (still empty here). Leave the Wright-limits refusal pin (`["limits", { tokens_per_day: 5 }]`) unchanged.
10. **Not held:** do not add the tool to `ALWAYS_HELD_TOOLS` or any fixed set; `kernel/test/sessions-policy.test.ts` already pins it ordinary.

## Touched-file invariants

> Grounded at base `0fbe903`. The worker re-checks each entry before hand-back.

- **`kernel/test/agents-foundation.test.ts`**
  - Only the pins in the test "is the seventh shipped contribution, after playbooks…" (`Object.keys(agentsContribution)`, `merged.tools`) and the test "is built from three frozen, empty parts…" change (Design 9). The Wright refusal loop (`["limits", { tokens_per_day: 5 }]`) and every other test stay byte-identical.
- **`kernel/src/agents/index.ts`**
  - Only the header comment sentence changes (`today all three are empty`); `AGENT_PARTS`, `mergeAgentParts` and the exports stay byte-identical.
- **`kernel/src/agents/delegate.ts`**
  - Keep the part's name and shape: `name: "delegate"`, frozen arrays/objects (`Object.freeze`). Only this file defines the delegate part (`./index.ts` merges every part in `AGENT_PARTS`).
  - The module is loaded by the `studio` CLI through `./index.ts`: import only types, zod, `node:*`, the feature seam and leaf modules — never the Agent SDK, the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the registry's module graph). `../loop/steps.js`, `../loop/queue.js`, `../loop/internal.js`, `../notifications/record.js` are SDK-free modules already loaded by CLI-loaded features (`kernel/src/notifications/tool.ts`, `kernel/src/notifications/record.ts`, `kernel/src/brain/routes.ts`, `kernel/src/triggers/store.ts`).
- **`kernel/src/agents/settings.ts`**
  - Keep `// Fail closed: nothing applies Wright's never, limits or workspaces yet, so` semantics for everything except `limits.delegation_depth`, and the exact message `not supported for Wright yet (the kernel does not apply it to Wright's sessions); remove it` — pinned by `kernel/test/agents-foundation.test.ts` (the loop over `["limits", { tokens_per_day: 5 }]`).
  - `readAgentSettings` stays the ONE reader (`` `readAgentSettings` is the ONE reader: ``); no second parser of `wright.json`.

## Closed enumerations touched

> `grep -rn "notification_created" kernel/src kernel/test docs` — hits `kernel/src/notifications/{record,tool,routes}.ts`, `kernel/test/{notifications,triggers,approvals}.test.ts`, `docs/architecture/{triggers,notifications}.md` and two `docs/evidence/` JSON files, each asserting or describing that one kind — none is a list of all kinds: audit `events.kind` is an open TEXT (`appendEvent(store, kind: string, …)`, `kernel/src/loop/internal.ts`), no closed list.

| Value(s) | Closed list? | Action |
|---|---|---|
| events `agent_message_queued`, `agent_message_refused` | not closed (`events.kind` is free text) | none |
| notification source `kernel:delegation_depth` | pattern, not a list: `kernel:[^\u0000-\u001f\u007f]+` in `kernel/src/notifications/record.ts` (`SOURCE`) | none (matches) |
| refusal reasons `no_agent`, `no_such_agent`, `agent_off`, `self_delegation`, `workspace_not_listed`, `delegation_depth` | new; declared once as a frozen `DELEGATION_REFUSALS` list in `delegate.ts` | create (the only list) |
| `queue` event kind `message` | closed (`EVENT_KINDS`, `isEventKind`) | already contains `message`; none |

## Pin mutations

| Pin (in `kernel/test/agents-delegation.test.ts` unless named) | Mutation that must turn it red |
|---|---|
| self-delegation refused, nothing queued | delete the `self_delegation` check |
| depth 2 queued when no limit is set | new depth = caller depth (drop the `+ 1`) |
| Wright `limits.delegation_depth: 1`, depth-0 caller: queued at depth 1 (boundary) | compare with `>=` instead of `>` |
| delegation past the limit refused with exactly one notify; a second refusal sends none | drop the depth-notify `runStep` key (record directly) |
| repeat with `k1` queues nothing | call `enqueueEvent` outside `runStep` |
| `workspace_not_listed` | drop the workspace check |
| `workspace` listed in mason's `workspaces`: queued with `workspace` in the payload | check the caller's (Wright's, never set) workspaces instead of the target's |
| `agent_off` vs `no_such_agent` | check `isRoutable` before `getAgent` (off reads as unknown) |
| Wright `limits: {delegation_depth: 1}` accepted | revert the settings.ts lift |
| `agents-foundation.test.ts` tokens_per_day refusal (unchanged) | widen the lift to every `limits` key |
| `agents-foundation.test.ts` delegate part has exactly `kernel_agent_message` | remove the tool from `delegatePart.tools` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | `kernel_agent_message`, Wright's delegation_depth, tests and docs | all | 5 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — kernel_agent_message, Wright's delegation_depth, tests and docs (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/agents/delegate.ts", name: "delegatePart"}
  - {kind: "symbol", path: "kernel/src/agents/delegate.ts", name: "DelegationRefused"}
  - {kind: "file", path: "kernel/test/agents-delegation.test.ts"}
  - {kind: "file", path: "docs/architecture/delegation.md"}
requires: []
lanes:
  - "kernel/src/agents/delegate.ts"
  - "kernel/src/agents/settings.ts"
  - "kernel/test/agents-delegation.test.ts"
  - "kernel/test/agents-foundation.test.ts"
  - "kernel/src/agents/index.ts"
  - "docs/architecture/delegation.md"
external_requires: []
```

## File Impact Map

| File | Action | Confidence |
|------|--------|-----------|
| kernel/src/agents/delegate.ts | modify (fill the empty part) | HIGH |
| kernel/src/agents/settings.ts | modify (accept Wright's `limits.delegation_depth` only) | HIGH |
| kernel/test/agents-delegation.test.ts | create | HIGH |
| docs/architecture/delegation.md | modify (replace the stub) | HIGH |
| kernel/test/agents-foundation.test.ts | modify (empty-part pins, Design 9) | HIGH |
| kernel/src/agents/index.ts | modify (header sentence only, Design 7) | HIGH |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every relative link in `docs/`; any link added to `delegation.md` must resolve.

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
| Feasibility (Phase 2.5): Wright's `limits` refused by the settings reader | MEDIUM | Design 4: the narrow lift the owner chose; every other refused field keeps its exact message and pin. |
| Textual conflict with sibling item 04 (token / sessions-at-once limits), which also needs Wright's `limits` and may edit the same `if (isWright)` loop in `settings.ts` | MEDIUM | Keep the edit to the few lines of that loop and the header comment. `wave-build` stops on a non-marker conflict and the owner resolves it on the lane PR. |
| Lane PRs for items 02, 06 and 07 conflict on the shared empty-parts pins in `agents-foundation.test.ts` (and the `index.ts` header sentence) | MEDIUM | Design 9: assert per part, touch only the delegate assertions plus the shared keys/merged-tools lines; the owner resolves any remaining conflict on the lane PR at wave build. |
| Refusal events lost by a rolled-back step | MEDIUM | Design 5 commits the refusal event (and the one notify step) before the throw, outside the success step; a test asserts the event row after a refused call. |
| A refused call repeated with the same idempotency key is re-evaluated, not replayed | LOW | Documented in `delegation.md`; only a success is a cached step (AC 1). |
| A delegation queued for a crew member before item 05 lands is handled by today's brain handler (routes only `wright`) | LOW | Non-goal per the requirement; the tests assert the queued payload only. Named in `delegation.md` honest limits. |

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
/supervisor job: .supervisor/jobs/pending/2026-10-18-wright-delegates-kernel-agent-message.md
```

## Plan Review
- **Decision:** PASS (attempt 3/3; attempt 1 PASS with 4 MEDIUM fixed; attempt 2 PASS with 3 MEDIUM fixed)
- **Deferred (LOW):** the two AC3 test titles in `kernel/test/agents-foundation.test.ts` (lines 125, 141) may be updated to match their changed pins; the line-462 Wright-refusal test stays byte-identical (mention the narrow lift in `delegation.md`). The "tests are store-level" acceptance line is a constraint, not a Given/When/Then.
- **Owner:** Save and exit

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-18T10:22:47Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/85
- **Branch:** feature/phase4-06-agent-message-delegation
- **Files changed:** 8
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** kernel_agent_message filled into the delegate part (six ordered refusals recorded before an error result; depth from the session's newest brain_messages row; one kernel:delegation_depth notify per refused chain; success as one keyed work step) and Wright's settings accept a limits holding only delegation_depth (owner decision). All three holistic reviews PASSed with every acceptance criterion addressed and all 11 pin mutations held; each MEDIUM doc/restated-list drift finding was fixed (424884d, 684ec54, 89608c8). The last fix (ARCHITECTURE.md:168 clause) landed on the final heal iteration and was not re-reviewed in Phase 4.5 — the owned drain reviews it. risk_classification: high_risk true (agents/ paths, size 769 lines).

## Not verified
- **Receiving side of a queued delegation (crew session, reply back)** — item 05 is not on this branch; only the queued payload is asserted (subtask 1)
- **kernel_agent_message called by a live model through the SDK MCP server** — store-level tests through contributedToolHandler only, no live session (subtask 1)
