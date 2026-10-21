// The agents feature's `roster` part (phase 4 item 02): the owner creates,
// lists, shows, renames, sets and turns off crew members. Only this file's
// part grows: `./index.ts` merges every part in `AGENT_PARTS` into the one
// `agents` contribution.
//
//   routes  GET  /agents               {agents}: Wright first, then every member by id
//           GET  /agents/:id           {agent, settings, never, workspaces, memory, charter}
//           POST /agents               body: a charter; the owner's create (`createAgent`)
//           POST /agents/:id/rename    body {display_name}
//           POST /agents/:id/set       body {field, value}: one scalar setting, in the file
//           POST /agents/:id/off       status off (never deletes a file)
//           POST /agents/:id/on        status active
//   verbs   studio agents list | show | create | rename | set | off | on   (each calls only its route)
//
// Mechanism only (invariant 1): `set` writes the one value the owner typed and
// nothing else; the kernel picks no model, limit or workspace. Wright is not a
// crew member: `show`, `rename`, `off` and `on` on it are refused `reserved`,
// and `set` takes only `WRIGHT_SET_FIELDS` for it (phase 5 item 07), through
// the same write path as a crew member's; every other field is `reserved` (the
// owner edits `config/agents/wright.json`). Only the owner's route changes
// Wright's settings: no agent tool does. Every stored string is untrusted
// text (invariant 3): the verbs print it through `shown` / `payloadText`, as
// `studio approvals` does, so no stored escape sequence reaches the terminal.
//
// The `studio` CLI loads this module, so it imports only types, zod, `node:*`
// and leaf modules: never the Agent SDK, the session manager or `kernel.ts`.
// Today's tokens come from `../budget/internal.ts` (`agentCountedTokens`,
// `localDay`), never `../budget/index.ts` or `BudgetMeter`, which load the SDK
// (`kernel/test/feature-seams.test.ts` pins the graph).
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { payloadText, shown } from "../approvals/cli.js";
import { MAX_SETTINGS_BYTES } from "../brain/settings.js";
import { agentCountedTokens, localDay } from "../budget/internal.js";
import type { CliApiClient, CliSubcommandOutput, ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { NO_REF, appendEvent, errorMessage } from "../loop/internal.js";
import type { Store } from "../store/store.js";
import {
  CHARTER_PERMISSION_MODES,
  CREW_MEMORY_FILES,
  MAX_CHARTER_BYTES,
  agentFilePaths,
  createAgent,
  displayNameSchema,
  effortSchema,
  modelSchema,
} from "./charter-files.js";
import type { AgentAuditKind } from "./charter-files.js";
import { getAgent, listAgents } from "./registry.js";
import type { AgentRow } from "./registry.js";
import { agentSettingsPath, readAgentSettings } from "./settings.js";
import { isValidAgentId } from "./types.js";
import type { AgentPart, AgentVerb, AgentStatus } from "./types.js";

/** The lead agent: listed first, never a crew member (`reserved` for show, rename, off, on and every field `set` does not take for it). */
const WRIGHT_ID = "wright";

/** The fields `studio agents set` changes: the scalar settings. List fields are changed by editing the file. */
export const AGENT_SET_FIELDS = Object.freeze([
  "model",
  "effort",
  "permission_mode",
  "limits.tokens_per_day",
  "limits.sessions_at_once",
  "limits.delegation_depth",
] as const);
export type AgentSetField = (typeof AGENT_SET_FIELDS)[number];

/**
 * The fields `set` takes for Wright (phase 5 item 07), in the contract's
 * `WrightSetField` order. Every other field (`permission_mode`, `tool_policy`,
 * ...) stays the owner's hand edit of `wright.json`: refused `reserved`.
 */
export const WRIGHT_SET_FIELDS = Object.freeze([
  "model",
  "effort",
  "limits.tokens_per_day",
  "limits.sessions_at_once",
  "limits.delegation_depth",
] as const);
export type WrightSetField = (typeof WRIGHT_SET_FIELDS)[number];

/** The value that clears `effort` or a limit (unset = no limit). */
export const CLEAR_VALUE = "none";

/** One roster entry, as `GET /agents` answers it. */
export interface RosterEntry {
  readonly id: string;
  readonly display_name: string;
  readonly avatar: { readonly shape: string; readonly hue: string };
  readonly status: string;
  /** Null for Wright (it has no row). */
  readonly created_by: string | null;
  readonly approval_id: number | null;
  readonly model: string | null;
  /** The settings reader's refusal code when the file does not read ok; null otherwise. */
  readonly settings_error: string | null;
  /** Today's counted tokens (the budget's per-agent day total, the host's local day). */
  readonly tokens_today: number;
  /** Null: no limit. */
  readonly tokens_per_day: number | null;
  /** Sessions `starting` or `running` for this agent. */
  readonly sessions_running: number;
  /** Null: no limit. */
  readonly sessions_at_once: number | null;
}

/** True when anything is at `path`. */
function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function sessionsRunning(store: Store, agent: string): number {
  return store.prepare<[string], number>("SELECT COUNT(*) FROM sessions WHERE agent = ? AND status IN ('starting', 'running')").pluck().get(agent) ?? 0;
}

/**
 * Wright's entry. Its settings are read only when `wright.json` exists, so a
 * listing never creates it (the brain's first message, `POST /ask` or the
 * first Wright `set` does). Its limits are the ones the budget and the
 * delegate part apply: the file's, also when it has no model yet (the reader
 * returns them with `model_unset`); null when unset or the file is absent.
 */
function wrightEntry(store: Store, now: Date): RosterEntry {
  const dataDir = store.dataDir;
  const read = exists(agentSettingsPath(dataDir, WRIGHT_ID)) ? readAgentSettings(dataDir, WRIGHT_ID) : undefined;
  const wrightLimits = read === undefined ? undefined : read.ok ? read.settings.limits : read.error === "model_unset" ? read.limits : undefined;
  return {
    id: WRIGHT_ID,
    display_name: "Wright",
    avatar: { shape: "whale", hue: "accent" },
    status: "active",
    created_by: null,
    approval_id: null,
    model: read?.ok === true ? read.settings.model : null,
    settings_error: read === undefined || read.ok ? null : read.error,
    tokens_today: agentCountedTokens(store, WRIGHT_ID, localDay(now)),
    tokens_per_day: wrightLimits?.tokens_per_day ?? null,
    sessions_running: sessionsRunning(store, WRIGHT_ID),
    sessions_at_once: wrightLimits?.sessions_at_once ?? null,
  };
}

/** A member's entry: its row, then what its settings file says (the file wins over `charter_json`). */
function memberEntry(store: Store, row: AgentRow, now: Date, homeDir: string): RosterEntry {
  const read = readAgentSettings(store.dataDir, row.id, { homeDir });
  return {
    id: row.id,
    display_name: row.display_name,
    avatar: { shape: row.avatar_shape, hue: row.avatar_hue },
    status: row.status,
    created_by: row.created_by,
    approval_id: row.approval_id,
    model: read.ok ? read.settings.model : null,
    settings_error: read.ok ? null : read.error,
    tokens_today: agentCountedTokens(store, row.id, localDay(now)),
    tokens_per_day: read.ok ? (read.settings.limits?.tokens_per_day ?? null) : null,
    sessions_running: sessionsRunning(store, row.id),
    sessions_at_once: read.ok ? (read.settings.limits?.sessions_at_once ?? null) : null,
  };
}

/** Wright, then every registered member (active and off) in id order. */
export function rosterOf(store: Store, now: Date, homeDir: string = homedir()): RosterEntry[] {
  const members = listAgents(store).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [wrightEntry(store, now), ...members.map((row) => memberEntry(store, row, now, homeDir))];
}

// ---- The owner's routes ---------------------------------------------------------

type Body = Record<string, unknown>;

function isBodyObject(body: unknown): body is Body {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

function refusal(status: number, error: string, message: string, extra: Body = {}): ContributedRouteResponse {
  return { status, body: { error, ...extra, message } };
}

/**
 * The crew member `req.params.id` names, or the refusal: `reserved` for
 * Wright (its settings are `wright.json`, which the owner edits; `instead`
 * says what to do), `agent_id_invalid`, `not_found`.
 */
function memberOf(req: ContributedRouteRequest, instead: string): AgentRow | ContributedRouteResponse {
  const id = req.params.id ?? "";
  if (id === WRIGHT_ID) {
    return refusal(409, "reserved", `Wright is not a crew member: ${instead} ${agentSettingsPath(req.store.dataDir, WRIGHT_ID)}`);
  }
  const quoted = JSON.stringify(id.slice(0, 64));
  if (!isValidAgentId(id)) return refusal(400, "agent_id_invalid", `id ${quoted} is not a crew member's id`);
  const row = getAgent(req.store, id);
  return row === undefined ? refusal(404, "not_found", `no crew member ${id}`) : row;
}

function isRow(value: AgentRow | ContributedRouteResponse): value is AgentRow {
  return "charter_json" in value;
}

/** The settings file's parsed content, or null when it is absent, too large or not JSON. */
function settingsContent(file: string): unknown {
  try {
    if (statSync(file).size > MAX_SETTINGS_BYTES) return null;
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/** The charter's prose sections from `charter_json`, or null when it does not parse. */
function charterProse(row: AgentRow): { persona: unknown; duties: unknown; boundaries: unknown } | null {
  try {
    const c = JSON.parse(row.charter_json) as Body;
    return isBodyObject(c) ? { persona: c.persona ?? null, duties: c.duties ?? null, boundaries: c.boundaries ?? null } : null;
  } catch {
    return null;
  }
}

async function show(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const row = memberOf(req, "its settings are");
  if (!isRow(row)) return row;
  const dataDir = req.store.dataDir;
  const homeDir = homedir();
  const read = readAgentSettings(dataDir, row.id, { homeDir });
  const paths = agentFilePaths(dataDir, row.id);
  return {
    status: 200,
    body: {
      agent: memberEntry(req.store, row, req.now(), homeDir),
      settings: {
        file: paths.settings,
        content: settingsContent(paths.settings),
        error: read.ok ? null : { error: read.error, ...("field" in read ? { field: read.field } : {}), message: read.message },
      },
      never: read.ok ? [...(read.settings.never ?? [])] : null,
      workspaces: read.ok ? [...(read.settings.workspaces ?? [])] : null,
      memory: { dir: paths.memoryDir, files: CREW_MEMORY_FILES.map((name, i) => ({ name, path: paths.memory[i], present: exists(paths.memory[i] as string) })) },
      charter: charterProse(row),
    },
  };
}

async function create(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  if (!isBodyObject(req.body)) return refusal(400, "invalid_body", "the body must be a charter (a JSON object)");
  const r = createAgent(req.store, req.store.dataDir, req.body, { by: "owner" }, req.now());
  if (r.ok) return { status: 201, body: { agent: r.agent, files: r.files, files_error: r.filesError } };
  if (r.error === "files_exist") return refusal(409, r.error, r.message, { file: r.file });
  return refusal(r.error === "id_taken" ? 409 : 400, r.error, r.message, { field: r.field });
}

async function rename(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const row = memberOf(req, "it is named Wright; its settings are");
  if (!isRow(row)) return row;
  const name = isBodyObject(req.body) ? req.body.display_name : undefined;
  const checked = displayNameSchema.safeParse(name);
  if (!checked.success) return refusal(400, "invalid_input", `display_name: ${checked.error.issues[0]?.message ?? "invalid"}`, { field: "display_name" });
  if (checked.data === row.display_name) return { status: 200, body: { agent: row, changed: false } };
  const at = req.now().toISOString();
  req.store.transaction(() => {
    req.store.prepare("UPDATE agents SET display_name = ?, updated_at = ? WHERE id = ?").run(checked.data, at, row.id);
    appendEvent(req.store, "agent_renamed" satisfies AgentAuditKind, NO_REF, { id: row.id, old: row.display_name, new: checked.data }, at);
  });
  return { status: 200, body: { agent: getAgent(req.store, row.id), changed: true } };
}

function statusRoute(status: AgentStatus): (req: ContributedRouteRequest) => Promise<ContributedRouteResponse> {
  return async (req) => {
    const row = memberOf(req, "it is always on; its settings are");
    if (!isRow(row)) return row;
    if (req.body !== undefined && !isBodyObject(req.body)) return refusal(400, "invalid_body", "the body must be empty or a JSON object");
    if (row.status === status) return { status: 200, body: { agent: row, changed: false } };
    const at = req.now().toISOString();
    req.store.transaction(() => {
      req.store.prepare("UPDATE agents SET status = ?, updated_at = ? WHERE id = ?").run(status, at, row.id);
      appendEvent(req.store, "agent_status_changed" satisfies AgentAuditKind, NO_REF, { id: row.id, old: row.status, new: status, by: "owner" }, at);
    });
    return { status: 200, body: { agent: getAgent(req.store, row.id), changed: true } };
  };
}

/** `raw` (as typed on the CLI) as `field`'s value: null clears; a message when it is refused. */
function parseSetValue(field: AgentSetField, raw: string): { readonly value: string | number | null } | { readonly message: string } {
  if (field === "model") {
    if (raw === CLEAR_VALUE) return { message: "model can't be cleared: the kernel never picks one" };
    return modelSchema.safeParse(raw).success ? { value: raw } : { message: "model must be 1-200 characters with no whitespace, control or bidi character" };
  }
  if (field === "effort") {
    if (raw === CLEAR_VALUE) return { value: null };
    return effortSchema.safeParse(raw).success ? { value: raw } : { message: "effort must be 1-64 characters with no whitespace, control or bidi character, or none" };
  }
  if (field === "permission_mode") {
    return (CHARTER_PERMISSION_MODES as readonly string[]).includes(raw) ? { value: raw } : { message: `permission_mode must be one of ${CHARTER_PERMISSION_MODES.join(", ")}` };
  }
  if (raw === CLEAR_VALUE) return { value: null };
  const n = Number(raw);
  return /^[1-9]\d{0,15}$/.test(raw) && Number.isSafeInteger(n) ? { value: n } : { message: `${field} must be a positive whole number, or none (no limit)` };
}

/** `field`'s value in the parsed settings `json`; null when absent. */
function valueAt(json: Body, field: AgentSetField): unknown {
  if (!field.startsWith("limits.")) return json[field] ?? null;
  const limits = json.limits;
  return isBodyObject(limits) ? (limits[field.slice("limits.".length)] ?? null) : null;
}

/** A copy of `json` with only `field` changed: null deletes the key (`limits` itself stays). */
function withValue(json: Body, field: AgentSetField, value: string | number | null): Body {
  const next = structuredClone(json);
  if (!field.startsWith("limits.")) {
    if (value === null) delete next[field];
    else next[field] = value;
    return next;
  }
  const key = field.slice("limits.".length);
  const limits: Body = isBodyObject(next.limits) ? next.limits : {};
  if (value === null) delete limits[key];
  else limits[key] = value;
  next.limits = limits;
  return next;
}

/** The settings file changed between the read and the rename: nothing is written. */
class ConcurrentEditError extends Error {}

/** Wright's `set` refusal for a field it does not take: the reserved form, ending in the file's path. */
function wrightFieldReserved(dataDir: string): ContributedRouteResponse {
  const fields = `${WRIGHT_SET_FIELDS.slice(0, -1).join(", ")} or ${WRIGHT_SET_FIELDS[WRIGHT_SET_FIELDS.length - 1]}`;
  return refusal(409, "reserved", `Wright is not a crew member: set takes only ${fields} for it; edit the rest in ${agentSettingsPath(dataDir, WRIGHT_ID)}`);
}

async function set(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  // Wright is not a crew member (`memberOf` refuses it), but the owner sets its
  // `WRIGHT_SET_FIELDS` here through the one write path below (phase 5 item 07).
  const isWright = req.params.id === WRIGHT_ID;
  const row = isWright ? undefined : memberOf(req, "edit its settings in");
  if (row !== undefined && !isRow(row)) return row;
  if (!isBodyObject(req.body) || typeof req.body.field !== "string" || typeof req.body.value !== "string") {
    return refusal(400, "invalid_body", "the body is {field, value}, both strings (value as typed on the CLI; none clears effort or a limit)");
  }
  const dataDir = req.store.dataDir;
  const { field: rawField, value: raw } = req.body;
  // The field and the value are checked before any filesystem call, so a refused Wright
  // set never creates `wright.json` (the reader below creates it with `wx`).
  if (isWright) {
    if (!(WRIGHT_SET_FIELDS as readonly string[]).includes(rawField)) return wrightFieldReserved(dataDir);
  } else if (!(AGENT_SET_FIELDS as readonly string[]).includes(rawField)) {
    return refusal(400, "invalid_input", `field ${JSON.stringify(rawField.slice(0, 64))} is not one of ${AGENT_SET_FIELDS.join(", ")} (list fields are changed by editing the settings file)`, { field: "field" });
  }
  const field = rawField as AgentSetField;
  const parsed = parseSetValue(field, raw);
  if ("message" in parsed) return refusal(400, "invalid_input", parsed.message, { field });

  const id = row === undefined ? WRIGHT_ID : row.id;
  /** The answer's `agent`: a member's row, or Wright's roster entry (read after the write). */
  const agentOf = () => (row === undefined ? wrightEntry(req.store, req.now()) : row);
  const file = agentSettingsPath(dataDir, id);
  // Wright's file, when absent, is created with its default content by the one reader's
  // exclusive create (as the brain's first message creates it); a member's never is.
  if (isWright) readAgentSettings(dataDir, WRIGHT_ID);
  let base: Buffer;
  try {
    if (statSync(file).size > MAX_SETTINGS_BYTES) return refusal(409, "settings_invalid", `${file}: over ${MAX_SETTINGS_BYTES} bytes`, { file, field: "the file" });
    base = readFileSync(file);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ENOENT") return refusal(409, "settings_missing", `${file}: no settings file for ${id}`, { file });
    return refusal(409, "settings_invalid", `${file}: unreadable (${String(code ?? "error")})`, { file, field: "the file" });
  }
  // The whole file, through the one reader: a file it refuses is never rewritten. A file
  // with no model may still get one (its every other field already passed the reader).
  const check = readAgentSettings(dataDir, id, { homeDir: homedir() });
  if (!check.ok && !(check.error === "model_unset" && field === "model")) {
    return refusal(409, check.error, check.message, { ...("file" in check ? { file: check.file } : {}), ...("field" in check ? { field: check.field } : {}) });
  }
  let json: Body;
  try {
    const value = JSON.parse(base.toString("utf8")) as unknown;
    if (!isBodyObject(value)) return refusal(409, "settings_changed", `${file} changed while it was read; try again`, { file });
    json = value;
  } catch {
    return refusal(409, "settings_changed", `${file} changed while it was read; try again`, { file });
  }
  const old = valueAt(json, field);
  if (old === parsed.value) return { status: 200, body: { agent: agentOf(), field, old, new: parsed.value, changed: false } };
  const text = `${JSON.stringify(withValue(json, field, parsed.value), null, 2)}\n`;
  if (Buffer.byteLength(text) > MAX_SETTINGS_BYTES) return refusal(409, "settings_invalid", `${file}: the change would make it over ${MAX_SETTINGS_BYTES} bytes`, { file, field: "the file" });

  // A temporary sibling, then a rename over the file (atomic on one file system): a reader
  // sees the old file or the new one, never half of it. The rename runs inside the
  // transaction, just before its COMMIT, but a rename is not part of it: a kill -9 between
  // the two keeps the new file with no event (docs/architecture/agents.md, Honest limits).
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
  // A member's payload is {id, field, old, new}; Wright's names who set it (only the owner's route can).
  const eventBy = isWright ? { by: "owner" } : {};
  try {
    req.store.transaction(() => {
      // Re-read just before the rename: an owner's hand edit since the first read wins.
      if (!readFileSync(file).equals(base)) throw new ConcurrentEditError();
      appendEvent(req.store, "agent_settings_set" satisfies AgentAuditKind, NO_REF, { id, field, old, new: parsed.value, ...eventBy }, req.now().toISOString());
      renameSync(temp, file);
    });
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      // Already renamed or gone.
    }
    if (err instanceof ConcurrentEditError) return refusal(409, "settings_changed", `${file} changed while it was being set; nothing was written; try again`, { file });
    throw err;
  }
  return { status: 200, body: { agent: agentOf(), field, old, new: parsed.value, changed: true } };
}

export const rosterRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "GET", path: "/agents", handler: async (req) => ({ status: 200, body: { agents: rosterOf(req.store, req.now()) } }) },
  { method: "GET", path: "/agents/:id", handler: show },
  { method: "POST", path: "/agents", handler: create },
  { method: "POST", path: "/agents/:id/rename", handler: rename },
  { method: "POST", path: "/agents/:id/set", handler: set },
  { method: "POST", path: "/agents/:id/off", handler: statusRoute("off") },
  { method: "POST", path: "/agents/:id/on", handler: statusRoute("active") },
]);

