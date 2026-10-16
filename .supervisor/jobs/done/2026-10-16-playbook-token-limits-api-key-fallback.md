# Supervisor Job: Per-playbook daily token limits and per-playbook API-key fallback in the budget module

## Environment
- **Project:** loomwright-studio (lane clone L5)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-3/2026-10-16-092906-token-limits-and-api-key-fallback-per-playbook.md
- **Base commit:** a60340ca29d550cf1aa4e2ab127a19fdc4577d8b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + better-sqlite3 + vitest, all present in `kernel/package.json` |
| 2 | Dependency Availability | GO | No new dependency; migration 13 already added `playbooks.token_limit_per_day`, `playbooks.api_key_fallback_json`, `sessions.playbook`; `budget.playbook` exists since migration 1 |
| 3 | Architecture Fit | CAUTION | The session manager's admission hook (`AdmissionRequest` in `kernel/src/sessions/types.ts`) carries no playbook and the manager launches every session on its one auth provider. Wiring the playbook gate into the manager, and launching a fallback session on the API-key provider, needs `kernel/src/sessions/manager.ts` (item 03's file in this wave) — out of scope here by the requirement's own Risk rule |
| 4 | Scope vs Supervisor Capability | GO | ~8 files, one module + one test + one doc: single subtask |
| 5 | Hard Blockers | GO | None |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the kernel's budget module meter tokens per playbook, refuse a playbook's new session once its daily token limit is reached (parked to the next local day, notified once per playbook per day), and decide per playbook whether a session at the subscription cap may continue on the API-key provider (opt-in under a dollar ceiling) — all inside `kernel/src/budget/`, without editing the session manager.

**Problem Statement:**
The owner needs each playbook to have its own daily token limit and its own API-key fallback choice because one runaway playbook must not spend the day's tokens and only the playbooks he chooses may ever cost money.
Currently, the meter counts tokens per session, agent and day only (`budget.playbook` exists but is never written), and the D28 fallback reads only the kernel-wide placeholder `BudgetConfig.apiKeyFallback`. This causes no per-playbook bound and no per-playbook fallback.
Success looks like: a playbook session's counted usage lands on that playbook's daily total; a playbook at its limit is refused with a next-local-midnight retry and exactly one notification per playbook-day; at the cap, a playbook that opted in under its ceiling is admitted on the API-key provider and one that did not waits; a session without a playbook behaves exactly as today.

