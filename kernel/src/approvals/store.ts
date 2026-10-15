// The `approvals` table's record (migration 11): one row per action waiting
// for the owner, with the exact payload. Created by the kernel's PreToolUse
// rail (a call in the fixed outward set, `source: "rail"`) or by an agent's
// `kernel_approval_request` (`source: "tool"`); decided by the owner over the
// API (`by: "owner"`). Mechanism only (invariant 1): the payload is stored as
// given and never interpreted (invariant 3). The value sets are closed here,
// in code (migration 11 has no SQL CHECK).
//
// A decision reaches the requesting agent as one queued `message` event
// (`sourceRef: approval:<id>`, so a retried decision never queues twice). An
// approved rail approval is a one-shot grant: the rail lets exactly that
// payload through once, for the same agent (or, for a session with no agent,
// the same session), and records its one use as an `approval_used` event in
// the same transaction as the allow (no new column, no new migration).
//
// The `studio` CLI loads this feature, so this module imports only kernel
// modules that never load the Agent SDK.
import { appendEvent, clip } from "../loop/internal.js";
import { enqueueEvent } from "../loop/queue.js";
import { recordNotification } from "../notifications/record.js";
import type { Store } from "../store/store.js";

/** `approvals.status`. */
export const APPROVAL_STATUSES = ["pending", "approved", "denied"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** `approvals.decision`. `always` is part of the closed set but never written in phase 2. */
export const APPROVAL_DECISIONS = ["once", "always", "deny"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Where an approval came from: the kernel's rail (a held tool call) or an agent's `kernel_approval_request`. */
export type ApprovalSource = "rail" | "tool";

/** The audit `events.kind` values this feature writes. */
export const APPROVAL_AUDIT_KINDS = ["approval_requested", "approval_decided", "approval_used"] as const;

/** `requesting_agent` for a session with no agent (migration 11: `NOT NULL`). */
export const UNKNOWN_AGENT = "unknown";

/** The one decider in phase 2 (the CLI and API are the owner's). */
export const OWNER = "owner";

/** Why `always` is refused (ARCHITECTURE: "Always allow" is stored per playbook, never globally). */
export const ALWAYS_REFUSED = "always-allow is stored per playbook; playbooks arrive in phase 3";

export const MAX_APPROVAL_ACTION = 200;
/** `kernel_approval_request`'s payload, as JSON, at most this many characters. The rail stores a held call's payload whole. */
export const MAX_REQUEST_PAYLOAD_JSON = 64_000;
/** `listApprovals` with `all`: at most this many decided approvals (newest first), after every pending one. */
export const MAX_DECIDED_LIST = 500;

/** A refusal: nothing was written. */
export class ApprovalError extends Error {
  readonly code: "no_such_approval" | "approval_not_pending" | "always_not_supported" | "invalid_approval";

  constructor(code: ApprovalError["code"], message: string) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
  }
}

/** One `approvals` row as stored. */
export interface ApprovalRow {
  readonly id: number;
  readonly requesting_agent: string;
  readonly requesting_session: number | null;
  readonly action: string;
  readonly payload_json: string;
  readonly requested_at: string;
  readonly status: ApprovalStatus;
  readonly decision: ApprovalDecision | null;
  readonly decided_by: string | null;
  readonly decided_at: string | null;
}

/** An approval as the API and CLI show it: the row with its payload parsed (the stored text when it is not JSON). */
export interface ApprovalView {
  readonly id: number;
  readonly requesting_agent: string;
  readonly requesting_session: number | null;
  readonly action: string;
  readonly payload: unknown;
  readonly requested_at: string;
  readonly status: ApprovalStatus;
  readonly decision: ApprovalDecision | null;
  readonly decided_by: string | null;
  readonly decided_at: string | null;
}

const COLUMNS = "id, requesting_agent, requesting_session, action, payload_json, requested_at, status, decision, decided_by, decided_at";

/**
 * `value` as JSON with every object's keys sorted, so the same payload always
 * has the same text (a grant matches it exactly, whatever key order the model
 * sent). Every own key is kept, `__proto__` included. Throws `TypeError` for a
 * value JSON cannot represent.
 */
export function canonicalJson(value: unknown): string {
  const text = JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
    // A null-prototype accumulator: an untrusted `__proto__` key (an own
    // property after `JSON.parse`) is copied as data, never through
    // `Object.prototype`'s setter, so it is kept and still tells payloads apart.
    const sorted: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
    return sorted;
  });
  if (typeof text !== "string") throw new TypeError("an approval payload must be JSON");
  return text;
}

