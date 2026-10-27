// Phase 6 foundation (item 01): the `integrations` feature's seams, its shared
// types and test fake, the per-agent tool filter, and migration 17; then the
// grown closed sets, each refused until its item lands (`poll`, playbook
// `mode` `live`, the item dedupe fields), agent `connectors`, and the session
// seams (the per-agent tool list and the policy's `mode` / `connectors`).
// Later phase 6 items extend this file with their refusals and seams.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { agentSettingsPath, readAgentSettings } from "../src/agents/settings.js";
import { SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import type { ContributedRoute, ContributedTool } from "../src/features/index.js";
import {
  CONNECTORS_HELP,
  CONNECTORS_SUBCOMMAND,
  CONNECTOR_KINDS,
  CONNECTOR_STATUSES,
  INTEGRATIONS_NAME,
  INTEGRATIONS_PARTS,
  integrationsContribution,
  integrationsContributionOf,
  toolsForConnectors,
} from "../src/integrations/index.js";
import type { GitHubClient, GitHubPull, IntegrationsPart } from "../src/integrations/index.js";
import { githubExpiryDueWork } from "../src/integrations/github/connector.js";
import { DB_FILENAME, Store, migrations } from "../src/store/index.js";
import type { Migration } from "../src/store/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import { previewDedupeKey } from "../src/playbooks/dry-run.js";
import { playbooksContribution } from "../src/playbooks/index.js";
import { evaluateDedupeKey } from "../src/playbooks/runs.js";
import { PlaybookError, createPlaybook, getPlaybook, setPlaybookPolicy, updatePlaybook } from "../src/playbooks/store.js";
import { DEDUPE_KEY_FIELDS, PLAYBOOK_MODES } from "../src/playbooks/types.js";
import { SessionManager } from "../src/sessions/manager.js";
import { decideToolUse } from "../src/sessions/policy.js";
import type { ToolPolicy } from "../src/sessions/types.js";
import { checkAfterMigrating, checkBeforeMigrating } from "../src/store/integrity.js";
import { phase6Foundation } from "../src/store/migrations/017_phase_6_foundation.js";
import { contributedToolHandler } from "../src/tools/server.js";
import type { KernelToolContext, KernelToolResult } from "../src/tools/server.js";
import { TRIGGER_KINDS, TriggerError, registerTrigger, triggersContribution, updateTriggerSpec } from "../src/triggers/index.js";
import { FAKE_RATE_LIMIT, FAKE_TOKEN_INFO, FakeGitHubClient } from "./fixtures/github-fake.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

// The gate's policy input, observed: `decideToolUse` still runs as shipped; the spy only records its arguments.
vi.mock("../src/sessions/policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/sessions/policy.js")>();
  return { ...actual, decideToolUse: vi.fn(actual.decideToolUse) };
});

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

  it.each(INTEGRATIONS_PARTS.filter((p) => p.name === "github-tools" || p.name === "drafts").map((p) => [p.name, p] as const))(
    "part %s is still empty: no tools, routes, subcommands, handlers or due work (items 06 and 07 fill them)",
    (_, part) => {
      expect(part).toEqual({ name: part.name, tools: [], routes: [], subcommands: [], handlers: {}, dueWork: [] });
      expect(Object.isFrozen(part)).toBe(true);
    },
  );

  it("item 03 filled the github parts: github-connector has the connectors subcommand and the expiry due work, github-routes the four /connectors routes", () => {
    const [connector, routes] = INTEGRATIONS_PARTS;
    expect(connector?.name).toBe("github-connector");
    expect(connector?.tools).toEqual([]);
    expect(connector?.routes).toEqual([]);
    expect(connector?.handlers).toEqual({});
    expect(connector?.subcommands?.map((s) => [s.name, s.help])).toEqual([[CONNECTORS_SUBCOMMAND, CONNECTORS_HELP]]);
    expect(connector?.dueWork).toEqual([githubExpiryDueWork]);
    expect(routes?.name).toBe("github-routes");
    expect(routes?.tools).toEqual([]);
    expect(routes?.handlers).toEqual({});
    expect(routes?.subcommands).toEqual([]);
    expect(routes?.dueWork).toEqual([]);
    expect(routes?.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /connectors",
      "POST /connectors/github/token",
      "POST /connectors/github/disconnect",
      "GET /connectors/github/repos",
    ]);
    for (const part of [connector, routes]) expect(Object.isFrozen(part)).toBe(true);
  });

  it("contributes the github parts only: four routes, one subcommand and one due work, no tools or handlers", () => {
    expect(Object.keys(integrationsContribution).sort()).toEqual(["dueWork", "name", "routes", "subcommands"]);
    expect(Object.isFrozen(integrationsContribution)).toBe(true);
    const merged = mergeContributions([integrationsContribution]);
    expect(merged.contributors).toEqual(["integrations"]);
    expect(merged.tools).toEqual([]);
    expect(merged.handlers).toEqual({});
    expect(merged.routes.map((r) => `${r.owner} ${r.method} ${r.path}`)).toEqual([
      "integrations GET /connectors",
      "integrations POST /connectors/github/token",
      "integrations POST /connectors/github/disconnect",
      "integrations GET /connectors/github/repos",
    ]);
    expect(merged.subcommands.map((s) => s.name)).toEqual(["connectors"]);
    expect(merged.dueWork).toEqual([{ owner: "integrations", run: githubExpiryDueWork }]);
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
      ["cli.ts", "drafts.ts", "github/client.ts", "github/connector.ts", "github/routes.ts", "github/tools.ts", "index.ts", "tool-filter.ts", "types.ts"].map((f) => join(f)),
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

// ---------------------------------------------------------------------------
// The grown closed sets, each refused until its item lands (AC3, AC4, AC5)
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-27T10:00:00.000Z");

/** Call a shipped contributed tool as session 1 running `agent`, through the tool server's own handler. */
function callTool(store: Store, contribution: { readonly tools?: readonly ContributedTool[] }, name: string, args: unknown, agent = "wright"): Promise<KernelToolResult> {
  const found = (contribution.tools ?? []).find((t) => t.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  const sessions = { stopSession: async () => "stopped", getSession: (id: number) => (id === 1 ? { id, agent } : undefined) } as unknown as KernelToolContext["sessions"];
  return contributedToolHandler(found, { store, sessions, sessionId: 1, now: () => NOW })(args);
}

function textOf(r: KernelToolResult): string {
  return r.content[0]?.text ?? "";
}

/** Every row count the trigger and playbook paths could write. */
function written(store: Store): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of ["triggers", "playbooks", "playbook_versions", "events"]) out[t] = store.prepare(`SELECT count(*) FROM ${t}`).pluck().get();
  return out;
}

const NOTHING = { triggers: 0, playbooks: 0, playbook_versions: 0, events: 0 };

const CRON = { kind: "cron", spec: "0 9 * * 1-5", tz: "UTC" } as const;

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

describe("poll triggers are refused poll_not_implemented (AC3)", () => {
  it("TRIGGER_KINDS names poll, so every set derived from it carries it", () => {
    expect(TRIGGER_KINDS).toEqual(["once", "cron", "poll"]);
  });

  it("kernel_trigger_register with kind poll: refused naming poll_not_implemented, nothing written", async () => {
    const store = open();
    const r = await callTool(store, triggersContribution, "kernel_trigger_register", { kind: "poll", spec: "every 5m", action: "notify", text: "hi", idempotency_key: "k1" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/poll_not_implemented/);
    expect(written(store)).toEqual(NOTHING);
  });

  it("registerTrigger and updateTriggerSpec throw TriggerError poll_not_implemented before any write; the stored trigger is unchanged", () => {
    const store = open();
    const reg = thrown(() => registerTrigger(store, { agent: "wright", kind: "poll", spec: "x", action: "notify", text: "hi" }, NOW));
    expect(reg).toBeInstanceOf(TriggerError);
    expect((reg as TriggerError).code).toBe("poll_not_implemented");
    expect(written(store)).toEqual(NOTHING);

    const { id } = registerTrigger(store, { agent: "wright", kind: "cron", spec: "0 9 * * *", tz: "UTC", action: "notify", text: "hi" }, NOW);
    const before = store.prepare("SELECT * FROM triggers").all();
    const upd = thrown(() => updateTriggerSpec(store, { id, agent: "wright", kind: "poll", spec: "x" }, NOW));
    expect((upd as TriggerError).code).toBe("poll_not_implemented");
    expect(store.prepare("SELECT * FROM triggers").all()).toEqual(before);
  });

  it("a playbook draft whose trigger kind is poll: refused through the trigger (`trigger: poll_not_implemented: …`), nothing written, on the store and the tool path", async () => {
    const store = open();
    const err = thrown(() => createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: { kind: "poll", spec: "x" } }, NOW));
    expect(err).toBeInstanceOf(PlaybookError);
    expect((err as PlaybookError).message).toMatch(/^trigger: poll_not_implemented: /);
    expect(written(store)).toEqual(NOTHING);

    const r = await callTool(store, playbooksContribution, "kernel_playbook_create", { name: "Review", intent: "review PRs", trigger: { kind: "poll", spec: "x" }, idempotency_key: "k1" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^kernel_playbook_create: trigger: poll_not_implemented: /);
    expect(written(store)).toEqual(NOTHING);
  });
});

describe("playbook mode (AC3, AC5)", () => {
  it("PLAYBOOK_MODES is exactly draft, live, frozen; a new playbook is draft with no setter", () => {
    expect(PLAYBOOK_MODES).toEqual(["draft", "live"]);
    expect(Object.isFrozen(PLAYBOOK_MODES)).toBe(true);
    const store = open();
    const { playbook } = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON }, NOW);
    expect([playbook.mode, playbook.mode_set_by]).toEqual(["draft", null]);
  });

  it("the owner's mode live is refused live_mode_not_in_phase_6 (route 409, store), nothing written", async () => {
    const store = open();
    const { playbook } = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON }, NOW);
    const before = written(store);
    const set = (playbooksContribution.routes ?? []).find((r) => r.method === "POST" && r.path === "/playbooks/:id/set") as ContributedRoute;
    const res = await set.handler({ params: { id: String(playbook.id) }, query: {}, body: { field: "mode", value: "live" }, store, now: () => NOW });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "live_mode_not_in_phase_6" });
    const err = thrown(() => setPlaybookPolicy(store, { id: playbook.id, field: "mode", value: "live" }, NOW));
    expect((err as PlaybookError).code).toBe("live_mode_not_in_phase_6");
    expect(written(store)).toEqual(before);
    expect(getPlaybook(store, playbook.id)?.mode).toBe("draft");
  });

  it("the owner's mode draft is stored with mode_set_by owner; a later agent edit of mode (kernel_playbook_update) is refused like every owner-locked field", async () => {
    const store = open();
    const { playbook } = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON, mode: "draft" }, NOW);
    expect(playbook.mode_set_by).toBe("wright");
    const set = (playbooksContribution.routes ?? []).find((r) => r.method === "POST" && r.path === "/playbooks/:id/set") as ContributedRoute;
    const res = await set.handler({ params: { id: String(playbook.id) }, query: {}, body: { field: "mode", value: "draft" }, store, now: () => NOW });
    expect(res.status).toBe(200);
    expect(getPlaybook(store, playbook.id)).toMatchObject({ mode: "draft", mode_set_by: "owner" });
    const before = written(store);

    const r = await callTool(store, playbooksContribution, "kernel_playbook_update", { id: playbook.id, changes: { mode: "draft" }, idempotency_key: "k2" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("kernel_playbook_update: mode: the owner set this value; only the owner can change it");
    expect(() => updatePlaybook(store, { id: playbook.id, agent: "wright", changes: { mode: "draft" } }, NOW)).toThrow(/^mode: the owner set this value/);
    expect(written(store)).toEqual(before);
  });

  it("Wright's create or update with mode live is refused live_mode_not_in_phase_6, nothing written", async () => {
    const store = open();
    const err = thrown(() => createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON, mode: "live" }, NOW));
    expect((err as PlaybookError).code).toBe("live_mode_not_in_phase_6");
    expect(written(store)).toEqual(NOTHING);
    const created = await callTool(store, playbooksContribution, "kernel_playbook_create", { name: "Review", intent: "review PRs", trigger: CRON, mode: "live", idempotency_key: "k1" });
    expect(textOf(created)).toMatch(/^kernel_playbook_create: live_mode_not_in_phase_6: /);
    expect(written(store)).toEqual(NOTHING);

    const { playbook } = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON }, NOW);
    const before = written(store);
    const updated = await callTool(store, playbooksContribution, "kernel_playbook_update", { id: playbook.id, changes: { mode: "live" }, idempotency_key: "k3" });
    expect(textOf(updated)).toMatch(/^kernel_playbook_update: live_mode_not_in_phase_6: /);
    expect(written(store)).toEqual(before);
  });

  it("mode cannot be cleared, and an unknown mode is invalid_input", () => {
    const store = open();
    const { playbook } = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON }, NOW);
    expect(() => setPlaybookPolicy(store, { id: playbook.id, field: "mode", value: null }, NOW)).toThrow(/^mode must be one of draft, live/);
    const odd = thrown(() => setPlaybookPolicy(store, { id: playbook.id, field: "mode", value: "shadow" }, NOW));
    expect((odd as PlaybookError).code).toBe("invalid_input");
  });
});

