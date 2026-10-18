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
// `readWrightSettings` is the reader shared by `POST /ask`, the message
// handler and the playbook dry runs and fires, so all refuse the same files
// the same way. It is a thin call to the one reader every agent shares,
// `readAgentSettings` (`../agents/settings.ts`), which holds the schema, the
// size limit's check and the create-if-absent. Imports only `node:*`, types
// and `../agents/settings.js` (which imports zod, `node:*`, the leaf
// `../protected-paths.ts` and the leaf `../sessions/policy.ts`), never the
// Agent SDK, the session manager or `kernel.ts` (the `studio` CLI loads this
// module).
import { join } from "node:path";
import { readAgentSettings } from "../agents/settings.js";
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
  "mcp__kernel__kernel_agent_create",
  "mcp__kernel__kernel_agent_update",
  "mcp__kernel__kernel_agent_list",
  "mcp__kernel__kernel_agent_message",
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

/**
 * Wright's settings, from `<dataDir>/config/agents/wright.json`: a thin call
 * to the one reader, `readAgentSettings(dataDir, "wright")`
 * (`../agents/settings.ts`), which creates the file (exclusive create, mode
 * 0600) when it is absent BEFORE checking the model, so a `model_unset`
 * refusal on a fresh data dir always names a file that exists. The result
 * keeps this reader's own shapes: a `settings_invalid` refusal carries no
 * `field` key, and the settings carry only the five `WrightSettings` fields.
 * Never throws for the file's content: a refusal names the file (and, for
 * `model_unset`, the field). A failure to create the directory or file is
 * thrown (the data dir itself is broken).
 */
export function readWrightSettings(dataDir: string): WrightSettingsResult {
  const r = readAgentSettings(dataDir, "wright");
  if (r.ok) {
    const { model, effort, permissionMode, policy, policyStatus } = r.settings;
    return { ok: true, file: r.file, settings: { model, effort, permissionMode, policy, policyStatus } };
  }
  switch (r.error) {
    case "model_unset":
      return r;
    case "settings_invalid":
      return { ok: false, error: "settings_invalid", file: r.file, message: r.message };
    // Unreachable for `wright` (its file is created, and its id is the explicit Wright path); kept total.
    case "settings_missing":
      return { ok: false, error: "settings_invalid", file: r.file, message: r.message };
    case "agent_id_invalid":
      return { ok: false, error: "settings_invalid", file: wrightSettingsPath(dataDir), message: r.message };
  }
}
