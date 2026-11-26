# 24a — A ticket run's worker can run and check the project's own code

## Status: superseded by 25d (owner chose the repo's declared checks, 2026-11-20)

**Observed live (2026-11-20, phase 8 exit re-run, kernel `9b3ca660`, Loomwright 18.1.2, session 249, playbook 17, issue vikashruhilgit/studio-sandbox#21 "Add drum.sh that prints boom").**
- The ticket run went the sanctioned way: run file created through the `loomwright_run_file_created` Write (event 37899), Launch Pad with its Plan Review, Supervisor INIT and preflight, then a single-agent worker on `feature/add-drum-sh-prints-boom`. The worker wrote `drum.sh`.
- Every command that makes the file executable or runs it was denied:
  - `chmod +x drum.sh`, `chmod +x <checkout>/drum.sh`: `bash_prefix_not_allowed` (events 38066, 38074);
  - `bash drum.sh`, `bash <checkout>/drum.sh`: `bash_prefix_not_allowed` (38067, 38076);
  - `bash -n drum.sh` (syntax check only): `bash_prefix_not_allowed` (38069, 38078);
  - the compound form with `| od -c`: `bash_shell_metacharacter` (38063).
- The main thread retried the same steps and was denied the same way. The Supervisor then parked at the subtask's per-subtask gate: `checkpoint`, "Bash policy blocks chmod and bash so drum.sh is not executable and not committed. Nothing merged." The run file reads `ran /autonomous — no PR: supervisor_checkpoint (Worker Bash blocked by kernel tool policy …)`, and the driver stopped the run (`/autonomous produced no PR`), so the run's second item (ClickUp `86bd5gdbq`) never started.

**Why it matters.** Any real ticket needs its implementer to run the project's code or tests before the Supervisor will publish; the run policy admits Loomwright's own scripts and a fixed set of read and git commands, and nothing that executes or changes the mode of a file in the checkout. Phase 8 cannot pass walk step 1 until this is decided.

**Not a mid-run patch.** Per the runbook's Findings rule, nothing was widened during the run. Item 23m already lists "Executable acceptance … the kernel runs each command line through the rail" as a capability without a kernel-owned path.

**Owner decision needed (candidates, none chosen):**
1. The run policy admits executing files the run's own branch tracks or creates inside the checkout (`bash <path>`, `./<path>`, `chmod +x <path>` with `<path>` inside the checkout), still through the rail (no metacharacters, no `~/.claude`, no network tools).
2. The run policy admits only the repo's declared check commands (for example `npm test` from `package.json`, the `run:` lines of the `ci` workflow), read by the kernel at launch, and nothing else.
3. A per-playbook grant the owner sets: the commands this playbook's runs may execute, shown on the playbook and approved like any grant.

**Exit check.** A kernel-started ticket run makes a script executable, runs it, and commits it; the Supervisor publishes a PR; a command outside the chosen rule is still denied and recorded.
