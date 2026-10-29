# 05 — App: connect through a GitHub App from the Integrations screen

## Status: done (superseded on 2026-10-29 by the /product-owner rewrite: _BACKLOG-2026-10-29-174816-github-app-connect.md)

**Priority:** MVP of the GitHub App backlog · D9 (polish gate), invariant 7

**As** the owner,
**I want** to choose "Install GitHub App" in the Connect sheet and finish in my browser with two clicks,
**so that** connecting GitHub with verified read-only access needs nothing typed.

## Problem

The Connect sheet (`app/src/screens/integrations/ConnectSheet.tsx`) has only the paste-a-token path (with phase 6 item 14's declaration). Items 03 and 04 give the kernel the App connect and its setup flow; the app has no way to start or show them.

## Owner decisions (2026-10-29, binding)

Recorded 2026-10-29 after probe p12 showed GitHub reports no permissions for a fine-grained token. Each item carries this copy. Every phase 6 decision (items 01–14) and invariants 1–9 stay as they are, except where a line below says it supersedes one.

- **Studio gets a GitHub App connect, beside the token path.** The owner's reason: an installation token's permissions and repos are reported by GitHub, so read-only is proven rather than declared; installation tokens expire after an hour; and a later posting phase gets a `<app>[bot]` identity instead of the owner's account.
- **Order: after phase 6.** Phase 6's live run uses the owner-declared token (phase 6 item 14). This backlog runs after phase 6 closes and before any posting phase.
- **Keep both paths.** The Connect sheet offers "Install GitHub App" (suggested, permissions verified by GitHub) and "Paste a token" (owner-declared). Neither replaces the other.
- **Setup = the GitHub App Manifest flow.** Studio opens github.com in the system browser with the app pre-filled (private, no webhook, `Pull requests: Read`, `Contents: Read`, `Metadata: Read`); the owner clicks Create, then picks repos and clicks Install. Studio receives and stores the app's key itself; the owner never downloads a key file. Those two clicks stay the owner's (consent to create an app on their account, and to choose its repos).
- **Supersedes item 03's "Studio never runs an OAuth flow" and its non-goal "GitHub Apps".** The manifest flow is not a login and reuses no `gh` credential, but it is a browser round-trip that returns a secret to Studio. Item 01 of this backlog records it as a new D-entry in `docs/DECISIONS.md`, and `docs/architecture/integrations.md` is updated to match.
- **Read-only still.** The App's permissions are read-only; any installation token reporting a write permission is refused `token_write_scoped`, as for a token. Raising the App's permissions is a later phase's decision.
- **The one non-GET call.** Minting an installation token (`POST /app/installations/{id}/access_tokens`) and the manifest conversion (`POST /app-manifests/{code}/conversions`) are the only non-GET requests the client may send, both to `api.github.com`, both named in a fixed allowlist; every other method stays refused.

## Scope

1. **The choice** in the Connect sheet, as item 02's approved mockup shows: "Install GitHub App" (suggested) and "Paste a token".
2. **Start:** the Electron main process calls item 04's setup route and opens the returned local URL with `shell.openExternal` (the system browser). The Studio window itself never navigates away (`app/electron/main.ts`'s navigation guard stays as it is).
3. **Progress and result:** the sheet shows the two steps and the in-progress state from the mockup, follows the connector's status through the existing feed or a poll of `GET /connectors`, and lands on the connected state ("Permissions: read-only, checked by GitHub", the installed repos, renewing token expiry). Cancel calls item 04's cancel route. Each refusal shows the mockup's copy, never the kernel's raw message.
4. **Disconnect** for the App method, with the mockup's "also uninstall on GitHub" link.
5. **Tests and e2e:** unit tests for every state; one e2e spec against the fixture kernel for the App path's connected and refused states.

## Non-goals

- Changing the token path beyond showing the choice.
- Branding the browser pages beyond the plain fixed pages item 04 serves (and nothing that looks like "Claude Code", invariant 7).

## Acceptance criteria

- [ ] Choosing "Install GitHub App" opens the system browser at the kernel's local setup page; the Studio window does not navigate.
- [ ] The sheet shows each designed state (in progress, connected, each refusal, kernel unreachable), light and dark, matching item 02's approved mockup (polish gate).
- [ ] Cancel ends the setup window; a later return in the browser is refused.
- [ ] The connected state says the permissions were checked by GitHub and lists only the installed repos.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test`
- `cd app && npm run e2e`
- `bash scripts/check-docs.sh`

## Depends on
2026-10-29-102711-github-app-connect-mockup.md
2026-10-29-102713-github-app-manifest-setup-flow.md

## Touches
app/src/screens/integrations/ConnectSheet.tsx
app/src/screens/integrations/IntegrationsView.tsx
app/src/screens/integrations/connect-sheet.test.tsx
app/src/screens/integrations/integrations.test.tsx
app/electron/main.ts
app/e2e/integrations.spec.ts
app/e2e/fixtures/integrations.ts
