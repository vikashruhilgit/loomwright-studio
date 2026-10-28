// The playbooks feature's `drafts` part (phase 3 item 02): Wright creates,
// updates, lists and disables versioned draft playbooks, each with one linked
// trigger and a read-only markdown mirror; the owner lists, shows, sets any
// policy value and turns a playbook off (final for agents); the mirror is
// resynced from the rows on a new Store. A temp data dir and a controllable
// clock; the tools run through the tool server's own `contributedToolHandler`
// (no SDK launch, no model); the verbs run through `runCli` against a real
// loopback API server.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_TOKEN_KEYCHAIN_SERVICE, startApiServer } from "../src/api/index.js";
import type { ApiServer } from "../src/api/index.js";
import { runCli } from "../src/cli/index.js";
import { PHASE1_RESERVED, mergeContributions } from "../src/features/index.js";
import type { ContributedTool, FeatureContribution } from "../src/features/index.js";
import { EventLoop } from "../src/loop/loop.js";
import {
  PLAYBOOK_AUDIT_KINDS,
  PLAYBOOK_TOOL_NAMES,
  PlaybookError,
  createPlaybook,
  disablePlaybook,
  draftsPart,
  getPlaybook,
  linkedTriggerOf,
  mirrorPath,
  playbookVerbs,
  playbooksContribution,
  playbooksContributionOf,
  refuseIfOwnerTurnedOff,
  renderPlaybookMirror,
  setPlaybookPolicy,
  slugBase,
} from "../src/playbooks/index.js";
import type { PlaybookRow } from "../src/playbooks/index.js";
import type { Store } from "../src/store/index.js";
import { contributedToolHandler } from "../src/tools/server.js";
import type { KernelToolContext, KernelToolResult } from "../src/tools/server.js";
import { fireDueTriggers, removeTrigger, setTriggerEnabled, triggersContribution, triggersSubcommand } from "../src/triggers/index.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";
import { stubProvider, unexpectedAbandon } from "./session-fakes.js";

const WED_10Z = "2026-10-14T10:00:00.000Z";
const TOKEN = "0123456789abcdef".repeat(4);
const HOST_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
  const t = (playbooksContribution.tools ?? []).find((x) => x.name === name);
  if (t === undefined) throw new Error(`no tool ${name}`);
  return t;
}

/** Call a playbooks tool as session `sessionId` running `agent`, through the tool server's handler. */
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

const DAILY = {
  name: "Daily repo summary",
  intent: "Every weekday at 9, summarise what changed in repo X.",
  trigger: { kind: "cron", spec: "0 9 * * 1-5", tz: "Asia/Kolkata" },
  dedupe_key: ["playbook.id", "trigger.scheduled_at"],
  priority: "low",
  model: "claude-sonnet-4-5",
  token_limit: 50_000,
};

const create = (args: Record<string, unknown> = {}, o?: { agent?: string | null; sessionId?: number }) =>
  call("kernel_playbook_create", { idempotency_key: `c${++keyN}`, ...DAILY, ...args }, o);
const update = (id: number, changes: Record<string, unknown>, o?: { agent?: string | null; sessionId?: number; key?: string }) =>
  call("kernel_playbook_update", { id, changes, idempotency_key: o?.key ?? `u${++keyN}` }, o);
const disable = (id: number, o?: { agent?: string | null; key?: string }) => call("kernel_playbook_disable", { id, idempotency_key: o?.key ?? `d${++keyN}` }, o);

interface Created {
  id: number;
  slug: string;
  status: string;
  version: number;
  trigger_id: number;
  next_fire_at: string;
  changed: boolean;
  mirror: string;
}

function row(id: number): PlaybookRow {
  const r = getPlaybook(env.store, id);
  if (r === undefined) throw new Error(`no playbook ${id}`);
  return r;
}

function snapshots(id: number): { version: number; snapshot: Record<string, unknown> }[] {
  return env.store
    .prepare<[number], { version: number; snapshot_json: string }>("SELECT version, snapshot_json FROM playbook_versions WHERE playbook = ? ORDER BY version")
    .all(id)
    .map((v) => ({ version: v.version, snapshot: JSON.parse(v.snapshot_json) as Record<string, unknown> }));
}

function mirrorText(slug: string): string {
  return readFileSync(mirrorPath(env.dataDir, slug), "utf8");
}

/** What the mirror must hold for playbook `id`'s current row, in the host's zone (as the kernel writes it). */
function expectedMirror(id: number): string {
  const r = row(id);
  return renderPlaybookMirror(r, linkedTriggerOf(env.store, r), HOST_ZONE);
}

function playbookEvents(): ReturnType<typeof events> {
  return events(env.store).filter((e) => e.kind.startsWith("playbook_"));
}

/** One tick of a loop composed with the shipped playbooks contribution's due work, at the env clock. */
async function tickPlaybooks(): Promise<void> {
  const loop = new EventLoop({ store: env.store, handlers: {}, dueWork: mergeContributions([playbooksContribution]).dueWork }, { now: env.now });
  await loop.tick();
}

