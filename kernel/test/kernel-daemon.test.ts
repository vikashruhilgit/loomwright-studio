// The daemon composition (item 08): startKernel with a temp data dir, a stub
// or real-but-faked auth provider, an in-memory Keychain and the fake
// spawner/query. Never the real SDK, a model or the real Keychain.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_TOKEN_KEYCHAIN_SERVICE, engageKillSwitch } from "../src/api/index.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps, KernelOptions } from "../src/kernel.js";
import { EventLoop, enqueueMessage, getQueueRow } from "../src/loop/index.js";
import type { SessionRow } from "../src/sessions/index.js";
import { Store } from "../src/store/index.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

const FAKE_API_KEY = `sk-ant-api03-${"x".repeat(93)}AA`;

let tmp: string;
let dataDir: string;
let pluginDir: string;
const kernels: Kernel[] = [];
const blockers: Server[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-kernel-"));
  dataDir = join(tmp, "data");
  pluginDir = makePluginDir(tmp);
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  for (const b of blockers.splice(0)) await new Promise((resolve) => b.close(resolve));
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

function memoryKeychain(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const reader: KeychainReader = { read: (service) => items.get(service) };
  const writer: KeychainWriter = {
    add(service, _account, secret) {
      if (items.has(service)) throw new KeychainError(service, 45, null, "write");
      items.set(service, secret);
    },
  };
  return { items, reader, writer };
}

function options(overrides: Partial<KernelOptions> = {}): KernelOptions {
  return { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: pluginDir, stopGraceMs: 10 }, ...overrides };
}

function deps(overrides: Partial<KernelDeps> = {}) {
  const keychain = memoryKeychain();
  const fakes = fakeSessions();
  const selected: string[] = [];
  const d: KernelDeps = {
    keychain: keychain.reader,
    keychainWriter: keychain.writer,
    sessionDeps: fakes.deps,
    selectAuthProvider: async (id): Promise<AuthProvider> => {
      selected.push(id);
      return stubProvider();
    },
    availableProviderIds: async () => ["api-key", "subscription-token"],
    ...overrides,
  };
  return { d, keychain, fakes, selected };
}

async function start(o: KernelOptions = options(), d: KernelDeps = deps().d): Promise<Kernel> {
  const kernel = await startKernel(o, d);
  kernels.push(kernel);
  return kernel;
}

function storeIsReopenable(): boolean {
  const s = new Store({ dataDir });
  s.close();
  return true;
}

