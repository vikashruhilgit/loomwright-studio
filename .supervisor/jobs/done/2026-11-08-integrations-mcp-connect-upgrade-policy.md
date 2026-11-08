# Supervisor Job: Integrations — Jira and ClickUp connect, the GitHub App permission upgrade, and the repo policy card

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L11
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160012-integrations-jira-clickup-connect-app-upgrade-and-repo-policy-card.md
- **Base commit:** a0295e13178e7cd149385f1cc36a677beb5c3e3a

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Electron + React + TypeScript app (`app/`), vitest units, Playwright e2e; nothing new is needed |
| 2 | Dependency Availability | GO | Every kernel route is served and typed in `app/src/api/contract.ts`: `POST /connectors/mcp/:kind/connect`, `…/connect/cancel`, `…/disconnect` (item 06), `GET /connectors/github/app/upgrade` (item 03), `GET /repos/policy`, `POST /repos/policy/:owner/:repo/detect`, `POST /repos/policy/:owner/:repo` (item 08). All four `Depends on` items are in `.supervisor/jobs/done/` |
| 3 | Architecture Fit | CAUTION | The Electron open-external allowlist (`app/electron/open-external.ts`) accepts exactly three forms and refuses both URLs this item must open: the App upgrade page `https://github.com/settings/apps/<slug>/permissions` (the slug rule rejects the `/permissions` suffix) and a vendor's MCP `authorize_url` (any non-github host). Opening them needs a main-process change outside the item's Touches |
| 4 | Scope vs Supervisor Capability | CAUTION | About 24 files across four groups, so a `context-bound` split into four subtasks |
| 5 | Hard Blockers | GO | None. Jira stays stub-only (fixture), with no live call |

**Overall Verdict:** CAUTION

## Task
**Goal:** Give Integrations the phase 8 views (Jira and ClickUp MCP connect, the GitHub App "needs new permissions" upgrade, and the per-repo merge policy card), add the per-tool MCP grant to Team's Connectors row, and let the main process open the two kernel-returned URLs, all as `docs/design/mockups/phase-8.html` draws them.

**Problem Statement:**
The owner needs to connect Jira and ClickUp, accept the App's new permissions and set each repo's merge policy in a few clicks in the app, never a terminal.
Currently, Integrations shows only GitHub (token or App). The kernel already serves the MCP connect, cancel and disconnect routes, the App upgrade URL and the repo policy routes, but no view calls them. The Electron allowlist would refuse the URLs those routes return.
Success looks like this: each new view is reachable, calls only its kernel route, opens only a URL the kernel returned, and is pinned by unit tests, an e2e spec over the fixture kernel, and light and dark screenshots.

## Acceptance Criteria

Carried forward from the requirement (R1–R5), then the Scope items (S1–S9):

