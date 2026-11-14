# 22c — Jira's capabilities read from a live Jira connection

## Status: proposed

**As** the owner of Loomwright Studio,
**I want** Jira's grant capabilities ("Read tickets", "Comment on tickets", and so on) built from the tool names a live Jira connection actually lists,
**so that** ticking a Jira capability grants the tools Jira really has, and a mismatch is found before I rely on it.

## Why

Phase 8 item 21b (PR #278, merged 2026-11-14) added a per-tracker capability list, `MCP_TRACKER_CAPABILITIES` in `kernel/src/integrations/mcp/trackers.ts`. ClickUp's list was built from a read-only probe of its live `tools/list` (67 tools; [evidence](../../../docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md)). Jira's was authored without a live connection and `docs/OPEN_QUESTIONS.md` marks it NEEDS VERIFICATION. Capabilities match by exact tool name against the connection's own list, so a wrong name can only shrink a grant (a capability ticked but holding fewer tools), never widen one: the risk is a member that can't do what its ticked capability says.

**Proposed, not ready (owner, 2026-11-14):** the owner's Studio store has no Jira connection (only ClickUp). This item waits until Jira is connected in Integrations; then mark it `ready`.

## Acceptance Criteria

**Happy path:**
- [ ] **AC1.** Given a connected Jira connection, when its stored `tools/list` is read (read-only), then every tool name in Jira's capability list is checked against it and the result is recorded: names present, names absent, and listed tools no capability covers.
- [ ] **AC2.** Given names that are absent or misplaced, then `MCP_TRACKER_CAPABILITIES` for Jira is corrected to the live names, and a capability whose tools are all absent is removed or named as unavailable.
- [ ] **AC3.** Given the corrected list, when the owner opens a member's Jira row in Team, then each capability reads granted, not granted or partly granted against the live names, and the uncovered tools fold under one line, as for ClickUp.

**Error scenarios:**
- [ ] **AC4.** Given the Jira connection is absent or expired at the walk, then nothing is changed and the evidence says so.

## Non-goals

- ClickUp's mapping (probed live in 21b; its sign-off is the owner's).
- New capabilities beyond what Jira lists.

## Owner decisions

- 2026-11-14: written as proposed, because no Jira connection exists in the owner's store.

## Priority: Nice-to-have

**Rationale:** no Jira connection is in use; a wrong name only shrinks a grant.

## Assumptions

- Jira's MCP server lists its tools with stable names, as ClickUp's does.

## Dependencies

- Depends on: a Jira connection in Integrations (the owner's step).

## Risks

- Jira's server may differ per site or plan; the evidence records which.

## Success Metrics

- The Jira line in `docs/OPEN_QUESTIONS.md` resolved with evidence.

## Handoff

- Mark `## Status: ready` once Jira is connected, then run it with `/automate`.

## Validation (must pass before merge)
1. **Static — kernel suite and docs:** `cd kernel && npm ci && npm test`, with the capability test updated to the live names; `bash scripts/check-docs.sh`.
2. **Running system — a live Jira tools/list:** the read-only probe of the connected Jira connection, its names and the mapping recorded in `docs/evidence/phase-8-22c-jira-capabilities.md`, ending with `Verdict: PASS for Validation 2`.

## Depends on
none

## Touches
kernel/src/integrations/mcp/trackers.ts
kernel/test/integrations-mcp-trackers.test.ts
docs/OPEN_QUESTIONS.md
docs/evidence/phase-8-22c-jira-capabilities.md
