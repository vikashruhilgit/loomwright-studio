import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

const TABLES = `
CREATE TABLE IF NOT EXISTS saved_workspaces (
  id           INTEGER PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,
  repo         TEXT,
  added_at     TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
`;

/**
 * Saved workspaces (phase 8 item 18c): the owner's one list of repo folders,
 * kept by the kernel and edited only through the owner's console routes
 * (`src/console/workspaces.ts`: `GET /workspaces`, `POST /workspaces`,
 * `POST /workspaces/:id/remove`); no session tool and no `studio` subcommand
 * writes it.
 *
 * - `path`: absolute, resolved as the D31 check resolves it (`resolvedPath`,
 *   `src/protected-paths.ts`), so a symlinked or firmlinked spelling of one
 *   folder is one row.
 * - `repo`: the first GitHub remote the checkout named when it was saved
 *   (`owner/repo`), null when it had none. A lookup re-reads the folder's
 *   remotes fresh; this column only keeps a moved or deleted folder findable
 *   as `missing`.
 * - `added_at`, `last_used_at`: ISO-8601 from the kernel clock, written by
 *   the route (no SQL default: the clock is the kernel's, not SQLite's).
 *
 * Mechanism only (invariant 1): which folder to offer is the owner's list.
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: `CREATE TABLE IF NOT EXISTS`.
 */
export const savedWorkspaces: Migration = {
  version: 24,
  name: "saved_workspaces",
  up: (db: Database.Database) => {
    db.exec(TABLES);
  },
};
