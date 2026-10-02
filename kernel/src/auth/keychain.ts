// The ONLY module under src/auth/ that touches the macOS Keychain or
// node:child_process. Keep every Keychain call here, so access under launchd
// (the launchd note in docs/OPEN_QUESTIONS.md "Subscription auth from the
// SDK"; phase-1 backlog item .supervisor/requirements/phase-1/
// 09-launchd-and-crash-resume.md) can be adjusted in one place.
import { execFileSync } from "node:child_process";

/** Absolute path: no PATH lookup can substitute another binary. */
export const SECURITY_BIN = "/usr/bin/security";

/**
 * `security` exits with this status when the item does not exist (probed
 * 2026-10-02; recorded in docs/OPEN_QUESTIONS.md "Subscription auth from the SDK").
 */
export const SECURITY_ITEM_NOT_FOUND_STATUS = 44;

const READ_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 10_000;

/** Reads one generic-password item's secret by service name. */
export interface KeychainReader {
  /** The secret, or `undefined` when the item does not exist. */
  read(service: string): string | undefined;
}

/** Adds one generic-password item. Never overwrites an existing one. */
export interface KeychainWriter {
  add(service: string, account: string, secret: string): void;
}

export interface ExecOptions {
  readonly encoding: "utf8";
  /** stdin is `"pipe"` exactly when `input` is given; never left to `input` overriding `"ignore"`. */
  readonly stdio: readonly ["ignore" | "pipe", "pipe", "pipe"];
  readonly timeout: number;
  /** Written to the child's stdin (the write path's one command line). */
  readonly input?: string;
}

/** The subset of `execFileSync` this module uses; injectable for tests. */
export type ExecFileSyncLike = (file: string, args: readonly string[], options: ExecOptions) => string;

/**
 * A Keychain read failed for a reason other than "item not found". Built from
 * the service name and exit status only: it never carries the process's
 * stdout, stderr or the original error object, any of which can hold the
 * secret.
 */
export class KeychainError extends Error {
  readonly service: string;
  readonly exitStatus: number | null;
  readonly operation: "read" | "write";

  constructor(service: string, exitStatus: number | null, signal: string | null, operation: "read" | "write" = "read") {
    const how =
      exitStatus !== null ? `exit status ${exitStatus}` : `terminated by ${signal ?? "an unknown signal"}`;
    super(`Keychain ${operation} of service "${service}" failed (${SECURITY_BIN} ${how})`);
    this.name = "KeychainError";
    this.service = service;
    this.exitStatus = exitStatus;
    this.operation = operation;
  }
}

const realExec: ExecFileSyncLike = (file, args, options) =>
  execFileSync(file, [...args], {
    encoding: options.encoding,
    stdio: [...options.stdio],
    timeout: options.timeout,
    ...(options.input === undefined ? {} : { input: options.input }),
  });

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The real reader: `/usr/bin/security find-generic-password -s <service> -w`,
 * run with an argument array (never a shell). `-w` prints the secret followed
 * by one newline; exactly that one newline is removed, so any other whitespace
 * reaches the shape check.
 */
export function securityCliKeychain(exec: ExecFileSyncLike = realExec): KeychainReader {
  return {
    read(service: string): string | undefined {
      let out: string;
      try {
        out = exec(SECURITY_BIN, ["find-generic-password", "-s", service, "-w"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: READ_TIMEOUT_MS,
        });
      } catch (err) {
        const e = (typeof err === "object" && err !== null ? err : {}) as Record<string, unknown>;
        const status = numberOrNull(e["status"]);
        if (status === SECURITY_ITEM_NOT_FOUND_STATUS) return undefined;
        // Deliberately drop `err`: it carries stdout/stderr buffers.
        throw new KeychainError(service, status, stringOrNull(e["signal"]));
      }
      return out.endsWith("\n") ? out.slice(0, -1) : out;
    },
  };
}

/**
 * What the write path accepts in a service, account or secret: no whitespace,
 * quote, backslash or newline can reach `security -i`'s command-line parser,
 * and nothing starts with `-` (never read as an option). The API token is hex.
 */
const WRITE_ARG = /^[A-Za-z0-9_.@][A-Za-z0-9_.@-]*$/;

/**
 * The real writer: `/usr/bin/security -i`, which reads commands from stdin
 * until EOF, given ONE line, `add-generic-password -a <account> -s <service>
 * -w <secret>`. The secret is only ever on stdin, never in `argv` (where `ps`
 * shows it). No `-U`: an existing item is never overwritten. A value that does
 * not match `WRITE_ARG` is refused before anything runs.
 *
 * `security -i` may exit 0 even when a command inside it failed, so a clean
 * exit is NOT proof the item exists: the caller reads it back (see
 * `ensureApiToken`). A failure throws `KeychainError` built from the service
 * and exit status only, never the process's output or its stdin.
 */
export function securityCliKeychainWriter(exec: ExecFileSyncLike = realExec): KeychainWriter {
  return {
    add(service: string, account: string, secret: string): void {
      for (const [field, value] of [["service", service], ["account", account], ["secret", secret]] as const) {
        // Names the field, never the value: the value may be the secret.
        if (!WRITE_ARG.test(value)) throw new RangeError(`Keychain write refused: the ${field} has a character security -i cannot take`);
      }
      try {
        exec(SECURITY_BIN, ["-i"], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: WRITE_TIMEOUT_MS,
          input: `add-generic-password -a ${account} -s ${service} -w ${secret}\n`,
        });
      } catch (err) {
        const e = (typeof err === "object" && err !== null ? err : {}) as Record<string, unknown>;
        // Deliberately drop `err`: it carries stdout/stderr buffers.
        throw new KeychainError(service, numberOrNull(e["status"]), stringOrNull(e["signal"]), "write");
      }
    },
  };
}
