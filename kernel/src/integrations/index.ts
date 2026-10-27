// The `integrations` feature (phase 6): connectors to outside services,
// GitHub first. One contribution built from one part per sub-file, so each
// phase 6 item edits only the sub-file it owns: item 03 `github/connector.ts`
// and `github/routes.ts`, item 06 `github/tools.ts`, item 07 `drafts.ts`.
// A part is empty until its item fills it in. Item 03 filled the GitHub
// parts: `github-connector` contributes the `studio connectors` subcommand
// and the token's expiry check (due work), and `github-routes` the four
// `/connectors` routes; `github-tools` and `drafts` are still empty.
// Integrations are optional (invariant 5): Studio works with none connected.
// Mechanism only (invariant 1). `startKernel` and `runCli` merge it through
// `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`), ninth and last, after
// `console`.
//
// The `studio` CLI loads it, so it imports only types, the feature seam, the
// console's part merge and its own parts: never the Agent SDK, the session
// manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph).
import { consoleContributionOf } from "../console/index.js";
import type { FeatureContribution } from "../features/contribution.js";
import { draftsPart } from "./drafts.js";
import { githubConnectorPart } from "./github/connector.js";
import { githubRoutesPart } from "./github/routes.js";
import { githubToolsPart } from "./github/tools.js";
import type { IntegrationsPart } from "./types.js";

/** The contribution's name. */
export const INTEGRATIONS_NAME = "integrations";

/** Every part, in merge order: tools, routes, subcommands and due work keep this order. */
export const INTEGRATIONS_PARTS: readonly IntegrationsPart[] = Object.freeze([githubConnectorPart, githubRoutesPart, githubToolsPart, draftsPart]);

/**
 * The contribution `parts` make: `name` always, and only the non-empty keys
 * beside it. The console's merge, reused as it is (one merge for both
 * features' parts): it throws `ContributionConflictError` naming both parts
 * when two claim one handler kind, and leaves tool, route and subcommand
 * collisions to `mergeContributions`.
 */
export function integrationsContributionOf(parts: readonly IntegrationsPart[]): FeatureContribution {
  return Object.freeze({ ...consoleContributionOf(parts), name: INTEGRATIONS_NAME });
}

/** The shipped contribution: `INTEGRATIONS_PARTS` merged at module load (the github parts are filled and claim no handler kind, so it does not throw). */
export const integrationsContribution: FeatureContribution = integrationsContributionOf(INTEGRATIONS_PARTS);

export { draftsPart } from "./drafts.js";
export { CONNECTORS_HELP, CONNECTORS_SUBCOMMAND, connectorsSubcommand } from "./cli.js";
export { GITHUB_KEYCHAIN_SERVICE, createGitHubClient } from "./github/client.js";
export {
  GITHUB_EXPIRY_NOTICE_DAYS,
  GITHUB_TOKEN_REFUSALS,
  checkGitHubExpiry,
  connectorView,
  createGitHubConnector,
  githubConnectorPart,
  githubConnectorRow,
  listConnectors,
} from "./github/connector.js";
export type { ConnectorErrorCode, ConnectorOutcome, ConnectorView, GitHubConnector, GitHubConnectorDeps, GitHubTokenRefusal } from "./github/connector.js";
export { githubRoutes, githubRoutesPart } from "./github/routes.js";
export { githubToolsPart } from "./github/tools.js";
export { toolsForConnectors } from "./tool-filter.js";
export { CONNECTOR_KINDS, CONNECTOR_STATUSES } from "./types.js";
export type {
  ConnectorKind,
  ConnectorRow,
  ConnectorStatus,
  DraftOutputRow,
  GitHubClient,
  GitHubFailure,
  GitHubPull,
  GitHubPullComment,
  GitHubPullDiff,
  GitHubPullFile,
  GitHubPullFilters,
  GitHubPullSummary,
  GitHubRateLimit,
  GitHubRepo,
  GitHubResponse,
  GitHubTokenInfo,
  IntegrationsPart,
  PollSpec,
  SourceItem,
} from "./types.js";
