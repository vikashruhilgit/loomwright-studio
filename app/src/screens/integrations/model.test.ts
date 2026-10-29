// Integrations' view model (phase 6 item 11, AC1, AC4, AC5, AC7): the row status
// to the mockup's designed state, the unreachable / error / loading phases, the
// list row's words, expiry and time text, permission labels, the token route's
// refusals (including `write_permissions`, read defensively) and the granted
// agents. Pure functions: no React, no bridge.
import { describe, expect, it } from "vitest";
import type { ApiResult, Connector, ConnectorStatus, ConnectorsResponse, RosterEntry } from "../../api/contract";
import {
  STATE_OF_STATUS,
  type ConnectorsRead,
  daysLeft,
  dropLine,
  expiryOf,
  githubRow,
  grantedAgents,
  hasToken,
  isOffline,
  levelLabel,
  permissionLabel,
  permissionLines,
  refusalOf,
  replyOf,
  replyText,
  rowMeta,
  ungrantedNote,
  viewOf,
  whenText,
} from "./model";

// ---- Fixtures --------------------------------------------------------------------------------

const NOW = new Date("2026-10-28T12:00:00.000Z");

function connector(status: ConnectorStatus, overrides: Partial<Connector> = {}): Connector {
  return {
    id: 1,
    kind: "github",
    status,
    account_login: "octo-owner",
    permissions: { metadata: "read", contents: "read", pull_requests: "read" },
    permissions_source: "reported",
    permissions_declared_at: null,
    reachable_repos: ["octo-owner/site"],
    expires_at: "2027-01-23T00:00:00.000Z",
    verified_at: "2026-10-28T09:00:00.000Z",
    created_at: "2026-10-28T09:00:00.000Z",
    updated_at: "2026-10-28T09:00:00.000Z",
    ...overrides,
  };
}

function answered(...rows: Connector[]): ConnectorsRead {
  const body: ConnectorsResponse = { connectors: rows };
  return { latest: { kind: "ok", status: 200, body }, lastOk: body };
}

function agent(id: string, name: string, connectors: RosterEntry["connectors"]): RosterEntry {
  return {
    id,
    display_name: name,
    avatar: { shape: "shark", hue: "crew-teal" },
    status: "active",
    created_by: id === "wright" ? null : "owner",
    approval_id: null,
    model: "claude-sonnet",
    settings_error: null,
    tokens_today: 0,
    tokens_per_day: null,
    sessions_running: 0,
    sessions_at_once: null,
    ...(connectors === undefined ? {} : { connectors }),
  };
}

// ---- Status to designed state ----------------------------------------------------------------

describe("the designed state of each status", () => {
  it.each([
    ["connected", "connected"],
    ["expiring", "expiring"],
    ["expired", "expired"],
    ["rejected", "none"],
    ["disconnected", "none"],
  ] as const)("a %s row is the %s state", (status, state) => {
    expect(STATE_OF_STATUS[status]).toBe(state);
    expect(viewOf(answered(connector(status))).state).toBe(state);
  });

  it("no github row is the empty state, with nothing to disconnect", () => {
    const view = viewOf(answered());
    expect(view).toMatchObject({ phase: "ready", state: "none", row: undefined, refused: false });
    expect(hasToken(view)).toBe(false);
  });

  it("a rejected row is the empty state with the refused note, not a connected one (AC1)", () => {
    const view = viewOf(answered(connector("rejected")));
    expect(view).toMatchObject({ state: "none", row: undefined, refused: true });
    expect(hasToken(view)).toBe(false);
    expect(rowMeta(view, false, NOW)).toEqual({ dot: "idle", text: "not connected · the last token was refused" });
  });

  it("a disconnected row reads plain 'not connected', with no refused note", () => {
    const view = viewOf(answered(connector("disconnected")));
    expect(view.refused).toBe(false);
    expect(rowMeta(view, false, NOW)).toEqual({ dot: "idle", text: "not connected" });
  });

  it("a token state carries its row; only the github kind counts", () => {
    const view = viewOf(answered(connector("connected")));
    expect(view.row?.account_login).toBe("octo-owner");
    expect(hasToken(view)).toBe(true);
    const other = { ...connector("connected"), kind: "slack" } as unknown as Connector;
    expect(githubRow({ connectors: [other] })).toBeUndefined();
  });
});

