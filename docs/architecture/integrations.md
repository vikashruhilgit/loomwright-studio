# Integrations

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features). Built and documented by **item 03** (the GitHub connector: token validation and the repos the token reaches) and **item 14** (the owner's declaration that a token is read-only), in the integrations feature's `github/connector.ts` and `github/routes.ts` parts and its `cli.ts` (`kernel/src/integrations/`), over the read-only client in `github/client.ts`; and by **item 11** (the Integrations screen, `app/src/screens/integrations/`).

**Routes** (owner-only):

| Route | Answers |
|---|---|
| `GET /connectors` | `{connectors}`: every `connectors` row in the `Connector` shape, `[]` when nothing was ever set up |
| `POST /connectors/github/token` | body `{token, declared_read_only?}`; `declared_read_only`, when present, must be a boolean (else 400 `invalid_body`), and only `true` declares; validates the token, then stores it; `{connector}`, the row after the change, never the token |
| `POST /connectors/github/disconnect` | deletes the Keychain item; `{connector}`, the row after the change |
| `GET /connectors/github/repos[?refresh=1]` | `{repos, verified_at}`: the repos the token reaches, as `owner/name` (`[]` and `null` with no row); `refresh=1` re-reads them from GitHub first |

**Contract types it fills** (`app/src/api/contract.ts`): `ConnectorKind`, `ConnectorStatus`, `Connector`, `ConnectorsResponse`, `ConnectorTokenBody`, `ConnectorChangeResponse`, `ConnectorReposQuery` and `ConnectorReposResponse`.

The credential is Studio's own fine-grained, read-only personal access token, which the owner creates for the personal repos they choose. Studio runs no OAuth flow and never reuses the `gh` CLI's login. GitHub is an optional connector (invariant 5): Studio works with none. Item 11 builds the screen (`app/src/screens/integrations/`; see [Phase 6 features](../ARCHITECTURE.md#phase-6-features)).

## The token and the Keychain item

The token lives only in the Keychain item `loomwright-studio-github` (generic password, account `loomwright-studio`), written and deleted through `kernel/src/auth/keychain.ts`, the one module that touches the Keychain. No route answer, `connectors` row, event, notification, log line, thrown error or CLI output carries it, and the tests check each of these for its absence, after a forced failure too:

- the connector logs nothing, and every failure is a fixed code with a fixed message; a caught error's text is never kept;
- each route handler catches everything and answers a typed failure, so the API's `route_failed` event (which records a clipped error message) is never written for these routes;
- the client checks the token's shape before it reaches a header (so Node's `Headers` never throws a message quoting it) and answers every throw as `unreachable`.

The client (`createGitHubClient`) reads the token fresh from the Keychain on each call, sends GETs only, and only to `https://api.github.com`.

## The `connectors` table

One row per connector kind (migration 17, plus migration 18 for the two permission-source columns). It holds what the connector last verified: `status`, `account_login`, `permissions_json` (name to level, as GitHub reported them; `NULL` when GitHub reported none), `permissions_source` and `permissions_declared_at` (below), `reachable_repos_json` (`owner/name` strings), `expires_at`, `verified_at`, and `created_at` / `updated_at`. It never holds the token or any other secret. `permissions_source` says who vouched for the permissions: `reported` (GitHub's own answer; `permissions_declared_at` is `NULL`), `declared` (the owner said so; `permissions_json` is `NULL` and `permissions_declared_at` is the time of the write), or `NULL` on a row from before migration 18, which is never backfilled. The kernel never infers a source. A later `reported` connect clears `permissions_declared_at`; disconnect and refresh leave both columns as they were. The login, permission names and repo names come from GitHub: untrusted data, shown as text. Disconnecting keeps the row (and what it last verified) with status `disconnected`; nothing deletes it.

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

**Disconnect** deletes the Keychain item ("item not found", exit status 44, counts as already gone) and sets the row `disconnected`, kept. With no row it answers 404 `no_connector`.

**Refresh.** `GET /connectors/github/repos?refresh=1` re-reads the repos with the stored token and updates `reachable_repos_json` and `verified_at`, without a status change or an event. It needs a token in use (409 `not_connected` otherwise, 404 `no_connector` with no row); a 401 answers `token_invalid` without changing the row.

The connector runs one call at a time (set, disconnect, refresh), so two never interleave their Keychain steps.

## Expiry

The connector's due work (`checkGitHubExpiry`, every loop tick) reads the GitHub row only; it never touches the Keychain or GitHub. For a token in use with a known `expires_at`:

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
