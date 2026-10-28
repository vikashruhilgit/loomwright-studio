// The owner's connectors grant (phase 6 item 08, `kernel/src/agents/roster.ts`
// and `charter-files.ts`): `studio agents set <id> connectors github|none` and
// `POST /agents/:id/set {field: "connectors", value}` write or remove
// `connectors: ["github"]` in `config/agents/<id>.json` through the one write
// path, append one `agent_settings_set` event, and change which tools that
// agent's NEXT session lists. No session can do the same.
//
// A kernel composed with the shipped features over the fake spawner/query
// (session-fakes.ts), plus one probe contribution holding a plain tool and a
// stub `requiresConnector: "github"` tool (item 06's real GitHub tools are not
// built; `integrations-foundation.test.ts` uses the same idiom). The real
// `connectorsFor(dataDir)` -> `SessionManager` `mcpServers` -> `toolsForConnectors`
// path decides what a session lists. Never the real SDK, a model, a Keychain
// or the network.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { agentFilePaths, agentSettingsPath, createAgent, ensureAgentFiles, readAgentSettings, renderRoleMd, validateCharter } from "../src/agents/index.js";
import type { Charter } from "../src/agents/index.js";
import { CONNECTORS_FIELD } from "../src/agents/roster.js";
import { API_TOKEN_KEYCHAIN_SERVICE } from "../src/api/index.js";
import { defaultWrightSettingsJson } from "../src/brain/index.js";
import { runCli } from "../src/cli/index.js";
import { defineTool } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel } from "../src/kernel.js";
import type { ToolPolicy } from "../src/sessions/types.js";
import { events } from "./loop-helpers.js";
import { stubNotifierContributions } from "./notifier-stub.js";
import { fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const MODEL = "claude-haiku-4-5";
const T0 = "2026-10-28T10:00:00.000Z";
const GITHUB_TOOL_NAME = "kernel_fake_github_read";
const PLAIN_TOOL_NAME = "kernel_fake_plain";

/** A contributed tool offered only to agents granted GitHub. */
const GITHUB_TOOL = defineTool({
  name: GITHUB_TOOL_NAME,
  description: "A stub GitHub tool for the grant tests.",
  shape: { repo: z.string() },
  requiresConnector: "github",
  handler: () => "ok",
});

/** A contributed tool every session gets. */
const PLAIN_TOOL = defineTool({ name: PLAIN_TOOL_NAME, description: "A stub tool with no connector.", shape: {}, handler: () => "ok" });

const UPDATE = "mcp__kernel__kernel_agent_update";

let tmp: string;
let dataDir: string;
let home: string;
let kernel: Kernel;
let fakes: ReturnType<typeof fakeSessions>;
let token: string;
const kernels: Kernel[] = [];

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "studio-connectors-grant-"));
  dataDir = join(tmp, "data");
  home = join(tmp, "home");
  mkdirSync(home);
  // Wright's settings: a model, and the default policy (the kernel never picks a model).
  const wright = agentSettingsPath(dataDir, "wright");
  mkdirSync(join(wright, ".."), { recursive: true });
  writeFileSync(wright, `${JSON.stringify({ ...(JSON.parse(defaultWrightSettingsJson()) as object), model: MODEL }, null, 2)}\n`);
  const keychain = new Map<string, string>();
  fakes = fakeSessions();
  kernel = await startKernel(
    {
      dataDir,
      env: { PATH: "/usr/bin" },
      sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: 10 },
      // `contributions` replaces the shipped list: keep it (notifier stubbed) and add the probe's two tools.
      contributions: [...stubNotifierContributions(), { name: "probe", tools: [PLAIN_TOOL, GITHUB_TOOL] }],
    },
    {
      keychain: { read: (service) => keychain.get(service) },
      keychainWriter: { add: (service, _account, secret) => void keychain.set(service, secret) },
      sessionDeps: { ...fakes.deps, homeDir: home },
      selectAuthProvider: async () => stubProvider(),
      availableProviderIds: async () => ["api-key"],
      loopDeps: { tickMs: 3_600_000 },
    },
  );
  kernels.push(kernel);
  token = keychain.get(API_TOKEN_KEYCHAIN_SERVICE) ?? "";
  cliKeychain = keychain;
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  rmSync(tmp, { recursive: true, force: true });
});

