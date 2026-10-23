# Supervisor Job: The menu bar, deep links, Pause all and the kill switch

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-22-071939/L5
- **CLAUDE.md:** ✓ Found (fresh. Its `kernel/` + `docs/` description predates `app/`, which `app/e2e/fixtures/README.md` and the phase-5 requirements document. Nothing it states is contradicted.)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 0
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140017-the-menu-bar-deep-links-pause-and-kill-switch.md
- **Base commit:** 310535f9bbfd90487aa735dca0f18e474152e394
- **Re-plan (2026-10-23):** this brief was first saved 2026-10-22 at the same base commit; that run's Supervisor phase died (API DNS failure, `ENOTFOUND`, after 8 turns) before writing any branch or PR. `origin/main` is unchanged (310535f), and the stubs `createTray` / `registerDeepLinks`, `notificationDetail`, and the approval title template were re-read at that commit. The plan is carried forward unchanged.

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` is Electron 44 + React 19 + TypeScript + Vite, with vitest + RTL and Playwright Electron e2e, the stack the requirement names. Electron's `Tray`, `Menu`, `nativeImage` and `dialog`, and the `open-url` app event, cover the native side. |
| 2 | Dependency Availability | GO | No new npm dependency. The contract routes `GET /status`, `GET /approvals`, `POST /pause`, `POST /unpause`, `POST /stop-all`, `POST /resume` and `GET /notifications/:id` are in `CONTRACT_ROUTES` (`app/src/api/contract.ts`). `StatusBody.paused`, `kill_switch.engaged` and `cap_state` exist. The main process's `KernelConnection.request` / `openFeed`, the store (`useResource("status")`, `useResource("approvals")`), `commandRegistry`, `Dialog`, `ToastStack` and `StatusDot` all exist on main. |
| 3 | Architecture Fit | CAUTION | Three gaps, all confirmed with the owner (LP-SCOPE answer "Widen app Touches", 2026-10-22). (a) `app/electron/main.test.ts` mocks `electron` with only `BrowserWindow`/`app`/`ipcMain`/`session`, so a real tray makes `main()` throw under it. That file gains mock entries only. (b) `ApprovalsScreen.tsx` keeps the selection in local state, so a link cannot open "on that approval". It gains a `#/approvals/<id>` selection. (c) The shell's `App.tsx` never subscribes `api.onNavigate`. The menubar screen module's always-mounted `SidebarSection` does, without editing `App.tsx`. |
| 4 | Scope vs Supervisor Capability | CAUTION | 19 authored files across the main process and the renderer, above the 12-file `context-bound` bound. Split into a main-process subtask and a renderer + e2e subtask (see Configuration). |
| 5 | Hard Blockers | CAUTION | `GET /notifications/:id` returns no approval id for a `kernel:approval` notification (`notificationDetail` in `kernel/src/notifications/routes.ts` adds only `trigger` or `session`). The owner chose no kernel change. The app reads the id from the kernel-authored title `Approval ${id}: ${action}` (`kernel/src/approvals/store.ts`), for the `kernel:approval` source only, pinned by a kernel-mirror test, and records the missing field as a finding. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Replace the `app/electron/tray.ts` and `app/electron/deeplink.ts` stubs with the menu-bar tray and the `loomwright-studio://` deep-link handler. Add a `menubar` screen module that does three things: renders the tray's status panel (the mockup's menu-bar dropdown) as a routed view, takes deep links from the main process, and registers the pause / unpause / kill switch / resume ⌘K commands. Add a `#/approvals/<id>` selection to the Approvals screen. Add a Playwright spec against the fixture kernel that commits light and dark screenshots of every designed state.

**Problem Statement:**
The owner needs to see and steer the kernel at a glance, and needs a notification click to land on its subject.
Today item 01 leaves the tray and the deep-link handler as stubs (`createTray` and `registerDeepLinks` create nothing), so the kernel's notifications (`loomwright-studio://notifications/<id>`) open nothing, and Pause all and the kill switch are reachable only from a terminal.
Success looks like this: the menu-bar icon shows the kernel's state and the pending-approval count, Pause all / Unpause / Kill switch (confirmed) / Resume / Open / Quit work from it, and a notification link opens the app on its approval or thread (launching the window if it was closed). An unknown link only toasts. Quitting the app never stops the kernel.

**Owner scope decision (2026-10-22, LP-SCOPE, "Widen app Touches"):** besides the requirement's Touches, this job may edit `app/electron/main.test.ts` (electron mock entries only, nothing else in it) and `app/src/screens/approvals/ApprovalsScreen.tsx` + `app/src/screens/approvals/ApprovalsScreen.test.tsx` (the `#/approvals/<id>` selection only). There is no kernel change and no new npm dependency. Every other file outside the lanes below is a finding to stop and report, not to edit.

