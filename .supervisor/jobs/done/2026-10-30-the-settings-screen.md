# Supervisor Job: The Settings screen (phase 7, item 08)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-30-192357/L6
- **CLAUDE.md:** ✓ Found (fresh: every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (sibling phase 7 items 06 and 07 may run in parallel lanes; this item edits two shared kernel files, `kernel/src/features/contribution.ts` and `kernel/src/api/server.ts`, and one shared app file, `app/src/api/contract.ts`. See Risk Assessment.)
- **Source requirement:** .supervisor/requirements/phase-7/2026-10-30-140008-the-settings-screen.md
- **Base commit:** 78fb740251cbbba04ccf6b596b3484807faffe26

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Kernel: strict TypeScript, vitest. App: React + Electron 44 (`app/package.json` `"electron": "^44.9.2"`), vitest/jsdom, Playwright e2e through `app/e2e/electron-harness.ts`. Both dependencies (item 01 contract and seams, item 02 mockup) are merged at the base commit. |
| 2 | Dependency Availability | GO | The contract declares `SettingsResponse` and `NotifierKind` and keys `"GET /settings"` (`app/src/api/contract.ts`). The fixture kernel already answers `GET /settings` with a canned view (`app/e2e/fixture-kernel.ts`). The kernel part `kernel/src/gui/settings.ts` exists, empty. `chooseNotifier` (`kernel/src/notifications/notifier.ts`), `req.store.dataDir`, `readProviderMetadata` (`kernel/src/auth/metadata.ts`) and `/status`'s `healthOf` / `loomwrightOf` / `safeAccount` (`kernel/src/api/server.ts`) exist. Electron's `app.setLoginItemSettings`, `app.getLoginItemSettings`, `nativeTheme.themeSource` and `shell.openPath` need no new dependency. |
| 3 | Architecture Fit | CAUTION | A contributed route's request (`ContributedRouteRequest`, `kernel/src/features/contribution.ts`) carries the store, clock, sessions and kill-switch view, but not the auth providers or the Loomwright reader that `/status` reads. `GET /settings` needs both, so this item adds one read-only view to the request, built in `server.ts` from `/status`'s own helpers (one Keychain-reading health path, never a second). The app has no preferences store, no theme switch and no login-item code yet: the main process gains them, with new bridge channels. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 3,000 changed lines across about 26 files (kernel route and test about 450; main-process preferences, bridge and tests about 700; screen, unit tests, e2e, fixture and evidence README about 1,900) plus PNGs. Past `context-bound`. Split into three subtasks at the contract boundary. |
| 5 | Hard Blockers | CAUTION | No migration and no credential. The login item on the ad-hoc-signed, unnotarised build is unverified (requirement Assumption, Risk): it is checked in the running app and recorded in `docs/OPEN_QUESTIONS.md`, and the e2e never touches the real login item. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Serve `GET /settings` from the `gui` feature's `settings` part, and replace the Settings placeholder with the real screen built to the GUI v2 mockup (`docs/design/mockups/gui-v2.html`, views `settings-empty`, `-loading`, `-populated`, `-waiting`, `-error`, `-unreachable`): the auth provider read-only with its health, token state and the terminal commands that change it; the data location with Reveal in Finder; and the app's own preferences (launch at login, notifications, theme) kept in the main process. Commit polish-gate screenshots in light and dark.

**Problem Statement:**
The owner needs to check and change how Studio runs without the terminal, except for credentials (D9, D27, D29, invariants 6 and 7).
Currently `GET /status` reports each auth provider's health, but nothing in the app shows the data location, and nothing lets the owner set launch at login, notifications or the theme. The Settings screen is a "coming in this phase" placeholder.
Success looks like a merged PR whose screen shows the active provider, its health and token state with no secret anywhere, reveals the data folder, sets a login item the toggle reads back from the OS, re-themes at once and keeps it on relaunch, keeps working through a kernel outage, updates live, and matches the mockup in both themes.

### Owner decisions (2026-10-30, binding, from the requirement)
- **Hooks is deferred to phase 9.** No Hooks work here.
- **Each screen's kernel routes ride with that screen's item,** against the contract item 01 declares. This item serves only `GET /settings`, in `kernel/src/gui/settings.ts`, with the `SettingsResponse` shape `app/src/api/contract.ts` already declares. It does not change that shape.
- **Settings shows the auth provider read-only.** The active provider, its health and its token's state, plus the terminal commands that change it. No secret entry and never a claude.ai sign-in (invariant 6).
- **One GUI v2 mockup first (D9):** the screen and its polish gate match `gui-v2.html`'s Settings views.
- Non-goals: changing the auth provider or entering any credential in the app; moving the data directory.
- Assumption: Electron's login-item API works for the ad-hoc-signed, unnotarised build. Verify in the running app and record the result.

### Design (binding unless a subtask records why it departs, in the evidence README)

**Kernel route (subtask 1).** Mechanism only (invariant 1). An owner route: it does not set `unauthenticated`. Read-only: nothing is written.
- **The request view.** Add one optional, read-only field to `ContributedRouteRequest` (`kernel/src/features/contribution.ts`), in the `killSwitch` precedent: a `StatusView` with `auth(at: Date)` (each provider's `{id, account, health}`, exactly what `/status` reports) and `loomwright()` (the adapter's state, or `undefined` when the composition has no reader). Type-only imports, so the CLI's module graph does not change. `server.ts` builds it once from its own `healthOf`, `safeAccount` and `loomwrightOf` and the `authProviders` / `loomwrightStatus` it already holds, and spreads it into every contributed request beside `killSwitch`. A provider's `health()` stays the only Keychain read; no second path reads a credential.
- **`GET /settings`** answers `200 SettingsResponse`:
  - `provider`: the first entry of `status.auth(now())` (the kernel composes exactly one, `kernel.ts` `authProviders: [authProvider]`): `id`, `account`, `health`, and `token_created_at` from `readProviderMetadata(req.store, id)?.token_created_at ?? null`. Never a token, key or Keychain output.
  - `data_dir`: `req.store.dataDir`.
  - `notifier`: `chooseNotifier()` mapped `click` → `"terminal-notifier"`, `plain` → `"osascript"`, `none` → `"none"` (a pure, exported mapping function the test exercises with each choice).
  - `loomwright`: `status.loomwright()`.
  - Refusals, never a throw and never a 500 from a handler exception: no `StatusView` on the request, no provider, or no Loomwright reader answers `503 {"error":"settings_unavailable","reason":"<no_status_view|no_auth_provider|no_loomwright_reader>"}`. No value is added to `LoomwrightAdapterStatusReason` or `AuthHealth`.
- Documented in the part file's header comment and in `docs/architecture/app.md` (subtask 2 owns that file).

**Main-process preferences and bridge (subtask 2).** `app/electron/settings.ts` holds them (`main.ts` only wires it).
- **Preferences file:** `prefs.json` in `app.getPath("userData")`: `{ "notifications": boolean, "theme": "system" | "light" | "dark" }`, default `{notifications: true, theme: "system"}`. Read at start; a missing, unreadable or invalid file falls back to the defaults (never a throw) and is rewritten on the next change. Written atomically (temp file, then rename). Never in the kernel's store or data dir. Launch at login is not stored: it is read from the OS each time.
- **Launch at login:** `app.setLoginItemSettings({ openAtLogin })` in the main process; the value the screen shows comes from `app.getLoginItemSettings()` on every read, so it reflects the OS state on reopen. When the OS reports the item needs approval or was refused (macOS 13+ reports a `status`; verify the field name and values on Electron 44 in the running app before relying on them), the bridge returns that state and the screen says so honestly.
- **Theme:** the main process sets `nativeTheme.themeSource` (`"system"`, `"light"`, `"dark"`) at start, before the window is created, and on every change. The renderer's tokens follow `prefers-color-scheme` (`app/src/styles/tokens.css` `@media (prefers-color-scheme: dark)`), so the app re-themes at once with no reload and no edit to `App.tsx` or `main.tsx`; the window's vibrancy follows too. Verify in the running app that `themeSource` drives the renderer's media query; if it does not, set `data-theme` from the preload's first read instead and record why.
- **Reveal in Finder:** opens the main process's own resolved data dir (`resolveDataDir(process.env)`, the one the kernel connection uses) with `shell.openPath`. The renderer sends no path: a path from the renderer is never opened.
- **Bridge:** new invoke channels in `CHANNELS` and `INVOKE_CHANNELS` (`app/electron/channels.ts`): `studio:prefs:get`, `studio:prefs:set`, `studio:reveal-data-dir`, each handled only for the owner window (`fromOwner`, as every other handler). `studio:prefs:set` validates its patch (known keys and values only; anything else is refused with `false` / the unchanged state, never a throw). The preload adds one optional member to `StudioBridge` (`app/src/api/contract.ts`): `prefs?: AppPreferencesBridge` with `get(): Promise<AppPreferences>`, `set(patch): Promise<AppPreferences>` and `revealDataDir(): Promise<boolean>`, where `AppPreferences` is `{ launchAtLogin: { enabled: boolean; status: string | null }, notifications: boolean, theme: "system" | "light" | "dark" }`. Still exactly one key, `api`, on `window`, and no key names `token`, `ipc`, `require` or `process`.
- **Test seams (unpackaged builds only, the `tokenReaderFor(process.env, app.isPackaged)` precedent):** `STUDIO_APP_PREFS_DIR` moves `prefs.json`; `STUDIO_APP_FAKE_OS=1` replaces the login-item calls and Reveal with a fake that records each call in `os-calls.json` beside `prefs.json` and keeps the login-item state there. A packaged build ignores both (a unit test asserts it). No e2e run ever registers a real login item or opens Finder.
- **Notifications preference:** stored and returned as above. The kernel posts its own macOS notifications through its notifier (`kernel/src/notifications/notifier.ts`), which this preference does not reach; no app code posts a notification today. The screen's copy says only what the toggle does (it is the app's own preference), and `docs/OPEN_QUESTIONS.md` records the open owner question of whether it should also gate the kernel's notifier (that would need a kernel write route, out of this item's scope).
- `docs/architecture/app.md` documents the preferences, the three channels, the seams and `GET /settings`. `docs/OPEN_QUESTIONS.md` records the login-item result on the ad-hoc-signed build (or the honest "needs approval" finding) and the notifications question.

