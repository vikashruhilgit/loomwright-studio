// The in-process SDK MCP server `kernel` (AC3, AC4): the brain's levers over
// tasks, wake-ups and its own stop. Generic mechanisms only (invariant 1): no
// task-state vocabulary, priority or policy is built in.
//
// Tool input is untrusted data (invariant 3): every handler validates its
// arguments with zod itself (also when called directly, without the SDK), and
// a validation or domain error comes back as an `isError` result, never as a
// throw through the SDK.
//
// Idempotency: `kernel_task_create`, `kernel_schedule_wakeup` and
// `kernel_request_stop` REQUIRE a caller-chosen `idempotency_key`;
// `kernel_task_update` takes one OPTIONALLY (without it the update runs
// directly, not as a work step); `kernel_task_list` and `kernel_task_get`
// take none (they only read). A call with a key runs through a work step keyed
// `<tool>:session-<sessionId>:<idempotency_key>`. The scope is the session
// row, which a resume keeps, so a repeat in the same session (also after a
// resume or a kernel restart) returns the first result, even when its other
// arguments differ. Another session reusing the same key is not deduplicated
// against this one.
//
// Contributed tools (`FeatureContribution.tools`, merged by `startKernel`) are
// built per launch beside the phase 1 six, with the same rules: arguments are
// validated with zod (`safeParse`) before the handler runs, and every failure
// is an `isError` result. `KERNEL_TOOL_NAMES` stays the phase 1 list;
// `kernelToolNames(contributed)` lists both.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance, SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { KERNEL_APPLIED_ACTIONS } from "../approvals/store.js";
import type { ApprovalApplier } from "../approvals/store.js";
import { InvalidContributionError, PHASE1_TOOL_NAMES } from "../features/contribution.js";
import type { ContributedTool, ContributedToolContext } from "../features/contribution.js";
import { appendEvent, clip, errorMessage, normalizeInstant } from "../loop/internal.js";
import type { EventRef } from "../loop/internal.js";
import { runStep, runStepAsync } from "../loop/steps.js";
import { MAX_WAKEUP_REASON, RESERVED_WAKEUP_REASON_PREFIXES, isReservedWakeupReason, scheduleWakeup } from "../loop/wakeups.js";
import type { SessionManager } from "../sessions/manager.js";
import { ALWAYS_HELD_TOOLS } from "../sessions/policy.js";
import type { HeldToolCheck } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { kernelVersion } from "../version.js";
import { handoffPath, renderHandoff, writeFileAtomic } from "./handoff.js";
import type { HandoffRef } from "./handoff.js";

export const KERNEL_MCP_SERVER_NAME = "kernel";

/** The phase 1 six: `PHASE1_TOOL_NAMES`, the one list `mergeContributions` reserves in the daemon and the CLI. */
export const KERNEL_TOOL_NAMES = PHASE1_TOOL_NAMES;

export type KernelToolName = (typeof KERNEL_TOOL_NAMES)[number];

/**
 * The names the SDK gives these tools (`mcp__kernel__<name>`): what a user's
 * `ToolPolicy.allowedTools` lists to let a session call them. The kernel never
 * adds them to a policy itself.
 */
export function kernelToolFullNames(contributed: readonly ContributedTool[] = []): string[] {
  return kernelToolNames(contributed).map((name) => `mcp__${KERNEL_MCP_SERVER_NAME}__${name}`);
}

/** The phase 1 tool names, then the contributed ones: what the server registers. */
export function kernelToolNames(contributed: readonly ContributedTool[] = []): string[] {
  return [...KERNEL_TOOL_NAMES, ...contributed.map((t) => t.name)];
}

/** The work-step key of a tool call (a phase 1 or a contributed tool): scoped to the session row. */
export function kernelStepKey(toolName: string, sessionId: number, idempotencyKey: string): string {
  return `${toolName}:session-${sessionId}:${idempotencyKey}`;
}

