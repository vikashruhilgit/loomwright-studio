// D42: the owner chooses the auth provider and stores an API key from Settings.
// `PUT /settings/auth-provider` and `PUT /settings/api-key`, called as handlers
// over a real store with an in-memory Keychain. Never a real Keychain or restart.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_KEY_KEYCHAIN_SERVICE } from "../src/auth/api-key.js";
import { AUTH_CHOICE_FILE, writeAuthChoice } from "../src/auth/choice.js";
import type { AuthControl, RestartOutcome } from "../src/auth/choice.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthHealth } from "../src/auth/types.js";
import type { ContributedRouteRequest, StatusView } from "../src/features/contribution.js";
import { RESTART_DELAY_MS, settingsRoutes } from "../src/gui/settings.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

const NOW = "2026-11-18T10:00:00.000Z";
const KEY = `sk-ant-api03-${"known-test-key-value_AB-cd-".repeat(4)}end`;
let env: LoopEnv;

beforeEach(() => {
  env = loopEnv(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  env.cleanup();
});

const route = (path: string) => settingsRoutes.find((r) => r.method === "PUT" && r.path === path)!;

function keychain(initial: Record<string, string> = {}, failWrite = false) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    reader: { read: (service: string) => items.get(service) },
    writer: {
      add(service: string, _account: string, secret: string) {
        if (failWrite) throw new KeychainError(service, 1, null, "write");
        if (items.has(service)) throw new KeychainError(service, 45, null, "write");
        items.set(service, secret);
      },
    },
    deleter: { delete: (service: string) => items.delete(service) },
  };
}

interface Setup {
  readonly inUse?: string;
  readonly source?: AuthControl["source"];
  readonly health?: Record<string, AuthHealth>;
  readonly restart?: () => RestartOutcome;
  readonly kc?: ReturnType<typeof keychain>;
}

function request(body: unknown, { inUse = "subscription-token", source = "default", health = {}, restart, kc = keychain() }: Setup = {}): ContributedRouteRequest {
  const available = ["api-key", "subscription-token"];
  const auth: AuthControl = {
    inUse,
    source,
    available,
    dataDir: env.store.dataDir,
    keychainReader: kc.reader,
    keychainWriter: kc.writer,
    keychainDeleter: kc.deleter,
    ...(restart === undefined ? {} : { restart }),
  };
  const status: StatusView = {
    // As the kernel lists them: the provider in use first.
    auth: () => [inUse, ...available.filter((id) => id !== inUse)].map((id) => ({ id, account: null, health: health[id] ?? { status: "ok" } })),
    loomwright: () => undefined,
  };
  return { params: {}, query: {}, body, store: env.store, now: () => env.now(), status, auth };
}

const choice = () => {
  const path = join(env.store.dataDir, AUTH_CHOICE_FILE);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
};
const events = (kind: string) => env.store.prepare<[string], string>("SELECT payload_json FROM events WHERE kind = ?").pluck().all(kind);

