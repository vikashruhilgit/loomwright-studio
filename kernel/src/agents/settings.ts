// Every agent's settings file, `<dataDir>/config/agents/<id>.json`: the model,
// the permission mode, the tool policy, (optional) the connector grants
// (`connectors`, phase 6: which contributed tools marked `requiresConnector`
// its sessions list) and, for a crew member, (optional) the
// enforced `never` categories, limits and workspaces. Wright's file refuses
// `never` and `workspaces` until an item applies them to Wright's sessions;
// its `limits` are read (the budget applies `tokens_per_day` and
// `sessions_at_once` at admission, `./delegate.ts` applies `delegation_depth`).
// `readAgentSettings` is the ONE reader:
// Wright's (`readWrightSettings` in `../brain/settings.ts` is a thin call to
// it) and every crew member's, so every file is refused the same way.
//
// The `connectors` grant has two forms: an array of kinds (`["github"]`) and an
// object (`{github: "read" | "write", jira: ["<tool>", …], clickup: [...]}`).
// A jira or clickup grant is the object form only, because it names the MCP
// server's tools one by one (phase 8 item 06): `parseConnectorsGrant` reads
// both, `mergeConnectorsGrant` changes one kind's key and keeps the rest.
//
// Mechanism only (invariant 1): the kernel never picks a model, a limit, a
// workspace or a `never` category. Wright's file is created once, with
// exclusive create (`wx`), when absent; a crew member's file is never
// created here (its absence is `settings_missing`). A malformed file is a
// refusal naming it and the field, never a rewrite.
//
// Imports only zod, `node:*`, `../protected-paths.ts`, the leaf
// `../sessions/policy.ts` (for `NEVER_CATEGORIES`), the types-and-lists
// `../integrations/types.ts` (for `CONNECTOR_KINDS`), plus `../brain/settings.ts`
// for Wright's first-run text and the size limit (a cycle used only at call
// time: neither module reads the other's bindings at load). Never the Agent SDK, the session
// manager or `kernel.ts` (the `studio` CLI loads this module).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { MAX_SETTINGS_BYTES, defaultWrightSettingsJson } from "../brain/settings.js";
import { CONNECTOR_KINDS } from "../integrations/types.js";
import type { ConnectorKind } from "../integrations/types.js";
import { isInsidePath, isProtectedPath, protectedLocationsText } from "../protected-paths.js";
import { NEVER_CATEGORIES } from "../sessions/policy.js";
import type { NeverCategory } from "../sessions/policy.js";
import type { AllowedPermissionMode, ToolPolicy } from "../sessions/types.js";
import { RESERVED_AGENT_IDS, isValidAgentId } from "./types.js";

/** The lead agent's id: the only one whose settings file the kernel creates. */
const WRIGHT_ID = "wright";

/** `<dataDir>/config/agents/<id>.json` (no id check: callers check first). */
export function agentSettingsPath(dataDir: string, id: string): string {
  return join(dataDir, "config", "agents", `${id}.json`);
}

/** The session manager's permission modes (it refuses `bypassPermissions`, and so does this file). */
const PERMISSION_MODES = {
  default: true,
  acceptEdits: true,
  plan: true,
  dontAsk: true,
  auto: true,
} as const satisfies Record<AllowedPermissionMode, true>;

const permissionMode = z.enum(Object.keys(PERMISSION_MODES) as [AllowedPermissionMode, ...AllowedPermissionMode[]]);

/** A limit: a positive safe integer. */
const limit = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const toolPolicyShape = {
  status: z.string().optional(),
  allowedTools: z.array(z.string()),
  allowedBashPrefixes: z.array(z.string()),
};

const shape = {
  model: z.unknown().optional(),
  effort: z.string().nullable().optional(),
  permission_mode: permissionMode,
  tool_policy: z.object(toolPolicyShape),
  never: z.array(z.enum(NEVER_CATEGORIES)).optional(),
  // The owner's connector grants (the owner's `set` writes them, or the owner edits the file).
  // The array form only: the object form (`{github: "read" | "write", jira: [...]}`) is read apart
  // (`parseConnectorsGrant`), and the `jira`/`clickup` kinds parse here but the array form is refused there.
  connectors: z.array(z.enum(CONNECTOR_KINDS)).optional(),
  // Strict: a misspelt limit is refused, never silently unenforced.
  limits: z.object({ tokens_per_day: limit.optional(), sessions_at_once: limit.optional(), delegation_depth: limit.optional() }).strict().optional(),
  workspaces: z.array(z.string()).optional(),
};

