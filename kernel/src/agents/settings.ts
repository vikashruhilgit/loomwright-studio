// Every agent's settings file, `<dataDir>/config/agents/<id>.json`: the model,
// the permission mode, the tool policy and, for a crew member, (optional) the
// enforced `never` categories, limits and workspaces (Wright's file refuses
// those three until an item applies them to Wright's sessions).
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
// Imports only zod, `node:*`, `../protected-paths.ts` and the leaf
// `../sessions/policy.ts` (for `NEVER_CATEGORIES`), plus `../brain/settings.ts`
// for Wright's first-run text and the size limit (a cycle used only at call
// time: neither module reads the other's bindings at load). Never the Agent SDK, the session
// manager or `kernel.ts` (the `studio` CLI loads this module).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { MAX_SETTINGS_BYTES, defaultWrightSettingsJson } from "../brain/settings.js";
import { isInsidePath, isProtectedPath, protectedLocationsText } from "../protected-paths.js";
import { NEVER_CATEGORIES } from "../sessions/policy.js";
import type { NeverCategory } from "../sessions/policy.js";
import type { AllowedPermissionMode, ToolPolicy } from "../sessions/types.js";
import { isValidAgentId } from "./types.js";

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

const schema = z.object({
  model: z.unknown().optional(),
  effort: z.string().nullable().optional(),
  permission_mode: permissionMode,
  tool_policy: z.object({
    status: z.string().optional(),
    allowedTools: z.array(z.string()),
    allowedBashPrefixes: z.array(z.string()),
  }),
  never: z.array(z.enum(NEVER_CATEGORIES)).optional(),
  // Strict: a misspelt limit is refused, never silently unenforced.
  limits: z.object({ tokens_per_day: limit.optional(), sessions_at_once: limit.optional(), delegation_depth: limit.optional() }).strict().optional(),
  workspaces: z.array(z.string()).optional(),
});

/** The enforced limits an agent's file may set; each absent key is unset (the kernel picks none). */
export interface AgentLimits {
  readonly tokens_per_day?: number;
  readonly sessions_at_once?: number;
  readonly delegation_depth?: number;
}

/** Settings a session can start with. `never`, `limits` and `workspaces` are present only when the file sets them. */
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
}

export type AgentSettingsRefusal =
  /** The file has no usable `model` (null, empty or not a string): the owner must set one. */
  | { readonly ok: false; readonly error: "model_unset"; readonly file: string; readonly field: "model"; readonly message: string }
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
      message: `agent id ${JSON.stringify(id)} is not a crew member's id (a lowercase letter, then up to 31 lowercase letters, digits or hyphens; not wright, shared or _unassigned)`,
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
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? "the file" : issue.path.join(".");
    return invalid(where, `${where}: ${issue?.message ?? "invalid"}`);
  }
  const s = parsed.data;
  // Fail closed: nothing applies Wright's never, limits or workspaces yet, so
  // a file that sets one is refused rather than read and silently unenforced.
  if (isWright) {
    for (const field of ["never", "limits", "workspaces"] as const) {
      if (s[field] !== undefined) return invalid(field, `${field}: not supported for Wright yet (the kernel does not apply it to Wright's sessions); remove it`);
    }
  }
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
    },
  };
}
