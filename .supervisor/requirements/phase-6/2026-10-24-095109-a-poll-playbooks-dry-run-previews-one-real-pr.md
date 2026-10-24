# 09 — A poll playbook's dry run shows what would run or be skipped, then reviews one real PR in draft mode

## Status: ready

**Priority:** MVP · ROADMAP phase 6 (acceptance test 1 extends phase 3's "dry-run output is shown before it's enabled") · D3, D4, invariant 2

**As** the owner,
**I want** a PR-review playbook's dry run to poll my repos once, show which PRs would run or be skipped under my dedupe key, and show the actual would-be review of one real PR,
**so that** I enable the duty knowing exactly what it will do, with nothing recorded and nothing posted.

## Problem

A dry run can't read GitHub. It allows only `Read`, `Glob` and `Grep`, the kernel list/get tools, and the Bash programs cat, head, tail, ls, wc, grep, pwd and echo (`kernel/src/sessions/dry-run.ts:22`, :61). `gh`, `git`, `curl` and WebFetch are deliberately excluded (`docs/architecture/dry-run.md`, "Deliberately out"). Its dedupe preview covers only the closed fields (`kernel/src/playbooks/dry-run.ts:199-212`), and item 01 shows the item fields there as `<per item>`. A dry run of a poll playbook therefore can't show what would happen.

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

1. **Poll once, record nothing** (`playbooks/dry-run.ts`).
   - For a playbook whose trigger is a poll, the dry run calls item 04's fetch path in a no-record mode: no queue rows, no `poll_item_*` events, no change to `next_fire_at` or `last_result`.
   - For each item it computes the dedupe key against existing `done` runs (item 05's evaluator, read only), and lists each as `would run` or `would skip (key …)`.
   - It shows the key's fields with their real values.
2. **Review one real PR, forced draft** (`sessions/dry-run.ts`).
   - The dry-run session additionally gets item 06's four read tools, if the playbook's agent holds the GitHub grant.
   - It is forced into draft mode, whatever the playbook's mode (item 07's enforcement, with the run marked as a dry run). Any would-be post is recorded as a draft output tagged `dry_run` and shown in the dry-run result.
   - It reviews the first `would run` item, or the first item if all would skip.
   - `gh`, `git`, `curl` and WebFetch stay out.
3. **No GitHub, no grant.** With no connected connector, or an agent without the grant, the dry run still shows the parsed spec and says exactly why it couldn't poll (`connector_missing` / `needs_github`) and what to do. The enable stays possible (it parks at run time, item 05), but the result says the preview is incomplete.
4. **Docs:** a "Poll playbooks" section in `docs/architecture/dry-run.md`: no-record polling, the forced draft, and the incomplete-preview case.

## Non-goals

- Changing the enable gate (`kernel_playbook_enable` stays always held, `policy.ts:181-184`).
- Previewing more than one review per dry run.

## Acceptance criteria

- [ ] Given a poll playbook with three open PRs (fake client), one of which has a `done` run with an unchanged head SHA under the user's key, when it's dry-run, then the result lists two `would run` and one `would skip (key …)`, and the store has no new queue rows, events or trigger changes.
- [ ] Given that dry run, then exactly one review session runs, with the four read tools and no `gh`. It is draft-forced: its `gh pr review` is denied `draft_mode`, and its body appears in the dry-run result as a `dry_run` draft output.
- [ ] Given a playbook in mode `live` (impossible in phase 6, but forced in a test), its dry run is still draft-forced.
- [ ] Given no connected connector, then the dry run reports `connector_missing` with the fix, and runs no session.
- [ ] Phase 3's dry-run tests still pass.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The dry-run tool call can stay open for a whole review session. Still NEEDS VERIFICATION in `docs/OPEN_QUESTIONS.md` (the MCP tool-call timeout item). A review session is longer than phase 3's 5 s dry run, so the live exit records how long it took.

## Risks

- The no-record mode leaking a write. Assert with a store snapshot before and after.

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md
2026-10-24-095104-a-poll-trigger-fetches-a-source-at-a-user-set-interval.md
2026-10-24-095105-one-playbook-run-per-item-deduped-by-item-fields.md
2026-10-24-095106-read-only-github-tools-return-pr-text-as-untrusted-data.md
2026-10-24-095107-draft-mode-records-outward-calls-instead-of-sending-them.md

## Touches
kernel/src/playbooks/dry-run.ts
kernel/src/sessions/dry-run.ts
kernel/test/playbooks-dry-run-poll.test.ts
docs/architecture/dry-run.md
