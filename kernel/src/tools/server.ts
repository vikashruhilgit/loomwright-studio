// The in-process SDK MCP server `kernel` (AC3, AC4): the brain's levers over
// tasks, wake-ups and its own stop. Generic mechanisms only (invariant 1): no
// task-state vocabulary, priority or policy is built in.
//
// Tool input is untrusted data (invariant 3): every handler validates its
// arguments with zod itself (also when called directly, without the SDK), and
// a validation or domain error comes back as an `isError` result, never as a
// throw through the SDK.
//
// Idempotency: a tool that creates something takes a caller-chosen
// `idempotency_key` and runs through a work step keyed
// `<tool>:session-<sessionId>:<idempotency_key>`. The scope is the session
// row, which a resume keeps, so a repeat in the same session (also after a
// resume or a kernel restart) returns the first result, even when its other
// arguments differ. Another session reusing the same key is not deduplicated
// against this one.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance, SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { appendEvent, clip, errorMessage, normalizeInstant } from "../loop/internal.js";
import type { EventRef } from "../loop/internal.js";
import { runStep, runStepAsync } from "../loop/steps.js";
import { MAX_WAKEUP_REASON, RESERVED_WAKEUP_REASON_PREFIXES, isReservedWakeupReason, scheduleWakeup } from "../loop/wakeups.js";
import type { SessionManager } from "../sessions/manager.js";
import type { Store } from "../store/store.js";
import { kernelVersion } from "../version.js";
import { handoffPath, renderHandoff, writeFileAtomic } from "./handoff.js";
import type { HandoffRef } from "./handoff.js";

export const KERNEL_MCP_SERVER_NAME = "kernel";

export const KERNEL_TOOL_NAMES = [
  "kernel_task_create",
  "kernel_task_update",
  "kernel_task_list",
  "kernel_task_get",
  "kernel_schedule_wakeup",
  "kernel_request_stop",
] as const;

export type KernelToolName = (typeof KERNEL_TOOL_NAMES)[number];

/**
 * The names the SDK gives these tools (`mcp__kernel__<name>`): what a user's
 * `ToolPolicy.allowedTools` lists to let a session call them. The kernel never
 * adds them to a policy itself.
 */
export function kernelToolFullNames(): string[] {
  return KERNEL_TOOL_NAMES.map((name) => `mcp__${KERNEL_MCP_SERVER_NAME}__${name}`);
}

/** The work-step key of a tool call: scoped to the session row. */
export function kernelStepKey(toolName: KernelToolName, sessionId: number, idempotencyKey: string): string {
  return `${toolName}:session-${sessionId}:${idempotencyKey}`;
}

export interface KernelToolContext {
  readonly store: Store;
  readonly sessions: Pick<SessionManager, "stopSession" | "getSession">;
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

/** The SDK tool definitions, each delegating to `kernelToolHandlers(ctx)`. */
export function kernelToolDefinitions(ctx: KernelToolContext): SdkMcpToolDefinition<z.ZodRawShape>[] {
  const handlers = kernelToolHandlers(ctx);
  return KERNEL_TOOL_NAMES.map((name) =>
    tool(name, descriptions[name], shapes[name] as z.ZodRawShape, (args) => handlers[name](args)),
  );
}

/**
 * A fresh `kernel` server for one session (one `query()` launch): the SDK's
 * server instance holds a live MCP connection and cannot be reused, so the
 * session manager's `mcpServers` factory calls this once per launch attempt.
 */
export function createKernelMcpServer(ctx: KernelToolContext): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: KERNEL_MCP_SERVER_NAME, version: kernelVersion(), tools: kernelToolDefinitions(ctx) });
}
