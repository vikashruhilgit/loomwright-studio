// The menu bar's shared model (item 17, AC1, AC4): the state precedence
// killed > paused > waiting > cap > working > idle, the word and dot for each
// state, the closed `loomwright-studio://` grammar, and the route grammar the
// main process sends the renderer.
import { describe, expect, it } from "vitest";
import type { StatusBody } from "../../api/contract";
import {
  DEEP_LINK_PREFIX,
  INVALID_LINK_ROUTE,
  MENUBAR_DOTS,
  MENUBAR_WORDS,
  TRAY_SEAM_ENV,
  menubarState,
  navigateRouteFor,
  parseDeepLink,
  parseNavigateRoute,
} from "./state";
import type { MenubarState } from "./state";

type Limit = StatusBody["cap_state"][number]["limits"][number];

function status(over: { engaged?: boolean; paused?: boolean; sessions?: number; limits?: string[] } = {}): StatusBody {
  const limits: Limit[] = (over.limits ?? []).map((s) => ({ rate_limit_type: "five_hour", status: s, resets_at: null, utilization: null, reset_source: null }));
  return {
    kernel: { version: "0.0.0", uptime_s: 1, pid: 1 },
    kill_switch: { engaged: over.engaged ?? false, since: null },
    ...(over.paused === undefined ? {} : { paused: over.paused }),
    auth: [],
    sessions: Array.from({ length: over.sessions ?? 0 }, (_, i) => ({ id: i + 1, agent: "wright", model: null, pgid: null, started_at: null, status: "running", cwd: null })),
    kill_unconfirmed: [],
    orphaned: [],
    queue: { pending: 0, events: [] },
    wakeups: { pending: 0, items: [] },
    tokens_today: { day: "2026-10-23", agents: [] },
    cap_state: limits.length === 0 ? [] : [{ account: "a", provider: "anthropic", limits }],
  };
}

describe("menubarState", () => {
  it("names every state", () => {
    expect(menubarState(status(), 0)).toBe("idle");
    expect(menubarState(status({ sessions: 1 }), 0)).toBe("working");
    expect(menubarState(status({ limits: ["allowed", "rejected"] }), 0)).toBe("cap");
    expect(menubarState(status(), 2)).toBe("waiting");
    expect(menubarState(status({ paused: true }), 0)).toBe("paused");
    expect(menubarState(status({ engaged: true }), 0)).toBe("killed");
  });

  it("killed outranks paused, and every lower state", () => {
    expect(menubarState(status({ engaged: true, paused: true, sessions: 3, limits: ["rejected"] }), 4)).toBe("killed");
  });

  it("paused outranks waiting, cap and working", () => {
    expect(menubarState(status({ paused: true, sessions: 3, limits: ["rejected"] }), 4)).toBe("paused");
  });

  it("waiting outranks cap and working", () => {
    expect(menubarState(status({ sessions: 3, limits: ["rejected"] }), 1)).toBe("waiting");
  });

  it("cap outranks working", () => {
    expect(menubarState(status({ sessions: 3, limits: ["rejected"] }), 0)).toBe("cap");
  });

  it("is not at cap for `allowed` or `allowed_warning`, nor paused for `paused: false` or an absent `paused`", () => {
    expect(menubarState(status({ limits: ["allowed", "allowed_warning"] }), 0)).toBe("idle");
    expect(menubarState(status({ paused: false }), 0)).toBe("idle");
    expect(menubarState(status(), 0)).toBe("idle");
  });

  it("has a word and a StatusDot state for each", () => {
    const states: MenubarState[] = ["idle", "working", "waiting", "cap", "paused", "killed"];
    expect(states.map((s) => MENUBAR_WORDS[s])).toEqual(["idle", "working", "waiting on you", "paused at cap", "paused", "killed"]);
    expect(states.map((s) => MENUBAR_DOTS[s])).toEqual(["idle", "working", "waiting", "paused", "paused", "failed"]);
  });
});

