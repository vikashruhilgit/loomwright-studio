// Phase 7 item 04: the `gui` feature's `playbook-history` part, `GET /playbooks/:id/runs`
// and `GET /playbooks/:id/versions`. Rows are seeded straight into a temp store, as the
// playbooks tests do; handlers are called directly and through the merged API server
// (token required: 401 without it). No SDK, no model.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { PHASE1_RESERVED, mergeContributions } from "../src/features/index.js";
import type { ContributedRouteRequest, ContributedRouteResponse } from "../src/features/index.js";
import { guiContribution } from "../src/gui/index.js";
import { playbookHistoryRoutes } from "../src/gui/playbook-history.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const NOW = "2026-10-30T10:00:00.000Z";
const TOKEN = "0123456789abcdef".repeat(4);

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv(NOW);
});

afterEach(() => {
  env.cleanup();
});

function seedPlaybook(id: number): void {
  env.store
    .prepare("INSERT INTO playbooks (id, slug, name, owning_agent, intent) VALUES (?, ?, ?, 'wright', 'Summarise the repo.')")
    .run(id, `pb-${id}`, `Playbook ${id}`);
}

function seedSession(id: number): void {
  env.store
    .prepare("INSERT INTO sessions (id, agent, status, model, pgid, started_at) VALUES (?, 'wright', 'completed', 'claude-haiku-4-5', ?, ?)")
    .run(id, 2_000_000_000 + id, NOW);
}

interface RunSeed {
  readonly playbook: number;
  readonly version?: number;
  readonly kind?: string;
  readonly status?: string;
  readonly session?: number | null;
  readonly tokens?: number | null;
  readonly itemRef?: string | null;
  readonly itemRevision?: string | null;
  readonly startedAt?: string;
  readonly endedAt?: string | null;
}

/** Insert one run and return its id. `dedupe_key` and `result_json` are set so a test can see they are not exposed. */
function seedRun(r: RunSeed): number {
  const info = env.store
    .prepare(
      "INSERT INTO playbook_runs (playbook, version, kind, status, session_id, dedupe_key, result_json, tokens, started_at, ended_at, item_ref, item_revision) VALUES (?, ?, ?, ?, ?, 'secret-dedupe', '{\"secret\":true}', ?, ?, ?, ?, ?)",
    )
    .run(
      r.playbook,
      r.version ?? 1,
      r.kind ?? "fire",
      r.status ?? "done",
      r.session ?? null,
      r.tokens ?? null,
      r.startedAt ?? NOW,
      r.endedAt ?? null,
      r.itemRef ?? null,
      r.itemRevision ?? null,
    );
  return Number(info.lastInsertRowid);
}

function seedVersion(playbook: number, version: number, snapshotJson: string): void {
  env.store
    .prepare("INSERT INTO playbook_versions (playbook, version, snapshot_json, created_at) VALUES (?, ?, ?, ?)")
    .run(playbook, version, snapshotJson, `2026-10-30T10:0${version}:00.000Z`);
}

function route(path: string) {
  const r = playbookHistoryRoutes.find((x) => x.path === path);
  if (r === undefined) throw new Error(`no route ${path}`);
  return r;
}

function call(path: string, params: Record<string, string>, query: Record<string, string> = {}): Promise<ContributedRouteResponse> {
  const req: ContributedRouteRequest = { params, query, body: undefined, store: env.store, now: env.now };
  return route(path).handler(req);
}

const runs = (id: string, query?: Record<string, string>) => call("/playbooks/:id/runs", { id }, query);
const versions = (id: string) => call("/playbooks/:id/versions", { id });

interface RunsBody {
  runs: { id: number; [k: string]: unknown }[];
  next_before: string | null;
}