// ---- The owner's verbs ----------------------------------------------------------

export const ROSTER_VERB_HELP = Object.freeze({
  list: "studio agents list [--json]",
  show: "studio agents show <id> [--json]",
  create: "studio agents create --from <file>",
  rename: "studio agents rename <id> <display name>",
  set: "studio agents set <id> <field> <value>",
  off: "studio agents off <id>",
  on: "studio agents on <id>",
});

type EntryLike = Partial<Record<keyof RosterEntry, unknown>>;

/** A stored value for a terminal: `-` when absent, else escaped. */
function field(value: unknown): string {
  return value === null || value === undefined ? "-" : shown(String(value));
}

/** `<n>/<limit>`, or `<n> (no limit)` when unset. */
function against(count: unknown, max: unknown): string {
  return max === null || max === undefined ? `${field(count ?? 0)} (no limit)` : `${field(count ?? 0)}/${field(max)}`;
}

/** One roster line: id, display name, avatar, status, model, today's tokens, sessions and who created it. */
function rosterLine(e: EntryLike): string {
  const avatar = (isBodyObject(e.avatar) ? e.avatar : {}) as { shape?: unknown; hue?: unknown };
  const model = e.settings_error !== null && e.settings_error !== undefined ? `settings ${field(e.settings_error)}` : e.model === null || e.model === undefined ? "model not set" : `model ${field(e.model)}`;
  return (
    `${field(e.id)} "${shown(String(e.display_name ?? ""))}" ${field(avatar.shape)} ${field(avatar.hue)}: ${field(e.status)}; ${model}; ` +
    `tokens today ${against(e.tokens_today, e.tokens_per_day)}; sessions ${against(e.sessions_running, e.sessions_at_once)}; created by ${field(e.created_by)}`
  );
}

