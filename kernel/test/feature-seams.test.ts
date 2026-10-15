// The phase 2 feature seams (AC3-AC6, AC9): one `FeatureContribution` per
// feature, merged by `startKernel` and `runCli`. Of the shipped contributions
// only triggers adds parts (pinned in triggers.test.ts), and every assertion
// here names only what the others add (nothing); a test contribution composed from outside reaches every part
// through the normal path (the kernel MCP server, the loopback API, `studio`,
// the event loop). A temp data dir, an in-memory Keychain, the fake
// spawner/query and stub auth: never the real SDK, a model or the Keychain.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { API_TOKEN_KEYCHAIN_SERVICE } from "../src/api/index.js";
import { MAX_CONTRIBUTED_BODY_BYTES, PHASE1_ROUTES } from "../src/api/server.js";
import { KeychainError } from "../src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../src/auth/index.js";
import { USAGE, runCli, usageText } from "../src/cli/index.js";
import type { CliDeps } from "../src/cli/index.js";
import {
  ContributionConflictError,
  InvalidContributionError,
  PHASE1_SUBCOMMANDS,
  SHIPPED_CONTRIBUTIONS,
  UnknownEventKindError,
  defineTool,
  mergeContributions,
} from "../src/features/index.js";
import type { ContributedRoute, ContributedSubcommand, FeatureContribution } from "../src/features/index.js";
import { startKernel } from "../src/kernel.js";
import type { Kernel, KernelDeps, KernelOptions } from "../src/kernel.js";
import { EventLoop } from "../src/loop/loop.js";
import { enqueueMessage, getQueueRow } from "../src/loop/queue.js";
import { scheduleWakeup } from "../src/loop/wakeups.js";
import { Store } from "../src/store/index.js";
import { KERNEL_TOOL_NAMES, contributedToolHandler, kernelToolNames } from "../src/tools/server.js";
import type { KernelToolResult } from "../src/tools/server.js";
import { buildKernel } from "./crash-helpers.js";
import { startApiServer } from "../src/api/server.js";
import type { ContributedRouteRequest } from "../src/features/index.js";
import { unexpectedAbandon } from "./session-fakes.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, startParams, stubProvider } from "./session-fakes.js";

const PHASE1 = { tools: KERNEL_TOOL_NAMES, routes: PHASE1_ROUTES, subcommands: PHASE1_SUBCOMMANDS };

/** The error `fn` throws (a test failure when it throws none). */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected a throw");
}

function conflict(fn: () => unknown): ContributionConflictError {
  const err = thrown(fn);
  expect(err).toBeInstanceOf(ContributionConflictError);
  return err as ContributionConflictError;
}

const noopRoute = (method: ContributedRoute["method"], path: string): ContributedRoute => ({
  method,
  path,
  handler: async () => ({ status: 200, body: {} }),
});

const noopSubcommand = (name: string): ContributedSubcommand => ({ name, help: `studio ${name}`, run: async () => 0 });

const noopTool = (name: string) => defineTool({ name, description: "test tool", shape: {}, handler: () => ({}) });

