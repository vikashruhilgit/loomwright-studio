# Supervisor Job: Pluggable auth providers (subscription token, API key)

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — describes kernel/, invariants 3 and 6 apply directly)
- **Git:** clean except the tracked automate run file (`.supervisor/automate/*.md`, written by the engine — never stage it in this job), branch: main @ 1fbbc15
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 / 10.9.2
- **Blockers:** 0 | **Warnings:** 1 (dirty tracked run file — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1/04-auth-providers.md
- **Base commit:** 1fbbc15

## Feasibility
- **Verdict:** CAUTION — everything is plain TypeScript over `node:child_process` and the item-03 `Store`; no new dependency. Two points needed probing and were probed: (1) "compiled out" with plain `tsc` (no bundler, no `define`) — `exclude` does NOT drop a file another file imports statically, so the registry must load the subscription provider through a non-literal dynamic `import()`; probed below. (2) Keychain "not found" is `security` exit status 44 (probed). Keychain prompts under launchd stay unverified (item 09) — out of scope, isolated in one module.

## Task
**Goal:** Implement `kernel/src/auth/`: an `AuthProvider` interface, a `subscription-token` provider (Keychain `loomwright-studio-oauth` → `CLAUDE_CODE_OAUTH_TOKEN`) and an `api-key` provider (Keychain `loomwright-studio-api-key` → `ANTHROPIC_API_KEY`), both of which strip every other credential/billing-routing variable from the child environment; a whole-token shape check; expiry tracking from a recorded token creation date with a deduplicated `notify` audit event; and a `STUDIO_DISTRIBUTION=1` build that leaves the subscription provider out of `dist/` entirely.

**Problem Statement:**
Each agent session (item 05) needs an environment that authenticates it on exactly one account. On the personal build that is the owner's subscription token, fully isolated (D27); a later commercial build must switch to an API key with no code change (D16). Probe 2 proved a stray `ANTHROPIC_API_KEY` silently wins over the subscription and moves billing to the API (Q2), and the owner's first token was saved cut off at 59 characters and failed with a 401.
Currently `kernel/src/auth/index.ts` exports nothing.
Success looks like a tested provider layer that item 05 calls to build each session's env, which can never leak the token into logs, events or errors, never lets a second credential reach the child, warns 30 days before the token's one-year life ends, and is physically absent from a distribution build.

## Acceptance Criteria
- [ ] AC1 — Given the `AuthProvider` interface, when it is inspected, then it exposes `id`, `account` (a label, never a secret), `buildEnv(baseEnv) → env`, and `health() → ok | missing | invalid_shape | expiring(days)`.
- [ ] AC2 — Given the `subscription-token` provider, when `buildEnv` runs, then it reads the token from the macOS Keychain item `loomwright-studio-oauth` (via `security find-generic-password -w`, with no shell interpolation), sets `CLAUDE_CODE_OAUTH_TOKEN`, and removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK` and every other credential variable from the env. Tests prove a stray key in the parent env never reaches the child.
- [ ] AC3 — Given a stored value that is not a whole token, when `health()` runs, then it returns `invalid_shape`. A whole token has the `sk-ant-oat01-` prefix, is more than 80 characters, and has no whitespace (the 59-character cut-off token of 2026-09-30 is the test case). The token value never appears in logs, events, errors or test snapshots; a test greps captured output for the prefix.
- [ ] AC4 — Given a recorded token creation date, stored alongside as non-secret metadata, when fewer than 30 days remain of the one-year life, then `health()` returns `expiring(days)` and the kernel emits a notify event.
- [ ] AC5 — Given the `api-key` provider, when `buildEnv` runs, then it sets `ANTHROPIC_API_KEY` from the Keychain item `loomwright-studio-api-key` and removes `CLAUDE_CODE_OAUTH_TOKEN`. Tested with a stubbed Keychain only (invariant 6).
- [ ] AC6 — Given a build flag `STUDIO_DISTRIBUTION=1`, when the kernel is built, then the `subscription-token` provider is not included (D29), and a test asserts it cannot be selected.
- [ ] AC7 — Studio never runs `claude auth login`, `setup-token`, or any browser login flow (invariant 6). Token creation remains the owner's manual step.

## Outcomes Rubric
- `kernel/src/auth/` defines an `AuthProvider` type with `id`, `account`, `buildEnv` and `health`, and `health`'s result type has exactly the variants `ok`, `missing`, `invalid_shape` and `expiring` (the last carrying `days`).
- Exactly one file under `kernel/src/auth/` imports `node:child_process`: the Keychain module, which runs `/usr/bin/security` with an argument array (no shell) for both Keychain items; no string literal under `kernel/src/` contains `setup-token` or `auth login`.
- Tests show a parent env carrying `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK` and a `CLAUDE_CODE_USE_BEDROCK` switch yields a subscription child env with only `CLAUDE_CODE_OAUTH_TOKEN` as a credential, and an api-key child env with only `ANTHROPIC_API_KEY` (no `CLAUDE_CODE_OAUTH_TOKEN`).
- Tests cover the 59-character cut-off token returning `invalid_shape`, and a test asserts no captured console output, thrown error message or `events` row contains `sk-ant-oat01-`.
- Tests cover `expiring(days)` under 30 days left of the one-year life and the resulting `events` row of kind `notify` (written once per provider per UTC day).
- A test builds with `STUDIO_DISTRIBUTION=1` and asserts the output has no `subscription-token.js`, no `loomwright-studio-oauth` string, and its registry refuses `subscription-token`.

## Implementation Notes (verified at planning time)
- **Module layout (all under `kernel/src/auth/`):** `types.ts` (the `AuthProvider` interface, the `AuthHealth` union, `AuthProviderError`), `keychain.ts` (the ONLY Keychain/`child_process` module), `credential-env.ts` (the strip list + `stripCredentialEnv`), `token-shape.ts` (`isWholeToken`), `metadata.ts` (provider metadata read/write through `Store`), `subscription-token.ts`, `api-key.ts`, `registry.ts` (`availableProviderIds()`, `selectAuthProvider(id, deps)`), `notify.ts` (`checkAuthHealth`), `index.ts` (public re-exports). Requirement Risks: "Keep all Keychain calls in one module so item 09 can adjust them" — `keychain.ts` is that module.
- **`health()` result type (AC1):** a discriminated union `{ status: "ok" } | { status: "missing" } | { status: "invalid_shape" } | { status: "expiring"; days: number }`. Precedence: `missing` (item absent) → `invalid_shape` → `expiring` → `ok`. `days` is whole days left, floored; it can be `0` or negative once the token has lapsed (still `expiring` — the interface has no `expired` variant; item 05 treats the resulting 401 as park-and-notify, D17). No recorded creation date ⇒ expiry is unknown ⇒ `ok` (shape permitting) — state that in a doc comment.
- **Keychain module (AC2/AC5/AC7):** `execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 })` — absolute path (no PATH lookup), argument array (no shell), never `exec`/`shell: true`. The service name is the item key (`-s`), matching `probes/p4d-token-isolated-auth.mjs`. `-w` output ends in one `\n`: strip exactly one trailing newline, nothing else, so any other whitespace reaches the shape check. **Probed 2026-10-02:** a missing item exits with status **44** (`SecKeychainSearchCopyNext: The specified item could not be found`) ⇒ return "not found" (`undefined`). Any other failure ⇒ throw a typed `KeychainError` whose message names only the service and exit status — NEVER `err.stdout`, `err.stderr`'s raw text or the original error object (the error `execFileSync` throws carries both buffers). Expose a `KeychainReader` interface (`read(service): string | undefined`) with a real `securityCliKeychain` implementation and let providers take a reader by injection; the real implementation also accepts an injectable exec function so a unit test can assert the exact binary path, argument array and absence of `shell`, plus the 44 → `undefined` mapping, without touching the real Keychain. **No unit test may read the real Keychain.** Read the secret on each `buildEnv`/`health` call; never cache it on the provider object (so `util.inspect(provider)` / `JSON.stringify(provider)` can never show it).
- **Credential strip list (AC2, AC5, Q2) — grounded in the bundled CLI.** `strings` of `node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude` (CLI 2.1.284, grepped 2026-10-02) shows the CLI reads credential and billing-routing variables in three families. `stripCredentialEnv(env)` returns a NEW object (never mutates `baseEnv`) without: (a) **every `ANTHROPIC_*` variable** (`API_KEY`, `AUTH_TOKEN`, `BASE_URL`, `*_BASE_URL`, `FOUNDRY_API_KEY`, `FOUNDRY_AUTH_TOKEN`, `AWS_API_KEY`, `IDENTITY_TOKEN[_FILE]`, `FEDERATION_RULE_ID`, `SERVICE_ACCOUNT_ID`, `PROFILE`, `CONFIG_DIR`, `ORGANIZATION_ID`, `WORKSPACE_ID`, `CUSTOM_HEADERS`, …) — a prefix rule, because any of them can authenticate or re-route billing, and the kernel passes model choice through SDK options rather than inherited env; (b) the Claude Code credential variables `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_REFRESH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, `CLAUDE_CODE_OAUTH_CLIENT_ID`, `CLAUDE_CODE_OAUTH_SCOPES`, `CLAUDE_CODE_CUSTOM_OAUTH_URL`, `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`, `CLAUDE_CODE_SESSION_ACCESS_TOKEN`, `CLAUDE_CODE_GATEWAY_TOKEN`, `CLAUDE_CODE_HOST_AUTH_ENV_VAR`, `CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR`, `CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR`, `CLAUDE_CODE_HOST_CREDS_FILE`, the CLI's other sensitive tokens `CLAUDE_BRIDGE_OAUTH_TOKEN`, `CLAUDE_TRUSTED_DEVICE_TOKEN`, `AGENT_PROXY_AUTH_TOKEN`, `CLAUDE_BG_AUTH_SNAPSHOT_PATH`, `CLAUDE_BG_CLAIM_AUTH`, `CLAUDE_BG_PTY_AUTH`, `CLAUDE_BG_RV_AUTH` (all confirmed present in the binary by Plan Review 2026-10-02; stripping a credential the child never needed is free, leaking one is not), and `CLAUDE_CONFIG_DIR` (selects which stored login the CLI uses); (c) the provider switches `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_MANTLE`, `CLAUDE_CODE_USE_GATEWAY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD` (NOT a blanket `CLAUDE_CODE_USE_*`: `CLAUDE_CODE_USE_NATIVE_FILE_SEARCH`/`_POWERSHELL_TOOL`/`_COWORK_PLUGINS` are feature flags), plus `AWS_BEARER_TOKEN_BEDROCK`. Generic cloud credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_PROFILE`) are NOT stripped: the CLI uses them only behind a provider switch, which (c) removes, and an agent's own tools may need them — say so in a comment. Export the exact list as a frozen constant and test it entry by entry, plus that `PATH`/`HOME` survive. **Order inside `buildEnv`: strip first, then set the provider's one variable** — so `subscription-token` keeps only `CLAUDE_CODE_OAUTH_TOKEN` and `api-key` keeps only `ANTHROPIC_API_KEY` (which also satisfies AC5's "removes `CLAUDE_CODE_OAUTH_TOKEN`").
- **`buildEnv` fails closed:** a missing or `invalid_shape` secret ⇒ throw `AuthProviderError` with a `code` of `missing`/`invalid_shape` and a message naming the provider and Keychain service only. Never hand a cut-off token to a session (it fails with a 401 only after the CLI's ~60 s of retries — OPEN_QUESTIONS Q2/Q4).
- **Shape check (AC3):** `isWholeToken(v) = v.startsWith("sk-ant-oat01-") && v.length > 80 && !/\s/.test(v)`. Test cases: a 59-character value with the right prefix (the 2026-09-30 cut-off), a long value with an inner space, a long value with a trailing `\n` left over, the wrong prefix, and an empty string. Build test tokens with `"sk-ant-oat01-" + "x".repeat(n)` — never a real-looking token. For `api-key`, `health()` returns `invalid_shape` for an empty value or one containing whitespace (no published prefix rule is asserted for API keys) and never `expiring`.
- **Secret-leak test (AC3):** spy on `console.*` and `process.stdout/stderr.write`, run every provider path with a fake whole token (success, `invalid_shape`, Keychain error whose fake stderr ALSO contains the token, expiring + notify), collect captured output, every thrown error's `message`/`String(err)`/`util.inspect(err)`, the `events` rows (`SELECT * FROM events`), and `util.inspect`/`JSON.stringify` of each provider; assert none contains `sk-ant-oat01-`. Do not use vitest snapshots in this job.
- **Metadata (AC4) — migration 2 in the item-03 store.** The requirement's dependency line says 03 "reads and writes the provider metadata and events". Add `kernel/src/store/migrations/002_auth_providers.ts` (append it to the ordered list in `migrations/index.ts`; versions must stay contiguous — `applyMigrations` enforces it): `CREATE TABLE auth_providers (id TEXT PRIMARY KEY, account TEXT NOT NULL, token_created_at TEXT, updated_at TEXT NOT NULL DEFAULT …)` — non-secret only; a code comment says no secret column may ever be added. `metadata.ts` exposes `recordTokenCreated(store, providerId, account, createdAtIso)` and `readProviderMetadata(store, providerId)`. Nothing in this job calls `recordTokenCreated` from a CLI, and NO later phase-1 requirement owns that either (08-loopback-api-and-cli.md only mentions "auth provider health" in status) — flag it in the PR body as an unowned follow-up for the owner (an AC on 08, or a backlog entry); until then `health()` returns `ok` for want of a date, so D27's expiry warning is dormant. The `account` label defaults to the provider id (`subscription-token`, `api-key`) when no row exists; it is what item 05 will write into `sessions.auth_account`. Add the table to `docs/ARCHITECTURE.md` §Data model? NO — that file is outside this job's lanes; note the doc drift in the PR body instead (same as item 03 did for `wakeups`/`cap_state`), together with the provider-id drift: ARCHITECTURE.md §Auth names the provider `subscription`, the requirement and this job use `subscription-token`. **`kernel/test/store.test.ts` WILL break and must be adjusted, not weakened (checked):** its "migration 1 creates exactly the phase-1 tables" test (line ~165) opens a default `Store` and asserts `tableNames` equals `PHASE1_TABLES`, and line ~171 asserts `appliedMigrations()` equals `[[1, "initial"]]`. Keep migration 1's exact-set assertion by injecting `migrations: [initial]` there (import `initial` from `../src/store/migrations/001_initial.js`), and add a separate assertion that the default list yields `PHASE1_TABLES` plus `auth_providers` and applied versions `[[1,"initial"],[2,"auth_providers"]]`. The forbidden phase-2 table names (`agents`, `playbooks`, …) must still be absent.
- **Expiry (AC4):** life = 365 days from `token_created_at` (`setup-token` tokens last one year, D27); `days = Math.floor((expiresAt − now) / 86_400_000)`; `expiring` when `days < 30`. Inject `now: () => Date` into providers (default `() => new Date()`), never fake timers on the real clock.
- **Notify event (AC4):** `checkAuthHealth(store, provider, now)` calls `health()`; on `expiring` it appends ONE `events` row — `kind: "notify"`, `actor: "kernel"`, `payload_json: {"reason":"auth_token_expiring","provider":<id>,"account":<label>,"days":<n>}` — unless a `notify` row with the same `reason` and `provider` already exists for the same UTC day (dedupe by reading `events`, which is append-only). Returns the health. It is a mechanism only: no phase-1 requirement (07 included) yet schedules it — flag that in the PR body as the second unowned follow-up. **Clock:** insert the row with an explicit `at` from the injected `now()` (ISO-8601 UTC, same shape as the column default) and dedupe on `substr(at, 1, 10)` of that same clock — never rely on the column's SQLite-wall-clock default, or a test with an injected date on another day finds no row and double-notifies. Payload never includes the secret.
- **Registry + compile-out (AC6, D29) — probed 2026-10-02 with this repo's `tsc` 7.0.2.** `tsconfig` `exclude` does NOT keep out a file that another file imports statically (TypeScript follows the import). So: `registry.ts` loads the subscription provider ONLY via `const SUBSCRIPTION_MODULE = "./subscription-token.js"; await import(SUBSCRIPTION_MODULE)` — a non-literal specifier, which `tsc` does not follow — and catches `ERR_MODULE_NOT_FOUND` **only when it names that module** (check the error's `url`/`message` contains `subscription-token`; rethrow anything else, so a broken import inside the provider is never swallowed). No other file — including `auth/index.ts` — may import `subscription-token.ts` statically (re-export only its types via `import type` if needed, or nothing). Add `kernel/tsconfig.distribution.json` = `{ "extends": "./tsconfig.build.json", "exclude": ["src/auth/subscription-token.ts"] }`. Probe result: personal build emits `auth/subscription-token.js` and the registry offers `["api-key","sub"]`; distribution build emits no such file, contains no `loomwright-studio-oauth` string, and the registry offers `["api-key"]`; vitest on source resolves the dynamic import to the `.ts` file. `availableProviderIds()` and `selectAuthProvider(id, deps)` are async; an unavailable id throws `AuthProviderError` (`code: "unavailable"`).
- **The `STUDIO_DISTRIBUTION=1` flag (AC6):** add `kernel/scripts/build.mjs` (plain Node, no dependency) and point `"build"` at it: it removes the out dir first (a stale personal `dist/auth/subscription-token.js` must never survive into a distribution build), then runs `tsc -p tsconfig.distribution.json` when `process.env.STUDIO_DISTRIBUTION === "1"`, else `tsc -p tsconfig.build.json`, via `execFileSync(process.execPath, [<resolved typescript bin>, ...])` or the local `node_modules/.bin/tsc` — no shell. It accepts `--out-dir <dir>` (default `dist`) so the test can build into a `mkdtemp` dir. CI's existing `npm run build` + `node dist/daemon.js --version` smoke keep working unchanged (personal build) — verify by running both locally. Test: run `node scripts/build.mjs --out-dir <tmp>` with `STUDIO_DISTRIBUTION=1` in the child env, then assert (a) no `auth/subscription-token.js` under `<tmp>`, (b) no file under `<tmp>` contains `loomwright-studio-oauth`, (c) the built registry, loaded in a **plain Node child** (`node --input-type=module -e '…'` with `cwd: <tmp>`, printing JSON), reports `availableProviderIds()` without `subscription-token` and `selectAuthProvider("subscription-token", …)` rejecting with code `unavailable`; and the same build WITHOUT the flag DOES emit the file and the child sees `subscription-token` (control). Do NOT import the built output into the vitest process: vitest's module runner reports a missing module differently from Node, and the registry's narrow catch must be tested against Node's real `ERR_MODULE_NOT_FOUND`. `<tmp>` is a `mkdtemp` dir outside `kernel/`, so write `{"type":"module"}` to `<tmp>/package.json` before loading, and keep `registry.js`'s runtime import graph free of bare-package imports: `metadata.ts`/`notify.ts`/providers import `Store` with `import type` only (node: builtins are fine). This test spawns `tsc`; give it a generous per-test timeout (e.g. 60 s).
- **AC7 guard test:** (a) a test reads every `.ts` file under `kernel/src/auth/` and asserts exactly one imports `node:child_process` (`keychain.ts`) and that its only binary is `/usr/bin/security` — scoped to `auth/` on purpose: item 05 will legitimately spawn the CLI from `kernel/src/sessions/`, and a repo-wide "one spawn site" assertion would force that item to loosen a security test; (b) a repo-wide check that no string literal in any `.ts` file under `kernel/src/` contains `setup-token` or `auth login` (comments may mention `claude setup-token`, so check string literals, not raw text).
- **ESM conventions in this package:** relative imports use the `.js` suffix, type-only imports use `import type` (`verbatimModuleSyntax`), `noUncheckedIndexedAccess` is on, strict mode. Every store-using test opens its own `mkdtemp` data dir via `new Store({ dataDir })` and closes it in `afterEach` (copy the pattern from `kernel/test/store.test.ts`).
- **No SDK import, no session code** (item 05), no live test in this job (backlog rule: unit tests never call the SDK or a model; live tests are opt-in `STUDIO_LIVE=1`). No GUI (phase 5). No Bedrock/Vertex providers (out of scope).

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Auth providers, Keychain module, credential strip, metadata migration, compile-out build, tests | AC 1–7 | 4 modify, 14 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts

```yaml
# Subtask 1 — auth providers (LAUNCHABLE)
provides:
  - {kind: "file", path: "kernel/src/auth/index.ts"}
  - {kind: "file", path: "kernel/src/auth/types.ts"}
  - {kind: "file", path: "kernel/src/auth/keychain.ts"}
  - {kind: "file", path: "kernel/src/auth/credential-env.ts"}
  - {kind: "file", path: "kernel/src/auth/token-shape.ts"}
  - {kind: "file", path: "kernel/src/auth/metadata.ts"}
  - {kind: "file", path: "kernel/src/auth/subscription-token.ts"}
  - {kind: "file", path: "kernel/src/auth/api-key.ts"}
  - {kind: "file", path: "kernel/src/auth/registry.ts"}
  - {kind: "file", path: "kernel/src/auth/notify.ts"}
  - {kind: "file", path: "kernel/src/store/migrations/002_auth_providers.ts"}
  - {kind: "file", path: "kernel/tsconfig.distribution.json"}
  - {kind: "file", path: "kernel/scripts/build.mjs"}
  - {kind: "file", path: "kernel/test/auth.test.ts"}
  - {kind: "file", path: "kernel/test/auth-distribution.test.ts"}
  - {kind: "symbol", path: "kernel/src/auth/types.ts", name: "AuthProvider"}
  - {kind: "symbol", path: "kernel/src/auth/credential-env.ts", name: "stripCredentialEnv"}
  - {kind: "symbol", path: "kernel/src/auth/registry.ts", name: "selectAuthProvider"}
  - {kind: "symbol", path: "kernel/src/auth/notify.ts", name: "checkAuthHealth"}
requires: []
lanes:
  - "kernel/src/auth/**"
  - "kernel/src/store/migrations/**"
  - "kernel/scripts/**"
  - "kernel/test/**"
  - "kernel/tsconfig.distribution.json"
  - "kernel/package.json"
external_requires: []
```