/** The roster: one line per agent, Wright first. */
export function formatRoster(entries: readonly EntryLike[]): string {
  const lines = entries.map(rosterLine);
  if (entries.length <= 1) lines.push("no crew members (studio agents create --from <file> adds one)");
  return `${lines.join("\n")}\n`;
}

/** Lines of stored prose, each escaped and indented. */
function proseLines(value: unknown, indent: string, bullet: boolean): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split("\n") : [];
  if (items.length === 0) return [`${indent}-`];
  return items.map((item) => `${indent}${bullet ? "- " : ""}${field(item)}`);
}

/** One crew member in full: its roster line, its settings file, never list, workspaces, memory files and charter prose. */
export function formatAgent(body: Body): string {
  const settings = (isBodyObject(body.settings) ? body.settings : {}) as { file?: unknown; content?: unknown; error?: unknown };
  const memory = (isBodyObject(body.memory) ? body.memory : {}) as { dir?: unknown; files?: unknown };
  const charter = isBodyObject(body.charter) ? body.charter : null;
  const list = (value: unknown): string => (value === null || value === undefined ? "- (the settings file does not read ok)" : Array.isArray(value) && value.length > 0 ? value.map(field).join(", ") : "none");
  const lines = [rosterLine((isBodyObject(body.agent) ? body.agent : {}) as EntryLike), `  settings: ${field(settings.file)} (edit it to change tool_policy, never or workspaces)`];
  if (isBodyObject(settings.error)) lines.push(`  settings error: ${field(settings.error.error)}: ${field(settings.error.message)}`);
  lines.push(settings.content === null || settings.content === undefined ? "    (unreadable)" : payloadText(settings.content, "    "));
  lines.push(`  never: ${list(body.never)}`, `  workspaces: ${list(body.workspaces)}`, `  memory: ${field(memory.dir)}`);
  for (const f of Array.isArray(memory.files) ? (memory.files as { name?: unknown; path?: unknown; present?: unknown }[]) : []) {
    lines.push(`    ${field(f.name)}: ${field(f.path)}${f.present === true ? "" : " (missing)"}`);
  }
  if (charter === null) lines.push("  charter: (charter_json does not parse)");
  else lines.push("  persona:", ...proseLines(charter.persona, "    ", false), "  duties:", ...proseLines(charter.duties, "    ", true), "  boundaries:", ...proseLines(charter.boundaries, "    ", true));
  return `${lines.join("\n")}\n`;
}

