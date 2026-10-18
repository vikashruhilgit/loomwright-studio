// The playbooks feature's `drafts` part (phase 3 item 02): Wright drafts,
// updates, lists and disables playbooks; the owner lists, shows, sets any
// policy value and turns a playbook off. `./index.ts` merges this part with
// the others in `PLAYBOOK_PARTS` into the one `playbooks` contribution.
//
//   tools   kernel_playbook_create, _update, _list, _disable  (Wright: its own playbooks and its crew's)
//   routes  GET  /playbooks[?all=1]        {playbooks}: draft and enabled; all=1 adds disabled
//           GET  /playbooks/:ref           {playbook, versions, trigger}: by id or slug
//           POST /playbooks/:id/set        body {field, value}: the owner sets one policy value
//           POST /playbooks/:id/off        the owner turns it off (final for agents)
//   verbs   studio playbooks list | show | set | off   (each calls only its route)
//   due     once per Store: rewrite every mirror that differs from its row
//
// Every change goes through `./store.ts` in one transaction, then the
// playbook's markdown mirror (`./mirror.ts`) is rewritten from the row,
// outside the transaction: a crash between the two leaves a stale mirror that
// the due work rewrites after the restart. Tool input and every stored string
// are data (invariant 3): refusals are error results naming the field, and the
// verbs print stored text quoted, so no terminal escape reaches the owner.
//
// Tools follow the triggers feature's pattern (`../triggers/tools.ts`): the
// owning agent is the calling session's; create, update and disable run as a
// work step keyed `ctx.stepKey(idempotency_key)`, so a repeat returns the
// first result, except after the owner's off, which a repeat re-checks.
//
// Crew-owned playbooks (phase 4 item 08), one rule every part uses: a
// registered crew member's session never drafts (`refuseCrewDrafting`:
// create, update, disable, dry run and enable refuse `crew_cannot_draft`
// before anything is written); Wright drafts a playbook for an `active` crew
// member (create's `agent`), and manages any registered crew member's
// playbooks as well as its own (`mayManage`, `actingAgentFor`). An
// unregistered agent id is never crew: its own playbooks stay its own, and
// Wright's checks against them stay `not_owner`.
//
// The `studio` CLI loads this module: besides zod and `node:` builtins it
// imports only `../features/contribution.js`, `../loop/*`, `../tools/handoff.js`,
// the leaf `../agents/registry.js` (types and `Store` reads only),
// the triggers feature's public index and this feature's files, never the
// Agent SDK, the session manager or `kernel.ts`.
import { z } from "zod";
import { getAgent, isRoutable } from "../agents/registry.js";
import { defineTool } from "../features/contribution.js";
import type {
  CliApiClient,
  CliSubcommandOutput,
  ContributedRoute,
  ContributedRouteRequest,
  ContributedRouteResponse,
  ContributedTool,
  ContributedToolContext,
  DueWorkFn,
} from "../features/contribution.js";
import { errorMessage } from "../loop/internal.js";
import { runStep } from "../loop/steps.js";
import type { Store } from "../store/store.js";
import { MAX_CRON_LENGTH, TRIGGER_KINDS, formatZoned } from "../triggers/index.js";
import type { TriggerView } from "../triggers/index.js";
// A cycle by design (`./dry-run.ts` imports this module's shared helpers):
// both sides use the other's functions only when called, never at module load.
import { mirrorDryRunOf } from "./dry-run.js";
import { mirrorRelativePath, writePlaybookMirror } from "./mirror.js";
import {
  PLAYBOOK_POLICY_FIELDS,
  PlaybookError,
  createPlaybook,
  disablePlaybook,
  getPlaybook,
  linkedTriggerOf,
  listPlaybookVersions,
  listPlaybooks,
  parseOwnerPolicyValue,
  refuseIfOwnerTurnedOff,
  setPlaybookPolicy,
  updatePlaybook,
} from "./store.js";
import type { PlaybookChange, PlaybookRow } from "./store.js";
import { PLAYBOOK_PRIORITIES } from "./types.js";
import type { PlaybookPart, PlaybookVerb } from "./types.js";

export const PLAYBOOK_TOOL_NAMES = ["kernel_playbook_create", "kernel_playbook_update", "kernel_playbook_list", "kernel_playbook_disable"] as const;

