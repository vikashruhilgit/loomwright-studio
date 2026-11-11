// The console's saved-workspaces part (phase 8 item 18c): the owner's one list
// of repo folders (`saved_workspaces`, migration 24), its three routes
// (`GET /workspaces[?repo=]`, `POST /workspaces`, `POST /workspaces/:id/remove`)
// and the lookup (`lookupSavedWorkspaces`). Real temp git checkouts made with
// `git init` and `git remote add`, a temp data dir and a fake home dir for the
// D31 protected folders (`workspacesPartWith({homeDir})`); the owner-only
// pins drive a real API server on 127.0.0.1 over the shipped composition.
// Never the real SDK, a model, the network or the Keychain.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PHASE1_ROUTES, startApiServer } from "../src/api/server.js";
import type { ApiServer } from "../src/api/server.js";
import { lookupSavedWorkspaces, workspacesPart, workspacesPartWith } from "../src/console/workspaces.js";
import type { SavedWorkspace } from "../src/console/workspaces.js";
import type { ContributedRouteRequest, ContributedRouteResponse, MergedContributions } from "../src/features/contribution.js";
import { PHASE1_RESERVED, PHASE1_SUBCOMMANDS, PHASE1_TOOL_NAMES, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { PROTECTED_FOLDER_WHY, PROTECTED_LOCATIONS, protectedFolderRefusal, protectedLocationsText, resolvedPath } from "../src/protected-paths.js";
import { PROTECTED_DATA_FILES, classifyToolCall } from "../src/sessions/policy.js";
import { migrations } from "../src/store/migrations/index.js";
import { savedWorkspaces } from "../src/store/migrations/024_saved_workspaces.js";
import { DB_FILENAME, Store } from "../src/store/store.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const T1 = new Date("2026-11-11T09:00:00.000Z");
const T2 = new Date("2026-11-11T10:00:00.000Z");
const T3 = new Date("2026-11-11T11:00:00.000Z");
const T4 = new Date("2026-11-11T12:00:00.000Z");
const TOKEN = "0123456789abcdef".repeat(4);
/** No user or system git config, so a developer's settings can't change what `git init` writes. */
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

let tmp: string;
let home: string;
let dataDir: string;
let store: Store;
const servers: ApiServer[] = [];
const unlock: string[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-workspaces-"));
  home = join(tmp, "home");
  mkdirSync(home);
  dataDir = join(tmp, "data");
  store = new Store({ dataDir });
});

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const p of unlock.splice(0)) chmodSync(p, 0o755);
  if (store.isOpen) store.close();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Fixtures ----------------------------------------------------------------------

/** A real git checkout at `dir` (created), with `remotes` added in order as `r0`, `r1`, … */
function checkout(dir: string, remotes: readonly string[] = []): string {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q", dir], { env: GIT_ENV });
  remotes.forEach((url, i) => execFileSync("git", ["-C", dir, "remote", "add", `r${i}`, url], { env: GIT_ENV }));
  return dir;
}

const part = workspacesPartWith({ homeDir: () => home });

/** Call one of `part`'s routes directly, as the API server would after the token check. */
async function call(
  method: "GET" | "POST",
  path: string,
  init: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown; at?: Date } = {},
): Promise<ContributedRouteResponse> {
  const route = part.routes.find((r) => r.method === method && r.path === path);
  if (route === undefined) throw new Error(`no route ${method} ${path}`);
  const req: ContributedRouteRequest = { params: init.params ?? {}, query: init.query ?? {}, body: init.body, store, now: () => init.at ?? T1 } as ContributedRouteRequest;
  return route.handler(req);
}

const add = (path: unknown, at: Date = T1): Promise<ContributedRouteResponse> => call("POST", "/workspaces", { body: { path }, at });
const list = async (repo?: string): Promise<SavedWorkspace[]> => {
  const res = await call("GET", "/workspaces", repo === undefined ? {} : { query: { repo } });
  expect(res.status).toBe(200);
  return (res.body as { workspaces: SavedWorkspace[] }).workspaces;
};
const remove = (id: string): Promise<ContributedRouteResponse> => call("POST", "/workspaces/:id/remove", { params: { id } });
const rowCount = (): number => store.prepare<[], number>("SELECT count(*) FROM saved_workspaces").pluck().get() as number;
const tableRows = (): unknown[] => store.prepare("SELECT * FROM saved_workspaces ORDER BY id").all();
const saved = (res: ContributedRouteResponse): { workspace: SavedWorkspace; note: string | null } => {
  expect(res.status).toBe(200);
  return res.body as { workspace: SavedWorkspace; note: string | null };
};
const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

