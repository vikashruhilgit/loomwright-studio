// A run lock left by a dead holder (D46, phase 8 item 23n): who left it, and when
// Loomwright itself would take it back.
//
// Why: the kernel runs Loomwright in host mode, and in host mode Loomwright's own
// SessionEnd close-out (`scripts/close-stranded-run.sh`, 17.38.0) skips releasing
// `.supervisor/run.lock` ("releasing it is a hook mutating the repo"). A run session
// that ends mid-item therefore leaves the lock held by a dead pid, and Loomwright's
// acquire reclaims a lock only when its holder is dead AND it is at least
// `LOCK_TTL_SECONDS` old (`scripts/run-lock.sh`). Seen live 2026-11-17: session 215
// ended at 20:48, the owner's Resume started session 216 at 21:06, and Loomwright
// parked the run `run_lock_held`, because the lock was 19 minutes old.
//
// What the kernel does about it (D46):
// - A lock whose recorded pid is the process group of a kernel session that is no
//   longer running, in the same checkout, is the kernel's own (invariant 2: the
//   kernel owns its sessions' lifecycle). Before any run launch the kernel releases
//   it with Loomwright's own command, `run-lock.sh release --session-id <the lock's
//   session_id>`, the call Loomwright's close-out makes outside host mode, after
//   Loomwright's own `run-lock.sh liveness` says `dead`. Never `--force-unlock`.
// - Any other dead holder's lock is left to Loomwright's rule: Resume is shown
//   disabled until the lock is `LOCK_TTL_SECONDS` old, and a launch is refused until
//   then, so Studio never starts a run Loomwright will park on `run_lock_held`.
//
// The read here (`deadLockOf`) is pure apart from `kill -0` and `ps`; the release
// (`releaseKernelLock`) is the only write and runs only in the launch step. It lives
// here, not under `src/automate/`, which starts no process (its scan test), and runs
// nothing but `ps` and Loomwright's own `run-lock.sh`, with fixed argument shapes.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolvedPath } from "../protected-paths.js";
import type { Store } from "../store/index.js";
import { TERMINAL_STATUSES } from "../sessions/types.js";

/**
 * Loomwright's reclaim age for a lock whose holder is dead, in seconds
 * (`LOCK_TTL_SECONDS` in Loomwright 17.38.0 `scripts/run-lock.sh`: "BOTH the
 * recorded pid is dead ... AND age >= LOCK_TTL_SECONDS (1800s)").
 */
export const LOOMWRIGHT_LOCK_TTL_SECONDS = 1800;

/** A session status whose process the kernel no longer runs: every terminal status, and `interrupted` (kernel shutdown). */
const ENDED_STATUSES: readonly string[] = [...TERMINAL_STATUSES, "interrupted"];

/** A Loomwright session id as `close-stranded-run.sh` keeps it (`tr -cd 'A-Za-z0-9_-'`). */
const LOCK_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The run lock's `meta`, as read (`key<TAB>value` lines). */
interface LockMeta {
  readonly pid: number;
  readonly sessionId: string | null;
  /** Epoch seconds the lock was taken (`ts`), or `null` when unreadable. */
  readonly ts: number | null;
  readonly pidStart: string | null;
}

/** What a checkout's run lock is, for a launch or the Resume card. */
export type DeadLock =
  /** No lock, or one whose holder is alive (that is a live run, read elsewhere). */
  | { readonly kind: "none" }
  /** The holder is a kernel session that has ended: the launch releases it. */
  | { readonly kind: "kernel"; readonly session: number; readonly pid: number; readonly lockSessionId: string; readonly loomwrightPath: string }
  /** Another dead holder: Loomwright reclaims it at `reclaimAt` (epoch seconds; `null`: the lock's age cannot be read, never). */
  | { readonly kind: "foreign"; readonly reclaimAt: number | null };

function readMeta(checkout: string): LockMeta | undefined {
  let text: string;
  try {
    text = readFileSync(join(lockDir(checkout), "meta"), "utf8");
  } catch {
    return undefined;
  }
  const get = (key: string): string | null => {
    const line = text.split("\n").find((l) => l.startsWith(`${key}\t`));
    return line === undefined ? null : line.slice(key.length + 1).trim();
  };
  const pid = get("pid") ?? "";
  if (!/^[1-9]\d{0,9}$/.test(pid)) return undefined;
  const ts = get("ts") ?? "";
  const sid = get("session_id");
  return {
    pid: Number(pid),
    sessionId: sid !== null && LOCK_SESSION_ID.test(sid) ? sid : null,
    ts: /^\d{1,12}$/.test(ts) ? Number(ts) : null,
    pidStart: get("pid_start") || null,
  };
}

