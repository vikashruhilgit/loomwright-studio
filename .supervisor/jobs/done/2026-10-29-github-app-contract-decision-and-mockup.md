# Supervisor Job: GitHub App 1 — the App connect's decision (D36), its contract in docs and code, and its approved mockup (wave 1)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-29-234434/L1
- **CLAUDE.md:** ✓ Found (fresh — its table paths exist; kernel/app layout matches)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/github-app/2026-10-29-174812-github-app-contract-decision-and-mockup.md
- **Base commit:** f1646ae95b426c0e2ea57634c979efe7058e13a1

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TypeScript kernel (vitest), Electron/React app, static HTML mockup — all already used for phase 6's token connect |
| 2 | Dependency Availability | GO | No new dependency. Screenshots use the Playwright CLI version `app/package-lock.json` pins (1.64.1), as `docs/evidence/phase-6-integrations-mockup/README.md` documents |
| 3 | Architecture Fit | GO | A new `IntegrationsPart` in `INTEGRATIONS_PARTS` is the established seam (`kernel/src/integrations/index.ts`); contract routes follow `app/src/api/contract.ts`'s one-line-entry rule |
| 4 | Scope vs Supervisor Capability | CAUTION | ~16 files plus ~40 screenshots, and a large mockup addition: splits into two file-disjoint groups (code contract / docs+mockup) — `genuine-parallelism` |
| 5 | Hard Blockers | CAUTION | Adding a part, two routes and two modules breaks four existing pins in two files the requirement's Touches omits: in `kernel/test/integrations-foundation.test.ts` the parts-order list, the contribution's six-route list and the exact `src/integrations` file list; in `kernel/test/integrations-github-connector.test.ts` the served-routes equality. Both files are added to the File Impact Map below. Not a blocker |

**Overall Verdict:** CAUTION

## Task
**Goal:** Record the GitHub App connect as D36, fix its contract in `docs/architecture/integrations.md` and in code (types, a never-throwing stub port, 501 stub owner routes, the app contract), and add every App-path state to the integrations mockup for the owner's approval — with no working behaviour behind the stubs.

**Problem Statement:**
The owner needs the GitHub App connect decided, its contract fixed and its screens approved before any of it is built, because three wave 2 items (kernel tokens, kernel setup flow, app Connect sheet) will build it in parallel against shared types, routes and a mockup that don't exist yet.
Currently, phase 6 has only the paste-a-token path, and phase 6 item 03 says "Studio never runs an OAuth flow". This leaves wave 2 with nothing shared to build against, so parallel items would collide.
Success looks like: wave 2 items branch from main and import the types, the port and the two owner routes' contract without editing any file this item adds or changes (except `app-port.ts` → tokens item, `app-routes.ts` → setup item), the stubs answer 501 / `not_implemented`, and the owner approves the mockup on this PR (D9).

