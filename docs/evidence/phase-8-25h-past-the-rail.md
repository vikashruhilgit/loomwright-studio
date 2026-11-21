# Phase 8 item 25a, Part B: what admitted Loomwright scripts do past the rail

The rail decides every command a kernel run session asks for. It does not see what an admitted Loomwright script does once it runs. `bash <install>/scripts/review-heal-next-step.sh …` is one allowed call, and that script may post a PR comment, call a webhook or start a detached `claude`. This file lists every outward call and started process the probe found in the scripts the four run policies admit, with the condition that triggers each. Each row is classified, and every `needs a kernel-owned path` row carries a proposed path for the owner to decide.

**Nothing here changes a run policy (AC 12).** `launch.ts`, `policy.ts` and `loomwright-scripts.ts` are untouched. Every proposed path below is an owner decision and is not applied in this story.

## The run

- **Date:** 2026-11-21 (report written 2026-11-21T05:06:49Z).
- **Loomwright:** 18.1.2, the install `resolveLoomwrightInstall()` resolved (`~/.claude/plugins/cache/atelier/loomwright/18.1.2`, user scope).
- **Probe:** [`kernel/test/loomwright-past-the-rail-probe.test.ts`](../../kernel/test/loomwright-past-the-rail-probe.test.ts).
- **Admitted set:** the union of `loomwrightScripts` in `AUTOMATE_RUN_POLICY` (backlog and resume), `REVIEW_PR_RUN_POLICY`, `MERGE_PARKED_RUN_POLICY` and `MERGE_PARKED_TRUSTED_RUN_POLICY` ([`launch.ts`](../../kernel/src/automate/launch.ts)): 49 scripts, all present in 18.1.2.
- **Command:**

  ```
  cd kernel && STUDIO_LIVE=1 npx vitest run test/loomwright-past-the-rail-probe.test.ts
  ```

- **Output:**

  ```
  past-the-rail report: /var/folders/…/T/studio-past-the-rail-report-V6gWQo
   Test Files  1 passed (1)
        Tests  13 passed (13)
  ```

  Seven tests check the scanner against a synthetic install and run in CI. Six are live: one static scan and five dynamic runs. Without `STUDIO_LIVE=1` the six live tests are skipped with the note `skipped: set STUDIO_LIVE=1 (with a resolvable Loomwright install) to run Loomwright's real scripts; plain npm test and CI never run them`. The report directory holds `report.json` (every scan, every hit and every observed call) and `report.md`. The tables below were built from that report.

### How the probe ran the scripts

- **Sandbox:** each dynamic run gets its own scratch git repo under the OS temp dir. The repo's only remote is a local bare `origin.git`, and `HOME` is moved into the scratch dir.
- **Stubs:** `gh`, `claude`, `curl`, `wget`, `osascript`, `notify-send` and `terminal-notifier` are stubs that record their argv to a log. They come first on `PATH`, and before any script runs the probe checks with `command -v` that `gh`, `claude` and `curl` resolve to them.
- **Seams:** the scripts' own seams are set to recorders where they exist: `LOOMWRIGHT_GH_BIN`, `RH_POSTMORTEM_CMD`, `RH_NOTIFY_CMD`, `NEXT_STEP_WATCH_CMD`, `NEXT_STEP_NOTIFY_CMD` and `NEXT_STEP_LOCK_CMD`.
- **Environment:** the scripts get a minimal allow-listed env, so `GH_TOKEN` and `GITHUB_TOKEN`, any webhook URL from the shell, and the Claude session variables are never passed. The only webhook URL the probe sets is the loopback discard address `http://127.0.0.1:9/…`, and it reaches only the stub `curl`.
- **PR:** the placeholder `https://github.com/studio-probe/past-the-rail-sandbox/pull/7`. `gh` is a stub, so nothing reaches GitHub.
- **`awaiting_merge` run file:** a copy of Loomwright's own golden case `scripts/fixtures/automate-golden/gate-eval-checks-not-green-park`, with its PR URL rewritten to the placeholder. The driver is called with `NEXT_STEP_FROM=park`.
- **The real watcher:** it ran with `LOOMWRIGHT_MERGE_WATCH_MAX_SECONDS=60` as a backstop and was stopped with TERM once its poll was seen. The probe checked that the pid was gone.

### Evidence kinds and classes

- **Evidence:**
  - `observed (probe)`: a stub or recorder logged the call, or the bare origin gained the ref, in a dynamic run.
  - `read (static)`: the probe found the line in the script's text.
- **Class:**
  - `already gated elsewhere`: the call happens only on a path the kernel already refuses or owns.
  - `harmless`: a GitHub read the session's own rail would also allow, a local-only action, or no call at all (message, pattern or parser text the token scan matched).
  - `needs a kernel-owned path`: an outward write or a process the kernel does not own, reachable in a kernel run.

### Honest limits of the static scan

- **It over-approximates reach.** It follows every loaded file and every `$VAR/<name>.sh` / `$(…)/<name>.sh` reference transitively. A dispatcher such as `automate-helpers.sh` therefore pulls in every family its subcommands could reach (87 files), including lanes and waves that a kernel run never starts. The class column says which rows are reachable.
- **It over-matches text.** Tokens in messages, jq patterns and parser code count as hits. Those rows are kept and marked `harmless` with the reason "no call". None is dropped.
- **It can miss a call built at run time.** For example, a binary held in a variable whose name holds no `GH` or `CLAUDE_BIN`, or a path assembled from `$1`. The CI cases pin the forms it does recognise. The dynamic runs cover the four required paths whatever the scan says.
- **It knows no conditions.** For the `read (static)` rows, the trigger column comes from reading the surrounding function, not from running it.

## Observed (probe)

