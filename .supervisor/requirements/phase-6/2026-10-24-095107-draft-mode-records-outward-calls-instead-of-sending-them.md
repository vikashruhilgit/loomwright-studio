# 07 — Draft mode: the kernel records an outward call as a draft output instead of sending it

## Status: ready

**Priority:** MVP · ROADMAP phase 6 ("in draft mode (no posting)") · D5, invariants 1, 3, 4

**As** the owner,
**I want** a playbook in `draft` mode to have every outward call its session makes denied without asking me, with the would-be post stored for me to read,
**so that** I can judge the duty's real reviews before anything is ever sent, and no instruction (planted or not) can make it post.

## Problem

There is no draft mode. Two mechanisms exist, and neither keeps the would-be review:
- **A crew member's `never` list.** `NEVER_CATEGORIES` (`kernel/src/sessions/policy.ts:218-233`) includes `gh_pr_comment`, `gh_pr_review` and `gh_api_write`, denied as `agent_boundary`.
- **The rail's default hold.** It holds `gh pr create|comment|review|edit|close` and non-GET `gh api` for approval (`docs/architecture/approvals.md:18-40`; `policy.ts:199-208`, :283-287, :389-400).

Item 01 passes the session's playbook `mode` and its agent's `connectors` into the policy input, and creates `draft_outputs`. The policy ignores both. Sessions of granted agents can still run `gh`, whose output is raw (item 06's Problem).

## Owner decisions (2026-10-24, binding)

Recorded 2026-10-24 in the phase 6 product-owner session, over four rounds of AskUserQuestion plus one on the mockup. The owner chose the proposed option every time. Each item carries this copy. D3, D4, D5, D8, D9, D12, D22, D27, D34 and invariants 1–9 stay as they are. Phase 5's own decisions (in its items) still hold.

- **Sequencing: write phase 6 now; phase 5's live exit is still owed.** Phase 5 is code-complete (#101–#124) but has not been exit-verified (`docs/OPEN_QUESTIONS.md:112` unticked, no `docs/evidence/phase-5-exit-live-*.json`). Run phase 6 only after that live run passes. Any findings from it land first, as phase-5 items.
- **The Integrations screen is phase 6, GitHub only.** The ROADMAP row wins over UI.md and DESIGN.md, which list Integrations under GUI v2. Phase 6 builds the real screen with GitHub as its only connector: connect, disconnect, scopes, expiry, status, reachable repos. Phase 7 adds polish and the other connectors. UI.md and DESIGN.md get a note recording this.
- **Mockup first (D9).** A design item adds the Integrations screen to the mockup source in `docs/design/`, light and dark, with every designed state (not connected, connecting, connected, token rejected, expiring, kernel unreachable) and the Connect sheet. The owner approves it on its PR. The screen item depends on it, and its polish gate matches that mockup.
- **Credential = Studio's own token in the Keychain.** The owner creates a fine-grained, read-only personal access token limited to the personal repos they choose. It's stored as the Keychain item `loomwright-studio-github`, and the kernel strips any inherited `GH_TOKEN` / `GITHUB_TOKEN` from every child environment. Studio never runs an OAuth flow and never reuses the `gh` CLI's login.
- **Token entry = paste in the app.** The Integrations screen's Connect GitHub sheet has a secure field. The Electron main process sends the token straight to a new kernel owner route. The kernel validates it against GitHub, writes the Keychain item and never returns or logs the token. The renderer clears the field at once. A terminal fallback, `studio connectors github set`, reads the token from stdin and does the same.
- **Write-scoped tokens are refused in phase 6.** The kernel accepts only a token whose permissions are all read-only, and says exactly which permission to drop. Phase 8's live posting revisits this.
- **PRs arrive through a kernel `poll` trigger.** It's a new generic trigger kind: the kernel itself fetches a source (in phase 6, GitHub open PRs on repos the user chose) at the interval the user set. Each item (PR) becomes its own playbook run. New dedupe-key fields `item.id` and `item.revision` (for a PR, its head SHA) are evaluated per item, so an unchanged PR is skipped as `skipped_duplicate` under the key the user set. The PR's text reaches the agent wrapped as `<untrusted-data source="github:<owner>/<repo>#<n>">`.
- **Poll floor = 60 s plus rate-limit backoff (mechanism).** The kernel refuses intervals under 60 s. It reads GitHub's rate-limit headers and backs off on 403 or 429, recording why. A poll that finds nothing new starts no session and spends no tokens. Everything else (interval, repos, filters) is the user's policy (D4).
- **Repos are chosen in the poll trigger.** Each playbook's poll lists its repos and filters (state, draft, author), and Wright proposes them from the user's sentence. The Integrations screen shows which repos the token can reach, and the kernel refuses a poll naming a repo outside that set.
- **GitHub access is a per-agent grant.** A new owner-set field, `connectors: ["github"]`, goes in `config/agents/<id>.json` (the enforced part, which no session can write; D34). Only sessions of an agent with the grant get the GitHub tools. A playbook on an agent without the grant parks with "needs GitHub" (DESIGN.md §6).
- **PR reads go only through kernel tools.** Read-only kernel MCP tools (`kernel_github_pr_get`, `kernel_github_pr_diff`, `kernel_github_pr_files`, `kernel_github_pr_comments`) fetch with Studio's token and return everything wrapped as untrusted data. The `gh` binary is unavailable to sessions of agents with the GitHub grant, so no raw PR text reaches the model unwrapped.
- **Draft mode = a per-playbook `mode: draft | live`.** The user sets it and Wright only proposes it. It defaults to `draft`. Under `draft` the kernel denies, without asking, every outward call the session makes (`gh pr comment|review`, non-GET `gh api`, any GitHub write). It stores the call's payload as a **draft output**, which the owner reads as a card in the agent's thread, and nothing is sent. `live` is not built in phase 6: setting it is refused with a clear message.
- **A poll playbook's dry run shows one real PR.** The dry run polls the source once, without recording dedupe keys, and shows which PRs would run or be skipped and under which key. It then reviews one real PR through the read-only kernel tools, forced into draft mode, so the owner sees the actual would-be review before enabling.
- **One sentence builds the duty.** From one sentence (e.g. "review every open PR on studio-sandbox when it changes, draft only"), Wright drafts the playbook with its poll trigger, dedupe key and mode. If no fitting crew member exists, it also drafts a comment-only reviewer charter with the GitHub grant proposed. The owner approves the charter and the enable, and Wright only proposes every value (D4).
- **Exit repo = a throwaway private sandbox repo.** The owner creates a private personal repo (e.g. `vikashruhilgit/studio-sandbox`). The runbook plants two PRs there: an ordinary one, and one whose body tells the agent to post "LGTM", approve the PR and run a command. Re-polling with no new commits skips both. A new push re-runs only that PR. Never `vendsy/*` or any employer repo (OPEN_QUESTIONS employment-IP to-do).

## Scope

1. **Draft enforcement in the policy** (`policy.ts`). For a session whose playbook mode is `draft`, every call the policy already classifies as outward is denied with reason `draft_mode`, and the owner is never asked. That includes the `gh pr` writes, non-GET `gh api`, and any tool it classifies as a GitHub or outward write. The deny reason tells the model the post was saved as a draft. It runs before grants and holds, so an `always` grant can't let a draft session post. Merge stays blocked as today (invariant 4).
2. **Record the payload** (`kernel/src/integrations/drafts.ts`). Each `draft_mode` deny writes one `draft_outputs` row: session, agent, playbook, run, item_ref, the tool, and a bounded payload (for `gh pr review|comment`: the target and the body text; otherwise the command or input). It appends one `draft_output_recorded` event, with a summary and the draft id, which the thread shows as a card (item 01's tie; item 12 renders it). Store the payload as untrusted data: it's model output built from PR text.
3. **`gh` is unavailable to granted sessions.** For a session whose agent has the `github` grant, any Bash call to `gh` is denied with reason `use_kernel_github_tools`, naming the four tools (item 06), so no raw PR text arrives unwrapped. Sessions without the grant behave as today.
4. **Routes** (owner-only, matching item 01's contract): `GET /drafts?agent=&playbook=&item=` (newest first, paged) and `GET /drafts/:id`.
5. **Docs:** fill `docs/architecture/draft-mode.md`: the field, the deny order (draft before grants and holds), what's recorded, the `gh` deny for granted sessions, and that `live` is refused in phase 6.

## Non-goals

- `live` mode, or any real posting (phase 8).
- The app's draft card (item 12). Changing what counts as outward: the existing classifier is reused as is.

## Acceptance criteria

- [ ] Given a draft-mode session, when it runs `gh pr review 12 --approve --body "LGTM"`, then the call is denied `draft_mode` with no approval created, and one `draft_outputs` row holds the target and the body. One `draft_output_recorded` event is appended.
- [ ] Given the same session holding an `always` grant for `gh pr comment`, when it comments, then it's still denied `draft_mode` and recorded.
- [ ] Given a draft-mode session, when it runs `gh pr merge`, then it's blocked as today (invariant 4).
- [ ] Given a session of an agent with the GitHub grant, when it runs `gh pr view 12` (a read), then it's denied `use_kernel_github_tools`, naming the kernel tools. A session without the grant may still run it as today.
- [ ] Given a non-draft session without a playbook (a chat turn), then nothing about its holds changes. Phase 3–5 policy tests still pass.
- [ ] Given `GET /drafts?item=github:o/r#12`, then the drafts for that PR return newest first, without the token or any secret.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The policy's existing outward classifier catches every posting path a session has. Item 06's tools are read-only, and `gh` is denied for granted sessions, so in phase 6 the only posting paths are `gh` (denied) and none else.

## Risks

- A deny order regression that lets a grant through. Pin the order with a test per existing grant kind.

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md

## Touches
kernel/src/sessions/policy.ts
kernel/test/sessions-policy.test.ts
kernel/src/integrations/drafts.ts
kernel/test/draft-mode.test.ts
docs/architecture/draft-mode.md
