// Real POSIX process groups started by `spawnInNewProcessGroup` running
// /bin/sh — no SDK and no model. Every group a test starts is SIGKILLed in
// afterEach, and "gone" is always polled for (ESRCH) with a deadline: a
// backgrounded child is reparented and reaped asynchronously, and a killed
// leader stays a zombie until Node reaps it. On macOS a group holding only
// an unreaped zombie answers kill(-pgid, …) with EPERM (probed 2026-10-02),
// so EPERM here means "not gone yet", never "gone".
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthProvider } from "../src/auth/index.js";
import {
  SessionManager,
  StderrTail,
  isProcessGroupAlive,
  killProcessGroup,
  leaderBasename,
  readGroupLeaderCommand,
  spawnInNewProcessGroup,
} from "../src/sessions/index.js";
import type { QueryFn } from "../src/sessions/index.js";
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
  for (const pgid of groups.splice(0)) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "ESRCH" && code !== "EPERM") throw err;
    }
    await waitGone(pgid);
  }
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
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

describe("process-group primitives", () => {
  it("refuses to signal pgid 0, 1, negatives and non-integers", () => {
    for (const bad of [0, 1, -1, -42, 1.5, Number.NaN]) {
      expect(() => killProcessGroup(bad, "SIGKILL")).toThrow(RangeError);
      expect(() => isProcessGroupAlive(bad)).toThrow(RangeError);
      expect(() => readGroupLeaderCommand(bad)).toThrow(RangeError);
    }
  });

  it("reports a gone group as not alive, and killing it as false", async () => {
    const pgid = startGroup("sleep 60");
    expect(killProcessGroup(pgid, "SIGKILL")).toBe(true);
    expect(await waitGone(pgid)).toBe(true);
    expect(isProcessGroupAlive(pgid)).toBe(false);
    expect(killProcessGroup(pgid, "SIGKILL")).toBe(false);
    expect(readGroupLeaderCommand(pgid)).toBeUndefined();
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
  function insertRunning(store: Store, pgid: number): number {
    return Number(
      store
        .prepare("INSERT INTO sessions (agent, status, pgid, sdk_session_id) VALUES ('wright', 'running', ?, 'sid')")
        .run(pgid).lastInsertRowid,
    );
  }

  it("kills a live group led by claude and marks the row interrupted (group_killed)", async () => {
    const store = openStore();
    const pgid = startGroup("sleep 60");
    const id = insertRunning(store, pgid);
    const manager = new SessionManager(
      { store, authProvider: provider, loomwrightPath: pluginDir },
      { readGroupLeaderCommand: () => "/Users/someone/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude" },
    );
    expect(manager.reapOrphans()).toEqual([{ sessionId: id, pgid, reason: "group_killed" }]);
    expect(await waitGone(pgid)).toBe(true);
    expect(manager.getSession(id)?.status).toBe("interrupted");
  }, 10_000);

  it("leaves a live group whose leader is not claude alone (pgid_reused)", () => {
    const store = openStore();
    const pgid = startGroup("sleep 60");
    const leader = readGroupLeaderCommand(pgid);
    expect(leader).toBeDefined();
    // A shell may exec a single -c command in place, so never pin `sh`.
    expect(leaderBasename(leader as string)).not.toBe("claude");
    const id = insertRunning(store, pgid);
    const manager = new SessionManager({ store, authProvider: provider, loomwrightPath: pluginDir });
    expect(manager.reapOrphans()).toEqual([{ sessionId: id, pgid, reason: "pgid_reused" }]);
    expect(isProcessGroupAlive(pgid)).toBe(true);
    expect(manager.getSession(id)?.status).toBe("interrupted");
  });
});
