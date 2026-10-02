import type { AuthProvider } from "../auth/types.js";
import type { Store } from "../store/store.js";

/**
 * D28's API-key fallback: when the subscription cap is hit, continue on the
 * user's own API key under a hard dollar ceiling the user sets.
 *
 * D28 makes this a per-playbook opt-in, and this is the shape a playbook will
 * carry (phase 3). Phase 1 has no playbooks, so the only instance is the
 * kernel-wide `BudgetConfig.apiKeyFallback` placeholder, off by default. Once
 * playbooks exist the policy is read per playbook and the kernel-wide value is
 * never consulted. Nothing in phase 1 switches provider on it (AC7).
 */
export interface ApiKeyFallbackPolicy {
  readonly enabled: boolean;
  /** The hard spending ceiling in US dollars; `null` means none set, which keeps the fallback inactive. */
  readonly dollarCeilingUsd: number | null;
}

/**
 * The budget policy the user sets (invariant 1: the kernel never invents a
 * limit). Limits are tokens, never dollars (D24); the only dollar figure is
 * the API-key fallback's ceiling, which is spent on the user's own key.
 */
export interface BudgetConfig {
  /**
   * Counted tokens (input + output + cache writes, D26) an agent may use per
   * local calendar day, by agent name. An agent with no entry has no token
   * limit; the subscription cap still applies to it. Read only through
   * own keys (`agentDailyTokenLimit`): an agent named like an
   * `Object.prototype` member (`constructor`, `toString`) has no limit unless
   * one is configured for it.
   */
  readonly agentDailyTokenLimits: Readonly<Record<string, number>>;
  readonly apiKeyFallback: ApiKeyFallbackPolicy;
}

/** A null-prototype record: a key lookup never reaches an `Object.prototype` member. */
function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** No agent limits; the API-key fallback off with no ceiling. */
export const DEFAULT_BUDGET_CONFIG: BudgetConfig = Object.freeze({
  agentDailyTokenLimits: Object.freeze(emptyRecord<number>()),
  apiKeyFallback: Object.freeze({ enabled: false, dollarCeilingUsd: null }),
});

/** A budget config the kernel refuses. The message names the offending field. */
export class BudgetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetConfigError";
  }
}

/**
 * Check a config and return a frozen copy. Limits must be positive safe
 * integers keyed by a non-empty agent name; the ceiling must be `null` or a
 * positive finite number; `enabled` must be a boolean.
 */
export function validateBudgetConfig(config: BudgetConfig): BudgetConfig {
  if (typeof config !== "object" || config === null) throw new BudgetConfigError("budget config must be an object");
  const limits = config.agentDailyTokenLimits as unknown;
  if (typeof limits !== "object" || limits === null || Array.isArray(limits)) {
    throw new BudgetConfigError("agentDailyTokenLimits must be an object of agent name to token limit");
  }
  // Null prototype: an agent named `__proto__` is stored as its own key, never as the prototype.
  const copy = emptyRecord<number>();
  for (const [agent, limit] of Object.entries(limits)) {
    if (agent.trim() === "") throw new BudgetConfigError("agentDailyTokenLimits has an empty agent name");
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0) {
      throw new BudgetConfigError(`agentDailyTokenLimits.${agent} must be a positive integer token count`);
    }
    copy[agent] = limit;
  }
  const fallback = config.apiKeyFallback as unknown;
  if (typeof fallback !== "object" || fallback === null) throw new BudgetConfigError("apiKeyFallback must be an object");
  const { enabled, dollarCeilingUsd } = fallback as Partial<ApiKeyFallbackPolicy>;
  if (typeof enabled !== "boolean") throw new BudgetConfigError("apiKeyFallback.enabled must be a boolean");
  if (
    dollarCeilingUsd !== null &&
    (typeof dollarCeilingUsd !== "number" || !Number.isFinite(dollarCeilingUsd) || dollarCeilingUsd <= 0)
  ) {
    throw new BudgetConfigError("apiKeyFallback.dollarCeilingUsd must be null or a positive finite number");
  }
  return Object.freeze({
    agentDailyTokenLimits: Object.freeze(copy),
    apiKeyFallback: Object.freeze({ enabled, dollarCeilingUsd: dollarCeilingUsd ?? null }),
  });
}

/**
 * The configured daily token limit of `agent`, or `undefined` when it has
 * none. Own keys only: the kernel never reads an inherited member (for
 * example `constructor`) as a limit the user did not set (invariant 1).
 */
export function agentDailyTokenLimit(config: BudgetConfig, agent: string): number | undefined {
  const limits = config.agentDailyTokenLimits;
  return Object.hasOwn(limits, agent) ? limits[agent] : undefined;
}

/** The auth provider's non-secret identity, as the budget module records it. */
export type BudgetAuth = Pick<AuthProvider, "id" | "account">;

export interface BudgetOptions {
  readonly store: Store;
  /**
   * The kernel's one auth provider, the same one the session manager launches
   * with. Its live `account` is the only account identity the budget uses:
   * the cap tracker parks under it and admission checks it (a request naming
   * another account fails closed). The session row's `auth_account` is never
   * read.
   */
  readonly authProvider: BudgetAuth;
  /** Defaults to `DEFAULT_BUDGET_CONFIG`. Validated at construction. */
  readonly config?: BudgetConfig;
}

/** The clock, injectable for tests. */
export interface BudgetDeps {
  /** Defaults to `() => new Date()`. */
  readonly now?: () => Date;
  /** The budget day of an instant, `YYYY-MM-DD`. Defaults to the host's local calendar day. */
  readonly dayOf?: (at: Date) => string;
  /** The first instant of the budget day after `at`'s. Defaults to the host's next local midnight. */
  readonly startOfNextDay?: (at: Date) => Date;
}

/** The per-model figures the meter reads from `result.modelUsage`, normalised. */
export interface UsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  /** Already inside `outputTokens` (sdk.d.ts `ModelUsage`); recorded, never counted twice. */
  readonly thinkingTokens: number;
  /** The SDK's list-price estimate, D24's "≈" figure. */
  readonly costUSD: number;
}
