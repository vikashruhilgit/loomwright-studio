// The `agents` feature (phase 4): one contribution built from one part per
// sub-file, so each phase 4 item edits only the sub-file(s) it owns: item 02
// `roster.ts`, item 06 `delegate.ts`, item 07 `charter-tools.ts`. A part is
// empty until its item fills it in; today the delegate part has the one tool
// `kernel_agent_message` and the other two are empty, so the contribution is
// that tool and the `studio agents` subcommand, with no verbs. The
// shared readers every item uses live beside them: the closed value sets
// (`types.ts`), the one settings reader (`settings.ts`), the one memory
// reader (`memory.ts`) and the read-only registry lookups (`registry.ts`).
// Mechanism only (invariants 1 and 9): no crew member ships preinstalled, and
// there are no role presets. `startKernel` and `runCli` merge it through
// `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`), seventh, after `playbooks`.
//
// The `studio` CLI loads it, so it imports only types, zod, `node:*`, the
// feature seam and the leaf modules its readers need: never the Agent SDK,
// the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`
// pins the registry's module graph).
import { ContributionConflictError, InvalidContributionError } from "../features/contribution.js";
import type {
  CliApiClient,
  CliSubcommandOutput,
  ContributedRoute,
  ContributedSubcommand,
  ContributedTool,
  DueWorkFn,
  FeatureContribution,
} from "../features/contribution.js";
import type { EventHandler, EventKind } from "../loop/types.js";
import { charterToolsPart } from "./charter-tools.js";
import { delegatePart } from "./delegate.js";
import { rosterPart } from "./roster.js";
import type { AgentPart, AgentVerb } from "./types.js";

/** The contribution's name, and the `studio agents` command word. */
export const AGENTS_NAME = "agents";

/** The verb that prints the help, whatever the parts register (a part may not claim it). */
export const AGENTS_HELP_VERB = "help";

/** Every part, in merge order: tools, routes and verbs keep this order. */
export const AGENT_PARTS: readonly AgentPart[] = Object.freeze([rosterPart, delegatePart, charterToolsPart]);

/** The parts joined: tools, routes and due work in part order, the verbs of the one subcommand, the handlers. */
export interface MergedAgentParts {
  readonly tools: readonly ContributedTool[];
  readonly routes: readonly ContributedRoute[];
  readonly verbs: readonly AgentVerb[];
  readonly handlers: Readonly<Partial<Record<EventKind, EventHandler>>>;
  readonly dueWork: readonly DueWorkFn[];
}

/**
 * Join `parts` in order. Throws `ContributionConflictError` naming both parts
 * as owners when two parts claim one verb (`part: "subcommand"`, the name
 * `agents <verb>`) or one handler kind (`part: "handler"`), and
 * `InvalidContributionError` for a verb named `help` (the built-in help).
 * Tools and routes are checked by `mergeContributions`, like any feature's.
 */
export function mergeAgentParts(parts: readonly AgentPart[]): MergedAgentParts {
  const verbOwners = new Map<string, string>();
  const handlerOwners = new Map<string, string>();
  const tools: ContributedTool[] = [];
  const routes: ContributedRoute[] = [];
  const verbs: AgentVerb[] = [];
  const handlers: Partial<Record<EventKind, EventHandler>> = {};
  const dueWork: DueWorkFn[] = [];
  for (const part of parts) {
    tools.push(...part.tools);
    routes.push(...part.routes);
    dueWork.push(...(part.dueWork ?? []));
    for (const verb of part.verbs) {
      if (verb.name === AGENTS_HELP_VERB) {
        throw new InvalidContributionError(AGENTS_NAME, "subcommand", `part ${part.name}: the verb "${AGENTS_HELP_VERB}" is the built-in help`);
      }
      const first = verbOwners.get(verb.name);
      if (first !== undefined) throw new ContributionConflictError("subcommand", `${AGENTS_NAME} ${verb.name}`, [first, part.name]);
      verbOwners.set(verb.name, part.name);
      verbs.push(verb);
    }
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
    verbs: Object.freeze(verbs),
    handlers: Object.freeze(handlers),
    dueWork: Object.freeze(dueWork),
  });
}

