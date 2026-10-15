// The `triggers` feature (phase 2): agents create one-shot (`once`) and
// recurring (`cron`, in an IANA zone) triggers through kernel tools; the
// kernel fires each scheduled instant at most once from its due work; the
// owner sees every trigger and turns any of them on or off (`studio
// triggers`, the `/triggers` routes). Mechanism only (invariant 1): no
// trigger is preinstalled, and what a trigger is for is the creator's.
// `startKernel` and `runCli` merge this contribution through
// `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`).
//
// The `studio` CLI loads it, so nothing reachable from here may import the
// Agent SDK, the session manager or `kernel.ts` (pinned in
// `kernel/test/feature-seams.test.ts`): besides zod, `node:readline` and
// type-level kernel modules, its runtime imports are its own files,
// `../features/contribution.js` (`defineTool`), `../loop/steps.js`,
// `../loop/queue.js`, `../loop/internal.js` and `../api/kill-switch.js`,
// which import only each other, `../loop/types.js` and the store's types.
import type { DueWorkFn, FeatureContribution } from "../features/contribution.js";
import { triggersSubcommand } from "./cli.js";
import { triggerRoutes } from "./routes.js";
import { fireDueTriggers } from "./store.js";
import { triggerTools } from "./tools.js";

export { TRIGGER_TOOL_NAMES } from "./tools.js";
export { TRIGGERS_HELP, TRIGGERS_SUBCOMMAND, formatTriggers, triggersSubcommand } from "./cli.js";
export type { TriggersSubcommandDeps } from "./cli.js";
export { checkTimeZone, formatZoned, nextCronFire, parseCron } from "./cron.js";
export type { CronSchedule } from "./cron.js";
export {
  MAX_COUNTED_INSTANTS,
  MAX_TRIGGER_TEXT,
  TRIGGER_ACTIONS,
  TRIGGER_AUDIT_KINDS,
  TRIGGER_KINDS,
  TRIGGER_RESULTS,
  TRIGGER_TOGGLERS,
  TriggerError,
  fireDueTriggers,
  getTrigger,
  listTriggers,
  registerTrigger,
  removeTrigger,
  setTriggerEnabled,
} from "./store.js";
export type { TriggerFireOutcome, TriggerSpec, TriggerView } from "./store.js";

export const triggersContribution: FeatureContribution = Object.freeze({
  name: "triggers",
  tools: triggerTools,
  routes: triggerRoutes,
  subcommands: Object.freeze([triggersSubcommand()]),
  dueWork: Object.freeze<DueWorkFn[]>([
    ({ store, now }) => {
      fireDueTriggers(store, now());
    },
  ]),
});