| Run | Script:line | Call | Trigger | Seen | Class |
|---|---|---|---|---|---|
| review-heal | `review-heal-next-step.sh:290` | `gh pr comment` (`rh_comment`) | a drain that ends ESCALATED (here `--fix-floor urgent` ⇒ `fix_floor_invalid`); READY takes the same notify path, and the dismissed-findings marker comment (998) uses the same function | `gh pr comment <PR> --body review-heal drain ESCALATED (fix_floor_invalid) …` | needs a kernel-owned path |
| review-heal | `review-heal-next-step.sh:318` | `send-webhook.sh`, which runs `curl` | the same terminal notify, `RH_WEBHOOK_CMD` unset; `curl` runs only when a webhook URL resolves (user-scope `~/.claude/loomwright/egress.json` for the repo, or `LOOMWRIGHT_WEBHOOK_URL`) | `curl -fs --max-time 5 -X POST -H Content-Type: application/json --data-binary @- http://127.0.0.1:9/studio-past-the-rail-probe` | needs a kernel-owned path |
| review-heal | `review-heal-next-step.sh:1098` (`rh_postmortem_call`, 323) | `dispatch-pr-postmortem.sh`, through `RH_POSTMORTEM_CMD` | every finished drain run, once (`rh_once postmortem`); the dispatcher applies the churn gate | `RH_POSTMORTEM_CMD postmortem <PR> --fix-cycles 0 --decision ESCALATED --postmortem-churn-threshold 2` | needs a kernel-owned path |
| postmortem | `dispatch-pr-postmortem.sh:321` | a detached headless `claude -p` (`nohup … &`) | fix_cycles above the threshold (default 2), a repeat check failure or unresolved bot feedback; once per PR (a marker file); not with `--no-auto-postmortem` | `claude -p /loomwright:pr-postmortem <PR>` | needs a kernel-owned path |
| park-seam | `automate-next-step.sh:812` | the merge-watcher launch, through `NEXT_STEP_WATCH_CMD` | the park step with park_kind `awaiting_merge` or `escalated` (never `ready_for_release`) | `NEXT_STEP_WATCH_CMD watch <repo>/.supervisor/automate/automate-2026-10-13-181331.md .supervisor/requirements/automate-followups/39a-sweep-and-janitor.md <PR>` | needs a kernel-owned path (the 814 row) |
| park-default | `automate-next-step.sh:814` | detached `nohup bash automate-merge-watch.sh … &`, a process that outlives the session (up to 72 h) | the same park with `NEXT_STEP_WATCH_CMD` unset, which is every real run | watcher pid 55946 alive after the driver exited; stopped with TERM | needs a kernel-owned path |
| park-default | `automate-merge-watch.sh:428` | `gh pr view` polls by the detached watcher | every `LOOMWRIGHT_MERGE_WATCH_INTERVAL` (default 60 s) until MERGED, CLOSED or the cap | `gh pr view <PR> --json state,headRefOid` | harmless (a read; the process is the 814 row) |
| meta-sync | `meta-sync.d/commands.sh:23` | push to `origin` (`init` creates the metadata branch) | `meta-sync.sh init`, which a session may call directly: only `push` is refused (`LOOMWRIGHT_DENIED_SUBCOMMANDS`) | the bare origin gained `refs/heads/studio-probe-meta` | needs a kernel-owned path |
| meta-sync | `meta-sync.d/commands.sh:186` | push to `origin` with `--force-with-lease` (run history to the metadata branch) | `meta-sync.sh push`: refused to the session, but run by the driver's own `trail_pr` in memory mode on (`trail-pr.sh:466`, `:505`) | the bare origin's `studio-probe-meta` holds `.supervisor/automate/probe-run.md` | needs a kernel-owned path |

## Owner decisions: the `needs a kernel-owned path` rows

These are proposals only, and none is applied here. Each names the seam Loomwright 18.1.2 already offers where one exists.