let cliKeychain: Map<string, string>;

// ---- Helpers ---------------------------------------------------------------------

function charter(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    display_name: id[0]?.toUpperCase() + id.slice(1),
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful reviewer who comments on pull requests.",
    duties: ["Review the pull requests the owner sends."],
    boundaries: ["Never push code."],
    model: "claude-sonnet-5",
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [], never: ["git_push"] },
    // No sessions_at_once: a test starts several sessions for one agent, and a started session stays running.
    limits: { tokens_per_day: 200000 },
    workspaces: [join(tmp, "work")],
    ...extra,
  };
}

function validated(c: Record<string, unknown>): Charter {
  const r = validateCharter(c, { dataDir, homeDir: home });
  if (!r.ok) throw new Error(`not valid: ${r.message}`);
  return r.charter;
}

function create(id: string): void {
  const r = createAgent(kernel.store, dataDir, charter(id), { by: "owner", homeDir: home }, new Date(T0));
  expect(r.ok ? "" : r.message).toBe("");
}

function fileOf(id: string): string {
  return agentSettingsPath(dataDir, id);
}

function jsonOf(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fileOf(id), "utf8")) as Record<string, unknown>;
}

/** A raw request to the kernel's loopback API. */
async function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${kernel.api.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** `studio <argv>` against this kernel. */
async function studio(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, { dataDir, keychain: { read: (s) => cliKeychain.get(s) }, stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) } });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

const setEvents = () => events(kernel.store, "agent_settings_set").map((e) => e.payload);

/** Start a session for `agent` and return the tool names its kernel MCP server lists. */
async function listedToolsOf(agent: string, policy: ToolPolicy = { allowedTools: ["Read"], allowedBashPrefixes: [] }): Promise<{ listed: string[]; call: FakeCall }> {
  const before = fakes.calls.length;
  await kernel.sessions.startSession({ agent, prompt: "Hi.", model: MODEL, permissionMode: "default", cwd: tmp, policy, closeInputOnResult: false });
  const call = fakes.calls[before] as FakeCall;
  const server = (call.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
  return { listed: Object.keys((server?.instance as { _registeredTools: Record<string, unknown> })._registeredTools), call };
}

type Decision = { permissionDecision: string; permissionDecisionReason: string };

/** `call`'s PreToolUse gate, as the CLI would call it from `tmp`. */
async function gate(call: FakeCall, tool: string, toolInput: unknown): Promise<Decision> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  const input = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
  return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
}

// ---- AC1, AC2: grant and revoke a crew member --------------------------------------------

