// The `integrations` feature's GitHub App routes part (D36): the owner's two
// App setup routes (bearer token, like every route) and the three browser routes
// GitHub returns to (no token, GET only, gated by the open setup window and its
// single-use `state`). The flow itself, its window and its pages are in
// `app-setup.ts` (`docs/architecture/github-app-setup.md`); this file only builds
// the routes over the GitHub App port.
//
//   POST /connectors/github/app/setup         {setup_url, expires_at}: open the one setup window
//   POST /connectors/github/app/setup/cancel  {cancelled}: close it
//   GET  /connectors/github/app/start         the page that posts the manifest to github.com
//   GET  /connectors/github/app/return        GitHub's redirect_url, after Create
//   GET  /connectors/github/app/installed     GitHub's setup_url, after Install
//
// The port defaults to `githubAppPort` (`app-port.ts`), which the tokens item
// fills in place; tests pass a fake port to `githubAppRoutes`.
//
// The `studio` CLI loads it, so it imports only types, the feature seam and
// its siblings: never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { ContributedRoute } from "../../features/contribution.js";
import type { IntegrationsPart } from "../types.js";
import { githubAppPort } from "./app-port.js";
import { createGitHubAppSetup } from "./app-setup.js";
import type { GitHubAppSetupDeps } from "./app-setup.js";

/** The five routes, over one setup window (each call builds its own). */
export function githubAppRoutes(deps: Partial<GitHubAppSetupDeps> = {}): readonly ContributedRoute[] {
  return createGitHubAppSetup({ ...deps, port: deps.port ?? githubAppPort }).routes;
}

export const githubAppRoutesPart: IntegrationsPart = Object.freeze({
  name: "github-app-routes",
  tools: Object.freeze([]),
  routes: githubAppRoutes(),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
