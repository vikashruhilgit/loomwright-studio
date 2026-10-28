// Wright's settable fields through `POST /agents/:id/set` (phase 5 item 07):
// the owner sets `WRIGHT_SET_FIELDS` (model, effort and the three limits) in
// `config/agents/wright.json` through the one write path crew members use,
// with one `agent_settings_set` event naming `by: "owner"`. Every other field
// stays `reserved`, and a refused request never creates `wright.json`. Wright's
// roster entry reports the file's limits. A temp data dir and a controllable
// clock; the verbs run through `runCli` against a real loopback API server.
// Never a daemon, a session, the real Keychain or a model.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentSettingsPath, agentsContribution, createAgent, readAgentSettings } from "../src/agents/index.js";
import { AGENT_SET_FIELDS, WRIGHT_SET_FIELDS } from "../src/agents/roster.js";
import { API_TOKEN_KEYCHAIN_SERVICE, startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { defaultWrightSettingsJson } from "../src/brain/settings.js";
import { runCli } from "../src/cli/index.js";
import { PHASE1_RESERVED, mergeContributions } from "../src/features/index.js";
import { events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const T0 = "2026-10-21T10:00:00.000Z";
const TOKEN = "0123456789abcdef".repeat(4);
const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);

let env: LoopEnv;
let server: ApiServer;

beforeEach(async () => {
  env = loopEnv(T0);
  server = await startApiServer(
    {
      store: env.store,
      sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
      loop: { start: () => {}, stop: async () => {} },
      authProviders: [stubProvider()],
      token: TOKEN,
      routes: mergeContributions([agentsContribution], PHASE1_RESERVED).routes,
    },
    { now: env.now },
  );
  writeFileSync(join(env.dataDir, "api.json"), JSON.stringify({ port: server.port, host: "127.0.0.1", pid: process.pid, started_at: T0 }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await server.close();
  env.cleanup();
});

/** `studio <argv>` against the live API server, with the shipped contributions. */
async function studio(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    dataDir: env.dataDir,
    keychain: { read: (s) => (s === API_TOKEN_KEYCHAIN_SERVICE ? TOKEN : undefined) },
    isPidAlive: () => true,
    stdout: { write: (c: string) => out.push(c) },
    stderr: { write: (c: string) => err.push(c) },
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

/** A raw request to the live API server. */
async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function wrightFile(): string {
  return agentSettingsPath(env.dataDir, "wright");
}

/** A `wright.json` an owner wrote: every field the reader reads, a policy status label and an unknown key the reader drops. */
const WRIGHT = {
  model: "claude-opus-5",
  effort: "high",
  permission_mode: "default",
  tool_policy: { status: "approved", allowedTools: ["Read", "Grep"], allowedBashPrefixes: [] },
  limits: { tokens_per_day: 100000, sessions_at_once: 2 },
  owner_note: "kept by set",
};

/** `content` written as `wright.json` (two-space JSON, as `set` writes it); its bytes. */
function writeWright(content: Record<string, unknown> = WRIGHT): Buffer {
  const file = wrightFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  return readFileSync(file);
}

function wrightJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(wrightFile(), "utf8")) as Record<string, unknown>;
}

/** Wright's entry as `GET /agents` answers it now. */
async function wrightListed(): Promise<Record<string, unknown>> {
  const r = await api("GET", "/agents");
  expect(r.status).toBe(200);
  return (r.body.agents as Record<string, unknown>[])[0] as Record<string, unknown>;
}

const RESERVED_MESSAGE = (): string =>
  `Wright is not a crew member: set takes only model, effort, limits.tokens_per_day, limits.sessions_at_once, limits.delegation_depth or connectors for it; edit the rest in ${wrightFile()}`;

// ---- The allow-list mirrors the contract -------------------------------------------------------

describe("WRIGHT_SET_FIELDS", () => {
  it("equals the contract's WrightSetField union, in order, and is a subset of the crew's set fields", () => {
    const match = /export type WrightSetField =([^;]*);/.exec(readFileSync(CONTRACT, "utf8"));
    expect(match).not.toBeNull();
    const union = (match?.[1] ?? "").split("|").map((part) => {
      const literal = /^"([^"]+)"$/.exec(part.trim());
      if (literal === null) throw new Error(`WrightSetField member is not a string literal: ${part.trim()}`);
      return literal[1];
    });
    expect([...WRIGHT_SET_FIELDS]).toEqual(union);
    for (const f of WRIGHT_SET_FIELDS) expect(AGENT_SET_FIELDS as readonly string[]).toContain(f);
    expect(Object.isFrozen(WRIGHT_SET_FIELDS)).toBe(true);
  });
});

