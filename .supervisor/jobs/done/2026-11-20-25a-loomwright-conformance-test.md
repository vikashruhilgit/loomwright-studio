# Supervisor Job: 25a — a conformance test catches every Loomwright command the rail would deny

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-20-174137/L1
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement is gitignored run history, `.supervisor/*`, so its provenance lives on the metadata branch, not `main`)
- **Source requirement:** .supervisor/requirements/phase-8-25/2026-11-20-120000-25a-a-conformance-test-catches-every-loomwright-command-the-rail-denies.md
- **Base commit:** 9b3ca660fba2decaaef7c34aa08f4d5b2ec91bfd

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest (`kernel/package.json` `"test": "vitest run"`); `tsconfig.json` `"include": ["src", "test"]` so the new test and helper typecheck. |
| 2 | Dependency Availability | GO | No new dependency. The real policy is `decideToolUse(policy, toolName, toolInput)` in `kernel/src/sessions/policy.ts` (the requirement says `decide`; this is the function); script admission is `loomwrightScriptPaths(installPath, names)` in `kernel/src/sessions/loomwright-scripts.ts`; the policies are exported from `kernel/src/automate/launch.ts` (`AUTOMATE_RUN_POLICY`, `REVIEW_PR_RUN_POLICY`, `MERGE_PARKED_RUN_POLICY`, `MERGE_PARKED_TRUSTED_RUN_POLICY`). `RUN_BASH_PREFIXES` itself is not exported; the test reads it through `AUTOMATE_RUN_POLICY.allowedBashPrefixes`. |
| 3 | Architecture Fit | CAUTION | The repo convention is that no test reads the real `~/.claude/plugins/installed_plugins.json` (`kernel/test/fixtures/loomwright/README.md`: "No test reads the real `~/.claude/plugins/installed_plugins.json`"), and live checks are opt-in through `STUDIO_LIVE=1` (`kernel/test/phase-8-exit-live.test.ts`: `const LIVE = process.env.STUDIO_LIVE === "1"`). The default run therefore uses the committed fixture, and the resolved install is read only under `STUDIO_LIVE=1` or in update mode. |
| 4 | Scope vs Supervisor Capability | CAUTION | 8 files. Hand-written code is about 1,600 lines, not counting the generated fixture JSON: extractor about 350, conformance test about 400, `run-exclusions.ts` about 400 (one row per instructed denial class across 4 kinds), probe test about 400, refresh script about 40. That is past the 800-line `context-bound` bound. The work splits into two groups with no shared files: Part A (conformance) and Part B (past-the-rail probe). |
| 5 | Hard Blockers | CAUTION | CI has no Loomwright install (`.github/workflows/ci.yml` runs `npm ci` + `npm test` only). The Part B probe runs the install's real scripts, so in CI it skips with a stated reason and its committed evidence comes from a local run. Two helper/evidence paths fall outside the requirement's Touches (see Scope widening). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Add a kernel conformance test that extracts every command, script call and Claude tool name that Loomwright 18.1.2's instruction files and drivers tell each kernel session kind to use. The test runs each one through that kind's real run policy and fails on any denial that has no recorded exclusion. Separately, a probe records what admitted scripts do past the rail.

**Problem Statement:**
The owner running phase 8's live walk needs CI to fail when the installed Loomwright instructs a kernel-run session to use something Studio's rail denies without a recorded reason. Every phase 8 live run since 2026-11-12 died on a different denial (23a, 23e, 23k, 23q, 24a…).
Currently the run policies in `kernel/src/automate/launch.ts` come from hand-run greps over 17.38.0 text, one session kind at a time. The 2026-11-20 sweep of 18.1.2 found calls no grep had covered: `self-heal-advisory/` calls `phase45-ci-read.sh` and `reconcile-jobs.sh`, and Launch Pad calls `automate-lanes.sh scope-outside` and `gate-auto.sh decide`. Each live run therefore finds the next denial one round at a time.
Success looks like this: `npm test` is green on day one, with every current gap listed as a known exclusion. Removing a needed prefix turns it red and names the instructing file:line. Running the refresh against a new release shows exactly what Loomwright added or removed.

