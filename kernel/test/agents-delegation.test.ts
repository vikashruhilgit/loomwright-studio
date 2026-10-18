// Delegation (phase 4 item 06): `kernel_agent_message` queues one depth-tagged
// `message` event for another agent, once per idempotency key, or refuses
// (`no_agent`, `self_delegation`, `no_such_agent`, `agent_off`,
// `workspace_not_listed`, `delegation_depth`) with one `agent_message_refused`
// event and nothing queued; a depth refusal notifies once per refused chain.
// Wright's `wright.json` accepts a `limits` holding only `delegation_depth`.
// Store-level: the tool runs through the tool server's contributed-tool
// handler over a temp data dir. Never a model, a live session or a daemon.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_MESSAGE_TOOL_NAME, DELEGATION_DEPTH_SOURCE, DELEGATION_REFUSALS, DelegationRefused, MAX_DELEGATION_TEXT } from "../src/agents/delegate.js";
import { agentSettingsPath, delegatePart, readAgentSettings } from "../src/agents/index.js";
import { readWrightSettings, wrightSettingsPath } from "../src/brain/settings.js";
import { enqueueEvent } from "../src/loop/queue.js";
import { contributedToolHandler } from "../src/tools/server.js";
import type { KernelToolContext } from "../src/tools/server.js";
import { count, events, loopEnv } from "./loop-helpers.js";
import type { LoopEnv } from "./loop-helpers.js";

let env: LoopEnv;

beforeEach(() => {
  env = loopEnv("2026-10-18T10:00:00.000Z");
});

afterEach(() => {
  env.cleanup();
});

const TOOL = delegatePart.tools[0];
if (TOOL === undefined) throw new Error("the delegate part has no tool");

const BASE_SETTINGS = { model: "claude-haiku-4-5", effort: null, permission_mode: "default", tool_policy: { status: "proposed", allowedTools: ["Read"], allowedBashPrefixes: [] } };

