// The triggers feature (phase 2 item 04): agents register, remove and list
// `once` / `cron` triggers through kernel tools; the due work fires each
// scheduled instant at most once (missed cron instants coalesced, instants
// under the kill switch recorded and never fired); the owner lists and
// toggles every trigger through `studio triggers` and the `/triggers`
// routes; every change is one `trigger_*` audit event in its transaction.
// A temp data dir and a controllable clock; the tools run through the tool
// server's own `contributedToolHandler` (no SDK launch, no model).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_TOKEN_KEYCHAIN_SERVICE, engageKillSwitch, releaseKillSwitch, startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { USAGE, runCli, usageText } from "../src/cli/index.js";
import { MAX_NOTIFICATION_TITLE } from "../src/notifications/index.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { ContributedTool, FeatureContribution } from "../src/features/index.js";
import { EventLoop } from "../src/loop/loop.js";
import type { Store } from "../src/store/index.js";
import { contributedToolHandler } from "../src/tools/server.js";
import type { KernelToolContext, KernelToolResult } from "../src/tools/server.js";
import {
  MAX_COUNTED_INSTANTS,
  TRIGGERS_HELP,
  TRIGGER_AUDIT_KINDS,
  TRIGGER_TOOL_NAMES,
  TriggerError,
  fireDueTriggers,
  formatTriggers,
  formatZoned,
  listTriggers,
  nextCronFire,
  parseCron,
  registerTrigger,
  removeTrigger,
  setTriggerEnabled,
  triggersContribution,
  triggersSubcommand,
  updateTriggerSpec,
} from "../src/triggers/index.js";
import type { TriggersSubcommandDeps } from "../src/triggers/index.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const WED_10Z = "2026-10-14T10:00:00.000Z";

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv(WED_10Z);
});

afterEach(() => {
  vi.restoreAllMocks();
  env.cleanup();
});

function setClock(iso: string): void {
  env.clock.at = new Date(iso);
}

function tool(name: string): ContributedTool {
  const t = (triggersContribution.tools ?? []).find((x) => x.name === name);
  if (t === undefined) throw new Error(`no tool ${name}`);
  return t;
}

/** Call a triggers tool as session `sessionId` running `agent`, through the tool server's handler. */
function call(name: string, args: unknown, o: { agent?: string | null; sessionId?: number } = {}): Promise<KernelToolResult> {
  const sessionId = o.sessionId ?? 1;
  const agent = o.agent === undefined ? "wright" : o.agent;
  const sessions = {
    stopSession: async () => "stopped",
    getSession: (id: number) => (id === sessionId ? { id, agent } : undefined),
  } as unknown as KernelToolContext["sessions"];
  return contributedToolHandler(tool(name), { store: env.store, sessions, sessionId, now: env.now })(args);
}

function value<T = Record<string, unknown>>(r: KernelToolResult): T {
  expect(r.isError, r.content[0]?.text).toBeUndefined();
  return JSON.parse(r.content[0]?.text ?? "null") as T;
}

function errorText(r: KernelToolResult): string {
  expect(r.isError, r.content[0]?.text).toBe(true);
  return r.content[0]?.text ?? "";
}

let keyN = 0;
const register = (args: Record<string, unknown>, o?: { agent?: string | null; sessionId?: number }) =>
  call("kernel_trigger_register", { idempotency_key: `k${++keyN}`, ...args }, o);

interface Row {
  id: number;
  owning_agent: string;
  kind: string;
  spec_json: string;
  action: string;
  action_payload: string;
  created_by: string;
  enabled: number;
  enabled_changed_by: string | null;
  enabled_changed_at: string | null;
  next_fire_at: string | null;
  last_fired_at: string | null;
  last_result: string | null;
}

function row(id: number): Row | undefined {
  return env.store.prepare<[number], Row>("SELECT * FROM triggers WHERE id = ?").get(id);
}

function notifications(): { id: number; source: string; title: string; body: string; deep_link: string; delivery_status: string }[] {
  return env.store.prepare<[], { id: number; source: string; title: string; body: string; deep_link: string; delivery_status: string }>(
    "SELECT id, source, title, body, deep_link, delivery_status FROM notifications ORDER BY id",
  ).all();
}

function triggerEvents(): ReturnType<typeof events> {
  return events(env.store).filter((e) => e.kind.startsWith("trigger_"));
}

/** One tick of a loop composed with the shipped triggers contribution's due work, at the env clock. */
async function tick(): Promise<void> {
  const loop = new EventLoop({ store: env.store, handlers: {}, dueWork: mergeContributions([triggersContribution]).dueWork }, { now: env.now });
  await loop.tick();
}

describe("the triggers contribution", () => {
  it("registers three kernel tools, the /triggers routes, the studio triggers subcommand and one due-work function, and nothing else", () => {
    expect(SHIPPED_CONTRIBUTIONS).toContain(triggersContribution);
    const merged = mergeContributions([triggersContribution], PHASE1_RESERVED);
    expect(merged.tools.map((t) => t.name)).toEqual([...TRIGGER_TOOL_NAMES]);
    expect(TRIGGER_TOOL_NAMES).toEqual(["kernel_trigger_register", "kernel_trigger_remove", "kernel_trigger_list"]);
    expect(merged.routes.map((r) => `${r.method} ${r.path} ${r.owner}`)).toEqual([
      "GET /triggers triggers",
      "POST /triggers/:id/on triggers",
      "POST /triggers/:id/off triggers",
    ]);
    expect(merged.subcommands.map((s) => [s.name, s.help])).toEqual([["triggers", "studio triggers [--all] [--json] | studio triggers on|off <id> [--yes]"]]);
    expect(TRIGGERS_HELP).toBe("studio triggers [--all] [--json] | studio triggers on|off <id> [--yes]");
    expect(merged.dueWork.map((d) => d.owner)).toEqual(["triggers"]);
    expect(merged.handlers).toEqual({});
    expect(Object.keys(triggersContribution)).toEqual(["name", "tools", "routes", "subcommands", "dueWork"]);
  });

  it("studio's usage text is phase 1's plus each shipped help line, triggers' among them, with the shipped contributions", async () => {
    const stderr: string[] = [];
    expect(await runCli(["nope"], { dataDir: env.dataDir, stderr: { write: (c: string) => stderr.push(c) }, stdout: { write: () => true } })).toBe(2);
    expect(stderr.join("")).toBe(`${usageText(mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).subcommands)}\n`);
    expect(stderr.join("")).toContain(` | ${TRIGGERS_HELP}`);
    expect(stderr.join("").startsWith(`${USAGE} | `)).toBe(true);
  });

  it("nothing is preinstalled: a fresh store has no trigger, and ticking creates none", async () => {
    await tick();
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(0);
    expect(triggerEvents()).toEqual([]);
  });
});

