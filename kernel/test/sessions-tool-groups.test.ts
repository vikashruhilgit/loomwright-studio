// H08: the process groups a session's tools start outside the CLI's own group
// (the Bash tool runs its command in a new session and group). The kernel
// records them (`session_groups`) from a `ps -A` snapshot walk and kills them
// with the CLI's group on stop, the kill switch, a natural end and the reaper,
// each only after an ownership check. Everything here is injected: the fake
// spawner/query of session-fakes.ts, a fake process table, fake `kill`, fake
// `ps`. Never the real SDK, a model, the host's `ps` or a real signal: every
// pid is above any real pid_max.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStatus } from "../src/api/server.js";
import { summarizeStopAll } from "../src/cli/index.js";
import { LeaderProbeError, SessionManager, descendantGroups, parseProcessTable } from "../src/sessions/index.js";
import type { GroupLeader, ProcessEntry, SessionManagerDeps } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { fakeSessions, flush, immediate, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

const T0 = Date.UTC(2026, 9, 6, 8, 0, 0);
const T1 = T0 + 5_000;
const CLI_PATH = "/opt/sdk/claude";
/** Tool pids: fake, far above any real pid_max. */
const SHELL = 3_000_000_001;
const SLEEP = 3_000_000_002;
const OTHER_GROUP = 3_000_000_010;
/** A CLI the reaper finds alive after a kernel restart (no fake child). */
const ORPHAN_CLI = 2_100_000_000;

let tmp: string;
let pluginDir: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-tool-groups-"));
  pluginDir = makePluginDir(tmp);
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * A fake host: the fake CLIs of `fakeSessions` (alive while their FakeChild
 * runs), CLIs left by a dead kernel (`orphanClis`, pid → `comm`) and tool
 * processes (`tools`). `kill` empties a tool group unless it is `stubborn`;
 * `ps` fails for the pids in `psFailsFor`.
 */
function setup(o: { deps?: Partial<SessionManagerDeps> } = {}) {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  const fakes = fakeSessions();
  const tools = new Map<number, ProcessEntry>();
  const orphanClis = new Map<number, string>();
  const stubborn = new Set<number>();
  const psFailsFor = new Set<number>();
  /** Every tool or orphan-CLI pgid that received a signal. */
  const signalled: number[] = [];
  let snapshots = 0;
  let failSnapshots = 0;

  const cliAlive = (pgid: number): boolean => fakes.isGroupAlive(pgid) || orphanClis.has(pgid);
  const killGroup = (pgid: number, signal: NodeJS.Signals): boolean => {
    if (fakes.children.has(pgid)) return (fakes.deps.killGroup as (p: number, s: NodeJS.Signals) => boolean)(pgid, signal);
    if (orphanClis.has(pgid)) {
      signalled.push(pgid);
      orphanClis.delete(pgid);
      return true;
    }
    const members = [...tools.values()].filter((p) => p.pgid === pgid);
    if (members.length === 0) return false;
    signalled.push(pgid);
    if (!stubborn.has(pgid)) for (const m of members) tools.delete(m.pid);
    return true;
  };
  const isGroupAlive = (pgid: number): boolean => cliAlive(pgid) || [...tools.values()].some((p) => p.pgid === pgid);
  const readGroupLeader = (pgid: number): GroupLeader => {
    if (psFailsFor.has(pgid)) throw new LeaderProbeError(`ps failed for pid ${pgid}`);
    if (fakes.isGroupAlive(pgid)) return { status: "present", command: CLI_PATH, startedAtMs: T0 };
    const orphan = orphanClis.get(pgid);
    if (orphan !== undefined) return { status: "present", command: orphan, startedAtMs: T0 };
    const p = tools.get(pgid);
    return p === undefined ? { status: "absent" } : { status: "present", command: p.command, startedAtMs: p.startedAtMs };
  };
  const snapshotProcesses = async (): Promise<ProcessEntry[]> => {
    snapshots++;
    if (failSnapshots > 0) {
      failSnapshots--;
      throw new LeaderProbeError("ps -A failed");
    }
    const clis: ProcessEntry[] = [
      ...[...fakes.children.values()].filter((c) => !c.exited).map((c) => c.pid),
      ...orphanClis.keys(),
    ].map((pid) => ({ pid, ppid: 1, pgid: pid, startedAtMs: T0, command: orphanClis.get(pid) ?? CLI_PATH }));
    return [...clis, ...tools.values()];
  };
  const manager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" } },
    { ...fakes.deps, killGroup, isGroupAlive, readGroupLeader, snapshotProcesses, schedule: immediate, ...o.deps },
  );
  /** The Bash tool's shape: a shell in a NEW session and group (its pid is the pgid), running `sleep`. */
  const startTool = (cliPid: number, shell = SHELL, sleep = SLEEP): void => {
    tools.set(shell, { pid: shell, ppid: cliPid, pgid: shell, startedAtMs: T1, command: "/bin/zsh" });
    tools.set(sleep, { pid: sleep, ppid: shell, pgid: shell, startedAtMs: T1, command: "/bin/sleep" });
  };
  return {
    store,
    manager,
    fakes,
    tools,
    orphanClis,
    stubborn,
    psFailsFor,
    signalled,
    startTool,
    snapshots: () => snapshots,
    failNextSnapshots: (n: number) => {
      failSnapshots = n;
    },
  };
}