// ---- AC1: model changes, the rest deep-equal, one event ---------------------------------------

describe("POST /agents/wright/set (AC1)", () => {
  it("model changes only model (every other key, the unknown one included, deep-equal), answers Wright's entry, one event by owner; the same value changes nothing", async () => {
    writeWright();
    const r = await api("POST", "/agents/wright/set", { field: "model", value: "claude-sonnet-5-5" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ agent: await wrightListed(), field: "model", old: "claude-opus-5", new: "claude-sonnet-5-5", changed: true });
    expect((r.body.agent as Record<string, unknown>).model).toBe("claude-sonnet-5-5");
    expect(wrightJson()).toEqual({ ...WRIGHT, model: "claude-sonnet-5-5" });
    expect(readdirSync(dirname(wrightFile()))).toEqual(["wright.json"]);
    expect(events(env.store, "agent_settings_set").map((e) => e.payload)).toEqual([{ id: "wright", field: "model", old: "claude-opus-5", new: "claude-sonnet-5-5", by: "owner" }]);

    const bytes = readFileSync(wrightFile());
    const same = await api("POST", "/agents/wright/set", { field: "model", value: "claude-sonnet-5-5" });
    expect(same).toEqual({ status: 200, body: { agent: await wrightListed(), field: "model", old: "claude-sonnet-5-5", new: "claude-sonnet-5-5", changed: false } });
    expect(readFileSync(wrightFile()).equals(bytes)).toBe(true);
    expect(events(env.store, "agent_settings_set")).toHaveLength(1);
  });

  it("effort and each limit set through the same path; a crew member's payload still has no by", async () => {
    writeWright();
    for (const [f, value, old, next] of [
      ["effort", "low", "high", "low"],
      ["limits.tokens_per_day", "5000", 100000, 5000],
      ["limits.sessions_at_once", "3", 2, 3],
      ["limits.delegation_depth", "1", null, 1],
    ] as const) {
      const r = await api("POST", "/agents/wright/set", { field: f, value });
      expect(r.status, f).toBe(200);
      expect([r.body.old, r.body.new, r.body.changed], f).toEqual([old, next, true]);
    }
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && [read.settings.effort, read.settings.limits]).toEqual(["low", { tokens_per_day: 5000, sessions_at_once: 3, delegation_depth: 1 }]);
    expect(events(env.store, "agent_settings_set").every((e) => e.payload.by === "owner" && e.payload.id === "wright")).toBe(true);

    const mason = createAgent(
      env.store,
      env.dataDir,
      {
        id: "mason",
        display_name: "Mason",
        avatar: { shape: "crab", hue: "crew-teal" },
        persona: "Mason reviews code.",
        duties: ["Review."],
        boundaries: [],
        model: "claude-sonnet-5",
        permission_mode: "default",
        tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [], never: [] },
        limits: { sessions_at_once: 1 },
        workspaces: [join(dirname(env.dataDir), "work")],
      },
      { by: "owner", homeDir: join(dirname(env.dataDir), "home") },
      env.now(),
    );
    expect(mason.ok ? "" : mason.message).toBe("");
    const crew = await api("POST", "/agents/mason/set", { field: "limits.sessions_at_once", value: "2" });
    expect(crew.status).toBe(200);
    expect((crew.body.agent as Record<string, unknown>).id).toBe("mason");
    expect(events(env.store, "agent_settings_set").at(-1)?.payload).toEqual({ id: "mason", field: "limits.sessions_at_once", old: 1, new: 2 });
  });

  it("an owner's hand edit between the read and the rename wins for Wright too: 409 settings_changed, nothing written, no event", async () => {
    writeWright();
    const edited = readFileSync(wrightFile(), "utf8").replace('"claude-opus-5"', '"claude-haiku-4-5"');
    const transaction = env.store.transaction.bind(env.store);
    vi.spyOn(env.store, "transaction").mockImplementation(((fn: () => unknown) => {
      writeFileSync(wrightFile(), edited);
      return transaction(fn);
    }) as typeof env.store.transaction);
    const r = await api("POST", "/agents/wright/set", { field: "effort", value: "low" });
    expect(r).toEqual({ status: 409, body: { error: "settings_changed", file: wrightFile(), message: `${wrightFile()} changed while it was being set; nothing was written; try again` } });
    expect(readFileSync(wrightFile(), "utf8")).toBe(edited);
    expect(readdirSync(dirname(wrightFile()))).toEqual(["wright.json"]);
    expect(events(env.store, "agent_settings_set")).toEqual([]);
  });

  it("a wright.json the reader refuses is never rewritten (settings_invalid naming it)", async () => {
    const bytes = writeWright({ ...WRIGHT, never: ["git_push"] });
    const r = await api("POST", "/agents/wright/set", { field: "model", value: "m" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("settings_invalid");
    expect(r.body.file).toBe(wrightFile());
    expect(readFileSync(wrightFile()).equals(bytes)).toBe(true);
    expect(events(env.store, "agent_settings_set")).toEqual([]);
  });
});

