// Phase 8 item 18d, kernel half: the approval display is stored whole (up to
// MAX_REQUEST_PAYLOAD_JSON), `studio approvals` cuts its listing at
// MAX_APPROVAL_DISPLAY with a mark naming what it left out, and a held call
// that names a subject (`HeldToolVerdict.subject`; the charter tools name
// `agent:<member id>`) withdraws every older pending approval with the same
// subject (the owner's 2026-11-11 decision 1: denied by the kernel,
// `replaced_by` the new one, no decision message, never an approval).
//
// Store cases call `requestApproval` / `withdrawReplaced` on a real store.
// Gate cases run the session manager (fake spawner/query) with the shipped
// tools' pre-hold check, or a scripted check. Never the real SDK, a model,
// git or the network.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HookCallback, HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_CREATE_TOOL_NAME, AGENT_UPDATE_TOOL_NAME } from "../src/agents/charter-tools.js";
import { agentSettingsPath, createAgent } from "../src/agents/index.js";
import {
  ApprovalError,
  MAX_APPROVAL_DISPLAY,
  MAX_APPROVAL_SUBJECT,
  MAX_REQUEST_PAYLOAD_JSON,
  approvalRoutes,
  approvalsSubcommand,
  decideApproval,
  formatApprovals,
  getApproval,
  listApprovals,
  requestApproval,
  withdrawReplaced,
} from "../src/approvals/index.js";
import { withdrawnNote } from "../src/approvals/replace.js";
import type { ApprovalRequest, ApprovalView } from "../src/approvals/index.js";
import { defaultWrightSettingsJson, wrightSettingsPath } from "../src/brain/index.js";
import type { CliApiClient } from "../src/features/contribution.js";
import { PHASE1_RESERVED, SHIPPED_CONTRIBUTIONS, mergeContributions } from "../src/features/index.js";
import type { ContributedRoute, ContributedTool } from "../src/features/index.js";
import { SessionManager } from "../src/sessions/manager.js";
import type { HeldToolCheck, ToolPolicy } from "../src/sessions/types.js";
import { Store } from "../src/store/index.js";
import { approvalApplierOf, heldToolCheckOf } from "../src/tools/server.js";
import type { KernelToolContext } from "../src/tools/server.js";
import { count, events } from "./loop-helpers.js";
import { fakeSessions, makePluginDir, stubProvider } from "./session-fakes.js";
import type { FakeCall } from "./session-fakes.js";

const K = "mcp__kernel__";
const CREATE = `${K}${AGENT_CREATE_TOOL_NAME}`;
const UPDATE = `${K}${AGENT_UPDATE_TOOL_NAME}`;
const MODEL = "claude-haiku-4-5";
const T0 = "2026-11-11T10:00:00.000Z";
const WRIGHT_POLICY: ToolPolicy = { allowedTools: [CREATE, UPDATE], allowedBashPrefixes: [] };
const SHIPPED_TOOLS: readonly ContributedTool[] = mergeContributions(SHIPPED_CONTRIBUTIONS, PHASE1_RESERVED).tools;
const MARK_WHERE = "studio approvals --json, or the app's Approvals screen, shows all of it";

let tmp: string;
let dataDir: string;
let pluginDir: string;
const clock = { at: new Date(T0) };
const stores: Store[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-approvals-replace-"));
  dataDir = join(tmp, "data");
  pluginDir = makePluginDir(tmp);
  clock.at = new Date(T0);
});

