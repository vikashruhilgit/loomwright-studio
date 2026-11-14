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
  POLICY_NEW_ON_ENFORCED,
  charterToolsPart,
  createDisplay,
} from "../src/agents/charter-tools.js";
import { agentFilePaths, agentSettingsPath, createAgent, ensureAgentFiles, getAgent, readAgentSettings, renderAgentSettingsJson, renderRoleMd, validateCharter } from "../src/agents/index.js";
import type { Charter } from "../src/agents/index.js";
import {
  READINESS_COVERED_PREFIX,
  READINESS_FLAG_PREFIX,
  READINESS_HEADING,
  READINESS_NOT_CHECKED_PREFIX,
  READINESS_READY_PREFIX,
  charterReadiness,
} from "../src/agents/charter-readiness.js";
import { decideApproval, listApprovals } from "../src/approvals/index.js";
import { DISPLAY_ADDED, DISPLAY_CATALOGUE_UNAVAILABLE, DISPLAY_GAINS_TOOLS, DISPLAY_NOT_IN_CATALOGUE, TOOL_JOBS, buildToolCatalogue, jobDisplayLines } from "../src/features/catalogue.js";
import type { ToolJob } from "../src/features/catalogue.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import type { ContributedTool } from "../src/features/index.js";
import { MAX_APPROVAL_DISPLAY } from "../src/approvals/store.js";
import type { AppliedApproval } from "../src/approvals/index.js";
import type { OwnerGrant } from "../src/approvals/store.js";
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
import { stubNotifierContributions } from "./notifier-stub.js";
import { fakeMsg, fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const K = "mcp__kernel__";
/** The jobs whose Loomwright command the crew session runs itself (D44-open): a charter granting their tools always has permission lines readiness flags (item 20c). */
const CREW_RUN_JOBS: readonly ToolJob[] = ["triage_pr_comments", "ask_for_merge"];
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
    // A duty entry: Wright's create names each duty's jobs (none here: the reviewer needs no kernel tool).
    duties: [{ text: "Review the pull requests the owner sends and comment on them.", jobs: [], source: "none" }],
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

/** The readiness block of `charter()` (its one duty needs no kernel tool; it grants none): nothing flagged. */
const READY = [
  "readiness: checked by the kernel before you see it",
  "  covered: duty 1 with no tool (it needs no kernel tool): Review the pull requests the owner sends and comment on them.",
];

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
  const kernel = await startKernel({ dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: pluginDir, stopGraceMs: 10 }, contributions: stubNotifierContributions() }, d);
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
    return { id: handle.id, gate: gateOf(call), tool, registered: tools };
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
 * shipped applier over the charter tools. `checkTools` (default the charter
 * tools) are what the pre-hold check, and so its tool catalogue, is built from.
 */
