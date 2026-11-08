# Automate

Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features). Phase 8 item 01 (the foundation) shipped the seam and this page; item 09 filled the `runner` part with four tools and the merge check. The `tracker` and `routing` parts are still empty, and their bullets below are owner decisions from the phase 8 session of 2026-11-02, not built code.

## What exists today

- **The feature.** `kernel/src/automate/index.ts` exports `automateContribution`, registered after `gui` as the eleventh and last contribution. Its three parts are `runner` (four tools, built by item 09), `tracker` and `routing` (both empty: no tool, route, subcommand, handler or due work). The runner part has no route, subcommand, handler or due work either.
- **The runner's tools.** A live playbook's own run session uses them to hand tickets to Loomwright's `/automate` and to have Loomwright merge one parked PR. No tool starts a session, runs `/automate` or merges (owner decision 2026-11-03; see [the runner](#the-runner-tools)).
- **The table.** Migration 20 creates `pr_tracks` (see the [data model](../ARCHITECTURE.md#data-model)). Nothing writes to it yet.
- **The contract.** `app/src/api/contract.ts` declares the `PrTrack` and `PrOwnerKind` types (`automate_live` / `automate_parked` / `owner` / `other`). No route uses them yet.

Like every feature module, nothing it loads may import the Agent SDK, the session manager or `kernel.ts` as a value, because the `studio` CLI loads it.

## The runner tools

Four kernel tools, all `requiresConnector: "github"` and `requiresConnectorLevel: "write"`, so a session lists them only when its agent holds `github: write` (`toolsForConnectors`). They are built in `kernel/src/automate/runner.ts`.

| Tool | Does |
|---|---|
| `kernel_automate_prepare(repo, tickets[])` | Writes one requirement item per ticket and one `_BACKLOG.md` into the checkout, and answers the backlog path and the exact invocation to run |
| `kernel_automate_state(repo)` | Read-only. `live` (with the run id), `parked` (items with reason and PR) or `idle` |
| `kernel_automate_merge_check(repo, pr)` | Read-only. `go` with p14's invocation, or `wait` / `park` with the reason |
| `kernel_merge_approval_request(repo, pr, head_sha, ci, ready_at, policy?)` | Always held; a record of the owner's approval to merge one PR at one head |

**Who may call them.** Each handler refuses a session that is not a live playbook's real run: no playbook (`not_a_playbook_session`), a dry run (`dry_run_session`, read from the `session_dry_run` event the session manager writes with the row) or a playbook whose stored `mode` is not `live` (`playbook_not_live`). A draft-mode playbook's call never reaches the held tool: the gate records a draft instead ([approvals](approvals.md)). The refusals are the closed `AUTOMATE_REFUSALS` list, each the start of the error message.

**The checkout.** The agent's workspace for the repo: one of the `workspaces` in its settings file (`config/agents/<id>.json`, [agents](agents.md)) that is a git clone whose remote names `<owner>/<repo>` (read from `.git/config`, or the common dir a worktree's `.git` file points to; https, ssh and scp forms, any case). Without one the call is refused `no_workspace`. Workspaces are the owner's, outside macOS-protected folders and the data dir (the settings reader's checks, D31). Wright's settings may not list workspaces yet, so a playbook of Wright's is refused `no_workspace`.

**`kernel_automate_prepare`.** For each ticket (`ref`, `title`, `link`, `body?`; 1 to 20 per call) it writes `.supervisor/requirements/studio/ticket-<slug>-<hash>.md` and one `_BACKLOG.md` listing the items of this call, in the plan-doc shape `/automate --backlog` reads (the checklist last). The answer is `{repo, backlog, invocation, items: [{ref, path, existing}], note}`, and the invocation is `/automate --backlog <absolute path> --inline-phases`: safe mode, no `--auto-merge`, no `--parallel`. Nothing from a ticket is in the invocation.

- **A ticket is untrusted data (invariant 3).** The ref must be a plain token, the link a plain `https` URL, the title one clean line; the body is quoted, every line behind `> `, so no line of it can start a heading, a `## Status:` stamp (Loomwright reads those from files) or a checklist line. An item names its source (repo, dedupe ref, link) and carries one kernel-written acceptance line ("the change the ticket describes is implemented with tests, and CI passes").
- **An existing item is left alone** (`existing: true`): Loomwright may have stamped it `## Status: done`, and rewriting it would queue it again. The kernel sets no other dedupe policy (invariant 1); which tickets to hand over is the playbook's.
- **Where it writes.** Each level of `.supervisor/requirements/studio` must be a real directory (a symlink is refused `unsafe_path` before anything is created), and the resolved folder must stay inside the checkout. Items are written with an atomic no-clobber link, the backlog with a temp file and a rename.

