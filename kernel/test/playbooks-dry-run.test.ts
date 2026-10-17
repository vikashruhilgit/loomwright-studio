// Phase 3 item 07: Wright dry-runs a playbook, shows the result, and asks the
// owner to enable it (`kernel/src/playbooks/dry-run.ts`, `enable.ts`, the
// gate's pre-hold check in `kernel/src/sessions/manager.ts`).
//
// Kernel-level cases run a kernel composed with the shipped features over the
// fake spawner/query (session-fakes.ts): the real PreToolUse gate, the real
// kernel MCP server's tool handlers (the ones a session would call), and the
// real `studio` CLI over the loopback API. A dry-run session is a stand-in
// whose script calls the gate itself. Manager-level cases run the session
// manager with a stand-in `startSession` for the dry run. Never the real SDK,
// a model or a real process.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideApproval, formatApprovals, listApprovals } from "../src/approvals/index.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { defaultWrightSettingsJson, wrightMemoryDir, wrightSettingsPath } from "../src/brain/index.js";
import { runCli } from "../src/cli/index.js";
import { InvalidContributionError, defineTool, mergeContributions } from "../src/features/contribution.js";
import type { ContributedTool } from "../src/features/contribution.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps } from "../src/kernel.js";
import { getPlaybook, mirrorPath, playbooksContribution } from "../src/playbooks/index.js";
import { DRY_RUN_NEXT_FIRES, formatDryRunSummary, latestDryRun, nextFiresOf, previewDedupeKey } from "../src/playbooks/dry-run.js";
import { enablePlaybook } from "../src/playbooks/store.js";
import { SessionManager } from "../src/sessions/manager.js";
import type { DryRunReport, HeldToolCheck, SessionHandle, SessionRow, SessionStatus, StartSessionParams, ToolPolicy, WouldDoEntry } from "../src/sessions/types.js";
import { Store } from "../src/store/index.js";
import { contributedToolHandler, heldToolCheckOf } from "../src/tools/server.js";
import type { KernelToolContext, KernelToolResult } from "../src/tools/server.js";
import { count, events } from "./loop-helpers.js";
import { fakeMsg, fakeSessions, flush, makePluginDir, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const K = "mcp__kernel__";
const ENABLE = `${K}kernel_playbook_enable`;
const DRY_RUN = `${K}kernel_playbook_dry_run`;
/** Wright's model in `wright.json`: never the dry run's. */
const SETTINGS_MODEL = "claude-haiku-4-5";
/** The playbook's own model: the dry-run session runs it. */
const PLAYBOOK_MODEL = "claude-sonnet-4-5";
const COMMENT = "gh pr comment 12 --body looks-good";
const WED_10Z = "2026-10-14T10:00:00.000Z";
/** Wright's own session may call the playbook tools (the enable is still always held). */
const WRIGHT_POLICY: ToolPolicy = { allowedTools: [ENABLE, DRY_RUN], allowedBashPrefixes: ["gh"] };
const USAGE = {
  [PLAYBOOK_MODEL]: { inputTokens: 1200, outputTokens: 300, cacheCreationInputTokens: 40, cacheReadInputTokens: 60, thinkingTokens: 10, costUSD: 0.01 },
};
/** 1200 + 300 + 40 + 60: thinking tokens are already inside the output. */
const USAGE_TOKENS = 1600;

const DAILY = {
  name: "Daily repo summary",
  intent: "Every weekday at 9, summarise what changed in repo X.",
  trigger: { kind: "cron", spec: "0 9 * * 1-5", tz: "Asia/Kolkata" },
  dedupe_key: ["playbook.id", "trigger.scheduled_at"],
  priority: "low",
  model: PLAYBOOK_MODEL,
  token_limit: 50_000,
};
/** From Wed 2026-10-14 10:00Z (15:30 in Kolkata): Thu, Fri, then Mon at 09:00 IST. */
const NEXT_FIRES = ["2026-10-15T03:30:00.000Z", "2026-10-16T03:30:00.000Z", "2026-10-19T03:30:00.000Z"];

let tmp: string;
let dataDir: string;
let pluginDir: string;
let home: string;
const clock = { at: new Date(WED_10Z) };
const kernels: Kernel[] = [];
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-pb-dry-run-"));
  dataDir = join(tmp, "data");
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
  clock.at = new Date(WED_10Z);
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  for (const s of stores.splice(0)) if (s.isOpen) s.close();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Fixtures ------------------------------------------------------------------

/** Write Wright's settings: a model (or none), its permission mode, and a policy that reads files and runs `gh` (as `sessions-dry-run.test.ts`'s). */
function writeSettings(model: string | null = SETTINGS_MODEL): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  const policy = { status: "owner", allowedTools: ["Read"], allowedBashPrefixes: ["gh"] };
  writeFileSync(file, `${JSON.stringify({ ...settings, model, tool_policy: policy }, null, 2)}\n`);
}

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

/** Call `call`'s PreToolUse gate as the CLI would, from `tmp`. */
function gateOf(call: FakeCall): (tool: string, toolInput: unknown) => Promise<Decision> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  return async (tool, toolInput) => {
    const input = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
    return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
  };
}

const assistant = (): SDKMessage => ({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, parent_tool_use_id: null }) as unknown as SDKMessage;
const success = (modelUsage: unknown): SDKMessage => ({ type: "result", subtype: "success", is_error: false, result: "DONE", modelUsage }) as unknown as SDKMessage;

function value<T = Record<string, unknown>>(r: KernelToolResult | undefined): T {
  expect(r?.isError, r?.content[0]?.text).toBeUndefined();
  return JSON.parse(r?.content[0]?.text ?? "null") as T;
}

function errorText(r: KernelToolResult | undefined): string {
  expect(r?.isError, r?.content[0]?.text).toBe(true);
  return r?.content[0]?.text ?? "";
}

