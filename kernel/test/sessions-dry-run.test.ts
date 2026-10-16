// Dry-run sessions (phase 3 item 03): a dry-run session can read but never
// act, and reports what it would have done. Driven through the session
// manager's real PreToolUse gate with the fake query/spawn harness from
// session-fakes.ts: never a real model or process.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookCallback, HookInput, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideApproval } from "../src/approvals/index.js";
import type { ApprovalRow } from "../src/approvals/index.js";
import { BudgetMeter } from "../src/budget/index.js";
import {
  DRY_RUN_DENY_MESSAGE,
  DRY_RUN_INPUT_SUMMARY_CHARS,
  DRY_RUN_READ_ONLY_BASH,
  DRY_RUN_READ_ONLY_TOOLS,
  classifyDryRunCall,
  dryRunInputSummary,
  dryRunUsage,
  isDryRunReadOnly,
  isDryRunReadOnlyBash,
  isDryRunReadOnlyKernelTool,
} from "../src/sessions/dry-run.js";
import { SessionManager } from "../src/sessions/manager.js";
import { SessionError } from "../src/sessions/types.js";
import type { DryRunReport, SessionHandle, SessionManagerOptions, StartSessionParams, ToolPolicy } from "../src/sessions/types.js";
import { Store } from "../src/store/index.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const K = "mcp__kernel__";
const COMMENT = "gh pr comment 12 --body SECRETBODY";

let tmp: string;
let pluginDir: string;
let home: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-dry-run-"));
  pluginDir = makePluginDir(tmp);
  home = join(tmp, "home");
  mkdirSync(home);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

const assistant = (): SDKMessage =>
  ({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] }, parent_tool_use_id: null }) as unknown as SDKMessage;
const success = (modelUsage: unknown = {}, text = "DONE"): SDKMessage =>
  ({ type: "result", subtype: "success", is_error: false, result: text, modelUsage }) as unknown as SDKMessage;

function openStore(): Store {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  return store;
}