describe("GET /playbooks/:id/runs", () => {
  it("answers each run as exactly the contract's PlaybookRun, mapped from session_id, started_at and ended_at", async () => {
    seedPlaybook(1);
    seedSession(7);
    const id = seedRun({
      playbook: 1,
      version: 3,
      kind: "run_now",
      status: "done",
      session: 7,
      tokens: 1234,
      itemRef: "owner/repo#12",
      itemRevision: "abc123",
      startedAt: "2026-10-30T09:00:00.000Z",
      endedAt: "2026-10-30T09:05:00.000Z",
    });
    const res = await runs("1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      runs: [
        {
          id,
          playbook: 1,
          version: 3,
          kind: "run_now",
          status: "done",
          item_ref: "owner/repo#12",
          item_revision: "abc123",
          tokens: 1234,
          session: 7,
          started: "2026-10-30T09:00:00.000Z",
          ended: "2026-10-30T09:05:00.000Z",
        },
      ],
      next_before: null,
    });
    expect(Object.keys((res.body as RunsBody).runs[0] ?? {}).sort()).toEqual(
      ["ended", "id", "item_ref", "item_revision", "kind", "playbook", "session", "started", "status", "tokens", "version"],
    );
  });

  it("reads tokens, session, item and end as null while a run has none, and a zero token count as 0", async () => {
    seedPlaybook(1);
    seedRun({ playbook: 1, status: "running" });
    seedRun({ playbook: 1, tokens: 0 });
    const body = (await runs("1")).body as RunsBody;
    expect(body.runs[0]).toMatchObject({ tokens: 0 });
    expect(body.runs[1]).toMatchObject({ status: "running", tokens: null, session: null, item_ref: null, item_revision: null, ended: null });
  });

  it("answers newest first by id, only this playbook's runs, and an empty page for a playbook with none", async () => {
    seedPlaybook(1);
    seedPlaybook(2);
    const a = seedRun({ playbook: 1 });
    seedRun({ playbook: 2 });
    const c = seedRun({ playbook: 1, startedAt: "2020-01-01T00:00:00.000Z" });
    expect(((await runs("1")).body as RunsBody).runs.map((r) => r.id)).toEqual([c, a]);
    seedPlaybook(3);
    expect((await runs("3")).body).toEqual({ runs: [], next_before: null });
  });

  it("pages with limit and the opaque before cursor: next_before only when a row exists past the page, null on the last", async () => {
    seedPlaybook(1);
    const ids = Array.from({ length: 5 }, () => seedRun({ playbook: 1 })).reverse(); // newest first
    const first = (await runs("1", { limit: "2" })).body as RunsBody;
    expect(first.runs.map((r) => r.id)).toEqual(ids.slice(0, 2));
    expect(first.next_before).toBe(String(ids[1]));
    const second = (await runs("1", { limit: "2", before: first.next_before ?? "" })).body as RunsBody;
    expect(second.runs.map((r) => r.id)).toEqual(ids.slice(2, 4));
    expect(second.next_before).toBe(String(ids[3]));
    const third = (await runs("1", { limit: "2", before: second.next_before ?? "" })).body as RunsBody;
    expect(third.runs.map((r) => r.id)).toEqual(ids.slice(4));
    expect(third.next_before).toBeNull();
  });

  it("answers next_before null when the page exactly fills the remaining rows", async () => {
    seedPlaybook(1);
    for (let i = 0; i < 4; i++) seedRun({ playbook: 1 });
    const body = (await runs("1", { limit: "4" })).body as RunsBody;
    expect(body.runs).toHaveLength(4);
    expect(body.next_before).toBeNull();
  });

  it("defaults limit to 50 and caps it at 200", async () => {
    seedPlaybook(1);
    for (let i = 0; i < 205; i++) seedRun({ playbook: 1 });
    const dflt = (await runs("1")).body as RunsBody;
    expect(dflt.runs).toHaveLength(50);
    expect(dflt.next_before).toBe(String(dflt.runs[49]?.id));
    const capped = (await runs("1", { limit: "999" })).body as RunsBody;
    expect(capped.runs).toHaveLength(200);
    expect(capped.next_before).not.toBeNull();
    expect(((await runs("1", { limit: "200" })).body as RunsBody).runs).toHaveLength(200);
    expect(((await runs("1", { limit: "1" })).body as RunsBody).runs).toHaveLength(1);
  });

  it("does not expose result_json or dedupe_key", async () => {
    seedPlaybook(1);
    seedRun({ playbook: 1 });
    expect(JSON.stringify((await runs("1")).body)).not.toMatch(/secret|dedupe|result/);
  });

  it("answers 400 invalid_id for a non-numeric, zero, signed or oversized id", async () => {
    seedPlaybook(1);
    for (const id of ["abc", "0", "-1", "1.5", "01", "1e3", "", "99999999999999999999"]) {
      const res = await runs(id);
      expect(res, id).toMatchObject({ status: 400, body: { error: "invalid_id" } });
    }
  });

  it("answers 404 not_found for an unknown playbook", async () => {
    seedPlaybook(1);
    expect(await runs("2")).toMatchObject({ status: 404, body: { error: "not_found" } });
  });

  it("answers 400 invalid_query for a malformed limit or before", async () => {
    seedPlaybook(1);
    const malformed: Record<string, string>[] = [
      { limit: "0" },
      { limit: "-1" },
      { limit: "abc" },
      { limit: "1.5" },
      { limit: "" },
      { limit: "1000" },
      { limit: "050" },
      { before: "abc" },
      { before: "0" },
      { before: "-3" },
      { before: "" },
      { before: "1.5" },
      { before: "99999999999999999999" },
    ];
    for (const query of malformed) {
      const res = await runs("1", query);
      expect(res, JSON.stringify(query)).toMatchObject({ status: 400, body: { error: "invalid_query" } });
    }
  });

  it("checks the id before the query, and the query before the playbook", async () => {
    expect(await runs("abc", { limit: "x" })).toMatchObject({ status: 400, body: { error: "invalid_id" } });
    expect(await runs("9", { limit: "x" })).toMatchObject({ status: 400, body: { error: "invalid_query" } });
  });

  it("serves an unknown cursor as the rows older than it, never an error", async () => {
    seedPlaybook(1);
    const a = seedRun({ playbook: 1 });
    const body = (await runs("1", { before: "100000" })).body as RunsBody;
    expect(body.runs.map((r) => r.id)).toEqual([a]);
    expect(((await runs("1", { before: String(a) })).body as RunsBody).runs).toEqual([]);
  });
});

