// Phase 6 item 04: the `poll` trigger kind. Validation at creation (the 60 s
// floor, the connector and the repos it reaches, the filters, the playbook
// link), the two-phase per-item fire (Phase A fetches with no write, Phase B
// is one work step), crash safety, rate-limit backoff, `connector_missing`
// with one notification per outage, pause and the kill switch, the item cap,
// and the triggers due work running the cron and poll fires side by side.
//
// Everything runs on a temp store with a fixed instant per call and
// `FakeGitHubClient` (never the network). Notifications are only recorded
// rows: no delivery runs here, and the suite's setup guard refuses any real
// notifier.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engageKillSwitch, releaseKillSwitch } from "../src/api/index.js";
import { engagePause } from "../src/console/pause.js";
import type { GitHubClient, GitHubFailure, GitHubPull, GitHubPullFilters, GitHubPullSummary, GitHubResponse } from "../src/integrations/types.js";
import { EventLoop } from "../src/loop/loop.js";
import { InvalidNotificationError } from "../src/notifications/record.js";
import { createPlaybook } from "../src/playbooks/store.js";
import { Store } from "../src/store/index.js";
import { formatTriggers } from "../src/triggers/cli.js";
import { MAX_POLL_ITEMS, firePollTriggers } from "../src/triggers/poll.js";
import { TriggerError, fireDueTriggers, getTrigger, registerTrigger, setTriggerEnabled, updateTriggerSpec } from "../src/triggers/store.js";
import { triggersContribution } from "../src/triggers/index.js";
import { events } from "./budget-helpers.js";
import { FAKE_RATE_LIMIT, FakeGitHubClient } from "./fixtures/github-fake.js";

// A throw inside the poll's work step after its first enqueue (AC5): `enqueueEvent` runs as shipped unless a test sets the hook.
const hooks = vi.hoisted(() => ({ beforeEnqueue: undefined as undefined | ((call: number) => void), calls: 0 }));
vi.mock("../src/loop/queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/loop/queue.js")>();
  return {
    ...actual,
    enqueueEvent: (...args: Parameters<typeof actual.enqueueEvent>) => {
      hooks.calls++;
      hooks.beforeEnqueue?.(hooks.calls);
      return actual.enqueueEvent(...args);
    },
  };
});
// The notification record refusing the connector_missing row: `recordNotification` runs as shipped unless a test sets the hook.
const notifyHooks = vi.hoisted(() => ({ beforeRecord: undefined as undefined | (() => void) }));
vi.mock("../src/notifications/record.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/notifications/record.js")>();
  return {
    ...actual,
    recordNotification: (...args: Parameters<typeof actual.recordNotification>) => {
      notifyHooks.beforeRecord?.();
      return actual.recordNotification(...args);
    },
  };
});

const NOW = new Date("2026-10-27T10:00:00.000Z");
const INTERVAL = 300;
/** The first due instant of a poll registered at `NOW`. */
const T1 = "2026-10-27T10:05:00.000Z";
const AFTER_T1 = new Date("2026-10-27T10:05:01.000Z");

let tmp: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-triggers-poll-"));
  hooks.beforeEnqueue = undefined;
  hooks.calls = 0;
  notifyHooks.beforeRecord = undefined;
});

afterEach(() => {
  for (const s of stores.splice(0)) if (s.isOpen) s.close();
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---- Fixtures ------------------------------------------------------------------

function open(): Store {
  const store = new Store({ dataDir: tmp });
  stores.push(store);
  return store;
}

/** A `github` connector row (raw, as item 03 will write it). */
function connect(store: Store, status = "connected", repos: unknown = ["o/r", "o/other"]): void {
  store
    .prepare("INSERT INTO connectors (kind, status, reachable_repos_json) VALUES ('github', ?, ?)")
    .run(status, typeof repos === "string" ? repos : JSON.stringify(repos));
}

function setConnector(store: Store, status: string): void {
  store.prepare("UPDATE connectors SET status = ? WHERE kind = 'github'").run(status);
}

/** A poll spec as JSON text. */
function spec(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ source: "github.pulls", repos: ["o/r"], filters: {}, interval_seconds: INTERVAL, ...over });
}

/** A playbook whose linked trigger is a poll, created at `NOW` through the playbooks store; `enabled` unless told otherwise. */
function pollPlaybook(store: Store, pollSpec = spec(), enabled = true): { playbookId: number; triggerId: number } {
  const change = createPlaybook(store, { agent: "wright", name: "Review", intent: "review PRs", trigger: { kind: "poll", spec: pollSpec } }, NOW);
  if (enabled) store.prepare("UPDATE playbooks SET status = 'enabled' WHERE id = ?").run(change.playbook.id);
  return { playbookId: change.playbook.id, triggerId: change.trigger?.id as number };
}