export interface KernelToolContext {
  readonly store: Store;
  /** `startSession` is optional: a contributed tool that needs it (a playbook's dry run) refuses without it. */
  readonly sessions: Pick<SessionManager, "stopSession" | "getSession"> & Partial<Pick<SessionManager, "startSession">>;
  /** The `sessions` row this server instance serves. */
  readonly sessionId: number;
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Runs the session stop out of band. Defaults to `setImmediate`. */
  readonly schedule?: (fn: () => void) => void;
}

export interface KernelToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export type KernelToolHandler = (args: unknown) => Promise<KernelToolResult>;

const MAX_SHORT = 200;
const MAX_TITLE = 500;
const MAX_LINK = 2_000;
const MAX_LINKS = 50;
const MAX_HANDOFF = 200_000;
const MAX_LIST = 200;
const DEFAULT_LIST = 50;

const id = z.number().int().positive();
const short = z.string().min(1).max(MAX_SHORT);
const instant = z.string().min(1).max(64);
const links = z.array(z.string().min(1).max(MAX_LINK)).max(MAX_LINKS);
const idempotencyKey = z.string().min(1).max(MAX_SHORT);

const shapes = {
  kernel_task_create: {
    title: z.string().min(1).max(MAX_TITLE),
    state: short,
    kind: short.optional(),
    assignee_agent: short.optional(),
    parent_task_id: id.optional(),
    links: links.optional(),
    dedupe_key: short.optional(),
    next_check_at: instant.optional(),
    idempotency_key: idempotencyKey,
  },
  kernel_task_update: {
    id,
    title: z.string().min(1).max(MAX_TITLE).optional(),
    state: short.optional(),
    kind: short.nullable().optional(),
    assignee_agent: short.nullable().optional(),
    links: links.nullable().optional(),
    dedupe_key: short.nullable().optional(),
    next_check_at: instant.nullable().optional(),
    idempotency_key: idempotencyKey.optional(),
  },
  kernel_task_list: {
    state: short.optional(),
    assignee_agent: short.optional(),
    parent_task_id: id.optional(),
    limit: z.number().int().min(1).max(MAX_LIST).optional(),
  },
  kernel_task_get: { id },
  kernel_schedule_wakeup: {
    at: instant,
    reason: z
      .string()
      .min(1)
      .max(MAX_WAKEUP_REASON)
      .refine((r) => !isReservedWakeupReason(r), {
        message: `may not start with ${RESERVED_WAKEUP_REASON_PREFIXES.join(" or ")} (reserved for the kernel's cap wake-ups)`,
      }),
    task_id: id.optional(),
    idempotency_key: idempotencyKey,
  },
  kernel_request_stop: {
    handoff: z.string().min(1).max(MAX_HANDOFF),
    idempotency_key: idempotencyKey,
  },
} as const;

const REPEAT = "Repeating a call with the same idempotency_key in this session returns the first result, even if other arguments differ.";

const descriptions: Record<KernelToolName, string> = {
  kernel_task_create: `Create a task row. state is free text you choose; the kernel defines no states. ${REPEAT}`,
  kernel_task_update: `Update the given fields of a task (null clears an optional field). With an idempotency_key: ${REPEAT}`,
  kernel_task_list: `List tasks in id order, filtered by state, assignee_agent or parent_task_id (limit 1-${MAX_LIST}, default ${DEFAULT_LIST}).`,
  kernel_task_get: "Get one task by id.",
  kernel_schedule_wakeup: `Schedule a wake-up at an ISO-8601 instant with a time zone (a past time fires on the next tick). The reason is free text, except that ${RESERVED_WAKEUP_REASON_PREFIXES.join(" and ")} are reserved for the kernel. ${REPEAT}`,
  kernel_request_stop: `End this session: the kernel writes your handoff note (markdown) to memory and then stops the session. ${REPEAT}`,
};

class KernelToolError extends Error {}

