# Supervisor Job: The app's live store — REST loads plus the event feed, with reconnect and honest connection states

## Environment
- **Project:** ~/Documents/work/AI/loomwright-studio-lanes/automate-2026-10-22-023903/L5
- **CLAUDE.md:** ✓ Found (fresh)
- **Git:** clean (0 files), branch: main
- **GitHub CLI:** ✓ Authenticated
- **Blockers:** 0 | **Warnings:** 1 (two shell files outside the requirement's Touches need a small edit; see Risk Assessment)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140012-the-apps-live-store-rest-plus-the-event-feed.md
- **Base commit:** 58c2e4cad24d521b0880f36b9d0f22690847a9b8

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | `app/` is Electron + React 19 + strict TypeScript + Vite, tested with vitest (+ jsdom, React Testing Library) and Playwright Electron (`app/package.json`). The store is plain TypeScript plus one React hook. |
| 2 | Dependency Availability | GO | No new npm dependency. Everything needed is in place: `StudioBridge` (`request`, `feed.subscribe/unsubscribe/onFrame`) in `app/src/api/contract.ts`, the fixture kernel in `app/e2e/fixture-kernel.ts` (reusable `dataDir`/`port` for a restart in place, `appendEvent`), and `createKernelConnection` in `app/electron/kernel-connection.ts` (injectable deps, no `electron` import). |
| 3 | Architecture Fit | CAUTION | Item 01 (PR #101) is merged, and its contract fits unchanged. `app/src/store/connection.ts` says "Phase 5 item 12 replaces it with the live store … in this directory, so the shell never needs an edit". But the shell only renders `unreachable` and `not_installed`, and `UnreachableBand` takes no props. So scope 2's "reconnecting (the band, with the last-updated time)" needs a small edit to `app/src/shell/KernelStates.tsx` and `app/src/App.tsx`, both outside this item's Touches. Neither is in any wave sibling's Touches (items 08–11 touch only `app/src/components/*`, `app/src/commands/keyboard*.ts`, their own e2e specs and evidence dirs), and the requirement's stop rule covers only a same-wave owner or a new npm dependency, so the edit is allowed. It is kept minimal and recorded as a risk. |
| 4 | Scope vs Supervisor Capability | GO | About 9 files and well under 800 lines: one store core, one resource table, one hook, unit tests, one e2e spec, and two small shell edits. Single agent. |
| 5 | Hard Blockers | GO | None. No kernel change, no migration, no credentials: the fixture token is a constant, and the fixture runs in-process. |

**Overall Verdict:** CAUTION

## Task
**Goal:** Build the app's one live store in `app/src/store/`. Per resource, it loads from REST through the preload bridge, follows the event feed by `kind` to refetch affected resources (throttled), keeps the last event id, and resubscribes with `after` and backoff (0.5 s → 10 s) after any close. It drives the shell's connection states (connecting, live, reconnecting with the last-updated time, unreachable, not installed) and never shows data as current or `ok` unless the kernel said so.

**Problem Statement:**
The owner needs every screen (items 13–17) to show current kernel state, and needs a kernel restart never to leave the app silently stale.
Today `app/src/store/connection.ts` is a stub: a 5 s poll of `api.connection()`. No resource is loaded, the feed is never subscribed, and a restart looks the same as "unreachable".
Success: one store loads each resource over REST, applies feed events within one frame of the refetch answer without a refetch storm, survives a fixture restart mid-stream with exactly the fixture's events (none missed, none duplicated), and drives the shell's designed states.

## Acceptance Criteria

Carried forward from the requirement (made precise; numbering used by the Subtask Structure):

- [ ] **AC1 (no refetch storm):** Given the store wired to a fake bridge with the fixture's feed semantics and the `approvals` resource loaded, when an `approval_requested` event arrives on the feed, then the store issues `GET /approvals` synchronously in the same tick (leading edge, no debounce delay), and once that request resolves the `approvals` resource holds the new approval within one frame (≤ 16 ms of fake time, with subscribers notified synchronously). And when 20 `approval_*` events arrive within 250 ms, then consecutive `GET /approvals` calls start ≥ 250 ms apart: at most one per resource per 250 ms, with leading and trailing refetches and at most one in flight. The resource then ends holding the answer to a refetch issued after the last event. Tested in `app/src/store/store.test.ts` with vitest fake timers. **And against the fixture kernel** (the requirement's "Given"), in `app/e2e/store.spec.ts`. The setup is the Node harness from AC2, with the fixture's `GET /approvals` route answering from a mutable list. When the spec adds an approval to that list and calls `fixture.appendEvent({ kind: "approval_requested", … })`, the store's `approvals` resource then holds that approval (polled, bounded at 2 s). When the spec appends 20 `approval_*` events back to back, `fixture.requests` shows at most `ceil(elapsed_ms / 250) + 1` `GET /approvals` calls for the burst.
- [ ] **AC2 (resume, exactly once):** Given the real fixture kernel (`startFixtureKernel`) with events 1..N, and the store running in Node over a bridge built from the real `createKernelConnection` (`app/electron/kernel-connection.ts`, `readToken` returning `FIXTURE_TOKEN`), when the fixture is closed mid-stream, then the store's connection state becomes `reconnecting`. When the fixture is restarted on the same `port` and `dataDir` with events 1..M (M > N, including events appended while it was down), then the store resubscribes with `after` equal to its last id and ends with exactly the fixture's event ids 1..M in order, none missed and none twice (its bounded `eventLog` and `lastEventId === M`). Its state returns to `live`, the adapter recorded the resubscribe's `after === N` (the last id seen before the close), and `duplicatesDropped === 0`. That holds because the kernel replays only ids above `after`. Tested in `app/e2e/store.spec.ts` (run by `npm run e2e` in CI). The same behaviour is also unit-tested against the fake bridge in `app/src/store/store.test.ts`, including a replay that overlaps already-seen ids, which are dropped and counted.
- [ ] **AC3 (unreachable / not installed):** Given no fixture kernel, when the store starts:
  - (a) with no `api.json`, then the store reports `not_installed`, and the shell shows the exact setup commands (`SETUP_STEPS`: `claude setup-token`, `security add-generic-password …`, `studio service install`) in place of the screen;
  - (b) with an `api.json` whose port has no listener, then the store reports `unreachable` and the shell shows `kernel-unreachable-band` ("Couldn't reach the kernel").

  In both cases the store keeps retrying with a doubling backoff and goes `live` once a kernel answers. Asserted in a jsdom test under `app/src/store/` that renders `<App api={fakeBridge}>`. `store.test.ts` adds two cases:
  - **(i) dead port.** `connection()` answers `unreachable`, the real bridge's shape for a dead port. The view is `unreachable`, never `live`, and successive `connection()` calls are spaced 500, 1 000, 2 000, … ms apart.
  - **(ii) REST up, socket dies.** `connection()` answers `connected` and `feed.subscribe` answers `connected`, and each subscribe is followed at once, before `SETTLE_MS`, by a `closed` 1006 frame, over 4 attempts. The view stays `connecting` and is never `live`. The backoff never resets: successive `feed.subscribe` calls are spaced 500, 1 000, 2 000, 4 000 ms apart. When the fake then lets one subscription stay open for `SETTLE_MS`, the view becomes `live`, and the next close retries after 500 ms. The existing `app/e2e/smoke.spec.ts` cases (unreachable band, setup commands) must stay green unchanged.
- [ ] **AC4 (reconnecting band, honest staleness):** Given the store was `live`, when the feed closes, then the shell shows a reconnecting band (`data-testid="kernel-reconnecting-band"`, distinct from `kernel-unreachable-band`) with the time the store last received data from the kernel, and every loaded resource reads `stale: true` until the store is `live` again. On reconnect the store refetches every loaded resource once (throttled). Nothing in the store reports `ok` or a value it did not get from a kernel response: `status` is `undefined` until `GET /status` answers. Asserted in a jsdom test under `app/src/store/` and in `app/e2e/store.spec.ts`. The e2e is an Electron launch: close the fixture and the band appears; restart the fixture as soon as the band is visible, and the band goes. Each wait has an explicit timeout above the backoff cap plus `SETTLE_MS`, for example `{ timeout: 15_000 }`.
- [ ] **AC5 (shell tests unchanged):** `app/src/App.test.tsx` and `app/e2e/smoke.spec.ts` pass with no edit.
- [ ] **AC6:** `cd app && npm ci && npm run typecheck && npm test && npm run build` passes.

## File Impact Map

| Path | Action | Confidence | Why |
|------|--------|------------|-----|
| `app/src/store/store.ts` | create | HIGH | The framework-agnostic core: `createLiveStore(bridge, options)` covers the connection state machine, feed subscription and resubscribe with backoff, the dedupe by id, the bounded `eventLog`, per-resource load and throttled refetch, staleness, and `subscribe`/`getSnapshot` for React. No React, DOM-only API or `import.meta` (it is imported by `app/e2e/store.spec.ts` under `tsconfig.node.json`). Timers come in through `options` (`now`, `setTimeout`, `clearTimeout`) so tests use fake time. |
| `app/src/store/resources.ts` | create | HIGH | The resource table (name → contract route, query, selector) and the `kind` → resources routing table (below). |
| `app/src/store/react.ts` | create | MEDIUM | `useLiveStore` / `useResource(name)`: `useSyncExternalStore` over the core. A resource is loaded on its first use. |
| `app/src/store/connection.ts` | modify | HIGH | `useKernelConnection(api)` is backed by the live store. `ConnectionView` becomes `connecting` \| `live` \| `reconnecting` (with `lastUpdated`) \| `unreachable` \| `not_installed`. The stub poll goes, and the header comment is updated to describe the store. |
| `app/src/store/store.test.ts` | create | HIGH | AC1, AC2 (fake bridge), the backoff schedule, the 1013 / 1011 / 1006 closes, truncated frames, dedupe and dispose. |
| `app/src/store/connection.test.tsx` | create | HIGH | AC3 and AC4 in jsdom, rendering `<App api={fakeBridge}>`. |
| `app/e2e/store.spec.ts` | create | HIGH | AC1 (fixture part) and AC2 run in Node, over the real fixture and the real `createKernelConnection`, through a local `StudioBridge` adapter that mirrors `app/electron/main.ts`'s feed handlers (see "The e2e bridge adapter" below). AC4 runs as an Electron launch. |
| `app/src/shell/KernelStates.tsx` | modify | HIGH | Add `ReconnectingBand({ lastUpdated })`. `UnreachableBand` is unchanged. |
| `app/src/App.tsx` | modify | HIGH | One condition: render `ReconnectingBand` when `connection.state === "reconnecting"`. |

**Resource table** (all reads through `bridge.request` with contract keys; `GET /status` is loaded eagerly, every other resource on its first use):

| Resource | Route | Notes |
|---|---|---|
| status | `GET /status` | eager |
| approvals | `GET /approvals` | also `GET /approvals/grants` as `grants` |
| agents | `GET /agents` | |
| messages | `GET /messages` (`all: "1"`) | |
| threads | `GET /threads/:agent` | keyed per agent, first page only (paging backwards is item 13's) |
| sessions | `GET /sessions` | |
| playbooks | `GET /playbooks` | |
| triggers | `GET /triggers` | |
| notifications | `GET /notifications` | |

**Kind routing** (prefix match on `EventFrame.kind`, first match wins; only resources already loaded are refetched; `payload` is never interpreted, per the contract: "`payload` is the stored JSON, untrusted, never interpreted"): `approval_` → approvals, grants, threads · `agent_message_` → messages, threads · `agent_` → agents · `playbook_` → playbooks, triggers · `trigger_` / `wakeup_` → triggers · `notification_` / `notify` → notifications · `session_` / `stop_` / `tool_decision` / `work_step_` → sessions, status · anything else → status. Every routed event also refetches each loaded thread. The worker confirms the kinds by grepping the kernel's `appendEvent(` call sites (at base, for example `approval_requested`, `agent_message_queued`, `session_status`, `playbook_updated`, `notification_created`, `task_updated`) and adjusts a prefix only when a real kind is misrouted.

**Where connection state comes from.** This is grounded in the real bridge. `feed.subscribe`'s answer alone never makes the store `live`. `app/electron/kernel-connection.ts` `openFeed` runs only `locate()` (api.json, pid, token), and it returns `{ state: "connected", port }` as soon as the socket is created, before it opens. A dead port then arrives as a `{type:"closed"}` frame, code 1006, and `app/electron/main.ts` passes that state straight through. So each connect **attempt** goes like this:
1. Call `bridge.connection()`. The main process checks api.json, the pid and the token, then runs `GET /status`, so this is the kernel's own answer.
   - If it answers `not_installed` or `unreachable` and the store has never been live: the view takes that state, with the bridge's own `dataDir` or `reason`, unchanged.
   - If the store was live before: the view stays `reconnecting`.
   - Either way, the attempt has failed.
2. On `connected`, call `feed.subscribe(lastEventId)`. If that answers anything but `connected`, the attempt has failed, as in step 1. If it answers `connected`, the attempt is **pending**. The view does not change: it stays `connecting` if the store was never live, and `reconnecting` if it was.
3. A pending attempt **succeeds** when an event or heartbeat frame arrives, or when the subscription stays open for `SETTLE_MS` (2 000 ms) with no close. Only then does the view become `live`, and the backoff resets to 500 ms.
4. A `closed` frame while the attempt is still pending counts as a failed attempt. The view stays `connecting` or `reconnecting`, never `live`.
5. Each failed attempt doubles the backoff: 500 → 1 000 → … capped at 10 000 ms.

The first view update comes from the first awaited bridge call, `connection()`, so the existing `App.test.tsx` (a single `await act(async () => undefined)` flush) still sees the state it expects.

**Feed handling:**
- `{type:"event"}` with `id > lastEventId`: record it and route it. With `id ≤ lastEventId`: drop it and count it in `duplicatesDropped`.
- `{type:"event", truncated:true}`: fetch `GET /events?after=<id-1>&limit=1`, then route it the same way.
- `heartbeat`: refreshes `lastUpdated` only.
- `{type:"closed"}` (any code, including 1013, 1011, 1006 and 1001): when the store was live, go to `reconnecting` and keep the last view's data marked stale. Then start the next attempt after the backoff.
- `dispose()` calls `feed.unsubscribe()`, removes the `onFrame` listener and clears every timer.
- Timer handles are opaque: the injected `setTimeout` returns `unknown`, and that value is passed back to the injected `clearTimeout`. `store.ts` type-checks under both `tsconfig.json` (DOM lib) and `tsconfig.node.json` (DOM plus node), where `ReturnType<typeof setTimeout>` differs.

**The e2e bridge adapter.** `app/e2e/store.spec.ts` builds a `StudioBridge` from `createKernelConnection({ dataDir, readToken: async () => FIXTURE_TOKEN })`. It mirrors `app/electron/main.ts`'s `feedSubscribe` / `feedUnsubscribe` handlers: it closes the previous `FeedHandle` before opening a new one, applies the generation guard that drops frames from a superseded socket, and records every `after` that `feed.subscribe` received, so the spec can assert on it.

**The reconnecting band.** It uses the plain `band` class, never `band-danger`, because a restart is not an error yet. Its copy is `Reconnecting to the kernel… Last updated <time>.`, with the time in the owner's locale as `HH:MM:SS` from `lastUpdated`. It renders `role="status"`, not `alert`.

## Touched-file invariants

> Grounded at base `58c2e4c`. The worker re-checks each entry before hand-back.

- **`app/src/store/connection.ts`** — keep: the export name and call shape the shell uses, `useKernelConnection(` (called as `useKernelConnection(bridge)` in `app/src/App.tsx`), and the `unreachable` / `not_installed` members of `ConnectionView` with their existing fields (`App.tsx` reads `connection.dataDir`). mirror: the `KernelConnectionState` union in `app/src/api/contract.ts` (`readonly state: "not_installed"; readonly dataDir: string`). The store's view must not invent a reason or a `dataDir`; it passes through what the bridge returned. pinned by: `app/src/App.test.tsx` (`"unreachable: the band over the screen"`, `"not installed: the exact setup commands in place of the screen"`). Its fake bridge's `feed.subscribe` returns the given state and `request` always answers status 0, so connection state must come from `connection()` plus the feed attempt rules under "Where connection state comes from", never from a failed REST read. In that fake, `connection()` answers `connected` and `feed.subscribe` answers `connected`, so the view goes `live` with no band. Otherwise `"connected: no band, no setup state"` breaks.
- **`app/src/shell/KernelStates.tsx`** — keep: `UnreachableBand`'s `data-testid="kernel-unreachable-band"` and its text `Couldn't reach the kernel` (pinned by `app/e2e/smoke.spec.ts`: `await expect(band).toContainText("Couldn't reach the kernel")`); `SETUP_STEPS` and `NotInstalledState` unchanged. Every string rendered from the store is text, never markup (invariant 3). reuse: the existing `band` / `band-dot` classes; no new CSS file and no edit to `app/src/styles/`.
- **`app/src/App.tsx`** — keep: `const connection = useKernelConnection(bridge);` and the existing two branches (`connection.state === "unreachable"` → band, `connection.state === "not_installed"` → setup). Add only the reconnecting branch. The screen discovery (`import.meta.glob<ScreenModule>("./screens/*/index.tsx"`) and the command registration stay untouched. pinned by: `app/src/App.test.tsx` and `app/e2e/smoke.spec.ts` (AC5: unchanged and green).

## Closed enumerations touched

> Sibling grep at base `58c2e4c`: `grep -rnF '"checking"' --exclude-dir=node_modules app docs` → 2 hits in 1 file.

- **`connecting` / `live` / `reconnecting`** (they replace the sibling `checking`; `connected` stays the bridge's own state) — must be named in:
  - `app/src/store/connection.ts` — the `ConnectionView` union, anchor `export type ConnectionView = { readonly state: "checking" } | KernelConnectionState;`, and the initial `useState<ConnectionView>({ state: "checking" })` — extend (replace).
  - `app/src/App.tsx` — the shell's branches on `connection.state` — extend (the `reconnecting` branch). `connecting` and `live` render no band, which is the current behaviour for `checking` / `connected`, so they need no branch.
  - `app/src/api/contract.ts` — `KernelConnectionState` — no change: it is the main process's answer, and the new states belong to the renderer's store view only (the contract is item 01's and does not change).

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `app/src/store/store.test.ts` — at most one refetch per resource per 250 ms | flip `250` → `0` in `app/src/store/store.ts` (the per-resource throttle constant) |
| `app/src/store/store.test.ts` — duplicate ids dropped | delete the `id <= lastEventId` guard line in `app/src/store/store.ts` |
| `app/src/store/store.test.ts` — backoff 500 ms → 10 000 ms | flip `10_000` → `60_000` in `app/src/store/store.ts` (the backoff cap constant) |
| `app/e2e/store.spec.ts` — resume with `after === N` and `duplicatesDropped === 0` | flip `feed.subscribe(lastEventId)` → `feed.subscribe(0)` in `app/src/store/store.ts` |
| `app/src/store/store.test.ts` — AC3 (i), dead port is `unreachable`, never `live` | flip the pass-through of `connection()`'s `unreachable` answer to `{ state: "live" }` in `app/src/store/store.ts` |
| `app/src/store/store.test.ts` — AC3 (ii), REST up and socket dies before `SETTLE_MS`: no reset, never `live` | flip "a close while pending is a failed attempt" to "success" (reset the backoff to 500) in `app/src/store/store.ts` |
| `app/src/store/connection.test.tsx` — no `api.json` → setup commands | flip the pass-through of the bridge's `not_installed` to `unreachable` in `app/src/store/store.ts` |
| `app/src/store/store.test.ts` — `status` is `undefined` until `GET /status` answers | replace the `status` resource's initial `undefined` with a canned body in `app/src/store/store.ts` |
| `app/src/store/store.test.ts` — no timer left after `dispose()` | delete the `clearTimeout` call in `dispose` in `app/src/store/store.ts` |
| `app/src/store/connection.test.tsx` — reconnecting band with the last-updated time | delete the `connection.state === "reconnecting"` branch line in `app/src/App.tsx` |
| `app/src/store/connection.test.tsx` — `stale: true` while reconnecting | flip the staleness expression to `false` in `app/src/store/store.ts` |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Live store core, resources, hook, shell states and tests | all | 3 modify, 6 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md`, `skills/playwright-e2e/SKILL.md` | LAUNCHABLE |

```yaml
# Subtask 1 — Live store core, resources, hook, shell states and tests (LAUNCHABLE)
provides:
  - {kind: "file", path: "app/src/store/store.ts"}
  - {kind: "symbol", path: "app/src/store/store.ts", name: "createLiveStore"}
  - {kind: "type", path: "app/src/store/store.ts", name: "LiveStore"}
  - {kind: "file", path: "app/src/store/resources.ts"}
  - {kind: "file", path: "app/src/store/react.ts"}
  - {kind: "symbol", path: "app/src/store/connection.ts", name: "useKernelConnection"}
  - {kind: "type", path: "app/src/store/connection.ts", name: "ConnectionView"}
  - {kind: "symbol", path: "app/src/shell/KernelStates.tsx", name: "ReconnectingBand"}
  - {kind: "file", path: "app/src/store/store.test.ts"}
  - {kind: "file", path: "app/src/store/connection.test.tsx"}
  - {kind: "file", path: "app/e2e/store.spec.ts"}
requires: []
lanes:
  - "app/src/store/**"
  - "app/e2e/store.spec.ts"
  - "app/src/shell/KernelStates.tsx"
  - "app/src/App.tsx"
external_requires:
  - "The fixture kernel and createKernelConnection from item 01 (merged, PR #101), used unchanged"
```

## Parallelism Analysis

single-agent (no fan-out)

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md`, `skills/playwright-e2e/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): `app/src/shell/KernelStates.tsx` and `app/src/App.tsx` are outside the requirement's Touches (item 01's shared files). | MEDIUM | No wave sibling (items 08–11) lists either file, but item 11 (the ⌘K palette) may still mount itself in `App.tsx`. The edit is one new band component and one branch, and existing exports and test ids stay as they are. If a sibling PR lands an edit to either file first, rebase; do not change its behaviour. Name both files in the PR body. |
| `kernel-connection.ts` `openFeed` answers `connected` before the socket opens (Plan Review attempt 1, HIGH). | HIGH | Handled by design: `live` needs `connection()` (`GET /status`) to answer `connected`, an early close counts as a failed attempt, and the backoff resets only on a frame or after `SETTLE_MS`. The dead-port unit case and `smoke.spec.ts` pin it. |
| "Within one frame" cannot cover the IPC round trip, which the store does not control. | MEDIUM | AC1 pins what the store controls: the refetch goes out in the same tick (leading edge), and the answer is applied and subscribers notified synchronously, within 16 ms of fake time. State that limit in the PR body. |
| The requirement's AC3 ("reports unreachable, and the shell shows the setup commands") folds two designed states into one. | LOW | Follow item 01's designed states: no `api.json` → `not_installed` with `SETUP_STEPS`; `api.json` with no listener → the unreachable band. Both are asserted (AC3a/b), and `smoke.spec.ts` already pins both. |
| A contract mismatch with item 01 (for example a route or frame shape the store needs but the contract lacks). | MEDIUM | Do not edit `app/src/api/contract.ts`, `app/electron/*` or `app/e2e/fixture-kernel.ts`. Stop and report the mismatch (the requirement's risk line). |
| A refetch storm or a leaked timer after `dispose()` (tests hang, or the window keeps polling). | MEDIUM | Inject timers. A test asserts that no timer is left after `dispose()` (`vi.getTimerCount() === 0`), and the e2e closes the store before the fixture. |
| The fixture keeps the old socket open across `close()`, or the restart reuses the port too early (EADDRINUSE). | LOW | `close()` destroys sockets and terminates feed clients. Restart with `{ dataDir, port }` after `close()` resolves, and retry the listen once on EADDRINUSE in the spec only. |
| An event `kind` the routing table misses goes stale. | LOW | The default route refetches `status`, and every reconnect refetches every loaded resource. The worker greps the kernel's `appendEvent(` kinds before finalising the prefixes. |
| The store's rendered strings come from the kernel (agent names, approval display). | LOW | The store renders nothing itself. The band shows only a time formatted by the app. Screens (13–17) own escaping. |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Validation (must pass before merge)
- `cd app && npm ci && npm run typecheck && npm test && npm run build`
- CI's `app` job also runs `xvfb-run --auto-servernum npm run e2e`, which covers `app/e2e/store.spec.ts`.

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-22-live-store-rest-feed.md
```

## Outcome
- **Status:** completed_with_escalation
- **Completed:** 2026-10-22T05:26:00Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/112
- **Branch:** feature/live-store-rest-feed
- **Files changed:** 10
- **Heal loop ran:** true
- **Heal decision:** ESCALATED
- **Heal iterations:** 3
- **Heal reason:** max_iterations_reached
- **Heal remaining issues:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Live store built in app/src/store (REST loads, kind-routed 250 ms timer-window refetch throttle, id dedupe, resubscribe with after and 0.5–10 s backoff, kernel id-space check on reconnect, honest connecting/live/reconnecting/unreachable/not_installed states, ReconnectingBand). Three heal iterations fixed 1 HIGH and 5 MEDIUM findings; iteration 3's fix (f46007f, UNVERIFIED pid sentinel) was not LLM re-reviewed but typecheck, 91/91 unit, build and 6/6 e2e pass on it. Pin mutations: 11/11 caught by the reviewer's manual application (mechanical runner: 11 unverified).

## Not verified
- **app/e2e/store.spec.ts under CI xvfb on Ubuntu** — run on macOS only (Playwright Electron directly, no xvfb) (subtask 1)
- **screens consuming useResource (items 13-17)** — no screen uses it yet; exercised only by a jsdom probe component (subtask 1)
