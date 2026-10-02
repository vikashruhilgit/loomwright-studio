// Real POSIX process groups started by `spawnInNewProcessGroup` running
// /bin/sh — no SDK and no model. Every group a test starts is killed until
// gone in afterEach (a test fails if one survives the deadline), and "gone" is
// always polled for (ESRCH) with a deadline: a backgrounded child is
// reparented and reaped asynchronously, and a killed leader stays a zombie
// until Node reaps it. On macOS a group holding only an unreaped zombie, or
// one racing a fork, answers kill(-pgid, …) with EPERM (probed 2026-10-02),
// so EPERM here means "not gone yet", never "gone". One SIGKILL can miss a
// child forked during it, so cleanup re-sends SIGKILL until ESRCH.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthProvider } from "../src/auth/index.js";
import {
  LeaderProbeError,
  SessionManager,
  StderrTail,
  isProcessGroupAlive,
  killGroupUntilGone,
  killProcessGroup,
  leaderBasename,
  parseLeaderLine,
  readGroupLeader,
  spawnInNewProcessGroup,
} from "../src/sessions/index.js";
import type { GroupLeader, QueryFn } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";

const GONE_DEADLINE_MS = 2_000;

let tmp: string;
let pluginDir: string;
const stores: Store[] = [];
const groups: number[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-pgroup-"));
  pluginDir = join(tmp, "loomwright");
  mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), "{}\n");
});

afterEach(async () => {
  const survivors: number[] = [];
  for (const pgid of groups.splice(0)) {
    if (!(await killUntilGone(pgid))) survivors.push(pgid);
  }
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
  if (survivors.length > 0) throw new Error(`process groups survived cleanup: ${survivors.join(", ")}`);
});

function groupSignal0(pgid: number): "alive" | "ESRCH" | "EPERM" {
  try {
    process.kill(-pgid, 0);
    return "alive";
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ESRCH" || code === "EPERM") return code;
    throw err;
  }
}

/**
 * The tests' own cleanup, independent of the code under test: SIGKILL the
 * group, then every 25 ms re-send SIGKILL until `kill(-pgid, 0)` throws ESRCH.
 * `false` when the group outlives the deadline.
 */
async function killUntilGone(pgid: number, deadlineMs = GONE_DEADLINE_MS): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ESRCH") return true;
      if (code !== "EPERM") throw err;
    }
    if (groupSignal0(pgid) === "ESRCH") return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Block this thread for `ms` (fractional) milliseconds; the child runs on regardless. */
function blockFor(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Poll until `kill(-pgid, 0)` throws ESRCH; never assert it once. */
async function waitGone(pgid: number, deadlineMs = GONE_DEADLINE_MS): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    if (groupSignal0(pgid) === "ESRCH") return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return groupSignal0(pgid) === "ESRCH";
}

function spawnOptions(script: string, signal: AbortSignal = new AbortController().signal): SpawnOptions {
  return { command: "/bin/sh", args: ["-c", script], cwd: tmp, env: { PATH: "/usr/bin:/bin" }, signal };
}

/** Start a real group and register it for cleanup. */
function startGroup(script: string, signal?: AbortSignal, tail?: StderrTail): number {
  let pgid: number | undefined;
  const child = spawnInNewProcessGroup(spawnOptions(script, signal), {
    onSpawn: (p) => {
      pgid = p;
    },
    stderrTail: tail,
  });
  if (pgid === undefined) throw new Error("onSpawn was not called");
  groups.push(pgid);
  expect(pgid).toBe(child.pid);
  return pgid;
}

function openStore(): Store {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  return store;
}

const provider: AuthProvider = {
  id: "stub-provider",
  account: "owner@example.test",
  buildEnv: () => ({ PATH: "/usr/bin:/bin" }),
  health: () => ({ status: "ok" }),
};

describe("spawnInNewProcessGroup", () => {
  it("makes the child the leader of a new process group, reporting the pgid synchronously", () => {
    const pgid = startGroup("sleep 60 & sleep 60");
    const psPgid = execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(pgid)], { encoding: "utf8" }).trim();
    expect(Number(psPgid)).toBe(pgid);
    expect(pgid).not.toBe(Number(execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], { encoding: "utf8" }).trim()));
    expect(isProcessGroupAlive(pgid)).toBe(true);
  });

  it("drains stderr into the tail buffer", async () => {
    const tail = new StderrTail();
    startGroup("echo kernel-stderr-probe >&2; sleep 60", undefined, tail);
    const until = Date.now() + GONE_DEADLINE_MS;
    while (!tail.text().includes("kernel-stderr-probe") && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    expect(tail.text()).toContain("kernel-stderr-probe");
  });

  it("kills the whole group when the SDK's forwarded signal aborts", async () => {
    const controller = new AbortController();
    const pgid = startGroup("sleep 60 & sleep 60", controller.signal);
    controller.abort();
    expect(await waitGone(pgid)).toBe(true);
  });
});