function pull(number: number, over: Partial<GitHubPull> = {}): GitHubPull {
  return {
    number,
    title: `PR ${number}`,
    author: "alice",
    draft: false,
    head_sha: `sha${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    updated_at: "2026-10-27T09:00:00.000Z",
    body: "",
    state: "open",
    base_ref: "main",
    head_ref: `b${number}`,
    labels: [],
    ...over,
  };
}

function rateLimited(resetsAt: string): GitHubFailure {
  return { ok: false, error: "rate_limited", resets_at: resetsAt, rateLimit: { limit: 5000, remaining: 0, reset_at: resetsAt } };
}

/** A client that runs `onList` when a listing is asked for (during Phase A's fetch), then answers as `inner`. */
class HookedClient implements GitHubClient {
  constructor(
    readonly inner: FakeGitHubClient,
    readonly onList: () => void,
  ) {}
  getTokenInfo = (): ReturnType<GitHubClient["getTokenInfo"]> => this.inner.getTokenInfo();
  listReachableRepos = (): ReturnType<GitHubClient["listReachableRepos"]> => this.inner.listReachableRepos();
  listOpenPulls(repo: string, filters: GitHubPullFilters): Promise<GitHubResponse<readonly GitHubPullSummary[]>> {
    this.onList();
    return this.inner.listOpenPulls(repo, filters);
  }
  getPull = (repo: string, n: number): ReturnType<GitHubClient["getPull"]> => this.inner.getPull(repo, n);
  getPullDiff = (repo: string, n: number, max: number): ReturnType<GitHubClient["getPullDiff"]> => this.inner.getPullDiff(repo, n, max);
  listPullFiles = (repo: string, n: number): ReturnType<GitHubClient["listPullFiles"]> => this.inner.listPullFiles(repo, n);
  listPullComments = (repo: string, n: number): ReturnType<GitHubClient["listPullComments"]> => this.inner.listPullComments(repo, n);
}

function listCalls(client: FakeGitHubClient): number {
  return client.calls.filter((c) => c.method === "listOpenPulls").length;
}

function count(store: Store, sql: string): number {
  return Number(store.prepare(sql).pluck().get());
}

function triggerRow(store: Store, id: number): { enabled: number; next_fire_at: string | null; last_result: string | null; last_fired_at: string | null; spec_json: string } {
  return store.prepare("SELECT enabled, next_fire_at, last_result, last_fired_at, spec_json FROM triggers WHERE id = ?").get(id) as never;
}

function queued(store: Store): { source_ref: string; priority: string; payload: Record<string, unknown> }[] {
  return store
    .prepare<[], { source_ref: string; priority: string; payload_json: string }>("SELECT source_ref, priority, payload_json FROM event_queue WHERE kind = 'message' ORDER BY id")
    .all()
    .map((r) => ({ source_ref: r.source_ref, priority: r.priority, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));
}

function thrown(fn: () => unknown): TriggerError {
  try {
    fn();
  } catch (err) {
    if (err instanceof TriggerError) return err;
    throw err;
  }
  throw new Error("expected a TriggerError");
}

/** Row counts every trigger write path could touch. */
function written(store: Store): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ["triggers", "playbooks", "events", "event_queue", "notifications", "work_steps"]) out[t] = count(store, `SELECT count(*) FROM ${t}`);
  return out;
}

const plus = (iso: string | Date, seconds: number): string => new Date(new Date(iso).getTime() + seconds * 1000).toISOString();

// ---- Validation ------------------------------------------------------------------

describe("a poll is validated when it is registered or re-scheduled (AC1-AC3)", () => {
  it("AC1: interval_seconds 30 is refused poll_interval_below_floor on register and re-schedule, nothing written; 60 is accepted with next_fire_at now + 60 s and the spec stored as given", () => {
    const store = open();
    connect(store);
    const before = written(store);
    const reg = thrown(() => registerTrigger(store, { agent: "wright", kind: "poll", spec: spec({ interval_seconds: 30 }), action: "wake_agent", text: "t", playbook: "review" }, NOW));
    expect(reg.code).toBe("poll_interval_below_floor");
    expect(reg.message).toMatch(/^poll_interval_below_floor: /);
    expect(written(store)).toEqual(before);

    const given = { source: "github.pulls", repos: ["O/R", "o/other"], filters: { author: "alice", draft: false }, interval_seconds: 60 };
    const ok = registerTrigger(store, { agent: "wright", kind: "poll", spec: JSON.stringify(given), action: "wake_agent", text: "t", playbook: "review" }, NOW);
    expect(ok.next_fire_at).toBe(plus(NOW, 60));
    expect(getTrigger(store, ok.id)?.spec).toEqual(given);
    expect(events(store, "trigger_registered")[0]?.payload).toMatchObject({ kind: "poll", spec: given, next_fire_at: plus(NOW, 60), playbook: "review" });

    // Re-schedule: 30 refused, the row unchanged; an unchanged re-save is no change; 60 re-schedules from now.
    const rowBefore = triggerRow(store, ok.id);
    const later = new Date("2026-10-27T11:00:00.000Z");
    const upd = thrown(() => updateTriggerSpec(store, { id: ok.id, agent: "wright", kind: "poll", spec: spec({ interval_seconds: 30 }) }, later));
    expect(upd.code).toBe("poll_interval_below_floor");
    expect(triggerRow(store, ok.id)).toEqual(rowBefore);
    expect(updateTriggerSpec(store, { id: ok.id, agent: "wright", kind: "poll", spec: JSON.stringify(given) }, later)).toEqual({ id: ok.id, next_fire_at: plus(NOW, 60), changed: false });
    expect(updateTriggerSpec(store, { id: ok.id, agent: "wright", kind: "poll", spec: spec({ interval_seconds: 600 }) }, later)).toEqual({ id: ok.id, next_fire_at: plus(later, 600), changed: true });
  });

  it("AC2: a repo outside reachable_repos_json is refused poll_repo_not_reachable naming every such repo; reachable repos compare case-insensitively", () => {
    const store = open();
    connect(store, "connected", ["o/r"]);
    const before = written(store);
    const err = thrown(() => registerTrigger(store, { agent: "wright", kind: "poll", spec: spec({ repos: ["o/r", "o/secret", "x/y"] }), action: "wake_agent", text: "t", playbook: "review" }, NOW));
    expect(err.code).toBe("poll_repo_not_reachable");
    expect(err.message).toMatch(/^poll_repo_not_reachable: .*o\/secret, x\/y$/);
    expect(err.message).not.toMatch(/o\/r,/);
    expect(written(store)).toEqual(before);
    expect(registerTrigger(store, { agent: "wright", kind: "poll", spec: spec({ repos: ["O/R"] }), action: "wake_agent", text: "t", playbook: "review" }, NOW).id).toBe(1);
  });

  it("AC2: an unparseable reachable_repos_json reaches no repo", () => {
    const store = open();
    connect(store, "connected", "not json");
    expect(thrown(() => registerTrigger(store, { agent: "wright", kind: "poll", spec: spec(), action: "wake_agent", text: "t", playbook: "review" }, NOW)).code).toBe("poll_repo_not_reachable");
  });

  it("AC3: no github connector, or one disconnected / expired / rejected, is refused poll_connector_missing; expiring is usable", () => {
    const store = open();
    const register = (): unknown => registerTrigger(store, { agent: "wright", kind: "poll", spec: spec(), action: "wake_agent", text: "t", playbook: "review" }, NOW);
    expect(thrown(register).code).toBe("poll_connector_missing");
    connect(store, "disconnected");
    for (const status of ["disconnected", "expired", "rejected"]) {
      setConnector(store, status);
      const err = thrown(register);
      expect(err.code).toBe("poll_connector_missing");
      expect(err.message).toMatch(new RegExp(`^poll_connector_missing: .*status ${status}`));
    }
    expect(count(store, "SELECT count(*) FROM triggers")).toBe(0);
    expect(count(store, "SELECT count(*) FROM events")).toBe(0);
    setConnector(store, "expiring");
    expect(register()).toMatchObject({ id: 1 });
  });

  it("AC3: an unknown filter key is refused poll_filter_unknown naming the key; a poll with no playbook is refused invalid_input; nothing written", () => {
    const store = open();
    connect(store);
    const unknown = thrown(() => registerTrigger(store, { agent: "wright", kind: "poll", spec: spec({ filters: { label: "bug" } }), action: "wake_agent", text: "t", playbook: "review" }, NOW));
    expect(unknown.code).toBe("poll_filter_unknown");
    expect(unknown.message).toMatch(/^poll_filter_unknown: .*"label"/);
    const orphan = thrown(() => registerTrigger(store, { agent: "wright", kind: "poll", spec: spec(), action: "wake_agent", text: "t" }, NOW));
    expect(orphan.code).toBe("invalid_input");
    expect(orphan.message).toMatch(/must belong to a playbook/);
    expect(count(store, "SELECT count(*) FROM triggers")).toBe(0);
    expect(count(store, "SELECT count(*) FROM events")).toBe(0);
  });

  it("shape errors are invalid_spec: not JSON, another source, empty / malformed / duplicate repos, a mistyped filter, a fractional interval, a tz, an unknown field", () => {
    const store = open();
    connect(store);
    const cases: [string, string | undefined][] = [
      ["every 5m", undefined],
      [JSON.stringify(["o/r"]), undefined],
      [spec({ source: "github.issues" }), undefined],
      [spec({ repos: [] }), undefined],
      [spec({ repos: ["just-a-name"] }), undefined],
      [spec({ repos: ["o/.."] }), undefined],
      [spec({ repos: ["o/r", "O/R"] }), undefined],
      [spec({ filters: { draft: "yes" } }), undefined],
      [spec({ filters: { author: 7 } }), undefined],
      [spec({ interval_seconds: 60.5 }), undefined],
      [spec({ interval_seconds: "300" }), undefined],
      [spec({ interval_seconds: 9_000_000_000_000 }), undefined],
      [spec(), "UTC"],
      [spec({ extra: true }), undefined],
    ];
    for (const [s, tz] of cases) {
      expect(thrown(() => registerTrigger(store, { agent: "wright", kind: "poll", spec: s, tz, action: "wake_agent", text: "t", playbook: "review" }, NOW)).code, s).toBe("invalid_spec");
    }
    expect(count(store, "SELECT count(*) FROM triggers")).toBe(0);
  });

  it("an unchanged re-save is no change even while GitHub is disconnected; a changed spec then is refused poll_connector_missing", () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    setConnector(store, "disconnected");
    const before = written(store);
    expect(updateTriggerSpec(store, { id: triggerId, agent: "wright", kind: "poll", spec: spec() }, NOW)).toEqual({ id: triggerId, next_fire_at: T1, changed: false });
    expect(thrown(() => updateTriggerSpec(store, { id: triggerId, agent: "wright", kind: "poll", spec: spec({ interval_seconds: 600 }) }, NOW)).code).toBe("poll_connector_missing");
    expect(written(store)).toEqual(before);
  });

  it("the playbook path reaches the same validation, and turning a poll off and on schedules it now + interval", () => {
    const store = open();
    connect(store);
    expect(() => pollPlaybook(store, spec({ interval_seconds: 30 }))).toThrow(/^trigger: poll_interval_below_floor: /);
    const { triggerId } = pollPlaybook(store);
    expect(triggerRow(store, triggerId)).toMatchObject({ enabled: 1, next_fire_at: T1, last_result: null });
    setTriggerEnabled(store, { id: triggerId, enabled: false, by: "owner" }, NOW);
    const on = new Date("2026-10-27T12:00:00.000Z");
    expect(setTriggerEnabled(store, { id: triggerId, enabled: true, by: "owner" }, on).trigger.next_fire_at).toBe(plus(on, INTERVAL));
  });

  it("studio triggers prints a poll's source, repos and interval as data", () => {
    const text = formatTriggers(
      [{ id: 1, owning_agent: "wright", playbook: "review", kind: "poll", spec: { source: "github.pulls", repos: ["o/r", "o/\u001b[2Jx"], filters: { draft: false }, interval_seconds: 300 }, action: "wake_agent", text: "Playbook review", enabled: true }],
      "UTC",
      true,
    );
    expect(text).toContain('poll github.pulls "o/r", "o/\\u001b[2Jx" every 300s filters "{\\"draft\\":false}"');
    expect(text).not.toContain("\u001b");
  });
});

// ---- Firing ------------------------------------------------------------------

describe("a poll fires one message per item (AC4, AC6, AC10)", () => {
  it("AC4: two open PRs queue exactly two messages with per-item source_refs and items, two poll_item_queued and one trigger_fired items: 2", async () => {
    const store = open();
    connect(store);
    const { playbookId, triggerId } = pollPlaybook(store);
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(9), pull(4)] } });
    expect(await firePollTriggers(store, github, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "fired", items: 2 }]);

    const rows = queued(store);
    expect(rows.map((r) => r.source_ref)).toEqual([`playbook:${playbookId}:${T1}:github:o/r#4`, `playbook:${playbookId}:${T1}:github:o/r#9`]);
    expect(rows[0]?.payload).toEqual({
      agent: "wright",
      playbook: playbookId,
      version: 1,
      trigger_id: triggerId,
      scheduled_at: T1,
      item: { ref: "github:o/r#4", revision: "sha4", title: "PR 4", url: "https://github.com/o/r/pull/4", updated_at: "2026-10-27T09:00:00.000Z" },
    });
    expect(rows[1]?.payload.item).toMatchObject({ ref: "github:o/r#9", revision: "sha9" });
    expect(rows.every((r) => r.priority === "normal")).toBe(true);
    const items = events(store, "poll_item_queued").map((e) => e.payload);
    expect(items).toEqual([
      { trigger_id: triggerId, playbook_id: playbookId, item_ref: "github:o/r#4", revision: "sha4", queue_id: 1 },
      { trigger_id: triggerId, playbook_id: playbookId, item_ref: "github:o/r#9", revision: "sha9", queue_id: 2 },
    ]);
    const fired = events(store, "trigger_fired");
    expect(fired).toHaveLength(1);
    expect(fired[0]?.payload).toEqual({
      trigger_id: triggerId,
      action: "wake_agent",
      playbook: "review",
      playbook_id: playbookId,
      scheduled_at: T1,
      items: 2,
      enabled: true,
      next_fire_at: plus(AFTER_T1, INTERVAL),
    });
    expect(triggerRow(store, triggerId)).toMatchObject({ last_result: "fired", last_fired_at: AFTER_T1.toISOString(), next_fire_at: plus(AFTER_T1, INTERVAL) });
    expect(github.calls).toEqual([{ method: "listOpenPulls", args: ["o/r", {}] }]);
  });

  it("repos in spec order, PRs by number; the kernel applies the filters again whatever the client answered", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store, spec({ repos: ["o/r", "o/other"], filters: { draft: false, author: "alice" } }));
    // A client that ignores the filters: the kernel's own check still drops the draft and bob's PR.
    const loose = new FakeGitHubClient({ pulls: { "o/r": [pull(3, { draft: true }), pull(2)], "o/other": [pull(1, { author: "bob" }), pull(5)] } });
    const ignoring = new HookedClient(loose, () => undefined);
    ignoring.listOpenPulls = (repo: string): Promise<GitHubResponse<readonly GitHubPullSummary[]>> => loose.listOpenPulls(repo, {});
    await firePollTriggers(store, ignoring, AFTER_T1);
    expect(events(store, "poll_item_queued").map((e) => e.payload.item_ref)).toEqual(["github:o/r#2", "github:o/other#5"]);
    expect(events(store, "trigger_fired")[0]?.payload).toMatchObject({ trigger_id: triggerId, items: 2 });
  });

  it("listing entries the kernel cannot name (no positive number, no head SHA) are dropped, a repeated number is queued once; a listing that is not a list is a client_error", async () => {
    const store = open();
    connect(store);
    pollPlaybook(store);
    const inner = new FakeGitHubClient();
    const odd = new HookedClient(inner, () => undefined);
    const entries = [pull(0), pull(3, { head_sha: "" }), pull(2.5), pull(7), pull(7, { head_sha: "other" })] as unknown as GitHubPullSummary[];
    odd.listOpenPulls = () => Promise.resolve({ ok: true, data: entries, rateLimit: FAKE_RATE_LIMIT });
    await firePollTriggers(store, odd, AFTER_T1);
    expect(events(store, "poll_item_queued").map((e) => e.payload.item_ref)).toEqual(["github:o/r#7"]);

    // A fresh data dir for the second case (a store holds its dir's lock).
    store.close();
    rmSync(tmp, { recursive: true, force: true });
    tmp = mkdtempSync(join(tmpdir(), "studio-triggers-poll-"));
    const store2 = open();
    connect(store2);
    pollPlaybook(store2);
    odd.listOpenPulls = () => Promise.resolve({ ok: true, data: { not: "a list" } as unknown as GitHubPullSummary[], rateLimit: FAKE_RATE_LIMIT });
    expect(await firePollTriggers(store2, odd, AFTER_T1)).toMatchObject([{ result: "source_error" }]);
    expect(events(store2, "trigger_missed")[0]?.payload).toMatchObject({ error: "client_error", message: "the listing is not a list" });
  });

  it("a state filter other than open matches nothing (the listing is open PRs only)", async () => {
    const store = open();
    connect(store);
    pollPlaybook(store, spec({ filters: { state: "closed" } }));
    await firePollTriggers(store, new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } }), AFTER_T1);
    expect(queued(store)).toEqual([]);
    expect(events(store, "trigger_fired")[0]?.payload).toMatchObject({ items: 0 });
  });

  it("AC6: no open PRs queues nothing, trigger_fired has items: 0, and no session starts", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    expect(await firePollTriggers(store, new FakeGitHubClient(), AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "fired", items: 0 }]);
    expect(count(store, "SELECT count(*) FROM event_queue")).toBe(0);
    expect(count(store, "SELECT count(*) FROM sessions")).toBe(0);
    expect(events(store, "poll_item_queued")).toEqual([]);
    expect(events(store, "trigger_fired").map((e) => e.payload)).toEqual([expect.objectContaining({ trigger_id: triggerId, items: 0 })]);
    expect(events(store, "trigger_fired")[0]?.payload).not.toHaveProperty("items_capped");
  });

  it(`AC10: more than MAX_POLL_ITEMS (${MAX_POLL_ITEMS}) open PRs queue exactly MAX_POLL_ITEMS, and trigger_fired carries items_capped and items_found`, async () => {
    const store = open();
    connect(store);
    pollPlaybook(store);
    const many = Array.from({ length: MAX_POLL_ITEMS + 7 }, (_, i) => pull(i + 1));
    await firePollTriggers(store, new FakeGitHubClient({ pulls: { "o/r": many } }), AFTER_T1);
    expect(count(store, "SELECT count(*) FROM event_queue WHERE kind = 'message'")).toBe(100);
    expect(MAX_POLL_ITEMS).toBe(100);
    expect(events(store, "trigger_fired")[0]?.payload).toMatchObject({ items: 100, items_capped: true, items_found: 107 });
    // The lowest numbers are kept.
    expect(events(store, "poll_item_queued").at(-1)?.payload.item_ref).toBe("github:o/r#100");
  });

  it("the cron path never sees a poll row: a due poll is not in fireDueTriggers' outcomes and is left due", () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    expect(fireDueTriggers(store, AFTER_T1)).toEqual([]);
    expect(triggerRow(store, triggerId)).toMatchObject({ next_fire_at: T1, last_result: null });
  });

  it("a linked playbook that is not enabled: no fetch, trigger_missed playbook_not_enabled, last_result unchanged, next fire now + interval", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store, spec(), false);
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    expect(await firePollTriggers(store, github, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "skipped" }]);
    expect(listCalls(github)).toBe(0);
    expect(queued(store)).toEqual([]);
    expect(triggerRow(store, triggerId)).toMatchObject({ last_result: null, next_fire_at: plus(AFTER_T1, INTERVAL) });
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "playbook_not_enabled", playbook: "review", playbook_status: "draft", scheduled_at: T1 });
  });
});