function setup(options: Partial<SessionManagerOptions> = {}) {
  const store = options.store ?? openStore();
  const fakes = fakeSessions();
  const manager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, ...options },
    { ...fakes.deps, homeDir: home, now: () => new Date("2026-10-16T09:00:00.000Z") },
  );

  /** The gate and stream of one launch attempt. */
  function attempt(call: FakeCall) {
    const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const gate = async (tool: string, input: unknown, cwd = tmp): Promise<Decision> => {
      const hookInput = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: input, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd } as unknown as HookInput;
      return ((await hook(hookInput, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
    };
    /** End the attempt: assistant output, one success result per usage given, then the stream ends. */
    const finish = (...usages: unknown[]): void => {
      call.stream.push(assistant());
      for (const u of usages.length === 0 ? [{}] : usages) call.stream.push(success(u));
      call.stream.end();
    };
    return { gate, bash: (command: string) => gate("Bash", { command }), finish };
  }
  const lastCall = (): FakeCall => fakes.calls[fakes.calls.length - 1] as FakeCall;

  async function session(policy: ToolPolicy, overrides: Partial<StartSessionParams> = {}) {
    const handle = await manager.startSession(startParams(tmp, { policy, closeInputOnResult: false, ...overrides }));
    return { handle, ...attempt(lastCall()) };
  }

  async function resume(id: number, policy: ToolPolicy, dryRun: boolean | undefined) {
    const handle = await manager.resumeSession(id, { permissionMode: "default", cwd: tmp, policy, closeInputOnResult: false, ...(dryRun === undefined ? {} : { dryRun }) });
    return { handle, ...attempt(lastCall()) };
  }

  /** Make an ended session resumable, as a kernel restart would leave it. */
  const interrupt = (id: number): void => {
    store.prepare("UPDATE sessions SET status = 'interrupted', ended_at = NULL WHERE id = ?").run(id);
  };

  const approvals = (): ApprovalRow[] => store.prepare<[], ApprovalRow>("SELECT * FROM approvals ORDER BY id").all();
  const decisions = () => events(store, "tool_decision").map((e) => e.payload);
  return { store, manager, fakes, session, resume, interrupt, approvals, decisions };
}

async function reportOf(handle: SessionHandle): Promise<DryRunReport> {
  const report = await handle.dryRun;
  if (report === null || report === undefined) throw new Error("no dry-run report");
  return report;
}

const GH: ToolPolicy = { allowedTools: ["Read"], allowedBashPrefixes: ["gh"] };

// ---- the pure module ---------------------------------------------------------

describe("dry-run.ts: the read-only sets", () => {
  it("DRY_RUN_READ_ONLY_TOOLS is exactly Read, Glob, Grep and kernel_loomwright_capabilities, frozen", () => {
    expect(DRY_RUN_READ_ONLY_TOOLS).toEqual(["Read", "Glob", "Grep", `${K}kernel_loomwright_capabilities`]);
    expect(Object.isFrozen(DRY_RUN_READ_ONLY_TOOLS)).toBe(true);
  });

  it("the kernel list/get predicate accepts only mcp__kernel__kernel_<name>_list / _get", () => {
    for (const name of ["kernel_task_list", "kernel_task_get", "kernel_trigger_list", "kernel_playbook_list"]) {
      expect(isDryRunReadOnlyKernelTool(`${K}${name}`), name).toBe(true);
    }
    for (const name of [
      `${K}kernel_task_create`,
      `${K}kernel_task_update`,
      `${K}kernel_trigger_register`,
      `${K}kernel_trigger_remove`,
      `${K}kernel_playbook_disable`,
      `${K}kernel_playbook_enable`,
      `${K}kernel_playbook_dry_run`,
      `${K}kernel_notify`,
      `${K}kernel_approval_request`,
      `${K}kernel_schedule_wakeup`,
      `${K}kernel_request_stop`,
      `${K}kernel_list`,
      `${K}kernel__list`,
      `${K}kernel_task_list_x`,
      `${K}kernel_budget_forget`,
      `${K}KERNEL_task_list`,
      "kernel_task_list",
      "mcp__other__kernel_task_list",
      "mcp__kernel2__kernel_task_list",
      `x${K}kernel_task_list`,
    ]) {
      expect(isDryRunReadOnlyKernelTool(name), name).toBe(false);
    }
  });

  it("DRY_RUN_READ_ONLY_BASH is the closed conservative set, frozen; programs that can write, send or run others are out", () => {
    expect(DRY_RUN_READ_ONLY_BASH).toEqual(["cat", "head", "tail", "ls", "wc", "grep", "pwd", "echo"]);
    expect(Object.isFrozen(DRY_RUN_READ_ONLY_BASH)).toBe(true);
    for (const excluded of ["git", "gh", "find", "xargs", "env", "sed", "awk", "sort", "uniq", "tee", "rg", "npm", "npx", "node", "sh", "bash", "curl", "date", "touch"]) {
      expect(DRY_RUN_READ_ONLY_BASH, excluded).not.toContain(excluded);
    }
  });

  it("a Bash command is read-only only when its first shell word is exactly in the set: no path, case-sensitive", () => {
    for (const command of ["cat README.md", "ls", "ls -la", "wc -l x", "'cat' x", "echo hi", "pwd"]) expect(isDryRunReadOnlyBash(command), command).toBe(true);
    for (const command of ["/bin/cat x", "./ls", "CAT x", "Cat x", "catx", "git status", "find . -name x", "sed -n 1p x", "sort -o out x", "", "   ", "FOO=1 cat x", "{cat,rm} x"]) {
      expect(isDryRunReadOnlyBash(command), command).toBe(false);
    }
    expect(isDryRunReadOnly("Bash", { command: 7 })).toBe(false);
    expect(isDryRunReadOnly("Write", { file_path: "/tmp/x", content: "" })).toBe(false);
    expect(isDryRunReadOnly("Read", { file_path: "/tmp/x" })).toBe(true);
  });

  it("classifyDryRunCall: a policy or rail deny is as in a real run, outward is held, ordinary non-read-only would run", () => {
    const allow = { decision: "allow", reason: "tool_allowed" } as const;
    const ordinary = { kind: "ordinary" } as const;
    expect(classifyDryRunCall("Write", {}, { decision: "deny", reason: "tool_not_allowed" }, ordinary)).toEqual({ kind: "as_real_run" });
    expect(classifyDryRunCall("Write", {}, allow, { kind: "deny", reason: "protected_kernel_path" })).toEqual({ kind: "as_real_run" });
    expect(classifyDryRunCall("Read", { file_path: "/x" }, allow, ordinary)).toEqual({ kind: "allow" });
    expect(
      classifyDryRunCall("Bash", { command: "cat ~/.claude/settings.json" }, allow, {
        kind: "outward",
        action: "Bash naming ~/.claude/",
        payload: { tool: "Bash", command: "cat ~/.claude/settings.json", cwd: "/" },
      }),
    ).toEqual({
      kind: "would_do",
      entry: { tool: "Bash", input_summary: "cat ~/.claude/settings.json", would: "held", reason: "dry_run", action: "Bash naming ~/.claude/" },
    });
    expect(classifyDryRunCall("Write", { file_path: "/x", content: "y" }, allow, ordinary)).toEqual({
      kind: "would_do",
      entry: { tool: "Write", input_summary: '{"file_path":"/x","content":"y"}', would: "run", reason: "dry_run" },
    });
  });

  it("the input summary is bounded data: a Bash command or the input's JSON, cut to 500 characters", () => {
    expect(DRY_RUN_INPUT_SUMMARY_CHARS).toBe(500);
    expect(dryRunInputSummary("Bash", { command: `git log ${"a".repeat(1000)}`, description: "d" })).toHaveLength(500);
    expect(dryRunInputSummary("Bash", { command: "git status", description: "d" })).toBe("git status");
    expect(dryRunInputSummary("Write", { file_path: "/x", content: "z".repeat(2000) })).toHaveLength(500);
    expect(dryRunInputSummary("X", undefined)).toBe("");
    expect(dryRunInputSummary("X", "$(rm -rf ~)")).toBe('"$(rm -rf ~)"');
  });

  it("dryRunUsage normalises per model as the meter does: bad numbers read 0, tokens truncated, own keys only", () => {
    const usage = dryRunUsage({
      "claude-haiku-4-5": { inputTokens: 10.9, outputTokens: -1, cacheCreationInputTokens: "3", cacheReadInputTokens: Number.NaN, costUSD: 0.25 },
      __proto__: { inputTokens: 1 },
    });
    expect(usage["claude-haiku-4-5"]).toEqual({
      inputTokens: 10,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      thinkingTokens: 0,
      costUSD: 0.25,
    });
    expect(Object.isFrozen(usage)).toBe(true);
    expect(Object.getPrototypeOf(usage)).toBeNull();
    expect({ ...dryRunUsage(undefined) }).toEqual({});
    expect({ ...dryRunUsage([1, 2]) }).toEqual({});
  });

  it("the model's deny text is fixed and starts with dry_run", () => {
    expect(DRY_RUN_DENY_MESSAGE.startsWith("dry_run")).toBe(true);
    expect(DRY_RUN_DENY_MESSAGE).toContain("recorded");
    expect(DRY_RUN_DENY_MESSAGE).toContain("did not run");
  });
});

// ---- through the gate --------------------------------------------------------

describe("a dry-run session reads, and records every action as would-do", () => {
  it("AC1: Read runs, gh pr comment does not, and the would-do list holds exactly the comment call (held, gh pr comment, dry_run)", async () => {
    const t = setup();
    const s = await t.session(GH, { dryRun: true });
    expect(await s.gate("Read", { file_path: join(tmp, "README.md") })).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "tool_allowed" });
    const comment = await s.bash(COMMENT);
    expect(comment).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: DRY_RUN_DENY_MESSAGE });
    // The model's text is fixed: the call's input never reaches it.
    expect(comment.permissionDecisionReason).not.toContain("SECRETBODY");
    s.finish();
    expect(await s.handle.done).toBe("completed");
    const report = await reportOf(s.handle);
    expect(report.wouldDo).toEqual([{ tool: "Bash", input_summary: COMMENT, would: "held", reason: "dry_run", action: "gh pr comment" }]);
    expect(t.decisions()).toEqual([
      { tool: "Read", decision: "allow", reason: "tool_allowed" },
      { tool: "Bash", decision: "deny", reason: "dry_run", command: COMMENT },
    ]);
    expect(t.approvals()).toEqual([]);
  });

  it("AC2: an outward call the policy allows creates no approval and consumes no grant", async () => {
    const t = setup();
    // A real session's comment is held; the owner approves it once: a one-shot grant for exactly this call.
    const real = await t.session(GH);
    expect((await real.bash(COMMENT)).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    decideApproval(t.store, { id: 1, decision: "once", by: "owner" }, new Date("2026-10-16T09:01:00.000Z"));

    const dry = await t.session(GH, { dryRun: true });
    const d = await dry.bash(COMMENT);
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    // Nothing new held, the grant is not used.
    expect(t.approvals().map((a) => [a.id, a.status])).toEqual([[1, "approved"]]);
    expect(events(t.store, "approval_used")).toEqual([]);
    expect(count(t.store, "SELECT count(*) FROM approvals WHERE requesting_session = ?", dry.handle.id)).toBe(0);
    dry.finish();
    expect((await reportOf(dry.handle)).wouldDo).toEqual([{ tool: "Bash", input_summary: COMMENT, would: "held", reason: "dry_run", action: "gh pr comment" }]);

    // The grant is still there: a real session's identical call uses it now.
    const later = await t.session(GH);
    expect(await later.bash(COMMENT)).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "approval_granted" });
  });

  it("an always-held kernel tool is would-do held, never an approval", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: [`${K}kernel_playbook_enable`], allowedBashPrefixes: [] }, { dryRun: true });
    expect((await s.gate(`${K}kernel_playbook_enable`, { id: 1 })).permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    s.finish();
    expect((await reportOf(s.handle)).wouldDo).toEqual([{ tool: `${K}kernel_playbook_enable`, input_summary: '{"id":1}', would: "held", reason: "dry_run", action: "kernel_playbook_enable" }]);
    expect(t.approvals()).toEqual([]);
  });

  it("an ordinary call that is not read-only would run: Write and Bash touch are denied dry_run, wc runs", async () => {
    const t = setup();
    const scratch = join(tmp, "scratch.txt");
    const s = await t.session({ allowedTools: ["Write", "Edit"], allowedBashPrefixes: ["wc", "touch"] }, { dryRun: true });
    expect((await s.gate("Write", { file_path: scratch, content: "x" })).permissionDecision).toBe("deny");
    expect((await s.gate("Edit", { file_path: scratch, old_string: "a", new_string: "b" })).permissionDecision).toBe("deny");
    expect(await s.bash("wc -l scratch.txt")).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "bash_prefix_allowed" });
    expect((await s.bash("touch x")).permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    s.finish();
    expect((await reportOf(s.handle)).wouldDo).toEqual([
      { tool: "Write", input_summary: JSON.stringify({ file_path: scratch, content: "x" }), would: "run", reason: "dry_run" },
      { tool: "Edit", input_summary: JSON.stringify({ file_path: scratch, old_string: "a", new_string: "b" }), would: "run", reason: "dry_run" },
      { tool: "Bash", input_summary: "touch x", would: "run", reason: "dry_run" },
    ]);
    expect(t.decisions().map((p) => [p.tool, p.decision, p.reason])).toEqual([
      ["Write", "deny", "dry_run"],
      ["Edit", "deny", "dry_run"],
      ["Bash", "allow", "bash_prefix_allowed"],
      ["Bash", "deny", "dry_run"],
    ]);
  });

  it("the read-only Bash set: git status, find -exec, sed, sort -o, a path or case variant are would-do; the set runs; a held read is held", async () => {
    const t = setup();
    const prefixes = ["cat", "head", "tail", "ls", "wc", "grep", "pwd", "echo", "git", "find", "sed", "sort", "/bin/cat", "./ls", "CAT"];
    const s = await t.session({ allowedTools: [], allowedBashPrefixes: prefixes }, { dryRun: true });
    for (const command of ["cat README.md", "head -n 1 README.md", "tail README.md", "ls -la", "wc -l README.md", "grep foo README.md", "pwd", "echo hi"]) {
      expect(await s.bash(command), command).toEqual({ hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "bash_prefix_allowed" });
    }
    const wouldRun = ["git status", "find . -exec rm {} +", "sed -n 1p README.md", "sort -o out.txt README.md", "/bin/cat README.md", "./ls", "CAT README.md"];
    for (const command of wouldRun) expect((await s.bash(command)).permissionDecisionReason, command).toBe(DRY_RUN_DENY_MESSAGE);
    // A read-only program the rail holds is held, not run.
    expect((await s.bash("cat ~/.claude/settings.json")).permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    s.finish();
    expect((await reportOf(s.handle)).wouldDo).toEqual([
      ...wouldRun.map((command) => ({ tool: "Bash", input_summary: command, would: "run", reason: "dry_run" })),
      { tool: "Bash", input_summary: "cat ~/.claude/settings.json", would: "held", reason: "dry_run", action: "Bash naming ~/.claude/" },
    ]);
    expect(t.approvals()).toEqual([]);
  });

  it("AC3: a state-changing kernel_* tool is denied and recorded and the store is unchanged; the kernel's list/get tools run", async () => {
    const t = setup();
    const writes = [
      "kernel_task_create",
      "kernel_task_update",
      "kernel_trigger_register",
      "kernel_trigger_remove",
      "kernel_notify",
      "kernel_approval_request",
      "kernel_schedule_wakeup",
      "kernel_request_stop",
      "kernel_playbook_create",
      "kernel_playbook_dry_run",
    ].map((n) => `${K}${n}`);
    const reads = ["kernel_task_list", "kernel_task_get", "kernel_trigger_list", "kernel_loomwright_capabilities"].map((n) => `${K}${n}`);
    const other = "mcp__other__thing_list";
    const s = await t.session({ allowedTools: [...writes, ...reads, other, "Glob", "Grep", "WebFetch", "Task"], allowedBashPrefixes: [] }, { dryRun: true });

    const tables = t.store
      .prepare<[], string>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'events'")
      .pluck()
      .all();
    const snapshot = (): Record<string, string> =>
      Object.fromEntries(tables.map((name) => [name, JSON.stringify(t.store.prepare(`SELECT * FROM "${name}"`).all())]));
    const before = snapshot();
    const eventsBefore = events(t.store).length;

    for (const tool of writes) expect((await s.gate(tool, { title: "x" })).permissionDecisionReason, tool).toBe(DRY_RUN_DENY_MESSAGE);
    for (const tool of [other, "WebFetch", "Task"]) expect((await s.gate(tool, {})).permissionDecisionReason, tool).toBe(DRY_RUN_DENY_MESSAGE);
    for (const tool of [...reads, "Glob", "Grep"]) expect((await s.gate(tool, {})).permissionDecision, tool).toBe("allow");

    expect(snapshot()).toEqual(before);
    // The only new events are the calls' own decisions.
    expect(events(t.store).slice(eventsBefore).every((e) => e.kind === "tool_decision")).toBe(true);
    expect(t.decisions()).toHaveLength(writes.length + 3 + reads.length + 2);
    s.finish();
    expect((await reportOf(s.handle)).wouldDo.map((e) => [e.tool, e.would])).toEqual([...writes, other, "WebFetch", "Task"].map((tool) => [tool, "run"]));
  });

  it("a call the policy denies keeps the policy's reason and adds no would-do entry; so does a rail deny", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: ["Read", "Write"], allowedBashPrefixes: ["gh"] }, { dryRun: true });
    expect((await s.gate("Edit", { file_path: join(tmp, "x"), old_string: "a", new_string: "b" })).permissionDecisionReason).toBe("tool_not_allowed");
    expect((await s.bash("git push")).permissionDecisionReason).toBe("bash_prefix_not_allowed");
    expect((await s.bash("gh pr view 1; rm x")).permissionDecisionReason).toBe("bash_shell_metacharacter");
    expect((await s.gate("Write", { file_path: join(t.store.dataDir, "studio.db"), content: "" })).permissionDecisionReason).toBe("protected_kernel_path");
    expect((await s.bash("gh pr merge 12")).permissionDecisionReason).toBe("merge_blocked");
    s.finish();
    expect((await reportOf(s.handle)).wouldDo).toEqual([]);
    expect(t.decisions().map((p) => p.reason)).toEqual(["tool_not_allowed", "bash_prefix_not_allowed", "bash_shell_metacharacter", "protected_kernel_path", "merge_blocked"]);
    expect(t.approvals()).toEqual([]);
  });

  it("a long command's input summary is the same 500 characters the tool_decision event records", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: [], allowedBashPrefixes: ["git"] }, { dryRun: true });
    const command = `git log ${"a".repeat(800)}`;
    await s.bash(command);
    s.finish();
    const [entry] = (await reportOf(s.handle)).wouldDo;
    expect(entry?.input_summary).toHaveLength(500);
    expect(entry?.input_summary).toBe(t.decisions()[0]?.command);
  });
});

