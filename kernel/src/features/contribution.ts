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
import type { KillSwitchState } from "../api/kill-switch.js";
import type { AuthHealth } from "../auth/types.js";
import type { LoomwrightAdapterStatus } from "../loomwright/active-install.js";
import type { AppliedApproval, ApprovalApplier, ApprovalApplyOutcome } from "../approvals/store.js";
// Type-only: `integrations/types.ts` holds the connector kinds, and a value
// import would make a runtime cycle through the feature registry.
import type { ConnectorKind } from "../integrations/types.js";
import { EVENT_KINDS, isEventKind } from "../loop/types.js";
import type { DueWork, DueWorkContext, EventHandler, EventHandlers } from "../loop/types.js";
import type { SessionManager } from "../sessions/manager.js";
import type { HeldToolVerdict, SessionHandle, SessionRow, SessionStatus, StartSessionParams } from "../sessions/types.js";
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

/**
 * The only paths a route may serve without the API token: the GitHub App
 * connect flow's three browser routes (GitHub's returns can't carry the
 * token). A route declares `unauthenticated: true` only for a `GET` on exactly
 * one of these; `mergeContributions` refuses anything else, and the API server
 * checks the list itself too. Frozen, and never extended at runtime.
 */
export const UNAUTHENTICATED_ROUTE_PATHS: readonly string[] = Object.freeze([
  "/connectors/github/app/start",
  "/connectors/github/app/return",
  "/connectors/github/app/installed",
]);

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
    /**
     * Start a session through the kernel's session manager (phase 3 item 07:
     * a playbook's dry run). Optional: a composition without a session
     * manager gives none, and a tool that needs it refuses with an error
     * result naming that.
     */
    startSession?(params: StartSessionParams): Promise<SessionHandle>;
  };
  /** The `sessions` row this server instance serves. */
  readonly sessionId: number;
  readonly now: () => Date;
  /**
   * The kernel's GitHub client (`KernelDeps.githubClient`), the same one the
   * loop's due work gets (`DueWorkContext.github`). Optional: absent when the
   * composition wires none (the daemon passes none yet), and a tool that needs
   * it (a poll playbook's dry run) reports that rather than guessing. A
   * type-only inline import, so this file's one import from the integrations
   * feature stays `ConnectorKind` (pinned by `integrations-foundation.test.ts`).
   */
  readonly github?: import("../integrations/types.js").GitHubClient;
  /** The work-step key of a call: `<tool>:session-<sessionId>:<idempotencyKey>` (the `kernelStepKey` shape). */
  stepKey(idempotencyKey: string): string;
}

/**
 * A tool on the kernel MCP server. `name` must start with `kernel_`. The
 * server validates arguments against `shape` (zod) before `handler` runs: bad
 * arguments are an `isError` result. The handler's value is returned as JSON
 * text; a throw is an `isError` result with its message, never a throw
 * through the SDK. Tool input is untrusted data (invariant 3).
 *
 * `beforeHold` (optional) is consulted only for a tool in the fixed
 * `ALWAYS_HELD_TOOLS` set, by the kernel's gate before it holds the call for
 * the owner (`SessionManagerOptions.heldToolCheck`), with the arguments
 * already parsed against `shape`. Synchronous, and it reads the store only.
 * It can only narrow: `{refuse}` denies the call (`held_refused`), `{display,
 * subjectVersion?}` holds it with that text for the owner. A throw denies the
 * call (`kernel_gate_error`).
 *
 * `applyOnApproval` (optional) is allowed only for a tool whose full name is
 * in the fixed `KERNEL_APPLIED_ACTIONS` set (`approvalApplierOf` refuses the
 * composition otherwise). When the owner approves a held call to it `once`,
 * the kernel runs it inside the decision's transaction, with the held input
 * parsed against `shape` and the approval it runs on, instead of leaving the
 * call for the agent to repeat. Synchronous. It answers `{applied, after?}`
 * (a sentence for the agent; `after` runs once the decision committed) or
 * `{refused, text}`; a throw rolls back its writes and is recorded as
 * `apply_error`.
 *
 * `requiresConnector` (optional) offers the tool only to sessions of an agent
 * granted that connector (`connectors` in its enforced settings): the kernel
 * MCP server a session gets lists it only then (`toolsForConnectors`,
 * `src/integrations/tool-filter.ts`). Absent: every session gets it.
 */
