// SessionManager.stopAll (item 08): the kill switch's `stop` mode and the
// graceful daemon stop's `shutdown` mode, over the fake spawner/query in
// session-fakes.ts. Never the real SDK, a model or a real process.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEADER_EXIT_WAIT_MS, SessionManager } from "../src/sessions/index.js";
import type { SessionHandle, SessionManagerDeps, SessionManagerOptions, SessionRow } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { CancelTimer, SessionStatus } from "../src/sessions/index.js";
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

  it("kills the group of a failed:auth session still waiting for its auth kill timer, and cancels that timer", async () => {
    const AUTH_TIMEOUT_MS = 3_600_000;
    // The auth timer is held here (never fired by time): `cancelled` records its cancel.
    const authTimers: { fn: () => void; cancelled: boolean }[] = [];
    const { store, manager, killed, isGroupAlive } = setup({
      options: { authTimeoutMs: AUTH_TIMEOUT_MS },
      deps: {
        schedule: (fn, ms): CancelTimer => {
          if (ms !== AUTH_TIMEOUT_MS) return immediate(fn, ms);
          const timer = { fn, cancelled: false };
          authTimers.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
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
    expect(isGroupAlive(h.pgid as number)).toBe(true);

    expect(authTimers).toHaveLength(1);
    // It had ended on its own (failed:auth) and its group is confirmed gone.
    expect(await manager.stopAll({ mode: "shutdown" })).toEqual([{ id: h.id, status: "failed:auth", ended_on_its_own: true }]);
    expect(killed).toContainEqual([h.pgid, "SIGKILL"]);
    expect(isGroupAlive(h.pgid as number)).toBe(false);
    expect(await h.done).toBe("failed:auth");
    expect(row(store, h.id).status).toBe("failed:auth");

    // AC6: the pending auth timer is cancelled; a timer that honoured the cancel never fires, so no second kill.
    expect(authTimers[0]?.cancelled).toBe(true);
    const kills = killed.length;
    for (const t of authTimers) if (!t.cancelled) t.fn();
    await flush();
    expect(killed).toHaveLength(kills);
  });

  for (const mode of ["stop", "shutdown"] as const) {
    it(`${mode} mode: a session whose result was an error, stopped while its group is cleaned up, is failed with ended_on_its_own`, async () => {
      const errorResult = { type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"] } as unknown as SDKMessage;
      const { store, manager, isGroupAlive } = setup({
        fakes: {
          script: ({ stream, options }) => {
            // The stream ends with an error result while the CLI's group lives on (cleanup pending).
            stream.onEnd = () => {};
            stream.push(fakeMsg.init(options.sessionId ?? ""));
            stream.push(errorResult);
            stream.end();
          },
        },
      });
      const h = await manager.startSession(startParams(tmp));
      // The verdict is computed; #conclude now waits (1 s, real) for the leader's exit.
      await flush();
      expect(isGroupAlive(h.pgid as number)).toBe(true);

      expect(await manager.stopAll({ mode })).toEqual([{ id: h.id, status: "failed", ended_on_its_own: true }]);
      expect(isGroupAlive(h.pgid as number)).toBe(false);
      expect(await h.done).toBe("failed");
      expect(statusEvents(store, h.id).at(-1)).toMatchObject({ to: "failed", reason: "result_error", stop_requested_after_end: true });
    });
  }

  it("never marks ended_on_its_own when the group of an already-ended session is not confirmed gone", async () => {
    const errorResult = { type: "result", subtype: "error_during_execution", is_error: true, errors: ["boom"] } as unknown as SDKMessage;
    // The cleanup's wait for the leader's exit is held until the stop arrives.
    let hold = true;
    const { store, manager } = setup({
      deps: {
        schedule: (fn, ms) => (hold && ms >= LEADER_EXIT_WAIT_MS ? () => {} : immediate(fn, ms)),
        killGroup: () => true,
        isGroupAlive: () => true,
      },
      fakes: {
        script: ({ stream, options }) => {
          stream.onEnd = () => {};
          stream.push(fakeMsg.init(options.sessionId ?? ""));
          stream.push(errorResult);
          stream.end();
        },
      },
    });
    const h = await manager.startSession(startParams(tmp));
    // The stream has ended (verdict set); its cleanup is still waiting for the leader.
    await flush();
    hold = false;
    const outcomes = await manager.stopAll();
    expect(outcomes).toEqual([{ id: h.id, status: "failed" }]);
    // The stream's own outcome was kept as the cause: it had ended, but its group is not confirmed gone.
    expect(statusEvents(store, h.id).at(-1)).toMatchObject({
      to: "failed",
      reason: "kill_incomplete",
      cause: { to: "failed", reason: "result_error" },
    });
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

describe("SessionManager.stopSession: the owner's stop and kill modes (phase 5 item 04)", () => {
  /** A grace long enough that only a kill can end it: its timer is held, never fired. */
  const LONG_GRACE_MS = 3_600_000;
  /** Real timers for every wait but the held grace. */
  const holdGrace = (fn: () => void, ms: number): CancelTimer => {
    if (ms === LONG_GRACE_MS) return () => {};
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  };
  /** `p`'s value, or `"timed out"` after `ms` (a stop stuck in a held grace never settles). */
  const within = <T,>(p: Promise<T>, ms = 2_000): Promise<T | "timed out"> =>
    Promise.race([p, new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), ms))]);

  it("mode stop is today's graceful stop, ending stopped with reason owner_stop, groups gone", async () => {
    const { store, manager, isGroupAlive } = setup();
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    expect(await manager.stopSession(h.id, { mode: "stop" })).toBe("stopped");
    expect(isGroupAlive(h.pgid as number)).toBe(false);
    expect(statusEvents(store, h.id).at(-1)).toEqual({ from: "running", to: "stopped", reason: "owner_stop" });
  });

  it("mode stop waits out its grace: with the grace held it never ends", async () => {
    const { store, manager, isGroupAlive } = setup({ options: { stopGraceMs: LONG_GRACE_MS }, deps: { schedule: holdGrace } });
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    const stopping = manager.stopSession(h.id, { mode: "stop" });
    expect(await within(stopping, 100)).toBe("timed out");
    expect(isGroupAlive(h.pgid as number)).toBe(true);
    // Released by a kill (the next test pins that), so nothing is left running.
    expect(await manager.stopSession(h.id, { mode: "kill" })).toBe("stopped");
  });

  it("mode kill skips the grace: the CLI ignores stdin EOF and the grace is held, yet the kill ends it at once (owner_kill)", async () => {
    const { store, manager, isGroupAlive, killed } = setup({ options: { stopGraceMs: LONG_GRACE_MS }, deps: { schedule: holdGrace } });
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    expect(await within(manager.stopSession(h.id, { mode: "kill" }))).toBe("stopped");
    expect(killed).toContainEqual([h.pgid, "SIGKILL"]);
    expect(isGroupAlive(h.pgid as number)).toBe(false);
    expect(statusEvents(store, h.id).at(-1)).toEqual({ from: "running", to: "stopped", reason: "owner_kill" });
    expect(await h.done).toBe("stopped");
  });

  it("a kill that arrives while a graceful stop waits out its grace kills at once and joins that stop: one terminal transition, owner_kill", async () => {
    const { store, manager, isGroupAlive } = setup({ options: { stopGraceMs: LONG_GRACE_MS }, deps: { schedule: holdGrace } });
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    const stop = manager.stopSession(h.id, { mode: "stop" });
    await flush();
    // In its grace: the CLI ignores the closed input, so its group is alive.
    expect(isGroupAlive(h.pgid as number)).toBe(true);
    const kill = manager.stopSession(h.id, { mode: "kill" });
    expect(await within(kill)).toBe("stopped");
    expect(await within(stop)).toBe("stopped");
    expect(isGroupAlive(h.pgid as number)).toBe(false);
    const terminal = statusEvents(store, h.id).filter((e) => e["to"] === "stopped" || e["to"] === "failed");
    expect(terminal).toEqual([{ from: "running", to: "stopped", reason: "owner_kill" }]);
  });

  it("a second stop during a stop's grace joins it and does not cut the grace short", async () => {
    const { store, manager } = setup({ options: { stopGraceMs: LONG_GRACE_MS }, deps: { schedule: holdGrace } });
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    const first = manager.stopSession(h.id, { mode: "stop" });
    await flush();
    expect(await within(manager.stopSession(h.id, { mode: "stop" }), 100)).toBe("timed out");
    expect(await within(manager.stopSession(h.id), 100)).toBe("timed out");
    expect(await manager.stopSession(h.id, { mode: "kill" })).toBe("stopped");
    expect(await first).toBe("stopped");
  });

  it("a kill that cannot confirm the group gone ends failed (kill_incomplete), the row flagged for the reaper", async () => {
    const { store, manager } = setup({ deps: { schedule: immediate, killGroup: () => true, isGroupAlive: () => true } });
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    expect(await manager.stopSession(h.id, { mode: "kill" })).toBe("failed");
    expect(statusEvents(store, h.id).at(-1)).toEqual({
      from: "running",
      to: "failed",
      reason: "kill_incomplete",
      cause: { to: "stopped", reason: "owner_kill" },
      pgid: h.pgid,
    });
    expect(row(store, h.id).kill_incomplete_at).not.toBeNull();
  });

  it("onAccepted runs once, before the stop begins, only when the stop is accepted; a throw refuses the stop and changes nothing", async () => {
    const { store, manager, isGroupAlive } = setup();
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];

    // A throw: rejected, nothing stopped.
    const refused = await manager.stopSession(h.id, { mode: "kill", onAccepted: () => { throw new Error("audit write failed"); } }).catch((e: unknown) => e);
    expect(refused).toEqual(new Error("audit write failed"));
    expect(row(store, h.id).status).toBe("running");
    expect(isGroupAlive(h.pgid as number)).toBe(true);

    const seen: string[] = [];
    const stopping = manager.stopSession(h.id, { mode: "stop", onAccepted: () => seen.push(row(store, h.id).status) });
    // Synchronously, while the session is still running.
    expect(seen).toEqual(["running"]);
    expect(await stopping).toBe("stopped");

    // Ended, unknown and not-live sessions: never called.
    const never = vi.fn();
    expect(await manager.stopSession(h.id, { mode: "kill", onAccepted: never })).toBe("stopped");
    expect(await manager.stopSession(9_999, { onAccepted: never }).catch((e: unknown) => (e as { code?: string }).code)).toBe("not_found");
    const notLive = Number(store.prepare("INSERT INTO sessions (agent, status) VALUES ('wright', 'interrupted')").run().lastInsertRowid);
    expect(await manager.stopSession(notLive, { onAccepted: never }).catch((e: unknown) => (e as { code?: string }).code)).toBe("not_live");
    expect(never).not.toHaveBeenCalled();
  });

  it("killDuringOwnerStop joins only an owner Stop in flight; otherwise it does nothing and returns undefined", async () => {
    const { store, manager, isGroupAlive } = setup({ options: { stopGraceMs: LONG_GRACE_MS }, deps: { schedule: holdGrace } });
    const [a, b] = (await startRunning(store, manager, 2)) as [SessionHandle, SessionHandle];
    const never = vi.fn();
    // No stop in flight, or an unknown id: no stop is started, nothing is recorded.
    expect(manager.killDuringOwnerStop(a.id, { onAccepted: never })).toBeUndefined();
    expect(manager.killDuringOwnerStop(9_999, { onAccepted: never })).toBeUndefined();
    expect(row(store, a.id).status).toBe("running");
    expect(isGroupAlive(a.pgid as number)).toBe(true);
    // A stop the owner did not start (the kill switch's `stopSession(id)`): left alone, its grace kept.
    const plain = manager.stopSession(b.id);
    expect(manager.killDuringOwnerStop(b.id, { onAccepted: never })).toBeUndefined();
    expect(await within(plain, 100)).toBe("timed out");
    expect(never).not.toHaveBeenCalled();
    // An owner Stop: joined, its grace cut short, one terminal transition (owner_kill).
    const stop = manager.stopSession(a.id, { mode: "stop" });
    const accepted = vi.fn();
    const kill = manager.killDuringOwnerStop(a.id, { onAccepted: accepted });
    expect(kill).toBeDefined();
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(await within(kill as Promise<SessionStatus>)).toBe("stopped");
    expect(await within(stop)).toBe("stopped");
    expect(statusEvents(store, a.id).filter((e) => e["to"] === "stopped" || e["to"] === "failed")).toEqual([{ from: "running", to: "stopped", reason: "owner_kill" }]);
    // Once it has ended, nothing to join.
    expect(manager.killDuringOwnerStop(a.id, { onAccepted: never })).toBeUndefined();
    expect(never).not.toHaveBeenCalled();
    // Release the kill switch's stop of b.
    expect(await manager.stopSession(b.id, { mode: "kill" })).toBe("stopped");
    expect(await plain).toBe("stopped");
  });

  it("refuses an unknown mode (invalid_params) without stopping anything", async () => {
    const { store, manager } = setup();
    const [h] = (await startRunning(store, manager, 1)) as [SessionHandle];
    const err = await manager.stopSession(h.id, { mode: "halt" as unknown as "stop" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "SessionError", code: "invalid_params" });
    expect(row(store, h.id).status).toBe("running");
    expect(await manager.stopSession(h.id)).toBe("stopped");
  });
});
