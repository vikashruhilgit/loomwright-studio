// The all-triggers firing history's pure logic: the merge across triggers (newest first by event id), the
// horizon that keeps paging honest, which triggers "Load older" reads, and the grouping that never folds two triggers.
import { describe, expect, it } from "vitest";
import type { TriggerFire } from "../../api/contract";
import { countAllFires, filterAllGroups, groupAllFires, hasOlder, horizonOf, mergeFires, nextPageTargets } from "./all-fires";
import type { HistoriesById } from "./all-fires";
import type { History } from "./model";

let at = 0;
function fire(id: number, kind: TriggerFire["kind"] = "trigger_fired", reason: string | null = null): TriggerFire {
  at += 1;
  return { id, kind, at: new Date(2026, 10, 1, 12, 0, at).toISOString(), scheduled_at: null, reason, session_id: null };
}
const missed = (id: number, reason: string | null): TriggerFire => fire(id, "trigger_missed", reason);
const history = (fires: TriggerFire[], cursor: string | null): History => ({ fires, cursor });
const ids = (histories: HistoriesById): number[] => mergeFires(histories).map((f) => f.fire.id);

describe("merging the histories", () => {
  it("lists every trigger's fires newest first by event id, each naming its trigger", () => {
    const merged = mergeFires(
      new Map([
        [1, history([fire(9), fire(5), fire(2)], null)],
        [3, history([fire(8), fire(7)], null)],
        [4, history([fire(10), fire(1)], null)],
      ]),
    );
    expect(merged.map((f) => [f.fire.id, f.trigger_id])).toEqual([
      [10, 4],
      [9, 1],
      [8, 3],
      [7, 3],
      [5, 1],
      [2, 1],
      [1, 4],
    ]);
  });

  it("lists a fire once even when two triggers' pages carry the same id", () => {
    expect(ids(new Map([[1, history([fire(5), fire(3)], null)], [2, history([fire(5)], null)]]))).toEqual([5, 3]);
  });

  it("is empty for no histories and for empty ones", () => {
    expect(mergeFires(new Map())).toEqual([]);
    expect(mergeFires(new Map([[1, history([], null)]]))).toEqual([]);
  });
});

describe("the horizon", () => {
  it("is the newest of the unfinished triggers' oldest loaded fires: every one of them has loaded at least that far down", () => {
    const histories: HistoriesById = new Map([
      [1, history([fire(40), fire(30)], "30")],
      [3, history([fire(35), fire(20)], "20")],
      [4, history([fire(38), fire(1)], null)],
    ]);
    expect(horizonOf(histories)).toBe(30);
    expect(ids(histories)).toEqual([40, 38, 35, 30]);
  });

  it("horizon hides fires below an unfinished trigger's oldest loaded fire, so no older, unloaded fire can be missing above one shown", () => {
    // Trigger 1 loaded down to 30 and has older pages; trigger 4 is fully loaded and holds a fire at 10, below trigger
    // 1's unloaded 29..11: showing 10 would leave a gap above it.
    const histories: HistoriesById = new Map([
      [1, history([fire(40), fire(30)], "30")],
      [4, history([fire(35), fire(10)], null)],
    ]);
    expect(horizonOf(histories)).toBe(30);
    expect(ids(histories)).toEqual([40, 35, 30]);
  });

  it("is lifted trigger by trigger as the pages come: a finished trigger limits nothing", () => {
    const loaded: HistoriesById = new Map([
      [1, history([fire(40), fire(30), fire(12)], null)],
      [4, history([fire(35), fire(10)], null)],
    ]);
    expect(horizonOf(loaded)).toBeUndefined();
    expect(ids(loaded)).toEqual([40, 35, 30, 12, 10]);
  });

  it("is not set by an unfinished trigger with nothing loaded (its page is read first)", () => {
    expect(horizonOf(new Map([[1, history([], "5")]]))).toBeUndefined();
    expect(horizonOf(new Map())).toBeUndefined();
  });
});

describe("which triggers 'Load older' reads", () => {
  it("is the unfinished trigger holding the horizon up, and none while every history is loaded", () => {
    const histories: HistoriesById = new Map([
      [1, history([fire(40), fire(30)], "30")],
      [3, history([fire(35), fire(20)], "20")],
      [4, history([fire(38), fire(1)], null)],
    ]);
    expect(nextPageTargets(histories)).toEqual([1]);
    expect(hasOlder(histories)).toBe(true);
    const done: HistoriesById = new Map([[1, history([fire(40)], null)]]);
    expect(nextPageTargets(done)).toEqual([]);
    expect(hasOlder(done)).toBe(false);
  });

  it("includes an unfinished trigger with nothing loaded", () => {
    expect(nextPageTargets(new Map([[1, history([fire(40)], "40")], [2, history([], "9")]]))).toEqual([1, 2]);
  });
});

describe("grouping repeats", () => {
  const ref = (trigger_id: number, f: TriggerFire) => ({ trigger_id, fire: f });

  it("folds consecutive fires of one trigger, kind and reason into one group with a count and its first and last fire", () => {
    const groups = groupAllFires([ref(1, missed(9, "paused")), ref(1, missed(8, "paused")), ref(1, missed(7, "paused")), ref(1, fire(6))]);
    expect(groups.map((g) => [g.trigger_id, g.kind, g.reason, g.count, g.newest.id, g.oldest.id, g.key])).toEqual([
      [1, "trigger_missed", "paused", 3, 9, 7, "fire-7"],
      [1, "trigger_fired", null, 1, 6, 6, "fire-6"],
    ]);
  });

  it("a repeat never merges across two triggers", () => {
    const groups = groupAllFires([ref(1, missed(9, "paused")), ref(3, missed(8, "paused")), ref(1, missed(7, "paused"))]);
    expect(groups.map((g) => [g.trigger_id, g.count])).toEqual([
      [1, 1],
      [3, 1],
      [1, 1],
    ]);
  });

  it("never merges a fired row and a missed one, nor two reasons", () => {
    const groups = groupAllFires([ref(1, fire(9)), ref(1, missed(8, "paused")), ref(1, missed(7, "kill_switch")), ref(1, missed(6, null)), ref(1, missed(5, null))]);
    expect(groups.map((g) => [g.kind, g.reason, g.count])).toEqual([
      ["trigger_fired", null, 1],
      ["trigger_missed", "paused", 1],
      ["trigger_missed", "kill_switch", 1],
      ["trigger_missed", null, 2],
    ]);
  });

  it("filters to the missed groups and counts the fires of the filter", () => {
    const merged = [ref(1, fire(9)), ref(3, missed(8, "paused")), ref(3, missed(7, "paused")), ref(1, fire(6))];
    const groups = groupAllFires(merged);
    expect(filterAllGroups(groups, "all")).toHaveLength(3);
    expect(filterAllGroups(groups, "missed").map((g) => [g.trigger_id, g.count])).toEqual([[3, 2]]);
    expect(countAllFires(merged, "all")).toBe(4);
    expect(countAllFires(merged, "missed")).toBe(2);
  });
});
