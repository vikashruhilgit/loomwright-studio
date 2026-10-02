// The ONLY module under src/sessions/ that imports node:child_process. Every
// process-group operation the kernel performs lives here.
//
// Targets macOS. Until its parent reaps it, a SIGKILLed leader is a zombie
// that still holds the pgid: on macOS `kill(-pgid, 0 | SIGKILL)` on a group
// holding only that zombie fails with EPERM (probed 2026-10-02), on Linux it
// succeeds; both give ESRCH once it is reaped. Node reaps a child before it
// emits `exit`, so callers wait for `exit` before treating a group as gone.
// `ps -o comm=` prints the full executable path on macOS and a name of at
// most 15 characters on Linux. These differences are handled by callers,
// not engineered around here.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { basename } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import type { SpawnHooks, StderrSink } from "./types.js";

/** The stderr tail kept for failure records (the last 64 KiB). */
export const STDERR_TAIL_BYTES = 64 * 1024;

/**
 * A pgid the kernel may signal: an integer greater than 1. `0` would signal the
 * kernel's own group and `-1` (negated: `1`) every process it may signal.
 */
export function isValidPgid(pgid: unknown): pgid is number {
  return typeof pgid === "number" && Number.isInteger(pgid) && pgid > 1;
}

function assertValidPgid(pgid: number): void {
  if (!isValidPgid(pgid)) throw new RangeError(`refusing to signal process group ${String(pgid)}`);
}

function errnoCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
}

/** Keeps the last `limit` bytes written to it. */
export class StderrTail implements StderrSink {
  readonly #limit: number;
  #chunks: Buffer[] = [];
  #size = 0;

  constructor(limit: number = STDERR_TAIL_BYTES) {
    this.#limit = limit;
  }

  append(chunk: Buffer | string): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    this.#chunks.push(buf);
    this.#size += buf.length;
    while (this.#size > this.#limit && this.#chunks.length > 0) {
      const first = this.#chunks[0] as Buffer;
      const excess = this.#size - this.#limit;
      if (first.length <= excess) {
        this.#chunks.shift();
        this.#size -= first.length;
      } else {
        this.#chunks[0] = first.subarray(excess);
        this.#size -= excess;
      }
    }
  }

  text(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }
}

/**
 * The kernel's `spawnClaudeCodeProcess`: runs the CLI as the leader of a NEW
 * process group (`detached: true`), so the kernel can later signal the whole
 * group, including background shells that outlive the leader (Q5).
 *
 * - `onSpawn(pgid)` is called synchronously right after `spawn` returns. The
 *   SDK calls this function synchronously inside `query()` (probed
 *   2026-10-02), so the caller can record the pgid before any message.
 *   When `child.pid` is undefined the spawn failed: `onSpawn` is not called and
 *   the `error` event reaches the SDK.
 * - `options.signal` is NOT passed to `spawn()` (Node would kill only the
 *   leader). It is the SDK's forwarded signal, fired after its own stdin-EOF
 *   and ~2 s grace; on abort the whole group is SIGKILLed.
 * - stderr is always drained (a full pipe would block the CLI) into
 *   `stderrTail` when given.
 * - The child is not `unref()`ed.
 */
export function spawnInNewProcessGroup(
  options: SpawnOptions,
  hooks: SpawnHooks = {},
): ChildProcessByStdio<Writable, Readable, Readable> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });

  child.stderr.on("data", (chunk: Buffer) => hooks.stderrTail?.append(chunk));

  const pgid = child.pid;
  if (isValidPgid(pgid)) {
    const killGroup = (): void => {
      try {
        killProcessGroup(pgid, "SIGKILL");
      } catch {
        // EPERM: no longer ours. Nothing else can be done from a listener.
      }
    };
    if (options.signal.aborted) killGroup();
    else options.signal.addEventListener("abort", killGroup, { once: true });
    hooks.onSpawn?.(pgid);
  }
  return child;
}

/**
 * `kill(-pgid, signal)`. Returns `true` when signalled and `false` when the
 * group is already gone (`ESRCH`); rethrows anything else (`EPERM`: the group
 * exists but is not ours). Throws `RangeError` for a pgid that is not an
 * integer greater than 1.
 */
export function killProcessGroup(pgid: number, signal: NodeJS.Signals): boolean {
  assertValidPgid(pgid);
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (err) {
    if (errnoCode(err) === "ESRCH") return false;
    throw err;
  }
}

/**
 * Whether any process is in group `pgid`: `kill(-pgid, 0)` succeeds ⇒ `true`;
 * `ESRCH` ⇒ `false`; `EPERM` ⇒ `true` (it exists but is not ours — callers
 * must not kill it; on macOS also a group holding only an unreaped zombie).
 * Throws `RangeError` for an invalid pgid.
 */
export function isProcessGroupAlive(pgid: number): boolean {
  assertValidPgid(pgid);
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    const code = errnoCode(err);
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw err;
  }
}

/**
 * The executable of process `pgid` (the group's leader, when it still runs),
 * or `undefined` when there is no such process. macOS prints the full path and
 * Linux a short name, so compare with `leaderBasename`.
 */
export function readGroupLeaderCommand(pgid: number): string | undefined {
  assertValidPgid(pgid);
  try {
    const out = execFileSync("/bin/ps", ["-o", "comm=", "-p", String(pgid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

/** The basename of a `readGroupLeaderCommand` result. */
export function leaderBasename(command: string): string {
  return basename(command.trim());
}
