# Feed

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 02** (the kernel streams its events over a WebSocket feed the app can resume): the protocol, the bounds, the close codes and resume, in the console's `events.ts` part and `kernel/src/api/feed.ts`.

**Routes:** `GET /events/stream` (the WebSocket upgrade) and `GET /events`.

**Contract types it fills** (`app/src/api/contract.ts`): `SubscribeFrame` / `FeedClientFrame`, `EventFrame`, `TruncatedEventFrame` and `HeartbeatFrame` / `FeedServerFrame`, `FEED_CLOSE_CODES`, `EventsQuery` and `EventsResponse`.

The feed streams the append-only `events` table by id, so every approval, reply and session change reaches the app as soon as the kernel records it. It is a mechanism (invariant 1) and read-only: it reads `id, at, kind, session_id, task_id, payload_json` and writes nothing. A payload is untrusted data (invariant 3). It is parsed as JSON and passed on, never interpreted. REST stays for reads and actions.

The API server authenticates the upgrade and checks its path before upgrading, with the same bearer token as every route. A missing or wrong token gets `401` and no upgrade; see [ARCHITECTURE.md: Loopback API](../ARCHITECTURE.md#loopback-api). The authenticated socket is handed to `handleEventFeed`. This page supersedes two ARCHITECTURE.md sentences that still describe item 01's stub: the Loopback API's "which today closes it at once with 1013 and the reason `not yet`" and Phase 5 features' "handed to the `handleEventFeed` stub". Updating them is an owner follow-up.

## Protocol

| Step | Frame |
|---|---|
| The client's first and only frame | `{"type":"subscribe","after":N}`, where `N` is a non-negative safe integer: the last event id the client has (0 for everything). |
| Backlog | Every event with id > `N`, oldest first. The kernel reads and sends it in pages of at most 500 rows until a page comes back short. |
| Live | Then each new event, as the shared poll finds it: within about 250 ms of its append, and within 500 ms (pinned). |
| Heartbeat | `{"type":"heartbeat","latest_id":M}` every 15 s to every subscribed client. `M` is the newest event id. The kernel polls just before each heartbeat, so the client has already been sent every event up to `M`. |

An event frame is `{"type":"event","id","at","kind","session_id","task_id","payload"}`. `payload` is the stored `payload_json` parsed as a JSON value, or `null` when the column is null. Stored text that does not parse is sent as the raw string (no writer produces it).

A connected client that has not subscribed yet gets no events and no heartbeats. The backlog and the switch to live run in one synchronous stretch (the store is synchronous), so no event can fall between them. During live streaming each client is sent only events above its own last id, so an event appended during a client's catch-up reaches it exactly once.

## Bounds

| Bound | Value | What happens |
|---|---|---|
| Clients | 4 per store, counted from the socket's open (subscribed or not) | A fifth is closed with 1013. A closed client frees its slot at once. |
| Slow client | `socket.bufferedAmount` over 8 MiB (`DEFAULT_FEED_MAX_BUFFERED_BYTES`) | Checked before every send. Over the bound, the client is closed with 1011 and dropped. Frames already queued still reach it before the close frame. Tests lower the bound through `setFeedMaxBufferedBytesForTesting` in `feed.ts`, never through `EventFeedContext`. |
| Frame size | 1 MiB (1,048,576 bytes) of serialized frame | A bigger event is sent as `{"type":"event","id","kind","truncated":true}`. Read it in full with `GET /events?after=<id - 1>&limit=1`. |
| Poll | One shared 250 ms poll per store, plus one 15 s heartbeat timer | Both start on the first connect and stop when the last client closes, or when `api.close()` terminates it. No timer runs while no client is connected. |

A backlog that fills the slow-client bound within one catch-up (several MiB unsent) is closed with 1011 partway through. The client reconnects from the last id it received and gets the rest. Each reconnect makes progress, because the bound is above the frame cap.

## Close codes

| Code | When | The client should |
|---|---|---|
| 1013 | A fifth client on one store | Try again later. |
| 1011 | Too slow: its unsent data passed the bound | Resubscribe with `after` = the last id it received. |
| 1003 | A malformed client frame: not JSON; not an object; a `type` other than `subscribe`; an `after` that is not a non-negative safe integer; a binary frame; or any frame after the subscribe | Fix the frame. Nothing is sent before the close. |
| 1001 | The feed stopped because its store failed, for example the store closed during a kernel shutdown | Reconnect and resubscribe from its last id once the kernel is back. |

`FEED_CLOSE_CODES` in `feed.ts` equals the contract's (1013, 1011, 1003). 1001 is the standard "going away" code, used only for the store failure above.

## Resume

A client keeps the id of the last event it received. After any close it reconnects and subscribes with that id as `after`. It gets every event after it, none twice and none missed, because ids follow append order and the table is append-only. A truncated frame, or a gap the client suspects, is read through `GET /events`.

## `GET /events`

`GET /events?after=N&limit=M` (bearer token, like every route) returns `{"events": [...]}`: the same frames as the feed, oldest first, every event with id > `N`, at most `M`. Rows are always sent in full, never truncated.

| Query | Rule | Error |
|---|---|---|
| `after` | A non-negative integer, no leading zero, a safe integer. Absent means 0. | `400 {"error":"invalid_after"}` |
| `limit` | 1-500. Absent means 500. | `400 {"error":"invalid_limit"}` |

## The kill switch and stopping

The kill switch stops work, not reads. While it is engaged the feed keeps streaming, so the app sees `kill_switch_engaged` and `stop_all_completed` live (item 17's menu bar needs them). The feed never blocks or breaks `POST /stop-all`. It only reads, and the store runs in WAL mode, where a reader never blocks the writer.

A graceful stop (`api.close()`, then the store's close in the kernel's teardown) terminates every feed socket. Each socket's `'close'` removes its client, and the last one clears the poll and heartbeat timers. If the store closes while a client is still subscribed and the API is still open, the next poll tick catches the read error and stops that store's feed quietly: timers cleared, every client closed with 1001, nothing thrown. A socket that connects to a closed store is closed with 1001 the same way. The feed never throws out of a socket listener or a timer, because the API server terminates any socket whose handler throws.
