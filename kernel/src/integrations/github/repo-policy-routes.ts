// The `repo-policy` part's three owner routes (phase 8 item 08, D40), on the
// loopback API (bearer token, like every route), over `repo-policy.ts`:
//
//   GET  /repos/policy                       {repos}: every repo the GitHub connector reaches and every repo with a stored row, each as the
//                                            contract's `RepoPolicy` (its set policy, `detected`, `proposal`). Reads the store only: no GitHub call
//   POST /repos/policy/:owner/:repo/detect   read the repo's state from GitHub now and record it; the `RepoPolicy` after. Sets no policy
//   POST /repos/policy/:owner/:repo          body {kind, required?, trust_unprotected?}: the owner sets the policy; the `RepoPolicy` after
//
// These are the owner's routes and nothing else: the part contributes no agent
// tool (`tools` is frozen empty), so no session can set or change a repo's policy
// (invariant 3). A proposal is never applied by the kernel.
//
// Refusals and failures are typed answers, never a throw: `{error, message}` with
// a closed code and a fixed sentence (`invalid_repo`, `invalid_body`,
// `policy_failed`). A handler catches everything, so the API's `route_failed`
// event (which records a clipped error message) is never written for these routes.
//
// The `studio` CLI loads it, so it imports only types, the feature seam and the
// policy module: never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../../features/contribution.js";
import type { IntegrationsPart } from "../types.js";
import { connectorView, githubConnectorRow } from "./connector.js";
import { detectRepoPolicy, isRepoName, listRepoPolicies, parseRepoPolicyBody, setRepoPolicy } from "./repo-policy.js";
import type { RepoPolicyDeps, RepoPolicyView } from "./repo-policy.js";

/** The three owner routes' paths. */
export const REPO_POLICY_LIST_PATH = "/repos/policy";
export const REPO_POLICY_DETECT_PATH = "/repos/policy/:owner/:repo/detect";
export const REPO_POLICY_SET_PATH = "/repos/policy/:owner/:repo";

/** Runs `fn`; any throw is a fixed `policy_failed` answer whose message is never kept. */
async function total(fn: () => Promise<ContributedRouteResponse>): Promise<ContributedRouteResponse> {
  try {
    return await fn();
  } catch {
    return { status: 500, body: { error: "policy_failed", message: "the repo policy could not be read or recorded" } };
  }
}

/** The `<owner>/<repo>` the path names, or the 400 answer when a segment is not one. */
function repoOf(req: ContributedRouteRequest): { readonly repo: string } | { readonly refused: ContributedRouteResponse } {
  const repo = `${req.params["owner"] ?? ""}/${req.params["repo"] ?? ""}`;
  return isRepoName(repo) ? { repo } : { refused: { status: 400, body: { error: "invalid_repo", message: "the path must be /repos/policy/<owner>/<repo>" } } };
}

/** The repos the GitHub connector reaches (its stored list), `[]` when it is not connected. */
function reachableRepos(req: ContributedRouteRequest): readonly string[] {
  const row = githubConnectorRow(req.store);
  return row === undefined ? [] : (connectorView(row).reachable_repos ?? []);
}

/** The policy of a reached repo nothing has been recorded for: no policy, nothing detected. */
function untouched(repo: string): RepoPolicyView {
  return { repo, kind: null, required_reviews: null, trust_unprotected: false, detected: null, proposal: null, set_by: null, set_at: null };
}

/** The three routes; tests pass `deps` (a fake GitHub client, a clock), the shipped part uses the defaults. */
export function repoPolicyRoutes(deps: RepoPolicyDeps = {}): readonly ContributedRoute[] {
  return Object.freeze([
    {
      method: "GET",
      path: REPO_POLICY_LIST_PATH,
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          const byRepo = new Map<string, RepoPolicyView>(listRepoPolicies(req.store).map((p) => [p.repo, p]));
          for (const repo of reachableRepos(req)) if (isRepoName(repo) && !byRepo.has(repo)) byRepo.set(repo, untouched(repo));
          const repos = [...byRepo.values()].sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0));
          return { status: 200, body: { repos } };
        }),
    },
    {
      method: "POST",
      path: REPO_POLICY_DETECT_PATH,
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          const named = repoOf(req);
          if ("refused" in named) return named.refused;
          return { status: 200, body: await detectRepoPolicy(req.store, named.repo, { ...deps, now: deps.now ?? req.now }) };
        }),
    },
    {
      method: "POST",
      path: REPO_POLICY_SET_PATH,
      handler: (req: ContributedRouteRequest) =>
        total(async () => {
          const named = repoOf(req);
          if ("refused" in named) return named.refused;
          const body = parseRepoPolicyBody(req.body);
          if (!body.ok) return { status: 400, body: { error: "invalid_body", message: body.message } };
          return { status: 200, body: setRepoPolicy(req.store, named.repo, body.value, deps.now ?? req.now) };
        }),
    },
  ] satisfies ContributedRoute[]);
}

/**
 * The `repo-policy` part: the three owner routes and nothing else. No tool (so no
 * agent can set a policy), no subcommand, no handler, no due work.
 */
export const repoPolicyPart: IntegrationsPart = Object.freeze({
  name: "repo-policy",
  tools: Object.freeze([]),
  routes: repoPolicyRoutes(),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
