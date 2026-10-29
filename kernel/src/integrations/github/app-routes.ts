// The `integrations` feature's GitHub App routes part (D36), stubbed: the
// owner's two App setup routes, on the loopback API (bearer token, like every
// route). The contract is fixed here and in `docs/architecture/integrations.md`;
// the behaviour is the setup item's, which fills this file in.
//
//   POST /connectors/github/app/setup         will answer {setup_url, expires_at}: open the one setup window
//   POST /connectors/github/app/setup/cancel  will answer {cancelled}: close it
//
// Until then both answer `501 {"error":"not_implemented"}`. The three browser
// routes (`/connectors/github/app/start`, `/return`, `/installed`) are the setup
// item's too and are not served here.
//
// The `studio` CLI loads it, so it imports only types and the feature seam:
// never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { ContributedRoute, ContributedRouteResponse } from "../../features/contribution.js";
import type { IntegrationsPart } from "../types.js";

/** The one answer both stub routes give. */
function notImplemented(): Promise<ContributedRouteResponse> {
  return Promise.resolve({ status: 501, body: { error: "not_implemented" } });
}

/** The two owner routes (the setup item replaces the handlers). */
export function githubAppRoutes(): readonly ContributedRoute[] {
  return Object.freeze([
    {
      method: "POST",
      path: "/connectors/github/app/setup",
      handler: () => notImplemented(),
    },
    {
      method: "POST",
      path: "/connectors/github/app/setup/cancel",
      handler: () => notImplemented(),
    },
  ] satisfies ContributedRoute[]);
}

export const githubAppRoutesPart: IntegrationsPart = Object.freeze({
  name: "github-app-routes",
  tools: Object.freeze([]),
  routes: githubAppRoutes(),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
