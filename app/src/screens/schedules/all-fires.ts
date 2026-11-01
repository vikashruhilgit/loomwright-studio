// The all-triggers firing history (phase 7 item 16): the pure logic that merges every trigger's own loaded
// history into one list, newest first. Plain TypeScript with no React and no DOM, like `./model.ts`.
//
// There is no kernel route for "the fires of every trigger", so the screen reads one first page per trigger from
// `GET /triggers/:id/fires` (`./useAllFires.ts`) and this file merges the pages. A fire's id is the id of its
// audit event, so ids are one sequence across triggers and merging by id is merging by time.
//
// The horizon keeps paging honest. A trigger that still has older pages (`cursor !== null`) may hold fires older
// than the oldest one loaded of it, and any of them can be newer than a fire another trigger has loaded further
// down. Showing that fire would leave a gap above it that "Load older" later fills in the middle of the list. So the
// merged list shows only fires newer than or equal to the horizon: the newest of the unfinished triggers' oldest
// loaded fires (every unfinished trigger has loaded at least that far down). A trigger whose history is fully
// loaded limits nothing. `TriggerFire` has no trigger id, so each fire is wrapped with the id of the trigger it was
// read from.
import type { TriggerFire } from "../../api/contract";
import type { History, HistoryFilter } from "./model";

/** A fire and the trigger it belongs to. */
export interface TriggerFireRef {
  readonly trigger_id: number;
  readonly fire: TriggerFire;
}

/** Each trigger's loaded history, by trigger id. */
export type HistoriesById = ReadonlyMap<number, History>;

function oldestId(history: History): number | undefined {
  const last = history.fires[history.fires.length - 1];
  return last?.id;
}

/**
 * The horizon: among the triggers that still have older pages, each one's oldest loaded fire id, and of those the
 * newest. `undefined` when no trigger has older pages (or none of them has loaded a fire). A trigger with a cursor and
 * no loaded fire sets none: its next page is read first (`nextPageTargets`), and holding the whole list back on it
 * would show nothing while it loads.
 */
export function horizonOf(histories: HistoriesById): number | undefined {
  let horizon: number | undefined;
  for (const history of histories.values()) {
    if (history.cursor === null) continue;
    const oldest = oldestId(history);
    if (oldest !== undefined && (horizon === undefined || oldest > horizon)) horizon = oldest;
  }
  return horizon;
}

/** Every loaded fire newer than or equal to the horizon, newest first by event id, each id once. */
export function mergeFires(histories: HistoriesById): TriggerFireRef[] {
  const horizon = horizonOf(histories);
  const merged: TriggerFireRef[] = [];
  const seen = new Set<number>();
  for (const [trigger_id, history] of histories) {
    for (const fire of history.fires) {
      if (seen.has(fire.id)) continue;
      seen.add(fire.id);
      if (horizon === undefined || fire.id >= horizon) merged.push({ trigger_id, fire });
    }
  }
  return merged.sort((a, b) => b.fire.id - a.fire.id);
}

/**
 * The triggers "Load older" reads the next page of: those with older pages whose oldest loaded fire is at the horizon
 * (they are the ones holding it up; reading any other would not move it), and those with a cursor and nothing loaded yet.
 */
export function nextPageTargets(histories: HistoriesById): number[] {
  const horizon = horizonOf(histories);
  const targets: number[] = [];
  for (const [id, history] of histories) {
    if (history.cursor === null) continue;
    const oldest = oldestId(history);
    if (oldest === undefined || oldest === horizon) targets.push(id);
  }
  return targets;
}

/** Whether any trigger has older pages to read. */
export function hasOlder(histories: HistoriesById): boolean {
  for (const history of histories.values()) if (history.cursor !== null) return true;
  return false;
}

/** Consecutive fires of one trigger, kind and reason, shown as one row. */
export interface AllFireGroup {
  /** The oldest fire's id: it stays put when newer fires join the group at the top, so the row is not remounted. */
  readonly key: string;
  readonly trigger_id: number;
  readonly kind: TriggerFire["kind"];
  readonly reason: string | null;
  readonly count: number;
  /** The most recent fire of the group. */
  readonly newest: TriggerFire;
  /** The earliest fire of the group. */
  readonly oldest: TriggerFire;
}

/**
 * `fires` (newest first) with each run of consecutive rows of one trigger, kind and reason folded into one group. A
 * fired row and a missed one never merge, neither do two reasons, and two triggers never merge: the repeat is of one
 * trigger's own fires (the rows in between belong to another).
 */
export function groupAllFires(fires: readonly TriggerFireRef[]): AllFireGroup[] {
  const groups: { trigger_id: number; kind: TriggerFire["kind"]; reason: string | null; count: number; newest: TriggerFire; oldest: TriggerFire }[] = [];
  for (const { trigger_id, fire } of fires) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.trigger_id === trigger_id && last.kind === fire.kind && last.reason === fire.reason) {
      last.count += 1;
      last.oldest = fire;
    } else {
      groups.push({ trigger_id, kind: fire.kind, reason: fire.reason, count: 1, newest: fire, oldest: fire });
    }
  }
  return groups.map((g) => ({ ...g, key: `fire-${g.oldest.id}` }));
}

/** The groups the filter shows ("Not fired" keeps the missed ones). Groups are made first, so one never spans a fired row. */
export function filterAllGroups(groups: readonly AllFireGroup[], filter: HistoryFilter): AllFireGroup[] {
  return filter === "all" ? [...groups] : groups.filter((g) => g.kind === "trigger_missed");
}

/** How many fires the filter counts: every merged one, or the missed ones. */
export function countAllFires(fires: readonly TriggerFireRef[], filter: HistoryFilter): number {
  return filter === "all" ? fires.length : fires.filter((f) => f.fire.kind === "trigger_missed").length;
}
