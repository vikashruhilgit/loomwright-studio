SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/budget/cap.ts"
invariants:
  - "Every cap_state row and every cap_* wake-up is keyed on the auth provider's stable id (this.#auth.id); the live account label is display text only (every event/notify payload carries account: <label> beside provider: <id>), so a relabel can neither lift a park nor start a second one. The session row's auth_account is never read."
  - "One real hit makes one park: a text-fallback hit while the provider has any unexpired park writes nothing; an assistant error rate_limit with no cap text while parked is not transient."
  - "Fail closed (AC4): an allowed/allowed_warning never clears or shortens an unexpired park (utilization refreshed only, recorded as cap_allowed_while_parked); a rejected with unknown reset or a known reset not later than the park's end keeps the park; notify fires once per window."
  - "The one exception to 'an unexpired park only ever extends': a text_fallback park whose reset_source is 'recheck' is a guess, so a rejected event with a known reset replaces it in the same transaction even when earlier (owner decision 2026-10-05). A text_fallback row holding a known window (reset_source != recheck) is never shortened."
  - "Whether a park is a re-check guess is read from reset_source = 'recheck', never inferred from the rate_limit_type name; TEXT_FALLBACK_TYPE is reserved, so an event whose rateLimitType equals 'text_fallback' (or is absent/empty) is stored as UNKNOWN_LIMIT_TYPE and never writes or extends the text_fallback row."
  - "Every cap wake-up is scheduled via scheduleCapWakeup, so at most one cap_* wake-up is pending per provider and limit type; a cap_* wake-up means 'ask admission again', never 'the park ended'."
  - "A rejected event with resets_at already at or before now is treated as an unknown reset (re-checked after CAP_RECHECK_MS), so admission never admits on a capped provider."
  - "CapTracker only records; admission (BudgetAdmission) reads the parks."
dependencies:
  - "kernel/src/budget/internal.ts"
  - "kernel/src/budget/types.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/store/migrations/009_cap_keys_provider_id.ts"
  - "@anthropic-ai/claude-agent-sdk"
behavioral_specs:
  - "Text fallback (error result errors[], is_error success result text, or assistant error text starting with a USAGE_LIMIT_ERROR_PREFIXES entry) with no unexpired park: upserts a text_fallback row (status rejected, resets_at now+CAP_RECHECK_MS, reset_source recheck), appends cap_text_fallback, one notify (resets_at null, recheck_at set), and one cap_recheck:<id>:text_fallback wake-up."
  - "rate_limit_event rejected with a new or extended window: upserts the typed row, appends cap_rejected, one notify, and schedules cap_reset:<id>:<type> (known reset) or cap_recheck:<id>:<type> (unknown), superseding the earlier pending wake-up of that type."
  - "rejected with no unexpired park of its own type while an unexpired text_fallback recheck park stands: known reset => typed row inserted, text_fallback row deleted, one cap_park_superseded event {replaced, notified}, a notify only when the known reset is later than the re-check time, and a cap_reset wake-up that also supersedes the text_fallback wake-ups; unknown reset => text_fallback park stands and one cap_park_merged event is appended (no row, notify or wake-up)."
  - "allowed_warning appends one cap_warning per window (warned_resets_at, 'unknown' when no reset)."
  - "Malformed rate_limit_info => cap_event_ignored {reason: no_rate_limit_info | unknown_status}."
  - "Transient (assistant error rate_limit, no cap text, not parked) => one cap_transient event with attempt number and backoffMs hint, no park."
incident_history:
  - {date: "2026-10-05T01:45:00Z", kind: self_heal_fix, summary: "self-heal fixed 1 issue(s) in kernel/src/budget/cap.ts", source: "53058ecd-5cba-4796-a71a-6fb922c1e275"}
provenance:
  derived_from: "e3abd74 (git diff origin/main...HEAD on feature/hardening-h05-budget-cap-park-keys)"
  written_at: "2026-10-05T01:45:00Z"
  source: "53058ecd-5cba-4796-a71a-6fb922c1e275"
