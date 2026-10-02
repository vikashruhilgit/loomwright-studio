# 06: Budget meter and subscription-cap handling

## Status: ready

**Priority:** MVP

## Story

As the owner, I want every session's token use metered and the subscription cap detected from the SDK's structured signal, so that agents stop at my limits and pause cleanly at the cap instead of failing or retrying (D17, D24, D26, D28).

## Acceptance criteria

1. **Given** a session's `result` message, **when** it arrives, **then** the meter records `result.modelUsage` per model: input, output, cache-creation and cache-read tokens, thinking tokens, and `costUSD` as the "≈" estimate.
   - **The value is cumulative for the SDK session, across resumes** (Q3 plus `probes/p7-resume-usage.mjs`: this held both after a clean resume and after an abort mid tool call). So the meter stores the last total it saw per session and adds only the **delta** to `budget`, attributed to the day the result arrived. That keeps a session that runs past midnight split correctly.
   - If a new total is **lower** than the stored one, the transcript saved no totals (the SDK's "when it has one" case). Treat the new total as a fresh baseline and add it in full, and log the event.
   - Per-message usage is never used: it under-reports output (Q3) and double-counts when one call streams as several messages (p7).
   - Known limit, documented in code: a `kill -9` in the middle of a model call's stream can lose that one call's tokens.
2. **Given** the counted total (input + output + cache writes; cache reads shown but **not** counted, per D26), **when** an agent's tokens for the day reach its limit (config, per agent), **then** the kernel refuses new sessions for that agent, parks the triggering event, and emits a notify event. A running session is allowed to finish its current turn.
3. **Given** a `rate_limit_event`, **when** it arrives, **then** `cap_state` is updated for the session's auth account with `status`, `rateLimitType`, `resetsAt` (epoch **seconds**) and utilization. `unifiedWindows` is recorded if present, noting its 0–1 scale.
4. **Given** `status: 'rejected'`, **when** it's recorded, **then** the kernel:
   - parks all new work for that account until `resetsAt`;
   - lets no session on that account start;
   - emits one notify event;
   - schedules a wake-up at `resetsAt`.

   A bare `error: 'rate_limit'` on an assistant message, without a `rejected` event, is treated as transient: retry with backoff and don't park (Q6).
5. **Given** `status: 'allowed_warning'`, **when** it's recorded, **then** a single warning event is emitted per window per account.
6. **Given** a text-only failure whose message starts with one of the SDK's exported `USAGE_LIMIT_ERROR_PREFIXES`, **when** no event arrived, **then** the kernel treats it as a cap hit for that account, with an unknown reset (park and re-check hourly).
7. **Given** the D28 API-key fallback, **when** it's **not** enabled (always the case in phase 1, since there are no playbooks yet), **then** nothing switches provider. The mechanism has a config flag and a dollar ceiling field, defaulting off, plus a unit test that it stays off.
8. Studio never rotates across subscriptions (D28); there is only one subscription account.
9. Tests replay recorded message shapes, including the probe outputs of `p3` and `p6` saved as fixtures (tokens redacted).

## Out of scope

The experimental `usage_EXPERIMENTAL…` quota readout (display-only, a later phase; it may be empty on the token's `user:inference` scope). A budget UI.

## Dependencies

03, 05.

## Risks

The `rejected` shape has never been observed live (Q6). Code defensively around it, and log the full event on first sight so it can be recorded.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-02T09:26:59Z
- **Brief:** .supervisor/jobs/done/2026-10-02-06-budget-meter-and-cap.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/15
