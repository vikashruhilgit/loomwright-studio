# Supervisor Job: 27a — a kernel-started run can run the checks it may run (npm and node on the run's PATH)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8-27/2026-11-24-140000-27a-a-run-can-run-the-checks-it-may-run.md
- **Base commit:** d790c93c5f0650063e2f3b41f0abcecc74bc364d

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel + vitest; the change extends existing modules (`kernel/src/service/launchd.ts`, `kernel/src/automate/declared-checks.ts`). |
| 2 | Dependency Availability | GO | No new dependency: `node:fs` / `node:path` only. |
| 3 | Architecture Fit | GO | Extends 23h's resolve-at-install (`resolveServiceToolPath`) and 25d's `run_declared_checks` event; kernel stays mechanism-only (no repo-specific policy). |
| 4 | Scope vs Supervisor Capability | GO | ~11 files, well under the context-bound threshold; single subtask. |
| 5 | Hard Blockers | CAUTION | Files outside the requirement's Touches must change: `kernel/test/cli.test.ts` pins the exact `service install` line and stderr; `docs/ARCHITECTURE.md` states "Install resolves `gh` and `git` (`SERVICE_TOOLS`)"; and the owner reads `run_declared_checks` only through `app/src/screens/budget/audit-sentences.ts` (`run_declared_checks: (p, r) => {`), which drops unknown payload keys, so it and its test must change for the owner to see the flag. |

**Overall Verdict:** CAUTION

## Task
**Goal:** A kernel-started `backlog`, `resume` or `review_pr` run finds `npm` and the `node` it needs on its PATH (resolved at `service install` exactly as 23h resolves `gh` and `git`), and a declared check whose executable is missing from the run's PATH is named on the run's `run_declared_checks` event at launch.

**Problem Statement:**
The owner needs a run the policy lets run `npm test` to actually run it, because phase 8 walk step 1 (session 266, run `20261124-133823`) admitted `npm test` (25d) but the service's PATH (`/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`) holds no `npm` (it lives in `~/.nvm/versions/node/*/bin` and `/usr/local/bin` on this machine).
Currently, `service install` resolves only `SERVICE_TOOLS` (`gh`, `git`) into the plist PATH, and nothing checks a declared check's executable before a run spends tokens. This causes the Supervisor to checkpoint ("npm not on PATH"), `pr_url: null`, and the walk fails at step 1.
Success looks like: after reinstall, the plist PATH holds npm's (and node's) dir, `service install` prints where it found them, and a launch whose declared check cannot find its executable says so on the `run_declared_checks` event in a plain line.

**Design (builder's call within these bounds, stated in the PR):** resolve-at-install is the recommended mechanism (the requirement's assumption: 23h extends to more tools). Add `export const RUN_CHECK_TOOLS = ["npm", "node"] as const;` beside `SERVICE_TOOLS` in `kernel/src/service/launchd.ts`; `resolveServiceToolPath` resolves both lists with its existing rule, and `InstallResult.tools` / `ServiceToolPath.found` name all four, so `serviceToolsText` (`kernel/src/cli/index.ts`, unchanged) prints them. The launch-time check is a pure function `unrunnableDeclaredChecks(read, runPath, isExecutable?)` in `kernel/src/automate/declared-checks.ts`, called from `startRun` in `kernel/src/automate/launch.ts` with the kernel's own `process.env.PATH` (the env every run session inherits: `SessionManager` defaults `baseEnv` to `process.env` and sets no `PATH`). Flagging (launch proceeds, the event names the gap) is recommended over refusing, because refusing has no session to attach the `run_declared_checks` event to; if the builder refuses instead, the PR states why and the line is still recorded. The owner sees the flag where they already see this event: the app's audit sentence (`AUDIT_SENTENCES.run_declared_checks`, documented in `docs/architecture/automate.md` §"Declared checks (25d)"), which today would still say the session "may run … (npm test)".

