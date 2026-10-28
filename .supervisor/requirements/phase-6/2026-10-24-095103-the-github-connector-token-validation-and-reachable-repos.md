# 03 — The GitHub connector: a read-only token in the Keychain, validated, with its reachable repos

## Status: ready

**Priority:** MVP · ROADMAP phase 6 · D12, D27 (pattern), invariants 3, 5, 6

**As** the owner,
**I want** to give Studio a fine-grained, read-only GitHub token once, from the app or the terminal, and see its account, permissions, expiry and the repos it can reach,
**so that** a review duty can read my personal repos' PRs without Studio ever holding my `gh` login or any write access.

## Problem

Nothing stores a GitHub credential, and there is no GitHub client. Every Keychain call goes through `kernel/src/auth/keychain.ts`, which uses `/usr/bin/security` (:9), and `KeychainWriter` never overwrites an item (:21-30). Replacing or disconnecting a token therefore needs a delete the module doesn't have. Item 01 creates the `connectors` table, the `GitHubClient` interface and the route contract. This item makes them real.

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

1. **Probe first (NEEDS VERIFICATION, invariant: verify before asserting).** Before building the read-only check, establish with the owner's real fine-grained token how GitHub exposes its permissions, expiry and reachable repos. Candidates: the `github-authentication-token-expiration` response header, `GET /user`, `GET /user/repos`, and whether any endpoint or header lists a fine-grained token's permissions. Record the result in `docs/OPEN_QUESTIONS.md` with the date and the evidence. **If GitHub gives no reliable way to read the token's permissions, stop and say so: don't invent a write probe or a workaround.** The owner decides the fallback.
2. **The real `GitHubClient`** (`kernel/src/integrations/github/client.ts`) on Node's `fetch`:
   - REST to `api.github.com` only, with the token from the Keychain read fresh per call (as auth providers do), never cached in a log or an event.
   - Every response's `x-ratelimit-*` headers are surfaced. On 403/429 with a rate-limit reason, the client returns a typed `rate_limited {resets_at}` rather than throwing, so callers can back off.
   - Bounded response sizes. A timeout per call.
3. **The connector** (`kernel/src/integrations/github/connector.ts`):
   - **Set:** validate the token (user, permissions per the probe, expiry, reachable repos). Refuse it with `token_write_scoped` naming each write permission and the setting to change, or with `token_invalid`. On success, write `loomwright-studio-github` via `keychain.ts` and upsert the `connectors` row (`connected`, account, permissions, reachable repos, expires_at, verified_at). Never return the token.
   - **Replace:** a second set validates the new token first and swaps it only if valid. `keychain.ts` gains a delete, so replace and disconnect work without overwriting in place.
   - **Disconnect:** delete the Keychain item, set the status to `disconnected` and keep the row's history. Playbooks needing GitHub then park (item 05 reads the status).
   - **Expiry:** a due-work check notifies the owner at 14 days and at 1 day before expiry (status `expiring`), and marks it `expired` after. Same pattern as the subscription-token expiry check.
   - **Refresh:** the reachable repos are re-read on every set, and on the owner's `GET /connectors/github/repos?refresh=1`.
   - Every change appends one `connector_status` event (no secret in it).
4. **Routes** (`github/routes.ts`, owner-only, matching item 01's contract):
   - `GET /connectors`;
   - `POST /connectors/github/token` (body `{token}`; the request body is never logged);
   - `POST /connectors/github/disconnect`;
   - `GET /connectors/github/repos`.
5. **CLI:** `studio connectors` (list), `studio connectors github set` (reads the token from stdin with no echo, never from argv), `studio connectors github status`, `studio connectors github disconnect`.
6. **Docs:** fill `docs/architecture/integrations.md` (the connector's lifecycle, the Keychain item, what the table holds and what it never holds, the refusals, expiry). Add the probe's result to `docs/OPEN_QUESTIONS.md`.

## Non-goals

- The poll (item 04), the read tools (item 06), the screen (item 11).
- OAuth, GitHub Apps, or reusing `gh auth`.
- Any write call to GitHub.

## Acceptance criteria

- [ ] Given a valid read-only token (fake client), when it is set through the route or the CLI, then the Keychain item is written, the row reads `connected` with its account, permissions, expiry and repos, and no response, log line or event contains the token.
- [ ] Given a token with any write permission, then it's refused `token_write_scoped`, naming each write permission. Nothing is written, and an existing good token stays in place.
- [ ] Given an invalid token, then it's refused `token_invalid`, and an existing good token stays in place.
- [ ] Given `studio connectors github set` with the token as an argument, then it's refused, and the CLI reads only from stdin.
- [ ] Given a connected token, when the owner disconnects, then the Keychain item is gone and the status is `disconnected`.
- [ ] Given a token expiring in 14 days, then the owner is notified once, and the status is `expiring`. At 1 day they're notified again. After expiry the status is `expired`. Tests use the notifier stub (#99): no test posts a real notification.
- [ ] Given a 403 with `x-ratelimit-remaining: 0`, then the client returns `rate_limited` with the reset time.
- [ ] The probe's result is recorded in `docs/OPEN_QUESTIONS.md`, or the item stopped and said why.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- GitHub exposes enough about a fine-grained token to tell read-only from write. This is unverified: scope step 1 decides it, and the item stops if it can't.

## Risks

- The token leaking through a log, an error message or an event payload. Test each path for the absence of the token string.

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md

## Touches
kernel/src/integrations/github/client.ts
kernel/src/integrations/github/connector.ts
kernel/src/integrations/github/routes.ts
kernel/src/integrations/cli.ts
kernel/src/auth/keychain.ts
kernel/test/integrations-github-connector.test.ts
kernel/test/integrations-github-client.test.ts
docs/architecture/integrations.md
docs/OPEN_QUESTIONS.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-28T04:08:25Z
- **Brief:** .supervisor/jobs/done/2026-10-27-github-connector-token-validation.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/147