**Design notes for the workers (grounded at the base commit):**
- **Shared pure model: `app/src/screens/menubar/state.ts`.** It has no React, no DOM and no `electron` import, because both `app/electron/tray.ts` (main-process bundle, `scripts/build-electron.mjs`, and `tsconfig.node.json`, which already reaches `../src/api/contract`) and the renderer import it, as does the Playwright spec (plain Node). It exports:
  - `MenubarState = "idle" | "working" | "waiting" | "cap" | "paused" | "killed"`.
  - `menubarState(status: StatusBody, pendingApprovals: number): MenubarState`. Precedence: `kill_switch.engaged` → `killed`; `paused === true` → `paused`; `pendingApprovals > 0` → `waiting`; any `cap_state[].limits[].status === "rejected"` → `cap` (the kernel's `RATE_LIMIT_STATUSES` in `kernel/src/budget/cap.ts` are `allowed`, `allowed_warning`, `rejected`); `sessions.length > 0` → `working`; else `idle`.
  - The word for each state ("idle", "working", "waiting on you", "paused at cap", "paused", "killed") and the `StatusDot` state it maps to. `StatusState` in `app/src/components/StatusDot/StatusDot.tsx` is `"idle" | "working" | "waiting" | "paused" | "ok" | "failed"`: `idle`→`idle`, `working`→`working`, `waiting`→`waiting`, `cap`/`paused`→`paused`, and `killed`→`failed` (the kill switch is a stop, not a park).
  - `parseDeepLink(url: string): { kind: "notification"; id: number } | { kind: "invalid" }`. This is a closed grammar: exactly `loomwright-studio://notifications/<id>`, where `<id>` matches `[1-9][0-9]{0,15}` (the kernel's `DEEP_LINK_PREFIX` is `loomwright-studio://notifications/` in `kernel/src/notifications/record.ts`), with no query, fragment, credentials, port or extra segment. Anything else (`loomwright-studio://approve/7`, `notifications/0`, `notifications/7?x`, another scheme) is `invalid`.
  - The navigate-route grammar sent over `CHANNELS.navigate`: `notification/<id>` or `invalid-link`, plus `parseNavigateRoute` for the renderer side.
  - `TRAY_SEAM_ENV` (see the tray notes).
- **Tray (`app/electron/tray.ts`, subtask 1).** `createTray({ kernel, showWindow })` keeps its signature (`main.ts` calls `createTray({ kernel, showWindow })` after `app.whenReady()`, and `main.ts` is NOT edited). It creates one `Tray`:
  - The icon is a coloured dot per `MenubarState`, built in code as a small RGBA bitmap through `nativeImage.createFromBitmap` / `createFromBuffer` (no asset files: `app/build/` is outside this item). The pending count goes in `tray.setTitle(String(n))` (empty at 0), and the tooltip names the state word.
  - State comes from `kernel.request({ method: "GET", path: "/status" })` and `kernel.request({ method: "GET", path: "/approvals" })` (pending only). They are re-read on start, after each tray action's answer, on each frame of the tray's own `kernel.openFeed(...)` subscription (independent of the renderer's: `handleBridge`'s feed belongs to the window), and on a slow poll while the feed is down. The dot shows `paused` only after a `/status` read says `paused: true`; there is no optimistic flip (AC2).
  - The menu (`Menu.buildFromTemplate`, rebuilt on each state change) has: a status line (state word + "N waiting on you"); **Open** (`showWindow()`); **Pause all** (`POST /pause`) when not paused, or **Unpause** (`POST /unpause`) when paused; **Kill switch…**, which runs `dialog.showMessageBox` with Cancel as the default and cancel button, and only on the confirm response calls `POST /stop-all`; **Resume** (`POST /resume`, which releases both the kill switch and a pause: `kernel/src/console/pause.ts` "`POST /unpause` (here) and `POST /resume` (phase 1's,"), enabled when killed or paused; **Quit** (`app.quit()`, never a kernel call).
  - Closing the window leaves the tray (`main.ts` already keeps the app alive on darwin through `window-all-closed`). Quit calls no route: nothing in tray.ts sends `/stop-all`, `/pause` or `/sessions/*` on quit or `before-quit`.
  - **e2e seam (unpackaged only):** when `!app.isPackaged && process.env[TRAY_SEAM_ENV] === "1"`, tray.ts sets `globalThis.__studioTray = { model(): {state, count, title, items: {id, label, enabled}[]}, click(id): Promise<void> }` so `electronApp.evaluate` can read the model and press an item. A packaged app never sets it (unit-pinned). The kill confirm in e2e is driven by patching `dialog.showMessageBox` through `electronApp.evaluate(({ dialog }) => …)`. tray.ts must therefore call `dialog.showMessageBox` through the `electron` module object at call time (the Vite SSR CJS build in `scripts/build-electron.mjs`, with `electron` external, emits a property access at call time), never a captured reference.
  - A tray action's failure (`ApiResult.ok === false`) leaves the state as read and logs the reason only (never a body or token), like `kernel-connection.ts`'s `log`.
  - **Shape checks + single flight (required).** `kernel.request` answers are untrusted shapes. tray.ts checks a `/status` body (`kill_switch.engaged` boolean, `sessions` array, `cap_state` array; `paused` boolean or absent) and an `/approvals` body (`approvals` array) before using them. A malformed body (`app/electron/main.test.ts`'s fake kernel answers every call `{ ok: true, status: 200, body: {} }`) counts as a failed read: the state stays as last read, the reason is logged, and nothing is thrown or rejected unhandled. tray.ts never calls `kernel.openFeed` while an earlier call is still pending (main.test's fake `openFeed` stays pending until a test opens it, and its feed-relay tests index `kernel.feeds[0..2]`). Every timer the tray starts is `unref()`'d so it never keeps a test process alive.
- **Deep links (`app/electron/deeplink.ts`, subtask 1).** `registerDeepLinks({ navigate })` keeps its signature and is called by `main.ts` before `app.whenReady()`, which is what macOS needs to receive the launch link.
  - It listens to `app.on("open-url", (event, url) => …)` (`event.preventDefault()`), parses with `parseDeepLink`, and sends `navigate("notification/<id>")` or `navigate("invalid-link")`. Never anything else: the raw URL never reaches the renderer or a kernel call. A link is navigation only and never an action (invariant 3).
  - **Ordering (required):** a link received before `app.whenReady()` is held and delivered after it, because `main.ts`'s `navigate` calls `showWindow()`, which constructs a `BrowserWindow`, which must not run before ready. **The held link is flushed only after `main.ts`'s own code after `await app.whenReady()` has run:** `app.whenReady().then(() => setImmediate(flush))`, never a synchronous flush inside `.then`. `main.ts` runs `createTray(…)` and then an unconditional `createWindow()` straight after its await. A flush that ran first would find no window, create one through `navigate`, and leave `main.ts` to create a second, whose bridge is the only one answered (`handleBridge` answers only `window?.webContents`). With the deferred flush, the window exists and is loading, so delivery takes the loading branch below.
  - **Cold window (required):** `main.ts`'s `navigate` sends on `CHANNELS.navigate` immediately after `showWindow()`, so a window it has just created (closed-window case) or one still loading may drop the message. deeplink.ts handles this itself:
    - window present and loaded (`!webContents.isLoading() && webContents.getURL() !== ""`, so a window whose `loadFile` has not started yet counts as loading): call `navigate(route)` once;
    - window present and `webContents.isLoading()`: wait for its `did-finish-load`, then call `navigate(route)` once;
    - no window (`BrowserWindow.getAllWindows()` empty): call `navigate(route)` (which creates the window; the immediate send may or may not arrive), wait for the new window's `did-finish-load`, then call `navigate(route)` again.
    Only the last case can deliver a route twice, and the renderer host deduplicates it (below).
- **Renderer side (`app/src/screens/menubar/`, subtask 2).**
  - `index.tsx` exports `screen: ScreenDefinition` with `id: "menubar"`, `title: "Menu bar"`, **no `nav`** (App.test pins exactly four sidebar buttons), `Component` (the status panel) and `SidebarSection` (the host).
  - **The host** (always mounted by `App.tsx`'s `SCREENS.map((s) => s.SidebarSection …)`) renders no button inside the sidebar; toasts and the kill confirm render through a portal to `document.body`. It guards the bridge as item 15 does (`(window as unknown as { api?: StudioBridge }).api`; the shell hands screens no bridge, and `App.test.tsx` never sets `window.api`).
  - To close the cold-window race on the renderer side, the module subscribes `window.api?.onNavigate(...)` at **module evaluation** (screens are eager-imported by `import.meta.glob(..., { eager: true })`, which runs before the page's load event and so before `did-finish-load`). Routes are buffered in a module-level queue that the mounted host drains. **Dedupe (required):** a route identical to the last one received less than 2 s earlier is dropped at the queue, so the cold-window double delivery causes one `GET /notifications/:id` and at most one toast.
  - For `notification/<id>`, it calls `GET /notifications/:id` through `getBridge().request` and maps the answer (in `links.ts`):
    - source `kernel:approval` + title matching `^Approval ([1-9][0-9]{0,15}): ` → `#/approvals/<id>`;
    - `agent:<name>` → that agent's thread, `threadHash(name)` from `app/src/screens/chat/model.ts` (`#/chat` for Wright);
    - `trigger:<id>` → `#/chat` (Wright's thread, where playbook cards appear; the detail's `trigger` carries no owning agent, which goes in the README findings);
    - any other `kernel:*` → the app opens on its current screen, no toast.
    - A 404, a failed read, or an unmatched shape → one toast ("That notification link points to nothing Studio can open") and nothing else.
  - `invalid-link` → the same toast and nothing else.
  - The host never calls a write route for a link. `GET /notifications/:id` is the only request a link may cause.
  - **Commands:** `commandRegistry.register("menubar", [...])` with ids `menubar.pause-all`, `menubar.unpause`, `menubar.kill-switch`, `menubar.resume`, group "Kernel", no shortcuts (none collide; the shell's own ids start `screens.`). `enabled` follows `useResource("status")` (pause-all when not paused, unpause when paused, resume when killed or paused, kill-switch when not killed). The kill switch opens `Dialog` (`app/src/components/Dialog/Dialog.tsx`, confirm kind) and calls `POST /stop-all` only from its confirm action. Unregistered on unmount.
  - **The status panel** (`#/menubar`, root `data-testid="screen-menubar"`, no `<h1>`) is the mockup's menu-bar dropdown (`docs/design/mockups/gui-v1.html` `/* ---------- Menu-bar dropdown ---------- */` and `.mbmenu`) rendered in the window: a `StatusDot` + state word, a meta line ("N running · N waiting on you"), an Approvals entry with the count (→ `#/approvals`), and Pause all / Unpause, Kill switch… (Dialog confirm), and Resume as `Button`s, with the same enabled rules as the commands. Open and Quit are tray-only and the panel says so in one line.
  - Its designed states are loading, error (kernel unreachable, shown with the shell's `UnreachableBand`, which `App.tsx` renders above every screen), idle (empty), working, waiting on you (two approvals), paused, paused at cap, and killed.
- **Approvals selection (`app/src/screens/approvals/ApprovalsScreen.tsx`, subtask 2).** On mount and on `hashchange`, a hash matching `^#\/approvals\/([1-9][0-9]{0,15})$` sets `selectedId` to that id (the existing `setSelectedId`). Nothing else changes: no decision is sent, and an id not in the list takes the screen's existing "left" path (`goneReason`). `#/approvals` with no id keeps today's behaviour (oldest row).
- **Fixture + spec (subtask 2):** `app/e2e/fixtures/menubar.ts` holds the canned routes (status variants, two pending approvals, `GET /notifications/7` as a `kernel:approval` row titled `Approval 7: …`, `POST /pause` / `/unpause` / `/stop-all` / `/resume` answers that flip the fixture's status). `app/e2e/menubar.spec.ts` launches through `launchApp` (`app/e2e/electron-harness.ts`; `scripts/hidden-windows.test.ts` fails a spec that calls `electron.launch` itself) with `TRAY_SEAM_ENV=1` in the env, and fires links with `electronApp.evaluate(({ app }, url) => app.emit("open-url", { preventDefault() {} }, url), link)`. Evidence mode follows `e2e/approvals.spec.ts`'s `APPROVALS_EVIDENCE` pattern, as `MENUBAR_EVIDENCE=1`.

## Acceptance Criteria
- [ ] AC1. Given the fixture kernel with two pending approvals and a status at rest, when the app starts, then the tray model (read through the seam) has `count` 2, title `"2"` and state `waiting`; and `menubarState` unit tests cover every state and the precedence killed > paused > waiting > cap > working > idle.
- [ ] AC2. Given the tray at rest, when the tray's Pause all item is clicked, then exactly one `POST /pause` reaches the fixture, and the tray state becomes `paused` only after a later `GET /status` answers `paused: true` (a unit test with a kernel whose `/status` still answers `paused: false` after the pause keeps the state unchanged). When paused, the item reads Unpause and sends `POST /unpause`.
- [ ] AC3. Given Kill switch… is chosen (tray item, panel button, or the `menubar.kill-switch` command), then a confirm opens (native `dialog.showMessageBox` in the tray; `Dialog` in the window). On Cancel no request is sent; only on Confirm is exactly one `POST /stop-all` sent. Resume sends `POST /resume`.
- [ ] AC4. Given `loomwright-studio://notifications/7` whose notification is a `kernel:approval` titled `Approval 7: …`, when the link arrives (`open-url`), then the window shows the Approvals screen with approval #7 selected (`#/approvals/7`), and no `POST /approvals/*` request is sent. Given `loomwright-studio://approve/7`, `loomwright-studio://notifications/abc`, or any other path, then the only effect is one toast and no route change. In e2e, no `GET /notifications/*` and no POST reaches the fixture after the link (the tray's and the store's own reads continue). In `menubar.test.tsx`, the host makes no request at all for such a link. Given an `agent:pim` notification, the window opens on `#/chat/pim`.
- [ ] AC4b. Unit, every platform (`app/electron/deeplink.test.ts`, electron mocked):
  - (i) a link received before `app.whenReady()` resolves, with `main.ts`'s order simulated (a `whenReady().then` that creates the window registered by the test after `registerDeepLinks`), leaves exactly one `BrowserWindow` constructed, and `navigate` delivers the route after that window's `did-finish-load`;
  - (ii) with no window, `navigate` is called, then called again after the new window's `did-finish-load`;
  - (iii) with a loaded window, `navigate` is called exactly once.

  e2e, **macOS only** (`test.skip(process.platform !== "darwin", …)`, because `main.ts`'s `app.on("window-all-closed", …)` quits on other platforms and CI's e2e runs on ubuntu): given the window was closed (tray still running), when `loomwright-studio://notifications/7` arrives, then a window is created and lands on `#/approvals/7`. Given the same route delivered twice in a row to the renderer host, then one `GET /notifications/7` is sent and at most one toast shows (`menubar.test.tsx`).
- [ ] AC5. e2e, **macOS only** (same reason): given the window closed, then the app is still running and the tray model is still readable. Every platform: given Quit from the tray (window open), then the app process exits, the fixture kernel still answers `GET /status` afterwards, and the fixture's `requests` hold no `POST /stop-all`, `POST /pause` or `POST /sessions/*` made by the quit. `tray.test.ts` also asserts that the Quit item calls `app.quit()` and no `kernel.request`.
- [ ] AC6. Given the fixture, when `e2e/menubar.spec.ts` runs with `MENUBAR_EVIDENCE=1`, then screenshots of the status panel in every designed state (loading, error with the kernel-unreachable band, idle/empty, working, waiting on you with two approvals, paused, paused at cap, killed) and of the kill-switch confirm dialog exist in both light and dark under `docs/evidence/phase-5-polish/menubar/`. A committed `docs/evidence/phase-5-polish/menubar/README.md` lists each screenshot with the `docs/design/mockups/gui-v1.html` screen it matches (the menu-bar dropdown, `.mbmenu`) and records three things: the contract findings (no approval reference on `GET /notifications/:id`, so the id comes from the kernel-authored `kernel:approval` title; no owning agent on a `trigger` detail; `App.tsx` mounts no ⌘K palette host and does not subscribe `onNavigate`); that the native tray menu itself cannot be screenshotted by Playwright and is verified through the seam model instead; that the window-closed e2e steps (AC4b, AC5) run on macOS only because `main.ts` quits on `window-all-closed` elsewhere, with the macOS run's result stated; and the owner's LP-SCOPE widening. The PR body links to the README.
- [ ] AC7. Given keyboard-only use of the status panel, then Tab reaches Approvals, Pause all / Unpause, Kill switch… and Resume, and Enter or Space runs each; the kill confirm is operable and dismissable by keyboard (Escape cancels and sends nothing). The four `menubar.*` commands are registered in `commandRegistry` with `enabled` matching the status.
- [ ] AC8. `cd app && npm ci && npm run typecheck && npm test && npm run build` passes, including the unchanged assertions of `electron/main.test.ts` and `src/App.test.tsx`, and `npm run e2e` passes, including `e2e/menubar.spec.ts` and the existing `e2e/approvals.spec.ts`.

**Evidence rule:** AC6's mockup mapping, the findings and the native-menu limit live in the committed `docs/evidence/phase-5-polish/menubar/README.md`, never only in the PR body.

## File Impact Map

| Group | Files to Modify | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| main (subtask 1) | `app/electron/tray.ts`, `app/electron/deeplink.ts`, `app/electron/main.test.ts` (electron mock entries only) | `app/src/screens/menubar/state.ts`, `app/src/screens/menubar/state.test.ts`, `app/electron/tray.test.ts`, `app/electron/deeplink.test.ts` | HIGH |
| renderer (subtask 2) | `app/src/screens/approvals/ApprovalsScreen.tsx`, `app/src/screens/approvals/ApprovalsScreen.test.tsx` | `app/src/screens/menubar/index.tsx`, `app/src/screens/menubar/MenubarPanel.tsx`, `app/src/screens/menubar/MenubarHost.tsx`, `app/src/screens/menubar/links.ts`, `app/src/screens/menubar/menubar.css`, `app/src/screens/menubar/menubar.test.tsx`, `app/src/screens/menubar/kernel-mirror.test.ts` | HIGH (the split of files inside `menubar/` is the worker's call) |
| e2e + evidence (subtask 2) | — | `app/e2e/fixtures/menubar.ts`, `app/e2e/menubar.spec.ts`, `docs/evidence/phase-5-polish/menubar/README.md`, `docs/evidence/phase-5-polish/menubar/*.png` (about 18 generated: 9 views × 2 themes) | HIGH |

**Total estimated files:** 5 modify + 14 authored creates = 19 authored files (+ about 18 generated PNGs written by the spec in evidence mode)

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| main | renderer | none (renderer imports `menubar/state.ts`, created by subtask 1) | YES (dependency, not overlap) |

## House Rules

> Advisory house rules — subordinate to CLAUDE.md (on conflict, CLAUDE.md wins). Routed by `read-rules.sh --with-ids`.

- E2E specs launch Electron only through app/e2e/electron-harness.ts (launchApp, launchGallery), which keeps every window hidden; never electron.launch or new BrowserWindow in a spec (app/scripts/hidden-windows.test.ts enforces it).
  - id: testing-e2e-specs-launch-electron-only-through-app-e2e-electron-harness-ts-launchapp-launchgallery-which-keeps-every-window-hidden-never-electron-launch-or-new-browserwindow-in-a-spec-app-scripts-hidden-windows-test-ts-enforces-it
  - enforcement: advisory
  - applies to: `app/e2e/menubar.spec.ts` (subtask 2), which launches through `launchApp` per the design notes.

## Touched-file invariants

> Grounded at base `310535f9bbfd90487aa735dca0f18e474152e394`. Every worker re-checks the entries for the files in its lanes before hand-back.

- **`app/electron/tray.ts`** — keep: the exported `export function createTray(` with `TrayDeps` (`readonly kernel: KernelConnection;` and `readonly showWindow: () => void;`). `app/electron/main.ts` calls `createTray({ kernel, showWindow })` after `await app.whenReady()` and is not edited. Nothing it reads from `kernel.request` is trusted to be well-shaped (a malformed body is a failed read, never a throw), and `kernel.openFeed` is single-flight. Every kernel call goes through `deps.kernel.request` (the main process's one connection, so the token stays in `kernel-connection.ts`); the tray never creates a `BrowserWindow` and never registers an `ipcMain` handler. mirror: the route shapes in `CONTRACT_ROUTES` (`app/src/api/contract.ts`: `{ method: "POST", path: "/pause", origin: "item-05" }`). pinned by: `app/electron/main.test.ts`, whose `expect([...electron.handlers.keys()].sort()).toEqual(["studio:connection", "studio:feed:subscribe", "studio:feed:unsubscribe", "studio:request"]);` (no new channel) and `await vi.waitFor(() => expect(electron.windows).toHaveLength(1));` (no second window) must hold unchanged.
- **`app/electron/deeplink.ts`** — keep: `export const DEEP_LINK_SCHEME = "loomwright-studio";` and `export function registerDeepLinks(` with `DeepLinkDeps` (`readonly navigate: (route: string) => void;`), called by `main.ts` before `app.whenReady()` (`registerDeepLinks({`). The link is untrusted input mapped through a closed list ("maps it to an app route through a closed list and never passes it anywhere else"). mirror: the kernel's link shape `export const DEEP_LINK_PREFIX = "loomwright-studio://notifications/";` (`kernel/src/notifications/record.ts`) and the scheme in `app/package.json` `"schemes": [`. Main → renderer travels only on `navigate: "studio:navigate",` (`app/electron/channels.ts`), received by the preload's `onNavigate: (listener: (route: string) => void) => listen(CHANNELS.navigate, listener),`.
- **`app/electron/main.test.ts`** — keep: every existing `it(` and its assertions byte-for-byte. The only change is new entries in the `vi.mock("electron", () => {` factory's returned object (`Tray`, `Menu`, `nativeImage`, `dialog`, and `app` members tray.ts / deeplink.ts call, such as `isPackaged` which already exists) so `main()` still reaches `createWindow()`. pinned by: itself, through `await vi.waitFor(() => expect(electron.windows).toHaveLength(1));`.
- **`app/src/screens/approvals/ApprovalsScreen.tsx`** — keep: selection by id (`const found = rows.find((a) => a.id === selectedId);`), the "oldest row when nothing is selected" default (`selectedId === null ? rows[0] : undefined`), the gone path (`const goneReason: GoneReason =`), the bridge guard's `data-state="no-bridge"` root, and `data-testid="screen-approvals"` in every state. The route only calls `setSelectedId`; it never calls `decide(`. pinned by: `app/src/screens/approvals/ApprovalsScreen.test.tsx` (it resets `window.location.hash = "";`) and `app/e2e/approvals.spec.ts` (AC1 selection by id), both unchanged and green.
- **`app/src/screens/approvals/ApprovalsScreen.test.tsx`** — keep: every existing test unchanged. Only add the route-selection tests.

## Pin mutations

All pins are new. Each mutation is applied to the code the pin protects, in a scratch copy, and must turn the pin red.

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/screens/menubar/kernel-mirror.test.ts`: the kernel's approval-notification title template | flip `` title: clip(`Approval ${id}: ${action}`, 199), `` → `` title: clip(`Approval #${id}: ${action}`, 199), `` in `kernel/src/approvals/store.ts` |
| `app/src/screens/menubar/kernel-mirror.test.ts`: the `kernel:approval` source | flip `source: "kernel:approval",` → `source: "kernel:approvals",` in `kernel/src/approvals/store.ts` |
| `app/src/screens/menubar/kernel-mirror.test.ts`: the deep-link prefix | flip `export const DEEP_LINK_PREFIX = "loomwright-studio://notifications/";` → `export const DEEP_LINK_PREFIX = "loomwright-studio://n/";` in `kernel/src/notifications/record.ts` |
| `app/src/screens/menubar/state.test.ts`: killed outranks paused | swap the `kill_switch.engaged` check below the `paused` check in `menubarState` in `app/src/screens/menubar/state.ts` |
| `app/src/screens/menubar/state.test.ts`: `loomwright-studio://approve/7` is invalid | let `parseDeepLink` accept any path segment in place of the literal `notifications` in `app/src/screens/menubar/state.ts` |
| `app/electron/tray.test.ts`: the paused dot waits for `/status` | set the state to `paused` straight from the `POST /pause` answer in `app/electron/tray.ts` |
| `app/electron/tray.test.ts`: Cancel on the kill confirm sends nothing | call `POST /stop-all` before awaiting `dialog.showMessageBox` in `app/electron/tray.ts` |
| `app/electron/tray.test.ts`: a packaged app sets no seam | drop the `app.isPackaged` condition from the seam guard in `app/electron/tray.ts` |
| `app/electron/deeplink.test.ts`: a pre-ready link waits for ready | call `navigate` directly from the `open-url` listener without awaiting `app.whenReady()` in `app/electron/deeplink.ts` |
| `app/electron/deeplink.test.ts`: a pre-ready link leaves exactly one window | flip `setImmediate(flush)` → `flush()` in `app/electron/deeplink.ts` |
| `app/electron/tray.test.ts`: a `{}` `/status` body throws nothing and keeps the state | delete the `/status` shape check in `app/electron/tray.ts` |
| `app/src/screens/menubar/menubar.test.tsx`: a route delivered twice within 2 s is handled once | delete the identical-route dedupe in the module-level queue in `app/src/screens/menubar/MenubarHost.tsx` |
| `app/electron/deeplink.test.ts`: AC4b (ii), no window → navigate again after `did-finish-load` (also covered on macOS by `app/e2e/menubar.spec.ts`) | delete the second `navigate(route)` after `did-finish-load` in `app/electron/deeplink.ts` |
| `app/electron/tray.test.ts`: Quit sends no request (D11) | add `void deps.kernel.request({ method: "POST", path: "/stop-all" })` to the Quit item's click handler in `app/electron/tray.ts` |
| `app/electron/tray.test.ts`: `kernel.openFeed` is single-flight (a second refresh while the first `openFeed` is pending makes no second call) | drop the pending-call guard before `kernel.openFeed` in `app/electron/tray.ts` |
| `app/src/screens/approvals/ApprovalsScreen.test.tsx`: `#/approvals/<id>` selects that id | delete the hash → `setSelectedId` effect in `app/src/screens/approvals/ApprovalsScreen.tsx` |
| `app/src/screens/menubar/menubar.test.tsx`: an invalid link toasts and sends no request | call `GET /notifications/:id` for `invalid-link` too, in `app/src/screens/menubar/MenubarHost.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Main process: shared menubar model, tray, deep links, main.test mocks | AC1 (model + tray unit), AC2, AC3 (tray), AC4b (unit), AC5 (tray side), AC8 (typecheck/test/build) | 3 modify, 4 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |
| 2 | Renderer: menubar screen + host + commands, approvals route selection, fixture, e2e spec, polish evidence | AC1 (e2e), AC3 (window), AC4, AC4b (e2e), AC5 (e2e), AC6, AC7, AC8 | 2 modify, 10 create (+ generated PNGs) | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (by #1) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "file", path: "app/src/screens/menubar/state.ts"}
  - {kind: "symbol", path: "app/src/screens/menubar/state.ts", name: "menubarState"}
  - {kind: "symbol", path: "app/src/screens/menubar/state.ts", name: "parseDeepLink"}
  - {kind: "symbol", path: "app/src/screens/menubar/state.ts", name: "parseNavigateRoute"}
  - {kind: "symbol", path: "app/src/screens/menubar/state.ts", name: "TRAY_SEAM_ENV"}
  - {kind: "symbol", path: "app/electron/tray.ts", name: "createTray"}
  - {kind: "symbol", path: "app/electron/deeplink.ts", name: "registerDeepLinks"}
requires: []
lanes:
  - "app/electron/tray.ts"
  - "app/electron/tray.test.ts"
  - "app/electron/deeplink.ts"
  - "app/electron/deeplink.test.ts"
  - "app/electron/main.test.ts"
  - "app/src/screens/menubar/state.ts"
  - "app/src/screens/menubar/state.test.ts"
external_requires: []
```

```yaml
# Subtask 2
provides:
  - {kind: "symbol", path: "app/src/screens/menubar/index.tsx", name: "screen"}
  - {kind: "file", path: "app/src/screens/menubar/links.ts"}
  - {kind: "file", path: "app/e2e/fixtures/menubar.ts"}
  - {kind: "file", path: "app/e2e/menubar.spec.ts"}
  - {kind: "file", path: "docs/evidence/phase-5-polish/menubar/README.md"}
requires:
  - {kind: "symbol", path: "app/src/screens/menubar/state.ts", name: "menubarState", from: 1}
  - {kind: "symbol", path: "app/src/screens/menubar/state.ts", name: "parseNavigateRoute", from: 1}
  - {kind: "symbol", path: "app/src/screens/menubar/state.ts", name: "TRAY_SEAM_ENV", from: 1}
  - {kind: "symbol", path: "app/electron/tray.ts", name: "createTray", from: 1}
  - {kind: "symbol", path: "app/electron/deeplink.ts", name: "registerDeepLinks", from: 1}
lanes:
  - "app/src/screens/menubar/index.tsx"
  - "app/src/screens/menubar/MenubarPanel.tsx"
  - "app/src/screens/menubar/MenubarHost.tsx"
  - "app/src/screens/menubar/links.ts"
  - "app/src/screens/menubar/menubar.css"
  - "app/src/screens/menubar/menubar.test.tsx"
  - "app/src/screens/menubar/kernel-mirror.test.ts"
  - "app/src/screens/approvals/ApprovalsScreen.tsx"
  - "app/src/screens/approvals/ApprovalsScreen.test.tsx"
  - "app/e2e/fixtures/menubar.ts"
  - "app/e2e/menubar.spec.ts"
  - "docs/evidence/phase-5-polish/menubar/**"
external_requires:
  - "Electron + Playwright available locally for `npm run e2e` (CI runs it under xvfb in .github/workflows/ci.yml)"
```

## Parallelism Analysis

### Dependency Graph
```
1 (main process + shared model) → 2 (renderer, e2e, evidence)
```

### File Overlap Matrix
No file appears in both subtasks' lanes. Subtask 2 imports `app/src/screens/menubar/state.ts` and exercises `tray.ts` / `deeplink.ts` end to end, so it runs after #1.

### Batch Plan
- **Recommended workers:** 1 at a time
- **Estimated batches:** 2 (batch 1: #1; batch 2: #2)

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): `GET /notifications/:id` carries no approval reference for `kernel:approval`. The app derives the id from the kernel-authored title `Approval ${id}: ${action}`. | MEDIUM | Derive only for source `kernel:approval` (agents can only post `agent:<name>` sources: `kernel/src/notifications/tool.ts` builds `` `agent:${…}` ``), anchored `^Approval ([1-9][0-9]{0,15}): `. A kernel-mirror test pins the template and the source (Pin mutations). Record the missing field as a finding in the evidence README. No kernel change (owner's LP-SCOPE answer). |
| Feasibility (Phase 2.5): edits outside the requirement's Touches (`app/electron/main.test.ts`, `ApprovalsScreen.tsx` + its test). | MEDIUM | Owner-approved (LP-SCOPE, 2026-10-22). main.test.ts gains mock entries only, and ApprovalsScreen gains the hash selection only. Touched-file invariants pin both. Neither file is in wave 2's other item (item 16 touches `app/src/screens/sessions/`, `app/e2e/sessions.spec.ts`, `app/e2e/fixtures/sessions.ts`, `docs/evidence/phase-5-polish/sessions/`). |
| Feasibility (Phase 2.5): context-bound size (19 authored files). | MEDIUM | Two serial subtasks with no file overlap (Configuration `Split reason`). |
| Cold-window deep link lost: `main.ts`'s `navigate` sends before a new window has loaded, and `open-url` can arrive before `app.whenReady()`. | HIGH | deeplink.ts holds pre-ready links and re-sends after `did-finish-load`. The renderer subscribes at module evaluation with a queue. AC4b tests both, in a unit test and in e2e. |
| A deep link causes an action (invariant 3). | HIGH | Closed grammar in `parseDeepLink`; only `notification/<id>` or `invalid-link` crosses IPC; a link's only request is `GET /notifications/:id`. AC4 asserts no `POST /approvals/*`, and an invalid link makes no request. |
| Quit or `before-quit` stops the kernel (D11). | HIGH | Quit is `app.quit()` only. AC5 checks the fixture's `requests` after quit and that it still answers. |
| On Linux (CI's e2e platform) `main.ts` quits on `window-all-closed` (`if (process.platform !== "darwin") app.quit();`), and `main.ts` is not edited. | MEDIUM | The window-closed e2e steps of AC4b and AC5 are skipped off macOS. The closed-window delivery path is unit-tested on every platform (AC4b (i)-(iii)). The README states the limit and the macOS run's result. Keeping the app alive on Linux is a product decision outside this item. |
| A pre-ready deep link opens a second window ahead of `main.ts`'s unconditional `createWindow()`. | HIGH | Deferred flush (`setImmediate` after `whenReady`). AC4b (i) asserts exactly one window; it has its own pin mutation. |
| Native `Tray` under Linux CI/xvfb may not render. | MEDIUM | The tray model and the seam are created whether or not the native icon displays. If `new Tray` throws on CI, catch it, log the reason, and keep the model and seam; record it in the README. A macOS run is the reference. |
| The native tray menu cannot be screenshotted by Playwright. | LOW | The polish evidence covers the status panel (the mockup's dropdown rendered in the window). The README states the limit, and the native menu is asserted through the seam model. |
| The ⌘K palette is not mounted in the running app (`App.tsx` mounts no palette host; first recorded by item 15). | LOW | Register the commands like the other screens and record the carried finding. Keyboard-only reach is asserted on the panel (AC7). |
| The menubar `SidebarSection` adds a sidebar button and breaks App.test's four-entry pin. | MEDIUM | The host renders no element with a button role inside the sidebar; toasts and the dialog go through a portal. `src/App.test.tsx` stays unchanged and green (AC8). |

## Configuration
- **Workers:** 1
- **Mode:** sequential
- **Estimated batches:** 2
- **Split reason:** context-bound
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-23-menu-bar-deep-links-pause-kill-switch.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-23T15:19:48Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/122
- **Branch:** feature/menu-bar-deep-links-pause-kill-switch
- **Files changed:** 37
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 2
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Menu-bar tray (shape-checked reads, no optimistic pause, confirmed kill switch, Quit = app.quit only, single-flight feed, window-timer throttle, stale indication), closed-grammar deep links with deferred pre-ready flush and cold-window re-send, #/menubar status panel + always-mounted link host + four menubar.* commands with persistent failure line, #/approvals/<id> selection, e2e spec and 18 light/dark evidence screenshots + README. Phase 4.5: review FAIL → fix 16002ec → FAIL → fix 94c0cac → PASS (6 issues fixed, 8 dismissed below MEDIUM floor). CI app/ci/claude-review green on 94c0cac. Review drain not dispatched (.auto_review=false; /automate owns the drain).

## Not verified
- **native macOS tray icon and menu rendering** — electron unit-mocked; Playwright cannot capture native menus, verified through the seam model only (subtask 1, 2)
- **tray dot colours** — createFromBitmap assumed BGRA; not observed on a real display (subtask 1)
- **open-url delivery in a packaged app** — needs a packaged build registered with LaunchServices (subtask 1)
- **⌘K palette listing the four menubar.* commands** — App.tsx mounts no palette host; only registry entries are unit-tested (subtask 2)
- **e2e on Linux/CI (xvfb)** — only a macOS run locally; window-closed test skips off macOS and native Tray under xvfb was not observed (subtask 2)