describe("GET /playbooks/:id/versions", () => {
  it("answers {versions} newest first, each {playbook, version, snapshot, created_at}", async () => {
    seedPlaybook(1);
    seedVersion(1, 1, JSON.stringify({ name: "Playbook 1", priority: "normal" }));
    seedVersion(1, 2, JSON.stringify({ name: "Playbook 1", priority: "high", model: "claude-sonnet-5" }));
    const res = await versions("1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      versions: [
        { playbook: 1, version: 2, snapshot: { name: "Playbook 1", priority: "high", model: "claude-sonnet-5" }, created_at: "2026-10-30T10:02:00.000Z" },
        { playbook: 1, version: 1, snapshot: { name: "Playbook 1", priority: "normal" }, created_at: "2026-10-30T10:01:00.000Z" },
      ],
    });
  });

  it("reads an unreadable snapshot, or one that is not a plain object, as {}, never a guessed row", async () => {
    seedPlaybook(1);
    seedVersion(1, 1, "not json {");
    seedVersion(1, 2, "null");
    seedVersion(1, 3, "[1,2]");
    seedVersion(1, 4, '"text"');
    seedVersion(1, 5, "42");
    seedVersion(1, 6, "true");
    seedVersion(1, 7, '{"name":"kept"}');
    const body = (await versions("1")).body as { versions: { version: number; snapshot: unknown }[] };
    expect(body.versions.map((v) => v.version)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    expect(body.versions.map((v) => v.snapshot)).toEqual([{ name: "kept" }, {}, {}, {}, {}, {}, {}]);
  });

  it("answers an empty list for a playbook with no versions, and only this playbook's versions", async () => {
    seedPlaybook(1);
    seedPlaybook(2);
    seedVersion(2, 1, "{}");
    expect((await versions("1")).body).toEqual({ versions: [] });
    expect(((await versions("2")).body as { versions: unknown[] }).versions).toHaveLength(1);
  });

  it("answers 400 invalid_id for a non-numeric id and 404 not_found for an unknown playbook", async () => {
    seedPlaybook(1);
    for (const id of ["abc", "0", "-1", "1.5", ""]) expect(await versions(id), id).toMatchObject({ status: 400, body: { error: "invalid_id" } });
    expect(await versions("2")).toMatchObject({ status: 404, body: { error: "not_found" } });
  });
});

describe("through the merged API", () => {
  let server: ApiServer;

  beforeEach(async () => {
    server = await startApiServer(
      {
        store: env.store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [stubProvider()],
        token: TOKEN,
        routes: mergeContributions([guiContribution], PHASE1_RESERVED).routes,
      },
      { now: env.now },
    );
  });

  afterEach(async () => {
    await server.close();
  });

  const get = (path: string, token: string | null = TOKEN) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { headers: token === null ? {} : { Authorization: `Bearer ${token}` } });

  it("serves both routes with the API token", async () => {
    seedPlaybook(1);
    const id = seedRun({ playbook: 1, tokens: 5 });
    seedVersion(1, 1, '{"name":"Playbook 1"}');
    const r = await get("/playbooks/1/runs?limit=10");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ runs: [{ id, tokens: 5 }], next_before: null });
    const v = await get("/playbooks/1/versions");
    expect(v.status).toBe(200);
    expect(await v.json()).toMatchObject({ versions: [{ playbook: 1, version: 1, snapshot: { name: "Playbook 1" } }] });
  });

  it("answers 401 without the token or with a wrong one", async () => {
    seedPlaybook(1);
    for (const path of ["/playbooks/1/runs", "/playbooks/1/versions"]) {
      expect((await get(path, null)).status, path).toBe(401);
      expect((await get(path, "wrong")).status, path).toBe(401);
    }
  });

  it("answers the 400 and 404 refusals over HTTP", async () => {
    expect((await get("/playbooks/abc/runs")).status).toBe(400);
    expect((await get("/playbooks/1/runs?limit=0")).status).toBe(400);
    expect((await get("/playbooks/9/runs")).status).toBe(404);
    expect((await get("/playbooks/abc/versions")).status).toBe(400);
    expect((await get("/playbooks/9/versions")).status).toBe(404);
  });
});
