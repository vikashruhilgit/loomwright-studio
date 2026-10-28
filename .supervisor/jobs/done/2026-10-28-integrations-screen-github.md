# Supervisor Job: The Integrations screen — connect, inspect and disconnect GitHub, built to the approved mockup

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-28-211751/L1
- **CLAUDE.md:** ✓ Found (fresh — phase 6 items 01–08 merged; the screen placeholder, contract routes and fixture defaults it describes are on `main`)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095111-the-integrations-screen.md
- **Base commit:** a7e454e559d34bc95621ec3e2d4d6a0417b4a83e

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React 19 + Electron 44 + vitest/jsdom + Playwright Electron, all in `app/package.json`; no new dependency |
| 2 | Dependency Availability | GO | Items 01 (placeholder `app/src/screens/integrations/index.tsx` on ⌘5), 02 (`docs/design/mockups/integrations.html` + `docs/evidence/phase-6-integrations-mockup/`), 03 (the four `/connectors` routes in `CONTRACT_ROUTES`, served by `kernel/src/integrations/github/routes.ts`) and 08 (`RosterEntry.connectors`, `githubGranted`) are all merged |
| 3 | Architecture Fit | GO | The shell discovers `src/screens/<id>/index.tsx`; every call goes through `window.api.request` (main process holds the API token). The requirement's assumption holds: `ApiRequest.body` already crosses the preload to `kernel-connection.ts`, which posts it (`body !== undefined` → JSON) |
| 4 | Scope vs Supervisor Capability | CAUTION | ~13 text files plus 18 generated PNGs and well over 800 changed lines → `context-bound` split into 2 sequential subtasks |
| 5 | Hard Blockers | GO | None. No kernel, preload, main-process or contract change is needed |

**Overall Verdict:** CAUTION

## Task
**Goal:** Replace the Integrations placeholder with the real GitHub connector screen — list pane, detail pane, Connect GitHub sheet, Disconnect confirm and every designed state — matching `docs/design/mockups/integrations.html`, with the pasted token never held by the renderer.

**Problem Statement:**
The owner needs to connect, inspect and disconnect Studio's read-only GitHub token from the app, because otherwise connecting GitHub needs a terminal (`studio connectors github set`) and nothing shows what Studio can reach.
Currently, `⌘5` shows a placeholder that fetches nothing, although the kernel serves `GET /connectors`, `POST /connectors/github/token`, `POST /connectors/github/disconnect` and `GET /connectors/github/repos`. This causes phase 6's poll playbooks to depend on a CLI step.
Success looks like: every mockup state renders from fixture data, the token goes renderer → preload → main → kernel and is cleared at once, and a test proves it is in no store, console line, error text or URL.

## Acceptance Criteria

Numbered for the subtask table. AC1–AC8 and AC13 are Subtask 1 (unit, jsdom); AC9–AC12 are Subtask 2 (e2e + evidence).

