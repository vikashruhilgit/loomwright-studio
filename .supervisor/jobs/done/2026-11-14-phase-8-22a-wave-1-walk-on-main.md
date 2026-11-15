# Supervisor Job: Walk wave 1 of phase 8 item 21 (21b and 21e) live on the merged main, including the uncovered cases, and fix only what the walk proves broken

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-14-233007/L2 (lane L2 of automate-2026-11-14-233007; primary checkout loomwright-studio)
- **CLAUDE.md:** ✓ Found (fresh: phase 8 under way, matches `docs/ROADMAP.md`)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-22/2026-11-14-230550-a-wave-1-of-phase-8-21-walked-live-on-the-merged-main.md
- **Base commit:** 1949901eede7ba7e3d00c4be23f4b0c8e187b67b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel is strict TypeScript + vitest (`kernel/`); any fix stays in `kernel/src/playbooks/`. No new dependency. |
| 2 | Dependency Availability | GO | Nothing new. The walk reuses the kernel's own `npm run build`, `service install`, the app's `npm run package`, and the `studio` CLI (`studio agents show`, `studio ask`), as the 21b and 21e walks did. |
| 3 | Architecture Fit | GO | AC4's possible fix reuses the existing `owner_step_open` path (`withOwnerStepOpen`, `finishWithoutSession`) and the fit's own grant-need logic (`grantNeeds`, `ownerStep` in `fit.ts`). The kernel decides whether a session starts (invariant 2). |
| 4 | Scope vs Supervisor Capability | GO | One worker: one evidence file plus, only if AC4 proves the gap, a small change in `fit.ts` / `dry-run.ts`, one test block and one docs paragraph. |
| 5 | Hard Blockers | CAUTION | Validation 2 is a running-system walk: the kernel installed as the launchd service and the packaged app, both built from the walked commit; the owner's ClickUp connection and its `studio-sandbox` tagged task; real review sessions (AC3, AC5: ~100k tokens each). It changes the owner's store (new crew members, a GitHub write grant, playbooks). Prior walks (21b, 21e) were run by Claude at the owner's request on this Mac, so it is achievable, but not inside a sandbox. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Walk 21b's Validation 2 steps 1, 3, 4 and 6 and 21e's step 6 (AC5) live in the packaged app on the merged `main`, observe the untested ClickUp-poll / no-jobs / no-grant dry-run interaction, record every step in one evidence file, and land a fix only for a step the walk proves broken.

**Problem Statement:**
The owner needs wave PR #279 (merged at `94785599`; `main` at `1949901e`) shown working on the code that actually merged, because phase 8's exit re-run depends on it.
Currently, 21b steps 2 and 5 passed at `3e4181a5`, but two later commits (`507b75e6`, `6d855422`) changed how a new member's grant is saved: the settings file is no longer written before the commit, and `ensureAgentFiles` rebuilds it after the commit from the recorded `agent_settings_set` grant (`recordedConnectors`, `kernel/src/agents/charter-files.ts`). 21b step 3 runs exactly that path and was last walked on the old code; steps 1, 4 and 6 were not re-walked, and optional step 7 never ran. 21e passed at `516a90a2`, but its step 6 (grant GitHub write, dry-run again with a new key, the review runs; 21e AC5) was never walked live and the summary-wording fix `fa3abd3a` is covered by tests only. Read from the code (not observed): `ownerStepsOf` (`kernel/src/playbooks/dry-run.ts`) returns `[]` for a `no_jobs` fit, and `playbookFit` (`kernel/src/playbooks/fit.ts`) returns `no_jobs` with `owner_steps: []` before it ever calls `grantNeeds` (which already knows a poll source's read grant: `watching ${CONNECTOR_LABELS[kind]}`); `previewPoll`'s tracker branch checks only `mcpConnectorGate`, not the member's own ClickUp grant (the GitHub branch checks `needsGithub`). So a member with no ClickUp grant, dry-running a ClickUp poll playbook that names no jobs, may list the tickets and then start a ~100k-token review session that cannot read them.
Success looks like one evidence file `docs/evidence/phase-8-22a-wave-1-walk-on-main.md` with every AC's observed output and a verdict, ending `Verdict: PASS for Validation 2`, and a fix (with a test) only if the walk proved one needed.

