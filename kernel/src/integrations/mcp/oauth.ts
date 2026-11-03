// The MCP connector's OAuth 2.1 connect (phase 8 item 06, D38): authorization
// metadata discovery, dynamic client registration, PKCE `S256`, the `state`,
// the loopback redirect listener, the code exchange and the token refresh.
// The vendor's consent for the vendor's server, in the system browser; never a
// claude.ai sign-in (invariant 6).
//
// The redirect is this file's own listener, not a kernel API route (RFC 8252
// loopback): `open` binds `127.0.0.1:0` (and nothing else) for the one window
// and the redirect URI is `http://127.0.0.1:<port>/callback`, so the kernel
// gains no unauthenticated route. The window copies D36's pattern
// (`github/app-setup.ts`): it lives in memory only, at most one is open at a
// time (a second `open` is refused), it lives `MCP_WINDOW_MS`, and a restart
// loses it. The listener closes when the window settles, expires or is
// cancelled. The `state` is 256 random bits, compared in constant time and
// spent before anything is awaited, so a replay finds none; a wrong one is
// refused and leaves the window as it was, so a local process cannot end a
// connect by guessing. A request whose `Host` is not the listener's own
// address is refused (DNS rebinding).
//
// What reaches the owner's browser is one fixed page per outcome: no page, no
// answer and no refusal echoes the query string, the code, a `state`, a
// verifier or a token. The code exchange is the token endpoint's POST, through
// the guarded `fetch` (`client.ts`); what to do with the tokens is the caller's
// (`onReturn`: `connector.ts` lists the tools and writes the Keychain), so
// this file never touches the Keychain, the store or an event.
//
// The authorization request is built here, not by the SDK's helper, so the
// `S256` challenge and `state` are this file's and pinned by its tests; the
// SDK's helpers do discovery, registration and the token calls.
//
// The `studio` CLI loads it through the integrations feature, so it imports
// the MCP SDK's client and its siblings: never the Agent SDK, the session
// manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { guardedFetch, mcpUrlAllowed } from "./client.js";
import type { McpHttpOptions } from "./client.js";
import type { McpCredential } from "./credential.js";
import type { McpKind } from "./rows.js";

/** How long one connect window lives: 10 minutes from the clock at the moment it opens. */
export const MCP_WINDOW_MS = 10 * 60 * 1000;

/** The loopback listener's one path. */
export const MCP_CALLBACK_PATH = "/callback";

/**
 * Every way a connect refuses or fails, closed in code. The first group is
 * the connect call's own answer; the rest are what a window settles with.
 */
export const MCP_CONNECT_REFUSALS = Object.freeze([
  "server_not_configured",
  "connect_in_progress",
  "server_url_refused",
  "listener_failed",
  "discovery_failed",
  "registration_unsupported",
  "registration_failed",
  "cancelled",
  "window_expired",
  "authorization_denied",
  "token_exchange_failed",
  "tools_list_failed",
  "credential_failed",
  "connect_failed",
] as const);

/** One of `MCP_CONNECT_REFUSALS`. */
export type McpConnectRefusal = (typeof MCP_CONNECT_REFUSALS)[number];

/** The fixed page of each settled outcome that ends in the browser: a heading and one sentence. */
const PAGES: Readonly<Partial<Record<McpConnectRefusal | "done" | "state_mismatch" | "gone", { readonly heading: string; readonly text: string }>>> = Object.freeze({
  done: { heading: "Done — return to Studio", text: "The connection is made. You can close this tab." },
  state_mismatch: { heading: "This link is not valid", text: "Studio did not recognise this link, or it was already used. Return to Studio and connect again." },
  gone: { heading: "No connection is waiting", text: "Studio is not waiting for a sign-in here. Return to Studio and connect again." },
  window_expired: { heading: "Connect timed out", text: "The window closed before the sign-in came back. Return to Studio and connect again." },
  authorization_denied: { heading: "Sign-in was not completed", text: "The service did not grant access. Return to Studio and connect again." },
  token_exchange_failed: { heading: "Sign-in did not finish", text: "Studio could not complete the sign-in with the service. Return to Studio and connect again." },
  tools_list_failed: { heading: "Connection did not finish", text: "Studio signed in but could not read the service's tools. Return to Studio and connect again." },
  credential_failed: { heading: "Connection did not finish", text: "Studio could not store the sign-in safely. Return to Studio and connect again." },
  connect_failed: { heading: "Connection did not finish", text: "Studio could not finish the connection. Return to Studio and connect again." },
});