interface TaskRow {
  readonly id: number;
  readonly title: string;
  readonly kind: string | null;
  readonly state: string;
  readonly assignee_agent: string | null;
  readonly owner_session_id: number | null;
  readonly parent_task_id: number | null;
  readonly links_json: string | null;
  readonly dedupe_key: string | null;
  readonly next_check_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const TASK_COLUMNS =
  "id, title, kind, state, assignee_agent, owner_session_id, parent_task_id, links_json, dedupe_key, next_check_at, created_at, updated_at";

function taskView(row: TaskRow): Record<string, unknown> {
  const { links_json, ...rest } = row;
  return { ...rest, links: links_json === null ? null : (JSON.parse(links_json) as unknown) };
}

function readTask(store: Store, taskId: number): TaskRow | undefined {
  return store.prepare<[number], TaskRow>(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(taskId);
}

function ok(value: unknown): KernelToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fail(message: string): KernelToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function parseArgs<S extends z.ZodRawShape>(name: KernelToolName, shape: S, args: unknown): z.infer<z.ZodObject<S>> {
  const parsed = z.object(shape).safeParse(args);
  if (!parsed.success) throw new KernelToolError(`${name}: invalid input: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function instantOrThrow(field: string, value: string): string {
  const normalized = normalizeInstant(value);
  if (normalized === undefined) throw new KernelToolError(`${field} must be an ISO-8601 instant with a time zone`);
  return normalized;
}

/** Run `body`, turning every throw into an `isError` result. */
async function guarded(body: () => KernelToolResult | Promise<KernelToolResult>): Promise<KernelToolResult> {
  try {
    return await body();
  } catch (err) {
    return fail(errorMessage(err));
  }
}

/**
 * The six tool handlers as plain functions over untrusted `args`, so tests
 * (and the server) call them without a model. Each resolves to a result;
 * none rejects.
 */
export function kernelToolHandlers(ctx: KernelToolContext): Record<KernelToolName, KernelToolHandler> {
  const { store, sessions, sessionId } = ctx;
  const now = ctx.now ?? (() => new Date());
  const schedule = ctx.schedule ?? ((fn: () => void) => void setImmediate(fn));
  const iso = (): string => now().toISOString();

  function createTask(a: z.infer<z.ZodObject<(typeof shapes)["kernel_task_create"]>>): Record<string, unknown> {
    const nextCheckAt = a.next_check_at === undefined ? null : instantOrThrow("next_check_at", a.next_check_at);
    if (a.parent_task_id !== undefined && readTask(store, a.parent_task_id) === undefined) {
      throw new KernelToolError(`no parent task ${a.parent_task_id}`);
    }
    const at = iso();
    const taskId = Number(
      store
        .prepare(
          `INSERT INTO tasks (title, kind, state, assignee_agent, parent_task_id, links_json, dedupe_key, next_check_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          a.title,
          a.kind ?? null,
          a.state,
          a.assignee_agent ?? null,
          a.parent_task_id ?? null,
          a.links === undefined ? null : JSON.stringify(a.links),
          a.dedupe_key ?? null,
          nextCheckAt,
          at,
          at,
        ).lastInsertRowid,
    );
    appendEvent(store, "task_created", { sessionId, taskId }, { title: clip(a.title), state: a.state }, at);
    return taskView(readTask(store, taskId) as TaskRow);
  }

  function updateTask(a: z.infer<z.ZodObject<(typeof shapes)["kernel_task_update"]>>): Record<string, unknown> {
    // Column names come from this fixed list, never from the input.
    const sets: [string, unknown][] = [];
    if (a.title !== undefined) sets.push(["title", a.title]);
    if (a.state !== undefined) sets.push(["state", a.state]);
    if (a.kind !== undefined) sets.push(["kind", a.kind]);
    if (a.assignee_agent !== undefined) sets.push(["assignee_agent", a.assignee_agent]);
    if (a.links !== undefined) sets.push(["links_json", a.links === null ? null : JSON.stringify(a.links)]);
    if (a.dedupe_key !== undefined) sets.push(["dedupe_key", a.dedupe_key]);
    if (a.next_check_at !== undefined) {
      sets.push(["next_check_at", a.next_check_at === null ? null : instantOrThrow("next_check_at", a.next_check_at)]);
    }
    if (sets.length === 0) throw new KernelToolError("kernel_task_update: give at least one field to update");
    if (readTask(store, a.id) === undefined) throw new KernelToolError(`no task ${a.id}`);
    const at = iso();
    store
      .prepare(`UPDATE tasks SET ${sets.map(([c]) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...sets.map(([, v]) => v), at, a.id);
    const fields = sets.map(([c]) => (c === "links_json" ? "links" : c));
    appendEvent(store, "task_updated", { sessionId, taskId: a.id }, { fields, ...(a.state === undefined ? {} : { state: a.state }) }, at);
    return taskView(readTask(store, a.id) as TaskRow);
  }

  /** Schedule the session's stop out of band: awaiting it here would wait on this session's own exit. */
  function scheduleStop(ref: EventRef): void {
    schedule(() => {
      void Promise.resolve()
        .then(() => sessions.stopSession(sessionId))
        .catch((err: unknown) => {
          try {
            appendEvent(store, "stop_failed", ref, { error: clip(errorMessage(err)) }, iso());
          } catch {
            // The store is failing too; nothing more to record.
          }
        });
    });
  }

  return {
    kernel_task_create: (args) =>
      guarded(() => {
        const a = parseArgs("kernel_task_create", shapes.kernel_task_create, args);
        const key = kernelStepKey("kernel_task_create", sessionId, a.idempotency_key);
        return ok(runStep(store, key, () => createTask(a), { now }));
      }),

    kernel_task_update: (args) =>
      guarded(() => {
        const a = parseArgs("kernel_task_update", shapes.kernel_task_update, args);
        if (a.idempotency_key === undefined) return ok(store.transaction(() => updateTask(a)));
        const key = kernelStepKey("kernel_task_update", sessionId, a.idempotency_key);
        return ok(runStep(store, key, () => updateTask(a), { now }));
      }),

    kernel_task_list: (args) =>
      guarded(() => {
        const a = parseArgs("kernel_task_list", shapes.kernel_task_list, args ?? {});
        const where: string[] = [];
        const params: unknown[] = [];
        if (a.state !== undefined) {
          where.push("state = ?");
          params.push(a.state);
        }
        if (a.assignee_agent !== undefined) {
          where.push("assignee_agent = ?");
          params.push(a.assignee_agent);
        }
        if (a.parent_task_id !== undefined) {
          where.push("parent_task_id = ?");
          params.push(a.parent_task_id);
        }
        const rows = store
          .prepare<unknown[], TaskRow>(
            `SELECT ${TASK_COLUMNS} FROM tasks ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`} ORDER BY id LIMIT ?`,
          )
          .all(...params, a.limit ?? DEFAULT_LIST);
        return ok({ tasks: rows.map(taskView) });
      }),