// ---- Migration 24 ----------------------------------------------------------------------

describe("migration 24: saved_workspaces", () => {
  const cols = (s: Store): unknown[] => s.prepare("SELECT name, type, \"notnull\", pk FROM pragma_table_info('saved_workspaces')").all();

  it("is version 24, named saved_workspaces, the last migration; creates the table with exactly its columns, path UNIQUE, and no SQL trigger", () => {
    expect(migrations.at(-1)).toBe(savedWorkspaces);
    expect([savedWorkspaces.version, savedWorkspaces.name]).toEqual([24, "saved_workspaces"]);
    expect(store.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([24, "saved_workspaces"]);
    expect(cols(store)).toEqual([
      { name: "id", type: "INTEGER", notnull: 0, pk: 1 },
      { name: "path", type: "TEXT", notnull: 1, pk: 0 },
      { name: "repo", type: "TEXT", notnull: 0, pk: 0 },
      { name: "added_at", type: "TEXT", notnull: 1, pk: 0 },
      { name: "last_used_at", type: "TEXT", notnull: 1, pk: 0 },
    ]);
    const insert = store.prepare("INSERT INTO saved_workspaces (path, repo, added_at, last_used_at) VALUES (?, NULL, 'a', 'a')");
    insert.run("/x");
    expect(() => insert.run("/x")).toThrow(/UNIQUE/);
    expect(store.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'saved_workspaces'").pluck().get()).toBe(0);
  });

  it("is safe to re-run: with its record deleted, migration 24 runs again as a no-op and every row stays", () => {
    store.prepare("INSERT INTO saved_workspaces (path, repo, added_at, last_used_at) VALUES ('/a', 'o/r', ?, ?)").run(T1.toISOString(), T2.toISOString());
    const before = tableRows();
    store.close();
    const db = new Database(join(dataDir, DB_FILENAME));
    db.exec("DELETE FROM schema_migrations WHERE version = 24");
    db.close();
    store = new Store({ dataDir });
    expect(store.appliedMigrations().map((m) => [m.version, m.name]).at(-1)).toEqual([24, "saved_workspaces"]);
    expect(tableRows()).toEqual(before);
  });
});

// ---- The D31 sentence --------------------------------------------------------------------

describe("protectedFolderRefusal (D31's one sentence)", () => {
  it("names the folder, the protected list and why, exactly as the charter's workspace refusal always said it", () => {
    const path = "/Users/owner/Documents/repo";
    expect(protectedFolderRefusal(path)).toBe(
      `${path} is inside a macOS-protected folder (${protectedLocationsText()}), so it can't be used: ${PROTECTED_FOLDER_WHY}; use a copy of the repo outside those folders`,
    );
    expect(protectedFolderRefusal(path)).toContain("~/Documents, ~/Desktop, ~/Downloads, ~/Library/Mobile Documents");
  });
});

// ---- AC1: add and list ---------------------------------------------------------------------

describe("POST /workspaces and GET /workspaces (AC1)", () => {
  it("saves a git checkout with a GitHub remote: listed with repo o/r, its resolved path, last used and state ready", async () => {
    const dir = checkout(join(tmp, "code", "r"), ["https://github.com/o/r.git"]);
    const answer = saved(await add(dir, T2));
    expect(answer.note).toBeNull();
    expect(answer.workspace).toMatchObject({ path: resolvedPath(dir), repo: "o/r", added_at: T2.toISOString(), last_used_at: T2.toISOString(), state: "ready" });
    expect(Number.isSafeInteger(answer.workspace.id)).toBe(true);
    expect(await list()).toEqual([answer.workspace]);
  });

  it("re-saving touches the row: last used moves, added_at and id stay; a symlinked spelling of the folder is the same row", async () => {
    const dir = checkout(join(tmp, "code", "r"), ["git@github.com:o/r.git"]);
    const first = saved(await add(dir, T1)).workspace;
    const link = join(tmp, "link");
    symlinkSync(dir, link);
    const again = saved(await add(link, T3)).workspace;
    expect(again).toEqual({ ...first, last_used_at: T3.toISOString() });
    expect(rowCount()).toBe(1);
  });

  it("the first GitHub remote is the row's repo, skipping a non-GitHub one", async () => {
    const dir = checkout(join(tmp, "code", "two"), ["https://gitlab.com/x/y.git", "https://github.com/o/first.git", "https://github.com/o/second.git"]);
    expect(saved(await add(dir)).workspace.repo).toBe("o/first");
  });

  it("refuses a body that is not {path} or a path that is not absolute: 400 invalid_input, nothing written", async () => {
    for (const body of [null, [], "x", 1]) {
      expect((await call("POST", "/workspaces", { body })).body).toMatchObject({ error: "invalid_input" });
    }
    for (const path of [undefined, "", "code/r", "./r", 7, null, `/a${"\0"}b`, `/${"a".repeat(1100)}`]) {
      const res = await add(path);
      expect(res.status, String(path)).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_input" });
    }
    expect(rowCount()).toBe(0);
  });
});

// ---- AC2: lookup by repo ------------------------------------------------------------------

describe("the lookup: GET /workspaces?repo= and lookupSavedWorkspaces (AC2)", () => {
  it("returns exactly the o/r rows, most recently used first; saving the older one again moves it first", async () => {
    const older = saved(await add(checkout(join(tmp, "a"), ["https://github.com/o/r.git"]), T1)).workspace;
    const newer = saved(await add(checkout(join(tmp, "b"), ["https://github.com/o/r"]), T2)).workspace;
    saved(await add(checkout(join(tmp, "c"), ["https://github.com/o/s.git"]), T3));

    expect((await list("o/r")).map((w) => w.id)).toEqual([newer.id, older.id]);
    expect(lookupSavedWorkspaces(store, "o/r")).toEqual(await list("o/r"));
    // Case-insensitive, as GitHub names are.
    expect((await list("O/R")).map((w) => w.id)).toEqual([newer.id, older.id]);
    // The full list keeps the same order over every row.
    expect((await list()).map((w) => w.repo)).toEqual(["o/s", "o/r", "o/r"]);

    await add(older.path, T4);
    expect((await list("o/r")).map((w) => w.id)).toEqual([older.id, newer.id]);
    expect(lookupSavedWorkspaces(store, "o/r").map((w) => w.id)).toEqual([older.id, newer.id]);
    expect(await list("o/none")).toEqual([]);
  });

  it("reads remotes fresh: a ready row whose remote no longer names the repo is left out, one that now does is found", async () => {
    const dir = checkout(join(tmp, "a"), ["https://github.com/o/r.git"]);
    const row = saved(await add(dir)).workspace;
    execFileSync("git", ["-C", dir, "remote", "set-url", "r0", "https://github.com/o/moved.git"], { env: GIT_ENV });
    expect(await list("o/r")).toEqual([]);
    expect((await list("o/moved")).map((w) => [w.id, w.repo, w.state])).toEqual([[row.id, "o/r", "ready"]]);
  });

  it("refuses a malformed repo: 400 invalid_input; the function answers none", async () => {
    for (const repo of ["", "o", "o/r/x", "../r", "o/..", "o r/x", "https://github.com/o/r"]) {
      const res = await call("GET", "/workspaces", { query: { repo } });
      expect(res.status, repo).toBe(400);
      expect(res.body).toMatchObject({ error: "invalid_input" });
      expect(lookupSavedWorkspaces(store, repo)).toEqual([]);
    }
  });
});

// ---- AC3: remove ----------------------------------------------------------------------------

describe("POST /workspaces/:id/remove (AC3)", () => {
  it("deletes that row only; a crew member's settings file listing the same folder is byte-for-byte unchanged", async () => {
    const dir = checkout(join(tmp, "code", "r"), ["https://github.com/o/r.git"]);
    const row = saved(await add(dir, T1)).workspace;
    const other = saved(await add(checkout(join(tmp, "code", "s"), ["https://github.com/o/s.git"]), T2)).workspace;
    const settings = join(dataDir, "config", "agents", "mason.json");
    mkdirSync(join(settings, ".."), { recursive: true });
    writeFileSync(settings, `${JSON.stringify({ model: "claude-haiku-4-5", workspaces: [dir, row.path] }, null, 2)}\n`);
    const before = sha256(settings);

    const res = await remove(String(row.id));
    expect(res).toEqual({ status: 200, body: { removed: row.id } });
    expect(await list()).toEqual([other]);
    expect(sha256(settings)).toBe(before);
    // Gone: a second remove is 404.
    expect((await remove(String(row.id))).status).toBe(404);
  });

  it("answers 404 not_found for an id that is not a positive integer or names no row, and removes nothing", async () => {
    saved(await add(checkout(join(tmp, "r"), ["https://github.com/o/r.git"])));
    for (const id of ["0", "-1", "abc", "1.5", "01", "", "99", "99999999999999999"]) {
      const res = await remove(id);
      expect(res.status, id).toBe(404);
      expect(res.body).toMatchObject({ error: "not_found" });
    }
    expect(rowCount()).toBe(1);
  });
});

// ---- AC4: missing and unreadable ---------------------------------------------------------

describe("a saved folder that moved, was deleted or can't be read (AC4)", () => {
  it("a renamed folder is missing, never ready, and still found by its saved repo", async () => {
    const dir = checkout(join(tmp, "r"), ["https://github.com/o/r.git"]);
    const row = saved(await add(dir)).workspace;
    renameSync(dir, join(tmp, "renamed"));
    expect(await list("o/r")).toEqual([{ ...row, state: "missing" }]);
    expect(await list()).toEqual([{ ...row, state: "missing" }]);
  });

  it("a deleted folder, or one whose .git is gone, is missing", async () => {
    const gone = checkout(join(tmp, "gone"), ["https://github.com/o/r.git"]);
    const noGit = checkout(join(tmp, "nogit"), ["https://github.com/o/r.git"]);
    const a = saved(await add(gone, T1)).workspace;
    const b = saved(await add(noGit, T2)).workspace;
    rmSync(gone, { recursive: true });
    rmSync(join(noGit, ".git"), { recursive: true });
    expect((await list("o/r")).map((w) => [w.id, w.state])).toEqual([
      [b.id, "missing"],
      [a.id, "missing"],
    ]);
  });

  it.skipIf(process.getuid?.() === 0)("a folder whose .git can't be read (EACCES) is unreadable, never ready; and adding one is refused 400 unreadable", async () => {
    const dir = checkout(join(tmp, "r"), ["https://github.com/o/r.git"]);
    const row = saved(await add(dir)).workspace;
    const dotGit = join(dir, ".git");
    chmodSync(dotGit, 0o000);
    unlock.push(dotGit);
    expect(await list("o/r")).toEqual([{ ...row, state: "unreadable" }]);
    expect(await list()).toEqual([{ ...row, state: "unreadable" }]);

    const locked = checkout(join(tmp, "locked"), ["https://github.com/o/r.git"]);
    chmodSync(join(locked, ".git"), 0o000);
    unlock.push(join(locked, ".git"));
    const res = await add(locked);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "unreadable" });
    expect(rowCount()).toBe(1);
  });
});

