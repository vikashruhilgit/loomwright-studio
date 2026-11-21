# Phase 8 item 25a: the Loomwright conformance test, and its bite checks

Run 2026-11-21 on macOS against Loomwright 18.1.2 (`plugin_version` in the install's `capabilities.json`), base `9b3ca660`.

## What the test does

[`kernel/test/loomwright-conformance.test.ts`](../../kernel/test/loomwright-conformance.test.ts) extracts what Loomwright's instruction files and its four drivers tell each kernel run session kind to use, and decides each item with that kind's real run policy (`decideToolUse`, with scripts admitted by `loomwrightScriptPaths`). Each kind's file set is a closed constant in the test, one line of reason per file. Every denial must match exactly one row of `RUN_EXCLUSIONS` in [`kernel/src/automate/run-exclusions.ts`](../../kernel/src/automate/run-exclusions.ts). Any other denial fails the test, and the failure names the command, the kind, the deny reason and the source `file:line`.

The rail checks shell metacharacters before prefixes, so a command holding `$`, a pipe or a redirect is denied `bash_shell_metacharacter` whatever program it runs. A composition row alone would hide that program. The test therefore decides such a command a second time, part by part, as the session would retry it. It splits on `&&`, `||`, `;`, a pipe and each `$(…)` body, fills each `$…` word with a literal value and drops redirections. Each denied part must match exactly one row of its own. An unadmitted program paired with `$` therefore still fails.

- **Extractor:** [`kernel/test/fixtures/loomwright-instructions/extract.ts`](../../kernel/test/fixtures/loomwright-instructions/extract.ts). It reads shell fences, backtick spans, `scripts/<name>.sh` references, tool names (backticks, `Name(`, "the Name tool", front-matter `tools:`), slash commands, and the drivers' printed text. A shape it cannot parse is kept as `unparsed`, never dropped: every non-blank, non-comment line of a shell fence is a command, a script call or `unparsed`, including a program the extractor does not list (`uv run …`, `kubectl …`). Review iteration 4 closed the gap where such a line fell through and vanished; that surfaced 33 more 18.1.2 lines, all now under rows anchored on their exact text (below).
- **Fixture:** [`kernel/test/fixtures/loomwright-18.1.2-instructions.json`](../../kernel/test/fixtures/loomwright-18.1.2-instructions.json). It holds 1527 entries (566 script calls, 334 commands, 325 slash commands, 233 tool names, 69 unparsed) from 46 files, the 345 script names, every script's facts, and the cited lines. Paths are install-relative. Entries are sorted by file, then line, then text.
- **Modes:** plain `npm test` reads the fixture, so CI needs no install and no test reads `installed_plugins.json`. `STUDIO_LIVE=1` reads the install `resolveLoomwrightInstall()` returns. [`scripts/refresh-loomwright-fixture.sh`](../../scripts/refresh-loomwright-fixture.sh) runs the test's update mode (`LOOMWRIGHT_FIXTURE_UPDATE=1`), which rewrites the fixture, then prints `git diff -M --stat` on it.
- **Table:** 66 exclusion rows. 20 are known gaps: 2 `filed: 25b`, 17 `filed: 25c` and 1 `filed: 25d`. The rest are denied on purpose (a refused subcommand, a `claude` process, an outward post, a memory write) or are text that is not an instruction (`advisory, never instructed`). A row filed to a story whose criteria do not yet name the command says "not in 25x's list".
- **Rows match only what their reason describes.** Every command row other than the shell-composition rows (whose parts are decided on their own) matches the exact shapes it records and names the files they come from. A new command in a listed file, or a recorded shape in another file, has no row and fails. Synthetic cases pin this: `git -C ../wt push --force origin main`, `git -C . reset --hard origin/main`, `git reset --hard origin/main`, `git merge --abort`, `rm -rf ~/.claude`, `cp ~/.ssh/id_rsa /tmp/x`, `cp .supervisor/state.md ~/.ssh/authorized_keys`, a `claude -p` with a permission-bypass flag and `npm run deploy` each fail, both in a synthetic file and in the file the old, wider row listed. Against the iteration-1 table every one of those 19 cases, and a recorded `claude -p` / `npm test` in an unlisted file, is absorbed by a row and so red; the recorded shapes in their own files still pass. Narrowing also re-filed prose mentions the wide `git-file-and-worktree-ops` and `git-subcommands-unlisted` rows had absorbed: the reviewer's scratch-dir `rm -rf` and `git -C <checkout> archive HEAD` now sit in `reviewer-scratch-repro`, and the `rm -rf`, `git reset`, `mv` and `git mv` the text forbids ("never `rm -rf`", "No `git reset`", "never a hand-rolled `mv`/`git mv`") sit in the new `never-hand-rolled-file-ops` row.
- **No row hides a de-admitted script, prefix or tool.** A row keyed on a script name with no text or file limit absorbed every denial of that script, so de-admitting it stayed green. The iteration-2 `driver-refused-option` row was one: removing `automate-next-step.sh` from `AUTOMATE_SCRIPTS` left the test green. It is split by kind and option: `driver-ticket-merge-parked` (`backlog` / `resume`, `--merge-parked`), `driver-merge-loop-option` (the merge kinds, `--start` / `--resume`), `driver-merge-sample-run-file` (the driver's printed self-invocation at `automate-next-step.sh:2152`, decided with a literal `sample` run file the merge run's pin refuses) and `driver-usage-synopsis` (the helper catalog's `[--run …` / `[--start …` synopsis, limited to `helpers.md`). A test now de-admits, per kind, each script, Bash prefix and tool of the run policy in memory, and fails when admitted decisions turn into denials that rows absorb entirely. Synthetic driver calls with the driver de-admitted fail too. A scratch sweep that removed each of the 93 list elements from `launch.ts` in turn went red for 82 before the split and 83 after. The 10 that stay green (`build-context-digest.sh`, `guard-lane-wait-armed.sh`, `gh issue`, `gh run view`, `git stash`, `git switch`, `head`, `pwd`, `sleep`, `tail`) admit nothing the fixture holds: removing one adds no denial.
- **Facts:** 3 rows carry `reason_fact_false: "filed: 25c"`. The test asserts their stated fact IS false. `gate-auto.sh` ("starts a claude process", `launch.ts:232`) and `run-benchmark.sh` ("runs eval / bash -c", `launch.ts:236`) were expected. The test also found `run-pin-mutations.sh`: 18.1.2 holds no `eval` and no `bash -c` in it. It runs pinned test files with `bash "$1"` (`run-pin-mutations.sh:262`).
- **Past the rail:** `PAST_THE_RAIL` lists 7 commands that admitted scripts run themselves. Each row has a line anchor:
  - `review-heal-next-step.sh`:
    - 290: `gh pr comment`;
    - 318: `send-webhook.sh`;
    - 323 and 1098: the detached postmortem.
  - `automate-next-step.sh` 814: the `nohup` merge watcher.
  - `automate-helpers.sh` 1179: the squash merge of `gate-eval`.
  - `meta-sync.d/commands.sh` 23: the metadata push.

### Gaps the test surfaced that no hand sweep had

These are recorded as `filed: 25c` rows; the policies are unchanged here:

- **`backlog` and `resume` lack the drain scripts.** A ticket run's inline `/review-pr` drain calls the review-heal scripts that `REVIEW_PR_RUN_POLICY` admits. `AUTOMATE_RUN_POLICY` lists none of them: `drain-rounds.sh`, `wait-for-checks.sh`, `classify-bot-review.sh`, `ci-run-probe.sh`, `drain-gh-read.sh`, `drain-subfloor-decision.sh`, `guard-arm.sh`, `wrap-external-text.sh`, `notify-desktop.sh` and `pr-postmortem-gather.sh`.
- **`review_pr` lacks the code reviewer's readers.** The code-reviewer reads with `read-rules.sh`, `module-shape-facts.sh` and `read-project-memory.sh`, which only the automate policy admits.
- **Readers and bookkeeping no policy lists:** `resolve-routing.sh` (16 call sites), `stamp-requirement-status.sh`, `format-twin-delta.sh`, `audit-rules.sh` and others.
- **Programs hidden behind a `$`, a pipe or a redirect** (surfaced by the part-by-part decision):
  - `git ls-tree -r --name-only "origin/$BASE_BRANCH"` (`agents/launch-pad.md:298`, `skills/preflight-sync/SKILL.md:98`) and `git check-ignore -q --no-index "$p"` (`skills/state-management/SKILL.md:46`), added to `git-subcommands-unlisted`;
  - `find "$(git rev-parse --git-common-dir)/FETCH_HEAD" -mmin +1440`, `find … -mtime +30 -delete`, `has_rubric()`'s `awk`, and `printf … | python3 …/validate-launch-pad-result.py --raw` (`skills/autonomous-loop/SKILL.md:209`), in the new `text-and-runtime-tools` row;
  - `test -d .beads && bd --version`, in the new `beads-probe` row.

  All three are `filed: 25c`.
- **Shell-fence lines the extractor used to drop** (review iteration 4: a fence line whose first word is not a listed program used to vanish). In 18.1.2 these are 33 lines, all `unparsed`, none an unadmitted program the session must run:
  - real shell, added to the rows of their blocks by exact text: `has_rubric() {` and `status=aborted; …; exit` (`rubric-check-guard`), the `UM_LOG="$(grep -rlF … | head -1)"` line in `commands/supervisor.md:86` and `completion-tail.md:360` (`review-dispatch-probe`), and the gitignore probe's `append)` / `fallback) echo '.supervisor/' >> .gitignore ;;` arms (`gitignore-probe`);
  - `/autonomous` INIT pseudocode (`emit AUTONOMOUS_RUN.status=…`, `print to stderr:`, `exit`, its error-text lines), added to `autonomous-init-pseudocode`;
  - `BASE_TIP=$(git rev-parse --short "origin/$BASE_BRANCH")` (`skills/preflight-sync/SKILL.md:60`), the new `preflight-base-tip` row: the session runs the admitted `git rev-parse` itself;
  - the commit skill's sample messages in a bash fence (`feat(auth): …`, `Closes BD-45`), the new `commit-message-examples` row (`advisory, never instructed`). Also surfaced, and kept on purpose: the `--sdk-runner` spike's `npm install` and `node …/sdk-spike/dist/runner.js`, which start sessions the kernel does not own, and `run-lock.sh … --force-unlock` in the helper catalog's synopsis.

## Commands

```bash
cd kernel && npm ci && npm test                              # 147 files passed, 1 skipped; 5070 tests passed
cd kernel && npx vitest run test/loomwright-conformance.test.ts                 # fixture mode: 42 passed
cd kernel && STUDIO_LIVE=1 npx vitest run test/loomwright-conformance.test.ts   # live 18.1.2: 42 passed
bash scripts/refresh-loomwright-fixture.sh                   # update mode: 42 passed; fixture regenerated, unchanged
cd kernel && npm run typecheck                               # clean
```

## Bite checks (requirement Validation 2 and 3), on a scratch copy

Each check edited a scratch copy of `kernel/` (`rsync -a --exclude node_modules kernel/ <scratch>/kernel/`, with `node_modules` symlinked). Each edit was restored by copying the file back from the worktree. Afterwards `diff -r -q --exclude node_modules <scratch>/kernel kernel` reported no difference. The worktree's `launch.ts` and `loomwright-scripts.ts` were never edited, and `policy.ts`'s behaviour was not: `git diff 9b3ca660 -- kernel/src/automate/launch.ts kernel/src/sessions/policy.ts kernel/src/sessions/loomwright-scripts.ts` shows one change, `export` added to `const SHELL_METACHARACTERS` (review iteration 4) so the test's part-by-part decision imports the rail's own regex instead of a copy that could drift. These checks were recorded before review iteration 4, when the conformance file held 40 tests; the two iteration-4 tests are extractor unit tests and do not touch these mutations.

### 1. Remove `"git commit"` from `RUN_BASH_PREFIXES`: red, and it names `skills/commit/SKILL.md`

```bash
sed -i '' 's/"git add", "git commit", /"git add", /' src/automate/launch.ts
npx vitest run test/loomwright-conformance.test.ts
```

```text
Tests  2 failed | 38 passed (40)
AssertionError: 15 denied instruction(s) without exactly one exclusion row:
backlog: `git commit` (command) denied bash_prefix_not_allowed at agents/code-reviewer.md:66: no exclusion row
resume: `git commit` (command) denied bash_prefix_not_allowed at agents/code-reviewer.md:66: no exclusion row
review_pr: `git commit` (command) denied bash_prefix_not_allowed at agents/code-reviewer.md:66: no exclusion row
backlog: `git commit -m "subtask: {id} — {title}"` (command) denied bash_prefix_not_allowed at agents/supervisor.md:197: no exclusion row
resume: `git commit -m "subtask: {id} — {title}"` (command) denied bash_prefix_not_allowed at agents/supervisor.md:197: no exclusion row
backlog: `git commit` (command) denied bash_prefix_not_allowed at skills/async-orchestration/finalize.md:51: no exclusion row
resume: `git commit` (command) denied bash_prefix_not_allowed at skills/async-orchestration/finalize.md:51: no exclusion row
backlog: `git commit -F -` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:27: no exclusion row
resume: `git commit -F -` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:27: no exclusion row
backlog: part of `git commit -m "feat(auth): add jwt token refresh endpoint" -m "Implement refresh token endpoint with sliding window expiration.\n\nCloses BD-45"`: `git commit -m sample -m sample` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:31: no exclusion row
resume: part of `git commit -m "feat(auth): add jwt token refresh endpoint" -m "Implement refresh token endpoint with sliding window expiration.\n\nCloses BD-45"`: `git commit -m sample -m sample` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:31: no exclusion row
backlog: part of `git commit -F - <<'EOF'`: `git commit -F -` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:36: no exclusion row
resume: part of `git commit -F - <<'EOF'`: `git commit -F -` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:36: no exclusion row
backlog: part of `git commit -m '```bash\nfeat(auth): add jwt token refresh endpoint\n\nCloses BD-45\n```'`: `git commit -m sample` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:45: no exclusion row
resume: part of `git commit -m '```bash\nfeat(auth): add jwt token refresh endpoint\n\nCloses BD-45\n```'`: `git commit -m sample` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:45: no exclusion row
```

The last six lines are the part-by-part decision: the composition rows still match the multi-line and heredoc commits, and their `git commit` parts fail on their own. The second failing test is the de-admission guard, whose baseline conformance check fails the same way.

After restoring `launch.ts`, the same command passes: `Tests  40 passed (40)`.

### 2. Delete the `reason_fact_false` marker on the `gate-auto.sh` row: the reason check fails

```bash
# delete the reason_fact_false line inside the gate-auto row (content-addressed, not a line number)
sed -i '' '/id: "gate-auto",/,/^  },/{/reason_fact_false/d;}' src/automate/run-exclusions.ts
npx vitest run test/loomwright-conformance.test.ts
```

```text
Tests  1 failed | 39 passed (40)
+   "gate-auto: \"starts a claude process\" is false for gate-auto.sh in Loomwright 18.1.2",
```

### The brief's other pin mutations (each restored afterwards)

| Mutation | Result |
|---|---|
| `"guard-lane-wait-armed.sh", "lane-policy.sh",` → `"guard-lane-wait-armed.sh",` in `launch.ts` | red: ``backlog: `scripts/lane-policy.sh catalog` (script) denied bash_prefix_not_allowed at commands/automate.md:58: no exclusion row`` (and the same for `resume` and `merge_parked`) |
| delete the extractor line that returns `unparsed` for an unrecognised shape (`extract.ts`, `if (words === undefined) return strict …`) | red: both AC 10a cases fail (the synthetic unparsable line is dropped) |
| the `rh-gh-pr-comment` row's line `290` → `289` in `run-exclusions.ts` | red: `rh-gh-pr-comment: anchor not found at the cited line scripts/review-heal-next-step.sh:289 ("pr comment \"$PR\" --body"; the line reads "rh_comment() { # <body> — best-effort; a failure is reported, never fatal")` |

## Honest limits

- **Prose mentions become entries.** The extractor reads a backticked command as an instruction even when the text only mentions it. Those entries are recorded under `advisory, never instructed` rather than filtered out.
- **Driver text is read statically.** A driver's printed text built from shell variables (`$w`, `$a` in `automate-next-step.sh`'s fresh-phase `run launch`) is read only as far as its literals go, and is kept as `unparsed`. The past-the-rail probe (25h) runs the drivers.
- **Placeholders get sample values.** `<…>` and `{…}` placeholders are filled with sample values (a run id, a PR URL, a sha) before the decision. `$VAR`, `$(…)` and other real metacharacters are kept as written, because the rail really refuses them.
- **Tool names:** `Task` is read as the SDK's `Agent` tool. A `Bash` tool name is checked against the grant, and its commands are decided one by one.
- **The scan test has one reviewed exemption.** `kernel/test/automate-merge-check.test.ts` pins the file list of `kernel/src/automate/`, so it now lists `run-exclusions.ts`. The table writes the GitHub CLI's merge command literally, as text to match: Loomwright's counter-examples and gate-eval's cited line. So the file is exempt from the scan's merge-text patterns only (`a /merge endpoint`, `gh pr merge`, `a merge mutation`). The merge-call, process and network patterns still apply. A second test pins that the exemption covers inert data only: the file imports types alone, and every export is frozen and holds no function.
- **The part-by-part decision reads shell text, not a shell.** It does not enter backtick substitution or `( … )` subshells; their words become the literal value. A synopsis's `a|b` (no space around the `|`) is read as its first alternative. A part with no program word (`fi`, `done`, an assignment alone, a `| --alt` synopsis alternative) is skipped. Unparsed entries are not split: each `unparsed` row is anchored on the known lines of its block, so a new unparsed line in the same file still fails.