function errorOf(body: unknown): string {
  const error = (isBodyObject(body) ? body.error : undefined) ?? "unknown";
  return typeof error === "string" && /^[a-z_]{1,64}$/.test(error) ? error : "unknown";
}

/** A refusal as one line: its code, then its message (escaped) when it has one. */
function refusalOf(body: unknown): string {
  const message = isBodyObject(body) ? body.message : undefined;
  return typeof message === "string" && message !== "" ? `${errorOf(body)}: ${shown(message)}` : errorOf(body);
}

/** One stderr line and exit 2: a usage error, before any API call. */
function usage(out: CliSubcommandOutput, help: string, extra = ""): number {
  out.stderr.write(`usage: ${help}${extra}\n`);
  return 2;
}

/** An id argument: present and not a flag (the API checks the rest). */
function idArg(raw: string | undefined): raw is string {
  return raw !== undefined && raw !== "" && !raw.startsWith("-");
}

/** A change's answer: one line on stdout (0), or the refusal on stderr (1). */
function report(res: { readonly status: number; readonly body: unknown }, method: string, path: string, out: CliSubcommandOutput, ok: (body: Body) => string, failed: string): number {
  if (res.status === 200 || res.status === 201) {
    out.stdout.write(`studio: ${ok(isBodyObject(res.body) ? res.body : {})}\n`);
    return 0;
  }
  if (res.status >= 400 && res.status < 500) out.stderr.write(`studio: ${failed}: ${refusalOf(res.body)}\n`);
  else out.stderr.write(`studio: kernel API answered ${res.status} to ${method} ${path}\n`);
  return 1;
}