export interface ApprovalRequest {
  /** The requesting session's agent; `null` (or empty) is stored as `unknown`. */
  readonly agent: string | null;
  readonly sessionId: number;
  readonly action: string;
  readonly payload: unknown;
  readonly source: ApprovalSource;
}

/** The session's agent, or `null` when it has none. */
function namedAgent(agent: string | null): string | null {
  return typeof agent === "string" && agent !== "" ? agent : null;
}

function agentOf(agent: string | null): string {
  return namedAgent(agent) ?? UNKNOWN_AGENT;
}

/**
 * Record one `pending` approval: the row, one `approval_requested` event
 * (`{id, action, source, agent}`, linked to the session) and one
 * `kernel:approval` notification, in one transaction (nested in a caller's,
 * it joins it). Returns the row. Throws `ApprovalError` (`invalid_approval`)
 * before writing when the action is empty, longer than 200 characters or
 * holds a NUL, or the agent's name holds a NUL (both go into the
 * notification's text, which `recordNotification` refuses with a NUL).
 */
export function requestApproval(store: Store, request: ApprovalRequest, now: Date): ApprovalRow {
  const { action, sessionId, source } = request;
  if (typeof action !== "string" || action.length === 0 || action.length > MAX_APPROVAL_ACTION) {
    throw new ApprovalError("invalid_approval", `the action must be 1-${MAX_APPROVAL_ACTION} characters`);
  }
  if (action.includes("\u0000")) throw new ApprovalError("invalid_approval", "the action must not contain a NUL character");
  if (typeof request.agent === "string" && request.agent.includes("\u0000")) {
    throw new ApprovalError("invalid_approval", "the agent must not contain a NUL character");
  }
  const payloadJson = canonicalJson(request.payload);
  const agent = agentOf(request.agent);
  const at = now.toISOString();
  return store.transaction(() => {
    const id = Number(
      store
        .prepare("INSERT INTO approvals (requesting_agent, requesting_session, action, payload_json, requested_at, status) VALUES (?, ?, ?, ?, ?, 'pending')")
        .run(agent, sessionId, action, payloadJson, at).lastInsertRowid,
    );
    appendEvent(store, "approval_requested", { sessionId, taskId: null }, { id, action, source, agent: namedAgent(request.agent) }, at);
    recordNotification(
      store,
      {
        source: "kernel:approval",
        title: clip(`Approval ${id}: ${action}`, 199),
        body: `${agent} (session ${sessionId}) asks to: ${action}\nThe exact payload: studio approvals. Decide: studio approve ${id} once, or studio deny ${id}.`,
        sessionId,
      },
      now,
    );
    return getApproval(store, id) as ApprovalRow;
  });
}

/** Approval `id`, or `undefined`. */
export function getApproval(store: Store, id: number): ApprovalRow | undefined {
  return store.prepare<[number], ApprovalRow>(`SELECT ${COLUMNS} FROM approvals WHERE id = ?`).get(id);
}

/** `row` with its payload parsed. */
export function approvalView(row: ApprovalRow): ApprovalView {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = row.payload_json;
  }
  const { payload_json: _raw, ...rest } = row;
  return { ...rest, payload };
}

/** Every pending approval (oldest first); with `all`, then the decided ones (newest first, at most `MAX_DECIDED_LIST`). */
export function listApprovals(store: Store, opts: { readonly all?: boolean } = {}): ApprovalView[] {
  const pending = store.prepare<[], ApprovalRow>(`SELECT ${COLUMNS} FROM approvals WHERE status = 'pending' ORDER BY id`).all();
  const decided =
    opts.all === true
      ? store.prepare<[number], ApprovalRow>(`SELECT ${COLUMNS} FROM approvals WHERE status <> 'pending' ORDER BY id DESC LIMIT ?`).all(MAX_DECIDED_LIST)
      : [];
  return [...pending, ...decided].map(approvalView);
}

export interface DecisionInput {
  readonly id: number;
  readonly decision: ApprovalDecision;
  /** Phase 2: always `owner`. */
  readonly by: string;
}

/** The agent the decision's message is addressed to: the requesting session's agent (`null` for a session with none). */
function messageAgent(store: Store, row: ApprovalRow): string | null {
  if (row.requesting_session !== null) {
    const session = store.prepare<[number], { agent: string | null }>("SELECT agent FROM sessions WHERE id = ?").get(row.requesting_session);
    if (session !== undefined) return session.agent === "" ? null : session.agent;
  }
  return row.requesting_agent === UNKNOWN_AGENT ? null : row.requesting_agent;
}

