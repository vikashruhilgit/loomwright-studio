# Evidence: Wright drafts charters that cover the work (phase 8 item 16)

The owner should be able to approve a working crew member from plain words, without knowing or pasting a kernel tool name. The phase 8 live run's setup step 6 showed the problem: the developer it produced held only the four read-only `kernel_github_pr_*` tools, and that showed up only as refused calls. Since item 16, the kernel publishes a tool catalogue by job (`kernel/src/features/catalogue.ts`). Wright drafts charters from it, and the charter card groups granted kernel tools by job. A playbook names its jobs (`jobs`, migration 23), and the fit check (`kernel/src/playbooks/fit.ts`) catches a member that lacks a job its playbook needs before the playbook is enabled ([playbooks: jobs and the fit check](../architecture/playbooks.md#jobs-and-the-fit-check)).

This page records Validation 1 for the kernel half (the catalogue, the fit check, `charter_gap` and their tests) and the outputs below. **Validation 2, the owner's live sentence in the packaged app, is pending the owner.** It needs a real model's choice of jobs, which CI can't pin. The owner runs it and reports what the card showed.

## Validation 1

Run by the worker on 2026-11-10 (macOS, Darwin 25.6.0), on branch `feature/wright-drafts-charters-cover-the-work-2`, which stacks this subtask on subtask 1's commit `27fbba3` (the catalogue).

