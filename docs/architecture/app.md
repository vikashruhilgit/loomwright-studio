# The app

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Item 01 (the phase 5 foundation) built the scaffold: the main/renderer split, the kernel connection, the one-key preload, the stub screens and the package. Items 12-17 build the rest and document it here:

- item 12: the app's live store (REST reads plus the event feed, with reconnect and the kernel-unreachable state);
- item 13: Chat and the Crew threads;
- item 14: the Team screen;
- item 15: the Approvals screen;
- item 16: the Sessions screen;
- item 17: the menu bar, deep links, Pause all and the kill switch.

**Contract types it fills** (`app/src/api/contract.ts`): `StudioBridge` (what the preload exposes as `window.api`), `KernelConnectionState` and `KernelUnreachableReason`, `ApiRequest` and `ApiResult`, `FeedRelayFrame`, and `ContractRouteMap` / `RouteKey` over `CONTRACT_ROUTES`. Each screen reads the route types of the existing routes and of items 02-07's.

How the app is split, and why the token never reaches the renderer, is in [ARCHITECTURE.md](../ARCHITECTURE.md#phase-5-features) until these items document it here.

## The live store (item 12)

Built by item 12 in `app/src/store/` (`store.ts`, `resources.ts`, `react.ts`, `connection.ts`) and `app/src/shell/KernelStates.tsx`. Every screen reads the kernel through this one store: REST reads through the preload bridge, kept current by the [event feed](feed.md). It shows only what the kernel answered: a resource holds a body only from an `ok` answer, `status` is `undefined` until `GET /status` answers, and a failed read keeps the last data with its error (`refused`, `not_connected` or `bridge_failed`).

### Resources

A resource is one contract `GET` (`FIXED_RESOURCES` in `resources.ts`): `status` (`GET /status`), `approvals`, `grants` (`GET /approvals/grants`), `agents`, `messages` (`GET /messages?all=1`), `sessions`, `playbooks`, `triggers` (`GET /triggers?all=1`) and `notifications`, plus one `thread:<agent>` per agent (the first page of `GET /threads/:agent`; paging backwards is item 13's). `status` loads when the store starts, every other resource on its first use (`load`), and from then on the feed keeps it current.

### Following the feed

The store subscribes with `after = lastEventId` and drops every event whose id is not above it, counting it in `duplicatesDropped`, so a resubscribe after a kernel restart loses nothing and replays nothing. A frame that is not well formed (an event needs a positive integer `id` and a string `kind`) is ignored. The last 1 000 events (`EVENT_LOG_LIMIT`) are kept in `eventLog`, in id order; a truncated frame's row is read back with `GET /events?after=<id-1>&limit=1`.

An event says which resources to refetch by its `kind` alone. `payload` is untrusted stored JSON and is never read. `KIND_ROUTES` matches the kind by prefix, first match wins:

| Kind prefix | Refetches |
|---|---|
| `approval_` | `approvals`, `grants` |
| `agent_message_` | `messages` |
| `agent_` | `agents` |
| `playbook_` | `playbooks`, `triggers` |
| `trigger_` | `triggers` |
| `wakeup_` | `triggers`, `status` |
| `notification_`, `notify` | `notifications` |
| `session_`, `stop_`, `tool_decision` | `sessions`, `status` |
| `event_` | `status`, `messages` |
| anything else (`DEFAULT_ROUTE`) | `status` |

Every event also refetches each loaded thread, and only resources already in use are refetched. Refetches are throttled per resource (`REFETCH_THROTTLE_MS`, 250 ms): leading and trailing edge, at most one read per window and at most one in flight. The window is a timer started with each read, not arithmetic on the wall clock, so a clock step can't stall it.

### Connection

The store's view (`LiveConnection`) is the kernel's own answer, never a guess:

- `connecting` until the first attempt succeeds;
- `live` while the feed is open;
- `reconnecting` once the store was live and is not now, with `lastUpdated` (when it last received anything from the kernel: a REST answer, an event or a heartbeat);
- `not_installed` and `unreachable`: the bridge's answer, passed through unchanged, only while the store was never live.

An attempt is `connection()` (the main process's `api.json`, pid, token and `GET /status` check), the id-space check below, then `feed.subscribe(lastEventId)`, then the feed proving itself: a frame, or `SETTLE_MS` (2 s) open with no close. Only then is the store `live`, and going live refetches every used resource. A failed attempt, including a close before the feed proved itself, retries after a backoff that starts at `BACKOFF_INITIAL_MS` (500 ms) and doubles up to `BACKOFF_CAP_MS` (10 s); success resets it. Every resource reads `stale: true` whenever the view is not `live`.

`dispose()` unsubscribes the feed, removes the listener and clears every timer, keeping the data and `lastEventId`. The view becomes `reconnecting` if the store was ever live (a restart resumes from that id), else `connecting` (a `not_installed` or `unreachable` answer from before is not the kernel's answer now). `start()` on a disposed store starts it again.

**Id-space reset.** Event ids are comparable only within one event table. Before resubscribing with `lastEventId > 0`, the store reads `GET /status` for the kernel's pid. If it is not the pid the ids came from, it reads the last event's row (`GET /events?after=<id-1>&limit=1`); a row that is gone or different (another `kind` or `at`) means the table was wiped, so `lastEventId` and `eventLog` reset and the store resubscribes from 0. The same pid or the same row keeps the ids. A refusal is not proof of a wipe: the ids are kept. Once a reconnect check has run on the ids, only a row check that decided records their pid; a refused or overtaken row read leaves it `UNVERIFIED`, so the next reconnect checks again.

### React and the shell

`react.ts` keeps one store per bridge. `useHeldStore` counts the components holding it: the first starts it and the last one's unmount disposes it, which also covers `<StrictMode>`'s double effects. `useLiveStore` returns the snapshot and `useResource(name)` one resource, loading it on first use, both through `useSyncExternalStore`. `useKernelConnection` (`connection.ts`) returns the snapshot's connection view, which `App.tsx` turns into the shell's states (`KernelStates.tsx`):

- `unreachable`: the danger band over the current screen ("Couldn't reach the kernel").
- `reconnecting`: the plain band (`role="status"`) over the current screen, "Reconnecting to the kernel…", with the last-updated time as `HH:MM:SS` when there is one. The data on screen stays, marked stale.
- `not_installed`: in place of the screen, the setup steps (`SETUP_STEPS`) the owner runs in his own terminal, `claude setup-token`, `security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w` and `studio service install`, and the `api.json` path it looked for.

**Tests:** `app/src/store/store.test.ts` (routing and throttling, dedupe, resume and the id-space check, connection states and backoff, honest data, failure paths, dispose) and `app/src/store/connection.test.tsx` (the shell's states and the hooks) run on the scriptable bridge in `app/src/store/fake-bridge.ts`. `app/e2e/store.spec.ts` runs the store against the fixture kernel through the real kernel connection (refetch and throttle, resume across a restart) and launches the app to see the reconnecting band come and go (`npm run build` first).

## The open-external channel

The window can't open the system browser itself: `lockDown` (`app/electron/main.ts`) denies every new window and every navigation, and that stays. The one way out is the `studio:open-external` IPC channel, reached as `window.api.openExternal(url)` (an optional member of `StudioBridge`; a caller treats a missing method as `false`). It answers a boolean and nothing else: `true` once `shell.openExternal` accepted the address, `false` for everything else. The renderer is given no channel name, no `ipcRenderer` and no Node API. Three more invoke channels carry the app's own preferences (see "The app's own preferences" below); none of them opens an address.

The main process's handler, in order:

1. refuses a caller that is not its own window (`throw new Error("refused")`, like every other handler);
2. answers `false` for an argument that is not a string;
3. answers `false` unless the kernel is `connected` right now (the kernel's start page is only valid on the port the kernel has now, read from `kernel.connection()` at call time, never cached);
4. answers `false` unless `isAllowedExternal(url, port)` says yes, and then opens the address. The renderer's address is re-checked here and never trusted. A failure to open also answers `false` and logs a reason with no address in it, because the setup `state` is in the query.

`isAllowedExternal` (`app/electron/open-external.ts`) is a pure function. It allows exactly three forms:

| Form | Rule |
|---|---|
| The kernel's GitHub App start page | `http://127.0.0.1:<the kernel's current port>/connectors/github/app/start?state=<state>`: host `API_HOST`, that port, that path, and a query of `state` alone (one non-empty value) |
| The installations page | `https://github.com/settings/installations` |
| One App's page | `https://github.com/settings/apps/<slug>`, where `<slug>` matches `^[a-z0-9][a-z0-9-]*$` |

Anything else is refused: another host or port, `localhost` for `127.0.0.1`, `https:` on the loopback host, `http:` on `github.com`, another path or a path prefix, any other query, userinfo, a fragment (even an empty one), `javascript:`, `file:`, `data:`, the bare `https://github.com/settings/apps`, and a slug with `/`, `..`, `%2F` or any escape. The address must also be exactly what the URL parser would write back, so a spelling it would rewrite (a case change, a stripped default port, a resolved `..`, a dropped tab or newline) is refused, never normalised into an allowed address.

**Tests:** `app/electron/open-external.test.ts` (the allowlist, one case per off-list form), `app/electron/main.test.ts` ("the open-external channel": the caller check, a non-string argument, a kernel that is not connected, the port read at call time, a failed open) and `app/electron/preload.test.ts` (the method forwards over `studio:open-external`, the three prefs methods forward over their channels, and the bridge's key list). `app/e2e/smoke.spec.ts` pins the built preload's key list.

## The GitHub App connect (renderer)

The Integrations screen (`app/src/screens/integrations/`) offers the GitHub App beside the token. With nothing connected, Connect GitHub (the empty state's button and `⌘K`) opens a **choice** (`ConnectSheet.tsx`, its first view): "Install GitHub App" or "Paste a token". "Paste a token" shows the token form unchanged. Replace token on a token connection still opens the token form directly. "Install GitHub App" mounts the setup dialog (`AppSetupSheet.tsx`), which follows the setup to its end. Copy is lifted from `docs/design/mockups/integrations.html` (`appSheetHTML`, `appDetailHTML`); the mapping from the kernel's refusals to the mockup's views is `app-setup.ts`.

**What the dialog does.** On open it calls `POST /connectors/github/app/setup` once (a ref guards it, so StrictMode's double effects make no second call), then opens the returned `setup_url` through the open-external channel. A channel that answers `false` (or a bridge without the method) is setup-failed, never a silent no-op, and the window the setup opened is cancelled. "Open GitHub again" opens the same `setup_url` with no second setup call. Cancel, Escape and a press on the backdrop all call `POST /connectors/github/app/setup/cancel` once and show setup-cancelled; before the setup call has been answered, the cancel waits for the answer and cancels the window that answer opened. A dialog that goes away while the setup runs (the screen unmounts) cancels its window too. "Set up again" mounts a fresh dialog, which makes a new setup call; Close from an outcome view cancels nothing, since the window is already closed.

**The `setup_url` the channel accepts.** Exactly `http://127.0.0.1:<the kernel's current port>/connectors/github/app/start?state=<state>`: that path, and a query of `state` alone. The kernel setup item must return this shape, and no other, from `POST /connectors/github/app/setup`. The channel refuses anything else (see "The open-external channel"). The two GitHub pages the views link to are `https://github.com/settings/installations` and `https://github.com/settings/apps/<slug>`; the bare `https://github.com/settings/apps` is not allowed, so a view that has no slug shows that address as text to copy.

**The step-2 signal ("Create done, now Install").** The contract does not say what marks it, so the dialog defines it, and the kernel confirms it: since the token-to-App switch (phase 7 item 09), the kernel's `storeApp` appends one `connector_status` event whenever it records the App's slug, over an existing row as well as when it creates one (`docs/architecture/integrations.md` "The port"). Before that it appended none over an existing row, so with a token in use (or after a Disconnect) the dialog never left step 1 against the real kernel; the e2e fixture's `app-created`, which makes an App row and its own event, hid it. The event bullet below is therefore the signal the kernel sends. The dialog moves from step 1 (Create) to step 2 (Install) on either of:

- a `connector_status` event, arriving after the setup call was answered, whose payload has no `refused` (a `refused` that is absent, `null` or `""` is no refusal);
- the GitHub row becoming an App connection (`method: "app"`) with a well-formed `app_slug` and no `installation_id`, with its `updated_at` changed since the dialog opened.

Events from before the dialog opened are ignored (the dialog remembers the newest event id when it mounts), and so are non-refusal events that arrive before the setup call is answered. A signal the dialog does not recognise leaves it on step 1; it never crashes. The dialog closes when the connector reads `connected` or `expiring` with `method: "app"`.

**The `refused` reading.** A refusal is read from the `refused` field of a `connector_status` event's payload (the shape the token path's events already use), or from the error code of a refusal of the setup route. The value is only ever checked against the closed list (`GitHubAppSetupRefusal`), never rendered:

| Reason | View |
|---|---|
| `setup_expired` | setup-expired |
| `token_write_scoped` | write-scoped (it lists the permissions a `write_permissions` array on the event or refusal body names, as the token sheet does; none are listed when it carries none) |
| `conversion_failed`, `install_failed` | setup-failed |
| `setup_not_open`, `state_mismatch`, `not_implemented`, and any other value | setup-failed (the mockup has no view for the first two; a new view needs the owner's approval) |

The kernel's `message` is never shown. The first outcome stands: a refusal arriving after Cancel does not replace setup-cancelled. The window's `expires_at` passing, by the clock, is setup-expired. An App slug in an event's payload (`app_slug`) is used for the "Open your GitHub Apps" link only if it matches `^[a-z0-9][a-z0-9-]*$`.

**The detail pane.** A row with `method: "app"` gets `AppDetail.tsx`: the `GitHub App` badge, the App row (the slug, because `Connector` carries no App name), the installation, the key (never shown), the access token's expiry with "renews automatically", "Read-only, checked by GitHub" with the permissions GitHub reported (it says nothing is read-only if a level above Read is reported), "Repos chosen at install" (the row's `reachable_repos`), no Replace token and no expiry band. A `rejected` App row with both a slug and an installation is **revoked** (`app-revoked`): the danger band, the last-read data kept, Set up again as the primary; a `rejected` App row without an installation is a refused setup and reads as not connected. Disconnect on an App connection confirms what Studio removes (the App's key, from the Keychain) and links to `https://github.com/settings/installations` and to the App's page, each through the channel. `⌘K` Connect GitHub is disabled while an App is connected or revoked (the mockup's "disconnect first"; the command registry has no field for the reason, so the palette shows the command off without the words).

**Switching from a token (`switch.test.tsx`, `integrations-switch.spec.ts`).** On a token connection (connected, expiring or expired, no App) the detail header offers **Switch to GitHub App**, between Replace token and Disconnect (the mockup's order, `docs/design/mockups/gui-v2.html`, views `integrations-token` to `integrations-token-to-app-failed`), and the palette offers "Switch GitHub to the GitHub App" (`integrations.switch-to-app`, group Integrations), enabled only while a token is in use, the kernel is reachable and no App is connected. Both call one handler, which is `startApp` run while a token is in use: the same dialog, the same one setup call, the same cancel and step logic, told it runs over a token (`overToken`). Nothing in the switch disconnects, writes a token or edits a row. The token goes only when the kernel records the install (`recordInstallation`), and the screen learns that the usual way, from `connector_status` and `GET /connectors`, when the row reads `method: "app"` and the dialog closes.

What the token's owner sees differs from the no-token dialog in words and buttons only:

| Where | Words |
|---|---|
| Dialog, running | "Switch GitHub to the GitHub App", with "GitHub stays connected through your token while this runs, and keeps working if you cancel or setup fails." and "When it connects, the token item is removed."; the live region adds "GitHub stays connected through the token." to each step. |
| List row | The token's own words (`rowMeta`) with `token · setting up the App` while it runs (`connected · <account> · token · setting up the App`), and `token` after it ended, in place of `appRowMeta`'s "not connected" notes (`switchRowMeta` in `app-setup.ts`). The detail pane stays the token's. |
| Cancelled (Cancel, Escape, the backdrop: one cancel call each) | "Setup cancelled. GitHub is still connected through your token." Close and Set up again. |
| Any refusal (`install_failed`, `token_write_scoped`, `setup_expired`, any other reason, as an event or as the setup route's refusal) | The mockup's one `swf` view: "Setup didn't finish", "GitHub didn't finish setting the App up, so nothing changed. GitHub is still connected through your token.", Close and Set up again. For `token_write_scoped` it also lists the write permissions the refusal names, because the owner needs them to fix the App. The kernel's `message` is still never shown. |

None of the over-token views offers "Paste a token instead": a token is in use. `data-phase` keeps its values (`cancelled`, `expired`, `write-scoped`, `failed`), so the one failed view is chosen by `overToken`, not by a new phase. The flag is the screen's: it is set when the run starts over a token (Set up again from a switch is a switch again), and the words fall back to the no-token ones if the token goes away meanwhile (disconnected elsewhere). Disconnect is refused while the dialog runs, and only one overlay is open at a time, as before. Focus returns to the Switch button that opened the dialog, or to the connector row when that button is gone (the install landed).

A known limit: the step-2 signal is any non-refusal `connector_status` after the setup call was answered, so an unrelated one on the token (the expiry work moving `connected` to `expiring`) during the minutes of step 1 would read as step 2. That is today's documented signal, and no new signal shape was added.

**Tests:** `app-setup.test.ts` (the model, and the dialog over the scripted kernel: the setup call and the opened address, step 2, cancel by each route, reopen, expiry, a test per refusal reason as an event and as the route's refusal, a refused channel, the links, the unreachable kernel), `connect-sheet.test.tsx` (the choice), `integrations.test.tsx` (the detail pane, revoked, the App's disconnect confirm, `⌘K`) and `model.test.ts`.

## The app's own preferences (Settings)

The Settings screen's "This app" section sets three things that belong to the app, not the kernel: launch at login, notifications and the theme. They live in the main process (`app/electron/settings.ts`; `main.ts` only wires it), reached as the optional `window.api.prefs` member of `StudioBridge` (`AppPreferencesBridge` in `app/src/api/contract.ts`; a caller treats a missing member as "preferences unavailable"). The preload still exposes exactly one key, `api`, and nothing on it is named `token`, `ipc`, `require` or `process`.

| Call | Channel | What it does |
|---|---|---|
| `prefs.get()` | `studio:prefs:get` | Answers `AppPreferences`: `launchAtLogin: { enabled, status }`, `notifications`, `theme` |
| `prefs.set(patch)` | `studio:prefs:set` | Applies a valid `AppPreferencesPatch` (any of `launchAtLogin`, `notifications`, `theme`) and answers the state read back |
| `prefs.revealDataDir()` | `studio:reveal-data-dir` | Opens the main process's own data folder; answers `true` once opened, else `false` |

Every handler refuses a caller that is not the app's own window (`throw new Error("refused")`, as every other handler does), and the renderer names no channel.

**What is kept where.**

- **`prefs.json`** in `app.getPath("userData")`: `{ "notifications": boolean, "theme": "system" | "light" | "dark" }`, defaulting to `{ notifications: true, theme: "system" }`. It is read once at start. A missing, unreadable or invalid file (not exactly those two keys with valid values) means the defaults and never a throw, and the file is rewritten only by the next change, atomically (a temp file in the same folder, then a rename). It is never in the kernel's store or data dir. A failed write is logged as a reason with no path, and the change holds for that run.
- **Launch at login is not stored.** `set` calls `app.setLoginItemSettings({ openAtLogin })`, and every `get` (and the answer to every `set`) reads `app.getLoginItemSettings()` again, so the switch shows what the OS holds, including a change made in System Settings. `launchAtLogin.status` is the OS's own word where it gives one (macOS 13+: `enabled`, `not-registered`, `requires-approval`, `not-found`), else `null`. `enabled` is `false` when the OS says the item needs approval, so the screen can say so rather than show a switch on. A call that throws answers `{ enabled: false, status: null }`.
- **Theme.** The main process sets `nativeTheme.themeSource` from `prefs.json` at start, before the window is created, and on every change. The renderer's tokens follow `prefers-color-scheme` (`app/src/styles/tokens.css`), so the app re-themes at once with no reload. Verified on Electron 44.9.2 (macOS, 2026-10-30), in a plain window and in the built app: `themeSource` `dark` and `light` flipped `matchMedia("(prefers-color-scheme: dark)")` in the renderer at once, and `system` returned it to the OS's setting, and a relaunch over the same `prefs.json` read the stored theme on the first read, so no `data-theme` fallback is needed. **An e2e must reset Playwright's emulation first:** Playwright pins `prefers-color-scheme: light` on every page by default, which hides `themeSource` entirely (the media query read `false` for every theme), so call `await page.emulateMedia({ colorScheme: null })` before reading `matchMedia`.
- **Notifications** is the app's own preference: stored and returned, and nothing reads it yet. The kernel posts its own macOS notifications through its notifier, which this preference does not reach (the open question is in [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md)).

**The patch is validated here, never trusted.** `studio:prefs:set` accepts an object whose keys are only `launchAtLogin` (boolean), `notifications` (boolean) and `theme` (`system`, `light` or `dark`). Anything else (another key, a wrong type, an unknown theme, an `undefined` value, a non-object) refuses the whole patch: nothing changes and the current state comes back. It never throws.

**Reveal never takes a path.** The handler takes no argument, so whatever the renderer sends is dropped. It opens `resolveDataDir(process.env)`, the one the kernel connection uses, with `shell.openPath`, and answers `false` for a folder it could not open (the kernel was never started here, for example).

**Test seams, unpackaged builds only** (the `tokenReaderFor(process.env, app.isPackaged)` rule: a packaged build ignores both, pinned by `app/electron/settings.test.ts`):

| Variable | Effect |
|---|---|
| `STUDIO_APP_PREFS_DIR` | Moves `prefs.json` to that folder |
| `STUDIO_APP_FAKE_OS=1` | Replaces the login-item calls and Reveal with a fake that records each call and keeps the login-item state in `os-calls.json`, beside `prefs.json` |

`os-calls.json` is `{ "loginItem": { "openAtLogin": boolean, "status": string }, "calls": [...] }`. Each call is `{ "op": "setLoginItemSettings", "openAtLogin": boolean }` or `{ "op": "reveal", "path": <the resolved data dir> }`, in order. The fake reads the file on every `get`, so a relaunch over the same folder shows the fake OS's state, not a stored value. A seeded `requires-approval` status survives a set (the call is recorded, the state is not changed), which is how a test shows the "needs approval" case. An e2e run sets both variables on every launch, so none ever registers a real login item or opens Finder.

**Tests:** `app/electron/settings.test.ts` (Electron mocked: the prefs file and every fallback, the login item set and read back from the OS, the theme at start and on change, the refused patch, Reveal and an ignored argument, and the seams, including a packaged build ignoring them), `app/electron/main.test.ts` ("the preferences channels": the owner check on each channel, the theme applied before the window, Reveal opening the resolved data dir only) and `app/electron/preload.test.ts` (the three methods and their channels). `app/e2e/smoke.spec.ts` pins the built preload's key list, `prefs` included.

## `GET /settings`

The kernel's `gui` feature serves it from its `settings` part (`kernel/src/gui/settings.ts`), against the `SettingsResponse` that `app/src/api/contract.ts` declares (route key `"GET /settings"`). It is an owner route (it needs the API token) and read-only: nothing is written, and no secret is read into the answer.

It answers `200` with `provider` (`id`, `account`, `health`, and `token_created_at` from the provider's metadata, else `null`), `data_dir` (the store's data dir), `notifier` (`terminal-notifier`, `osascript` or `none`, from the kernel's own choice of notifier) and `loomwright` (the adapter's state). `provider` is the first provider `GET /status` reports, read through the same view `/status` uses, so there is one Keychain-reading health path and never a second: a provider whose `health()` throws reports `{ status: "error", reason: "health_threw" }` with `200`, and a Loomwright reader that throws reports `status_threw`. The body is built field by field and never holds a token, a key or Keychain output.

When it cannot answer it refuses, never with a thrown error: `503 { "error": "settings_unavailable", "reason": <reason> }` with `no_status_view` (the route's request carries no status view), `no_auth_provider` or `no_loomwright_reader`. The Settings screen shows the provider read-only, with the terminal commands that change it and no field for a credential.
