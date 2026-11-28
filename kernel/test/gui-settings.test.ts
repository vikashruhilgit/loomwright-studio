// Phase 7 item 08: the `gui` feature's `settings` part. `GET /settings` against a
// real store, through a real API server. Never the SDK, a model or a real
// Keychain: the provider is a stub whose token value is a known string.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAST_PROPOSED_TOOL_LISTS, registerProposedToolsAudit } from "../src/agents/past-tool-lists.js";
import { startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import type { AuthProvider } from "../src/auth/types.js";
import { recordTokenCreated } from "../src/auth/metadata.js";
import { PROPOSED_ALLOWED_TOOLS, wrightSettingsPath } from "../src/brain/settings.js";
import { buildToolCatalogue } from "../src/features/catalogue.js";
import type { ToolCatalogue } from "../src/features/catalogue.js";
import { LOOMWRIGHT_COMMAND_NEEDS } from "../src/features/job-needs.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { ContributedRouteRequest, StatusView } from "../src/features/contribution.js";
import { GUI_PARTS, settingsPart, settingsRoutes } from "../src/gui/index.js";
import { notifierKindOf } from "../src/gui/settings.js";
import type { LoomwrightAdapterStatus } from "../src/loomwright/active-install.js";
import { loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { NO_REF, appendEvent } from "../src/loop/internal.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const TOKEN = "0123456789abcdef".repeat(4);
const NOW = "2026-10-14T10:00:00.000Z";
const SECRET = "sk-ant-oat01-known-secret-value-for-the-test";
const OK_INSTALL: LoomwrightAdapterStatus = {
  status: "ok",
  install_path: "/plugins/loomwright",
  plugin_version: "17.22.0",
  contract_schema_version: 1,
  host_switch: true,
};

let env: LoopEnv;
let server: ApiServer | undefined;

beforeEach(() => {
  env = loopEnv(NOW);
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  env.cleanup();
});

interface Composition {
  readonly providers?: readonly AuthProvider[];
  /** `null`: the manager has no `loomwrightStatus` (no reader). */
  readonly reader?: (() => LoomwrightAdapterStatus) | null;
  readonly catalogue?: ToolCatalogue;
}

async function serve({ providers = [secretProvider()], reader = () => OK_INSTALL, catalogue }: Composition = {}): Promise<ApiServer> {
  server = await startApiServer(
    {
      store: env.store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon, ...(reader === null ? {} : { loomwrightStatus: reader }) },
      loop: { start: () => {}, stop: async () => {} },
      authProviders: providers,
      token: TOKEN,
      routes: mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes,
      ...(catalogue === undefined ? {} : { toolCatalogue: catalogue }),
    },
    { now: () => env.now() },
  );
  return server;
}

/** A provider that holds a known token value everywhere a leak could come from. */
function secretProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return stubProvider({ buildEnv: () => ({ PATH: "/usr/bin", CLAUDE_CODE_OAUTH_TOKEN: SECRET }), ...overrides, ...({ token: SECRET } as object) });
}

