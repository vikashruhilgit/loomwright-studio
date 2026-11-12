# Backlog — Phase 8 exit live run findings (item 20)

## Why now

The phase 8 exit live run on `vikashruhilgit/studio-sandbox` (2026-11-12, commit `cfb3d428`) stopped at walk step 1: no ticket could become a PR. Every gap below was found in the running system, not in CI. Under the runbook's Findings rule, each is a phase 8 item, nothing was patched during the run, and phase 8 stays open until a re-run has no open mismatch.

What the run did reach: setup steps 1 to 8 (crew member `studio-sandbox-dev` from approval 29, Solo accepted), playbook 7 enabled live at version 3, and three real ticket sessions (125, 126, 129) that prepared the backlog and were refused at `/automate`. Nothing was pushed, branched or merged. Playbook 7 is off.

## Checklist

- [ ] 2026-11-12-164402-20a-kernel-runs-automate-for-a-crew-member-decision.md
- [ ] 2026-11-12-164402-20b-kernel-runs-automate-for-a-crew-member.md
- [ ] 2026-11-12-164402-20c-a-charter-knows-what-its-work-needs.md
- [ ] 2026-11-12-164402-20d-team-grants-github-write.md
- [ ] 2026-11-12-164402-20e-playbook-card-sets-live-mode.md
- [ ] 2026-11-12-164402-20f-enable-card-says-live.md
- [ ] 2026-11-12-164402-20g-clickup-ticket-reader-uses-the-real-tool.md
- [ ] 2026-11-12-164402-20h-a-ticket-playbook-names-its-repository.md
- [ ] 2026-11-12-164402-20i-the-live-harness-reports-as-it-runs.md

## Order

`plan-waves --max 4` (2026-11-12):

1. **Wave 1:** 20a (D43: the owner chooses a scoped grant or a kernel-owned launch, and approves by merging), 20d, 20e, 20f.
2. **Wave 2:** 20b (builds D43), 20g, 20h.
3. **Wave 3:** 20c (the owner's ask: the system knows what a crew member's work needs; it depends on D43's path) and 20i (it shares the runbook with 20h).
4. Then re-run the phase 8 exit walk (item 14's runbook) from setup step 6, with a fresh charter Wright drafts and nothing granted by hand.

## Findings mapped to items

| Run finding | Item |
|---|---|
| 1. Team can't grant GitHub write (CLI used) | 20d |
| 2. Live mode only from the CLI | 20e |
| 3. One poll per playbook: a ClickUp playbook can't name its repo | 20h |
| 4. ClickUp reads fail `tool_unavailable` (`get_workspace_tasks` doesn't exist) | 20g |
| 5. The enable card never says "live" | 20f |
| 6. A crew member can't run `/automate` (`Skill`, Bash prefixes, notify refused) | 20a, 20b |
| 7. No system knows what a crew member's work needs (owner's ask) | 20c |
| 8. The live harness prints nothing until it ends | 20i |

## Run

`/automate --backlog <this file> --parallel N`; 20a is a decision PR the owner approves by merging.

## Considered and not queued

- Widening the crew member's policy by hand to finish this run: the owner chose to stop and file instead (2026-11-12). It would have meant several more charter rounds and a broad shell grant.
- The cost of three dry runs per playbook change (about 121k tokens each): noted under 20e's flow; not its own item yet.

## Revisit when

- 20a's decision lands: re-check that 20c's declared needs match the chosen path.

## Owner decisions

- 2026-11-12: stop the live run at walk step 1 and file every finding; the owner asked for a system that identifies what permissions a crew member needs for any task (20c).
