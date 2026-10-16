// The playbook side of the budget layer (phase 3): the per-playbook admission
// gate with D28's API-key fallback decision, and the per-playbook usage read.
import type { AdmissionRequest } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { BudgetAdmission } from "./admission.js";
import {
  activeParks,
  agentCountedTokens,
  appendEvent,
  clockOf,
  noteAgentLimitReached,
  notePlaybookLimitReached,
  playbookCountedTokens,
  playbookKey,
  playbookTokenLimit,
} from "./internal.js";
import type { Clock } from "./internal.js";
import { BudgetConfigError, DEFAULT_BUDGET_CONFIG, agentDailyTokenLimit, validateApiKeyFallbackPolicy, validateBudgetConfig } from "./types.js";
import type { ApiKeyFallbackPolicy, BudgetAuth, BudgetConfig, BudgetDeps, BudgetOptions } from "./types.js";

/** An admission request that names the playbook it runs for, or `null` for none. */
export interface PlaybookAdmissionRequest extends AdmissionRequest {
  /** `playbooks.id`, or `null` for a session that is not a playbook's. */
  readonly playbook: number | null;
}

/** Why the playbook gate refused: `BudgetAdmission`'s two reasons, or the playbook's own daily limit. */
export type PlaybookRefusalReason = "cap_parked" | "agent_daily_limit" | "playbook_daily_limit";

/**
 * The playbook gate's verdict. An admit names the provider the session runs
 * on (by stable id): the subscription provider, or the API-key provider when
 * the playbook's D28 fallback admitted it at the cap. A refusal carries when
 * to try again (ISO-8601), or `null` when the reset time is unknown.
 */
export type PlaybookAdmissionDecision =
  | { readonly admitted: true; readonly provider: string }
  | { readonly admitted: false; readonly reason: PlaybookRefusalReason; readonly retryAt: string | null };

/** No fallback: what a missing, unparseable or invalid stored policy reads as. */
const FALLBACK_OFF: ApiKeyFallbackPolicy = Object.freeze({ enabled: false, dollarCeilingUsd: null });

/**
 * A playbook's stored `api_key_fallback_json`, checked with the rules
 * `validateBudgetConfig` applies to the kernel-wide placeholder. NULL,
 * unparseable JSON or an invalid policy read as off: a damaged policy fails
 * toward waiting for the reset, never toward spending.
 */
export function parseApiKeyFallbackPolicy(json: string | null): ApiKeyFallbackPolicy {
  if (json === null) return FALLBACK_OFF;
  try {
    return validateApiKeyFallbackPolicy(JSON.parse(json));
  } catch {
    return FALLBACK_OFF;
  }
}

/** Whether a policy opts in: enabled AND a positive dollar ceiling set (D28). */
function fallbackOptedIn(policy: ApiKeyFallbackPolicy): policy is ApiKeyFallbackPolicy & { dollarCeilingUsd: number } {
  return policy.enabled && policy.dollarCeilingUsd !== null && policy.dollarCeilingUsd > 0;
}

/**
 * The dollars the fallback ceiling is compared with: the SDK's `cost_usd`
 * estimate summed over ALL of the playbook's `budget` rows, all time. No row
 * records which provider a session ran on (`sessions.auth_account` is a
 * display label and is never read), so subscription sessions' list-price
 * estimates are counted too. That can only overcount, so the ceiling is
 * reached early, never late. Both choices (what counts, and that it never
 * resets) are open owner decisions, see `docs/architecture/budget.md`.
 */
export function playbookApiKeySpendUsd(store: Store, id: number): number {
  return (
    store
      .prepare<[string], number>("SELECT COALESCE(SUM(cost_usd), 0) FROM budget WHERE playbook = ?")
      .pluck()
      .get(playbookKey(id)) ?? 0
  );
}

interface PlaybookRow {
  readonly id: number;
  readonly slug: string;
  readonly token_limit_per_day: unknown;
  readonly api_key_fallback_json: string | null;
}

/** One playbook's metered usage on a budget day. */
export interface PlaybookTokensToday {
  readonly playbook: number;
  readonly slug: string;
  /** Counted tokens (input + output + cache writes, D26) on the day. */
  readonly countedTokens: number;
  /** Its `token_limit_per_day`, or `null` when unset. */
  readonly tokenLimitPerDay: number | null;
}

