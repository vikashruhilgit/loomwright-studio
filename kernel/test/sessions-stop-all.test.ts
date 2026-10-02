// SessionManager.stopAll (item 08): the kill switch's `stop` mode and the
// graceful daemon stop's `shutdown` mode, over the fake spawner/query in
// session-fakes.ts. Never the real SDK, a model or a real process.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/sessions/index.js";
import type { SessionHandle, SessionManagerDeps, SessionManagerOptions, SessionRow } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { fakeMsg, fakeSessions, flush, immediate, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

let tmp: string;
let pluginDir: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-stop-all-"));
  pluginDir = makePluginDir(tmp);
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

function setup(
  o: { fakes?: Parameters<typeof fakeSessions>[0]; deps?: Partial<SessionManagerDeps>; options?: Partial<SessionManagerOptions> } = {},
) {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  const fakes = fakeSessions(o.fakes);
  const manager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, ...o.options },
    { ...fakes.deps, ...o.deps },
  );
  return { store, manager, ...fakes };
}

function row(store: Store, id: number): SessionRow {
  const r = store.prepare<[number], SessionRow>("SELECT * FROM sessions WHERE id = ?").get(id);
  if (r === undefined) throw new Error(`no session ${id}`);
  return r;
}

function statusEvents(store: Store, id: number): Record<string, unknown>[] {
  return store
    .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'session_status' AND session_id = ? ORDER BY id")
    .pluck()
    .all(id)
    .map((p) => JSON.parse(p) as Record<string, unknown>);
}

async function startRunning(store: Store, manager: SessionManager, n: number): Promise<SessionHandle[]> {
  const handles: SessionHandle[] = [];
  for (let i = 0; i < n; i++) handles.push(await manager.startSession(startParams(tmp)));
  await vi.waitFor(() => {
    for (const h of handles) expect(row(store, h.id).status).toBe("running");
  });
  return handles;
}

