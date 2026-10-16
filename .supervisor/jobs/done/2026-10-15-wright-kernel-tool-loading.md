# Supervisor Job: Wright can load and call its kernel tools in a real session

## Environment
- **Project:** loomwright-studio (lane clone L1 of run automate-2026-10-15-153327)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean, branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-2/2026-10-15-084410-wright-can-load-its-kernel-tools.md
- **Base commit:** 95d31567140e3101e029cd985b7895a5b7fee8a1

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest kernel; the change is an env entry on the existing `query()` options plus tests and docs. |
| 2 | Dependency Availability | GO | `@anthropic-ai/claude-agent-sdk` 0.3.284 is pinned in `kernel/package.json`; its bundled CLI (`@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`) carries the strings `Invalid ENABLE_TOOL_SEARCH value "` and doc text naming `false` as the off value, `true`/`auto`/`auto:N`/`force` as others. Behaviour still unverified until the probe runs. |
| 3 | Architecture Fit | GO | Both a start and a resume go through `SessionManager.#launch`, which builds the one `Options` object passed to `query()`; one place sets the switch for both. The gate (`decideToolUse`) stays unchanged under approach (b). |
| 4 | Scope vs Supervisor Capability | GO | One worker: 1 source file (2 under fallback (a)), 5 test files, 4 docs. |
| 5 | Hard Blockers | CAUTION | The probe and the live test need a real session on the owner's subscription (Keychain token). If the worker's environment cannot run a real session, the probe must record that honestly as not run, never invent a result. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Kernel sessions launch with the Agent SDK's tool deferral turned off (probe-validated), so a real Wright session can call the kernel MCP tools its policy lists without the `ToolSearch` meta-tool; plus the small live-harness fixes for the phase 2 exit rerun.

**Problem Statement:**
The owner needs Wright, in a real Agent SDK session, to call the kernel tools its policy allows (`kernel_trigger_register` first), because "remind me at 5pm to check X" must create a trigger for the phase 2 exit run to pass.
Currently, in every real Wright session the SDK offers `mcp__kernel__*` tools only through its `ToolSearch` meta-tool; the kernel's PreToolUse gate (`decideToolUse` in `kernel/src/sessions/policy.ts`) allows only exact policy names, Wright's proposed policy does not list `ToolSearch`, so the load is denied (`tool_decision {"tool":"ToolSearch","decision":"deny","reason":"tool_not_allowed"}`) and Wright can use none of its kernel tools. CI missed it because `kernel/test/phase-2-exit.test.ts` uses a stand-in Wright that never goes through SDK tool loading.
Success looks like: the probe recorded in `docs/evidence/agent-sdk-tool-loading-probe.md`; every kernel launch (start and resume) passing the validated deferral setting in `options.env`; a deterministic test pinning it; an opt-in live test where a real session calls a kernel tool with no `ToolSearch` `tool_decision`; docs updated; the policy never widened.

**Owner decisions (binding, from the requirement):** approach (b) first — turn the SDK's tool deferral off on every kernel session launch so the policy stays the user's exact list. Approach (a) only as a fallback if the probe shows (b) does not work: the gate allows the exact name `ToolSearch` alone (never any other unlisted name), each such decision recorded as a `tool_decision` event with its own reason. No tool is ever added to the proposed Wright policy (`kernel/src/brain/settings.ts` `PROPOSED_ALLOWED_TOOLS`) or any role's policy.