async function bootManager(checkTools: readonly ContributedTool[] = TOOLS) {
  writeWrightSettings();
  const store = new Store({ dataDir });
  stores.push(store);
  const now = (): Date => clock.at;
  const fakes = fakeSessions();
  const toolSessions: KernelToolContext["sessions"] = { stopSession: (id: number) => manager.stopSession(id), getSession: (id: number) => manager.getSession(id) };
  const contextOf = (sessionId: number): KernelToolContext => ({ store, sessions: toolSessions, sessionId, now });
  const manager: SessionManager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, heldToolCheck: heldToolCheckOf(checkTools, contextOf) },
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
  const decide = (id: number, ownerGrant?: OwnerGrant) => decideApproval(store, { id, decision: "once", by: "owner", ...(ownerGrant === undefined ? {} : { ownerGrant }) }, clock.at, applier);
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
    // Nothing flagged, so no readiness note: the held reason is exactly what it always was (and says the call did not run).
    expect(held.permissionDecisionReason).toBe(
      "approval_required: held as approval 1; it did not run. The owner decides in Studio's Approvals (approval 1) " +
        "and the decision arrives as a new message. End your turn now; if it is approved, the kernel applies it itself and that message says what it did; do not repeat the call.",
    );
    expect(count(h.store, "SELECT count(*) FROM agents")).toBe(0);
    expect(presentFiles("mason")).toEqual([]);

    const c = validated(charter());
    const shown = await h.studio(["approvals"]);
    expect(shown.code).toBe(0);
    const out = shown.stdout;
    const block = out.slice(out.indexOf("  display:\n"), out.indexOf("  payload:\n"));
    const lines = block.split("\n").slice(1, 8);
    expect(lines).toEqual([
      '    Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
      ...READY.map((l) => `    ${l}`),
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
    expect(events(h.store, "tool_decision").filter((e) => e.payload.tool === CREATE).map((e) => e.payload)).toEqual([{ tool: CREATE, decision: "deny", reason: "held_refused", tool_use_id: "toolu_1" }]);
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

  it("a charter with an own __proto__ key (parsed from JSON, every other field valid) is refused invalid_input naming it as an unknown key; no approval row", async () => {
    const h = await bootManager();
    const sent = JSON.stringify(charter()).replace(/^\{/, '{"__proto__": {"x": 1}, ');
    const withProto = JSON.parse(sent) as Record<string, unknown>;
    expect(Object.hasOwn(withProto, "__proto__")).toBe(true);
    const r = await h.wright.gate(CREATE, { charter: withProto, idempotency_key: "k" });
    expect(r.permissionDecisionReason).toMatch(/^kernel_agent_create: invalid_input: /);
    expect(r.permissionDecisionReason).toContain('unknown key "__proto__"');
    expect(h.reasons(CREATE)).toEqual(["held_refused"]);
    expect(h.approvals()).toEqual([]);
  });

  it("a charter that is not a JSON object (an array, null, a string) is refused at the shape check; nothing is held", async () => {
    const h = await bootManager();
    for (const [i, bad] of [[], null, "mason"].entries()) {
      const r = await h.wright.gate(CREATE, { charter: bad, idempotency_key: `n${i}` });
      expect(r.permissionDecisionReason, JSON.stringify(bad)).toMatch(/^kernel_agent_create: invalid input: /);
      expect(r.permissionDecisionReason, JSON.stringify(bad)).toContain("charter must be a JSON object");
    }
    expect(h.approvals()).toEqual([]);
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

  it("the display's head (who, enforced, limits, workspaces) always fits the 4,000 characters studio approvals lists: a charter whose head would not is refused invalid_input at the hold; one whose files run past them is held, stored whole", async () => {
    const h = await bootManager();
    // 64 tools of ~150 characters: valid, but the enforced line alone is ~9,800 characters.
    const wide = charter({ tool_policy: { allowedTools: longTools(64), allowedBashPrefixes: ["gh pr view"], never: ["git_push"] } });
    validated(wide);
    const refusedHold = await h.wright.gate(CREATE, { charter: wide, idempotency_key: "c1" });
    expect(refusedHold.permissionDecision).toBe("deny");
    // Phase 8 item 19a (AC8): the refusal names how many characters over the cut the head is, and what a create can ask for less of (duties first).
    const wideHead = [
      'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
      ...READY,
      `enforced: never: git_push; tools: ${longTools(64).join(", ")}; bash prefixes: "gh pr view"`,
      "limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)",
      `workspaces: ${join(tmp, "work", "payments")}`,
    ].join("\n").length;
    expect(refusedHold.permissionDecisionReason).toBe(
      `kernel_agent_create: invalid_input: the display's head (who, the readiness lines, the job lines, the enforced, limits and workspaces lines) would be ${wideHead} characters, ` +
        `${wideHead - MAX_APPROVAL_DISPLAY} over the ${MAX_APPROVAL_DISPLAY} the owner is shown; ask for less at once (fewer duties, then fewer or shorter tools, prefixes or workspaces) (nothing was held for the owner)`,
    );
    expect(h.approvals()).toEqual([]);

    // 20 such tools: the head fits, the whole display (with the settings file and role.md) does not.
    const fits = charter({ tool_policy: { allowedTools: longTools(20), allowedBashPrefixes: ["gh pr view"], never: ["git_push"] } });
    expect((await h.wright.gate(CREATE, { charter: fits, idempotency_key: "c2" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const shown = String(events(h.store, "approval_requested")[0]?.payload.display);
    // Phase 8 item 18d: the display is stored whole (no 4,000 cut), through role.md's last line, and served whole.
    expect(shown.length).toBeGreaterThan(MAX_APPROVAL_DISPLAY);
    const fitted = validated(fits);
    const roleMd = renderRoleMd(fitted, fitted.connectors);
    expect(shown.endsWith(`\nmemory/mason/role.md:\n${roleMd.endsWith("\n") ? roleMd.slice(0, -1) : roleMd}`)).toBe(true);
    expect(listApprovals(h.store)[0]?.display).toBe(shown);
    const head = shown.split("\n").slice(0, 6);
    expect(head.slice(1, 3)).toEqual(READY);
    expect(head[3]).toBe(`enforced: never: git_push; tools: ${longTools(20).join(", ")}; bash prefixes: "gh pr view"`);
    expect(head[4]).toBe("limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)");
    expect(head[5]).toBe(`workspaces: ${join(tmp, "work", "payments")}`);
    expect(shown).toContain("\nconfig/agents/mason.json:\n");
  });

  it("phase 8 item 19a (AC6): a long duty's readiness line quotes its excerpt; role.md in the stored display carries its full text", async () => {
    const h = await bootManager();
    const long = "Review the pull requests the owner sends and comment on each risky change, naming the file, the line and the smallest fix, and say plainly when a change looks safe to merge.";
    const c = charter({ duties: [{ text: long, jobs: [], source: "none" }] });
    expect((await h.wright.gate(CREATE, { charter: c, idempotency_key: "c1" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const shown = String(events(h.store, "approval_requested")[0]?.payload.display);
    expect(shown.split("\n").slice(1, 3)).toEqual([READINESS_HEADING, "  covered: duty 1 with no tool (it needs no kernel tool): Review the pull requests the owner sends and comment on each risky…"]);
    const roleMd = renderRoleMd(validated(c), validated(c).connectors);
    expect(roleMd).toContain(long);
    expect(shown.endsWith(`\nmemory/mason/role.md:\n${roleMd.endsWith("\n") ? roleMd.slice(0, -1) : roleMd}`)).toBe(true);
    // The full text is shown once: in role.md, never in the head.
    expect(shown.split(long)).toHaveLength(2);
    expect(shown.indexOf(long)).toBeGreaterThan(shown.indexOf("\nmemory/mason/role.md:\n"));
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
      [`Update crew member mason ("Mason"), settings sha256 ${expected.slice(0, 12)}, proposed by Wright`, ...READY, "limits.tokens_per_day: 200000 → 300000", ENFORCED].join("\n"),
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
    // `changes.never` publishes NEVER_CATEGORIES as an enum, so an unknown category is refused at argument validation.
    expect((await ask({ never: ["git_pushh"] }, "u4")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: [\s\S]*→ at changes\.never\[0\]$/);
    // So does every other closed set the tool publishes, and a limit that is not a positive integer.
    expect((await ask({ avatar: { shape: "whale", hue: "crew-teal" } }, "u4a")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: [\s\S]*→ at changes\.avatar\.shape$/);
    expect((await ask({ avatar: { shape: "shark", hue: "crew-red" } }, "u4b")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: [\s\S]*→ at changes\.avatar\.hue$/);
    expect((await ask({ permission_mode: "yolo" }, "u4c")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: [\s\S]*→ at changes\.permission_mode$/);
    expect((await ask({ limits: { tokens_per_day: 0 } }, "u4d")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: [\s\S]*→ at changes\.limits\.tokens_per_day$/);
    expect((await ask({ limits: { tokens_per_day: -1 } }, "u4e")).permissionDecisionReason).toMatch(/^kernel_agent_update: invalid input: [\s\S]*→ at changes\.limits\.tokens_per_day$/);
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
      ...READY,
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
    // Phase 8 item 19a (AC8): the characters over the cut, and only what an update can change (never duties: an update can't change the stored duties).
    const m = new RegExp(
      `^kernel_agent_update: invalid_input: the display \\(its readiness lines, job lines, field lines and enforced line\\) would be (\\d+) characters, (\\d+) over the ${MAX_APPROVAL_DISPLAY} the owner is shown; ` +
        "ask for less at once \\(fewer or shorter tools, prefixes or workspaces\\) \\(nothing was held for the owner\\)$",
    ).exec(d.permissionDecisionReason);
    expect(m).not.toBeNull();
    expect(Number(m?.[2])).toBe(Number(m?.[1]) - MAX_APPROVAL_DISPLAY);
    expect(Number(m?.[2])).toBeGreaterThan(0);
    expect(d.permissionDecisionReason).not.toMatch(/dut(y|ies)/);
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
        `^kernel_agent_update: invalid_input: the display \\(its readiness lines, job lines, field lines and enforced line\\) would be \\d+ characters, over the ${MAX_APPROVAL_DISPLAY} the owner is shown, and the member's current settings alone \\(the changed fields' old values, their shortest new values and the enforced line\\) would be \\d+, so no request to these fields fits; ` +
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
    // The smallest tool_policy request: one 1-character tool and one 1-character prefix (`x`, `"x"` on the enforced line: shorter than `none`).
    const SMALLEST = { allowedTools: ["x"], allowedBashPrefixes: ["x"] };
    // 23 tools of ~150 characters (room for the readiness block) and one padded tool: its padding moves the display one character at a time. One kernel
    // tool (job General) too: a tool_policy change's floor has no job line for the tools it keeps (its shortest value grants none).
    const member = (id: string, pad: number) =>
      h.ownerCreate(charter({ id, tool_policy: { allowedTools: [...longTools(23, "a"), `mcp__pad__${"x".repeat(pad)}`, `${K}kernel_task_list`], allowedBashPrefixes: [], never: ["git_push"] } }));
    const narrow = async (id: string, key: string, policy: { allowedTools: string[]; allowedBashPrefixes: string[] } = SMALLEST) =>
      h.wright.gate(UPDATE, { id, changes: { tool_policy: policy }, expected_sha256: await h.shaOf(id), idempotency_key: key });
    const heldDisplays = () => events(h.store, "approval_requested").map((e) => String(e.payload.display));

    // Probe: the smallest request on this member is held with its new value as JSON; over the cut it is shown in the
    // display's shortest form (the new value as "as on the enforced line"), so that form's length gives the padding for any target.
    expect(member("pina", 10).ok).toBe(true);
    expect((await narrow("pina", "k1")).permissionDecisionReason).toMatch(/^approval_required: held as approval /);
    const probe = (heldDisplays()[0]?.length ?? 0) - JSON.stringify(SMALLEST).length + POLICY_NEW_ON_ENFORCED.length;
    const padFor = (length: number) => 10 + length - probe;
    expect(padFor(MAX_APPROVAL_DISPLAY + 1)).toBeLessThan(250);

    // 4,001: no request to tool_policy fits in any form, so the remedy is the owner's.
    expect(member("pinb", padFor(MAX_APPROVAL_DISPLAY + 1)).ok).toBe(true);
    const over = await narrow("pinb", "k2");
    expect(over.permissionDecision).toBe("deny");
    expect(over.permissionDecisionReason).toContain(`would be ${MAX_APPROVAL_DISPLAY + 1} characters`);
    expect(over.permissionDecisionReason).toContain(`would be ${MAX_APPROVAL_DISPLAY + 1}, so no request to these fields fits; the owner changes config/agents/pinb.json by hand`);
    expect(over.permissionDecisionReason).not.toContain("ask for less");

    // 4,000: the smallest request fits in the shortest form and is held; a request with a longer new value is Wright's to shrink.
    expect(member("pinc", padFor(MAX_APPROVAL_DISPLAY)).ok).toBe(true);
    expect((await narrow("pinc", "k3")).permissionDecisionReason).toMatch(/^approval_required: held as approval /);
    const shown = heldDisplays().at(-1) ?? "";
    expect(shown.length).toBe(MAX_APPROVAL_DISPLAY);
    expect(shown).toContain(` → ${POLICY_NEW_ON_ENFORCED}\nenforced: never: git_push; tools: x; bash prefixes: "x"`);
    const longer = await narrow("pinc", "k4", { allowedTools: [], allowedBashPrefixes: [] });
    expect(longer.permissionDecision).toBe("deny");
    expect(longer.permissionDecisionReason).toContain("; ask for less at once");
    expect(longer.permissionDecisionReason).not.toContain("no request to these fields fits");
    // A request granting a kernel tool has a job line the floor leaves out (a smaller request grants none): still Wright's to shrink.
    const granting = await narrow("pinc", "k5", { allowedTools: [`${K}kernel_task_list`], allowedBashPrefixes: [] });
    expect(granting.permissionDecision).toBe("deny");
    expect(granting.permissionDecisionReason).toContain("; ask for less at once");
    expect(h.approvals().map((a) => a.id)).toEqual([1, 2]);
  });

  it("the floor shows a never change's enforced never as empty (its shortest value), not the current list: at 4,000 never: [] is held and a longer never request is ask-for-less", async () => {
    const h = await bootManager();
    const NEVER = ["git_push", "gh_pr_create"];
    const member = (id: string, pad: number) =>
      h.ownerCreate(charter({ id, tool_policy: { allowedTools: [...longTools(24, "a"), `mcp__pad__${"x".repeat(pad)}`], allowedBashPrefixes: [], never: NEVER } }));
    const setNever = async (id: string, key: string, never: string[]) => h.wright.gate(UPDATE, { id, changes: { never }, expected_sha256: await h.shaOf(id), idempotency_key: key });
    const heldDisplays = () => events(h.store, "approval_requested").map((e) => String(e.payload.display));
    // Probe: the smallest request (never: []) is held; its display's length gives the padding for 4,000.
    expect(member("pina", 10).ok).toBe(true);
    expect((await setNever("pina", "k1", [])).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const pad = 10 + MAX_APPROVAL_DISPLAY - (heldDisplays()[0]?.length ?? 0);
    expect(pad).toBeGreaterThan(0);
    expect(pad).toBeLessThan(190);
    expect(member("pinc", pad).ok).toBe(true);
    expect((await setNever("pinc", "k2", [])).permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
    const shown = heldDisplays().at(-1) ?? "";
    expect(shown.length).toBe(MAX_APPROVAL_DISPLAY);
    expect(shown).toContain(`never: ${JSON.stringify(NEVER)} → []\nenforced: never: none; tools: `);
    // A longer request to the same field: the floor (never: [] whole, 4,000) fits, so the remedy is Wright's.
    const longer = await setNever("pinc", "k3", ["git_push"]);
    expect(longer.permissionDecision).toBe("deny");
    expect(longer.permissionDecisionReason).toContain("; ask for less at once");
    expect(longer.permissionDecisionReason).not.toContain("no request to these fields fits");
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
    // Since phase 8 item 18d a newer charter hold for mason withdraws the older pending one (the hold's `subject`), so three
    // pending updates for one member arise only from approvals held before 18d, whose holds named no subject: the pre-hold
    // check here drops it to hold them as such (the applier is the shipped one). The apply-time config_changed check still guards those.
    const before18d: ContributedTool[] = TOOLS.map((t) => {
      const check = t.beforeHold;
      if (check === undefined) return t;
      return {
        ...t,
        beforeHold: (a: never, c: Parameters<typeof check>[1]) => {
          const v = check.call(t, a, c);
          if ("refuse" in v) return v;
          const { subject: _subject, ...held } = v;
          return held;
        },
      } as ContributedTool;
    });
    const h = await bootManager(before18d);
    expect(h.ownerCreate().ok).toBe(true);
    const sha = await h.shaOf("mason");
    await h.wright.gate(UPDATE, { id: "mason", changes: { avatar: { shape: "octopus", hue: "crew-sky" } }, expected_sha256: sha, idempotency_key: "u1" });
    await h.wright.gate(UPDATE, { id: "mason", changes: { avatar: { shape: "crab", hue: "crew-sky" } }, expected_sha256: sha, idempotency_key: "u2" });
    await h.wright.gate(UPDATE, { id: "mason", changes: { limits: { tokens_per_day: 300000 } }, expected_sha256: sha, idempotency_key: "u3" });
    expect(h.approvals().map((a) => a.status)).toEqual(["pending", "pending", "pending"]);
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

// ---- Phase 8 item 16: the granted kernel tools by job (AC3 kernel half, AC9) -----------
//
// The display's plain block (`jobDisplayLines`, `kernel/src/features/catalogue.ts`), between
// the who line and every line that names an `mcp__kernel__` tool:
//   job: <label>        one per job with a granted kernel tool, in TOOL_JOBS order
//     - <purpose>       one per granted tool of that job (its description's first sentence)
// A charter that grants no kernel tool has none (every pin above is unchanged).

/** The shipped tools as the daemon merges them, and their catalogue (what `startKernel`'s hold sees). */
const SHIPPED_TOOLS: readonly ContributedTool[] = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;

/** The walk charter's kernel tools (`MASON_TOOLS`, `kernel/test/phase-8-exit.test.ts`). */
const WALK_KERNEL_TOOLS = [
  "kernel_automate_prepare",
  "kernel_automate_state",
  "kernel_automate_merge_check",
  "kernel_merge_approval_request",
  "kernel_pr_route",
  "kernel_github_pr_comments",
  "kernel_github_pr_reply",
  "kernel_github_pr_comment",
  "kernel_github_pr_request_reviewers",
].map((n) => `${K}${n}`);

/** The `approval_requested` display of approval `n` (1-based). */
function heldDisplay(store: Store, n = 1): string {
  return String(events(store, "approval_requested")[n - 1]?.payload.display);
}

const READINESS_PREFIXES = [READINESS_COVERED_PREFIX, READINESS_READY_PREFIX, READINESS_FLAG_PREFIX, READINESS_NOT_CHECKED_PREFIX];

/** A display's lines without its readiness block (pinned in `agents-charter-readiness.test.ts`): what the job-line pins below read. */
function plain(display: string): string[] {
  return display.split("\n").filter((l) => l !== READINESS_HEADING && !READINESS_PREFIXES.some((p) => l.startsWith(p)));
}

/** The readiness lines a create hold computes for `c` over `catalogue` (its proposed connectors). */
function createReadinessLines(c: Charter, catalogue: ReturnType<typeof buildToolCatalogue> | undefined): readonly string[] {
  return charterReadiness({ action: "create", charter: c, catalogue, grant: { kind: "proposed", connectors: c.connectors ?? [] }, dataDir }).lines;
}

describe("the display groups the granted kernel tools by job (phase 8 item 16: AC3 kernel half, AC9)", () => {
  it("AC3: a held create shows the granted kernel tools grouped by job with their purposes, ahead of any mcp__kernel__ name; the raw enforced line is still shown beneath", async () => {
    const h = await bootKernel();
    const w = await h.session("wright", WRIGHT_POLICY);
    const granted = ["Read", `${K}kernel_github_pr_get`, `${K}kernel_automate_merge_check`, `${K}kernel_task_list`];
    const c = charter({ tool_policy: { allowedTools: granted, allowedBashPrefixes: [], never: ["git_push"] }, connectors: ["github"] });
    expect((await w.gate(CREATE, { charter: c, idempotency_key: "c1" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const shown = heldDisplay(h.store);
    expect(plain(shown).slice(0, 10)).toEqual([
      'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
      "job: Ask for a merge",
      "  - Whether Loomwright may merge one parked pull request now (read only).",
      "job: Read a PR",
      "  - Read one pull request's metadata and description from GitHub (read-only).",
      "job: General",
      "  - List tasks in id order, filtered by state, assignee_agent or parent_task_id (limit 1-200, default 50).",
      `enforced: never: git_push; tools: ${granted.join(", ")}; bash prefixes: none; connectors: github`,
      "limits: tokens_per_day 200000 (proposed); sessions_at_once 1 (proposed); delegation_depth not set (no limit)",
      `workspaces: ${join(tmp, "work", "payments")}`,
    ]);
    // Every job line comes before the first raw kernel name.
    expect(shown.lastIndexOf("job: ")).toBeLessThan(shown.indexOf(K));
    // The display the hold shows is createDisplay over the composition's catalogue.
    const catalogue = buildToolCatalogue(SHIPPED_TOOLS);
    expect(shown).toBe(createDisplay(validated(c), catalogue, createReadinessLines(validated(c), catalogue)));
  });

  it("AC2 in the daemon: Wright's session, with no GitHub grant of its own, is offered kernel_agent_create with the composition's whole catalogue", async () => {
    const h = await bootKernel();
    const tools = (await h.session("wright", WRIGHT_POLICY)).registered as unknown as Record<string, { description?: string }>;
    // Wright holds no github grant, so the github tools themselves are not on its server …
    expect(tools.kernel_github_pr_get).toBeUndefined();
    // … but the drafting tool's description still lists them, from the unfiltered catalogue.
    expect(tools.kernel_agent_create?.description).toContain('Job read_pr "Read a PR":\n- kernel_github_pr_get: ');
    expect(tools.kernel_agent_create?.description).toContain('Job ask_for_merge "Ask for a merge":');
  });

  it("AC3: a held update shows the result's kernel tools by job ahead of its field lines (which name mcp__kernel__ tools), then the enforced line", async () => {
    const h = await bootKernel();
    expect(createAgent(h.store, dataDir, charter({ tool_policy: { allowedTools: ["Read", `${K}kernel_github_pr_get`], allowedBashPrefixes: [], never: ["git_push"] } }), { by: "owner" }, clock.at).ok).toBe(true);
    const w = await h.session("wright", WRIGHT_POLICY);
    const list = JSON.parse((await w.tool(AGENT_LIST_TOOL_NAME, {})).content[0]?.text ?? "{}") as { agents: ListEntry[] };
    const sha256 = list.agents.find((a) => a.id === "mason")?.sha256 as string;
    const next = ["Read", `${K}kernel_github_pr_get`, `${K}kernel_automate_merge_check`, `${K}kernel_merge_approval_request`];
    const held = await w.gate(UPDATE, { id: "mason", changes: { tool_policy: { allowedTools: next, allowedBashPrefixes: [] } }, expected_sha256: sha256, idempotency_key: "u1" });
    expect(held.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    // Mason held only kernel_github_pr_get: the update adds Ask for a merge (DESIGN: "the jobs it adds and the jobs it keeps") and keeps Read a PR.
    expect(plain(heldDisplay(h.store))).toEqual([
      `Update crew member mason ("Mason"), settings sha256 ${sha256.slice(0, 12)}, proposed by Wright`,
      "job: Ask for a merge (added)",
      "  - Whether Loomwright may merge one parked pull request now (read only).",
      "  - Ask the owner to approve merging one pull request at one head SHA, for a repository set to Approve in Studio.",
      "job: Read a PR",
      "  - Read one pull request's metadata and description from GitHub (read-only).",
      `tool_policy: ${JSON.stringify({ allowedTools: ["Read", `${K}kernel_github_pr_get`], allowedBashPrefixes: [] })} → ${JSON.stringify({ allowedTools: next, allowedBashPrefixes: [] })}`,
      `enforced: never: git_push; tools: ${next.join(", ")}; bash prefixes: none`,
    ]);
  });

  it("AC9: with the catalogue unavailable the display falls back to the raw names with one plain note, never a guessed grouping (directly, and through the gate of a composition whose catalogue cannot be built)", async () => {
    const granted = ["Read", `${K}kernel_github_pr_get`];
    const c = validated(charter({ tool_policy: { allowedTools: granted, allowedBashPrefixes: [], never: [] } }));
    expect(createDisplay(c).split("\n").slice(0, 3)).toEqual([
      'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
      DISPLAY_CATALOGUE_UNAVAILABLE,
      `enforced: never: none; tools: ${granted.join(", ")}; bash prefixes: none`,
    ]);
    // Through the gate: a composition whose catalogue cannot be built (a tool with a job outside TOOL_JOBS, past the merge).
    const badJob = defineTool({ name: "kernel_bad_job", job: "not_a_job" as never, description: "Bad.", shape: {}, handler: () => ({}) });
    const h = await bootManager([...TOOLS, badJob]);
    await h.wright.gate(CREATE, { charter: charter({ tool_policy: { allowedTools: granted, allowedBashPrefixes: [], never: [] } }), idempotency_key: "c1" });
    expect(plain(heldDisplay(h.store))[1]).toBe(DISPLAY_CATALOGUE_UNAVAILABLE);
  });

  it("a granted kernel tool the catalogue lacks is listed by name under its own heading, never put in a guessed job", async () => {
    const granted = ["Read", `${K}kernel_github_pr_get`];
    // The pre-hold check over the charter tools only: its catalogue has no GitHub tool.
    const g = await bootManager();
    await g.wright.gate(CREATE, { charter: charter({ id: "nell", tool_policy: { allowedTools: granted, allowedBashPrefixes: [], never: [] } }), idempotency_key: "c1" });
    expect(plain(heldDisplay(g.store)).slice(1, 3)).toEqual([`job: ${DISPLAY_NOT_IN_CATALOGUE}`, "  - kernel_github_pr_get"]);
  });

  it("the job lines count toward the head the hold checks: the walk charter fits with its purposes; a charter granting every kernel tool, whose full block would not fit, is held with the job labels alone, still ahead of every raw name", async () => {
    const h = await bootKernel();
    const w = await h.session("wright", WRIGHT_POLICY);
    const walk = charter({ tool_policy: { allowedTools: ["Read", "Bash", ...WALK_KERNEL_TOOLS], allowedBashPrefixes: ["gh pr"], never: [] }, connectors: ["github"] });
    expect((await w.gate(CREATE, { charter: walk, idempotency_key: "c1" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(heldDisplay(h.store).split("\n").filter((l) => l.startsWith("job: "))).toEqual(["job: Hand tickets to /automate", "job: Triage PR comments", "job: Ask for a merge", "job: Read a PR"]);
    expect(heldDisplay(h.store).split("\n").filter((l) => l.startsWith("  - ")).length).toBe(WALK_KERNEL_TOOLS.length);

    const catalogue = buildToolCatalogue(SHIPPED_TOOLS);
    const every = catalogue.tools.map((t) => `${K}${t.name}`);
    expect(every.length).toBeGreaterThanOrEqual(30);
    const all = charter({ id: "nell", tool_policy: { allowedTools: every, allowedBashPrefixes: [], never: [] } });
    // With every purpose line the head would run past the cut (before this fix, the hold refused it) …
    const fullBlock = catalogue.jobs.flatMap((j) => [`job: ${j.label}`, ...j.tools.map((t) => `  - ${t.purpose}`)]).join("\n");
    expect((await w.gate(CREATE, { charter: all, idempotency_key: "c2" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
    const shown = heldDisplay(h.store, 2);
    const lines = plain(shown);
    // … so the hold shows the compact block: one label per job, no purpose line, then the enforced line, limits and workspaces whole.
    expect(lines.slice(1, 1 + catalogue.jobs.length)).toEqual(catalogue.jobs.map((j) => `job: ${j.label}`));
    expect(lines[1 + catalogue.jobs.length]).toBe(`enforced: never: none; tools: ${every.join(", ")}; bash prefixes: none`);
    expect(lines[3 + catalogue.jobs.length]).toMatch(/^workspaces: /);
    expect(lines.some((l) => l.startsWith("  - "))).toBe(false);
    expect(shown.lastIndexOf("job: ")).toBeLessThan(shown.indexOf(K));
    expect(lines.slice(0, 4 + catalogue.jobs.length).join("\n").length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
    expect([lines[0], fullBlock, ...lines.slice(1 + catalogue.jobs.length, 4 + catalogue.jobs.length)].join("\n").length).toBeGreaterThan(MAX_APPROVAL_DISPLAY);
    // Phase 8 item 18d: the whole display is stored, the files' tail included (studio approvals cuts its listing at 4,000, with a mark; the head is never in the cut part).
    const whole = createDisplay(validated(all), catalogue, createReadinessLines(validated(all), catalogue));
    expect(whole.length).toBeGreaterThan(MAX_APPROVAL_DISPLAY);
    expect(shown).toBe(whole);
  });

  it("the update's display falls back to the job labels alone when its full block would not fit: a member granted every kernel tool can be renamed and narrowed; its floor counts only the labels", async () => {
    const h = await bootKernel();
    const catalogue = buildToolCatalogue(SHIPPED_TOOLS);
    const every = catalogue.tools.map((t) => `${K}${t.name}`);
    // The owner's own create has no display check: its full job block alone runs past the cut.
    expect(createAgent(h.store, dataDir, charter({ tool_policy: { allowedTools: every, allowedBashPrefixes: [], never: [] } }), { by: "owner" }, clock.at).ok).toBe(true);
    const w = await h.session("wright", WRIGHT_POLICY);
    const sha256 = async () =>
      (JSON.parse((await w.tool(AGENT_LIST_TOOL_NAME, {})).content[0]?.text ?? "{}") as { agents: ListEntry[] }).agents.find((a) => a.id === "mason")?.sha256 as string;
    const before = await sha256();
    const rename = await w.gate(UPDATE, { id: "mason", changes: { display_name: "Mason II" }, expected_sha256: before, idempotency_key: "u1" });
    expect(rename.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(plain(heldDisplay(h.store))).toEqual([
      `Update crew member mason ("Mason"), settings sha256 ${before.slice(0, 12)}, proposed by Wright`,
      ...catalogue.jobs.map((j) => `job: ${j.label}`),
      'display_name: "Mason" → "Mason II"',
      `enforced: never: none; tools: ${every.join(", ")}; bash prefixes: none`,
    ]);
    const narrow = await w.gate(UPDATE, { id: "mason", changes: { tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] } }, expected_sha256: await sha256(), idempotency_key: "u2" });
    expect(narrow.permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
  });

  it("an update tries its forms in order: one whose full block would not fit but whose labels do keeps the new tool list as JSON on its field line, and marks the jobs it adds", async () => {
    const h = await bootKernel();
    const catalogue = buildToolCatalogue(SHIPPED_TOOLS);
    const readPr = catalogue.jobs.find((j) => j.id === "read_pr")?.tools.map((t) => `${K}${t.name}`) ?? [];
    expect(readPr.length).toBeGreaterThan(0);
    // Every kernel tool but General's (the readiness block above the job lines needs the room they would take).
    // (Not the two crew-run command jobs': each adds readiness lines naming the permissions only the owner can weigh, item 20c, and this case is about the room the job lines take.)
    const every = catalogue.tools.filter((t) => t.job !== "general" && !CREW_RUN_JOBS.includes(t.job)).map((t) => `${K}${t.name}`);
    expect(createAgent(h.store, dataDir, charter({ tool_policy: { allowedTools: readPr, allowedBashPrefixes: [], never: [] } }), { by: "owner" }, clock.at).ok).toBe(true);
    const w = await h.session("wright", WRIGHT_POLICY);
    const sha256 = (JSON.parse((await w.tool(AGENT_LIST_TOOL_NAME, {})).content[0]?.text ?? "{}") as { agents: ListEntry[] }).agents.find((a) => a.id === "mason")?.sha256 as string;
    const policy = { allowedTools: every, allowedBashPrefixes: [] };
    expect((await w.gate(UPDATE, { id: "mason", changes: { tool_policy: policy }, expected_sha256: sha256, idempotency_key: "u1" })).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const shown = heldDisplay(h.store);
    const jobLines = catalogue.jobs.filter((j) => j.id !== "general" && !CREW_RUN_JOBS.includes(j.id)).map((j) => `job: ${j.label}${j.id === "read_pr" ? "" : DISPLAY_ADDED}`);
    expect(plain(shown)).toEqual([
      `Update crew member mason ("Mason"), settings sha256 ${sha256.slice(0, 12)}, proposed by Wright`,
      // The second form: every job by its label, Read a PR kept and every other job added …
      ...jobLines,
      // … and the new value still as JSON (the third form's "as on the enforced line" is not needed).
      `tool_policy: ${JSON.stringify({ allowedTools: readPr, allowedBashPrefixes: [] })} → ${JSON.stringify(policy)}`,
      `enforced: never: none; tools: ${every.join(", ")}; bash prefixes: none`,
    ]);
    // The first form (each tool's purpose) would not have fit.
    const fullBlock = jobDisplayLines(every, catalogue, true, readPr).join("\n");
    expect(shown.replace(jobLines.join("\n"), fullBlock).length).toBeGreaterThan(MAX_APPROVAL_DISPLAY);
  });

  it("a member holding both crew-run command jobs (the permission lines no charter can clear): an update asking for little is held within the display bound, and one widening it past the bound is asked for less", async () => {
    const h = await bootKernel();
    const catalogue = buildToolCatalogue(SHIPPED_TOOLS);
    const crewTools = catalogue.tools.filter((t) => CREW_RUN_JOBS.includes(t.job)).map((t) => `${K}${t.name}`);
    expect(crewTools.length).toBeGreaterThan(0);
    expect(createAgent(h.store, dataDir, charter({ tool_policy: { allowedTools: crewTools, allowedBashPrefixes: [], never: [] } }), { by: "owner" }, clock.at).ok).toBe(true);
    const w = await h.session("wright", WRIGHT_POLICY);
    const sha256 = async () =>
      (JSON.parse((await w.tool(AGENT_LIST_TOOL_NAME, {})).content[0]?.text ?? "{}") as { agents: ListEntry[] }).agents.find((a) => a.id === "mason")?.sha256 as string;
    // The fixed lines are there for both jobs, as a flag no charter change clears.
    const small = await w.gate(UPDATE, { id: "mason", changes: { display_name: "Mason II" }, expected_sha256: await sha256(), idempotency_key: "u1" });
    expect(small.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const shown = heldDisplay(h.store);
    for (const label of CREW_RUN_JOBS.map((j) => catalogue.jobs.find((x) => x.id === j)?.label as string)) expect(shown).toContain(`for ${label}: no charter should grant it`);
    expect(shown.length).toBeLessThanOrEqual(MAX_APPROVAL_DISPLAY);
    // Too long for the bound with those lines in: refused with the usual ask-for-less, never held over the bound.
    const workspaces = Array.from({ length: 16 }, (_, i) => join(tmp, "work", `${"w".repeat(200)}-${String(i).padStart(2, "0")}`));
    const wide = await w.gate(UPDATE, { id: "mason", changes: { workspaces }, expected_sha256: await sha256(), idempotency_key: "u2" });
    expect(wide.permissionDecision).toBe("deny");
    expect(wide.permissionDecisionReason).toContain("ask for less at once");
  });

  it("the floor counts the kept tools' job lines in their label-only form: a member granted every kernel tool asking for 16 long workspaces is asked for less (never given the owner's remedy), and two of them are held", async () => {
    const h = await bootKernel();
    const catalogue = buildToolCatalogue(SHIPPED_TOOLS);
    const every = catalogue.tools.map((t) => `${K}${t.name}`);
    expect(createAgent(h.store, dataDir, charter({ tool_policy: { allowedTools: every, allowedBashPrefixes: [], never: [] } }), { by: "owner" }, clock.at).ok).toBe(true);
    const w = await h.session("wright", WRIGHT_POLICY);
    const sha256 = async () =>
      (JSON.parse((await w.tool(AGENT_LIST_TOOL_NAME, {})).content[0]?.text ?? "{}") as { agents: ListEntry[] }).agents.find((a) => a.id === "mason")?.sha256 as string;
    const workspaces = Array.from({ length: 16 }, (_, i) => join(tmp, "work", `${"w".repeat(120)}-${String(i).padStart(2, "0")}`));
    const many = await w.gate(UPDATE, { id: "mason", changes: { workspaces }, expected_sha256: await sha256(), idempotency_key: "u1" });
    expect(many.permissionDecision).toBe("deny");
    expect(many.permissionDecisionReason).toContain("; ask for less at once");
    expect(many.permissionDecisionReason).not.toContain("no request to these fields fits");
    // The kept tools' full purpose block alone would put that floor over the cut: only their labels count.
    const old = `workspaces: ${JSON.stringify([join(tmp, "work", "payments")])} → []`;
    const enforced = `enforced: never: none; tools: ${every.join(", ")}; bash prefixes: none`;
    expect([`Update crew member mason ("Mason"), settings sha256 0123456789ab, proposed by Wright`, ...jobDisplayLines(every, catalogue, true), old, enforced].join("\n").length).toBeGreaterThan(MAX_APPROVAL_DISPLAY);
    const two = await w.gate(UPDATE, { id: "mason", changes: { workspaces: workspaces.slice(0, 2) }, expected_sha256: await sha256(), idempotency_key: "u2" });
    expect(two.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
  });

  it("the floor counts the kept tools' label-only job lines and bounds each code job's workspace readiness line by its shortest ready form: a member whose floor is 4,001 gets the owner's remedy; one whose smallest workspaces request is 4,000 is held; between them, ask for less", async () => {
    const h = await bootKernel();
    const catalogue = buildToolCatalogue(SHIPPED_TOOLS);
    const every = catalogue.tools.map((t) => `${K}${t.name}`);
    const jobLines = jobDisplayLines(every, catalogue, false);
    expect(jobLines.length).toBe(catalogue.jobs.length);
    const enforced = `enforced: never: none; tools: ${every.join(", ")}; bash prefixes: none`;
    // The smallest request (workspaces: []) has the readiness of the member with no workspace: every code job flagged "no copy of a repo".
    const cleared = charterReadiness({
      action: "update",
      charter: validated(charter({ id: "pinx", tool_policy: { allowedTools: every, allowedBashPrefixes: [], never: [] }, workspaces: [] })),
      catalogue,
      grant: { kind: "stored", raw: undefined },
      dataDir,
    });
    const workspaceLines = cleared.items.filter((i) => i.subject === "workspace");
    expect(workspaceLines.map((i) => i.jobs)).toEqual([["automate_tickets", "triage_pr_comments", "ask_for_merge"]]);
    const codeJobs = (workspaceLines[0]?.jobs ?? []).map((j: ToolJob) => TOOL_JOBS[j]);
    // A request naming a checkout could show "works in a/b at /" instead: the floor counts that, its shortest ready form.
    const floorReadiness = cleared.items.map((i) =>
      i.subject === "workspace" ? `${READINESS_READY_PREFIX}copy of a repo for ${codeJobs.slice(0, -1).join(", ")} and ${codeJobs.at(-1) as string}: works in a/b at /` : i.line,
    );
    // 5 workspaces of ~90 characters (room for the readiness block) and one padded one: the padding moves the display one character at a time.
    const old = (pad: number) => [...Array.from({ length: 5 }, (_, i) => join(tmp, "work", `${"w".repeat(80)}-${String(i).padStart(2, "0")}`)), join(tmp, "work", "p".repeat(pad))];
    const head = `Update crew member pinx ("Mason"), settings sha256 0123456789ab, proposed by Wright`;
    const smallest = (pad: number) => [head, ...cleared.lines, ...jobLines, `workspaces: ${JSON.stringify(old(pad))} → []`, enforced].join("\n");
    const floor = (pad: number) => [head, READINESS_HEADING, ...floorReadiness, ...jobLines, `workspaces: ${JSON.stringify(old(pad))} → []`, enforced].join("\n");
    const slack = smallest(10).length - floor(10).length;
    expect(slack).toBeGreaterThan(0);
    const padFor = (length: number) => 10 + length - smallest(10).length;
    expect(padFor(MAX_APPROVAL_DISPLAY)).toBeGreaterThan(0);
    expect(padFor(MAX_APPROVAL_DISPLAY + 1 + slack)).toBeLessThan(1000);
    // Without the job lines that request would be well under the cut: the floor must count them.
    expect(smallest(padFor(MAX_APPROVAL_DISPLAY + 1)).length - jobLines.join("\n").length).toBeLessThan(MAX_APPROVAL_DISPLAY);
    const member = (id: string, pad: number) => createAgent(h.store, dataDir, charter({ id, tool_policy: { allowedTools: every, allowedBashPrefixes: [], never: [] }, workspaces: old(pad) }), { by: "owner" }, clock.at);
    const w = await h.session("wright", WRIGHT_POLICY);
    const shaOf = async (id: string) =>
      (JSON.parse((await w.tool(AGENT_LIST_TOOL_NAME, {})).content[0]?.text ?? "{}") as { agents: ListEntry[] }).agents.find((a) => a.id === id)?.sha256 as string;
    const clear = async (id: string, key: string) => w.gate(UPDATE, { id, changes: { workspaces: [] }, expected_sha256: await shaOf(id), idempotency_key: key });

    // A floor of 4,001: no request to workspaces fits, so the remedy is the owner's.
    expect(member("pinb", padFor(MAX_APPROVAL_DISPLAY + 1 + slack)).ok).toBe(true);
    const over = await clear("pinb", "k1");
    expect(over.permissionDecision).toBe("deny");
    expect(over.permissionDecisionReason).toContain(`would be ${MAX_APPROVAL_DISPLAY + 1}, so no request to these fields fits; the owner changes config/agents/pinb.json by hand`);
    expect(over.permissionDecisionReason).not.toContain("ask for less");

    // A floor of 4,000 (the smallest request itself over the cut): a request naming a checkout might fit, so Wright is asked for less.
    expect(member("pind", padFor(MAX_APPROVAL_DISPLAY + slack)).ok).toBe(true);
    const between = await clear("pind", "k3");
    expect(between.permissionDecisionReason).toContain("; ask for less at once");
    expect(between.permissionDecisionReason).not.toContain("no request to these fields fits");

    // 4,000: that same smallest request fits and is held.
    expect(member("pinc", padFor(MAX_APPROVAL_DISPLAY)).ok).toBe(true);
    expect((await clear("pinc", "k2")).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    const shown = heldDisplay(h.store);
    expect(shown.length).toBe(MAX_APPROVAL_DISPLAY);
    expect(plain(shown).slice(1, 1 + jobLines.length)).toEqual(jobLines);
  });

  it("the label-only forms mark a kept job that gains a tool ` (gains tools)` (one mark per job), only on an update: a job it adds is ` (added)`, a kept job with no new tool and every create job unmarked", async () => {
    const catalogue = buildToolCatalogue(SHIPPED_TOOLS);
    const multi = catalogue.jobs.find((j) => j.tools.length >= 2);
    const other = catalogue.jobs.find((j) => j !== multi && j.tools.length >= 1);
    const third = catalogue.jobs.find((j) => j !== multi && j !== other && j.tools.length >= 1);
    if (multi === undefined || other === undefined || third === undefined) throw new Error("the catalogue has no job with two tools");
    const name = (t: { name: string }) => `${K}${t.name}`;
    const [first, ...rest] = multi.tools.map(name);
    const held = [first as string, ...third.tools.map(name)];
    const next = [...multi.tools.map(name), ...other.tools.map(name), ...third.tools.map(name)];
    const byOrder = (lines: Record<string, string>) => catalogue.jobs.filter((j) => j.label in lines).map((j) => lines[j.label] as string);
    // The compact form: the kept job gaining tools is marked once, however many it gains.
    expect(rest.length).toBeGreaterThan(0);
    expect(jobDisplayLines(next, catalogue, false, held)).toEqual(
      byOrder({ [multi.label]: `job: ${multi.label}${DISPLAY_GAINS_TOOLS}`, [other.label]: `job: ${other.label}${DISPLAY_ADDED}`, [third.label]: `job: ${third.label}` }),
    );
    // The full form marks the gained tools' purpose lines instead, never the kept job line.
    const full = jobDisplayLines(next, catalogue, true, held);
    expect(full).toContain(`job: ${multi.label}`);
    expect(full.filter((l) => l.endsWith(DISPLAY_GAINS_TOOLS))).toEqual([]);
    expect(full.filter((l) => l.startsWith("  - ") && l.endsWith(DISPLAY_ADDED)).length).toBe(rest.length);
    // A create (no held list) marks nothing.
    expect(jobDisplayLines(next, catalogue, false)).toEqual(byOrder({ [multi.label]: `job: ${multi.label}`, [other.label]: `job: ${other.label}`, [third.label]: `job: ${third.label}` }));
    // The not-in-catalogue heading likewise: kept and gaining a name.
    expect(jobDisplayLines([`${K}kernel_pad_a`, `${K}kernel_pad_b`], catalogue, false, [`${K}kernel_pad_a`])).toEqual([`job: ${DISPLAY_NOT_IN_CATALOGUE}${DISPLAY_GAINS_TOOLS}`]);
    expect(jobDisplayLines([`${K}kernel_pad_a`], catalogue, false, [`${K}kernel_pad_a`])).toEqual([`job: ${DISPLAY_NOT_IN_CATALOGUE}`]);

    // Through the hold: a member granted every kernel tool but one of a kept job, given every tool, is shown the label-only form with that job marked.
    const h = await bootKernel();
    // (Not the crew-run command jobs' tools: each adds readiness lines naming permissions only the owner can weigh, item 20c, and this case is about the job lines.)
    const shownJobs = catalogue.jobs.filter((j) => !CREW_RUN_JOBS.includes(j.id));
    const every = catalogue.tools.filter((t) => !CREW_RUN_JOBS.includes(t.job)).map(name);
    const missing = rest[0] as string;
    expect(createAgent(h.store, dataDir, charter({ tool_policy: { allowedTools: every.filter((t) => t !== missing), allowedBashPrefixes: [], never: [] } }), { by: "owner" }, clock.at).ok).toBe(true);
    const w = await h.session("wright", WRIGHT_POLICY);
    const sha256 = (JSON.parse((await w.tool(AGENT_LIST_TOOL_NAME, {})).content[0]?.text ?? "{}") as { agents: ListEntry[] }).agents.find((a) => a.id === "mason")?.sha256 as string;
    expect((await w.gate(UPDATE, { id: "mason", changes: { tool_policy: { allowedTools: every, allowedBashPrefixes: [] } }, expected_sha256: sha256, idempotency_key: "u1" })).permissionDecisionReason).toMatch(
      /^approval_required: held as approval 1;/,
    );
    expect(plain(heldDisplay(h.store)).slice(1, 1 + shownJobs.length)).toEqual(shownJobs.map((j) => `job: ${j.label}${j === multi ? DISPLAY_GAINS_TOOLS : ""}`));
  });
});

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

// ---- Item 21b: a ticket duty's source, and the owner's tracker grant on approve ----------------------------------

describe("a ticket duty's tracker (item 21b)", () => {
  const READ = ["clickup_filter_tasks", "clickup_get_task"];
  /** A ticket-working member from ClickUp: Wright drafts the duty's source, never the grant. */
  const ticketCharter = (extra: Record<string, unknown> = {}) =>
    charter({
      duties: [{ text: "Work the owner's ClickUp tickets", jobs: ["automate_tickets"], source: "clickup" }],
      tool_policy: { allowedTools: ["Read", ...tools("automate_tickets")], allowedBashPrefixes: [], never: [] },
      ...extra,
    });
  function tools(job: ToolJob): string[] {
    return (buildToolCatalogue(SHIPPED_TOOLS).jobs.find((j) => j.id === job)?.tools ?? []).map((t) => `${K}${t.name}`);
  }
  function connect(store: Store): void {
    const stored = [...READ, "clickup_create_comment"].map((name) => ({ name, proxy: `kernel_mcp_w_clickup_${name}`, read_only: false, description: "", schema: "{}" }));
    store.prepare("INSERT INTO mcp_connections (kind, server_url, status, granted_tools) VALUES ('clickup', 'https://mcp.example.test/mcp', 'connected', ?)").run(JSON.stringify(stored));
  }
  const connectorsOf = (id: string): unknown => (JSON.parse(readFileSync(agentSettingsPath(dataDir, id), "utf8")) as { connectors?: unknown }).connectors;

  it("the create tool's description names source as the proposal it is, and still says connectors is only the GitHub grant", () => {
    const description = TOOLS[0]?.description ?? "";
    expect(description).toContain('"source": "github" | "clickup" | "jira" | "none"');
    expect(description).toContain("a duty written as a bare line, or with no source, is refused");
    expect(description).toContain("only reads and comments on them through the member's connector access (which needs no job: never name a job for that)");
    expect(description).toContain("It is your proposal, shown on the held card for the owner to change, and it grants nothing");
    expect(description).toContain("connectors is your proposal of the GitHub grant");
    expect(description).toContain("ClickUp and Jira access is never in a charter and never yours to propose");
  });

  it("a Wright create draft carrying a ClickUp or Jira grant, in connectors or anywhere in a duty, is refused and holds nothing", async () => {
    const h = await bootManager();
    const drafts: Record<string, unknown>[] = [
      ticketCharter({ connectors: ["clickup"] }),
      ticketCharter({ connectors: ["jira"] }),
      ticketCharter({ connectors: { clickup: READ } }),
      ticketCharter({ duties: [{ text: "Work tickets", jobs: ["automate_tickets"], source: "clickup", clickup: READ }] }),
      ticketCharter({ duties: [{ text: "Work tickets", jobs: ["automate_tickets"], source: "clickup", connectors: ["clickup"] }] }),
    ];
    for (const [i, draft] of drafts.entries()) {
      const refused = await h.wright.gate(CREATE, { charter: draft, idempotency_key: `c${i}` });
      expect(refused.permissionDecision, `draft ${i}`).toBe("deny");
      expect(refused.permissionDecisionReason, `draft ${i}`).toMatch(/invalid_input/);
      expect(refused.permissionDecisionReason, `draft ${i}`).not.toContain("held as approval");
    }
    expect(h.approvals()).toEqual([]);
  });

  it("after the owner approves with their ticks the member's settings file holds those tools, recorded as the owner's, and the applied sentence names no open tracker access", async () => {
    const h = await bootManager(SHIPPED_TOOLS);
    connect(h.store);
    expect((await h.wright.gate(CREATE, { charter: ticketCharter(), idempotency_key: "c1" })).permissionDecision).toBe("deny");
    h.decide(1, { kind: "clickup", tools: READ });
    expect(getAgent(h.store, "mason")?.created_by).toBe("wright");
    expect(connectorsOf("mason")).toEqual({ clickup: READ });
    const applied = events(h.store, "approval_decided")[0]?.payload.applied as string;
    expect(applied).toContain("The owner granted ClickUp access with this approval.");
    expect(applied).not.toContain("can't read ClickUp tickets");
    expect(applied).not.toContain("ClickUp access is the owner's step");
    expect(events(h.store, "agent_settings_set").map((e) => e.payload)).toEqual([{ id: "mason", field: "connectors", old: null, new: { clickup: READ }, by: "owner", approval_id: 1 }]);
    expect(count(h.store, "SELECT count(*) FROM events WHERE kind = 'agent_created'")).toBe(1);
  });

  it("with no tick the member is created with no grant and the applied sentence names the missing access as open", async () => {
    const h = await bootManager(SHIPPED_TOOLS);
    connect(h.store);
    await h.wright.gate(CREATE, { charter: ticketCharter(), idempotency_key: "c1" });
    h.decide(1);
    expect(connectorsOf("mason")).toBeUndefined();
    expect(events(h.store, "approval_decided")[0]?.payload.applied as string).toContain("Mason can't read ClickUp tickets yet (ClickUp access is the owner's step)");
  });

  it("an owner's tick that would not be a valid grant (a stored grant the file can't hold) is refused by the applier before anything is written", async () => {
    const h = await bootManager(SHIPPED_TOOLS);
    connect(h.store);
    await h.wright.gate(CREATE, { charter: ticketCharter(), idempotency_key: "c1" });
    // 101 listed tools is more than a grant can hold; the store's own list check passes, so the applier's merge is what refuses it.
    const many = Array.from({ length: 101 }, (_, i) => `clickup_tool_${i}`);
    h.store.prepare("UPDATE mcp_connections SET granted_tools = ? WHERE kind = 'clickup'").run(JSON.stringify(many.map((name) => ({ name, proxy: `p_${name}`, read_only: false, description: "", schema: "{}" }))));
    h.decide(1, { kind: "clickup", tools: many });
    expect(getAgent(h.store, "mason")).toBeUndefined();
    expect(presentFiles("mason")).toEqual([]);
    expect(events(h.store, "approval_decided")[0]?.payload).toMatchObject({ apply_refused: "invalid_input" });
  });
});