describe("a dry-run gate fails closed", () => {
  it("a would-do entry that cannot be built denies with kernel_gate_error and records no entry", async () => {
    const t = setup();
    const s = await t.session({ allowedTools: ["mcp__other__send"], allowedBashPrefixes: [] }, { dryRun: true });
    const hostile = {
      toJSON() {
        throw new Error("boom");
      },
    };
    expect(await s.gate("mcp__other__send", hostile)).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "kernel_gate_error" });
    expect(t.decisions()).toEqual([{ tool: "mcp__other__send", decision: "deny", reason: "kernel_gate_error" }]);
    s.finish();
    expect((await reportOf(s.handle)).wouldDo).toEqual([]);
  });

  it("a dry_run deny whose decision cannot be recorded denies with kernel_gate_error and keeps no entry", async () => {
    const t = setup();
    const s = await t.session(GH, { dryRun: true });
    const prepare = t.store.prepare.bind(t.store);
    const spy = vi.spyOn(t.store, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("INSERT INTO events (at, kind, actor, session_id")) throw new Error("disk full");
      return prepare(sql);
    }) as typeof t.store.prepare);
    expect(await s.bash(COMMENT)).toEqual({ hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "kernel_gate_error" });
    spy.mockRestore();
    expect(t.decisions()).toEqual([]);
    expect(t.approvals()).toEqual([]);
    s.finish();
    expect((await reportOf(s.handle)).wouldDo).toEqual([]);
  });
});