describe("killGroupUntilGone", () => {
  // Regression: one kill(-pgid, SIGKILL) racing the shell's fork of the second
  // `sleep` misses the new child, which survives in the dead group (macOS,
  // probed 2026-10-02: 7 of 600 at 3.9–4.6 ms). Sweep the kill delay across
  // the fork window; no member may survive.
  it("leaves no member of a forking group alive, at any kill delay from 0 to 10 ms", async () => {
    let swept = 0;
    for (let delay = 0; delay <= 10; delay += 0.25) {
      for (let i = 0; i < 2; i++) {
        const pgid = startGroup("sleep 3 & sleep 3");
        blockFor(delay);
        expect(await killGroupUntilGone(pgid)).toBe(true);
        // A survivor would keep the group alive; give a straggler time to show.
        await new Promise((r) => setTimeout(r, 5));
        expect(groupSignal0(pgid)).toBe("ESRCH");
        swept++;
      }
    }
    expect(swept).toBe(82);
  }, 30_000);

  it("re-sends SIGKILL while the group answers, treats EPERM as not gone, and gives up at the deadline", async () => {
    const signals: string[] = [];
    let probes = 0;
    const gone = await killGroupUntilGone(4242, {
      kill: (_p, signal) => {
        signals.push(signal);
        if (signals.length === 2) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
        return true;
      },
      isAlive: () => ++probes < 4,
      sleep: async () => {},
    });
    expect(gone).toBe(true);
    expect(signals).toEqual(["SIGKILL", "SIGKILL", "SIGKILL", "SIGKILL"]);

    let kills = 0;
    const survived = await killGroupUntilGone(4242, {
      deadlineMs: 100,
      intervalMs: 25,
      kill: () => {
        kills++;
        return true;
      },
      isAlive: () => true,
      sleep: async () => {},
    });
    expect(survived).toBe(false);
    expect(kills).toBe(5);
  });

  it("stops at the first ESRCH and rethrows any other error", async () => {
    let kills = 0;
    expect(
      await killGroupUntilGone(4242, {
        kill: () => {
          kills++;
          return false;
        },
        isAlive: () => true,
        sleep: async () => {},
      }),
    ).toBe(true);
    expect(kills).toBe(1);
    await expect(
      killGroupUntilGone(4242, {
        kill: () => {
          throw Object.assign(new Error("EINVAL"), { code: "EINVAL" });
        },
        sleep: async () => {},
      }),
    ).rejects.toThrow("EINVAL");
  });
});

describe("process-group primitives", () => {
  it("refuses to signal pgid 0, 1, negatives and non-integers", async () => {
    for (const bad of [0, 1, -1, -42, 1.5, Number.NaN]) {
      expect(() => killProcessGroup(bad, "SIGKILL")).toThrow(RangeError);
      expect(() => isProcessGroupAlive(bad)).toThrow(RangeError);
      expect(() => readGroupLeader(bad)).toThrow(RangeError);
      await expect(killGroupUntilGone(bad)).rejects.toThrow(RangeError);
    }
  });

  it("reports a gone group as not alive, killing it as false, and its leader as absent", async () => {
    const pgid = startGroup("sleep 60");
    expect(await killGroupUntilGone(pgid)).toBe(true);
    expect(await waitGone(pgid)).toBe(true);
    expect(isProcessGroupAlive(pgid)).toBe(false);
    expect(killProcessGroup(pgid, "SIGKILL")).toBe(false);
    // ps positively reports no such process (exit 1, no output): `absent`, not an error.
    expect(readGroupLeader(pgid)).toEqual({ status: "absent" });
  });

  it("reads a live leader's command and start time", () => {
    const before = Date.now();
    const pgid = startGroup("sleep 60");
    const leader = readGroupLeader(pgid);
    if (leader.status !== "present") throw new Error("leader not present");
    expect(leader.command.length).toBeGreaterThan(0);
    // `lstart` has 1 s resolution.
    expect(leader.startedAtMs).toBeGreaterThanOrEqual(Math.floor(before / 1_000) * 1_000 - 1_000);
    expect(leader.startedAtMs).toBeLessThanOrEqual(Date.now() + 1_000);
  });

  it("parses macOS and procps ps lines, and refuses anything else", () => {
    expect(parseLeaderLine("Fri Oct  2 05:30:54 2026     /Users/x/claude-agent-sdk/claude\n")).toEqual({
      command: "/Users/x/claude-agent-sdk/claude",
      startedAtMs: Date.parse("2026-10-02T05:30:54.000Z"),
    });
    expect(parseLeaderLine("Sun Aug 30 00:49:13 2026 claude")).toEqual({
      command: "claude",
      startedAtMs: Date.parse("2026-08-30T00:49:13.000Z"),
    });
    expect(parseLeaderLine("Fri Oct  2 05:30:54 2026 /Applications/My App.app/claude").command).toBe("/Applications/My App.app/claude");
    for (const bad of ["", "claude", "Fri Foo  2 05:30:54 2026 claude", "Fri Oct  2 05:30:54 2026"]) {
      expect(() => parseLeaderLine(bad)).toThrow(LeaderProbeError);
    }
  });

  it("keeps a bounded tail", () => {
    const tail = new StderrTail(8);
    tail.append("0123456789");
    tail.append(Buffer.from("ab"));
    expect(tail.text()).toBe("456789ab");
  });
});

