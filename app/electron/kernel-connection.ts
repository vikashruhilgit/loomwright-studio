// The main process's connection to the kernel's loopback API, mirroring the
// `studio` CLI (docs/ARCHITECTURE.md §Loopback API):
//
//   1. read `<dataDir>/api.json` (pid + port, never a token);
//   2. check that pid is alive (`kill(pid, 0)`) before the token is read or sent;
//   3. read the bearer token from the Keychain item `loomwright-studio-api`
//      through `/usr/bin/security` (an argument array, never a shell);
//   4. connect only to 127.0.0.1 (a constant, never a setting).
//
// The token never leaves this module: it is never logged, never put in an
// error, and never in anything returned to the bridge. The renderer asks
// through `window.api`; the main process makes every call (D10, invariant 3).
//
// Seams, for the fixture kernel only, read from the MAIN process's
// environment (Playwright's `electron.launch({ env })` sets it; the renderer
// can never reach it): `STUDIO_DATA_DIR` (the kernel's own override, so the
// app and the CLI always agree on the data dir) and, in an unpackaged run
// only, `STUDIO_APP_FIXTURE_TOKEN` in place of the Keychain read.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { CONTRACT_ROUTES } from "../src/api/contract";
import type { ApiRequest, ApiResult, FeedRelayFrame, FeedServerFrame, KernelConnectionState, KernelUnreachableReason } from "../src/api/contract";

/** The only address the app ever connects to. Not configurable. */
export const API_HOST = "127.0.0.1";

/** The Keychain item (service name) the kernel keeps its API token in. */
export const API_TOKEN_KEYCHAIN_SERVICE = "loomwright-studio-api";

/** The kernel's data dir override (`DATA_DIR_ENV` in `kernel/src/store/store.ts`). */
export const DATA_DIR_ENV = "STUDIO_DATA_DIR";
export const DEFAULT_DATA_DIR_NAME = ".loomwright-studio";
export const API_INFO_FILENAME = "api.json";

/** The fixture kernel's token, honoured only in an unpackaged run (`app.isPackaged` false). */
export const FIXTURE_TOKEN_ENV = "STUDIO_APP_FIXTURE_TOKEN";

export const SECURITY_BIN = "/usr/bin/security";
/** `security find-generic-password` exits 44 when the item does not exist. */
const SECURITY_ITEM_NOT_FOUND_STATUS = 44;
const KEYCHAIN_READ_TIMEOUT_MS = 10_000;

/** One API call's deadline. */
export const REQUEST_TIMEOUT_MS = 10_000;

const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/** The data dir: `STUDIO_DATA_DIR` when set and non-empty, else `~/.loomwright-studio` (the kernel's `resolveDataDir`). */
export function resolveDataDir(env: Readonly<Record<string, string | undefined>>, homeDir: string = homedir()): string {
  const override = env[DATA_DIR_ENV];
  if (override !== undefined && override !== "") return resolve(override);
  return join(homeDir, DEFAULT_DATA_DIR_NAME);
}

/** Reads the token: the value, `undefined` when the item does not exist; throws (with no secret in it) when the read fails. */
export type TokenReader = () => Promise<string | undefined>;

/** The real reader: `/usr/bin/security find-generic-password -s loomwright-studio-api -w`. */
export function keychainTokenReader(): TokenReader {
  return () =>
    new Promise((done, fail) => {
      execFile(
        SECURITY_BIN,
        ["find-generic-password", "-s", API_TOKEN_KEYCHAIN_SERVICE, "-w"],
        { encoding: "utf8", timeout: KEYCHAIN_READ_TIMEOUT_MS },
        (err, stdout) => {
          if (err !== null) {
            const code = (err as { code?: unknown }).code;
            // Deliberately drop `err` and its output: only the fact of failure crosses.
            if (code === SECURITY_ITEM_NOT_FOUND_STATUS) done(undefined);
            else fail(new Error("the Keychain read failed"));
            return;
          }
          // `-w` prints the secret and one newline: exactly that newline is removed.
          done(stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout);
        },
      );
    });
}

