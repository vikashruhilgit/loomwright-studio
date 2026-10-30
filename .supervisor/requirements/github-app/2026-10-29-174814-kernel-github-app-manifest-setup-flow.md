# GitHub App 3 — Kernel: the manifest setup flow and its browser routes (wave 2)

## Status: ready

**Priority:** MVP of the GitHub App backlog · wave 2 (parallel with GitHub App 2 and 4) · invariants 3, 6 · D12 (loopback API)

**As** the owner,
**I want** Studio to create and install its GitHub App for me, leaving me only GitHub's Create and Install clicks,
**so that** setup takes a minute and I never handle a key file.

## Problem

Every kernel route requires the API token (`kernel/src/api/server.ts`, `isAuthorized`), but GitHub's browser returns can't carry it. Nothing serves the page that posts the manifest, receives GitHub's two returns, or converts the code.

Wave 1 fixed the contract:
- the routes, owner and browser, in `docs/architecture/integrations.md`;
- the refusal reasons and `GitHubAppPort` in `kernel/src/integrations/types.ts`;
- the stub routes in `kernel/src/integrations/github/app-routes.ts`.

Probe p13 showed the flow works on `http://127.0.0.1:<port>`.

## Owner decisions (binding)

Each item in this backlog carries this copy. Every phase 6 decision (items 01–16) and invariants 1–9 stay as they are, except where a line below says it supersedes one.

Recorded 2026-10-29, after probe p12 showed GitHub reports no permissions for a fine-grained token:

- **Studio gets a GitHub App connect, beside the token path.** The owner's reasons:
  - An installation token's permissions and repos are reported by GitHub, so read-only is proven rather than declared.
  - Installation tokens expire after an hour.
  - A later posting phase gets a `<app>[bot]` identity instead of the owner's account. Posting itself is out of scope here.
- **Keep both paths.** The Connect sheet offers "Install GitHub App" (suggested; permissions checked by GitHub) and "Paste a token" (owner-declared). Neither replaces the other.
- **Setup = the GitHub App Manifest flow.**
  - Studio opens github.com in the system browser with the app pre-filled: private, no webhook, `Pull requests: Read`, `Contents: Read`, `Metadata: Read`.
  - The owner clicks Create, then picks repos and clicks Install. Those two clicks stay the owner's: consent to create an app on their account, and to choose its repos.
  - Studio receives and stores the app's key itself. The owner never downloads a key file.
- **This supersedes phase 6 item 03's "Studio never runs an OAuth flow" and its non-goal "GitHub Apps".** The manifest flow is not a login and reuses no `gh` credential, but it is a browser round trip that returns a secret to Studio. It is recorded as a new D-entry in `docs/DECISIONS.md` (wave 1).
- **Read-only still.** The App's permissions are read-only. Any installation token reporting a write permission is refused `token_write_scoped`, as for a token. Raising the App's permissions is a later phase's decision.
- **Two allowlisted non-GET calls.** The client may send only two requests that are not GET, both to `api.github.com`, both in a fixed allowlist:
  - minting an installation token, `POST /app/installations/{id}/access_tokens`;
  - the manifest conversion, `POST /app-manifests/{code}/conversions`.

  Every other method stays refused.

Recorded 2026-10-29 with the owner, after probe p13 (`docs/OPEN_QUESTIONS.md`, "GitHub App connect"):

- **GitHub accepts loopback return addresses.** It accepts `redirect_url` and `setup_url` on `http://127.0.0.1:<port>` (the loopback API), and it returns the `state` on both the create and the install returns.
- **No webhook block.** The manifest carries no `hook_attributes`, because GitHub refuses a loopback webhook URL even when inactive. Studio polls, as today.
- **The single-use `state` and the setup window are the gate.** The `state` shows in the browser's address bar and history, so it is spent on its first use. Each setup window is single-use and short-lived, and at most one is open at a time.
- **The secrets.** The conversion's secrets are `pem` and `client_secret`. Studio keeps the `pem` in the Keychain, and never stores, logs or returns `client_secret`. No item uses `client_secret`.
- **Repo list.** The mint response carries no repo list. The reach list is `GET /installation/repositories`, which lists exactly the repos chosen at install.
- **App-only setup, no CLI setup verb.** Setup starts only from the app's Connect sheet. `studio connectors github status` still shows the method and the permissions' source.
- **Shape:** two waves.
  - Wave 1 is this backlog's contract, decision and mockup item.
  - Wave 2 is three items in parallel: kernel tokens, kernel setup flow, and the app's Connect sheet. They have disjoint Touches and build against the wave 1 contract.

## Scope

