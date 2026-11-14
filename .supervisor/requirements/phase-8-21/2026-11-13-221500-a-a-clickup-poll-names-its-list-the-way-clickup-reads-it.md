# 21a — A ClickUp poll names its list the way ClickUp reads it

**As** the owner of Loomwright Studio,
**I want** a ClickUp ticket playbook that Wright drafts from my words ("the Loomwright Studio list") to read that list,
**so that** I never have to look up a ClickUp list ID, and a wrong filter is named as the filter, not as a broken connection.

## Why

Found 2026-11-13 during item 20c's Validation 2 walk (main at `bd8d1ace`, then `c240581d`), before the phase 8 exit re-run. Wright drafted playbook 9 with `filters.list: "Loomwright Studio"`, the list's **name**. Every dry run of it failed, while the same list by **ID** reads fine.

Dry runs of a `clickup.tasks` poll in the owner's store (`playbook_runs`, kind `dry_run`):

| Run | Playbook | `filters.list` | Outcome |
|---|---|---|---|
| 155 | 8 | `Loomwright Studio` | `tool_unavailable` (before 20g) |
| 157 | 8 | `901422761392` | `tool_unavailable` (before 20g) |
| 183 | 8 | `901422761392` | read 1 task (after 20g) |
| 184 | 9 | `Loomwright Studio` | `mcp_tool_error` |
| 185 | 9 | `Loomwright Studio` | `mcp_unreachable` (once) |
| 186 | 9 | `Loomwright Studio` | `mcp_tool_error` |

**Cause, as read in the code (not yet probed):**
- **The ID arrives unchecked.** `kernel/src/triggers/sources/clickup-tasks.ts` (`argsOf`) sends `filters.list` to `clickup_filter_tasks` as `list_ids: [<value>]`, so a name goes to ClickUp as if it were an ID.
- **Wright isn't told it must be an ID.** Its drafting guidance (`kernel/src/playbooks/drafts.ts:381`) says only "exactly one of filters.list or filters.space".
- **The message points at the wrong thing.** The tool's error text is dropped (`kernel/src/integrations/mcp/trackers.ts:129`, by design: it is untrusted), and the dry run's fix line (`kernel/src/playbooks/dry-run-poll.ts:224`) leads with "Check the clickup connection in Integrations", although the connection was fine.

The owner never handles kernel internals, so "tell Wright the list ID" is a workaround, not the fix.

## Acceptance Criteria

**Happy path:**
- [ ] Given the owner's personal ClickUp, when a read-only probe calls `clickup_filter_tasks` with `list_ids` set to a list's name and then to its ID, then both answers are recorded in `docs/OPEN_QUESTIONS.md`, confirming or correcting the cause above.
- [ ] Given the owner names a ClickUp list or space by its name, when Wright drafts a `clickup.tasks` poll, then the stored filter is the list's ID and the poll reads that list's tasks. The owner never types or looks up an ID.

**Error scenarios:**
- [ ] Given a `clickup.tasks` poll whose `list` or `space` is not an ID, when it is created, updated or dry-run, then it is refused or reported naming the filter and what it holds, never as a connection problem.
- [ ] Given a list name that matches no list, or more than one, then Wright says so and asks the owner which, rather than guessing.

**Edge cases:**
- [ ] Given a ClickUp tool error while the connection is healthy, then the dry run's fix line names the poll's filters first. Untrusted server text is still never quoted.

## Non-goals
- Jira (the owner's work account; never connected).
- Changing which ClickUp tool reads tasks (20g).

## Owner decisions
- 2026-11-13: the owner asked for this to be filed as a finding before the phase 8 exit re-run.

## Priority: MVP
**Rationale:** The exit re-run's ClickUp ticket playbook (walk step 1) hits this as soon as Wright drafts the filter from the owner's words.

## Assumptions
- ClickUp list and space IDs are numeric strings, and the connected server can look a list up by name (for example through its hierarchy or search tools). The probe confirms both before building on them.

## Dependencies
- Depends on: none (20g is merged).

## Risks
- A name-to-ID lookup is one more ClickUp call per draft, and a list renamed after drafting keeps its ID, so the stored ID stays correct.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test`; `bash scripts/check-docs.sh`.
2. **Running system — a ClickUp poll drafted from a list name reads the list:** in the packaged app, ask Wright for a ClickUp ticket playbook naming "the Loomwright Studio list" by name; its dry run lists the open task tagged `studio-sandbox`. Record it in `docs/evidence/phase-8-21a-clickup-list-by-name.md` with `Verdict: PASS for Validation 2`.

## Depends on
none

## Touches
kernel/src/triggers/sources/clickup-tasks.ts
kernel/src/playbooks/drafts.ts
kernel/src/playbooks/dry-run-poll.ts
kernel/src/integrations/mcp/trackers.ts
kernel/test/integrations-mcp-trackers.test.ts
kernel/test/playbooks-dry-run-poll.test.ts
docs/OPEN_QUESTIONS.md
docs/architecture/mcp-connectors.md
docs/architecture/triggers.md
docs/evidence/phase-8-21a-clickup-list-by-name.md

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-13-clickup-poll-list-by-name.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-14T04:49:52Z
- **Brief:** .supervisor/jobs/done/2026-11-13-clickup-poll-list-by-name.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/275
