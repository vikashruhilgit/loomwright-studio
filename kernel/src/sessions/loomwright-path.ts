// The session side of the Loomwright adapter (D32): which install a session
// loads, and its host switch, as a `SessionError` the manager can refuse with.
// Finding the install and reading its contract is the adapter's
// (`../loomwright/`); this module only maps the adapter's refusal reasons to
// session error codes. The plugin cache is never scanned.
import { resolveLoomwrightInstall } from "../loomwright/active-install.js";
import type { ResolveLoomwrightInstallOptions } from "../loomwright/active-install.js";
import { LoomwrightContractError, readLoomwrightContract, requireHostSwitch } from "../loomwright/contract.js";
import type { LoomwrightContract, LoomwrightContractErrorReason, LoomwrightHostSwitch } from "../loomwright/contract.js";
import { SessionError } from "./types.js";
import type { SessionErrorCode } from "./types.js";

/** The session error codes a Loomwright refusal maps to. */
export type LoomwrightSessionErrorCode = Extract<SessionErrorCode, "loomwright_not_found" | "loomwright_contract" | "loomwright_no_host_switch">;

/**
 * The session error code for an adapter refusal reason: finding the install
 * ⇒ `loomwright_not_found`, its contract ⇒ `loomwright_contract`, a contract
 * without a host switch ⇒ `loomwright_no_host_switch`.
 */
export function loomwrightSessionErrorCode(reason: LoomwrightContractErrorReason): LoomwrightSessionErrorCode {
  switch (reason) {
    case "installed_plugins_missing":
    case "installed_plugins_unreadable":
    case "not_installed":
    case "ambiguous_install":
    case "install_path_invalid":
      return "loomwright_not_found";
    case "contract_missing":
    case "contract_unreadable":
    case "contract_not_json":
    case "contract_invalid":
    case "contract_schema_too_old":
      return "loomwright_contract";
    case "no_host_switch":
      return "loomwright_no_host_switch";
  }
}

/**
 * A session refused because of its Loomwright install. `code` is the stable
 * `SessionError` code, `message` the adapter's; `detail` (the adapter's
 * reason) and `path` (the install, or the `installed_plugins.json` file) go
 * into the `session_refused` event.
 */
export class LoomwrightSessionError extends SessionError {
  readonly detail: LoomwrightContractErrorReason;
  readonly path: string;

  constructor(code: LoomwrightSessionErrorCode, detail: LoomwrightContractErrorReason, path: string, message: string) {
    super(code, message);
    this.name = "LoomwrightSessionError";
    this.detail = detail;
    this.path = path;
  }
}

/** The install a session runs with: its path, its contract and the contract's host switch. */
export interface SessionLoomwright {
  readonly installPath: string;
  readonly contract: LoomwrightContract;
  readonly hostSwitch: LoomwrightHostSwitch;
}

/** Run `fn`, turning an adapter refusal into a `LoomwrightSessionError`; anything else is rethrown as is. */
function mapRefusal<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof LoomwrightContractError) {
      throw new LoomwrightSessionError(loomwrightSessionErrorCode(err.reason), err.reason, err.path, err.message);
    }
    throw err;
  }
}

/**
 * The Loomwright a new session loads, with its host switch.
 *
 * A non-empty configured path wins (resolved to absolute) and must hold a
 * valid contract: a bad configured path is an error — never
 * a silent fallback to the cache (which is never scanned, D32) or to
 * `installed_plugins.json`. Otherwise the active install from
 * `installed_plugins.json` (`resolveLoomwrightInstall`, with the session's
 * `cwd` as `projectPath`). A contract without a host switch is refused: Studio
 * runs Loomwright only in host mode. Throws `LoomwrightSessionError`.
 */
export function resolveSessionLoomwright(options: ResolveLoomwrightInstallOptions = {}): SessionLoomwright {
  return mapRefusal(() => {
    const { installPath, contract } = resolveLoomwrightInstall(options);
    return { installPath, contract, hostSwitch: requireHostSwitch(contract, installPath) };
  });
}

/**
 * The Loomwright a resumed session keeps: the contract at the row's recorded
 * `loomwright_path`, never re-resolved (a session keeps the Loomwright it
 * started with). Throws `LoomwrightSessionError`.
 */
export function readSessionLoomwright(installPath: string): SessionLoomwright {
  return mapRefusal(() => {
    const contract = readLoomwrightContract(installPath);
    return { installPath, contract, hostSwitch: requireHostSwitch(contract, installPath) };
  });
}