## Design decisions
- decision: where the instruction extractor (markdown, fences, backticks, `bash "${CLAUDE_PLUGIN_ROOT}/scripts/…"`, driver `invocation`/`launch`/`push`/`then` text, tool names) lives
  chosen: a new test helper module `kernel/test/fixtures/loomwright-instructions/extract.ts`, beside the existing `kernel/test/fixtures/loomwright/helpers.ts` pattern, imported by the conformance test (and through update mode, by the refresh script)
  rejected: inline in `kernel/test/loomwright-conformance.test.ts`: it is a separate concern from the policy checks and would push the test past the §"Module layout" threshold (blast radius: partial; test cost: yes)
  rejected: extraction in bash inside `scripts/refresh-loomwright-fixture.sh`: it does not fit the stack (macOS bash 3.2 parsing markdown fences), and the test would need a second extractor for live mode (fits stack: no)
  evidence: `ls kernel/test/fixtures` → `loomwright/helpers.ts`, `loomwright-run-files/harness.ts` (helpers live under `test/fixtures/<name>/`); `kernel/tsconfig.json` `"include": ["src", "test"]`
  revisit when: a second consumer outside the tests (for example the 25d stale-exclusion check run by the daemon) needs the extractor, which would move it under `kernel/src/`
  status: confirmed
- decision: how `scripts/refresh-loomwright-fixture.sh` regenerates the fixture
  chosen: a thin wrapper (`cd kernel && LOOMWRIGHT_FIXTURE_UPDATE=1 npx vitest run test/loomwright-conformance.test.ts`, then `git diff --stat` on the fixture), so there is one extraction code path
  rejected: a standalone node extraction script: two extractors would drift (reversibility: no; blast radius: no)
  evidence: `ls scripts` → only `check-docs.sh` (no node script tooling at the root); `kernel/package.json` already has vitest
  revisit when: the fixture must be refreshed where vitest cannot run
  status: confirmed
