// Retired `/automate` runs (phase 8 item 27b): the kernel's own record that the
// owner retired a paused or stranded run, so its unfinished items are never
// carried into a later handover's backlog again (`./tickets-to-items.ts`, reason
// `run_retired`), even after Loomwright's run file is moved or removed.
//
// The record is one `automate_run_retired` row in the append-only `events` table
// (`events_no_update`), holding the checkout, the run id and the studio item file
// names the run file named when it was retired. The kernel never edits, moves or
// deletes Loomwright's run file (invariant 4): retiring is the kernel's memory,
// not Loomwright's state. The owner's Retire route writes it; the handover and
// the paused-runs list read it.
//
// The reads parse `payload_json` defensively: a row that is not this shape is
// ignored, never thrown. A checkout is compared as `paused-runs.ts` compares it
// (`resolve`, realpath-free).
//
// Imports: the loop's event helper, the store type, `node:path` and this
// feature's files: never the Agent SDK, the session manager or `kernel.ts`.
import { resolve } from "node:path";
import { NO_REF, appendEvent } from "../loop/internal.js";
import type { Store } from "../store/store.js";
import { isRunId } from "./run-state.js";
import { MAX_BACKLOG_ITEMS, isItemName } from "./tickets-to-items.js";

/** The event kind of a retired run (its one writer is `recordRunRetired`). */
export const RUN_RETIRED_EVENT = "automate_run_retired";

/** One retired run, as recorded. */
export interface RunRetired {
  /** The checkout the run file lives in. */
  readonly checkout: string;
  readonly run_id: string;
  /** The studio item file names (`ticket-….md`) the run file named, each once. */
  readonly items: readonly string[];
}

/**
 * Records `retired` as one `automate_run_retired` event at `at`. Throws
 * `RangeError` `invalid_input: …`, before anything is written, for an empty
 * checkout, a run id that is not one (`isRunId`), an item that is not an item
 * file name, or more than `MAX_BACKLOG_ITEMS` distinct items. Repeated items are
 * kept once, in order.
 */
export function recordRunRetired(store: Store, retired: RunRetired, at: string): RunRetired {
  if (typeof retired.checkout !== "string" || retired.checkout === "") throw new RangeError("invalid_input: a retired run needs its checkout");
  if (!isRunId(retired.run_id)) throw new RangeError("invalid_input: the run id is not a Loomwright run id");
  const items = [...new Set(retired.items)];
  const bad = items.find((name) => !isItemName(name));
  if (bad !== undefined) throw new RangeError(`invalid_input: ${JSON.stringify(String(bad).slice(0, 80))} is not a studio item file name`);
  if (items.length > MAX_BACKLOG_ITEMS) throw new RangeError(`invalid_input: a retired run names at most ${MAX_BACKLOG_ITEMS} items (got ${items.length})`);
  const record: RunRetired = { checkout: retired.checkout, run_id: retired.run_id, items };
  appendEvent(store, RUN_RETIRED_EVENT, NO_REF, { ...record }, at);
  return record;
}

/** Every well-formed retired-run record for `checkout`, oldest first. */
function retiredRecords(store: Store, checkout: string): RunRetired[] {
  const want = resolve(checkout);
  const rows = store.prepare<[string], { payload_json: string }>("SELECT payload_json FROM events WHERE kind = ? ORDER BY id").all(RUN_RETIRED_EVENT);
  const out: RunRetired[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload_json);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const p = parsed as Record<string, unknown>;
    if (typeof p["checkout"] !== "string" || p["checkout"] === "" || resolve(p["checkout"]) !== want) continue;
    if (!isRunId(p["run_id"])) continue;
    const items = Array.isArray(p["items"]) ? (p["items"] as unknown[]).filter(isItemName) : [];
    out.push({ checkout: p["checkout"], run_id: p["run_id"], items });
  }
  return out;
}

/** The ids of the runs retired in `checkout`. Reads only. */
export function retiredRunIds(store: Store, checkout: string): Set<string> {
  return new Set(retiredRecords(store, checkout).map((r) => r.run_id));
}

/** The item file names every run retired in `checkout` named: a handover never carries them (`run_retired`). Reads only. */
export function retiredItemNames(store: Store, checkout: string): Set<string> {
  return new Set(retiredRecords(store, checkout).flatMap((r) => r.items));
}
