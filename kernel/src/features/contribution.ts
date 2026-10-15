// The phase 2 feature seam: one `FeatureContribution` type and one merge.
// Each feature directory (`loomwright`, `notifications`, `triggers`,
// `approvals`, `brain`) exports one contribution; the kernel composition
// (`startKernel`) and the `studio` CLI (`runCli`) merge them through
// `mergeContributions`, so a later feature adds its tools, routes,
// subcommands, event handlers and due work without editing a central file.
//
// Mechanism only (invariant 1): the merge validates and refuses, it adds no
// behaviour of its own. A collision is refused, never resolved by order: two
// owners of one name are a `ContributionConflictError` naming both, so a
// deterministically broken composition never starts (`permanentReason` in
// `daemon-exit.ts`).
//
// The `studio` CLI (a separate process) imports this module through
// `features/index.ts`, so it imports only zod and type-level kernel modules:
// never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the module graph).
import { z } from "zod";
import { EVENT_KINDS, isEventKind } from "../loop/types.js";
import type { DueWork, DueWorkContext, EventHandler, EventHandlers } from "../loop/types.js";
import type { SessionRow, SessionStatus } from "../sessions/types.js";
import type { Store } from "../store/store.js";

/** The owner named for what phase 1 registers itself (its tools, routes and subcommands). */
export const PHASE1_OWNER = "phase1";

/** The owner named for a kind `KernelOptions.handlers` already handles. */
export const OPTIONS_HANDLERS_OWNER = "options.handlers";

/**
 * The `studio` CLI's phase 1 command words (`studio status`, `studio stop`,
 * `studio resume`, `studio session`, `studio service`): a contributed
 * subcommand may not take one.
 */
export const PHASE1_SUBCOMMANDS: readonly string[] = ["status", "stop", "resume", "session", "service"];

/**
 * Phase 1's kernel tool names (the tool server's `KERNEL_TOOL_NAMES`, which
 * re-exports this list): a contributed tool may not take one. Kept here, not
 * in the tool server (which loads the Agent SDK), so the `studio` CLI can
 * reserve it too.
 */
export const PHASE1_TOOL_NAMES = [
  "kernel_task_create",
  "kernel_task_update",
  "kernel_task_list",
  "kernel_task_get",
  "kernel_schedule_wakeup",
  "kernel_request_stop",
] as const;

/**
 * Phase 1's API routes (the API server answers them before any contributed
 * route): a contributed route whose path overlaps one is refused, whatever
 * its method.
 */
export const PHASE1_ROUTES: readonly { readonly method: string; readonly path: string }[] = [
  { method: "GET", path: "/status" },
  { method: "POST", path: "/stop-all" },
  { method: "POST", path: "/resume" },
  { method: "POST", path: "/sessions/:id/abandon" },
];

/** The part of a contribution a refusal is about. */
export type ContributionPart = "contribution" | "tool" | "route" | "subcommand" | "handler" | "dueWork";

/** Two owners register the same name: refused at composition, never a silent override. */
export class ContributionConflictError extends Error {
  readonly code = "contribution_conflict";
  readonly part: ContributionPart;
  /** The colliding name: a tool name, `<METHOD> <path>`, a subcommand name, an event kind or a contribution name. */
  readonly conflictName: string;
  /** Both owners: the one registered first, then the one refused. */
  readonly owners: readonly [string, string];

  constructor(part: ContributionPart, conflictName: string, owners: readonly [string, string]) {
    super(`${part} "${conflictName}" is registered by both ${owners[0]} and ${owners[1]}; refusing to start`);
    this.name = "ContributionConflictError";
    this.part = part;
    this.conflictName = conflictName;
    this.owners = owners;
  }
}

/** A contributed handler keyed by a kind outside `EVENT_KINDS`: refused at composition. */
export class UnknownEventKindError extends Error {
  readonly code = "unknown_event_kind";
  readonly contributor: string;
  readonly kind: string;

  constructor(contributor: string, kind: string) {
    super(`contribution ${contributor} registers a handler for unknown event kind "${kind}" (known: ${EVENT_KINDS.join(", ")})`);
    this.name = "UnknownEventKindError";
    this.contributor = contributor;
    this.kind = kind;
  }
}

