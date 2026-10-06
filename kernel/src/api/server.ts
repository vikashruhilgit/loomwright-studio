// The kernel's loopback HTTP API (AC1-AC3): 127.0.0.1 only, every request
// authenticated with the Keychain bearer token before any routing. Mechanism
// only (invariant 1): it reports state, pulls the kill switch and carries the
// owner's abandon of an unverifiable orphan, nothing more.
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AuthHealth, AuthProvider } from "../auth/types.js";
import { localDay } from "../budget/index.js";
import type { EventLoop } from "../loop/loop.js";
import type { AbandonVia, SessionManager, StopAllOutcome } from "../sessions/manager.js";
import { orphanedSessions } from "../sessions/orphans.js";
import type { OrphanedSession } from "../sessions/orphans.js";
import { SessionError } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { kernelVersion } from "../version.js";
import { engageKillSwitch, killSwitchState, releaseKillSwitch } from "./kill-switch.js";

/** The only address the API ever binds. Not configurable: never `0.0.0.0` or `::`. */
export const API_HOST = "127.0.0.1";

/** `/status` lists at most this many pending queue rows and wake-ups (the counts are complete). */
export const STATUS_LIST_LIMIT = 50;

/** `POST /sessions/<id>/abandon`; the id is checked separately (a safe positive integer). */
const ABANDON_PATH = /^\/sessions\/(\d+)\/abandon$/;

/**
 * The header the `studio` CLI sends with `POST /sessions/<id>/abandon`
 * (value `cli`), recorded as the abandon's `via`; anything else is `api`.
 * The request is authenticated either way: this only labels the caller.
 */
export const CLIENT_HEADER = "x-studio-client";

export interface ApiServerOptions {
  readonly store: Store;
  readonly sessions: Pick<SessionManager, "stopAll" | "abandonSession">;
  readonly loop: Pick<EventLoop, "start" | "stop">;
  /** Reported in `/status` (id, account, health); never their secrets. */
  readonly authProviders: readonly AuthProvider[];
  /** The bearer token every request must present. */
  readonly token: string;
  /** Default 0: an OS-assigned port. */
  readonly port?: number;
}

export interface ApiServerDeps {
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** The budget day of an instant; must be the budget meter's (default: the host's local day). */
  readonly dayOf?: (at: Date) => string;
  /** When the kernel started, for `uptime_s`. Defaults to the server's start. */
  readonly startedAt?: Date;
  /** Defaults to `process.pid`. */
  readonly pid?: number;
}

export interface ApiServer {
  readonly port: number;
  readonly host: typeof API_HOST;
  /** The listening socket's address (`server.address()`), or `null` once closed. */
  address(): AddressInfo | null;
  /** Stop listening; resolves once in-flight requests are answered. Idempotent. */
  close(): Promise<void>;
}

/** A recorded tool group (H08) a kill could not settle: `session_groups.kill_incomplete_at` set, not resolved. */
export interface UnconfirmedToolGroup {
  readonly pgid: number;
  /** The group leader's executable as last recorded (`ps -o comm=`). */
  readonly command: string;
  readonly kill_incomplete_at: string;
}

/** The `/status` body (AC2). */
export interface StatusBody {
  readonly kernel: { readonly version: string; readonly uptime_s: number; readonly pid: number };
  readonly kill_switch: { readonly engaged: boolean; readonly since: string | null };
  readonly auth: readonly { readonly id: string; readonly account: string | null; readonly health: AuthHealth }[];
  readonly sessions: readonly {
    readonly id: number;
    readonly agent: string | null;
    readonly model: string | null;
    readonly pgid: number | null;
    readonly started_at: string | null;
    readonly status: string;
  }[];
  /**
   * Every session whose group a kill could not confirm gone, whatever its
   * status (a `failed` (`kill_incomplete`) or `failed:auth` row, an
   * `orphaned`, `interrupted` or live one): its CLI's group
   * (`sessions.kill_incomplete_at` set by a kill that gave up or errored), or
   * a process group its tools started (H08: an unsettled `session_groups` row
   * flagged by a kill that gave up or errored, or by a failed `ps`), listed
   * in `tool_groups`. Such a group may still be alive; the reaper retries the
   * kill and clears the flag once the group is gone or proven foreign, and
   * the session leaves the list once no flag is left. An `abandoned` row's
   * tool groups are never signalled again, so they are not listed (abandoning
   * clears the CLI's flag the same way). `kill_incomplete_at` is the CLI's
   * flag, else the earliest tool-group flag. `tool_groups` is present only
   * when non-empty (additive: an older CLI ignores it).
   */
  readonly kill_unconfirmed: readonly {
    readonly id: number;
    readonly agent: string | null;
    readonly status: string;
    readonly pgid: number | null;
    readonly kill_incomplete_at: string;
    readonly tool_groups?: readonly UnconfirmedToolGroup[];
  }[];
  /**
   * Every `orphaned` row (its group may still be the session's and alive),
   * with its latest orphaning reason from the kernel's own events. A
   * `leader_unverified` one stays orphaned until the owner abandons it
   * (`POST /sessions/<id>/abandon`, `studio session abandon <id>`). Additive:
   * an older CLI ignores it.
   */
  readonly orphaned: readonly OrphanedSession[];
  readonly queue: {
    readonly pending: number;
    readonly events: readonly {
      readonly id: number;
      readonly kind: string;
      readonly enqueued_at: string;
      readonly not_before: string | null;
      readonly attempts: number;
    }[];
  };
  readonly wakeups: {
    readonly pending: number;
    readonly items: readonly { readonly id: number; readonly due_at: string; readonly reason: string; readonly task_id: number | null }[];
  };
  readonly tokens_today: { readonly day: string; readonly agents: readonly { readonly agent: string | null; readonly counted_tokens: number }[] };
  readonly cap_state: readonly {
    /**
     * Display text: the live account label of the provider whose `id` is the
     * stored key, else the stored key itself (a row no provider claims).
     */
    readonly account: string;
    /** The stored key: the auth provider id the park belongs to (additive; an older CLI ignores it). */
    readonly provider: string;
    readonly limits: readonly {
      readonly rate_limit_type: string;
      readonly status: string;
      readonly resets_at: string | null;
      readonly utilization: number | null;
      readonly reset_source: string | null;
    }[];
  }[];
}