1. **The merge watcher** (`automate-next-step.sh:814`; its webhook at `automate-merge-watch.sh:237`; its close-out runs the trail rows below). Every parked backlog or resume run starts a detached bash process that the kernel does not own (invariant 2). It lives up to 72 hours, polls GitHub, and after a merge pushes the trail and posts a webhook. **Proposed path:** the kernel sets `NEXT_STEP_WATCH_CMD` to a kernel-owned watcher, which records the park as a kernel task the kernel's own PR tracking (`pr_tracks`, `kernel_automate_merge_check`) wakes. Loomwright's close-out then runs as a kernel-scheduled step that the approval gate sees.
2. **The review-heal PR comment** (`review-heal-next-step.sh:290`). The drain posts the terminal ESCALATED comment and the dismissed-findings marker comment past the approval gate. **Proposed path:** the kernel sets `LOOMWRIGHT_GH_BIN` to a kernel-owned `gh` wrapper that passes reads through and sends `pr comment` (and any other write) to the approval gate. The same wrapper covers `gh pr create` in `trail-pr.sh:779`, because every Loomwright helper honours `LOOMWRIGHT_GH_BIN`.
3. **The webhook** (`review-heal-next-step.sh:318`, `send-webhook.sh:291/405/427/663`, `automate-merge-watch.sh:237`, `trail-pr.sh:422`). The webhook posts only to a URL the user configured in the user-scope `egress.json` for the repo. **Proposed path:** for the drain, the kernel sets `RH_WEBHOOK_CMD` to Studio's own notifier. For the paths with no seam (the watcher and the trail), the owner decides whether a user-configured Loomwright webhook counts as the user's own channel or must be unset for kernel runs.
4. **The postmortem dispatch** (`review-heal-next-step.sh:1098`/`323`, `dispatch-pr-postmortem.sh:321`). A churny drain starts a detached headless `claude -p` that the kernel does not own (invariant 2). **Proposed path:** the kernel sets `RH_POSTMORTEM_CMD` to a recorder that queues `/loomwright:pr-postmortem <PR>` as a kernel-owned session. Alternatively, a kernel run passes `--no-auto-postmortem` (or `auto_postmortem: false` in the run's config) and the owner runs postmortems by hand.
5. **The trail push and trail PR** (`trail-pr.sh:744` `git push origin`, `:779` `gh pr create` in memory mode off; `meta-sync.d/commands.sh:186` through `trail-pr.sh:466`/`:505` in memory mode on). The driver runs `trail-pr` itself at terminate (`automate-next-step.sh:3506`, `:3517`), on a skipped or abandoned item (`:1855`), and through `closeout` (`closeout.sh:439`): from the watcher, from the resume entry's `closeout-others` (`automate-next-step.sh:586`) and from merge_parked's close-out. The session's own `trail-pr` / `closeout` / `meta-sync.sh push` are refused, but these driver-internal calls are not seen. **Proposed path:** the `gh pr create` leg is covered by decision 2. The `git push` legs have no seam in 18.1.2. Either the kernel publishes the trail itself as an approval-gated action (asking Loomwright for a `--no-trail` or `LOOMWRIGHT_TRAIL_CMD` seam on the terminate step; `closeout` and `finalize` already take `--no-trail`), or the owner accepts the trail branch as run bookkeeping.
6. **`meta-sync.sh init`** (`meta-sync.d/commands.sh:23`). A session's direct `bash <install>/scripts/meta-sync.sh init --branch <b>` creates a branch on `origin`, and only `push` is refused today. **Proposed path:** add `init` to `meta-sync.sh`'s refused subcommands (a change to `LOOMWRIGHT_DENIED_SUBCOMMANDS` in [`loomwright-scripts.ts`](../../kernel/src/sessions/loomwright-scripts.ts), which is a policy change for the owner and not made here). Alternatively, leave it as a one-time setup step the owner runs.

## Admitted scripts

Each admitted script, the policies that admit it, how many files its closure holds (itself plus everything it loads or calls), and how many hit lines it reaches. A script with none is recorded `no outward call in text (static, loaded files followed)`.

| Script | Policies | Files in closure | Hit lines |
|---|---|---|---|
| Script | Policies | Files in closure | Hit lines |
|---|---|---|---|
| `automate-dismissed.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 87 | 153 |
| `automate-helpers.sh` | backlog/resume, review_pr, merge_parked, merge_parked (trusted) | 87 | 153 |
| `automate-next-step.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 89 | 159 |
| `build-context-digest.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `build-insights.sh` | backlog/resume | 4 | no outward call in text (static, loaded files followed) |
| `build-repo-map.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `build-state.sh` | backlog/resume | 2 | no outward call in text (static, loaded files followed) |
| `check-children-settled.sh` | backlog/resume | 2 | no outward call in text (static, loaded files followed) |
| `checkpoint.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `ci-run-probe.sh` | review_pr | 1 | 3 |
| `classify-bot-review.sh` | review_pr | 1 | 1 |
| `classify-risk.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 1 | no outward call in text (static, loaded files followed) |
| `drain-gh-read.sh` | review_pr | 3 | 7 |
| `drain-rounds.sh` | review_pr | 1 | no outward call in text (static, loaded files followed) |
| `drain-subfloor-decision.sh` | review_pr | 2 | no outward call in text (static, loaded files followed) |
| `emit-progress-event.sh` | backlog/resume | 3 | no outward call in text (static, loaded files followed) |
| `exec-acceptance-hash.sh` | backlog/resume | 2 | no outward call in text (static, loaded files followed) |
| `fix-floor.sh` | backlog/resume, review_pr, merge_parked, merge_parked (trusted) | 1 | no outward call in text (static, loaded files followed) |
| `guard-arm.sh` | review_pr | 2 | no outward call in text (static, loaded files followed) |
| `guard-finalize-publish.sh` | backlog/resume | 4 | 2 |
| `guard-lane-wait-armed.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 1 | no outward call in text (static, loaded files followed) |
| `heal-review-scope.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `lane-policy.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 87 | 153 |
| `launch-pad-phase.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `meta-sync.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 21 | 17 |
| `module-shape-facts.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `notify-desktop.sh` | review_pr | 6 | 4 |
| `pr-postmortem-gather.sh` | review_pr | 2 | 7 |
| `progress-line-match.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 1 | no outward call in text (static, loaded files followed) |
| `read-lessons.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `read-orientation.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `read-postmortem.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `read-project-memory.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `read-rules.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `read-system-contract.sh` | backlog/resume | 19 | 14 |
| `read-token-ledger.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 3 | no outward call in text (static, loaded files followed) |
| `reconcile-resume-state.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `release-refold.sh` | backlog/resume, review_pr | 1 | no outward call in text (static, loaded files followed) |
| `resolve-base-branch.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 1 | 2 |
| `review-heal-next-step.sh` | backlog/resume, review_pr | 97 | 180 |
| `rules-gate-verdict.sh` | backlog/resume, review_pr, merge_parked, merge_parked (trusted) | 3 | no outward call in text (static, loaded files followed) |
| `run-lock.sh` | backlog/resume, merge_parked, merge_parked (trusted) | 1 | no outward call in text (static, loaded files followed) |
| `supervisor-next-step.sh` | backlog/resume | 92 | 161 |
| `twin-graph.sh` | backlog/resume | 20 | 14 |
| `verify-provides.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `wait-for-checks.sh` | review_pr | 5 | 10 |
| `worktree-audit.sh` | backlog/resume | 5 | 2 |
| `worktree-salvage.sh` | backlog/resume | 1 | no outward call in text (static, loaded files followed) |
| `wrap-external-text.sh` | review_pr | 1 | no outward call in text (static, loaded files followed) |

## Static hits (read), each line once

Every line the static scan matched across the 49 closures (200 lines), sorted by file and line. Paths are relative to the install's `scripts/`. **Reached by** is how many admitted scripts' closures contain the line. A row the dynamic runs also exercised says `observed (probe)`.

| Script:line | Tokens | Text | Reached by | Trigger | Evidence | Class |
|---|---|---|---|---|---|---|
| `automate-helpers.d/backlog.sh:332` | gh | `j1="$(cd "$root" && "$GH" pr list --state merged --limit "$_BL_PR_LIMIT" --json number,url` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/backlog.sh:333` | gh | `j2="$(cd "$root" && "$GH" pr list --state open --limit "$_BL_PR_LIMIT" --json number,url,t` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/backlog.sh:612` | background & | `) > "$_BL_TMP/rs.json" 2>/dev/null &` | 6 | a local background subshell writing a temp file | read (static) | harmless |
| `automate-helpers.d/backlog.sh:630` | gh | `elif (.evidence \| test("^## Status:[[:space:]]*(pending\|ready)([^A-Za-z0-9_-]\|$)")) then "` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/escalation.sh:60` | gh | `snap="$(GH="$GH" JQ="$JQ" bash "$(dirname "$0")/wait-for-checks.sh" "$url" --sha "$sha" --` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/escalation.sh:90` | gh | `view="$("$GH" pr view "$url" --json changedFiles,files 2>/dev/null)"` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/escalation.sh:104` | gh | `log="$("$GH" run view "$rid" --log-failed 2>/dev/null)" \|\| { verdict=check_red; break; }` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/escalation.sh:128` | gh | `v="$("$GH" pr view "$1" --json statusCheckRollup 2>/dev/null)"` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/escalation.sh:139` | gh | `a="$("$GH" run view "$1" --json attempt 2>/dev/null \| "$JQ" -r '.attempt // empty' 2>/dev/` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/learning.sh:398` | gh | `if ! command -v "$GH" >/dev/null 2>&1; then` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/learning.sh:399` | gh | `echo "brief-repair: skipped — gh unavailable"; return 0` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/learning.sh:402` | gh | `view="$("$GH" pr view "$pr_url" --json state,mergedAt 2>/dev/null)"` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/learning.sh:404` | gh | `echo "brief-repair: skipped — gh pr view failed"; return 0` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/learning.sh:407` | gh | `echo "brief-repair: skipped — gh output unparseable"; return 0` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:341` | gh | `if ! "$GH" pr list --state merged --limit "$_RS_PR_LIST_LIMIT" --json number,url,title,bod` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:342` | gh | `_rs_note_unverified merged-pr-list "gh pr list failed; no merged PR was checked"` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:347` | gh | `''\|*[!0-9]*) _rs_note_unverified merged-pr-list "gh pr list answered unreadable JSON; no m` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:376` | gh | `if ! hits="$("$GH" pr list --state merged --search "$short" --json url --limit 5 2>/dev/nu` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:377` | gh | `_rs_note_unverified "$short" "gh search failed; a merged PR on a matching branch was not c` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:408` | gh | `paths="$("$GH" api --hostname "$host" --paginate "repos/$owner/$repo/pulls/$num/files" --j` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:449` | gh | `view="$("$GH" pr view "$c" --json number,body,mergeCommit,headRefName,files,changedFiles 2` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:450` | gh | `[ -n "$view" ] \|\| { _rs_note_unverified "$c" "gh pr view failed; this PR was not checked";` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:466` | gh | `view="$("$GH" pr view "$c" --json files,changedFiles 2>/dev/null)"` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:467` | gh | `[ -n "$view" ] \|\| { _rs_note_unverified "$c" "gh pr view failed; this PR's diff was not re` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/reconcile-status.sh:607` | gh | `set +e   # FAIL-SAFE: one candidate's gh hiccup degrades to "no evidence", never an abort.` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/resume.sh:144` | gh | `if ! view="$("$GH" pr view "$url" --json state,mergedAt 2>/dev/null)"; then` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/resume.sh:221` | gh | `if ! view="$("$GH" pr view "$pr" --json state 2>/dev/null)"; then` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/resume.sh:310` | gh | `leftover\|guard\|skipped — gh unavailable` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.d/runfile.sh:622` | gh | `if view="$("$GH" pr view "$pr" --json headRefName,state,mergedAt 2>/dev/null)"; then` | 6 | gh reads (escalation cause, brief repair, reconcile, resume, run file) or message text | read (static) | harmless |
| `automate-helpers.sh:141` | gh | `GH="${LOOMWRIGHT_GH_BIN:-gh}"` | 6 | gate-eval's PR / protection reads, or an assignment | read (static) | harmless |
| `automate-helpers.sh:647` | gh | `pv="$("$GH" pr view "$url" --json headRefOid,baseRefName,statusCheckRollup 2>/dev/null)" \|` | 6 | gate-eval's PR / protection reads, or an assignment | read (static) | harmless |
| `automate-helpers.sh:663` | gh | `pv2="$("$GH" pr view "$url" --json reviewDecision 2>/dev/null)" \|\| pv2_rc=$?` | 6 | gate-eval's PR / protection reads, or an assignment | read (static) | harmless |
| `automate-helpers.sh:699` | gh | `gql="$("$GH" api graphql -f query='` | 6 | gate-eval's PR / protection reads, or an assignment | read (static) | harmless |
| `automate-helpers.sh:753` | gh | `prot_raw="$("$GH" api "repos/$owner/$repo/branches/$live_base/protection" 2>&1)" \|\| prot_r` | 6 | gate-eval's PR / protection reads, or an assignment | read (static) | harmless |
| `automate-helpers.sh:778` | gh | `rulesets_required_read "$GH" "$JQ" "$owner" "$repo" "$live_base"` | 6 | gate-eval's PR / protection reads, or an assignment | read (static) | harmless |
| `automate-helpers.sh:1179` | gh | `if "$GH" pr merge --squash --match-head-commit "$live_head" "$url" >/dev/null 2>&1; then` | 6 | `gate-eval`'s merge: refused to the session; the driver runs it only on the `--merge-parked` entry (merge_parked, after the owner's go, D40) or in auto mode, which the safe-mode driver profile refuses | read (static) | already gated elsewhere |
| `automate-lanes.d/evidence.sh:63` | gh | `view="$("$LANES_GH" pr view "$pr" --json headRefOid,files 2>/dev/null </dev/null)" \|\| view` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/evidence.sh:70` | gh | `lst="$("$LANES_GH" api "repos/$slug/contents/docs/evidence?ref=$sha" 2>/dev/null </dev/nul` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/evidence.sh:81` | gh | `"$LANES_GH" api -H 'Accept: application/vnd.github.raw' "repos/$slug/contents/$f?ref=$sha"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/launch.sh:4` | claude | `local h; h="$(claude --help 2>&1)" \|\| true` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/launch.sh:115` | push to origin | `disallow="$LANE_DISALLOWED_FIXED,Bash(git push origin $base:*),Bash(git push origin HEAD:$` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/launch.sh:168` | nohup | `LOOMWRIGHT_LANE_RUN_KIND=lane nohup bash "$SELF" _lane-run "$LN_DIR" "$LN_LOG" "$LN_DIED" ` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/launch.sh:170` | claude, background & | `LOOMWRIGHT_LANE_RESUME_PATH="${LN_RESUME_PATH:-}" claude "${flags[@]}" >> "$LN_LOG" 2>&1 &` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/launch.sh:207` | background & | `"$@" < "$in" &` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/launch.sh:218` | background & | `_lanes_register --pid "$cp" --kind "$kind" --owner-pid "$$" "${ra[@]}" --expect "$(_lanes_` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/notify-guards.sh:60` | send-webhook.sh | `local sw="${LOOMWRIGHT_LANES_SEND_WEBHOOK:-$HERE/send-webhook.sh}"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/notify-guards.sh:91` | send-webhook.sh | `if [ ! -f "$sw" ]; then web="failed (send-webhook.sh absent)"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/notify-guards.sh:104` | send-webhook.sh | `if [ -n "$err" ]; then web="failed ($err)"; else web="attempted (POST sent; delivery not r` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/park-leaks.sh:180` | claude | `case "$cmd" in *"automate-lanes.sh _lane-run "*) continue ;; *"claude -p"*) ;; *) continue` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/phase.sh:125` | nohup | `LOOMWRIGHT_LANE_RUN_KIND=phase nohup bash "$SELF" _lane-run "$PH_CO" "$PH_LOG" "$PH_DIED" ` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/phase.sh:127` | claude, background & | `LOOMWRIGHT_PHASE_DIR="$PH_DIR" LOOMWRIGHT_RUN_LOCK_SESSION_ID="$csid" claude "${flags[@]}"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/phase.sh:150` | claude | `command -v claude >/dev/null 2>&1 \|\| { echo "phase-check: unavailable — no claude on PATH"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/readiness.sh:340` | gh | `if [ -n "$pr" ] && view="$("$LANES_GH" pr view "$pr" --json body,headRefOid 2>/dev/null)" ` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/readiness.sh:391` | gh | `if [ -z "$pr" ] \|\| ! "$LANES_GH" pr diff "$pr" --name-only > "$tmp/files" 2>/dev/null; the` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/readiness.sh:392` | gh | `fworst=NOT-RUN; if [ -n "$pr" ]; then fline="scope-fence: NOT-RUN — gh pr diff unreadable ` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/readiness.sh:407` | gh | `cj="$("$LANES_GH" pr checks "$pr" --required --json name,bucket 2>/dev/null)" \|\| true` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/readiness.sh:596` | gh | `if [ -n "$pr" ] && view="$("$LANES_GH" pr view "$pr" --json body 2>/dev/null)" && jq -e 't` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/remove.sh:168` | claude | `if [ "$stop" = 1 ]; then live_pid="$pid"; else _refuse "live claude -p process (pid $pid);` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/remove.sh:179` | claude | `[ -n "$live_pid" ] && _lanes_stop_pid "$live_pid" "claude -p"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/scope.sh:333` | gh | `j="$("$LANES_GH" pr view "$pr" --json headRefOid,headRefName 2>/dev/null </dev/null)"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/status-read.sh:5` | gh | `LANES_GH="${LOOMWRIGHT_GH_BIN:-gh}"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/status-read.sh:194` | claude | `case "${c##*/}" in claude) printf '%s' "$p"; return 0 ;; esac` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/status-read.sh:217` | nohup, background & | `nohup "$cf" -i -w "$cp" >/dev/null 2>&1 &` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/status.sh:293` | background & | `tail -n +1 -f "$LN_LOG" \| grep --line-buffered '^{' \| jq --unbuffered -r -R "$_LANES_FEED_` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/wave.sh:290` | gh | `cj="$(cd "$primary" && "$LANES_GH" api "repos/{owner}/{repo}/commits/$sha/check-runs?check` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/wave.sh:379` | gh | `j="$("$LANES_GH" pr view "$pr" --json headRefOid,state 2>/dev/null </dev/null)"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/wave.sh:418` | gh | `if ! "$LANES_GH" pr diff "$pr" --name-only > "$tmp/f" 2>/dev/null </dev/null; then` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/wave.sh:500` | push to origin | `echo "git push -u origin $wb"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.d/wave.sh:501` | gh | `echo "gh pr create --base $base --head $wb"` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.sh:309` | gh | `LANE_DISALLOWED_FIXED="Bash(gh pr merge:*),Bash(gh pr merge *),Bash(*--admin*),Bash(gh api` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-lanes.sh:317` | claude | `LANE_SYS="You are running as a HEADLESS lane (claude -p). When your turn ends, this proces` | 6 | lane and phase subcommands only: refused to the session (`LANE_FORWARDED_SUBCOMMANDS`); `--parallel` and fresh phases are never taken by a kernel run (safe mode, `--inline-phases`) | read (static) | already gated elsewhere |
| `automate-merge-watch.sh:129` | gh | `GH="${LOOMWRIGHT_GH_BIN:-gh}"` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-merge-watch.sh:237` | send-webhook.sh | `bash "$HERE/send-webhook.sh" --event-type gate --gate-type "$gt" --context "$msg" >/dev/nu` | 6 | the watcher's notify at MERGED / CLOSED / cap / repeated poll failure (no seam for this leg) | read (static) | needs a kernel-owned path |
| `automate-merge-watch.sh:290` | background & | `nap() { sleep "$1" & SLEEP_PID=$!; wait "$SLEEP_PID" 2>/dev/null; SLEEP_PID=""; return 0; ` | 6 | a local `sleep` between polls | read (static) | harmless |
| `automate-merge-watch.sh:336` | gh | `pv="$("$GH" pr view "$pr_url" --json headRefOid,statusCheckRollup 2>/dev/null)" \|\| return ` | 6 | the watcher's settle re-check reads (escalated parks only) | read (static) | harmless |
| `automate-merge-watch.sh:345` | gh | `j="$("$GH" run view "$rid" --json attempt,status,conclusion,headSha 2>/dev/null)" \|\| retur` | 6 | the watcher's settle re-check reads (escalated parks only) | read (static) | harmless |
| `automate-merge-watch.sh:355` | gh | `j="$("$GH" api "repos/$owner_repo/commits/$sha/check-runs?per_page=100" 2>/dev/null)" \|\| r` | 6 | the watcher's settle re-check reads (escalated parks only) | read (static) | harmless |
| `automate-merge-watch.sh:393` | gh | `progress "still failing: $chk ${concl:-unknown} — rerun: gh run rerun ${rid:-<run_id>} --f` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-merge-watch.sh:394` | gh | `notify_as automate_escalation_recheck "$pr_url still failing — $chk ${concl:-unknown} on $` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-merge-watch.sh:406` | gh | `fails=0         # consecutive failed 'gh pr view' polls` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-merge-watch.sh:428` | gh | `view="$("$GH" pr view "$pr_url" --json state,headRefOid 2>"$GH_ERR")"; rc=$?` | 6 | the detached watcher's poll (a read; the process itself is the 814 row) | observed (probe) | harmless |
| `automate-merge-watch.sh:435` | gh | `echo "merge-watch: gh pr view failed — next poll in ${wait_s}s ($detail)"` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-merge-watch.sh:439` | gh | `progress "gh pr view $pr_url has failed $since ($fails) — last: $detail; a merge is not cl` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-merge-watch.sh:440` | gh | `notify "/automate merge watcher cannot read $pr_url — gh pr view failed $since ($fails); l` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-merge-watch.sh:445` | gh | `progress "gh pr view $pr_url works again after $fails failed polls"` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-merge-watch.sh:467` | gh | `case "$guard" in "gh unavailable"\|"pr not merged"*) why="$guard" ;; esac` | 6 | no call: an assignment or message text | read (static) | harmless |
| `automate-next-step.sh:814` | nohup | `nohup bash "$HERE/automate-merge-watch.sh" "$RF" "$ITEM" "$PR" \` | 1 | `ns_watch`: the park step, park_kind awaiting_merge or escalated, `NEXT_STEP_WATCH_CMD` unset; every parked backlog / resume run | observed (probe) | needs a kernel-owned path |
| `automate-next-step.sh:815` | background & | `</dev/null >"$AD/$RUN_ID.merge-watch.log" 2>&1 &` | 1 | `ns_watch`: the park step, park_kind awaiting_merge or escalated, `NEXT_STEP_WATCH_CMD` unset; every parked backlog / resume run | observed (probe) | needs a kernel-owned path |
| `automate-next-step.sh:1332` | gh | `ns_gh() { "${LOOMWRIGHT_GH_BIN:-gh}" "$@" </dev/null 2>/dev/null; }` | 1 | `ns_gh`: the drain spawn's head-sha read and learning-emit's one `gh pr view` | read (static) | harmless |
| `automate-next-step.sh:3598` | gh | `ns_sha_ok "$live" && [ -n "$hb" ] && [ -n "$base" ] \|\| { ns_mp_due pr_unreadable "gh pr vi` | 1 | no call: message text | read (static) | harmless |
| `automate-next-step.sh:3606` | gh | `[ "$rc" != 2 ] \|\| { ns_mp_due feedback_unreadable "gh api repos/$o/$r/$ep unreadable" "the` | 1 | no call: message text | read (static) | harmless |
| `automate-next-step.sh:3612` | gh | `ns_count_ok "$ba" \|\| { ns_mp_due base_unreadable "gh api repos/$o/$r/compare/$base...$rs u` | 1 | no call: message text | read (static) | harmless |
| `automate-trail.d/closeout.sh:143` | gh | `if ! command -v "$GH" >/dev/null 2>&1 \|\| ! "$GH" auth status >/dev/null 2>&1; then echo "$` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/closeout.sh:209` | gh | `view="$("$GH" pr view "$pr_url" --json headRefName,headRefOid 2>/dev/null)"` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/closeout.sh:228` | gh | `wt_line="$S head branch unresolved (gh pr view headRefName/headRefOid failed)"; head_ref="` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/stage-sync.sh:84` | gh | `if ! command -v "$GH" >/dev/null 2>&1; then echo "$K gh unavailable"; return 0; fi` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/stage-sync.sh:98` | gh | `list="$("$GH" pr list --state open --search "head:chore/$run_id-trail" --limit 100 --json ` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/stage-sync.sh:100` | gh | `echo "$K trail PR state unreadable (gh pr list failed)"; return 0` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/sweep.sh:84` | gh | `js="$(cd "$SW_PRI" 2>/dev/null && "$GH" pr list --state all --head "$b" --json number,stat` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/sweep.sh:95` | gh | `"!rc "*) SW_WHY="gh read failed (pr list --head, rc ${newest#!rc })"; return 0 ;;` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/sweep.sh:96` | gh | `"!unparseable") SW_WHY="gh read failed (unparseable pr list)"; return 0 ;;` | 6 | close-out / trail-gate / sweep reads or message text | read (static) | harmless |
| `automate-trail.d/trail-pr.sh:422` | send-webhook.sh | `bash "$HERE/send-webhook.sh" --event-type gate --gate-type automate_meta_push --context "$` | 6 | `_trail_meta_fail`: a failed branch-mode trail push | read (static) | needs a kernel-owned path |
| `automate-trail.d/trail-pr.sh:532` | gh | `if ! command -v "$GH" >/dev/null 2>&1; then echo "$skip_prefix gh unavailable"; return 0; ` | 6 | no call: a check, message text or a trailing comment | read (static) | harmless |
| `automate-trail.d/trail-pr.sh:566` | gh | `list="$("$GH" pr list --state all --search "head:chore/$run_id-trail" --limit 100 --json n` | 6 | `trail_pr`'s PR reads | read (static) | harmless |
| `automate-trail.d/trail-pr.sh:568` | gh | `echo "$skip_prefix gh pr list failed$excluded"; return 0` | 6 | no call: a check, message text or a trailing comment | read (static) | harmless |
| `automate-trail.d/trail-pr.sh:595` | push to origin | `orphan=1; base_ref="refs/remotes/origin/$branch"   # crash between push and PR-open` | 6 | no call: a check, message text or a trailing comment | read (static) | harmless |
| `automate-trail.d/trail-pr.sh:744` | push to origin | `if ! git -C "$TRAIL_WT" push -q origin "HEAD:refs/heads/$branch" >/dev/null 2>&1; then` | 6 | `trail_pr` in memory mode off: the driver's terminate (`automate-next-step.sh:3506`, `:3517`), a skipped / abandoned item (`:1855`), and `closeout` after a merge (`closeout.sh:439`, from the merge watcher, the resume entry's `closeout-others` and merge_parked's close-out) | read (static) | needs a kernel-owned path |
| `automate-trail.d/trail-pr.sh:779` | gh | `out="$("$GH" pr create --base "$base_branch" --head "$branch" --title "$title" --body "$bo` | 6 | `trail_pr` in memory mode off, after the 744 push: opens the trail PR | read (static) | needs a kernel-owned path |
| `automate-trail.d/trail-pr.sh:783` | gh | `view="$("$GH" pr view "$branch" --json url,state 2>/dev/null)"` | 6 | `trail_pr`'s PR reads | read (static) | harmless |
| `automate-trail.d/trail-pr.sh:790` | gh | `echo "$skip_prefix gh pr create failed (branch $branch pushed; the next trail-pr opens its` | 6 | no call: a check, message text or a trailing comment | read (static) | harmless |
| `automate-trail.sh:184` | gh | `GH="${LOOMWRIGHT_GH_BIN:-gh}"` | 6 | no call: an assignment | read (static) | harmless |
| `automate-wave.sh:146` | gh | `if ! j="$(cd "$primary" && "$LANES_GH" pr list --head "$wb" --state all --json number,url,` | 6 | `wave-build` only: refused to the session, and the `--parallel` coordinator loop a safe-mode run never starts | read (static) | already gated elsewhere |
| `automate-wave.sh:148` | gh | `_wb_refuse @gh_read_failed "cannot read the PRs from $wb (gh pr list failed) — fail closed` | 6 | `wave-build` only: refused to the session, and the `--parallel` coordinator loop a safe-mode run never starts | read (static) | already gated elsewhere |
| `automate-wave.sh:261` | push to origin | `if ! out="$(git -C "$wt" push -q -u origin "$wb" 2>&1 </dev/null)"; then` | 6 | `wave-build` only: refused to the session, and the `--parallel` coordinator loop a safe-mode run never starts | read (static) | already gated elsewhere |
| `automate-wave.sh:264` | push to origin | `_wb "push — origin/$wb at $(git -C "$wt" rev-parse --short=12 HEAD)"` | 6 | `wave-build` only: refused to the session, and the `--parallel` coordinator loop a safe-mode run never starts | read (static) | already gated elsewhere |
| `automate-wave.sh:290` | gh | `if ! out="$(cd "$wt" && "$LANES_GH" pr create --base "$base" --head "$wb" --title "$title"` | 6 | `wave-build` only: refused to the session, and the `--parallel` coordinator loop a safe-mode run never starts | read (static) | already gated elsewhere |
| `automate-wave.sh:291` | gh | `_wb_stop @pr_create_failed "gh pr create failed: $(printf '%s\n' "$out" \| sed '/^$/d' \| ta` | 6 | `wave-build` only: refused to the session, and the `--parallel` coordinator loop a safe-mode run never starts | read (static) | already gated elsewhere |
| `automate-wave.sh:294` | gh | `[ -n "$url" ] \|\| url="$(cd "$wt" && "$LANES_GH" pr list --head "$wb" --state open --json u` | 6 | `wave-build` only: refused to the session, and the `--parallel` coordinator loop a safe-mode run never starts | read (static) | already gated elsewhere |
| `automate-wave.sh:295` | gh | `[ -n "$url" ] \|\| url="(url unreadable — see gh pr list --head $wb)"` | 6 | `wave-build` only: refused to the session, and the `--parallel` coordinator loop a safe-mode run never starts | read (static) | already gated elsewhere |
| `ci-run-probe.sh:116` | gh | `GH_BIN="${GH:-gh}"` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `ci-run-probe.sh:184` | gh | `if ! command -v "$GH_BIN" >/dev/null 2>&1; then` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `ci-run-probe.sh:195` | gh | `raw="$("$GH_BIN" api "repos/$REPO/actions/runs/$run_id/jobs" 2>/dev/null)" \|\| rc=$?` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `ci-slot.sh:246` | background & | `LOOMWRIGHT_CI_CPUS="$CPUS" bash "$LOAD_CMD" > "$RF" 2>/dev/null &` | 6 | a local load probe and `sleep` in the background | read (static) | harmless |
| `ci-slot.sh:590` | background & | `sleep "$POLL" >/dev/null 2>&1 &` | 6 | a local load probe and `sleep` in the background | read (static) | harmless |
| `classify-bot-review.sh:281` | claude | `def bot_author_re: "^(claude\\[bot\\]\|github-actions\\[bot\\]\|dependabot\\[bot\\])$\|\\[bot` | 3 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `dispatch-pr-postmortem.sh:103` | claude | `CLAUDE_BIN="${LOOMWRIGHT_CLAUDE_BIN:-claude}"` | 1 | no call: the binary name, the dry-run print, the PATH check | read (static) | harmless |
| `dispatch-pr-postmortem.sh:268` | claude | `printf 'DRY_RUN_DISPATCH: %s -p "/loomwright:pr-postmortem %s"\n' "$CLAUDE_BIN" "$PR_URL"` | 1 | no call: the binary name, the dry-run print, the PATH check | read (static) | harmless |
| `dispatch-pr-postmortem.sh:274` | claude | `if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then` | 1 | no call: the binary name, the dry-run print, the PATH check | read (static) | harmless |
| `dispatch-pr-postmortem.sh:275` | claude | `log "'$CLAUDE_BIN' not on PATH — cannot launch /pr-postmortem, skipping"` | 1 | no call: the binary name, the dry-run print, the PATH check | read (static) | harmless |
| `dispatch-pr-postmortem.sh:321` | claude, nohup, background & | `( nohup "$CLAUDE_BIN" -p "/loomwright:pr-postmortem $PR_URL" >>"$RUN_LOG" 2>&1 </dev/null ` | 1 | fix_cycles > threshold (default 2), a repeat check failure or unresolved bot feedback; once per PR; not with --no-auto-postmortem | observed (probe) | needs a kernel-owned path |
| `drain-gh-read.sh:43` | gh | `GH="${GH:-gh}"` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `drain-gh-read.sh:98` | gh | `out="$("$GH" api --method GET "repos/$owner/$repo/branches/$base/protection/required_statu` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `drain-gh-read.sh:104` | gh | `rulesets_required_read "$GH" "$JQ" "$owner" "$repo" "$base"` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `drain-gh-read.sh:137` | gh | `exec "$GH" api --method GET "repos/$owner/$repo/issues/$id/comments?per_page=100" ${jq_arg` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `drain-gh-read.sh:139` | gh | `exec "$GH" api --method GET "repos/$owner/$repo/check-runs/$id/annotations" ${jq_args[@]+"` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `drain-gh-read.sh:142` | gh | `exec "$GH" api --method GET "repos/$owner/$repo/check-runs/$id" ${jq_args[@]+"${jq_args[@]` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `drain-gh-read.sh:148` | gh | `exec "$GH" api graphql -f query='` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `guard-finalize-publish.sh:679` | nohup | `'{'\|'!'\|if\|then\|else\|elif\|do\|while\|until\|nohup\|builtin) i=$((i + 1)); continue ;;` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `guard-finalize-publish.sh:819` | background & | `s="${s//"&&"/$NL}"            # before the redirect swap: 'x&&>f' is 'x && >f', never 'x &` | 2 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `lane-policy.sh:180` | gh | `'Supervisor FINALIZE PR-base verification after gh failed twice'` | 6 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `lane-policy.sh:188` | gh | `'/autonomous PR-base verification after gh failed twice'` | 6 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `meta-sync.d/commands.sh:23` | push to origin | `g push -q origin "$c:refs/heads/$BRANCH" \|\| die "init push failed — '$BRANCH' was not crea` | 7 | `meta-sync.sh init`: the session may call it directly (only `push` is refused) | observed (probe) | needs a kernel-owned path |
| `meta-sync.d/commands.sh:186` | push to origin | `if g push -q --force-with-lease="refs/heads/$BRANCH:$R" origin "$commit:refs/heads/$BRANCH` | 7 | `meta-sync.sh push`: refused to the session, but run by `trail_pr` in memory mode on (`trail-pr.sh:466`, `:505`) from the same driver steps as 744 | observed (probe) | needs a kernel-owned path |
| `meta-sync.d/lock.sh:8` | background & | `FILE_MODE="$(printf '%o' $(( 0666 & ~0$(umask) )))"` | 7 | no call: arithmetic `&` | read (static) | harmless |
| `notify-click-target.sh:71` | claude | `printf 'claude://claude.ai/resume?session=%s' "$SESSION_ID"` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `notify-desktop.sh:496` | background & | `( "$@" >>"$NOTIFY_LOG" 2>&1 </dev/null & ) >/dev/null 2>&1` | 7 | a local desktop banner, detached (off with LOOMWRIGHT_DESKTOP_NOTIFICATIONS=0) | read (static) | harmless |
| `pr-postmortem-gather.sh:148` | gh | `GH_BIN="${GH_BIN:-gh}"` | 1 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `pr-postmortem-gather.sh:168` | gh | `command -v "$GH_BIN" >/dev/null 2>&1 \|\| emit_unavailable "gh_unavailable"` | 1 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `pr-postmortem-gather.sh:211` | gh | `PR_JSON="$("$GH_BIN" pr view "$NUMBER" --repo "$REPO" \` | 1 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `pr-postmortem-gather.sh:227` | gh | `COMMENTS_JSON="$("$GH_BIN" api "repos/$REPO/issues/$NUMBER/comments?per_page=100" 2>/dev/n` | 1 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `pr-postmortem-gather.sh:271` | gh | `OPERATOR_LOGIN="$("$GH_BIN" api user --jq '.login' 2>/dev/null)" \|\| OPERATOR_LOGIN=""` | 1 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `pr-postmortem-gather.sh:319` | claude | `def agent_body_re: "generated by supervisor\|generated with claude code\|co-authored-by: *cl` | 1 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `proc-registry.sh:366` | nohup | `_pr_pre_exec() { case "${1%% *}" in nohup\|*/nohup\|env\|*/env) return 0 ;; esac; return 1; }` | 6 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `resolve-base-branch.sh:86` | gh | `printf '%s: no flag, brief, .supervisor/config.json .base_branch, origin/HEAD or gh defaul` | 10 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `resolve-base-branch.sh:176` | gh | `b="$(cd "$REPO" 2>/dev/null && GH_PROMPT_DISABLED=1 gh repo view --json defaultBranchRef -` | 10 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `resolve-egress-config.sh:272` | claude | `\| map(select(test("\\A[A-Za-z0-9_-]+\\z") and . != "claude")) \| unique \| join(",")' \` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `review-heal-next-step.sh:163` | claude | `F_MAXR=5; F_PROBES=5; F_FIXFLOOR=""; F_SEV=HIGH; F_REQ=""; F_CWT=1200; F_PAT='*review*,cla` | 1 | no call: message, flag or pattern text | read (static) | harmless |
| `review-heal-next-step.sh:287` | gh | `rh_gh() { rh_read_retry "${LOOMWRIGHT_GH_BIN:-gh}" "$@" </dev/null; }` | 1 | PR reads (`rh_gh`, `rh_ghread`): every drain round | read (static) | harmless |
| `review-heal-next-step.sh:288` | gh | `rh_ghread() { ( GH="${LOOMWRIGHT_GH_BIN:-gh}"; export GH; rh_read_retry bash "$HERE/drain-` | 1 | PR reads (`rh_gh`, `rh_ghread`): every drain round | read (static) | harmless |
| `review-heal-next-step.sh:290` | gh | `"${LOOMWRIGHT_GH_BIN:-gh}" pr comment "$PR" --body "$1" </dev/null >/dev/null 2>&1 \` | 1 | `rh_comment`: the terminal ESCALATED comment (812, 821) and the dismissed-findings marker comment (998); review_pr and backlog drains | observed (probe) | needs a kernel-owned path |
| `review-heal-next-step.sh:291` | gh | `\|\| rh_err "gh pr comment failed (reported; the drain goes on)"` | 1 | no call: message, flag or pattern text | read (static) | harmless |
| `review-heal-next-step.sh:318` | send-webhook.sh | `bash "$HERE/send-webhook.sh" --event-type gate --gate-type "$gt" --context "$2" </dev/null` | 1 | `rh_notify_call` at READY / ESCALATED, `RH_WEBHOOK_CMD` unset; curl only when a webhook URL resolves for the repo | observed (probe) | needs a kernel-owned path |
| `review-heal-next-step.sh:323` | dispatch-*.sh | `rh_postmortem_call() { if [ -n "${RH_POSTMORTEM_CMD:-}" ]; then $RH_POSTMORTEM_CMD "$@" </` | 1 | `rh_postmortem_call` once per finished drain run (1098); the dispatcher's churn gate decides | observed (probe) | needs a kernel-owned path |
| `review-heal-next-step.sh:378` | gh | `\|\| { rh_escalate_to pr_unreadable other 0 "pr_unreadable — gh pr view could not read the P` | 1 | no call: message, flag or pattern text | read (static) | harmless |
| `review-heal-next-step.sh:390` | gh | `rh_sha_ok "$h" \|\| { rh_escalate_to pr_unreadable other 0 "pr_unreadable — gh pr view could` | 1 | no call: message, flag or pattern text | read (static) | harmless |
| `review-heal-next-step.sh:854` | gh | `(.[] \| "- " + .check + ": classified untrusted_infra (" + .reason + ") — re-run when infra` | 1 | no call: message, flag or pattern text | read (static) | harmless |
| `review-heal-next-step.sh:870` | push to origin | `push: ["bash " + $refold, "git push origin HEAD:" + $ref],` | 1 | instruction text: the fix worker's `git push origin HEAD:<ref>` runs in the session, through the rail and the approval gate | read (static) | already gated elsewhere |
| `send-webhook.sh:230` | curl | `if ! command -v curl >/dev/null 2>&1; then` | 6 | no call: the curl PATH check and its message | read (static) | harmless |
| `send-webhook.sh:231` | curl | `printf 'send-webhook: curl not on PATH — skipping\n' >&2` | 6 | no call: the curl PATH check and its message | read (static) | harmless |
| `send-webhook.sh:291` | curl | `printf '%s' "$PAYLOAD" \| curl -fs --max-time 5 \` | 6 | any caller's event, only when a webhook URL resolves (user-scope egress.json or LOOMWRIGHT_WEBHOOK_URL); the probe saw the gate event's curl | read (static) | needs a kernel-owned path |
| `send-webhook.sh:405` | curl | `printf '%s' "$QUESTION" \| curl -fs --max-time 5 \` | 6 | any caller's event, only when a webhook URL resolves (user-scope egress.json or LOOMWRIGHT_WEBHOOK_URL); the probe saw the gate event's curl | read (static) | needs a kernel-owned path |
| `send-webhook.sh:427` | curl | `curl -fs --max-time 5 -X POST -H "Content-Type: application/json" \` | 6 | any caller's event, only when a webhook URL resolves (user-scope egress.json or LOOMWRIGHT_WEBHOOK_URL); the probe saw the gate event's curl | read (static) | needs a kernel-owned path |
| `send-webhook.sh:663` | curl | `curl -fs --max-time 5 \` | 6 | any caller's event, only when a webhook URL resolves (user-scope egress.json or LOOMWRIGHT_WEBHOOK_URL); the probe saw the gate event's curl | read (static) | needs a kernel-owned path |
| `setup-memory.d/allowlist.sh:179` | gh, background & | `gh api "repos/$slug" --jq .id </dev/null 2>/dev/null &` | 9 | a bounded background `gh api repos/<slug>` read: meta-sync's allowlist check | read (static) | harmless |
| `setup-memory.d/allowlist.sh:201` | background & | `) </dev/null >/dev/null 2>&1 &` | 9 | a bounded background `gh api repos/<slug>` read: meta-sync's allowlist check | read (static) | harmless |
| `setup-memory.d/allowlist.sh:255` | gh | `echo "allowlist: granted $e — current remote (no gh call)" >&2` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/allowlist.sh:270` | gh | `origin_state="origin is not on github.com, so the request cannot be checked (gh would comp` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/allowlist.sh:272` | gh | `origin_state="gh is not installed, so the request cannot be checked (request-file entries ` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/allowlist.sh:277` | gh | `origin_state="gh timed out after ${lim}s resolving origin $own, so the request cannot be c` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/allowlist.sh:280` | gh | `''\|*[!0-9]*) origin_id=""; origin_state="gh could not resolve origin $own (unauthenticated` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/allowlist.sh:299` | gh | `origin_state="gh timed out after ${lim}s, so the request cannot be checked"` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/allowlist.sh:305` | gh | `echo "allowlist: ignored $e — gh could not resolve it, so it cannot be shown to be this re` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/report.sh:31` | gh | `'gh api repos/<slug> --jq .id' equals origin's id (a renamed` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/report.sh:32` | gh | `repo's old slug), and only for a github.com origin. gh is` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/report.sh:98` | gh | `'gh api repos/<slug> --jq .id' equals origin's id, and only for a github.com origin. gh is` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `setup-memory.d/report.sh:124` | push to origin | `origin — a repo file can never grant it. Without a 'granted' record every push skips them ` | 9 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `supervisor-next-step.sh:682` | gh | `sn_gh() { "${LOOMWRIGHT_GH_BIN:-gh}" "$@" </dev/null 2>/dev/null; }` | 1 | `sn_gh`: FINALIZE's PR base verification read | read (static) | harmless |
| `supervisor-next-step.sh:1133` | gh, push to origin | `commands: ["git push -u origin \($br)", "gh pr create --base \($base) --title \($t \| @sh) ` | 1 | FINALIZE's instruction text: the session runs the push and `gh pr create` through the rail and the approval gate | read (static) | already gated elsewhere |
| `supervisor-next-step.sh:1137` | gh | `then: "--result \u007b\u0022pr_url\u0022: \u0022<the URL gh pr create printed>\u0022\u007d` | 1 | FINALIZE's instruction text: the session runs the push and `gh pr create` through the rail and the approval gate | read (static) | already gated elsewhere |
| `supervisor-next-step.sh:1152` | gh | `[[ "$u" =~ ^https?://[^[:space:]]+/pull/[0-9]+$ ]] \|\| { sn_refuse "--result: pr_url must b` | 1 | no call: message text | read (static) | harmless |
| `supervisor-next-step.sh:1159` | gh | `"gh pr view failed twice reading the base of $u (expected $(st base_branch)). Retry once m` | 1 | no call: message text | read (static) | harmless |
| `supervisor-next-step.sh:1192` | gh | `sn_ck pr-verify-answer handover "$(sn_ops "$(sn_op_decision FINALIZE user_skipped_base_ver` | 1 | no call: message text | read (static) | harmless |
| `wait-for-checks.sh:159` | gh | `GH_BIN="${GH:-gh}"` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `wait-for-checks.sh:233` | claude | `REVIEW_PATTERN='*review*,claude*'` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `wait-for-checks.sh:247` | gh | `log "jq not found — cannot parse gh output"` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `wait-for-checks.sh:375` | gh | `_base="$("$GH_BIN" pr view "$PR_URL" --json baseRefName 2>/dev/null \|\| true)"` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `wait-for-checks.sh:389` | gh | `_prot="$("$GH_BIN" api "repos/$OWNER/$REPO/branches/$BASE_REF/protection" 2>&1)"` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `wait-for-checks.sh:403` | gh | `rulesets_required_read "$GH_BIN" "$JQ_BIN" "$OWNER" "$REPO" "$BASE_REF"` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `wait-for-checks.sh:416` | gh | `rulesets_required_read "$GH_BIN" "$JQ_BIN" "$OWNER" "$REPO" "$BASE_REF"` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |
| `wait-for-checks.sh:531` | gh | `_view="$("$GH_BIN" pr view "$PR_URL" --json headRefOid,statusCheckRollup 2>/dev/null \|\| tr` | 7 | a gh read, or no call (message, pattern or parser text) | read (static) | harmless |

Counts: 16 `needs a kernel-owned path` (all named in the owner decisions above), 47 `already gated elsewhere`, 137 `harmless`.
