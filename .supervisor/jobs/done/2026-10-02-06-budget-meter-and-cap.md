# Supervisor Job: Budget meter and subscription-cap handling

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariants 1, 2, 3 and 9 apply directly)
- **Git:** dirty only with the automate engine's own trail files (`.supervisor/automate/*`, `.supervisor/postmortem/results.jsonl`, `.supervisor/requirements/phase-1/05-session-manager.md`, `.supervisor/jobs/done/2026-10-02-05-session-manager.md`, `.supervisor/requirements/proposed/*`) — never stage them in this job; commit with explicit paths only. Branch: main @ 5f6b778
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0
- **Blockers:** 0 | **Warnings:** 1 (dirty trail files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1/06-budget-meter-and-cap.md
- **Base commit:** 5f6b778712df89d0cae624673b36e0e5ee96c2e9

## Feasibility
- **Verdict:** CAUTION
- Tech stack — GO: TypeScript kernel, `better-sqlite3`, `@anthropic-ai/claude-agent-sdk` 0.3.284 already pinned; every message type the meter reads (`SDKResultMessage.modelUsage`, `SDKRateLimitEvent`, `SDKAssistantMessageError`) is in `sdk.d.ts`.
- Dependencies — GO: no new package. `USAGE_LIMIT_ERROR_PREFIXES` is a runtime export of the pinned SDK (checked at planning time: `import("@anthropic-ai/claude-agent-sdk")` gives an array of 12 strings, first `"You've hit your"`).
- Architecture fit — GO: `SessionManagerOptions.onMessage` (item 05) already delivers every SDK message of every session, and an observer that throws is recorded as `observer_error` without breaking the session. The `budget`, `cap_state` and `wakeups` tables exist (migration 1).
- Scope — GO: one worker; 7 modified + 13 created files.
- Hard blockers — CAUTION: the probe outputs of `p3`/`p6` were never saved as files (`probes/` holds only the scripts); fixtures must be rebuilt from the values recorded in `docs/OPEN_QUESTIONS.md` and the SDK types. The `rejected` event has never been observed live (Q6).

## Task
**Goal:** Meter every session's token use from `result.modelUsage` (cumulative per SDK session, recorded as deltas per day), enforce per-agent daily token limits at session admission, and detect the subscription cap from the SDK's structured `rate_limit_event` (with the `USAGE_LIMIT_ERROR_PREFIXES` text fallback), parking the account until reset instead of failing or retrying — D17, D24, D26, D28. Mechanism only (invariant 1): limits come from config the user sets; no limit is invented.

## Acceptance Criteria
- [ ] AC1 — Given a session's `result` message, when it arrives, then the meter records `result.modelUsage` per model (input, output, cache-creation, cache-read, thinking tokens, `costUSD` as the "≈" estimate). The stored figure is cumulative per SDK session across resumes, so the meter keeps the last totals per session (`sessions.model_usage_json`) and adds only the **delta** to `budget`, attributed to the day the result arrived. A new total **lower** than the stored one is a fresh baseline: added in full and logged as an event. Per-message usage is never read. The `kill -9`-mid-stream limit is documented in code.
- [ ] AC2 — Given the counted total (input + output + cache writes; cache reads shown, not counted — D26), when an agent's tokens for the day reach its configured limit, then the kernel refuses new sessions for that agent, the refusal carries the time to retry (the "park" handed to the caller), and one `notify` event is emitted. A running session finishes its current turn.
- [ ] AC3 — Given a `rate_limit_event`, when it arrives, then `cap_state` for the session's auth account is updated with `status`, `rateLimitType`, `resetsAt` (epoch **seconds**, stored as ISO text) and utilization; `unifiedWindows` is stored when present, with its 0–1 scale noted.
- [ ] AC4 — Given `status: 'rejected'`, when recorded, then all new work on that account is refused until `resetsAt` (no session on that account starts or resumes), one `notify` event is emitted per rejection window, and a wake-up is scheduled at `resetsAt`. A bare `error: 'rate_limit'` on an assistant message without a `rejected` event is transient: no park, recorded with a backoff hint.
- [ ] AC5 — Given `status: 'allowed_warning'`, when recorded, then exactly one warning event is emitted per window per account.
- [ ] AC6 — Given a text-only failure whose message starts with one of the SDK's `USAGE_LIMIT_ERROR_PREFIXES`, when no `rejected` event arrived for that session, then it is a cap hit for that account with an unknown reset: parked, re-checked hourly.
- [ ] AC7 — Given the default config, when the cap is hit, then nothing switches provider: the D28 API-key fallback mechanism exists as a config flag plus a dollar-ceiling field, both defaulting off; nothing switches provider when it is off, and a unit test proves it stays off.
- [ ] AC8 — Given a cap refusal, when admission is checked, then no other subscription is tried — no rotation: the kernel has one auth provider/account; a cap refusal never selects another.
- [ ] AC9 — Given the test suite, when it runs, then tests replay recorded message shapes, including the `p3` result and `p6` rate-limit event saved as fixtures (ids redacted).

## Implementation Notes (verified at planning time)

**Files read:** `kernel/src/store/migrations/001_initial.ts` (`budget` has a generated `counted_tokens = input + output + cache_write`; `cap_state` PK `(account, rate_limit_type)` with `status`, `resets_at TEXT`; `wakeups(due_at, reason, task_id, status)`; `sessions.model_usage_json` exists for the stored totals), `kernel/src/sessions/manager.ts` (`#observe` calls `options.onMessage` for every message; `startSession`/`resumeSession` validate params before any row; `#appendNotify` writes `notify` events with `provider`/`account`), `kernel/src/sessions/types.ts` (`SessionManagerOptions.onMessage`, `SessionErrorCode`), `kernel/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` (`ModelUsage`: `inputTokens`, `outputTokens`, `thinkingTokens?` — **already counted inside `outputTokens`**, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD`; `SDKRateLimitInfo.status: 'allowed'|'allowed_warning'|'rejected'`, `resetsAt?: number`, `rateLimitType?` optional, `utilization?`; result doc: "Crash/startup-error results may carry zeroed values"), `docs/OPEN_QUESTIONS.md` Q3/Q6/p7, `docs/DECISIONS.md` D17/D24/D26/D28, `docs/ARCHITECTURE.md` §Data model.

**Design (the worker may refine names, not behaviour):**

1. **`kernel/src/budget/` module** (replaces the `export {}` stub):
   - `types.ts` — `BudgetConfig { agentDailyTokenLimits: Readonly<Record<string, number>>; apiKeyFallback: ApiKeyFallbackPolicy }` with `ApiKeyFallbackPolicy { enabled: boolean; dollarCeilingUsd: number | null }` and `DEFAULT_BUDGET_CONFIG` (no agent limits, fallback `{ enabled: false, dollarCeilingUsd: null }`). **D28 makes the fallback a per-playbook opt-in**; `ApiKeyFallbackPolicy` is the shape a playbook will carry in phase 3. Phase 1 has no playbooks, so the only instance is this kernel-wide placeholder, always off by default; the code comment and `docs/ARCHITECTURE.md` say that once playbooks exist the policy is read per playbook and the kernel-wide value is never consulted. Validate at construction: limits are positive integers; ceiling is null or a positive finite number. **An agent with no configured limit has no token limit** (invariant 1 — the kernel never invents a limit); the cap still applies to it.
   - `meter.ts` — `BudgetMeter.observe(sessionId, message)`: acts only on `type: "result"`. Reads the session row (`agent`, `model_usage_json`), and per model key: if every component of the new total is ≥ the stored one, the delta is recorded; otherwise the new total is a fresh baseline, added in full, plus one `budget_baseline_reset` event. A result whose `modelUsage` is empty or all-zero is **ignored** (no baseline reset, one `budget_usage_ignored` event) — the SDK documents zeroed crash results, and resetting the baseline to 0 would double-count the next real total. Model keys missing from a new result keep their stored totals. One transaction: insert one `budget` row per model with a non-zero delta (`day`, `session_id`, `agent`, `model`, tokens, `thinking_tokens`, `cost_usd` = delta of `costUSD`), and update `sessions.model_usage_json` with the merged totals. Day = local calendar day `YYYY-MM-DD` of the injected clock (`deps.now`, `deps.dayOf`). After recording, if the agent has a configured limit and its counted total for the day is ≥ the limit and no `budget_limit_reached` event exists yet for `(agent, day)`, append `budget_limit_reached` plus one `notify` event. The running session is not touched (AC2).
   - `cap.ts` — `CapTracker.observe(sessionId, message)`, keyed on the session row's `auth_account`:
     - `rate_limit_event` (fields read from `message.rate_limit_info.*` — `status`, `rateLimitType`, `resetsAt`, `utilization`, and the untyped `rate_limit_info.unifiedWindows`; the p6 fixtures use the same nesting): upsert `cap_state` (`rate_limit_type` = `rateLimitType ?? "unknown"`; `resets_at` = ISO of `resetsAt * 1000` when finite, else null; `utilization`; `unified_windows_json` = `JSON.stringify` of the value when present — `unifiedWindows` is **not in `sdk.d.ts`** (observed live only, OPEN_QUESTIONS Q6), so it is parsed defensively: any shape is stored verbatim, a non-serializable or odd value never throws, and nothing reads fields out of it). Window identity = `(account, rate_limit_type, resets_at)`.
     - `rejected` → once per window (`notified_resets_at` column): one `cap_rejected` event with the full event payload (Q6: log on first sight), one `notify`, and a `wakeups` row (`reason` `cap_reset:<account>`, `due_at` = `resets_at`), not duplicated. A `rejected` event with no usable `resetsAt` is handled as the unknown-reset case below.
     - `allowed_warning` → once per window (`warned_resets_at` column): one `cap_warning` event.
     - `allowed` → status updated; nothing else.
     - **Precedence and dedupe across cap signals (one hit, one park):** for each message the tracker first checks for a usage-limit prefix (text fallback below); a prefix match wins and the message is NOT also classified transient. One real hit can arrive as an assistant `error: "rate_limit"` message carrying cap text AND an `is_error` success result with the same text — a text-fallback hit while the account already has an unexpired `text_fallback` park records nothing new (no second `notify`, no second wake-up, `resets_at` not moved), and a text-fallback hit while an unexpired `rejected` event park exists for the account is likewise a no-op.
     - Assistant message with `error: "rate_limit"`, no usage-limit prefix in its text, and no `rejected` recorded for that session → one `cap_transient` event with `backoffMs` from an exported pure `transientBackoffMs(attempt)`; no `cap_state` park. (Retrying belongs to the caller / item 07; the CLI's own `api_retry` also retries.)
     - Text fallback — three prefix sources, each tested: (a) an error `result`'s `errors[]` entries; (b) a `subtype: "success"` result with `is_error: true` and a string `result` (`SDKResultSuccess` carries failures that way, sdk.d.ts:5668ff); (c) the text content of an assistant message with `error` set. When one of them starts with a `USAGE_LIMIT_ERROR_PREFIXES` entry (imported from the SDK at runtime), when no `rejected` event was recorded for that session → `cap_state` row `rate_limit_type = "text_fallback"`, `status = "rejected"`, `resets_at` = now + 1 h, `reset_source = "recheck"`; one `notify`; a `cap_recheck:<account>` wake-up at that time. When the recheck time passes, admission lets work try again, and a new hit re-parks for another hour ("re-check hourly").
   - `admission.ts` — `BudgetAdmission.check({ kind: "start" | "resume", agent: string | null, account, task? })` (`AdmissionRequest.agent` is nullable because `SessionRow.agent` is; a null agent skips the agent-limit check, the cap check still applies) → `{ admitted: true } | { admitted: false; reason: "cap_parked" | "agent_daily_limit"; retryAt: string | null }`. Cap: any `cap_state` row for the account with `status = "rejected"` and `resets_at` null or in the future refuses both kinds (`retryAt` = latest `resets_at`). Agent limit: refuses `start` only (resume continues existing work), `retryAt` = start of the next local day. Each refusal appends one `admission_refused` event (agent, account, task, reason, retryAt) — the durable "parked" record item 07's loop consumes. The `notify` for a refusal is deduped with the AC2/AC4 notify (once per agent-day / per cap window). `apiKeyFallbackActive(config)` returns `config.apiKeyFallback.enabled && dollarCeilingUsd > 0`; nothing in phase 1 switches provider on it (no playbooks), and a refusal never changes the auth provider (AC7, AC8).
   - `index.ts` — exports the above plus a convenience `Budget` facade with one `observe(sessionId, message)` (meter + cap) and `check(req)`.
2. **Session manager wiring (narrow):** add optional `SessionManagerOptions.admission?: (req: AdmissionRequest) => AdmissionDecision` and the request/decision types in `kernel/src/sessions/types.ts` (the budget module imports these types — no import cycle). In `startSession` it runs after parameter validation and **before** the auth env build, any row insert or spawn (`kind: "start"`, `params.agent`, the provider's `account`, `params.task`). In `resumeSession` it runs after the row read and the resumability checks (the `not_found`/`not_resumable`/missing-model checks, manager.ts ~510–520) and **before** `#checkGroup`/`#markRow` (~523–540) and the env build (`kind: "resume"`, `row.agent`, the provider's account, `row.task_id`) — so a refused resume mutates nothing: the row's status (including `orphaned`) and its events are unchanged. A refusal throws a new `AdmissionRefusedError extends SessionError` (code `admission_refused` added to `SessionErrorCode`; readonly `reason`, `retryAt`), exported from `sessions/index.ts`; the existing `SessionError(code, message)` constructor is untouched. Absent option ⇒ byte-identical behaviour (all existing tests unchanged).
3. **Migration 6** (`kernel/src/store/migrations/006_budget_cap_details.ts`, appended to the list): `budget.thinking_tokens INTEGER NOT NULL DEFAULT 0`; `cap_state.utilization REAL`, `cap_state.unified_windows_json TEXT`, `cap_state.reset_source TEXT` (`event` | `recheck`), `cap_state.notified_resets_at TEXT`, `cap_state.warned_resets_at TEXT`. Shipped migrations are never edited.
4. **Fixtures (AC9):** `kernel/test/fixtures/sdk/` with `p3-result.json` (a `result` message **reconstructed** from figures `docs/OPEN_QUESTIONS.md` records from different sources: `inputTokens` 955 is the recorded `modelUsage` figure; cache creation 7,788 and cache read 48,986 are the recorded `result.usage` sums; output 281 is the result's output figure; `costUSD` 0.0229 is the recorded `total_cost_usd` — so it is a plausible stitched shape, not a captured `modelUsage` entry), `p6-rate-limit-event.json` (`status: allowed`, `rateLimitType: five_hour`, `resetsAt: 1790698800`, `utilization`, `unifiedWindows` five_hour 0.01 / seven_day 0.07), plus synthesized `rejected` and `allowed_warning` variants, `p6-rate-limit-rejected.json`, `p6-rate-limit-warning.json`, and a `README.md` stating per field which recorded figure it came from (modelUsage vs `result.usage` vs `total_cost_usd`), that raw probe outputs were never saved, that session ids/uuids are redacted, that `unifiedWindows` is untyped (observed live, absent from `sdk.d.ts`), and that the `rejected`/`allowed_warning` variants are synthesized from `sdk.d.ts` and never seen live.
5. **Docs:** `docs/ARCHITECTURE.md` §Data model rows for `budget` (thinking tokens, delta-per-day rule, ignored zeroed results) and `cap_state` (utilization, unified windows 0–1, reset source, once-per-window notify/warning dedupe).

**Tests (`kernel/test/budget-*.test.ts`, no real SDK, no model calls):** meter delta across two results and a resume; fresh baseline on a lower total (+ event); zeroed result ignored; day split across midnight with an injected clock; multi-model results; agent limit reached → one notify, second crossing same day → no second notify; admission refuses `start` for a limited agent but not `resume`; cap `rejected` → refuse start and resume until `resetsAt`, one notify, one wake-up at `resetsAt` (seconds → ISO), repeated identical event → no second notify/wake-up; `allowed_warning` once per window; transient `rate_limit` → no park; text fallback (each of the three prefix sources, including a success-typed `is_error` result) → park 1 h + recheck wake-up, then admitted after the hour; text fallback suppressed when a `rejected` event already arrived; one hit delivered as both an assistant `rate_limit` message with cap text and an `is_error` success result → exactly one park, one `notify`, one wake-up, no `cap_transient`; fallback config default off and validation; `SessionManager` with `admission` refuses a start before any row or spawn (fake `query`/`spawn` never called), refuses a resume of an `orphaned` and of an `interrupted` row leaving the row's status and its `events` unchanged (no `#markRow`), throws `AdmissionRefusedError` with `reason`/`retryAt`, and without the option behaves as before; migration 6 columns (update `kernel/test/store.test.ts` default-list assertion).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Budget meter, cap tracker, admission gate, migration 6, session-manager admission hook, fixtures, tests, docs | AC 1–9 | 7 modify, 13 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1 — budget meter and cap handling (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/budget/index.ts"}
  - {kind: "file", path: "kernel/src/budget/types.ts"}
  - {kind: "file", path: "kernel/src/budget/meter.ts"}
  - {kind: "file", path: "kernel/src/budget/cap.ts"}
  - {kind: "file", path: "kernel/src/budget/admission.ts"}
  - {kind: "file", path: "kernel/src/store/migrations/006_budget_cap_details.ts"}
  - {kind: "file", path: "kernel/test/budget-meter.test.ts"}
  - {kind: "file", path: "kernel/test/budget-cap.test.ts"}
  - {kind: "file", path: "kernel/test/budget-admission.test.ts"}
  - {kind: "file", path: "kernel/test/fixtures/sdk/p3-result.json"}
  - {kind: "file", path: "kernel/test/fixtures/sdk/p6-rate-limit-event.json"}
  - {kind: "file", path: "kernel/test/fixtures/sdk/p6-rate-limit-rejected.json"}
  - {kind: "file", path: "kernel/test/fixtures/sdk/p6-rate-limit-warning.json"}
  - {kind: "file", path: "kernel/test/fixtures/sdk/README.md"}
  - {kind: "symbol", path: "kernel/src/budget/meter.ts", name: "BudgetMeter"}
  - {kind: "symbol", path: "kernel/src/budget/cap.ts", name: "CapTracker"}
  - {kind: "symbol", path: "kernel/src/budget/admission.ts", name: "BudgetAdmission"}
  - {kind: "symbol", path: "kernel/src/budget/types.ts", name: "DEFAULT_BUDGET_CONFIG"}
  - {kind: "type", path: "kernel/src/budget/types.ts", name: "BudgetConfig"}
  - {kind: "type", path: "kernel/src/sessions/types.ts", name: "AdmissionDecision"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "AdmissionRefusedError"}
  - {kind: "type", path: "kernel/src/budget/types.ts", name: "ApiKeyFallbackPolicy"}
requires: []
lanes:
  - "kernel/src/budget/**"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/index.ts"
  - "kernel/src/store/migrations/**"
  - "kernel/test/**"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "@anthropic-ai/claude-agent-sdk 0.3.284 runtime export USAGE_LIMIT_ERROR_PREFIXES (verified present at planning time)"
```

Modified files: `kernel/src/budget/index.ts` (was `export {}`), `kernel/src/store/migrations/index.ts` (append migration 6), `kernel/src/sessions/manager.ts` (admission call in `startSession`/`resumeSession` only), `kernel/src/sessions/types.ts` (admission types, `admission_refused` error code, `AdmissionRefusedError`), `kernel/src/sessions/index.ts` (export the new types), `kernel/test/store.test.ts` (default-list assertion gains migration 6 and its columns), `docs/ARCHITECTURE.md`. No `package.json`/`package-lock.json` change.

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
- `skills/unit-testing/SKILL.md` — vitest, injected clock, fake `query`/`spawn` as in `kernel/test/sessions.test.ts`
- `skills/error-handling/SKILL.md` — fail-closed admission, observer errors never break a session

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| The `rejected` event shape has never been observed live (Q6) | HIGH | MEDIUM | Code to `sdk.d.ts`; treat a missing/non-finite `resetsAt` as unknown reset (hourly recheck); log the full event payload in `cap_rejected` on first sight | Requirement |
| p3/p6 raw outputs were never saved; fixtures are rebuilt from recorded values | MEDIUM | HIGH | Fixture `README.md` states provenance; values match `docs/OPEN_QUESTIONS.md` exactly; shapes follow `sdk.d.ts` | Feasibility (Phase 2.5) |
| A zeroed crash/startup-error result would reset the baseline and double-count the next total | HIGH | MEDIUM | Ignore empty/all-zero `modelUsage` (event recorded), test it | SDK `sdk.d.ts` result doc |
| `thinkingTokens` is already inside `outputTokens`; adding it to counted tokens would double-count | MEDIUM | MEDIUM | Store it in its own column, never in `counted_tokens` | SDK `sdk.d.ts` `ModelUsage` |
| Session-manager regression (item 05 was heavily reviewed) | HIGH | LOW | Admission is one optional call before any side effect; absent option ⇒ unchanged; whole existing suite must stay green | Phase 3 |
| "Park the triggering event" (AC2) and "retry with backoff" (AC4 transient) need the event loop (item 07) | MEDIUM | HIGH | 06 supplies the refusal with `retryAt`, a durable `admission_refused` event, and a `cap_transient` event with `backoffMs`; item 07 owns re-dispatching from them. Named in code comments and in the PR body as item 07's follow-up | Phase 3 / Plan Review |
| Day boundary semantics (local vs UTC) | LOW | MEDIUM | Local calendar day of the kernel host, injected `dayOf` for tests; documented in `docs/ARCHITECTURE.md` | Phase 3 |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-02-06-budget-meter-and-cap.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-02T09:26:59Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/15
- **Branch:** feature/phase1-06-budget-meter-and-cap
- **Files changed:** 22
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** kernel/src/budget/ — BudgetMeter (result.modelUsage deltas of cumulative per-SDK-session totals per local day; fresh baseline on a lower total; zeroed results ignored; thinking tokens recorded, never counted; one limit notify per agent-day), CapTracker (rate_limit_event → cap_state with range-checked resetsAt; parks only extend; one notify + wake-up per window; allowed_warning once per window; USAGE_LIMIT_ERROR_PREFIXES text fallback with an hourly re-check; bare rate_limit transient), BudgetAdmission (refuses start/resume on a parked account, starts for an agent at its daily limit, keyed on the provider's live account), SessionManager admission hook on start, resume and every resume retry (AdmissionRefusedError, refused retry parks as interrupted); migration 6; p3/p6 fixtures with provenance. Self-heal FAIL→fix 30523b6→FAIL→fix 04ff9ef→PASS (5 HIGH fixed: resume retries bypassed admission, out-of-range resetsAt read as expired, prototype-key limit lookups, unknown-reset rejected shortened a park, park/admission keyed on different account labels); no rubric; red_team_advisory: disabled; 3 MEDIUM/LOW dismissed for owner decision.

## Not verified
- **live SDK rate_limit_event with status rejected** — never observed live (OPEN_QUESTIONS Q6); coded to sdk.d.ts with synthesized fixtures (subtask 1)
- **real p3/p6 probe output shapes** — raw probe outputs were never saved; fixtures rebuilt from recorded figures (subtask 1)