/** The kernel host's zone: the mirror and the verbs show times in the owner's local time. */
function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// ---- The mirror after a change ------------------------------------------------

/**
 * Rewrite playbook `id`'s mirror from its current row and its last dry run
 * (`mirrorDryRunOf`; idempotent: identical bytes are not rewritten). Returns
 * the error message when the write failed: the change itself is committed,
 * and the due work rewrites the file after a restart. With
 * `resyncPlaybookMirrors`, the only mirror writer: the dry-run and enable
 * parts call it too.
 */
export function syncMirror(store: Store, id: number): string | null {
  try {
    const row = getPlaybook(store, id);
    if (row !== undefined) writePlaybookMirror(store.dataDir, row, linkedTriggerOf(store, row), hostTimeZone(), mirrorDryRunOf(store, row));
    return null;
  } catch (err) {
    return errorMessage(err);
  }
}

/**
 * Rewrite every playbook's mirror whose bytes differ from its row's rendering
 * (the row is the truth). One playbook's failure does not stop the others: they
 * all run, then one error naming every failure is thrown. Returns how many
 * files it wrote.
 */
export function resyncPlaybookMirrors(store: Store, timeZone: string = hostTimeZone()): number {
  let written = 0;
  const failures: string[] = [];
  for (const row of listPlaybooks(store, { all: true })) {
    try {
      if (writePlaybookMirror(store.dataDir, row, linkedTriggerOf(store, row), timeZone, mirrorDryRunOf(store, row))) written++;
    } catch (err) {
      failures.push(`playbook ${row.id}: ${errorMessage(err)}`);
    }
  }
  if (failures.length > 0) throw new Error(`playbook mirrors not rewritten: ${failures.join("; ")}`);
  return written;
}

/** The stores whose mirrors were resynced: once per `Store` (a restart opens a new one). */
const resynced = new WeakSet<Store>();

/** The part's due work: on the first tick of each new `Store`, resync every mirror. Appends no event. */
const resyncOnce: DueWorkFn = ({ store }) => {
  if (resynced.has(store)) return;
  const playbooks = listPlaybooks(store, { all: true });
  resynced.add(store);
  if (playbooks.length > 0) resyncPlaybookMirrors(store);
};

// ---- Wright's tools ---------------------------------------------------------

const idempotencyKey = z.string().min(1).max(200);

const triggerShape = z.object({
  kind: z.enum(TRIGGER_KINDS),
  spec: z.string().min(1).max(MAX_CRON_LENGTH),
  tz: z.string().min(1).max(64).optional(),
});

const policyShape = {
  dedupe_key: z.array(z.string().max(200)).max(20).optional(),
  priority: z.enum(PLAYBOOK_PRIORITIES).optional(),
  model: z.string().max(400).optional(),
  token_limit: z.number().int().optional(),
};

const REPEAT = "Repeating a call with the same idempotency_key in this session returns the first result, even if other arguments differ.";

const LIMITS =
  "The playbook is a draft the owner reviews: every policy value you give (dedupe_key, priority, model, token_limit) is a proposal the owner can change. " +
  "You cannot change a value the owner set, or a playbook the owner turned off (a repeat of this call then returns that error too). Enabling it is a separate step.";

/** The calling session's agent: the owner of the playbooks it drafts. Shared with the dry-run and enable parts. */
export function owningAgent(ctx: ContributedToolContext): string {
  const agent = ctx.sessions.getSession(ctx.sessionId)?.agent;
  if (typeof agent !== "string" || agent === "") {
    throw new PlaybookError("invalid_input", `session ${ctx.sessionId} runs no named agent; a playbook needs an owning agent`);
  }
  return agent;
}

/** Why a crew member's session is refused a drafting tool (the `crew_cannot_draft` detail; the enable's apply records it too). */
export const CREW_CANNOT_DRAFT_DETAIL = "crew members don't draft playbooks; Wright drafts a crew member's playbooks";

/**
 * The calling session's agent (`owningAgent`), unless it is a registered
 * crew member: then `PlaybookError("crew_cannot_draft")`. Keyed on the
 * `agents` row, never on `agent !== "wright"`: an unregistered agent id is
 * not crew and keeps its own playbooks. Every drafting tool (create, update,
 * disable, dry run, enable) calls it first, before anything is written.
 */
