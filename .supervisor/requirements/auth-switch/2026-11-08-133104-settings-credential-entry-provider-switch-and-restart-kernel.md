# Auth 4 — Settings: enter a credential, switch the auth provider, restart the kernel

**As** the owner of Loomwright Studio,
**I want** Settings → Auth provider to let me save an API key or subscription token, switch the active provider, and restart the kernel,
**so that** I never need a terminal to change how Studio is billed or to recover a stuck kernel.

## Why

Today `app/src/screens/settings/AuthSection.tsx` is read-only and shows terminal commands. D42 (Auth 2) allows write-only credential entry, an approved switch, and a Restart kernel control, and draws them in the mockup.

## Acceptance Criteria

**Happy path:**
- [ ] Given the Settings screen, then each provider this build has is listed with an Active badge, credential present/missing, and health (from `GET /settings`).
- [ ] Given I type a key and press Save, then it is sent once to the credential route, the field clears, the row shows `credential present`, and the value is never rendered back, kept in renderer state after the request, written to localStorage, or included in IPC/console logs.
- [ ] Given a credential is present and the provider is not pinned, when I press Switch, then a confirm sheet states the billing change (subscription ↔ API credits) and that running sessions will be interrupted; confirming records my approval and the screen shows "Switching…" until the kernel reconnects on the new provider.
- [ ] Given I press Restart kernel and confirm (the sheet names how many sessions are running), then the kernel restarts and the shell's reconnect band clears on its own.

**Edge cases:**
- [ ] Given a distributed build, then no subscription-token row and no token field appear (D29).
- [ ] Given `pinned_by` is set, then Switch is disabled with a line naming the pin and how to remove it.
- [ ] Given the kernel is unreachable, then Save and Switch are disabled and Restart kernel stays available.
- [ ] Given a switch is pending in the approvals queue (requested by Wright), then Settings shows it and links to it.

**Error scenarios:**
- [ ] Given the kernel refuses a save (`invalid_shape`, `keychain_write_failed`), then the field keeps focus, shows the refusal in words, and the value is cleared from memory.
- [ ] Given the kernel comes back with the new provider unhealthy, then the row shows the health and an offer to switch back.

**Always:**
- [ ] No OAuth button, no "Sign in" wording, nothing that looks like Claude Code (invariants 6 and 7).
- [ ] Every new control has a ⌘K command in `app/src/screens/settings/commands.ts` (Restart kernel; Switch to <provider>).

## Non-goals
- Kernel behaviour (Auth 3).
- Showing, copying or exporting a stored credential.
- Any login flow.

## Owner decisions
- 2026-11-08: credentials may be entered in the app and saved to the Keychain; switch through the approval path; add a restart kernel control.

## Priority: MVP
**Rationale:** The user-facing half the owner asked for.

## Assumptions
- Restart kernel runs from the Electron main process against the launchd service (works even when the kernel does not answer); the exact call is the implementer's, behind a preload bridge.
- The existing first-run setup steps (`SETUP_STEPS` in `app/src/shell/KernelStates.tsx`) stay for a kernel that has never started.

## Dependencies
- Depends on: Auth 2
- Blocks: none

## Risks
- A secret in the renderer: the value must leave memory right after the request; review the IPC path for logging.
- Restart from the app when the service is not installed (dev run): the control must say so instead of failing silently.

## Validation (must pass before merge)
1. **Static — app tests:** unit tests for `AuthSection` states (present/missing, pinned, distributed build, unreachable) and a test that the saved value is absent from the store and DOM after save.
2. **Static — e2e:** `app/e2e/settings.spec.ts` against the fixture kernel covers save, switch with confirm, pinned, and restart.
3. **Running system — the owner's app:** on the installed service, save a key, switch to `api-key`, see the band clear and Active move; restart the kernel from Settings; screenshots under `docs/evidence/`.

## Depends on
2026-11-08-133104-decision-and-contract-for-switching-auth-in-the-app.md

## Touches
app/src/screens/settings
app/src/shell/KernelStates.tsx
app/src/api/contract.ts
app/electron/main.ts
app/electron/channels.ts
app/electron/kernel-connection.ts
app/e2e/settings.spec.ts
app/e2e/fixtures/settings.ts

## Status: done_with_escalation — ABANDONED (replaced by D42 as built in PR #292 (owner-click switch, no token field, refused while sessions run))