describe("mergeContributions", () => {
  it("the shipped contributions: the five features in a fixed order; only triggers registers parts (pinned in triggers.test.ts) (AC3)", () => {
    expect(SHIPPED_CONTRIBUTIONS.map((c) => c.name)).toEqual(["loomwright", "notifications", "triggers", "approvals", "brain"]);
    const merged = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1);
    expect(merged.contributors).toEqual(["loomwright", "notifications", "triggers", "approvals", "brain"]);
    expect(merged.tools.filter((t) => !t.name.startsWith("kernel_trigger_"))).toEqual([]);
    expect(merged.routes.filter((r) => r.owner !== "triggers")).toEqual([]);
    expect(merged.subcommands.filter((s) => s.name !== "triggers")).toEqual([]);
    expect(merged.handlers).toEqual({});
    expect(merged.dueWork.filter((d) => d.owner !== "triggers")).toEqual([]);
    for (const c of SHIPPED_CONTRIBUTIONS.filter((s) => s.name !== "triggers")) expect(Object.keys(c)).toEqual(["name"]);
  });

  it("a contributed tool whose name does not start with kernel_ is refused", () => {
    const err = thrown(() => mergeContributions([{ name: "probe", tools: [noopTool("task_create")] }], PHASE1));
    expect(err).toBeInstanceOf(InvalidContributionError);
    expect((err as InvalidContributionError).contributor).toBe("probe");
    expect((err as Error).message).toMatch(/must start with kernel_/);
  });

  it("a duplicate tool, route, subcommand or handler between two contributions is refused, naming both owners", () => {
    const pairs: [FeatureContribution, FeatureContribution, string, string][] = [
      [{ name: "alpha", tools: [noopTool("kernel_probe")] }, { name: "beta", tools: [noopTool("kernel_probe")] }, "tool", "kernel_probe"],
      [{ name: "alpha", routes: [noopRoute("GET", "/probe")] }, { name: "beta", routes: [noopRoute("GET", "/probe")] }, "route", "GET /probe"],
      [{ name: "alpha", subcommands: [noopSubcommand("probe")] }, { name: "beta", subcommands: [noopSubcommand("probe")] }, "subcommand", "probe"],
      [{ name: "alpha", handlers: { message: () => {} } }, { name: "beta", handlers: { message: () => {} } }, "handler", "message"],
      [{ name: "alpha" }, { name: "alpha" }, "contribution", "alpha"],
    ];
    for (const [a, b, part, name] of pairs) {
      const err = conflict(() => mergeContributions([a, b], PHASE1));
      expect(err.code).toBe("contribution_conflict");
      expect(err.part).toBe(part);
      expect(err.conflictName).toBe(name);
      expect(err.owners).toEqual(["alpha", a.name === b.name ? "alpha" : "beta"]);
      expect(err.message).toContain("alpha");
    }
  });

  it("an overlapping route pattern with the same method is a duplicate; another method on the same path is not", () => {
    const err = conflict(() =>
      mergeContributions([{ name: "alpha", routes: [noopRoute("GET", "/items/:id")] }, { name: "beta", routes: [noopRoute("GET", "/items/latest")] }]),
    );
    expect(err.owners).toEqual(["alpha", "beta"]);
    const merged = mergeContributions([{ name: "alpha", routes: [noopRoute("GET", "/items/:id")] }, { name: "beta", routes: [noopRoute("POST", "/items/:id")] }]);
    expect(merged.routes.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /items/:id", "POST /items/:id"]);
  });

  it("a contribution colliding with a phase 1 tool, route or subcommand names phase1; with an options.handlers kind names options.handlers", () => {
    expect(conflict(() => mergeContributions([{ name: "probe", tools: [noopTool("kernel_task_create")] }], PHASE1)).owners).toEqual(["phase1", "probe"]);
    // A phase 1 path is refused whatever the method: phase 1 routes match first and would shadow it.
    expect(conflict(() => mergeContributions([{ name: "probe", routes: [noopRoute("GET", "/stop-all")] }], PHASE1)).owners).toEqual(["phase1", "probe"]);
    expect(conflict(() => mergeContributions([{ name: "probe", routes: [noopRoute("POST", "/sessions/:sid/abandon")] }], PHASE1)).owners).toEqual([
      "phase1",
      "probe",
    ]);
    for (const word of ["status", "stop", "resume", "session", "service"]) {
      expect(conflict(() => mergeContributions([{ name: "probe", subcommands: [noopSubcommand(word)] }], PHASE1)).owners).toEqual(["phase1", "probe"]);
    }
    const err = conflict(() => mergeContributions([{ name: "probe", handlers: { wakeup: () => {} } }], { ...PHASE1, handlerKinds: ["wakeup"] }));
    expect(err.part).toBe("handler");
    expect(err.owners).toEqual(["options.handlers", "probe"]);
    expect(err.message).toContain("options.handlers");
  });

  it("every phase 1 subcommand word is a studio command in USAGE", () => {
    for (const word of PHASE1_SUBCOMMANDS) expect(USAGE).toContain(`studio ${word}`);
  });

  it("a handler for a kind outside EVENT_KINDS is refused at composition, naming the contributor and the kind", () => {
    const err = thrown(() => mergeContributions([{ name: "probe", handlers: { webhook: () => {} } }], PHASE1));
    expect(err).toBeInstanceOf(UnknownEventKindError);
    expect((err as UnknownEventKindError).contributor).toBe("probe");
    expect((err as UnknownEventKindError).kind).toBe("webhook");
    expect((err as Error).message).toContain("probe");
  });

  it("refuses a malformed route path or subcommand help", () => {
    expect(thrown(() => mergeContributions([{ name: "probe", routes: [noopRoute("GET", "items")] }]))).toBeInstanceOf(InvalidContributionError);
    expect(thrown(() => mergeContributions([{ name: "probe", routes: [noopRoute("GET", "/a/:id/:id")] }]))).toBeInstanceOf(InvalidContributionError);
    expect(thrown(() => mergeContributions([{ name: "probe", routes: [noopRoute("HEAD" as "GET", "/items")] }]))).toBeInstanceOf(InvalidContributionError);
    const twoLines: ContributedSubcommand = { name: "probe", help: "one\ntwo", run: async () => 0 };
    expect(thrown(() => mergeContributions([{ name: "probe", subcommands: [twoLines] }]))).toBeInstanceOf(InvalidContributionError);
    expect(thrown(() => mergeContributions([{ name: "probe", dueWork: ["nope" as unknown as () => void] }]))).toBeInstanceOf(InvalidContributionError);
  });

  it("refuses a tool shape that is not a zod raw shape at composition, before any session launch", () => {
    const shaped = (shape: unknown) => defineTool({ name: "kernel_probe", description: "test tool", shape: shape as z.ZodRawShape, handler: () => ({}) });
    for (const shape of [{ a: "not-zod" }, { a: z.string(), b: 1 }, z.object({ a: z.string() }), [z.string()], null, "shape"]) {
      const err = thrown(() => mergeContributions([{ name: "probe", tools: [shaped(shape)] }], PHASE1));
      expect(err).toBeInstanceOf(InvalidContributionError);
      expect((err as InvalidContributionError).part).toBe("tool");
      expect((err as Error).message).toContain("kernel_probe");
    }
    // A zod raw shape (empty, or every value a schema) is accepted.
    expect(mergeContributions([{ name: "probe", tools: [shaped({}), noopTool("kernel_other")] }], PHASE1).tools).toHaveLength(2);
    expect(mergeContributions([{ name: "probe", tools: [shaped({ a: z.string(), b: z.number().optional() })] }], PHASE1).tools).toHaveLength(1);
  });

  it("refuses a part list that is not a list, or handlers that are not an object, as InvalidContributionError (never a TypeError)", () => {
    for (const bad of [{ tools: {} }, { routes: "GET /x" }, { subcommands: 1 }, { dueWork: () => {} }, { handlers: [] }, { handlers: "message" }]) {
      expect(thrown(() => mergeContributions([{ name: "probe", ...bad } as unknown as FeatureContribution], PHASE1))).toBeInstanceOf(InvalidContributionError);
    }
  });

  it("refuses a malformed contribution name, and phase1 as one (it names phase 1's own registrations)", () => {
    expect(thrown(() => mergeContributions([{ name: "Not Valid" }]))).toBeInstanceOf(InvalidContributionError);
    expect(conflict(() => mergeContributions([{ name: "phase1" }])).owners).toEqual(["phase1", "phase1"]);
  });
});