    kernel_task_get: (args) =>
      guarded(() => {
        const a = parseArgs("kernel_task_get", shapes.kernel_task_get, args);
        const row = readTask(store, a.id);
        if (row === undefined) throw new KernelToolError(`no task ${a.id}`);
        return ok(taskView(row));
      }),

    kernel_schedule_wakeup: (args) =>
      guarded(() => {
        const a = parseArgs("kernel_schedule_wakeup", shapes.kernel_schedule_wakeup, args);
        const key = kernelStepKey("kernel_schedule_wakeup", sessionId, a.idempotency_key);
        const scheduled = runStep(
          store,
          key,
          () => scheduleWakeup(store, { at: a.at, reason: a.reason, taskId: a.task_id ?? null, sessionId }, now()),
          { now },
        );
        return ok(scheduled);
      }),

    kernel_request_stop: (args) =>
      guarded(async () => {
        const a = parseArgs("kernel_request_stop", shapes.kernel_request_stop, args);
        const session = sessions.getSession(sessionId);
        if (session === undefined) throw new KernelToolError(`no session ${sessionId}`);
        const ref: HandoffRef = { agent: session.agent, taskId: session.task_id, sessionId };
        // Resolved before the step, so a refused agent id never burns the key.
        const path = handoffPath(store.dataDir, ref);
        const eventRef: EventRef = { sessionId, taskId: session.task_id };
        const key = kernelStepKey("kernel_request_stop", sessionId, a.idempotency_key);
        // Re-runnable: rewriting the same note and re-checking the event is idempotent.
        const result = await runStepAsync(
          store,
          key,
          async () => {
            writeFileAtomic(path, renderHandoff(ref, iso(), a.handoff));
            // Deduped on this step's key, so only a crash re-run of the same
            // step is suppressed; every other request_stop call is recorded.
            store.transaction(() => {
              const recorded = store
                .prepare<[number, string], number>(
                  "SELECT 1 FROM events WHERE kind = 'stop_requested' AND session_id = ? AND json_extract(payload_json, '$.step') = ?",
                )
                .pluck()
                .get(sessionId, key);
              if (recorded === undefined) appendEvent(store, "stop_requested", eventRef, { path, step: key }, iso());
            });
            return { path, stopping: true };
          },
          { rerunnable: true, now },
        );
        // Every call stops (stopSession is idempotent): a repeat means the session is still running.
        scheduleStop(eventRef);
        return ok(result);
      }),
  };
}

