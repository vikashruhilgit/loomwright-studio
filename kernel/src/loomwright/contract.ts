// Loomwright's published contract: `<installPath>/capabilities.json` (D32).
// The adapter reads only this file, never Loomwright's `plugin.json`, agent
// frontmatter, `hooks.json` or `CHANGELOG.md`: what Loomwright can do is what
// its contract says.
//
// The parsed contract is built field by field and nothing is spread from the
// raw JSON, so unknown fields at every level are dropped, never an error (a
// newer Loomwright may add fields). A missing, unreadable, malformed or
// too-old contract is a `LoomwrightContractError` naming the install and the
// reason. Imports only `node:*` and the dependency-free credential list (the
// `studio` CLI loads this module).
import { join } from "node:path";
import { isCredentialEnvVar } from "../auth/credential-env.js";
import { readBounded } from "./bounded-read.js";

/** The contract file's name inside a Loomwright install. */
export const CONTRACT_FILE = "capabilities.json";

/** The oldest `contract_schema_version` the adapter reads. */
export const MIN_CONTRACT_SCHEMA_VERSION = 1;

/** A contract file over this size is refused as `contract_unreadable` without being read. */
export const MAX_CONTRACT_BYTES = 4 * 1024 * 1024;

/** A host-switch variable name: an upper-case environment variable. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Process-control variables a host-switch name may never be: they decide what
 * the child runs, loads or where it resolves files and network traffic.
 */
const PROCESS_CONTROL_ENV_NAMES: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "PWD",
  "TMPDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
]);

/** Prefixes of process-control variables: the dynamic loaders' (`DYLD_*`, `LD_*`) and Node's (`NODE_OPTIONS`, `NODE_PATH`, ...). */
const PROCESS_CONTROL_ENV_PREFIXES: readonly string[] = ["DYLD_", "LD_", "NODE_"];

/**
 * Why `name` may not be a host-switch variable, or `undefined` when it may.
 * The contract is semi-trusted data (invariant 3): its host switch may never
 * name a credential or billing-routing variable the kernel strips
 * (`isCredentialEnvVar`), nor a process-control variable. No prefix is
 * required, so a later Loomwright may rename its switch.
 */
export function hostSwitchNameProblem(name: string): string | undefined {
  if (isCredentialEnvVar(name)) return "a credential or billing-routing variable the kernel strips";
  if (PROCESS_CONTROL_ENV_NAMES.has(name) || PROCESS_CONTROL_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return "a process-control variable";
  }
  return undefined;
}

/**
 * Every reason a `LoomwrightContractError` carries, in one closed list:
 *
 * - `contract_*`: the install's `capabilities.json` (`readLoomwrightContract`).
 * - `no_host_switch`: a valid contract without `host_switch` (`requireHostSwitch`).
 * - `installed_plugins_*`, `not_installed`, `ambiguous_install`,
 *   `install_path_invalid`: finding the active install
 *   (`resolveLoomwrightInstall` in `active-install.ts`).
 */
export const LOOMWRIGHT_CONTRACT_ERROR_REASONS = [
  "contract_missing",
  "contract_unreadable",
  "contract_not_json",
  "contract_invalid",
  "contract_schema_too_old",
  "no_host_switch",
  "installed_plugins_missing",
  "installed_plugins_unreadable",
  "not_installed",
  "ambiguous_install",
  "install_path_invalid",
] as const;

export type LoomwrightContractErrorReason = (typeof LOOMWRIGHT_CONTRACT_ERROR_REASONS)[number];

/** The adapter refuses a Loomwright install: `path` is the install (or the `installed_plugins.json` file) it is about. */
export class LoomwrightContractError extends Error {
  readonly code = "loomwright_contract_error";
  readonly reason: LoomwrightContractErrorReason;
  readonly path: string;

  constructor(reason: LoomwrightContractErrorReason, path: string, message: string) {
    super(message);
    this.name = "LoomwrightContractError";
    this.reason = reason;
    this.path = path;
  }
}

