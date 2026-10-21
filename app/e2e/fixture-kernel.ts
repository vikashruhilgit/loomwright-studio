// The fixture kernel: a fake loopback API plus feed serving canned data, so
// the app's e2e runs every designed state with no real kernel (and no
// Keychain: the token reaches the app's MAIN process through
// `STUDIO_APP_FIXTURE_TOKEN`, honoured only in an unpackaged run).
//
// It behaves like the kernel where the app can tell: 127.0.0.1 only, the
// bearer token checked before routing (401 `{"error":"unauthorized"}` with
// `WWW-Authenticate: Bearer`), `<dataDir>/api.json` with a live pid and the
// port, and the feed's `subscribe` / `event` frames on `GET /events/stream`.
// Each screen adds its canned data in `app/e2e/fixtures/<screen>.ts` and
// passes it in as `routes` and `events`.
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { EventFrame, RouteKey, StatusBody } from "../src/api/contract";

/** The fixture's token: the kernel's shape (64 lowercase hex characters), never a real one. */
export const FIXTURE_TOKEN = "0123456789abcdef".repeat(4);

export const FIXTURE_HOST = "127.0.0.1";

/** What a fixture route sees. */
export interface FixtureRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface FixtureAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** A canned answer, or a function of the request. */
export type FixtureRoute = FixtureAnswer | ((req: FixtureRequest) => FixtureAnswer);

export interface FixtureKernelOptions {
  /** Keyed `"<METHOD> <path>"` as in `CONTRACT_ROUTES`; merged over the defaults (`GET /status`). */
  readonly routes?: Partial<Record<RouteKey, FixtureRoute>>;
  /** The `events` rows the feed serves, by id. */
  readonly events?: readonly EventFrame[];
  /** Default: a new temporary directory. Reuse one to restart a fixture in place. */
  readonly dataDir?: string;
  /** Default 0 (OS-assigned). Reuse one to restart a fixture on the same port. */
  readonly port?: number;
}

export interface FixtureKernel {
  readonly port: number;
  readonly dataDir: string;
  /** The environment for `electron.launch({ env })`. */
  readonly env: Readonly<Record<string, string>>;
  /** Every authenticated request, in order. */
  readonly requests: readonly { readonly method: string; readonly path: string }[];
  /** Append an event: subscribed feed clients receive it at once. */
  appendEvent(event: EventFrame): void;
  close(): Promise<void>;
}

/** A canned `/status`: a kernel at rest, nothing running, nothing pending. */
export function cannedStatus(overrides: Partial<StatusBody> = {}): StatusBody {
  return {
    kernel: { version: "0.0.0-fixture", uptime_s: 42, pid: process.pid },
    kill_switch: { engaged: false, since: null },
    auth: [{ id: "subscription-token", account: "fixture", health: { status: "ok" } }],
    sessions: [],
    kill_unconfirmed: [],
    orphaned: [],
    queue: { pending: 0, events: [] },
    wakeups: { pending: 0, items: [] },
    tokens_today: { day: "2026-10-21", agents: [] },
    cap_state: [],
    ...overrides,
  };
}

const DEFAULT_ROUTES: Partial<Record<RouteKey, FixtureRoute>> = {
  "GET /status": () => ({ status: 200, body: cannedStatus() }),
};

/** The app's environment for a data dir: the fixture's dir and token, nothing of the owner's. */
export function appEnv(dataDir: string): Readonly<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return { ...env, STUDIO_DATA_DIR: dataDir, STUDIO_APP_FIXTURE_TOKEN: FIXTURE_TOKEN };
}

export function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), "studio-app-fixture-"));
}

function writeApiInfo(dataDir: string, port: number): void {
  writeFileSync(join(dataDir, "api.json"), `${JSON.stringify({ pid: process.pid, port })}\n`, { mode: 0o600 });
}

/** A data dir whose api.json names a live pid and a port nothing listens on: the "kernel unreachable" state. */
export async function unreachableDataDir(): Promise<string> {
  const dataDir = tempDataDir();
  const probe = createServer();
  const port = await new Promise<number>((done) => probe.listen(0, FIXTURE_HOST, () => done((probe.address() as AddressInfo).port)));
  await new Promise<void>((done) => probe.close(() => done()));
  writeApiInfo(dataDir, port);
  return dataDir;
}

function authorized(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${FIXTURE_TOKEN}`;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(text)), Connection: "close", ...headers });
  res.end(text);
}

/** `pattern`'s params when `path` matches it (`:name` segments), else `undefined`. */
function match(pattern: string, path: string): Record<string, string> | undefined {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return undefined;
  const params: Record<string, string> = {};
  for (const [i, segment] of want.entries()) {
    const value = got[i] as string;
    if (segment.startsWith(":")) {
      if (value === "") return undefined;
      params[segment.slice(1)] = decodeURIComponent(value);
    } else if (segment !== value) return undefined;
  }
  return params;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Start a fixture kernel and write its api.json. */
export async function startFixtureKernel(options: FixtureKernelOptions = {}): Promise<FixtureKernel> {
  const routes = { ...DEFAULT_ROUTES, ...options.routes };
  const events: EventFrame[] = [...(options.events ?? [])];
  const dataDir = options.dataDir ?? tempDataDir();
  const requests: { method: string; path: string }[] = [];
  const subscribers = new Map<WebSocket, number>();
  const sockets = new Set<Socket>();

  const server: Server = createServer((req, res) => {
    if (!authorized(req)) {
      req.resume();
      send(res, 401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    requests.push({ method, path: url.pathname });
    void (async () => {
      const body = await readBody(req);
      for (const [key, route] of Object.entries(routes)) {
        const [routeMethod, pattern] = key.split(" ") as [string, string];
        if (routeMethod !== method || route === undefined) continue;
        const params = match(pattern, url.pathname);
        if (params === undefined) continue;
        const answer = typeof route === "function" ? route({ method, path: url.pathname, params, query: Object.fromEntries(url.searchParams), body }) : route;
        send(res, answer.status, answer.body);
        return;
      }
      send(res, 404, { error: "not_found" });
    })();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  const feed = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!authorized(req) || path !== "/events/stream") {
      socket.end("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    requests.push({ method: "GET", path });
    feed.handleUpgrade(req, socket, head, (client) => {
      client.on("message", (data) => {
        let frame: unknown;
        try {
          frame = JSON.parse(String(data));
        } catch {
          client.close(1003, "malformed frame");
          return;
        }
        const after = (frame as { type?: unknown; after?: unknown }).after;
        if ((frame as { type?: unknown }).type !== "subscribe" || typeof after !== "number") {
          client.close(1003, "malformed frame");
          return;
        }
        subscribers.set(client, after);
        for (const event of events) if (event.id > after) client.send(JSON.stringify(event));
      });
      client.on("close", () => subscribers.delete(client));
    });
  });

  const port = await new Promise<number>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, FIXTURE_HOST, () => done((server.address() as AddressInfo).port));
  });
  writeApiInfo(dataDir, port);

  return {
    port,
    dataDir,
    env: appEnv(dataDir),
    requests,
    appendEvent(event) {
      events.push(event);
      for (const client of subscribers.keys()) client.send(JSON.stringify(event));
    },
    async close() {
      for (const client of feed.clients) client.terminate();
      feed.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
