// The agents feature's closed value sets, the phase 4 message fields and the
// shape of one part. Migration 14 stores these values as TEXT with no SQL
// CHECK, so the lists below are the only place they are closed: every reader
// and writer checks against them. An agent id is never reused, even after its
// row is `off`: the id names its memory folder, its settings file and every
// message it sent. Mechanism only (invariants 1 and 9): the kernel ships the
// vocabulary, never a crew member, a role preset or a default policy.
//
// Types only, plus the lists: the `studio` CLI loads this module (through
// `./index.ts` and `../features/index.ts`), so it never imports the Agent SDK,
// the session manager or `kernel.ts`.
import type { CliApiClient, CliSubcommandOutput, ContributedRoute, ContributedTool, DueWorkFn } from "../features/contribution.js";
import type { EventHandler, EventKind } from "../loop/types.js";

/** `agents.status`: a crew member takes work while `active`; `off` keeps its row, files and id. */
export const AGENT_STATUSES = Object.freeze(["active", "off"] as const);
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** `agents.created_by`: the owner made the row, or Wright drafted it and the owner approved it. */
export const AGENT_CREATED_BY = Object.freeze(["owner", "wright"] as const);
export type AgentCreatedBy = (typeof AGENT_CREATED_BY)[number];

/**
 * Ids no crew member may take: `wright` (the lead agent, reachable only
 * through its own explicit paths), `shared` (the `memory/shared/` folder) and
 * `_unassigned`.
 */
export const RESERVED_AGENT_IDS = Object.freeze(["wright", "shared", "_unassigned"] as const);
export type ReservedAgentId = (typeof RESERVED_AGENT_IDS)[number];

/** The id grammar: a lowercase letter, then up to 31 lowercase letters, digits or hyphens. */
export const AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * True for a crew member's id: it matches `AGENT_ID_PATTERN` and is not
 * reserved. `wright` is false here on purpose: Wright is reached only through
 * the explicit Wright paths (`readAgentSettings(dataDir, "wright")`,
 * `ensureAgentMemoryFiles(dataDir, "wright")`, `isRoutable`).
 */
export function isValidAgentId(id: unknown): id is string {
  return typeof id === "string" && AGENT_ID_PATTERN.test(id) && !(RESERVED_AGENT_IDS as readonly string[]).includes(id);
}

/** `agents.avatar_shape`: a sea creature per crew member. `whale` is Wright's and is not in the list. */
export const AVATAR_SHAPES = Object.freeze(["shark", "seahorse", "octopus", "turtle", "jellyfish", "fish", "crab"] as const);
export type AvatarShape = (typeof AVATAR_SHAPES)[number];

/** `agents.avatar_hue`: the `crew-*` identity tokens in `docs/design/tokens.json` (Wright alone wears the accent). */
export const AVATAR_HUES = Object.freeze(["crew-teal", "crew-sky", "crew-berry", "crew-olive", "crew-slate"] as const);
export type AvatarHue = (typeof AVATAR_HUES)[number];

/** The four `brain_messages` columns migration 14 adds, in the order it adds them. */
export const MESSAGE_PHASE4_FIELDS = Object.freeze(["from_agent", "depth", "reply_to", "workspace"] as const);
export type MessagePhase4Field = (typeof MESSAGE_PHASE4_FIELDS)[number];

/** The phase 4 fields of a `brain_messages` row. */
export interface AgentMessageFields {
  /** The sending agent's id; null for the owner or a trigger. */
  readonly from_agent: string | null;
  /** The delegation depth: 0 for a message that no agent delegated. */
  readonly depth: number;
  /** The `brain_messages.id` this message answers; null otherwise. */
  readonly reply_to: number | null;
  /** The folder the work is scoped to; null otherwise. */
  readonly workspace: string | null;
}

/**
 * A `studio agents <verb> …` verb: the `ContributedSubcommand` call shape.
 * `help` is one line, appended to the `studio agents` help line.
 */
export interface AgentVerb {
  readonly name: string;
  readonly help: string;
  run(args: readonly string[], client: CliApiClient, output: CliSubcommandOutput): Promise<number>;
}

/**
 * One sub-file's share of the agents contribution (`roster`, `delegate`,
 * `charter-tools`): its tools and routes, its `studio agents` verbs, its event
 * handlers and its due work (optional). `mergeAgentParts` (`./index.ts`) joins
 * the parts in `AGENT_PARTS` order; a verb or handler kind claimed by two
 * parts is refused at module load.
 */
export interface AgentPart {
  readonly name: string;
  readonly tools: readonly ContributedTool[];
  readonly routes: readonly ContributedRoute[];
  readonly verbs: readonly AgentVerb[];
  readonly handlers: Readonly<Partial<Record<EventKind, EventHandler>>>;
  /** Run once per loop tick, in part order (the contribution's `dueWork`). Absent: none. */
  readonly dueWork?: readonly DueWorkFn[];
}