describe("SessionManager.stopAll", () => {
  it("returns [] with no live session", async () => {
    const { manager } = setup();
    expect(await manager.stopAll()).toEqual([]);
    expect(await manager.stopAll({ mode: "shutdown" })).toEqual([]);
  });

  it("stop mode (default) ends every running session stopped, every recorded group gone", async () => {
    const { store, manager, killed, allGroupsGone, children } = setup();
    const [a, b] = (await startRunning(store, manager, 2)) as [SessionHandle, SessionHandle];
    expect(allGroupsGone()).toBe(false);

    const outcomes = await manager.stopAll();
    expect(outcomes).toEqual([
      { id: a.id, status: "stopped" },
      { id: b.id, status: "stopped" },
    ]);
    expect(children.size).toBe(2);
    expect(allGroupsGone()).toBe(true);
    expect(killed).toContainEqual([a.pgid, "SIGKILL"]);
    expect(killed).toContainEqual([b.pgid, "SIGKILL"]);
    expect(row(store, a.id).status).toBe("stopped");
    expect(row(store, b.id).status).toBe("stopped");
    expect(await a.done).toBe("stopped");
    expect(statusEvents(store, a.id).at(-1)).toMatchObject({ from: "running", to: "stopped", reason: "stop_requested" });
  });

  it("shutdown mode ends running sessions interrupted (kernel_shutdown), groups gone, and nothing overwrites it later", async () => {
    const { store, manager, allGroupsGone } = setup();
    const handles = await startRunning(store, manager, 2);

    const outcomes = await manager.stopAll({ mode: "shutdown" });
    expect(outcomes).toEqual(handles.map((h) => ({ id: h.id, status: "interrupted" })));
    expect(allGroupsGone()).toBe(true);

    // The background start path (#runStart -> #consume -> #conclude) must not
    // write a verdict over `interrupted` (a non-terminal status) afterwards.
    for (const h of handles) expect(await h.done).toBe("interrupted");
    await flush(10);
    for (const h of handles) {
      const r = row(store, h.id);
      expect(r.status).toBe("interrupted");
      expect(r.ended_at).toBeNull();
      expect(r.kill_incomplete_at).toBeNull();
      const events = statusEvents(store, h.id);
      expect(events.at(-1)).toEqual({ from: "running", to: "interrupted", reason: "kernel_shutdown" });
      // No session_status event follows the kernel_shutdown one.
      expect(events.findIndex((e) => e["reason"] === "kernel_shutdown")).toBe(events.length - 1);
    }
  });

  it("a session interrupted by a shutdown is resumable: resumeSession launches a resume attempt", async () => {
    const { store, manager, calls } = setup();
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    await manager.stopAll({ mode: "shutdown" });
    expect(await h.done).toBe("interrupted");
    const sdkSessionId = row(store, h.id).sdk_session_id;

    const resumed = await manager.resumeSession(h.id, {
      permissionMode: "default",
      cwd: tmp,
      policy: { allowedTools: ["Read"], allowedBashPrefixes: [] },
    });
    expect(resumed.id).toBe(h.id);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.options.resume).toBe(sdkSessionId);
    await vi.waitFor(() => expect(row(store, h.id).status).toBe("running"));
    expect(await manager.stopAll()).toEqual([{ id: h.id, status: "stopped" }]);
  });

  it("shutdown mode: a kill that cannot confirm the group gone ends failed (kill_incomplete), flagged for re-reap", async () => {
    const { store, manager } = setup({
      deps: {
        schedule: immediate,
        // A group that survives every SIGKILL.
        killGroup: () => true,
        isGroupAlive: () => true,
      },
    });
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    expect(await manager.stopAll({ mode: "shutdown" })).toEqual([{ id: h.id, status: "failed" }]);
    expect(await h.done).toBe("failed");
    expect(statusEvents(store, h.id).at(-1)).toEqual({
      from: "running",
      to: "failed",
      reason: "kill_incomplete",
      cause: { to: "interrupted", reason: "kernel_shutdown" },
      pgid: h.pgid,
    });
    expect(row(store, h.id).kill_incomplete_at).not.toBeNull();
  });

  it("one stop that rejects yields stop_failed and the other session is still stopped", async () => {
    const { store, manager, isGroupAlive } = setup();
    const [a, b] = (await startRunning(store, manager, 2)) as [SessionHandle, SessionHandle];
    const original = manager.stopSession.bind(manager);
    vi.spyOn(manager, "stopSession").mockImplementation((id) =>
      id === a.id ? Promise.reject(new Error("store went away")) : original(id),
    );

    expect(await manager.stopAll()).toEqual([
      { id: a.id, status: "stop_failed", error: "store went away" },
      { id: b.id, status: "stopped" },
    ]);
    expect(row(store, b.id).status).toBe("stopped");
    expect(isGroupAlive(b.pgid as number)).toBe(false);
    // The row of the failed stop keeps whatever the manager recorded.
    expect(row(store, a.id).status).toBe("running");
    vi.restoreAllMocks();
    expect(await manager.stopAll()).toEqual([{ id: a.id, status: "stopped" }]);
  });

  it("kills the group of a failed:auth session still waiting for its auth kill timer", async () => {
    const { store, manager, killed, isGroupAlive } = setup({
      options: { authTimeoutMs: 3_600_000 },
      fakes: {
        script: ({ stream, options }) => {
          stream.push(fakeMsg.init(options.sessionId ?? ""));
          stream.push(fakeMsg.apiRetry401());
        },
      },
    });
    const h = await manager.startSession(startParams(tmp));
    await vi.waitFor(() => expect(row(store, h.id).status).toBe("failed:auth"));
    expect(isGroupAlive(h.pgid as number)).toBe(true);

    expect(await manager.stopAll({ mode: "shutdown" })).toEqual([{ id: h.id, status: "failed:auth" }]);
    expect(killed).toContainEqual([h.pgid, "SIGKILL"]);
    expect(isGroupAlive(h.pgid as number)).toBe(false);
    expect(await h.done).toBe("failed:auth");
    expect(row(store, h.id).status).toBe("failed:auth");
  });

  for (const mode of ["stop", "shutdown"] as const) {
    it(`${mode} mode: a failed:auth session whose group never dies is stop_failed (kill_incomplete), never ended, and re-reaped`, async () => {
      const AUTH_TIMEOUT_MS = 3_600_000;
      let groupAlive = true;
      const { store, manager } = setup({
        options: { authTimeoutMs: AUTH_TIMEOUT_MS },
        deps: {
          // Kill rounds pass at once; the auth kill timer never fires (it would die with a stopping kernel).
          schedule: (fn, ms) => (ms >= AUTH_TIMEOUT_MS ? () => {} : immediate(fn, ms)),
          // A group that survives every SIGKILL until `groupAlive` is cleared.
          killGroup: () => groupAlive,
          isGroupAlive: () => groupAlive,
        },
        fakes: {
          script: ({ stream, options }) => {
            stream.push(fakeMsg.init(options.sessionId ?? ""));
            stream.push(fakeMsg.apiRetry401());
          },
        },
      });
      const h = await manager.startSession(startParams(tmp));
      await vi.waitFor(() => expect(row(store, h.id).status).toBe("failed:auth"));

      expect(await manager.stopAll({ mode })).toEqual([{ id: h.id, status: "stop_failed", error: "kill_incomplete" }]);
      // The row keeps failed:auth, flagged so a later reap retries the kill.
      expect(row(store, h.id).status).toBe("failed:auth");
      expect(row(store, h.id).kill_incomplete_at).not.toBeNull();
      // Settled: `done` resolves, a repeat stopAll no longer sees it, and the reaper owns the retry.
      expect(await h.done).toBe("failed:auth");
      expect(await manager.stopAll({ mode })).toEqual([]);
      const retried = (): Record<string, unknown>[] =>
        store
          .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'session_kill_retried' AND session_id = ? ORDER BY id")
          .pluck()
          .all(h.id)
          .map((p) => JSON.parse(p) as Record<string, unknown>);

      expect(await manager.reapOrphans()).toEqual([]);
      expect(retried()).toEqual([{ status: "failed:auth", reason: "kill_incomplete", pgid: h.pgid }]);
      expect(row(store, h.id).kill_incomplete_at).not.toBeNull();

      groupAlive = false;
      await manager.reapOrphans();
      expect(retried().at(-1)).toEqual({ status: "failed:auth", reason: "group_gone", pgid: h.pgid });
      expect(row(store, h.id).kill_incomplete_at).toBeNull();
      expect(row(store, h.id).status).toBe("failed:auth");
    });
  }

  it("stopSession alone still ends a running session stopped (unchanged)", async () => {
    const { store, manager, isGroupAlive } = setup();
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    expect(await manager.stopSession(h.id)).toBe("stopped");
    expect(isGroupAlive(h.pgid as number)).toBe(false);
    expect(statusEvents(store, h.id).at(-1)).toEqual({ from: "running", to: "stopped", reason: "stop_requested" });
  });

  it("shares a stop already in flight instead of starting a second one", async () => {
    const { store, manager } = setup();
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    const first = manager.stopSession(h.id);
    expect(await manager.stopAll({ mode: "shutdown" })).toEqual([{ id: h.id, status: "stopped" }]);
    expect(await first).toBe("stopped");
    expect(statusEvents(store, h.id).filter((e) => e["to"] === "stopped" || e["to"] === "interrupted")).toHaveLength(1);
  });
});
