# 08 — The owner grants an agent GitHub access, from the CLI or Team's inspector

## Status: ready

**Priority:** MVP · ROADMAP phase 6 · D8, D34, invariants 1, 3, 9

**As** the owner,
**I want** to grant or revoke GitHub access per agent, and see who holds it,
**so that** only the crew members I choose can read my repos, as a real boundary that no session can widen.

## Problem

Item 01 adds `connectors: ["github"]` to the agent settings schema (`kernel/src/agents/settings.ts`, beside `never` at :66) in `config/agents/<id>.json`. That file sits under `config/`, which no session may write (D34). But nothing can set the field: the owner's `agents set` lives in `kernel/src/agents/roster.ts`, and it knows only the existing fields. Team's inspector shows permissions, model and limits (`app/src/screens/team/Inspector.tsx`), but not connectors.

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

1. **The owner sets the grant.**
   - `studio agents set <id> connectors github` and `connectors none`, plus `POST /agents/:id/set {connectors}`, in `roster.ts`.
   - Owner-only. An agent's own session can't set it: `config/` stays protected, and the kernel tool path refuses it.
   - It works for crew members and for Wright.
   - Granting `github` while the connector isn't connected is allowed and recorded. The inspector shows "GitHub not connected" (DESIGN.md §6: not-connected tools may be chosen).
   - Each change appends one event.
2. **Team's inspector** shows a Connectors row, with Grant GitHub / Revoke and the connector's state. It also registers a ⌘K command per action (the screen's own `commands.ts`). It reuses the phase 5 components, and the PR carries polish-gate screenshots of the row in light and dark, connected and not.
3. **Charters say what's enforced.** `charter-files.ts` renders the `connectors` field into the charter's enforced-settings summary, so the agent's `role.md` and the inspector agree with the JSON. The prose never grants anything: the kernel enforces only the JSON (D34).
4. **Docs:** add `connectors` to `docs/architecture/agents.md`: the field, who sets it, and what it gates (item 06's tools, item 05's parking, item 07's `gh` deny).

## Non-goals

- Wright proposing the grant in a drafted charter (item 10).
- Per-repo grants (the poll's repos and the token's reach already bound it).

## Acceptance criteria

- [ ] Given `studio agents set reviewer connectors github`, then `config/agents/reviewer.json` holds `connectors: ["github"]`, one event is appended, and the reviewer's next session lists the GitHub tools.
- [ ] Given `connectors none`, then the next session lists none of them.
- [ ] Given an agent's session calling any tool or route that would set its own `connectors`, then it's refused, and the file is unchanged.
- [ ] Given Team's inspector on a granted agent, then the Connectors row shows GitHub and the connector's state, and Revoke works by mouse and by ⌘K.
- [ ] Given `role.md` regenerated after a grant, then its enforced-settings summary lists GitHub.
- [ ] `agents-roster.test.ts` and the Team tests pass. The polish-gate screenshots are in the PR.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- `bash scripts/check-docs.sh`

- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- `roster.ts`'s set path is the single owner path for agent settings (phase 4 and phase 5 item 07).

## Risks

- Team-screen edits colliding with another item. Only this item touches `app/src/screens/team/` in phase 6.

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md

## Touches
kernel/src/agents/roster.ts
kernel/test/agents-roster.test.ts
kernel/src/agents/charter-files.ts
docs/architecture/agents.md
app/src/screens/team/
app/e2e/team.spec.ts
app/e2e/fixtures/team.ts

## Status: done (PR #149, merge 6daf886)
- **Completed:** 2026-10-28T11:41:19Z
- **Brief:** .supervisor/jobs/done/2026-10-28-owner-grants-agent-github-access.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/149