/** Everything `onReturn` is given once the browser came back and the code was exchanged. Secrets: hold them only as long as the call. */
export interface McpGrant {
  readonly kind: McpKind;
  readonly serverUrl: string;
  readonly authorizationServerUrl: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** ISO time the access token stops working, when the server said (`expires_in`). */
  readonly expiresAt?: string;
}

/** How a window ended: what `onReturn` made of the grant, or why there was none. */
export type McpWindowOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: McpConnectRefusal };

/** What `open` is told. */
export interface McpOpenParams<T> {
  readonly kind: McpKind;
  readonly serverUrl: string;
  /** Asked for in the registration and the authorization request, when the connector's definition names one. */
  readonly scope?: string;
  /** The clock, read at each check. */
  readonly now: () => Date;
  /** Runs once, after the code was exchanged. Its failure reason is shown to the owner as one fixed page. */
  onReturn(grant: McpGrant): Promise<McpWindowOutcome<T>>;
}

/** An `open` that opened the window: where the owner goes, when it closes, and a promise of how it ends (it never rejects). */
export interface McpOpened<T> {
  readonly ok: true;
  readonly authorize_url: string;
  readonly expires_at: string;
  readonly done: Promise<McpWindowOutcome<T>>;
}

/** An `open` that did not. */
export interface McpOpenRefused {
  readonly ok: false;
  readonly error: McpConnectRefusal;
}

/** The connect window's operations. */
export interface McpOAuth {
  /** Open the one window, or say why not. Never throws. */
  open<T>(params: McpOpenParams<T>): Promise<McpOpened<T> | McpOpenRefused>;
  /** Close the window if it is for `kind`; whether one was open. */
  cancel(kind: McpKind): boolean;
  /** Whether a window is open now (its listener is bound). */
  isOpen(): boolean;
  /** The open window's listener address, for a test to check it is bound to 127.0.0.1 only. */
  listenerAddress(): AddressInfo | undefined;
}

/** What `createMcpOAuth` takes. */
export interface McpOAuthDeps extends McpHttpOptions {
  /** Default `MCP_WINDOW_MS`. */
  readonly windowMs?: number;
}

/** One open window. */
interface Window {
  readonly kind: McpKind;
  readonly expiresAtMs: number;
  /** Null once spent (and before it is minted). */
  state: string | null;
  server: Server | undefined;
  timer: NodeJS.Timeout | undefined;
  settled: boolean;
  /** Set once `onReturn` is running: the sign-in is being stored, so a cancel or the window's timer no longer ends it. */
  committed: boolean;
  /** Why it ended, once it has, when that was a refusal. */
  ended: McpConnectRefusal | undefined;
  /** Called once when the window settles, so an `open` still awaiting the network stops waiting. */
  onSettle: (() => void) | undefined;
  resolve(outcome: McpWindowOutcome<never>): void;
}

/** What discovery and registration fixed for one window. */
interface Prepared {
  readonly authorizationServerUrl: string;
  readonly metadata: Awaited<ReturnType<typeof discoverOAuthServerInfo>>["authorizationServerMetadata"];
  readonly client: OAuthClientInformationMixed;
  readonly verifier: string;
  readonly resource: string;
  readonly redirectUri: string;
}

/** What an awaited step yields when the window settled first. */
const GONE: unique symbol = Symbol("window settled");

/** A fresh single-use `state`: 256 random bits. */
function mintState(): string {
  return randomBytes(32).toString("base64url");
}

