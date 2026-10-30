# Supervisor Job: GitHub App 2 — kernel App credentials and installation tokens

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-29-234434/L2
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/github-app/2026-10-29-174813-kernel-github-app-installation-tokens.md
- **Base commit:** 2b5a47d7d25b6a3a2ab3c27902bbc0ec29a66a91

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript + vitest kernel; RS256 signing uses Node's built-in `node:crypto` (`createSign`), as probe p13 did (`probes/p13-github-app-manifest.mjs`, `function appJwt()`). No new dependency. |
| 2 | Dependency Availability | CAUTION | Everything is in-tree, but the App's key (`pem`, ~1.7 KB) must pass `WRITE_ARG` (`kernel/src/auth/keychain.ts`) to reach `security -i`, so it is stored encoded (base64url, ~2.3 KB on one stdin line). Whether `security -i` takes a line that long is unverified on a real Keychain. |
| 3 | Architecture Fit | GO | Wave 1 fixed the contract: `GitHubAppPort`, `ConnectorRow.method/app_slug/installation_id`, `GITHUB_APP_SETUP_REFUSALS` (`kernel/src/integrations/types.ts`), the stub `github/app-port.ts`. This item fills them in. Invariants 2, 3, 5, 6 and 8 hold: the kernel owns minting, everything stays read-only, GitHub stays optional, and no claude.ai login is involved. |
| 4 | Scope vs Supervisor Capability | CAUTION | 22 files (10 source modify, 2 source create, 6 test modify, 3 test create, 1 doc). Over the context-bound bound (> 12 files), so the work splits into 2 sequential subtasks. |
| 5 | Hard Blockers | GO | No missing module. Migration framework present (`kernel/src/store/migrations/`, append-only). |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the wave 1 `GitHubAppPort` real. The kernel keeps the App's credentials in the Keychain and mints, renews and uses short-lived installation tokens whose permissions and repos GitHub reports. The client sends only GETs plus the two allowlisted POSTs.

**Problem Statement:**
The owner needs the kernel to read GitHub with installation tokens, so read-only is proven by GitHub rather than declared, a leaked token dies within the hour, and Studio reaches exactly the repos chosen at install.
Currently `GitHubClient` (`kernel/src/integrations/github/client.ts`) reads one long-lived PAT from the Keychain item `loomwright-studio-github` and sends GETs only. The connector knows one credential kind, and every port method answers `not_implemented`.
Success looks like this: `recordInstallation` leaves the row `connected` with `method: app` and `permissions_source: reported`, listing only the installed repos. Polls, dry runs and tools use the installation token, renewed silently. Nothing anywhere carries the `pem`, a JWT or an installation token.

**Design decisions this brief fixes (from the requirement and its owner decisions; workers do not reopen them):**
- **One credential at a time** (requirement "Assumptions"). The method in use is resolved **per call, with no read at construction**:
  - the PAT Keychain item (`GITHUB_KEYCHAIN_SERVICE`) present ⇒ `token`;
  - otherwise the App items (installation id and key) present ⇒ `app`;
  - otherwise none (`unreachable`, as today with no token).

  A Keychain rule is needed because `daemonKernelDeps()` has no store when it builds the client (`kernel/src/daemon-deps.ts`). Every writer keeps the connector row's `method` column in step with that rule:
  - `recordInstallation` success deletes the PAT item;
  - `setToken` success writes `method = 'token'` and nulls `app_slug` / `installation_id`, with no other token-path change;
  - disconnect deletes **every** GitHub credential item (PAT and App), whichever is current.
- **Keychain item names** (wave 1 left them to this item). Each is a generic password with account `GITHUB_KEYCHAIN_ACCOUNT` (`loomwright-studio`):
  - `loomwright-studio-github-app-id`
  - `loomwright-studio-github-app-slug`
  - `loomwright-studio-github-app-installation`
  - `loomwright-studio-github-app-key`

  The key item holds the `pem` as unpadded base64url. The `pem` must start with `-----BEGIN` before it is encoded, which guarantees the encoded form passes `WRITE_ARG`. Every write is trusted only after a read-back that matches. `client_secret` is never a parameter anywhere.
