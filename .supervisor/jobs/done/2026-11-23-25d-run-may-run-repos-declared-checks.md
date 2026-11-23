# Supervisor Job: 25d — a kernel-run session may run the repo's declared checks

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-20-174137/L6
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (the source requirement is gitignored under `.supervisor/*`, so its provenance is unverified)
- **Source requirement:** .supervisor/requirements/phase-8-25/2026-11-20-120300-25d-a-run-may-run-the-repos-declared-checks.md
- **Base commit:** 22a96fd7583933a385ee291709784250a28c641b

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel with vitest (`kernel/package.json`); the change is pure TS plus git reads through the existing helper. |
| 2 | Dependency Availability | GO | No new dependency. Kernel has no YAML parser: `yaml` appears in `kernel/package-lock.json` only as an optional peer and is not installed, so workflow `run:` lines are read by a small fail-closed line reader (Design decisions). |
| 3 | Architecture Fit | CAUTION | The gate (`decideToolUse`, `kernel/src/sessions/policy.ts`) is pure and reads no disk, and `kernel/test/automate-merge-check.test.ts` forbids any process call under `kernel/src/automate/`. The base-sha reads must go through `kernel/src/loomwright/run-state-checkout.ts` (the kernel's one git spawner), and the declarations reach the gate as a kernel-only `ToolPolicy` field. |
| 4 | Scope vs Supervisor Capability | CAUTION | 13 files (11 modify, 2 create) is past the 12-file bound: `context-bound`, split into 2 sequential subtasks. |
| 5 | Hard Blockers | CAUTION | Needs files outside the requirement's `## Touches` (types.ts, manager.ts, run-state-checkout.ts, three test files, the app's audit sentences). Recorded in `## Scope widening` for the coordinator's re-gate. |

**Overall Verdict:** CAUTION

## Task
**Goal:** A kernel-launched `backlog`, `resume` or `review_pr` run session may run exactly the checks its repo declares on the base branch (each workflow `run:` line, `npm test`, `npm run <script>`), admitted with reason `declared_check`. Every other execution stays refused.

