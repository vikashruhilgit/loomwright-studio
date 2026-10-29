# GitHub App 4 — App: connect through a GitHub App from the Connect sheet (wave 2)

## Status: ready

**Priority:** MVP of the GitHub App backlog · wave 2 (parallel with GitHub App 2 and 3) · D9 (polish gate) · invariant 7

**As** the owner,
**I want** to choose "Install GitHub App" in the Connect sheet and finish in my browser with GitHub's two clicks,
**so that** I can connect GitHub with read-only access checked by GitHub, without typing or pasting anything.

## Problem

The Connect sheet (`app/src/screens/integrations/ConnectSheet.tsx`) has only the paste-a-token path, with item 14's declaration. The Studio window can't open the system browser: `app/electron/main.ts` denies every new window and navigation, rightly.

Wave 1 fixed the two owner routes and their types in `app/src/api/contract.ts`, and the approved mockup in `docs/design/mockups/integrations.html`. This item builds the screen against them, using the fixture kernel.

## Owner decisions (binding)

Each item in this backlog carries this copy. Every phase 6 decision (items 01–16) and invariants 1–9 stay as they are, except where a line below says it supersedes one.

Recorded 2026-10-29, after probe p12 showed GitHub reports no permissions for a fine-grained token:

- **Studio gets a GitHub App connect, beside the token path.** The owner's reasons:
  - An installation token's permissions and repos are reported by GitHub, so read-only is proven rather than declared.
  - Installation tokens expire after an hour.
  - A later posting phase gets a `<app>[bot]` identity instead of the owner's account. Posting itself is out of scope here.
- **Keep both paths.** The Connect sheet offers "Install GitHub App" (suggested; permissions checked by GitHub) and "Paste a token" (owner-declared). Neither replaces the other.
- **Setup = the GitHub App Manifest flow.**
  - Studio opens github.com in the system browser with the app pre-filled: private, no webhook, `Pull requests: Read`, `Contents: Read`, `Metadata: Read`.
  - The owner clicks Create, then picks repos and clicks Install. Those two clicks stay the owner's: consent to create an app on their account, and to choose its repos.
  - Studio receives and stores the app's key itself. The owner never downloads a key file.
- **This supersedes phase 6 item 03's "Studio never runs an OAuth flow" and its non-goal "GitHub Apps".** The manifest flow is not a login and reuses no `gh` credential, but it is a browser round trip that returns a secret to Studio. It is recorded as a new D-entry in `docs/DECISIONS.md` (wave 1).
- **Read-only still.** The App's permissions are read-only. Any installation token reporting a write permission is refused `token_write_scoped`, as for a token. Raising the App's permissions is a later phase's decision.
- **Two allowlisted non-GET calls.** The client may send only two requests that are not GET, both to `api.github.com`, both in a fixed allowlist:
  - minting an installation token, `POST /app/installations/{id}/access_tokens`;
  - the manifest conversion, `POST /app-manifests/{code}/conversions`.

  Every other method stays refused.

Recorded 2026-10-29 with the owner, after probe p13 (`docs/OPEN_QUESTIONS.md`, "GitHub App connect"):

- **GitHub accepts loopback return addresses.** It accepts `redirect_url` and `setup_url` on `http://127.0.0.1:<port>` (the loopback API), and it returns the `state` on both the create and the install returns.
- **No webhook block.** The manifest carries no `hook_attributes`, because GitHub refuses a loopback webhook URL even when inactive. Studio polls, as today.
- **The single-use `state` and the setup window are the gate.** The `state` shows in the browser's address bar and history, so it is spent on its first use. Each setup window is single-use and short-lived, and at most one is open at a time.
- **The secrets.** The conversion's secrets are `pem` and `client_secret`. Studio keeps the `pem` in the Keychain, and never stores, logs or returns `client_secret`. No item uses `client_secret`.
- **Repo list.** The mint response carries no repo list. The reach list is `GET /installation/repositories`, which lists exactly the repos chosen at install.
- **App-only setup, no CLI setup verb.** Setup starts only from the app's Connect sheet. `studio connectors github status` still shows the method and the permissions' source.
- **Shape:** two waves.
  - Wave 1 is this backlog's contract, decision and mockup item.
  - Wave 2 is three items in parallel: kernel tokens, kernel setup flow, and the app's Connect sheet. They have disjoint Touches and build against the wave 1 contract.