describe("due work in the event loop (AC6)", () => {
  let env: LoopEnv;

  beforeEach(() => {
    env = loopEnv();
  });

  afterEach(() => {
    env.cleanup();
  });

  it("runs once per tick, after due wake-ups fire and before the queue is processed", async () => {
    scheduleWakeup(env.store, { at: "2026-10-02T09:00:00.000Z", reason: "due" }, env.now());
    enqueueMessage(env.store, { text: "hello" });
    const order: string[] = [];
    const loop = new EventLoop(
      {
        store: env.store,
        handlers: { message: () => void order.push("message"), wakeup: () => void order.push("wakeup") },
        dueWork: [
          {
            owner: "probe",
            run: ({ store, now }) => {
              const queued = count(store, "SELECT count(*) FROM event_queue WHERE kind = 'wakeup'");
              const handled = count(store, "SELECT count(*) FROM event_queue WHERE status = 'done'");
              order.push(`due(queued wakeups ${queued}, done ${handled}, at ${now().toISOString()})`);
            },
          },
        ],
      },
      { now: env.now },
    );
    await loop.tick();
    // The message was queued first (the lower id), the wake-up's row by this tick.
    expect(order).toEqual(["due(queued wakeups 1, done 0, at 2026-10-02T10:00:00.000Z)", "message", "wakeup"]);
    await loop.tick();
    expect(order.filter((o) => o.startsWith("due"))).toHaveLength(2);
  });

  it("a throwing due-work function: the tick still processes the queue, and exactly one due_work_failed row names the contributor", async () => {
    const { id } = enqueueMessage(env.store, { text: "hello" });
    const later: string[] = [];
    const loop = new EventLoop(
      {
        store: env.store,
        handlers: { message: () => {} },
        dueWork: [
          {
            owner: "broken",
            run: () => {
              throw new Error("due work exploded");
            },
          },
          { owner: "async-broken", run: async () => Promise.reject(new Error("x".repeat(3_000))) },
          { owner: "fine", run: () => void later.push("fine") },
        ],
      },
      { now: env.now },
    );
    const result = await loop.tick();
    expect(result.done).toBe(1);
    expect(getQueueRow(env.store, id)?.status).toBe("done");
    expect(later).toEqual(["fine"]);
    const failed = events(env.store, "due_work_failed");
    expect(failed).toHaveLength(2);
    expect(failed[0]).toMatchObject({ actor: "kernel", payload: { contributor: "broken", error: "due work exploded" } });
    expect(failed[1]?.payload.contributor).toBe("async-broken");
    // Clipped like every loop error text.
    expect((failed[1]?.payload.error as string).length).toBe(2_001);
  });
});

// ---- The composed kernel ----------------------------------------------------

let tmp: string;
let dataDir: string;
let pluginDir: string;
const kernels: Kernel[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-seams-"));
  dataDir = join(tmp, "data");
  pluginDir = makePluginDir(tmp);
});

