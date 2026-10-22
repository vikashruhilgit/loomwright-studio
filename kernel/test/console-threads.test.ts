// The console's threads part (phase 5 item 06): `GET /threads/:agent`, one
// agent's brain messages interleaved with one-line event cards in `(at, type,
// id)` order, paged backwards with an opaque cursor, plus the agent's pending
// approvals. A temp data dir and a real `Store`; rows are seeded with the real
// writers where they are cheap (`ensureBrainMessage`, `requestApproval`,
// `appendEvent`) and direct INSERTs for sessions, playbooks, triggers and
// agents. The route is reached through `compileRoutePath` / `matchRoutePath`,
// as the API server reaches it, and pinned against the app contract
// (`app/src/api/contract.ts`, read as text, never imported).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalView, getApproval, requestApproval } from "../src/approvals/store.js";
import { ensureBrainMessage } from "../src/brain/messages.js";
import { MAX_THREAD_LIMIT, THREAD_EVENT_KINDS, decodeThreadCursor, encodeThreadCursor, threadsPart } from "../src/console/threads.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, compileRoutePath, matchRoutePath, mergeContributions } from "../src/features/index.js";
import type { ContributedRouteResponse } from "../src/features/index.js";
import { appendEvent } from "../src/loop/internal.js";
import { Store } from "../src/store/index.js";

const CONTRACT = new URL("../../app/src/api/contract.ts", import.meta.url);
const contractText = readFileSync(CONTRACT, "utf8");

const T0 = Date.UTC(2026, 9, 21, 8, 0, 0);
/** The instant `seconds` after T0, as the kernel writes one. */
const at = (seconds: number): Date => new Date(T0 + seconds * 1000);
const iso = (seconds: number): string => at(seconds).toISOString();

let tmp: string;
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-console-threads-"));
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openStore(): Store {
  const store = new Store({ dataDir: join(tmp, "data") });
  stores.push(store);
  return store;
}

// ---- Seeding ------------------------------------------------------------------------

function addAgent(store: Store, id: string): void {
  store
    .prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, created_by, charter_json) VALUES (?, ?, 'crab', 'crew-teal', 'owner', '{}')")
    .run(id, id);
}

function addSession(store: Store, agent: string): number {
  return Number(store.prepare("INSERT INTO sessions (agent, status) VALUES (?, 'running')").run(agent).lastInsertRowid);
}

function addPlaybook(store: Store, slug: string, owner: string): number {
  return Number(store.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent) VALUES (?, 'P', ?, 'do it')").run(slug, owner).lastInsertRowid);
}

function addTrigger(store: Store, owner: string): number {
  return Number(
    store
      .prepare("INSERT INTO triggers (owning_agent, kind, spec_json, action, action_payload, created_by) VALUES (?, 'once', '{}', 'notify', 'hello', 'agent')")
      .run(owner).lastInsertRowid,
  );
}

/** One `brain_messages` row for `agent` (sent by `from`, when given), written at `seconds`. */
function addMessage(store: Store, agent: string, seconds: number, from: string | null = null): number {
  const queueId = Number(store.prepare("INSERT INTO event_queue (kind, payload_json) VALUES ('message', '{}')").run().lastInsertRowid);
  return ensureBrainMessage(
    store,
    { queueId, agent, source: from === null ? "ask" : `agent:${from}`, text: `message ${queueId}`, fromAgent: from, depth: from === null ? 0 : 1 },
    at(seconds),
  ).id;
}

/** One `events` row, written at `seconds`; returns its id. */
function addEvent(store: Store, kind: string, seconds: number, payload: Record<string, unknown>, sessionId: number | null = null): number {
  appendEvent(store, kind, { sessionId, taskId: null }, payload, iso(seconds));
  return store.prepare<[], number>("SELECT max(id) FROM events").pluck().get() as number;
}

function addApproval(store: Store, agent: string, sessionId: number, seconds: number, action = "open_pr"): number {
  return requestApproval(store, { agent, sessionId, action, payload: { repo: "studio" }, source: "tool" }, at(seconds)).id;
}

// ---- The route ----------------------------------------------------------------------

interface Item {
  readonly type: "message" | "event";
  readonly id: number;
  readonly kind?: string;
  readonly summary?: string;
  readonly ref?: unknown;
  readonly from_agent?: string | null;
  readonly agent?: string;
  readonly at?: string;
  readonly created_at?: string;
}