/** `list [--json]` and `show <id> [--json]`'s flag. */
function jsonFlag(args: readonly string[]): boolean | undefined {
  if (args.length === 0) return false;
  return args.length === 1 && args[0] === "--json" ? true : undefined;
}

const listVerb: AgentVerb = {
  name: "list",
  help: ROSTER_VERB_HELP.list,
  async run(args: readonly string[], client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
    const json = jsonFlag(args);
    if (json === undefined) return usage(out, ROSTER_VERB_HELP.list);
    const res = await client.request("GET", "/agents");
    const agents = res.status === 200 && isBodyObject(res.body) ? res.body.agents : undefined;
    if (!Array.isArray(agents)) {
      out.stderr.write(res.status === 200 ? "studio: kernel API sent an unreadable answer to GET /agents\n" : `studio: kernel API answered ${res.status} to GET /agents\n`);
      return 1;
    }
    out.stdout.write(json ? `${JSON.stringify(res.body, null, 2)}\n` : formatRoster(agents as EntryLike[]));
    return 0;
  },
};

const showVerb: AgentVerb = {
  name: "show",
  help: ROSTER_VERB_HELP.show,
  async run(args, client, out) {
    const [id, ...rest] = args;
    const json = jsonFlag(rest);
    if (!idArg(id) || json === undefined) return usage(out, ROSTER_VERB_HELP.show);
    const path = `/agents/${encodeURIComponent(id)}`;
    const res = await client.request("GET", path);
    if (res.status === 200 && isBodyObject(res.body) && isBodyObject(res.body.agent)) {
      out.stdout.write(json ? `${JSON.stringify(res.body, null, 2)}\n` : formatAgent(res.body));
      return 0;
    }
    if (res.status >= 400 && res.status < 500) out.stderr.write(`studio: no agent ${shown(id)} shown: ${refusalOf(res.body)}\n`);
    else out.stderr.write(res.status === 200 ? `studio: kernel API sent an unreadable answer to GET ${path}\n` : `studio: kernel API answered ${res.status} to GET ${path}\n`);
    return 1;
  },
};