/** The token reader for this run: the fixture's (unpackaged runs only) or the Keychain's. */
export function tokenReaderFor(
  env: Readonly<Record<string, string | undefined>>,
  isPackaged: boolean,
  keychain: () => TokenReader = keychainTokenReader,
): TokenReader {
  const fixture = env[FIXTURE_TOKEN_ENV];
  if (!isPackaged && fixture !== undefined && fixture !== "") return async () => fixture;
  return keychain();
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ESRCH: no such process. EPERM: another user's, never this user's kernel.
    return false;
  }
}

export interface KernelConnectionDeps {
  readonly dataDir: string;
  readonly readToken: TokenReader;
  readonly isPidAlive?: (pid: number) => boolean;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  /** A diagnostic line (never a token, never a response body). Defaults to nothing. */
  readonly log?: (line: string) => void;
  /** The feed's socket. Defaults to `ws`. */
  readonly openSocket?: (url: string, headers: Readonly<Record<string, string>>) => FeedSocket;
}

/** The part of a `ws` socket the feed relay uses. */
export interface FeedSocket {
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: (code: number, reason: unknown) => void): unknown;
  on(event: "error", listener: (err: unknown) => void): unknown;
  send(data: string): void;
  close(): void;
}

export interface FeedHandle {
  close(): void;
}

export interface KernelConnection {
  /** Where the kernel is, checked fresh (api.json, pid, token, then `GET /status`). */
  connection(): Promise<KernelConnectionState>;
  /** One call through the contract. Never returns the token. */
  request(req: ApiRequest): Promise<ApiResult<unknown>>;
  /** The feed: `subscribe` from `after`, each server frame and the close passed to `onFrame`. */
  openFeed(after: number, onFrame: (frame: FeedRelayFrame) => void): Promise<{ readonly state: KernelConnectionState; readonly handle?: FeedHandle }>;
}

type Unreachable = Exclude<KernelConnectionState, { readonly state: "connected" }>;

/** The routes the main process will call: `CONTRACT_ROUTES`, less the feed's upgrade (never a plain request). */
const CALLABLE = CONTRACT_ROUTES.filter((r) => r.path !== "/events/stream").map((r) => ({
  method: r.method,
  segments: r.path.split("/").slice(1),
}));

/** `.` and `..` are dot-segments: URL parsing removes them, so a param holding one would move the call off the contract route. */
const DOT_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

/** True when URL parsing leaves `path` exactly as built (no dot-segment removed, nothing re-encoded). */
export function resolvesUnchanged(path: string): boolean {
  return new URL(path, `http://${API_HOST}`).pathname === path;
}

/**
 * The request's path with its params filled in, or `undefined` when it is not a contract route.
 * A param is URL-encoded, so it can never add a segment; a param that is exactly `.` or `..`
 * is refused, and so is any filled path that URL parsing would change, so the path sent is
 * always the contract route the request named.
 */
export function contractPath(req: ApiRequest): string | undefined {
  if (typeof req.path !== "string" || !req.path.startsWith("/")) return undefined;
  const segments = req.path.split("/").slice(1);
  const route = CALLABLE.find((r) => r.method === req.method && r.segments.length === segments.length && r.segments.every((s, i) => s === segments[i]));
  if (route === undefined) return undefined;
  const filled: string[] = [];
  for (const segment of route.segments) {
    if (!segment.startsWith(":")) {
      filled.push(segment);
      continue;
    }
    const value = req.params?.[segment.slice(1)];
    if (value === undefined) return undefined;
    const text = String(value);
    if (text === "" || DOT_SEGMENTS.has(text)) return undefined;
    filled.push(encodeURIComponent(text));
  }
  const path = `/${filled.join("/")}`;
  return resolvesUnchanged(path) ? path : undefined;
}

