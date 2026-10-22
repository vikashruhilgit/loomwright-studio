// The Sessions screen's canned kernel (phase 5 item 16), for
// `startFixtureKernel({ routes })`. Every body is typed by the contract.
//
// It answers the session routes the way the kernel does where the screen can
// tell (`kernel/src/console/output.ts`, `control.ts`, `sessions/manager.ts`):
//
// - `GET /sessions` lists the sessions; `GET /sessions/:id/output` answers the
//   rows with `seq > after`, at most `limit` (500) of them, oldest first. Every
//   read is recorded with its `after` and `limit`.
// - `POST /sessions/:id/stop` and `/kill`: a running session ends `stopped`
//   with `owner_stop` / `owner_kill`; one not running answers
//   `409 {error: "not_running", status}`; an unknown id `404 not_found`.
// - `POST /sessions/:id/abandon`: only an `orphaned` row whose `/status`
//   orphan reason is `leader_unverified` becomes `abandoned`; any other answers
//   `409` with the kernel's message.
// - `GET /status` carries `kill_unconfirmed` and `orphaned`; `GET /approvals`
//   and `GET /agents` the pending approvals and the roster. The sidebar's other
//   reads answer empty lists.
//
// The state is mutable. A spec can replace a control route's answer (`stop`,
// `kill`, `abandon`) with its own, including one that never settles until the
// spec releases it. `onChange` is called with the event kind the kernel would
// append and the session id, so a spec can push it through the feed.
import type { Approval, EventFrame, RosterEntry, RouteKey, SessionOutputKind, SessionOutputRow, SessionSummary, StatusBody } from "../../src/api/contract";
import { cannedStatus } from "../fixture-kernel";
import type { FixtureAnswer, FixtureRequest, FixtureRoute } from "../fixture-kernel";

/** The kernel's `MAX_OUTPUT_LIMIT`. */
export const OUTPUT_LIMIT = 500;

/** An ESC (U+001B) and a right-to-left override (U+202E), built from their code points so no raw one sits in this file. */
export const ESC = String.fromCharCode(0x1b);
export const RLO = String.fromCharCode(0x202e);

export interface RecordedPost {
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface OutputRead {
  readonly id: number;
  readonly after: string | undefined;
  readonly limit: string | undefined;
}

export type ControlAnswer = (req: FixtureRequest) => FixtureAnswer | Promise<FixtureAnswer>;

type KillUnconfirmed = StatusBody["kill_unconfirmed"][number];
type Orphan = StatusBody["orphaned"][number];

export interface SessionsKernel {
  sessions: SessionSummary[];
  /** Each session's output rows, by session id, in `seq` order. */
  readonly output: Map<number, SessionOutputRow[]>;
  killUnconfirmed: KillUnconfirmed[];
  orphaned: Orphan[];
  approvals: Approval[];
  agents: RosterEntry[];
  /** Every control POST, in order. */
  readonly posts: RecordedPost[];
  /** Every output read, in order. */
  readonly outputReads: OutputRead[];
  /** Replace a control route's answer (default: the kernel's). */
  stop: ControlAnswer | undefined;
  kill: ControlAnswer | undefined;
  abandon: ControlAnswer | undefined;
  /** Called with the event kind the kernel appends and its session id. */
  onChange: (kind: string, sessionId: number | null) => void;
}

const MINUTE = 60_000;

/** `minutes` from now (negative: ago), as the kernel writes a time. */
export function ago(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE).toISOString();
}

export function summary(id: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id, agent: "ada", status: "completed", model: "sonnet", started: ago(60), ended: ago(50), tokens: 9020, cwd: "/Users/owner/src/loomwright", playbook: null, ...overrides };
}

export function outputRow(sessionId: number, seq: number, kind: SessionOutputKind, payload: unknown, createdAt = ago(1)): SessionOutputRow {
  return { id: sessionId * 100_000 + seq, session_id: sessionId, seq, kind, payload, created_at: createdAt };
}

export function roster(id: string, name: string, shape: string, hue: string): RosterEntry {
  return {
    id,
    display_name: name,
    avatar: { shape, hue },
    status: "active",
    created_by: id === "wright" ? null : "wright",
    approval_id: null,
    model: "sonnet",
    settings_error: null,
    tokens_today: 0,
    tokens_per_day: 250_000,
    sessions_running: 0,
    sessions_at_once: 2,
  };
}

export function cannedRoster(): RosterEntry[] {
  return [roster("wright", "Wright", "whale", "accent"), roster("mason", "Mason", "octopus", "crew-teal"), roster("ada", "Ada", "seahorse", "crew-berry")];
}