describe("kernel_playbook_create (AC1, AC2, AC5)", () => {
  it("stores a draft at version 1, every given policy value proposed by Wright, one version snapshot, playbook_created, and a mirror marking each value (proposed) (AC1)", async () => {
    expect(PLAYBOOK_TOOL_NAMES).toEqual(["kernel_playbook_create", "kernel_playbook_update", "kernel_playbook_list", "kernel_playbook_disable"]);
    expect(PLAYBOOK_AUDIT_KINDS).toEqual(["playbook_created", "playbook_updated", "playbook_disabled", "playbook_dry_run", "playbook_enabled"]);
    const created = value<Created>(await create());
    expect(created).toEqual({
      id: 1,
      slug: "daily-repo-summary",
      status: "draft",
      version: 1,
      trigger_id: expect.any(Number),
      // 09:00 in Asia/Kolkata on Thursday.
      next_fire_at: "2026-10-15T03:30:00.000Z",
      changed: true,
      mirror: "memory/playbooks/daily-repo-summary.md",
    });
    expect(row(created.id)).toMatchObject({
      slug: "daily-repo-summary",
      name: "Daily repo summary",
      owning_agent: "wright",
      intent: DAILY.intent,
      status: "draft",
      version: 1,
      dedupe_key_spec: JSON.stringify(["playbook.id", "trigger.scheduled_at"]),
      dedupe_key_set_by: "wright",
      priority: "low",
      priority_set_by: "wright",
      model: "claude-sonnet-4-5",
      model_set_by: "wright",
      token_limit_per_day: 50_000,
      token_limit_set_by: "wright",
      effort: null,
      effort_set_by: null,
      api_key_fallback_json: null,
      api_key_fallback_set_by: null,
      created_at: WED_10Z,
      updated_at: WED_10Z,
    });
    // The snapshot is the full row at version 1, every column.
    expect(snapshots(created.id)).toEqual([{ version: 1, snapshot: { ...row(created.id) } }]);
    expect(playbookEvents()).toEqual([
      expect.objectContaining({
        kind: "playbook_created",
        actor: "kernel",
        session_id: 1,
        payload: { playbook_id: created.id, slug: "daily-repo-summary", owning_agent: "wright", version: 1, by: "wright", trigger_id: created.trigger_id },
      }),
    ]);
    const mirror = mirrorText("daily-repo-summary");
    expect(mirror).toBe(expectedMirror(created.id));
    for (const line of [
      "- Dedupe key: `playbook.id, trigger.scheduled_at` (proposed)",
      "- Priority: `low` (proposed)",
      "- Model: `claude-sonnet-4-5` (proposed)",
      "- Token limit per day: `50000` (proposed)",
    ]) {
      expect(mirror.split("\n"), line).toContain(line);
    }
  });

  it("an omitted policy field stays unset with no setter; priority keeps its default normal, not proposed", async () => {
    const created = value<Created>(await create({ dedupe_key: undefined, priority: undefined, model: undefined, token_limit: undefined }));
    expect(row(created.id)).toMatchObject({
      dedupe_key_spec: null,
      dedupe_key_set_by: null,
      priority: "normal",
      priority_set_by: null,
      model: null,
      model_set_by: null,
      token_limit_per_day: null,
      token_limit_set_by: null,
    });
    const lines = mirrorText(created.slug).split("\n");
    expect(lines).toContain("- Dedupe key: not set");
    expect(lines).toContain("- Priority: `normal`");
    expect(lines).toContain("- Model: not set");
  });

  it("registers exactly one trigger linked by slug, owned by the creating agent, starting no work (AC2)", async () => {
    const created = value<Created>(await create({}, { agent: "scout" }));
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
    expect(count(env.store, "SELECT count(*) FROM triggers WHERE playbook = ?", created.slug)).toBe(1);
    expect(env.store.prepare("SELECT id, owning_agent, playbook, action, action_payload, enabled FROM triggers").get()).toEqual({
      id: created.trigger_id,
      owning_agent: "scout",
      playbook: "daily-repo-summary",
      action: "wake_agent",
      action_payload: "Playbook daily-repo-summary",
      enabled: 1,
    });
    // A draft's trigger, when it comes due, starts no work (AC8).
    setClock("2026-10-15T03:30:00.000Z");
    expect(fireDueTriggers(env.store, env.now())).toMatchObject([{ trigger_id: created.trigger_id, result: "skipped" }]);
    expect(count(env.store, "SELECT count(*) FROM event_queue WHERE kind = 'message'")).toBe(0);
    expect(events(env.store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "playbook_not_enabled", playbook: "daily-repo-summary", next_fire_at: "2026-10-16T03:30:00.000Z" });
  });

  it("refuses an unknown dedupe field, a cron spec the triggers module refuses, priority urgent and an empty intent, naming the field; nothing is stored (AC5)", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ dedupe_key: ["playbook.id", "repo.sha"] }, "dedupe_key"],
      [{ dedupe_key: ["date", "date"] }, "dedupe_key"],
      [{ dedupe_key: [] }, "dedupe_key"],
      [{ trigger: { kind: "cron", spec: "61 * * * *", tz: "UTC" } }, "trigger"],
      [{ trigger: { kind: "cron", spec: "0 9 * * *" } }, "trigger"],
      [{ trigger: { kind: "once", spec: "2026-10-14T09:00:00Z" } }, "trigger"],
      [{ priority: "urgent" }, "priority"],
      [{ intent: "" }, "intent"],
      [{ intent: "   \n " }, "intent"],
      [{ name: "" }, "name"],
      [{ name: "two\nlines" }, "name"],
      [{ model: "has space" }, "model"],
      [{ token_limit: 0 }, "token_limit"],
    ];
    for (const [args, field] of cases) {
      const text = errorText(await create(args));
      expect(text, JSON.stringify(args)).toContain(field);
      expect(text.startsWith("kernel_playbook_create: "), text).toBe(true);
    }
    expect(errorText(await create({ trigger: { kind: "cron", spec: "61 * * * *", tz: "UTC" } }))).toMatch(/^kernel_playbook_create: trigger: /);
    expect(errorText(await create({ intent: "" }))).toBe("kernel_playbook_create: intent must not be empty");
    expect(count(env.store, "SELECT count(*) FROM playbooks")).toBe(0);
    expect(count(env.store, "SELECT count(*) FROM playbook_versions")).toBe(0);
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(0);
    expect(count(env.store, "SELECT count(*) FROM events")).toBe(0);
    expect(count(env.store, "SELECT count(*) FROM work_steps")).toBe(0);
    expect(existsSync(join(env.dataDir, "memory", "playbooks"))).toBe(false);
  });

  it("a session with no named agent is refused; a repeat with the same key returns the first result and stores one playbook", async () => {
    expect(errorText(await create({}, { agent: null }))).toContain("runs no named agent");
    const args = { idempotency_key: "same", ...DAILY };
    const first = value<Created>(await call("kernel_playbook_create", args));
    const again = value<Created>(await call("kernel_playbook_create", { ...args, name: "Something else" }));
    expect(again).toEqual(first);
    expect(count(env.store, "SELECT count(*) FROM playbooks")).toBe(1);
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
  });

  it("derives the slug once from the name (lowercase, runs of other characters as -, cut to 48, playbook when empty); a collision appends -2, -3", async () => {
    expect(slugBase("  Daily  Repo -- Summary!! ")).toBe("daily-repo-summary");
    expect(slugBase("../../etc/passwd")).toBe("etc-passwd");
    expect(slugBase("日本語")).toBe("playbook");
    expect(slugBase(`${"a".repeat(47)} b`)).toBe("a".repeat(47));
    expect(slugBase("x".repeat(80))).toHaveLength(48);
    // A slug is never all digits (a ref of only digits is read as an id).
    expect(slugBase("2026")).toBe("playbook-2026");
    expect(slugBase(" 007 ")).toBe("playbook-007");
    expect(slugBase("2026 plan")).toBe("2026-plan");
    const slugs: string[] = [];
    for (let i = 0; i < 3; i++) slugs.push(value<Created>(await create({ name: "Daily repo summary" })).slug);
    expect(slugs).toEqual(["daily-repo-summary", "daily-repo-summary-2", "daily-repo-summary-3"]);
    const odd = value<Created>(await create({ name: "../.." }));
    expect(odd.slug).toBe("playbook");
    expect(existsSync(join(env.dataDir, "memory", "playbooks", "playbook.md"))).toBe(true);
    // A name change keeps the slug.
    value(await update(1, { name: "Renamed" }));
    expect(row(1)).toMatchObject({ name: "Renamed", slug: "daily-repo-summary" });
    expect(() => mirrorPath(env.dataDir, "../x")).toThrow(/cannot be used as a file name/);
  });

  it("the whole create is one transaction: when its audit event cannot be written, no playbook, version or trigger is left", () => {
    const prepare = env.store.prepare.bind(env.store);
    vi.spyOn(env.store, "prepare").mockImplementation(((sql: string) => {
      if (sql.startsWith("INSERT INTO events")) throw new Error("disk I/O error");
      return prepare(sql);
    }) as Store["prepare"]);
    expect(() =>
      createPlaybook(env.store, { agent: "wright", name: "x", intent: "y", trigger: { kind: "once", spec: "2026-10-14T11:00:00Z" } }, env.now()),
    ).toThrow("disk I/O error");
    vi.restoreAllMocks();
    expect(count(env.store, "SELECT count(*) FROM playbooks")).toBe(0);
    expect(count(env.store, "SELECT count(*) FROM playbook_versions")).toBe(0);
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(0);
  });
});

