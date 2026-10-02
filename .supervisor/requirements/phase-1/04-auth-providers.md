# 04: Pluggable auth providers (subscription token, API key)

## Status: ready

**Priority:** MVP

## Story

As the kernel, I want a pluggable auth provider that builds each session's environment, so that sessions run on the owner's subscription token in full isolation today (D27), and on an API key later without code changes (D16), and so that no stray credential ever changes billing silently (Q2).

## Acceptance criteria

1. **Given** the `AuthProvider` interface, **when** it's inspected, **then** it exposes `id`, `account` (a label, never a secret), `buildEnv(baseEnv) → env`, and `health() → ok | missing | invalid_shape | expiring(days)`.
2. **Given** the `subscription-token` provider, **when** `buildEnv` runs, **then** it:
   - reads the token from the macOS Keychain item `loomwright-studio-oauth` (via `security find-generic-password -w`, with no shell interpolation);
   - sets `CLAUDE_CODE_OAUTH_TOKEN`;
   - **removes** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK` and any other credential variable from the env.

   Tests prove a stray key in the parent env never reaches the child.
3. **Given** a stored value that isn't a whole token, **when** `health()` runs, **then** it returns `invalid_shape`. A whole token has the `sk-ant-oat01-` prefix, is more than 80 characters, and has no whitespace (the 59-character cut-off token of 2026-09-30 is the test case). The token value never appears in logs, events, errors or test snapshots; a test greps captured output for the prefix.
4. **Given** a recorded token creation date, stored alongside as non-secret metadata, **when** fewer than 30 days remain of the one-year life, **then** `health()` returns `expiring(days)` and the kernel emits a notify event.
5. **Given** the `api-key` provider, **when** `buildEnv` runs, **then** it sets `ANTHROPIC_API_KEY` from the Keychain item `loomwright-studio-api-key` and removes `CLAUDE_CODE_OAUTH_TOKEN`. It's tested with a stubbed Keychain only (invariant 6).
6. **Given** a build flag `STUDIO_DISTRIBUTION=1`, **when** the kernel is built, **then** the `subscription-token` provider is not included (D29), and a test asserts it can't be selected.
7. Studio never runs `claude auth login`, `setup-token`, or any browser login flow (invariant 6). Token creation remains the owner's manual step.

## Out of scope

Bedrock and Vertex providers. A GUI token-entry screen (phase 5; it must reuse the check in AC 3).

## Dependencies

03 (reads and writes the provider metadata and events).

## Risks

Keychain access prompts under launchd are unverified (item 09). Keep all Keychain calls in one module so item 09 can adjust them.

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-02T02:11:18Z
- **Brief:** .supervisor/jobs/done/2026-10-02-04-auth-providers.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/11