/** A review in progress (the mockup's `s1` log): tool calls, results, prose, one allowed and one held decision. */
export function reviewOutput(sessionId: number): SessionOutputRow[] {
  const rows: [SessionOutputKind, unknown][] = [
    ["system", { subtype: "init", model: "sonnet", tool_count: 14 }],
    ["tool_call", { tool_use_id: "t1", name: "Bash", input_json: '{"command":"gh pr view 412 --json files,reviews,statusCheckRollup"}' }],
    ["tool_decision", { tool: "Bash", decision: "allow", reason: "policy_allow", tool_use_id: "t1" }],
    ["tool_result", { tool_use_id: "t1", is_error: false, content: "12 files · 0 reviews · checks: ci ✓ claude-review ✓" }],
    ["tool_call", { tool_use_id: "t2", name: "Read", input_json: '{"file_path":"scripts/validate-worker-result.py"}' }],
    ["tool_result", { tool_use_id: "t2", is_error: false, content: "#!/usr/bin/env python3\n# SubagentStop validator\nimport json, sys" }],
    ["tool_call", { tool_use_id: "t3", name: "Grep", input_json: '{"pattern":"decision","path":"scripts/"}' }],
    ["tool_result", { tool_use_id: "t3", is_error: false, content: "6 matches" }],
    [
      "assistant_text",
      {
        text: 'The hook prints {"ok": false} on failure. That is the prompt-hook response shape; a command hook blocks via {"decision": "block"}, so this validator is a silent no-op.',
      },
    ],
    ["tool_call", { tool_use_id: "t4", name: "Bash", input_json: '{"command":"bash scripts/fixtures/run-hook.sh subagentstop-decision-shape-probe.json"}' }],
    ["tool_result", { tool_use_id: "t4", is_error: true, content: "exit 0 · hook_success · no decision recorded" }],
    ["assistant_text", { text: "Finding confirmed against the fixture. Drafting the review: 1 blocking, 2 nits." }],
    ["tool_call", { tool_use_id: "t5", name: "Bash", input_json: '{"command":"gh pr review 412 --request-changes --body-file review.md"}' }],
    ["tool_decision", { tool: "Bash", decision: "deny", reason: "approval_required", approval_id: 7, command: "gh pr review 412 --request-changes --body-file review.md", tool_use_id: "t5" }],
    ["tool_call", { tool_use_id: "t6", name: "Bash", input_json: '{"command":"git push --force origin main"}' }],
    ["tool_decision", { tool: "Bash", decision: "deny", reason: "never_category", command: "git push --force origin main", tool_use_id: "t6" }],
    ["assistant_text", { text: "Review drafted. Waiting for approval before posting." }],
  ];
  return rows.map(([kind, payload], i) => outputRow(sessionId, i + 1, kind, payload, ago(4 - i * 0.2)));
}

/** A finished session's log: its result rows. */
export function finishedOutput(sessionId: number, subtype = "success"): SessionOutputRow[] {
  return [
    outputRow(sessionId, 1, "system", { subtype: "init", model: "sonnet", tool_count: 9 }, ago(55)),
    outputRow(sessionId, 2, "assistant_text", { text: "Review posted · 0 blocking · 3 nits." }, ago(52)),
    outputRow(sessionId, 3, "result", { subtype, counted_tokens: 22_800 }, ago(50)),
  ];
}

/** Rows whose untrusted strings carry an ANSI escape and a bidi override. */
export function hostileOutput(sessionId: number, from: number): SessionOutputRow[] {
  return [
    outputRow(sessionId, from, "assistant_text", { text: `${ESC}[31mOK${ESC}[0m written to notes${RLO}txt.exe` }),
    outputRow(sessionId, from + 1, "tool_call", { tool_use_id: "h1", name: "Bash", input_json: `{"command":"printf '${ESC}[31m'"}` }),
    outputRow(sessionId, from + 2, "tool_result", { tool_use_id: "h1", is_error: false, content: `notes${RLO}txt.exe` }),
  ];
}

/** `count` plain `assistant_text` rows from `from`, to make a log long enough to scroll. */
export function filler(sessionId: number, from: number, count: number): SessionOutputRow[] {
  const rows: SessionOutputRow[] = [];
  for (let i = 0; i < count; i += 1) rows.push(outputRow(sessionId, from + i, "assistant_text", { text: `Checked file ${from + i} of the diff.` }));
  return rows;
}

/** A pending approval held from session `sessionId`. */
export function heldApproval(id: number, sessionId: number): Approval {
  return {
    id,
    requesting_agent: "ada",
    requesting_session: sessionId,
    action: "Bash",
    payload: { tool: "Bash", command: "gh pr comment 405 --body-file summary.md" },
    requested_at: ago(3),
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: { id: 5, slug: "review-prs", version: 3 },
  };
}

export interface SessionsKernelInit {
  readonly sessions?: readonly SessionSummary[];
  readonly output?: ReadonlyMap<number, readonly SessionOutputRow[]>;
  readonly killUnconfirmed?: readonly KillUnconfirmed[];
  readonly orphaned?: readonly Orphan[];
  readonly approvals?: readonly Approval[];
  readonly agents?: readonly RosterEntry[];
}

export function sessionsKernel(init: SessionsKernelInit = {}): SessionsKernel {
  const output = new Map<number, SessionOutputRow[]>();
  for (const [id, rows] of init.output ?? []) output.set(id, [...rows]);
  return {
    sessions: [...(init.sessions ?? [])],
    output,
    killUnconfirmed: [...(init.killUnconfirmed ?? [])],
    orphaned: [...(init.orphaned ?? [])],
    approvals: [...(init.approvals ?? [])],
    agents: [...(init.agents ?? cannedRoster())],
    posts: [],
    outputReads: [],
    stop: undefined,
    kill: undefined,
    abandon: undefined,
    onChange: () => undefined,
  };
}