**Problem Statement:**
The owner needs a ticket run's worker (and a `review_pr` fix worker) to run the repo's own declared checks. Without them Loomwright can't verify its change, and the Supervisor checkpoints with no PR.
Currently the run policy has no way to run project code: item 24a (session 249, studio-sandbox#21) was denied `chmod +x drum.sh`, `bash drum.sh` and `bash -n drum.sh` (events 38063 to 38078), and the same pattern ran through sessions 217, 224, 226, 231 and 236. Loomwright's worker, fix worker and code reviewer are all told to run the project's tests. When they are denied, the reviewer marks behaviour `unverified`, which forces `NEEDS_HUMAN`.
Success looks like this: in the next live walk, `npm test` is admitted `declared_check` in the session's `tool_decision` events and the ticket run opens its PR. A command the base branch does not declare, including one the run added to its own branch, stays refused.

**Design (binding where it says "must"):**
- `kernel/src/automate/declared-checks.ts` (new) owns reading and parsing. Its input is a base sha and a committed-file reader. Its output is the admitted checks, each a parsed word list plus its source (`workflow <file> job <id>` or `package.json scripts.<name>`), and the skipped lines, each with its reason. It **must not** start a process or name `child_process`/`execFile`/`spawn` (the `src/automate/` scan in `kernel/test/automate-merge-check.test.ts`). Its git reads go through new fixed-shape exports in `kernel/src/loomwright/run-state-checkout.ts` built on `lookupGit`: resolve the base ref to a sha, list `.github/workflows/` at that sha, read one blob at that sha. It never reads the working tree.
- **Base ref.** Use the stored repo policy's `default_branch` (`getRepoPolicy`, `kernel/src/integrations/github/repo-policy.ts`) as `refs/remotes/origin/<branch>`. When that is null, use the target of `refs/remotes/origin/HEAD`. When neither resolves, the run has no declared checks and records the reason `base_unresolved`. That is fail closed: never the working tree, never `HEAD`. The kernel does not fetch.
- **What counts as a declaration (AC1, AC3).** Every job's `run:` value in `.github/workflows/*.yml` and `*.yaml` at the base sha, read by a line reader. A block scalar (`run: |` or `run: >`), or any value the reader can't read as a single plain or simply quoted scalar, is skipped with a reason (`multi_line`, `unreadable_yaml`). Each value is parsed with 25b's `parseBashCommand` (`kernel/src/sessions/shell-words.ts`). `metacharacter` (a pipe, `&&`, a redirect, `$`, a newline) is skipped `shell_metacharacter`, and `unparsed` is skipped `unparsed`. From `package.json` at the base sha: `npm run <name>` for each `scripts` key, plus `npm test` when `scripts.test` exists. A name that doesn't parse to exactly one word is skipped. An unreadable or invalid `package.json` adds no npm checks and records why.
- **Admission (AC2, AC5).** New `ToolPolicy.declaredChecks?: readonly (readonly string[])[]` (`kernel/src/sessions/types.ts`). It is kernel-only like `loomwrightRunId`: set only by `launch.ts`, validated in `checkPolicy` (`manager.ts`) and copied by `freezePolicy`. No charter or settings reader builds it (they build explicit `{allowedTools, allowedBashPrefixes, never}` objects). In `decideToolUse`, it must be consulted **only** in a run policy (`loomwrightScripts` non-empty), and **only** where the decision would otherwise be `bash_prefix_not_allowed`. An existing allow or deny is never changed. The match is on `parsed.words` (never the `git -C` split words): the same length and every word equal. An extra argument, a different script or a prefix of a declaration does not match. A match still passes the run-state guard (`bashTouchesLoomwrightRunState`), so a declaration that names `.supervisor/automate` stays `loomwright_run_state`. Allowed ⇒ `{ decision: "allow", reason: "declared_check" }`, a new `ToolDecisionReason`. A `Monitor` watch whose `command` is exactly a declared check is admitted the same way, because the Monitor branch re-decides its command as Bash. That is intended: it is the same command line, and a test pins it. The `decideToolUse` doc comment gains a bullet for this admission path. The session manager's existing `tool_decision` event records it (AC8), with no new event code.
- **Which kinds.** `backlog`, `resume` and `review_pr` get `declaredChecks` read at launch, re-read at each launch or continuation from the base sha current then. The merge kinds (`merge_parked*`) get none, so the field is absent and they get no system prompt, as today.
- **Recorded with the session (AC1).** After `startSession` or `resumeSession` returns, `launch.ts` appends ONE `run_declared_checks` event through `appendEvent` (`kernel/src/loop/internal.ts`), with `session_id` = the run session. Its payload holds `repo`, `checkout`, `base_ref`, `base_sha` (or `null` and `reason`), `admitted` (each check's command text and source) and `skipped` (each line's text, source and reason). The append must never throw past the obtained handle: a failed append is caught, and the step still returns `session_id`, logged through the module's existing error path. The `launch.ts` comment "The session is the step's last effect" is updated to say the event follows it and cannot fail the step. The append-only events log is keyed by `session_id`. It is used instead of a new `sessions` column, which would need a migration (Risk Assessment). The app's audit sentence table gains a `run_declared_checks` entry (its coverage test scans `kernel/src` for every written kind).
- **The run's prompt (AC4).** In `policy.ts`, `runSystemPrompt(policy)` returns the system prompt. With `declaredChecks` absent it returns exactly today's value: `TICKET_RUN_SYSTEM_NOTE` when `mayCreateRunFile(policy)`, else `undefined`. With `declaredChecks` present it appends a paragraph listing the admitted commands and the base sha. When there are none, the paragraph says: "This repository declares no checks at its base branch (no workflow `run:` line and no `package.json` script the kernel admits): every command that runs project code is refused, so a worker cannot run tests or scripts; the Supervisor's checkpoint must say so." `manager.ts` uses `runSystemPrompt(live.policy)` in place of the constant switch. `review_pr` sessions now get this one paragraph as their system prompt.

## Design decisions
- decision: how `declared-checks.ts` reads each job's `run:` lines from a committed workflow file
  chosen: a small hand-written line reader in `declared-checks.ts` that admits only single-line plain or simply quoted `run:` scalars and skips every other form with a reason (fail closed)
  rejected: add the `yaml` package as a kernel dependency — "already in the lockfile or manifest": no (it is only an optional peer, not installed), and "blast radius": partial (`kernel/package.json` and the lockfile are outside the File Impact Map)
  rejected: no existing kernel helper — "already in the repo": no YAML reader exists under `kernel/src` (`grep -rli yaml kernel/src` finds only a comment in `github-session-auth.ts`)
  evidence: `grep -n '"yaml"' kernel/package-lock.json` → only under a `peerDependenciesMeta` block marked `"optional": true`; `ls kernel/node_modules/yaml` → No such file or directory
  revisit when: a repo the owner runs declares checks in a form the reader skips (an anchor, a flow mapping, a multi-document file) and the owner wants it admitted
  status: confirmed

## Acceptance Criteria
- [ ] AC1. Given a run launch (`backlog`, `resume` or `review_pr`), when the kernel builds the session's policy, then it reads the repo's declared checks from the base branch's committed files at one resolved base sha, never the working tree: each `run:` line of every job in `.github/workflows/*.yml` (and `*.yaml`), and `npm test` / `npm run <script>` for each script in `package.json` `scripts`. One `run_declared_checks` event with the run session's `session_id` records the base ref, the base sha, the admitted checks and the skipped lines. A launch whose base can't be resolved records `base_sha: null` with a reason and admits none.
- [ ] AC2. Given a declared check, when a run session issues exactly that command line (after 25b's parse, so the same words; an extra argument, a different script or a prefix of it does not match), then `decideToolUse` answers `{ decision: "allow", reason: "declared_check" }`. Any other execution (`bash <file>`, `./<file>`, `node <file>`, `npx …`) stays `bash_prefix_not_allowed`. The same declaration under a non-run policy (no `loomwrightScripts`) admits nothing.
- [ ] AC3. Given a declared `run:` line that contains a construct the rail refuses (a pipe, `&&`, a redirect, a multi-line script), when the kernel reads it, then that line is not admitted, and the launch's `run_declared_checks` event lists it under `skipped` (the requirement's `declared_check_skipped`) with its reason. The rest are admitted.
- [ ] AC4. Given a repo with no workflow and no `package.json` at the base sha, when the run launches, then its policy's `declaredChecks` is empty and the session's system prompt carries the "declares no checks" paragraph (the worker can't run code; the Supervisor's checkpoint names that).
- [ ] AC5. Given the run edits `package.json` or a workflow on its branch (working tree or a commit on the run branch), when it then issues the new command, then it is refused: only the base sha's declarations count.
- [ ] AC6. Given a repo shaped like studio-sandbox (its `ci` workflow runs `npm test`, and `scripts.test` is `node ping.js`), when the run launches, then `npm test` is admitted `declared_check`, `node ping.js` typed directly is refused, and `npm test --watch` is refused. The runbook's ticket wording that makes `npm test` exercise the new script is 25f's.
- [ ] AC7. Given 25a's exclusions table, when this story lands, then every `filed: 25b|25c|25d` row the rail now admits is removed, and the conformance test gains a stale-exclusion check: an excluded command the rail admits fails the test. Re-adding one closed row makes the test fail. The `project-checks` row (`filed: "25d"`) is kept as a deliberate denial (no `filed`), and its reason says the run admits these only as `declared_check`, from the base branch's declarations. `run-pin-mutations` stays (the script is still not admitted), with its `filed` dropped and its reason worded as a deliberate denial. If the new check flags no row, a synthetic admitted `filed` row in the test proves the check fails, and the doc says 25d closed no row.
- [ ] AC8. The kernel records each declared-check admission in the session's `tool_decision` events (reason `declared_check`), so the walk's evidence shows which checks ran.
- [ ] AC9. `docs/architecture/automate.md` describes the declared checks: the source files, the base-sha rule, exact-match admission, the skipped constructs, the `run_declared_checks` event, the system prompt paragraph, and the open points in the Risk Assessment below. It does so under the existing run section.

## Scope widening
- kernel/src/sessions/types.ts
- kernel/src/sessions/manager.ts
- kernel/src/loomwright/run-state-checkout.ts
- kernel/test/automate-merge-check.test.ts
- kernel/test/automate-launch.test.ts
- kernel/test/loomwright-conformance.test.ts
- app/src/screens/budget/audit-sentences.ts
- accepted: LP-SCOPE 2026-11-23

## Touched-file invariants

> Grounded at base `22a96fd7583933a385ee291709784250a28c641b`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/sessions/policy.ts`** — keep: `decideToolUse` pure and deny by default; the new branch sits only where `if (matched === undefined) return { decision: "deny", reason: "bash_prefix_not_allowed" };` is today, gated by `const runPolicy = (policy.loomwrightScripts ?? []).length > 0;`. Keep the metacharacter and unparsed denials ahead of it. reuse: `parseBashCommand` (already imported from `./shell-words.js`), the existing run-state guard. mirror: `freezePolicy` (`export function freezePolicy(policy: ToolPolicy): ToolPolicy {`) must copy `declaredChecks` deep-frozen, and its doc comment's list of copied fields must name it. `runSystemPrompt` must return exactly `TICKET_RUN_SYSTEM_NOTE` (`export const TICKET_RUN_SYSTEM_NOTE = [`) when `declaredChecks` is absent. pinned by: `kernel/test/sessions-policy.test.ts` (`reason: "bash_prefix_allowed"`) and `kernel/test/automate-launch-routes.test.ts` (`toBe(TICKET_RUN_SYSTEM_NOTE)`).
- **`kernel/src/sessions/types.ts`** — keep: the kernel-only field convention; the new field's doc says who sets it, as `readonly loomwrightRunId?: string;`'s doc does ("Set only by the kernel's launch …, never by a charter or settings file").
- **`kernel/src/sessions/manager.ts`** — keep: `checkPolicy` refuses a malformed kernel field with `SessionError("invalid_params", …)` like `"policy loomwrightRunId must be a Loomwright run id"`. The system prompt line `...(mayCreateRunFile(live.policy) ? { systemPrompt: TICKET_RUN_SYSTEM_NOTE } : {}),` becomes the `runSystemPrompt(live.policy)` call with no other change to the options object (start and resume share it). pinned by: `kernel/test/automate-launch-routes.test.ts` (`options.systemPrompt).toBeUndefined()` for the merge policy).
- **`kernel/src/automate/launch.ts`** — keep: one start call (`expect(text.match(/\.startSession\(/g)).toHaveLength(1);` in `kernel/test/automate-launch.test.ts`); no `child_process`, manager, SDK or kernel import (same test); the event is appended after the session call returns, and an admission refusal still rethrows. reuse: the existing `const policy = { ...runPolicy, ...(settings.never !== undefined ? { never: settings.never } : {}) };` composition (add `declaredChecks` there) and the existing call position beside `handRequiredChecks(store, run.repo, checkout);`.
- **`kernel/src/loomwright/run-state-checkout.ts`** — keep: it stays the one `node:child_process` importer under `src/loomwright/` besides `run-lock.ts` with exactly one `execFileSync(`. Every new read goes through `function lookupGit(cwd: string, args: readonly string[]): string {` (so `safe.bareRepository=explicit`) with fixed argument shapes and `--end-of-options` where git takes it, and fails closed (`undefined`) on any error or timeout. pinned by: `kernel/test/automate-launch.test.ts` (`expect(text.match(/execFileSync\(/g)).toHaveLength(1);`, `expect(importers).toEqual(["run-lock.ts", "run-state-checkout.ts"]);`).
- **`kernel/src/automate/run-exclusions.ts`** — keep: data only, `import type { ToolDecisionReason } from "../sessions/policy.js";` as its only import, frozen exports and no function (pinned by `kernel/test/automate-merge-check.test.ts`'s merge-text-exemption test).
- **`kernel/test/loomwright-conformance.test.ts`** — keep: the existing unused-row check (`(stale: remove it)`); the new stale-exclusion check is added beside it, never replacing it.
- **`kernel/test/automate-merge-check.test.ts`** — keep: the `src/automate/` process, network and merge scans (`["a process", /\bchild_process\b|\bexecFile|\bexecSync\b|\bspawn(Sync)?\b|\bfork\s*\(/],`). Only the pinned file list (`expect(files.sort()).toEqual(["checkout.ts", "index.ts", "launch.ts",`) gains `declared-checks.ts`.
- **`kernel/test/automate-launch.test.ts`** — keep: the ticket run still gets the first-run-file note. Its pin `expect(l.run.options.systemPrompt).toBe(TICKET_RUN_SYSTEM_NOTE);` becomes the exact `runSystemPrompt` value for that run's policy, and the crew session's `toBeUndefined()` stays.
- **`app/src/screens/budget/audit-sentences.ts`** — keep: payloads read defensively through `fields(p)` and never rendered as markup. mirror: the new entry sits beside `run_required_checks: (p) => {`.

## Closed enumerations touched

> Sibling greps at base `22a96fd7`: `grep -rnF 'loomwright_repo_code' --include='*.ts' --include='*.tsx' --include='*.md' --include='*.json' .` (excluding `node_modules`, `.supervisor`) → 3 hits in 3 files; `grep -rn 'run_required_checks' --include='*.ts' --include='*.tsx' --include='*.md' .` → 7 hits in 4 files.

- **`declared_check`** (sibling: `loomwright_repo_code`) — must be named in:
  - `kernel/src/sessions/policy.ts` — the `ToolDecisionReason` union (`| "loomwright_repo_code"`) — extend, with a doc comment like its siblings.
  - `kernel/src/sessions/manager.ts` — the writer of the sibling deny (`reason: "loomwright_repo_code"`) — no change: `declared_check` comes from `decideToolUse` through the existing `tool_decision` path.
  - `docs/architecture/automate.md` — prose naming reasons — extend (AC9).
- **`run_declared_checks`** (sibling event kind: `run_required_checks`) — must be named in:
  - `app/src/screens/budget/audit-sentences.ts` — `AUDIT_SENTENCES` (`run_required_checks: (p) => {`), whose coverage test (`app/src/screens/budget/audit-sentences.test.ts`) fails on a kind written in `kernel/src` with no entry — extend.
  - `kernel/src/loomwright/required-checks.ts` — the sibling's own writer — no change.
  - `kernel/test/automate-resume.test.ts`, `kernel/test/required-checks.test.ts` — read the sibling's rows — no change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/automate-declared-checks.test.ts` — exact match: `npm test --watch` is refused | turn the declared-check word comparison into a prefix match (compare only the declaration's length) in `kernel/src/sessions/policy.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — no admission outside a run policy | drop the `runPolicy` condition from the declared-check branch in `kernel/src/sessions/policy.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — a piped `run:` line is skipped `shell_metacharacter` | admit a `metacharacter` parse result as a check in `kernel/src/automate/declared-checks.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — a script added on the run branch is refused (AC5) | read `package.json` from the working tree instead of the base sha blob in `kernel/src/automate/declared-checks.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — the launch's `run_declared_checks` event (AC1) | drop the `appendEvent` call for `run_declared_checks` in `kernel/src/automate/launch.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — `base_unresolved` admits none | fall back to `HEAD` when neither origin ref resolves in `kernel/src/automate/declared-checks.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — the "declares no checks" paragraph (AC4); `kernel/test/automate-launch.test.ts` — the ticket run's exact `runSystemPrompt` value (changed pin) | make `runSystemPrompt` return `TICKET_RUN_SYSTEM_NOTE` whatever `declaredChecks` holds in `kernel/src/sessions/policy.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — a `tool_decision` row with `declared_check` (AC8) | return reason `bash_prefix_allowed` instead of `declared_check` in `kernel/src/sessions/policy.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — studio-sandbox shape: `npm test` admitted (AC6) | skip the `npm test` form for `scripts.test` in `kernel/src/automate/declared-checks.ts` (reviewer applies) |
| `kernel/test/automate-declared-checks.test.ts` — a declared check is admitted as a `Monitor` watch | route the Monitor branch around the declared-check match in `kernel/src/sessions/policy.ts` (reviewer applies) |
| `kernel/test/automate-merge-check.test.ts` — the pinned `src/automate/` file list (changed pin: gains `declared-checks.ts`) | add a second new file under `kernel/src/automate/` (reviewer applies; the list pin must turn red) |
| `kernel/test/loomwright-conformance.test.ts` — stale-exclusion check | re-add one removed `filed:` row to `kernel/src/automate/run-exclusions.ts` (reviewer applies; Validation 2) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Declared checks: base-sha reader, `declared_check` admission, launch wiring, event, system prompt | AC1, AC2, AC3, AC4, AC5, AC6, AC8 | 8 modify, 2 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Conformance: stale-exclusion check, closed `filed:` rows removed, `project-checks` reworded, architecture doc | AC7, AC9 | 3 modify, 0 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/automate/declared-checks.ts"}
  - {kind: "symbol", path: "kernel/src/automate/declared-checks.ts", name: "readDeclaredChecks"}
  - {kind: "file", path: "kernel/test/automate-declared-checks.test.ts"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "declared_check"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "runSystemPrompt"}
  - {kind: "symbol", path: "kernel/src/sessions/types.ts", name: "declaredChecks"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "run_declared_checks"}
  - {kind: "symbol", path: "app/src/screens/budget/audit-sentences.ts", name: "run_declared_checks"}
requires: []
lanes:
  - "kernel/src/automate/declared-checks.ts"
  - "kernel/test/automate-declared-checks.test.ts"
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/types.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/automate/launch.ts"
  - "kernel/src/loomwright/run-state-checkout.ts"
  - "kernel/test/automate-merge-check.test.ts"
  - "kernel/test/automate-launch.test.ts"
  - "app/src/screens/budget/audit-sentences.ts"
external_requires:
  - "git (the kernel's existing git reads in run-state-checkout.ts)"

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/test/loomwright-conformance.test.ts", name: "stale-exclusion"}
  - {kind: "symbol", path: "kernel/src/automate/run-exclusions.ts", name: "project-checks"}
  - {kind: "symbol", path: "docs/architecture/automate.md", name: "declared_check"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "declared_check"}
lanes:
  - "kernel/test/loomwright-conformance.test.ts"
  - "kernel/src/automate/run-exclusions.ts"
  - "docs/architecture/automate.md"
external_requires: []
```

**Subtask 1 notes.** Write `kernel/test/automate-declared-checks.test.ts` against real temp git repos (as `kernel/test/automate-resume.test.ts` does with `execFileSync("git", …)`). It covers: reading at the base sha while the working tree differs (AC1, AC5), a script added in a run-branch commit and a workflow edited only in the working tree are both refused (AC5), each skipped construct with its reason (AC3), the no-workflow and no-`package.json` repo and its prompt paragraph (AC4), the studio-sandbox shape (AC6), exact match and its near-misses (AC2), `base_unresolved`, and one launch through the real launch path asserting the `run_declared_checks` event and a `tool_decision` row with `declared_check` (AC1, AC8). Run `cd kernel && npm test` and `cd app && npm test` (the audit-sentence coverage test).

**Subtask 2 notes.** Add the stale-exclusion check first, as a test whose title contains `stale-exclusion`. For each row with a `filed` story, decide every extracted entry the row's `match` covers with its kind's real policy. Fail when one of them is admitted. Then remove exactly the rows it flags. Show it fails by re-adding one removed row (Validation 2). **Zero-flag case:** the existing unused-row check already removes rows that match nothing, so the new check may flag no row. If so, remove none, prove the check with a test fixture: a synthetic `filed` row whose entries the rail admits, asserted to fail. Write in `docs/architecture/automate.md` that 25d closed no row. **`run-pin-mutations`:** it stays denied (the script is not admitted). Drop its `filed: "25d"` and word its reason as a deliberate denial, as for `project-checks`. Run `cd kernel && npm test`.

## Parallelism Analysis

### Dependency Graph
```
Subtask 2 ──→ Subtask 1
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | YES (Subtask 2 requires `declared_check`) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md` |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| reader | `kernel/src/loomwright/run-state-checkout.ts` (367): fixed-shape base-sha reads beside `lookupGit`, the kernel's one git spawner | `kernel/src/automate/declared-checks.ts`: the home of declaration reading and parsing | HIGH |
| gate | `kernel/src/sessions/policy.ts` (1638): appended, as the single authority for `decideToolUse`, `freezePolicy` and the run system prompt (a few lines each; parsing lives in the new module); `kernel/src/sessions/types.ts` (755): one field; `kernel/src/sessions/manager.ts` (3409): appended, `checkPolicy`'s one validation and the one system prompt line, no new logic | — | HIGH |
| launch | `kernel/src/automate/launch.ts` (771): appended, the one launch path (calls the new module, adds the field, appends one event) | — | HIGH |
| tests | `kernel/test/automate-merge-check.test.ts` (621): one file-list entry; `kernel/test/automate-launch.test.ts` (1259): one pin updated | `kernel/test/automate-declared-checks.test.ts`: every new behaviour's tests (one home, not the 1593-line `sessions-policy.test.ts`) | HIGH |
| app | `app/src/screens/budget/audit-sentences.ts` (430): one sentence entry | — | HIGH |
| conformance | `kernel/src/automate/run-exclusions.ts` (902): rows removed, one reworded; `kernel/test/loomwright-conformance.test.ts` (809): appended, one check beside the existing stale-row check | — | MEDIUM (which `filed:` rows go is decided by the new check) |
| docs | `docs/architecture/automate.md` (218) | — | HIGH |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `agents/worker.md:79` | no | UNCLEAR | Loomwright plugin file, not in this repo's tree | tip 10 hours ago, fetched <1h |
| `skills/review-heal/SKILL.md:168` | no | UNCLEAR | Loomwright plugin file, not in this repo's tree | tip 10 hours ago, fetched <1h |
| `agents/code-reviewer.md:267` | no | UNCLEAR | Loomwright plugin file, not in this repo's tree | tip 10 hours ago, fetched <1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| A declared check runs the working tree's files, not the base sha's: `npm test` runs whatever `scripts.test` and `ping.js` say on the run branch, so a run that edits the test script's body or the test file runs its own code through the declared command. AC5 refuses only a NEW command. This is the class the requirement accepts ("only code the base branch declared as its test"). | HIGH | Not widened or patched here. Write it in `docs/architecture/automate.md` as an open point for the owner to re-decide (for example, refuse a declared npm check when the working tree's `scripts.<name>` differs from the base's). |
| AC1 says "recorded on the session row". This brief records the declarations as one `run_declared_checks` event keyed by `session_id` (the append-only log), not a new `sessions` column. A column needs a migration and store-schema changes outside the File Impact Map. | MEDIUM | Say so in the doc and the PR body. If the owner wants a column, it's a follow-up migration that reads the same payload. The coordinator's scope re-gate (`pending-coordinator`) confirms the event form with the owner. |
| A declared `run:` line such as `npm ci` reaches the network and runs dependency install scripts. | MEDIUM | It is the repo's own CI declaration (the owner's choice, 2026-11-20). Document it; the rail and the outward gate are unchanged. |
| The base ref is the last-fetched `origin/<default>`. The kernel doesn't fetch, so the declarations can lag the remote. | LOW | Record `base_ref` and `base_sha` in the event so the walk's evidence shows which commit was read. |
| A step's `working-directory:` is ignored. The check is admitted as a command, and the session runs it from its own cwd. | LOW | Document it. The admission is about the command words, not where CI ran them. |
| Feasibility (Phase 2.5): the gate is pure and `src/automate/` may start no process, so the git reads must go through `run-state-checkout.ts`. | MEDIUM | Touched-file invariants pin the one-spawner rule. The reader gets a committed-file reader function, not git. |
| Feasibility (Phase 2.5): 13 files, past the 12-file bound. | MEDIUM | Split `context-bound` into 2 sequential subtasks with no file overlap. |
| Feasibility (Phase 2.5): the plan needs 7 paths outside the requirement's Touches (`## Scope widening`). | MEDIUM | Recorded `pending-coordinator` for the coordinator's scope re-gate. |

## Validation (from the source requirement)
1. **Static — kernel suite:** `cd kernel && npm test`, with tests for reading declarations from a base sha, exact-match admission, the skipped constructs and the branch-edit refusal. Also `cd app && npm test` for the audit-sentence coverage.
2. **Static — conformance:** 25a's test passes with every closed `filed:` row removed and the stale-exclusion check on; re-adding one closed row makes it fail.
3. **Running system — next live walk:** session events show `npm test` admitted `declared_check`, and the ticket run opens its PR. This is checked in the owner's next walk, not in this PR.

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-23-25d-run-may-run-repos-declared-checks.md
```

## Plan Review
- **Decision:** PASS (attempt 2/3), requirement_fit: fulfils
- **Deferred LOW notes (not refined, to keep the PASS intact):**
  1. A failed `run_declared_checks` append: `launch.ts` has no logger. Wrap the append in try/catch, swallow the failure and return `{ session_id }` unchanged. Pin it with a test in which `appendEvent` throws.
  2. Zero-flag case of the stale-exclusion pin: add a mutation that makes the check always pass. The synthetic-fixture assertion must then turn red.


## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-23T06:05:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/307
- **Branch:** feature/25d-run-may-run-repos-declared-checks
- **Files changed:** 20
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Declared checks (AC1–AC9) implemented in 2 sequential subtasks, kernel 5330 passed / app 3407 passed. Each of the 3 heal rounds reproduced a new way for a run session to forge `refs/remotes/origin/<default>`, the base declared checks are read from: a fetch refspec; the `--refm=` abbreviation and `--output=`; a worktree inside `.git`. Each route was closed (ad56eb70, dac7abcf, 2643a3c4). The final fix was not re-reviewed. The trust root, a base ref in a checkout the session can write, is the owner's decision: pin the base sha at first launch, or a ref namespace only the kernel writes.

## Not verified
- **A live run session admitting `npm test` as `declared_check` in a real Loomwright walk.** Needs the owner's next live walk (Validation 3). (subtask 1)
- **Real SDK behaviour for a `review_pr` session that now has a non-empty systemPrompt.** No local runtime of the real SDK/CLI; fakes only. (subtask 1)
- **Live run `tool_decision` rows with `declared_check`.** Needs the owner's next live walk (Validation 3). (subtask 2)
- **The rendered anchor `#declared-checks-25d` in `docs/architecture/automate.md`.** No markdown renderer was run locally. (subtask 2)
