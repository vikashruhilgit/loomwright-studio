// The `integrations` feature's `mcp` part (phase 8 item 06, D38): the generic
// MCP connector. It connects a hosted MCP server the way Claude desktop does
// (OAuth 2.1 with PKCE in the system browser, `oauth.ts`), keeps the tokens
// only in the Keychain item `loomwright-studio-mcp-<kind>` (`credential.ts`),
// records the server's tool list on the `mcp_connections` row, renews the
// access token before it lapses, and answers whether a poll that needs the
// connector may run (`mcpConnectorGate`). The three owner routes are
// `routes.ts`; the session's proxy tools are `tools.ts`. Specified in
// `docs/architecture/mcp-connectors.md`.
//
// Mechanism only (invariant 1): the kernel connects, stores, refreshes and
// warns. Which agent may call which tool and what a poll reads are the
// owner's, never built in. The two vendor addresses are data in `trackers.ts`
// (`MCP_TRACKERS`), which `MCP_SERVERS` is filled from, and the grant is read
// elsewhere.
//
// The row never holds a secret: only `token_expiry` (a time), the server's
// address, the status and the kept tool list reach it. No token, code,
// verifier or client secret reaches a row, an event, a notification, an answer
// or a log: nothing here logs, every failure is a fixed code and sentence, and
// a caught error's message is never kept.
//
//   connect       open the one window (`oauth.ts`); when the browser comes back
//                 the code is exchanged, the server's tools are listed and
//                 planned (`tools.ts`), the tokens are written to the Keychain
//                 (delete, add, read back: only a matching read-back counts)
//                 and the row reads `connected`.
//   refresh       due work on every loop tick: a `connected` row whose token
//                 expires within `MCP_REFRESH_AHEAD_MS` is renewed and the new
//                 tokens replace the Keychain item. A renewal the server
//                 refuses for good (or a sign-in that is missing, or a token
//                 already past its expiry that could not be renewed) makes the
//                 row `expired`, with one event and one notification, on that
//                 transition only. A transient failure (no answer, a server
//                 error) is retried after `MCP_TRANSIENT_RETRY_MS`.
//   disconnect    delete the Keychain item; the row reads `disconnected`.
//
// Credential changes (a connect's write, a refresh, a disconnect) run one at a
// time on this connector's queue, so two never interleave their Keychain steps.
//
// The `studio` CLI loads it, so it imports only types, the feature seam, the
// Keychain module, the store helpers and its siblings: never the Agent SDK, the
// session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph).
import { securityCliKeychain, securityCliKeychainDeleter, securityCliKeychainWriter } from "../../auth/keychain.js";
import type { KeychainDeleter, KeychainReader, KeychainWriter } from "../../auth/keychain.js";
import type { DueWorkFn } from "../../features/contribution.js";
import { NO_REF, appendEvent } from "../../loop/internal.js";
import { recordNotification } from "../../notifications/record.js";
import type { Store } from "../../store/store.js";
import type { ConnectorStatus, IntegrationsPart } from "../types.js";
import type { McpHttpOptions } from "./client.js";
import { listMcpTools } from "./client.js";
import { MCP_KEYCHAIN_ACCOUNT, encodeCredential, mcpKeychainService, readMcpCredential } from "./credential.js";
import type { McpCredential } from "./credential.js";
import { createMcpOAuth, refreshMcpTokens, McpRefreshError } from "./oauth.js";
import type { McpConnectRefusal, McpGrant, McpOAuth, McpWindowOutcome } from "./oauth.js";
import { mcpRoutes } from "./routes.js";
import { isUsableMcpStatus, mcpRow, mcpRows, storedToolsOf } from "./rows.js";
import type { McpKind, McpRow } from "./rows.js";
import { planProxyTools } from "./tools.js";
import type { McpDropCounts } from "./tools.js";
import { MCP_TRACKERS } from "./trackers.js";

/** How long before the access token expires the connector renews it: the safety kernel's, fixed. */
export const MCP_REFRESH_AHEAD_MS = 5 * 60 * 1000;

/** How long a renewal that failed for a transient reason waits before the next try. */
export const MCP_TRANSIENT_RETRY_MS = 60 * 1000;

