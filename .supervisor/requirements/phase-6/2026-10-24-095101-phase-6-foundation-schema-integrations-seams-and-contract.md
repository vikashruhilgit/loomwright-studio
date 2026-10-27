# 01 — Phase 6 foundation: the schema, the integrations feature's seams, and one contract every later item codes against

## Status: ready

**Priority:** MVP · ROADMAP phase 6 (prerequisite for every other item) · D4, D5, D8, D12, D34, invariants 1, 3, 5

**Precondition (prose, not a file dependency):** run this only after phase 5's live exit run has passed (`docs/OPEN_QUESTIONS.md:112` ticked, `docs/evidence/phase-5-exit-live-*.json` committed). Any findings from that run land first as phase-5 items.

**As** the owner,
**I want** phase 6's shared files, schema, types, stubs and API contract created in ONE change first,
**so that** items 02–12 each edit only their own module, test and doc page, and run in parallel waves without merge conflicts.

## Problem

Nothing of a connector exists. The `connectors` table is only planned (`docs/ARCHITECTURE.md:45`, deferred at `kernel/src/store/migrations/001_initial.ts:5-9`). There is no GitHub code, no octokit, and nothing stores a GitHub credential. `GH_TOKEN` / `GITHUB_TOKEN` pass through the daemon's environment untouched: `buildEnv` strips only Claude credentials (`kernel/src/auth/credential-env.ts:82-90`).

These closed sets and seams don't cover phase 6:
- **Triggers are time-based only.** `TRIGGER_KINDS = ["once", "cron"]` (`kernel/src/triggers/store.ts:72`).
- **The dedupe key can't see a PR.** `DEDUPE_KEY_FIELDS` has no item fields (`kernel/src/playbooks/types.ts:26`).
- **Playbooks have no mode.**
- **An agent's enforced settings have no `connectors` field.** The schema is in `kernel/src/agents/settings.ts`, beside `never` at :66.
- **A thread shows only existing event kinds.** It reads the closed `THREAD_EVENT_KINDS` (`kernel/src/console/threads.ts:58`).
- **The session manager can't offer a tool to only some agents.** It has no per-agent tool filter: the `mcpServers` factory is at `kernel/src/sessions/manager.ts:431`, :637.
- **The policy can't see a session's playbook mode or connector grant.**

Contributed features are pinned in a fixed order (`kernel/test/feature-seams.test.ts:117`). Migrations are pinned and contiguous, and the last one is 016 (`kernel/test/store.test.ts:233-286`). The app has no Integrations screen, not even a stub. Screens are discovered by glob (`app/src/App.tsx:14-26`), and `⌘1–4` are taken.

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

1. **Kernel: migration 017** (append-only, contiguous, no SQL CHECK; value sets closed in code). Update the `store.test.ts` pins.
   - **`connectors`:** id, kind (`github`), status (`connected` / `rejected` / `disconnected` / `expiring` / `expired`), account_login, permissions_json, reachable_repos_json, expires_at, verified_at, created_at, updated_at. It never holds a secret: the token lives only in the Keychain.
   - **`playbooks`:** add `mode` and `mode_set_by`.
   - **`playbook_runs`:** add `item_ref` (e.g. `github:<owner>/<repo>#<n>`) and `item_revision`.
   - **`draft_outputs`:** id, session, agent, playbook, playbook_run, item_ref, tool, payload_json (bounded), created_at.
2. **Kernel: the `integrations` feature.** `kernel/src/integrations/index.ts` merges EMPTY parts, registered in `SHIPPED_CONTRIBUTIONS` after `console`, and pinned in a new `kernel/test/integrations-foundation.test.ts`. Update `feature-seams.test.ts`. The parts:
   - `github/connector.ts` and `github/routes.ts` (item 03);
   - `github/tools.ts` (item 06);
   - `drafts.ts` (item 07).
3. **Kernel: shared types** in `kernel/src/integrations/types.ts`, which every later item codes against:
   - `PollSpec`: `{source: "github.pulls", repos: string[], filters: {state?, draft?, author?}, interval_seconds}`;
   - `SourceItem`: `{ref, revision, title, url, updated_at}`;
   - `GitHubClient`: the interface for the calls items 03, 04 and 06 make, plus rate-limit info on every response;
   - `FakeGitHubClient` in `kernel/test/fixtures/github-fake.ts`, which tests use and which never reaches the network.
4. **Kernel: the closed sets grow, with refusals until their items land.**
   - `TRIGGER_KINDS` gains `poll`. Creating one is refused `poll_not_implemented` until item 04 replaces that refusal.
   - `DEDUPE_KEY_FIELDS` gains `item.id` and `item.revision`. Today's dry-run preview (`kernel/src/playbooks/dry-run.ts:212`) shows them as `<per item>`.
   - `PLAYBOOK_MODES = ["draft", "live"]`, default `draft`. It becomes a settable field through the existing `set` path (`kernel/src/playbooks/drafts.ts`), with the same `*_set_by` owner lock as the other fields. Setting `live` is refused `live_mode_not_in_phase_6`.
   - `CONNECTOR_KINDS = ["github"]`. The agent settings schema gains `connectors: z.array(z.enum(CONNECTOR_KINDS)).optional()`. It isn't settable yet (item 08 makes it settable).
   - `THREAD_EVENT_KINDS` gains `draft_output_recorded`, `poll_item_skipped`, `poll_item_queued` and `connector_status`, each with its tie, so items 07 and 12 never edit `threads.ts`.
