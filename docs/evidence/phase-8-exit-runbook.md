# Phase 8 exit: the owner's live run on studio-sandbox

Phase 8 is done when this holds in the running system ([`docs/ROADMAP.md`](../ROADMAP.md), phase 8 row): **a PR is tracked through its states; comments are triaged (fix / reply / answer); reviewers are re-requested; and a PR merges once the repo's approval policy is met, only through the gated path.** This is acceptance test 2. The walk: one GitHub issue and one personal ClickUp task go into one `/automate` run, which opens PR A for the first ticket and holds the second; PR A merges through the gate under **Solo**; three comments on PR A are triaged and the owner is re-requested as reviewer; the owner's Resume starts the second ticket, and PR B merges through the gate under **Approve in Studio** after the owner approves its merge card; a direct `gh pr merge` from a session is denied `merge_blocked`; and Tasks shows each ticket's PR, approvals and CI throughout.

**The walk's order is the order Loomwright 18.1.2 actually runs** (item 25f). `kernel/test/phase-8-walk-order-probe.test.ts` drove the real 18.1.2 driver (`automate-next-step.sh`, a scratch repo, a stub `gh`) and recorded three facts. In safe mode one run opens one PR at a time: with PR A open, neither the run's next pick nor a Resume starts the second ticket ("no new item is picked while it is open (single-open-PR invariant)"). After PR A's merge the run stops with "the next item waits for /automate --resume", and only the Resume starts PR B. `--merge-parked` parks instead of merging when the PR got any comment after its READY (`ready_stale_feedback`) or a push (`head_sha_moved`), so no comment may land on a PR before its gate merge. The probe also checks that this runbook says the same. The deterministic CI walks (`kernel/test/phase-8-exit.test.ts`, `app/e2e/phase-8-exit.spec.ts`) keep the earlier order (two PRs at once, triage on parked PR A before its merge): they run on stand-in sessions and do not exercise Loomwright's single-open-PR rule or its merge guard.

The deterministic half is in CI, on fakes: `kernel/test/phase-8-exit.test.ts` walks the steps on a real in-process kernel with a fake GitHub, a fake ClickUp MCP server, stand-in `/automate`, `/review-pr` and `--merge-parked` sessions that the kernel itself starts (each asserted by its prompt, agent, playbook and model) and that write recorded run files, and one injected clock; `app/e2e/phase-8-exit.spec.ts` does the same with the built app on screen. They prove the loop and the store's effects. They do not prove it against real GitHub, real ClickUp, real Loomwright sessions or the real branch protection. This runbook is the live half, and `kernel/test/phase-8-exit-live.test.ts` is the read-only harness that checks the store while the walk happens. Phase 5, 6 and 7's live runs are the precedent ([phase 5](phase-5-exit-runbook.md), [phase 6](phase-6-exit-runbook.md), [phase 7](phase-7-exit-runbook.md)).

The owner decides when this runs. It uses the owner's subscription, launchd service, screen, GitHub account and personal ClickUp. The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md), [D35](../DECISIONS.md)); see [Who clicks](#who-clicks).

## What this run does to the machine

Read this before starting.

- **It writes to the sandbox repo on GitHub, and only there.** The setup seeds it, the owner flips it public and sets protection on `main`; the walk then opens an issue, makes two PRs, comments and reviewer requests on one, and merges both. All of it is on `vikashruhilgit/studio-sandbox`, which holds only throwaway content. Studio's own GitHub writes go through the App's one-hour, down-scoped session token and the approval gate; the harness writes nothing.
- **It writes into your real store, through the app.** Everything lands in `~/.loomwright-studio/studio.db` (or `$STUDIO_DATA_DIR`): the connector rows, a repo policy, a crew member (its `agents` row, `config/agents/<id>.json` and `memory/<id>/`), the playbooks Wright drafts, their runs and sessions, `pr_tracks` rows, tasks, approvals and events.
- **It touches your personal ClickUp**, read-only: the connect opens the system browser for ClickUp's consent, the token goes to the Keychain, and the crew member is granted ClickUp's read tools only.
- **Sessions spend tokens on your subscription**, and the weekly cap is shared with your own sessions ([D17](../DECISIONS.md)). Several Loomwright sessions run (the `/automate` run over both tickets, its Resume, the triage fix and one merge per PR, each started by the kernel, plus the merge-when-ready and triage playbooks' own sessions, plus Wright's sessions drafting the playbooks). Expect a large share of a day's use; do not start it when you need the cap for other work.
- **Real notifications appear**: one for each held approval.
- **The harness only reads the store.** It opens it read-only, never calls the `studio` CLI, never posts to the API, holds no GitHub token, makes no network request and never decides an approval. The merge happens only through Loomwright's `--auto-merge` gate, which the merge-when-ready playbook's session triggers; no kernel code merges ([D40](../DECISIONS.md), invariant 4).
- **Never an employer repository or system.** The harness refuses a repo whose owner is not the personal account you name and any owner beginning `vendsy`. Jira is the owner's work account and is never connected, read or exercised: it is recorded `not_exercised`.