describe("cron and time zones", () => {
  const next = (cron: string, tz: string, after: string): string | undefined => nextCronFire(cron, tz, new Date(after))?.toISOString();
  const chain = (cron: string, tz: string, after: string, n: number): string[] => {
    const out: string[] = [];
    let at = new Date(after);
    for (let i = 0; i < n; i++) {
      const d = nextCronFire(cron, tz, at);
      if (d === undefined) break;
      out.push(d.toISOString());
      at = d;
    }
    return out;
  };

  it("0 9 * * 1-5 in Asia/Kolkata: 03:30Z on weekdays, skipping the weekend", () => {
    // Wed 2026-10-14 15:30 IST.
    expect(chain("0 9 * * 1-5", "Asia/Kolkata", WED_10Z, 4)).toEqual([
      "2026-10-15T03:30:00.000Z", // Thu
      "2026-10-16T03:30:00.000Z", // Fri
      "2026-10-19T03:30:00.000Z", // Mon (Sat 17, Sun 18 skipped)
      "2026-10-20T03:30:00.000Z", // Tue
    ]);
  });

  it("America/New_York across the March and November changes: 09:00 local is 14:00Z in winter and 13:00Z in summer", () => {
    expect(chain("0 9 * * *", "America/New_York", "2026-03-06T15:00:00.000Z", 3)).toEqual([
      "2026-03-07T14:00:00.000Z", // Sat, EST
      "2026-03-08T13:00:00.000Z", // Sun, EDT from 02:00 that night
      "2026-03-09T13:00:00.000Z",
    ]);
    expect(chain("0 9 * * *", "America/New_York", "2026-10-30T14:00:00.000Z", 3)).toEqual([
      "2026-10-31T13:00:00.000Z", // Sat, EDT
      "2026-11-01T14:00:00.000Z", // Sun, EST from 02:00 that night
      "2026-11-02T14:00:00.000Z",
    ]);
    // A weekday schedule over the same change.
    expect(chain("0 9 * * 1-5", "America/New_York", "2026-03-06T15:00:00.000Z", 1)).toEqual(["2026-03-09T13:00:00.000Z"]);
  });

  it("a time skipped by the spring-forward gap does not fire that day; a repeated fall-back time fires once, at its first instant", () => {
    // 02:30 does not exist in New York on 2026-03-08.
    expect(chain("30 2 * * *", "America/New_York", "2026-03-07T08:00:00.000Z", 2)).toEqual(["2026-03-09T06:30:00.000Z", "2026-03-10T06:30:00.000Z"]);
    // 01:30 happens twice on 2026-11-01 (05:30Z EDT, then 06:30Z EST): only the first fires.
    expect(chain("30 1 * * *", "America/New_York", "2026-10-31T12:00:00.000Z", 2)).toEqual(["2026-11-01T05:30:00.000Z", "2026-11-02T06:30:00.000Z"]);
    expect(next("30 1 * * *", "America/New_York", "2026-11-01T05:30:00.000Z")).toBe("2026-11-02T06:30:00.000Z");
    // Every half hour over the overlap: the repeated hour's times appear once each.
    expect(chain("*/30 * * * *", "America/New_York", "2026-11-01T04:45:00.000Z", 4)).toEqual([
      "2026-11-01T05:00:00.000Z", // 01:00 EDT
      "2026-11-01T05:30:00.000Z", // 01:30 EDT
      "2026-11-01T07:00:00.000Z", // 02:00 EST (01:00 and 01:30 EST are repeats)
      "2026-11-01T07:30:00.000Z",
    ]);
  });

  it("fields: steps, ranges, lists, day-of-week 0/7, the day OR rule, and months", () => {
    const cases: readonly [string, string, string[]][] = [
      ["*/15 * * * *", "2026-10-14T10:07:00.000Z", ["2026-10-14T10:15:00.000Z", "2026-10-14T10:30:00.000Z"]],
      ["0 9-17/4 * * *", "2026-10-14T00:00:00.000Z", ["2026-10-14T09:00:00.000Z", "2026-10-14T13:00:00.000Z", "2026-10-14T17:00:00.000Z", "2026-10-15T09:00:00.000Z"]],
      ["5,10 0 * * *", "2026-10-14T00:00:00.000Z", ["2026-10-14T00:05:00.000Z", "2026-10-14T00:10:00.000Z", "2026-10-15T00:05:00.000Z"]],
      // Both day fields restricted: the 13th OR any Friday.
      ["0 0 13 * 5", "2026-10-01T00:00:00.000Z", ["2026-10-02T00:00:00.000Z", "2026-10-09T00:00:00.000Z", "2026-10-13T00:00:00.000Z", "2026-10-16T00:00:00.000Z"]],
      // Day-of-month starts with *: both must match (odd days that are Fridays).
      ["0 0 */2 * 5", "2026-10-01T00:00:00.000Z", ["2026-10-09T00:00:00.000Z", "2026-10-23T00:00:00.000Z"]],
      ["0 0 * * 7", WED_10Z, ["2026-10-18T00:00:00.000Z"]],
      ["0 0 * * 0", WED_10Z, ["2026-10-18T00:00:00.000Z"]],
      ["0 0 1 1 *", WED_10Z, ["2027-01-01T00:00:00.000Z"]],
      ["0 0 29 2 *", WED_10Z, ["2028-02-29T00:00:00.000Z"]],
      ["0 12 * 2-3 1", WED_10Z, ["2027-02-01T12:00:00.000Z"]],
      // `n/step` runs from n to the field's maximum.
      ["50/5 10 * * *", "2026-10-14T00:00:00.000Z", ["2026-10-14T10:50:00.000Z", "2026-10-14T10:55:00.000Z", "2026-10-15T10:50:00.000Z"]],
    ];
    for (const [cron, after, want] of cases) expect(chain(cron, "UTC", after, want.length), cron).toEqual(want);
    expect(next("0 0 31 2 *", "UTC", WED_10Z)).toBeUndefined();
    expect(parseCron("  0   9 * *  1-5 ").expr).toBe("0 9 * * 1-5");
  });

  it("an invalid field is a RangeError naming the field and the item", () => {
    const cases: readonly [string, RegExp][] = [
      ["60 * * * *", /cron minute field "60": "60" is outside 0-59/],
      ["* 24 * * *", /cron hour field "24"/],
      ["* * 0 * *", /cron day-of-month field "0"/],
      ["* * * 13 *", /cron month field "13"/],
      ["* * * * 8", /cron day-of-week field "8"/],
      ["5-1 * * * *", /start is after its end/],
      ["*/0 * * * *", /step below 1/],
      ["1,x * * * *", /cron minute field "1,x": "x" is not \*/],
      ["* * * *", /has 5 fields .* has 4/],
      ["@daily", /has 5 fields/],
      ["", /non-empty/],
    ];
    for (const [cron, message] of cases) expect(() => parseCron(cron), cron).toThrow(message);
  });

  it("formatZoned renders an instant as wall-clock time with its offset", () => {
    expect(formatZoned(Date.parse("2026-10-14T11:30:00.000Z"), "Asia/Kolkata")).toBe("2026-10-14 17:00 +05:30");
    expect(formatZoned(Date.parse("2026-01-05T14:00:00.000Z"), "America/New_York")).toBe("2026-01-05 09:00 -05:00");
    expect(formatZoned(Date.parse("2026-07-05T13:00:00.000Z"), "America/New_York")).toBe("2026-07-05 09:00 -04:00");
  });
});

