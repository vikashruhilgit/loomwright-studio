# Auth 2 — Decision D42 and the contract for entering credentials and switching the auth provider in the app

**As** the owner of Loomwright Studio,
**I want** the decision to allow credential entry, provider switching and a kernel restart from the app written down, with its kernel and app contract and mockup, before anything is built,
**so that** the two build stories (Auth 3 kernel, Auth 4 app) build against one agreed shape and the settled decisions it changes are superseded explicitly, not silently.

## Why

Today Settings → Auth provider is read-only by approved design: `docs/DESIGN.md` ("no secret field, no OAuth button and no sign-in of any kind") and phase 7 item 08's non-goal "Changing the auth provider or entering any credential in the app". The provider is fixed at kernel start (`--auth-provider` > `STUDIO_AUTH_PROVIDER`, baked into the launchd plist by `kernel/src/service/launchd.ts:169` > build default, `kernel/src/kernel.ts:132`). Switching means a terminal and `studio service install`. The owner wants it in the app (2026-11-08). Precedent: D36 superseded phase 6's "never runs an OAuth flow" the same way.

## Acceptance Criteria

**The decision (`docs/DECISIONS.md`, D42):**
- [ ] D42 states: the app may take an API key (any build) and a subscription token (personal build only, D29) as **write-only** input saved straight to the Keychain items `loomwright-studio-api-key` / `loomwright-studio-oauth`; the value is never shown back, never logged, never held in the renderer's store after save, and never sent anywhere but the Keychain.
- [ ] D42 states: switching the active provider is a **kernel action applied by the kernel** (added to `KERNEL_APPLIED_ACTIONS`) and always needs the owner's approval; Wright may request it (held), and the owner's confirmed click in Settings is recorded as the owner's approval of that action (one code path, one audit trail).
- [ ] D42 states: the app has a **Restart kernel** control; restart stops running sessions gracefully first (they end `interrupted`, resumable per invariant 2).
- [ ] D42 names what it supersedes: the `docs/DESIGN.md` read-only/no-secret-field rule for the Auth section and phase 7 item 08's non-goal; and what it does **not** change: invariant 6 (no claude.ai sign-in, no OAuth button, no login flow — pasting a token created with `claude setup-token` in the owner's own terminal is entry, not login), D29 (no token field and no `subscription-token` option in a distributed build), D15 (choosing `api-key` on the personal build is the owner's policy per switch, invariant 1; the default stays `subscription-token`), D24/D28 unchanged.
- [ ] D42 names Auth 1's real-key probe as its pending evidence; the result is added to D42 when Auth 1 lands (Auth 3 cannot merge before then).

**The contract (`docs/ARCHITECTURE.md` §Auth and `docs/architecture/app.md`):**
- [ ] `GET /settings` gains, per provider this build has: `id`, `credential_present` (boolean, never a value), `health`; plus `active` (the running provider id) and `pinned_by` (`"flag" | "env" | null`: set when `--auth-provider` or `STUDIO_AUTH_PROVIDER` fixes the provider, in which case a switch is refused, not silently ignored).
- [ ] A credential write route (owner route, API token required) takes `{provider, value}` once, validates shape before saving (API key prefix; token prefix and length, the Q4 cut-off lesson), returns only `{provider, credential_present, health}`; refusal codes are named (`invalid_shape`, `provider_not_in_build`, `keychain_write_failed`).
- [ ] A switch route and kernel tool (`kernel_auth_switch`, input `{provider}`), held by the approval gate; refusal codes named (`pinned`, `credential_missing`, `provider_not_in_build`, `already_active`).
- [ ] The persisted choice's precedence is written down: `--auth-provider` > `STUDIO_AUTH_PROVIDER` > the owner's persisted choice (data dir) > build default.
- [ ] Kernel types and stub routes answering `501` land so Auth 3 and Auth 4 can build in parallel.

**The mockup (`docs/design/mockups/gui-v2.html`, `docs/DESIGN.md`):**
- [ ] The Settings Auth section is drawn with: provider list with active badge and credential state, a write-only credential field per provider with Save, a Switch control with its confirm sheet (names the billing change: subscription ↔ API credits, and that running sessions will be interrupted), the pinned state, and a Restart kernel control with its confirm sheet. No OAuth button and no "sign in" wording anywhere.

**Error scenarios:**
- [ ] The contract says what the app shows when the kernel is unreachable (credential save and switch disabled; Restart kernel still offered, since it is the way out of a hung kernel).

## Non-goals
- Building the kernel or app behaviour (Auth 3, Auth 4).
- Bedrock / Vertex providers.
- Any claude.ai login or OAuth flow (invariant 6).
- A dollar budget on the subscription (D24).

## Owner decisions
- 2026-11-08: supersede item 08's non-goal and the DESIGN.md read-only Auth rule through a new decision entry ("Proceed anyway").
- 2026-11-08: the app may accept credentials and save them to the Keychain.
- 2026-11-08: a switch takes effect through the approval path and the kernel applies it; add a kernel restart control in the app.

## Priority: MVP
**Rationale:** Both build stories depend on the shape; settled decisions may only change by an explicit entry (CLAUDE.md).

## Assumptions
- Next free decision number is D42 (last entry today is D41).
- The owner approves the D42 text in review before Auth 3/Auth 4 start.

## Dependencies
- Depends on: none (Auth 1 runs alongside, by the owner)
- Blocks: Auth 3, Auth 4

## Risks
- Secret entry in an Electron renderer widens the surface: the contract must keep the value out of the renderer store, IPC logs and crash reports.
- `pinned_by: env` will be the owner's state today if the service was installed with `STUDIO_AUTH_PROVIDER`; the contract must say how to un-pin (reinstall without it).

## Validation (must pass before merge)
1. **Static — kernel tests and typecheck:** `cd kernel && npm ci && npm test` passes with the new types and `501` stub routes; a test pins the refusal codes and that `GET /settings` never carries a credential value.
2. **Static — app typecheck/tests:** the app's contract types compile and existing Settings tests pass.
3. **Static — docs:** D42 present in `docs/DECISIONS.md`, cross-referenced from `docs/DESIGN.md` and `docs/ARCHITECTURE.md` §Auth.

## Depends on
none

## Touches
docs/DECISIONS.md
docs/DESIGN.md
docs/ARCHITECTURE.md
docs/architecture/app.md
docs/architecture/approvals.md
docs/design/mockups/gui-v2.html
kernel/src/gui/settings.ts
kernel/src/auth/types.ts
kernel/src/approvals/store.ts
app/src/api/contract.ts
