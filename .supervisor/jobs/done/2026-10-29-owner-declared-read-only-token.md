# Supervisor Job: The owner declares a fine-grained GitHub token read-only when GitHub can't say so (phase 6, item 14)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (two unrelated worktrees present under `.claude/worktrees/`: `feature/no-test-run-posts-a-real-notification`, `fix/kernel-tests-under-load`; neither touches this item's files)
- **Source requirement:** .supervisor/requirements/phase-6/2026-10-29-102705-owner-declared-read-only-token.md
- **Base commit:** 878892edbc57afee05660c50cbfb4a2e35d063f2

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel is strict TypeScript + vitest + better-sqlite3; app is React + Electron + vitest + Playwright. Everything needed exists. |
| 2 | Dependency Availability | CAUTION | No new packages. The four new mockup screenshots need a headless Chromium (Playwright is in `app/` devDependencies; `npx playwright install chromium` may be needed locally). |
| 3 | Architecture Fit | GO | Mechanism only (invariant 1): the kernel records who vouched for the permissions; it infers nothing. The declaration is an owner action through the existing route/CLI; the safety-kernel rules (write-scoped refusal, no token in output) are unchanged (invariant 3). Follows D9 (mockup first). |
| 4 | Scope vs Supervisor Capability | GO | ~35 files across kernel, app, mockup and docs: over the 12-file `context-bound` bound, split into 3 subtasks with zero file overlap. |
| 5 | Hard Blockers | GO | The `connectors` row has no column for the source, so a migration 18 is needed; the migration framework (`kernel/src/store/migrations/`, PRAGMA-guarded `ADD COLUMN` pattern of migrations 15 and 17) supports it. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Let the owner connect a fine-grained GitHub token by declaring, in the Connect sheet or at `studio connectors github set`, that every permission is Read. The kernel records the declaration as the owner's (source `declared` plus a time), never as GitHub-verified. The phase 6 live run can then start.

**Problem Statement:**
The owner needs to connect their real fine-grained GitHub token because the phase 6 live exit run cannot start without a connected token.
Today the connector refuses every real token `token_permissions_unknown`: GitHub publishes no permissions for a fine-grained token, so the real client reports `permissions: null`. Probe p12, run by the owner on 2026-10-29, confirmed it. (a) `x-oauth-scopes` was `null` on both calls, and `x-accepted-github-permissions` names the endpoint's needs, not the token's grants. (b) `github-authentication-token-expiration: 2026-11-28 08:24:18 UTC` parses as `2026-11-28T08:24:18.000Z`. (c) `GET /user/repos` returned 57 repos: the selected one plus every public repo the account owns, and none of its 18 private repos.
Success looks like this. A declared token connects with `permissions: null`, `permissions_source: "declared"` and `permissions_declared_at`. A token with unknown permissions and no declaration is still refused, and a reported write permission is still refused. No surface calls a declared token verified, and the token appears in no response, log line or event.

**Owner decisions (binding, from the requirement, 2026-10-29):** the fallback is the owner's declaration (option A). The declaration is recorded as the owner's, never as verified. There is no inference and no write probe. Every earlier phase 6 decision stands, item 03's "write-scoped tokens are refused" included: a reported write permission is refused `token_write_scoped` even with a declaration. The GitHub App connect, the narrowing of the reach list and any write call are non-goals.