// ---- AC5: no GitHub remote ------------------------------------------------------------------

describe("a checkout with no GitHub remote (AC5)", () => {
  it.each([
    ["no remote", [] as string[]],
    ["only a GitLab remote", ["https://gitlab.com/o/r.git"]],
  ])("%s: saved with repo null and a note that it won't be matched to a repo; no lookup returns it", async (_, remotes) => {
    const dir = checkout(join(tmp, "r"), remotes);
    const answer = saved(await add(dir));
    expect(answer.workspace).toMatchObject({ repo: null, state: "ready" });
    expect(answer.note).toMatch(/has no GitHub remote, so it won't be matched to a repo/);
    expect(answer.note).toContain(answer.workspace.path);
    expect(await list("o/r")).toEqual([]);
    expect(await list()).toEqual([answer.workspace]);
  });

  it("a moved folder saved with no repo is never found by a lookup", async () => {
    const dir = checkout(join(tmp, "r"), []);
    saved(await add(dir));
    rmSync(dir, { recursive: true });
    expect(await list("o/r")).toEqual([]);
  });
});

// ---- AC6: protected folders and non-checkouts ------------------------------------------------

describe("refusals before anything is written (AC6)", () => {
  it.each(PROTECTED_LOCATIONS.map((l) => [l]))("a checkout inside ~/%s answers 400 protected_folder with D31's sentence", async (location) => {
    const dir = checkout(join(home, location, "repo"), ["https://github.com/o/r.git"]);
    const res = await add(dir);
    expect(res).toEqual({ status: 400, body: { error: "protected_folder", message: protectedFolderRefusal(dir) } });
    const message = (res.body as { message: string }).message;
    expect(message).toContain(dir);
    expect(message).toContain(protectedLocationsText());
    expect(message).toContain(PROTECTED_FOLDER_WHY);
    expect(tableRows()).toEqual([]);
  });

  it("a symlink into a protected folder answers 400 protected_folder too, naming the path given", async () => {
    const dir = checkout(join(home, "Documents", "repo"), ["https://github.com/o/r.git"]);
    const link = join(tmp, "elsewhere");
    symlinkSync(dir, link);
    expect(await add(link)).toEqual({ status: 400, body: { error: "protected_folder", message: protectedFolderRefusal(link) } });
    expect(tableRows()).toEqual([]);
  });

  it("a folder that is not a git checkout, or is not there, answers 400 not_checkout and saves nothing", async () => {
    const plain = join(tmp, "plain");
    mkdirSync(plain);
    for (const path of [plain, join(tmp, "absent")]) {
      const res = await add(path);
      expect(res.status, path).toBe(400);
      expect(res.body).toMatchObject({ error: "not_checkout" });
      expect((res.body as { message: string }).message).toContain(path);
    }
    // A saved row is not touched by a refused add.
    const row = saved(await add(checkout(join(tmp, "r"), ["https://github.com/o/r.git"]), T1)).workspace;
    expect((await add(plain, T4)).status).toBe(400);
    expect(await list()).toEqual([row]);
  });
});

// ---- AC7: owner-only ----------------------------------------------------------------------

describe("only the owner writes the list (AC7)", () => {
  const merge = (): MergedContributions => mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED);

  it("(a) no shipped kernel tool's name contains workspace, and the part contributes no tool", () => {
    const names = [...PHASE1_TOOL_NAMES, ...merge().tools.map((t) => t.name)];
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => n.toLowerCase().includes("workspace"))).toEqual([]);
    expect(workspacesPart.tools).toEqual([]);
  });

  it("(b) no studio subcommand is a workspaces verb, and the part contributes none", () => {
    const names = [...PHASE1_SUBCOMMANDS, ...merge().subcommands.map((s) => s.name)];
    expect(names.filter((n) => n.toLowerCase().startsWith("workspace"))).toEqual([]);
    expect(workspacesPart.subcommands).toBeUndefined();
  });

  it("(c) the three routes are console routes that need the bearer token: an unauthenticated POST /workspaces answers 401 and writes nothing", async () => {
    // Its own step: a merge refusal (an unauthenticated non-GET) must not read as the 401 check.
    let merged: MergedContributions | undefined;
    expect(() => {
      merged = merge();
    }).not.toThrow();
    const ours = (merged as MergedContributions).routes.filter((r) => r.path.startsWith("/workspaces"));
    expect(ours.map((r) => [r.owner, r.method, r.path, r.unauthenticated])).toEqual([
      ["console", "GET", "/workspaces", undefined],
      ["console", "POST", "/workspaces", undefined],
      ["console", "POST", "/workspaces/:id/remove", undefined],
    ]);
    const server = await startApiServer(
      {
        store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => undefined, stop: async () => undefined },
        authProviders: [stubProvider()],
        token: TOKEN,
        port: 0,
        routes: (merged as MergedContributions).routes,
      },
      { now: () => T1 },
    );
    servers.push(server);
    const dir = checkout(join(tmp, "r"), ["https://github.com/o/r.git"]);
    const body = JSON.stringify({ path: dir });
    const post = (path: string, auth: boolean): Promise<{ status: number; text: string }> =>
      new Promise((resolve, reject) => {
        const headers: Record<string, string> = { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) };
        if (auth) headers["Authorization"] = `Bearer ${TOKEN}`;
        const req = request({ host: "127.0.0.1", port: server.port, method: "POST", path, headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        });
        req.on("error", reject);
        req.end(body);
      });
    expect((await post("/workspaces", false)).status).toBe(401);
    expect(rowCount()).toBe(0);
    // With the token the same request reaches the route and saves the folder.
    const ok = await post("/workspaces", true);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toMatchObject({ workspace: { repo: "o/r", state: "ready" }, note: null });
    expect(rowCount()).toBe(1);
    expect((await post("/workspaces/1/remove", false)).status).toBe(401);
    expect(rowCount()).toBe(1);
    // Not a phase 1 route: only the console contributes it.
    expect(PHASE1_ROUTES.filter((r) => r.path.startsWith("/workspaces"))).toEqual([]);
  });

  it("(d) the session policy denies a session's write to <dataDir>/studio.db", () => {
    expect(PROTECTED_DATA_FILES).toContain(DB_FILENAME);
    const rail = { dataDir, homeDir: home, cwd: join(tmp, "r") };
    expect(classifyToolCall("Write", { file_path: join(dataDir, DB_FILENAME), content: "" }, rail)).toEqual({ kind: "deny", reason: "protected_kernel_path" });
    expect(classifyToolCall("Bash", { command: `sqlite3 '${join(dataDir, DB_FILENAME)}' "DELETE FROM saved_workspaces"` }, rail)).toMatchObject({ kind: "deny" });
  });
});
