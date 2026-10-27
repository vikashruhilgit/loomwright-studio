// The playbooks feature's closed value sets and the shape of one part
// (phase 3). Migration 13 stores these values as TEXT with no SQL CHECK, so
// the lists below are the only place they are closed: every reader and
// writer checks against them. Mechanism only (invariant 1): the kernel ships
// the vocabulary, never a playbook or a default policy.
//
// Types only, plus the lists: the `studio` CLI loads this module (through
// `./index.ts` and `../features/index.ts`), so it never imports the Agent SDK,
// the session manager or `kernel.ts`.
import type { CliApiClient, CliSubcommandOutput, ContributedRoute, ContributedTool, DueWorkFn } from "../features/contribution.js";
import type { EventHandler, EventKind } from "../loop/types.js";

/** `playbooks.status`: a playbook is a draft until the owner enables it. */
export const PLAYBOOK_STATUSES = Object.freeze(["draft", "enabled", "disabled"] as const);
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number];

/** `playbooks.priority` (and `event_queue.priority`). */
export const PLAYBOOK_PRIORITIES = Object.freeze(["low", "normal", "high"] as const);
export type PlaybookPriority = (typeof PLAYBOOK_PRIORITIES)[number];

/** `playbook_runs.kind`: a dry run, a trigger firing, or the owner's "run now". */
export const PLAYBOOK_RUN_KINDS = Object.freeze(["dry_run", "fire", "run_now"] as const);
export type PlaybookRunKind = (typeof PLAYBOOK_RUN_KINDS)[number];

/**
 * The fields a playbook's dedupe key may be built from (`playbooks.dedupe_key_spec`); the user picks which.
 * `item.id` / `item.revision` are a polled item's (`SourceItem.ref` / `.revision`, phase 6): a fire that
 * carries no item refuses a key naming them (`evaluateDedupeKey`), never leaves them out.
 */
export const DEDUPE_KEY_FIELDS = Object.freeze(["playbook.id", "playbook.version", "trigger.id", "trigger.scheduled_at", "date", "item.id", "item.revision"] as const);
export type DedupeKeyField = (typeof DEDUPE_KEY_FIELDS)[number];

/** Who set a policy field (every `playbooks.*_set_by`): Wright proposed it, or the owner set it. Null while the field is unset. */
export const POLICY_SETTERS = Object.freeze(["wright", "owner"] as const);
export type PolicySetter = (typeof POLICY_SETTERS)[number];

/**
 * `playbooks.mode` (migration 17, default `draft`): `draft` records each outward
 * call instead of sending it; `live` sends. Phase 6 refuses `live`
 * (`live_mode_not_in_phase_6`, `./store.ts`).
 */
export const PLAYBOOK_MODES = Object.freeze(["draft", "live"] as const);
export type PlaybookMode = (typeof PLAYBOOK_MODES)[number];

/**
 * A `studio playbooks <verb> …` verb: the `ContributedSubcommand` call shape.
 * `help` is one line, appended to the `studio playbooks` help line.
 */
export interface PlaybookVerb {
  readonly name: string;
  readonly help: string;
  run(args: readonly string[], client: CliApiClient, output: CliSubcommandOutput): Promise<number>;
}

/**
 * One sub-file's share of the playbooks contribution (`drafts`, `dry-run`,
 * `enable`, `runs`): its tools and routes, its `studio playbooks` verbs, its
 * event handlers and its due work (optional). `mergePlaybookParts`
 * (`./index.ts`) joins the parts in `PLAYBOOK_PARTS` order; a verb or handler
 * kind claimed by two parts is refused at module load.
 */
export interface PlaybookPart {
  readonly name: string;
  readonly tools: readonly ContributedTool[];
  readonly routes: readonly ContributedRoute[];
  readonly verbs: readonly PlaybookVerb[];
  readonly handlers: Readonly<Partial<Record<EventKind, EventHandler>>>;
  /** Run once per loop tick, in part order (the contribution's `dueWork`). Absent: none. */
  readonly dueWork?: readonly DueWorkFn[];
}
