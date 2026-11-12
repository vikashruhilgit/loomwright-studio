# Backlog — Phase 8 exit live run findings (item 20)

## Why now

The phase 8 exit live run on `vikashruhilgit/studio-sandbox` (2026-11-12, commit `cfb3d428`) stopped at walk step 1: no ticket could become a PR. Every gap below was found in the running system, not in CI. Under the runbook's Findings rule, each is a phase 8 item, nothing was patched mid-run, and phase 8 stays open until a re-run has no open mismatch.

The run reached:
- setup steps 1 to 8: crew member `studio-sandbox-dev` from approval 29, and Solo accepted;
- playbook 7 enabled live at version 3;
- three real ticket sessions (125, 126, 129), each of which prepared the backlog and was refused at `/automate`.

Nothing was pushed, branched or merged, and playbook 7 is off.

These stories were written by `/product-owner` from the run's evidence (the owner chose Proceed anyway at PO-ASSUME). They replace the hand-written draft of the same findings.

## Checklist

- [ ] 2026-11-12-170445-a-crew-member-s-ticket-run-starts-automate-the-way-d43-decides.md
- [ ] 2026-11-12-170445-d-the-owner-grants-github-write-in-team.md
- [ ] 2026-11-12-170445-e-the-owner-can-see-and-set-when-a-playbook-is-live.md
- [ ] 2026-11-12-170445-g-clickup-tickets-are-read-with-a-tool-clickup-has.md
- [ ] 2026-11-12-170445-b-a-ticket-run-reaches-a-pr-with-the-charter-wright-drafted.md
- [ ] 2026-11-12-170445-h-a-tracker-ticket-playbook-names-its-target-repository.md
- [ ] 2026-11-12-170445-c-a-crew-member-s-charter-is-checked-against-what-its-work-needs.md

## Order

1. **Wave 1, five in parallel:** 20a (D43; the owner approves the decision by merging), 20d, 20e, 20g, 20h.
2. **Wave 2:** 20b (builds D43; also makes the CI walks use a drafted policy and the live harness report as it runs).
3. **Wave 3:** 20c, the system that knows what a crew member's work needs. Its declared needs for ticket jobs depend on D43.
4. Then re-run the phase 8 exit walk (item 14's runbook) from setup step 6, with a fresh charter Wright drafts and nothing granted by hand.

## Run

`plan-waves` with no cap (2026-11-12) gives the three waves above; wave 1 is the widest at 5. Use `/automate --backlog <this file> --parallel 5`. A larger N changes nothing, because 20b and 20c wait on dependencies.

## Findings mapped to stories

| Run finding | Story |
|---|---|
| 1. Team can't grant GitHub write (the CLI was used) | 20d |
| 2. Live mode only from the CLI; going live needs another dry run and enable, unexplained | 20e (Part A) |
| 3. One poll per playbook: a ClickUp playbook can't name its repo | 20h |
| 4. ClickUp reads fail `tool_unavailable` (`get_workspace_tasks` doesn't exist) | 20g |
| 5. The enable card never says "live"; the card's Mode row says "never sent" even when live | 20e (Part B, Part A) |
| 6. A crew member can't run `/automate` (`Skill`, Bash prefixes, notify refused); CI used a hand-written policy | 20a, 20b |
| 7. No system knows what a crew member's work needs (the owner's ask) | 20c |
| 8. The live harness prints nothing until it ends | 20b (Part C) |

## Considered and not queued

- Widening the crew member's policy by hand to finish this run: the owner chose to stop and file instead.
- Folding 20a (decision, small) into 20b: kept separate, because it is the owner's approval gate (the Auth 2 pattern).
- Cutting the dry run's token cost (about 121k tokens per run): not its own story yet.

## Revisit when

- D43 lands: check that 20c's declared needs match the chosen path.
- Loomwright's `capabilities.json` declares per-command needs: 20c reads them instead of the pinned table.

## Owner decisions

none recorded
