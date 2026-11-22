# 25a — A conformance test catches every Loomwright command the rail would deny

**As the** owner running phase 8's live walk,
**I want** CI to fail when the installed Loomwright tells a kernel-run session to use a command or tool Studio's rail denies without a recorded reason,
**so that** a live run never again discovers the next denial one round at a time.

## Why
Every phase 8 live run since 2026-11-12 died on a different denial (23a, 23e, 23k, 23q, 24a…). The run policies in `kernel/src/automate/launch.ts` were derived by hand-run greps over 17.38.0 text, one session kind at a time; the 2026-11-20 sweep of 18.1.2 found commands no grep had covered (`self-heal-advisory/` calls `phase45-ci-read.sh` and `reconcile-jobs.sh`; Launch Pad calls `automate-lanes.sh scope-outside` and `gate-auto.sh decide`). The fix is mechanical: derive the instructed set and check it against the rail on every build.

## Acceptance criteria
- [ ] Given the Loomwright install the kernel resolves (and, in CI, a committed fixture extracted from 18.1.2), when the test runs, then it extracts every script call (`scripts/<name>.sh [subcommand]`), every backticked or fenced shell command, and every Claude tool name from the instruction files each kernel session kind follows (ticket run with `--inline-phases` and Resume, `review_pr`, `merge_parked`), and the drivers' printed `invocation` / `launch` / `push` / `then` text.
- [ ] Given each extracted command, when it is run through the real policy for that session kind (`decide` in `kernel/src/sessions/policy.ts` with the policy `launch.ts` builds), then it is either admitted, or listed in one exclusions table with a written reason and a "consequence if denied" line; anything else fails the test, naming the command, the session kind and the source file:line.
- [ ] Given an exclusion whose stated reason is a fact about the script (for example "starts a `claude` process"), when the test runs, then it checks that fact against the script text where it can (a `claude` invocation present; `eval` / `bash -c` present) and fails when the fact is false. Today this fails for `gate-auto.sh` and `run-benchmark.sh` (`launch.ts:232`, `:236`), whose stated reasons are false in 18.1.2 (no `claude`, no `eval` / `bash -c`).
- [ ] Given a new Loomwright release, when `scripts/refresh-loomwright-fixture.sh` (or the test's own update mode) is run, then the fixture is regenerated from the active install and the diff shows exactly what Loomwright added or removed.
- [ ] Edge: a command shape the extractor cannot parse is reported as `unparsed` with its source, never silently dropped; the test fails while any `unparsed` entry has no exclusion.
- [ ] Edge: commands Loomwright's own scripts run internally (for example `review-heal-next-step.sh` posting `gh pr comment`, `send-webhook.sh`, a detached `dispatch-pr-postmortem.sh`) are listed in a separate "runs past the rail" table with the script and line, so they are recorded rather than invisible (see 25h).

## Part B — what admitted scripts do past the rail (was 25h)
Read from 18.1.2 on 2026-11-20, not observed: the admitted `review-heal-next-step.sh` posts `gh pr comment` (lines 289-291, called at 812, 821, 998), runs `send-webhook.sh` (318) and starts a detached `dispatch-pr-postmortem.sh` `claude` process (323, 1098); at an `awaiting_merge` park, `automate-next-step.sh` starts `nohup automate-merge-watch.sh` (814) and the kernel does not set `NEXT_STEP_WATCH_CMD`, so a watcher runs outside Stop and Kill with a one-hour session token. Studio excludes the same scripts when the session calls them directly (`launch.ts:224-240`).

### Acceptance criteria (Part B)
- [ ] For each admitted script, a probe (scratch repo, stubbed `gh`, `claude`, `curl` on PATH recording their calls) runs the script's paths a kernel run reaches and records every outward call and every process it starts, with the condition that triggers it.
- [ ] `docs/evidence/phase-8-25h-past-the-rail.md` lists them, each marked: already gated elsewhere / harmless / needs a kernel-owned path (with a proposed path, for example the kernel setting `NEXT_STEP_WATCH_CMD` to a kernel-owned watcher, or `auto_postmortem: false` in a kernel run's config).
- [ ] Nothing in the run policies changes in this story; each "needs a path" row becomes an owner decision.

Part B's defect evidence is read, unverified: it is written as a probe, and its rows become owner decisions; nothing in the run policies changes here.

## Non-goals
- Changing what is admitted: that is 25b, 25c and 25d. This story lands with the current gaps listed as known exclusions marked `filed: 25b|25c|25d`, so CI is green on day one; 25d removes the closed rows and turns on the stale-exclusion check.

## Owner decisions
- 2026-11-20: build a conformance test rather than another hand sweep (owner, in the /product-owner session that filed phase 8 item 25).

## Priority: MVP
Prevents a repeat of the round-by-round failures.

### Assumptions
- The instruction files are markdown plus the four drivers; commands appear backticked, fenced, or as `bash "${CLAUDE_PLUGIN_ROOT}/scripts/…"`.

### Risks
- Over-extraction (prose that only mentions a command) makes the exclusions table long; mitigate with an `advisory, never instructed` reason class.

## Validation (must pass before merge)
0. **Static — Part B probe:** the past-the-rail probe passes and `docs/evidence/phase-8-25h-past-the-rail.md` exists; `bash scripts/check-docs.sh` passes.
1. **Static — kernel suite:** `cd kernel && npm ci && npm test` passes, including the new conformance test.
2. **Static — the test bites:** removing `"git commit"` from `RUN_BASH_PREFIXES` makes it fail naming `commit/SKILL.md`; restoring it makes it pass.
3. **Static — false reasons caught:** with today's `launch.ts`, the `gate-auto.sh` reason check fails until 25c corrects it (shown in the PR).

## Depends on
none

## Touches
kernel/test/loomwright-conformance.test.ts
kernel/test/fixtures/loomwright-18.1.2-instructions.json
kernel/src/automate/run-exclusions.ts
scripts/refresh-loomwright-fixture.sh
kernel/test/loomwright-past-the-rail-probe.test.ts
docs/evidence/phase-8-25h-past-the-rail.md

## Status: brief-shipped

Job `.supervisor/jobs/done/2026-11-20-25a-loomwright-conformance-test.md` completed (reconciled from the job lifecycle, not self-reported).
Acceptance criteria are NOT machine-verified here — review them before promoting this to `## Status: done`.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-22T12:14:29Z
- **Brief:** .supervisor/jobs/done/2026-11-20-25a-loomwright-conformance-test.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/299
