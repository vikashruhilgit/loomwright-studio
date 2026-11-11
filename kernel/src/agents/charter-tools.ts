// The agents feature's `charter-tools` part (phase 4 item 07): Wright drafts
// a crew member's charter (or a change to one), the owner approves it once,
// and the kernel creates (or changes) the member itself, in the decision's
// transaction (`applyOnApproval`; `KERNEL_APPLIED_ACTIONS`). A crew member
// exists only through a charter the owner saw (D22, invariant 9). `./index.ts`
// merges every part in `AGENT_PARTS` into the one `agents` contribution; only
// this file defines this part.
//
//   tool  kernel_agent_create(charter, idempotency_key)                         (Wright only; always held)
//   tool  kernel_agent_update(id, changes, expected_sha256, idempotency_key)    (Wright only; always held)
//   tool  kernel_agent_list()                                                  (read-only; not held)
//
// Every call to the first two is held for the owner by the kernel's PreToolUse
// rail (`ALWAYS_HELD_TOOLS` in `../sessions/policy.ts`), never by this part.
// Each has three parts:
//
// - `beforeHold`, which the gate asks before it holds the call (it can only
//   narrow, and reads the store and files only): a caller that is not Wright
//   (`not_lead`; the caller is the session's agent, never the tool input), an
//   idempotency key an earlier approval of this session used for this tool, a
//   charter `validateCharter` refuses, a taken id, or (update) a reserved,
//   unknown or `off` member, a settings file whose bytes no longer hash to
//   `expected_sha256` or a change that changes nothing is refused, so no
//   approval is written; otherwise the call is held with a display for
//   `studio approvals`. The display's enforced lines (`never`, tools, Bash
//   prefixes, limits, workspaces) are generated here from the PARSED charter,
//   never copied from its prose, and come first, after only the granted
//   kernel tools grouped by job in plain words (`jobDisplayLines`, from the
//   kernel's tool catalogue on the context; the raw names stay on the
//   enforced line; each job's tools' purpose lines when they fit, else the job
//   labels alone, so the job lines never grow with the number of granted
//   tools); a call whose head (create) or whose whole display (update:
//   the job lines, the field lines and the enforced
//   line) would not fit in `MAX_APPROVAL_DISPLAY` is refused `invalid_input`,
//   so the 4,000 characters `studio approvals` lists before its "more
//   characters not shown" mark always hold them (the display itself is stored
//   whole, up to `MAX_REQUEST_PAYLOAD_JSON`). The hold names its subject
//   (`agent:<member id>`), so a newer charter call for the same member
//   withdraws the older pending one. An update whose overflow is
//   the member's current state (no request changing the same fields would
//   fit, whatever their new values) says so: the owner changes the settings
//   file, not Wright.
// - `applyOnApproval`, which the approvals decision runs when the owner
//   approves the held call `once`: the same checks again on the approval's own
//   agent, then the create (`createAgent` with `by: "wright"` and the
//   approval's id; its files are written by `ensureAgentFiles` once the
//   decision committed) or the update (the `set` pattern: a temporary sibling,
//   re-read, rename inside the transaction that records `agent_updated`). A
//   refusal is one of `CHARTER_TOOL_REFUSALS`, recorded on the approval and
//   said in Wright's message; nothing is written. Any other throw propagates
//   (the decision records `apply_error`).
// - the handler, reached only when a composition with no applier let an
//   approved retry through: it throws, writing nothing (fail closed).
//
// Mechanism only (invariant 1): every value comes from Wright's draft, which
// the owner sees before anything is written; the kernel picks no model, limit
// or workspace. The charter's text is untrusted data (invariant 3): it is
// stored and shown, never followed; the CLI escapes every display line.
//
// The readiness check (`./charter-readiness.ts`, phase 8 item 18b) runs in both
// `beforeHold`s and both appliers: its lines go right after the display's first
// line (so they are in the create's head, never cut), its `agentNote` rides on
// the hold's verdict (the gate appends it to the held reason Wright reads), and
// an apply with findings still open names them in its applied sentence. Wright's
// create is refused `invalid_input` for a bare-string duty (a duty names its jobs).
//
// The `studio` CLI loads this module through `./index.ts`, so it imports only
// types, zod, `node:*`, the feature seam and its tool catalogue, `../loop/internal.js`,
// `../brain/settings.js`, `../approvals/store.js` (a constant),
// `../sessions/policy.js` (`NEVER_CATEGORIES`) and this
// feature's own modules (`./charter-readiness.js` included, with its CLI-safe
// imports `../automate/checkout.js` and `../protected-paths.js`): never the Agent SDK,
// the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`).
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { MAX_APPROVAL_DISPLAY } from "../approvals/store.js";
import type { AppliedApproval, ApprovalApplyOutcome } from "../approvals/store.js";
import { MAX_SETTINGS_BYTES } from "../brain/settings.js";
import { jobDisplayLines } from "../features/catalogue.js";
import type { ToolCatalogue } from "../features/catalogue.js";
import { defineTool } from "../features/contribution.js";
import type { ContributedToolContext } from "../features/contribution.js";
import { NO_REF, appendEvent } from "../loop/internal.js";
import { NEVER_CATEGORIES } from "../sessions/policy.js";
import type { AllowedPermissionMode, HeldToolVerdict } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import {
  CHARTER_JSON_SCHEMA,
  CHARTER_LIMIT_KEYS,
  CHARTER_PERMISSION_MODES,
  createAgent,
  ensureAgentFiles,
  renderAgentSettingsJson,
  renderRoleMd,
  validateCharter,
} from "./charter-files.js";
import type { AgentAuditKind, Charter } from "./charter-files.js";
import { charterReadiness, openFlagsSentence, readinessFloorLines, wrightDutyRefusal } from "./charter-readiness.js";
import type { ReadinessResult } from "./charter-readiness.js";
import { getAgent, listAgents } from "./registry.js";
import type { AgentRow } from "./registry.js";
import { agentSettingsPath, readAgentSettings } from "./settings.js";
import { AVATAR_HUES, AVATAR_SHAPES } from "./types.js";
import type { AgentPart } from "./types.js";

export const AGENT_CREATE_TOOL_NAME = "kernel_agent_create";
export const AGENT_UPDATE_TOOL_NAME = "kernel_agent_update";
export const AGENT_LIST_TOOL_NAME = "kernel_agent_list";

/** The tools' full SDK names: what the gate holds, and what a rail payload's `tool` holds. */
const CREATE_FULL_NAME = `mcp__kernel__${AGENT_CREATE_TOOL_NAME}`;
const UPDATE_FULL_NAME = `mcp__kernel__${AGENT_UPDATE_TOOL_NAME}`;

/** The lead agent: the only caller of the two held tools, and never a crew member. */
const WRIGHT_ID = "wright";

/**
 * Why a charter tool held nothing, or the kernel applied nothing: the only
 * list of them, in check order. Every hold refusal and every `apply_refused`
 * this part answers is one of them.
 */
