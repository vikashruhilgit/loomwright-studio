// The `studio` CLI (item 08, AC4): runCli against a real startApiServer on
// 127.0.0.1 and an OS-assigned port, with an in-memory Keychain. Never the
// real Keychain, the real daemon or a model.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { API_TOKEN_KEYCHAIN_SERVICE, startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import type { KeychainReader } from "../src/auth/index.js";
import { runCli } from "../src/cli/index.js";
import type { CliDeps } from "../src/cli/index.js";
import { Store } from "../src/store/index.js";
import { stubProvider } from "./session-fakes.js";

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
      sessions: { stopAll: async () => [{ id: 1, status: "stopped" as const }, { id: 2, status: "stopped" as const }] },
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
