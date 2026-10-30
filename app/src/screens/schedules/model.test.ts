// Schedules' view model: the reasons, the grouping of repeats, the paging of the
// history, names and specs, times, the feed's kinds and the toggle's outcomes.
import { describe, expect, it } from "vitest";
import type { ScheduleEntry, Trigger, TriggerFire, TriggerFiresResponse } from "../../api/contract";
import {
  SCHEDULES_TEST_IDS,
  appendOlderPage,
  countFires,
  entryName,
  filterGroups,
  fireTime,
  fireView,
  groupFires,
  iconOf,
  isScheduleKind,
  linksToIntegrations,
  mergeFirstPage,
  newestScheduleEventId,
  nextRead,
  reasonView,
  replyOf,
  specLine,
  specSummary,
  summaryText,
  timelineTime,
  toggleFailure,
  toggleOutcome,
  triggerName,
  whenLabel,
} from "./model";
import type { History, Reply } from "./model";

let at = 0;
function fire(id: number, kind: TriggerFire["kind"], reason: string | null = null): TriggerFire {
  at += 1;
  return { id, kind, at: new Date(2026, 9, 30, 12, 0, at).toISOString(), scheduled_at: null, reason, session_id: null };
}
const missed = (id: number, reason: string | null): TriggerFire => fire(id, "trigger_missed", reason);
const fired = (id: number): TriggerFire => fire(id, "trigger_fired");
const page = (fires: TriggerFire[], next: string | null): TriggerFiresResponse => ({ fires, next_before: next });

describe("the test ids", () => {
  it("are unique values", () => {
    const values = Object.values(SCHEDULES_TEST_IDS);
    expect(new Set(values).size).toBe(values.length);
    expect(SCHEDULES_TEST_IDS.screen).toBe("screen-schedules");
  });
});

// ---- Reasons -----------------------------------------------------------------------------------------------