## Acceptance Criteria
- [ ] AC1 — Given an installing shell whose PATH resolves `npm` and `node` in an nvm-style dir (`<home>/.nvm/versions/node/<v>/bin`) or any other absolute dir, when `studio service install` runs, then the plist's `EnvironmentVariables.PATH` holds the dir(s) of the `npm` and `node` that PATH resolves (first executable regular file in an absolute, non-`..`, newline/NUL-free entry), in the installer's PATH order together with the `gh`/`git` dirs, then `LAUNCHD_DEFAULT_PATH`, no dir twice — the found dirs only, never the installer's whole PATH. A `backlog`, `resume` or `review_pr` run session inherits that PATH (the kernel's env).
- [ ] AC2 — Given a declared check (25d) whose executable (its first word when that word holds no `/`) is not an executable regular file in any dir of the run's PATH, when the kernel launches a `backlog`, `resume` or `review_pr` run, then the run's `run_declared_checks` event payload carries `unrunnable: [{ command, executable, line }]` (bounded like `admitted`, with `unrunnable_count`), whose `line` reads exactly `<command> is declared but <executable> is not on the run's PATH` (e.g. `npm test is declared but npm is not on the run's PATH`); an `npm …` check whose `npm` is found but whose `node` is not is flagged with `executable: "node"`. When nothing is missing the payload carries `unrunnable: []` and `unrunnable_count: 0`. A check whose first word holds a `/` is never flagged by this rule. The record stays fail-open (a failed append never fails the step).
- [ ] AC2b — Given a `run_declared_checks` payload with a non-empty `unrunnable`, when the app renders its audit sentence (`app/src/screens/budget/audit-sentences.ts`), then the sentence appends each entry's `line` (at most a bounded number by name, with `unrunnable_count` as the total), so the owner reads e.g. `…; npm test is declared but npm is not on the run's PATH`; a payload with no `unrunnable` key, or `unrunnable: []`, reads byte-identically to today (the existing `app/src/screens/budget/audit-sentences.test.ts` case keeps passing), and a new case pins the appended line.
- [ ] AC3 — Given `studio service install`, when it finishes, then its success line names `npm` and `node` as it names `gh` and `git` today (`its runs use gh <path|not found>, git …, npm …, node …`), and each of `npm`/`node` it does not find is one warning line from `runCheckToolWarning(tool)` naming what a run then cannot do (e.g. `studio service: warning: npm is not on this shell's PATH, so a run Studio starts can't run a declared check that uses it (npm test, npm run <name>); install it, then run service install again`); a missing tool never refuses the install.
- [ ] AC4 — Given any repo, when the launch builds the run policy, then the policy is unchanged: `declaredCheckWords` and `DECLARED_CHECK_SKIP_REASONS` are untouched, an unrunnable check stays admitted exactly as before, no Bash prefix is added anywhere, and `npm test` remains the only form admitted for the sandbox repo.
- [ ] AC5 — Given the kernel test suite, when `cd kernel && npm test` runs, then tests cover: (a) `npm` and `node` found under an nvm-style dir are put on the resolved PATH and `found` names them; (b) no other installer PATH entry leaks into the resolved PATH (an installer dir holding only an unrelated tool is absent); (c) `unrunnableDeclaredChecks` returns the named line for a missing `npm` and for a missing `node`, and `[]` when both resolve; (d) the launch's `run_declared_checks` event carries `unrunnable` and `unrunnable_count`; (e) the install warnings and the CLI success line name `npm` and `node`; (f) the app audit sentence appends the `unrunnable` lines (AC2b, `cd app && npm test`). Existing fixtures that assume only `gh`/`git` resolve are updated, not deleted: both `toolsBin()` helpers also seed `npm` and `node` (so `expect(l.warnings).toEqual([])` / empty-stderr assertions stay meaningful), and the 23h "unrelated tool must not leak" fixture switches from `node` to a tool in neither list (e.g. `python3`). Every test drives PATH explicitly (temp dirs, `env: {}` / `env: { PATH }`), never the host's PATH.
- [ ] AC6 — Given the docs, when the change lands, then `docs/architecture/automate.md` §"Declared checks (25d)" describes the `unrunnable` field and its line, `docs/ARCHITECTURE.md`'s 23h `PATH` paragraph names `npm` and `node` (`RUN_CHECK_TOOLS`) beside `gh` and `git`, `docs/evidence/phase-8-exit-runbook.md` setup step 8 tells the owner to check the install line lists `npm` and `node` found and to read `plutil -extract EnvironmentVariables.PATH raw ~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`, and `bash scripts/check-docs.sh` passes.
- [ ] AC7 — Given the requirement's Validation section, when the PR is opened, then a committed evidence file `docs/evidence/phase-8-27a-run-path.md` contains: Validation 1's `cd kernel && npm test` summary lines with `Verdict: PASS for Validation 1` (column 0, outside any fence); a pre-merge proxy for Validation 2 that does not touch the owner's installed service (the built kernel's `resolveServiceToolPath(process.env.PATH)` output from the owner's shell, and `env -i PATH="<that path>" npm test` exiting 0 in a temp dir seeded with the runbook's `ping.js` + `package.json`); and Validation 2's owner steps (reinstall from the branch build, the `plutil` read, the next walk's step 1) as the owner's to run, with no Validation 2 verdict line claimed by the worker. The PR body links to the file.

## Scope widening
- app/src/screens/budget/audit-sentences.test.ts
- app/src/screens/budget/audit-sentences.ts
- docs/ARCHITECTURE.md
- docs/evidence/phase-8-27a-run-path.md
- kernel/test/cli.test.ts
- [...new
- accepted: LP-SCOPE 2026-11-24

## Touched-file invariants

> Grounded at base `d790c93c5f0650063e2f3b41f0abcecc74bc364d`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/service/launchd.ts`** — keep: only found dirs reach the plist, never the installer's PATH (`copies the installer's PATH: only the dirs holding those tools`); launchd's default is always the tail (`for (const dir of LAUNCHD_DEFAULT_PATH.split(":")) dirs.push(dir);`) and no dir twice (`return { path: [...new Set(dirs)].join(":"), found };`); a missing tool warns and never refuses (`a tool it can't find is a warning, not a refusal`); the PATH is resolved and the plist rendered before any write (`// Rendered (and validated) before anything is written.`). reuse: `isExecutableFile` and the existing `entries` filter inside `resolveServiceToolPath` — resolve `RUN_CHECK_TOOLS` in the same loop, never a second PATH walk. mirror: `serviceToolsText(tools: Readonly<Record<string, string | null>>)` in `kernel/src/cli/index.ts` prints every key of `InstallResult.tools` (`its runs use ${serviceToolsText(r.tools)}`), so adding keys there is the print path; keep `serviceToolWarning(tool)`'s text for `gh`/`git` byte-identical. pinned by: `kernel/test/service-launchd.test.ts` (`describe("resolveServiceToolPath (23h)"`, `tools: { gh: null, git: null },`, `expect(l.warnings).toEqual([serviceToolWarning("gh"), serviceToolWarning("git")]);`) and `kernel/test/cli.test.ts` (`its runs use gh not found, git`).
- **`kernel/src/service/index.ts`** — keep: it is a pure re-export barrel (`  serviceToolWarning,`); add `RUN_CHECK_TOOLS`, `runCheckToolWarning` and any new type beside their siblings, nothing else.
- **`kernel/src/automate/declared-checks.ts`** — keep: the policy inputs are untouched (`export function declaredCheckWords(read: DeclaredChecksRead)`, `export const DECLARED_CHECK_SKIP_REASONS = Object.freeze([` — an unrunnable check is NOT a new skip reason); it never throws; amend, truthfully, the module sentence `This module starts no process and reads no file itself` if the default `isExecutable` probe stats PATH entries (it still reads no repo file and starts no process). reuse: the module's `clip` helper for the bounded line, as the rest of the module does.
- **`kernel/src/automate/launch.ts`** — mirror: the payload's consumer `app/src/screens/budget/audit-sentences.ts` (`run_declared_checks: (p, r) => {`) renders it; pinned by `app/src/screens/budget/audit-sentences.test.ts` (`run_declared_checks: no base, admitted with and without skipped lines`) — extend both for `unrunnable` (AC2b). keep: the event stays after the start and fail-open (`// The session runs either way; the audit row is what is lost (fail open on the record, never on the grant).`); the kinds stay `const DECLARED_CHECK_KINDS: readonly AutomateRunKind[] = Object.freeze(["backlog", "resume", "review_pr"]);`; the payload keeps every existing key (`skipped_count: read.skipped.length,`) and only adds `unrunnable` / `unrunnable_count`; keep the import discipline the header states (`so it imports only types, the status helpers and`) — the fs probe lives in `declared-checks.ts`, never a new `node:fs` import here.
- **`app/src/screens/budget/audit-sentences.ts`** — keep: every field is read defensively through `fields(p)` / `plain(...)` and a malformed value never throws; the sentence for a payload without `unrunnable` is unchanged (`may run ${repo}'s declared checks (${admitted})`). reuse: the module's `listed(...)` and `plain(...)` helpers for the appended lines.
- **`kernel/test/service-launchd.test.ts`, `kernel/test/automate-declared-checks.test.ts`, `kernel/test/cli.test.ts`** — keep: every PATH a test uses is built from temp dirs or `env: {}` (no host PATH leak); the existing 23h/25d assertions keep passing, updated only where they enumerate the tool record or the install line. pinned by: `events(env.store, "run_declared_checks")` in `kernel/test/automate-declared-checks.test.ts`.