describe("PUT /settings/auth-provider (D42)", () => {
  const put = route("/settings/auth-provider");

  it("records the choice and restarts the kernel on it after the answer", async () => {
    vi.useFakeTimers();
    const restart = vi.fn((): RestartOutcome => ({ restarting: true }));
    const res = await put.handler(request({ provider: "api-key" }, { restart }));
    expect(res).toEqual({ status: 202, body: { in_use: "subscription-token", chosen: "api-key", restarting: true } });
    expect(choice()).toEqual({ provider: "api-key" });
    expect(restart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RESTART_DELAY_MS);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(events("auth_provider_chosen").map((p) => JSON.parse(p))).toEqual([{ from: "subscription-token", to: "api-key", restarting: true }]);
  });

  it("a restart that finds a session running is deferred and recorded; the choice waits for the next start", async () => {
    vi.useFakeTimers();
    // The kernel's restart closes admission, counts, and answers (kernel-auth-restart.test.ts); here it found one running.
    const restart = vi.fn((): RestartOutcome => ({ restarting: false, running: 1 }));
    expect((await put.handler(request({ provider: "api-key" }, { restart }))).status).toBe(202);
    vi.advanceTimersByTime(RESTART_DELAY_MS);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(choice()).toEqual({ provider: "api-key" });
    expect(events("auth_provider_restart_deferred").map((p) => JSON.parse(p))).toEqual([{ to: "api-key", running: 1 }]);
  });

  it("a restart that throws (the kernel already stopping) is never an uncaught exception", async () => {
    vi.useFakeTimers();
    const restart = vi.fn((): RestartOutcome => {
      throw new Error("store closed");
    });
    expect((await put.handler(request({ provider: "api-key" }, { restart }))).status).toBe(202);
    expect(() => vi.advanceTimersByTime(RESTART_DELAY_MS)).not.toThrow();
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("with no restart wired, records the choice for the next start", async () => {
    const res = await put.handler(request({ provider: "api-key" }));
    expect(res).toEqual({ status: 202, body: { in_use: "subscription-token", chosen: "api-key", restarting: false } });
    expect(choice()).toEqual({ provider: "api-key" });
  });

  it("choosing the provider in use only records it, with no restart", async () => {
    const restart = vi.fn((): RestartOutcome => ({ restarting: true }));
    const res = await put.handler(request({ provider: "subscription-token" }, { restart }));
    expect(res).toEqual({ status: 200, body: { in_use: "subscription-token", chosen: "subscription-token", restarting: false } });
    expect(choice()).toEqual({ provider: "subscription-token" });
    expect(restart).not.toHaveBeenCalled();
  });

  it("refuses a provider whose credential is not usable, so no session would fail on it", async () => {
    const res = await put.handler(request({ provider: "api-key" }, { health: { "api-key": { status: "missing" } } }));
    expect(res).toEqual({ status: 409, body: { error: "provider_not_ready", provider: "api-key", health: { status: "missing" } } });
    expect(choice()).toBeUndefined();
  });

  it("refuses while a session runs, since the restart would stop it", async () => {
    env.store.prepare("INSERT INTO sessions (agent, status, model, started_at, created_at, updated_at) VALUES ('wright', 'running', 'm', ?, ?, ?)").run(NOW, NOW, NOW);
    const restart = vi.fn((): RestartOutcome => ({ restarting: true }));
    const res = await put.handler(request({ provider: "api-key" }, { restart }));
    expect(res).toEqual({ status: 409, body: { error: "sessions_running", count: 1 } });
    expect(choice()).toBeUndefined();
    expect(restart).not.toHaveBeenCalled();
  });

  it("refuses while a flag or env var picks the provider, since the choice would not apply", async () => {
    for (const source of ["flag", "env"] as const) {
      expect(await put.handler(request({ provider: "api-key" }, { source }))).toEqual({ status: 409, body: { error: "provider_overridden", source } });
    }
    expect(choice()).toBeUndefined();
  });

  it("refuses an unknown provider and a malformed body", async () => {
    expect(await put.handler(request({ provider: "claude-ai-login" }))).toEqual({ status: 400, body: { error: "unknown_provider", available: ["api-key", "subscription-token"] } });
    expect((await put.handler(request({}))).status).toBe(400);
    expect((await put.handler(request("api-key"))).status).toBe(400);
  });
});

describe("PUT /settings/api-key (D42)", () => {
  const put = route("/settings/api-key");

  it("replaces the Keychain item, reads it back, and never echoes or records the key", async () => {
    const kc = keychain({ [API_KEY_KEYCHAIN_SERVICE]: "sk-old-key" });
    const res = await put.handler(request({ key: KEY }, { kc }));
    expect(res).toEqual({ status: 200, body: { stored: true, health: { status: "ok" } } });
    expect(kc.items.get(API_KEY_KEYCHAIN_SERVICE)).toBe(KEY);
    expect(JSON.stringify(res)).not.toContain(KEY);
    expect(events("auth_api_key_set")).toEqual([JSON.stringify({ provider: "api-key" })]);
    const all = env.store.prepare<[], string>("SELECT payload_json FROM events").pluck().all().join("\n");
    expect(all).not.toContain(KEY);
  });

  it("refuses an empty key, whitespace, or a character the Keychain writer cannot take, without echoing it", async () => {
    const kc = keychain();
    // D42 / OPEN_QUESTIONS: the entry needs the sk-ant- prefix and a whole length, and never takes a subscription token.
    const cases = ["", "sk-ant key", `${KEY}\n`, "sk'ant", "-sk", KEY.slice(0, 60), `x${KEY.slice(1)}`, `sk-ant-oat01-${"a".repeat(90)}`, `${KEY.slice(0, 40)} ${KEY.slice(40)}`];
    for (const key of cases) {
      const res = await put.handler(request({ key }, { kc }));
      expect(res.status).toBe(400);
      expect((res.body as { error: string }).error).toBe("invalid_key");
      if (key !== "") expect(JSON.stringify(res)).not.toContain(key.trim());
    }
    expect(kc.items.size).toBe(0);
  });

  it("answers keychain_write_failed when the write fails, with no event", async () => {
    const res = await put.handler(request({ key: KEY }, { kc: keychain({}, true) }));
    expect(res).toEqual({ status: 500, body: { error: "keychain_write_failed", previous_key: "none" } });
    expect(events("auth_api_key_set")).toEqual([]);
  });

  // 23u (review of PR #292): replacing a key deletes the old item first, so a failed add must put the old key back.
  function failingAdd(initial: Record<string, string>, mode: "throw" | "silent", restoreFails = false) {
    const kc = keychain(initial);
    let adds = 0;
    kc.writer.add = (service: string, _account: string, secret: string) => {
      adds += 1;
      if (adds === 1) {
        if (mode === "throw") throw new KeychainError(service, 1, null, "write");
        return; // `security -i` exited 0 without writing the item
      }
      if (restoreFails) throw new KeychainError(service, 1, null, "write");
      kc.items.set(service, secret);
    };
    return kc;
  }

  it("puts the old key back when the new one's write fails", async () => {
    const kc = failingAdd({ [API_KEY_KEYCHAIN_SERVICE]: "sk-old-key" }, "throw");
    const res = await put.handler(request({ key: KEY }, { kc }));
    expect(res).toEqual({ status: 500, body: { error: "keychain_write_failed", previous_key: "kept" } });
    expect(kc.items.get(API_KEY_KEYCHAIN_SERVICE)).toBe("sk-old-key");
  });

  it("puts the old key back when the write reports success but the read-back finds nothing", async () => {
    const kc = failingAdd({ [API_KEY_KEYCHAIN_SERVICE]: "sk-old-key" }, "silent");
    const res = await put.handler(request({ key: KEY }, { kc }));
    expect(res).toEqual({ status: 500, body: { error: "keychain_write_failed", previous_key: "kept" } });
    expect(kc.items.get(API_KEY_KEYCHAIN_SERVICE)).toBe("sk-old-key");
  });

  it("says so when the old key could not be put back either", async () => {
    const kc = failingAdd({ [API_KEY_KEYCHAIN_SERVICE]: "sk-old-key" }, "throw", true);
    const res = await put.handler(request({ key: KEY }, { kc }));
    expect(res).toEqual({ status: 500, body: { error: "keychain_write_failed", previous_key: "removed" } });
    expect(JSON.stringify(res)).not.toContain("sk-old-key");
  });

  it("with no old key, a failed write says there was none", async () => {
    const res = await put.handler(request({ key: KEY }, { kc: failingAdd({}, "throw") }));
    expect(res).toEqual({ status: 500, body: { error: "keychain_write_failed", previous_key: "none" } });
  });
});

describe("GET /settings pending_provider (23u)", () => {
  const get = settingsRoutes.find((r) => r.method === "GET" && r.path === "/settings")!;
  const read = async (setup: Setup = {}) => {
    const req = request(undefined, setup);
    const status: StatusView = { auth: req.status!.auth, loomwright: () => ({ installed: false }) as never };
    const res = await get.handler({ ...req, status });
    return (res.body as { pending_provider: string | null }).pending_provider;
  };

  it("shows a recorded choice that differs from the provider in use, so a deferred switch is visible", async () => {
    expect(await read()).toBeNull();
    writeAuthChoice(env.store.dataDir, "api-key");
    expect(await read()).toBe("api-key");
    writeAuthChoice(env.store.dataDir, "subscription-token");
    expect(await read()).toBeNull();
  });

  it("is null when a flag or env var picks the provider, or the choice names a provider this build lacks", async () => {
    writeAuthChoice(env.store.dataDir, "api-key");
    expect(await read({ source: "env" })).toBeNull();
    expect(await read({ source: "flag" })).toBeNull();
    writeAuthChoice(env.store.dataDir, "bedrock");
    expect(await read()).toBeNull();
  });

  it("keeping the provider in use withdraws a pending choice", async () => {
    writeAuthChoice(env.store.dataDir, "api-key");
    const put = route("/settings/auth-provider");
    expect((await put.handler(request({ provider: "subscription-token" }))).status).toBe(200);
    expect(await read()).toBeNull();
  });
});