**`kernel_automate_state`.** Reads Loomwright's run files in `<checkout>/.supervisor/automate/`. A run file is a file whose first line is `# Automate Run: <title>`; the folder also holds sidecars (`<run_id>.supervisor-result.md`, `<run_id>.review-heal-result.md`) that carry no such title, so a run is found by its title, never by its name or as "the last `.md`" (the trap probe p15 hit). It reads `## Status: running | paused | done`, and under `## Current` the item line (`status`, `pr`, `branch`), `pause_reason` and the `ready_sha | ready_at | termination_reason` line. The answer is `live` when a run file reads `running` or the run lock (`.supervisor/run.lock/meta`, its `pid` alive) is held, else `parked` when a paused run's current item is not done, else `idle`. Anything unreadable (an oversize or unnamable run file, an unreadable folder or lock) is refused `run_state_unreadable`, and the playbook is told to treat it as live. Loomwright's own run lock refuses a second run in any case (single drain, invariant 4).

## The merge check

`kernel_automate_merge_check` (built in `kernel/src/automate/merge-check.ts`) answers `go`, `wait` or `park`. It reads only: the store, the checkout's run state and GitHub (through `policyMet`). It answers `go` only when, in this order:

1. the repo has a merge policy, else `park: no_policy` ([repo policy](repo-policy.md)); GitHub is not read;
2. no run is live, else `wait: run_live`;
3. one paused run file parks this PR (the item's PR URL names this repo and number) as `awaiting_merge`, with a full `ready_sha`: otherwise `park: not_parked`, `not_awaiting_merge`, `ambiguous_runs` (two runs park it) or `ready_sha_missing`. The live head is never substituted for a missing `ready_sha`;
4. `policyMet` holds for that PR at the item's `ready_sha`, with the calling playbook's `merge_requirement` as its `playbookRequirement` (the session's playbook; a playbook may only ask for more, never less). Its reasons read as `park` where a person has to act (`no_policy`, `changes_requested`) and `wait` otherwise (`head_moved`, `ci_not_green`, `awaiting_owner_approval`, `reviews_short`, `unreadable`);
5. when an approved merge approval exists at that head, one of them carries the item's `ready_at` (else `wait: ready_at_mismatch`: the approval was for an earlier READY of the same head). `hasMergeApproval` itself still matches on repo, PR and head only; the `ready_at` comparison is the check's.

The `go` answer is `{answer: "go", run_id, ready_sha, invocation}`, and the invocation is `/loomwright:automate --merge-parked <run_id>` (Loomwright 17.34.2 or later, probe p14), plus `--trust-unprotected` only when `loomwrightMergeFlags` returns it. The playbook's own session runs it; Loomwright's seven gate conditions still decide, and `/automate` closes the item out itself. A `wait` or `park` is reported with its reason, as Loomwright reports a park of its own.

**Nothing here merges (invariant 4).** No module in `kernel/src/automate/` calls a GitHub merge endpoint, runs `gh` or starts a process (`kernel/test/automate-merge-check.test.ts` scans the sources for each), and `gh pr merge` stays `merge_blocked` in every session.

**The GitHub client.** `merge-check.ts` takes `PolicyMetDeps` with an optional `client`. Production passes none, so `policyMet` uses its own `createRepoPolicyClient()` (the stored credential), the way `detectRepoPolicy` does; it never reads `ContributedToolContext.github`, which is typed without the repo-policy reads. A GitHub read that fails answers `wait: unreadable`, never `go`.

## The merge approval

For a repo whose policy is Approve in Studio (or a playbook that asks for `studio_approval`), the merge-when-ready playbook files `kernel_merge_approval_request(repo, pr, head_sha, ci, ready_at, policy?)`. See [approvals](approvals.md#the-merge-approval) for the hold. In short:

- **Always held.** The tool is in `ALWAYS_HELD_TOOLS`, so every call is held for the owner and no "always" grant covers it. It is not a GitHub write tool and not a kernel-applied action.
- **A record only.** An allow does nothing by itself; the agent's repeat just answers `recorded`. The merge-when-ready playbook's next fire sees the approval through `kernel_automate_merge_check`.
- **The payload.** The rail files `{tool, input, cwd}`; `input` carries `repo`, `pr`, `head_sha`, `ci`, `ready_at` and optionally `policy` under the names the app's merge card reads. `hasMergeApproval` reads `$.input.repo`, `$.input.pr` and `$.input.head_sha` (and requires `$.tool`), and only that shape ([evidence](../evidence/phase-8-item-09-merge-approval-shape.md)).
- **Stale after a push.** The approval names a head. A new push makes `policyMet` answer `head_moved`, and a re-drained head needs its own approval.

## Known limits

- **The kernel cannot force the session's flags.** The playbook's own session runs `/automate`, so the kernel cannot make it use `--inline-phases` or forbid `--auto-merge`. `merge_check` and Loomwright's own gate are the guard.
- **`--merge-parked` inside a kernel-started SDK session in host mode is untested.** Probe p14 ran in a terminal session; this item builds and tests the tools with fixtures and fakes only. The live check is item 14 ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
- **No token minter is wired yet.** A live write session is refused `github_token_unavailable` until the daemon wires one, so the tools are reachable in a live run only after that.
- **The `AskUserQuestion` path of p15 is unverified.**
- **A crashed run reads live.** A run file left at `## Status: running`, or a lock whose holder pid is alive, reads `live` until Loomwright's own resume or the owner clears it; the check fails toward waiting.
- **The lock's pid can be reused.** A reused pid reads as a live holder (`run-lock.sh` also records a start time, which the kernel does not compare).
- **Run files and the lock are read as Loomwright 17.34.2 writes them.** The fixtures in `kernel/test/fixtures/loomwright-run-files/` pin that shape; a Loomwright change to it needs the fixtures and `run-state.ts` updated together.

## What the later items will fill

Each bullet is an owner decision from the phase 8 session of 2026-11-02, not a description of built code.

- **The runner (built).** See [the runner tools](#the-runner-tools). The playbook's own run session runs `/automate … --inline-phases` itself (owner decision 2026-11-03, superseding the 2026-11-02 kernel-started session), so Stop and Kill, the budget, the cap and the approval gate already apply to it (invariant 2). No `--parallel`: its lanes spawn `claude -p` outside the kernel. It runs `/automate` in safe mode, which parks a ready PR `awaiting_merge`. Probe p15 showed `--inline-phases` reaching a PR in an SDK session started with kernel-like options (2026-11-05); its `AskUserQuestion` path was not exercised, so that part stays unverified ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
- **The tracker.** The `pr_tracks` rows follow a PR through its states: head sha, approvals against what the repo requires ([repo policy](repo-policy.md)), CI, the ticket it came from and its run file.
- **Owner-aware routing.** The kernel tells a playbook who owns a PR, and a fix never starts a second drain:
  - a live `/automate` run: leave it to that run's drain;
  - a parked `/automate` item: its fix-now or `/review-pr <pr>`;
  - not from `/automate`, authored by the owner or the App: `/review-pr <pr>` in a kernel session (it heals and never merges);
  - authored by someone else: reply or answer only, and never push to their branch (a fix is suggested in the reply).
- **Comments and reviewers.** The kernel adds GitHub write tools (reply to a comment or thread, re-request reviewers, comment) and a poll source for new PR comments. Wright authors the triage playbook from a sentence: an agent reads each comment as untrusted data (invariant 3) and classifies it fix, reply or answer. Nothing is preinstalled (D3).
- **Polling and dedupe.** The kernel ships no default (invariant 1). Wright's draft proposes defaults (tickets dedupe on the ticket id, so one PR per ticket; comments on the comment id plus its edit time; a poll every 5 minutes; normal priority) and the owner changes any of them before enabling.
- **The merge (built).** See [the merge check](#the-merge-check). The kernel never merges: a merge happens only when the owner's opt-in "merge when ready" playbook has Loomwright merge one parked item through its own `--auto-merge` gate ([repo policy](repo-policy.md), D40), with `/loomwright:automate --merge-parked <run_id>` (probe p14). On a branch with no required reviews, 17.34.0 parks `review_decision_unreadable` (fixed in 17.34.1), and 17.34.1 parks `rules_gate_dirty_tree` on a `.gitignore` line Loomwright itself writes (fixed in 17.34.2) ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
