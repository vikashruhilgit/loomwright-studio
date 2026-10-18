// Wright's charter tools (phase 4 item 07, `kernel/src/agents/charter-tools.ts`):
// `kernel_agent_create` and `kernel_agent_update` are always held, refused
// before the hold (`CHARTER_TOOL_REFUSALS`) or shown to the owner with the
// enforced lines first, and applied by the kernel on the owner's `once`
// (`applyOnApproval`); `kernel_agent_list` reads the roster with each
// settings file's sha256.
//
// Kernel-level cases run a kernel composed with the shipped features over the
// fake spawner/query (session-fakes.ts): the real PreToolUse gate, the real
// kernel MCP server's tool handlers and the real `studio` CLI over the
// loopback API. Gate-level cases run the session manager with the agents
// part's pre-hold check, and decide through `decideApproval` with the shipped
// applier. Store-level cases call the tools' handlers directly. Never the
// real SDK, a model or a live session.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_CREATE_TOOL_NAME,
  AGENT_LIST_TOOL_NAME,
  AGENT_UPDATE_TOOL_NAME,
  CHARTER_TOOL_REFUSALS,
  charterToolsPart,
} from "../src/agents/charter-tools.js";
import { agentFilePaths, agentSettingsPath, createAgent, ensureAgentFiles, getAgent, readAgentSettings, renderAgentSettingsJson, renderRoleMd, validateCharter } from "../src/agents/index.js";
import type { Charter } from "../src/agents/index.js";
import { decideApproval, listApprovals } from "../src/approvals/index.js";
import { MAX_APPROVAL_DISPLAY } from "../src/approvals/store.js";
import type { AppliedApproval } from "../src/approvals/index.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import { runCli } from "../src/cli/index.js";
import { NO_REF, appendEvent } from "../src/loop/internal.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import { SessionManager } from "../src/sessions/manager.js";
import type { ToolPolicy } from "../src/sessions/types.js";
import { Store } from "../src/store/index.js";
import { approvalApplierOf, contributedToolHandler, heldToolCheckOf } from "../src/tools/server.js";
import type { KernelToolContext, KernelToolResult } from "../src/tools/server.js";
import { count, events } from "./loop-helpers.js";
import { fakeMsg, fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const K = "mcp__kernel__";
const CREATE = `${K}${AGENT_CREATE_TOOL_NAME}`;
const UPDATE = `${K}${AGENT_UPDATE_TOOL_NAME}`;
const LIST = `${K}${AGENT_LIST_TOOL_NAME}`;
const MODEL = "claude-haiku-4-5";
const T0 = "2026-10-19T10:00:00.000Z";
/** Wright's own session may call the three charter tools (the two held ones are still always held). */
const WRIGHT_POLICY: ToolPolicy = { allowedTools: [CREATE, UPDATE, LIST], allowedBashPrefixes: [] };
const TOOLS = charterToolsPart.tools;

let tmp: string;
let dataDir: string;
let pluginDir: string;
let home: string;
const clock = { at: new Date(T0) };
const kernels: Kernel[] = [];
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-charter-tools-"));
  dataDir = join(tmp, "data");
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
  clock.at = new Date(T0);
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  for (const s of stores.splice(0)) if (s.isOpen) s.close();
  // A test that failed while a folder was unwritable must not leave it so.
  if (existsSync(join(dataDir, "config", "agents"))) chmodSync(join(dataDir, "config", "agents"), 0o700);
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Fixtures ------------------------------------------------------------------

/** A comment-only reviewer: it comments on pull requests and never pushes (`never` enforced, `boundaries` prose). */
function charter(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "mason",
    display_name: "Mason",
    avatar: { shape: "crab", hue: "crew-teal" },
    persona: "A careful reviewer who comments on pull requests.\nIt explains each finding plainly.",
    duties: ["Review the pull requests the owner sends and comment on them."],
    boundaries: ["Never push code or open a pull request."],
    model: "claude-sonnet-5",
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read", "Grep", "Bash"], allowedBashPrefixes: ["gh pr view", "gh pr comment"], never: ["git_push", "gh_pr_create"] },
    limits: { tokens_per_day: 200000, sessions_at_once: 1 },
    workspaces: [join(tmp, "work", "payments")],
    ...extra,
  };
}

function validated(c: unknown): Charter {
  const r = validateCharter(c, { dataDir });
  if (!r.ok) throw new Error(`not valid: ${r.message}`);
  return r.charter;
}

/** `n` distinct tool names of about 150 characters each (a valid charter's tools may be up to 64 of 200). */
function longTools(n: number, tag = "t"): string[] {
  return Array.from({ length: n }, (_, i) => `mcp__wide__${tag.repeat(135)}_${String(i).padStart(2, "0")}`);
}

const ENFORCED = 'enforced: never: git_push, gh_pr_create; tools: Read, Grep, Bash; bash prefixes: "gh pr view", "gh pr comment"';

