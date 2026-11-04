# 05 — GitHub write tools, and the issue and PR-comment poll sources

## Status: ready

**Priority:** MVP · ROADMAP phase 8 · D3, D4, invariant 3

**As** the owner,
**I want** the kernel to give agents tools to reply to a comment, answer, comment on a PR or issue and re-request reviewers, and to let a playbook poll GitHub issues and new PR comments,
**so that** Wright can author the ticket-to-PR and triage playbooks I ask for, with every write going through the approval gate.

## Problem

The kernel's GitHub tools are read-only (`kernel_github_pr_get` / `_diff` / `_files` / `_comments`, `kernel/src/integrations/github/tools.ts`), and a poll can list only open pulls (`github.pulls`). Loomwright has no comment triage and no reviewer re-request (checked in 17.26.0). Phase 8's done-when needs both.

## Owner decisions (2026-11-02, binding)

Recorded 2026-11-02 in the phase 8 product-owner session, over eight rounds of AskUserQuestion. The owner's answers are quoted verbatim where they were typed rather than picked. Each item carries this copy. D3, D4, D5, D9, D12, D16, D22, D24, D26–D29, D34–D37 and invariants 1–9 stay as they are except where a line below says it supersedes something. Phase 5–7 decisions (in their items) still hold.

- **Tickets come from GitHub Issues, Jira and ClickUp.** The owner answered "github, jira and clickup", and asked "why are we building it in this way they should be a part of connector (integration), right?" Each tracker is its own optional connector on Integrations, like GitHub (invariant 5, D12). In the kernel, every connector's tickets reach a playbook as the same poll item shape, so a playbook polls tickets the same way whatever the source.
- **Jira and ClickUp connect as MCP connectors** (the owner chose "Yes, hosted MCP + OAuth (Recommended)" after asking "how other apps work, like claude desktop and others, research if we are not clear"). Studio is an MCP client to each vendor's hosted server (Atlassian Rovo MCP `https://mcp.atlassian.com/v1/mcp`, ClickUp `https://mcp.clickup.com/mcp`), runs the OAuth 2.1 consent in the system browser, keeps the tokens in the Keychain, and lists to each agent only the tools the owner grants. That is how Claude desktop and Claude Code connect them (researched 2026-11-02; ClickUp's server is OAuth-only and in beta; Atlassian's is Jira Cloud only). A new DECISIONS entry records it, as D36 did for the App, because it is an OAuth round trip; it is not a claude.ai sign-in (invariant 6).
- **Jira is the owner's work (Tray) account: "Work (Tray) — stub only".** Nothing in phase 8 touches it live. Jira is built and tested against a fake MCP server in CI, and its live check is recorded `not_exercised`. **ClickUp is personal** (owner: "clickup is personal account"), so the live run may read it.
- **GitHub write access: "Raise the GitHub App (Recommended)".** This supersedes D36's "Read-only still" clause for the App. The token path stays read-only (`token_write_scoped` unchanged). App permissions: the owner chose **"Every permission the App can hold"** (every repository permission at write). The owner re-approves the new permissions on github.com.
- **Session tokens are down-scoped: "Down-scope per session (Recommended)".** A session's token is minted with only Pull requests, Contents, Issues and Checks (no administration, secrets, workflows or settings), although the App itself holds every permission.
- **How a session authenticates: "Kernel injects the App's token (Recommended)".** In a session whose playbook is `live` and whose agent the owner granted GitHub write, the kernel mints a one-hour, down-scoped installation token and passes it as `GH_TOKEN` plus a git credential for that session only. `gh` is allowed in that session. Every push and gh write still goes through the rail and the approval gate, and `gh pr merge` stays `merge_blocked`. Every other session is unchanged (no GitHub token).
- **Outward writes in live mode: "Existing gate + per-playbook Always (Recommended)".** The safety kernel is unchanged (invariant 3). Each outward kind is held the first time, and the owner may grant "Always for this playbook" per kind. `never` still wins. A playbook goes `live` only after its dry run and a held enable. Phase 8 lifts `live_mode_not_in_phase_6`.
- **Merge approvals are the user's policy, set per repo.** The owner: "2 approval concept is ideal but for solo dev this is not gona work. this is something we can suggest as default, but as per user choice. for solo dev most of the stuff will be automated", and "there should also be an option for repo specific choice, like if someone works on studio with repos where he needs 2 approvals for some and for some he doesn't need any buddy or he is the only one working there". Chosen: **"Repo sets it; playbook only stricter (Recommended)"**. Each repo has a merge policy: **Solo** (merges when CI and Loomwright's review pass, with no human approval), **Approve in Studio** (an approval card), or **N GitHub reviews** (enforced by branch protection; Wright suggests 2 for a team repo). A playbook may only ask for more, never less. A repo with no policy never merges (its PRs park until the owner sets one). The kernel ships the mechanism and no number (invariant 1). ROADMAP's phase 8 done-when becomes "merges once the repo's approval policy is met, only through the gated path" (proposed in the question; the owner added the per-repo choice).
- **Repo policy in a few clicks.** The owner: "we can make easy, by setting those up for user in few clicks, what you say? suggest". Chosen: **"Detect + propose, one click (Recommended)"**. When a repo is first used, Studio reads its real state (branch protection's required reviews and checks, who can push) and proposes a policy card that the owner accepts or changes. Studio never changes GitHub's branch protection itself; when protection is missing, it shows what to set and a link.
- **A repo where GitHub can't enforce protection** (private on GitHub Free): **"Say so; offer trust-unprotected (Recommended)"**. The card says so plainly and offers making it public or upgrading, "Trust this repo unprotected" (an explicit per-repo click, recorded, passed to Loomwright as `--trust-unprotected`, which waives condition 4 only and never the high-risk park), or safe mode. None is ever picked silently.
- **The merge flow: "Playbook triggers LW's gate (Recommended)".** The owner rejected a merge path that only guards by reading commands ("that not right, LW make the work ready, we can set a flow where you (wright or any crew) can see that pr is ready for merge then that can take care of that, like merge it and inform LW that its merged do the rest. but with user consent if user want that flow/playbook"). So: `/automate` runs in **safe mode** and parks a ready PR `awaiting_merge`. An opt-in "merge when ready" playbook, which the owner creates, checks the repo's policy and then has **Loomwright merge that one item through its own `--auto-merge` gate** (all seven conditions still run), and `/automate` does the rest itself. **Invariant 4 is kept**: the kernel never merges, and `gh pr merge` stays blocked in every session. Whether Loomwright can merge one parked item this way is unverified; item 01 probes it.
- **How Studio runs `/automate`: "Kernel session, --inline-phases (Recommended)".** A playbook run starts one kernel-owned SDK session (Loomwright loaded, host mode) running `/automate … --inline-phases`, so Stop/Kill, budget, the cap and the approval gate all apply (invariant 2). No `--parallel`, because its lanes spawn `claude -p` outside the kernel.
- **Comment triage and reviewer re-request: "Kernel tools + Wright's playbook (Recommended)".** The kernel adds GitHub write tools (reply to a comment or thread, re-request reviewers, comment) and a poll source for new PR comments. Wright authors the triage playbook from a sentence: an agent reads each comment as untrusted data and classifies it fix / reply / answer. Nothing is preinstalled (D3).
- **Fixes never start a second drain: "Via /automate, never a second drain (Recommended)"**, plus the owner's "the flow should be smart enough to understand if its not automate then how to handle that case", answered with **"Owner-aware routing (Recommended)"**. The kernel tells a playbook who owns a PR:
  - **A live `/automate` run:** leave it to that run's drain.
  - **A parked `/automate` item:** its fix-now or `/review-pr <pr>`.
  - **Not from `/automate`, authored by the owner or the App:** `/review-pr <pr>` in a kernel session (heals, never merges).
  - **Authored by someone else:** reply or answer only, never push to their branch (a fix is suggested in the reply).
- **Polling and dedupe: "Wright proposes, owner sets (Recommended)".** The kernel ships no default (invariant 1). Wright's draft proposes defaults: tickets dedupe on the ticket id (one PR per ticket), comments on comment id plus edit time, a poll every 5 minutes, normal priority. The owner changes any of them before enable.
- **One phase 8 mockup first (D9): "One phase 8 mockup first (Recommended)".** One clickable `docs/design/mockups/phase-8.html` (light and dark, every state) holds the Tasks card, the Jira and ClickUp connect sheets, the App permission upgrade and the repo policy card. The owner approves it by merging its PR, and every UI item depends on it.
- **Live exit run:**
  - **Repo:** the owner: "we already have a throwaway repo: studio-sandbox". It is private on GitHub Free, so GitHub refuses branch protection on it (checked 2026-11-02: 403). The owner chose **"Make studio-sandbox public (Recommended)"** and **"Setup step in the runbook (Recommended)"**: seed a tiny project with one `ci` workflow, the owner flips it public, and protection on `main` requires `ci`.
  - **Walk:** **"Full loop, two policies (Recommended)"**. One GitHub issue and one personal ClickUp task become two PRs through `/automate`; a fix, a question and a remark on one PR are triaged; a reviewer is re-requested; PR A merges through the gate under Solo, and PR B under Approve in Studio. Jira is `not_exercised`. Never `vendsy/*` or any Tray system.
- **Nothing is patched outside an item's Touches.** A lane that needs another file stops and says so.

## Scope

1. **The client's write methods** (`client.ts`, the App's down-scoped token):
   - reply in a review thread;
   - post a PR comment;
   - post an issue comment;
   - request reviewers (`POST /repos/{o}/{r}/pulls/{n}/requested_reviewers`).

   The client's allowlist gains exactly these calls, and each one stays pinned in a test.
