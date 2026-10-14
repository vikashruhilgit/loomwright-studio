SYSTEM_CONTRACT:
schema_version: 1
subsystem: "kernel/src/tools/server.ts"
invariants:
  - "Generic mechanisms only (invariant 1): no task-state vocabulary, priority or policy is built in; task state is free text the caller chooses."
  - "Tool input is untrusted data (invariant 3): every handler validates args with zod itself and every validation/domain error is returned as an isError result; no handler rejects or throws through the SDK."
  - "The server is named 'kernel'; full tool names are mcp__kernel__<name>; the kernel never adds them to a ToolPolicy (the user's allowedTools must list them)."
  - "Creating tools (task_create, schedule_wakeup, request_stop, and task_update when given a key) run as work steps keyed <tool>:session-<sessionId>:<idempotency_key>; a repeat in the same session row (including after resume/restart) returns the first result even if other args differ; other sessions are not deduplicated against it."
  - "kernel_task_update builds SET clauses only from a fixed column list, never from input, and requires at least one field."
  - "kernel_request_stop resolves the handoff path before the step (a refused agent id never burns the key), runs as a rerunnable async step (atomic note rewrite + stop_requested recorded once per session+path), then schedules stopSession out of band (never awaited inside the session's own tool call); a failed stop is recorded as stop_failed."
  - "createKernelMcpServer returns a fresh server per call because an SDK server instance holds a live connection and cannot be reused."
dependencies:
  - "kernel/src/loop/internal.ts"
  - "kernel/src/loop/steps.ts"
  - "kernel/src/loop/wakeups.ts"
  - "kernel/src/tools/handoff.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/store/store.ts"
  - "kernel/src/version.ts"
behavioral_specs:
  - "Exposes exactly six tools: kernel_task_create, kernel_task_update, kernel_task_list, kernel_task_get, kernel_schedule_wakeup, kernel_request_stop."
  - "kernel_task_create checks parent_task_id exists and normalizes next_check_at; task_created / task_updated audit rows are appended."
  - "kernel_task_list filters by state, assignee_agent, parent_task_id in id order with limit 1-200 (default 50)."
  - "kernelToolHandlers exposes the handlers as plain functions so tests call them without a model."
provenance:
  derived_from: "a03facf63cf82f37698883bdf26dfa1465d181df (git diff origin/main...a03facf)"
  written_at: "2026-10-02T11:45:00Z"
  source: "8a6f1ee7-355c-4c1a-a0dc-016f0a4229a9"
