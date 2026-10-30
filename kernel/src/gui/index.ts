// The `gui` feature (phase 7): the read routes behind the app's six new
// screens. One contribution built from one part per sub-file, so each phase 7
// screen item edits only the sub-file it owns: item 03 `tasks.ts`, item 04
// `playbook-history.ts`, item 05 `schedules.ts`, item 06 `memory.ts`, item 07
// `budget-audit.ts`, item 08 `settings.ts`. A part is empty until its item
// fills it in. Every gui route is an owner route that needs the API token:
// none sets `unauthenticated`. Mechanism only (invariant 1). `startKernel`
// and `runCli` merge it through `SHIPPED_CONTRIBUTIONS`
// (`../features/index.ts`), tenth and last, after `integrations`.
//
// The `studio` CLI loads it, so it imports only types, the feature seam, the
// console's part merge and its own parts: never the Agent SDK, the session
// manager or `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the
// registry's module graph).
import { consoleContributionOf } from "../console/index.js";
import type { FeatureContribution } from "../features/contribution.js";
import { budgetAuditPart } from "./budget-audit.js";
import { memoryPart } from "./memory.js";
import { playbookHistoryPart } from "./playbook-history.js";
import { schedulesPart } from "./schedules.js";
import { settingsPart } from "./settings.js";
import { tasksPart } from "./tasks.js";
import type { GuiPart } from "./types.js";

/** The contribution's name. */
export const GUI_NAME = "gui";

/** Every part, in merge order: tools, routes, subcommands and due work keep this order. */
export const GUI_PARTS: readonly GuiPart[] = Object.freeze([tasksPart, playbookHistoryPart, schedulesPart, memoryPart, budgetAuditPart, settingsPart]);

/**
 * The contribution `parts` make: `name` always, and only the non-empty keys
 * beside it. The console's merge, reused as it is (one merge for every
 * feature's parts): it throws `ContributionConflictError` naming both parts
 * when two claim one handler kind, and leaves tool, route and subcommand
 * collisions to `mergeContributions`.
 */
export function guiContributionOf(parts: readonly GuiPart[]): FeatureContribution {
  return Object.freeze({ ...consoleContributionOf(parts), name: GUI_NAME });
}

/** The shipped contribution: `GUI_PARTS` merged at module load (every part is empty and claims no handler kind, so it does not throw). */
export const guiContribution: FeatureContribution = guiContributionOf(GUI_PARTS);

export { budgetAuditPart, budgetAuditRoutes } from "./budget-audit.js";
export { memoryPart, memoryRoutes } from "./memory.js";
export { playbookHistoryPart, playbookHistoryRoutes } from "./playbook-history.js";
export { schedulesPart, schedulesRoutes } from "./schedules.js";
export { settingsPart, settingsRoutes } from "./settings.js";
export { tasksPart, tasksRoutes } from "./tasks.js";
export type { GuiPart } from "./types.js";
