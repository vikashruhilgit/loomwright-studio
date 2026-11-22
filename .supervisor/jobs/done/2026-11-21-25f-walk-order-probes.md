# Supervisor Job: 25f — walk probes: the phase 8 runbook's walk matches how Loomwright 18.1.2 runs two tickets, a merge after triage, and the merge block

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-20-174137/L3
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-25/2026-11-20-120500-25f-the-walk-matches-how-loomwright-runs-two-tickets-and-a-merge-after-triage.md
- **Base commit:** 9b3ca660fba2decaaef7c34aa08f4d5b2ec91bfd

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel tests are vitest (strict TS) under `kernel/test/`; Loomwright's own driver tests stage a scratch git repo with a stub `gh` first on PATH / `LOOMWRIGHT_GH_BIN` (`scripts/test-automate-next-step.sh` in the 18.1.2 install), which a vitest test can reproduce with `child_process`. No new dependency. |
| 2 | Dependency Availability | CAUTION | The probes need a real Loomwright 18.1.2 install (`automate-next-step.sh`, `review-heal-next-step.sh`). It is present on the owner's Mac (`~/.claude/plugins/installed_plugins.json` lists `loomwright@atelier` at 18.1.2) but not in GitHub Actions CI, so the driver-driving half must skip when no 18.1.2 install resolves. |
| 3 | Architecture Fit | GO | Probes are tests plus docs; no kernel source changes (the requirement's non-goals forbid changing D45, `launch.ts`, the triage route or the merge guard). |
| 4 | Scope vs Supervisor Capability | GO | 6 files (3 modify, 3 create), well under the context-bound threshold; single worker. |
| 5 | Hard Blockers | CAUTION | Loomwright's driver is a multi-step state machine (`docs/result-schemas/automate-run.md` §"next-step instruction"); driving a two-item safe-mode backlog to the second PICK with stubbed phases is non-trivial. If it cannot be driven end to end, the probe records the furthest observed step and the exit/instruction seen, never a guessed answer. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Probe R1, R2, step 6 and Part B (25e) against Loomwright 18.1.2 and the kernel, record each answer in a test and an evidence file, and rewrite the phase 8 runbook's walk so the next live run can pass in the order written.

**Problem Statement:**
The owner needs the phase 8 runbook's walk order and setup to match what Loomwright 18.1.2 and the kernel actually do, because three walk assumptions (R1 two PRs at step 1, R2 merging PR A after step 2's triage, step 6's session) and the triage-fix prompt (Part B) were read from code on 2026-11-20 and never run.
Currently the runbook expects two PRs at step 1, merges PR A after three comments and a fix push, names no session for step 6, and assumes the kernel-started `/loomwright:review-pr <url>` sees the `fix:` comment. This can fail the next live walk on its own order and spend a day of subscription for nothing.
Success looks like: each claim answered by a test that ran the real 18.1.2 driver (or the real kernel route and launch code), the runbook rewritten to the observed order, and Part B's answer in `docs/evidence/phase-8-25e-triage-fix-probe.md` with a proposed D45 amendment if the comment is lost.

## Acceptance Criteria
- [ ] **AC1 (R1).** Given a scratch git repo (under `tmpdir()`, never the lane checkout), a stub `gh` (first on PATH and via `LOOMWRIGHT_GH_BIN`, `HOME` sandboxed, no network) and a two-item backlog run file in safe mode, when `kernel/test/phase-8-walk-order-probe.test.ts` drives Loomwright 18.1.2's real `automate-next-step.sh` through the first item's READY park and on toward the second item, then the test asserts the observed point at which the second item's PR can start (e.g. only after item 1's PR reads MERGED and a `--resume`), and the runbook's steps 1 and 5 are rewritten to that order (for example: PR A from the first ticket, merge it under Solo, Resume, then PR B under Approve in Studio).
- [ ] **AC2 (R2).** Given a run parked `awaiting_merge` with `owned_drain_result: READY` and a `- ready_sha: … | ready_at: …` line, whose stubbed PR has an issue comment newer than `ready_at` and a head that is not `ready_sha`, when the same test file runs the real `automate-next-step.sh --merge-parked <automate_dir> --run <run_id> --session-id <sid>`, then it asserts the recorded answer (exit code, the `merge-parked … — PARK: <reason>` line or MERGE); if it parks, the runbook orders PR A's merge before the triage comments (triage on PR B, or merge then triage) — the in-lane outcome that makes the walk passable as written; a wanted re-drain path is recorded only as a one-line follow-up in the runbook's Findings section, never as a new requirement file in this PR.
- [ ] **AC3 (install gating).** Given no Loomwright 18.1.2 install resolves (GitHub Actions CI), when `cd kernel && npm test` runs, then the driver-driving cases skip with a named reason (`describe.skipIf`), and a CI-run case still asserts the recorded R1/R2 answers (constants in the test) agree with the runbook's walk text, so `npm test` passes in CI and locally.
- [ ] **AC4 (step 6).** Given the rail runs only after the session's policy admits the call (`kernel/src/sessions/manager.ts`, "The rail applies only after the policy allowed"), when the runbook's step 6 is rewritten, then it names a session whose policy admits the `gh pr` prefix (for example a ticket run's continuation) so `gh pr merge` reaches the rail and is denied `merge_blocked`; and `checkNoKernelMerge` in `kernel/test/phase-8-exit-live.test.ts` carries a doc comment saying a `bash_prefix_not_allowed` deny is not the expected deny (it counts as `fail`), with a pinned canned-store case asserting that outcome.
- [ ] **AC5 (tickets).** Given the sandbox's declared check is `npm test` (25d), when the runbook's ticket text is rewritten, then each ticket asks for a change that `npm test` exercises, and the GitHub ticket's text is "add `drum.sh` printing `boom` and make `npm test` run it" (the ClickUp ticket asks for a second change of the same kind, also run by `npm test`).
- [ ] **AC6 (OPEN_QUESTIONS).** Given claims answered since 2026-11-18, when `docs/OPEN_QUESTIONS.md` is updated, then it records: 23j Resume continued a paused run live in sessions 214 and 226 (the "Phase 8 item 23j: the owner's Resume (NEEDS VERIFICATION)" entry); the plugin-root path matched in session 249 (the "SDK's plugin-root expansion" entry); item 04(c)'s token evidence from the 2026-11-18 run; and it points the R1/R2 results at the runbook. Existing pinned strings stay (`/loomwright:automate --merge-parked <run_id>` in the p14 entry; the `Phase 8 exit: live run (item 14, owner)` title).
- [ ] **AC7 (Part B route and launch).** Given a PR with an owner comment `fix: rename ping to pong` and `kernel_pr_route` answering `automate_fix`, when `kernel/test/phase-8-triage-fix-probe.test.ts` drives the real routing tool and `handleAutomateRun` (as `kernel/test/automate-launch-routes.test.ts` does, over `FakeGitHubClient` and a recording `EventSessions`), then it records and asserts the exact prompt (`/loomwright:review-pr <url>`, no flag), the policy (`REVIEW_PR_RUN_POLICY`), and every place the comment's text reaches (prompt, queued event payload, run file, sidecar, any channel the session's instructions read) — expected none, asserted.
- [ ] **AC8 (Part B Loomwright walk).** Given Loomwright 18.1.2's `/review-pr` instructions for that exact prompt, when the probe walks them (a driver call such as `review-heal-next-step.sh` against a scratch repo with a stub `gh` that returns the comment, install-gated as in AC3), then the probe states whether any step reads issue or review comments, recorded as `comment reached: yes|no` with file:line (e.g. `commands/review-pr.md` "Without `--until-mergeable` … reads no external state").
- [ ] **AC9 (Part B evidence).** Given AC7 and AC8, then a committed evidence file `docs/evidence/phase-8-25e-triage-fix-probe.md` contains what was run, what was seen, the `comment reached:` line, and, if the comment is lost, a proposed D45 amendment (`--until-mergeable`, or the kernel passing the comment) for the owner to decide; the PR body links to it. Nothing in `docs/DECISIONS.md` (D45) or `kernel/src/automate/launch.ts` changes.
- [ ] **AC10 (docs gate).** Given the doc changes, when `bash scripts/check-docs.sh` runs, then it passes (every relative link in the runbook, OPEN_QUESTIONS and the new evidence file resolves).