describe("the item dedupe fields (AC4)", () => {
  it("DEDUPE_KEY_FIELDS ends item.id, item.revision", () => {
    expect(DEDUPE_KEY_FIELDS.slice(-2)).toEqual(["item.id", "item.revision"]);
  });

  it("the dry-run preview shows each as <per item>", () => {
    const fire = { playbookId: 3, playbookVersion: 2, triggerId: 9, scheduledAt: "2026-10-27T09:00:00.000Z", date: "2026-10-27" };
    expect(previewDedupeKey(JSON.stringify(["item.id", "trigger.id", "item.revision"]), fire)).toBe("item.id=<per item>|trigger.id=9|item.revision=<per item>");
  });

  it("evaluateDedupeKey refuses a spec naming either field while the fire carries no item: dedupe_spec_invalid, never a key without it", () => {
    const input = { playbook: 3, version: 2, triggerId: 9, scheduledAt: "2026-10-27T09:00:00.000Z" };
    for (const spec of [["item.id"], ["item.revision"], ["playbook.id", "item.id"], ["trigger.scheduled_at", "item.revision"]]) {
      expect(evaluateDedupeKey(JSON.stringify(spec), input, "UTC"), spec.join(",")).toEqual({ ok: false, error: "dedupe_spec_invalid" });
    }
    expect(evaluateDedupeKey(JSON.stringify(["playbook.id"]), input, "UTC")).toEqual({ ok: true, key: '{"playbook.id":3}' });
  });

  it("the owner and Wright may still name them in a dedupe key (it is the fire that refuses)", () => {
    const store = open();
    const { playbook } = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON, dedupe_key: ["item.id", "item.revision"] }, NOW);
    expect(playbook.dedupe_key_spec).toBe('["item.id","item.revision"]');
  });
});

