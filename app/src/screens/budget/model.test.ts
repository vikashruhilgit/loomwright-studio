// Budget & audit's view model (phase 7 item 07): the pure logic behind the screen. Plain vitest,
// no DOM. The screen itself is covered by `BudgetScreen.test.tsx`, the built app by `e2e/budget.spec.ts`.
import { describe, expect, it } from "vitest";
import type { BudgetCapState, BudgetLimitUsage, BudgetUsageResponse, BudgetUsageRow } from "../../api/contract";
import {
  FIRST_PAGE,
  NO_FILTER,
  RANGES,
  actorOf,
  agentName,
  auditQuery,
  auditRows,
  bandText,
  busiestShare,
  capAccountLabel,
  capCaption,
  capNote,
  capStatusView,
  count,
  currentCursor,
  dayLabel,
  daySeries,
  filterActive,
  filterKey,
  footerText,
  formatTokens,
  isEmptyUsage,
  isFirstPage,
  kindOptions,
  latestQuery,
  limitFigure,
  limitLabel,
  limitMeterLabel,
  localDay,
  newestEventId,
  nextCursor,
  pageNewer,
  pageNumber,
  pageOlder,
  percentOf,
  refsOf,
  resetLabel,
  sessionsLabel,
  summaryOf,
  utilizationPercent,
  waitingAgents,
  windowDays,
} from "./model";

// Fri 30 Oct 2026, 14:22 local time.
const NOW = new Date(2026, 9, 30, 14, 22, 0);

function row(day: string, o: Partial<BudgetUsageRow> = {}): BudgetUsageRow {
  return { day, agent: "mason", playbook: null, counted_tokens: 0, cache_read_tokens: 0, cost_estimate_usd: null, ...o };
}

function limit(id: string, o: Partial<BudgetLimitUsage> = {}): BudgetLimitUsage {
  return { scope: "agent", id, tokens_today: 0, tokens_per_day: null, sessions_running: 0, sessions_at_once: null, ...o };
}

describe("numbers", () => {
  it("groups tokens with thousands separators and reads a damaged figure as 0", () => {
    expect(formatTokens(61900)).toBe("61,900");
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(count(Number.POSITIVE_INFINITY)).toBe(0);
    expect(count("5")).toBe(0);
  });

  it("percentOf is whole percent, clamped to 0 to 100, and a limit of 0 is full", () => {
    expect(percentOf(47844, 150000)).toBe(32);
    expect(percentOf(300000, 150000)).toBe(100);
    expect(percentOf(0, 100)).toBe(0);
    expect(percentOf(5, 0)).toBe(100);
  });

  it("at limit at equality, not before", () => {
    expect(limitFigure(99_999, 100_000).atLimit).toBe(false);
    expect(limitFigure(100_000, 100_000).atLimit).toBe(true);
    expect(limitFigure(100_001, 100_000)).toMatchObject({ atLimit: true, percent: 100 });
  });

  it("no limit: the bare number, no meter share, never at limit", () => {
    const figure = limitFigure(12380, null);
    expect(figure).toMatchObject({ limit: null, atLimit: false, percent: 0 });
    expect(limitLabel(figure)).toBe("12,380");
    expect(limitLabel(limitFigure(61900, 100000))).toBe("61,900 of 100,000");
    expect(limitMeterLabel(limitFigure(61900, 100000))).toBe("62 percent of the daily token limit");
  });

  it("sessions at once: 'N live of L' or 'N live · no limit set'", () => {
    expect(sessionsLabel(1, 2)).toBe("1 live of 2");
    expect(sessionsLabel(0, null)).toBe("0 live · no limit set");
  });
});

