// Imported directly by a test child under `node --experimental-strip-types`
// (test/store.test.ts), so the child takes the lock with these exact steps.
// Keep this module free of relative imports (strip-types does not map `./x.js`
// to `./x.ts`) and use erasable TypeScript only: no enums, namespaces or
// parameter properties.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

/** The lock database. Only this module may touch it, and only through better-sqlite3. */
export const LOCK_DB_FILENAME = "studio.lock";
/** Informational copy of the holder's PID, for error messages only. Never read to decide anything. */
export const LOCK_PID_FILENAME = "studio.lock.pid";

/**
 * Thrown when another live writer (another process, or another `Store` in this
 * process) already holds the data dir's single-writer lock.
 */
export class StoreLockedError extends Error {
  readonly code = "STORE_LOCKED";
  readonly dataDir: string;
  /** The holder's PID as last recorded in `studio.lock.pid`; may be stale or absent. */
  readonly holderPid: number | undefined;

  constructor(dataDir: string, holderPid: number | undefined) {
    const holder =
      holderPid === undefined
        ? "another writer (pid unknown)"
        : `pid ${holderPid} (as last recorded; may be stale)`;
    super(`Studio data dir ${dataDir} is locked: held by ${holder}`);
    this.name = "StoreLockedError";
    this.dataDir = dataDir;
    this.holderPid = holderPid;
  }
}

/** Retries after a first BUSY attempt, before refusing. */
export const LOCK_RETRIES = 4;
/** Each retry is preceded by a sleep drawn uniformly from this range, in ms. */
export const LOCK_RETRY_MIN_MS = 10;
export const LOCK_RETRY_MAX_MS = 100;

/** Injection points for deterministic tests. The kernel passes none. */
export interface StoreLockDeps {
  /** Opens the lock database; defaults to `new Database(path, { timeout: 0 })`. */
  readonly open?: (path: string) => Database.Database;
  /** Blocks for `ms` milliseconds; defaults to a synchronous `Atomics.wait`. */
  readonly sleep?: (ms: number) => void;
  /** Returns a number in [0, 1); defaults to `Math.random`. */
  readonly random?: () => number;
}

/** A held single-writer lock. `release()` is idempotent. */
export interface StoreLock {
  readonly path: string;
  release(): void;
}

/**
 * Take the data dir's single-writer lock: an exclusive SQLite file lock on
 * `<dataDir>/studio.lock`, held for the life of the returned connection.
 *
 * The OS drops the lock when the holding process dies (including `kill -9`), so
 * a stale lock cannot exist and there is no takeover logic. Pinned, probed
 * configuration: default `journal_mode` (DELETE), `{ timeout: 0 }`, then
 * `PRAGMA locking_mode = EXCLUSIVE`, then one write.
 *
 * A BUSY attempt is retried up to `LOCK_RETRIES` times, each after a jittered
 * 10-100 ms sleep, with the same steps on a fresh connection (the failed one is
 * closed first). Any other error is rethrown at once. The constructor that
 * calls this is synchronous, so the sleep blocks.
 *
 * Never open `studio.lock` (or its `-journal`) with `node:fs` in this process:
 * it is a POSIX fcntl lock, and closing any descriptor on the file drops it
 * silently.
 *
 * Honest limit: with `timeout: 0`, starters racing at the same instant can
 * still all be refused if every retry collides too (fail-closed). Two holders
 * at once cannot happen.
 *
 * @throws StoreLockedError when another live writer still holds the lock after
 *   the retries.
 */
export function acquireStoreLock(dataDir: string, deps: StoreLockDeps = {}): StoreLock {
  const path = join(dataDir, LOCK_DB_FILENAME);
  const open = deps.open ?? ((p: string) => new Database(p, { timeout: 0 }));
  const sleep = deps.sleep ?? sleepSync;
  const random = deps.random ?? Math.random;

  let db: Database.Database | undefined;
  for (let attempt = 0; db === undefined; attempt++) {
    try {
      db = tryAcquire(path, open);
    } catch (err) {
      if (!isBusy(err)) throw err;
      if (attempt >= LOCK_RETRIES) throw new StoreLockedError(dataDir, readRecordedPid(dataDir));
      sleep(jitteredDelay(random));
    }
  }

  // The PID file is informational only (error messages), never read to decide
  // anything, so failing to write it (ENOSPC, EACCES, EISDIR, ...) must not fail
  // the open. Rethrowing here would also strand the lock: `db` would stay open
  // with no StoreLock returned to release it. Keep the lock and return it.
  try {
    writeFileSync(join(dataDir, LOCK_PID_FILENAME), `${process.pid}\n`, { mode: 0o600 });
  } catch {
    // Ignored on purpose; see above.
  }

  const held = db;
  return {
    path,
    release(): void {
      if (held.open) held.close();
    },
  };
}

/** One attempt: the pinned steps on a fresh connection, closed again if any step throws. */
function tryAcquire(path: string, open: (path: string) => Database.Database): Database.Database {
  let db: Database.Database | undefined;
  try {
    db = open(path);
    db.pragma("locking_mode = EXCLUSIVE");
    db.exec(
      "CREATE TABLE IF NOT EXISTS owner(pid INTEGER, started_at TEXT); DELETE FROM owner;",
    );
    db.prepare("INSERT INTO owner(pid, started_at) VALUES (?, ?)").run(
      process.pid,
      new Date().toISOString(),
    );
    return db;
  } catch (err) {
    // Closing through SQLite is safe: its unix VFS defers closing the file
    // descriptor while another connection in this process holds a lock on it.
    db?.close();
    throw err;
  }
}

/** A whole number of ms in [LOCK_RETRY_MIN_MS, LOCK_RETRY_MAX_MS], whatever `random` returns. */
function jitteredDelay(random: () => number): number {
  const span = LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS;
  const r = random();
  const unit = r >= 0 && r < 1 ? r : 0; // also catches NaN
  return LOCK_RETRY_MIN_MS + Math.floor(unit * (span + 1));
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isBusy(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof err.code === "string" &&
    err.code.startsWith("SQLITE_BUSY")
  );
}

function readRecordedPid(dataDir: string): number | undefined {
  try {
    const raw = readFileSync(join(dataDir, LOCK_PID_FILENAME), "utf8").trim();
    return /^\d+$/.test(raw) ? Number(raw) : undefined;
  } catch {
    return undefined;
  }
}