describe("crash safety (AC5)", () => {
  it("a throw inside the step after the first enqueue rolls everything back; the retry queues each item once", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1), pull(2)] } });
    const before = written(store);
    hooks.calls = 0;
    hooks.beforeEnqueue = (call) => {
      if (call === 2) throw new Error("crash after the first enqueue");
    };
    await expect(firePollTriggers(store, github, AFTER_T1)).rejects.toThrow(/crash after the first enqueue/);
    expect(hooks.calls).toBe(2);
    // Nothing of the instant is on disk: no queue row, no event, no work step. The thrown step moved it off T1.
    expect(written(store)).toEqual(before);
    expect(triggerRow(store, triggerId)).toMatchObject({ next_fire_at: plus(AFTER_T1, INTERVAL), last_result: null });

    // A `kill -9` at that throw would have left it due at T1: the replay queues each item once.
    store.prepare("UPDATE triggers SET next_fire_at = ? WHERE id = ?").run(T1, triggerId);
    hooks.beforeEnqueue = undefined;
    expect(await firePollTriggers(store, github, AFTER_T1)).toMatchObject([{ result: "fired", items: 2 }]);
    expect(queued(store).map((r) => r.source_ref)).toEqual([`playbook:1:${T1}:github:o/r#1`, `playbook:1:${T1}:github:o/r#2`]);
    expect(events(store, "poll_item_queued")).toHaveLength(2);
    expect(events(store, "trigger_fired")).toHaveLength(1);
  });

  it("a re-run of the instant after its step committed queues nothing new and fetches nothing: the trigger is moved past it (already_done)", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1), pull(2)] } });
    await firePollTriggers(store, github, AFTER_T1);
    const after = { queue: count(store, "SELECT count(*) FROM event_queue"), items: events(store, "poll_item_queued").length };
    // The instant comes due again (a clock stepped back, a restored row): its step is done.
    store.prepare("UPDATE triggers SET next_fire_at = ? WHERE id = ?").run(T1, triggerId);
    const replay = new Date("2026-10-27T10:06:00.000Z");
    expect(await firePollTriggers(store, github, replay)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "already_done" }]);
    expect(listCalls(github)).toBe(1);
    expect(count(store, "SELECT count(*) FROM event_queue")).toBe(after.queue);
    expect(events(store, "poll_item_queued")).toHaveLength(after.items);
    expect(events(store, "trigger_fired")).toHaveLength(1);
    expect(events(store, "trigger_missed").map((e) => e.payload)).toEqual([expect.objectContaining({ reason: "already_done", scheduled_at: T1, next_fire_at: plus(replay, INTERVAL) })]);
    expect(triggerRow(store, triggerId).next_fire_at).toBe(plus(replay, INTERVAL));
  });

  it("an instant whose row moved while its fetch was in flight (the owner's off then on) is re-checked in the step and writes nothing for it", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    const inner = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    const toggleDuringFetch = new HookedClient(inner, () => {
      setTriggerEnabled(store, { id: triggerId, enabled: false, by: "owner" }, AFTER_T1);
      setTriggerEnabled(store, { id: triggerId, enabled: true, by: "owner" }, AFTER_T1);
    });
    expect(await firePollTriggers(store, toggleDuringFetch, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "skipped" }]);
    expect(queued(store)).toEqual([]);
    expect(events(store, "poll_item_queued")).toEqual([]);
    expect(events(store, "trigger_fired")).toEqual([]);
    expect(triggerRow(store, triggerId)).toMatchObject({ enabled: 1, next_fire_at: plus(AFTER_T1, INTERVAL), last_result: null });
  });
});

