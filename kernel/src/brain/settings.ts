// Wright's settings file, `<dataDir>/config/agents/wright.json`: the model,
// the permission mode and the tool policy its sessions run with. Outside
// `memory/` on purpose (a session's working directory is `memory/wright`).
// Nothing on this branch stops a session writing it: the session gate checks
// tool names only. The deny on session writes under `<dataDir>/config/` is
// item 05's (approval gate, PR #52) and is not here yet; until it merges, only
// the policy keeps a session out (the proposed one grants no write-capable tool).
//
// Mechanism only (invariant 1): the kernel never picks a model. A fresh file
// says `"model": null`, and a Wright message is refused (`model_unset`, naming
// the file and the field) until the owner sets one; the owner opens this file
// to do it, and sees the proposed tool policy there. The file is created once,
// with exclusive create (`wx`), and never overwritten: a malformed file is a
// refusal naming it, never a rewrite. `effort` is recorded for the owner but
// not applied (the session manager has no effort option).
//
// `readWrightSettings` is the ONE reader, shared by `POST /ask` and the
// message handler, so both refuse the same files the same way. Imports only
// zod, `node:*` and types (the `studio` CLI loads this module).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AllowedPermissionMode, ToolPolicy } from "../sessions/types.js";

/** `config/agents/wright.json`, relative to the data dir (named in every refusal). */
export const WRIGHT_SETTINGS_RELATIVE_PATH = join("config", "agents", "wright.json");

/** `<dataDir>/config/agents/wright.json`. */
export function wrightSettingsPath(dataDir: string): string {
  return join(dataDir, WRIGHT_SETTINGS_RELATIVE_PATH);
}

/** A settings file over this size is refused as `settings_invalid`. */
export const MAX_SETTINGS_BYTES = 64 * 1024;

/** The tool policy Wright proposes on a fresh data dir: kernel tools and read-only built-ins, no shell. */
export const PROPOSED_ALLOWED_TOOLS: readonly string[] = Object.freeze([
  "mcp__kernel__kernel_task_create",
  "mcp__kernel__kernel_task_update",
  "mcp__kernel__kernel_task_list",
  "mcp__kernel__kernel_task_get",
  "mcp__kernel__kernel_trigger_register",
  "mcp__kernel__kernel_trigger_remove",
  "mcp__kernel__kernel_trigger_list",
  "mcp__kernel__kernel_notify",
  "mcp__kernel__kernel_approval_request",
  "mcp__kernel__kernel_loomwright_capabilities",
  "mcp__kernel__kernel_playbook_create",
  "mcp__kernel__kernel_playbook_update",
  "mcp__kernel__kernel_playbook_list",
  "mcp__kernel__kernel_playbook_disable",
  "mcp__kernel__kernel_playbook_dry_run",
  "mcp__kernel__kernel_playbook_enable",
  "mcp__kernel__kernel_schedule_wakeup",
  "mcp__kernel__kernel_request_stop",
  "Read",
  "Glob",
  "Grep",
]);

/** The file written on a fresh data dir: no model (the owner picks one), the proposed tool policy. */
export function defaultWrightSettingsJson(): string {
  const settings = {
    model: null,
    effort: null,
    permission_mode: "default",
    tool_policy: { status: "proposed", allowedTools: [...PROPOSED_ALLOWED_TOOLS], allowedBashPrefixes: [] },
  };
  return `${JSON.stringify(settings, null, 2)}\n`;
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

const schema = z.object({
  model: z.unknown().optional(),
  effort: z.string().nullable().optional(),
  permission_mode: permissionMode,
  tool_policy: z.object({
    status: z.string().optional(),
    allowedTools: z.array(z.string()),
    allowedBashPrefixes: z.array(z.string()),
  }),
});

/** Settings a session can start with. */
export interface WrightSettings {
  readonly model: string;
  /** Recorded, not applied: the session manager has no effort option. */
  readonly effort: string | null;
  readonly permissionMode: AllowedPermissionMode;
  readonly policy: ToolPolicy;
  /** The policy's `status` label (`proposed` until the owner changes it); the policy applies whatever it says. */
  readonly policyStatus: string | null;
}

export type WrightSettingsRefusal =
  /** The file has no usable `model` (null, empty or not a string): the owner must set one. */
  | { readonly ok: false; readonly error: "model_unset"; readonly file: string; readonly field: "model"; readonly message: string }
  /** The file is not JSON, too large, unreadable, or not the expected shape. Never rewritten. */
  | { readonly ok: false; readonly error: "settings_invalid"; readonly file: string; readonly message: string };

export type WrightSettingsResult = { readonly ok: true; readonly file: string; readonly settings: WrightSettings } | WrightSettingsRefusal;

function hasCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/**
 * Wright's settings, from `<dataDir>/config/agents/wright.json`. Creates the
 * file (exclusive create, mode 0600) when it is absent BEFORE checking the
 * model, so a `model_unset` refusal on a fresh data dir always names a file
 * that exists. Never throws for the file's content: a refusal names the file
 * (and, for `model_unset`, the field). A failure to create the directory or
 * file is thrown (the data dir itself is broken).
 */
export function readWrightSettings(dataDir: string): WrightSettingsResult {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, defaultWrightSettingsJson(), { flag: "wx", mode: 0o600 });
  } catch (err) {
    if (!hasCode(err, "EEXIST")) throw err;
  }
  const invalid = (what: string): WrightSettingsRefusal => ({ ok: false, error: "settings_invalid", file, message: `${file}: ${what}` });

  let raw: string;
  try {
    // Checked before reading, so a huge file is never loaded whole; and after, for one that grew meanwhile.
    if (statSync(file).size > MAX_SETTINGS_BYTES) return invalid(`over ${MAX_SETTINGS_BYTES} bytes`);
    const buf = readFileSync(file);
    if (buf.length > MAX_SETTINGS_BYTES) return invalid(`over ${MAX_SETTINGS_BYTES} bytes`);
    raw = buf.toString("utf8");
  } catch (err) {
    return invalid(`unreadable (${String((err as { code?: unknown }).code ?? "error")})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return invalid("not JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined || issue.path.length === 0 ? "the file" : issue.path.join(".");
    return invalid(`${where}: ${issue?.message ?? "invalid"}`);
  }
  const s = parsed.data;
  if (typeof s.model !== "string" || s.model.trim() === "") {
    return {
      ok: false,
      error: "model_unset",
      file,
      field: "model",
      message: `Wright has no model: set "model" in ${file} (the kernel never picks one)`,
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
    },
  };
}