export function refuseCrewDrafting(ctx: ContributedToolContext): string {
  const agent = owningAgent(ctx);
  if (getAgent(ctx.store, agent) !== undefined) throw new PlaybookError("crew_cannot_draft", `crew_cannot_draft: ${CREW_CANNOT_DRAFT_DETAIL}`);
  return agent;
}

/**
 * Whether agent `caller` may act on a playbook `owner` owns: its own, or
 * Wright on a registered crew member's (`active` or `off`: Wright may list,
 * update or disable an off member's playbook; its dry run and fires refuse
 * `agent_off`). An unregistered owner is never Wright's to manage.
 */
export function mayManage(store: Store, caller: string, owner: string): boolean {
  return caller === owner || (caller === "wright" && getAgent(store, owner) !== undefined);
}

/**
 * The agent the store's owner check is run as for playbook `id`: its
 * `owning_agent` when the caller may manage it (`mayManage`), else the caller,
 * so the store refuses `not_owner` with its usual text (a missing playbook is
 * the store's `not_found`).
 */
export function actingAgentFor(ctx: ContributedToolContext, id: number): string {
  const caller = owningAgent(ctx);
  const owner = getPlaybook(ctx.store, id)?.owning_agent;
  return owner !== undefined && mayManage(ctx.store, caller, owner) ? owner : caller;
}

/**
 * The agent a create drafts for: the caller when `requested` is absent (or is
 * the caller, Wright); otherwise only Wright may name one, and it must be an
 * `active` registered crew member (`agent_off` for an `off` one,
 * `invalid_input` naming `agent` otherwise). Checked before the work step, so
 * a refusal writes nothing.
 */
function draftOwner(store: Store, caller: string, requested: string | undefined): string {
  if (requested === undefined) return caller;
  if (caller !== "wright") throw new PlaybookError("invalid_input", "agent: only Wright drafts a playbook for another agent");
  if (requested === "wright") return caller;
  if (getAgent(store, requested)?.status === "off") throw new PlaybookError("agent_off", `agent_off: ${requested} is off; turn it on before drafting its playbooks`);
  if (!isRoutable(store, requested)) throw new PlaybookError("invalid_input", `agent: ${JSON.stringify(requested)} is not an active registered crew member`);
  return requested;
}

/** Run `body`, prefixing a refusal's message with the tool name. */
export function named<T>(name: string, body: () => T): T {
  try {
    return body();
  } catch (err) {
    throw new Error(`${name}: ${errorMessage(err)}`);
  }
}

/** `named` for asynchronous work: a rejection's message is prefixed with the tool name. */
export async function namedAsync<T>(name: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (err) {
    throw new Error(`${name}: ${errorMessage(err)}`);
  }
}

/** What a tool returns for a change (stored as the work step's result). */
interface ToolResult {
  readonly id: number;
  readonly slug: string;
  readonly status: string;
  readonly version: number;
  readonly trigger_id: number | null;
  readonly next_fire_at: string | null;
  readonly changed: boolean;
  /** The mirror's path relative to the data dir. */
  readonly mirror: string;
}

function resultOf(change: PlaybookChange): ToolResult {
  const p = change.playbook;
  return {
    id: p.id,
    slug: p.slug,
    status: p.status,
    version: p.version,
    trigger_id: change.trigger?.id ?? null,
    next_fire_at: change.trigger?.next_fire_at ?? null,
    changed: change.changed,
    mirror: mirrorRelativePath(p.slug),
  };
}

/**
 * After a tool's step on playbook `id`: refuse a repeat the owner's off
 * overtook, rewrite the mirror, and say if that failed (`mirror_error`, never
 * a throw). Shared with the dry-run and enable parts.
 */
export function afterPlaybookStep<T extends object>(ctx: ContributedToolContext, id: number, result: T): T & { readonly mirror_error?: string } {
  refuseIfOwnerTurnedOff(ctx.store, id);
  const failed = syncMirror(ctx.store, id);
  return failed === null ? result : { ...result, mirror_error: `the change is stored; its mirror was not written (${failed}); the kernel rewrites it after a restart` };
}

/** After the step: refuse a repeat the owner's off overtook, rewrite the mirror, and say if that failed. */
function afterStep(ctx: ContributedToolContext, result: ToolResult): ToolResult & { readonly mirror_error?: string } {
  return afterPlaybookStep(ctx, result.id, result);
}

