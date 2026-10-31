// Settings' view model: the held view's parse (known fields only, inert text), the health's words
// and tone, the token's life and its days left, the band, the login item's note and the feed's
// kinds that make the screen read again.
import { describe, expect, it } from "vitest";
import {
  KEYCHAIN_ITEM,
  SETTINGS_TEST_IDS,
  TOKEN_LIFETIME_DAYS,
  bandOf,
  commandsHeading,
  dateLabel,
  daysLeftText,
  hasToken,
  healthView,
  isSettingsEvent,
  loginNote,
  newestSettingsEventId,
  parseSettings,
  tokenLife,
  viewReply,
} from "./model";
import type { SettingsView } from "./model";

const NOW = new Date(2026, 9, 30, 12, 0, 0);
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: { id: "subscription-token", account: "personal subscription", health: { status: "ok" }, token_created_at: daysAgo(100) },
    data_dir: "/Users/o/.loomwright-studio",
    notifier: "osascript",
    loomwright: { status: "ok", install_path: "/Users/o/.claude/plugins/loomwright", plugin_version: "17.22.0", contract_schema_version: 1, host_switch: true },
    ...overrides,
  };
}

function view(health: unknown, created: string | null = daysAgo(100)): SettingsView {
  const parsed = parseSettings(body({ provider: { id: "subscription-token", account: "a", health, token_created_at: created } }));
  if (parsed === undefined) throw new Error("the body did not parse");
  return parsed;
}

describe("the test ids", () => {
  it("are unique values, and the root is the screen's id", () => {
    const values = Object.values(SETTINGS_TEST_IDS);
    expect(new Set(values).size).toBe(values.length);
    expect(SETTINGS_TEST_IDS.screen).toBe("screen-settings");
  });
});

describe("parseSettings: the contract's known fields, nothing else", () => {
  it("reads the provider, the data dir, the notifier and the Loomwright install", () => {
    expect(parseSettings(body())).toEqual({
      provider: { id: "subscription-token", account: "personal subscription", health: { status: "ok" }, tokenCreatedAt: daysAgo(100) },
      dataDir: "/Users/o/.loomwright-studio",
      notifier: "osascript",
      loomwright: { ok: true, installPath: "/Users/o/.claude/plugins/loomwright" },
    });
  });

  it("drops a field the contract does not declare, at every level", () => {
    const secret = "sk-ant-oat01-NOT-A-REAL-TOKEN";
    const parsed = parseSettings(
      body({
        token: secret,
        provider: { id: "p", account: null, health: { status: "ok", token: secret }, token_created_at: null, secret },
        loomwright: { status: "ok", install_path: "/x", plugin_version: "1", contract_schema_version: 1, host_switch: false, token: secret },
      }),
    );
    expect(parsed).toBeDefined();
    expect(JSON.stringify(parsed)).not.toContain(secret);
  });

  it("keeps the health's own days and reason; a status this build does not know is inert text", () => {
    expect(view({ status: "expiring", days: 18 }).provider.health).toEqual({ status: "expiring", days: 18 });
    expect(view({ status: "error", reason: "health_threw" }).provider.health).toEqual({ status: "error", reason: "health_threw" });
    expect(view({ status: "revoked" }).provider.health).toEqual({ status: "unknown", word: "revoked" });
  });

  it("writes control characters and bidi marks as visible escapes", () => {
    const parsed = parseSettings(body({ provider: { id: "p", account: "a‮b\u001b[31m", health: { status: "ok" }, token_created_at: null }, data_dir: "/tmp/ x" }));
    expect(parsed?.provider.account).toBe("a\\u202eb\\x1b[31m");
    expect(parsed?.dataDir).toBe("/tmp/\\u2028x");
  });

  it("keeps a Loomwright error's reason and a notifier it does not know", () => {
    const parsed = parseSettings(body({ notifier: "growl", loomwright: { status: "error", reason: "not_found", path: "/p", message: "m" } }));
    expect(parsed?.notifier).toBe("growl");
    expect(parsed?.loomwright).toEqual({ ok: false, reason: "not_found" });
  });

  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["no provider", body({ provider: undefined })],
    ["no loomwright", body({ loomwright: null })],
    ["no data_dir", body({ data_dir: 7 })],
    ["a provider without an id", body({ provider: { account: null, health: { status: "ok" }, token_created_at: null } })],
    ["a health without a status", body({ provider: { id: "p", account: null, health: {}, token_created_at: null } })],
    ["an expiring health without days", body({ provider: { id: "p", account: null, health: { status: "expiring" }, token_created_at: null } })],
    ["an account that is a number", body({ provider: { id: "p", account: 5, health: { status: "ok" }, token_created_at: null } })],
  ])("is undefined for %s", (_name, value) => {
    expect(parseSettings(value)).toBeUndefined();
  });

  it("viewReply turns an ok body into the view, a malformed one into a failed reply, and passes every other reply through", () => {
    const ok = viewReply({ kind: "ok", status: 200, body: body() as never });
    expect(ok.kind).toBe("ok");
    expect(viewReply({ kind: "ok", status: 200, body: { nonsense: true } as never })).toEqual({ kind: "failed", message: "the settings answer was not understood" });
    const unreachable = { kind: "unreachable", message: "m" } as const;
    expect(viewReply(unreachable)).toBe(unreachable);
  });
});