const createVerb: AgentVerb = {
  name: "create",
  help: ROSTER_VERB_HELP.create,
  async run(args, client, out) {
    const [flag, file, ...rest] = args;
    if (flag !== "--from" || file === undefined || file === "" || rest.length > 0) return usage(out, ROSTER_VERB_HELP.create);
    let charter: unknown;
    try {
      if (statSync(file).size > MAX_CHARTER_BYTES) {
        out.stderr.write(`studio: ${shown(file)} is over ${MAX_CHARTER_BYTES} bytes: not a charter\n`);
        return 1;
      }
      charter = JSON.parse(readFileSync(file, "utf8")) as unknown;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      out.stderr.write(err instanceof SyntaxError ? `studio: ${shown(file)} is not JSON: ${shown(err.message)}\n` : `studio: can't read ${shown(file)} (${shown(String(code ?? errorMessage(err)))})\n`);
      return 1;
    }
    const res = await client.request("POST", "/agents", charter);
    const code = report(
      res,
      "POST",
      "/agents",
      out,
      (b) => {
        const agent = (isBodyObject(b.agent) ? b.agent : {}) as Partial<AgentRow>;
        const files = Array.isArray(b.files) ? b.files.map(field).join(", ") : "-";
        return `agent ${field(agent.id)} created (${field(agent.status)}, created by ${field(agent.created_by)}): ${files}`;
      },
      "agent not created",
    );
    const filesError = isBodyObject(res.body) ? res.body.files_error : undefined;
    if (code === 0 && typeof filesError === "string") out.stderr.write(`studio: warning: a file was not written (${shown(filesError)}); it is re-created from the charter before the agent's next message\n`);
    return code;
  },
};