1. **Unauthenticated browser routes, as a bounded mechanism.**
   - A contributed route may be marked unauthenticated (`kernel/src/features/contribution.ts`). The API server (`kernel/src/api/server.ts`) serves such a route without the bearer token **only** if it is a GET and its path is on a fixed allowlist: the three browser routes.
   - The merge refuses any other unauthenticated route.
   - Every other route keeps the token check exactly as today, and a test over the whole route table pins that.
2. **The setup window** (`kernel/src/integrations/github/app-setup.ts`):
   - `POST /connectors/github/app/setup` (owner) opens one window, at most one at a time, with a 10-minute life and a single-use random `state`. It returns `{setup_url, expires_at}`, where `setup_url` is the start page's address.
   - Opening a new window closes the old one.
   - `POST /connectors/github/app/setup/cancel` closes it.
3. **The browser routes**, filling wave 1's stubs (`app-routes.ts`). Each is GET only and gated by the open window and its `state`:
   - **`/connectors/github/app/start?state=`** serves a page that posts the manifest to `https://github.com/settings/apps/new?state=<state>`. The manifest is private, with no `hook_attributes`, the three read permissions, and a `redirect_url` and `setup_url` on the loopback API. The app name defaults to `loomwright-studio-<short random>`.
   - **`/connectors/github/app/return?code=&state=`** checks the window and spends the `state`, then calls the conversion (`POST /app-manifests/{code}/conversions`, an allowlisted call). It hands the id, slug and `pem` to the port's `storeApp`, never keeps `client_secret`, and redirects the browser to the app's install page with a fresh single-use `state` for the install return.
   - **`/connectors/github/app/installed?installation_id=&setup_action=&state=`** checks the window and spends that `state`, calls the port's `recordInstallation`, shows a plain "Done — return to Studio" page, and closes the window.
   - Each refusal is one fixed page and one `connector_status` event naming the reason from wave 1's list. Neither one carries a secret, nor echoes the query string or code.
4. **Docs:**
   - `docs/architecture/github-app-setup.md`, new: the flow, the window, why the three browser routes are unauthenticated, and what bounds them (GET only, a fixed path allowlist, the open window, the single-use `state`, the 10-minute life, fixed responses).
   - A link to it from `docs/ARCHITECTURE.md`.

## Non-goals

- The tokens, the Keychain and the connector row (GitHub App 2). Tests here use a fake `GitHubAppPort`.
- The screen (GitHub App 4). A CLI setup verb (owner: app-only). A hosted relay, or any return address that isn't this machine's loopback API.

## Acceptance criteria

**Happy path:**
- [ ] Given an open window and a fake GitHub, when the start page, the return and the installed route are followed in order, then the fake port's `storeApp` and `recordInstallation` are called once each with the right values, the window closes, and the browser sees "Done".
- [ ] Given the start page, then its manifest has no `hook_attributes`, has exactly the three read permissions, and has return addresses on the loopback API's port.

**Edge cases:**
- [ ] Given a second setup request while a window is open, then the first window closes and its `state` is refused afterwards.
- [ ] Given cancel, then a later return is refused `setup_not_open`.
- [ ] Given a `state` used once, when it's replayed, then it's refused `state_mismatch`, and nothing is called on GitHub or the port.

**Error scenarios:**
- [ ] Given no open window, a wrong `state` or an expired window, then each browser route answers its fixed page and event, calls nothing on GitHub or the port, and writes nothing.
- [ ] Given a failed conversion, then the answer is `conversion_failed`. Given the port reporting `token_write_scoped`, the setup ends with that reason, and the port's `removeApp` is called.
- [ ] Given any request to a browser route that isn't GET, or to any other route without the token, then it's refused. The route-table test pins that exactly the three browser paths are unauthenticated.
- [ ] Given every page, event and log line on every path, then none contains the `pem`, `client_secret`, the code or a token (test each secret string).

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Risks

- **The three unauthenticated routes are an attack surface for local processes.** They're bounded by GET only, the path allowlist, the open window, the single-use `state`, the 10-minute life and fixed responses. Red-team them in review.
- **Real behaviour depends on GitHub App 2's port.** This item is complete against the fake port. The real flow is proven when wave 2 merges (see the plan doc's live check).

## Depends on
2026-10-29-174812-github-app-contract-decision-and-mockup.md

## Touches
kernel/src/features/contribution.ts
kernel/src/api/server.ts
kernel/src/integrations/github/app-setup.ts
kernel/src/integrations/github/app-routes.ts
kernel/test/api-unauthenticated-routes.test.ts
kernel/test/integrations-github-app-setup.test.ts
docs/architecture/github-app-setup.md
docs/ARCHITECTURE.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-30T06:19:42Z
- **Brief:** .supervisor/jobs/done/2026-10-30-kernel-github-app-manifest-setup-flow.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/172