describe("set <id> connectors github | none for a crew member (AC1, AC2)", () => {
  it("AC1: github writes connectors [github], every other key unchanged, one event {old: null, new: [github]}; the next session lists the GitHub tool, a session started before does not", async () => {
    create("reviewer");
    const before = jsonOf("reviewer");
    expect("connectors" in before).toBe(false);
    const earlier = await listedToolsOf("reviewer");
    expect(earlier.listed).toContain(PLAIN_TOOL_NAME);
    expect(earlier.listed).not.toContain(GITHUB_TOOL_NAME);

    const r = await studio("agents", "set", "reviewer", "connectors", "github");
    expect(r).toEqual({ code: 0, stdout: "studio: agent reviewer connectors set to github (was no connectors)\n", stderr: "" });
    expect(jsonOf("reviewer")).toEqual({ ...before, connectors: ["github"] });
    expect(setEvents()).toEqual([{ id: "reviewer", field: "connectors", old: null, new: ["github"] }]);
    const read = readAgentSettings(dataDir, "reviewer", { homeDir: home });
    expect(read.ok && read.settings.connectors).toEqual(["github"]);

    const next = await listedToolsOf("reviewer");
    expect(next.listed).toEqual(expect.arrayContaining([PLAIN_TOOL_NAME, GITHUB_TOOL_NAME]));
    expect(earlier.listed).not.toContain(GITHUB_TOOL_NAME);
  });

  it("AC2: none removes the key (every other key unchanged), one event {old: [github], new: null}, the next session lists no GitHub tool; a second none answers changed:false with no event", async () => {
    create("reviewer");
    const base = jsonOf("reviewer");
    expect((await api("POST", "/agents/reviewer/set", { field: "connectors", value: "github" })).body).toMatchObject({ field: "connectors", old: null, new: ["github"], changed: true });
    expect((await listedToolsOf("reviewer")).listed).toContain(GITHUB_TOOL_NAME);

    const revoked = await api("POST", "/agents/reviewer/set", { field: "connectors", value: "none" });
    expect([revoked.status, revoked.body.field, revoked.body.old, revoked.body.new, revoked.body.changed]).toEqual([200, "connectors", ["github"], null, true]);
    expect(jsonOf("reviewer")).toEqual(base);
    expect("connectors" in jsonOf("reviewer")).toBe(false);
    expect(setEvents()).toEqual([
      { id: "reviewer", field: "connectors", old: null, new: ["github"] },
      { id: "reviewer", field: "connectors", old: ["github"], new: null },
    ]);
    expect((await listedToolsOf("reviewer")).listed).not.toContain(GITHUB_TOOL_NAME);

    const bytes = readFileSync(fileOf("reviewer"));
    const again = await api("POST", "/agents/reviewer/set", { field: "connectors", value: "none" });
    expect([again.status, again.body.old, again.body.new, again.body.changed]).toEqual([200, null, null, false]);
    expect(readFileSync(fileOf("reviewer")).equals(bytes)).toBe(true);
    expect(setEvents()).toHaveLength(2);
    expect(await studio("agents", "set", "reviewer", "connectors", "none")).toEqual({ code: 0, stdout: "studio: agent reviewer connectors was already no connectors\n", stderr: "" });
    expect(setEvents()).toHaveLength(2);
  });

  it("github on an agent already holding it is changed:false with no event and the same bytes", async () => {
    create("reviewer");
    await api("POST", "/agents/reviewer/set", { field: "connectors", value: "github" });
    const bytes = readFileSync(fileOf("reviewer"));
    const r = await api("POST", "/agents/reviewer/set", { field: "connectors", value: "github" });
    expect([r.status, r.body.old, r.body.new, r.body.changed]).toEqual([200, ["github"], ["github"], false]);
    expect(readFileSync(fileOf("reviewer")).equals(bytes)).toBe(true);
    expect(setEvents()).toHaveLength(1);
  });

  it("a file holding connectors [] and the value none read as the same value: changed:false, bytes and events unchanged", async () => {
    create("reviewer");
    writeFileSync(fileOf("reviewer"), `${JSON.stringify({ ...jsonOf("reviewer"), connectors: [] }, null, 2)}\n`);
    const bytes = readFileSync(fileOf("reviewer"));
    const r = await api("POST", "/agents/reviewer/set", { field: "connectors", value: "none" });
    expect([r.status, r.body.old, r.body.new, r.body.changed]).toEqual([200, null, null, false]);
    expect(readFileSync(fileOf("reviewer")).equals(bytes)).toBe(true);
    expect(setEvents()).toEqual([]);
  });

  it("a settings file the reader refuses is never rewritten by a connectors set", async () => {
    create("reviewer");
    writeFileSync(fileOf("reviewer"), `${JSON.stringify({ ...jsonOf("reviewer"), connectors: ["gitlab"] }, null, 2)}\n`);
    const bytes = readFileSync(fileOf("reviewer"));
    const r = await api("POST", "/agents/reviewer/set", { field: "connectors", value: "github" });
    expect([r.status, r.body.error]).toEqual([409, "settings_invalid"]);
    expect(readFileSync(fileOf("reviewer")).equals(bytes)).toBe(true);
    expect(setEvents()).toEqual([]);
  });
});