interface GroupRowView {
  session_id: number;
  pgid: number;
  leader_command: string;
  leader_started_at: string;
  kill_incomplete_at: string | null;
  resolved_at: string | null;
  resolution: string | null;
}

function groupRows(store: Store, sessionId: number): GroupRowView[] {
  return store
    .prepare<[number], GroupRowView>(
      "SELECT session_id, pgid, leader_command, leader_started_at, kill_incomplete_at, resolved_at, resolution FROM session_groups WHERE session_id = ? ORDER BY pgid",
    )
    .all(sessionId);
}

function eventsOf(store: Store, sessionId: number, kind: string): Record<string, unknown>[] {
  return store
    .prepare<[number, string], string>("SELECT payload_json FROM events WHERE session_id = ? AND kind = ? ORDER BY id")
    .pluck()
    .all(sessionId, kind)
    .map((p) => JSON.parse(p) as Record<string, unknown>);
}

/** A session row left by a dead kernel. */
function orphanRow(store: Store, status: string, pgid: number | null, leaderStartedAt: string | null = iso(T0)): number {
  return Number(
    store
      .prepare("INSERT INTO sessions (agent, sdk_session_id, status, pgid, leader_started_at) VALUES ('wright', 'sdk-1', ?, ?, ?)")
      .run(status, pgid, leaderStartedAt).lastInsertRowid,
  );
}