2. **The kernel write tools** (`github/write-tools.ts`), each `requiresConnector: "github"` and needing the agent's `write` level:
   - `kernel_github_pr_reply(repo, pr, comment_id, body)`;
   - `kernel_github_pr_comment(repo, pr, body)`;
   - `kernel_github_issue_comment(repo, issue, body)`;
   - `kernel_github_pr_request_reviewers(repo, pr, reviewers[])`.

   Each is an outward call in its `NEVER_CATEGORIES` category (`gh_pr_comment_reply`, `gh_pr_comment`, `gh_issue_comment`, `gh_pr_request_reviewers`): it is held for approval or covered by the owner's per-playbook "always", recorded as a draft in `draft` mode, and denied by `never`. Bodies are model output: stored bounded, never interpreted.
3. **The poll sources** (one file each under `kernel/src/triggers/sources/`):
   - **`github.issues`:** open issues by repo with filters the owner sets (labels, assignee, state). The item id is `<repo>#<number>` and the revision is `updated_at`.
   - **`github.pr_comments`:** new and edited issue comments, review comments and reviews on the repo's open PRs. The item id is the comment id and the revision is `updated_at`. Each item names its PR, author and kind.

   The text is wrapped as untrusted data, as `kernel_github_pr_comments` does. Neither source has a default filter, interval or dedupe key; those are the playbook's (invariant 1).