/** Write Wright's settings: a model and its permission mode (as the other kernel-level tests do). */
function writeWrightSettings(): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...settings, model: MODEL }, null, 2)}\n`);
}

/** The files under the data dir's crew folders that exist for `id`. */
function presentFiles(id: string): string[] {
  return agentFilePaths(dataDir, id).all.filter((p) => existsSync(p));
}

const sha = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

/** Call `call`'s PreToolUse gate as the CLI would, from `tmp`. */
function gateOf(call: FakeCall): (tool: string, toolInput: unknown) => Promise<Decision> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  return async (tool, toolInput) => {
    const input = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
    return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
  };
}

function value<T = Record<string, unknown>>(r: KernelToolResult | undefined): T {
  expect(r?.isError, r?.content[0]?.text).toBeUndefined();
  return JSON.parse(r?.content[0]?.text ?? "null") as T;
}

function errorText(r: KernelToolResult | undefined): string {
  expect(r?.isError, r?.content[0]?.text).toBe(true);
  return r?.content[0]?.text ?? "";
}

interface ListEntry {
  id: string;
  display_name: string;
  avatar: { shape: string; hue: string };
  status: string;
  created_by?: string;
  settings: unknown;
  settings_error: string | null;
  sha256?: string | null;
}

// ---- The kernel harness ----------------------------------------------------------

function memoryKeychain() {
  const items = new Map<string, string>();
  const reader: KeychainReader = { read: (service) => items.get(service) };
  const writer: KeychainWriter = {
    add(service, _account, secret) {
      if (items.has(service)) throw new KeychainError(service, 45, null, "write");
      items.set(service, secret);
    },
  };
  return { reader, writer };
}

interface RegisteredTool {
  handler(args: unknown, extra: unknown): Promise<KernelToolResult>;
}

/** The tools on a launch's kernel MCP server (the server the session would call). */
function toolsOf(call: FakeCall): Record<string, RegisteredTool> {
  const server = (call.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
  return (server?.instance as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

/**
 * A kernel with the shipped features, Wright's settings written, and a
 * session started for `agent` under `policy` (its gate and its kernel tools).
 */
async function bootKernel() {
  writeWrightSettings();
  const keychain = memoryKeychain();
  const fakes = fakeSessions({ script: (call) => call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown")) });
  const d: KernelDeps = {
    keychain: keychain.reader,
    keychainWriter: keychain.writer,
    sessionDeps: { ...fakes.deps, homeDir: home },
    selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
    availableProviderIds: async () => ["api-key"],
    // One tick at most: no handler (the brain's) picks up the decisions' messages meanwhile.
    loopDeps: { tickMs: 3_600_000 },
    now: () => clock.at,
  };
  const kernel = await startKernel({ dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: pluginDir, stopGraceMs: 10 } }, d);
  kernels.push(kernel);

  async function session(agent: string, policy: ToolPolicy) {
    const handle = await kernel.sessions.startSession({ agent, prompt: "Draft a crew member.", model: MODEL, permissionMode: "default", cwd: tmp, policy, closeInputOnResult: false });
    const call = fakes.calls[fakes.calls.length - 1] as FakeCall;
    const tools = toolsOf(call);
    const tool = (name: string, args: unknown): Promise<KernelToolResult> => {
      const t = tools[name];
      if (t === undefined) throw new Error(`no tool ${name} on the kernel server`);
      return t.handler(args, {});
    };
    return { id: handle.id, gate: gateOf(call), tool };
  }

  /** `studio <argv>` against this kernel. */
  async function studio(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(argv, { dataDir, keychain: keychain.reader, stdout: { write: (c: string) => stdout.push(c) }, stderr: { write: (c: string) => stderr.push(c) } });
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  }

  /** The text of the message a decision on approval `id` queued for Wright. */
  const decisionMessage = (id: number): string | undefined =>
    kernel.store.prepare<[string], string>("SELECT json_extract(payload_json, '$.text') FROM event_queue WHERE kind = 'message' AND source_ref = ?").pluck().get(`approval:${id}`);

  return { kernel, store: kernel.store, session, studio, decisionMessage };
}

// ---- The gate harness --------------------------------------------------------------

/**
 * A session manager (fake spawner/query) whose gate has the charter tools'
 * pre-hold check, with Wright's session started; the tools' handlers run with
 * `ctx.sessions` = the manager. `decide` is the owner's decision with the
 * shipped applier over the charter tools.
 */
async function bootManager() {
  writeWrightSettings();
  const store = new Store({ dataDir });
  stores.push(store);
  const now = (): Date => clock.at;
  const fakes = fakeSessions();
  const toolSessions: KernelToolContext["sessions"] = { stopSession: (id: number) => manager.stopSession(id), getSession: (id: number) => manager.getSession(id) };
  const contextOf = (sessionId: number): KernelToolContext => ({ store, sessions: toolSessions, sessionId, now });
  const manager: SessionManager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, heldToolCheck: heldToolCheckOf(TOOLS, contextOf) },
    { ...fakes.deps, homeDir: home, now },
  );
  async function session(agent: string, policy: ToolPolicy = WRIGHT_POLICY) {
    const handle = await manager.startSession({ agent, prompt: "Draft a crew member.", model: MODEL, permissionMode: "default", cwd: tmp, policy, closeInputOnResult: false });
    return { id: handle.id, gate: gateOf(fakes.calls[fakes.calls.length - 1] as FakeCall) };
  }
  const wright = await session("wright");
  const applier = approvalApplierOf(TOOLS);
  const toolOf = (name: string) => {
    const t = TOOLS.find((x) => x.name === name);
    if (t === undefined) throw new Error(`no tool ${name}`);
    return t;
  };
  const tool = (name: string, args: unknown, sessionId = wright.id): Promise<KernelToolResult> => contributedToolHandler(toolOf(name), contextOf(sessionId))(args);
  const decide = (id: number) => decideApproval(store, { id, decision: "once", by: "owner" }, clock.at, applier);
  const approvals = () => store.prepare<[], { id: number; status: string }>("SELECT id, status FROM approvals ORDER BY id").all();
  const decided = (id: number) => listApprovals(store, { all: true }).find((a) => a.id === id);
  const reasons = (tool: string) => events(store, "tool_decision").filter((e) => e.payload.tool === tool).map((e) => e.payload.reason);
  /** The owner's own create (`studio agents create`'s path). */
  const ownerCreate = (c: unknown = charter()) => createAgent(store, dataDir, c, { by: "owner" }, clock.at);
  const list = async (): Promise<ListEntry[]> => value<{ agents: ListEntry[] }>(await tool(AGENT_LIST_TOOL_NAME, {})).agents;
  const shaOf = async (id: string): Promise<string> => {
    const entry = (await list()).find((e) => e.id === id);
    if (typeof entry?.sha256 !== "string") throw new Error(`no sha256 for ${id}`);
    return entry.sha256;
  };
  return { store, manager, wright, session, tool, decide, applier, approvals, decided, reasons, ownerCreate, list, shaOf };
}

// ---- The part --------------------------------------------------------------------

describe("the charter-tools part", () => {
  it("has the three tools in order; the refusal tokens are one frozen list; the held tools' descriptions say the kernel applies them and to end the turn", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["kernel_agent_create", "kernel_agent_update", "kernel_agent_list"]);
    expect(CHARTER_TOOL_REFUSALS).toEqual(["not_lead", "idempotency_key_used", "reserved", "not_found", "agent_off", "invalid_input", "id_taken", "files_exist", "config_changed"]);
    expect(Object.isFrozen(CHARTER_TOOL_REFUSALS)).toBe(true);
    expect(TOOLS.map((t) => [t.name, t.beforeHold !== undefined, t.applyOnApproval !== undefined])).toEqual([
      ["kernel_agent_create", true, true],
      ["kernel_agent_update", true, true],
      ["kernel_agent_list", false, false],
    ]);
    for (const t of TOOLS.slice(0, 2)) {
      expect(t.description).toContain("end your turn");
      expect(t.description).toContain("do not repeat the call");
      expect(t.description).toContain(`Refused (nothing held) with one of: ${CHARTER_TOOL_REFUSALS.join(", ")}.`);
    }
    expect(TOOLS[0]?.description).toContain("tool_policy.never");
    expect(TOOLS[0]?.description).toContain("limits.delegation_depth");
  });

  it("the handlers of the held tools fail closed: an approved retry that reached one did nothing", async () => {
    const h = await bootManager();
    expect(errorText(await h.tool(AGENT_CREATE_TOOL_NAME, { charter: charter(), idempotency_key: "c1" }))).toBe(
      "kernel_agent_create is applied by the kernel when the owner approves it; this call did nothing",
    );
    expect(errorText(await h.tool(AGENT_UPDATE_TOOL_NAME, { id: "mason", changes: { model: "x" }, expected_sha256: "0".repeat(64), idempotency_key: "u1" }))).toBe(
      "kernel_agent_update is applied by the kernel when the owner approves it; this call did nothing",
    );
    expect(count(h.store, "SELECT count(*) FROM agents")).toBe(0);
    expect(existsSync(join(dataDir, "memory", "mason"))).toBe(false);
  });
});

// ---- AC1, AC2: create, held then applied ----------------------------------------------

describe("kernel_agent_create (AC1, AC2)", () => {
  it("AC1: held with the display (who, the enforced never line, limits, workspaces, the settings file, role.md); no row and no file yet; AC2: the owner's once makes the kernel create the row, event and five files", async () => {
    const h = await bootKernel();
    const w = await h.session("wright", WRIGHT_POLICY);
    const input = { charter: charter(), idempotency_key: "c1" };
    const held = await w.gate(CREATE, input);
    expect(held.permissionDecision).toBe("deny");
    expect(held.permissionDecisionReason).toMatch(/^approval_required: held as approval 1; .*the kernel applies it itself .*do not repeat the call\.$/);
    expect(count(h.store, "SELECT count(*) FROM agents")).toBe(0);
    expect(presentFiles("mason")).toEqual([]);

    const c = validated(charter());
    const shown = await h.studio(["approvals"]);
    expect(shown.code).toBe(0);
    const out = shown.stdout;
    const block = out.slice(out.indexOf("  display:\n"), out.indexOf("  payload:\n"));
    const lines = block.split("\n").slice(1, 6);
    expect(lines).toEqual([
      '    Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
      `    ${ENFORCED}`,
      "    limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)",
      `    workspaces: ${join(tmp, "work", "payments")}`,
      "    config/agents/mason.json:",
    ]);
    for (const line of renderAgentSettingsJson(c).trimEnd().split("\n")) expect(block).toContain(`\n    ${line}\n`);
    expect(block).toContain("\n    memory/mason/role.md:\n");
    for (const line of renderRoleMd(c).trimEnd().split("\n")) expect(block).toContain(`\n    ${line}`);
    expect(block).toContain("    - Never push code or open a pull request.\n");

    const applied = "The kernel created crew member mason (Mason) on approval 1.";
    expect(await h.studio(["approve", "1", "once"])).toEqual({
      code: 0,
      stderr: "",
      stdout: `studio: approval 1 approved once: kernel_agent_create; the requesting agent gets a message\nstudio: the kernel applied it: ${applied}\n`,
    });
    expect(getAgent(h.store, "mason")).toMatchObject({ status: "active", created_by: "wright", approval_id: 1, display_name: "Mason" });
    expect(events(h.store, "agent_created").map((e) => e.payload)).toEqual([{ id: "mason", by: "wright", approval_id: 1 }]);
    expect(events(h.store, "approval_used").map((e) => [e.session_id, e.payload])).toEqual([[w.id, { id: 1, tool: CREATE, by: "kernel" }]]);
    // The five files, written once the decision committed (no Wright retry).
    const paths = agentFilePaths(dataDir, "mason");
    expect(presentFiles("mason")).toEqual(paths.all);
    expect(readFileSync(paths.settings, "utf8")).toBe(renderAgentSettingsJson(c));
    expect(readFileSync(paths.memory[0] as string, "utf8")).toBe(renderRoleMd(c));
    expect(h.decisionMessage(1)).toBe(`approved approval 1: kernel_agent_create. ${applied} Nothing to repeat.`);
    expect(h.decisionMessage(1)?.endsWith("Nothing to repeat.")).toBe(true);

    // A retry with the same key is refused before the hold: nothing held, nothing created twice.
    const retried = await w.gate(CREATE, input);
    expect(retried.permissionDecisionReason).toMatch(/^kernel_agent_create: idempotency_key_used: /);
    expect(count(h.store, "SELECT count(*) FROM approvals")).toBe(1);
  });

  it("AC4: a crew session (scout) whose policy lists kernel_agent_create is denied held_refused naming not_lead; no approval row", async () => {
    const h = await bootKernel();
    // A registered crew member (the kernel admits a crew session only with its settings file).
    expect(createAgent(h.store, dataDir, charter({ id: "scout", display_name: "Scout" }), { by: "owner" }, clock.at).ok).toBe(true);
    const scout = await h.session("scout", { allowedTools: [CREATE], allowedBashPrefixes: [] });
    const d = await scout.gate(CREATE, { charter: charter(), idempotency_key: "c1" });
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toBe(
      'kernel_agent_create: not_lead: agent "scout" called it; only Wright, the lead, drafts or changes a crew member (nothing was held for the owner)',
    );
    expect(events(h.store, "tool_decision").filter((e) => e.payload.tool === CREATE).map((e) => e.payload)).toEqual([{ tool: CREATE, decision: "deny", reason: "held_refused" }]);
    expect(count(h.store, "SELECT count(*) FROM approvals")).toBe(0);
    expect(h.store.prepare("SELECT id FROM agents").pluck().all()).toEqual(["scout"]);
  });
});

describe("kernel_agent_create: refusals and the apply's edges (AC3)", () => {
  it("before the hold: idempotency_key_used (only for this tool's own key), invalid_input naming the field (a reserved id included), id_taken (off rows too)", async () => {
    const h = await bootManager();
    expect((await h.wright.gate(CREATE, { charter: charter(), idempotency_key: "k" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect((await h.wright.gate(CREATE, { charter: charter({ id: "nell" }), idempotency_key: "k" })).permissionDecisionReason).toBe(
      "kernel_agent_create: idempotency_key_used: this idempotency_key was already used for a request in this session; use a new key to ask the owner again (nothing was held for the owner)",
    );
    // A new key is a new request.
    expect((await h.wright.gate(CREATE, { charter: charter({ id: "nell" }), idempotency_key: "k2" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);

    const reserved = await h.wright.gate(CREATE, { charter: charter({ id: "wright" }), idempotency_key: "k3" });
    expect(reserved.permissionDecisionReason).toMatch(/^kernel_agent_create: invalid_input: id "wright": /);
    const bad = await h.wright.gate(CREATE, { charter: charter({ tool_policy: { allowedTools: [], allowedBashPrefixes: [], never: ["git_pushh"] } }), idempotency_key: "k4" });
    expect(bad.permissionDecisionReason).toMatch(/^kernel_agent_create: invalid_input: tool_policy\.never\.0: .*\(nothing was held for the owner\)$/);

    expect(h.ownerCreate(charter({ id: "otto" })).ok).toBe(true);
    h.store.prepare("UPDATE agents SET status = 'off' WHERE id = 'otto'").run();
    expect((await h.wright.gate(CREATE, { charter: charter({ id: "otto" }), idempotency_key: "k5" })).permissionDecisionReason).toBe(
      "kernel_agent_create: id_taken: a crew member with id otto exists, active or off (an id is never reused) (nothing was held for the owner)",
    );
    expect(h.approvals().map((a) => a.id)).toEqual([1, 2]);
    expect(h.reasons(CREATE)).toEqual(["approval_required", "held_refused", "approval_required", "held_refused", "held_refused", "held_refused"]);
  });

  it("the owner made mason by hand between the hold and the approval: apply_refused id_taken, nothing more written (one row, the owner's)", async () => {
    const h = await bootManager();
    await h.wright.gate(CREATE, { charter: charter({ display_name: "Wright's Mason" }), idempotency_key: "c1" });
    const owner = h.ownerCreate();
    expect(owner.ok).toBe(true);
    const before = Object.fromEntries(agentFilePaths(dataDir, "mason").all.map((p) => [p, readFileSync(p, "utf8")]));
    h.decide(1);
    expect(h.decided(1)).toMatchObject({
      status: "approved",
      apply_refused: "id_taken",
      apply_detail: 'The kernel did not create crew member mason: id_taken (id "mason": a crew member with this id exists, active or off (an id is never reused)).',
    });
    expect(h.store.prepare("SELECT id, created_by, approval_id, display_name FROM agents").all()).toEqual([{ id: "mason", created_by: "owner", approval_id: null, display_name: "Mason" }]);
    expect(events(h.store, "agent_created").map((e) => e.payload)).toEqual([{ id: "mason", by: "owner", approval_id: null }]);
    expect(Object.fromEntries(agentFilePaths(dataDir, "mason").all.map((p) => [p, readFileSync(p, "utf8")]))).toEqual(before);
    expect(events(h.store, "approval_used").map((e) => e.payload)).toEqual([{ id: 1, tool: CREATE, by: "kernel" }]);
  });

  it("a file already at a target path at apply time: apply_refused files_exist, no row", async () => {
    const h = await bootManager();
    await h.wright.gate(CREATE, { charter: charter(), idempotency_key: "c1" });
    const lessons = join(agentFilePaths(dataDir, "mason").memoryDir, "lessons.md");
    mkdirSync(dirname(lessons), { recursive: true });
    writeFileSync(lessons, "The owner's own notes.\n");
    h.decide(1);
    expect(h.decided(1)).toMatchObject({ apply_refused: "files_exist" });
    expect(h.decided(1)?.apply_detail).toMatch(/^The kernel did not create crew member mason: files_exist \(.*lessons\.md already exists: /);
    expect(getAgent(h.store, "mason")).toBeUndefined();
    expect(readFileSync(lessons, "utf8")).toBe("The owner's own notes.\n");
  });

  it("the follow-up file write failing (an unwritable config/agents): the decision is approved and the row exists (created_by wright); once writable, the next ensureAgentFiles writes every file", async () => {
    const h = await bootManager();
    await h.wright.gate(CREATE, { charter: charter(), idempotency_key: "c1" });
    const agentsDir = join(dataDir, "config", "agents");
    mkdirSync(agentsDir, { recursive: true });
    chmodSync(agentsDir, 0o500);
    try {
      h.decide(1);
      expect(h.decided(1)).toMatchObject({ status: "approved", applied: "The kernel created crew member mason (Mason) on approval 1." });
      expect(getAgent(h.store, "mason")).toMatchObject({ status: "active", created_by: "wright", approval_id: 1 });
      expect(readdirSync(agentsDir)).toEqual(["wright.json"]);
      expect(presentFiles("mason")).toEqual([]);
      expect(() => ensureAgentFiles(h.store, dataDir, "mason")).toThrow(/EACCES/);
    } finally {
      chmodSync(agentsDir, 0o700);
    }
    const paths = agentFilePaths(dataDir, "mason");
    expect(ensureAgentFiles(h.store, dataDir, "mason")).toEqual({ ok: true, created: paths.all });
    expect(readFileSync(paths.settings, "utf8")).toBe(renderAgentSettingsJson(validated(charter())));
  });

  it("the display's head (who, enforced, limits, workspaces) always fits the 4,000-character cut: a charter whose head would not is refused invalid_input at the hold; one whose files run past the cut is held with the head whole", async () => {
    const h = await bootManager();
    // 64 tools of ~150 characters: valid, but the enforced line alone is ~9,800 characters.
    const wide = charter({ tool_policy: { allowedTools: longTools(64), allowedBashPrefixes: ["gh pr view"], never: ["git_push"] } });
    validated(wide);
    const refusedHold = await h.wright.gate(CREATE, { charter: wide, idempotency_key: "c1" });
    expect(refusedHold.permissionDecision).toBe("deny");
    expect(refusedHold.permissionDecisionReason).toMatch(
      new RegExp(`^kernel_agent_create: invalid_input: the display's enforced, limits and workspaces lines would be \\d+ characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown; .*\\(nothing was held for the owner\\)$`),
    );
    expect(h.approvals()).toEqual([]);

    // 20 such tools: the head fits, the whole display (with the settings file and role.md) does not.
    const fits = charter({ tool_policy: { allowedTools: longTools(20), allowedBashPrefixes: ["gh pr view"], never: ["git_push"] } });
    expect((await h.wright.gate(CREATE, { charter: fits, idempotency_key: "c2" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const shown = String(events(h.store, "approval_requested")[0]?.payload.display);
    expect(shown.length).toBe(MAX_APPROVAL_DISPLAY);
    const head = shown.split("\n").slice(0, 4);
    expect(head[1]).toBe(`enforced: never: git_push; tools: ${longTools(20).join(", ")}; bash prefixes: "gh pr view"`);
    expect(head[2]).toBe("limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)");
    expect(head[3]).toBe(`workspaces: ${join(tmp, "work", "payments")}`);
    expect(shown).toContain("\nconfig/agents/mason.json:\n");
  });

  it("the apply reads the caller from the approval, never the input: an approval whose agent is not Wright is refused not_lead, nothing written", () => {
    const store = new Store({ dataDir });
    stores.push(store);
    const approval: AppliedApproval = { id: 9, sessionId: null, agent: "scout", subjectVersion: null, requestedEventId: 1 };
    const applier = approvalApplierOf(TOOLS);
    expect(applier(CREATE, { charter: charter(), idempotency_key: "c1" }, approval, store, clock.at)).toEqual({
      refused: "not_lead",
      text: 'The kernel did not create crew member mason: not_lead (agent "scout" called it; only Wright, the lead, drafts or changes a crew member).',
    });
    expect(applier(UPDATE, { id: "mason", changes: { model: "x" }, expected_sha256: "0".repeat(64), idempotency_key: "u1" }, { ...approval, agent: null }, store, clock.at)).toMatchObject({
      refused: "not_lead",
    });
    expect(count(store, "SELECT count(*) FROM agents")).toBe(0);
  });
});

