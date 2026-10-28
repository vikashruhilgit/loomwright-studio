# Supervisor Job: The GitHub connector — a read-only token in the Keychain, validated (fail-closed until the permissions probe), with its reachable repos

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-27-114124/L1 (Loomwright Studio, lane L1)
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-24-095103-the-github-connector-token-validation-and-reachable-repos.md
- **Base commit:** 7f0949d6cf3c603b4217638a011f2073c9c25eb3

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel on Node; Node's built-in `fetch` covers the REST client, so no new dependency is needed |
| 2 | Dependency Availability | GO | `/usr/bin/security` (already wrapped by `kernel/src/auth/keychain.ts`), `api.github.com` REST, `FakeGitHubClient` (`kernel/test/fixtures/github-fake.ts`) and the notifier stub (`kernel/test/notifier-stub.ts`) all exist |
| 3 | Architecture Fit | GO | Item 01 left empty `githubConnectorPart` / `githubRoutesPart` parts, the `GitHubClient` interface, the `connectors` table (migration 17) and the route contract (`app/src/api/contract.ts`) for this item to fill |
| 4 | Scope vs Supervisor Capability | CAUTION | About 15 files and well over 800 changed lines with tests, so it is split `context-bound` into 2 sequential subtasks |
| 5 | Hard Blockers | NO-GO (owner chose "Revise goal") | Scope step 1 needs the owner's real fine-grained token to probe how GitHub exposes its permissions. A worker cannot and must not hold that token. Public docs show no endpoint listing a fine-grained token's own permissions, only `X-Accepted-GitHub-Permissions` (what an endpoint needs) and `github-authentication-token-expiration`. |