afterEach(async () => {
  for (const k of kernels.splice(0)) await k.stop();
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

function memoryKeychain() {
  const items = new Map<string, string>();
  const reads: string[] = [];
  const reader: KeychainReader = {
    read: (service) => {
      reads.push(service);
      return items.get(service);
    },
  };
  const writer: KeychainWriter = {
    add(service, _account, secret) {
      if (items.has(service)) throw new KeychainError(service, 45, null, "write");
      items.set(service, secret);
    },
  };
  return { items, reads, reader, writer };
}

function options(overrides: Partial<KernelOptions> = {}): KernelOptions {
  return { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: pluginDir, stopGraceMs: 10 }, ...overrides };
}

function deps(overrides: Partial<KernelDeps> = {}) {
  const keychain = memoryKeychain();
  const fakes = fakeSessions();
  const d: KernelDeps = {
    keychain: keychain.reader,
    keychainWriter: keychain.writer,
    sessionDeps: fakes.deps,
    selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
    availableProviderIds: async () => ["api-key"],
    ...overrides,
  };
  return { d, keychain, fakes };
}

async function start(o: KernelOptions, d: KernelDeps): Promise<Kernel> {
  const kernel = await startKernel(o, d);
  kernels.push(kernel);
  return kernel;
}

/** A contributed tool whose handler throws, built for `kernel`'s store as the server would (no SDK launch needed). */
async function launchedToolsHandlerThrow(kernel: Kernel): Promise<KernelToolResult> {
  const failing = defineTool({
    name: "kernel_probe_fail",
    description: "Always fails.",
    shape: {},
    handler: () => {
      throw new Error("probe handler failed");
    },
  });
  return contributedToolHandler(failing, { store: kernel.store, sessions: kernel.sessions, sessionId: 1 })({});
}

interface RegisteredTool {
  handler(args: unknown, extra: unknown): Promise<KernelToolResult>;
}

/** The tools registered on the kernel MCP server of the kernel's first session launch. */
async function launchedTools(kernel: Kernel, fakes: ReturnType<typeof fakeSessions>): Promise<Record<string, RegisteredTool>> {
  await kernel.sessions.startSession(startParams(tmp));
  await vi.waitFor(() => expect(fakes.calls).toHaveLength(1));
  const server = (fakes.calls[0]?.options.mcpServers as Record<string, { instance: unknown }> | undefined)?.kernel;
  return (server?.instance as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

function testContribution(seen: { bodies: unknown[]; messages: unknown[]; dueRuns: number }): FeatureContribution {
  return {
    name: "probe",
    tools: [
      defineTool({
        name: "kernel_probe_echo",
        description: "Echo the text with this call's step key.",
        shape: { text: z.string().min(1), idempotency_key: z.string().min(1) },
        handler: (args, ctx) => ({ text: args.text, step: ctx.stepKey(args.idempotency_key), session: ctx.sessionId }),
      }),
    ],
    routes: [
      {
        method: "GET",
        path: "/probe/items/:id",
        handler: async (req) => ({ status: 200, body: { params: { ...req.params }, query: { ...req.query }, body: req.body ?? null } }),
      },
      {
        method: "GET",
        path: "/probe/text",
        handler: async () => ({ status: 200, body: "hello" }),
      },
      {
        method: "GET",
        path: "/probe/unserializable",
        handler: async () => ({ status: 200, body: () => "not JSON" }),
      },
      {
        method: "GET",
        path: "/probe/status",
        handler: async (req) => ({ status: Number(req.query.code), body: { answered: req.query.code } }),
      },
      {
        method: "GET",
        path: "/probe/broken",
        handler: async () => {
          throw new Error("secret detail");
        },
      },
      {
        method: "POST",
        path: "/probe/items",
        handler: async (req) => {
          seen.bodies.push(req.body);
          return { status: 201, body: { received: req.body } };
        },
      },
    ],
    subcommands: [
      {
        name: "probe",
        help: "studio probe <id>",
        run: async (args, client, out) => {
          if (args[0] === "--throw") throw new Error("first line\nsecond line");
          if (args[0] === "--code") return Number(args[1]);
          if (args[0] === "--path") return (await client.request("GET", args[1] ?? "")).status;
          if (args[0] === "--offline") {
            out.stdout.write("offline\n");
            return 0;
          }
          const answer = await client.request("GET", `/probe/items/${args[0] ?? "0"}`);
          out.stdout.write(`${answer.status} ${JSON.stringify(answer.body)}\n`);
          return answer.status === 200 ? 0 : 1;
        },
      },
    ],
    handlers: { message: (ctx) => void seen.messages.push(ctx.event.payload) },
    dueWork: [
      () => {
        seen.dueRuns++;
      },
    ],
  };
}

function out() {
  const chunks: string[] = [];
  return { write: (c: string) => chunks.push(c), text: () => chunks.join("") };
}

describe("the shipped kernel (AC3)", () => {
  it("registers no kernel tool, API route, CLI subcommand, event handler or due work beyond phase 1's and the triggers feature's own", async () => {
    const store = new Store({ dataDir });
    const { id } = enqueueMessage(store, { text: "hello" });
    store.close();
    const { d, fakes, keychain } = deps();
    const kernel = await start(options(), d);

    expect(kernel.contributions.contributors).toEqual(["loomwright", "notifications", "triggers", "approvals", "brain"]);
    expect(kernelToolNames(kernel.contributions.tools).filter((n) => !n.startsWith("kernel_trigger_"))).toEqual([...KERNEL_TOOL_NAMES]);
    expect(Object.keys(await launchedTools(kernel, fakes)).filter((n) => !n.startsWith("kernel_trigger_"))).toEqual([...KERNEL_TOOL_NAMES]);
    expect(kernel.contributions.routes.filter((r) => r.owner !== "triggers")).toEqual([]);
    expect(kernel.contributions.subcommands.filter((s) => s.name !== "triggers")).toEqual([]);
    expect(kernel.contributions.handlers).toEqual({});
    expect(kernel.contributions.dueWork.filter((w) => w.owner !== "triggers")).toEqual([]);

    // No handler: the message ends event_unhandled, as in phase 1.
    await vi.waitFor(() => expect(getQueueRow(kernel.store, id)?.status).toBe("done"));
    expect(events(kernel.store, "event_unhandled")).toHaveLength(1);
    // No route beyond phase 1's: an unknown path is 404.
    const token = keychain.items.get(API_TOKEN_KEYCHAIN_SERVICE) ?? "";
    const res = await fetch(`http://127.0.0.1:${kernel.api.port}/probe/items/1`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
    // No subcommand beyond the shipped ones: the usage text is phase 1's plus each shipped help line.
    const stderr = out();
    expect(await runCli(["probe"], { dataDir, stderr, stdout: out() })).toBe(2);
    expect(stderr.text()).toBe(`${usageText(kernel.contributions.subcommands)}\n`);
  });
});

describe("a contribution composed from outside (AC4)", () => {
  async function composed() {
    const seen = { bodies: [] as unknown[], messages: [] as unknown[], dueRuns: 0 };
    const contribution = testContribution(seen);
    const store = new Store({ dataDir });
    enqueueMessage(store, { text: "hello" });
    store.close();
    const k = deps();
    const kernel = await start(options({ contributions: [...SHIPPED_CONTRIBUTIONS, contribution] }), k.d);
    const token = k.keychain.items.get(API_TOKEN_KEYCHAIN_SERVICE) ?? "";
    const url = (path: string): string => `http://127.0.0.1:${kernel.api.port}${path}`;
    return { kernel, seen, contribution, token, url, ...k };
  }

  it("the tool is on the kernel MCP server (kernel_ prefix) and validates its arguments with zod", async () => {
    const { kernel, fakes } = await composed();
    const tools = await launchedTools(kernel, fakes);
    expect(Object.keys(tools).filter((n) => !n.startsWith("kernel_trigger_"))).toEqual([...KERNEL_TOOL_NAMES, "kernel_probe_echo"]);
    const sessionId = Number(kernel.store.prepare<[], number>("SELECT max(id) FROM sessions").pluck().get());

    const ok = await tools.kernel_probe_echo?.handler({ text: "hi", idempotency_key: "k1" }, {});
    expect(ok?.isError).toBeUndefined();
    expect(JSON.parse(ok?.content[0]?.text ?? "null")).toEqual({ text: "hi", step: `kernel_probe_echo:session-${sessionId}:k1`, session: sessionId });

    // A handler throw is an isError result with its message.
    const failing = await launchedToolsHandlerThrow(kernel);
    expect(failing).toEqual({ content: [{ type: "text", text: "probe handler failed" }], isError: true });

    // Bad arguments are an isError result, never a throw through the SDK.
    for (const bad of [{ text: "" }, { text: 1, idempotency_key: "k" }, null, "nope"]) {
      const result = await tools.kernel_probe_echo?.handler(bad, {});
      expect(result?.isError).toBe(true);
      expect(result?.content[0]?.text).toMatch(/^kernel_probe_echo: invalid input/);
    }
  });

  it("the route answers only with the bearer token; it gets params, query and the parsed JSON body", async () => {
    const { seen, token, url } = await composed();
    const unauthenticated = await fetch(url("/probe/items/42"));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("www-authenticate")).toBe("Bearer");
    expect(await unauthenticated.json()).toEqual({ error: "unauthorized" });
    const wrong = await fetch(url("/probe/items"), { method: "POST", headers: { Authorization: `Bearer ${"0".repeat(64)}` }, body: "{}" });
    expect(wrong.status).toBe(401);
    expect(seen.bodies).toEqual([]);

    const auth = { Authorization: `Bearer ${token}` };
    const get = await fetch(url("/probe/items/a%20b?x=1&y=two"), { headers: auth });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ params: { id: "a b" }, query: { x: "1", y: "two" }, body: null });

    const post = await fetch(url("/probe/items"), { method: "POST", headers: auth, body: JSON.stringify({ decision: "once" }) });
    expect(post.status).toBe(201);
    expect(await post.json()).toEqual({ received: { decision: "once" } });
    expect(seen.bodies).toEqual([{ decision: "once" }]);

    expect((await fetch(url("/probe/items"), { headers: auth })).status).toBe(405);
    expect((await fetch(url("/probe/items/1"), { method: "DELETE", headers: auth })).headers.get("allow")).toBe("GET");
    expect((await fetch(url("/probe/nothing"), { headers: auth })).status).toBe(404);
    // A handler throw is a 500 with no error text.
    const broken = await fetch(url("/probe/broken"), { headers: auth });
    expect(broken.status).toBe(500);
    expect(await broken.json()).toEqual({ error: "internal_error" });
    // Phase 1 routes still answer as before.
    expect((await fetch(url("/status"), { headers: auth })).status).toBe(200);
    expect((await fetch(url("/status"), { method: "POST", headers: auth, body: "{not json" })).status).toBe(405);
  });

  it("a contributed route's body is always sent as JSON: a string answers a JSON string, an unserializable body 500", async () => {
    const { token, url } = await composed();
    const auth = { Authorization: `Bearer ${token}` };
    const text = await fetch(url("/probe/text"), { headers: auth });
    expect(text.status).toBe(200);
    expect(text.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await text.text()).toBe('"hello"');
    const unserializable = await fetch(url("/probe/unserializable"), { headers: auth });
    expect(unserializable.status).toBe(500);
    expect(await unserializable.json()).toEqual({ error: "internal_error" });
  });

  it("a contributed route's status must carry its JSON body: 1xx, 204/205/304, outside 200-599 or not an integer ⇒ 500, nothing of the answer sent", async () => {
    const { token, url } = await composed();
    const auth = { Authorization: `Bearer ${token}` };
    for (const code of ["200", "201", "299", "404", "599"]) {
      const res = await fetch(url(`/probe/status?code=${code}`), { headers: auth });
      expect(res.status).toBe(Number(code));
      expect(await res.json()).toEqual({ answered: code });
    }
    for (const code of ["101", "99", "100", "199", "204", "205", "304", "600", "1000", "200.5", "NaN", "-200"]) {
      const res = await fetch(url(`/probe/status?code=${code}`), { headers: auth });
      expect(res.status, code).toBe(500);
      expect(res.headers.get("content-length"), code).toBe(String(Buffer.byteLength('{"error":"internal_error"}')));
      expect(await res.json(), code).toEqual({ error: "internal_error" });
    }
  });

  it("every contributed-route 500 (a throw, an invalid status, a body that is not JSON) appends exactly one route_failed row naming the contributor; the client gets only internal_error", async () => {
    const { kernel, token, url } = await composed();
    const auth = { Authorization: `Bearer ${token}` };
    const failures: readonly [string, string, RegExp][] = [
      ["/probe/broken", "/probe/broken", /^secret detail$/],
      ["/probe/status?code=204", "/probe/status", /status 204/],
      ["/probe/status?code=101", "/probe/status", /status 101/],
      ["/probe/unserializable", "/probe/unserializable", /not JSON/],
    ];
    for (const [requestPath, routePath, error] of failures) {
      const before = events(kernel.store, "route_failed").length;
      const res = await fetch(url(requestPath), { headers: auth });
      expect(res.status, requestPath).toBe(500);
      expect(await res.text(), requestPath).toBe('{"error":"internal_error"}');
      const rows = events(kernel.store, "route_failed");
      expect(rows, requestPath).toHaveLength(before + 1);
      const row = rows.at(-1);
      expect({ actor: row?.actor, session_id: row?.session_id, task_id: row?.task_id }).toEqual({ actor: "kernel", session_id: null, task_id: null });
      expect(row?.payload, requestPath).toEqual({ contributor: "probe", method: "GET", path: routePath, error: expect.stringMatching(error) });
    }
    // An answered route, a 404, a 405, a 400 and a phase 1 route record nothing.
    expect((await fetch(url("/probe/items/1"), { headers: auth })).status).toBe(200);
    expect((await fetch(url("/probe/nothing"), { headers: auth })).status).toBe(404);
    expect((await fetch(url("/probe/items"), { headers: auth })).status).toBe(405);
    expect((await fetch(url("/probe/items"), { method: "POST", headers: auth, body: "{not json" })).status).toBe(400);
    expect((await fetch(url("/status"), { headers: auth })).status).toBe(200);
    expect(events(kernel.store, "route_failed")).toHaveLength(failures.length);

    // A failed audit write never changes the answer: still the 500, still no error text.
    const prepare = kernel.store.prepare.bind(kernel.store);
    vi.spyOn(kernel.store, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("INSERT INTO events")) throw new Error("disk I/O error");
      return prepare(sql);
    }) as typeof kernel.store.prepare);
    const res = await fetch(url("/probe/broken"), { headers: auth });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal_error"}');
    vi.restoreAllMocks();
    expect(events(kernel.store, "route_failed")).toHaveLength(failures.length);
  });

  it("a contributed tool whose value is not JSON is an isError result, never text: undefined", async () => {
    const { kernel } = await composed();
    const fn = defineTool({ name: "kernel_probe_fn", description: "Returns a function.", shape: {}, handler: () => () => 1 });
    const result = await contributedToolHandler(fn, { store: kernel.store, sessions: kernel.sessions, sessionId: 1 })({});
    expect(result).toEqual({ content: [{ type: "text", text: "kernel_probe_fn: the result is not JSON" }], isError: true });
    const str = defineTool({ name: "kernel_probe_str", description: "Returns a string.", shape: {}, handler: () => "hello" });
    expect(await contributedToolHandler(str, { store: kernel.store, sessions: kernel.sessions, sessionId: 1 })({})).toEqual({
      content: [{ type: "text", text: '"hello"' }],
    });
  });

  it("malformed JSON to a contributed route ⇒ 400 invalid_json, the handler not called", async () => {
    const { seen, token, url } = await composed();
    const res = await fetch(url("/probe/items"), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{not json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
    expect(seen.bodies).toEqual([]);
  });

  it("a contributed-route body over 1 MiB ⇒ 413 body_too_large, declared or streamed; exactly 1 MiB is read", async () => {
    const { seen, token, url } = await composed();
    const auth = { Authorization: `Bearer ${token}` };
    expect(MAX_CONTRIBUTED_BODY_BYTES).toBe(1_048_576);
    const big = JSON.stringify("x".repeat(MAX_CONTRIBUTED_BODY_BYTES));
    const declared = await fetch(url("/probe/items"), { method: "POST", headers: auth, body: big });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "body_too_large" });

    // No Content-Length (chunked): the reader's own bound.
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_CONTRIBUTED_BODY_BYTES + chunk.length) controller.close();
        else {
          sent += chunk.length;
          controller.enqueue(chunk);
        }
      },
    });
    const streamed = await fetch(url("/probe/items"), { method: "POST", headers: auth, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(seen.bodies).toEqual([]);

    const exact = JSON.stringify("y".repeat(MAX_CONTRIBUTED_BODY_BYTES - 2));
    expect(Buffer.byteLength(exact)).toBe(MAX_CONTRIBUTED_BODY_BYTES);
    expect((await fetch(url("/probe/items"), { method: "POST", headers: auth, body: exact })).status).toBe(201);
    expect(seen.bodies).toHaveLength(1);
  });

  it("the subcommand runs through studio after the api.json pid check and before any token read", async () => {
    const { contribution, keychain, kernel } = await composed();
    const cliDeps = (overrides: Partial<CliDeps> = {}) => {
      const stdout = out();
      const stderr = out();
      return { stdout, stderr, deps: { dataDir, keychain: keychain.reader, contributions: [contribution], stdout, stderr, ...overrides } };
    };
    keychain.reads.length = 0;

    const offline = cliDeps();
    expect(await runCli(["probe", "--offline"], offline.deps)).toBe(0);
    expect(offline.stdout.text()).toBe("offline\n");
    expect(keychain.reads).toEqual([]);

    const online = cliDeps();
    expect(await runCli(["probe", "7"], online.deps)).toBe(0);
    expect(online.stdout.text()).toBe(`200 {"params":{"id":"7"},"query":{},"body":null}\n`);
    expect(keychain.reads).toEqual([API_TOKEN_KEYCHAIN_SERVICE]);
    expect(online.stdout.text()).not.toContain(keychain.items.get(API_TOKEN_KEYCHAIN_SERVICE) as string);

    // api.json's pid is not alive: the subcommand never runs.
    keychain.reads.length = 0;
    const dead = cliDeps({ isPidAlive: () => false });
    expect(await runCli(["probe", "--offline"], dead.deps)).toBe(1);
    expect(dead.stdout.text()).toBe("");
    expect(dead.stderr.text()).toMatch(new RegExp(`^studio: kernel daemon is not running \\(pid ${process.pid} in .*api\\.json is gone\\)\\n$`));
    // No api.json at all: the subcommand never runs either.
    const missing = cliDeps({ dataDir: join(tmp, "elsewhere") });
    expect(await runCli(["probe", "--offline"], missing.deps)).toBe(1);
    expect(missing.stdout.text()).toBe("");
    expect(keychain.reads).toEqual([]);

    // The subcommand's exit code is passed on; a throw or a non-code is one stderr line / 1.
    expect(await runCli(["probe", "--code", "7"], cliDeps().deps)).toBe(7);
    for (const bad of ["1.5", "256", "-1", "NaN"]) {
      const nonCode = cliDeps();
      expect(await runCli(["probe", "--code", bad], nonCode.deps)).toBe(1);
      expect(nonCode.stderr.text()).toBe("studio: subcommand probe did not resolve to an exit code 0-255\n");
    }
    const throws = cliDeps();
    expect(await runCli(["probe", "--throw"], throws.deps)).toBe(1);
    expect(throws.stderr.text()).toBe("studio: first line\n");
    const badPath = cliDeps();
    expect(await runCli(["probe", "--path", "status"], badPath.deps)).toBe(1);
    expect(badPath.stderr.text()).toBe('studio: API path "status" must start with /\n');
    // No answer (nothing listens on the port in api.json): one stderr line, 1.
    const refusedDir = join(tmp, "refused");
    mkdirSync(refusedDir);
    writeFileSync(join(refusedDir, "api.json"), JSON.stringify({ port: 1, host: "127.0.0.1", pid: process.pid, started_at: "x" }));
    const refused = cliDeps({ dataDir: refusedDir });
    expect(await runCli(["probe", "1"], refused.deps)).toBe(1);
    expect(refused.stderr.text()).toMatch(/^studio: connection to the kernel daemon failed during GET \/probe\/items\/1 \(127\.0\.0\.1:1(: \w+)?\)\n$/);

    // The help line is appended to the usage text.
    const usage = cliDeps();
    expect(await runCli(["nope"], usage.deps)).toBe(2);
    expect(usage.stderr.text()).toBe(`${USAGE} | studio probe <id>\n`);
    expect(kernel.contributions.subcommands.map((s) => s.name).filter((n) => n !== "triggers")).toEqual(["probe"]);
  });

  it("the handler runs for its event kind and the due work runs on each tick", async () => {
    const { kernel, seen } = await composed();
    await vi.waitFor(() => expect(seen.messages).toEqual([{ text: "hello", agent: null }]));
    expect(events(kernel.store, "event_done")).toHaveLength(1);
    expect(events(kernel.store, "event_unhandled")).toHaveLength(0);
    expect(seen.dueRuns).toBeGreaterThanOrEqual(1);
    const before = seen.dueRuns;
    await kernel.loop.tick();
    expect(seen.dueRuns).toBeGreaterThan(before);
  });
});