/** Whether `presented` is `expected`, in constant time (both hashed first, so the length is not leaked). */
function sameState(presented: string | null, expected: string | null): boolean {
  if (presented === null || expected === null) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A fixed page around a heading and a sentence (both trusted text). */
function pageHtml(heading: string, text: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(heading)}</title><body style="font-family:system-ui;margin:3rem"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(text)}</p></body>`;
}

/** Answer `res` with a fixed page: never cached, never leaking a referrer, and the connection closed after it. */
function respond(res: ServerResponse, status: number, key: keyof typeof PAGES): void {
  const page = PAGES[key] ?? PAGES.connect_failed;
  const html = pageHtml(page?.heading ?? "", page?.text ?? "");
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    connection: "close",
  });
  res.end(html);
}

/** The base64url S256 challenge of a verifier (RFC 7636). */
function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The authorization-server grant types and client auth a client registers for: `none` when the server allows a public client, else the first confidential method it lists. */
function authMethodFor(supported: readonly string[] | undefined): string {
  if (supported === undefined || supported.length === 0 || supported.includes("none")) return "none";
  return supported.find((m) => m === "client_secret_post" || m === "client_secret_basic") ?? "none";
}

/** The resource indicator (RFC 8707) for `serverUrl`: its canonical address without a fragment. */
function resourceOf(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.hash = "";
  return url.toString();
}

/** Build the connect window's operations. */
export function createMcpOAuth(deps: McpOAuthDeps = {}): McpOAuth {
  const windowMs = deps.windowMs ?? MCP_WINDOW_MS;
  const allow = deps.allowLoopbackHttp === true;
  const http: McpHttpOptions = { allowLoopbackHttp: allow, ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }), ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }) };
  // The only state this file keeps: the one window (open, or expired and not yet replaced). Memory only.
  let current: Window | undefined;

  /** Stop listening: no new connection, and every open one ends (after `flush`'s response, when given). */
  const closeListener = (win: Window, flush?: ServerResponse): void => {
    const server = win.server;
    win.server = undefined;
    if (server === undefined) return;
    server.close();
    if (flush === undefined) server.closeAllConnections();
    else flush.once("close", () => server.closeAllConnections());
  };

  /** End the window with `outcome`: bookkeeping only (the caller closes the listener). Once. */
  const settle = (win: Window, outcome: McpWindowOutcome<never>): void => {
    if (win.settled) return;
    win.settled = true;
    if (!outcome.ok) win.ended = outcome.reason;
    if (win.timer !== undefined) clearTimeout(win.timer);
    if (current === win) current = undefined;
    win.resolve(outcome);
    win.onSettle?.();
  };

  async function open<T>(params: McpOpenParams<T>): Promise<McpOpened<T> | McpOpenRefused> {
    const startMs = params.now().getTime();
    const existing = current;
    if (existing !== undefined) {
      if (startMs < existing.expiresAtMs) return { ok: false, error: "connect_in_progress" };
      // Past its life but still held (the timer has not fired): it is replaced.
      closeListener(existing);
      settle(existing, { ok: false, reason: "window_expired" });
    }
    if (!mcpUrlAllowed(params.serverUrl, allow)) return { ok: false, error: "server_url_refused" };

    let resolveDone: (outcome: McpWindowOutcome<T>) => void = () => undefined;
    const done = new Promise<McpWindowOutcome<T>>((resolve) => {
      resolveDone = resolve;
    });
    const win: Window = {
      kind: params.kind,
      expiresAtMs: startMs + windowMs,
      state: null,
      server: undefined,
      timer: undefined,
      settled: false,
      committed: false,
      ended: undefined,
      onSettle: undefined,
      resolve: (outcome) => resolveDone(outcome as McpWindowOutcome<T>),
    };
    // Settles when the window does: a cancel or expiry while a network step is in flight ends the open at once.
    const gone = new Promise<typeof GONE>((resolve) => {
      win.onSettle = () => resolve(GONE);
    });
    /** `p`, or `GONE` if the window settles first. */
    const unlessGone = <V>(p: Promise<V>): Promise<V | typeof GONE> => Promise.race([p, gone]);
    // Taken before anything is awaited: a second connect, even one racing this, finds the window.
    current = win;
    win.timer = setTimeout(() => {
      // A sign-in being stored is finished, not abandoned: it settles the window itself.
      if (win.committed) return;
      closeListener(win);
      settle(win, { ok: false, reason: "window_expired" });
    }, windowMs);
    win.timer.unref();

    /** Abandon the window while it is being opened. */
    const abort = (error: McpConnectRefusal): McpOpenRefused => {
      closeListener(win);
      settle(win, { ok: false, reason: error });
      return { ok: false, error };
    };

    let prepared: Prepared | undefined;
    try {
      const server = createServer((req, res) => {
        const state = prepared;
        if (state === undefined) {
          // The window is still being prepared: nothing can have been sent a link yet.
          respond(res, 404, "gone");
          return;
        }
        void handle(win, state, params, req, res);
      });
      win.server = server;
      // 127.0.0.1 only, never 0.0.0.0, `localhost` or `::`: the redirect is for this machine's browser alone.
      const listening = await unlessGone(
        new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen({ port: 0, host: "127.0.0.1" }, () => resolve());
        }),
      );
      if (listening === GONE) return { ok: false, error: win.ended ?? "cancelled" };
    } catch {
      return abort("listener_failed");
    }
    const redirectUri = `http://127.0.0.1:${(win.server?.address() as AddressInfo).port}${MCP_CALLBACK_PATH}`;
    const fetchFn = guardedFetch(http);

    // 1. Protected-resource metadata, then authorization-server metadata.
    let info: Awaited<ReturnType<typeof discoverOAuthServerInfo>>;
    try {
      const found = await unlessGone(discoverOAuthServerInfo(params.serverUrl, { fetchFn }));
      if (found === GONE) return { ok: false, error: win.ended ?? "cancelled" };
      info = found;
    } catch {
      return abort("discovery_failed");
    }
    const meta = info.authorizationServerMetadata;
    if (meta === undefined || !mcpUrlAllowed(meta.authorization_endpoint, allow) || !mcpUrlAllowed(meta.token_endpoint, allow)) return abort("discovery_failed");
    // PKCE S256 is required: a server that lists methods without it is refused.
    if (meta.code_challenge_methods_supported !== undefined && !meta.code_challenge_methods_supported.includes("S256")) return abort("discovery_failed");
    if (!meta.response_types_supported.includes("code")) return abort("discovery_failed");

    // 2. Dynamic client registration, when the server offers it.
    if (meta.registration_endpoint === undefined) return abort("registration_unsupported");
    if (!mcpUrlAllowed(meta.registration_endpoint, allow)) return abort("discovery_failed");
    let client: OAuthClientInformationMixed;
    try {
      const registration = registerClient(info.authorizationServerUrl, {
        metadata: meta,
        clientMetadata: {
          client_name: "Loomwright Studio",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: authMethodFor(meta.token_endpoint_auth_methods_supported),
          ...(params.scope === undefined ? {} : { scope: params.scope }),
        },
        fetchFn,
      });
      const registered = await unlessGone(registration);
      if (registered === GONE) return { ok: false, error: win.ended ?? "cancelled" };
      client = registered;
    } catch {
      return abort("registration_failed");
    }

    // 3. The authorization request: PKCE S256, a fresh single-use state, the resource indicator.
    const verifier = randomBytes(48).toString("base64url");
    const resource = resourceOf(params.serverUrl);
    const state = mintState();
    prepared = { authorizationServerUrl: info.authorizationServerUrl, metadata: meta, client, verifier, resource, redirectUri };
    win.state = state;
    const authorize = new URL(meta.authorization_endpoint);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", client.client_id);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", s256(verifier));
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("resource", resource);
    if (params.scope !== undefined) authorize.searchParams.set("scope", params.scope);
    return { ok: true, authorize_url: authorize.toString(), expires_at: new Date(win.expiresAtMs).toISOString(), done };
  }

  /** The browser came back (or something local knocked): answer one page, and move the window on only for the right `state`. */
  async function handle<T>(win: Window, prepared: Prepared, params: McpOpenParams<T>, req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const port = (win.server?.address() as AddressInfo | undefined)?.port;
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== MCP_CALLBACK_PATH || port === undefined) return respond(res, 404, "gone");
      // The Host header is the one this listener answers to; a rebinding page cannot send it.
      if (req.headers.host !== `127.0.0.1:${port}`) return respond(res, 400, "state_mismatch");
      if (win.settled) return respond(res, 410, "gone");
      if (params.now().getTime() >= win.expiresAtMs) {
        respond(res, 400, "window_expired");
        closeListener(win, res);
        settle(win, { ok: false, reason: "window_expired" });
        return;
      }
      // A wrong, missing or already-spent state is refused and the window stays as it was.
      if (!sameState(url.searchParams.get("state"), win.state)) return respond(res, 400, "state_mismatch");
      // Spent on first use, before anything is awaited: a replay finds none.
      win.state = null;
      const finish = (status: number, key: keyof typeof PAGES, outcome: McpWindowOutcome<never>): void => {
        respond(res, status, key);
        closeListener(win, res);
        settle(win, outcome);
      };
      if (url.searchParams.has("error")) return finish(400, "authorization_denied", { ok: false, reason: "authorization_denied" });
      const code = url.searchParams.get("code");
      if (code === null || !/^[\x21-\x7e]{1,2048}$/.test(code)) return finish(400, "token_exchange_failed", { ok: false, reason: "token_exchange_failed" });

      let grant: McpGrant;
      try {
        const tokens = await exchangeAuthorization(prepared.authorizationServerUrl, {
          metadata: prepared.metadata,
          clientInformation: prepared.client,
          authorizationCode: code,
          codeVerifier: prepared.verifier,
          redirectUri: prepared.redirectUri,
          resource: new URL(prepared.resource),
          fetchFn: guardedFetch(http),
        });
        if (typeof tokens.access_token !== "string" || tokens.access_token === "" || tokens.token_type.toLowerCase() !== "bearer") {
          return finish(502, "token_exchange_failed", { ok: false, reason: "token_exchange_failed" });
        }
        const lifetime = typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 ? tokens.expires_in : undefined;
        grant = {
          kind: params.kind,
          serverUrl: params.serverUrl,
          authorizationServerUrl: prepared.authorizationServerUrl,
          clientId: prepared.client.client_id,
          ...("client_secret" in prepared.client && typeof prepared.client.client_secret === "string" && prepared.client.client_secret !== "" ? { clientSecret: prepared.client.client_secret } : {}),
          accessToken: tokens.access_token,
          ...(typeof tokens.refresh_token === "string" && tokens.refresh_token !== "" ? { refreshToken: tokens.refresh_token } : {}),
          ...(lifetime === undefined ? {} : { expiresAt: new Date(params.now().getTime() + lifetime * 1000).toISOString() }),
        };
      } catch {
        return finish(502, "token_exchange_failed", { ok: false, reason: "token_exchange_failed" });
      }
      // The window may have been cancelled or have expired during the exchange: store nothing then.
      if (win.settled) return respond(res, 410, "gone");

      let outcome: McpWindowOutcome<T>;
      win.committed = true;
      try {
        outcome = await params.onReturn(grant);
      } catch {
        outcome = { ok: false, reason: "connect_failed" };
      }
      if (outcome.ok) finish(200, "done", outcome as McpWindowOutcome<never>);
      else finish(502, outcome.reason, outcome);
    } catch {
      // Never a throw out of a request handler: one fixed page, and the window ends.
      if (!res.headersSent) respond(res, 500, "connect_failed");
      closeListener(win, res);
      settle(win, { ok: false, reason: "connect_failed" });
    }
  }

  function cancel(kind: McpKind): boolean {
    const win = current;
    if (win === undefined || win.kind !== kind || win.committed) return false;
    closeListener(win);
    settle(win, { ok: false, reason: "cancelled" });
    return true;
  }

  return {
    open,
    cancel,
    isOpen: () => current !== undefined && current.server !== undefined,
    listenerAddress: () => (current?.server?.address() as AddressInfo | null | undefined) ?? undefined,
  };
}

