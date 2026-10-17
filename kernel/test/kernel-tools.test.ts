// The in-process `kernel` MCP server (AC3, AC4, AC7). Handlers are called
// directly (no model, no real session); the session manager is a fake with
// `getSession` / `stopSession`, and the stop scheduler is injected.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { KERNEL_APPLIED_ACTIONS } from "../src/approvals/index.js";
import type { AppliedApproval } from "../src/approvals/index.js";
import { InvalidContributionError, PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, defineTool, mergeContributions } from "../src/features/index.js";
import { getWorkStep } from "../src/loop/index.js";
import type { SessionRow, SessionStatus } from "../src/sessions/index.js";
import { ALWAYS_HELD_TOOLS } from "../src/sessions/policy.js";
import type { Store } from "../src/store/index.js";
import {
  KERNEL_MCP_SERVER_NAME,
  KERNEL_TOOL_NAMES,
  createKernelMcpServer,
  kernelToolDefinitions,
  kernelToolFullNames,
  kernelToolHandlers,
} from "../src/tools/index.js";
import type { KernelToolContext, KernelToolResult } from "../src/tools/index.js";
import { approvalApplierOf } from "../src/tools/server.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv();
});

afterEach(() => {
  env.cleanup();
});

function insertSession(store: Store, agent: string | null, task: number | null = null): number {
  return Number(store.prepare("INSERT INTO sessions (agent, task_id, status) VALUES (?, ?, 'running')").run(agent, task).lastInsertRowid);
}

function insertTask(store: Store): number {
  return Number(store.prepare("INSERT INTO tasks (title, state) VALUES ('parent', 'open')").run().lastInsertRowid);
}

function fakeSessions(store: Store, stopResult: () => Promise<SessionStatus> = async () => "stopped") {
  const stopSession = vi.fn((_id: number) => stopResult());
  const getSession = (id: number): SessionRow | undefined =>
    store.prepare<[number], SessionRow>("SELECT * FROM sessions WHERE id = ?").get(id);
  return { stopSession, getSession };
}

function tools(store: Store, sessionId: number, extra: Partial<KernelToolContext> = {}) {
  const sessions = fakeSessions(store);
  const scheduled: (() => void)[] = [];
  const ctx: KernelToolContext = { store, sessions, sessionId, now: env.now, schedule: (fn) => void scheduled.push(fn), ...extra };
  return { handlers: kernelToolHandlers(ctx), sessions, scheduled };
}

function value(result: KernelToolResult): Record<string, unknown> {
  expect(result.isError).toBeUndefined();
  return JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;
}

function errorText(result: KernelToolResult): string {
  expect(result.isError).toBe(true);
  return result.content[0]?.text ?? "";
}

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
}

