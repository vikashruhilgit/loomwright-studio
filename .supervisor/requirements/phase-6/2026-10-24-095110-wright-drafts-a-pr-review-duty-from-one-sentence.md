# 10 — Wright drafts a PR-review duty from one sentence: the playbook, its poll and key, and a reviewer if none fits

## Status: ready

**Priority:** MVP · ROADMAP phase 6 (acceptance test 1: "PR-review duty built from one sentence") · D3, D4, D22, D34, invariants 1, 9

**As** the owner,
**I want** to say one sentence such as "review every open PR on studio-sandbox when it changes, draft only", and get a drafted playbook (and, if needed, a reviewer charter) whose every value Wright only proposes,
**so that** the duty is built for me, and every policy in it is still mine to see and change.

## Problem

Wright creates playbooks with `kernel_playbook_create` (`kernel/src/playbooks/drafts.ts:149`, :158, :290). It accepts a trigger, dedupe key, priority, model, token limit and agent, but no poll spec, no `mode` and no item fields. Wright drafts charters through `kernel/src/agents/charter-tools.ts`, which has no `connectors` field to propose. Wright's guidance (`kernel/src/brain/templates.ts`) says nothing about connectors, polls or draft mode. Items 04, 05, 07 and 08 build those mechanisms, and nothing lets Wright propose them.

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

1. **`kernel_playbook_create` accepts a poll and a mode** (`drafts.ts`).
   - The trigger can be a `PollSpec`, validated by item 04's rules at draft time, so a draft naming an unreachable repo or a sub-60 s interval is refused with the same reasons.
   - `dedupe_key` can use `item.id` and `item.revision`.
   - `mode` is accepted only as `draft` (`live` is refused, item 01).
   - Every value Wright gives is stored with `*_set_by = wright` and shown as "proposed" (D4). An owner-locked field is never overwritten.
   - The schema passes the SDK `tools/list` check (#95).
2. **Charters can propose the grant** (`charter-tools.ts`). A drafted charter may propose `connectors: ["github"]`. It's applied only when the owner approves the create (the existing held-create path), never by the draft itself.
3. **Wright's guidance** (`templates.ts`, with `docs/architecture/brain.md` and `kernel/test/brain.test.ts`, per the companions rule):
   - For a request to watch PRs, propose a poll on the named repos with filters, an interval, a per-item dedupe key, and `mode: draft`, each named as a proposal the owner can change.
   - Prefer an existing crew member whose charter fits. Otherwise, draft a comment-only reviewer charter (`never` covering push and merge, `connectors: ["github"]`) and the playbook together, and show both.
   - Never pick a value silently, and never call it a default.
4. **No preset.** Nothing in code or templates ships a PR-review playbook or a reviewer charter (D3, invariant 9). The guidance describes how to propose one, not a canned one.

## Non-goals

- The dry run (item 09). Enabling (unchanged: always held).
- Natural-language parsing in code: Wright, the model, reads the sentence. The kernel only validates what it proposes.

## Acceptance criteria

- [ ] Given `kernel_playbook_create` with a poll on a reachable repo, interval 300, key `["playbook.id","item.id","item.revision"]` and `mode: draft`, then a `draft` v1 playbook and its poll trigger are stored, with each field `set_by = wright`, and the mirror `memory/playbooks/<slug>.md` shows them as proposed.
- [ ] Given the same with interval 30, or an unreachable repo, then it's refused with item 04's reasons.
- [ ] Given `mode: live`, then it's refused.
- [ ] Given a drafted charter proposing `connectors: ["github"]`, when the owner approves the create, then `config/agents/<id>.json` holds the grant. When they deny it, nothing is written.
- [ ] Given the owner later sets `dedupe_key` or `mode`, then a subsequent Wright edit of that field is refused.
- [ ] Given `templates.ts`, then `brain.test.ts` pins that the guidance calls every value a proposal, and that it contains no fixed repo, interval or key.
- [ ] A test greps the shipped code and templates for any preinstalled playbook or charter, and finds none.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- A real Wright follows the guidance. That's observed only in the live exit (item 13). The deterministic tests use a stand-in Wright, as phases 3–5 did.

## Risks

- Guidance that reads as a default. Review the template text against D4.

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md
2026-10-24-095104-a-poll-trigger-fetches-a-source-at-a-user-set-interval.md
2026-10-24-095105-one-playbook-run-per-item-deduped-by-item-fields.md
2026-10-24-095107-draft-mode-records-outward-calls-instead-of-sending-them.md
2026-10-24-095108-the-owner-grants-an-agent-github-access.md

## Touches
kernel/src/playbooks/drafts.ts
kernel/test/playbooks-drafts.test.ts
kernel/src/agents/charter-tools.ts
kernel/test/agents-charter-tools.test.ts
kernel/src/brain/templates.ts
kernel/test/brain.test.ts
docs/architecture/brain.md
docs/architecture/playbooks.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-28T15:42:22Z
- **Brief:** .supervisor/jobs/done/2026-10-28-wright-drafts-pr-review-duty.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/154
