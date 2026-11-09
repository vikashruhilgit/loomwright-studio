# 09 — The /automate runner tools: tickets to PRs in the playbook's own session, and "merge when ready" through Loomwright's gate

## Status: done
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/237

**Priority:** MVP · ROADMAP phase 8 · invariants 2, 3, 4 · D32, D40 (item 01)

**As** the owner,
**I want** a live playbook's own session to hand tickets to Loomwright's `/automate`, and an opt-in playbook to have Loomwright merge a ready PR through its own gate once the repo's policy is met,
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

## Owner decisions (2026-11-03, binding)

Recorded 2026-11-03 in the phase 8 product-owner Touches re-trace (AskUserQuestion). Tracing item 09 against `main` at `20684c8` showed that a kernel tool can't start a session. Sessions start only from the event loop (the closed `EVENT_KINDS`, `message` and `wakeup`), and an approval decision only enqueues a `message` to the agent (`kernel/src/approvals/store.ts`), which runs as a plain agent session with no playbook and so no GitHub token. The owner chose **"The playbook's own session runs it (Recommended)"**:
- **No new session machinery.** The live playbook's own run session runs `/automate --backlog … --inline-phases` (safe mode) itself. That session is already kernel-owned, has Loomwright loaded and has the token injected.
- **Kernel tools only help and check.** They write the ticket items, read Loomwright's run state (single drain; Loomwright's own run lock also refuses a second run), check the repo policy, and record a held merge approval that the merge-when-ready playbook reads on its next fire.
- **Fixes and `/review-pr` run the same way,** in the triage playbook's own session.
- **The owner's 2026-11-02 choices are unchanged.**

## Owner decisions (2026-11-05, binding)

The bot's review of wave PR #227 (item 08) found a fail-open bug in `getPullMergeState` after item 08's drain had ended READY. The owner chose to merge #227 as is, with this item taking the fix ("Merge, fix in item 09"), because item 09 is what makes `policyMet` a merge condition. No code called `policyMet` when this was recorded. See Scope 8.

## Scope

**Gate first.** Probes p14 and p15 (item 01) must have a recorded answer in `docs/OPEN_QUESTIONS.md`. On 2026-11-03 both still read "Not yet run". If either is unrecorded, or p14 answers that Loomwright has no supported single-item merge, stop at Launch Pad and say so; build nothing.

Every tool below is called by a **live playbook's own run session**, which the kernel already owns (Stop / Kill, budget, the cap, the kill switch and the approval gate apply), whose agent holds `github: write` (so the session has the down-scoped token, item 04), and which runs Loomwright's commands itself. No tool starts a session.

1. **`kernel_automate_prepare(repo, tickets[])`.** For each ticket the kernel writes one requirement item into the repo checkout's `.supervisor/requirements/studio/` (the agent's workspace for that repo, outside protected folders per D31; refused `no_workspace` without one), plus a `_BACKLOG` naming them. Each item carries the ticket's title, link and dedupe ref, with its body quoted as untrusted data. The answer is the backlog path and the exact invocation the session should run: `/automate --backlog <path> --inline-phases`, safe mode, no `--auto-merge`, no `--parallel`.
2. **`kernel_automate_state(repo)`, read-only.** Loomwright's structured run state for that checkout (run files, run lock, each item's state and its PR), read from the place p15 records: the repo or the host-mode state dir. It answers `live` (with its run id), `parked` (items with reason and PR) or `idle`. A playbook is told not to start a run while one is `live`; Loomwright's own run lock refuses a second run in any case (single drain, invariant 4).
3. **`kernel_automate_merge_check(repo, pr)`, read-only.** It answers `go` with p14's exact single-item invocation (plus `--trust-unprotected` only when the repo's policy records it), or `wait` / `park` with the reason. It answers `go` only when:
   - the item is parked `awaiting_merge` at the PR's current head;
   - no run is live;
   - `policyMet` (item 08) holds. For `studio_approval`, that means an approved merge approval exists for that PR at that head SHA.
4. **`kernel_merge_approval_request(repo, pr, head_sha)`,** always held (`ALWAYS_HELD_TOOLS`), never covered by an "always" grant. Its payload is repo, PR, head SHA, CI state and Loomwright's READY time. The approval is only a record: the decision's message to the agent does nothing by itself, and the merge-when-ready playbook's next fire sees it through `kernel_automate_merge_check`. A new push makes it stale.
5. **The merge itself is Loomwright's.** The kernel never calls a merge API, and `gh pr merge` stays `merge_blocked` in every session. Loomwright's seven gate conditions decide, and a park is reported as Loomwright reports it.
6. **Wright's guidance** (`brain/templates.ts`) names these tools and the two playbook shapes they serve (tickets → `/automate`, merge when ready), so Wright can draft them from a sentence. Nothing is preinstalled (D3).
7. **Docs:** `docs/architecture/automate.md` (runner and merge check) and `approvals.md` (the merge approval).
8. **Fix `getPullMergeState` before `merge_check` relies on it (owner decision 2026-11-05).** In `kernel/src/integrations/github/client.ts`, each reviewer's latest review is kept by login (`latest.set(rev.login, rev)`), and `loginOf` reads every deleted account (`user: null`) as `ghost`. So a later review from one deleted account overwrites another deleted account's `CHANGES_REQUESTED`, and `changes_requested` reads false, against the function's own rule that a change request from anyone blocks. Give each deleted reviewer its own entry, so that reviews with no account never collapse into one. Do not change how `loginOf` reads an author elsewhere (tests pin `ghost`). Unverified: whether GitHub really returns `user: null` on PR reviews; the fix must hold either way.
   **Also decide, and record in the PR body:** `getPages` stops at `maxPages`. Per item 08's dismissed LOW finding, it returns ok with truncated data past 10×100 items, so `getPullMergeState` could miss a late `CHANGES_REQUESTED` or a failing check run. Check that against the code, then either make this read fail closed or state why it can stay. This is item 09's call because `merge_check` is the first thing to depend on the answer.