/** An agent, command or skill: its name and its one-line description (`null` when the contract has none). */
export interface LoomwrightContractEntry {
  readonly name: string;
  readonly description: string | null;
}

export interface LoomwrightResultSchema {
  readonly name: string;
  readonly schema_version: number | null;
}

/** One hook: only its event and what host mode does to it (its script, matcher and writes are dropped). */
export interface LoomwrightContractHook {
  readonly event: string;
  readonly host_mode: string;
}

/** The environment switch that keeps Loomwright's hooks out of the session's working tree. */
export interface LoomwrightHostSwitch {
  /** Set to `1` to turn host mode on. */
  readonly env: string;
  /** Names the directory hook state goes to in host mode. */
  readonly state_dir_env: string;
  /** Loomwright's own one-paragraph statement of what host mode does. */
  readonly effect: string;
}

/** The parsed contract: only the fields the adapter reads. */
export interface LoomwrightContract {
  readonly plugin_name: "loomwright";
  readonly plugin_version: string;
  readonly contract_schema_version: number;
  readonly agents: readonly LoomwrightContractEntry[];
  readonly commands: readonly LoomwrightContractEntry[];
  readonly skills: readonly LoomwrightContractEntry[];
  readonly result_schemas: readonly LoomwrightResultSchema[];
  readonly hooks: readonly LoomwrightContractHook[];
  /** `null` when the contract has none (an older Loomwright): `requireHostSwitch` refuses it. */
  readonly host_switch: LoomwrightHostSwitch | null;
}

type Raw = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Collapse a description to one line; empty ⇒ `null`. */
function oneLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const line = value.replace(/\s+/g, " ").trim();
  return line === "" ? null : line;
}

/**
 * Read and validate `<installPath>/capabilities.json`. Throws
 * `LoomwrightContractError` (`path` = `installPath`) when the file is missing
 * (`contract_missing`), unreadable or over 4 MiB (`contract_unreadable`), not
 * JSON (`contract_not_json`), not an object or missing / mistyping a required
 * field (`contract_invalid`, naming the field; also a host-switch name that
 * `hostSwitchNameProblem` refuses), or older than
 * `MIN_CONTRACT_SCHEMA_VERSION` (`contract_schema_too_old`). A contract
 * without `host_switch` is valid here (`host_switch: null`).
 */
