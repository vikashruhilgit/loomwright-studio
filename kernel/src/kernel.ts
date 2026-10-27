// Composes the kernel daemon (item 08): store, auth, budget, sessions, event
// loop and the loopback API, started in a fixed order and stopped in reverse.
// Mechanism only (invariant 1): the daemon passes no handler of its own and
// nothing is preinstalled; `KernelOptions.handlers` is for other compositions
// (tests). The phase 2 feature contributions (`SHIPPED_CONTRIBUTIONS`, each
// shipping only what its item has built, e.g. the brain's `message` handler)
// are merged once, before the store opens.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readAgentSettings } from "./agents/settings.js";
import type { AgentLimits } from "./agents/settings.js";
import { ensureApiToken } from "./api/token.js";
import { isKillSwitchEngaged } from "./api/kill-switch.js";
import { API_HOST, startApiServer } from "./api/server.js";
import type { ApiServer, ApiServerDeps, ApiServerOptions } from "./api/server.js";
import { API_KEY_PROVIDER_ID } from "./auth/api-key.js";
import { AUTH_PROVIDER_ENV, authProviderFromEnv } from "./auth/provider-env.js";
import { securityCliKeychain, securityCliKeychainWriter } from "./auth/keychain.js";
import type { KeychainReader, KeychainWriter } from "./auth/keychain.js";
import { SUBSCRIPTION_TOKEN_ID, availableProviderIds, selectAuthProvider } from "./auth/registry.js";
import type { AuthProvider, AuthProviderDeps, BaseEnv } from "./auth/types.js";
import { Budget } from "./budget/index.js";
import type { AgentLimitsLookup } from "./budget/index.js";
import { recordSessionOutput } from "./console/output.js";
import { isPaused } from "./console/pause.js";
import { PHASE1_RESERVED, mergeContributions } from "./features/contribution.js";
import type { FeatureContribution, MergedContributions } from "./features/contribution.js";
import { SHIPPED_CONTRIBUTIONS } from "./features/index.js";
import { toolsForConnectors } from "./integrations/tool-filter.js";
import type { ConnectorKind, GitHubClient } from "./integrations/types.js";
import { EventLoop } from "./loop/loop.js";
import type { EventHandlers, EventLoopDeps } from "./loop/types.js";
import { SessionManager } from "./sessions/manager.js";
import type { AdmissionDecision, AdmissionRequest, SessionManagerDeps, SessionManagerOptions } from "./sessions/types.js";
import { Store, resolveDataDir } from "./store/store.js";
import { KERNEL_MCP_SERVER_NAME, approvalApplierOf, assertKernelToolsList, createKernelMcpServer, heldToolCheckOf } from "./tools/server.js";
import { writeFileAtomic } from "./tools/handoff.js";

/** Selects the auth provider when `--auth-provider` is not given. */
export { AUTH_PROVIDER_ENV };

/** `<dataDir>/api.json`: where the API listens. Never holds the token. */
export const API_INFO_FILENAME = "api.json";

/** What `api.json` holds. */
export interface ApiInfo {
  readonly port: number;
  readonly host: typeof API_HOST;
  readonly pid: number;
  readonly started_at: string;
}