const renameVerb: AgentVerb = {
  name: "rename",
  help: ROSTER_VERB_HELP.rename,
  async run(args, client, out) {
    const [id, name, ...rest] = args;
    if (!idArg(id) || name === undefined || rest.length > 0) return usage(out, ROSTER_VERB_HELP.rename);
    const path = `/agents/${encodeURIComponent(id)}/rename`;
    const res = await client.request("POST", path, { display_name: name });
    return report(
      res,
      "POST",
      path,
      out,
      (b) => (b.changed === false ? `agent ${shown(id)} is already named "${shown(name)}"` : `agent ${shown(id)} renamed "${shown(name)}"`),
      `agent ${shown(id)} not renamed`,
    );
  },
};

const setVerb: AgentVerb = {
  name: "set",
  help: ROSTER_VERB_HELP.set,
  async run(args, client, out) {
    const [id, name, value, ...rest] = args;
    if (!idArg(id) || name === undefined || value === undefined || rest.length > 0) {
      return usage(out, ROSTER_VERB_HELP.set, ` (field: ${AGENT_SET_FIELDS.join(", ")}; ${CLEAR_VALUE} clears effort or a limit)`);
    }
    const path = `/agents/${encodeURIComponent(id)}/set`;
    const res = await client.request("POST", path, { field: name, value });
    const shownValue = (v: unknown): string => (v === null || v === undefined ? (name.startsWith("limits.") ? "no limit" : "not set") : field(v));
    return report(
      res,
      "POST",
      path,
      out,
      (b) => (b.changed === false ? `agent ${shown(id)} ${shown(name)} was already ${shownValue(b.new)}` : `agent ${shown(id)} ${shown(name)} set to ${shownValue(b.new)} (was ${shownValue(b.old)})`),
      `agent ${shown(id)} not changed`,
    );
  },
};

function statusVerb(name: "off" | "on"): AgentVerb {
  const help = ROSTER_VERB_HELP[name];
  return {
    name,
    help,
    async run(args, client, out) {
      const [id] = args;
      if (!idArg(id) || args.length !== 1) return usage(out, help);
      const path = `/agents/${encodeURIComponent(id)}/${name}`;
      const res = await client.request("POST", path);
      return report(res, "POST", path, out, (b) => (b.changed === false ? `agent ${shown(id)} was already ${name}` : `agent ${shown(id)} turned ${name}`), `agent ${shown(id)} not turned ${name}`);
    },
  };
}

/** The owner's `studio agents` verbs, in help order. */
export const rosterVerbs: readonly AgentVerb[] = Object.freeze([listVerb, showVerb, createVerb, renameVerb, setVerb, statusVerb("off"), statusVerb("on")]);

export const rosterPart: AgentPart = Object.freeze({
  name: "roster",
  tools: Object.freeze([]),
  routes: rosterRoutes,
  verbs: rosterVerbs,
  handlers: Object.freeze({}),
});