describe("refused compositions (AC5)", () => {
  it("two contributions registering the same tool: startKernel rejects with ContributionConflictError before the store opens", async () => {
    const openStore = vi.fn((dir: string) => new Store({ dataDir: dir }));
    const { d } = deps({ openStore });
    const err = await startKernel(
      options({ contributions: [{ name: "alpha", tools: [noopTool("kernel_probe")] }, { name: "beta", tools: [noopTool("kernel_probe")] }] }),
      d,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContributionConflictError);
    expect((err as ContributionConflictError).owners).toEqual(["alpha", "beta"]);
    expect(openStore).not.toHaveBeenCalled();
  });

  it("a contribution colliding with an options.handlers kind or a phase 1 route, or handling an unknown kind, is refused the same way", async () => {
    const openStore = vi.fn((dir: string) => new Store({ dataDir: dir }));
    const { d } = deps({ openStore });
    const handlerClash = await startKernel(
      options({ handlers: { message: () => {} }, contributions: [{ name: "probe", handlers: { message: () => {} } }] }),
      d,
    ).catch((e: unknown) => e);
    expect((handlerClash as ContributionConflictError).owners).toEqual(["options.handlers", "probe"]);
    const routeClash = await startKernel(options({ contributions: [{ name: "probe", routes: [noopRoute("POST", "/resume")] }] }), d).catch((e: unknown) => e);
    expect((routeClash as ContributionConflictError).owners).toEqual(["phase1", "probe"]);
    const unknownKind = await startKernel(options({ contributions: [{ name: "probe", handlers: { cron: () => {} } }] }), d).catch((e: unknown) => e);
    expect(unknownKind).toBeInstanceOf(UnknownEventKindError);
    expect(openStore).not.toHaveBeenCalled();
  });

  it("runCli on a subcommand collision, reached for a contributed word, prints one stderr line naming both owners and returns 1, without throwing", async () => {
    const exitCode = process.exitCode;
    for (const [contributions, owners] of [
      [[{ name: "alpha", subcommands: [noopSubcommand("probe")] }, { name: "beta", subcommands: [noopSubcommand("probe")] }], ["alpha", "beta"]],
      [[{ name: "alpha", subcommands: [noopSubcommand("status")] }], ["phase1", "alpha"]],
    ] as const) {
      const stdout = out();
      const stderr = out();
      const code = await runCli(["probe"], { dataDir, stdout, stderr, contributions, keychain: { read: () => "unused" } });
      expect(code).toBe(1);
      expect(stdout.text()).toBe("");
      expect(stderr.text().endsWith("\n")).toBe(true);
      expect(stderr.text().trimEnd().split("\n")).toHaveLength(1);
      for (const owner of owners) expect(stderr.text()).toContain(owner);
    }
    expect(process.exitCode).toBe(exitCode);
  });
  it("the daemon and the CLI refuse the same compositions: startKernel's refusal is studio's warning, word for word; an accepted one warns about nothing", async () => {
    const compositions: readonly (readonly FeatureContribution[])[] = [
      [{ name: "alpha", tools: [noopTool("kernel_task_create")] }],
      [{ name: "alpha", routes: [noopRoute("POST", "/status")] }],
      [{ name: "alpha", routes: [noopRoute("GET", "/sessions/:sid/abandon")] }],
      [{ name: "alpha", subcommands: [noopSubcommand("resume")] }],
      [{ name: "alpha", tools: [noopTool("probe")] }],
      [{ name: "alpha", tools: [noopTool("kernel_probe")] }, { name: "beta", tools: [noopTool("kernel_probe")] }],
      [{ name: "alpha", routes: [noopRoute("GET", "/probe/:id")] }, { name: "beta", routes: [noopRoute("GET", "/probe/x")] }],
      [{ name: "alpha", tools: [noopTool("kernel_probe")], routes: [noopRoute("GET", "/probe")], subcommands: [noopSubcommand("probe")] }],
    ];
    let refused = 0;
    for (const contributions of compositions) {
      const daemon = await startKernel(options({ contributions }), deps().d).catch((e: unknown) => e);
      if (!(daemon instanceof Error)) await (daemon as Kernel).stop();
      const stderr = out();
      expect(await runCli(["status"], { dataDir, stdout: out(), stderr, contributions, keychain: { read: () => undefined } })).toBe(1);
      const lines = stderr.text().trimEnd().split("\n");
      if (daemon instanceof Error) {
        refused++;
        expect(lines[0]).toBe(`studio: warning: ${daemon.message}`);
        expect(lines).toHaveLength(2);
      } else {
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatch(/^studio: kernel daemon is not running/);
      }
    }
    expect(refused).toBe(compositions.length - 1);
  });
});