describe("the kernel server", () => {
  it("is named kernel and lists exactly the six tools", () => {
    const sid = insertSession(env.store, "wright");
    const ctx: KernelToolContext = { store: env.store, sessions: fakeSessions(env.store), sessionId: sid };
    const server = createKernelMcpServer(ctx);
    expect(KERNEL_MCP_SERVER_NAME).toBe("kernel");
    expect(server.type).toBe("sdk");
    expect(server.name).toBe("kernel");
    const registered = Object.keys((server.instance as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    const expected = [
      "kernel_task_create",
      "kernel_task_update",
      "kernel_task_list",
      "kernel_task_get",
      "kernel_schedule_wakeup",
      "kernel_request_stop",
    ];
    expect(registered.sort()).toEqual([...expected].sort());
    expect(kernelToolDefinitions(ctx).map((d) => d.name)).toEqual(expected);
    expect([...KERNEL_TOOL_NAMES]).toEqual(expected);
    expect(kernelToolFullNames()).toEqual(expected.map((n) => `mcp__kernel__${n}`));
    // A fresh instance per call: a launch attempt never reuses another's server.
    expect(createKernelMcpServer(ctx).instance).not.toBe(server.instance);
  });
});

describe("kernel_task_create / update / list / get", () => {
  it("creates a task with free-text state and an audit row; the same key in the same session returns the first result", async () => {
    const sid = insertSession(env.store, "wright");
    const { handlers } = tools(env.store, sid);
    const parent = insertTask(env.store);
    const first = value(
      await handlers.kernel_task_create({
        title: "Review PR 7",
        state: "whatever-the-user-says",
        kind: "review",
        parent_task_id: parent,
        links: ["https://example.test/pr/7"],
        next_check_at: "2026-10-03T09:00:00+01:00",
        idempotency_key: "t-1",
      }),
    );
    expect(first).toMatchObject({
      title: "Review PR 7",
      state: "whatever-the-user-says",
      kind: "review",
      parent_task_id: parent,
      links: ["https://example.test/pr/7"],
      next_check_at: "2026-10-03T08:00:00.000Z",
      owner_session_id: null,
    });
    const repeat = value(await handlers.kernel_task_create({ title: "Different", state: "x", idempotency_key: "t-1" }));
    expect(repeat).toEqual(first);
    expect(count(env.store, "SELECT count(*) FROM tasks")).toBe(2);
    expect(events(env.store, "task_created").map((e) => [e.session_id, e.task_id])).toEqual([[sid, first.id]]);
    expect(getWorkStep(env.store, `kernel_task_create:session-${sid}:t-1`)?.status).toBe("done");

    // Also across a restart.
    const store = env.restart();
    expect(value(await tools(store, sid).handlers.kernel_task_create({ title: "Again", state: "x", idempotency_key: "t-1" }))).toEqual(first);
    expect(count(store, "SELECT count(*) FROM tasks")).toBe(2);
  });

  it("two sessions of the same agent using the same key each create their own task", async () => {
    const a = insertSession(env.store, "wright");
    const b = insertSession(env.store, "wright");
    const ta = value(await tools(env.store, a).handlers.kernel_task_create({ title: "A", state: "s", idempotency_key: "k" }));
    const tb = value(await tools(env.store, b).handlers.kernel_task_create({ title: "B", state: "s", idempotency_key: "k" }));
    expect(ta.id).not.toBe(tb.id);
    expect(count(env.store, "SELECT count(*) FROM tasks")).toBe(2);
  });

  it("returns isError (never throws) for invalid input, an unknown parent, and writes nothing", async () => {
    const { handlers } = tools(env.store, insertSession(env.store, "wright"));
    expect(errorText(await handlers.kernel_task_create({ title: "", state: "s", idempotency_key: "k" }))).toMatch(/invalid input/);
    expect(errorText(await handlers.kernel_task_create({ title: "t", state: "s" }))).toMatch(/idempotency_key/);
    expect(errorText(await handlers.kernel_task_create({ title: "t", state: "s", idempotency_key: "x".repeat(201) }))).toMatch(/invalid input/);
    expect(errorText(await handlers.kernel_task_create("not an object"))).toMatch(/invalid input/);
    expect(errorText(await handlers.kernel_task_create({ title: "t", state: "s", parent_task_id: 999, idempotency_key: "k" }))).toMatch(
      /no parent task 999/,
    );
    expect(errorText(await handlers.kernel_task_create({ title: "t", state: "s", next_check_at: "soon", idempotency_key: "k2" }))).toMatch(
      /ISO-8601/,
    );
    expect(count(env.store, "SELECT count(*) FROM tasks")).toBe(0);
    expect(count(env.store, "SELECT count(*) FROM work_steps")).toBe(0);
  });

  it("updates only the given fields, lists with filters and gets by id", async () => {
    const sid = insertSession(env.store, "wright");
    const { handlers } = tools(env.store, sid);
    const t1 = value(await handlers.kernel_task_create({ title: "one", state: "open", assignee_agent: "wright", idempotency_key: "1" }));
    const t2 = value(await handlers.kernel_task_create({ title: "two", state: "open", idempotency_key: "2" }));
    env.advance(1_000);
    const updated = value(await handlers.kernel_task_update({ id: t1.id, state: "waiting", kind: null, links: ["a"] }));
    expect(updated).toMatchObject({ id: t1.id, title: "one", state: "waiting", kind: null, links: ["a"], assignee_agent: "wright" });
    expect(updated.updated_at).toBe(env.now().toISOString());
    expect(events(env.store, "task_updated").map((e) => e.payload)).toEqual([{ fields: ["state", "kind", "links"], state: "waiting" }]);

    // With a key, a repeat returns the first result.
    const keyed = value(await handlers.kernel_task_update({ id: t2.id, title: "two!", idempotency_key: "u" }));
    expect(value(await handlers.kernel_task_update({ id: t2.id, title: "ignored", idempotency_key: "u" }))).toEqual(keyed);
    expect(value(await handlers.kernel_task_get({ id: t2.id })).title).toBe("two!");

    expect(errorText(await handlers.kernel_task_update({ id: 999, state: "x" }))).toMatch(/no task 999/);
    expect(errorText(await handlers.kernel_task_update({ id: t1.id }))).toMatch(/at least one field/);
    expect(errorText(await handlers.kernel_task_get({ id: 999 }))).toMatch(/no task 999/);
    expect(errorText(await handlers.kernel_task_get({ id: -1 }))).toMatch(/invalid input/);

    const ids = (r: KernelToolResult) => (value(r).tasks as { id: number }[]).map((t) => t.id);
    expect(ids(await handlers.kernel_task_list({}))).toEqual([t1.id, t2.id]);
    expect(ids(await handlers.kernel_task_list({ state: "waiting" }))).toEqual([t1.id]);
    expect(ids(await handlers.kernel_task_list({ assignee_agent: "wright" }))).toEqual([t1.id]);
    expect(ids(await handlers.kernel_task_list({ limit: 1 }))).toEqual([t1.id]);
    expect(errorText(await handlers.kernel_task_list({ limit: 201 }))).toMatch(/invalid input/);
  });
});

describe("kernel_schedule_wakeup", () => {
  it("schedules once per key in a session, also across a restart", async () => {
    const sid = insertSession(env.store, "wright");
    const args = { at: "2026-10-02T11:00:00Z", reason: "re-check", idempotency_key: "w" };
    const first = value(await tools(env.store, sid).handlers.kernel_schedule_wakeup(args));
    expect(first).toEqual({ wakeupId: expect.any(Number), dueAt: "2026-10-02T11:00:00.000Z" });
    expect(value(await tools(env.store, sid).handlers.kernel_schedule_wakeup({ ...args, at: "2027-01-01T00:00:00Z" }))).toEqual(first);
    const store = env.restart();
    expect(value(await tools(store, sid).handlers.kernel_schedule_wakeup(args))).toEqual(first);
    expect(count(store, "SELECT count(*) FROM wakeups")).toBe(1);
    expect(events(store, "wakeup_scheduled").map((e) => e.session_id)).toEqual([sid]);
  });

  it("returns isError for an unparseable time and writes nothing", async () => {
    const { handlers } = tools(env.store, insertSession(env.store, "wright"));
    expect(errorText(await handlers.kernel_schedule_wakeup({ at: "next tuesday", reason: "r", idempotency_key: "w" }))).toMatch(/ISO-8601/);
    expect(count(env.store, "SELECT count(*) FROM wakeups")).toBe(0);
  });
  it("returns isError for a reason in the kernel-reserved cap_* namespace (typed or legacy) and writes nothing; other reasons are accepted", async () => {
    const { handlers } = tools(env.store, insertSession(env.store, "wright"));
    for (const [i, reason] of ["cap_reset:stub-provider:five_hour", "cap_recheck:stub-provider"].entries()) {
      expect(errorText(await handlers.kernel_schedule_wakeup({ at: "2026-10-02T11:00:00Z", reason, idempotency_key: `r${i}` }))).toMatch(/reserved/);
    }
    expect(count(env.store, "SELECT count(*) FROM wakeups")).toBe(0);
    expect(count(env.store, "SELECT count(*) FROM work_steps")).toBe(0);
    expect(value(await handlers.kernel_schedule_wakeup({ at: "2026-10-02T11:00:00Z", reason: "re-check the cap_reset:stub-provider PR", idempotency_key: "ok" }))).toEqual({
      wakeupId: expect.any(Number),
      dueAt: "2026-10-02T11:00:00.000Z",
    });
  });
});

describe("kernel_request_stop", () => {
  it("writes the handoff markdown at memory/<agent>/handoffs/<task>.md, records stop_requested and schedules the stop", async () => {
    const task = insertTask(env.store);
    const sid = insertSession(env.store, "wright", task);
    const { handlers, sessions, scheduled } = tools(env.store, sid);
    const result = value(await handlers.kernel_request_stop({ handoff: "Done: reviewed PR 7.\nNext: wait for CI.", idempotency_key: "stop-1" }));
    const path = join(env.dataDir, "memory", "wright", "handoffs", `${task}.md`);
    expect(result).toEqual({ path, stopping: true });
    const text = readFileSync(path, "utf8");
    expect(text).toContain("- Agent: wright");
    expect(text).toContain(`- Task: ${task}`);
    expect(text).toContain(`- Session: ${sid}`);
    expect(text).toContain(`- Written: ${env.now().toISOString()}`);
    expect(text.endsWith("Done: reviewed PR 7.\nNext: wait for CI.\n")).toBe(true);
    expect(readdirSync(join(env.dataDir, "memory", "wright", "handoffs"))).toEqual([`${task}.md`]);
    expect(events(env.store, "stop_requested").map((e) => [e.session_id, e.task_id, e.payload])).toEqual([
      [sid, task, { path, step: `kernel_request_stop:session-${sid}:stop-1` }],
    ]);

    // Scheduled, never awaited inside the handler.
    expect(sessions.stopSession).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    await flush();
    expect(sessions.stopSession.mock.calls).toEqual([[sid]]);
  });

  it("a repeat with the same key in the same session returns the first result: one file write, one stop_requested", async () => {
    const sid = insertSession(env.store, "wright");
    const { handlers } = tools(env.store, sid);
    const first = value(await handlers.kernel_request_stop({ handoff: "first", idempotency_key: "s" }));
    expect(value(await handlers.kernel_request_stop({ handoff: "second", idempotency_key: "s" }))).toEqual(first);
    const store = env.restart();
    expect(value(await tools(store, sid).handlers.kernel_request_stop({ handoff: "third", idempotency_key: "s" }))).toEqual(first);
    expect(readFileSync(first.path as string, "utf8")).toContain("\nfirst\n");
    expect(events(store, "stop_requested")).toHaveLength(1);
  });

  it("a re-run after a crash (step left started) rewrites the file and appends no second stop_requested", async () => {
    const sid = insertSession(env.store, "wright");
    const { handlers } = tools(env.store, sid);
    const first = value(await handlers.kernel_request_stop({ handoff: "note", idempotency_key: "s" }));
    // Simulate a crash between the effects and `done`.
    env.store.prepare("UPDATE work_steps SET status = 'started', result_json = NULL WHERE key = ?").run(`kernel_request_stop:session-${sid}:s`);
    const store = env.restart();
    expect(value(await tools(store, sid).handlers.kernel_request_stop({ handoff: "note", idempotency_key: "s" }))).toEqual(first);
    expect(events(store, "stop_requested")).toHaveLength(1);
    expect(events(store, "notify")).toHaveLength(0);
    expect(getWorkStep(store, `kernel_request_stop:session-${sid}:s`)?.status).toBe("done");
  });

  it("two calls with different keys in one session record one stop_requested each, matching the stops scheduled", async () => {
    const sid = insertSession(env.store, "wright");
    const { handlers, sessions, scheduled } = tools(env.store, sid);
    const r1 = value(await handlers.kernel_request_stop({ handoff: "one", idempotency_key: "s1" }));
    const r2 = value(await handlers.kernel_request_stop({ handoff: "two", idempotency_key: "s2" }));
    expect(r2.path).toBe(r1.path);
    expect(events(env.store, "stop_requested").map((e) => e.payload.step)).toEqual([
      `kernel_request_stop:session-${sid}:s1`,
      `kernel_request_stop:session-${sid}:s2`,
    ]);
    expect(scheduled).toHaveLength(2);
    for (const fn of scheduled) fn();
    await flush();
    expect(sessions.stopSession).toHaveBeenCalledTimes(2);
  });

  it("two sessions of the same agent with the same key each write their own note and stop", async () => {
    const a = insertSession(env.store, "wright");
    const b = insertSession(env.store, "wright");
    const ta = tools(env.store, a);
    const tb = tools(env.store, b);
    const ra = value(await ta.handlers.kernel_request_stop({ handoff: "a", idempotency_key: "stop-1" }));
    const rb = value(await tb.handlers.kernel_request_stop({ handoff: "b", idempotency_key: "stop-1" }));
    expect(ra.path).toBe(join(env.dataDir, "memory", "wright", "handoffs", `session-${a}.md`));
    expect(rb.path).toBe(join(env.dataDir, "memory", "wright", "handoffs", `session-${b}.md`));
    for (const t of [ta, tb]) for (const fn of t.scheduled) fn();
    await flush();
    expect(ta.sessions.stopSession.mock.calls).toEqual([[a]]);
    expect(tb.sessions.stopSession.mock.calls).toEqual([[b]]);
    expect(events(env.store, "stop_requested")).toHaveLength(2);
  });

  it("uses _unassigned for a session with no agent", async () => {
    const sid = insertSession(env.store, null);
    const r = value(await tools(env.store, sid).handlers.kernel_request_stop({ handoff: "x", idempotency_key: "s" }));
    expect(r.path).toBe(join(env.dataDir, "memory", "_unassigned", "handoffs", `session-${sid}.md`));
  });

  it("refuses an agent id with / or .. (no path traversal) and writes nothing", async () => {
    for (const agent of ["../evil", "a/b", "..", ".hidden"]) {
      const sid = insertSession(env.store, agent);
      const { handlers, scheduled } = tools(env.store, sid);
      expect(errorText(await handlers.kernel_request_stop({ handoff: "x", idempotency_key: "s" }))).toMatch(/memory directory/);
      expect(scheduled).toHaveLength(0);
    }
    expect(existsSync(join(env.dataDir, "memory"))).toBe(false);
    expect(events(env.store, "stop_requested")).toHaveLength(0);
    expect(count(env.store, "SELECT count(*) FROM work_steps")).toBe(0);
  });

  it("records stop_failed when the scheduled stop rejects", async () => {
    const sid = insertSession(env.store, "wright");
    const scheduled: (() => void)[] = [];
    const sessions = fakeSessions(env.store, async () => {
      throw new Error("not_live");
    });
    const handlers = kernelToolHandlers({ store: env.store, sessions, sessionId: sid, now: env.now, schedule: (fn) => void scheduled.push(fn) });
    value(await handlers.kernel_request_stop({ handoff: "x", idempotency_key: "s" }));
    scheduled[0]?.();
    await flush();
    expect(events(env.store, "stop_failed").map((e) => [e.session_id, e.payload])).toEqual([[sid, { error: "not_live" }]]);
  });

  it("defaults to setImmediate for the stop, after the handler has returned", async () => {
    const sid = insertSession(env.store, "wright");
    const sessions = fakeSessions(env.store);
    const handlers = kernelToolHandlers({ store: env.store, sessions, sessionId: sid, now: env.now });
    value(await handlers.kernel_request_stop({ handoff: "x", idempotency_key: "s" }));
    await vi.waitFor(() => expect(sessions.stopSession).toHaveBeenCalledTimes(1));
  });
});

describe("approvalApplierOf: the kernel-applied actions' applier over the contributed tools", () => {
  const ENABLE = "mcp__kernel__kernel_playbook_enable";
  const APPROVAL: AppliedApproval = { id: 3, sessionId: 9, agent: "wright", subjectVersion: 2, requestedEventId: 41 };
  /** A tool named `name` whose applier records what it got. */
  function applying(name: string) {
    const seen: { args: unknown; now: Date; approval: AppliedApproval }[] = [];
    const t = defineTool({
      name,
      description: "test tool",
      shape: { id: z.number().int().positive(), idempotency_key: z.string().min(1) },
      handler: () => null,
      applyOnApproval: (args, ctx) => {
        seen.push({ args, now: ctx.now(), approval: ctx.approval });
        return { applied: `applied ${args.id}` };
      },
    });
    return { t, seen };
  }

  it("calls the tool's applyOnApproval by full name with the input parsed against its shape, the decision's instant and the approval", () => {
    const { t, seen } = applying("kernel_playbook_enable");
    const at = new Date("2026-10-17T10:00:00.000Z");
    const applier = approvalApplierOf([t]);
    expect(applier(ENABLE, { id: 4, idempotency_key: "k" }, APPROVAL, env.store, at)).toEqual({ applied: "applied 4" });
    expect(seen).toEqual([{ args: { id: 4, idempotency_key: "k" }, now: at, approval: APPROVAL }]);
  });

  it("answers undefined for a tool with no applier (another tool, or the short name), never running anything", () => {
    const { t, seen } = applying("kernel_playbook_enable");
    const applier = approvalApplierOf([t]);
    expect(applier("Bash", { command: "x" }, APPROVAL, env.store, new Date())).toBeUndefined();
    expect(applier("kernel_playbook_enable", { id: 1, idempotency_key: "k" }, APPROVAL, env.store, new Date())).toBeUndefined();
    expect(approvalApplierOf([])(ENABLE, {}, APPROVAL, env.store, new Date())).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("refuses a held input that fails the tool's shape (invalid_input, naming the tool), without calling it", () => {
    const { t, seen } = applying("kernel_playbook_enable");
    const refused = approvalApplierOf([t])(ENABLE, { id: "one" }, APPROVAL, env.store, new Date());
    expect(refused).toMatchObject({ refused: "invalid_input" });
    expect((refused as { text: string }).text).toMatch(/^kernel_playbook_enable: the held input is not valid: /);
    expect(approvalApplierOf([t])(ENABLE, undefined, APPROVAL, env.store, new Date())).toMatchObject({ refused: "invalid_input" });
    expect(seen).toEqual([]);
  });

  it("throws InvalidContributionError at build time for a tool that declares applyOnApproval outside KERNEL_APPLIED_ACTIONS (the closed set is enforced in code)", () => {
    expect(() => approvalApplierOf([applying("kernel_probe").t])).toThrow(InvalidContributionError);
    expect(() => approvalApplierOf([applying("kernel_probe").t])).toThrow(/mcp__kernel__kernel_probe is not in KERNEL_APPLIED_ACTIONS/);
    // A tool with no applier is never checked.
    expect(() => approvalApplierOf([defineTool({ name: "kernel_probe", description: "x", shape: {}, handler: () => null })])).not.toThrow();
  });

  it("throws InvalidContributionError at build time when a KERNEL_APPLIED_ACTIONS member is not in ALWAYS_HELD_TOOLS; the real sets pass", () => {
    const sets = { applied: [ENABLE, "mcp__kernel__kernel_probe"], held: [ENABLE] };
    // Checked whatever the contributed tools: no applier at all still refuses.
    expect(() => approvalApplierOf([], sets)).toThrow(InvalidContributionError);
    expect(() => approvalApplierOf([], sets)).toThrow(/mcp__kernel__kernel_probe is in KERNEL_APPLIED_ACTIONS but not in ALWAYS_HELD_TOOLS/);
    expect(() => approvalApplierOf([applying("kernel_playbook_enable").t], sets)).toThrow(InvalidContributionError);
    // Every member held: builds.
    expect(() => approvalApplierOf([applying("kernel_playbook_enable").t], { applied: [ENABLE], held: [ENABLE, "mcp__kernel__other"] })).not.toThrow();
    // The real, fixed sets (the default) pass.
    for (const tool of KERNEL_APPLIED_ACTIONS) expect(ALWAYS_HELD_TOOLS).toContain(tool);
    expect(() => approvalApplierOf([])).not.toThrow();
  });

  it("the shipped composition builds: its only applier is the enable's, a member of the set", () => {
    const tools = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;
    expect(tools.filter((t) => t.applyOnApproval !== undefined).map((t) => `${KERNEL_MCP_SERVER_NAME}:${t.name}`)).toEqual([`${KERNEL_MCP_SERVER_NAME}:kernel_playbook_enable`]);
    expect(() => approvalApplierOf(tools)).not.toThrow();
    expect(KERNEL_APPLIED_ACTIONS).toContain(ENABLE);
  });
});
