# 02 — Mockup: the GitHub App path in the Connect sheet

## Status: done (superseded on 2026-10-29 by the /product-owner rewrite: _BACKLOG-2026-10-29-174816-github-app-connect.md)

**Priority:** MVP of the GitHub App backlog · D9 (mockup first)

**As** the owner,
**I want** to approve how connecting through a GitHub App looks before it is built,
**so that** the screen meets the polish gate and the two paths read clearly side by side.

## Problem

The approved Integrations mockup (`docs/design/`, `docs/DESIGN.md` "Phase 6: Integrations") has one connect path: paste a token. Phase 6 item 14 adds the owner's read-only declaration to it. There is no design for a GitHub App connect.

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

Add to the Integrations mockup source in `docs/design/`, light and dark, every designed state of the App path, and record it in `docs/DESIGN.md`:

1. **The Connect sheet's choice:** "Install GitHub App" (suggested; says permissions are checked by GitHub) and "Paste a token" (says permissions are declared by you).
2. **App setup in progress:** waiting for the owner on GitHub (step 1 of 2, Create; step 2 of 2, Install), with a way to cancel and to reopen the browser page.
3. **Connected through the App:** the app's name, the account, the repos chosen at install, "Permissions: read-only, checked by GitHub", the current token's expiry shown as renewing automatically.
4. **Refusals and failures:** setup expired (the one-hour code, or the setup window closed), GitHub refused the return address, the App reports a write permission (`token_write_scoped`, naming it), the App was uninstalled or its key revoked on GitHub, kernel unreachable.
5. **Disconnect:** what Studio removes (the key from the Keychain) and what the owner removes on GitHub (uninstall or delete the app), with a link.

## Non-goals

- Any app or kernel code (items 03–05).

## Acceptance criteria

- [ ] Every state above exists in light and dark in the mockup source and is listed in `docs/DESIGN.md`.
- [ ] The owner approves the mockup on this item's PR (D9).

## Validation (must pass before merge)

- `bash scripts/check-docs.sh`

## Depends on
2026-10-29-102710-github-app-probe-and-decision.md

## Touches
docs/design/mockups/integrations.html
docs/DESIGN.md