/** A notification's source when a connector's sign-in can no longer be renewed: `kernel:<reason>`, once, on the transition into `expired`. */
export function mcpExpiredSource(kind: McpKind): string {
  return `kernel:mcp_connector_expired_${kind}`;
}

/** What the kernel needs to know about one server: its MCP address, and (optionally) the scope to ask for. */
export interface McpServerDefinition {
  readonly url: string;
  readonly scope?: string;
}

/**
 * The servers built in, by kind: the Jira (Atlassian Rovo) and ClickUp
 * addresses, filled from `trackers.ts`'s `MCP_TRACKERS` (phase 8 item 07),
 * which is also where each kind's ticket tool is named. A kind with no entry
 * (none today) connects to the row's own `server_url`, else is refused
 * `server_not_configured`.
 */
export const MCP_SERVERS: Readonly<Partial<Record<McpKind, McpServerDefinition>>> = Object.freeze({
  jira: Object.freeze({ url: MCP_TRACKERS.jira.url }),
  clickup: Object.freeze({ url: MCP_TRACKERS.clickup.url }),
});

/** Every code a connector call answers with when it does not succeed. */
export type McpErrorCode = McpConnectRefusal | "no_connector" | "keychain_failed" | "connector_failed";

/** A call that did not succeed: a closed code and one fixed sentence. */
export interface McpFailure {
  readonly ok: false;
  readonly error: McpErrorCode;
  readonly message: string;
}

/** What a finished connect made: how many server tools were kept and how many were dropped, by reason. */
export interface McpConnectSummary {
  readonly tools_kept: number;
  readonly tools_dropped: McpDropCounts;
  /** The server's own names of the dropped tools, clipped (untrusted text). */
  readonly dropped_names: readonly string[];
}

/** A connect that opened its window. `done` settles when the window does and never rejects. */
export interface McpConnectOpened {
  readonly ok: true;
  readonly authorize_url: string;
  readonly expires_at: string;
  readonly done: Promise<McpWindowOutcome<McpConnectSummary>>;
}

/** The connector's calls. Every one resolves; none throws. */
export interface McpConnector {
  /** Open the connect window for `kind`: where the owner goes, and when it closes. */
  connect(store: Store, kind: McpKind, now: () => Date): Promise<McpConnectOpened | McpFailure>;
  /** Close the open window if it is for `kind`. */
  cancel(kind: McpKind): { readonly cancelled: boolean };
  /** Delete the Keychain item and mark the row `disconnected`. */
  disconnect(store: Store, kind: McpKind, now: () => Date): Promise<{ readonly ok: true; readonly row: McpRow } | McpFailure>;
  /** Renew every `connected` row's access token that is near expiry. */
  refreshDue(store: Store, now: Date): Promise<void>;
  /** The window, for a test to read its listener. */
  readonly oauth: McpOAuth;
}

/** What the connector reads, writes and calls. Every default resolves only when a call needs it, so building the shipped part touches nothing. */
export interface McpConnectorDeps extends McpHttpOptions {
  /** Default: `securityCliKeychain()`. */
  readonly keychain?: KeychainReader;
  /** Default: `securityCliKeychainWriter()`. */
  readonly writer?: KeychainWriter;
  /** Default: `securityCliKeychainDeleter()`. */
  readonly deleter?: KeychainDeleter;
  /** Which server a kind means. Default: `MCP_SERVERS`, else the row's own `server_url`. */
  readonly serverFor?: (kind: McpKind, store: Store) => McpServerDefinition | undefined;
  /** The connect window's length. Default `MCP_WINDOW_MS`. */
  readonly windowMs?: number;
  /** Default `MCP_REFRESH_AHEAD_MS`. */
  readonly refreshAheadMs?: number;
  /** Default `MCP_TRANSIENT_RETRY_MS`. */
  readonly retryMs?: number;
}

// ---- Views -------------------------------------------------------------------

/** An `mcp_connections` row as `GET /connectors` shows it: `McpConnection` in `app/src/api/contract.ts`. Never a token, and `granted_tools` are the server's tool names only (the proxy names and read-only flags stay kernel-side). */
export interface McpConnectionView {
  readonly kind: McpKind;
  readonly server_url: string | null;
  readonly status: ConnectorStatus;
  readonly granted_tools: readonly string[];
  readonly token_expiry: string | null;
}