// ---- AC3: Wright ------------------------------------------------------------------------------

describe("set wright connectors github (AC3)", () => {
  it("writes connectors [github] to wright.json with the event by:owner while GitHub is not connected; Wright's next session lists the GitHub tool", async () => {
    // No connectors row exists: the kernel never reads the connector's state to decide the grant.
    expect(kernel.store.prepare<[], number>("SELECT COUNT(*) FROM connectors").pluck().get()).toBe(0);
    const before = jsonOf("wright");
    expect((await listedToolsOf("wright")).listed).not.toContain(GITHUB_TOOL_NAME);
    const r = await studio("agents", "set", "wright", "connectors", "github");
    expect(r.code).toBe(0);
    expect(jsonOf("wright")).toEqual({ ...before, connectors: ["github"] });
    expect(setEvents()).toEqual([{ id: "wright", field: "connectors", old: null, new: ["github"], by: "owner" }]);
    expect((await listedToolsOf("wright")).listed).toContain(GITHUB_TOOL_NAME);

    const revoke = await api("POST", "/agents/wright/set", { field: "connectors", value: "none" });
    expect([revoke.status, revoke.body.old, revoke.body.new, revoke.body.changed]).toEqual([200, ["github"], null, true]);
    expect(jsonOf("wright")).toEqual(before);
    expect(setEvents()[1]).toEqual({ id: "wright", field: "connectors", old: ["github"], new: null, by: "owner" });
  });
});

// ---- AC4: refused values -------------------------------------------------------------------------

describe("a connectors value other than github or none (AC4)", () => {
  it("gitlab, GitHub, the empty string, github with a space and None are 400 invalid_input naming connectors; the file and the events are unchanged", async () => {
    create("reviewer");
    const bytes = readFileSync(fileOf("reviewer"));
    for (const value of ["gitlab", "GitHub", "", "github ", "None", "github,gitlab"]) {
      const r = await api("POST", "/agents/reviewer/set", { field: "connectors", value });
      expect([r.status, r.body.error, r.body.field, r.body.message], JSON.stringify(value)).toEqual([400, "invalid_input", "connectors", "connectors must be github or none"]);
    }
    expect((await api("POST", "/agents/wright/set", { field: "connectors", value: "gitlab" })).body).toMatchObject({ error: "invalid_input", field: "connectors" });
    expect((await api("POST", "/agents/reviewer/set", { field: "connectors", value: ["github"] })).body.error).toBe("invalid_body");
    expect(readFileSync(fileOf("reviewer")).equals(bytes)).toBe(true);
    expect(setEvents()).toEqual([]);
    const cli = await studio("agents", "set", "reviewer", "connectors", "gitlab");
    expect(cli).toEqual({ code: 1, stdout: "", stderr: "studio: agent reviewer not changed: invalid_input: connectors must be github or none\n" });
  });

  it("a refused Wright connectors value on a fresh data dir does not create wright.json", async () => {
    unlinkSync(fileOf("wright"));
    expect((await api("POST", "/agents/wright/set", { field: "connectors", value: "gitlab" })).status).toBe(400);
    expect(existsSync(fileOf("wright"))).toBe(false);
  });

  it("a valid Wright connectors set on a fresh data dir creates the default wright.json, answers 409 model_unset and grants nothing", async () => {
    unlinkSync(fileOf("wright"));
    const r = await api("POST", "/agents/wright/set", { field: "connectors", value: "github" });
    expect([r.status, r.body.error, r.body.file]).toEqual([409, "model_unset", fileOf("wright")]);
    expect(jsonOf("wright")).toEqual(JSON.parse(defaultWrightSettingsJson()));
    expect(setEvents()).toEqual([]);
    const roster = (await api("GET", "/agents")).body.agents as { id: string; connectors: unknown }[];
    expect(roster[0]).toMatchObject({ id: "wright", connectors: null });
  });

  it("the field is named once: CONNECTORS_FIELD is connectors; a list field other than it stays refused", async () => {
    expect(CONNECTORS_FIELD).toBe("connectors");
    create("reviewer");
    expect((await api("POST", "/agents/reviewer/set", { field: "workspaces", value: "/tmp" })).body).toMatchObject({ error: "invalid_input", field: "field" });
    expect((await api("POST", "/agents/wright/set", { field: "workspaces", value: "/tmp" })).body.error).toBe("reserved");
    const usage = await studio("agents", "set");
    expect(usage.stderr).toContain("connectors (github or none)");
  });
});

