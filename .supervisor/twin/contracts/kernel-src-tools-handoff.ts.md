SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/tools/handoff.ts"
invariants:
  - "Handoff notes are inspectable markdown under the Studio data dir (invariant 8) at <dataDir>/memory/<agentDir>/handoffs/<taskName>.md."
  - "agentDir is the agent id only when it matches AGENT_DIR_PATTERN (no separator, no leading dot, <=64 chars) else HandoffPathError; a session with no agent uses _unassigned. No path traversal is possible."
  - "taskName is the positive-integer task id, or session-<id> when the session has no task; non-positive or unsafe ids throw HandoffPathError."
  - "writeFileAtomic writes a 0600 temp file in the same directory (dirs created 0700) and renames it over the target, so a reader never sees a torn file; the temp file is removed on failure; rewriting the same content is idempotent."
dependencies: []
behavioral_specs:
  - "renderHandoff emits a '# Handoff' header with Agent, Task, Session and Written lines, a '---' rule, then the handoff text verbatim, ending with exactly one trailing newline."
provenance:
  derived_from: "a03facf63cf82f37698883bdf26dfa1465d181df (git diff origin/main...a03facf)"
  written_at: "2026-10-02T11:45:00Z"
  source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"