/**
 * Wright's file: unknown keys are dropped, as they were before the crew
 * existed (its `never` and `workspaces` are refused by name below).
 */
const wrightSchema = z.object(shape);

/**
 * A crew member's file: strict at the top level and in `tool_policy`, so a
 * misspelt enforced setting (`nevr`, `Never`, `workspace`, `limit`, a
 * `tool_policy.never`) is refused, never read as ok and silently not applied.
 */
const crewSchema = z.object({ ...shape, tool_policy: z.object(toolPolicyShape).strict() }).strict();

/** The MCP connector kinds (D38): the kinds whose grant names server tools. Every `ConnectorKind` but `github`. */
export type McpGrantKind = Exclude<ConnectorKind, "github">;

const MCP_GRANT_KINDS: readonly McpGrantKind[] = Object.freeze(CONNECTOR_KINDS.filter((kind): kind is McpGrantKind => kind !== "github"));

/** The first MCP connector kind (`jira`, `clickup`) in `kinds`, or undefined. The one check the settings reader and the charter validator share. */
export function mcpGrantKindOf(kinds: Iterable<string>): McpGrantKind | undefined {
  for (const kind of kinds) if ((MCP_GRANT_KINDS as readonly string[]).includes(kind)) return kind as McpGrantKind;
  return undefined;
}

/** The server tools an agent is granted, per MCP kind: the server's own tool names (the owner's grant). Only a kind with a tool is present. */
export type McpToolGrantSet = Readonly<Partial<Record<McpGrantKind, readonly string[]>>>;

/** The object form of the `connectors` grant as it is stored. `github` is the level; `jira` and `clickup` are non-empty tool-name arrays. */
export interface ConnectorsObjectGrant {
  readonly github?: "read" | "write";
  readonly jira?: readonly string[];
  readonly clickup?: readonly string[];
}

/** What a `connectors` value grants, read. `connectors` lists the kinds (github first, then jira, clickup); `githubWrite` is true only for `github: "write"`. */
export interface ConnectorsGrant {
  readonly connectors: readonly ConnectorKind[];
  readonly githubWrite: boolean;
  readonly mcp: McpToolGrantSet;
}

export type ConnectorsGrantResult = { readonly ok: true; readonly grant: ConnectorsGrant } | { readonly ok: false; readonly message: string };

/** The most tools one kind's grant names, and the longest tool name: bounds on what an owner's file (or the CLI) can make the kernel carry. */
const MAX_GRANTED_TOOLS = 100;
const MAX_GRANTED_TOOL_NAME = 200;
// eslint-disable-next-line no-control-regex
const NO_CONTROL_OR_BIDI = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/;

const GRANT_FORMS = 'an array of connector kinds, or an object with "github" ("read" or "write") and "jira" / "clickup" (each a non-empty array of tool names)';

/** Why `tools` is not a usable list of server tool names, or undefined when it is. */
function toolListProblem(kind: McpGrantKind, tools: unknown): string | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return `${kind} must be a non-empty array of tool names (the ${kind} grant names its tools)`;
  if (tools.length > MAX_GRANTED_TOOLS) return `${kind} names more than ${MAX_GRANTED_TOOLS} tools`;
  for (const [i, tool] of tools.entries()) {
    if (typeof tool !== "string" || tool === "" || tool.length > MAX_GRANTED_TOOL_NAME || !NO_CONTROL_OR_BIDI.test(tool)) {
      return `${kind}.${i} must be a tool name (1-${MAX_GRANTED_TOOL_NAME} characters, no control or bidi character)`;
    }
  }
  return undefined;
}

/**
 * Reads a `connectors` value, the one reader of both forms (the settings
 * reader below, `mergeConnectorsGrant` and the roster's `set` call it):
 *
 * - the array form holds `github` (a `jira` / `clickup` entry is refused: its
 *   grant names tools, so it is the object form only);
 * - the object form holds `github` (`"read"` is the same as `["github"]`,
 *   `"write"` also sets `githubWrite`) and/or `jira` / `clickup`, each a
 *   non-empty array of the server's tool names. An unknown key, an empty
 *   object or any other value is refused.
 *
 * A refusal is never a silent drop: the grant the owner wrote is either read
 * whole or refused by name. Pure; `raw` is untrusted file content.
 */
