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

describe("a reap never signals a row that changed status while an earlier row's kill was awaited (H04 review)", () => {
  const SLOW = 5101; // the first row's group: its kill is held at the first sleep
  const OTHER = 5102; // the second row's group: alive, leaderless, so a reap would kill it
  const GONE = 5103; // an unchanged third row whose group is gone

  /** Every group probe recorded; the kill's sleep is held in `pending` until `release`. */
  function racing() {
    const calls: string[] = [];
    const alive = new Set([SLOW, OTHER]);
    const pending: (() => void)[] = [];
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
      {
        ...fakeSessions().deps,
        killGroup: (pgid, signal) => {
          calls.push(`kill ${pgid} ${signal}`);
          return alive.has(pgid);
        },
        isGroupAlive: (pgid) => {
          calls.push(`alive ${pgid}`);
          return alive.has(pgid);
        },
        readGroupLeader: (pgid): GroupLeader => {
          calls.push(`ps ${pgid}`);
          return { status: "absent" }; // leaderless: the reaper's "ours", so it would kill
        },
        schedule: (fn) => {
          pending.push(fn);
          return () => {};
        },
      },
    );
    /** Run every held sleep, one event-loop turn at a time, until `p` settles (no wall clock). */
    const settle = async <T>(p: Promise<T>): Promise<T> => {
      let done = false;
      const tracked = p.finally(() => {
        done = true;
      });
      while (!done) {
        for (const fn of pending.splice(0)) fn();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      return tracked;
    };
    return { manager, calls, alive, pending, settle };
  }

  function rowAt(status: string, pgid: number, killIncompleteAt: string | null = null): number {
    return Number(
      store
        .prepare(
          "INSERT INTO sessions (agent, status, pgid, sdk_session_id, model, loomwright_path, kill_incomplete_at) VALUES ('wright', ?, ?, 'sid', 'claude-haiku-4-5', ?, ?)",
        )
        .run(status, pgid, pluginDir, killIncompleteAt).lastInsertRowid,
    );
  }

  function unverifiedOrphanAt(pgid: number): number {
    const id = rowAt("orphaned", pgid);
    store
      .prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES ('2026-10-02T06:00:00.000Z', 'session_status', 'kernel', ?, ?)")
      .run(id, JSON.stringify({ from: "running", to: "orphaned", reason: "leader_unverified", pgid }));
    return id;
  }

  function events(id: number, kind: string): number {
    return store.prepare<[number, string], number>("SELECT count(*) FROM events WHERE session_id = ? AND kind = ?").pluck().get(id, kind) ?? 0;
  }

  it("an abandon landing during an earlier row's kill: the abandoned row is never probed or signalled; unchanged rows are still reaped", async () => {
    const { manager, calls, alive, pending, settle } = racing();
    const slow = unverifiedOrphanAt(SLOW);
    const abandonedRow = unverifiedOrphanAt(OTHER);
    const unchanged = unverifiedOrphanAt(GONE);

    const reap = manager.reapOrphans();
    // The first row's kill is now held at its first sleep (reached synchronously).
    expect(pending).toHaveLength(1);
    expect(calls).toContain(`kill ${SLOW} SIGKILL`);

    expect(manager.abandonSession(abandonedRow, { via: "cli" })).toBe("abandoned");
    // The row whose kill is in flight cannot be abandoned under it.
    expect(refusal(() => manager.abandonSession(slow, { via: "cli" })).code).toBe("not_abandonable");
    expect(row(slow).status).toBe("orphaned");

    alive.delete(SLOW);
    expect(await settle(reap)).toEqual([
      { sessionId: slow, pgid: SLOW, status: "interrupted", reason: "group_killed" },
      { sessionId: unchanged, pgid: GONE, status: "interrupted", reason: "group_gone" },
    ]);
    expect(calls.filter((c) => c.includes(String(OTHER)))).toEqual([]);
    expect(row(abandonedRow).status).toBe("abandoned");
    expect(events(abandonedRow, "session_kill_incomplete")).toBe(0);
    expect(events(abandonedRow, "session_reap_deferred")).toBe(0);

    // The in-flight marker is cleared once the reap is done.
    const later = unverifiedOrphanAt(GONE + 1);
    expect(manager.abandonSession(later, { via: "api" })).toBe("abandoned");
  });

  it("a kill retry skips a terminal row whose flag was cleared while an earlier row's kill was awaited", async () => {
    const { manager, calls, alive, pending, settle } = racing();
    const flag = "2026-10-02T06:30:00.000Z";
    const slow = rowAt("failed", SLOW, flag);
    const cleared = rowAt("failed", OTHER, flag);
    const stillFlagged = rowAt("stopped", GONE, flag);

    const reap = manager.reapOrphans();
    expect(pending).toHaveLength(1);
    // As a live kill that confirmed the group gone would: the flag is cleared mid-retry.
    store.prepare("UPDATE sessions SET kill_incomplete_at = NULL WHERE id = ?").run(cleared);

    alive.delete(SLOW);
    expect(await settle(reap)).toEqual([]);
    expect(calls.filter((c) => c.includes(String(OTHER)))).toEqual([]);
    expect(events(cleared, "session_kill_retried")).toBe(0);
    expect(events(slow, "session_kill_retried")).toBe(1);
    expect(row(slow).kill_incomplete_at).toBeNull();
    // An unchanged flagged row is still retried and, its group gone, unflagged.
    expect(events(stillFlagged, "session_kill_retried")).toBe(1);
    expect(row(stillFlagged).kill_incomplete_at).toBeNull();
  });
});
