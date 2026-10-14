SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/auth/provider-env.ts"
invariants:
  - "Leaf module with no imports: the CLI-loaded launchd plist writer must be able to import it without loading the Agent SDK."
  - "Single source of the STUDIO_AUTH_PROVIDER check: kernel.ts and service/launchd.ts both use authProviderFromEnv, so the plist carries the variable exactly when the kernel would honour it."
  - "authProviderFromEnv returns undefined when the value is unset, empty or whitespace-only; otherwise it returns the value unchanged (not trimmed)."
dependencies: []
behavioral_specs:
  - "Exports AUTH_PROVIDER_ENV = \"STUDIO_AUTH_PROVIDER\" and authProviderFromEnv(env)."
incident_history:
  - {date: "2026-10-03T03:01:18Z", kind: self_heal_fix, summary: "self-heal fixed 2 issue(s) in kernel/src/auth/provider-env.ts", source: "2a862f5f-b84e-4eea-9b81-4865d87034c0"}
provenance:
  derived_from: "b4edca817a656f07ee61918f1b28e6d1cf28cf60 (git diff origin/main...b4edca8)"
  written_at: "2026-10-03T03:01:18Z"
  source: "2a862f5f-b84e-4eea-9b81-4865d87034c0"