async function get(api: ApiServer, auth = true): Promise<{ status: number; text: string; body: any }> {
  const res = await fetch(`http://127.0.0.1:${api.port}/settings`, { headers: auth ? { Authorization: `Bearer ${TOKEN}` } : {} });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

describe("the settings part (phase 7 item 08)", () => {
  it("is the sixth gui part, holds the read route and the two auth routes (D42), none unauthenticated", () => {
    expect(GUI_PARTS[5]).toBe(settingsPart);
    expect(settingsPart.name).toBe("settings");
    expect(settingsPart.routes).toBe(settingsRoutes);
    expect(Object.isFrozen(settingsRoutes)).toBe(true);
    expect(settingsRoutes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /settings", "PUT /settings/auth-provider", "PUT /settings/api-key"]);
    expect(settingsRoutes.filter((r) => r.unauthenticated === true)).toEqual([]);
  });

  it("needs the API token", async () => {
    const api = await serve();
    const res = await get(api, false);
    expect(res.status).toBe(401);
  });
});

describe("GET /settings", () => {
  it("answers exactly the contract's keys, from the provider, the store and the reader, and never the token value", async () => {
    recordTokenCreated(env.store, "stub-provider", "owner@example.test", "2026-09-01T00:00:00.000Z", env.now());
    const res = await get(await serve());
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["data_dir", "loomwright", "notifier", "pending_provider", "provider", "provider_source", "providers", "wright_tools"]);
    expect(Object.keys(res.body.provider).sort()).toEqual(["account", "health", "id", "token_created_at"]);
    expect(res.body.provider).toEqual({ id: "stub-provider", account: "owner@example.test", health: { status: "ok" }, token_created_at: "2026-09-01T00:00:00.000Z" });
    expect(res.body.data_dir).toBe(env.store.dataDir);
    expect(["terminal-notifier", "osascript", "none"]).toContain(res.body.notifier);
    expect(res.body.loomwright).toEqual(OK_INSTALL);
    expect(res.text).not.toContain(SECRET);
    expect(res.text).not.toContain("sk-ant-test-secret-value");
  });

  it("reports a null token_created_at when none is recorded", async () => {
    const res = await get(await serve());
    expect(res.status).toBe(200);
    expect(res.body.provider.token_created_at).toBeNull();
  });

  it("reports each health the provider gives, with the account as the provider reports it", async () => {
    const res = await get(await serve({ providers: [secretProvider({ health: () => ({ status: "expiring", days: 12 }) })] }));
    expect(res.body.provider.health).toEqual({ status: "expiring", days: 12 });
  });

  it("answers a provider whose health() throws as error health_threw, with 200 and no message", async () => {
    const res = await get(await serve({ providers: [secretProvider({ health: () => { throw new Error(`keychain said ${SECRET}`); } })] }));
    expect(res.status).toBe(200);
    expect(res.body.provider.health).toEqual({ status: "error", reason: "health_threw" });
    expect(res.text).not.toContain(SECRET);
  });

  it("reports a null account when reading the account throws", async () => {
    const throwing = secretProvider();
    Object.defineProperty(throwing, "account", { get: () => { throw new Error("no account"); } });
    const res = await get(await serve({ providers: [throwing] }));
    expect(res.status).toBe(200);
    expect(res.body.provider.account).toBeNull();
  });

  it("answers a reader that throws as status_threw, with 200", async () => {
    const res = await get(await serve({ reader: () => { throw new Error("reader broke"); } }));
    expect(res.status).toBe(200);
    expect(res.body.loomwright).toMatchObject({ status: "error", reason: "status_threw", message: "reader broke" });
  });

  it("passes an adapter error through as it is", async () => {
    const error: LoomwrightAdapterStatus = { status: "error", reason: "status_threw", path: "", message: "x" };
    const res = await get(await serve({ reader: () => error }));
    expect(res.body.loomwright).toEqual(error);
  });

  it("answers 503 settings_unavailable no_auth_provider when the composition has no provider", async () => {
    const res = await get(await serve({ providers: [] }));
    expect(res).toMatchObject({ status: 503, body: { error: "settings_unavailable", reason: "no_auth_provider" } });
  });

  it("answers 503 settings_unavailable no_loomwright_reader when the composition has no reader", async () => {
    const res = await get(await serve({ reader: null }));
    expect(res).toMatchObject({ status: 503, body: { error: "settings_unavailable", reason: "no_loomwright_reader" } });
  });

  it("answers 503 settings_unavailable no_status_view for a request with no status view (a handler call: a real server always builds one)", async () => {
    const route = settingsRoutes[0]!;
    const req: ContributedRouteRequest = { params: {}, query: {}, body: undefined, store: env.store, now: () => env.now() };
    expect(await route.handler(req)).toEqual({ status: 503, body: { error: "settings_unavailable", reason: "no_status_view" } });
  });

  it("builds its answer from the view it is given: the first provider only, at the request's instant", async () => {
    const route = settingsRoutes[0]!;
    const seen: Date[] = [];
    const status: StatusView = {
      auth: (at) => {
        seen.push(at);
        return [{ id: "first", account: null, health: { status: "missing" } }, { id: "second", account: "b", health: { status: "ok" } }];
      },
      loomwright: () => OK_INSTALL,
    };
    const res = await route.handler({ params: {}, query: {}, body: undefined, store: env.store, now: () => env.now(), status });
    expect(res.status).toBe(200);
    expect((res.body as any).provider).toEqual({ id: "first", account: null, health: { status: "missing" }, token_created_at: null });
    expect(seen).toEqual([env.now()]);
  });
});

describe("GET /settings wright_tools (wa-c)", () => {
  const catalogue = (): ToolCatalogue => buildToolCatalogue(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools, LOOMWRIGHT_COMMAND_NEEDS);
  const file = (): string => wrightSettingsPath(env.store.dataDir);
  const writeWright = (status: string | undefined, allowedTools: readonly string[]): Buffer => {
    mkdirSync(join(env.store.dataDir, "config", "agents"), { recursive: true });
    const policy = { ...(status === undefined ? {} : { status }), allowedTools: [...allowedTools], allowedBashPrefixes: [] };
    writeFileSync(file(), `${JSON.stringify({ model: null, effort: null, permission_mode: "default", tool_policy: policy }, null, 2)}\n`);
    return readFileSync(file());
  };

  it("wright_tools.missing names the catalogue job and purpose of each missing proposed tool; GET /settings writes nothing", async () => {
    const cat = catalogue();
    const list15 = PAST_PROPOSED_TOOL_LISTS[0] as readonly string[];
    // A registered sink, as a running kernel has: the route still never upgrades (it reads the file raw).
    const unregister = registerProposedToolsAudit(env.store.dataDir, {
      transaction: (fn) => env.store.transaction(fn),
      record: (kind, payload) => appendEvent(env.store, kind, NO_REF, payload, env.now().toISOString()),
    });
    try {
      const old = writeWright("proposed", list15);
      const res = await get(await serve({ catalogue: cat }));
      expect(res.status).toBe(200);
      const expected = PROPOSED_ALLOWED_TOOLS.filter((t) => !list15.includes(t));
      expect(expected.length).toBeGreaterThan(0);
      expect(res.body.wright_tools.status).toBe("proposed");
      expect(res.body.wright_tools.missing.map((m: { name: string }) => m.name)).toEqual(expected);
      for (const m of res.body.wright_tools.missing) {
        expect(Object.keys(m).sort()).toEqual(["job", "name", "purpose"]);
        const tool = cat.tools.find((t) => `mcp__kernel__${t.name}` === m.name);
        expect(tool, m.name).toBeDefined();
        expect(m.job).toBe(cat.jobs.find((j) => j.id === tool?.job)?.label);
        expect(m.purpose).toBe(tool?.purpose);
        expect(typeof m.job === "string" && typeof m.purpose === "string" && m.purpose !== "").toBe(true);
      }
      expect(readFileSync(file()).equals(old)).toBe(true);
      expect(readdirSync(join(env.store.dataDir, "config", "agents"))).toEqual(["wright.json"]);
    } finally {
      unregister();
    }
  });

  it("an absent wright.json is null and stays absent", async () => {
    const res = await get(await serve({ catalogue: catalogue() }));
    expect(res.status).toBe(200);
    expect(res.body.wright_tools).toBeNull();
    expect(existsSync(file())).toBe(false);
  });

  it("a tool the catalogue does not list (Read) has a null job and purpose, and an owner's status is reported as it is", async () => {
    writeWright("owner", ["mcp__kernel__kernel_task_list"]);
    const res = await get(await serve({ catalogue: catalogue() }));
    const missing = res.body.wright_tools.missing as { name: string; job: string | null; purpose: string | null }[];
    expect(res.body.wright_tools.status).toBe("owner");
    expect(missing.map((m) => m.name)).toEqual(PROPOSED_ALLOWED_TOOLS.filter((t) => t !== "mcp__kernel__kernel_task_list"));
    for (const name of ["Read", "Glob", "Grep"]) expect(missing.find((m) => m.name === name)).toEqual({ name, job: null, purpose: null });
  });

  it("the current list has nothing missing; an unset status is null; with no catalogue, job and purpose are null", async () => {
    writeWright(undefined, PROPOSED_ALLOWED_TOOLS);
    expect((await get(await serve())).body.wright_tools).toEqual({ status: null, missing: [] });
    await server?.close();
    writeWright("proposed", ["Read"]);
    const res = await get(await serve());
    expect(res.body.wright_tools.missing.every((m: { job: unknown; purpose: unknown }) => m.job === null && m.purpose === null)).toBe(true);
  });

  it("an unreadable wright.json is null, never a 503", async () => {
    mkdirSync(join(env.store.dataDir, "config", "agents"), { recursive: true });
    writeFileSync(file(), "{not json");
    const res = await get(await serve());
    expect(res.status).toBe(200);
    expect(res.body.wright_tools).toBeNull();
    expect(readFileSync(file(), "utf8")).toBe("{not json");
  });
});

describe("the notifier mapping", () => {
  it("maps click to terminal-notifier, plain to osascript and none to none", () => {
    expect(notifierKindOf({ kind: "click", path: "/opt/homebrew/bin/terminal-notifier" })).toBe("terminal-notifier");
    expect(notifierKindOf({ kind: "plain", path: "/usr/bin/osascript", reason: "no terminal-notifier" })).toBe("osascript");
    expect(notifierKindOf({ kind: "none", reason: "not macOS (linux)" })).toBe("none");
  });
});