export function parseConnectorsGrant(raw: unknown): ConnectorsGrantResult {
  const refuse = (message: string): ConnectorsGrantResult => ({ ok: false, message });
  if (Array.isArray(raw)) {
    const kinds: ConnectorKind[] = [];
    for (const kind of raw) {
      if (typeof kind !== "string" || !(CONNECTOR_KINDS as readonly string[]).includes(kind)) return refuse(`connectors must hold only ${CONNECTOR_KINDS.join(", ")}`);
      kinds.push(kind as ConnectorKind);
    }
    const mcpKind = mcpGrantKindOf(kinds);
    if (mcpKind !== undefined) return refuse(`the ${mcpKind} grant names its tools: write it as {"${mcpKind}": ["<tool>"]}, not as an entry in the array`);
    return { ok: true, grant: { connectors: Object.freeze(kinds), githubWrite: false, mcp: Object.freeze({}) } };
  }
  if (typeof raw !== "object" || raw === null) return refuse(`connectors must be ${GRANT_FORMS}`);
  const object = raw as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length === 0) return refuse(`connectors must be ${GRANT_FORMS}`);
  const unknownKey = keys.find((key) => !(CONNECTOR_KINDS as readonly string[]).includes(key));
  if (unknownKey !== undefined) return refuse(`connectors has an unknown key ${JSON.stringify(unknownKey.slice(0, 64))} (the keys are ${CONNECTOR_KINDS.join(", ")})`);
  const kinds: ConnectorKind[] = [];
  let githubWrite = false;
  const mcp: Partial<Record<McpGrantKind, readonly string[]>> = {};
  for (const kind of CONNECTOR_KINDS) {
    if (!Object.hasOwn(object, kind)) continue;
    const value = object[kind];
    if (kind === "github") {
      if (value !== "read" && value !== "write") return refuse('github must be "read" or "write" in the object form');
      githubWrite = value === "write";
    } else {
      const problem = toolListProblem(kind, value);
      if (problem !== undefined) return refuse(problem);
      mcp[kind] = Object.freeze([...new Set(value as string[])]);
    }
    kinds.push(kind);
  }
  return { ok: true, grant: { connectors: Object.freeze(kinds), githubWrite, mcp: Object.freeze(mcp) } };
}

/** One change the owner's `set` makes to the grant: github's level (null drops it) or one MCP kind's tools (null drops that key). */
export type ConnectorsGrantChange =
  | { readonly kind: "github"; readonly level: "read" | "write" | null }
  | { readonly kind: McpGrantKind; readonly tools: readonly string[] | null };

/**
 * The `connectors` value after `change`, from the file's current one: only that
 * kind's key changes and every other key is kept. Returns the value to store,
 * or null when nothing is left (the key is removed). Without an MCP key the
 * result is the legacy form (`["github"]`, or `{github: "write"}`), so a
 * grant that never held jira or clickup is written exactly as before; with one,
 * the object form. A `current` the reader refuses reads as no grant here; the
 * caller read the whole file through `readAgentSettings` first, so it is not
 * reached. Returns `current` itself when the change leaves the grant as it was.
 */
export function mergeConnectorsGrant(current: unknown, change: ConnectorsGrantChange): unknown {
  const read = current === undefined || current === null ? undefined : parseConnectorsGrant(current);
  const old = read?.ok === true ? read.grant : undefined;
  let level: "read" | "write" | undefined = old === undefined ? undefined : old.connectors.includes("github") ? (old.githubWrite ? "write" : "read") : undefined;
  const mcp: Partial<Record<McpGrantKind, readonly string[]>> = { ...(old?.mcp ?? {}) };
  if (change.kind === "github") level = change.level ?? undefined;
  else if (change.tools === null) delete mcp[change.kind];
  else mcp[change.kind] = Object.freeze([...new Set(change.tools)]);
  const next = canonicalGrant(level, mcp);
  const before = canonicalGrant(old !== undefined && old.connectors.includes("github") ? (old.githubWrite ? "write" : "read") : undefined, old?.mcp ?? {});
  return JSON.stringify(next) === JSON.stringify(before) && next !== null ? current : next;
}