// ---- AC5: sessions cannot set it -------------------------------------------------------------------------

describe("no session can widen the grant (AC5)", () => {
  const WRIGHT_POLICY: ToolPolicy = { allowedTools: [UPDATE], allowedBashPrefixes: [] };
  const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

  it("Wright's kernel_agent_update with changes {connectors: [github]} is refused: nothing held, the bytes unchanged, no agent_settings_set or agent_updated event", async () => {
    create("reviewer");
    const bytes = readFileSync(fileOf("reviewer"));
    const w = await listedToolsOf("wright", WRIGHT_POLICY);
    const d = await gate(w.call, UPDATE, { id: "reviewer", changes: { connectors: ["github"] }, expected_sha256: sha(bytes), idempotency_key: "u1" });
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: /);
    expect(d.permissionDecisionReason).not.toMatch(/approval_required/);
    // Beside a valid change it is still refused, never silently dropped: only `.strict()` on the changes object does that.
    const mixed = await gate(w.call, UPDATE, { id: "reviewer", changes: { model: "claude-opus-5", connectors: ["github"] }, expected_sha256: sha(bytes), idempotency_key: "u2" });
    expect(mixed.permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: /);
    expect(mixed.permissionDecisionReason).not.toMatch(/approval_required/);
    expect(readFileSync(fileOf("reviewer")).equals(bytes)).toBe(true);
    expect(kernel.store.prepare<[], number>("SELECT COUNT(*) FROM approvals").pluck().get()).toBe(0);
    expect(events(kernel.store, "agent_settings_set")).toEqual([]);
    expect(events(kernel.store, "agent_updated")).toEqual([]);
  });

  it("a crew session's Write, Edit and Bash aimed at its own settings file are denied (the protected-path rail): the bytes unchanged, no event", async () => {
    create("reviewer");
    const bytes = readFileSync(fileOf("reviewer"));
    const file = fileOf("reviewer");
    const s = await listedToolsOf("reviewer", { allowedTools: ["Read", "Write", "Edit", "Bash"], allowedBashPrefixes: ["sed", "cp"] });
    const attempts: [string, unknown][] = [
      ["Write", { file_path: file, content: JSON.stringify({ ...jsonOf("reviewer"), connectors: ["github"] }) }],
      ["Edit", { file_path: file, old_string: '"never"', new_string: '"connectors": ["github"], "never"' }],
      ["Bash", { command: `sed -i '' 's/"never"/"connectors": ["github"], "never"/' ${file}` }],
      ["Bash", { command: `cp ${join(tmp, "elsewhere.json")} ${file}` }],
    ];
    for (const [tool, input] of attempts) {
      const d = await gate(s.call, tool, input);
      expect(d.permissionDecision, `${tool} ${JSON.stringify(input)}`).toBe("deny");
      expect(d.permissionDecisionReason, `${tool} ${JSON.stringify(input)}`).toContain("protected_kernel_path");
    }
    expect(readFileSync(file).equals(bytes)).toBe(true);
    expect(events(kernel.store, "agent_settings_set")).toEqual([]);
    expect(events(kernel.store, "agent_updated")).toEqual([]);
  });
});

// ---- AC6: the roster ---------------------------------------------------------------------------------------

