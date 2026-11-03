# 10 — The PR tracker and owner-aware comment routing

## Status: ready

**Priority:** MVP · ROADMAP phase 8 · invariants 1, 4 · D40 (item 01)

**As** the owner,
**I want** the kernel to track every PR my playbooks touch through its states (approvals against the repo's policy, CI, who owns it), and to tell a triage playbook where a "fix" comment must go,
**so that** Tasks shows each ticket's PR truthfully, and a fix never starts a second drain or pushes to someone else's branch.

## Problem

The `tasks` table has a `links_json` column but nothing fills it with PR state. Nothing reads approvals or CI, nothing knows whether a PR belongs to a live `/automate` run, a parked item, the owner or someone else, and nothing tells a playbook whether `/review-pr` may run for a PR outside `/automate`. The done-when needs "a PR is tracked through its states" and triage that routes fixes correctly.

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

## Scope

1. **The tracker** (`kernel/src/automate/tracker.ts`, due work and on each relevant poll fire). For every PR a playbook opened, or a ticket links to, it fills `pr_tracks`:
   - head SHA;
   - state: `open`, `draft`, `ready` (Loomwright READY), `parked` (with Loomwright's reason), `merged` or `closed`;
   - the ticket ref;
   - approvals `n` and required `N` from item 08's policy (or `solo` / `studio_approval`);
   - CI state from check runs;
   - owner kind;
   - Loomwright run file and item id.

   It reads GitHub with the App token and Loomwright's run files only (D32). Each change appends one `pr_state_changed` event and updates the matching `tasks` row's links (ticket, PR, approvals, CI), creating the task when a ticket first becomes a PR.
2. **`merged_by_gate`.** When a PR is merged, the tracker records whether Loomwright's run file has a gate merge for that PR and head. It is shown, not acted on: the owner chose the playbook-triggers-gate flow, and no audit alert was queued.
3. **`kernel_pr_route(repo, pr)`**, a read-only tool answering:
   - `{route: "automate_drain"}` for a PR a live run owns: record only, leave it to that run;
   - `{route: "automate_fix", item}` for a parked item;
   - `{route: "review_pr"}` for a PR not from `/automate`, authored by the owner or the App;
   - `{route: "reply_only"}` for a PR authored by anyone else.
4. **No fix tool starts a session** (owner decision 2026-11-03). The triage playbook's own live session acts on the route itself:
   - **`automate_fix`:** it runs Loomwright's fix-now or `/review-pr <pr>` for that parked item;
   - **`review_pr`:** it runs `/review-pr <pr>` (heals, never merges);
   - **`automate_drain` and `reply_only`:** it only replies or answers.

   `kernel_pr_route` re-reads the run state on every call, so a run that went live since the last call answers `automate_drain`. The answer's text says so and names the exact command for each route. A `git push` to a branch the route doesn't allow is still held for the owner, as every push is.

5. **Wright's guidance.** The new tools' descriptions name the three triage outcomes and the routing, so Wright can draft the triage playbook from a sentence. Nothing is preinstalled (D3).
6. **The gui `tasks` part** (`kernel/src/gui/tasks.ts`) returns the links and PR fields on `GET /tasks` and the PR's state history on `GET /tasks/:kind/:id`, per item 01's contract.
7. **Docs:** `docs/architecture/automate.md` (tracker and routing).

**Touches traced from the code (2026-11-03, `main` at `20684c8`):** the 2026-11-02 list named only this item's new files. Items 05 and 06 each stopped at Launch Pad because the existing seam files they must edit (where item 01's refusals and empty parts live, and the tests that pin them) were missing. Each shared file below is listed because an acceptance criterion changes it: `automate/index.ts` (the empty `trackerPart` and `routingPart`); `app/src/api/contract.ts` (`TaskBoardItem` has no ticket, PR, approvals, CI or owner field; item 01's contract says a later item adds the shapes it needs) with the e2e fixtures that build `TaskBoardItem` (`app/e2e/fixtures/tasks.ts`, `phase-7-exit.ts`); `brain/templates.ts` (routing guidance); the pins in `gui-tasks.test.ts`, `phase-8-foundation.test.ts`, `console-contract.test.ts`, `tools-sdk-list.test.ts` and `brain.test.ts`.

## Non-goals

- The Tasks card UI (item 11).
- Replying or re-requesting (item 05's tools; Wright's playbook calls them).
- Merging.

## Acceptance criteria

- [ ] Given a fake PR moving open → ready → parked `awaiting_merge` → merged, then `pr_tracks` and the linked task record each state once, with one `pr_state_changed` event each.
- [ ] Given a `reviews: 2` repo with one approving review, then the task's links read approvals 1/2; given a Solo repo, then they read `solo`.
- [ ] Given a PR owned by a live run, then `kernel_pr_route` answers `automate_drain`; given a parked item, then `automate_fix` with Loomwright's fix command for that item.
- [ ] Given a PR by another person, then the route is `reply_only` and no session pushes to it.
- [ ] Given `GET /tasks`, then a ticket-to-PR task carries ticket, PR, approvals, CI and owner kind as the contract declares.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Depends on
2026-11-02-160005-github-write-tools-and-the-issue-and-comment-poll-sources.md
2026-11-02-160009-automate-runner-tickets-to-prs-and-merge-when-ready.md

## Touches
kernel/src/automate/index.ts
kernel/src/automate/tracker.ts
kernel/src/automate/routing.ts
kernel/src/gui/tasks.ts
kernel/src/brain/templates.ts
app/src/api/contract.ts
app/e2e/fixtures/tasks.ts
app/e2e/fixtures/phase-7-exit.ts
kernel/test/automate-tracker.test.ts
kernel/test/automate-routing.test.ts
kernel/test/gui-tasks.test.ts
kernel/test/phase-8-foundation.test.ts
kernel/test/console-contract.test.ts
kernel/test/tools-sdk-list.test.ts
kernel/test/brain.test.ts
docs/architecture/automate.md