/**
 * `studio agents <verb>`, then each verb's help line with a leading
 * `studio agents ` removed (so the joined line stays within the 200
 * characters a subcommand's help may have), joined with ` | ` (one line).
 * Each verb's own `help` (its usage line) is unchanged.
 */
export function agentsHelp(verbs: readonly AgentVerb[]): string {
  const prefix = `studio ${AGENTS_NAME} `;
  return [`studio ${AGENTS_NAME} <verb>`, ...verbs.map((v) => (v.help.startsWith(prefix) ? v.help.slice(prefix.length) : v.help))].join(" | ");
}

/**
 * The `studio agents` subcommand over `verbs`. No verb, or `help`: the help
 * line (then `no verbs yet` when there are none) on stdout, 0. An unknown
 * verb: one line naming it, then the help, on stderr, 2. A known verb runs
 * with the remaining args. The shell itself never calls the API.
 */
export function agentsSubcommand(verbs: readonly AgentVerb[]): ContributedSubcommand {
  const help = agentsHelp(verbs);
  return Object.freeze({
    name: AGENTS_NAME,
    help,
    async run(args: readonly string[], client: CliApiClient, output: CliSubcommandOutput): Promise<number> {
      const [verb, ...rest] = args;
      if (verb === undefined || verb === AGENTS_HELP_VERB) {
        output.stdout.write(`${help}\n${verbs.length === 0 ? "no verbs yet\n" : ""}`);
        return 0;
      }
      const known = verbs.find((v) => v.name === verb);
      if (known === undefined) {
        output.stderr.write(`studio ${AGENTS_NAME}: unknown verb ${JSON.stringify(verb)}\n${help}\n`);
        return 2;
      }
      return known.run(rest, client, output);
    },
  });
}

/**
 * The contribution `parts` make: only the non-empty keys (`name` and
 * `subcommands` always; `tools`, `routes`, `handlers` and `dueWork` when a
 * part has some), like the other features. `dueWork` is the parts' due work
 * concatenated in part order.
 */
export function agentsContributionOf(parts: readonly AgentPart[]): FeatureContribution {
  const merged = mergeAgentParts(parts);
  const handlers = merged.handlers as Readonly<Record<string, EventHandler>>;
  return Object.freeze({
    name: AGENTS_NAME,
    ...(merged.tools.length > 0 ? { tools: merged.tools } : {}),
    ...(merged.routes.length > 0 ? { routes: merged.routes } : {}),
    subcommands: Object.freeze([agentsSubcommand(merged.verbs)]),
    ...(Object.keys(handlers).length > 0 ? { handlers } : {}),
    ...(merged.dueWork.length > 0 ? { dueWork: merged.dueWork } : {}),
  });
}

/** The shipped contribution: `AGENT_PARTS` merged at module load (the parts claim distinct verbs, so it does not throw). */
export const agentsContribution: FeatureContribution = agentsContributionOf(AGENT_PARTS);

/** The shipped `studio agents` help line: `studio agents <verb>`, then each verb's help without its `studio agents ` (one line, at most 200 characters). */
export const AGENTS_HELP: string = agentsHelp(mergeAgentParts(AGENT_PARTS).verbs);

export { charterToolsPart } from "./charter-tools.js";
export { delegatePart } from "./delegate.js";
export { rosterPart } from "./roster.js";
export { agentMemoryDir, ensureAgentMemoryFiles } from "./memory.js";
export type { EnsureAgentMemoryResult } from "./memory.js";
export { getAgent, isRoutable, listAgents } from "./registry.js";
export type { AgentRow } from "./registry.js";
export { agentSettingsPath, readAgentSettings } from "./settings.js";
export type { AgentLimits, AgentSettings, AgentSettingsRefusal, AgentSettingsResult, ReadAgentSettingsOptions } from "./settings.js";
export {
  AGENT_CREATED_BY,
  AGENT_ID_PATTERN,
  AGENT_STATUSES,
  AVATAR_HUES,
  AVATAR_SHAPES,
  MESSAGE_PHASE4_FIELDS,
  RESERVED_AGENT_IDS,
  isValidAgentId,
} from "./types.js";
export type { AgentCreatedBy, AgentMessageFields, AgentPart, AgentStatus, AgentVerb, AvatarHue, AvatarShape, MessagePhase4Field, ReservedAgentId } from "./types.js";
