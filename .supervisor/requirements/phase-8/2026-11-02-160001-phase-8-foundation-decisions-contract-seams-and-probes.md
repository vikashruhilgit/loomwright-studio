# 01 — Phase 8 foundation: decisions, contract, seams, stubs and the two probes

## Status: ready

**Priority:** MVP (foundation) · ROADMAP phase 8 · D3, D4, D5, D12, D32, D36

**As** the owner,
**I want** phase 8's decisions recorded, its contract and kernel seams declared with stubs and refusals, and its two unverified claims probed,
**so that** every later item edits only its own module and the build never rests on an unverified assumption.

## Problem

Phase 8 (ROADMAP: "Acceptance test 2: tickets → PRs → 2 approvals, run through Loomwright `/automate`") needs things the kernel refuses or doesn't have. Checked 2026-11-02 at `main` `a0db691` against Loomwright 17.26.0:
- **The connector kinds.** `CONNECTOR_KINDS` is `["github"]` (`kernel/src/integrations/types.ts:16`).
- **The poll sources.** `POLL_SOURCES` lists only `github.pulls` (`kernel/src/triggers/poll.ts:63`).
- **The playbook mode.** `live` is refused `live_mode_not_in_phase_6` (`kernel/src/playbooks/store.ts:68`).
- **The App's permissions.** The App is read-only (D36), and the client allows only GET plus two POSTs.
- **`gh` in sessions.** A session with the `github` grant may not run `gh` (`use_kernel_github_tools`), and sessions get no GitHub token.
- **The repo merge policy.** None exists.
- **The kernel side of `/automate`.** No feature runs `/automate` or reads its run files.

Two claims are unverified:
- **(a)** that Loomwright can merge **one parked `awaiting_merge` item** through its `--auto-merge` gate when re-entered for it, then reconcile and finish the item;
- **(b)** that `/automate --inline-phases` runs to a PR inside an Agent SDK session the kernel starts (Loomwright in host mode, `settingSources: []`), including the `AskUserQuestion` it may raise.

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

1. **DECISIONS.md.** Add new entries, each superseding only what it names:
   - **(D38) MCP connectors with OAuth 2.1.**
   - **(D39) The App's permissions and session tokens.** The App holds every repository permission; supersedes D36's "Read-only still" for the App only. Session tokens are down-scoped (PRs, Contents, Issues, Checks) and injected only into live sessions with a write grant.
   - **(D40) The repo merge policy and the merge flow.** Per repo, a playbook may only be stricter, detect and propose, trust-unprotected per repo, `/automate` in safe mode, and the "merge when ready" playbook triggering Loomwright's gate. It **restates invariant 4**: the kernel never merges.

   Fix `CLAUDE.md`'s stale "the next step is phase 1" line.
2. **ROADMAP phase 8 row:** the done-when becomes "A PR is tracked through its states; comments are triaged (fix / reply / answer); reviewers are re-requested; merges once the repo's approval policy is met, only through the gated path".
3. **Closed sets grow, each refused until its item lands:**
   - `CONNECTOR_KINDS` gains `jira` and `clickup`;
   - `POLL_SOURCES` gains `github.issues`, `github.pr_comments`, `jira.issues` and `clickup.tasks`;
   - `NEVER_CATEGORIES` gains `gh_pr_request_reviewers` and `gh_pr_comment_reply`;
   - the GitHub grant gains a `write` level (refused `github_write_not_built`).
4. **A source-adapter seam.** `poll.ts` dispatches each source to `kernel/src/triggers/sources/<source>.ts`, so each later item adds one file. `github.pulls` moves into one with no behaviour change.
5. **Migration 020.** Each later item fills its own table or columns:
   - `repo_policies` (repo, policy kind, required reviews, trust_unprotected, detected_json, set_by, set_at);
   - `pr_tracks` (repo, number, head sha, state, ticket ref, approvals, required, CI state, owner kind, run file, item id, merged_by_gate, updated);
   - `mcp_connections` (kind, server url, status, granted tools, token expiry).

   Each value set is checked in code, as before.
6. **A new `automate` feature** (`kernel/src/automate/index.ts`): an empty contribution with parts `runner`, `tracker` and `routing`, registered after `gui`. Add the integrations parts `mcp` and `repo-policy`, each empty.
7. **The app contract** (`app/src/api/contract.ts`): every new shape and route, listed as `p8-item-NN`. `console-contract.test.ts` pins them by origin. Default empty answers in `app/e2e/fixture-kernel.ts`.
8. **ARCHITECTURE.md "Phase 8 features"**, with one page stub each: `docs/architecture/automate.md`, `repo-policy.md` and `mcp-connectors.md`. UI.md gets a note on phase 8's Tasks card and Integrations.
9. **Probes (the owner runs them, or the agent with the owner's word, D33):**
   - **`probes/p14-loomwright-merge-one-parked-item.md`:** on studio-sandbox, does re-entering `/automate` for one parked item with `--auto-merge` merge it through the gate and check it off? Record the exact invocation, or that it needs a Loomwright change.
   - **`probes/p15-automate-inline-in-sdk-session.mjs`:** `/automate --inline-phases` in a kernel-like SDK session to one PR.

   Record both in OPEN_QUESTIONS. **If p14 shows no supported entry point, stop and report:** the merge flow then needs a Loomwright change (that repo), and items 09 and 14 wait on it.

## Non-goals

- Any behaviour: connectors, tools, the runner, the tracker or the policy (later items).
- The mockup (item 02).

## Acceptance criteria

- [ ] Given DECISIONS.md, then D38–D40 exist, each naming what it supersedes, and D40 states that the kernel never merges.
- [ ] Given a playbook with `mode: live`, a poll on a new source, a `jira`/`clickup` connector or a `write` GitHub grant, then each is refused with its named code until its item lands.
- [ ] Given `github.pulls` polls, then their behaviour and tests are unchanged after the source-adapter move.
- [ ] Given `console-contract.test.ts`, then every `p8-item-NN` route is pinned by origin and none is reported as served.
- [ ] Given probes p14 and p15, then OPEN_QUESTIONS records each one's run, date and answer; a "no" on p14 is reported to the owner before item 09 starts.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- `bash scripts/check-docs.sh`

## Risks

- p14 may show that Loomwright has no single-item merge entry point. That's a Loomwright change, outside this repo.

## Depends on
none

## Touches
CLAUDE.md
docs/DECISIONS.md
docs/ROADMAP.md
docs/ARCHITECTURE.md
docs/UI.md
docs/OPEN_QUESTIONS.md
docs/architecture/automate.md
docs/architecture/repo-policy.md
docs/architecture/mcp-connectors.md
probes/p14-loomwright-merge-one-parked-item.md
probes/p15-automate-inline-in-sdk-session.mjs
kernel/src/integrations/types.ts
kernel/src/integrations/index.ts
kernel/src/triggers/poll.ts
kernel/src/triggers/sources/github-pulls.ts
kernel/src/sessions/policy.ts
kernel/src/playbooks/store.ts
kernel/src/agents/settings.ts
kernel/src/automate/index.ts
kernel/src/features/index.ts
kernel/src/store/migrations/020_phase_8_foundation.ts
kernel/src/store/migrations/index.ts
kernel/test/phase-8-foundation.test.ts
kernel/test/console-contract.test.ts
kernel/test/feature-seams.test.ts
app/src/api/contract.ts
app/e2e/fixture-kernel.ts