/** A contribution part that is malformed (a tool name without `kernel_`, a bad route path): refused at composition. */
export class InvalidContributionError extends Error {
  readonly code = "invalid_contribution";
  readonly contributor: string;
  readonly part: ContributionPart;

  constructor(contributor: string, part: ContributionPart, reason: string) {
    super(`contribution ${contributor}: invalid ${part}: ${reason}`);
    this.name = "InvalidContributionError";
    this.contributor = contributor;
    this.part = part;
  }
}

// ---- Tools -----------------------------------------------------------------

/**
 * What a contributed tool's handler receives: the phase 1 `KernelToolContext`
 * fields, plus `stepKey`, so a contribution never imports the tool server
 * (which loads the Agent SDK).
 */
export interface ContributedToolContext {
  readonly store: Store;
  readonly sessions: {
    stopSession(id: number): Promise<SessionStatus>;
    getSession(id: number): SessionRow | undefined;
  };
  /** The `sessions` row this server instance serves. */
  readonly sessionId: number;
  readonly now: () => Date;
  /** The work-step key of a call: `<tool>:session-<sessionId>:<idempotencyKey>` (the `kernelStepKey` shape). */
  stepKey(idempotencyKey: string): string;
}

/**
 * A tool on the kernel MCP server. `name` must start with `kernel_`. The
 * server validates arguments against `shape` (zod) before `handler` runs: bad
 * arguments are an `isError` result. The handler's value is returned as JSON
 * text; a throw is an `isError` result with its message, never a throw
 * through the SDK. Tool input is untrusted data (invariant 3).
 */
export interface ContributedTool<S extends z.ZodRawShape = z.ZodRawShape> {
  readonly name: string;
  readonly description: string;
  readonly shape: S;
  handler(args: z.infer<z.ZodObject<S>>, ctx: ContributedToolContext): unknown;
}

/** Infers a tool's argument type from its shape. */
export function defineTool<S extends z.ZodRawShape>(tool: ContributedTool<S>): ContributedTool {
  return tool as unknown as ContributedTool;
}

const TOOL_NAME = /^kernel_[a-z0-9_]{1,64}$/;

// ---- Routes ----------------------------------------------------------------

export const ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type RouteMethod = (typeof ROUTE_METHODS)[number];

/**
 * What a contributed route's handler receives. `body` is the parsed JSON body
 * (`undefined` when empty); `store` and `now` are the API's own (the
 * contributions are merged before the store opens, so a route has no other
 * way to reach them).
 */
export interface ContributedRouteRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly store: Store;
  readonly now: () => Date;
}

/**
 * A contributed route's answer, always sent with a JSON body: `status` must
 * be an integer 200-599 other than 204/205/304 (statuses that have no body),
 * or the API answers 500 instead.
 */
export interface ContributedRouteResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * An API route, reached only with the bearer token. `path` is exact
 * (`/approvals`) or a pattern whose `:name` segments are captured into
 * `params` (`/approvals/:id`).
 */
export interface ContributedRoute {
  readonly method: RouteMethod;
  readonly path: string;
  handler(req: ContributedRouteRequest): Promise<ContributedRouteResponse>;
}

/** One segment of a compiled route path: a literal, or a `:name` parameter. */
export type RouteSegment = { readonly literal: string } | { readonly param: string };

const LITERAL_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const PARAM_SEGMENT = /^:([A-Za-z_][A-Za-z0-9_]*)$/;

/** The segments of a route path; throws `RangeError` naming the problem when it is not one. */
export function compileRoutePath(path: string): readonly RouteSegment[] {
  if (typeof path !== "string" || !path.startsWith("/") || path.length < 2) {
    throw new RangeError(`route path ${JSON.stringify(path)} must start with / and name at least one segment`);
  }
  const seen = new Set<string>();
  return path
    .slice(1)
    .split("/")
    .map((segment) => {
      const param = PARAM_SEGMENT.exec(segment);
      if (param !== null) {
        const name = param[1] as string;
        if (seen.has(name)) throw new RangeError(`route path ${path} repeats parameter :${name}`);
        seen.add(name);
        return { param: name };
      }
      if (!LITERAL_SEGMENT.test(segment)) throw new RangeError(`route path ${path} has an invalid segment ${JSON.stringify(segment)}`);
      return { literal: segment };
    });
}