describe("phase 1 commands under a broken composition (AC5)", () => {
  const colliding: readonly FeatureContribution[] = [
    { name: "alpha", subcommands: [noopSubcommand("probe")] },
    { name: "beta", subcommands: [noopSubcommand("probe")] },
  ];

  it("studio service uninstall still runs (no daemon, no api.json, no Keychain) when contributions collide", async () => {
    const homeDir = join(tmp, "home");
    mkdirSync(join(homeDir, "Library", "LaunchAgents"), { recursive: true });
    const launchctl: string[][] = [];
    const service = {
      deps: {
        exec: (_file: string, args: readonly string[]) => {
          launchctl.push([...args]);
          return { status: args[0] === "print" ? 113 : 0, stderr: "" };
        },
        uid: 501,
        homeDir,
        platform: "darwin" as const,
      },
    };
    const stdout = out();
    const stderr = out();
    const reads: string[] = [];
    const code = await runCli(["service", "uninstall"], {
      dataDir,
      stdout,
      stderr,
      contributions: colliding,
      service,
      keychain: {
        read: (s) => {
          reads.push(s);
          return undefined;
        },
      },
    });
    // One warning line saying why the daemon refuses to start, then the command as in phase 1.
    expect(stderr.text()).toMatch(/^studio: warning: [^\n]*alpha[^\n]*beta[^\n]*\n$/);
    expect(code).toBe(0);
    expect(stdout.text()).toMatch(/^studio: service \S+ unloaded and removed \(.*\)\n$/);
    expect(launchctl.map((a) => a[0])).toEqual(["print"]);
    expect(reads).toEqual([]);
  });

  it("a contribution claiming a phase 1 tool name or route: studio status warns once (the CLI reserves what the daemon does), then runs as in phase 1", async () => {
    const exitCode = process.exitCode;
    const cases: readonly [readonly FeatureContribution[], string][] = [
      [[{ name: "alpha", tools: [noopTool("kernel_task_create")] }], 'tool "kernel_task_create"'],
      [[{ name: "alpha", routes: [noopRoute("POST", "/status")] }], 'route "POST /status (overlaps GET /status)"'],
    ];
    for (const [contributions, named] of cases) {
      const stderr = out();
      const reads: string[] = [];
      const keychain = {
        read: (service: string) => {
          reads.push(service);
          return "unused";
        },
      };
      const code = await runCli(["status"], { dataDir, stdout: out(), stderr, contributions, keychain });
      expect(code).toBe(1);
      const lines = stderr.text().trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(`studio: warning: ${named} is registered by both phase1 and alpha; refusing to start`);
      expect(lines[1]).toMatch(/^studio: kernel daemon is not running/);
      expect(reads).toEqual([]);
    }
    expect(process.exitCode).toBe(exitCode);
  });

  it("every other phase 1 word warns once about the collision, then dispatches as in phase 1 (here: no api.json)", async () => {
    const exitCode = process.exitCode;
    for (const argv of [["status"], ["stop", "--all"], ["resume"], ["session", "abandon", "1", "--yes"]]) {
      const stderr = out();
      const reads: string[] = [];
      const keychain = {
        read: (service: string) => {
          reads.push(service);
          return "unused";
        },
      };
      const code = await runCli(argv, { dataDir, stdout: out(), stderr, contributions: colliding, keychain });
      expect(code).toBe(1);
      const lines = stderr.text().trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^studio: warning: .*alpha.*beta/);
      expect(lines[1]).toMatch(/^studio: kernel daemon is not running/);
      expect(reads).toEqual([]);
    }
    // A malformed phase 1 command: the warning, then usage (phase 1's only, the merge failed), 2.
    const usage = out();
    expect(await runCli(["status", "--bad"], { dataDir, stdout: out(), stderr: usage, contributions: colliding })).toBe(2);
    const [warning, ...rest] = usage.text().split("\n");
    expect(warning).toMatch(/^studio: warning: .*alpha.*beta/);
    expect(rest.join("\n")).toBe(`${USAGE}\n`);
    expect(process.exitCode).toBe(exitCode);
  });
});

