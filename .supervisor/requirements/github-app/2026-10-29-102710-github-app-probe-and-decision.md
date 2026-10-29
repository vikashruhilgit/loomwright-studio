# 01 — Probe the GitHub App manifest flow and record the decision

## Status: ready

**Priority:** MVP of the GitHub App backlog · invariants 3, 5, 6 · verify before asserting

**As** the owner,
**I want** the manifest flow's real behaviour checked against GitHub before anything is built on it, and the change of course recorded as a decision,
**so that** the App connect is built on what GitHub actually does, not on what its docs seem to say.

## Problem

Item 03 of phase 6 ruled out OAuth flows and GitHub Apps. The owner has now chosen a GitHub App connect set up by the manifest flow. Three things it depends on are unverified (NEEDS VERIFICATION):

1. Whether GitHub accepts a manifest `redirect_url` and `setup_url` on `http://127.0.0.1:<port>` (Studio's loopback API), or needs `localhost`, or refuses plain http.
2. The exact fields `POST /app-manifests/{code}/conversions` returns (expected: `id`, `slug`, `pem`, `client_id`, `client_secret`, `webhook_secret`, `owner`), and how long the code lives (docs: one hour).
3. Whether `POST /app/installations/{id}/access_tokens` returns the token's `permissions`, `repositories` (or `repository_selection`) and `expires_at`, and whether `GET /installation/repositories` lists exactly the repos chosen at install.

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

1. **A probe, `probes/p13-github-app-manifest.mjs`** (owner-run, like p12; not run by CI or tests): it serves one page on `127.0.0.1:<random port>` that posts a manifest (private app, no webhook, the three read permissions, `redirect_url` and `setup_url` on that port, a random `state`) to `https://github.com/settings/apps/new`; receives the redirect with `code`; checks `state`; calls the conversion; prints the returned field **names** and the app's `id`/`slug`, never the `pem` or any secret (it keeps the key only in memory); opens the install page; receives `installation_id`; mints one installation token with a JWT signed from the in-memory key; prints that response's `permissions`, `repository_selection`, `expires_at` and the repo names from `GET /installation/repositories`; then forgets the key. It prints how to delete the probe app afterwards.
2. **Record the result in `docs/OPEN_QUESTIONS.md`** with the date and evidence for each of the three questions. If GitHub refuses a loopback return address, stop and say so: don't invent a workaround (a hosted relay is the owner's decision).
3. **The decision:** add the next D-entry to `docs/DECISIONS.md` recording the owner decisions above (the App connect, both paths, the manifest flow, the two allowlisted non-GET calls, read-only still), and that it supersedes item 03's "never runs an OAuth flow" clause. Update `docs/architecture/integrations.md`'s credential paragraph to point at it.

## Non-goals

- Any kernel or app code (items 03–05).
- Keeping the probe's app: the owner deletes it after the probe.

## Acceptance criteria

- [ ] The probe never prints or writes the `pem`, `client_secret`, `webhook_secret` or an installation token (test with a fake GitHub: assert none appears in stdout/stderr).
- [ ] `docs/OPEN_QUESTIONS.md` records the three answers with the date and evidence, or this item stops and says which one failed.
- [ ] `docs/DECISIONS.md` has the new D-entry; `docs/architecture/integrations.md` names it.

## Validation (must pass before merge)

- `node --check probes/p13-github-app-manifest.mjs`
- `bash scripts/check-docs.sh`

## Risks

- The probe app's key lingering. The probe keeps it in memory only and prints how to delete the app.

## Depends on
.supervisor/requirements/phase-6/2026-10-29-102705-owner-declared-read-only-token.md

## Touches
probes/p13-github-app-manifest.mjs
docs/OPEN_QUESTIONS.md
docs/DECISIONS.md
docs/architecture/integrations.md