describe("days", () => {
  it("localDay is the host's day and windowDays counts back from today, today first", () => {
    expect(localDay(NOW)).toBe("2026-10-30");
    expect(windowDays(NOW, 3)).toEqual(["2026-10-30", "2026-10-29", "2026-10-28"]);
    expect(windowDays(new Date(2026, 2, 2, 9), 4)).toEqual(["2026-03-02", "2026-03-01", "2026-02-28", "2026-02-27"]);
  });

  it("a window that crosses a clock change neither skips nor repeats a day", () => {
    const days = windowDays(new Date(2026, 10, 3, 12), 10);
    expect(new Set(days).size).toBe(10);
    expect(days[9]).toBe("2026-10-25");
  });

  it("labels a day with its weekday and month", () => {
    expect(dayLabel("2026-10-29")).toBe("Thu 29 Oct");
    expect(dayLabel("not a day")).toBe("not a day");
  });

  it("a day with no rows is 0 (every day of the window is a row)", () => {
    const series = daySeries([row("2026-10-30", { counted_tokens: 100 }), row("2026-10-28", { counted_tokens: 50 })], NOW, 4);
    expect(series.map((d) => [d.day, d.counted])).toEqual([
      ["2026-10-30", 100],
      ["2026-10-29", 0],
      ["2026-10-28", 50],
      ["2026-10-27", 0],
    ]);
    expect(series[0]).toMatchObject({ today: true, label: "Today · Fri 30 Oct" });
    expect(series[1]).toMatchObject({ today: false, label: "Thu 29 Oct" });
  });

  it("sums a day's rows; cache reads are carried beside the count, never added to it", () => {
    const [today] = daySeries(
      [row("2026-10-30", { agent: "mason", counted_tokens: 100, cache_read_tokens: 4000 }), row("2026-10-30", { agent: "ada", counted_tokens: 20, cache_read_tokens: 1 })],
      NOW,
      1,
    );
    expect(today).toMatchObject({ counted: 120, cacheReads: 4001 });
  });

  it("the estimate is the sum of the recorded ones and null when none was recorded", () => {
    const mixed = daySeries([row("2026-10-30", { cost_estimate_usd: 0.5 }), row("2026-10-30", { cost_estimate_usd: null }), row("2026-10-30", { cost_estimate_usd: 0.25 })], NOW, 1);
    expect(mixed[0]?.cost).toBe(0.75);
    expect(daySeries([row("2026-10-30"), row("2026-10-30")], NOW, 1)[0]?.cost).toBeNull();
    expect(daySeries([], NOW, 1)[0]?.cost).toBeNull();
  });

  it("a row outside the window is ignored", () => {
    expect(daySeries([row("2026-10-01", { counted_tokens: 999 })], NOW, 3).every((d) => d.counted === 0)).toBe(true);
  });

  it("each day is a share of the busiest day; 0 when no day used anything", () => {
    expect(busiestShare(50, 200)).toBe(25);
    expect(busiestShare(200, 200)).toBe(100);
    expect(busiestShare(0, 0)).toBe(0);
  });
});

describe("limits and the waiting-on-you band", () => {
  const usage = (limits: BudgetLimitUsage[]): Pick<BudgetUsageResponse, "limits"> => ({ limits });

  it("an agent at its limit waits on you; an agent with no limit, or under it, does not; a playbook is not an agent", () => {
    const waiting = waitingAgents(
      usage([
        limit("wright", { tokens_today: 12380 }),
        limit("mason", { tokens_today: 47844, tokens_per_day: 150000 }),
        limit("ada", { tokens_today: 100000, tokens_per_day: 100000 }),
        limit("review-prs", { scope: "playbook", tokens_today: 5, tokens_per_day: 5 }),
      ]),
    );
    expect(waiting.map((l) => l.id)).toEqual(["ada"]);
  });

  it("names the agent, its figures and where to raise the limit", () => {
    expect(bandText([{ name: "Ada", used: 100000, limit: 100000 }])).toBe(
      "1 agent waits on you: Ada used 100,000 of its 100,000 tokens today, so its new sessions wait until midnight. Raise its limit in Team to continue.",
    );
    expect(
      bandText([
        { name: "Ada", used: 100000, limit: 100000 },
        { name: "Mason", used: 150000, limit: 150000 },
      ]),
    ).toBe(
      "2 agents wait on you: Ada used 100,000 of its 100,000 tokens today; Mason used 150,000 of its 150,000 tokens today, so their new sessions wait until midnight. Raise their limits in Team to continue.",
    );
  });

  it("empty means no rows and nothing used today under any limit", () => {
    const base: BudgetUsageResponse = { rows: [], limits: [limit("wright")], cap_state: [] };
    expect(isEmptyUsage(base)).toBe(true);
    expect(isEmptyUsage({ ...base, rows: [row("2026-10-30")] })).toBe(false);
    expect(isEmptyUsage({ ...base, limits: [limit("wright", { tokens_today: 1 })] })).toBe(false);
  });

  it("an agent's name is its display name, else its id, both made inert", () => {
    expect(agentName("ada", [{ id: "ada", display_name: "Ada" }])).toBe("Ada");
    expect(agentName("ada", [])).toBe("ada");
    expect(agentName("ada", undefined)).toBe("ada");
    expect(agentName("a‮b", [{ id: "a‮b", display_name: " " }])).toBe("a\\u202eb");
  });
});