## Acceptance Criteria
- [ ] AC1: Given the probe, then a committed evidence file `docs/evidence/agent-sdk-tool-loading-probe.md` records the SDK version (0.3.284), the exact launch setting tried (`ENABLE_TOOL_SEARCH=<value>` in the env the kernel passes to `query()`), whether a real session called a kernel tool with and without the setting, the store's `tool_decision` rows for each run, the tool count offered to Wright's session (risk note), and — when it runs — the fenced output of `cd kernel && STUDIO_LIVE=1 npx vitest run test/sessions-live.test.ts`; and `docs/OPEN_QUESTIONS.md`'s existing "Agent SDK tool loading" entry links to that file. The PR body links to the evidence file.
  - **Probe ran:** the OPEN_QUESTIONS entry is marked answered (`- [x]`) with the result.
  - **Probe NOT RUN** (the worker's environment cannot run a real session): the evidence file says NOT RUN and why, the OPEN_QUESTIONS entry stays `- [ ]` with the link and a note that it is pending the owner's `STUDIO_LIVE=1` run, and the worker ships approach (b) with `ENABLE_TOOL_SEARCH=false` (the owner's chosen approach and the value the CLI's own text names as "off") — never a recorded result that did not happen.
- [ ] AC2 (approach (b) path): Given a session started by the session manager, when the deterministic test inspects the options passed to `query()`, then `options.env` carries the deferral setting (the probe-validated value, or `ENABLE_TOOL_SEARCH=false` on the NOT RUN branch of AC1); and given a resumed session (`resumeSession`), the same holds; and given a `baseEnv` carrying `ENABLE_TOOL_SEARCH=true`, the start and resume launch env still carries the kernel's value. The test fails if the setting is dropped from either path. (Under fallback (a) this AC is replaced by AC5, and `kernel/test/sessions-tool-loading.test.ts` instead pins the launch env EXACTLY for start and resume with NO deferral entry — so a later re-introduction of an unvalidated switch is visible — while the (a) gate pins live in `kernel/test/sessions-policy.test.ts`.)
- [ ] AC3: Given Wright's proposed policy unchanged, when a real session (`STUDIO_LIVE=1`) under that policy, with the kernel MCP server attached, is asked to set a reminder, then a trigger is registered and the store has no `ToolSearch` `tool_decision` for that session. (Opt-in live test beside `kernel/test/sessions-live.test.ts`; never runs in CI. On AC1's NOT RUN branch AC3 is met by the committed, CI-skipped test carrying these assertions; its result is recorded only when the owner runs `STUDIO_LIVE=1`, and nobody records a result before then.)
- [ ] AC4: Given a tool not in the policy, when a session tries to call it, then it is still denied with `tool_not_allowed` — including the exact name `ToolSearch` under Wright's proposed policy when approach (b) is used (a deterministic pin in `kernel/test/sessions-policy.test.ts`).
- [ ] AC5: Given fallback (a) is used instead, then only the exact name `ToolSearch` is allowed outside the policy, each such decision is recorded as a `tool_decision` event with its own reason, and a test pins that any other unlisted name is still denied — including near-misses `ToolSearchX`, `Toolbox` and the case variant `toolsearch`. (Applies only if the probe shows (b) does not work; the evidence file then says why.)
- [ ] AC6: Given the live harness `kernel/test/phase-2-exit-live.test.ts`, then its deep links come from `deepLinkFor()` (`kernel/src/notifications/record.ts`), the extra database connection around `triggerNotifications` is gone, no assertion message prints unredacted CLI stderr (it goes through the harness's existing `redact`/`clipped`), and `docs/evidence/phase-2-exit-runbook.md`'s "Real notifications appear" bullet lists step 2's notification.
- [ ] AC7: Given `docs/ARCHITECTURE.md`, then its Session manager section says how kernel tools reach a session and links the evidence file — approach (b): the deferral switch on every launch, start and resume, and why the policy needs no meta-tool; fallback (a): the single `ToolSearch` gate exception, its own reason, and that every tool it loads is still gated by exact name — and the "known incomplete" note in the Kernel tools section is updated to match.
- [ ] AC8: `cd kernel && npm ci && npm run typecheck && npm test` passes and `bash scripts/check-docs.sh` passes.

## Touched-file invariants

> Grounded at base `95d31567140e3101e029cd985b7895a5b7fee8a1`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/manager.ts`** — keep: isolation options untouched (`settingSources: [],`, `plugins: [{ type: "local", path: config.loomwrightPath }],`), the host switch rules (`function withHostSwitch(`, `hostSwitchCollision`) and the kernel-owned stripping of inherited host-switch names (`function withoutHostSwitch(`); reuse: set the switch in the ONE place both paths share — `#launch` builds `options` with `env: config.env,` for the start and for every resume attempt (`sessionOptions: { resume: ctx.sdkSessionId },`) — so start and resume cannot diverge; the kernel's value must win over an inherited daemon-env value and over a contract host switch (apply it after `withHostSwitch`, or refuse a contract that names it, the same way `hostSwitchCollision` refuses auth names); mirror: `kernel/src/auth/types.ts` `ChildEnv` shape (`export type ChildEnv = Record<string, string>;`); pinned by: `kernel/test/sessions.test.ts` exact env assertions — `expect(options.env).toEqual({`, `expect(call.options.env).toEqual({ PATH: "/usr/bin", ANTHROPIC_API_KEY: SECRET, LOOMWRIGHT_HOST_MODE: "1"`, the multi-line `expect(calls[0]?.options.env).toEqual({`, `expect(calls[0]?.options.env).toEqual({ PATH: "/usr/bin", ANTHROPIC_API_KEY: SECRET, TEST_HOST_FLAG: "1"`, `expect(call.options.env).toEqual({ PATH: "/usr/bin", ANTHROPIC_API_KEY: SECRET, TEST_HOST_FLAG: "1", TEST_HOST_STATE: stateDirOf(id) });` and the start-plus-resume pair `expect(calls.map((c) => c.options.env)).toEqual([` — under (b) these are updated to include the new entry, never loosened to `toMatchObject`; KEEP UNCHANGED `expect(seen).toEqual([{ PATH: "/usr/bin" }, { PATH: "/usr/bin" }]);` (the auth provider sees the base env without kernel additions, so the entry is added after `buildEnv`).
- **`kernel/src/sessions/policy.ts`** — keep: deny by default, exact-name match `policy.allowedTools.includes(toolName)` and the denial `{ decision: "deny", reason: "tool_not_allowed" }`; `decideToolUse` stays pure ("Pure: no I/O. Deny by default."). Changed ONLY under fallback (a), and then only for the exact string `ToolSearch` with its own reason; pinned by: `kernel/test/sessions-policy.test.ts` `expect(decideToolUse(policy, name, {})).toEqual({ decision: "deny", reason: "tool_not_allowed" });` and `kernel/test/sessions.test.ts` `[preToolUse("mcp__evil__tool", {}), "deny", "tool_not_allowed"],`.
- **`kernel/test/phase-2-exit-live.test.ts`** — keep: opt-in gating `const LIVE = process.env.STUDIO_LIVE === "1";`, the token redaction `function redact(text: string): string {` and `clipped(`; reuse: `tryDb`/`withDb` from `./crash-helpers.js` (one connection per read, not `tryDb(dataDir, () => triggerNotifications(trigger.id))` which opens one inside another), `deepLinkFor` from `../src/notifications/record.js` instead of the literal `loomwright-studio://notifications/`; the unredacted messages are the `expect(r.code, r.stderr).toBe(0);` and `expect(off.code, off.stderr).toBe(0);` calls.
- **`kernel/test/sessions-live.test.ts`** — keep: opt-in `describe.skipIf(!LIVE)` with `STUDIO_LIVE === "1"`, the subscription auth path `selectAuthProvider(SUBSCRIPTION_TOKEN_ID, { store })`, temp dirs removed in `afterEach`; reuse: attach the kernel server the way `kernel/src/kernel.ts` does (`createKernelMcpServer({ store, sessions: manager, sessionId, now }`) through the `mcpServers` factory, and Wright's policy from `PROPOSED_ALLOWED_TOOLS` unchanged. A cwd under `~/Documents` is refused (D31) — keep `mkdtempSync(join(tmpdir(), …))`.
- **`docs/OPEN_QUESTIONS.md`, `docs/ARCHITECTURE.md`, `docs/evidence/phase-2-exit-runbook.md`** — keep: every relative link resolvable (`scripts/check-docs.sh` check 1); the OPEN_QUESTIONS entry to close starts `- [ ] **Agent SDK tool loading: can a kernel session call its kernel MCP tools without `ToolSearch`?`; the ARCHITECTURE note to update contains `**known incomplete:** the 2026-10-15 live run showed the Agent SDK first loads these tools through its `ToolSearch` meta-tool`.

## Closed enumerations touched

> Applies ONLY under fallback (a) (a new gate reason). Sibling grep at base `95d31567140e3101e029cd985b7895a5b7fee8a1`: `grep -rn "bash_prefix_not_allowed" kernel/src kernel/test docs` → hits in `kernel/src/sessions/policy.ts` (the union and its use) and, as assertions only, `kernel/test/sessions-policy.test.ts`, `kernel/test/sessions.test.ts` and `kernel/test/approvals.test.ts`; the only closed list is the union. Under approach (b) no value is added and this section is moot.

- **`<the (a) reason, e.g. "tool_search_allowed">`** (sibling: `bash_prefix_not_allowed`) — must be named in:
  - `kernel/src/sessions/policy.ts` — the closed union `export type ToolDecisionReason` — extend (re-exported unchanged by `kernel/src/sessions/index.ts`; widened in `manager.ts` by `ToolDecisionReason | "kernel_gate_error"`, which follows automatically).
  - `kernel/test/sessions-policy.test.ts` — assertions, not a closed list — no change beyond the new pins.
  - `docs/ARCHITECTURE.md` — check whether it lists gate reasons; if it does, extend it.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/sessions-tool-loading.test.ts` — start carries the deferral setting | delete the `ENABLE_TOOL_SEARCH` entry the fix adds in `kernel/src/sessions/manager.ts` `#launch` |
| `kernel/test/sessions-tool-loading.test.ts` — resume carries the deferral setting | set the entry only when `config.resumeMode` is false in `kernel/src/sessions/manager.ts` (start-only) |
| `kernel/test/sessions-tool-loading.test.ts` — kernel value wins over `baseEnv` `ENABLE_TOOL_SEARCH=true` | apply the entry before `config.env` is spread (so the inherited value overrides it) in `kernel/src/sessions/manager.ts` |
| `kernel/test/sessions-policy.test.ts` — `ToolSearch` denied `tool_not_allowed` under `PROPOSED_ALLOWED_TOOLS` (approach (b)) | add `if (toolName === "ToolSearch") return { decision: "allow", reason: "tool_allowed" };` before `return policy.allowedTools.includes(toolName)` in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions.test.ts` — the six updated exact env `toEqual` assertions (approach (b)) | delete the `ENABLE_TOOL_SEARCH` entry the fix adds in `kernel/src/sessions/manager.ts` `#launch` |
| `kernel/test/sessions-policy.test.ts` — (a) only: `ToolSearch` allowed with its own reason | flip the (a) exception's reason to `tool_allowed` in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions-policy.test.ts` — (a) only: any other unlisted name (incl. `ToolSearchX`, `Toolbox`, `toolsearch`) still denied | widen the (a) exception from `toolName === "ToolSearch"` to `toolName.startsWith("Tool")` in `kernel/src/sessions/policy.ts` |
| `kernel/test/sessions-live.test.ts` — (opt-in, `STUDIO_LIVE=1`) no `ToolSearch` `tool_decision` and a trigger registered | delete the `ENABLE_TOOL_SEARCH` entry in `kernel/src/sessions/manager.ts` (live only; not run in CI) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Probe, deferral switch on every launch, tests, harness fixes, docs | AC1–AC8 | 8 modify (+ `policy.ts` under fallback (a)), 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "docs/evidence/agent-sdk-tool-loading-probe.md"}
  - {kind: "symbol", path: "docs/evidence/agent-sdk-tool-loading-probe.md", name: "ENABLE_TOOL_SEARCH"}
  - {kind: "file", path: "kernel/test/sessions-tool-loading.test.ts"}
  - {kind: "symbol", path: "kernel/test/sessions-live.test.ts", name: "PROPOSED_ALLOWED_TOOLS"}
  - {kind: "symbol", path: "kernel/test/phase-2-exit-live.test.ts", name: "deepLinkFor"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "agent-sdk-tool-loading-probe.md"}
  - {kind: "symbol", path: "docs/ARCHITECTURE.md", name: "agent-sdk-tool-loading-probe.md"}
requires: []
lanes:
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/test/sessions-tool-loading.test.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/sessions.test.ts"
  - "kernel/test/sessions-live.test.ts"
  - "kernel/test/phase-2-exit-live.test.ts"
  - "docs/evidence/agent-sdk-tool-loading-probe.md"
  - "docs/evidence/phase-2-exit-runbook.md"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "@anthropic-ai/claude-agent-sdk 0.3.284 bundled CLI honouring ENABLE_TOOL_SEARCH (to be probed)"
  - "A real Claude session on the owner's subscription token (Keychain) for the probe and the STUDIO_LIVE live test"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

## Implementation notes (for the worker)

1. **Probe first, record before the fix (AC1 has a ran / NOT RUN branch).** Use the kernel's own launch shape (`settingSources: []`, the kernel `PreToolUse` gate, streaming input, the kernel MCP server via `createKernelMcpServer`, a temp cwd outside protected folders, a cheap model such as `claude-haiku-4-5`, Wright's `PROPOSED_ALLOWED_TOOLS` policy). Run it once without and once with `ENABLE_TOOL_SEARCH=false` in `options.env`; record per run what the session called and the `tool_decision` rows. A throwaway probe script may live under the scratch dir; the committed artefact is the evidence file. If the environment cannot run a real session, write that in the evidence file and leave the live result as NOT RUN — never a guessed result.
2. **The fix:** set the validated value in `options.env` inside `SessionManager.#launch` (shared by start and resume), applied after the auth env and host switch so neither an inherited daemon variable nor a contract can flip it. If the probe shows (b) has no effect, implement fallback (a) in `decideToolUse` for the exact name `ToolSearch` only, with its own reason, and say why in the evidence file.
3. **Tests:** new `kernel/test/sessions-tool-loading.test.ts` uses `fakeSessions` from `./session-fakes.js` (`calls[].options`) to pin the setting on a start and a resume; update the exact `toEqual` env assertions in `kernel/test/sessions.test.ts`; add the `ToolSearch`-denied pin under the proposed policy in `kernel/test/sessions-policy.test.ts`; add the opt-in live case to `kernel/test/sessions-live.test.ts`.
4. **Part B** (live harness, runbook) per AC6.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| `ENABLE_TOOL_SEARCH` is undocumented in the SDK's types; a later SDK may rename or drop it | MEDIUM | The deterministic test pins that the kernel sets it; the opt-in live test catches the SDK ignoring it. |
| Probe needs a real session (Feasibility (Phase 2.5)) | MEDIUM | Record exactly what ran; NOT RUN is an honest outcome, a guessed result is not. |
| With deferral off every tool schema is in context each turn | LOW | Note the tool count in the evidence file (about 12 kernel tools plus Read, Glob, Grep and the Loomwright plugin's). |
| Fallback (a) puts a fixed exception into the safety gate | HIGH (only if used) | Owner's stated fallback; exactly one name, its own reason, every use recorded, pinned by a test that any other unlisted name is denied. |
| Exact-env assertions in `kernel/test/sessions.test.ts` break when the entry is added | MEDIUM | Update them to the new exact env; never loosen to partial matching. |
| Prior churn (postmortem ledger) on `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`, `kernel/src/sessions/manager.ts` — recurring self_heal_churn and drain_churn | MEDIUM | Keep doc edits precise and consistent across ARCHITECTURE/OPEN_QUESTIONS/evidence; re-run `bash scripts/check-docs.sh` and the full kernel suite before hand-back. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-15-wright-kernel-tool-loading.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-15T16:21:53Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/61
- **Branch:** feature/09-wright-kernel-tool-loading
- **Files changed:** 14
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Probe (SDK 0.3.284, Haiku) showed ENABLE_TOOL_SEARCH=false removes ToolSearch and offers kernel tools directly; SessionManager.#launch sets it last for start and resume, and a contract host switch naming it is refused (review fix 1). Gate and policies unchanged. Harness/runbook fixes and docs updated. 1116 tests pass.

## Not verified
- **claude-sonnet-5-5 Wright sessions** — probe and live test ran on claude-haiku-4-5 only (subtask 1)
- **phase-2-exit-live.test.ts live steps** — needs the owner's installed launchd service and run (subtask 1)