/** A group the dead kernel had recorded. */
function recordGroup(store: Store, sessionId: number, pgid: number, command: string, startedAtMs: number, flagged = false): void {
  store
    .prepare(
      "INSERT INTO session_groups (session_id, pgid, leader_command, leader_started_at, first_seen, kill_incomplete_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(sessionId, pgid, command, iso(startedAtMs), "2026-01-01T00:00:00.000Z", flagged ? iso(T1) : null);
}

describe("parseProcessTable", () => {
  it("reads pid, ppid, pgid, the UTC lstart and a comm with spaces (comm is last)", () => {
    const text = [
      "    1     0     1 Mon Oct  5 19:10:49 2026     /sbin/launchd",
      "  812   811   812 Tue Oct  6 07:53:35 2026     /Applications/Some App.app/Contents/MacOS/Some App",
      "",
      "99999     1 99999 Wed Dec 31 23:59:59 2025 sleep",
    ].join("\n");
    expect(parseProcessTable(text)).toEqual([
      { pid: 1, ppid: 0, pgid: 1, startedAtMs: Date.UTC(2026, 9, 5, 19, 10, 49), command: "/sbin/launchd" },
      {
        pid: 812,
        ppid: 811,
        pgid: 812,
        startedAtMs: Date.UTC(2026, 9, 6, 7, 53, 35),
        command: "/Applications/Some App.app/Contents/MacOS/Some App",
      },
      { pid: 99999, ppid: 1, pgid: 99999, startedAtMs: Date.UTC(2025, 11, 31, 23, 59, 59), command: "sleep" },
    ]);
  });

  it.each([
    ["a localized lstart", "  812   811   812 mar. oct.  6 07:53:35 2026 /bin/zsh"],
    ["a missing pgid", "  812   811 Tue Oct  6 07:53:35 2026 /bin/zsh"],
    ["no comm", "  812   811   812 Tue Oct  6 07:53:35 2026"],
    ["an unknown month", "  812   811   812 Tue Okt  6 07:53:35 2026 /bin/zsh"],
  ])("refuses %s rather than half-reading the table", (_, line) => {
    expect(() => parseProcessTable(`    1     0     1 Mon Oct  5 19:10:49 2026 /sbin/launchd\n${line}\n`)).toThrow(LeaderProbeError);
  });
});

describe("descendantGroups", () => {
  const p = (pid: number, ppid: number, pgid: number, command: string, startedAtMs = T1): ProcessEntry => ({ pid, ppid, pgid, startedAtMs, command });
  const CLI = 500;

  it("finds a group across a new session: leader → shell in a new group → command; never the CLI's own group", () => {
    const table = [
      p(1, 0, 1, "/sbin/launchd"),
      p(CLI, 400, CLI, CLI_PATH, T0),
      p(501, CLI, CLI, "/bin/sh"), // background shell in the CLI's own group
      p(600, CLI, 600, "/bin/zsh"), // the Bash tool: new session and group
      p(601, 600, 600, "/bin/sleep"),
      p(700, 601, 700, "/usr/bin/python3"), // a grandchild that made its own group again
      p(800, 1, 800, "/usr/bin/unrelated"),
    ];
    expect(descendantGroups(table, CLI)).toEqual([p(600, CLI, 600, "/bin/zsh"), p(700, 601, 700, "/usr/bin/python3")]);
  });

  it("does not return a group whose leader is not in the snapshot (it could never be ownership-checked)", () => {
    const table = [p(CLI, 400, CLI, CLI_PATH, T0), p(601, CLI, 600, "/bin/sleep")];
    expect(descendantGroups(table, CLI)).toEqual([]);
  });

  it("returns nothing for a leader that is not in the table", () => {
    expect(descendantGroups([p(600, 1, 600, "/bin/zsh")], CLI)).toEqual([]);
  });
});

describe("the tool-group poll", () => {
  it("records each new descendant group once, committed, while the CLI runs; and stops when the attempt ends", async () => {
    const env = setup();
    const handle = await env.manager.startSession(startParams(tmp));
    const cli = handle.pgid as number;
    env.startTool(cli);
    await vi.waitFor(() => expect(groupRows(env.store, handle.id)).toHaveLength(1));
    // Seen again on later ticks: still one row and one event.
    const seen = env.snapshots();
    await vi.waitFor(() => expect(env.snapshots()).toBeGreaterThan(seen + 2));
    expect(groupRows(env.store, handle.id)).toEqual([
      {
        session_id: handle.id,
        pgid: SHELL,
        leader_command: "/bin/zsh",
        leader_started_at: iso(T1),
        kill_incomplete_at: null,
        resolved_at: null,
        resolution: null,
      },
    ]);
    expect(eventsOf(env.store, handle.id, "session_group_recorded")).toEqual([
      { pgid: SHELL, command: "/bin/zsh", leader_started_at: iso(T1) },
    ]);

    // The session ends: the poll stops (no further snapshot).
    env.fakes.calls[0]?.stream.end();
    await handle.done;
    const after = env.snapshots();
    await flush(20);
    expect(env.snapshots()).toBe(after);
  });

  it("records nothing from a failed snapshot, and tries again on the next tick", async () => {
    const env = setup();
    env.failNextSnapshots(3);
    const handle = await env.manager.startSession(startParams(tmp));
    env.startTool(handle.pgid as number);
    await vi.waitFor(() => expect(groupRows(env.store, handle.id)).toHaveLength(1));
    expect(env.snapshots()).toBeGreaterThan(3);
    await env.manager.stopSession(handle.id);
  });
});

describe("stop, the kill switch and a natural end kill recorded groups (B2)", () => {
  async function runningWithTool() {
    const env = setup();
    const handle = await env.manager.startSession(startParams(tmp));
    env.startTool(handle.pgid as number);
    await vi.waitFor(() => expect(groupRows(env.store, handle.id)).toHaveLength(1));
    return { ...env, handle };
  }

  function expectToolGroupKilled(env: Awaited<ReturnType<typeof runningWithTool>>): void {
    expect(env.signalled).toContain(SHELL);
    expect(env.tools.size).toBe(0);
    expect(eventsOf(env.store, env.handle.id, "session_group_killed")).toEqual([
      { pgid: SHELL, command: "/bin/zsh", leader_started_at: iso(T1) },
    ]);
    expect(groupRows(env.store, env.handle.id)[0]).toMatchObject({ resolution: "killed", kill_incomplete_at: null });
  }

  it("stopSession kills the CLI's group and the tool's group", async () => {
    const env = await runningWithTool();
    expect(await env.manager.stopSession(env.handle.id)).toBe("stopped");
    expect(env.fakes.allGroupsGone()).toBe(true);
    expectToolGroupKilled(env);
  });

  it.each(["stop", "shutdown"] as const)("the kill switch (stopAll, %s mode) kills the tool's group", async (mode) => {
    const env = await runningWithTool();
    const [outcome] = await env.manager.stopAll({ mode });
    expect(outcome?.status).toBe(mode === "stop" ? "stopped" : "interrupted");
    expectToolGroupKilled(env);
  });

  it("a natural end kills the tool group left behind", async () => {
    const env = await runningWithTool();
    env.fakes.calls[0]?.stream.end();
    await env.handle.done;
    expectToolGroupKilled(env);
  });

  it("a stop records and kills a group its tools started since the last poll tick", async () => {
    // A poll that never ticks on its own: only the stop's own walk sees the tool.
    const env = setup({ deps: { schedule: (fn, ms) => (ms === 1_000 ? () => {} : immediate(fn, ms)) } });
    const handle = await env.manager.startSession(startParams(tmp));
    env.startTool(handle.pgid as number);
    expect(groupRows(env.store, handle.id)).toHaveLength(0);
    await env.manager.stopSession(handle.id);
    expect(env.signalled).toContain(SHELL);
    expect(groupRows(env.store, handle.id)[0]).toMatchObject({ pgid: SHELL, resolution: "killed" });
  });
});

describe("a recorded tool group a kill cannot settle is never reported stopped (invariant 3)", () => {
  async function runningWithTool() {
    const env = setup();
    const handle = await env.manager.startSession(startParams(tmp));
    env.startTool(handle.pgid as number);
    await vi.waitFor(() => expect(groupRows(env.store, handle.id)).toHaveLength(1));
    return { ...env, handle };
  }

  const status = (env: ReturnType<typeof setup>) =>
    readStatus(env.store, [], new Date(T1), { startedAt: new Date(T0), pid: 4242, dayOf: () => "2026-10-06" }).kill_unconfirmed;

  /** The session's own `session_status` events, newest last. */
  const statusEvents = (env: ReturnType<typeof setup>, id: number) => eventsOf(env.store, id, "session_status");

  it.each([
    ["its kill gives up (stubborn)", (env: ReturnType<typeof setup>) => env.stubborn.add(SHELL), "session_group_kill_incomplete"],
    ["ps fails for its leader", (env: ReturnType<typeof setup>) => env.psFailsFor.add(SHELL), "session_group_skipped"],
  ] as const)("kill switch, %s: not confirmed stopped, listed under kill_unconfirmed until a later reap settles it", async (_, arrange, kind) => {
    const env = await runningWithTool();
    arrange(env);
    const outcomes = await env.manager.stopAll();
    // The CLI's group is gone, yet the session is not `stopped`.
    expect(env.fakes.allGroupsGone()).toBe(true);
    expect(outcomes).toEqual([{ id: env.handle.id, status: "failed" }]);
    // The stop's kill, then the stream's own cleanup retries the unsettled group once more.
    expect(eventsOf(env.store, env.handle.id, kind).length).toBeGreaterThan(0);
    expect(statusEvents(env, env.handle.id).at(-1)).toMatchObject({
      to: "failed",
      reason: "kill_incomplete",
      cause: { to: "stopped", reason: "stop_requested" },
      tool_groups_unsettled: true,
    });
    const summary = summarizeStopAll(outcomes);
    expect(summary.confirmed).toBe(false);
    expect(summary.text).toContain(`1 not confirmed stopped (#${env.handle.id} failed)`);
    // The session's own flag is keyed on the CLI's (gone) group: only the tool group's flag lists it.
    expect(env.manager.getSession(env.handle.id)?.kill_incomplete_at).toBeNull();
    const [row] = groupRows(env.store, env.handle.id);
    expect(status(env)).toEqual([
      {
        id: env.handle.id,
        agent: "wright",
        status: "failed",
        pgid: env.handle.pgid,
        kill_incomplete_at: row?.kill_incomplete_at,
        tool_groups: [{ pgid: SHELL, command: "/bin/zsh", kill_incomplete_at: row?.kill_incomplete_at }],
      },
    ]);

    // The next reap kills it: the session leaves the list, and its terminal status is kept.
    env.stubborn.clear();
    env.psFailsFor.clear();
    expect(await env.manager.reapOrphans()).toEqual([]);
    expect(groupRows(env.store, env.handle.id)[0]).toMatchObject({ resolution: "killed", kill_incomplete_at: null });
    expect(status(env)).toEqual([]);
    expect(env.manager.getSession(env.handle.id)?.status).toBe("failed");
  });

  it.each([
    // The fake stream ends without a result: its own outcome would be `failed` (`ended_without_result`).
    ["stopSession", { to: "stopped", reason: "stop_requested" }],
    ["a natural end", { to: "failed", reason: "ended_without_result" }],
  ] as const)("%s with a stubborn tool group ends failed (kill_incomplete), its own outcome only the cause", async (how, cause) => {
    const env = await runningWithTool();
    env.stubborn.add(SHELL);
    if (how === "stopSession") {
      expect(await env.manager.stopSession(env.handle.id)).toBe("failed");
    } else {
      env.fakes.calls[0]?.stream.end();
      expect(await env.handle.done).toBe("failed");
    }
    expect(statusEvents(env, env.handle.id).at(-1)).toMatchObject({
      reason: "kill_incomplete",
      cause,
      tool_groups_unsettled: true,
    });
    expect(status(env).map((r) => r.id)).toEqual([env.handle.id]);
  });

  it("an abandoned row's flagged tool groups are not listed (never signalled again)", () => {
    const env = setup();
    const id = orphanRow(env.store, "abandoned", ORPHAN_CLI);
    recordGroup(env.store, id, SHELL, "/bin/zsh", T1, true);
    expect(status(env)).toEqual([]);
  });

  it("a session whose groups are all settled is stopped and not listed", async () => {
    const env = await runningWithTool();
    expect(await env.manager.stopAll()).toEqual([{ id: env.handle.id, status: "stopped" }]);
    expect(status(env)).toEqual([]);
  });
});

describe("the ownership check never signals a pgid that is not the recorded group (B2)", () => {
  async function stoppedWith(change: (env: ReturnType<typeof setup>) => void) {
    const env = setup();
    const handle = await env.manager.startSession(startParams(tmp));
    env.startTool(handle.pgid as number);
    await vi.waitFor(() => expect(groupRows(env.store, handle.id)).toHaveLength(1));
    // The pgid changes hands after the last record.
    change(env);
    await env.manager.stopSession(handle.id);
    return { env, handle };
  }

  it.each([
    [
      "command_differs",
      (env: ReturnType<typeof setup>) => {
        env.tools.clear();
        env.tools.set(SHELL, { pid: SHELL, ppid: 1, pgid: SHELL, startedAtMs: T1, command: "/usr/bin/vim" });
      },
    ],
    [
      "start_differs",
      (env: ReturnType<typeof setup>) => {
        env.tools.clear();
        env.tools.set(SHELL, { pid: SHELL, ppid: 1, pgid: SHELL, startedAtMs: T1 + 60_000, command: "/bin/zsh" });
      },
    ],
    [
      "leader_gone",
      (env: ReturnType<typeof setup>) => {
        env.tools.delete(SHELL);
        // `sleep` lives on in the group, re-parented: nothing proves the pgid is still the session's.
        env.tools.set(SLEEP, { pid: SLEEP, ppid: 1, pgid: SHELL, startedAtMs: T1, command: "/bin/sleep" });
      },
    ],
  ])("a reused pgid (%s) is skipped, recorded and never signalled", async (reason, change) => {
    const { env, handle } = await stoppedWith(change);
    expect(env.signalled).not.toContain(SHELL);
    expect(env.tools.size).toBeGreaterThan(0);
    expect(eventsOf(env.store, handle.id, "session_group_skipped")).toEqual([
      { pgid: SHELL, command: "/bin/zsh", leader_started_at: iso(T1), reason },
    ]);
    expect(eventsOf(env.store, handle.id, "session_group_killed")).toEqual([]);
    // Settled for good: never examined again.
    expect(groupRows(env.store, handle.id)[0]).toMatchObject({ resolution: reason, kill_incomplete_at: null });
  });

  it("a failed ps skips the group unsignalled and keeps it flagged for the next reap", async () => {
    const { env, handle } = await stoppedWith((e) => e.psFailsFor.add(SHELL));
    expect(env.signalled).not.toContain(SHELL);
    const [skip] = eventsOf(env.store, handle.id, "session_group_skipped");
    expect(skip).toMatchObject({ pgid: SHELL, reason: "ps_failed" });
    expect(groupRows(env.store, handle.id)[0]).toMatchObject({ resolved_at: null });
    expect(groupRows(env.store, handle.id)[0]?.kill_incomplete_at).not.toBeNull();

    // `ps` works again: the next reap checks it and kills it.
    env.psFailsFor.clear();
    expect(await env.manager.reapOrphans()).toEqual([]);
    expect(env.signalled).toContain(SHELL);
    expect(groupRows(env.store, handle.id)[0]).toMatchObject({ resolution: "killed", kill_incomplete_at: null });
  });
});

describe("the reaper kills recorded groups (B3)", () => {
  it("a live orphaned CLI: walks its descendants once more, records the new group, then kills the CLI and every recorded group", async () => {
    const env = setup();
    env.orphanClis.set(ORPHAN_CLI, CLI_PATH);
    const id = orphanRow(env.store, "running", ORPHAN_CLI);
    // Recorded by the dead kernel.
    recordGroup(env.store, id, OTHER_GROUP, "/usr/bin/python3", T1);
    env.tools.set(OTHER_GROUP, { pid: OTHER_GROUP, ppid: 1, pgid: OTHER_GROUP, startedAtMs: T1, command: "/usr/bin/python3" });
    // Started after the dead kernel's last poll: found only by the reaper's walk.
    env.startTool(ORPHAN_CLI);

    expect(await env.manager.reapOrphans()).toEqual([{ sessionId: id, pgid: ORPHAN_CLI, status: "interrupted", reason: "group_killed" }]);
    expect(env.signalled).toEqual([ORPHAN_CLI, OTHER_GROUP, SHELL]);
    expect(env.tools.size).toBe(0);
    expect(groupRows(env.store, id).map((g) => [g.pgid, g.resolution])).toEqual([
      [SHELL, "killed"],
      [OTHER_GROUP, "killed"],
    ]);
    expect(eventsOf(env.store, id, "session_group_recorded")).toEqual([{ pgid: SHELL, command: "/bin/zsh", leader_started_at: iso(T1) }]);
  });

  it.each([
    ["group_gone", ORPHAN_CLI, undefined],
    ["no_pgid", null, undefined],
    ["pgid_reused", ORPHAN_CLI, "/usr/bin/vim"],
  ] as const)("the CLI already exited (%s): its recorded groups are still killed, after the ownership check", async (reason, pgid, foreign) => {
    const env = setup();
    if (foreign !== undefined) env.orphanClis.set(ORPHAN_CLI, foreign);
    const id = orphanRow(env.store, "running", pgid);
    recordGroup(env.store, id, SHELL, "/bin/zsh", T1);
    recordGroup(env.store, id, OTHER_GROUP, "/usr/bin/python3", T1);
    env.startTool(1);
    // OTHER_GROUP's pgid now names an unrelated process.
    env.tools.set(OTHER_GROUP, { pid: OTHER_GROUP, ppid: 1, pgid: OTHER_GROUP, startedAtMs: T1 + 3_600_000, command: "/usr/bin/python3" });

    expect(await env.manager.reapOrphans()).toEqual([{ sessionId: id, pgid, status: "interrupted", reason }]);
    expect(env.signalled).toEqual([SHELL]);
    expect(env.tools.has(OTHER_GROUP)).toBe(true);
    expect(groupRows(env.store, id).map((g) => [g.pgid, g.resolution])).toEqual([
      [SHELL, "killed"],
      [OTHER_GROUP, "start_differs"],
    ]);
  });

  it("a recorded group that survives its kill stays flagged although the CLI's group is gone; the next reap retries and kills it", async () => {
    const env = setup();
    const id = orphanRow(env.store, "running", ORPHAN_CLI);
    recordGroup(env.store, id, SHELL, "/bin/zsh", T1);
    env.startTool(1);
    env.stubborn.add(SHELL);

    expect(await env.manager.reapOrphans()).toEqual([{ sessionId: id, pgid: ORPHAN_CLI, status: "interrupted", reason: "group_gone" }]);
    expect(eventsOf(env.store, id, "session_group_kill_incomplete")).toHaveLength(1);
    expect(groupRows(env.store, id)[0]).toMatchObject({ resolved_at: null });
    expect(groupRows(env.store, id)[0]?.kill_incomplete_at).not.toBeNull();

    // The row is `interrupted` now (never re-reaped as an orphan), but the flagged group is retried.
    env.stubborn.clear();
    expect(await env.manager.reapOrphans()).toEqual([]);
    expect(env.tools.size).toBe(0);
    expect(eventsOf(env.store, id, "session_group_killed")).toHaveLength(1);
    expect(groupRows(env.store, id)[0]).toMatchObject({ resolution: "killed", kill_incomplete_at: null });

    // Settled: a later reap leaves it alone.
    const signals = env.signalled.length;
    await env.manager.reapOrphans();
    expect(env.signalled).toHaveLength(signals);
  });

  it("an abandoned row's recorded groups are never signalled, even flagged", async () => {
    const env = setup();
    const id = orphanRow(env.store, "abandoned", ORPHAN_CLI);
    recordGroup(env.store, id, SHELL, "/bin/zsh", T1, true);
    env.startTool(1);
    expect(await env.manager.reapOrphans()).toEqual([]);
    expect(env.signalled).toEqual([]);
    expect(eventsOf(env.store, id, "session_group_skipped")).toEqual([]);
  });
});