## Acceptance Criteria

Evidence rule for every criterion below: the observed output lives in the committed evidence file `docs/evidence/phase-8-22a-wave-1-walk-on-main.md` (Markdown, fenced output blocks), never only in the PR body; the PR body links to it.

**Happy path:**
- [ ] **AC1.** Given the kernel installed as the launchd service and the packaged app, both built from `main` at a recorded commit, when 21b's Validation 2 steps 1, 3, 4 and 6 are walked, then each passes as written in the 21b evidence file (`docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md` §"Validation 2"). In particular, a member created with Read tickets and Comment on tickets ticked holds exactly those capabilities' usable tools in its settings file (`studio agents show <id>`), and the `agent_settings_set` event records the same grant — and a committed evidence file `docs/evidence/phase-8-22a-wave-1-walk-on-main.md` contains, per step, the observed output and a PASS/FAIL line, plus the walked commit, the service pid and `sw_vers -productVersion`.
- [ ] **AC2.** Given that member, when its settings file is removed and the next crew message (or `ensureAgentFiles`) runs, then the file comes back holding the same grant, and the inspector shows the same capabilities granted — and the evidence file contains the before/after `studio agents show <id>` output (or the settings file's `connectors` block) and the inspector observation.
- [ ] **AC3.** Given a crew member with a ClickUp poll playbook and an open owner step (21e's setup), when the owner grants the missing GitHub write in Team and dry-runs again with a new key, then the review session runs as before (21e AC5), its tokens are recorded, and the summary makes one claim about the enable — and the evidence file contains the `playbook_runs` row (id, status, session_id, tokens) and the summary text.

**Edge cases:**
- [ ] **AC4.** Given a crew member whose only duty is `source: "clickup"`, `jobs: []`, with no ClickUp grant, and a ClickUp poll playbook for it that names no jobs, when it is dry-run, then the result is stated as observed in the evidence file: whether a review session started, its tokens, and the summary. If a session starts that cannot read the tickets, the dry run instead starts no session and names the missing ClickUp access as the owner's step, in plain words, with 0 tokens, and stores the run `done` (the same shape as 21e's `owner_step_open`: items listed, `poll.reviewed` null, `poll.preview_incomplete = {reason: "owner_step_open", fix}`, `session_id` NULL) — proven by a kernel test in `kernel/test/playbooks-dry-run-poll.test.ts` and by a re-walk of AC4 at the fixed head recorded in the evidence file.
- [ ] **AC5.** Given AC4's member after the owner grants it Read tickets, when it is dry-run again with a new key, then the review runs as for any member with access — and the evidence file contains that run's `playbook_runs` row and tokens.

**Error scenarios:**
- [ ] **AC6.** Given any step of the walk that fails at `main`, then the failure is recorded in the evidence file with its observed output before anything is fixed, and a fix lands only for what the walk proved broken (the evidence file's order shows the failing observation before the fix commit's re-walk).

**Static validation (requirement Validation 1):** `cd kernel && npm ci && npm test` and `bash scripts/check-docs.sh` pass, including a test for AC4's no-session outcome if a fix lands; their summaries are recorded in the evidence file.

## Touched-file invariants

> Grounded at base `1949901eede7ba7e3d00c4be23f4b0c8e187b67b`. Every worker re-checks the entries for the files in its lanes before hand-back. The script entries apply only if AC4's walk proves the gap and a fix lands.

- **`kernel/src/playbooks/fit.ts`** — keep: the module's never-throw contract, `Never throws: a failure to read is \`unchecked\` with its reason.`; the fail-closed rule that an unreadable stored value is never `no_jobs` (`// A stored value that does not read whole is never "no jobs" (fail closed): only null is.`); the CLI-safe import set (`it imports only \`node:\` builtins`) — the `studio` CLI loads this module through `./enable.ts`, so no Agent SDK, session manager or `kernel.ts` import; connector grants are the owner's and never in `proposed_update`. reuse: the existing poll-source grant logic (`function grantNeeds(store: Store, row: PlaybookRow, tools: readonly CatalogueTool[]): GrantNeed[]`, which already adds `why: \`watching ${CONNECTOR_LABELS[kind]}\``), `holdsConnector`, and the plain-words sentence builder `function ownerStep(name: string, need: GrantNeed): string` — never a second copy of the owner-step wording. mirror: the `no_jobs` line `This playbook names no jobs, so ${name}'s tools were not checked against it.` and `enable.ts`'s `if (fit === undefined || fit.status === "no_jobs") return [];` (the enable's lines stay unchanged for a `no_jobs` fit unless the walk proves otherwise). pinned by: `kernel/test/playbooks-fit.test.ts` — `expect(crew.fit).toMatchObject({ status: "no_jobs", missing: [], owner_steps: [] });` (a no-trigger `no_jobs` playbook must still read `owner_steps: []`).
- **`kernel/src/playbooks/dry-run.ts`** — keep: the decision order, `// An earlier reason (no connector, no grant, a failed fetch, no item, an unreadable key) keeps its own wording.` then `if (plan !== undefined && ownerSteps.length > 0) return finishWithoutSession(`; the skip is decided in the `checks` phase before `phase = "starting";` so a refusal releases the step; Wright-owned playbooks (no fit) stay unchanged. reuse: `ownerStepsOf` (`function ownerStepsOf(fit: PlaybookFit | undefined): readonly string[]`) as the one place that decides which fits skip the review, and `withOwnerStepOpen` from `./dry-run-poll.js` — no new `preview_incomplete` reason. mirror: the tool description string naming `owner_step_open` and `fit.owner_steps` (`name each of fit.owner_steps to the owner in plain words as their step, never propose them`). pinned by: `kernel/test/playbooks-dry-run-poll-unit.test.ts` (the tool description names `owner_step_open` and `fit.owner_steps`) and `kernel/test/playbooks-dry-run-poll.test.ts` `describe("a crew member's poll playbook with an owner step open: owner_step_open (21e AC1-AC7)"`.
- **`kernel/test/playbooks-dry-run-poll.test.ts`** — keep: every existing 21e case green, in particular `expect(poll.preview_incomplete?.reason).toBe("owner_step_open");` and the forbidden-token check `const TOKENS = ["owner_step_open", "charter_gap", "mcp__", "kernel_"];` (the summary shows none of them). reuse: the 21e describe block's real-store harness (`createAgent` crew member, shipped catalogue, a session starter that throws if called) and the ClickUp fixtures of `describe("a ticket poll's dry run: its own connection, no GitHub, the tracker named (AC9)"` (`CLICKUP_SPEC`, `listTool`) rather than new fixtures.
- **`docs/architecture/dry-run.md`** — keep: the reasons table row for `owner_step_open` and its paragraph. mirror: if the fix lands, the sentence `A Wright-owned playbook (no fit) and a crew playbook whose fit is \`unchecked\` or \`no_jobs\` are unchanged.` must be updated to say a `no_jobs` crew playbook whose poll source's grant the member lacks now takes `owner_step_open`. pinned by: `bash scripts/check-docs.sh`.

