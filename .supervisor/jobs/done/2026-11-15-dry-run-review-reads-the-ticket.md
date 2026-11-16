# Supervisor Job: A dry-run review reads the ticket it reviews (phase 8 item 22f)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 2 (orphaned worktree `~/studio-work/v2-18d` with salvage content, advisory only; the source requirement lives under the gitignored `.supervisor/` tree, so git cannot vouch for its provenance)
- **Source requirement:** .supervisor/requirements/phase-8-22/2026-11-15-170000-f-a-dry-run-review-reads-the-ticket-it-reviews.md
- **Base commit:** 443d980128c7b6e749fe952fb731d340eb56d902

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest. No new dependency is needed. |
| 2 | Dependency Availability | GO | Every function the change uses exists: `toolsForConnectors`, `mcpProxyTools`, `mcpToolGrantsFor`, `decideToolUse` and `classifyDryRunCall`. |
| 3 | Architecture Fit | GO | The change adds a fail-closed manager option of the same shape as `connectorsFor` and `githubWriteFor`, and a second frozen read rule beside `DRY_RUN_GITHUB_READ_TOOLS`. |
| 4 | Scope vs Supervisor Capability | GO | One worker: 9 modify, 0 create, about 250 changed lines. |
| 5 | Hard Blockers | GO | None. Every test runs against the existing fake MCP server, and no live tracker is called. |

**Overall Verdict:** GO

## Task
**Goal:** When the owner has granted a crew member a tracker's MCP proxy tools, those tools become that member's session permission, in memory only. A dry-run review can then read the ticket, and dry runs, real runs and chat sessions all agree on a read proxy.

**Problem Statement:**
The owner needs the ClickUp/Jira poll playbook's dry-run review to read the ticket it reviews, because the exit runbook's walk step 1 checks that dry run before each ticket playbook is enabled.
Currently two gates refuse the call. Gate 1: the member's settings policy, through `decideToolUse`, allows only names in `allowedTools`, and nothing an owner does writes a proxy name there, so the call is `tool_not_allowed` in every session. Gate 2: the dry-run rail, `isDryRunReadOnly`, admits no `kernel_mcp_r_` name, so even with gate 1 open the call is `would_do` / `dry_run`. As a result, 22a's runs 189, 193 and 195 reviewed from the title and status only.
Success looks like this: a granted member's dry-run review calls `mcp__kernel__kernel_mcp_r_clickup_<tool>`, the call is allowed and reaches the server, and no would-do entry is recorded. A write proxy is still drafted, held or would-do, exactly as the rail says.

**Design (owner decision 2026-11-15, option A):**
- **types.ts.** Add a new `SessionManagerOptions` field `mcpProxyToolsFor?: (agent: string, connectors: readonly ConnectorKind[]) => readonly string[]`. It returns the session-facing names (`mcp__kernel__kernel_mcp_<r|w>_<kind>_<tool>`) of the proxy tools that agent's session lists. Its doc comment follows `connectorsFor`: asked at each start and resume, a throw grants none, absent means no names.
- **manager.ts.** `#sessionPolicy` appends those names to `allowedTools` (deduplicated, frozen). A new private helper, `#grantedProxyTools(agent, connectors)`, does the work and fails closed: it returns `[]` when there is no option, no agent, a throw, or a non-array answer. It also keeps only strings that start with `mcp__kernel__kernel_mcp_`, so the option can never add a non-proxy name. The caller's `policy` object is never mutated. The names live only on `live.policy`, never in the settings file, the charter or a stored row.
- **kernel.ts.** First move today's local `proxyToolsOf` (inside `startKernel`) to module scope, as a top-level function that takes the store and the grants, with the same try/catch that returns `[]`. The `mcpServers:` factory and the new code then share one proxy-list path. Then wire the option with an exported `mcpProxyToolsFor(dataDir, store)` factory. It answers `[]` for Wright (`agent === WRIGHT_ID`, AC10) and otherwise uses the same building blocks the `mcpServers` factory uses: `mcpGrantsOf(agent)`, then `proxyToolsOf(store, grants)`, then `toolsForConnectors(proxies, connectors, false, grants)`, then map each kept tool to `mcp__kernel__<name>`. By construction, "exactly the listed proxy tools" holds: a kind not in `connectors`, a tool the grant does not name, and a row not in use (`isUsableMcpStatus`) are all dropped by those same functions.
- **settings.ts.** `kernel/src/agents/settings.ts` exports its existing `WRIGHT_ID`, and kernel.ts (which already imports `readAgentSettings` from it) imports it, so no new copy of the id is made. manager.ts stays mechanism-only and imports nothing from `agents/`.
- **dry-run.ts.** Add a new exported, exact-prefix predicate `isDryRunReadOnlyMcpProxy(toolName)` (regex `^mcp__kernel__kernel_mcp_r_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$`), kept separate from `DRY_RUN_READ_ONLY_TOOLS`, which stays a closed list of four. `isDryRunReadOnly` ORs it in.
- **Docs.** Rewrite the rule at `docs/architecture/mcp-connectors.md` ("a session may call one only if its `allowedTools` also names it") and the dry-run doc's "No dry-run review reads a ticket's body" sentence.

