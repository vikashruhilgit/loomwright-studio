// Budget & audit's view model (phase 7 item 07): the pure logic behind the screen. Plain vitest,
// no DOM. The screen itself is covered by `BudgetScreen.test.tsx`, the built app by `e2e/budget.spec.ts`.
import { describe, expect, it } from "vitest";
import type { BudgetLimitUsage, BudgetUsageResponse, BudgetUsageRow } from "../../api/contract";
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
  capStatusView,
  count,
  countBadge,
  countOf,
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
  summaryText,
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

describe("paging (keyset: a cursor stack; the route's counts only label the page)", () => {
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

  it("the footer names the rows, the filtered total and the page count when the kernel sent a count", () => {
    expect(footerText(1, 8, 20)).toBe("Showing 1–8 of 20 · page 1 of 3 · newest first");
    expect(footerText(2, 8, 20)).toBe("Showing 9–16 of 20 · page 2 of 3 · newest first");
    expect(footerText(3, 4, 20)).toBe("Showing 17–20 of 20 · page 3 of 3 · newest first");
    expect(footerText(1, 3, 3)).toBe("Showing 1–3 of 3 · page 1 of 1 · newest first");
    expect(footerText(1, 0, 0)).toBe("0 events · newest first");
    expect(footerText(1, 0)).toBe("0 events · newest first");
  });

  it("an older kernel sends no count: the footer falls back to rows and page, never a total", () => {
    expect(footerText(1, 8)).toBe("Showing rows 1–8 · page 1 · newest first");
    expect(footerText(2, 8, undefined)).toBe("Showing rows 9–16 · page 2 · newest first");
    expect(footerText(3, 4)).toBe("Showing rows 17–20 · page 3 · newest first");
    // A damaged count is no count.
    expect(footerText(1, 8, -3)).toBe("Showing rows 1–8 · page 1 · newest first");
    expect(footerText(1, 8, 1.5)).toBe("Showing rows 1–8 · page 1 · newest first");
  });

  it("the badge beside the title reads 'N of M events', and is absent without both counts", () => {
    expect(countBadge({ matching: 20, total: 20 })).toBe("20 of 20 events");
    expect(countBadge({ matching: 3, total: 20 })).toBe("3 of 20 events");
    expect(countBadge({ matching: 1, total: 1 })).toBe("1 of 1 event");
    expect(countBadge({ matching: 1234, total: 5678 })).toBe("1,234 of 5,678 events");
    expect(countBadge({ matching: 3 })).toBeUndefined();
    expect(countBadge({ total: 3 })).toBeUndefined();
    expect(countBadge({})).toBeUndefined();
    expect(countBadge(undefined)).toBeUndefined();
    expect(countOf("7")).toBeUndefined();
    expect(countOf(Number.NaN)).toBeUndefined();
    expect(countOf(0)).toBe(0);
  });

  it("the next cursor is the page's, else null", () => {
    expect(nextCursor({ next_before: "88" })).toBe("88");
    expect(nextCursor({ next_before: null })).toBeNull();
    expect(nextCursor({ next_before: "" })).toBeNull();
    expect(nextCursor(undefined)).toBeNull();
  });
});