describe("the subscription cap", () => {
  it("allowed is ok, allowed_warning reads 'warning', rejected is danger, anything else is shown verbatim and neutral", () => {
    expect(capStatusView("allowed")).toEqual({ label: "allowed", tone: "ok" });
    expect(capStatusView("allowed_warning")).toEqual({ label: "warning", tone: "attention" });
    expect(capStatusView("rejected")).toEqual({ label: "rejected", tone: "danger" });
    expect(capStatusView("surprise")).toEqual({ label: "surprise", tone: "neutral" });
  });

  it("utilization is a 0 to 1 fraction shown as a whole percent, clamped", () => {
    expect(utilizationPercent(0.41)).toBe(41);
    expect(utilizationPercent(0.835)).toBe(84);
    expect(utilizationPercent(1.7)).toBe(100);
    expect(utilizationPercent(-0.2)).toBe(0);
    expect(utilizationPercent(null)).toBeNull();
    expect(utilizationPercent(Number.NaN)).toBeNull();
  });

  it("resets today read 'today 17:00', later days carry the weekday and date", () => {
    expect(resetLabel(new Date(2026, 9, 30, 17, 0).toISOString(), NOW)).toBe("today 17:00");
    expect(resetLabel(new Date(2026, 10, 2, 9, 0).toISOString(), NOW)).toBe("Mon 2 Nov 09:00");
    expect(resetLabel("later", NOW)).toBe("later");
  });

  const window = (o: Partial<BudgetCapState[number]["limits"][number]> = {}) => ({ utilization: 0.41, resets_at: new Date(2026, 9, 30, 17, 0).toISOString(), reset_source: null, ...o });

  it("the caption: 'N% used · resets <time>'", () => {
    expect(capCaption(window(), NOW)).toBe("41% used · resets today 17:00");
  });

  it("a recheck reads 'reset unknown · rechecked <time>'", () => {
    expect(capCaption(window({ reset_source: "recheck" }), NOW)).toBe("41% used · reset unknown · rechecked today 17:00");
    expect(capCaption(window({ reset_source: "recheck", resets_at: null }), NOW)).toBe("41% used · reset unknown");
  });

  it("no reset time and no utilization say so", () => {
    expect(capCaption(window({ resets_at: null }), NOW)).toBe("41% used · no reset time");
    expect(capCaption(window({ utilization: null }), NOW)).toBe("usage not reported · resets today 17:00");
  });

  it("the account is labelled from GET /status when the live store has the provider, else it is the provider id", () => {
    const status: BudgetCapState = [{ account: "personal subscription", provider: "subscription-token", limits: [] }];
    expect(capAccountLabel({ account: "subscription-token", provider: "subscription-token" }, status)).toBe("personal subscription");
    expect(capAccountLabel({ account: "subscription-token", provider: "subscription-token" }, undefined)).toBe("subscription-token");
    expect(capAccountLabel({ account: "other", provider: "other" }, status)).toBe("other");
  });

  it("the note says whether a window is rejected", () => {
    const entry = (status: string): BudgetCapState => [{ account: "a", provider: "a", limits: [{ rate_limit_type: "five_hour", status, resets_at: null, utilization: null, reset_source: null }] }];
    expect(capNote(entry("allowed"))).toBe("No window is rejected, so nothing is parked on the cap.");
    expect(capNote(entry("rejected"))).toContain("rejected");
    expect(capNote([])).toBe("No cap state has been reported yet.");
  });
});

