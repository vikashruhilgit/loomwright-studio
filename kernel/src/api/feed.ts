// The live event feed (phase 5 item 02): one WebSocket on the loopback API at
// `GET /events/stream`, behind the same bearer token as every route. The API
// server authenticates the upgrade request and checks its path before any
// upgrade (`startApiServer`'s `'upgrade'` listener), then hands each socket
// here. A stub until item 02 fills it in: it closes every socket at once with
// 1013 (try again later) and the reason `not yet`.
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import type { Store } from "../store/store.js";

/** The feed's path: the only path the API server upgrades. */
export const EVENT_FEED_PATH = "/events/stream";

/** The close code the stub answers with: 1013, "Try Again Later" (RFC 6455 registry). */
export const FEED_NOT_YET_CODE = 1013;

/** What the feed handler gets beside the socket and its upgrade request: the API server's own store and clock. */
export interface EventFeedContext {
  readonly store: Store;
  readonly now: () => Date;
}

/**
 * Serve one authenticated feed socket. `req` is the upgrade request (already
 * authenticated; its headers are never echoed). May be async: the server
 * terminates the socket when it throws or rejects. Today a stub: closes the
 * socket with `FEED_NOT_YET_CODE` and the reason `not yet`, reading nothing.
 */
export function handleEventFeed(socket: WebSocket, req: IncomingMessage, ctx: EventFeedContext): void | Promise<void> {
  void req;
  void ctx;
  socket.close(FEED_NOT_YET_CODE, "not yet");
}
