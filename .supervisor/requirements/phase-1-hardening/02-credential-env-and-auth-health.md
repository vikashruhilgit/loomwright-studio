# H02: strip the CLI's OAuth endpoint switches, and make auth health total

## Status: ready

**Priority:** MVP · **Safety kernel (invariant 3)**

## Story

As the owner, I want a session's child CLI to be unable to send my OAuth token anywhere but Anthropic, and the auth health check to report every failure as a status instead of throwing or saying "ok", so that a stray environment variable or a bad metadata row can't leak the token or hide its expiry.

## Evidence (verified against `main` at 4429d4b on 2026-10-03)

- **F04-1 (still present).** `kernel/src/auth/credential-env.ts:25-59` (`CREDENTIAL_ENV_VARS`) contains none of `USE_LOCAL_OAUTH`, `USE_STAGING_OAUTH`, `CLAUDE_LOCAL_OAUTH_API_BASE`, `CLAUDE_LOCAL_OAUTH_APPS_BASE`, `CLAUDE_LOCAL_OAUTH_CONSOLE_BASE` and `CLAUDE_BRIDGE_BASE_URL`. Only the `ANTHROPIC_` prefix and the list are stripped (`:64-66`). All six names appear in the bundled CLI 2.1.284 binary (4–7 occurrences each) and in `sdk.mjs`. The CLI puts them in its own set of sensitive variables, alongside `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `CLAUDE_BRIDGE_SESSION_INGRESS_URL`, `CLAUDE_REMOTE_TOOLS_BRIDGE_URL` and `CLAUDE_CODE_GB_BASE_URL`, which Studio doesn't strip either. The minified code doesn't show whether the public build honours them.
- **F04-2 (partially present).** `types.ts:5` still documents `AuthHealth` as "Exactly four variants". `subscription-token.ts:80` `health()` throws `KeychainError` (`keychain.ts:102`) on any failure other than "not found", and `notify.ts:22` (`checkAuthHealth`) passes it up. `/status` catches it in `safeHealth` and returns `{status:"error"}`, a shape outside `AuthHealth` (`api/server.ts:138-145`).
- **F04-3 (still present, reproduced).** `subscription-token.ts:28-31,85-86`: an unparseable `token_created_at`, or `now = Invalid Date`, yields `{status:"ok"}`, because `NaN < 30` is false. `deps.now` (`:45`) and the `now` argument of `checkAuthHealth` (`notify.ts:20`) are separate clocks. `recordTokenCreated` validates its input (`auth/metadata.ts:26-29`), but the column has no CHECK (`002_auth_providers.ts:20`).
- **F04-4 (still present, reproduced).** `scripts/out-dir-guard.mjs:98-100` checks layer 2 only along `parentChain(realKernel)`. `--out-dir /System/Volumes/Data` and `/System/Volumes` are refused only by layer 5 (the missing build marker). The header at `:5-12` claims the identity check is complete.
- **F04-5 (still present).** `test/build-guard.test.ts` has three gaps:
  - the fresh-checkout refusal of names other than `dist` appears only as the control at `:280`;
  - "a missing path inside kernel/ while dist exists" runs only under `skipIf(!caseInsensitive)` (`:194`);
  - no test covers a dangling `kernel/dist` symlink, which the guard currently treats as a fresh checkout and allows.

## Acceptance criteria

1. **Given** any of the ten variables named under F04-1 in the daemon's environment, **when** a session spawns, **then** the child's environment doesn't contain it. `auth.test.ts` pins each name, and so does the existing test that asserts the strip list.
2. **Given** a Keychain failure of any kind, **when** `health()` runs, **then** it returns an `AuthHealth` value and never throws. Add a typed `error` variant with a reason, and make `types.ts` say what the variants are. `checkAuthHealth` and `/status` use that variant, so `safeHealth`'s out-of-type shape goes away.
3. **Given** an unparseable `token_created_at`, or a non-finite day count for any reason, **when** `health()` runs, **then** it reports a non-`ok` status that names the unreadable date, never `ok`. One clock reaches both `health()` and `checkAuthHealth`.
4. **Given** `out-dir-guard.mjs`, **when** someone reads its header, **then** the header says that a mount or firmlink ancestor (`/System/Volumes/Data`, `/System/Volumes`) is caught only by the layer-5 marker check. A test pins that refusal for `/System/Volumes/Data`. Alternatively, the guard refuses any out-dir whose ancestor chain crosses a device boundary, and a test pins that instead.
5. **Given** `build-guard.test.ts` on a case-sensitive file system (Linux CI), **when** it runs, **then** it covers three cases without a skip:
   - the fresh-checkout refusal of a name other than `dist`;
   - a missing path inside `kernel/` while `dist` exists;
   - a dangling `kernel/dist` symlink, which the guard refuses (fail closed, since a build writing through it could land outside `kernel/`).
6. `docs/OPEN_QUESTIONS.md` records that whether the public CLI honours the OAuth endpoint switches is unverified, and that Studio strips them anyway.

## Out of scope

A token rotation flow. Changing what the API-key provider strips beyond the list above.

## Dependencies

Phase 1 items 01–09 (merged). Independent of H01.

## Risks

- Stripping too much could break the child CLI. Strip only the names listed; the existing session tests must still pass unchanged.
- Never read or log a real token in a test. Use stubs, as item 04 does.

## Source

Dismissed review findings from run `automate-2026-09-30-211858`, re-verified 2026-10-03: `proposed/…--04-auth-providers-6d2a15--dismissed-3db1979d.md` and `proposed/…--04-auth-providers-6d2a15--dismissed-summary.md` entries 1–4.