## Closed enumerations touched

> Sibling grep at base `d790c93c5f0650063e2f3b41f0abcecc74bc364d`: `grep -rnF 'SERVICE_TOOLS' kernel/src kernel/test docs` → 9 hits in 3 files.

- **`npm`, `node`** (new `RUN_CHECK_TOOLS`, sibling list: `SERVICE_TOOLS`) — must be named in:
  - `kernel/src/service/launchd.ts` — the tool list `export const SERVICE_TOOLS = ["gh", "git"] as const;` — extend by a sibling `RUN_CHECK_TOOLS`, and the resolve loop (`for (const tool of SERVICE_TOOLS) {`), the warn loop (`for (const tool of SERVICE_TOOLS) if (tools.found[tool] === null) r.warn(serviceToolWarning(tool));`), the `found`/`tools` record types and the header comment (`Install resolves \`SERVICE_TOOLS\` (\`gh\`, \`git\`) through the`) — extend.
  - `kernel/src/service/index.ts` — the re-export `  SERVICE_TOOLS,` — extend (export `RUN_CHECK_TOOLS`).
  - `docs/ARCHITECTURE.md` — "Install resolves `gh` and `git` (`SERVICE_TOOLS`)" — extend.
  - `kernel/test/service-launchd.test.ts` / `kernel/test/cli.test.ts` — enumerate the record (`tools: { gh: null, git: null },`) and the install line — extend.
  - `kernel/test/service-launchd.test.ts` and `kernel/test/cli.test.ts` — each `toolsBin()` fixture seeds `for (const tool of ["gh", "git"]) {` — extend with `npm`, `node`, so every install test using it (`expect(l.warnings).toEqual([])`, the exact warning lists in the version-manager test, `expect(c.stderr.text()).toBe("")`, and the git-only-PATH `oneLine(c.stderr.text())` case, which must now expect the `npm`/`node` warning lines too) keeps its meaning.
  - `kernel/test/service-launchd.test.ts` — the 23h fixture `binDir("other", { node: 0o755 })` used as the tool that must not leak — change to a tool in neither list (`python3`).
  - `kernel/test/service-launchd.test.ts` — `expect(l.warnings).toEqual([serviceToolWarning("gh"), serviceToolWarning("git")]);` — extend with `runCheckToolWarning("npm")`, `runCheckToolWarning("node")`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/service-launchd.test.ts` — npm/node under an nvm-style dir land on the resolved PATH (AC5a) | flip `["npm", "node"]` → `["node"]` in `kernel/src/service/launchd.ts` |
| `kernel/test/cli.test.ts` — install line names npm and node (AC5e) | flip `["npm", "node"]` → `["node"]` in `kernel/src/service/launchd.ts` |
| `kernel/test/service-launchd.test.ts` — no other installer entry leaks (AC5b) | in `resolveServiceToolPath`, push every filtered installer entry into `dirs` instead of the found ones (reviewer-applied) |
| `kernel/test/service-launchd.test.ts` — npm/node missing yields `runCheckToolWarning` lines (AC5e) | delete the `RUN_CHECK_TOOLS` warn loop in `installService` (reviewer-applied) |
| `kernel/test/automate-declared-checks.test.ts` — missing npm/node is named (AC5c) | make `unrunnableDeclaredChecks` return `[]` unconditionally (reviewer-applied) |
| `kernel/test/automate-declared-checks.test.ts` — the event carries `unrunnable` (AC5d) | drop the `unrunnable` key from the `recordDeclaredChecks` payload (reviewer-applied) |
| `app/src/screens/budget/audit-sentences.test.ts` — the sentence appends the `unrunnable` line (AC2b) | in `run_declared_checks`, stop appending the `unrunnable` lines (reviewer-applied) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Resolve npm/node into the service PATH, flag unrunnable declared checks at launch and in the audit sentence, docs + evidence | all | 12 modify, 1 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "RUN_CHECK_TOOLS"}
  - {kind: "symbol", path: "kernel/src/service/launchd.ts", name: "runCheckToolWarning"}
  - {kind: "symbol", path: "kernel/src/service/index.ts", name: "RUN_CHECK_TOOLS"}
  - {kind: "symbol", path: "kernel/src/automate/declared-checks.ts", name: "unrunnableDeclaredChecks"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "recordDeclaredChecks"}
  - {kind: "symbol", path: "app/src/screens/budget/audit-sentences.ts", name: "run_declared_checks"}
  - {kind: "file", path: "docs/evidence/phase-8-27a-run-path.md"}
requires: []
lanes:
  - "kernel/src/service/launchd.ts"
  - "kernel/src/service/index.ts"
  - "kernel/src/automate/declared-checks.ts"
  - "kernel/src/automate/launch.ts"
  - "kernel/test/service-launchd.test.ts"
  - "kernel/test/automate-declared-checks.test.ts"
  - "kernel/test/cli.test.ts"
  - "app/src/screens/budget/audit-sentences.ts"
  - "app/src/screens/budget/audit-sentences.test.ts"
  - "docs/architecture/automate.md"
  - "docs/ARCHITECTURE.md"
  - "docs/evidence/phase-8-exit-runbook.md"
  - "docs/evidence/phase-8-27a-run-path.md"
external_requires:
  - "npm and node on the owner's shell PATH (for the AC7 proxy run)"
```

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| service PATH | `kernel/src/service/launchd.ts` (955 — append: `resolveServiceToolPath` is the single authority for the plist PATH, 23h; the change widens its tool list, no new concern), `kernel/src/service/index.ts` (56) | — | HIGH |
| launch flag | `kernel/src/automate/declared-checks.ts` (331 — home of the new `unrunnableDeclaredChecks`, the 25d authority for declared checks), `kernel/src/automate/launch.ts` (898 — append: one call + two payload keys in `recordDeclaredChecks`, the sole writer of `run_declared_checks`) | — | HIGH |
| tests | `kernel/test/service-launchd.test.ts` (1027 — append to the 23h `describe` blocks), `kernel/test/automate-declared-checks.test.ts` (844 — append to the 25d launch `describe`), `kernel/test/cli.test.ts` (1226 — update the pinned install line, its `toolsBin()` fixture and the stderr assertions that enumerate warnings), `app/src/screens/budget/audit-sentences.test.ts` (219) | — | HIGH |
| app audit sentence | `app/src/screens/budget/audit-sentences.ts` (445 — the single renderer of `run_declared_checks` for the owner; extends its existing entry) | — | HIGH |
| docs | `docs/architecture/automate.md` (271), `docs/ARCHITECTURE.md` (23h paragraph), `docs/evidence/phase-8-exit-runbook.md` (200) | `docs/evidence/phase-8-27a-run-path.md` | HIGH |