/**
 * What a contributed tool's handler (and its `beforeHold`) receives: the
 * session manager as `ctx.sessions` (its `startSession` included when the
 * composition has one), and the step key scoped to the tool and session.
 */
function contributedToolContext(contributed: ContributedTool, ctx: KernelToolContext): ContributedToolContext {
  const { store, sessions, sessionId } = ctx;
  return {
    store,
    sessions,
    sessionId,
    now: ctx.now ?? (() => new Date()),
    stepKey: (key) => kernelStepKey(contributed.name, sessionId, key),
  };
}

/**
 * The gate's pre-hold check (`SessionManagerOptions.heldToolCheck`) over the
 * contributed tools that declare a `beforeHold`, keyed by their full SDK name
 * (`mcp__kernel__<name>`). For one of them, the input is parsed with the
 * tool's own zod shape first (a failure is a refusal naming the tool, as its
 * handler would answer), then `beforeHold` runs with the same context its
 * handler gets, `contextOf(sessionId)` (built at call time, so a composition
 * can pass its session manager before it exists). Any other tool: `undefined`
 * (held as before). A throw propagates: the gate denies `kernel_gate_error`.
 */
export function heldToolCheckOf(contributed: readonly ContributedTool[], contextOf: (sessionId: number) => KernelToolContext): HeldToolCheck {
  const checked = new Map<string, ContributedTool>();
  for (const t of contributed) if (t.beforeHold !== undefined) checked.set(`mcp__${KERNEL_MCP_SERVER_NAME}__${t.name}`, t);
  return (toolName, input, sessionId) => {
    const t = checked.get(toolName);
    if (t?.beforeHold === undefined) return undefined;
    const parsed = z.object(t.shape).safeParse(input ?? {});
    if (!parsed.success) return { refuse: `${t.name}: invalid input: ${z.prettifyError(parsed.error)}` };
    return t.beforeHold(parsed.data, contributedToolContext(t, contextOf(sessionId)));
  };
}

/**
 * The approvals decision's applier (`decideApproval`) over the contributed
 * tools that declare an `applyOnApproval`, keyed by their full SDK name
 * (`mcp__kernel__<name>`). Built once at composition: a tool that declares
 * one but whose full name is not in `KERNEL_APPLIED_ACTIONS` throws
 * `InvalidContributionError`, so a composition that breaks the closed set
 * never starts. So does a member of `KERNEL_APPLIED_ACTIONS` that is not in
 * `ALWAYS_HELD_TOOLS` (checked first, whatever the contributed tools): a
 * standing `always` grant is excluded only for an always-held tool, so a
 * kernel-applied action outside that set could be approved once for every
 * later call (invariant 3). `sets` exists for the tests; the kernel passes
 * nothing and gets the real, fixed sets. The returned function answers
 * `undefined` for a tool with no applier; else it parses the held input with the tool's own zod shape (a
 * failure is `{refused: "invalid_input"}`, nothing run) and calls
 * `applyOnApproval` with the store, the decision's instant and the approval.
 * A throw propagates: the decision records it as `apply_error`.
 */