/** The pid's start time as Loomwright fingerprints it (`env TZ=UTC0 LC_ALL=C ps -o lstart= -p <pid>`), or `""`. */
function lstartOf(pid: number): string {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { env: { ...process.env, TZ: "UTC0", LC_ALL: "C" }, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

/** Loomwright's `holder_alive`: `kill -0` succeeds and, when the lock records `pid_start`, the pid's start time equals it (a reused pid reads dead). */
export function holderAlive(pid: number, pidStart: string | null): boolean {
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as { code?: unknown }).code !== "EPERM") return false;
  }
  return pidStart === null || lstartOf(pid) === pidStart;
}

/**
 * The checkout's run lock when its holder is dead: the kernel's own (a kernel
 * session in this checkout whose process group is the lock's pid and that no
 * longer runs) or another's, with Loomwright's reclaim time.
 *
 * Honest limit (PR #291 review): "the kernel's own" is the pid and checkout
 * match alone. The lock's `session_id` is the id Loomwright mints for its own
 * run (`automate:`/`supervisor:<session_id>`), which no kernel session row
 * records, so it cannot be cross-checked without reading Loomwright's state.
 * A foreign holder whose pid happens to equal an ended kernel session's process
 * group in the same checkout would be released before Loomwright's reclaim age.
 * Its holder is dead either way (`liveness` confirms it first), so that is an
 * early release of a dead lock, never a second drain.
 */
export function deadLockOf(store: Store, checkout: string, alive: (pid: number, pidStart: string | null) => boolean = holderAlive): DeadLock {
  const meta = readMeta(checkout);
  if (meta === undefined || alive(meta.pid, meta.pidStart)) return { kind: "none" };
  const placeholders = ENDED_STATUSES.map(() => "?").join(", ");
  const rows = store
    .prepare<unknown[], { id: number; cwd: string | null; loomwright_path: string | null }>(
      `SELECT id, cwd, loomwright_path FROM sessions WHERE pgid = ? AND status IN (${placeholders}) ORDER BY id DESC`,
    )
    .all(meta.pid, ...ENDED_STATUSES);
  const want = resolvedPath(checkout);
  const own = rows.find((r) => r.cwd !== null && resolvedPath(r.cwd) === want && r.loomwright_path !== null);
  if (own !== undefined && meta.sessionId !== null) {
    return { kind: "kernel", session: own.id, pid: meta.pid, lockSessionId: meta.sessionId, loomwrightPath: own.loomwright_path as string };
  }
  return { kind: "foreign", reclaimAt: meta.ts === null ? null : meta.ts + LOOMWRIGHT_LOCK_TTL_SECONDS };
}

/** Runs a Loomwright script; injectable for tests. Returns stdout, throws on a non-zero exit. */
export type ScriptRunner = (script: string, args: readonly string[], cwd: string) => string;

const runScript: ScriptRunner = (script, args, cwd) => execFileSync("bash", [script, ...args], { cwd, encoding: "utf8", timeout: 15_000 });

/**
 * Releases the kernel's own dead lock (`deadLockOf` → `kernel`) with Loomwright's
 * commands: `run-lock.sh liveness` must answer `dead` first (Loomwright's own
 * verdict, so the kernel never frees a lock Loomwright reads as alive), then
 * `run-lock.sh release --session-id <id>`, a no-op unless the lock still names
 * that session. Returns whether the lock is gone afterwards. Never throws.
 */
export function releaseKernelLock(checkout: string, lock: Extract<DeadLock, { kind: "kernel" }>, run: ScriptRunner = runScript): boolean {
  const script = join(lock.loomwrightPath, "scripts", "run-lock.sh");
  try {
    // `--pid`: `dead` also when the lock now names another holder, so the release below (keyed on the session id) is the guard.
    if (run(script, ["liveness", "--pid", String(lock.pid), "--root", checkout], checkout).trim() !== "dead") return false;
    run(script, ["release", "--session-id", lock.lockSessionId, "--root", checkout], checkout);
  } catch {
    return false;
  }
  return !existsSync(lockDir(checkout));
}

/** The run lock's directory in `checkout` (Loomwright's `LOCK_DIR`). */
function lockDir(checkout: string): string {
  return join(checkout, ".supervisor", "run.lock");
}
