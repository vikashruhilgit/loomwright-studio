// The `integrations` feature's GitHub routes part (phase 6, item 03): the
// owner's four connector routes, on the loopback API (bearer token, like
// every route), over the connector in `connector.ts`.
//
//   GET  /connectors                     {connectors}: every row in the contract's `Connector` shape, [] when none
//   POST /connectors/github/token        body {token, declared_read_only?}: validate, then store it; {connector}, never the token.
//                                        `declared_read_only: true` is the owner declaring that every permission they gave a
//                                        fine-grained token is Read (used only when GitHub reports none); a non-boolean is 400
//   POST /connectors/github/disconnect   delete the Keychain item, the row reads `disconnected`; {connector}
//   GET  /connectors/github/repos        {repos, verified_at}; `?refresh=1` re-reads them from GitHub first
//
// Refusals and failures are typed answers, never a throw: `{error, message,
// connector}` plus `write_permissions` (`token_write_scoped`), `resets_at`
// (`rate_limited`) or `github_status` (`github_error`). A handler catches
// everything, so the API's `route_failed` event (which records a clipped
// error message) is never written for these routes and can never carry the
// token. The token body is read once and handed to the connector: it is never
// echoed, logged or stored outside the Keychain.
//
// The `studio` CLI loads it, so it imports only types, the feature seam and
// the connector: never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../../features/contribution.js";
import type { IntegrationsPart } from "../types.js";
import { connectorView, githubConnector, githubConnectorRow, listConnectors } from "./connector.js";
import type { ConnectorErrorCode, ConnectorOutcome, GitHubConnector } from "./connector.js";

/** The HTTP status each failure answers. */
export const CONNECTOR_ERROR_STATUS: Readonly<Record<ConnectorErrorCode, number>> = Object.freeze({
  token_invalid: 422,
  token_write_scoped: 422,
  token_permissions_unknown: 422,
  rate_limited: 429,
  github_unreachable: 502,
  github_error: 502,
  keychain_failed: 500,
  connector_failed: 500,
  no_connector: 404,
  not_connected: 409,
});

/** A connector outcome as a route answer: `{connector}`, or the failure without its `ok`. */
function answer(outcome: ConnectorOutcome): ContributedRouteResponse {
  if (outcome.ok) return { status: 200, body: { connector: outcome.connector } };
  const { ok: _ok, ...body } = outcome;
  return { status: CONNECTOR_ERROR_STATUS[outcome.error], body };
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

/** The four routes over `connector` (tests pass one built over fakes; the shipped part uses `githubConnector`). */
export function githubRoutes(connector: GitHubConnector = githubConnector): readonly ContributedRoute[] {
  return Object.freeze([
    {
      method: "GET",
      path: "/connectors",
      handler: (req: ContributedRouteRequest) => total(async () => ({ status: 200, body: { connectors: listConnectors(req.store) } })),
    },
    {
      method: "POST",
      path: "/connectors/github/token",
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          const body = typeof req.body === "object" && req.body !== null && !Array.isArray(req.body) ? (req.body as { token?: unknown; declared_read_only?: unknown }) : undefined;
          const token = body?.token;
          if (typeof token !== "string") return { status: 400, body: { error: "invalid_body", message: 'needs {"token": "<a GitHub token>"}' } };
          // Present, it must be a boolean; only `true` declares (`false` is the same as absent).
          const declared = body?.declared_read_only;
          if (declared !== undefined && typeof declared !== "boolean") {
            return { status: 400, body: { error: "invalid_body", message: "declared_read_only must be true or false" } };
          }
          return answer(await connector.setToken(req.store, token, req.now, { declaredReadOnly: declared === true }));
        }),
    },
    {
      method: "POST",
      path: "/connectors/github/disconnect",
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          if (!objectOrAbsent(req.body)) return { status: 400, body: { error: "invalid_body", message: "disconnect takes no body" } };
          return answer(await connector.disconnect(req.store, req.now));
        }),
    },
    {
      method: "GET",
      path: "/connectors/github/repos",
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          if (req.query.refresh === "1") {
            const refreshed = await connector.refreshRepos(req.store, req.now);
            if (!refreshed.ok) return answer(refreshed);
            return { status: 200, body: { repos: refreshed.connector.reachable_repos ?? [], verified_at: refreshed.connector.verified_at } };
          }
          const row = githubConnectorRow(req.store);
          const view = row === undefined ? undefined : connectorView(row);
          return { status: 200, body: { repos: view?.reachable_repos ?? [], verified_at: view?.verified_at ?? null } };
        }),
    },
  ] satisfies ContributedRoute[]);
}

export const githubRoutesPart: IntegrationsPart = Object.freeze({
  name: "github-routes",
  tools: Object.freeze([]),
  routes: githubRoutes(),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