9. **A filed merge approval must satisfy the kernel's own read (owner decision 2026-11-05).** Item 08's `hasMergeApproval` (`kernel/src/integrations/github/repo-policy.ts`) reads `repo`, `pr` and `head_sha` only from the payload's top level. Item 13's merge card (`kernelFields` in `app/src/screens/approvals/subject.ts`) accepts them at the top level or nested under `payload.input`. So if `kernel_merge_approval_request` files the rail's nested `{tool, input, cwd}` shape, the owner sees a normal card and "Allow once" never satisfies `policyMet`: a merge that silently never happens. Check which shape the rail really files, then make the two agree: file those fields at the top level, or have `hasMergeApproval` read the shape actually filed. Do not loosen `hasMergeApproval` to accept both shapes without a reason recorded in the PR body.

**Touches traced from the code (2026-11-03, `main` at `20684c8`):** the 2026-11-02 list named only this item's new files. Items 05 and 06 each stopped at Launch Pad because the existing seam files they must edit (where item 01's refusals and empty parts live, and the tests that pin them) were missing. Each shared file below is listed because an acceptance criterion changes it: `automate/index.ts` (the empty `runnerPart` is defined there); `sessions/policy.ts` (`ALWAYS_HELD_TOOLS`: the merge-approval tool is always held, never covered by an always grant); `brain/templates.ts` (Wright's tool guidance names the new tools); the pins in `phase-8-foundation.test.ts` (part empty), `tools-sdk-list.test.ts`, `brain.test.ts` and `sessions-policy.test.ts`.

## Non-goals

- Tracking PR state, routing comments (item 10).
- Writing the playbooks (Wright authors them from the owner's sentence; none ships, D3).
- A new event kind, or a tool or approval that starts a session (owner decision 2026-11-03).
- Lanes or `--parallel`.

## Acceptance criteria

- [ ] Given p14 or p15 has no recorded answer in OPEN_QUESTIONS, then the item stops at Launch Pad and builds nothing.
- [ ] Given a live playbook session calling `kernel_automate_prepare` with two fake tickets, then two requirement items and one backlog exist in the checkout, ticket bodies quoted as untrusted data, and the answer's invocation carries `--inline-phases` and no `--auto-merge`.
- [ ] Given a fixture run file showing a live run, then `kernel_automate_state` answers `live` and `kernel_automate_merge_check` answers `wait`.
- [ ] Given a parked item on a Solo repo with CI green, then `kernel_automate_merge_check` answers `go` with p14's invocation, and nothing in the kernel calls a merge API.
- [ ] Given an Approve in Studio repo, then `kernel_merge_approval_request` is held with the head SHA; once approved, `merge_check` answers `go` for that head and `wait` after a new push.
- [ ] Given no repo policy, then `merge_check` answers `park: no_policy`.
- [ ] Given a session of a draft playbook, or of an agent without `github: write`, then the tools are not listed or are refused.
- [ ] Given two reviews with `user: null` on one PR, the earlier `CHANGES_REQUESTED` and the later `APPROVED`, then `getPullMergeState` answers `changes_requested: true` and `policyMet` answers `met: false`, and a test pins it.
- [ ] Given a merge approval filed through the real `kernel_merge_approval_request` path (not a hand-built row) and approved, then `policyMet` answers `met: true` for that repo, PR and head on a `studio_approval` repo, and `met: false` after a new push, and a test pins it.
- [ ] Given the `getPages` truncation question in Scope 8, then the PR body records the decision and its reason, and a fail-closed choice has a test.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Risks

- **p14 may show that a Loomwright change is needed.** This item then waits on it (another repo, Loomwright's release).
- **The kernel can't make a session use the right flags.** The playbook session invokes `/automate` itself, so the kernel can't force `--inline-phases` or forbid `--auto-merge`. `merge_check` and Loomwright's own gate are the guard. Recorded in OPEN_QUESTIONS as a known limit.
- **`/automate` may ask the owner a question.** p15 records how its `AskUserQuestion` surfaces in an SDK session; it must reach the owner, never hang.

## Depends on
2026-11-02-160004-live-mode-and-github-write-in-sessions.md
2026-11-02-160008-repo-merge-policy-detect-and-propose.md

## Touches
kernel/src/automate/index.ts
kernel/src/automate/runner.ts
kernel/src/automate/run-state.ts
kernel/src/automate/tickets-to-items.ts
kernel/src/automate/merge-check.ts
kernel/src/sessions/policy.ts
kernel/src/brain/templates.ts
kernel/src/integrations/github/client.ts
kernel/src/integrations/github/repo-policy.ts
kernel/test/integrations-github-client.test.ts
kernel/test/integrations-github-repo-policy.test.ts
kernel/test/automate-runner.test.ts
kernel/test/automate-merge-check.test.ts
kernel/test/fixtures/loomwright-run-files/
kernel/test/phase-8-foundation.test.ts
kernel/test/tools-sdk-list.test.ts
kernel/test/brain.test.ts
kernel/test/sessions-policy.test.ts
docs/architecture/automate.md
docs/architecture/approvals.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-09T03:19:36Z
- **Brief:** .supervisor/jobs/done/2026-11-09-automate-runner-tickets-prs-merge-ready.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/237
