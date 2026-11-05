# 08 — Repo merge policy: detect, propose, one-click accept

## Status: ready

**Priority:** MVP · ROADMAP phase 8 · D4, D40 (item 01), invariants 1, 4

**As** the owner,
**I want** each repo to carry its own merge policy (Solo, Approve in Studio, or N GitHub reviews), proposed by Studio from the repo's real state and accepted in one click,
**so that** a solo repo can merge automatically and a team repo waits for its reviews, without my configuring each playbook.

## Problem

Nothing in the kernel records how a repo's PRs may merge. Loomwright's `--auto-merge` gate reads branch protection and `reviewDecision` itself (conditions 3 and 4), but Studio has to decide whether to ask it to merge at all, and must handle repos where GitHub can't enforce protection: studio-sandbox, private on GitHub Free, answered 403 on 2026-11-02.

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

1. **Detection** (`github/repo-policy.ts`, read-only, App token). It reads:
   - the protection on the default branch (required approving review count and required status checks), with the 403 "upgrade or make public" answer recorded as `protection_unavailable`, a 404 as `unprotected`, and anything else as `unreadable`;
   - the collaborators who can push.

   It stores the reading on `repo_policies.detected_json` with its time.
2. **The proposal**, a pure function from the detection:
   - only the owner can push and checks are required → **Solo**;
   - required reviews ≥ 1 → **N GitHub reviews** with N from GitHub;
   - protection unavailable → no proposal, and the three choices the decision names (make public or upgrade, trust unprotected, safe mode);
   - unprotected with others pushing → **Approve in Studio**.

   The proposal is a suggestion the owner accepts or changes; the kernel never applies it on its own.
3. **Owner routes:**
   - `GET /repos/policy` (every reached repo with detection, proposal and the set policy);
   - `POST /repos/policy/:owner/:repo/detect`;
   - `POST /repos/policy/:owner/:repo` (`{kind: "solo" | "studio_approval" | "reviews", required?, trust_unprotected?}`).

   These are owner-only, with no agent tool: setting a policy is the owner's.
4. **`policyMet(repo, pr, head_sha)`** for items 09 and 10:
   - no policy → `no_policy` (park);
   - Solo → met when CI is green;
   - `studio_approval` → met when the owner approved a held merge approval for that PR at that head SHA;
   - `reviews` → met when GitHub's `reviewDecision` is `APPROVED` with N or more approvals.

   A playbook's own requirement may only add to it (stricter). A playbook asking for less is refused `playbook_looser_than_repo` at enable.
4b. **The playbook's own requirement field.** `merge_requirement` (none / `studio_approval` / `reviews: N`) is a new playbook policy field in `PLAYBOOK_POLICY_FIELDS`. The owner sets it and Wright may only propose it; it is owner-locked like the others, with no default (invariant 1). It is added in the same PR to the contract's playbook policy types and to the app's shared `PlaybookPolicy` editor, because `console-contract.test.ts` pins the editor's fields equal to the kernel's. Item 13 then builds on that editor.
5. **`trust_unprotected`** is recorded with who set it and when, and is passed to Loomwright as `--trust-unprotected` for that repo only.
6. **Docs:** `docs/architecture/repo-policy.md`.

**Touches traced from the code (2026-11-03, `main` at `20684c8`):** the 2026-11-02 list named only this item's new files. Items 05 and 06 each stopped at Launch Pad because the existing seam files they must edit (where item 01's refusals and empty parts live, and the tests that pin them) were missing. Each shared file below is listed because an acceptance criterion changes it: `integrations/index.ts` (the empty `repoPolicyPart` is defined there, so filling it edits that file); `integrations/github/client.ts`, `integrations/types.ts` and `test/fixtures/github-fake.ts` (the `GitHubClient` gains the branch-protection and collaborators reads); the playbook's own stricter requirement is a new playbook policy field, so `playbooks/types.ts`, `store.ts` (`PLAYBOOK_POLICY_FIELDS`), `drafts.ts` (Wright's draft fields) and `enable.ts` (`playbook_looser_than_repo`); `console-contract.test.ts` pins the app editor's `POLICY_FIELDS` equal to `PLAYBOOK_POLICY_FIELDS`, so the app's `PlaybookPolicy` editor and the contract gain the field in the same PR; `console-contract.test.ts` and `phase-8-foundation.test.ts` pin the three `p8-item-08` routes as not served and the part as empty. Depends on 05 (which edits `client.ts`, `types.ts` and the fake first) and 06 (which edits `integrations/index.ts` first).

## Non-goals

- Changing GitHub branch protection (the owner does it on GitHub; Studio links there).
- The policy card UI (item 12).
- Merging (Loomwright's gate only).

## Acceptance criteria

- [ ] Given the fake GitHub answers 403 `protection_unavailable` for a private repo, then detection records it and the proposal offers exactly make public or upgrade, trust unprotected and safe mode, with none picked.
- [ ] Given protection requiring 2 reviews, then the proposal is "2 GitHub reviews"; given only the owner pushes and `ci` is required, then it is "Solo".
- [ ] Given no policy set, then `policyMet` answers `no_policy`.
- [ ] Given `reviews: 2` and one approval, then `policyMet` is false; at two, true; after a new push (head moved), it re-reads.
- [ ] Given a playbook whose own requirement is looser than its repo's, then its enable is refused `playbook_looser_than_repo`.
- [ ] Given an agent session, then no tool sets or changes a repo policy.
- [ ] Given `PLAYBOOK_POLICY_FIELDS` with `merge_requirement`, then the app editor shows it and `console-contract.test.ts`'s field pin passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Depends on
2026-11-02-160005-github-write-tools-and-the-issue-and-comment-poll-sources.md
2026-11-02-160006-mcp-connector-mechanism-with-oauth.md

## Touches
kernel/src/integrations/github/repo-policy.ts
kernel/src/integrations/github/repo-policy-routes.ts
kernel/src/integrations/github/client.ts
kernel/src/integrations/types.ts
kernel/src/integrations/index.ts
kernel/src/playbooks/types.ts
kernel/src/playbooks/store.ts
kernel/src/playbooks/drafts.ts
kernel/src/playbooks/enable.ts
app/src/api/contract.ts
app/src/components/PlaybookPolicy/PlaybookPolicy.tsx
app/src/components/PlaybookPolicy/PlaybookPolicy.test.tsx
kernel/test/integrations-github-repo-policy.test.ts
kernel/test/integrations-github-client.test.ts
kernel/test/fixtures/github-fake.ts
kernel/test/console-contract.test.ts
kernel/test/phase-8-foundation.test.ts
kernel/test/integrations-foundation.test.ts
kernel/test/playbooks-drafts.test.ts
kernel/test/playbooks-foundation.test.ts
docs/architecture/repo-policy.md
docs/architecture/playbooks.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-11-05T03:30:12Z
- **Brief:** .supervisor/jobs/done/2026-11-04-repo-merge-policy-detect-and-propose.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/226
