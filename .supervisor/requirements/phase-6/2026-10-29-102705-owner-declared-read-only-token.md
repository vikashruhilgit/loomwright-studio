# 14 — The owner declares a token read-only when GitHub can't say so

## Status: ready

**Priority:** MVP · ROADMAP phase 6 (unblocks the live exit run) · D9, D12, D27 (pattern), invariants 3, 5, 6

**As** the owner,
**I want** to connect my fine-grained GitHub token by confirming, in the Connect sheet, that every permission I gave it is Read,
**so that** the phase 6 live run can start, while Studio records that the read-only claim is mine and not GitHub's.

## Problem

The connector refuses every real token `token_permissions_unknown` (item 03's fail-closed revision): the real client reports `permissions: null` because GitHub publishes no permissions for a fine-grained token. Probe p12 (`probes/p12-github-token-permissions.mjs`, run by the owner 2026-10-29 with a token selecting only `vikashruhilgit/loomwright-studio`) confirmed it:

- **(a) No permissions source.** `x-oauth-scopes` was `null` on both calls. `x-accepted-github-permissions` named what each endpoint needs (`/user`: `allows_permissionless_access=true`; `/user/repos`: `metadata=read`), not the token's grants. Nothing else in either response describes the token.
- **(b) Expiry parses.** `github-authentication-token-expiration: 2026-11-28 08:24:18 UTC`; the client's `parseTokenExpiration` reads it as `2026-11-28T08:24:18.000Z`.
- **(c) The reach list is wider than the selection.** `GET /user/repos` returned 57 repos: the one selected plus every public repo the account owns. None of the account's 18 private repos appeared (checked against `gh repo list`, 75 repos, 18 private). GitHub's token page says the same: "Also includes public repositories (read-only)".

So no real token can connect and the live run cannot start (`docs/OPEN_QUESTIONS.md`, "Phase 6 exit: live run (item 13, owner)").

## Owner decisions (2026-10-29, binding)

- **Fallback = the owner's declaration (option A).** The owner chose it over keeping the refusal, after the p12 result. A GitHub App connect, whose installation tokens do report their permissions, comes after phase 6 (`.supervisor/requirements/github-app/`) and keeps this token path alongside it.
- **The declaration is recorded as the owner's, never as verified.** Nothing may present a declared token as GitHub-checked.
- **No inference.** The kernel still never infers permissions, least of all from a write attempt, and adds no write probe.
- Every phase 6 owner decision in items 01–13 stays as it is, item 03's "write-scoped tokens are refused" included: a client that does report a write permission still refuses `token_write_scoped`.

## Scope

1. **Record p12 in `docs/OPEN_QUESTIONS.md`** with the date and the evidence above (a, b, c), tick the "how does GitHub expose a fine-grained token's permissions?" entry with the answer, and note the owner's fallback.
2. **Kernel, connector** (`kernel/src/integrations/github/connector.ts`, `routes.ts`, `kernel/src/integrations/cli.ts`):
   - `POST /connectors/github/token` and `studio connectors github set` accept an explicit owner declaration (e.g. `{token, declared_read_only: true}`; the CLI asks for it after reading the token, never from argv). Without it, a token whose permissions are unknown is still refused `token_permissions_unknown`, with the fix naming the declaration.
   - With it, the connector validates the rest as today (user, expiry, reachable repos), writes the Keychain item and the row with `connected`, `permissions: null` and a source field saying the permissions were **declared by the owner** at `<time>` (a schema change only if the row has no fitting column; follow item 01's migration pattern).
   - A client that reports permissions keeps the current path: all read ⇒ connected (source: reported); any write ⇒ `token_write_scoped`. The declaration never overrides a reported write permission.
   - The `connector_status` event names the source. No token in any response, log line or event (re-test every path).
3. **App, Connect sheet** (`app/src/screens/integrations/ConnectSheet.tsx`, `IntegrationsView.tsx`): a required confirmation the owner ticks before Connect ("This is a fine-grained token, and every permission I gave it is Read"), and the connected state shows "Permissions: read-only, declared by you" instead of a checked list. The `token_permissions_unknown` copy now points at the confirmation.
4. **Mockup first (D9).** Add the confirmation and the "declared by you" connected state to the Integrations mockup source in `docs/design/` (light and dark), and note it in `docs/DESIGN.md` "Phase 6: Integrations". The owner approves on this item's PR.
5. **Docs:** `docs/architecture/integrations.md` (the lifecycle and refusals table: the declaration, the source field, that the reach list includes every public repo the account owns), the runbook's prerequisite 1 (`docs/evidence/phase-6-exit-runbook.md`: now the owner's declaration step at Connect), and the live harness's stage 1 check (`kernel/test/phase-6-exit-live.test.ts`: a declared token passes "every permission read-only" only as `declared`, recorded so in the evidence).

## Non-goals

- The GitHub App connect (its own backlog).
- Any write call to GitHub, or any permission inference.
- Narrowing the reach list to the selected repos (GitHub's `/user/repos` cannot; the App's installation repos can).

## Acceptance criteria

- [ ] Given a real-shaped token whose permissions are unknown and no declaration, then it is refused `token_permissions_unknown`, nothing is written, and the fix names the declaration.
- [ ] Given the same token with the owner's declaration (route and CLI), then the Keychain item is written and the row reads `connected` with `permissions: null` and the owner-declared source and time; no response, log line or event contains the token.
- [ ] Given a client reporting any write permission, with or without a declaration, then it is refused `token_write_scoped` and an existing good token stays in place.
- [ ] Given `studio connectors github set` with the declaration as an argv flag only and no prompt answer, then it does not connect (the declaration is asked interactively, like the token).
- [ ] The Connect sheet cannot submit until the confirmation is ticked; the connected state says the permissions were declared by the owner; light and dark match the approved mockup.
- [ ] p12's results are recorded in `docs/OPEN_QUESTIONS.md` with the date and evidence.

## Validation (must pass before merge)

- `cd kernel && npm ci && npm run typecheck && npm test`
- `cd app && npm ci && npm run typecheck && npm test`
- `bash scripts/check-docs.sh`

## Assumptions

- The owner's declaration is honest; a write-capable token declared read-only is stored. Bounded by: the client sends GETs only, to `api.github.com` only; the kernel strips GitHub token variables from every session environment; sessions reach GitHub only through the read-only kernel tools.

## Risks

- A declared token shown anywhere as "verified". Test every surface (route, CLI, screen, event, evidence file) for the declared wording.

## Depends on
2026-10-24-095103-the-github-connector-token-validation-and-reachable-repos.md
2026-10-24-095111-the-integrations-screen.md

## Touches
kernel/src/integrations/github/connector.ts
kernel/src/integrations/github/routes.ts
kernel/src/integrations/cli.ts
kernel/test/integrations-github-connector.test.ts
kernel/test/phase-6-exit-live.test.ts
app/src/screens/integrations/ConnectSheet.tsx
app/src/screens/integrations/IntegrationsView.tsx
app/src/screens/integrations/connect-sheet.test.tsx
docs/design/mockups/integrations.html
docs/DESIGN.md
docs/architecture/integrations.md
docs/evidence/phase-6-exit-runbook.md
docs/OPEN_QUESTIONS.md

<!-- loomwright:requirement-closeout -->
## Status: done
- **Completed:** 2026-10-29T11:54:39Z
- **Brief:** .supervisor/jobs/done/2026-10-29-owner-declared-read-only-token.md
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/162
