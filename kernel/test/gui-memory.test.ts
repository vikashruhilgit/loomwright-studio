// Phase 7 item 06: the `gui` feature's `memory` part. `GET /memory`,
// `GET /memory/file` and `PUT /memory/file` against a real store and a real
// data dir, through a real API server (so the query string, the JSON body and
// the 1 MiB body cap are as in the daemon). Never the SDK or a model.
//
// Every refusal is asserted twice: the answer (status and code), and that
// nothing changed: every file under the fixture is byte-identical (a symlink
// is the same link) and no `memory_updated` event was recorded.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import { GUI_PARTS, memoryPart, memoryRoutes } from "../src/gui/index.js";
import { MEMORY_UPDATED, memoryPart as memoryPartDirect } from "../src/gui/memory.js";
import { MAX_MEMORY_FILE_BYTES, MAX_MEMORY_PATH_LENGTH, MEMORY_WRITE_REFUSALS, resolveMemoryPath } from "../src/gui/memory-paths.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = "2026-10-30T10:00:00.000Z";
const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);

let env: LoopEnv;
let server: ApiServer;
/** A folder outside the data dir, for a link that leaves it. */
let outside: string;

const memory = (...parts: string[]): string => join(env.dataDir, "memory", ...parts);
const sha = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** The fixture of AC1, plus the targets a link can point at. */
function seed(): void {
  for (const agent of ["wright", "mason"]) {
    for (const file of ["role", "preferences", "people", "lessons"]) put(memory(agent, `${file}.md`), `# ${agent} ${file}\n`);
  }
  put(memory("mason", "handoffs", "h.md"), "handoff\n");
  put(memory("mason", "notes.txt"), "not markdown\n");
  put(memory("shared", "README.md"), "# shared\n");
  put(memory("shared", "about-me.md"), "about me\n");
  put(memory("_unassigned", "handoffs", "x.md"), "unassigned\n");
  put(memory("playbooks", "p.md"), "playbook mirror\n");
  put(join(env.dataDir, "config", "agents", "wright.json"), '{"model":"x"}\n');
  put(join(env.dataDir, "app", "bundle.js"), "app\n");
  put(join(env.dataDir, "other.md"), "other\n");
  put(join(outside, "x.md"), "outside\n");
}

function link(name: string, target: string): void {
  symlinkSync(target, memory("mason", name));
}

/** Every file and link under the roots the guard protects or could reach: path -> content (or `-> target` for a link). `studio.db` is left out: the store writes it on its own. */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (path: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) out[path] = `-> ${readlinkSync(path)}`;
    else if (stat.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name));
    else out[path] = readFileSync(path, "utf8");
  };
  walk(memory());
  walk(join(env.dataDir, "config"));
  walk(join(env.dataDir, "app"));
  walk(join(env.dataDir, "other.md"));
  walk(outside);
  return out;
}

const updates = (): { payload_json: string; task_id: number | null; session_id: number | null; actor: string; at: string }[] =>
  env.store.prepare("SELECT at, actor, task_id, session_id, payload_json FROM events WHERE kind = 'memory_updated' ORDER BY id").all() as never;

beforeEach(async () => {
  env = loopEnv(NOW);
  outside = join(dirname(env.dataDir), "outside");
  mkdirSync(outside, { recursive: true });
  server = await startApiServer(
    {
      store: env.store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
      loop: { start: () => {}, stop: async () => {} },
      authProviders: [stubProvider()],
      token: TOKEN,
      routes: mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes,
    },
    { now: () => env.now() },
  );
});