describe("startKernel", () => {
  it("writes api.json (mode 0600) with the bound port and no token, and serves /status with the Keychain token", async () => {
    const { d, keychain } = deps();
    const kernel = await start(options(), d);
    const token = keychain.items.get(API_TOKEN_KEYCHAIN_SERVICE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const path = join(dataDir, "api.json");
    expect(kernel.apiInfoPath).toBe(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain(token as string);
    const info = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(info).sort()).toEqual(["host", "pid", "port", "started_at"]);
    expect(info).toMatchObject({ port: kernel.api.port, host: "127.0.0.1", pid: process.pid });
    expect(kernel.api.port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${kernel.api.port}/status`, { headers: { Authorization: `Bearer ${token as string}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: unknown[]; kill_switch: unknown };
    expect(body.auth).toEqual([{ id: "stub-provider", account: "owner@example.test", health: { status: "ok" } }]);
    expect(body.kill_switch).toEqual({ engaged: false, since: null });
  });

  it("reuses the token already in the Keychain on a later start", async () => {
    const { d, keychain } = deps();
    await (await start(options(), d)).stop();
    const first = keychain.items.get(API_TOKEN_KEYCHAIN_SERVICE);
    await start(options(), d);
    expect(keychain.items.get(API_TOKEN_KEYCHAIN_SERVICE)).toBe(first);
  });

  it("stop() ends a running session interrupted (kernel_shutdown), removes api.json and closes the store", async () => {
    const { d, fakes } = deps();
    const kernel = await start(options(), d);
    const handle = await kernel.sessions.startSession(startParams(tmp));
    await vi.waitFor(() => expect(kernel.sessions.getSession(handle.id)?.status).toBe("running"));

    await kernel.stop();
    await kernel.stop(); // idempotent
    expect(await handle.done).toBe("interrupted");
    expect(fakes.allGroupsGone()).toBe(true);
    expect(existsSync(join(dataDir, "api.json"))).toBe(false);
    expect(kernel.store.isOpen).toBe(false);

    const store = new Store({ dataDir });
    try {
      const row = store.prepare<[number], SessionRow>("SELECT * FROM sessions WHERE id = ?").get(handle.id);
      expect(row?.status).toBe("interrupted");
      const last = store
        .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'session_status' AND session_id = ? ORDER BY id DESC LIMIT 1")
        .pluck()
        .get(handle.id);
      expect(JSON.parse(last ?? "{}")).toEqual({ from: "running", to: "interrupted", reason: "kernel_shutdown" });
    } finally {
      store.close();
    }
  });

  it("does not remove an api.json that names another pid", async () => {
    const kernel = await start();
    writeFileSync(kernel.apiInfoPath, JSON.stringify({ port: 1, host: "127.0.0.1", pid: process.pid + 1, started_at: "x" }));
    await kernel.stop();
    expect(existsSync(kernel.apiInfoPath)).toBe(true);
  });

  it("starts the loop only while the kill switch is not engaged", async () => {
    const startSpy = vi.spyOn(EventLoop.prototype, "start");
    await (await start()).stop();
    expect(startSpy).toHaveBeenCalledTimes(1);

    const store = new Store({ dataDir });
    engageKillSwitch(store, new Date().toISOString());
    store.close();
    startSpy.mockClear();
    const { d, keychain } = deps();
    const kernel = await start(options(), d);
    expect(startSpy).not.toHaveBeenCalled();
    const token = keychain.items.get(API_TOKEN_KEYCHAIN_SERVICE) ?? "";
    const res = await fetch(`http://127.0.0.1:${kernel.api.port}/status`, { headers: { Authorization: `Bearer ${token}` } });
    const status = (await res.json()) as { kill_switch: { engaged: boolean } };
    expect(status.kill_switch.engaged).toBe(true);
  });

  it("reaps orphans left by an earlier kernel before accepting work", async () => {
    const store = new Store({ dataDir });
    const id = Number(store.prepare("INSERT INTO sessions (agent, status) VALUES ('wright', 'running')").run().lastInsertRowid);
    store.close();
    const kernel = await start();
    expect(kernel.sessions.getSession(id)?.status).toBe("interrupted");
  });

  it("without handlers (the daemon's call) an enqueued message ends event_unhandled; daemon.ts never passes handlers", async () => {
    const store = new Store({ dataDir });
    const { id } = enqueueMessage(store, { text: "hello" });
    store.close();
    const kernel = await start();
    await vi.waitFor(() => expect(getQueueRow(kernel.store, id)?.status).toBe("done"));
    const kinds = kernel.store.prepare<[], string>("SELECT kind FROM events WHERE kind IN ('event_unhandled', 'event_done')").pluck().all();
    expect(kinds).toEqual(["event_unhandled"]);
    // Invariant 1: the shipped entry point installs no handler.
    const daemonSource = readFileSync(fileURLToPath(new URL("../src/daemon.ts", import.meta.url)), "utf8");
    expect(daemonSource).not.toMatch(/handlers/);
  });

  it("with handlers (another composition) the message handler runs and the event ends event_done", async () => {
    const store = new Store({ dataDir });
    const { id } = enqueueMessage(store, { text: "hello" });
    store.close();
    const seen: unknown[] = [];
    const kernel = await start(options({ handlers: { message: (ctx) => void seen.push(ctx.event.payload) } }));
    await vi.waitFor(() => expect(getQueueRow(kernel.store, id)?.status).toBe("done"));
    expect(seen).toEqual([{ text: "hello", agent: null }]);
    const kinds = kernel.store.prepare<[], string>("SELECT kind FROM events WHERE kind IN ('event_unhandled', 'event_done')").pluck().all();
    expect(kinds).toEqual(["event_done"]);
  });

  it("selects the provider from --auth-provider, then STUDIO_AUTH_PROVIDER, then the build default", async () => {
    const a = deps();
    await (await start(options({ authProviderId: "api-key", env: { STUDIO_AUTH_PROVIDER: "subscription-token" } }), a.d)).stop();
    const b = deps();
    await (await start(options({ env: { STUDIO_AUTH_PROVIDER: "api-key" } }), b.d)).stop();
    const c = deps();
    await (await start(options(), c.d)).stop();
    const dist = deps({ availableProviderIds: async () => ["api-key"] });
    await (await start(options(), dist.d)).stop();
    expect([a.selected, b.selected, c.selected, dist.selected]).toEqual([["api-key"], ["api-key"], ["subscription-token"], ["api-key"]]);
  });

  it("with STUDIO_AUTH_PROVIDER=api-key the real registry selects the api-key provider", async () => {
    const keychain = memoryKeychain({ "loomwright-studio-api-key": FAKE_API_KEY });
    const { selectAuthProvider: _ignored, ...rest } = deps().d;
    const kernel = await start(options({ env: { STUDIO_AUTH_PROVIDER: "api-key" } }), {
      ...rest,
      keychain: keychain.reader,
      keychainWriter: keychain.writer,
    });
    expect(kernel.authProvider.id).toBe("api-key");
    expect(kernel.authProvider.health()).toEqual({ status: "ok" });
  });
});

describe("startKernel partial-start unwind", () => {
  function expectUnwound(stopSpy: ReturnType<typeof vi.spyOn>): void {
    expect(stopSpy).toHaveBeenCalled();
    expect(existsSync(join(dataDir, "api.json"))).toBe(false);
    expect(storeIsReopenable()).toBe(true);
  }

  it("a Keychain read that throws (after the loop started) rejects, stops the loop, leaves no api.json and releases the store lock", async () => {
    const startSpy = vi.spyOn(EventLoop.prototype, "start");
    const stopSpy = vi.spyOn(EventLoop.prototype, "stop");
    const keychain: KeychainReader = {
      read: () => {
        throw new KeychainError(API_TOKEN_KEYCHAIN_SERVICE, 51, null);
      },
    };
    await expect(startKernel(options(), deps({ keychain }).d)).rejects.toBeInstanceOf(KeychainError);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expectUnwound(stopSpy);
  });

  it("a startApiServer failure (port already in use) unwinds the same way", async () => {
    const blocker = createServer();
    blockers.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const port = (blocker.address() as { port: number }).port;
    const stopSpy = vi.spyOn(EventLoop.prototype, "stop");

    const err = await startKernel(options({ port }), deps().d).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("EADDRINUSE");
    expectUnwound(stopSpy);
  });

  it("an api.json write failure closes the listening API server too", async () => {
    let closed = false;
    const d = deps({
      startApiServer: async () => ({
        port: 1,
        host: "127.0.0.1",
        address: () => null,
        close: async () => {
          closed = true;
        },
      }),
    }).d;
    // A directory where api.json should be: the atomic rename fails.
    mkdirSync(join(dataDir, "api.json", "occupied"), { recursive: true });
    await expect(startKernel(options(), d)).rejects.toThrow();
    expect(closed).toBe(true);
    expect(storeIsReopenable()).toBe(true);
  });

  it("an auth provider that cannot be selected rejects and releases the store lock", async () => {
    const d = deps({
      selectAuthProvider: async () => {
        throw new Error("auth provider \"nope\" is not available in this build");
      },
    }).d;
    await expect(startKernel(options({ authProviderId: "nope" }), d)).rejects.toThrow(/not available/);
    expect(storeIsReopenable()).toBe(true);
  });
});