describe("kernel_trigger_register / kernel_trigger_remove / kernel_trigger_list", () => {
  it("a once trigger: next fire 11:30Z; the first tick at or after it records exactly one notification and the trigger is spent (AC1)", async () => {
    const r = value<{ id: number; next_fire_at: string }>(await register({ kind: "once", spec: "2026-10-14T17:00:00+05:30", action: "notify", text: "check X" }));
    expect(r.next_fire_at).toBe("2026-10-14T11:30:00.000Z");
    expect(row(r.id)).toMatchObject({
      owning_agent: "wright",
      kind: "once",
      spec_json: JSON.stringify({ at: "2026-10-14T17:00:00+05:30" }),
      action: "notify",
      action_payload: "check X",
      created_by: "agent",
      enabled: 1,
      enabled_changed_by: null,
      next_fire_at: "2026-10-14T11:30:00.000Z",
      last_fired_at: null,
      last_result: null,
    });

    setClock("2026-10-14T11:29:59.999Z");
    await tick();
    expect(notifications()).toEqual([]);

    setClock("2026-10-14T11:30:00.000Z");
    await tick();
    const [n, ...more] = notifications();
    expect(more).toEqual([]);
    expect(n).toEqual({
      id: n?.id,
      source: `trigger:${r.id}`,
      title: `Trigger ${r.id} (wright)`,
      body: "check X",
      deep_link: `loomwright-studio://notifications/${n?.id}`,
      delivery_status: "pending",
    });
    expect(row(r.id)).toMatchObject({ enabled: 0, last_result: "fired", last_fired_at: "2026-10-14T11:30:00.000Z", next_fire_at: null });

    setClock("2026-10-14T12:00:00.000Z");
    await tick();
    expect(notifications()).toHaveLength(1);
    const fired = events(env.store, "trigger_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      actor: "kernel",
      payload: { trigger_id: r.id, action: "notify", scheduled_at: "2026-10-14T11:30:00.000Z", missed: 0, enabled: false, notification_id: n?.id, next_fire_at: null },
    });
    expect(count(env.store, "SELECT count(*) FROM work_steps WHERE key = ? AND status = 'done'", `trigger:${r.id}:2026-10-14T11:30:00.000Z`)).toBe(1);
  });

  it("a once trigger that came due while the kernel was down fires once on the first tick after the restart", async () => {
    const { id } = value<{ id: number }>(await register({ kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "late" }));
    env.restart();
    setClock("2026-10-14T15:00:00.000Z");
    await tick();
    await tick();
    expect(notifications().map((n) => n.source)).toEqual([`trigger:${id}`]);
    expect(row(id)).toMatchObject({ enabled: 0, last_result: "fired", last_fired_at: "2026-10-14T15:00:00.000Z" });
  });

  it("a cron trigger in Asia/Kolkata fires on each weekday instant and schedules the next across the weekend (AC2)", async () => {
    const r = value<{ id: number; next_fire_at: string }>(await register({ kind: "cron", spec: "0 9 * * 1-5", tz: "Asia/Kolkata", action: "notify", text: "standup" }));
    expect(r.next_fire_at).toBe("2026-10-15T03:30:00.000Z");
    expect(JSON.parse(row(r.id)?.spec_json ?? "null")).toEqual({ cron: "0 9 * * 1-5", tz: "Asia/Kolkata" });
    setClock("2026-10-15T03:30:00.000Z");
    await tick();
    expect(row(r.id)?.next_fire_at).toBe("2026-10-16T03:30:00.000Z");
    setClock("2026-10-16T03:30:05.000Z");
    await tick();
    expect(row(r.id)).toMatchObject({ enabled: 1, last_result: "fired", next_fire_at: "2026-10-19T03:30:00.000Z" });
    expect(notifications()).toHaveLength(2);
    expect(events(env.store, "trigger_fired").map((e) => e.payload.missed)).toEqual([0, 0]);
  });

  it("a wake_agent trigger queues one message event for its agent with the text and the trigger id, and nothing else (AC3)", async () => {
    const { id } = value<{ id: number }>(await register({ kind: "once", spec: "2026-10-14T11:00:00Z", action: "wake_agent", text: "look at PR 12" }));
    const before = events(env.store).length;
    setClock("2026-10-14T11:00:00.000Z");
    await tick();
    const queued = env.store
      .prepare<[], { kind: string; payload_json: string; source_ref: string; status: string }>("SELECT kind, payload_json, source_ref, status FROM event_queue")
      .all();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.kind).toBe("message");
    expect(JSON.parse(queued[0]?.payload_json ?? "null")).toEqual({ text: "look at PR 12", agent: "wright", trigger_id: id });
    expect(queued[0]?.source_ref).toBe(`trigger:${id}:2026-10-14T11:00:00.000Z`);
    expect(notifications()).toEqual([]);
    // The queue's own audit row and the fire: nothing else.
    expect(events(env.store).slice(before).map((e) => e.kind)).toEqual(["event_enqueued", "trigger_fired", "event_unhandled"]);
    expect(events(env.store, "trigger_fired")[0]?.payload).toMatchObject({ action: "wake_agent", queue_id: expect.any(Number) });
    expect(row(id)).toMatchObject({ enabled: 0, last_result: "fired" });
  });

  it("a cron trigger that missed 5 instants while the kernel was down fires once, and its audit event says 5 missed (AC5)", async () => {
    setClock("2026-10-14T09:30:00.000Z");
    const { id } = value<{ id: number }>(await register({ kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "hourly" }));
    expect(row(id)?.next_fire_at).toBe("2026-10-14T10:00:00.000Z");
    env.restart();
    // Down from 09:30 to 14:30: 10:00, 11:00, 12:00, 13:00 and 14:00 came due.
    setClock("2026-10-14T14:30:00.000Z");
    await tick();
    await tick();
    expect(notifications()).toHaveLength(1);
    const fired = events(env.store, "trigger_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]?.payload).toMatchObject({ missed: 5, scheduled_at: "2026-10-14T10:00:00.000Z", latest_due_at: "2026-10-14T14:00:00.000Z", next_fire_at: "2026-10-14T15:00:00.000Z" });
    expect(row(id)).toMatchObject({ enabled: 1, next_fire_at: "2026-10-14T15:00:00.000Z", last_result: "fired" });
  });

  it("counting stops at MAX_COUNTED_INSTANTS and says so", () => {
    setClock("2026-10-01T00:00:00.000Z");
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "* * * * *", tz: "UTC", action: "notify", text: "every minute" }, env.now());
    // 20 000 minutes later.
    const [outcome] = fireDueTriggers(env.store, new Date(Date.parse("2026-10-01T00:01:00.000Z") + 20_000 * 60_000));
    expect(outcome).toMatchObject({ trigger_id: id, result: "fired" });
    expect(events(env.store, "trigger_fired")[0]?.payload).toMatchObject({ missed: MAX_COUNTED_INSTANTS, missed_at_least: true });
    expect(notifications()).toHaveLength(1);
  });

  it("after the owner turned a trigger off, an agent cannot re-register it, re-enable it or remove it: it stays off (AC6)", async () => {
    const args = { kind: "once", spec: "2026-10-14T17:00:00+05:30", action: "notify", text: "check X" };
    const { id } = value<{ id: number }>(await register(args));
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    expect(row(id)).toMatchObject({ enabled: 0, enabled_changed_by: "owner" });

    // The same trigger again (the same instant, written another way, still counts).
    for (const spec of ["2026-10-14T17:00:00+05:30", "2026-10-14T11:30:00Z"]) {
      expect(errorText(await register({ ...args, spec }))).toBe(
        `kernel_trigger_register: trigger ${id} was turned off by the owner; an agent cannot turn it back on, re-register or remove it`,
      );
    }
    expect(() => setTriggerEnabled(env.store, { id, enabled: true, by: "agent" }, env.now())).toThrow(/turned off by the owner/);
    expect(() => setTriggerEnabled(env.store, { id, enabled: false, by: "agent" }, env.now())).toThrow(/turned off by the owner/);
    expect(errorText(await call("kernel_trigger_remove", { id, idempotency_key: "rm" }))).toMatch(/turned off by the owner/);
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
    expect(row(id)).toMatchObject({ enabled: 0, enabled_changed_by: "owner" });
    setClock("2026-10-14T12:00:00.000Z");
    await tick();
    expect(notifications()).toEqual([]);

    // A different trigger (another text) is not the one the owner turned off.
    setClock(WED_10Z);
    expect(value(await register({ ...args, text: "check Y" }))).toMatchObject({ next_fire_at: "2026-10-14T11:30:00.000Z" });
  });

  it("an invalid spec is an error result naming the problem, and nothing is stored: no row, no event, no work step (AC7)", async () => {
    const cases: readonly [Record<string, unknown>, RegExp, { agent?: string | null }?][] = [
      [{ kind: "once", spec: "2026-10-14T09:00:00Z" }, /once spec "2026-10-14T09:00:00Z" \(2026-10-14T09:00:00\.000Z\) is in the past/],
      [{ kind: "once", spec: WED_10Z }, /is in the past/],
      [{ kind: "once", spec: "2026-10-14T17:00:00" }, /is not an ISO-8601 instant with a time zone/],
      [{ kind: "once", spec: "tomorrow at five" }, /is not an ISO-8601 instant with a time zone/],
      [{ kind: "once", spec: "2026-10-14T17:00:00Z", tz: "UTC" }, /tz is for cron/],
      [{ kind: "cron", spec: "0 9 * * *", tz: "Mars/Olympus_Mons" }, /unknown time zone "Mars\/Olympus_Mons"/],
      [{ kind: "cron", spec: "0 9 * * *", tz: "+05:30" }, /unknown time zone "\+05:30"/],
      [{ kind: "cron", spec: "0 9 * * *" }, /a cron trigger needs an IANA time zone/],
      [{ kind: "cron", spec: "61 9 * * *", tz: "UTC" }, /cron minute field "61"/],
      [{ kind: "cron", spec: "0 9 * *", tz: "UTC" }, /has 5 fields/],
      [{ kind: "cron", spec: "0 0 31 2 *", tz: "UTC" }, /never fires/],
      [{ kind: "weekly", spec: "0 9 * * *", tz: "UTC" }, /^kernel_trigger_register: invalid input/],
      [{ kind: "once", spec: "2026-10-14T17:00:00Z", action: "email" }, /^kernel_trigger_register: invalid input/],
      [{ kind: "once", spec: "2026-10-14T17:00:00Z", text: "   " }, /text must be 1-2000 characters/],
      [{ kind: "once", spec: "2026-10-14T17:00:00Z" }, /runs no named agent/, { agent: null }],
    ];
    for (const [args, message, o] of cases) {
      const text = errorText(await register({ action: "notify", text: "x", ...args }, o));
      expect(text, JSON.stringify(args)).toMatch(message);
      expect(text).toMatch(/^kernel_trigger_register: /);
    }
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(0);
    expect(triggerEvents()).toEqual([]);
    expect(count(env.store, "SELECT count(*) FROM work_steps")).toBe(0);
  });

  it("register and remove are idempotent per session and key; remove refuses another agent's trigger; list shows only the caller's", async () => {
    const args = { kind: "once", spec: "2026-10-14T17:00:00Z", action: "notify", text: "a", idempotency_key: "same" };
    const first = value<{ id: number }>(await call("kernel_trigger_register", args));
    expect(value(await call("kernel_trigger_register", { ...args, text: "different" }))).toEqual(first);
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
    const other = value<{ id: number }>(await call("kernel_trigger_register", { ...args, text: "b" }, { agent: "scout", sessionId: 2 }));

    expect(errorText(await call("kernel_trigger_remove", { id: other.id, idempotency_key: "r1" }))).toBe(
      `kernel_trigger_remove: trigger ${other.id} belongs to agent scout; an agent can remove only its own triggers`,
    );
    expect(errorText(await call("kernel_trigger_remove", { id: 999, idempotency_key: "r2" }))).toBe("kernel_trigger_remove: no trigger 999");

    const listed = value<{ triggers: { id: number; owning_agent: string; text: string; enabled: boolean; spec: unknown }[] }>(await call("kernel_trigger_list", {}));
    expect(listed.triggers.map((t) => [t.id, t.owning_agent, t.text, t.enabled])).toEqual([[first.id, "wright", "a", true]]);
    expect(listed.triggers[0]?.spec).toEqual({ at: "2026-10-14T17:00:00Z" });

    expect(value(await call("kernel_trigger_remove", { id: first.id, idempotency_key: "r3" }))).toEqual({ id: first.id, removed: true });
    expect(value(await call("kernel_trigger_remove", { id: first.id, idempotency_key: "r3" }))).toEqual({ id: first.id, removed: true });
    expect(row(first.id)).toBeUndefined();
    expect(events(env.store, "trigger_removed")).toHaveLength(1);
    expect(events(env.store, "trigger_removed")[0]).toMatchObject({ session_id: 1, payload: { trigger_id: first.id, owning_agent: "wright", by: "agent" } });
  });
});

