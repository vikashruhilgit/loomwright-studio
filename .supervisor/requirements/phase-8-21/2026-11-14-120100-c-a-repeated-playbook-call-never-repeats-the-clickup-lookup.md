# 21c — A repeated playbook call never repeats the ClickUp name lookup

**As** the owner of Loomwright Studio,
**I want** a repeated `kernel_playbook_create` or `kernel_playbook_update` under the same idempotency key to return its first result without asking ClickUp again,
**so that** a retry never reports a failure for a playbook that was already saved, and Wright never makes a duplicate by retrying under a new key.

## Why

Found in review of PR #275 (21a; branch `feature/clickup-poll-list-by-name`, head `87fde1ed`, merged 2026-11-14 as `02244df1`), verified in `kernel/src/playbooks/drafts.ts` at both commits (same lines on `main`):
- `resolvedTrigger` (line 207) calls `resolveClickupNames`, a live MCP read (`clickup_get_list` with `list_name`), in both handlers: create (line 424) and update (line 474).
- In both, it runs before `runStep(ctx.store, ctx.stepKey(a.idempotency_key), …)` (lines 425 and 475) claims the key.
- So a repeat under the same key looks the list up again instead of returning the first result. If that second lookup fails (the sign-in expired, a timeout, the list was renamed), the repeat reports a failure for a playbook that was already saved. Wright may then retry under a fresh key and create a duplicate.
- The tool description promises otherwise (`REPEAT`, line 234): "Repeating a call with the same idempotency_key in this session returns the first result, even if other arguments differ."
- The fix pattern already exists: `runStepAsync` (`kernel/src/loop/steps.ts:346`), used by the dry run (`kernel/src/playbooks/dry-run.ts:570`), claims the key before its async work and returns a done step's stored value. An error the caller marks as having had no effect (`noEffect`) releases the claim, so a later call runs again.

## Acceptance Criteria

**Happy path:**
- [ ] **AC1.** Given a `kernel_playbook_create` with a ClickUp list given by name that succeeded, when the same call is repeated with the same idempotency key, then it returns the stored first result, and the ClickUp reader is not called again (a test whose reader fails on its second call proves it).
- [ ] **AC2.** Given a `kernel_playbook_update` that changed a trigger to a ClickUp list given by name and succeeded, when it is repeated with the same key, then the same holds: the first result, no further `clickup_get_list` call.

**Edge cases:**
- [ ] **AC3.** Given a list or space already given as an ID, when a create or update runs, then behaviour is unchanged: no lookup is made, and a repeat returns the first result as today.
- [ ] **AC4.** Given a repeat with the same key but different arguments, then the first result is returned, as `REPEAT` says, without a lookup for the new arguments.

**Error scenarios:**
- [ ] **AC5.** Given a first call whose name lookup fails (not found, more than one match, the reader unreachable), then nothing is written (no playbook row, no version, no done step), the same refusal as today is returned, and a later call with the same key runs the lookup again rather than replaying the failure.
- [ ] **AC6.** Given a first call whose lookup succeeds but whose write is refused, then the step's outcome is recorded as today, and a repeat returns that outcome without a lookup.

## Non-goals
- Changing how a name resolves to an ID, or the lookup's messages (21a).
- The idempotency of other playbook tools, which already claim before any async read.

## Owner decisions
- 2026-11-14: filed as a follow-up to PR #275, at the owner's go relayed by the 21a build session.

## Priority: MVP
**Rationale:** The phase 8 exit re-run drafts a ClickUp ticket playbook by list name, the path this bug sits on; a duplicate playbook there would confuse the walk.

## Assumptions
- `runStepAsync`'s `noEffect` option covers a failed lookup: the lookup raised the error itself and wrote nothing.
- The handlers' other checks before the step (`refuseCrewDrafting`, `draftOwner`) stay synchronous and before the claim, as in the dry run.

## Dependencies
- Depends on: 21a (PR #275) merged; this changes code that PR adds.
- Blocks: none.

## Risks
- Moving the write inside an async step changes when a crash between lookup and write is seen: the step is left `started`, and a later call treats it as a crash leftover. The tests should pin that case.

## Success Metrics
- No repeated `kernel_playbook_create` or `kernel_playbook_update` makes a second ClickUp call (counted by the test reader).

## Handoff
Ready for: `/launch-pad goal: ".supervisor/requirements/phase-8-21/2026-11-14-120100-c-a-repeated-playbook-call-never-repeats-the-clickup-lookup.md"`

## Validation (must pass before merge)
1. **Static — kernel suite and docs:** `cd kernel && npm ci && npm test`, including new cases in `kernel/test/playbooks-drafts-poll.test.ts` for AC1 to AC6; `bash scripts/check-docs.sh`.

## Depends on
2026-11-13-221500-a-a-clickup-poll-names-its-list-the-way-clickup-reads-it.md

## Touches
kernel/src/playbooks/drafts.ts
kernel/test/playbooks-drafts-poll.test.ts
kernel/test/playbooks-drafts.test.ts

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-14-repeated-playbook-call-no-clickup-lookup.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.
