// Composes the kernel daemon (item 08): store, auth, budget, sessions, event
// loop and the loopback API, started in a fixed order and stopped in reverse.
// Mechanism only (invariant 1): the daemon passes no handler, nothing is
// preinstalled; `KernelOptions.handlers` is for other compositions (tests).
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ensureApiToken } from "./api/token.js";
import { isKillSwitchEngaged } from "./api/kill-switch.js";
import { API_HOST, startApiServer } from "./api/server.js";
import type { ApiServer, ApiServerDeps, ApiServerOptions } from "./api/server.js";
import { API_KEY_PROVIDER_ID } from "./auth/api-key.js";
import { securityCliKeychain, securityCliKeychainWriter } from "./auth/keychain.js";
import type { KeychainReader, KeychainWriter } from "./auth/keychain.js";
import { SUBSCRIPTION_TOKEN_ID, availableProviderIds, selectAuthProvider } from "./auth/registry.js";
import type { AuthProvider, AuthProviderDeps, BaseEnv } from "./auth/types.js";
import { Budget } from "./budget/index.js";
import { EventLoop } from "./loop/loop.js";
import type { EventHandlers, EventLoopDeps } from "./loop/types.js";
import { SessionManager } from "./sessions/manager.js";
import type { SessionManagerDeps, SessionManagerOptions } from "./sessions/types.js";
import { Store, resolveDataDir } from "./store/store.js";
import { KERNEL_MCP_SERVER_NAME, createKernelMcpServer } from "./tools/server.js";
import { writeFileAtomic } from "./tools/handoff.js";

/** Selects the auth provider when `--auth-provider` is not given. */
export const AUTH_PROVIDER_ENV = "STUDIO_AUTH_PROVIDER";

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
    Pick<SessionManagerOptions, "loomwrightPath" | "pluginCacheRoot" | "stopGraceMs" | "authTimeoutMs" | "resumeBackoffMs">
  >;
  /**
   * The event loop's handlers. Default none: every queued event ends
   * `event_unhandled`. `daemon.ts` never sets it (invariant 1: nothing is
   * preinstalled); a composition that is not the shipped daemon (the crash
   * test's harness, standing in for a playbook) passes its own.
   */
  readonly handlers?: EventHandlers;
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
 * Start the kernel, in this order: open the `Store` (taking its lock); select
 * the auth provider (`--auth-provider`, else `STUDIO_AUTH_PROVIDER`, else the
 * build default); the `Budget`; the `SessionManager` (wired to the budget and
 * given the kernel MCP server per launch); reap orphans left by an earlier
 * kernel; the `EventLoop` with `options.handlers` (none by default), started only while the kill switch
 * is NOT engaged; the API token (generated on first start); the API server;
 * then `<dataDir>/api.json` (mode 0600, no token).
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
      nonEmpty(env[AUTH_PROVIDER_ENV]) ??
      (await defaultAuthProviderId(deps.availableProviderIds ?? availableProviderIds));
    const authProvider = await (deps.selectAuthProvider ?? selectAuthProvider)(providerId, { keychain, store, now });

    const budget = new Budget({ store, authProvider }, { now });
    const manager = new SessionManager(
      {
        store,
        authProvider,
        baseEnv: env,
        ...options.sessions,
        onMessage: budget.observe,
        admission: budget.check,
        mcpServers: ({ sessionId }) => ({
          [KERNEL_MCP_SERVER_NAME]: createKernelMcpServer({ store, sessions: manager, sessionId, now }),
        }),
      },
      { now, ...deps.sessionDeps },
    );
    sessions = manager;
    await manager.reapOrphans();

    // The daemon passes no handler (invariant 1): every queued event is `event_unhandled`.
    const eventLoop = new EventLoop({ store, handlers: options.handlers ?? {} }, { now, ...deps.loopDeps });
    loop = eventLoop;
    if (!isKillSwitchEngaged(store)) eventLoop.start();

    const token = ensureApiToken(keychain, deps.keychainWriter ?? securityCliKeychainWriter(), deps.randomBytes);
    const server = await (deps.startApiServer ?? startApiServer)(
      { store, sessions: manager, loop: eventLoop, authProviders: [authProvider], token, ...(options.port === undefined ? {} : { port: options.port }) },
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
