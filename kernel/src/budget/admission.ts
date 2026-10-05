import type { AdmissionDecision, AdmissionRequest } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { activeParks, agentCountedTokens, appendEvent, clockOf, noteAgentLimitReached } from "./internal.js";
import type { Clock } from "./internal.js";
import { DEFAULT_BUDGET_CONFIG, agentDailyTokenLimit, validateBudgetConfig } from "./types.js";
import type { BudgetAuth, BudgetConfig, BudgetDeps, BudgetOptions } from "./types.js";

/**
 * Whether D28's API-key fallback would be in force: enabled AND a positive
 * dollar ceiling set. Off under `DEFAULT_BUDGET_CONFIG`. Phase 1 has no
 * playbooks and nothing switches provider on this (AC7); once playbooks exist
 * it is read from the playbook's own policy.
 */
export function apiKeyFallbackActive(config: BudgetConfig): boolean {
  const { enabled, dollarCeilingUsd } = config.apiKeyFallback;
  return enabled && dollarCeilingUsd !== null && dollarCeilingUsd > 0;
}

/**
 * The budget and cap gate the session manager asks before every start and
 * resume (its `admission` option). Fails closed: a store error propagates and
 * the manager refuses the request with it.
 *
 * - Cap (AC4, AC6): any unexpired park of the provider (`cap_state`
 *   `rejected` with `resets_at` null or ahead) refuses starts and resumes
 *   alike; `retryAt` is the latest `resets_at`, or `null` when one is unknown.
 *   Parks are keyed on the auth provider's stable `id`, the key the cap
 *   tracker parks under too; its account label is display text and is never
 *   compared, so a relabel neither lifts a park nor refuses a request. A
 *   request naming another provider means the manager and the budget hold
 *   different providers (a wiring error): the check throws, so the request
 *   fails closed. The park ends only when this check admits; a `cap_*`
 *   wake-up firing is never a release.
 * - Agent limit (AC2): an agent whose counted tokens for today reached its
 *   configured limit is refused new sessions (`start` only: a resume
 *   continues existing work); `retryAt` is the start of the next budget day.
 *   A `null` agent, or one with no configured limit, skips this check.
 *   Policy carve-out: a resume of an interrupted session is never refused by
 *   the agent limit (the cap above still refuses it), so the limit does not
 *   bound the tokens a resumed session spends the same day.
 *
 * Every refusal appends one `admission_refused` event (agent, account label,
 * provider id, task, reason, retryAt): the durable "parked" record the event loop (item 07)
 * re-dispatches from. Its `notify` is shared with the meter's and the cap
 * tracker's: once per agent-day, once per cap window. There is one auth
 * provider, so a refusal never selects another (no rotation, AC8) and never
 * switches to an API key (AC7).
 */
export class BudgetAdmission {
  readonly #store: Store;
  readonly #auth: BudgetAuth;
  readonly #config: BudgetConfig;
  readonly #clock: Clock;

  constructor(options: BudgetOptions, deps: BudgetDeps = {}) {
    this.#store = options.store;
    this.#auth = options.authProvider;
    this.#config = validateBudgetConfig(options.config ?? DEFAULT_BUDGET_CONFIG);
    this.#clock = clockOf(deps);
  }

  check(request: AdmissionRequest): AdmissionDecision {
    const now = this.#clock.now();
    const at = now.toISOString();
    return this.#store.transaction((): AdmissionDecision => {
      const ref = { sessionId: null, taskId: request.task };

      // One key: the provider's stable id, as the cap tracker keys parks. The label is never compared.
      const provider = this.#auth.id;
      if (request.provider !== provider) {
        throw new Error(
          `admission asked for provider ${request.provider} but the budget's auth provider is ${provider}: refusing (fail closed)`,
        );
      }
      const parks = activeParks(this.#store, provider, at);
      if (parks.length > 0) {
        const retryAt = parks.some((p) => p.resets_at === null)
          ? null
          : parks.map((p) => p.resets_at as string).reduce((a, b) => (b > a ? b : a));
        // The cap's notify went out when the account was parked (once per window).
        return this.#refuse(request, "cap_parked", retryAt, { rate_limit_types: parks.map((p) => p.rate_limit_type) }, at);
      }

      // Agent limit gates starts only; a resume is admitted past it (see the class doc).
      if (request.kind === "start" && request.agent !== null) {
        const limit = agentDailyTokenLimit(this.#config, request.agent);
        if (limit !== undefined) {
          const day = this.#clock.dayOf(now);
          const counted = agentCountedTokens(this.#store, request.agent, day);
          if (counted >= limit) {
            const retryAt = this.#clock.startOfNextDay(now).toISOString();
            noteAgentLimitReached(
              this.#store,
              this.#auth,
              { agent: request.agent, day, countedTokens: counted, limit, retryAt, ref },
              at,
            );
            return this.#refuse(request, "agent_daily_limit", retryAt, { day, counted_tokens: counted, limit }, at);
          }
        }
      }
      return { admitted: true };
    });
  }

  #refuse(
    request: AdmissionRequest,
    reason: "cap_parked" | "agent_daily_limit",
    retryAt: string | null,
    details: Record<string, unknown>,
    at: string,
  ): AdmissionDecision {
    appendEvent(
      this.#store,
      "admission_refused",
      { sessionId: null, taskId: request.task },
      {
        kind: request.kind,
        agent: request.agent,
        account: request.account,
        provider: request.provider,
        task: request.task,
        reason,
        retry_at: retryAt,
        ...details,
      },
      at,
    );
    return { admitted: false, reason, retryAt };
  }
}