## Acceptance Criteria
- [ ] **AC1.** Given a crew member whose settings grant `clickup` tools that include a read-only one (stored proxy `kernel_mcp_r_clickup_<tool>`), whose `tool_policy.allowedTools` does not name that proxy, and a `clickup.tasks` poll playbook, when its dry-run review session calls `mcp__kernel__kernel_mcp_r_clickup_<tool>`, then the decision is `allow`, the call reaches the (fake) server, and no would-do entry is recorded. This case fails on today's `main` (`tool_not_allowed`).
- [ ] **AC2.** Given the same member, when a real playbook run session or a chat session calls the same proxy, then it is allowed too. The dry run and the real run of one member never disagree on a read proxy.
- [ ] **AC3.** AC1 and AC2 hold for `jira` with a fake MCP server. Jira is never exercised live.
- [ ] **AC4.** Given a granted write proxy (`kernel_mcp_w_...`): in a poll review (forced draft) it is recorded as a draft and not sent; in a dry run without `forceDraft` it is `would_do` / `dry_run`; in a real run it is held as `mcp_write`, unchanged; a `never` list with `mcp_write` still denies it `agent_boundary`. No dry run sends a write.
- [ ] **AC5.** The names a session's policy gains are exactly the proxy tools that session lists (`toolsForConnectors` over the owner's grant and a connector row in use), never more. A proxy for a tool the grant doesn't name, for a kind not in `connectors`, or for a row not in use (`expired`, `disconnected`, none) is not added, and a call to it is denied `tool_not_allowed` as today.
- [ ] **AC6.** A member without the tracker's read grant is unchanged: 22a's `owner_step_open` skip still starts no review session. This item adds nothing for that member (22e owns its park and enable card).
- [ ] **AC7.** A settings file that is refused or unreadable, or a grant read that throws, adds no name (fail closed), as the tool listing already does.
- [ ] **AC8.** The dry-run rail admits `mcp__kernel__kernel_mcp_r_<kind>_<tool>` as read-only by an exact-prefix rule kept separate from `DRY_RUN_READ_ONLY_TOOLS`, which stays closed. `mcp__other__kernel_mcp_r_x`, a bare `kernel_mcp_r_x` and any `kernel_mcp_w_` name are not read-only.
- [ ] **AC9.** The added names are never written to the settings file, the charter or the inspector's job lines. A grant change applies at the next session start or resume, the same as the tool listing.
- [ ] **AC10.** Wright's own sessions and every session of a member with no MCP grant behave as today.