describe("source failures (AC7)", () => {
  it("rate_limited with resets_at past now + interval: nothing queued, last_result rate_limited, next fire at resets_at, trigger_missed names it", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    const resetsAt = "2026-10-27T11:00:00.000Z";
    expect(Date.parse(resetsAt)).toBeGreaterThan(Date.parse(plus(AFTER_T1, INTERVAL)));
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] }, failures: { listOpenPulls: rateLimited(resetsAt) } });
    expect(await firePollTriggers(store, github, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "rate_limited" }]);
    expect(queued(store)).toEqual([]);
    const row = triggerRow(store, triggerId);
    expect(row.last_result).toBe("rate_limited");
    expect(Date.parse(row.next_fire_at as string)).toBeGreaterThanOrEqual(Date.parse(resetsAt));
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ trigger_id: triggerId, reason: "rate_limited", resets_at: resetsAt, repo: "o/r", scheduled_at: T1, next_fire_at: resetsAt });
  });

  it("rate_limited with resets_at before now + interval keeps now + interval", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    await firePollTriggers(store, new FakeGitHubClient({ failures: { listOpenPulls: rateLimited("2026-10-27T10:06:00.000Z") } }), AFTER_T1);
    expect(triggerRow(store, triggerId).next_fire_at).toBe(plus(AFTER_T1, INTERVAL));
  });

  it("http_error: last_result source_error, schedule now + interval, the client called at most once per repo (the first failure stops the fetch, no retry)", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store, spec({ repos: ["o/r", "o/other"] }));
    const github = new FakeGitHubClient({ failures: { listOpenPulls: { ok: false, error: "http_error", status: 502, rateLimit: FAKE_RATE_LIMIT } } });
    expect(await firePollTriggers(store, github, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "source_error" }]);
    expect(github.calls).toEqual([{ method: "listOpenPulls", args: ["o/r", {}] }]);
    expect(queued(store)).toEqual([]);
    expect(triggerRow(store, triggerId)).toMatchObject({ last_result: "source_error", next_fire_at: plus(AFTER_T1, INTERVAL) });
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "source_error", error: "http_error", status: 502, repo: "o/r" });
  });

  it("a later repo failing (unreachable) queues nothing for the instant, not even the first repo's items", async () => {
    const store = open();
    connect(store);
    pollPlaybook(store, spec({ repos: ["o/r", "o/other"] }));
    const inner = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    const second = new HookedClient(inner, () => undefined);
    second.listOpenPulls = (repo, filters) =>
      repo === "o/other" ? Promise.resolve({ ok: false, error: "unreachable", rateLimit: null }) : inner.listOpenPulls(repo, filters);
    await firePollTriggers(store, second, AFTER_T1);
    expect(queued(store)).toEqual([]);
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "source_error", error: "unreachable", repo: "o/other" });
  });

  it("a client that throws instead of answering is a source_error (client_error), never a retry loop", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    const throwing = new HookedClient(new FakeGitHubClient(), () => {
      throw new Error("socket hang up");
    });
    expect(await firePollTriggers(store, throwing, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "source_error" }]);
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "source_error", error: "client_error", message: "socket hang up" });
    expect(triggerRow(store, triggerId).next_fire_at).toBe(plus(AFTER_T1, INTERVAL));
  });
});

