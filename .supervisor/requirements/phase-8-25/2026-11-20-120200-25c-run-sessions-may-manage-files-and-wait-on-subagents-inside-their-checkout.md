# 25c — Run sessions may manage files, read git and wait on subagents inside their own checkout

**As the** owner,
**I want** a kernel-run session (ticket run, Resume, `review_pr`, `merge_parked`) to do the ordinary non-executing work Loomwright's Supervisor and workers need, confined to its own checkout,
**so that** an item that deletes, renames or marks a file executable, or uses the Supervisor's parallel path, can finish in Studio.

## Why
Observed denials (studio.db), still denied on `9b3ca660`:
- `chmod +x <file>` (24a events 29864 → 38074), `mv .supervisor/jobs/in-progress/…` (30444, 33369; in session 238 the item was renamed and its stale brief left behind), `git -C <checkout> status|log|ls-files|add|diff|branch` (12 events 29778 → 33797), `git ls-tree` (38014), `git ls-remote --heads origin` (30416), `git remote -v` (28664), `Monitor` (32486; session 231's turn ended a step early), `SendMessage` (33474, 38037), `od -c` (30532).
- Scripts excluded or never listed: `gate-auto.sh decide|list` (24b; 28318 → 38095; LP-SAVE answered by the model, event 37984), `phase45-ci-read.sh` and `reconcile-jobs.sh` (33816, 33822, 33825; Phase 4.5's CI read done by the model, the brief left in `in-progress/`).
- Read from 18.1.2, not yet observed live: the parallel path's `git -C ../<worktree> add|commit` and `git merge feature/x --no-ff` (`skills/async-orchestration/finalize.md:14-23`, `supervisor-next-step.sh:1058`), the Execute Manager's `TaskOutput` (`agents/execute-manager.md:182, 434`), Launch Pad's `automate-lanes.sh scope-outside` for the `LP-SCOPE` gate (`commands/launch-pad.md:672`; session 249 never called it, so the gate was skipped), `rm` / `git rm` / `git mv` for a subtask that deletes or renames.
- 23f: a read-only program (`grep`, `cat`, `head`, `tail`, `wc`, `ls`, `jq`) naming a file under the session's own Loomwright install is denied `settings_write` (27939, 29604, 33438).

## Acceptance criteria
- [ ] Given a run session, when it runs `rm`, `mv`, `chmod`, `git rm` or `git mv` whose every path argument resolves inside the session's checkout or one of its git worktrees, then it is admitted; a path outside them, under `~/.claude`, or under `.supervisor/automate/` (run state, D45) is refused, as is any recursive form whose target is the checkout root.
- [ ] Given `git -C <dir> <subcommand>`, when `<dir>` resolves inside the checkout or its worktrees, then it is judged exactly as `<subcommand>` would be in that directory (same prefix list, same run-state guard); otherwise refused.
- [ ] Given `git merge <local-branch> [--no-ff] [-m <msg>]`, `git ls-tree`, `git ls-remote`, `git remote -v`, `od`, when a run session issues them, then they are admitted (`git merge` only of a local branch name, no remote ref, no `--strategy-option` that runs a driver).
- [ ] Given the Claude tools `TaskOutput` and `Monitor`, when a run session uses them, then they are admitted; `SendMessage` stays denied with its reason recorded in 25a's exclusions table.
- [ ] Given `gate-auto.sh decide|record|list`, `phase45-ci-read.sh`, `reconcile-jobs.sh` (checked to write only the run's `.supervisor/` bookkeeping) and `automate-lanes.sh scope-outside` (read-only; every other `automate-lanes.sh` subcommand stays refused), when a run session calls them by exact install path, then they are admitted; `launch.ts`'s exclusion comments are corrected (gate-auto.sh and run-benchmark.sh start no `claude` and run no file-borne commands).
- [ ] Given a read-only program (`cat`, `grep`, `head`, `tail`, `wc`, `ls`, `jq`) naming a path under the session's own resolved Loomwright install, then it is admitted (23f); any other `~/.claude` path stays `settings_write`.
- [ ] Each observed denial above, replayed through the real policy, is admitted; each refusal edge above has a test.

## Non-goals
- Running project code (`bash <file>`, `npm test`): 25d.
- Admitting anything that starts a `claude` process, posts outward, or runs command lines read from files the session can write (`dispatch-pr-review.sh`, `send-webhook.sh`, `run-ground-truth.sh`, `rules-check.sh`, `run-pin-mutations.sh`, `write-*-memory.sh`): unchanged (23m).

## Owner decisions
- 2026-11-20: "Allow, confined to checkout" chosen for file operations, `git -C`, local `git merge`, `TaskOutput` and `Monitor` (owner, /product-owner session).

## Priority: MVP

### Assumptions
- Defect evidence: observed — studio.db events listed above (the parallel-path and `rm` rows are capability additions read from 18.1.2, not defect claims).
- Path confinement resolves each argument against the payload `cwd` and refuses any it cannot resolve (variables are already refused by the rail).

### Risks
- A confined `rm` still deletes tracked work; git history keeps it and the Supervisor reviews the diff.

## Validation (must pass before merge)
1. **Static — kernel suite:** `cd kernel && npm test` passes; new cases in `sessions-policy.test.ts` and `automate-launch.test.ts`.
2. **Static — conformance:** 25a's test still passes (its `filed: 25c` rows are removed in 25d).
3. **Running system — next live walk:** none of the listed commands appears as a deny in the run sessions' `tool_decision` events.

## Depends on
2026-11-20-120100-25b-the-rail-reads-quoted-text-as-text.md

## Touches
kernel/src/sessions/policy.ts
kernel/src/automate/launch.ts
kernel/src/sessions/loomwright-scripts.ts
kernel/test/sessions-policy.test.ts
kernel/test/automate-launch.test.ts
docs/architecture/automate.md

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-22-25c-run-sessions-files-in-checkout.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-23T03:52:32Z
- **Brief:** .supervisor/jobs/done/2026-11-22-25c-run-sessions-files-in-checkout.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/304
