# Integrations

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features). Built and documented by **item 03** (the GitHub connector: token validation and the repos the token reaches) and **item 14** (the owner's declaration that a token is read-only), in the integrations feature's `github/connector.ts` and `github/routes.ts` parts and its `cli.ts` (`kernel/src/integrations/`), over the read-only client in `github/client.ts`; and by **item 11** (the Integrations screen, `app/src/screens/integrations/`). The GitHub App connect, decided in [D36](../DECISIONS.md), is a second way to connect beside the token; its contract is [below](#github-app-connect).

**Routes** (owner-only):

| Route | Answers |
|---|---|
| `GET /connectors` | `{connectors}`: every `connectors` row in the `Connector` shape, `[]` when nothing was ever set up |
| `POST /connectors/github/token` | body `{token, declared_read_only?}`; `declared_read_only`, when present, must be a boolean (else 400 `invalid_body`), and only `true` declares; validates the token, then stores it; `{connector}`, the row after the change, never the token |
| `POST /connectors/github/disconnect` | deletes every GitHub credential Keychain item (the token's and the GitHub App's, [below](#the-credential-lifecycle)); `{connector}`, the row after the change |
| `GET /connectors/github/repos[?refresh=1]` | `{repos, verified_at}`: the repos the token reaches, as `owner/name` (`[]` and `null` with no row); `refresh=1` re-reads them from GitHub first |

**Contract types it fills** (`app/src/api/contract.ts`): `ConnectorKind`, `ConnectorStatus`, `Connector`, `ConnectorsResponse`, `ConnectorTokenBody`, `ConnectorChangeResponse`, `ConnectorReposQuery` and `ConnectorReposResponse`.

On the token path the credential is Studio's own fine-grained, read-only personal access token, which the owner creates for the personal repos they choose; that path runs no OAuth flow and never reuses the `gh` CLI's login. The App path ([D36](../DECISIONS.md), which supersedes phase 6 item 03's "Studio never runs an OAuth flow") is not a login either and reuses no `gh` credential, but it is a browser round trip that returns a secret, the App's key: [GitHub App connect](#github-app-connect). GitHub is an optional connector (invariant 5): Studio works with none. Item 11 builds the screen (`app/src/screens/integrations/`; see [Phase 6 features](../ARCHITECTURE.md#phase-6-features)).

## The token and the Keychain item

The token lives only in the Keychain item `loomwright-studio-github` (generic password, account `loomwright-studio`), written and deleted through `kernel/src/auth/keychain.ts`, the one module that touches the Keychain. No route answer, `connectors` row, event, notification, log line, thrown error or CLI output carries it, and the tests check each of these for its absence, after a forced failure too:

- the connector logs nothing, and every failure is a fixed code with a fixed message; a caught error's text is never kept;
- each route handler catches everything and answers a typed failure, so the API's `route_failed` event (which records a clipped error message) is never written for these routes;
- the client checks the token's shape before it reaches a header (so Node's `Headers` never throws a message quoting it) and answers every throw as `unreachable`.

The client (`createGitHubClient`) reads its credential fresh on each call, sends GETs, and only to `https://api.github.com`. On the token path that credential is the Keychain item above. The App path adds a second credential, an installation token, chosen per call by [the method rule](#the-credential-lifecycle), and exactly two allowlisted non-GET calls, both to `api.github.com` ([below](#the-two-non-get-calls)).

## The `connectors` table

One row per connector kind (migration 17, plus migration 18 for the two permission-source columns and migration 19 for the three GitHub App columns, below). It holds what the connector last verified: `status`, `account_login`, `permissions_json` (name to level, as GitHub reported them; `NULL` when GitHub reported none), `permissions_source` and `permissions_declared_at` (below), `reachable_repos_json` (`owner/name` strings), `expires_at`, `verified_at`, and `created_at` / `updated_at`. It never holds the token or any other secret. `permissions_source` says who vouched for the permissions: `reported` (GitHub's own answer; `permissions_declared_at` is `NULL`), `declared` (the owner said so; `permissions_json` is `NULL` and `permissions_declared_at` is the time of the write), or `NULL` on a row from before migration 18, which is never backfilled. The kernel never infers a source. A later `reported` connect clears `permissions_declared_at`; disconnect and refresh leave both columns as they were. The login, permission names and repo names come from GitHub: untrusted data, shown as text. Disconnecting keeps the row (and what it last verified) with status `disconnected`; nothing deletes it.

## Lifecycle

**Set.** `POST /connectors/github/token` (or `studio connectors github set`) validates the token before anything is written:

1. Its shape: what the Keychain writer takes (no whitespace, quote or control character, at most 255 characters).
2. `GET /user`, through a client whose only token source is the candidate: the login and the expiry (the `github-authentication-token-expiration` header).
3. Its permissions. A reported write level (`write`, `admin`, or any level not known to be read-only) is refused `token_write_scoped`, with or without a declaration: the write check runs before the declaration is consulted. If every reported level is `read` (or `none`), the token connects with source `reported`. If GitHub reported none (`null` or empty), the token connects only with the owner's declaration (source `declared`); without one it is refused `token_permissions_unknown`.
4. `GET /user/repos` (paginated, with a page cap): the reachable repos.

Only then is it stored: the old item is deleted (none is fine), the new one added (never an overwrite: no `-U`), and the item **read back**, since `security -i` can exit 0 when its command failed. The row then reads `connected` with the login, permissions (`NULL` when declared), `permissions_source`, `permissions_declared_at`, repos, expiry and `verified_at`.

**The three refusals.** Each writes nothing to the Keychain, answers 422 `{error, message, connector}`, and appends one `connector_status` event:

| Refusal | When | Message |
|---|---|---|
| `token_invalid` | GitHub answers 401, or the value is not a token's shape | says what to check |
| `token_write_scoped` | a permission's level is above read (`write`, `admin`, or any level not known to be read-only) | names every such permission and the setting to change, `pull_requests: write → set to read`; `write_permissions` lists them |
| `token_permissions_unknown` | GitHub did not report the token's permissions (`null`, or none at all) and the owner made no declaration | says Studio cannot check they are read-only, and names the declaration: the Connect sheet's confirmation, `yes` at the `studio connectors github set` prompt, or `declared_read_only: true` |

**The owner's declaration (item 14).** GitHub publishes no permissions for a fine-grained token: the owner's probe p12 (2026-10-29) found `x-oauth-scopes` null and `x-accepted-github-permissions` naming only the endpoint's needs ([open questions](../OPEN_QUESTIONS.md), "Phase 6: how does GitHub expose a fine-grained token's permissions?"; the probe is [`probes/p12-github-token-permissions.mjs`](../../probes/p12-github-token-permissions.mjs)). So the real client reports `permissions: null` and never infers them, least of all from a write attempt, and a real token connects only on the owner's word. The declaration is the owner's action (invariant 1: the kernel records who vouched; it decides nothing):

- **In the app**, the Connect sheet's required checkbox, "This is a fine-grained token, and every permission I gave it is Read", with Connect disabled until it is ticked; the request sends `declared_read_only: true`.
- **At the CLI**, `studio connectors github set` asks a second question after the token: "Is this a fine-grained token, and is every permission you gave it Read? Type yes to declare it". Piped, line 1 is the token and an optional line 2 is the answer. Only `yes` or `y` declares; any other answer, or none, sends the token alone. `--declared-read-only` as an argument never connects (every argument to `set` exits 2).

A declared token is validated like any other (user, expiry, reachable repos), then stored; the row reads `connected` with `permissions_json` NULL, `permissions_source: "declared"` and `permissions_declared_at`. Nothing calls it verified: the screen and `studio connectors github status` say "read-only, declared by you" (the CLI: "declared by the owner at <time>"), and the status line says only that the account and repos were checked, never the permissions. The declaration never overrides GitHub: a reported write level is still refused.

**The reach list includes every public repo the account owns.** Probe p12 (c): `GET /user/repos` returned the one selected repo and every public repo of the account (57 in all), and none of its 18 private repos. "Only select repositories" does not narrow public access, so `reachable_repos_json` is the selected repos plus all the account's public repos. Narrowing the list is not part of item 14.

**A refusal while a token is in use.** With a `connected` or `expiring` token in place, a refused token leaves its Keychain item and its row unchanged: the token in use stays in use, and the event's `status` is the row's (`connected`). With none in place the row reads `rejected` ("the last token offered was refused"), and is created when there was none.

**Failures that change nothing.** GitHub's rate limit (429 `rate_limited`, with `resets_at`), GitHub unreachable or answering something unreadable (502 `github_unreachable`), or another HTTP status (502 `github_error`, with `github_status`): no row, event or Keychain change. A Keychain delete that fails answers 500 `keychain_failed` with nothing changed.

**Replace** is set with a token already in place: the new token is validated first and swapped in only when it passes, so a refused one leaves the first in use. If the read-back after the swap does not hold the new token, the old one is already deleted: the row reads `disconnected` (one event), never `connected`, and the answer is 500 `keychain_failed`.

A token set over a GitHub App connection replaces the App: after the read-back confirms the new token, the App's four Keychain items are deleted ("item not found", exit status 44, counts as already gone; every item is tried even when one fails) and the held installation token is dropped. The set succeeds either way, since the token's item is current by [the method rule](#the-credential-lifecycle). The row clears `app_slug` and `installation_id` only when every App item is gone; if one could not be deleted, the row keeps them, so a later remove of the App can still find and delete what is left.

**Disconnect** deletes every GitHub credential Keychain item, the token's and the GitHub App's four, whichever method is current ("item not found", exit status 44, counts as already gone), drops the held installation token, clears the App fields and sets the row `disconnected`, kept. Every item is tried even when one fails; a failure answers 500 `keychain_failed` and leaves the row as it was. With no row it answers 404 `no_connector`.

**Refresh.** `GET /connectors/github/repos?refresh=1` re-reads the repos with the stored token and updates `reachable_repos_json` and `verified_at`, without a status change or an event. It needs a token in use (409 `not_connected` otherwise, 404 `no_connector` with no row); a 401 answers `token_invalid` without changing the row.

The connector runs one call at a time (set, disconnect, refresh) on the same queue as [the App port](#the-port) (`githubCredentialLock`, `github/credential-lock.ts`): both change the token's Keychain item, the App's four items, the row's `method`, `app_slug` and `installation_id`, and the held installation token, so no two credential changes, token or App, ever interleave their Keychain or row steps. A call that fails or throws never blocks the next.

## Expiry

The connector's expiry due work (`checkGitHubExpiry`, every loop tick) reads the GitHub row only; it never touches the Keychain or GitHub. A `method: app` row is skipped (its installation token renews itself: [the credential lifecycle](#the-credential-lifecycle)). For a token in use with a known `expires_at`:

- within 14 days, `connected` becomes `expiring` (one event), and the owner is notified through `recordNotification` (source `kernel:github_token_expiring_14d`);
- within 1 day, a second notification (`kernel:github_token_expiring_1d`);
- after `expires_at`, the status becomes `expired` (one event; no notification).

Each threshold notifies once per token: the notification's body names the token's expiry, and a nearer warning already sent covers a farther one, so a token set with a day left gets only the 1-day warning. A replacement token (a new expiry) is warned afresh. An unknown expiry (`null`, or a header the client could not parse) is never warned about. The 14 and 1 days are the safety kernel's, fixed (`GITHUB_EXPIRY_NOTICE_DAYS`); the 14 days follows the approved design's proposal (`docs/DESIGN.md`).

## Events

Every status change appends exactly one `connector_status` event, `{connector_id, kind, status}`, plus `refused` (the code) for a refusal; a successful set also carries `permissions_source` (`reported` or `declared`); never a secret. Wright's thread shows it ("Connector github: connected"; [threads](threads.md#the-event-kinds)). A refresh and a failure that changes nothing append none.

## The CLI

`studio connectors` calls the routes:

| Command | Calls |
|---|---|
| `studio connectors [--json]` | `GET /connectors`: one line per connector |
| `studio connectors github status [--json]` | `GET /connectors`: the GitHub connector in full (account, permissions, expiry, repos); for a declared row the permissions line reads `read-only, declared by the owner at <time>` |
| `studio connectors github set` | reads the token from stdin, then the declaration answer (a prompt at a terminal, an optional line 2 piped), then `POST /connectors/github/token` |
| `studio connectors github disconnect` | `POST /connectors/github/disconnect` |

`set` reads the token **only from stdin**: piped, or typed at a terminal with echo off. The declaration answer comes from the same capped input (a second prompt, with echo on, at a terminal; line 2 when piped). Given any argument, it exits 2 without contacting the kernel, and never echoes the argument (a token on a command line lands in shell history and `ps`). No unknown argument is echoed either. A refusal prints its code and message on stderr and exits 1. Text from GitHub is printed with control characters escaped.

## GitHub App connect

The second way to connect GitHub, beside the token path, which stays as it is. [D36](../DECISIONS.md) records the decision and its evidence (probe p13, [open questions](../OPEN_QUESTIONS.md), "GitHub App connect"); the screens are in [DESIGN](../DESIGN.md#github-app-connect). Setup is GitHub's App Manifest flow: Studio opens github.com in the system browser with the App pre-filled (private, no webhook, `Pull requests: Read`, `Contents: Read`, `Metadata: Read`), and the owner clicks Create, then picks repos and clicks Install. Studio receives and stores the App's key itself.

It is built in two waves. **Wave 1** is this contract: the types (`kernel/src/integrations/types.ts`), a stub port (`github/app-port.ts`), the two owner routes as 501 stubs (`github/app-routes.ts`), the app's contract types (`app/src/api/contract.ts`), the decision and the mockup. **Wave 2** is three items built in parallel against it: the kernel tokens item (the port, the App's key and installation tokens; [the credential lifecycle](#the-credential-lifecycle) and [the port](#the-port) below are its), the kernel setup item (the setup window and the browser routes) and the app's Connect sheet. All three have landed: the port is real, `POST /connectors/github/app/setup` and `/setup/cancel` open and close the real setup window, the three browser routes are served ([GitHub App setup](github-app-setup.md)), and the Connect sheet drives them ([app](app.md)).

### Owner routes

They take the API token like every route (401 without it).

| Route | Answers |
|---|---|
| `POST /connectors/github/app/setup` | `{setup_url, expires_at}`: opens the one setup window and returns the address the app opens in the system browser (`setup_url`) and when the window closes (`expires_at`, an ISO time) |
| `POST /connectors/github/app/setup/cancel` | `{cancelled}` (a boolean): closes the open setup window, if any |

Two existing routes gain the App method, built by the kernel tokens item. `GET /connectors` carries the App fields below on the GitHub row. `POST /connectors/github/disconnect` deletes **every** GitHub credential item, the token's and the App's four, whichever method is current, drops the held installation token and clears the App fields; the row reads `disconnected` and is kept. Studio cannot uninstall or delete the App on GitHub, so the screen sends the owner there.

### Browser routes

GET only, served by the kernel's loopback API, **without the API token**: the owner's browser carries no token, so each is gated instead by the open setup window and its single-use `state`. This item only names them; the API server's mechanism for an unauthenticated route is the setup item's.

| Route | What it is |
|---|---|
| `/connectors/github/app/start` | the local page that posts the manifest to github.com (the manifest carries no `hook_attributes`: GitHub refuses a loopback webhook URL, even when inactive) |
| `/connectors/github/app/return` | GitHub's `redirect_url`, after Create: query `code` and `state`. Studio converts the code and stores the App |
| `/connectors/github/app/installed` | GitHub's `setup_url`, after Install: query `installation_id`, `setup_action` and `state`. Studio records the installation |

GitHub accepts a loopback `redirect_url` and `setup_url` (`http://127.0.0.1:<port>`) and returns the `state` on both returns (probe p13). The `state` appears in the browser's address bar and history, so every `state` GitHub carries is **spent on its first use**. The one exception is the start `state` in `setup_url`, which GitHub never carries: it can be reused for start-page reloads until the return arrives (a recorded deviation, [GitHub App setup](github-app-setup.md#the-window)). Each setup window is **single-use, short-lived, and at most one is open at a time**; a browser route outside an open window, or with a `state` that is not the window's current one, is refused.

### The connector row's App fields

The GitHub row (`ConnectorRow`, and `Connector` in the app's contract) gains three **optional** fields, stored by migration 19 (`connectors.method`, `app_slug` and `installation_id`: nullable, no default, no CHECK, no trigger, safe to re-run, like migration 18). A row from before it, or whose `method` is `NULL`, reads as `token` at the read boundary; it is never backfilled:

| Field | Meaning |
|---|---|
| `method` | `token` or `app` (`CONNECTOR_METHODS`, `ConnectorMethod`) |
| `app_slug` | the App's slug on GitHub, or `null`; not secret |
| `installation_id` | the installation's number, or `null`; not secret |

For `method: app`, `permissions_source` is always `reported` (GitHub reports an installation token's permissions), and `expires_at` is the installation token's expiry as of the connect, which **renews** hourly without the row following it (no extra field; it is never owner-actionable, [see below](#the-credential-lifecycle)). `reachable_repos` is exactly the repos the owner chose at install. The row never holds the App's key, a client secret or an installation token, as before. `studio connectors github status` prints a `method:` line (`token`, or `app (<slug>, installation <id>)`) and a `permissions source:` line (`reported`, `declared` or `-`) beside the permissions line.

### The setup refusal reasons

A closed list (`GITHUB_APP_SETUP_REFUSALS`, type `GitHubAppSetupRefusal`):

| Reason | When |
|---|---|
| `setup_not_open` | a browser route was called with no setup window open |
| `state_mismatch` | the `state` is missing, wrong or already spent |
| `setup_expired` | the window closed before the step finished |
| `conversion_failed` | GitHub's conversion did not return the App |
| `install_failed` | the install did not complete, or the installation could not be recorded or its first token minted |
| `token_write_scoped` | the installation token reports a write permission: refused as for a token, and the App stays read-only |

The mapping of these reasons to HTTP statuses and to what the browser tab shows is the setup item's.

### The credential lifecycle

The kernel keeps the App's credentials in the Keychain and mints, renews and uses short-lived **installation tokens**, whose permissions and repos GitHub reports. Read-only is therefore GitHub's word (the token's permissions are checked at mint), not a declaration, and a leaked token dies within the hour.

**Keychain items.** Each is a generic password with account `loomwright-studio` (the connector's `GITHUB_KEYCHAIN_ACCOUNT`), written and deleted through `kernel/src/auth/keychain.ts` like the token:

| Item (service) | Holds |
|---|---|
| `loomwright-studio-github-app-id` | the App's numeric id (the JWT's `iss`) |
| `loomwright-studio-github-app-slug` | the App's slug |
| `loomwright-studio-github-app-installation` | the installation's numeric id |
| `loomwright-studio-github-app-key` | the App's private key, **encoded** |

The Keychain writer takes only `WRITE_ARG` characters (letters, digits, `_ . @ -`, never first `-`), and a PEM has spaces and newlines, so the key item holds the `pem` as **unpadded base64url**. The `pem` must start with `-----BEGIN` before it is encoded (a `pem` that does not is `conversion_failed`), which guarantees the encoded form starts with a letter and passes `WRITE_ARG`; `WRITE_ARG` itself is never widened. Every write is replace by delete then add, and is trusted only after a read-back that matches (`security -i` can exit 0 on a failure). `client_secret` is never a parameter anywhere. Whether `security -i` accepts a ~2.3 KB secret on one line on a real Keychain is unverified ([open question](../OPEN_QUESTIONS.md)): the read-back decides, and a failure is `conversion_failed`.

**The mint.** The kernel signs an RS256 JWT with the key (`iss` the App id, `iat` 60 s before the kernel's clock, `exp` 10 minutes after `iat`; the 60 s keeps a fast clock inside GitHub's tolerance), sends it as the bearer of `POST /app/installations/{id}/access_tokens`, and receives the token, its `expires_at` and the permissions GitHub reports for it. The key is read for one mint and dropped; the JWT is sent once and dropped.

**Renewal.** The token lives in memory only, in one process-wide holder shared by polls, tools and routes (`githubAppTokens`, `github/app-token.ts`); it is never written to the store, a file, an event or a log. A token with 5 minutes or less left is renewed before it is handed out, a 401 on a call renews it and retries **once** per call, and concurrent callers share one mint. A failed renewal is a typed failure to the caller, never a throw.

**The method rule.** One credential is current at a time, resolved **per call** with no read at construction (the shipped daemon builds its client before the store opens): the token's Keychain item present means `token`; otherwise the App's installation id and key present means `app`; otherwise there is no credential (`unreachable`, as with no token). Every writer keeps the row's `method` in step with that rule: a successful token set writes `method = 'token'`, deletes the App's four items, drops the held installation token and clears the App fields (keeping them while an App item could not be deleted, [above](#lifecycle)), a successful installation deletes the token's item, and a disconnect deletes every GitHub credential item.

**The reach list.** For `method: app` the client reads `GET /installation/repositories` (the `repositories` array, paged), the repos the owner chose at install, because `/user/repos` answers an installation token 403. `getTokenInfo` (`GET /user`) is the token path's and is not called for an App row.

**Expiry and rejection.** `checkGitHubExpiry` skips a `method: app` row: renewal is silent and the hourly `expires_at` is never owner-actionable, so the status is unchanged and no `kernel:github_token_expiring_*` notification is recorded. A mint answered 401 (the key is revoked) or 404 (the installation is gone) is recorded on the holder (`lastMintFailure`); a due work (`checkGitHubAppMint`) applies it: the row reads `rejected` (one `connector_status` event) and the owner is notified once, `kernel:github_app_rejected`, on the transition into `rejected` only. A renewed installation token that reports a write permission is refused the same way (`write_scoped`): the holder drops the held token, records the failure, and the same due work marks the row `rejected` and notifies once, naming the permissions; the check runs on every mint, not only the first. Any other failure (a network error, a 5xx) is not recorded: it may pass.

**No new closed-list value.** Port failures reuse `GitHubAppPortError`'s values: `token_write_scoped`; `install_failed` (a mint, reach-list or Keychain failure in `recordInstallation`, and a Keychain failure in `removeApp`); `conversion_failed` (a `pem` that is not PEM-shaped, an App id or slug that cannot be stored, or a Keychain failure in `storeApp`). `ConnectorErrorCode` and `CONNECTOR_ERROR_STATUS` are unchanged.

### The port

`GitHubAppPort` (`kernel/src/integrations/types.ts`) is the interface between the setup flow and the connector. `githubAppPort` (`github/app-port.ts`) is the real port, `createGitHubAppPort(deps)` its factory (Keychain reader, writer and deleter, the token holder and a client factory, each resolved only when a call needs it). Three methods, each returning a `Promise<GitHubAppPortResult<…>>`, never throwing or rejecting whatever they are given, and serialised (one call at a time, on the queue the token connector shares, so a token set never interleaves with an App call):

| Method | Does |
|---|---|
| `storeApp(…, conversion, pem)` | writes the App's id, slug and encoded key (replacing any earlier App's), sets `app_slug` on the connector row and creates the row `disconnected` when there is none; `method` and `status` are unchanged, so a token in use stays in use |
| `recordInstallation(…, installationId)` | stores the installation id, mints the first installation token and reads the permissions GitHub reports. Any write permission (or an unknown level) is `token_write_scoped`, naming it: nothing is connected, the App's four items are removed, and a token in use stays as it was. Otherwise it reads the reach list, deletes the token's Keychain item, and writes the row `connected`, `method: app`, `permissions_source: reported`, with the permissions, the installed repos, `installation_id`, `expires_at` and one `connector_status` event. A mint, reach-list or Keychain failure is `install_failed`, removes the installation item and leaves a token in use unchanged |
| `removeApp(…)` | deletes the App's four items, drops the held token, clears `app_slug` and `installation_id`, and returns the row, `disconnected` if it was an App row (one event, on a change only); a token connection is not the App's to end and stays as it is |

Its dependencies (the store, the clock) are parameters, in `GitHubConnector`'s idiom (`setToken(store, token, now, …)`). `GitHubAppPortResult<T>` is `{ ok: true; value }` or `{ ok: false; error: GitHubAppPortError; message: string }`, where `GitHubAppPortError` is a `GitHubAppSetupRefusal` or `"not_implemented"` (a value the real port no longer answers). A failure's `message` is a fixed sentence (plus the permission names GitHub reported, for a write scope): never a caught error's text. `GitHubAppConversion` never carries `client_secret` or `webhook_secret`.

### The two non-GET calls

The client may send exactly two requests that are not GET, both to `api.github.com`, both in a fixed allowlist; every other method stays refused:

- `POST /app/installations/{id}/access_tokens`: mints an installation token, authenticated by an app JWT signed with the App's key (`mintInstallationToken`);
- `POST /app-manifests/{code}/conversions`: the manifest conversion, which returns the App and its secrets (`convertManifest`; unauthenticated, as the single-use `code` is the credential). The setup flow does not call it yet: `app-setup.ts` sends its own conversion, a recorded deviation pending the owner's confirmation ([GitHub App setup](github-app-setup.md#the-conversion)).

`isAllowedGitHubRequest(method, url)` is the one authority, checked with the origin before every request: GET, or exactly one of these two POSTs (no query, no fragment), and no host but `api.github.com`; no PUT, PATCH or DELETE and no other POST. Every request, GET or POST, goes through the one request path (timeout, rate limit, bounded read, no redirects).

The **reach list** is `GET /installation/repositories`, which lists exactly the repos the owner chose at install (the mint response carries no repo list).

### The secrets

The conversion's secret values are `pem` and `client_secret`. The `pem` goes to the Keychain, as its base64url encoding, and nowhere else. `client_secret` is never stored, logged or returned, and nothing uses it. Beside the `pem`, the secrets are the JWT (built, sent once, dropped) and the installation token (memory only). As for the token, no route answer, row, event, notification, log line, thrown error or CLI output carries any of them; the tests look for each secret string, and for the encoded `pem`, in every result, row, event and notification, after forced failures too.

### Open for wave 2

Answered by the kernel tokens item:

- `checkGitHubExpiry` (the [expiry](#expiry) work) skips a `method: app` row: an installation token renews every hour, so it never raises an expiry warning ([the credential lifecycle](#the-credential-lifecycle)).
- The Keychain item that holds the App's key is `loomwright-studio-github-app-key`, with the three other items above.

Still open:

- The length of a setup window is the setup item's call.