interface Page {
  readonly items: Item[];
  readonly next_before: string | null;
  readonly pending_approvals: { readonly id: number }[];
}

async function get(store: Store, pathWithQuery: string): Promise<ContributedRouteResponse> {
  const url = new URL(pathWithQuery, "http://127.0.0.1");
  const parts = url.pathname.slice(1).split("/");
  for (const route of threadsPart.routes) {
    if (route.method !== "GET") continue;
    const params = matchRoutePath(compileRoutePath(route.path), parts);
    if (params === undefined) continue;
    return route.handler({ params, query: Object.fromEntries(url.searchParams), body: undefined, store, now: () => at(0) });
  }
  return { status: 404, body: { error: "no_route" } };
}

async function page(store: Store, pathWithQuery: string): Promise<Page> {
  const res = await get(store, pathWithQuery);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Page;
}

const tag = (item: Item): string => `${item.type}:${item.id}`;
const eventsOf = (p: Page): Item[] => p.items.filter((i) => i.type === "event");

// ---- Tests --------------------------------------------------------------------------

/** The field names of `export interface <name> { … }` in the contract text. */
function contractInterfaceFields(name: string): string[] {
  const match = new RegExp(`export interface ${name} \\{([^}]*)\\}`).exec(contractText);
  if (match === null) throw new Error(`contract.ts has no \`export interface ${name}\``);
  return [...(match[1] ?? "").matchAll(/^\s*readonly (\w+)\??:/gm)].map((m) => m[1] ?? "");
}

describe("the threads part against the app contract", () => {
  it("serves the item-06 contract route, same method and path, owner console", () => {
    const entries = [...contractText.matchAll(/^\s*\{ method: "([A-Z]+)", path: "([^"]+)", origin: "item-06" \},$/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(entries).toEqual(["GET /threads/:agent"]);
    const served = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).routes.map((r) => `${r.owner} ${r.method} ${r.path}`);
    expect(served).toContain("console GET /threads/:agent");
    expect(threadsPart.routes.map((r) => `${r.method} ${r.path}`)).toEqual(entries);
  });

  it("answers exactly the contract's ThreadResponse fields, and items in ThreadItem's shapes", async () => {
    expect(contractInterfaceFields("ThreadResponse")).toEqual(["items", "next_before", "pending_approvals"]);
    const store = openStore();
    const session = addSession(store, "wright");
    addMessage(store, "wright", 1);
    addEvent(store, "session_status", 2, { from: "starting", to: "running" }, session);
    const body = await page(store, "/threads/wright");
    expect(Object.keys(body)).toEqual(["items", "next_before", "pending_approvals"]);
    const [message, event] = body.items as [Item, Item];
    expect(Object.keys(message)).toEqual(["type", ...contractInterfaceFields("BrainMessage")]);
    expect(Object.keys(event)).toEqual(["type", "id", "at", "kind", "summary", "ref"]);
  });
});

