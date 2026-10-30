# Supervisor Job: GitHub App 3 — Kernel: the manifest setup flow and its browser routes (wave 2)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-29-234434/L3
- **CLAUDE.md:** ✓ Found (fresh — names `kernel/` strict TypeScript + vitest, invariants 1–9, `docs/DECISIONS.md` D36)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/github-app/2026-10-29-174814-kernel-github-app-manifest-setup-flow.md
- **Base commit:** 2b5a47d7d25b6a3a2ab3c27902bbc0ec29a66a91

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript on Node's built-in `http`/`crypto`/`fetch`, vitest — the kernel's existing stack |
| 2 | Dependency Availability | GO | No new dependency: `node:crypto` `randomBytes` for `state`, global `fetch` (injected in tests) for the conversion |
| 3 | Architecture Fit | GO | Routes contributed through the feature seam (`kernel/src/features/contribution.ts`), served by `kernel/src/api/server.ts`; D36 decides the flow; wave 1 fixed the types, stub port and stub routes |
| 4 | Scope vs Supervisor Capability | CAUTION | ~10 files and an estimated ~1,250 changed lines (most in two new test files) → past the `context-bound` bound; split into two sequential subtasks |
| 5 | Hard Blockers | CAUTION | The real port is the parallel GitHub App 2 lane's; this item is complete against a fake `GitHubAppPort`. The conversion call cannot go through `client.ts` (GitHub App 2's Touch), so it is made in `app-setup.ts` behind an injected `fetch` |

**Overall Verdict:** CAUTION

## Task
**Goal:** Make the kernel serve the GitHub App Manifest setup flow: a bounded unauthenticated-route mechanism for exactly three GET browser routes, a single-use 10-minute setup window with single-use `state`s, and the start / return / installed routes that drive a `GitHubAppPort`, against wave 1's contract.

**Problem Statement:**
The owner needs Studio to create and install its GitHub App for them, leaving only GitHub's Create and Install clicks, because setup should take a minute and the owner should never handle a key file.
Currently every kernel route requires the API token (`isAuthorized` in `kernel/src/api/server.ts`), but GitHub's browser returns can't carry it, and the two owner routes in `kernel/src/integrations/github/app-routes.ts` answer `501 {"error":"not_implemented"}`. Nothing serves the page that posts the manifest, receives GitHub's two returns, or converts the code. This blocks the App connect (D36).
Success looks like: following start → return → installed against a fake GitHub and a fake port calls `storeApp` and `recordInstallation` once each, closes the window, and shows "Done", while every other route still needs the token and no page, event or log line carries a secret.