- **Installation tokens live in memory only**, in one process-wide holder (`githubAppTokens`, `app-token.ts`). Polls, tools and routes in the daemon process share it.
- **Expiry and rejection.** `checkGitHubExpiry` skips a `method: app` row: renewal is silent, and the hourly `expires_at` is never owner-actionable. A mint answered 401 or 404 is recorded on the holder (`lastMintFailure`). A due-work function in `connector.ts` (`checkGitHubAppMint`) applies it to the row: `rejected`, plus one notification `kernel:github_app_rejected` on the transition into `rejected` only.
- **No new closed-list value.** Port failures use the existing `GitHubAppPortError` values:
  - `token_write_scoped`;
  - `install_failed` (a mint, reach-list or Keychain failure in `recordInstallation`);
  - `conversion_failed` (a `pem` that is not PEM-shaped, or a Keychain failure in `storeApp`).

  `ConnectorErrorCode`, `CONNECTOR_ERROR_STATUS` and the app's `contract.ts` unions are not extended.

## Acceptance Criteria

**Happy path:**
- [ ] AC1 — Given App credentials stored through the port and a fake GitHub that reports read permissions, when `recordInstallation` runs, then the connector reads `connected`, with `method: app`, `permissions_source: reported`, and only the installed repos (from `GET /installation/repositories`).
- [ ] AC2 — Given `method: app`, when a due poll, a poll dry run or a GitHub tool reads GitHub, then it uses the installation token. Given `method: token`, it uses the PAT, unchanged.
- [ ] AC3 — Given a token within 5 minutes of `expires_at`, or a 401, when the next call is made, then a new token is minted first. A 401 triggers at most one re-mint and retry per call.

**Edge cases:**
- [ ] AC4 — Given a clock skewed by up to 60 s, then the JWT is still accepted: a fake GitHub checks that `iat` ≤ its clock, that `exp` > its clock, and that `exp - iat` ≤ 600 s.
- [ ] AC5 — Given the token path is connected and the owner then completes the App setup, then the App replaces it as the current method, and the PAT's Keychain item is removed. Disconnect removes whichever method is current (every GitHub credential item is deleted).
- [ ] AC6 — Given a `method: app` row whose installation token's `expires_at` is minutes away, when `checkGitHubExpiry` runs, then the row's status is unchanged and no `kernel:github_token_expiring_*` notification is recorded. A renewal is silent.
- [ ] AC7 — Given a store at migration 18, when it opens, then migration 19 (`019_connector_app.ts`) adds `connectors.method`, `app_slug` and `installation_id` following migration 18's pattern: nullable, no default, no CHECK, no trigger, safe to re-run. `GET /connectors` shows `method`, `app_slug` and the reach list. A row from before 19 reads `method: token`.
- [ ] AC8 — Given either method, when `studio connectors github status` runs, then it names the method and the permissions' source (`reported` or `declared`).

**Error scenarios:**
- [ ] AC9 — Given a mint response reporting any write permission, then it is refused `token_write_scoped`, naming the permission. Nothing is connected, and the stored App credentials are removed. A PAT in use stays as it is.
- [ ] AC10 — Given a 401 or 404 on mint (key revoked, app uninstalled), then the row reads `rejected` and the owner is notified once (notifier stub; no test posts a real notification).
- [ ] AC11 — Given a failed renewal, then the caller gets a typed failure, never a throw. This holds for every port method and the token holder, whatever they are given.
- [ ] AC12 — Given any response, log line, event or store row on every path, then none contains the `pem`, a JWT or an installation token. Each secret string is tested, along with the base64url-encoded `pem`.
- [ ] AC13 — The client refuses every method except GET and the two allowlisted POSTs (`POST /app/installations/{id}/access_tokens`, `POST /app-manifests/{code}/conversions`), and every host except `api.github.com`.

**Validation (must pass before merge):** `cd kernel && npm ci && npm run typecheck && npm test`, then `bash scripts/check-docs.sh`.

## Touched-file invariants

> Grounded at base `2b5a47d7d25b6a3a2ab3c27902bbc0ec29a66a91`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/github/client.ts`**
  - keep: one origin and no redirects: `if (url.origin !== GITHUB_API_ORIGIN) return { kind: "failure", failure: UNREACHABLE };` and `redirect: "manual",`;
  - keep: a token reaches nothing but the header, and every throw becomes `unreachable` with no message (`// A network error, a timeout or an abort mid-body. Its message is dropped:`);
  - keep: `getTokenInfo` never infers permissions (`// Never inferred: see the file header`);
  - keep: the import rule `this file imports only types and the Keychain module` (the CLI graph); adding `node:crypto` is the only allowed new import, and only if signing lands here;
  - reuse: `get(...)`'s timeout, rate-limit and bounded-read path for the POSTs (never a second fetch path);
  - pinned by: `kernel/test/integrations-github-client.test.ts` `expect([...src.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1])).toEqual(["GET"]);`. The worker updates this pin to name exactly the allowlist (it must still fail on any other method literal), and keeps `expect(c.init.method).toBe("GET");` for the seven read methods.