describe("the read phases", () => {
  it("before any answer the view is loading (no state is claimed)", () => {
    expect(viewOf({ latest: undefined, lastOk: undefined })).toMatchObject({ phase: "loading", state: "none" });
    expect(rowMeta(viewOf({ latest: undefined, lastOk: undefined }), false, NOW).text).toBe("checking…");
  });

  it("a status 0 answer with a connection is unreachable, never not connected (AC7)", () => {
    const reply = replyOf<ConnectorsResponse>({ ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } });
    const view = viewOf({ latest: reply, lastOk: undefined });
    expect(view.phase).toBe("unreachable");
    expect(isOffline(view)).toBe(true);
    expect(view.message).toBe("Couldn't reach the kernel (daemon_not_running).");
    expect(rowMeta(view, false, NOW)).toEqual({ dot: "none", text: "status unknown · kernel unreachable" });
    expect(rowMeta(view, false, NOW).text).not.toContain("not connected");
  });

  it("an unreachable answer keeps the last good row, so the detail can show it read-only", () => {
    const good = answered(connector("connected"));
    const view = viewOf({ latest: { kind: "unreachable", message: "x" }, lastOk: good.lastOk });
    expect(view).toMatchObject({ phase: "unreachable", state: "connected" });
    expect(view.row?.status).toBe("connected");
  });

  it("a refused read is the error phase and keeps the last good row; its words are the kernel's", () => {
    const reply = replyOf<ConnectorsResponse>({ ok: false, status: 500, body: { error: "internal", message: "db is locked" } });
    const good = answered(connector("expiring"));
    const view = viewOf({ latest: reply, lastOk: good.lastOk });
    expect(view).toMatchObject({ phase: "error", state: "expiring", message: "db is locked" });
    expect(isOffline(view)).toBe(false);
    expect(rowMeta(viewOf({ latest: reply, lastOk: undefined }), false, NOW).text).toBe("status unknown");
  });

  it("while connecting the list row says so, whatever the state", () => {
    expect(rowMeta(viewOf(answered()), true, NOW)).toEqual({ dot: "working", text: "connecting · checking the token with GitHub" });
  });
});

describe("replyOf", () => {
  it("passes an ok answer, names a refusal by code and message, and falls back to the HTTP status", () => {
    expect(replyOf({ ok: true, status: 200, body: { a: 1 } })).toEqual({ kind: "ok", status: 200, body: { a: 1 } });
    const refused = replyOf({ ok: false, status: 422, body: { error: "token_invalid", message: "nope" } });
    expect(refused).toMatchObject({ kind: "refused", status: 422, error: "token_invalid", message: "nope" });
    expect(replyOf({ ok: false, status: 502, body: {} as never })).toMatchObject({ kind: "refused", error: "HTTP 502", message: undefined });
    expect(replyOf({ ok: false, status: 500, body: null as never })).toMatchObject({ kind: "refused", error: "HTTP 500" });
  });

  it("a failed IPC call is failed, in Team's words", () => {
    expect(replyOf<unknown>(undefined)).toEqual({ kind: "failed", message: "The request did not reach the kernel." });
  });

  it("replyText is the message when the kernel sent one, else its error code", () => {
    expect(replyText({ kind: "refused", status: 409, error: "not_connected", message: "no token", body: { error: "not_connected" } })).toBe("no token");
    expect(replyText({ kind: "refused", status: 409, error: "not_connected", message: undefined, body: { error: "not_connected" } })).toBe("not_connected");
    expect(replyText({ kind: "unreachable", message: "Couldn't reach the kernel (timeout)." })).toBe("Couldn't reach the kernel (timeout).");
  });
});

// ---- Words ---------------------------------------------------------------------------------------

describe("the list row's words", () => {
  it("connected names the account; expiring counts the days; expired names the account", () => {
    expect(rowMeta(viewOf(answered(connector("connected"))), false, NOW)).toEqual({ dot: "ok", text: "connected · octo-owner" });
    const soon = connector("expiring", { expires_at: "2026-11-05T00:00:00.000Z" });
    expect(rowMeta(viewOf(answered(soon)), false, NOW)).toEqual({ dot: "waiting", text: "expiring in 8 days · octo-owner" });
    expect(rowMeta(viewOf(answered(connector("expired"))), false, NOW)).toEqual({ dot: "danger", text: "expired · octo-owner" });
  });

  it("a row with no account login drops the account, never prints null", () => {
    expect(rowMeta(viewOf(answered(connector("connected", { account_login: null }))), false, NOW).text).toBe("connected");
  });
});

describe("expiry and time text", () => {
  it("counts the days left (rounded up), and says how long ago it expired", () => {
    expect(expiryOf("2027-01-23T00:00:00.000Z", "connected", NOW)).toEqual({ date: "23 Jan 2027", left: "87 days left", badge: undefined });
    expect(expiryOf("2026-11-05T00:00:00.000Z", "expiring", NOW)).toEqual({ date: "5 Nov 2026", left: "8 days left", badge: "renew soon" });
    expect(expiryOf("2026-10-29T00:00:00.000Z", "expiring", NOW).left).toBe("1 day left");
    expect(expiryOf("2026-10-26T00:00:00.000Z", "expired", NOW)).toEqual({ date: "26 Oct 2026", left: "expired 2 days ago", badge: "expired" });
    expect(expiryOf("2026-10-28T06:00:00.000Z", "expired", NOW).left).toBe("expired today");
  });

  it("no expiry, or an unreadable one, reads 'No expiry' with no count", () => {
    expect(expiryOf(null, "connected", NOW)).toEqual({ date: "No expiry", left: undefined, badge: undefined });
    expect(expiryOf("not a date", "connected", NOW).date).toBe("No expiry");
    expect(daysLeft(null, NOW)).toBeUndefined();
    expect(daysLeft("2026-11-05T00:00:00.000Z", NOW)).toBe(8);
  });

  it("whenText is 'today HH:MM' for today and 'D Mon HH:MM' otherwise (local time)", () => {
    const now = new Date(2026, 9, 28, 15, 30);
    expect(whenText(new Date(2026, 9, 28, 14, 2).toISOString(), now)).toBe("today 14:02");
    expect(whenText(new Date(2026, 9, 24, 9, 12).toISOString(), now)).toBe("24 Oct 09:12");
    expect(whenText(null, now)).toBe("never");
  });
});

