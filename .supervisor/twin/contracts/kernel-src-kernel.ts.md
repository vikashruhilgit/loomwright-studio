SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/kernel.ts"
invariants:
  - "SCOPE NOTE: derived from the item-09 diff only (handlers option, provider-env extraction)."
  - "Invariant 1 (mechanism only): the shipped daemon (daemon.ts) never passes KernelOptions.handlers, so the EventLoop runs with {} and every queued event ends event_unhandled; handlers exist only for non-daemon compositions such as the crash-test harness."
  - "Auth provider precedence: options.authProviderId (non-empty), else authProviderFromEnv(env), else the build default from availableProviderIds."
  - "AUTH_PROVIDER_ENV is re-exported from auth/provider-env.ts, not redefined, so kernel and plist writer share one definition."
  - "The EventLoop is started only while the kill switch is NOT engaged."
dependencies:
  - "kernel/src/auth/provider-env.ts"
  - "kernel/src/loop/loop.ts"
  - "kernel/src/loop/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/api/server.ts"
behavioral_specs:
  - "startKernel(options, deps) composes store, auth, budget, sessions (reapOrphans), EventLoop with options.handlers ?? {}, API token, API server, then <dataDir>/api.json (mode 0600, no token); stop is in reverse."
incident_history:
  - {date: "2026-10-03T03:01:18Z", kind: self_heal_fix, summary: "self-heal fixed 2 issue(s) in kernel/src/kernel.ts", source: "2a862f5f-b84e-4eea-9b81-4865d87034c0"}
provenance:
  derived_from: "b4edca817a656f07ee61918f1b28e6d1cf28cf60 (git diff origin/main...b4edca8)"
  written_at: "2026-10-03T03:01:18Z"
  source: "2a862f5f-b84e-4eea-9b81-4865d87034c0"