- **`kernel/src/integrations/github/connector.ts`**
  - keep: one call at a time (`function exclusive(fn: () => Promise<ConnectorOutcome>): Promise<ConnectorOutcome> {`);
  - keep: trust only the read-back (`// The old token is gone and the new one is not in place: never \`connected\`.`);
  - keep: the fail-closed level list `export const READ_ONLY_LEVELS: readonly string[] = Object.freeze(["read", "none"]);` and `writePermissionsOf`/`writeScopedMessage`, which the App path reuses for `token_write_scoped`;
  - keep: `const TOKEN_IN_USE: readonly ConnectorStatus[] = ["connected", "expiring"];`;
  - mirror: `connectorView` must answer the app contract's `Connector` (`app/src/api/contract.ts`, `readonly method?: ConnectorMethod;`);
  - pinned by: `kernel/test/integrations-github-connector.test.ts` `const CONNECTOR_KEYS = [`, extended by exactly `app_slug`, `installation_id` and `method`, and the expiry tests' `kernel:github_token_expiring_14d`.
- **`kernel/src/integrations/github/routes.ts`**
  - keep: every handler goes through `async function total(` so `route_failed` never records a secret;
  - keep: `CONNECTOR_ERROR_STATUS` unchanged (no new code).
- **`kernel/src/integrations/github/tools.ts`**
  - keep: `function requireReach(store: Store, repo: string): void {` runs before any request;
  - keep: tools call only the four read methods (`// Read-only (invariant 3): this file calls only`);
  - reuse: the lazily built default client (`(built ??= createGitHubClient())`), now built over the method-resolving provider.
- **`kernel/src/integrations/cli.ts`**
  - keep: every value shown through `shown(`/`text(` (untrusted text);
  - keep: `function permissionsText(c: ConnectorLike): string {` stays the one place permissions are worded;
  - add: the method line in `formatGitHubStatus`.
- **`kernel/src/daemon-deps.ts`**
  - keep: `return { githubClient: createGitHubClient(clientDeps) };` (one dependency);
  - pinned by: `kernel/test/kernel-daemon.test.ts` `expect(Object.keys(d)).toEqual(["githubClient"]);` and `expect(reads).toEqual([]);` (no Keychain read and no request at build). This file stays unmodified by tests.
- **`kernel/src/auth/keychain.ts`**
  - keep: `export const WRITE_ARG = /^[A-Za-z0-9_.@][A-Za-z0-9_.@-]*$/;` unchanged (the App key is encoded to fit it, and the regex is never widened);
  - keep: `KeychainError` built from the service and exit status only;
  - keep: "The ONLY module under src/auth/ that touches the macOS Keychain". Modify only when a helper is genuinely needed (LOW confidence).
- **`kernel/src/store/migrations/index.ts`**
  - keep: `/** Every migration, in ascending version order. Append only; never edit a shipped one. */`. Migration 19 is appended last, and 018 is untouched.
