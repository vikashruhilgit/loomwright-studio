# Supervisor Job: The kernel streams its events over a WebSocket feed the app can resume (phase 5 item 02)

## Environment
- **Project:** loomwright-studio (lane checkout `automate-2026-10-21-052020/L1`)
- **CLAUDE.md:** ✓ Found (fresh: its kernel test command, `docs/` table and invariants match the tree at base)
- **Git:** clean (0 files), branch: main, 0 commits behind `origin/main`
- **GitHub CLI:** ✓ Authenticated (vikashruhilgit)
- **Blockers:** 0 | **Warnings:** 1 (stale `.supervisor/run.lock` held by a dead pid from this same lane run; reclaimable, and the next `run-lock.sh acquire` reclaims it on its own)
- **Source requirement:** .supervisor/requirements/phase-5/2026-10-20-140002-the-kernel-streams-its-events-over-a-websocket-feed.md
- **Base commit:** 77be86d5d57f029e6622126d92164c7205b92a96

## Feasibility

| # | Check | Verdict | Detail |
|---|-------|---------|--------|
| 1 | Tech Stack Compatibility | GO | Strict TS + vitest kernel. `ws` 8.x is already a dependency (`"ws": "^8.22.0"` in `kernel/package.json`) and `@types/ws` a devDependency, so no new npm dependency is needed |
| 2 | Dependency Availability | GO | `startApiServer` already authenticates the upgrade and hands each socket to `handleEventFeed(ws, req, { store, now })` (`kernel/src/api/server.ts`). The `events` table is append-only and ids follow append order (`id INTEGER PRIMARY KEY`, plus triggers refusing update, delete and explicit-id replace, in `001_initial.ts` and `008_events_explicit_id_guard.ts`) |
| 3 | Architecture Fit | GO | ARCHITECTURE's Loopback API already describes the feed on the same server behind the same token. `console/events.ts` is the reserved part for `GET /events`. `app/src/api/contract.ts` already types `EventFrame`, `TruncatedEventFrame`, `HeartbeatFrame`, `SubscribeFrame`, `FEED_CLOSE_CODES`, `EventsQuery` and `EventsResponse` |
| 4 | Scope vs Supervisor Capability | GO | 4 files in Touches, plus 2 one-case pin edits the owner approved (see Owner decisions below). One worker |
| 5 | Hard Blockers | CAUTION | Two item-01 pins outside Touches break as soon as the feed exists: `kernel/test/api.test.ts` pins the stub's `1013 'not yet'`, and `kernel/test/console-foundation.test.ts` pins every console part empty. Items 03 and 04, in the same wave, break the same console-foundation lines, so a rebase conflict follows for whichever lane merges second. The owner chose minimal edits (2026-10-21, Launch Pad) |

**Overall Verdict:** CAUTION

## Task
**Goal:** Replace the `handleEventFeed` stub with the real resumable event feed (subscribe/backlog/live/heartbeat, bounded, one shared 250 ms poll per process), add the `GET /events?after=&limit=` gap-read route in the console's `events` part, document both in `docs/architecture/feed.md`, and narrow the two item-01 stub pins the feed necessarily changes.

**Problem Statement:**
The owner needs every approval, reply and session change to reach the app the moment the kernel records it, so no screen shows stale state.
Today item 01 routes an authenticated `GET /events/stream` upgrade to a stub `handleEventFeed` in `kernel/src/api/feed.ts`. The stub closes every socket at once with 1013 `not yet`. The console's `eventsPart` is empty, so `GET /events` is not served either. The `events` table is append-only with ids in append order, so it is a natural resumable feed.
Success looks like this: a client that subscribes with `after: N` gets every event with id > N in order, then each new one within 500 ms of its append. After a reconnect it resumes from its last id with nothing missed or doubled. The feed is bounded (4 clients, slow clients dropped, 1 MiB frames) and never runs a timer while no client is connected.

**Owner decisions (binding, from the source requirement, 2026-10-20):** live feed = one WebSocket event feed on the existing 127.0.0.1 API server, behind the same bearer token, streaming the append-only `events` by id; REST stays for reads and actions. Read the source requirement's §Owner decisions for the full text. Don't reopen any of these.