- [ ] **R1** Given ClickUp not connected, when the owner presses Connect, then the app calls `POST /connectors/mcp/clickup/connect` once, shows the wait state (with the window's `expires_at`) and opens the returned `authorize_url` through `openExternalUrl`; on the fixture's success (the `GET /connectors` read after a `connector_status` event shows the `mcp_connections` row `connected`) it shows the workspace (`server_url`) and the `granted_tools`; pressing Cancel during the wait calls `POST /connectors/mcp/clickup/connect/cancel` once.
- [ ] **R2** Given the App row reads `needs_permissions`, then the upgrade view ("Needs new permissions") shows, and its button opens exactly the `url` that `GET /connectors/github/app/upgrade` returned (never a URL built in the renderer). The e2e spec asserts the recorded `shell.openExternal` address equals the fixture's `url`.
- [ ] **R3** Given a repo whose detection is `protection_unavailable` (its `proposal.choices` is `make_public_or_upgrade`, `trust_unprotected`, `safe_mode`), then the card offers exactly Make public / Upgrade, Trust unprotected and Safe mode, no other preset, and Trust unprotected sends nothing until a confirm dialog naming what it waives (condition 4 only, never the high-risk park) is confirmed.
- [ ] **R4** Given a detected proposal (`proposal.kind` non-null), when the owner presses Accept, then exactly one `POST /repos/policy/:owner/:repo` is sent, with body `{kind: proposal.kind}` plus `required: proposal.required_reviews` when the kind is `reviews`.
- [ ] **R5** Given no connector at all (`GET /connectors` answers `{connectors: [], mcp_connections: []}` and `GET /repos/policy` answers `{repos: []}`), then the GitHub empty state, its Connect choice and every phase 7 e2e and unit test behave as before (invariant 5). Jira and ClickUp list as not connected with one Connect each, and the repo policy area shows "No repos reached yet." as its empty state.
- [ ] **S1 (Part A states)** Given an MCP row, then `McpConnect.tsx` renders the mockup's `cnPane` states: not connected (Connect), connecting (wait + Cancel), connected (workspace, tool list with the crew member granted each, a "Set grants in Team" pointer), `expired` and refused each with their own copy (refused = any non-2xx connect answer, or a `connector_status` refusal: one refused state that shows the refusal's `error` code — the closed set is `MCP_ERROR_STATUS` in `kernel/src/integrations/mcp/routes.ts`, which the app does not import or copy; `authorization_denied` and `window_expired` get their own sentence, every other code the generic refused sentence plus the code), and Disconnect behind a confirm that calls `POST /connectors/mcp/:kind/disconnect` once. Jira always carries the "Work account · stub only" note. A refusal's `message` is shown only as React text, never as markup.
- [ ] **S2 (Part B)** Given the upgrade view, then it states that session tokens are down-scoped (Pull requests, Contents, Issues, Checks), and when a later `GET /connectors` reads the App row `connected` the pane returns to the connected App detail with no reload.
- [ ] **S3 (Part C card)** Given a reached repo in `GET /repos/policy`, then `RepoPolicyCard.tsx` shows its detection (protection, required reviews, required checks, who can push, when it was read, from `detected`), the proposal with Accept, the three presets (Solo / Approve in Studio / N GitHub reviews with an N input) each sending one `POST /repos/policy/:owner/:repo`, and Re-detect, which sends one `POST /repos/policy/:owner/:repo/detect`. A repo with `kind: null` and a detection shows "No policy: PRs park". Trust unprotected sends `{kind: <the chosen preset>, trust_unprotected: true}` only after the confirm. Safe mode and Make public / Upgrade send no POST: Safe mode leaves the repo with no policy (PRs park) and says so, and Make public / Upgrade is two links, as `phase-8.html` `polCard` draws them: "Make public on GitHub" opens `https://github.com/<owner>/<repo>/settings` (owner and repo from the card's `repo`) and "Upgrade on GitHub" opens `https://github.com/settings/billing/plans`, each through `openExternalUrl`, with a `false` answer shown as a failure line (never a silent no-op). Neither sends a POST. Studio never changes branch protection.
- [ ] **S4 (Team per-tool grant)** Given a crew member whose `GET /agents/:id` `settings.content.connectors` names `jira` or `clickup` tools, then Team's Connectors row shows, per connected MCP kind, which of that kind's `granted_tools` the agent holds, and the grant control sends `POST /agents/:id/set` with `{field: "connectors", value: "<kind>:<tool>[,<tool>…]"}` (or `"<kind>:none"` to drop the kind). The GitHub grant button and `changeGithubGrant` behave exactly as before.
- [ ] **S5 (palette)** Given the Integrations screen is mounted, then the palette has `integrations.connect-jira`, `integrations.connect-clickup` and `integrations.repo-policy` under owner `integrations`, each calling the same handler as its button, disabled while the kernel is unreachable, and unregistered on unmount. The pinned command list in `integrations.test.tsx` lists all seven ids.
- [ ] **S6 (main-process open)** Given the kernel answered `POST /connectors/mcp/:kind/connect` with an `authorize_url`, or `GET /connectors/github/app/upgrade` with a non-null `url`, through the `studio:request` channel, then `studio:open-external` opens that exact string (https, no userinfo, no fragment, byte-equal) and nothing else new. An MCP URL is dropped on its `expires_at`, on that kind's cancel, and on the next connect. Two fixed forms are added beside the three existing ones: `https://github.com/<owner>/<repo>/settings` (owner and repo each matching a strict GitHub name pattern, no query, no further path) and exactly `https://github.com/settings/billing/plans`. Any other https URL the renderer sends that the kernel did not answer is refused `false`, and the three existing forms are unchanged.
- [ ] **S7 (unit tests)** Given `app/src/screens/integrations/phase-8.test.tsx`, then it covers R1–R4, S1–S3 and S5 over the fake bridge, and `app/electron/open-external.test.ts` and `app/electron/main.test.ts` cover S6: a kernel-answered URL opens; the two fixed forms open; their off-list neighbours (a query, an extra path segment, a bad owner name, `/settings/billing`) are refused; a renderer-only https URL, an expired MCP URL and a cancelled MCP URL are refused.
- [ ] **S10 (validation)** Given the finished change, then `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e` and `bash scripts/check-docs.sh` all pass.
- [ ] **S8 (e2e)** Given `app/e2e/integrations-phase-8.spec.ts`, launched only through `launchApp` from `app/e2e/electron-harness.ts`, then it drives the fixture kernel through R1–R5 with `shell.openExternal` replaced by a recorder before any click.
- [ ] **S9 (polish gate)** Given `PHASE8_POLISH_EVIDENCE=1`, when the e2e spec runs, then it writes light and dark screenshots of every new view (Jira and ClickUp: empty, connecting, connected, expired, refused, disconnect confirm; App: needs-permissions; policy: proposed, none, unenforceable, trust confirm, accepted) under `docs/evidence/phase-8-polish/integrations/`. A committed `docs/evidence/phase-8-polish/integrations/README.md` lists each image with its view and theme, and the PR body links to it.

## Scope widening
- app/electron/open-external.ts
- app/electron/open-external.test.ts
- app/electron/main.ts
- app/electron/main.test.ts
- app/src/screens/team/Inspector.tsx
- app/src/screens/integrations/integrations.test.tsx
- docs/architecture/app.md
- accepted: LP-SCOPE 2026-11-08

Why each is needed: the allowlist refuses both URLs this item must open (S6, R2), and `docs/architecture/app.md` §"The open-external channel" documents "exactly three forms". `Inspector.tsx` is where the Connectors row is mounted with its props (`<Connectors granted={githubGranted(agent)} …/>`), so the per-tool grant (S4) cannot reach the row without it. `integrations.test.tsx` pins the exact palette command list, which S5 extends.

## House Rules
> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins)
- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - category: testing
  - check (data only, NOT executed by this reader): (none)

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| electron-open | `app/electron/open-external.ts` (61), `app/electron/main.ts` (212), `app/electron/open-external.test.ts` (122), `app/electron/main.test.ts` (456), `docs/architecture/app.md` | — | HIGH |
| team-grant | `app/src/screens/team/Connectors.tsx` (73), `app/src/screens/team/actions.ts` (75), `app/src/screens/team/Inspector.tsx` (435), `app/src/screens/team/connectors.test.tsx` (372) | — | HIGH |
| integrations-views | `app/src/screens/integrations/IntegrationsView.tsx` (724), `app/src/screens/integrations/AppDetail.tsx` (185), `app/src/screens/integrations/model.ts` (380), `app/src/screens/integrations/actions.ts` (82), `app/src/screens/integrations/commands.ts` (105), `app/src/screens/integrations/integrations.css` (565), `app/src/screens/integrations/integrations.test.tsx` (790) | `app/src/screens/integrations/McpConnect.tsx`, `app/src/screens/integrations/AppUpgrade.tsx`, `app/src/screens/integrations/RepoPolicyCard.tsx`, `app/src/screens/integrations/phase-8.test.tsx` | HIGH |
| e2e-polish | `app/e2e/fixtures/integrations.ts` (335), `app/e2e/fixture-kernel.ts` (374) | `app/e2e/integrations-phase-8.spec.ts`, `docs/evidence/phase-8-polish/integrations/README.md` (+ the PNGs) | HIGH (fixture-kernel MEDIUM: its default routes may already suffice) |