export const CHARTER_TOOL_REFUSALS = Object.freeze([
  "not_lead",
  "idempotency_key_used",
  "reserved",
  "not_found",
  "agent_off",
  "invalid_input",
  "id_taken",
  "files_exist",
  "config_changed",
] as const);
export type CharterToolRefusal = (typeof CHARTER_TOOL_REFUSALS)[number];

/** A refusal: its token and a one-line detail. */
interface Refused {
  readonly refused: CharterToolRefusal;
  readonly message: string;
}

function refused(token: CharterToolRefusal, message: string): Refused {
  return { refused: token, message };
}

function isRefused(value: unknown): value is Refused {
  return typeof value === "object" && value !== null && "refused" in value && "message" in value;
}

/** `text` on one line: every run of whitespace as one space. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The gate's refusal text for `tool`: `<tool>: <token>: <detail> (nothing was held for the owner)`. */
function holdRefusal(tool: string, r: Refused): HeldToolVerdict {
  return { refuse: `${tool}: ${r.refused}: ${oneLine(r.message)} (nothing was held for the owner)` };
}

type Body = Record<string, unknown>;

function isBodyObject(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---- The caller and the key -------------------------------------------------------

/** `not_lead` unless `agent` is exactly Wright: crew members never create or change agents. */
function leadRefusal(agent: string | null | undefined): Refused | undefined {
  if (agent === WRIGHT_ID) return undefined;
  const who = typeof agent === "string" && agent !== "" ? `agent ${JSON.stringify(agent.slice(0, 64))}` : "a session with no agent";
  return refused("not_lead", `${who} called it; only Wright, the lead, drafts or changes a crew member`);
}

/**
 * `idempotency_key_used` when this session already has an approval whose
 * rail payload is for `fullName` with this key (a new key asks the owner
 * again; a reused one would make two approvals of one request).
 */
function usedKeyRefusal(ctx: ContributedToolContext, fullName: string, key: string): Refused | undefined {
  const used = ctx.store
    .prepare<[number, string, string], number>(
      "SELECT 1 FROM approvals WHERE requesting_session = ? AND json_extract(payload_json, '$.tool') = ? AND json_extract(payload_json, '$.input.idempotency_key') = ? LIMIT 1",
    )
    .pluck()
    .get(ctx.sessionId, fullName, key);
  return used === undefined ? undefined : refused("idempotency_key_used", "this idempotency_key was already used for a request in this session; use a new key to ask the owner again");
}

/** The calling session's agent (null for none). */
function callerOf(ctx: ContributedToolContext): string | null {
  return ctx.sessions.getSession(ctx.sessionId)?.agent ?? null;
}

// ---- The display ------------------------------------------------------------------

function listText(items: readonly string[], quoted = false): string {
  return items.length === 0 ? "none" : items.map((s) => (quoted ? JSON.stringify(s) : s)).join(", ");
}

/**
 * The enforced line, from the parsed values only (never from prose): the
 * `never` categories, the allowed tools and the Bash prefixes (JSON-quoted),
 * and the connectors grant a create proposes (appended only when there is
 * one, so a line without a grant is byte-identical to what it always was).
 */
function enforcedLine(never: readonly string[], allowedTools: readonly string[], prefixes: readonly string[], connectors: readonly string[] = []): string {
  const grant = connectors.length === 0 ? "" : `; connectors: ${listText(connectors)}`;
  return `enforced: never: ${listText(never)}; tools: ${listText(allowedTools)}; bash prefixes: ${listText(prefixes, true)}${grant}`;
}

/** Each limit as `<key> <n> (proposed)` or `<key> not set (no limit)`. */
function limitsLine(limits: Charter["limits"]): string {
  const parts = CHARTER_LIMIT_KEYS.map((key) => {
    const value = limits?.[key];
    return value === undefined ? `${key} not set (no limit)` : `${key} ${value} (proposed)`;
  });
  return `limits: ${parts.join("; ")}`;
}

/** `text` without its one trailing newline (a rendered file, as display lines). */
function asLines(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** A create head with the job lines in full (`purposes`) or in their compact, label-only form. */
function createHeadWith(charter: Charter, catalogue: ToolCatalogue | undefined, purposes: boolean, readiness: readonly string[]): string {
  const tp = charter.tool_policy;
  return [
    `Create crew member ${charter.id} (${JSON.stringify(charter.display_name)}, ${charter.avatar.shape} ${charter.avatar.hue}), proposed by Wright`,
    ...readiness,
    ...jobDisplayLines(tp.allowedTools, catalogue, purposes),
    enforcedLine(tp.never, tp.allowedTools, tp.allowedBashPrefixes, charter.connectors),
    limitsLine(charter.limits),
    `workspaces: ${listText(charter.workspaces)}`,
  ].join("\n");
}

/**
 * A create display's head: who, the readiness lines (`charterReadiness`; none
 * when not given), the granted kernel tools grouped by job
 * (`jobDisplayLines`: none when no kernel tool is granted, one plain note when
 * `catalogue` is undefined), the enforced line, the limits and the workspaces
 * (what the list's cut must never hide). The job lines carry each tool's purpose line
 * when that head fits `MAX_APPROVAL_DISPLAY`; otherwise they are the job labels
 * alone (still ahead of every raw name), so the job lines grow with the job
 * vocabulary, never with the number of granted tools.
 */
function createHead(charter: Charter, catalogue?: ToolCatalogue, readiness: readonly string[] = []): string {
  const full = createHeadWith(charter, catalogue, true, readiness);
  return full.length <= MAX_APPROVAL_DISPLAY ? full : createHeadWith(charter, catalogue, false, readiness);
}

/** What the create hold's fit refusal names: the head the owner must see whole. */
const CREATE_HEAD_TEXT = "the display's head (who, the readiness lines, the job lines, the enforced, limits and workspaces lines)";

/**
 * `invalid_input` when `text` (the part of a display the owner must see
 * whole) is longer than `MAX_APPROVAL_DISPLAY`, what `studio approvals` lists
 * before its "more characters not shown" mark: the hold refuses rather than
 * list a cut enforced line.
 */
function displayFitRefusal(what: string, text: string): Refused | undefined {
  if (text.length <= MAX_APPROVAL_DISPLAY) return undefined;
  return refused("invalid_input", `${what} would be ${text.length} characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown; ask for less at once (fewer or shorter tools, prefixes or workspaces)`);
}

/**
 * What `studio approvals` shows for a create, in this order: who, the
 * readiness lines (`readiness`, the hold's `charterReadiness(...).lines`), the
 * granted kernel tools by job (`catalogue`'s grouping, ahead of any
 * `mcp__kernel__` name), the enforced line, the limits, the workspaces, then
 * the settings file and `role.md` exactly as the kernel would write them. The
 * approval stores it whole; `studio approvals`' cut may hide the files' tail
 * behind its mark, never the head: the hold refuses a head that does not fit.
 */
export function createDisplay(charter: Charter, catalogue?: ToolCatalogue, readiness: readonly string[] = []): string {
  return [
    createHead(charter, catalogue, readiness),
    `config/agents/${charter.id}.json:`,
    asLines(renderAgentSettingsJson(charter)),
    `memory/${charter.id}/role.md:`,
    asLines(renderRoleMd(charter, charter.connectors)),
  ].join("\n");
}

// ---- kernel_agent_create ----------------------------------------------------------

type CreateArgs = { readonly charter: Record<string, unknown>; readonly idempotency_key: string };

/** The charter's id for a sentence (the input is untrusted: a non-string id is named as such). */
function charterIdText(charter: Record<string, unknown>): string {
  const id = charter.id;
  return typeof id === "string" ? id.slice(0, 64) : "(no id)";
}

/** A create's readiness: the charter's own duties, tools and workspaces, and the connectors it proposes. */
function createReadiness(charter: Charter, catalogue: ToolCatalogue | undefined, dataDir: string): ReadinessResult {
  return charterReadiness({ action: "create", charter, catalogue, grant: { kind: "proposed", connectors: charter.connectors ?? [] }, dataDir });
}

/**
 * A hold's verdict: the display, its subject (`agent:<id>`, the member the
 * call creates or changes, so a newer charter call for the same member
 * withdraws the older pending one: the owner's 2026-11-11 decision 1), and the
 * readiness note for Wright when anything is open (none: the held reason is as
 * before).
 */
function heldVerdict(display: string, readiness: ReadinessResult, id: string): HeldToolVerdict {
  const subject = `agent:${id}`;
  return readiness.agentNote === undefined ? { display, subject } : { display, subject, agentNote: readiness.agentNote };
}

function createBeforeHold(a: CreateArgs, ctx: ContributedToolContext): HeldToolVerdict {
  const refusal = leadRefusal(callerOf(ctx)) ?? usedKeyRefusal(ctx, CREATE_FULL_NAME, a.idempotency_key);
  if (refusal !== undefined) return holdRefusal(AGENT_CREATE_TOOL_NAME, refusal);
  const checked = validateCharter(a.charter, { dataDir: ctx.store.dataDir });
  if (!checked.ok) return holdRefusal(AGENT_CREATE_TOOL_NAME, refused("invalid_input", checked.message));
  // A duty Wright drafts names its jobs, so the readiness check can compare them with the tools.
  const bare = wrightDutyRefusal(checked.charter);
  if (bare !== undefined) return holdRefusal(AGENT_CREATE_TOOL_NAME, refused("invalid_input", bare));
  if (getAgent(ctx.store, checked.charter.id) !== undefined) {
    return holdRefusal(AGENT_CREATE_TOOL_NAME, refused("id_taken", `a crew member with id ${checked.charter.id} exists, active or off (an id is never reused)`));
  }
  const readiness = createReadiness(checked.charter, ctx.catalogue, ctx.store.dataDir);
  const tooLong = displayFitRefusal(CREATE_HEAD_TEXT, createHead(checked.charter, ctx.catalogue, readiness.lines));
  if (tooLong !== undefined) return holdRefusal(AGENT_CREATE_TOOL_NAME, tooLong);
  return heldVerdict(createDisplay(checked.charter, ctx.catalogue, readiness.lines), readiness, checked.charter.id);
}

/** `createAgent`'s refusal codes as this part's tokens. */
const CREATE_REFUSAL_TOKENS = {
  agent_id_invalid: "invalid_input",
  charter_invalid: "invalid_input",
  id_taken: "id_taken",
  files_exist: "files_exist",
} as const satisfies Record<string, CharterToolRefusal>;

/**
 * The kernel's apply of an approved held create, inside the decision's
 * transaction: `not_lead` from the approval's agent, then `createAgent`
 * (`by: "wright"`, the approval's id, `deferFiles`): the row and its
 * `agent_created` event join the decision's transaction, and the files are
 * written by `ensureAgentFiles` once it committed (`after`; a throw there is
 * ignored by the decision, and the next `ensureAgentFiles` heals the files).
 * The readiness check runs again on the created charter: what is still open is
 * named in the applied sentence, as the owner's choice to proceed
 * (`openFlagsSentence`). A bare-string duty is not refused here: the owner
 * approved what the display showed.
 */
function createOnApproval(a: CreateArgs, ctx: { store: Store; now: () => Date; approval: AppliedApproval; catalogue?: ToolCatalogue }): ApprovalApplyOutcome {
  const { store, approval } = ctx;
  const id = charterIdText(a.charter);
  const notCreated = (r: Refused): ApprovalApplyOutcome => ({ refused: r.refused, text: `The kernel did not create crew member ${id}: ${r.refused} (${oneLine(r.message)}).` });
  const lead = leadRefusal(approval.agent);
  if (lead !== undefined) return notCreated(lead);
  const r = createAgent(store, store.dataDir, a.charter, { by: "wright", approvalId: approval.id, deferFiles: true }, ctx.now());
  if (!r.ok) return notCreated(refused(CREATE_REFUSAL_TOKENS[r.error], r.message));
  const created = r.agent.id;
  const checked = validateCharter(a.charter, { dataDir: store.dataDir });
  const open = checked.ok ? openFlagsSentence(createReadiness(checked.charter, ctx.catalogue, store.dataDir)) : "";
  return {
    applied: `The kernel created crew member ${created} (${r.agent.display_name}) on approval ${approval.id}.${open}`,
    // A write error is thrown and ignored by the decision: the row stays, and the next ensureAgentFiles writes the files.
    after: () => void ensureAgentFiles(store, store.dataDir, created),
  };
}

/** The handler's one answer: the kernel applies the call on approval; a call that reached the handler did nothing. */
function appliedByKernel(tool: string): never {
  throw new Error(`${tool} is applied by the kernel when the owner approves it; this call did nothing`);
}

const createTool = defineTool({
  name: AGENT_CREATE_TOOL_NAME,
  job: "manage_crew",
  description:
    "Ask the owner to create a crew member from a charter you draft from the owner's words: {id, display_name, avatar: {shape, hue}, persona, duties, boundaries, model, effort?, permission_mode, tool_policy: {allowedTools, allowedBashPrefixes, never}, limits?: {tokens_per_day?, sessions_at_once?, delegation_depth?}, workspaces, connectors?: [\"github\"]}. " +
    "Write each duty as {\"text\": \"<the duty>\", \"jobs\": [<the catalogue job ids that do it>]} ([] when it needs no kernel tool), and grant every tool of each job a duty names; a duty written as a bare line is refused. " +
    "Before the owner sees it, the kernel checks that every duty's jobs are granted and every granted job has what it needs (a workspace that is a git checkout with a GitHub remote for a code job, a connector grant); anything open is shown to the owner and told to you after the held reason, with the fix to propose: say it to the owner. " +
    "When the owner asks for a crew member, draft it straight into the held approval with this call and refine it with an update (kernel_agent_update, once the member exists); never leave a proposal only in chat text. " +
    "Every value the owner did not state is your proposal: say so to the owner. Put each \"never …\" the owner said into both the prose boundaries and the enforced tool_policy.never (only never is enforced; boundaries are guidance). " +
    "Propose limits and limits.delegation_depth, and never let the owner think they are already set: an unset limit is no limit. " +
    "connectors is your proposal of the GitHub grant, never a default: say so to the owner; it takes effect only if the owner approves this call, and no later update changes it. " +
    "The kernel always holds this call for the owner, showing the role.md and settings file it would write and what it enforces; end your turn. " +
    "The owner's approval creates the member: the kernel applies it itself and tells you what it did in a new message; do not repeat the call. " +
    `Refused (nothing held) with one of: ${CHARTER_TOOL_REFUSALS.join(", ")}. Use a new idempotency_key for each request to the owner.`,
  shape: {
    // Not `z.record`: the Agent SDK's bundled serialiser throws on a record, which empties `tools/list`; and a record rebuilds
    // the object in a plain `{}`, dropping an own `__proto__` key. `validateCharter` sees the charter as sent (and refuses `__proto__`).
    // Published as the charter's own JSON Schema (`CHARTER_JSON_SCHEMA`: its closed sets as enums, its limits as positive
    // integers), so a session sees the sets before it calls; the parse stays `z.unknown()` and `validateCharter` the check.
    charter: z
      .unknown()
      .refine((v) => typeof v === "object" && v !== null && !Array.isArray(v), { message: "charter must be a JSON object" })
      .meta(CHARTER_JSON_SCHEMA),
    idempotency_key: z.string().min(1).max(200),
  },
  beforeHold: createBeforeHold,
  applyOnApproval: createOnApproval,
  handler: () => appliedByKernel(AGENT_CREATE_TOOL_NAME),
});

// ---- kernel_agent_update ----------------------------------------------------------

/** A limit's change: a positive integer, or null (clear: unset is no limit). */
const limitChange = z.number().int().positive().nullable().optional();

// The closed sets are the charter's own (never a copied list), so `tools/list` publishes them as enums; the merged
// result is still checked whole by `validateCharter` (defence in depth).
const changesSchema = z
  .object({
    model: z.string().optional(),
    effort: z.string().nullable().optional(),
    permission_mode: z.enum(CHARTER_PERMISSION_MODES as [AllowedPermissionMode, ...AllowedPermissionMode[]]).optional(),
    tool_policy: z.object({ allowedTools: z.array(z.string()), allowedBashPrefixes: z.array(z.string()) }).strict().optional(),
    never: z.array(z.enum(NEVER_CATEGORIES)).optional(),
    limits: z.object({ tokens_per_day: limitChange, sessions_at_once: limitChange, delegation_depth: limitChange }).strict().optional(),
    workspaces: z.array(z.string()).optional(),
    display_name: z.string().optional(),
    avatar: z.object({ shape: z.enum(AVATAR_SHAPES), hue: z.enum(AVATAR_HUES) }).strict().optional(),
  })
  .strict()
  .refine((c) => Object.values(c).some((v) => v !== undefined), "name at least one field to change");

type Changes = z.infer<typeof changesSchema>;

type UpdateArgs = { readonly id: string; readonly changes: Changes; readonly expected_sha256: string; readonly idempotency_key: string };

/** The settings file's top-level keys an update may name, in the order the display lists them. */
const FILE_FIELDS = ["model", "effort", "permission_mode", "tool_policy", "never", "workspaces"] as const;

/** One changed field: `limits.<key>` for a limit; `undefined` is absent (not set). */
interface FieldChange {
  readonly field: string;
  readonly old: unknown;
  readonly new: unknown;
}

/** What an update would write. */
interface Merged {
  readonly row: AgentRow;
  readonly file: string;
  /** The settings file's bytes as read, and their sha256. */
  readonly bytes: Buffer;
  readonly sha256: string;
  /** Every field the change changes, in display order (empty: it changes nothing). */
  readonly changes: readonly FieldChange[];
  /** Whether a settings file key changes (not only the row's display name or avatar). */
  readonly fileChanged: boolean;
  /** The new settings file. */
  readonly text: string;
  readonly displayName: string;
  readonly avatar: { readonly shape: string; readonly hue: string };
  /** The validated result: what the kernel would enforce. */
  readonly charter: Charter;
  /** The member's tool list before the change (its settings file's `tool_policy.allowedTools`, strings only): what the display's job lines mark additions against. */
  readonly heldTools: readonly string[];
  /** The settings file's `connectors` value as stored (an update never changes it): what the readiness check reads the member's grant from. */
  readonly connectorsRaw: unknown;
}

/** Absent and `null` read as one value (not set), so clearing an unset value changes nothing. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function shownValue(value: unknown): string {
  return value === undefined || value === null ? "not set" : JSON.stringify(value);
}

/**
 * The member `id` names, for both hold and apply: `reserved` (Wright: the
 * owner edits `wright.json`), `not_found` (an invalid id, or no row) or
 * `agent_off`.
 */
function memberOf(store: Store, id: string): AgentRow | Refused {
  if (id === WRIGHT_ID) return refused("reserved", `Wright is not a crew member: the owner edits ${agentSettingsPath(store.dataDir, WRIGHT_ID)}`);
  const row = getAgent(store, id);
  if (row === undefined) return refused("not_found", `no crew member ${JSON.stringify(id.slice(0, 64))}`);
  if (row.status === "off") return refused("agent_off", `crew member ${row.id} is off; the owner turns it on first`);
  return row;
}

/** The settings file's bytes, or why they could not be read (`invalid_input`). */
function settingsBytes(file: string): Buffer | Refused {
  try {
    if (statSync(file).size > MAX_SETTINGS_BYTES) return refused("invalid_input", `the settings file ${file} is over ${MAX_SETTINGS_BYTES} bytes`);
    const bytes = readFileSync(file);
    if (bytes.length > MAX_SETTINGS_BYTES) return refused("invalid_input", `the settings file ${file} is over ${MAX_SETTINGS_BYTES} bytes`);
    return bytes;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ENOENT") return refused("invalid_input", `the settings file ${file} is missing`);
    return refused("invalid_input", `the settings file ${file} is unreadable (${String(code ?? "error")})`);
  }
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * `changes` laid over `row`'s settings file `bytes`, validated: the parsed
 * object with only the changed keys replaced in place (key order kept, a new
 * key appended): `tool_policy` replaces `allowedTools` and
 * `allowedBashPrefixes` and keeps any other key (`status`); `limits` merges
 * per key (`null` deletes it; `limits` itself stays); `effort: null` deletes
 * `effort`; every other key replaces whole. `display_name` and `avatar` are
 * the row's. The result is checked as a charter (the row's `charter_json`
 * prose and the new values) by `validateCharter`, so every value passes the
 * charter's own rules. Refuses `invalid_input`, naming the field.
 */
function mergeUpdate(store: Store, row: AgentRow, file: string, bytes: Buffer, changes: Changes): Omit<Merged, "sha256"> | Refused {
  let current: unknown;
  try {
    current = JSON.parse(bytes.toString("utf8"));
  } catch {
    return refused("invalid_input", `the settings file ${file} is not JSON`);
  }
  if (!isBodyObject(current)) return refused("invalid_input", `the settings file ${file} is not a JSON object`);
  let prose: Body;
  try {
    const parsed = JSON.parse(row.charter_json) as unknown;
    if (!isBodyObject(parsed)) return refused("invalid_input", `charter_json of ${row.id} is not a JSON object`);
    prose = parsed;
  } catch {
    return refused("invalid_input", `charter_json of ${row.id} is not JSON`);
  }

  const next = structuredClone(current);
  const found: FieldChange[] = [];
  for (const key of FILE_FIELDS) {
    const value = changes[key];
    if (value === undefined) continue;
    if (key === "tool_policy") {
      const tp = isBodyObject(current.tool_policy) ? current.tool_policy : {};
      const old = { allowedTools: tp.allowedTools, allowedBashPrefixes: tp.allowedBashPrefixes };
      const policy = value as NonNullable<Changes["tool_policy"]>;
      if (same(old, policy)) continue;
      const kept: Body = isBodyObject(next.tool_policy) ? next.tool_policy : {};
      kept.allowedTools = [...policy.allowedTools];
      kept.allowedBashPrefixes = [...policy.allowedBashPrefixes];
      next.tool_policy = kept;
      found.push({ field: key, old: tp.allowedTools === undefined && tp.allowedBashPrefixes === undefined ? undefined : old, new: policy });
      continue;
    }
    if (same(current[key], value)) continue;
    if (value === null) delete next[key];
    else next[key] = value;
    found.push({ field: key, old: current[key], new: value ?? undefined });
  }
  if (changes.limits !== undefined) {
    const old: Body = isBodyObject(current.limits) ? current.limits : {};
    const limits: Body = isBodyObject(next.limits) ? next.limits : {};
    let touched = false;
    for (const key of CHARTER_LIMIT_KEYS) {
      const value = changes.limits[key];
      if (value === undefined || same(old[key], value)) continue;
      if (value === null) delete limits[key];
      else limits[key] = value;
      touched = true;
      found.push({ field: `limits.${key}`, old: old[key], new: value ?? undefined });
    }
    if (touched) next.limits = limits;
  }
  const fileChanged = found.length > 0;
  const displayName = changes.display_name ?? row.display_name;
  if (!same(row.display_name, displayName)) found.push({ field: "display_name", old: row.display_name, new: displayName });
  const oldAvatar = { shape: row.avatar_shape, hue: row.avatar_hue };
  const avatar = changes.avatar ?? oldAvatar;
  if (!same(oldAvatar, avatar)) found.push({ field: "avatar", old: oldAvatar, new: avatar });

  const tp = isBodyObject(next.tool_policy) ? next.tool_policy : {};
  const candidate: Body = {
    id: row.id,
    display_name: displayName,
    avatar,
    persona: prose.persona,
    duties: prose.duties,
    boundaries: prose.boundaries,
    model: next.model,
    // `effort: null` in a file is "not set", which a charter writes by leaving it out.
    ...(next.effort !== undefined && next.effort !== null ? { effort: next.effort } : {}),
    permission_mode: next.permission_mode,
    tool_policy: { allowedTools: tp.allowedTools, allowedBashPrefixes: tp.allowedBashPrefixes, never: next.never ?? [] },
    ...(next.limits !== undefined ? { limits: next.limits } : {}),
    workspaces: next.workspaces ?? [],
  };
  const checked = validateCharter(candidate, { dataDir: store.dataDir });
  if (!checked.ok) return refused("invalid_input", `the result would not be a valid charter: ${checked.message}`);
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (Buffer.byteLength(text) > MAX_SETTINGS_BYTES) return refused("invalid_input", `the settings file would be over ${MAX_SETTINGS_BYTES} bytes`);
  const heldPolicy = isBodyObject(current.tool_policy) ? current.tool_policy.allowedTools : undefined;
  // A list that is not one (a hand-edited file) holds nothing: every granted kernel tool shows as added.
  const heldTools = Array.isArray(heldPolicy) ? heldPolicy.filter((t): t is string => typeof t === "string") : [];
  return { row, file, bytes, changes: found, fileChanged, text, displayName, avatar, charter: checked.charter, heldTools, connectorsRaw: next.connectors };
}

/** The update `a` asks for, at hold: the member, its file, the merge, the hash, and a change that changes something. */
function updateOf(store: Store, a: UpdateArgs): Merged | Refused {
  const row = memberOf(store, a.id);
  if (isRefused(row)) return row;
  const file = agentSettingsPath(store.dataDir, row.id);
  const bytes = settingsBytes(file);
  if (isRefused(bytes)) return bytes;
  const merged = mergeUpdate(store, row, file, bytes, a.changes);
  if (isRefused(merged)) return merged;
  const sha256 = sha256Of(bytes);
  if (sha256 !== a.expected_sha256) return refused("config_changed", changedText(file, sha256));
  if (merged.changes.length === 0) return refused("invalid_input", "changes changes nothing: every named value equals the current one");
  return { ...merged, sha256 };
}

function changedText(file: string, sha256: string | null): string {
  return `${file} changed since it was read (its sha256 is ${sha256 === null ? "unreadable" : sha256.slice(0, 12)}…); call kernel_agent_list for the current hash`;
}

/** An update display's first line: who, and the hash of the settings file it was drafted against. */
function updateHead(m: Merged): string {
  return `Update crew member ${m.row.id} (${JSON.stringify(m.row.display_name)}), settings sha256 ${m.sha256.slice(0, 12)}, proposed by Wright`;
}

/**
 * What `studio approvals` shows for an update: who and which file, the
 * readiness lines (`readiness`, the hold's `charterReadiness(...).lines`, in
 * every form), the result's granted kernel tools by job (`jobDisplayLines`, ahead of the field
 * lines, which may name `mcp__kernel__` tools), one line per changed field,
 * then the result's enforced line. The job lines mark what the update adds
 * against the member's current tools (`Merged.heldTools`): a job line ends
 * ` (added)` when the member held no tool of that job, and every other job
 * line is one it keeps; a new tool under a kept job is marked on its purpose
 * line in the full form, and on the job line (` (gains tools)`) in the
 * label-only forms. The first of these forms whose whole
 * display fits `MAX_APPROVAL_DISPLAY` (else the last, which the hold refuses):
 *
 * 1. each job's tools' purpose lines, and every field line as
 *    `<field>: <old JSON> → <new JSON>`;
 * 2. the job labels alone (still ahead of every raw name);
 * 3. the job labels alone, and a `tool_policy` change's new value as
 *    `POLICY_NEW_ON_ENFORCED` (it is exactly the enforced line's tools and
 *    Bash prefixes, shown whole beneath).
 *
 * So the job lines grow with the job vocabulary, never with the number of
 * granted tools, and a tool list is shown at most twice (the old value and
 * the enforced line), never three times: a fit's `proposed_update` (every
 * current tool plus the missing ones) for a member with many kernel tools is
 * held whenever the old list and the result's enforced line leave room.
 */
export function updateDisplay(m: Merged, catalogue?: ToolCatalogue, readiness: readonly string[] = []): string {
  let display = "";
  for (const form of UPDATE_DISPLAY_FORMS) {
    display = updateDisplayWith(m, catalogue, form, readiness);
    if (display.length <= MAX_APPROVAL_DISPLAY) return display;
  }
  return display;
}

/** An update display's form: full purpose lines or labels alone; a `tool_policy` change's new value as JSON or as `POLICY_NEW_ON_ENFORCED`. */
interface UpdateDisplayForm {
  readonly purposes: boolean;
  readonly policyOnEnforced: boolean;
}

/** `updateDisplay`'s forms, in the order it tries them (each no longer than the one before). */
const UPDATE_DISPLAY_FORMS: readonly UpdateDisplayForm[] = Object.freeze([
  { purposes: true, policyOnEnforced: false },
  { purposes: false, policyOnEnforced: false },
  { purposes: false, policyOnEnforced: true },
]);

function updateDisplayWith(m: Merged, catalogue: ToolCatalogue | undefined, form: UpdateDisplayForm, readiness: readonly string[]): string {
  const tp = m.charter.tool_policy;
  return [
    updateHead(m),
    ...readiness,
    ...jobDisplayLines(tp.allowedTools, catalogue, form.purposes, m.heldTools),
    ...m.changes.map((c) => fieldLine(c, form.policyOnEnforced)),
    enforcedLine(tp.never, tp.allowedTools, tp.allowedBashPrefixes),
  ].join("\n");
}

/** What a `tool_policy` field line shows for its new value in `updateDisplay`'s last form: the new value is exactly the enforced line's tools and Bash prefixes. */
export const POLICY_NEW_ON_ENFORCED = "as on the enforced line";

/** A changed field's line: `<field>: <old JSON> → <new JSON>`, or (`policyOnEnforced`) a `tool_policy` change's new value as `POLICY_NEW_ON_ENFORCED`. */
function fieldLine(c: FieldChange, policyOnEnforced: boolean): string {
  const shown = policyOnEnforced && c.field === "tool_policy" ? POLICY_NEW_ON_ENFORCED : shownValue(c.new);
  return `${c.field}: ${shownValue(c.old)} → ${shown}`;
}

/** The member of `values` whose `shownValue` is shortest (the first of the shortest). */
function shortestShown<T>(values: readonly T[]): T {
  return values.reduce((a, b) => (shownValue(b).length < shownValue(a).length ? b : a));
}

/** The shortest valid new value of each changed field (`FieldChange.field`), as the charter's rules allow it. */
const SHORTEST_NEW: Readonly<Record<string, unknown>> = Object.freeze({
  // A 1-character token or line; effort's clear (shown "not set") is longer, and taken only if it were not.
  model: "x",
  effort: shortestShown(["x", null]),
  display_name: "x",
  permission_mode: shortestShown(CHARTER_PERMISSION_MODES),
  tool_policy: { allowedTools: [], allowedBashPrefixes: [] },
  never: [],
  workspaces: [],
  avatar: { shape: shortestShown(AVATAR_SHAPES), hue: shortestShown(AVATAR_HUES) },
  // A positive integer (shown with at least one digit), or a clear (shown "not set").
  ...Object.fromEntries(CHARTER_LIMIT_KEYS.map((key) => [`limits.${key}`, shortestShown([1, null])])),
});

/** The shortest a changed field's new value can be shown (an unknown field counts as empty: the floor stays a lower bound). */
function shortestNewShown(field: string): string {
  return Object.hasOwn(SHORTEST_NEW, field) ? shownValue(SHORTEST_NEW[field]) : "";
}

/**
 * A lower bound on the display of any change to the same fields of this
 * member: no such change has a shorter display. The head; the compact
 * (label-only) job lines of the kernel tools it keeps, the shortest form any
 * display of them takes (none when the change sets `tool_policy`, whose
 * shortest value grants none); each field line
 * with its old value (shown whatever the new one is) and the field's shortest
 * valid new value (`SHORTEST_NEW`, rendered by `shownValue` as the display
 * renders it); the enforced line with those same shortest values (empty
 * lists) for what the change sets (`never`, `tool_policy`) and the member's
 * current values for the rest (a field the change leaves alone is shown as
 * it is). For each field but `tool_policy` the bound is a real request's
 * display (the field set to its shortest value), unless that value is the
 * current one (the request would change nothing) or the result fails
 * `validateCharter`. A `tool_policy` change is bounded by `updateDisplay`'s
 * shortest form (its new value as `POLICY_NEW_ON_ENFORCED`, which no longer
 * form undercuts), with the enforced line's tools and Bash prefixes each a
 * one-character entry (`x`, `"x"`: no shorter than any list, `none`
 * included), so the bound holds for every request and every form. The
 * ` (added)` and ` (gains tools)` marks never shorten a display, so they are left out: a change
 * that leaves `tool_policy` alone adds no tool (its job lines carry no mark),
 * and one that sets it is bounded with no job line at all. The readiness
 * block is bounded by `readinessFloorLines` from this request's own readiness
 * (`readiness`): exact when the change sets neither `tool_policy` nor
 * `workspaces` (nothing else changes it), else each line that can vary at
 * its shortest (every update shows the member's stored duties).
 */
function updateFloor(m: Merged, catalogue: ToolCatalogue | undefined, readiness: ReadinessResult): string {
  const tp = m.charter.tool_policy;
  const sets = new Set(m.changes.map((c) => c.field));
  return [
    updateHead(m),
    ...readinessFloorLines(m.charter, catalogue, readiness, { tools: sets.has("tool_policy"), workspaces: sets.has("workspaces") }),
    ...jobDisplayLines(sets.has("tool_policy") ? [] : tp.allowedTools, catalogue, false),
    ...m.changes.map((c) => (c.field === "tool_policy" ? fieldLine(c, true) : `${c.field}: ${shownValue(c.old)} → ${shortestNewShown(c.field)}`)),
    enforcedLine(sets.has("never") ? [] : tp.never, sets.has("tool_policy") ? ["x"] : tp.allowedTools, sets.has("tool_policy") ? ["x"] : tp.allowedBashPrefixes),
  ].join("\n");
}

/** What the update hold's fit refusal names: the display the owner must see whole. */
const UPDATE_DISPLAY_TEXT = "the display (its readiness lines, job lines, field lines and enforced line)";

/**
 * `invalid_input` when the update's display would not fit `MAX_APPROVAL_DISPLAY`
 * (the hold refuses rather than let `studio approvals` list a cut field or
 * enforced line). When even
 * the floor (`updateFloor`: a lower bound on any request changing the same
 * fields) would not fit, no request to those fields fits and the remedy is
 * the owner's, not Wright's: the owner changes the member's settings file,
 * and Wright can change the member once they fit. Otherwise a request to the
 * same fields with shorter new values may fit: ask for less.
 */
function updateFitRefusal(m: Merged, display: string, catalogue: ToolCatalogue | undefined, readiness: ReadinessResult): Refused | undefined {
  if (display.length <= MAX_APPROVAL_DISPLAY) return undefined;
  const floor = updateFloor(m, catalogue, readiness).length;
  if (floor <= MAX_APPROVAL_DISPLAY) return displayFitRefusal(UPDATE_DISPLAY_TEXT, display);
  return refused(
    "invalid_input",
    `${UPDATE_DISPLAY_TEXT} would be ${display.length} characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown, ` +
      `and the member's current settings alone (the changed fields' old values, their shortest new values and the enforced line) would be ${floor}, so no request to these fields fits; ` +
      `the owner changes config/agents/${m.row.id}.json by hand (or with \`studio agents set\` for a scalar field, \`studio agents rename\` for the display name), and Wright can change the member once its settings fit`,
  );
}

/**
 * An update's readiness: the merged result (the member's stored duties, the
 * result's tools and workspaces) and the member's stored connectors grant
 * (an update never changes it).
 */
function updateReadiness(m: Omit<Merged, "sha256">, catalogue: ToolCatalogue | undefined, dataDir: string): ReadinessResult {
  return charterReadiness({ action: "update", charter: m.charter, catalogue, grant: { kind: "stored", raw: m.connectorsRaw }, dataDir });
}

function updateBeforeHold(a: UpdateArgs, ctx: ContributedToolContext): HeldToolVerdict {
  const refusal = leadRefusal(callerOf(ctx)) ?? usedKeyRefusal(ctx, UPDATE_FULL_NAME, a.idempotency_key);
  if (refusal !== undefined) return holdRefusal(AGENT_UPDATE_TOOL_NAME, refusal);
  const update = updateOf(ctx.store, a);
  if (isRefused(update)) return holdRefusal(AGENT_UPDATE_TOOL_NAME, update);
  const readiness = updateReadiness(update, ctx.catalogue, ctx.store.dataDir);
  const display = updateDisplay(update, ctx.catalogue, readiness.lines);
  // The readiness lines, the job lines, the field lines and the enforced line are all the owner must see: the whole display fits, or nothing is held.
  const tooLong = updateFitRefusal(update, display, ctx.catalogue, readiness);
  return tooLong === undefined ? heldVerdict(display, readiness, update.row.id) : holdRefusal(AGENT_UPDATE_TOOL_NAME, tooLong);
}

/**
 * Whether member `id`'s display name or avatar (its `agents` row, which
 * `expected_sha256` does not cover) was written after the hold's
 * `approval_requested` event `eventId`. Every kernel writer of those columns
 * appends its audit event in the same transaction as the row write: the
 * owner's rename (`agent_renamed`) and this applier (`agent_updated` whose
 * `fields` name `display_name` or `avatar`). Event ids only grow, so the check
 * is exact even when the clock does not move (an `updated_at` against the
 * event's `at` would miss a same-millisecond rename), and it ignores the
 * row's other writes (`studio agents off`/`on`, a settings-only update): it
 * refuses only this hold, never a later one (a new hold has a newer event).
 */
function rowEditedSince(store: Store, id: string, eventId: number): boolean {
  return (
    store
      .prepare<[number, string], number>(
        "SELECT 1 FROM events WHERE id > ? AND json_valid(payload_json) AND json_extract(payload_json, '$.id') = ? AND (" +
          "kind = 'agent_renamed' OR (kind = 'agent_updated' AND EXISTS (SELECT 1 FROM json_each(payload_json, '$.fields') WHERE value IN ('display_name', 'avatar')))" +
          ") LIMIT 1",
      )
      .pluck()
      .get(eventId, id) !== undefined
  );
}

/** The settings file changed between the apply's hash and its rename: nothing is written. */
class ConcurrentEditError extends Error {}

/** Whether `file` still holds exactly `bytes` (a file removed since is a change). */
function unchangedSince(file: string, bytes: Buffer): boolean {
  try {
    return readFileSync(file).equals(bytes);
  } catch (err) {
    if ((err as { code?: unknown }).code === "ENOENT") return false;
    throw err;
  }
}

/**
 * The kernel's apply of an approved held update, inside the decision's
 * transaction: `not_lead`, `reserved`, `not_found`, `agent_off` as at hold;
 * the file read and hashed again (`config_changed` unless it is still
 * `expected_sha256`); when the changes name `display_name` or `avatar`, the
 * row's (`config_changed` when either was written since the hold:
 * `rowEditedSince`); the merge and its validation (`invalid_input`). Then
 * the `set` write: a temporary sibling, and in one transaction a re-read of
 * the file (`config_changed` when its bytes differ from the hashed ones), the
 * row's display name and avatar when changed, one `agent_updated` event and,
 * last, the rename over the file. On any refusal or throw the sibling is
 * removed. The rename is the last statement of the applier's savepoint: the
 * decision's own writes and its COMMIT still follow (`agents.md`, Honest
 * limits). The readiness check runs on the merged result: what is still open
 * is named in the applied sentence, as the owner's choice to proceed.
 */
function updateOnApproval(a: UpdateArgs, ctx: { store: Store; now: () => Date; approval: AppliedApproval; catalogue?: ToolCatalogue }): ApprovalApplyOutcome {
  const { store, approval } = ctx;
  const notUpdated = (r: Refused): ApprovalApplyOutcome => ({ refused: r.refused, text: `The kernel did not update crew member ${a.id.slice(0, 64)}: ${r.refused} (${oneLine(r.message)}).` });
  const lead = leadRefusal(approval.agent);
  if (lead !== undefined) return notUpdated(lead);
  const row = memberOf(store, a.id);
  if (isRefused(row)) return notUpdated(row);
  const file = agentSettingsPath(store.dataDir, row.id);
  const bytes = settingsBytes(file);
  // The file read and hashed at the hold: unreadable now is a change too.
  if (isRefused(bytes)) return notUpdated(refused("config_changed", `${file} changed since the hold (${bytes.message})`));
  const sha256 = sha256Of(bytes);
  if (sha256 !== a.expected_sha256) return notUpdated(refused("config_changed", changedText(file, sha256)));
  // The row's display name and avatar are outside the hash: an update naming either is refused if the owner (or another
  // approved update) changed them since the hold, so the approval never reverts that change. An update naming only
  // settings fields writes neither column and is not checked.
  if ((a.changes.display_name !== undefined || a.changes.avatar !== undefined) && rowEditedSince(store, row.id, approval.requestedEventId)) {
    return notUpdated(refused("config_changed", `crew member ${row.id}'s display name or avatar changed since the hold; call kernel_agent_list for the current values`));
  }
  const merged = mergeUpdate(store, row, file, bytes, a.changes);
  if (isRefused(merged)) return notUpdated(merged);
  if (merged.changes.length === 0) return notUpdated(refused("invalid_input", "changes changes nothing: every named value equals the current one"));

  const fields = merged.changes.map((c) => c.field);
  // Read before the write: the workspaces and grant it checks are the merged result's, and the file's old bytes are still in place.
  const open = openFlagsSentence(updateReadiness(merged, ctx.catalogue, store.dataDir));
  const at = ctx.now().toISOString();
  const rowChanged = merged.displayName !== row.display_name || merged.avatar.shape !== row.avatar_shape || merged.avatar.hue !== row.avatar_hue;
  // A temporary sibling, then a rename over the file (atomic on one file system): a reader sees the old file or the new one.
  const temp = merged.fileChanged ? join(dirname(file), `.${basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`) : null;
  if (temp !== null) writeFileSync(temp, merged.text, { flag: "wx", mode: 0o600 });
  try {
    store.transaction(() => {
      // Re-read just before the rename: an owner's hand edit since the hash wins.
      if (!unchangedSince(file, bytes)) throw new ConcurrentEditError();
      if (rowChanged) {
        store
          .prepare("UPDATE agents SET display_name = ?, avatar_shape = ?, avatar_hue = ?, updated_at = ? WHERE id = ?")
          .run(merged.displayName, merged.avatar.shape, merged.avatar.hue, at, row.id);
      }
      appendEvent(store, "agent_updated" satisfies AgentAuditKind, NO_REF, { id: row.id, fields, approval_id: approval.id, by: "kernel" }, at);
      if (temp !== null) renameSync(temp, file);
    });
  } catch (err) {
    if (temp !== null) {
      try {
        unlinkSync(temp);
      } catch {
        // Already renamed or gone.
      }
    }
    if (err instanceof ConcurrentEditError) return notUpdated(refused("config_changed", `${file} changed while it was being updated; nothing was written`));
    throw err;
  }
  return { applied: `The kernel updated crew member ${row.id} on approval ${approval.id}: ${fields.join(", ")}.${open}` };
}

const updateTool = defineTool({
  name: AGENT_UPDATE_TOOL_NAME,
  job: "manage_crew",
  description:
    "Ask the owner to change a crew member's settings (or its display name or avatar). Call kernel_agent_list first: expected_sha256 is the member's sha256 from it, and a settings file that changed since (the owner's edit) is refused. " +
    "changes names only what changes: model, effort (null clears), permission_mode, tool_policy {allowedTools, allowedBashPrefixes}, never, limits {tokens_per_day?, sessions_at_once?, delegation_depth?} (each null clears: no limit), workspaces, display_name, avatar {shape, hue}. Every other key in the file keeps its value. " +
    "The kernel always holds this call for the owner, showing each field's old and new value and what the result enforces, after its check that the member's duties are covered and its jobs have what they need (anything open is told to you after the held reason); end your turn. " +
    "The owner's approval applies it: the kernel changes the file itself and tells you what it did in a new message; do not repeat the call. " +
    `Refused (nothing held) with one of: ${CHARTER_TOOL_REFUSALS.join(", ")}. Use a new idempotency_key for each request to the owner.`,
  shape: {
    id: z.string().min(1).max(64),
    changes: changesSchema,
    expected_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    idempotency_key: z.string().min(1).max(200),
  },
  beforeHold: updateBeforeHold,
  applyOnApproval: updateOnApproval,
  handler: () => appliedByKernel(AGENT_UPDATE_TOOL_NAME),
});

// ---- kernel_agent_list ------------------------------------------------------------

/** One agent as `kernel_agent_list` answers it. Wright's entry has no `created_by` and no `sha256`. */
export interface CharterListEntry {
  readonly id: string;
  readonly display_name: string;
  readonly avatar: { readonly shape: string; readonly hue: string };
  readonly status: string;
  readonly created_by?: string;
  /** The settings file's bytes parsed as JSON; null when absent, over the size limit or not JSON. */
  readonly settings: unknown;
  /** The settings reader's refusal code when the file does not read ok; null otherwise. */
  readonly settings_error: string | null;
  /** The hex sha256 of the settings file's bytes (`kernel_agent_update`'s `expected_sha256`); null when absent or unreadable. */
  readonly sha256?: string | null;
}

/**
 * The settings file's bytes, read once: `present` false when nothing is
 * there; `bytes` null when absent, unreadable or over the size limit (a
 * file the update refuses is never loaded whole, so it has no hash either).
 */
function listBytes(file: string): { readonly present: boolean; readonly bytes: Buffer | null } {
  try {
    if (statSync(file).size > MAX_SETTINGS_BYTES) return { present: true, bytes: null };
  } catch {
    return { present: false, bytes: null };
  }
  try {
    return { present: true, bytes: readFileSync(file) };
  } catch {
    return { present: true, bytes: null };
  }
}

/** `bytes` parsed as JSON; null when absent, over the size limit or not JSON. */
function parsedSettings(bytes: Buffer | null): unknown {
  if (bytes === null || bytes.length > MAX_SETTINGS_BYTES) return null;
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * Wright first, then every registered member (active and off) in id order.
 * Wright's settings are read only when `wright.json` exists (a list never
 * creates it), and it has no `sha256`: nothing changes Wright's file through
 * a tool. A member's file is read once: `sha256` and `settings` from the same
 * bytes, `settings_error` from the settings reader.
 */
export function charterList(store: Store): { agents: CharterListEntry[] } {
  const dataDir = store.dataDir;
  const wrightFile = listBytes(agentSettingsPath(dataDir, WRIGHT_ID));
  const wrightRead = wrightFile.present ? readAgentSettings(dataDir, WRIGHT_ID) : undefined;
  const wright: CharterListEntry = {
    id: WRIGHT_ID,
    display_name: "Wright",
    avatar: { shape: "whale", hue: "accent" },
    status: "active",
    settings: parsedSettings(wrightFile.bytes),
    settings_error: wrightRead === undefined || wrightRead.ok ? null : wrightRead.error,
  };
  const members = listAgents(store).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    agents: [
      wright,
      ...members.map((row): CharterListEntry => {
        const { bytes } = listBytes(agentSettingsPath(dataDir, row.id));
        const read = readAgentSettings(dataDir, row.id);
        return {
          id: row.id,
          display_name: row.display_name,
          avatar: { shape: row.avatar_shape, hue: row.avatar_hue },
          status: row.status,
          created_by: row.created_by,
          settings: parsedSettings(bytes),
          settings_error: read.ok ? null : read.error,
          sha256: bytes === null ? null : sha256Of(bytes),
        };
      }),
    ],
  };
}

const listTool = defineTool({
  name: AGENT_LIST_TOOL_NAME,
  job: "manage_crew",
  description:
    "List the crew: Wright first, then every crew member (active and off) with its display name, avatar, status, who created it, its settings file as JSON (null when unreadable), the settings reader's error (null when it reads ok) and sha256, the hash of the settings file's bytes that kernel_agent_update's expected_sha256 must equal. Reads only.",
  shape: {},
  handler: (_a, ctx) => charterList(ctx.store),
});

export const charterToolsPart: AgentPart = Object.freeze({
  name: "charter-tools",
  tools: Object.freeze([createTool, updateTool, listTool]),
  routes: Object.freeze([]),
  verbs: Object.freeze([]),
  handlers: Object.freeze({}),
});
