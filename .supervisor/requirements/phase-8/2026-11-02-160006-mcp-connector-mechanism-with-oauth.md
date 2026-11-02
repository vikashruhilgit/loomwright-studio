# 06 — The MCP connector mechanism: OAuth 2.1 connect, Keychain tokens, per-agent tool grants

## Status: ready

**Priority:** MVP · ROADMAP phase 8 · D12, D38 (item 01), invariants 3, 5, 6

**As** the owner,
**I want** to connect a hosted MCP server (Jira's or ClickUp's) the way Claude desktop does, with a browser consent and tokens in the Keychain, and to grant each crew member only the tools I choose,
**so that** tickets from those trackers can reach my playbooks without a token I paste, and no agent gets more than I grant.

## Problem

Studio has one connector, GitHub, with its own token and App paths. Jira's and ClickUp's official servers are hosted MCP servers that take OAuth 2.1 only (ClickUp accepts no API key; Atlassian's consent is per site). Studio has no MCP client connector, no OAuth flow and no per-tool grant.

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

1. **A generic MCP connector** (`kernel/src/integrations/mcp/`). A connector definition is a kind, a server URL and a display name; phase 8's are `jira` (`https://mcp.atlassian.com/v1/mcp`) and `clickup` (`https://mcp.clickup.com/mcp`), filled by item 07.
2. **The OAuth 2.1 connect,** following the MCP authorization spec:
   - discover the server's authorization metadata;
   - dynamic client registration where the server offers it;
   - authorization code with PKCE, a loopback redirect `http://127.0.0.1:<port>` and a single-use `state`, through the same short-lived, one-at-a-time setup window D36 uses;
   - open the system browser;
   - store the access and refresh tokens in the Keychain (`loomwright-studio-mcp-<kind>`), never in a row, event or log;
   - refresh before expiry, and mark the connection `expired` when refresh fails.

   Owner routes: `POST /connectors/mcp/:kind/connect`, `POST /connectors/mcp/:kind/connect/cancel`, `POST /connectors/mcp/:kind/disconnect`, and `GET /connectors` lists them.
3. **The tool list.** After connect, the kernel lists the server's tools and stores their names on the `mcp_connections` row.
4. **The per-agent grant:** `connectors: {jira: [tool names]}`, set only by the owner (`POST /agents/:id/set`, `studio agents set`). A session's `kernel` server proxies **only the granted tools** of that server, through `toolsForConnectors`. The session never holds the token; the kernel makes the MCP call. Every tool result is wrapped as untrusted data.
5. **Writes.** A granted tool the server marks as non-read-only (MCP `readOnlyHint` false, or no hint) is an outward call: held for approval, recorded in draft mode, denied by `never` (`mcp_write`). Phase 8 grants only read tools in the live run.
6. **Tests** run against a fake MCP server with a fake authorization server (`kernel/test/fixtures/mcp-fake.ts`), which never reaches the network.
7. **Docs:** `docs/architecture/mcp-connectors.md`.

## Non-goals

- Jira or ClickUp specifics and their ticket sources (item 07).
- The connect UI (item 12).
- A general "add any MCP server" screen (later).
- A claude.ai sign-in (never, invariant 6).

## Acceptance criteria

- [ ] Given the fake server, when the owner starts the connect, then the kernel opens one setup window, the browser return with a matching `state` stores the tokens in the Keychain, and the row reads `connected` with the server's tool names; a second use of the same `state` is refused.
- [ ] Given a session of an agent granted one tool, then its tool list carries exactly that tool, and a call to another tool on that server is unavailable.
- [ ] Given a tool without `readOnlyHint: true`, when a session calls it, then it is held for approval (or recorded in draft mode).
- [ ] Given a refresh failure, then the row reads `expired`, the owner is notified, and polls that need it are skipped `connector_missing`.
- [ ] Given any event, row or log written during connect or call, then no token appears in it.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Risks

- ClickUp's server is in beta. A user report (December 2025) named a mismatch in its OAuth metadata, unconfirmed whether it was fixed.
- Atlassian's endpoint path changed in 2026 (`/v1/sse` ended 2026-06-30).

## Depends on
2026-11-02-160001-phase-8-foundation-decisions-contract-seams-and-probes.md

## Touches
kernel/src/integrations/mcp/connector.ts
kernel/src/integrations/mcp/oauth.ts
kernel/src/integrations/mcp/client.ts
kernel/src/integrations/mcp/routes.ts
kernel/src/integrations/mcp/tools.ts
kernel/src/integrations/tool-filter.ts
kernel/test/integrations-mcp-connector.test.ts
kernel/test/integrations-mcp-oauth.test.ts
kernel/test/fixtures/mcp-fake.ts
docs/architecture/mcp-connectors.md