describe("the kill switch", () => {
  it("engaged over a once trigger's time and released: recorded missed_kill_switch, never fired (AC8)", async () => {
    const { id } = value<{ id: number }>(await register({ kind: "once", spec: "2026-10-14T11:30:00Z", action: "notify", text: "check X" }));
    engageKillSwitch(env.store, "2026-10-14T11:29:00.000Z");
    // Nothing fires while it is engaged, and nothing is recorded yet.
    expect(fireDueTriggers(env.store, new Date("2026-10-14T11:31:00.000Z"))).toEqual([]);
    expect(row(id)).toMatchObject({ enabled: 1, last_result: null });
    releaseKillSwitch(env.store, "2026-10-14T11:32:00.000Z");
    setClock("2026-10-14T11:33:00.000Z");
    await tick();
    await tick();
    expect(notifications()).toEqual([]);
    expect(row(id)).toMatchObject({ enabled: 0, last_result: "missed_kill_switch", last_fired_at: null, next_fire_at: null, enabled_changed_by: null });
    expect(events(env.store, "trigger_fired")).toEqual([]);
    const missed = events(env.store, "trigger_missed");
    expect(missed).toHaveLength(1);
    expect(missed[0]?.payload).toMatchObject({ trigger_id: id, reason: "kill_switch", scheduled_at: "2026-10-14T11:30:00.000Z", missed_kill_switch: 1, enabled: false });
  });

  it("a cron trigger: instants under the kill switch are counted, not fired; one after the release fires", async () => {
    const { id } = value<{ id: number }>(await register({ kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "hourly" }));
    engageKillSwitch(env.store, "2026-10-14T10:59:00.000Z");
    releaseKillSwitch(env.store, "2026-10-14T11:30:00.000Z");
    // The kernel was then down until 12:30: 11:00 fell under the kill switch, 12:00 did not.
    setClock("2026-10-14T12:30:00.000Z");
    await tick();
    expect(notifications()).toHaveLength(1);
    expect(events(env.store, "trigger_fired")[0]?.payload).toMatchObject({ missed: 0, missed_kill_switch: 1, scheduled_at: "2026-10-14T11:00:00.000Z" });
    expect(row(id)).toMatchObject({ enabled: 1, last_result: "fired", next_fire_at: "2026-10-14T13:00:00.000Z" });
  });

  it("a cron trigger whose every due instant fell under the kill switch: trigger_missed, still on, next instant scheduled", async () => {
    const { id } = value<{ id: number }>(await register({ kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "hourly" }));
    engageKillSwitch(env.store, "2026-10-14T10:30:00.000Z");
    releaseKillSwitch(env.store, "2026-10-14T12:30:00.000Z");
    setClock("2026-10-14T12:31:00.000Z");
    await tick();
    expect(notifications()).toEqual([]);
    expect(events(env.store, "trigger_missed")[0]?.payload).toMatchObject({ missed_kill_switch: 2, enabled: true, next_fire_at: "2026-10-14T13:00:00.000Z" });
    expect(row(id)).toMatchObject({ enabled: 1, last_result: "missed_kill_switch", next_fire_at: "2026-10-14T13:00:00.000Z", last_fired_at: null });
  });
});

describe("audit: one trigger_* event per change, in the change's transaction", () => {
  it("register, fire, toggle off, toggle on, re-schedule and remove each append exactly one event of their own kind", async () => {
    const kinds = (): string[] => triggerEvents().map((e) => e.kind);
    const { id } = value<{ id: number }>(await register({ kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "hourly" }));
    expect(kinds()).toEqual(["trigger_registered"]);
    setClock("2026-10-14T11:00:00.000Z");
    await tick();
    expect(kinds()).toEqual(["trigger_registered", "trigger_fired"]);
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    // A repeat is no change: no event.
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    expect(kinds()).toEqual(["trigger_registered", "trigger_fired", "trigger_toggled"]);
    setTriggerEnabled(env.store, { id, enabled: true, by: "owner" }, env.now());
    expect(kinds()).toEqual(["trigger_registered", "trigger_fired", "trigger_toggled", "trigger_toggled"]);
    updateTriggerSpec(env.store, { id, agent: "wright", kind: "cron", spec: "30 * * * *", tz: "UTC" }, env.now());
    // The same spec again is no change: no event.
    updateTriggerSpec(env.store, { id, agent: "wright", kind: "cron", spec: "30 * * * *", tz: "UTC" }, env.now());
    expect(kinds()).toEqual(["trigger_registered", "trigger_fired", "trigger_toggled", "trigger_toggled", "trigger_updated"]);
    removeTrigger(env.store, { id, agent: "wright" }, env.now());
    expect(kinds()).toEqual(["trigger_registered", "trigger_fired", "trigger_toggled", "trigger_toggled", "trigger_updated", "trigger_removed"]);
    const [registered, , off, on] = triggerEvents();
    expect(registered).toMatchObject({ actor: "kernel", session_id: 1, payload: { trigger_id: id, owning_agent: "wright", kind: "cron", action: "notify", created_by: "agent" } });
    expect(off?.payload).toMatchObject({ trigger_id: id, enabled: false, was_enabled: true, by: "owner", next_fire_at: null });
    expect(on?.payload).toMatchObject({ trigger_id: id, enabled: true, was_enabled: false, by: "owner", next_fire_at: "2026-10-14T12:00:00.000Z" });
    expect(new Set(triggerEvents().map((e) => e.kind))).toEqual(new Set(TRIGGER_AUDIT_KINDS.filter((k) => k !== "trigger_missed")));
  });

  it("when the audit event cannot be written, the change rolls back with it", async () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "x" }, env.now());
    const prepare = env.store.prepare.bind(env.store);
    vi.spyOn(env.store, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("INSERT INTO events")) throw new Error("disk I/O error");
      return prepare(sql);
    }) as Store["prepare"]);

    expect(() => registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T12:00:00Z", action: "notify", text: "y" }, env.now())).toThrow("disk I/O error");
    expect(() => setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now())).toThrow("disk I/O error");
    expect(() => removeTrigger(env.store, { id, agent: "wright" }, env.now())).toThrow("disk I/O error");
    expect(() => fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"))).toThrow(/disk I\/O error/);
    vi.restoreAllMocks();

    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
    expect(row(id)).toMatchObject({ enabled: 1, enabled_changed_by: null, next_fire_at: "2026-10-14T11:00:00.000Z", last_result: null });
    expect(notifications()).toEqual([]);
    expect(count(env.store, "SELECT count(*) FROM work_steps")).toBe(0);
    // Nothing was lost: the fire happens on the next tick.
    expect(fireDueTriggers(env.store, new Date("2026-10-14T11:00:01.000Z"))).toMatchObject([{ trigger_id: id, result: "fired" }]);
    expect(triggerEvents().map((e) => e.kind)).toEqual(["trigger_registered", "trigger_fired"]);
  });

  it("a stored spec the kernel cannot evaluate is parked (no next fire) and reported once, and the other due triggers still fire", async () => {
    const bad = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "bad" }, env.now());
    const good = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "good" }, env.now());
    env.store.prepare("UPDATE triggers SET spec_json = ? WHERE id = ?").run(JSON.stringify({ cron: "0 * * * *", tz: "Not/AZone" }), bad.id);
    setClock("2026-10-14T11:00:00.000Z");
    await tick();
    await tick();
    expect(notifications().map((n) => n.body)).toEqual(["good"]);
    expect(row(bad.id)).toMatchObject({ enabled: 1, next_fire_at: null });
    const failed = events(env.store, "due_work_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ contributor: "triggers", error: expect.stringMatching(new RegExp(`^trigger ${bad.id}: .*parked`)) });
    expect(good.id).toBeGreaterThan(bad.id);
  });
});

// ---- Owner control: the routes and studio triggers --------------------------

const TOKEN = "0123456789abcdef".repeat(4);