afterEach(async () => {
  await server.close();
  env.cleanup();
  rmSync(outside, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

const getTree = () => call("GET", "/memory");
const getFile = (path: string) => call("GET", `/memory/file?path=${encodeURIComponent(path)}`);
const putFile = (body: unknown) => call("PUT", "/memory/file", body);

describe("the memory part (phase 7 item 06)", () => {
  it("is the fourth gui part and holds exactly GET /memory, GET /memory/file and PUT /memory/file, none unauthenticated", () => {
    expect(GUI_PARTS[3]).toBe(memoryPart);
    expect(memoryPartDirect).toBe(memoryPart);
    expect(memoryPart.name).toBe("memory");
    expect(memoryPart.routes).toBe(memoryRoutes);
    expect(Object.isFrozen(memoryRoutes)).toBe(true);
    expect(memoryRoutes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /memory", "GET /memory/file", "PUT /memory/file"]);
    expect(memoryRoutes.filter((r) => r.unauthenticated === true)).toEqual([]);
  });

  it("names its event kind and bounds", () => {
    expect(MEMORY_UPDATED).toBe("memory_updated");
    expect(MAX_MEMORY_FILE_BYTES).toBe(256 * 1024);
    expect(MAX_MEMORY_PATH_LENGTH).toBe(512);
  });

  it("needs the API token on every route", async () => {
    for (const [method, path] of [["GET", "/memory"], ["GET", "/memory/file?path=wright/role.md"], ["PUT", "/memory/file"]] as const) {
      const res = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, ...(method === "PUT" ? { body: "{}", headers: { "Content-Type": "application/json" } } : {}) });
      expect(res.status).toBe(401);
    }
  });

  it("answers the refusal codes the app contract's MemoryWriteRefusal union lists, in its order", () => {
    const text = readFileSync(CONTRACT, "utf8");
    const start = text.indexOf("export type MemoryWriteRefusal =");
    expect(start).toBeGreaterThan(-1);
    const union = text.slice(start, text.indexOf(";", start));
    const codes = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(codes).toEqual([...MEMORY_WRITE_REFUSALS]);
  });
});

describe("GET /memory", () => {
  it("answers an empty tree when there is no memory folder", async () => {
    expect(existsSync(memory())).toBe(false);
    expect(await getTree()).toEqual({ status: 200, body: { agents: [], shared: [] } });
  });

  it("lists agents (wright first, then by id) with their regular .md files, then the shared files", async () => {
    seed();
    link("link.md", join(env.dataDir, "memory", "wright", "role.md"));
    put(memory("mason", "zeta.md"), "z");
    put(memory("mason", "alpha.md"), "alpha");
    put(memory("aardvark", "role.md"), "a");
    mkdirSync(memory("empty-agent"));
    mkdirSync(memory("Bad Id"));
    put(memory("Bad Id", "x.md"), "no");
    put(memory("loose.md"), "a file directly under memory/ is no agent");
    const when = new Date("2026-10-29T08:30:00.000Z");
    utimesSync(memory("wright", "lessons.md"), when, when);
    put(memory("wright", "lessons.md"), "# wright lessons\nmore\n");
    utimesSync(memory("wright", "lessons.md"), when, when);

    const { status, body } = await getTree();
    expect(status).toBe(200);
    expect(body.agents.map((a: { agent: string }) => a.agent)).toEqual(["wright", "aardvark", "empty-agent", "mason"]);
    const names = (agent: string): string[] => body.agents.find((a: { agent: string }) => a.agent === agent).files.map((f: { path: string }) => f.path);
    // role, preferences, people, lessons first in that order, then any other file by name; no subfolder, no link, no .txt
    expect(names("wright")).toEqual(["wright/role.md", "wright/preferences.md", "wright/people.md", "wright/lessons.md"]);
    expect(names("mason")).toEqual(["mason/role.md", "mason/preferences.md", "mason/people.md", "mason/lessons.md", "mason/alpha.md", "mason/zeta.md"]);
    expect(names("empty-agent")).toEqual([]);
    // shared, _unassigned and playbooks are never agents
    expect(body.agents.map((a: { agent: string }) => a.agent)).not.toContain("shared");
    expect(body.agents.map((a: { agent: string }) => a.agent)).not.toContain("_unassigned");
    expect(body.agents.map((a: { agent: string }) => a.agent)).not.toContain("playbooks");
    expect(body.shared.map((f: { path: string }) => f.path)).toEqual(["shared/README.md", "shared/about-me.md"]);
    const lessons = body.agents[0].files[3];
    expect(lessons).toEqual({ path: "wright/lessons.md", size: Buffer.byteLength("# wright lessons\nmore\n"), modified: "2026-10-29T08:30:00.000Z" });
  });

  it("lists no agent whose folder is a link", async () => {
    seed();
    symlinkSync(memory("mason"), memory("jade"));
    const { body } = await getTree();
    expect(body.agents.map((a: { agent: string }) => a.agent)).toEqual(["wright", "mason"]);
  });

  it("lists through a memory folder that is itself a link", async () => {
    seed();
    renameSync(memory(), join(env.dataDir, "memory-real"));
    symlinkSync(join(env.dataDir, "memory-real"), memory());
    const { body } = await getTree();
    expect(body.agents.map((a: { agent: string }) => a.agent)).toEqual(["wright", "mason"]);
    expect(body.shared).toHaveLength(2);
  });
});

describe("GET /memory/file", () => {
  it("answers the text and the SHA-256 hex digest of the bytes on disk", async () => {
    seed();
    const text = "# wright role\nÉtude — \u{1F40B}\n";
    writeFileSync(memory("wright", "role.md"), text);
    const { status, body } = await getFile("wright/role.md");
    expect(status).toBe(200);
    expect(body).toEqual({ path: "wright/role.md", content: text, content_hash: sha(Buffer.from(text, "utf8")) });
    expect(body.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers 404 not_found for an absent file and a missing path query is invalid_path", async () => {
    seed();
    expect(await getFile("wright/absent.md")).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await call("GET", "/memory/file")).toEqual({ status: 400, body: { error: "invalid_path" } });
  });

  it("answers 400 too_large above the cap and serves a file exactly at it", async () => {
    seed();
    writeFileSync(memory("wright", "big.md"), "x".repeat(MAX_MEMORY_FILE_BYTES + 1));
    expect(await getFile("wright/big.md")).toEqual({ status: 400, body: { error: "too_large" } });
    writeFileSync(memory("wright", "edge.md"), "x".repeat(MAX_MEMORY_FILE_BYTES));
    expect((await getFile("wright/edge.md")).status).toBe(200);
  });

  it("answers a file through a link that stays inside memory/", async () => {
    seed();
    link("ok.md", memory("wright", "role.md"));
    const { status, body } = await getFile("mason/ok.md");
    expect(status).toBe(200);
    expect(body.path).toBe("mason/ok.md");
    expect(body.content).toBe("# wright role\n");
  });

  it("serves a file when the memory folder is itself a link", async () => {
    seed();
    renameSync(memory(), join(env.dataDir, "memory-real"));
    symlinkSync(join(env.dataDir, "memory-real"), memory());
    expect((await getFile("wright/role.md")).body.content).toBe("# wright role\n");
  });
});

/** Every path the guard refuses, with the status and code, for the same answer from both routes. */
const REFUSALS: readonly { readonly name: string; readonly path: string; readonly status: 400 | 404; readonly error: string }[] = [
  { name: "an absolute path", path: "/etc/x.md", status: 400, error: "path_outside_memory" },
  { name: "a .. segment", path: "../config/x.md", status: 400, error: "invalid_path" },
  { name: "a .. segment inside", path: "wright/../../x.md", status: 400, error: "invalid_path" },
  { name: "a . segment", path: "wright/./role.md", status: 400, error: "invalid_path" },
  // Two segments, so only the segment rule (not the depth rule) tells these from `not_markdown`.
  { name: "a trailing .. segment", path: "wright/..", status: 400, error: "invalid_path" },
  { name: "a trailing . segment", path: "wright/.", status: 400, error: "invalid_path" },
  { name: "an empty segment", path: "wright//role.md", status: 400, error: "invalid_path" },
  { name: "a trailing slash", path: "wright/role.md/", status: 400, error: "invalid_path" },
  { name: "an empty path", path: "", status: 400, error: "invalid_path" },
  { name: "a backslash", path: "wright\\role.md", status: 400, error: "invalid_path" },
  { name: "a NUL", path: "wright/role.md\0.txt", status: 400, error: "invalid_path" },
  { name: "a path over 512 characters", path: `wright/${"a".repeat(MAX_MEMORY_PATH_LENGTH)}.md`, status: 400, error: "invalid_path" },
  { name: "a path that is only a folder", path: "wright", status: 400, error: "invalid_path" },
  { name: "a path deeper than <folder>/<file>", path: "mason/handoffs/h.md", status: 400, error: "invalid_path" },
  { name: "a file name that is not markdown", path: "mason/notes.txt", status: 400, error: "not_markdown" },
  { name: "a file name with no extension", path: "wright/role", status: 400, error: "not_markdown" },
  { name: "the playbook mirrors' folder", path: "playbooks/p.md", status: 400, error: "path_protected" },
  { name: "the handoff folder of a session with no agent", path: "_unassigned/handoffs/x.md", status: 400, error: "path_protected" },
  { name: "a first segment that is no valid agent id", path: "Bad Id/x.md", status: 400, error: "invalid_path" },
  { name: "a first segment that starts with a digit", path: "9lives/x.md", status: 400, error: "invalid_path" },
  { name: "a valid agent id with no folder", path: "nobody/x.md", status: 404, error: "not_found" },
  { name: "a folder of the data dir that is not memory", path: "config/agents.md", status: 404, error: "not_found" },
  { name: "an absent file", path: "wright/absent.md", status: 404, error: "not_found" },
];

/** A link inside `memory/mason/` and the refusal its target earns. The target is built per test (a function of the data dir). */
const LINK_REFUSALS: readonly { readonly name: string; readonly target: () => string; readonly status: 400 | 404; readonly error: string }[] = [
  { name: "a link into config/", target: () => join(env.dataDir, "config", "agents", "wright.json"), status: 400, error: "path_protected" },
  { name: "a link into app/", target: () => join(env.dataDir, "app", "bundle.js"), status: 400, error: "path_protected" },
  { name: "a link to a protected data file (studio.db)", target: () => join(env.dataDir, "studio.db"), status: 400, error: "path_protected" },
  { name: "a link to a file elsewhere in the data dir", target: () => join(env.dataDir, "other.md"), status: 400, error: "path_outside_memory" },
  { name: "a link out of the data dir", target: () => join(outside, "x.md"), status: 400, error: "path_outside_memory" },
  { name: "a link to the playbook mirrors", target: () => memory("playbooks", "p.md"), status: 400, error: "path_protected" },
  { name: "a link to the unassigned handoffs", target: () => memory("_unassigned", "handoffs", "x.md"), status: 400, error: "path_protected" },
  { name: "a link to a non-markdown file inside memory/", target: () => memory("mason", "notes.txt"), status: 400, error: "not_markdown" },
  { name: "a link to a file deeper than <folder>/<file>", target: () => memory("mason", "handoffs", "h.md"), status: 400, error: "invalid_path" },
  { name: "a dangling link", target: () => memory("mason", "gone.md"), status: 404, error: "not_found" },
  { name: "a link to a folder", target: () => memory("shared"), status: 400, error: "invalid_path" },
];

describe("the path guard", () => {
  it.each(REFUSALS)("refuses $name ($path) on both routes and writes nothing", async ({ path, status, error }) => {
    seed();
    const before = snapshot();
    const read = await getFile(path);
    expect(read).toEqual({ status, body: { error } });
    const write = await putFile({ path, content: "changed", base_hash: "x" });
    expect(write).toEqual({ status, body: { error } });
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
  });

  it.each(LINK_REFUSALS)("refuses $name on both routes and writes nothing", async ({ target, status, error }) => {
    seed();
    link("link.md", target());
    const before = snapshot();
    const read = await getFile("mason/link.md");
    expect(read).toEqual({ status, body: { error } });
    const write = await putFile({ path: "mason/link.md", content: "changed", base_hash: "x" });
    expect(write).toEqual({ status, body: { error } });
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
  });

  it("refuses a link whose real path is protected before it asks whether it left memory/ (the exact code is path_protected)", () => {
    seed();
    link("cfg.md", join(env.dataDir, "config", "agents", "wright.json"));
    expect(resolveMemoryPath(env.dataDir, "mason/cfg.md")).toEqual({ ok: false, status: 400, error: "path_protected" });
  });

  it("refuses a link that goes through a folder link out of memory/", async () => {
    seed();
    symlinkSync(outside, memory("mason", "outdir"));
    expect(await getFile("mason/outdir")).toEqual({ status: 400, body: { error: "not_markdown" } });
    // A folder link as the first segment: its real path leaves memory/.
    symlinkSync(outside, memory("jade"));
    const before = snapshot();
    expect(await putFile({ path: "jade/x.md", content: "changed", base_hash: sha("outside\n") })).toEqual({ status: 400, body: { error: "path_outside_memory" } });
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
  });

  it("treats the real memory folder as the boundary when memory/ is itself a link", async () => {
    seed();
    renameSync(memory(), join(env.dataDir, "memory-real"));
    symlinkSync(join(env.dataDir, "memory-real"), memory());
    symlinkSync(join(env.dataDir, "other.md"), join(env.dataDir, "memory-real", "mason", "link.md"));
    const before = snapshot();
    expect(await getFile("mason/link.md")).toEqual({ status: 400, body: { error: "path_outside_memory" } });
    expect(await putFile({ path: "mason/link.md", content: "changed", base_hash: "x" })).toEqual({ status: 400, body: { error: "path_outside_memory" } });
    expect(snapshot()).toEqual(before);
    // and a link to a sibling inside the real folder is fine
    const ok = await putFile({ path: "wright/role.md", content: "edited\n", base_hash: sha("# wright role\n") });
    expect(ok.status).toBe(200);
    expect(readFileSync(join(env.dataDir, "memory-real", "wright", "role.md"), "utf8")).toBe("edited\n");
  });

  it("refuses a directory named like a markdown file as not_found", async () => {
    seed();
    mkdirSync(memory("wright", "dir.md"));
    expect(await getFile("wright/dir.md")).toEqual({ status: 404, body: { error: "not_found" } });
    expect(await putFile({ path: "wright/dir.md", content: "x", base_hash: "x" })).toEqual({ status: 404, body: { error: "not_found" } });
  });
});

describe("PUT /memory/file", () => {
  it("writes the text, answers 200 with the new hash, size and mtime, and records one memory_updated event", async () => {
    seed();
    const opened = await getFile("mason/lessons.md");
    const content = "# mason lessons\n- check the diff twice — É\n";
    const { status, body } = await putFile({ path: "mason/lessons.md", content, base_hash: opened.body.content_hash });
    expect(status).toBe(200);
    expect(readFileSync(memory("mason", "lessons.md"), "utf8")).toBe(content);
    expect(body).toEqual({
      path: "mason/lessons.md",
      content_hash: sha(Buffer.from(content, "utf8")),
      size: Buffer.byteLength(content, "utf8"),
      modified: statSync(memory("mason", "lessons.md")).mtime.toISOString(),
    });
    // the new hash is the next write's base
    expect((await getFile("mason/lessons.md")).body.content_hash).toBe(body.content_hash);
    const events = updates();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ at: NOW, actor: "kernel", task_id: null, session_id: null });
    expect(JSON.parse(events[0]!.payload_json)).toEqual({ path: "mason/lessons.md", by: "owner", size: Buffer.byteLength(content, "utf8"), content_hash: body.content_hash });
  });

  it("writes atomically: a new file is renamed over the old one and no temp file is left behind", async () => {
    seed();
    const before = statSync(memory("wright", "role.md")).ino;
    const { status } = await putFile({ path: "wright/role.md", content: "new text\n", base_hash: sha("# wright role\n") });
    expect(status).toBe(200);
    expect(statSync(memory("wright", "role.md")).ino).not.toBe(before);
    expect(readdirSync(memory("wright")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a stale base_hash with 409, the disk text and its hash, and writes nothing", async () => {
    seed();
    const opened = await getFile("wright/lessons.md");
    // an agent writes after the owner opened it
    writeFileSync(memory("wright", "lessons.md"), "# agent wrote this\n");
    const before = snapshot();
    const { status, body } = await putFile({ path: "wright/lessons.md", content: "owner edit\n", base_hash: opened.body.content_hash });
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: "changed_since_read", current_content: "# agent wrote this\n", current_hash: sha("# agent wrote this\n") });
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
    // retrying with the current hash succeeds
    const retry = await putFile({ path: "wright/lessons.md", content: "owner edit\n", base_hash: body.current_hash });
    expect(retry.status).toBe(200);
    expect(updates()).toHaveLength(1);
  });

  it("refuses an empty base_hash as changed_since_read (never a blind overwrite)", async () => {
    seed();
    const before = snapshot();
    const { status, body } = await putFile({ path: "wright/role.md", content: "blind\n", base_hash: "" });
    expect(status).toBe(409);
    expect(body.error).toBe("changed_since_read");
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
  });

  it("writes a file reached through a link at its real target and keeps the link", async () => {
    seed();
    link("ok.md", memory("wright", "role.md"));
    const { status, body } = await putFile({ path: "mason/ok.md", content: "via link\n", base_hash: sha("# wright role\n") });
    expect(status).toBe(200);
    expect(body.path).toBe("mason/ok.md");
    expect(lstatSync(memory("mason", "ok.md")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(memory("mason", "ok.md"))).toBe(memory("wright", "role.md"));
    expect(readFileSync(memory("wright", "role.md"), "utf8")).toBe("via link\n");
    expect(JSON.parse(updates()[0]!.payload_json).path).toBe("mason/ok.md");
  });

  it("accepts the empty text and a text exactly at the cap in UTF-8 bytes, and refuses one byte over", async () => {
    seed();
    let hash = sha("# wright role\n");
    const empty = await putFile({ path: "wright/role.md", content: "", base_hash: hash });
    expect(empty.status).toBe(200);
    hash = empty.body.content_hash;
    const edge = "é".repeat(MAX_MEMORY_FILE_BYTES / 2); // 2 bytes each
    const atCap = await putFile({ path: "wright/role.md", content: edge, base_hash: hash });
    expect(atCap.status).toBe(200);
    expect(statSync(memory("wright", "role.md")).size).toBe(MAX_MEMORY_FILE_BYTES);
    const before = snapshot();
    const over = await putFile({ path: "wright/role.md", content: `${edge}a`, base_hash: atCap.body.content_hash });
    expect(over).toEqual({ status: 400, body: { error: "too_large" } });
    // fewer characters than the cap, more bytes than it
    const wide = await putFile({ path: "wright/role.md", content: "é".repeat(MAX_MEMORY_FILE_BYTES / 2 + 1), base_hash: atCap.body.content_hash });
    expect(wide).toEqual({ status: 400, body: { error: "too_large" } });
    expect(snapshot()).toEqual(before);
    expect(updates()).toHaveLength(2);
  });

  it("refuses content between 256 KiB and 1 MiB as too_large, and above 1 MiB the API server answers 413 before the handler", async () => {
    seed();
    const before = snapshot();
    const mid = await putFile({ path: "wright/role.md", content: "x".repeat(600 * 1024), base_hash: sha("# wright role\n") });
    expect(mid).toEqual({ status: 400, body: { error: "too_large" } });
    const huge = await putFile({ path: "wright/role.md", content: "x".repeat(1024 * 1024 + 1), base_hash: sha("# wright role\n") });
    expect(huge).toEqual({ status: 413, body: { error: "body_too_large" } });
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
  });

  it("refuses a file already over the cap on disk as too_large and leaves it", async () => {
    seed();
    writeFileSync(memory("wright", "big.md"), "x".repeat(MAX_MEMORY_FILE_BYTES + 1));
    const before = snapshot();
    expect(await putFile({ path: "wright/big.md", content: "small", base_hash: "x" })).toEqual({ status: 400, body: { error: "too_large" } });
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
  });

  it.each([
    ["no body", undefined],
    ["a JSON null", "null"],
    ["a JSON array", "[]"],
    ["a JSON string", '"wright/role.md"'],
    ["an empty object", {}],
    ["a numeric path", { path: 1, content: "x", base_hash: "x" }],
    ["no content", { path: "wright/role.md", base_hash: "x" }],
    ["a null content", { path: "wright/role.md", content: null, base_hash: "x" }],
    ["no base_hash", { path: "wright/role.md", content: "x" }],
    ["a numeric base_hash", { path: "wright/role.md", content: "x", base_hash: 7 }],
  ])("refuses %s as invalid_body and writes nothing", async (_name, body) => {
    seed();
    const before = snapshot();
    expect(await putFile(body)).toEqual({ status: 400, body: { error: "invalid_body" } });
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
  });

  it("refuses a body that is not JSON (answered by the API server) and writes nothing", async () => {
    seed();
    const before = snapshot();
    expect((await putFile("{not json")).status).toBe(400);
    expect(snapshot()).toEqual(before);
    expect(updates()).toEqual([]);
  });

  it("leaves a file's text as data: a path or content with markup is stored and returned verbatim", async () => {
    seed();
    const content = "<script>alert(1)</script>\n‮ bidi \u0000 nul\n";
    const wrote = await putFile({ path: "shared/about-me.md", content, base_hash: sha("about me\n") });
    expect(wrote.status).toBe(200);
    expect((await getFile("shared/about-me.md")).body.content).toBe(content);
  });
});
