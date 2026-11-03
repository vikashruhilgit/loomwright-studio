# Supervisor Job: GitHub App with every repository permission, the `needs_permissions` upgrade state, and down-scoped session tokens (phase 8 item 03)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-02-150636/L3
- **CLAUDE.md:** ✓ Found (fresh: names phase 8 under way, kernel strict TS + vitest)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (disk 91% used, 38 GiB free; adequate)
- **Source requirement:** .supervisor/requirements/phase-8/2026-11-02-160003-github-app-every-permission-and-down-scoped-session-tokens.md
- **Base commit:** 0a41b7ef528a2194874e1bbe5128c3855d2f8abe

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest) and the Electron/React app's typed contract. No new dependency. |
| 2 | Dependency Availability | GO | Item 01 (PR #216, merged) declared `GET /connectors/github/app/upgrade` and `GitHubAppUpgradeResponse` in `app/src/api/contract.ts`. The GitHub REST mint endpoint is already allow-listed (`MINT_REQUEST`). |
| 3 | Architecture Fit | CAUTION | The requirement's Touches list was missing files that the change needs. The owner extended it on 2026-11-03, over two AskUserQuestion rounds: (a) `kernel/src/integrations/types.ts`, its pin `kernel/test/integrations-foundation.test.ts`, `app/src/api/contract.ts` and `app/src/screens/integrations/model.ts` ("Kernel pair + app mirror"); (b) `kernel/src/integrations/github/client.ts` and its test ("Extend client.ts"); (c) `kernel/src/integrations/github/tools.ts`, `kernel/src/triggers/poll.ts`, `kernel/src/playbooks/items.ts` and their pinning tests ("Keep reads working"). `app/src/screens/integrations/model.ts` overlaps item 12's Touches. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 23 files across kernel, app and docs, so it is past the context-bound bound (>12 files). Split into 2 sequential subtasks. |
| 5 | Hard Blockers | GO | None. The live github.com acceptance is not exercised in CI; every test runs on fakes. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Let the Studio GitHub App ask for every repository permission. The kernel then reports an install that has not yet accepted them as `needs_permissions`, answers the github.com URL where the owner fixes that, and mints a one-hour installation token for sessions, down-scoped to Pull requests, Contents, Issues and Checks on the named repos. The PAT path stays read-only.

**Problem Statement:**
The owner needs Studio to open PRs, push, reply and re-request reviewers as `<app>[bot]` (phase 8, D39), with no session holding more than the work needs.
Currently the App's manifest asks only for `pull_requests`/`contents`/`metadata` at read. The installation-token holder (`app-token.ts`) and `recordInstallation` (`app-port.ts`) refuse any write permission (`write_scoped` / `token_write_scoped`), and the owner's existing install is read-only.
That blocks every phase 8 write item (04, 05, 09, 10).
Success looks like this: a fresh manifest carries the pinned every-permission constant; an under-permissioned install reads `needs_permissions` with an upgrade URL and returns to `connected` once GitHub reports the full set; `mintSessionToken` sends exactly the four session permissions and the named repos and never persists the token; the token connection is still refused `token_write_scoped` for any write.

## Acceptance Criteria
1. [ ] Given a fresh App setup, when `GET /connectors/github/app/start` renders the manifest, then its `default_permissions` equals the pinned frozen constant `GITHUB_APP_PERMISSIONS`. That constant is every repository permission GitHub lets an App hold, each at `write` except where GitHub allows only `read` (e.g. `metadata`), and the start page no longer says "(read-only)". The list's GitHub doc source is cited in `docs/architecture/github-app-setup.md`.
2. [ ] Given an App install whose minted installation token reports fewer permissions than `GITHUB_APP_PERMISSIONS` (a missing name, or `read` where the constant has `write`), when `recordInstallation` runs or the App mint due work (`checkGitHubAppMint`) next runs, then the `method: app` row reads `needs_permissions` (one `connector_status` event). `GET /connectors/github/app/upgrade` then answers `200 {url}` with exactly `https://github.com/settings/apps/{app_slug}/permissions`. `app_slug` comes from the row. The manifest flow posts to `github.com/settings/apps/new`, so Studio's App is always owned by the user account and the `/organizations/{org}/…` form never applies. `url` is `null` when the row is not `needs_permissions` or has no `app_slug`.
3. [ ] Given a row reading `needs_permissions`, when a later mint reports the full `GITHUB_APP_PERMISSIONS` set, then the next `checkGitHubAppMint` run moves the row to `connected` (one `connector_status` event) and the upgrade route answers `{url: null}`.
4. [ ] Given an App install that reports write permissions, when the holder (`createGitHubAppTokens().current()`) mints or `recordInstallation` runs, then the token is accepted (no `write_scoped` / `token_write_scoped` refusal on the App path), and the App's Keychain items are kept.
5. [ ] Given `mintSessionToken(store, ["vikashruhilgit/studio-sandbox"])` with an App row that reaches that repo and holds the session permissions, when it mints, then the one `POST /app/installations/{id}/access_tokens` request carries a JSON body whose `permissions` deep-equals the frozen `SESSION_TOKEN_PERMISSIONS` (`{pull_requests: "write", contents: "write", issues: "write", checks: "write"}`) and whose `repositories` is exactly `["studio-sandbox"]`. It answers `{ok: true, token, expires_at}`, and a test asserts the token string appears in no `events`, `connectors` or `notifications` row and in no console output.
6. [ ] Given `mintSessionToken` with a repo not in the row's `reachable_repos` (case-insensitive), then it answers `{ok: false, error: "repo_not_reached"}` with no request sent. Given an App row whose reported permissions lack any `SESSION_TOKEN_PERMISSIONS` entry at write, it answers `{ok: false, error: "needs_permissions"}` with no request sent.
7. [ ] Given a token (PAT) connection whose GitHub-reported permissions include a write, when it is set, then it is still refused `token_write_scoped` (the existing `connector.ts` refusal and its tests unchanged).
8. [ ] Given the connector row reads `needs_permissions`, when the read tools (`tools.ts` `requireReach`), the PR poll source (`poll.ts` `githubConnectorState`) or playbook items (`items.ts` `connectorUsable`) check the connector, then they treat it as usable exactly like `connected`, each pinned by a test row.
9. [ ] Given the app contract, then `ConnectorStatus` in `app/src/api/contract.ts` includes `"needs_permissions"` and `STATE_OF_STATUS` in `app/src/screens/integrations/model.ts` maps it to `"connected"` (item 12 builds the upgrade view on top), pinned by a row in `app/src/screens/integrations/model.test.ts`.
10. [ ] Given the docs, then `docs/architecture/github-app-setup.md` and `docs/architecture/integrations.md` record the permission constant, the `needs_permissions` state and its upgrade route (including the two github.com steps: edit the App's permissions, then accept on the installation, marked unverified until the live run), the down-scoped `mintSessionToken`, and that the PAT path stays read-only. `bash scripts/check-docs.sh` passes.
11. [ ] Validation passes: `cd kernel && npm ci && npm run typecheck && npm test`, `cd app && npm ci && npm run typecheck && npm test`, and `bash scripts/check-docs.sh`.

**Design notes (binding for the worker):**
- `GITHUB_APP_PERMISSIONS` and `SESSION_TOKEN_PERMISSIONS` live in `app-token.ts` (every App file imports it, and it imports no sibling but `client.ts`), are `Object.freeze`d, and are exported. `app-setup.ts` uses `default_permissions: GITHUB_APP_PERMISSIONS`.
- `client.ts`: `mintInstallationToken(installationId, jwt, deps, body?)` takes an optional `{repositories?: readonly string[]; permissions?: Readonly<Record<string,string>>}`. `sendRequest` gains an optional JSON body (with `content-type: application/json`) and sends no body when it is absent, so the existing mint is byte-identical. `GITHUB_ALLOWED_NON_GET`, the origin check and `redirect: "manual"` are unchanged (D39: the two-call allowlist is not changed).
- The holder (`app-token.ts`) drops its write refusal: `writePermissionsOf` and `READ_ONLY_LEVELS` stay, because `connector.ts` re-exports them and the PAT path uses them. It exposes the permissions GitHub reported on the latest successful mint, and a `mintScoped(body)` that signs a JWT, mints with the body, returns `{token, expires_at, permissions}` and never holds or caches the scoped token. A scoped token whose reported permissions exceed `SESSION_TOKEN_PERMISSIONS` (ignoring GitHub's implicit `metadata: read`) is refused and dropped (fail-closed).
- `mintSessionToken(store, repos, deps?)` is a standalone export of `app-port.ts` (which already imports the connector row helpers), not a new `GitHubAppPort` method. It reads the reach list and permissions from the row, maps `owner/name` to `name`, refuses a repo whose owner is not the row's `account_login`, and never logs, stores or emits the token. Item 04 consumes it.
- `needs_permissions` counts as in use: connector.ts `TOKEN_IN_USE` gains it, so `isCredentialInUse`, refresh and `refuse()` treat it like `connected`. The `needs_permissions` ⇄ `connected` transition is applied inside the existing `checkGitHubAppMint` due work (no new due work, so the `integrations-foundation.test.ts` due-work pin keeps its two entries).
- `poll.ts` and `items.ts` never import integrations values ("the triggers feature never imports the integrations feature's values"), so they add the `"needs_permissions"` literal inline. `tools.ts` uses `isCredentialInUse`.
- The upgrade route is authenticated (the owner's bearer token) and is served by `githubConnectorPart.routes` in `connector.ts` (today `routes: Object.freeze([])`), NOT by `githubAppRoutes()` / `app-routes.ts`. `kernel/test/integrations-github-app-contract.test.ts` pins `githubAppRoutesPart.routes` as exactly the five setup routes, and that file is in no lane. In `integrations-foundation.test.ts`, the merged-contribution test (App routes matched by prefix with `arrayContaining`) stays green. Its part pin `expect(connector?.routes).toEqual([]);` (`connector` is `INTEGRATIONS_PARTS[0]`, the github-connector part) DOES change: it now pins that part's routes as exactly `["GET /connectors/github/app/upgrade"]` (method and path). The route is not in `UNAUTHENTICATED_ROUTE_PATHS`.
- `checkGitHubAppMint` / `applyGitHubAppMintFailure` is restructured: it reads the holder's latest reported permissions (a new read-only getter, e.g. `lastReportedPermissions`) and applies the `needs_permissions` ⇄ `connected` transition to a `method: app` row BEFORE the existing `lastMintFailure === undefined` early return. A recorded 401/404 failure still wins (→ `rejected`).
- Dead App-path write refusal is removed on purpose: the `write_scoped` member of `GitHubAppTokenError`, the `write_permissions` variant of `GitHubAppMintFailure`, `recordInstallation`'s `refuseWriteScoped` branch, and the write-permission branch of the rejected-App notification text in `connector.ts`. `writePermissionsOf`, `READ_ONLY_LEVELS`, `GITHUB_APP_SETUP_REFUSALS` (including `token_write_scoped`) and the app-setup refusal page entry stay (closed sets, or used by the PAT path).

## Touched-file invariants

> Grounded at base `0a41b7ef528a2194874e1bbe5128c3855d2f8abe`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/github/app-token.ts`** — keep: never throws and never logs, failures are closed values: `Nothing here logs, and no failure carries a message`; the token lives in holder memory only: `never in\n//     the store, a file, an event or a log` (comment text `the installation token lives in the holder's memory`); imports only types, `node:crypto`, the Keychain module and the client: `imports only types,`; reuse: `signAppJwt`, `decodeAppKey` and `readItem` for `mintScoped`, and keep `writePermissionsOf` exported: `export function writePermissionsOf(`; pinned by: `kernel/test/integrations-github-app-token.test.ts` (the write-scoped tests are rewritten to "accepted").
- **`kernel/src/integrations/github/app-port.ts`** — keep: every call on the shared credential lock: `return lock.run(guarded);`; no secret in a message: `` `client_secret` is not a parameter anywhere``; the PAT is deleted only after the installation succeeds: `The App replaces the token connection: its Keychain item goes.`; mirror: the row columns written by `recordInstallation` (`permissions_source = 'reported'`); pinned by: `kernel/test/integrations-github-app-port.test.ts`.
- **`kernel/src/integrations/github/app-setup.ts`** — keep: private App, no webhook: `public: false,` and `No \`hook_attributes\``; no page echoes request data: `never anything from the request`; `GITHUB_APP_SETUP_STATUS` and `REFUSAL_PAGES` stay closed records over `GitHubAppSetupRefusal` (keep the `token_write_scoped` entry: the closed set in types.ts keeps it); pinned by: `kernel/test/integrations-github-app-setup.test.ts` (`expect(manifest["default_permissions"])`).
- **`kernel/src/integrations/github/connector.ts`** — keep: the PAT write refusal: `return refuse(store, "token_write_scoped", writeScopedMessage(writes), now().toISOString(), { write_permissions: writes });`; the in-use set is the single authority: `const TOKEN_IN_USE: readonly ConnectorStatus[] = ["connected", "expiring"];` (extend only); the mint-failure due work clears once: `tokens.clearMintFailure();`; an `app` row raises no expiry warning: `if (row.method === "app") return;`; the part keeps its due-work list exactly as it is (`dueWork: Object.freeze([`) and gains the upgrade route in `routes: Object.freeze([])`; it imports only types, the feature seam, the Keychain, the client, the lock, the store helpers and the CLI verb: `never the Agent SDK, the session manager or \`kernel.ts\``; pinned by: `kernel/test/integrations-github-connector.test.ts` (`expect(githubConnectorPart.dueWork).toEqual([githubExpiryDueWork, checkGitHubAppMint]);`), `kernel/test/integrations-github-app-port.test.ts` (`expect(githubConnectorPart.dueWork).toContain(checkGitHubAppMint);`), `kernel/test/integrations-foundation.test.ts` (`expect(connector?.routes).toEqual([]);`, which changes to pin exactly the upgrade route; the merged-contribution test matches App routes by prefix and stays green) and `kernel/test/feature-seams.test.ts` (module graph). Not touched: `app-routes.ts` and its exact five-route pin in `kernel/test/integrations-github-app-contract.test.ts` (`serves all five under the App part`).
- **`kernel/src/integrations/github/client.ts`** — keep: `if (!isAllowedGitHubRequest(method, url)) return { kind: "failure", failure: UNREACHABLE };`, `redirect: "manual",`, `export const GITHUB_ALLOWED_NON_GET: readonly GitHubAllowedRequest[] = Object.freeze([MINT_REQUEST, CONVERT_REQUEST]);` (unchanged); never throws: `// A network error, a timeout or an abort mid-body. Its message is dropped:`; pinned by: `kernel/test/integrations-github-client.test.ts` (`GITHUB_ALLOWED_NON_GET`).
- **`kernel/src/integrations/types.ts`** — keep: closed in code, no SQL CHECK; extend `export const CONNECTOR_STATUSES = Object.freeze(["connected", "rejected", "disconnected", "expiring", "expired"] as const);` by appending `"needs_permissions"`, and leave `GITHUB_APP_SETUP_REFUSALS` unchanged; pinned by: `kernel/test/integrations-foundation.test.ts` (`expect(CONNECTOR_STATUSES).toEqual(`).
- **`kernel/src/integrations/github/tools.ts`** — keep: the refusal text `no connected GitHub connector (status`; replace the inline check `if (row === undefined || !(row.status === "connected" || row.status === "expiring")) {` with `isCredentialInUse(row.status)` (already importable from `./connector.js`); pinned by: `kernel/test/integrations-github-tools.test.ts` (`it.each(["connected", "expiring"])`).
- **`kernel/src/triggers/poll.ts`** — keep: `the\n * triggers feature never imports the integrations feature's values` (comment anchor `triggers feature never imports the integrations feature's values`), so the change is inline: `const usable = rows.find((r) => r.status === "connected" || r.status === "expiring");`; pinned by: `kernel/test/triggers-poll.test.ts` (`setConnector(store, "expiring");`).
- **`kernel/src/playbooks/items.ts`** — keep: `return status === "connected" || status === "expiring";` extended inline (the file imports only `import type { SourceItem } from "../integrations/types.js";`); pinned by: `kernel/test/playbooks-runs-items.test.ts` (`["connected", "expiring"].entries()`).
- **`app/src/api/contract.ts`** — keep: the kernel-to-app mirror: `export type ConnectorStatus = "connected" | "rejected" | "disconnected" | "expiring" | "expired";` (append `| "needs_permissions"`); `GitHubAppUpgradeResponse` stays `readonly url: string | null;`; pinned by: `kernel/test/console-contract.test.ts` (routes read as text; the route list is not changed).
- **`app/src/screens/integrations/model.ts`** — keep: an exhaustive record: `export const STATE_OF_STATUS: Readonly<Record<ConnectorStatus, DesignedState>> = Object.freeze({`; pinned by: `app/src/screens/integrations/model.test.ts` (`["expiring", "expiring"],`).

## Closed enumerations touched

> Sibling grep at base `0a41b7ef528a2194874e1bbe5128c3855d2f8abe`: `grep -rnF '"expiring"' --exclude-dir=node_modules --exclude=CHANGELOG.md kernel app/src docs`, which gives about 75 hits in about 30 files. Most are the unrelated auth-health `expiring` (`kernel/src/auth/*`, `app/src/screens/settings/*`).

- **`needs_permissions`** (sibling: `expiring`), a connector status, must be named in:
  - `kernel/src/integrations/types.ts`: `CONNECTOR_STATUSES` (`Object.freeze(["connected", "rejected", "disconnected", "expiring", "expired"] as const)`). Extend.
  - `kernel/test/integrations-foundation.test.ts`: `expect(CONNECTOR_STATUSES).toEqual([...])`. Extend.
  - `kernel/src/integrations/github/connector.ts`: `TOKEN_IN_USE`. Extend.
  - `kernel/src/integrations/github/tools.ts`: `requireReach`'s inline in-use check. Extend (via `isCredentialInUse`).
  - `kernel/src/triggers/poll.ts`: `githubConnectorState`'s `usable`. Extend.
  - `kernel/src/playbooks/items.ts`: `connectorUsable`. Extend.
  - `app/src/api/contract.ts`: `ConnectorStatus`. Extend.
  - `app/src/screens/integrations/model.ts`: `STATE_OF_STATUS`. Extend (maps to `"connected"`).
  - `app/src/screens/integrations/IntegrationsView.tsx`, `AppDetail.tsx`, `AppSetupSheet.tsx`, `app/src/screens/team/model.ts` (the `connected || expiring` display checks). No change: UI belongs to item 12 (and `team/model.ts` to no item). A `needs_permissions` row shows through `STATE_OF_STATUS` as connected and otherwise falls back to the existing non-connected wording. Recorded as a risk.
  - `kernel/src/store/migrations/017_phase_6_foundation.ts`: a comment naming `CONNECTOR_STATUSES`. No change: there is no SQL CHECK ("every value set below is closed in code (no SQL CHECK)").
  - `kernel/src/auth/*`, `app/src/screens/settings/*`, `kernel/test/auth.test.ts`, `cli.test.ts`, `api.test.ts`, `gui-settings.test.ts`: the auth-provider health `expiring`. No change: a different enum.
  - `kernel/test/phase-6-exit-live.test.ts:621`: the live exit check. No change: a live-only check of a token row.
- **`repo_not_reached`, `needs_permissions`** (a new closed type `GitHubSessionTokenError` in `app-port.ts`, together with the holder's mint failures): no existing closed list names session-token refusals. `GITHUB_TOOL_REFUSALS`' `repo_not_reachable` is a different, tool-side set and does not change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-foundation.test.ts` — `expect(CONNECTOR_STATUSES).toEqual(` | flip `"expired", "needs_permissions"] as const` → `"expired"] as const` in `kernel/src/integrations/types.ts` |
| `kernel/test/integrations-foundation.test.ts` — the github-connector part's routes are exactly `GET /connectors/github/app/upgrade` | remove the upgrade route from `githubConnectorPart`'s `routes` in `kernel/src/integrations/github/connector.ts` (back to `routes: Object.freeze([])`) |
| `kernel/test/integrations-github-app-setup.test.ts` — `expect(manifest["default_permissions"])` | flip `default_permissions: GITHUB_APP_PERMISSIONS,` → `default_permissions: { pull_requests: "read", contents: "read", metadata: "read" },` in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-token.test.ts` — `GITHUB_APP_PERMISSIONS` / `SESSION_TOKEN_PERMISSIONS` frozen-value pins | flip `checks: "write"` → `checks: "read"` in `kernel/src/integrations/github/app-token.ts` (inside `SESSION_TOKEN_PERMISSIONS`) |
| `kernel/test/integrations-github-app-port.test.ts` — the mint body carries exactly `SESSION_TOKEN_PERMISSIONS` and one repo | flip `permissions: SESSION_TOKEN_PERMISSIONS` → `permissions: GITHUB_APP_PERMISSIONS` in `kernel/src/integrations/github/app-port.ts` |
| `kernel/test/integrations-github-app-port.test.ts` — `repo_not_reached`, no request sent | remove the reach-list check in `mintSessionToken` in `kernel/src/integrations/github/app-port.ts` (the pin goes red: a request is sent) |
| `kernel/test/integrations-github-app-port.test.ts` — the token is in no row, event or log | make `mintSessionToken` append its token to the `connector_status` event payload in `kernel/src/integrations/github/app-port.ts` |
| `kernel/test/integrations-github-client.test.ts` — the optional mint body is sent only when given | always send `body: JSON.stringify({})` from `sendRequest` in `kernel/src/integrations/github/client.ts` |
| `kernel/test/integrations-github-connector.test.ts` — `GET /connectors/github/app/upgrade` answers `https://github.com/settings/apps/{app_slug}/permissions` for a `needs_permissions` row | replace that template with `https://github.com/settings/installations/{installation_id}` in the upgrade route in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-connector.test.ts` — `needs_permissions` ⇄ `connected` via `checkGitHubAppMint` | remove the permission comparison from `applyGitHubAppMintFailure`'s due-work path in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-connector.test.ts` — the PAT write refusal (existing) | delete `return refuse(store, "token_write_scoped", writeScopedMessage(writes), now().toISOString(), { write_permissions: writes });` in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-tools.test.ts` — a `needs_permissions` connector reads | flip `["connected", "expiring", "needs_permissions"]` → `["connected", "expiring"]` in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/triggers-poll.test.ts` — a `needs_permissions` connector polls | flip `r.status === "expiring" \|\| r.status === "needs_permissions"` → `r.status === "expiring"` in `kernel/src/triggers/poll.ts` |
| `kernel/test/playbooks-runs-items.test.ts` — a `needs_permissions` connector does not park | flip `status === "expiring" \|\| status === "needs_permissions"` → `status === "expiring"` in `kernel/src/playbooks/items.ts` |
| `app/src/screens/integrations/model.test.ts` — `["needs_permissions", "connected"]` | flip `needs_permissions: "connected",` → `needs_permissions: "none",` in `app/src/screens/integrations/model.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel GitHub App: every-permission manifest, write-accepting holder, `needs_permissions` state and upgrade route, down-scoped `mintSessionToken`, docs | 1, 2, 3, 4, 5, 6, 7, 10, 11 (kernel + docs) | 14 modify, 0 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md`, `skills/context7-lookup/SKILL.md` | LAUNCHABLE |
| 2 | `needs_permissions` counts as usable: read tools, PR poll, playbook items, app contract mirror | 8, 9, 11 (app) | 9 modify, 0 create | `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1 — kernel GitHub App core (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/integrations/types.ts", name: "CONNECTOR_STATUSES"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "GITHUB_APP_PERMISSIONS"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "SESSION_TOKEN_PERMISSIONS"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-port.ts", name: "mintSessionToken"}
  - {kind: "symbol", path: "kernel/src/integrations/github/connector.ts", name: "isCredentialInUse"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "mintInstallationToken"}
  - {kind: "symbol", path: "kernel/src/integrations/github/connector.ts", name: "githubConnectorPart"}
  - {kind: "file", path: "docs/architecture/github-app-setup.md"}
  - {kind: "file", path: "docs/architecture/integrations.md"}
requires: []
lanes:
  - "kernel/src/integrations/types.ts"
  - "kernel/src/integrations/github/client.ts"
  - "kernel/src/integrations/github/app-token.ts"
  - "kernel/src/integrations/github/app-port.ts"
  - "kernel/src/integrations/github/app-setup.ts"
  - "kernel/src/integrations/github/connector.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/integrations-github-client.test.ts"
  - "kernel/test/integrations-github-app-token.test.ts"
  - "kernel/test/integrations-github-app-port.test.ts"
  - "kernel/test/integrations-github-app-setup.test.ts"
  - "kernel/test/integrations-github-connector.test.ts"
  - "docs/architecture/github-app-setup.md"
  - "docs/architecture/integrations.md"
external_requires:
  - "GitHub REST: POST /app/installations/{installation_id}/access_tokens accepts a JSON body with `repositories` (repo names) and `permissions` (docs.github.com, API version 2022-11-28)"
  - "GitHub's list of repository permissions a GitHub App may request, and which levels each accepts (docs.github.com, 'Permissions required for GitHub Apps' / App manifest parameters)"

# Subtask 2 — needs_permissions counts as usable; app mirror (BLOCKED by #1)
provides:
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "ConnectorStatus"}
  - {kind: "symbol", path: "app/src/screens/integrations/model.ts", name: "STATE_OF_STATUS"}
  - {kind: "file", path: "kernel/src/integrations/github/tools.ts"}
  - {kind: "file", path: "kernel/src/triggers/poll.ts"}
  - {kind: "file", path: "kernel/src/playbooks/items.ts"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/types.ts", name: "CONNECTOR_STATUSES"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/connector.ts", name: "isCredentialInUse"}
lanes:
  - "kernel/src/integrations/github/tools.ts"
  - "kernel/src/triggers/poll.ts"
  - "kernel/src/playbooks/items.ts"
  - "kernel/test/integrations-github-tools.test.ts"
  - "kernel/test/triggers-poll.test.ts"
  - "kernel/test/playbooks-runs-items.test.ts"
  - "app/src/api/contract.ts"
  - "app/src/screens/integrations/model.ts"
  - "app/src/screens/integrations/model.test.ts"
external_requires: []
```

### File Impact Map (module layout: lines at base, threshold per `skills/supervisor-readiness/SKILL.md` §"Module layout")

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 kernel App core | `kernel/src/integrations/types.ts` (319), `kernel/src/integrations/github/client.ts` (754, extends the existing `mintInstallationToken`/`sendRequest`; no new responsibility: an optional body on the one guarded request path), `kernel/src/integrations/github/app-token.ts` (315, home of both permission constants and `mintScoped`), `kernel/src/integrations/github/app-port.ts` (363, home of `mintSessionToken`), `kernel/src/integrations/github/app-setup.ts` (387), `kernel/src/integrations/github/connector.ts` (779, append: the single authority for the row's status transitions and `checkGitHubAppMint`, and home of the upgrade route on `githubConnectorPart`, which already reads the row) | — | HIGH |
| 1 kernel tests | `kernel/test/integrations-foundation.test.ts` (881, two pin lines: `CONNECTOR_STATUSES` and the github-connector part's routes), `kernel/test/integrations-github-client.test.ts` (1085, append: the suite that pins `sendRequest`), `kernel/test/integrations-github-app-token.test.ts` (858, append: the holder's own suite), `kernel/test/integrations-github-app-port.test.ts` (1038, append: the port's own suite, home of the `mintSessionToken` tests), `kernel/test/integrations-github-app-setup.test.ts` (981, append: the manifest and route-list pins live here), `kernel/test/integrations-github-connector.test.ts` (1117, append: the `checkGitHubAppMint` suite lives here) | — | HIGH |
| 1 docs | `docs/architecture/github-app-setup.md` (85), `docs/architecture/integrations.md` (220) | — | HIGH |
| 2 consumers | `kernel/src/integrations/github/tools.ts` (194), `kernel/src/triggers/poll.ts` (555, one-line literal; the reader's own module), `kernel/src/playbooks/items.ts` (228), `app/src/api/contract.ts` (1604, one union member; the single typed mirror), `app/src/screens/integrations/model.ts` (372) | — | HIGH |
| 2 tests | `kernel/test/integrations-github-tools.test.ts` (439), `kernel/test/triggers-poll.test.ts` (813, one test row in the existing suite), `kernel/test/playbooks-runs-items.test.ts` (736, one test row in the existing suite), `app/src/screens/integrations/model.test.ts` (328) | — | HIGH |

`kernel/test/fixtures/github-fake.ts` (in the requirement's Touches) is not expected to change: the mint tests drive an injected `fetch`, as the app-token and app-port suites do today. A worker that does need it stops and says so; it is not in any lane.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (2 type-depends on 1's `CONNECTOR_STATUSES` and `isCredentialInUse`) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md`, `skills/context7-lookup/SKILL.md` (GitHub's App permission list and the access-token body) |
| 2 | `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the requirement's Touches missed files. The owner extended them on 2026-11-03 (types.ts + foundation test, app contract + integrations model; client.ts + its test; tools.ts, poll.ts, items.ts + tests) | MEDIUM | Lanes list exactly these files. Any other file means stop and say so (owner rule). The PR body cites the owner's three answers. |
| Feasibility (Phase 2.5): `app/src/screens/integrations/model.ts` (and `model.test.ts`) overlap item 12's Touches | MEDIUM | Change only `STATE_OF_STATUS` plus one test row, so item 12 rebases over a one-line diff. |
| The App holds every permission, so a leaked key has a wide blast radius (requirement risk) | HIGH | The key stays in the Keychain. Sessions only ever get `mintSessionToken`'s down-scoped token, which is refused when GitHub reports more than `SESSION_TOKEN_PERMISSIONS`. |
| The daemon's own holder token (polls, read tools) now carries the App's full permissions, because its mint sends no body | MEDIUM | Out of scope (the requirement keeps the holder's role). Recorded in `docs/architecture/integrations.md` as a follow-up: the holder could mint with a read-only `permissions` body through the same new client parameter. |
| GitHub's exact list of App repository permissions and allowed levels (some are read-only, e.g. `metadata`) | MEDIUM | Ground the constant in GitHub's docs (context7 or docs.github.com), cite the source in `github-app-setup.md`, and pin it with a test. An unknown name would fail App creation at github.com, which CI cannot catch, so the live run (item 14) is the check. |
| The upgrade URL: an existing App created read-only must first have its permissions edited at `https://github.com/settings/apps/{slug}/permissions`, then the installation accepts them at `https://github.com/settings/installations/{installation_id}`; the contract carries one `url` | MEDIUM | The route answers exactly the App's permissions page (step 1, AC 2), and the docs record both steps, marked NEEDS VERIFICATION until item 14's live run. The kernel never writes to GitHub here. |
| `repositories` in the mint body takes repo names (no owner), so all named repos must share the installation's account | LOW | `mintSessionToken` refuses an owner other than the row's `account_login` before any request (fail-closed) and sends names only. A test pins the body. |
| App UI files outside every Touches (`IntegrationsView.tsx`, `AppDetail.tsx`, `AppSetupSheet.tsx`, `team/model.ts`) still test `connected \|\| expiring`, so a `needs_permissions` row may show non-connected wording there | LOW | Item 12 owns the upgrade view. `STATE_OF_STATUS` maps it to connected so the main card stays right. No change here (owner scope). |
| Rewriting the App-path write-refusal tests (`write_scoped` in app-token, `token_write_scoped` in app-port and app-setup) could silently drop the PAT refusal | MEDIUM | AC 7 and the existing connector pin (Pin mutations row) keep the PAT path red-on-mutation. `GITHUB_APP_SETUP_REFUSALS` is unchanged. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-03-github-app-permissions-session-tokens.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-11-03T05:10:36Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/220
- **Branch:** feature/github-app-permissions-session-tokens
- **Files changed:** 29
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Two sequential subtasks (434eced kernel App core + docs, 89dbd5a needs_permissions consumers + app mirror) and one Phase 4.5 fix round (72d0f5a: Refresh invalidates the holder token on a needs_permissions App row and re-applies the reported permissions; 6 restated usable-status docs updated under the owner's 2026-11-03 scope extension). Review round 2 PASS; 3 LOW findings dismissed (marker comment posted). Kernel 3386 passed, app green, check-docs OK, required CI green. Pin-mutation runner unsupported (all rows unverified); the reviewers applied all 15 by hand and each went red. risk_classification high_risk=true (token/secret paths, size).

## Not verified
- **App manifest creation on github.com** — whether GitHub accepts every name in GITHUB_APP_PERMISSIONS and reports each on the installation token needs the live run (item 14) (subtask 1)
- **The two github.com upgrade steps** — editing the App's permissions, then accepting on the installation; marked NEEDS VERIFICATION in the docs (subtask 1)
- **Completeness of the 'every permission' list** — docs.github.com lists repository permissions the REST schema omits; they are left out and recorded in github-app-setup.md (subtask 1)
- **App UI screens (IntegrationsView.tsx, AppDetail.tsx, AppSetupSheet.tsx)** — they still test connected||expiring directly; item 12 owns them (subtask 2)
