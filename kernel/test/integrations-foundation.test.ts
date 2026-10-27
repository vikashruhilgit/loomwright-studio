// Phase 6 foundation (item 01): the `integrations` feature's seams, its shared
// types and test fake, the per-agent tool filter, and migration 17. Later phase
// 6 items extend this file with their refusals and seams.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import type { ContributedTool } from "../src/features/index.js";
import {
  CONNECTOR_KINDS,
  CONNECTOR_STATUSES,
  INTEGRATIONS_NAME,
  INTEGRATIONS_PARTS,
  integrationsContribution,
  integrationsContributionOf,
  toolsForConnectors,
} from "../src/integrations/index.js";
import type { GitHubClient, GitHubPull, IntegrationsPart } from "../src/integrations/index.js";
import { DB_FILENAME, Store, migrations } from "../src/store/index.js";
import type { Migration } from "../src/store/index.js";
import { checkAfterMigrating, checkBeforeMigrating } from "../src/store/integrity.js";
import { phase6Foundation } from "../src/store/migrations/017_phase_6_foundation.js";
import { FAKE_RATE_LIMIT, FAKE_TOKEN_INFO, FakeGitHubClient } from "./fixtures/github-fake.js";

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

let tmp: string;
const stores: Store[] = [];

function open(migrationList?: readonly Migration[]): Store {
  const store = new Store({ dataDir: tmp, ...(migrationList === undefined ? {} : { migrations: migrationList }) });
  stores.push(store);
  return store;
}

