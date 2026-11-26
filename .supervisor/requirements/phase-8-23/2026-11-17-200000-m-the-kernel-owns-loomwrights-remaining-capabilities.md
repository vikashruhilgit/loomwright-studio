# 23m — The kernel owns Loomwright's remaining capabilities

## Status: proposed

**Why.** The owner wants full Loomwright functionality from a kernel run (2026-11-17). 23k admitted the 24 inline-phase scripts that only keep local bookkeeping, read, or check out locally. The rest stay out of a run session because each acts where the kernel cannot see or stop it. Each needs a kernel-owned path, not a wider grant.

| Left-out scripts | Loomwright capability | Kernel-owned path to build |
|---|---|---|
| `dispatch-pr-review.sh`, `hook-dispatch-on-pr-create.sh` | Review drain after the PR | Already the kernel's `review_pr` run; check it is queued after an inline-phases PR |
| `automate-lanes.sh`, `gate-auto.sh` | `--parallel` lanes | The kernel starts each lane as its own metered, killable session |
| `run-ground-truth.sh`, `rules-check.sh`, `worker-rule-selfcheck.sh`, `run-pin-mutations.sh`, `run-benchmark.sh` | Executable acceptance, house rules, pin mutations | The kernel runs each command line through the rail, one by one, or only from files the session cannot write |
| `send-webhook.sh` | Gate notifications | Through the approval gate or an owner-enabled connector |
| `write-project-memory.sh`, `write-agent-memory.sh`, `write-system-contract.sh` | Durable memory and contracts | An approval card per write |

**Ask.** Order the rows by what the next live `--inline-phases` run is actually denied (a denial is the evidence; see `defect-claims-need-reproduction`). Each row keeps invariants 2 and 3.