export interface ContributedTool<S extends z.ZodRawShape = z.ZodRawShape> {
  readonly name: string;
  readonly description: string;
  readonly shape: S;
  readonly requiresConnector?: ConnectorKind;
  handler(args: z.infer<z.ZodObject<S>>, ctx: ContributedToolContext): unknown;
  beforeHold?(args: z.infer<z.ZodObject<S>>, ctx: ContributedToolContext): HeldToolVerdict;
  applyOnApproval?(args: z.infer<z.ZodObject<S>>, ctx: { readonly store: Store; readonly now: () => Date; readonly approval: AppliedApproval }): ApprovalApplyOutcome;
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
 * (`undefined` when empty); `store` and `now` are the kernel's (contributions
 * are merged before the store opens, so a route reads its tables through these).
 */
export interface ContributedRouteRequest {
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly store: Store;
  /** The kernel's clock. */
  readonly now: () => Date;
  /**
   * The kernel's session manager, when the API server was given one
   * (`ApiServerOptions.sessionManager`; `startKernel` always gives it).
   * `undefined` in a composition without one: a route that needs it answers
   * an error naming that, never a throw. Optional in the type so a request
   * literal built without it (a test calling a handler directly) still typechecks.
   */
  readonly sessions?: SessionManager;
  /**
   * A read-only view of the kill switch (`killSwitchState` over the API
   * server's store, read fresh on every call). The API server always sets it;
   * engaging or releasing the switch stays phase 1's (`POST /stop-all`,
   * `POST /resume`). Optional in the type for the same reason as `sessions`.
   */
  readonly killSwitch?: KillSwitchView;
  /**
   * A read-only view of what `GET /status` reports about the auth providers
   * and the Loomwright adapter, built from `/status`'s own helpers. The API
   * server always sets it; it exposes reads only, never a provider object or a
   * credential. Optional in the type for the same reason as `sessions`.
   */
  readonly status?: StatusView;
  /**
   * The API server's one POST queue (phase 1's `POST /stop-all`, `POST
   * /resume` and `POST /sessions/:id/abandon` run on it): `fn` runs once every
   * POST queued before it has finished, and the promise settles with `fn`'s.
   * The API server always sets it. Only a route that makes a short, bounded
   * change to session or kill-switch state runs that change through it,
   * because whatever is queued delays the kill switch: never queue slow or
   * unbounded work on it (a wait for a grace or a deadline included), and
   * never call it from work it is already running (that waits for itself).
   * The console's stop and kill of one session queue only their acceptance
   * (the checks, the event, the start of the stop) and await the stop's
   * grace and kills after the queued work has returned.
   * Optional in the type for the same reason as `sessions`.
   */
  readonly serialized?: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * The kernel-applied actions' applier (`approvalApplierOf` over the merged
   * tools), when the composition built one. Only the approvals decision reads it.
   */
  readonly approvalApplier?: ApprovalApplier;
  /**
   * The API server's own bound loopback origin (`http://127.0.0.1:<port>`),
   * read from its `address()`, never from the request's `Host` header (which a
   * caller controls). The API server always sets it; a route that builds an
   * address GitHub returns to answers a typed error when it is missing, never a
   * throw. Optional in the type for the same reason as `sessions`.
   */
  readonly origin?: string;
}

/** A contributed route's read-only view of the kill switch: it can read the state, never change it. */
export interface KillSwitchView {
  /** The switch's state now, read from the `events` log on every call. */
  state(): KillSwitchState;
}

