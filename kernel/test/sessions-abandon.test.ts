// SessionManager.abandonSession (H04, AC4): the owner's release of an
// `orphaned` row whose latest orphaning reason is `leader_unverified`, over
// the fake spawner/query in session-fakes.ts. Never the real SDK, a model or
// a real process: every process-group call is injected and recorded.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionError, SessionManager, latestOrphanReason } from "../src/sessions/index.js";
import type { GroupLeader, SessionManagerDeps, SessionRow } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

const PGID = 4242;
const STARTED = "2026-10-02T05:30:54.000Z";
const resumeParams = { permissionMode: "default" as const, cwd: "/tmp", policy: { allowedTools: [], allowedBashPrefixes: [] } };

let tmp: string;
let pluginDir: string;
let store: Store;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-abandon-"));
  pluginDir = makePluginDir(tmp);
  store = new Store({ dataDir: join(tmp, "data") });
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A manager whose group probes all report a live `claude`-led group PGID, recording every call. */
function setup(deps: Partial<SessionManagerDeps> = {}) {
  const probes: string[] = [];
  const fakes = fakeSessions();
  const manager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
    {
      ...fakes.deps,
      killGroup: (pgid, signal) => {
        probes.push(`kill ${pgid} ${signal}`);
        return fakes.deps.killGroup?.(pgid, signal) ?? false;
      },
      isGroupAlive: (pgid) => {
        probes.push(`alive ${pgid}`);
        return pgid === PGID || (fakes.deps.isGroupAlive?.(pgid) ?? false);
      },
      readGroupLeader: (pgid): GroupLeader => {
        probes.push(`ps ${pgid}`);
        return { status: "present", command: "claude", startedAtMs: Date.parse(STARTED) };
      },
      ...deps,
    },
  );
  return { manager, probes, fakes };
}

function insertRow(status: string, leaderStartedAt: string | null = null): number {
  return Number(
    store
      .prepare(
        "INSERT INTO sessions (agent, status, pgid, sdk_session_id, model, loomwright_path, leader_started_at) VALUES ('wright', ?, ?, 'sid', 'claude-haiku-4-5', ?, ?)",
      )
      .run(status, PGID, pluginDir, leaderStartedAt).lastInsertRowid,
  );
}

/** An `orphaned` row with the given orphaning events, oldest first. */
function orphan(reasons: readonly [kind: "session_status" | "session_reap_deferred" | "session_resume_refused", reason: string][]): number {
  const id = insertRow("orphaned");
  for (const [kind, reason] of reasons) {
    const payload = kind === "session_status" ? { from: "running", to: "orphaned", reason, pgid: PGID } : { reason, pgid: PGID };
    store
      .prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES ('2026-10-02T06:00:00.000Z', ?, 'kernel', ?, ?)")
      .run(kind, id, JSON.stringify(payload));
  }
  return id;
}

function row(id: number): SessionRow {
  const r = store.prepare<[number], SessionRow>("SELECT * FROM sessions WHERE id = ?").get(id);
  if (r === undefined) throw new Error(`no session ${id}`);
  return r;
}

function eventCount(): number {
  return store.prepare<[], number>("SELECT count(*) FROM events").pluck().get() ?? 0;
}

function refusal(fn: () => unknown): SessionError {
  try {
    fn();
  } catch (err) {
    if (err instanceof SessionError) return err;
    throw err;
  }
  throw new Error("expected a SessionError");
}