## Validation (must pass before merge)
1. **Static — probes:** the R1, R2 and Part B tests run in `cd kernel && npm test` and pass, asserting what they observed (driver cases run on a machine with the 18.1.2 install; skip with a named reason in CI).
2. **Static — docs:** `bash scripts/check-docs.sh` passes.
3. **Running system — next live walk:** the walk runs in the runbook's new order with no step blocked by order (owner's live run; not part of this PR).

## Touched-file invariants

> Grounded at base `9b3ca660fba2decaaef7c34aa08f4d5b2ec91bfd`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/test/phase-8-exit-live.test.ts`** — keep: the read-only harness gate `const LIVE = process.env.STUDIO_LIVE === "1";` and `describe.skipIf(!LIVE)("live phase 8 exit` (no live behaviour in CI); keep `checkNoKernelMerge`'s rule unchanged: `a.tool === "Bash" ? a.decision !== "deny" || a.reason !== "merge_blocked"` (a `bash_prefix_not_allowed` deny stays a fail — the change only documents it and pins it); keep `ghMerges` / `const MERGE_SAFE_TOOL = /merge_check|merge_approval/;`; reuse: the file's canned-store helpers used by the existing cases (`run((db) => checkNoKernelMerge(db, START))`) for the new pin rather than a new store builder; pinned by: the same file's `checkNoKernelMerge` cases and `docs/OPEN_QUESTIONS.md has no "Phase 8 exit: live run (item 14, owner)" entry`.
- **`docs/OPEN_QUESTIONS.md`** — keep: the entry title `Phase 8 exit: live run (item 14, owner)` (read by `kernel/test/phase-8-exit-live.test.ts`) and the p14 text `/loomwright:automate --merge-parked <run_id>` (pinned by `kernel/test/automate-runner.test.ts`: `expect(p14).toContain("/loomwright:automate --merge-parked <run_id>")`); edit entries in place, tick only what was observed, keep "Not observed" lines honest.
- **`docs/evidence/phase-8-exit-runbook.md`** — keep: the harness command block `cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-8-exit-live.test.ts`, the three check names `pr_states`, `merged_by_gate`, `no_kernel_merge`, the evidence JSON shape (`checkEvidenceShape` in `kernel/test/phase-8-exit-live.test.ts` reads committed evidence, not this file, but the runbook must still name the same `steps` keys `tickets`, `triage`, `re_request`, `pr_a_solo`, `pr_b_approve_in_studio`, `merge_block`, `tasks`, `jira`); mirror: the deterministic CI walks `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` cite this runbook by path only — do not edit them in this story (outside Touches); if the new order diverges from their step order, say so in one line in the runbook's intro.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/phase-8-exit-live.test.ts` — a Bash `gh pr merge` denied `bash_prefix_not_allowed` makes `no_kernel_merge` `fail` | flip `a.decision !== "deny" \|\| a.reason !== "merge_blocked"` → `a.decision !== "deny"` in `kernel/test/phase-8-exit-live.test.ts` |
| `kernel/test/phase-8-triage-fix-probe.test.ts` — the launched prompt is exactly `/loomwright:review-pr <url>` with no flag | flip `` `${REVIEW_PR_RUN_COMMAND} ${pullUrlOf(repo, pr)}` `` → `` `${REVIEW_PR_RUN_COMMAND} ${pullUrlOf(repo, pr)} --until-mergeable` `` in `kernel/src/automate/launch.ts` |
| `kernel/test/phase-8-triage-fix-probe.test.ts` — the launched session's policy is `REVIEW_PR_RUN_POLICY` | flip `review_pr: REVIEW_PR_RUN_POLICY,` → `review_pr: AUTOMATE_RUN_POLICY,` in `kernel/src/automate/launch.ts` |
| `kernel/test/phase-8-triage-fix-probe.test.ts` — the comment's text (`fix: rename ping to pong`) reaches neither the queued event nor the prompt | flip `prompt: reviewPrRunPrompt(run.repo, run.pr),` → `` prompt: `${reviewPrRunPrompt(run.repo, run.pr)} fix: rename ping to pong`, `` in `kernel/src/automate/launch.ts` |
| `kernel/test/phase-8-walk-order-probe.test.ts` — the CI-run case: the recorded R1/R2 answers agree with the runbook's walk text | delete the runbook's rewritten step-5 line naming the Resume before PR B in `docs/evidence/phase-8-exit-runbook.md` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Probe R1/R2/step 6/Part B, record, rewrite the runbook | all | 3 modify, 3 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| probes | — | `kernel/test/phase-8-walk-order-probe.test.ts` (R1, R2; new home for the driver-driving probe), `kernel/test/phase-8-triage-fix-probe.test.ts` (Part B; new home, reuses the route/launch scaffolding pattern of `kernel/test/automate-launch-routes.test.ts`, 766 lines, not appended to) | HIGH |
| evidence + docs | `docs/evidence/phase-8-exit-runbook.md` (190), `docs/OPEN_QUESTIONS.md` (298) | `docs/evidence/phase-8-25e-triage-fix-probe.md` | HIGH |
| live harness | `kernel/test/phase-8-exit-live.test.ts` (1303 — the doc comment and its one pin belong beside `checkNoKernelMerge`, the single authority for that check) | — | HIGH |

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every `*.md` under `docs/` plus `CLAUDE.md` and `README.md` for relative links; the three docs above are in its scan set and already in the map.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/test/phase-8-walk-order-probe.test.ts"}
  - {kind: "file", path: "kernel/test/phase-8-triage-fix-probe.test.ts"}
  - {kind: "file", path: "docs/evidence/phase-8-25e-triage-fix-probe.md"}
  - {kind: "symbol", path: "docs/evidence/phase-8-25e-triage-fix-probe.md", name: "comment reached:"}
  - {kind: "symbol", path: "kernel/test/phase-8-exit-live.test.ts", name: "bash_prefix_not_allowed"}
  - {kind: "symbol", path: "docs/evidence/phase-8-exit-runbook.md", name: "boom"}
requires: []
lanes:
  - "kernel/test/phase-8-walk-order-probe.test.ts"
  - "kernel/test/phase-8-triage-fix-probe.test.ts"
  - "kernel/test/phase-8-exit-live.test.ts"
  - "docs/evidence/phase-8-25e-triage-fix-probe.md"
  - "docs/evidence/phase-8-exit-runbook.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "Loomwright 18.1.2 install (scripts/automate-next-step.sh, scripts/review-heal-next-step.sh) for the install-gated probe cases; absent in CI"
  - "bash 3.2 and git on the test machine (the driver's runtime)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `skills/automate-loop/modes-and-merge-gate.md:7` | no (Loomwright install, not this repo) | UNCLEAR | read in the 18.1.2 install: "Safe mode (default): … parks `awaiting_merge` (`## Status: paused`; single-open-PR invariant)" | tip 34 hours ago, fetched <1h |
| `resume.md:14` | no (Loomwright install) | UNCLEAR | read in the 18.1.2 install: "PR open? ⇒ … the next item is picked only on the owner's explicit `--resume`" | tip 34 hours ago, fetched <1h |
| `skills/automate-loop/resume.md:41-48` | no (Loomwright install) | UNCLEAR | read in the 18.1.2 install: "`ready_stale_feedback` — an issue comment, review or review comment is newer than `ready_at`" | tip 34 hours ago, fetched <1h |
| `kernel/src/automate/merge-check.ts:164-170` | yes | HOLDS | `const met = await policyMet(repo, pr, parked.ready_sha, deps, input.playbookRequirement);` | tip 34 hours ago, fetched <1h |
| `kernel/src/sessions/manager.ts:2865` | yes | HOLDS (moved to 2864) | `// The rail applies only after the policy allowed: it never widens a policy.` | tip 34 hours ago, fetched <1h |
| `kernel/test/phase-8-exit-live.test.ts:548` | yes | HOLDS | `const bad = attempts.filter((a) => (a.tool === "Bash" ? a.decision !== "deny" \|\| a.reason !== "merge_blocked" : a.decision !== "deny"));` | tip 34 hours ago, fetched <1h |
| `kernel/src/automate/launch.ts:367-368` | yes | HOLDS (moved to 367-369) | ``return `${REVIEW_PR_RUN_COMMAND} ${pullUrlOf(repo, pr)}`;`` | tip 34 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the 18.1.2 install is absent in CI, so the driver-driving cases cannot run there | MEDIUM | `describe.skipIf` with a named reason; resolve the install from an explicit env var or the kernel's own install resolver (D32 — `installed_plugins.json`, never the newest cache folder) and require version 18.1.2; a CI-run case asserts the recorded answers against the runbook text so the runbook cannot drift from them silently |
| Feasibility (Phase 2.5): driving `automate-next-step.sh` through a two-item safe-mode backlog with stubbed phases is complex | MEDIUM | Reuse Loomwright's own staging pattern (`scripts/test-automate-next-step.sh`: scratch repo, stub `gh` table, `LOOMWRIGHT_GH_BIN`, sandboxed `HOME`); follow the driver contract in the install's `docs/result-schemas/automate-run.md` §"next-step instruction"; record the furthest observed step and exit if the full run cannot be driven, never a guessed answer |
| A probe touches real GitHub or the lane checkout | HIGH | Stub `gh` first on PATH and via `LOOMWRIGHT_GH_BIN`, sandboxed `HOME`, scratch repo under `tmpdir()` (a `.supervisor/lane.json` in reach would also make `--merge-parked` refuse `merge_parked_in_lane`); the stub fails on any unmatched call; no network |
| The runbook's new order diverges from the deterministic CI walks (`kernel/test/phase-8-exit.test.ts`, `app/e2e/phase-8-exit.spec.ts`) | MEDIUM | Out of Touches and out of scope; note the divergence in one runbook line and file a follow-up item if it matters |
| Part B tempts a fix to D45 or `launch.ts` | MEDIUM | Non-goal: the evidence file proposes the amendment for the owner; no source or DECISIONS change in this PR |
| OPEN_QUESTIONS claims (23j sessions 214/226, plugin root in session 249, item 04(c) 2026-11-18 tokens) stated without evidence | MEDIUM | Cite the session ids and dates from the requirement as the owner's record; do not tick anything not observed; keep pinned strings intact |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-21-25f-walk-order-probes.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-21T05:53:01Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/300
- **Branch:** feature/25f-walk-order-probes
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** R1/R2 probed on the real Loomwright 18.1.2 driver (PR B only after PR A MERGED + --resume; --merge-parked parks ready_stale_feedback / head_sha_moved), Part B probed on the kernel route+launch (comment reached: no; D45 amendment proposed in docs/evidence/phase-8-25e-triage-fix-probe.md). Runbook reordered, OPEN_QUESTIONS updated, checkNoKernelMerge pin added. Heal round 1 fixed a reproduced HIGH (probe child processes inherited GIT_*; now a shared allow-listed env in kernel/test/fixtures/loomwright-probe.ts) and the MEDIUM duplicate helpers; round 2 PASS.

## Not verified
- **The live phase 8 walk in the new runbook order** — the owner's live run, not part of this PR (subtask 1)
- **The real gate-eval MERGE path of --merge-parked** — needs live GitHub reads; the probe used a PR reading MERGED at entry (subtask 1)
- **GitHub's answer to a reviewer re-request on a merged PR (new step 4)** — no live GitHub; not probed (subtask 1)
- **Step 6 in a live crew session with gh pr in its charter** — tested at decideToolUse/classifyToolCall only (subtask 1)