**Owner decisions (binding, from the source requirement — every one must land in D36):** App connect beside the token path, both kept ("Install GitHub App" suggested, permissions checked by GitHub; "Paste a token", owner-declared); setup is the GitHub App Manifest flow (private app, no webhook, `Pull requests: Read`, `Contents: Read`, `Metadata: Read`; the owner's two clicks Create and Install stay the owner's; Studio receives and stores the key itself); it supersedes phase 6 item 03's "Studio never runs an OAuth flow" and its non-goal "GitHub Apps" (not a login, reuses no `gh` credential, but a browser round trip that returns a secret); read-only still (a write permission on an installation token → `token_write_scoped`); exactly two allowlisted non-GET calls, both to `api.github.com`: `POST /app/installations/{id}/access_tokens` and `POST /app-manifests/{code}/conversions`; GitHub accepts loopback `redirect_url`/`setup_url` and returns `state` on both returns (probe p13); no `hook_attributes` (GitHub refuses a loopback webhook URL); the single-use `state` and a single-use, short-lived, at-most-one-open setup window are the gate; the conversion's secrets are `pem` and `client_secret` — `pem` goes to the Keychain, `client_secret` is never stored, logged or returned; the reach list is `GET /installation/repositories`; app-only setup, no CLI setup verb (`studio connectors github status` still shows method and permissions' source); two waves.

**The contract (normative — both subtasks use exactly these names):**
- **Owner routes** (API token like every route): `POST /connectors/github/app/setup` → `{setup_url, expires_at}`; `POST /connectors/github/app/setup/cancel` → `{cancelled}`. The existing `GET /connectors` and `POST /connectors/github/disconnect` gain the App method (documented; behaviour is the tokens item's).
- **Browser routes** (GET only, no API token, gated by the open window and single-use `state`; docs only in this item): `/connectors/github/app/start`, `/connectors/github/app/return` (`code`, `state`), `/connectors/github/app/installed` (`installation_id`, `setup_action`, `state`).
- **Kernel types** in `kernel/src/integrations/types.ts`:
  - `CONNECTOR_METHODS = Object.freeze(["token", "app"] as const)` and `type ConnectorMethod`.
  - `ConnectorRow` gains **optional** `method?: ConnectorMethod`, `app_slug?: string | null`, `installation_id?: number | null` (optional because the `connectors` table gets these columns only in the kernel tokens item's migration 19; absent reads as `token`). For `method: app`, `permissions_source` is always `reported`, and `expires_at` is the current installation token's expiry, which renews (no extra field).
  - `GITHUB_APP_SETUP_REFUSALS = Object.freeze(["setup_not_open", "state_mismatch", "setup_expired", "conversion_failed", "install_failed", "token_write_scoped"] as const)` and `type GitHubAppSetupRefusal`.
  - `GitHubAppConversion` — the conversion's non-secret fields: `app_id: number`, `slug: string`, `name: string`, `owner_login: string`, `html_url: string`, `client_id: string` (never `client_secret`, never `webhook_secret`).
  - `GitHubAppPort` with three methods, each `Promise<GitHubAppPortResult<…>>`, never throwing: `storeApp(…, conversion: GitHubAppConversion, pem: string)` (store the converted app; `pem` → Keychain), `recordInstallation(…, installationId: number)` (record the installation, mint the first token, verify its permissions), `removeApp(…)`. Dependencies (store, clock) are parameters, in `GitHubConnector`'s idiom (`setToken(store: Store, token: string, now: () => Date, …)`), imported type-only. `GitHubAppPortResult<T> = { ok: true; … } | { ok: false; error: GitHubAppPortError; message: string }` where `GitHubAppPortError = GitHubAppSetupRefusal | "not_implemented"` (wave 2 may add values only by changing its own files, per Risk row 1).
- **App types** in `app/src/api/contract.ts`: `ConnectorMethod = "token" | "app"`; `Connector` gains optional `method?`, `app_slug?`, `installation_id?` (same optionality reason, so no existing app fixture changes); `GitHubAppSetupRefusal` (the six values); `GitHubAppSetupResponse { setup_url: string; expires_at: IsoTime }`; `GitHubAppSetupCancelResponse { cancelled: boolean }`; two `CONTRACT_ROUTES` entries with origin `"github-app"` (added to `RouteOrigin`) and two `ContractRouteMap` entries (`Route<NoQuery, undefined, …>`).
- **Stub answers:** both owner routes → `501 {"error":"not_implemented"}`; every port method → `{ ok: false, error: "not_implemented", message }`, never a throw.

## Acceptance Criteria

**Happy path:**
- [ ] AC1: Given this PR, when wave 2's items branch from main, then each can import `ConnectorMethod`, `CONNECTOR_METHODS`, `GitHubAppSetupRefusal`, `GITHUB_APP_SETUP_REFUSALS`, `GitHubAppConversion`, `GitHubAppPort` and `GitHubAppPortResult` from `kernel/src/integrations/types.ts` (and re-exported from `kernel/src/integrations/index.ts`), and the app can use the two owner routes' types from `app/src/api/contract.ts`; no wave 2 item needs to edit any file this item adds or changes except `app-port.ts` (tokens item) and `app-routes.ts` (setup item). In particular, the four pins in `kernel/test/integrations-foundation.test.ts` and `kernel/test/integrations-github-connector.test.ts` (parts order, the contribution's route list, the `src/integrations` file list, the served-routes equality) are rewritten so that routes the setup item later adds under `/connectors/github/app/` and the new `github/app-*.ts` modules (the tokens item's `app-token.ts`, the setup item's `app-setup.ts`) don't break them.
- [ ] AC2: Given the kernel built from this PR, when a caller with the API token calls `POST /connectors/github/app/setup` or `POST /connectors/github/app/setup/cancel` against `startApiServer` with the shipped contribution, then it answers `501 {"error":"not_implemented"}` (pinned in `kernel/test/integrations-github-app-contract.test.ts`), and `kernel/test/console-contract.test.ts` passes with both routes in both `EXPECTED_ROUTES` and `CONTRACT_ROUTES`, origin `github-app`, counted among the served existing routes (29 → 31).
- [ ] AC3: Given `docs/DECISIONS.md`, then a row `| D36 |` records every owner decision in the Task section above, names the clause it supersedes (phase 6 item 03's "Studio never runs an OAuth flow" and its non-goal "GitHub Apps"), and gives probe p13 (`docs/OPEN_QUESTIONS.md`, "GitHub App connect") as evidence; `docs/architecture/integrations.md`'s credential paragraph (the one saying "Studio runs no OAuth flow") points at D36, and its new "GitHub App connect" section states the normative contract above (owner routes, browser routes, row fields, the closed refusal list, the port's three methods).
- [ ] AC4: Given `docs/design/mockups/integrations.html`, then every state in requirement Scope 4 exists in light and dark, each reachable by `#view=<name>&theme=<light|dark>` like the existing views: `app-choice`, `app-setup-create`, `app-setup-install`, `app-connected`, `app-expired`, `app-cancelled`, `app-write-scoped`, `app-revoked`, `app-failed`, `app-unreachable`, `app-disconnect`; a committed evidence file `docs/evidence/github-app-mockup/README.md` lists each view with its light and dark screenshot (PNG files in the same folder) and the commands that regenerate them, `docs/DESIGN.md` §"Phase 6: Integrations" gains a GitHub App subsection listing the same views and linking that README, and the PR body links the README for the owner's D9 approval.

**Edge cases:**
- [ ] AC5: Given the stub `githubAppPort`, when any of its three methods is called with any arguments, then it resolves `{ ok: false, error: "not_implemented", … }` and never throws or rejects (pinned in `kernel/test/integrations-github-app-contract.test.ts`).
- [ ] AC6: Given the token path, then nothing in it changes: `kernel/src/integrations/github/{connector,routes,client,tools}.ts` are untouched, and every existing kernel and app test passes (`cd kernel && npm ci && npm run typecheck && npm test`; `cd app && npm ci && npm run typecheck && npm test`), with the only existing-test edits being the four pins named in AC1 and the `console-contract.test.ts` changes named in AC2.

**Error scenarios:**
- [ ] AC7: Given the two owner routes called without the API token (and with a wrong one), then they answer `401` like every other route (pinned in `kernel/test/integrations-github-app-contract.test.ts`).

**Validation (must pass before merge):** `cd kernel && npm ci && npm run typecheck && npm test` · `cd app && npm ci && npm run typecheck && npm test` · `bash scripts/check-docs.sh`.

## Touched-file invariants

> Grounded at base `f1646ae95b426c0e2ea57634c979efe7058e13a1`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/types.ts`** — keep: types and frozen lists only, no runtime import beyond type-only (`import type { ConsolePart } from "../console/types.js";`), because "the `studio` CLI loads the feature registry, which loads this feature, so nothing here may pull in the Agent SDK" (`kernel/test/feature-seams.test.ts` pins the module graph); reuse: the `Object.freeze([...] as const)` + `(typeof X)[number]` idiom of `CONNECTOR_PERMISSIONS_SOURCES`; keep `ConnectorRow`'s doc "It never holds a secret" true (no `pem`, no `client_secret` field).
- **`kernel/src/integrations/index.ts`** — keep: `export const INTEGRATIONS_PARTS: readonly IntegrationsPart[] = Object.freeze([` with the four existing parts in their order (append the App part last); keep the header comment's rule "it imports only types, the feature seam, the console's part merge and its own parts"; mirror: every new type/const is re-exported in the existing `export type { … } from "./types.js";` / `export { CONNECTOR_KINDS, … } from "./types.js";` blocks; pinned by: `kernel/test/integrations-foundation.test.ts` (`merges its four parts in a fixed order`).
- **`app/src/api/contract.ts`** — keep: "keep each entry on one line, in the `{ method: "…", path: "…", … }` form" (the kernel test reads it as text with `ENTRY_LINE`); mirror: `ContractRouteMap` is "keyed `"<METHOD> <path>"` exactly as in `CONTRACT_ROUTES`"; `ConnectorMethod` mirrors `CONNECTOR_METHODS` as `ConnectorPermissionsSource` mirrors `CONNECTOR_PERMISSIONS_SOURCES`; pinned by: `kernel/test/console-contract.test.ts` (`expect(routes).toEqual(EXPECTED_ROUTES)`) and `app/src/api/contract.test.ts` (`lists each route once`).
- **`kernel/test/console-contract.test.ts`** — keep: `const isExisting = (entry: ContractEntry): boolean => !/^(p6-)?item-\d{2}$/.test(entry.origin);` unchanged (origin `github-app` is existing because the kernel serves both stubs), and update the count comment with the number: `expect(existing).toHaveLength(29);` → 31; keep the `p6-` assertion `lists phase 6's six routes as not yet served` as is.
- **`kernel/test/integrations-foundation.test.ts`** and **`kernel/test/integrations-github-connector.test.ts`** — keep every token-path and drafts assertion. Change exactly four pins, each so it survives wave 2's additions:
  1. the parts-order list `["github-connector", "github-routes", "github-tools", "drafts"]` → append `"github-app-routes"`;
  2. the contribution's route list (`"integrations GET /drafts/:id",` closes it): assert the six token/drafts routes on the routes whose path does not start with `/connectors/github/app/`, and assert that every other route does start with that prefix and that `POST /connectors/github/app/setup` and `POST /connectors/github/app/setup/cancel` are among them (never an exact list of App routes);
  3. the `src/integrations` file list (`["cli.ts", "drafts.ts", "github/client.ts", "github/connector.ts", "github/routes.ts", "github/tools.ts", "index.ts", "tool-filter.ts", "types.ts"]`): assert the nine on the files not matching `github/app-*.ts`, and that `github/app-port.ts` and `github/app-routes.ts` exist. The no-SDK import scan (`not.toMatch(/claude-agent-sdk|sessions\/manager|(^|\/)kernel\.js$/)`) still runs over every file, App modules included;
  4. the served-routes equality `expect(served).toEqual([...item03, ...item07]);`: compare on served routes outside `/connectors/github/app/`, the same prefix rule as 2.
- **`docs/design/mockups/integrations.html`** — keep: the token block (`/* ---- Tokens: the verbatim stdout of` … `/* tokens:begin */`), unedited, and no new raw colour values, and the hash router `const p=new URLSearchParams(location.hash.slice(1));`; reuse: existing List, Card, Badge, StatusDot, Dialog, Input, Button components and the review strip; existing views (`not-connected` … `connected-declared`) render unchanged; branding (invariant 7): GitHub's name appears only as a label, in `ink`, no GitHub colours.
- **`docs/DECISIONS.md`** — keep: one table row per decision, `| D36 |` unique (`scripts/check-docs.sh` check 2 greps `'^| D[0-9]* |'`).

## Closed enumerations touched

> Sibling grep at base `f1646ae`: `grep -rnF 'p6-item-07' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=.supervisor .` → 8 hits in 3 files.

- **`github-app`** (sibling: `p6-item-07`, a `RouteOrigin` value) — must be named in:
  - `app/src/api/contract.ts` — the `export type RouteOrigin =` union (`| "p6-item-07";`) — extend; and the two new `CONTRACT_ROUTES` lines — extend.
  - `kernel/test/console-contract.test.ts` — `EXPECTED_ROUTES` — extend with the two entries; the `p6-` list assertion — no change: `github-app` is not a `p6-` origin.
  - `kernel/test/integrations-github-connector.test.ts` — `item07` matchAll regex — no change to it; the `served` equality beside it is adjusted per Touched-file invariants.
- **`token_write_scoped`** (reused as a member of the new `GITHUB_APP_SETUP_REFUSALS`): `grep -rlF 'token_write_scoped' --exclude-dir=node_modules --exclude-dir=.supervisor .` → 47 hits in 17 files (connector, routes, app integrations screen, docs, tests). No change to any: they are the token path's `GitHubTokenRefusal`/`ConnectorErrorCode`/`CONNECTOR_ERROR_STATUS` lists, and the setup refusals are a new, separate list; mapping setup refusals to HTTP statuses is the setup item's.
- **`github-app-routes`** (new part name; sibling `drafts` in the `INTEGRATIONS_PARTS` name list) — `kernel/test/integrations-foundation.test.ts` parts-order list — extend.
- `CONNECTOR_METHODS` (`token`, `app`) and `GITHUB_APP_SETUP_REFUSALS` are new lists; no existing closed list must name their values in this item.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/console-contract.test.ts` — `expect(routes).toEqual(EXPECTED_ROUTES)` with the setup route | delete `{ method: "POST", path: "/connectors/github/app/setup", origin: "github-app" },` in `app/src/api/contract.ts` |
| `kernel/test/console-contract.test.ts` — served existing routes, `toHaveLength(31)` | flip `githubToolsPart, draftsPart, githubAppRoutesPart]` → `githubToolsPart, draftsPart]` in `kernel/src/integrations/index.ts` |
| `kernel/test/integrations-foundation.test.ts` — parts order ends `"github-app-routes"` | flip `name: "github-app-routes"` → `name: "github-app"` in `kernel/src/integrations/github/app-routes.ts` |
| `kernel/test/integrations-foundation.test.ts` — the setup route is among the contribution's `/connectors/github/app/` routes | flip `path: "/connectors/github/app/setup",` → `path: "/connectors/github/app/start-setup",` in `kernel/src/integrations/github/app-routes.ts` |
| `kernel/test/integrations-foundation.test.ts` — `github/app-port.ts` and `github/app-routes.ts` exist; the no-SDK scan covers them | reviewer-applied in a scratch copy: add the line `import { query } from "@anthropic-ai/claude-agent-sdk";` to `kernel/src/integrations/github/app-port.ts` (the import scan must go red); and separately rename `app-routes.ts` away (the existence check must go red) |
| `kernel/test/integrations-github-connector.test.ts` — served token/drafts routes outside `/connectors/github/app/` equal item 03 + item 07 | flip `path: "/connectors/github/app/setup/cancel",` → `path: "/connectors/github/setup/cancel",` in `kernel/src/integrations/github/app-routes.ts` (an integrations route outside the prefix reaches `served`; the equality must go red, proving the filter is not too broad) |
| `kernel/test/integrations-github-app-contract.test.ts` — 501 `{"error":"not_implemented"}` on both owner routes | flip `status: 501` → `status: 200` in `kernel/src/integrations/github/app-routes.ts` |
| `kernel/test/integrations-github-app-contract.test.ts` — every port method resolves `not_implemented` | flip `error: "not_implemented"` → `error: "unimplemented"` in `kernel/src/integrations/github/app-port.ts` |
| `kernel/test/integrations-github-app-contract.test.ts` — the GITHUB_APP_SETUP_REFUSALS list equals the six values | delete `"install_failed",` in `kernel/src/integrations/types.ts` |
| `kernel/test/integrations-github-app-contract.test.ts` — 401 without the token | delete `send(res, 401, UNAUTHORIZED_BODY, { "WWW-Authenticate": "Bearer" });` in `kernel/src/api/server.ts` (the routes inherit the server's auth; scratch copy only — `server.ts` is in no lane) |

The stub files must therefore keep each mutated literal on one line and in one place: `app-routes.ts` builds its 501 answer once (`status: 501`), `app-port.ts` builds its failure through one helper (`error: "not_implemented"` once), and the types list puts each refusal on its own token so `"install_failed",` is unique.

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Contract in code: types, stub port, 501 stub routes, app contract, pins | AC1, AC2, AC5, AC6, AC7 | 6 modify, 3 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | D36, the integrations.md contract section, the mockup states, DESIGN.md + screenshots | AC3, AC4, AC6 (check-docs) | 4 modify, 1 create + PNGs | `skills/frontend-ui/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Contract in code (LAUNCHABLE)
provides:
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubAppPort"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubAppConversion"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubAppPortResult"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "GitHubAppSetupRefusal"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "ConnectorMethod"}
  - {kind: "symbol", path: "kernel/src/integrations/types.ts", name: "GITHUB_APP_SETUP_REFUSALS"}
  - {kind: "symbol", path: "kernel/src/integrations/types.ts", name: "CONNECTOR_METHODS"}
  - {kind: "file", path: "kernel/src/integrations/github/app-port.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-port.ts", name: "githubAppPort"}
  - {kind: "file", path: "kernel/src/integrations/github/app-routes.ts"}
  - {kind: "symbol", path: "kernel/src/integrations/github/app-routes.ts", name: "githubAppRoutesPart"}
  - {kind: "symbol", path: "kernel/src/integrations/index.ts", name: "githubAppRoutesPart"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "GitHubAppSetupResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "GitHubAppSetupCancelResponse"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "ConnectorMethod"}
  - {kind: "file", path: "kernel/test/integrations-github-app-contract.test.ts"}
requires: []
lanes:
  - "kernel/src/integrations/types.ts"
  - "kernel/src/integrations/index.ts"
  - "kernel/src/integrations/github/app-port.ts"
  - "kernel/src/integrations/github/app-routes.ts"
  - "kernel/test/console-contract.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/integrations-github-connector.test.ts"
  - "kernel/test/integrations-github-app-contract.test.ts"
  - "app/src/api/contract.ts"
external_requires: []

# Subtask 2 — Decision, docs contract and mockup (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "docs/DECISIONS.md", name: "D36"}
  - {kind: "symbol", path: "docs/architecture/integrations.md", name: "GitHub App connect"}
  - {kind: "symbol", path: "docs/DESIGN.md", name: "GitHub App"}
  - {kind: "symbol", path: "docs/design/mockups/integrations.html", name: "app-choice"}
  - {kind: "file", path: "docs/evidence/github-app-mockup/README.md"}
requires: []
lanes:
  - "docs/DECISIONS.md"
  - "docs/architecture/integrations.md"
  - "docs/DESIGN.md"
  - "docs/design/mockups/integrations.html"
  - "docs/evidence/github-app-mockup/**"
external_requires:
  - "Playwright CLI 1.64.1 with Chromium (installed outside the repo, as docs/evidence/phase-6-integrations-mockup/README.md does) for the screenshots"
```

### File Impact Map (verified at base; line counts at base)

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| 1 kernel types/parts | `kernel/src/integrations/types.ts` (231), `kernel/src/integrations/index.ts` (88) | `kernel/src/integrations/github/app-port.ts`, `kernel/src/integrations/github/app-routes.ts` | HIGH |
| 1 contract + pins | `app/src/api/contract.ts` (958), `kernel/test/console-contract.test.ts` (241), `kernel/test/integrations-foundation.test.ts` (857), `kernel/test/integrations-github-connector.test.ts` (917) — both past 500 lines, but only their existing pins are rewritten (no new responsibility); every new assertion goes in the new contract test | `kernel/test/integrations-github-app-contract.test.ts` | HIGH |
| 2 docs | `docs/DECISIONS.md` (41), `docs/architecture/integrations.md` (97), `docs/DESIGN.md` (92) | `docs/evidence/github-app-mockup/README.md` + 22 PNGs (11 views × 2 themes) | HIGH |
| 2 mockup | `docs/design/mockups/integrations.html` (773) | — | MEDIUM (size of the addition) |

Module homes: the port stub and the route stub each get their own new module (the requirement names them, and wave 2 fills each); no new responsibility is appended to `routes.ts` or `connector.ts`. `app/src/api/contract.ts` gains one new `// ---- GitHub App: POST /connectors/github/app/setup, …/setup/cancel ----` block after the phase 6 item 03 block, following its per-item block convention.

> **Validator-owned surfaces:** `scripts/check-docs.sh` scans every `docs/**/*.md` relative link (so every PNG the evidence README and DESIGN.md link must exist) and D-number uniqueness in `docs/DECISIONS.md`.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
```
Both build against the normative contract written in this brief's Task section, not against each other's files.

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Recommended workers:** 2
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The contract is wrong for wave 2 (source requirement risk) | HIGH | The Task section's contract is normative and both subtasks copy names from it verbatim; Phase 4.5 reviewer checks the docs section and the types agree name-for-name. A wave 2 item that finds it wrong says so in its PR and changes only what it owns |
| Docs (Subtask 2) and code (Subtask 1) drift apart because they run in parallel | MEDIUM | Same normative list; integrated review greps every identifier in `docs/architecture/integrations.md`'s new section against `types.ts`/`contract.ts` |
| Feasibility (Phase 2.5): four existing pins break when the App part and modules are added (`integrations-foundation.test.ts`: parts order, six-route list, exact file list; `integrations-github-connector.test.ts`: served routes). Neither file is in the requirement's Touches, and wave 2 creates `github/app-token.ts` and `github/app-setup.ts` and adds browser routes | MEDIUM | Both files are in Subtask 1's lanes; the pins are rewritten by part name, route prefix and `github/app-*.ts` pattern (Touched-file invariants) so wave 2 never edits them (AC1) |
| Required (non-optional) App fields on `ConnectorRow` / app `Connector` would make the type claim columns that only migration 19 adds, and break existing app fixtures outside every lane | MEDIUM | Fields are optional by contract (Task section); `connector.ts`'s explicit `COLUMNS` list stays untouched |
| Feasibility (Phase 2.5): mockup size — 11 new views × 2 themes | MEDIUM | Keep the existing mockup's structure, components and token block (no new raw colours); one forced view per state; screenshots by one CLI command each, as phase 6's evidence README does |
| Prior churn (postmortem ledger): `integrations-foundation.test.ts` (6), `integrations/index.ts` (5), `contract.ts` (4), `integrations.md` (4), `DESIGN.md` (3) — recurring `self_heal_churn` and `convention_mismatch` | MEDIUM | Follow each file's existing idioms exactly (Touched-file invariants); run the three validation commands before hand-back |
| Mockup copy is a proposal the owner may change | LOW | DESIGN.md's GitHub App subsection lists open points for the owner, as the phase 6 section does; approval is the PR merge (D9) |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 1
- **Base Branch:** main
- **Split reason:** genuine-parallelism

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-29-github-app-contract-decision-and-mockup.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-29T19:02:30Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/169
- **Branch:** feature/github-app-contract-decision-and-mockup
- **Files changed:** 38
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** D36 + the GitHub App connect contract in docs (integrations.md "GitHub App connect") and code (types, never-throwing stub port, 501 github-app-routes part, app contract routes, wave-2-proof pins), and 11 App-path mockup views light/dark with evidence README + 22 PNGs. Phase 4.5: 3 reviews, 2 docs fix rounds (ARCHITECTURE.md restated-list drift, then a misreferring sentence); final PASS with 4 dismissed LOW/nit findings. Advisory Twin/benchmark/ground-truth/contract-builder steps skipped under tool budget. Kernel suite: one pre-existing feature-seams 1 MiB test failed once under full-suite load, passes 3/3 in isolation.

## Not verified
- **docs/architecture/integrations.md contract names vs kernel types.ts/contract.ts** — copied from the brief in parallel, not diffed by the worker (subtask 2); the Phase 4.5 reviewer later resolved every identifier against the code.
- **Pin mutations via runner** — run-pin-mutations.sh returned unsupported_pin_runner for every row; the Phase 4.5 reviewer applied all ten by hand in a scratch copy (subtask 1).