export interface KernelOptions {
  /** Defaults to `resolveDataDir(env)` (`STUDIO_DATA_DIR`, else `~/.loomwright-studio`). */
  readonly dataDir?: string;
  /** `--auth-provider <id>`; wins over `STUDIO_AUTH_PROVIDER`. */
  readonly authProviderId?: string;
  /** Read for `STUDIO_DATA_DIR` / `STUDIO_AUTH_PROVIDER`, and the sessions' base env. Defaults to `process.env`. */
  readonly env?: BaseEnv;
  /** The API port. Default 0: OS-assigned. */
  readonly port?: number;
  /** Session-manager settings other than the ones the kernel wires itself. */
  readonly sessions?: Partial<
    Pick<SessionManagerOptions, "loomwrightPath" | "installedPluginsPath" | "stopGraceMs" | "authTimeoutMs" | "resumeBackoffMs">
  >;
  /**
   * The event loop's handlers. Default none: every queued event ends
   * `event_unhandled`. `daemon.ts` never sets it (invariant 1: nothing is
   * preinstalled); a composition that is not the shipped daemon (the crash
   * test's harness, standing in for a playbook) passes its own.
   */
  readonly handlers?: EventHandlers;
  /**
   * The feature contributions to compose. Default `SHIPPED_CONTRIBUTIONS`
   * (each ships only what its item has built, e.g. the brain's `message`
   * handler, `POST /ask`, `GET /messages/:id` and `studio ask`; still no
   * playbook is preinstalled, invariant 1). A collision between two of
   * them, or with a phase 1 tool, route or subcommand or a `handlers` kind, is
   * refused before the store opens.
   */
  readonly contributions?: readonly FeatureContribution[];
}

/** Every side effect of the composition, injectable for tests. */
export interface KernelDeps {
  readonly openStore?: (dataDir: string) => Store;
  readonly availableProviderIds?: () => Promise<string[]>;
  readonly selectAuthProvider?: (id: string, deps: AuthProviderDeps) => Promise<AuthProvider>;
  /** Defaults to the real `/usr/bin/security` reader; used by the auth provider and the API token. */
  readonly keychain?: KeychainReader;
  /** Defaults to the real `security -i` writer (the API token's first start only). */
  readonly keychainWriter?: KeychainWriter;
  readonly randomBytes?: (size: number) => Buffer;
  readonly sessionDeps?: SessionManagerDeps;
  readonly loopDeps?: EventLoopDeps;
  /**
   * The GitHub client a `poll` trigger lists its source through (passed to the
   * loop's due work as `DueWorkContext.github`). Defaults to none: until the
   * real client (phase 6 item 03) is wired here, a due poll records
   * `connector_missing` and never fetches.
   */
  readonly githubClient?: GitHubClient;
  readonly startApiServer?: (options: ApiServerOptions, deps: ApiServerDeps) => Promise<ApiServer>;
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** Defaults to `process.pid`. */
  readonly pid?: number;
}

export interface Kernel {
  readonly dataDir: string;
  readonly store: Store;
  readonly authProvider: AuthProvider;
  readonly sessions: SessionManager;
  readonly loop: EventLoop;
  readonly api: { readonly port: number; readonly host: typeof API_HOST };
  readonly apiInfoPath: string;
  /** What the contributions registered (tools, routes, subcommands, handlers, due work), as merged. */
  readonly contributions: MergedContributions;
  /**
   * Graceful stop (SIGTERM/SIGINT): close the API, stop the loop, stop every
   * session in `shutdown` mode (they end `interrupted`, resumable after the
   * restart), remove `api.json` if it still names this pid, close the store.
   * Every step runs even when an earlier one failed; the first error is
   * rethrown after. Idempotent.
   */
  stop(): Promise<void>;
}

