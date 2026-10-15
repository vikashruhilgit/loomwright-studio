// Which Loomwright a session loads: the install Claude Code treats as active,
// read from `~/.claude/plugins/installed_plugins.json` (D32). The plugin cache
// is never scanned: it keeps every version ever installed (24 on 2026-10-14),
// and the newest folder is not necessarily the active one (17.0.0, briefly
// active on 2026-10-13, shipped without `capabilities.json`).
//
// `installed_plugins.json` is an internal Claude Code format (OPEN_QUESTIONS),
// so ALL of its parsing lives in `resolveLoomwrightInstall`, and any entry
// shape it does not know fails closed (`installed_plugins_unreadable`) rather
// than being guessed at. Imports only `node:*` (the `studio` CLI loads it).
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { readBounded } from "./bounded-read.js";
import { LOOMWRIGHT_CONTRACT_ERROR_REASONS, LoomwrightContractError, parseLoomwrightContract, readLoomwrightContractText } from "./contract.js";
import type { LoomwrightContract, LoomwrightContractErrorReason } from "./contract.js";

/** Where Claude Code records installed plugins. */
export function defaultInstalledPluginsPath(home: string = homedir()): string {
  return join(home, ".claude", "plugins", "installed_plugins.json");
}

/** An `installed_plugins.json` over this size is refused as `installed_plugins_unreadable`. */
const MAX_INSTALLED_PLUGINS_BYTES = 4 * 1024 * 1024;

/** A Loomwright key from any marketplace: `loomwright@atelier`, never `loomwright-lanes@atelier`. */
const LOOMWRIGHT_KEY = /^loomwright@[^@]+$/;

/**
 * Claude Code's scope precedence, highest first. "When the same plugin is set
 * at several scopes, the local setting overrides the project setting, and the
 * project setting overrides the user setting."
 * (https://code.claude.com/docs/en/plugins/install.md, "Choose an install
 * scope", read 2026-10-14.)
 */
const SCOPE_PRECEDENCE = ["local", "project", "user"] as const;
type Scope = (typeof SCOPE_PRECEDENCE)[number];

export interface ResolveLoomwrightInstallOptions {
  /** A configured Loomwright plugin dir. Non-empty wins, and must hold a valid contract: never a fallback. */
  readonly configured?: string;
  /** Defaults to `defaultInstalledPluginsPath()`. Tests always inject it. */
  readonly installedPluginsPath?: string;
  /** The session's working directory: `project` / `local` entries apply only when theirs equals it. */
  readonly projectPath?: string;
}

/** The install a session loads, with its parsed contract. */
export interface LoomwrightInstall {
  readonly installPath: string;
  readonly contract: LoomwrightContract;
  readonly source: "configured" | "installed_plugins";
  /** The winning entry's scope; `null` for a configured path. */
  readonly scope: string | null;
}

/** A `LoomwrightInstall` plus the exact `capabilities.json` text its `contract` was validated from. */
export interface LoomwrightInstallWithText extends LoomwrightInstall {
  readonly contractText: string;
}

/** Read the install's contract once and validate that same text: the same errors and messages as `readLoomwrightContract`. */
function readContract(installPath: string): { readonly contract: LoomwrightContract; readonly contractText: string } {
  const contractText = readLoomwrightContractText(installPath);
  return { contract: parseLoomwrightContract(contractText, installPath), contractText };
}