describe("kernel_playbook_update / _list / _disable (AC4, AC6, AC9)", () => {
  it("a change to an enabled playbook makes it a draft at the next version, with a snapshot of that version (AC4)", async () => {
    const { id } = value<Created>(await create());
    env.store.prepare("UPDATE playbooks SET status = 'enabled' WHERE id = ?").run(id);
    setClock("2026-10-14T10:05:00.000Z");
    expect(value(await update(id, { intent: "Summarise repo X and repo Y." }))).toMatchObject({ id, status: "draft", version: 2, changed: true });
    expect(row(id)).toMatchObject({ status: "draft", version: 2, intent: "Summarise repo X and repo Y.", updated_at: "2026-10-14T10:05:00.000Z" });
    expect(snapshots(id).map((s) => [s.version, s.snapshot.status, s.snapshot.intent])).toEqual([
      [1, "draft", DAILY.intent],
      [2, "draft", "Summarise repo X and repo Y."],
    ]);
    expect(mirrorText("daily-repo-summary")).toBe(expectedMirror(id));
    // The owner's set does the same.
    env.store.prepare("UPDATE playbooks SET status = 'enabled' WHERE id = ?").run(id);
    setPlaybookPolicy(env.store, { id, field: "model", value: "claude-opus-4-1" }, env.now());
    expect(row(id)).toMatchObject({ status: "draft", version: 3, model: "claude-opus-4-1", model_set_by: "owner" });
    expect(snapshots(id).at(-1)).toEqual({ version: 3, snapshot: { ...row(id) } });
    expect(events(env.store, "playbook_updated").map((e) => e.payload)).toEqual([
      { playbook_id: id, version: 2, by: "wright", fields: ["intent"] },
      { playbook_id: id, version: 3, by: "owner", fields: ["model"] },
    ]);
  });

  it("a change that changes nothing writes nothing; an empty changes is an error", async () => {
    const { id } = value<Created>(await create());
    expect(value(await update(id, { priority: "low", intent: DAILY.intent, trigger: DAILY.trigger }))).toMatchObject({ version: 1, changed: false });
    expect(snapshots(id)).toHaveLength(1);
    expect(events(env.store, "playbook_updated")).toEqual([]);
    expect(events(env.store, "trigger_updated")).toEqual([]);
    expect(errorText(await update(id, {}))).toContain("changes must give at least one of");
  });

  it("Wright cannot overwrite a value the owner set; it can still change the values it proposed", async () => {
    const { id } = value<Created>(await create());
    setPlaybookPolicy(env.store, { id, field: "priority", value: "high" }, env.now());
    const text = errorText(await update(id, { priority: "low" }));
    expect(text).toBe("kernel_playbook_update: priority: the owner set this value; only the owner can change it");
    expect(errorText(await update(id, { priority: "high", model: "x" }))).toContain("priority: the owner set this value");
    expect(row(id)).toMatchObject({ priority: "high", priority_set_by: "owner", model: "claude-sonnet-4-5", version: 2 });
    expect(value(await update(id, { model: "claude-haiku-4-5" }))).toMatchObject({ version: 3, changed: true });
    expect(row(id)).toMatchObject({ model: "claude-haiku-4-5", model_set_by: "wright", priority: "high", priority_set_by: "owner" });
  });

  it("a trigger change re-schedules the SAME linked trigger: same id, new spec and next fire, a new version, no second trigger (AC9)", async () => {
    const created = value<Created>(await create());
    const result = value<Created>(await update(created.id, { trigger: { kind: "cron", spec: "0 18 * * *", tz: "UTC" } }));
    expect(result).toMatchObject({ id: created.id, version: 2, trigger_id: created.trigger_id, next_fire_at: "2026-10-14T18:00:00.000Z", changed: true });
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
    expect(env.store.prepare("SELECT id, kind, spec_json, next_fire_at, playbook FROM triggers").get()).toEqual({
      id: created.trigger_id,
      kind: "cron",
      spec_json: JSON.stringify({ cron: "0 18 * * *", tz: "UTC" }),
      next_fire_at: "2026-10-14T18:00:00.000Z",
      playbook: "daily-repo-summary",
    });
    expect(events(env.store, "playbook_updated").map((e) => e.payload.fields)).toEqual([["trigger"]]);
    expect(events(env.store, "trigger_updated")).toHaveLength(1);
    expect(mirrorText(created.slug)).toContain("- Schedule: cron `0 18 * * *` in `UTC`");

    // An invalid new spec: an error naming trigger, and nothing changes.
    const text = errorText(await update(created.id, { trigger: { kind: "cron", spec: "0 25 * * *", tz: "UTC" }, priority: "high" }));
    expect(text).toMatch(/^kernel_playbook_update: trigger: /);
    expect(row(created.id)).toMatchObject({ version: 2, priority: "low" });
    expect(env.store.prepare("SELECT spec_json FROM triggers").get()).toEqual({ spec_json: JSON.stringify({ cron: "0 18 * * *", tz: "UTC" }) });
    expect(snapshots(created.id)).toHaveLength(2);
    // The owner turned the trigger itself off: re-scheduling it is refused too.
    setTriggerEnabled(env.store, { id: created.trigger_id, enabled: false, by: "owner" }, env.now());
    expect(errorText(await update(created.id, { trigger: { kind: "cron", spec: "0 7 * * *", tz: "UTC" } }))).toMatch(/trigger: trigger \d+ was turned off by the owner/);
  });

  it("re-scheduling a once spent while the playbook was not enabled re-arms the SAME trigger; it fires once the playbook is enabled (AC9)", async () => {
    const created = value<Created>(await create({ trigger: { kind: "once", spec: "2026-10-14T10:30:00Z" } }));
    setClock("2026-10-14T10:31:00.000Z");
    expect(fireDueTriggers(env.store, env.now())).toMatchObject([{ trigger_id: created.trigger_id, result: "skipped" }]);
    expect(env.store.prepare("SELECT enabled, next_fire_at FROM triggers").get()).toEqual({ enabled: 0, next_fire_at: null });

    // The same (spent) instant again changes nothing; a new one re-arms the row.
    expect(value(await update(created.id, { trigger: { kind: "once", spec: "2026-10-14T10:30:00Z" } }))).toMatchObject({ version: 1, changed: false });
    const result = value<Created>(await update(created.id, { trigger: { kind: "once", spec: "2026-10-14T11:00:00Z" } }));
    expect(result).toMatchObject({ version: 2, trigger_id: created.trigger_id, next_fire_at: "2026-10-14T11:00:00.000Z", changed: true });
    expect(count(env.store, "SELECT count(*) FROM triggers")).toBe(1);
    expect(env.store.prepare("SELECT id, enabled, next_fire_at FROM triggers").get()).toEqual({ id: created.trigger_id, enabled: 1, next_fire_at: "2026-10-14T11:00:00.000Z" });
    expect(events(env.store, "trigger_updated")[0]?.payload).toMatchObject({ trigger_id: created.trigger_id, enabled: true, rearmed: true, next_fire_at: "2026-10-14T11:00:00.000Z" });

    env.store.prepare("UPDATE playbooks SET status = 'enabled' WHERE id = ?").run(created.id);
    setClock("2026-10-14T11:00:30.000Z");
    expect(fireDueTriggers(env.store, env.now())).toMatchObject([{ trigger_id: created.trigger_id, result: "fired" }]);
    expect(count(env.store, "SELECT count(*) FROM event_queue WHERE kind = 'message'")).toBe(1);
    expect(fireDueTriggers(env.store, env.now())).toEqual([]);
  });

  it("a spent once is re-armed even after the owner had turned it on; an off the owner or the agent chose stays as it was", async () => {
    // Owner turned it off then on, then it was spent while a draft: still a spend, so re-scheduling re-arms it.
    const a = value<Created>(await create({ trigger: { kind: "once", spec: "2026-10-14T10:30:00Z" } }));
    setTriggerEnabled(env.store, { id: a.trigger_id, enabled: false, by: "owner" }, env.now());
    setTriggerEnabled(env.store, { id: a.trigger_id, enabled: true, by: "owner" }, env.now());
    setClock("2026-10-14T10:31:00.000Z");
    fireDueTriggers(env.store, env.now());
    expect(value(await update(a.id, { trigger: { kind: "once", spec: "2026-10-14T12:00:00Z" } }))).toMatchObject({ next_fire_at: "2026-10-14T12:00:00.000Z", changed: true });

    // The agent turned it off: re-scheduled, still off with no next fire.
    const b = value<Created>(await create({ name: "B", trigger: { kind: "once", spec: "2026-10-14T13:00:00Z" } }));
    setTriggerEnabled(env.store, { id: b.trigger_id, enabled: false, by: "agent" }, env.now());
    expect(value(await update(b.id, { trigger: { kind: "once", spec: "2026-10-14T14:00:00Z" } }))).toMatchObject({ next_fire_at: null, changed: true });
    expect(env.store.prepare("SELECT enabled FROM triggers WHERE id = ?").get(b.trigger_id)).toEqual({ enabled: 0 });

    // The owner turned it off: refused, nothing changes.
    const c = value<Created>(await create({ name: "C", trigger: { kind: "once", spec: "2026-10-14T13:00:00Z" } }));
    setTriggerEnabled(env.store, { id: c.trigger_id, enabled: false, by: "owner" }, env.now());
    expect(errorText(await update(c.id, { trigger: { kind: "once", spec: "2026-10-14T14:00:00Z" } }))).toMatch(/trigger: trigger \d+ was turned off by the owner/);
    expect(env.store.prepare("SELECT enabled, next_fire_at FROM triggers WHERE id = ?").get(c.trigger_id)).toEqual({ enabled: 0, next_fire_at: null });
  });

  it("when the agent removed the linked trigger, the next trigger change links a new one: still exactly one", async () => {
    const created = value<Created>(await create());
    removeTrigger(env.store, { id: created.trigger_id, agent: "wright" }, env.now());
    expect(value(await update(created.id, { intent: "no trigger change" }))).toMatchObject({ version: 2, trigger_id: null, next_fire_at: null });
    const result = value<Created>(await update(created.id, { trigger: { kind: "once", spec: "2026-10-14T17:00:00Z" } }));
    expect(result).toMatchObject({ version: 3, next_fire_at: "2026-10-14T17:00:00.000Z", changed: true });
    expect(result.trigger_id).not.toBe(created.trigger_id);
    expect(count(env.store, "SELECT count(*) FROM triggers WHERE playbook = ?", created.slug)).toBe(1);
    expect(events(env.store, "playbook_updated").map((e) => e.payload.fields)).toEqual([["intent"], ["trigger"]]);
  });

  it("list shows the caller's own playbooks, every status, with the linked trigger; another agent's playbook is not_owner", async () => {
    const a = value<Created>(await create());
    const b = value<Created>(await create({ name: "Weekly" }, { agent: "scout" }));
    value(await disable(a.id));
    const listed = value<{ playbooks: Record<string, unknown>[] }>(await call("kernel_playbook_list", {}));
    expect(listed.playbooks.map((p) => [p.id, p.status, p.trigger_id, p.next_fire_at])).toEqual([[a.id, "disabled", a.trigger_id, a.next_fire_at]]);
    expect(errorText(await update(b.id, { intent: "mine now" }))).toContain("belongs to agent scout");
    expect(errorText(await disable(b.id))).toContain("belongs to agent scout");
  });

  it("after the owner's off, Wright's update and disable are errors saying so, and nothing changes; the guard throws the same error (AC6)", async () => {
    const { id } = value<Created>(await create());
    // A first update, before the off: its repeat must not report success afterwards.
    value(await update(id, { intent: "v2" }, { key: "early" }));
    const before = playbookEvents().length;
    const offResult = disablePlaybook(env.store, { id, by: "owner" }, env.now());
    expect(offResult).toMatchObject({ changed: true, playbook: { status: "disabled", version: 2 } });
    expect(events(env.store, "playbook_disabled").map((e) => [e.payload, e.session_id])).toEqual([[{ playbook_id: id, by: "owner" }, null]]);
    const message = `playbook ${id} was turned off by the owner; an agent cannot change, disable or re-enable it`;

    expect(errorText(await update(id, { intent: "v3" }))).toBe(`kernel_playbook_update: ${message}`);
    expect(errorText(await update(id, { intent: "v2" }, { key: "early" }))).toBe(`kernel_playbook_update: ${message}`);
    expect(errorText(await disable(id))).toBe(`kernel_playbook_disable: ${message}`);
    expect(row(id)).toMatchObject({ status: "disabled", version: 2, intent: "v2" });
    expect(snapshots(id)).toHaveLength(2);
    expect(playbookEvents()).toHaveLength(before + 1);

    let thrown: unknown;
    try {
      refuseIfOwnerTurnedOff(env.store, id);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(PlaybookError);
    expect(thrown).toMatchObject({ code: "owner_off", message });
    // A missing playbook passes (the caller reports not_found).
    expect(() => refuseIfOwnerTurnedOff(env.store, 999)).not.toThrow();
    // The owner may still set a value: a new version, still disabled.
    setPlaybookPolicy(env.store, { id, field: "priority", value: "high" }, env.now());
    expect(row(id)).toMatchObject({ status: "disabled", version: 3, priority_set_by: "owner" });
  });

  it("Wright's own disable leaves it Wright's (it may still change it); the owner's off after it records the owner and is final", async () => {
    const { id } = value<Created>(await create());
    expect(value(await disable(id))).toMatchObject({ status: "disabled", changed: true });
    expect(value(await disable(id))).toMatchObject({ status: "disabled", changed: false });
    expect(() => refuseIfOwnerTurnedOff(env.store, id)).not.toThrow();
    expect(value(await update(id, { intent: "still mine" }))).toMatchObject({ status: "disabled", version: 2 });
    expect(disablePlaybook(env.store, { id, by: "owner" }, env.now()).changed).toBe(true);
    expect(disablePlaybook(env.store, { id, by: "owner" }, env.now()).changed).toBe(false);
    expect(events(env.store, "playbook_disabled").map((e) => e.payload.by)).toEqual(["wright", "owner"]);
    expect(() => refuseIfOwnerTurnedOff(env.store, id)).toThrow(/turned off by the owner/);
  });

  it("a disabled playbook with no disable event on record counts as the owner's off (a gap in the evidence never unlocks it)", async () => {
    const { id } = value<Created>(await create());
    env.store.prepare("UPDATE playbooks SET status = 'disabled' WHERE id = ?").run(id);
    expect(() => refuseIfOwnerTurnedOff(env.store, id)).toThrow(PlaybookError);
    expect(errorText(await update(id, { intent: "x" }))).toContain("turned off by the owner");
  });
});

describe("the markdown mirror (AC1, AC7)", () => {
  it("renders the full format: a generated-file line, status, version, intent, trigger, one line per policy field, last dry run", () => {
    const r = createPlaybook(
      env.store,
      { agent: "wright", name: "Daily repo summary", intent: "Summarise repo X.\nKeep it short.", trigger: { kind: "cron", spec: "0 9 * * 1-5", tz: "Asia/Kolkata" }, priority: "high", token_limit: 1000 },
      env.now(),
    );
    expect(renderPlaybookMirror(r.playbook, r.trigger, "Asia/Kolkata")).toBe(
      [
        "# `Daily repo summary`",
        "",
        "This file is generated by the Studio kernel from its `playbooks` table (playbook 1, `daily-repo-summary`). Edits here are not read: the owner changes a playbook with `studio playbooks set` and turns it off with `studio playbooks off`.",
        "",
        "- Status: `draft`",
        "- Version: 1",
        "",
        "## Intent",
        "",
        "```",
        "Summarise repo X.",
        "Keep it short.",
        "```",
        "",
        "## Trigger",
        "",
        "- Schedule: cron `0 9 * * 1-5` in `Asia/Kolkata` (trigger 1)",
        "- Next fire when this file was written: 2026-10-15 09:00 +05:30 (`studio triggers` shows the live schedule)",
        "",
        "## Policy",
        "",
        "A value marked (proposed) was proposed by an agent; the owner can change any value.",
        "",
        "- Dedupe key: not set",
        "- Priority: `high` (proposed)",
        "- Model: not set",
        "- Token limit per day: `1000` (proposed)",
        "- Mode: `draft`",
        "- Effort: not set",
        "- API-key fallback: not set",
        "",
        "Last dry run: No dry run yet.",
        "",
      ].join("\n"),
    );
  });

  it("renders stored text inert: the intent in a fence longer than any backtick run, one-line values as code spans, no control character", async () => {
    const intent = "# Not a heading\n```\n````` five\n[link](http://x) <b>html</b>\u001b[2J\r\nend";
    const created = value<Created>(await create({ name: "Evil `name` [x](y)", intent, model: "a`b" }));
    const mirror = mirrorText(created.slug);
    expect(mirror).toBe(expectedMirror(created.id));
    expect(mirror.startsWith("# `` Evil `name` [x](y) ``\n")).toBe(true);
    expect(mirror).toContain("\n``````\n# Not a heading\n```\n````` five\n[link](http://x) <b>html</b>?[2J\nend\n``````\n");
    expect(mirror).toContain("- Model: `` a`b `` (proposed)");
    expect(mirror).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });

  it("is rewritten after every change and for every status, disabled included", async () => {
    const { id, slug } = value<Created>(await create());
    value(await update(id, { priority: "normal" }));
    expect(mirrorText(slug)).toContain("- Version: 2");
    value(await disable(id));
    expect(mirrorText(slug)).toContain("- Status: `disabled`");
    expect(mirrorText(slug)).toBe(expectedMirror(id));
  });

  it("a new Store's due work rewrites a missing or stale mirror byte-identical to its row's rendering; an equal one is not rewritten; once per Store (AC7)", async () => {
    const a = value<Created>(await create({ name: "Alpha" }));
    const b = value<Created>(await create({ name: "Beta" }));
    const c = value<Created>(await create({ name: "Gamma" }));
    // A crash after the row commit and before the mirror write: one file gone, one stale.
    env.store.prepare("UPDATE playbooks SET intent = 'changed before the crash', version = 2 WHERE id = ?").run(b.id);
    rmSync(mirrorPath(env.dataDir, a.slug));
    const old = new Date("2026-01-01T00:00:00.000Z");
    utimesSync(mirrorPath(env.dataDir, c.slug), old, old);

    env.restart();
    await tickPlaybooks();
    expect(mirrorText(a.slug)).toBe(expectedMirror(a.id));
    expect(mirrorText(b.slug)).toBe(expectedMirror(b.id));
    expect(mirrorText(b.slug)).toContain("changed before the crash");
    expect(statSync(mirrorPath(env.dataDir, c.slug)).mtimeMs).toBe(old.getTime());
    expect(events(env.store, "due_work_failed")).toEqual([]);
    expect(playbookEvents().filter((e) => e.payload.version === 2)).toEqual([]);

    // Once per Store: the same store's next tick does not resync again.
    writeFileSync(mirrorPath(env.dataDir, a.slug), "edited by hand\n");
    await tickPlaybooks();
    expect(mirrorText(a.slug)).toBe("edited by hand\n");
    env.restart();
    await tickPlaybooks();
    expect(mirrorText(a.slug)).toBe(expectedMirror(a.id));
  });

  it("one playbook's mirror failing does not stop the others: one due_work_failed naming it", async () => {
    const a = value<Created>(await create({ name: "Alpha" }));
    const b = value<Created>(await create({ name: "Beta" }));
    rmSync(mirrorPath(env.dataDir, a.slug));
    mkdirSync(mirrorPath(env.dataDir, a.slug));
    writeFileSync(mirrorPath(env.dataDir, b.slug), "stale\n");
    env.restart();
    await tickPlaybooks();
    expect(mirrorText(b.slug)).toBe(expectedMirror(b.id));
    const failed = events(env.store, "due_work_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ contributor: "playbooks" });
    expect(String(failed[0]?.payload.error)).toContain(`playbook ${a.id}`);
  });

  it("a mirror write that fails leaves the change stored and says so (mirror_error); the next Store's due work writes the file", async () => {
    // A regular file where the mirror directory should be: every mirror write fails.
    mkdirSync(join(env.dataDir, "memory"), { recursive: true });
    writeFileSync(join(env.dataDir, "memory", "playbooks"), "not a directory\n");
    const created = value<Created & { mirror_error?: string }>(await create());
    expect(created).toMatchObject({ id: 1, status: "draft", version: 1 });
    expect(created.mirror_error).toMatch(/^the change is stored; its mirror was not written \(.+\); the kernel rewrites it after a restart$/);
    expect(row(created.id).version).toBe(1);
    rmSync(join(env.dataDir, "memory", "playbooks"));
    env.restart();
    await tickPlaybooks();
    expect(mirrorText(created.slug)).toBe(expectedMirror(created.id));
  });

  it("removing the due work would leave a stale mirror: the shipped drafts part carries it", () => {
    expect(draftsPart.dueWork).toHaveLength(1);
    expect(mergeContributions([playbooksContribution]).dueWork.map((d) => d.run)).toEqual([...(draftsPart.dueWork ?? [])]);
  });
});

describe("the owner: studio playbooks list | show | set | off and the /playbooks routes (AC3, AC6, AC10)", () => {
  let server: ApiServer;
  let paths: string[];

  beforeEach(async () => {
    server = await startApiServer(
      {
        store: env.store,
        sessions: { stopAll: async () => [], abandonSession: unexpectedAbandon },
        loop: { start: () => {}, stop: async () => {} },
        authProviders: [stubProvider()],
        token: TOKEN,
        routes: mergeContributions([triggersContribution, playbooksContribution], PHASE1_RESERVED).routes,
      },
      { now: env.now },
    );
    writeFileSync(join(env.dataDir, "api.json"), JSON.stringify({ port: server.port, host: "127.0.0.1", pid: process.pid, started_at: WED_10Z }));
    paths = [];
  });

  afterEach(async () => {
    await server.close();
  });

  function studio() {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const contributions: FeatureContribution[] = [
      { name: "triggers", subcommands: [triggersSubcommand({ timeZone: "Asia/Kolkata" })] },
      playbooksContributionOf([{ ...draftsPart, verbs: playbookVerbs({ timeZone: "Asia/Kolkata" }) }]),
    ];
    const run = (...argv: string[]) =>
      runCli(argv, {
        dataDir: env.dataDir,
        keychain: { read: (s) => (s === API_TOKEN_KEYCHAIN_SERVICE ? TOKEN : undefined) },
        isPidAlive: () => true,
        contributions,
        fetch: ((input: string | URL | Request, init?: RequestInit) => {
          paths.push(new URL(String(input)).pathname + new URL(String(input)).search);
          return fetch(input, init);
        }) as typeof fetch,
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

  it("studio triggers lists a playbook's trigger with playbook <slug> on its block (AC2)", async () => {
    const created = value<Created>(await create());
    const c = studio();
    expect(await c.run("triggers")).toBe(0);
    expect(c.stdout().split("\n")[0]).toBe(`#${created.trigger_id} wright: cron "0 9 * * 1-5" in Asia/Kolkata, wake_agent "Playbook daily-repo-summary"; playbook daily-repo-summary`);
  });

  it("set <id> priority high: owner-set, version 2, two full snapshots, playbook_updated by owner, mirror shows high without (proposed) (AC3)", async () => {
    const { id, slug } = value<Created>(await create());
    const v1 = { ...row(id) };
    setClock("2026-10-14T10:02:00.000Z");
    const c = studio();
    expect(await c.run("playbooks", "set", String(id), "priority", "high")).toBe(0);
    expect(c.stdout()).toBe(`studio: playbook ${id} priority set to high (version 2)\n`);
    expect(paths).toEqual([`/playbooks/${id}/set`]);
    expect(row(id)).toMatchObject({ priority: "high", priority_set_by: "owner", version: 2, updated_at: "2026-10-14T10:02:00.000Z" });
    expect(snapshots(id)).toEqual([
      { version: 1, snapshot: v1 },
      { version: 2, snapshot: { ...row(id) } },
    ]);
    expect(events(env.store, "playbook_updated")).toEqual([expect.objectContaining({ session_id: null, payload: { playbook_id: id, version: 2, by: "owner", fields: ["priority"] } })]);
    const lines = mirrorText(slug).split("\n");
    expect(lines).toContain("- Priority: `high`");
    expect(lines).toContain("- Model: `claude-sonnet-4-5` (proposed)");
    expect(lines).toContain("- Token limit per day: `50000` (proposed)");
    expect(mirrorText(slug)).toBe(expectedMirror(id));

    const again = studio();
    expect(await again.run("playbooks", "set", String(id), "priority", "high")).toBe(0);
    expect(again.stdout()).toBe(`studio: playbook ${id} priority was already high\n`);
    expect(snapshots(id)).toHaveLength(2);
  });

  it("set takes every policy field: a comma-separated dedupe key, a model, a token limit, none to clear; an unknown field or a refused value is one stderr line and exit 2, nothing stored (AC10)", async () => {
    const { id } = value<Created>(await create());
    for (const [field, raw] of [
      ["dedupe_key", "trigger.id, date"],
      ["model", "claude-opus-4-1"],
      ["token_limit", "1200"],
    ]) {
      const c = studio();
      expect(await c.run("playbooks", "set", String(id), field as string, raw as string), field).toBe(0);
    }
    expect(row(id)).toMatchObject({
      dedupe_key_spec: JSON.stringify(["trigger.id", "date"]),
      dedupe_key_set_by: "owner",
      model: "claude-opus-4-1",
      model_set_by: "owner",
      token_limit_per_day: 1200,
      token_limit_set_by: "owner",
      version: 4,
    });
    const clear = studio();
    expect(await clear.run("playbooks", "set", String(id), "model", "none")).toBe(0);
    expect(row(id)).toMatchObject({ model: null, model_set_by: "owner", version: 5 });
    expect(mirrorText("daily-repo-summary").split("\n")).toContain("- Model: not set");

    paths = [];
    const refused: [string[], string][] = [
      [["nope", "x"], 'studio playbooks set: unknown field "nope" (one of dedupe_key, priority, model, token_limit, mode)\n'],
      [["priority", "urgent"], 'studio playbooks set: priority must be one of low, normal, high (got "urgent")\n'],
      [["priority", "none"], "studio playbooks set: priority cannot be cleared: it is one of low, normal, high\n"],
      [["token_limit", "0"], "studio playbooks set: token_limit must be a positive whole number of tokens per day\n"],
      [["dedupe_key", "date,repo"], 'studio playbooks set: dedupe_key: unknown field "repo" (the fields are playbook.id, playbook.version, trigger.id, trigger.scheduled_at, date, item.id, item.revision)\n'],
      [["model", "two words"], "studio playbooks set: model must be 1-200 characters with no whitespace, NUL or other control character\n"],
      [["mode", "live"], "studio playbooks set: live_mode_not_in_phase_6: mode live is not available in phase 6; a playbook runs in draft mode\n"],
      [["mode", "none"], "studio playbooks set: mode cannot be cleared: it is one of draft, live\n"],
    ];
    for (const [rest, stderr] of refused) {
      const c = studio();
      expect(await c.run("playbooks", "set", String(id), ...rest), rest.join(" ")).toBe(2);
      expect(c.stderr()).toBe(stderr);
      expect(c.stdout()).toBe("");
    }
    expect(paths).toEqual([]);
    expect(row(id).version).toBe(5);
    // The route refuses the same values itself, naming the field.
    const res = await api("POST", `/playbooks/${id}/set`, { field: "priority", value: "urgent" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input", message: 'priority must be one of low, normal, high (got "urgent")' });
    expect((await api("POST", `/playbooks/${id}/set`, { field: "effort", value: "high" })).status).toBe(400);
    expect((await api("POST", `/playbooks/${id}/set`, { field: "priority", value: 3 })).status).toBe(400);
    expect((await api("POST", `/playbooks/${id}/set`, [1])).status).toBe(400);
    expect((await api("POST", "/playbooks/abc/set", { field: "priority", value: "high" })).status).toBe(400);
    expect((await api("POST", "/playbooks/999/set", { field: "priority", value: "high" })).status).toBe(404);
    expect(row(id).version).toBe(5);
  });

  it("list hides disabled ones unless --all; --json is the route's answer; show gives the playbook, its versions and its linked trigger; off is final for Wright (AC6, AC10)", async () => {
    const a = value<Created>(await create());
    const b = value<Created>(await create({ name: "Weekly \u202e digest", trigger: { kind: "once", spec: "2026-10-14T17:00:00+05:30" } }));
    const off = studio();
    expect(await off.run("playbooks", "off", String(b.id))).toBe(0);
    expect(off.stdout()).toBe(`studio: playbook ${b.id} turned off\n`);
    expect(paths).toEqual([`/playbooks/${b.id}/off`]);
    const offAgain = studio();
    expect(await offAgain.run("playbooks", "off", String(b.id))).toBe(0);
    expect(offAgain.stdout()).toBe(`studio: playbook ${b.id} was already off\n`);
    expect(events(env.store, "playbook_disabled").map((e) => e.payload)).toEqual([{ playbook_id: b.id, by: "owner" }]);
    expect(errorText(await update(b.id, { intent: "x" }))).toContain("turned off by the owner");
    expect(errorText(await disable(b.id))).toContain("turned off by the owner");

    paths = [];
    const list = studio();
    expect(await list.run("playbooks", "list")).toBe(0);
    expect(list.stdout()).toBe(`#${a.id} daily-repo-summary "Daily repo summary": draft, version 1, agent wright; trigger #${a.trigger_id}, next fire 2026-10-15 09:00 +05:30\n`);
    const all = studio();
    expect(await all.run("playbooks", "list", "--all")).toBe(0);
    expect(all.stdout()).toContain(`#${b.id} weekly-digest "Weekly ? digest": disabled, version 1, agent wright; trigger #${b.trigger_id}, next fire 2026-10-14 17:00 +05:30\n`);
    expect(all.stdout()).not.toContain("\u202e");
    const json = studio();
    expect(await json.run("playbooks", "list", "--json", "--all")).toBe(0);
    expect(JSON.parse(json.stdout())).toEqual(await (await api("GET", "/playbooks?all=1")).json());
    expect(paths).toEqual(["/playbooks", "/playbooks", "/playbooks"].map((p, i) => (i === 0 ? p : `${p}?all=1`)));

    setPlaybookPolicy(env.store, { id: a.id, field: "priority", value: "high" }, new Date("2026-10-14T10:05:00.000Z"));
    paths = [];
    const show = studio();
    expect(await show.run("playbooks", "show", "daily-repo-summary")).toBe(0);
    expect(paths).toEqual(["/playbooks/daily-repo-summary"]);
    expect(show.stdout()).toBe(
      [
        `#${a.id} daily-repo-summary "Daily repo summary": draft, version 2, agent wright`,
        `  intent: "${DAILY.intent}"`,
        `  trigger #${a.trigger_id}: cron "0 9 * * 1-5" in Asia/Kolkata; on; next fire 2026-10-15 09:00 +05:30`,
        "  dedupe key: playbook.id,trigger.scheduled_at (proposed)",
        "  priority: high (set by owner)",
        "  model: claude-sonnet-4-5 (proposed)",
        "  token limit per day: 50000 (proposed)",
        "  effort: not set",
        "  api-key fallback: not set",
        "  versions: 1 (2026-10-14 15:30 +05:30), 2 (2026-10-14 15:35 +05:30)",
        "  created 2026-10-14 15:30 +05:30; updated 2026-10-14 15:35 +05:30",
        "  mirror: memory/playbooks/daily-repo-summary.md (under the Studio data dir; edits there are not read)",
        "",
      ].join("\n"),
    );
    const byId = await (await api("GET", `/playbooks/${a.id}`)).json();
    expect(byId).toEqual({
      playbook: { ...row(a.id) },
      versions: [
        { version: 1, created_at: WED_10Z },
        { version: 2, created_at: "2026-10-14T10:05:00.000Z" },
      ],
      trigger: expect.objectContaining({ id: a.trigger_id, playbook: "daily-repo-summary" }),
    });
    const showJson = studio();
    expect(await showJson.run("playbooks", "show", String(a.id), "--json")).toBe(0);
    expect(JSON.parse(showJson.stdout())).toEqual(byId);

    // An all-digit name gets a slug that is not one, so show <slug> finds that playbook (not an id).
    const year = value<Created>(await create({ name: "2026" }));
    expect(year.slug).toBe("playbook-2026");
    const one = value<Created>(await create({ name: "1" }));
    expect(one.slug).toBe("playbook-1");
    const showYear = studio();
    expect(await showYear.run("playbooks", "show", year.slug, "--json")).toBe(0);
    expect(JSON.parse(showYear.stdout()).playbook).toMatchObject({ id: year.id, slug: "playbook-2026" });
    expect(getPlaybook(env.store, "playbook-1")?.id).toBe(one.id);
    expect(getPlaybook(env.store, "1")?.id).toBe(1);

    const missing = studio();
    expect(await missing.run("playbooks", "show", "nope")).toBe(1);
    expect(missing.stderr()).toBe('studio: no playbook "nope"\n');
    const missingOff = studio();
    expect(await missingOff.run("playbooks", "off", "999")).toBe(1);
    expect(missingOff.stderr()).toBe("studio: no playbook 999\n");
    expect((await api("GET", "/playbooks/999")).status).toBe(404);
    expect((await api("POST", "/playbooks/x/off")).status).toBe(400);
  });

  it("a usage error is one stderr line and exit 2 before any API call", async () => {
    for (const argv of [
      ["playbooks", "list", "--bogus"],
      ["playbooks", "list", "--all", "--all"],
      ["playbooks", "show"],
      ["playbooks", "show", "1", "--all"],
      ["playbooks", "set", "1", "priority"],
      ["playbooks", "set", "0", "priority", "high"],
      ["playbooks", "set", "1", "priority", "high", "extra"],
      ["playbooks", "off"],
      ["playbooks", "off", "1", "2"],
    ]) {
      const c = studio();
      expect(await c.run(...argv), argv.join(" ")).toBe(2);
      expect(c.stderr().split("\n"), argv.join(" ")).toHaveLength(2);
      expect(c.stderr().startsWith("usage: studio playbooks "), argv.join(" ")).toBe(true);
      expect(c.stdout()).toBe("");
    }
    expect(paths).toEqual([]);
  });

  it("an empty list says so, with --all and without", async () => {
    const c = studio();
    expect(await c.run("playbooks", "list")).toBe(0);
    expect(c.stdout()).toBe("no draft or enabled playbooks (studio playbooks list --all lists disabled ones too)\n");
    const all = studio();
    expect(await all.run("playbooks", "list", "--all")).toBe(0);
    expect(all.stdout()).toBe("no playbooks\n");
  });
});