describe("abandonSession (H04, AC4)", () => {
  it("moves a leader_unverified orphan (left by a real reap) to abandoned, records the owner, clears the kill flag, and never signals or probes", async () => {
    const { manager, probes } = setup();
    const id = insertRow("running", null); // no recorded start time
    expect(await manager.reapOrphans()).toEqual([{ sessionId: id, pgid: PGID, status: "orphaned", reason: "leader_unverified" }]);
    store.prepare("UPDATE sessions SET kill_incomplete_at = '2026-10-02T06:30:00.000Z' WHERE id = ?").run(id);
    probes.length = 0;

    expect(manager.abandonSession(id, { via: "cli" })).toBe("abandoned");
    expect(probes).toEqual([]);
    const r = row(id);
    expect(r.status).toBe("abandoned");
    expect(r.ended_at).not.toBeNull();
    expect(r.kill_incomplete_at).toBeNull();
    const last = store
      .prepare<[number], { at: string; actor: string; payload_json: string }>(
        "SELECT at, actor, payload_json FROM events WHERE kind = 'session_status' AND session_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(id);
    expect(JSON.parse(last?.payload_json ?? "{}")).toEqual({
      from: "orphaned",
      to: "abandoned",
      reason: "abandoned_by_owner",
      by: "owner",
      via: "cli",
      pgid: PGID,
      orphaned_reason: "leader_unverified",
    });
    expect(last?.at).toBe(r.updated_at);

    // Every consumer treats it as terminal: no resume, no re-examination, no kill retry, no stop error.
    const resume = await manager.resumeSession(id, resumeParams).catch((e: unknown) => e);
    expect((resume as SessionError).code).toBe("not_resumable");
    expect(await manager.reapOrphans()).toEqual([]);
    expect(await manager.stopSession(id)).toBe("abandoned");
    expect(probes).toEqual([]);
    expect(row(id).status).toBe("abandoned");
    expect(refusal(() => manager.abandonSession(id, { via: "api" })).code).toBe("not_abandonable");
  });

  it("records via api, and accepts a row whose newest reason event is a deferral or a refused resume", () => {
    const { manager } = setup();
    const deferred = orphan([["session_status", "reap_error"], ["session_reap_deferred", "leader_unverified"]]);
    const refused = orphan([["session_status", "group_alive"], ["session_resume_refused", "leader_unverified"]]);
    expect(manager.abandonSession(deferred, { via: "api" })).toBe("abandoned");
    expect(manager.abandonSession(refused, { via: "cli" })).toBe("abandoned");
    const via = store
      .prepare<[], string>("SELECT json_extract(payload_json, '$.via') FROM events WHERE json_extract(payload_json, '$.to') = 'abandoned' ORDER BY id")
      .pluck()
      .all();
    expect(via).toEqual(["api", "cli"]);
  });

  it("refuses, writing nothing, an orphan whose latest orphaning reason is not leader_unverified", () => {
    const { manager, probes } = setup();
    const cases: [string, number][] = [
      ["reap_error", orphan([["session_status", "reap_error"]])],
      ["kill_incomplete", orphan([["session_status", "kill_incomplete"]])],
      ["newest wins", orphan([["session_status", "leader_unverified"], ["session_reap_deferred", "reap_error"]])],
      ["no reason recorded", orphan([])],
    ];
    const before = eventCount();
    for (const [name, id] of cases) {
      expect(refusal(() => manager.abandonSession(id, { via: "cli" })).code, name).toBe("not_abandonable");
      expect(row(id).status, name).toBe("orphaned");
    }
    expect(latestOrphanReason(store, cases[2]?.[1] as number)).toBe("reap_error");
    expect(eventCount()).toBe(before);
    expect(probes).toEqual([]);
  });

  it("refuses a row that is not orphaned, a live session, an unknown id and a bad id or via", async () => {
    const { manager } = setup();
    for (const status of ["interrupted", "failed", "completed", "running", "abandoned"]) {
      const id = insertRow(status);
      expect(refusal(() => manager.abandonSession(id, { via: "cli" })).code, status).toBe("not_abandonable");
      expect(row(id).status, status).toBe(status);
    }

    const handle = await manager.startSession(startParams(tmp));
    // Live in this manager, whatever its row says.
    store.prepare("UPDATE sessions SET status = 'orphaned' WHERE id = ?").run(handle.id);
    store
      .prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES ('x', 'session_reap_deferred', 'kernel', ?, ?)")
      .run(handle.id, JSON.stringify({ reason: "leader_unverified" }));
    expect(refusal(() => manager.abandonSession(handle.id, { via: "cli" })).code).toBe("not_abandonable");
    await manager.stopSession(handle.id);

    expect(refusal(() => manager.abandonSession(9_999, { via: "cli" })).code).toBe("not_found");
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(refusal(() => manager.abandonSession(bad, { via: "cli" })).code).toBe("invalid_params");
    }
    const id = orphan([["session_status", "leader_unverified"]]);
    expect(refusal(() => manager.abandonSession(id, { via: "web" as "cli" })).code).toBe("invalid_params");
    expect(row(id).status).toBe("orphaned");
  });

  it("refuses when a reap moves the row between the read and the write", () => {
    const { manager } = setup();
    const id = orphan([["session_status", "leader_unverified"]]);
    // The row changes status just as the abandon reads it.
    const original = manager.getSession.bind(manager);
    vi.spyOn(manager, "getSession").mockImplementation((i) => {
      const r = original(i);
      store.prepare("UPDATE sessions SET status = 'interrupted' WHERE id = ?").run(id);
      return r;
    });
    expect(refusal(() => manager.abandonSession(id, { via: "cli" })).code).toBe("not_abandonable");
    expect(row(id).status).toBe("interrupted");
    vi.restoreAllMocks();
  });
});