- **`kernel/src/integrations/github/app-port.ts`**
  - keep: `Never throws or rejects, whatever it is given.`;
  - keep: the CLI-graph import rule (`` // The `studio` CLI loads it, so it imports only types: never the Agent SDK, the ``), pinned by `kernel/test/feature-seams.test.ts` `SDK_IN_GRAPH`;
  - keep: the export name `githubAppPort`, re-exported by `kernel/src/integrations/index.ts` (`export { githubAppPort } from "./github/app-port.js";`).

- **`kernel/test/integrations-github-app-contract.test.ts`**
  - keep: the header rule `replace the stubs and their assertions in their own tests`;
  - keep: `describe("the closed lists", () => {` and `describe("the stub owner routes (AC2, AC7)", () => {` byte-identical (the sibling GitHub App 3 owns the routes block);
  - remove only the `describe("the stub port (AC5)", () => {` block and the imports it alone uses.
- **`kernel/src/integrations/index.ts`**
  - keep: `export { githubAppPort } from "./github/app-port.js";` and `INTEGRATIONS_PARTS` unchanged (the contract test pins `githubAppRoutesPart` last);
  - add exports only.

## Closed enumerations touched

> Sibling grep at base `2b5a47d7d25b6a3a2ab3c27902bbc0ec29a66a91`: `grep -rnE '18, "connector_permissions_source"|17, 18|toBe\(connectorPermissionsSource\)|knownVersion\)\.toBe\(18\)' kernel/test` → 22 hits in 3 kernel test files (below; `integrations-github-declared.test.ts:232`'s `slice(-2)` pin was found by inspection), plus `kernel/src/store/migrations/index.ts` (`connectorPermissionsSource,` last in `migrations`).

- **migration `19` / `connector_app`** (sibling: `18` / `connector_permissions_source`) must be named in:
  - `kernel/src/store/migrations/index.ts`: the `migrations` array. Extend: append `connectorApp`.
  - `kernel/test/store.test.ts`:
    - line 298: the version/name list `[18, "connector_permissions_source"],`. Extend with `[19, "connector_app"]`.
    - lines 631, 679, 858, 981, 989 and 1814: the applied-version lists `toEqual([1, 2, …, 17, 18`. Extend with `19`.
    - lines 1003, 1238 and 1434: `.at(-1)).toEqual([18, "connector_permissions_source"]);`. Flip to `[19, "connector_app"]`.
    - lines 1776 and 1785: the "schema_migrations records versions … 17, 18, not a contiguous run" messages. Extend with `19`.
    - line 1825: `expect(err.knownVersion).toBe(18);`. Flip to 19.
    - the migration column expectations (`ALTERED`/`added`). Add 19's three `connectors` columns.
  - `kernel/test/integrations-foundation.test.ts`:
    - lines 292–293: the last-migration pin `expect(migrations.at(-1)).toBe(connectorPermissionsSource);`. Extend: 18 second to last, `connectorApp` last.
    - lines 298, 372 and 419: `.at(-1)).toEqual([18, "connector_permissions_source"]);`. Flip to `[19, "connector_app"]`.
  - `kernel/test/integrations-github-declared.test.ts`:
    - lines 217–218: `expect(migrations.at(-1)).toBe(connectorPermissionsSource);`. Extend: 18 second to last.
    - lines 231 and 257: `.at(-1)).toEqual([18, "connector_permissions_source"]);`. Check 18 by version, not by last position.
    - line 232: `expect(columnsOf(store).slice(-2)).toEqual(["permissions_source", "permissions_declared_at"]);`. Check 18's columns by name, not by tail position.
- **notification source `kernel:github_app_rejected`** (sibling: `kernel:github_token_expiring_14d`): the source is `kernel:<reason>`, an open pattern (`isNotificationSource` in `kernel/src/notifications/record.ts`). No change; there is no closed list.
- **`CONNECTOR_METHODS` `app`**: already in wave 1's list and in `app/src/api/contract.ts`. No change.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-github-client.test.ts`: the method/host allowlist (AC13) | flip `"/app/installations/"` → `"/app/"` in `kernel/src/integrations/github/client.ts` |
| `kernel/test/integrations-github-app-token.test.ts`: the JWT skew (AC4) | flip `GITHUB_APP_JWT_SKEW_SECONDS = 60` → `GITHUB_APP_JWT_SKEW_SECONDS = 0` in `kernel/src/integrations/github/app-token.ts` |
| `kernel/test/integrations-github-app-token.test.ts`: renewal at 5 minutes (AC3) | flip `GITHUB_APP_TOKEN_RENEW_MS = 5 * 60_000` → `GITHUB_APP_TOKEN_RENEW_MS = 0` in `kernel/src/integrations/github/app-token.ts` |
| `kernel/test/integrations-github-connector.test.ts`: an App row raises no expiry warning (AC6) | delete `if (row.method === "app") return;` in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-app-port.test.ts`: a write permission is refused (AC9) | flip `writePermissionsOf(` → `(() => []) || writePermissionsOf(` in `kernel/src/integrations/github/app-port.ts` |
| `kernel/test/integrations-github-app-port.test.ts`: the App replaces the PAT (AC5) | delete `.delete(GITHUB_KEYCHAIN_SERVICE)` in `kernel/src/integrations/github/app-port.ts` |
| `kernel/test/integrations-github-app-port.test.ts`: connected as `method: app`, `permissions_source: reported` (AC1) | flip `permissions_source = 'reported'` → `permissions_source = 'declared'` in `kernel/src/integrations/github/app-port.ts` |
| `kernel/test/integrations-github-app-port.test.ts`: a revoked key or a gone installation reads `rejected` (AC10) | delete `checkGitHubAppMint,` in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-app-port.test.ts`: the owner is notified exactly once (AC10) | flip `source: GITHUB_APP_REJECTED_SOURCE` → `source: "kernel:github_app_other"` in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-app-port.test.ts` and `integrations-github-app-token.test.ts`: no secret string in any result, row, event or message (AC12) | delete `catch {` in `kernel/src/integrations/github/app-token.ts`. Reviewer-applied (the mutant lets a thrown error carrying the JWT escape); `unverified` by script |
| `kernel/test/integrations-github-app-migration.test.ts`: migration 19 adds its three columns (AC7) | delete `connectorApp,` in `kernel/src/store/migrations/index.ts` |
| `kernel/test/integrations-github-connector.test.ts`: a pre-19 row reads `method: token` (AC7) | flip `?? "token"` → `?? "app"` in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-connector.test.ts`: `CONNECTOR_KEYS` names `method`, `app_slug` and `installation_id` (AC7) | delete `method: row.method` in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/cli.test.ts` or the connector tests: status names the method (AC8) | delete `` `  method: `` in `kernel/src/integrations/cli.ts` |
| `kernel/test/store.test.ts`, `integrations-foundation.test.ts`, `integrations-github-declared.test.ts`: the extended migration-list pins | delete `connectorApp,` in `kernel/src/store/migrations/index.ts` |

The constant names above are in subtask 1's `provides`. Subtask 2's file list requires the guard line, the `?? "token"` read-boundary mapping, the `GITHUB_APP_REJECTED_SOURCE` constant (`"kernel:github_app_rejected"`), `method: row.method` in `connectorView`, and a `  method: ` status line verbatim, so these rows stay machine-applicable. The AC8 row's pin is whichever test file the worker adds the status-line test to; it names that file in its result.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Installation tokens, the client's token provider and allowlist, migration 19 | AC2 (client half), AC3, AC4, AC7 (schema half), AC11 (token holder), AC12 (client and holder paths), AC13 | 7 modify, 4 create | `loomwright:unit-testing`, `loomwright:error-handling` | LAUNCHABLE |
| 2 | The real port, connector row and states, owner surfaces, docs | AC1, AC2 (wiring half), AC5, AC6, AC7 (view half), AC8, AC9, AC10, AC11 (port), AC12 (port, connector, routes, events, rows) | 10 modify, 1 create | `loomwright:unit-testing`, `loomwright:error-handling` | BLOCKED (by #1) |

### Subtask 1 — files
- **Create** `kernel/src/integrations/github/app-token.ts`:
  - the four App Keychain service constants (`GITHUB_APP_ID_SERVICE`, `GITHUB_APP_SLUG_SERVICE`, `GITHUB_APP_INSTALLATION_SERVICE`, `GITHUB_APP_KEY_SERVICE`);
  - `encodeAppKey` / `decodeAppKey` (pem ⇄ base64url; refuses a non-PEM);
  - `signAppJwt(appId, pem, now)` (RS256 via `node:crypto` `createSign`, `iat = now - GITHUB_APP_JWT_SKEW_SECONDS`, `exp = iat + 600`, `iss = String(appId)`);
  - `createGitHubAppTokens(deps)`: the in-memory holder, with `current()`, `invalidate()`, `lastMintFailure` and a mint result typed as `{ok:true, token, expires_at, permissions} | {ok:false, error, status?}`; renewal when `GITHUB_APP_TOKEN_RENEW_MS` (5 min) or less is left; never writes the token anywhere;
  - the shipped `githubAppTokens` singleton.

  Imports only types, `node:crypto`, the Keychain module and the client, so it stays out of the SDK graph.
- **Modify** `kernel/src/integrations/github/client.ts` (444):
  - a `GitHubTokenProvider` type (`{ method, token(): Promise<string | undefined>, renew?() }`) and `GitHubClientDeps.tokenProvider`; `readToken` stays as the PAT shorthand, so the token path is unchanged;
  - the per-call method resolver `resolveGitHubTokenProvider(keychain, tokens)` (PAT item first, then the App items);
  - `listReachableRepos` reads `GET /installation/repositories` (the `repositories` array, paged) for `method: app`;
  - one 401 ⇒ `renew()` and retry once;
  - `get(...)` (renamed or widened to take a method) takes an optional bearer. The two POSTs use the same one fetch path: `mintInstallationToken` sends the app JWT as its bearer, checked by its own shape test (`isAppJwtShape`: three base64url segments, at most 2048 characters) instead of the 255-character PAT bound `MAX_TOKEN_LENGTH`; `convertManifest` sends no `authorization` header at all. The PAT path's `isUsableToken` bound is unchanged;
  - the allowlist `GITHUB_ALLOWED_NON_GET` (two path patterns), checked with the origin before every request, with the exported guard `isAllowedGitHubRequest(method, url)`;
  - `mintInstallationToken(installationId, jwt, deps)` and `convertManifest(code, deps)` (`deps`: `Pick<GitHubClientDeps, "fetch" | "timeoutMs" | "maxBodyBytes" | "now">`), standalone exports. The request core `get(...)` is lifted to module level, parameterised by those deps, and shared with `createGitHubClient`. `createGitHubAppTokens(deps)` passes its fake fetch through. They are exports of client.ts, outside the `GitHubClient` interface (so `kernel/src/integrations/types.ts` is not changed). `convertManifest` is unauthenticated and returns only the non-secret `GitHubAppConversion` plus `pem`, never `client_secret`; the setup item calls it.

  Home: appended. At 444 lines this is under the 500-line threshold, and the file is the single authority for what the client may send.
- **Create** `kernel/src/store/migrations/019_connector_app.ts`: three columns added only when `PRAGMA table_info` lacks them, migration 18's pattern.
- **Modify** `kernel/src/store/migrations/index.ts` (43): append it.
- **Modify** `kernel/src/auth/keychain.ts` (195): LOW confidence; only if a helper is genuinely needed.
- **Modify** `kernel/test/integrations-github-client.test.ts` (590):
  - the allowlist pin replaces the GET-only source pin, plus tests that every other method and host is refused;
  - installation repos for a fake app provider;
  - the 401-renew-once test.

  Reason for appending to a 590-line file: it is the single authority for the client's read-only pin. The provider and holder tests live in the new token test file.
- **Create** `kernel/test/integrations-github-app-token.test.ts`: the JWT (skewed fake clock checking `iat`/`exp`), the mint, renewal at 5 minutes, failures typed and never thrown, the key encoding round trip, and secret strings absent from every result.
- **Modify** `kernel/test/store.test.ts` (2162): flip `knownVersion` to 19, and add 19's columns to the migration column expectations. Edits to existing pins only, so no new home is needed.
- **Modify** `kernel/test/integrations-foundation.test.ts` (867): the last-migration pin. Pin edit only.
- **Modify** `kernel/test/integrations-github-declared.test.ts` (690): 18's column pins checked by name, not by tail position. Pin edit only.
- **Create** `kernel/test/integrations-github-app-migration.test.ts`: migration 19's own tests (columns nullable, no default, no CHECK, no trigger, re-run safe, a pre-19 row reads `method` null). This is a new home, so none of these tests are appended to the 690-line declared test.
### Subtask 2 — files
- **Modify** `kernel/src/integrations/github/app-port.ts` (22): replace the stub with `createGitHubAppPort(deps)` (Keychain reader, writer and deleter, the token holder, a client factory) and the frozen shipped `githubAppPort`.
  - `storeApp` writes the id, slug and encoded key items with read-back, and sets `app_slug` on the row, creating it `disconnected` when there is none; method and status are unchanged.
  - `recordInstallation` stores the installation id, mints, rejects a write permission (`token_write_scoped`, via `writePermissionsOf`, removing the App items, and leaving a PAT in use unchanged), reads the reach list, writes `connected` / `method: app` / `permissions_source: reported` / `installation_id` / `expires_at`, then deletes the PAT item.
  - `removeApp` deletes the App items, invalidates the holder, sets the row `disconnected` (one event, on a change only), nulls `app_slug` and `installation_id`, and returns the row. Covered in the port test.
  - Every method returns a typed result and never throws.
- **Modify** `kernel/src/integrations/github/connector.ts` (594):
  - `COLUMNS` and `connectorView` gain `method`, `app_slug` and `installation_id`. A pre-19 row's SQL `null` method is read as `token` at the read boundary (`githubConnectorRow`/`listConnectorRows` map it), so `ConnectorRow.method?: ConnectorMethod` in `types.ts` stays as wave 1 typed it;
  - `setToken` success writes `method = 'token'` and nulls the App fields;
  - `disconnect` deletes every GitHub credential item and invalidates the holder;
  - `refreshRepos` reads through the method-resolving client;
  - `checkGitHubExpiry` gains `if (row.method === "app") return;`;
  - a new due work `checkGitHubAppMint` (a mint failure in `lastMintFailure` ⇒ `rejected`, plus one `kernel:github_app_rejected` notification on the transition) joins `githubConnectorPart.dueWork`.

  Reason for appending to a 594-line file: these are edits to the existing row and expiry functions, which are the single owner of the `connectors` row. The App's own logic lives in `app-port.ts` and `app-token.ts`. Import direction: `app-port` → `connector` → `app-token`, so there is no cycle.
- **Modify** `kernel/src/integrations/github/routes.ts` (121): `GET /connectors` carries the App fields through `connectorView`, and the disconnect wording covers both methods. No new route or code.
- **Modify** `kernel/src/integrations/github/tools.ts` (190): the default client is built over the method-resolving provider.
- **Modify** `kernel/src/integrations/cli.ts` (342): `formatGitHubStatus` gains a `method:` line, and the permissions line names its source (`reported` / `declared`).
- **Modify** `kernel/src/daemon-deps.ts` (16): the client is built over the method-resolving provider. No Keychain read and no request at build.
- **Modify** `kernel/src/integrations/index.ts` (101): export the new public symbols (`createGitHubAppPort`, the token holder type). LOW confidence.
- **Create** `kernel/test/integrations-github-app-port.test.ts`: AC1, AC5, AC9, AC10, AC11 and AC12 over fake Keychain, fake fetch and the notifier stub, plus the never-throws-whatever-it-is-given test moved from the contract test.
- **Modify** `kernel/test/integrations-github-app-contract.test.ts` (151): remove the `describe("the stub port (AC5)"` block, whose assertions move to the new port test (the file header says `replace the stubs and their assertions in their own tests`). The closed-list tests and the stub owner routes block stay untouched.
- **Modify** `kernel/test/integrations-github-connector.test.ts` (918):
  - `CONNECTOR_KEYS` gains the three keys;
  - small tests for AC6 (expiry skip), the disconnect of both methods, and `setToken` writing `method: token`.

  Reason for appending to a 918-line file: these extend existing connector-row tests in place. New App behaviour tests go in `integrations-github-app-port.test.ts`.
- **Modify** `docs/architecture/integrations.md` (184): the App credential lifecycle (the four Keychain items and the key encoding, the mint, renewal, the reach list, the method rule, the allowlist, the refusals, expiry and rejection). The "Open for wave 2" list is answered for the two points this item owns. Links must keep resolving (`scripts/check-docs.sh` check 1).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/integrations/github/app-token.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "signAppJwt"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "createGitHubAppTokens"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "githubAppTokens"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "encodeAppKey"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "GITHUB_APP_KEY_SERVICE"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "GITHUB_APP_INSTALLATION_SERVICE"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "GITHUB_APP_JWT_SKEW_SECONDS"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "GITHUB_APP_TOKEN_RENEW_MS"}
  - {kind: "type", path: "kernel/src/integrations/github/client.ts", name: "GitHubTokenProvider"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "resolveGitHubTokenProvider"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "GITHUB_ALLOWED_NON_GET"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "isAllowedGitHubRequest"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "mintInstallationToken"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "convertManifest"}
  - {kind: "file", path: "kernel/src/store/migrations/019_connector_app.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/019_connector_app.ts", name: "connectorApp"}
  - {kind: "file", path: "kernel/test/integrations-github-app-token.test.ts"}
  - {kind: "file", path: "kernel/test/integrations-github-app-migration.test.ts"}
requires: []
lanes:
  - "kernel/src/integrations/github/app-token.ts"
  - "kernel/src/integrations/github/client.ts"
  - "kernel/src/store/migrations/019_connector_app.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/src/auth/keychain.ts"
  - "kernel/test/integrations-github-client.test.ts"
  - "kernel/test/integrations-github-app-token.test.ts"
  - "kernel/test/store.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/integrations-github-declared.test.ts"
  - "kernel/test/integrations-github-app-migration.test.ts"
external_requires:
  - "Node built-in node:crypto createSign (RS256), as probe p13 used"
  - "macOS /usr/bin/security -i accepting a ~2.3 KB secret on one stdin line (unverified; the read-back decides)"

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/integrations/github/app-port.ts", name: "createGitHubAppPort"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-port.ts", name: "githubAppPort"}
  - {kind: "symbol", path: "kernel/src/integrations/github/connector.ts", name: "checkGitHubAppMint"}
  - {kind: "symbol", path: "kernel/src/integrations/cli.ts", name: "formatGitHubStatus"}
  - {kind: "file", path: "kernel/test/integrations-github-app-port.test.ts"}
  - {kind: "symbol", path: "docs/architecture/integrations.md", name: "loomwright-studio-github-app-key"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "createGitHubAppTokens"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/app-token.ts", name: "githubAppTokens"}
  - {from: "1", kind: "type", path: "kernel/src/integrations/github/client.ts", name: "GitHubTokenProvider"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "resolveGitHubTokenProvider"}
  - {from: "1", kind: "symbol", path: "kernel/src/store/migrations/019_connector_app.ts", name: "connectorApp"}
lanes:
  - "kernel/src/integrations/github/app-port.ts"
  - "kernel/src/integrations/github/connector.ts"
  - "kernel/src/integrations/github/routes.ts"
  - "kernel/src/integrations/github/tools.ts"
  - "kernel/src/integrations/cli.ts"
  - "kernel/src/daemon-deps.ts"
  - "kernel/src/integrations/index.ts"
  - "kernel/test/integrations-github-app-port.test.ts"
  - "kernel/test/integrations-github-app-contract.test.ts"
  - "kernel/test/integrations-github-connector.test.ts"
  - "docs/architecture/integrations.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none (lanes disjoint) | YES — by `requires` (2 builds on 1's provider, holder and migration) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `loomwright:unit-testing` (vitest, fakes over `fetch` and the Keychain), `loomwright:error-handling` (typed results, never a throw) |
| 2 | `loomwright:unit-testing`, `loomwright:error-handling` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| A secret leaking (the `pem`, its base64url form, a JWT or an installation token) through an error message, an event payload, a row, a route answer or CLI output (requirement "Risks") | HIGH | AC12: a test per secret string per path; every caught error's message is dropped (the client's `unreachable` idiom); no logging; `client_secret` never a parameter. |
| Clock skew rejecting the JWT (requirement "Risks") | MEDIUM | `iat` 60 s back and `exp - iat` = 600 s; AC4's fake GitHub checks both against a skewed clock. |
| `security -i` may not accept a ~2.3 KB line, so the App key never reaches the Keychain on a real Mac (Feasibility (Phase 2.5), check 2) | MEDIUM | The read-back decides (`storeApp` answers `conversion_failed`, never a half-stored App). Record it as NEEDS VERIFICATION in `docs/OPEN_QUESTIONS.md` only if the owner asks. The PR body flags that a real-Keychain store was not exercised (tests use fakes). |
| Scope over one worker's context (Feasibility (Phase 2.5), check 4) | MEDIUM | Split context-bound into two sequential subtasks of ≤ 12 files each. |
| Parallel sibling GitHub App 3 (setup flow) may also edit `kernel/test/integrations-github-app-contract.test.ts` (its 501 route stubs) and will call `convertManifest`, which this item adds | MEDIUM | This item edits only the `describe("the stub port (AC5)"` block and leaves the routes block. The export name `convertManifest` is fixed here; a conflict on merge is resolved by keeping both items' edits. |
| An App row raising an expiry warning every hour, or a renewal changing status | MEDIUM | AC6 plus the `if (row.method === "app") return;` pin mutation. |
| The Keychain-presence method rule drifting from the row's `method` | MEDIUM | Every writer (record, setToken, disconnect, removeApp) keeps both in step, with a test for each transition (AC5, AC7). The rule is documented in `docs/architecture/integrations.md`, and the owner can confirm the one-credential assumption on the PR (requirement "Assumptions"). |
| Migration-count and column-position pins in tests outside the requirement's Touches (`store.test.ts`, `integrations-foundation.test.ts`, `integrations-github-declared.test.ts`) | LOW | Named in `## Closed enumerations touched` and in subtask 1's lanes. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-kernel-github-app-installation-tokens.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T03:49:53Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/173
- **Branch:** feature/kernel-github-app-installation-tokens
- **Files changed:** 23
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Real GitHub App port, installation-token holder (RS256 JWT, 5-min renewal, write-scoped mints refused on every mint), method-resolving client with a two-POST allowlist, connector method/app fields, App mint due work, migration 19, CLI method/source lines, docs. Phase 4.5: 3 reviews (FAIL→FAIL→PASS), 3 issues fixed (renewal write-scope check, stale stub prose, pin row 5 test), 6 LOW/nit dismissed (PR comment). 2894 tests pass; check-docs OK; required CI green.

## Not verified
- **macOS /usr/bin/security -i with a ~2.3 KB encoded key on one stdin line** — needs a write to the real Keychain; the port's read-back decides (subtask 1)
- **mint and GET /installation/repositories against real api.github.com** — only a fake fetch ran; no live GitHub App available (subtask 1)
- **macOS Keychain: ~2.3 KB encoded key via security -i** — no real Keychain write in tests; fakes plus the read-back rule only (subtask 2)
- **live GitHub mint and /installation/repositories** — only a fake fetch ran; no GitHub App exists to call (subtask 2)
