# 02 — The Integrations screen mockup, approved before any screen code (D9)

## Status: ready

**Priority:** MVP · ROADMAP phase 6 · D9, D12, invariant 7

**As** the owner,
**I want** a hi-fi mockup of the Integrations screen and its Connect GitHub sheet, in light and dark, with every designed state,
**so that** item 11 builds to a design I approved, as D9 requires for every screen.

## Problem

DESIGN.md lists "the Integrations screen (connect a tool)" under "Not in v1" (`docs/DESIGN.md:39`), so the approved mockups (`docs/design/mockups/gui-v1.html`) have no Integrations screen. D9 says nothing is coded until the owner approves its mockup, and phase 6 now builds the screen (owner decision below).

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

1. **The mockup.** Add `docs/design/mockups/integrations.html`, built in the same way as `gui-v1.html`, from `docs/design/tokens.json` and the existing design-system components, with no new tokens unless the PR names and justifies each one. It shows:
   - **The screen:** a list pane of connectors (only GitHub in phase 6, plus a quiet "more connectors later" footer, with no fake entries), and a detail pane: status dot, account login, permissions (each read-only permission listed), expiry with days left, the reachable repos, which agents hold the grant, and Disconnect.
   - **The Connect GitHub sheet:** what token to create (fine-grained, read-only, limited to chosen personal repos), a link-out label for GitHub's token page, the secure field, Connect, and the inline refusal for a write-scoped token naming the permission to drop.
   - **States (the review strip forces each):** not connected (the designed empty state), connecting, connected, token rejected (invalid, or write-scoped), expiring (≤ 14 days), expired, and kernel unreachable (the shared band).
   - **The keyboard map:** `⌘5` opens the screen, plus palette commands (Connect GitHub, Disconnect GitHub, Show reachable repos), each reachable without the mouse.
2. **DESIGN.md.** Add a "Phase 6: Integrations" section: where the mockup lives, what it commits item 11 to (as phase 5's "What the mockups commit phase 5 to" does), and a note that the Integrations screen moved from GUI v2 to phase 6 by the owner's 2026-10-24 decision. Move it out of the "Not in v1" list.
3. **The owner's approval is this PR's merge.** The PR body carries screenshots of every state in both themes. Branding: "Wright, powered by Claude" is allowed, and nothing may say or look like "Claude Code" (invariant 7). GitHub's name and mark only as the connector's label, with no GitHub brand styling of the screen.

## Non-goals

- Any app code (item 11).
- Mockups for other connectors (phase 9) or the rest of GUI v2 (phase 7).

## Acceptance criteria

- [ ] Given the mockup opened in a browser, when the review strip selects each state, then all seven states and the sheet render in light and dark.
- [ ] Given the mockup, then every colour, spacing, radius and type value comes from `tokens.json` (checked against the generator's names), or is named as new in the PR.
- [ ] Given the write-scoped refusal state, then it names the exact permission to drop (e.g. "Pull requests: Read and write → set to Read-only").
- [ ] Given DESIGN.md, then the Integrations screen is no longer listed as deferred, and the new section names `integrations.html`. `bash scripts/check-docs.sh` passes.
- [ ] The owner approves the PR (this is the D9 gate).

## Validation (must pass before merge)

- `bash scripts/check-docs.sh`
- Screenshots of every state in both themes in the PR body.

## Assumptions

- Expiry warning at ≤ 14 days is a design proposal the owner can change on the PR.

## Risks

- Inventing new components. Reuse List, Card, Badge, StatusDot, Dialog and Input from the design system.

## Depends on
none

## Touches
docs/design/mockups/integrations.html
docs/DESIGN.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-27T11:28:44Z
- **Brief:** .supervisor/jobs/done/2026-10-27-integrations-screen-mockup.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/143