describe("an event as a row", () => {
  const ev = (id: number, kind = "k", payload: unknown = {}) => ({ type: "event" as const, id, at: "2026-10-30T10:00:00.000Z", kind, session_id: null, task_id: null, payload });

  it("Actor is the route's actor: an agent by its roster display name, 'you' or 'kernel', never '—'", () => {
    const roster = [{ id: "mason", display_name: "Mason" }];
    expect(actorOf("mason", roster)).toBe("Mason");
    expect(actorOf("ada", roster)).toBe("ada");
    expect(actorOf("you", roster)).toBe("you");
    expect(actorOf("kernel", roster)).toBe("kernel");
    expect(actorOf("a‮b", undefined)).toBe("a\\u202eb");
  });

  it("an older kernel sends no actor: the row reads 'kernel', and the payload's agent is not taken for one", () => {
    expect(actorOf(undefined, undefined)).toBe("kernel");
    expect(actorOf(null, undefined)).toBe("kernel");
    expect(actorOf("  ", undefined)).toBe("kernel");
    expect(actorOf(7, undefined)).toBe("kernel");
    const [r] = auditRows({ events: [ev(1, "cap_warning", { agent: "mason" })], next_before: null }, undefined, undefined, NOW);
    expect(r?.actor).toBe("kernel");
  });

  it("the count line is 'N tokens today' (the subtitle adds 'last known')", () => {
    expect(summaryText(61924)).toBe("61,924 tokens today");
    expect(summaryText(0)).toBe("0 tokens today");
  });

  it("refs name the task, the session and the playbook; a playbook id is shown only when it resolves to a slug", () => {
    const playbooks = [{ id: 4, slug: "review-prs" }];
    expect(refsOf({ task_id: 9, session_id: 41, payload: { playbook: "review-prs" } }, playbooks)).toBe("task 9 · session 41 · playbook review-prs");
    expect(refsOf({ task_id: null, session_id: 41, payload: { playbook: 4 } }, playbooks)).toBe("session 41 · playbook review-prs");
    expect(refsOf({ task_id: null, session_id: null, payload: { playbook: 99 } }, playbooks)).toBe("");
    expect(refsOf({ task_id: null, session_id: null, payload: { playbook: 4 } }, undefined)).toBe("");
    expect(refsOf({ task_id: null, session_id: null, payload: "oops" }, playbooks)).toBe("");
  });

  it("rows are newest first, each id once, and anything that is not an event is dropped", () => {
    const page = { events: [ev(3), ev(5), ev(3), { nope: true }, null, ev(4, "x")] as never, next_before: null };
    expect(auditRows(page, undefined, undefined, NOW).map((r) => r.id)).toEqual([5, 4, 3]);
    expect(auditRows({ events: "nope" as never, next_before: null }, undefined, undefined, NOW)).toEqual([]);
    expect(auditRows(undefined, undefined, undefined, NOW)).toEqual([]);
  });

  it("a row carries the made-inert kind, the actor, the sentence and the refs", () => {
    const roster = [{ id: "mason", display_name: "Mason" }];
    const [r] = auditRows({ events: [{ ...ev(7, "admission_refused", { agent: "mason", kind: "start", reason: "agent_sessions_at_once" }), actor: "mason", task_id: 2, session_id: 3 }], next_before: null }, undefined, roster, NOW);
    expect(r).toMatchObject({ id: 7, kind: "admission_refused", actor: "Mason", summary: "A session start for Mason was refused: agent sessions at once.", refs: "task 2 · session 3" });
  });

  it("a kind with no sentence is made inert and reads 'no description yet', never its payload as JSON", () => {
    const [r] = auditRows({ events: [ev(7, "made_up‮", { secret: "x", nested: { a: 1 } })], next_before: null }, undefined, undefined, NOW);
    expect(r?.kind).toBe("made_up\\u202e");
    expect(r?.summary).toBe("made_up\\u202e · no description yet");
    expect(r?.summary).not.toMatch(/[{}]/);
  });

  it("a sentence names a playbook by its listing's name, by slug or by id", () => {
    const playbooks = [{ id: 4, slug: "review-prs", name: "Review PRs on studio-sandbox" }];
    const rows = auditRows({ events: [ev(2, "playbook_enabled", { playbook_id: 4, version: 1, by: "owner" }), ev(1, "playbook_updated", { playbook: "review-prs", version: 3, fields: ["priority"], by: "you" })], next_before: null }, playbooks, undefined, NOW);
    expect(rows.map((r) => r.summary)).toEqual([
      "Playbook Review PRs on studio-sandbox v1 was turned on by owner.",
      "Playbook Review PRs on studio-sandbox was updated to v3: priority by you.",
    ]);
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
