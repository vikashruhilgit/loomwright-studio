// The live event feed (phase 5 item 02): one WebSocket on the loopback API at
// `GET /events/stream`, behind the same bearer token as every route. The API
// server authenticates the upgrade request and checks its path before any
// upgrade (`startApiServer`'s `'upgrade'` listener), then hands each socket
// here. Protocol, bounds and close codes: `docs/architecture/feed.md`.
//
// The client's one frame is `{"type":"subscribe","after":N}`. The feed then
// sends every event with id > N, oldest first, in pages of at most 500 rows,
// then each new one as the shared poll finds it, plus a heartbeat every 15 s.
// One hub per store holds the connected clients, one 250 ms poll and one 15 s
// heartbeat timer: both start on the first connect and stop when the last
// client closes, so nothing runs while no client is connected.
//
// Read-only, and mechanism only (invariant 1): it streams the `events` table
// and writes nothing. A payload is untrusted data (invariant 3), passed on as
// stored. The kill switch stops work, not reads: the feed keeps streaming.
import type { IncomingMessage } from "node:http";
import type { RawData, WebSocket } from "ws";
import { EVENT_PAGE_SIZE, eventFrameOf, latestEventId, readEventsAfter } from "../console/events.js";
import type { EventRow } from "../console/events.js";
import type { Store } from "../store/store.js";

/** The feed's path: the only path the API server upgrades. */
export const EVENT_FEED_PATH = "/events/stream";

/**
 * The feed's close codes (RFC 6455 registry), equal to the app contract's
 * `FEED_CLOSE_CODES`: 1013 a fifth client, 1011 a client too slow to keep up
 * (it resumes from its last id), 1003 a malformed client frame.
 */
export const FEED_CLOSE_CODES = Object.freeze({ tryAgainLater: 1013, tooSlow: 1011, malformedFrame: 1003 } as const);

/** 1001 (going away): the feed stopped because its store failed (closed under it). The client resumes from its last id. */
export const FEED_GOING_AWAY_CODE = 1001;

/** At most this many sockets per store, counted from their open (subscribed or not). */
export const FEED_MAX_CLIENTS = 4;

/** The shared poll's period: a new event reaches a live client within about this long. */
export const FEED_POLL_MS = 250;

/** A heartbeat goes to every live client this often. */
export const FEED_HEARTBEAT_MS = 15_000;

/** A serialized event frame over this many bytes (1 MiB) is sent in its truncated form. */
export const FEED_MAX_FRAME_BYTES = 1_048_576;

/** The default slow-client bound: 8 MiB of unsent data (`socket.bufferedAmount`), above the 1 MiB frame cap. */
export const DEFAULT_FEED_MAX_BUFFERED_BYTES = 8 * 1_048_576;

let maxBufferedBytes = DEFAULT_FEED_MAX_BUFFERED_BYTES;

/** The slow-client bound in force: a client whose unsent data passes it is closed with 1011. */
export function feedMaxBufferedBytes(): number {
  return maxBufferedBytes;
}

/**
 * Test only: lower (or raise) the slow-client bound, so a test needs no
 * multi-MiB flood; `undefined` restores the default. Never called by the kernel.
 */
export function setFeedMaxBufferedBytesForTesting(bytes: number | undefined): void {
  if (bytes !== undefined && !(Number.isSafeInteger(bytes) && bytes >= 0)) {
    throw new RangeError(`the feed's slow-client bound must be a non-negative safe integer, not ${String(bytes)}`);
  }
  maxBufferedBytes = bytes ?? DEFAULT_FEED_MAX_BUFFERED_BYTES;
}

/** What the feed handler gets beside the socket and its upgrade request: the API server's own store and clock. */
export interface EventFeedContext {
  readonly store: Store;
  readonly now: () => Date;
}

/** One connected socket. */
interface FeedClient {
  readonly socket: WebSocket;
  /** Its subscribe frame arrived (any later frame is malformed). */
  subscribed: boolean;
  /** Caught up: the poll's events and the heartbeats reach it. Never before its subscribe. */
  live: boolean;
  /** The id of the last event it was sent (its `after` until then). */
  last: number;
  /** Closed by the feed: nothing more is sent or read. */
  done: boolean;
}

