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

/** Reads one generic-password item's secret by service name. */
export interface KeychainReader {
  /** The secret, or `undefined` when the item does not exist. */
  read(service: string): string | undefined;
}

export interface ExecOptions {
  readonly encoding: "utf8";
  readonly stdio: readonly ["ignore", "pipe", "pipe"];
  readonly timeout: number;
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

  constructor(service: string, exitStatus: number | null, signal: string | null) {
    const how =
      exitStatus !== null ? `exit status ${exitStatus}` : `terminated by ${signal ?? "an unknown signal"}`;
    super(`Keychain read of service "${service}" failed (${SECURITY_BIN} ${how})`);
    this.name = "KeychainError";
    this.service = service;
    this.exitStatus = exitStatus;
  }
}

const realExec: ExecFileSyncLike = (file, args, options) =>
  execFileSync(file, [...args], {
    encoding: options.encoding,
    stdio: [...options.stdio],
    timeout: options.timeout,
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