- decision: home of the exclusions table and the "runs past the rail" table
  chosen: a new frozen data module `kernel/src/automate/run-exclusions.ts` (named by the requirement's Touches), which exports the two tables and their row types. It is data only: `launch.ts` does not import it and no policy reads it.
  rejected: the existing prose lists in `launch.ts`'s doc comments (lines 191-247): prose cannot be checked, and editing `launch.ts` is out of scope (fits stack: partial; blast radius: no)
  rejected: a table inside the test file: 25d needs to consume and prune it as a module (reversibility: partial)
  evidence: `kernel/src/automate/launch.ts:231-240` holds the current exclusion reasons as comment prose only; `grep -rn "exclusion" kernel/src` → no existing table
  revisit when: 25b/25c/25d make the policy read the table (then it becomes a policy input and needs invariant review)
  status: confirmed

## Acceptance Criteria
- [ ] 1. Given the committed fixture `kernel/test/fixtures/loomwright-18.1.2-instructions.json` (extracted from the 18.1.2 install), or under `STUDIO_LIVE=1` the install `resolveLoomwrightInstall()` returns, when `kernel/test/loomwright-conformance.test.ts` runs, then it holds every extracted entry for each kernel session kind (`backlog` and `resume`, which share `AUTOMATE_RUN_POLICY` with `--inline-phases`; `review_pr`; `merge_parked`, plain and trusted). Entries are script calls (`scripts/<name>.sh [subcommand]`), backticked and fenced shell commands, Claude tool names, and the four drivers' printed `invocation` / `launch` / `push` / `then` text. Each entry carries its source `file:line` and the kinds it applies to.
- [ ] 2. Given each kind's instruction file set, when the test runs, then the set is a named closed constant per kind in the test, with a one-line reason per file. Every listed file must exist in the source (a renamed or removed Loomwright file fails the test and is never silently dropped). The backlog/resume set includes `skills/commit/SKILL.md`, `skills/self-heal-advisory/*.md`, `skills/review-heal/*.md`, `agents/launch-pad.md` and `commands/launch-pad.md`, plus the drivers `scripts/automate-next-step.sh`, `scripts/supervisor-next-step.sh`, `scripts/launch-pad-phase.sh` and `scripts/review-heal-next-step.sh`. A transitive reference closure is NOT used: it pulls about 75 files, about 2 MB, including `commands/setup.md` and `commands/dreaming.md`.
- [ ] 3. Given each extracted entry, when it is decided by `decideToolUse` (`kernel/src/sessions/policy.ts`) with that kind's policy from `launch.ts`, then the entry is either `allow`, or it matches exactly one row of the exclusions table in `kernel/src/automate/run-exclusions.ts`. A Bash entry is decided with `admittedScriptPaths` built by `loomwrightScriptPaths(<install or fixture root>, policy.loomwrightScripts)`, and a merge entry with a `loomwrightRunId`. Each row has: match, kinds, a reason class (including `advisory, never instructed`), a written reason, a `consequence if denied:` line, and an optional `filed: 25b|25c|25d`. Any other denial fails the test with a message naming the command, the session kind, the deny reason and the source `file:line`.
- [ ] 4. Given an exclusion whose reason class states a fact about a script (`starts a claude process`, or `runs eval / bash -c`), when the test runs, then it checks the fact against the script text: a `claude` invocation present; `eval` or `bash -c` present. The text comes from the fixture's per-script facts, or from the install under `STUDIO_LIVE=1`. A false fact fails the test. A row whose reason is already known to be false is marked `reason_fact_false: "filed: 25c"`. For a marked row the test asserts that the fact IS false, so CI stays green and the bite is visible, and it turns red once the fact becomes true or 25c corrects the reason. The rows for `gate-auto.sh` and `run-benchmark.sh` carry today's `launch.ts:232` / `:236` reasons with this marker; 18.1.2 contains no `claude` and no `eval` / `bash -c` in either script, verified by grep.
- [ ] 5. Given a new Loomwright release is active, when `bash scripts/refresh-loomwright-fixture.sh` runs, then the fixture is regenerated from the resolved install through the test's update mode (`LOOMWRIGHT_FIXTURE_UPDATE=1`). Its file name or `version` field names the release, it holds install-relative paths only (no absolute home path), and `git diff` on it shows exactly the entries Loomwright added or removed. The fixture's entry order is deterministic: sorted by file, then line, then text.
- [ ] 6. Given a command shape the extractor cannot parse, when the test runs, then the entry is kept as `unparsed` with its source `file:line` (never dropped), and the test fails while any `unparsed` entry has no exclusion row.
- [ ] 7. Given commands that Loomwright's own scripts run internally, when the test runs, then each is listed in a separate exported "runs past the rail" table in `run-exclusions.ts` with script, line and condition. The list covers at least `review-heal-next-step.sh`'s `gh pr comment` (`rh_comment`, lines 289-291), `send-webhook.sh` (318), the detached `dispatch-pr-postmortem.sh` (323, 1098) and `automate-next-step.sh`'s `nohup bash "$HERE/automate-merge-watch.sh"` (814). For each row, the test checks that the cited line's text matches the fixture or install (an anchor substring), so a moved line fails.
- [ ] 8. Given today's `launch.ts`, when `npm test` runs, then it is green, and every current gap appears as an exclusion with `filed: 25b|25c|25d`. Nothing in `kernel/src/automate/launch.ts`, `kernel/src/sessions/policy.ts` or `kernel/src/sessions/loomwright-scripts.ts` changes: `git diff <base>` lists none of them.
- [ ] 9. Given the bite checks (requirement Validation 2 and 3), when they are run by hand on a scratch copy, then a committed evidence file `docs/evidence/phase-8-25a-conformance.md` holds the commands and the test output. The first check removes `"git commit"` from `RUN_BASH_PREFIXES` and the test fails naming `skills/commit/SKILL.md`; restoring it makes the test pass. The second check deletes the `reason_fact_false` marker on the `gate-auto.sh` row and the reason check fails. The PR body links to the file.
- [ ] 10. Given each script the four run policies admit, when `kernel/test/loomwright-past-the-rail-probe.test.ts` runs with `STUDIO_LIVE=1` and a resolvable install, then the probe records the script's outward calls and started processes, with the condition that triggers each. Without both, the probe is skipped and the skip reason names `STUDIO_LIVE=1`, so plain `npm test` and CI never run real Loomwright scripts (the repo convention).
  - **Setup:** the probe works in a scratch git repo with stub `gh`, `claude`, `curl` and a bare `origin` remote. The stubs sit first on `PATH` and record their argv to a log. The probe uses the scripts' own seams where they exist (`LOOMWRIGHT_GH_BIN`, `RH_POSTMORTEM_CMD`, `NEXT_STEP_WATCH_CMD`).
  - **Static scan:** it picks which scripts run dynamically. For each admitted script it reads:
    - its own text;
    - every file the script loads (`. "<f>"`, `source`, and the `_ms_source` / `_ah_source` module loaders over `<name>.d/*.sh`);
    - every sibling script it calls (`bash "$HERE/<x>.sh"`).

    It counts the hits against the admitted script.
  - **Outward tokens:**
    - `gh` (`gh `, `${LOOMWRIGHT_GH_BIN:-gh}`, `$GH` / `${GH`);
    - `claude`, `curl`, `nohup`, a trailing `&`, `send-webhook.sh`, `dispatch-*.sh`;
    - a push through any git wrapper (`\bpush\b` with `origin`; for example `meta-sync.d/commands.sh` runs `g push -q origin`).
  - **Recording:** a script with zero hits is recorded `no outward call in text (static, loaded files followed)`.
  - **Dynamic runs:** they cover at least:
    - the `review-heal-next-step.sh` paths (comment, webhook, postmortem);
    - the `automate-next-step.sh` `awaiting_merge` watcher launch;
    - the `meta-sync.sh` push to `origin`.
- [ ] 10a. Given a synthetic instruction line the extractor cannot parse (an in-test input, not the fixture), when the conformance test's extractor unit case runs, then the line comes back as `unparsed` with its `file:line`. With no matching exclusion, the conformance check on that input reports it as a failure. This makes AC 6 bite even on a day with no real `unparsed` entries.
- [ ] 11. Given the probe's results, when it is complete, then the committed evidence file `docs/evidence/phase-8-25h-past-the-rail.md` lists every outward call and started process with script:line, trigger condition and evidence kind (`observed (probe)` or `read (static)`). Each row is marked `already gated elsewhere` / `harmless` / `needs a kernel-owned path`, and a needs-a-path row carries a proposed path (for example the kernel setting `NEXT_STEP_WATCH_CMD` to a kernel-owned watcher, or `auto_postmortem: false` in a kernel run's config) as an owner decision. The PR body links the file.
- [ ] 12. Given this story, when it lands, then no run policy changes: each `needs a kernel-owned path` row is an owner decision and is never applied here.
- [ ] 13. Given the repo's gates, when the PR is ready, then `cd kernel && npm ci && npm test` and `npm run typecheck` pass, and `bash scripts/check-docs.sh` passes, so both evidence files' relative links resolve.

