# Phase 8 exit: the owner's live run on studio-sandbox

Phase 8 is done when this holds in the running system ([`docs/ROADMAP.md`](../ROADMAP.md), phase 8 row): **a PR is tracked through its states; comments are triaged (fix / reply / answer); reviewers are re-requested; and a PR merges once the repo's approval policy is met, only through the gated path.** This is acceptance test 2. The walk: one GitHub issue and one personal ClickUp task become two PRs through Loomwright's `/automate`; three comments on one PR are triaged and the owner is re-requested as reviewer; PR A merges through the gate under **Solo**; PR B merges through the gate under **Approve in Studio** after the owner approves its merge card; a direct `gh pr merge` from a session is denied `merge_blocked`; and Tasks shows each ticket's PR, approvals and CI throughout.

The deterministic half is in CI, on fakes: `kernel/test/phase-8-exit.test.ts` walks the steps on a real in-process kernel with a fake GitHub, a fake ClickUp MCP server, stand-in `/automate` and `/review-pr` sessions that write recorded run files, and one injected clock; `app/e2e/phase-8-exit.spec.ts` does the same with the built app on screen. They prove the loop and the store's effects. They do not prove it against real GitHub, real ClickUp, real Loomwright sessions or the real branch protection. This runbook is the live half, and `kernel/test/phase-8-exit-live.test.ts` is the read-only harness that checks the store while the walk happens. Phase 5, 6 and 7's live runs are the precedent ([phase 5](phase-5-exit-runbook.md), [phase 6](phase-6-exit-runbook.md), [phase 7](phase-7-exit-runbook.md)).

The owner decides when this runs. It uses the owner's subscription, launchd service, screen, GitHub account and personal ClickUp. The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md), [D35](../DECISIONS.md)); see [Who clicks](#who-clicks).

## What this run does to the machine

Read this before starting.