/** `id`'s settings file: the proposed shape plus `extra` (Wright's too). */
function writeSettings(id: string, extra: Record<string, unknown> = {}): string {
  const file = agentSettingsPath(env.dataDir, id);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...BASE_SETTINGS, ...extra }, null, 2)}\n`);
  return file;
}

/** A registered crew member row. */
function addAgent(id: string, status: "active" | "off" = "active"): void {
  env.store
    .prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, status, created_by, charter_json) VALUES (?, ?, 'crab', 'crew-teal', ?, 'owner', '{}')")
    .run(id, id, status);
}

/** A session row for `agent`. */
function session(agent: string | null): number {
  return Number(env.store.prepare("INSERT INTO sessions (agent, status) VALUES (?, 'running')").run(agent).lastInsertRowid);
}

/** A `brain_messages` row the session handles, at `depth` (a seed queue row with no `from_agent`). Returns its id. */
function handling(sessionId: number, depth: number, agent = "wright"): number {
  const q = enqueueEvent(env.store, { kind: "message", payload: { text: "seed", agent } }, env.now());
  return Number(
    env.store
      .prepare("INSERT INTO brain_messages (queue_id, agent, source, text, status, session_id, depth) VALUES (?, ?, 'ask', 'seed', 'running', ?, ?)")
      .run(q.id, agent, sessionId, depth).lastInsertRowid,
  );
}

function ctx(sessionId: number): KernelToolContext {
  const sessions = {
    getSession: (id: number) => env.store.prepare("SELECT * FROM sessions WHERE id = ?").get(id),
    stopSession: async () => "stopped",
  } as unknown as KernelToolContext["sessions"];
  return { store: env.store, sessions, sessionId, now: env.now };
}

async function call(sessionId: number, args: unknown): Promise<{ isError: boolean; value: unknown }> {
  const result = await contributedToolHandler(TOOL as NonNullable<typeof TOOL>, ctx(sessionId))(args);
  const text = result.content[0]?.text ?? "null";
  // An error result is its message, not JSON.
  return { isError: result.isError === true, value: result.isError === true ? text : (JSON.parse(text) as unknown) };
}

/** Every delegated `message` queue row (a seed row has no `from_agent`), payload parsed. */
function delegated(): { id: number; session_id: number | null; payload: Record<string, unknown> }[] {
  return env.store
    .prepare<[], { id: number; session_id: number | null; payload_json: string }>(
      "SELECT id, session_id, payload_json FROM event_queue WHERE kind = 'message' AND json_extract(payload_json, '$.from_agent') IS NOT NULL ORDER BY id",
    )
    .all()
    .map((r) => ({ id: r.id, session_id: r.session_id, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));
}

const depthNotifications = (): number => count(env.store, "SELECT count(*) FROM notifications WHERE source = ?", DELEGATION_DEPTH_SOURCE);

const NOTE = "Queued for mason. Its reply arrives later as a new message; do not wait for it: end your turn.";

// ---- the tool -------------------------------------------------------------------------

describe("the delegate part", () => {
  it("has the one tool kernel_agent_message; the refusal reasons are one frozen list; a refusal's message starts with its reason", () => {
    expect(delegatePart.tools.map((t) => t.name)).toEqual([AGENT_MESSAGE_TOOL_NAME]);
    expect(AGENT_MESSAGE_TOOL_NAME).toBe("kernel_agent_message");
    expect(DELEGATION_REFUSALS).toEqual(["no_agent", "self_delegation", "no_such_agent", "agent_off", "workspace_not_listed", "delegation_depth"]);
    expect(Object.isFrozen(DELEGATION_REFUSALS)).toBe(true);
    const err = new DelegationRefused("agent_off", "mason is off");
    expect(err).toMatchObject({ name: "DelegationRefused", reason: "agent_off", message: "agent_off: mason is off; nothing was queued" });
    expect(TOOL?.description).toContain("end your turn");
    // The model-facing text names every reason, from the one list (no restated copy to drift).
    expect(TOOL?.description).toContain(`Refused (nothing queued) with one of: ${DELEGATION_REFUSALS.join(", ")} `);
  });
});

// ---- AC1: queued once per key ----------------------------------------------------------

describe("kernel_agent_message: a delegation is queued once per key (AC1)", () => {
  it("Wright handling the owner's message (depth 0): one message event at depth 1 and one agent_message_queued; a repeat with k1 queues nothing", async () => {
    addAgent("mason");
    const s = session("wright");
    handling(s, 0);
    const first = await call(s, { agent: "mason", text: "review x", idempotency_key: "k1" });
    const [row] = delegated();
    expect(first).toEqual({ isError: false, value: { queue_id: row?.id, agent: "mason", depth: 1, note: NOTE } });
    expect(delegated()).toEqual([{ id: row?.id, session_id: s, payload: { agent: "mason", text: "review x", from_agent: "wright", depth: 1 } }]);
    expect(events(env.store, "agent_message_queued")).toEqual([
      expect.objectContaining({ actor: "kernel", session_id: s, payload: { from: "wright", to: "mason", depth: 1, queue_id: row?.id } }),
    ]);
    expect(count(env.store, `SELECT count(*) FROM work_steps WHERE key = 'kernel_agent_message:session-${s}:k1' AND status = 'done'`)).toBe(1);
    // The same key: the first result, even with other arguments; nothing more queued or recorded.
    expect(await call(s, { agent: "mason", text: "something else", idempotency_key: "k1" })).toEqual(first);
    expect(delegated()).toHaveLength(1);
    expect(events(env.store, "agent_message_queued")).toHaveLength(1);
    // A new key is a new delegation.
    expect((await call(s, { agent: "mason", text: "and y", idempotency_key: "k2" })).value).toMatchObject({ agent: "mason", depth: 1 });
    expect(delegated()).toHaveLength(2);
  });

  it("a repeat of a queued delegation returns its first result even after the target is turned off (never re-checked, never re-refused)", async () => {
    addAgent("mason");
    const s = session("wright");
    const first = await call(s, { agent: "mason", text: "review x", idempotency_key: "k1" });
    env.store.prepare("UPDATE agents SET status = 'off' WHERE id = 'mason'").run();
    expect(await call(s, { agent: "mason", text: "review x", idempotency_key: "k1" })).toEqual(first);
    expect(events(env.store, "agent_message_refused")).toEqual([]);
    expect(delegated()).toHaveLength(1);
  });

  it("a session with no message row (a playbook fire, a dry run) counts 0: the delegation is depth 1; a crew member may delegate to wright", async () => {
    addAgent("mason");
    expect((await call(session("wright"), { agent: "mason", text: "t", idempotency_key: "k" })).value).toMatchObject({ depth: 1 });
    const m = session("mason");
    handling(m, 1, "mason");
    expect(await call(m, { agent: "wright", text: "done: x", idempotency_key: "k" })).toMatchObject({ isError: false, value: { agent: "wright", depth: 2 } });
    expect(delegated().map((d) => d.payload)).toEqual([
      { agent: "mason", text: "t", from_agent: "wright", depth: 1 },
      { agent: "wright", text: "done: x", from_agent: "mason", depth: 2 },
    ]);
  });

  it("the depth is that of the newest message row the session handles", async () => {
    addAgent("mason");
    const s = session("wright");
    handling(s, 3);
    handling(s, 1);
    expect((await call(s, { agent: "mason", text: "t", idempotency_key: "k" })).value).toMatchObject({ depth: 2 });
  });
});

// ---- AC2: the chain depth ----------------------------------------------------------------

describe("kernel_agent_message: the caller's delegation_depth (AC2)", () => {
  it("Wright's delegation_depth 1, handling a depth 1 reply: refused delegation_depth, nothing queued, exactly one notify; a second refusal in that chain sends none", async () => {
    addAgent("mason");
    writeSettings("wright", { limits: { delegation_depth: 1 } });
    const s = session("wright");
    const row = handling(s, 1);
    const refused = await call(s, { agent: "mason", text: "again", idempotency_key: "k1" });
    expect(refused).toEqual({ isError: true, value: "delegation_depth: wright may delegate to depth 1; this delegation would be depth 2; nothing was queued" });
    expect(delegated()).toEqual([]);
    expect(events(env.store, "agent_message_queued")).toEqual([]);
    expect(events(env.store, "agent_message_refused")).toEqual([
      expect.objectContaining({ actor: "kernel", session_id: s, payload: { from: "wright", to: "mason", depth: 2, reason: "delegation_depth" } }),
    ]);
    expect(depthNotifications()).toBe(1);
    const note = env.store.prepare<[string], { title: string; body: string }>("SELECT title, body FROM notifications WHERE source = ?").get(DELEGATION_DEPTH_SOURCE);
    expect(note?.body).toContain("wright");
    expect(note?.body).toContain("mason");
    expect(note?.body).toContain("limits.delegation_depth of 1");
    expect(count(env.store, `SELECT count(*) FROM work_steps WHERE key = 'kernel_agent_message:depth-notify:message-${row}' AND status = 'done'`)).toBe(1);
    // A refusal is not a step: no work step for the call's key.
    expect(count(env.store, `SELECT count(*) FROM work_steps WHERE key LIKE 'kernel_agent_message:session-${s}:%'`)).toBe(0);
    // Refused again in the same chain (another key, even the same one): one more event each, no second notify.
    for (const key of ["k2", "k1"]) expect((await call(s, { agent: "mason", text: "again", idempotency_key: key })).isError).toBe(true);
    expect(events(env.store, "agent_message_refused")).toHaveLength(3);
    expect(depthNotifications()).toBe(1);
    expect(delegated()).toEqual([]);
  });

  it("another refused chain (another message row) notifies again, once", async () => {
    addAgent("mason");
    writeSettings("wright", { limits: { delegation_depth: 1 } });
    for (const s of [session("wright"), session("wright")]) {
      handling(s, 1);
      for (const key of ["a", "b"]) expect((await call(s, { agent: "mason", text: "x", idempotency_key: key })).isError).toBe(true);
    }
    expect(depthNotifications()).toBe(2);
  });

  it("Wright's delegation_depth 1, handling the owner's message (depth 0): queued at depth 1 (the boundary is allowed)", async () => {
    addAgent("mason");
    writeSettings("wright", { limits: { delegation_depth: 1 } });
    const s = session("wright");
    handling(s, 0);
    expect(await call(s, { agent: "mason", text: "x", idempotency_key: "k" })).toMatchObject({ isError: false, value: { depth: 1 } });
    expect(depthNotifications()).toBe(0);
  });

  it("no delegation_depth: handling a depth 1 reply, the delegation is queued at depth 2", async () => {
    addAgent("mason");
    writeSettings("wright");
    const s = session("wright");
    handling(s, 1);
    expect(await call(s, { agent: "mason", text: "again", idempotency_key: "k" })).toMatchObject({ isError: false, value: { agent: "mason", depth: 2 } });
    expect(delegated().map((d) => d.payload)).toEqual([{ agent: "mason", text: "again", from_agent: "wright", depth: 2 }]);
  });

  it("caller settings that do not read ok (a fresh wright.json with no model, a refused limits key) are no limit, never a guess", async () => {
    addAgent("mason");
    const s = session("wright");
    handling(s, 5);
    expect((await call(s, { agent: "mason", text: "x", idempotency_key: "k1" })).value).toMatchObject({ depth: 6 });
    writeSettings("wright", { limits: { delegation_depth: 1, tokens_per_day: 5 } });
    expect(readAgentSettings(env.dataDir, "wright")).toMatchObject({ ok: false, error: "settings_invalid", field: "limits" });
    expect((await call(s, { agent: "mason", text: "x", idempotency_key: "k2" })).value).toMatchObject({ depth: 6 });
  });

  it("the limit is the CALLER's own: a crew member's delegation_depth bounds its delegations, the target's never does", async () => {
    addAgent("mason");
    writeSettings("mason", { limits: { delegation_depth: 1 } });
    writeSettings("wright");
    const w = session("wright");
    handling(w, 4);
    // Wright (no limit) delegates to mason (limit 1) at depth 5: queued.
    expect((await call(w, { agent: "mason", text: "x", idempotency_key: "k" })).value).toMatchObject({ depth: 5 });
    // mason, handling depth 1, delegates back to wright at depth 2: refused by mason's own limit.
    const m = session("mason");
    handling(m, 1, "mason");
    expect((await call(m, { agent: "wright", text: "x", idempotency_key: "k" })).value).toMatch(/^delegation_depth: mason may delegate to depth 1; /);
  });
});

// ---- AC3: who may be the target --------------------------------------------------------

describe("kernel_agent_message: the target (AC3)", () => {
  async function refusedWith(s: number, agent: string, reason: string, from: string | null): Promise<void> {
    const r = await call(s, { agent, text: "x", idempotency_key: `k-${agent}` });
    expect(r.isError, agent).toBe(true);
    expect(String(r.value).startsWith(`${reason}: `), String(r.value)).toBe(true);
    expect(String(r.value).endsWith("; nothing was queued")).toBe(true);
    expect(events(env.store, "agent_message_refused").at(-1)?.payload).toEqual({ from, to: agent, depth: 1, reason });
  }

  it("an off member is agent_off, an unknown or reserved id no_such_agent, the caller itself self_delegation; nothing is queued", async () => {
    addAgent("mason", "off");
    const s = session("wright");
    await refusedWith(s, "mason", "agent_off", "wright");
    for (const unknown of ["nobody", "shared", "Mason", "../wright"]) await refusedWith(s, unknown, "no_such_agent", "wright");
    await refusedWith(s, "wright", "self_delegation", "wright");
    addAgent("ada");
    await refusedWith(session("ada"), "ada", "self_delegation", "ada");
    expect(events(env.store, "agent_message_refused")).toHaveLength(7);
    expect(delegated()).toEqual([]);
    expect(events(env.store, "agent_message_queued")).toEqual([]);
    expect(count(env.store, "SELECT count(*) FROM work_steps")).toBe(0);
  });

  it("a session with no agent is no_agent", async () => {
    addAgent("mason");
    for (const agent of [null, ""]) await refusedWith(session(agent), "mason", "no_agent", null);
    expect(delegated()).toEqual([]);
  });
});

// ---- AC4: the workspace ----------------------------------------------------------------

describe("kernel_agent_message: the workspace (AC4)", () => {
  it("a workspace not in mason's workspaces is workspace_not_listed; nothing is queued", async () => {
    addAgent("mason");
    writeSettings("mason", { workspaces: ["/repos/other"] });
    const s = session("wright");
    const r = await call(s, { agent: "mason", text: "x", workspace: "/repos/x", idempotency_key: "k" });
    expect(r).toEqual({ isError: true, value: `workspace_not_listed: "/repos/x" is not one of mason's settings workspaces; nothing was queued` });
    expect(events(env.store, "agent_message_refused").map((e) => e.payload)).toEqual([{ from: "wright", to: "mason", depth: 1, reason: "workspace_not_listed" }]);
    expect(delegated()).toEqual([]);
  });

  it("a workspace in mason's workspaces is queued in the payload (checked against the TARGET's settings, never the caller's)", async () => {
    addAgent("mason");
    writeSettings("mason", { workspaces: ["/repos/x"] });
    writeSettings("wright");
    const s = session("wright");
    expect((await call(s, { agent: "mason", text: "x", workspace: "/repos/x", idempotency_key: "k" })).isError).toBe(false);
    expect(delegated().map((d) => d.payload)).toEqual([{ agent: "mason", text: "x", from_agent: "wright", depth: 1, workspace: "/repos/x" }]);
  });

  it("not an exact member (a trailing slash, a sub-folder), none listed, or no readable settings: workspace_not_listed", async () => {
    addAgent("mason");
    const s = session("wright");
    const attempt = async (workspace: string, key: string) => (await call(s, { agent: "mason", text: "x", workspace, idempotency_key: key })).value;
    // No settings file for mason.
    expect(await attempt("/repos/x", "a")).toMatch(/^workspace_not_listed: /);
    writeSettings("mason");
    expect(await attempt("/repos/x", "b")).toMatch(/^workspace_not_listed: /);
    writeSettings("mason", { workspaces: ["/repos/x"] });
    for (const [workspace, key] of [["/repos/x/", "c"], ["/repos/x/sub", "d"], ["", "e"]] as const) expect(await attempt(workspace, key), workspace).toMatch(/^workspace_not_listed: /);
    expect(delegated()).toEqual([]);
  });
});

