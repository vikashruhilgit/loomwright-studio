# 27a — A run can run the checks it may run

**As the** owner,
**I want** a kernel-started run to find the executable each declared check needs (`npm` for `npm test`) on its own PATH,
**so that** a run that the policy lets run `npm test` can actually run it, and a Supervisor stops checkpointing with "local verification unrunnable" for a check the repo declares.

## Why
Phase 8 exit walk, 2026-11-24 (kernel `d790c93c`, Loomwright 18.1.2, crew `p8-26-1`, sandbox base `a9b040e`), walk step 1. The ticket run (session 266, run `20261124-133823` in `~/studio-work/studio-sandbox`) admitted `npm test` as a declared check (25d; the `run_declared_checks` event lists `npm test` from `.github/workflows/ci.yml` job `ci`), and the policy allowed `npm test` twice. It still could not run: the service's PATH is `/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` (the plist's `EnvironmentVariables.PATH`), and npm on this machine lives only in `~/.nvm/versions/node/*/bin` and `/usr/local/bin`. The Supervisor recorded "npm test, bash -n and the pin-mutation check could not run in this environment (npm not on PATH; hook blocks bash/node)" and ended `status: checkpoint`, `pr_url: null`: no PR, walk step 1 failed.

Mechanism: `service install` resolves only `SERVICE_TOOLS` (`gh`, `git`, `kernel/src/service/launchd.ts:142`, item 23h) through the installing shell's PATH and writes their dirs into the plist. A declared check's own executable is never resolved, and nothing tells the owner before a run spends tokens. 25d made the policy side right; this is the environment side of the same gap (24a).

## Owner decisions
- 2026-11-24: "File findings, stop" — the walk stops at step 1, nothing is patched by hand mid-run (runbook Findings rule).

## Acceptance criteria
- [ ] Given a repo whose declared checks (25d) include `npm test` or `npm run <x>`, when the kernel launches a `backlog`, `resume` or `review_pr` run, then the run session's PATH holds the directory of the `npm` (and the `node` it needs) the owner's shell resolves, resolved the same way 23h resolves `gh` and `git` (the dir, never the installer's whole PATH).
- [ ] Given a declared check whose executable cannot be found for the run, when the run would launch, then the owner sees it before the run starts: the launch is refused or flagged with a plain line naming the check and the missing executable (for example `npm test is declared but npm is not on the run's PATH`), recorded on the `run_declared_checks` event, never discovered by a Supervisor checkpoint.
- [ ] `service install` prints which declared-check executables it resolved, as it prints `gh` and `git` today, and a missing one is a warning naming what a run then cannot do.
- [ ] The run policy is unchanged: no new Bash prefix; `npm test` stays the only form admitted for this repo.
- [ ] A test covers: npm found under an nvm-style dir is put on the run PATH; npm missing yields the named refusal/flag; no other installer PATH entry leaks in.

## Non-goals
- Letting a run execute project scripts directly (`./drum.sh`, `bash -n`, `node ping.js`); those stay denied (24a/25d).
- Choosing a Node version for the owner beyond what the installing shell resolves.

## Priority: MVP
Blocks phase 8 walk step 1 (and every later step).

### Assumptions
- Defect evidence: observed (session 266 events; plist PATH read with `plutil -extract EnvironmentVariables.PATH`; `which -a npm`).
- The resolve-at-install approach of 23h extends to more tools; whether resolving at launch is better is the builder's call, stated in the PR.

## Validation (must pass before merge)
1. `cd kernel && npm test`.
2. Running system: after reinstall, `plutil -extract EnvironmentVariables.PATH raw ~/Library/LaunchAgents/com.loomwright.studio.kernel.plist` holds npm's dir, and the next walk's step 1 run runs `npm test` (an `allow` tool decision followed by a passing result in the session output).

## Depends on
none

## Touches
kernel/src/service/launchd.ts
kernel/src/service/index.ts
kernel/src/automate/declared-checks.ts
kernel/src/automate/launch.ts
kernel/test/service-launchd.test.ts
kernel/test/automate-declared-checks.test.ts
docs/architecture/automate.md
docs/evidence/phase-8-exit-runbook.md

## Status: open

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-24T19:02:28Z
- **Brief:** .supervisor/jobs/done/2026-11-24-27a-run-can-run-the-checks-it-may-run.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/312