- **It writes to the sandbox repo on GitHub, and only there.** The setup seeds it, the owner flips it public and sets protection on `main`; the walk then opens an issue, makes two PRs, comments and reviewer requests on one, and merges both. All of it is on `vikashruhilgit/studio-sandbox`, which holds only throwaway content. Studio's own GitHub writes go through the App's one-hour, down-scoped session token and the approval gate; the harness writes nothing.
- **It writes into your real store, through the app.** Everything lands in `~/.loomwright-studio/studio.db` (or `$STUDIO_DATA_DIR`): the connector rows, a repo policy, a crew member (its `agents` row, `config/agents/<id>.json` and `memory/<id>/`), the playbooks Wright drafts, their runs and sessions, `pr_tracks` rows, tasks, approvals and events.
- **It touches your personal ClickUp**, read-only: the connect opens the system browser for ClickUp's consent, the token goes to the Keychain, and the crew member is granted ClickUp's read tools only.
- **Sessions spend tokens on your subscription**, and the weekly cap is shared with your own sessions ([D17](../DECISIONS.md)). Several `/automate` sessions run (one per ticket, plus the merge-when-ready and triage playbooks' own sessions, plus Wright's sessions drafting the playbooks). Expect a large share of a day's use; do not start it when you need the cap for other work.
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
7. **The repo's detected policy card proposes Solo and the owner accepts it.** The first time the repo is used, Integrations shows the policy card from the repo's real protection (`ci` required, no required reviews). The owner presses the Solo proposal. Studio never changes GitHub's protection itself.
8. **Build the kernel, install the service and package the app**, as [phase 5's setup steps 2 to 5](phase-5-exit-runbook.md#setup) and [phase 7's setup](phase-7-exit-runbook.md#setup) do, from the branch under test (the service runs an install copy, so reinstall after every build). Open the app from Finder, not from a terminal. Record `git rev-parse HEAD`, the service's pid, `sw_vers -productVersion` and `node --version` for the evidence file.
9. **Stage the screenshot folder outside the repo:** `OUT="${TMPDIR:-/tmp}/studio-phase8-exit-$(date +%F)"; mkdir -p "$OUT"; echo "$OUT"`.

## Known preconditions

Two facts the CI walks prove, and that the live run meets as written. Check both before spending the subscription.

- **The kernel wires no session-token minter yet.** `kernel/src/kernel.ts` leaves `sessionTokenMint` unwired (a later item wires item 03's), so a live, write-granted session is refused `github_token_unavailable`. The live run needs a follow-up item to wire the minter first; until then, do not start it. The CI walks supply a stand-in mint.
- **A ClickUp-polled playbook must link a poll that names a repository.** A live write-granted session's token is minted for the repos of the playbook's first linked poll, and a `clickup.tasks` poll names none, so the session is refused `no_repos`. This is why the walk has two ticket playbooks, four playbooks in all (GitHub tickets, ClickUp tickets, triage, merge when ready), the same layout `kernel/test/phase-8-exit.test.ts` and `app/e2e/phase-8-exit.spec.ts` use.

## Starting the harness

In a second terminal, from the repo root, before the first step of the walk:

```bash
export STUDIO_LIVE_GITHUB_ACCOUNT=vikashruhilgit
export STUDIO_LIVE_SANDBOX_REPO=vikashruhilgit/studio-sandbox
cd kernel && STUDIO_LIVE=1 npx vitest run test/phase-8-exit-live.test.ts
```

It refuses a repo whose owner is not the named personal account, records a run start (the store's highest event id) and prints the path of its summary (under `tmpdir()`, mode `0600`). It then re-reads the store every few seconds and prints a line whenever a check changes. `STUDIO_LIVE_WAIT_MIN` (1 to 240, default 120) bounds the wait. It ends when the three checks are all `pass` or one `fail`s, or at the wait's end. It never decides an approval: when a card is waiting, decide it in the app.

## The walk

Do each step in the app, in order. After each, the harness (or the store) shows its effect. The values below are examples; use the real issue and task numbers.

| Step | What happens | What the store shows |
|---|---|---|
| 1. Tickets | Open one GitHub issue on the sandbox repo (`gh issue create`), and one ClickUp task tagged as the owner says. Ask Wright to author two live ticket playbooks, one per source, and enable both (a dry run first, then a held enable: Allow once). The GitHub one polls `github.issues` on the sandbox repo. The ClickUp one first links a `github.pulls` poll that names the sandbox repo (switched off, so it fires nothing) and registers the `clickup.tasks` poll second; see [Known preconditions](#known-preconditions). Each runs `/automate --backlog … --inline-phases` in safe mode in its own kernel session. | Two `tasks` rows of kind `ticket_pr`, each linked to its own `pr_tracks` row by `ticket_ref` (PR A and PR B). A PR row per ticket, each starting from a new track |
| 2. Triage | On PR A (parked by `/automate`) the owner leaves three comments: `fix: rename ping to pong`, `question: why exit 0?` and `remark: nice`. Ask Wright to author the triage playbook and enable it. | The fix routes to the parked item (a `/loomwright:review-pr <pr url>` in the triage playbook's own session, never a second drain). An answer is posted for the question and a reply for the remark, through the kernel's GitHub write tools, each after the approval gate |
| 3. Re-request | The same playbook re-requests the owner as reviewer on PR A. | The GitHub request on the PR; the call recorded in the session's events |
| 4. PR A under Solo | Create the opt-in "merge when ready" playbook and enable it. With CI green and Loomwright's review passed, the merge check answers `go`, and the playbook's session has Loomwright merge that one item through its `--auto-merge` gate. | `pr_tracks`: PR A `merged` with `merged_by_gate` = 1; the ordered `pr_state_changed` events |
| 5. PR B under Approve in Studio | The owner switches the repo's policy to **Approve in Studio** (Integrations, the policy card). PR B parks `awaiting_merge`; the merge card appears in Approvals for PR B's head commit. The owner approves it (Allow once); the playbook's next fire has the gate merge it. | A merge approval row for PR B's head, decided by the owner; PR B `merged` with `merged_by_gate` = 1 |
| 6. The merge block | In a session the owner names, ask the agent to run `gh pr merge <number>` directly. | A `tool_decision` event: `Bash`, `gh pr merge …`, `deny`, reason `merge_blocked` |
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

The owner runs it, or has an agent run it while watching the screen ([D33](../DECISIONS.md), [D35](../DECISIONS.md)). Under D35 an agent may click only what the owner named in chat before the run, with its value: Allow once on the crew charter and on each playbook's enable, the crew member's name, model and grants, the repo policy (Solo, then Approve in Studio), the merge card's approval for PR B, and the command in step 6. The owner makes the github.com clicks (the visibility flip and the App's new permissions) and the ClickUp consent in the browser. The agent clicks nothing else. The evidence file's `run_by` says who ran it, and each click is recorded one by one as "the agent, on the owner's word" or "the owner". Every `owner` field holds only what the owner reports seeing.

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

## Closing phase 8

Only after a run where all three checks pass and the owner reports the walk, and in **one commit**:

- `docs/evidence/phase-8-exit-live-<date>.json`, and the approved screenshots under `docs/evidence/phase-8-exit-live-<date>/`;
- `docs/ROADMAP.md`, phase 8 row: add **Done `<date>`** and the evidence file's path to the first cell, and a ✓ at the end of its "Done when" cell, in the earlier rows' shape;
- `docs/OPEN_QUESTIONS.md`: tick the "Phase 8 exit: live run (item 14, owner)" entry and record what was and was not observed;
- run `bash scripts/check-docs.sh` (it must pass), and put the evidence path in the PR body.

The ROADMAP ✓ and the evidence file are never committed before a passing live run. A test in `kernel/test/phase-8-exit-live.test.ts` fails CI when the phase 8 row carries a ✓ and no `phase-8-exit-live-<date>.json` exists.