/** A read-only inspection connection on studio.db, outside the Store. */
function inspect<T>(fn: (db: Database.Database) => T): T {
  const db = new Database(join(tmp, DB_FILENAME), { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function columnsOf(src: Database.Database | Store, table: string): string[] {
  const sql = `SELECT name FROM pragma_table_info('${table}')`;
  return src instanceof Store ? src.prepare<[], string>(sql).pluck().all() : src.prepare<[], string>(sql).pluck().all();
}

function tablesOf(db: Database.Database): string[] {
  return db.prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all();
}

/** Every row of `tables`, each value rendered with its storage class by quote(). */
function rowsOf(db: Database.Database, tables: readonly string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const cols = columnsOf(db, t);
    out[t] = db.prepare(`SELECT ${cols.map((c) => `quote(${c})`).join(", ")} FROM ${t} ORDER BY rowid`).raw().all();
  }
  return out;
}

function objectsOf(db: Database.Database): { type: string; name: string; tbl_name: string; sql: string | null }[] {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all() as {
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
  }[];
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-integrations-"));
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A contributed tool offered only to agents granted GitHub. */
const GITHUB_TOOL = defineTool({
  name: "kernel_fake_github_read",
  description: "A fake GitHub tool for the filter tests.",
  shape: { repo: z.string() },
  requiresConnector: "github",
  handler: () => "ok",
});

/** A contributed tool every session gets. */
const PLAIN_TOOL = defineTool({
  name: "kernel_fake_plain",
  description: "A fake tool with no connector.",
  shape: {},
  handler: () => "ok",
});

// ---------------------------------------------------------------------------
// Closed sets
// ---------------------------------------------------------------------------

describe("connector closed sets", () => {
  it("CONNECTOR_KINDS is exactly github, frozen", () => {
    expect(CONNECTOR_KINDS).toEqual(["github"]);
    expect(Object.isFrozen(CONNECTOR_KINDS)).toBe(true);
  });

  it("CONNECTOR_STATUSES is exactly the five statuses, frozen", () => {
    expect(CONNECTOR_STATUSES).toEqual(["connected", "rejected", "disconnected", "expiring", "expired"]);
    expect(Object.isFrozen(CONNECTOR_STATUSES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The integrations feature (AC2)
// ---------------------------------------------------------------------------

describe("the integrations feature (AC2)", () => {
  it("is registered last, after console", () => {
    expect(SHIPPED_CONTRIBUTIONS.map((c) => c.name).slice(-2)).toEqual(["console", INTEGRATIONS_NAME]);
    expect(SHIPPED_CONTRIBUTIONS.at(-1)).toBe(integrationsContribution);
  });

  it("merges its four parts in a fixed order: github-connector, github-routes (item 03), github-tools (item 06), drafts (item 07)", () => {
    expect(INTEGRATIONS_PARTS.map((p) => p.name)).toEqual(["github-connector", "github-routes", "github-tools", "drafts"]);
    expect(Object.isFrozen(INTEGRATIONS_PARTS)).toBe(true);
  });

  it.each(INTEGRATIONS_PARTS.map((p) => [p.name, p] as const))("part %s is empty: no tools, routes, subcommands, handlers or due work", (_, part) => {
    expect(part).toEqual({ name: part.name, tools: [], routes: [], subcommands: [], handlers: {}, dueWork: [] });
    expect(Object.isFrozen(part)).toBe(true);
  });

  it("contributes nothing but its name: no tools, routes, subcommands, handlers or due work", () => {
    expect(integrationsContribution).toEqual({ name: "integrations" });
    expect(Object.isFrozen(integrationsContribution)).toBe(true);
    const merged = mergeContributions([integrationsContribution]);
    expect(merged).toEqual({ contributors: ["integrations"], tools: [], routes: [], subcommands: [], handlers: {}, dueWork: [] });
  });

  it("a filled part's tool reaches the contribution under the integrations name, with its connector flag (the merge a later item relies on)", () => {
    const filled: IntegrationsPart = { name: "github-tools", tools: [GITHUB_TOOL], routes: [], handlers: {} };
    const contribution = integrationsContributionOf([...INTEGRATIONS_PARTS.filter((p) => p.name !== "github-tools"), filled]);
    expect(contribution.name).toBe("integrations");
    expect(contribution.tools).toEqual([GITHUB_TOOL]);
    const merged = mergeContributions([contribution]);
    expect(merged.tools.map((t) => [t.name, t.requiresConnector])).toEqual([["kernel_fake_github_read", "github"]]);
  });

  it("nothing under src/integrations imports the Agent SDK, the session manager or kernel.ts; contribution.ts imports the connector kinds type-only", () => {
    const dir = join(SRC_DIR, "integrations");
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
    expect(files.sort()).toEqual(
      ["drafts.ts", "github/connector.ts", "github/routes.ts", "github/tools.ts", "index.ts", "tool-filter.ts", "types.ts"].map((f) => join(f)),
    );
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      const specifiers = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
      for (const s of specifiers) {
        expect(s, `${f} imports ${s}`).not.toMatch(/claude-agent-sdk|sessions\/manager|(^|\/)kernel\.js$/);
      }
    }
    const contribution = readFileSync(join(SRC_DIR, "features", "contribution.ts"), "utf8");
    const integrationImports = contribution.split("\n").filter((l) => /^import\b.*\/integrations\//.test(l));
    expect(integrationImports).toEqual(['import type { ConnectorKind } from "../integrations/types.js";']);
  });
});

// ---------------------------------------------------------------------------
// The per-agent tool filter (the helper subtask 2 wires into the session's server)
// ---------------------------------------------------------------------------

describe("toolsForConnectors", () => {
  const tools: readonly ContributedTool[] = Object.freeze([PLAIN_TOOL, GITHUB_TOOL]);

  it("an agent without the grant: a requiresConnector tool is left out, every other tool stays", () => {
    expect(toolsForConnectors(tools, []).map((t) => t.name)).toEqual(["kernel_fake_plain"]);
  });

  it("an agent granted github: the tool is listed, in the tools' order", () => {
    expect(toolsForConnectors(tools, ["github"]).map((t) => t.name)).toEqual(["kernel_fake_plain", "kernel_fake_github_read"]);
  });

  it("returns a new list and never mutates its input; the tools are the same objects", () => {
    const out = toolsForConnectors(tools, ["github"]);
    expect(out).not.toBe(tools);
    expect(out[1]).toBe(GITHUB_TOOL);
    expect(tools.map((t) => t.name)).toEqual(["kernel_fake_plain", "kernel_fake_github_read"]);
  });

  it("an unknown required kind is never listed (fail closed)", () => {
    const odd = { ...GITHUB_TOOL, requiresConnector: "gitlab" } as unknown as ContributedTool;
    expect(toolsForConnectors([odd], ["github"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Migration 17 (AC1)
// ---------------------------------------------------------------------------

describe("migration 17: phase_6_foundation (AC1)", () => {
  const V16 = migrations.slice(0, 16);

  it("is the last migration, version 17", () => {
    expect(migrations.at(-1)).toBe(phase6Foundation);
    expect([phase6Foundation.version, phase6Foundation.name]).toEqual([17, "phase_6_foundation"]);
  });

  it("on a fresh store creates connectors and draft_outputs with exactly their columns, and adds playbooks.mode / mode_set_by and playbook_runs.item_ref / item_revision", () => {
    const store = open();
    expect(store.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([17, "phase_6_foundation"]);
    expect(columnsOf(store, "connectors")).toEqual([
      "id",
      "kind",
      "status",
      "account_login",
      "permissions_json",
      "reachable_repos_json",
      "expires_at",
      "verified_at",
      "created_at",
      "updated_at",
    ]);
    expect(columnsOf(store, "draft_outputs")).toEqual(["id", "session", "agent", "playbook", "playbook_run", "item_ref", "tool", "payload_json", "created_at"]);
    expect(columnsOf(store, "playbooks").slice(-2)).toEqual(["mode", "mode_set_by"]);
    expect(columnsOf(store, "playbook_runs").slice(-2)).toEqual(["item_ref", "item_revision"]);

    const info = (table: string, column: string): unknown =>
      store.prepare(`SELECT type, "notnull", dflt_value FROM pragma_table_info('${table}') WHERE name = ?`).get(column);
    expect(info("playbooks", "mode")).toEqual({ type: "TEXT", notnull: 1, dflt_value: "'draft'" });
    expect(info("playbooks", "mode_set_by")).toEqual({ type: "TEXT", notnull: 0, dflt_value: null });
    expect(info("playbook_runs", "item_ref")).toEqual({ type: "TEXT", notnull: 0, dflt_value: null });
    expect(info("playbook_runs", "item_revision")).toEqual({ type: "TEXT", notnull: 0, dflt_value: null });
    expect(info("connectors", "kind")).toEqual({ type: "TEXT", notnull: 1, dflt_value: null });
    expect(info("connectors", "status")).toEqual({ type: "TEXT", notnull: 1, dflt_value: null });
    expect(info("draft_outputs", "session")).toEqual({ type: "INTEGER", notnull: 1, dflt_value: null });
    expect(info("draft_outputs", "payload_json")).toEqual({ type: "TEXT", notnull: 1, dflt_value: null });
    expect(store.prepare(`SELECT "from", "table", "to" FROM pragma_foreign_key_list('draft_outputs') ORDER BY "from"`).all()).toEqual([
      { from: "playbook", table: "playbooks", to: "id" },
      { from: "playbook_run", table: "playbook_runs", to: "id" },
      { from: "session", table: "sessions", to: "id" },
    ]);
  });

  it("connectors has no secret column: a token lives only in the Keychain", () => {
    const store = open();
    for (const c of columnsOf(store, "connectors")) expect(c).not.toMatch(/token|secret|password|credential|key/i);
  });

  it("a new playbook reads mode draft and mode_set_by null; the value sets are closed in code (no CHECK, no SQL trigger)", () => {
    const store = open();
    store.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent) VALUES ('review', 'Review', 'wright', 'review PRs')").run();
    expect(store.prepare("SELECT mode, mode_set_by FROM playbooks").get()).toEqual({ mode: "draft", mode_set_by: null });
    store.prepare("INSERT INTO connectors (kind, status) VALUES ('later_kind', 'later_status')").run();
    store.prepare("INSERT INTO sessions (agent, status) VALUES ('mason', 'completed')").run();
    store.prepare("INSERT INTO draft_outputs (session, agent, tool, payload_json) VALUES (1, 'mason', 'kernel_later', '{}')").run();
    expect(() => store.prepare("INSERT INTO draft_outputs (session, agent, tool, payload_json) VALUES (99, 'mason', 't', '{}')").run()).toThrow(/FOREIGN KEY/);
    for (const t of ["connectors", "draft_outputs"]) {
      const sql = store.prepare<[string], string>("SELECT sql FROM sqlite_master WHERE name = ?").pluck().get(t) ?? "";
      expect(sql, t).not.toMatch(/CHECK/i);
    }
    expect(store.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name <> 'events'").pluck().get()).toBe(0);
  });

  it("upgrades a v16 store with a playbook and a run: the playbook reads mode draft and mode_set_by null, the run reads null item fields, every row keeps its values, only the two tables are new, and the integrity check passes before and after", () => {
    const v16 = open(V16);
    v16.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, priority, priority_set_by) VALUES ('review', 'Review', 'wright', 'review PRs', 'high', 'owner')").run();
    v16.prepare("INSERT INTO sessions (agent, status, playbook, playbook_version) VALUES ('wright', 'completed', 1, 1)").run();
    v16.prepare("INSERT INTO playbook_runs (playbook, version, kind, status, session_id, dedupe_key) VALUES (1, 1, 'fire', 'done', 1, 'k')").run();
    v16.close();
    const before = inspect((db) => {
      expect(() => checkBeforeMigrating(db, tmp, migrations, V16.map((m) => m.version))).not.toThrow();
      const tables = tablesOf(db).filter((t) => t !== "schema_migrations");
      const cols: Record<string, string[]> = {};
      for (const t of tables) cols[t] = columnsOf(db, t);
      return { tables, cols, rows: rowsOf(db, tables), objects: objectsOf(db) };
    });
    expect(before.tables).not.toContain("connectors");
    expect(before.tables).not.toContain("draft_outputs");

    const store = open();
    expect(store.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([17, "phase_6_foundation"]);
    expect(store.prepare("SELECT mode, mode_set_by FROM playbooks WHERE id = 1").get()).toEqual({ mode: "draft", mode_set_by: null });
    expect(store.prepare("SELECT item_ref, item_revision FROM playbook_runs WHERE id = 1").get()).toEqual({ item_ref: null, item_revision: null });
    store.close();

    inspect((db) => {
      expect(() => checkAfterMigrating(db, tmp, migrations)).not.toThrow();
      const added: Record<string, string[]> = { playbooks: ["mode", "mode_set_by"], playbook_runs: ["item_ref", "item_revision"] };
      for (const t of before.tables) {
        const cols = before.cols[t] ?? [];
        expect(columnsOf(db, t), t).toEqual([...cols, ...(added[t] ?? [])]);
        expect(db.prepare(`SELECT ${cols.map((c) => `quote(${c})`).join(", ")} FROM ${t} ORDER BY rowid`).raw().all(), t).toEqual(before.rows[t]);
      }
      const altered = (o: { name: string }): boolean => o.name === "playbooks" || o.name === "playbook_runs";
      const named = (o: { name: string }): boolean => before.objects.some((b) => b.name === o.name);
      const after = objectsOf(db);
      expect(after.filter((o) => named(o) && !altered(o))).toEqual(before.objects.filter((o) => !altered(o)));
      expect(after.filter((o) => !named(o)).map((o) => [o.type, o.name])).toEqual([
        ["table", "connectors"],
        ["table", "draft_outputs"],
      ]);
      expect(db.prepare("SELECT count(*) FROM connectors").pluck().get()).toBe(0);
      expect(db.prepare("SELECT count(*) FROM draft_outputs").pluck().get()).toBe(0);
      expect(db.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name <> 'events'").pluck().get()).toBe(0);
    });
  });

  it("is safe to re-run: with its record deleted, migration 17 runs again as a no-op and every row and object stays", () => {
    const first = open();
    first.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, mode, mode_set_by) VALUES ('review', 'Review', 'wright', 'review PRs', 'draft', 'owner')").run();
    first.prepare("INSERT INTO sessions (agent, status, playbook, playbook_version) VALUES ('mason', 'completed', 1, 1)").run();
    first.prepare("INSERT INTO playbook_runs (playbook, version, kind, item_ref, item_revision) VALUES (1, 1, 'fire', 'github:o/r#1', 'abc')").run();
    first.prepare("INSERT INTO connectors (kind, status, account_login) VALUES ('github', 'connected', 'someone')").run();
    first.prepare("INSERT INTO draft_outputs (session, agent, playbook, playbook_run, item_ref, tool, payload_json) VALUES (1, 'mason', 1, 1, 'github:o/r#1', 'kernel_x', '{}')").run();
    first.close();
    const snap = (): unknown =>
      inspect((db) => {
        const tables = tablesOf(db).filter((t) => t !== "schema_migrations");
        return { rows: rowsOf(db, tables), objects: objectsOf(db) };
      });
    const before = snap();

    const db = new Database(join(tmp, DB_FILENAME));
    db.exec("DELETE FROM schema_migrations WHERE version = 17");
    db.close();
    const rerun = open();
    expect(rerun.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([17, "phase_6_foundation"]);
    rerun.close();
    expect(snap()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// The GitHub client contract and its fake
// ---------------------------------------------------------------------------

describe("FakeGitHubClient", () => {
  const PULL: GitHubPull = {
    number: 7,
    title: "Add a thing",
    author: "alice",
    draft: false,
    head_sha: "abc123",
    url: "https://github.com/o/r/pull/7",
    updated_at: "2026-10-27T10:00:00Z",
    body: "please review",
    state: "open",
    base_ref: "main",
    head_ref: "feature/thing",
    labels: ["x"],
  };
  const DRAFT: GitHubPull = { ...PULL, number: 8, draft: true, author: "bob", head_sha: "def456" };

  function fake(): FakeGitHubClient {
    return new FakeGitHubClient({
      repos: [{ full_name: "o/r", private: true }],
      pulls: { "o/r": [PULL, DRAFT] },
      diffs: { "o/r#7": "diff --git a/x b/x\n+hello\n" },
      files: { "o/r#7": [{ path: "x", status: "modified", additions: 1, deletions: 0 }] },
      comments: { "o/r#7": [{ kind: "issue", author: "bob", body: "LGTM", created_at: "2026-10-27T11:00:00Z", path: null }] },
    });
  }

  it("is a GitHubClient that never reaches the network: every call answers from canned data, with the rate limit, and fetch is never called", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client: GitHubClient = fake();
    const answers = [
      await client.getTokenInfo(),
      await client.listReachableRepos(),
      await client.listOpenPulls("o/r", {}),
      await client.getPull("o/r", 7),
      await client.getPullDiff("o/r", 7, 1_000),
      await client.listPullFiles("o/r", 7),
      await client.listPullComments("o/r", 7),
    ];
    expect(fetchSpy).not.toHaveBeenCalled();
    for (const a of answers) expect(a).toMatchObject({ ok: true, rateLimit: FAKE_RATE_LIMIT });
    expect(answers[0]).toMatchObject({ data: FAKE_TOKEN_INFO });
    expect(answers[1]).toMatchObject({ data: [{ full_name: "o/r", private: true }] });
    expect(answers[3]).toMatchObject({ data: PULL });
    expect(answers[4]).toMatchObject({ data: { diff: "diff --git a/x b/x\n+hello\n", truncated: false } });
  });

  it("records every call in order with its arguments", async () => {
    const client = fake();
    await client.listOpenPulls("o/r", { draft: false });
    await client.getPullDiff("o/r", 7, 10);
    expect(client.calls).toEqual([
      { method: "listOpenPulls", args: ["o/r", { draft: false }] },
      { method: "getPullDiff", args: ["o/r", 7, 10] },
    ]);
  });

  it("applies the draft and author filters to the open-pull listing, which shows summaries only", async () => {
    const client = fake();
    const notDraft = await client.listOpenPulls("o/r", { draft: false });
    expect(notDraft.ok && notDraft.data.map((p) => p.number)).toEqual([7]);
    const byBob = await client.listOpenPulls("o/r", { author: "bob" });
    expect(byBob.ok && byBob.data.map((p) => p.number)).toEqual([8]);
    const all = await client.listOpenPulls("o/r", {});
    expect(all.ok && all.data[0]).toEqual({ number: 7, title: "Add a thing", author: "alice", draft: false, head_sha: "abc123", url: PULL.url, updated_at: PULL.updated_at });
  });

  it("cuts a diff at the byte bound and says so; an unknown pull is http_error 404; a canned failure is returned, never thrown", async () => {
    const cut = await fake().getPullDiff("o/r", 7, 4);
    expect(cut).toMatchObject({ ok: true, data: { diff: "diff", truncated: true } });
    expect(await fake().getPull("o/r", 99)).toEqual({ ok: false, error: "http_error", status: 404, rateLimit: FAKE_RATE_LIMIT });
    const limited = new FakeGitHubClient({
      failures: { listOpenPulls: { ok: false, error: "rate_limited", resets_at: "2026-10-27T13:00:00.000Z", rateLimit: { limit: 5000, remaining: 0, reset_at: "2026-10-27T13:00:00.000Z" } } },
    });
    expect(await limited.listOpenPulls("o/r", {})).toMatchObject({ ok: false, error: "rate_limited", resets_at: "2026-10-27T13:00:00.000Z" });
    expect(limited.calls).toEqual([{ method: "listOpenPulls", args: ["o/r", {}] }]);
  });

  it("answers copies: mutating an answer never changes the canned data", async () => {
    const client = fake();
    const first = await client.getPull("o/r", 7);
    if (first.ok) (first.data as { title: string }).title = "changed";
    const second = await client.getPull("o/r", 7);
    expect(second.ok && second.data.title).toBe("Add a thing");
  });
});
