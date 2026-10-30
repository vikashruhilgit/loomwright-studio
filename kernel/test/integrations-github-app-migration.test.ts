// Migration 19, connector_app (GitHub App 2, AC7 schema half): `connectors.method`,
// `app_slug` and `installation_id`, nullable, no default, no CHECK, no trigger,
// safe to re-run. A row from before 19 reads null for all three; the kernel
// reads a null `method` as `token` (the connector's tests pin that read).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAfterMigrating } from "../src/store/integrity.js";
import { DB_FILENAME, Store, migrations } from "../src/store/index.js";
import { connectorPermissionsSource } from "../src/store/migrations/018_connector_permissions_source.js";
import { connectorApp } from "../src/store/migrations/019_connector_app.js";

const T0 = "2026-10-30T10:00:00.000Z";
const NEW_COLUMNS = ["method", "app_slug", "installation_id"] as const;

describe("migration 19: connector_app (AC7)", () => {
  const V18 = migrations.slice(0, 18);
  let dir: string;
  const stores: Store[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "studio-m19-"));
  });

  afterEach(() => {
    for (const s of stores.splice(0)) {
      try {
        s.close();
      } catch {
        // already closed
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function open(list?: typeof migrations): Store {
    const s = new Store({ dataDir: dir, ...(list === undefined ? {} : { migrations: list }) });
    stores.push(s);
    return s;
  }

  function inspect<T>(fn: (db: Database.Database) => T): T {
    const db = new Database(join(dir, DB_FILENAME), { readonly: true, fileMustExist: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  const columnsOf = (s: Store): string[] => s.prepare<[], string>("SELECT name FROM pragma_table_info('connectors')").pluck().all();
  const info = (s: Store, column: string): unknown =>
    s.prepare(`SELECT type, "notnull", dflt_value FROM pragma_table_info('connectors') WHERE name = ?`).get(column);

  it("is version 19, named connector_app, appended last after 18, and the list is contiguous from 1", () => {
    expect([connectorApp.version, connectorApp.name]).toEqual([19, "connector_app"]);
    expect(migrations.at(-1)).toBe(connectorApp);
    expect(migrations.at(-2)).toBe(connectorPermissionsSource);
    expect(migrations.map((m) => m.version)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it("a fresh store has the three columns, after 18's, nullable with no default", () => {
    const store = open();
    const cols = columnsOf(store);
    expect(cols.slice(-5)).toEqual(["permissions_source", "permissions_declared_at", ...NEW_COLUMNS]);
    expect(info(store, "method")).toEqual({ type: "TEXT", notnull: 0, dflt_value: null });
    expect(info(store, "app_slug")).toEqual({ type: "TEXT", notnull: 0, dflt_value: null });
    expect(info(store, "installation_id")).toEqual({ type: "INTEGER", notnull: 0, dflt_value: null });
  });

  it("upgrades a v18 store: the columns are added, the existing row keeps its values and reads null for all three, and the integrity check passes", () => {
    const v18 = open(V18);
    v18
      .prepare(
        "INSERT INTO connectors (kind, status, account_login, permissions_json, reachable_repos_json, verified_at, permissions_source, permissions_declared_at) VALUES ('github', 'connected', 'someone', '{\"metadata\":\"read\"}', '[\"o/r\"]', ?, 'declared', ?)",
      )
      .run(T0, T0);
    for (const c of NEW_COLUMNS) expect(columnsOf(v18)).not.toContain(c);
    v18.close();

    const store = open();
    expect(store.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([19, "connector_app"]);
    expect(store.prepare("SELECT account_login, permissions_json, reachable_repos_json, verified_at, permissions_source, permissions_declared_at, method, app_slug, installation_id FROM connectors").all()).toEqual([
      {
        account_login: "someone",
        permissions_json: '{"metadata":"read"}',
        reachable_repos_json: '["o/r"]',
        verified_at: T0,
        permissions_source: "declared",
        permissions_declared_at: T0,
        method: null,
        app_slug: null,
        installation_id: null,
      },
    ]);
    const sql = store.prepare<[string], string>("SELECT sql FROM sqlite_master WHERE name = ?").pluck().get("connectors") ?? "";
    expect(sql).not.toMatch(/CHECK/i);
    expect(store.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name <> 'events'").pluck().get()).toBe(0);
    store.close();

    inspect((db) => expect(() => checkAfterMigrating(db, dir, migrations)).not.toThrow());
  });

  it("takes any value in the new columns (closed in code, no SQL CHECK) and a row can be written without them", () => {
    const store = open();
    store.prepare("INSERT INTO connectors (kind, status) VALUES ('github', 'disconnected')").run();
    store.prepare("INSERT INTO connectors (kind, status, method, app_slug, installation_id) VALUES ('github', 'connected', 'app', 'studio-reader', 12345)").run();
    store.prepare("INSERT INTO connectors (kind, status, method) VALUES ('github', 'connected', 'not-a-method')").run();
    expect(store.prepare("SELECT method, app_slug, installation_id FROM connectors ORDER BY id").all()).toEqual([
      { method: null, app_slug: null, installation_id: null },
      { method: "app", app_slug: "studio-reader", installation_id: 12345 },
      { method: "not-a-method", app_slug: null, installation_id: null },
    ]);
  });

  it("is safe to re-run: with its record deleted, migration 19 runs again as a no-op and every row stays", () => {
    const first = open();
    first.prepare("INSERT INTO connectors (kind, status, method, app_slug, installation_id) VALUES ('github', 'connected', 'app', 'studio-reader', 12345)").run();
    first.close();

    const db = new Database(join(dir, DB_FILENAME));
    db.exec("DELETE FROM schema_migrations WHERE version = 19");
    db.close();

    const rerun = open();
    expect(rerun.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([19, "connector_app"]);
    expect(rerun.prepare("SELECT method, app_slug, installation_id FROM connectors").all()).toEqual([
      { method: "app", app_slug: "studio-reader", installation_id: 12345 },
    ]);
    expect(columnsOf(rerun).filter((c) => (NEW_COLUMNS as readonly string[]).includes(c))).toEqual([...NEW_COLUMNS]);
  });

  it("adds a column only when it is missing: with one of the three already there, the other two are added", () => {
    const v18 = open(V18);
    v18.prepare("ALTER TABLE connectors ADD COLUMN app_slug TEXT").run();
    v18.prepare("INSERT INTO connectors (kind, status, app_slug) VALUES ('github', 'connected', 'kept')").run();
    v18.close();

    const store = open();
    expect(store.prepare("SELECT app_slug, method, installation_id FROM connectors").all()).toEqual([{ app_slug: "kept", method: null, installation_id: null }]);
    expect(columnsOf(store).filter((c) => (NEW_COLUMNS as readonly string[]).includes(c)).sort()).toEqual([...NEW_COLUMNS].sort());
  });
});