**Module layout** (`skills/supervisor-readiness/SKILL.md` §"Module layout"):
- MCP connect views, App upgrade view, repo policy card → three CREATE modules (`McpConnect.tsx`, `AppUpgrade.tsx`, `RepoPolicyCard.tsx`). `IntegrationsView.tsx` (724, large) only mounts them, adds the list rows and holds their read state: at most about 80 new lines, and no view markup.
- New view-model helpers (MCP row → designed state, policy detection → card lines, per-kind granted agents) → `model.ts` (380, under threshold, the screen's one view model).
- New route calls → `actions.ts` (82, the one module for this screen's calls; the comment "one function per connector route" makes it the single authority).
- New styles → `integrations.css` (565 — the screen's one stylesheet, which every view already imports and where its tokens live; appended under one `/* phase 8 */` block).
- New tests → `phase-8.test.tsx` (CREATE). `integrations.test.tsx` (790) changes only the one pinned command-list assertion and its title line.
- The kernel-answered URL memory → `open-external.ts` (61, the single allowlist authority). `main.ts` only feeds it from the request handler.
- Team per-tool grant → `Connectors.tsx` (73) and `actions.ts` (75). `Inspector.tsx` (435) only passes the new props and handler. Tests go in `connectors.test.tsx` (372).
- E2E → a CREATE spec. Canned data → `fixtures/integrations.ts` (335, the screen's fixture module).
- Extract: none. `openExternalUrl` (`integrations/actions.ts`) and `ExternalLink` (`parts.tsx`) are reused, never copied.

**Validator-owned surfaces:** `bash scripts/check-docs.sh` checks relative links under `docs/`. The new `docs/evidence/phase-8-polish/integrations/README.md` links only images that exist, and `docs/architecture/app.md` gains no dangling link.

## Touched-file invariants

> Grounded at base `a0295e13178e7cd149385f1cc36a677beb5c3e3a`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/electron/open-external.ts`** — keep: the pure-function shape and the byte-equal rule `if (parsed.href !== url) return false;`, the userinfo and fragment refusal `url.includes("#")`, and the three existing forms unchanged (`const INSTALLATIONS_PATH = "/settings/installations";`). Add the kernel-answered form and the two fixed github.com forms (repo settings, billing plans) beside them, keep `const GITHUB_HOST = "github.com";` as the only fixed host, and never loosen an existing form's rule. Update the header that says it "answers yes to exactly three forms". Pinned by: `app/electron/open-external.test.ts` (`describe("the allowed forms"`).
- **`app/electron/main.ts`** — keep: every handler's caller check `if (!fromOwner(event)) throw new Error("refused");`, the request pass-through `return kernel.request(request);` (record the answer, never alter it), the connected-kernel gate before an open `if (!isAllowedExternal(url, where.port)) return false;`, and the reasons-only log `console.warn("loomwright-studio: could not open the system browser");` (never log the address: it carries `state`). Pinned by: `app/electron/main.test.ts` (`describe("the open-external channel"`).
- **`app/src/screens/integrations/IntegrationsView.tsx`** — keep: `GET /connectors` refetch on a `connector_status` event (`newestConnectorEventId`), the unreachable-vs-refused split (`Reply` kinds), and `useIntegrationsCommands(` called once. Mount the new views, never inline their markup. Mirror: `ConnectorsResponse.mcp_connections` is optional (`readonly mcp_connections?: readonly McpConnection[];` in `app/src/api/contract.ts`), so read a missing value as `[]`.
- **`app/src/screens/integrations/AppDetail.tsx`** — keep: `data-method="app"` and the session-scope line `data-testid={IDS.appSessionScope}`. `needs_permissions` keeps its connected look (`model.ts` `needs_permissions: "connected",`) and mounts `AppUpgrade` above it rather than replacing the pane.
- **`app/src/screens/integrations/model.ts`** — keep: `export const INTEGRATIONS_TEST_IDS` as the one id map ("the screen sets no other test id": every new testid goes in it), `replyOf` as the one reply reader, and untrusted strings rendered only as React text children.
- **`app/src/screens/integrations/actions.ts`** — reuse: `async function send<R>(api: StudioBridge, request: ApiRequest)` for every new call, with path templates and `params` (`/connectors/mcp/:kind/connect`, `/repos/policy/:owner/:repo`) exactly as `app/src/api/contract.ts` declares them. Reuse `export async function openExternalUrl` for every open.
- **`app/src/screens/integrations/commands.ts`** — keep: `export const INTEGRATIONS_OWNER = "integrations";`, commands registered once and read through the ref, and the `integrations.` id prefix. Pinned by: `app/src/screens/integrations/integrations.test.tsx` (`expect(owned(kernel)).toEqual(["integrations.connect-github"`).
- **`app/src/screens/integrations/integrations.css`** — keep: tokens only (`var(--space-3)` style), with no raw colour outside the token block.
- **`app/src/screens/team/Connectors.tsx`** — keep: `export async function changeGithubGrant` and its wording, and `data-testid="team-connector-github"`. Add MCP rows beside the GitHub row. Pinned by: `app/src/screens/team/connectors.test.tsx` (`describe("the Connectors row"`).
- **`app/src/screens/team/actions.ts`** — keep: `export function setAgentConnectors(api: StudioBridge, id: string, value: "github" | "none")` unchanged. Add a separate MCP setter, and never widen this one's value type.
- **`app/src/screens/team/Inspector.tsx`** — keep: `<Connectors granted={githubGranted(agent)}`. Only pass the new MCP props and handler. Wright has no detail route, so Wright's per-tool grant shows as unknown, never as "not granted".
- **`app/electron/open-external.test.ts`** — keep: one case per off-list form, and every existing case under `describe("the allowed forms"` and the refused groups unchanged. Add new cases for the kernel-answered form, and edit no existing case.
- **`app/electron/main.test.ts`** — keep: the existing `describe("the open-external channel"` cases unchanged (caller check, non-string, kernel not connected, port read at call time, failed open). Add the kernel-answered-URL cases beside them.
- **`app/src/screens/integrations/integrations.test.tsx`** — change only the pinned list `expect(owned(kernel)).toEqual(["integrations.connect-github"` and its titles assertion and the test's title line, to name the seven commands. Change nothing else.
- **`app/src/screens/team/connectors.test.tsx`** — keep: every case under `describe("the Connectors row"` and `describe("githubGranted and connectorStateText"` unchanged. Add MCP grant cases in a new `describe`.
- **`app/e2e/fixture-kernel.ts`** / **`app/e2e/fixtures/integrations.ts`** — keep: `"GET /repos/policy": () => ({ status: 200, body: { repos: [] } satisfies RepoPoliciesResponse }),` as the default (phase 7 specs rely on it) and `export const RAW_REFUSAL_MESSAGE = "RAW-KERNEL-MESSAGE do not render this";` as the refusal text a view must never show raw. Every answer `satisfies` its contract type.

## Closed enumerations touched

> Sibling grep at base `a0295e13178e7cd149385f1cc36a677beb5c3e3a`: `grep -rnF 'integrations.switch-to-app' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` → 7 hits in 6 files.

- **`integrations.connect-jira`, `integrations.connect-clickup`, `integrations.repo-policy`** (sibling: `integrations.switch-to-app`) — must be named in:
  - `app/src/screens/integrations/commands.ts` — the command list `integrationsCommands` (`id: "integrations.switch-to-app",`) — extend.
  - `app/src/screens/integrations/integrations.test.tsx` — the pinned owned list (`expect(owned(kernel)).toEqual(["integrations.connect-github"`) — extend; line 517's single-command check — no change: it reads one id.
  - `app/src/screens/integrations/switch.test.tsx` — `const SWITCH = "integrations.switch-to-app";` — no change: one id for the switch tests, not a list.
  - `docs/evidence/phase-7-polish/integrations/README.md` — phase 7's evidence narrative — no change: historical evidence, not a list of every command.
  - `docs/architecture/app.md` (line 124 paragraph) and `docs/DECISIONS.md` (D37) — prose about the switch — no change: not closed lists.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/integrations/integrations.test.tsx` — the seven-id command list | delete `id: "integrations.repo-policy",` in `app/src/screens/integrations/commands.ts` |
| `app/electron/open-external.test.ts` — a renderer-only https URL is refused | in `app/electron/open-external.ts`, make the kernel-answered check return true for any https URL (the reviewer applies it) |
| `app/electron/main.test.ts` — the kernel-answered `authorize_url` opens | in `app/electron/main.ts`, delete the line that records the request's answer (the reviewer applies it) |
| `app/src/screens/integrations/phase-8.test.tsx` — Trust unprotected needs a confirm | in `RepoPolicyCard.tsx`, send the POST on the first press, skipping the confirm (the reviewer applies it) |
| `app/src/screens/integrations/phase-8.test.tsx` — Accept sends one POST with the proposal's kind and N | in `RepoPolicyCard.tsx`, drop `required` from the Accept body (the reviewer applies it) |
| `app/src/screens/team/connectors.test.tsx` — the per-tool grant sends `{field: "connectors", value: "<kind>:<tool>[,…]"}` and `<kind>:none` | in `setAgentMcpTools` in `app/src/screens/team/actions.ts`, send `"none"` in place of the `<kind>:` value (the reviewer applies it) |
| `app/e2e/integrations-phase-8.spec.ts` — R2: the recorded `shell.openExternal` address equals the fixture's upgrade `url` | in `app/electron/main.ts`, delete the line that calls `rememberKernelUrl` (the reviewer applies it) |
| `app/src/screens/integrations/phase-8.test.tsx` — Upgrade on GitHub opens `https://github.com/settings/billing/plans` | in `RepoPolicyCard.tsx`, delete the `openExternalUrl` call for Upgrade on GitHub (the reviewer applies it) |
| `app/electron/open-external.test.ts` — the billing plans page is allowed and `/settings/billing` is refused | in `app/electron/open-external.ts`, delete the line that allows the billing plans path (the reviewer applies it) |
| `app/src/screens/integrations/phase-8.test.tsx` — Cancel calls the cancel route | in `actions.ts`, delete the line of the MCP cancel function that sends its request (the reviewer applies it) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Main process opens kernel-answered URLs and the two policy-card GitHub pages | S6, S7 (electron half), R2 (open path), S3 (allowlist half), S10 | 5 modify, 0 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Team per-tool MCP grant | S4 | 4 modify, 0 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 3 | Integrations views: MCP connect, App upgrade, repo policy card, palette | R1–R5, S1–S3, S5, S7 (renderer half) | 7 modify, 4 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 4 | E2E spec, fixtures and polish screenshots | R1–R5 (e2e), S8, S9 | 2 modify, 2+ create | `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1, #3) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/electron/open-external.ts", name: "isAllowedExternal"}
  - {kind: "symbol", path: "app/electron/open-external.ts", name: "rememberKernelUrl"}
  - {kind: "file", path: "app/electron/main.ts"}
  - {kind: "file", path: "app/electron/open-external.test.ts"}
  - {kind: "symbol", path: "docs/architecture/app.md", name: "The open-external channel"}
requires: []
lanes:
  - "app/electron/open-external.ts"
  - "app/electron/open-external.test.ts"
  - "app/electron/main.ts"
  - "app/electron/main.test.ts"
  - "docs/architecture/app.md"
external_requires: []

# Subtask 2
provides:
  - {kind: "symbol", path: "app/src/screens/team/actions.ts", name: "setAgentMcpTools"}
  - {kind: "symbol", path: "app/src/screens/team/Connectors.tsx", name: "changeMcpGrant"}
  - {kind: "file", path: "app/src/screens/team/connectors.test.tsx"}
requires: []
lanes:
  - "app/src/screens/team/Connectors.tsx"
  - "app/src/screens/team/actions.ts"
  - "app/src/screens/team/Inspector.tsx"
  - "app/src/screens/team/connectors.test.tsx"
external_requires: []

# Subtask 3
provides:
  - {kind: "file", path: "app/src/screens/integrations/McpConnect.tsx"}
  - {kind: "symbol", path: "app/src/screens/integrations/McpConnect.tsx", name: "McpConnect"}
  - {kind: "file", path: "app/src/screens/integrations/AppUpgrade.tsx"}
  - {kind: "symbol", path: "app/src/screens/integrations/AppUpgrade.tsx", name: "AppUpgrade"}
  - {kind: "file", path: "app/src/screens/integrations/RepoPolicyCard.tsx"}
  - {kind: "symbol", path: "app/src/screens/integrations/RepoPolicyCard.tsx", name: "RepoPolicyCard"}
  - {kind: "symbol", path: "app/src/screens/integrations/actions.ts", name: "connectMcp"}
  - {kind: "symbol", path: "app/src/screens/integrations/actions.ts", name: "setRepoPolicy"}
  - {kind: "symbol", path: "app/src/screens/integrations/commands.ts", name: "integrations.connect-jira"}
  - {kind: "file", path: "app/src/screens/integrations/phase-8.test.tsx"}
requires: []
lanes:
  - "app/src/screens/integrations/IntegrationsView.tsx"
  - "app/src/screens/integrations/McpConnect.tsx"
  - "app/src/screens/integrations/AppUpgrade.tsx"
  - "app/src/screens/integrations/RepoPolicyCard.tsx"
  - "app/src/screens/integrations/AppDetail.tsx"
  - "app/src/screens/integrations/model.ts"
  - "app/src/screens/integrations/actions.ts"
  - "app/src/screens/integrations/commands.ts"
  - "app/src/screens/integrations/integrations.css"
  - "app/src/screens/integrations/phase-8.test.tsx"
  - "app/src/screens/integrations/integrations.test.tsx"
external_requires: []

# Subtask 4
provides:
  - {kind: "file", path: "app/e2e/integrations-phase-8.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-8-polish/integrations/README.md"}
requires:
  - {from: "1", kind: "symbol", path: "app/electron/open-external.ts", name: "rememberKernelUrl"}
  - {from: "3", kind: "symbol", path: "app/src/screens/integrations/McpConnect.tsx", name: "McpConnect"}
  - {from: "3", kind: "symbol", path: "app/src/screens/integrations/RepoPolicyCard.tsx", name: "RepoPolicyCard"}
  - {from: "3", kind: "symbol", path: "app/src/screens/integrations/AppUpgrade.tsx", name: "AppUpgrade"}
lanes:
  - "app/e2e/integrations-phase-8.spec.ts"
  - "app/e2e/fixtures/integrations.ts"
  - "app/e2e/fixture-kernel.ts"
  - "docs/evidence/phase-8-polish/integrations/**"
external_requires:
  - "Playwright + Electron e2e runner (`npm run e2e` in app/)"
```

**Design notes for the workers** (data, not new scope):
- Design source: `docs/design/mockups/phase-8.html`, functions `listHTML`, `cnPane`, `toolsTable`, `jiraNote`, `appPane`, `polCard`, `polPane`, `presetsHTML`. The screenshots are in `docs/evidence/phase-8-mockup/` (`phase-8-jira-*`, `phase-8-clickup-*`, `phase-8-app-upgrade*`, `phase-8-policy-*`).
- The kernel's MCP connect is single-window like the App setup (`connect_in_progress` 409). The browser's return lands on the kernel's own loopback listener. The app learns of success only from a `connector_status` event followed by a `GET /connectors` re-read. Follow `AppSetupSheet.tsx`'s pattern: one call guarded by a ref, cancel on unmount, and a `false` open treated as a failure, never a silent no-op.
- `McpConnection.granted_tools` carries names only (no read-only hint), so the tools table shows no "Read / Changes things" badge the contract cannot back. Per-agent per-tool grants come from each crew member's `GET /agents/:id` `settings.content.connectors[<kind>]`. Wright's per-tool grant is unknown (no detail route), and the roster's kind-level `connectors` says only whether Wright holds the kind.
- Subtask 1's mechanism: `rememberKernelUrl(request, result, now)` (pure, in `open-external.ts`) records `authorize_url` per MCP kind (with its `expires_at`) and the upgrade `url`, and clears a kind on its cancel route. `isAllowedExternal` gains an optional remembered-set argument and allows an https string only when it is byte-equal to a live remembered URL. `main.ts` calls `rememberKernelUrl` in the `studio:request` handler after `kernel.request` answers.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 4
Subtask 3 ──→ Subtask 4
Subtask 2 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |
| Subtask 1 | Subtask 3 | none | NO |
| Subtask 2 | Subtask 3 | none | NO |
| Subtask 3 | Subtask 4 | none (4 only reads 3's views) | ordered by `requires` |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2, Subtask 3 (parallel, empty `requires`, disjoint lanes)
- **Batch 2:** Subtask 4 (after 1 and 3)
- **Recommended workers:** 3
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 4 | `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the open-external allowlist refuses the upgrade URL and every MCP `authorize_url`, and fixing it needs files outside Touches | HIGH | Recorded in `## Scope widening` (`pending-coordinator`) for the coordinator's re-gate. Subtask 1 keeps the existing three forms byte-for-byte and adds only "exactly what the kernel answered" plus two fixed github.com pages, so no renderer string can reach any other address |
| Feasibility (Phase 2.5): about 24 files is past one worker's context | MEDIUM | `context-bound` split into four subtasks with disjoint lanes |
| Prior churn (postmortem ledger): `IntegrationsView.tsx`, `fixture-kernel.ts`, `fixtures/integrations.ts`, `main.ts` and `main.test.ts` saw 14 rounds, mostly `self_heal_churn` (10) and `drain_churn` (3) | MEDIUM | Keep `IntegrationsView.tsx` edits to mounting and read state, keep fixture defaults unchanged (phase 7 specs depend on them), and run the full `npm test` and `npm run e2e` before hand-back, not only the new files |
| New reads on mount (`GET /repos/policy`, the upgrade URL) can surface errors in existing unit tests whose fake bridge does not answer them | MEDIUM | A failed policy or upgrade read shows inside its own section with its own testid, never the screen's `readError` or the unreachable band. Read the upgrade URL only when the App row is `needs_permissions` |
| The vendors' real authorize hosts and the system browser hand-off are unverified (`docs/architecture/mcp-connectors.md` "The system browser") | MEDIUM | The kernel-answered rule needs no host list. The live ClickUp run in the phase 8 exit verifies it, and Jira stays `not_exercised` |
| The mockup's per-tool "Read / Changes things" badge and Wright's per-tool grant have no contract field | LOW | Render only what the contract carries (design notes) and record the gap in the polish README |

## Configuration
- **Workers:** 3
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-08-integrations-mcp-connect-upgrade-policy.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-08T13:38:31Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/234
- **Branch:** feature/integrations-mcp-connect-upgrade-policy
- **Files changed:** 60
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** unknown (no_driver_handover)
- **Summary:** Phase 8 Integrations views (Jira/ClickUp MCP connect, App permission upgrade, repo policy card, 3 palette commands), Team per-tool MCP grant, main-process open of kernel-answered URLs + two fixed github.com pages, e2e spec + 36 polish screenshots. 4 subtasks (3 parallel + 1), merged clean; one heal fix (deduped mcpToolsHeld / MCP_KIND_LABELS into team/model.ts). typecheck, 2982 unit tests, build, 323 e2e and check-docs passed on the merged branch before the fix; the reviewer re-ran tsc and team/integrations vitest after it. Driver parked at execute-stop (Execute Manager has no TaskOutput to poll background workers); Phase 3 rest + FINALIZE completed inline by the Supervisor.

## Not verified
- **Real vendor authorize hosts and system-browser hand-off** — fixture uses auth.example.test with shell.openExternal stubbed; the live ClickUp run in the phase 8 exit verifies it (subtask 1, 4)
- **Kernel acceptance of the posted <kind>:<tool>,… grant value** — tested against the fake bridge only (subtask 2)
- **Team inspector MCP rows' rendered layout** — no runtime screenshot; reuses existing classes with native checkboxes (subtask 2)
- **Jira/ClickUp panes, App upgrade and policy card in a real window** — covered later by subtask 4's e2e over the fixture kernel (subtask 3)
