# Automate

Part of [Phase 8 features](../ARCHITECTURE.md#phase-8-features). Phase 8 item 01 (the foundation) shipped the seam and this page; item 09 filled the `runner` part with four tools and the merge check; item 10 filled the `tracker` part (a due work) and the `routing` part (`kernel_pr_route`). The bullets under [What the later items will fill](#what-the-later-items-will-fill) that are not marked built are owner decisions from the phase 8 session of 2026-11-02, not built code.

## What exists today

- **The feature.** `kernel/src/automate/index.ts` exports `automateContribution`, registered after `gui` as the eleventh and last contribution. Its three parts are `runner` (four tools, built by item 09), `tracker` (one due work, no tool: item 10) and `routing` (one tool, `kernel_pr_route`: item 10). None of the three has a route, subcommand or handler.
- **The runner's tools.** A live playbook's own run session uses them to hand tickets to Loomwright's `/automate` and to have Loomwright merge one parked PR. No tool starts a session, runs `/automate` or merges (owner decision 2026-11-03, recorded as [D43](../DECISIONS.md); see [the runner](#the-runner-tools)).
- **The routing tool.** `kernel_pr_route(repo, pr)`: read-only, `requiresConnector: "github"` at the read level, so a session lists it with the GitHub read grant (the runner's four tools need write). It answers one of `automate_drain`, `automate_fix`, `review_pr` or `reply_only` (see [owner-aware routing](#owner-aware-routing)); it starts no session and pushes nothing.
- **The table.** Migration 20 creates `pr_tracks` (see the [data model](../ARCHITECTURE.md#data-model)); the tracker writes it (see [the tracker](#the-pr-tracker)).
- **The contract.** `app/src/api/contract.ts` declares the `PrTrack` and `PrOwnerKind` types (`automate_live` / `automate_parked` / `owner` / `other`); `GET /tasks` serves a ticket card's PR fields from `pr_tracks`.

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

## The PR tracker

The `tracker` part (`kernel/src/automate/tracker.ts`) is one due work, `DueWorkFn`, and no tool. It keeps `pr_tracks` and the linked `tasks` row current, so Tasks shows each ticket's pull request truthfully. It reads and records; it pushes and merges nothing (invariants 1 and 4).

- **What it follows.** Every PR a Loomwright run file names in the workspaces of the registered agents (the current item's `pr:` URL, read by `run-state.ts`, and only for a repo that workspace is a clone of), and every `pr_tracks` row not yet `merged` or `closed`. A `merged` or `closed` row is not read again.
- **When it reads GitHub.** A pass runs only when a `trigger_fired` event was appended since the last tick it looked, so the owner's own trigger cadence drives the refresh and the kernel ships no polling interval (invariant 1). The high-water event id lives in memory: the first tick after a restart re-reads if a trigger ever fired, and the pass is idempotent. A pass reads at most `MAX_TRACKED_PER_PASS` (25) PRs, oldest `updated` first, a rate guard and not a cadence.
- **State** (`PR_TRACK_STATES`: `open`, `draft`, `ready`, `parked`, `merged`, `closed`), in this precedence: GitHub `merged` is `merged`; GitHub `closed` is `closed`; a parked item is `parked`; a run item naming the PR with a full `ready_sha` equal to the PR's head is `ready`; a draft is `draft`; else `open`. A parked item's reason (its `pause_reason`, else its status) goes in the event and the task's links.
- **Approvals** come from the repo's policy ([repo policy](repo-policy.md)) and `getPullMergeState`: `n/N` for a `reviews` policy, `solo`, `studio_approval`, or `no_policy` (`approvalsWordOf`, which `GET /tasks` reuses). CI is `green`, `pending`, `failing` or `none`.
- **Owner kind** (`PR_OWNER_KINDS`) is `ownerOf` in `routing.ts`, its one home (see [owner-aware routing](#owner-aware-routing)). A PR whose workspace's run state cannot be read is skipped for the pass, never classified; a PR with no workspace for its repo reads `other`.
- **Writes**, one transaction per PR: the `pr_tracks` upsert (UNIQUE `repo, number`); the linked task (the `tasks` row whose `dedupe_key` is `pr:<repo>#<n>`, created as `kind: ticket_pr` with one `task_created` event when none exists and the PR has a ticket ref), whose `state` follows the PR state and whose `links_json` is `{ticket, pr: {repo, number, url}, state, approvals, ci, owner_kind, reason?}`; and, when the state, head, approvals, required count, CI or owner kind changed (or the row is new), exactly one `pr_state_changed` event `{repo, pr, from, to, head_sha, approvals, ci, owner_kind, reason?}` carrying the task's id. An unchanged read writes nothing. A GitHub read that fails changes nothing for that PR.
- **The ticket ref** comes from the run item's requirement file when it is a `kernel_automate_prepare` item: its `- dedupe ref:` line under `## Source ticket`, read only from a regular file directly in `.supervisor/requirements/studio/`, size-capped, and checked as a plain token. It is untrusted text (invariant 3). Any other item has no ticket ref and so no task of its own.
- **`run_file`, `item_id` and `merged_by_gate`.** The upsert sets `run_file` (the run id) and `item_id` (the item path) when a run file names the PR, else leaves them as they were. `merged_by_gate` is 1 only when GitHub reports the PR merged and a run file's current item names it `done` with a full `ready_sha` equal to the merged head. It is shown, never acted on.
- **The GitHub client** is injected (`{client}`), else `createRepoPolicyClient()` (the stored credential), built on first use and never when there is nothing to follow. It never reads `DueWorkContext.github`.

## Owner-aware routing

`kernel_pr_route(repo, pr)` (`kernel/src/automate/routing.ts`) tells a triage playbook's session where a fix to a PR may go. It is `requiresConnector: "github"` at the read level (an agent with the GitHub read grant lists it) and read-only. It starts no session (owner decision 2026-11-03) and pushes nothing; every push stays held by the rail ([approvals](approvals.md)). The playbook's session sorts each comment (untrusted data) as fix, reply or answer, and consults the route only for a fix.

Who owns a PR is `ownerOf(run state, repo, pr, author, identity)`, in this order:

| Order | Condition | `owner_kind` | Route (`PR_ROUTES`) |
|---|---|---|---|
| 1 | a `running` run file's current item names this repo and PR | `automate_live` | `automate_drain`: record only, leave it to that run |
| 2 | a paused run's parked item names it | `automate_parked` | `automate_fix`: the item (`run_id`, `item`, `status`, `reason`, `pr`) and `command: /loomwright:review-pr <pr url>` |
| 3 | the author is the GitHub connector's `account_login` or `<app_slug>[bot]` (case-insensitive) | `owner` | `review_pr`: the same command shape; it heals and never merges |
| 4 | anyone else | `other` | `reply_only`: reply or answer, never push; suggest the fix in the reply |

Loomwright's fix-now is an in-run owner decision offered by `/automate` itself at the park, not a standalone command, so `automate_fix` names `/loomwright:review-pr <pr url>`, and the note says so.

**Fresh, and fail closed.** Every call re-reads the run files and the PR's author; it never reads `pr_tracks`, so a run that went live since the last call answers `automate_drain` on the next. No workspace for the repo, run state that cannot be read, or a GitHub read that fails answers `reply_only` with `reason` (`no_workspace`, `run_state_unreadable`, `unreadable`) and no `command`, never a route that pushes. `ownerOf` never yields `owner` or `automate_parked` from state it could not read.

The answer is `{route, repo, pr, owner_kind, command?, item?, reason?, note}`. The tool's description names the four routes and the three triage outcomes and what the session does for each, and Wright's role template ([brain](brain.md)) lets Wright draft a triage playbook from a sentence; nothing is preinstalled (D3).

## Known limits

- **The kernel cannot force the session's flags.** The playbook's own session runs `/automate`, so the kernel cannot make it use `--inline-phases` or forbid `--auto-merge`. `merge_check` and Loomwright's own gate are the guard.
- **`--merge-parked` inside a kernel-started SDK session in host mode is untested.** Probe p14 ran in a terminal session; this item builds and tests the tools with fixtures and fakes only. The live check is item 14 ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
- **No token minter is wired yet.** A live write session is refused `github_token_unavailable` until the daemon wires one, so the tools are reachable in a live run only after that.
- **The `AskUserQuestion` path of p15 is unverified.**
- **A crashed run reads live.** A run file left at `## Status: running`, or a lock whose holder pid is alive, reads `live` until Loomwright's own resume or the owner clears it; the check fails toward waiting.
- **The lock's pid can be reused.** A reused pid reads as a live holder (`run-lock.sh` also records a start time, which the kernel does not compare).
- **`merged_by_gate` is read at the pass that first sees the merge.** Nothing in a run file records `--merge-parked` itself, so a hand merge at the exact READY head after `/automate` closed the item also reads 1, and a pass that sees the merge before `/automate` closes the item reads 0 and, the row having ended, is not corrected.
- **The tracker's refresh follows the owner's triggers.** With no trigger fired, `pr_tracks` and Tasks are as of the last pass; a restart re-reads on the first tick after a trigger ever fired.
- **A PR with no run file or tracked row is not followed.** A PR enters `pr_tracks` when a run file in a registered agent's workspace names it.
- **Run files and the lock are read as Loomwright 17.34.2 writes them.** The fixtures in `kernel/test/fixtures/loomwright-run-files/` pin that shape; a Loomwright change to it needs the fixtures and `run-state.ts` updated together.

## What the later items will fill

Each bullet not marked built is an owner decision from the phase 8 session of 2026-11-02, not a description of built code.

- **The runner (built).** See [the runner tools](#the-runner-tools). The playbook's own run session runs `/automate … --inline-phases` itself (owner decision 2026-11-03, recorded as [D43](../DECISIONS.md), which supersedes D40's kernel-started session), so Stop and Kill, the budget, the cap and the approval gate already apply to it (invariant 2). No `--parallel`: its lanes spawn `claude -p` outside the kernel. It runs `/automate` in safe mode, which parks a ready PR `awaiting_merge`. Probe p15 showed `--inline-phases` reaching a PR in an SDK session started with kernel-like options (2026-11-05); its `AskUserQuestion` path was not exercised, so that part stays unverified ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
- **The tracker (built).** See [the PR tracker](#the-pr-tracker). The `pr_tracks` rows follow a PR through its states: head sha, approvals against what the repo requires ([repo policy](repo-policy.md)), CI, the ticket it came from and its run file.
- **Owner-aware routing (built).** See [owner-aware routing](#owner-aware-routing). The kernel tells a playbook who owns a PR, and a fix never starts a second drain:
  - a live `/automate` run: leave it to that run's drain;
  - a parked `/automate` item: `/loomwright:review-pr <pr url>` (Loomwright's fix-now is offered only by `/automate` itself, at the park);
  - not from `/automate`, authored by the owner or the App: `/loomwright:review-pr <pr url>` in a kernel session (it heals and never merges);
  - authored by someone else: reply or answer only, and never push to their branch (a fix is suggested in the reply).
- **Comments and reviewers.** The kernel adds GitHub write tools (reply to a comment or thread, re-request reviewers, comment) and a poll source for new PR comments. Wright authors the triage playbook from a sentence: an agent reads each comment as untrusted data (invariant 3) and classifies it fix, reply or answer. Nothing is preinstalled (D3).
- **Polling and dedupe.** The kernel ships no default (invariant 1). Wright's draft proposes defaults (tickets dedupe on the ticket id, so one PR per ticket; comments on the comment id plus its edit time; a poll every 5 minutes; normal priority) and the owner changes any of them before enabling.
- **The merge (built).** See [the merge check](#the-merge-check). The kernel never merges: a merge happens only when the owner's opt-in "merge when ready" playbook has Loomwright merge one parked item through its own `--auto-merge` gate ([repo policy](repo-policy.md), D40), with `/loomwright:automate --merge-parked <run_id>` (probe p14). On a branch with no required reviews, 17.34.0 parks `review_decision_unreadable` (fixed in 17.34.1), and 17.34.1 parks `rules_gate_dirty_tree` on a `.gitignore` line Loomwright itself writes (fixed in 17.34.2) ([OPEN_QUESTIONS](../OPEN_QUESTIONS.md#technical-verify-dont-assume)).