| Command | Result |
|---|---|
| `cd kernel && npm ci && npm run typecheck` | exit 0 (`tsc -p tsconfig.json`, no errors) |
| `cd kernel && npm test` | exit 0: 127 test files passed, 2 skipped (129); 4315 tests passed, 16 skipped (4331) |
| `cd kernel && npx vitest run test/playbooks-fit.test.ts` | 18 passed (AC4, AC5, AC7, AC8, AC10 and the `jobs` field) |
| `bash scripts/check-docs.sh` | exit 0 |
| `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` | not run here: the app half (AC3's rendered card) is subtask 3's lane, in its own worktree. Its counts belong to that subtask's evidence and to the integrated branch. |

Pin mutations for `kernel/test/playbooks-fit.test.ts` were checked by hand. Each mutation was applied, the file run, then the change reverted:

| Mutation | Result |
|---|---|
| `job: "automate_tickets",` → `job: "read_pr",` on `kernel_automate_prepare` (`kernel/src/automate/runner.ts`) | 4 failed, AC5's walk case among them |
| `charter_gap` refusal removed from both `beforeHold` and `enableApproved` (`kernel/src/playbooks/enable.ts`) | 3 failed |
| only the `enableApproved` throw removed | 2 failed |
| only the `beforeHold` refusal removed | 2 failed |
| a `connectors` key added to `proposed_update.changes` (`kernel/src/playbooks/fit.ts`) | 2 failed, AC8 among them |
| tool names read from the playbook's `intent` and added to `proposed_update` | 1 failed (AC10) |
| tool names read from the `intent` and turned into jobs | 1 failed (AC10) |

## The catalogue text for the walk's four jobs

These are the lines the drafting tools' descriptions carry (`catalogueText`) for the four jobs the walk needs, shown here without the other jobs' blocks. The preamble is the same for every job:

```text
The kernel's tool catalogue: every kernel tool a crew member can be granted, by job.
To give a crew member a job, list every tool of that job in its tool_policy.allowedTools as mcp__kernel__<tool>; draft the list from the jobs the owner's words need.
Tell the owner the jobs in plain words, never the tool names.
A tool marked [needs the … grant] is offered only to a member holding that connector grant. The grant is the owner's: a create may propose it in connectors, the owner sets the write level in Team, and kernel_agent_update never changes it.
Triage PR comments also needs Read a PR, to read the comments.
Job automate_tickets "Hand tickets to /automate":
- kernel_automate_prepare: Hand tickets to Loomwright's /automate. [needs the github connector's write grant]
- kernel_automate_state: Loomwright's /automate state for your workspace that is a clone of the repo: live (with the run id; start no run), parked (the parked items with their reason and PR) or idle (read only). [needs the github connector's write grant]
Job triage_pr_comments "Triage PR comments":
- kernel_github_pr_reply: Reply in one review comment's thread on a pull request on GitHub. [needs the github connector's write grant]
- kernel_github_pr_comment: Comment on a pull request's conversation on GitHub. [needs the github connector's write grant]
- kernel_github_pr_request_reviewers: Ask for, or re-request, reviews on a pull request on GitHub from the named users. [needs the github connector's write grant]
- kernel_pr_route: Where a comment on a pull request may be acted on, read fresh on every call (run state and the pull request's author, never a stored copy) (read only). [needs the github connector grant]
Job ask_for_merge "Ask for a merge":
- kernel_automate_merge_check: Whether Loomwright may merge one parked pull request now (read only). [needs the github connector's write grant]
- kernel_merge_approval_request: Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio. [needs the github connector's write grant]
Job read_pr "Read a PR":
- kernel_github_pr_get: Read one pull request's metadata and description from GitHub (read-only). [needs the github connector grant]
- kernel_github_pr_diff: Read one pull request's unified diff from GitHub (read-only), cut at max_bytes (default 256 KiB). [needs the github connector grant]
- kernel_github_pr_files: List the files one pull request changes on GitHub (read-only), each with its status and added and deleted line counts. [needs the github connector grant]
- kernel_github_pr_comments: Read the comments on one pull request from GitHub (read-only): the conversation's comments, then the review comments on files. [needs the github connector grant]
```

## AC5: the fit for the read-only member

Setup: crew member `mason` (display name Mason), whose charter allows `Read` plus the four read-only `kernel_github_pr_*` tools, Bash prefix `gh pr`, and the GitHub read grant (`connectors: ["github"]`). It has the walk's four playbooks: GitHub tickets and ClickUp tickets naming `automate_tickets`, Triage naming `triage_pr_comments`, and Merge when ready naming `ask_for_merge`. `playbookFit` was run over the shipped composition's catalogue. Each playbook's result, with `expected_sha256` replaced by a placeholder and `allowedTools` abbreviated to the tools it adds:

| Playbook | `status` | `lines` | Tools `proposed_update` adds | `owner_steps` |
|---|---|---|---|---|
| GitHub tickets | `gap` | This playbook needs Hand tickets to /automate; Mason doesn't have it. | `kernel_automate_prepare`, `kernel_automate_state` | Mason needs GitHub write access for Hand tickets to /automate; only you can grant it: Team → Mason's inspector. |
| ClickUp tickets | `gap` | This playbook needs Hand tickets to /automate; Mason doesn't have it. | `kernel_automate_prepare`, `kernel_automate_state` | the same GitHub write step |
| Triage | `gap` | This playbook needs Triage PR comments; Mason doesn't have it. | `kernel_github_pr_reply`, `kernel_github_pr_comment`, `kernel_github_pr_request_reviewers`, `kernel_pr_route` | Mason needs GitHub write access for Triage PR comments; only you can grant it: Team → Mason's inspector. |
| Merge when ready | `gap` | This playbook needs Ask for a merge; Mason doesn't have it. | `kernel_automate_merge_check`, `kernel_merge_approval_request` | Mason needs GitHub write access for Ask for a merge; only you can grant it: Team → Mason's inspector. |

Together the four add exactly the walk charter's tools (`MASON_TOOLS` in `kernel/test/phase-8-exit.test.ts`) that the member lacks: every one but `kernel_github_pr_comments`, which it already holds. With the walk charter itself, each of the four reports `fits` and no update. The test reads `MASON_TOOLS` from `phase-8-exit.test.ts` as text and fails if its copy differs.

The first playbook's `proposed_update` in full, as Wright passes it to `kernel_agent_update` with its own idempotency key:

```json
{
  "id": "mason",
  "changes": {
    "tool_policy": {
      "allowedTools": [
        "Read",
        "mcp__kernel__kernel_github_pr_get",
        "mcp__kernel__kernel_github_pr_files",
        "mcp__kernel__kernel_github_pr_diff",
        "mcp__kernel__kernel_github_pr_comments",
        "mcp__kernel__kernel_automate_prepare",
        "mcp__kernel__kernel_automate_state"
      ],
      "allowedBashPrefixes": ["gh pr"]
    }
  },
  "expected_sha256": "<sha256 of config/agents/mason.json>"
}
```

Two things are never in it: a connector grant (the GitHub write level is the owner's step above), and any tool named only in the playbook's intent or a polled item (AC10).

## Honest limits

- **Declared jobs only.** The check sees the jobs the playbook names. If Wright under-declares them, the playbook passes and then meets the kernel's refusal mid-run. Triage names only `triage_pr_comments`, so a member lacking `kernel_github_pr_comments` (in `read_pr`) is not flagged; the catalogue text tells Wright to grant Read a PR alongside it.
- **The fit fails closed at the enable.** No catalogue, an unreadable settings file or a stored jobs value that does not read whole is `unchecked`, and the enable refuses `charter_gap` until the owner says to enable anyway.
- **Validation 2 is pending the owner.** No verdict is recorded here for it.
