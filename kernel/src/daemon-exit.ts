// The daemon's arguments and exit decisions (H01), kept out of daemon.ts so
// they can be tested: daemon.ts starts the kernel as soon as it is imported.
// H01 is the phase 1 hardening item H01 (launchd start failures and
// reinstall); the other `(H01)` notes in the kernel point here.
//
// Under launchd (the plist passes `--launchd`) the exit status is the restart
// policy: `KeepAlive {SuccessfulExit: false}` restarts on any non-zero exit,
// at most once every `ThrottleInterval` seconds, and never after exit 0. So a
// start failure a retry can't fix exits 0, everything else exits 1. Started by
// hand (no flag), every failure exits 1, as before. Every exit writes one
// stderr line naming the cause and, under launchd, whether it restarts.
import { AuthProviderError } from "./auth/types.js";
import { LAUNCHD_ARGUMENT, THROTTLE_INTERVAL_SECONDS } from "./service/launchd.js";
import { StoreIntegrityError, StoreSchemaTooNewError } from "./store/integrity.js";
import { StoreLockedError } from "./store/lock.js";

export const DAEMON_NAME = "loomwright-studio-kernel";

/** A bad command-line argument: permanent, since launchd passes the same ones again. */
export class DaemonArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonArgumentError";
  }
}

/** The first line of an error's message: one line on stderr, never a stack. */
export function oneLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n", 1)[0] ?? "";
}

/** `[--auth-provider <id>] [--launchd]`; anything else throws `DaemonArgumentError`. */
export function parseArgs(args: readonly string[]): { authProviderId?: string } {
  let authProviderId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--auth-provider") {
      const value = args[i + 1];
      if (value === undefined || value === "") throw new DaemonArgumentError("--auth-provider needs a value");
      authProviderId = value;
      i++;
    } else if (arg !== LAUNCHD_ARGUMENT) {
      throw new DaemonArgumentError(`unknown argument: ${String(arg)}`);
    }
  }
  return authProviderId === undefined ? {} : { authProviderId };
}

/** Whether the daemon runs under launchd; read before parsing, so a bad argument still exits the launchd way. */
export function underLaunchd(args: readonly string[]): boolean {
  return args.includes(LAUNCHD_ARGUMENT);
}

export type StartFailureKind = "permanent" | "transient";

/** Why a retry can't fix `err` (an explicit allowlist), or `undefined` when it might. */
function permanentReason(err: unknown): string | undefined {
  if (err instanceof StoreLockedError) return "another kernel holds the store lock";
  if (err instanceof StoreIntegrityError) return "the store failed its integrity check";
  if (err instanceof StoreSchemaTooNewError) return "the store's schema is newer than this kernel";
  if (err instanceof DaemonArgumentError) return "bad argument";
  if (err instanceof AuthProviderError && err.code === "unavailable") return "auth provider not in this build";
  return undefined;
}

/**
 * Permanent only for the allowlist above (a refused store open is: the same
 * database fails the same check on every retry); anything else (Keychain, API
 * token, any other store error) is transient.
 */
export function startFailureKind(err: unknown): StartFailureKind {
  return permanentReason(err) === undefined ? "transient" : "permanent";
}

/** What the daemon writes to stderr (one line) before exiting with `status`. */
export interface DaemonExit {
  readonly status: 0 | 1;
  readonly line: string;
}

/** A failed start. Under launchd: permanent ⇒ 0 (not restarted), transient ⇒ 1 (restarted, throttled); otherwise 1. */
export function startFailureExit(err: unknown, launchd: boolean): DaemonExit {
  if (!launchd) return { status: 1, line: `${DAEMON_NAME}: failed to start: ${oneLine(err)}` };
  const reason = permanentReason(err);
  if (reason !== undefined) return { status: 0, line: `${DAEMON_NAME}: failed to start (not restarting: ${reason}): ${oneLine(err)}` };
  return {
    status: 1,
    line: `${DAEMON_NAME}: failed to start (launchd restarts it at most once every ${THROTTLE_INTERVAL_SECONDS} s): ${oneLine(err)}`,
  };
}

/** A graceful stop on `signal` whose teardown threw: 1 by hand, 0 under launchd (a requested stop never restarts). */
export function stopFailureExit(err: unknown, signal: string, launchd: boolean): DaemonExit {
  if (!launchd) return { status: 1, line: `${DAEMON_NAME}: error while stopping on ${signal}: ${oneLine(err)}` };
  return { status: 0, line: `${DAEMON_NAME}: error while stopping on ${signal} (not restarting): ${oneLine(err)}` };
}