interface Candidate {
  readonly key: string;
  readonly scope: Scope;
  readonly installPath: string;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The Loomwright install a session loads, and its contract.
 *
 * A non-empty `configured` path wins (resolved to absolute): it must hold a
 * valid contract, and a bad one is an error, never a fallback to
 * `installed_plugins.json`. Otherwise the candidates are the entries under
 * every `loomwright@<marketplace>` key whose scope is `user`, or `project` /
 * `local` with a `projectPath` equal to `projectPath`; the highest scope
 * present wins (local > project > user), and two candidates at that scope are
 * `ambiguous_install` (never a guess). Throws `LoomwrightContractError`:
 * `installed_plugins_missing`, `installed_plugins_unreadable`,
 * `not_installed`, `ambiguous_install`, `install_path_invalid`, or any
 * `readLoomwrightContract` reason.
 */
export function resolveLoomwrightInstall(options: ResolveLoomwrightInstallOptions = {}): LoomwrightInstall {
  const { installPath, contract, source, scope } = resolveLoomwrightInstallWithText(options);
  return { installPath, contract, source, scope };
}

/**
 * `resolveLoomwrightInstall`, plus the contract text it read: the same
 * resolution, the same errors, and one read of `capabilities.json`, so a
 * caller that keeps the text (the version watcher) stores exactly the bytes
 * that were validated, with no second read for the file to change between.
 */
export function resolveLoomwrightInstallWithText(options: ResolveLoomwrightInstallOptions = {}): LoomwrightInstallWithText {
  const configured = options.configured;
  if (configured !== undefined && configured !== "") {
    const installPath = resolve(configured);
    return { installPath, ...readContract(installPath), source: "configured", scope: null };
  }

  const file = resolve(options.installedPluginsPath ?? defaultInstalledPluginsPath());
  const unreadable = (what: string): LoomwrightContractError =>
    new LoomwrightContractError("installed_plugins_unreadable", file, `${file}: ${what}`);

  const read = readBounded(file, MAX_INSTALLED_PLUGINS_BYTES);
  if (read.kind === "missing") {
    throw new LoomwrightContractError(
      "installed_plugins_missing",
      file,
      `${file} is missing, and no Loomwright path is configured`,
    );
  }
  if (read.kind === "too_large") throw unreadable(`over ${MAX_INSTALLED_PLUGINS_BYTES} bytes`);
  if (read.kind === "error") throw unreadable(`unreadable (${read.detail})`);
  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch {
    throw unreadable("not JSON");
  }
  if (!isObject(raw) || !isObject(raw.plugins)) throw unreadable("no plugins object");

  const project = options.projectPath === undefined ? undefined : resolve(options.projectPath);
  const candidates: Candidate[] = [];
  for (const [key, value] of Object.entries(raw.plugins)) {
    if (!LOOMWRIGHT_KEY.test(key)) continue;
    const bad = (what: string): LoomwrightContractError => unreadable(`plugins["${key}"] ${what}`);
    if (!Array.isArray(value)) throw bad("is not an array");
    value.forEach((entry: unknown, i) => {
      if (!isObject(entry)) throw bad(`[${i}] is not an object`);
      const { scope, installPath, version, projectPath } = entry;
      if (typeof scope !== "string") throw bad(`[${i}].scope is not a string`);
      if (typeof installPath !== "string" || !isAbsolute(installPath)) throw bad(`[${i}].installPath is not an absolute path`);
      if (typeof version !== "string") throw bad(`[${i}].version is not a string`);
      if (scope === "user") {
        candidates.push({ key, scope, installPath });
        return;
      }
      if (scope !== "project" && scope !== "local") throw bad(`[${i}] has an unknown scope ${JSON.stringify(scope)}`);
      if (typeof projectPath !== "string") throw bad(`[${i}] (scope ${scope}) has no string projectPath`);
      if (project !== undefined && resolve(projectPath) === project) candidates.push({ key, scope, installPath });
    });
  }

  if (candidates.length === 0) {
    throw new LoomwrightContractError("not_installed", file, `no loomwright@<marketplace> install applies in ${file}, and no Loomwright path is configured`);
  }
  // Highest scope present wins: `SCOPE_PRECEDENCE` is ordered highest first.
  const top = SCOPE_PRECEDENCE.find((s) => candidates.some((c) => c.scope === s)) as Scope;
  const winners = candidates.filter((c) => c.scope === top);
  if (winners.length > 1) {
    throw new LoomwrightContractError(
      "ambiguous_install",
      file,
      `${file} names ${winners.length} Loomwright installs at scope ${top}: ${winners.map((c) => `${c.key} ${c.scope} ${c.installPath}`).join("; ")}`,
    );
  }
  const winner = winners[0] as Candidate;
  if (!isDirectory(winner.installPath)) {
    throw new LoomwrightContractError(
      "install_path_invalid",
      winner.installPath,
      `${file} names ${winner.key} (${winner.scope}) at ${winner.installPath}, which is not a directory`,
    );
  }
  return { installPath: winner.installPath, ...readContract(winner.installPath), source: "installed_plugins", scope: winner.scope };
}

/** Every `LoomwrightAdapterStatus` error reason: the adapter's, plus `status_threw` for a status reader that threw. */
export const LOOMWRIGHT_ADAPTER_STATUS_REASONS = [...LOOMWRIGHT_CONTRACT_ERROR_REASONS, "status_threw"] as const;

export type LoomwrightAdapterStatusReason = LoomwrightContractErrorReason | "status_threw";

/** The adapter's state, as `GET /status` reports it. */
export type LoomwrightAdapterStatus =
  | {
      readonly status: "ok";
      readonly install_path: string;
      readonly plugin_version: string;
      readonly contract_schema_version: number;
      /** Whether the contract has a host switch (a session is refused without one). */
      readonly host_switch: boolean;
    }
  | {
      readonly status: "error";
      readonly reason: LoomwrightAdapterStatusReason;
      readonly path: string;
      readonly message: string;
    };

/** A clipped error message for `status_threw`. */
const MAX_STATUS_MESSAGE = 500;

/**
 * The adapter's state, resolved fresh on every call with no `projectPath`
 * (the user-scope view). Never throws: a refusal is `{status: "error"}` with
 * its reason, and an unexpected throw is `status_threw`.
 */
export function loomwrightAdapterStatus(options: Pick<ResolveLoomwrightInstallOptions, "configured" | "installedPluginsPath"> = {}): LoomwrightAdapterStatus {
  try {
    const { installPath, contract } = resolveLoomwrightInstall({ configured: options.configured, installedPluginsPath: options.installedPluginsPath });
    return {
      status: "ok",
      install_path: installPath,
      plugin_version: contract.plugin_version,
      contract_schema_version: contract.contract_schema_version,
      host_switch: contract.host_switch !== null,
    };
  } catch (err) {
    if (err instanceof LoomwrightContractError) return { status: "error", reason: err.reason, path: err.path, message: err.message };
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", reason: "status_threw", path: "", message: message.slice(0, MAX_STATUS_MESSAGE) };
  }
}
