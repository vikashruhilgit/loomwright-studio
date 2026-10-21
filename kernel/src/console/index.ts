// The `console` feature (phase 5): the kernel side of the app. One
// contribution built from one part per sub-file, so each phase 5 item edits
// only the sub-file it owns: item 02 `events.ts`, item 03 `output.ts`, item
// 04 `control.ts`, item 05 `pause.ts`, item 06 `threads.ts`. Every part is
// empty until its item fills it in. Today only the output part is filled, so
// the contribution is its name, the `GET /sessions` and
// `GET /sessions/:id/output` routes and the `studio sessions` subcommand (the
// app's live feed socket is `handleEventFeed` in `../api/feed.ts`, and the
// session manager's output observer is `recordSessionOutput` in `./output.ts`,
// which keeps each session's bounded output log).
// Mechanism only (invariant 1). `startKernel` and `runCli` merge it through
// `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`), eighth, after `agents`.
//
// The `studio` CLI loads it, so it imports only types, the feature seam and
// its own parts: never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import { ContributionConflictError } from "../features/contribution.js";
import type { ContributedRoute, ContributedSubcommand, ContributedTool, DueWorkFn, FeatureContribution } from "../features/contribution.js";
import type { EventHandler, EventKind } from "../loop/types.js";
import { controlPart } from "./control.js";
import { eventsPart } from "./events.js";
import { outputPart } from "./output.js";
import { pausePart } from "./pause.js";
import { threadsPart } from "./threads.js";
import type { ConsolePart } from "./types.js";

/** The contribution's name. */
export const CONSOLE_NAME = "console";

/** Every part, in merge order: tools, routes, subcommands and due work keep this order. */
export const CONSOLE_PARTS: readonly ConsolePart[] = Object.freeze([eventsPart, outputPart, controlPart, pausePart, threadsPart]);

/** The parts joined: tools, routes, subcommands and due work in part order, and the handlers. */
export interface MergedConsoleParts {
  readonly tools: readonly ContributedTool[];
  readonly routes: readonly ContributedRoute[];
  readonly subcommands: readonly ContributedSubcommand[];
  readonly handlers: Readonly<Partial<Record<EventKind, EventHandler>>>;
  readonly dueWork: readonly DueWorkFn[];
}

/**
 * Join `parts` in order. Throws `ContributionConflictError` naming both parts
 * as owners when two parts claim one handler kind (`part: "handler"`). Tools,
 * routes and subcommands are checked by `mergeContributions`, like any
 * feature's.
 */
export function mergeConsoleParts(parts: readonly ConsolePart[]): MergedConsoleParts {
  const handlerOwners = new Map<string, string>();
  const tools: ContributedTool[] = [];
  const routes: ContributedRoute[] = [];
  const subcommands: ContributedSubcommand[] = [];
  const handlers: Partial<Record<EventKind, EventHandler>> = {};
  const dueWork: DueWorkFn[] = [];
  for (const part of parts) {
    tools.push(...part.tools);
    routes.push(...part.routes);
    subcommands.push(...(part.subcommands ?? []));
    dueWork.push(...(part.dueWork ?? []));
    for (const kind of Object.keys(part.handlers) as EventKind[]) {
      const first = handlerOwners.get(kind);
      if (first !== undefined) throw new ContributionConflictError("handler", kind, [first, part.name]);
      handlerOwners.set(kind, part.name);
      handlers[kind] = part.handlers[kind];
    }
  }
  return Object.freeze({
    tools: Object.freeze(tools),
    routes: Object.freeze(routes),
    subcommands: Object.freeze(subcommands),
    handlers: Object.freeze(handlers),
    dueWork: Object.freeze(dueWork),
  });
}

/**
 * The contribution `parts` make: `name` always, and only the non-empty keys
 * beside it (`tools`, `routes`, `subcommands`, `handlers`, `dueWork`). Name
 * collisions (a subcommand included) are left to `mergeContributions`.
 */
export function consoleContributionOf(parts: readonly ConsolePart[]): FeatureContribution {
  const merged = mergeConsoleParts(parts);
  const handlers = merged.handlers as Readonly<Record<string, EventHandler>>;
  return Object.freeze({
    name: CONSOLE_NAME,
    ...(merged.tools.length > 0 ? { tools: merged.tools } : {}),
    ...(merged.routes.length > 0 ? { routes: merged.routes } : {}),
    ...(merged.subcommands.length > 0 ? { subcommands: merged.subcommands } : {}),
    ...(Object.keys(handlers).length > 0 ? { handlers } : {}),
    ...(merged.dueWork.length > 0 ? { dueWork: merged.dueWork } : {}),
  });
}

/** The shipped contribution: `CONSOLE_PARTS` merged at module load (no two shipped parts claim one handler kind, so it does not throw). */
export const consoleContribution: FeatureContribution = consoleContributionOf(CONSOLE_PARTS);

export { controlPart } from "./control.js";
export { eventsPart } from "./events.js";
export {
  MAX_SESSION_OUTPUT_BYTES,
  MAX_SESSION_OUTPUT_ROWS,
  OUTPUT_FEED_INTERVAL_MS,
  SESSION_OUTPUT_KINDS,
  createSessionOutputRecorder,
  isSessionOutputKind,
  outputPart,
  recordSessionOutput,
} from "./output.js";
export type { SessionOutputKind, SessionOutputRecorder, SessionOutputRecorderDeps } from "./output.js";
export { pausePart } from "./pause.js";
export { threadsPart } from "./threads.js";
export { emptyConsolePart } from "./types.js";
export type { ConsolePart } from "./types.js";