describe("owner control: studio triggers and the /triggers routes (AC9)", () => {
  let server: ApiServer;
  let apiNow: Date;

  beforeEach(async () => {
    apiNow = new Date(WED_10Z);
    server = await startApiServer(
      {
        store: env.store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [stubProvider()],
        token: TOKEN,
        routes: mergeContributions([triggersContribution], PHASE1_RESERVED).routes,
      },
      { now: () => apiNow },
    );
    writeFileSync(join(env.dataDir, "api.json"), JSON.stringify({ port: server.port, host: "127.0.0.1", pid: process.pid, started_at: WED_10Z }));
  });

  afterEach(async () => {
    await server.close();
  });

  function studio(deps: TriggersSubcommandDeps = {}) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const contribution: FeatureContribution = { name: "triggers", subcommands: [triggersSubcommand({ timeZone: "Asia/Kolkata", ...deps })] };
    const run = (...argv: string[]) =>
      runCli(argv, {
        dataDir: env.dataDir,
        keychain: { read: (s) => (s === API_TOKEN_KEYCHAIN_SERVICE ? TOKEN : undefined) },
        isPidAlive: () => true,
        contributions: [contribution],
        stdout: { write: (c: string) => stdout.push(c) },
        stderr: { write: (c: string) => stderr.push(c) },
      });
    return { run, stdout: () => stdout.join(""), stderr: () => stderr.join("") };
  }

  const api = (method: string, path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  it("lists id, agent, kind and spec, action and text, on/off, next fire in local time, last fired and result, creator and when, and who last toggled", async () => {
    const once = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T17:00:00+05:30", action: "notify", text: "check X" }, env.now());
    const cron = registerTrigger(env.store, { agent: "scout", kind: "cron", spec: "0 9 * * 1-5", tz: "Asia/Kolkata", action: "wake_agent", text: "standup\u001b[2J" }, env.now());
    setTriggerEnabled(env.store, { id: cron.id, enabled: false, by: "owner" }, new Date("2026-10-14T10:05:00.000Z"));

    const c = studio();
    expect(await c.run("triggers")).toBe(0);
    expect(c.stdout()).toBe(
      [
        `#${once.id} wright: once at 2026-10-14T17:00:00+05:30, notify "check X"`,
        "  on; next fire 2026-10-14 17:00 +05:30; last fired - (-)",
        "  created by agent at 2026-10-14 15:30 +05:30; never toggled",
        "",
      ].join("\n"),
    );
    const all = studio();
    expect(await all.run("triggers", "--all")).toBe(0);
    expect(all.stdout()).toContain(`#${cron.id} scout: cron "0 9 * * 1-5" in Asia/Kolkata, wake_agent "standup\\u001b[2J"`);
    expect(all.stdout()).toContain("  off; next fire -; last fired - (-)\n  created by agent at 2026-10-14 15:30 +05:30; last toggled by owner at 2026-10-14 15:35 +05:30\n");
    expect(all.stdout()).not.toContain("\u001b");

    const json = studio();
    expect(await json.run("triggers", "--json", "--all")).toBe(0);
    expect(JSON.parse(json.stdout())).toEqual(await (await api("GET", "/triggers?all=1")).json());
    expect((JSON.parse(json.stdout()) as { triggers: unknown[] }).triggers).toHaveLength(2);
    expect(((await (await api("GET", "/triggers")).json()) as { triggers: { id: number }[] }).triggers.map((t) => t.id)).toEqual([once.id]);

    const empty = studio();
    env.store.prepare("DELETE FROM triggers").run();
    expect(await empty.run("triggers")).toBe(0);
    expect(empty.stdout()).toBe("no enabled triggers (studio triggers --all lists disabled ones too)\n");
  });

  it("off and on toggle with by: owner in the audit event; a repeat is no change", async () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T17:00:00+05:30", action: "notify", text: "check X" }, env.now());
    const off = studio();
    expect(await off.run("triggers", "off", String(id))).toBe(0);
    expect(off.stdout()).toBe(`studio: trigger ${id} turned off\n`);
    expect(row(id)).toMatchObject({ enabled: 0, enabled_changed_by: "owner", enabled_changed_at: WED_10Z, next_fire_at: null });
    const again = studio();
    expect(await again.run("triggers", "off", String(id))).toBe(0);
    expect(again.stdout()).toBe(`studio: trigger ${id} was already off\n`);

    const on = studio();
    expect(await on.run("triggers", "on", String(id))).toBe(0);
    expect(on.stdout()).toBe(`studio: trigger ${id} turned on; next fire 2026-10-14 17:00 +05:30\n`);
    expect(row(id)).toMatchObject({ enabled: 1, enabled_changed_by: "owner", next_fire_at: "2026-10-14T11:30:00.000Z" });
    expect(events(env.store, "trigger_toggled").map((e) => [e.payload.enabled, e.payload.by])).toEqual([
      [false, "owner"],
      [true, "owner"],
    ]);

    const missing = studio();
    expect(await missing.run("triggers", "off", "999")).toBe(1);
    expect(missing.stderr()).toBe("studio: no trigger 999\n");
    for (const argv of [["triggers", "off"], ["triggers", "on", "0"], ["triggers", "off", "1", "--yes"], ["triggers", "--bogus"], ["triggers", "--all", "--all"]]) {
      const bad = studio();
      expect(await bad.run(...argv), argv.join(" ")).toBe(2);
      expect(bad.stderr()).toBe(`usage: ${TRIGGERS_HELP}\n`);
    }
    expect((await api("POST", "/triggers/abc/on")).status).toBe(400);
    expect((await api("POST", `/triggers/${id}/on`, [1])).status).toBe(400);
  });

  it("turning on a past-due once trigger asks first: no terminal ⇒ refused (2), declined ⇒ 1, confirmed or --yes ⇒ on and it fires now", async () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "check X" }, env.now());
    // It fires and is spent; the owner later wants it again.
    expect(fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"))).toMatchObject([{ result: "fired" }]);
    apiNow = new Date("2026-10-14T12:00:00.000Z");
    const toggles = (): number => events(env.store, "trigger_toggled").length;

    const confirm = vi.fn(async () => true);
    const noTty = studio({ isInteractive: () => false, confirm });
    expect(await noTty.run("triggers", "on", String(id))).toBe(2);
    expect(noTty.stderr()).toBe(
      `studio: trigger ${id} is past due and would fire now: confirm on a terminal, or pass --yes\nusage: ${TRIGGERS_HELP}\n`,
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(row(id)?.enabled).toBe(0);
    expect(toggles()).toBe(0);

    const decline = vi.fn(async () => false);
    const declined = studio({ isInteractive: () => true, confirm: decline });
    expect(await declined.run("triggers", "on", String(id))).toBe(1);
    expect(decline).toHaveBeenCalledWith(`Trigger ${id}'s time has passed: turning it on fires it now. Turn it on? [y/N] `);
    expect(declined.stderr()).toBe(`studio: trigger ${id} not turned on (not confirmed)\n`);
    expect(row(id)?.enabled).toBe(0);
    expect(toggles()).toBe(0);

    const accept = vi.fn(async () => true);
    const accepted = studio({ isInteractive: () => true, confirm: accept });
    expect(await accepted.run("triggers", "on", String(id))).toBe(0);
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accepted.stdout()).toBe(`studio: trigger ${id} turned on; next fire 2026-10-14 17:30 +05:30\n`);
    expect(row(id)).toMatchObject({ enabled: 1, enabled_changed_by: "owner", next_fire_at: "2026-10-14T12:00:00.000Z" });
    expect(toggles()).toBe(1);
    // It fires now (its own new instant), once.
    expect(fireDueTriggers(env.store, new Date("2026-10-14T12:00:00.000Z"))).toMatchObject([{ trigger_id: id, result: "fired" }]);
    expect(notifications()).toHaveLength(2);
    // Spent again: it keeps who last toggled it (the owner's on), and nobody turned it off.
    expect(row(id)).toMatchObject({ enabled: 0, enabled_changed_by: "owner", enabled_changed_at: "2026-10-14T12:00:00.000Z" });

    apiNow = new Date("2026-10-14T13:00:00.000Z");
    const askNever = vi.fn(async () => false);
    const yes = studio({ isInteractive: () => false, confirm: askNever });
    expect(await yes.run("triggers", "on", String(id), "--yes")).toBe(0);
    expect(askNever).not.toHaveBeenCalled();
    expect(row(id)).toMatchObject({ enabled: 1, next_fire_at: "2026-10-14T13:00:00.000Z" });

    // The route itself refuses without the confirmation, and changes nothing.
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    const refused = await api("POST", `/triggers/${id}/on`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "needs_confirmation", fires_at: "2026-10-14T13:00:00.000Z" });
    expect(row(id)?.enabled).toBe(0);
    expect(() => setTriggerEnabled(env.store, { id, enabled: true, by: "owner" }, new Date("2026-10-14T13:00:00.000Z"))).toThrow(TriggerError);
  });

  it("turning a cron trigger back on schedules from now: the instants it missed while off are not fired", async () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "hourly" }, env.now());
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    apiNow = new Date("2026-10-14T15:20:00.000Z");
    const on = studio();
    expect(await on.run("triggers", "on", String(id))).toBe(0);
    expect(row(id)?.next_fire_at).toBe("2026-10-14T16:00:00.000Z");
    expect(fireDueTriggers(env.store, apiNow)).toEqual([]);
  });
});

