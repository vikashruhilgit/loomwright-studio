# Supervisor Job: H02 — strip the CLI's OAuth endpoint switches, make auth health total, close the build-guard gaps

## Environment
- **Project:** loomwright-studio (repo root)
- **CLAUDE.md:** ✓ Found (fresh — invariant 3 applies: the child's credential environment is part of the fixed safety kernel; invariant 6: tests use stubs, never a real token or the real Keychain)
- **Git:** clean except the automate engine's run file (`.supervisor/automate/automate-2026-10-03-180512.md`, modified) and two untracked owner files (`.supervisor/requirements/h01-launchd-start-failure-and-reinstall-plan.md`, `.supervisor/requirements/phase-1-hardening/_BACKLOG.md`). Never stage any of them in this job; commit with explicit paths only. Branch: main @ b587428
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Node / npm (local):** v22.14.0 (CI: ubuntu-latest — a CASE-SENSITIVE file system with no `/System/Volumes/Data`; `.github/workflows/ci.yml` runs `bash scripts/check-docs.sh`, then in `kernel/` `npm ci`, `npm run typecheck`, `npm test`, `npm run build`)
- **Blockers:** 0 | **Warnings:** 1 (dirty automate trail files — commit with explicit paths only)
- **Source requirement:** .supervisor/requirements/phase-1-hardening/02-credential-env-and-auth-health.md
- **Base commit:** b587428

## Feasibility
- **Verdict:** GO
- Tech stack — GO: strict TypeScript kernel (NodeNext, vitest) plus one plain `.mjs` build script; no new package.
- Dependencies — GO: none new.
- Architecture fit — GO: D15/D16/D27 auth providers (`docs/ARCHITECTURE.md:121-126`), invariant 3. The `/status` body (`docs/ARCHITECTURE.md:116`) changes one field's shape, inside the existing `AuthHealth` union.
- Scope — GO: one worker; ~15 files modified (source, tests, docs), none created.
- Hard blockers — none. All ten F04-1 names are present in the bundled `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` (verified at planning time; all ten sit together on `sdk.mjs:146`, the CLI's sensitive-variable set); whether the public CLI honours them stays unverified (AC6 records that).

## Task
**Goal:** A session's child environment can never carry the CLI's OAuth/bridge endpoint switches; `AuthProvider.health()` is total (every failure is a typed `AuthHealth` value, never a throw and never a false `ok`) and reads ONE clock shared with `checkAuthHealth` and `/status`; the build out-dir guard's header tells the truth about mount/firmlink ancestors and a dangling `kernel/dist` symlink is refused; `build-guard.test.ts` covers its three gaps on a case-sensitive file system without a skip; `docs/OPEN_QUESTIONS.md` records that the switches are stripped though unverified.

## Acceptance Criteria
- [ ] AC1 — Given any of the ten variables `USE_LOCAL_OAUTH`, `USE_STAGING_OAUTH`, `CLAUDE_LOCAL_OAUTH_API_BASE`, `CLAUDE_LOCAL_OAUTH_APPS_BASE`, `CLAUDE_LOCAL_OAUTH_CONSOLE_BASE`, `CLAUDE_BRIDGE_BASE_URL`, `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `CLAUDE_BRIDGE_SESSION_INGRESS_URL`, `CLAUDE_REMOTE_TOOLS_BRIDGE_URL`, `CLAUDE_CODE_GB_BASE_URL` in the daemon's environment, when a session spawns, then the child's environment doesn't contain it. `auth.test.ts` pins each name by a literal list (not only by iterating `CREDENTIAL_ENV_VARS`), and the existing provider strip-assertion test asserts their absence too.
- [ ] AC2 — Given a Keychain failure of any kind, when either provider's `health()` runs, then it returns an `AuthHealth` value and never throws. `AuthHealth` gains a typed `error` variant with a reason; `types.ts` documents every variant. `checkAuthHealth` and `/status` use that variant, so `safeHealth`'s out-of-type `{status: "error"}` shape goes away.
- [ ] AC3 — Given an unparseable `token_created_at`, or a non-finite day count for any reason (including an invalid clock), when `health()` runs, then it reports a non-`ok` status whose reason names the unreadable date — never `ok`. One clock reaches both `health()` and `checkAuthHealth` (and `/status`).
- [ ] AC4 — Given `scripts/out-dir-guard.mjs`, when someone reads its header, then it says a mount or firmlink ancestor (`/System/Volumes/Data`, `/System/Volumes`) is caught only by the layer-5 marker check; a test pins that refusal for `/System/Volumes/Data` (guard called directly, never a real build).
- [ ] AC5 — Given `build-guard.test.ts` on a case-sensitive file system (Linux CI), when it runs, then it covers without a skip: the fresh-checkout refusal of a name other than `dist`; a missing path inside `kernel/` while `dist` exists; and a dangling `kernel/dist` symlink, which the guard refuses (fail closed).
- [ ] AC6 — `docs/OPEN_QUESTIONS.md` records that whether the public CLI honours the OAuth endpoint switches is unverified, and that Studio strips them anyway.

## Implementation Notes (verified at planning time, main @ b587428)
**Files read:**
- `kernel/src/auth/credential-env.ts` (79 lines): `CREDENTIAL_ENV_PREFIX = "ANTHROPIC_"` (:11); frozen `CREDENTIAL_ENV_VARS` (:25-59, grouped with comments); `isCredentialEnvVar` (:64-66); `stripCredentialEnv` (:72-79). Both providers call `stripCredentialEnv` in `buildEnv` (`api-key.ts:50`, `subscription-token.ts:75`), and the session manager builds every child env through `this.#auth.buildEnv(this.#baseEnv)` (`src/sessions/manager.ts:440`, `:969`) — so adding names to the list is the whole fix for AC1.
- `kernel/src/auth/types.ts` (83 lines): `AuthHealth` doc "Exactly four variants" (:5-16), union (:17-21); `AuthProvider.health(): AuthHealth` (:49); `AuthProviderDeps.now` (:63).
- `kernel/src/auth/subscription-token.ts` (89 lines): `tokenDaysLeft` (:28-31) — `Date.parse` of an unparseable string is `NaN`; `health()` (:79-87) — `keychain.read` throws `KeychainError` on any non-"not found" failure (`keychain.ts:97-103`); `days < EXPIRY_WARNING_DAYS` with `NaN` is false ⇒ `{status:"ok"}` (F04-3). `now` is `deps.now ?? (() => new Date())` (:45).
- `kernel/src/auth/api-key.ts` (61 lines): `health()` (:54-59) also calls `keychain.read` unguarded ⇒ throws `KeychainError` too. AC2 covers it.
- `kernel/src/auth/notify.ts` (50 lines): `checkAuthHealth(store, provider, now = () => new Date())` calls `provider.health()` (:22) with no clock, then uses its own `now()` for the row's `at` (:25). Exported from `src/auth/index.ts:22`; no production caller yet (only tests).
- `kernel/src/auth/metadata.ts:20-40`: `recordTokenCreated` validates its input; the column has no CHECK (`src/store/migrations/002_auth_providers.ts:20`). A row written by hand or by a future writer can still hold garbage — hence the reader must be total. (Adding a CHECK is NOT in scope: SQLite can't add one without a table rebuild.)
- `kernel/src/auth/keychain.ts:49-63`: `KeychainError` — message built from service + exit status only, never process output.
- `kernel/src/api/server.ts`: `StatusBody.auth[].health: AuthHealth | { status: "error" }` (:58); `safeHealth` (:138-145) catches and returns `{status:"error"}`; `readStatus(store, authProviders, at, info)` (:162-) already holds one `at: Date` and maps `health: safeHealth(p)` (:186); route doc (:234-235).
- `kernel/src/cli/index.ts:191-193`: `studio status` prints `h.status`, with `expiring (<n> days left)` special-cased.
- `kernel/scripts/out-dir-guard.mjs` (131 lines): header (:5-21) claims identity containment is complete; layer 1 (:93-96) catches only `/` and `parse(existing).root`; layer 2 (:98-102) walks only `parentChain(realKernel)`; the `kernel/dist` probe (:76-83) uses `lstat` and sets `distId` only for a real directory — a dangling symlink leaves `distId === null` with no error; `splitExisting` (:45-59) treats the dangling `kernel/dist` as missing (realpath ENOENT), so `kernelAt === 0 && distId === null` (:114-120) allows `missing === ["dist"]` ⇒ the default build is ALLOWED today through a dangling symlink.
- `kernel/test/build-guard.test.ts` (311 lines): `PROBES` (:37-48); `fakeKernel` (:62-78, creates `kernel/dist/sentinel.txt`); `expectRefused` (:90-98) asserts `kernel/dist/sentinel.txt` exists after a refusal (so it can't be used as-is for a dangling-dist case); the case-insensitive-only "KERNEL/new/dir" case (:194-210); the "/" direct-guard pattern (:157-177, child process importing the guard by URL — the template for AC4's test); the fresh-checkout control (:280-288).
- `kernel/test/auth.test.ts` (818 lines): `PARENT_ENV` (:80-94); `it.each(CREDENTIAL_ENV_VARS)` strip test (:266-269); provider strip assertion (:313-336); the exhaustive `AuthHealth` switch test (:140-160); expiry describe (:457-508, table :481-490); `checkAuthHealth` describe (:518-).
- `kernel/test/api.test.ts:205-232`: expects `{ status: "error" }` for a throwing stub provider.
- `docs/ARCHITECTURE.md:116` (`/status` route), `:121-126` (auth providers); `docs/OPEN_QUESTIONS.md` "Technical: verify, don't assume" (:12-).

**Design (the worker may refine names, not behaviour):**

1. **Strip list (AC1).** Append the ten names to `CREDENTIAL_ENV_VARS` under a new comment group, e.g. `// OAuth and bridge endpoint switches: can send the token to a non-Anthropic host (F04-1). Whether the public build honours them is unverified (docs/OPEN_QUESTIONS.md); stripped anyway.` Exact names, no prefix rule (a `CLAUDE_` prefix would strip legitimate flags). Tests: declare ONE literal array of the ten names in `auth.test.ts` (e.g. `OAUTH_ENDPOINT_SWITCHES`) and a NEW `it.each` over it asserting `isCredentialEnvVar(name)` and `stripCredentialEnv({[name]: "v", PATH: "/bin"})` equals `{PATH: "/bin"}` (a literal list, so deleting a name from the source fails the test). Add ALL TEN names to `PARENT_ENV` (:80-94) with stray values, and in BOTH provider strip assertions — subscription-token (:313-336) and api-key (:366-377) — loop over that same literal array asserting `expect(env).not.toHaveProperty(name)` (with all ten in the input the assertion is not vacuous). Keep the existing "keeps PATH, HOME, feature flags…" expectation (:293-302) green unchanged (do NOT add the new names to the expected output — they are stripped).
2. **Total `health()` with a typed error variant (AC2, AC3).**
   - `types.ts`: add `| { readonly status: "error"; readonly reason: AuthHealthErrorReason }` with `export type AuthHealthErrorReason = "keychain_unreadable" | "token_created_at_unreadable" | "clock_unreadable" | "health_threw";`. Rewrite the doc comment: five variants and the order `health()` decides in — ONE Keychain read yields exactly one of `error/keychain_unreadable` (it threw), `missing` (undefined) or `invalid_shape` (value fails the shape check); then the clock (`error/clock_unreadable`); then the recorded creation date (`error/token_created_at_unreadable`); then `expiring`; else `ok` — and what each reason means. An invalid clock is `error/clock_unreadable` even when no creation date is recorded (the clock is checked before the date; pin it with a test). The api-key provider has no expiry and ignores the clock by design — say so. `health_threw` is used ONLY by `/status`'s defensive wrapper for a provider that still throws (a test stub, a future provider) — say so. The variant never carries a message, Keychain output or the credential.
   - `AuthProvider.health(at?: Date): AuthHealth` — the ONE clock: callers pass the instant they hold; when omitted the provider uses `deps.now()`. Document it on the interface.
   - `subscription-token.ts` `health(at)`: wrap `keychain.read` in try/catch ⇒ any throw ⇒ `{status:"error", reason:"keychain_unreadable"}` (drop the error object entirely — it may hold Keychain output). Missing/invalid shape unchanged. Then: `const instant = at ?? now()` (the factory's `now`, `subscription-token.ts:45`); if `!Number.isFinite(instant.getTime())` ⇒ `{status:"error", reason:"clock_unreadable"}`; if `createdAt` present and `!Number.isFinite(Date.parse(createdAt))` ⇒ `{status:"error", reason:"token_created_at_unreadable"}`; then `days = tokenDaysLeft(...)`; if `!Number.isFinite(days)` ⇒ `token_created_at_unreadable` (belt and braces). A store read that throws (`readProviderMetadata`) ⇒ also `token_created_at_unreadable`. `null`/absent `createdAt` stays `ok` (unknown expiry, documented). Order: Keychain checks come first (a missing token is the more urgent fact), then the clock, then the date.
   - `api-key.ts` `health(_at)`: same Keychain try/catch ⇒ `keychain_unreadable`; it has no expiry so it ignores the clock (accept the param for the interface).
   - `notify.ts` `checkAuthHealth`: `const instant = now(); const health = provider.health(instant);` and use `instant` for the row's `at` and day — one clock. Before anything else, `checkAuthHealth` itself checks `Number.isFinite(instant.getTime())`: invalid ⇒ return `{status:"error", reason:"clock_unreadable"}` and write no row, WITHOUT relying on the provider honouring `at` (a stub or future provider could ignore it and return `expiring`, and `toISOString()` on an invalid date throws `RangeError`). Test it with a stub provider that always returns `expiring`. Update the doc comment.
   - `api/server.ts`: `StatusBody.auth[].health: AuthHealth` (drop the `| { status: "error" }`); `readStatus` passes its `at` to `health(at)`; keep a defensive try/catch (rename e.g. `healthOf(p, at)`) that returns `{status:"error", reason:"health_threw"}` — in-type now, message still dropped. Update the route doc (:234-235).
   - `cli/index.ts:191-193`: print `error (${h.reason ?? "unknown"})` for the error variant — a pre-H02 daemon sends `{status:"error"}` with no reason, and `formatStatus` already tolerates older daemons (`status.kill_unconfirmed ?? []`, :199-200); keep `expiring (<n> days left)`.
   - **Tests (`auth.test.ts`):** extend the exhaustive-switch test (:140-160) with the `error` case; each provider's `health()` with a Keychain stub whose `read` throws `KeychainError` (and, separately, a plain `Error`) ⇒ `{status:"error", reason:"keychain_unreadable"}`, never throws, never contains the stub's message; subscription `health()` with a hand-inserted unparseable `token_created_at` (INSERT directly into `auth_providers` — `recordTokenCreated` refuses it) ⇒ `token_created_at_unreadable`; with `now: () => new Date(NaN)` ⇒ `clock_unreadable`; with `health(new Date(NaN))` ⇒ `clock_unreadable`; one-clock tests: `health(at)` uses `at`, not `deps.now` (provider `now` set far away, `at` 340 days after creation ⇒ `expiring 25`); `checkAuthHealth(store, provider, () => instant)` computes days from `instant` even when the provider's own `deps.now` disagrees, and writes no row for an invalid instant. **Never a real token or the real Keychain** — use the file's existing `stubKeychain` / `WHOLE_TOKEN` stubs.
   - **Tests (`api.test.ts:205-232`):** the throwing stub provider now reports `{ status: "error", reason: "health_threw" }`; add a provider whose `health()` RETURNS `{status:"error", reason:"keychain_unreadable"}` and assert it passes through unchanged; assert the `at` reaching `health` is `readStatus`'s instant (a stub recording its argument). `cli.test.ts`: a status payload with an error health prints `error (keychain_unreadable)`.
   - **Existing assertions this design changes on purpose (update them, never weaken their intent):** `api.test.ts:226` `{ status: "error" }` ⇒ `{ status: "error", reason: "health_threw" }`; the `AuthHealth` "Exactly four variants" doc and test title (:140); **`auth.test.ts` "secret hygiene (AC3)" (:592-668)** — `attempt(() => broken.health())` (:641) stops throwing, so `expect(errors.length).toBeGreaterThanOrEqual(5)` (:649) must become `>= 4` (cutOff/broken/brokenApi/apiWithToken `buildEnv`), PLUS add `attempt(() => brokenApi.health())` and explicit assertions that both `broken.health()` and `brokenApi.health()` equal `{status:"error", reason:"keychain_unreadable"}`. Their returned values still reach the leak haystack via `captured.push(inspect(fn()))`, so the no-leak check keeps covering them; keep `errors.some(e => e instanceof KeychainError)` true (the `buildEnv` calls still throw it).
3. **Out-dir guard (AC4, AC5).**
   - Header (:5-21): state plainly that layers 1 and 2 decide by identity along the root and along kernel/'s own real parent chain only, so a directory that is an ANCESTOR of kernel/ only through a mount or firmlink (`/System/Volumes/Data`, `/System/Volumes` on macOS — kernel/'s real chain runs `/Users/…` → `/`) is not caught by them; it is caught only by layer 5 (non-empty, no build marker). Keep the rest accurate. Add the dangling-symlink rule to the layer list.
   - **Dangling / non-directory `kernel/dist` (AC5):** in the `kernel/dist` probe (:76-83) record whether ANYTHING exists at `kernel/dist` (`lstat` succeeded) as `distExists`. The fresh-checkout allowance (:114-120) must require `!distExists` (nothing at all there), not merely `distId === null`; otherwise refuse, e.g. `"kernel/dist exists but is not a directory (remove the kernel/dist symlink or file, then build again)"`. Justify the rule (header + message) as the guard's own fail-closed contract — anything at `kernel/dist` that is not a real directory is refused whatever the caller does next — NOT as "today's build writes outside kernel/": verified at review, today's `build.mjs:42-43` `rmSync` removes the link itself (doesn't follow it) and then `mkdirSync`, so it never wrote outside kernel/. A `kernel/dist` symlink that resolves to a real directory keeps today's behaviour (refused when inside kernel/, layer 5 outside).
   - **Tests (`build-guard.test.ts`), NO `skipIf`:** (a) fresh checkout (rm `kernel/dist`): `--out-dir build` and `--out-dir dist2` refused "inside the kernel directory", and neither dir created; (b) with `kernel/dist` present: `--out-dir new/dir` (relative, lowercase — runs on Linux) refused "inside the kernel directory", `kernel/new` not created; (c) dangling `kernel/dist` symlink (rm the dir, `symlinkSync(join(root, "nowhere"), join(kernel, "dist"))`): the default build (`[]`) is refused, exit non-zero, the symlink is still a symlink (`lstatSync(...).isSymbolicLink()`), `join(root, "nowhere")` was not created, `kernel/src/sentinel.txt` still exists. `expectRefused` asserts `kernel/dist/sentinel.txt` exists — for (a) and (c) either give it an option to skip that sentinel or assert inline; don't weaken it for the existing callers. Keep the existing `skipIf(!PROBES.caseInsensitive)` cases as they are (they test the case-alias, which only exists there).
   - **AC4 test:** `it.skipIf(!existsSync("/System/Volumes/Data") || process.platform !== "darwin")` (state the skip reason in the title like the others: it's a macOS path) — call `resolveBuildOutDir(kernel, "/System/Volumes/Data")` in a child process exactly like the "/" test (:156-177; NEVER run the real build against it) and assert the message contains `without the .studio-kernel-build marker` (layer 5). Same for `/System/Volumes` if the worker wants. This is the one platform skip in the new tests and it is inherent: the path exists only on macOS.
4. **Docs (AC6, plus the contract change):** `docs/OPEN_QUESTIONS.md` under "Technical: verify, don't assume": a new unchecked item — the bundled CLI 2.1.284 / `sdk.mjs` reads `USE_LOCAL_OAUTH`, `USE_STAGING_OAUTH`, `CLAUDE_LOCAL_OAUTH_{API,APPS,CONSOLE}_BASE`, `CLAUDE_BRIDGE_BASE_URL`, `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `CLAUDE_BRIDGE_SESSION_INGRESS_URL`, `CLAUDE_REMOTE_TOOLS_BRIDGE_URL`, `CLAUDE_CODE_GB_BASE_URL`; the minified code doesn't show whether the public build honours them; Studio strips them from every child environment anyway (`kernel/src/auth/credential-env.ts`), since one of them could send the OAuth token to another host. `docs/ARCHITECTURE.md`: `:116` `/status` — each provider's health is `ok | missing | invalid_shape | expiring(days) | error(reason)`, never a secret; `:121-126` — one sentence that a child environment also loses the CLI's OAuth/bridge endpoint switches, and that `health()` never throws (a Keychain failure or an unreadable creation date is an `error` with a reason, never `ok`). Keep `scripts/check-docs.sh` green.

**Verification the worker runs:** `cd kernel && npm ci && npm run typecheck && npm test && npm run build`; `bash scripts/check-docs.sh` from the repo root.

## Subtask Structure
| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Strip the OAuth/bridge endpoint switches, make `health()` total with one clock and a typed error variant, fix the out-dir guard header + dangling-dist refusal, close the build-guard test gaps, docs | AC 1–6 | ~15 modify, 0 create | unit-testing, error-handling | LAUNCHABLE |

## Subtask Contracts
```yaml
# Subtask 1 — H02 credential env + auth health + build guard (LAUNCHABLE)
provides:
  - {kind: "symbol", path: "kernel/src/auth/credential-env.ts", name: "CREDENTIAL_ENV_VARS"}
  - {kind: "symbol", path: "kernel/src/auth/types.ts", name: "AuthHealth"}
  - {kind: "symbol", path: "kernel/src/auth/types.ts", name: "AuthHealthErrorReason"}
  - {kind: "symbol", path: "kernel/src/auth/notify.ts", name: "checkAuthHealth"}
  - {kind: "symbol", path: "kernel/scripts/out-dir-guard.mjs", name: "resolveBuildOutDir"}
  - {kind: "file", path: "kernel/test/build-guard.test.ts"}
  - {kind: "file", path: "kernel/test/auth.test.ts"}
requires: []
lanes:
  - "kernel/src/auth/**"
  - "kernel/src/api/server.ts"
  - "kernel/src/cli/index.ts"
  - "kernel/scripts/out-dir-guard.mjs"
  - "kernel/test/**"
  - "docs/ARCHITECTURE.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "Bundled @anthropic-ai/claude-agent-sdk sdk.mjs (CLI 2.1.284) reads the ten env names — verified present by grep; whether honoured is unverified (AC6)"
  - "macOS /System/Volumes/Data firmlink volume (AC4 test only; skipped elsewhere)"
```
Modified (est.): `kernel/src/auth/credential-env.ts`, `kernel/src/auth/types.ts`, `kernel/src/auth/subscription-token.ts`, `kernel/src/auth/api-key.ts`, `kernel/src/auth/notify.ts`, `kernel/src/auth/index.ts` (export `AuthHealthErrorReason`), `kernel/src/api/server.ts`, `kernel/src/cli/index.ts`, `kernel/scripts/out-dir-guard.mjs`, `kernel/test/auth.test.ts`, `kernel/test/api.test.ts`, `kernel/test/cli.test.ts`, `kernel/test/build-guard.test.ts`, `docs/ARCHITECTURE.md`, `docs/OPEN_QUESTIONS.md`.

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
- `skills/unit-testing/SKILL.md` — vitest, stub Keychain, temp dirs, child-process guard calls, no real token/Keychain
- `skills/error-handling/SKILL.md` — total functions returning typed failures, never leaking an error object's contents

## Risk Assessment
| Risk | Impact | Likelihood | Mitigation | Source |
|------|--------|-----------|------------|--------|
| Stripping too much breaks the child CLI | MEDIUM | LOW | Exact names only (no new prefix rule); the existing session tests must pass unchanged | Requirement "Risks" |
| A test reads or logs a real token | HIGH | LOW | Stub Keychain only (`stubKeychain`, `WHOLE_TOKEN`); assert the error variant carries no stub message | Requirement "Risks" |
| `health()` swallows an error and the owner never sees the Keychain is broken | MEDIUM | MEDIUM | The failure is a visible `error(keychain_unreadable)` in `/status` and `studio status`, never `ok` | Phase 3 |
| `toISOString()` on an invalid clock throws inside `checkAuthHealth` | MEDIUM | MEDIUM | Health is checked first; an `error` result returns before any row/`toISOString`; a test pins it | Phase 3 (`notify.ts:25`) |
| A guard regression in the AC4 test wipes `/System/Volumes/Data` | HIGH | LOW | Call `resolveBuildOutDir` directly in a child process, never `build.mjs` (same pattern as the "/" test) | Phase 3 (`build-guard.test.ts:156-177`) |
| The dangling-dist fix also refuses a legitimate fresh checkout | MEDIUM | LOW | Allowance needs NOTHING at `kernel/dist`; the existing fresh-checkout control (:280-287) must stay green | Phase 3 |
| `/status` contract change surprises a consumer | LOW | LOW | Only the CLI reads it today (`cli/index.ts:191`); updated in the same PR; documented in ARCHITECTURE.md | Phase 3 |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
/supervisor job: .supervisor/jobs/pending/2026-10-03-h02-credential-env-and-auth-health.md

## Outcome
- **Status:** completed
- **Completed:** 2026-10-04T01:32:04Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/25
- **Branch:** feature/hardening-h02-credential-env-auth-health
- **Files changed:** 15
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Ten OAuth/bridge endpoint switches stripped from every child env; AuthHealth gains a typed error variant (keychain_unreadable | token_created_at_unreadable | clock_unreadable | health_threw), health(at?) is total and shares one clock with checkAuthHealth and /status; out-dir guard header corrected and a dangling kernel/dist refused; three unskipped build-guard tests; docs. Phase 4.5 review PASS on the first pass (1 MEDIUM + 1 pre-existing HIGH + 3 LOW dismissed below the fix floor).

## Not verified
- **GET /status and studio status against a real daemon with a real Keychain failure** — stubs only per invariant 6; no live daemon run (subtask 1)
- **whether the public CLI honours the ten OAuth/bridge switches** — needs a probe session aimed at a local listener; recorded as open in docs/OPEN_QUESTIONS.md (subtask 1)