**Design decisions this brief fixes (so the three subtasks agree):**
- **Wire and row shape.** Migration 18 (`connector_permissions_source`) adds two nullable `TEXT` columns to `connectors`: `permissions_source` (`reported` | `declared`, a closed list in code: `CONNECTOR_PERMISSIONS_SOURCES` in `kernel/src/integrations/types.ts`, no SQL CHECK) and `permissions_declared_at` (ISO time, set only when the source is `declared`). Existing rows read `null` for both and are never backfilled. `ConnectorView` and the app contract's `Connector` gain `permissions_source: "reported" | "declared" | null` and `permissions_declared_at: IsoTime | null`, both always present.
- **Route body.** `POST /connectors/github/token` takes `{token, declared_read_only?}`. When present, `declared_read_only` must be a boolean, or the route answers 400 `invalid_body`. Only `true` declares; `false` is the same as absent.
- **Connector.** `setToken(store, token, now, opts?: {declaredReadOnly?: boolean})`. Permissions reported (non-empty): today's path. Any write level is refused `token_write_scoped`, with or without a declaration. All read means `connected` with source `reported` and `permissions_declared_at` null. Permissions unknown (`null` or empty) with no declaration: refused `token_permissions_unknown`, nothing written. The message names the declaration (the Connect sheet's confirmation, `yes` at `studio connectors github set`, or `declared_read_only: true`) and no longer names an internal doc. Permissions unknown with a declaration: validate the rest as today (user, expiry, reachable repos), swap the Keychain item, and write the row `connected` with `permissions_json` NULL, source `declared` and `permissions_declared_at` = the write time. A later `reported` connect clears `permissions_declared_at`. Disconnect and refresh leave both columns unchanged.
- **Event.** The `connector_status` event a successful set appends carries `permissions_source` (`{connector_id, kind, status, permissions_source}`). Refusal and other status events are unchanged.
- **CLI.** `set` still refuses every argument (exit 2, nothing sent, the argument never echoed), so `--declared-read-only` as argv never connects. The declaration is read after the token, from the same input as the token. At a terminal, a second prompt (echo on) asks: "Is this a fine-grained token, and is every permission you gave it Read? Type yes to declare it: ". Piped, line 1 is the token and an optional line 2 is the answer. Both come from one capped read (`MAX_STDIN_SECRET_BYTES`): the piped reader splits at the first line ending, `readSecret` takes line 1, and what follows is kept for `readDeclaration`, which never reads the stream again. Only `yes` or `y` (trimmed, case-insensitive) declares and sends `declared_read_only: true`. Any other answer, or none, sends `{token}` alone, so a token with unknown permissions is refused with the message that names the declaration. A new dep `readDeclaration` sits beside `readSecret` in `ConnectorsSubcommandDeps`, so tests drive it without a terminal. For a row with `permissions_source: "declared"`, `studio connectors github status` prints `permissions: read-only, declared by the owner at <time>`, not `-`.
- **Screen copy (from the mockup, D9).** A required checkbox in the Connect sheet: "This is a fine-grained token, and every permission I gave it is Read". Connect stays disabled until the field holds something and the box is ticked. The request sends `declared_read_only: true`. In the connected state with source `declared`, the permissions section shows "Permissions: read-only, declared by you" with the declaration time, not the checked list, and never "read from GitHub" or "verified" for the permissions. The `token_permissions_unknown` refusal copy now points at the confirmation. The checkbox's test id is `sheetDeclare` in `INTEGRATIONS_TEST_IDS` (`model.ts`).

