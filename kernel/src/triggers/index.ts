// The `triggers` feature (phase 2): agents create one-shot (`once`) and
// recurring (`cron`, in an IANA zone) triggers through kernel tools, and a
// playbook's trigger can be a `poll` (phase 6, `./poll.ts`); the
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
// type-level kernel modules (`../integrations/types.js` among them, for the
// poll's `GitHubClient`), its runtime imports are its own files,
// `../features/contribution.js` (`defineTool`), `../loop/steps.js`,
// `../loop/queue.js`, `../loop/internal.js`, `../api/kill-switch.js`,
// `../console/pause.js` and `../notifications/record.js`, which import only
// each other, `../loop/types.js` and the store's types.
//
// The due work fires the time-based triggers (`fireDueTriggers`), then the
// polls (`firePollTriggers`, with the loop's `DueWorkContext.github`). Both
// run every tick even when the first throws; the first failure is rethrown
// after both, so the loop records one `due_work_failed`.
import type { DueWorkFn, FeatureContribution } from "../features/contribution.js";
import { triggersSubcommand } from "./cli.js";
import { triggerRoutes } from "./routes.js";
import { firePollTriggers } from "./poll.js";
import { fireDueTriggers } from "./store.js";
import { triggerTools } from "./tools.js";

export { TRIGGER_TOOL_NAMES } from "./tools.js";
export { TRIGGERS_HELP, TRIGGERS_SUBCOMMAND, formatTriggers, triggersSubcommand } from "./cli.js";
export type { TriggersSubcommandDeps } from "./cli.js";
export { MAX_CRON_LENGTH, checkTimeZone, formatZoned, nextCronFire, parseCron } from "./cron.js";
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
  updateTriggerSpec,
} from "./store.js";
export type { TriggerErrorCode, TriggerFireOutcome, TriggerResult, TriggerSpec, TriggerView } from "./store.js";
export { MAX_POLL_ITEMS, POLL_FILTER_KEYS, POLL_SOURCES, firePollTriggers } from "./poll.js";
export type { PollFireOutcome } from "./poll.js";

export const triggersContribution: FeatureContribution = Object.freeze({
  name: "triggers",
  tools: triggerTools,
  routes: triggerRoutes,
  subcommands: Object.freeze([triggersSubcommand()]),
  dueWork: Object.freeze<DueWorkFn[]>([
    async ({ store, now, github }) => {
      // A failing time-based trigger never skips a due poll in the same tick, nor the reverse.
      const failures: unknown[] = [];
      try {
        fireDueTriggers(store, now());
      } catch (err) {
        failures.push(err);
      }
      try {
        await firePollTriggers(store, github, now());
      } catch (err) {
        failures.push(err);
      }
      if (failures.length > 0) throw failures[0];
    },
  ]),
});
