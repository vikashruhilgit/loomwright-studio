# 27b — A handover never queues a ticket that is gone

**As the** owner,
**I want** the kernel's ticket backlog to carry an earlier ticket only while that ticket is still open and still matches its playbook,
**so that** a new `/automate` run builds the tickets I just handed over, not a closed issue or an untagged task from an old run.

## Why
Phase 8 exit walk, 2026-11-24, walk step 1. The new handovers (issue #24, ClickUp 86bd6edk6) were appended to `~/studio-work/studio-sandbox/.supervisor/requirements/studio/_BACKLOG.md`, which still listed the 11-20 run's unchecked items: issue #21 (closed `not planned` that morning) and ClickUp task 86bd5gdbq (its `studio-sandbox` tag removed). The run (`20261124-133823`) queued all four and picked #21 first, so PR A would have linked to a closed ticket.

Mechanism: the 23i carry rule (`kernel/src/automate/tickets-to-items.ts`, header lines 21–32) keeps an earlier line when the kernel wrote it, its item file exists, Loomwright has not stamped it finished, and no run file in the checkout names it. Nothing asks whether the ticket is still open or still matches the playbook's filter. Contributing cause, the walk's own setup: the 11-20 run file that named #21 and 86bd5gdbq was moved into `.supervisor/automate/archive-2026-11-24/` by hand, so the "no run file names it" test passed and both were carried. There is no supported way for the owner to retire an old run and its items; hand-moving files is exactly what invariant "owner never handles kernel internals" says should not be needed.

## Owner decisions
- 2026-11-24: "File findings, stop".

## Acceptance criteria
- [ ] Given an earlier backlog line whose ticket is now closed (GitHub issue `state: closed`) or no longer matches its playbook's filter (a ClickUp task without the polled tag, or moved off the list), when a handover rewrites the backlog, then that line is not carried, and the handover's result names each dropped ticket and why (`ticket_closed`, `filter_no_longer_matches`).
- [ ] Given the ticket source cannot be read at handover time, then the line is kept and the result says `unverified` (fail toward keeping work, never silently dropping).
- [ ] Given an earlier run file the owner wants retired, then there is a supported way to do it (a kernel or app action, or Loomwright's own archive), so no file is moved by hand; its unfinished items are then not carried.
- [ ] A test covers: closed issue dropped, untagged task dropped, unreadable source kept as `unverified`, open matching ticket kept in place.

## Non-goals
- Changing what the playbook decides to hand over (invariant 1: the playbook sets policy).
- Deleting item files; dropping a line from the checklist is enough.

## Priority: MVP
Blocks a clean phase 8 walk on a checkout that has run before.

### Assumptions
- Defect evidence: observed (the backlog file and run file named above; `gh issue view 21` reads closed; ClickUp 86bd5gdbq has no `studio-sandbox` tag).

## Validation (must pass before merge)
1. `cd kernel && npm test`.
2. Running system: on the next walk's checkout, the handover's backlog lists only the walk's two tickets.

## Depends on
none

## Touches
kernel/src/automate/tickets-to-items.ts
kernel/src/automate/runner.ts
kernel/test/automate-runner.test.ts
docs/architecture/automate.md
docs/evidence/phase-8-exit-runbook.md

## Status: open