## Setup

Before the run. Every GitHub setting is on `vikashruhilgit/studio-sandbox` only. The agent does the terminal steps on the owner's word; the owner makes the clicks named as the owner's, and each of those is named in chat before the run starts (D35).

1. **Seed studio-sandbox with a tiny project and one `ci` workflow.** The repo is private and empty today, on GitHub Free. In a fresh clone, add and push to `main`:

   ```bash
   mkdir -p .github/workflows
   printf 'process.exit(0);\n' > ping.js
   printf '{ "name": "studio-sandbox", "version": "0.0.0", "private": true, "scripts": { "test": "node ping.js" } }\n' > package.json
   cat > .github/workflows/ci.yml <<'EOF'
   name: ci
   on: [push, pull_request]
   jobs:
     ci:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: npm test
   EOF
   git add -A && git commit -m "chore: seed the sandbox" && git push origin main
   ```

   The workflow's name and its one job are both `ci`, so the check GitHub reports is `ci`. Run `ci` once on `main` (the push does) so GitHub knows the check name before step 3.
2. **The owner flips it public, after checking its content.** Everything in the repo becomes visible; confirm it holds only the seed above. The owner clicks: `gh repo edit vikashruhilgit/studio-sandbox --visibility public --accept-visibility-change-consequences`, or Settings, Danger Zone, Change visibility. GitHub Free refuses branch protection on a private repo (403, checked 2026-11-02), which is why this step comes first.
3. **Protection on `main` requires `ci`** (and no required reviews, so the repo's detected policy is Solo-capable):

   ```bash
   gh api -X PUT repos/vikashruhilgit/studio-sandbox/branches/main/protection --input - <<'EOF'
   { "required_status_checks": { "strict": false, "contexts": ["ci"] }, "enforce_admins": false, "required_pull_request_reviews": null, "restrictions": null }
   EOF
   ```

4. **The owner accepts the App's new permissions on github.com.** Phase 8 raised the GitHub App to every repository permission at write ([D39](../DECISIONS.md)). In Integrations, the App's permission upgrade names the two github.com steps; the owner clicks through them and the acceptance. The first installation token's `permissions_json` should then report the new set (the entry for p16 in [`docs/OPEN_QUESTIONS.md`](../OPEN_QUESTIONS.md) is answered here; record it).
5. **The owner connects personal ClickUp.** Integrations, Connect ClickUp: the system browser opens ClickUp's consent, the owner approves it, and the connector shows connected with its tools listed. Never Jira.
6. **Create one crew member from a charter the owner approves**, with the GitHub `write` grant and the ClickUp read tools only. Ask Wright in Chat for a developer for the sandbox repo; Wright drafts the charter and the owner approves it (Allow once on the charter, then Create). The owner names the agent's name, model and grants before the run (D35).
   Since phase 8 item 16 the owner never names a kernel tool: the charter card lists the granted kernel tools by job in plain words, ahead of the raw names (`Kernel tool names, as enforced`). Check the card shows the walk's four jobs: Hand tickets to /automate, Triage PR comments, Ask for a merge, Read a PR. When Wright drafts each playbook below for the member, the result's `fit` says whether the charter covers the playbook's jobs; a gap comes back as a plain line (`This playbook needs Ask for a merge; Mason doesn't have it.`) and a held `kernel_agent_update` adding exactly the missing tools, which the owner approves before the enable. An enable with the gap open is refused `charter_gap` unless the owner says to enable it anyway. The live run of setup step 6 that produced a developer with only the four read-only `kernel_github_pr_*` tools is the case this catches ([evidence](wright-drafts-charters.md)).
7. **The repo's detected policy card proposes Solo and the owner accepts it.** The first time the repo is used, Integrations shows the policy card from the repo's real protection (`ci` required, no required reviews). The owner presses the Solo proposal. Studio never changes GitHub's protection itself.
8. **Build the kernel, install the service and package the app**, as [phase 5's setup steps 2 to 5](phase-5-exit-runbook.md#setup) and [phase 7's setup](phase-7-exit-runbook.md#setup) do, from the branch under test (the service runs an install copy, so reinstall after every build). Open the app from Finder, not from a terminal. Record `git rev-parse HEAD`, the service's pid, `sw_vers -productVersion` and `node --version` for the evidence file.
   Run `studio service install` from the shell you use for `npm test`. Its success line must name `npm` and `node` found, as it names `gh` and `git` (`its runs use gh <path>, git <path>, npm <path>, node <path>`); a `warning: npm is not on this shell's PATH` or `warning: node …` line means a run can't run the sandbox's `npm test` (item 27a), so fix that shell's `PATH` and install again before step 1. Then read the plist's `PATH` and check it holds the dir of that `npm` and `node`: `plutil -extract EnvironmentVariables.PATH raw ~/Library/LaunchAgents/com.loomwright.studio.kernel.plist`. Record both lines for the evidence file.
9. **Stage the screenshot folder outside the repo:** `OUT="${TMPDIR:-/tmp}/studio-phase8-exit-$(date +%F)"; mkdir -p "$OUT"; echo "$OUT"`.

## Known preconditions

Three preconditions. The CI walks prove the first two, and the live run meets them as written: the first is now met by the kernel, the second is the ClickUp ticket playbook's own field. The third is the sandbox checkout's earlier runs. Check the second and the third before spending the subscription.

- **Met (phase 8 item 15, 2026-11-09): the kernel wires the session-token minter.** The installed service's `daemonKernelDeps` gives `startKernel` a `SessionTokenMint` over item 03's `mintSessionToken`, so a live, write-granted session gets its token. A composition without the daemon's deps (a test's) is still refused `github_token_unavailable` with `no_minter`, which is why the CI walks supply a stand-in mint. It needs the connected GitHub App (an App row in use, reaching the sandbox repo) to mint; without it the session is refused `mint_failed: no_credentials`.
- **A ClickUp ticket playbook carries a `target_repo`.** A live write-granted session's token is minted for the repos of the playbook's linked GitHub poll plus its `target_repo`, and a `clickup.tasks` poll names no repository, so a ClickUp playbook with no `target_repo` is refused at enable (`no_target_repo`) and a session of one would be refused `no_repos`. Ask Wright to draft the ClickUp ticket playbook with `target_repo: vikashruhilgit/studio-sandbox` and a single `clickup.tasks` poll; the enable is also refused `target_repo_not_reachable` when the GitHub App does not reach that repo. The walk has four playbooks in all (GitHub tickets, ClickUp tickets, triage, merge when ready), the same layout `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` use.
- **A checkout that ran before has its old paused run retired from the Parked run card, never moved by hand (phase 8 item 27b).** Before step 1, open Tasks. For each Parked run card left from an earlier walk in the sandbox checkout, press **Retire** and confirm it. The card goes, and no later handover carries that run's unfinished items (`dropped` names them `run_retired` once the file is gone). The kernel leaves Loomwright's run file where it is, so don't move or delete files under `.supervisor/automate/` yourself (the 2026-11-24 walk moved the 11-20 run file into an archive folder by hand, which no supported path covers). Loomwright still reads a retired run as unfinished: if a run start asks its own AUT-RESUME question, answer it in Approvals (`Archive` or `Start new`).