describe("the audit query", () => {
  const T = Date.parse("2026-10-30T12:00:00.000Z");

  it("no filter: the page size and a 7 day since, no until", () => {
    expect(auditQuery(NO_FILTER, 8, undefined, T)).toEqual({ limit: "8", since: "2026-10-23T12:00:00.000Z" });
  });

  it("each filter and the cursor are sent; the range is now minus its length", () => {
    expect(auditQuery({ kind: "admission_refused", agent: "mason", playbook: "review-prs", range: "1h" }, 8, "300", T)).toEqual({
      limit: "8",
      since: "2026-10-30T11:00:00.000Z",
      kind: "admission_refused",
      agent: "mason",
      playbook: "review-prs",
      before: "300",
    });
    expect(auditQuery({ ...NO_FILTER, range: "24h" }, 8, undefined, T).since).toBe("2026-10-29T12:00:00.000Z");
  });

  it("the latest events are the newest few with no since", () => {
    expect(latestQuery()).toEqual({ limit: "3" });
  });

  it("a filter is on when anything differs from the default; the default range is off", () => {
    expect(filterActive(NO_FILTER)).toBe(false);
    expect(filterActive({ ...NO_FILTER, kind: "x" })).toBe(true);
    expect(filterActive({ ...NO_FILTER, agent: "x" })).toBe(true);
    expect(filterActive({ ...NO_FILTER, playbook: "x" })).toBe(true);
    expect(filterActive({ ...NO_FILTER, range: "24h" })).toBe(true);
    expect(RANGES.map((r) => r.value)).toEqual(["7d", "24h", "1h"]);
  });

  it("two filters have the same key only when every field is the same", () => {
    expect(filterKey(NO_FILTER)).toBe(filterKey({ ...NO_FILTER }));
    expect(filterKey({ ...NO_FILTER, kind: "a" })).not.toBe(filterKey({ ...NO_FILTER, agent: "a" }));
  });
});

describe("paging (keyset: a cursor stack, no total)", () => {
  it("starts at the first page; Older pushes the cursor and Newer pops it", () => {
    expect(isFirstPage(FIRST_PAGE)).toBe(true);
    expect(pageNumber(FIRST_PAGE)).toBe(1);
    expect(currentCursor(FIRST_PAGE)).toBeUndefined();
    const second = pageOlder(FIRST_PAGE, "100");
    const third = pageOlder(second, "92");
    expect([pageNumber(third), currentCursor(third), isFirstPage(third)]).toEqual([3, "92", false]);
    expect(currentCursor(pageNewer(third))).toBe("100");
    expect(pageNewer(pageNewer(third))).toEqual(FIRST_PAGE);
  });

  it("Newer on the first page stays on it", () => {
    expect(pageNewer(FIRST_PAGE)).toBe(FIRST_PAGE);
  });

  it("the footer names the rows and the page, never a total", () => {
    expect(footerText(1, 8)).toBe("Showing rows 1–8 · page 1 · newest first");
    expect(footerText(2, 8)).toBe("Showing rows 9–16 · page 2 · newest first");
    expect(footerText(3, 4)).toBe("Showing rows 17–20 · page 3 · newest first");
    expect(footerText(1, 0)).toBe("0 events · newest first");
  });

  it("the next cursor is the page's, else null", () => {
    expect(nextCursor({ next_before: "88" })).toBe("88");
    expect(nextCursor({ next_before: null })).toBeNull();
    expect(nextCursor({ next_before: "" })).toBeNull();
    expect(nextCursor(undefined)).toBeNull();
  });
});

