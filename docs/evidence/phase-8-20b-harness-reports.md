# Phase 8 item 20b: the live harness reports as it runs (Validation 4)

The 2026-11-12 exit live run printed nothing for about 75 minutes, because vitest holds `console.log` until a test ends. The harness now prints through `report` in `kernel/test/phase-8-exit-live.test.ts`, which writes straight to file descriptor 1, and it rewrites its summary file on every check change and saves it as `interrupted` on Ctrl-C ([runbook](phase-8-exit-runbook.md#starting-the-harness)).

## What was run

The runbook's command, unchanged, from the `kernel/` directory of this branch's worktree, with `STUDIO_LIVE_WAIT_MIN=1` to bound the wait:

```bash
export STUDIO_LIVE_GITHUB_ACCOUNT=vikashruhilgit
export STUDIO_LIVE_SANDBOX_REPO=vikashruhilgit/studio-sandbox
cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-8-exit-live.test.ts
```

It ran against the installed service's real store, which the harness opens read-only (it writes nothing to the store or to GitHub). The output was read through a pipe that stamps each line with the seconds since the command started (`[+  n.ns]`), so the stamps show when each line arrived, not when the run ended. At +20 s a SIGINT was sent to the command's process group, as a terminal's Ctrl-C does.

## Terminal output

```text
[+  0.5s] 
[+  0.5s]  RUN  v5.0.3 ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-12-180247/L4-s2/kernel
[+  0.5s] 
[+  1.7s] phase-8-exit-live summary: /var/folders/jh/sbkxjbkj7y959rkxq2m61rbw0000gn/T/studio-phase-8-exit-live-summary-1794535944173.json (run start: event 19776, 2026-11-13T02:12:24.857Z)
[+  1.7s] phase-8-exit-live: do the walk in Loomwright Studio.app now; this harness only reads the store and never decides an approval.
[+  1.7s] phase-8-exit-live 2026-11-13T02:12:24.859Z pr_states:not_exercised merged_by_gate:not_exercised no_kernel_merge:not_exercised
[+ 20.0s] --- Ctrl-C (SIGINT to the process group) ---
[+ 20.0s] exit code -2
```

Read from it:

- The summary path was printed at +1.7 s, and the first check line at +1.7 s, both 18 seconds before the Ctrl-C. Nothing waited for the test to end.
- vitest was already shutting down on the Ctrl-C, so the closing "(interrupted)" line did not reach the pipe. The summary file below shows the save happened.

## The summary file after the Ctrl-C

The file at the path printed above, from the same run (the three checks are `not_exercised` because no walk was done during it):

```json
{
  "test": "phase-8-exit-live",
  "result": "interrupted",
  "run_by": null,
  "clicks": [],
  "jira": "not_exercised",
  "date": "2026-11-13",
  "run_start": {
    "at": "2026-11-13T02:12:24.857Z",
    "event_id": 19776
  },
  "sandbox": {
    "repo": "vikashruhilgit/studio-sandbox"
  },
  "harness_summary": "/var/folders/jh/sbkxjbkj7y959rkxq2m61rbw0000gn/T/studio-phase-8-exit-live-summary-1794535944173.json",
  "wait_minutes": 1,
  "checks": {
    "pr_states": {
      "outcome": "not_exercised",
      "harness": {
        "repo": "vikashruhilgit/studio-sandbox",
        "expected": 2,
        "prs": []
      },
      "findings": [
        "0 of 2 PRs tracked since the run start"
      ]
    },
    "merged_by_gate": {
      "outcome": "not_exercised",
      "harness": {
        "repo": "vikashruhilgit/studio-sandbox",
        "merged": []
      },
      "findings": [
        "0 of 2 PRs merged since the run start"
      ]
    },
    "no_kernel_merge": {
      "outcome": "not_exercised",
      "harness": {
        "attempts": []
      },
      "findings": [
        "no merge attempt was recorded: the merge-block step has not run"
      ]
    }
  },
  "interrupted_at": "2026-11-13T02:12:43.180Z"
}
```

`result` is `interrupted`, `interrupted_at` is set, and `checks` holds the checks seen so far. The file's mode is `-rw-------` (0600).

## The pins

`kernel/test/phase-8-exit-live.test.ts`, "phase 8 live: the harness reports as it runs (AC10, AC11)", starts this same command on a scratch store, reads its stdout while it runs, and checks the path line, a check-change line, the on-disk summary, and the `interrupted` summary after a group SIGINT. Two mutations were applied and both turned it red: replacing the `report` write with `console.log` (no path line within 60 s, the buffering this item fixes) and deleting the `process.once("SIGINT"` line (`expected 'incomplete' to be 'interrupted'`).

Verdict: PASS for Validation 4
