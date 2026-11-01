// The subscription cap card's logic (phase 7 item 17): how a window reads once its reset has passed,
// the account's display name, and the note under the windows. Plain TypeScript, like `./model.ts`.
//
// Stale. The kernel's cap rules (`kernel/src/budget/cap.ts` header, `activeParks` in
// `kernel/src/budget/internal.ts`) park work only on a `rejected` window whose `resets_at` is null or still
// ahead. A window whose reset has passed is over: its stored status is what was last read, not what holds
// now, and admission does not wait on it. The card shows such a window as stale, with that last-read status
// word in a neutral tone and the time the kernel last recorded it (`updated_at`), never "resets {past time}".
// An older kernel sends no `updated_at`, and the caption then says the time is unknown.
import type { BudgetCapState, BudgetUsageCapState } from "../../api/contract";
import { capStatusView, resetLabel, safe, utilizationPercent } from "./model";
import type { CapStatusView } from "./model";

/** One account's cap entry as `GET /budget/usage` answers it. */
export type UsageCapEntry = BudgetUsageCapState[number];
/** One of its windows, with the optional `updated_at`. */
export type UsageCapWindow = UsageCapEntry["limits"][number];

/** True when the window's reset is known and has passed (equality counts): the window is over. */
export function isStale(window: Pick<UsageCapWindow, "resets_at">, now: Date): boolean {
  if (window.resets_at === null) return false;
  const resetMs = Date.parse(window.resets_at);
  const nowMs = now.getTime();
  return Number.isFinite(resetMs) && resetMs <= nowMs;
}

/**
 * The line under a live window's meter: "41% used · resets today 17:00". No utilization reads "usage not reported"
 * (and the window draws no meter); no reset time reads "no reset time"; a reset the kernel could only recheck reads
 * "reset unknown · rechecked <time>".
 */
export function capCaption(window: Pick<UsageCapWindow, "utilization" | "resets_at" | "reset_source">, now: Date): string {
  const percent = utilizationPercent(window.utilization);
  const used = percent === null ? "usage not reported" : `${percent}% used`;
  let reset: string;
  if (window.reset_source === "recheck") reset = window.resets_at === null ? "reset unknown" : `reset unknown · rechecked ${resetLabel(window.resets_at, now)}`;
  else if (window.resets_at === null) reset = "no reset time";
  else reset = `resets ${resetLabel(window.resets_at, now)}`;
  return `${used} · ${reset}`;
}

/** The line under a stale window: "last read Fri 30 Oct 00:30 · window ended Fri 30 Oct 00:30", or "last read time unknown · …" without `updated_at`. */
export function staleCaption(window: Pick<UsageCapWindow, "resets_at" | "updated_at">, now: Date): string {
  const read = window.updated_at !== undefined && Number.isFinite(Date.parse(window.updated_at)) ? `last read ${resetLabel(window.updated_at, now)}` : "last read time unknown";
  return window.resets_at === null ? read : `${read} · window ended ${resetLabel(window.resets_at, now)}`;
}

/** What the card draws for one window. */
export interface CapWindowView {
  readonly stale: boolean;
  /** The status word and its tone: neutral for a stale window, whatever its last-read status was. */
  readonly status: CapStatusView;
  /** The utilization meter's percent; `null` draws no meter (none reported, or the window is stale so the figure is old). */
  readonly percent: number | null;
  readonly caption: string;
}

export function capWindowView(window: UsageCapWindow, now: Date): CapWindowView {
  const status = capStatusView(window.status);
  if (isStale(window, now)) return { stale: true, status: { label: status.label, tone: "neutral" }, percent: null, caption: staleCaption(window, now) };
  return { stale: false, status, percent: utilizationPercent(window.utilization), caption: capCaption(window, now) };
}

/** A provider's display name when the status resource labels it with nothing better (item 18's Settings rule). */
const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  "subscription-token": "personal subscription",
  "api-key": "API key",
};

/**
 * The account shown over a cap entry. `GET /status` labels `account` from the auth provider, so the live store's
 * entry for the same provider wins when it carries a label that is not just the provider id. Otherwise the entry's
 * own label when it differs from the id, else a display name per provider id; any other id shows as itself.
 */
export function capAccountLabel(entry: Pick<UsageCapEntry, "account" | "provider">, status: BudgetCapState | undefined): string {
  const labelled = status?.find((s) => s.provider === entry.provider)?.account.trim();
  if (labelled !== undefined && labelled !== "" && labelled !== entry.provider) return safe(labelled);
  const own = entry.account.trim();
  if (own !== "" && own !== entry.provider) return safe(own);
  return safe(Object.hasOwn(PROVIDER_NAMES, entry.provider) ? (PROVIDER_NAMES[entry.provider] ?? entry.provider) : entry.provider);
}

/** The note under the windows: only an unexpired `rejected` window parks work. */
export function capNote(cap: BudgetUsageCapState, now: Date): string {
  if (cap.length === 0) return "No cap state has been reported yet.";
  const rejected = cap.flatMap((entry) => entry.limits.filter((w) => w.status === "rejected"));
  if (rejected.some((w) => !isStale(w, now))) return "A window is rejected, so sessions wait on the cap until it resets.";
  if (rejected.length > 0) return "A rejected window has ended, so nothing is parked on the cap.";
  return "No window is rejected, so nothing is parked on the cap.";
}