describe("an event as a row", () => {
  it("Actor is the payload's agent, else '—' (EventFrame carries no actor; nothing is guessed)", () => {
    expect(actorOf({ agent: "mason", reason: "x" })).toBe("mason");
    expect(actorOf({ reason: "x" })).toBe("—");
    expect(actorOf({ agent: "  " })).toBe("—");
    expect(actorOf({ agent: 7 })).toBe("—");
    expect(actorOf(null)).toBe("—");
    expect(actorOf("plain text")).toBe("—");
    expect(actorOf(["mason"])).toBe("—");
  });

  it("the summary is the payload's text, reason or message, in that order, else compact JSON", () => {
    expect(summaryOf({ text: "a", reason: "b", message: "c" })).toBe("a");
    expect(summaryOf({ reason: "b", message: "c" })).toBe("b");
    expect(summaryOf({ message: "c" })).toBe("c");
    expect(summaryOf({ n: 1, ok: true })).toBe('{"n":1,"ok":true}');
    expect(summaryOf("not json {")).toBe("not json {");
    expect(summaryOf(null)).toBe("");
    expect(summaryOf(undefined)).toBe("");
  });

  it("a long summary is truncated, and control characters are written out", () => {
    const long = summaryOf({ text: "x".repeat(500) });
    expect(long.length).toBe(160);
    expect(long.endsWith("…")).toBe(true);
    expect(summaryOf({ text: "a\u001b[31mb" })).toBe("a\\x1b[31mb");
  });

  it("refs name the task, the session and the playbook; a playbook id is shown only when it resolves to a slug", () => {
    const playbooks = [{ id: 4, slug: "review-prs" }];
    expect(refsOf({ task_id: 9, session_id: 41, payload: { playbook: "review-prs" } }, playbooks)).toBe("task 9 · session 41 · playbook review-prs");
    expect(refsOf({ task_id: null, session_id: 41, payload: { playbook: 4 } }, playbooks)).toBe("session 41 · playbook review-prs");
    expect(refsOf({ task_id: null, session_id: null, payload: { playbook: 99 } }, playbooks)).toBe("");
    expect(refsOf({ task_id: null, session_id: null, payload: { playbook: 4 } }, undefined)).toBe("");
    expect(refsOf({ task_id: null, session_id: null, payload: "oops" }, playbooks)).toBe("");
  });

  const ev = (id: number, kind = "k", payload: unknown = {}) => ({ type: "event" as const, id, at: "2026-10-30T10:00:00.000Z", kind, session_id: null, task_id: null, payload });

  it("rows are newest first, each id once, and anything that is not an event is dropped", () => {
    const page = { events: [ev(3), ev(5), ev(3), { nope: true }, null, ev(4, "x")] as never, next_before: null };
    expect(auditRows(page, undefined).map((r) => r.id)).toEqual([5, 4, 3]);
    expect(auditRows({ events: "nope" as never, next_before: null }, undefined)).toEqual([]);
    expect(auditRows(undefined, undefined)).toEqual([]);
  });

  it("a row carries the made-inert kind, the actor, the summary and the refs", () => {
    const [r] = auditRows({ events: [{ ...ev(7, "admission_refused‮", { agent: "mason", reason: "agent_sessions_at_once" }), task_id: 2, session_id: 3 }], next_before: null }, undefined);
    expect(r).toMatchObject({ id: 7, kind: "admission_refused\\u202e", actor: "mason", summary: "agent_sessions_at_once", refs: "task 2 · session 3" });
  });

  it("the Kind select offers the kinds seen plus the one filtered on, sorted", () => {
    expect(kindOptions(new Set(["b", "a"]), "")).toEqual(["a", "b"]);
    expect(kindOptions(new Set(["b"]), "admission_refused")).toEqual(["admission_refused", "b"]);
  });

  it("the newest event id is the feed's last, 0 when there is none", () => {
    expect(newestEventId([{ id: 3 }, { id: 9 }])).toBe(9);
    expect(newestEventId([])).toBe(0);
  });
});
