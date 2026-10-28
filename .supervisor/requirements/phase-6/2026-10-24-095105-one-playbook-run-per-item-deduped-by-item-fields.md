# 05 — One playbook run per item, deduped by the user's key over the new item fields

## Status: ready

**Priority:** MVP · ROADMAP phase 6 (exit criterion: "unchanged PRs are skipped according to the user-set dedupe key") · D4, invariants 1, 2, 3

**As** the owner,
**I want** each polled PR to become its own run, and a PR whose dedupe key already has a `done` run to be skipped,
**so that** an unchanged PR is never reviewed twice, by the rule I set, not one the kernel picked.

## Problem

The dedupe key works per run, not per item. `evaluateDedupeKey` (`kernel/src/playbooks/runs.ts:132`, :392) evaluates the fields in `DEDUPE_KEY_FIELDS`, and a matching `done` run gives `skipped_duplicate` (runs.ts:87, :334; `docs/architecture/playbook-runs.md:72-84`). Item 01 adds `item.id` and `item.revision` to the fields, plus `item_ref` and `item_revision` columns on `playbook_runs`. Item 04 queues one message per item, with the item in its payload. Nothing evaluates the item fields yet, and nothing parks a run whose agent lacks the GitHub grant.

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

1. **Per-item evaluation** in `runs.ts`:
   - A queued message carrying an item evaluates the playbook's dedupe spec, with `item.id = item.ref` and `item.revision = item.revision`, beside the existing fields.
   - The run row records `item_ref` and `item_revision`.
   - A matching `done` run gives `skipped_duplicate` and appends a `poll_item_skipped` event naming the item and the key. No session starts.
   - A playbook whose key leaves out the item fields keeps today's per-instant behaviour. The kernel never adds them itself (D4): it's the user's key.
2. **The item reaches the prompt as data.** The run's prompt carries the item's ref, revision, title and URL inside `<untrusted-data source="github:<owner>/<repo>#<n>">`, built with the existing `defuseWrapperTags` / `untrustedFrame` (`kernel/src/brain/context.ts:73-107`). The title is PR-author text, so it's untrusted. The fire line stays kernel-built (runs.ts:415-424).
3. **Park when the agent can't use GitHub.** For a playbook with a GitHub poll, the run parks with reason `needs_github` and notifies the owner once per playbook (stub in tests) if either:
   - its agent's `connectors` lacks `github`, or
   - the connector isn't `connected`.

   The item is retried at the next poll, so no fire is lost.
4. **A failed run doesn't count as done.** Only a `done` run dedupes, as today. A failed or abandoned review is retried at the next poll.
5. **Docs:** a "Per-item runs" section in `docs/architecture/playbook-runs.md`: the item fields, an example user key (`["playbook.id", "item.id", "item.revision"]`, labelled as an example, never a default), skips, and parking.

## Non-goals

- Fetching (item 04), reading PR contents (item 06), draft enforcement (item 07).
- Any default dedupe key.

## Acceptance criteria

- [ ] Given a playbook keyed `["playbook.id", "item.id", "item.revision"]` and two items, when both are queued, then two runs start, each with its own `item_ref` and `item_revision`.
- [ ] Given both runs `done`, when the next poll queues the same two items with unchanged head SHAs, then both are `skipped_duplicate`, two `poll_item_skipped` events name the items, and no session starts.
- [ ] Given one PR's head SHA changes, when the poll queues both, then only that PR runs.
- [ ] Given a key of `["playbook.id", "item.id"]` (the user's choice), when a PR's head SHA changes, then it's still skipped. The kernel follows the user's key.
- [ ] Given a PR title containing `</untrusted-data>` and an instruction, then the prompt carries it defused, inside the wrapper (pinned like `playbooks-runs.test.ts:967-982`).
- [ ] Given the playbook's agent has no GitHub grant, then the run parks `needs_github` and notifies once (stub), and after the grant the next poll runs it.
- [ ] Given a run that failed, when the item is polled again unchanged, then it runs again.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The queue's idempotency per `source_ref` (item 04) plus this dedupe is enough. No separate item table is needed.

## Risks

- A run left `running` by a crash, which would block dedupe forever. The existing abandon and crash-resume paths apply. Test one.

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md

## Touches
kernel/src/playbooks/runs.ts
kernel/test/playbooks-runs-items.test.ts
docs/architecture/playbook-runs.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-28T03:22:55Z
- **Brief:** .supervisor/jobs/done/2026-10-27-per-item-playbook-runs-dedupe.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/145
