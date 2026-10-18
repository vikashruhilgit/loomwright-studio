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
//   never copied from its prose, and come first; a call whose enforced lines
//   (create) or whose whole display (update: the field lines and the enforced
//   line) would not fit in `MAX_APPROVAL_DISPLAY` is refused `invalid_input`,
//   so the 4,000-character cut never hides them. An update whose overflow is
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
// The `studio` CLI loads this module through `./index.ts`, so it imports only
// types, zod, `node:*`, the feature seam, `../loop/internal.js`,
// `../brain/settings.js`, `../approvals/store.js` (a constant) and this
// feature's own modules: never the Agent SDK,
// the session manager or `kernel.ts` (`kernel/test/feature-seams.test.ts`).
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { MAX_APPROVAL_DISPLAY } from "../approvals/store.js";
import type { AppliedApproval, ApprovalApplyOutcome } from "../approvals/store.js";
import { MAX_SETTINGS_BYTES } from "../brain/settings.js";
import { defineTool } from "../features/contribution.js";
import type { ContributedToolContext } from "../features/contribution.js";
import { NO_REF, appendEvent } from "../loop/internal.js";
import type { HeldToolVerdict } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { CHARTER_LIMIT_KEYS, CHARTER_PERMISSION_MODES, createAgent, ensureAgentFiles, renderAgentSettingsJson, renderRoleMd, validateCharter } from "./charter-files.js";
import type { AgentAuditKind, Charter } from "./charter-files.js";
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
 * `never` categories, the allowed tools and the Bash prefixes (JSON-quoted).
 */