## Acceptance Criteria
- [ ] AC1 — Given a session row whose `sessions.playbook` is set and a `result` message whose `modelUsage` reports 1,000 input + 200 output + 300 cache-write + 5,000 cache-read tokens, when the meter observes it, then the budget row it writes carries that playbook (`budget.playbook`) and the playbook's counted total for that budget day reads 1,500 (D26: cache reads never count).
- [ ] AC2 — Given a playbook whose counted tokens today equal its `token_limit_per_day` (the test sets counted == limit exactly), when its session start is checked through the playbook gate, then it is refused (`playbook_daily_limit`) with `retryAt` = the start of the next budget day, one `admission_refused` event is appended, and one `playbook_limit_reached` event plus one `notify` event are recorded; a second check the same day records no second `playbook_limit_reached` / `notify` (it still refuses and still appends its own `admission_refused`).
- [ ] AC3 — Given the subscription provider parked at its cap (an unexpired `cap_state` `rejected` row) and a playbook whose `api_key_fallback_json` is `{"enabled":true,"dollarCeilingUsd":N}` with its API-key spend below N, when its session start is checked, then the gate admits it with `provider` = the API-key provider's id; given a playbook that does not opt in (no policy, `enabled:false`, `dollarCeilingUsd:null`, unparseable JSON), or whose spend equals its ceiling (the test sets spend == ceiling exactly), then it is refused `cap_parked` with the park's retry time (it waits for the reset); and given the cap parked, the playbook opted in under its ceiling, but its agent at its configured daily token limit, a start is refused `agent_daily_limit` (a fallback admit never skips the agent limit).
- [ ] AC4 — Given a request with no playbook (`playbook: null`) at the cap, on a Budget built with the kernel-wide placeholder ACTIVE (`apiKeyFallback: {enabled: true, dollarCeilingUsd: 50}`) and an API-key provider identity, when it is checked through the playbook gate, then a refusal and the events appended match `BudgetAdmission.check` byte-for-byte, and an admit equals `{ admitted: true, provider: <subscription provider id> }` (at the cap: refused `cap_parked`; the kernel-wide `apiKeyFallback` placeholder is the only fallback policy in scope and, as today, never switches provider), and the existing `Budget.check` / `budget.observe` wiring in `kernel/src/kernel.ts` is unchanged.
- [ ] AC5 — Given playbook sessions metered today, when `playbookTokensToday(store, day)` (exported from `kernel/src/budget/index.ts`) is called, then it returns one entry per playbook with usage that day: playbook id, slug, counted tokens and its `token_limit_per_day` (or `null`).
- [ ] AC6 — Tests in `kernel/test/budget-playbook.test.ts` (stubbed providers, no real key, no real SDK) cover AC1–AC5; `cd kernel && npm ci && npm run typecheck && npm test` passes and `bash scripts/check-docs.sh` prints `check-docs: OK`.
- [ ] AC7 — `docs/architecture/budget.md` (today a 3-line placeholder) describes per-playbook metering, admission (limit, park to the next local day, once-per-playbook-day notify), the API-key fallback decision (opt-in, ceiling, how spend is measured, what is NOT wired yet: the session manager does not call the playbook gate nor launch on the API-key provider — needs item 03's `manager.ts` / item 08's fire path), and that `studio status` shows no per-playbook line yet because the budget module has no status hook (the data is available through `playbookTokensToday`).

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Touched-file invariants

> Grounded at base `a60340ca29d550cf1aa4e2ab127a19fdc4577d8b`. The worker re-checks these before hand-back.

- **`kernel/src/budget/meter.ts`** — keep: only `result` messages are metered (`if (message.type !== "result") return;`), all writes inside one `this.#store.transaction(`, a zeroed/empty `modelUsage` is ignored with `budget_usage_ignored`, the delta-against-stored-totals logic (`MONOTONIC_KEYS`) unchanged; reuse: the agent-limit idiom `#checkLimit(` / `noteAgentLimitReached(` for the playbook limit (once per playbook-day, deduped by an events lookup); mirror: the `INSERT INTO budget (day, session_id, agent, model,` column list must gain `playbook` (TEXT column from `kernel/src/store/migrations/001_initial.ts`: `playbook           TEXT,`), written as the session row's `sessions.playbook` id or NULL; pinned by: `kernel/test/budget-meter.test.ts` (it inserts sessions through `insertSession(` from `kernel/test/budget-helpers.ts`).
- **`kernel/src/budget/admission.ts`** — keep: `check()` behaviour and its events byte-for-byte (AC4), the fail-closed provider check (`refusing (fail closed)`), one `admission_refused` event per refusal via `#refuse(`, the exported `apiKeyFallbackActive` (re-exported by `index.ts`); the playbook gate may reuse `activeParks(` and `agentCountedTokens(` from `internal.ts`; pinned by: `kernel/test/budget-admission.test.ts`.
- **`kernel/src/budget/types.ts`** — keep: `validateBudgetConfig` returns a frozen copy and rejects bad values with `BudgetConfigError`; null-prototype records (`emptyRecord`); the `ApiKeyFallbackPolicy` shape (`dollarCeilingUsd: number | null`) is the shape `playbooks.api_key_fallback_json` stores (migration 13 doc: `api_key_fallback_json` (the `ApiKeyFallbackPolicy` shape in `src/budget/types.ts`)); any new `BudgetOptions` field (for example the API-key provider identity) is optional so `new Budget({ store, authProvider }, { now })` in `kernel/src/kernel.ts` still compiles unchanged.
- **`kernel/src/budget/index.ts`** — keep: `readonly check = (request: AdmissionRequest): AdmissionDecision => this.admission.check(request);` and `readonly observe =` (bound, wired by `kernel.ts` as `onMessage: budget.observe` / `admission: budget.check`); new exports are additive.
- **`kernel/src/budget/internal.ts`** — keep: `noteAgentLimitReached` once-per-agent-day semantics (`SELECT 1 FROM events WHERE kind = 'budget_limit_reached'`); a playbook variant is a new helper, not a change to this one; `appendNotify` payload shape (`provider`, `account` first).

