# GitHub App 2 — Kernel: App credentials and installation tokens (wave 2)

## Status: ready

**Priority:** MVP of the GitHub App backlog · wave 2 (parallel with GitHub App 3 and 4) · invariants 2, 3, 5, 6, 8 · D27 (Keychain pattern)

**As** the owner,
**I want** the kernel to read GitHub with short-lived installation tokens whose permissions and repos GitHub reports,
**so that** read-only is proven rather than declared, a leaked token dies within the hour, and Studio reaches exactly the repos I chose at install.

## Problem

Today:
- `GitHubClient` (`kernel/src/integrations/github/client.ts`) reads one long-lived token from the Keychain item `loomwright-studio-github` and sends GETs only.
- The connector (`connector.ts`) knows one credential kind.
- Nothing can sign an app JWT, mint or renew an installation token, or read an installation's repos.

Wave 1 fixed the contract: the `GitHubAppPort` interface in `kernel/src/integrations/types.ts`, the stub port in `kernel/src/integrations/github/app-port.ts`, and the App fields and refusal reasons. This item makes the port real.

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

1. **App credentials in the Keychain.** The app's id, its slug, the installation id and the private key (`pem`) are kept through `kernel/src/auth/keychain.ts`, under their own item names. They never go in the store (beyond the non-secret slug and installation id), a log, an event or a response. Disconnect deletes them. `client_secret` is never stored.
2. **Installation tokens** (`kernel/src/integrations/github/app-token.ts`):
   - It signs an RS256 app JWT with Node's built-in `crypto`, adding no dependency: issued 60 s back for clock skew, at most 10 minutes' life, `iss` = app id. Probe p13's signing is the reference.
   - It mints a token with `POST /app/installations/{id}/access_tokens`.
   - It keeps the token in memory only and never writes it anywhere.
   - It renews the token before `expires_at` (at 5 minutes left) and once on a 401.
3. **Verified permissions and reach.**
   - The mint response's `permissions` become the connector's permissions, with `permissions_source: reported`.
   - Any level above read means `token_write_scoped`, naming the permission, and nothing is connected.
   - The reach list is `GET /installation/repositories`, which lists exactly the installed repos. It's refreshed on connect and on the existing refresh.
4. **The client takes a token provider.** `createGitHubClient` gets its token from an injected provider: the Keychain PAT, or the installation-token module. It reads the token per call, as today.
   - The method allowlist gains exactly the two allowlisted POSTs, both to `api.github.com`. A test pins that every other method and host stays refused.
   - `daemonKernelDeps()` (`kernel/src/daemon-deps.ts`) and the GitHub tools (`tools.ts`) build their client from the connector's current method.
5. **The port, made real** (`app-port.ts`), replacing wave 1's stub:
   - `storeApp`: Keychain write of the conversion's id, slug and `pem`.
   - `recordInstallation`: store the installation id, mint the first token, verify permissions, read the reach list, and write the connector row `connected` with `method: app`. A write permission returns `token_write_scoped` and removes the stored credentials.
   - `removeApp`: delete the App credentials.
   - Every method returns a typed result and never throws.
6. **Connector row and states.** Migration 19 (`kernel/src/store/migrations/019_connector_app.ts`) adds the App fields to `connectors`, following migration 18's pattern.
   - A renewal is silent.
   - If GitHub refuses the key or the installation is gone (uninstalled or suspended), the row reads `rejected` and the owner is notified once, like an expiry.
7. **Owner surfaces.**
   - `GET /connectors` shows the method, the app slug and the reach list (`routes.ts`).
   - `POST /connectors/github/disconnect` removes either method's credentials.
   - `studio connectors github status` (`cli.ts`) names the method and the permissions' source.
8. **Docs:** in `docs/architecture/integrations.md`, the App credential lifecycle: the Keychain items, the mint, renewal, the reach list, the allowlist and the refusals.

## Non-goals

- The manifest setup flow and its routes (GitHub App 3). The screen (GitHub App 4).
- Webhooks; any write permission; posting.
- Any change to the token path's behaviour.

## Acceptance criteria

**Happy path:**
- [ ] Given App credentials stored through the port and a fake GitHub that reports read permissions, when `recordInstallation` runs, then the connector reads `connected`, with `method: app`, `permissions_source: reported`, and only the installed repos.
- [ ] Given `method: app`, when a due poll, a poll dry run or a GitHub tool reads GitHub, then it uses the installation token. Given `method: token`, it uses the PAT, unchanged.
- [ ] Given a token within 5 minutes of `expires_at`, or a 401, when the next call is made, then a new token is minted first.

**Edge cases:**
- [ ] Given a clock skewed by up to 60 s, then the JWT is still accepted (fake GitHub checks `iat` and `exp`).
- [ ] Given the token path is connected and the owner then completes the App setup, then the App replaces it as the current method, and the PAT's Keychain item is removed. Disconnect removes whichever method is current.

**Error scenarios:**
- [ ] Given a mint response reporting any write permission, then it's refused `token_write_scoped`, naming the permission. Nothing is connected, and the stored App credentials are removed.
- [ ] Given a 401 or 404 on mint (key revoked, app uninstalled), then the row reads `rejected` and the owner is notified once (notifier stub; no test posts a real notification).
- [ ] Given a failed renewal, then the caller gets a typed failure, never a throw.
- [ ] Given any response, log line, event or store row on every path, then none contains the `pem`, a JWT or an installation token (test each secret string).
- [ ] The client refuses every method except GET and the two allowlisted POSTs, and every host except `api.github.com`.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The App replaces the token as the current method, rather than both being active at once. The kernel reads GitHub through one credential at a time. The owner can confirm on the PR.

## Risks

- **A secret leaking** through an error message or an event payload. Test every path for each secret string.
- **Clock skew rejecting the JWT.** The `iat` back-off, plus a skewed-clock test.

## Depends on
2026-10-29-174812-github-app-contract-decision-and-mockup.md

## Touches
kernel/src/integrations/github/client.ts
kernel/src/integrations/github/app-token.ts
kernel/src/integrations/github/app-port.ts
kernel/src/integrations/github/connector.ts
kernel/src/integrations/github/routes.ts
kernel/src/integrations/github/tools.ts
kernel/src/integrations/cli.ts
kernel/src/daemon-deps.ts
kernel/src/auth/keychain.ts
kernel/src/store/migrations/019_connector_app.ts
kernel/src/store/migrations/index.ts
kernel/test/integrations-github-client.test.ts
kernel/test/integrations-github-connector.test.ts
kernel/test/integrations-github-app-token.test.ts
kernel/test/integrations-github-app-port.test.ts
docs/architecture/integrations.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-30T06:16:49Z
- **Brief:** .supervisor/jobs/done/2026-10-30-kernel-github-app-installation-tokens.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/173
