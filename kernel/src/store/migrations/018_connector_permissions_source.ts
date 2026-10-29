import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/** The columns migration 18 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [
  { table: "connectors", column: "permissions_source", definition: "TEXT" },
  { table: "connectors", column: "permissions_declared_at", definition: "TEXT" },
];

/**
 * Who vouched for a connector's permissions: `connectors.permissions_source`
 * is `reported` (GitHub said so) or `declared` (the owner said so; GitHub
 * publishes no permissions for a fine-grained token), one of
 * `CONNECTOR_PERMISSIONS_SOURCES` (`src/integrations/types.ts`), closed in
 * code with no SQL CHECK. `connectors.permissions_declared_at` is the ISO time
 * of the owner's declaration, set only when the source is `declared`.
 * Nullable, no default: a row from before this migration reads null for both,
 * and the kernel never backfills them.
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` and fails on a
 * re-run ("duplicate column name"), so `up` adds each column only when
 * `PRAGMA table_info` does not already list it (the pattern of migrations 15
 * and 17).
 */
export const connectorPermissionsSource: Migration = {
  version: 18,
  name: "connector_permissions_source",
  up: (db: Database.Database) => {
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