/**
 * The params of `pathname` (already split on `/`, still percent-encoded) under
 * `segments`, or `undefined` when it does not match (a malformed escape in a
 * parameter does not match).
 */
export function matchRoutePath(segments: readonly RouteSegment[], parts: readonly string[]): Record<string, string> | undefined {
  if (parts.length !== segments.length) return undefined;
  const params: Record<string, string> = Object.create(null) as Record<string, string>;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as RouteSegment;
    const part = parts[i] as string;
    if ("literal" in segment) {
      if (part !== segment.literal) return undefined;
      continue;
    }
    if (part === "") return undefined;
    try {
      params[segment.param] = decodeURIComponent(part);
    } catch {
      return undefined;
    }
  }
  return params;
}

/** Whether some request path matches both patterns (same length; each segment pair equal, or one a parameter). */
function routePathsOverlap(a: readonly RouteSegment[], b: readonly RouteSegment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((sa, i) => {
    const sb = b[i] as RouteSegment;
    return "param" in sa || "param" in sb || sa.literal === sb.literal;
  });
}

// ---- CLI subcommands -------------------------------------------------------

/** An authenticated loopback API call from a contributed subcommand. */
export interface CliApiClient {
  /**
   * `method path` with the bearer token and a JSON `body` (if given). Resolves
   * with any status and the parsed JSON body (`undefined` when empty or not
   * JSON); rejects only when no answer came (connection error, timeout).
   */
  request(method: RouteMethod, path: string, body?: unknown): Promise<{ readonly status: number; readonly body: unknown }>;
}

/** Where a contributed subcommand writes; `process.stdout` / `process.stderr` satisfy it. */
export interface CliSubcommandOutput {
  readonly stdout: { write(chunk: string): unknown };
  readonly stderr: { write(chunk: string): unknown };
}

/**
 * A `studio <name> …` subcommand. `help` is one line appended to the usage
 * text. `run` resolves to the exit code; a throw is one stderr line and 1.
 */
export interface ContributedSubcommand {
  readonly name: string;
  readonly help: string;
  run(args: readonly string[], client: CliApiClient, output: CliSubcommandOutput): Promise<number>;
}

const SUBCOMMAND_NAME = /^[a-z][a-z0-9-]{0,63}$/;

// ---- Due work --------------------------------------------------------------

/** Work run once per loop tick, after due wake-ups fire and before the queue (see `EventLoop`). */
export type DueWorkFn = (ctx: DueWorkContext) => void | Promise<void>;

// ---- The contribution --------------------------------------------------------

/** One feature's parts. Every part is optional; a shipped feature with none adds nothing (invariant 1). */
export interface FeatureContribution {
  /** The feature's name (`loomwright`, `triggers`, …): the owner named in a refusal. */
  readonly name: string;
  readonly tools?: readonly ContributedTool[];
  readonly routes?: readonly ContributedRoute[];
  readonly subcommands?: readonly ContributedSubcommand[];
  /** Keyed by an existing `EventKind`; merged with `KernelOptions.handlers`. */
  readonly handlers?: Readonly<Record<string, EventHandler>>;
  readonly dueWork?: readonly DueWorkFn[];
}

/** What phase 1 (and `KernelOptions.handlers`) already registers: a contribution taking one is refused. */
export interface ReservedNames {
  /** Phase 1 kernel tool names (owner `phase1`). */
  readonly tools?: readonly string[];
  /** Phase 1 API routes (owner `phase1`): refused when a contributed path overlaps, whatever its method. */
  readonly routes?: readonly { readonly method: string; readonly path: string }[];
  /** Phase 1 CLI command words (owner `phase1`). */
  readonly subcommands?: readonly string[];
  /** Kinds `KernelOptions.handlers` handles (owner `options.handlers`). */
  readonly handlerKinds?: readonly string[];
}

/**
 * Everything phase 1 registers, reserved by both `startKernel` (plus its
 * `KernelOptions.handlers` kinds) and `runCli`: one list, so the CLI refuses
 * (and warns about) exactly the compositions the daemon refuses to start.
 */
export const PHASE1_RESERVED: ReservedNames = { tools: PHASE1_TOOL_NAMES, routes: PHASE1_ROUTES, subcommands: PHASE1_SUBCOMMANDS };