function enforcedLine(never: readonly string[], allowedTools: readonly string[], prefixes: readonly string[]): string {
  return `enforced: never: ${listText(never)}; tools: ${listText(allowedTools)}; bash prefixes: ${listText(prefixes, true)}`;
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

/** A create display's head: who, the enforced line, the limits and the workspaces (what the cut must never hide). */
function createHead(charter: Charter): string {
  const tp = charter.tool_policy;
  return [
    `Create crew member ${charter.id} (${JSON.stringify(charter.display_name)}, ${charter.avatar.shape} ${charter.avatar.hue}), proposed by Wright`,
    enforcedLine(tp.never, tp.allowedTools, tp.allowedBashPrefixes),
    limitsLine(charter.limits),
    `workspaces: ${listText(charter.workspaces)}`,
  ].join("\n");
}

/**
 * `invalid_input` when `text` (the part of a display the owner must see
 * whole) is longer than `MAX_APPROVAL_DISPLAY`, the cut `studio approvals`
 * shows: the hold refuses rather than show a cut enforced line.
 */
function displayFitRefusal(what: string, text: string): Refused | undefined {
  if (text.length <= MAX_APPROVAL_DISPLAY) return undefined;
  return refused("invalid_input", `${what} would be ${text.length} characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown; ask for less at once (fewer or shorter tools, prefixes or workspaces)`);
}

/**
 * What `studio approvals` shows for a create, in this order: who, the
 * enforced line, the limits, the workspaces, then the settings file and
 * `role.md` exactly as the kernel would write them (the cut may hide the
 * files' tail, never the head: the hold refuses a head that does not fit).
 */
export function createDisplay(charter: Charter): string {
  return [
    createHead(charter),
    `config/agents/${charter.id}.json:`,
    asLines(renderAgentSettingsJson(charter)),
    `memory/${charter.id}/role.md:`,
    asLines(renderRoleMd(charter)),
  ].join("\n");
}

// ---- kernel_agent_create ----------------------------------------------------------

type CreateArgs = { readonly charter: Record<string, unknown>; readonly idempotency_key: string };

/** The charter's id for a sentence (the input is untrusted: a non-string id is named as such). */
function charterIdText(charter: Record<string, unknown>): string {
  const id = charter.id;
  return typeof id === "string" ? id.slice(0, 64) : "(no id)";
}

function createBeforeHold(a: CreateArgs, ctx: ContributedToolContext): HeldToolVerdict {
  const refusal = leadRefusal(callerOf(ctx)) ?? usedKeyRefusal(ctx, CREATE_FULL_NAME, a.idempotency_key);
  if (refusal !== undefined) return holdRefusal(AGENT_CREATE_TOOL_NAME, refusal);
  const checked = validateCharter(a.charter, { dataDir: ctx.store.dataDir });
  if (!checked.ok) return holdRefusal(AGENT_CREATE_TOOL_NAME, refused("invalid_input", checked.message));
  if (getAgent(ctx.store, checked.charter.id) !== undefined) {
    return holdRefusal(AGENT_CREATE_TOOL_NAME, refused("id_taken", `a crew member with id ${checked.charter.id} exists, active or off (an id is never reused)`));
  }
  const tooLong = displayFitRefusal("the display's enforced, limits and workspaces lines", createHead(checked.charter));
  if (tooLong !== undefined) return holdRefusal(AGENT_CREATE_TOOL_NAME, tooLong);
  return { display: createDisplay(checked.charter) };
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
 */
function createOnApproval(a: CreateArgs, ctx: { store: Store; now: () => Date; approval: AppliedApproval }): ApprovalApplyOutcome {
  const { store, approval } = ctx;
  const id = charterIdText(a.charter);
  const notCreated = (r: Refused): ApprovalApplyOutcome => ({ refused: r.refused, text: `The kernel did not create crew member ${id}: ${r.refused} (${oneLine(r.message)}).` });
  const lead = leadRefusal(approval.agent);
  if (lead !== undefined) return notCreated(lead);
  const r = createAgent(store, store.dataDir, a.charter, { by: "wright", approvalId: approval.id, deferFiles: true }, ctx.now());
  if (!r.ok) return notCreated(refused(CREATE_REFUSAL_TOKENS[r.error], r.message));
  const created = r.agent.id;
  return {
    applied: `The kernel created crew member ${created} (${r.agent.display_name}) on approval ${approval.id}.`,
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
  description:
    "Ask the owner to create a crew member from a charter you draft from the owner's words: {id, display_name, avatar: {shape, hue}, persona, duties, boundaries, model, effort?, permission_mode, tool_policy: {allowedTools, allowedBashPrefixes, never}, limits?: {tokens_per_day?, sessions_at_once?, delegation_depth?}, workspaces}. " +
    "Every value the owner did not state is your proposal: say so to the owner. Put each \"never …\" the owner said into both the prose boundaries and the enforced tool_policy.never (only never is enforced; boundaries are guidance). " +
    "Propose limits and limits.delegation_depth, and never let the owner think they are already set: an unset limit is no limit. " +
    "The kernel always holds this call for the owner, showing the role.md and settings file it would write and what it enforces; end your turn. " +
    "The owner's approval creates the member: the kernel applies it itself and tells you what it did in a new message; do not repeat the call. " +
    `Refused (nothing held) with one of: ${CHARTER_TOOL_REFUSALS.join(", ")}. Use a new idempotency_key for each request to the owner.`,
  shape: { charter: z.record(z.string(), z.unknown()), idempotency_key: z.string().min(1).max(200) },
  beforeHold: createBeforeHold,
  applyOnApproval: createOnApproval,
  handler: () => appliedByKernel(AGENT_CREATE_TOOL_NAME),
});

// ---- kernel_agent_update ----------------------------------------------------------

/** A limit's change: a number, or null (clear: unset is no limit). */
const limitChange = z.number().nullable().optional();

const changesSchema = z
  .object({
    model: z.string().optional(),
    effort: z.string().nullable().optional(),
    permission_mode: z.string().optional(),
    tool_policy: z.object({ allowedTools: z.array(z.string()), allowedBashPrefixes: z.array(z.string()) }).strict().optional(),
    never: z.array(z.string()).optional(),
    limits: z.object({ tokens_per_day: limitChange, sessions_at_once: limitChange, delegation_depth: limitChange }).strict().optional(),
    workspaces: z.array(z.string()).optional(),
    display_name: z.string().optional(),
    avatar: z.object({ shape: z.string(), hue: z.string() }).strict().optional(),
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
  return { row, file, bytes, changes: found, fileChanged, text, displayName, avatar, charter: checked.charter };
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

/** What `studio approvals` shows for an update: who and which file, one line per changed field, then the result's enforced line. */
export function updateDisplay(m: Merged): string {
  const tp = m.charter.tool_policy;
  return [
    updateHead(m),
    ...m.changes.map((c) => `${c.field}: ${shownValue(c.old)} → ${shownValue(c.new)}`),
    enforcedLine(tp.never, tp.allowedTools, tp.allowedBashPrefixes),
  ].join("\n");
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
 * member: no such change has a shorter display. The head; each field line
 * with its old value (shown whatever the new one is) and the field's shortest
 * valid new value (`SHORTEST_NEW`, rendered by `shownValue` as the display
 * renders it); the enforced line with those same shortest values (empty
 * lists) for what the change sets (`never`, `tool_policy`) and the member's
 * current values for the rest (a field the change leaves alone is shown as
 * it is). For each field the bound is a real request's display (the field
 * set to its shortest value), unless that value is the current one (the
 * request would change nothing) or the result fails `validateCharter`.
 */
function updateFloor(m: Merged): string {
  const tp = m.charter.tool_policy;
  const sets = new Set(m.changes.map((c) => c.field));
  return [
    updateHead(m),
    ...m.changes.map((c) => `${c.field}: ${shownValue(c.old)} → ${shortestNewShown(c.field)}`),
    enforcedLine(sets.has("never") ? [] : tp.never, sets.has("tool_policy") ? [] : tp.allowedTools, sets.has("tool_policy") ? [] : tp.allowedBashPrefixes),
  ].join("\n");
}

/**
 * `invalid_input` when the update's display would not fit `MAX_APPROVAL_DISPLAY`
 * (the hold refuses rather than show a cut field or enforced line). When even
 * the floor (`updateFloor`: a lower bound on any request changing the same
 * fields) would not fit, no request to those fields fits and the remedy is
 * the owner's, not Wright's: the owner changes the member's settings file,
 * and Wright can change the member once they fit. Otherwise a request to the
 * same fields with shorter new values may fit: ask for less.
 */
function updateFitRefusal(m: Merged, display: string): Refused | undefined {
  if (display.length <= MAX_APPROVAL_DISPLAY) return undefined;
  const floor = updateFloor(m).length;
  if (floor <= MAX_APPROVAL_DISPLAY) return displayFitRefusal("the display (its field lines and enforced line)", display);
  return refused(
    "invalid_input",
    `the display (its field lines and enforced line) would be ${display.length} characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown, ` +
      `and the member's current settings alone (the changed fields' old values, their shortest new values and the enforced line) would be ${floor}, so no request to these fields fits; ` +
      `the owner changes config/agents/${m.row.id}.json by hand (or with \`studio agents set\` for a scalar field, \`studio agents rename\` for the display name), and Wright can change the member once its settings fit`,
  );
}

function updateBeforeHold(a: UpdateArgs, ctx: ContributedToolContext): HeldToolVerdict {
  const refusal = leadRefusal(callerOf(ctx)) ?? usedKeyRefusal(ctx, UPDATE_FULL_NAME, a.idempotency_key);
  if (refusal !== undefined) return holdRefusal(AGENT_UPDATE_TOOL_NAME, refusal);
  const update = updateOf(ctx.store, a);
  if (isRefused(update)) return holdRefusal(AGENT_UPDATE_TOOL_NAME, update);
  const display = updateDisplay(update);
  // The field lines and the enforced line are all the owner must see: the whole display fits, or nothing is held.
  const tooLong = updateFitRefusal(update, display);
  return tooLong === undefined ? { display } : holdRefusal(AGENT_UPDATE_TOOL_NAME, tooLong);
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
 * limits).
 */
function updateOnApproval(a: UpdateArgs, ctx: { store: Store; now: () => Date; approval: AppliedApproval }): ApprovalApplyOutcome {
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
  return { applied: `The kernel updated crew member ${row.id} on approval ${approval.id}: ${fields.join(", ")}.` };
}

const updateTool = defineTool({
  name: AGENT_UPDATE_TOOL_NAME,
  description:
    "Ask the owner to change a crew member's settings (or its display name or avatar). Call kernel_agent_list first: expected_sha256 is the member's sha256 from it, and a settings file that changed since (the owner's edit) is refused. " +
    "changes names only what changes: model, effort (null clears), permission_mode, tool_policy {allowedTools, allowedBashPrefixes}, never, limits {tokens_per_day?, sessions_at_once?, delegation_depth?} (each null clears: no limit), workspaces, display_name, avatar {shape, hue}. Every other key in the file keeps its value. " +
    "The kernel always holds this call for the owner, showing each field's old and new value and what the result enforces; end your turn. " +
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
