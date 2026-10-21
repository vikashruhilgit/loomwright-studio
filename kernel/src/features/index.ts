// The feature registry: every shipped feature's contribution (the five phase
// 2 features, then phase 3's `playbooks`, then phase 4's `agents`, then phase
// 5's `console`), in a fixed order. Each is empty until the item that builds it fills it in
// (invariant 1: nothing is preinstalled). `startKernel` and the `studio` CLI merge
// `SHIPPED_CONTRIBUTIONS` by default. The CLI imports this module, so neither
// it nor anything it loads may import the Agent SDK, the session manager or
// `kernel.ts` (pinned in `kernel/test/feature-seams.test.ts`).
import { agentsContribution } from "../agents/index.js";
import { approvalsContribution } from "../approvals/index.js";
import { brainContribution } from "../brain/index.js";
import { consoleContribution } from "../console/index.js";
import { loomwrightContribution } from "../loomwright/index.js";
import { notificationsContribution } from "../notifications/index.js";
import { playbooksContribution } from "../playbooks/index.js";
import { triggersContribution } from "../triggers/index.js";
import type { FeatureContribution } from "./contribution.js";

export const SHIPPED_CONTRIBUTIONS: readonly FeatureContribution[] = Object.freeze([
  loomwrightContribution,
  notificationsContribution,
  triggersContribution,
  approvalsContribution,
  brainContribution,
  playbooksContribution,
  agentsContribution,
  consoleContribution,
]);

export {
  ContributionConflictError,
  InvalidContributionError,
  OPTIONS_HANDLERS_OWNER,
  PHASE1_OWNER,
  PHASE1_RESERVED,
  PHASE1_ROUTES,
  PHASE1_SUBCOMMANDS,
  PHASE1_TOOL_NAMES,
  ROUTE_METHODS,
  UnknownEventKindError,
  compileRoutePath,
  defineTool,
  matchRoutePath,
  mergeContributions,
} from "./contribution.js";
export type {
  CliApiClient,
  CliSubcommandOutput,
  ContributedRoute,
  ContributedRouteRequest,
  ContributedRouteResponse,
  ContributedSubcommand,
  ContributedTool,
  ContributedToolContext,
  ContributionPart,
  DueWorkFn,
  FeatureContribution,
  KillSwitchView,
  MergedContributions,
  OwnedRoute,
  ReservedNames,
  RouteMethod,
  RouteSegment,
} from "./contribution.js";