interface DryRunValue {
  run_id: number;
  playbook: number;
  version: number;
  status: string;
  would_do: unknown[];
  next_fires: string[];
  dedupe_key: string | null;
  tokens: number;
  summary: string;
}

interface RunRow {
  id: number;
  playbook: number;
  version: number;
  kind: string;
  status: string;
  session_id: number | null;
  tokens: number | null;
  result_json: string | null;
}

function runRows(store: Store): RunRow[] {
  return store.prepare<[], RunRow>("SELECT id, playbook, version, kind, status, session_id, tokens, result_json FROM playbook_runs ORDER BY id").all();
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

/** A stand-in dry-run session: what it does through its gate before it ends. */
type Driver = (call: FakeCall) => Promise<void>;

/** Reads one file, attempts one `gh pr comment`, then ends with `USAGE`. */
const readThenComment: Driver = async (call) => {
  await flush(1);
  const gate = gateOf(call);
  const read = await gate("Read", { file_path: join(tmp, "README.md") });
  if (read.permissionDecision !== "allow") throw new Error(`Read was not allowed: ${read.permissionDecisionReason}`);
  await gate("Bash", { command: COMMENT });
  call.stream.push(assistant());
  call.stream.push(success(USAGE));
  call.stream.end();
};

/**
 * A kernel with the shipped features, Wright's settings written, and Wright's
 * own session started (its gate and its kernel tools). A session that runs
 * the playbook's model (a dry run) is driven by the next queued driver; any
 * other stays open.
 */
async function bootKernel() {
  writeSettings();
  const keychain = memoryKeychain();
  const drivers: Driver[] = [];
  const failures: unknown[] = [];
  const fakes = fakeSessions({
    script: (call) => {
      call.stream.push(fakeMsg.init(call.options.sessionId ?? call.options.resume ?? "unknown"));
      if (call.options.model !== PLAYBOOK_MODEL) return;
      const driver = drivers.shift();
      if (driver === undefined) failures.push(new Error("a dry-run session started with no driver"));
      else void driver(call).catch((err: unknown) => failures.push(err));
    },
  });
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
  const wright = await kernel.sessions.startSession({
    agent: "wright",
    prompt: "Draft a playbook.",
    model: SETTINGS_MODEL,
    permissionMode: "default",
    cwd: tmp,
    policy: WRIGHT_POLICY,
    closeInputOnResult: false,
  });
  const wrightCall = fakes.calls[fakes.calls.length - 1] as FakeCall;
  const tools = toolsOf(wrightCall);
  const gate = gateOf(wrightCall);
  const tool = (name: string, args: unknown): Promise<KernelToolResult> => {
    const t = tools[name];
    if (t === undefined) throw new Error(`no tool ${name} on the kernel server`);
    return t.handler(args, {});
  };

  /** Wright's dry run of `id`, its session driven by `driver`. */
  async function dryRun(id: number, key: string, driver: Driver = readThenComment): Promise<KernelToolResult> {
    drivers.push(driver);
    return tool("kernel_playbook_dry_run", { id, idempotency_key: key });
  }

  /** Wright calls `kernel_playbook_enable`: the gate decides, and the handler runs only when it allowed (as the CLI would). */
  async function enable(input: { id: number; idempotency_key: string }): Promise<{ decision: Decision; result?: KernelToolResult }> {
    const decision = await gate(ENABLE, input);
    return decision.permissionDecision === "allow" ? { decision, result: await tool("kernel_playbook_enable", input) } : { decision };
  }

  /** `studio <argv>` against this kernel. */
  async function studio(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(argv, { dataDir, keychain: keychain.reader, stdout: { write: (c: string) => stdout.push(c) }, stderr: { write: (c: string) => stderr.push(c) } });
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  }

  const create = async (args: Record<string, unknown> = {}, key = `c-${Math.random()}`): Promise<{ id: number; slug: string }> =>
    value<{ id: number; slug: string }>(await tool("kernel_playbook_create", { ...DAILY, ...args, idempotency_key: key }));

  return { kernel, store: kernel.store, fakes, wright, gate, tool, dryRun, enable, studio, create, failures };
}

// ---- The manager harness (stand-in dry-run sessions) --------------------------------------

/** What the next stand-in dry-run session reports, and when it ends. */
interface StandInRun {
  report: DryRunReport;
  status: SessionStatus;
  /** Settles when the session ends (default: at once). */
  until?: Promise<void>;
}

const READ_AND_COMMENT_REPORT: DryRunReport = {
  wouldDo: [{ tool: "Bash", input_summary: COMMENT, would: "held", reason: "dry_run", action: "gh pr comment" }],
  finalText: "DONE",
  usage: { [PLAYBOOK_MODEL]: { ...USAGE[PLAYBOOK_MODEL] } },
};

/**
 * A session manager (fake spawner/query) whose gate has the playbooks'
 * pre-hold check (or `heldToolCheck`), with Wright's own session started;
 * the tools run with `ctx.sessions` = the manager, except that `startSession`
 * is a stand-in that inserts the session row and ends as the next `runs`
 * entry says (no driver needed). `startSession: false` gives the tools none.
 */
async function bootManager(o: { heldToolCheck?: HeldToolCheck; startSession?: false; policy?: ToolPolicy } = {}) {
  writeSettings();
  const store = new Store({ dataDir });
  stores.push(store);
  const now = (): Date => clock.at;
  const runs: StandInRun[] = [];
  const started: StartSessionParams[] = [];
  const fakes = fakeSessions();
  const toolSessions: KernelToolContext["sessions"] = {
    stopSession: (id: number) => manager.stopSession(id),
    getSession: (id: number) => manager.getSession(id),
    ...(o.startSession === false
      ? {}
      : {
          startSession: async (params: StartSessionParams): Promise<SessionHandle> => {
            started.push(params);
            const run = runs.shift() ?? { report: READ_AND_COMMENT_REPORT, status: "completed" as const };
            const id = Number(
              store
                .prepare("INSERT INTO sessions (agent, status, model, playbook, playbook_version, started_at, updated_at) VALUES (?, 'running', ?, ?, ?, ?, ?)")
                .run(params.agent, params.model, params.playbook ?? null, params.playbookVersion ?? null, WED_10Z, WED_10Z).lastInsertRowid,
            );
            const done = (run.until ?? Promise.resolve()).then(() => {
              store.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(run.status, id);
              return run.status;
            });
            return { id, sdkSessionId: `stand-in-${id}`, pgid: undefined, done, result: done.then(() => run.report.finalText), dryRun: done.then(() => run.report) };
          },
        }),
  };
  const contextOf = (sessionId: number): KernelToolContext => ({ store, sessions: toolSessions, sessionId, now });
  const manager: SessionManager = new SessionManager(
    {
      store,
      authProvider: stubProvider(),
      loomwrightPath: pluginDir,
      stopGraceMs: 10,
      baseEnv: { PATH: "/usr/bin" },
      heldToolCheck: o.heldToolCheck ?? heldToolCheckOf(playbooksContribution.tools ?? [], contextOf),
    },
    { ...fakes.deps, homeDir: home, now },
  );
  const wright = await manager.startSession({
    agent: "wright",
    prompt: "Draft a playbook.",
    model: SETTINGS_MODEL,
    permissionMode: "default",
    cwd: tmp,
    policy: o.policy ?? WRIGHT_POLICY,
    closeInputOnResult: false,
  });
  const gate = gateOf(fakes.calls[0] as FakeCall);
  const toolOf = (name: string): ContributedTool => {
    const t = (playbooksContribution.tools ?? []).find((x) => x.name === name);
    if (t === undefined) throw new Error(`no tool ${name}`);
    return t;
  };
  const tool = (name: string, args: unknown, sessionId = wright.id): Promise<KernelToolResult> => contributedToolHandler(toolOf(name), contextOf(sessionId))(args);
  const create = async (args: Record<string, unknown> = {}, key = `c-${Math.random()}`): Promise<{ id: number; slug: string }> =>
    value<{ id: number; slug: string }>(await tool("kernel_playbook_create", { ...DAILY, ...args, idempotency_key: key }));
  const approvals = () => store.prepare<[], { id: number; status: string; payload_json: string }>("SELECT id, status, payload_json FROM approvals ORDER BY id").all();
  return { store, manager, fakes, wright, gate, tool, create, runs, started, approvals };
}

// ---- AC1: the dry run ---------------------------------------------------------------

describe("kernel_playbook_dry_run (AC1)", () => {
  it("runs the draft in a dry-run session that reads a file and attempts gh pr comment: a dry_run run with the comment as would-do, three fire times, tokens; the mirror shows the summary", async () => {
    const h = await bootKernel();
    const { id, slug } = await h.create();
    const before = h.fakes.calls.length;
    const result = value<DryRunValue>(await h.dryRun(id, "d1"));
    expect(h.failures).toEqual([]);

    const wouldDo: WouldDoEntry[] = [{ tool: "Bash", input_summary: COMMENT, would: "held", reason: "dry_run", action: "gh pr comment" }];
    const dedupeKey = `playbook.id=${id}|trigger.scheduled_at=${NEXT_FIRES[0]}`;
    expect(result).toEqual({
      run_id: 1,
      playbook: id,
      version: 1,
      status: "done",
      would_do: wouldDo,
      next_fires: NEXT_FIRES,
      dedupe_key: dedupeKey,
      tokens: USAGE_TOKENS,
      summary: formatDryRunSummary({ run_id: 1, version: 1, status: "done", would_do: wouldDo, next_fires: NEXT_FIRES, dedupe_key: dedupeKey, tokens: USAGE_TOKENS }),
    });
    expect(result.summary).toContain(`Bash "${COMMENT}" (held for approval: gh pr comment)`);

    // One dry-run session: the playbook's model (never the settings'), Wright's memory dir, recorded as the playbook's at version 1.
    expect(h.fakes.calls).toHaveLength(before + 1);
    const call = h.fakes.calls[before] as FakeCall;
    expect(call.options.model).toBe(PLAYBOOK_MODEL);
    expect(call.options.cwd).toBe(wrightMemoryDir(dataDir));
    const session = h.store.prepare<[], SessionRow>("SELECT * FROM sessions ORDER BY id DESC LIMIT 1").get() as SessionRow;
    expect(session).toMatchObject({ agent: "wright", status: "completed", model: PLAYBOOK_MODEL, playbook: id, playbook_version: 1 });
    expect(events(h.store, "session_dry_run").map((e) => e.session_id)).toEqual([session.id]);
    // The comment was denied as dry_run: nothing held for the owner.
    expect(count(h.store, "SELECT count(*) FROM approvals")).toBe(0);

    const rows = runRows(h.store);
    expect(rows.map(({ result_json: _r, ...r }) => r)).toEqual([{ id: 1, playbook: id, version: 1, kind: "dry_run", status: "done", session_id: session.id, tokens: USAGE_TOKENS }]);
    expect(JSON.parse(rows[0]?.result_json ?? "null")).toEqual({ would_do: wouldDo, next_fires: NEXT_FIRES, dedupe_key: dedupeKey, final_text: "DONE", usage: USAGE });
    expect(events(h.store, "playbook_dry_run").map((e) => [e.session_id, e.payload])).toEqual([
      [h.wright.id, { playbook_id: id, version: 1, run_id: 1, status: "done", tokens: USAGE_TOKENS, would_do: 1 }],
    ]);
    expect(latestDryRun(h.store, id, 1)?.summary).toBe(result.summary);

    const mirror = readFileSync(mirrorPath(dataDir, slug), "utf8");
    expect(mirror).toContain(`Last dry run: \`${result.summary}\``);
    expect(mirror).not.toContain("No dry run yet");
  });

  it("an edit makes the mirror say the new version has no dry run yet (the earlier version's summary is not shown as current)", async () => {
    const h = await bootKernel();
    const { id, slug } = await h.create();
    value(await h.dryRun(id, "d1"));
    value(await h.tool("kernel_playbook_update", { id, changes: { intent: "Summarise repo Y instead." }, idempotency_key: "u1" }));
    const mirror = readFileSync(mirrorPath(dataDir, slug), "utf8");
    expect(mirror).toContain("Last dry run: No dry run of version 2 yet.");
    expect(latestDryRun(h.store, id, 2)).toBeNull();
  });
});

// ---- AC2-AC5: enabling ------------------------------------------------------------------

describe("kernel_playbook_enable (AC2-AC5)", () => {
  it("AC2: with no dry run of the current version, the call is refused (held_refused) saying a dry run is required, and nothing is held", async () => {
    const h = await bootKernel();
    const { id } = await h.create();
    const { decision } = await h.enable({ id, idempotency_key: "e1" });
    expect(decision.permissionDecision).toBe("deny");
    expect(decision.permissionDecisionReason).toContain("a dry run of version 1 is required");
    expect(count(h.store, "SELECT count(*) FROM approvals")).toBe(0);
    expect(events(h.store, "tool_decision").filter((e) => e.payload.tool === ENABLE).map((e) => e.payload)).toEqual([{ tool: ENABLE, decision: "deny", reason: "held_refused" }]);
    expect(getPlaybook(h.store, id)?.status).toBe("draft");
  });

  it("AC3 + AC4: after a dry run the call is held; studio approvals shows the playbook, its version, its values marked (proposed) and the dry run; approved and retried, it is enabled at that version", async () => {
    const h = await bootKernel();
    const { id, slug } = await h.create();
    const dry = value<DryRunValue>(await h.dryRun(id, "d1"));
    const input = { id, idempotency_key: "e1" };

    const held = await h.enable(input);
    expect(held.decision.permissionDecisionReason).toMatch(/^approval_required: held as approval 1; it did not run\./);
    // The grant matches on the payload alone: the display never enters it.
    const [approval] = h.store.prepare<[], { status: string; payload_json: string }>("SELECT status, payload_json FROM approvals").all();
    expect(approval?.status).toBe("pending");
    expect(approval?.payload_json).toBe(JSON.stringify({ cwd: tmp, input: { id, idempotency_key: "e1" }, tool: ENABLE }));
    const requested = events(h.store, "approval_requested")[0]?.payload as Record<string, unknown>;
    expect(requested).toMatchObject({ id: 1, action: "kernel_playbook_enable", source: "rail", subject_version: 1 });
    expect(requested.display).toEqual(expect.stringContaining(dry.summary));

    const shown = await h.studio(["approvals"]);
    expect(shown.code).toBe(0);
    const out = shown.stdout;
    expect(out).toContain("  display:\n");
    expect(out).toContain(`    Enable playbook "Daily repo summary" (${slug}, #${id}) at version 1, agent wright\n`);
    expect(out).toContain(`    model: ${PLAYBOOK_MODEL} (proposed)\n`);
    expect(out).toContain("    priority: low (proposed)\n");
    expect(out).toContain("    dedupe_key: playbook.id, trigger.scheduled_at (proposed)\n");
    expect(out).toContain("    token_limit: 50000 (proposed)\n");
    expect(out).toContain("    effort: not set\n");
    expect(out).toContain(`    dry run: ${dry.summary}\n`);
    // The display comes before the payload, which is printed as before.
    expect(out.indexOf("  display:")).toBeLessThan(out.indexOf("  payload:"));

    expect((await h.studio(["approve", "1", "once"])).code).toBe(0);
    const retried = await h.enable(input);
    expect(retried.decision).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "approval_granted" });
    expect(value(retried.result)).toEqual({ playbook: id, version: 1, status: "enabled", approval_id: 1 });
    expect(getPlaybook(h.store, id)).toMatchObject({ status: "enabled", version: 1 });
    expect(events(h.store, "playbook_enabled").map((e) => [e.session_id, e.payload])).toEqual([[h.wright.id, { playbook_id: id, version: 1, approval_id: 1, by: "owner" }]]);
    expect(readFileSync(mirrorPath(dataDir, slug), "utf8")).toContain("- Status: `enabled`");

    // A repeat with the same key returns the first result.
    expect(value(await h.tool("kernel_playbook_enable", input))).toEqual({ playbook: id, version: 1, status: "enabled", approval_id: 1 });
  });

  it("AC5a: an edit and a new dry run after the request: the retry uses the v1 grant but the handler refuses (version changed) and the playbook stays draft", async () => {
    const h = await bootKernel();
    const { id } = await h.create();
    value(await h.dryRun(id, "d1"));
    const input = { id, idempotency_key: "e1" };
    expect((await h.enable(input)).decision.permissionDecision).toBe("deny");
    expect((await h.studio(["approve", "1", "once"])).code).toBe(0);
    value(await h.tool("kernel_playbook_update", { id, changes: { intent: "Summarise repo Y instead." }, idempotency_key: "u1" }));
    value(await h.dryRun(id, "d2"));

    const retried = await h.enable(input);
    // The gate let it through on the owner's v1 grant (the payload is the same)...
    expect(retried.decision.permissionDecisionReason).toBe("approval_granted");
    expect(events(h.store, "approval_used").map((e) => e.payload)).toEqual([{ id: 1, tool: ENABLE }]);
    // ...and the handler refuses: the owner approved version 1, the playbook is at version 2.
    expect(errorText(retried.result)).toContain("version changed");
    expect(getPlaybook(h.store, id)).toMatchObject({ status: "draft", version: 2 });
    expect(events(h.store, "playbook_enabled")).toEqual([]);
  });

  it("AC5b: an edit with no new dry run: the retry is refused before the hold (held_refused) and the owner's grant is left unused", async () => {
    const h = await bootKernel();
    const { id } = await h.create();
    value(await h.dryRun(id, "d1"));
    const input = { id, idempotency_key: "e1" };
    await h.enable(input);
    expect((await h.studio(["approve", "1", "once"])).code).toBe(0);
    value(await h.tool("kernel_playbook_update", { id, changes: { priority: "high" }, idempotency_key: "u1" }));

    const retried = await h.enable(input);
    expect(retried.decision.permissionDecision).toBe("deny");
    expect(retried.decision.permissionDecisionReason).toContain("a dry run of version 2 is required");
    expect(events(h.store, "tool_decision").filter((e) => e.payload.tool === ENABLE).map((e) => e.payload.reason)).toEqual(["approval_required", "held_refused"]);
    expect(events(h.store, "approval_used")).toEqual([]);
    expect(h.store.prepare("SELECT id, status FROM approvals").all()).toEqual([{ id: 1, status: "approved" }]);
    expect(getPlaybook(h.store, id)).toMatchObject({ status: "draft", version: 2 });
  });

  it("the handler enables only on its own consumed approval: B's direct call cannot borrow A's approval from the same session (defence behind the gate)", async () => {
    const h = await bootKernel();
    const a = await h.create({ name: "Playbook A" });
    const b = await h.create({ name: "Playbook B" });
    value(await h.dryRun(a.id, "da"));
    value(await h.dryRun(b.id, "db"));
    const inputA = { id: a.id, idempotency_key: "ea" };
    const inputB = { id: b.id, idempotency_key: "eb" };
    expect((await h.enable(inputA)).decision.permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect((await h.enable(inputB)).decision.permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
    expect((await h.studio(["approve", "1", "once"])).code).toBe(0);

    const retriedA = await h.enable(inputA);
    expect(value(retriedA.result)).toEqual({ playbook: a.id, version: 1, status: "enabled", approval_id: 1 });

    // B's handler, called directly in the same session (bypassing the gate): its own approval was never approved or consumed.
    expect(errorText(await h.tool("kernel_playbook_enable", inputB))).toContain("no approval of its own");
    expect(getPlaybook(h.store, b.id)?.status).toBe("draft");
    expect(events(h.store, "playbook_enabled").map((e) => e.payload.playbook_id)).toEqual([a.id]);
  });

  it("a key an earlier enable used: after enable, edit and a new dry run, the same-key enable is refused before the hold (held_refused), no approval written", async () => {
    const h = await bootKernel();
    const { id } = await h.create();
    value(await h.dryRun(id, "d1"));
    const input = { id, idempotency_key: "e1" };
    await h.enable(input);
    expect((await h.studio(["approve", "1", "once"])).code).toBe(0);
    expect(value((await h.enable(input)).result)).toEqual({ playbook: id, version: 1, status: "enabled", approval_id: 1 });
    value(await h.tool("kernel_playbook_update", { id, changes: { intent: "Summarise repo Y instead." }, idempotency_key: "u1" }));
    expect(getPlaybook(h.store, id)).toMatchObject({ status: "draft", version: 2 });
    value(await h.dryRun(id, "d2"));

    const again = await h.enable(input);
    expect(again.decision.permissionDecision).toBe("deny");
    expect(again.decision.permissionDecisionReason).toContain("idempotency_key already used for an enable in this session; use a new key");
    expect(again.result).toBeUndefined();
    expect(h.store.prepare("SELECT id, status FROM approvals").all()).toEqual([{ id: 1, status: "approved" }]);
    expect(events(h.store, "tool_decision").filter((e) => e.payload.tool === ENABLE).map((e) => e.payload.reason)).toEqual([
      "approval_required",
      "approval_granted",
      "held_refused",
    ]);

    // A new key asks the owner again, and enables version 2 on that approval.
    const fresh = { id, idempotency_key: "e2" };
    expect((await h.enable(fresh)).decision.permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
    expect((await h.studio(["approve", "2", "once"])).code).toBe(0);
    expect(value((await h.enable(fresh)).result)).toEqual({ playbook: id, version: 2, status: "enabled", approval_id: 2 });
    expect(events(h.store, "playbook_enabled").map((e) => e.payload.version)).toEqual([1, 2]);
  });

  it("defence behind the gate: when a newer approval was consumed for a used key, the handler refuses and never replays the old result as success", async () => {
    // A check that holds every call (as if the pre-hold check let the used key through).
    let h!: Awaited<ReturnType<typeof bootManager>>;
    h = await bootManager({ heldToolCheck: () => ({ display: "d", subjectVersion: getPlaybook(h.store, 1)?.version ?? 1 }) });
    const { id } = await h.create();
    expect(id).toBe(1);
    const input = { id, idempotency_key: "e1" };
    value(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    await h.gate(ENABLE, input);
    decideApproval(h.store, { id: 1, decision: "once", by: "owner" }, clock.at);
    expect((await h.gate(ENABLE, input)).permissionDecisionReason).toBe("approval_granted");
    expect(value(await h.tool("kernel_playbook_enable", input))).toEqual({ playbook: id, version: 1, status: "enabled", approval_id: 1 });
    value(await h.tool("kernel_playbook_update", { id, changes: { intent: "Summarise repo Y instead." }, idempotency_key: "u1" }));
    value(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d2" }));

    expect((await h.gate(ENABLE, input)).permissionDecisionReason).toMatch(/^approval_required: held as approval 2;/);
    decideApproval(h.store, { id: 2, decision: "once", by: "owner" }, clock.at);
    expect((await h.gate(ENABLE, input)).permissionDecisionReason).toBe("approval_granted");
    const text = errorText(await h.tool("kernel_playbook_enable", input));
    expect(text).toContain("idempotency_key already used for an enable in this session");
    expect(text).toContain("its stored result is for approval 1, not approval 2; nothing was enabled");
    expect(getPlaybook(h.store, id)).toMatchObject({ status: "draft", version: 2 });
    expect(events(h.store, "playbook_enabled").map((e) => e.payload.approval_id)).toEqual([1]);
  });
});

// ---- AC6 and the dry run's refusals ------------------------------------------------------

describe("kernel_playbook_dry_run refusals (AC6)", () => {
  it("AC6: a playbook with no model is refused naming its model, though wright.json has one; no session starts", async () => {
    const h = await bootManager();
    const { id } = await h.create({ model: undefined });
    const text = errorText(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    expect(text).toContain(`kernel_playbook_dry_run: model: playbook ${id} has no model; the kernel never picks one`);
    expect(h.started).toEqual([]);
    expect(runRows(h.store)).toEqual([]);
    // Refused before the step was kept: the same key runs once the model is set.
    expect(count(h.store, "SELECT count(*) FROM work_steps WHERE key LIKE 'kernel_playbook_dry_run:%'")).toBe(0);
  });

  it("Wright's own settings without a model are a refusal naming wright.json, after the playbook's model", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    writeSettings(null);
    expect(errorText(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }))).toMatch(/kernel_playbook_dry_run: wright\.json: .*wright\.json/);
    expect(h.started).toEqual([]);
  });

  it("refuses another agent's playbook and an enabled one", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    const other = await h.manager.startSession({ agent: "scout", prompt: "x", model: SETTINGS_MODEL, permissionMode: "default", cwd: tmp, policy: WRIGHT_POLICY, closeInputOnResult: false });
    expect(errorText(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }, other.id))).toContain("belongs to agent wright");
    enablePlaybook(h.store, { id, version: 1, sessionId: null, approvalId: 1 }, clock.at);
    expect(errorText(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d2" }))).toContain("already enabled at version 1");
    expect(h.started).toEqual([]);
  });

  it("a composition whose tools get no startSession refuses with an error result naming it, never a throw", async () => {
    const h = await bootManager({ startSession: false });
    const { id } = await h.create();
    expect(errorText(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }))).toContain("no session manager");
    expect(runRows(h.store)).toEqual([]);
  });

  it("a repeat with the same key returns the stored result and starts no second session", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    const first = value<DryRunValue>(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    const again = value<DryRunValue>(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    expect(again).toEqual(first);
    expect(h.started).toHaveLength(1);
    expect(runRows(h.store)).toHaveLength(1);
    expect(h.started[0]).toMatchObject({ agent: "wright", prompt: DAILY.intent, model: PLAYBOOK_MODEL, dryRun: true, playbook: id, playbookVersion: 1, cwd: wrightMemoryDir(dataDir) });
  });

  it("a same-key repeat after an edit is refused naming both versions (the old version's summary is never replayed as the new one's); a new key dry-runs the new version", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    value(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    value(await h.tool("kernel_playbook_update", { id, changes: { intent: "Summarise repo Y instead." }, idempotency_key: "u1" }));
    const text = errorText(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    expect(text).toContain(`kernel_playbook_dry_run: idempotency_key already used in this session for the dry run of version 1; playbook ${id} is now at version 2: use a new key`);
    expect(h.started).toHaveLength(1);
    expect(runRows(h.store)).toHaveLength(1);
    expect(latestDryRun(h.store, id, 2)).toBeNull();
    expect(value<DryRunValue>(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d2" }))).toMatchObject({ version: 2, status: "done" });
    expect(h.started).toHaveLength(2);
  });

  it("a session that does not complete is a failed run, never a dry run of the version", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    h.runs.push({ report: { wouldDo: [], finalText: null, usage: {} }, status: "failed" });
    const result = value<DryRunValue>(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    expect(result).toMatchObject({ status: "failed", would_do: [], tokens: 0 });
    expect(runRows(h.store).map((r) => r.status)).toEqual(["failed"]);
    expect(latestDryRun(h.store, id, 1)).toBeNull();
  });

  it("a stale running row (its session gone) is failed on the next call, before the step, so a same-key repeat clears it too", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    value(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    // As a kill -9 mid dry run leaves it: a running row whose session is no longer live.
    const stale = Number(
      h.store
        .prepare("INSERT INTO sessions (agent, status, model, playbook, playbook_version, started_at, updated_at) VALUES ('wright', 'interrupted', ?, ?, 1, ?, ?)")
        .run(PLAYBOOK_MODEL, id, WED_10Z, WED_10Z).lastInsertRowid,
    );
    h.store.prepare("INSERT INTO playbook_runs (playbook, version, kind, status, session_id, started_at) VALUES (?, 1, 'dry_run', 'running', ?, ?)").run(id, stale, WED_10Z);
    value(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    expect(runRows(h.store).map((r) => [r.id, r.status])).toEqual([
      [1, "done"],
      [2, "failed"],
    ]);
    expect(h.started).toHaveLength(1);
  });

  it("an overlapping call's cleanup leaves a run whose session is still live alone; both runs end done", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    let endFirst!: () => void;
    h.runs.push({ report: READ_AND_COMMENT_REPORT, status: "completed", until: new Promise<void>((r) => (endFirst = r)) });
    const first = h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" });
    await flush(2);
    expect(runRows(h.store).map((r) => r.status)).toEqual(["running"]);
    // A second dry run (another key) runs its cleanup while the first session is still running.
    value(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d2" }));
    expect(runRows(h.store).map((r) => r.status)).toEqual(["running", "done"]);
    endFirst();
    value(await first);
    expect(runRows(h.store).map((r) => r.status)).toEqual(["done", "done"]);
    expect(latestDryRun(h.store, id, 1)?.run_id).toBe(2);
  });

  it("the end of a run writes its own outcome whatever a cleanup wrote meanwhile", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    let end!: () => void;
    h.runs.push({ report: READ_AND_COMMENT_REPORT, status: "completed", until: new Promise<void>((r) => (end = r)) });
    const pending = h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" });
    await flush(2);
    // An overlapping call's cleanup (or anything else) marked the in-flight row failed.
    h.store.prepare("UPDATE playbook_runs SET status = 'failed', ended_at = ? WHERE id = 1").run(WED_10Z);
    end();
    expect(value<DryRunValue>(await pending).status).toBe("done");
    expect(runRows(h.store).map((r) => [r.status, r.tokens])).toEqual([["done", USAGE_TOKENS]]);
    expect(latestDryRun(h.store, id, 1)).not.toBeNull();
  });
});

// ---- The gate's pre-hold check (Seam B) ------------------------------------------------------

describe("the gate's pre-hold check: it can only narrow", () => {
  const input = { id: 1, idempotency_key: "e1" };

  it("no check, or a tool with no beforeHold (undefined): held exactly as before, no display", async () => {
    const check = vi.fn<HeldToolCheck>(() => undefined);
    const h = await bootManager({ heldToolCheck: check });
    expect((await h.gate(ENABLE, input)).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    expect(check).toHaveBeenCalledWith(ENABLE, input, h.wright.id);
    expect(events(h.store, "approval_requested")[0]?.payload).toEqual({ id: 1, action: "kernel_playbook_enable", source: "rail", agent: "wright" });
    expect(listApprovals(h.store)[0]).not.toHaveProperty("display");
  });

  it("{display, subjectVersion}: held with the display (cut to 4000 characters) and subject_version on the event, never in the payload; a matching grant is consumed as before", async () => {
    const check = vi.fn<HeldToolCheck>(() => ({ display: `line one\n${"x".repeat(5000)}`, subjectVersion: 7 }));
    const h = await bootManager({ heldToolCheck: check });
    await h.gate(ENABLE, input);
    const payload = events(h.store, "approval_requested")[0]?.payload as { display: string; subject_version: number };
    expect(payload.subject_version).toBe(7);
    expect(payload.display).toHaveLength(4000);
    expect(h.approvals()[0]?.payload_json).toBe(JSON.stringify({ cwd: tmp, input, tool: ENABLE }));
    expect(listApprovals(h.store)[0]?.display).toBe(payload.display);
    decideApproval(h.store, { id: 1, decision: "once", by: "owner" }, clock.at);
    expect((await h.gate(ENABLE, input)).permissionDecisionReason).toBe("approval_granted");
    expect(events(h.store, "approval_used").map((e) => e.payload)).toEqual([{ id: 1, tool: ENABLE }]);
  });

  it("{refuse}: denied held_refused with its text, one tool_decision, no approval, and an approved grant is left unused", async () => {
    let refuse = false;
    const h = await bootManager({ heldToolCheck: () => (refuse ? { refuse: "not now: a reason" } : { display: "d" }) });
    await h.gate(ENABLE, input);
    decideApproval(h.store, { id: 1, decision: "once", by: "owner" }, clock.at);
    refuse = true;
    expect(await h.gate(ENABLE, input)).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "not now: a reason" });
    expect(events(h.store, "tool_decision").map((e) => e.payload.reason)).toEqual(["approval_required", "held_refused"]);
    expect(events(h.store, "approval_used")).toEqual([]);
    expect(h.approvals().map((a) => [a.id, a.status])).toEqual([[1, "approved"]]);
  });

  it("a beforeHold that throws denies kernel_gate_error, with no approval and no grant consumed", async () => {
    const throwing = defineTool({
      name: "kernel_playbook_enable",
      description: "x",
      shape: {},
      handler: () => null,
      beforeHold: () => {
        throw new Error("boom");
      },
    });
    let h!: Awaited<ReturnType<typeof bootManager>>;
    h = await bootManager({ heldToolCheck: heldToolCheckOf([throwing], (sessionId) => ({ store: h.store, sessions: h.manager, sessionId })) });
    expect(await h.gate(ENABLE, input)).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "kernel_gate_error" });
    expect(h.approvals()).toEqual([]);
    expect(events(h.store, "tool_decision").map((e) => e.payload.reason)).toEqual(["kernel_gate_error"]);
  });

  it("any other answer (a promise, an empty refusal, an unknown key, a bad version) denies kernel_gate_error", async () => {
    const answers: unknown[] = [Promise.resolve({ display: "d" }), { refuse: "" }, { display: "d", extra: 1 }, { display: "d", subjectVersion: 0 }, { refuse: "r", display: "d" }, "held", null];
    let next: unknown;
    const h = await bootManager({ heldToolCheck: () => next as never });
    for (const answer of answers) {
      next = answer;
      expect((await h.gate(ENABLE, input)).permissionDecisionReason, String(JSON.stringify(answer))).toBe("kernel_gate_error");
    }
    expect(h.approvals()).toEqual([]);
  });

  it("is asked only for an always-held tool, and never in a dry-run session", async () => {
    const check = vi.fn<HeldToolCheck>(() => ({ refuse: "no" }));
    const h = await bootManager({ heldToolCheck: check });
    // An ordinary outward call is held as before, without asking.
    expect((await h.gate("Bash", { command: COMMENT })).permissionDecisionReason).toMatch(/^approval_required/);
    expect(check).not.toHaveBeenCalled();
    const dry = await h.manager.startSession({ agent: "wright", prompt: "x", model: SETTINGS_MODEL, permissionMode: "default", cwd: tmp, policy: WRIGHT_POLICY, closeInputOnResult: false, dryRun: true });
    const dryGate = gateOf(h.fakes.calls[h.fakes.calls.length - 1] as FakeCall);
    expect((await dryGate(ENABLE, input)).permissionDecisionReason).toMatch(/^dry_run/);
    expect(check).not.toHaveBeenCalled();
    await h.manager.stopSession(dry.id);
  });

  it("the playbooks' check parses with the tool's own shape first: bad arguments are refused, nothing held", async () => {
    const h = await bootManager();
    const d = await h.gate(ENABLE, { id: "one", idempotency_key: "e1" });
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toMatch(/^kernel_playbook_enable: invalid input/);
    expect(h.approvals()).toEqual([]);
  });

  it("mergeContributions refuses a beforeHold that is not a function", () => {
    const bad = { name: "kernel_x", description: "x", shape: {}, handler: () => null, beforeHold: "yes" } as unknown as ContributedTool;
    expect(() => mergeContributions([{ name: "probe", tools: [bad] }])).toThrow(InvalidContributionError);
    expect(() => mergeContributions([{ name: "probe", tools: [bad] }])).toThrow(/kernel_x's beforeHold must be a function/);
  });
});

// ---- studio approvals: the display is untrusted text -----------------------------------------

describe("studio approvals prints the display escaped and indented", () => {
  it("a control character and a fake payload: line in a would-do summary stay escaped, inside the display: block", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    const evil = 'rm-it \u001b[2J\npayload: {"forged": true}';
    h.runs.push({ report: { wouldDo: [{ tool: "Write", input_summary: evil, would: "run", reason: "dry_run" }], finalText: "DONE", usage: {} }, status: "completed" });
    value(await h.tool("kernel_playbook_dry_run", { id, idempotency_key: "d1" }));
    expect((await h.gate(ENABLE, { id, idempotency_key: "e1" })).permissionDecisionReason).toMatch(/^approval_required/);

    const out = formatApprovals(listApprovals(h.store), false);
    expect(out).not.toContain("\u001b");
    expect(out).toContain("\\x1b[2J");
    const lines = out.split("\n");
    const display = lines.indexOf("  display:");
    const payload = lines.indexOf("  payload:");
    expect(display).toBeGreaterThan(-1);
    expect(payload).toBeGreaterThan(display);
    // The forged line is one of the display's own lines: indented under display:, before the real payload: label.
    const forged = lines.findIndex((l) => l.includes('payload: {"forged": true}'));
    expect(forged).toBeGreaterThan(display);
    expect(forged).toBeLessThan(payload);
    expect(lines[forged]).toBe('    payload: {"forged": true}" (would run). Next fires (UTC): 2026-10-15T03:30:00.000Z, 2026-10-16T03:30:00.000Z, 2026-10-19T03:30:00.000Z. Dedupe key for the next fire (preview): playbook.id=1|trigger.scheduled_at=2026-10-15T03:30:00.000Z.');
    for (const line of lines.slice(display + 1, payload)) expect(line.startsWith("    "), line).toBe(true);
    // The mirror shows the same summary as one inert code span.
    const mirror = readFileSync(mirrorPath(dataDir, "daily-repo-summary"), "utf8");
    expect(mirror).not.toContain("\u001b");
    expect(mirror.split("\n").filter((l) => l.startsWith("Last dry run: "))).toHaveLength(1);
  });

  it("an approval without a display prints exactly as before", async () => {
    const h = await bootManager({ heldToolCheck: () => undefined });
    await h.gate(ENABLE, { id: 1, idempotency_key: "e1" });
    const out = formatApprovals(listApprovals(h.store), false);
    expect(out).not.toContain("display:");
    expect(out).toContain("  payload:\n");
  });
});

