# 09 — The /automate runner: tickets to PRs in kernel sessions, and "merge when ready" through Loomwright's gate

## Status: ready

**Priority:** MVP · ROADMAP phase 8 · invariants 2, 3, 4 · D32, D40 (item 01)

**As** the owner,
**I want** a playbook to hand tickets to Loomwright's `/automate` in a kernel-owned session, and an opt-in playbook to have Loomwright merge a ready PR through its own gate once the repo's policy is met,
**so that** tickets become PRs and merge with Studio owning the lifecycle, while the merge itself stays Loomwright's.

## Problem

Nothing in the kernel starts `/automate`, turns a ticket into something `/automate` can read, or asks Loomwright to merge. Invariant 4 forbids the kernel merging or working around `/automate`'s single-drain ownership. Item 01's probes record the facts this item builds on:
- **p15:** `/automate --inline-phases` in an SDK session;
- **p14:** the invocation that merges one parked item through the gate.

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

1. **`kernel_automate_run(repo, tickets[])`,** a kernel tool for a live playbook session whose agent holds `github: write`. It:
   - writes one requirement item per ticket into the repo checkout's `.supervisor/requirements/studio/` (gitignored by Loomwright). Each item carries the ticket's title and link, its body quoted as untrusted data, and the dedupe ref, plus a `_BACKLOG` naming them;
   - starts **one** kernel session (the playbook's agent, Loomwright in host mode, cwd the repo checkout outside a protected folder per D31) whose prompt runs `/automate --backlog <that file> --inline-phases`, in **safe mode** (no `--auto-merge`), with the playbook's model and the agent's limits.

   The workspace is the agent's configured workspace for that repo; it is refused `no_workspace` without one.
2. **Single drain.** Before starting, the runner reads Loomwright's structured run state for that checkout (run files and locks, never prose; D32). A live `/automate` run there refuses `automate_run_live`, and the tickets wait for the next fire. Never `--parallel`.
3. **`kernel_automate_merge_item(repo, pr)`,** for the owner's opt-in "merge when ready" playbook:
   - **Checks first:** the item is parked `awaiting_merge` at the PR's current head (Loomwright's run file); no run is live on that checkout; and `policyMet` (item 08). `no_policy` refuses and the PR stays parked.
   - **Approve in Studio:** first records a held approval (repo, PR, head SHA, CI, Loomwright's READY). The owner's allow is for that head SHA only, so a new push needs a new approval.
   - **Then** it starts one kernel session that runs p14's invocation for that one item with `--auto-merge`, plus `--trust-unprotected` only when the repo's policy records it.

   The kernel itself never calls a merge API, and `gh pr merge` stays `merge_blocked` in every session. Loomwright's seven conditions decide. A park is reported as Loomwright reports it.
4. **Stop and Kill:** these sessions are ordinary kernel sessions (Sessions screen, Stop / Kill, budget, cap parking, the kill switch). A killed run resumes through Loomwright's own smart resume on the next fire, never by the kernel editing run files.
5. **Docs:** `docs/architecture/automate.md` (runner and merge-item).

## Non-goals

- Tracking PR state, routing comments, starting fixes (item 10).
- Writing the playbooks (Wright authors them from the owner's sentence; none ships, D3).
- Lanes or `--parallel`.

## Acceptance criteria

- [ ] Given a live playbook session calling `kernel_automate_run` with two fake tickets, then two requirement items and one backlog exist in the checkout, ticket bodies quoted as untrusted data, and one kernel session runs `/automate --backlog … --inline-phases` with no `--auto-merge`.
- [ ] Given Loomwright reports a live run on that checkout, then the call is refused `automate_run_live` and no session starts.
- [ ] Given a parked item on a Solo repo with CI green, when `kernel_automate_merge_item` runs, then one session runs p14's invocation with `--auto-merge` and no kernel merge call is made.
- [ ] Given an Approve in Studio repo, then a held merge approval names the head SHA; after a new push, the old approval does not authorize the merge.
- [ ] Given no repo policy, then the call is refused `no_policy` and nothing starts.
- [ ] Given a running `/automate` session, when the owner presses Kill, then it stops like any session, and the next fire resumes it through Loomwright.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Risks

- **p14 may show that a Loomwright change is needed.** This item then waits on it (another repo, Loomwright's release).
- **`/automate` may ask the owner a question** (`AskUserQuestion`). p15 records how it surfaces in an SDK session; it must reach the owner as a held approval or a thread message, never hang.

## Depends on
2026-11-02-160004-live-mode-and-github-write-in-sessions.md
2026-11-02-160008-repo-merge-policy-detect-and-propose.md

## Touches
kernel/src/automate/runner.ts
kernel/src/automate/merge-item.ts
kernel/src/automate/run-state.ts
kernel/src/automate/tickets-to-items.ts
kernel/test/automate-runner.test.ts
kernel/test/automate-merge-item.test.ts
kernel/test/fixtures/loomwright-run-files/
docs/architecture/automate.md
