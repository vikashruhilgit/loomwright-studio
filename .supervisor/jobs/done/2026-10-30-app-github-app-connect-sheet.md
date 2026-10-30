# Supervisor Job: App — connect GitHub through a GitHub App from the Connect sheet (GitHub App 4, wave 2)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-29-234434/L4
- **CLAUDE.md:** ✓ Found (fresh — `app/`, `kernel/`, `docs/` layout and invariants match the tree at base)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 2 (the source requirement lives under the gitignored `.supervisor/`, so its provenance is not git-tracked; disk 93% used, 34 GiB free — adequate)
- **Source requirement:** .supervisor/requirements/github-app/2026-10-29-174815-app-github-app-connect-sheet.md
- **Base commit:** 2b5a47d7d25b6a3a2ab3c27902bbc0ec29a66a91

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Electron main/preload/renderer split, React + vitest (jsdom) + Playwright e2e already in `app/`; `shell.openExternal` is part of Electron's main-process API |
| 2 | Dependency Availability | GO | No new dependency. Wave 1 landed the two owner routes in `CONTRACT_ROUTES` (`{ method: "POST", path: "/connectors/github/app/setup", origin: "github-app" }`), the response types, the `Connector` App fields and the mockup views |
| 3 | Architecture Fit | CAUTION | A new way out of the app (an IPC channel that opens the system browser) next to `lockDown`'s deny-everything guards. The renderer needs a new bridge method, so `StudioBridge` in `app/src/api/contract.ts` gains one **optional** member. That file is not in the requirement's Touches, but no wave-2 sibling touches it (their Touches are `kernel/**` and `docs/architecture/{integrations,github-app-setup}.md`, `docs/ARCHITECTURE.md`), so the lanes stay disjoint |
| 4 | Scope vs Supervisor Capability | CAUTION | About 24 files and an estimated 1,800 changed lines: past the `context-bound` bound (> 12 files or > 800 lines), so the work is split into 3 serial subtasks |
| 5 | Hard Blockers | CAUTION | The real flow depends on the kernel setup and tokens items (GitHub App 2 and 3), still in flight. This item is complete against the fixture kernel. The contract does not say what event, if any, marks "Create done, now Install", so the sheet's step-2 signal is defined here, by the fixture, and must be confirmed against the setup item |

**Overall Verdict:** CAUTION

## Task
**Goal:** Let the owner connect GitHub from the Connect sheet by choosing "Install GitHub App", which opens the kernel's loopback setup page in the system browser through one narrow, allowlisted main-process channel, and follow the setup to its connected or refused state, exactly as the approved mockup shows, against the fixture kernel.

**Problem Statement:**
The owner needs a GitHub connection whose read-only permissions are checked by GitHub, not declared, and that needs nothing typed or pasted, because a fine-grained token reports no permissions (probe p12, D36).
Currently, the Connect sheet (`app/src/screens/integrations/ConnectSheet.tsx`) offers only the paste-a-token path, and the Studio window cannot open the system browser: `lockDown` in `app/electron/main.ts` denies every new window and navigation. This blocks the GitHub App path D36 decided on.
Success looks like this: the sheet offers both paths, "Install GitHub App" opens the kernel's `setup_url` in the system browser while the Studio window stays put, the sheet follows the connector to "Permissions: read-only, checked by GitHub" with only the installed repos, and every refusal shows the mockup's copy. All of it is pinned by unit tests and one e2e spec against the fixture kernel.

## Acceptance Criteria

