# Phase 8 item 20c: a crew member's charter is checked against what its work needs

In the phase 8 exit live run (2026-11-12) a charter passed every check and its real run was then refused three times, because the readiness check asked only whether the charter held the kernel tools of its jobs, and a playbook's dry run runs in draft mode and never reaches the calls a real run makes. This item makes every catalogue job declare what its work needs and shows any gap before the owner approves a charter or enables a playbook: the charter card's readiness block (the readiness subtask), and the playbook's fit, dry run summary and enable (this file's subtask: [dry runs](../architecture/dry-run.md#a-playbooks-dry-run)).

## Validation 1: the static suites

Run on the integrated branch (all three subtasks merged, review iteration 1 applied), 2026-11-13.

```bash
cd kernel && npm test
```

```text
 Test Files  135 passed | 2 skipped (137)
      Tests  4548 passed | 16 skipped (4564)
```

```bash
cd app && npm test
```

```text
 Test Files  106 passed (106)
      Tests  3292 passed (3292)
```

```bash
bash scripts/check-docs.sh
```

```text
check-docs: OK
```

The kernel run includes `kernel/test/playbooks-dry-run-needs.test.ts` (the AC4 tests: a member holding every kernel tool of its job but no workspace has the call listed in `fit.refused_calls` and named in the dry run's summary, the enable is refused `charter_gap` until the owner enables it anyway, an owner-only gap is never in `proposed_update`, and a fitting playbook's summary names nothing). Deleting the `refused.calls.length === 0` condition on the `fits` return in `kernel/src/playbooks/fit.ts` fails two of its five tests, so the pin bites.

## Validation 2: running system (the owner runs this in the packaged app)

The steps:

1. Ask Wright for a crew member whose job needs a permission the draft lacks (for example "a developer who triages PR comments", drafted with no workspace).
   - What it showed: asked for "Ticket Runner" (`ticket-runner-20c`), one duty handing ClickUp tickets tagged studio-sandbox to /automate for `vikashruhilgit/studio-sandbox`, with no workspace and no GitHub grant. Wright held approval 33 (`kernel_agent_create`).
2. Read the charter card before approving it. Its readiness block names the missing permission in plain words (for example "no copy of a repo to work in", GitHub write access), never a raw tool name.
   - What it showed: under "Checked by the kernel before you see it", `Covered` for the duty, `Flagged` "copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)" with a Choose workspace button, and `Flagged` "GitHub write access for Hand tickets to /automate: only you can grant it (Team, in the member's inspector)". No raw tool name. Approval 33 was approved.
3. Ask Wright for a playbook for that member (triage, or hand tickets to /automate) and have it dry-run. The dry run's result and the mirror's last line say: `A dry run never reaches them, but a real run would be refused: <job> (<what it lacks>)`. The dry run completes; it never refuses on the gap.
   - What it showed: Wright drafted playbook 9 (hand tickets, merge requirement `studio_approval`, so its jobs are Hand tickets to /automate and Ask for a merge) and held approval 34 adding the merge job's kernel tools, which was approved. Dry runs 184 and 185 completed (`status done`, 0 tokens), and the mirror's last line reads as in the output below.
4. Ask Wright to enable it. The enable is refused `charter_gap`, naming the refused call. The Triage and Merge jobs also name the crew-launched Loomwright command's `Skill` and shell prefixes as a call no charter should hold (D44); Wright proposes no grant for those. Say to enable it anyway to see the held enable show the open gap.
   - What it showed: Wright reported "Enable request: Refused because of gaps in Ticket Runner's charter", listed the missing copy of the repo and the merge job's shell and pull-request refusals, said "The kernel says no charter should grant the first two, so I won't propose a change for them", and asked for the clone's path ("I won't guess the path"). Asked to enable it anyway, it held approval 35 (`kernel_playbook_enable`, `enable_anyway: true`); its display's `charter:` lines are in the output below. Approval 35 was denied, so the playbook stayed off.
5. Close the gap that is yours to close (tell Wright where your copy of the repo is and approve the charter update that lists it; raise the GitHub grant to write in Team → the member's inspector) and dry-run again. For a hand-tickets playbook the summary names nothing and the enable is held without `enable_anyway`; a triage or merge playbook still names the D44 crew route, which is the owner's to enable past.
   - What it showed: told Wright the clone is at `/Users/vikashruhil/studio-work/studio-sandbox`. It held approval 36 (`kernel_agent_update`, `changes: {"workspaces": ["/Users/vikashruhil/studio-work/studio-sandbox"]}`), whose card read `Ready` "copy of a repo for Hand tickets to /automate and Ask for a merge: works in vikashruhilgit/studio-sandbox at /Users/vikashruhil/studio-work/studio-sandbox"; it was approved. Dry run 186 then named only the merge job's D44 crew route. The GitHub write grant was not raised, since the dry run never named it and the walk did not need a live run.

Run on 2026-11-13 between 21:10 and 21:17 local time (macOS 26.6.2) by Claude, driving the app at the owner's request. It ran against the packaged app (`npm run package`, `release/mac-arm64/Loomwright Studio.app`) and the kernel installed as the launchd service (`service install`, pid 88720), both built from this PR's head `bd8d1ace`. The installed kernel's `dist/playbooks/fit.js` carries the workspace sentence below.

Verdict: PASS for Validation 2

```text
Step 2 (approval 33 card):
  Flagged  copy of a repo for Hand tickets to /automate: it has no copy of a repo to work in (no workspace is listed)
  Flagged  GitHub write access for Hand tickets to /automate: only you can grant it (Team, in the member's inspector)
Step 3 (mirror, dry run 185):
  A dry run never reaches them, but a real run would be refused: Hand tickets to /automate (a copy of a repo to work in);
  Ask for a merge (run shell commands); Ask for a merge (work with pull requests on GitHub); Ask for a merge (a copy of a
  repo to work in). The enable is refused (charter_gap) unless the owner enables it anyway.
Step 4 (approval 35 display):
  charter: A real run of Hand tickets to /automate would be refused: Ticket Runner has no copy of a repo to work in; only
  you know where your copy of the repo is: tell Wright, and it proposes a charter update listing it.
  charter: A real run of Ask for a merge would be refused: Ticket Runner can't run shell commands; D44 leaves this route to
  the crew session, which no charter should allow, so no grant is proposed and you can enable the playbook anyway.
Step 5 (approval 36 approved, dry run 186 refused):
  ["Ask for a merge (run shell commands)","Ask for a merge (work with pull requests on GitHub)"]
```

Seen during the walk, outside this item: every dry run's poll preview was incomplete (`source_error`, "ClickUp could not be read for clickup:list/Loomwright Studio: mcp_tool_error", once `mcp_unreachable`), so the ClickUp connection or the list filter needs a look before a live ticket run.