describe("parseDeepLink", () => {
  it("accepts exactly the kernel's notification link", () => {
    expect(DEEP_LINK_PREFIX).toBe("loomwright-studio://notifications/");
    expect(parseDeepLink("loomwright-studio://notifications/7")).toEqual({ kind: "notification", id: 7 });
    expect(parseDeepLink("loomwright-studio://notifications/9007199254740991")).toEqual({ kind: "notification", id: 9007199254740991 });
  });

  it("refuses loomwright-studio://approve/7: a link names a notification, never an action", () => {
    expect(parseDeepLink("loomwright-studio://approve/7")).toEqual({ kind: "invalid" });
  });

  it.each([
    "loomwright-studio://notifications/0",
    "loomwright-studio://notifications/07",
    "loomwright-studio://notifications/abc",
    "loomwright-studio://notifications/-7",
    "loomwright-studio://notifications/7.0",
    "loomwright-studio://notifications/",
    "loomwright-studio://notifications",
    "loomwright-studio://notifications/7/",
    "loomwright-studio://notifications/7/approve",
    "loomwright-studio://notifications/7?x",
    "loomwright-studio://notifications/7?approve=1",
    "loomwright-studio://notifications/7#x",
    "loomwright-studio://user:pw@notifications/7",
    "loomwright-studio://notifications:80/7",
    "loomwright-studio://Notifications/7",
    "LOOMWRIGHT-STUDIO://notifications/7",
    "loomwright-studio:notifications/7",
    "loomwright-studio:///notifications/7",
    "https://notifications/7",
    "other://notifications/7",
    " loomwright-studio://notifications/7",
    "loomwright-studio://notifications/7\n",
    "loomwright-studio://notifications/%37",
    "loomwright-studio://notifications/12345678901234567",
    // 16 digits past 2^53 cannot be named exactly.
    "loomwright-studio://notifications/9999999999999999",
    "",
  ])("refuses %j", (url) => {
    expect(parseDeepLink(url)).toEqual({ kind: "invalid" });
  });

  it("refuses a value that is not a string", () => {
    expect(parseDeepLink(undefined)).toEqual({ kind: "invalid" });
    expect(parseDeepLink(7)).toEqual({ kind: "invalid" });
    expect(parseDeepLink({ toString: () => "loomwright-studio://notifications/7" })).toEqual({ kind: "invalid" });
  });
});

describe("the navigate route", () => {
  it("is notification/<id> or invalid-link, and nothing else", () => {
    expect(navigateRouteFor(parseDeepLink("loomwright-studio://notifications/7"))).toBe("notification/7");
    expect(navigateRouteFor(parseDeepLink("loomwright-studio://approve/7"))).toBe(INVALID_LINK_ROUTE);
    expect(INVALID_LINK_ROUTE).toBe("invalid-link");
  });

  it("parses back on the renderer side", () => {
    expect(parseNavigateRoute("notification/7")).toEqual({ kind: "notification", id: 7 });
    expect(parseNavigateRoute("invalid-link")).toEqual({ kind: "invalid-link" });
  });

  it.each(["notification/0", "notification/abc", "notification/7/x", "notifications/7", "/notification/7", "loomwright-studio://notifications/7", "approvals/7", "", "notification/9999999999999999"])(
    "reads %j as invalid-link",
    (route) => {
      expect(parseNavigateRoute(route)).toEqual({ kind: "invalid-link" });
    },
  );

  it("reads a value that is not a string as invalid-link", () => {
    expect(parseNavigateRoute(undefined)).toEqual({ kind: "invalid-link" });
    expect(parseNavigateRoute(7)).toEqual({ kind: "invalid-link" });
  });
});

describe("the tray seam", () => {
  it("is named by one env var", () => {
    expect(TRAY_SEAM_ENV).toBe("STUDIO_APP_TRAY_SEAM");
  });
});