// ---- the report, the meter, resume ---------------------------------------------

describe("the dry-run report", () => {
  const USAGE_1 = { "claude-haiku-4-5": { inputTokens: 100, outputTokens: 10, cacheCreationInputTokens: 5, cacheReadInputTokens: 0, costUSD: 0.01 } };
  const USAGE_2 = { "claude-haiku-4-5": { inputTokens: 250, outputTokens: 30, cacheCreationInputTokens: 5, cacheReadInputTokens: 7, thinkingTokens: 4, costUSD: 0.03 } };

  it("holds the would-do list, the final text and the LAST result's usage (never summed); a real run's is null", async () => {
    const t = setup();
    const dry = await t.session(GH, { dryRun: true });
    await dry.bash(COMMENT);
    dry.finish(USAGE_1, USAGE_2);
    expect(await dry.handle.done).toBe("completed");
    const report = await reportOf(dry.handle);
    expect(report.finalText).toBe("DONE");
    expect(report.finalText).toBe(await dry.handle.result);
    expect({ ...report.usage }).toEqual({
      "claude-haiku-4-5": { inputTokens: 250, outputTokens: 30, cacheCreationInputTokens: 5, cacheReadInputTokens: 7, thinkingTokens: 4, costUSD: 0.03 },
    });
    expect(report.wouldDo).toHaveLength(1);
    expect(Object.isFrozen(report.wouldDo)).toBe(true);

    const real = await t.session(GH);
    real.finish(USAGE_1);
    expect(await real.handle.done).toBe("completed");
    expect(await real.handle.dryRun).toBeNull();
  });

  it("never rejects: a usage that cannot be read gives an empty usage, and keeps the would-do list and the final text", async () => {
    const t = setup();
    const s = await t.session(GH, { dryRun: true });
    await s.bash(COMMENT);
    const hostile = Object.defineProperty({}, "claude-haiku-4-5", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    s.finish(hostile);
    expect(await s.handle.done).toBe("completed");
    const report = await reportOf(s.handle);
    expect(report.finalText).toBe("DONE");
    expect(report.wouldDo).toHaveLength(1);
    expect({ ...report.usage }).toEqual({});
  });

  it("a dry-run session that is stopped still reports its would-do list, with no final text", async () => {
    const t = setup();
    const s = await t.session(GH, { dryRun: true });
    await s.bash(COMMENT);
    expect(await t.manager.stopSession(s.handle.id)).toBe("stopped");
    const report = await reportOf(s.handle);
    expect(report.finalText).toBeNull();
    expect(report.wouldDo).toHaveLength(1);
    expect({ ...report.usage }).toEqual({});
  });

  it("AC5: the budget meter records a dry-run session's token usage exactly as a real session's", async () => {
    const store = openStore();
    const meter = new BudgetMeter({ store, authProvider: stubProvider() });
    const t = setup({ store, onMessage: (id, message) => meter.observe(id, message) });
    const budget = (id: number) =>
      t.store
        .prepare<[number], Record<string, unknown>>(
          "SELECT agent, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, thinking_tokens, cost_usd FROM budget WHERE session_id = ? ORDER BY id",
        )
        .all(id);

    const dry = await t.session(GH, { dryRun: true });
    await dry.bash(COMMENT);
    dry.finish(USAGE_1, USAGE_2);
    expect(await dry.handle.done).toBe("completed");
    const real = await t.session(GH);
    real.finish(USAGE_1, USAGE_2);
    expect(await real.handle.done).toBe("completed");

    expect(budget(dry.handle.id)).toHaveLength(2);
    expect(budget(dry.handle.id)).toEqual(budget(real.handle.id));
    expect(count(t.store, "SELECT sum(input_tokens) FROM budget WHERE session_id = ?", dry.handle.id)).toBe(250);
  });
});

describe("dry run and resume", () => {
  it("a dry-run start writes one session_dry_run event; a real start writes none", async () => {
    const t = setup();
    const dry = await t.session(GH, { dryRun: true });
    const real = await t.session(GH, { dryRun: false });
    const plain = await t.session(GH);
    expect(events(t.store, "session_dry_run").map((e) => [e.session_id, e.payload])).toEqual([[dry.handle.id, {}]]);
    for (const s of [dry, real, plain]) s.finish();
  });

  it("a session that started as a dry run stays dry on a resume with dryRun: false: a would-do entry and zero approvals", async () => {
    const t = setup();
    const dry = await t.session(GH, { dryRun: true });
    dry.finish();
    expect(await dry.handle.done).toBe("completed");
    t.interrupt(dry.handle.id);

    const resumed = await t.resume(dry.handle.id, GH, false);
    expect((await resumed.bash(COMMENT)).permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    resumed.finish();
    expect(await resumed.handle.done).toBe("completed");
    expect((await reportOf(resumed.handle)).wouldDo).toEqual([{ tool: "Bash", input_summary: COMMENT, would: "held", reason: "dry_run", action: "gh pr comment" }]);
    expect(t.approvals()).toEqual([]);
    // No second event: the start's one is what every resume reads.
    expect(events(t.store, "session_dry_run")).toHaveLength(1);

    // The control: a real session resumed the same way takes the approval path.
    const real = await t.session(GH);
    real.finish();
    await real.handle.done;
    t.interrupt(real.handle.id);
    const realResumed = await t.resume(real.handle.id, GH, false);
    expect((await realResumed.bash(COMMENT)).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    realResumed.finish();
    expect(await realResumed.handle.dryRun).toBeNull();
  });

  it("dryRun: true makes that resume of a real session a dry run, and only that resume", async () => {
    const t = setup();
    const real = await t.session(GH);
    real.finish();
    await real.handle.done;
    t.interrupt(real.handle.id);

    const dryResume = await t.resume(real.handle.id, GH, true);
    expect((await dryResume.bash(COMMENT)).permissionDecisionReason).toBe(DRY_RUN_DENY_MESSAGE);
    dryResume.finish();
    expect((await reportOf(dryResume.handle)).wouldDo).toHaveLength(1);
    expect(t.approvals()).toEqual([]);

    t.interrupt(real.handle.id);
    const again = await t.resume(real.handle.id, GH, undefined);
    expect((await again.bash(COMMENT)).permissionDecisionReason).toMatch(/^approval_required: held as approval 1;/);
    again.finish();
  });

  it("a dryRun that is not a boolean is refused with invalid_params before any row or spawn", async () => {
    const t = setup();
    const err = await t.manager.startSession(startParams(tmp, { dryRun: "yes" as unknown as boolean })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionError);
    expect((err as SessionError).code).toBe("invalid_params");
    expect(t.fakes.calls).toHaveLength(0);
    expect(count(t.store, "SELECT count(*) FROM sessions")).toBe(0);
  });
});
