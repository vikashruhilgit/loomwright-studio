# GitHub App 1 — The App connect's decision, contract and mockup (wave 1)

## Status: ready

**Priority:** MVP of the GitHub App backlog · wave 1 (alone) · D9 (mockup first) · invariants 1, 3, 5, 6

**As** the owner,
**I want** the GitHub App connect decided, its contract fixed and its screens approved before any of it is built,
**so that** the kernel's token work, the kernel's setup flow and the app's Connect sheet can be built at the same time without colliding, and the screens look the way I approved.

## Problem

Phase 6 built one connect path: paste a token, declared read-only by the owner (item 14). The owner chose to add a GitHub App connect beside it. Probe p13 proved that GitHub's App Manifest flow works against Studio's loopback API (`docs/OPEN_QUESTIONS.md`, "GitHub App connect").

Three items will build it in parallel (wave 2), but nothing they share exists yet:
- the DECISIONS entry;
- the route list, which `kernel/test/console-contract.test.ts` pins between `app/src/api/contract.ts` and the routes the kernel serves;
- the types;
- the interface between the setup flow and the connector;
- the approved mockup the app item must match.

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

1. **The decision.** Add the next D-entry (D36) to `docs/DECISIONS.md`:
   - the App connect beside the token path;
   - the manifest flow and why it is not a login;
   - the two allowlisted non-GET calls, read-only still;
   - no webhook;
   - the single-use `state` and setup window;
   - app-only setup.

   It records that it supersedes phase 6 item 03's "Studio never runs an OAuth flow", and gives probe p13 as its evidence.
2. **The contract in the docs.** Give `docs/architecture/integrations.md` a "GitHub App connect" section. It fixes what wave 2 builds against:
   - **Owner routes**, which take the API token like every route:
     - `POST /connectors/github/app/setup` returns `{setup_url, expires_at}`, opening the one setup window.
     - `POST /connectors/github/app/setup/cancel` returns `{cancelled}`.
     - The existing `GET /connectors` and `POST /connectors/github/disconnect` gain the App method.
   - **Browser routes**, GET only, without the API token, each gated by the open window and its single-use `state`:
     - `/connectors/github/app/start`: the local page that posts the manifest to github.com.
     - `/connectors/github/app/return`: GitHub's `redirect_url`, with `code` and `state`.
     - `/connectors/github/app/installed`: GitHub's `setup_url`, with `installation_id`, `setup_action` and `state`.
   - **The connector row's App fields:**
     - `method`: `token` | `app`.
     - `app_slug` and `installation_id`, which are not secret.
     - `permissions_source: reported`.
     - A token expiry that renews.
   - **The setup refusal reasons**, a closed list: `setup_not_open`, `state_mismatch`, `setup_expired`, `conversion_failed`, `install_failed`, `token_write_scoped`.
   - **The port** between the setup flow and the connector: store the converted app, record the installation (which mints the first token and verifies its permissions), and remove the App.
3. **The contract in code.**
   - **Types:** add the types the docs name to `kernel/src/integrations/types.ts`:
     - the method;
     - the App fields on `ConnectorRow`;
     - the refusal reasons;
     - `GitHubAppPort`, the port interface, including the conversion's non-secret fields and the `pem` it hands over.
   - **Port stub:** add `kernel/src/integrations/github/app-port.ts`, exporting a stub `githubAppPort` whose every method answers a typed `not_implemented` failure and never throws.
   - **Route stubs:** add `kernel/src/integrations/github/app-routes.ts`, a new integrations part. It registers the two owner routes and answers `501 {"error":"not_implemented"}`. Register it in `INTEGRATIONS_PARTS` (`kernel/src/integrations/index.ts`) with the stub port.
   - **App contract:** add the owner routes and their request and response types to `app/src/api/contract.ts`, and keep `kernel/test/console-contract.test.ts` in step.
   - **What waits for wave 2:** the browser routes need the API server to serve an unauthenticated route, which is the setup item's mechanism. This item only names them in the docs.