/**
 * The owner's decision on a pending approval: `once` (approved) or `deny`
 * (denied). In one transaction: the row (`decided_by`, `decided_at`), one
 * `approval_decided` event (`{id, decision, by, action}`) and one queued
 * `message` event `{text: "<approved|denied> approval <id>: <action>", agent,
 * approval_id}` (`sourceRef: approval:<id>`). Returns the decided row.
 *
 * Throws `ApprovalError`, writing nothing: `always_not_supported` for
 * `always` (phase 3, per playbook), `no_such_approval`, `approval_not_pending`.
 */
export function decideApproval(store: Store, input: DecisionInput, now: Date): ApprovalRow {
  const { id, decision, by } = input;
  if (decision === "always") throw new ApprovalError("always_not_supported", ALWAYS_REFUSED);
  if (decision !== "once" && decision !== "deny") throw new ApprovalError("invalid_approval", `decision ${JSON.stringify(decision)} must be once or deny`);
  const at = now.toISOString();
  return store.transaction(() => {
    const row = getApproval(store, id);
    if (row === undefined) throw new ApprovalError("no_such_approval", `no approval ${id}`);
    if (row.status !== "pending") throw new ApprovalError("approval_not_pending", `approval ${id} is not pending (it is ${row.status})`);
    const status: ApprovalStatus = decision === "once" ? "approved" : "denied";
    const changed = store
      .prepare("UPDATE approvals SET status = ?, decision = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, decision, by, at, id).changes;
    if (changed !== 1) throw new ApprovalError("approval_not_pending", `approval ${id} is not pending`);
    appendEvent(store, "approval_decided", { sessionId: row.requesting_session, taskId: null }, { id, decision, by, action: row.action }, at);
    enqueueEvent(
      store,
      {
        kind: "message",
        payload: { text: `${status} approval ${id}: ${row.action}`, agent: messageAgent(store, row), approval_id: id },
        sourceRef: `approval:${id}`,
      },
      now,
    );
    return getApproval(store, id) as ApprovalRow;
  });
}

export interface RailCall {
  /** The session's agent (`null` for none). */
  readonly agent: string | null;
  readonly sessionId: number;
  readonly action: string;
  /** The exact payload (`classifyToolCall`'s). */
  readonly payload: unknown;
  /** The tool name, for the `approval_used` event. */
  readonly tool: string;
}

/** What the rail does with an outward call: run it on grant `id` (consumed now), or hold it as new approval `id`. */
export type RailOutcome = { readonly kind: "granted"; readonly id: number } | { readonly kind: "held"; readonly id: number };

/**
 * The rail's check-and-consume for one outward call, in one transaction.
 * An unused one-shot grant matches when it is `approved`/`once`, came from
 * the rail (`approval_requested` with `source: "rail"`; an agent's own
 * `kernel_approval_request` never grants a tool call), its payload is exactly
 * this call's (canonical JSON), and it is the same requester: for a named
 * agent, the same agent name AND a requesting session that ran that agent;
 * for a session with no agent, the same session. The oldest match is consumed
 * with one `approval_used` event (`{id, tool}`, linked to this session). With
 * no match, the call is held: `requestApproval` with `source: "rail"`.
 */
export function holdOrUseGrant(store: Store, call: RailCall, now: Date): RailOutcome {
  const payloadJson = canonicalJson(call.payload);
  const agent = namedAgent(call.agent);
  return store.transaction((): RailOutcome => {
    const requester =
      agent !== null
        ? "a.requesting_agent = ? AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = a.requesting_session AND s.agent = ?)"
        : "a.requesting_agent = ? AND a.requesting_session = ?";
    const grant = store
      .prepare<[string, string, string | number], number>(
        `SELECT a.id FROM approvals a
          WHERE a.status = 'approved' AND a.decision = 'once' AND a.payload_json = ? AND ${requester}
            AND EXISTS (SELECT 1 FROM events r WHERE r.kind = 'approval_requested'
                         AND json_extract(r.payload_json, '$.id') = a.id AND json_extract(r.payload_json, '$.source') = 'rail')
            AND NOT EXISTS (SELECT 1 FROM events u WHERE u.kind = 'approval_used' AND json_extract(u.payload_json, '$.id') = a.id)
          ORDER BY a.id LIMIT 1`,
      )
      .pluck()
      .get(payloadJson, agent ?? UNKNOWN_AGENT, agent ?? call.sessionId);
    if (grant !== undefined) {
      appendEvent(store, "approval_used", { sessionId: call.sessionId, taskId: null }, { id: grant, tool: call.tool }, now.toISOString());
      return { kind: "granted", id: grant };
    }
    const row = requestApproval(store, { agent: call.agent, sessionId: call.sessionId, action: call.action, payload: call.payload, source: "rail" }, now);
    return { kind: "held", id: row.id };
  });
}
