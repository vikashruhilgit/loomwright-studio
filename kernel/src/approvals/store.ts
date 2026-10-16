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
// A rail approval held from a playbook session (phase 3) may instead be
// approved `always`: the approved/always row IS the standing grant (grant id =
// approval id, no separate store). It lets exactly that payload through for
// the same named agent, from sessions of the same playbook at the same
// version, while that version is still the playbook's current one, until the
// owner revokes it. Each use is an `approval_grant_used` event and a revoke an
// `approval_grant_revoked` event (again no new column, no new migration). It
// never covers a tool in `ALWAYS_HELD_TOOLS`.
//
// The `studio` CLI loads this feature, so this module imports only kernel
// modules that never load the Agent SDK.
import { appendEvent, clip } from "../loop/internal.js";
import { enqueueEvent } from "../loop/queue.js";
import { recordNotification } from "../notifications/record.js";
import { ALWAYS_HELD_TOOLS } from "../sessions/policy.js";
import type { Store } from "../store/store.js";

/** `approvals.status`. */
export const APPROVAL_STATUSES = ["pending", "approved", "denied"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** `approvals.decision`. `always` is written only for a rail approval held from a playbook session (a standing grant). */
export const APPROVAL_DECISIONS = ["once", "always", "deny"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Where an approval came from: the kernel's rail (a held tool call) or an agent's `kernel_approval_request`. */
export type ApprovalSource = "rail" | "tool";

/** The audit `events.kind` values this feature writes. */
export const APPROVAL_AUDIT_KINDS = ["approval_requested", "approval_decided", "approval_used", "approval_grant_used", "approval_grant_revoked"] as const;

/** `requesting_agent` for a session with no agent (migration 11: `NOT NULL`). */
export const UNKNOWN_AGENT = "unknown";

/** The one decider in phase 2 (the CLI and API are the owner's). */
export const OWNER = "owner";

/**
 * Why `always` is refused, in general (ARCHITECTURE: "Always allow" is stored
 * per playbook, never globally). Each refusal's own `message` says which
 * condition failed; this is the CLI's text when an answer carries none.
 */
export const ALWAYS_REFUSED = "always needs an approval the rail held from a playbook session";

export const MAX_APPROVAL_ACTION = 200;
/** `kernel_approval_request`'s payload, as JSON, at most this many characters. The rail stores a held call's payload whole. */
export const MAX_REQUEST_PAYLOAD_JSON = 64_000;
/** `listApprovals` with `all`: at most this many decided approvals (newest first), after every pending one. */
export const MAX_DECIDED_LIST = 500;

/** A refusal: nothing was written. */
export class ApprovalError extends Error {
  readonly code: "no_such_approval" | "approval_not_pending" | "always_not_supported" | "invalid_approval" | "no_such_grant" | "grant_revoked";

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
  /** The requesting session's playbook (`playbooks.id`, migration 13) when it had one, else null. */
  readonly playbook: number | null;
}

/**
 * The playbook an approval came from: its id, its slug (`playbooks.slug`) and
 * the version the requesting session ran (the `approval_requested` event's
 * `playbook_version`; null when the session recorded none).
 */
export interface ApprovalPlaybook {
  readonly id: number;
  readonly slug: string | null;
  readonly version: number | null;
}

/** An approval as the API and CLI show it: the row with its payload parsed (the stored text when it is not JSON) and its playbook (null for none). */
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
  readonly playbook: ApprovalPlaybook | null;
}

const COLUMNS = "id, requesting_agent, requesting_session, action, payload_json, requested_at, status, decision, decided_by, decided_at, playbook";

/** The `approval_requested` event's payload text for approval `id`, as SQL over the approvals alias `a`. */
const REQUESTED_EVENT = "SELECT r.payload_json FROM events r WHERE r.kind = 'approval_requested' AND json_extract(r.payload_json, '$.id') = a.id ORDER BY r.id LIMIT 1";

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
 * it joins it). When the requesting session's row has a `playbook`, the row
 * records it (`approvals.playbook`) and the event adds `playbook` and
 * `playbook_version` (the session's, null when it recorded none); a session
 * with no playbook writes neither. Returns the row. Throws `ApprovalError` (`invalid_approval`)
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
    const session = store
      .prepare<[number], { playbook: number | null; playbook_version: number | null }>("SELECT playbook, playbook_version FROM sessions WHERE id = ?")
      .get(sessionId);
    const playbook = session?.playbook ?? null;
    const id = Number(
      store
        .prepare("INSERT INTO approvals (requesting_agent, requesting_session, action, payload_json, requested_at, status, playbook) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
        .run(agent, sessionId, action, payloadJson, at, playbook).lastInsertRowid,
    );
    const requested: Record<string, unknown> = { id, action, source, agent: namedAgent(request.agent) };
    if (playbook !== null) {
      requested.playbook = playbook;
      requested.playbook_version = session?.playbook_version ?? null;
    }
    appendEvent(store, "approval_requested", { sessionId, taskId: null }, requested, at);
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

/** Stored JSON text parsed, or the text itself when it is not JSON. */
function parsed(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return json;
  }
}

/** Approval `id`'s playbook: its slug and the version its `approval_requested` event recorded. */
function approvalPlaybook(store: Store, row: ApprovalRow): ApprovalPlaybook | null {
  if (row.playbook === null) return null;
  const found = store
    .prepare<[number, number], { slug: string | null; version: number | null }>(
      `SELECT (SELECT slug FROM playbooks WHERE id = ?) AS slug,
              json_extract((${REQUESTED_EVENT}), '$.playbook_version') AS version
         FROM approvals a WHERE a.id = ?`,
    )
    .get(row.playbook, row.id);
  return { id: row.playbook, slug: found?.slug ?? null, version: typeof found?.version === "number" ? found.version : null };
}

/** `row` with its payload parsed and its playbook (`{id, slug, version}`, or null) read from the store. */
export function approvalView(store: Store, row: ApprovalRow): ApprovalView {
  const { payload_json: raw, playbook: _id, ...rest } = row;
  return { ...rest, payload: parsed(raw), playbook: approvalPlaybook(store, row) };
}

/** Every pending approval (oldest first); with `all`, then the decided ones (newest first, at most `MAX_DECIDED_LIST`). */
export function listApprovals(store: Store, opts: { readonly all?: boolean } = {}): ApprovalView[] {
  const pending = store.prepare<[], ApprovalRow>(`SELECT ${COLUMNS} FROM approvals WHERE status = 'pending' ORDER BY id`).all();
  const decided =
    opts.all === true
      ? store.prepare<[number], ApprovalRow>(`SELECT ${COLUMNS} FROM approvals WHERE status <> 'pending' ORDER BY id DESC LIMIT ?`).all(MAX_DECIDED_LIST)
      : [];
  return [...pending, ...decided].map((row) => approvalView(store, row));
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
 * Why `always` cannot be given on pending approval `row`, or `undefined` when
 * it can: the rail held it (`approval_requested.source = "rail"`), from a
 * session of a playbook (`approvals.playbook`) at a recorded version (the
 * event's `playbook_version`) that is still the playbook's current
 * `playbooks.version`, that ran a named agent (`sessions.agent`) equal to the
 * recorded `requesting_agent`, and its payload's `tool` is not in
 * `ALWAYS_HELD_TOOLS`. Each is a condition `STANDING_GRANT` matches on, so an
 * accepted `always` is a grant that can match.
 */
function alwaysRefusal(store: Store, row: ApprovalRow): string | undefined {
  const requested = store
    .prepare<[number], string>(`SELECT (${REQUESTED_EVENT}) FROM approvals a WHERE a.id = ?`)
    .pluck()
    .get(row.id);
  const event = typeof requested === "string" ? (parsed(requested) as { source?: unknown; playbook_version?: unknown } | null) : null;
  if (event?.source !== "rail") {
    return `always needs an approval the rail held: approval ${row.id} was asked for by its agent (kernel_approval_request); approve it once`;
  }
  if (row.playbook === null) return `always needs a playbook: approval ${row.id} did not come from a playbook session; approve it once`;
  if (typeof event.playbook_version !== "number") {
    return `always needs a playbook version: approval ${row.id}'s playbook session recorded none; approve it once`;
  }
  // The match joins the playbook row and needs the recorded version to be its current one (STANDING_GRANT).
  const current = store.prepare<[number], number>("SELECT version FROM playbooks WHERE id = ?").pluck().get(row.playbook);
  if (current === undefined) return `always needs the playbook: approval ${row.id}'s playbook no longer exists; approve it once`;
  if (current !== event.playbook_version) {
    return `always needs the playbook's current version: approval ${row.id} came from v${event.playbook_version}, the playbook is now v${current}; approve it once`;
  }
  const agent =
    row.requesting_session === null
      ? undefined
      : store.prepare<[number], string | null>("SELECT agent FROM sessions WHERE id = ?").pluck().get(row.requesting_session);
  const named = namedAgent(agent ?? null);
  if (named === null) return `always needs a named agent: approval ${row.id}'s session ran none; approve it once`;
  // The match needs the recorded requester and the requesting session's agent to be the same name (STANDING_GRANT).
  if (named !== row.requesting_agent) {
    return `always needs the agent it was held for: approval ${row.id} was held for ${row.requesting_agent}, its session now runs ${named}; approve it once`;
  }
  const tool = (parsed(row.payload_json) as { tool?: unknown } | null)?.tool;
  const held = ALWAYS_HELD_TOOLS.find((t) => t === tool);
  if (held !== undefined) return `always never covers ${held}: the owner decides every call to it; approve it once`;
  return undefined;
}

/**
 * The owner's decision on a pending approval: `once` or `always` (approved)
 * or `deny` (denied). In one transaction: the row (`decided_by`,
 * `decided_at`), one `approval_decided` event (`{id, decision, by, action}`)
 * and one queued `message` event `{text: "<approved|denied> approval <id>:
 * <action>", agent, approval_id}` (`sourceRef: approval:<id>`). Returns the
 * decided row. An `always` row is a standing grant (`holdOrUseGrant`).
 *
 * Throws `ApprovalError`, writing nothing: `no_such_approval`,
 * `approval_not_pending`, then, for `always`, `always_not_supported` (its
 * message says which condition `alwaysRefusal` found failing).
 */
export function decideApproval(store: Store, input: DecisionInput, now: Date): ApprovalRow {
  const { id, decision, by } = input;
  if (decision !== "once" && decision !== "always" && decision !== "deny") {
    throw new ApprovalError("invalid_approval", `decision ${JSON.stringify(decision)} must be once, always or deny`);
  }
  const at = now.toISOString();
  return store.transaction(() => {
    const row = getApproval(store, id);
    if (row === undefined) throw new ApprovalError("no_such_approval", `no approval ${id}`);
    if (row.status !== "pending") throw new ApprovalError("approval_not_pending", `approval ${id} is not pending (it is ${row.status})`);
    if (decision === "always") {
      const refused = alwaysRefusal(store, row);
      if (refused !== undefined) throw new ApprovalError("always_not_supported", refused);
    }
    const status: ApprovalStatus = decision === "deny" ? "denied" : "approved";
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
  /** The tool name, for the `approval_used` / `approval_grant_used` event (and the `ALWAYS_HELD_TOOLS` check). */
  readonly tool: string;
}

/** What the rail does with an outward call: run it on grant `id` (a one-shot one is consumed now), or hold it as new approval `id`. */
export type RailOutcome = { readonly kind: "granted"; readonly id: number } | { readonly kind: "held"; readonly id: number };

/**
 * The calling session `?`'s standing grant for this call, as SQL over the
 * approvals alias `a` (parameters: calling session, action, payload, agent,
 * agent). The approved/always row has this call's action and exact canonical
 * payload; the same requester rule as a one-shot grant for a named agent; the
 * calling session's playbook; a recorded version equal to both the calling
 * session's and the playbook's current one; the rail as source; and no
 * `approval_grant_revoked` event.
 */
const STANDING_GRANT = `SELECT a.id FROM approvals a
    JOIN sessions c ON c.id = ?
    JOIN playbooks p ON p.id = a.playbook
   WHERE a.status = 'approved' AND a.decision = 'always' AND a.action = ? AND a.payload_json = ?
     AND a.requesting_agent = ? AND EXISTS (SELECT 1 FROM sessions s WHERE s.id = a.requesting_session AND s.agent = ?)
     AND a.playbook = c.playbook
     AND json_extract((${REQUESTED_EVENT}), '$.source') = 'rail'
     AND json_extract((${REQUESTED_EVENT}), '$.playbook_version') = c.playbook_version
     AND json_extract((${REQUESTED_EVENT}), '$.playbook_version') = p.version
     AND NOT EXISTS (SELECT 1 FROM events v WHERE v.kind = 'approval_grant_revoked' AND json_extract(v.payload_json, '$.id') = a.id)
   ORDER BY a.id LIMIT 1`;

/**
 * The rail's check-and-consume for one outward call, in one transaction.
 * An unused one-shot grant matches when it is `approved`/`once`, came from
 * the rail (`approval_requested` with `source: "rail"`; an agent's own
 * `kernel_approval_request` never grants a tool call), its payload is exactly
 * this call's (canonical JSON), and it is the same requester: for a named
 * agent, the same agent name AND a requesting session that ran that agent;
 * for a session with no agent, the same session. The oldest match is consumed
 * with one `approval_used` event (`{id, tool}`, linked to this session).
 *
 * With no one-shot match, a standing grant (`STANDING_GRANT`) matches only a
 * calling session with a named agent and a playbook at a version, and never
 * a tool in `ALWAYS_HELD_TOOLS`. Its use is one `approval_grant_used` event
 * (`{id, tool}`, linked to this session); it is not consumed. With no match,
 * the call is held: `requestApproval` with `source: "rail"`.
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
    if (agent !== null && !ALWAYS_HELD_TOOLS.includes(call.tool)) {
      const standing = store
        .prepare<[number, string, string, string, string], number>(STANDING_GRANT)
        .pluck()
        .get(call.sessionId, call.action, payloadJson, agent, agent);
      if (standing !== undefined) {
        appendEvent(store, "approval_grant_used", { sessionId: call.sessionId, taskId: null }, { id: standing, tool: call.tool }, now.toISOString());
        return { kind: "granted", id: standing };
      }
    }
    const row = requestApproval(store, { agent: call.agent, sessionId: call.sessionId, action: call.action, payload: call.payload, source: "rail" }, now);
    return { kind: "held", id: row.id };
  });
}

/** A standing grant as the API and CLI show it. */
export interface GrantView {
  /** The grant's id: the approval's. */
  readonly id: number;
  /** The playbook and the version the grant was given on. */
  readonly playbook: ApprovalPlaybook;
  readonly action: string;
  /** The exact payload it lets through, parsed (the stored text when it is not JSON). */
  readonly payload: unknown;
  readonly requesting_agent: string;
  /** When the owner answered `always` (`approvals.decided_at`). */
  readonly granted_at: string | null;
  /** Whether its version is still the playbook's current one: a grant that is not current never matches. */
  readonly current: boolean;
}

interface GrantRow {
  readonly id: number;
  readonly playbook: number;
  readonly slug: string;
  readonly version: number | null;
  readonly current_version: number;
  readonly action: string;
  readonly payload_json: string;
  readonly requesting_agent: string;
  readonly decided_at: string | null;
  readonly revoked: number;
}

/** Every approved/always row with a playbook (oldest first), with whether it was revoked; `id` narrows to one. */
function grantRows(store: Store, id?: number): GrantRow[] {
  const sql = `SELECT a.id, a.playbook, p.slug, json_extract((${REQUESTED_EVENT}), '$.playbook_version') AS version, p.version AS current_version,
                      a.action, a.payload_json, a.requesting_agent, a.decided_at,
                      EXISTS (SELECT 1 FROM events v WHERE v.kind = 'approval_grant_revoked' AND json_extract(v.payload_json, '$.id') = a.id) AS revoked
                 FROM approvals a JOIN playbooks p ON p.id = a.playbook
                WHERE a.status = 'approved' AND a.decision = 'always'${id === undefined ? "" : " AND a.id = ?"}
                ORDER BY a.id`;
  const stmt = store.prepare<number[], GrantRow>(sql);
  return id === undefined ? stmt.all() : stmt.all(id);
}

function grantView(row: GrantRow): GrantView {
  const version = typeof row.version === "number" ? row.version : null;
  return {
    id: row.id,
    playbook: { id: row.playbook, slug: row.slug, version },
    action: row.action,
    payload: parsed(row.payload_json),
    requesting_agent: row.requesting_agent,
    granted_at: row.decided_at,
    current: version !== null && version === row.current_version,
  };
}

/** Every standing grant the owner has not revoked (oldest first), current or not. */
export function listGrants(store: Store): GrantView[] {
  return grantRows(store)
    .filter((r) => r.revoked === 0)
    .map(grantView);
}

export interface RevokeInput {
  readonly id: number;
  /** Phase 3: always `owner`. */
  readonly by: string;
}

/**
 * The owner revokes standing grant `id`: one `approval_grant_revoked` event
 * (`{id, by}`) in one transaction; the grant never matches again and is no
 * longer listed. Returns the grant as it was. Throws `ApprovalError`, writing
 * nothing: `no_such_grant` (no approved/always approval with a playbook has
 * that id), `grant_revoked` (it is already revoked).
 */
export function revokeGrant(store: Store, input: RevokeInput, now: Date): GrantView {
  const { id, by } = input;
  return store.transaction(() => {
    const row = grantRows(store, id)[0];
    if (row === undefined) throw new ApprovalError("no_such_grant", `no grant ${id}`);
    if (row.revoked !== 0) throw new ApprovalError("grant_revoked", `grant ${id} is already revoked`);
    appendEvent(store, "approval_grant_revoked", { sessionId: null, taskId: null }, { id, by }, now.toISOString());
    return grantView(row);
  });
}