describe("stopSession on a real process group (AC4)", () => {
  it("kills the whole group, leader and background child, and marks the session stopped", async () => {
    const store = openStore();
    let release: () => void = () => {};
    // A fake query whose spawn path runs the REAL spawner with a two-process
    // shell group standing in for the CLI.
    const query: QueryFn = ({ options }) => {
      options.spawnClaudeCodeProcess?.(spawnOptions("sleep 60 & sleep 60", new AbortController().signal));
      const closed = new Promise<void>((r) => {
        release = r;
      });
      const gen = (async function* (): AsyncGenerator<SDKMessage> {
        yield { type: "system", subtype: "init", session_id: "11111111-2222-4333-8444-555555555555" } as unknown as SDKMessage;
        await closed;
      })();
      return Object.assign(gen, { close: () => release() });
    };
    const manager = new SessionManager(
      { store, authProvider: provider, loomwrightPath: pluginDir, stopGraceMs: 300 },
      { query },
    );
    const handle = await manager.startSession({
      agent: "wright",
      prompt: "noop",
      model: "claude-haiku-4-5",
      permissionMode: "default",
      cwd: tmp,
      policy: { allowedTools: [], allowedBashPrefixes: [] },
    });
    const pgid = handle.pgid;
    if (pgid === undefined) throw new Error("no pgid");
    groups.push(pgid);
    expect(manager.getSession(handle.id)?.pgid).toBe(pgid);
    expect(isProcessGroupAlive(pgid)).toBe(true);

    expect(await manager.stopSession(handle.id)).toBe("stopped");
    expect(await waitGone(pgid)).toBe(true);
    expect(() => process.kill(-pgid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    expect(manager.getSession(handle.id)?.status).toBe("stopped");
    expect(await handle.done).toBe("stopped");
  }, 10_000);
});

describe("reapOrphans on a real process group (AC5)", () => {
  function insertRunning(store: Store, pgid: number, leaderStartedAt: string | null): number {
    return Number(
      store
        .prepare("INSERT INTO sessions (agent, status, pgid, sdk_session_id, leader_started_at) VALUES ('wright', 'running', ?, 'sid', ?)")
        .run(pgid, leaderStartedAt).lastInsertRowid,
    );
  }

  /** The real `ps` reading, with the leader's command renamed to the CLI's. */
  const asClaude = (pgid: number): GroupLeader => {
    const leader = readGroupLeader(pgid);
    return leader.status === "present"
      ? { ...leader, command: "/Users/someone/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude" }
      : leader;
  };

  function realStartIso(pgid: number): string {
    const leader = readGroupLeader(pgid);
    if (leader.status !== "present") throw new Error("leader not present");
    return new Date(leader.startedAtMs).toISOString();
  }

  it("kills a live group led by claude with the recorded start time and marks the row interrupted (group_killed)", async () => {
    const store = openStore();
    const pgid = startGroup("sleep 60 & sleep 60");
    const id = insertRunning(store, pgid, realStartIso(pgid));
    const manager = new SessionManager({ store, authProvider: provider, loomwrightPath: pluginDir }, { readGroupLeader: asClaude });
    expect(await manager.reapOrphans()).toEqual([{ sessionId: id, pgid, reason: "group_killed" }]);
    expect(await waitGone(pgid)).toBe(true);
    expect(manager.getSession(id)?.status).toBe("interrupted");
  }, 10_000);

  it("leaves a live claude-led group alone when its start time is not the recorded one (pgid_reused)", async () => {
    const store = openStore();
    const pgid = startGroup("sleep 60");
    // The row was written for an earlier process that held this pgid.
    const earlier = new Date(Date.parse(realStartIso(pgid)) - 30 * 24 * 3_600_000).toISOString();
    const id = insertRunning(store, pgid, earlier);
    const manager = new SessionManager({ store, authProvider: provider, loomwrightPath: pluginDir }, { readGroupLeader: asClaude });
    expect(await manager.reapOrphans()).toEqual([{ sessionId: id, pgid, reason: "pgid_reused" }]);
    expect(isProcessGroupAlive(pgid)).toBe(true);
    expect(manager.getSession(id)?.status).toBe("interrupted");
  });

  it("leaves a live group whose leader is not claude alone (pgid_reused)", async () => {
    const store = openStore();
    const pgid = startGroup("sleep 60");
    const leader = readGroupLeader(pgid);
    if (leader.status !== "present") throw new Error("leader not present");
    // A shell may exec a single -c command in place, so never pin `sh`.
    expect(leaderBasename(leader.command)).not.toBe("claude");
    const id = insertRunning(store, pgid, realStartIso(pgid));
    const manager = new SessionManager({ store, authProvider: provider, loomwrightPath: pluginDir });
    expect(await manager.reapOrphans()).toEqual([{ sessionId: id, pgid, reason: "pgid_reused" }]);
    expect(isProcessGroupAlive(pgid)).toBe(true);
    expect(manager.getSession(id)?.status).toBe("interrupted");
  });
});