4. **The mockup (D9).** Add every designed state of the App path to `docs/design/mockups/integrations.html`, in light and dark, each reachable by URL hash like the existing views:
   1. The Connect sheet's choice: "Install GitHub App" (suggested; says permissions are checked by GitHub) and "Paste a token" (says permissions are declared by you).
   2. Setup in progress: waiting for the owner on GitHub (step 1 of 2, Create; step 2 of 2, Install), with Cancel and "Open GitHub again".
   3. Connected through the App: the app's name, the account, the repos chosen at install, "Permissions: read-only, checked by GitHub", and the token's expiry shown as renewing automatically.
   4. Refusals and failures, each with its copy:
      - setup expired;
      - setup cancelled;
      - the App reports a write permission (`token_write_scoped`, naming it);
      - the App was uninstalled or its key revoked on GitHub (`rejected`);
      - conversion or install failed;
      - kernel unreachable.
   5. Disconnect: what Studio removes (the key from the Keychain) and what the owner removes on GitHub (uninstall or delete the app), with a link.

   Record the states in `docs/DESIGN.md` ("Phase 6: Integrations", a GitHub App subsection), with screenshots in `docs/evidence/github-app-mockup/`. The owner approves the mockup on this item's PR.

## Non-goals

- Any working behaviour behind the stubs: tokens are the kernel tokens item, the setup flow is the kernel setup item, and the screen is the app item.
- The unauthenticated-route mechanism in the API server (the kernel setup item).
- A CLI setup verb (owner: app-only).

## Acceptance criteria

**Happy path:**
- [ ] Given this PR, when wave 2's items branch from main, then each can import the shared types and the port interface, and the app can call the two owner routes' types from `app/src/api/contract.ts`. No wave 2 item needs to edit any file this item adds or changes, except the stubs its own scope fills: `app-port.ts` (the kernel tokens item) and `app-routes.ts` (the kernel setup item).
- [ ] Given the kernel built from this PR, when the app calls `POST /connectors/github/app/setup` or `/setup/cancel` with the API token, then the kernel answers `501 {"error":"not_implemented"}`, and `kernel/test/console-contract.test.ts` passes with both routes in both lists.
- [ ] Given `docs/DECISIONS.md`, then D36 records every owner decision above and names the clause it supersedes; `docs/architecture/integrations.md`'s credential paragraph points at it.
- [ ] Given the mockup, then every state in Scope 4 exists in light and dark, reachable by URL hash, listed in `docs/DESIGN.md` with its screenshot; the owner approves it on this PR (D9).

**Edge cases:**
- [ ] Given the stub port, when any method is called, then it answers a typed `not_implemented` failure and never throws.
- [ ] Given the token path, then nothing in it changes: every existing connector, route and app test still passes.

**Error scenarios:**
- [ ] Given the owner routes called without the API token, then they answer `401` like every other route.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- D36 is the next free decision number (D35 is the last today).
- The mockup's states cover every refusal the kernel items can produce. A state found missing later is added to the mockup in the app item's PR, with the owner's approval.

## Risks

- **A contract that's wrong for wave 2:** a wave 2 item that finds the contract wrong must say so in its PR and change only what it owns. Review the contract section carefully on this PR.
- **The mockup's size:** many states. Keep to the existing mockup's structure and token block.

## Depends on
none

## Touches
docs/DECISIONS.md
docs/architecture/integrations.md
docs/DESIGN.md
docs/design/mockups/integrations.html
docs/evidence/github-app-mockup
kernel/src/integrations/types.ts
kernel/src/integrations/index.ts
kernel/src/integrations/github/app-port.ts
kernel/src/integrations/github/app-routes.ts
kernel/test/console-contract.test.ts
kernel/test/integrations-github-app-contract.test.ts
app/src/api/contract.ts