describe("GET /threads/:agent", () => {
  it("AC1: interleaves Wright's messages with a session start, a playbook created and an approval requested, in time order; the pending approval is listed", async () => {
    const store = openStore();
    const session = addSession(store, "wright");
    const m1 = addMessage(store, "wright", 1);
    const started = addEvent(store, "session_status", 2, { from: "starting", to: "running" }, session);
    const m2 = addMessage(store, "wright", 3);
    const playbook = addPlaybook(store, "daily-digest", "wright");
    const created = addEvent(store, "playbook_created", 4, { playbook_id: playbook, slug: "daily-digest", owning_agent: "wright", version: 1, by: "wright" }, session);
    const approval = addApproval(store, "wright", session, 5);
    const requested = store.prepare<[], number>("SELECT id FROM events WHERE kind = 'approval_requested'").pluck().get() as number;
    const m3 = addMessage(store, "wright", 6);

    const body = await page(store, "/threads/wright");
    expect(body.items.map(tag)).toEqual([`message:${m1}`, `event:${started}`, `message:${m2}`, `event:${created}`, `event:${requested}`, `message:${m3}`]);
    expect(eventsOf(body).map((e) => [e.kind, e.summary, e.ref])).toEqual([
      ["session_status", `Session ${session} started`, { session_id: session }],
      ["playbook_created", "Playbook daily-digest created (version 1)", { playbook_id: playbook }],
      ["approval_requested", `Approval ${approval} requested: open_pr`, { approval_id: approval }],
    ]);
    for (const e of eventsOf(body)) expect(e.summary).not.toMatch(/[\n\r]/);
    expect(body.next_before).toBeNull();
    expect(body.pending_approvals).toEqual([approvalView(store, getApproval(store, approval) as NonNullable<ReturnType<typeof getApproval>>)]);
  });

  it("AC2: 120 items paged 50 at a time from no cursor are three pages (50, 50, 20) with no duplicates and no gaps, equal timestamps included", async () => {
    const store = openStore();
    const session = addSession(store, "wright");
    // Two messages and two events per second (message and event ids collide): the order falls back to type, then id.
    const seeded: { readonly second: number; readonly type: string; readonly id: number }[] = [];
    for (let k = 0; k < 60; k++) {
      const second = Math.floor(k / 2);
      seeded.push({ second, type: "message", id: addMessage(store, "wright", second) });
      seeded.push({ second, type: "event", id: addEvent(store, "session_status", second, { from: "starting", to: "running" }, session) });
    }
    expect(seeded.filter((s) => s.type === "message").map((s) => s.id)).toEqual(seeded.filter((s) => s.type === "event").map((s) => s.id));
    const expected = [...seeded]
      .sort((a, b) => a.second - b.second || (a.type === b.type ? a.id - b.id : a.type < b.type ? -1 : 1))
      .map((s) => `${s.type}:${s.id}`);

    const pages: Page[] = [];
    let before: string | null = null;
    do {
      const p: Page = await page(store, `/threads/wright?limit=50${before === null ? "" : `&before=${before}`}`);
      pages.push(p);
      before = p.next_before;
    } while (before !== null && pages.length < 5);

    // No duplicates, then no gaps in the merged order, then the page sizes.
    const all = [...pages].reverse().flatMap((p) => p.items.map(tag));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expected);
    expect(pages.map((p) => p.items.length)).toEqual([50, 50, 20]);
    expect(pages[2]?.next_before).toBeNull();
  });

  it("AC3: a delegation from Wright to mason is in both threads, marked from_agent wright", async () => {
    const store = openStore();
    addAgent(store, "mason");
    const own = addMessage(store, "wright", 1);
    const delegated = addMessage(store, "mason", 2, "wright");
    const wright = await page(store, "/threads/wright");
    const mason = await page(store, "/threads/mason");
    expect(wright.items.map(tag)).toEqual([`message:${own}`, `message:${delegated}`]);
    expect(mason.items.map(tag)).toEqual([`message:${delegated}`]);
    for (const p of [wright, mason]) {
      const row = p.items.find((i) => i.id === delegated && i.type === "message");
      expect(row).toMatchObject({ agent: "mason", from_agent: "wright" });
    }
  });

  it("AC4: an agent that is neither wright nor registered is 404 no_such_agent; an off member still has a thread", async () => {
    const store = openStore();
    addAgent(store, "mason");
    store.prepare("UPDATE agents SET status = 'off' WHERE id = 'mason'").run();
    for (const agent of ["nobody", "Not%20An%20Id", "x".repeat(40)]) {
      expect(await get(store, `/threads/${agent}`)).toEqual({ status: 404, body: { error: "no_such_agent" } });
    }
    expect((await get(store, "/threads/mason")).status).toBe(200);
    expect((await get(store, "/threads/wright")).status).toBe(200);
  });

  it("AC4: a playbook slug with control and bidi characters is escaped in its card's summary, never raw", async () => {
    const store = openStore();
    const slug = "evil\u001b[31m\u202ered\nline";
    const playbook = addPlaybook(store, slug, "wright");
    addEvent(store, "playbook_created", 1, { playbook_id: playbook, slug, owning_agent: "wright", version: 1, by: "wright" });
    const [card] = eventsOf(await page(store, "/threads/wright"));
    expect(card?.summary).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/);
    expect(card?.summary).toBe("Playbook evil\\x1b[31m\\u202ered\\nline created (version 1)");
  });

  it("AC5: kinds outside the closed list, session statuses that neither start nor end, and other agents' events are not in the thread", async () => {
    const store = openStore();
    addAgent(store, "mason");
    const wrightSession = addSession(store, "wright");
    const masonSession = addSession(store, "mason");
    // Outside the closed list, though about Wright's session.
    addEvent(store, "session_output_appended", 1, { seq: 1 }, wrightSession);
    // A status that is neither a start nor an end.
    addEvent(store, "session_status", 2, { from: null, to: "starting" }, wrightSession);
    // Mason's: each closed-list tie, pointing at mason.
    addEvent(store, "session_status", 3, { from: "starting", to: "running" }, masonSession);
    const masonPlaybook = addPlaybook(store, "mason-pb", "mason");
    addEvent(store, "playbook_created", 4, { playbook_id: masonPlaybook, slug: "mason-pb", owning_agent: "mason", version: 1, by: "wright" }, wrightSession);
    addApproval(store, "mason", masonSession, 5);
    addEvent(store, "agent_renamed", 6, { id: "mason", old: "Mason", new: "Stone" });
    const masonTrigger = addTrigger(store, "mason");
    addEvent(store, "trigger_fired", 7, { trigger_id: masonTrigger, action: "notify" });

    const wright = await page(store, "/threads/wright");
    expect(wright.items).toEqual([]);
    expect(wright.pending_approvals).toEqual([]);
    const mason = await page(store, "/threads/mason");
    expect(mason.items.map((i) => i.kind)).toEqual(["session_status", "playbook_created", "approval_requested", "agent_renamed", "trigger_fired"]);
    expect(mason.pending_approvals).toHaveLength(1);
  });

  it("AC5: limit outside 1-200 is 400 invalid_limit; 1 and 200 are served", async () => {
    const store = openStore();
    for (const limit of ["0", "201", "-1", "abc", "1.5", "", "99999999999999999"]) {
      expect(await get(store, `/threads/wright?limit=${limit}`), limit).toEqual({ status: 400, body: { error: "invalid_limit" } });
    }
    expect(MAX_THREAD_LIMIT).toBe(200);
    for (const limit of ["1", "200"]) expect((await get(store, `/threads/wright?limit=${limit}`)).status).toBe(200);
  });

  it("AC5: an undecodable before is 400 invalid_before", async () => {
    const store = openStore();
    const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64url");
    const bad = [
      "",
      "!!!",
      "abc",
      "a".repeat(2000),
      b64("not json"),
      b64("[]"),
      b64('["2026-10-21T08:00:00.000Z","event"]'),
      b64('["2026-10-21T08:00:00.000Z","note",1]'),
      b64('["2026-10-21T08:00:00.000Z","event",0]'),
      b64('["2026-10-21T08:00:00.000Z","event",1.5]'),
      b64('["","event",1]'),
      b64('{"at":"2026-10-21T08:00:00.000Z","type":"event","id":1}'),
      `${b64('["2026-10-21T08:00:00.000Z","event",1]')}=`,
    ];
    for (const before of bad) {
      expect(await get(store, `/threads/wright?before=${encodeURIComponent(before)}`), before).toEqual({ status: 400, body: { error: "invalid_before" } });
    }
    const good = encodeThreadCursor({ at: iso(1), type: "event", id: 1 });
    expect(decodeThreadCursor(good)).toEqual({ at: iso(1), type: "event", id: 1 });
    expect((await get(store, `/threads/wright?before=${good}`)).status).toBe(200);
  });

  it("writes one-line cards for every closed-list kind, its ref naming the row; a mistyped payload gets a generic sentence, never a throw", async () => {
    const store = openStore();
    addAgent(store, "mason");
    const session = addSession(store, "mason");
    const playbook = addPlaybook(store, "triage", "mason");
    const trigger = addTrigger(store, "mason");
    addEvent(store, "session_status", 1, { from: "running", to: "failed", reason: "result_error" }, session);
    addEvent(store, "playbook_created", 2, { playbook_id: playbook, slug: "triage", owning_agent: "mason", version: 1, by: "wright" });
    addEvent(store, "playbook_updated", 2, { playbook_id: playbook, version: 2, by: "owner", fields: ["intent"] });
    addEvent(store, "playbook_enabled", 3, { playbook_id: playbook, version: 2, approval_id: null, by: "owner" });
    addEvent(store, "playbook_disabled", 4, { playbook_id: playbook, by: "owner" });
    const approval = addApproval(store, "mason", session, 5, "push\u001b");
    store.prepare("UPDATE approvals SET status = 'denied', decision = 'deny', decided_by = 'owner', decided_at = ? WHERE id = ?").run(iso(6), approval);
    addEvent(store, "approval_decided", 6, { id: approval, decision: "deny", by: "owner", action: "push\u001b" }, session);
    addEvent(store, "agent_created", 7, { id: "mason", by: "owner", approval_id: null });
    addEvent(store, "agent_renamed", 8, { id: "mason", old: "Mason", new: "Stone\u202e" });
    addEvent(store, "agent_settings_set", 9, { id: "mason", field: "model", old: null, new: "x" });
    addEvent(store, "agent_status_changed", 10, { id: "mason", old: "active", new: "off", by: "owner" });
    addEvent(store, "trigger_fired", 11, { trigger_id: trigger, action: "notify" });
    // Mistyped: a payload that is not JSON, and one whose fields have the wrong types.
    store.prepare("INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES (?, 'session_status', 'kernel', ?, 'not json')").run(iso(12), session);
    addEvent(store, "session_status", 13, { from: "running", to: "stopped", reason: 7 }, session);
    addEvent(store, "agent_renamed", 14, { id: "mason", new: ["Stone"] });
    addEvent(store, "trigger_fired", 15, { trigger_id: trigger, action: 5 });

    const body = await page(store, "/threads/mason");
    expect(eventsOf(body).map((e) => [e.kind, e.summary, e.ref])).toEqual([
      ["session_status", `Session ${session} ended: failed (result_error)`, { session_id: session }],
      ["playbook_created", "Playbook triage created (version 1)", { playbook_id: playbook }],
      ["playbook_updated", "Playbook triage updated (version 2)", { playbook_id: playbook }],
      ["playbook_enabled", "Playbook triage enabled (version 2)", { playbook_id: playbook }],
      ["playbook_disabled", "Playbook triage disabled", { playbook_id: playbook }],
      ["approval_requested", `Approval ${approval} requested: push\\x1b`, { approval_id: approval }],
      ["approval_decided", `Approval ${approval} denied: push\\x1b`, { approval_id: approval }],
      ["agent_created", "Agent mason created", { agent_id: "mason" }],
      ["agent_renamed", "Agent mason renamed from Mason to Stone\\u202e", { agent_id: "mason" }],
      ["agent_settings_set", "Agent mason setting model set", { agent_id: "mason" }],
      ["agent_status_changed", "Agent mason status set to off", { agent_id: "mason" }],
      ["trigger_fired", `Trigger ${trigger} fired (notify)`, { trigger_id: trigger }],
      ["session_status", `Session ${session} ended: stopped`, { session_id: session }],
      ["agent_renamed", "Agent mason renamed", { agent_id: "mason" }],
      ["trigger_fired", `Trigger ${trigger} fired`, { trigger_id: trigger }],
    ]);
    // The non-JSON payload has no `to`, so it is neither a start nor an end: not a card.
    expect(eventsOf(body)).toHaveLength(15);
    expect(new Set(eventsOf(body).map((e) => e.kind))).toEqual(new Set(Object.keys(THREAD_EVENT_KINDS)));
    // Decided approvals are not pending.
    expect(body.pending_approvals).toEqual([]);
  });

  it("names each approval decision, escapes an unknown one, and falls back to a generic sentence for an absent decision or agent field", async () => {
    const store = openStore();
    addAgent(store, "mason");
    const session = addSession(store, "mason");
    const approval = addApproval(store, "mason", session, 1);
    addEvent(store, "approval_decided", 2, { id: approval, decision: "once", action: "open_pr" });
    addEvent(store, "approval_decided", 3, { id: approval, decision: "always", action: "open_pr" });
    addEvent(store, "approval_decided", 4, { id: approval, decision: "maybe\u001b" });
    addEvent(store, "approval_decided", 5, { id: approval });
    addEvent(store, "agent_settings_set", 6, { id: "mason", field: 3 });
    addEvent(store, "agent_status_changed", 7, { id: "mason" });
    const body = await page(store, "/threads/mason");
    expect(eventsOf(body).map((e) => e.summary)).toEqual([
      `Approval ${approval} requested: open_pr`,
      `Approval ${approval} approved once: open_pr`,
      `Approval ${approval} approved always: open_pr`,
      `Approval ${approval} decided maybe\\x1b`,
      `Approval ${approval} decided`,
      "Agent mason settings set",
      "Agent mason status changed",
    ]);
  });

  it("is read-only: a page writes nothing", async () => {
    const store = openStore();
    const session = addSession(store, "wright");
    addMessage(store, "wright", 1);
    addApproval(store, "wright", session, 2);
    const changes = (): number => store.prepare<[], number>("SELECT total_changes()").pluck().get() as number;
    const before = changes();
    await page(store, "/threads/wright?limit=1");
    expect(changes()).toBe(before);
  });
});