Module layout note: the executable probe `unrunnableDeclaredChecks` needs is a small default `isExecutable` in `declared-checks.ts` (statSync isFile + accessSync X_OK). `launchd.ts`'s `isExecutableFile` is not exported, and importing `launchd.ts` would pull the launchctl module into the CLI-loaded launch handler; `kernel/src/notifications/notifier.ts`'s probe is a single configured path, not a PATH walk. No extract row: no helper is copied by 2+ siblings in this shape.

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Recommended workers:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): `kernel/test/cli.test.ts`, `docs/ARCHITECTURE.md`, `app/src/screens/budget/audit-sentences.ts` and `app/src/screens/budget/audit-sentences.test.ts` sit outside the requirement's Touches but must change (cli.test.ts: the install-line pin, its `toolsBin()` fixture, the empty-stderr and git-only-PATH warning assertions; ARCHITECTURE.md: the 23h paragraph; the app pair: the owner's only view of the flag). | MEDIUM | Asked once at Launch Pad Phase 6 (`LP-SCOPE`); edits limited to the assertions and paragraph named here and the one audit-sentence entry. |
| Adding `node` to the resolved tools changes the meaning of existing 23h fixtures that used `node` as an unrelated tool, and every `toolsBin()` install test now also sees npm/node warnings. | MEDIUM | Closed enumerations rows above: seed npm/node in `toolsBin()`, switch the unrelated fixture to `python3`, extend the exact warning lists — never loosen an assertion to `toContain` to make it pass. |
| An nvm dir is version-specific: removing that Node version leaves the plist pointing at a gone `npm`. | MEDIUM | Same class as `versionManagerWarning` for the kernel's own node; AC2's launch flag names it on the next run; the install line prints the path; reinstall fixes it. |
| The launch probe reads the kernel's `process.env.PATH`; if a session's PATH ever differed, the flag would lie. | LOW | Verified at base: `SessionManager` defaults `baseEnv` to `process.env`, and neither `sessions/manager.ts` nor `sessions/spawner.ts` sets `PATH` for the session (only `PS_ENV` for `ps`). A test pins the probe on the path passed in. |
| A test picks up the CI host's real `npm`/`node` through an inherited PATH and passes or fails by machine. | MEDIUM | AC5: every test builds PATH from temp dirs or `env: {}`. |
| Validation 2 needs a reinstall of the owner's live service and a walk run, which a worker must not do unattended. | MEDIUM | AC7: the worker records a no-touch proxy; the reinstall, `plutil` read and walk step 1 stay the owner's (runbook step 8). |
| `kernel/src/service/launchd.ts` has self-heal history (System Twin: "self-heal fixed 2 issue(s)", 2026-10-03). | LOW | Keep the touched-file invariants above; extend, don't restructure, `resolveServiceToolPath`. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-24-27a-run-can-run-the-checks-it-may-run.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-24T10:20:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/312
- **Branch:** feature/27a-run-can-run-the-checks-it-may-run
- **Files changed:** 13
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** service install resolves npm and node (RUN_CHECK_TOOLS) into the plist PATH and prints them; the launch names unrunnable declared checks on run_declared_checks (unrunnable, unrunnable_count) and the app audit sentence appends them; docs, runbook step 8 and evidence file updated. Phase 4.5 review PASS on the first round with 2 LOW findings dismissed below the MEDIUM floor. Required `ci` failed once on an unrelated flake (kernel/test/run-confinement.test.ts:471, ENOENT writing a forged .git/worktrees/evil/HEAD), passed on a rerun of the same SHA; follow-up candidate. Until-mergeable drain not dispatched: .auto_review is false in config; /automate owns the drain.

## Not verified
- **A live run session under the launchd-run kernel PATH running npm test** — needs the owner to reinstall the installed service and do a walk run (Validation 2) (subtask 1)
- **The run_declared_checks audit sentence rendered in the app's Budget screen** — only the pure sentence function was tested (subtask 1)