## Pin mutations

Applies only if AC4's fix lands (the test is new then).

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/playbooks-dry-run-poll.test.ts` — the new AC4 case (a `no_jobs` ClickUp poll playbook whose member lacks the ClickUp grant starts no session and stores `owner_step_open` with 0 tokens) | revert `ownerStepsOf` in `kernel/src/playbooks/dry-run.ts` so a `no_jobs` fit returns `[]` again (the base line `return fit !== undefined && (fit.status === "fits" || fit.status === "gap") ? fit.owner_steps : [];`) — the case must go red (the throwing session starter is called) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Walk 21b/21e on merged main, record evidence, fix only what the walk proves broken | all (AC1–AC6) | 0–4 modify (conditional), 1 create | `skills/unit-testing/SKILL.md`, `skills/verify-walkthrough/SKILL.md` | LAUNCHABLE |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| evidence | — | `docs/evidence/phase-8-22a-wave-1-walk-on-main.md` | HIGH |
| AC4 fix (conditional: only if AC4's walk shows a session starting) | `kernel/src/playbooks/fit.ts` (324), `kernel/src/playbooks/dry-run.ts` (671) | — | MEDIUM |
| AC4 test (conditional, with the fix) | `kernel/test/playbooks-dry-run-poll.test.ts` (1378) | — | MEDIUM |
| docs (conditional, with the fix) | `docs/architecture/dry-run.md` (181) | — | MEDIUM |

Reused unchanged: `kernel/src/playbooks/dry-run-poll.ts` (455) — `withOwnerStepOpen` and the `owner_step_open` reason already give AC4's required shape, so no new reason value is added (no closed enumeration touched).

### Module layout

- **New responsibility — "the owner step for a `no_jobs` crew poll playbook whose member lacks the poll source's grant":** home is `kernel/src/playbooks/fit.ts` (324, under the threshold; the single authority for grant needs and owner-step wording — `grantNeeds`, `holdsConnector`, `ownerStep`). Preferred shape: an exported helper there (e.g. the poll-source owner steps of a row for its member) that `dry-run.ts` calls for a `no_jobs` fit, so `playbookFit`'s `no_jobs` result and the enable's lines stay as they are. The worker may instead fill `owner_steps` in the `no_jobs` branch only if the `playbooks-fit.test.ts` pin above stays green and `enable.ts` is untouched.
- **`kernel/src/playbooks/dry-run.ts` (671, past the threshold):** appended to only in `ownerStepsOf` (a one-to-few-line change) — reason: it is the single place that decides which fits skip the review session; no new function lands in this file.
- **`kernel/test/playbooks-dry-run-poll.test.ts` (1378, past the threshold):** one `it(...)` case appended inside the existing 21e describe block — reason: it is the block that pins `owner_step_open` over a real store, and the requirement's Touches names this file; no new helper is copied.

## Parallelism Analysis

single-agent (no fan-out)

### Dependency Graph
```
Subtask 1 (independent)
```

### Batch Plan
- **Recommended workers:** 1
- **Estimated batches:** 1

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "docs/evidence/phase-8-22a-wave-1-walk-on-main.md"}
  - {kind: "symbol", path: "docs/evidence/phase-8-22a-wave-1-walk-on-main.md", name: "Verdict: PASS for Validation 2"}
requires: []
lanes:
  - "docs/evidence/phase-8-22a-wave-1-walk-on-main.md"
  - "kernel/src/playbooks/fit.ts"
  - "kernel/src/playbooks/dry-run.ts"
  - "kernel/src/playbooks/dry-run-poll.ts"
  - "kernel/test/playbooks-dry-run-poll.test.ts"
  - "docs/architecture/dry-run.md"
external_requires:
  - "The owner's Mac: launchd kernel service (`service install`) and the packaged Loomwright Studio app (`npm run package`) built from the walked commit"
  - "The owner's ClickUp connection (`mcp_connections` row `clickup`, connected) and the `studio-sandbox` tagged task in the Loomwright Studio list"
  - "The owner's go for store changes during the walk (new crew members, a GitHub write grant, playbooks) and for ~2 real review sessions (~100k tokens each)"
```

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` (vitest pin for AC4, if a fix lands), `skills/verify-walkthrough/SKILL.md` (evidence-per-AC, observed-output verdicts) |

Walk procedure sources the worker reads first: `docs/evidence/phase-8-21b-tracker-grant-in-plain-words.md` §"Validation 2" (steps 1–7), `docs/evidence/phase-8-21e-dry-run-owner-step.md` §"Validation 2" (steps 1–6), `docs/evidence/phase-8-exit-runbook.md` §"Setup" (step 8: kernel as the launchd service, packaged app from Finder).

Walk order (so AC6 holds): (1) build `main` at the recorded commit, install the service, package the app; (2) AC1 (21b steps 1, 3, 4, 6; step 7 optional), AC2 on the AC1 member; (3) AC3 on a 21e-shaped member; (4) AC4 then AC5; (5) record every observation, including any FAIL, in the evidence file and commit it; (6) only then, for a step that failed, write the fix and its test, rebuild, reinstall, and re-walk that step at the fixed head, appending the re-walk; (7) turn every test member and playbook created by the walk off (Studio has no delete: owner decision 2026-11-14); (8) end the file with `Verdict: PASS for Validation 2` only when every AC passed at the final head.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): Validation 2 needs the running system — launchd service, packaged app, the owner's ClickUp connection and store — which a sandboxed worker may not reach. | HIGH | The worker drives it as the 21b/21e walks did (`npm run build`, `service install`, `npm run package`, `open`, `studio ask`, `studio agents show`, `sqlite3 -readonly`). If the worker cannot reach the running system, it records exactly which steps it could not run and why, writes no verdict line, and hands back — never a fabricated PASS. |
| AC3 and AC5 run real review sessions (~100k tokens each; run 189 used 124,277). | MEDIUM | Run each once; record tokens per run in the evidence file; no repeated dry runs with the same intent. |
| The walk changes the owner's store (crew members, a GitHub write grant on a member, playbooks). | MEDIUM | Fresh members per the owner decision (2026-11-14); turn each test member and playbook off afterwards and list them in the evidence file. The GitHub write grant is given to the walk's own test member only. |
| AC4's outcome is read from the code, not observed; the fix might be unneeded, or the real failure might differ. | MEDIUM | AC6 order: observe and record first; fix only what is observed. If the walk shows no session (or a different failure), the fix's shape follows the observation, not this brief's preferred shape. |
| A `no_jobs` change in `fit.ts` could alter the enable's lines or the `no_jobs` fit pin. | MEDIUM | Prefer the exported-helper shape consumed only by `dry-run.ts`; keep `playbooks-fit.test.ts` green and `enable.ts` untouched (Touched-file invariants). |
| Wright drafts playbooks nobody asked for (seen in 21b's walk; item 21f, PR #280 merged). | LOW | Record it if seen; out of scope here (requirement non-goal). |
| Raw CLI or `tools/list` output could carry secrets or home paths into the repo. | LOW | Commit only names, counts and fenced CLI output (no screenshot directory: it is outside the requirement's Touches; a screenshot needed as proof is named, not committed); no tokens; write home paths as `/Users/<name>/`. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-14-phase-8-22a-wave-1-walk-on-main.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-15T03:48:23Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/283
- **Branch:** feature/phase-8-22a-wave-1-walk-on-main
- **Files changed:** 7
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** true
- **Until-mergeable log:** .supervisor/logs/review-pr-dispatch-20261115T034803Z-596be15305624e807122856b5bb05e8d13a3787a.log
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Wave 1 of phase 8 item 21 walked live on main (1949901e). AC1-AC3 PASS; AC4 FAIL observed (run 192, 50,752 tokens) and committed first (52e605a6); fix a0aaa8ef (a no_jobs ticket poll dry run names the member's missing poll access, starts no review); AC4 re-walk and AC5 PASS; screens checked on the running app (fae39531); evidence ends 'Verdict: PASS for Validation 2'. Phase 4.5: iteration 1 fixed one MEDIUM (stale fit.owner_steps wording, a9bda4d7), iteration 2 PASS; 4 LOW/nit dismissed. Resumed with --continue: the finalize-gate marker refused no_active_session (documented resume-into-FINALIZE residual); children-settled was checked by hand (settled) before each push.

## Not verified
- **Repackaged app after the kernel-only fix** — not opened (subtask 1)
- **Triggers 22-24** — not turned off directly; their playbooks are disabled (subtask 1)