/**
 * One entry per playbook whose sessions recorded usage on `day`, by playbook
 * id: its slug, counted tokens and daily limit (`null` when unset, or when
 * the stored value is damaged). A `budget.playbook` that names no existing
 * playbook is left out.
 */
export function playbookTokensToday(store: Store, day: string): PlaybookTokensToday[] {
  return store
    .prepare<[string], { id: number; slug: string; counted: number; token_limit_per_day: unknown }>(
      `SELECT p.id AS id, p.slug AS slug, SUM(b.counted_tokens) AS counted, p.token_limit_per_day AS token_limit_per_day
         FROM budget b JOIN playbooks p ON b.playbook = CAST(p.id AS TEXT)
        WHERE b.day = ?
        GROUP BY p.id
        ORDER BY p.id`,
    )
    .all(day)
    .map((r) => ({
      playbook: r.id,
      slug: r.slug,
      countedTokens: r.counted,
      tokenLimitPerDay: playbookTokenLimit(r.token_limit_per_day) ?? null,
    }));
}

/**
 * The admission gate for a playbook's sessions (phase 3): the playbook's own
 * daily token limit and its D28 API-key fallback, around `BudgetAdmission`'s
 * cap and agent checks. A budget-module mechanism only: the session manager
 * does not call it yet and launches every session on its one provider, so an
 * API-key admit is a decision its caller must act on.
 *
 * - `playbook: null`: exactly `BudgetAdmission.check`'s verdict and events,
 *   an admit naming the subscription provider. The kernel-wide
 *   `apiKeyFallback` placeholder never switches provider, here or there.
 * - Otherwise, in one transaction: the provider check (a request naming
 *   another provider throws, fail closed, as `check` does); an unknown
 *   playbook id or a damaged stored limit throws (fail closed); a `start`
 *   with the playbook's counted tokens today at its `token_limit_per_day` is
 *   refused `playbook_daily_limit` until the next budget day, recorded once
 *   per playbook-day (`playbook_limit_reached` and one `notify`, shared with
 *   the meter); at the cap, the playbook is eligible for the API-key
 *   provider only when its own policy opts in (enabled, positive ceiling), an
 *   API-key provider was given, and its spend (`playbookApiKeySpendUsd`) is
 *   below the ceiling, else it is refused `cap_parked` as `check` refuses;
 *   then the agent limit as `check` applies it (`start` only), so a fallback
 *   never skips it. Only then is it admitted, on the API-key provider if it
 *   was eligible (one `api_key_fallback_admitted` event), else on the
 *   subscription provider. The kernel-wide `apiKeyFallback` is never read.
 *
 * Every refusal appends one `admission_refused` event: `check`'s payload plus
 * the playbook id (and, for `cap_parked`, why the fallback did not apply).
 */
export class PlaybookAdmission {
  readonly #store: Store;
  readonly #auth: BudgetAuth;
  readonly #apiKey: BudgetAuth | undefined;
  readonly #config: BudgetConfig;
  readonly #clock: Clock;
  readonly #admission: BudgetAdmission;

  /** `admission` is the gate a `playbook: null` request is passed to; one is built from `options` when absent. */
  constructor(options: BudgetOptions, deps: BudgetDeps = {}, admission?: BudgetAdmission) {
    this.#store = options.store;
    this.#auth = options.authProvider;
    this.#apiKey = options.apiKeyProvider;
    if (this.#apiKey !== undefined && this.#apiKey.id === this.#auth.id) {
      throw new BudgetConfigError("apiKeyProvider must not share the auth provider's id");
    }
    this.#config = validateBudgetConfig(options.config ?? DEFAULT_BUDGET_CONFIG);
    this.#clock = clockOf(deps);
    this.#admission = admission ?? new BudgetAdmission(options, deps);
  }