describe("the feature registry's module graph (AC9)", () => {
  let build: { root: string; outDir: string };
  let register: string;

  beforeAll(() => {
    build = buildKernel();
    // A resolve hook that fails any import resolving into the Agent SDK package.
    writeFileSync(
      join(build.root, "sdk-guard-hooks.mjs"),
      `export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  if (result.url.includes("/@anthropic-ai/claude-agent-sdk/")) throw new Error("SDK_IN_GRAPH " + specifier + " from " + context.parentURL);
  return result;
}
`,
    );
    register = join(build.root, "sdk-guard-register.mjs");
    writeFileSync(register, `import { register } from "node:module";\nregister("./sdk-guard-hooks.mjs", import.meta.url);\n`);
  }, 120_000);

  afterAll(() => {
    rmSync(build.root, { recursive: true, force: true });
  });

  function load(relative: string): { status: number | null; stdout: string; stderr: string } {
    const target = pathToFileURL(join(build.outDir, relative)).href;
    const r = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(register).href, "--input-type=module", "-e", `await import(${JSON.stringify(target)}); console.log("loaded");`],
      { encoding: "utf8", timeout: 30_000 },
    );
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }

  it("features/index.js loads in a fresh Node process without the Agent SDK; the guard does catch a module that loads it", () => {
    const registry = load("features/index.js");
    expect(registry.stderr).toBe("");
    expect(registry.stdout).toBe("loaded\n");
    expect(registry.status).toBe(0);
    // The control: the tool server imports the SDK, and the guard refuses it.
    const tools = load("tools/server.js");
    expect(tools.status).not.toBe(0);
    expect(tools.stderr).toContain("SDK_IN_GRAPH @anthropic-ai/claude-agent-sdk");
  });
});

