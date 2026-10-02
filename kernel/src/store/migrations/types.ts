import type Database from "better-sqlite3";

/**
 * One numbered schema migration. Migrations are TypeScript modules (not `.sql`
 * files) so `tsc` carries them into `dist/`.
 */
export interface Migration {
  /** Positive integer; the ordered list must be contiguous from 1. */
  readonly version: number;
  readonly name: string;
  /** SQL to execute, or a function run against the connection. Runs inside a transaction. */
  readonly up: string | ((db: Database.Database) => void);
}