describe("GET /agents carries connectors (AC6)", () => {
  it("[github] for a granted agent, [] for one without a grant, null for one whose settings file does not read ok; Wright's follows its file", async () => {
    create("reviewer");
    create("scout");
    create("broken");
    await api("POST", "/agents/reviewer/set", { field: "connectors", value: "github" });
    writeFileSync(fileOf("broken"), "not json");
    const roster = (await api("GET", "/agents")).body.agents as { id: string; connectors: unknown }[];
    const byId = Object.fromEntries(roster.map((e) => [e.id, e.connectors]));
    expect(byId).toEqual({ wright: [], broken: null, reviewer: ["github"], scout: [] });
    await api("POST", "/agents/wright/set", { field: "connectors", value: "github" });
    expect(((await api("GET", "/agents")).body.agents as { id: string; connectors: unknown }[])[0]).toMatchObject({ id: "wright", connectors: ["github"] });
    // `show` carries the same entry, and the CLI's show prints the line.
    expect(((await api("GET", "/agents/reviewer")).body.agent as { connectors: unknown }).connectors).toEqual(["github"]);
    expect((await studio("agents", "show", "reviewer")).stdout).toContain("\n  connectors: github\n");
    expect((await studio("agents", "show", "scout")).stdout).toContain("\n  connectors: none\n");
    expect((await studio("agents", "show", "broken")).stdout).toContain("\n  connectors: - (the settings file does not read ok)\n");
  });

  it("Wright's entry is null when wright.json is absent (a listing never creates it)", async () => {
    unlinkSync(fileOf("wright"));
    const roster = (await api("GET", "/agents")).body.agents as { id: string; connectors: unknown }[];
    expect(roster[0]).toMatchObject({ id: "wright", connectors: null });
    expect(existsSync(fileOf("wright"))).toBe(false);
  });
});

// ---- AC7: role.md --------------------------------------------------------------------------------------------

describe("role.md names the grant (AC7)", () => {
  it("renderRoleMd is byte-identical with no grant (absent or empty) and names GitHub in What the kernel enforces with one", () => {
    const c = validated(charter("reviewer"));
    expect(renderRoleMd(c, [])).toBe(renderRoleMd(c));
    expect(renderRoleMd(c, undefined)).toBe(renderRoleMd(c));
    expect(renderRoleMd(c)).toContain("tool policy, never list, limits and workspaces. A call outside them is refused");
    const granted = renderRoleMd(c, ["github"]);
    expect(granted).toContain("tool policy, never list, limits, workspaces and connectors (GitHub). A call outside them is refused");
    expect(granted.replace("limits, workspaces and connectors (GitHub)", "limits and workspaces")).toBe(renderRoleMd(c));
  });

  it("a role.md re-created by ensureAgentFiles after the grant names GitHub; an existing role.md is never rewritten (the owner's edit wins)", async () => {
    create("reviewer");
    const role = agentFilePaths(dataDir, "reviewer").memory[0] as string;
    expect(readFileSync(role, "utf8")).not.toContain("connectors (GitHub)");
    await api("POST", "/agents/reviewer/set", { field: "connectors", value: "github" });

    // The set never rewrites an existing role.md, and neither does the self-heal.
    const before = readFileSync(role);
    expect(ensureAgentFiles(kernel.store, dataDir, "reviewer", { homeDir: home })).toEqual({ ok: true, created: [] });
    expect(readFileSync(role).equals(before)).toBe(true);

    unlinkSync(role);
    expect(ensureAgentFiles(kernel.store, dataDir, "reviewer", { homeDir: home })).toEqual({ ok: true, created: [role] });
    expect(readFileSync(role, "utf8")).toContain("limits, workspaces and connectors (GitHub). A call outside them is refused");

    // Revoked: a re-created role.md is back to the grant-free text.
    await api("POST", "/agents/reviewer/set", { field: "connectors", value: "none" });
    unlinkSync(role);
    ensureAgentFiles(kernel.store, dataDir, "reviewer", { homeDir: home });
    expect(readFileSync(role, "utf8")).toBe(renderRoleMd(validated(charter("reviewer"))));
  });
});