5. **Kernel: the session seams.** `sessions/manager.ts` passes the session's playbook `mode` and its agent's `connectors` into the policy input (`sessions/types.ts`). It filters contributed tools by a new `defineTool({requiresConnector: "github"})` flag (`features/contribution.ts`), so only granted agents' sessions list GitHub tools. The policy ignores both fields for now; item 07 fills them in.
6. **Kernel: strip GitHub credentials.** `buildEnv` removes `GH_TOKEN`, `GITHUB_TOKEN` and `GH_ENTERPRISE_TOKEN` from every child environment, pinned in `kernel/test/auth.test.ts`.
7. **App: the contract and the screen stub.**
   - `app/src/api/contract.ts` gains every phase 6 route, as documented in the stub pages: `GET /connectors`, `POST /connectors/github/token`, `POST /connectors/github/disconnect`, `GET /connectors/github/repos`, `GET /drafts`, `GET /drafts/:id`, `POST /agents/:id/set` with `connectors`. Update `console-contract.test.ts`.
   - `app/src/screens/integrations/index.tsx` is a placeholder registered on `⌘5`, after Sessions. Item 11 replaces it.
   - `app/e2e/fixture-kernel.ts` gains empty connector and draft routes, so item 11 and item 12 add only their own `app/e2e/fixtures/*.ts`.
8. **Docs.**
   - `docs/ARCHITECTURE.md` gets the integrations feature, the `connectors` and `draft_outputs` tables, the per-agent tool filter, and a "Phase 6 features" section linking the stub pages.
   - New stub pages: `docs/architecture/integrations.md` (03, 11), `github-tools.md` (06) and `draft-mode.md` (07). Items 04, 05, 08 and 09 edit their existing pages (`triggers.md`, `playbook-runs.md`, `agents.md`, `dry-run.md`).
   - `docs/UI.md` gets a note: the Integrations screen, GitHub only, is phase 6, by the owner's 2026-10-24 decision. Item 02 adds the matching note to DESIGN.md.

## Non-goals

- Any connector, poll, tool, policy or screen behaviour beyond the stubs and refusals (items 02–12).
- A GitHub HTTP implementation (item 03), or any npm dependency: the client uses Node 22's `fetch`, so `package.json` is untouched.

## Acceptance criteria

- [ ] Given a fresh store, when migrations run, then 017 creates `connectors` and `draft_outputs` and adds the playbook and run columns. Given a store at 016, when it upgrades, then existing playbooks read `mode = draft` with `mode_set_by = null`.
- [ ] Given the shipped contributions, when they merge, then `integrations` is registered last with no tools, routes or verbs, and the foundation test pins that.
- [ ] Given `kernel_trigger_create` with kind `poll`, then it's refused `poll_not_implemented`. Given `playbooks set <id> mode live`, then it's refused `live_mode_not_in_phase_6`. Given `mode draft` from the owner, then it's stored with `mode_set_by = owner`, and a later agent edit of `mode` is refused.
- [ ] Given a tool defined with `requiresConnector: "github"`, when a session of an agent without the grant starts, then that tool isn't in its tools list. With the grant, it is. Both are pinned with a fake tool, and the `tools-sdk-list` check still passes (#95).
- [ ] Given a daemon environment with `GH_TOKEN` and `GITHUB_TOKEN` set, when a session spawns, then neither is in the child environment.
- [ ] Given `npm ci && npm run typecheck && npm test && npm run build` in `app/`, then all pass, and the Playwright smoke shows six sidebar entries with Integrations on `⌘5`.
- [ ] `bash scripts/check-docs.sh` passes.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- `bash scripts/check-docs.sh`

## Assumptions

- Node 22's built-in `fetch` is enough for GitHub's REST API. No octokit is needed.
- The existing `set` path in `drafts.ts` takes a new field without restructuring.

## Risks

- `THREAD_EVENT_KINDS` ties are added before the events exist. Pin each tie, so items 07 and 12 can't drift from it.

## Depends on
none

## Touches
kernel/src/store/migrations/
kernel/test/store.test.ts
kernel/src/integrations/
kernel/test/integrations-foundation.test.ts
kernel/test/fixtures/github-fake.ts
kernel/src/features/index.ts
kernel/src/features/contribution.ts
kernel/test/feature-seams.test.ts
kernel/src/triggers/store.ts
kernel/test/triggers.test.ts
kernel/src/playbooks/types.ts
kernel/src/playbooks/drafts.ts
kernel/src/playbooks/store.ts
kernel/src/playbooks/dry-run.ts
kernel/test/playbooks-foundation.test.ts
kernel/test/playbooks-drafts.test.ts
kernel/src/agents/settings.ts
kernel/test/agents-wright-settings.test.ts
kernel/src/console/threads.ts
kernel/test/console-threads.test.ts
kernel/src/sessions/manager.ts
kernel/src/sessions/types.ts
kernel/test/sessions.test.ts
kernel/src/auth/credential-env.ts
kernel/test/auth.test.ts
kernel/test/console-contract.test.ts
app/src/api/contract.ts
app/src/screens/integrations/index.tsx
app/e2e/fixture-kernel.ts
app/e2e/smoke.spec.ts
docs/ARCHITECTURE.md
docs/UI.md
docs/architecture/integrations.md
docs/architecture/github-tools.md
docs/architecture/draft-mode.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-27T11:48:07Z
- **Brief:** unknown
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/142
