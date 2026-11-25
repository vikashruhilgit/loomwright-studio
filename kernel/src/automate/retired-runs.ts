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
// A retire applies only to the lines written before it. A ticket handed over again
// after its run was retired is the playbook's live work again: the handover that
// hands it over appends one `automate_retired_item_handed_again` event naming it
// (`recordHandedAgain`), and `retiredItemNames` reads the two kinds in event
// order, so a later retire names it again and a later hand-over lifts it again.
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

/** The event kind of retired items a later handover handed over again (its one writer is `recordHandedAgain`). */
export const RETIRED_HANDED_AGAIN_EVENT = "automate_retired_item_handed_again";

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

/** The checkout and item names of one well-formed record payload for `checkout`, else `undefined`. */
function parsedRecord(payloadJson: string, want: string): { checkout: string; p: Record<string, unknown>; items: string[] } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const p = parsed as Record<string, unknown>;
  if (typeof p["checkout"] !== "string" || p["checkout"] === "" || resolve(p["checkout"]) !== want) return undefined;
  const items = Array.isArray(p["items"]) ? (p["items"] as unknown[]).filter(isItemName) : [];
  return { checkout: p["checkout"], p, items };
}

/** Every well-formed retired-run record for `checkout`, oldest first. */
function retiredRecords(store: Store, checkout: string): RunRetired[] {
  const want = resolve(checkout);
  const rows = store.prepare<[string], { payload_json: string }>("SELECT payload_json FROM events WHERE kind = ? ORDER BY id").all(RUN_RETIRED_EVENT);
  const out: RunRetired[] = [];
  for (const row of rows) {
    const rec = parsedRecord(row.payload_json, want);
    if (rec === undefined || !isRunId(rec.p["run_id"])) continue;
    out.push({ checkout: rec.checkout, run_id: rec.p["run_id"], items: rec.items });
  }
  return out;
}

/** The ids of the runs retired in `checkout`. Reads only. */
export function retiredRunIds(store: Store, checkout: string): Set<string> {
  return new Set(retiredRecords(store, checkout).map((r) => r.run_id));
}

/**
 * The item file names a retired run in `checkout` named and no handover has handed over again since (event order):
 * a handover never carries them (`run_retired`). Reads only.
 */
export function retiredItemNames(store: Store, checkout: string): Set<string> {
  const want = resolve(checkout);
  const rows = store
    .prepare<[string, string], { kind: string; payload_json: string }>("SELECT kind, payload_json FROM events WHERE kind IN (?, ?) ORDER BY id")
    .all(RUN_RETIRED_EVENT, RETIRED_HANDED_AGAIN_EVENT);
  const names = new Set<string>();
  for (const row of rows) {
    const rec = parsedRecord(row.payload_json, want);
    if (rec === undefined) continue;
    if (row.kind === RUN_RETIRED_EVENT) {
      if (!isRunId(rec.p["run_id"])) continue;
      for (const name of rec.items) names.add(name);
    } else {
      for (const name of rec.items) names.delete(name);
    }
  }
  return names;
}

/**
 * Records that a handover in `checkout` handed over `handed` (item file names) again: those a retired run named are
 * lifted from `retiredItemNames` by one `automate_retired_item_handed_again` event at `at`. Writes nothing when none
 * of them is retired. Returns the names it lifted, in `handed`'s order.
 */
export function recordHandedAgain(store: Store, checkout: string, handed: Iterable<string>, at: string): string[] {
  const retired = retiredItemNames(store, checkout);
  const items = [...new Set(handed)].filter((name) => isItemName(name) && retired.has(name));
  if (items.length > 0) appendEvent(store, RETIRED_HANDED_AGAIN_EVENT, NO_REF, { checkout, items }, at);
  return items;
}
