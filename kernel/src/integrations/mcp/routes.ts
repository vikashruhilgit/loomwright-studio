// The `mcp` part's three owner routes (phase 8 item 06, D38), on the loopback
// API (bearer token, like every route), over the connector in `connector.ts`:
//
//   POST /connectors/mcp/:kind/connect          open the one connect window: {authorize_url, expires_at}; the app opens `authorize_url` in the system browser
//   POST /connectors/mcp/:kind/connect/cancel   close it: {cancelled}
//   POST /connectors/mcp/:kind/disconnect       delete the Keychain item, the row reads `disconnected`: {connector}
//
// `:kind` is `jira` or `clickup`; anything else (GitHub has its own routes) is
// 404 `unknown_kind`. None takes a body. The browser's return does not come
// through these routes: it lands on the connect's own loopback listener
// (`oauth.ts`), so the kernel serves no unauthenticated route for it.
//
// Refusals and failures are typed answers, never a throw: `{error, message}`
// with a closed code and a fixed sentence. A handler catches everything, so the
// API's `route_failed` event (which records a clipped error message) is never
// written for these routes. `authorize_url` carries the window's single-use
// `state`: it is answered to the token holder only and is in no event or log.
//
// `disconnect` answers the contract's `ConnectorChangeResponse` (`connector`),
// the GitHub-shaped row: the table keeps no timestamps, so `created_at` and
// `updated_at` are the instant of the change, and the GitHub-only fields
// (`permissions`, `reachable_repos`, the account) are `null`.
//
// The `studio` CLI loads it, so it imports only types, the feature seam and
// the connector's types: never the Agent SDK, the session manager or
// `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../../features/contribution.js";
import type { McpErrorCode, McpFailure, McpConnector } from "./connector.js";
import { isMcpKind } from "./rows.js";
import type { McpKind, McpRow } from "./rows.js";

/** The HTTP status each failure answers. */
export const MCP_ERROR_STATUS: Readonly<Record<McpErrorCode, number>> = Object.freeze({
  server_not_configured: 409,
  connect_in_progress: 409,
  server_url_refused: 422,
  listener_failed: 500,
  discovery_failed: 502,
  registration_unsupported: 502,
  registration_failed: 502,
  cancelled: 409,
  window_expired: 409,
  authorization_denied: 409,
  token_exchange_failed: 502,
  tools_list_failed: 502,
  credential_failed: 500,
  connect_failed: 500,
  no_connector: 404,
  keychain_failed: 500,
  connector_failed: 500,
});

const CONNECT_PATH = "/connectors/mcp/:kind/connect";
const CANCEL_PATH = "/connectors/mcp/:kind/connect/cancel";
const DISCONNECT_PATH = "/connectors/mcp/:kind/disconnect";

/** A failure as a route answer. */
function failed(f: McpFailure): ContributedRouteResponse {
  return { status: MCP_ERROR_STATUS[f.error], body: { error: f.error, message: f.message } };
}

/** The route's `:kind`, or the 404 answer when it is not an MCP kind. */
function kindOf(req: ContributedRouteRequest): McpKind | ContributedRouteResponse {
  const kind = req.params["kind"];
  if (!isMcpKind(kind)) return { status: 404, body: { error: "unknown_kind", message: "kind must be jira or clickup" } };
  return kind;
}

/** Whether a body is absent or a plain object. */
function objectOrAbsent(body: unknown): boolean {
  return body === undefined || (typeof body === "object" && body !== null && !Array.isArray(body));
}

/** Runs `fn`; any throw is a fixed `connector_failed` answer whose message is never kept. */
async function total(fn: () => Promise<ContributedRouteResponse>): Promise<ContributedRouteResponse> {
  try {
    return await fn();
  } catch {
    return { status: 500, body: { error: "connector_failed", message: "the connector could not answer" } };
  }
}

/** The disconnected row in the contract's `Connector` shape (see the file header for the timestamps). */
function connectorShape(row: McpRow, at: string): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    account_login: null,
    permissions: null,
    permissions_source: null,
    permissions_declared_at: null,
    reachable_repos: null,
    expires_at: row.token_expiry,
    verified_at: null,
    created_at: at,
    updated_at: at,
  };
}

/** The three routes over `connector` (tests pass one built over fakes; the shipped part uses `mcpConnector`). */
export function mcpRoutes(connector: McpConnector): readonly ContributedRoute[] {
  return Object.freeze([
    {
      method: "POST",
      path: CONNECT_PATH,
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          const kind = kindOf(req);
          if (typeof kind !== "string") return kind;
          if (!objectOrAbsent(req.body)) return { status: 400, body: { error: "invalid_body", message: "connect takes no body" } };
          const opened = await connector.connect(req.store, kind, req.now);
          if (!opened.ok) return failed(opened);
          return { status: 200, body: { authorize_url: opened.authorize_url, expires_at: opened.expires_at } };
        }),
    },
    {
      method: "POST",
      path: CANCEL_PATH,
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          const kind = kindOf(req);
          if (typeof kind !== "string") return kind;
          if (!objectOrAbsent(req.body)) return { status: 400, body: { error: "invalid_body", message: "cancel takes no body" } };
          return { status: 200, body: connector.cancel(kind) };
        }),
    },
    {
      method: "POST",
      path: DISCONNECT_PATH,
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          const kind = kindOf(req);
          if (typeof kind !== "string") return kind;
          if (!objectOrAbsent(req.body)) return { status: 400, body: { error: "invalid_body", message: "disconnect takes no body" } };
          const outcome = await connector.disconnect(req.store, kind, req.now);
          if (!outcome.ok) return failed(outcome);
          return { status: 200, body: { connector: connectorShape(outcome.row, req.now().toISOString()) } };
        }),
    },
  ] satisfies ContributedRoute[]);
}