**The screen (subtask 3)**, `app/src/screens/settings/`, built to the mockup's `settingsScreen` (gui-v2.html):
- **Auth provider (read-only badge):** Provider (mono id), Account, Health (dot + `ok` / `missing` / `expiring` with days left / `invalid_shape` / `error` with its reason). When a token exists: Token created (from `token_created_at`) and Token life (365 days, days left, end date; `renew soon` badge when `expiring`). A Token row: "Kept in the Keychain as `loomwright-studio-oauth`. The value is never shown, and this app has no field for it." The `expiring` view shows the mockup's attention band, the `missing` view its danger band.
- **Change it in your terminal:** the three commands from `SETUP_STEPS` (`app/src/shell/KernelStates.tsx`, reused, never copied), each with a Copy button. `studio auth …` is not a command and is not shown (DESIGN.md open point 4).
- **Kernel (read-only badge):** Data location (mono path from `data_dir`) with Reveal in Finder (calls `prefs.revealDataDir()`), Notifier (mono kind with the caption "terminal-notifier if installed, else osascript, else none"), Loomwright (the install path when `status: "ok"`, else the error reason).
- **This app (caption "Kept in the app's own settings, not in the kernel"):** Launch at login (`role="switch"`, state from the OS), Notifications (`role="switch"`), Theme (System / Light / Dark buttons with `aria-pressed`, in a labelled group). The mockup's Keyboard map row is left out (no item builds the keyboard map); recorded as a departure.
- **No sign-in control and no secret field:** no `input`, no `textarea`, no control or link whose name matches sign in / log in / claude.ai, and nothing says "Claude Code" (invariants 6, 7).
- **States:** loading (skeleton), populated, empty (`missing`: no token yet), waiting on you (`expiring`), error (a route-failure card naming `settings request` and its status, distinct from the band), kernel unreachable (the shell's shared band; the screen keeps its last data marked "last known" and disables Reveal and every kernel-bound control; the app-preference controls still work because they do not need the kernel).
- **Untrusted text:** account, paths and reasons render as React text, never HTML. The screen renders only the contract's known fields: an extra field in the body (for example a token-shaped string) is never shown or kept.
- **Live:** on a new feed event whose kind starts `auth_` or `loomwright_` (confirm the kinds the kernel appends with a grep of `kernel/src` and list them in `model.ts`), refetch `GET /settings`, throttled, keeping current rows on screen until the answer arrives (no skeleton on refetch, fixed row heights: no layout shift). It edits no shared store file.
- **Keyboard and palette:** every action reachable by Tab / Enter / Space; commands registered under owner `settings` (exported as `SETTINGS_OWNER` from `commands.ts`; the screen's test ids are exported as `SETTINGS_TEST_IDS` from `model.ts`, as `SCHEDULES_TEST_IDS`) with ids `settings.*` while mounted, unregistered on unmount, as `app/src/screens/schedules/commands.ts` does: "Theme: System", "Theme: Light", "Theme: Dark", "Reveal the data folder in Finder", "Turn launch at login on|off", "Turn notifications on|off" (the mockup's palette entries). Reveal is disabled while the kernel is unreachable.
- **Accessibility:** every switch and button has an accessible name, every status dot has text beside it, the sections are labelled (`aria-labelledby` their `h2`/`h3`); colours and spacing from the design tokens only, so both themes meet WCAG 2.1 AA.
- **Shell entry:** `id: "settings"`, `title: "Settings"`, `nav: { label: "Settings", order: 11, shortcut: "⌘," }` kept.

## Acceptance Criteria
- [ ] AC1 — Given a real store and API server (the `kernel/test/gui-schedules.test.ts` set-up) with a stub provider whose token value is a known string, whose `token_created_at` is recorded with `recordTokenCreated`, and a Loomwright reader, when `GET /settings` is called with the API token, then it answers 200 with exactly the keys `provider` (`id`, `account`, `health`, `token_created_at`), `data_dir` (the store's data dir), `notifier` and `loomwright` (the reader's value), and the JSON body never contains the stub's token value; a provider whose `health()` throws reports `{status: "error", reason: "health_threw"}` with 200; a reader that throws reports `status_threw`; a server whose composition has no provider or no reader answers `503 settings_unavailable` with its reason, and the `no_status_view` case is exercised by calling the handler directly with a request literal that has no `status` (a real API server always builds the view); a call without the API token answers 401; and the notifier mapping returns `terminal-notifier`, `osascript` and `none` for `click`, `plain` and `none` (`kernel/test/gui-settings.test.ts`).
- [ ] AC2 — Given the fixture kernel's `GET /settings` (`ok`, `expiring` with days left, and `missing`), when the Settings screen opens, then it shows the provider id, account, health, token created date and days left, the three `SETUP_STEPS` commands with Copy buttons, the data location, notifier and Loomwright install; and given a body that also carries a token-shaped extra field, then that value appears nowhere in the DOM text and nowhere in the renderer's live store (a jsdom test serialises both and searches for it).
- [ ] AC3 — Given the screen in every state, then it has no `input`, no `textarea`, no control or link named sign in / log in / claude.ai, and no text "Claude Code" (a jsdom test asserts each).
- [ ] AC4 — Given launch at login toggled, then the main process calls `app.setLoginItemSettings` with the new `openAtLogin` (`app/electron/settings.test.ts` with Electron mocked), and on reopen the toggle reflects `app.getLoginItemSettings()`, not a stored value (the e2e flips it, relaunches with the same `STUDIO_APP_PREFS_DIR` and `STUDIO_APP_FAKE_OS=1`, and reads the switch); a "needs approval" or refused OS state is shown as such; and a packaged build ignores both seams (unit test). The result on the real ad-hoc-signed build is recorded in `docs/OPEN_QUESTIONS.md`.
- [ ] AC5 — Given a theme change, then the main process sets `nativeTheme.themeSource` at once and the renderer re-themes without a reload (the e2e reads `matchMedia("(prefers-color-scheme: dark)").matches` before and after Dark, then Light), and on relaunch with the same prefs dir the theme is applied before the window shows (the e2e relaunches and reads it again).
- [ ] AC6 — Given Reveal in Finder (button or palette command), then the main process opens its own resolved data dir and the renderer sends no path (unit test: the channel ignores any argument; e2e: `os-calls.json` records one reveal of the fixture's data dir). Given the notifications switch, then the preference is written to `prefs.json` and survives a relaunch.
- [ ] AC7 — Given the kernel unreachable while the screen holds data, then the shared band shows, the screen keeps its last data marked "last known" with Reveal disabled, the app-preference controls still work, and nothing throws (a jsdom test in `SettingsScreen.test.tsx` and an e2e step that closes the fixture kernel).
- [ ] AC8 — Given the keyboard only, then every action on the screen (each Copy, Reveal, both switches, the three theme buttons) is reachable by Tab / Enter / Space, and the ⌘K palette lists the screen's `settings.*` commands while it is mounted and not after it unmounts.
- [ ] AC9 — Given a live event on the feed that changes what the screen shows (the fixture kernel's `appendEvent` of an `auth_` or `loomwright_` kind, with `GET /settings` then answering the new view), then the screen updates without a reload and the bounding boxes of the rows already shown do not move (the e2e compares them before and after).
- [ ] AC10 — Given VoiceOver, then every control and status has an accessible name (the e2e checks each switch, button and status with `getByRole`), and both themes meet WCAG 2.1 AA contrast: only design tokens are used for colour, a `contrast.test.ts` (as `app/src/screens/schedules/contrast.test.ts`) checks the screen's text/background token pairs in light and dark, and the evidence README records the result.
- [ ] AC11 — The polish gate: a committed evidence file `docs/evidence/phase-7-polish/settings/README.md` lists one light and one dark screenshot (PNG files in that folder, each a relative link that `bash scripts/check-docs.sh` resolves) of every state the mockup shows for this screen, each named against its mockup state (`settings-empty`, `settings-loading`, `settings-populated`, `settings-waiting`, `settings-error`, `settings-unreachable`); the exact command that regenerates them (`SETTINGS_EVIDENCE=1`, as `SCHEDULES_EVIDENCE=1` in `app/e2e/schedules.spec.ts`); and every departure from the mockup and why (at least: no Keyboard map row, no `studio auth` command, the notifications copy). The PR body links to it and may embed the screenshots.
- [ ] AC12 (owner gate, not worker-satisfiable) — The owner's approval of the PR is the polish gate (D9). Supervisor and `/review-pr` never merge it. The evidence is the owner's GitHub approval, not the PR body.
- [ ] AC13 — Validation passes: `cd app && npm ci && npm run typecheck && npm test && npm run build`; `cd app && npx playwright test e2e/settings.spec.ts e2e/smoke.spec.ts` (launched only through `app/e2e/electron-harness.ts`; subtask 2 runs `e2e/smoke.spec.ts` after `npm run build`, since CI runs the whole suite); `cd kernel && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh` prints `check-docs: OK`.

**Evidence rule:** AC10's contrast record and AC11 rest on the committed `docs/evidence/phase-7-polish/settings/README.md`; AC4's login-item finding rests on `docs/OPEN_QUESTIONS.md`. FINALIZE lists the evidence README in the PR body's `## Evidence` section and may embed screenshots, but the PR body is never their only home.

## File Impact Map

| Path | Action | Lines at base | Confidence | Home / note |
|------|--------|---------------|------------|-------------|
| `kernel/src/gui/settings.ts` | MODIFY (17) | 17 | HIGH | The item's own part: the `GET /settings` handler, the notifier mapping and the refusals (estimated 100–150 lines). Imports `chooseNotifier` (`../notifications/notifier.js`) and `readProviderMetadata` (`../auth/metadata.js`); nothing that loads the Agent SDK, the session manager or `kernel.ts`. |
| `kernel/src/features/contribution.ts` | MODIFY (623) | 623 | HIGH | Past the 500-line threshold; appended because it is the single authority for the request shape: one `StatusView` interface and one optional `status?` field beside `killSwitch?` (about 20 lines, type-only imports). |
| `kernel/src/api/server.ts` | MODIFY (914) | 914 | HIGH | Past the threshold; appended because `healthOf`, `safeAccount` and `loomwrightOf` live here and must stay the one health path: build the frozen view next to `const killSwitch` and spread it into the request beside `...managed` (about 10 lines). No logic moves. |
| `kernel/test/gui-settings.test.ts` | CREATE | — | HIGH | AC1, against a real store and API server (the `gui-schedules.test.ts` set-up). |
| `app/electron/settings.ts` | CREATE | — | HIGH | The preferences file, login item, theme, Reveal, the three IPC handlers and the unpackaged-only seams (estimated 200–250 lines). |
| `app/electron/settings.test.ts` | CREATE | — | HIGH | AC4–AC6 main-process side, Electron mocked as `app/electron/main.test.ts` does. |
| `app/electron/main.ts` | MODIFY (163) | 163 | HIGH | Wire `app/electron/settings.ts`: apply the theme before `createWindow`, register its handlers with the same `fromOwner` check. |
| `app/electron/main.test.ts` | MODIFY (283) | 283 | HIGH | The channel-list pin gains the three channels; the Electron mock gains `nativeTheme`, `shell.openPath`, `app.getPath`, `app.getLoginItemSettings` / `setLoginItemSettings`. |
| `app/electron/preload.ts` | MODIFY (32) | 32 | HIGH | The `prefs` member. |
| `app/electron/preload.test.ts` | MODIFY (91) | 91 | HIGH | The key pin gains `prefs` (and its three methods); the forbidden-name check keeps passing. |
| `app/e2e/smoke.spec.ts` | MODIFY (79) | 79 | HIGH | Pins the built preload's exact key list (`api: ["connection", "feed", "onNavigate", "openExternal", "request"]`); gains `"prefs"` in sorted place. CI runs the whole e2e suite (`npm run e2e`), so a missed edit fails CI. |
| `app/electron/channels.ts` | MODIFY (23) | 23 | HIGH | Three channels in `CHANNELS` and `INVOKE_CHANNELS`. |
| `app/src/api/contract.ts` | MODIFY (1401) | 1401 | HIGH | Past the threshold; appended because it is the single authority for every app/kernel and bridge shape: `AppPreferences`, `AppPreferencesBridge`, and `prefs?` on `StudioBridge` (about 30 lines). `SettingsResponse` is unchanged. |
| `app/src/store/fake-bridge.ts` | MODIFY (94) | 94 | HIGH | An in-memory `prefs` fake the jsdom tests drive. |
| `docs/architecture/app.md` | MODIFY (121) | 121 | HIGH | Document the preferences, channels, seams and `GET /settings`. |
| `docs/OPEN_QUESTIONS.md` | MODIFY (141) | 141 | HIGH | The login-item result on the ad-hoc-signed build; the notifications-preference scope question. |
| `app/src/screens/settings/index.tsx` | MODIFY (17) | 17 | HIGH | Swap the placeholder for the real Component; keep id, title, nav label, order and shortcut. |
| `app/src/screens/settings/SettingsScreen.tsx` | CREATE | — | HIGH | The screen (sections, states, switches, theme group). Estimated 350–450 lines; if it passes 500, move the auth section into `AuthSection.tsx` in the same directory. |
| `app/src/screens/settings/model.ts` | CREATE | — | HIGH | Pure logic, no React: health label and tone, token life and days left, the live-refetch kind test, test ids table. |
| `app/src/screens/settings/commands.ts` | CREATE | — | HIGH | Palette commands, modelled on `app/src/screens/schedules/commands.ts`. |
| `app/src/screens/settings/settings.css` | CREATE | — | HIGH | Screen styles from tokens only. |
| `app/src/screens/settings/SettingsScreen.test.tsx` | CREATE | — | HIGH | jsdom: states, no secret, no sign-in, unreachable keeps data, palette register/unregister, live refetch, untrusted text literal. |
| `app/src/screens/settings/model.test.ts` | CREATE | — | HIGH | Unit tests for health, token life and refetch kinds. |
| `app/src/screens/settings/contrast.test.ts` | CREATE | — | HIGH | AC10 token pairs, as `app/src/screens/schedules/contrast.test.ts`. |
| `app/e2e/settings.spec.ts` | CREATE | — | HIGH | Playwright e2e through `launchApp` only; screenshots to the evidence dir only with `SETTINGS_EVIDENCE=1`, and a last test that fails if a tracked evidence file changed during a run without it (as `app/e2e/schedules.spec.ts`). Every launch sets `STUDIO_APP_PREFS_DIR` to a temp dir and `STUDIO_APP_FAKE_OS=1`. |
| `app/e2e/fixtures/settings.ts` | CREATE | — | HIGH | The screen's fixture views (`ok`, `expiring`, `missing`, error) and events; `app/e2e/fixture-kernel.ts` is not edited. |
| `docs/evidence/phase-7-polish/settings/README.md` | CREATE | — | HIGH | Polish-gate evidence (AC10, AC11), in the form of `docs/evidence/phase-7-polish/schedules/README.md`. |
| `docs/evidence/phase-7-polish/settings/*.png` | CREATE (~12) | — | MEDIUM | `settings-<state>-<light\|dark>.png`. Binary outputs no worker reads. |

Reference only, not modified: `app/src/shell/KernelStates.tsx` (`SETUP_STEPS`, the band), `app/src/styles/tokens.css` (theme selectors), `app/electron/kernel-connection.ts` (`resolveDataDir`, `tokenReaderFor`, `FIXTURE_TOKEN_ENV`), `kernel/src/notifications/notifier.ts` (`chooseNotifier`, `NotifierChoice`), `kernel/src/auth/metadata.ts` (`readProviderMetadata`, `recordTokenCreated`), `kernel/src/loomwright/active-install.ts` (`LoomwrightAdapterStatus`), `kernel/test/gui-schedules.test.ts` and `kernel/test/session-fakes.ts` (`stubProvider`), `app/e2e/fixture-kernel.ts`, `app/e2e/schedules.spec.ts` (evidence pattern), `app/src/screens/schedules/*` (commands, contrast and live-refetch patterns), `app/src/store/react.ts`, `app/src/components/*`, `docs/design/mockups/gui-v2.html` (`settingsScreen`, the `settings-*` views, the palette's Settings entries), `docs/evidence/gui-v2-mockup/README.md` (Settings field map), `docs/DESIGN.md` (open point 4).

Not touched: `kernel/test/gui-foundation.test.ts` (its pins are generic since wave 1: "the generic pins below hold for each without an edit here"), `kernel/test/console-contract.test.ts` (a declared companion of `contract.ts`, but its pins read routes and origins, which this item does not change; the bridge types are not routes), `app/e2e/fixture-kernel.ts`, `app/e2e/electron-harness.ts`, `app/src/App.tsx`, `app/src/main.tsx`, `app/src/store/resources.ts`, `docs/ARCHITECTURE.md`, `docs/UI.md`, `docs/DESIGN.md`.

Validator-owned surfaces: `scripts/check-docs.sh` checks every relative link in `docs/**/*.md`, so the evidence README's PNG links and any link added to `app.md` or `OPEN_QUESTIONS.md` must resolve.

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `kernel/src/store/migrations/001_initial.ts:9` | yes | HOLDS | ` * hooks_installed and connectors arrive with their phases, so columns that will` | tip 70 minutes ago, fetched <1h |

### Blast-Radius / Impact Prediction

| Touched Subsystem | Depends On | Depended-on-by | Source Contract | Incident History |
|-------------------|------------|----------------|-----------------|------------------|
| `kernel/src/api/server.ts` | `kernel/src/api/kill-switch.ts`, `kernel/src/auth/types.ts`, `kernel/src/budget/index.ts`, `kernel/src/loop/loop.ts`, `kernel/src/sessions/manager.ts`, `kernel/src/sessions/orphans.ts`, `kernel/src/sessions/types.ts`, `kernel/src/store/store.ts` | `kernel/src/cli/index.ts`, `kernel/src/kernel.ts`, `docs/ARCHITECTURE.md` | none | none |

**Predicted ripple:** the added request field is optional and spread like `killSwitch`, so `kernel.ts` and the CLI need no change; `kernel/test/api.test.ts` (which pins `health_threw` and `status_threw` on `/status`) must stay green unchanged.

## Touched-file invariants

> Grounded at base `78fb740251cbbba04ccf6b596b3484807faffe26`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`kernel/src/gui/settings.ts`** — keep: the exported names and part shape, `export const settingsRoutes: readonly ContributedRoute[]` and `export const settingsPart: GuiPart = Object.freeze({` with `name: "settings"` (re-exported by `kernel/src/gui/index.ts` as `export { settingsPart, settingsRoutes } from "./settings.js";`); routes only (no tools, subcommands, handlers or due work: `kernel/test/gui-foundation.test.ts` `holds no tools, subcommands, handlers or due work in any part`); no route sets `unauthenticated` (`serves no gui route unauthenticated`); frozen arrays and objects. Keep the import rule in `kernel/src/gui/types.ts`: "nothing here may pull in the Agent SDK, the session manager or `kernel.ts`" (`kernel/test/feature-seams.test.ts` throws `SDK_IN_GRAPH`). reuse: the `{ status, body: { error } }` refusal shape of the sibling parts (`kernel/src/gui/schedules.ts`), `chooseNotifier`, `readProviderMetadata`. mirror: `app/src/api/contract.ts` `export interface SettingsResponse {` and `export type NotifierKind = "terminal-notifier" | "osascript" | "none";` exactly (field names and nullability). pinned by: `kernel/test/gui-foundation.test.ts` and the new `kernel/test/gui-settings.test.ts`.
- **`kernel/src/features/contribution.ts`** — keep: every existing request field and its doc; the optional-field rule the file states for `sessions`: `still typechecks.` and `Optional in the type for the same reason as`; the read-only-view precedent `readonly killSwitch?: KillSwitchView;` (the new view exposes reads only, never a credential or a provider object). Type-only imports only (`import type`), because the `studio` CLI loads this module (`kernel/test/feature-seams.test.ts`). pinned by: `kernel/test/feature-seams.test.ts`, `kernel/test/api.test.ts`.
- **`kernel/src/api/server.ts`** — keep: `/status`'s body and helpers unchanged, `function healthOf(provider: AuthProvider, at: Date): AuthHealth {` with `// The message is dropped: it could carry Keychain output.`, and `auth: authProviders.map((p) => ({ id: p.id, account: safeAccount(p), health: healthOf(p, at) })),`; reuse those helpers for the view (never a second health or account read). mirror: the request extras pattern `const managed = options.sessionManager === undefined ? {} : { sessions: options.sessionManager };` and `...managed,`, and the frozen view `const killSwitch: KillSwitchView = Object.freeze({ state: () => killSwitchState(store) });`. pinned by: `kernel/test/api.test.ts` (`health_threw`, `status_threw`).
- **`app/electron/main.ts`** — keep: every handler refuses another sender, `if (!fromOwner(event)) throw new Error("refused");`; the window's security options (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, pinned by `app/electron/main.test.ts`); `session.defaultSession.setPermissionRequestHandler((_contents, _permission, decide) => decide(false));`; the data dir from `dataDir: resolveDataDir(process.env),`; the packaged/unpackaged rule `readToken: tokenReaderFor(process.env, app.isPackaged),` (the new seams follow it). pinned by: `app/electron/main.test.ts` (`handles exactly the bridge's channels, and refuses a caller that is not its window`).
- **`app/electron/channels.ts`** — keep: `export const INVOKE_CHANNELS: readonly string[] = [` lists exactly the channels the main process handles; the comment "The renderer never names a channel itself: it calls `window.api`." pinned by: `app/electron/main.test.ts`, `app/electron/preload.test.ts`.
- **`app/electron/preload.ts`** — keep: `contextBridge.exposeInMainWorld("api", api);` as the only exposure, each method forwards over `ipcRenderer.invoke` and hands the renderer no channel, event or Node API. pinned by: `app/electron/preload.test.ts` `expect(electron.exposed.map((e) => e.key)).toEqual(["api"]);`, `expect(Object.keys(api).sort()).toEqual(["connection", "feed", "onNavigate", "openExternal", "request"]);` (extended with `prefs`) and `.not.toMatch(/token|ipc|require|process/i)`; and by `app/e2e/smoke.spec.ts` `expect(exposed).toEqual({ api: ["connection", "feed", "onNavigate", "openExternal", "request"], require: "undefined", process: "undefined" });` (the built preload, extended with `"prefs"`).
- **`app/electron/main.test.ts`, `app/electron/preload.test.ts`, `app/e2e/smoke.spec.ts`** — keep: every existing assertion; extend the channel and key lists, never loosen them to a subset check.
- **`app/src/api/contract.ts`** — keep: `export interface SettingsResponse {` unchanged and the route map line `"GET /settings": Route<NoQuery, undefined, SettingsResponse>;`; the new bridge member is optional, in the precedent `openExternal?(url: string): Promise<boolean>;` ("Optional so a bridge without it (a test fake) compiles"). Companion: `kernel/test/console-contract.test.ts` reads this file's routes and must stay green unedited.
- **`app/src/store/fake-bridge.ts`** — keep: `export function fakeBridge(initial: KernelConnectionState = { state: "connected", port: 1 }): FakeBridge {` and every existing member's behaviour (every screen's jsdom tests use it).
- **`app/src/screens/settings/index.tsx`** — keep: `id: "settings"`, `title: "Settings"`, `nav: { label: "Settings", order: 11, shortcut: "⌘," },` and `export const screen: ScreenDefinition = {` (pinned by `app/src/App.test.tsx` `"Settings⌘,"` and `["screens.settings", "Screens", "⌘,"]`, and by its `screen-${id}` test-id check, so the screen's root keeps `data-testid="screen-settings"`). The shell renders the one `h1` (`<h1 className="titlebar-title">{current.title}</h1>` in `app/src/App.tsx`), so the screen renders no `h1`. Leave `app/src/screens/placeholder.tsx` in place.

## Closed enumerations touched

> Sibling grep at base `78fb740251cbbba04ccf6b596b3484807faffe26`: `grep -rnF 'studio:open-external' --exclude-dir=node_modules .` → 6 hits in 4 files (outside `.supervisor/`); `grep -rnF '"openExternal", "request"' app docs` → 2 hits in 2 files.

- **`studio:prefs:get`, `studio:prefs:set`, `studio:reveal-data-dir`** (sibling: `studio:open-external`) — must be named in:
  - `app/electron/channels.ts` — `CHANNELS` and `export const INVOKE_CHANNELS: readonly string[] = [` — extend.
  - `app/electron/main.test.ts` — the handled-channel list in `handles exactly the bridge's channels, and refuses a caller that is not its window` — extend.
  - `app/electron/preload.test.ts` — the invoked-channel list (`{ channel: "studio:open-external", args: [...] }`) — extend with one call per new method.
  - `docs/architecture/app.md` — the bridge's channel prose (`The one way out is the \`studio:open-external\` IPC channel`) and the "Tests:" line — extend (document the three channels).
  - `app/electron/main.test.ts` `electron.handlers.get("studio:open-external")` — no change: a lookup of one channel, not a list.
- **`prefs`** (sibling: `"openExternal", "request"`, the bridge's key list) — must be named in:
  - `app/electron/preload.test.ts` — `expect(Object.keys(api).sort()).toEqual(["connection", "feed", "onNavigate", "openExternal", "request"]);` — extend.
  - `app/e2e/smoke.spec.ts` — `expect(exposed).toEqual({ api: ["connection", "feed", "onNavigate", "openExternal", "request"], ... })` — extend.
- **`settings_unavailable`** with reasons `no_status_view`, `no_auth_provider`, `no_loomwright_reader` — new codes local to `kernel/src/gui/settings.ts` and its test; no existing closed list names gui refusal codes (`SettingsResponse` declares the 200 body only), so no list is extended.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/gui-settings.test.ts` — the body never contains the token value | add the provider object itself as `provider` in the handler's body in `kernel/src/gui/settings.ts` |
| `kernel/test/gui-settings.test.ts` — exactly the contract's keys | add an extra `kernel` key to the body in `kernel/src/gui/settings.ts` |
| `kernel/test/gui-settings.test.ts` — `data_dir` is the store's data dir | return `""` for `data_dir` in `kernel/src/gui/settings.ts` |
| `kernel/test/gui-settings.test.ts` — notifier mapping | flip `"osascript"` → `"none"` in the mapping in `kernel/src/gui/settings.ts` |
| `kernel/test/gui-settings.test.ts` — `token_created_at` from the store | return `null` for `token_created_at` in `kernel/src/gui/settings.ts` |
| `kernel/test/gui-settings.test.ts` — a throwing `health()` reports `health_threw` with 200 | call `provider.health(at)` directly instead of `healthOf` in the view built in `kernel/src/api/server.ts` |
| `kernel/test/gui-settings.test.ts` — no view / provider / reader answers `503 settings_unavailable` | delete the no-reader check in `kernel/src/gui/settings.ts` |
| `kernel/test/gui-settings.test.ts` — 401 without the API token | set `unauthenticated: true` on the route in `kernel/src/gui/settings.ts` |
| `app/electron/settings.test.ts` — toggling calls `setLoginItemSettings` | delete the `app.setLoginItemSettings` call in `app/electron/settings.ts` |
| `app/electron/settings.test.ts` — the toggle reads the OS, not a stored value | return the stored value instead of `app.getLoginItemSettings()` in `app/electron/settings.ts` |
| `app/electron/settings.test.ts` — a packaged build ignores the seams | drop the `isPackaged` check on `STUDIO_APP_PREFS_DIR` in `app/electron/settings.ts` |
| `app/electron/settings.test.ts` — Reveal ignores a renderer-sent path | open the handler's argument instead of the resolved data dir in `app/electron/settings.ts` |
| `app/electron/settings.test.ts` — an invalid prefs patch is refused | write the patch without validating its keys in `app/electron/settings.ts` |
| `app/electron/settings.test.ts` — a corrupt `prefs.json` falls back to defaults | remove the `try` around the prefs file parse in `app/electron/settings.ts` |
| `app/electron/main.test.ts` — refuses a caller that is not its window (new channels) | delete the `fromOwner` check in the prefs handlers |
| `app/electron/preload.test.ts` — exact key list with `prefs` | remove the `prefs` member from `app/electron/preload.ts` |
| `app/e2e/smoke.spec.ts` — the built preload's exact key list with `prefs` | remove the `prefs` member from `app/electron/preload.ts` |
| `app/src/screens/settings/SettingsScreen.test.tsx` — an extra token-shaped field is never shown or kept | spread the whole response body into the held view in `SettingsScreen.tsx` |
| `app/src/screens/settings/SettingsScreen.test.tsx` — no input, sign-in control or "Claude Code" | add an `<input type="password">` to the auth section in `SettingsScreen.tsx` |
| `app/src/screens/settings/SettingsScreen.test.tsx` — unreachable keeps last data | clear the held view when the connection is not live in `SettingsScreen.tsx` |
| `app/src/screens/settings/SettingsScreen.test.tsx` — commands unregister on unmount | delete the unregister call in the commands effect's cleanup in `SettingsScreen.tsx` |
| `app/src/screens/settings/SettingsScreen.test.tsx` — an `auth_`/`loomwright_` event refetches | make the refetch-kind test in `app/src/screens/settings/model.ts` return `false` |
| `app/src/screens/settings/model.test.ts` — days left and `renew soon` | flip `365` → `366` in the token-life computation in `app/src/screens/settings/model.ts` |
| `app/e2e/settings.spec.ts` — rows keep their bounding boxes on a live update | show the loading skeleton on every refetch in `SettingsScreen.tsx` |
| `app/src/screens/settings/contrast.test.ts` — the screen's text/background token pairs meet AA in light and dark | replace one text rule's `var(--…)` colour token with a hard-coded `#999` in `app/src/screens/settings/settings.css` |
| `app/e2e/settings.spec.ts` — the login-item switch reads the (fake) OS state after a relaunch (AC4) | return the stored value instead of the fake-OS login-item state in `app/electron/settings.ts` |
| `app/e2e/settings.spec.ts` — one reveal of the fixture data dir recorded in `os-calls.json` (AC6) | skip writing the reveal record in the fake in `app/electron/settings.ts` |
| `app/e2e/settings.spec.ts` — theme kept on relaunch | delete the startup `nativeTheme.themeSource` assignment in `app/electron/settings.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Kernel: `GET /settings` in the settings part, with the request's status view | AC1, AC13 (kernel) | 3 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | App main process: preferences, login item, theme, Reveal, bridge | AC4, AC5, AC6 (main-process side), AC13 (app unit tests, `e2e/smoke.spec.ts`, check-docs) | 10 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 3 | App: the Settings screen, e2e and polish-gate evidence | AC2, AC3, AC4–AC6 (screen and e2e side), AC7, AC8, AC9, AC10, AC11, AC13 (app, e2e, check-docs) | 1 modify, 10 create (+PNG outputs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #2) |

Subtask 1 never touches the app and subtask 2 never touches the kernel: they meet only through `SettingsResponse`, which is already merged and neither edits. Subtask 3 calls `GET /settings` through the contract (the fixture kernel already answers it) and the preferences through subtask 2's bridge, so it waits for subtask 2. If any subtask finds the contract shape cannot serve an AC, it stops and reports that rather than changing `SettingsResponse`.

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/gui/settings.ts", name: "settingsRoutes"}
  - {kind: "symbol", path: "kernel/src/gui/settings.ts", name: "settingsPart"}
  - {kind: "type", path: "kernel/src/features/contribution.ts", name: "StatusView"}
  - {kind: "file", path: "kernel/test/gui-settings.test.ts"}
requires: []
lanes:
  - "kernel/src/gui/settings.ts"
  - "kernel/src/features/contribution.ts"
  - "kernel/src/api/server.ts"
  - "kernel/test/gui-settings.test.ts"
external_requires:
  - "Node.js and npm (cd kernel && npm ci)"

# Subtask 2
provides:
  - {kind: "file", path: "app/electron/settings.ts"}
  - {kind: "file", path: "app/electron/settings.test.ts"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "AppPreferences"}
  - {kind: "type", path: "app/src/api/contract.ts", name: "AppPreferencesBridge"}
  - {kind: "symbol", path: "app/electron/channels.ts", name: "studio:prefs:get"}
  - {kind: "symbol", path: "app/electron/preload.ts", name: "prefs"}
  - {kind: "symbol", path: "app/src/store/fake-bridge.ts", name: "prefs"}
  - {kind: "symbol", path: "app/e2e/smoke.spec.ts", name: "\"openExternal\", \"prefs\", \"request\""}
requires: []
lanes:
  - "app/electron/settings.ts"
  - "app/electron/settings.test.ts"
  - "app/electron/main.ts"
  - "app/electron/main.test.ts"
  - "app/electron/preload.ts"
  - "app/electron/preload.test.ts"
  - "app/e2e/smoke.spec.ts"
  - "app/electron/channels.ts"
  - "app/src/api/contract.ts"
  - "app/src/store/fake-bridge.ts"
  - "docs/architecture/app.md"
  - "docs/OPEN_QUESTIONS.md"
external_requires:
  - "Node.js and npm (cd app && npm ci); Electron 44 as an app devDependency"
  - "macOS 13 or later to verify the login item on the ad-hoc-signed build (the result goes to docs/OPEN_QUESTIONS.md)"

# Subtask 3
provides:
  - {kind: "file", path: "app/src/screens/settings/SettingsScreen.tsx"}
  - {kind: "file", path: "app/src/screens/settings/model.ts"}
  - {kind: "file", path: "app/src/screens/settings/commands.ts"}
  - {kind: "file", path: "app/src/screens/settings/contrast.test.ts"}
  - {kind: "file", path: "app/e2e/settings.spec.ts"}
  - {kind: "file", path: "app/e2e/fixtures/settings.ts"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/settings/README.md"}
  - {kind: "symbol", path: "app/src/screens/settings/commands.ts", name: "SETTINGS_OWNER"}
  - {kind: "symbol", path: "app/src/screens/settings/model.ts", name: "SETTINGS_TEST_IDS"}
requires:
  - {from: "2", kind: "type", path: "app/src/api/contract.ts", name: "AppPreferences"}
  - {from: "2", kind: "type", path: "app/src/api/contract.ts", name: "AppPreferencesBridge"}
  - {from: "2", kind: "symbol", path: "app/src/store/fake-bridge.ts", name: "prefs"}
  - {from: "2", kind: "file", path: "app/electron/settings.ts"}
lanes:
  - "app/src/screens/settings/**"
  - "app/e2e/settings.spec.ts"
  - "app/e2e/fixtures/settings.ts"
  - "docs/evidence/phase-7-polish/settings/**"
external_requires:
  - "Node.js and npm (cd app && npm ci); Electron and Playwright as app devDependencies; `npm run build` before the e2e"
  - "macOS for the committed screenshots (fonts differ on Linux CI; the spec checks behaviour, never pixels)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 3 ──→ Subtask 2
Subtask 1 (independent)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| 1 (kernel) | 2 (main process) | none | NO |
| 1 (kernel) | 3 (screen) | none | NO |
| 2 (main process) | 3 (screen) | none (3 reads 2's `contract.ts` and `fake-bridge.ts` additions) | YES (`requires`) |

### Batch Plan
- **Batch 1:** subtasks 1 and 2 (parallel)
- **Batch 2:** subtask 3 (after subtask 2)
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` (vitest against a real store and API server), `skills/error-handling/SKILL.md` (typed 503 refusals, a throwing provider or reader never a 500) |
| 2 | `skills/unit-testing/SKILL.md` (Electron mocked as `main.test.ts`), `skills/error-handling/SKILL.md` (corrupt prefs file, refused patch, OS login-item refusal) |
| 3 | `skills/frontend-ui/SKILL.md` (design-system reuse, WCAG 2.1 AA, keyboard reachability), `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Source | Mitigation |
|------|--------|--------|------------|
| Size: about 3,000 lines across about 26 files is past one worker's context | HIGH | Feasibility (Phase 2.5) | Three subtasks split at the contract and bridge boundaries; no two share a file. |
| A contributed route has no access to the auth providers or the Loomwright reader today | MEDIUM | Feasibility (Phase 2.5) | One optional read-only `StatusView` on the request, built in `server.ts` from `/status`'s own helpers; no second Keychain read, no provider object exposed, no new enum value. |
| Login item on the ad-hoc-signed, unnotarised build may be refused or need approval on macOS 26 (requirement Risk) | HIGH | Feasibility (Phase 2.5) | The toggle reads the OS state back and says "needs approval" or "refused" honestly; subtask 2 verifies on the real build and records the finding in `docs/OPEN_QUESTIONS.md` (CLAUDE.md "Verify before asserting"). |
| An e2e or unit run registers the test Electron binary as a real login item, opens Finder, or writes the owner's real `prefs.json` | HIGH | Analysis | `STUDIO_APP_FAKE_OS=1` and `STUDIO_APP_PREFS_DIR` on every e2e launch; both honoured only when `!app.isPackaged`; unit tests mock Electron. A pin asserts a packaged build ignores both. |
| `nativeTheme.themeSource` may not drive the renderer's `prefers-color-scheme` as expected | MEDIUM | Analysis | AC5 checks it in the running app through `matchMedia`; the fallback (set `data-theme` from the preload's first read) is named in the Design and recorded if used. |
| The notifications switch is an app preference that nothing in the app consumes yet, and it does not silence the kernel's own notifier | MEDIUM | Analysis | The copy says only what it does; the evidence README names the departure from the mockup's caption; `docs/OPEN_QUESTIONS.md` asks the owner whether it should gate the kernel notifier (a kernel write route, out of scope). |
| The mockup says `studio auth …` commands, which do not exist (DESIGN.md open point 4) | LOW | Analysis | Show the three `SETUP_STEPS` commands, reused from `KernelStates.tsx`; record the departure. |
| The mockup's Keyboard map row has no item that builds the keyboard map | LOW | Analysis | Leave the row out and record the departure in the evidence README. |
| A secret reaches the screen or the renderer store (invariant 6) | HIGH | Analysis | The kernel builds the body field by field from health and metadata; the screen keeps only known fields; AC1 and AC2 search the body, DOM and store for a known token value. |
| Shared files with parallel sibling lanes (items 06, 07): `contribution.ts`, `server.ts`, `contract.ts` | MEDIUM | Analysis | Each edit is a small append at a named anchor (a new field beside `killSwitch?`, one spread beside `...managed`, new types after the bridge). A textual conflict is resolved at merge by keeping both sides. |
| Reveal in Finder opening a path the renderer chose | MEDIUM | Analysis | The channel takes no path; the main process opens its own resolved data dir; a pin asserts an argument is ignored. |
| Merging without the owner's approval (D9 polish gate) | HIGH | Analysis | AC12 is an owner gate. Never auto-merge; leave the PR for the owner. |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound
- **Threshold note:** about 3,000 changed lines across about 26 files (past both `context-bound` bounds). The kernel half (4 files) and the main-process half (12 files) share no file and run in parallel; the screen (11 files plus PNGs) waits for the bridge types.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-the-settings-screen.md
```

## Plan Review: PASS (attempt 3/3)

| # | Severity | Section | Description | Resolution |
|---|----------|---------|-------------|------------|
| 1 | HIGH | File Impact Map | `app/e2e/smoke.spec.ts:62` pins the built preload's exact key list; adding `prefs` breaks it and it was in no lane or validation step (attempt 1) | fixed: added to the map, subtask 2 lanes/provides, invariants, pin mutations and AC13 |
| 2 | MEDIUM | Closed enumerations touched | Section missing for the three new channels and the `prefs` bridge key (attempt 1) | fixed |
| 3 | LOW | Subtask Contracts | Subtask 3's `SettingsScreen` symbol already existed at base; OPEN_QUESTIONS provide was a prose phrase (attempt 1) | fixed: `SETTINGS_OWNER`, `SETTINGS_TEST_IDS` |
| 4 | LOW | Acceptance Criteria | AC1's `no_status_view` case unreachable through a real server (attempt 1) | fixed: direct handler call |
| 5 | MEDIUM | Pin mutations | No rows for `contrast.test.ts` and the AC4/AC6 e2e assertions (attempt 2) | fixed |
| 6 | LOW | Touched-file invariants | `contribution.ts` anchor split across lines (attempt 2) | fixed |
| 7 | MEDIUM | Pin mutations | The `contrast.test.ts` row (hard-coded `#999` in `settings.css`) would stay green if the test only mirrors `schedules/contrast.test.ts`, which never checks for literal colours (attempt 3) | deferred (no review attempt left): the subtask 3 worker adds an assertion that `settings.css` contains no literal colour (hex, `rgb()`/`rgba()`, `hsl()`/`hsla()`), so that mutation turns it red |

## Outcome
- **Status:** completed
- **Completed:** 2026-10-31T03:10:42Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/186
- **Branch:** feature/the-settings-screen
- **Files changed:** 43
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** Kernel `GET /settings` in the gui settings part, built on a frozen read-only `StatusView` (the /status helpers) passed to contributed routes. The Electron main process owns the preferences (prefs.json, login item via `app.get/setLoginItemSettings`, `nativeTheme.themeSource` applied before the window shows, Reveal of its own data dir) over three `fromOwner`-checked IPC channels and the `prefs` bridge. The Settings screen covers six states, palette commands, live refetch and last-known on outage, with e2e and 12 light/dark evidence screenshots. Three parallel/dependent subtasks merged cleanly. The Phase 4.5 Code Reviewer passed on its first iteration with 3 LOW findings below the MEDIUM fix floor (dismissed; marker comment posted). It ran 330 app and 111 kernel unit tests plus check-docs in a scratch copy, and 10 pin mutations each turned their pin red. Required CI was green. The until-mergeable drain was not dispatched because `.supervisor/config.json` sets `auto_review: false`. Risk classification high_risk=true (auth/token surface, size); the red-team lens was not opted in.

## Not verified
- **Login item on the real ad-hoc-signed build** — needs the owner on a packaged build; owner steps in docs/OPEN_QUESTIONS.md (subtask 2)
- **Reveal opening Finder for real** — the e2e asserts the recorded OS call (os-calls.json) only (subtasks 2, 3)
- **⌘K palette and ⌘, in the built app by hand** — covered by jsdom and e2e only (subtask 3)
- **Playwright e2e on the integrated branch** — not run locally after the merge; CI's required checks were green (Phase 4.5)
