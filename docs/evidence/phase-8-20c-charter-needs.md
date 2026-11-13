# Phase 8 item 20c: a crew member's charter is checked against what its work needs

In the phase 8 exit live run (2026-11-12) a charter passed every check and its real run was then refused three times, because the readiness check asked only whether the charter held the kernel tools of its jobs, and a playbook's dry run runs in draft mode and never reaches the calls a real run makes. This item makes every catalogue job declare what its work needs and shows any gap before the owner approves a charter or enables a playbook: the charter card's readiness block (the readiness subtask), and the playbook's fit, dry run summary and enable (this file's subtask: [dry runs](../architecture/dry-run.md#calls-a-real-run-would-be-refused)).

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

Not yet run. The steps:

1. Ask Wright for a crew member whose job needs a permission the draft lacks (for example "a developer who triages PR comments", drafted with no workspace).
2. Read the charter card before approving it. Its readiness block names the missing permission in plain words (for example "no copy of a repo to work in", GitHub write access), never a raw tool name.
3. Ask Wright for a playbook for that member (triage, or hand tickets to /automate) and have it dry-run. The dry run's result and the mirror's last line say: `A dry run never reaches them, but a real run would be refused: <job> (<what it lacks>)`. The dry run completes; it never refuses on the gap.
4. Ask Wright to enable it. The enable is refused `charter_gap`, naming the refused call. The Triage and Merge jobs also name the crew-launched Loomwright command's `Skill` and shell prefixes as a call no charter should hold (D44); Wright proposes no grant for those. Say to enable it anyway to see the held enable show the open gap.
5. Close the gap that is yours to close (add the workspace, raise the GitHub grant to write in Team → the member's inspector) and dry-run again. For a hand-tickets playbook the summary names nothing and the enable is held without `enable_anyway`; a triage or merge playbook still names the D44 crew route, which is the owner's to enable past.

Verdict: not yet run. The owner fills in `Verdict: PASS for Validation 2` once the steps above have been run.