**Overall Verdict:** NO-GO resolved by owner revision (LP-NO-GO → "Revise goal", 2026-10-27). **Revised scope (owner's choice):** build everything that does not depend on the probe. The real client reports `permissions: null`, and the connector **refuses a token whose permissions it cannot read** (fail-closed, new refusal `token_permissions_unknown`). The worker writes an owner-run probe script and records the probe as still pending in `docs/OPEN_QUESTIONS.md`. The owner decides the fallback after running the probe; this item must not invent a write probe or any other workaround.

## Task
**Goal:** Make item 01's GitHub seams real. The kernel keeps a GitHub token in the Keychain item `loomwright-studio-github`. Before writing it, the kernel validates the token: user, expiry and reachable repos are read, and the token is refused unless its permissions are known and all read-only. Replace and disconnect work. Expiry is watched. Four owner routes and a `studio connectors` CLI exist. The token never appears in a response, log line, event or error.

**Problem Statement:**
The owner needs to give Studio a fine-grained, read-only GitHub token once and see its account, permissions, expiry and reachable repos, so that later phase 6 items can read their personal repos' PRs without Studio holding their `gh` login or any write access.
Currently nothing stores a GitHub credential, there is no GitHub client, `KeychainWriter` never overwrites and there is no Keychain delete, and the four `/connectors` routes answer 404 (`docs/architecture/integrations.md`: "both parts are empty, the four routes answer 404"). This blocks items 04, 05, 06 and 11.
Success looks like this: with a fake GitHub client, a valid read-only token can be set, replaced and disconnected through the route and the CLI, and refused tokens leave a good one in place. Expiry notifies at 14 days and 1 day. Rate limits come back typed. Every path is tested for the absence of the token string. Until the owner's probe decides how permissions are read, a real token is refused `token_permissions_unknown`.

## Acceptance Criteria
- [ ] **AC1 (set, valid):** Given a fake `GitHubClient` whose `getTokenInfo` reports a login, an expiry and permissions that are all `read`, and whose `listReachableRepos` reports repos, when the token is set through `POST /connectors/github/token` and, separately, through `studio connectors github set` (token on stdin), then the Keychain item `loomwright-studio-github` is written (fake keychain) and the `connectors` row reads `connected` with `account_login`, `permissions_json`, `reachable_repos_json`, `expires_at` and `verified_at` set. The route answers `ConnectorChangeResponse` (`{connector}` in the `Connector` contract shape), and the token string does not occur in any route response body, any `events.payload_json` row, the `connectors` row, or the CLI's captured stdout/stderr.
- [ ] **AC2 (write-scoped):** Given a token whose reported permissions include any non-read level, when it is set, then it is refused `token_write_scoped`, and the refusal names every write permission and the setting to change (e.g. `pull_requests: write → set to read`). Nothing is written to the Keychain. When a good token was already connected, its Keychain item and its `connected` row stay unchanged.
- [ ] **AC3 (invalid):** Given a token GitHub rejects (fake client answers `http_error` 401 on `getTokenInfo`), when it is set, then it is refused `token_invalid` and an existing good token and its row stay in place.
- [ ] **AC4 (permissions unknown, fail-closed — owner's revision):** Given a token whose `getTokenInfo` reports `permissions: null` (what the real client reports until the probe decides otherwise), when it is set, then it is refused `token_permissions_unknown`, nothing is written, and an existing good token stays in place. The real client (`kernel/src/integrations/github/client.ts`) returns `permissions: null` and never infers permissions from a write attempt.
- [ ] **AC5 (CLI argv refusal):** Given `studio connectors github set <anything>` with the token as an argument, when it runs, then it exits non-zero without contacting the kernel and without echoing the argument. The token is read only from stdin, with echo off when stdin is a TTY. `studio connectors`, `studio connectors github status` and `studio connectors github disconnect` call `GET /connectors` and `POST /connectors/github/disconnect`.
- [ ] **AC6 (replace):** Given a connected token, when a second valid token is set, then it is validated first and swapped in only when valid: the old item is deleted and the new one added (never `-U`), the swap is read back, and the row is updated. When the second token is refused, the first stays in use.
- [ ] **AC7 (disconnect):** Given a connected token, when the owner disconnects (route or CLI), then the Keychain item is gone (the new `keychain.ts` delete; "item not found", exit status 44, counts as already gone), the status is `disconnected`, and the row is kept (not deleted).
- [ ] **AC8 (expiry):** Given a connected token with `expires_at` 14 days ahead, when the connector's due work runs, then exactly one notification is recorded through `recordNotification` and the status is `expiring`. Running the due work again the same day or the next records no second one. At 1 day left a second notification is recorded once, and after `expires_at` the status is `expired`. Tests use an injected clock and the notifier stub (`stubNotifierContributions()` or no kernel boot at all): no test posts a real notification.
- [ ] **AC9a (the real client, all seven methods):** Given `createGitHubClient` in `kernel/src/integrations/github/client.ts`, then it implements every `GitHubClient` method in `kernel/src/integrations/types.ts` with read-only GETs only. Items 04 and 06 only call it.
  - `getTokenInfo`: `GET /user` for the login. The expiry comes from the `github-authentication-token-expiration` header. `permissions` is always `null`.
  - `listReachableRepos`: `GET /user/repos`, paginated with a page cap.
  - `listOpenPulls`: applies `PollSpec.filters` as given.
  - `getPull`.
  - `getPullDiff`: cut at `maxBytes`, with `truncated` saying whether it was.
  - `listPullFiles` and `listPullComments`: issue comments and review comments, as `kind`.
  - Each method is tested with an injected `fetch` against the shapes `FakeGitHubClient` models.
- [ ] **AC9 (rate limit):** Given a GitHub answer of 403 with `x-ratelimit-remaining: 0` (and, separately, a 429), when any client method runs, then it returns `{ok: false, error: "rate_limited", resets_at}` with `resets_at` taken from `x-ratelimit-reset`, never throwing. Every response surfaces `x-ratelimit-*` as `rateLimit`. Each call has a timeout, response bodies are bounded, requests go only to `https://api.github.com`, and the token is read from the Keychain fresh on each call. Tests use an injected `fetch`: no test reaches the network.
- [ ] **AC10 (events):** Given any connector change (set, refused, replace, disconnect, expiring, expired), when it happens, then exactly one `connector_status` event is appended with `{connector_id, kind, status}` and no secret, matching the payload `kernel/src/console/threads.ts` already renders ("Connector github: connected").
- [ ] **AC11 (routes):** Given the shipped integrations contribution, when the API serves it, then `GET /connectors` answers `{connectors}` (every row in the `Connector` shape, `[]` when none), and `GET /connectors/github/repos` answers `{repos, verified_at}`, where `?refresh=1` re-reads the repos from GitHub first. A handler never throws for a bad token or a GitHub failure; it answers a typed refusal. So the API's `route_failed` event (which records the clipped error message) can never carry the token.
- [ ] **AC12 (probe + docs):** Given this item cannot run the owner's probe, then `probes/p12-github-token-permissions.mjs` exists. It is an owner-run script that reads the token from stdin or from the Keychain item, calls `GET /user` and `GET /user/repos`, and prints only response headers (`github-authentication-token-expiration`, `x-oauth-scopes`, `x-accepted-github-permissions`, `x-ratelimit-*`), the login and the repo names, never the token. `docs/OPEN_QUESTIONS.md` has an entry dated 2026-10-27, marked NEEDS VERIFICATION and owner-run, recording what the public docs show, that the connector refuses `token_permissions_unknown` until the probe result and the owner's fallback decision land, and how to run the probe. `docs/architecture/integrations.md` documents the connector's lifecycle, the Keychain item, what the `connectors` table holds and never holds, the three refusals, expiry and the CLI.
- [ ] **AC13 (pins):** Given parts are no longer empty and new files exist under `src/integrations`, then three groups of pins in `kernel/test/integrations-foundation.test.ts` are updated:
  - The pins that assert every part is empty now assert the filled `github-connector` / `github-routes` parts. The `github-tools` and `drafts` parts stay pinned empty.
  - The `src/integrations` file-list pin gains `"github/client.ts"` (Subtask 1) and `"cli.ts"` (Subtask 2).
  - The import-specifier guard in the same test stays green. `cd kernel && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` pass.

## Touched-file invariants

> Grounded at base `7f0949d6cf3c603b4217638a011f2073c9c25eb3`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/auth/keychain.ts`**. Keep: it stays the only Keychain toucher, `The ONLY module under src/auth/ that touches the macOS Keychain or`. Keep the absolute binary `export const SECURITY_BIN = "/usr/bin/security";`, run with an argument array and never a shell. Keep the no-overwrite rule `No \`-U\`: an existing item is never overwritten.` (replace = delete then add). Keep the error-scrubbing rule `// Deliberately drop \`err\`: it carries stdout/stderr buffers.`, so a delete failure throws `KeychainError` from service and status only. Reuse `SECURITY_ITEM_NOT_FOUND_STATUS = 44` for "already gone", the injectable `ExecFileSyncLike`, and `numberOrNull` / `stringOrNull`. Keep `WRITE_ARG` (`const WRITE_ARG = /^[A-Za-z0-9_.@][A-Za-z0-9_.@-]*$/;`) refusing before anything runs, which names the field, never the value; a GitHub token (`github_pat_…`) matches it. Mirror: `KeychainError.operation` (`readonly operation: "read" | "write";`) gains `"delete"`. Pinned by: `kernel/test/auth.test.ts` (keychain reader tests over a fake exec) and `kernel/test/api-token.test.ts` (the writer and the `operation` union: `expect(ke.operation).toBe("write");`), both of which must stay green.
- **`kernel/src/auth/index.ts`**. Keep: `The subscription-token provider is NOT` re-exported (D29); only the deleter and its type are added beside `export { KeychainError, SECURITY_BIN, securityCliKeychain, securityCliKeychainWriter } from "./keychain.js";`.
- **`kernel/src/integrations/index.ts`** (only if exports are added). Keep: the module-graph rule `never the Agent SDK, the session manager or \`kernel.ts\``; `INTEGRATIONS_PARTS` order (`[githubConnectorPart, githubRoutesPart, githubToolsPart, draftsPart]`); the shared merge `consoleContributionOf(parts)`, which throws `ContributionConflictError` on a handler-kind clash, so no two parts claim one handler kind. Update the stale comments `Every part is empty until its item fills it in, so today the contribution` and `every part is empty, so it does not throw` to say the github parts are filled.
- **`kernel/src/integrations/github/connector.ts`, `kernel/src/integrations/github/routes.ts`**. Keep the CLI-safe module graph: `never the Agent SDK, the session manager or \`kernel.ts\`` (pinned by `kernel/test/feature-seams.test.ts` "features/index.js loads in a fresh Node process without the Agent SDK"). Importing `keychain.ts` (node:child_process) is allowed; importing the SDK is not. Keep each part frozen (`Object.freeze`), keep the part names `github-connector` / `github-routes`, and keep `INTEGRATIONS_PARTS` order unchanged. Reuse the `deps.keychain ?? securityCliKeychain()` default-dependency idiom (`kernel/src/auth/api-key.ts`), so tests inject fakes and only the shipped part reaches the real Keychain, and only when a route or due work actually runs. Mirror: the `Connector` / `ConnectorsResponse` / `ConnectorChangeResponse` / `ConnectorReposResponse` shapes in `app/src/api/contract.ts` (`readonly reachable_repos: readonly string[] | null;`), and the `connector_status` payload `kernel/test/console-threads.test.ts` uses (`{ connector_id: 1, kind: "github", status: "connected" }`). Notifications go only through `recordNotification(store, {source, title, body}, now)` (`kernel/src/notifications/record.ts`), source `kernel:<reason>`.
- **`kernel/test/integrations-foundation.test.ts`** (shared by both subtasks, sequentially: 1 then 2). There are three pins to change.
  - The two empty-part pins: `part %s is empty: no tools, routes, subcommands, handlers or due work` and `contributes nothing but its name: no tools, routes, subcommands, handlers or due work`, changed by Subtask 2.
  - The `src/integrations` file-list pin `["drafts.ts", "github/connector.ts", "github/routes.ts", "github/tools.ts", "index.ts", "tool-filter.ts", "types.ts"]`. Subtask 1 adds `"github/client.ts"` and Subtask 2 adds `"cli.ts"`.
  - Keep: the import-specifier guard in the same test (`not.toMatch(/claude-agent-sdk|sessions\/manager|(^|\/)kernel\.js$/)`). `client.ts` and `cli.ts` may import `../../auth/keychain.js` / `../auth/keychain.js` but never the SDK, `sessions/manager` or `kernel.js`. Also keep: `merges its four parts in a fixed order: github-connector, github-routes (item 03), github-tools (item 06), drafts (item 07)` stays green unchanged, and the empty-part pin still holds for `github-tools` and `drafts`.
- **`kernel/test/console-contract.test.ts`** (only if it turns red). Keep: `lists phase 6's six routes as not yet served: items 03 and 07 add them` classifies by origin (`p6-item-03`). If the worker relabels the four connector routes as served, it updates the `// 29 existing routes` count and this test's list in the same change, and the two `p6-item-07` drafts routes stay "not yet served".

## Closed enumerations touched

> Sibling grep at base `7f0949d6cf3c603b4217638a011f2073c9c25eb3`: `grep -rnF '"read" | "write"' --exclude=CHANGELOG.md kernel app docs` → 2 hits in 1 file. `grep -rnF 'token_invalid' --exclude=CHANGELOG.md --exclude-dir=node_modules .` (outside `.supervisor/`) → 2 hits in 2 files.

- **`"delete"`** (sibling: `"write"`), which must be named in:
  - `kernel/src/auth/keychain.ts`: `readonly operation: "read" | "write";` and the constructor's `operation: "read" | "write" = "read"`. Extend both.
- **`token_permissions_unknown`** (sibling: `token_invalid`), which must be named in:
  - `docs/architecture/integrations.md`: the refusals list this item writes. Extend (in lanes).
  - `docs/DESIGN.md`: the sheet's refusal copy (`` - `token_invalid` says what to check.``). No change: DESIGN.md is the owner-approved mockup's record (D9). This item adds no copy there; the `docs/OPEN_QUESTIONS.md` entry notes that item 11's screen needs copy for the new refusal once the owner decides the fallback.
  - `docs/evidence/phase-6-integrations-mockup/README.md`: the mockup's state table. No change: approved evidence, not a closed list the kernel reads.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-github-connector.test.ts` — AC4 `token_permissions_unknown` refusal | delete the `permissions === null` refusal branch in `kernel/src/integrations/github/connector.ts`, so a null-permission token is written |
| `kernel/test/integrations-github-connector.test.ts` — AC2 write-scoped refusal leaves the old token | delete the validation-before-write check in `kernel/src/integrations/github/connector.ts`, so the Keychain is written before permissions are checked |
| `kernel/test/integrations-github-connector.test.ts` — AC8 notify once per threshold | delete the already-notified check in the expiry due work in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-client.test.ts` — AC9 403 `x-ratelimit-remaining: 0` ⇒ `rate_limited` | delete the rate-limit branch in `kernel/src/integrations/github/client.ts` |
| `kernel/test/auth-keychain-delete.test.ts` — exit 44 is "already gone" | delete the `SECURITY_ITEM_NOT_FOUND_STATUS` check in the delete path of `kernel/src/auth/keychain.ts` |
| `kernel/test/integrations-foundation.test.ts` — the `src/integrations` file list | delete the file `kernel/src/integrations/github/client.ts` (or `kernel/src/integrations/cli.ts`); the exact-list pin must turn red |
| `kernel/test/integrations-github-client.test.ts` — AC9a `getPullDiff` truncation | delete the `maxBytes` cut in `kernel/src/integrations/github/client.ts`, so a long diff comes back whole with `truncated: false` |
| `kernel/test/integrations-foundation.test.ts` — filled parts | flip `githubConnectorPart` back to `routes: Object.freeze([])` in `kernel/src/integrations/github/connector.ts` / `kernel/src/integrations/github/routes.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Keychain delete, the real `GitHubClient` (all seven methods), and the owner-run permissions probe | AC4 (client half), AC9a, AC9, AC12 (probe script), AC13 (file-list pin: `github/client.ts`) | 3 modify, 4 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Connector (set/replace/disconnect/expiry), routes, `studio connectors` CLI, docs and pins | AC1-AC8, AC10, AC11, AC12 (docs), AC13 | 5-6 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | BLOCKED (by #1) |

### File Impact Map (with module layout)

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 keychain | `kernel/src/auth/keychain.ts` (149): adds `KeychainDeleter` + `securityCliKeychainDeleter` (its single home: the one Keychain module); `kernel/src/auth/index.ts` (23): re-export | `kernel/test/auth-keychain-delete.test.ts` (keeps the 1195-line `kernel/test/auth.test.ts` untouched) | HIGH |
| 1 client | — | `kernel/src/integrations/github/client.ts` (real `GitHubClient` on `fetch`: `createGitHubClient(deps)`), `kernel/test/integrations-github-client.test.ts` | HIGH |
| 1 probe | — | `probes/p12-github-token-permissions.mjs` (owner-run, never run by CI or the worker) | HIGH |
| 2 connector | `kernel/src/integrations/github/connector.ts` (17): set/replace/disconnect/expiry logic and the part | — | HIGH |
| 2 routes | `kernel/src/integrations/github/routes.ts` (18): the four routes over the connector's functions | — | HIGH |
| 2 cli | — | `kernel/src/integrations/cli.ts` (the `connectors` subcommand, listed in `githubConnectorPart.subcommands`; no new part) | HIGH |
| 1 tests | `kernel/test/integrations-foundation.test.ts` (798): only the `src/integrations` file-list pin gains `"github/client.ts"` | — | HIGH |
| 2 tests | `kernel/test/integrations-foundation.test.ts` (798): only the two empty-part pins and the file-list pin (`"cli.ts"`) change; `kernel/test/console-contract.test.ts` (241): only if it turns red | `kernel/test/integrations-github-connector.test.ts` (connector, routes, CLI, expiry, token-absence) | HIGH / LOW |
| 2 docs | `docs/architecture/integrations.md` (18), `docs/OPEN_QUESTIONS.md` (127) | — | HIGH |

> Validator-owned surfaces: `bash scripts/check-docs.sh` scans relative links in `docs/`, `CLAUDE.md` and `README.md`, so every link added to `docs/architecture/integrations.md` / `docs/OPEN_QUESTIONS.md` must resolve (e.g. `../../probes/p12-github-token-permissions.mjs` from `docs/architecture/`).

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/integrations/github/client.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "createGitHubClient"}
  - {kind: "symbol", path: "kernel/src/auth/keychain.ts", name: "securityCliKeychainDeleter"}
  - {kind: "type", path: "kernel/src/auth/keychain.ts", name: "KeychainDeleter"}
  - {kind: "file", path: "kernel/test/integrations-github-client.test.ts"}
  - {kind: "file", path: "kernel/test/auth-keychain-delete.test.ts"}
  - {kind: "file", path: "probes/p12-github-token-permissions.mjs"}
requires: []
lanes:
  - "kernel/src/auth/keychain.ts"
  - "kernel/src/auth/index.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/src/integrations/github/client.ts"
  - "kernel/test/integrations-github-client.test.ts"
  - "kernel/test/auth-keychain-delete.test.ts"
  - "probes/p12-github-token-permissions.mjs"
external_requires:
  - "GitHub REST API at https://api.github.com (GET /user, GET /user/repos); never called by tests"
  - "/usr/bin/security delete-generic-password (macOS); never called by tests"

# Subtask 2
provides:
  - {kind: "symbol", path: "kernel/src/integrations/github/connector.ts", name: "githubConnectorPart"}
  - {kind: "symbol", path: "kernel/src/integrations/github/routes.ts", name: "githubRoutesPart"}
  - {kind: "file", path: "kernel/src/integrations/cli.ts"}
  - {kind: "file", path: "kernel/test/integrations-github-connector.test.ts"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "token_permissions_unknown"}
  - {kind: "symbol", path: "docs/architecture/integrations.md", name: "token_permissions_unknown"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/client.ts", name: "createGitHubClient"}
  - {from: "1", kind: "symbol", path: "kernel/src/auth/keychain.ts", name: "securityCliKeychainDeleter"}
  - {from: "1", kind: "type", path: "kernel/src/auth/keychain.ts", name: "KeychainDeleter"}
  - {from: "1", kind: "file", path: "probes/p12-github-token-permissions.mjs"}
lanes:
  - "kernel/src/integrations/github/connector.ts"
  - "kernel/src/integrations/github/routes.ts"
  - "kernel/src/integrations/cli.ts"
  - "kernel/src/integrations/index.ts"
  - "kernel/test/integrations-github-connector.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/console-contract.test.ts"
  - "docs/architecture/integrations.md"
  - "docs/OPEN_QUESTIONS.md"
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
| Subtask 1 | Subtask 2 | `kernel/test/integrations-foundation.test.ts` (legal: Subtask 2 is reachable from Subtask 1) | YES (Subtask 2 requires Subtask 1's client and Keychain delete) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after Subtask 1)
- **Recommended workers:** 1
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `docs/OPEN_QUESTIONS.md:112` | yes | STALE | `- [x] **Phase 5 exit: live run (item 18, owner).**` (the requirement says it is unticked; it is now ticked) | tip 2 hours ago, fetched >1h |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5), NO-GO overridden by owner revision: the read-only check has no confirmed GitHub mechanism, so a real token cannot connect until the owner runs the probe and decides | HIGH | Fail-closed `token_permissions_unknown` (AC4). The real client never guesses permissions and never makes a write probe. The probe script and the OPEN_QUESTIONS entry (AC12) hand the decision to the owner. |
| Feasibility (Phase 2.5): `context-bound` scope (~15 files, >800 lines with tests) | MEDIUM | Split into 2 sequential subtasks along the client/keychain vs connector/routes/CLI seam |
| Token leak through an error: Node's `fetch`/`Headers` can put an invalid header value (the token) in a `TypeError` message, and the API's `route_failed` and the loop's `due_work_failed` events record the clipped error message | HIGH | Validate the token's shape (`WRITE_ARG`-compatible, no whitespace/control) before it reaches a header. Catch every client throw inside the client and map it to `unreachable`. Route handlers and due work never rethrow. Tests assert the token string is absent from `events.payload_json` after a forced failure. |
| Token leak through a response, a log, the CLI's output or the `connectors` row | HIGH | AC1 asserts absence on every path. No `console.*` in the connector, client or routes. The CLI never echoes argv or stdin. |
| A test reaching the real Keychain or GitHub: the shipped part defaults to `/usr/bin/security` and real `fetch` | HIGH | Default dependencies resolve lazily, only when a route or due work runs. Every test injects a fake keychain/exec and `FakeGitHubClient` or a fake `fetch`. A test that boots `startKernel` uses `stubNotifierContributions()` and never calls the connector routes with real deps. |
| Replace = delete then add: a failed add after the delete loses the old token | MEDIUM | Validate the new token first. Read the new item back after `add` (as `ensureApiToken` does, since `security -i` can exit 0 on failure). On failure, set the row to `disconnected` with a `connector_status` event, never `connected`. Test it. |
| A refused token while a good one is connected: the `rejected` status ("the last token offered was refused") vs AC2's "existing good token stays in place" | MEDIUM | With a good token connected, a refusal leaves the row `connected` (the token in use is unchanged) and returns the refusal. Use `rejected` only when no good token is in place. Document this in `integrations.md`. |
| The `github-authentication-token-expiration` header's exact format is unverified (docs show `YYYY-MM-DD HH:MM:SS UTC`) | MEDIUM | Parse defensively. An unparseable value is `expires_at: null` (unknown expiry, no expiry warning), never a throw. The probe prints the raw header so the owner can confirm it. |
| Whether `GET /user/repos` lists exactly a fine-grained token's selected repos is unverified | MEDIUM | Bounded pagination (`per_page=100`, a page cap). Record it as part of the probe in OPEN_QUESTIONS. |
| Cited-line premise (Phase 3): `docs/OPEN_QUESTIONS.md:112` is STALE, since the phase 5 live exit now reads ticked, so the requirement's "run phase 6 only after that live run passes" precondition appears met | MEDIUM | None needed for the build. Don't re-open the sequencing. |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-27-github-connector-token-validation.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-27T16:26:33Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/147
- **Branch:** feature/github-connector-token-validation
- **Files changed:** 16
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Keychain delete, the read-only createGitHubClient (7 GET methods, permissions null, typed rate_limited), the owner-run p12 probe, and the filled github-connector / github-routes parts (validate-then-write set with token_invalid / token_write_scoped / token_permissions_unknown refusals, replace, disconnect, 14d/1d expiry notices), the studio connectors CLI, docs and pins. Phase 4.5: 3 reviews, 2 fix iterations (HIGH missing connector_status event on first-set read-back failure; MEDIUM untested default stdin reader), PASS with 6 dismissed LOW/nit findings. Pre-flight OVERLAP with PR #146 on kernel/test/integrations-foundation.test.ts — owner chose proceed-anyway. Driver bug worked around: supervisor-next-step.sh parsed the File Impact Map "Group" header as a third subtask; plan corrected to ["1","2"].

## Not verified
- **probes/p12-github-token-permissions.mjs against api.github.com** — owner-run by design; needs the owner's real token (subtask 1)
- **createGitHubClient against real api.github.com** — tests inject fetch; expiry and rate-limit header formats unverified until the probe runs (subtask 1)
- **securityCliKeychainDeleter deleting a real item** — only the exit-44 path was probed live, on a never-existing service (subtask 1)
- **cli.ts TTY echo-off prompt and piped real stdin** — tests injected the reader at worker time; covered by fake-stdin tests in heal iteration 2, never a real terminal (subtask 2)
- **The connector over the real Keychain and api.github.com** — no test may reach either; a real token is refused token_permissions_unknown until the probe (subtask 2)