const create = defineTool({
  name: "kernel_playbook_create",
  description:
    "Draft a playbook: recurring work you will do for the owner. name: a short title (its slug, the mirror's file name, comes from it once). " +
    "intent: what to do, in plain words. trigger: {kind: once, spec: an ISO-8601 instant WITH a time zone} or {kind: cron, spec: a 5-field cron expression, tz: an IANA zone}; " +
    `it becomes the playbook's one linked trigger, which starts no work until the playbook is enabled. dedupe_key: fields from playbook.id, playbook.version, trigger.id, trigger.scheduled_at, date. ` +
    `priority: low, normal or high. model: a model id. token_limit: tokens per day. ${LIMITS} ` +
    "agent (optional): the id of an active crew member to draft it for; it then belongs to that member, and its dry run and every fire run as that member " +
    "(its settings, policy and never list, its memory folder and its limits). Omitted: the playbook is yours. " +
    "Returns {id, slug, status: draft, version: 1, trigger_id, next_fire_at (UTC), mirror}: mirror is the markdown file (under the Studio data dir) the owner reads. " +
    REPEAT,
  shape: {
    name: z.string().max(400),
    intent: z.string().max(4_000),
    trigger: triggerShape,
    ...policyShape,
    agent: z.string().max(64).optional(),
    idempotency_key: idempotencyKey,
  },
  handler: (a, ctx) =>
    named("kernel_playbook_create", () => {
      const agent = draftOwner(ctx.store, refuseCrewDrafting(ctx), a.agent);
      const first = runStep(
        ctx.store,
        ctx.stepKey(a.idempotency_key),
        () =>
          resultOf(
            createPlaybook(
              ctx.store,
              {
                agent,
                name: a.name,
                intent: a.intent,
                trigger: a.trigger,
                dedupe_key: a.dedupe_key,
                priority: a.priority,
                model: a.model,
                token_limit: a.token_limit,
                sessionId: ctx.sessionId,
              },
              ctx.now(),
            ),
          ),
        { now: ctx.now },
      );
      return afterStep(ctx, first);
    }),
});

const update = defineTool({
  name: "kernel_playbook_update",
  description:
    "Change a playbook you own, or (Wright) one of a registered crew member's: changes gives any of name, intent, trigger, dedupe_key, priority, model, token_limit (same forms as kernel_playbook_create; at least one). " +
    "A change makes a new version, and an enabled playbook goes back to draft for the owner to review. A trigger change re-schedules the same linked trigger. " +
    `${LIMITS} Returns {id, slug, status, version, trigger_id, next_fire_at, changed, mirror}. ${REPEAT}`,
  shape: {
    id: z.number().int().positive(),
    changes: z.object({ name: z.string().max(400).optional(), intent: z.string().max(4_000).optional(), trigger: triggerShape.optional(), ...policyShape }),
    idempotency_key: idempotencyKey,
  },
  handler: (a, ctx) =>
    named("kernel_playbook_update", () => {
      refuseCrewDrafting(ctx);
      const agent = actingAgentFor(ctx, a.id);
      const first = runStep(
        ctx.store,
        ctx.stepKey(a.idempotency_key),
        () => resultOf(updatePlaybook(ctx.store, { id: a.id, agent, changes: a.changes, sessionId: ctx.sessionId }, ctx.now())),
        { now: ctx.now },
      );
      return afterStep(ctx, first);
    }),
});

const list = defineTool({
  name: "kernel_playbook_list",
  description:
    "List the playbooks you own (Wright: and every registered crew member's), every status (draft, enabled, disabled), in id order, each with its owning_agent, " +
    "its policy values (and who set each: wright = proposed, owner = the owner's), its linked trigger_id and next_fire_at (UTC).",
  shape: {},
  handler: (_a, ctx) => named("kernel_playbook_list", () => ({ playbooks: listFor(ctx) })),
});

/** The caller's own playbooks; for Wright, also every registered crew member's (never an unregistered agent's). */
function listFor(ctx: ContributedToolContext): ReturnType<typeof listPlaybooks> {
  const caller = owningAgent(ctx);
  if (caller !== "wright") return listPlaybooks(ctx.store, { all: true, agent: caller });
  return listPlaybooks(ctx.store, { all: true }).filter((p) => p.owning_agent === "wright" || getAgent(ctx.store, p.owning_agent) !== undefined);
}