describe("a missing connector parks the poll and notifies once per outage (AC8)", () => {
  it("disconnected over two instants: never fetched, last_result connector_missing, exactly one notification (source trigger:<id>); a fire ends the outage, the next one notifies again", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    setConnector(store, "disconnected");
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    expect(await firePollTriggers(store, github, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "connector_missing" }]);
    const t2 = new Date(plus(AFTER_T1, INTERVAL + 1));
    expect(await firePollTriggers(store, github, t2)).toMatchObject([{ result: "connector_missing" }]);
    expect(listCalls(github)).toBe(0);
    expect(triggerRow(store, triggerId).last_result).toBe("connector_missing");
    const notes = store.prepare("SELECT source, title FROM notifications").all() as { source: string; title: string }[];
    expect(notes).toEqual([{ source: `trigger:${triggerId}`, title: `Poll trigger ${triggerId}: GitHub not connected` }]);
    const missed = events(store, "trigger_missed").map((e) => e.payload);
    expect(missed).toEqual([
      expect.objectContaining({ reason: "connector_missing", connector_status: "disconnected", client: true, notification_id: 1 }),
      expect.objectContaining({ reason: "connector_missing", connector_status: "disconnected", client: true }),
    ]);
    expect(missed[1]).not.toHaveProperty("notification_id");
    expect(queued(store)).toEqual([]);

    setConnector(store, "connected");
    const t3 = new Date(plus(t2, INTERVAL + 1));
    expect(await firePollTriggers(store, github, t3)).toMatchObject([{ result: "fired", items: 1 }]);
    setConnector(store, "expired");
    await firePollTriggers(store, github, new Date(plus(t3, INTERVAL + 1)));
    expect(count(store, "SELECT count(*) FROM notifications")).toBe(2);
  });

  it("no client wired: a due poll records connector_missing (client: false), never throws", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    expect(await firePollTriggers(store, undefined, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "connector_missing" }]);
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "connector_missing", connector_status: "connected", client: false });
    expect(count(store, "SELECT count(*) FROM notifications")).toBe(1);
  });
});