  check(request: PlaybookAdmissionRequest): PlaybookAdmissionDecision {
    const { playbook, ...plain } = request;
    if (playbook === null) {
      const verdict = this.#admission.check(plain);
      return verdict.admitted ? { admitted: true, provider: this.#auth.id } : verdict;
    }

    const now = this.#clock.now();
    const at = now.toISOString();
    return this.#store.transaction((): PlaybookAdmissionDecision => {
      const ref = { sessionId: null, taskId: request.task };
      const provider = this.#auth.id;
      if (request.provider !== provider) {
        throw new Error(
          `admission asked for provider ${request.provider} but the budget's auth provider is ${provider}: refusing (fail closed)`,
        );
      }
      const row = this.#store
        .prepare<[number], PlaybookRow>(
          "SELECT id, slug, token_limit_per_day, api_key_fallback_json FROM playbooks WHERE id = ?",
        )
        .get(playbook);
      if (row === undefined) throw new Error(`admission asked for unknown playbook ${playbook}: refusing (fail closed)`);
      const limit = playbookTokenLimit(row.token_limit_per_day);
      if (limit === undefined) {
        throw new Error(`playbook ${playbook} has a damaged token_limit_per_day: refusing (fail closed)`);
      }
      const day = this.#clock.dayOf(now);

      // The playbook's limit gates starts only, as the agent limit does.
      if (request.kind === "start" && limit !== null) {
        const counted = playbookCountedTokens(this.#store, playbook, day);
        if (counted >= limit) {
          const retryAt = this.#clock.startOfNextDay(now).toISOString();
          notePlaybookLimitReached(
            this.#store,
            this.#auth,
            { playbook, slug: row.slug, day, countedTokens: counted, limit, retryAt, ref },
            at,
          );
          return this.#refuse(request, "playbook_daily_limit", retryAt, { day, counted_tokens: counted, limit }, at);
        }
      }

      let fallback: { readonly spendUsd: number; readonly ceilingUsd: number } | null = null;
      const parks = activeParks(this.#store, provider, at);
      if (parks.length > 0) {
        const policy = parseApiKeyFallbackPolicy(row.api_key_fallback_json);
        const spendUsd = playbookApiKeySpendUsd(this.#store, playbook);
        let refusal: string | null = null;
        if (!fallbackOptedIn(policy)) refusal = "not_opted_in";
        else if (this.#apiKey === undefined) refusal = "no_api_key_provider";
        else if (!(spendUsd < policy.dollarCeilingUsd)) refusal = "ceiling_reached";
        else fallback = { spendUsd, ceilingUsd: policy.dollarCeilingUsd };
        if (refusal !== null) {
          const retryAt = parks.some((p) => p.resets_at === null)
            ? null
            : parks.map((p) => p.resets_at as string).reduce((a, b) => (b > a ? b : a));
          return this.#refuse(
            request,
            "cap_parked",
            retryAt,
            { rate_limit_types: parks.map((p) => p.rate_limit_type), api_key_fallback: refusal },
            at,
          );
        }
      }

      // The agent limit as `check` applies it: an API-key admit never skips it.
      if (request.kind === "start" && request.agent !== null) {
        const agentLimit = agentDailyTokenLimit(this.#config, request.agent);
        if (agentLimit !== undefined) {
          const counted = agentCountedTokens(this.#store, request.agent, day);
          if (counted >= agentLimit) {
            const retryAt = this.#clock.startOfNextDay(now).toISOString();
            noteAgentLimitReached(
              this.#store,
              this.#auth,
              { agent: request.agent, day, countedTokens: counted, limit: agentLimit, retryAt, ref },
              at,
            );
            return this.#refuse(request, "agent_daily_limit", retryAt, { day, counted_tokens: counted, limit: agentLimit }, at);
          }
        }
      }

      if (fallback !== null && this.#apiKey !== undefined) {
        appendEvent(
          this.#store,
          "api_key_fallback_admitted",
          ref,
          {
            kind: request.kind,
            agent: request.agent,
            playbook,
            provider: this.#apiKey.id,
            account: this.#apiKey.account,
            task: request.task,
            spend_usd: fallback.spendUsd,
            ceiling_usd: fallback.ceilingUsd,
          },
          at,
        );
        return { admitted: true, provider: this.#apiKey.id };
      }
      return { admitted: true, provider };
    });
  }

  #refuse(
    request: PlaybookAdmissionRequest,
    reason: PlaybookRefusalReason,
    retryAt: string | null,
    details: Record<string, unknown>,
    at: string,
  ): PlaybookAdmissionDecision {
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
        playbook: request.playbook,
        reason,
        retry_at: retryAt,
        ...details,
      },
      at,
    );
    return { admitted: false, reason, retryAt };
  }
}
