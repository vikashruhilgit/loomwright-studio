# Auth 3 — The kernel saves credentials and applies an approved auth provider switch

**As** the owner of Loomwright Studio,
**I want** the kernel to save a credential I enter to the Keychain and, once I approve a switch, persist the new provider and come back up on it,
**so that** I can move between my subscription and API credits without a terminal or `studio service install`.

## Why

The provider is read only at kernel start and the choice lives in the launchd plist's environment. D42 (Auth 2) defines the routes, the `kernel_auth_switch` kernel-applied action, the precedence and the refusal codes; this story builds them behind the stubs.

## Acceptance Criteria

**Happy path:**
- [ ] Given a well-shaped API key posted to the credential route, then it is saved to `loomwright-studio-api-key`, the response carries only `{provider, credential_present: true, health}`, and no log line, event payload or store row contains the value.
- [ ] Given the personal build and a well-shaped subscription token, then the same holds for `loomwright-studio-oauth`.
- [ ] Given `credential_present` for `api-key`, no pin, and the owner's `once` approval of `kernel_auth_switch {provider: "api-key"}`, then the kernel re-validates (provider in build, credential present, not pinned), persists the choice in the data dir, appends an `auth_switched` event naming the approval and both providers, stops running sessions gracefully (`interrupted`), and is back answering `GET /status` on the new provider within 90 s.
- [ ] Given the kernel restarted after a switch, then `GET /settings` reports `active: "api-key"` and subsequent sessions carry `ANTHROPIC_API_KEY` and no `CLAUDE_CODE_OAUTH_TOKEN`; switching back yields the reverse (the token provider still strips any key, D27).
- [ ] Given a Wright session calls `kernel_auth_switch`, then it is held in the approvals queue like any kernel action and applied only on the owner's approval (invariant 3).

**Edge cases:**
- [ ] Given `STUDIO_AUTH_PROVIDER` or `--auth-provider` is set, then a switch is refused `pinned` with `pinned_by` saying which, and nothing is persisted.
- [ ] Given a distributed build (no `subscription-token` module), then the token credential write and a switch to it are refused `provider_not_in_build`.
- [ ] Given a switch is approved but the credential was removed from the Keychain before apply, then the approval is recorded as decided with `apply_refused: credential_missing` and the kernel keeps running on the old provider.
- [ ] Given the kernel is `kill -9`ed between persisting the choice and restarting, then on the next start it comes up on the persisted choice (no half-switched state).

**Error scenarios:**
- [ ] Given a malformed or truncated value, then the write is refused `invalid_shape` and the existing Keychain item is untouched.
- [ ] Given a value without the `sk-ant-` prefix or of implausible length (for example a password typed in place of the key), when it is written to the `api-key` item, then it is refused `invalid_shape`: `isPlausibleApiKey` is tightened, because today it rejects only empty or whitespace-containing values, so `health()` reported `ok` for a mistyped password (p16 setup, 2026-11-08).
- [ ] Given the new provider fails auth after restart, then sessions end `failed:auth`, the owner is notified (`auth_failed`) within ~2 s of the first `api_retry` 401 (the kernel does not wait out the CLI's 10 retries), and Settings shows the failing provider's health.

## Non-goals
- The app UI (Auth 4).
- Rewriting the launchd plist; the persisted choice lives in the data dir.
- Auto-switching at the cap (D28's per-playbook fallback is unchanged and separate).

## Owner decisions
- 2026-11-08: credentials may be entered in the app and saved to the Keychain; the switch goes through the approval path and the kernel applies it.

## Priority: MVP
**Rationale:** The kernel half of the feature; Auth 4 is UI over it.

## Assumptions
- `KERNEL_APPLIED_ACTIONS` (`kernel/src/approvals/store.ts`) is the right closed set for the switch, as for `kernel_playbook_enable`.
- A self-restart can use launchd (`KeepAlive`), with the exit recorded in `kernel.err.log` as a requested restart, not a failure; the exact mechanism is the implementer's.

## Dependencies
- Depends on: Auth 2 (contract), Auth 1 (real-key probe recorded; this story's merge is the first point a real switch can happen)
- Blocks: none (Auth 4 builds in parallel against Auth 2's contract)

## Risks
- A launchd `ThrottleInterval` of 60 s can delay a restart if the kernel started less than a minute ago; the 90 s bound must hold or the AC changes.
- An approval applied while sessions are mid-push: graceful stop must not lose more than the current step (invariant 2).

## Validation (must pass before merge)
1. **Static — kernel tests:** `cd kernel && npm ci && npm test` with tests for each AC above using stub Keychain and stub providers, including a grep-style test that no event/log/store row contains the posted value.
2. **Running system — live switch on the owner's machine:** under the installed launchd service, approve a switch to `api-key` and back; `studio status` shows each provider active in turn and one session runs on each (evidence JSON under `docs/evidence/`).
3. **Static — prerequisite:** Auth 1's evidence (`docs/evidence/p16-api-key-real-session.json`) is committed, and this story adds the citation to D42.

## Depends on
2026-11-08-133104-decision-and-contract-for-switching-auth-in-the-app.md
2026-11-08-133104-real-api-key-session-probe.md

## Touches
docs/DECISIONS.md
kernel/src/auth/api-key.ts
kernel/src/auth/subscription-token.ts
kernel/src/auth/keychain.ts
kernel/src/auth/provider-env.ts
kernel/src/auth/registry.ts
kernel/src/auth/token-shape.ts
kernel/src/auth/metadata.ts
kernel/src/gui/settings.ts
kernel/src/approvals/store.ts
kernel/src/tools/server.ts
kernel/src/kernel.ts
kernel/src/daemon.ts
kernel/src/daemon-exit.ts
kernel/src/sessions/manager.ts
kernel/test/auth.test.ts
kernel/test/gui-settings.test.ts
kernel/test/approvals.test.ts
kernel/test/auth-distribution.test.ts