## Acceptance Criteria
- [ ] AC1: Given a real-shaped token whose client reports `permissions: null` (or `{}`) and no declaration (route body `{token}`, or the CLI with no `yes`), when it is set, then it is refused `token_permissions_unknown` (422), no Keychain item is added or deleted, the row is not `connected`, and the refusal message names the declaration (the confirmation, `yes` at the CLI prompt, or `declared_read_only: true`).
- [ ] AC2: Given the same token with the owner's declaration (route body `{token, declared_read_only: true}`, and the CLI answering `yes` both at a terminal and as line 2 of piped input), when it is set, then the Keychain item is written, and the row and the answer read `status: "connected"`, `permissions: null`, `permissions_source: "declared"` and `permissions_declared_at` equal to the write time. The appended `connector_status` event carries `permissions_source: "declared"`. Neither the response body, any appended event payload, the CLI's stdout/stderr nor any captured log line contains the token string (asserted with the token as a needle on every path, refusals included).
- [ ] AC3: Given a client reporting any write permission, when it is set with or without a declaration, then it is refused `token_write_scoped` naming the permission, and an existing `connected` token's Keychain item and row stay unchanged. Given a client reporting only read levels, with or without a declaration, it connects with `permissions_source: "reported"` and `permissions_declared_at: null`.
- [ ] AC4: Given `studio connectors github set --declared-read-only` (the declaration as an argv flag only, with no prompt answer), when it runs, then it exits 2, contacts no kernel route, prints no argument, and nothing connects.
- [ ] AC4b: Given a connector row with `permissions_source: "declared"`, when `studio connectors github status` runs, then its permissions line reads `read-only, declared by the owner at <permissions_declared_at>`, and no line presents the permissions as checked by GitHub. Given a `reported` row, the line lists the reported permissions as today.
- [ ] AC5: Given a route body whose `declared_read_only` is present but not a boolean (e.g. `"true"`, `1`), when posted, then the route answers 400 `invalid_body` and the connector is not called.
- [ ] AC6: Given a store at migration 17, when the kernel opens it, then migration 18 `connector_permissions_source` adds `connectors.permissions_source` and `connectors.permissions_declared_at` (nullable TEXT, existing rows null). It is the last migration, it re-runs safely (PRAGMA-guarded `ADD COLUMN`), and the existing store and foundation migration pins name version 18.
- [ ] AC7: Given the Connect sheet, when a token is pasted and the confirmation is unticked, then Connect is disabled and Enter does not submit. When it is ticked, Connect sends `{token, declared_read_only: true}`. Given a `connected` row with `permissions_source: "declared"`, the detail pane reads "Permissions: read-only, declared by you" with the declaration time and no checked permission list, and no permissions text on the screen says "verified" or "read from GitHub". A `token_permissions_unknown` refusal shows copy pointing at the confirmation.
- [ ] AC8: Given the Integrations mockup (`docs/design/mockups/integrations.html`), when opened with `#view=sheet` and `#view=connected-declared` in light and dark, then it shows the confirmation checkbox (Connect disabled until ticked) and the "declared by you" connected state. `docs/DESIGN.md` "Phase 6: Integrations" notes both. Committed screenshots of both views in both themes sit in `docs/evidence/phase-6-integrations-mockup/` and are listed in its README. The app's sheet and connected state use the mockup's copy (the owner approves both on this item's PR).
- [ ] AC9: Given the live harness's stage 1 (`checkConnectStage` in `kernel/test/phase-6-exit-live.test.ts`), when the connector row has `permissions_json` NULL and `permissions_source: "declared"`, then "every permission read-only" passes only as `declared`: the stage's evidence record carries `permissions_source: "declared"` and `permissions_declared_at`. With `permissions_json` NULL and no declaration, it still fails, with a message that names the missing declaration (no longer "the owner's fallback decision … is still open"). The existing `connector_permissions_unknown` fixture still fails stage 1, and a new declared fixture passes it.
- [ ] AC10: Given `docs/OPEN_QUESTIONS.md`, when read, then probe p12's results are recorded with the date 2026-10-29 and evidence (a), (b) and (c) from the Problem Statement. The "how does GitHub expose a fine-grained token's permissions?" entry is ticked with the answer (GitHub exposes none), and the owner's fallback (the declaration) is noted. `docs/architecture/integrations.md` (the row columns, the lifecycle and the refusals table) describes the declaration, the source field, and that the reach list includes every public repo the account owns. Prerequisite 1 in `docs/evidence/phase-6-exit-runbook.md` becomes the owner's declaration step at Connect.
- [ ] AC11: Given the finished change, when `cd kernel && npm ci && npm run typecheck && npm test`, `cd app && npm ci && npm run typecheck && npm test` and `bash scripts/check-docs.sh` run, then all three pass.

## Touched-file invariants

> Grounded at base `878892edbc57afee05660c50cbfb4a2e35d063f2`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/integrations/github/connector.ts`**. Keep: no token anywhere, `nothing here logs, every failure is a fixed code and a fixed message, and a`. Validation happens before anything is written (`// 1. Validate, writing nothing: the candidate is the client's only token source.`), and the write check runs before the declaration can matter (`const writes = writePermissionsOf(permissions);`). A refusal while a token is in use leaves it in place (`if (!TOKEN_IN_USE.includes(r.status) && r.status !== "rejected") {`). Calls stay serialized and total (`setToken: (store, token, now) => exclusive(() => guarded(store, () => setToken(store, token, now))),`), and the swap stays delete-then-add with a read-back (`if (stored !== token) {`). Its imports stay within the CLI-safe set (`(`kernel/test/feature-seams.test.ts` pins the registry's module graph).`). Reuse: `statusEvent(` for the event and `refuse(` for the refusal. Mirror: `COLUMNS` (`const COLUMNS = "id, kind, status, account_login, permissions_json, reachable_repos_json, expires_at, verified_at, created_at, updated_at";`) and `ConnectorView` must match `ConnectorRow` in `kernel/src/integrations/types.ts` and `export interface Connector {` in `app/src/api/contract.ts`. Pinned by: `kernel/test/integrations-github-connector.test.ts` (`token_permissions_unknown`).
- **`kernel/src/integrations/github/routes.ts`**. Keep: every handler is total (`async function total(fn: () => Promise<ContributedRouteResponse>): Promise<ContributedRouteResponse> {`), and the token is never echoed (`The token body is read once and handed to the connector: it is never`). Exactly four routes, no new one (`CONNECTOR_ERROR_STATUS`). Mirror: the contract's routes list (`{ method: "POST", path: "/connectors/github/token", origin: "p6-item-03" },` in `app/src/api/contract.ts`). Pinned by: `kernel/test/integrations-github-connector.test.ts` (`the shipped routes part serves exactly the contract's four p6-item-03 routes`).
- **`kernel/src/integrations/cli.ts`**. Keep: the token is read only from stdin (`The token is read ONLY from stdin: piped, or typed at a terminal with echo`). Any argument to `set` exits 2 unechoed (`if (command.kind === "set-with-argument") {`). The read is capped (`MAX_STDIN_SECRET_BYTES`), GitHub text goes through `shown(`, and the module never imports the CLI index (`terminal. This module never imports `../cli/index.js``). Reuse: `readSecret` injection, through a `readDeclaration` dep beside it. Pinned by: `kernel/test/integrations-cli-stdin.test.ts`, `kernel/test/integrations-github-connector.test.ts`.
- **`kernel/src/integrations/types.ts`**. Keep: the closed-list idiom (`export const CONNECTOR_STATUSES = Object.freeze(["connected", "rejected", "disconnected", "expiring", "expired"] as const);`), and `It never holds a secret`. Mirror: `app/src/api/contract.ts` (`export type ConnectorStatus = "connected" | "rejected" | "disconnected" | "expiring" | "expired";`).
- **`kernel/src/store/migrations/index.ts`**. Keep: `Append only; never edit a shipped one.` (017 is not edited). Reuse: the PRAGMA guard from `kernel/src/store/migrations/015_session_cwd.ts` (`if (existing.all(table).includes(column)) continue;`). Pinned by: `kernel/test/store.test.ts` (`[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]`, `[17, "phase_6_foundation"]`), `kernel/test/integrations-foundation.test.ts` (`is the last migration, version 17`).
- **`kernel/test/phase-6-exit-live.test.ts`**. Keep: the store is read through a read-only connection (`// ---- Store reads (read-only)`), and the stage-1 employer check (`the connected token reaches an employer repository`). Pinned by its own map (`connector_permissions_unknown: ["1_connect", "fail"],`).
- **`app/src/screens/integrations/ConnectSheet.tsx`**. Keep: `The token field is UNCONTROLLED.` The field is emptied before the request, and the token leaves the module only through `connectGithub`. The confirmation is ordinary state (a boolean); it never touches the token. Reuse: the `disabled={!connecting && !filled}` gating, extended with the tick. Pinned by: `app/src/screens/integrations/connect-sheet.test.tsx`, `app/e2e/integrations.spec.ts` (`IDS.sheetConnect`).
- **`app/src/screens/integrations/IntegrationsView.tsx`** and **`model.ts`**. Keep: GitHub text rendered as text, and `permissionLines(row.permissions)` for the reported case. Mirror: `if (reply.kind === "refused" && reply.error === "token_permissions_unknown") return { kind: "permissions_unknown" };` (`model.ts`) stays the one mapping. Test ids stay in `INTEGRATIONS_TEST_IDS`. Pinned by: `app/src/screens/integrations/integrations.test.tsx`, `model.test.ts`.
- **`app/src/screens/integrations/actions.ts`**. Keep: `the token the owner pasted, to the kernel by`, and one `send<ConnectorChangeResponse>` call that answers the row, never the token.
- **`app/e2e/integrations.spec.ts`**. Keep: the evidence guard (`/** When this run began, for the guard that the tracked evidence dir is untouched without `INTEGRATIONS_EVIDENCE`. */`). Don't regenerate `docs/evidence/phase-6-polish/integrations/` in this item, and keep `expectNoToken(`.
- **`app/e2e/phase-6-exit.spec.ts`**. Keep: its fixture-kernel-only walk, and its `IDS` table mirroring `INTEGRATIONS_TEST_IDS` (`sheetConnect: "integrations-sheet-connect",`, which gains `sheetDeclare`). The walk ticks `IDS.sheetDeclare` before `await byId(page, IDS.sheetConnect).click();`. Both token-body assertions, `expect(fx.tokens).toEqual([{ token: TOKEN }]);` and `expect(fx.tokens, "one token was posted").toEqual([{ token: TOKEN }]);`, become `[{ token: TOKEN, declared_read_only: true }]`. The fixture records `req.body` verbatim, so no fixture change is needed. Pinned by: its own run in `npm run e2e`.

## Closed enumerations touched

> Sibling grep at base `878892e`: `grep -rnF 'reachable_repos_json' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=dist .` gives 33 hits in 14 files (`kernel/dist`, `.claude` and `.supervisor` excluded). `grep -rnF 'reachable_repos:' app/src app/e2e docs kernel/src` gives 11 hits in 8 files.

- **`permissions_source` / `permissions_declared_at`** (new `connectors` columns, siblings `reachable_repos_json` / `verified_at`) must be named in:
  - `kernel/src/integrations/types.ts`: `ConnectorRow` (`readonly reachable_repos_json: string | null;`). Extend.
  - `kernel/src/integrations/github/connector.ts`: `COLUMNS`, `ConnectorView`, `connectorView`, the connect `UPDATE`. Extend.
  - `kernel/test/integrations-foundation.test.ts`: the exact column list of `connectors` (`"reachable_repos_json",`). Extend: the fresh-store list gains the two columns, and the migration-17 test asserts the 17-only shape or is rescoped.
  - `kernel/test/integrations-github-connector.test.ts`: the `ConnectorRow` literal (`reachable_repos_json: JSON.stringify(["owner-one/studio-sandbox", "owner-one/loomwright"]),`). Extend: the typed literal needs the two fields.
  - `kernel/test/phase-6-exit-live.test.ts`: the stage-1 `SELECT` (`"SELECT id, status, account_login, permissions_json, reachable_repos_json, expires_at, verified_at FROM connectors`). Extend.
  - `app/src/api/contract.ts`: `Connector` (`readonly reachable_repos: readonly string[] | null;`). Extend.
  - `app/src/screens/integrations/test-support.tsx`, `app/src/screens/integrations/model.test.ts`, `app/src/screens/integrations/integrations.test.tsx`, `app/src/screens/team/connectors.test.tsx`, `app/e2e/fixtures/integrations.ts`, `app/e2e/fixtures/team.ts`: typed `Connector` literals (`reachable_repos:`). Extend (required fields; `tsc` covers `src` and `e2e`).
  - `docs/architecture/integrations.md`: the row's column sentence (`One row per connector kind (migration 17).`). Extend.
  - `kernel/src/store/migrations/017_phase_6_foundation.ts`: no change. Shipped migrations are append-only.
  - `kernel/src/triggers/poll.ts`, `kernel/test/phase-6-exit.test.ts`, `kernel/test/playbooks-dry-run-poll.test.ts`, `kernel/test/playbooks-drafts-poll.test.ts`, `kernel/test/triggers-poll.test.ts`, `kernel/test/integrations-github-tools.test.ts`, `docs/architecture/triggers.md`: no change. Each selects or inserts named columns only, and the new columns are nullable.
- **`reported` / `declared`** (new closed list `CONNECTOR_PERMISSIONS_SOURCES`, sibling: `CONNECTOR_STATUSES`) must be named in:
  - `kernel/src/integrations/types.ts`: the new frozen list and type. Create.
  - `app/src/api/contract.ts`: `permissions_source: "reported" | "declared" | null`, mirroring it the way `ConnectorStatus` mirrors `CONNECTOR_STATUSES`. Extend.
  - `kernel/src/integrations/index.ts`: the barrel that re-exports `ConnectorRow` (`ConnectorRow,`). Extend: export the new list and type.
- **Migration version 18** (sibling: `17`) must be named in:
  - `kernel/src/store/migrations/index.ts`: `migrations` (`phase6Foundation,`). Extend.
  - `kernel/test/store.test.ts`: every applied-versions pin (`[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]`, 6 hits), the last-migration pins (`[17, "phase_6_foundation"]`), `expect(err.knownVersion).toBe(17);`, the default-list description and its name table (`[17, "phase_6_foundation"],`), and the contiguity messages (`not a contiguous run from 1`). Extend.
  - `kernel/test/integrations-foundation.test.ts`: `is the last migration, version 17`. Extend: the last migration is now 18.
- **`sheetDeclare`** (new test id, sibling: `sheetConnect`; `grep -rlF 'sheetConnect' app/src app/e2e` gives 6 files) must be named in:
  - `app/src/screens/integrations/model.ts`: `INTEGRATIONS_TEST_IDS` (`sheetConnect: "integrations-sheet-connect",`). Extend.
  - `app/e2e/integrations.spec.ts`: its hand-copied `IDS` table (`sheetConnect: "integrations-sheet-connect",`). Extend.
  - `app/e2e/phase-6-exit.spec.ts`: its hand-copied `IDS` table (`sheetConnect: "integrations-sheet-connect",`). Extend.
  - `app/src/screens/integrations/ConnectSheet.tsx`, `connect-sheet.test.tsx`, `integrations.test.tsx`: use `IDS.sheetConnect` through the shared table. They use the new id where the box is ticked, with no table of their own to extend.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/integrations-github-declared.test.ts`: unknown permissions and no declaration refused `token_permissions_unknown` | make the connector's declaration guard always true (the unknown-permissions branch proceeds as declared) in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-declared.test.ts`: declared connect writes source `declared` and the time | flip `"declared"` → `"reported"` in the declared-path `UPDATE` values in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-declared.test.ts`: reported write plus declaration refused `token_write_scoped` | move the declaration check above `const writes = writePermissionsOf(permissions);` so a declaration short-circuits it, in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-declared.test.ts`: no token in any response, event or log (every path) | add the token to the success answer's `connector` in `kernel/src/integrations/github/connector.ts` |
| `kernel/test/integrations-github-declared.test.ts`: non-boolean `declared_read_only` answers 400 | drop the boolean check on `declared_read_only` in `kernel/src/integrations/github/routes.ts` |
| `kernel/test/integrations-cli-stdin.test.ts`: argv `--declared-read-only` exits 2 with nothing sent | delete `if (command.kind === "set-with-argument") {`'s early return in `kernel/src/integrations/cli.ts` |
| `kernel/test/integrations-github-declared.test.ts`: `status` prints "declared by the owner" for a declared row | make `formatGitHubStatus` ignore `permissions_source` (print `-` for null permissions) in `kernel/src/integrations/cli.ts` |
| `kernel/test/integrations-cli-stdin.test.ts`: only `yes`/`y` declares | accept any non-empty answer as a declaration in `kernel/src/integrations/cli.ts` |
| `kernel/test/phase-6-exit-live.test.ts`: declared row passes stage 1 only as `declared` | keep the `if (permissions === null)` problem for a declared row in `checkConnectStage` |
| `app/src/screens/integrations/connect-sheet.test.tsx`: Connect disabled until ticked | flip `disabled={!connecting && !filled}` back to ignore the tick in `app/src/screens/integrations/ConnectSheet.tsx` |
| `app/src/screens/integrations/declared.test.tsx`: declared state shows "declared by you" and no "verified"/"read from GitHub" permission text | render `permissionLines(row.permissions)`'s section for a declared row in `app/src/screens/integrations/IntegrationsView.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: migration 18, declared path in the connector, route and CLI, live-harness stage 1 | AC1, AC2, AC3, AC4, AC4b, AC5, AC6, AC9, AC11 (kernel) | 12 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Mockup and docs: confirmation and declared state in the mockup (light and dark), DESIGN.md, screenshots, OPEN_QUESTIONS p12, integrations.md, runbook | AC8 (mockup half), AC10, AC11 (docs) | 6 modify, 4 create | `skills/frontend-ui/SKILL.md` | LAUNCHABLE |
| 3 | App: Connect sheet confirmation, declared connected state, contract, refusal copy, e2e | AC7, AC8 (app half), AC11 (app) | 15 modify, 1 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1, #2) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "kernel/src/store/migrations/018_connector_permissions_source.ts"}
  - {kind: "symbol", path: "kernel/src/store/migrations/018_connector_permissions_source.ts", name: "connectorPermissionsSource"}
  - {kind: "symbol", path: "kernel/src/integrations/types.ts", name: "CONNECTOR_PERMISSIONS_SOURCES"}
  - {kind: "type", path: "kernel/src/integrations/types.ts", name: "ConnectorPermissionsSource"}
  - {kind: "symbol", path: "kernel/src/integrations/github/connector.ts", name: "permissions_declared_at"}
  - {kind: "symbol", path: "kernel/src/integrations/github/routes.ts", name: "declared_read_only"}
  - {kind: "symbol", path: "kernel/src/integrations/cli.ts", name: "readDeclaration"}
  - {kind: "file", path: "kernel/test/integrations-github-declared.test.ts"}
requires: []
lanes:
  - "kernel/src/integrations/types.ts"
  - "kernel/src/integrations/index.ts"
  - "kernel/src/integrations/github/connector.ts"
  - "kernel/src/integrations/github/routes.ts"
  - "kernel/src/integrations/cli.ts"
  - "kernel/src/store/migrations/index.ts"
  - "kernel/src/store/migrations/018_connector_permissions_source.ts"
  - "kernel/test/integrations-github-declared.test.ts"
  - "kernel/test/integrations-github-connector.test.ts"
  - "kernel/test/integrations-cli-stdin.test.ts"
  - "kernel/test/integrations-foundation.test.ts"
  - "kernel/test/store.test.ts"
  - "kernel/test/phase-6-exit-live.test.ts"
  - "kernel/test/fixtures/github-fake.ts"
external_requires: []

# Subtask 2
provides:
  - {kind: "symbol", path: "docs/design/mockups/integrations.html", name: "connected-declared"}
  - {kind: "symbol", path: "docs/design/mockups/integrations.html", name: "every permission I gave it is Read"}
  - {kind: "symbol", path: "docs/DESIGN.md", name: "declared by you"}
  - {kind: "file", path: "docs/evidence/phase-6-integrations-mockup/integrations-connected-declared-light.png"}
  - {kind: "file", path: "docs/evidence/phase-6-integrations-mockup/integrations-connected-declared-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-6-integrations-mockup/integrations-sheet-declare-light.png"}
  - {kind: "file", path: "docs/evidence/phase-6-integrations-mockup/integrations-sheet-declare-dark.png"}
  - {kind: "symbol", path: "docs/OPEN_QUESTIONS.md", name: "p12"}
  - {kind: "symbol", path: "docs/architecture/integrations.md", name: "permissions_source"}
  - {kind: "symbol", path: "docs/evidence/phase-6-exit-runbook.md", name: "declare"}
requires: []
lanes:
  - "docs/design/mockups/integrations.html"
  - "docs/DESIGN.md"
  - "docs/evidence/phase-6-integrations-mockup/**"
  - "docs/OPEN_QUESTIONS.md"
  - "docs/architecture/integrations.md"
  - "docs/evidence/phase-6-exit-runbook.md"
external_requires:
  - "headless Chromium for the mockup screenshots (Playwright from app/ devDependencies)"

# Subtask 3
provides:
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "permissions_source"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "declared_read_only"}
  - {kind: "symbol", path: "app/src/screens/integrations/ConnectSheet.tsx", name: "every permission I gave it is Read"}
  - {kind: "symbol", path: "app/src/screens/integrations/IntegrationsView.tsx", name: "declared by you"}
  - {kind: "symbol", path: "app/src/screens/integrations/model.ts", name: "sheetDeclare"}
  - {kind: "file", path: "app/src/screens/integrations/declared.test.tsx"}
requires:
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/types.ts", name: "CONNECTOR_PERMISSIONS_SOURCES"}
  - {from: "1", kind: "symbol", path: "kernel/src/integrations/github/routes.ts", name: "declared_read_only"}
  - {from: "2", kind: "symbol", path: "docs/design/mockups/integrations.html", name: "connected-declared"}
  - {from: "2", kind: "symbol", path: "docs/design/mockups/integrations.html", name: "every permission I gave it is Read"}
lanes:
  - "app/src/api/contract.ts"
  - "app/src/screens/integrations/actions.ts"
  - "app/src/screens/integrations/ConnectSheet.tsx"
  - "app/src/screens/integrations/IntegrationsView.tsx"
  - "app/src/screens/integrations/model.ts"
  - "app/src/screens/integrations/integrations.css"
  - "app/src/screens/integrations/test-support.tsx"
  - "app/src/screens/integrations/connect-sheet.test.tsx"
  - "app/src/screens/integrations/integrations.test.tsx"
  - "app/src/screens/integrations/model.test.ts"
  - "app/src/screens/integrations/declared.test.tsx"
  - "app/src/screens/team/connectors.test.tsx"
  - "app/e2e/integrations.spec.ts"
  - "app/e2e/phase-6-exit.spec.ts"
  - "app/e2e/fixtures/integrations.ts"
  - "app/e2e/fixtures/team.ts"
external_requires: []
```

### File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| kernel (#1) | `kernel/src/integrations/github/connector.ts` (549: the declared branch is part of `setToken`, the single authority for token validation, so it is appended), `kernel/src/integrations/github/routes.ts` (113), `kernel/src/integrations/cli.ts` (264), `kernel/src/integrations/types.ts` (214), `kernel/src/integrations/index.ts` (barrel), `kernel/src/store/migrations/index.ts` (41), `kernel/test/integrations-github-connector.test.ts` (913: pin and typed-literal updates only; new tests go to the new file), `kernel/test/integrations-cli-stdin.test.ts` (164), `kernel/test/integrations-foundation.test.ts` (850: pin updates only), `kernel/test/store.test.ts` (2161: version-pin updates only), `kernel/test/phase-6-exit-live.test.ts` (2205: stage 1's checker and its fixtures live here, the single authority for stage checks), `kernel/test/fixtures/github-fake.ts` (116, only if the fake needs a reported-read variant) | `kernel/src/store/migrations/018_connector_permissions_source.ts`, `kernel/test/integrations-github-declared.test.ts` | HIGH |
| mockup + docs (#2) | `docs/design/mockups/integrations.html` (759: the single D9 mockup source for this screen), `docs/DESIGN.md` (89), `docs/evidence/phase-6-integrations-mockup/README.md` (131), `docs/OPEN_QUESTIONS.md` (139), `docs/architecture/integrations.md` (90), `docs/evidence/phase-6-exit-runbook.md` (236) | `docs/evidence/phase-6-integrations-mockup/integrations-{sheet-declare,connected-declared}-{light,dark}.png` (4) | HIGH (docs), MEDIUM (screenshots: headless browser) |
| app (#3) | `app/src/api/contract.ts` (940: the wire contract's single home), `app/src/screens/integrations/actions.ts` (52), `ConnectSheet.tsx` (238), `IntegrationsView.tsx` (605: the declared variant replaces the permissions section in place, its one home), `model.ts` (313), `integrations.css` (421), `test-support.tsx` (155), `connect-sheet.test.tsx` (471), `integrations.test.tsx` (555: typed-literal update, and its connect flow ticks the confirmation and expects `declared_read_only: true`), `model.test.ts` (286), `app/src/screens/team/connectors.test.tsx` (370), `app/e2e/integrations.spec.ts` (561: existing connect flows tick the box; no new evidence), `app/e2e/phase-6-exit.spec.ts` (151: its walk ticks the box, and both token-body assertions expect `[{ token: TOKEN, declared_read_only: true }]`), `app/e2e/fixtures/integrations.ts` (197), `app/e2e/fixtures/team.ts` (439) | `app/src/screens/integrations/declared.test.tsx` | HIGH (src), MEDIUM (e2e) |

**Total estimated files:** 33 modify + 7 create (4 of the creates are PNGs)

> **Validator-owned surfaces:** `bash scripts/check-docs.sh` checks every relative markdown link in `docs/`, so the new screenshot links in the evidence README and every link added to OPEN_QUESTIONS, integrations.md and the runbook must resolve.

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 3
Subtask 2 ──→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |
| Subtask 1 | Subtask 3 | none (3 mirrors 1's wire shape in `app/src/api/contract.ts`) | YES (requires) |
| Subtask 2 | Subtask 3 | none (3 takes 2's mockup copy) | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel: both have empty `requires`, zero overlap)
- **Batch 2:** Subtask 3 (after Subtasks 1 and 2)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| A declared token shown anywhere as "verified" or GitHub-checked (requirement risk) | HIGH | AC2, AC4b, AC7 and AC9 assert the declared wording on every surface: the route body, the CLI `status` text (AC4b), the event payload, the screen and the stage-1 evidence. The screen's permissions note must not reuse `read from GitHub ${verified}` for a declared row. The status line's "verified" refers only to the account and repos check. |
| The token leaks through a new path (the declaration prompt, the piped second line, a new error) | HIGH | Re-test every path with the token as a needle (AC2). The CLI never echoes what it read. The second line is read from the same capped reader (`MAX_STDIN_SECRET_BYTES`). Route errors stay fixed strings. |
| Splitting piped stdin into token and answer changes the piped `set` behaviour that `integrations-cli-stdin.test.ts` pins | MEDIUM | Line 1 is the token exactly as today (trailing line ending trimmed). Only an optional line 2 is new. Update the existing piped pins and keep the "token then newline" case green. |
| A declaration overrides a reported write permission | HIGH | The write check runs before the declaration is consulted (touched-file invariant). AC3 and its pin mutation cover it. |
| Migration 18 churns many version pins in `store.test.ts` and `integrations-foundation.test.ts`; a missed one fails CI | MEDIUM | The Closed enumerations section lists every pin. Grep `16, 17]` and `phase_6_foundation` after the change, and run the full kernel suite. |
| Mockup screenshots need a headless browser; without one the evidence PNGs are missing | MEDIUM (Feasibility, Phase 2.5) | Use Playwright's Chromium from `app/` (`npx playwright install chromium`) with the hash-forced views, as the README describes. If it can't run, report it instead of committing placeholder images. |
| The app's e2e `app` CI job is not a required check, so a red e2e can still be parked READY | MEDIUM | Subtask 3 runs `cd app && npm run e2e` locally (at least `integrations.spec.ts` and `phase-6-exit.spec.ts`) and updates every flow that presses Connect to tick the confirmation first. The `sheetDeclare` rows in Closed enumerations list each copied `IDS` table. |
| Prior churn: `kernel/test/store.test.ts` (15 entries), `connector.ts` (2), `ConnectSheet.tsx` (1), `cli.ts` (1); recurring classes `self_heal_churn`, `drain_churn` | MEDIUM (Prior churn, postmortem ledger) | Land all version pins in one pass, run the full kernel and app suites before hand-back, and keep the touched-file invariants so review rounds don't reopen them. |
| The live harness reads the owner's real store; a store from before migration 18 has no `permissions_source` column | LOW | The live run follows an app upgrade, and the daemon applies migration 18 on open. Stage 1 can treat a missing column as no declaration (fail with the declaration message) instead of throwing. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-29-owner-declared-read-only-token.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-29T11:31:06Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/162
- **Branch:** feature/owner-declared-read-only-token
- **Files changed:** 57
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Three subtasks (kernel migration 18 and declared path, mockup and docs, app Connect sheet confirmation and declared state) merged into PR #162. The Phase 4.5 holistic review PASSed on its first pass: all 11 pin mutations held when the reviewer applied them by hand, and the kernel suite (2593), the app suite (1299) and check-docs all passed. 3 LOW/nit findings were dismissed below the MEDIUM floor and posted as a marker comment. risk_classification high_risk=true (token/secret/migration content, size). The drain was not dispatched because .auto_review is false; under /automate the run's own drain owns it.

## Not verified
- **app Connect sheet and connected state** — subtask 3 builds them; subtask 2 changed only the mockup and docs (subtask 2)
- **Echo-on declaration prompt** — exercised only through a fake terminal stream; no real Keychain or real GitHub token was used (subtask 1)
- **Connect sheet checkbox and declared-state layout/CSS** — no screenshot of the new app sheet or declared state was viewed; e2e asserts behaviour only (subtask 3)
- **Declared connected state in the built app** — the e2e fixture answers with a reported row, so only jsdom renders the declared state (subtask 3)