/** One auth provider as `/status` reports it: its id, account label and health, never a credential. */
export interface StatusViewAuth {
  readonly id: string;
  readonly account: string | null;
  readonly health: AuthHealth;
}

/**
 * A contributed route's read-only view of `/status`'s auth and Loomwright
 * entries. A provider's `health()` stays the only Keychain read: this view adds
 * no second path to a credential.
 */
export interface StatusView {
  /** Each provider's `{id, account, health}` at `at`, exactly as `/status` reports it (a throwing provider is an `error` health, never a throw). */
  auth(at: Date): readonly StatusViewAuth[];
  /** The Loomwright adapter's state, or `undefined` when the composition has no reader (never a throw). */
  loomwright(): LoomwrightAdapterStatus | undefined;
}

/**
 * A browser answer, the non-JSON form of a route's response: a fixed HTML page
 * (`text/html; charset=utf-8`) or a redirect to an absolute `http(s)` address.
 * Both are sent with `Cache-Control: no-store` and `Referrer-Policy:
 * no-referrer` (a `state` is in the URL). Only an unauthenticated route
 * (`ContributedRoute.unauthenticated`) may answer it.
 */
export type ContributedBrowserAnswer = { readonly html: string } | { readonly redirect: string };

/**
 * A contributed route's answer, sent with a JSON body: `status` must be an
 * integer 200-599 other than 204/205/304 (statuses that have no body), or the
 * API answers 500 instead. With `browser` set (an unauthenticated route only;
 * from a token-gated route it is the same 500), `body` is ignored and the
 * answer is the page, or a redirect, which must carry `status` 302; write
 * `body: null` beside it.
 */
export interface ContributedRouteResponse {
  readonly status: number;
  readonly body: unknown;
  readonly browser?: ContributedBrowserAnswer;
}

/**
 * An API route, reached with the bearer token unless it is `unauthenticated`.
 * `path` is exact (`/approvals`) or a pattern whose `:name` segments are
 * captured into `params` (`/approvals/:id`).
 */
export interface ContributedRoute {
  readonly method: RouteMethod;
  readonly path: string;
  /**
   * Served without the token (a browser return from GitHub). Only a `GET` on
   * exactly one of `UNAUTHENTICATED_ROUTE_PATHS` may declare it, or
   * `mergeContributions` refuses. Its request never carries a body.
   */
  readonly unauthenticated?: true;
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
 *   route path or method, an `unauthenticated` route that is not a `GET` on
 *   one of `UNAUTHENTICATED_ROUTE_PATHS`, a subcommand name or help that is not one short
 *   line, a part that is not a function (a tool's `beforeHold` and
 *   `applyOnApproval` included, when given), a part list that is not a list).
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
      if (t.beforeHold !== undefined && typeof t.beforeHold !== "function") throw invalid("tool", `${t.name}'s beforeHold must be a function`);
      if (t.applyOnApproval !== undefined && typeof t.applyOnApproval !== "function") throw invalid("tool", `${t.name}'s applyOnApproval must be a function`);
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
      if (r.unauthenticated !== undefined) {
        if (r.unauthenticated !== true) throw invalid("route", `${r.method} ${r.path}: unauthenticated must be true when given`);
        if (r.method !== "GET") throw invalid("route", `${r.method} ${r.path} cannot be unauthenticated: only a GET may be served without the token`);
        if (!UNAUTHENTICATED_ROUTE_PATHS.includes(r.path)) {
          throw invalid("route", `${r.method} ${r.path} cannot be unauthenticated: its path is not one of ${UNAUTHENTICATED_ROUTE_PATHS.join(", ")}`);
        }
      }
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
      // The flag is carried explicitly: this copy drops every field it does not name.
      routes.push({
        owner,
        method: r.method,
        path: r.path,
        ...(r.unauthenticated === true ? { unauthenticated: true as const } : {}),
        handler: (req) => r.handler(req),
      });
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