describe("the reasons a fire did not happen", () => {
  it.each([
    ["paused", "missed · paused", "attention"],
    ["kill_switch", "missed · kill switch", "attention"],
    ["playbook_not_enabled", "playbook not enabled", "attention"],
    ["already_done", "already done", "neutral"],
    ["rate_limited", "rate limited", "attention"],
    ["connector_missing", "no connector", "danger"],
    ["source_error", "source error", "danger"],
  ] as const)("%s has the label %s and the tone %s", (reason, label, tone) => {
    expect(reasonView(reason)).toEqual({ label, tone });
    expect(fireView({ kind: "trigger_missed", reason })).toEqual({ label, tone });
  });

  it("shows a reason the table does not know as a neutral 'missed', and a missing one the same", () => {
    expect(reasonView("brand_new_code")).toEqual({ label: "missed", tone: "neutral" });
    expect(reasonView(null)).toEqual({ label: "missed", tone: "neutral" });
  });

  it("never reads the prototype: a reason named like an Object member is unknown", () => {
    for (const reason of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect(reasonView(reason)).toEqual({ label: "missed", tone: "neutral" });
  });

  it("a fired row is 'fired' in the ok tone, whatever reason it carries", () => {
    expect(fireView({ kind: "trigger_fired", reason: null })).toEqual({ label: "fired", tone: "ok" });
    expect(fireView({ kind: "trigger_fired", reason: "paused" })).toEqual({ label: "fired", tone: "ok" });
  });

  it("links only a missed fire whose connector is missing to Integrations", () => {
    expect(linksToIntegrations({ kind: "trigger_missed", reason: "connector_missing" })).toBe(true);
    expect(linksToIntegrations({ kind: "trigger_missed", reason: "source_error" })).toBe(false);
    expect(linksToIntegrations({ kind: "trigger_fired", reason: "connector_missing" })).toBe(false);
    expect(linksToIntegrations({ kind: "trigger_missed", reason: null })).toBe(false);
  });
});

// ---- Repeats -----------------------------------------------------------------------------------------------

describe("repeats are grouped", () => {
  it("folds consecutive rows of one kind and reason into one group with a count and the first and last fire", () => {
    const groups = groupFires([missed(9, "paused"), missed(8, "paused"), missed(7, "paused"), fired(6), missed(5, "paused")]);
    expect(groups.map((g) => [g.kind, g.reason, g.count])).toEqual([
      ["trigger_missed", "paused", 3],
      ["trigger_fired", null, 1],
      ["trigger_missed", "paused", 1],
    ]);
    expect(groups[0]?.newest.id).toBe(9);
    expect(groups[0]?.oldest.id).toBe(7);
  });

  it("does not merge two missed reasons, or a fired row with a missed one", () => {
    const groups = groupFires([missed(4, "paused"), missed(3, "kill_switch"), fired(2), missed(1, "kill_switch")]);
    expect(groups.map((g) => g.count)).toEqual([1, 1, 1, 1]);
  });

  it("returns fewer groups than rows when there are repeats (a pin: the grouping is not the identity)", () => {
    const rows = [missed(3, "paused"), missed(2, "paused"), missed(1, "paused")];
    expect(groupFires(rows)).toHaveLength(1);
    expect(groupFires(rows)).not.toHaveLength(rows.length);
  });

  it("keys a group by its oldest fire, so a newer fire joining it keeps the key", () => {
    const before = groupFires([missed(7, "paused"), missed(6, "paused")]);
    const after = groupFires([missed(8, "paused"), missed(7, "paused"), missed(6, "paused")]);
    expect(after[0]?.key).toBe(before[0]?.key);
    expect(after[0]?.count).toBe(3);
  });

  it("is empty for no fires", () => {
    expect(groupFires([])).toEqual([]);
  });

  it("filters to the missed groups, counting fires and not groups", () => {
    const fires = [missed(5, "paused"), missed(4, "paused"), fired(3), missed(2, "rate_limited")];
    const groups = groupFires(fires);
    expect(filterGroups(groups, "all")).toHaveLength(3);
    expect(filterGroups(groups, "missed").map((g) => g.reason)).toEqual(["paused", "rate_limited"]);
    expect(countFires(fires, "all")).toBe(4);
    expect(countFires(fires, "missed")).toBe(3);
  });
});

// ---- Paging -----------------------------------------------------------------------------------------------

describe("paging the history", () => {
  it("a first page is the history, with the page's cursor", () => {
    const h = mergeFirstPage(undefined, page([fired(3), fired(2)], "2"));
    expect(h.fires.map((f) => f.id)).toEqual([3, 2]);
    expect(h.cursor).toBe("2");
  });

  it("an older page follows the loaded fires and replaces the cursor; the last page's cursor is null", () => {
    const first: History = { fires: [fired(5), fired(4)], cursor: "4" };
    const second = appendOlderPage(first, page([fired(3), fired(2)], "2"));
    expect(second.fires.map((f) => f.id)).toEqual([5, 4, 3, 2]);
    expect(second.cursor).toBe("2");
    const last = appendOlderPage(second, page([fired(1)], null));
    expect(last.fires.map((f) => f.id)).toEqual([5, 4, 3, 2, 1]);
    expect(last.cursor).toBeNull();
  });

  it("does not add a fire twice when a page overlaps the loaded ones", () => {
    const first: History = { fires: [fired(5), fired(4)], cursor: "4" };
    expect(appendOlderPage(first, page([fired(4), fired(3)], null)).fires.map((f) => f.id)).toEqual([5, 4, 3]);
  });

  it("a refetch of the first page keeps the older pages that were loaded, and their cursor", () => {
    const loaded: History = { fires: [fired(6), fired(5), fired(4), fired(3)], cursor: "3" };
    const merged = mergeFirstPage(loaded, page([fired(7), fired(6)], "6"));
    expect(merged.fires.map((f) => f.id)).toEqual([7, 6, 5, 4, 3]);
    expect(merged.cursor).toBe("3");
  });

  it("a refetch that touches nothing loaded restarts from the fresh page: a gap would hide fires", () => {
    const loaded: History = { fires: [fired(6), fired(5)], cursor: "5" };
    const merged = mergeFirstPage(loaded, page([fired(20), fired(19)], "19"));
    expect(merged.fires.map((f) => f.id)).toEqual([20, 19]);
    expect(merged.cursor).toBe("19");
  });

  it("a refetch that now holds the whole history has no cursor, and drops nothing", () => {
    const loaded: History = { fires: [fired(3), fired(2), fired(1)], cursor: null };
    const merged = mergeFirstPage(loaded, page([fired(4), fired(3), fired(2), fired(1)], null));
    expect(merged.fires.map((f) => f.id)).toEqual([4, 3, 2, 1]);
    expect(merged.cursor).toBeNull();
  });

  it("reads a malformed page as no fires, never a throw", () => {
    const bad = { fires: "nope", next_before: 7 } as unknown as TriggerFiresResponse;
    expect(mergeFirstPage(undefined, bad)).toEqual({ fires: [], cursor: null });
    const junk = { fires: [null, 4, { id: "x" }, fired(2)], next_before: null } as unknown as TriggerFiresResponse;
    expect(mergeFirstPage(undefined, junk).fires.map((f) => f.id)).toEqual([2]);
  });
});

// ---- Names and specs ------------------------------------------------------------------------------------------

const playbooks = [{ slug: "review-prs", name: "Review PRs on studio-sandbox" }];

describe("names", () => {
  it("is the playbook's name when the trigger has one", () => {
    expect(triggerName({ id: 1, playbook: "review-prs", text: "ignored" }, playbooks)).toBe("Review PRs on studio-sandbox");
  });

  it("is the action's text without a playbook, or when the playbook is not listed", () => {
    expect(triggerName({ id: 2, playbook: null, text: "Friday wrap-up" }, playbooks)).toBe("Friday wrap-up");
    expect(triggerName({ id: 2, playbook: "gone", text: "Friday wrap-up" }, playbooks)).toBe("Friday wrap-up");
    expect(triggerName({ id: 2, playbook: "review-prs", text: "Friday wrap-up" }, undefined)).toBe("Friday wrap-up");
  });

  it("falls back to the slug, then to the id", () => {
    expect(triggerName({ id: 3, playbook: "gone", text: " " }, playbooks)).toBe("gone");
    expect(triggerName({ id: 3, playbook: null, text: "" }, playbooks)).toBe("Trigger #3");
  });

  it("names a wake-up with its task, and a trigger entry as its trigger", () => {
    const wake: ScheduleEntry = { kind: "wakeup", id: 5, at: "2026-10-30T15:30:00.000Z", agent: null, playbook: null, action: null, text: "PR #3 may be ready", task_id: 7 };
    expect(entryName(wake, playbooks)).toBe("Wake-up #5 · task #7");
    expect(entryName({ ...wake, task_id: null }, playbooks)).toBe("Wake-up #5");
    expect(entryName({ ...wake, kind: "trigger", id: 1, playbook: "review-prs", action: "run", task_id: null }, playbooks)).toBe("Review PRs on studio-sandbox");
  });

  it("keeps markup in a name as text, untouched", () => {
    expect(triggerName({ id: 4, playbook: null, text: "<img src=x onerror=alert(1)>" }, undefined)).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("specs", () => {
  const now = new Date(2026, 9, 30, 12, 0);
  it("reads a poll's interval and repos", () => {
    expect(specSummary("poll", { source: "github", repos: ["me/a", "me/b"], filters: {}, interval_seconds: 600 }, now)).toBe("every 10 min · me/a, me/b");
    expect(specSummary("poll", { interval_seconds: 30 }, now)).toBe("every 30 s");
    expect(specSummary("poll", { interval_seconds: 7200 }, now)).toBe("every 2 h");
  });

  it("reads a cron expression with its zone, and a once as a time", () => {
    expect(specSummary("cron", { cron: "0 9 * * 5", tz: "UTC" }, now)).toBe("0 9 * * 5 · UTC");
    expect(specSummary("cron", { cron: "0 9 * * 5" }, now)).toBe("0 9 * * 5");
    expect(specSummary("once", { at: new Date(2026, 9, 30, 17, 0).toISOString() }, now)).toBe("today 17:00");
  });

  it("reads a spec it does not know, or garbage, as nothing and never throws", () => {
    for (const spec of [null, undefined, 4, "x", [], { at: 5 }, { cron: 5 }, { repos: "no", interval_seconds: -1 }]) {
      expect(() => specSummary("poll", spec, now)).not.toThrow();
      expect(specSummary("once", spec, now)).toBe("");
      expect(specSummary("cron", spec, now)).toBe("");
    }
    expect(specSummary("weekly", { cron: "x" }, now)).toBe("");
  });

  it("joins the kind and the spec, or is the kind alone", () => {
    const row = { kind: "cron", spec: { cron: "0 8 * * 1-5", tz: "UTC" } } as Pick<Trigger, "kind" | "spec">;
    expect(specLine(row, now)).toBe("cron · 0 8 * * 1-5 · UTC");
    expect(specLine({ kind: "cron", spec: null }, now)).toBe("cron");
  });

  it("picks an icon for the kinds the kernel has, and the generic one until the kind is known", () => {
    expect(iconOf("once")).toBe("once");
    expect(iconOf("cron")).toBe("cron");
    expect(iconOf("poll")).toBe("poll");
    expect(iconOf(undefined)).toBe("trigger");
    expect(iconOf("weekly")).toBe("trigger");
  });
});

// ---- Times --------------------------------------------------------------------------------------------

describe("times", () => {
  const now = new Date(2026, 9, 30, 14, 40);
  const local = (y: number, mo: number, d: number, h: number, mi: number): string => new Date(y, mo, d, h, mi).toISOString();

  it("shows the timeline's time as a clock today and as a date otherwise", () => {
    expect(timelineTime(local(2026, 9, 30, 15, 30), now)).toBe("15:30");
    expect(timelineTime(local(2026, 10, 6, 9, 0), now)).toBe("6 Nov");
    expect(timelineTime("not a time", now)).toBe("not a time");
  });

  it("labels a moment 'today 17:00' or '6 Nov 09:00'", () => {
    expect(whenLabel(local(2026, 9, 30, 17, 0), now)).toBe("today 17:00");
    expect(whenLabel(local(2026, 10, 6, 9, 0), now)).toBe("6 Nov 09:00");
    expect(whenLabel(null, now)).toBe("never");
  });

  it("shows a fire's time as a clock today, a weekday within six days and a date beyond", () => {
    expect(fireTime(local(2026, 9, 30, 14, 20), now)).toBe("14:20");
    // 29 Oct 2026 is a Thursday.
    expect(fireTime(local(2026, 9, 29, 22, 40), now)).toBe("Thu 22:40");
    expect(fireTime(local(2026, 9, 20, 9, 12), now)).toBe("20 Oct 09:12");
  });
});

// ---- The feed -------------------------------------------------------------------------------------------

describe("the feed", () => {
  it.each([
    ["trigger_fired", true],
    ["trigger_missed", true],
    ["trigger_toggled", true],
    ["wakeup_scheduled", true],
    ["playbook_enabled", true],
    ["session_started", false],
    ["approval_requested", false],
    ["connector_status", false],
    ["triggers", false],
  ])("%s makes the screen read again: %s", (kind, want) => {
    expect(isScheduleKind(kind)).toBe(want);
  });

  it("finds the newest relevant event id, or 0", () => {
    const log = [
      { id: 1, kind: "trigger_fired" },
      { id: 2, kind: "session_started" },
      { id: 3, kind: "wakeup_scheduled" },
      { id: 4, kind: "connector_status" },
    ];
    expect(newestScheduleEventId(log)).toBe(3);
    expect(newestScheduleEventId([{ id: 9, kind: "session_started" }])).toBe(0);
    expect(newestScheduleEventId([])).toBe(0);
  });
});

// ---- Answers and toggles ---------------------------------------------------------------------------------

describe("answers", () => {
  it("tells unreachable (status 0), a refusal and a failed call apart", () => {
    expect(replyOf({ ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } }).kind).toBe("unreachable");
    expect(replyOf(undefined).kind).toBe("failed");
    const refused = replyOf({ ok: false, status: 409, body: { error: "needs_confirmation", message: "fires at once" } });
    expect(refused).toMatchObject({ kind: "refused", status: 409, error: "needs_confirmation", message: "fires at once" });
    expect(replyOf({ ok: true, status: 200, body: { a: 1 } })).toEqual({ kind: "ok", status: 200, body: { a: 1 } });
  });

  it("falls back to the HTTP status for a refusal with no error code", () => {
    expect(replyOf({ ok: false, status: 500, body: {} as never })).toMatchObject({ kind: "refused", error: "HTTP 500" });
  });

  it("keeps the last good answer when a later one fails", () => {
    const good: Reply<number> = { kind: "ok", status: 200, body: 5 };
    const bad: Reply<number> = { kind: "unreachable", message: "x" };
    const read = nextRead(nextRead({ latest: undefined, lastOk: undefined }, good), bad);
    expect(read.lastOk).toBe(5);
    expect(read.latest).toBe(bad);
  });
});

describe("a toggle's outcome", () => {
  const refusal = (status: number, error: string): Reply<unknown> => ({ kind: "refused", status, error, message: undefined, body: { error } });

  it("an ok answer is done", () => {
    expect(toggleOutcome({ kind: "ok", status: 200, body: {} }, false)).toEqual({ kind: "done" });
  });

  it("a 409 needs_confirmation asks, once; the same answer to a confirmed request is a refusal", () => {
    expect(toggleOutcome(refusal(409, "needs_confirmation"), false)).toEqual({ kind: "confirm" });
    expect(toggleOutcome(refusal(409, "needs_confirmation"), true)).toEqual({ kind: "refused", text: "needs_confirmation" });
  });

  it("any other refusal is the kernel's error code", () => {
    expect(toggleOutcome(refusal(404, "not_found"), false)).toEqual({ kind: "refused", text: "not_found" });
    expect(toggleOutcome(refusal(400, "invalid_id"), false)).toEqual({ kind: "refused", text: "invalid_id" });
    expect(toggleOutcome(refusal(409, "owner_off"), false)).toEqual({ kind: "refused", text: "owner_off" });
  });

  it("an unreachable or failed call is a refusal in words, never a throw", () => {
    expect(toggleOutcome({ kind: "unreachable", message: "the kernel could not be reached" }, false)).toEqual({ kind: "refused", text: "the kernel could not be reached" });
    expect(toggleOutcome({ kind: "failed", message: "no answer from the kernel" }, false)).toEqual({ kind: "refused", text: "no answer from the kernel" });
  });

  it("words the row's failure", () => {
    expect(toggleFailure(true, "not_found")).toBe("Couldn't turn it on: not_found");
    expect(toggleFailure(false, "not_found")).toBe("Couldn't turn it off: not_found");
  });
});

describe("the summary", () => {
  it("counts upcoming fires and triggers that are on, and marks data that may be old", () => {
    expect(summaryText(5, 4, false)).toBe("5 upcoming · 4 triggers on");
    expect(summaryText(1, 1, false)).toBe("1 upcoming · 1 trigger on");
    expect(summaryText(5, 4, true)).toBe("5 upcoming · 4 triggers on · last known");
  });
});