## Closed enumerations touched

> Sibling grep at base `a60340c`: `grep -rnF 'agent_daily_limit' --exclude=CHANGELOG.md kernel/src kernel/test` → 13 hits in 6 files.

- **`playbook_daily_limit`** (sibling: `agent_daily_limit`) — must be named in:
  - `kernel/src/budget/playbook.ts` (new) — the playbook gate's own refusal-reason union — create.
  - `kernel/src/sessions/types.ts` — `export type AdmissionRefusalReason = "cap_parked" | "agent_daily_limit";` — no change: the session manager's union is the manager's admission contract; the playbook gate returns its own decision type in `kernel/src/budget/`, and extending the manager union belongs with the manager wiring (item 03/08), which this item does not do.
  - `kernel/src/budget/admission.ts` — `reason: "cap_parked" | "agent_daily_limit",` in `#refuse` — no change unless the worker routes playbook refusals through `#refuse`; if it does, extend it there.
  - `kernel/src/budget/internal.ts`, `kernel/test/*` — the agent-limit notify payload and its tests — no change.
- New event kinds `playbook_limit_reached` (sibling `budget_limit_reached`) and an API-key-fallback admission event (e.g. `api_key_fallback_admitted`): `events.kind` is free TEXT with no closed list in code or SQL (`grep -rnF 'budget_limit_reached' kernel/src docs` hits only `budget/meter.ts` and `budget/internal.ts`) — documented in `docs/architecture/budget.md` only.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/budget-playbook.test.ts` — AC1 playbook total 1,500 | drop the `playbook` value from the meter's `INSERT INTO budget` (write NULL) in `kernel/src/budget/meter.ts` |
| `kernel/test/budget-playbook.test.ts` — AC2 refusal at the limit | flip the limit comparison `>=` to `>` in the playbook gate in `kernel/src/budget/playbook.ts` |
| `kernel/test/budget-playbook.test.ts` — AC2 one notify per playbook-day | delete the events-lookup dedupe in the playbook limit helper |
| `kernel/test/budget-playbook.test.ts` — AC3 opt-in admitted on the API-key provider | flip the fallback decision to always refuse `cap_parked` in `kernel/src/budget/playbook.ts` |
| `kernel/test/budget-playbook.test.ts` — AC3 spend ≥ ceiling waits | flip the ceiling comparison `<` to `<=` (or drop the spend check) in `kernel/src/budget/playbook.ts` |
| `kernel/test/budget-playbook.test.ts` — AC3 agent at its limit at the cap still refused | move the agent-limit check below the fallback admit's early return in `kernel/src/budget/playbook.ts` |
| `kernel/test/budget-playbook.test.ts` — AC3 non-opt-in policies wait | treat unparseable or invalid `api_key_fallback_json` (or a null ceiling) as enabled in the fallback-policy parser in `kernel/src/budget/playbook.ts` |
| `kernel/test/budget-playbook.test.ts` — AC5 `playbookTokensToday` counted total | sum `input_tokens + output_tokens` instead of `counted_tokens` (drop cache writes) in `playbookTokensToday` in `kernel/src/budget/playbook.ts` |
| `kernel/test/budget-playbook.test.ts` — AC4 no-playbook request matches `check()` | make the no-playbook path read the kernel-wide placeholder and admit on the API-key provider when `apiKeyFallbackActive(config)` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Per-playbook metering, daily-limit admission, API-key fallback decision, status read, tests and doc | all | 5-6 modify (admission.ts conditional), 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| budget | `kernel/src/budget/meter.ts`, `kernel/src/budget/index.ts`, `kernel/src/budget/types.ts`, `kernel/src/budget/internal.ts` | `kernel/src/budget/playbook.ts` | HIGH |
| budget (maybe) | `kernel/src/budget/admission.ts` (only if the gate reuses its private refusal path) | — | MEDIUM |
| tests | — | `kernel/test/budget-playbook.test.ts` | HIGH |
| docs | `docs/architecture/budget.md` | — | HIGH |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/budget/playbook.ts"}
  - {kind: "symbol", path: "kernel/src/budget/index.ts", name: "playbookTokensToday"}
  - {kind: "file", path: "kernel/test/budget-playbook.test.ts"}
  - {kind: "symbol", path: "docs/architecture/budget.md", name: "API-key fallback"}
requires: []
lanes:
  - "kernel/src/budget/**"
  - "kernel/test/budget-playbook.test.ts"
  - "docs/architecture/budget.md"
external_requires: []
```