/** A merged route with its contribution's name as `owner` (named in the API's `route_failed` row). */
export interface OwnedRoute extends ContributedRoute {
  readonly owner: string;
}

/** The merged parts, in contribution order (each contribution's parts in its own order). */
export interface MergedContributions {
  readonly contributors: readonly string[];
  readonly tools: readonly ContributedTool[];
  readonly routes: readonly OwnedRoute[];
  readonly subcommands: readonly ContributedSubcommand[];
  /** The contributed handlers only (never `KernelOptions.handlers`). */
  readonly handlers: EventHandlers;
  /** Each function with its contribution's name as `owner` (the loop's `DueWork`). */
  readonly dueWork: readonly DueWork[];
}

const CONTRIBUTION_NAME = /^[a-z][a-z0-9-]{0,63}$/;

/** The part a contribution's list holds, for a refusal. */
const PART_OF = { tools: "tool", routes: "route", subcommands: "subcommand", dueWork: "dueWork" } as const satisfies Record<string, ContributionPart>;

/**
 * A zod raw shape, as the kernel MCP server needs it (`z.object(shape)`, the
 * SDK's `tool()`): a plain object, not itself a zod schema, whose every value
 * is a zod schema. Checked at composition so a bad shape refuses the start
 * instead of failing every session launch.
 */
function isZodRawShape(shape: unknown): boolean {
  if (typeof shape !== "object" || shape === null || Array.isArray(shape) || shape instanceof z.ZodType) return false;
  return Object.values(shape).every((v) => v instanceof z.ZodType);
}

/**
 * Validate every part of every contribution and merge them. Throws, before
 * anything is registered:
 *
 * - `ContributionConflictError` when two owners take one name: a contribution
 *   name, a tool name, a route (same method, overlapping paths), a subcommand
 *   name or a handler kind, between two contributions, or against `reserved`
 *   (owner `phase1`, or `options.handlers` for a handler kind). A contributed
 *   route whose path overlaps a phase 1 route's is refused whatever its
 *   method: phase 1 routes match first and would shadow it.
 * - `UnknownEventKindError` for a handler keyed by a kind outside `EVENT_KINDS`.
 * - `InvalidContributionError` for a malformed part (a tool name that does not
 *   start with `kernel_`, a tool shape that is not a zod raw shape, a bad
 *   route path or method, a subcommand name or help that is not one short
 *   line, a part that is not a function, a part list that is not a list).
 */