describe("the route seam carries the API's store and clock", () => {
  it("a contributed route's request has the API server's own store and now, beside params, query and body", async () => {
    const store = new Store({ dataDir });
    const at = new Date("2026-10-14T11:30:00.000Z");
    const seen: ContributedRouteRequest[] = [];
    const token = "f".repeat(64);
    const api = await startApiServer(
      {
        store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [],
        token,
        routes: mergeContributions([
          {
            name: "probe",
            routes: [
              {
                method: "POST",
                path: "/probe/context/:id",
                handler: async (req) => {
                  seen.push(req);
                  return { status: 200, body: { now: req.now().toISOString(), dataDir: req.store.dataDir } };
                },
              },
            ],
          },
        ]).routes,
      },
      { now: () => at },
    );
    try {
      const res = await fetch(`http://127.0.0.1:${api.port}/probe/context/7?x=1`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{\"a\":1}" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ now: at.toISOString(), dataDir });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.store).toBe(store);
      expect(seen[0]?.now()).toBe(at);
      expect({ params: { ...seen[0]?.params }, query: { ...seen[0]?.query }, body: seen[0]?.body }).toEqual({ params: { id: "7" }, query: { x: "1" }, body: { a: 1 } });
    } finally {
      await api.close();
      store.close();
    }
  });
});