/** One store's feed: its clients, its poll cursor and its two timers (both set exactly while a client is connected). */
interface FeedHub {
  readonly store: Store;
  readonly clients: Set<FeedClient>;
  /** The id of the last event the poll has read (the newest event's when the hub started). */
  last: number;
  poll: ReturnType<typeof setInterval> | undefined;
  heartbeat: ReturnType<typeof setInterval> | undefined;
}

/** One hub per store, so two API servers in one process never share a cursor. Deleted when its last client closes. */
const hubs = new Map<Store, FeedHub>();

/** Test only: whether `store`'s hub has its poll and heartbeat timers set (false and false when it has no hub). */
export function feedTimersActive(store: Store): { readonly poll: boolean; readonly heartbeat: boolean } {
  const hub = hubs.get(store);
  return { poll: hub?.poll !== undefined, heartbeat: hub?.heartbeat !== undefined };
}

function startTimers(hub: FeedHub): void {
  hub.poll = setInterval(() => poll(hub), FEED_POLL_MS);
  hub.heartbeat = setInterval(() => beat(hub), FEED_HEARTBEAT_MS);
  // Never what keeps a process alive: the API server's socket does that.
  hub.poll.unref();
  hub.heartbeat.unref();
}

function stopTimers(hub: FeedHub): void {
  if (hub.poll !== undefined) clearInterval(hub.poll);
  hub.poll = undefined;
  if (hub.heartbeat !== undefined) clearInterval(hub.heartbeat);
  hub.heartbeat = undefined;
}

/** `client` is gone (its socket closed, or the feed closed it): the last one out stops the timers and drops the hub. */
function removeClient(hub: FeedHub, client: FeedClient): void {
  hub.clients.delete(client);
  if (hub.clients.size > 0) return;
  stopTimers(hub);
  if (hubs.get(hub.store) === hub) hubs.delete(hub.store);
}

/** Close `client` with `code` and drop it at once (a lingering close handshake must not hold a client slot). */
function dropClient(hub: FeedHub, client: FeedClient, code: number, reason: string): void {
  if (client.done) return;
  client.done = true;
  client.live = false;
  try {
    client.socket.close(code, reason);
  } catch {
    client.socket.terminate();
  }
  removeClient(hub, client);
}

/**
 * Stop the hub: its store failed (closed under the feed). Timers cleared,
 * every client closed with 1001, the hub dropped; quiet, never a throw.
 */
function stopHub(hub: FeedHub): void {
  stopTimers(hub);
  if (hubs.get(hub.store) === hub) hubs.delete(hub.store);
  for (const client of [...hub.clients]) dropClient(hub, client, FEED_GOING_AWAY_CODE, "feed stopped");
}

/**
 * Send `text` to `client` unless it is past the slow-client bound, which
 * closes it with 1011 instead. False when nothing was sent.
 */
function sendTo(hub: FeedHub, client: FeedClient, text: string): boolean {
  const socket = client.socket;
  if (client.done || socket.readyState !== socket.OPEN) return false;
  if (socket.bufferedAmount > maxBufferedBytes) {
    dropClient(hub, client, FEED_CLOSE_CODES.tooSlow, "too slow");
    return false;
  }
  socket.send(text);
  return true;
}

/** `row`'s frame as sent on the feed: the full `EventFrame`, or the truncated form when that is over 1 MiB. */
function feedTextOf(row: EventRow): string {
  const text = JSON.stringify(eventFrameOf(row));
  if (Buffer.byteLength(text, "utf8") <= FEED_MAX_FRAME_BYTES) return text;
  return JSON.stringify({ type: "event", id: row.id, kind: row.kind, truncated: true });
}

/** Send `row` to `client`; its `last` moves only when it was sent. */
function sendEvent(hub: FeedHub, client: FeedClient, row: EventRow, text: string = feedTextOf(row)): boolean {
  if (!sendTo(hub, client, text)) return false;
  client.last = row.id;
  return true;
}

/**
 * The shared poll: read every event after the hub's cursor, page by page,
 * and send each to every live client that has not had it. Any store error
 * (the store closed under a subscribed client) stops the hub quietly.
 */
function poll(hub: FeedHub): void {
  try {
    for (;;) {
      const rows = readEventsAfter(hub.store, hub.last, EVENT_PAGE_SIZE);
      for (const row of rows) {
        let text: string | undefined;
        for (const client of [...hub.clients]) {
          // A client that caught up past the cursor has had this row already.
          if (!client.live || row.id <= client.last) continue;
          text ??= feedTextOf(row);
          sendEvent(hub, client, row, text);
        }
        hub.last = row.id;
      }
      // Done, or every client was dropped mid-page (the hub is gone).
      if (rows.length < EVENT_PAGE_SIZE || hubs.get(hub.store) !== hub) return;
    }
  } catch {
    stopHub(hub);
  }
}