// ---- AC2: every other field is reserved ---------------------------------------------------------

describe("Wright's reserved fields (AC2)", () => {
  it("tool_policy, permission_mode and any other field are 409 reserved naming wright.json; the bytes unchanged, no event", async () => {
    const bytes = writeWright();
    for (const [f, value] of [
      ["tool_policy", "x"],
      ["permission_mode", "plan"],
      ["never", "git_push"],
      ["workspaces", "/tmp"],
      ["display_name", "Boss"],
      ["limits", "1"],
      ["owner_note", "y"],
    ] as const) {
      const r = await api("POST", "/agents/wright/set", { field: f, value });
      expect(r, f).toEqual({ status: 409, body: { error: "reserved", message: RESERVED_MESSAGE() } });
    }
    expect(readFileSync(wrightFile()).equals(bytes)).toBe(true);
    expect(events(env.store)).toEqual([]);
  });

  it("on a fresh data dir, a refused field, a refused value or a bad body creates no wright.json", async () => {
    expect((await api("POST", "/agents/wright/set", { field: "tool_policy", value: "x" })).body.error).toBe("reserved");
    expect((await api("POST", "/agents/wright/set", { field: "permission_mode", value: "plan" })).body.error).toBe("reserved");
    expect((await api("POST", "/agents/wright/set", { field: "model", value: "none" })).body.error).toBe("invalid_input");
    expect((await api("POST", "/agents/wright/set", { field: "limits.tokens_per_day", value: "0" })).body.error).toBe("invalid_input");
    expect((await api("POST", "/agents/wright/set", { field: "model" })).body.error).toBe("invalid_body");
    expect(existsSync(wrightFile())).toBe(false);
    expect(events(env.store)).toEqual([]);
  });
});

// ---- Phase 6 item 08: connectors is a list field, apart from the scalar lists ---------------------

describe("connectors is set apart from the scalar fields (phase 6 item 08)", () => {
  it("neither scalar set-field list names it, and a set of another field keeps the grant (the grant itself: agents-connectors-grant.test.ts)", async () => {
    expect(AGENT_SET_FIELDS as readonly string[]).not.toContain("connectors");
    expect(WRIGHT_SET_FIELDS as readonly string[]).not.toContain("connectors");
    writeWright({ ...WRIGHT, connectors: ["github"] });
    expect((await api("POST", "/agents/wright/set", { field: "model", value: "claude-sonnet-5-5" })).status).toBe(200);
    expect(wrightJson().connectors).toEqual(["github"]);
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && read.settings.connectors).toEqual(["github"]);
  });
});