**Owner decisions (Launch Pad, 2026-10-21, binding):**
- **Pin edits outside Touches = minimal.** Item 02 edits exactly two item-01 test files, and only where the feed necessarily breaks them:
  - In `kernel/test/api.test.ts`, replace the one stub case (`whose stub closes it with 1013 'not yet'`) with a case saying that with the token, the request is upgraded and handed to the feed (the socket opens and stays open until the client closes it). The feed's own behaviour is pinned in `kernel/test/api-feed.test.ts`.
  - In `kernel/test/console-foundation.test.ts`, narrow only the `events` part: it now carries exactly one route, `GET /events`, which the merged contributions list as owned by `console`. The other four parts (`output`, `control`, `pause`, `threads`) stay pinned empty. Edit no other line of either file.
  - Lanes 03 and 04 rebase over this, a small conflict their drains resolve.
- **Kill switch = keep streaming.** The kill switch stops work, not reads. While it is engaged the feed keeps serving, so the app sees `kill_switch_engaged` and `stop_all_completed` live (item 17's menu bar needs them). "Stops cleanly" means two things. First, a graceful stop (`api.close()`, then the store's close in `kernel.ts`'s teardown) ends every feed socket and clears the poll and heartbeat timers, and a poll tick that finds the store closed stops quietly and never throws. Second, the feed never blocks or breaks `POST /stop-all`.

**Non-goals:** what the app does with events (item 12); pushing anything other than `events` rows; any edit to `kernel/src/api/server.ts`, `kernel/src/console/index.ts`, `app/src/api/contract.ts` or `docs/ARCHITECTURE.md`. ARCHITECTURE.md's Loopback API line ("which today closes it at once with 1013 and the reason `not yet`") and its console line ("handed to the `handleEventFeed` stub") go stale with this change. Don't edit them, because ARCHITECTURE.md is item 01's hotspot and the wave's other lanes touch the same area. Say so in the PR body as an owner follow-up.

## Acceptance Criteria
1. [ ] Given events 1–10, when a client subscribes with `{"type":"subscribe","after":7}`, then it receives event frames 8, 9 and 10 in order, each exactly `{"type":"event","id","at","kind","session_id","task_id","payload"}`, with `payload` the stored `payload_json` parsed as a JSON value (or `null` when the column is null). Then each newly appended event arrives within 500 ms of its append. A backlog of more than 500 events is read and sent in pages of at most 500 rows and arrives complete and in order (pinned with a backlog of at least 1,001 events).
2. [ ] Given a client that disconnects after receiving 12 and resubscribes with `after: 12` while 13–15 were appended, then it receives exactly 13, 14 and 15, none twice and none missed. A live event appended during a client's backlog catch-up is also delivered exactly once.
3. [ ] Given no token, then no upgrade happens (item 01's `api.test.ts` refusal cases stay green, unedited). Given four connected clients, then a fifth is closed with 1013. Given a malformed client frame, then the socket is closed with 1003. Malformed means each of: not JSON; not an object; a `type` other than `subscribe`; an `after` that is not a non-negative safe integer; a binary frame; a second frame after the subscribe.
4. [ ] Given an event whose serialized frame is over 1 MiB (1,048,576 bytes), then the feed sends `{"type":"event","id","kind","truncated":true}` in its place. `GET /events?after=<id - 1>&limit=1` then returns that row in full, as an untruncated `EventFrame`. `GET /events` returns `{"events": [...]}`, the same frame shape, oldest first, at most 500 rows (default 500). An absent `after` is treated as 0. A bad `after` gives `400 {"error":"invalid_after"}` and a bad `limit` (not 1–500) gives `400 {"error":"invalid_limit"}`.
5. [ ] Given no client connected, then no poll timer and no heartbeat timer runs. This holds before any client connects, and again after the last one closes or is terminated by `api.close()`. While a client is connected, a `{"type":"heartbeat","latest_id"}` frame goes every 15 s (pinned with fake timers or an injected interval). A client whose unsent backlog (`socket.bufferedAmount`) passes the feed's exported bound is closed with 1011. The bound can be lowered for tests through an exported test-only setter in `feed.ts`, never through a new required `EventFeedContext` field, so the pin needs no multi-MiB loopback flood.
6. [ ] Given the kill switch is engaged through `POST /stop-all` while a client is subscribed, then `/stop-all` answers 200, the client receives the `kill_switch_engaged` and `stop_all_completed` events, and its socket stays open. Given `api.close()` and then `store.close()` with a client subscribed, both resolve, the socket closes, and no timer is left and nothing throws afterwards (graceful stop). Given `store.close()` while a client is still subscribed and the API still open, the next poll tick stops the hub quietly (its timers cleared, no uncaught error) and never crashes the process.
7. [ ] `docs/architecture/feed.md` documents the protocol (the subscribe frame, the backlog in pages of 500, live events, heartbeats), the bounds (4 clients, the slow-client bound, 1 MiB frames, the 250 ms shared poll stopped while idle), the close codes (1013, 1011, 1003) and resume (from the last id seen, with `GET /events` for truncated or missed rows), and the kill-switch behaviour above. It also names, in one sentence, the two ARCHITECTURE.md stub sentences it supersedes (Loopback API "which today closes it at once with 1013" and the console's "handed to the `handleEventFeed` stub"), so the follow-up is recorded in the diff. `bash scripts/check-docs.sh` passes.

**Validation (must pass before merge):** `cd kernel && npm ci && npm run typecheck && npm test`; `bash scripts/check-docs.sh`.

## Touched-file invariants

> Grounded at base `77be86d5d57f029e6622126d92164c7205b92a96`. The worker re-checks every entry before hand-back.

- **`kernel/src/api/feed.ts`**
  - **Keep:** `export const EVENT_FEED_PATH = "/events/stream";`. `server.ts` (`if (path !== EVENT_FEED_PATH) {`) and `kernel/test/console-contract.test.ts` (`expect(feed.map((r) => r.path)).toEqual([EVENT_FEED_PATH]);`) import it.
  - **Keep:** the seam signature exactly: `export function handleEventFeed(socket: WebSocket, req: IncomingMessage, ctx: EventFeedContext): void | Promise<void> {` and `export interface EventFeedContext {` with `readonly store: Store;` and `readonly now: () => Date;`. `server.ts` builds `const feedContext = { store, now };` and is not edited, so `ctx` gets no new required field.
  - **Mirror:** `server.ts` already attaches `ws.on("error", () => ws.terminate());` before calling the handler, and terminates the socket when the handler throws or rejects (`if (served instanceof Promise) served.catch(() => ws.terminate());`). The feed must therefore never throw out of its message handler or its timers. Its client bookkeeping must run on the socket's `'close'` event, because `server.close()` ends sockets with `for (const client of feed.clients) client.terminate();`, which emits `'close'` and never sends a frame.
  - **Keep:** `import type { WebSocket } from "ws";` stays type-only, unless a value import is truly needed (for example `WebSocket.OPEN`). Compare `socket.readyState` against the numeric constant or the instance's own `OPEN` instead.
  - `FEED_NOT_YET_CODE` has no importer outside `feed.ts` (grep at base: `kernel/src/api/feed.ts` only). It may be removed or renamed. The kernel's close-code constants must equal the contract's `FEED_CLOSE_CODES = Object.freeze({ tryAgainLater: 1013, tooSlow: 1011, malformedFrame: 1003 } as const)`.
- **`kernel/src/console/events.ts`**
  - **Keep:** `export const eventsPart: ConsolePart` (name `"events"`). `kernel/src/console/index.ts` merges it first, in `Object.freeze([eventsPart, outputPart, controlPart, pausePart, threadsPart])`. Build it from `emptyConsolePart("events")` with a frozen `routes` list, so the part keeps its `name`/`tools`/`routes`/`handlers` shape.
  - **Keep:** the console module-graph rule from `kernel/src/console/types.ts`: "nothing here may pull in the Agent SDK, the session manager or `kernel.ts`". `feature-seams.test.ts` pins the registry's module graph. If `events.ts` holds the shared row-to-frame code that `feed.ts` imports, it value-imports only the store's types and other console or kernel helpers that load without the SDK.
  - **Reuse:** the query-validation idiom of `kernel/src/notifications/routes.ts`: `return { status: 400, body: { error: "invalid_limit" } };`, with a `POSITIVE_INT` test before `Number(raw)`.
- **`kernel/test/api.test.ts`** (owner-approved, one case only)
  - Replace only `it("with the token, upgrades it and hands it to the feed, whose stub closes it with 1013 'not yet'", async () => {` and its `expect(closed).toEqual({ code: 1013, reason: "not yet" });`.
  - **Keep green and unedited:** the five `refuses an upgrade with ${name}: 401 before any upgrade` cases, including their `expect(eventKinds()).toEqual([]);` (the feed writes no events). Also keep the 404, 405 and 400 refusal cases, `a client that sends a malformed frame on the feed socket is dropped; the server keeps answering`, and `close() resolves while a feed socket is still open`. The last one now runs against the real feed, with a client that never subscribes, so the feed must not hold `close()` open.
- **`kernel/test/console-foundation.test.ts`** (owner-approved, events part only)
  - Narrow only these literals: `expect(Object.keys(consoleContribution)).toEqual(["name"]);` (now `["name", "routes"]`, per `consoleContributionOf`'s `...(merged.routes.length > 0 ? { routes: merged.routes } : {}),`); `expect(merged.routes.filter((r) => r.owner === "console")).toEqual([]);` (now exactly `GET /events`); `expect(part, part.name).toEqual({ name: part.name, tools: [], routes: [], handlers: {} });` (skip `events`, and pin it as one `GET /events` route with no tools or handlers); `expect(mergeConsoleParts(CONSOLE_PARTS)).toEqual({ tools: [], routes: [], handlers: {}, dueWork: [] });` (routes is now the one route); and the two test titles that say "each empty" or "no tools, routes", reworded to match.
  - **Keep:** the part order pins, `expect(SHIPPED_CONTRIBUTIONS[7]).toBe(consoleContribution);`, and the merge-refusal and `SESSION_OUTPUT_KINDS` cases, all unedited.
- **`docs/architecture/feed.md`**
  - **Keep:** the first line's back-link `[Phase 5 features](../ARCHITECTURE.md#phase-5-features)`, the `**Routes:**` and `**Contract types it fills**` lines, and the link `[ARCHITECTURE.md: Loopback API](../ARCHITECTURE.md#loopback-api)`. `scripts/check-docs.sh` check 1 fails on any relative link whose target is missing. Replace the "Today (item 01) … the `handleEventFeed` stub closes every socket" paragraph with the real protocol.

## Closed enumerations touched

> Sibling grep at base `77be86d5d57f029e6622126d92164c7205b92a96`: `grep -rnF '"invalid_limit"' kernel/src app/src docs` → 2 hits in 2 files (`kernel/src/notifications/routes.ts:68`, `docs/architecture/notifications.md:81`); plus `kernel/test/notifications.test.ts:655`.

- **`invalid_after`** (new API error code; siblings `invalid_limit`, `invalid_id`) must be named in:
  - `kernel/src/notifications/routes.ts`: an inline literal in one route's answer. No change: it is not a closed list of error codes.
  - `docs/architecture/notifications.md`: prose for the notifications route. No change: it is not a list of every code.
  - `app/src/api/contract.ts`: no error-code union exists (grep at base finds no `invalid_limit`). No change.
  - `docs/architecture/feed.md` (in the lanes): documents `invalid_after` and `invalid_limit` for `GET /events`. That is new prose, not an existing closed list.
  - No closed list carries the error codes, so nothing is extended.

## Pin mutations

| Pin | Mutation (one line, applied to the code the pin protects) |
|-----|-------------------------------------------------------------|
| `kernel/test/api-feed.test.ts`: subscribe `after: 7` receives 8, 9, 10 in order | flip `>` → `>=` in the backlog query's `id > ?` in `kernel/src/console/events.ts` or `kernel/src/api/feed.ts`, wherever the worker puts it (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: the exact frame shape, with `payload` `null` when `payload_json` is null | drop the null branch of the payload parse, so a null column is sent as the string `"null"` or omitted (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: a backlog over 500 arrives complete in pages | in the backlog read, drop the loop that reads the next page, so only one page of 500 is sent (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: resubscribe `after: 12` gets exactly 13–15, none twice | in the backlog read on subscribe, start from the hub's cursor instead of the client's `after` (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: a live event appended during catch-up arrives exactly once. The test keeps a second, already-live client connected, so the hub's cursor lags the catching-up client | in the live fan-out, drop the per-client `id > client.last` guard (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: the fifth client is closed 1013 | flip the client cap `4` → `5` in `kernel/src/api/feed.ts` (reviewer-applied: the cap's literal is the worker's) |
| `kernel/test/api-feed.test.ts`: a malformed frame closes 1003 | flip `1003` → `1000` in `kernel/src/api/feed.ts` |
| `kernel/test/api-feed.test.ts`: each AC3 malformed variant (not JSON, not an object, wrong `type`, bad `after`, binary, a second frame) closes 1003, one case each | delete the second-frame check (a subscribed client's next frame) in `kernel/src/api/feed.ts`. Reviewer-applied, and likewise for each other variant's check |
| `kernel/test/api-feed.test.ts`: `GET /events?after=x` is `400 invalid_after` | flip `invalid_after` → `invalid_limit` in `kernel/src/console/events.ts` |
| `kernel/test/api-feed.test.ts`: a live event arrives within 500 ms of its append | raise the shared poll interval `250` → `2000` in `kernel/src/api/feed.ts`, or never start the poll on the first connect (reviewer-applied: the interval's literal is the worker's) |
| `kernel/test/api-feed.test.ts`: `GET /events` returns rows oldest first | flip `ORDER BY id` → `ORDER BY id DESC` in the `GET /events` query in `kernel/src/console/events.ts` (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: `GET /events` with no `limit` returns up to 500 rows (pinned with more than 500 events) | change the default limit `500` → `50` in `kernel/src/console/events.ts` (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: `limit=0` is `400 invalid_limit` | relax the lower bound in `kernel/src/console/events.ts` so `0` is accepted (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: an absent `after` is treated as 0 (returns from event 1) | make an absent `after` default to the latest id instead of 0 in `kernel/src/console/events.ts` (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: a frame over 1 MiB is the truncated form | in `kernel/src/api/feed.ts`, delete the size check that swaps in the truncated frame (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: `GET /events` returns the truncated row in full | make the `GET /events` handler send the truncated form for an over-1-MiB row as well (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: no poll timer runs while no client is connected | in `kernel/src/api/feed.ts`, delete the `clearInterval` (or `clearTimeout`) of the shared poll on the last client's close (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: no heartbeat timer runs while no client is connected | in `kernel/src/api/feed.ts`, delete the heartbeat timer's `clearInterval` on the last client's close (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: a slow client is closed 1011 | flip `1011` → `1000` in `kernel/src/api/feed.ts` |
| `kernel/test/api-feed.test.ts`: heartbeat every 15 s with `latest_id` | flip `15_000` → `30_000` in `kernel/src/api/feed.ts` (reviewer-applied: the interval's literal is the worker's) |
| `kernel/test/api-feed.test.ts`: the kill switch leaves the feed streaming | in `kernel/src/api/feed.ts`, close every client when a `kill_switch_engaged` row is fanned out (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: `store.close()` while a client is still subscribed and the API still open: the next poll tick stops the hub, with no uncaught error (AC6's last sentence; the test closes the store first, so a tick does run against it) | delete the try/catch around the poll tick's read in `kernel/src/api/feed.ts` (reviewer-applied) |
| `kernel/test/api-feed.test.ts`: `GET /events` limit above 500 is `invalid_limit` | flip `500` → `5000` in the limit bound in `kernel/src/console/events.ts` (reviewer-applied) |
| `kernel/test/console-foundation.test.ts`: the events part carries exactly `GET /events` | delete the `GET /events` route entry in `kernel/src/console/events.ts` (reviewer-applied) |
| `kernel/test/api.test.ts`: with the token, the feed upgrade opens and stays open | restore the stub's `socket.close(FEED_NOT_YET_CODE, "not yet");` at the top of `handleEventFeed` in `kernel/src/api/feed.ts` (reviewer-applied) |

## Subtask Structure

| # | Title | Acceptance Criteria Subset | Est. Files (modify/create) | Skills | Status |
|---|-------|---------------------------|---------------------------|--------|--------|
| 1 | Event feed: `handleEventFeed`, `GET /events`, the two narrowed pins, `feed.md` | 1, 2, 3, 4, 5, 6, 7 | 5 modify, 1 create | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` | LAUNCHABLE |

**Design notes (the worker may choose differently and say why):**
- **One shared hub per store.** "One shared poll per process": keep module-level state in `feed.ts` keyed by `ctx.store` (a `Map<Store, Hub>`), so two API servers in one test process never share a cursor. Each hub holds its connected clients, one 250 ms poll timer and one 15 s heartbeat timer. It starts both on the first connect and clears both when its last client closes. Export a read-only introspection for tests (for example `feedTimersActive(store): boolean`), or use vitest fake timers, to pin AC5.
- **No gap, no duplicate.** better-sqlite3 is synchronous. On subscribe, read and send backlog pages (`SELECT … WHERE id > ? ORDER BY id LIMIT 500`) in a loop within one synchronous stretch until a page comes back short. Then mark the client live with `last` set to the last id sent. The poll reads `id > hub.last` and sends each row to every live client whose `last` is below it. Since no await separates the catch-up and the switch to live, no append can fall between them.
- **Before subscribe.** A connected client counts toward the 4-client cap from its open. Until its subscribe frame arrives it gets no events and no heartbeats.
- **Frames.** `payload` is `JSON.parse(payload_json)`. A row whose text does not parse (not expected: every writer uses `JSON.stringify`) is sent with the raw string as `payload`, never dropped and never interpreted. Measure size as `Buffer.byteLength(JSON.stringify(frame))`. Put the row-to-frame code in one place that both the feed and `GET /events` use, with the truncation applied only on the feed.
- **Slow client.** Before each send, check `socket.bufferedAmount` against an exported bound (for example 8 MiB, above the 1 MiB frame cap). Over the bound, close with 1011 and drop the client. It resumes from its last id.
- **Never interpret payloads.** The feed reads `id, at, kind, session_id, task_id, payload_json` only and writes nothing (invariant 3: untrusted input is data).
- **Tests** (`kernel/test/api-feed.test.ts`, new): a real `startApiServer` on a temp-dir `Store` (the `api-feed-handler-errors.test.ts` setup, without its mock), `ws` clients with the bearer token, and events appended through `appendEvent` (`kernel/src/loop/internal.ts`) or plain `INSERT INTO events`. `GET /events` goes through the API with the token. AC6 uses `serve()`'s fake loop and sessions as `api.test.ts` does, or the same option shape.

## Subtask Contracts

```yaml
# Subtask 1
provides:
  - {kind: "symbol", path: "kernel/src/api/feed.ts", name: "handleEventFeed"}
  - {kind: "symbol", path: "kernel/src/api/feed.ts", name: "EVENT_FEED_PATH"}
  - {kind: "symbol", path: "kernel/src/console/events.ts", name: "eventsPart"}
  - {kind: "file", path: "kernel/test/api-feed.test.ts"}
  - {kind: "file", path: "docs/architecture/feed.md"}
requires: []
lanes:
  - "kernel/src/api/feed.ts"
  - "kernel/src/console/events.ts"
  - "kernel/test/api-feed.test.ts"
  - "kernel/test/api.test.ts"
  - "kernel/test/console-foundation.test.ts"
  - "docs/architecture/feed.md"
external_requires: []
```

## Parallelism Analysis

### Dependency Graph
```
Subtask 1: single-agent (no fan-out)
```

### File Overlap Matrix

| Group A | Group B | Overlapping Files | Serialize? |
|---------|---------|-------------------|------------|
| Subtask 1 | (none) | n/a | NO |

### Batch Plan
- **Batch 1:** Subtask 1
- **Recommended workers:** 1
- **Estimated batches:** 1

## Skill References

| Subtask | Skills |
|---------|--------|
| 1 | `skills/unit-testing/SKILL.md`, `skills/error-handling/SKILL.md` |

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feasibility (Phase 2.5): two item-01 pins outside Touches (`api.test.ts`'s 1013 stub case, `console-foundation.test.ts`'s empty-events-part lines) must change, and items 03 and 04 in the same wave change the same console-foundation lines | MEDIUM | The owner chose minimal edits (2026-10-21). Edit only the literals listed under Touched-file invariants. The PR body names both files and says the later lanes rebase over them. The reviewer checks that no other line of either file changed |
| ARCHITECTURE.md's two stub sentences about the feed go stale, and this item may not edit ARCHITECTURE.md. `api.test.ts`'s close-timeout case (its comment "The client never replies to the stub's close frame") also goes stale under the minimal-edit decision, as do `kernel/src/console/index.ts`'s comments ("so today the contribution is its name alone" in its header, and "every part is empty today, so it does not throw" above `consoleContribution`) and `console-foundation.test.ts`'s header ("one `console` contribution built from five empty sub-file parts") | LOW | `feed.md` holds the truth and names the two superseded ARCHITECTURE.md sentences (AC7). The PR body lists all of these stale lines as an owner follow-up. The `api.test.ts` case still passes, because `server.close()` terminates the socket |
| A poll tick after `store.close()` (teardown closes the API, then the store) throws out of a timer and crashes the daemon | HIGH | Clear the timers on the last client's `'close'`. Wrap each tick's read in try/catch, and stop the hub on any store error. AC6 pins `api.close()` then `store.close()` with a subscribed client |
| A race between the backlog catch-up and the live poll misses or doubles an event | HIGH | Catch-up and the switch to live share one synchronous stretch (design notes), with a per-client `last` guard on fan-out. AC2 pins an append during catch-up |
| Shared module state leaks between test files or between two servers in one process | MEDIUM | Key the hub by `Store`, and delete it when its last client closes. Tests close every client and server in `afterEach` |
| The 500 ms latency assertion is flaky on a loaded CI runner | MEDIUM | The poll is 250 ms, so the worst case is about 250 ms plus a send. Assert against the append time with real timers, and keep fake timers for the 15 s heartbeat only |
| A >1 MiB row in `GET /events` makes a large response (up to 500 such rows) | LOW | The requirement wants the row in full through REST. Clients fetch truncated rows with `limit=1`, as the contract's `TruncatedEventFrame` comment says (`GET /events?after=<id - 1>&limit=1`) |

## Configuration
- **Workers:** 1
- **Mode:** single-agent
- **Estimated batches:** 1
- **Base Branch:** main

## Handoff
```
/supervisor job: .supervisor/jobs/pending/2026-10-21-kernel-event-feed-websocket.md
```

## Outcome
- **Status:** completed
- **Completed:** 2026-10-21T11:26:48Z
- **PR:** https://github.com/vikashruhilgit/loomwright-studio/pull/104
- **Branch:** feature/kernel-event-feed-websocket
- **Files changed:** 6
- **Heal loop ran:** true
- **Heal decision:** PASS
- **Heal iterations:** 1
- **Red team advisory:** disabled
- **Until-mergeable dispatched:** false
- **Summary:** Replaced the handleEventFeed stub with the resumable WebSocket event feed (backlog in pages of 500, live via one shared 250 ms poll per store, 15 s heartbeat, timers only while a client is connected, 4-client/slow-client/1 MiB/malformed bounds, kill switch keeps streaming), added GET /events in the console events part, narrowed the two owner-approved item-01 pins, and wrote docs/architecture/feed.md. Phase 4.5: iteration 1 PASS with one MEDIUM (close codes asserted against a copied literal) fixed in 7958669, which makes api-feed.test.ts parse app/src/api/contract.ts; iteration 2 PASS with only LOW/nit findings (6 dismissed below the MEDIUM floor). Kernel typecheck clean, 1797 tests passed, check-docs OK, required CI green.

## Not verified
- **Electron app kernel-connection relay against the live feed** — no app runtime run here; only the kernel side was tested, with ws clients (subtask 1)
- **slow-client 1011 under real TCP backpressure** — pinned via a bufferedAmount getter spy; a real flood depends on the machine's loopback buffers (subtask 1)