/** Start a connection over `deps`. Holds no state between calls: every call re-reads api.json and the token. */
export function createKernelConnection(deps: KernelConnectionDeps): KernelConnection {
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const doFetch = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const log = deps.log ?? (() => undefined);
  const openSocket =
    deps.openSocket ?? ((url: string, headers: Readonly<Record<string, string>>): FeedSocket => new WebSocket(url, { headers: { ...headers } }) as unknown as FeedSocket);

  const unreachable = (reason: KernelUnreachableReason): Unreachable => {
    log(`kernel unreachable: ${reason}`);
    return { state: "unreachable", reason };
  };

  /** api.json, the pid check, then the token: the port and the token, or why not. */
  const locate = async (): Promise<{ readonly port: number; readonly token: string } | Unreachable> => {
    const path = join(deps.dataDir, API_INFO_FILENAME);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as { code?: unknown }).code === "ENOENT") return { state: "not_installed", dataDir: deps.dataDir };
      return unreachable("api_info_unreadable");
    }
    let info: unknown;
    try {
      info = JSON.parse(raw);
    } catch {
      return unreachable("api_info_unreadable");
    }
    const { port, pid } = (typeof info === "object" && info !== null ? info : {}) as { port?: unknown; pid?: unknown };
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535 || typeof pid !== "number" || !Number.isInteger(pid) || pid < 1) {
      return unreachable("api_info_unreadable");
    }
    // Before the token is read or sent: a stale api.json (left by a kill -9) names a dead pid.
    if (!isPidAlive(pid)) return unreachable("daemon_not_running");
    let token: string | undefined;
    try {
      token = await deps.readToken();
    } catch {
      return unreachable("token_unavailable");
    }
    if (token === undefined || !TOKEN_SHAPE.test(token)) return unreachable("token_unavailable");
    return { port, token };
  };

  const send = async (
    where: { readonly port: number; readonly token: string },
    method: string,
    path: string,
    query: Readonly<Record<string, string>> | undefined,
    body: unknown,
  ): Promise<ApiResult<unknown>> => {
    const url = new URL(`http://${API_HOST}:${where.port}${path}`);
    // The last check before the token goes out: the URL's path is the path built, never one URL parsing normalised.
    if (url.pathname !== path) return { ok: false, status: 400, body: { error: "not_in_contract" } };
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = { Authorization: `Bearer ${where.token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (err) {
      // The error is dropped: only its kind crosses.
      const name = typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
      return { ok: false, status: 0, connection: unreachable(name === "TimeoutError" ? "timeout" : "connection_failed") };
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      // The kernel always answers JSON: anything else is never `ok`, whatever its status.
      return { ok: false, status: response.status, body: { error: "invalid_response" } };
    }
    if (response.ok) return { ok: true, status: response.status, body: parsed };
    const error = typeof parsed === "object" && parsed !== null && typeof (parsed as { error?: unknown }).error === "string" ? (parsed as { error: string; [k: string]: unknown }) : { error: "invalid_response" };
    return { ok: false, status: response.status, body: error };
  };

  return {
    async connection() {
      const where = await locate();
      if ("state" in where) return where;
      const result = await send(where, "GET", "/status", undefined, undefined);
      if (result.ok) return { state: "connected", port: where.port };
      if ("connection" in result) return result.connection;
      return unreachable(result.status === 401 ? "token_rejected" : "connection_failed");
    },

    async request(req) {
      const path = contractPath(req);
      if (path === undefined) return { ok: false, status: 400, body: { error: "not_in_contract" } };
      const where = await locate();
      if ("state" in where) return { ok: false, status: 0, connection: where };
      return send(where, req.method, path, req.query, req.body);
    },

    async openFeed(after, onFrame) {
      const where = await locate();
      if ("state" in where) return { state: where };
      const socket = openSocket(`ws://${API_HOST}:${where.port}/events/stream`, { Authorization: `Bearer ${where.token}` });
      socket.on("open", () => socket.send(JSON.stringify({ type: "subscribe", after })));
      socket.on("message", (data) => {
        let frame: unknown;
        try {
          frame = JSON.parse(String(data));
        } catch {
          log("feed: a frame that is not JSON was dropped");
          return;
        }
        const type = typeof frame === "object" && frame !== null ? (frame as { type?: unknown }).type : undefined;
        if (type === "event" || type === "heartbeat") onFrame(frame as FeedServerFrame);
      });
      socket.on("close", (code, reason) => onFrame({ type: "closed", code, reason: String(reason ?? "").slice(0, 200) }));
      // An error is followed by a close; its detail is dropped.
      socket.on("error", () => log("feed: socket error"));
      return { state: { state: "connected", port: where.port }, handle: { close: () => socket.close() } };
    },
  };
}