describe("studio triggers: the answers it does not expect", () => {
  /** Run the subcommand directly against a stub client that answers `status` / `body` to everything. */
  async function against(answer: { status: number; body: unknown }, ...args: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const requests: [string, string, unknown][] = [];
    const client = {
      request: async (method: string, path: string, body?: unknown) => {
        requests.push([method, path, body]);
        return answer;
      },
    };
    const code = await triggersSubcommand({ timeZone: "UTC", isInteractive: () => false }).run(args, client, {
      stdout: { write: (c: string) => stdout.push(c) },
      stderr: { write: (c: string) => stderr.push(c) },
    });
    return { code, stdout: stdout.join(""), stderr: stderr.join(""), requests };
  }

  it("a non-200 list, a list without triggers, a 400/409 toggle and any other status: one stderr line and exit 1, nothing on stdout", async () => {
    const cases: readonly [{ status: number; body: unknown }, string[], string][] = [
      [{ status: 500, body: { error: "internal_error" } }, [], "studio: kernel API answered 500 to GET /triggers\n"],
      [{ status: 200, body: { nope: true } }, ["--all"], "studio: kernel API sent an unreadable answer to GET /triggers?all=1\n"],
      [{ status: 400, body: { error: "invalid_id" } }, ["off", "3"], "studio: trigger 3 not turned off: invalid_id\n"],
      [{ status: 409, body: { error: "something\nelse" } }, ["on", "3"], "studio: trigger 3 not turned on: unknown\n"],
      [{ status: 503, body: undefined }, ["on", "3", "--yes"], "studio: kernel API answered 503 to POST /triggers/3/on\n"],
    ];
    for (const [answer, args, line] of cases) {
      const r = await against(answer, ...args);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.stderr).toBe(line);
      expect(r.stdout).toBe("");
    }
    // --yes sends the confirmation with the first request; plain on and off send none.
    expect((await against({ status: 200, body: { changed: true } }, "on", "3", "--yes")).requests).toEqual([["POST", "/triggers/3/on", { confirm: true }]]);
    expect((await against({ status: 200, body: { changed: true } }, "on", "3")).requests).toEqual([["POST", "/triggers/3/on", {}]]);
    expect((await against({ status: 200, body: { changed: true } }, "off", "3")).requests).toEqual([["POST", "/triggers/3/off", undefined]]);
    expect((await against({ status: 200, body: { triggers: [] } }, "--all")).stdout).toBe("no triggers\n");
  });

  it("the owner's off of a spent once trigger records the owner as the one who turned it off, sealing it from agents", () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "x" }, env.now());
    fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"));
    expect(row(id)).toMatchObject({ enabled: 0, enabled_changed_by: null });
    const off = setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, new Date("2026-10-14T11:05:00.000Z"));
    expect(off.changed).toBe(true);
    expect(row(id)).toMatchObject({ enabled: 0, enabled_changed_by: "owner", enabled_changed_at: "2026-10-14T11:05:00.000Z" });
    expect(events(env.store, "trigger_toggled").at(-1)?.payload).toMatchObject({ enabled: false, was_enabled: false, by: "owner" });
    expect(setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, new Date("2026-10-14T11:06:00.000Z")).changed).toBe(false);
    expect(() => registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "x" }, new Date("2026-10-14T10:00:00.000Z"))).toThrow(
      /turned off by the owner/,
    );
  });
});

describe("review fixes: done instants, repeats after an owner's off, spec identity, id reuse, toggle history", () => {
  const hourly = { agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "hourly" } as const;

  it("a cron turned back on after the clock stepped back is never scheduled onto an instant it already fired", () => {
    const { id } = registerTrigger(env.store, hourly, new Date("2026-10-14T09:30:00.000Z"));
    expect(fireDueTriggers(env.store, new Date("2026-10-14T10:00:00.000Z"))).toMatchObject([{ trigger_id: id, result: "fired" }]);
    // The wall clock steps back a minute; the owner turns it off and on again.
    const back = new Date("2026-10-14T09:59:00.000Z");
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, back);
    setTriggerEnabled(env.store, { id, enabled: true, by: "owner" }, back);
    expect(row(id)?.next_fire_at).toBe("2026-10-14T11:00:00.000Z");
    expect(fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"))).toMatchObject([{ trigger_id: id, result: "fired" }]);
    expect(notifications()).toHaveLength(2);
  });

  it("a due trigger whose instant's work step is already done is moved past it (trigger_missed, already_done) instead of staying due for ever", () => {
    const { id } = registerTrigger(env.store, hourly, new Date("2026-10-14T09:30:00.000Z"));
    fireDueTriggers(env.store, new Date("2026-10-14T10:00:00.000Z"));
    // Any path that puts a done instant back as the next fire.
    env.store.prepare("UPDATE triggers SET next_fire_at = ? WHERE id = ?").run("2026-10-14T10:00:00.000Z", id);
    expect(fireDueTriggers(env.store, new Date("2026-10-14T10:30:00.000Z"))).toEqual([{ trigger_id: id, scheduled_at: "2026-10-14T10:00:00.000Z", result: "already_done" }]);
    expect(row(id)).toMatchObject({ enabled: 1, next_fire_at: "2026-10-14T11:00:00.000Z" });
    expect(events(env.store, "trigger_missed").map((e) => e.payload)).toEqual([
      { trigger_id: id, reason: "already_done", scheduled_at: "2026-10-14T10:00:00.000Z", enabled: true, next_fire_at: "2026-10-14T11:00:00.000Z" },
    ]);
    expect(notifications()).toHaveLength(1);
    expect(fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"))).toMatchObject([{ trigger_id: id, result: "fired" }]);
    expect(notifications()).toHaveLength(2);

    // A once whose done instant is due again is spent, not fired twice.
    const once = registerTrigger(env.store, { ...hourly, kind: "once", spec: "2026-10-14T12:00:00Z", tz: undefined }, new Date("2026-10-14T11:00:00.000Z"));
    // 12:00 fires the hourly one and the once.
    fireDueTriggers(env.store, new Date("2026-10-14T12:00:00.000Z"));
    expect(notifications()).toHaveLength(4);
    env.store.prepare("UPDATE triggers SET enabled = 1, next_fire_at = ? WHERE id = ?").run("2026-10-14T12:00:00.000Z", once.id);
    expect(fireDueTriggers(env.store, new Date("2026-10-14T12:00:30.000Z"))).toMatchObject([{ trigger_id: once.id, result: "already_done" }]);
    expect(row(once.id)).toMatchObject({ enabled: 0, next_fire_at: null });
    expect(notifications()).toHaveLength(4);
  });

  it("a fired once turned back on after the clock stepped back is past due (needs confirmation), not given its fired instant again", () => {
    const { id } = registerTrigger(env.store, { ...hourly, kind: "once", spec: "2026-10-14T11:00:00Z", tz: undefined }, env.now());
    fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"));
    const back = new Date("2026-10-14T10:59:00.000Z");
    expect(() => setTriggerEnabled(env.store, { id, enabled: true, by: "owner" }, back)).toThrow(/turning it on fires it now/);
    setTriggerEnabled(env.store, { id, enabled: true, by: "owner", confirm: true }, back);
    expect(row(id)?.next_fire_at).toBe("2026-10-14T10:59:00.000Z");
    expect(fireDueTriggers(env.store, back)).toMatchObject([{ trigger_id: id, result: "fired" }]);
    expect(notifications()).toHaveLength(2);
  });

  it("repeating a register after the owner turned its trigger off returns owner_off, not the stored success", async () => {
    const args = { kind: "cron", spec: "0 9 * * *", tz: "UTC", action: "notify", text: "daily", idempotency_key: "same" };
    const { id } = value<{ id: number }>(await call("kernel_trigger_register", args));
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    expect(errorText(await call("kernel_trigger_register", args))).toBe(
      `kernel_trigger_register: trigger ${id} was turned off by the owner; an agent cannot turn it back on, re-register or remove it`,
    );
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
    expect(row(id)).toMatchObject({ enabled: 0, enabled_changed_by: "owner" });
  });

  it("an equivalent cron expression or a zone alias is the trigger the owner turned off; a schedule that differs in meaning is not", async () => {
    const base = { kind: "cron", action: "notify", text: "standup" };
    const { id } = value<{ id: number }>(await register({ ...base, spec: "0 9 * * 1-5", tz: "Asia/Kolkata" }));
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    for (const [spec, tz] of [
      ["0 9 * * 1,2,3,4,5", "Asia/Kolkata"],
      ["0 9 * * 5,4,3,2,1", "Asia/Kolkata"],
      ["0 9 * * 1-5", "Asia/Calcutta"],
      ["0 9 * * 1-5", "asia/kolkata"],
      ["0 9 * 1-12 1-5", "Asia/Calcutta"],
    ] as const) {
      expect(errorText(await register({ ...base, spec, tz })), `${spec} ${tz}`).toMatch(new RegExp(`trigger ${id} was turned off by the owner`));
    }
    // 1-31 restricts day-of-month, so the day OR rule makes it every day: another schedule.
    value(await register({ ...base, spec: "0 9 1-31 * 1-5", tz: "Asia/Kolkata" }));
    value(await register({ ...base, spec: "0 9 * * 1-6", tz: "Asia/Kolkata" }));
    // The zone is stored as given.
    expect(JSON.parse(row(id + 1)?.spec_json ?? "null")).toEqual({ cron: "0 9 1-31 * 1-5", tz: "Asia/Kolkata" });
  });

  it("a removed trigger's id is never given to a new trigger", () => {
    const a = registerTrigger(env.store, hourly, env.now());
    const b = registerTrigger(env.store, { ...hourly, text: "b" }, env.now());
    removeTrigger(env.store, { id: b.id, agent: "wright" }, env.now());
    const c = registerTrigger(env.store, { ...hourly, text: "c" }, env.now());
    expect(c.id).toBe(b.id + 1);
    removeTrigger(env.store, { id: a.id, agent: "wright" }, env.now());
    removeTrigger(env.store, { id: c.id, agent: "wright" }, env.now());
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(0);
    expect(registerTrigger(env.store, { ...hourly, text: "d" }, env.now()).id).toBe(c.id + 1);
  });

  it("a spent once keeps who last toggled it, and is still not an owner's off", async () => {
    const { id } = registerTrigger(env.store, { ...hourly, kind: "once", spec: "2026-10-14T11:00:00Z", tz: undefined }, env.now());
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, new Date("2026-10-14T10:01:00.000Z"));
    setTriggerEnabled(env.store, { id, enabled: true, by: "owner" }, new Date("2026-10-14T10:02:00.000Z"));
    fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"));
    expect(row(id)).toMatchObject({ enabled: 0, last_result: "fired", enabled_changed_by: "owner", enabled_changed_at: "2026-10-14T10:02:00.000Z" });
    expect(formatTriggers(listTriggers(env.store, { all: true }), "UTC", true)).toContain("last toggled by owner at 2026-10-14 10:02 +00:00");
    // Spent, not turned off: the owner's off records the owner and seals it.
    expect(setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, new Date("2026-10-14T11:05:00.000Z")).changed).toBe(true);
    expect(() => removeTrigger(env.store, { id, agent: "wright" }, env.now())).toThrow(/turned off by the owner/);

    // Missed under the kill switch after the owner's on: kept too, and an agent may still remove it.
    const missed = registerTrigger(env.store, { ...hourly, kind: "once", spec: "2026-10-14T12:00:00Z", tz: undefined }, env.now());
    setTriggerEnabled(env.store, { id: missed.id, enabled: false, by: "owner" }, new Date("2026-10-14T10:03:00.000Z"));
    setTriggerEnabled(env.store, { id: missed.id, enabled: true, by: "owner" }, new Date("2026-10-14T10:04:00.000Z"));
    engageKillSwitch(env.store, "2026-10-14T11:59:00.000Z");
    releaseKillSwitch(env.store, "2026-10-14T12:01:00.000Z");
    expect(fireDueTriggers(env.store, new Date("2026-10-14T12:02:00.000Z"))).toMatchObject([{ trigger_id: missed.id, result: "missed_kill_switch" }]);
    expect(row(missed.id)).toMatchObject({ enabled: 0, enabled_changed_by: "owner", enabled_changed_at: "2026-10-14T10:04:00.000Z" });
    expect(removeTrigger(env.store, { id: missed.id, agent: "wright" }, env.now())).toEqual({ id: missed.id, removed: true });

    // Without a turn-on event to show it was spent, the owner's toggle reads as the owner's off (closed).
    const bare = registerTrigger(env.store, { ...hourly, text: "bare" }, env.now());
    env.store.prepare("UPDATE triggers SET kind = 'once', enabled = 0, enabled_changed_by = 'owner', last_result = 'fired' WHERE id = ?").run(bare.id);
    expect(() => removeTrigger(env.store, { id: bare.id, agent: "wright" }, env.now())).toThrow(/turned off by the owner/);
  });
});

