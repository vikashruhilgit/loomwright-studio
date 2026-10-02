import type { Migration } from "./types.js";

/**
 * Budget meter and cap-tracker details (item 06):
 *
 * - `budget.thinking_tokens`: thinking tokens per row. The SDK counts them
 *   inside `outputTokens` already, so they are shown, never added to
 *   `counted_tokens` (that would count them twice).
 * - `cap_state.utilization`: the event's `utilization`, as sent.
 * - `cap_state.unified_windows_json`: the untyped `unifiedWindows` field,
 *   verbatim (observed live only, absent from `sdk.d.ts`; its utilizations are
 *   0-1 fractions, OPEN_QUESTIONS Q6).
 * - `cap_state.reset_source`: `event` when `resets_at` came from the SDK's
 *   `resetsAt`, `recheck` when the reset is unknown and `resets_at` is the
 *   kernel's hourly re-check time.
 * - `cap_state.notified_resets_at` / `warned_resets_at`: the window
 *   (`resets_at`) a `rejected` notify / an `allowed_warning` event was last
 *   emitted for, so each is emitted once per window.
 */
export const budgetCapDetails: Migration = {
  version: 6,
  name: "budget_cap_details",
  up: `
ALTER TABLE budget ADD COLUMN thinking_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cap_state ADD COLUMN utilization REAL;
ALTER TABLE cap_state ADD COLUMN unified_windows_json TEXT;
ALTER TABLE cap_state ADD COLUMN reset_source TEXT;
ALTER TABLE cap_state ADD COLUMN notified_resets_at TEXT;
ALTER TABLE cap_state ADD COLUMN warned_resets_at TEXT;
`,
};