/** The heartbeat: poll first, so `latest_id` never names an event a live client has not been sent. */
function beat(hub: FeedHub): void {
  poll(hub);
  if (hubs.get(hub.store) !== hub) return;
  const text = JSON.stringify({ type: "heartbeat", latest_id: hub.last });
  for (const client of [...hub.clients]) if (client.live) sendTo(hub, client, text);
}

/**
 * Send `client` every event after `after`, in pages of at most 500, then make
 * it live. One synchronous stretch (the store is synchronous), so no append
 * can fall between the catch-up and the switch to live. An `after` past the
 * newest stored id is clamped to that id: kept as given, it would make the
 * poll skip every new event until ids passed it, a client starved in silence.
 */
function catchUp(hub: FeedHub, client: FeedClient, after: number): void {
  try {
    client.last = Math.min(after, latestEventId(hub.store));
    for (;;) {
      const rows = readEventsAfter(hub.store, client.last, EVENT_PAGE_SIZE);
      for (const row of rows) if (!sendEvent(hub, client, row)) return;
      if (rows.length < EVENT_PAGE_SIZE) break;
    }
  } catch {
    stopHub(hub);
    return;
  }
  client.live = true;
}

/** The frame's text; a fragmented message arrives as a list of buffers. */
function textOf(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** The subscribe frame's `after`, or `undefined` when the frame is malformed. Read as data, never acted on beyond that. */
function subscribeAfter(data: RawData, isBinary: boolean): number | undefined {
  if (isBinary) return undefined;
  let frame: unknown;
  try {
    frame = JSON.parse(textOf(data));
  } catch {
    return undefined;
  }
  if (typeof frame !== "object" || frame === null || Array.isArray(frame)) return undefined;
  const { type, after } = frame as { readonly type?: unknown; readonly after?: unknown };
  if (type !== "subscribe") return undefined;
  if (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0) return undefined;
  return after;
}

/** One client frame: the subscribe, or a malformed frame (anything else, including a second frame), which closes it with 1003. */
function receive(hub: FeedHub, client: FeedClient, data: RawData, isBinary: boolean): void {
  if (client.done) return;
  const after = client.subscribed ? undefined : subscribeAfter(data, isBinary);
  if (after === undefined) {
    dropClient(hub, client, FEED_CLOSE_CODES.malformedFrame, "malformed frame");
    return;
  }
  client.subscribed = true;
  catchUp(hub, client, after);
}

/**
 * Serve one authenticated feed socket. `req` is the upgrade request (already
 * authenticated; never read). A fifth socket on one store is closed with
 * 1013. Never throws: its listeners catch, and its bookkeeping runs on the
 * socket's `'close'`, which `ApiServer.close()`'s terminate also emits.
 */
export function handleEventFeed(socket: WebSocket, req: IncomingMessage, ctx: EventFeedContext): void | Promise<void> {
  void req;
  let hub = hubs.get(ctx.store);
  if (hub === undefined) {
    let last: number;
    try {
      last = latestEventId(ctx.store);
    } catch {
      socket.close(FEED_GOING_AWAY_CODE, "feed stopped");
      return;
    }
    hub = { store: ctx.store, clients: new Set(), last, poll: undefined, heartbeat: undefined };
    hubs.set(ctx.store, hub);
  }
  if (hub.clients.size >= FEED_MAX_CLIENTS) {
    socket.close(FEED_CLOSE_CODES.tryAgainLater, "too many clients");
    return;
  }
  const served = hub;
  const client: FeedClient = { socket, subscribed: false, live: false, last: 0, done: false };
  served.clients.add(client);
  if (served.clients.size === 1) startTimers(served);
  socket.on("close", () => removeClient(served, client));
  socket.on("message", (data: RawData, isBinary: boolean) => {
    try {
      receive(served, client, data, isBinary);
    } catch {
      // Not expected (store errors stop the hub inside): drop only this client.
      dropClient(served, client, FEED_GOING_AWAY_CODE, "feed stopped");
    }
  });
}
