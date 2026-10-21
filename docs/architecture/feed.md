# Feed

Part of [Phase 5 features](../ARCHITECTURE.md#phase-5-features). Built and documented by **item 02** (the kernel streams its events over a WebSocket feed the app can resume): the protocol, the bounds, the close codes and resume, in the console's `events.ts` part and `kernel/src/api/feed.ts`.

**Routes:** `GET /events/stream` (the WebSocket upgrade) and `GET /events`.

**Contract types it fills** (`app/src/api/contract.ts`): `SubscribeFrame` / `FeedClientFrame`, `EventFrame`, `TruncatedEventFrame` and `HeartbeatFrame` / `FeedServerFrame`, `FEED_CLOSE_CODES`, `EventsQuery` and `EventsResponse`.

Today (item 01) the API server authenticates the upgrade and checks its path before upgrading, and the `handleEventFeed` stub closes every socket at once with 1013 and the reason `not yet`; see [ARCHITECTURE.md: Loopback API](../ARCHITECTURE.md#loopback-api).