export function approvalApplierOf(
  contributed: readonly ContributedTool[],
  sets: { readonly applied: readonly string[]; readonly held: readonly string[] } = { applied: KERNEL_APPLIED_ACTIONS, held: ALWAYS_HELD_TOOLS },
): ApprovalApplier {
  for (const action of sets.applied) {
    if (!sets.held.includes(action)) {
      throw new InvalidContributionError(action, "tool", `${action} is in KERNEL_APPLIED_ACTIONS but not in ALWAYS_HELD_TOOLS, so an "always" grant could reach it`);
    }
  }
  const appliers = new Map<string, ContributedTool>();
  for (const t of contributed) {
    if (t.applyOnApproval === undefined) continue;
    const full = `mcp__${KERNEL_MCP_SERVER_NAME}__${t.name}`;
    if (!sets.applied.includes(full)) {
      throw new InvalidContributionError(t.name, "tool", `${t.name} declares applyOnApproval, but ${full} is not in KERNEL_APPLIED_ACTIONS`);
    }
    appliers.set(full, t);
  }
  return (tool, input, approval, store, now) => {
    const t = appliers.get(tool);
    if (t?.applyOnApproval === undefined) return undefined;
    const parsed = z.object(t.shape).safeParse(input ?? {});
    if (!parsed.success) return { refused: "invalid_input", text: `${t.name}: the held input is not valid: ${z.prettifyError(parsed.error)}` };
    return t.applyOnApproval(parsed.data, { store, now: () => now, approval });
  };
}

/**
 * A contributed tool's handler over untrusted `args`. The arguments are
 * `safeParse`d before the guard around the handler, so invalid input is an
 * `isError` result without the handler running; the handler's value is the
 * JSON result (`undefined` ⇒ `null`) and its throw, or a value that is not
 * JSON, an `isError` result.
 * Never rejects.
 */
export function contributedToolHandler(contributed: ContributedTool, ctx: KernelToolContext): KernelToolHandler {
  const toolCtx = contributedToolContext(contributed, ctx);
  const schema = z.object(contributed.shape);
  return async (args) => {
    const parsed = schema.safeParse(args ?? {});
    if (!parsed.success) return fail(`${contributed.name}: invalid input: ${z.prettifyError(parsed.error)}`);
    return guarded(async () => {
      const value = (await contributed.handler(parsed.data, toolCtx)) ?? null;
      // JSON text, as promised: a value JSON.stringify drops (a function, a symbol) is an error, never `text: undefined`.
      if ((JSON.stringify(value) as string | undefined) === undefined) throw new Error(`${contributed.name}: the result is not JSON`);
      return ok(value);
    });
  };
}

/** The SDK tool definitions: the phase 1 six delegating to `kernelToolHandlers(ctx)`, then each contributed tool. */
export function kernelToolDefinitions(ctx: KernelToolContext, contributed: readonly ContributedTool[] = []): SdkMcpToolDefinition<z.ZodRawShape>[] {
  const handlers = kernelToolHandlers(ctx);
  return [
    ...KERNEL_TOOL_NAMES.map((name) => tool(name, descriptions[name], shapes[name] as z.ZodRawShape, (args) => handlers[name](args))),
    ...contributed.map((t) => {
      const handler = contributedToolHandler(t, ctx);
      return tool(t.name, t.description, t.shape, (args) => handler(args));
    }),
  ];
}

/**
 * A fresh `kernel` server for one session (one `query()` launch): the SDK's
 * server instance holds a live MCP connection and cannot be reused, so the
 * session manager's `mcpServers` factory calls this once per launch attempt.
 * `contributed` (the merged contributions' tools, default none) are
 * registered after the phase 1 six.
 */