describe("agent connectors (AC5)", () => {
  function writeSettings(dataDir: string, id: string, content: Record<string, unknown>): void {
    const file = agentSettingsPath(dataDir, id);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  }
  const BASE = { model: "claude-haiku-4-5", permission_mode: "default", tool_policy: { allowedTools: [], allowedBashPrefixes: [] } };

  it("the settings schema accepts connectors [github] for Wright and a crew member; absent stays absent", () => {
    writeSettings(tmp, "wright", { ...BASE, connectors: ["github"] });
    writeSettings(tmp, "mason", { ...BASE, connectors: ["github"] });
    writeSettings(tmp, "quinn", BASE);
    for (const id of ["wright", "mason"]) {
      const r = readAgentSettings(tmp, id);
      expect(r.ok && r.settings.connectors, id).toEqual(["github"]);
    }
    const none = readAgentSettings(tmp, "quinn");
    expect(none.ok && "connectors" in none.settings).toBe(false);
  });

  it("any other kind is refused settings_invalid naming the entry, for Wright and a crew member", () => {
    writeSettings(tmp, "wright", { ...BASE, connectors: ["gitlab"] });
    writeSettings(tmp, "mason", { ...BASE, connectors: ["github", "slack"] });
    expect(readAgentSettings(tmp, "wright")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors.0" });
    expect(readAgentSettings(tmp, "mason")).toMatchObject({ ok: false, error: "settings_invalid", field: "connectors.1" });
  });
});

// ---------------------------------------------------------------------------
// The session seams: the per-agent tool list (AC7) and the policy's mode / connectors (AC8)
// ---------------------------------------------------------------------------

describe("the session seams (AC7, AC8)", () => {
  const kernels: Kernel[] = [];
  let dataDir: string;

  beforeEach(() => {
    dataDir = join(tmp, "kernel-data");
    vi.mocked(decideToolUse).mockClear();
  });

  afterEach(async () => {
    for (const k of kernels.splice(0)) await k.stop();
  });

  /** A kernel on fake sessions with one extra contribution: a plain tool and a GitHub-only tool. Wright's file grants `connectors`. */
  async function kernelWith(connectors: readonly string[] | undefined): Promise<{ kernel: Kernel; fakes: ReturnType<typeof fakeSessions> }> {
    const file = agentSettingsPath(dataDir, "wright");
    mkdirSync(join(file, ".."), { recursive: true });
    const settings = { model: "claude-haiku-4-5", permission_mode: "default", tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } };
    writeFileSync(file, `${JSON.stringify(connectors === undefined ? settings : { ...settings, connectors }, null, 2)}\n`);
    const fakes = fakeSessions();
    const keychain = new Map<string, string>();
    const kernel = await startKernel(
      {
        dataDir,
        env: { PATH: "/usr/bin" },
        sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 },
        contributions: [{ name: "probe", tools: [PLAIN_TOOL, GITHUB_TOOL] }],
      },
      {
        // An in-memory Keychain: the API token is written and read here, never in the real one.
        keychain: { read: (service) => keychain.get(service) },
        keychainWriter: { add: (service, _account, secret) => void keychain.set(service, secret) },
        sessionDeps: fakes.deps,
        selectAuthProvider: async () => stubProvider(),
        availableProviderIds: async () => ["api-key"],
      },
    );
    kernels.push(kernel);
    return { kernel, fakes };
  }

  function listedTools(fakes: ReturnType<typeof fakeSessions>, n = 0): string[] {
    const server = (fakes.calls[n]?.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
    return Object.keys((server?.instance as { _registeredTools: Record<string, unknown> })._registeredTools);
  }

  async function gate(fakes: ReturnType<typeof fakeSessions>, n = 0): Promise<void> {
    const hook = fakes.calls[n]?.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const input = { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "/tmp/x" }, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
    await hook(input, "toolu_1", { signal: new AbortController().signal });
  }

  /** The policy the gate passed to `decideToolUse` on its last call. */
  function gateInput(): ToolPolicy {
    const call = vi.mocked(decideToolUse).mock.calls.at(-1);
    if (call === undefined) throw new Error("the gate never called decideToolUse");
    return call[0];
  }

  it("an agent without the github grant: its session's kernel server does not list the requiresConnector tool; the plain one stays", async () => {
    const { kernel, fakes } = await kernelWith(undefined);
    await kernel.sessions.startSession(startParams(tmp));
    await vi.waitFor(() => expect(fakes.calls).toHaveLength(1));
    const listed = listedTools(fakes);
    expect(listed).toContain("kernel_fake_plain");
    expect(listed).not.toContain("kernel_fake_github_read");
  });

  it("an agent with connectors [github] in its settings: the tool is listed", async () => {
    const { kernel, fakes } = await kernelWith(["github"]);
    await kernel.sessions.startSession(startParams(tmp));
    await vi.waitFor(() => expect(fakes.calls).toHaveLength(1));
    expect(listedTools(fakes)).toEqual(expect.arrayContaining(["kernel_fake_plain", "kernel_fake_github_read"]));
  });

  it("a granted agent's playbook session: the gate's policy input carries mode draft and connectors [github]; the caller's policy is never mutated, and its own mode/connectors never reach the gate", async () => {
    const { kernel, fakes } = await kernelWith(["github"]);
    const playbook = createPlaybook(kernel.store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON }, NOW).playbook;
    const policy = Object.freeze({ allowedTools: ["Read"], allowedBashPrefixes: [], mode: "live", connectors: [] }) as unknown as ToolPolicy;
    await kernel.sessions.startSession(startParams(tmp, { policy, playbook: playbook.id, playbookVersion: playbook.version }));
    await vi.waitFor(() => expect(fakes.calls).toHaveLength(1));
    await gate(fakes);
    expect(gateInput()).toEqual({ allowedTools: ["Read"], allowedBashPrefixes: [], mode: "draft", connectors: ["github"] });
    expect(Object.isFrozen(gateInput())).toBe(true);
    expect(policy).toEqual({ allowedTools: ["Read"], allowedBashPrefixes: [], mode: "live", connectors: [] });
  });

  it("the manager alone fills them, failing closed: a connectorsFor that throws grants none, an unknown kind is dropped, a stored mode outside the list reads draft; a resume fills them again", async () => {
    const store = open();
    const pluginDir = makePluginDir(tmp);
    const fakes = fakeSessions();
    let answer: () => readonly string[] = () => {
      throw new Error("settings unreadable");
    };
    const seen: (readonly string[])[] = [];
    const manager = new SessionManager(
      {
        store,
        authProvider: stubProvider(),
        loomwrightPath: pluginDir,
        stopGraceMs: 10,
        connectorsFor: () => answer() as never,
        mcpServers: ({ connectors }) => {
          seen.push(connectors);
          return {};
        },
      },
      fakes.deps,
    );
    const playbook = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: CRON }, NOW).playbook;
    // No writer stores a mode outside PLAYBOOK_MODES (no CHECK either): if one did, the session reads draft, which sends nothing.
    store.prepare("UPDATE playbooks SET mode = 'shadow' WHERE id = ?").run(playbook.id);
    await manager.startSession(startParams(tmp, { playbook: playbook.id }));
    await gate(fakes);
    expect(gateInput()).toMatchObject({ mode: "draft", connectors: [] });
    expect(seen).toEqual([[]]);

    answer = () => ["github", "gitlab", "github"];
    const sid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const id = Number(
      store
        .prepare("INSERT INTO sessions (agent, status, sdk_session_id, model, loomwright_path, pgid, playbook) VALUES ('wright', 'interrupted', ?, 'claude-haiku-4-5', ?, 4242, ?)")
        .run(sid, pluginDir, playbook.id).lastInsertRowid,
    );
    store.prepare("UPDATE playbooks SET mode = 'draft' WHERE id = ?").run(playbook.id);
    await manager.resumeSession(id, { permissionMode: "default", cwd: tmp, policy: { allowedTools: [], allowedBashPrefixes: [] } });
    await gate(fakes, 1);
    expect(gateInput()).toEqual({ allowedTools: [], allowedBashPrefixes: [], mode: "draft", connectors: ["github"] });
    expect(seen).toEqual([[], ["github"]]);
    await manager.stopAll();
  });

  it("a session that runs for no playbook has no mode; an ungranted agent's connectors are []", async () => {
    const { kernel, fakes } = await kernelWith(undefined);
    await kernel.sessions.startSession(startParams(tmp));
    await vi.waitFor(() => expect(fakes.calls).toHaveLength(1));
    await gate(fakes);
    expect(gateInput()).toEqual({ allowedTools: ["Read"], allowedBashPrefixes: ["echo"], connectors: [] });
    expect("mode" in gateInput()).toBe(false);
  });
});