/** The value stored for a grant: null when empty, the legacy form when only github is held, else the object form (github, jira, clickup order). */
function canonicalGrant(level: "read" | "write" | undefined, mcp: McpToolGrantSet): ConnectorsObjectGrant | readonly ["github"] | null {
  const kinds = MCP_GRANT_KINDS.filter((kind) => (mcp[kind]?.length ?? 0) > 0);
  if (kinds.length === 0) return level === undefined ? null : level === "read" ? ["github"] : { github: "write" };
  const object: { github?: "read" | "write"; jira?: readonly string[]; clickup?: readonly string[] } = {};
  if (level !== undefined) object.github = level;
  for (const kind of kinds) object[kind] = mcp[kind];
  return object;
}

/** The message for a malformed `jira:` / `clickup:` value of `studio agents set <id> connectors`. */
export const MCP_GRANT_VALUE_MESSAGE = "an MCP grant is <kind>:<tool>[,<tool>…] (the tool names the server lists), or <kind>:none to drop that kind";

/**
 * `raw` (the CLI's `connectors` value) as a change to one MCP kind's grant, when
 * it starts `jira:` or `clickup:`; undefined when it is not an MCP value (the
 * caller handles `github`, `github:write`, `none`). `<kind>:none` drops the key.
 * A malformed list (an empty tool name, a stray comma, a bad name) is the
 * `message`, never a partial grant.
 */
export function parseMcpGrantValue(raw: string): { readonly change: ConnectorsGrantChange } | { readonly message: string } | undefined {
  const colon = raw.indexOf(":");
  const kind = colon < 0 ? undefined : raw.slice(0, colon);
  if (kind === undefined || !(MCP_GRANT_KINDS as readonly string[]).includes(kind)) return undefined;
  const mcpKind = kind as McpGrantKind;
  const rest = raw.slice(colon + 1);
  if (rest === CLEAR_TOOLS) return { change: { kind: mcpKind, tools: null } };
  const tools = rest.split(",");
  const problem = toolListProblem(mcpKind, tools);
  return problem === undefined ? { change: { kind: mcpKind, tools } } : { message: `${MCP_GRANT_VALUE_MESSAGE} (${problem})` };
}

/** The value after `<kind>:` that drops that kind's grant (the roster's `none`, for one key). */
const CLEAR_TOOLS = "none";

/** The enforced limits an agent's file may set; each absent key is unset (the kernel picks none). */
export interface AgentLimits {
  readonly tokens_per_day?: number;
  readonly sessions_at_once?: number;
  readonly delegation_depth?: number;
}

/** Settings a session can start with. `never`, `limits`, `workspaces` and `connectors` are present only when the file sets them. */
export interface AgentSettings {
  readonly model: string;
  /** Recorded, not applied: the session manager has no effort option. */
  readonly effort: string | null;
  readonly permissionMode: AllowedPermissionMode;
  readonly policy: ToolPolicy;
  /** The policy's `status` label (`proposed` until the owner changes it); the policy applies whatever it says. */
  readonly policyStatus: string | null;
  readonly never?: readonly NeverCategory[];
  readonly limits?: AgentLimits;
  /** Absolute folders, none inside a macOS-protected folder, the data dir or inside it, or containing it. */
  readonly workspaces?: readonly string[];
  /** The connectors the owner granted this agent: its sessions list the contributed tools that require one of them (an MCP kind's tools only as `mcpGrants` names them). */
  readonly connectors?: readonly ConnectorKind[];
  /**
   * True only when the file's `connectors` is the object form with `github:
   * "write"` (the owner's GitHub write grant, which also grants the read
   * tools). Absent otherwise: the array form and `github: "read"` never grant write.
   */
  readonly githubWrite?: boolean;
  /** The server tools the owner granted, per MCP kind (the object form's `jira` / `clickup`). Present only when the file names some; `connectors` then lists those kinds too. */
  readonly mcpGrants?: McpToolGrantSet;
}

