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
