# 04 — A poll trigger: the kernel fetches a source at the interval the user set and queues one fire per item

## Status: ready

**Priority:** MVP · ROADMAP phase 6 · D2, D3, D4, invariants 1, 2

**As** the owner,
**I want** a trigger that polls my chosen repos' open PRs at the interval I set, run by the deterministic kernel,
**so that** a review duty sees each PR without a model deciding when to look, and a quiet poll costs no tokens.

## Problem

Triggers are time-based only: `once` and `cron`, with the actions `notify` and `wake_agent` (`docs/architecture/triggers.md:1-3`, :97-101; `kernel/src/triggers/store.ts:72`). A trigger linked to a playbook fires once per instant, keyed `trigger:<id>:<instant>`, and queues one `message` with `source_ref playbook:<id>:<instant>` (triggers.md "Firing"; `kernel/src/playbooks/runs.ts`). Nothing fetches an external source. Item 01 adds `poll` to `TRIGGER_KINDS` with a `poll_not_implemented` refusal, plus the `PollSpec`, `SourceItem` and `GitHubClient` types. This item makes the poll real.

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

1. **Create and validate a poll** (`kernel/src/triggers/poll.ts`, wired through `store.ts`, `tools.ts`, `routes.ts` and `cli.ts`). Replace item 01's refusal. A poll trigger is linked to a playbook, and its `spec_json` is a `PollSpec`. Refuse:
   - `interval_seconds < 60` as `poll_interval_below_floor`;
   - a repo not in the GitHub connector's reachable set as `poll_repo_not_reachable`, naming it;
   - no connected GitHub connector as `poll_connector_missing`;
   - an unknown filter as `poll_filter_unknown`.

   Interval, repos and filters are stored as given (D4: the kernel picks none of them).
2. **Fire a poll** as a due-work step, keyed `trigger:<id>:<instant>` like every fire, so a crash mid-poll is safe:
   1. List the open PRs per repo through `GitHubClient`, then apply the filters.
   2. Map each PR to a `SourceItem` (`ref = github:<owner>/<repo>#<n>`, `revision = head SHA`).
   3. Queue one `message` per item, with `source_ref playbook:<id>:<instant>:<item.ref>` and the item in its payload. Item 05 decides run or skip.
   4. Append one `poll_item_queued` event per item.

   A poll that finds no items queues nothing and starts no session.
3. **Back off on rate limits.** On `rate_limited`, the poll records `last_result = rate_limited` with the reset time, moves `next_fire_at` to `max(next interval, resets_at)`, and appends an event saying why. On any other GitHub error, record it, keep the schedule and never retry-loop.
4. **Park when the connector goes.** If the connector is `disconnected` or `expired` at fire time, the poll records `last_result = connector_missing`, fetches nothing, and notifies the owner once per outage (notifier stub in tests, #99).
5. **Pause and the kill switch.** A poll is a trigger fire, so phase 5's pause and the kill switch stop it like any other. Test both.
6. **Docs:** a "Poll triggers" section in `docs/architecture/triggers.md`: the spec, the floor, the per-item fire key, backoff, and parking.

## Non-goals

- Deciding run vs skip (item 05). Reading PR contents (item 06). Wright drafting polls (item 10).
- Webhooks, or any source other than `github.pulls`.

## Acceptance criteria

- [ ] Given a poll with `interval_seconds: 30`, then it's refused `poll_interval_below_floor`. Given 60, then it's accepted.
- [ ] Given a repo outside the token's reachable set, then the poll is refused `poll_repo_not_reachable`, naming the repo.
- [ ] Given a fake client with two open PRs on one repo, when the poll fires, then exactly two messages are queued with per-item `source_ref`s and items `{ref, revision}`, plus two `poll_item_queued` events.
- [ ] Given the same instant replayed after a `kill -9` mid-fire, then no message is queued twice (the fire key is per instant, and the queue is idempotent per `source_ref`).
- [ ] Given a fake client with no PRs, when the poll fires, then nothing is queued and no session starts.
- [ ] Given a `rate_limited` response, then `next_fire_at` is no earlier than `resets_at`, and an event names the reason.
- [ ] Given a disconnected connector, then the poll fetches nothing, records `connector_missing`, and notifies once (stub).
- [ ] Given pause or the kill switch, then no poll fires.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- Open-PR listing per repo is one paginated call. Pagination is bounded (cap and record when hit).

## Risks

- A burst of queued items for a busy repo. Item 05's dedupe and the playbook's existing token limit bound the cost, and this item caps the items per poll (recorded when hit).

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md

## Touches
kernel/src/triggers/poll.ts
kernel/src/triggers/store.ts
kernel/src/triggers/tools.ts
kernel/src/triggers/routes.ts
kernel/src/triggers/cli.ts
kernel/src/triggers/index.ts
kernel/test/triggers-poll.test.ts
docs/architecture/triggers.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-28T04:08:50Z
- **Brief:** .supervisor/jobs/done/2026-10-27-poll-trigger-fetches-source-at-interval.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/146