4. **The dry run** shows each source's items as it shows `github.pulls`.
5. **Docs:** `github-tools.md` (the write tools) and `triggers.md` (the two sources, plus one line linking `mcp-connectors.md` for `jira.issues` and `clickup.tasks`).

## Non-goals

- Ticket sources for Jira and ClickUp (item 07).
- Deciding which comments to answer, which is Wright's playbook.
- Merging (never a kernel tool).

## Acceptance criteria

- [ ] Given a live session whose agent holds `github: write`, when it calls `kernel_github_pr_request_reviewers`, then it is held as an approval naming the PR and reviewers; once the owner allows it, the fake client receives exactly that request.
- [ ] Given a draft playbook session, when it calls `kernel_github_pr_reply`, then a draft output is recorded and nothing is sent.
- [ ] Given an agent with `gh_pr_request_reviewers` in `never`, then the call is denied `agent_boundary`.
- [ ] Given a `github.pr_comments` poll with dedupe on item id and revision, when a comment is edited, then it fires once more; given an unchanged comment, then it is skipped.
- [ ] Given an issue body containing an instruction, then the item reaches the session wrapped as untrusted data.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Depends on
2026-11-02-160001-phase-8-foundation-decisions-contract-seams-and-probes.md

## Touches
kernel/src/integrations/github/client.ts
kernel/src/integrations/github/write-tools.ts
kernel/src/integrations/github/tools.ts
kernel/src/triggers/sources/github-issues.ts
kernel/src/triggers/sources/github-pr-comments.ts
kernel/src/playbooks/dry-run-poll.ts
kernel/test/integrations-github-client.test.ts
kernel/test/integrations-github-write-tools.test.ts
kernel/test/triggers-poll-github-sources.test.ts
docs/architecture/github-tools.md
docs/architecture/triggers.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-04T16:41:29Z
- **Brief:** .supervisor/jobs/done/2026-11-03-github-write-tools-and-poll-sources.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/222
