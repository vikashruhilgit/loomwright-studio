// The last `ok` usage answer this window read, kept per bridge across the screen's mounts. The shell contract
// (`../../shell/last-known.ts`) says a screen that has data keeps it under the band while the kernel is gone:
// leaving Budget & audit and coming back while the kernel is stopped must not turn it into "Status unknown".
// Keyed by the bridge, so one window's data is never another's (and a test's bridge starts empty). Plain
// memory: nothing is written to disk, and a fresh answer replaces it.
import type { BudgetUsageResponse, StudioBridge } from "../../api/contract";

const held = new WeakMap<StudioBridge, BudgetUsageResponse>();

export function heldUsage(api: StudioBridge): BudgetUsageResponse | undefined {
  return held.get(api);
}

export function holdUsage(api: StudioBridge, usage: BudgetUsageResponse): void {
  held.set(api, usage);
}