// ---- AC5: argument validation ----------------------------------------------------------

describe("kernel_agent_message: argument validation (AC5)", () => {
  it("a NUL in the text fails argument validation: an isError result naming the field, nothing queued, no event, no work step", async () => {
    addAgent("mason");
    const s = session("wright");
    expect(await call(s, { agent: "mason", text: "a\u0000b", idempotency_key: "k" })).toEqual({
      isError: true,
      value: "kernel_agent_message: invalid input: ✖ must not contain a NUL character\n  → at text",
    });
    for (const bad of [
      { agent: "mason", text: "", idempotency_key: "k" },
      { agent: "mason", text: "x".repeat(MAX_DELEGATION_TEXT + 1), idempotency_key: "k" },
      { agent: "", text: "x", idempotency_key: "k" },
      { agent: "mason", text: "x" },
    ]) {
      expect((await call(s, bad)).value).toMatch(/^kernel_agent_message: invalid input: /);
    }
    expect((await call(s, { agent: "mason", text: "x".repeat(MAX_DELEGATION_TEXT), idempotency_key: "k" })).isError).toBe(false);
    expect(delegated()).toHaveLength(1);
    expect(events(env.store, "agent_message_refused")).toEqual([]);
  });
});

// ---- AC6: Wright's delegation_depth ----------------------------------------------------