// ---- AC3: none clears; bad values are refused ---------------------------------------------------

describe("Wright's none and refused values (AC3)", () => {
  it("limits.sessions_at_once none removes the key (limits stays, also when empty); effort none clears effort", async () => {
    writeWright();
    const r = await api("POST", "/agents/wright/set", { field: "limits.sessions_at_once", value: "none" });
    expect([r.status, r.body.old, r.body.new, r.body.changed]).toEqual([200, 2, null, true]);
    expect(wrightJson().limits).toEqual({ tokens_per_day: 100000 });
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok).toBe(true);
    expect(read.ok && read.settings.limits).toEqual({ tokens_per_day: 100000 });

    expect((await api("POST", "/agents/wright/set", { field: "limits.tokens_per_day", value: "none" })).status).toBe(200);
    expect(wrightJson().limits).toEqual({});
    expect((await api("POST", "/agents/wright/set", { field: "effort", value: "none" })).status).toBe(200);
    expect("effort" in wrightJson()).toBe(false);
    const after = readAgentSettings(env.dataDir, "wright");
    expect(after.ok && [after.settings.effort, after.settings.limits]).toEqual([null, {}]);
    expect(events(env.store, "agent_settings_set").map((e) => e.payload)).toEqual([
      { id: "wright", field: "limits.sessions_at_once", old: 2, new: null, by: "owner" },
      { id: "wright", field: "limits.tokens_per_day", old: 100000, new: null, by: "owner" },
      { id: "wright", field: "effort", old: "high", new: null, by: "owner" },
    ]);
  });

  it("model none, 0, a non-integer or a negative limit are 400 invalid_input naming the field; the file unchanged", async () => {
    const bytes = writeWright();
    for (const [f, value] of [
      ["model", "none"],
      ["model", "two words"],
      ["limits.tokens_per_day", "0"],
      ["limits.sessions_at_once", "1.5"],
      ["limits.delegation_depth", "-1"],
      ["limits.tokens_per_day", "lots"],
    ] as const) {
      const r = await api("POST", "/agents/wright/set", { field: f, value });
      expect(r.status, `${f} ${value}`).toBe(400);
      expect([r.body.error, r.body.field], `${f} ${value}`).toEqual(["invalid_input", f]);
    }
    expect(readFileSync(wrightFile()).equals(bytes)).toBe(true);
    expect(events(env.store)).toEqual([]);
  });
});

// ---- AC6: the CLI ---------------------------------------------------------------------------------

describe("studio agents set wright (AC6)", () => {
  it("model exits 0 naming old and new; tool_policy exits 1 reserved naming wright.json; a 0 limit exits 1 invalid_input", async () => {
    writeWright();
    expect(await studio("agents", "set", "wright", "model", "claude-sonnet-5-5")).toEqual({ code: 0, stdout: "studio: agent wright model set to claude-sonnet-5-5 (was claude-opus-5)\n", stderr: "" });
    const bytes = readFileSync(wrightFile());
    expect(await studio("agents", "set", "wright", "tool_policy", "x")).toEqual({ code: 1, stdout: "", stderr: `studio: agent wright not changed: reserved: ${RESERVED_MESSAGE()}\n` });
    expect(await studio("agents", "set", "wright", "limits.tokens_per_day", "0")).toEqual({
      code: 1,
      stdout: "",
      stderr: "studio: agent wright not changed: invalid_input: limits.tokens_per_day must be a positive whole number, or none (no limit)\n",
    });
    expect(readFileSync(wrightFile()).equals(bytes)).toBe(true);
    expect(events(env.store, "agent_settings_set")).toHaveLength(1);
  });
});

// ---- AC7: a fresh data dir ------------------------------------------------------------------------

