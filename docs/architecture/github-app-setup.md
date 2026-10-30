# GitHub App setup

Part of [Phase 6 features](../ARCHITECTURE.md#phase-6-features) and the GitHub App connect ([D36](../DECISIONS.md)); the contract is in [integrations](integrations.md#github-app-connect). Built and documented by the **kernel setup item**: the setup window, the manifest page, the manifest conversion and the five routes, in the integrations feature's `github/app-setup.ts` and `github/app-routes.ts` parts (`kernel/src/integrations/github/`), over the unauthenticated-route mechanism in `kernel/src/features/contribution.ts` and `kernel/src/api/server.ts`. Tests: `kernel/test/integrations-github-app-setup.test.ts` (the flow), `kernel/test/api-unauthenticated-routes.test.ts` (the mechanism and the shipped route table) and `kernel/test/integrations-github-app-contract.test.ts` (the routes as the API serves them).

The setup leaves the owner two clicks on GitHub, Create and Install, and Studio receives and stores the App's key itself. The kernel stores nothing here: it drives a `GitHubAppPort` (`storeApp`, `recordInstallation`, `removeApp`), which the tokens item makes real. Tests use a fake port and a fake GitHub (an injected `fetch`), never the network.

## The flow

```text
app            POST /connectors/github/app/setup (API token)   -> {setup_url, expires_at}; opens the one window
app            opens setup_url in the system browser
browser        GET  /connectors/github/app/start?state=<start>  -> page that posts the manifest to github.com
GitHub         the owner clicks Create
browser        GET  /connectors/github/app/return?code=&state=<create>
                 -> convert the code, port.storeApp, 302 to the App's install page
GitHub         the owner picks repos and clicks Install
browser        GET  /connectors/github/app/installed?installation_id=&setup_action=&state=<install>
                 -> port.recordInstallation, "Done", the window closes
```

| Route | Token | Does |
|---|---|---|
| `POST /connectors/github/app/setup` | API token | Opens the one window (closing any other): `{setup_url, expires_at}`. `setup_url` is the start page on the API's own loopback origin; `expires_at` is the clock plus 10 minutes |
| `POST /connectors/github/app/setup/cancel` | API token | Closes the window: `{cancelled}`, true when one was open |
| `GET /connectors/github/app/start` | none | The page that posts the manifest. Calls nothing on GitHub or the port and writes nothing |
| `GET /connectors/github/app/return` | none | GitHub's `redirect_url`. Converts the `code`, hands the App to `port.storeApp`, redirects to the App's install page (`https://github.com/apps/<slug>/installations/new`) |
| `GET /connectors/github/app/installed` | none | GitHub's `setup_url`. Hands the installation to `port.recordInstallation`, shows "Done — return to Studio", closes the window. `setup_action` is not used |

The manifest is private, has **no `hook_attributes`** (GitHub refuses a loopback webhook URL even when inactive, probe p13), asks for exactly `pull_requests`, `contents` and `metadata` at `read`, and has `redirect_url` and `setup_url` on the API's loopback origin. The origin is the one the API server is bound to (`ContributedRouteRequest.origin`, from its `address()`), never the request's `Host` header, which a caller controls. The App's name is `loomwright-studio-<6 hex>`, new on every load of the start page.

## The window

In memory only: a kernel restart loses it, and the owner starts again.

- **At most one open.** Opening a new window closes the old one, and the old one's `state`s are refused afterwards (`state_mismatch`). Cancel closes it (`setup_not_open` afterwards).
- **10 minutes** from the clock when it opens (`GITHUB_APP_SETUP_WINDOW_MS`). Past that every browser route answers `setup_expired`; the expired window stays until a new one opens or cancel, so a reload says the same thing.
- **Phases.** *Awaiting create*: the start page may be loaded, and each load mints a fresh create `state` for GitHub's `?state=`, replacing the previous one. The return spends the create `state` and, in the same step, moves the window to *converting* (the conversion and the storing are in flight): a start-page load is refused `state_mismatch` then, so no second create `state` exists and the key is written once. When the App is stored the return mints a single-use install `state`: *awaiting install*. A failure while converting closes the window. The installed route spends it and the window is closed.
- **Every `state` is at least 128 random bits** (256, `node:crypto`) and compared in constant time (both sides hashed first, so the length leaks nothing). Every `state` GitHub carries, the create one and the install one, is single-use: spent on its first use, before anything is awaited, so a replay is `state_mismatch`.
- **A wrong `state` leaves the window as it was.** A local process that guesses cannot end a setup. A terminal failure (a failed conversion, a port failure, an installation id that is not a number) closes the window; the owner uses Set up again.
- **A window cancelled, replaced or expired while the conversion is in flight** stores nothing: the answer is `setup_not_open` or `setup_expired`.
- **A window cancelled, replaced or expired while `port.storeApp` is running** answers `setup_not_open` or `setup_expired`, not the redirect to the install page. The App that call stored is left for the next setup or disconnect: it is not removed, because the key store holds one App and removing it could remove a replacement window's App. A replacement window's `storeApp` can run alongside the old one's; the last to finish wins the key.
- **A window gone while `port.recordInstallation` is running** does not change the answer (the installation is recorded). On `token_write_scoped` the App is removed unless a replacement window has moved past *awaiting create* meanwhile, since the stored App may then be the replacement's.

**Recorded deviation from the requirement.** Its scope says the window has "a single-use random `state`". Here the **start** `state` (the one in `setup_url`) can be reused for start-page reloads until the return arrives, because the app's "Open GitHub again" ([DESIGN](../DESIGN.md#github-app-connect)) reopens the same `setup_url`. It only opens the start page; it is never what GitHub carries. Every `state` that GitHub carries (create and install) is single-use. From the moment the return arrives (including while its conversion is in flight), the start `state` opens nothing.

## Why the three browser routes are unauthenticated

GitHub's returns are the owner's browser navigating to a URL: they cannot carry the API token. So exactly three routes are served without it, and every other route, and every WebSocket upgrade, keeps the token check as before. What bounds them:

1. **GET only.** A POST or HEAD to a browser path without the token is 401. The merge refuses an unauthenticated route that is not a `GET`, and the server checks the method itself too, so a hand-built route cannot open a POST.
2. **A fixed path allowlist.** `UNAUTHENTICATED_ROUTE_PATHS` is frozen and holds the three paths. The merge refuses any other path (the kernel refuses to start), and the server checks the list itself. `kernel/test/api-unauthenticated-routes.test.ts` pins that the shipped route table has exactly these three unauthenticated routes and that every other route answers 401 without the token.
3. **The open window.** With no window open a browser route is refused `setup_not_open`, calling nothing.
4. **The single-use `state`** (above), which also appears in the browser's address bar and history, which is why it is spent on first use.
5. **The 10-minute life.**
6. **Fixed responses.** Each page is a fixed text per reason; the request's query string, the `code`, a `state`, a token and every secret are never echoed. Every browser answer carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer` (the `state` is in the URL).
7. **No body is read.** An unauthenticated request's body is drained, never read or parsed, and the handler sees `body` `undefined`.

The residual risk is a local process that can reach the loopback port: it can make a refusal event per request (a `connector_status` event, which posts a card to the owner's thread). It cannot complete a setup without a `state`, and it cannot read the `state`s, which only the owner's browser sees. Rate-limiting refusal events is a possible follow-up.

## The refusals

Each refusal is one fixed page and one `connector_status` event `{connector_id, kind: "github", status, refused}`: `connector_id` and `status` from the GitHub row when one exists, else `null`. The event is the only write: no connector row, port call or Keychain write. A failed event write never changes the answer. The reasons are the closed list `GITHUB_APP_SETUP_REFUSALS` ([integrations](integrations.md#the-setup-refusal-reasons)); `GITHUB_APP_SETUP_STATUS` is the mapping to HTTP statuses.

| Reason | HTTP status | When |
|---|---|---|
| `setup_not_open` | 400 | no window is open: never opened, cancelled, replaced or finished |
| `state_mismatch` | 400 | the `state` is missing, wrong, from another window, the wrong step's, or already spent |
| `setup_expired` | 400 | the window is past its 10 minutes |
| `conversion_failed` | 502 | the `code` is not a short `[A-Za-z0-9_-]` string, or GitHub's conversion did not answer a usable App |
| `install_failed` | 502 | the installation id is not a positive integer, or the port could not record the App or the installation; a port answering `not_implemented` is shown as `install_failed` |
| `token_write_scoped` | 422 | the installation token reports a write permission (as on the token path): the setup ends and the port's `removeApp` is called once |

Success is a `200` for the start page and for "Done", and a `302` for the return's hand-off to GitHub's install page. A port failure whose reason is one of the six is shown with that reason; its `message` is never shown or logged.

## The conversion

`POST https://api.github.com/app-manifests/{code}/conversions`, with no credential and no body, through an injected `fetch` (default the global; redirects are never followed; 15 second timeout). The host (`GITHUB_APP_CONVERSION_HOST`), method and path shape (`githubAppConversionPath`) are constants in `app-setup.ts`, and the `code` is validated as a short `[A-Za-z0-9_-]` string **before** any call, so an invalid one sends nothing. It is the only non-GET call this item makes.

The answer must be a `201` whose body, bounded to 256 KB, has the fields below; it is parsed field by field into `GitHubAppConversion` (`app_id`, `slug`, `name`, `owner_login`, `html_url`, `client_id`) and the `pem`. `client_secret` and `webhook_secret` are **dropped at parse time**: never stored, logged, returned or passed on. The `pem` is passed to `port.storeApp` and goes to the Keychain there; this file never keeps it.

**Recorded deviation, for the owner to confirm.** [D36](../DECISIONS.md) and [integrations](integrations.md#the-two-non-get-calls) put this call inside the GitHub client's allowlist. `client.ts` belongs to the tokens item, so this item sends the conversion from a second call site, `app-setup.ts`. It is that one call site, with the fixed host, method and path shape above. The follow-up is to route the call through the tokens item's client once both lanes have merged.

## The secrets

No page, event, route answer or log line on any path carries the `pem`, `client_secret`, `webhook_secret`, the `code` or a token, and a refusal does not echo a `state` or the query string. The test checks each secret string on the happy path, the conversion failures and every port failure. The one place a `state` is written to a page is the start page's form (the create `state`, which GitHub must carry) and the return's redirect (the install `state`).
