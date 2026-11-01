# Supervisor Job: Shell: the shared unreachable band, sidebar, titlebar subtitle slot and the ~ path formatter (phase 7, item 11)

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-11-01-042119/L1
- **CLAUDE.md:** ✓ Found (fresh: every path in its "Where things are" table exists; `bash scripts/check-docs.sh` enforces it)
- **Git:** clean (0 files), branch: main, at origin/main
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (sibling phase 7 lanes 12 and 14–18 run in parallel and adopt this item's shell contract. Lane 16 edits `app/src/screens/schedules/`, and lane 14 edits `app/e2e/tasks.spec.ts`; this item changes one line in each. Before FINALIZE, check `git log origin/main` for overlap; see Risk Assessment.)
- **Source requirement:** .supervisor/requirements/phase-7/2026-11-01-090011-shell-shared-unreachable-band-sidebar-titlebar-slot-and-home-paths.md
- **Base commit:** d754f83ff53c3e8175f3f24980a1c8944ca5e156

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | React + Electron, vitest/jsdom, Playwright e2e launched through `app/e2e/electron-harness.ts`. Nothing new is needed. |
| 2 | Dependency Availability | GO | No new dependency. The mockup `docs/design/mockups/gui-v2.html` is merged and holds the sidebar glyphs (`I.chat`, `I.team`, `I.list`, `I.term`, `I.plug`, `I.board`, `I.book`, `I.clock`, `I.mem`, `I.gauge`, `I.gear`), `NAV_ORDER` with its `'|'` divider, the crew row (`avatarHTML(a,24)`, `.nm`, `.last`), the foot row (`#footdot`, `#foottext` "idle" / "kernel unreachable", `⌘K`), the title bar (`<h1>${R.title}</h1><span class="cap">${R.sub}</span>`) and `BAND`. |
| 3 | Architecture Fit | CAUTION | Four parts of the requirement live outside its Touches list. The owner settled all four in Launch Pad `LP-CLARIFY` on 2026-11-01 (see "Owner decisions (Launch Pad, 2026-11-01)" below). (a) The renderer cannot know the home folder: the preload is sandboxed (`sandbox: true` in `electron/main.ts`) and only `electron/kernel-connection.ts` calls `homedir()`. (b) Crew rows are drawn by `app/src/screens/chat/CrewSection.tsx`. (c) The "Schedules" label is `nav: { label: "Schedules", order: 8, shortcut: "⌘8" }` in `app/src/screens/schedules/index.tsx`. (d) After the kernel stops under an open window, the store reads `reconnecting` (it was live), and the shell shows the plain `ReconnectingBand`, not the red band; `e2e/store.spec.ts` AC4 and `e2e/tasks.spec.ts:366` pin that. |
| 4 | Scope vs Supervisor Capability | CAUTION | About 25 modify and 10 create (plus 4 generated PNGs). That is over the 12-file `context-bound` bound. The work splits into the home-folder bridge (independent, zero overlap) and the shell frame, which splits again into the band contract and the sidebar/titlebar (they share `App.tsx`, `App.test.tsx`, `app.css` and `e2e/shell.spec.ts`, so they serialise). |
| 5 | Hard Blockers | GO | No migration, no credentials, no kernel change. The e2e runs against the fixture kernel only. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Give the window's frame the approved mockup's shared pieces: one red "Couldn't reach the kernel" band owned by the shell plus a screen contract for keeping last data, a fixture that can stop and restart its listener, the sidebar's glyphs, divider, "Schedules & triggers" label, status row and mockup crew rows, a titlebar subtitle slot, and a `~` home-path formatter fed by a new read-only bridge member. Integrations moves onto the shared band.

**Problem Statement:**
The 2026-11-01 live run, with the kernel stopped by `launchctl bootout`, showed only Integrations with the red band. Every screen showed the small "Reconnecting to the kernel… Last updated" line (`app/src/shell/KernelStates.tsx`, `ReconnectingBand`), because the store reads `reconnecting` (not `unreachable`) once it was live. The screen items' fixture tests passed because they faked status 0 on a read instead of stopping the listener. The frame also differs from `gui-v2.html` on every screen: no sidebar glyphs, no group divider, "Schedules" instead of "Schedules & triggers", no status row, three-line crew rows, and no count line beside the title.
Success: stopping the fixture's listener under any screen shows the one red band (no reconnecting line), Integrations keeps its last data under it with writes off, and restarting the listener clears it. The sidebar and title bar match the mockup in light and dark. Every screen item (12, 14–18) can adopt the band contract, the subtitle slot and `formatHomePath` without touching shell files.

**Mockup (owner-approved by merging item 02):** `docs/design/mockups/gui-v2.html`. Views: `integrations-token` (frame: sidebar, titlebar) and `integrations-unreachable` (band, status row "kernel unreachable" with the danger dot). The band copy is `BAND` there, minus the "Kernel log" button (the app has no kernel log view; recorded in the evidence README). The shell renders it once above the screen (`${off?BAND:''}` in `renderMain`), and "the band above is the shared kernel-unreachable state and never appears with" a screen's route-failure card.

**Owner decisions carried from the requirement (binding):** Each screen adopts the shell in its own item; this item touches no screen folder but Integrations, plus the owner-approved lines below. The keyboard map and palette are item 13. Task states stay free text (D3). Nothing is patched outside the item's Touches, extended below; a worker that needs another file stops and says so. Invariants 1–9 unchanged. No raw request line (method, path, connection state) is rendered by the band.

**Owner decisions (Launch Pad `LP-CLARIFY`, 2026-11-01, binding; they extend Touches):**
1. **Home folder: extend Touches.** Add one optional, read-only bridge member `homeDir?(): Promise<string>` (channel `studio:home-dir`; the main process answers `app.getPath("home")`, takes no argument). Files: `app/electron/channels.ts`, `app/electron/main.ts`, `app/electron/preload.ts`, `app/electron/preload.test.ts`, `app/src/api/contract.ts`. The shell evidence README `docs/evidence/phase-7-polish/shell/README.md` is added too.
2. **Crew rows and the label: touch both.** Add `app/src/screens/chat/CrewSection.tsx`, `app/src/screens/chat/chat.css` and `app/src/screens/chat/crew.test.tsx`. Change the one `nav.label` line (and its header comment) in `app/src/screens/schedules/index.tsx` to "Schedules & triggers". It may need a one-line rebase against lane 16.
3. **Red band on `reconnecting`, update pins.** The shell shows the one shared band (testid `kernel-unreachable-band`, `role="alert"`) for `reconnecting` and `unreachable`, and drops the small reconnecting line. Update `app/e2e/store.spec.ts` AC4, `app/e2e/tasks.spec.ts:366` and `docs/architecture/app.md`, each with a stated reason. The pins the label change moves (`app/e2e/smoke.spec.ts` sidebar list, `app/e2e/phase-7-exit.spec.ts` `TOUR` nav labels) are updated under decision 2.

## Acceptance Criteria

Carried from the requirement (AC1–AC7), made concrete against the owner's decisions. AC8 is the home-folder bridge (owner decision 1).

- [ ] **AC1** Given Integrations loaded against the fixture kernel, when the fixture's listener stops (`fixture.stop()`), then the shared band (`kernel-unreachable-band`, `role="alert"`, "Couldn't reach the kernel. It may be restarting; this window reconnects on its own.") shows over Integrations' last data. The list row reads `status unknown · kernel unreachable`, Replace token / Switch to GitHub App / Disconnect / Refresh are disabled with `title="Needs the kernel"`, no `kernel-reconnecting-band` and no second band (`integrations-band` count 0) is on screen, and the sidebar status row reads "kernel unreachable". When the listener restarts (`fixture.restart()`, same port, same state), the band goes, the writes are enabled again and the row reads `connected · <account> · token`, matching `integrations-unreachable` and then `integrations-token`. Pinned in the new `app/e2e/shell.spec.ts`.
- [ ] **AC2** Given the shared band component, then a unit test pins that it never renders request text: rendered for each connection state (`reconnecting`, `unreachable` with each `reason`) its text is exactly the band copy and contains no HTTP method, no `/`-path, no connection-state word (`reconnecting`, `unreachable`, `not_installed`, `connection_failed`, a `reason` value) and no port.
- [ ] **AC3** Given any screen, then the sidebar shows a glyph (decorative, `aria-hidden`, through `Glyph`) beside each of the eleven entries (the mockup's glyph per screen), one divider (`<hr>` or `role="separator"`) between Chat … Integrations and Tasks … Settings, the entry "Schedules & triggers", and the bottom status row: the state word (`idle`, `working`, `paused`, `connecting` or `kernel unreachable`, derived only from the connection and `GET /status`, with the danger dot when unreachable) and the `⌘K` hint. Crew rows show the avatar, the name and one last line (single-line, ellipsised), as the mockup draws them, in light and dark. The unread dot, "off" dimming, the shared-name id and each row's accessible name still work (D34, D25).
- [ ] **AC4** Given a screen that declares a count line (`ScreenDefinition.Subtitle`), then the title bar shows it beside the title (`data-testid="titlebar-subtitle"`); given one that doesn't, the title alone with no empty subtitle element. Pinned by a unit test on the titlebar with two fake definitions. No screen declares one in this item; screen items 12 and 14–18 move their own lines.
- [ ] **AC5** Given `formatHomePath(path, home)` in `app/src/shell/home-path.ts`, then unit tests cover: a path under home reads `~/…`; home itself reads `~`; a path outside home reads in full; a path that only starts with the home folder's name (`/Users/<o>2/x` with home `/Users/<o>`) is not shortened; a trailing slash on home is tolerated; an empty or missing home returns the path unchanged.
- [ ] **AC6** Given VoiceOver, then every sidebar entry has an accessible name equal to its label (glyphs `aria-hidden`), each crew row is named for its agent and last line, the status row is a labelled `role="status"` ("Kernel: idle", and so on), and the `⌘K` hint is labelled "Command palette". Both themes meet WCAG 2.1 AA contrast, using only existing tokens (no new colour).
- [ ] **AC7** Given the polish gate, then a committed evidence file `docs/evidence/phase-7-polish/shell/README.md` names each screenshot against its mockup view (`integrations-token`, `integrations-unreachable`), each in light and dark (4 PNGs written by `e2e/shell.spec.ts` under `SHELL_EVIDENCE=1`). It lists every change this PR makes to the frame and the known remaining differences (the "Kernel log" button; count lines still under the title until each screen's item). The PR body links to it.
- [ ] **AC8** (owner decision 1) Given the preload bridge, then `api.homeDir()` answers the main process's `app.getPath("home")`, takes no argument (an argument is ignored), and is the only new key: `preload.test.ts`'s key list and `app/e2e/smoke.spec.ts:62`'s exposed-keys list add `homeDir`. `CHANNELS.homeDir` is in `INVOKE_CHANNELS`, `main.test.ts`'s handled-channel list adds `studio:home-dir`, and the handler refuses a caller that is not the owner window (`fromOwner`). `docs/architecture/app.md`'s bridge table has the row. A renderer hook `useHomeDir(api)` answers `undefined` when the member is missing (a test fake) or the call fails, and `formatHomePath` then shows the path in full.

**Evidence rule:** AC7's evidence lives in the committed `docs/evidence/phase-7-polish/shell/README.md` (a File Impact Map create), never only in the PR body.

**Validation (must pass before merge):** `cd app && npm ci && npm run typecheck && npm test && npm run build && npm run e2e`; `bash scripts/check-docs.sh`.

## The shared contract (fixed here; screen items adopt it)

- **The band:** `KernelBand` in `app/src/shell/KernelStates.tsx` (replacing `UnreachableBand` and `ReconnectingBand`): the warning glyph (`WarnGlyph`) and the fixed copy, `role="alert"`, a `testId` prop defaulting to `kernel-unreachable-band`, no other prop that carries text. The shell (`App.tsx`) renders it above the screen while `connection.state` is `reconnecting` or `unreachable`; `not_installed` keeps `NotInstalledState` in place of the screen.
- **The screen contract:** `app/src/shell/last-known.ts` exports `useKernelReach(api)` → `{ offline: boolean; shellBand: boolean }`, where `shellBand` is true while the shell shows the band and `offline` is `shellBand || not_installed`, plus `LAST_KNOWN = "last known"` and `withLastKnown(line, offline)` (appends ` · last known`). A screen keeps its last `ok` data while `offline`, marks it with `withLastKnown`, and disables every write with `title="Needs the kernel"`. A screen whose own read answered status 0 while the store still reads live (the moment before the feed notices) renders `<KernelBand testId=…/>` itself only when `!shellBand`, so exactly one band is ever on screen. `connection.ts` re-exports the contract's types next to `useKernelConnection`.
- **Integrations** uses it by folding `reach.offline` into the view once, where it is computed (`IntegrationsView.tsx:396`, `const view = viewOf(read);`): while `reach.offline` and `viewOf(read).phase === "ready"`, the view is `{ ...viewOf(read), phase: "unreachable", message: undefined }` (the last row kept, as `viewOf` keeps it for a status 0 answer). Every consumer then follows with no edit of its own: `isOffline(view)` at :398, `TokenDetail`'s own `offline = isOffline(view)` (:217), `AppDetail.tsx:35`, `ConnectSheet`'s `offline`, the list row's `rowMeta` (`model.ts:276`, `status unknown · kernel unreachable`) and the "Unknown while the kernel is unreachable" status line. `AppDetail.tsx` and `model.ts` are not edited. Its own band markup becomes `<KernelBand testId={IDS.band} />` rendered only when `!reach.shellBand`. `IDS.band` stays, so the existing `dropNextRead` specs keep their pins. When the connection is live again the existing `if (live && unanswered) refetch();` does not fire (the read never failed), and the fold simply lifts, showing the last `ok` read until the next event-driven refetch.
- **The titlebar slot:** `ScreenDefinition.Subtitle?: ComponentType` in `app/src/screens/types.ts` (the same shape as `SidebarSection`), rendered by `app/src/shell/Titlebar.tsx` beside the `<h1>`.
- **Home paths:** `formatHomePath(path, home)` (pure) in `app/src/shell/home-path.ts`, and `useHomeDir(api)` in `app/src/shell/useHomeDir.ts`.

## Feasibility findings carried forward
See `## Risk Assessment` (source "Feasibility (Phase 2.5)").

## File Impact Map

| Group | Files to Modify (lines at base) | Files to Create | Confidence |
|-------|----------------|-----------------|------------|
| home bridge (Subtask 1) | `app/electron/channels.ts` (32), `app/electron/main.ts` (182), `app/electron/preload.ts` (46), `app/electron/preload.test.ts` (100), `app/electron/main.test.ts` (372; the handled-channel list at :179, a name-aware `getPath` mock at :93, and the home answer and refusal cases), `app/src/api/contract.ts` (1440; one optional member on `StudioBridge`, by its siblings `openExternal?` / `prefs?`) | `app/src/shell/home-path.ts`, `app/src/shell/home-path.test.ts`, `app/src/shell/useHomeDir.ts` | HIGH |
| band contract (Subtask 2) | `app/src/shell/KernelStates.tsx` (73), `app/src/store/connection.ts` (21), `app/src/store/connection.test.tsx` (220), `app/src/App.tsx` (107), `app/src/App.test.tsx` (108), `app/src/styles/app.css` (191), `app/src/screens/integrations/IntegrationsView.tsx` (723), `app/e2e/fixture-kernel.ts` (322), `app/e2e/store.spec.ts` (220; AC4 only), `app/e2e/tasks.spec.ts` (655; line 366 only), `docs/architecture/app.md` (180; "React and the shell") | `app/src/shell/last-known.ts`, `app/src/shell/KernelBand.test.tsx`, `app/e2e/shell.spec.ts` | HIGH |
| band contract: conditional | `app/src/screens/integrations/integrations.test.tsx` (761), `app/src/screens/integrations/switch.test.tsx`: only where a test's fake connection makes `shellBand` true; each change with a one-line reason | — | LOW |
| sidebar + titlebar (Subtask 3) | `app/src/App.tsx`, `app/src/App.test.tsx`, `app/src/styles/app.css`, `app/src/components/Glyph.tsx` (26), `app/src/screens/types.ts` (21), `app/src/screens/chat/CrewSection.tsx` (153), `app/src/screens/chat/chat.css` (472), `app/src/screens/chat/crew.test.tsx` (209), `app/src/screens/schedules/index.tsx` (one `nav.label` line and its header comment), `app/e2e/smoke.spec.ts` (sidebar entry list), `app/e2e/phase-7-exit.spec.ts` (`TOUR` nav label), `app/e2e/shell.spec.ts`, `docs/architecture/app.md` (the shell's sidebar/titlebar lines) | `app/src/shell/Sidebar.tsx`, `app/src/shell/Titlebar.tsx`, `app/src/shell/frame.test.tsx`, `docs/evidence/phase-7-polish/shell/README.md` (+ 4 PNGs the e2e writes) | MEDIUM |

**Module layout (one home per new responsibility):**
- `App.tsx` (107) stays the router. The sidebar (entries, glyph map, divider, crew slot, status row) moves into a **CREATE** `app/src/shell/Sidebar.tsx`, and the title bar into a **CREATE** `app/src/shell/Titlebar.tsx`. `App.tsx` mounts both. The glyph per screen is a map keyed by screen id in `Sidebar.tsx` (the shell owns the sidebar; no screen folder changes for glyphs). The divider sits after `integrations` (`NAV_GROUP_END = "integrations"` there), as `NAV_ORDER`'s `'|'` does.
- The band is one component in `KernelStates.tsx` (the shell's existing home for the kernel states). The screen contract is a **CREATE** `last-known.ts`; `connection.ts` only re-exports its types.
- The `~` formatter is pure in **CREATE** `home-path.ts` (no React, so screen models can import it); the React hook is **CREATE** `useHomeDir.ts`.
- Tests: the band's never-request-text pin goes in **CREATE** `KernelBand.test.tsx`; the sidebar/titlebar pins in **CREATE** `frame.test.tsx`, never appended to `App.test.tsx` (which changes only where an existing expectation moves). The e2e for both subtasks is the **CREATE** `app/e2e/shell.spec.ts` (Subtask 2 creates it, Subtask 3 adds to it).
- `IntegrationsView.tsx` (723) gets no new responsibility: the band markup is replaced by the shared component, and `offline` reads the contract.
- The fixture's stop/restart stays in `fixture-kernel.ts` beside `close()`. Reason: it reuses the same server, sockets, feed and routes.

**Validator-owned surfaces:** `scripts/check-docs.sh` checks every relative link in `docs/` (the new README's 4 image links must resolve). Nothing else it scans changes.

**Total estimated files:** 25 unique modify + 10 create (+ 4 generated PNGs), and up to 2 conditional modifies (shared files between Subtasks 2 and 3 counted once).

### File Overlap Detection

| Group A | Group B | Overlapping Files | Serialization Required |
|---------|---------|-------------------|----------------------|
| Subtask 1 | Subtask 2 | none | NO |
| Subtask 1 | Subtask 3 | none in lanes; Subtask 3 updates `app/e2e/smoke.spec.ts:62` for Subtask 1's `homeDir` key | YES (3 after 1) |
| Subtask 2 | Subtask 3 | `app/src/App.tsx`, `app/src/App.test.tsx`, `app/src/styles/app.css`, `app/e2e/shell.spec.ts`, `docs/architecture/app.md` | YES (3 after 2) |

## Touched-file invariants

> Grounded at base `d754f83ff53c3e8175f3f24980a1c8944ca5e156`. Every worker re-checks the entries for the files in its lanes before handing back.

- **`app/electron/preload.ts`**
  - **keep:** "exposes exactly one key, `api`, on `window`"; "Nothing here hands the renderer `ipcRenderer`, a channel name, or any Node API." `homeDir` forwards over `ipcRenderer.invoke(CHANNELS.homeDir)` with no argument, like `revealDataDir: () => ipcRenderer.invoke(CHANNELS.revealDataDir) as Promise<boolean>,`.
  - **pinned by:** `app/electron/preload.test.ts` (`expect(Object.keys(api).sort()).toEqual(["connection", "feed", "onNavigate", "openExternal", "prefs", "request"]);`).
- **`app/electron/main.ts`**
  - **keep:** `sandbox: true` in `windowOptions`. Each handler is registered once through `ipcMain.handle(CHANNELS.…, async (event…) =>` and starts with the owner guard `if (!fromOwner(event)) throw new Error("refused");` (main.ts:60, 64, 68, 85, 92, 109, 113, 117); the home handler carries it too. The home handler ignores any argument and returns `app.getPath("home")`.
  - **pinned by:** `app/electron/main.test.ts` ("handles exactly the bridge's channels, and refuses a caller that is not its window"). Subtask 1 makes the Electron mock's `getPath` (main.test.ts:93, `getPath: () => electron.prefsDir`) name-aware (`(name) => name === "home" ? "/Users/o" : electron.prefsDir`), asserts `studio:home-dir` answers `"/Users/o"` with or without an argument, and asserts it rejects `"refused"` for `{ sender: {} }`.
- **`app/electron/channels.ts`**
  - **keep:** `INVOKE_CHANNELS` names exactly the channels the main process handles ("The channels the renderer may invoke (the main process handles exactly these).").
- **`app/src/shell/KernelStates.tsx`**
  - **keep:** `SETUP_STEPS` and `NotInstalledState` unchanged ("Setup stays in the owner's own terminal (D27, invariant 6)"). The band copy is exactly "Couldn't reach the kernel. It may be restarting; this window reconnects on its own." `formatLastUpdated` may be removed only if nothing else imports it (grep first).
- **`app/src/App.tsx`**
  - **keep:** screens are discovered by `import.meta.glob<ScreenModule>("./screens/*/index.tsx", { eager: true })`, so "no item edits this file" for a screen. `useScreenCommands` registers `screens.<id>` with `title: s.title` (the label change does not change palette titles). `{connection.state === "not_installed" ? <NotInstalledState dataDir={connection.dataDir} /> : <Screen />}` stays. `data-testid="sidebar"` and `aria-label="Screens"` on the nav stay.
  - **pinned by:** `app/src/App.test.tsx` ("registers each sidebar entry as a palette command", the heading-per-screen walk), `app/e2e/smoke.spec.ts` (`getByRole("navigation", { name: "Screens" }).getByRole("button")).toHaveText([`), `app/e2e/phase-7-exit.spec.ts` (`${NAV} .nav-text`; keep the `.nav-text` class on the label span).
- **`app/src/store/connection.ts`**
  - **keep:** `useKernelConnection(api)` returns `useLiveStore(api).connection` unchanged. The store's state machine (`store.ts`) is not edited: `reconnecting` still means "was live, is not now".
- **`app/src/screens/integrations/IntegrationsView.tsx`**
  - **keep:** "A status 0 answer is 'kernel unreachable', never 'not connected'." `const dis = offline ? { disabled: true, title: "Needs the kernel" } : {};`. The refetch on return (`if (live && unanswered) refetch();`). The list words `status unknown · kernel unreachable` and the status line `Unknown while the kernel is unreachable · last …`. Every kernel string is a text child.
  - **pinned by:** `integrations.test.tsx` ("status 0 with a connection is the kernel-unreachable state, never 'not connected'", `screen.getByTestId(IDS.band)` ×4), `switch.test.tsx:418`, `e2e/integrations.spec.ts:516,910`, `e2e/integrations-switch.spec.ts:479`, `e2e/phase-7-exit.spec.ts:926` (all `dropNextRead`, store still live, so `IDS.band` still renders through `KernelBand`).
- **`app/e2e/fixture-kernel.ts`**
  - **keep:** `close()` as it is (every existing spec uses it). `stop()` destroys sockets and terminates feed clients but does not `feed.close()` and keeps `routes`, `events`, `requests` and `dataDir`; `restart()` listens on the same `port` and leaves `api.json` unchanged. No real kernel, no real token ("FIXTURE_TOKEN").
- **`app/src/screens/chat/CrewSection.tsx`**
  - **keep:** "never Wright, D25"; "Off members sort last, dimmed and saying 'off' (their threads stay open to read, D34)"; "a member whose name collides with another's shows its id"; "It is always mounted, so it also registers Chat's ⌘K commands". The `crew-off`, `crew-unread`, `crew-id` test ids stay. "off" may move from text to a visually-hidden label plus dimming, but stays in the accessible name.
  - **pinned by:** `app/src/screens/chat/crew.test.tsx`; `app/e2e/chat.spec.ts` (read only; not in lanes; it must still pass).
- **`app/src/screens/schedules/index.tsx`**
  - **keep:** only `nav.label` and the header comment sentence about the label change. `title: "Schedules & triggers"` and `shortcut: "⌘8"` unchanged.
- **`app/e2e/store.spec.ts` / `app/e2e/tasks.spec.ts`**
  - **keep:** change only the assertions owner decision 3 moves (store.spec AC4's band testid, role and text; tasks.spec line 366's testid). Every other line stays, and lane 14 owns the rest of `tasks.spec.ts`.
- **Every new or changed e2e**: Electron is launched only through `launchApp` from `./electron-harness` (`.agent/rules/testing.json`; enforced by `app/scripts/hidden-windows.test.ts`).

## Closed enumerations touched

> Sibling grep at base `d754f83…`: `grep -rnF 'revealDataDir' --exclude-dir=node_modules --exclude-dir=.supervisor --exclude=CHANGELOG.md .` → 26 hits in 9 files (prefs-only hits in `settings.ts`, `settings.test.ts`, `useSettings.ts`, `SettingsScreen.test.tsx` and `fake-bridge.ts` are under `prefs`, not the top-level bridge, and need no change).

- **`homeDir`** (siblings: `CHANNELS.revealDataDir`, top-level `openExternal`). These hits must name it, or need no change:
  - `app/electron/channels.ts`: `CHANNELS` (`revealDataDir: "studio:reveal-data-dir",`) and `INVOKE_CHANNELS` (`CHANNELS.revealDataDir,`): extend both.
  - `app/electron/main.ts`: `ipcMain.handle(CHANNELS.revealDataDir, …)`: add `ipcMain.handle(CHANNELS.homeDir, …)`.
  - `app/electron/preload.ts`: the `api` object: add `homeDir`.
  - `app/electron/preload.test.ts`: the top-level key list (`["connection", "feed", "onNavigate", "openExternal", "prefs", "request"]`): extend with `"homeDir"`, sorted.
  - `app/e2e/smoke.spec.ts:62`: the exposed-keys pin (`expect(exposed).toEqual({ api: ["connection", "feed", "onNavigate", "openExternal", "prefs", "request"], require: "undefined", process: "undefined" });`): extend with `"homeDir"` after `"feed"`. Owned by Subtask 3, which now runs after Subtask 1 (see Subtask Structure).
  - `app/electron/main.test.ts:179-188`: the handled-channel list (`"studio:reveal-data-dir",`): extend with `"studio:home-dir"`, sorted. Found by a second sibling grep on the channel string, `grep -rnF 'studio:reveal-data-dir' app` (hits: `channels.ts:15`, `main.test.ts:187,305,330,331`, `docs/architecture/app.md:148`). Lines 305/330/331 are the prefs refusal and reveal cases: no change. Also `app/electron/preload.test.ts:86`, the "forwards each call" invoked list (not a closed key pin): extend it with `api.homeDir("x")` expecting `{ channel: "studio:home-dir", args: [] }`, AC8's "takes no argument" at the preload.
  - `app/src/api/contract.ts`: `StudioBridge` (`openExternal?(url: string): Promise<boolean>;`): add `homeDir?(): Promise<string>;`.
  - `docs/architecture/app.md`: the bridge table (`| \`prefs.revealDataDir()\` | \`studio:reveal-data-dir\` |`): add a row.
  - `app/src/store/fake-bridge.ts`: no change (the member is optional; `useHomeDir` treats it as missing).
- **Sidebar label "Schedules & triggers"** (sibling: `"Budget & audit"` in the smoke list). Grep `grep -rn '"Schedules"' app/src app/e2e`: `app/e2e/smoke.spec.ts:33` (entry list) and the `toHaveText([` list below it (`"Schedules⌘8"`): extend → `"Schedules & triggers⌘8"`. `app/e2e/phase-7-exit.spec.ts:335,453` (`nav: "Schedules"` and the `TOUR` list): change. `app/e2e/schedules.spec.ts:152` (`/^Schedules/`): no change (prefix match). `app/src/screens/schedules/commands.ts:20` (`SCHEDULES_GROUP = "Schedules"`): no change (a palette group, not the sidebar). `app/src/App.test.tsx:46` (`"Schedules⌘8",`): change → `"Schedules & triggers⌘8",` (Subtask 3's lane). `docs/evidence/phase-7-polish/schedules/README.md:72` ("The sidebar says \"Schedules\", not \"Schedules & triggers\""): becomes stale, but it is in no lane, so it is not patched here; the shell evidence README and the PR body name it for lane 16 or its follow-up (owner rule).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `home-path.test.ts`: a path that only starts with home's name is not shortened | in `home-path.ts`, drop the separator check so `path.startsWith(home)` alone shortens (applied by the reviewer) |
| `home-path.test.ts`: under home reads `~/…` | return `path` unchanged in `formatHomePath` (applied by the reviewer) |
| `preload.test.ts` and `app/e2e/smoke.spec.ts:62`: key list includes `homeDir` | delete the `homeDir:` line in `app/electron/preload.ts` |
| `main.test.ts:179`: the handled-channel list includes `studio:home-dir` | delete the `ipcMain.handle(CHANNELS.homeDir, …)` registration in `app/electron/main.ts` (applied by the reviewer: a multi-line call) |
| `preload.test.ts` "forwards each call": `api.homeDir("x")` invokes `{ channel: "studio:home-dir", args: [] }` | forward the argument (`(...args) => ipcRenderer.invoke(CHANNELS.homeDir, ...args)`) in `app/electron/preload.ts` (applied by the reviewer) |
| `main.test.ts`: `studio:home-dir` answers `"/Users/o"` | change the home handler to `app.getPath("userData")` in `app/electron/main.ts` |
| `main.test.ts`: `studio:home-dir` rejects `"refused"` for a caller that is not the window | delete the home handler's `fromOwner` guard line in `app/electron/main.ts` (applied by the reviewer: the guard line repeats on every handler) |
| `shell.spec.ts` AC1: the row reads `status unknown · kernel unreachable` after `stop()` | in `IntegrationsView.tsx`, compute `view` as `viewOf(read)` without the `reach.offline` fold (applied by the reviewer) |
| `KernelBand.test.tsx`: never renders request text | render a `detail` prop's text after the copy in `KernelBand` and pass the connection's `reason` from `App.tsx` (applied by the reviewer) |
| `connection.test.tsx` / `App.test.tsx`, `app/e2e/store.spec.ts` AC4 and `app/e2e/tasks.spec.ts:366`: `reconnecting` shows `kernel-unreachable-band`, `role="alert"`, and no `kernel-reconnecting-band` | in `App.tsx`, render the band only for `connection.state === "unreachable"` (applied by the reviewer) |
| `shell.spec.ts` AC1: after `stop()` exactly one band and `integrations-band` count 0 | in `IntegrationsView.tsx`, drop the `!reach.shellBand` guard so Integrations always draws its band when offline (applied by the reviewer) |
| `shell.spec.ts` AC1: band clears after `restart()` | make `restart()` in `fixture-kernel.ts` listen on port 0 (applied by the reviewer) |
| `frame.test.tsx`: a declared `Subtitle` renders beside the title; none renders no subtitle element | in `Titlebar.tsx`, render the subtitle `<span>` always (applied by the reviewer) |
| `frame.test.tsx`: one divider between Integrations and Tasks | delete the divider element in `Sidebar.tsx` |
| `frame.test.tsx`: every entry has a glyph and its accessible name equals its label | remove `aria-hidden` from the nav glyph in `Glyph.tsx` (applied by the reviewer) |
| `frame.test.tsx`: the status row reads "kernel unreachable" with the danger dot while `reconnecting` | map `reconnecting` to `connecting` in `Sidebar.tsx`'s state word (applied by the reviewer) |
| `crew.test.tsx`: one last line, no time element in the row | re-add the `<time className="chat-crew-time"` element to `CrewSection.tsx` (applied by the reviewer) |
| `smoke.spec.ts`, `App.test.tsx:46` and `phase-7-exit.spec.ts` `TOUR`/nav labels: entry list includes "Schedules & triggers⌘8" | revert `nav.label` to "Schedules" in `app/src/screens/schedules/index.tsx` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Home folder: the read-only `homeDir` bridge member, `formatHomePath` and `useHomeDir`, with tests | AC5, AC8 (bridge-table row in app.md and the smoke.spec key pin are written by Subtask 3) | 6 modify, 3 create | `skills/unit-testing/SKILL.md` | LAUNCHABLE |
| 2 | Shared band contract: `KernelBand`, `last-known.ts`, the shell shows the band on `reconnecting`/`unreachable`, Integrations onto it, fixture `stop()`/`restart()`, `shell.spec.ts` AC1, store/tasks spec pin updates, app.md "React and the shell" | AC1, AC2 | 11 modify (+2 conditional), 3 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |
| 3 | Frame: `Sidebar.tsx` (glyphs, divider, status row), crew rows, "Schedules & triggers", `Titlebar.tsx` and `ScreenDefinition.Subtitle`, frame tests, label pins, the smoke.spec bridge-key pin, polish-gate screenshots and evidence README, app.md (frame + bridge row) | AC3, AC4, AC6, AC7, AC8 (docs row, smoke.spec:62) | 13 modify, 4 create | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` | BLOCKED (from: 1, 2) |

### Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "app/electron/channels.ts", name: "homeDir"}
  - {kind: "symbol", path: "app/src/api/contract.ts", name: "homeDir"}
  - {kind: "file", path: "app/src/shell/home-path.ts"}
  - {kind: "symbol", path: "app/src/shell/home-path.ts", name: "formatHomePath"}
  - {kind: "file", path: "app/src/shell/useHomeDir.ts"}
  - {kind: "symbol", path: "app/src/shell/useHomeDir.ts", name: "useHomeDir"}
  - {kind: "file", path: "app/src/shell/home-path.test.ts"}
requires: []
lanes:
  - "app/electron/channels.ts"
  - "app/electron/main.ts"
  - "app/electron/main.test.ts"
  - "app/electron/preload.ts"
  - "app/electron/preload.test.ts"
  - "app/src/api/contract.ts"
  - "app/src/shell/home-path.ts"
  - "app/src/shell/home-path.test.ts"
  - "app/src/shell/useHomeDir.ts"
external_requires: []
```

```yaml
# Subtask 2
provides:
  - {kind: "symbol", path: "app/src/shell/KernelStates.tsx", name: "KernelBand"}
  - {kind: "file", path: "app/src/shell/last-known.ts"}
  - {kind: "symbol", path: "app/src/shell/last-known.ts", name: "useKernelReach"}
  - {kind: "symbol", path: "app/src/shell/last-known.ts", name: "withLastKnown"}
  - {kind: "file", path: "app/src/shell/KernelBand.test.tsx"}
  - {kind: "symbol", path: "app/e2e/fixture-kernel.ts", name: "stop"}
  - {kind: "symbol", path: "app/e2e/fixture-kernel.ts", name: "restart"}
  - {kind: "file", path: "app/e2e/shell.spec.ts"}
requires: []
lanes:
  - "app/src/shell/KernelStates.tsx"
  - "app/src/shell/last-known.ts"
  - "app/src/shell/KernelBand.test.tsx"
  - "app/src/store/connection.ts"
  - "app/src/store/connection.test.tsx"
  - "app/src/App.tsx"
  - "app/src/App.test.tsx"
  - "app/src/styles/app.css"
  - "app/src/screens/integrations/IntegrationsView.tsx"
  - "app/src/screens/integrations/integrations.test.tsx"
  - "app/src/screens/integrations/switch.test.tsx"
  - "app/e2e/fixture-kernel.ts"
  - "app/e2e/shell.spec.ts"
  - "app/e2e/store.spec.ts"
  - "app/e2e/tasks.spec.ts"
  - "docs/architecture/app.md"
external_requires:
  - "Playwright + the built Electron app (`npm run build`) on macOS"
```

```yaml
# Subtask 3
provides:
  - {kind: "file", path: "app/src/shell/Sidebar.tsx"}
  - {kind: "file", path: "app/src/shell/Titlebar.tsx"}
  - {kind: "symbol", path: "app/src/screens/types.ts", name: "Subtitle"}
  - {kind: "file", path: "app/src/shell/frame.test.tsx"}
  - {kind: "file", path: "docs/evidence/phase-7-polish/shell/README.md"}
requires:
  - {kind: "symbol", path: "app/electron/channels.ts", name: "homeDir", from: 1}
  - {kind: "symbol", path: "app/src/shell/KernelStates.tsx", name: "KernelBand", from: 2}
  - {kind: "symbol", path: "app/src/shell/last-known.ts", name: "useKernelReach", from: 2}
  - {kind: "symbol", path: "app/e2e/fixture-kernel.ts", name: "stop", from: 2}
  - {kind: "file", path: "app/e2e/shell.spec.ts", from: 2}
lanes:
  - "app/src/App.tsx"
  - "app/src/App.test.tsx"
  - "app/src/styles/app.css"
  - "app/src/components/Glyph.tsx"
  - "app/src/screens/types.ts"
  - "app/src/shell/Sidebar.tsx"
  - "app/src/shell/Titlebar.tsx"
  - "app/src/shell/frame.test.tsx"
  - "app/src/screens/chat/CrewSection.tsx"
  - "app/src/screens/chat/chat.css"
  - "app/src/screens/chat/crew.test.tsx"
  - "app/src/screens/schedules/index.tsx"
  - "app/e2e/smoke.spec.ts"
  - "app/e2e/phase-7-exit.spec.ts"
  - "app/e2e/shell.spec.ts"
  - "docs/architecture/app.md"
  - "docs/evidence/phase-7-polish/shell/**"
external_requires:
  - "Playwright + the built Electron app (`npm run build`) on macOS for the light/dark screenshots"
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1 (independent)
Subtask 2 (independent)
Subtask 3 ──requires──> Subtask 1, Subtask 2
```
Subtask 3 also needs Subtask 1 because `app/e2e/smoke.spec.ts:62` (in Subtask 3's lane) pins the bridge's key list, which Subtask 1 extends.
Subtask 3 mounts the band from Subtask 2 in the new `Sidebar`/`Titlebar` layout, reads `useKernelReach` for the status row, and adds the screenshot run to `shell.spec.ts`. Subtask 1 is consumed by Subtask 3 (the smoke.spec key pin) and by item 12 (Memory).

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | Subtask 2 | none | NO |
| Subtask 1 | Subtask 3 | `app/e2e/smoke.spec.ts:62` pins Subtask 1's key list (in Subtask 3's lane) | YES |
| Subtask 2 | Subtask 3 | `App.tsx`, `App.test.tsx`, `app.css`, `e2e/shell.spec.ts`, `docs/architecture/app.md` | YES |

### Batch Plan
- **Batch 1:** Subtask 1, Subtask 2 (parallel)
- **Batch 2:** Subtask 3
- **Recommended workers:** 2
- **Estimated batches:** 2

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md` |
| 2 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |
| 3 | `skills/frontend-ui/SKILL.md`, `skills/unit-testing/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

### Cited-line premise check

| ref | resolves | premise | deciding line | as of |
|-----|----------|---------|----------------|-------|
| `app/src/shell/KernelStates.tsx:41` | yes | HOLDS | `export function ReconnectingBand({ lastUpdated }: { readonly lastUpdated: number \| null }) {` (the small line the requirement names; :41 is the band's copy line) | base d754f83 |
| `app/src/App.tsx:96-97` | yes | HOLDS | `<header className="titlebar">` / `<h1 className="titlebar-title">{current.title}</h1>` | base d754f83 |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): the home folder, crew rows, the "Schedules" label and the reconnecting band sit outside the requirement's Touches. | HIGH | Owner settled all four in `LP-CLARIFY` (2026-11-01); the extended files are listed in the lanes above. A worker that needs any other file stops and says so (owner rule). |
| Feasibility (Phase 2.5): about 35 files, over the 12-file single-worker bound. | MEDIUM | Split into three subtasks (`context-bound`); 1 and 2 run in parallel, 3 runs after 1 and 2. |
| Showing the red band on `reconnecting` turns a sub-second kernel restart into a red flash, which the old design called "not an error yet". | MEDIUM | The owner chose the mockup (decision 3). Record it in app.md. Do not add a timer or grace period (not in the mockup). |
| Screens not yet migrated (Tasks, Memory, Playbooks, Schedules, Budget, Settings) still draw their own "Couldn't load" or "Status unknown" under the shell band until their items land. | MEDIUM | Expected per the requirement's shaping. The evidence README lists it. Screen specs using the band union locator (`kernel-unreachable-band, kernel-reconnecting-band`) still pass; run the full e2e. |
| `tasks.spec.ts` and `schedules/index.tsx` are edited by parallel lanes 14 and 16. | MEDIUM | Each change here is one line. Rebase on `origin/main` before FINALIZE and resolve keeping both sides; never revert a sibling's line. |
| Integrations unit tests whose fake store reads `reconnecting` would lose `IDS.band` (the shell draws it, not the screen). | LOW | Update only those assertions, to the disabled controls and status words, with a one-line reason. The `dropNextRead` paths keep `IDS.band`. |
| The fixture's `stop()` reusing a closed `WebSocketServer` would refuse the feed after `restart()`. | MEDIUM | `stop()` terminates clients but never calls `feed.close()`. The AC1 restart assertion (band clears, writes back on) catches it. |
| Crew rows dropping the time and the "off" word lose information an e2e reads (`chat.spec.ts`). | LOW | Keep `crew-off`/`crew-unread`/`crew-id` test ids and the accessible name. Run `chat.spec.ts`; if it pins the time element, stop and report (not in lanes). |
| `docs/evidence/phase-7-polish/schedules/README.md:72` says the sidebar reads "Schedules"; the label change makes it stale, and the file is in no lane. | LOW | Do not patch it (owner rule). Name it in the shell evidence README and the PR body for lane 16 or a follow-up. |
| Screenshot pixels differ between machines. | LOW | Assert behaviour, never pixels. Write the PNGs only under `SHELL_EVIDENCE=1`, and test that the tracked dir is untouched otherwise (the settings.spec pattern). |

## Configuration
- **Workers:** 2
- **Mode:** parallel
- **Estimated batches:** 2
- **Base Branch:** main
- **Split reason:** context-bound

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-11-01-shell-shared-unreachable-band-sidebar-titlebar-slot-and-home-paths.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-11-01T05:47:02Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/192
- **Branch:** feature/shell-shared-unreachable-band-sidebar-titlebar-slot-and-home-paths
- **Files changed:** 39
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 0
- **Heal reason:** needs_human
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Test guard:** armed
- **Summary:** All 3 subtasks merged (homeDir bridge + formatHomePath/useHomeDir; shared KernelBand contract + Integrations fold + fixture stop/restart; Sidebar/Titlebar/crew rows/"Schedules & triggers" + evidence README and 4 PNGs). Reviewer: all AC1–AC8 addressed, 13 hand-applied pin mutations held, 371/371 targeted unit tests, required CI green. Escalated NEEDS_HUMAN: e2e integrations.spec.ts:508, :903 and integrations-switch.spec.ts:473 still expect integrations-band after dropNextRead (which closes the fixture kernel → store reconnecting → shell band per owner decision 3); the fix is one locator per test but those files are outside the brief's Touches. Confirmed locally: those 3 fail, 236 other e2e pass (incl. chat.spec.ts). rules_check: none; rules_audit: clean; house_rules: followed 1.