/** `row` as the contract's `McpConnection`. */
export function mcpConnectionView(row: McpRow): McpConnectionView {
  return {
    kind: row.kind,
    server_url: row.server_url,
    status: row.status,
    granted_tools: storedToolsOf(row.granted_tools).map((t) => t.name),
    token_expiry: row.token_expiry,
  };
}

/** Every MCP connection, in the contract's shape (`GET /connectors`' `mcp_connections`). */
export function listMcpConnections(store: Store): McpConnectionView[] {
  return mcpRows(store).map(mcpConnectionView);
}

/** Whether a poll or a call that needs the `kind` connector may go ahead: `open`, or `connector_missing` with the row's status (`null` when there is no row). */
export type McpGate = { readonly kind: "open"; readonly status: string } | { readonly kind: "connector_missing"; readonly status: string | null };

/**
 * The gate item 07's `jira.issues` / `clickup.tasks` poll sources call, in the
 * same shape `triggers/poll.ts` uses for GitHub's: a `connected` (or
 * `expiring`) row is `open`; an `expired`, `disconnected` or `rejected` row, or
 * none at all, is `connector_missing` with its status. Reads the store only.
 */
export function mcpConnectorGate(store: Store, kind: McpKind): McpGate {
  const row = mcpRow(store, kind);
  if (row !== undefined && isUsableMcpStatus(row.status)) return { kind: "open", status: row.status };
  return { kind: "connector_missing", status: row?.status ?? null };
}

// ---- Fixed sentences -----------------------------------------------------------

const MESSAGES: Readonly<Record<McpErrorCode, string>> = Object.freeze({
  server_not_configured: "no server address is set for this connector, so it cannot be connected yet",
  connect_in_progress: "a connect window is already open; finish it or cancel it first",
  server_url_refused: "the server address is not one Studio will call (it must be https)",
  listener_failed: "Studio could not open its local sign-in listener",
  discovery_failed: "the server's sign-in details could not be read, or they are not ones Studio supports",
  registration_unsupported: "the server does not offer dynamic client registration, and Studio has no client for it",
  registration_failed: "the server did not accept Studio's registration",
  cancelled: "the connect was cancelled",
  window_expired: "the connect window closed before the sign-in came back",
  authorization_denied: "the service did not grant access",
  token_exchange_failed: "Studio could not complete the sign-in with the service",
  tools_list_failed: "Studio signed in but could not read the service's tool list",
  credential_failed: "the sign-in could not be stored in the Keychain",
  connect_failed: "the connect could not finish",
  no_connector: "this connector has no row: it was never connected",
  keychain_failed: "the connector's Keychain item could not be changed; nothing else changed",
  connector_failed: "the connector could not finish; nothing was kept",
});

function failure(error: McpErrorCode): McpFailure {
  return { ok: false, error, message: MESSAGES[error] };
}

// ---- Row writes -----------------------------------------------------------------

/** One `connector_status` event: `{connector_id, kind, status}` plus what the caller adds. Never a secret. */
function statusEvent(store: Store, row: McpRow | undefined, kind: McpKind, at: string, extra: Record<string, unknown> = {}): void {
  appendEvent(store, "connector_status", NO_REF, { connector_id: row?.id ?? null, kind, status: row?.status ?? null, ...extra }, at);
}

/** The most dropped names an event carries, and how long each is: they are the server's text. */
const MAX_EVENT_NAMES = 20;

/** Set the row's status (and, with it, a changed `token_expiry` / tool list), creating the row when there is none. One event for a new row or a changed status. */
function writeRow(store: Store, kind: McpKind, serverUrl: string | null, status: ConnectorStatus, tools: string | null, tokenExpiry: string | null, at: string, extra: Record<string, unknown> = {}): McpRow {
  return store.transaction(() => {
    const before = mcpRow(store, kind);
    store
      .prepare(
        `INSERT INTO mcp_connections (kind, server_url, status, granted_tools, token_expiry) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(kind) DO UPDATE SET server_url = excluded.server_url, status = excluded.status, granted_tools = excluded.granted_tools, token_expiry = excluded.token_expiry`,
      )
      .run(kind, serverUrl, status, tools, tokenExpiry);
    const after = mcpRow(store, kind) as McpRow;
    if (before === undefined || before.status !== status || Object.keys(extra).length > 0) statusEvent(store, after, kind, at, extra);
    return after;
  });
}