describe("health", () => {
  it.each([
    [{ status: "ok" }, "ok", "ok", undefined],
    [{ status: "missing" }, "missing", "danger", "no token in the Keychain item"],
    [{ status: "expiring", days: 18 }, "expiring", "attention", "18 days left"],
    [{ status: "invalid_shape" }, "invalid_shape", "danger", "the Keychain item does not hold a whole token"],
    [{ status: "error", reason: "keychain_unreadable" }, "error", "danger", "keychain_unreadable"],
    [{ status: "unknown", word: "revoked" }, "revoked", "neutral", undefined],
  ] as const)("%j reads %s with a %s tone", (health, label, tone, note) => {
    expect(healthView(health)).toEqual({ label, tone, note });
  });

  it("says days left in the singular and 'expired' for a negative count", () => {
    expect(daysLeftText(1)).toBe("1 day left");
    expect(daysLeftText(0)).toBe("0 days left");
    expect(daysLeftText(-3)).toBe("expired");
  });

  it("a token exists unless the item is missing or not whole; the commands' heading follows", () => {
    expect(hasToken({ status: "ok" })).toBe(true);
    expect(hasToken({ status: "expiring", days: 3 })).toBe(true);
    expect(hasToken({ status: "error", reason: "x" })).toBe(true);
    expect(hasToken({ status: "missing" })).toBe(false);
    expect(hasToken({ status: "invalid_shape" })).toBe(false);
    expect(commandsHeading({ status: "missing" })).toBe("Set it up in your terminal");
    expect(commandsHeading({ status: "ok" })).toBe("Change it in your terminal");
  });
});

describe("the token's life", () => {
  it("is 365 days: created 100 days ago has 265 left and ends 365 days after it was made", () => {
    expect(TOKEN_LIFETIME_DAYS).toBe(365);
    const life = tokenLife(daysAgo(100), NOW);
    expect(life?.daysLeft).toBe(265);
    expect(life?.text).toBe(`365 days · 265 days left · ends ${dateLabel(new Date(NOW.getTime() + 265 * 86_400_000))}`);
    expect(life?.created).toBe(dateLabel(daysAgo(100)));
  });

  it("floors the days left as the kernel does, and counts down to a day, then to expired", () => {
    expect(tokenLife(new Date(NOW.getTime() - 364.5 * 86_400_000).toISOString(), NOW)?.daysLeft).toBe(0);
    expect(tokenLife(daysAgo(364), NOW)?.daysLeft).toBe(1);
    const past = tokenLife(daysAgo(400), NOW);
    expect(past?.daysLeft).toBe(-35);
    expect(past?.text).toContain("expired");
    expect(past?.text).toContain("ended");
  });

  it("is undefined for a creation instant that is not a date", () => {
    expect(tokenLife("not a date", NOW)).toBeUndefined();
    expect(dateLabel("also not")).toBeUndefined();
  });

  it("labels a day as 4 May 2026", () => {
    expect(dateLabel(new Date(2026, 4, 4, 15, 0, 0))).toBe("4 May 2026");
    expect(dateLabel(new Date(2026, 8, 1, 9, 0, 0))).toBe("1 Sep 2026");
  });

  it("names the Keychain item, never a value", () => {
    expect(KEYCHAIN_ITEM).toBe("loomwright-studio-oauth");
  });
});