## Scope

1. **The choice:** "Install GitHub App" (suggested) and "Paste a token", exactly as the approved mockup shows. The token path's behaviour is unchanged.
2. **Opening the browser.** Add one narrow main-process channel (`app/electron/channels.ts`, `preload.ts`, `main.ts`). It opens a URL in the system browser with `shell.openExternal`, **only** if the URL is the kernel's own loopback address with the setup start path.
   - It refuses anything else.
   - The Studio window's navigation guard and window-open denial stay as they are.
3. **Start.** The sheet calls `POST /connectors/github/app/setup`, then opens the returned `setup_url` through that channel.
4. **Progress and result.**
   - The sheet shows the mockup's two steps (Create, Install) with Cancel and "Open GitHub again".
   - It follows the connector through the existing event feed, or a poll of `GET /connectors`.
   - It lands on the connected state: "Permissions: read-only, checked by GitHub", the installed repos, and the token's renewing expiry.
   - Cancel calls `POST /connectors/github/app/setup/cancel`.
   - Each refusal shows the mockup's copy for its reason, never the kernel's raw message.
5. **Disconnect** for the App method, with the mockup's "also uninstall on GitHub" link. The link opens through the same narrow channel, which also allows `https://github.com/settings/installations` and `https://github.com/settings/apps/<slug>`.
6. **The fixture kernel** (`app/e2e/fixtures/integrations.ts`) answers the two owner routes and serves App connector rows, so unit tests and one e2e spec cover every state.
7. **Docs:** `docs/architecture/app.md` (the open-external channel and its allowlist).

## Non-goals

- Any kernel code (GitHub App 2 and 3). Restyling the browser pages the kernel serves. Changing the token path beyond showing the choice.
- Anything that says or looks like "Claude Code" (invariant 7).

## Acceptance criteria

**Happy path:**
- [ ] Given the sheet, when the owner chooses "Install GitHub App", then the app calls the setup route and opens `setup_url` in the system browser, and the Studio window doesn't navigate.
- [ ] Given the fixture kernel moving the row to `connected` with `method: app`, then the sheet shows "Permissions: read-only, checked by GitHub" and lists only the installed repos.
- [ ] Given every designed state (choice, in progress, connected, each refusal, disconnect, kernel unreachable), then each matches the approved mockup in light and dark (polish gate). The e2e spec captures the App path's connected and refused states.

**Edge cases:**
- [ ] Given Cancel, then the cancel route is called and the sheet returns to the choice.
- [ ] Given "Open GitHub again", then the same `setup_url` reopens. Given an expired window, the sheet shows the setup-expired state and offers a fresh start.

**Error scenarios:**
- [ ] Given the open-external channel called with any URL off its allowlist, then it refuses and opens nothing (unit test in `app/electron`).
- [ ] Given each refusal reason in wave 1's list, then the sheet shows the mockup's copy, never the raw kernel message.
- [ ] Given the kernel unreachable, then the sheet shows the mockup's unreachable state.

## Validation (must pass before merge)

- `cd app && npm ci && npm run typecheck && npm test`
- `cd app && npm run e2e`
- `bash scripts/check-docs.sh`

## Risks

- **The open-external channel is a new way out of the app.** It's bounded by an exact allowlist, and red-teamed in review.
- **The real flow depends on GitHub App 2 and 3.** This item is complete against the fixture kernel. The real flow is proven at the plan doc's live check.

## Depends on
2026-10-29-174812-github-app-contract-decision-and-mockup.md

## Touches
app/src/screens/integrations/ConnectSheet.tsx
app/src/screens/integrations/IntegrationsView.tsx
app/src/screens/integrations/model.ts
app/src/screens/integrations/actions.ts
app/src/screens/integrations/commands.ts
app/src/screens/integrations/integrations.css
app/src/screens/integrations/connect-sheet.test.tsx
app/src/screens/integrations/integrations.test.tsx
app/src/screens/integrations/model.test.ts
app/electron/channels.ts
app/electron/preload.ts
app/electron/main.ts
app/electron/main.test.ts
app/electron/preload.test.ts
app/e2e/integrations.spec.ts
app/e2e/fixtures/integrations.ts
docs/architecture/app.md
