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
//
// One SIGKILL does not empty a group that is forking: on macOS a
// `kill(-pgid, SIGKILL)` that races a fork misses the new child, which then
// survives in the dead group (re-parented to launchd), and `kill(-pgid, …)`
// can answer EPERM during that race even after the leader exited (probed
// 2026-10-02, docs/OPEN_QUESTIONS.md). Every kill the kernel means as "this
// group is gone" therefore goes through `killGroupUntilGone`.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { basename } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import type { GroupLeader, SpawnHooks, StderrSink } from "./types.js";

/** The stderr tail kept for failure records (the last 64 KiB). */
export const STDERR_TAIL_BYTES = 64 * 1024;

/** `killGroupUntilGone`: how long to keep re-killing a group before giving up. */
export const KILL_GROUP_DEADLINE_MS = 2_000;
/** `killGroupUntilGone`: the delay between two kill-and-probe rounds. */
export const KILL_GROUP_INTERVAL_MS = 25;
/** After a SIGKILL (or a stream end), how long to wait for the group leader's `exit`. */
export const LEADER_EXIT_WAIT_MS = 1_000;

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
 *   and ~2 s grace; on abort the whole group is killed until gone
 *   (`killGroupUntilGone`).
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
      // A listener cannot record anything: a group that outlives the deadline
      // is left to the manager's own kill, which records it.
      killGroupUntilGone(pgid).catch(() => undefined);
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
 * `ESRCH` ⇒ `false`; `EPERM` ⇒ `true` (it exists but cannot be signalled:
 * not ours, or on macOS a group holding only an unreaped zombie, or one
 * racing a fork).
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

export interface KillGroupUntilGoneOptions {
  /** Defaults to `KILL_GROUP_DEADLINE_MS`. */
  readonly deadlineMs?: number;
  /** Defaults to `KILL_GROUP_INTERVAL_MS`. */
  readonly intervalMs?: number;
  /** Defaults to `killProcessGroup`. */
  readonly kill?: (pgid: number, signal: NodeJS.Signals) => boolean;
  /** Defaults to `isProcessGroupAlive`. */
  readonly isAlive?: (pgid: number) => boolean;
  /** Defaults to a `setTimeout` delay. It must yield to the event loop, so Node can reap a killed child. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const timerSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * SIGKILL group `pgid` until it is gone: send SIGKILL, probe with
 * `kill(-pgid, 0)`, and while the group still answers, wait `intervalMs` and
 * send SIGKILL again (a child forked during the previous kill is caught by the
 * next one). `EPERM` from either call means "not gone yet", never "gone": on
 * macOS a group holding only an unreaped zombie answers EPERM, and so can a
 * group that is mid-fork. Resolves `true` once the group is gone (`ESRCH`) and
 * `false` when it still exists after about `deadlineMs` (bounded by a round
 * count, not a clock). Rejects on any other error, and with `RangeError` for
 * an invalid pgid. Stops at the first `ESRCH`, so a pgid reused after that is
 * never signalled.
 */
export async function killGroupUntilGone(pgid: number, options: KillGroupUntilGoneOptions = {}): Promise<boolean> {
  assertValidPgid(pgid);
  const kill = options.kill ?? killProcessGroup;
  const isAlive = options.isAlive ?? isProcessGroupAlive;
  const sleep = options.sleep ?? timerSleep;
  const intervalMs = Math.max(1, options.intervalMs ?? KILL_GROUP_INTERVAL_MS);
  const rounds = Math.max(1, Math.ceil((options.deadlineMs ?? KILL_GROUP_DEADLINE_MS) / intervalMs));
  for (let round = 0; ; round++) {
    try {
      if (!kill(pgid, "SIGKILL")) return true;
    } catch (err) {
      if (errnoCode(err) !== "EPERM") throw err;
    }
    if (!isAlive(pgid)) return true;
    if (round >= rounds) return false;
    await sleep(intervalMs);
  }
}

/** `ps` failed: it is missing, crashed, or printed something unparseable. Never "no such process". */
export class LeaderProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaderProbeError";
  }
}

/** `readGroupLeader` gives up on `ps` after this long (and throws). */
const PS_TIMEOUT_MS = 2_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// `lstart` is `ctime(3)`-shaped on macOS and procps alike: "Fri Oct  2 05:30:54 2026".
const PS_LINE = /^[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})\s+(\S.*)$/;

/** Parse one `ps -o lstart= -o comm=` line printed with `TZ=UTC`. */
export function parseLeaderLine(line: string): { readonly command: string; readonly startedAtMs: number } {
  const m = PS_LINE.exec(line.trim());
  const month = m === null ? -1 : MONTHS.indexOf(m[1] as string);
  if (m === null || month < 0) throw new LeaderProbeError(`unparseable ps output: ${JSON.stringify(line.slice(0, 200))}`);
  const startedAtMs = Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  return { command: (m[7] as string).trim(), startedAtMs };
}

/**
 * Process `pgid` (the group's leader, when it still runs): its executable and
 * its start time (1 s resolution), read with
 * `TZ=UTC LC_ALL=C ps -o lstart= -o comm= -p <pgid>`, which macOS and Linux
 * procps both support.
 *
 * - `{status: "absent"}` ONLY when `ps` positively reports no such process:
 *   exit status 1 with nothing on stdout or stderr.
 * - Throws `LeaderProbeError` for anything else (`ps` missing, killed or
 *   slower than `PS_TIMEOUT_MS`, any
 *   other status, a message on stderr, unparseable output), so a caller deciding
 *   whether to kill can never read a failure as "the leader exited".
 *
 * macOS prints the full executable path and Linux a short name, so compare
 * `command` with `leaderBasename`.
 */
export function readGroupLeader(pgid: number): GroupLeader {
  assertValidPgid(pgid);
  let out: string;
  try {
    out = execFileSync("/bin/ps", ["-o", "lstart=", "-o", "comm=", "-p", String(pgid)], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", TZ: "UTC", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
      // Runs synchronously (inside query() and in the reaper): never block the kernel on a hung ps.
      timeout: PS_TIMEOUT_MS,
    });
  } catch (err) {
    const e = err as { status?: number | null; stdout?: unknown; stderr?: unknown; message?: string };
    const stdout = typeof e.stdout === "string" ? e.stdout.trim() : "";
    const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
    if (e.status === 1 && stdout === "" && stderr === "") return { status: "absent" };
    throw new LeaderProbeError(`ps failed for pid ${pgid}: ${stderr !== "" ? stderr : (e.message ?? String(err))}`);
  }
  if (out.trim() === "") throw new LeaderProbeError(`ps printed nothing for pid ${pgid}`);
  return { status: "present", ...parseLeaderLine(out) };
}

/** The basename of a `readGroupLeader` command. */
export function leaderBasename(command: string): string {
  return basename(command.trim());
}
