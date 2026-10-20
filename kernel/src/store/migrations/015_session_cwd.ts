import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/** The columns migration 15 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [
  { table: "sessions", column: "cwd", definition: "TEXT" },
];

/**
 * Where each session runs: `sessions.cwd`, the realpath of the session's
 * working directory (`resolvedPath` in `src/protected-paths.ts`: symlinks
 * resolved as far as the path exists, a `/System/Volumes/Data` prefix
 * removed). The session manager writes it in the same `INSERT` that creates
 * the row and compares a resume's resolved cwd against it (`cwd_changed`).
 * Nullable, no default: a row from before this migration reads null, and the
 * kernel never backfills it (such a row resumes without the comparison).
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` and fails on a
 * re-run ("duplicate column name"), so `up` adds each column only when
 * `PRAGMA table_info` does not already list it. The store's integrity check
 * re-runs the top migrations when their `schema_migrations` rows were deleted.
 */
export const sessionCwd: Migration = {
  version: 15,
  name: "session_cwd",
  up: (db: Database.Database) => {
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