Modified files: `kernel/src/auth/index.ts` (was `export {}`), `kernel/src/store/migrations/index.ts` (append migration 2), `kernel/package.json` (`build` script only — no dependency changes, so `package-lock.json` is untouched), `kernel/test/store.test.ts` (migration-1 exact-set test pinned to `[initial]`, plus a default-list assertion — see Implementation Notes).

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | — | none | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `unit-testing` (vitest, injected Keychain stub, `mkdtemp` stores, child-process build test), `error-handling` (typed `AuthProviderError`/`KeychainError` that never carry the secret). Read `CLAUDE.md` invariants 3/6, `docs/ARCHITECTURE.md` §Auth, `docs/DECISIONS.md` D15/D16/D27/D29, `docs/OPEN_QUESTIONS.md` Q2/Q4 findings |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): a static import of `subscription-token.ts` anywhere silently re-includes it in the distribution build | HIGH | Non-literal dynamic import in `registry.ts` only (probed); the AC6 test builds with the flag and asserts the file and the Keychain item name are absent, with a no-flag control |
| Feasibility (Phase 2.5): Keychain prompts / access under launchd unverified | LOW (here) | Out of scope (item 09); all Keychain calls live in `keychain.ts`, behind an injectable `KeychainReader` |
| The token leaks through an error object (`execFileSync` errors carry stdout/stderr) or `util.inspect` of a provider | HIGH | Wrap every Keychain failure in a new `KeychainError` built from service + exit status only; never cache the secret on the provider; the AC3 leak test feeds a fake stderr containing the token |
| A stray credential variable outside the explicit list reroutes billing | MEDIUM | `ANTHROPIC_*` prefix rule + explicit `CLAUDE_CODE_*` list grounded in the bundled CLI's own variable names; the list is a frozen exported constant tested entry by entry |
| Stale `dist/auth/subscription-token.js` survives into a distribution build | MEDIUM | `scripts/build.mjs` removes the out dir before every build |
| Tests touch the real Keychain or `~/.loomwright-studio` | MEDIUM | Injected `KeychainReader` stub + injected exec for the CLI wrapper; every store test uses its own `mkdtemp` dir |
| Committing the engine's tracked run file with the feature | MEDIUM | Stage explicit `kernel/` paths only |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-02-04-auth-providers.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-02T02:11:18Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/11
- **Branch:** feature/phase1-04-auth-providers
- **Files changed:** 20
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** kernel/src/auth/ — AuthProvider interface, subscription-token and api-key providers over one /usr/bin/security Keychain module, credential-env stripping, whole-token shape check, migration 2 auth_providers with expiry + once-per-UTC-day notify event, and a STUDIO_DISTRIBUTION=1 build that leaves the subscription provider out. Self-heal fixed a reproduced HIGH in the build out-dir delete guard twice (string compare → realpath segments → {dev, ino} identity); rubric 6/6; 6 MEDIUM/LOW findings dismissed for owner decision.

## Not verified
- **real /usr/bin/security Keychain read (both items)** — brief forbids unit tests reading the real Keychain; only the injected-exec path is exercised (subtask 1)