// ---- The pure parts -----------------------------------------------------------------------

describe("next fires and the dedupe-key preview", () => {
  const now = new Date(WED_10Z);

  it("a cron spec gives three successive fires; a future once gives its instant and its own local date; a past once or no trigger gives none", () => {
    expect(DRY_RUN_NEXT_FIRES).toBe(3);
    expect(nextFiresOf({ kind: "cron", spec: { cron: "0 9 * * 1-5", tz: "Asia/Kolkata" } }, now)).toEqual({ fires: NEXT_FIRES, firstDate: "2026-10-15" });
    expect(nextFiresOf({ kind: "once", spec: { at: "2026-10-15T01:00:00+05:30" } }, now)).toEqual({ fires: ["2026-10-14T19:30:00.000Z"], firstDate: "2026-10-15" });
    expect(nextFiresOf({ kind: "once", spec: { at: "2026-10-14T09:00:00Z" } }, now)).toEqual({ fires: [], firstDate: null });
    expect(nextFiresOf(null, now)).toEqual({ fires: [], firstDate: null });
  });

  it("previewDedupeKey joins the spec's fields in order; null with no spec, no fire, or an unknown field", () => {
    const fire = { playbookId: 3, playbookVersion: 2, triggerId: 9, scheduledAt: NEXT_FIRES[0] as string, date: "2026-10-15" };
    expect(previewDedupeKey(JSON.stringify(["date", "playbook.id", "playbook.version", "trigger.id", "trigger.scheduled_at"]), fire)).toBe(
      `date=2026-10-15|playbook.id=3|playbook.version=2|trigger.id=9|trigger.scheduled_at=${NEXT_FIRES[0]}`,
    );
    expect(previewDedupeKey(null, fire)).toBeNull();
    expect(previewDedupeKey(JSON.stringify(["date"]), null)).toBeNull();
    expect(previewDedupeKey(JSON.stringify(["pr.head"]), fire)).toBeNull();
    expect(previewDedupeKey("not json", fire)).toBeNull();
  });
});

describe("enablePlaybook", () => {
  it("enables a draft at exactly its version, with playbook_enabled by the owner; a moved version or a non-draft is refused and nothing is written", async () => {
    const h = await bootManager();
    const { id } = await h.create();
    expect(() => enablePlaybook(h.store, { id, version: 2, sessionId: null, approvalId: 1 }, clock.at)).toThrow(/version changed/);
    expect(events(h.store, "playbook_enabled")).toEqual([]);
    expect(enablePlaybook(h.store, { id, version: 1, sessionId: h.wright.id, approvalId: 4 }, clock.at).playbook).toMatchObject({ status: "enabled", version: 1 });
    expect(events(h.store, "playbook_enabled").map((e) => e.payload)).toEqual([{ playbook_id: id, version: 1, approval_id: 4, by: "owner" }]);
    expect(() => enablePlaybook(h.store, { id, version: 1, sessionId: null, approvalId: 4 }, clock.at)).toThrow(/is enabled, not draft/);
    expect(() => enablePlaybook(h.store, { id: 99, version: 1, sessionId: null, approvalId: 4 }, clock.at)).toThrow(/no playbook 99/);
  });
});
