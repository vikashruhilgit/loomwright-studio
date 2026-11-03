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
  // The owner's connector grants (edited in the file; `set` does not take them until phase 6 item 08).
  // The array form only: the object form `{github: "write"}` is checked apart
  // (`refuseUnbuiltConnectors`), and the `jira`/`clickup` kinds parse here but are refused there.
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

/** The connector kinds whose grant is refused until phase 8's later items land (`connector_not_built`). */
const UNBUILT_CONNECTORS: readonly string[] = ["jira", "clickup"];

/**
 * Phase 8 item 01 grows `CONNECTOR_KINDS` and plans the GitHub write grant
 * (`connectors: {github: "write"}`), but nothing applies either yet, so a file
 * that sets one is refused by name, never read and silently not applied:
 * `connector_not_built` for a `jira`/`clickup` grant (an array entry or an
 * object key), `github_write_not_built` for `github: "write"`. Any other
 * object form is refused too (`connectors` is an array of kinds). Returns the
 * refusal text, or undefined when the grant is the array form of built kinds.
 */
function unbuiltConnectorsProblem(raw: unknown, arrayForm: readonly string[] | undefined): string | undefined {
  if (arrayForm !== undefined) {
    const unbuilt = arrayForm.find((kind) => UNBUILT_CONNECTORS.includes(kind));
    return unbuilt === undefined ? undefined : `connector_not_built: the ${unbuilt} connector is not built yet; remove it from connectors`;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const grant = raw as Record<string, unknown>;
  const unbuilt = Object.keys(grant).find((kind) => UNBUILT_CONNECTORS.includes(kind));
  if (unbuilt !== undefined) return `connector_not_built: the ${unbuilt} connector is not built yet; remove it from connectors`;
  if (grant.github === "write") return "github_write_not_built: the GitHub write grant is not built yet; use connectors: [\"github\"] for the read grant";
  return 'connectors must be an array of connector kinds (the object form {github: "write"} is not built yet)';
}

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
  /** The connectors the owner granted this agent: its sessions list the contributed tools that require one of them. */
  readonly connectors?: readonly ConnectorKind[];
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
  const unbuilt = unbuiltConnectorsProblem(objectGrant, objectGrant === undefined ? s.connectors : undefined);
  if (unbuilt !== undefined) return invalid("connectors", `connectors: ${unbuilt}`);
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
      ...(s.connectors !== undefined ? { connectors: Object.freeze([...s.connectors]) } : {}),
    },
  };
}