describe("pause and the kill switch (AC9)", () => {
  it("the owner's pause: never fetched, nothing queued, missed_paused", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    engagePause(store, "2026-10-27T10:04:00.000Z", "api");
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    expect(await firePollTriggers(store, github, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "missed_paused" }]);
    expect(listCalls(github)).toBe(0);
    expect(queued(store)).toEqual([]);
    expect(triggerRow(store, triggerId)).toMatchObject({ last_result: "missed_paused", next_fire_at: plus(AFTER_T1, INTERVAL) });
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "paused", scheduled_at: T1 });
  });

  it("the kill switch engaged and then released over the instant: never fetched, nothing queued, missed_kill_switch; while engaged nothing runs", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    engageKillSwitch(store, "2026-10-27T10:04:00.000Z");
    expect(await firePollTriggers(store, github, AFTER_T1)).toEqual([]);
    releaseKillSwitch(store, "2026-10-27T10:05:30.000Z");
    expect(await firePollTriggers(store, github, new Date("2026-10-27T10:06:00.000Z"))).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "missed_kill_switch" }]);
    expect(listCalls(github)).toBe(0);
    expect(queued(store)).toEqual([]);
    expect(triggerRow(store, triggerId).last_result).toBe("missed_kill_switch");
    expect(events(store, "trigger_missed")[0]?.payload).toMatchObject({ reason: "kill_switch", scheduled_at: T1 });
  });

  it("a pause engaged during the fetch is re-checked in the step: missed_paused, nothing queued", async () => {
    const store = open();
    connect(store);
    pollPlaybook(store);
    const pauseDuringFetch = new HookedClient(new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } }), () => engagePause(store, AFTER_T1.toISOString(), "api"));
    expect(await firePollTriggers(store, pauseDuringFetch, AFTER_T1)).toMatchObject([{ result: "missed_paused" }]);
    expect(queued(store)).toEqual([]);
  });

  it("the kill switch engaged during the fetch defers the instant with nothing written; after the release it is the kill switch's miss", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    const before = written(store);
    const killDuringFetch = new HookedClient(new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } }), () => engageKillSwitch(store, "2026-10-27T10:05:00.500Z"));
    expect(await firePollTriggers(store, killDuringFetch, AFTER_T1)).toEqual([{ trigger_id: triggerId, scheduled_at: T1, result: "deferred" }]);
    // Only the kill switch's own event: the instant wrote nothing.
    expect(written(store)).toEqual({ ...before, events: (before.events ?? 0) + 1 });
    expect(triggerRow(store, triggerId).next_fire_at).toBe(T1);
  });
});