Tests: the AC4 and AC8 cases go in `kernel/test/sessions-dry-run.test.ts`. The AC1 to AC3, AC5, AC7, AC9 and AC10 cases go in `kernel/test/integrations-mcp-connector.test.ts`, using its `start()` / `gate()` rig with a policy of `allowedTools: ["Read"]` (the 22a member's). At least one AC1 case must fail without the change. An AC6 case may go in either file, or the existing `owner_step_open` test in `kernel/test/playbooks-dry-run-poll.test.ts` may be cited unchanged. Existing tests that pass a `POLICY` naming `READ_FULL` / `WRITE_FULL` stay green. Any test that asserted a granted proxy is refused without `allowedTools` changes on purpose and must say so in a comment.

## Scope widening
- kernel/src/sessions/types.ts
- kernel/src/agents/settings.ts
- accepted: LP-SCOPE 2026-11-15

## Touched-file invariants

> Grounded at base `443d980128c7b6e749fe952fb731d340eb56d902`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/dry-run.ts`** — keep: it stays a pure leaf (`Pure, no I/O, a leaf like \`policy.ts\``), and the closed list stays exactly four names (`export const DRY_RUN_READ_ONLY_TOOLS: readonly string[] = Object.freeze([`). The new rule is a separate predicate, in the same way that `DRY_RUN_GITHUB_READ_TOOLS` is "A separate list, never added to `DRY_RUN_READ_ONLY_TOOLS`". The decision order of `classifyDryRunCall` is unchanged (`if (decision.decision !== "allow" || rail.kind === "deny") return { kind: "as_real_run" };`). reuse: the `KERNEL_READ_TOOL` regex idiom (a whole-name anchored regex, `^mcp__kernel__kernel_`). mirror: the rail's read prefix in `kernel/src/sessions/policy.ts`, `const MCP_READ_PROXY_PREFIX = \`${MCP_PROXY_PREFIX}r_\`;`. Every name the new predicate accepts must be a name the rail answers `ordinary`, never `outward`. pinned by: `kernel/test/sessions-dry-run.test.ts` `DRY_RUN_READ_ONLY_TOOLS is exactly Read, Glob, Grep and kernel_loomwright_capabilities, frozen`, and `kernel/test/sessions-policy.test.ts` `lets only kernel_mcp_r_ through`.
- **`kernel/src/sessions/manager.ts`** — keep: `#sessionPolicy` returns a new frozen object, and the caller's policy is never mutated (`A new frozen object: the caller's is never mutated`). Keep the fail-closed lookup idiom of `#grantedConnectors` (`// Fail closed: no grant, so no connector's tool is listed.`). Keep the gate order, where the rail is read only after the policy allows (`// The rail applies only after the policy allowed: it never widens a policy.`). reuse: the new `#grantedProxyTools` takes the shape of `#grantedConnectors` (an option, a try/catch, `Array.isArray`, a filter). mirror: `#sessionPolicy` is called at both start and resume (`this.#sessionPolicy(policy, params.agent, params.playbook ?? null, forceDraft, githubToken !== undefined)` and `this.#sessionPolicy(policy, row.agent, playbook, forceDraft, githubToken !== undefined)`), so a grant change applies at the next start or resume (AC9). The names come from the `connectors` that `#grantedConnectors` computed for this same policy, which are also the ones `#launch` passes to `mcpServers` (`connectors: live.policy.connectors ?? []`).
- **`kernel/src/sessions/types.ts`** — keep: the option-doc convention of its siblings (`A throw grants none (fail closed`). mirror: `readonly connectorsFor?: (agent: string) => readonly ConnectorKind[];` (same optional, fail-closed shape).
- **`kernel/src/kernel.ts`** — reuse: `mcpToolGrantsFor` (already exported), `proxyToolsOf` (today `const proxyToolsOf = (from: Store, grants: McpToolGrants)`, a local in `startKernel`, moved to module scope unchanged) and `toolsForConnectors`, the same chain the `mcpServers:` factory uses. Both the factory and `mcpProxyToolsFor` call the one hoisted `proxyToolsOf`. Never build a second proxy-list path. keep: the kernel builds proxy names only through `mcpProxyTools`. A throw from that read lists nothing (`// A proxy tool that can't be built (a name clash, a broken row) is not listed: a session lists fewer tools, never more.`).
- **`kernel/src/agents/settings.ts`** — keep: `const WRIGHT_ID = "wright";`. The only change is to export it, with the value and its existing uses unchanged.
- **`kernel/test/sessions-dry-run.test.ts`** — keep: the closed-list pin stays unchanged (`DRY_RUN_READ_ONLY_TOOLS is exactly Read, Glob, Grep and kernel_loomwright_capabilities, frozen`), and so does the classifier pin (`classifyDryRunCall: a policy or rail deny is as in a real run, outward is held, ordinary non-read-only would run`). reuse: the file's own per-attempt rig (`const gate = async (tool: string, input: unknown, cwd = tmp): Promise<Decision> => {`) for the AC4 session cases. Do not add a second hook harness.
- **`kernel/test/integrations-mcp-connector.test.ts`** — keep: the existing `POLICY` (`const POLICY: ToolPolicy = { allowedTools: ["Read", READ_FULL, WRITE_FULL], allowedBashPrefixes: [] };`) and its cases stay green. Add the new cases beside them, with a policy that does not name the proxy.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-mcp-connector.test.ts` — AC1/AC3 read proxy allowed with `allowedTools: ["Read"]` | In `kernel/src/sessions/manager.ts` `#sessionPolicy`, drop the appended `#grantedProxyTools(...)` names from `allowedTools`. The read proxy is then denied `tool_not_allowed`. |
| `kernel/test/integrations-mcp-connector.test.ts` — AC1 dry-run review records no would-do entry | In `kernel/src/sessions/dry-run.ts` `isDryRunReadOnly`, remove the `isDryRunReadOnlyMcpProxy(toolName)` operand. The call is then `would_do` / `dry_run`. |
| `kernel/test/integrations-mcp-connector.test.ts` — AC5 kind not in `connectors` adds no name | In `kernel/src/kernel.ts` `mcpProxyToolsFor`, map `proxyToolsOf(store, grants)` directly instead of passing it through `toolsForConnectors(..., connectors, ...)`. The proxy is then allowed without the kind. |
| `kernel/test/integrations-mcp-connector.test.ts` — AC7 a throwing grant read adds no name | In `kernel/src/sessions/manager.ts` `#grantedProxyTools`, remove the `try`/`catch`. The session start then throws, or gains names. |
| `kernel/test/integrations-mcp-connector.test.ts` — AC10 Wright's session gains no proxy name | In `kernel/src/kernel.ts` `mcpProxyToolsFor`, delete the `WRIGHT_ID` guard line. A granted Wright then gains the names. |
| `kernel/test/sessions-dry-run.test.ts` — AC8 predicate accepts `mcp__kernel__kernel_mcp_r_jira_get_issue` | flip `kernel_mcp_r_` → `kernel_mcp_x_` in `kernel/src/sessions/dry-run.ts` |
| `kernel/test/sessions-dry-run.test.ts` — AC8 predicate rejects `xmcp__kernel__kernel_mcp_r_jira_get_issue` (a needle only the `^` anchor rejects; the AC8 literals `mcp__other__kernel_mcp_r_x`, bare `kernel_mcp_r_x` and `mcp__kernel__kernel_mcp_w_jira_create_issue` stay as extra rejection cases) | flip `^mcp__kernel__kernel_mcp_r_` → `mcp__kernel__kernel_mcp_r_` in `kernel/src/sessions/dry-run.ts` |
| `kernel/test/sessions-dry-run.test.ts` — AC4 a granted write proxy in a real run is held `mcp_write`, in a plain dry run is `would_do`, in a forced-draft review is drafted, and with `never: ["mcp_write"]` is `agent_boundary` | flip `${MCP_PROXY_PREFIX}r_` → `${MCP_PROXY_PREFIX}` in `kernel/src/sessions/policy.ts` (every proxy then reads as read-only, so the write proxy is ordinary and runs) |
| `kernel/test/integrations-mcp-connector.test.ts` — AC2 the same member's real playbook-run session and chat session are allowed the read proxy with `allowedTools: ["Read"]` | In `kernel/src/kernel.ts` `mcpProxyToolsFor`, return `[]` before the `toolsForConnectors` chain. Every non-dry session is then denied `tool_not_allowed`. |
| `kernel/test/integrations-mcp-connector.test.ts` — AC9 a grant change applies at the next start (granting a second tool allows it at the next start, and the earlier session's policy is unchanged), and the settings file's bytes are identical before and after a granted session | In `kernel/src/sessions/manager.ts` `#grantedProxyTools`, cache the first answer per agent in a `Map` and return it on later calls. The next-start case then stays on the old names and goes red. The bytes check is a never-regress guard with no natural one-line mutant, so the reviewer applies it by hand. |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | The owner's MCP proxy grant becomes the session's permission, and the dry-run rail reads `kernel_mcp_r_` | all | 9 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/sessions/dry-run.ts", name: "isDryRunReadOnlyMcpProxy"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "mcpProxyToolsFor"}
  - {kind: "symbol", path: "kernel/src/sessions/manager.ts", name: "#grantedProxyTools"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "mcpProxyToolsFor"}
  - {kind: "symbol", path: "kernel/src/agents/settings.ts", name: "WRIGHT_ID"}
requires: []
lanes:
  - "kernel/src/sessions/dry-run.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/kernel.ts"
  - "kernel/src/agents/settings.ts"
  - "kernel/test/sessions-dry-run.test.ts"
  - "kernel/test/integrations-mcp-connector.test.ts"
  - "docs/architecture/dry-run.md"
  - "docs/architecture/mcp-connectors.md"
external_requires: []
```

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| dry-run rail | `kernel/src/sessions/dry-run.ts` (208) | — | HIGH |
| session policy | `kernel/src/sessions/manager.ts` (3259 — `#sessionPolicy` is the one place the manager fills session-policy fields; adds one private helper beside `#grantedConnectors`), `kernel/src/sessions/types.ts` (673 — `SessionManagerOptions` is the options interface; one field beside `connectorsFor`) | — | HIGH |
| composition | `kernel/src/kernel.ts` (509 — the composition root where the `mcpServers` factory already builds this listing; reuses its helpers), `kernel/src/agents/settings.ts` (493 — export the existing `WRIGHT_ID` rather than make a fourth copy) | — | HIGH |
| tests | `kernel/test/sessions-dry-run.test.ts` (570 — the requirement's named home for AC4/AC8), `kernel/test/integrations-mcp-connector.test.ts` (1449 — the requirement's named home; its session `start()`/`gate()` rig is reused) | — | HIGH |
| docs | `docs/architecture/dry-run.md` (181), `docs/architecture/mcp-connectors.md` (224) | — | HIGH |

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` scans every relative link in `docs/`. The two doc edits must keep their links resolving.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/sessions/manager.ts:2755` | yes | HOLDS | `const d = decideToolUse(live.policy, input.tool_name, input.tool_input);` | tip 6 minutes ago, fetched <1h |
| `kernel/src/sessions/policy.ts:88-90` | yes | HOLDS | `return policy.allowedTools.includes(toolName)` | tip 6 minutes ago, fetched <1h |
| `kernel/src/playbooks/dry-run.ts:459` | yes | HOLDS | `return { agent: owner, permissionMode: s.permissionMode, policy: { ...s.policy, ...` | tip 6 minutes ago, fetched <1h |
| `kernel/src/playbooks/dry-run.ts:649` | yes | HOLDS | `policy: as.policy,` | tip 6 minutes ago, fetched <1h |
| `kernel/src/playbooks/dry-run.ts:652` | yes | HOLDS | `...(plan === undefined ? {} : { forceDraft: true }),` | tip 6 minutes ago, fetched <1h |
| `kernel/src/sessions/dry-run.ts:144` | yes | HOLDS | `if (decision.decision !== "allow" \|\| rail.kind === "deny") return { kind: "as_real_run" };` | tip 6 minutes ago, fetched <1h |
| `kernel/src/sessions/dry-run.ts:85-91` | yes | HOLDS | `export function isDryRunReadOnly(toolName: string, toolInput: unknown): boolean {` | tip 6 minutes ago, fetched <1h |
| `kernel/src/sessions/dry-run.ts:36` | yes | HOLDS | `const KERNEL_READ_TOOL = /^mcp__kernel__kernel_[a-z0-9]+(?:_[a-z0-9]+)*_(?:list\|get)$/;` | tip 6 minutes ago, fetched <1h |
| `docs/architecture/mcp-connectors.md:186` | yes | HOLDS | `a session may call one only if its \`allowedTools\` also names it, as for every tool.` | tip 6 minutes ago, fetched <1h |
| `kernel/src/playbooks/runs.ts:674` | yes | HOLDS (moved to 688) | `policy: { ...s.policy, ...(s.never !== undefined ? { never: s.never } : {}) },` | tip 6 minutes ago, fetched <1h |
| `kernel/src/brain/handler.ts:336` | yes | HOLDS | `policy: { ...s.policy, ...(s.never ? { never: s.never } : {}) },` | tip 6 minutes ago, fetched <1h |
| `kernel/src/sessions/manager.ts:3065-3076` | yes | HOLDS | `#sessionPolicy(policy: ToolPolicy, agent: string \| null, playbook: number \| null, ...` | tip 6 minutes ago, fetched <1h |
| `kernel/src/features/catalogue.ts:361` | yes | HOLDS | `export function holdsConnector(held: HeldConnectors, need: ...` | tip 6 minutes ago, fetched <1h |
| `kernel/src/integrations/tool-filter.ts:40` | yes | HOLDS | `if (isMcpProxy(t)) return connectors.includes(t.mcpKind) && (mcpGrants[t.mcpKind] ?? []).includes(t.serverTool);` | tip 6 minutes ago, fetched <1h |
| `kernel/src/integrations/mcp/tools.ts:160` | yes | HOLDS | `const readOnly = isPlainObject(tool["annotations"]) && tool["annotations"]["readOnlyHint"] === true;` | tip 6 minutes ago, fetched <1h |
| `kernel/src/sessions/policy.ts:543-545` | yes | HOLDS | `if (toolName.startsWith(MCP_PROXY_PREFIX) && !toolName.startsWith(MCP_READ_PROXY_PREFIX)) {` | tip 6 minutes ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| This widens what granted members' real and chat sessions can do: they may now call the read tools the owner granted, and a granted write proxy is now held as `mcp_write` instead of refused `tool_not_allowed`. | MEDIUM | This is what the grant meant (option A, D38). Update `mcp-connectors.md` in the same PR. The AC4 tests pin that a write is drafted, would-do, held, or denied by `never`, and is never sent by a dry run. |
| AC10 excludes Wright's sessions even when Wright's settings carry an MCP grant (Wright can hold `connectors`, `roster.ts` `CONNECTORS_FIELD`), so a granted Wright still needs `allowedTools`. | MEDIUM | This follows AC10's literal wording. The guard is one line (`WRIGHT_ID`, in kernel.ts) and is pinned by a test. If the owner wants Wright included, deleting that line and the pin is a follow-up. |
| A server that labels a destructive tool read-only is now read without a hold in a dry run too. | LOW | The per-tool grant stays the bound, and `readOnlyHint` stays the server's word (`mcp-connectors.md`). |
| Policy names are computed at start/resume, while the listing is computed per launch attempt. A row that goes out of use between the two leaves a policy name with no listed tool. | LOW | A tool the session does not list cannot be called, so this never widens anything. Document it in the manager option's doc comment. |
| Existing tests (`playbooks-dry-run-poll.test.ts`, `playbooks-drafts-poll.test.ts`, `approvals.test.ts`) build sessions over stored proxy rows and may change their gate answers. | MEDIUM | Run the full kernel suite. Any test whose expectation flips on purpose says so in a comment. Do not weaken unrelated assertions. |
| Prior churn (postmortem ledger) on `manager.ts` (32), `types.ts` (26), `kernel.ts` (24), `dry-run.md` (12) and `mcp-connectors.md` (8). Recurring classes are `self_heal_churn` (47) and `drain_churn` (19), with no `self_heal_miss`. | MEDIUM | Keep the diff small. Mirror the existing fail-closed idioms exactly (Touched-file invariants), and give every doc sentence that changes a test-backed claim. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Validation (must pass before merge)
1. **Static (kernel suite and docs):** `cd kernel && npm ci && npm test` with the new cases above. At least one AC1 case fails without the change. Then `bash scripts/check-docs.sh`. Static only: exit walk step 1 runs the live ClickUp dry run anyway.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-15-dry-run-review-reads-the-ticket.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-15T18:42:26Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/285
- **Branch:** feature/dry-run-review-reads-the-ticket
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unarmed (marker_missing)
- **Summary:** A granted MCP proxy tool joins a crew member's session allowedTools in memory (mcpProxyToolsFor -> #grantedProxyTools, fail closed, never Wright), and the dry-run rail admits mcp__kernel__kernel_mcp_r_* through the separate isDryRunReadOnlyMcpProxy, so a poll playbook's dry-run review can read the ticket. 4771 tests, tsc and check-docs green. Holistic review PASS on round 1 (1 LOW dismissed below the MEDIUM floor; reviewer applied all 10 pin mutations, all held). Required CI green. Pin-mutation gate script: 10 unverified (prose rows). SUP-CHILDREN proceeded on owner answer (the unsettled child was the Supervisor's own context-keeper, settled before the answer).

## Not verified
- **live ClickUp/Jira dry-run review (exit walk step 1)** — brief is static-only; Jira is never exercised live (subtask 1)
- **the session-registered proxy tool calling through the real Keychain** — tests use only the fake Keychain (subtask 1)
