SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/budget/admission.ts"
invariants:
  - "Parks are checked on the auth provider's stable id (activeParks(store, this.#auth.id, at)), the same key CapTracker parks under; the account label is never compared, so a relabel neither lifts a park nor refuses a request."
  - "A request whose provider differs from the budget's auth provider id is a wiring error: the check throws inside the transaction, so the request fails closed (no admission)."
  - "Fails closed: a store error propagates and the session manager refuses the request with it."
  - "Any unexpired park (cap_state rejected with resets_at null or ahead) refuses starts and resumes alike; the park ends only when this check admits, never because a cap_* wake-up fired."
  - "The agent daily token limit refuses starts only (a resume continues existing work); one auth provider, so a refusal never rotates to another (no rotation, AC8/D28)."
dependencies:
  - "kernel/src/budget/internal.ts"
  - "kernel/src/budget/types.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/store/store.ts"
behavioral_specs:
  - "Cap refusal => {admitted: false, reason: cap_parked, retryAt}, where retryAt is null when any active park has an unknown reset, else the latest resets_at; details carry rate_limit_types."
  - "Agent-limit refusal => {admitted: false, reason: agent_daily_limit, retryAt: start of the next budget day}."
  - "Every refusal appends one admission_refused event with kind, agent, account (label), provider (id), task, reason and retry_at."
provenance:
  derived_from: "e3abd74 (git diff origin/main...HEAD on feature/hardening-h05-budget-cap-park-keys)"
  written_at: "2026-10-05T01:45:00Z"
  source: "53058ecd-5cba-4796-a71a-6fb922c1e275"