describe("permissions", () => {
  it("humanises GitHub's keys and shows read as Read-only, other levels as reported", () => {
    expect(permissionLabel("pull_requests")).toBe("Pull requests");
    expect(permissionLabel("metadata")).toBe("Metadata");
    expect(levelLabel("read")).toBe("Read-only");
    expect(levelLabel("write")).toBe("write");
    expect(permissionLines({ metadata: "read", pull_requests: "read" })).toEqual([
      { label: "Metadata", level: "Read-only" },
      { label: "Pull requests", level: "Read-only" },
    ]);
    expect(permissionLines(null)).toEqual([]);
  });
});

// ---- Refusals ---------------------------------------------------------------------------------------

function refusal(status: number, body: { readonly error: string } & Record<string, unknown>) {
  const reply = replyOf(({ ok: false, status, body }) as ApiResult<unknown>);
  if (reply.kind === "ok") throw new Error("expected a refusal");
  return refusalOf(reply);
}

describe("refusalOf", () => {
  it("token_invalid is the invalid copy; token_write_scoped names each write permission and the fix (AC4)", () => {
    expect(refusal(422, { error: "token_invalid", message: "x" })).toEqual({ kind: "invalid" });
    expect(
      refusal(422, {
        error: "token_write_scoped",
        message: "x",
        connector: {},
        write_permissions: [
          { permission: "pull_requests", level: "write" },
          { permission: "contents", level: "write" },
        ],
      }),
    ).toEqual({ kind: "write", drops: ["Pull requests: write → set to Read-only", "Contents: write → set to Read-only"] });
    expect(dropLine("pull_requests", "write")).toBe("Pull requests: write → set to Read-only");
  });

  it("token_permissions_unknown is the sheet's own copy (it points at the confirmation box), never the kernel's message (which names the API field)", () => {
    const unknown = refusal(422, { error: "token_permissions_unknown", message: "GitHub did not report this token's permissions; send declared_read_only: true to declare them Read", connector: {} });
    expect(unknown).toEqual({ kind: "permissions_unknown" });
    expect(JSON.stringify(unknown)).not.toContain("declared_read_only");
  });

  it("reads write_permissions defensively: junk entries are skipped, a missing list is empty", () => {
    const junk = refusal(422, { error: "token_write_scoped", write_permissions: [null, 3, { permission: "contents" }, { permission: 1, level: "write" }, { permission: "administration", level: "admin" }] });
    expect(junk).toEqual({ kind: "write", drops: ["Administration: admin → set to Read-only"] });
    expect(refusal(422, { error: "token_write_scoped" })).toEqual({ kind: "write", drops: [] });
    expect(refusal(422, { error: "token_write_scoped", write_permissions: "pull_requests" })).toEqual({ kind: "write", drops: [] });
  });

  it("any other refusal is the kernel's message as text, else its code; an unreachable kernel is its own words", () => {
    expect(refusal(429, { error: "rate_limited", message: "GitHub says wait" })).toEqual({ kind: "other", text: "GitHub says wait" });
    expect(refusal(500, { error: "connector_failed" })).toEqual({ kind: "other", text: "connector_failed" });
    const down = replyOf<unknown>({ ok: false, status: 0, connection: { state: "not_installed", dataDir: "/x" } });
    if (down.kind === "ok") throw new Error("expected a refusal");
    expect(refusalOf(down)).toEqual({ kind: "other", text: "The kernel isn't installed." });
  });
});

// ---- Agents ---------------------------------------------------------------------------------------

describe("the agents with the GitHub grant", () => {
  const roster = [agent("mason", "Mason", ["github"]), agent("wright", "Wright", ["github"]), agent("pim", "Pim", []), agent("ada", "Ada", null), agent("bo", "Bo", undefined)];

  it("lists exactly the agents the roster says hold GitHub, Wright first; an unreported grant is not a grant (AC5)", () => {
    expect(grantedAgents(roster).map((a) => a.id)).toEqual(["wright", "mason"]);
  });

  it("names the agents that do not have it, and leaves out those whose grant the roster did not report", () => {
    expect(ungrantedNote(roster)).toBe("Pim doesn't have it.");
    expect(ungrantedNote([agent("pim", "Pim", []), agent("cy", "Cy", []), agent("di", "Di", [])])).toBe("Pim, Cy and Di don't have it.");
    expect(ungrantedNote([agent("mason", "Mason", ["github"])])).toBeUndefined();
  });
});