const disable = defineTool({
  name: "kernel_playbook_disable",
  description:
    "Turn off a playbook you own, or (Wright) one of a registered crew member's (not one the owner turned off). Its trigger then starts no work. " +
    `Returns {id, slug, status: disabled, version, changed, mirror}. ${REPEAT}`,
  shape: { id: z.number().int().positive(), idempotency_key: idempotencyKey },
  handler: (a, ctx) =>
    named("kernel_playbook_disable", () => {
      refuseCrewDrafting(ctx);
      const agent = actingAgentFor(ctx, a.id);
      const first = runStep(
        ctx.store,
        ctx.stepKey(a.idempotency_key),
        () => resultOf(disablePlaybook(ctx.store, { id: a.id, by: "wright", agent, sessionId: ctx.sessionId }, ctx.now())),
        { now: ctx.now },
      );
      return afterStep(ctx, first);
    }),
});

/** The four tools, in `PLAYBOOK_TOOL_NAMES` order. */
export const playbookTools: readonly ContributedTool[] = Object.freeze([create, update, list, disable]);

// ---- The owner's routes -------------------------------------------------------

const ID = /^[1-9]\d{0,15}$/;

function idOf(req: ContributedRouteRequest): number | undefined {
  const raw = req.params.id ?? "";
  const id = Number(raw);
  return ID.test(raw) && Number.isSafeInteger(id) ? id : undefined;
}

/** An owner's change answered: the row after it (and its mirror rewritten), or the refusal. */
function answer(change: () => PlaybookChange, store: Store): ContributedRouteResponse {
  try {
    const { playbook, changed } = change();
    const failed = syncMirror(store, playbook.id);
    return { status: 200, body: { playbook, changed, ...(failed === null ? {} : { mirror_error: failed }) } };
  } catch (err) {
    if (!(err instanceof PlaybookError)) throw err;
    if (err.code === "not_found") return { status: 404, body: { error: "not_found" } };
    if (err.code === "invalid_input") return { status: 400, body: { error: "invalid_input", message: err.message } };
    return { status: 409, body: { error: err.code, message: err.message } };
  }
}

