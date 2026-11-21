# Phase 8 item 25a: the Loomwright conformance test, and its bite checks

Run 2026-11-21 on macOS against Loomwright 18.1.2 (`plugin_version` in the install's `capabilities.json`), base `9b3ca660`.

## What the test does

[`kernel/test/loomwright-conformance.test.ts`](../../kernel/test/loomwright-conformance.test.ts) extracts what Loomwright's instruction files and its four drivers tell each kernel run session kind to use, and decides each item with that kind's real run policy (`decideToolUse`, with scripts admitted by `loomwrightScriptPaths`). Each kind's file set is a closed constant in the test, one line of reason per file. Every denial must match exactly one row of `RUN_EXCLUSIONS` in [`kernel/src/automate/run-exclusions.ts`](../../kernel/src/automate/run-exclusions.ts). Any other denial fails the test, and the failure names the command, the kind, the deny reason and the source `file:line`.

- **Extractor:** [`kernel/test/fixtures/loomwright-instructions/extract.ts`](../../kernel/test/fixtures/loomwright-instructions/extract.ts). It reads shell fences, backtick spans, `scripts/<name>.sh` references, tool names (backticks, `Name(`, "the Name tool", front-matter `tools:`), slash commands, and the drivers' printed text. A shape it cannot parse is kept as `unparsed`, never dropped.
- **Fixture:** [`kernel/test/fixtures/loomwright-18.1.2-instructions.json`](../../kernel/test/fixtures/loomwright-18.1.2-instructions.json). It holds 1494 entries (566 script calls, 334 commands, 325 slash commands, 233 tool names, 36 unparsed) from 46 files, the 345 script names, every script's facts, and the cited lines. Paths are install-relative. Entries are sorted by file, then line, then text.
- **Modes:** plain `npm test` reads the fixture, so CI needs no install and no test reads `installed_plugins.json`. `STUDIO_LIVE=1` reads the install `resolveLoomwrightInstall()` returns. [`scripts/refresh-loomwright-fixture.sh`](../../scripts/refresh-loomwright-fixture.sh) runs the test's update mode (`LOOMWRIGHT_FIXTURE_UPDATE=1`), which rewrites the fixture, then prints `git diff -M --stat` on it.
- **Table:** 50 exclusion rows. 18 are known gaps: 2 `filed: 25b`, 15 `filed: 25c` and 1 `filed: 25d`. The rest are denied on purpose (a refused subcommand, a `claude` process, an outward post, a memory write) or are text that is not an instruction (`advisory, never instructed`). A row filed to a story whose criteria do not yet name the command says "not in 25x's list".
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

## Commands

```bash
cd kernel && npm ci && npm test                              # 146 files passed, 1 skipped; 5028 tests passed
cd kernel && npx vitest run test/loomwright-conformance.test.ts                 # fixture mode: 8 passed
cd kernel && STUDIO_LIVE=1 npx vitest run test/loomwright-conformance.test.ts   # live 18.1.2: 8 passed
bash scripts/refresh-loomwright-fixture.sh                   # update mode: 8 passed; fixture regenerated
cd kernel && npm run typecheck                               # clean
```

## Bite checks (requirement Validation 2 and 3), on a scratch copy

Each check edited a scratch copy of `kernel/` (`rsync -a --exclude node_modules kernel/ <scratch>/kernel/`, with `node_modules` symlinked). Each edit was restored by copying the file back from the worktree. Afterwards `diff -r -q --exclude node_modules <scratch>/kernel kernel` reported no difference. The worktree's `launch.ts`, `policy.ts` and `loomwright-scripts.ts` were never edited: `git diff 9b3ca660 -- kernel/src/automate/launch.ts kernel/src/sessions/policy.ts kernel/src/sessions/loomwright-scripts.ts` is empty.

### 1. Remove `"git commit"` from `RUN_BASH_PREFIXES`: red, and it names `skills/commit/SKILL.md`

```bash
sed -i '' 's/"git add", "git commit", /"git add", /' src/automate/launch.ts
npx vitest run test/loomwright-conformance.test.ts
```

```text
Tests  1 failed | 7 passed (8)
AssertionError: 9 denied instruction(s) without exactly one exclusion row:
backlog: `git commit` (command) denied bash_prefix_not_allowed at agents/code-reviewer.md:66: no exclusion row
resume: `git commit` (command) denied bash_prefix_not_allowed at agents/code-reviewer.md:66: no exclusion row
review_pr: `git commit` (command) denied bash_prefix_not_allowed at agents/code-reviewer.md:66: no exclusion row
backlog: `git commit -m "subtask: {id} — {title}"` (command) denied bash_prefix_not_allowed at agents/supervisor.md:197: no exclusion row
resume: `git commit -m "subtask: {id} — {title}"` (command) denied bash_prefix_not_allowed at agents/supervisor.md:197: no exclusion row
backlog: `git commit` (command) denied bash_prefix_not_allowed at skills/async-orchestration/finalize.md:51: no exclusion row
resume: `git commit` (command) denied bash_prefix_not_allowed at skills/async-orchestration/finalize.md:51: no exclusion row
backlog: `git commit -F -` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:27: no exclusion row
resume: `git commit -F -` (command) denied bash_prefix_not_allowed at skills/commit/SKILL.md:27: no exclusion row
```

After restoring `launch.ts`, the same command passes: `Tests  8 passed (8)`.

### 2. Delete the `reason_fact_false` marker on the `gate-auto.sh` row: the reason check fails

```bash
# the marker line of the gate-auto row in src/automate/run-exclusions.ts (line 124 then)
sed -i '' '124d' src/automate/run-exclusions.ts
npx vitest run test/loomwright-conformance.test.ts
```

```text
Tests  1 failed | 7 passed (8)
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
- **The scan test's file list changed.** `kernel/test/automate-merge-check.test.ts` pins the file list of `kernel/src/automate/`, so it now lists `run-exclusions.ts`. Its content scan (no merge call, endpoint or process start) runs on the new file too, and passes. The table names Loomwright's own merge only through its anchor text.
