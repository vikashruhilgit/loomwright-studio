import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { acquireStoreLock } from "./lock.js";
import type { StoreLock } from "./lock.js";
import { migrations as defaultMigrations } from "./migrations/index.js";
import type { Migration } from "./migrations/index.js";

export const DATA_DIR_ENV = "STUDIO_DATA_DIR";
export const DEFAULT_DATA_DIR_NAME = ".loomwright-studio";
export const DB_FILENAME = "studio.db";

/**
 * The Studio data dir: `STUDIO_DATA_DIR` when set and non-empty, otherwise
 * `~/.loomwright-studio`. Pure: pass the environment in.
 */
export function resolveDataDir(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string = homedir(),
): string {
  const override = env[DATA_DIR_ENV];
  if (override !== undefined && override !== "") return resolve(override);
  return join(homeDir, DEFAULT_DATA_DIR_NAME);
}

export interface StoreOptions {
  /** Defaults to `resolveDataDir(process.env)`. */
  readonly dataDir?: string;
  /** Defaults to the real ordered migration list. */
  readonly migrations?: readonly Migration[];
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly applied_at: string;
}

/**
 * The kernel's only writer to `studio.db`. Opening one takes the data dir's
 * single-writer lock; a second live `Store` on the same data dir, in this or
 * any other process, is refused with `StoreLockedError`.
 *
 * Open order: create/chmod the data dir, take the lock, then open `studio.db`,
 * set pragmas and apply pending migrations. A refused opener never creates
 * `studio.db`.
 */
export class Store {
  readonly dataDir: string;
  readonly dbPath: string;
  readonly #db: Database.Database;
  readonly #lock: StoreLock;

  constructor(options: StoreOptions = {}) {
    this.dataDir = options.dataDir ?? resolveDataDir(process.env);
    this.dbPath = join(this.dataDir, DB_FILENAME);

    ensureDataDir(this.dataDir);
    this.#lock = acquireStoreLock(this.dataDir);

    let db: Database.Database | undefined;
    try {
      db = new Database(this.dbPath);
      const mode = db.pragma("journal_mode = WAL", { simple: true });
      if (mode !== "wal") {
        throw new Error(`studio.db did not enter WAL mode (journal_mode=${String(mode)})`);
      }
      // Per connection, so set on every open.
      db.pragma("foreign_keys = ON");
      applyMigrations(db, options.migrations ?? defaultMigrations);
    } catch (err) {
      db?.close();
      this.#lock.release();
      throw err;
    }
    this.#db = db;
  }

  get isOpen(): boolean {
    return this.#db.open;
  }

  prepare<BindParameters extends unknown[] = unknown[], Result = unknown>(
    sql: string,
  ): Database.Statement<BindParameters, Result> {
    return this.#db.prepare<BindParameters, Result>(sql);
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  pragma(source: string, options?: Database.PragmaOptions): unknown {
    return this.#db.pragma(source, options);
  }

  /** Run `fn` in one transaction: it commits when `fn` returns and rolls back if it throws. */
  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn)();
  }

  appliedMigrations(): AppliedMigration[] {
    return this.#db
      .prepare<[], AppliedMigration>(
        "SELECT version, name, applied_at FROM schema_migrations ORDER BY version",
      )
      .all();
  }

  /** Close the database, then release the lock. Idempotent. */
  close(): void {
    if (this.#db.open) this.#db.close();
    this.#lock.release();
  }
}

function ensureDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The mode option is masked by umask and ignored for an existing dir.
  chmodSync(dir, 0o700);
}

const CREATE_SCHEMA_MIGRATIONS = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

/**
 * Apply every migration whose version is not yet recorded, ascending, each in
 * its own transaction together with its `schema_migrations` row. A migration
 * that throws rolls back entirely (including, on a fresh database, the
 * `schema_migrations` table itself).
 */
function applyMigrations(db: Database.Database, list: readonly Migration[]): void {
  // Validate the whole list before touching the database: versions must be
  // contiguous from 1 (1, 2, 3, ...), as documented on `Migration.version`.
  list.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `migrations must be strictly increasing and contiguous from 1 (expected version ${i + 1} at position ${i}, got ${m.version})`,
      );
    }
  });

  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  const applied = new Set<number>(
    hasTable === undefined
      ? []
      : db.prepare<[], number>("SELECT version FROM schema_migrations").pluck().all(),
  );

  for (const m of list) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(CREATE_SCHEMA_MIGRATIONS);
      if (typeof m.up === "string") db.exec(m.up);
      else m.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    })();
  }
}