/** Append rows to a session's log (the spec then pushes `session_output_appended`). */
export function appendOutput(kernel: SessionsKernel, sessionId: number, rows: readonly SessionOutputRow[]): void {
  kernel.output.set(sessionId, [...(kernel.output.get(sessionId) ?? []), ...rows]);
}

/** The highest seq in a session's log, 0 when empty. */
export function lastSeq(kernel: SessionsKernel, sessionId: number): number {
  return kernel.output.get(sessionId)?.at(-1)?.seq ?? 0;
}

const ok = (body: unknown): FixtureAnswer => ({ status: 200, body });
const refused = (status: number, body: Record<string, unknown>): FixtureAnswer => ({ status, body });
const LIVE = new Set(["starting", "running"]);

/** The kernel's own stop / kill answer (a spec that holds the answer calls this when it releases it). */
export function ownerStop(kernel: SessionsKernel, req: FixtureRequest, reason: "owner_stop" | "owner_kill"): FixtureAnswer {
  const id = Number(req.params.id);
  const index = kernel.sessions.findIndex((s) => s.id === id);
  const current = kernel.sessions[index];
  if (current === undefined) return refused(404, { error: "not_found" });
  if (!LIVE.has(current.status)) return refused(409, { error: "not_running", status: current.status });
  kernel.sessions[index] = { ...current, status: "stopped", ended: new Date().toISOString() };
  kernel.onChange("session_status", id);
  return ok({ id, status: "stopped", reason });
}

function abandon(kernel: SessionsKernel, req: FixtureRequest): FixtureAnswer {
  const id = Number(req.params.id);
  const index = kernel.sessions.findIndex((s) => s.id === id);
  const current = kernel.sessions[index];
  if (current === undefined) return refused(404, { error: "not_found" });
  const orphan = kernel.orphaned.find((o) => o.id === id);
  if (current.status !== "orphaned" || orphan?.reason !== "leader_unverified") {
    return refused(409, { error: "not_abandonable", message: `session ${id} is ${current.status}; only a leader_unverified row can be abandoned` });
  }
  kernel.sessions[index] = { ...current, status: "abandoned" };
  kernel.orphaned = kernel.orphaned.filter((o) => o.id !== id);
  kernel.onChange("session_abandoned", id);
  return ok({ id, status: "abandoned" });
}

/** The routes, over `kernel`'s live state. */
export function sessionsRoutes(kernel: SessionsKernel): Partial<Record<RouteKey, FixtureRoute>> {
  const record = (req: FixtureRequest): void => {
    kernel.posts.push({ path: req.path, params: req.params });
  };
  return {
    "GET /status": () => ok(cannedStatus({ kill_unconfirmed: kernel.killUnconfirmed, orphaned: kernel.orphaned })),
    "GET /sessions": () => ok({ sessions: kernel.sessions }),
    "GET /sessions/:id/output": (req) => {
      const id = Number(req.params.id);
      kernel.outputReads.push({ id, after: req.query.after, limit: req.query.limit });
      const after = Number(req.query.after ?? "0");
      const limit = Math.min(OUTPUT_LIMIT, Number(req.query.limit ?? String(OUTPUT_LIMIT)));
      if (!kernel.sessions.some((s) => s.id === id)) return refused(404, { error: "not_found" });
      return ok({ rows: (kernel.output.get(id) ?? []).filter((r) => r.seq > after).slice(0, limit) });
    },
    "POST /sessions/:id/stop": (req) => {
      record(req);
      return kernel.stop === undefined ? ownerStop(kernel, req, "owner_stop") : kernel.stop(req);
    },
    "POST /sessions/:id/kill": (req) => {
      record(req);
      return kernel.kill === undefined ? ownerStop(kernel, req, "owner_kill") : kernel.kill(req);
    },
    "POST /sessions/:id/abandon": (req) => {
      record(req);
      return kernel.abandon === undefined ? abandon(kernel, req) : kernel.abandon(req);
    },
    "GET /approvals": () => ok({ approvals: kernel.approvals.filter((a) => a.status === "pending") }),
    "GET /agents": () => ok({ agents: kernel.agents }),
    "GET /messages": () => ok({ messages: [] }),
    "GET /playbooks": () => ok({ playbooks: [] }),
    "GET /triggers": () => ok({ triggers: [] }),
    "GET /notifications": () => ok({ notifications: [] }),
  };
}

/** An `events` row of `kind` for session `sessionId`, for `FixtureKernel.appendEvent`. */
export function sessionEvent(id: number, kind: string, sessionId: number | null): EventFrame {
  return { type: "event", id, at: new Date().toISOString(), kind, session_id: sessionId, task_id: null, payload: {} };
}

/** A promise the spec settles: a control answer held in flight until `release`. */
export function deferred<T>(): { readonly promise: Promise<T>; release(value: T): void } {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((done) => {
    settle = done;
  });
  return { promise, release: (value) => settle?.(value) };
}
