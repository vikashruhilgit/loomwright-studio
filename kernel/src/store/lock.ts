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
        : `pid ${holderPid} (as last recorded)`;
    super(`Studio data dir ${dataDir} is locked: held by ${holder}`);
    this.name = "StoreLockedError";
    this.dataDir = dataDir;
    this.holderPid = holderPid;
  }
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
 * Never open `studio.lock` (or its `-journal`) with `node:fs` in this process:
 * it is a POSIX fcntl lock, and closing any descriptor on the file drops it
 * silently.
 *
 * Honest limit: with `timeout: 0`, several starters racing at the same instant
 * can all be refused (fail-closed). Two holders at once cannot happen.
 *
 * @throws StoreLockedError when another live writer holds the lock.
 */
export function acquireStoreLock(dataDir: string): StoreLock {
  const path = join(dataDir, LOCK_DB_FILENAME);
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { timeout: 0 });
    db.pragma("locking_mode = EXCLUSIVE");
    db.exec(
      "CREATE TABLE IF NOT EXISTS owner(pid INTEGER, started_at TEXT); DELETE FROM owner;",
    );
    db.prepare("INSERT INTO owner(pid, started_at) VALUES (?, ?)").run(
      process.pid,
      new Date().toISOString(),
    );
  } catch (err) {
    // Closing through SQLite is safe: its unix VFS defers closing the file
    // descriptor while another connection in this process holds a lock on it.
    db?.close();
    if (isBusy(err)) {
      throw new StoreLockedError(dataDir, readRecordedPid(dataDir));
    }
    throw err;
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
