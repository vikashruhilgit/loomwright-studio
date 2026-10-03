// Helpers for the phase 1 exit tests (item 09): build the kernel once into a
// temp dir laid out like kernel/, spawn the crash harness against it, read its
// data dir read-only, and clean up every process and group the test started.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const kernelDir = fileURLToPath(new URL("..", import.meta.url));
export const HARNESS_PATH = fileURLToPath(new URL("./fixtures/crash-harness.mjs", import.meta.url));

/** The idempotency key the harness's session uses for `kernel_task_create`. */
export const EXIT_TEST_KEY = "exit-test-key";

/**
 * Build the kernel into `<root>/dist` (a fresh mkdtemp root) and give it the
 * layout the real kernel/ has: `<root>/package.json` (module type, and the
 * version `kernelVersion()` reads from the PARENT of `version.js`'s dir) and
 * `<root>/node_modules` → kernel/node_modules (better-sqlite3, the Agent SDK
 * and zod resolve by the same walk-up). Returns `<root>`.
 */
export function buildKernel(): { root: string; outDir: string } {
  const root = mkdtempSync(join(tmpdir(), "studio-exit-build-"));
  const outDir = join(root, "dist");
  execFileSync(process.execPath, [join(kernelDir, "scripts", "build.mjs"), "--out-dir", outDir], { stdio: "pipe" });
  const { version } = JSON.parse(readFileSync(join(kernelDir, "package.json"), "utf8")) as { version: string };
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ type: "module", version })}\n`);
  symlinkSync(join(kernelDir, "node_modules"), join(root, "node_modules"), "dir");
  return { root, outDir };
}

/**
 * The stand-in session's group leader: a symlink named `claude` to the
 * running `node`, run as `claude -e 'setTimeout(…)'`. The reaper kills a
 * group only when `ps -o comm=` names its leader `claude` (with the recorded
 * start time), so the name must be the one `ps` reports:
 *
 * - macOS `ps -o comm=` prints the path the process was exec'd by, here
 *   `<dir>/claude` (probed 2026-10-02 on Darwin 25: basename `claude`). A COPY
 *   of /bin/sleep does not work there: the copied platform binary is killed
 *   at exec (code signing, exit 137).
 * - Linux procps prints the task's `comm`, which execve sets to the basename
 *   of the path it was given (the symlink's name, not its target), so
 *   `claude`. Node is not a multi-call binary, so unlike a symlink to a
 *   coreutils/busybox `sleep` it never dispatches on its argv[0].
 */
export function makeClaudeLeader(root: string): string {
  const dir = join(root, "bin");
  mkdirSync(dir, { recursive: true });
  const leader = join(dir, "claude");
  symlinkSync(process.execPath, leader);
  return leader;
}

export interface Harness {
  readonly child: ChildProcess;
  readonly pid: number;
  /** Everything the harness wrote to stderr (for failure messages). */
  stderr(): string;
  /** Resolves with the exit code and signal once the harness process exits. */
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const spawned: ChildProcess[] = [];

/** Spawn the harness; resolves once it printed its ready line (or rejects when it exits first). */
export function startHarness(args: readonly string[], timeoutMs = 30_000): Promise<Harness> {
  const child = spawn(process.execPath, [HARNESS_PATH, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  spawned.push(child);
  let err = "";
  let out = "";
  child.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`harness not ready within ${timeoutMs} ms; stderr: ${err}`)), timeoutMs);
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      if (!out.includes("\n")) return;
      clearTimeout(timer);
      try {
        const ready = JSON.parse(out.split("\n", 1)[0] ?? "") as { ready?: unknown; pid?: unknown };
        const pid = child.pid;
        if (ready.ready !== true || pid === undefined || ready.pid !== pid) throw new Error(`unexpected harness stdout: ${out}`);
        resolve({ child, pid, stderr: () => err, exited });
      } catch (e) {
        reject(e as Error);
      }
    });
    void exited.then(({ code, signal }) => {
      clearTimeout(timer);
      reject(new Error(`harness exited before ready (code ${String(code)}, signal ${String(signal)}); stderr: ${err}`));
    });
  });
}

/** Stop every harness this file spawned: SIGTERM, then SIGKILL after `graceMs`. Only our own child pids. */
export async function stopHarnesses(graceMs = 5_000): Promise<void> {
  for (const child of spawned.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const gone = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
    await gone;
    clearTimeout(timer);
  }
}

/** Run `fn` over a read-only connection to the data dir's `studio.db`. */
export function withDb<T>(dataDir: string, fn: (db: Database.Database) => T): T {
  const db = new Database(join(dataDir, "studio.db"), { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** Like `withDb`, but `undefined` while the db does not exist yet. */
export function tryDb<T>(dataDir: string, fn: (db: Database.Database) => T): T | undefined {
  try {
    return withDb(dataDir, fn);
  } catch {
    return undefined;
  }
}

export function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
}

/** The error code `kill(-pgid, 0)` throws, or `undefined` when the group exists. */
export function groupProbeCode(pgid: number): string | undefined {
  try {
    process.kill(-pgid, 0);
    return undefined;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code;
  }
}

/**
 * SIGKILL group `pgid` ONLY while its leader is still the one this test
 * started: `ps -o args=` (argv, on macOS and Linux procps alike) begins with
 * our own temp `leader` path. A group that is gone, or whose pgid now belongs
 * to anything else, is never signalled.
 */
export function killOwnGroup(pgid: number, leader: string): void {
  let args: string;
  try {
    args = execFileSync("/bin/ps", ["-o", "args=", "-p", String(pgid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return; // No such process (or ps failed): nothing provably ours to kill.
  }
  if (!args.startsWith(`${leader} `)) return;
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // Gone in between.
  }
}

/** Poll `check` every `intervalMs` until it returns a value other than `undefined`. */
export async function waitFor<T>(what: string, check: () => T | undefined, timeoutMs = 30_000, intervalMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