describe("Wright's limits.delegation_depth (AC6)", () => {
  it("a wright.json with limits {delegation_depth: 1} reads ok with that limit; readWrightSettings keeps its five settings", () => {
    const file = writeSettings("wright", { limits: { delegation_depth: 1 } });
    expect(file).toBe(wrightSettingsPath(env.dataDir));
    const r = readAgentSettings(env.dataDir, "wright");
    expect(r).toMatchObject({ ok: true, file });
    expect(r.ok && r.settings.limits).toEqual({ delegation_depth: 1 });
    expect(readWrightSettings(env.dataDir)).toStrictEqual({
      ok: true,
      file,
      settings: { model: "claude-haiku-4-5", effort: null, permissionMode: "default", policy: { allowedTools: ["Read"], allowedBashPrefixes: [] }, policyStatus: "proposed" },
    });
  });

  it("any other limit, alone or beside delegation_depth, or an empty limits, is still settings_invalid with the existing message", () => {
    for (const limits of [{ tokens_per_day: 5 }, { sessions_at_once: 1 }, { delegation_depth: 1, tokens_per_day: 5 }, { delegation_depth: 1, sessions_at_once: 2 }, {}]) {
      const file = writeSettings("wright", { limits });
      expect(readAgentSettings(env.dataDir, "wright"), JSON.stringify(limits)).toEqual({
        ok: false,
        error: "settings_invalid",
        file,
        field: "limits",
        message: `${file}: limits: not supported for Wright yet (the kernel does not apply it to Wright's sessions); remove it`,
      });
    }
    // A delegation_depth that is not a positive integer is refused by the shape, as for a crew member.
    writeSettings("wright", { limits: { delegation_depth: 0 } });
    expect(readAgentSettings(env.dataDir, "wright")).toMatchObject({ ok: false, error: "settings_invalid", field: "limits.delegation_depth" });
  });
});
