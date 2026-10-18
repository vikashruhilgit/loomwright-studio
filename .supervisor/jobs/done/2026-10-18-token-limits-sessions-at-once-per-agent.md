# Supervisor Job: Per-agent tokens per day and sessions at once, read from each agent's settings and enforced at session admission

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-18-135554/L3 (lane clone of loomwright-studio)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-4/2026-10-18-041104-token-limits-and-sessions-at-once-per-agent.md
- **Base commit:** 0fbe903b7c64522529ae04eea81ac5d3af146729

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest in `kernel/`; better-sqlite3 store transactions already wrap admission (`this.#store.transaction`). |
| 2 | Dependency Availability | GO | No new dependency: `readAgentSettings` (item 01, merged in PR #83) already parses `limits.tokens_per_day` / `limits.sessions_at_once`. |
| 3 | Architecture Fit | GO | Admission is already the single start/resume gate (`admissionFor` → `Budget.checkPlaybook`); the event loop already parks an `AdmissionRefusedError` until `retryAt`. |
| 4 | Scope vs Supervisor Capability | GO | ~12 files, well under the context-bound bound; one coherent module group. |
| 5 | Hard Blockers | CAUTION | `readAgentSettings` refuses `limits` in `wright.json` today ("not supported for Wright yet") and `kernel/test/agents-foundation.test.ts` pins that refusal; AC5 needs Wright's limits applied, so that refusal must be lifted for `tokens_per_day` and `sessions_at_once` (and the pin updated). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Read each agent's `limits.tokens_per_day` and `limits.sessions_at_once` from its own settings file at every admission (and every metered result), enforce both at session admission (new refusal `agent_sessions_at_once`), and fail closed on an unreadable or invalid settings file.

**Problem Statement:**
The owner needs per-agent token and concurrency limits because a crew member must not spend the shared weekly cap or run more sessions than allowed.
Currently, limits come only from the static `agentDailyTokenLimits` map in `kernel/src/budget/types.ts`, which the kernel never fills (`new Budget({ store, authProvider }, { now })` in `kernel/src/kernel.ts`), so no agent is ever limited, and no sessions-at-once limit exists at all. This leaves the safety kernel's "limit on concurrent sessions" unbuilt.
Success looks like: an agent's `config/agents/<id>.json` limits take effect at its next start, a start past either limit is refused and its event parked, and a broken settings file refuses rather than reading as unlimited.

## Acceptance Criteria
- [ ] AC1 — Given `config/agents/mason.json` with `limits.tokens_per_day: 1000` and 1,000 counted tokens today for `mason`, when a start for `mason` is requested, then admission refuses it `agent_daily_limit` with `retryAt` the next local midnight, and exactly one `notify` is appended that day. Given a `mason.json` with no `limits`, then the start is admitted whatever the count.
- [ ] AC2 — Given `limits.sessions_at_once: 1` and one `running` session row for `mason`, when a second start is requested, then admission refuses it `agent_sessions_at_once` with `retryAt` = now + `SESSIONS_AT_ONCE_RECHECK_MS` (a named kernel constant, 60 s; never `null`) and, through the event loop, the event is parked (`event_parked`, no second `notify`). When the first session ends and the recheck comes due, then the parked event starts its session.
- [ ] AC3 — Given `limits.sessions_at_once: 1` and an `orphaned` session row for `mason`, when a start is requested, then it is refused `agent_sessions_at_once`, and the refusal's `admission_refused` payload names the orphan's session id and `studio session abandon`.
- [ ] AC4 — Given `limits.sessions_at_once: 1` and two `startSession` calls for `mason` issued in the same tick (no await between them), then exactly one is admitted (one session row) and the other throws `AdmissionRefusedError` with reason `agent_sessions_at_once`.
- [ ] AC5 — Given Wright's `wright.json` with `limits.sessions_at_once: 1` and one live `wright` session, then a second `wright` start is refused the same way. Given a `wright.json` with no `limits`, then every existing budget and brain test passes; the only edits to existing budget assertions are adding `session: <id>` to the expected resume requests in `kernel/test/budget-admission.test.ts` (the `toEqual` at the orphaned/interrupted resume-refused loop and the two literals in the attempt-1 cap-hit retry test), never loosening them; the start-request pin there stays byte-unchanged (no `session` key).
- [ ] AC6 — Given a `mason.json` that becomes invalid JSON (or is deleted), when a start is requested, then it is refused with reason `settings_invalid` (or `settings_missing`), never admitted as unlimited.
- [ ] AC7 — Given an enabled playbook owned by `mason` at its sessions-at-once limit, when it fires, then `Budget.checkPlaybook` refuses it `agent_sessions_at_once` (in the agent-daily-limit order slot, step 4) and the fire is parked, not dropped and not run.
- [ ] AC8 — Given `limits.sessions_at_once: 1`, one `running` `mason` session and a second, `interrupted` `mason` session, when the interrupted one is resumed, then the resume is refused `agent_sessions_at_once` (a resume adds a live session). Given `limits.tokens_per_day: 1000` with 1,000 counted tokens today and no other live session, when an interrupted `mason` session is resumed, then it is admitted (a resume is never refused by `tokens_per_day`).
- [ ] AC10 — Given `limits.sessions_at_once: 1` and one `mason` session whose resume attempt 1 failed (its row `starting`, no other live `mason` session), when the manager asks admission before resume attempt 2, then it is admitted: the admission request carries the resuming session's id (`AdmissionRequest.session`) and that session's own row is not counted. The same holds for the initial resume of an `orphaned` row (its own orphan row is not counted).
- [ ] AC11 — Given a start for an agent label that fails the crew-id grammar (`isValidAgentId` false and not `wright`, e.g. `exit-test:event-1`), when admission runs with the kernel's lookup, then no per-agent check applies (as for a `null` agent): it is admitted unless the cap or a playbook limit refuses it, and `kernel/test/crash-resume.test.ts` passes unchanged.
- [ ] AC9 — Given the change is complete, when `docs/architecture/budget.md` is read, then it documents the source of per-agent limits, both refusals, the live-session definition (`starting`, `running`, `orphaned`), the settings refusals, the non-crew-label rule, the honest limits and the new reason names; and when `bash scripts/check-docs.sh` runs, then it passes.

## Touched-file invariants

> Grounded at base `0fbe903b7c64522529ae04eea81ac5d3af146729`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/budget/types.ts`** — keep: own-key lookup only (`return Object.hasOwn(limits, agent) ? limits[agent] : undefined;`) and validation at construction (`validateBudgetConfig`); the static `agentDailyTokenLimits` map stays valid and is consulted ONLY when no `agentLimits` lookup is given; mirror: `BudgetOptions` is spread into every sub-gate (`const shared = { ...options, config: this.config };` in `index.ts`), so a new option reaches meter, admission and playbook gate through it; pinned by: `kernel/test/budget-admission.test.ts` (`agent_daily_limit`), `kernel/test/budget-meter.test.ts`.
- **`kernel/src/budget/internal.ts`** — keep: `agentLimitRefusal` refuses `start` only for the token limit (`if (request.kind !== "start" || request.agent === null) return null;`), once-per-agent-day recording (`noteAgentLimitReached`), and every helper is called inside the caller's transaction ("Call inside a transaction"); reuse: `appendEvent` / `appendNotify` for the new refusal's event and hourly notify; pinned by: `kernel/test/budget-admission.test.ts`, `kernel/test/budget-playbook.test.ts`.
- **`kernel/src/budget/admission.ts`** — keep: the whole check runs in ONE store transaction (`return this.#store.transaction((): AdmissionDecision => {`), cap first (`"cap_parked"`), and every refusal appends exactly one `admission_refused` event through `#refuse`; pinned by: `kernel/test/budget-admission.test.ts`.
- **`kernel/src/budget/playbook.ts`** — keep: the step order (playbook daily limit → cap / fallback → agent limit → admit) and the comment anchor `// The agent limit as \`check\` applies it: an API-key admit never skips it.`; the new sessions-at-once and settings checks sit in that same agent slot; `playbook: null` stays exactly `BudgetAdmission.check`; pinned by: `kernel/test/budget-playbook.test.ts`, `kernel/test/sessions-playbook-admission.test.ts`.
- **`kernel/src/budget/meter.ts`** — keep: `#checkLimit` records the crossing once per agent-day (`noteAgentLimitReached(`) and never touches the running session; it must read the agent's limit through the same lookup admission uses (a settings refusal there is skipped, never thrown: the meter must not fail a metered result); pinned by: `kernel/test/budget-meter.test.ts`.
- **`kernel/src/kernel.ts`** — keep: `admissionFor` fails closed on an admit naming another provider (`refusing (fail closed)`), and the composition order; wire `agentLimits` into `new Budget({ store, authProvider }, { now })` from `readAgentSettings(dataDir, agent)`; pinned by: `kernel/test/kernel-daemon.test.ts`, `kernel/test/sessions-playbook-admission.test.ts`.
- **`kernel/src/agents/settings.ts`** — keep: `readAgentSettings` is the ONE reader (`` `readAgentSettings` is the ONE reader: ``), never throws for content, crew schema stays strict. Exactly two changes: (1) the Wright refusal loop `for (const field of ["never", "limits", "workspaces"] as const) {` so `limits.tokens_per_day` and `limits.sessions_at_once` are accepted for Wright while `never`, `workspaces` and `limits.delegation_depth` stay refused for Wright (item 06 applies delegation depth); (2) the `model_unset` variant of `AgentSettingsRefusal` (`readonly error: "model_unset"; readonly file: string; readonly field: "model";`) gains an optional `limits?: AgentLimits`, set when the file sets limits. Consumers that must still compile and behave the same: `kernel/src/brain/settings.ts` `readWrightSettings` (`case "model_unset":` returns `r` — it must strip the new key so `WrightSettingsRefusal` is unchanged), `kernel/src/agents/` callers (`roster.ts`, `charter-tools.ts`, `delegate.ts`), and the CLI under `kernel/src/cli/`; pinned by: `kernel/test/agents-foundation.test.ts` (`not supported for Wright yet`), `kernel/test/brain.test.ts`.
- **`kernel/src/brain/settings.ts`** — keep: `readWrightSettings` returns only the five `WrightSettings` fields (`const { model, effort, permissionMode, policy, policyStatus } = r.settings;`); update only its doc comment (`A file that sets \`never\`, \`limits\` or \`workspaces\` is \`settings_invalid\``) to the new rule; pinned by: `kernel/test/brain.test.ts`.
- **`kernel/src/sessions/types.ts`** — keep: `AdmissionRefusedError` shape (`super("admission_refused", message);`); extend the `AdmissionRefusalReason` union, and add to `AdmissionRequest` an optional `readonly session?: number` (the id of the session a `resume` request resumes; absent on a `start`), documented next to `playbook`.
- **`kernel/src/sessions/manager.ts`** — OWNER-APPROVED narrow change (2026-10-18, Launch Pad plan review: "Allow manager.ts change"): the two resume admission requests — `this.#admit({ kind: "resume", agent: row.agent, …` in `resumeSession` and the request built in `#parkIfRefused` — add `session: id` / `session: live.id`. Nothing else in the file changes: the start request (`this.#admit({ kind: "start", agent: params.agent,`) gets no `session` key, and the admit→insert window stays synchronous (no `await` between `this.#admit(` and `this.#insertRow(params, loomwrightPath, sdkSessionId, "starting", at)`); keep `#parkIfRefused`'s fail-closed catch (`payload = { reason: "admission_error", error: errorMessage(err), attempt: n };`); pinned by: `kernel/test/budget-admission.test.ts` — its resume-request `toEqual` pins (`expect(requests).toEqual([{ kind: "resume", agent: "wright", account: AUTH.account, provider: AUTH.id, task: null }]);` and the two literals in the attempt-1 cap-hit retry test) gain `session: <id>`, and its start-request `toEqual` pin must stay unchanged (it proves a start carries no `session`); `kernel/test/sessions-playbook-admission.test.ts` matches resume payloads with `toMatchObject`/`objectContaining` and needs no change.

## Closed enumerations touched

> Sibling grep at base `0fbe903`: `grep -rnF 'agent_daily_limit' kernel/src kernel/test docs` → hits in `kernel/src/sessions/types.ts`, `kernel/src/budget/{admission,playbook,internal,meter}.ts`, `kernel/test/{brain,budget-admission,budget-meter,budget-playbook}.test.ts`, `docs/architecture/budget.md`.

- **`agent_sessions_at_once`**, **`settings_invalid`**, **`settings_missing`** (sibling: `agent_daily_limit`) — must be named in:
  - `kernel/src/sessions/types.ts` — the refusal-reason union `export type AdmissionRefusalReason = "cap_parked" | "agent_daily_limit" | "playbook_daily_limit";` — extend.
  - `kernel/src/budget/playbook.ts` — `export type PlaybookRefusalReason = "cap_parked" | "agent_daily_limit" | "playbook_daily_limit";` — extend.
  - `kernel/src/budget/admission.ts` — `#refuse`'s `reason: "cap_parked" | "agent_daily_limit",` parameter — extend.
  - `docs/architecture/budget.md` — the admission reason list (`reason\` one of \`cap_parked\`, \`agent_daily_limit\` or \`playbook_daily_limit\``) and the Events table — extend.
  - `kernel/src/budget/internal.ts`, `kernel/src/budget/meter.ts` — produce `agent_daily_limit` only — no change: not a closed list of reasons.
  - `kernel/test/*.test.ts` hits — assertions on the existing reason — no change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/budget-agent-limits.test.ts` — AC2 second start refused `agent_sessions_at_once` | make the sessions-at-once check compare `live > limit` instead of `live >= limit` in `kernel/src/budget/internal.ts` (the second start is then admitted) |
| `kernel/test/budget-agent-limits.test.ts` — AC3 orphan counts as live | drop `'orphaned'` from the live-status list in the sessions-at-once count query in `kernel/src/budget/internal.ts` |
| `kernel/test/budget-agent-limits.test.ts` — AC6 invalid file refused | make the lookup map a `settings_invalid` result to "no limits" in `kernel/src/kernel.ts` |
| `kernel/test/budget-agent-limits.test.ts` — AC7 playbook fire parked | remove the sessions-at-once call from the agent slot of `PlaybookAdmission.check` in `kernel/src/budget/playbook.ts` |
| `kernel/test/agents-foundation.test.ts` — Wright `limits.tokens_per_day` / `sessions_at_once` now read | re-add `"limits"` to the Wright refusal field list in `kernel/src/agents/settings.ts` |
| `kernel/test/budget-agent-limits.test.ts` — AC1 tokens_per_day read from settings | make the agent token check use only the static `agentDailyTokenLimits` map, ignoring the `agentLimits` lookup, in `kernel/src/budget/internal.ts` |
| `kernel/test/budget-agent-limits.test.ts` — AC4 two same-tick starts admit exactly one | count live rows from a snapshot taken once at `Budget` construction instead of inside the admission transaction in `kernel/src/budget/internal.ts` |
| `kernel/test/budget-agent-limits.test.ts` — AC5 Wright limited | in the kernel's lookup in `kernel/src/kernel.ts`, return no limits when the agent is `wright` |
| `kernel/test/budget-agent-limits.test.ts` — AC8 resume refused by sessions-at-once, never by tokens | apply the sessions-at-once check to `start` only (or the token check to `resume` too) in `kernel/src/budget/internal.ts` |
| `kernel/test/budget-agent-limits.test.ts` — AC10 own row excluded on a retry | drop the `session: live.id` key from the `#parkIfRefused` request in `kernel/src/sessions/manager.ts` |
| `kernel/test/budget-agent-limits.test.ts` — AC10 orphan's own initial resume admitted | drop the `session: id` key from the `resumeSession` `#admit` request in `kernel/src/sessions/manager.ts` |
| `kernel/test/budget-agent-limits.test.ts` — AC11 non-crew label skips per-agent checks | map `agent_id_invalid` to a `settings_invalid` refusal in the lookup in `kernel/src/kernel.ts` |
| `kernel/test/budget-agent-limits.test.ts` — meter never throws on a settings refusal | let `BudgetMeter`'s limit check throw on a lookup refusal in `kernel/src/budget/meter.ts` |

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| budget | `kernel/src/budget/types.ts`, `kernel/src/budget/internal.ts`, `kernel/src/budget/admission.ts`, `kernel/src/budget/playbook.ts`, `kernel/src/budget/meter.ts`, `kernel/src/budget/index.ts` | — | HIGH |
| wiring | `kernel/src/kernel.ts`, `kernel/src/sessions/types.ts`, `kernel/src/sessions/manager.ts` (two request literals only) | — | HIGH |
| settings | `kernel/src/agents/settings.ts`, `kernel/src/brain/settings.ts` | — | HIGH |
| tests | `kernel/test/agents-foundation.test.ts` (Wright limits pin); `kernel/test/budget-admission.test.ts` (resume-request pins gain `session`); any `startKernel` test that starts a valid-grammar agent with no settings file gets a settings fixture in setup (worker greps and lists them) | `kernel/test/budget-agent-limits.test.ts` | MEDIUM |
| docs | `docs/architecture/budget.md` | — | HIGH |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Per-agent limits from settings, sessions-at-once admission, docs | all | 12 modify (+ test fixtures as needed), 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/test/budget-agent-limits.test.ts"}
  - {kind: "symbol", path: "kernel/src/budget/types.ts", name: "agentLimits"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "agent_sessions_at_once"}
  - {kind: "symbol", path: "kernel/src/budget/internal.ts", name: "agent_sessions_at_once"}
  - {kind: "symbol", path: "kernel/src/kernel.ts", name: "readAgentSettings"}
  - {kind: "symbol", path: "docs/architecture/budget.md", name: "agent_sessions_at_once"}
requires: []
lanes:
  - "kernel/src/budget/**"
  - "kernel/src/kernel.ts"
  - "kernel/src/agents/settings.ts"
  - "kernel/src/brain/settings.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/test/budget-agent-limits.test.ts"
  - "kernel/test/agents-foundation.test.ts"
  - "kernel/test/*.test.ts"
  - "kernel/test/budget-helpers.ts"
  - "docs/architecture/budget.md"
external_requires: []
```

### Design notes (binding on the worker)

1. **Lookup.** `BudgetOptions.agentLimits?: (agent: string) => AgentLimitsLookup`, where the lookup answers `{ ok: true, tokensPerDay?: number, sessionsAtOnce?: number }` or `{ ok: false, reason: "settings_invalid" | "settings_missing", file?: string, message: string }`. Read at every admission check (inside the transaction) and at every metered result, so an owner's edit takes effect at the next start. Absent ⇒ today's behaviour: the static `agentDailyTokenLimits` map, and no sessions-at-once check.
2. **Kernel wiring.** `kernel/src/kernel.ts` passes `agentLimits: (agent) => …readAgentSettings(dataDir, agent)…`, mapping `limits.tokens_per_day` / `limits.sessions_at_once` of an `ok` result. `settings_missing` refuses as `settings_missing`; `settings_invalid` refuses as `settings_invalid` (fail closed — never read as "no limit"). `agent_id_invalid` (a label that fails the crew-id grammar and is not `wright`) is NOT a refusal: OWNER DECISION 2026-10-18 ("No per-agent limits") — such a label cannot name a settings file, so it has no limits the owner could have set; every per-agent check is skipped as for a `null` agent (cap and playbook limits still apply). Documented as an honest limit in `budget.md`. `model_unset` is NOT a budget refusal (the file parsed and validated; a missing model is the session's concern — the brain and the manager already refuse it — and kernel tests start `wright` sessions on a fresh, model-less `wright.json`): `readAgentSettings` adds the parsed `limits` (when the file sets them) to its `model_unset` refusal as an optional `limits` key, and the lookup applies those. A `null` request agent skips every per-agent check (as today).
3. **Sessions at once.** Live = `sessions` rows of that agent with status `starting`, `running` or `orphaned`, counted in the SAME store transaction as the admit. The admit→row-insert window in `SessionManager.startSession` is synchronous (no `await` between `this.#admit(` and `this.#insertRow(params, loomwrightPath, sdkSessionId, "starting", at)`), so the count already includes every session this kernel admitted; AC4's test proves it. If the worker finds an `await` in that window, STOP and report it — do not edit `manager.ts`. Applies to `start` and `resume`. A `resume` request carries `session` (the id it resumes — OWNER DECISION 2026-10-18, "Allow manager.ts change"); that row is excluded from the live count, so a session's own automatic retry (its row is `starting`) or the initial resume of its own `orphaned` row never refuses itself. A `resume` request without `session` (a hand-built request) counts every live row (fail closed). `retryAt` = now + a named kernel constant (e.g. `SESSIONS_AT_ONCE_RECHECK_MS`, 60 s), so the event loop's `#park` uses it rather than its one-hour `DEFAULT_PARK_MS`. One `notify` (reason `agent_sessions_at_once`) for the first refusal per agent per hour; the `admission_refused` event every time (with `live`, `limit` and the live session ids; for an orphan, its id and the hint `studio session abandon <id>`).
4. **Order.** In `BudgetAdmission.check`: cap → settings refusal → agent daily limit (start only) → sessions at once. In `PlaybookAdmission.check`: the same three agent checks in the existing agent slot (step 4), after the playbook daily limit and the cap.
5. **Settings refusals** apply to start and resume, `retryAt: null` (the loop's default hourly recheck), one `notify` per agent per hour.
6. **Wright.** `readAgentSettings` accepts `limits.tokens_per_day` and `limits.sessions_at_once` in `wright.json`; `limits.delegation_depth`, `never` and `workspaces` stay refused for Wright with the existing message shape. Update the `agents-foundation` pin accordingly (limits removed from the refused list, a new case asserting the two accepted keys and the still-refused `delegation_depth`).
7. **Existing tests.** A kernel-composed test (`startKernel`) that starts a session for an agent with no settings file would now be refused `settings_missing`: give it a minimal valid settings fixture in setup; never weaken an assertion.

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
| Lifting Wright's `limits` refusal changes a pinned behaviour (Feasibility (Phase 2.5)) | MEDIUM | Lift it only for the two applied keys; keep `delegation_depth`, `never`, `workspaces` refused; update the pin in the same commit. |
| Fail-closed `settings_missing` refuses kernel-level tests that start an agent with no file | MEDIUM | Add a settings fixture to those tests' setup; run the full suite. |
| `orphaned` rows counting as live can block an agent until the owner abandons the orphan | LOW | Safe direction; the refusal names the orphan id and `studio session abandon`. The orphan's own resume is admitted (its row is excluded via `AdmissionRequest.session`). |
| Prior churn on `kernel/src/kernel.ts`, `kernel/src/budget/internal.ts`, `kernel/src/budget/types.ts` (Prior churn (postmortem ledger): self_heal_churn ×13, drain_churn ×5) | MEDIUM | Keep the diff small; run typecheck + full vitest before hand-back; document every new event and reason in `budget.md` in the same change. |
| The meter must not throw on a broken settings file | MEDIUM | The meter treats a lookup refusal as "no limit to record"; only admission refuses. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-18-token-limits-sessions-at-once-per-agent.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-18T10:25:44Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/86
- **Branch:** feature/04-token-limits-sessions-at-once
- **Files changed:** 17
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Per-agent tokens_per_day and sessions_at_once read from each agent's settings at every admission and metered result; new agent_sessions_at_once refusal (live = starting/running/orphaned, own row excluded on a resume via AdmissionRequest.session, 60 s recheck) and settings_invalid/settings_missing (fail closed); non-crew labels skip per-agent checks; Wright's limits accepted. Phase 4.5: iteration 1 PASS with one MEDIUM (an undocumented dry-run interaction) fixed docs-only in a0ed6fc; iteration 2 PASS, no findings. risk_classification: high_risk true (size, auth/token content, agents/ path). red_team_advisory: disabled.

## Not verified
- **A real crew playbook fire reaching agent_sessions_at_once** — crew playbooks are not routed yet (agent_not_routed), so it is covered via Budget.checkPlaybook and a stand-in loop handler (subtask 1)
- **CLI/status display of the new refusal reasons** — no CLI or API surface renders admission reasons (subtask 1)