afterEach(() => {
  for (const s of stores.splice(0)) if (s.isOpen) s.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openStore(): Store {
  const store = new Store({ dataDir });
  stores.push(store);
  return store;
}

function session(store: Store, agent = "wright"): number {
  return Number(store.prepare("INSERT INTO sessions (agent, status) VALUES (?, 'running')").run(agent).lastInsertRowid);
}

/** A rail-held charter call for `member` (or any call, with `extra`). */
function hold(store: Store, sessionId: number, extra: Partial<ApprovalRequest> & { subject?: string } = {}): number {
  const request: ApprovalRequest = {
    agent: "wright",
    sessionId,
    action: "kernel_agent_create",
    payload: { tool: CREATE, input: { n: Math.random() } },
    source: "rail",
    display: "Create crew member x",
    ...extra,
  };
  return requestApproval(store, request, clock.at).id;
}

/** The queued decision messages (`message` events with `sourceRef: approval:<id>`). */
function queuedFor(store: Store, id: number): number {
  return count(store, "SELECT count(*) FROM event_queue WHERE source_ref = ?", `approval:${id}`);
}

function viewOf(store: Store, id: number): ApprovalView | undefined {
  return listApprovals(store, { all: true }).find((a) => a.id === id);
}

// ---- AC12: withdraw on replace (store) -------------------------------------------------

describe("AC12: a newer hold with the same subject withdraws the older pending one", () => {
  it("the older pending one is denied/deny by the kernel with one approval_decided event carrying replaced_by, no message is queued, and others are untouched", () => {
    const store = openStore();
    const s = session(store);
    const v1 = hold(store, s, { subject: "agent:mason" });
    const other = hold(store, s, { subject: "agent:nell" });
    const plain = hold(store, s, { action: "git push", payload: { tool: "Bash", command: "git push" } });
    // A second hold for mason withdraws v1; the owner then denies that one, so v2's hold finds no pending mason call.
    const decided = hold(store, s, { subject: "agent:mason" });
    expect(getApproval(store, v1)?.status).toBe("denied");
    decideApproval(store, { id: decided, decision: "deny", by: "owner" }, clock.at);
    const approved = hold(store, s, { subject: "agent:mason" });
    decideApproval(store, { id: approved, decision: "once", by: "owner" }, clock.at);
    const v2 = hold(store, s, { subject: "agent:mason" });
    // An approved one (its grant unused) is untouched too: a withdraw only ever denies a pending row.
    expect(getApproval(store, approved)).toMatchObject({ status: "approved", decision: "once", decided_by: "owner" });
    expect(viewOf(store, approved)).not.toHaveProperty("replaced_by");

    // v1 was withdrawn by `decided`'s hold, not by v2's: a decided row is never touched again.
    expect(getApproval(store, v1)).toMatchObject({ status: "denied", decision: "deny", decided_by: "kernel", decided_at: T0 });
    expect(viewOf(store, v1)?.replaced_by).toBe(decided);
    expect(getApproval(store, decided)).toMatchObject({ status: "denied", decision: "deny", decided_by: "owner" });
    expect(viewOf(store, decided)).not.toHaveProperty("replaced_by");
    // A different member's pending call and a call with no subject are untouched; v2 is pending with no replaced_by.
    expect(getApproval(store, other)?.status).toBe("pending");
    expect(getApproval(store, plain)?.status).toBe("pending");
    expect(getApproval(store, v2)?.status).toBe("pending");
    expect(viewOf(store, v2)).not.toHaveProperty("replaced_by");

    // One approval_decided event for the withdraw, linked to the requesting session; no message queued for it.
    const withdrawn = events(store, "approval_decided").filter((e) => e.payload.id === v1);
    expect(withdrawn.map((e) => e.payload)).toEqual([{ id: v1, decision: "deny", by: "kernel", action: "kernel_agent_create", replaced_by: decided }]);
    expect(withdrawn[0]?.session_id).toBe(s);
    expect(queuedFor(store, v1)).toBe(0);
    // The owner's own deny queues its message as before.
    expect(queuedFor(store, decided)).toBe(1);
    // A withdraw never uses a grant.
    expect(events(store, "approval_used")).toEqual([]);
  });

  it("v1 → v2 → v3: each hold withdraws only the one pending before it; the subject is on the event, never in payload_json", () => {
    const store = openStore();
    const s = session(store);
    const v1 = hold(store, s, { subject: "agent:mason" });
    const v2 = hold(store, s, { subject: "agent:mason", action: "kernel_agent_update" });
    const v3 = hold(store, s, { subject: "agent:mason" });
    expect([v1, v2, v3].map((id) => viewOf(store, id)?.replaced_by)).toEqual([v2, v3, undefined]);
    expect([v1, v2, v3].map((id) => getApproval(store, id)?.status)).toEqual(["denied", "denied", "pending"]);
    // Exactly one decision each, never a second one for v1.
    expect(events(store, "approval_decided").map((e) => [e.payload.id, e.payload.replaced_by])).toEqual([
      [v1, v2],
      [v2, v3],
    ]);
    expect(events(store, "approval_requested").map((e) => e.payload.subject)).toEqual(["agent:mason", "agent:mason", "agent:mason"]);
    for (const id of [v1, v2, v3]) expect(getApproval(store, id)?.payload_json).not.toContain("subject");
    // A withdrawn approval can't be decided again.
    expect(() => decideApproval(store, { id: v1, decision: "once", by: "owner" }, clock.at)).toThrow(expect.objectContaining({ code: "approval_not_pending" }));
  });

  it("GET /approvals?all=1 shows replaced_by on the withdrawn approval only", async () => {
    const store = openStore();
    const s = session(store);
    const v1 = hold(store, s, { subject: "agent:mason" });
    const v2 = hold(store, s, { subject: "agent:mason" });
    const route = approvalRoutes.find((r) => r.method === "GET" && r.path === "/approvals") as ContributedRoute;
    const res = await route.handler({ store, query: { all: "1" }, params: {}, body: undefined } as unknown as Parameters<ContributedRoute["handler"]>[0]);
    const listed = (res.body as { approvals: ApprovalView[] }).approvals;
    expect(listed.map((a) => [a.id, a.status, a.decided_by, a.replaced_by])).toEqual([
      [v2, "pending", null, undefined],
      [v1, "denied", "kernel", v2],
    ]);
    expect(JSON.parse(JSON.stringify(listed[1]))).toMatchObject({ replaced_by: v2, decision: "deny" });
  });

  it("runs in the caller's transaction: a rollback after the hold undoes the new row and the withdraw together", () => {
    const store = openStore();
    const s = session(store);
    const v1 = hold(store, s, { subject: "agent:mason" });
    expect(() =>
      store.transaction(() => {
        hold(store, s, { subject: "agent:mason" });
        expect(getApproval(store, v1)?.status).toBe("denied");
        throw new Error("rolled back");
      }),
    ).toThrow("rolled back");
    expect(getApproval(store, v1)?.status).toBe("pending");
    expect(count(store, "SELECT count(*) FROM approvals")).toBe(1);
    expect(events(store, "approval_decided")).toEqual([]);
  });

  it("refuses a subject that is empty, over MAX_APPROVAL_SUBJECT or not a string, writing nothing", () => {
    const store = openStore();
    const s = session(store);
    const v1 = hold(store, s, { subject: "agent:mason" });
    for (const subject of ["", "x".repeat(MAX_APPROVAL_SUBJECT + 1), 5 as unknown as string]) {
      expect(() => hold(store, s, { subject })).toThrow(ApprovalError);
    }
    expect(count(store, "SELECT count(*) FROM approvals")).toBe(1);
    expect(getApproval(store, v1)?.status).toBe("pending");
    // At the bound it is accepted.
    expect(viewOf(store, hold(store, s, { subject: "x".repeat(MAX_APPROVAL_SUBJECT) }))?.status).toBe("pending");
  });

  it("withdrawReplaced alone: matches the subject exactly, skips the new id and returns what it withdrew", () => {
    const store = openStore();
    const s = session(store);
    const a = hold(store, s, { subject: "agent:mason" });
    const b = hold(store, s, { subject: "agent:mason2" });
    const c = hold(store, s, { subject: "AGENT:MASON" });
    expect(withdrawReplaced(store, "agent:mason", 99, T0)).toEqual([a]);
    expect(withdrawReplaced(store, "agent:mason", 99, T0)).toEqual([]);
    expect([b, c].map((id) => getApproval(store, id)?.status)).toEqual(["pending", "pending"]);
    expect(withdrawReplaced(store, "agent:mason2", b, T0)).toEqual([]);
    expect(getApproval(store, b)?.status).toBe("pending");
  });
});

// ---- AC2 (kernel half): stored whole ---------------------------------------------------

describe("AC2 (kernel half): the display is stored and served whole, up to MAX_REQUEST_PAYLOAD_JSON", () => {
  it("a 4,001+-character display is stored and listed whole; one over 64,000 is cut to 64,000", () => {
    const store = openStore();
    const s = session(store);
    const long = `head line\n${"y".repeat(MAX_APPROVAL_DISPLAY + 500)}`;
    const id = hold(store, s, { display: long });
    expect(events(store, "approval_requested")[0]?.payload.display).toBe(long);
    expect(viewOf(store, id)?.display).toBe(long);
    expect(listApprovals(store)[0]?.display).toHaveLength(long.length);
    const huge = "z".repeat(MAX_REQUEST_PAYLOAD_JSON + 10);
    const big = hold(store, s, { display: huge });
    expect(viewOf(store, big)?.display).toBe(huge.slice(0, MAX_REQUEST_PAYLOAD_JSON));
  });
});

// ---- AC6, AC11 (CLI): the list's cut is marked ---------------------------------------------

function view(display: string | undefined, extra: Partial<ApprovalView> = {}): ApprovalView {
  return {
    id: 7,
    requesting_agent: "wright",
    requesting_session: 3,
    action: "kernel_agent_create",
    payload: { tool: CREATE },
    requested_at: T0,
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    ...(display === undefined ? {} : { display }),
    ...extra,
  };
}

/** The `display:` block's lines of `formatApprovals`' output (between `  display:` and `  payload:`). */
function displayBlock(text: string): string[] {
  const lines = text.split("\n");
  return lines.slice(lines.indexOf("  display:") + 1, lines.indexOf("  payload:"));
}

describe("AC6 and AC11 (CLI): studio approvals cuts a long display at MAX_APPROVAL_DISPLAY and says how much it left out", () => {
  it("a display of exactly MAX_APPROVAL_DISPLAY is listed whole with no mark", () => {
    const text = "a".repeat(MAX_APPROVAL_DISPLAY);
    const block = displayBlock(formatApprovals([view(text)], false));
    expect(block).toEqual([`    ${text}`]);
  });

  it("a longer one ends with a mark naming the characters left out and where to see them all, never mid-text with no mark", () => {
    const text = `role.md: the first sentence.\n${"b".repeat(5000)} and the end of it.`;
    const block = displayBlock(formatApprovals([view(text)], false));
    const left = text.length - MAX_APPROVAL_DISPLAY;
    expect(block.at(-1)).toBe(`    … ${left} more characters not shown; ${MARK_WHERE}`);
    // The listed part is exactly the first MAX_APPROVAL_DISPLAY characters.
    expect(block.slice(0, -1).map((l) => l.slice(4)).join("\n")).toBe(text.slice(0, MAX_APPROVAL_DISPLAY));
    expect(block.join("\n")).not.toContain("and the end of it.");
  });

  it("never splits a surrogate pair: the cut steps back one and counts it as left out", () => {
    const text = `${"c".repeat(MAX_APPROVAL_DISPLAY - 1)}😀${"d".repeat(10)}`;
    const block = displayBlock(formatApprovals([view(text)], false));
    expect(block[0]).toBe(`    ${"c".repeat(MAX_APPROVAL_DISPLAY - 1)}`);
    expect(block.at(-1)).toBe(`    … 12 more characters not shown; ${MARK_WHERE}`);
  });

  it("every listed line stays escaped and inside the display block (untrusted text)", () => {
    const text = `ok\n  payload:\n\u001b[31mred‮${"e".repeat(MAX_APPROVAL_DISPLAY)}`;
    const out = formatApprovals([view(text)], false);
    const block = displayBlock(out);
    expect(block.every((l) => l.startsWith("    "))).toBe(true);
    expect(out).not.toContain("\u001b");
    expect(out).not.toContain("‮");
    expect(block.at(-1)).toMatch(/^ {4}… \d+ more characters not shown; /);
    expect(out.split("\n").filter((l) => l === "  payload:")).toHaveLength(1);
  });

  it("a withdrawn approval says which one replaced it", () => {
    const out = formatApprovals([view("d", { status: "denied", decision: "deny", decided_by: "kernel", decided_at: T0, replaced_by: 9 })], true);
    expect(out).toContain("  decided: by kernel at 2026-11-11T10:00:00.000Z\n  replaced by #9: withdrawn by the kernel when a newer version was held\n");
  });

  it("--json prints the API's answer unchanged, every display whole", async () => {
    const text = "f".repeat(MAX_APPROVAL_DISPLAY * 2);
    const body = { approvals: [view(text)] };
    const client: CliApiClient = { request: async () => ({ status: 200, body }) };
    let stdout = "";
    const out = { stdout: { write: (c: string) => (stdout += c) }, stderr: { write: () => true } };
    expect(await approvalsSubcommand.run(["--json"], client, out)).toBe(0);
    expect((JSON.parse(stdout) as typeof body).approvals[0]?.display).toBe(text);
    stdout = "";
    expect(await approvalsSubcommand.run([], client, out)).toBe(0);
    expect(stdout).toContain(`… ${MAX_APPROVAL_DISPLAY} more characters not shown; ${MARK_WHERE}`);
  });
});

// ---- Through the gate -------------------------------------------------------------------

type Decision = { hookEventName: string; permissionDecision: string; permissionDecisionReason: string };

function gateOf(call: FakeCall): (tool: string, toolInput: unknown) => Promise<Decision> {
  const hook = call.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
  return async (tool, toolInput) => {
    const input = { hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, tool_use_id: "toolu_1", session_id: "s", transcript_path: "/dev/null", cwd: tmp } as unknown as HookInput;
    return ((await hook(input, "toolu_1", { signal: new AbortController().signal })) as { hookSpecificOutput: Decision }).hookSpecificOutput;
  };
}

/** Wright's session, its gate with the shipped tools' pre-hold check (or `check`), and the owner's `once` with the shipped applier. */
async function boot(check?: HeldToolCheck) {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...(JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>), model: MODEL }, null, 2)}\n`);
  const store = openStore();
  const now = (): Date => clock.at;
  const fakes = fakeSessions();
  const toolSessions: KernelToolContext["sessions"] = { stopSession: (id: number) => manager.stopSession(id), getSession: (id: number) => manager.getSession(id) };
  const contextOf = (sessionId: number): KernelToolContext => ({ store, sessions: toolSessions, sessionId, now });
  const manager: SessionManager = new SessionManager(
    { store, authProvider: stubProvider(), loomwrightPath: pluginDir, stopGraceMs: 10, baseEnv: { PATH: "/usr/bin" }, heldToolCheck: check ?? heldToolCheckOf(SHIPPED_TOOLS, contextOf) },
    { ...fakes.deps, homeDir: join(tmp, "home"), now },
  );
  await manager.startSession({ agent: "wright", prompt: "Draft a crew member.", model: MODEL, permissionMode: "default", cwd: tmp, policy: WRIGHT_POLICY, closeInputOnResult: false });
  const gate = gateOf(fakes.calls[fakes.calls.length - 1] as FakeCall);
  const applier = approvalApplierOf(SHIPPED_TOOLS);
  const decide = (id: number) => decideApproval(store, { id, decision: "once", by: "owner" }, clock.at, applier);
  return { store, gate, decide };
}

/** A charter Wright may draft: a duty naming its job, no workspace. */
function crew(id: string, persona = "Tells the owner what changed."): Record<string, unknown> {
  return {
    id,
    display_name: id[0]?.toUpperCase() + id.slice(1),
    avatar: { shape: "crab", hue: "crew-teal" },
    persona,
    duties: [{ text: "Tell the owner what changed", jobs: ["notify_owner"] }],
    boundaries: ["Never merge a pull request yourself."],
    model: "claude-sonnet-5",
    permission_mode: "default",
    tool_policy: { allowedTools: ["Read", `${K}kernel_notify_owner`], allowedBashPrefixes: [], never: [] },
    workspaces: [],
  };
}

const HELD = (n: number) => new RegExp(`^approval_required: held as approval ${n};`);

describe("AC12 through the gate: the charter tools' holds name the member, so v2 withdraws v1", () => {
  it("a second create for the same member withdraws the first; a create for another member is untouched; approving v2 still applies", async () => {
    const h = await boot();
    expect((await h.gate(CREATE, { charter: crew("mason"), idempotency_key: "c1" })).permissionDecisionReason).toMatch(HELD(1));
    expect((await h.gate(CREATE, { charter: crew("nell"), idempotency_key: "c2" })).permissionDecisionReason).toMatch(HELD(2));
    expect((await h.gate(CREATE, { charter: crew("mason", "Tells the owner what changed, daily."), idempotency_key: "c3" })).permissionDecisionReason).toMatch(HELD(3));
    expect(events(h.store, "approval_requested").map((e) => e.payload.subject)).toEqual(["agent:mason", "agent:nell", "agent:mason"]);
    expect(getApproval(h.store, 1)).toMatchObject({ status: "denied", decision: "deny", decided_by: "kernel" });
    expect(viewOf(h.store, 1)?.replaced_by).toBe(3);
    expect(getApproval(h.store, 2)?.status).toBe("pending");
    expect(queuedFor(h.store, 1)).toBe(0);
    // The subject never enters the payload, so the grant a later approval makes still matches the exact call.
    expect(getApproval(h.store, 3)?.payload_json).not.toContain("agent:mason");
    h.decide(3);
    expect(getApproval(h.store, 3)).toMatchObject({ status: "approved", decision: "once" });
    expect(events(h.store, "approval_decided").at(-1)?.payload.applied).toMatch(/^The kernel created crew member mason \(Mason\) on approval 3\./);
  });

  it("a second update for the same member withdraws the first", async () => {
    const h = await boot();
    const made = createAgent(h.store, dataDir, crew("dev"), { by: "owner" }, clock.at);
    expect(made.ok).toBe(true);
    const sha = createHash("sha256").update(readFileSync(agentSettingsPath(dataDir, "dev"))).digest("hex");
    const update = (tokens: number, key: string) => h.gate(UPDATE, { id: "dev", changes: { limits: { tokens_per_day: tokens } }, expected_sha256: sha, idempotency_key: key });
    expect((await update(100000, "u1")).permissionDecisionReason).toMatch(HELD(1));
    expect((await update(120000, "u2")).permissionDecisionReason).toMatch(HELD(2));
    expect(events(h.store, "approval_requested").map((e) => e.payload.subject)).toEqual(["agent:dev", "agent:dev"]);
    expect(viewOf(h.store, 1)).toMatchObject({ status: "denied", decided_by: "kernel", replaced_by: 2 });
    expect(getApproval(h.store, 2)?.status).toBe("pending");
  });

  it("checkedVerdict accepts subject (1 to MAX_APPROVAL_SUBJECT characters) and still denies kernel_gate_error on any other shape", async () => {
    const answers: unknown[] = [
      { display: "d", subject: "agent:x" },
      { display: "d", subject: "agent:x", agentNote: "n", subjectVersion: 2 },
      { display: "d", subject: "" },
      { display: "d", subject: 7 },
      { display: "d", subject: "s".repeat(MAX_APPROVAL_SUBJECT + 1) },
      { display: "d", subject: "agent:x", other: 1 },
    ];
    let next = 0;
    const h = await boot((tool) => (tool === CREATE ? (answers[next++] as ReturnType<HeldToolCheck>) : undefined));
    const call = (key: string) => h.gate(CREATE, { charter: {}, idempotency_key: key });
    expect((await call("k1")).permissionDecisionReason).toMatch(HELD(1));
    expect((await call("k2")).permissionDecisionReason).toMatch(HELD(2));
    for (const key of ["k3", "k4", "k5", "k6"]) expect((await call(key)).permissionDecisionReason).toBe("kernel_gate_error");
    expect(count(h.store, "SELECT count(*) FROM approvals")).toBe(2);
    expect(viewOf(h.store, 1)).toMatchObject({ status: "denied", decided_by: "kernel", replaced_by: 2 });
    expect(events(h.store, "approval_requested")[1]?.payload).toMatchObject({ subject: "agent:x", subject_version: 2 });
  });

  it("a hold with no subject withdraws nothing", async () => {
    const h = await boot(() => ({ display: "d" }));
    await h.gate(CREATE, { charter: {}, idempotency_key: "k1" });
    await h.gate(CREATE, { charter: {}, idempotency_key: "k2" });
    expect(listApprovals(h.store).map((a) => a.status)).toEqual(["pending", "pending"]);
    expect(events(h.store, "approval_requested").every((e) => !("subject" in e.payload))).toBe(true);
  });
});

// ---- Phase 8 item 19b: the held reason names what the hold withdrew ---------------------

/** A charter tool's "if it is approved" clause (both charter tools are kernel-applied actions). */
const KERNEL_APPLIES = "the kernel applies it itself and that message says what it did; do not repeat the call.";

/** Today's whole held reason for approval `n`, before any withdrawal sentence or note. */
const HELD_REASON = (n: number) =>
  `approval_required: held as approval ${n}; it did not run. The owner decides in Studio's Approvals (approval ${n}) ` +
  `and the decision arrives as a new message. End your turn now; if it is approved, ${KERNEL_APPLIES}`;