// ---- The connector -----------------------------------------------------------------

/** Builds the connector over `deps`. Nothing is read, written or called until a method runs. */
export function createMcpConnector(deps: McpConnectorDeps = {}): McpConnector {
  let reader: KeychainReader | undefined = deps.keychain;
  let writer: KeychainWriter | undefined = deps.writer;
  let deleter: KeychainDeleter | undefined = deps.deleter;
  const keychain = (): KeychainReader => (reader ??= securityCliKeychain());
  const http: McpHttpOptions = {
    ...(deps.allowLoopbackHttp === undefined ? {} : { allowLoopbackHttp: deps.allowLoopbackHttp }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
  };
  const oauth = createMcpOAuth({ ...http, ...(deps.windowMs === undefined ? {} : { windowMs: deps.windowMs }) });
  const aheadMs = deps.refreshAheadMs ?? MCP_REFRESH_AHEAD_MS;
  const retryMs = deps.retryMs ?? MCP_TRANSIENT_RETRY_MS;
  // Per kind: no renewal is tried before this instant (a transient failure's back-off). Memory only.
  const retryAt = new Map<McpKind, number>();

  // One credential change at a time.
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };

  const serverFor = (kind: McpKind, store: Store): McpServerDefinition | undefined => {
    if (deps.serverFor !== undefined) return deps.serverFor(kind, store);
    const builtIn = MCP_SERVERS[kind];
    if (builtIn !== undefined) return builtIn;
    const url = mcpRow(store, kind)?.server_url;
    return url === null || url === undefined ? undefined : { url };
  };

  /**
   * Put `value` in the kind's Keychain item: delete the old (none is fine), add
   * the new (never an overwrite) and trust only the read-back (`security -i`
   * can exit 0 on failure, and cuts a long line short). When the new value does
   * not stick, `previous` (if any) is put back. `"stored"`: the item holds
   * `value`; `"restored"`: it holds `previous`; `"lost"`: it holds neither.
   */
  function swapKeychain(kind: McpKind, value: string, previous?: string): "stored" | "restored" | "lost" {
    const service = mcpKeychainService(kind);
    const holds = (expected: string): boolean => {
      try {
        return keychain().read(service) === expected;
      } catch {
        return false;
      }
    };
    const put = (secret: string): boolean => {
      try {
        (deleter ??= securityCliKeychainDeleter()).delete(service);
      } catch {
        return false;
      }
      try {
        (writer ??= securityCliKeychainWriter()).add(service, MCP_KEYCHAIN_ACCOUNT, secret);
      } catch {
        // The read-back below decides.
      }
      return holds(secret);
    };
    if (put(value)) return "stored";
    if (previous !== undefined && put(previous)) return "restored";
    return "lost";
  }

  /** What a connect does once the browser came back and the code was exchanged. Runs on the credential queue. */
  async function complete(store: Store, kind: McpKind, grant: McpGrant, now: () => Date): Promise<McpWindowOutcome<McpConnectSummary>> {
    // 1. The token must work, and the tool list is read, before anything is written.
    let raw: unknown[];
    try {
      raw = await listMcpTools(grant.serverUrl, grant.accessToken, http);
    } catch {
      return { ok: false, reason: "tools_list_failed" };
    }
    const plan = planProxyTools(kind, raw);
    const credential: McpCredential = {
      access_token: grant.accessToken,
      ...(grant.refreshToken === undefined ? {} : { refresh_token: grant.refreshToken }),
      ...(grant.expiresAt === undefined ? {} : { expires_at: grant.expiresAt }),
      client_id: grant.clientId,
      ...(grant.clientSecret === undefined ? {} : { client_secret: grant.clientSecret }),
      authorization_server_url: grant.authorizationServerUrl,
    };
    let encoded: string;
    try {
      encoded = encodeCredential(credential);
    } catch {
      return { ok: false, reason: "credential_failed" };
    }

    // 2. The Keychain, then the row. A new connect replaces any earlier sign-in.
    const outcome = swapKeychain(kind, encoded);
    const at = now().toISOString();
    if (outcome !== "stored") {
      // The old item is gone and the new one is not in place: never `connected`.
      const existing = mcpRow(store, kind);
      if (existing !== undefined) writeRow(store, kind, existing.server_url, "disconnected", null, null, at);
      return { ok: false, reason: "credential_failed" };
    }
    try {
      retryAt.delete(kind);
      writeRow(store, kind, grant.serverUrl, "connected", JSON.stringify(plan.kept), grant.expiresAt ?? null, at, {
        tools_kept: plan.kept.length,
        tools_dropped: plan.dropped,
        dropped_names: plan.dropped_names.slice(0, MAX_EVENT_NAMES),
      });
    } catch {
      // The row could not be written: no sign-in is left in the Keychain without one.
      try {
        (deleter ??= securityCliKeychainDeleter()).delete(mcpKeychainService(kind));
      } catch {
        // Nothing more to do: the item is replaced by the next connect.
      }
      return { ok: false, reason: "connect_failed" };
    }
    return { ok: true, value: { tools_kept: plan.kept.length, tools_dropped: plan.dropped, dropped_names: plan.dropped_names } };
  }

  async function connect(store: Store, kind: McpKind, now: () => Date): Promise<McpConnectOpened | McpFailure> {
    try {
      const def = serverFor(kind, store);
      if (def === undefined) return failure("server_not_configured");
      const opened = await oauth.open<McpConnectSummary>({
        kind,
        serverUrl: def.url,
        ...(def.scope === undefined ? {} : { scope: def.scope }),
        now,
        onReturn: (grant) => exclusive(() => complete(store, kind, grant, now)),
      });
      if (!opened.ok) return failure(opened.error);
      // A window that ends in a refusal leaves one event (never for a cancel, which the owner asked for).
      const done = opened.done.then((outcome) => {
        if (!outcome.ok && outcome.reason !== "cancelled") {
          try {
            statusEvent(store, mcpRow(store, kind), kind, now().toISOString(), { refused: outcome.reason });
          } catch {
            // A failed event write never changes the outcome.
          }
        }
        return outcome;
      });
      return { ok: true, authorize_url: opened.authorize_url, expires_at: opened.expires_at, done };
    } catch {
      return failure("connector_failed");
    }
  }

  async function disconnect(store: Store, kind: McpKind, now: () => Date): Promise<{ readonly ok: true; readonly row: McpRow } | McpFailure> {
    return exclusive(async () => {
      try {
        // An open window for this kind ends with the sign-in it would have made.
        oauth.cancel(kind);
        try {
          (deleter ??= securityCliKeychainDeleter()).delete(mcpKeychainService(kind));
        } catch {
          return failure("keychain_failed");
        }
        retryAt.delete(kind);
        const before = mcpRow(store, kind);
        if (before === undefined) return failure("no_connector");
        return { ok: true as const, row: writeRow(store, kind, before.server_url, "disconnected", null, null, now().toISOString()) };
      } catch {
        return failure("connector_failed");
      }
    });
  }

  /** The row's sign-in can no longer be renewed: `expired`, one event, one notification (only on this transition). */
  function expire(store: Store, row: McpRow, now: Date): void {
    const at = now.toISOString();
    store.transaction(() => {
      const current = mcpRow(store, row.kind);
      if (current === undefined || !isUsableMcpStatus(current.status)) return;
      store.prepare("UPDATE mcp_connections SET status = 'expired' WHERE id = ?").run(current.id);
      statusEvent(store, mcpRow(store, row.kind), row.kind, at);
      recordNotification(
        store,
        {
          source: mcpExpiredSource(row.kind),
          title: `The ${row.kind} connection needs you`,
          body: `Studio could not renew its sign-in to the ${row.kind} connector, so ${row.kind} items cannot be read until you reconnect it in Integrations.`,
        },
        now,
      );
    });
    retryAt.delete(row.kind);
  }

  /** Renew one `connected` row's tokens when they are near expiry. Never throws. */
  async function refreshOne(store: Store, row: McpRow, now: Date): Promise<void> {
    if (row.token_expiry === null || row.server_url === null) return;
    const expiry = Date.parse(row.token_expiry);
    if (!Number.isFinite(expiry)) return;
    const nowMs = now.getTime();
    if (expiry - nowMs > aheadMs) return;
    const pastExpiry = expiry <= nowMs;
    if (!pastExpiry && nowMs < (retryAt.get(row.kind) ?? 0)) return;

    let credential: McpCredential | undefined;
    try {
      credential = readMcpCredential(keychain(), row.kind);
    } catch {
      // The Keychain could not be read right now: try again, unless the token is already dead.
      if (pastExpiry) expire(store, row, now);
      else retryAt.set(row.kind, nowMs + retryMs);
      return;
    }
    // No sign-in in the Keychain, or one with nothing to renew it with: only a new sign-in helps, once the token has lapsed.
    if (credential === undefined) return expire(store, row, now);
    if (credential.refresh_token === undefined) {
      if (pastExpiry) expire(store, row, now);
      // Not yet lapsed: look again after the back-off, not on every tick (each look is a blocking Keychain read). A connect clears this.
      else retryAt.set(row.kind, nowMs + retryMs);
      return;
    }

    let renewed;
    try {
      renewed = await refreshMcpTokens(row.server_url, credential, now, http);
    } catch (err) {
      const definitive = err instanceof McpRefreshError && err.kind === "definitive";
      if (definitive || pastExpiry) expire(store, row, now);
      else retryAt.set(row.kind, nowMs + retryMs);
      return;
    }
    const next: McpCredential = {
      ...credential,
      access_token: renewed.access_token,
      ...(renewed.refresh_token === undefined ? {} : { refresh_token: renewed.refresh_token }),
    };
    // A renewal that names no expiry leaves the access token with none we know of.
    const { expires_at: _old, ...withoutExpiry } = next;
    const stored: McpCredential = renewed.expires_at === undefined ? withoutExpiry : { ...withoutExpiry, expires_at: renewed.expires_at };
    let encoded: string;
    let previous: string;
    try {
      encoded = encodeCredential(stored);
      previous = encodeCredential(credential);
    } catch {
      // Too long to keep: the old sign-in stays, and is tried again later.
      retryAt.set(row.kind, nowMs + retryMs);
      return;
    }
    const outcome = swapKeychain(row.kind, encoded, previous);
    if (outcome === "lost") return expire(store, row, now);
    if (outcome === "restored") {
      retryAt.set(row.kind, nowMs + retryMs);
      return;
    }
    retryAt.delete(row.kind);
    store.prepare("UPDATE mcp_connections SET token_expiry = ? WHERE id = ?").run(renewed.expires_at ?? null, row.id);
  }

  async function refreshDue(store: Store, now: Date): Promise<void> {
    try {
      const nowMs = now.getTime();
      if (!Number.isFinite(nowMs)) return;
      // Nothing near expiry: no queue, no Keychain read, no request.
      const due = mcpRows(store).filter((row) => {
        if (!isUsableMcpStatus(row.status) || row.token_expiry === null) return false;
        const expiry = Date.parse(row.token_expiry);
        return Number.isFinite(expiry) && expiry - nowMs <= aheadMs && (expiry <= nowMs || nowMs >= (retryAt.get(row.kind) ?? 0));
      });
      if (due.length === 0) return;
      await exclusive(async () => {
        for (const row of due) {
          // The row may have changed (disconnected, reconnected) while this waited its turn.
          const fresh = mcpRow(store, row.kind);
          if (fresh === undefined || !isUsableMcpStatus(fresh.status)) continue;
          try {
            await refreshOne(store, fresh, now);
          } catch {
            // One row's failure never stops the others, and never reaches `due_work_failed`'s clipped error text.
          }
        }
      });
    } catch {
      // Due work never throws: its error text would be recorded in an event.
    }
  }

  return {
    connect,
    cancel: (kind) => ({ cancelled: oauth.cancel(kind) }),
    disconnect,
    refreshDue,
    oauth,
  };
}

// ---- The part -------------------------------------------------------------------

/** The shipped connector: the real Keychain and HTTP, each resolved only when a route or tick needs it. */
export const mcpConnector: McpConnector = createMcpConnector();

/** The renewal as due work, on the loop's clock. */
export const mcpRefreshDueWork: DueWorkFn = (ctx) => mcpConnector.refreshDue(ctx.store, ctx.now());

/** The `mcp` part (phase 8 item 06): the three owner routes and the renewal. Its session tools are built per session (`tools.ts`), so it contributes none. */
export const mcpPart: IntegrationsPart = Object.freeze({
  name: "mcp",
  tools: Object.freeze([]),
  routes: mcpRoutes(mcpConnector),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([mcpRefreshDueWork]),
});