// ---- Refresh -----------------------------------------------------------------

/**
 * Why a refresh failed. `definitive`: the server answered that the grant or
 * the client is no good (`invalid_grant`, `invalid_client`, `unauthorized_client`),
 * or there is nothing to refresh with: only a new sign-in helps. `transient`:
 * anything else (no answer, a deadline, a server error, an unreadable answer):
 * worth trying again. The server's own words are never kept.
 */
export class McpRefreshError extends Error {
  readonly kind: "definitive" | "transient";
  constructor(kind: "definitive" | "transient") {
    super(`the MCP token refresh failed (${kind})`);
    this.name = "McpRefreshError";
    this.kind = kind;
  }
}

/** The OAuth error codes after which a refresh can never work again. */
const DEFINITIVE_CODES: readonly string[] = ["invalid_grant", "invalid_client", "unauthorized_client"];

/** The tokens a refresh gave: the refresh token is the old one when the server issued no new one. */
export interface McpRefreshed {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_at?: string;
}

/**
 * Exchange `credential`'s refresh token for new tokens at its authorization
 * server (found again from the stored address). Throws `McpRefreshError`,
 * nothing else; no message of any underlying error is kept.
 */
export async function refreshMcpTokens(serverUrl: string, credential: McpCredential, now: Date, options: McpHttpOptions = {}): Promise<McpRefreshed> {
  if (credential.refresh_token === undefined) throw new McpRefreshError("definitive");
  const fetchFn = guardedFetch(options);
  try {
    const metadata = await discoverAuthorizationServerMetadata(credential.authorization_server_url, { fetchFn });
    if (metadata === undefined) throw new McpRefreshError("transient");
    const tokens = await refreshAuthorization(credential.authorization_server_url, {
      metadata,
      clientInformation: { client_id: credential.client_id, ...(credential.client_secret === undefined ? {} : { client_secret: credential.client_secret }) },
      refreshToken: credential.refresh_token,
      resource: new URL(resourceOf(serverUrl)),
      fetchFn,
    });
    if (typeof tokens.access_token !== "string" || tokens.access_token === "") throw new McpRefreshError("transient");
    const lifetime = typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 ? tokens.expires_in : undefined;
    return {
      access_token: tokens.access_token,
      ...(typeof tokens.refresh_token === "string" && tokens.refresh_token !== "" ? { refresh_token: tokens.refresh_token } : {}),
      ...(lifetime === undefined ? {} : { expires_at: new Date(now.getTime() + lifetime * 1000).toISOString() }),
    };
  } catch (err) {
    if (err instanceof McpRefreshError) throw err;
    throw new McpRefreshError(err instanceof OAuthError && DEFINITIVE_CODES.includes(err.errorCode) ? "definitive" : "transient");
  }
}