/** The one-id withdrawal sentence (AC1). */
const WITHDREW_ONE = (n: number) =>
  ` The kernel withdrew approval ${n} (the older pending version of this call); it needs no decision, so do not ask the owner to approve or reject it.`;

describe("19b: the held reason names what the hold withdrew", () => {
  it("AC1: v2 of a member's charter is told, before any note, that the kernel withdrew v1", async () => {
    const h = await boot();
    const v1 = (await h.gate(CREATE, { charter: crew("mason"), idempotency_key: "c1" })).permissionDecisionReason;
    // The shipped check's readiness note (this charter's duty is not covered) is the part after today's reason;
    // v2's charter has the same finding, so the same note, which must stay last, after the withdrawal sentence.
    expect(v1.startsWith(HELD_REASON(1))).toBe(true);
    const note = v1.slice(HELD_REASON(1).length);
    expect(note).toMatch(/^ The kernel checked this charter before the owner sees it; /);
    const v2 = await h.gate(CREATE, { charter: crew("mason", "Tells the owner what changed, daily."), idempotency_key: "c2" });
    expect(v2.permissionDecision).toBe("deny");
    expect(v2.permissionDecisionReason).toBe(`${HELD_REASON(2)}${WITHDREW_ONE(1)}${note}`);
    expect(v2.permissionDecisionReason).toMatch(HELD(2));
    expect(getApproval(h.store, 1)).toMatchObject({ status: "denied", decided_by: "kernel" });
    // The tool_decision event is unchanged: the withdraw is recorded on approval 1's own approval_decided event.
    expect(events(h.store, "tool_decision").at(-1)?.payload).not.toHaveProperty("withdrawn");
    expect(JSON.stringify(events(h.store, "tool_decision").map((e) => e.payload))).not.toContain("withdrew");
  });

  it("AC1: the withdrawal sentence sits after the if-approved clause and before the check's agentNote, which stays last", async () => {
    const h = await boot(() => ({ display: "d", subject: "agent:x", agentNote: "Readiness: 1 duty flagged." }));
    expect((await h.gate(CREATE, { charter: {}, idempotency_key: "k1" })).permissionDecisionReason).toBe(`${HELD_REASON(1)} Readiness: 1 duty flagged.`);
    expect((await h.gate(CREATE, { charter: {}, idempotency_key: "k2" })).permissionDecisionReason).toBe(
      `${HELD_REASON(2)}${WITHDREW_ONE(1)} Readiness: 1 duty flagged.`,
    );
  });

  it("AC3: a first charter hold and a hold for another member while one is pending read exactly as before", async () => {
    const h = await boot();
    const first = await h.gate(CREATE, { charter: crew("mason"), idempotency_key: "c1" });
    const other = await h.gate(CREATE, { charter: crew("nell"), idempotency_key: "c2" });
    // The shipped check adds the charter's readiness note; a no-withdraw hold has nothing between the clause and it.
    const note =
      " The kernel checked this charter before the owner sees it; open: duty 1 is not covered (needs Notify the owner). Tell the owner these in plain words, in the thread. " +
      "The fix to propose: add Notify the owner to tool_policy.allowedTools (mcp__kernel__kernel_notify); if the owner agrees, draft the charter again with kernel_agent_create and a new idempotency_key.";
    expect(first.permissionDecisionReason).toBe(`${HELD_REASON(1)}${note}`);
    expect(other.permissionDecisionReason).toBe(`${HELD_REASON(2)}${note}`);
    for (const r of [first, other]) expect(r.permissionDecisionReason).not.toContain("withdrew");
    expect([1, 2].map((id) => getApproval(h.store, id)?.status)).toEqual(["pending", "pending"]);
  });

  it("AC3: a second hold with no subject reads exactly as before", async () => {
    const plain = await boot(() => ({ display: "d" }));
    expect((await plain.gate(CREATE, { charter: {}, idempotency_key: "k1" })).permissionDecisionReason).toBe(HELD_REASON(1));
    expect((await plain.gate(CREATE, { charter: {}, idempotency_key: "k2" })).permissionDecisionReason).toBe(HELD_REASON(2));
  });

  it("AC3: with a scripted check (no note), a first hold and another member's hold are byte-identical to today's reason", async () => {
    const subjects = ["agent:mason", "agent:nell"];
    let next = 0;
    const h = await boot(() => ({ display: "d", subject: subjects[next++] as string }));
    expect((await h.gate(CREATE, { charter: {}, idempotency_key: "k1" })).permissionDecisionReason).toBe(HELD_REASON(1));
    expect((await h.gate(CREATE, { charter: {}, idempotency_key: "k2" })).permissionDecisionReason).toBe(HELD_REASON(2));
    expect([1, 2].map((id) => getApproval(h.store, id)?.status)).toEqual(["pending", "pending"]);
  });

  it("AC4: two older pending versions of one subject are both named, oldest first", async () => {
    const h = await boot(() => ({ display: "d", subject: "agent:x" }));
    const s = Number(h.store.prepare("SELECT id FROM sessions ORDER BY id LIMIT 1").pluck().get());
    // Two pending approvals with one subject can't arise through the gate (each hold withdraws the one before
    // it), so they are seeded in the store: 2 withdraws 1, then 1 is set back to pending. Approval 1 keeps its
    // earlier approval_decided event (events are append-only); the withdraw query reads only approvals.status
    // and the approval_requested subject, never that event.
    expect(hold(h.store, s, { subject: "agent:x" })).toBe(1);
    expect(hold(h.store, s, { subject: "agent:x" })).toBe(2);
    h.store.prepare("UPDATE approvals SET status='pending', decision=NULL, decided_by=NULL, decided_at=NULL WHERE id = 1").run();
    expect([1, 2].map((id) => getApproval(h.store, id)?.status)).toEqual(["pending", "pending"]);
    const v3 = await h.gate(CREATE, { charter: {}, idempotency_key: "k3" });
    expect(v3.permissionDecisionReason).toBe(
      `${HELD_REASON(3)} The kernel withdrew approvals 1 and 2 (the older pending versions of this call); they need no decision, so do not ask the owner to approve or reject them.`,
    );
    expect([1, 2, 3].map((id) => getApproval(h.store, id)?.status)).toEqual(["denied", "denied", "pending"]);
  });

  it("AC4 (unit): withdrawnNote names one, two or three ids in the order given, and nothing for none", () => {
    expect(withdrawnNote([])).toBe("");
    expect(withdrawnNote([7])).toBe(WITHDREW_ONE(7));
    expect(withdrawnNote([1, 2])).toBe(
      " The kernel withdrew approvals 1 and 2 (the older pending versions of this call); they need no decision, so do not ask the owner to approve or reject them.",
    );
    expect(withdrawnNote([1, 2, 3])).toBe(
      " The kernel withdrew approvals 1, 2 and 3 (the older pending versions of this call); they need no decision, so do not ask the owner to approve or reject them.",
    );
  });

  it("AC5: a call an existing one-shot grant lets through is approval_granted, with nothing about withdrawals and nothing withdrawn", async () => {
    const h = await boot(() => ({ display: "d", subject: "agent:mason" }));
    const v1 = { charter: { v: 1 }, idempotency_key: "k1" };
    expect((await h.gate(CREATE, v1)).permissionDecisionReason).toBe(HELD_REASON(1));
    // The owner approves it once with no applier, so the grant is left for the retry.
    decideApproval(h.store, { id: 1, decision: "once", by: "owner" }, clock.at);
    // A different call for the same member is held as 2; approval 1 is approved, so nothing is withdrawn.
    expect((await h.gate(CREATE, { charter: { v: 2 }, idempotency_key: "k2" })).permissionDecisionReason).toBe(HELD_REASON(2));
    const granted = await h.gate(CREATE, v1);
    expect(granted).toMatchObject({ permissionDecision: "allow", permissionDecisionReason: "approval_granted" });
    expect(getApproval(h.store, 2)?.status).toBe("pending");
    expect(events(h.store, "approval_decided").filter((e) => e.payload.by === "kernel")).toEqual([]);
    expect(events(h.store, "approval_used").map((e) => e.payload.id)).toEqual([1]);
  });

  it("AC6: a hold whose transaction throws after the withdraw is kernel_gate_error, names no withdrawal, and the withdraw rolls back", async () => {
    const h = await boot(() => ({ display: "d", subject: "agent:mason" }));
    expect((await h.gate(CREATE, { charter: {}, idempotency_key: "k1" })).permissionDecisionReason).toBe(HELD_REASON(1));
    h.store
      .prepare("CREATE TRIGGER test_no_tool_decision BEFORE INSERT ON events WHEN NEW.kind = 'tool_decision' BEGIN SELECT RAISE(ABORT, 'test: no tool_decision'); END")
      .run();
    const failed = await h.gate(CREATE, { charter: {}, idempotency_key: "k2" });
    expect(failed).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "kernel_gate_error" });
    expect(failed.permissionDecisionReason).not.toContain("withdrew");
    expect(getApproval(h.store, 1)?.status).toBe("pending");
    expect(count(h.store, "SELECT count(*) FROM approvals")).toBe(1);
    expect(events(h.store, "approval_decided")).toEqual([]);
  });
});
