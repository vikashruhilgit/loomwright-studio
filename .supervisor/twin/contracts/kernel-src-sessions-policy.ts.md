SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/sessions/policy.ts"
invariants:
  - "decideToolUse is pure (no I/O) and deny by default."
  - "Bash is gated only by allowedBashPrefixes: Bash in allowedTools never allows arbitrary commands."
  - "A Bash command is denied when it is not a string or contains any of ; & | < > ( ) $ backtick newline carriage-return, before prefix matching."
  - "A prefix matches only on equality or prefix followed by a space; empty or whitespace-only prefixes are ignored."
  - "The kernel adds no blocklist for programs that run other programs (find, xargs, env, git, npx, npm, sed, awk, sh, bash); allowing such a prefix is the user's decision to allow whatever it can run (invariant 1)."
  - "toolInput is untrusted data: inspected only, never executed or interpolated."
dependencies:
  - "kernel/src/sessions/types.ts"
behavioral_specs:
  - "Any non-Bash tool is allowed only when its exact name is in allowedTools (tool_allowed / tool_not_allowed)."
  - "Decision reasons: bash_command_not_string, bash_shell_metacharacter, bash_prefix_allowed, bash_prefix_not_allowed."
  - "freezePolicy returns a frozen defensive copy of both arrays."
provenance:
  derived_from: "c044695c2032cc2b2e598d20fab41d2facb41142 (git diff origin/main...c044695)"
  written_at: "2026-10-04T17:15:00Z"
  source: "6ba5be39-ea98-45b3-ae38-b44676e0e3ce"