### Design notes for the worker (binding unless the code proves one wrong — then say so in the hand-back)

1. **Metering (AC1).** In the meter's transaction, read `sessions.playbook` with the row it already reads (`SELECT agent, task_id, model_usage_json FROM sessions WHERE id = ?` gains `playbook`) and write it into `budget.playbook` (the column is TEXT: store `String(id)`, NULL when unset). After recording, when the session has a playbook whose `token_limit_per_day` is set and its counted tokens for the day reach it, record `playbook_limit_reached` + one `notify` once per playbook-day (same idiom as `noteAgentLimitReached`). Agent metering and the agent limit stay as they are (a playbook session counts toward its agent AND its playbook AND the day).
2. **Playbook gate (AC2–AC4).** A new class/function in `kernel/src/budget/playbook.ts`, exposed on `Budget` as a bound method (for example `readonly checkPlaybook = (request) => …`), taking the `AdmissionRequest` fields plus `playbook: number | null`. Its decision type is its own: `{ admitted: true; provider: string } | { admitted: false; reason: "cap_parked" | "agent_daily_limit" | "playbook_daily_limit"; retryAt: string | null }`. One store transaction. Order: provider fail-closed check (as `check()`); `playbook === null` ⇒ return exactly `this.admission.check(request)`'s verdict (admitted ⇒ `provider` = the subscription provider's id) and nothing else; else an unknown playbook id ⇒ throw (fail closed); `start` with the playbook at its daily limit ⇒ refuse `playbook_daily_limit` (retry at next budget day); the cap: an active park ⇒ admit on the API-key provider only when the playbook's own fallback policy is enabled with a positive ceiling, an API-key provider identity was given to the Budget, and its API-key spend is below the ceiling — otherwise refuse `cap_parked` exactly as `check()` does; then the agent limit as `check()` does (start only) — fallback eligibility never returns early: the decision admits on the API-key provider only after the agent-limit check also passes, else it refuses `agent_daily_limit`. The kernel-wide `config.apiKeyFallback` is never read on the playbook path. Every refusal appends one `admission_refused` event carrying the playbook id.
3. **Fallback policy parsing.** Parse `playbooks.api_key_fallback_json` into `ApiKeyFallbackPolicy` with the same rules as `validateBudgetConfig`'s `apiKeyFallback` branch; NULL or unparseable or invalid ⇒ fallback off (fail closed toward waiting, never toward spending).
4. **API-key spend — conservative overcount.** The schema has no per-session provider key (`sessions.auth_account` is a display label the budget module never reads — `kernel/src/budget/types.ts`: "The session row's `auth_account` is never read" stays true (that doc line wraps after "row's" — match across the wrap); label matching would undercount after a relabel and fail toward spending). So the spend the ceiling is compared with = `SUM(budget.cost_usd)` over ALL of the playbook's budget rows (subscription sessions' list-price estimates included). This can only overcount, so it fails toward waiting, never toward spending past the hard ceiling (invariant 3). Period: all time, never resets (D28 names no period). State in the doc and the hand-back: both choices are owner-decision notes, and an exact figure needs a stable provider key on the session or budget row — a migration, a follow-up outside this item's Touches.
5. **Status (AC5).** `playbookTokensToday(store, day)` — a read helper exported from `index.ts`. Do NOT edit `kernel/src/api/server.ts` or `kernel/src/cli/index.ts` (phase 1 code, no budget status hook exists): say so in the hand-back.
6. **Do not edit** `kernel/src/sessions/manager.ts`, `kernel/src/sessions/types.ts`, `kernel/src/kernel.ts`, `kernel/src/playbooks/**` or any migration. If a criterion cannot be met without one of them, stop that criterion and say so in the hand-back (the requirement's Risk rule: item 03 owns `manager.ts` in this wave).
7. Tests use `kernel/test/budget-helpers.ts` (`testEnv`, `insertSession`, `events`, `AUTH`) on UTC days, insert `playbooks` rows directly (slug, name, owning_agent, intent) and set `sessions.playbook` directly on the row (the requirement's Assumption: item 08 sets it later). A stub API-key identity such as `{ id: "api-key", account: "api-key" }`; no real key, no Keychain, no real SDK.

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
| Feasibility (Phase 2.5): the session manager does not pass a playbook to admission nor launch on a second provider, so the gate is a budget-module mechanism the fire path (item 08) and `manager.ts` (item 03) must call later; AC3's "its session uses the API-key provider" is met as the gate's decision, not an observed launch | MEDIUM | Design note 6: no manager/types edit; the doc and PR body name the wiring gap and the owning items explicitly |
| API-key spend has no exact per-provider source in the schema | MEDIUM | Design note 4: count ALL of the playbook's `cost_usd` (overcount only ⇒ fails toward waiting, never past the ceiling); no label is read; exact attribution (a provider key via migration) named as a follow-up |
| Ceiling period (all time) is an assumption D28 does not settle | LOW | Doc + hand-back flag it for the owner; reversible |
| Changing the meter's INSERT could break existing meter tests | MEDIUM | Keep column order additive; run the full `npm test` |
| `check()` behaviour drift for playbook-less requests | HIGH | AC4 test compares the gate against `check()` on a twin store; `check()` itself unchanged |

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-16-playbook-token-limits-api-key-fallback.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-16T10:42:59Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/68
- **Branch:** feature/06-playbook-token-limits-api-key-fallback
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Per-playbook metering (budget.playbook), PlaybookAdmission gate (daily limit park + once-per-day notify; D28 API-key fallback admit only when opted in, under ceiling, agent limit ok; null playbook == check()), api_key_ceiling_reached record, playbookTokensToday, shared admission helpers, 32 tests, budget.md + one OPEN_QUESTIONS entry. Review: iter1 FAIL (ceiling admission-only HIGH, duplicated logic, missing tests) fixed; iter2 PASS + MEDIUM doc tracking fixed; iter3 PASS clean. Not wired into sessions/manager.ts (items 03/08).

## Not verified
- **session manager launching a playbook session on the API-key provider / refusing at the playbook limit** — not wired: manager.ts and sessions/types.ts are out of scope (items 03/08); the gate's decision is unit-tested only (subtask 1)
- **studio status per-playbook line** — no budget status hook in api/cli, which are out of scope; data exposed via playbookTokensToday (subtask 1)