export function createKernelMcpServer(ctx: KernelToolContext, contributed: readonly ContributedTool[] = []): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: KERNEL_MCP_SERVER_NAME, version: kernelVersion(), tools: kernelToolDefinitions(ctx, contributed) });
}

const LISTING_ONLY = "tool listing only";

function listingOnly(): never {
  throw new Error(LISTING_ONLY);
}

/**
 * The context `listKernelTools` builds the server with. The tool definitions
 * read `store`, `sessions` and `sessionId` eagerly (`kernelToolHandlers`,
 * `contributedToolContext`), so reading a member succeeds; using one (any
 * property of `store`, either `sessions` method) throws. `now` and `schedule`
 * are absent: their defaults are lazy closures.
 */
// A stand-in, not a real Store or SessionManager: the cast is safe because listing never calls a handler.
export const LISTING_CTX = {
  store: new Proxy({}, { get: listingOnly }),
  sessions: { stopSession: listingOnly, getSession: listingOnly },
  sessionId: 0,
} as unknown as KernelToolContext;

/** The first line of a thrown value's message. */
function firstLine(err: unknown): string {
  return errorMessage(err).split("\n", 1)[0] ?? "";
}

/**
 * The tools a session would be offered: the `kernel` server for `contributed`
 * (built over `LISTING_CTX`), listed through the Agent SDK's own MCP server
 * by a real MCP client over an in-memory transport, as `tools/list` would be.
 * Rejects when the listing does: one tool whose shape the SDK cannot
 * serialise fails the whole list.
 */
export async function listKernelTools(contributed: readonly ContributedTool[]): Promise<{ name: string; inputSchema: unknown }[]> {
  const { instance } = createKernelMcpServer(LISTING_CTX, contributed);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "kernel-self-check", version: kernelVersion() });
  try {
    await instance.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema }));
  } finally {
    // Closing an in-memory pair has nothing to report; never mask the listing's own error.
    await Promise.allSettled([client.close(), instance.close()]);
  }
}

/**
 * The start-time self-check (`startKernel`, before the store opens): list
 * `contributed` with the phase 1 six as a session would get them. On a
 * failure, each contributed tool is listed alone to name the ones that fail
 * (all of them when none fails alone: the combination does), and the check
 * throws `InvalidContributionError` naming them with the listing error's
 * first line. A listing that succeeds but omits a tool throws
 * `InvalidContributionError` too, naming the missing ones with its own
 * reason. `list` is `listKernelTools` (`startKernel` passes nothing); a test
 * injects a stub to reach the combination and omission branches.
 */
export async function assertKernelToolsList(
  contributed: readonly ContributedTool[],
  list: (contributed: readonly ContributedTool[]) => Promise<readonly { name: string }[]> = listKernelTools,
): Promise<void> {
  const refuse = (names: readonly string[], reason: string): never => {
    throw new InvalidContributionError(names.join(", "), "tool", reason);
  };
  const unserialisable = (detail: string): string =>
    `its input schema does not serialise through the Agent SDK, so tools/list would offer sessions no kernel tool: ${detail}`;
  let listed: readonly { name: string }[];
  try {
    listed = await list(contributed);
  } catch (err) {
    const failing: string[] = [];
    for (const t of contributed) {
      try {
        await list([t]);
      } catch {
        failing.push(t.name);
      }
    }
    if (failing.length > 0) return refuse(failing, unserialisable(firstLine(err)));
    return refuse(
      contributed.map((t) => t.name),
      unserialisable(`no tool fails alone, the combination fails: ${firstLine(err)}`),
    );
  }
  const names = new Set(listed.map((t) => t.name));
  const missing = kernelToolNames(contributed).filter((name) => !names.has(name));
  if (missing.length > 0) {
    refuse(missing, `tools/list succeeded but omitted ${missing.join(", ")}, so sessions would not be offered them`);
  }
}
