# Supervisor-Ready Brief: 25c — run sessions may manage files, read git and wait on subagents inside their own checkout

## Environment
- **Project:** loomwright-studio (lane L5 checkout of `automate-2026-11-20-174137`)
- **Tech stack:** strict TypeScript kernel daemon (`kernel/`), vitest; docs in `docs/`
- **Test command:** `cd kernel && npm ci && npm test`
- **Source requirement:** .supervisor/requirements/phase-8-25/2026-11-20-120200-25c-run-sessions-may-manage-files-and-wait-on-subagents-inside-their-checkout.md
- **Base commit:** 3fedf2b58d31ea0b5f7af4561318ca699efbd3f4
- **Dependency:** 25b (quote-aware rail) is merged on this base (`351b7f40`, merged through `e5873597` / `17a20d97`).

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Pure TypeScript policy code plus one existing git-only I/O module; no new dependency. |
| 2 | Dependency Availability | GO | `node:child_process` / `node:fs` / `node:path` only, already used by `kernel/src/loomwright/run-state-checkout.ts`. |
| 3 | Architecture Fit | CAUTION | Path confinement needs the file system and git (`git worktree list`, `realpath`, a local-branch lookup). `policy.ts` is pure ("Pure: no I/O"), so the I/O half lives in the session gate (`manager.ts`), as `refTracksRunState` and `refoldRunsRepoCode` already do. `manager.ts`, `run-state-checkout.ts` and `run-exclusions.ts` are outside the requirement's Touches. |
| 4 | Scope vs Supervisor Capability | GO | One worker: one policy surface, its gate call site, its tests and one doc. |
| 5 | Hard Blockers | CAUTION | `Monitor`'s input carries a shell `command` and a `ws` WebSocket URL (tool schema read 2026-11-22). Admitting it by name alone would run any shell command past the Bash rail and open an outward socket. See Design decisions and Risk Assessment. |

**Overall Verdict:** CAUTION

## Task

**Goal:** a kernel run session can delete, rename and chmod files, read git, use `git -C` and a local `git merge`, wait on subagents, and call four more Loomwright helpers, all confined to its own checkout.

**Problem Statement:** the owner needs kernel-run items to finish in Studio, but the run policies deny ordinary file and git work. Observed in studio.db: `chmod +x` (29864→38074), `mv .supervisor/jobs/in-progress/…` (30444, 33369), 12 `git -C <checkout> …` events, `git ls-tree|ls-remote|remote -v`, `Monitor`, `od`, the `gate-auto.sh` / `phase45-ci-read.sh` / `reconcile-jobs.sh` calls, and 23f's `settings_write` on reads of the install. So items stall, or the model does the step by hand.

Widen the four kernel run policies (`AUTOMATE_RUN_POLICY` for `backlog`/`resume`, `REVIEW_PR_RUN_POLICY`, `MERGE_PARKED_RUN_POLICY`, `MERGE_PARKED_TRUSTED_RUN_POLICY`) so the ordinary, non-executing work Loomwright's Supervisor, workers and Launch Pad do is admitted, but only inside the session's own checkout:

1. **File operations confined to the checkout.** `rm`, `mv`, `chmod`, `git rm` and `git mv` are admitted when every path operand resolves inside the session's checkout or one of its git worktrees. A path outside them, under `~/.claude`, or under `.supervisor/automate/` (run state, D45) is refused, and so is any recursive form (`rm -r|-R|-rf`, `chmod -R`, `git rm -r`) whose target is the checkout root. Each program gets a closed option set; any other option fails closed (`rm`: `-f -r -R -v` and their clusters; `mv`: `-f -n -v`; `chmod`: `-R -v` and a mode operand; `git rm`: `-r -f -q --cached --`; `git mv`: `-f -k -n -v`). An option that takes a path value (`mv -t`) is refused. An operand holding a glob or brace character (`*`, `?`, `[`, `{`) is refused (fail closed), so `mv .supervisor/jobs/pending/<id>-*.md .supervisor/jobs/failed/` stays denied. The run-state guard already refuses it, and its 25a row keeps that shape. The replay table uses only events whose recorded command used literal paths; the worker confirms 30444 and 33369 from studio.db, and a globbed event is listed as "stays denied", not as admitted.
2. **`git -C <dir> <subcommand>`.** When `<dir>` resolves inside the checkout or its worktrees, the command is judged exactly as `git <subcommand>` would be in `<dir>`: the same `RUN_BASH_PREFIXES` list, the same run-state guard (`bashTouchesLoomwrightRunState`), the same checkout-target guard (`checkoutTargets` + `refTracksRunState` with `<dir>` as cwd), and the same confinement for `git -C <dir> rm|mv`. Only one `-C`. Any other global option before the subcommand (`-c`, `--git-dir`, `--work-tree`, `--exec-path`, a second `-C`) stays refused. Otherwise the command is refused.
3. **New read and merge shapes.** Add `git ls-tree`, `git ls-remote`, `git remote -v` (exactly that, never `git remote add|set-url|…`) and `od` to the prefixes. `od` also joins `READ_ONLY_PROGRAMS`. Admit `git merge <local-branch> [--no-ff] [-m <msg>]` with a closed option set (`--no-ff`, `-m <value>`). The operand is a local branch: the gate asks git (`rev-parse --symbolic-full-name --verify --end-of-options <name>` must answer `refs/heads/<name>`), so a remote ref, a tag, a SHA or an expression is refused. `-s`, `-X`, `--strategy`, `--strategy-option` and every other option are refused.
4. **Claude tools.** Add `TaskOutput` and `Monitor` to `RUN_TOOLS`. `Monitor` is admitted only as a shell watch: its `command` is decided exactly as a Bash call (`decideToolUse` as `Bash` with `{command}`, then the gate's confinement and checkout checks, then `classifyToolCall` as `Bash`). A `Monitor` call with `ws` is refused, because it is an outward channel (as `web-tools` refuses WebFetch). `SendMessage` stays denied, and its reason and the observed events (33474, 38037) are recorded in 25a's exclusions module.
5. **Scripts by exact install path.** These are admitted for the `backlog` and `resume` kinds only. Those kinds run the inline Launch Pad and Supervisor, where every observed call came from. `review_pr` and `merge_parked*` stay as they are; this is a reading of AC5's "a run session", recorded here. In `AUTOMATE_RUN_SCRIPTS`, admit:
   - `gate-auto.sh`, only its `decide`, `record` and `list` subcommands;
   - `phase45-ci-read.sh`;
   - `reconcile-jobs.sh`, after checking that 18.1.2 writes only the run's `.supervisor/` bookkeeping (no `.supervisor/automate/` write, no push, no `claude`);
   - `automate-lanes.sh`, only `scope-outside`. Every other `automate-lanes.sh` subcommand stays refused.

   This needs an allow-only subcommand form beside `LOOMWRIGHT_DENIED_SUBCOMMANDS` in `loomwright-scripts.ts` (an `allowedSubcommands` map read at the first argument), and it fails closed on a word it cannot read. Correct `launch.ts`'s exclusion comments: `gate-auto.sh` starts no `claude`, and `run-benchmark.sh` runs no file-borne command lines. Update the 25a rows that 25c resolves, so the conformance test's "matches at least one denied entry" and "fact" checks still pass:
   - `gate-auto` and `lanes-scope-outside`: narrow their kinds from ALL to review_pr + merge_parked*. `gate-auto` is reclassed from "starts a claude process" (its `reason_fact_false` dropped) to "script not admitted for this kind", with its reason corrected.
   - `task-output`: kinds narrowed to whatever stays denied (`TaskOutput` joins `RUN_TOOLS`, so likely removed).
   - `automate-unlisted-scripts` (AUTOMATE): remove the `reconcile-jobs.sh` and `phase45-ci-read.sh` names.
   - `merge-missing-scripts`: keep `reconcile-jobs.sh`, which stays denied for MERGE. `phase45-ci-read.sh` is not in that row.
   - `git-file-and-worktree-ops`: narrowed to the shapes that stay denied (`cp`, the glob `mv`).
   - `run-benchmark`: reclassed so its fact is no longer stated falsely.

   Any row a test run shows to be emptied is removed or narrowed.
6. **23f.** Add a rail exemption. A Bash call whose program is `cat`, `grep`, `head`, `tail`, `wc`, `ls` or `jq` does not read a word as the `~/.claude/` outward target when that word is a literal path (no glob, brace or `~` form) whose normalised form lies under the session's own resolved Loomwright install. The install root is derived from `admittedScriptPaths` (each is `<install>/scripts/<name>`; all must share one root, else no exemption). Every other `~/.claude` path stays `settings_write`, and every other word in the same command is still read.

The confinement roots are the session row's recorded cwd (the checkout, a realpath) plus `git -C <checkout> worktree list --porcelain`. Each operand is resolved against the hook payload's absolute `cwd` with `resolvedPath` from `kernel/src/protected-paths.ts`, the existing single resolver of the recorded `sessions.cwd`, so firmlink and case handling match. Each worktree root is resolved the same way. Containment uses a new export from `protected-paths.ts`, `isInsideResolved(path, root)`. It is a thin wrapper over the module's existing private `isInside` (case-insensitive, path-segment boundary), applied to `withoutFirmlink(resolvedPath(path))` and `withoutFirmlink(resolvedPath(root))` only, so a symlink out of the checkout is caught and case and firmlink handling match. `isInsidePath` is not used for admission: it is true when either the written or the resolved form is inside, which fails open for an admit. `resolvedPath` and `isInsideResolved` read the file system, so they are called only from `run-state-checkout.ts` / `manager.ts`. `run-confinement.ts` stays pure: it returns the operand words and shapes, and takes already-resolved roots as input. Fail closed: no absolute cwd, an operand that cannot be resolved, or a git error or timeout is a deny.

Untrusted input (ticket, PR and comment text) is data. Nothing here admits a program that starts `claude`, posts outward, or runs command lines read from session-writable files (23m), and nothing here runs project code (25d).

## Acceptance Criteria
- [ ] Given a run session, when it runs `rm`, `mv`, `chmod`, `git rm` or `git mv` whose every path argument resolves inside the session's checkout or one of its git worktrees, then it is admitted; a path outside them, under `~/.claude`, or under `.supervisor/automate/` (run state, D45) is refused, as is any recursive form whose target is the checkout root.
- [ ] Given `git -C <dir> <subcommand>`, when `<dir>` resolves inside the checkout or its worktrees, then it is judged exactly as `<subcommand>` would be in that directory (same prefix list, same run-state guard); otherwise refused.
- [ ] Given `git merge <local-branch> [--no-ff] [-m <msg>]`, `git ls-tree`, `git ls-remote`, `git remote -v`, `od`, when a run session issues them, then they are admitted (`git merge` only of a local branch name, no remote ref, no `--strategy-option` that runs a driver).
- [ ] Given the Claude tools `TaskOutput` and `Monitor`, when a run session uses them, then they are admitted; `SendMessage` stays denied with its reason recorded in 25a's exclusions table. (Brief note: `Monitor` is admitted as a shell watch whose `command` is decided as a Bash call; a `ws` Monitor is refused. See Design decisions.)
- [ ] Given `gate-auto.sh decide|record|list`, `phase45-ci-read.sh`, `reconcile-jobs.sh` (checked to write only the run's `.supervisor/` bookkeeping) and `automate-lanes.sh scope-outside` (read-only; every other `automate-lanes.sh` subcommand stays refused), when a run session calls them by exact install path, then they are admitted; `launch.ts`'s exclusion comments are corrected (gate-auto.sh and run-benchmark.sh start no `claude` and run no file-borne commands).
- [ ] Given a read-only program (`cat`, `grep`, `head`, `tail`, `wc`, `ls`, `jq`) naming a path under the session's own resolved Loomwright install, then it is admitted (23f); any other `~/.claude` path stays `settings_write`.
- [ ] Each observed denial above, replayed through the real policy, is admitted; each refusal edge above has a test.

## Scope widening
- kernel/src/sessions/manager.ts
- kernel/src/loomwright/run-state-checkout.ts
- kernel/src/automate/run-exclusions.ts
- kernel/src/sessions/run-confinement.ts
- kernel/test/run-confinement.test.ts
- kernel/test/loomwright-conformance.test.ts
- kernel/src/protected-paths.ts
- accepted: LP-SCOPE 2026-11-22

## Design decisions
- decision: where the operand parsing for confined file operations, `git -C` and `git merge` lives (T2: a new module)
  chosen: a new pure module `kernel/src/sessions/run-confinement.ts`, which `policy.ts` imports for the shape decision. The I/O lookups (worktree list, realpath, local-branch check) are added to the existing git-only `kernel/src/loomwright/run-state-checkout.ts`, and the gate in `manager.ts` calls both.
  rejected: append the parsers to `policy.ts` — fails blast radius / module layout (policy.ts is 1512 lines, past the 500-line threshold, and confinement is a separate concern)
  rejected: a second child_process module under `src/loomwright/` — fails reversibility and test cost (automate-launch.test.ts pins `run-lock.ts` and `run-state-checkout.ts` as the only importers of `node:child_process`)
  evidence: `wc -l kernel/src/sessions/policy.ts` = 1512; `kernel/test/automate-launch.test.ts:1021` `expect(importers).toEqual(["run-lock.ts", "run-state-checkout.ts"])`; `run-state-checkout.ts:16` `function runGit(cwd: string, args: readonly string[])`
  revisit when: a second kernel feature needs checkout confinement outside run sessions
  status: confirmed
- decision: how the confined paths are resolved and compared
  chosen: `resolvedPath` (kernel/src/protected-paths.ts, already in the repo) for the operands and the worktree roots, then the module's existing private `isInside` compare, exported as a resolved-only wrapper `isInsideResolved(path, root)`
  rejected: `isInsidePath` (same module) — fails blast radius for an admit: it answers true when EITHER the written or the resolved form is inside, so `checkout/link -> /elsewhere` would be admitted
  rejected: a new hand-rolled segment compare in run-state-checkout.ts — fails reversibility: it would be the fifth copy (protected-paths.ts:113 `isInside`, launchd.ts:526 `isSameOrInside`, tickets-to-items.ts:294, tracker.ts:255), and it would lose isInside's case folding
  evidence: `kernel/src/protected-paths.ts:93` `export function resolvedPath(path: string): string` (the ONE resolution for a session's recorded `cwd`); `:113` `function isInside(path: string, root: string): boolean` (case-insensitive, segment boundary); `:131` `export function isInsidePath(path: string, root: string): boolean`
  revisit when: a caller needs the either-form semantics for an admit (it must not), or the other copies are folded onto isInsideResolved
  status: confirmed

## Configuration
- **Base Branch:** main
- **Workers:** 1
- **Mode:** single-agent
- **Fix floor:** MEDIUM

## Touched-file invariants
Stamped at base commit 3fedf2b58d31ea0b5f7af4561318ca699efbd3f4.

- `kernel/src/sessions/policy.ts`
  - Pure, deny by default: `The kernel's tool decision. Pure: no I/O. Deny by default.` Confinement I/O must not move in here.
  - Metacharacter check before any admit: `if (parsed.kind === "metacharacter") return { decision: "deny", reason: "bash_shell_metacharacter" };`. A `git -C` rewrite or a Monitor `command` must go through the same `parseBashCommand` first.
  - Run-state guard after every prefix allow: `if (runPolicy && bashTouchesLoomwrightRunState(command)) return { decision: "deny", reason: "loomwright_run_state" };`. A `git -C <dir> <rest>` must still reach this with the stripped words.
  - `const READ_ONLY_PROGRAMS: readonly string[] = ["ls", "cat", "pwd", "date", "test", "wc", "head", "tail", "grep", "sleep", "jq", "mkdir"];`. `od` may join it. `rm`, `mv` and `chmod` must NOT, so a word naming `.supervisor/automate` stays refused for them.
  - `checkoutTargets` reads only `words[1] !== "checkout" && words[1] !== "switch"`. A `git -C d checkout x` must be judged on the stripped words, or it bypasses `refTracksRunState`.
  - The rail's script exemption must stay exact: `words[0] === "bash" && words[1] !== undefined && admitted.includes(words[1])`. The 23f exemption mirrors it (exact literal paths only) and never removes the protected-path check: `if (namesAny(read, targets.protectedPaths, protectedRel)) return { decision: "deny", reason: "protected_kernel_path" };`.
  - `ToolDecisionReason` is a closed union. A new deny reason for confinement must be added there and to every closed list that names reasons (see Closed enumerations).
- `kernel/src/automate/launch.ts`
  - `const RUN_BASH_PREFIXES` is "never bare `git` or `gh`". New entries are subcommand-scoped (`git ls-tree`, `git ls-remote`, `git remote -v`, `git merge`, `git rm`, `git mv`, `rm`, `mv`, `chmod`, `od`). `git -C` is NOT a prefix: it is admitted by the rewrite in `decideToolUse`.
  - `const RUN_TOOLS: readonly string[] = Object.freeze(["Skill", "Read", "Write", "Edit", "Glob", "Grep", "Bash", "Agent", "AskUserQuestion"]);` gains `TaskOutput` and `Monitor`, never `SendMessage`.
  - The exclusion comment `` `dispatch-pr-review.sh`, `hook-dispatch-on-pr-create.sh`, `automate-lanes.sh`, `gate-auto.sh`; `` and `` `rules-check.sh`, `worker-rule-selfcheck.sh`, `run-pin-mutations.sh`, `run-benchmark.sh`; `` are the lines to correct.
- `kernel/src/sessions/loomwright-scripts.ts`
  - `function asksDeniedSubcommand(script: string, args: string): boolean` fails closed: `if (words === undefined) return true;`. The new allow-only form must fail closed the same way.
  - `LOOMWRIGHT_DENIED_SUBCOMMANDS` stays a denylist for its scripts. `automate-lanes.sh` gets an allow-only entry (only `scope-outside` at the first argument), and `gate-auto.sh` gets one (only `decide|record|list`).
- `kernel/src/sessions/manager.ts` (call site only)
  - The rail runs only after the policy allowed: `// The rail applies only after the policy allowed: it never widens a policy.`. The confinement check goes beside the existing `checkoutTargets` block (`const targets = checkoutTargets(command);`), gated the same way on `(live.policy.loomwrightScripts ?? []).length > 0`. It turns an allow into a deny and never the reverse.
- `kernel/src/loomwright/run-state-checkout.ts`
  - `execFileSync("git", ["-C", cwd, ...args]` must remain the module's one process call. `automate-launch.test.ts` pins `expect(text.match(/execFileSync\(/g)).toHaveLength(1);`. New lookups reuse `runGit` with fixed argument shapes and fail closed like `refTracksRunState` (`if (typeof cwd !== "string" || !cwd.startsWith("/")) return true;`).
- `kernel/src/protected-paths.ts`
  - `isInsidePath` stays as is: `caller refuses on \`true\``. The new export is a separate resolved-only function for admission, and it reuses `function isInside(path: string, root: string): boolean` rather than copying it. No existing caller changes.
- `kernel/src/automate/run-exclusions.ts`
  - Data only, frozen, no function. `test/automate-merge-check.test.ts:293` pins `imports types alone and exports frozen data with no function`. A SendMessage record is data, never a function.
  - `reason_fact_false?: "filed: 25c";` rows: the conformance test asserts the fact is still false. Correcting a row means changing its `reason_class` and `reason` (not deleting the evidence), or removing the row once the script is admitted.
- `kernel/test/automate-launch.test.ts`
  - Pins `expect(importers).toEqual(["run-lock.ts", "run-state-checkout.ts"]);` (files under `src/loomwright/` importing `node:child_process`). The new `kernel/src/sessions/run-confinement.ts` must stay pure (no `node:child_process`, no `node:fs`). The I/O goes only in run-state-checkout.ts.
  - The `AUTOMATE_RUN_POLICY (AC4)` describe block pins the policy contents. Update its expected `RUN_TOOLS` / prefix lists rather than loosening the assertion.
- `kernel/test/sessions-policy.test.ts`
  - Existing deny pins stay red-able: every `bash_shell_metacharacter`, `bash_unparsed`, `loomwright_run_state` and `settings_write` case keeps its expected reason. The new admits are added as new cases, never by editing an existing deny's expectation.
- `kernel/test/loomwright-conformance.test.ts`
  - `if (!used.has(r.id)) bad.push(`${r.id}: matches no denied entry in Loomwright ${src.version} (stale: remove it)`);`. Every row that 25c's admissions empty must be removed or narrowed. The committed fixture `test/fixtures/loomwright-18.1.2-instructions.json` is not regenerated.

## Closed enumerations touched
Sibling-value grep: `grep -rnF '"loomwright_repo_code"' kernel/src kernel/test`. If a new `ToolDecisionReason` (for example `checkout_confinement`) is added, every hit is a closed list to update: the `ToolDecisionReason` union in `kernel/src/sessions/policy.ts`, the `deny` match types in `kernel/src/automate/run-exclusions.ts` (`ToolDecisionReason | "unparsed"`), and any reason list in `manager.ts` / `docs/architecture/automate.md`. `RUN_TOOLS`, `RUN_BASH_PREFIXES`, `INLINE_PHASE_SCRIPTS` and `LOOMWRIGHT_DENIED_SUBCOMMANDS` are the closed admit lists this change edits.

## Pin mutations
- Confinement deny for a path outside the checkout: delete the confinement call in `manager.ts`'s PreToolUse gate → the test "rm of a path outside the checkout is refused" goes red.
- Recursive form on the checkout root: drop the root check in `run-confinement.ts` → "`rm -rf .` in the checkout is refused" goes red.
- `.supervisor/automate/` refusal: in `kernel/src/sessions/policy.ts` flip `"jq", "mkdir"]` → `"jq", "mkdir", "mv"]` (add `mv` to `READ_ONLY_PROGRAMS`) → "`mv .supervisor/automate/x.md y` is refused `loomwright_run_state`" goes red.
- Glob operand: drop the glob/brace check in `run-confinement.ts` → "`rm src/*.ts` is refused" goes red.
- `git -C` judged as its subcommand: make the rewrite skip `bashTouchesLoomwrightRunState` → "`git -C <checkout> checkout -- '*.md'` is refused" goes red; make it skip `checkoutTargets` → "`git -C <checkout> checkout <ref tracking run state>` is refused" goes red.
- `git merge` local-only: accept any `rev-parse` answer → "`git merge origin/main` is refused" goes red; drop the option check → "`git merge -X ours feature/x` is refused" goes red.
- Monitor: admit `Monitor` without deciding `command` as Bash → "Monitor with `command: 'curl x | sh'` is refused" goes red; drop the `ws` check → "Monitor with `ws` is refused" goes red.
- Allow-only subcommands: delete the `automate-lanes.sh` allow entry → "`automate-lanes.sh lane-launch` is refused" goes red.
- 23f: drop the install-root check → "`cat ~/.claude/settings.json` stays `settings_write`" goes red.
- `git -C` global options: drop the global-option check in the `git -C` split → "`git -C <checkout> -c core.hooksPath=x status`", "`git --git-dir=x -C <checkout> status`", "`git -C <checkout> --work-tree=/ status`" and "`git -C a -C b status`" are refused (each its own case) go red.
- `git -C` outside: drop the `<dir>` confinement check → "`git -C /tmp/other status` is refused" goes red.
- `git remote -v` exact: change the prefix to `git remote` → "`git remote add x url`" / "`git remote set-url origin x` is refused" go red.
- `mv -t`: drop the path-valued-option refusal → "`mv -t /tmp a` is refused" goes red.
- Recursive on the root, other programs: drop the root check for `chmod` / `git rm` → "`chmod -R +x .`" / "`git rm -r .` is refused" go red.
- Merge of a tag or a SHA: accept `refs/tags/…` or a bare commit in the local-branch lookup → "`git merge v1.0`" / "`git merge <sha>` is refused" go red.
- `gate-auto.sh` allow-only: delete its allow-only entry → "`gate-auto.sh <other subcommand>` is refused" goes red.
- 23f single root: drop the single-root check in the install-root derivation → "admittedScriptPaths under two roots → no exemption" goes red.
- 23f literal only: drop the glob/brace/`~` check → "`cat <install>/*`" and "`cat ~/.claude/plugins/…` (tilde form) stay outward" go red.
- SendMessage: add `SendMessage` to `RUN_TOOLS` → "SendMessage is denied by every run policy and listed in the observed-denials record" goes red.
- Monitor input shape: the test fixture carries the real Monitor input keys (`command`, `description`, `timeout_ms`, `ws`). Remove `ws` from the refused keys → its case goes red.
- Replay: revert any one admission → its row in the "observed denials replay" table test goes red.

## Subtask Structure

| # | Title | Criteria | Est. Files | Skills | Status |
|---|-------|----------|-----------|--------|--------|
| 1 | Confined file ops, `git -C`, local merge, Monitor/TaskOutput, four scripts and 23f for run sessions | all 7 | 12 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/sessions/run-confinement.ts"}
  - {kind: "file", path: "kernel/test/run-confinement.test.ts"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "RUN_TOOLS"}
  - {kind: "symbol", path: "kernel/src/automate/launch.ts", name: "RUN_BASH_PREFIXES"}
  - {kind: "symbol", path: "kernel/src/sessions/loomwright-scripts.ts", name: "LOOMWRIGHT_DENIED_SUBCOMMANDS"}
  - {kind: "symbol", path: "kernel/src/sessions/policy.ts", name: "decideToolUse"}
  - {kind: "symbol", path: "kernel/src/loomwright/run-state-checkout.ts", name: "refTracksRunState"}
requires: []
lanes:
  - "kernel/src/sessions/policy.ts"
  - "kernel/src/sessions/run-confinement.ts"
  - "kernel/src/sessions/loomwright-scripts.ts"
  - "kernel/src/sessions/manager.ts"
  - "kernel/src/loomwright/run-state-checkout.ts"
  - "kernel/src/protected-paths.ts"
  - "kernel/src/automate/launch.ts"
  - "kernel/src/automate/run-exclusions.ts"
  - "kernel/test/sessions-policy.test.ts"
  - "kernel/test/automate-launch.test.ts"
  - "kernel/test/run-confinement.test.ts"
  - "kernel/test/loomwright-conformance.test.ts"
  - "docs/architecture/automate.md"
external_requires:
  - "git >= 2.30 on PATH (worktree list --porcelain, rev-parse --end-of-options)"
  - "Loomwright 18.1.2 install (gate-auto.sh, phase45-ci-read.sh, reconcile-jobs.sh, automate-lanes.sh scope-outside)"
```

## Parallelism Analysis

single-agent (no fan-out)

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| policy | `kernel/src/sessions/policy.ts` (1512: `git -C` rewrite, Monitor-as-Bash, the 23f rail exemption and any new reason; appended because it is the single authority for the decision and the rail, with the parsing moved out) | `kernel/src/sessions/run-confinement.ts` (pure: operand and option parsing for rm/mv/chmod/git rm/git mv, the `git -C` split, the `git merge` shape) | HIGH |
| run policies | `kernel/src/automate/launch.ts` (734: the single authority for the frozen run policies), `kernel/src/sessions/loomwright-scripts.ts` (396) | — | HIGH |
| gate | `kernel/src/sessions/manager.ts` (3395: call site only, beside the existing `checkoutTargets` block), `kernel/src/loomwright/run-state-checkout.ts` (88: worktree roots, the confinement check, local-branch lookup; the existing git-only module), `kernel/src/protected-paths.ts` (export the resolved-only `isInsideResolved` over its private `isInside`; the single containment authority) | — | HIGH |
| 25a table | `kernel/src/automate/run-exclusions.ts` (872: the single authority for exclusion rows), `kernel/test/loomwright-conformance.test.ts` (780: only if the SendMessage record needs a pin there) | — | MEDIUM |
| tests | `kernel/test/sessions-policy.test.ts` (1361: decision and rail cases; named by the requirement's Validation), `kernel/test/automate-launch.test.ts` (1039: policy contents and gate replays; named by the requirement) | `kernel/test/run-confinement.test.ts` (parser and I/O edges: the new module's own suite) | HIGH |
| docs | `docs/architecture/automate.md` (193) | — | HIGH |

Total estimated files: 11 modify + 2 create.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `skills/async-orchestration/finalize.md:14-23` | yes (18.1.2 install) | HOLDS | 25a row `git-file-and-worktree-ops` lists `skills/async-orchestration/finalize.md` for `git -C ../<worktree> add -A\|commit\|merge --no-ff` | tip 3fedf2b5, fetched local |
| `supervisor-next-step.sh:1058` | yes (18.1.2 install) | UNCLEAR | not opened; the parallel-path merge shape is confirmed by the 25a fixture row | tip 3fedf2b5 |
| `agents/execute-manager.md:182` | yes (18.1.2 install) | HOLDS | 25a row `task-output`: "the Execute Manager waits on a background worker with `TaskOutput`" | tip 3fedf2b5 |
| `commands/launch-pad.md:672` | yes (18.1.2 install) | HOLDS (moved) | `agents/launch-pad.md:672` Phase 6 action 1a `automate-lanes.sh scope-outside` | tip 3fedf2b5 |

## House Rules
(no applicable house rules: `read-rules.sh --with-ids` returned nothing)

## Risk Assessment

| Risk | Impact | Source | Mitigation |
|------|--------|--------|------------|
| `Monitor` runs a shell `command` and can open a `ws` WebSocket. Admitting it by name (the owner's 2026-11-20 "Allow" read literally) would bypass the Bash rail and the approval gate. This is new evidence against that one part of the owner decision. | HIGH | Feasibility (Phase 2.5) | Admit Monitor only with `command` decided as a Bash call through policy, gate and rail. Refuse `ws`. Record the narrowing and its evidence (the Monitor input schema) in `docs/architecture/automate.md` (in lanes), and link it from the PR body, so the owner can re-decide. |
| Confinement needs I/O outside the requirement's Touches (`manager.ts`, `run-state-checkout.ts`), and 25a's table must change (`run-exclusions.ts`) or its conformance test goes red. | MEDIUM | Feasibility (Phase 2.5) | Recorded in `## Scope widening` (pending-coordinator). The manager change is a call site only. |
| Prior churn: manager.ts (34), policy.ts (17), sessions-policy.test.ts (16) and automate.md (9) rounds, mostly `self_heal_churn` / `drain_churn`, and a `self_heal_miss` has recurred. | HIGH | Prior churn (postmortem ledger) | Write every refusal edge as a test before the admit. Run the full kernel suite (`cd kernel && npm test`) plus the conformance test before each push. Keep the manager diff to the one call site. |
| A symlink inside the checkout that points outside (`chmod +x link`). | MEDIUM | Analysis | Realpath the existing prefix of each operand before the root compare. A missing or unresolvable path is refused. |
| A confined `rm` still deletes tracked work. | LOW | Requirement | Git history keeps it, and the Supervisor reviews the diff. The recursive form on the checkout root is refused. |
| The SendMessage record has no fixture entry, so a normal exclusion row would fail the "matches at least one denied entry" check. | MEDIUM | Analysis | Record it in run-exclusions.ts as frozen data the stale check does not cover (for example `RUN_TOOL_DENIALS_OBSERVED` with the reason and events 33474 and 38037). Pin "denied by every run policy and listed" in a test. |
| `git merge` runs repository merge drivers (`.gitattributes` `merge=`) and hooks (pre-merge-commit, post-merge). | LOW | Analysis | Same exposure as the existing `git commit` grant (launch.ts:181). Out of scope: the requirement refuses only `--strategy-option`. Note it in docs/architecture/automate.md's open points. |
| Two narrowings of the requirement need the owner's re-decision. First, AC5's scripts are admitted for backlog and resume only. Second, Monitor is admitted without `ws`. 25a's `filed: 25c` rows are also narrowed here, not in 25d, because the stale check at loomwright-conformance.test.ts:574 forces it. | MEDIUM | Analysis | Record all three in `docs/architecture/automate.md` as open owner decisions, with the evidence for each, and link them from the PR. |

## Validation (must pass before merge)
1. `cd kernel && npm test` passes. It includes new cases in `sessions-policy.test.ts`, `automate-launch.test.ts` and `run-confinement.test.ts`, and a table test replaying each observed denial from the requirement through the real policy and gate.
2. `test/loomwright-conformance.test.ts` passes against the committed 18.1.2 fixture.
3. Running system (next live walk): none of the listed commands appears as a deny in the run sessions' `tool_decision` events.

## Handoff
`/supervisor job: .supervisor/jobs/pending/2026-11-22-25c-run-sessions-files-in-checkout.md`


## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-22T14:50:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/304
- **Branch:** feature/25c-run-sessions-files-in-checkout
- **Files changed:** 14
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Run sessions now admit checkout-confined rm/mv/chmod/git rm/git mv, git -C, local-branch git merge, git ls-tree/ls-remote/remote -v, od, TaskOutput, Monitor (shell watch, no ws), four Loomwright scripts for backlog/resume, and 23f install reads. Every review round reproduced a new confinement escape, and each was fixed: round 1, a forged worktree root via .git writes, plus root ancestors; round 2, the same forgery through a symlink to .git, plus a git -C .supervisor run-state bypass; round 3, git -C into a session-authored bare repo running its config (BLOCKING), plus mv/chmod through a symlink to .supervisor. The round-3 fix 12664f1b was not re-reviewed. Open items: a TOCTOU window until safe.bareRepository=explicit is set in the run session env; chmod 000 . is still admitted. tsc clean, 5295 tests pass, required CI green at last read. Escalation comment: https://github.com/vikashruhilgit/loomwright-studio/pull/304#issuecomment-7080739921

## Not verified
- **Live run session tool_decision events (Validation 3)** — no live walk in this run; replayed through the real gate in tests instead (subtask 1)
- **Monitor tool behaviour in a real SDK session** — no live runtime; input shape read from SDK 0.3.284 sdk-tools.d.ts (subtask 1)