// ---- AC5, AC6: update -----------------------------------------------------------------

describe("kernel_agent_update (AC5, AC6)", () => {
  it("AC6: a valid update of limits.tokens_per_day: the display shows old → new; approved, only that key changes in the file, readAgentSettings returns it, one agent_updated", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const file = agentSettingsPath(dataDir, "mason");
    const original = readFileSync(file, "utf8");
    const expected = await h.shaOf("mason");
    const held = await h.wright.gate(UPDATE, { id: "mason", changes: { limits: { tokens_per_day: 300000 } }, expected_sha256: expected, idempotency_key: "u1" });
    expect(held.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(events(h.store, "approval_requested")[0]?.payload.display).toBe(
      [`Update crew member mason ("Mason"), settings sha256 ${expected.slice(0, 12)}, proposed by Wright`, "limits.tokens_per_day: 200000 → 300000", ENFORCED].join("\n"),
    );
    // Nothing changes before the decision.
    expect(readFileSync(file, "utf8")).toBe(original);

    h.decide(1);
    expect(h.decided(1)).toMatchObject({ status: "approved", applied: "The kernel updated crew member mason on approval 1: limits.tokens_per_day." });
    // Byte-level: the one value differs, every other key and its order is kept.
    expect(readFileSync(file, "utf8")).toBe(original.replace('"tokens_per_day": 200000', '"tokens_per_day": 300000'));
    const read = readAgentSettings(dataDir, "mason");
    expect(read.ok && read.settings.limits).toEqual({ tokens_per_day: 300000, sessions_at_once: 1 });
    expect(events(h.store, "agent_updated").map((e) => e.payload)).toEqual([{ id: "mason", fields: ["limits.tokens_per_day"], approval_id: 1, by: "kernel" }]);
    expect(readdirSync(dirname(file))).toEqual(["mason.json", "wright.json"]);
  });

  it("AC5a: an expected_sha256 that no longer matches (the owner edited the file) is refused at the hold: held_refused config_changed, no approval row", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const stale = await h.shaOf("mason");
    const file = agentSettingsPath(dataDir, "mason");
    writeFileSync(file, readFileSync(file, "utf8").replace('"sessions_at_once": 1', '"sessions_at_once": 2'));
    const d = await h.wright.gate(UPDATE, { id: "mason", changes: { limits: { tokens_per_day: 300000 } }, expected_sha256: stale, idempotency_key: "u1" });
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toMatch(/^kernel_agent_update: config_changed: .*mason\.json changed since it was read/);
    expect(h.reasons(UPDATE)).toEqual(["held_refused"]);
    expect(h.approvals()).toEqual([]);
  });

  it("AC5b: an edit after the hold: approved, apply_refused config_changed and the file's bytes are unchanged (the owner's edit)", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const expected = await h.shaOf("mason");
    await h.wright.gate(UPDATE, { id: "mason", changes: { limits: { tokens_per_day: 300000 } }, expected_sha256: expected, idempotency_key: "u1" });
    const file = agentSettingsPath(dataDir, "mason");
    const edited = readFileSync(file, "utf8").replace('"model": "claude-sonnet-5"', '"model": "claude-opus-5"');
    writeFileSync(file, edited);
    h.decide(1);
    expect(h.decided(1)).toMatchObject({ status: "approved", apply_refused: "config_changed" });
    expect(h.decided(1)?.apply_detail).toMatch(/^The kernel did not update crew member mason: config_changed \(/);
    expect(readFileSync(file, "utf8")).toBe(edited);
    expect(events(h.store, "agent_updated")).toEqual([]);
    expect(readdirSync(dirname(file))).toEqual(["mason.json", "wright.json"]);
  });

  it("refused before the hold, in order: not_lead, idempotency_key_used, reserved (wright), not_found, agent_off, invalid_input (a value the charter's rules refuse, a change that changes nothing)", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const sha256 = await h.shaOf("mason");
    const ask = (changes: Record<string, unknown>, key: string, id = "mason") => h.wright.gate(UPDATE, { id, changes, expected_sha256: sha256, idempotency_key: key });
    const scout = await h.session("scout", { allowedTools: [UPDATE], allowedBashPrefixes: [] });
    expect((await scout.gate(UPDATE, { id: "mason", changes: { model: "claude-opus-5" }, expected_sha256: sha256, idempotency_key: "s1" })).permissionDecisionReason).toMatch(
      /^kernel_agent_update: not_lead: /,
    );
    expect((await ask({ model: "claude-opus-5" }, "u1")).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect((await ask({ effort: "high" }, "u1")).permissionDecisionReason).toMatch(/^kernel_agent_update: idempotency_key_used: /);
    expect((await ask({ model: "x" }, "u2", "wright")).permissionDecisionReason).toMatch(/^kernel_agent_update: reserved: Wright is not a crew member: the owner edits .*wright\.json/);
    expect((await ask({ model: "x" }, "u3", "nobody")).permissionDecisionReason).toBe('kernel_agent_update: not_found: no crew member "nobody" (nothing was held for the owner)');
    expect((await ask({ never: ["git_pushh"] }, "u4")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid_input: the result would not be a valid charter: tool_policy\.never\.0: /);
    expect((await ask({ workspaces: ["relative/path"] }, "u5")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid_input: .*workspaces\.0: "relative\/path" is not an absolute path/);
    expect((await ask({ limits: { tokens_per_day: 200000 }, model: "claude-sonnet-5" }, "u6")).permissionDecisionReason).toBe(
      "kernel_agent_update: invalid_input: changes changes nothing: every named value equals the current one (nothing was held for the owner)",
    );
    expect((await ask({}, "u7")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: /);
    h.store.prepare("UPDATE agents SET status = 'off' WHERE id = 'mason'").run();
    expect((await ask({ model: "claude-opus-5" }, "u8")).permissionDecisionReason).toBe(
      "kernel_agent_update: agent_off: crew member mason is off; the owner turns it on first (nothing was held for the owner)",
    );
    expect(h.approvals().map((a) => a.id)).toEqual([1]);
  });

  it("tool_policy keeps its status key, effort null clears, a limit null clears (limits stays), display_name and avatar change the row; the display lists each field", async () => {
    const h = await bootManager();
    expect(h.ownerCreate(charter({ effort: "high" })).ok).toBe(true);
    const file = agentSettingsPath(dataDir, "mason");
    // The owner's own label on the policy, kept through the update.
    const withStatus = JSON.parse(readFileSync(file, "utf8")) as { tool_policy: Record<string, unknown> };
    withStatus.tool_policy = { status: "owner", ...withStatus.tool_policy };
    writeFileSync(file, `${JSON.stringify(withStatus, null, 2)}\n`);
    const changes = {
      effort: null,
      tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] },
      limits: { sessions_at_once: null, delegation_depth: 2 },
      display_name: "Mason the Reviewer",
      avatar: { shape: "octopus", hue: "crew-sky" },
    };
    await h.wright.gate(UPDATE, { id: "mason", changes, expected_sha256: await h.shaOf("mason"), idempotency_key: "u1" });
    expect(String(events(h.store, "approval_requested")[0]?.payload.display).split("\n").slice(1)).toEqual([
      'effort: "high" → not set',
      'tool_policy: {"allowedTools":["Read","Grep","Bash"],"allowedBashPrefixes":["gh pr view","gh pr comment"]} → {"allowedTools":["Read"],"allowedBashPrefixes":[]}',
      "limits.sessions_at_once: 1 → not set",
      "limits.delegation_depth: not set → 2",
      'display_name: "Mason" → "Mason the Reviewer"',
      'avatar: {"shape":"crab","hue":"crew-teal"} → {"shape":"octopus","hue":"crew-sky"}',
      "enforced: never: git_push, gh_pr_create; tools: Read; bash prefixes: none",
    ]);
    h.decide(1);
    expect(h.decided(1)?.applied).toBe("The kernel updated crew member mason on approval 1: effort, tool_policy, limits.sessions_at_once, limits.delegation_depth, display_name, avatar.");
    const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual(["model", "permission_mode", "tool_policy", "never", "limits", "workspaces"]);
    expect(json.tool_policy).toEqual({ status: "owner", allowedTools: ["Read"], allowedBashPrefixes: [] });
    expect(json.limits).toEqual({ tokens_per_day: 200000, delegation_depth: 2 });
    expect(getAgent(h.store, "mason")).toMatchObject({ display_name: "Mason the Reviewer", avatar_shape: "octopus", avatar_hue: "crew-sky", updated_at: T0 });
    // charter_json stays the creation snapshot.
    expect((JSON.parse(getAgent(h.store, "mason")?.charter_json ?? "{}") as { display_name?: string }).display_name).toBe("Mason");
    expect(readAgentSettings(dataDir, "mason")).toMatchObject({ ok: true, settings: { effort: null, policyStatus: "owner", limits: { tokens_per_day: 200000, delegation_depth: 2 } } });
  });

  it("a display whose field lines and enforced line would not fit the 4,000-character cut is refused invalid_input at the hold; nothing is held", async () => {
    const h = await bootManager();
    expect(h.ownerCreate(charter({ tool_policy: { allowedTools: longTools(20, "a"), allowedBashPrefixes: [], never: ["git_push"] } })).ok).toBe(true);
    const file = agentSettingsPath(dataDir, "mason");
    const original = readFileSync(file, "utf8");
    // Old and new tool lists on one field line, then the enforced line: ~9,000 characters.
    const changes = { tool_policy: { allowedTools: longTools(20, "b"), allowedBashPrefixes: [] }, never: [] };
    const d = await h.wright.gate(UPDATE, { id: "mason", changes, expected_sha256: await h.shaOf("mason"), idempotency_key: "u1" });
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toMatch(
      new RegExp(`^kernel_agent_update: invalid_input: the display \\(its field lines and enforced line\\) would be \\d+ characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown; `),
    );
    expect(h.approvals()).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(original);
    // The current state fits (narrowing to no tools would): the remedy is Wright's, a smaller request.
    expect(d.permissionDecisionReason).toContain("; ask for less at once");
    expect(d.permissionDecisionReason).not.toContain("no request to these fields fits");
  });

  it("a display_name-only update of an owner-created member whose current policy alone is over the cut is refused invalid_input with the owner's remedy; nothing is held", async () => {
    const h = await bootManager();
    // The owner's create has no display check: 30 tools of ~150 characters is a valid charter.
    expect(h.ownerCreate(charter({ tool_policy: { allowedTools: longTools(30, "a"), allowedBashPrefixes: [], never: ["git_push"] } })).ok).toBe(true);
    const file = agentSettingsPath(dataDir, "mason");
    const original = readFileSync(file, "utf8");
    const d = await h.wright.gate(UPDATE, { id: "mason", changes: { display_name: "Mason II" }, expected_sha256: await h.shaOf("mason"), idempotency_key: "u1" });
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toMatch(
      new RegExp(
        `^kernel_agent_update: invalid_input: the display \\(its field lines and enforced line\\) would be \\d+ characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown, and the member's current settings alone \\(the changed fields' old values, their shortest new values and the enforced line\\) would be \\d+, so no request to these fields fits; ` +
          "the owner changes config/agents/mason\\.json by hand \\(or with `studio agents set` for a scalar field, `studio agents rename` for the display name\\), and Wright can change the member once its settings fit \\(nothing was held for the owner\\)$",
      ),
    );
    expect(d.permissionDecisionReason).not.toContain("ask for less");
    expect(h.approvals()).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(getAgent(h.store, "mason")?.display_name).toBe("Mason");
  });

  it("narrowing a member whose old tool list alone is over the cut is refused with the owner's remedy; nothing is held", async () => {
    const h = await bootManager();
    expect(h.ownerCreate(charter({ tool_policy: { allowedTools: longTools(30, "a"), allowedBashPrefixes: [], never: ["git_push"] } })).ok).toBe(true);
    const d = await h.wright.gate(UPDATE, { id: "mason", changes: { tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } }, expected_sha256: await h.shaOf("mason"), idempotency_key: "u1" });
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toContain("so no request to these fields fits; the owner changes config/agents/mason.json by hand");
    expect(h.approvals()).toEqual([]);
  });

  it("the floor counts each changed field's shortest new value: a member whose smallest real request is 4,001 characters gets the owner's remedy; at 4,000 it is held, and a larger request is ask-for-less", async () => {
    const h = await bootManager();
    const EMPTY = { allowedTools: [], allowedBashPrefixes: [] };
    // 24 tools of ~150 characters and one padded tool: its padding moves the display one character at a time.
    const member = (id: string, pad: number) =>
      h.ownerCreate(charter({ id, tool_policy: { allowedTools: [...longTools(24, "a"), `mcp__pad__${"x".repeat(pad)}`], allowedBashPrefixes: [], never: ["git_push"] } }));
    const narrow = async (id: string, key: string, allowedTools: string[] = []) =>
      h.wright.gate(UPDATE, { id, changes: { tool_policy: { ...EMPTY, allowedTools } }, expected_sha256: await h.shaOf(id), idempotency_key: key });
    const heldDisplays = () => events(h.store, "approval_requested").map((e) => String(e.payload.display));

    // Probe: the smallest request on this member (narrow to no tools) is held; its display length gives the padding for any target.
    expect(member("pina", 10).ok).toBe(true);
    expect((await narrow("pina", "k1")).permissionDecisionReason).toMatch(/^approval_required: held as approval /);
    const probe = heldDisplays()[0]?.length ?? 0;
    const padFor = (length: number) => 10 + length - probe;
    expect(padFor(MAX_APPROVAL_DISPLAY + 1)).toBeLessThan(180);

    // 4,001: the old floor (no new value: 44 characters shorter) would have fit and said "ask for less", which no request can.
    expect(member("pinb", padFor(MAX_APPROVAL_DISPLAY + 1)).ok).toBe(true);
    const over = await narrow("pinb", "k2");
    expect(over.permissionDecision).toBe("deny");
    expect(over.permissionDecisionReason).toContain(`would be ${MAX_APPROVAL_DISPLAY + 1} characters`);
    expect(over.permissionDecisionReason).toContain(`would be ${MAX_APPROVAL_DISPLAY + 1}, so no request to these fields fits; the owner changes config/agents/pinb.json by hand`);
    expect(over.permissionDecisionReason).not.toContain("ask for less");

    // 4,000: the smallest request fits and is held; a request with a longer new value is Wright's to shrink.
    expect(member("pinc", padFor(MAX_APPROVAL_DISPLAY)).ok).toBe(true);
    expect((await narrow("pinc", "k3")).permissionDecisionReason).toMatch(/^approval_required: held as approval /);
    expect(heldDisplays().at(-1)?.length).toBe(MAX_APPROVAL_DISPLAY);
    const longer = await narrow("pinc", "k4", ["Read"]);
    expect(longer.permissionDecision).toBe("deny");
    expect(longer.permissionDecisionReason).toContain("; ask for less at once");
    expect(longer.permissionDecisionReason).not.toContain("no request to these fields fits");
    expect(h.approvals().map((a) => a.id)).toEqual([1, 2]);
  });

  it("an owner's edit between the apply's hash read and the in-transaction re-read: apply_refused config_changed, the owner's bytes kept, no agent_updated, no temporary file left", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const file = agentSettingsPath(dataDir, "mason");
    const expected = await h.shaOf("mason");
    const edited = readFileSync(file, "utf8").replace('"model": "claude-sonnet-5"', '"model": "claude-opus-5"');
    // The owner saves the file just as the applier opens its transaction: after the hash check, before the re-read.
    const transaction = h.store.transaction.bind(h.store);
    let opened = 0;
    h.store.transaction = <T,>(fn: () => T): T => {
      opened += 1;
      writeFileSync(file, edited);
      return transaction(fn);
    };
    const approval: AppliedApproval = { id: 9, sessionId: null, agent: "wright", subjectVersion: null, requestedEventId: 1 };
    const outcome = h.applier(UPDATE, { id: "mason", changes: { limits: { tokens_per_day: 300000 } }, expected_sha256: expected, idempotency_key: "u1" }, approval, h.store, clock.at);
    expect(opened).toBe(1);
    expect(outcome).toEqual({ refused: "config_changed", text: `The kernel did not update crew member mason: config_changed (${file} changed while it was being updated; nothing was written).` });
    expect(readFileSync(file, "utf8")).toBe(edited);
    expect(events(h.store, "agent_updated")).toEqual([]);
    expect(readdirSync(dirname(file))).toEqual(["mason.json", "wright.json"]);
  });

  it("the settings file removed after the hold: apply_refused config_changed naming the hold, nothing written (no file, no agent_updated)", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const file = agentSettingsPath(dataDir, "mason");
    await h.wright.gate(UPDATE, { id: "mason", changes: { model: "claude-opus-5" }, expected_sha256: await h.shaOf("mason"), idempotency_key: "u1" });
    rmSync(file);
    h.decide(1);
    expect(h.decided(1)).toMatchObject({ status: "approved", apply_refused: "config_changed" });
    expect(h.decided(1)?.apply_detail).toMatch(/^The kernel did not update crew member mason: config_changed \(.*mason\.json changed since the hold \(the settings file .*mason\.json is missing\)\)\.$/);
    expect(existsSync(file)).toBe(false);
    expect(events(h.store, "agent_updated")).toEqual([]);
    expect(readdirSync(dirname(file))).toEqual(["wright.json"]);
  });

  /** The owner's `studio agents rename` (the roster route's row write and its event, in one transaction). */
  const ownerRename = (store: Store, id: string, name: string) =>
    store.transaction(() => {
      const old = getAgent(store, id)?.display_name;
      store.prepare("UPDATE agents SET display_name = ?, updated_at = ? WHERE id = ?").run(name, clock.at.toISOString(), id);
      appendEvent(store, "agent_renamed", NO_REF, { id, old, new: name }, clock.at.toISOString());
    });

  it("the owner renames the member between the hold and the approval: an update naming display_name is apply_refused config_changed, the owner's name and the file's bytes kept, nothing written", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const file = agentSettingsPath(dataDir, "mason");
    const original = readFileSync(file, "utf8");
    const changes = { display_name: "Mason", model: "claude-opus-5" };
    // Wright drafts a rename-and-model change against "Mason" first: the member is "Mason" at the owner's rename too.
    ownerRename(h.store, "mason", "Mace");
    await h.wright.gate(UPDATE, { id: "mason", changes, expected_sha256: await h.shaOf("mason"), idempotency_key: "u1" });
    ownerRename(h.store, "mason", "Mason the Reviewer");
    h.decide(1);
    expect(h.decided(1)).toMatchObject({
      status: "approved",
      apply_refused: "config_changed",
      apply_detail: "The kernel did not update crew member mason: config_changed (crew member mason's display name or avatar changed since the hold; call kernel_agent_list for the current values).",
    });
    expect(getAgent(h.store, "mason")?.display_name).toBe("Mason the Reviewer");
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(events(h.store, "agent_updated")).toEqual([]);
    expect(readdirSync(dirname(file))).toEqual(["mason.json", "wright.json"]);
  });

  it("an update naming display_name with no owner edit since the hold is applied (a rename before the hold does not count)", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    ownerRename(h.store, "mason", "Mace");
    await h.wright.gate(UPDATE, { id: "mason", changes: { display_name: "Mason the Reviewer" }, expected_sha256: await h.shaOf("mason"), idempotency_key: "u1" });
    h.decide(1);
    expect(h.decided(1)).toMatchObject({ status: "approved", applied: "The kernel updated crew member mason on approval 1: display_name." });
    expect(getAgent(h.store, "mason")?.display_name).toBe("Mason the Reviewer");
    expect(events(h.store, "agent_updated").map((e) => e.payload)).toEqual([{ id: "mason", fields: ["display_name"], approval_id: 1, by: "kernel" }]);
  });

  it("an earlier approved update that changed the avatar refuses a later-held update naming avatar; one naming only a settings field is still applied after an owner rename", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const sha = await h.shaOf("mason");
    await h.wright.gate(UPDATE, { id: "mason", changes: { avatar: { shape: "octopus", hue: "crew-sky" } }, expected_sha256: sha, idempotency_key: "u1" });
    await h.wright.gate(UPDATE, { id: "mason", changes: { avatar: { shape: "crab", hue: "crew-sky" } }, expected_sha256: sha, idempotency_key: "u2" });
    await h.wright.gate(UPDATE, { id: "mason", changes: { limits: { tokens_per_day: 300000 } }, expected_sha256: sha, idempotency_key: "u3" });
    h.decide(1);
    expect(h.decided(1)?.applied).toBe("The kernel updated crew member mason on approval 1: avatar.");
    h.decide(2);
    expect(h.decided(2)).toMatchObject({ apply_refused: "config_changed" });
    expect(getAgent(h.store, "mason")).toMatchObject({ avatar_shape: "octopus", avatar_hue: "crew-sky" });
    ownerRename(h.store, "mason", "Mason the Reviewer");
    h.decide(3);
    expect(h.decided(3)?.applied).toBe("The kernel updated crew member mason on approval 3: limits.tokens_per_day.");
    expect(getAgent(h.store, "mason")?.display_name).toBe("Mason the Reviewer");
    expect(readAgentSettings(dataDir, "mason")).toMatchObject({ ok: true, settings: { limits: { tokens_per_day: 300000 } } });
  });

  it("the apply re-checks the member: turned off after the hold is apply_refused agent_off, the file unchanged", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    const file = agentSettingsPath(dataDir, "mason");
    const original = readFileSync(file, "utf8");
    await h.wright.gate(UPDATE, { id: "mason", changes: { model: "claude-opus-5" }, expected_sha256: await h.shaOf("mason"), idempotency_key: "u1" });
    h.store.prepare("UPDATE agents SET status = 'off' WHERE id = 'mason'").run();
    h.decide(1);
    expect(h.decided(1)).toMatchObject({ apply_refused: "agent_off", apply_detail: "The kernel did not update crew member mason: agent_off (crew member mason is off; the owner turns it on first)." });
    expect(readFileSync(file, "utf8")).toBe(original);
  });
});

