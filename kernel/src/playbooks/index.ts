// The `playbooks` feature (phase 3): one contribution built from one part per
// sub-file, so each phase 3 item edits only the sub-file(s) it owns: item 02
// `drafts.ts`, item 07 `dry-run.ts` and `enable.ts`, item 08 `runs.ts`.
// Every part is empty until its item fills it in; today the contribution is
// the one `studio playbooks` subcommand, with no verbs. Mechanism only
// (invariant 1): no playbook ships preinstalled. `startKernel` and `runCli`
// merge it through `SHIPPED_CONTRIBUTIONS` (`../features/index.ts`).
//
// The `studio` CLI loads it, so it imports only types and zod and the feature
// seam: never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import { ContributionConflictError, InvalidContributionError } from "../features/contribution.js";
import type {
  CliApiClient,
  CliSubcommandOutput,
  ContributedRoute,
  ContributedSubcommand,
  ContributedTool,
  FeatureContribution,
} from "../features/contribution.js";
import type { EventHandler, EventKind } from "../loop/types.js";
import { draftsPart } from "./drafts.js";
import { dryRunPart } from "./dry-run.js";
import { enablePart } from "./enable.js";
import { runsPart } from "./runs.js";
import type { PlaybookPart, PlaybookVerb } from "./types.js";

/** The contribution's name, and the `studio playbooks` command word. */
export const PLAYBOOKS_NAME = "playbooks";

/** The verb that prints the help, whatever the parts register (a part may not claim it). */
export const PLAYBOOKS_HELP_VERB = "help";

/** Every part, in merge order: tools, routes and verbs keep this order. */
export const PLAYBOOK_PARTS: readonly PlaybookPart[] = Object.freeze([draftsPart, dryRunPart, enablePart, runsPart]);

/** The parts joined: tools and routes in part order, the verbs of the one subcommand, the handlers. */
export interface MergedPlaybookParts {
  readonly tools: readonly ContributedTool[];
  readonly routes: readonly ContributedRoute[];
  readonly verbs: readonly PlaybookVerb[];
  readonly handlers: Readonly<Partial<Record<EventKind, EventHandler>>>;
}

/**
 * Join `parts` in order. Throws `ContributionConflictError` naming both parts
 * as owners when two parts claim one verb (`part: "subcommand"`, the name
 * `playbooks <verb>`) or one handler kind (`part: "handler"`), and
 * `InvalidContributionError` for a verb named `help` (the built-in help).
 * Tools and routes are checked by `mergeContributions`, like any feature's.
 */
export function mergePlaybookParts(parts: readonly PlaybookPart[]): MergedPlaybookParts {
  const verbOwners = new Map<string, string>();
  const handlerOwners = new Map<string, string>();
  const tools: ContributedTool[] = [];
  const routes: ContributedRoute[] = [];
  const verbs: PlaybookVerb[] = [];
  const handlers: Partial<Record<EventKind, EventHandler>> = {};
  for (const part of parts) {
    tools.push(...part.tools);
    routes.push(...part.routes);
    for (const verb of part.verbs) {
      if (verb.name === PLAYBOOKS_HELP_VERB) {
        throw new InvalidContributionError(PLAYBOOKS_NAME, "subcommand", `part ${part.name}: the verb "${PLAYBOOKS_HELP_VERB}" is the built-in help`);
      }
      const first = verbOwners.get(verb.name);
      if (first !== undefined) throw new ContributionConflictError("subcommand", `${PLAYBOOKS_NAME} ${verb.name}`, [first, part.name]);
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
  return Object.freeze({ tools: Object.freeze(tools), routes: Object.freeze(routes), verbs: Object.freeze(verbs), handlers: Object.freeze(handlers) });
}

/** `studio playbooks <verb>`, then each verb's help line, joined with ` | ` (one line). */
export function playbooksHelp(verbs: readonly PlaybookVerb[]): string {
  return [`studio ${PLAYBOOKS_NAME} <verb>`, ...verbs.map((v) => v.help)].join(" | ");
}

/**
 * The `studio playbooks` subcommand over `verbs`. No verb, or `help`: the help
 * line (then `no verbs yet` when there are none) on stdout, 0. An unknown
 * verb: one line naming it, then the help, on stderr, 2. A known verb runs
 * with the remaining args. The shell itself never calls the API.
 */
export function playbooksSubcommand(verbs: readonly PlaybookVerb[]): ContributedSubcommand {
  const help = playbooksHelp(verbs);
  return Object.freeze({
    name: PLAYBOOKS_NAME,
    help,
    async run(args: readonly string[], client: CliApiClient, output: CliSubcommandOutput): Promise<number> {
      const [verb, ...rest] = args;
      if (verb === undefined || verb === PLAYBOOKS_HELP_VERB) {
        output.stdout.write(`${help}\n${verbs.length === 0 ? "no verbs yet\n" : ""}`);
        return 0;
      }
      const known = verbs.find((v) => v.name === verb);
      if (known === undefined) {
        output.stderr.write(`studio ${PLAYBOOKS_NAME}: unknown verb ${JSON.stringify(verb)}\n${help}\n`);
        return 2;
      }
      return known.run(rest, client, output);
    },
  });
}

/**
 * The contribution `parts` make: only the non-empty keys (today `name` and
 * `subcommands`), like the phase 2 features. Never `dueWork`: a part has none.
 */
export function playbooksContributionOf(parts: readonly PlaybookPart[]): FeatureContribution {
  const merged = mergePlaybookParts(parts);
  const handlers = merged.handlers as Readonly<Record<string, EventHandler>>;
  return Object.freeze({
    name: PLAYBOOKS_NAME,
    ...(merged.tools.length > 0 ? { tools: merged.tools } : {}),
    ...(merged.routes.length > 0 ? { routes: merged.routes } : {}),
    subcommands: Object.freeze([playbooksSubcommand(merged.verbs)]),
    ...(Object.keys(handlers).length > 0 ? { handlers } : {}),
  });
}

/** The shipped contribution: `PLAYBOOK_PARTS` merged at module load (four empty parts cannot throw). */
export const playbooksContribution: FeatureContribution = playbooksContributionOf(PLAYBOOK_PARTS);

/** The shipped `studio playbooks` help line (today exactly `studio playbooks <verb>`). */
export const PLAYBOOKS_HELP: string = playbooksHelp(mergePlaybookParts(PLAYBOOK_PARTS).verbs);

export { draftsPart } from "./drafts.js";
export { dryRunPart } from "./dry-run.js";
export { enablePart } from "./enable.js";
export { runsPart } from "./runs.js";
export { DEDUPE_KEY_FIELDS, PLAYBOOK_PRIORITIES, PLAYBOOK_RUN_KINDS, PLAYBOOK_STATUSES, POLICY_SETTERS } from "./types.js";
export type { DedupeKeyField, PlaybookPart, PlaybookPriority, PlaybookRunKind, PlaybookStatus, PlaybookVerb, PolicySetter } from "./types.js";