describe("the triggers due work (AC10b)", () => {
  it("a failing cron trigger and a due poll in the same tick: the poll still fires and the due work throws once (one due_work_failed)", async () => {
    const store = open();
    connect(store);
    const cron = registerTrigger(store, { agent: "wright", kind: "cron", spec: "* * * * *", tz: "UTC", action: "notify", text: "tick" }, NOW);
    store.prepare("UPDATE triggers SET spec_json = ? WHERE id = ?").run(JSON.stringify({ cron: "not a cron", tz: "UTC" }), cron.id);
    const { triggerId } = pollPlaybook(store);
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1), pull(2)] } });
    const run = triggersContribution.dueWork?.[0];
    if (run === undefined) throw new Error("no due work");
    const loop = new EventLoop({ store, handlers: {}, dueWork: [{ owner: "triggers", run }], github }, { now: () => AFTER_T1 });
    await loop.tick();
    expect(events(store, "poll_item_queued")).toHaveLength(2);
    expect(triggerRow(store, triggerId).last_result).toBe("fired");
    const failed = events(store, "due_work_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.payload).toMatchObject({ contributor: "triggers" });
    expect(String(failed[0]?.payload.error)).toMatch(new RegExp(`trigger ${cron.id}: `));
  });

  it("a step that throws on every try (a stored priority outside the closed set) is moved to now + interval: the source is fetched once per interval, never every tick", async () => {
    const store = open();
    connect(store);
    const { playbookId, triggerId } = pollPlaybook(store);
    store.prepare("UPDATE playbooks SET priority = 'bogus' WHERE id = ?").run(playbookId);
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    const run = triggersContribution.dueWork?.[0];
    if (run === undefined) throw new Error("no due work");
    const loop = new EventLoop({ store, handlers: {}, dueWork: [{ owner: "triggers", run }], github }, { now: () => AFTER_T1 });
    for (let i = 0; i < 5; i++) await loop.tick();
    expect(listCalls(github)).toBe(1);
    const failed = events(store, "due_work_failed");
    expect(failed).toHaveLength(1);
    expect(String(failed[0]?.payload.error)).toMatch(new RegExp(`trigger ${triggerId}: .*\\(next fire ${plus(AFTER_T1, INTERVAL).replace(/\./g, "\\.")}\\)`));
    expect(queued(store)).toEqual([]);
    expect(events(store, "trigger_fired")).toEqual([]);
    expect(triggerRow(store, triggerId)).toMatchObject({ enabled: 1, next_fire_at: plus(AFTER_T1, INTERVAL), last_result: null });
    // The next interval tries (and fetches) once more.
    const later = new Date(plus(AFTER_T1, INTERVAL + 1));
    await expect(firePollTriggers(store, github, later)).rejects.toThrow(/next fire/);
    expect(listCalls(github)).toBe(2);
  });

  it("a step that throws with no next fire to move to (an interval past the last date) parks the poll after one fetch", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    store.prepare("UPDATE triggers SET spec_json = ? WHERE id = ?").run(spec({ interval_seconds: Number.MAX_SAFE_INTEGER }), triggerId);
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    await expect(firePollTriggers(store, github, AFTER_T1)).rejects.toThrow(/parked: no next fire/);
    expect(await firePollTriggers(store, github, AFTER_T1)).toEqual([]);
    expect(listCalls(github)).toBe(1);
    expect(queued(store)).toEqual([]);
    expect(triggerRow(store, triggerId).next_fire_at).toBeNull();
  });

  it("a connector_missing step whose notification the record refuses parks the poll (no next fire), as a time-based trigger is: reported once, never every tick", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    setConnector(store, "disconnected");
    notifyHooks.beforeRecord = () => {
      throw new InvalidNotificationError("refused by the test");
    };
    const github = new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } });
    await expect(firePollTriggers(store, github, AFTER_T1)).rejects.toThrow(/invalid notification: refused by the test \(parked: no next fire\)/);
    // The step rolled back: no notification, no miss, last_result unchanged; the instant is cleared, not moved.
    expect(triggerRow(store, triggerId)).toMatchObject({ enabled: 1, next_fire_at: null, last_result: null });
    expect(count(store, "SELECT count(*) FROM notifications")).toBe(0);
    expect(events(store, "trigger_missed")).toEqual([]);
    expect(await firePollTriggers(store, github, new Date(plus(AFTER_T1, INTERVAL + 1)))).toEqual([]);
    expect(listCalls(github)).toBe(0);
  });

  /** Moves the trigger to `ownerNext` (the owner's off/on) just before the first statement starting with `prefix` is prepared. */
  function ownerMovesBefore(store: Store, prefix: string, triggerId: number, ownerNext: string): void {
    const prepare = store.prepare.bind(store);
    let moved = false;
    vi.spyOn(store, "prepare").mockImplementation(((sql: string) => {
      if (!moved && sql.startsWith(prefix)) {
        moved = true;
        prepare("UPDATE triggers SET next_fire_at = ? WHERE id = ?").run(ownerNext, triggerId);
      }
      return prepare(sql);
    }) as typeof store.prepare);
  }

  it("the move after a throw is guarded on the instant: a row the owner moved meanwhile keeps the owner's next fire", async () => {
    const store = open();
    connect(store);
    const { playbookId, triggerId } = pollPlaybook(store);
    store.prepare("UPDATE playbooks SET priority = 'bogus' WHERE id = ?").run(playbookId);
    const ownerNext = "2026-10-27T12:00:00.000Z";
    ownerMovesBefore(store, "UPDATE triggers SET next_fire_at = ? WHERE id = ?", triggerId, ownerNext);
    await expect(firePollTriggers(store, new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } }), AFTER_T1)).rejects.toThrow(/next fire/);
    vi.restoreAllMocks();
    expect(triggerRow(store, triggerId).next_fire_at).toBe(ownerNext);
  });

  it("the park after a throw is guarded on the instant: a row the owner moved meanwhile is not parked", async () => {
    const store = open();
    connect(store);
    const { triggerId } = pollPlaybook(store);
    store.prepare("UPDATE triggers SET spec_json = ? WHERE id = ?").run(spec({ interval_seconds: Number.MAX_SAFE_INTEGER }), triggerId);
    const ownerNext = "2026-10-27T12:00:00.000Z";
    ownerMovesBefore(store, "UPDATE triggers SET next_fire_at = NULL WHERE id = ?", triggerId, ownerNext);
    await expect(firePollTriggers(store, new FakeGitHubClient({ pulls: { "o/r": [pull(1)] } }), AFTER_T1)).rejects.toThrow(/parked: no next fire/);
    vi.restoreAllMocks();
    expect(triggerRow(store, triggerId).next_fire_at).toBe(ownerNext);
  });

  it("a failing poll never skips the cron fire either", async () => {
    const store = open();
    connect(store);
    const cron = registerTrigger(store, { agent: "wright", kind: "cron", spec: "* * * * *", tz: "UTC", action: "notify", text: "tick" }, NOW);
    const { triggerId } = pollPlaybook(store);
    store.prepare("UPDATE triggers SET spec_json = 'corrupt' WHERE id = ?").run(triggerId);
    const run = triggersContribution.dueWork?.[0];
    if (run === undefined) throw new Error("no due work");
    await expect(Promise.resolve(run({ store, now: () => AFTER_T1, github: new FakeGitHubClient() }))).rejects.toThrow(/parked: no next fire/);
    expect(triggerRow(store, cron.id).last_result).toBe("fired");
    // The unreadable poll is parked: reported once, not every tick.
    expect(triggerRow(store, triggerId).next_fire_at).toBeNull();
  });
});