describe("a NUL in a trigger: refused at registration, never recorded as a notification", () => {
  it("registerTrigger refuses a NUL in the text or the agent as invalid_input, before any write", () => {
    const base = { agent: "wright", kind: "once", spec: "2026-10-14T17:00:00+05:30", action: "notify", text: "check X" } as const;
    for (const params of [{ ...base, text: "check\u0000X" }, { ...base, agent: "wr\u0000ight" }]) {
      expect(() => registerTrigger(env.store, params, env.now())).toThrow(TriggerError);
      expect(() => registerTrigger(env.store, params, env.now())).toThrow(/NUL/);
    }
    expect(listTriggers(env.store, {})).toEqual([]);
    expect(triggerEvents()).toEqual([]);
  });

  it("a notify fire goes through recordNotification: one notification_created event, linked to no session", async () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "check X" }, env.now());
    setClock("2026-10-14T11:00:00.000Z");
    await tick();
    const [n] = notifications();
    expect(n).toMatchObject({ source: `trigger:${id}`, title: `Trigger ${id} (wright)`, body: "check X", deep_link: `loomwright-studio://notifications/${n?.id}`, delivery_status: "pending" });
    expect(events(env.store, "notification_created").map((e) => e.payload)).toEqual([{ id: n?.id, source: `trigger:${id}` }]);
  });

  it("a stored trigger whose text holds a NUL is parked when it falls due: no notification, no retry each tick", async () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "hourly" }, env.now());
    // A row from before the registration refused a NUL.
    env.store.prepare("UPDATE triggers SET action_payload = ? WHERE id = ?").run("hour\u0000ly", id);
    setClock("2026-10-14T11:00:00.000Z");
    expect(() => fireDueTriggers(env.store, env.now())).toThrow(/NUL.*parked: no next fire/);
    expect(notifications()).toEqual([]);
    expect(row(id)).toMatchObject({ enabled: 1, next_fire_at: null });
    expect(fireDueTriggers(env.store, env.now())).toEqual([]);
  });

  it("an agent name long enough to overflow the title is clipped to MAX_NOTIFICATION_TITLE", async () => {
    const agent = "a".repeat(300);
    registerTrigger(env.store, { agent, kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "x" }, env.now());
    setClock("2026-10-14T11:00:00.000Z");
    fireDueTriggers(env.store, env.now());
    const [n] = notifications();
    expect(n?.title).toHaveLength(MAX_NOTIFICATION_TITLE);
    expect(n?.title.endsWith("…")).toBe(true);
  });
});