**Design constraints (binding for the worker; derived from the requirement, D36 and `docs/architecture/integrations.md` §"GitHub App connect"):**
1. **Mechanism (subtask 1).** `ContributedRoute` gains an optional `unauthenticated?: true`. `mergeContributions` refuses (`InvalidContributionError`, part `route`) an unauthenticated route whose method is not `GET` or whose path is not exactly one of a frozen `UNAUTHENTICATED_ROUTE_PATHS` list (`/connectors/github/app/start`, `/connectors/github/app/return`, `/connectors/github/app/installed`), and carries the flag onto the merged `OwnedRoute`. The API server serves a request without a valid bearer token **only** when its method is `GET`, its pathname is exactly on that list, and a merged route with `unauthenticated: true` matches it; everything else (including `HEAD`, a POST to a browser path, and every WebSocket upgrade) keeps today's 401. The server checks the method and the list itself too (defence in depth), not only the merge, so a hand-built `OwnedRoute` with `method: "POST", unauthenticated: true` passed straight to `startApiServer({ routes })` still gets 401 without the token. An unauthenticated request's body is never read or parsed: the server drains it with `req.resume()` and the handler's `body` is always `undefined` (so a GET with a non-JSON body still gets the route's fixed page, never `invalid_json`).
2. **Browser answers (subtask 1).** `ContributedRouteResponse` gains a non-JSON form usable **only** by an unauthenticated route: a fixed HTML page (`text/html; charset=utf-8`) or a `302` redirect with a `Location`. Both are sent with `Cache-Control: no-store` and `Referrer-Policy: no-referrer` (the `state` is in the URL). A token-gated route answering the non-JSON form is the existing 500 + `route_failed` path. Every existing JSON answer is byte-identical to today.
3. **The request learns the API's own origin (subtask 1).** `ContributedRouteRequest` gains an **optional** `readonly origin?: string`: the server's bound loopback origin (`http://127.0.0.1:<port>`). The API server always sets it, from its own `address()` and never from the `Host` header. It is optional in the type for the same reason as `sessions?` / `killSwitch?` / `serialized?`: request literals built by hand in tests outside this brief's lanes (`kernel/test/console-control.test.ts`, `console-pause.test.ts`, `brain-crew-routing.test.ts`, `feature-seams.test.ts`) must still typecheck. The setup route answers a typed error when it is missing and never throws. It is needed so the setup route can build `setup_url` and the manifest's `redirect_url` / `setup_url`.
4. **The window (subtask 2, `app-setup.ts`).** In memory only, at most one open; 10-minute life from the clock; opening a new one closes the old; cancel closes it. Phases: *awaiting create* (the `setup_url` carries the window's start `state`; the start page may be reloaded — the app's "Open GitHub again" reopens the same `setup_url` — and each load mints a fresh single-use create `state` for GitHub's `?state=`, replacing the previous) → *awaiting install* (the return spends the create `state` and mints a single-use install `state`) → closed (the installed route spends it). Every `state` is ≥ 128 random bits (`node:crypto`), compared in constant time. **Recorded deviation:** the requirement's Scope 2 says the window has "a single-use random `state`". Here the start `state` can be reused for start-page reloads until the return arrives, because the app's "Open GitHub again" (`docs/DESIGN.md`, GitHub App connect) reopens the same `setup_url`. Every `state` that GitHub carries (create and install) is single-use. `docs/architecture/github-app-setup.md` records this choice and its reason. A start-page load calls nothing on GitHub or the port and writes nothing.
5. **The conversion (subtask 2).** `POST https://api.github.com/app-manifests/{code}/conversions` through an injected `fetch` (default the global), the only non-GET call this item makes; `code` is validated (a short `[A-Za-z0-9_-]` string) before any call. Parsed into `GitHubAppConversion` + `pem`; `client_secret` and `webhook_secret` are dropped at parse time and never stored, logged, returned or passed on. The call's host (`api.github.com`), method (`POST`) and path shape (`/app-manifests/<code>/conversions`) are constants in `app-setup.ts`. A test pins that the injected `fetch` sees exactly that one request shape, and that an invalid `code` sends nothing. **Recorded deviation (for the owner to confirm):** D36 and `docs/architecture/integrations.md` put this call inside the client's allowlist. `client.ts` is GitHub App 2's Touch, so this item sends it from a second call site in `app-setup.ts`. `docs/architecture/github-app-setup.md` and the PR body both say so in a dedicated paragraph, and name the follow-up: route the call through GitHub App 2's client once both lanes have merged.
6. **The port (subtask 2).** Routes take a `GitHubAppPort` (default `githubAppPort` from `app-port.ts`, which GitHub App 2 makes real in place) and a fetch through a deps factory, `createGitHubAppSetup(deps)` exported from `app-setup.ts` (the window life is the exported constant `GITHUB_APP_SETUP_WINDOW_MS`, 10 minutes), which `app-routes.ts` calls to build the five routes, in `GitHubConnector`'s dependency-as-parameter idiom; tests pass a fake port. A port failure whose `error` is a `GitHubAppSetupRefusal` is shown with that reason; `not_implemented` is shown as `install_failed`. `token_write_scoped` from `recordInstallation` ends the setup with that reason and calls `removeApp` once.
7. **Refusals.** Each refusal is one fixed page per reason and one `connector_status` event `{connector_id, kind: "github", status, refused}` (`connector_id`/`status` from the GitHub row when one exists, else `null`), appended through `appendEvent` (`kernel/src/loop/internal.ts`). Neither echoes the query string, the `code`, a `state`, the `pem`, `client_secret` or a token. "Writes nothing" in the error ACs means no connector row, port or Keychain write — the one event is the only write. **HTTP statuses:** `setup_not_open`, `state_mismatch` and `setup_expired` → 400; `conversion_failed` → 502; `install_failed` → 502; `token_write_scoped` → 422 (as on the token path); the start page and "Done" → 200; the return's hand-off to GitHub's install page → 302. `docs/architecture/github-app-setup.md` carries this mapping as a table.
8. **Kept out of scope:** `client.ts`, `app-port.ts`, `connector.ts`, `docs/architecture/integrations.md` and `daemon-deps.ts` are GitHub App 2's Touches; this item edits none of them.

## Acceptance Criteria

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

**Mechanism (from the requirement's Scope 1 and 2, made checkable):**
- [ ] Given a contribution declaring an unauthenticated route that is not GET, or whose path is not one of the three browser paths, when `mergeContributions` runs, then it throws `InvalidContributionError` and the kernel refuses to start.
- [ ] Given `POST /connectors/github/app/setup` with the API token, then it answers `200 {setup_url, expires_at}` with `setup_url` on the API's own loopback origin and `expires_at` 10 minutes after the clock; `POST /connectors/github/app/setup/cancel` answers `{cancelled}`; both still answer 401 without the token.

**Validation (must pass before merge):**
- [ ] `cd kernel && npm ci && npm run typecheck && npm test` passes.
- [ ] `bash scripts/check-docs.sh` passes (the new `docs/architecture/github-app-setup.md` is linked from `docs/ARCHITECTURE.md` and every relative link in it resolves).

## Touched-file invariants

> Grounded at base `2b5a47d7d25b6a3a2ab3c27902bbc0ec29a66a91`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/api/server.ts`** (787) — keep: the token is checked from headers before the body is read (`// Headers only: the body is not touched before the caller is authenticated.`), and a refused caller gets exactly `send(res, 401, UNAUTHORIZED_BODY, { "WWW-Authenticate": "Bearer" });` for every path that is not one of the three GET browser paths; the WebSocket upgrade stays token-gated with no exception (`// Headers only, as for every request: nothing is upgraded before the caller is authenticated.`); a contributed route's invalid answer still reaches the 500 path (`if (!isContributedRouteStatus(answered)) throw new Error(`) and `recordRouteFailure(match.route, err);`; the constant-time compare in `isAuthorized` (`return timingSafeEqual(presented, expected);`). reuse: `send(` and `compileRoutePath`/`matchRoutePath` for matching — no second router. mirror: the route shape in `kernel/src/features/contribution.ts` (`export interface ContributedRouteResponse {`). pinned by: `kernel/test/api.test.ts` (`'{"error":"unauthorized"}'`, `["an unknown path, unauthenticated", null, "GET", "/nope"]`).
- **`kernel/src/features/contribution.ts`** (568) — keep: merge refuses, never resolves by order (`throw invalid("route", `), phase 1 shadowing check (`const shadowing = phase1Routes.find(`); the merged route is a new object — the new flag must be carried on it explicitly, since today's copy drops unknown fields (`routes.push({ owner, method: r.method, path: r.path, handler: (req) => r.handler(req) });`). reuse: `InvalidContributionError` for the new refusal. mirror: `kernel/src/api/server.ts` reads the flag and the list. pinned by: `kernel/test/feature-seams.test.ts` (`the feature registry's module graph (AC9)` — the seam must stay free of the Agent SDK), `kernel/test/console-contract.test.ts` (`expect(existing).toHaveLength(31);` — contract ⊆ served; three extra served browser routes do not break it, and they must not be added to `app/src/api/contract.ts`).
- **`kernel/src/integrations/github/app-routes.ts`** (47) — keep: the part's name and position (`name: "github-app-routes"`, last in `INTEGRATIONS_PARTS`), frozen (`export const githubAppRoutesPart: IntegrationsPart = Object.freeze({`); the module-graph rule in its header (`never the Agent SDK, the session manager or`) — `app-setup.ts` likewise imports only types, the feature seam, `../../loop/internal.js`, `node:crypto` and its own siblings. pinned by: `kernel/test/integrations-github-app-contract.test.ts` (`expect(INTEGRATIONS_PARTS.at(-1)).toBe(githubAppRoutesPart);`, and the 501 pins this item replaces).
- **`kernel/test/integrations-github-app-contract.test.ts`** (151) — keep: the header comment (lines 1–7, from `// the closed lists, the stub port and the two stub owner routes wave 2 builds`) byte-identical, so GitHub App 2's edit to this file merges cleanly with this one; `describe("the closed lists", () => {` and `describe("the stub port (AC5)", () => {` untouched (the stub port block is GitHub App 2's to change); only `describe("the stub owner routes (AC2, AC7)", () => {` is rewritten — the 501 pins become the routes' real answers (detail lives in the new setup test) and its route-list pin (`` expect(githubAppRoutesPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual([`POST ${SETUP}`, `POST ${CANCEL}`]); ``) grows to the five routes.
- **`docs/ARCHITECTURE.md`** (278) — keep: the integrations paragraph's sub-file list (`` `github/app-routes.ts` (part name `github-app-routes` ``); add one link to `architecture/github-app-setup.md` there and update its "both 501 stubs until wave 2" wording for the owner routes only. pinned by: `scripts/check-docs.sh` (relative-link check).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/api-unauthenticated-routes.test.ts` — the merge refuses a non-GET unauthenticated route | delete the method check on unauthenticated routes in `mergeContributions` (`kernel/src/features/contribution.ts`) |
| `kernel/test/api-unauthenticated-routes.test.ts` — the merge refuses an unauthenticated path off the list | remove `/connectors/github/app/installed` from `UNAUTHENTICATED_ROUTE_PATHS` and add a fixture path in its place in `kernel/src/features/contribution.ts` |
| `kernel/test/api-unauthenticated-routes.test.ts` — a POST (and a HEAD) to a browser path without the token is 401, given a hand-built `OwnedRoute` `{method: "POST", unauthenticated: true}` passed straight to `startApiServer({ routes })` (bypassing `mergeContributions`) | drop the `GET` condition from the server's no-token exception in `kernel/src/api/server.ts` |
| `kernel/test/api-unauthenticated-routes.test.ts` — a WebSocket upgrade to a browser path without the token is 401 | apply the no-token exception in the `server.on("upgrade"` handler too, in `kernel/src/api/server.ts` |
| `kernel/test/api-unauthenticated-routes.test.ts` — browser answers carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer` | delete the `Referrer-Policy` header from the non-JSON send in `kernel/src/api/server.ts` |
| `kernel/test/api-unauthenticated-routes.test.ts` — the request origin comes from the server's `address()`, not from `Host` | build the origin from `req.headers.host` in `kernel/src/api/server.ts` |
| `kernel/test/api-unauthenticated-routes.test.ts` — a token-gated route that answers the non-JSON form gets 500 + `route_failed` | drop the unauthenticated-only check on the non-JSON answer in `kernel/src/api/server.ts` |
| `kernel/test/api-unauthenticated-routes.test.ts` — an unauthenticated GET with a non-JSON body gets its page, and the handler sees `body` `undefined` | read and parse the body for unauthenticated routes as for token-gated ones in `kernel/src/api/server.ts` |
| `kernel/test/integrations-github-app-contract.test.ts` — the route-list pin grows to the five routes (2 POST owner routes + 3 GET browser routes) | delete the `/connectors/github/app/installed` route from `githubAppRoutes()` in `kernel/src/integrations/github/app-routes.ts` |
| `kernel/test/integrations-github-app-contract.test.ts` — the former 501 pins now pin `POST /connectors/github/app/setup` answering 200 `{setup_url, expires_at}` | make the setup handler answer `501 {"error":"not_implemented"}` again in `kernel/src/integrations/github/app-routes.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — the happy path calls `storeApp` and `recordInstallation` once each with the right values | delete the `recordInstallation` call in the installed handler in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — after cancel, a return is refused `setup_not_open` | make cancel a no-op in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — a failed conversion answers `conversion_failed` (502) | flip `conversion_failed` → `install_failed` on the conversion's failure path in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — `expires_at` is the clock + 10 minutes | flip the window life from 10 minutes to 11 in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — an invalid `code` sends no request; `fetch` sees only the one POST to `api.github.com/app-manifests/<code>/conversions` | delete the `code` format check in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — a start-page load replaces the previous create `state` | keep the previous create `state` valid after a reload in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — a start-page load calls nothing on GitHub or the port | call `port.storeApp` from the start handler in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — the manifest has exactly the three read permissions | drop `metadata: "read"` from the manifest's permissions in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — the manifest's `redirect_url` and `setup_url` are on the API's loopback origin | build `redirect_url` from a fixed `http://localhost` instead of the request's `origin` in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — no page, event or log line carries the `pem` | put the `pem` in the return's refusal page when `storeApp` fails in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — no page, event or log line carries the `code` | echo the `code` in the `conversion_failed` page in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — no page, event or log line carries a `state` or the API token | echo the request's query string in a refusal page in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — each refusal appends exactly one `connector_status` event carrying `refused`, and writes nothing else | skip the `appendEvent` call on the `state_mismatch` refusal in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — refusal statuses: `token_write_scoped` → 422; `setup_not_open` / `state_mismatch` / `setup_expired` → 400; `conversion_failed` → 502 | flip `token_write_scoped`'s status from 422 to 400 in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — a port answering `not_implemented` shows as `install_failed` | show `not_implemented` as `conversion_failed` in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/api-unauthenticated-routes.test.ts` — the shipped route table has exactly three unauthenticated routes | mark `POST /connectors/github/app/setup` `unauthenticated: true` in `kernel/src/integrations/github/app-routes.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — a replayed `state` is `state_mismatch` | skip spending the create `state` in the return handler in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — a second setup closes the first window | keep the old window open when a new one opens in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — an expired window is refused | flip the 10-minute life to 10 hours in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — `token_write_scoped` calls `removeApp` | delete the `removeApp` call in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — no page, event or log line carries `client_secret` | pass the raw conversion body to the page renderer instead of the parsed fields in `kernel/src/integrations/github/app-setup.ts` |
| `kernel/test/integrations-github-app-setup.test.ts` — the manifest has no `hook_attributes` | add `hook_attributes: { url: origin, active: false }` to the manifest in `kernel/src/integrations/github/app-setup.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Unauthenticated browser-route mechanism in the feature seam and API server | Mechanism AC 1; Error AC 3 (non-GET / no-token refused — with fixture routes); the HTML/redirect answer form and the request origin | 2 modify, 1 create | `skills/error-handling/SKILL.md`, `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | The setup window, the five GitHub App routes, and the docs | Happy path 1–2; Edge 1–3; Error 1, 2, 4; Error 3's shipped route-table pin; Mechanism AC 2; Validation | 3 modify (+1 shared test file), 3 create | `skills/error-handling/SKILL.md`, `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 mechanism | `kernel/src/features/contribution.ts` (568 — appending: it is the single authority for route validation and the route types; the frozen `UNAUTHENTICATED_ROUTE_PATHS` lives beside `PHASE1_ROUTES`), `kernel/src/api/server.ts` (787 — appending: the one dispatch and auth point; the no-token exception and the non-JSON send are a few lines beside `isAuthorized` / `handleContributed`) | `kernel/test/api-unauthenticated-routes.test.ts` | HIGH |
| 2 setup flow | `kernel/src/integrations/github/app-routes.ts` (47), `kernel/test/integrations-github-app-contract.test.ts` (151), `docs/ARCHITECTURE.md` (278), `kernel/test/api-unauthenticated-routes.test.ts` (created by #1; #2 adds the shipped-table pin) | `kernel/src/integrations/github/app-setup.ts` (the window, `state`s, manifest, conversion, fixed pages and refusal events — one home for the new responsibility), `kernel/test/integrations-github-app-setup.test.ts`, `docs/architecture/github-app-setup.md` | HIGH (MEDIUM for `docs/ARCHITECTURE.md` wording) |

**Total estimated files:** 5 modify + 4 create (10 paths incl. the shared test file). **Estimated changed lines:** ~1,250 (app-setup.ts ~350, setup test ~450, unauthenticated-routes test ~150, server/contribution ~120, app-routes ~60, contract test ~40, docs ~90).

### Blast-Radius / Impact Prediction

| Touched Subsystem | Depends On (`DEPENDS_ON`) | Depended-on-by — derived dependents (`DEPENDED_ON_BY`) | Source Contract | Incident History |
|-------------------|---------------------------|-------------------------------------------------------|-----------------|------------------|
| `kernel/src/api/server.ts` | `kernel/src/api/kill-switch.ts`, `kernel/src/auth/types.ts`, `kernel/src/budget/index.ts`, `kernel/src/loop/loop.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/sessions/orphans.ts`, `kernel/src/sessions/types.ts`, `kernel/src/store/store.ts` | `docs/ARCHITECTURE.md`, `kernel/src/cli/index.ts`, `kernel/src/kernel.ts` | `contract: kernel/src/api/server.ts` | none |

**Predicted ripple beyond directly-touched files:** `kernel/src/kernel.ts` and `kernel/src/cli/index.ts` start the API server and pass the merged routes — they need no edit (the flag rides on `OwnedRoute`), but `npm test` exercises both.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/test/api-unauthenticated-routes.test.ts"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "UNAUTHENTICATED_ROUTE_PATHS"}
  - {kind: "symbol", path: "kernel/src/api/server.ts", name: "UNAUTHENTICATED_ROUTE_PATHS"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "unauthenticated?: true"}
  - {kind: "symbol", path: "kernel/src/features/contribution.ts", name: "origin?: string"}
requires: []
lanes:
  - "kernel/src/features/contribution.ts"
  - "kernel/src/api/server.ts"
  - "kernel/test/api-unauthenticated-routes.test.ts"
external_requires: []

# Subtask 2
provides:
  - {kind: "file", path: "kernel/src/integrations/github/app-setup.ts"}
  - {kind: "file", path: "kernel/test/integrations-github-app-setup.test.ts"}
  - {kind: "file", path: "docs/architecture/github-app-setup.md"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-setup.ts", name: "createGitHubAppSetup"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-setup.ts", name: "GITHUB_APP_SETUP_WINDOW_MS"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-routes.ts", name: "createGitHubAppSetup"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/features/contribution.ts", name: "UNAUTHENTICATED_ROUTE_PATHS"}
  - {from: "1", kind: "file", path: "kernel/test/api-unauthenticated-routes.test.ts"}
  - {from: "1", kind: "symbol", path: "kernel/src/features/contribution.ts", name: "unauthenticated?: true"}
  - {from: "1", kind: "symbol", path: "kernel/src/features/contribution.ts", name: "origin?: string"}
lanes:
  - "kernel/src/integrations/github/app-setup.ts"
  - "kernel/src/integrations/github/app-routes.ts"
  - "kernel/test/integrations-github-app-setup.test.ts"
  - "kernel/test/integrations-github-app-contract.test.ts"
  - "kernel/test/api-unauthenticated-routes.test.ts"
  - "docs/architecture/github-app-setup.md"
  - "docs/ARCHITECTURE.md"
external_requires:
  - "GitHub's App Manifest flow: POST https://api.github.com/app-manifests/{code}/conversions (faked in tests; real behaviour proven by probe p13)"
  - "GitHub App 2's real GitHubAppPort (app-port.ts) — this item builds against a fake port"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `kernel/test/api-unauthenticated-routes.test.ts` (#1 creates it with fixture routes; #2 adds the shipped route-table pin) | YES (already ordered by `requires`) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/error-handling/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 2 | `skills/error-handling/SKILL.md`, `skills/unit-testing/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The three unauthenticated routes are an attack surface for local processes (requirement risk) | HIGH | Bounded by GET only, the exact path allowlist checked at merge **and** in the server, the open window, single-use `state`s (≥128 bits, constant-time compare), the 10-minute life and fixed responses with `no-store` / `no-referrer`; the WebSocket upgrade keeps no exception. Red-team them in Phase 4.5 review |
| Scope vs Supervisor capability: ~1,250 changed lines across ~10 files (source: Feasibility (Phase 2.5)) | HIGH | Split `context-bound` into two sequential subtasks; #1 lands the mechanism with its own fixture-route tests before #2 builds on it |
| The conversion call is made in `app-setup.ts`, not through `client.ts`'s allowlist (`client.ts` is GitHub App 2's Touch) (source: Feasibility (Phase 2.5)) | MEDIUM | Fixed host and path shape, `code` validated before the call, POST only, injected `fetch`; `docs/architecture/github-app-setup.md` records it as the conversion's one call site so a follow-up can route it through GitHub App 2's client once both merge |
| Real behaviour depends on GitHub App 2's port (requirement risk) | MEDIUM | Complete against a fake `GitHubAppPort`; default wiring imports `githubAppPort` from `app-port.ts`, which GitHub App 2 fills in place; with the stub, `not_implemented` shows as `install_failed`. The real flow is proven at the plan doc's live check after wave 2 merges |
| `kernel/test/integrations-github-app-contract.test.ts` is edited by both wave-2 kernel lanes (this item: the owner-routes block; GitHub App 2: the stub-port block, which its real port breaks) | MEDIUM | Edit only `describe("the stub owner routes (AC2, AC7)"`; leave the other blocks byte-identical so the two lanes' hunks merge cleanly |
| `docs/architecture/integrations.md` keeps wave 1's "browser routes are not served" wording until reconciled (it is GitHub App 2's Touch). Likewise, `kernel/test/integrations-github-app-contract.test.ts`'s header (lines 1–7: "both routes answer `501 …`", "Wave 2's items replace the stubs … in their own tests, not here") is kept byte-identical for a clean merge, so it goes stale | LOW | The new `docs/architecture/github-app-setup.md` is the setup flow's doc and is linked from `docs/ARCHITECTURE.md`. This lane retitles only the describe block it owns (`the stub owner routes (AC2, AC7)` → `the owner and browser routes`). After wave 2 merges, one cleanup reconciles both `integrations.md` and the contract test's header |
| Every refused browser request appends one `connector_status` event, so a local process can grow the events table **and post cards to the owner's thread** (`connector_status` routes to the owner thread, `kernel/src/console/threads.ts`, and makes the Integrations screen refetch `GET /connectors`) | LOW | The event is fixed-size and carries no request data. A null `connector_id` is already handled by `threads.ts`. The requirement asks for one event per refusal; rate-limiting refusal events per window is a possible follow-up, not in this scope |
| Prior churn on touched paths (source: Prior churn (postmortem ledger)): `docs/ARCHITECTURE.md` (53), `kernel/src/api/server.ts` (13), `kernel/src/features/contribution.ts` (9), `kernel/src/integrations/github/app-routes.ts` (1); recurring classes `self_heal_churn` (46), `drain_churn` (24), `convention_mismatch` (2) | MEDIUM | Re-check the Touched-file invariants before hand-back; match the files' comment density and idioms (`convention_mismatch`); keep `docs/ARCHITECTURE.md` edits to one link and one wording change |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-kernel-github-app-manifest-setup-flow.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T03:35:09Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/172
- **Branch:** feature/kernel-github-app-manifest-setup-flow
- **Files changed:** 12
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Unauthenticated GET-only browser-route mechanism (feature seam + API server) and the GitHub App manifest setup flow (app-setup.ts window, five routes, docs). Phase 4.5 fixed a HIGH concurrent-return double storeApp and five MEDIUMs over 2 iterations; iteration 3 PASS. Drain not dispatched (.supervisor/config.json auto_review=false — the /automate run owns its drain). Driver bug worked around: sn_brief_subtasks read the File Impact Map header "Group" as a subtask.

## Not verified
- **The real daemon (startKernel) serving the three browser paths** — subtask 1 tests used fixture routes on a real startApiServer (subtask 1)
- **The real flow against github.com** — fake GitHub (injected fetch) and fake GitHubAppPort; live check after wave 2 merges (subtask 2)
- **The start page in a real browser auto-submitting to github.com/settings/apps/new** — no browser run; markup mirrors probe p13 (subtask 2)
