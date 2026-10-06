// The `studio` CLI (item 08, AC4; H07): runCli against a real startApiServer on
// 127.0.0.1 and an OS-assigned port, with an in-memory Keychain. Never the
// real Keychain, the real daemon or a model.
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { API_TOKEN_KEYCHAIN_SERVICE, startApiServer } from "../src/api/index.js";
import type { ApiServer, StatusBody } from "../src/api/index.js";
import type { KeychainReader } from "../src/auth/index.js";
import { CLI_TIMEOUT_MS, STOP_ALL_TIMEOUT_MS, USAGE, formatStatus, readlineConfirm, runCli, summarizeStopAll } from "../src/cli/index.js";
import type { CliDeps } from "../src/cli/index.js";
import { SERVICE_LABEL, plistPath } from "../src/service/index.js";
import type { ServiceDeps } from "../src/service/index.js";
import { Store } from "../src/store/index.js";
import { kernelVersion } from "../src/version.js";
import { DEFAULT_STOP_GRACE_MS, KILL_GROUP_DEADLINE_MS, LEADER_EXIT_WAIT_MS, SessionError, SessionManager } from "../src/sessions/index.js";
import type { AbandonVia } from "../src/sessions/index.js";
import { fakeMsg, fakeSessions, immediate, makePluginDir, startParams, stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = new Date("2026-10-02T10:00:00.000Z");
const exitCodeAtImport = process.exitCode;

let tmp: string;
let dataDir: string;
let store: Store;
let server: ApiServer;
let loop: { start: Mock<() => void>; stop: Mock<() => Promise<void>> };

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "studio-cli-"));
  dataDir = join(tmp, "data");
  store = new Store({ dataDir });
  loop = { start: vi.fn(() => {}), stop: vi.fn(async () => {}) };
  server = await startApiServer(
    {
      store,
      sessions: {
        stopAll: async () => [{ id: 1, status: "stopped" as const }, { id: 2, status: "stopped" as const }],
        abandonSession: unexpectedAbandon,
      },
      loop,
      authProviders: [stubProvider()],
      token: TOKEN,
      port: 0,
    },
    { now: () => NOW, startedAt: new Date(NOW.getTime() - 3_725_000), pid: 4242 },
  );
  writeApiInfo(server.port, 4242);
});

