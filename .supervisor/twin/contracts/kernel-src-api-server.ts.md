SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/api/server.ts"
invariants:
  - "Binds 127.0.0.1 only (API_HOST is a constant); every request is authenticated with the bearer token before any routing, including the abandon path."
  - "Mechanism only (invariant 1): it reports state, pulls the kill switch and carries the owner's abandon of an unverifiable orphan, nothing more."
  - "POST /sessions/<id>/abandon only calls sessions.abandonSession(id, {via}); the API itself never signals or probes a process group."
  - "via is cli only when the x-studio-client header equals cli, otherwise api; the header only labels an already-authenticated caller."
  - "Error bodies for abandon carry only the stable SessionError code, never the message; a non-SessionError rethrows."
  - "The POST routes (stop-all, resume, abandon) run one at a time, in arrival order."
  - "GET /status's orphaned field lists every orphaned row with its latest orphaning reason (orphanedSessions); it is additive, so an older CLI ignores it."
  - "GET /status cap_state is grouped by the stored key (cap_state.account, which holds the auth provider id since migration 9); each entry carries provider: <stored key> (additive, an older CLI ignores it) and account: the live label of the provider whose id equals the key (read via safeAccount, which swallows a throwing account getter), falling back to the stored key itself when no provider claims it or the label is unreadable."
dependencies:
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/sessions/orphans.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/api/kill-switch.ts"
  - "kernel/src/loop/loop.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/auth/types.ts"
  - "kernel/src/budget/index.ts"
  - "kernel/src/store/migrations/009_cap_keys_provider_id.ts"
behavioral_specs:
  - "A path exactly /sessions/<digits>/abandon with a method other than POST => 405 with Allow: POST."
  - "An id that is not a safe positive integer => 400 {error: invalid_id}; not_found => 404 {error: not_found}; any other refusal => 409 {error: <code>}; success => 200 {id, status: abandoned}."
  - "ApiServerOptions.sessions is Pick<SessionManager, 'stopAll' | 'abandonSession'>."
  - "readStatus returns cap_state as [{account, provider, limits: [{rate_limit_type, status, resets_at, utilization, reset_source}]}], ordered by stored key then rate_limit_type."
provenance:
  derived_from: "e3abd74 (git diff origin/main...HEAD on feature/hardening-h05-budget-cap-park-keys)"
  written_at: "2026-10-05T01:45:00Z"
  source: "53058ecd-5cba-4796-a71a-6fb922c1e275"