## Starting the harness

In a second terminal, from the repo root, before the first step of the walk:

```bash
export STUDIO_LIVE_GITHUB_ACCOUNT=vikashruhilgit
export STUDIO_LIVE_SANDBOX_REPO=vikashruhilgit/studio-sandbox
cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-8-exit-live.test.ts
```

It refuses a repo whose owner is not the named personal account, records a run start (the store's highest event id) and prints the path of its summary (under `tmpdir()`, mode `0600`) within a few seconds of starting. It then re-reads the store every few seconds and prints a line whenever a check changes, and rewrites the summary file on every change. `STUDIO_LIVE_WAIT_MIN` (1 to 240, default 120) bounds the wait. It ends when the three checks are all `pass` or one `fail`s, or at the wait's end. It never decides an approval: when a card is waiting, decide it in the app.

**It prints as it runs.** vitest holds `console.log` until the test ends, which is why the 2026-11-12 run showed nothing for about 75 minutes. The harness writes each line straight to the terminal's file descriptor instead (`report` in `kernel/test/phase-8-exit-live.test.ts`), so the command above needs no extra flag. If you stop it early with Ctrl-C, the summary file keeps the checks seen so far and its `result` is `interrupted` (the "(interrupted)" line may not reach the terminal, because vitest is already shutting down, so read the path from the first line it printed). A kernel test starts this exact command on a scratch store and pins both ([evidence](phase-8-20b-harness-reports.md)).

## The walk

Do each step in the app, in order: the order is what Loomwright 18.1.2 runs (see the second paragraph above), and a step done early is refused or parks. After each, the harness (or the store) shows its effect. The values below are examples; use the real issue and task numbers.

**The tickets ask for changes the repo's declared check runs.** The sandbox's check is `npm test` (setup step 1, item 25d), so each ticket's change must be one `npm test` exercises. The GitHub issue's text is "add `drum.sh` printing `boom` and make `npm test` run it". The ClickUp task's text is "add `bell.sh` printing `ding` and make `npm test` run it".

| Step | What happens | What the store shows |
|---|---|---|
| 1. Tickets | Open the GitHub issue on the sandbox repo (`gh issue create`), and the ClickUp task tagged as the owner says, with the texts above. Ask Wright to author two live ticket playbooks, one per source, and enable both (a dry run first, then a held enable: Allow once). The GitHub one polls `github.issues` on the sandbox repo. The ClickUp one has a single `clickup.tasks` poll and `target_repo: vikashruhilgit/studio-sandbox`, which the enable requires and the session's GitHub token is minted for; see [Known preconditions](#known-preconditions). Both handovers go into one `/automate --backlog … --inline-phases` run in safe mode (item 23i; session 249's backlog held both tickets). The run opens **PR A** for the first ticket and parks it `awaiting_merge`. The second ticket waits in the run's queue: no PR B opens while PR A is open (Loomwright's single-open-PR invariant, probe R1). Leave PR A alone: no comment on it until step 2 has merged it. | Two `tasks` rows of kind `ticket_pr`. PR A's `pr_tracks` row, from a new track, linked to its ticket by `ticket_ref`. No PR B yet. The handover's `_BACKLOG.md` lists only the walk's two tickets (item 27b): `kernel_automate_prepare`'s answer (the session's tool result) names any earlier closed or off-filter ticket in `dropped` (`ticket_closed`, `filter_no_longer_matches`) and any earlier one it could not check in `unverified`. An earlier ticket in the backlog, or a run that picks one first, is a finding |
| 2. PR A under Solo | Create the opt-in "merge when ready" playbook and enable it. With CI green and Loomwright's review passed, the merge check answers `go`, and the kernel starts `/loomwright:automate --merge-parked <run_id>` as its own session of the merge playbook ([D45](../DECISIONS.md)), in which Loomwright merges that one item through its `--auto-merge` gate. The playbook's own session runs nothing itself. The run then stops `awaiting_go` ("the next item waits for /automate --resume"): PR B does not start by itself. A comment on PR A before this merge would make `--merge-parked` park `ready_stale_feedback`, and a pushed fix would park it `head_sha_moved` (probe R2), which is why triage comes after. | A kernel-started session of the merge playbook (the `automate-run` work step names it). `pr_tracks`: PR A `merged` with `merged_by_gate` = 1; the ordered `pr_state_changed` events |
| 3. Triage | On PR A, now merged, the owner leaves three comments: `fix: rename ping to pong`, `question: why exit 0?` and `remark: nice`. Ask Wright to author the triage playbook and enable it. | The fix routes `review_pr` (PR A's item is done and the App authored it, so no run parks it): the route queues it, and the kernel starts `/loomwright:review-pr <pr url>` as its own session of the triage playbook, as the crew member, on the playbook's model ([D45](../DECISIONS.md); never a second drain, and the triage session runs nothing itself). The triage session names the `fix:` comment on its route call (`comment`, by kind and id), the route's answer says `comment: carried`, and the kernel reads the comment again at launch and puts it in the fix's prompt after the command, with its fixed instruction line and the comment wrapped as data ([D49](../DECISIONS.md), item 26a; the `automate-run` step's result records `comment` with outcome `carried`). Expect the rename `ping.js` → `pong.js` committed on PR A's fix branch. The session's push is held for approval, so the commit shows on GitHub only after the owner approves that held push. Don't expect Loomwright's fix step to make it: in 26a's probe a subagent the session's main thread spawned made the change, not Loomwright's fix worker ([26a evidence](phase-8-26a-comment-probe.md)). That probe ran on an open PR, so this step is the first live run on a merged PR's branch. No `comment` in the route's answer, any other outcome, or no rename commit is a finding. An answer is posted for the question and a reply for the remark, through the kernel's GitHub write tools, each after the approval gate |
| 4. Re-request | The same playbook re-requests the owner as reviewer on PR A. | The GitHub request on the PR; the call recorded in the session's events. Whether GitHub accepts a reviewer request on a merged PR was not probed: a refusal is a finding |
| 5. PR B under Approve in Studio | On Tasks, the owner presses **Resume** on the paused run's card. The kernel starts `/loomwright:automate --resume <run_id> --inline-phases` (item 23j), and the run picks the second ticket and opens **PR B**, which parks `awaiting_merge`. The owner switches the repo's policy to **Approve in Studio** (Integrations, the policy card). The merge card appears in Approvals for PR B's head commit. The owner approves it (Allow once); at the playbook's next fire the check answers `go`, and the kernel starts the `--merge-parked` session in which the gate merges it. No comment on PR B before its merge. | A kernel-started `resume` session (the `automate-run` work step names it); PR B's `pr_tracks` row from a new track; a merge approval row for PR B's head, decided by the owner; PR B `merged` with `merged_by_gate` = 1 |
| 6. The merge block | In a session whose policy admits the `gh pr` Bash prefix, ask the agent to run `gh pr merge <number>` directly. The policy runs before the rail ("The rail applies only after the policy allowed", `kernel/src/sessions/manager.ts`). A session without `gh pr` (the crew member as drafted in setup step 6, or Wright) is denied `bash_prefix_not_allowed`, which is not this step's deny: `no_kernel_merge` counts it as `fail`. The kernel's run sessions hold `gh pr` but take no words from the owner (a run's continuation carries only the kernel's decision text), so the session is the crew member's, after the owner approves a held `kernel_agent_update` that adds `gh pr` to its charter's `allowedBashPrefixes` (named before the run, and removed after it). | A `tool_decision` event: `Bash`, `gh pr merge …`, `deny`, reason `merge_blocked` |
| 7. Tasks throughout | Keep the Tasks screen open. After each step above it shows the ticket, its PR and state, approvals against the policy (`solo`, then `studio_approval`) and CI. | What the screen shows is the owner's to report; the rows it reads are `tasks` and `pr_tracks` |

**Jira is `not_exercised`:** nothing here connects or reads it.

**A gate may be raised mid-run.** Probe p15 did not exercise `AskUserQuestion` inside a kernel-started `/automate` session. If the session raises a question, the owner answers it in Approvals; a failure there becomes a new phase 8 item (see [Findings](#findings)).

### What the harness checks

Each from the store, never from what a reply says:

1. **`pr_states`:** each tracked PR's `pr_state_changed` events appear in order (the first from a new track, each starting from the previous change's end, nothing after `merged`, no `closed`), `pr_tracks` holds the last state, and both PRs end `merged`.
2. **`merged_by_gate`:** every merged PR has `merged_by_gate` = 1, so Loomwright's gate merged it.
3. **`no_kernel_merge`:** the store records no kernel merge call. Every `gh pr merge` attempt in a session was denied `merge_blocked`, and no merge-named tool was allowed. A run with no attempt at all is `not_exercised` until step 6 is done.

It does not see what only the owner can: the cards in the app, what the Tasks screen showed at each step, and what appeared on GitHub. Those are the owner's to report ([What only the owner records](#the-evidence-file)).

## Who clicks

The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md), [D35](../DECISIONS.md)). Under D35 an agent may click only what the owner named in chat before the run, with its value: Allow once on the crew charter and on each playbook's enable, the crew member's name, model and grants, the repo policy (Solo, then Approve in Studio), Resume on the paused run before PR B, the merge card's approval for PR B, the held charter change that adds `gh pr` for step 6 (and its removal), and the command in step 6. The owner makes the github.com clicks (the visibility flip and the App's new permissions) and the ClickUp consent in the browser. The agent clicks nothing else. The evidence file's `run_by` says who ran it, and each click is recorded one by one as "the agent, on the owner's word" or "the owner". Every `owner` field holds only what the owner reports seeing.

## Screenshots

The repo is public and some screens show real data, so:

1. **Take them to the staged folder outside the repo**, `$OUT` from Setup step 9, never into the checkout: Tasks after each step, the policy card, the merge card, and the Approvals queue. `screencapture -o -x -w "$OUT/<screen>-<step>-<theme>.png"` lets you click the window.
2. **The owner reviews each one** before anything is committed.
3. **Those the owner approves are committed** under `docs/evidence/phase-8-exit-live-<date>/`, in the close commit and not before.
4. **One that shows private content stays local.** Take its hash, `shasum -a 256 "$OUT/<file>.png"`, and the evidence JSON records its file name and sha256 with `withheld: private`, in place of a path.

## The evidence file

`docs/evidence/phase-8-exit-live-<YYYY-MM-DD>.json`, written after the run and committed only at the close. It does not exist until then: this runbook names it, it does not link it. Copy machine values from the terminal and the harness summary; type your own observations into the `owner` fields. Never paste env, a token or a path to a credential. `checkEvidenceShape` in `kernel/test/phase-8-exit-live.test.ts` checks the shape, in CI, once the file exists.

```json
{
  "test": "phase-8-exit-live",
  "date": "YYYY-MM-DD",
  "result": "passed | failed — <one line>",
  "run_by": "<the owner, or which agent at the owner's request with the owner watching (D33)>",
  "commit": "<git rev-parse HEAD that the service and the app were built from>",
  "dirty_worktree": false,
  "machine": { "macos": "<sw_vers -productVersion>", "node": "<node --version>" },
  "service": "<the pid and state from launchctl print>",
  "sandbox": { "repo": "vikashruhilgit/studio-sandbox" },
  "harness": {
    "summary": "<the summary path the harness printed>",
    "checks": { "pr_states": "pass | fail | not_exercised", "merged_by_gate": "pass | fail | not_exercised", "no_kernel_merge": "pass | fail | not_exercised" }
  },
  "clicks": [
    {
      "step": "<what was clicked, for example: Allow once on the charter>",
      "value": "<the value the owner named, when it had one>",
      "run_by": "the owner | the agent, on the owner's word",
      "owner": { "seen": null, "notes": "" }
    }
  ],
  "steps": {
    "tickets": { "outcome": "passed | failed | not_exercised", "reason": "<one line>", "run_by": "the owner | the agent, on the owner's word", "owner": { "seen": null, "notes": "" } },
    "triage": { "outcome": "…", "reason": "…", "run_by": "…", "owner": { "seen": null, "notes": "" } },
    "re_request": { "outcome": "…", "reason": "…", "run_by": "…", "owner": { "seen": null, "notes": "" } },
    "pr_a_solo": { "outcome": "…", "reason": "…", "run_by": "…", "owner": { "seen": null, "notes": "" } },
    "pr_b_approve_in_studio": { "outcome": "…", "reason": "…", "run_by": "…", "owner": { "seen": null, "notes": "" } },
    "merge_block": { "outcome": "…", "reason": "…", "run_by": "…", "owner": { "seen": null, "notes": "" } },
    "tasks": { "outcome": "…", "reason": "…", "run_by": "…", "owner": { "seen": null, "notes": "" } },
    "jira": { "outcome": "not_exercised", "reason": "the owner's work account", "run_by": "the owner", "owner": { "seen": null, "notes": "" } }
  },
  "jira": "not_exercised",
  "findings": [],
  "owner": { "every_decision_made_by": "", "notes": "" },
  "cleanup": "<what the run left on the sandbox repo and in the store, and what you did about it>"
}
```

- **`clicks`** has one entry per click made in the app or on github.com, in order. A click the agent made is recorded as **"the agent, on the owner's word"**, exactly, never as the owner's own (D35); one the owner made is `"the owner"`. The checker rejects an agent click without that wording. D35 is trust plus audit: the kernel cannot tell an owner's click from an agent's, so the boundary holds only as far as this file records every click.
- **`owner`** fields hold only what the owner reports seeing (`seen` is `true`, `false` or `null` until the owner reports; `notes` is the owner's words). What the agent saw goes in `reason`, kept apart.
- **`jira`** is `not_exercised`, and so is `steps.jira`. The checker rejects any other value.
- A screenshot entry, where one is added to a step, is either `{ "path": … }` for a committed image or `{ "name", "sha256", "withheld": "private" }` for one that stays local.

## Cleanup

The harness writes nothing, so cleanup is the owner's, in the app and on GitHub: close any PR left open, delete the run's branches, turn off the four playbooks (the two ticket playbooks, triage, merge when ready) from Playbooks, and set the repo's policy to what the owner wants it to stay. The sandbox repo may stay public or return to private; the owner decides.

## Findings

**Every mismatch becomes a new phase 8 requirement item** under `.supervisor/requirements/phase-8/`, and its file name goes in the evidence's `findings`. **Nothing is patched during the run**, and not in the PR that adds this check. Phase 8 stays not done until a re-run has no open mismatch.

Follow-ups from the 25f probes (Loomwright 18.1.2, `kernel/test/phase-8-walk-order-probe.test.ts`), recorded here only, not filed as items:

- **A re-drain path after triage is wanted.** A parked PR that gets a comment or a fix after its READY can no longer merge through `--merge-parked` (`ready_stale_feedback`, `head_sha_moved`), and 18.1.2 offers the kernel no way to re-drain it, which is why triage now follows the merge.
- **A run's continuation cannot carry the owner's words.** The 25f requirement offered "a ticket run's continuation" as step 6's session, but its prompt is only the kernel's decision text (`runContinuationPrompt`), so step 6 uses a crew session given `gh pr` instead.
- **The triage fix never saw the `fix:` comment** (Part B, [evidence](phase-8-25e-triage-fix-probe.md)). Item 26a carries the owner's one triaged comment into the fix's prompt ([D49](../DECISIONS.md), the D45 amendment); its live probe committed the rename ([26a evidence](phase-8-26a-comment-probe.md)), and step 3 now expects it.

## Closing phase 8

Only after a run where all three checks pass and the owner reports the walk, and in **one commit**:

- `docs/evidence/phase-8-exit-live-<date>.json`, and the approved screenshots under `docs/evidence/phase-8-exit-live-<date>/`;
- `docs/ROADMAP.md`, phase 8 row: add **Done `<date>`** and the evidence file's path to the first cell, and a ✓ at the end of its "Done when" cell, in the earlier rows' shape;
- `docs/OPEN_QUESTIONS.md`: tick the "Phase 8 exit: live run (item 14, owner)" entry and record what was and was not observed;
- run `bash scripts/check-docs.sh` (it must pass), and put the evidence path in the PR body.

The ROADMAP ✓ and the evidence file are never committed before a passing live run. A test in `kernel/test/phase-8-exit-live.test.ts` fails CI when the phase 8 row carries a ✓ and no `phase-8-exit-live-<date>.json` exists.
