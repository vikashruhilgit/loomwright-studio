// Public surface of the budget layer (item 06): the token meter, the
// subscription-cap tracker and the admission gate.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AdmissionDecision, AdmissionRequest } from "../sessions/types.js";
import { BudgetAdmission } from "./admission.js";
import { CapTracker } from "./cap.js";
import { BudgetMeter } from "./meter.js";
import { DEFAULT_BUDGET_CONFIG, validateBudgetConfig } from "./types.js";
import type { BudgetConfig, BudgetDeps, BudgetOptions } from "./types.js";

export { BudgetAdmission, apiKeyFallbackActive } from "./admission.js";
export {
  CAP_RECHECK_MS,
  CapTracker,
  TEXT_FALLBACK_TYPE,
  UNKNOWN_LIMIT_TYPE,
  findUsageLimitText,
  transientBackoffMs,
} from "./cap.js";
export type { CapTextSource } from "./cap.js";
export { localDay, startOfNextLocalDay } from "./internal.js";
export { BudgetMeter } from "./meter.js";
export { BudgetConfigError, DEFAULT_BUDGET_CONFIG, validateBudgetConfig } from "./types.js";
export type {
  ApiKeyFallbackPolicy,
  BudgetAuth,
  BudgetConfig,
  BudgetDeps,
  BudgetOptions,
  UsageTotals,
} from "./types.js";

/**
 * One meter, cap tracker and admission gate sharing a store, a config and a
 * clock. Wire it into the session manager as
 * `{ onMessage: budget.observe, admission: budget.check }`; both are bound.
 */
export class Budget {
  readonly config: BudgetConfig;
  readonly meter: BudgetMeter;
  readonly cap: CapTracker;
  readonly admission: BudgetAdmission;

  constructor(options: BudgetOptions, deps: BudgetDeps = {}) {
    this.config = validateBudgetConfig(options.config ?? DEFAULT_BUDGET_CONFIG);
    const shared = { ...options, config: this.config };
    this.meter = new BudgetMeter(shared, deps);
    this.cap = new CapTracker(shared, deps);
    this.admission = new BudgetAdmission(shared, deps);
  }

  /** Meter and cap-track one SDK message. Both always run; the first error is rethrown after. */
  readonly observe = (sessionId: number, message: SDKMessage): void => {
    let failure: { error: unknown } | undefined;
    for (const observer of [this.meter, this.cap]) {
      try {
        observer.observe(sessionId, message);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== undefined) throw failure.error;
  };

  readonly check = (request: AdmissionRequest): AdmissionDecision => this.admission.check(request);
}
