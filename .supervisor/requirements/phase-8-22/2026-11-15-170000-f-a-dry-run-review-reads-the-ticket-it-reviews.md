# 22f — A dry-run review reads the ticket it reviews

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/285

**Ready (2026-11-15):** every line cited below was read on `main` `787c00f6`. The owner chose option A on 2026-11-15 (see Owner decisions).

**As** the owner of Loomwright Studio,
**I want** the dry-run review of a ClickUp or Jira poll playbook to read the ticket it reviews whenever the crew member holds that tracker's read grant,
**so that** the dry run I check before each ticket playbook's enable (exit runbook, walk step 1) is built from the ticket, not from its title and status.

## Why

22a's Finding 1 (`docs/evidence/phase-8-22a-wave-1-walk-on-main.md`): runs 189, 193 and 195 recorded `mcp__kernel__kernel_mcp_r_clickup_clickup_get_task` denied `tool_not_allowed`. The finding put that down to the dry run's fixed read-only set. The code shows the denial happens one step earlier, and that two separate gates refuse the call.

**Gate 1, the member's policy (the observed denial).** The session gate calls `decideToolUse(live.policy, ...)` first (`kernel/src/sessions/manager.ts:2755`). For any tool but Bash it allows only a name in `policy.allowedTools` (`kernel/src/sessions/policy.ts:88-90`). A crew dry run's policy is the member's settings policy as written (`kernel/src/playbooks/dry-run.ts:459`, passed at `:649`). The 22a member's `allowedTools` was `["Read"]` (22a evidence, line 57). A policy deny makes `classifyDryRunCall` answer `as_real_run` (`kernel/src/sessions/dry-run.ts:144`), so the dry-run rail is never asked. `docs/architecture/mcp-connectors.md:186` states the rule ("a session may call one only if its `allowedTools` also names it"). Real playbook runs (`kernel/src/playbooks/runs.ts:674`) and chat sessions (`kernel/src/brain/handler.ts:336`) pass the same settings policy, and `#sessionPolicy` (`manager.ts:3065-3076`) adds only `mode`, `connectors` and `githubWrite`. Nothing an owner does writes a proxy name into `allowedTools`: `studio agents set ... connectors clickup:<tools>` and the card's "Choose access" write `connectors` only (22a events 24057), and a charter can't carry a tracker grant. So a member the inspector shows as holding "Read tickets" (`holdsConnector`, `kernel/src/features/catalogue.ts:361`) is refused that tool in every session today.

**Gate 2, the dry-run rail (the next block).** With gate 1 open, `isDryRunReadOnly` (`dry-run.ts:85-91`) admits only `DRY_RUN_READ_ONLY_TOOLS`, `DRY_RUN_GITHUB_READ_TOOLS` and the kernel's `_list` / `_get` names (`KERNEL_READ_TOOL`, `:36`). A `kernel_mcp_r_` name is none of these, so the call is recorded `would_do` with reason `dry_run` and does not run.

Both were reproduced on `main` `787c00f6` with a throwaway vitest case over the pure functions (not committed): policy `allowedTools: ["Read"]` gives `deny / tool_not_allowed` and `as_real_run`. A policy naming the proxy gives `allow` and rail `ordinary`, then `would_do / dry_run`.

The session is offered the tool. `toolsForConnectors` (`kernel/src/integrations/tool-filter.ts:40`) lists a proxy only when its kind is in the member's connectors and the owner's per-tool grant names its server tool. Names come from the connector row: `kernel_mcp_r_<kind>_<tool>` only for a tool the server hinted `readOnlyHint: true` (`kernel/src/integrations/mcp/tools.ts:160`). The rail treats every other `kernel_mcp_` name as the outward `mcp_write` (`policy.ts:543-545`). A poll review runs `forceDraft` (`playbooks/dry-run.ts:652`), so an outward call there is drafted, never sent.

The kernel adds the mechanism: the owner's per-tool grant becomes the session's permission for exactly the proxy tools it lists, and the dry run lets the read ones run. The owner keeps the policy: which tools to grant, per member and per tool (D38).

## Acceptance Criteria

**Happy path:**
- [ ] **AC1.** Given a crew member whose settings grant `clickup` tools that include a read-only one (stored proxy `kernel_mcp_r_clickup_<tool>`), whose `tool_policy.allowedTools` does not name that proxy, and a `clickup.tasks` poll playbook, when its dry-run review session calls `mcp__kernel__kernel_mcp_r_clickup_<tool>`, then the decision is `allow`, the call reaches the (fake) server, and no would-do entry is recorded. This case fails on today's `main` (`tool_not_allowed`).
- [ ] **AC2.** Given the same member, when a real playbook run session or a chat session calls the same proxy, then it is allowed too. The dry run and the real run of one member never disagree on a read proxy.
- [ ] **AC3.** AC1 and AC2 hold for `jira` with a fake MCP server. Jira is never exercised live.

