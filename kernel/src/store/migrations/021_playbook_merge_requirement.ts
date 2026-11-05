import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/** The columns migration 21 adds to existing tables, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly table: string; readonly column: string; readonly definition: string }> = [
  { table: "playbooks", column: "merge_requirement", definition: "TEXT" },
  { table: "playbooks", column: "merge_requirement_set_by", definition: "TEXT" },
];

/**
 * A playbook's own merge requirement (phase 8 item 08): `playbooks.merge_requirement`
 * is `none`, `studio_approval` or `reviews:<N>` with N >= 1 (`MERGE_REQUIREMENT_KINDS`
 * and `checkPolicyValue`, `src/playbooks`), closed in code with no SQL CHECK.
 * It may only be stricter than the playbook's repo policy (`repo_policies`,
 * migration 20). `playbooks.merge_requirement_set_by` is `wright` or `owner`
 * like the other `*_set_by` columns. Nullable, no default: the kernel ships
 * no requirement, so a row from before this migration reads null for both
 * (not set), and the kernel never backfills it (invariant 1).
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` and fails on a
 * re-run ("duplicate column name"), so `up` adds each column only when
 * `PRAGMA table_info` does not already list it (the pattern of migrations 15,
 * 17, 18 and 19).
 */
export const playbookMergeRequirement: Migration = {
  version: 21,
  name: "playbook_merge_requirement",
  up: (db: Database.Database) => {
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck();
    for (const { table, column, definition } of COLUMNS) {
      if (existing.all(table).includes(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  },
};
