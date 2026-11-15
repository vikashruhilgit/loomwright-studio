# Backlog: phase 8 item 22 — wave 1 follow-ups

## Status: done

## Why now
Closing the phase-8-21 wave (PR #279, merged 2026-11-14) left gaps: 21b's final grant-saving code and 21e's step 6 were never walked live, an untested 21b/21e interaction (a jobless ClickUp member's dry run), a review nit on approvals that tick an already-held grant, and Jira's unverified capability names. 21d moved here from phase-8-21 (owner's choice, option A).

## Checklist
- [ ] .supervisor/requirements/phase-8-22/2026-11-14-120200-d-wright-drafts-a-playbook-for-a-crew-member-that-is-off.md
- [ ] .supervisor/requirements/phase-8-22/2026-11-14-230550-a-wave-1-of-phase-8-21-walked-live-on-the-merged-main.md
- [ ] .supervisor/requirements/phase-8-22/2026-11-14-230616-b-a-tick-on-a-grant-already-held-records-nothing.md
- [ ] .supervisor/requirements/phase-8-22/2026-11-14-230617-c-jira-capabilities-read-from-a-live-jira-connection.md (proposed: waits for a Jira connection)
- [ ] .supervisor/requirements/phase-8-22/2026-11-15-160000-e-a-member-without-tracker-access-never-starts-a-ticket-run.md (added 2026-11-15 from #283's review; ready since #283 merged)

## Order
No item depends on another; no two share a file.

## Run
`plan-waves --max 3`: one wave of three (21d, 22a, 22b); 22c is skipped while proposed. Suggested: `/automate --folder .supervisor/requirements/phase-8-22 --parallel 3 --cheap`.

## Considered and not queued
- Wright drafting unasked playbooks: item 21f, PR #280, merged.
- The phase 8 live-harness Ctrl-C test flake: PR #281, merged.
- Loomwright engine gaps (a parked lane never reviews later pushes; no local CI at wave build): the Loomwright repo, not Studio.
- The ClickUp capability mapping sign-off: an owner decision.
- 21a's done stamp: bookkeeping.

## Owner decisions
none recorded

## Revisit when
22c: when Jira is connected in Integrations.