**Edge cases:**
- [ ] **AC4.** Given a granted write proxy (`kernel_mcp_w_...`): in a poll review (forced draft) it is recorded as a draft and not sent; in a dry run without `forceDraft` it is `would_do` / `dry_run`; in a real run it is held as `mcp_write`, unchanged; a `never` list with `mcp_write` still denies it `agent_boundary`. No dry run sends a write.
- [ ] **AC5.** The names a session's policy gains are exactly the proxy tools that session lists (`toolsForConnectors` over the owner's grant and a connector row in use), never more. A proxy for a tool the grant doesn't name, for a kind not in `connectors`, or for a row not in use (`expired`, `disconnected`, none) is not added, and a call to it is denied `tool_not_allowed` as today.
- [ ] **AC6.** A member without the tracker's read grant is unchanged: 22a's `owner_step_open` skip still starts no review session. This item adds nothing for that member (22e owns its park and enable card).
- [ ] **AC7.** A settings file that is refused or unreadable, or a grant read that throws, adds no name (fail closed), as the tool listing already does.
- [ ] **AC8.** The dry-run rail admits `mcp__kernel__kernel_mcp_r_<kind>_<tool>` as read-only by an exact-prefix rule kept separate from `DRY_RUN_READ_ONLY_TOOLS`, which stays closed. `mcp__other__kernel_mcp_r_x`, a bare `kernel_mcp_r_x` and any `kernel_mcp_w_` name are not read-only.
- [ ] **AC9.** The added names are never written to the settings file, the charter or the inspector's job lines. A grant change applies at the next session start or resume, the same as the tool listing.
- [ ] **AC10.** Wright's own sessions and every session of a member with no MCP grant behave as today.

## Non-goals

- A member without the tracker grant (22e: park and enable card).
- Changing which tools a capability groups, or a server's `readOnlyHint`.
- GitHub read tools (already read-only in a dry run, `DRY_RUN_GITHUB_READ_TOOLS`).
- Rewriting the 22a evidence file. Evidence is a record; the corrected mechanism lives in the architecture docs.

## Owner decisions

- 2026-11-15: fix the dry-run review's ticket read before the phase 8 exit walk.
- 2026-11-15: option A. The owner's per-tool tracker grant is the session's permission for exactly the proxy tools it lists, in memory only, never written to the member's settings. This replaces the rule at `docs/architecture/mcp-connectors.md:186`. It contradicts no `docs/DECISIONS.md` entry and matches D38 ("lists to each agent only the tools the owner grants it"). Options B (write the raw proxy names into `allowedTools`, with a backfill) and C (dry-run rail only) were rejected: B puts kernel names in a file the owner reads, and C leaves app-created members unable to read tickets.

## Priority: MVP (phase 8 exit)

**Rationale:** the exit runbook's walk step 1 runs a dry run before each ticket playbook's enable, and every mismatch blocks phase 8. A review built from a title and a status can't show the owner what a real run would do. Gate 1 also blocks the walk's real ClickUp ticket run from reading its task.

## Assumptions

- A ClickUp read capability's tools carry `readOnlyHint: true` (21b evidence: every one of the 67 tools carries both `readOnlyHint` and `destructiveHint`). A tool the server hints write stays `kernel_mcp_w_` and is drafted in a review.
- Where the names join the policy (a manager option fed from `kernel.ts`'s grant reader, or something else) is Launch Pad's call, as long as AC5's "exactly the listed tools" holds.

## Dependencies

- Depends on: none. It consumes nothing 22e builds. It shares one doc with 22e (`docs/architecture/mcp-connectors.md`).
- Note for 22e: after this item, 22e's AC3 ("it runs as today") means a granted member's real run can read the ticket.

## Risks

- This widens what granted members' real and chat sessions can do: they can now call the read tools the owner granted. That is what the grant meant, but it is a change in behaviour, and the doc rule changes with it.
- Tests that assert a granted proxy is refused without `allowedTools` change on purpose and should say so.
- A server that labels a destructive tool read-only is now read without a hold in a dry run too. The per-tool grant is still the bound (`mcp-connectors.md`, the `mcp_write` rail).

## Success Metrics

- AC1 to AC10 are pinned by tests. At least one AC1 case fails on today's `main`.
- The exit walk's ClickUp dry run shows a review that quotes the ticket's body.

## Handoff

- `/automate --folder .supervisor/requirements/phase-8-22` (this item is `ready`).

## Validation (must pass before merge)
1. **Static (kernel suite and docs):** `cd kernel && npm ci && npm test` with new cases in `kernel/test/sessions-dry-run.test.ts` (AC4, AC8) and `kernel/test/integrations-mcp-connector.test.ts` (AC1 to AC3, AC5, AC7, AC9, AC10). At least one AC1 case must fail without the change. Then `bash scripts/check-docs.sh`. Static only: exit walk step 1 runs the live ClickUp dry run anyway.

## Depends on
none

## Touches
kernel/src/sessions/dry-run.ts
kernel/src/sessions/manager.ts
kernel/src/kernel.ts
kernel/test/sessions-dry-run.test.ts
kernel/test/integrations-mcp-connector.test.ts
docs/architecture/dry-run.md
docs/architecture/mcp-connectors.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-16T01:35:01Z
- **Brief:** .supervisor/jobs/done/2026-11-15-dry-run-review-reads-the-ticket.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/285