export function mergeContributions(contributions: readonly FeatureContribution[], reserved: ReservedNames = {}): MergedContributions {
  const contributorOwners = new Map<string, string>();
  const toolOwners = new Map<string, string>();
  const subcommandOwners = new Map<string, string>();
  const handlerOwners = new Map<string, string>();
  const routeOwners: { readonly method: string; readonly path: string; readonly segments: readonly RouteSegment[]; readonly owner: string }[] = [];
  const phase1Routes = (reserved.routes ?? []).map((r) => ({ ...r, segments: compileRoutePath(r.path) }));

  for (const name of reserved.tools ?? []) toolOwners.set(name, PHASE1_OWNER);
  for (const name of reserved.subcommands ?? []) subcommandOwners.set(name, PHASE1_OWNER);
  for (const kind of reserved.handlerKinds ?? []) handlerOwners.set(kind, OPTIONS_HANDLERS_OWNER);

  const claim = (owners: Map<string, string>, part: ContributionPart, name: string, owner: string): void => {
    const first = owners.get(name);
    if (first !== undefined) throw new ContributionConflictError(part, name, [first, owner]);
    owners.set(name, owner);
  };

  const tools: ContributedTool[] = [];
  const routes: OwnedRoute[] = [];
  const subcommands: ContributedSubcommand[] = [];
  const handlers: Partial<Record<string, EventHandler>> = {};
  const dueWork: DueWork[] = [];

  for (const c of contributions) {
    const owner = typeof c?.name === "string" ? c.name : "";
    if (!CONTRIBUTION_NAME.test(owner)) {
      throw new InvalidContributionError(JSON.stringify(owner), "contribution", "the name must be lowercase letters, digits and -");
    }
    if (owner === PHASE1_OWNER) throw new ContributionConflictError("contribution", owner, [PHASE1_OWNER, owner]);
    claim(contributorOwners, "contribution", owner, owner);
    const invalid = (part: ContributionPart, reason: string): InvalidContributionError => new InvalidContributionError(owner, part, reason);
    // Each part's container: a list (or an object of handlers), or absent; anything else is refused, never a TypeError.
    for (const key of ["tools", "routes", "subcommands", "dueWork"] as const) {
      if (c[key] !== undefined && !Array.isArray(c[key])) throw invalid(PART_OF[key], `${key} must be a list`);
    }
    if (c.handlers !== undefined && (typeof c.handlers !== "object" || c.handlers === null || Array.isArray(c.handlers))) {
      throw invalid("handler", "handlers must be an object keyed by event kind");
    }

    for (const t of c.tools ?? []) {
      if (typeof t?.name !== "string" || !TOOL_NAME.test(t.name)) {
        throw invalid("tool", `tool name ${JSON.stringify(t?.name)} must start with kernel_ (lowercase letters, digits and _)`);
      }
      if (typeof t.description !== "string" || t.description.trim() === "") throw invalid("tool", `${t.name} needs a description`);
      if (!isZodRawShape(t.shape)) throw invalid("tool", `${t.name} needs a zod raw shape (an object whose every value is a zod schema)`);
      if (typeof t.handler !== "function") throw invalid("tool", `${t.name} needs a handler`);
      claim(toolOwners, "tool", t.name, owner);
      tools.push(t);
    }

    for (const r of c.routes ?? []) {
      if (!(ROUTE_METHODS as readonly string[]).includes(r?.method)) {
        throw invalid("route", `method ${JSON.stringify(r?.method)} is not one of ${ROUTE_METHODS.join(", ")}`);
      }
      let segments: readonly RouteSegment[];
      try {
        segments = compileRoutePath(r.path);
      } catch (err) {
        throw invalid("route", (err as Error).message);
      }
      if (typeof r.handler !== "function") throw invalid("route", `${r.method} ${r.path} needs a handler`);
      const shadowing = phase1Routes.find((p) => routePathsOverlap(p.segments, segments));
      if (shadowing !== undefined) {
        throw new ContributionConflictError("route", `${r.method} ${r.path} (overlaps ${shadowing.method} ${shadowing.path})`, [PHASE1_OWNER, owner]);
      }
      const other = routeOwners.find((o) => o.method === r.method && routePathsOverlap(o.segments, segments));
      if (other !== undefined) {
        const name = other.path === r.path ? `${r.method} ${r.path}` : `${r.method} ${r.path} (overlaps ${other.path})`;
        throw new ContributionConflictError("route", name, [other.owner, owner]);
      }
      routeOwners.push({ method: r.method, path: r.path, segments, owner });
      // A new object, never the contribution's own: the handler is still called on `r`.
      routes.push({ owner, method: r.method, path: r.path, handler: (req) => r.handler(req) });
    }

    for (const s of c.subcommands ?? []) {
      if (typeof s?.name !== "string" || !SUBCOMMAND_NAME.test(s.name)) {
        throw invalid("subcommand", `name ${JSON.stringify(s?.name)} must be lowercase letters, digits and -`);
      }
      if (typeof s.help !== "string" || s.help.trim() === "" || /[\r\n]/.test(s.help) || s.help.length > 200) {
        throw invalid("subcommand", `${s.name} needs a one-line help (at most 200 characters)`);
      }
      if (typeof s.run !== "function") throw invalid("subcommand", `${s.name} needs a run function`);
      claim(subcommandOwners, "subcommand", s.name, owner);
      subcommands.push(s);
    }

    for (const kind of Object.keys(c.handlers ?? {})) {
      if (!isEventKind(kind)) throw new UnknownEventKindError(owner, kind);
      const handler = (c.handlers as Readonly<Record<string, EventHandler>>)[kind];
      if (typeof handler !== "function") throw invalid("handler", `the ${kind} handler is not a function`);
      claim(handlerOwners, "handler", kind, owner);
      handlers[kind] = handler;
    }

    for (const run of c.dueWork ?? []) {
      if (typeof run !== "function") throw invalid("dueWork", "every due-work entry must be a function");
      dueWork.push({ owner, run });
    }
  }

  return { contributors: [...contributorOwners.keys()], tools, routes, subcommands, handlers: handlers as EventHandlers, dueWork };
}