export type AgentSettingsRefusal =
  /**
   * The file has no usable `model` (null, empty or not a string): the owner
   * must set one. Everything else in it parsed and validated, so `limits` is
   * present when the file sets them: the budget applies an agent's limits
   * whether or not a model is set (a missing model is the session's refusal).
   */
  | {
      readonly ok: false;
      readonly error: "model_unset";
      readonly file: string;
      readonly field: "model";
      readonly message: string;
      readonly limits?: AgentLimits;
    }
  /** The file is not JSON, too large, unreadable, or not the expected shape. `field` is the offending path, or `the file`. Never rewritten. */
  | { readonly ok: false; readonly error: "settings_invalid"; readonly file: string; readonly field: string; readonly message: string }
  /** A crew member has no settings file. Nothing is created: the owner (or an approved charter) writes it. */
  | { readonly ok: false; readonly error: "settings_missing"; readonly file: string; readonly message: string }
  /** The id breaks the id grammar or is reserved. Nothing is read. */
  | { readonly ok: false; readonly error: "agent_id_invalid"; readonly message: string };

export type AgentSettingsResult = { readonly ok: true; readonly file: string; readonly settings: AgentSettings } | AgentSettingsRefusal;

export interface ReadAgentSettingsOptions {
  /** The home dir the protected folders are under (default `os.homedir()`); a seam for tests. */
  readonly homeDir?: string;
}

function hasCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/**
 * Why `workspace` may not be one, or undefined when it may. Containment is
 * `isInsidePath` (`../protected-paths.ts`), the one check, so every spelling
 * it maps onto the same folder (a symlink, case, the `/System/Volumes/Data`
 * firmlink) is refused here too. A workspace that holds the data dir (`/`, the
 * home dir) is refused as well: it would scope a crew member's work over it.
 */
function workspaceProblem(workspace: string, dataDir: string, homeDir: string): string | undefined {
  if (!isAbsolute(workspace)) return `${JSON.stringify(workspace)} is not an absolute path`;
  if (isProtectedPath(workspace, homeDir)) return `${workspace} is inside a macOS-protected folder (${protectedLocationsText()})`;
  if (isInsidePath(workspace, dataDir)) return `${workspace} is the data dir or inside it`;
  if (isInsidePath(dataDir, workspace)) return `${workspace} contains the data dir`;
  return undefined;
}

/**
 * An agent's settings, from `<dataDir>/config/agents/<id>.json`.
 *
 * - `wright`: creates the file (exclusive create, mode 0600, its directory
 *   0700) when it is absent BEFORE checking the model, so a `model_unset`
 *   refusal on a fresh data dir always names a file that exists.
 * - Any other id: one that fails `isValidAgentId` is `agent_id_invalid`
 *   before any filesystem call; a missing file is `settings_missing`, and
 *   nothing is created.
 *
 * Never throws for the file's content: a refusal names the file (and the
 * field). A failure to create Wright's directory or file is thrown (the data
 * dir itself is broken).
 */
