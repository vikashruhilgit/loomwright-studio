# 04 — Kernel: set the App up through the manifest flow

## Status: done (superseded on 2026-10-29 by the /product-owner rewrite: _BACKLOG-2026-10-29-174816-github-app-connect.md)

**Priority:** MVP of the GitHub App backlog · invariants 3, 6 · D12 (loopback API)

**As** the owner,
**I want** Studio to create and install its GitHub App for me, leaving me only GitHub's Create and Install clicks,
**so that** setup takes a minute and I never handle a key file.

## Problem

Item 03 can use App credentials but nothing obtains them. Every kernel route requires the API token (`kernel/src/api/`), and GitHub's browser redirect cannot carry it.

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

1. **Start** (`POST /connectors/github/app/setup`, owner-only): opens one setup window (at most one at a time, 10-minute life) with a single-use random `state`, and returns the URL of a local page that auto-posts the manifest (from item 01's probe, with `redirect_url` and `setup_url` on the loopback API) to GitHub. The app name defaults to one the owner can change (e.g. `loomwright-studio-<login>`).
2. **The unauthenticated return routes** — the only routes without the API token, and they accept nothing else:
   - `GET /connectors/github/app/return?code=&state=`: refused unless a setup window is open and `state` matches it exactly; the `state` is spent on first use (a replay is refused). It calls the conversion, hands the `pem`, app id and slug to item 03's connector (Keychain), and redirects the browser to the app's install page.
   - `GET /connectors/github/app/installed?installation_id=&state=`: same checks; records the installation, has the connector mint its first token and verify permissions (item 03), and shows a plain "Done — return to Studio" page. Closes the window.
   - Each refusal is one fixed page and one `connector_status` event naming why (`setup_not_open`, `state_mismatch`, `setup_expired`, `conversion_failed`, `token_write_scoped`), with no secret and no query string echoed.
3. **Cancel** (`POST /connectors/github/app/setup/cancel`, owner-only) closes the window; a later return is refused.
4. **CLI:** `studio connectors github app setup` opens the same flow in the system browser and waits for the result.
5. **Docs:** `docs/architecture/integrations.md` (the flow, the window, why the two return routes are unauthenticated and what bounds them), `docs/architecture/api.md` or wherever the route table lives.

## Non-goals

- The screen (item 05).
- A hosted relay, or any return address that is not this machine's loopback API.

## Acceptance criteria

- [ ] Given no open setup window, a wrong `state`, an expired window or a replayed `state`, then each return route refuses with its fixed page and event, calls nothing on GitHub and writes nothing to the Keychain.
- [ ] Given the full flow against a fake GitHub, then the Keychain holds the App credentials, the connector reads `connected` with method `app`, and no response, page, log line or event contains the `pem`, `client_secret`, `webhook_secret`, the code or a token.
- [ ] Given a conversion whose app reports a write permission, then setup ends `token_write_scoped` and the stored credentials are removed.
- [ ] The return routes reject every method but GET, and the rest of the API still requires the token (a test over the route table).

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Risks

- The two unauthenticated routes as an attack surface for local processes: bounded by the open window, the single-use `state`, the 10-minute life and the fixed responses. Red-team them in review.

## Depends on
2026-10-29-102712-github-app-installation-tokens.md

## Touches
kernel/src/integrations/github/app-setup.ts
kernel/src/integrations/github/routes.ts
kernel/src/integrations/cli.ts
kernel/src/api/server.ts
kernel/test/integrations-github-app-setup.test.ts
docs/architecture/integrations.md