describe("playbook-linked triggers (phase 3 item 02)", () => {
  /** A `playbooks` row written directly (the playbooks feature owns the real writes). */
  function playbookRow(slug: string, status: string): void {
    env.store.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent, status) VALUES (?, 'P', 'wright', 'x', ?)").run(slug, status);
  }

  const queuedMessages = (): number => count(env.store, "SELECT count(*) FROM event_queue WHERE kind = 'message'");

  it("a linked trigger of a playbook that is not enabled starts no work: no notification, no message, one trigger_missed (playbook_not_enabled); a cron moves on, a once is spent (AC8)", async () => {
    playbookRow("hourly-notes", "draft");
    playbookRow("wake-me", "disabled");
    const cron = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC", action: "notify", text: "Playbook hourly-notes", playbook: "hourly-notes" }, env.now());
    const once = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "wake_agent", text: "Playbook wake-me", playbook: "wake-me" }, env.now());
    // A link to a playbook that does not exist is not enabled either.
    const orphan = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "Playbook gone", playbook: "gone" }, env.now());

    expect(fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"))).toEqual([
      { trigger_id: cron.id, scheduled_at: "2026-10-14T11:00:00.000Z", result: "skipped" },
      { trigger_id: once.id, scheduled_at: "2026-10-14T11:00:00.000Z", result: "skipped" },
      { trigger_id: orphan.id, scheduled_at: "2026-10-14T11:00:00.000Z", result: "skipped" },
    ]);
    expect(notifications()).toEqual([]);
    expect(queuedMessages()).toBe(0);
    expect(events(env.store, "trigger_fired")).toEqual([]);
    expect(events(env.store, "trigger_missed").map((e) => e.payload)).toEqual([
      expect.objectContaining({ trigger_id: cron.id, reason: "playbook_not_enabled", playbook: "hourly-notes", playbook_status: "draft", scheduled_at: "2026-10-14T11:00:00.000Z", enabled: true, next_fire_at: "2026-10-14T12:00:00.000Z" }),
      expect.objectContaining({ trigger_id: once.id, reason: "playbook_not_enabled", playbook: "wake-me", playbook_status: "disabled", enabled: false, next_fire_at: null }),
      expect.objectContaining({ trigger_id: orphan.id, reason: "playbook_not_enabled", playbook: "gone", playbook_status: null, enabled: false }),
    ]);
    // `last_result` keeps its closed set: this path leaves it as it was.
    expect(row(cron.id)).toMatchObject({ enabled: 1, next_fire_at: "2026-10-14T12:00:00.000Z", last_fired_at: null, last_result: null });
    expect(row(once.id)).toMatchObject({ enabled: 0, next_fire_at: null, last_fired_at: null, last_result: null });
    // The instant is the step's key: recorded once, never fired later.
    expect(count(env.store, "SELECT count(*) FROM work_steps WHERE key = ? AND status = 'done'", `trigger:${cron.id}:2026-10-14T11:00:00.000Z`)).toBe(1);

    // Enabling the playbook afterwards does not bring the recorded instant back.
    env.store.prepare("UPDATE playbooks SET status = 'enabled' WHERE slug = 'hourly-notes'").run();
    expect(fireDueTriggers(env.store, new Date("2026-10-14T11:00:30.000Z"))).toEqual([]);
    expect(notifications()).toEqual([]);
    expect(events(env.store, "trigger_missed")).toHaveLength(3);
  });

  it("a linked trigger of an enabled playbook fires as an unlinked trigger does (what a playbook fire does is item 08's)", async () => {
    playbookRow("on-now", "enabled");
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "Playbook on-now", playbook: "on-now" }, env.now());
    expect(fireDueTriggers(env.store, new Date("2026-10-14T11:00:00.000Z"))).toMatchObject([{ trigger_id: id, result: "fired" }]);
    expect(notifications()).toHaveLength(1);
    expect(events(env.store, "trigger_missed")).toEqual([]);
  });

  it("registerTrigger stores the link and names it in trigger_registered; an unlinked trigger stores null and its event has no playbook key", () => {
    const linked = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "wake_agent", text: "Playbook x", playbook: "x" }, env.now());
    const plain = registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "y" }, env.now());
    expect(env.store.prepare<[number], { playbook: string | null }>("SELECT playbook FROM triggers WHERE id = ?").get(linked.id)?.playbook).toBe("x");
    expect(env.store.prepare<[number], { playbook: string | null }>("SELECT playbook FROM triggers WHERE id = ?").get(plain.id)?.playbook).toBeNull();
    const [first, second] = events(env.store, "trigger_registered");
    expect(first?.payload).toMatchObject({ trigger_id: linked.id, playbook: "x" });
    expect(second?.payload).not.toHaveProperty("playbook");
    expect(() => registerTrigger(env.store, { agent: "wright", kind: "once", spec: "2026-10-14T11:00:00Z", action: "notify", text: "z", playbook: "a\u001bb" }, env.now())).toThrow(TriggerError);
  });

  it("formatTriggers names a linked trigger's playbook on its first line (bare, or quoted when odd); an unlinked block is unchanged", () => {
    const base = {
      id: 4,
      owning_agent: "wright",
      kind: "cron",
      spec: { cron: "0 9 * * *", tz: "UTC" },
      action: "wake_agent",
      text: "Playbook daily-notes",
      enabled: true,
      enabled_changed_by: null,
      next_fire_at: "2026-10-15T09:00:00.000Z",
      last_fired_at: null,
      last_result: null,
      created_by: "agent",
      created_at: WED_10Z,
    };
    const unlinked = formatTriggers([{ ...base, playbook: null }], "UTC", false);
    expect(unlinked.split("\n")[0]).toBe('#4 wright: cron "0 9 * * *" in UTC, wake_agent "Playbook daily-notes"');
    expect(formatTriggers([base], "UTC", false)).toBe(unlinked);
    const linked = formatTriggers([{ ...base, playbook: "daily-notes" }], "UTC", false).split("\n");
    expect(linked[0]).toBe('#4 wright: cron "0 9 * * *" in UTC, wake_agent "Playbook daily-notes"; playbook daily-notes');
    expect(linked.slice(1)).toEqual(unlinked.split("\n").slice(1));
    expect(formatTriggers([{ ...base, playbook: "odd\u001b[2J slug" }], "UTC", false).split("\n")[0]).toContain('; playbook "odd\\u001b[2J slug"');
  });

  it("updateTriggerSpec keeps the id and rewrites the kind, spec and next fire in place, with one trigger_updated (AC9)", () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 9 * * 1-5", tz: "Asia/Kolkata", action: "wake_agent", text: "Playbook p", playbook: "p" }, env.now());
    expect(updateTriggerSpec(env.store, { id, agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC", sessionId: 1 }, env.now())).toEqual({
      id,
      next_fire_at: "2026-10-14T11:00:00.000Z",
      changed: true,
    });
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
    expect(row(id)).toMatchObject({ id, kind: "cron", spec_json: JSON.stringify({ cron: "0 * * * *", tz: "UTC" }), enabled: 1, next_fire_at: "2026-10-14T11:00:00.000Z" });
    expect(env.store.prepare<[number], { playbook: string }>("SELECT playbook FROM triggers WHERE id = ?").get(id)?.playbook).toBe("p");
    const [updated] = events(env.store, "trigger_updated");
    expect(updated).toMatchObject({
      actor: "kernel",
      session_id: 1,
      payload: { trigger_id: id, playbook: "p", kind: "cron", spec: { cron: "0 * * * *", tz: "UTC" }, previous_kind: "cron", previous_spec: { cron: "0 9 * * 1-5", tz: "Asia/Kolkata" }, enabled: true, next_fire_at: "2026-10-14T11:00:00.000Z", by: "agent" },
    });
    // Another kind: same id again.
    expect(updateTriggerSpec(env.store, { id, agent: "wright", kind: "once", spec: "2026-10-14T12:00:00Z" }, env.now())).toMatchObject({ id, next_fire_at: "2026-10-14T12:00:00.000Z", changed: true });
    expect(row(id)).toMatchObject({ kind: "once", spec_json: JSON.stringify({ at: "2026-10-14T12:00:00Z" }) });
    // The same spec: no change, no event.
    expect(updateTriggerSpec(env.store, { id, agent: "wright", kind: "once", spec: "2026-10-14T12:00:00Z" }, env.now())).toMatchObject({ id, changed: false });
    expect(events(env.store, "trigger_updated")).toHaveLength(2);
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
  });

  it("updateTriggerSpec refuses before any write: an invalid spec, another agent's, a missing one, and the owner's off (of this trigger, or of one the new schedule re-registers)", () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 9 * * *", tz: "UTC", action: "notify", text: "t" }, env.now());
    const before = row(id);
    const code = (fn: () => unknown): string | undefined => {
      try {
        fn();
      } catch (err) {
        return err instanceof TriggerError ? err.code : "other";
      }
      return undefined;
    };
    expect(code(() => updateTriggerSpec(env.store, { id, agent: "wright", kind: "cron", spec: "61 * * * *", tz: "UTC" }, env.now()))).toBe("invalid_spec");
    expect(code(() => updateTriggerSpec(env.store, { id, agent: "wright", kind: "once", spec: "2026-10-14T09:00:00Z" }, env.now()))).toBe("invalid_spec");
    expect(code(() => updateTriggerSpec(env.store, { id, agent: "scout", kind: "cron", spec: "0 8 * * *", tz: "UTC" }, env.now()))).toBe("not_owner");
    expect(code(() => updateTriggerSpec(env.store, { id: 999, agent: "wright", kind: "cron", spec: "0 8 * * *", tz: "UTC" }, env.now()))).toBe("not_found");
    expect(row(id)).toEqual(before);
    expect(events(env.store, "trigger_updated")).toEqual([]);

    // Another trigger with the same text the owner turned off: re-scheduling onto its schedule would re-register it.
    const other = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 8 * * *", tz: "UTC", action: "notify", text: "t" }, env.now());
    setTriggerEnabled(env.store, { id: other.id, enabled: false, by: "owner" }, env.now());
    expect(code(() => updateTriggerSpec(env.store, { id, agent: "wright", kind: "cron", spec: "0 8 * * *", tz: "UTC" }, env.now()))).toBe("owner_off");
    // This trigger, turned off by the owner: final for agents.
    setTriggerEnabled(env.store, { id, enabled: false, by: "owner" }, env.now());
    expect(code(() => updateTriggerSpec(env.store, { id, agent: "wright", kind: "cron", spec: "0 7 * * *", tz: "UTC" }, env.now()))).toBe("owner_off");
    expect(events(env.store, "trigger_updated")).toEqual([]);
  });

  it("a trigger an agent turned off stays off when re-scheduled: no next fire until it is turned on", () => {
    const { id } = registerTrigger(env.store, { agent: "wright", kind: "cron", spec: "0 9 * * *", tz: "UTC", action: "notify", text: "t" }, env.now());
    setTriggerEnabled(env.store, { id, enabled: false, by: "agent" }, env.now());
    expect(updateTriggerSpec(env.store, { id, agent: "wright", kind: "cron", spec: "0 * * * *", tz: "UTC" }, env.now())).toEqual({ id, next_fire_at: null, changed: true });
    expect(row(id)).toMatchObject({ enabled: 0, next_fire_at: null, spec_json: JSON.stringify({ cron: "0 * * * *", tz: "UTC" }) });
  });
});