- [ ] **AC1 (empty state).** Given `GET /connectors` answers `{connectors: []}`, or only a `disconnected` row, or only a `rejected` row (the kernel writes one after a refused first connect, `kernel/src/integrations/github/connector.ts` `refuse(`), when the screen mounts, then the detail pane shows the mockup's empty state ("Connect GitHub so a playbook can read your PRs.", the Studio-works-with-no-connectors note) with a **Connect GitHub** button, and the list pane's GitHub row reads "Not connected" — for a `rejected` row with the mockup's last-token-was-refused note in the row (`docs/design/mockups/integrations.html` list row).
- [ ] **AC2 (connect posts through the bridge).** Given the Connect GitHub sheet is open and a token is typed into its password field, when the owner presses Connect (button or ⏎), then exactly one `window.api.request({method: "POST", path: "/connectors/github/token", body: {token}})` is made, the field's DOM value is `""` before that request resolves, and the sheet shows the mockup's "connecting" phase (field disabled, "Checking with GitHub…", button `aria-busy`).
- [ ] **AC3 (secrecy pin).** Given a distinctive token string was submitted, when the request resolves — both on success and on each refusal (`token_invalid`, `token_write_scoped`) — then a test asserts the token string is absent from: `JSON.stringify` of the live store's snapshot (`liveStoreFor(api)`), every `console.log/info/warn/error/debug` call's arguments (spied), `document.body.textContent` and every input's `value`, `window.location.href`, and every React hook state on the sheet's fiber chain (walk the input's `__reactFiber$*` `.return` chain and `JSON.stringify` each `memoizedState`). The field is uncontrolled: its value is read from a ref only inside the submit handler and never passed to `useState`, a store, a log, an error message or the URL.
- [ ] **AC4 (refusals inline).** Given the kernel answers `422 {error: "token_write_scoped", message, connector, write_permissions: [{permission: "pull_requests", level: "write"}]}`, when the answer lands, then the sheet stays open with the field empty and an inline `role="alert"` error that names "Pull requests: write → set to Read-only" (permission keys humanised: `pull_requests` → "Pull requests") and tells the owner to edit the token and paste it again, as the mockup's `rejected-write` phase does. Given `422 {error: "token_invalid", …}`, then the mockup's `rejected-invalid` copy shows instead, field empty. Any other refusal shows the kernel's `message` as text. `write_permissions` is read defensively from `ApiError`'s open keys — `app/src/api/contract.ts` is not changed.
- [ ] **AC5 (connected detail).** Given a connected fixture row (`account_login`, `permissions`, `expires_at`, `reachable_repos`) and `GET /agents` with one agent whose `connectors` is `["github"]`, when the screen renders, then the detail pane shows status, account, each permission with its level, expiry, "Reachable repos · N" with a **Refresh** button (calls `GET /connectors/github/repos?refresh=1` and renders its `repos`), and "Agents with the GitHub grant · N" listing exactly the agents `githubGranted(agent) === true` — as the mockup's `connected` view shows. Every GitHub-sourced string renders as a React text child. The `expiring` and `expired` statuses render their mockup variants.
- [ ] **AC6 (disconnect confirms).** Given the connected detail, when the owner presses **Disconnect**, then a confirm `Dialog` ("Disconnect GitHub?") opens and no request is made; Cancel/Escape closes it with no request; confirming makes exactly one `POST /connectors/github/disconnect`, after which the screen shows "not connected" (the empty state).
- [ ] **AC7 (live updates).** Given the screen is mounted, when a `connector_status` event arrives on the feed (store `eventLog`), then `GET /connectors` is refetched with no reload, the last answer stays rendered until the new one lands (never a loading flash), and an answer older than the latest request is dropped. Given the bridge answers `status: 0` with a `connection`, then the mockup's kernel-unreachable state renders (never "not connected").
- [ ] **AC13 (replace token).** Given a `connected`, `expiring` or `expired` row, then the detail header shows a **Replace token** button (the primary button in `expiring` and `expired`, as the mockup's header and in-band copy show); pressing it opens `ConnectSheet` in replace mode with the mockup's replace copy ("The current token stays in use until the new one passes the check." / for `expired`: "The new token replaces the expired one once it passes the check."), and submitting posts to the same `POST /connectors/github/token` under the same AC2/AC3 clearing and secrecy rules (the AC3 pin covers the replace path too). A refusal in replace mode leaves the current row rendered unchanged.
- [ ] **AC8 (keyboard + shell).** Given the screen is mounted, then it registers ⌘K commands under owner `integrations` — **Connect GitHub** (disabled only while the kernel is unreachable; when a token exists it opens the sheet in replace mode, as the mockup's palette entry does), **Disconnect GitHub** (enabled only while a non-disconnected token row exists), **Refresh reachable repos** (enabled only while connected or expiring) — each calling the same handler as its button, unregistered on unmount; every action (open sheet, submit, cancel, disconnect + confirm, refresh) is reachable by keyboard alone; `app/src/App.test.tsx` passes unchanged (sidebar `Integrations⌘5`, palette `["screens.integrations", "Screens", "⌘5"]`, and `screen-integrations` present when `window.api` is absent).
- [ ] **AC9 (e2e: connect, secrecy, refusals).** Given the built app against the fixture kernel (`app/e2e/fixtures/integrations.ts`), when `app/e2e/integrations.spec.ts` pastes a token and presses Connect, then the fixture's `POST /connectors/github/token` route records a body whose `token` equals the pasted value (the main process posted it), the field's value is `""` afterwards, and the token string appears in no page text and no `console` message the spec collected; and with the fixture refusing `token_write_scoped` for `pull_requests: write` the sheet shows that permission and the field is empty.
- [ ] **AC10 (e2e: states, disconnect, live update).** Given the fixture, then the spec walks: empty state → connected detail (account, permissions, expiry, repos, granted agents) → Disconnect → confirm → "not connected"; and with `appendEvent` of a `connector_status` event plus a changed `GET /connectors` answer, the screen updates without a reload, and the list pane's and detail header's bounding boxes are identical before and after (no layout shift).
- [ ] **AC11 (e2e: keyboard only).** Given the screen via `⌘5`, then the spec reaches Connect GitHub, submits, cancels, replaces the token (Replace token from a connected fixture: the fixture records the new token body, the field is empty afterwards), disconnects with confirm and refreshes repos using only `keyboard.press`/⌘K, never a click.
- [ ] **AC12 (polish gate evidence).** Given `INTEGRATIONS_EVIDENCE=1`, when the spec runs, then it writes light and dark screenshots of every designed state — not-connected, connecting, connected, rejected-invalid, rejected-write, expiring, expired, unreachable, and the Connect sheet — to the committed `docs/evidence/phase-6-polish/integrations/`, and a committed evidence file `docs/evidence/phase-6-polish/integrations/README.md` contains the regenerate command, one table row per screenshot pair naming the mockup state (`S.base` / `S.sheet` value in `docs/design/mockups/integrations.html`) it matches, and the capture date; the PR body links to it. Without the env var the spec writes to Playwright's per-test output dir (CI never dirties tracked files), and the spec asserts so: without the env var, no file under `docs/evidence/phase-6-polish/integrations/` has an mtime newer than the run's start.

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test && npm run build`, then `npm run e2e` (or at least `npx playwright test e2e/integrations.spec.ts --workers=1`) plus `app/scripts/hidden-windows.test.ts` (part of `npm test`).

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|---------------------------------|-----------------|------------|
| screen (Subtask 1) | `app/src/screens/integrations/index.tsx` (23) | `app/src/screens/integrations/IntegrationsView.tsx`, `app/src/screens/integrations/ConnectSheet.tsx`, `app/src/screens/integrations/model.ts`, `app/src/screens/integrations/actions.ts`, `app/src/screens/integrations/commands.ts`, `app/src/screens/integrations/integrations.css` | HIGH |
| screen tests (Subtask 1) | — | `app/src/screens/integrations/model.test.ts`, `app/src/screens/integrations/integrations.test.tsx`, `app/src/screens/integrations/connect-sheet.test.tsx` | HIGH |
| e2e + evidence (Subtask 2) | — | `app/e2e/integrations.spec.ts`, `app/e2e/fixtures/integrations.ts`, `docs/evidence/phase-6-polish/integrations/README.md`, `docs/evidence/phase-6-polish/integrations/*.png` (18, generated) | HIGH |

Read, reused, **not modified**: `app/src/screens/team/actions.ts` (`fetchConnectors`), `app/src/screens/team/model.ts` (`outcomeOf`, `CallOutcome`, `githubGranted`), `app/src/store/react.ts` (`useLiveStore`, `useResource`, `liveStoreFor`), `app/src/store/fake-bridge.ts`, `app/src/components/Dialog/Dialog.tsx`, `app/src/components/Input/Input.tsx` (`TextField` accepts `type="password"`), `app/src/components/Button/Button.tsx`, `app/src/commands/registry.ts`, `app/e2e/fixture-kernel.ts` (`appendEvent`, function routes receive `req.body`, `DEFAULT_ROUTES` already answer empty connectors/repos), `app/e2e/electron-harness.ts`, `app/src/App.test.tsx`.

### Module layout

| Responsibility | Home |
|---|---|
| Screen registration + no-bridge guard | `index.tsx` (MODIFY, 23 lines — stays a thin registration, as `team/index.tsx` is) |
| View state derivation (connector row → designed state, expiry text, permission labels, refusal parsing incl. `write_permissions`, granted-agents filter, `INTEGRATIONS_TEST_IDS`) | CREATE `model.ts` — pure, no React |
| Route calls (`connectGithub`, `disconnectGithub`, `fetchRepos`) | CREATE `actions.ts`; `GET /connectors` reuses Team's exported `fetchConnectors` and `outcomeOf` (cross-screen imports are the house pattern: `chat` imports `../team/model`) — never a second copy |
| Connector fetch + `connector_status` refetch hook, list + detail panes, Disconnect confirm | CREATE `IntegrationsView.tsx`. Team's `useConnectors` is private to `TeamView.tsx` (593 lines, out of scope): Integrations writes its own hook (it also holds repos and refresh), and does not edit Team |
| Connect sheet (uncontrolled password field) | CREATE `ConnectSheet.tsx` |
| ⌘K commands | CREATE `commands.ts` (mirrors `team/commands.ts`: `registry.register(OWNER, …)` in an effect, handlers through a ref) |
| Styles | CREATE `integrations.css` (tokens only, as `team.css`) |
| Fixture data | CREATE `app/e2e/fixtures/integrations.ts` (as `fixtures/team.ts`) |

No helper is copied by 2+ siblings today, so no extract row.

### Blast-Radius / Impact Prediction

Omitted: no System Twin contract or graph edge for the touched paths.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `docs/OPEN_QUESTIONS.md:112` | yes | STALE | `- [x] **Phase 5 exit: live run (item 18, owner).** … **Passed 2026-10-25**` (the requirement says it is unticked with no `docs/evidence/phase-5-exit-live-*.json`; it is ticked and `docs/evidence/phase-5-exit-live-2026-10-25.json` exists) | tip 30 minutes ago, fetched <1h |

## Touched-file invariants

> Grounded at base `a7e454e559d34bc95621ec3e2d4d6a0417b4a83e`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/screens/integrations/index.tsx`** — keep: the registration `id: "integrations"`, `title: "Integrations"` and `nav: { label: "Integrations", order: 5, shortcut: "⌘5" }`, and `export const screen: ScreenDefinition`; keep `data-testid="screen-integrations"` on the root of **every** render path, including the no-bridge one. reuse: Team's no-bridge guard from `app/src/screens/team/index.tsx` — `const api = getBridge() as StudioBridge | undefined;` then a "no connection to the kernel" state when `api === undefined`. pinned by: `app/src/App.test.tsx` — `"Integrations⌘5"`, `["screens.integrations", "Screens", "⌘5"]`, and the routing loop `for (const id of ["team", "approvals", "sessions", "integrations", "chat"])` which asserts `screen-${id}` with `window.api` absent.
- **`app/e2e/integrations.spec.ts`** (new, but under an existing pin) — keep: Electron starts only via `launchApp` / `launchGallery` from `app/e2e/electron-harness.ts`; pinned by: `app/scripts/hidden-windows.test.ts` (`// The e2e harness pin: every e2e spec starts Electron through`), which reads every file under `app/e2e/`.
- **Reused, unchanged shared modules** — mirror: `fetchConnectors(api)` in `app/src/screens/team/actions.ts` (`return call<ConnectorsResponse>(api, { method: "GET", path: "/connectors" });`) and `outcomeOf` in `app/src/screens/team/model.ts` (`export function outcomeOf<R>(result: ApiResult<R> | undefined): CallOutcome<R>`); the kernel's refusal shape in `kernel/src/integrations/github/routes.ts` (`` `{error, message,` `` / `` connector}` plus `write_permissions` (`token_write_scoped`) ``) and `WritePermission` in `kernel/src/integrations/github/connector.ts` (`readonly permission: string;` / `readonly level: string;`). The preload and main process are not edited: the body rides `request: <R>(request: ApiRequest) => ipcRenderer.invoke(CHANNELS.request, request)` in `app/electron/preload.ts`.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/integrations/connect-sheet.test.tsx` — field empty after submit (AC2) | delete the statement in `ConnectSheet.tsx`'s submit handler that empties the input's DOM value |
| `app/src/screens/integrations/connect-sheet.test.tsx` — token absent from store / console / text / URL / hook state (AC3) | in `ConnectSheet.tsx`'s submit handler, add the token to a `useState` setter (or a `console.debug` of it) |
| `app/src/screens/integrations/connect-sheet.test.tsx` — write-scoped names each permission (AC4) | in `model.ts`'s refusal parser, return an empty list instead of the parsed `write_permissions` |
| `app/src/screens/integrations/integrations.test.tsx` — Disconnect asks first (AC6) | make the Disconnect button's `onClick` call `disconnectGithub` directly instead of opening the dialog |
| `app/src/screens/integrations/integrations.test.tsx` — `connector_status` refetch (AC7) | delete the effect in `IntegrationsView.tsx` that refetches `GET /connectors` when the newest `connector_status` event id changes |
| `app/src/screens/integrations/integrations.test.tsx` — commands registered (AC8) | delete the Refresh reachable repos entry from the list `commands.ts` builds |
| `app/src/screens/integrations/model.test.ts` — status → designed state | flip the `expiring` status's mapped state to `connected` in `model.ts` |
| `app/src/screens/integrations/model.test.ts` — a `rejected` row is the empty state with the refused note (AC1) | in `model.ts`, map the `rejected` status to the connected state |
| `app/src/screens/integrations/integrations.test.tsx` — Replace token opens the sheet in replace mode and posts the token (AC13) | delete the Replace token button from the detail header in `IntegrationsView.tsx` |
| `app/src/screens/integrations/integrations.test.tsx` — empty state with Connect GitHub (AC1) | in `IntegrationsView.tsx`, render the detail pane instead of the empty state when no usable row exists |
| `app/src/screens/integrations/integrations.test.tsx` — connected detail: permissions, expiry, repos (AC5) | delete the permissions list from the detail pane in `IntegrationsView.tsx` |
| `app/src/screens/integrations/integrations.test.tsx` — Refresh re-reads repos (AC5) | drop the `refresh: "1"` query from `fetchRepos` in `actions.ts` |
| `app/src/screens/integrations/integrations.test.tsx` — granted agents listed (AC5) | in `model.ts`, filter agents with `githubGranted(agent) !== false` instead of `=== true` |
| `app/src/screens/integrations/integrations.test.tsx` — stale answer dropped (AC7) | remove the generation-counter check in `IntegrationsView.tsx`'s connector hook |
| `app/src/screens/integrations/integrations.test.tsx` — refetch keeps the last answer (AC7) | set the hook's state to loading at the start of each refetch in `IntegrationsView.tsx` |
| `app/src/screens/integrations/model.test.ts` — `status: 0` is the unreachable state (AC7) | in `model.ts`, map a `connection` (status 0) result to the not-connected state |
| `app/src/screens/integrations/integrations.test.tsx` — keyboard: ⏎ submits the sheet (AC8) | remove the form's submit handling of Enter in `ConnectSheet.tsx` (Connect only on click) |
| `app/e2e/integrations.spec.ts` — no layout shift on a `connector_status` update (AC10) | render a loading placeholder in place of the detail pane while the refetch is in flight in `IntegrationsView.tsx` |
| `app/e2e/integrations.spec.ts` — keyboard-only walk (AC11) | delete the Disconnect GitHub command from the list `commands.ts` builds |
| `app/e2e/integrations.spec.ts` — evidence gated on `INTEGRATIONS_EVIDENCE` (AC12) | in the spec's screenshot helper, ignore `INTEGRATIONS_EVIDENCE` and always write to the committed dir (the spec's own guard asserting the tracked dir is untouched without the env var turns red) |
| `app/e2e/integrations.spec.ts` — main process posts the pasted token (AC9) | in `actions.ts`'s `connectGithub`, send `body: {}` instead of `body: { token }` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Integrations screen, Connect sheet (connect + replace), commands and unit tests | AC1–AC8, AC13 | 1 modify, 9 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Fixture, Playwright e2e and polish-gate evidence | AC9–AC12 | 0 modify, 3 create + 18 generated PNGs | `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/integrations/index.tsx"}
  - {kind: "symbol", path: "app/src/screens/integrations/index.tsx", name: "screen"}
  - {kind: "file", path: "app/src/screens/integrations/IntegrationsView.tsx"}
  - {kind: "symbol", path: "app/src/screens/integrations/IntegrationsView.tsx", name: "IntegrationsView"}
  - {kind: "file", path: "app/src/screens/integrations/ConnectSheet.tsx"}
  - {kind: "symbol", path: "app/src/screens/integrations/ConnectSheet.tsx", name: "ConnectSheet"}
  - {kind: "file", path: "app/src/screens/integrations/model.ts"}
  - {kind: "symbol", path: "app/src/screens/integrations/model.ts", name: "INTEGRATIONS_TEST_IDS"}
  - {kind: "file", path: "app/src/screens/integrations/actions.ts"}
  - {kind: "symbol", path: "app/src/screens/integrations/actions.ts", name: "connectGithub"}
  - {kind: "symbol", path: "app/src/screens/integrations/actions.ts", name: "disconnectGithub"}
  - {kind: "file", path: "app/src/screens/integrations/commands.ts"}
  - {kind: "symbol", path: "app/src/screens/integrations/commands.ts", name: "INTEGRATIONS_OWNER"}
  - {kind: "file", path: "app/src/screens/integrations/integrations.css"}
  - {kind: "file", path: "app/src/screens/integrations/model.test.ts"}
  - {kind: "file", path: "app/src/screens/integrations/integrations.test.tsx"}
  - {kind: "file", path: "app/src/screens/integrations/connect-sheet.test.tsx"}
requires: []
lanes:
  - "app/src/screens/integrations/**"
external_requires:
  - "Kernel routes GET /connectors, POST /connectors/github/token, POST /connectors/github/disconnect, GET /connectors/github/repos (phase 6 item 03, merged)"

# Subtask 2
provides:
  - {kind: "file", path: "app/e2e/fixtures/integrations.ts"}
  - {kind: "symbol", path: "app/e2e/fixtures/integrations.ts", name: "integrationsFixture"}
  - {kind: "file", path: "app/e2e/integrations.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-6-polish/integrations/README.md"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/screens/integrations/index.tsx", name: "screen"}
  - {from: "1", kind: "symbol", path: "app/src/screens/integrations/model.ts", name: "INTEGRATIONS_TEST_IDS"}
  - {from: "1", kind: "symbol", path: "app/src/screens/integrations/actions.ts", name: "connectGithub"}
lanes:
  - "app/e2e/integrations.spec.ts"
  - "app/e2e/fixtures/integrations.ts"
  - "docs/evidence/phase-6-polish/integrations/**"
external_requires:
  - "Playwright Electron on macOS for the committed screenshots (INTEGRATIONS_EVIDENCE=1); CI runs the spec under xvfb without writing them"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (Subtask 2 imports `INTEGRATIONS_TEST_IDS` and drives the screen Subtask 1 builds) | YES — dependency, not overlap |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 2 | `skills/playwright-e2e/SKILL.md` |

Patterns to copy (read before writing): Subtask 1 — `app/src/screens/team/TeamView.tsx` (`useConnectorEventId` / `useConnectors`: generation counter, keep-last-answer refetch, `REFETCH_THROTTLE_MS`), `app/src/screens/team/commands.ts` (`useTeamCommands`), `app/src/screens/team/connectors.test.tsx` (fake bridge + `connector_status` emit), `app/src/store/fake-bridge.ts`. Subtask 2 — `app/e2e/team.spec.ts` (`TEAM_EVIDENCE` gating, `testInfo.outputPath`), `app/e2e/fixtures/team.ts` (function routes recording bodies), `docs/evidence/phase-5-polish/team/README.md` (README table shape: screenshot pair / designed state / mockup state / what it shows). Mockup: `docs/design/mockups/integrations.html` — `sheetHTML()`, `confirmHTML()`, the `S.base` values `none|connected|expiring|expired|unreachable` and `S.sheet` values `blank|connecting|invalid|write`; item 02's reference captures in `docs/evidence/phase-6-integrations-mockup/`.

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): change exceeds one worker's context (`context-bound`) | MEDIUM | Two sequential subtasks; the e2e targets Subtask 1's exported `INTEGRATIONS_TEST_IDS` rather than guessing selectors |
| The token lingers in the DOM or React state (the requirement's own risk) | HIGH | Uncontrolled `type="password"` input read via ref only in the submit handler, emptied before the request is awaited; AC3 walks the fiber hook states, store snapshot, console spies, text and URL; AC9 repeats the text/console checks in the real app |
| Mockup's "Open GitHub's token page" link cannot open: `app/electron/main.ts` denies every window open (`setWindowOpenHandler(() => ({ action: "deny" }))`) and blocks navigation | MEDIUM | Do not edit the main process (out of scope, security posture). Render the URL `github.com/settings/personal-access-tokens/new` as selectable mono text in the sheet; note the deviation from the mockup in the evidence README as a follow-up for phase 7 |
| Kernel reports permission keys (`pull_requests`) and levels (`write`), the mockup shows "Pull requests: Read and write" | LOW | Humanise keys in `model.ts`; show GitHub's level as reported; the README notes the wording difference |
| A `connector_status` refetch flashes a loading state (layout shift) | MEDIUM | Keep the last answer until the new one lands (Team's `useConnectors` pattern); AC10 compares bounding boxes |
| Cited-line premise (Phase 3): `docs/OPEN_QUESTIONS.md:112` — the requirement says phase 5's live exit is unticked with no evidence; it is ticked, passed 2026-10-25 (`docs/evidence/phase-5-exit-live-2026-10-25.json`) | MEDIUM | Sequencing gate already satisfied: proceed; do not re-run or edit phase 5 evidence |
| Prior churn (postmortem ledger): `app/src/screens/integrations/index.tsx` had 1 self-heal round (`self_heal_churn`) on its placeholder PR | LOW | Keep `index.tsx` a thin registration; run the full validation (typecheck + tests + build + e2e) before hand-back |
| Screenshots differ between macOS and CI fonts | LOW | Spec asserts behaviour, never pixels; screenshots committed only with `INTEGRATIONS_EVIDENCE=1` on macOS |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-28-integrations-screen-github.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-28T17:14:35Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/157
- **Branch:** feature/integrations-screen-github
- **Files changed:** 36
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Integrations screen built in 2 sequential subtasks: the screen with the Connect/Replace sheet, Disconnect confirm, ⌘K commands and unit tests (1238 pass); then the fixture kernel, Playwright e2e (10/10) and 18 light/dark evidence screenshots. Every review pass returned PASS with no BLOCKING or HIGH findings. Three fix rounds addressed 5 MEDIUM findings: a double token POST, a duplicated focus trap, the AC11 gap documented, and two stale placeholder doc lines. The last fix (docs/architecture/integrations.md:16) was not re-reviewed, and the loop stopped at its limit. Open owner decision: AC11's ⌘5/⌘K clause, because the app shell mounts neither the palette nor screen shortcuts.

## Not verified
- **rendered Integrations screen in Electron** — Electron binary not installed for the subtask-1 run; e2e and screenshots came in subtask 2 (subtask 1)
- **real kernel and live feed** — only the fake bridge and fixture kernel ran; per OPEN_QUESTIONS no real token can connect until the permissions probe resolves (subtask 1)
- **⌘K commands and ⌘5 in the built app** — the shell does not mount the palette or bind ⌘5; covered only by the jsdom tests (subtask 2)
- **the spec under Ubuntu CI/xvfb** — only macOS was run locally (subtask 2)