const UNAUTHORIZED_BODY = JSON.stringify({ error: "unauthorized" });

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(text)),
    "Cache-Control": "no-store",
    // One request per connection: nothing lingers to keep a closing server open.
    Connection: "close",
    ...headers,
  });
  res.end(text);
}

/**
 * `Authorization: Bearer <token>` with exactly the kernel's token. Compared in
 * constant time on equal-length buffers; a length mismatch is a plain refusal
 * (no compare). Neither token is ever logged or echoed.
 */
function isAuthorized(req: IncomingMessage, expected: Buffer): boolean {
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (match === null) return false;
  const presented = Buffer.from(match[1] as string, "utf8");
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/**
 * `provider.health(at)` with `readStatus`'s one instant. Providers are total,
 * but a provider that still throws (a test stub, a future provider) reports
 * `error` (`health_threw`), never a 500.
 */
function healthOf(provider: AuthProvider, at: Date): AuthHealth {
  try {
    return provider.health(at);
  } catch {
    // The message is dropped: it could carry Keychain output.
    return { status: "error", reason: "health_threw" };
  }
}

function safeAccount(provider: AuthProvider): string | null {
  try {
    return provider.account;
  } catch {
    return null;
  }
}

function count(store: Store, sql: string): number {
  return store.prepare<[], number>(sql).pluck().get() ?? 0;
}

/** An unsettled, flagged tool group of session `s` (the reaper's own retry condition). */
const FLAGGED_TOOL_GROUP = "g.session_id = s.id AND g.kill_incomplete_at IS NOT NULL AND g.resolved_at IS NULL";

/**
 * `StatusBody.kill_unconfirmed`: a flagged CLI group or a flagged, unsettled
 * tool group (H08) of a session not `abandoned` (the reaper's retry set), so
 * the kill switch never reads "stopped" here while a recorded group may live.
 */
function killUnconfirmed(store: Store): StatusBody["kill_unconfirmed"] {
  const rows = store
    .prepare<[], Omit<StatusBody["kill_unconfirmed"][number], "tool_groups">>(
      `SELECT s.id, s.agent, s.status, s.pgid,
              COALESCE(s.kill_incomplete_at,
                       (SELECT MIN(g.kill_incomplete_at) FROM session_groups g WHERE ${FLAGGED_TOOL_GROUP})) AS kill_incomplete_at
         FROM sessions s
        WHERE s.kill_incomplete_at IS NOT NULL
           OR (s.status <> 'abandoned' AND EXISTS (SELECT 1 FROM session_groups g WHERE ${FLAGGED_TOOL_GROUP}))
        ORDER BY s.id`,
    )
    .all();
  const groups = store.prepare<[number], UnconfirmedToolGroup>(
    `SELECT g.pgid, g.leader_command AS command, g.kill_incomplete_at FROM session_groups g JOIN sessions s ON s.id = g.session_id
      WHERE s.id = ? AND s.status <> 'abandoned' AND ${FLAGGED_TOOL_GROUP} ORDER BY g.first_seen, g.pgid`,
  );
  return rows.map((row) => {
    const toolGroups = groups.all(row.id);
    return toolGroups.length === 0 ? row : { ...row, tool_groups: toolGroups };
  });
}

/** Read the `/status` body from the store (AC2). Exported for the CLI's tests and later surfaces. */
export function readStatus(
  store: Store,
  authProviders: readonly AuthProvider[],
  at: Date,
  info: { readonly startedAt: Date; readonly pid: number; readonly dayOf: (at: Date) => string },
): StatusBody {
  const day = info.dayOf(at);
  const capRows = store
    .prepare<
      [],
      { account: string; rate_limit_type: string; status: string; resets_at: string | null; utilization: number | null; reset_source: string | null }
    >("SELECT account, rate_limit_type, status, resets_at, utilization, reset_source FROM cap_state ORDER BY account, rate_limit_type")
    .all();
  // `cap_state.account` holds the provider id (migration 9); the label is looked up for display.
  const capByKey = new Map<string, StatusBody["cap_state"][number]["limits"][number][]>();
  for (const { account: key, ...limit } of capRows) {
    const list = capByKey.get(key) ?? [];
    list.push(limit);
    capByKey.set(key, list);
  }
  const labelOf = (key: string): string => {
    const provider = authProviders.find((p) => p.id === key);
    return (provider === undefined ? null : safeAccount(provider)) ?? key;
  };
  return {
    kernel: {
      version: kernelVersion(),
      uptime_s: Math.max(0, Math.floor((at.getTime() - info.startedAt.getTime()) / 1_000)),
      pid: info.pid,
    },
    kill_switch: killSwitchState(store),
    auth: authProviders.map((p) => ({ id: p.id, account: safeAccount(p), health: healthOf(p, at) })),
    sessions: store
      .prepare<[], StatusBody["sessions"][number]>(
        "SELECT id, agent, model, pgid, started_at, status FROM sessions WHERE status IN ('starting', 'running') ORDER BY id",
      )
      .all(),
    kill_unconfirmed: killUnconfirmed(store),
    orphaned: orphanedSessions(store),
    queue: {
      pending: count(store, "SELECT count(*) FROM event_queue WHERE status = 'pending'"),
      events: store
        .prepare<[number], StatusBody["queue"]["events"][number]>(
          "SELECT id, kind, enqueued_at, not_before, attempts FROM event_queue WHERE status = 'pending' ORDER BY id LIMIT ?",
        )
        .all(STATUS_LIST_LIMIT),
    },
    wakeups: {
      pending: count(store, "SELECT count(*) FROM wakeups WHERE status = 'pending'"),
      items: store
        .prepare<[number], StatusBody["wakeups"]["items"][number]>(
          "SELECT id, due_at, reason, task_id FROM wakeups WHERE status = 'pending' ORDER BY due_at, id LIMIT ?",
        )
        .all(STATUS_LIST_LIMIT),
    },
    tokens_today: {
      day,
      // D26: counted_tokens = input + output + cache writes; cache reads never count.
      agents: store
        .prepare<[string], StatusBody["tokens_today"]["agents"][number]>(
          "SELECT agent, SUM(counted_tokens) AS counted_tokens FROM budget WHERE day = ? GROUP BY agent ORDER BY agent",
        )
        .all(day),
    },
    cap_state: [...capByKey].map(([key, limits]) => ({ account: labelOf(key), provider: key, limits })),
  };
}

/**
 * Start the API on `127.0.0.1:<port>` (default an OS-assigned port).
 *
 * - Every request is authenticated first, whatever its path or method:
 *   missing or wrong ⇒ `401 {"error":"unauthorized"}` with
 *   `WWW-Authenticate: Bearer`, so an unauthenticated caller learns nothing
 *   about the routes. Then: unknown path ⇒ 404, wrong method ⇒ 405.
 *   Request bodies are ignored.
 * - `GET /status` ⇒ `StatusBody`. Each provider's `health(at)` reads the
 *   request's one instant; its failures are typed `{status: "error", reason}`
 *   values, and a provider whose `health()` still throws reports
 *   `{status: "error", reason: "health_threw"}`, never a 500.
 * - `POST /stop-all` ⇒ engage the kill switch (`kill_switch_engaged`), stop
 *   the loop (its current event finishes, no other starts, so a session an
 *   in-flight handler starts is live before the next step), stop every
 *   session, append `stop_all_completed` with each outcome; answers
 *   `{engaged: true, sessions: [...]}`. Repeating it re-runs every step.
 * - `POST /resume` ⇒ when engaged, `kill_switch_released` and `loop.start()`;
 *   otherwise nothing is appended. Answers `{engaged: false}`.
 * - `POST /sessions/<id>/abandon` ⇒ `sessions.abandonSession(id, {via})`, with
 *   `via` `cli` when the `CLIENT_HEADER` says so, else `api`. A path that is
 *   not exactly that shape is an unknown path (404); an id that is not a safe
 *   positive integer ⇒ `400 {"error":"invalid_id"}`; no such row ⇒
 *   `404 {"error":"not_found"}`; a refusal ⇒ `409 {"error":"<code>"}` (the
 *   stable `SessionError` code); success ⇒ `{id, status: "abandoned"}`. An
 *   abandon whose client has disconnected by the time its turn comes is
 *   skipped: nothing is written, no event is appended, nothing is answered.
 *
 * The POSTs run one at a time, in arrival order.
 */
export async function startApiServer(options: ApiServerOptions, deps: ApiServerDeps = {}): Promise<ApiServer> {
  if (options.token === "") throw new RangeError("the API token must not be empty");
  const expected = Buffer.from(options.token, "utf8");
  const { store, sessions, loop, authProviders } = options;
  const now = deps.now ?? (() => new Date());
  const dayOf = deps.dayOf ?? localDay;
  const startedAt = deps.startedAt ?? now();
  const pid = deps.pid ?? process.pid;

  let control: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = control.then(fn, fn);
    control = run.catch(() => undefined);
    return run;
  };

  const stopAll = (): Promise<{ engaged: true; sessions: StopAllOutcome[] }> =>
    serialized(async () => {
      engageKillSwitch(store, now().toISOString());
      await loop.stop();
      const outcomes = await sessions.stopAll();
      store
        .prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'stop_all_completed', 'api', ?)")
        .run(now().toISOString(), JSON.stringify({ sessions: outcomes }));
      return { engaged: true, sessions: outcomes };
    });

  const resume = (): Promise<{ engaged: false }> =>
    serialized(async () => {
      if (killSwitchState(store).engaged) {
        releaseKillSwitch(store, now().toISOString());
        loop.start();
      }
      return { engaged: false };
    });

  // `clientGone` is read right before the abandon, with no await in between:
  // an abandon queued behind a slow POST whose client gave up (the CLI's
  // timeout) never runs, so the owner's "did not answer" is never followed by
  // a permanent abandon he was not told about. `undefined` ⇒ skipped.
  const abandon = (
    id: number,
    via: AbandonVia,
    clientGone: () => boolean,
  ): Promise<{ readonly status: number; readonly body: unknown } | undefined> =>
    serialized(async () => {
      if (clientGone()) return undefined;
      try {
        return { status: 200, body: { id, status: sessions.abandonSession(id, { via }) } };
      } catch (err) {
        // Only the stable code: the message is for the kernel's own records.
        if (!(err instanceof SessionError)) throw err;
        if (err.code === "not_found") return { status: 404, body: { error: "not_found" } };
        return { status: 409, body: { error: err.code } };
      }
    });

  const routes: Record<string, { readonly method: string; readonly run: () => Promise<unknown> }> = {
    "/status": {
      method: "GET",
      run: async () => readStatus(store, authProviders, now(), { startedAt, pid, dayOf }),
    },
    "/stop-all": { method: "POST", run: stopAll },
    "/resume": { method: "POST", run: resume },
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    req.resume();
    if (!isAuthorized(req, expected)) {
      send(res, 401, UNAUTHORIZED_BODY, { "WWW-Authenticate": "Bearer" });
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const abandonMatch = ABANDON_PATH.exec(path);
    if (abandonMatch !== null) {
      if (req.method !== "POST") {
        send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
        return;
      }
      const id = Number(abandonMatch[1]);
      if (!Number.isSafeInteger(id) || id < 1) {
        send(res, 400, { error: "invalid_id" });
        return;
      }
      const via: AbandonVia = req.headers[CLIENT_HEADER] === "cli" ? "cli" : "api";
      // Not `req.destroyed` or the request's 'close': both fire once the
      // (ignored) body is read, with the client still waiting. The socket and
      // the response only close when the connection does.
      const answer = await abandon(id, via, () => req.socket.destroyed || res.closed);
      if (answer !== undefined) send(res, answer.status, answer.body);
      return;
    }
    const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
    if (route === undefined) {
      send(res, 404, { error: "not_found" });
      return;
    }
    if (req.method !== route.method) {
      send(res, 405, { error: "method_not_allowed" }, { Allow: route.method });
      return;
    }
    send(res, 200, await route.run());
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      // No error text: it is never needed by a caller and could carry anything.
      if (!res.headersSent) send(res, 500, { error: "internal_error" });
      else res.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => reject(err);
    server.once("error", onError);
    server.listen(options.port ?? 0, API_HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  let closing: Promise<void> | undefined;
  return {
    port: address.port,
    host: API_HOST,
    address: () => server.address() as AddressInfo | null,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      return closing;
    },
  };
}