// ---- AC7: list ------------------------------------------------------------------------

describe("kernel_agent_list (AC7)", () => {
  it("Wright first with its settings and no sha256, then each member whose sha256 is the hash of its settings file's bytes", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    expect(h.ownerCreate(charter({ id: "abel", display_name: "Abel" })).ok).toBe(true);
    // A hand edit with its own formatting: the hash is of the bytes, never of a re-serialisation.
    const abel = agentSettingsPath(dataDir, "abel");
    writeFileSync(abel, `${JSON.stringify(JSON.parse(readFileSync(abel, "utf8")))}\n`);
    const agents = await h.list();
    expect(agents.map((a) => a.id)).toEqual(["wright", "abel", "mason"]);
    const [wright, ...members] = agents;
    expect(wright).toEqual({
      id: "wright",
      display_name: "Wright",
      avatar: { shape: "whale", hue: "accent" },
      status: "active",
      settings: JSON.parse(readFileSync(wrightSettingsPath(dataDir), "utf8")),
      settings_error: null,
    });
    expect(Object.keys(wright as object)).not.toContain("sha256");
    for (const m of members) {
      const bytes = readFileSync(agentSettingsPath(dataDir, m.id));
      expect(m).toEqual({
        id: m.id,
        display_name: m.id === "abel" ? "Abel" : "Mason",
        avatar: { shape: "crab", hue: "crew-teal" },
        status: "active",
        created_by: "owner",
        settings: JSON.parse(bytes.toString("utf8")),
        settings_error: null,
        sha256: sha(bytes),
      });
    }
    // Not held: the list is an ordinary tool call, with no approval.
    expect((await h.wright.gate(LIST, {})).permissionDecision).toBe("allow");
    expect(h.approvals()).toEqual([]);
  });

  it("an absent settings file has settings and sha256 null and the reader's error; a list never creates Wright's file", async () => {
    const h = await bootManager();
    expect(h.ownerCreate().ok).toBe(true);
    rmSync(agentSettingsPath(dataDir, "mason"));
    rmSync(wrightSettingsPath(dataDir));
    const agents = await h.list();
    expect(agents[0]).toMatchObject({ id: "wright", settings: null, settings_error: null });
    expect(agents[1]).toMatchObject({ id: "mason", settings: null, settings_error: "settings_missing", sha256: null });
    expect(existsSync(wrightSettingsPath(dataDir))).toBe(false);
  });
});
