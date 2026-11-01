// The subscription cap card's logic (phase 7 item 17): a window whose reset has passed reads stale with its
// last-read time, the account reads by its display name, and only an unexpired rejected window parks work.
// Plain vitest, no DOM. The card on screen is covered by `BudgetScreen.test.tsx`.
import { describe, expect, it } from "vitest";
import type { BudgetCapState, BudgetUsageCapState } from "../../api/contract";
import { capAccountLabel, capCaption, capNote, capWindowView, isStale, staleCaption } from "./cap";
import type { UsageCapWindow } from "./cap";

// Sun 1 Nov 2026, 14:22 local time.
const NOW = new Date(2026, 10, 1, 14, 22, 0);
const at = (...parts: [number, number, number, number, number]): string => new Date(...parts).toISOString();
const LATER = at(2026, 10, 1, 17, 0);
const PAST = at(2026, 9, 30, 0, 30);
const READ = at(2026, 9, 29, 21, 5);

const window = (o: Partial<UsageCapWindow> = {}): UsageCapWindow => ({ rate_limit_type: "five_hour", status: "allowed", utilization: 0.41, resets_at: LATER, reset_source: null, ...o });

describe("a window past its reset is stale", () => {
  it("a reset before now is stale; equal to now is stale; ahead is live", () => {
    expect(isStale(window({ resets_at: PAST }), NOW)).toBe(true);
    expect(isStale(window({ resets_at: NOW.toISOString() }), NOW)).toBe(true);
    expect(isStale(window({ resets_at: LATER }), NOW)).toBe(false);
  });

  it("no reset time and a reset that does not parse are not stale", () => {
    expect(isStale(window({ resets_at: null }), NOW)).toBe(false);
    expect(isStale(window({ resets_at: "soon" }), NOW)).toBe(false);
  });

  it("a stale window keeps its last-read status word in a neutral tone and never shows 'resets <past time>'", () => {
    const view = capWindowView(window({ status: "allowed_warning", resets_at: PAST, updated_at: READ }), NOW);
    expect(view.stale).toBe(true);
    expect(view.status).toEqual({ label: "warning", tone: "neutral" });
    expect(view.caption).toBe("last read Thu 29 Oct 21:05 · window ended Fri 30 Oct 00:30");
    expect(view.caption).not.toContain("resets");
    // The last-read utilization is old: no meter.
    expect(view.percent).toBeNull();
  });

  it("the last-read status word keeps its wording whatever it was", () => {
    expect(capWindowView(window({ status: "allowed", resets_at: PAST }), NOW).status).toEqual({ label: "allowed", tone: "neutral" });
    expect(capWindowView(window({ status: "rejected", resets_at: PAST }), NOW).status).toEqual({ label: "rejected", tone: "neutral" });
    expect(capWindowView(window({ status: "surprise", resets_at: PAST }), NOW).status).toEqual({ label: "surprise", tone: "neutral" });
  });

  it("an older kernel sends no updated_at: the caption says the last-read time is unknown", () => {
    expect(staleCaption({ resets_at: PAST }, NOW)).toBe("last read time unknown · window ended Fri 30 Oct 00:30");
    expect(staleCaption({ resets_at: PAST, updated_at: "garbage" }, NOW)).toBe("last read time unknown · window ended Fri 30 Oct 00:30");
  });

  it("a live window reads as before: its tone, a meter and 'N% used · resets <time>'", () => {
    const view = capWindowView(window({ status: "allowed_warning" }), NOW);
    expect(view).toEqual({ stale: false, status: { label: "warning", tone: "attention" }, percent: 41, caption: "41% used · resets today 17:00" });
  });
});

describe("the live caption", () => {
  it("'N% used · resets <time>'", () => {
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
});

describe("the account's display name", () => {
  const entry = (provider: string, account: string = provider) => ({ account, provider });
  const status = (provider: string, account: string): BudgetCapState => [{ account, provider, limits: [] }];

  it("the subscription provider reads 'personal subscription' when the status entry has no label or one equal to its id", () => {
    expect(capAccountLabel(entry("subscription-token"), undefined)).toBe("personal subscription");
    expect(capAccountLabel(entry("subscription-token"), [])).toBe("personal subscription");
    expect(capAccountLabel(entry("subscription-token"), status("subscription-token", ""))).toBe("personal subscription");
    expect(capAccountLabel(entry("subscription-token"), status("subscription-token", "  "))).toBe("personal subscription");
    expect(capAccountLabel(entry("subscription-token"), status("subscription-token", "subscription-token"))).toBe("personal subscription");
  });

  it("a provider with an account label reads that label", () => {
    expect(capAccountLabel(entry("subscription-token"), status("subscription-token", "work subscription"))).toBe("work subscription");
    expect(capAccountLabel(entry("subscription-token"), status("api-key", "other"))).toBe("personal subscription");
  });

  it("the API key provider reads 'API key'; any other id shows as itself", () => {
    expect(capAccountLabel(entry("api-key"), undefined)).toBe("API key");
    expect(capAccountLabel(entry("other"), status("other", "other"))).toBe("other");
    expect(capAccountLabel(entry("other"), undefined)).toBe("other");
  });

  it("an entry that carries its own label (a contributed route) shows it", () => {
    expect(capAccountLabel(entry("subscription-token", "team seat"), undefined)).toBe("team seat");
  });

  it("a provider named like an Object.prototype key is shown as itself", () => {
    expect(capAccountLabel(entry("constructor"), undefined)).toBe("constructor");
    expect(capAccountLabel(entry("__proto__"), undefined)).toBe("__proto__");
  });

  it("the label is made inert text", () => {
    expect(capAccountLabel(entry("x", "a‮b"), undefined)).toBe("a\\u202eb");
  });
});

describe("the note under the windows", () => {
  const cap = (...windows: UsageCapWindow[]): BudgetUsageCapState => [{ account: "a", provider: "a", limits: windows }];

  it("says nothing is parked unless an unexpired rejected window exists", () => {
    expect(capNote(cap(window()), NOW)).toBe("No window is rejected, so nothing is parked on the cap.");
    expect(capNote(cap(window({ status: "rejected" })), NOW)).toBe("A window is rejected, so sessions wait on the cap until it resets.");
    expect(capNote(cap(window({ status: "rejected", resets_at: null })), NOW)).toBe("A window is rejected, so sessions wait on the cap until it resets.");
    expect(capNote([], NOW)).toBe("No cap state has been reported yet.");
  });

  it("an expired rejected window is not a park", () => {
    expect(capNote(cap(window({ status: "rejected", resets_at: PAST })), NOW)).toBe("A rejected window has ended, so nothing is parked on the cap.");
  });

  it("a stale 'warning' (a seven_day allowed_warning past its reset) is not a park either", () => {
    expect(capNote(cap(window({ rate_limit_type: "seven_day", status: "allowed_warning", resets_at: PAST, updated_at: READ })), NOW)).toBe("No window is rejected, so nothing is parked on the cap.");
  });

  it("an unexpired rejected window beside an expired one still parks", () => {
    expect(capNote(cap(window({ status: "rejected", resets_at: PAST }), window({ rate_limit_type: "seven_day", status: "rejected" })), NOW)).toContain("sessions wait");
  });
});
