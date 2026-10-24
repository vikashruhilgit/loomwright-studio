# 11 — The Integrations screen: connect, inspect and disconnect GitHub, built to the approved mockup

## Status: ready

**Priority:** MVP · ROADMAP phase 6 ("Integrations screen (GitHub first)") · D9, D12, invariants 5, 6, 7

**As** the owner,
**I want** an Integrations screen where I paste a read-only GitHub token, see its account, permissions, expiry and reachable repos, see which agents hold the grant, and disconnect it,
**so that** connecting GitHub needs no terminal, and I can always see exactly what Studio can reach.

## Problem

Item 01 registers a placeholder at `app/src/screens/integrations/index.tsx` on `⌘5`, and item 02 is the approved mockup (`docs/design/mockups/integrations.html`). Item 03 serves `GET /connectors`, `POST /connectors/github/token`, `POST /connectors/github/disconnect` and `GET /connectors/github/repos`. The API token never reaches the renderer: the main process makes every call (phase 5 item 01, `app/electron/kernel-connection.ts`). The GitHub token must be kept out of the renderer's state the same way, as far as a text field allows.

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

1. **The screen** (`app/src/screens/integrations/`), matching item 02's mockup: the connector list pane and the detail pane (status, account, permissions, expiry, reachable repos with Refresh, the agents holding the grant from `GET /agents`, Disconnect with a confirm). Live updates come from phase 5's store and feed (`connector_status` events).
2. **The Connect GitHub sheet.**
   - A secure (password-type) field.
   - Submit sends the value through the preload bridge to the main process, which posts it to `POST /connectors/github/token`.
   - The renderer clears the field and drops the value from component state at once, on success and on failure.
   - The value is never put in the store, a log, an error message, or the URL.
   - The kernel's refusals render inline exactly as the mockup shows: `token_write_scoped` names each permission to drop, and `token_invalid` too.
3. **Every designed state**, from item 02: not connected, connecting, connected, rejected, expiring, expired, kernel unreachable. Each is fixture-driven in `app/e2e/fixtures/integrations.ts`.
4. **Keyboard.** `⌘5`, and ⌘K commands registered by the screen itself: Connect GitHub, Disconnect GitHub, Refresh reachable repos. Every action is reachable without the mouse.
5. **Polish gate.** The PR commits screenshots from the running app, in light and dark, of every state and the sheet, and names the mockup states they match. The owner's approval of the PR is the gate (D9; phase 5's polish-gate decision).

## Non-goals

- Other connectors (phase 9). Granting agents, which lives in Team (item 08); this screen only lists the holders.
- Any kernel change.

## Acceptance criteria

- [ ] Given the fixture kernel with no connector, then the screen shows the designed empty state with Connect GitHub.
- [ ] Given a pasted token and Connect, then the main process posts it, the field is empty afterwards, and a test pins that the token string is absent from the renderer's store, the console and any error text.
- [ ] Given the fixture refusing `token_write_scoped` for "Pull requests: write", then the sheet shows that permission and how to drop it, and the field is empty.
- [ ] Given a connected fixture, then account, permissions, expiry, reachable repos and the granted agents render as the mockup shows. Disconnect asks for confirmation and then shows "not connected".
- [ ] Given a `connector_status` event on the feed, then the screen updates without a reload and without layout shift.
- [ ] Given the keyboard only, then every action is reachable. `App.test.tsx` and the e2e pass. The polish-gate screenshots are in the PR.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- The Playwright e2e for the screen.

- House rule (advisory): e2e specs launch Electron only through `app/e2e/electron-harness.ts` (`launchApp`, `launchGallery`), never `electron.launch` or `new BrowserWindow` in a spec (`app/scripts/hidden-windows.test.ts`).

## Assumptions

- The preload bridge's generic call can carry a request body to the main process without the renderer keeping it. If the bridge can't, stop and say so: item 01 owns the bridge.

## Risks

- A password field's value lingering in the DOM, or in React DevTools state. Clear on submit, and test it.

## Depends on
2026-10-24-095101-phase-6-foundation-schema-integrations-seams-and-contract.md
2026-10-24-095102-the-integrations-screen-mockup.md
2026-10-24-095103-the-github-connector-token-validation-and-reachable-repos.md

## Touches
app/src/screens/integrations/
app/e2e/integrations.spec.ts
app/e2e/fixtures/integrations.ts
