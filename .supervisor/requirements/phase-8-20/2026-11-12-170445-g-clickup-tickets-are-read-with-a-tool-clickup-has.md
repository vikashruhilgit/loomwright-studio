# 20g — ClickUp tickets are read with a tool ClickUp actually has

**As** the owner of Loomwright Studio,
**I want** a ClickUp ticket playbook to read the tasks on my list,
**so that** ClickUp tickets become PRs the way GitHub issues do.

## Why

In the phase 8 exit live run, 2026-11-12 (commit `cfb3d428`, crew member `studio-sandbox-dev` from approval 29, playbook 7 v3 live; sessions 125, 126, 129), playbook 8's dry runs 155 and 157 failed `tool_unavailable` (by list name, then by list id `901422761392`) with ClickUp connected.
- **Cause:** `kernel/src/integrations/mcp/trackers.ts` line 50 calls `get_workspace_tasks`, which the same file marks "NEEDS VERIFICATION".
- **What ClickUp actually has:** the connected server's tool list (`mcp_connections.granted_tools`) has no tool by that name. It does have `clickup_filter_tasks`, `clickup_search` and `clickup_get_task`.

## Acceptance Criteria

**Happy path:**
- [ ] Given the owner's personal ClickUp, when a probe runs, then the real tool name, its input (list, tags) and its response shape are recorded in `docs/OPEN_QUESTIONS.md`, and the NEEDS VERIFICATION notes are removed.
- [ ] Given a `clickup.tasks` poll for a list and a tag, when it or its dry run fires, then it calls that tool and maps each task to a ticket item (ref, title, body, link, revision).

**Error scenarios:**
- [ ] Given the tool is missing, then the refusal is still `tool_unavailable` and names the tool and the connector, so the owner knows what to reconnect.

**Edge cases:**
- [ ] Given Jira, then its tool name is checked the same way, or marked `not_exercised` explicitly. Jira stays the owner's work account and is never connected.

## Non-goals
- Naming the playbook's target repository (20h).

## Owner decisions
- 2026-11-12: Proceed anyway at PO-ASSUME; this story starts with the probe.

## Priority: MVP
**Rationale:** The phase 8 walk's ClickUp ticket cannot run without it.

## Assumptions
- The probe is read-only against the owner's personal ClickUp (never the work account).

## Dependencies
- Depends on: none

## Risks
- ClickUp's MCP server may change tool names again; the refusal naming the tool makes that visible.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test`, including the trackers tests.
2. **Running system — a ClickUp dry run lists the task:** a ClickUp ticket playbook's dry run lists "Add a README to studio-sandbox" (tag `studio-sandbox`). Record it in `docs/evidence/phase-8-20g-clickup-reader.md` with `Verdict: PASS for Validation 2`.

## Depends on
none

## Touches
kernel/src/integrations/mcp/trackers.ts
kernel/test/integrations-mcp-trackers.test.ts
docs/OPEN_QUESTIONS.md
docs/architecture/mcp-connectors.md
docs/evidence/phase-8-20g-clickup-reader.md

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-12-clickup-tickets-read-with-real-tool.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-13T11:17:46Z
- **Brief:** .supervisor/jobs/done/2026-11-12-clickup-tickets-read-with-real-tool.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/271