describe("the band", () => {
  it("expiring: an attention band naming the days and the end date, as a status", () => {
    const band = bandOf(view({ status: "expiring", days: 18 }, daysAgo(347)), NOW);
    expect(band?.tone).toBe("attention");
    expect(band?.role).toBe("status");
    expect(band?.text).toMatch(/^The subscription token expires in 18 days, on \d{1,2} [A-Z][a-z]{2} \d{4}\. Create a new one with the commands below, or sessions stop with failed:auth\.$/);
  });

  it("expiring with no creation date still says the days, and an expired token says so", () => {
    expect(bandOf(view({ status: "expiring", days: 1 }, null), NOW)?.text).toContain("expires in 1 day.");
    expect(bandOf(view({ status: "expiring", days: -2 }, null), NOW)?.text).toContain("has expired");
  });

  it("missing: a danger band as an alert; invalid_shape the same; ok and error have none", () => {
    expect(bandOf(view({ status: "missing" }), NOW)).toEqual({ tone: "danger", role: "alert", text: "There is no token in the Keychain. Without one the crew can't start sessions." });
    expect(bandOf(view({ status: "invalid_shape" }), NOW)?.tone).toBe("danger");
    expect(bandOf(view({ status: "ok" }), NOW)).toBeUndefined();
    expect(bandOf(view({ status: "error", reason: "x" }), NOW)).toBeUndefined();
  });
});

describe("the login item's note", () => {
  it("says what the OS says: needs approval, not found, or a refusal; nothing when it simply took", () => {
    expect(loginNote({ enabled: false, status: "requires-approval" }, false)).toContain("Needs your approval");
    expect(loginNote({ enabled: false, status: "not-found" }, false)).toContain("can't find");
    expect(loginNote({ enabled: false, status: "not-registered" }, true)).toContain("did not change it");
    expect(loginNote({ enabled: true, status: "enabled" }, false)).toBeUndefined();
    expect(loginNote({ enabled: false, status: null }, false)).toBeUndefined();
  });

  it("the OS's approval state wins over a plain refusal", () => {
    expect(loginNote({ enabled: false, status: "requires-approval" }, true)).toContain("Needs your approval");
  });
});

describe("the feed's events that make the screen read again", () => {
  it.each([
    ["auth_token_expiring", true],
    ["auth_health_changed", true],
    ["loomwright_contract_changed", true],
    ["loomwright_", true],
    ["trigger_fired", false],
    ["authentic", false],
    ["session_started", false],
    ["notify", false],
  ])("kind %s: %s", (kind, expected) => {
    expect(isSettingsEvent({ kind })).toBe(expected);
  });

  it("a notify event follows by its payload reason (what the kernel appends today), and only an auth_ or loomwright_ one", () => {
    expect(isSettingsEvent({ kind: "notify", payload: { reason: "auth_token_expiring", provider: "p" } })).toBe(true);
    expect(isSettingsEvent({ kind: "notify", payload: { reason: "auth_failed" } })).toBe(true);
    expect(isSettingsEvent({ kind: "notify", payload: { reason: "event_failed" } })).toBe(false);
    expect(isSettingsEvent({ kind: "notify", payload: "auth_failed" })).toBe(false);
    expect(isSettingsEvent({ kind: "notify", payload: null })).toBe(false);
  });

  it("the newest relevant id, 0 for none", () => {
    expect(newestSettingsEventId([])).toBe(0);
    expect(newestSettingsEventId([{ id: 1, kind: "trigger_fired" }])).toBe(0);
    expect(
      newestSettingsEventId([
        { id: 1, kind: "auth_token_expiring" },
        { id: 2, kind: "trigger_fired" },
        { id: 3, kind: "loomwright_x" },
        { id: 4, kind: "message" },
      ]),
    ).toBe(3);
  });
});