export function readAgentSettings(dataDir: string, id: string, options: ReadAgentSettingsOptions = {}): AgentSettingsResult {
  const isWright = id === WRIGHT_ID;
  if (!isWright && !isValidAgentId(id)) {
    return {
      ok: false,
      error: "agent_id_invalid",
      message: `agent id ${JSON.stringify(id)} is not a crew member's id (a lowercase letter, then up to 31 lowercase letters, digits or hyphens; not ${RESERVED_AGENT_IDS.join(", ")})`,
    };
  }
  const file = agentSettingsPath(dataDir, id);
  if (isWright) {
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(file, defaultWrightSettingsJson(), { flag: "wx", mode: 0o600 });
    } catch (err) {
      if (!hasCode(err, "EEXIST")) throw err;
    }
  }
  const invalid = (field: string, what: string): AgentSettingsRefusal => ({ ok: false, error: "settings_invalid", file, field, message: `${file}: ${what}` });

  let raw: string;
  try {
    // Checked before reading, so a huge file is never loaded whole; and after, for one that grew meanwhile.
    if (statSync(file).size > MAX_SETTINGS_BYTES) return invalid("the file", `over ${MAX_SETTINGS_BYTES} bytes`);
    const buf = readFileSync(file);
    if (buf.length > MAX_SETTINGS_BYTES) return invalid("the file", `over ${MAX_SETTINGS_BYTES} bytes`);
    raw = buf.toString("utf8");
  } catch (err) {
    if (!isWright && hasCode(err, "ENOENT")) {
      return { ok: false, error: "settings_missing", file, message: `${file}: no settings file for agent ${JSON.stringify(id)} (the kernel never creates one for a crew member)` };
    }
    return invalid("the file", `unreadable (${String((err as { code?: unknown }).code ?? "error")})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid("the file", "not JSON");
  }
  // The object form of `connectors` is set apart so the schema (array form) still reports every other field first.
  const objectGrant =
    typeof json === "object" && json !== null && !Array.isArray(json) && typeof (json as { connectors?: unknown }).connectors === "object" && (json as { connectors?: unknown }).connectors !== null && !Array.isArray((json as { connectors?: unknown }).connectors)
      ? (json as { connectors: unknown }).connectors
      : undefined;
  let toParse = json;
  if (objectGrant !== undefined) {
    const { connectors: _objectForm, ...rest } = json as Record<string, unknown>;
    toParse = rest;
  }
  const parsed = (isWright ? wrightSchema : crewSchema).safeParse(toParse);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? "the file" : issue.path.join(".");
    // An unknown key names itself (zod's issue path stops at the object holding it).
    const what =
      issue?.code === "unrecognized_keys"
        ? `unknown key${issue.keys.length === 1 ? "" : "s"} ${issue.keys.map((k) => JSON.stringify(k)).join(", ")} (a misspelt setting is refused, never silently not applied)`
        : (issue?.message ?? "invalid");
    return invalid(where, `${where}: ${what}`);
  }
  const s = parsed.data;
  // Fail closed: nothing applies Wright's never or workspaces yet, so a file
  // that sets one is refused rather than read and silently unenforced. Its
  // limits are read: the budget applies tokens_per_day and sessions_at_once
  // at admission, and the delegate part (`./delegate.ts`) applies
  // delegation_depth to Wright's delegations.
  if (isWright) {
    for (const field of ["never", "workspaces"] as const) {
      if (s[field] !== undefined) return invalid(field, `${field}: not supported for Wright yet (the kernel does not apply it to Wright's sessions); remove it`);
    }
  }
  // Refused by name when it can't be read whole, never read and silently not applied.
  const grantRead = objectGrant === undefined && s.connectors === undefined ? undefined : parseConnectorsGrant(objectGrant ?? s.connectors);
  if (grantRead?.ok === false) return invalid("connectors", `connectors: ${grantRead.message}`);
  const grant = grantRead?.grant;
  if (s.workspaces !== undefined) {
    const homeDir = options.homeDir ?? homedir();
    for (const [i, workspace] of s.workspaces.entries()) {
      const problem = workspaceProblem(workspace, dataDir, homeDir);
      if (problem !== undefined) return invalid(`workspaces.${i}`, `workspaces.${i}: ${problem}`);
    }
  }
  if (typeof s.model !== "string" || s.model.trim() === "") {
    return {
      ok: false,
      error: "model_unset",
      file,
      field: "model",
      message: `${isWright ? "Wright" : `Agent ${id}`} has no model: set "model" in ${file} (the kernel never picks one)`,
      ...(s.limits !== undefined ? { limits: Object.freeze({ ...s.limits }) } : {}),
    };
  }
  return {
    ok: true,
    file,
    settings: {
      model: s.model.trim(),
      effort: s.effort ?? null,
      permissionMode: s.permission_mode,
      policy: { allowedTools: [...s.tool_policy.allowedTools], allowedBashPrefixes: [...s.tool_policy.allowedBashPrefixes] },
      policyStatus: s.tool_policy.status ?? null,
      ...(s.never !== undefined ? { never: Object.freeze([...s.never]) } : {}),
      ...(s.limits !== undefined ? { limits: Object.freeze({ ...s.limits }) } : {}),
      ...(s.workspaces !== undefined ? { workspaces: Object.freeze([...s.workspaces]) } : {}),
      ...(grant === undefined ? {} : { connectors: grant.connectors }),
      ...(grant?.githubWrite === true ? { githubWrite: true } : {}),
      ...(grant !== undefined && Object.keys(grant.mcp).length > 0 ? { mcpGrants: grant.mcp } : {}),
    },
  };
}
