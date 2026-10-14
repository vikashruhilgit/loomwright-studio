// What a Loomwright can do, from its contract: the `kernel_loomwright_capabilities`
// tool (for the calling session's own install) and a bounded manifest summary
// for Wright's context. Both are built field by field from the parsed
// contract, so nothing a hook does (its script, matcher, writes) and nothing
// about how the contract was built (`generated_by`) ever reaches a model.
// Imports only its siblings and the feature seam's `defineTool` (the `studio`
// CLI loads this module, so never the Agent SDK).
import { defineTool } from "../features/contribution.js";
import { readLoomwrightContract } from "./contract.js";
import type { LoomwrightContract, LoomwrightContractEntry } from "./contract.js";

/** The tool's output: exactly these fields. The only path in it is `install_path`. */
export interface LoomwrightCapabilities {
  readonly install_path: string;
  readonly plugin_version: string;
  readonly contract_schema_version: number;
  readonly agents: readonly LoomwrightContractEntry[];
  readonly commands: readonly LoomwrightContractEntry[];
  readonly skills: readonly LoomwrightContractEntry[];
  readonly result_schemas: readonly { readonly name: string; readonly schema_version: number | null }[];
  /** How many hooks each `host_mode` value covers (`redirects`, `skips`, `unaffected`, …), keys sorted. */
  readonly hooks_by_host_mode: Readonly<Record<string, number>>;
  readonly host_switch: { readonly env: string; readonly state_dir_env: string } | null;
}

const entries = (list: readonly LoomwrightContractEntry[]): LoomwrightContractEntry[] =>
  list.map((e) => ({ name: e.name, description: e.description }));

/** The capabilities of the Loomwright at `installPath` whose parsed contract is `contract`. */
export function loomwrightCapabilities(contract: LoomwrightContract, installPath: string): LoomwrightCapabilities {
  const counts = new Map<string, number>();
  for (const hook of contract.hooks) counts.set(hook.host_mode, (counts.get(hook.host_mode) ?? 0) + 1);
  // `Object.fromEntries` defines own properties, so a `__proto__` host mode is a key, never a prototype.
  const hooksByHostMode = Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const hostSwitch = contract.host_switch;
  return {
    install_path: installPath,
    plugin_version: contract.plugin_version,
    contract_schema_version: contract.contract_schema_version,
    agents: entries(contract.agents),
    commands: entries(contract.commands),
    skills: entries(contract.skills),
    result_schemas: contract.result_schemas.map((s) => ({ name: s.name, schema_version: s.schema_version })),
    hooks_by_host_mode: hooksByHostMode,
    host_switch: hostSwitch === null ? null : { env: hostSwitch.env, state_dir_env: hostSwitch.state_dir_env },
  };
}

/**
 * `kernel_loomwright_capabilities`: what the Loomwright the calling session
 * runs with can do, read fresh from that install's contract (the session
 * row's `loomwright_path`). No row or no recorded install is a throw, which
 * the tool server returns as an `isError` result.
 */
export const capabilitiesTool = defineTool({
  name: "kernel_loomwright_capabilities",
  description: "What the Loomwright this session runs with can do: version, contract schema, agents, commands, skills, result schemas, hook counts.",
  shape: {},
  handler: (_args, ctx) => {
    const installPath = ctx.sessions.getSession(ctx.sessionId)?.loomwright_path;
    if (installPath === undefined || installPath === null || installPath === "") {
      throw new Error(`kernel_loomwright_capabilities: session ${ctx.sessionId} has no recorded Loomwright install`);
    }
    return loomwrightCapabilities(readLoomwrightContract(installPath), installPath);
  },
});

/** Appended when the summary is cut; counted inside `maxChars`. */
export const MANIFEST_TRUNCATED_MARKER = " (truncated)";

export interface ManifestSummaryOptions {
  /** The summary's maximum length in characters, the marker included. Default 4000. */
  readonly maxChars?: number;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function group(label: string, list: readonly LoomwrightContractEntry[]): string {
  if (list.length === 0) return `${label}: (none)`;
  return `${label}: ${list.map((e) => (e.description === null ? oneLine(e.name) : `${oneLine(e.name)} — ${oneLine(e.description)}`)).join("; ")}`;
}

/**
 * A compact, bounded text manifest of `contract` for a model's context: a
 * header line (`Loomwright <version> (contract <n>)`), then one line each for
 * agents, commands, skills and result schemas (names, with their one-line
 * descriptions). Longer than `maxChars` ⇒ cut, ending in `(truncated)`.
 */
export function loomwrightManifestSummary(contract: LoomwrightContract, options: ManifestSummaryOptions = {}): string {
  const maxChars = options.maxChars ?? 4000;
  if (!Number.isInteger(maxChars) || maxChars < MANIFEST_TRUNCATED_MARKER.length) {
    throw new RangeError(`maxChars must be an integer of at least ${MANIFEST_TRUNCATED_MARKER.length}`);
  }
  const text = [
    `Loomwright ${oneLine(contract.plugin_version)} (contract ${contract.contract_schema_version})`,
    group("Agents", contract.agents),
    group("Commands", contract.commands),
    group("Skills", contract.skills),
    contract.result_schemas.length === 0 ? "Result schemas: (none)" : `Result schemas: ${contract.result_schemas.map((s) => oneLine(s.name)).join("; ")}`,
  ].join("\n");
  if (text.length <= maxChars) return text;
  let cut = text.slice(0, maxChars - MANIFEST_TRUNCATED_MARKER.length);
  // Never end on half a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}${MANIFEST_TRUNCATED_MARKER}`;
}
