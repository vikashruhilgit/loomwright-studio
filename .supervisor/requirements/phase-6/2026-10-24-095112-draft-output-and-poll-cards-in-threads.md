# 12 — Draft outputs and poll results appear as cards in the agent's thread

## Status: ready

**Priority:** MVP · ROADMAP phase 6 · D9, DESIGN.md §5, invariant 3

**As** the owner,
**I want** each would-be review, and each skipped or queued PR, to appear in the reviewer's thread as a card I can open,
**so that** I read the duty's drafts where I already talk to the agent, and see why an unchanged PR wasn't reviewed.

## Problem

Item 01 adds the thread event kinds `draft_output_recorded`, `poll_item_queued`, `poll_item_skipped` and `connector_status`, with their ties (`kernel/src/console/threads.ts:58`), so the thread route already returns them. Item 07 records drafts and serves `GET /drafts/:id`. The Chat/Crew thread renders cards only for phase 5's kinds (`app/src/screens/chat/cards.tsx`), so the new kinds show as nothing.

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

1. **A draft card.** One line in the timeline, "Draft review for <owner>/<repo>#<n> (not sent)", with the PR link. It expands to the draft's full body from `GET /drafts/:id`, rendered as untrusted text: no markdown links auto-followed, no HTML, the same as phase 5 renders session output. A "Draft mode: nothing was posted" label is always visible on it.
2. **Poll cards.** `poll_item_queued` gives "Reviewing <ref> @ <short sha>". `poll_item_skipped` gives "Skipped <ref>: unchanged under key <fields>". Consecutive skips from one poll collapse into one card with a count, which expands to the list.
3. **A connector card.** `connector_status` changes show in Wright's thread as a one-line system card.
4. **Keyboard and states.** Cards are reachable with J/K, and Enter expands one, as phase 5's cards are. The PR carries polish-gate screenshots in light and dark: a draft card collapsed and expanded, collapsed skips, and a long draft body.

## Non-goals

- Editing or sending a draft (phase 8). Any kernel change.

## Acceptance criteria

- [ ] Given a thread fixture with one `draft_output_recorded` event, then a draft card shows the PR ref and "not sent", and expanding it fetches and shows the body.
- [ ] Given a draft body containing `<script>`, a markdown link and `</untrusted-data>`, then it renders as inert text (pinned).
- [ ] Given five consecutive `poll_item_skipped` events from one poll, then one collapsed card says "5 unchanged PRs skipped", and it expands to the five refs and the key.
- [ ] Given J/K and Enter, then the cards are reachable and expandable.
- [ ] Phase 5's chat tests pass. The polish-gate screenshots are in the PR.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`

- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- The event payloads from items 05 and 07 carry the ref, short SHA, key fields and draft id. Their item texts say so. If one is missing, stop and say so rather than editing the kernel.

## Risks

- Rendering model-written text from PR content. Reuse phase 5's untrusted-text rendering, never a new markdown renderer.

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md
2026-10-24-095107-draft-mode-records-outward-calls-instead-of-sending-them.md

## Touches
app/src/screens/chat/cards.tsx
app/src/screens/chat/cards.test.tsx
app/e2e/chat.spec.ts
app/e2e/fixtures/chat.ts