function isBodyObject(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

export const playbookRoutes: readonly ContributedRoute[] = Object.freeze([
  {
    method: "GET",
    path: "/playbooks",
    handler: async (req) => ({ status: 200, body: { playbooks: listPlaybooks(req.store, { all: req.query.all === "1" || req.query.all === "true" }) } }),
  },
  {
    method: "GET",
    path: "/playbooks/:ref",
    handler: async (req) => {
      const playbook = getPlaybook(req.store, req.params.ref ?? "");
      if (playbook === undefined) return { status: 404, body: { error: "not_found" } };
      const versions = listPlaybookVersions(req.store, playbook.id).map((v) => ({ version: v.version, created_at: v.created_at }));
      return { status: 200, body: { playbook, versions, trigger: linkedTriggerOf(req.store, playbook) } };
    },
  },
  {
    method: "POST",
    path: "/playbooks/:id/set",
    handler: async (req) => {
      const id = idOf(req);
      if (id === undefined) return { status: 400, body: { error: "invalid_id" } };
      if (!isBodyObject(req.body)) return { status: 400, body: { error: "invalid_body" } };
      const { field, value } = req.body;
      if (typeof field !== "string" || typeof value !== "string") {
        return { status: 400, body: { error: "invalid_body", message: "the body is {field, value}, both strings (value as typed on the CLI; none clears)" } };
      }
      return answer(() => {
        const parsed = parseOwnerPolicyValue(field, value);
        return setPlaybookPolicy(req.store, { id, field: parsed.field, value: parsed.value }, req.now());
      }, req.store);
    },
  },
  {
    method: "POST",
    path: "/playbooks/:id/off",
    handler: async (req) => {
      const id = idOf(req);
      if (id === undefined) return { status: 400, body: { error: "invalid_id" } };
      if (req.body !== undefined && !isBodyObject(req.body)) return { status: 400, body: { error: "invalid_body" } };
      return answer(() => disablePlaybook(req.store, { id, by: "owner" }, req.now()), req.store);
    },
  },
]);

// ---- The owner's verbs ----------------------------------------------------------

export const PLAYBOOK_VERB_HELP = Object.freeze({
  list: "studio playbooks list [--all] [--json]",
  show: "studio playbooks show <id|slug> [--json]",
  set: "studio playbooks set <id> <field> <value>",
  off: "studio playbooks off <id>",
});

export interface PlaybookVerbDeps {
  /** The zone times are shown in. Defaults to the host's local zone. */
  readonly timeZone?: string;
}

/** Text from the store as one safe terminal token: JSON-quoted, C0/C1 controls and bidi overrides replaced (`formatTriggers`' rule). */
function quoted(value: unknown): string {
  return JSON.stringify(String(value)).replace(/[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "?");
}

/** A name or code from the store, printed bare unless it needs quoting. */
function bare(value: unknown): string {
  const s = String(value ?? "-");
  return /^[\w.:@/+-]{1,200}$/.test(s) ? s : quoted(s);
}

/** A kernel message (a refusal) as one safe line. */
function messageLine(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "?");
}

function parseId(raw: string | undefined): number | undefined {
  if (raw === undefined || !ID.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** `flags` is a set of distinct entries from `allowed`; `undefined` otherwise. */
function flagsOf(args: readonly string[], allowed: readonly string[]): Set<string> | undefined {
  const flags = new Set(args);
  return flags.size === args.length && [...flags].every((f) => allowed.includes(f)) ? flags : undefined;
}

type PlaybookLike = Partial<Record<keyof PlaybookRow | "trigger_id" | "next_fire_at", unknown>>;

/** One policy value for the owner (already safe to print), then `(proposed)` or `(set by owner)`; `not set` when null. */
function policyText(shownValue: string | null, setBy: unknown): string {
  if (shownValue === null) return "not set";
  return `${shownValue}${setBy === "wright" ? " (proposed)" : setBy === "owner" ? " (set by owner)" : ""}`;
}

function shownOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : bare(value);
}

/** A stored dedupe key (a JSON array) as the owner types it: the fields joined with `,`, each bare. */
function dedupeText(spec: unknown): string | null {
  if (spec === null || spec === undefined) return null;
  try {
    const fields = JSON.parse(String(spec)) as unknown;
    if (Array.isArray(fields)) return fields.map(bare).join(",");
  } catch {
    // Unreadable: shown as stored.
  }
  return bare(spec);
}

function specText(t: Partial<Record<keyof TriggerView, unknown>>): string {
  const spec = (typeof t.spec === "object" && t.spec !== null ? t.spec : {}) as { at?: unknown; cron?: unknown; tz?: unknown };
  if (t.kind === "once") return `once at ${bare(spec.at)}`;
  if (t.kind === "cron") return `cron ${quoted(spec.cron)} in ${bare(spec.tz)}`;
  return `${bare(t.kind)} ${quoted(JSON.stringify(t.spec ?? null))}`;
}

function timeIn(tz: string): (value: unknown) => string {
  return (value) => {
    if (typeof value !== "string") return "-";
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? formatZoned(ms, tz) : quoted(value);
  };
}

/** The playbook list, one line per playbook, times in zone `tz`. */
export function formatPlaybooks(playbooks: readonly PlaybookLike[], tz: string, all: boolean): string {
  if (playbooks.length === 0) return all ? "no playbooks\n" : "no draft or enabled playbooks (studio playbooks list --all lists disabled ones too)\n";
  const time = timeIn(tz);
  const lines = playbooks.map(
    (p) =>
      `#${bare(p.id)} ${bare(p.slug)} ${quoted(p.name)}: ${bare(p.status)}, version ${bare(p.version)}, agent ${bare(p.owning_agent)}; ` +
      (p.trigger_id == null ? "no trigger" : `trigger #${bare(p.trigger_id)}, next fire ${time(p.next_fire_at)}`),
  );
  return `${lines.join("\n")}\n`;
}

/** One playbook in full: its row, its linked trigger and its versions, times in zone `tz`. */
export function formatPlaybook(body: { playbook?: PlaybookLike; versions?: unknown; trigger?: unknown }, tz: string): string {
  const p = body.playbook ?? {};
  const time = timeIn(tz);
  const t = (typeof body.trigger === "object" && body.trigger !== null ? body.trigger : null) as Partial<Record<keyof TriggerView, unknown>> | null;
  const versions = Array.isArray(body.versions) ? (body.versions as { version?: unknown; created_at?: unknown }[]) : [];
  const lines = [
    `#${bare(p.id)} ${bare(p.slug)} ${quoted(p.name)}: ${bare(p.status)}, version ${bare(p.version)}, agent ${bare(p.owning_agent)}`,
    `  intent: ${quoted(p.intent)}`,
    t === null ? "  trigger: none" : `  trigger #${bare(t.id)}: ${specText(t)}; ${t.enabled === true ? "on" : "off"}; next fire ${time(t.next_fire_at)}`,
    `  dedupe key: ${policyText(dedupeText(p.dedupe_key_spec), p.dedupe_key_set_by)}`,
    `  priority: ${policyText(shownOrNull(p.priority), p.priority_set_by)}`,
    `  model: ${policyText(shownOrNull(p.model), p.model_set_by)}`,
    `  token limit per day: ${policyText(shownOrNull(p.token_limit_per_day), p.token_limit_set_by)}`,
    `  effort: ${policyText(shownOrNull(p.effort), p.effort_set_by)}`,
    `  api-key fallback: ${policyText(shownOrNull(p.api_key_fallback_json), p.api_key_fallback_set_by)}`,
    `  versions: ${versions.length === 0 ? "-" : versions.map((v) => `${bare(v.version)} (${time(v.created_at)})`).join(", ")}`,
    `  created ${time(p.created_at)}; updated ${time(p.updated_at)}`,
  ];
  if (typeof p.slug === "string") {
    try {
      lines.push(`  mirror: ${mirrorRelativePath(p.slug)} (under the Studio data dir; edits there are not read)`);
    } catch {
      // A slug that is not a file name has no mirror.
    }
  }
  return `${lines.join("\n")}\n`;
}

function errorOf(body: unknown): string {
  const error = (isBodyObject(body) ? body.error : undefined) ?? "unknown";
  return typeof error === "string" && /^[a-z_]{1,64}$/.test(error) ? error : "unknown";
}

/** A refusal's text: its `message` when it has one, else its `error` code. */
function refusalOf(body: unknown): string {
  const message = isBodyObject(body) ? body.message : undefined;
  return typeof message === "string" ? messageLine(message) : errorOf(body);
}

/** The answer to a change, as one line on stdout (0) or stderr (1). */
function reportChange(
  res: { readonly status: number; readonly body: unknown },
  ref: string,
  method: string,
  path: string,
  out: CliSubcommandOutput,
  ok: (playbook: PlaybookLike, changed: boolean) => string,
): number {
  if (res.status === 200) {
    const { playbook, changed } = (isBodyObject(res.body) ? res.body : {}) as { playbook?: PlaybookLike; changed?: unknown };
    out.stdout.write(`studio: ${ok(playbook ?? {}, changed !== false)}\n`);
    return 0;
  }
  if (res.status === 404) out.stderr.write(`studio: no playbook ${ref}\n`);
  else if (res.status === 400 || res.status === 409) out.stderr.write(`studio: playbook ${ref} not changed: ${refusalOf(res.body)}\n`);
  else out.stderr.write(`studio: kernel API answered ${res.status} to ${method} ${path}\n`);
  return 1;
}

/** One stderr line and exit 2: a usage error, before any API call. */
function usage(out: CliSubcommandOutput, line: string): number {
  out.stderr.write(`${line}\n`);
  return 2;
}

/**
 * The owner's `studio playbooks` verbs: `list`, `show`, `set`, `off`, each
 * calling only its route. `deps` replace the owner's time zone (tests use a
 * fixed one; the shipped part uses the host's).
 */
export function playbookVerbs(deps: PlaybookVerbDeps = {}): readonly PlaybookVerb[] {
  const zone = (): string => deps.timeZone ?? hostTimeZone();

  const listVerb: PlaybookVerb = {
    name: "list",
    help: PLAYBOOK_VERB_HELP.list,
    async run(args: readonly string[], client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
      const flags = flagsOf(args, ["--all", "--json"]);
      if (flags === undefined) return usage(out, `usage: ${PLAYBOOK_VERB_HELP.list}`);
      const path = flags.has("--all") ? "/playbooks?all=1" : "/playbooks";
      const res = await client.request("GET", path);
      if (res.status !== 200) {
        out.stderr.write(`studio: kernel API answered ${res.status} to GET ${path}\n`);
        return 1;
      }
      const playbooks = isBodyObject(res.body) ? res.body.playbooks : undefined;
      if (!Array.isArray(playbooks)) {
        out.stderr.write(`studio: kernel API sent an unreadable answer to GET ${path}\n`);
        return 1;
      }
      out.stdout.write(flags.has("--json") ? `${JSON.stringify(res.body, null, 2)}\n` : formatPlaybooks(playbooks as PlaybookLike[], zone(), flags.has("--all")));
      return 0;
    },
  };

  const showVerb: PlaybookVerb = {
    name: "show",
    help: PLAYBOOK_VERB_HELP.show,
    async run(args, client, out) {
      const [ref, ...rest] = args;
      const flags = flagsOf(rest, ["--json"]);
      if (ref === undefined || ref === "" || ref.startsWith("-") || flags === undefined) return usage(out, `usage: ${PLAYBOOK_VERB_HELP.show}`);
      const path = `/playbooks/${encodeURIComponent(ref)}`;
      const res = await client.request("GET", path);
      if (res.status === 404) {
        out.stderr.write(`studio: no playbook ${quoted(ref)}\n`);
        return 1;
      }
      if (res.status !== 200 || !isBodyObject(res.body) || !isBodyObject(res.body.playbook)) {
        out.stderr.write(res.status === 200 ? `studio: kernel API sent an unreadable answer to GET ${path}\n` : `studio: kernel API answered ${res.status} to GET ${path}\n`);
        return 1;
      }
      out.stdout.write(flags.has("--json") ? `${JSON.stringify(res.body, null, 2)}\n` : formatPlaybook(res.body as { playbook?: PlaybookLike }, zone()));
      return 0;
    },
  };

  const setVerb: PlaybookVerb = {
    name: "set",
    help: PLAYBOOK_VERB_HELP.set,
    async run(args, client, out) {
      const [rawId, field, value, ...rest] = args;
      const id = parseId(rawId);
      if (id === undefined || field === undefined || value === undefined || rest.length > 0) {
        return usage(out, `usage: ${PLAYBOOK_VERB_HELP.set} (field: ${PLAYBOOK_POLICY_FIELDS.join(", ")}; none clears)`);
      }
      if (!(PLAYBOOK_POLICY_FIELDS as readonly string[]).includes(field)) {
        return usage(out, `studio playbooks set: unknown field ${quoted(field)} (one of ${PLAYBOOK_POLICY_FIELDS.join(", ")})`);
      }
      try {
        parseOwnerPolicyValue(field, value);
      } catch (err) {
        return usage(out, `studio playbooks set: ${messageLine(errorMessage(err))}`);
      }
      const path = `/playbooks/${id}/set`;
      const res = await client.request("POST", path, { field, value });
      return reportChange(res, String(id), "POST", path, out, (p, changed) =>
        changed ? `playbook ${id} ${field} set to ${bare(value)} (version ${bare(p.version)})` : `playbook ${id} ${field} was already ${bare(value)}`,
      );
    },
  };

  const offVerb: PlaybookVerb = {
    name: "off",
    help: PLAYBOOK_VERB_HELP.off,
    async run(args, client, out) {
      const id = parseId(args[0]);
      if (id === undefined || args.length !== 1) return usage(out, `usage: ${PLAYBOOK_VERB_HELP.off}`);
      const path = `/playbooks/${id}/off`;
      const res = await client.request("POST", path);
      return reportChange(res, String(id), "POST", path, out, (_p, changed) => (changed ? `playbook ${id} turned off` : `playbook ${id} was already off`));
    },
  };

  return Object.freeze([listVerb, showVerb, setVerb, offVerb]);
}

export const draftsPart: PlaybookPart = Object.freeze({
  name: "drafts",
  tools: playbookTools,
  routes: playbookRoutes,
  verbs: playbookVerbs(),
  handlers: Object.freeze({}),
  dueWork: Object.freeze<DueWorkFn[]>([resyncOnce]),
});