afterEach(async () => {
  await server.close();
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

function writeApiInfo(port: number, pid: number): void {
  writeFileSync(join(dataDir, "api.json"), JSON.stringify({ port, host: "127.0.0.1", pid, started_at: NOW.toISOString() }));
}

function out() {
  const chunks: string[] = [];
  return { chunks, write: (c: string) => chunks.push(c), text: () => chunks.join("") };
}

function cli(overrides: Partial<CliDeps> = {}) {
  const stdout = out();
  const stderr = out();
  const reads: string[] = [];
  const keychain: KeychainReader = {
    read: (service) => {
      reads.push(service);
      return service === API_TOKEN_KEYCHAIN_SERVICE ? TOKEN : undefined;
    },
  };
  const fetchSpy = vi.fn(fetch);
  const deps: CliDeps = { dataDir, keychain, fetch: fetchSpy, isPidAlive: () => true, stdout, stderr, ...overrides };
  return { deps, stdout, stderr, reads, fetchSpy, run: (...argv: string[]) => runCli(argv, deps) };
}

function oneLine(text: string): void {
  expect(text.endsWith("\n")).toBe(true);
  expect(text.trimEnd().split("\n")).toHaveLength(1);
}

describe("studio CLI", () => {
  it("importing the module does not run main (process.exitCode untouched)", () => {
    expect(process.exitCode).toBe(exitCodeAtImport);
  });

  it("status prints a short summary, never the token", async () => {
    store.prepare("INSERT INTO sessions (agent, status, model, pgid, started_at) VALUES ('wright', 'running', 'claude-haiku-4-5', 77, '2026-10-02T09:00:00.000Z')").run();
    const c = cli();
    expect(await c.run("status")).toBe(0);
    const text = c.stdout.text();
    expect(text).toContain("kernel ");
    expect(text).toContain("up 1h 2m");
    expect(text).toContain("kill switch: off");
    expect(text).toContain("auth: stub-provider (owner@example.test): ok");
    expect(text).toContain("sessions: 1 running");
    expect(text).toContain("#1 wright claude-haiku-4-5 running, pgid 77");
    expect(text).toContain("queue: 0 pending events, 0 pending wake-ups");
    expect(text).not.toContain(TOKEN);
    expect(c.stderr.text()).toBe("");
    expect(c.fetchSpy.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:${server.port}/status`);
  });

  it("status --json prints parseable JSON equal to /status", async () => {
    const c = cli();
    expect(await c.run("status", "--json")).toBe(0);
    const direct = await (await fetch(`http://127.0.0.1:${server.port}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    expect(JSON.parse(c.stdout.text())).toEqual(direct);
    expect(c.stdout.text()).not.toContain(TOKEN);
  });

  it("stop --all calls POST /stop-all; resume calls POST /resume", async () => {
    const c = cli();
    expect(await c.run("stop", "--all")).toBe(0);
    expect(c.fetchSpy.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:${server.port}/stop-all`);
    expect(c.fetchSpy.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(c.stdout.text()).toContain("2 sessions stopped");
    expect(loop.stop).toHaveBeenCalledTimes(1);

    expect(await c.run("resume")).toBe(0);
    expect(c.fetchSpy.mock.calls[1]?.[0]).toBe(`http://127.0.0.1:${server.port}/resume`);
    expect(loop.start).toHaveBeenCalledTimes(1);
    const kinds = store.prepare<[], string>("SELECT kind FROM events ORDER BY id").pluck().all();
    expect(kinds).toEqual(["kill_switch_engaged", "stop_all_completed", "kill_switch_released"]);
    expect(c.stdout.text()).not.toContain(TOKEN);
  });

  it("stop --all with mixed outcomes counts only stopped as stopped and exits 1", async () => {
    await server.close();
    server = await startApiServer(
      {
        store,
        sessions: {
          stopAll: async () => [
            { id: 1, status: "stopped" as const },
            { id: 2, status: "failed" as const },
            { id: 3, status: "stop_failed" as const, error: "boom" },
            { id: 4, status: "completed" as const },
            { id: 5, status: "failed:auth" as const },
          ],
          abandonSession: unexpectedAbandon,
        },
        loop,
        authProviders: [stubProvider()],
        token: TOKEN,
        port: 0,
      },
      { now: () => NOW, pid: 4242 },
    );
    writeApiInfo(server.port, 4242);
    const c = cli();
    expect(await c.run("stop", "--all")).toBe(1);
    const text = c.stdout.text();
    oneLine(text);
    expect(text).toBe(
      "kill switch engaged: 1 session stopped; 2 already ended (#4 completed, #5 failed:auth); " +
        "2 not confirmed stopped (#2 failed, #3 stop_failed), see studio status; " +
        "the event loop is halted until studio resume\n",
    );
    expect(c.stderr.text()).toBe("");
  });

  it("stop --all through a real SessionManager: a failed:auth session whose group never dies is not confirmed, exit 1", async () => {
    const AUTH_TIMEOUT_MS = 3_600_000;
    const fakes = fakeSessions({
      script: ({ stream, options }) => {
        stream.push(fakeMsg.init(options.sessionId ?? ""));
        stream.push(fakeMsg.apiRetry401());
      },
    });
    const manager = new SessionManager(
      { store, authProvider: stubProvider(), loomwrightPath: makePluginDir(tmp), stopGraceMs: 10, authTimeoutMs: AUTH_TIMEOUT_MS, baseEnv: { PATH: "/usr/bin" } },
      {
        ...fakes.deps,
        // Kill rounds pass at once; the auth kill timer never fires. A group that survives every SIGKILL.
        schedule: (fn, ms) => (ms >= AUTH_TIMEOUT_MS ? () => {} : immediate(fn, ms)),
        killGroup: () => true,
        isGroupAlive: () => true,
      },
    );
    const h = await manager.startSession(startParams(tmp));
    await vi.waitFor(() =>
      expect(store.prepare<[number], string>("SELECT status FROM sessions WHERE id = ?").pluck().get(h.id)).toBe("failed:auth"),
    );
    await server.close();
    server = await startApiServer(
      { store, sessions: manager, loop, authProviders: [stubProvider()], token: TOKEN, port: 0 },
      { now: () => NOW, pid: 4242 },
    );
    writeApiInfo(server.port, 4242);

    const c = cli();
    expect(await c.run("stop", "--all")).toBe(1);
    expect(c.stdout.text()).toBe(
      `kill switch engaged: 0 sessions stopped; 1 not confirmed stopped (#${h.id} stop_failed), see studio status; ` +
        "the event loop is halted until studio resume\n",
    );
    const payload = store.prepare<[], string>("SELECT payload_json FROM events WHERE kind = 'stop_all_completed'").pluck().get();
    expect(JSON.parse(payload ?? "{}")).toEqual({ sessions: [{ id: h.id, status: "stop_failed", error: "kill_incomplete" }] });
    expect(
      store.prepare<[number], string | null>("SELECT kill_incomplete_at FROM sessions WHERE id = ?").pluck().get(h.id),
    ).not.toBeNull();

    // "see studio status" leads somewhere: the session is not running, yet status lists it.
    const s = cli();
    expect(await s.run("status")).toBe(0);
    expect(s.stdout.text()).toContain("sessions: 0 running");
    expect(s.stdout.text()).toContain("kill unconfirmed: 1 session whose group may still be alive (the reaper retries the kill)");
    expect(s.stdout.text()).toMatch(new RegExp(`\\n  #${h.id} \\S+ failed:auth, pgid \\d+, kill gave up at \\S+\\n`));
    // A repeat stop --all finds nothing live (the entry is settled): exit 0, but status still shows the row.
    const again = cli();
    expect(await again.run("stop", "--all")).toBe(0);
    const s2 = cli();
    expect(await s2.run("status")).toBe(0);
    expect(s2.stdout.text()).toContain("kill unconfirmed: 1 session");
  });

  it("status prints an error health with its reason, and `unknown` for a pre-H02 daemon that sends none", async () => {
    const body = (await (await fetch(`http://127.0.0.1:${server.port}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as StatusBody;
    const withHealth = (health: unknown): StatusBody =>
      ({ ...body, auth: [{ id: "subscription-token", account: "owner", health }] }) as StatusBody;
    expect(formatStatus(withHealth({ status: "error", reason: "keychain_unreadable" }))).toContain(
      "auth: subscription-token (owner): error (keychain_unreadable)\n",
    );
    expect(formatStatus(withHealth({ status: "error" }))).toContain("auth: subscription-token (owner): error (unknown)\n");
    expect(formatStatus(withHealth({ status: "expiring", days: 7 }))).toContain(
      "auth: subscription-token (owner): expiring (7 days left)\n",
    );
  });

  it("status lists a session's unsettled tool groups (H08) under its kill-unconfirmed line", async () => {
    const body = (await (await fetch(`http://127.0.0.1:${server.port}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as StatusBody;
    const at = "2026-10-06T08:00:05.000Z";
    const text = formatStatus({
      ...body,
      kill_unconfirmed: [
        { id: 7, agent: "wright", status: "failed", pgid: 2000000007, kill_incomplete_at: at, tool_groups: [{ pgid: 3000000001, command: "/bin/zsh", kill_incomplete_at: at }] },
      ],
    });
    expect(text).toContain(
      `kill unconfirmed: 1 session whose group may still be alive (the reaper retries the kill)\n` +
        `  #7 wright failed, pgid 2000000007, kill gave up at ${at}\n` +
        `    tool group pgid 3000000001 (/bin/zsh), not confirmed gone since ${at}\n`,
    );
  });

  it("status prints no kill-unconfirmed line when no kill gave up", async () => {
    const c = cli();
    expect(await c.run("status")).toBe(0);
    expect(c.stdout.text()).not.toContain("kill unconfirmed");
  });

  it("stop --all waits longer than status: its bound covers one session's worst-case stop", () => {
    expect(STOP_ALL_TIMEOUT_MS).toBeGreaterThan(DEFAULT_STOP_GRACE_MS + KILL_GROUP_DEADLINE_MS + LEADER_EXIT_WAIT_MS);
    expect(STOP_ALL_TIMEOUT_MS).toBeGreaterThan(CLI_TIMEOUT_MS);
  });

  it("stop --all that times out: exit 1, one line saying the kill switch may be engaged; status keeps its own timeout", async () => {
    await server.close();
    let stopping: (() => void) | undefined;
    server = await startApiServer(
      {
        store,
        // A stop that outlasts the CLI's wait.
        sessions: { stopAll: () => new Promise((resolve) => (stopping = () => resolve([]))), abandonSession: unexpectedAbandon },
        loop,
        authProviders: [stubProvider()],
        token: TOKEN,
        port: 0,
      },
      { now: () => NOW, pid: 4242 },
    );
    writeApiInfo(server.port, 4242);
    const c = cli({ stopAllTimeoutMs: 100, timeoutMs: 60_000 });
    expect(await c.run("stop", "--all")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toBe(
      `studio: kernel daemon did not answer POST /stop-all within 0.1 s (127.0.0.1:${server.port}); ` +
        "the kill switch may already be engaged, run studio status\n",
    );
    expect(c.stdout.text()).toBe("");
    // It was: the daemon engaged it before stopping anything.
    const st = cli({ stopAllTimeoutMs: 1 });
    expect(await st.run("status")).toBe(0);
    expect(st.stdout.text()).toContain("kill switch: ENGAGED since");
    stopping?.();
  });

  it("status that times out keeps the short daemon-not-answering line", async () => {
    const c = cli({
      timeoutMs: 1,
      fetch: (async (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch,
    });
    expect(await c.run("status")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toBe(`studio: kernel daemon did not answer within 0.001 s (127.0.0.1:${server.port})\n`);
  });

  it("stop --all with no live sessions reports 0 stopped and exits 0", async () => {
    await server.close();
    server = await startApiServer(
      { store, sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon }, loop, authProviders: [stubProvider()], token: TOKEN, port: 0 },
      { now: () => NOW, pid: 4242 },
    );
    writeApiInfo(server.port, 4242);
    const c = cli();
    expect(await c.run("stop", "--all")).toBe(0);
    expect(c.stdout.text()).toBe("kill switch engaged: 0 sessions stopped; the event loop is halted until studio resume\n");
  });

  it("prints usage and exits 2 for stop without --all and for unknown commands", async () => {
    for (const argv of [["stop"], ["frobnicate"], [], ["status", "--yaml"]]) {
      const c = cli();
      expect(await c.run(...argv)).toBe(2);
      expect(c.stderr.text()).toMatch(/^usage: studio/);
      expect(c.fetchSpy).not.toHaveBeenCalled();
    }
  });

  it("no api.json: exit 1, exactly one stderr line, nothing read or sent", async () => {
    rmSync(join(dataDir, "api.json"));
    const c = cli();
    expect(await c.run("status")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toContain("kernel daemon is not running (no ");
    expect(c.reads).toEqual([]);
    expect(c.fetchSpy).not.toHaveBeenCalled();
  });

  it("an unreadable api.json: exit 1, one line", async () => {
    writeFileSync(join(dataDir, "api.json"), "{not json");
    const c = cli();
    expect(await c.run("stop", "--all")).toBe(1);
    oneLine(c.stderr.text());
  });

  it("api.json naming a dead pid: exit 1, one line, and neither the Keychain nor fetch is touched", async () => {
    const c = cli({ isPidAlive: () => false });
    expect(await c.run("stop", "--all")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toContain("pid 4242");
    expect(c.reads).toEqual([]);
    expect(c.fetchSpy).not.toHaveBeenCalled();
  });

  it("the default liveness check treats another user's process (EPERM) and a missing one (ESRCH) as not running", async () => {
    // pid 1 (launchd/init) belongs to root: kill(1, 0) is EPERM for this user.
    writeApiInfo(server.port, 1);
    const c1 = cli({ isPidAlive: undefined });
    expect(await c1.run("status")).toBe(1);
    expect(c1.reads).toEqual([]);
    expect(c1.fetchSpy).not.toHaveBeenCalled();
    writeApiInfo(server.port, 2_147_483_000);
    const c2 = cli({ isPidAlive: undefined });
    expect(await c2.run("status")).toBe(1);
    expect(c2.reads).toEqual([]);
    expect(c2.fetchSpy).not.toHaveBeenCalled();
  });

  it("api.json naming a closed port: exit 1, one line", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const closedPort = (probe.address() as { port: number }).port;
    await new Promise((resolve) => probe.close(resolve));
    writeApiInfo(closedPort, 4242);
    const c = cli();
    expect(await c.run("status")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toContain(`cannot connect to 127.0.0.1:${closedPort}`);
    expect(c.stderr.text()).not.toContain(TOKEN);
  });

  it("missing Keychain token: exit 1, one line, nothing sent", async () => {
    const c = cli({ keychain: { read: () => undefined } });
    expect(await c.run("status")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toContain('no API token in Keychain item "loomwright-studio-api"');
    expect(c.fetchSpy).not.toHaveBeenCalled();
  });

  it("a non-2xx answer (wrong token): exit 1, one line naming the status, never a token", async () => {
    const wrong = "f".repeat(64);
    const c = cli({ keychain: { read: () => wrong } });
    expect(await c.run("status")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toContain("answered 401");
    expect(c.stderr.text()).not.toContain(wrong);
  });
});

describe("studio service (item 09, AC1; H07)", () => {
  const SERVICE_PID = 4242;
  const VERSION = "1.2.3";

  /**
   * Injected launchctl, homeDir and sleep/delay/clock: never the real
   * launchctl, home or a real wait. `print` answers 113 until a bootstrap
   * loads the agent, then 0 with `pid = <pid>` (default the API server's
   * 4242) when stdout is captured.
   */
  function serviceDeps(o: { fail?: string; stderr?: string; platform?: NodeJS.Platform; pid?: number } = {}) {
    const homeDir = join(tmp, "home");
    const launchctl: string[][] = [];
    let clock = 0;
    let loaded = false;
    const deps: ServiceDeps = {
      exec: (_file, args, options) => {
        launchctl.push([...args]);
        if (args[0] === "print") {
          if (!loaded) return { status: 113, stderr: "" };
          const out = `\tpid = ${o.pid ?? SERVICE_PID}\n\tlast exit code = 1\n`;
          return options?.captureStdout === true ? { status: 0, stderr: "", stdout: out } : { status: 0, stderr: "" };
        }
        if (args[0] === o.fail) return { status: 5, stderr: o.stderr ?? "" };
        if (args[0] === "bootstrap") loaded = true;
        if (args[0] === "bootout") loaded = false;
        return { status: 0, stderr: "" };
      },
      uid: 501,
      homeDir,
      platform: o.platform ?? "darwin",
      sleep: (ms) => {
        clock += ms;
      },
      delay: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    };
    return { homeDir, launchctl, deps };
  }

  /** A built kernel to copy: dist/daemon.js, package.json and an empty lockfile. */
  function sourceKernel(version = VERSION): string {
    const root = join(tmp, "kernel");
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "daemon.js"), "// built daemon\n");
    writeFileSync(join(root, "package.json"), JSON.stringify({ version, type: "module" }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }));
    return root;
  }

  /** The new kernel's api.json in `dir`: the test API server's port and pid. */
  function newKernelApiInfo(dir: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "api.json"), JSON.stringify({ port: server.port, host: "127.0.0.1", pid: SERVICE_PID, started_at: NOW.toISOString() }));
  }

  function serviceCli(o: { fail?: string; stderr?: string; platform?: NodeJS.Platform; pid?: number; nodePath?: string; version?: string } = {}) {
    const sourceRoot = sourceKernel(o.version);
    const { homeDir, launchctl, deps } = serviceDeps(o);
    const serviceData = join(tmp, "service-data");
    newKernelApiInfo(serviceData);
    const options = { sourceRoot, env: {}, ...(o.nodePath === undefined ? {} : { nodePath: o.nodePath }) };
    const c = cli({ dataDir: serviceData, service: { options, deps } });
    return { ...c, homeDir, launchctl, serviceData };
  }

  it("install copies and loads the kernel, waits for it to answer GET /status, then prints one line naming its version, copy and plist", async () => {
    const c = serviceCli();
    expect(await c.run("service", "install")).toBe(0);
    oneLine(c.stdout.text());
    const appDir = join(c.serviceData, "app", VERSION);
    expect(c.stdout.text()).toBe(
      `studio: service ${SERVICE_LABEL} installed and loaded: kernel ${kernelVersion()} (pid ${SERVICE_PID}) running from ${appDir} (${plistPath(c.homeDir)})\n`,
    );
    expect(existsSync(plistPath(c.homeDir))).toBe(true);
    expect(existsSync(join(appDir, "dist", "daemon.js"))).toBe(true);
    expect(existsSync(join(c.serviceData, "logs"))).toBe(true);
    // The start check: the token read once, one GET /status, never printed.
    expect(c.reads).toEqual([API_TOKEN_KEYCHAIN_SERVICE]);
    expect(c.fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(c.fetchSpy.mock.calls[0]?.[0])).toBe(`http://127.0.0.1:${server.port}/status`);
    expect(c.stdout.text()).not.toContain(TOKEN);
    expect(c.stderr.text()).toBe("");
    expect(c.launchctl.map((a) => a[0])).toEqual(["print", "bootstrap", "print"]);
  });

  it("uninstall prints one line, removes the plist and <dataDir>/app/, and never reads api.json, the Keychain or the API", async () => {
    const c = serviceCli();
    expect(await c.run("service", "install")).toBe(0);
    rmSync(join(c.serviceData, "api.json"));
    const u = serviceCli();
    rmSync(join(u.serviceData, "api.json"));
    expect(await u.run("service", "uninstall")).toBe(0);
    expect(u.stdout.text()).toBe(`studio: service ${SERVICE_LABEL} unloaded and removed (${plistPath(u.homeDir)}, ${join(u.serviceData, "app")})\n`);
    expect(existsSync(plistPath(u.homeDir))).toBe(false);
    expect(existsSync(join(u.serviceData, "app"))).toBe(false);
    expect(existsSync(join(u.serviceData, "logs"))).toBe(true);
    expect(u.reads).toEqual([]);
    expect(u.fetchSpy).not.toHaveBeenCalled();
    expect(u.stderr.text()).toBe("");
  });

  it("a start check that fails: the failure output on stderr, the agent booted out, the plist removed, the previous copy kept, exit 1", async () => {
    // A stale api.json: it names 4242, the job runs as 5555.
    const first = serviceCli();
    expect(await first.run("service", "install")).toBe(0);
    const c = serviceCli({ pid: 5555, version: "1.2.4" });
    expect(await c.run("service", "install")).toBe(1);
    expect(c.stdout.text()).toBe("");
    const lines = c.stderr.text().trimEnd().split("\n");
    expect(lines[0]).toBe(
      `studio service: the kernel did not answer GET /status within 15 s (last: api.json names pid ${SERVICE_PID}, not the agent's pid 5555)`,
    );
    expect(lines).toContain("studio service: launchctl print: last exit code = 1");
    expect(lines.at(-1)).toBe(
      `studio service: ${SERVICE_LABEL} booted out and ${plistPath(c.homeDir)} removed; the install copy and ${c.serviceData} are kept`,
    );
    expect(c.launchctl.at(-1)).toEqual(["bootout", `gui/501/${SERVICE_LABEL}`]);
    expect(existsSync(plistPath(c.homeDir))).toBe(false);
    expect(readdirSync(join(c.serviceData, "app")).sort()).toEqual([VERSION, "1.2.4"]);
    expect(c.reads).toEqual([]);
    expect(c.fetchSpy).not.toHaveBeenCalled();
  });

  it("a verified start removes the older install copies", async () => {
    const first = serviceCli();
    expect(await first.run("service", "install")).toBe(0);
    const c = serviceCli({ version: "1.2.4" });
    expect(await c.run("service", "install")).toBe(0);
    expect(readdirSync(join(c.serviceData, "app"))).toEqual(["1.2.4"]);
  });

  it("a version-manager node: one warning line on stderr, and the install goes on", async () => {
    const nodePath = join(tmp, "home", ".nvm", "versions", "node", "v22.14.0", "bin", "node");
    const c = serviceCli({ nodePath });
    expect(await c.run("service", "install")).toBe(0);
    expect(c.stderr.text()).toBe(
      `studio service: warning: node ${nodePath} is under ~/.nvm; the agent stops working if that Node version is removed (then run service install again with another node)\n`,
    );
    oneLine(c.stdout.text());
  });

  it("a data dir in a protected folder: one stderr line naming D31, exit 1, nothing copied or loaded", async () => {
    const sourceRoot = sourceKernel();
    const { homeDir, launchctl, deps } = serviceDeps();
    const protectedDir = join(homeDir, "Documents", "studio");
    const c = cli({ dataDir: protectedDir, service: { options: { sourceRoot, env: {} }, deps } });
    expect(await c.run("service", "install")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toContain("(D31)");
    expect(launchctl).toEqual([]);
    expect(existsSync(protectedDir)).toBe(false);
  });

  it("install with CliDeps.dataDir and an empty env: the plist's logs and STUDIO_DATA_DIR are that dir", async () => {
    const c = serviceCli();
    expect(await c.run("service", "install")).toBe(0);
    const xml = readFileSync(plistPath(c.homeDir), "utf8");
    const dataDir = join(tmp, "service-data");
    expect(xml).toContain(`<key>StandardOutPath</key>\n  <string>${join(dataDir, "logs", "kernel.out.log")}</string>`);
    expect(xml).toContain(`<key>STUDIO_DATA_DIR</key>\n    <string>${dataDir}</string>`);
  });

  it("a failure exits 1 with one stderr line", async () => {
    const c = serviceCli({ fail: "bootstrap" });
    expect(await c.run("service", "install")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toBe("studio service: launchctl bootstrap gui/501 failed (exit status 5)\n");
    expect(c.stdout.text()).toBe("");

    const l = serviceCli({ platform: "linux" });
    expect(await l.run("service", "uninstall")).toBe(1);
    expect(l.stderr.text()).toBe("studio service is macOS only\n");
    expect(l.launchctl).toEqual([]);
  });

  it("a launchctl failure with stderr: still one stderr line, with launchctl's first line", async () => {
    const c = serviceCli({ fail: "bootstrap", stderr: "Bootstrap failed: 5: Input/output error\nmore\n" });
    expect(await c.run("service", "install")).toBe(1);
    oneLine(c.stderr.text());
    expect(c.stderr.text()).toBe("studio service: launchctl bootstrap gui/501 failed (exit status 5): Bootstrap failed: 5: Input/output error\n");
    expect(c.launchctl.map((a) => a[0])).toEqual(["print", "bootstrap", "bootstrap"]);
  });

  it("install with no CliDeps.dataDir (production): the data dir is STUDIO_DATA_DIR, else ~/.loomwright-studio under homeDir", async () => {
    const sourceRoot = sourceKernel();
    const envDir = join(tmp, "env-data");
    for (const [env, expected] of [
      [{ STUDIO_DATA_DIR: envDir }, envDir],
      [{}, join(tmp, "home", ".loomwright-studio")],
    ] as const) {
      const { homeDir, deps } = serviceDeps();
      const stdout = out();
      const stderr = out();
      newKernelApiInfo(expected);
      const probe = { keychain: cli().deps.keychain, fetch, isPidAlive: () => true };
      expect(await runCli(["service", "install"], { stdout, stderr, ...probe, service: { options: { sourceRoot, env }, deps } })).toBe(0);
      expect(stderr.text()).toBe("");
      const xml = readFileSync(plistPath(homeDir), "utf8");
      expect(xml).toContain(`<key>StandardOutPath</key>\n  <string>${join(expected, "logs", "kernel.out.log")}</string>`);
      expect(xml).toContain(`<key>STUDIO_DATA_DIR</key>\n    <string>${expected}</string>`);
      expect(existsSync(join(expected, "logs"))).toBe(true);
    }
  });

  it("studio service with no or another action prints usage and exits 2", async () => {
    for (const argv of [["service"], ["service", "start"], ["service", "install", "--force"]]) {
      const c = serviceCli();
      expect(await c.run(...argv)).toBe(2);
      expect(c.stderr.text()).toBe(`${USAGE}\n`);
      expect(c.launchctl).toEqual([]);
    }
    expect(USAGE).toContain("studio service install|uninstall");
  });
});

describe("studio stop --all: sessions that ended on their own (H04, AC5)", () => {
  it("counts a failed outcome carrying ended_on_its_own as already ended (exit 0), and one without it as unconfirmed (exit 1)", async () => {
    const ended = summarizeStopAll([
      { id: 1, status: "stopped" },
      { id: 2, status: "failed", ended_on_its_own: true },
    ]);
    expect(ended).toEqual({ text: "1 session stopped; 1 already ended (#2 failed)", confirmed: true });
    const unconfirmed = summarizeStopAll([{ id: 2, status: "failed" }]);
    expect(unconfirmed.confirmed).toBe(false);
    expect(unconfirmed.text).toContain("1 not confirmed stopped (#2 failed)");
    // The legacy statuses still count for an older daemon that sends no field; a non-true field is no field.
    expect(summarizeStopAll([{ id: 3, status: "completed" }, { id: 4, status: "failed", ended_on_its_own: "yes" }]).text).toBe(
      "0 sessions stopped; 1 already ended (#3 completed); 1 not confirmed stopped (#4 failed), see studio status",
    );

    await server.close();
    server = await startApiServer(
      {
        store,
        sessions: { stopAll: async () => [{ id: 2, status: "failed" as const, ended_on_its_own: true as const }], abandonSession: unexpectedAbandon },
        loop,
        authProviders: [stubProvider()],
        token: TOKEN,
        port: 0,
      },
      { now: () => NOW, pid: 4242 },
    );
    writeApiInfo(server.port, 4242);
    const c = cli();
    expect(await c.run("stop", "--all")).toBe(0);
    expect(c.stdout.text()).toBe("kill switch engaged: 0 sessions stopped; 1 already ended (#2 failed); the event loop is halted until studio resume\n");
  });
});

describe("studio session abandon (H04, AC4)", () => {
  let abandoned: [number, AbandonVia][];

  beforeEach(async () => {
    abandoned = [];
    await server.close();
    server = await startApiServer(
      {
        store,
        sessions: {
          stopAll: async () => [],
          abandonSession: (id, { via }) => {
            if (id === 8) throw new SessionError("not_abandonable", "session 8 is orphaned for reap_error");
            if (id !== 7) throw new SessionError("not_found", `no session ${id}`);
            abandoned.push([id, via]);
            return "abandoned";
          },
        },
        loop,
        authProviders: [stubProvider()],
        token: TOKEN,
        port: 0,
      },
      { now: () => NOW, pid: 4242 },
    );
    writeApiInfo(server.port, 4242);
  });

  it("--yes sends POST /sessions/<id>/abandon as the cli without asking, exit 0", async () => {
    const confirm = vi.fn(async () => false);
    const c = cli({ confirm, isInteractive: () => false });
    expect(await c.run("session", "abandon", "7", "--yes")).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(c.fetchSpy.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:${server.port}/sessions/7/abandon`);
    expect(c.fetchSpy.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(abandoned).toEqual([[7, "cli"]]);
    oneLine(c.stdout.text());
    expect(c.stdout.text()).toContain("session 7 abandoned");
    expect(c.stdout.text()).not.toContain(TOKEN);
    expect(c.stderr.text()).toBe("");
  });

  it("asks on a terminal: yes sends the request; any other answer sends nothing and exits 1", async () => {
    const questions: string[] = [];
    const yes = cli({ isInteractive: () => true, confirm: async (q) => (questions.push(q), true) });
    expect(await yes.run("session", "abandon", "7")).toBe(0);
    expect(abandoned).toEqual([[7, "cli"]]);
    expect(questions[0]).toContain("session 7");
    expect(questions[0]).toContain("never signals its process group");

    const no = cli({ isInteractive: () => true, confirm: async () => false });
    expect(await no.run("session", "abandon", "7")).toBe(1);
    expect(no.fetchSpy).not.toHaveBeenCalled();
    expect(no.reads).toEqual([]);
    oneLine(no.stderr.text());
    expect(no.stderr.text()).toContain("session 7 not abandoned (not confirmed)");
    expect(abandoned).toHaveLength(1);
  });

  it("the default readline confirm settles a no when stdin ends (Ctrl-D) or fails before an answer: exit 1, nothing sent", async () => {
    // Each case acts on stdin only once the question is on the prompt stream: ordered by events, no timers.
    const cases: [string, (input: PassThrough) => void, boolean][] = [
      ["EOF before the question", (input) => input.end(), false],
      ["EOF at the prompt", () => undefined, false],
      ["stdin error at the prompt", () => undefined, false],
      ["already destroyed", (input) => input.destroy(), false],
    ];
    for (const [name, before] of cases) {
      const input = new PassThrough();
      const prompt = new PassThrough();
      const shown: string[] = [];
      prompt.on("data", (chunk: Buffer) => {
        shown.push(chunk.toString());
        if (name === "EOF at the prompt") input.end();
        if (name === "stdin error at the prompt") input.destroy(new Error("EIO"));
      });
      before(input);
      const c = cli({ isInteractive: () => true, confirm: readlineConfirm(input, prompt) });
      expect(await c.run("session", "abandon", "7"), name).toBe(1);
      expect(c.fetchSpy, name).not.toHaveBeenCalled();
      expect(c.reads, name).toEqual([]);
      oneLine(c.stderr.text());
      expect(c.stderr.text(), name).toContain("session 7 not abandoned (not confirmed)");
      if (name.endsWith("at the prompt")) expect(shown.join(""), name).toContain("Abandon session 7?");
    }
    expect(abandoned).toEqual([]);

    // A `yes` line through the same readline path still proceeds.
    const input = new PassThrough();
    const prompt = new PassThrough();
    prompt.once("data", () => input.write("yes\n"));
    const yes = cli({ isInteractive: () => true, confirm: readlineConfirm(input, prompt) });
    expect(await yes.run("session", "abandon", "7")).toBe(0);
    expect(abandoned).toEqual([[7, "cli"]]);
  });

  it("with no terminal and no --yes: refuses with usage, exit 2, without asking or sending", async () => {
    const confirm = vi.fn(async () => true);
    const c = cli({ isInteractive: () => false, confirm });
    expect(await c.run("session", "abandon", "7")).toBe(2);
    expect(confirm).not.toHaveBeenCalled();
    expect(c.fetchSpy).not.toHaveBeenCalled();
    expect(c.stderr.text()).toContain("--yes");
    expect(c.stderr.text()).toContain(USAGE);
  });

  it("a 409 or 404 prints one stderr line with the API's stable code, exit 1, never the token", async () => {
    for (const [id, code] of [["8", "not_abandonable"], ["9", "not_found"]] as const) {
      const c = cli();
      expect(await c.run("session", "abandon", id, "--yes")).toBe(1);
      oneLine(c.stderr.text());
      expect(c.stderr.text()).toBe(`studio: session ${id} not abandoned: ${code}\n`);
      expect(c.stderr.text()).not.toContain(TOKEN);
      expect(c.stdout.text()).toBe("");
    }
  });

  it("a 400 from the API prints its code too", async () => {
    const c = cli({
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: "invalid_id" }), { status: 400 })) as unknown as typeof fetch,
    });
    expect(await c.run("session", "abandon", "7", "--yes")).toBe(1);
    expect(c.stderr.text()).toBe("studio: session 7 not abandoned: invalid_id\n");
    // A body that is not a stable code is never echoed.
    const odd = cli({
      fetch: vi.fn(async () => new Response(JSON.stringify({ error: "Bearer abc <script>" }), { status: 409 })) as unknown as typeof fetch,
    });
    expect(await odd.run("session", "abandon", "7", "--yes")).toBe(1);
    expect(odd.stderr.text()).toBe("studio: session 7 not abandoned: unknown\n");
  });

  it("a timeout says the session may or may not be abandoned; the daemon then skips the abandon the CLI gave up on", async () => {
    await server.close();
    let entered!: () => void;
    const stopAllEntered = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const abandonSession = vi.fn((): "abandoned" => "abandoned");
    server = await startApiServer(
      {
        store,
        sessions: {
          stopAll: async () => {
            entered();
            await gate;
            return [];
          },
          abandonSession,
        },
        loop,
        authProviders: [stubProvider()],
        token: TOKEN,
        port: 0,
      },
      { now: () => NOW, pid: 4242 },
    );
    writeApiInfo(server.port, 4242);
    const stopping = cli().run("stop", "--all");
    await stopAllEntered;
    try {
      // The server side of the abandon request (Node's public `http.server.request.start` channel).
      const arrived = new Promise<ServerResponse>((resolve) => {
        const onStart = (message: unknown): void => {
          const m = message as { readonly request: { readonly url?: string }; readonly response: ServerResponse };
          if (m.request.url !== "/sessions/7/abandon") return;
          unsubscribe("http.server.request.start", onStart);
          resolve(m.response);
        };
        subscribe("http.server.request.start", onStart);
      });
      // Queued behind the stop-all, so it cannot answer within any timeout.
      const c = cli({ timeoutMs: 50 });
      expect(await c.run("session", "abandon", "7", "--yes")).toBe(1);
      oneLine(c.stderr.text());
      expect(c.stderr.text()).toBe(
        `studio: kernel daemon did not answer POST /sessions/7/abandon within 0.05 s (127.0.0.1:${server.port}); ` +
          "session 7 may or may not be abandoned, run studio status\n",
      );
      expect(c.stdout.text()).toBe("");
      const response = await arrived;
      if (!response.closed) await new Promise<void>((resolve) => response.once("close", () => resolve()));

      release();
      expect(await stopping).toBe(0);
      // /resume queues behind the abandon's turn: once it answers, that turn has run.
      expect(await cli().run("resume")).toBe(0);
      expect(abandonSession).not.toHaveBeenCalled();
    } finally {
      release(); // a failed assertion must not leave close() waiting on the stop-all
    }
  });

  it("a connection lost after connecting says the session may or may not be abandoned; a refused one says not running", async () => {
    const failing = (code: string) =>
      vi.fn(async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
      }) as unknown as typeof fetch;
    for (const code of ["ECONNRESET", "UND_ERR_SOCKET"]) {
      const c = cli({ fetch: failing(code) });
      expect(await c.run("session", "abandon", "7", "--yes"), code).toBe(1);
      oneLine(c.stderr.text());
      expect(c.stderr.text(), code).toBe(
        `studio: connection to the kernel daemon failed during POST /sessions/7/abandon (127.0.0.1:${server.port}: ${code}); ` +
          "session 7 may or may not be abandoned, run studio status\n",
      );
    }
    const refused = cli({ fetch: failing("ECONNREFUSED") });
    expect(await refused.run("session", "abandon", "7", "--yes")).toBe(1);
    expect(refused.stderr.text()).toBe(`studio: kernel daemon is not running (cannot connect to 127.0.0.1:${server.port}: ECONNREFUSED)\n`);
    expect(abandoned).toEqual([]);
  });

  it("refuses a malformed id or extra arguments with usage, exit 2, nothing sent", async () => {
    for (const argv of [["session", "abandon"], ["session", "abandon", "0"], ["session", "abandon", "-3"], ["session", "abandon", "07"],
      ["session", "abandon", "7x"], ["session", "abandon", "99999999999999999999"], ["session", "abandon", "7", "--force"], ["session", "kill", "7"]]) {
      const c = cli({ isInteractive: () => true, confirm: async () => true });
      expect(await c.run(...argv), argv.join(" ")).toBe(2);
      expect(c.stderr.text()).toMatch(/^usage: studio/);
      expect(c.fetchSpy).not.toHaveBeenCalled();
    }
  });
});

describe("formatStatus: orphaned (H04, AC4)", () => {
  it("prints an orphaned block with the abandon hint when the list is non-empty, and nothing when empty or missing", async () => {
    const body = (await (await fetch(`http://127.0.0.1:${server.port}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as StatusBody;
    expect(body.orphaned).toEqual([]);
    expect(formatStatus(body)).not.toContain("orphaned");
    const { orphaned: _dropped, ...older } = body;
    expect(formatStatus(older as StatusBody)).not.toContain("orphaned");

    const text = formatStatus({
      ...body,
      orphaned: [
        { id: 7, agent: "wright", pgid: 4242, reason: "leader_unverified", updated_at: "2026-10-02T08:00:00.000Z" },
        { id: 9, agent: null, pgid: null, reason: null, updated_at: "2026-10-02T08:00:00.000Z" },
      ],
    });
    expect(text).toContain("orphaned: 2 sessions whose group may still be alive");
    expect(text).toContain("  #7 wright, pgid 4242, reason leader_unverified\n");
    expect(text).toContain("  #9 -, pgid -, reason unknown\n");
    expect(text).toContain("studio session abandon <id> releases a leader_unverified row");
  });

  it("studio status shows an orphaned row from the store", async () => {
    store.prepare("INSERT INTO sessions (id, agent, status, pgid) VALUES (5, 'wright', 'orphaned', 4343)").run();
    store
      .prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES ('x', 'session_reap_deferred', 'kernel', 5, ?)")
      .run(JSON.stringify({ reason: "leader_unverified", pgid: 4343 }));
    const c = cli();
    expect(await c.run("status")).toBe(0);
    expect(c.stdout.text()).toContain("  #5 wright, pgid 4343, reason leader_unverified\n");
  });
});