**Happy path**
- [ ] AC1. Given the Connect sheet, when the owner chooses "Install GitHub App", then the app calls `POST /connectors/github/app/setup` once and opens the returned `setup_url` through the open-external channel (`shell.openExternal`), and the Studio window does not navigate. Unit test in `connect-sheet.test.tsx` or the new `app-setup.test.ts`. The e2e spec stubs `shell.openExternal` in the main process with `electronApp.evaluate` and asserts both the recorded URL and an unchanged page URL.
- [ ] AC2. Given the fixture kernel moving the GitHub row to `connected` with `method: "app"`, when the `connector_status` event arrives, then the sheet closes and the detail pane shows "Permissions: read-only, checked by GitHub", the permissions GitHub reported, the App's slug (`app_slug`, shown in the mockup's App row in place of the name, because `Connector` carries no App name; see Risk Assessment), the installation (`installation_id`), the token's expiry with a "renews automatically" badge, and exactly the row's `reachable_repos` under "Repos chosen at install". It has no Replace token and no expiry band.
- [ ] AC3. Given every designed state (choice, setup step 1 Create, setup step 2 Install, connected, setup-expired, setup-cancelled, write-scoped, setup-failed, revoked, App disconnect confirm, kernel unreachable), then each matches the approved mockup (`docs/design/mockups/integrations.html` views `app-*`) in light and dark (polish gate, D9). Then a committed light and dark screenshot of each App state lands in `docs/evidence/phase-6-polish/integrations/` as `integrations-app-<state>-{light,dark}.png`, written by `INTEGRATIONS_EVIDENCE=1 npm run e2e`. Then `docs/evidence/phase-6-polish/integrations/README.md` lists them with the command that regenerates them, and the PR body links that README. The e2e spec captures at least the App path's connected state and one refused state.

**Edge cases**
- [ ] AC4. Given setup in progress, when the owner presses Cancel, Escape or the backdrop, then `POST /connectors/github/app/setup/cancel` is called once and the sheet shows the mockup's setup-cancelled view, whose "Set up again" returns to a fresh start and whose Close returns to the screen. The setup window is never left open by closing the dialog.
- [ ] AC5. Given setup in progress, when the owner presses "Open GitHub again", then the same `setup_url` the setup route returned is opened again through the channel, with no second setup call. Given the window's `expires_at` passing (clock) or a `connector_status` event refusing `setup_expired`, then the sheet shows the setup-expired view and "Set up again" starts a fresh setup (a new `POST /connectors/github/app/setup`).
- [ ] AC6. Given an App connection, when the owner chooses Disconnect, then the confirm shows what Studio removes (the App's key, from the Keychain) and the two GitHub links ("also uninstall on GitHub" at `https://github.com/settings/installations`, and the App's page at `https://github.com/settings/apps/<slug>`). Each link opens through the channel, and confirming calls `POST /connectors/github/disconnect`. Given an App connection, ⌘K "Connect GitHub" is disabled ("disconnect first"), and the empty state's and ⌘K's Connect GitHub open the choice when nothing is connected.
- [ ] AC7. Given "Paste a token" in the choice, then the existing token sheet opens unchanged: every existing `connect-sheet.test.tsx` and `integrations.spec.ts` token assertion still passes, including the token secrecy pins. Replace token on a token connection still opens the token sheet directly.

**Error scenarios**
- [ ] AC8. Given the open-external channel called with any URL off its allowlist, then it refuses and calls `shell.openExternal` zero times.
  - URL-shape cases go in `app/electron/open-external.test.ts` (against the pure `isAllowedExternal`): another host or port, `localhost` instead of `127.0.0.1`, `https:` on the loopback host, another path or a path prefix, a query other than `state` alone, userinfo, a fragment, `javascript:`, `file:`, `data:`, a bare `https://github.com/settings/apps`, and a slug with `/`, `..` or `%2F`.
  - Caller and argument cases go in `app/electron/main.test.ts`, against the `studio:open-external` handler: a caller that is not the window (refused), a non-string argument, and a kernel that is not connected (each answers `false` and opens nothing).
  - When the channel answers `false` for the setup URL, the sheet shows setup-failed's copy, never nothing (one unit case in `app-setup.test.ts`).

  The allowed forms are exactly three:
  - `http://127.0.0.1:<the kernel's current port>/connectors/github/app/start` with only a `state` query;
  - `https://github.com/settings/installations`;
  - `https://github.com/settings/apps/<slug>`, where `<slug>` matches `^[a-z0-9][a-z0-9-]*$`.

  `lockDown`'s window-open denial and navigation guard stay as they are (the existing `main.test.ts` pins stay green).