describe("a fresh data dir (AC7)", () => {
  it("model creates wright.json with Wright's default content and sets it on top; the result reads ok", async () => {
    const r = await api("POST", "/agents/wright/set", { field: "model", value: "m1" });
    expect([r.status, r.body.old, r.body.new, r.body.changed]).toEqual([200, null, "m1", true]);
    expect(wrightJson()).toEqual({ ...(JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>), model: "m1" });
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && read.settings.model).toBe("m1");
    expect(events(env.store, "agent_settings_set").map((e) => e.payload)).toEqual([{ id: "wright", field: "model", old: null, new: "m1", by: "owner" }]);
  });

  it("model_unset blocks effort or a limit (the default file is created, never rewritten); after a model, they set", async () => {
    for (const [f, value] of [
      ["effort", "high"],
      ["limits.tokens_per_day", "5000"],
    ] as const) {
      const r = await api("POST", "/agents/wright/set", { field: f, value });
      expect([r.status, r.body.error, r.body.file], f).toEqual([409, "model_unset", wrightFile()]);
      expect(readFileSync(wrightFile(), "utf8"), f).toBe(defaultWrightSettingsJson());
    }
    expect(events(env.store)).toEqual([]);
    expect((await api("POST", "/agents/wright/set", { field: "model", value: "m1" })).status).toBe(200);
    expect((await api("POST", "/agents/wright/set", { field: "effort", value: "high" })).status).toBe(200);
    expect((await api("POST", "/agents/wright/set", { field: "limits.tokens_per_day", value: "5000" })).status).toBe(200);
    const read = readAgentSettings(env.dataDir, "wright");
    expect(read.ok && [read.settings.model, read.settings.effort, read.settings.limits]).toEqual(["m1", "high", { tokens_per_day: 5000 }]);
  });

  it("a broken data dir (config/agents a regular file) is 409 settings_invalid naming wright.json, never a 500; nothing written, no event", async () => {
    const agentsDir = dirname(wrightFile());
    mkdirSync(dirname(agentsDir), { recursive: true });
    writeFileSync(agentsDir, "not a directory");
    const r = await api("POST", "/agents/wright/set", { field: "model", value: "m1" });
    expect([r.status, r.body.error, r.body.file, r.body.field]).toEqual([409, "settings_invalid", wrightFile(), "the file"]);
    expect(r.body.message).toMatch(new RegExp(`^${wrightFile().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: unreadable \\(E[A-Z]+\\)$`));
    expect(readFileSync(agentsDir, "utf8")).toBe("not a directory");
    expect(events(env.store)).toEqual([]);
  });
});

// ---- AC8: Wright's roster entry reports its limits ------------------------------------------------

describe("Wright's roster entry reports its limits (AC8)", () => {
  it("GET /agents reports tokens_per_day and sessions_at_once from wright.json; list shows them", async () => {
    writeWright();
    expect(await wrightListed()).toMatchObject({ id: "wright", model: "claude-opus-5", settings_error: null, tokens_per_day: 100000, sessions_at_once: 2 });
    expect((await studio("agents", "list")).stdout.split("\n")[0]).toBe('wright "Wright" whale accent: active; model claude-opus-5; tokens today 0/100000; sessions 0/2; created by -');
  });

  it("a model_unset file's limits count; unset is null; an absent file is null and is not created", async () => {
    expect(await wrightListed()).toMatchObject({ tokens_per_day: null, sessions_at_once: null, settings_error: null });
    expect(existsSync(wrightFile())).toBe(false);

    writeWright({ ...WRIGHT, model: null, limits: { tokens_per_day: 7000, sessions_at_once: 1 } });
    expect(await wrightListed()).toMatchObject({ model: null, settings_error: "model_unset", tokens_per_day: 7000, sessions_at_once: 1 });

    writeWright({ ...WRIGHT, limits: { delegation_depth: 2 } });
    expect(await wrightListed()).toMatchObject({ settings_error: null, tokens_per_day: null, sessions_at_once: null });
  });
});
