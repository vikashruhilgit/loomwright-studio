# 20g — The ClickUp ticket reader calls a tool ClickUp actually has

**As** the owner, **I want** a ClickUp ticket playbook to read my tasks, **so that** ClickUp tickets become PRs like GitHub issues do.

## Why

the phase 8 exit live run of 2026-11-12 (commit `cfb3d428`, service pid 51124, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live): playbook 8's dry runs 155 and 157 failed `tool_unavailable` (by list name, then by list id `901422761392`), with ClickUp connected. Root cause: `kernel/src/integrations/mcp/trackers.ts` line 50 calls `get_workspace_tasks`, marked "NEEDS VERIFICATION" in the same file; the connected ClickUp server's tool list (`mcp_connections.granted_tools`) has no such tool. It has `clickup_filter_tasks`, `clickup_search` and `clickup_get_task`.

## Acceptance Criteria
- [ ] AC1: A probe against the owner's personal ClickUp records the real tool name, its input (list, tags) and its response shape; the result is recorded in `docs/OPEN_QUESTIONS.md` and the NEEDS VERIFICATION notes are removed.
- [ ] AC2: The `clickup.tasks` poll and its dry run call that tool and map its response to ticket items (ref, title, body, link, revision).
- [ ] AC3: A missing tool still answers `tool_unavailable`, now naming the tool and the connector so the owner knows what to reconnect.
- [ ] AC4: The Jira definition's tool name is checked the same way or marked `not_exercised` explicitly (Jira stays the owner's work account; never connect it).

## Validation (must pass before merge)
1. **Static:** `cd kernel && npm test`.
2. **Running system:** a ClickUp ticket playbook's dry run lists the task "Add a README to studio-sandbox" (tag `studio-sandbox`). Record it in `docs/evidence/phase-8-20g-clickup-reader.md` with `Verdict: PASS for Validation 2`.

## Depends on
none

## Touches
kernel/src/integrations/mcp/trackers.ts
kernel/test/integrations-mcp-trackers.test.ts
docs/OPEN_QUESTIONS.md
docs/architecture/mcp-connectors.md
docs/evidence/phase-8-20g-clickup-reader.md
