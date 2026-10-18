// Public surface of the budget layer (item 06): the token meter, the
// subscription-cap tracker and the admission gate; and (phase 3) the playbook
// gate and the per-playbook usage read.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AdmissionDecision, AdmissionRequest } from "../sessions/types.js";
import { BudgetAdmission } from "./admission.js";
import { CapTracker } from "./cap.js";
import { BudgetMeter } from "./meter.js";
import { PlaybookAdmission } from "./playbook.js";
import type { PlaybookAdmissionDecision, PlaybookAdmissionRequest } from "./playbook.js";
import { DEFAULT_BUDGET_CONFIG, validateBudgetConfig } from "./types.js";
import type { BudgetConfig, BudgetDeps, BudgetOptions } from "./types.js";

export { BudgetAdmission, apiKeyFallbackActive } from "./admission.js";
export {
  CAP_RECHECK_MS,
  CapTracker,
  MAX_RESET_AHEAD_MS,
  TEXT_FALLBACK_TYPE,
  UNKNOWN_LIMIT_TYPE,
  findUsageLimitText,
  transientBackoffMs,
} from "./cap.js";
export type { CapTextSource } from "./cap.js";
export { AGENT_REFUSAL_NOTIFY_MS, SESSIONS_AT_ONCE_RECHECK_MS, localDay, startOfNextLocalDay } from "./internal.js";
export { BudgetMeter } from "./meter.js";
export { PlaybookAdmission, parseApiKeyFallbackPolicy, playbookApiKeySpendUsd, playbookTokensToday } from "./playbook.js";
export type {
  PlaybookAdmissionDecision,
  PlaybookAdmissionRequest,
  PlaybookRefusalReason,
  PlaybookTokensToday,
} from "./playbook.js";
export {
  BudgetConfigError,
  DEFAULT_BUDGET_CONFIG,
  agentDailyTokenLimit,
  validateApiKeyFallbackPolicy,
  validateBudgetConfig,
} from "./types.js";
export type {
  AgentLimitsLookup,
  AgentSettingsRefusalReason,
  ApiKeyFallbackPolicy,
  BudgetAuth,
  BudgetConfig,
  BudgetDeps,
  BudgetOptions,
  UsageTotals,
} from "./types.js";

/**
 * One meter, cap tracker and admission gate sharing a store, a config and a
 * clock. `observe`, `check` and `checkPlaybook` are bound. `checkPlaybook` is
 * the playbook gate, and the kernel's session admission: `startKernel` wires
 * the session manager as `{ onMessage: budget.observe, admission:
 * admissionFor(budget, authProvider.id) }`, which asks `checkPlaybook` for
 * every start and resume (a request that is not a playbook's as
 * `playbook: null`, which is exactly `check`).
 */
export class Budget {
  readonly config: BudgetConfig;
  readonly meter: BudgetMeter;
  readonly cap: CapTracker;
  readonly admission: BudgetAdmission;
  readonly playbookAdmission: PlaybookAdmission;

  constructor(options: BudgetOptions, deps: BudgetDeps = {}) {
    this.config = validateBudgetConfig(options.config ?? DEFAULT_BUDGET_CONFIG);
    const shared = { ...options, config: this.config };
    this.meter = new BudgetMeter(shared, deps);
    this.cap = new CapTracker(shared, deps);
    this.admission = new BudgetAdmission(shared, deps);
    this.playbookAdmission = new PlaybookAdmission(shared, deps, this.admission);
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

  readonly checkPlaybook = (request: PlaybookAdmissionRequest): PlaybookAdmissionDecision =>
    this.playbookAdmission.check(request);
}
