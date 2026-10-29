# 03 — Kernel: connect through a GitHub App and use its installation tokens

## Status: done (superseded on 2026-10-29 by the /product-owner rewrite: _BACKLOG-2026-10-29-174816-github-app-connect.md)

**Priority:** MVP of the GitHub App backlog · invariants 2, 3, 5, 6, 8 · D27 (Keychain pattern)

**As** the owner,
**I want** the kernel to read GitHub with short-lived installation tokens whose permissions GitHub reports,
**so that** read-only is proven, a leaked token dies within the hour, and the repos Studio reaches are exactly the ones I chose at install.

## Problem

The `GitHubClient` (`kernel/src/integrations/github/client.ts`) reads one long-lived token from the Keychain item `loomwright-studio-github` and sends GETs only. The connector (`connector.ts`) knows one credential kind. Nothing can sign a JWT, mint an installation token, renew it, or read an installation's repos.

## Owner decisions (2026-10-29, binding)

Recorded 2026-10-29 after probe p12 showed GitHub reports no permissions for a fine-grained token. Each item carries this copy. Every phase 6 decision (items 01–14) and invariants 1–9 stay as they are, except where a line below says it supersedes one.

- **Studio gets a GitHub App connect, beside the token path.** The owner's reason: an installation token's permissions and repos are reported by GitHub, so read-only is proven rather than declared; installation tokens expire after an hour; and a later posting phase gets a `<app>[bot]` identity instead of the owner's account.
- **Order: after phase 6.** Phase 6's live run uses the owner-declared token (phase 6 item 14). This backlog runs after phase 6 closes and before any posting phase.
- **Keep both paths.** The Connect sheet offers "Install GitHub App" (suggested, permissions verified by GitHub) and "Paste a token" (owner-declared). Neither replaces the other.
- **Setup = the GitHub App Manifest flow.** Studio opens github.com in the system browser with the app pre-filled (private, no webhook, `Pull requests: Read`, `Contents: Read`, `Metadata: Read`); the owner clicks Create, then picks repos and clicks Install. Studio receives and stores the app's key itself; the owner never downloads a key file. Those two clicks stay the owner's (consent to create an app on their account, and to choose its repos).
- **Supersedes item 03's "Studio never runs an OAuth flow" and its non-goal "GitHub Apps".** The manifest flow is not a login and reuses no `gh` credential, but it is a browser round-trip that returns a secret to Studio. Item 01 of this backlog records it as a new D-entry in `docs/DECISIONS.md`, and `docs/architecture/integrations.md` is updated to match.
- **Read-only still.** The App's permissions are read-only; any installation token reporting a write permission is refused `token_write_scoped`, as for a token. Raising the App's permissions is a later phase's decision.
- **The one non-GET call.** Minting an installation token (`POST /app/installations/{id}/access_tokens`) and the manifest conversion (`POST /app-manifests/{code}/conversions`) are the only non-GET requests the client may send, both to `api.github.com`, both named in a fixed allowlist; every other method stays refused.

## Scope

1. **App credentials in the Keychain.** The app's id, the installation id and the private key (`pem`), stored by the connector through `kernel/src/auth/keychain.ts` under their own item names (never in the store, a log, an event or a response). Disconnect deletes them.
2. **Installation tokens.** A small module signs an RS256 JWT (10-minute life, `iat` 60 s back for clock skew) with Node's built-in `crypto` (no new dependency), then `POST /app/installations/{id}/access_tokens`. It keeps the token in memory only, renews it before `expires_at` (e.g. at 5 minutes left) and on a 401, and never writes it anywhere.
3. **Verified permissions.** The mint response's `permissions` is the connector's permissions, source **reported by GitHub**. Any level above read ⇒ `token_write_scoped`, naming it, nothing connected (as phase 6 item 03). The reach list is `GET /installation/repositories` (exactly the installed repos, not every public repo the account owns), refreshed on connect and on `?refresh=1`.
4. **The client takes a token provider.** `createGitHubClient` gets the token from an injected provider (the Keychain PAT, or the installation-token module), read per call as today. The method allowlist gains exactly the two non-GET calls named above, both to `api.github.com`; a test pins that every other method and host stays refused. The daemon's `daemonKernelDeps()` and the GitHub tools both build their client from the connector's current method.
5. **Connector row and states.** The row records the method (`token` | `app`), the app's slug and installation id (not secret), and the permissions' source. New states: renewing (silent), `rejected` when GitHub refuses the key or the installation is gone (uninstalled / suspended), with a notification once, like an expiry.
6. **Owner routes and CLI** (`routes.ts`, `cli.ts`): `GET /connectors` shows the method; disconnect works for both; `studio connectors github status` names the method and the permissions' source. Setting App credentials comes only from item 04's flow, never from argv.
7. **Docs:** `docs/architecture/integrations.md` (the App lifecycle, the Keychain items, renewal, the two allowlisted calls, the refusals).

## Non-goals

- The manifest setup flow and its loopback route (item 04); the screen (item 05).
- Webhooks: Studio still polls.
- Any write permission.

## Acceptance criteria

- [ ] Given App credentials and a fake GitHub reporting read permissions, then the connector reads `connected` with method `app`, permissions source reported, and the installed repos only; no key, JWT or installation token appears in any response, log line, event or the store.
- [ ] Given a mint response reporting any write permission, then it is refused `token_write_scoped` naming it, and nothing is connected.
- [ ] Given a token within 5 minutes of `expires_at`, or a 401, then the next call mints a new one first; a failed renewal returns a typed failure and never throws.
- [ ] Given a 404 or 401 on mint (uninstalled, key revoked), then the row reads `rejected` and the owner is notified once (notifier stub; no test posts a real notification).
- [ ] The client refuses every method other than GET and the two allowlisted POSTs, and every host other than `api.github.com`.
- [ ] A due poll, a poll dry run and the GitHub tools read through the installation token when the method is `app`, and through the PAT when it is `token`.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Risks

- The key or a token leaking through an error message or event payload: test every path for the absence of each secret string.
- Clock skew rejecting the JWT: the `iat` back-off and a test with a skewed clock.

## Depends on
2026-10-29-102710-github-app-probe-and-decision.md

## Touches
kernel/src/integrations/github/client.ts
kernel/src/integrations/github/app-token.ts
kernel/src/integrations/github/connector.ts
kernel/src/integrations/github/routes.ts
kernel/src/integrations/github/tools.ts
kernel/src/integrations/cli.ts
kernel/src/daemon-deps.ts
kernel/src/auth/keychain.ts
kernel/test/integrations-github-client.test.ts
kernel/test/integrations-github-connector.test.ts
kernel/test/integrations-github-app-token.test.ts
docs/architecture/integrations.md