/** The build's default provider: `subscription-token` when this build has it, else `api-key` (D15, D29). */
async function defaultAuthProviderId(available: () => Promise<string[]>): Promise<string> {
  return (await available()).includes(SUBSCRIPTION_TOKEN_ID) ? SUBSCRIPTION_TOKEN_ID : API_KEY_PROVIDER_ID;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** Remove `api.json` only while it names `pid`: a newer kernel's file is never removed. */
function removeApiInfoIfOurs(path: string, pid: number): void {
  let info: unknown;
  try {
    info = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return; // Absent or unreadable: nothing of ours to remove.
  }
  if (typeof info === "object" && info !== null && (info as { pid?: unknown }).pid === pid) rmSync(path, { force: true });
}

/**
 * The session manager's `admission` check, as the kernel wires it: every
 * request goes to the budget's playbook gate (`Budget.checkPlaybook`), with
 * its `playbook` (absent ⇒ `null`). A request that is not a playbook's
 * therefore gets exactly `Budget.check`'s verdict and events; a playbook's
 * `start` at its `token_limit_per_day` is refused `playbook_daily_limit`
 * until the next budget day (once-per-playbook-day `playbook_limit_reached`
 * and `notify` are the gate's).
 *
 * The manager launches every session on its one auth provider, so an admit
 * must name `provider` (the kernel's `authProvider.id`). An admit naming any
 * other provider (the gate's D28 API-key fallback, never reachable while the
 * kernel gives the `Budget` no API-key provider) throws: the manager fails
 * the start or resume closed, launching nothing (invariant 3).
 *
 * With `paused` (the kernel wires `isPaused` over its store, read on every
 * request), a request made while it returns true is refused with reason
 * `paused` and a `null` retryAt before the budget is asked, so the
 * budget writes no `admission_refused` event and no `notify` for it; the
 * loop parks the event under its usual rule (one `event_parked`, no notify).
 */
export function admissionFor(
  budget: Pick<Budget, "checkPlaybook">,
  provider: string,
  paused?: () => boolean,
): (request: AdmissionRequest) => AdmissionDecision {
  return (request) => {
    if (paused?.() === true) return { admitted: false, reason: "paused", retryAt: null };
    const verdict = budget.checkPlaybook({ ...request, playbook: request.playbook ?? null });
    if (!verdict.admitted) return { admitted: false, reason: verdict.reason, retryAt: verdict.retryAt };
    if (verdict.provider !== provider) {
      throw new Error(`admission admitted provider ${verdict.provider}, but sessions launch only on ${provider}: refusing (fail closed)`);
    }
    return { admitted: true };
  };
}

/** The two limits the budget applies, from a parsed `limits` (`delegation_depth` is not the budget's). */
function budgetLimitsOf(limits: AgentLimits | undefined): AgentLimitsLookup {
  return {
    ok: true,
    ...(limits?.tokens_per_day === undefined ? {} : { tokensPerDay: limits.tokens_per_day }),
    ...(limits?.sessions_at_once === undefined ? {} : { sessionsAtOnce: limits.sessions_at_once }),
  };
}

/**
 * The session manager's `connectorsFor`, as the kernel wires it: the
 * connectors the owner granted `agent` in its own settings file
 * (`connectors`), through the one reader, read afresh at every start and
 * resume. Any refusal (missing, invalid or model-less file, an id that names
 * no file) grants none: a session lists fewer tools, never more.
 */
export function connectorsFor(dataDir: string): (agent: string) => readonly ConnectorKind[] {
  return (agent) => {
    const r = readAgentSettings(dataDir, agent);
    return r.ok ? (r.settings.connectors ?? []) : [];
  };
}

/**
 * The budget's `agentLimits` lookup, as the kernel wires it: each agent's
 * `limits.tokens_per_day` and `limits.sessions_at_once` from its own settings
 * file, `<dataDir>/config/agents/<id>.json`, through the one reader
 * (`readAgentSettings`), read afresh at every admission check and metered
 * result, so an edit applies at the agent's next start.
 *
 * - `ok`, or `model_unset` (the file parsed and validated; a missing model is
 *   the session's refusal, never the budget's): the limits the file sets,
 *   each absent one unset.
 * - `settings_missing` / `settings_invalid`: a refusal with that reason
 *   (fail closed: a deleted or broken file is never read as "no limit").
 * - `agent_id_invalid` (a label that fails the crew-id grammar and is not
 *   `wright`): no limits, so no per-agent check applies, as for a `null`
 *   agent. Such a label cannot name a settings file, so it has no limit the
 *   owner could have set (owner decision, 2026-10-18); the cap and a
 *   playbook's own limit still apply.
 *
 * Reading `wright` creates `wright.json` when it is absent (the one reader's
 * rule); a failure to create it throws, which fails the admission closed.
 */
export function agentLimitsFor(dataDir: string): (agent: string) => AgentLimitsLookup {
  return (agent) => {
    const r = readAgentSettings(dataDir, agent);
    if (r.ok) return budgetLimitsOf(r.settings.limits);
    switch (r.error) {
      case "model_unset":
        return budgetLimitsOf(r.limits);
      case "agent_id_invalid":
        return { ok: true };
      case "settings_missing":
        return { ok: false, reason: "settings_missing", file: r.file, message: r.message };
      case "settings_invalid":
        return { ok: false, reason: "settings_invalid", file: r.file, message: r.message };
    }
  };
}

/**
 * Start the kernel, in this order: merge `options.contributions` (default
 * `SHIPPED_CONTRIBUTIONS`; a `ContributionConflictError`,
 * `UnknownEventKindError` or `InvalidContributionError` rejects before any
 * side effect) and build the kernel-applied actions' applier from the merged
 * tools (`approvalApplierOf`; it refuses the same way); list the merged
 * tools through the Agent SDK's MCP server (`assertKernelToolsList`; a tool
 * whose input schema does not serialise, or that the listing omits, refuses
 * the same way, named: the phase 1 tools when they fail to list alone,
 * else the failing contributed ones); open
 * the `Store` (taking its lock); select
 * the auth provider (`--auth-provider`, else `STUDIO_AUTH_PROVIDER`, else the
 * build default); the `Budget` (each agent's limits read from its settings
 * file, `agentLimitsFor`); the `SessionManager` (wired to the budget and
 * given the kernel MCP server per launch); reap orphans left by an earlier
 * kernel; the `EventLoop` with `options.handlers` (none by default) plus the
 * contributed handlers and due work, started only while the kill switch
 * is NOT engaged; the API token (generated on first start); the API server
 * (given the applier, which the approvals decision reads); then
 * `<dataDir>/api.json` (mode 0600, no token).
 *
 * A failure after the store opened undoes what had started, in reverse
 * (API server, loop, sessions in `shutdown` mode, `api.json`, store), then
 * rethrows: nothing is left listening, no `api.json` is left behind and the
 * store lock is released.
 */
export async function startKernel(options: KernelOptions = {}, deps: KernelDeps = {}): Promise<Kernel> {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? resolveDataDir(env);
  const now = deps.now ?? (() => new Date());
  const pid = deps.pid ?? process.pid;
  const startedAt = now();
  const apiInfoPath = join(dataDir, API_INFO_FILENAME);

  // Before the store opens: a deterministically broken composition has no side effect.
  const contributions = mergeContributions(options.contributions ?? SHIPPED_CONTRIBUTIONS, {
    // The same phase 1 lists `runCli` reserves: the CLI warns about exactly what refuses here.
    ...PHASE1_RESERVED,
    handlerKinds: Object.keys(options.handlers ?? {}),
  });
  // Built here too: a tool's applier outside KERNEL_APPLIED_ACTIONS refuses the start before the store opens.
  const approvalApplier = approvalApplierOf(contributions.tools);
  // Every tool's shape must list through the Agent SDK: one that cannot empties every session's tools/list.
  await assertKernelToolsList(contributions.tools);

  const store = (deps.openStore ?? ((dir: string) => new Store({ dataDir: dir })))(dataDir);
  let sessions: SessionManager | undefined;
  let loop: EventLoop | undefined;
  let api: ApiServer | undefined;

  const teardown = async (): Promise<void> => {
    const failures: unknown[] = [];
    const step = async (fn: () => unknown): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        failures.push(err);
      }
    };
    if (api !== undefined) await step(() => (api as ApiServer).close());
    if (loop !== undefined) await step(() => (loop as EventLoop).stop());
    if (sessions !== undefined) await step(() => (sessions as SessionManager).stopAll({ mode: "shutdown" }));
    await step(() => removeApiInfoIfOurs(apiInfoPath, pid));
    await step(() => store.close());
    if (failures.length > 0) throw failures[0];
  };

  try {
    const keychain = deps.keychain ?? securityCliKeychain();
    const providerId =
      nonEmpty(options.authProviderId) ??
      authProviderFromEnv(env) ??
      (await defaultAuthProviderId(deps.availableProviderIds ?? availableProviderIds));
    const authProvider = await (deps.selectAuthProvider ?? selectAuthProvider)(providerId, { keychain, store, now });

    const budget = new Budget({ store, authProvider, agentLimits: agentLimitsFor(dataDir) }, { now });
    const manager = new SessionManager(
      {
        store,
        authProvider,
        baseEnv: env,
        ...options.sessions,
        onMessage: budget.observe,
        // The console's session output log (a no-op until phase 5 item 03 fills it in).
        onOutput: (sessionId, message) => recordSessionOutput(store, sessionId, message),
        // The owner's pause refuses every start and resume first (it never stops a running session).
        admission: admissionFor(budget, authProvider.id, () => isPaused(store)),
        // The owner's connector grants, read afresh at each start and resume; the manager fills `ToolPolicy.connectors` from them.
        connectorsFor: connectorsFor(dataDir),
        // Each session lists only the contributed tools its agent's grants allow (`requiresConnector`): it only narrows.
        mcpServers: ({ sessionId, connectors }) => ({
          [KERNEL_MCP_SERVER_NAME]: createKernelMcpServer({ store, sessions: manager, sessionId, now }, toolsForConnectors(contributions.tools, connectors)),
        }),
        // The gate's pre-hold check, from the same contributed tools the server registers (it can only narrow).
        heldToolCheck: heldToolCheckOf(contributions.tools, (sessionId) => ({ store, sessions: manager, sessionId, now })),
      },
      { now, ...deps.sessionDeps },
    );
    sessions = manager;
    await manager.reapOrphans();

    // The daemon passes no handler of its own (invariant 1): a queued event is
    // `event_unhandled` unless a contribution handles its kind (the brain
    // contribution handles `message`). Handlers get the manager as `ctx.sessions`.
    // The due work's Loomwright settings are the session manager's own, so the
    // version watcher, sessions and `/status` resolve the same install.
    const eventLoop = new EventLoop(
      {
        store,
        handlers: { ...options.handlers, ...contributions.handlers },
        dueWork: contributions.dueWork,
        sessions: manager,
        loomwright: { configured: options.sessions?.loomwrightPath, installedPluginsPath: options.sessions?.installedPluginsPath },
        ...(deps.githubClient === undefined ? {} : { github: deps.githubClient }),
      },
      { now, ...deps.loopDeps },
    );
    loop = eventLoop;
    if (!isKillSwitchEngaged(store)) eventLoop.start();

    const token = ensureApiToken(keychain, deps.keychainWriter ?? securityCliKeychainWriter(), deps.randomBytes);
    const server = await (deps.startApiServer ?? startApiServer)(
      {
        store,
        sessions: manager,
        // The whole manager, for contributed routes (`ContributedRouteRequest.sessions`).
        sessionManager: manager,
        loop: eventLoop,
        authProviders: [authProvider],
        token,
        routes: contributions.routes,
        approvalApplier,
        ...(options.port === undefined ? {} : { port: options.port }),
      },
      { now, startedAt, pid },
    );
    api = server;

    const info: ApiInfo = { port: server.port, host: API_HOST, pid, started_at: startedAt.toISOString() };
    writeFileAtomic(apiInfoPath, `${JSON.stringify(info, null, 2)}\n`);

    let stopping: Promise<void> | undefined;
    return {
      dataDir,
      store,
      authProvider,
      sessions: manager,
      loop: eventLoop,
      api: { port: server.port, host: API_HOST },
      apiInfoPath,
      contributions,
      stop: () => (stopping ??= teardown()),
    };
  } catch (err) {
    try {
      await teardown();
    } catch {
      // The start failure is the one to report; teardown ran every step it could.
    }
    throw err;
  }
}