- [ ] AC9. Given each reason in `GitHubAppSetupRefusal` (`setup_not_open`, `state_mismatch`, `setup_expired`, `conversion_failed`, `install_failed`, `token_write_scoped`), arriving as the `refused` field of a `connector_status` event's payload or as a refusal from the setup route, then the sheet shows the mockup's copy, never the kernel's raw `message` (unit test per reason). The mapping:
  - `setup_expired` shows setup-expired;
  - `token_write_scoped` shows write-scoped;
  - `conversion_failed` and `install_failed` show setup-failed;
  - `setup_not_open`, `state_mismatch`, `not_implemented` and any unknown code show setup-failed's copy, because the mockup has no app state for them and adding one needs the owner's approval (DESIGN.md "Open points").
- [ ] AC10. Given the kernel unreachable (bridge status 0), then the sheet shows the mockup's unreachable state: "Install GitHub App" is disabled with the shared band, no setup call is made and nothing is opened. On an App connection the detail pane keeps the last-read data with its time, and Disconnect and Refresh are disabled.

## Touched-file invariants

> Grounded at base `2b5a47d7d25b6a3a2ab3c27902bbc0ec29a66a91`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/src/api/contract.ts`**
  - **keep:** `export interface StudioBridge {` and its existing members (`onNavigate(listener: (route: string) => void): () => void;`). The new member is **optional** (`openExternal?(url: string): Promise<boolean>`) so the fake bridges in `app/src/store/fake-bridge.ts`, `app/src/App.test.tsx`, `app/src/screens/chat/model.ts` and `app/src/screens/menubar/menubar.test.tsx` compile unchanged.
  - **mirror:** `kernel/test/console-contract.test.ts` reads this file as text (`const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);`), so leave `export const CONTRACT_ROUTES` and its one-entry-per-line form untouched. No route is added.
- **`app/electron/channels.ts`**
  - **keep:** "The renderer never names a channel itself". The new channel joins both `CHANNELS` and `INVOKE_CHANNELS` (`export const INVOKE_CHANNELS: readonly string[] = [CHANNELS.connection, CHANNELS.request, CHANNELS.feedSubscribe, CHANNELS.feedUnsubscribe];`).
- **`app/electron/preload.ts`**
  - **keep:** `contextBridge.exposeInMainWorld("api", api);` is the only key. The method forwards over IPC and returns only a boolean; it hands the renderer no `ipcRenderer`, channel name or Node API.
  - **pinned by:** `app/electron/preload.test.ts` (`expect(Object.keys(api).sort()).toEqual(["connection", "feed", "onNavigate", "request"]);`) and `app/e2e/smoke.spec.ts` (`expect(exposed).toEqual({ api: ["connection", "feed", "onNavigate", "request"], require: "undefined", process: "undefined" });`). Both are extended by exactly `openExternal`, and the `not.toMatch(/token|ipc|require|process/i)` guard stays.
- **`app/electron/main.ts`**
  - **keep:** every handler's `if (!fromOwner(event)) throw new Error("refused");`. Keep `window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));` and `window.webContents.on("will-navigate", (event) => event.preventDefault());` byte-identical.
  - **reuse:** the allowlist check lives in `app/electron/open-external.ts` as a pure function, and the loopback host is `API_HOST` from `./kernel-connection` (`export const API_HOST = "127.0.0.1";`). The port comes from `kernel.connection()` at call time, refused unless `state === "connected"`.
  - **pinned by:** `app/electron/main.test.ts` (`expect([...electron.handlers.keys()].sort()).toEqual(["studio:connection", "studio:feed:subscribe", "studio:feed:unsubscribe", "studio:request"]);`), extended by exactly the new channel. Its `vi.mock("electron", …)` gains a `shell` fake.
- **`app/src/screens/integrations/ConnectSheet.tsx`**
  - **keep:** the token path verbatim: "The token field is UNCONTROLLED", `input.value = "";` before the request, and `export const TOKEN_PAGE = "github.com/settings/personal-access-tokens/new";` shown as text. Keep `useModalFocus(panelRef, true, () => latest.current.onClose());` for focus, Tab trap and Escape.
  - **reuse:** the App dialog uses the same `dialog-overlay` / `dialog-panel` chrome and `useModalFocus`.
- **`app/src/screens/integrations/actions.ts`**
  - **reuse:** every new call goes through `async function send<R>(api: StudioBridge, request: ApiRequest): Promise<Reply<R>> {`. That covers one function per route (`startAppSetup`, `cancelAppSetup`) and one wrapper for `api.openExternal`, which answers `false` when the bridge lacks it.
- **`app/src/screens/integrations/model.ts`**
  - **keep:** `export const INTEGRATIONS_TEST_IDS = {` stays the only home of test ids ("the screen sets no other test id"), so new ids are added there. `export function refusalOf(` keeps the token route's mapping unchanged.
  - **keep:** kernel strings stay untrusted text: nothing builds markup.
- **`app/src/screens/integrations/IntegrationsView.tsx`**
  - **reuse:** `function newestConnectorEventId(` as the refetch trigger. The App path reads the newest `connector_status` event's `refused` field only as a value checked against the closed refusal list, never rendered raw.
  - **keep:** the Disconnect confirm stays a confirm (`const [confirming, setConfirming] = useState(false);` in this file; the rule is DESIGN.md's "Disconnect always confirms").
- **`app/src/screens/integrations/commands.ts`**
  - **keep:** the three ids (`id: "integrations.connect-github",` …) and `useEffect(() => registry.register(INTEGRATIONS_OWNER` registering once.
  - **pinned by:** `integrations.test.tsx` (`expect(owned(kernel)).toEqual(["integrations.connect-github", "integrations.disconnect-github", "integrations.refresh-repos"]);`). No command is added.
- **`app/src/screens/integrations/integrations.css`**
  - **reuse:** `.integrations-refusal {` for the App refusals' danger text and `.integrations-steps {` for the two steps.
  - **keep:** no raw colour value (tokens only, invariant 7: no GitHub colours).
- **`app/src/screens/integrations/test-support.tsx`**
  - **reuse:** `export function connector(status: ConnectorStatus, overrides: Partial<Connector> = {}): Connector {` builds App rows through `overrides` (`method: "app"`, `app_slug`, `installation_id`). `export function emit(kernel: Kernel, kind: string): void {` gains an optional payload, with existing callers unchanged.
- **`app/e2e/fixtures/integrations.ts`**
  - **keep:** "Every value here is fixture data: no real account, repo or token."
  - **mirror:** the kernel's event shape, `if (next !== "none") kernel?.appendEvent(event("connector_status", { connector_id: 1, kind: "github", status: next }));`. App refusals add `refused: <reason>` to that payload, as `docs/architecture/integrations.md` describes for the token path.
- **`app/e2e/integrations.spec.ts`**
  - **keep:** "The spec asserts behaviour, never pixels", and `const evidence = process.env.INTEGRATIONS_EVIDENCE === "1";`, so screenshots go to the tracked dir only on an evidence run. The AC12 guard (nothing under the tracked dir changes without the flag) covers the new App screenshots too.
- **`app/src/screens/integrations/connect-sheet.test.tsx`**, **`integrations.test.tsx`**, **`model.test.ts`**
  - **keep:** every existing assertion, notably the secrecy pin `expect(JSON.stringify(liveStoreFor(kernel.fake.bridge).getSnapshot(), mapReplacer)).not.toContain(TOKEN);`. New App cases are added beside them, not in place of them.

## Closed enumerations touched

> Sibling grep at base `2b5a47d`: `grep -rnF 'studio:feed:unsubscribe' --exclude=CHANGELOG.md --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=dist-electron .` → 4 hits in 3 tracked files (plus done briefs and stream logs under the gitignored `.supervisor/`, which are not code). `grep -rnF '"onNavigate"'` (same excludes) → 2 hits in 2 files.

- **`studio:open-external`** (sibling: `studio:feed:unsubscribe`). It must be named in:
  - `app/electron/channels.ts`: `CHANNELS` and `INVOKE_CHANNELS` (`feedUnsubscribe: "studio:feed:unsubscribe",`). **Extend.**
  - `app/electron/main.test.ts`: the sorted handler-key pin. **Extend.**
  - `app/electron/preload.test.ts`: the forwarded-call table (`{ channel: "studio:feed:unsubscribe", args: [] },`). **Extend** with the new forward.
- **`openExternal`** (sibling bridge key: `"onNavigate"`). It must be named in:
  - `app/electron/preload.test.ts`: the `Object.keys(api)` pin. **Extend.**
  - `app/e2e/smoke.spec.ts`: the `exposed` pin. **Extend.**
- **`GitHubAppSetupRefusal` consumers** (no new value; the app gains a runtime mirror of the list). `app/src/screens/integrations/app-setup.ts` holds a `Record<GitHubAppSetupRefusal, AppSetupOutcome>` map, so a reason added to the type fails `npm run typecheck` until it is mapped.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/electron/open-external.test.ts`: the off-allowlist refusal cases (AC8) | flip `===` → `!==` in the start-path comparison in `app/electron/open-external.ts` (it must turn the "another path" and "the start path" cases red) |
| `app/electron/open-external.test.ts`: the "another port" case | delete the port-equality line in `app/electron/open-external.ts` |
| `app/electron/main.test.ts`: the new channel's handler refuses a caller that is not the window | delete the `if (!fromOwner(event)) throw new Error("refused");` line of the new `studio:open-external` handler in `app/electron/main.ts` |
| `app/electron/main.test.ts`: off-allowlist URL ⇒ `shell.openExternal` not called | delete the allowlist guard's early `return false` in the `studio:open-external` handler in `app/electron/main.ts` |
| `app/src/screens/integrations/app-setup.test.ts`: refusal copy never shows the raw `message` | flip the mapped copy → the event's `message` in the outcome renderer in `app/src/screens/integrations/AppSetupSheet.tsx` |
| `app/electron/preload.test.ts`: the extended `Object.keys(api)` pin (`["connection", "feed", "onNavigate", "openExternal", "request"]`) | delete the `openExternal:` line of the `api` object in `app/electron/preload.ts` |
| `app/e2e/smoke.spec.ts`: the extended `exposed` pin | delete the `openExternal:` line of the `api` object in `app/electron/preload.ts` (the built preload then exposes no `openExternal`) |
| `app/electron/main.test.ts`: the extended sorted handler-key pin | delete the `ipcMain.handle(CHANNELS.openExternal,` registration line in `app/electron/main.ts` |
| `app/electron/preload.test.ts`: the extended forwarded-call table (`{ channel: "studio:open-external", … }`) | flip `CHANNELS.openExternal` → `CHANNELS.request` in the `openExternal` forward in `app/electron/preload.ts` |
| `app/src/screens/integrations/app-setup.test.ts`: Cancel calls the cancel route | delete the `cancelAppSetup(` call in `app/src/screens/integrations/AppSetupSheet.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Open-external channel: allowlist, main handler, preload method, bridge type, docs | AC8 (and the channel half of AC1, AC5, AC6) | 8 modify, 2 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Renderer: the choice, App setup dialog and outcomes, App detail pane, App disconnect, ⌘K | AC1, AC2, AC4, AC5, AC6, AC7, AC9, AC10 (unit level) | 10 modify, 3 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` | BLOCKED (by #1) |
| 3 | Fixture kernel App rows and events, e2e spec, polish evidence | AC1, AC2, AC3, AC7 (e2e level) | 3 modify, 22 create (screenshots) | `skills/playwright-e2e/SKILL.md` | BLOCKED (by #2) |

### Module layout

| Path | Lines at base | Home for the new responsibility |
|---|---|---|
| `app/electron/main.ts` | 144 | Gains only the handler wiring. The allowlist goes in the new module **`app/electron/open-external.ts`** (CREATE: a pure `isAllowedExternal(url, kernelPort)`), tested in **`app/electron/open-external.test.ts`** (CREATE) |
| `app/electron/channels.ts` / `preload.ts` | 15 / 31 | one entry / one method each |
| `app/src/api/contract.ts` | 1006 | one optional `StudioBridge` member (reason: the bridge type's only home; it is the shared contract) |
| `app/src/screens/integrations/ConnectSheet.tsx` | 259 | Gains only the choice step, which is the sheet's first view. The App setup dialog and its outcome views go in the new module **`AppSetupSheet.tsx`** (CREATE) |
| `app/src/screens/integrations/model.ts` | 314 | Gains only the new test ids (their one home). The App setup model goes in the new module **`app-setup.ts`** (CREATE): phases, refusal to outcome map, the GitHub link builders and the expiry check. Tested in **`app-setup.test.ts`** (CREATE) |
| `app/src/screens/integrations/IntegrationsView.tsx` | 617 | The App detail pane's differences and the App disconnect confirm are appended here (reason: they are variants of `TokenDetail` and the existing confirm, sharing its state; a separate file would duplicate the confirm's focus handling). If the append passes about 150 lines, extract an `AppDetail` component into `AppDetail.tsx` (in lane `app/src/screens/integrations/*.tsx`) |
| `connect-sheet.test.tsx` / `integrations.test.tsx` / `model.test.ts` | 555 / 557 / 288 | Only the cases that extend existing suites (the choice, App detail, ⌘K flags). The new behaviour's cases live in `app-setup.test.ts` |
| `app/e2e/integrations.spec.ts` | 603 | App path tests appended (reason: they share the spec's launch, evidence and AC12-guard helpers) |
| `app/e2e/fixtures/integrations.ts` | 199 | App rows, setup routes and App events appended (the one fixture for the screen) |

### Subtask Contracts

```yaml
# Subtask 1 — open-external channel (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/electron/open-external.ts"}
  - {kind: "symbol", path: "app/electron/open-external.ts", name: "isAllowedExternal"}
  - {kind: "file", path: "app/electron/open-external.test.ts"}
  - {kind: "symbol", path: "app/electron/channels.ts", name: "openExternal"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "openExternal"}
  - {kind: "symbol", path: "app/electron/preload.ts", name: "openExternal"}
  - {kind: "symbol", path: "docs/architecture/app.md", name: "The open-external channel"}
requires: []
lanes:
  - "app/electron/open-external.ts"
  - "app/electron/open-external.test.ts"
  - "app/electron/channels.ts"
  - "app/electron/preload.ts"
  - "app/electron/main.ts"
  - "app/electron/main.test.ts"
  - "app/electron/preload.test.ts"
  - "app/e2e/smoke.spec.ts"
  - "app/src/api/contract.ts"
  - "docs/architecture/app.md"
external_requires:
  - "Electron shell.openExternal (main process)"

# Subtask 2 — renderer (BLOCKED by #1)
provides:
  - {kind: "file", path: "app/src/screens/integrations/AppSetupSheet.tsx"}
  - {kind: "symbol", path: "app/src/screens/integrations/AppSetupSheet.tsx", name: "AppSetupSheet"}
  - {kind: "file", path: "app/src/screens/integrations/app-setup.ts"}
  - {kind: "symbol", path: "app/src/screens/integrations/app-setup.ts", name: "outcomeOfRefusal"}
  - {kind: "file", path: "app/src/screens/integrations/app-setup.test.ts"}
  - {kind: "symbol", path: "app/src/screens/integrations/actions.ts", name: "startAppSetup"}
  - {kind: "symbol", path: "app/src/screens/integrations/actions.ts", name: "cancelAppSetup"}
requires:
  - {from: "1", kind: "symbol", path: "app/src/api/contract.ts", name: "openExternal"}
lanes:
  - "app/src/screens/integrations/*.tsx"
  - "app/src/screens/integrations/*.ts"
  - "app/src/screens/integrations/integrations.css"
  - "docs/architecture/app.md"  # ordered after #1 (requires), so the shared file is legal
external_requires: []

# Subtask 3 — fixture, e2e, evidence (BLOCKED by #2)
provides:
  - {kind: "symbol", path: "app/e2e/fixtures/integrations.ts", name: "appConnectorRow"}
  - {kind: "file", path: "docs/evidence/phase-6-polish/integrations/integrations-app-connected-light.png"}
  - {kind: "file", path: "docs/evidence/phase-6-polish/integrations/integrations-app-connected-dark.png"}
  - {kind: "file", path: "docs/evidence/phase-6-polish/integrations/README.md"}
requires:
  - {from: "2", kind: "symbol", path: "app/src/screens/integrations/AppSetupSheet.tsx", name: "AppSetupSheet"}
  - {from: "1", kind: "symbol", path: "app/electron/channels.ts", name: "openExternal"}
lanes:
  - "app/e2e/fixtures/integrations.ts"
  - "app/e2e/integrations.spec.ts"
  - "docs/evidence/phase-6-polish/integrations/*"
external_requires:
  - "Playwright Electron (electronApp.evaluate to stub shell.openExternal)"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 ──→ Subtask 2 ──→ Subtask 3
Subtask 1 ─────────────────→ Subtask 3
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | `docs/architecture/app.md` (1 writes the channel section, 2 appends the step-2 signal and `refused` reading); 2 also reads the `contract.ts` type 1 adds | YES (requires) |
| Subtask 2 | Subtask 3 | none (3 drives 2's test ids) | YES (requires) |
| Subtask 1 | Subtask 3 | none | YES (requires) |

### Batch Plan
- **Batch 1:** Subtask 1
- **Batch 2:** Subtask 2 (after 1)
- **Batch 3:** Subtask 3 (after 2)
- **Recommended workers:** 1
- **Estimated batches:** 3

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md` |
| 3 | `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| The open-external channel is a new way out of the app (source: requirement) | HIGH | Exact allowlist in a pure module with a test per off-list form (AC8). The port must be the kernel's current one; host `API_HOST` only; `http:` only for loopback and `https:` only for `github.com`; no userinfo or fragment; the slug is re-validated in main, never trusted from the renderer. `lockDown` stays untouched. Red-team the channel in review |
| The step-2 ("Create done, now Install") signal and the App refusal event shape are not fixed by wave 1's contract (source: Feasibility (Phase 2.5)) | HIGH | The sheet moves to step 2 when it sees a `connector_status` event that is not a refusal while the row is not yet `connected` (or a row with `method: "app"`, `app_slug` set and `installation_id` null). It reads a refusal from the event payload's `refused`, checked against the closed list, the shape the token path already uses. The fixture follows exactly that. Subtask 2 documents both in `docs/architecture/app.md` (in its lanes, after Subtask 1's channel section), together with the exact `setup_url` shape the channel accepts (path `/connectors/github/app/start`, query `state` only). All three are flagged in the PR body for the kernel setup item to confirm. Unknown signals degrade to step 1 or setup-failed, never a crash. A `setup_url` the channel refuses shows setup-failed, never a silent no-op |
| `Connector` carries no App name, while the mockup shows the App's name and slug (source: Plan Review) | MEDIUM | Show the slug in the App row in place of the name. The fixture carries only fields `Connector` has (`method`, `app_slug`, `installation_id`), never an invented name. Record it as an owner open point in `docs/evidence/phase-6-polish/integrations/README.md` and the PR body (a later optional `app_name` from the kernel tokens item would restore it) |
| "Open GitHub again" reuses a `setup_url` whose `state` may be spent by its first GET (source: requirement vs the setup item's "spent on its first use") | MEDIUM | Build to the requirement (reopen the same URL). If the setup item spends the `state` on the start page, the browser tab shows the kernel's refusal page and the owner uses "Set up again". Note it in the PR body |
| The mockup links the expired, cancelled and write-scoped views to the bare GitHub Apps page (`https://github.com/settings/apps`), which the requirement's allowlist does not include (source: Feasibility (Phase 2.5)) | MEDIUM | Keep the requirement's exact allowlist. These views link to `https://github.com/settings/apps/<slug>` when the row or event carries the slug, else show the address as text (the `TOKEN_PAGE` precedent). Record it as an owner open point in the PR body |
| Adding `openExternal` to `StudioBridge` touches `app/src/api/contract.ts`, outside the requirement's Touches (source: Feasibility (Phase 2.5)) | MEDIUM | Optional member only, so no fake bridge changes. No wave-2 sibling touches the file, and `kernel/test/console-contract.test.ts` reads only `CONTRACT_ROUTES` and `SessionOutputKind`, which stay unchanged |
| The ~1,800-line change in 3 serial subtasks (source: Feasibility (Phase 2.5)) | MEDIUM | `context-bound` split. Each subtask runs its own validation slice before hand-back (1: `npm run typecheck && npm test`; 2: the same; 3: `npm run build && npm run e2e`) |
| The e2e must never open a real browser | MEDIUM | Stub `shell.openExternal` in the main process via `electronApp.evaluate` before any click, record the calls, and assert the list |
| Copy drift from the approved mockup (polish gate D9) | MEDIUM | Lift copy verbatim from `docs/design/mockups/integrations.html` (`appSheetHTML` / `appDetailHTML`). Widen the empty state's "a token you create" line to both ways, as DESIGN.md asks. Light and dark evidence for every App state |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 3
- **Base Branch:** main
- **Split reason:** context-bound

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test` · `cd app && npm run build && npm run e2e` · `bash scripts/check-docs.sh`

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-30-app-github-app-connect-sheet.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-30T03:14:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/171
- **Branch:** feature/app-github-app-connect-sheet
- **Files changed:** 69
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 0
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** 3 sequential subtasks: the open-external channel (d478f8c), the renderer App setup (4944636, plus the flake root-cause fix 9557266), and fixture/e2e/evidence (ba5a3fc). Phase 4.5 code-reviewer PASS on its first iteration. 3 LOW findings were dismissed below the MEDIUM floor and posted as a marker comment. Typecheck, 1474 unit, 113 e2e and check-docs are green. A driver defect (phantom subtask "Path" parsed from the "### Module layout" table) was corrected in the sidecar.

## Not verified
- **A real system browser opening an address** — shell.openExternal is faked in main.test.ts (subtask 1)
- **app/e2e/integrations.spec.ts token specs** — they meet the choice first; subtask 3's lane, e2e was not run in subtask 2 (subtask 2)
- **Light and dark rendering of the choice, setup dialog and App detail pane** — not visually checked in subtask 2 (subtask 2)
- **The real browser opening the setup URL** — the e2e stubs shell.openExternal by design (subtask 3)
- **The real kernel's setup, step-2 and refusal event shapes** — fixture only; the kernel setup item must confirm them (subtask 3)