## Scope widening
- kernel/test/fixtures/loomwright-instructions/extract.ts
- docs/evidence/phase-8-25a-conformance.md
- accepted: LP-SCOPE 2026-11-21

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| Part A: conformance | none (`kernel/src/automate/launch.ts` (734), `kernel/src/sessions/policy.ts` (1463) and `kernel/src/sessions/loomwright-scripts.ts` (429) are read and imported only, never modified) | `kernel/test/loomwright-conformance.test.ts`, `kernel/test/fixtures/loomwright-instructions/extract.ts`, `kernel/test/fixtures/loomwright-18.1.2-instructions.json` (generated), `kernel/src/automate/run-exclusions.ts`, `scripts/refresh-loomwright-fixture.sh`, `docs/evidence/phase-8-25a-conformance.md` | HIGH |
| Part B: probe | none | `kernel/test/loomwright-past-the-rail-probe.test.ts`, `docs/evidence/phase-8-25h-past-the-rail.md` | HIGH |

Module layout: there are no MODIFY rows. Each new responsibility has one CREATE home: extraction in `extract.ts`, the policy checks in the conformance test, the two tables in `run-exclusions.ts`, regeneration in the refresh script, and the probe in its own test. No helper is copied: the probe and the conformance test share nothing beyond the exported policies.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/loomwright-conformance.test.ts` — an instructed `git commit` from `skills/commit/SKILL.md` must be admitted for `backlog` | flip `"git add", "git commit", ` → `"git add", ` in `kernel/src/automate/launch.ts` (red: names `skills/commit/SKILL.md`, kind `backlog`) |
| `kernel/test/loomwright-conformance.test.ts` — an instructed admitted script must stay admitted | flip `"guard-lane-wait-armed.sh", "lane-policy.sh",` → `"guard-lane-wait-armed.sh",` in `kernel/src/automate/launch.ts` (red: names the `lane-policy.sh` call's source file:line) |
| `kernel/test/loomwright-conformance.test.ts` — the reason fact check on `gate-auto.sh` | delete the `reason_fact_false` marker line of the `gate-auto.sh` row in `kernel/src/automate/run-exclusions.ts` (red: "starts a claude process" is false for `gate-auto.sh`) |
| `kernel/test/loomwright-conformance.test.ts` — `unparsed` entries need an exclusion (AC 10a's synthetic case) | delete the line in `kernel/test/fixtures/loomwright-instructions/extract.ts` that returns the `unparsed` entry for an unrecognised shape (red: the synthetic unparsable line is dropped and the AC 10a case fails) |
| `kernel/test/loomwright-conformance.test.ts` — the past-the-rail anchor check | flip the `review-heal-next-step.sh` `gh pr comment` row's line from `290` to `289` in `kernel/src/automate/run-exclusions.ts`. The row's anchor is the substring `pr comment "$PR" --body`, which only line 290 holds; line 289 is `rh_comment() {`. (red: anchor not found at the cited line) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Conformance test, extractor, exclusions + past-the-rail tables, fixture, refresh script, bite evidence | 1, 2, 3, 4, 5, 6, 7, 8, 9, 10a, 13 | 0 modify, 6 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Past-the-rail probe and its evidence (Part B) | 10, 11, 12, 13 | 0 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask contracts

```yaml
# Subtask 1 — conformance test (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/test/loomwright-conformance.test.ts"}
  - {kind: "file", path: "kernel/test/fixtures/loomwright-instructions/extract.ts"}
  - {kind: "file", path: "kernel/test/fixtures/loomwright-18.1.2-instructions.json"}
  - {kind: "file", path: "kernel/src/automate/run-exclusions.ts"}
  - {kind: "symbol", path: "kernel/src/automate/run-exclusions.ts", name: "RUN_EXCLUSIONS"}
  - {kind: "symbol", path: "kernel/src/automate/run-exclusions.ts", name: "PAST_THE_RAIL"}
  - {kind: "file", path: "scripts/refresh-loomwright-fixture.sh"}
  - {kind: "file", path: "docs/evidence/phase-8-25a-conformance.md"}
requires: []
lanes:
  - "kernel/test/loomwright-conformance.test.ts"
  - "kernel/test/fixtures/loomwright-instructions/extract.ts"
  - "kernel/test/fixtures/loomwright-18.1.2-instructions.json"
  - "kernel/src/automate/run-exclusions.ts"
  - "scripts/refresh-loomwright-fixture.sh"
  - "docs/evidence/phase-8-25a-conformance.md"
external_requires:
  - "Loomwright 18.1.2 install at the path resolveLoomwrightInstall() returns (fixture generation and STUDIO_LIVE=1 only)"

# Subtask 2 — past-the-rail probe (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/test/loomwright-past-the-rail-probe.test.ts"}
  - {kind: "file", path: "docs/evidence/phase-8-25h-past-the-rail.md"}
requires: []
lanes:
  - "kernel/test/loomwright-past-the-rail-probe.test.ts"
  - "docs/evidence/phase-8-25h-past-the-rail.md"
external_requires:
  - "Loomwright 18.1.2 install (the probe runs its real scripts; skipped with a stated reason when none resolves, as in CI)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `launch.ts:232` | yes (`kernel/src/automate/launch.ts`) | HOLDS | ` *   \`dispatch-pr-review.sh\`, \`hook-dispatch-on-pr-create.sh\`, \`automate-lanes.sh\`, \`gate-auto.sh\`;` | base 9b3ca660 |
| `launch.ts:236` | yes | HOLDS | ` *   \`rules-check.sh\`, \`worker-rule-selfcheck.sh\`, \`run-pin-mutations.sh\`, \`run-benchmark.sh\`;` | base 9b3ca660 |
| `launch.ts:224-240` | yes | HOLDS | the 23k exclusion comment block | base 9b3ca660 |
| `review-heal-next-step.sh:289-291` (18.1.2) | yes (install) | HOLDS | `"${LOOMWRIGHT_GH_BIN:-gh}" pr comment "$PR" --body "$1"` | install 18.1.2 |
| `review-heal-next-step.sh:318` | yes (install) | HOLDS | `bash "$HERE/send-webhook.sh" --event-type gate …` | install 18.1.2 |
| `review-heal-next-step.sh:323` / `:1098` | yes (install) | HOLDS | `rh_postmortem_call() { if [ -n "${RH_POSTMORTEM_CMD:-}" ] …` / `rh_once postmortem rh_postmortem_call` | install 18.1.2 |
| `review-heal-next-step.sh:812, 821, 998` | yes (install) | HOLDS | `rh_comment "$body"` | install 18.1.2 |
| `automate-next-step.sh:814` | yes (install) | HOLDS (seam at 810: `if [ -n "${NEXT_STEP_WATCH_CMD:-}" ]`) | `nohup bash "$HERE/automate-merge-watch.sh" "$RF" "$ITEM" "$PR"` | install 18.1.2 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5) check 3: the repo convention says no test reads the real `installed_plugins.json` | MEDIUM | The default run uses the committed fixture. The resolved install is read only under `STUDIO_LIVE=1` (the existing live-test switch) or `LOOMWRIGHT_FIXTURE_UPDATE=1` (the refresh script). |
| Feasibility (Phase 2.5) check 4: more than 800 changed lines | MEDIUM | Split into two subtasks with no shared files. The fixture is generated, so review targets the extractor, the tables and the checks. |
| Feasibility (Phase 2.5) check 5: CI has no install, so the Part B probe cannot run there | MEDIUM | `describe.skipIf` with a stated reason. The evidence doc records the local run (date, version, command, output) and marks each row `observed (probe)` or `read (static)`. Requirement Validation 0 is run locally. |
| Over-extraction: prose that only mentions a command makes the exclusions table long | MEDIUM | Use the `advisory, never instructed` reason class. Each row matches by pattern rather than one row per occurrence, but never so broadly that it hides a new instructed command (a row covering more than one kind must name its kinds). |
| The requirement asks for both "the gate-auto reason check fails" and "CI green on day one" | MEDIUM | The `reason_fact_false: "filed: 25c"` marker: the check runs, asserts the fact is false, and goes red when 25c fixes the reason. The bite is shown in `docs/evidence/phase-8-25a-conformance.md`. |
| Tool-name aliasing: instructions say `Task(`, `TaskOutput`, `LSP`, while `RUN_TOOLS` grants `Agent` | MEDIUM | The extractor records the name as written. Any alias mapping (`Task` → `Agent`) is a documented table in the test with its source; an unmapped name is a denial that needs an exclusion. |
| Placeholders in instructed commands (`<pr url>`, `{pr_url}`, `$(git rev-parse HEAD)`) | MEDIUM | Substitute angle-bracket and brace placeholders with fixed sample values before deciding. Keep `$(…)` and other real metacharacters as written: the rail really denies them, so they become exclusions filed to 25b/25c. |
| The probe executes real scripts that could post outward | HIGH | It runs only under `STUDIO_LIVE=1`, never in plain `npm test` or CI. Use only a scratch repo under the OS temp dir. Put stub `gh`/`claude`/`curl` first on `PATH` and set the seams (`LOOMWRIGHT_GH_BIN`, `RH_POSTMORTEM_CMD`, `NEXT_STEP_WATCH_CMD`) to recorders. Network env is unset (`GH_TOKEN`, webhook URLs). Never run against `vendsy/*` or any real repo. |
| `skills/qa-gates/` from the 23k derivation no longer exists in 18.1.2 | LOW | The closed file-set check (AC 2) fails on a missing file, so the set is built from 18.1.2's real tree. |
| Scope widening: two paths sit outside the requirement's Touches | LOW | Recorded under `## Scope widening` as `pending-coordinator` for the coordinator's re-gate. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-20-25a-loomwright-conformance-test.md
```

## Plan Review: PASS (attempt 2/3)
- Deferred (LOW, below fix floor MEDIUM): kernel/test/fixtures/loomwright-instructions/ is a new directory Subtask 1 creates.
- Deferred (LOW): AC 7's rh_comment row cites line 290 (anchor `pr comment "$PR" --body`); 289-291 is the function's span — match pin row 5.

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-21T06:10:39Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/299
- **Branch:** feature/25a-loomwright-conformance-test
- **Files changed:** 9
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Conformance test + extractor + RUN_EXCLUSIONS/PAST_THE_RAIL tables + 18.1.2 fixture + refresh script + STUDIO_LIVE=1 past-the-rail probe + two evidence docs; no run policy changed. Three heal rounds fixed 5 MEDIUM+/HIGH findings (over-broad exclusion rows, obfuscated merge text); the round-3 HIGH (driver-refused-option hid de-admission of automate-next-step.sh) was fixed in f3d25a3f on the final round and not re-reviewed. CI green; npm test 5068 passed, typecheck/check-docs OK (fixer-run at f3d25a3f).

## Not verified
- **trail-pr.sh push / gh pr create** — static read only, not observed by the probe (subtask 2)
- **send-webhook.sh curl lines 405/427/663** — static only; one curl observed without a line pin (subtask 2)
- **PR body link to docs/evidence/phase-8-25a-conformance.md** — Supervisor opens the PR (subtask 1)
- **refresh script git diff across two releases** — only 18.1.2 is installed (subtask 1)