export function readLoomwrightContract(installPath: string): LoomwrightContract {
  const file = join(installPath, CONTRACT_FILE);
  const fail = (reason: LoomwrightContractErrorReason, what: string): LoomwrightContractError =>
    new LoomwrightContractError(reason, installPath, `Loomwright at ${installPath}: ${what}`);

  const read = readBounded(file, MAX_CONTRACT_BYTES);
  if (read.kind === "missing") throw fail("contract_missing", `${CONTRACT_FILE} missing`);
  if (read.kind === "too_large") throw fail("contract_unreadable", `${CONTRACT_FILE} is over ${MAX_CONTRACT_BYTES} bytes`);
  if (read.kind === "error") throw fail("contract_unreadable", `${CONTRACT_FILE} unreadable (${read.detail})`);

  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch {
    throw fail("contract_not_json", `${CONTRACT_FILE} is not JSON`);
  }
  const invalid = (field: string, must: string): LoomwrightContractError => fail("contract_invalid", `${CONTRACT_FILE} invalid: ${field} ${must}`);
  if (!isObject(raw)) throw fail("contract_invalid", `${CONTRACT_FILE} invalid: not a JSON object`);

  // The schema version first: an older contract may differ in every other field.
  const schemaVersion = raw.contract_schema_version;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) throw invalid("contract_schema_version", "must be an integer");
  if (schemaVersion < MIN_CONTRACT_SCHEMA_VERSION) {
    throw fail("contract_schema_too_old", `${CONTRACT_FILE} contract_schema_version ${schemaVersion} is below the minimum ${MIN_CONTRACT_SCHEMA_VERSION}`);
  }
  if (raw.plugin_name !== "loomwright") throw invalid("plugin_name", 'must be "loomwright"');
  const pluginVersion = raw.plugin_version;
  if (!isNonEmptyString(pluginVersion)) throw invalid("plugin_version", "must be a non-empty string");

  const list = (field: string): readonly unknown[] => {
    const value = raw[field];
    if (!Array.isArray(value)) throw invalid(field, "must be an array");
    return value;
  };
  const entries = (field: string): LoomwrightContractEntry[] =>
    list(field).map((entry, i) => {
      if (!isObject(entry) || !isNonEmptyString(entry.name)) throw invalid(`${field}[${i}].name`, "must be a non-empty string");
      return { name: entry.name, description: oneLine(entry.description) };
    });

  const agents = entries("agents");
  const commands = entries("commands");
  const skills = entries("skills");
  const resultSchemas = list("result_schemas").map((entry, i): LoomwrightResultSchema => {
    if (!isObject(entry) || !isNonEmptyString(entry.name)) throw invalid(`result_schemas[${i}].name`, "must be a non-empty string");
    const version = entry.schema_version;
    return { name: entry.name, schema_version: typeof version === "number" && Number.isInteger(version) ? version : null };
  });
  const hooks = list("hooks").map((entry, i): LoomwrightContractHook => {
    if (!isObject(entry) || typeof entry.event !== "string") throw invalid(`hooks[${i}].event`, "must be a string");
    if (typeof entry.host_mode !== "string") throw invalid(`hooks[${i}].host_mode`, "must be a string");
    return { event: entry.event, host_mode: entry.host_mode };
  });

  let hostSwitch: LoomwrightHostSwitch | null = null;
  const rawSwitch = raw.host_switch;
  if (rawSwitch !== undefined && rawSwitch !== null) {
    if (!isObject(rawSwitch)) throw invalid("host_switch", "must be an object");
    const { env, state_dir_env: stateDirEnv, effect } = rawSwitch;
    if (typeof env !== "string" || !ENV_NAME.test(env)) throw invalid("host_switch.env", `must match ${ENV_NAME.source}`);
    if (typeof stateDirEnv !== "string" || !ENV_NAME.test(stateDirEnv)) throw invalid("host_switch.state_dir_env", `must match ${ENV_NAME.source}`);
    if (env === stateDirEnv) throw invalid("host_switch.state_dir_env", "must differ from host_switch.env");
    for (const [field, name] of [["host_switch.env", env], ["host_switch.state_dir_env", stateDirEnv]] as const) {
      const problem = hostSwitchNameProblem(name);
      if (problem !== undefined) throw invalid(field, `must not name ${name}: ${problem}`);
    }
    if (typeof effect !== "string") throw invalid("host_switch.effect", "must be a string");
    hostSwitch = { env, state_dir_env: stateDirEnv, effect };
  }

  return {
    plugin_name: "loomwright",
    plugin_version: pluginVersion,
    contract_schema_version: schemaVersion,
    agents,
    commands,
    skills,
    result_schemas: resultSchemas,
    hooks,
    host_switch: hostSwitch,
  };
}

/**
 * The contract's host switch. Studio runs Loomwright only in host mode, so a
 * contract without one is refused: `LoomwrightContractError`
 * (`no_host_switch`, `path` = `installPath`).
 */
export function requireHostSwitch(contract: LoomwrightContract, installPath: string): LoomwrightHostSwitch {
  if (contract.host_switch === null) {
    throw new LoomwrightContractError(
      "no_host_switch",
      installPath,
      `Loomwright at ${installPath}: ${CONTRACT_FILE} has no host_switch (Loomwright ${contract.plugin_version} cannot run in host mode)`,
    );
  }
  return contract.host_switch;
}
