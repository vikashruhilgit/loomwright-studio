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
// A held call to a tool in `KERNEL_APPLIED_ACTIONS` (a kernel tool with a
// kernel-side effect) is applied by the kernel itself when the owner approves
// it `once`: the decision runs the tool's registered applier in its own
// transaction and records the grant as used by the kernel, so the agent never
// has to repeat the call (invariant 2: the kernel owns that transition).
//
// The `studio` CLI loads this feature, so this module imports only kernel
// modules that never load the Agent SDK.
import { appendEvent, clip, errorMessage } from "../loop/internal.js";
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

/**
 * The held actions the kernel applies itself on the owner's `once` approval
 * (full SDK tool names, what a rail payload's `tool` holds). A closed set in
 * code: adding one is a code change with its own review. Every member is also
 * in `ALWAYS_HELD_TOOLS`, so `always` never reaches one, and a tool that
 * registers an applier outside this set refuses the composition
 * (`approvalApplierOf`).
 */
export const KERNEL_APPLIED_ACTIONS = ["mcp__kernel__kernel_playbook_enable"] as const;

/** The approval a kernel applier runs on. */
export interface AppliedApproval {
  readonly id: number;
  /** The requesting session (`approvals.requesting_session`). */
  readonly sessionId: number | null;
  /** The `approval_requested` event's `agent`: null when absent, never the stored `unknown`. */
  readonly agent: string | null;
  /** The `approval_requested` event's `subject_version`, null when absent. */
  readonly subjectVersion: number | null;
  /** The `approval_requested` event's id. */
  readonly requestedEventId: number;
}

/**
 * `applied`: one sentence for the agent ("The kernel enabled …"); `after` runs
 * once the decision committed (a throw is ignored). `refused`: a reason token
 * and one sentence ("The kernel did not enable …: …").
 */
export type ApprovalApplyOutcome = { readonly applied: string; readonly after?: () => void } | { readonly refused: string; readonly text: string };

/** By full tool name: `undefined` when no applier is registered for that tool. Synchronous; runs inside the decision's transaction. */
export type ApprovalApplier = (tool: string, input: unknown, approval: AppliedApproval, store: Store, now: Date) => ApprovalApplyOutcome | undefined;

/** Whether `tool` is one the kernel applies itself. */
function isKernelApplied(tool: string): boolean {
  return (KERNEL_APPLIED_ACTIONS as readonly string[]).includes(tool);
}

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
/** A held call's display text (the pre-hold check's, phase 3 item 07) is cut to this many characters, never refused. */
export const MAX_APPROVAL_DISPLAY = 4_000;
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
  /**
   * What the owner is shown about the held call besides its payload: the
   * `approval_requested` event's `display` (a pre-hold check's text, e.g. a
   * playbook enable's values and dry run). Untrusted text: the CLI escapes it.
   * Present only when the event has one.
   */
  readonly display?: string;
  /** For a kernel-applied approval the kernel applied: its sentence (the `approval_decided` event's `applied`). Present only then. */
  readonly applied?: string;
  /** For a kernel-applied approval the kernel refused to apply: the reason token. Present only then, with `apply_detail`. */
  readonly apply_refused?: string;
  /** The refusal's sentence. Untrusted text (it names a playbook): the CLI escapes it. */
  readonly apply_detail?: string;
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
  /** Shown to the owner beside the payload, on the `approval_requested` event only (never in `payload_json`); cut to `MAX_APPROVAL_DISPLAY`. */
  readonly display?: string;
  /** The version of the thing the held call is about (a playbook enable's), on the `approval_requested` event as `subject_version`. */
  readonly subjectVersion?: number;
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
 * with no playbook writes neither. A given `display` is added to the event
 * (cut to `MAX_APPROVAL_DISPLAY`) and a given `subjectVersion` as
 * `subject_version`; neither ever enters `payload_json`, so grant matching on
 * the canonical payload is unchanged. Returns the row. Throws `ApprovalError` (`invalid_approval`)
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
    if (typeof request.display === "string") requested.display = request.display.slice(0, MAX_APPROVAL_DISPLAY);
    if (typeof request.subjectVersion === "number") requested.subject_version = request.subjectVersion;
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

/** Approval `id`'s display text: its `approval_requested` event's `display`, or null when it has none. */
function approvalDisplay(store: Store, id: number): string | null {
  const display = store
    .prepare<[number], unknown>(`SELECT json_extract((${REQUESTED_EVENT}), '$.display') FROM approvals a WHERE a.id = ?`)
    .pluck()
    .get(id);
  return typeof display === "string" ? display : null;
}

/** What the kernel did with decided approval `id`, from its `approval_decided` event: only the fields that event has. */
function approvalApply(store: Store, id: number): Pick<ApprovalView, "applied" | "apply_refused" | "apply_detail"> {
  const json = store
    .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'approval_decided' AND json_extract(payload_json, '$.id') = ? ORDER BY id LIMIT 1")
    .pluck()
    .get(id);
  const decided = typeof json === "string" ? (parsed(json) as { applied?: unknown; apply_refused?: unknown; apply_detail?: unknown } | null) : null;
  if (typeof decided?.applied === "string") return { applied: decided.applied };
  if (typeof decided?.apply_refused === "string") {
    return { apply_refused: decided.apply_refused, ...(typeof decided.apply_detail === "string" ? { apply_detail: decided.apply_detail } : {}) };
  }
  return {};
}

/**
 * `row` with its payload parsed, its playbook (`{id, slug, version}`, or
 * null) and, only when its `approval_requested` event has one, its `display`,
 * read from the store; for a decided approval the kernel applied (or refused
 * to apply), its `applied` or `apply_refused` / `apply_detail`.
 */
export function approvalView(store: Store, row: ApprovalRow): ApprovalView {
  const { payload_json: raw, playbook: _id, ...rest } = row;
  const display = approvalDisplay(store, row.id);
  const apply = row.status === "pending" ? {} : approvalApply(store, row.id);
  return { ...rest, payload: parsed(raw), playbook: approvalPlaybook(store, row), ...(display === null ? {} : { display }), ...apply };
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

/** Approval `id`'s `approval_requested` event: its id and payload (an object), or null when there is none. */
function requestedEvent(store: Store, id: number): { readonly eventId: number; readonly payload: Record<string, unknown> } | null {
  const row = store
    .prepare<[number], { id: number; payload_json: string }>(
      "SELECT id, payload_json FROM events WHERE kind = 'approval_requested' AND json_extract(payload_json, '$.id') = ? ORDER BY id LIMIT 1",
    )
    .get(id);
  const payload = row === undefined ? null : parsed(row.payload_json);
  return row !== undefined && typeof payload === "object" && payload !== null ? { eventId: row.id, payload: payload as Record<string, unknown> } : null;
}

/** A rail payload's `tool` and its parsed object, or `undefined` when the payload is not an object with a string `tool`. */
function railCallOf(payload: unknown): { readonly tool: string; readonly call: Record<string, unknown> } | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
  const tool = (payload as { tool?: unknown }).tool;
  return typeof tool === "string" ? { tool, call: payload as Record<string, unknown> } : undefined;
}

/**
 * The input an agent repeats for a held rail call: its `input` (any tool but
 * Bash), or, for a Bash payload (`{tool, command, cwd}`, which has none), the
 * `{command}` the rail matched on; null when it has neither.
 */
function retryInputOf(call: Record<string, unknown>): unknown {
  if (Object.prototype.hasOwnProperty.call(call, "input")) return call.input ?? null;
  return typeof call.command === "string" ? { command: call.command } : null;
}

/** What the kernel did with a kernel-applied approval, as the `approval_decided` event records it. */
type ApplyRecord = { readonly applied: string } | { readonly apply_refused: string; readonly apply_detail: string };

/** Whether an applier's answer is one of the two outcomes. */
function isApplyOutcome(value: unknown): value is ApprovalApplyOutcome {
  if (typeof value !== "object" || value === null) return false;
  const o = value as { applied?: unknown; refused?: unknown; text?: unknown; after?: unknown };
  if (typeof o.applied === "string") return o.after === undefined || typeof o.after === "function";
  return typeof o.refused === "string" && typeof o.text === "string";
}

/**
 * Run `applier` for held call `tool` in a nested transaction (a savepoint): a
 * throw, or an answer that is neither outcome, rolls back only its writes and
 * is `apply_error`; no applier for a tool in the set is `no_applier` (fail
 * closed: the action is never handed back to the agent).
 */
function applyHeld(store: Store, applier: ApprovalApplier, tool: string, input: unknown, approval: AppliedApproval, now: Date): ApprovalApplyOutcome {
  try {
    const outcome = store.transaction(() => {
      const answer = applier(tool, input, approval, store, now);
      if (answer !== undefined && !isApplyOutcome(answer)) throw new Error("the applier answered neither applied nor refused");
      return answer;
    });
    return outcome ?? { refused: "no_applier", text: `the kernel has no applier for ${tool}; nothing was done` };
  } catch (err) {
    return { refused: "apply_error", text: `the kernel could not apply it: ${clip(errorMessage(err), 300)}` };
  }
}

/** The decision's message text (Design 2's table): what happened, and whether the agent repeats the call. */
function decisionText(row: ApprovalRow, decision: ApprovalDecision, source: unknown, record: ApplyRecord | undefined): string {
  const head = `${decision === "deny" ? "denied" : "approved"} approval ${row.id}: ${row.action}`;
  if (decision === "deny") return `${head}. Nothing was done; do not repeat the call.`;
  if (record !== undefined) return "applied" in record ? `${head}. ${record.applied} Nothing to repeat.` : `${head}. ${record.apply_detail} Do not repeat the call.`;
  const rail = source === "rail" ? railCallOf(parsed(row.payload_json)) : undefined;
  if (rail === undefined) return head;
  return `${head}. Repeat exactly this call once, unchanged: tool ${rail.tool}, input ${canonicalJson(retryInputOf(rail.call))}.`;
}

/**
 * The owner's decision on a pending approval: `once` or `always` (approved)
 * or `deny` (denied). In one transaction: the row (`decided_by`,
 * `decided_at`), one `approval_decided` event (`{id, decision, by, action}`)
 * and one queued `message` event `{text, agent, approval_id}`
 * (`sourceRef: approval:<id>`). Returns the decided row. An `always` row is a
 * standing grant (`holdOrUseGrant`).
 *
 * A `once` on a rail approval whose payload's `tool` is in
 * `KERNEL_APPLIED_ACTIONS`, with an `applier` given, is applied by the kernel
 * in the same transaction (`applyHeld`, a savepoint) and its grant recorded as
 * used: one `approval_used` event `{id, tool, by: "kernel"}` linked to the
 * requesting session, whatever the outcome. The `approval_decided` event then
 * adds `applied` (the applier's sentence) or `apply_refused` and
 * `apply_detail`. An applied outcome's `after` runs once the transaction
 * committed; its throw is ignored. With no `applier`, nothing is applied and
 * the grant is left for the agent's retry.
 *
 * The message text: `approved approval <id>: <action>.` then the applied
 * sentence and `Nothing to repeat.`, the refusal and `Do not repeat the
 * call.`, or (another approved rail approval) the exact call to repeat once;
 * an approval an agent asked for (`source: "tool"`) or a payload with no
 * string `tool` gets `approved approval <id>: <action>` alone; a deny,
 * `denied approval <id>: <action>. Nothing was done; do not repeat the call.`
 *
 * Throws `ApprovalError`, writing nothing: `no_such_approval`,
 * `approval_not_pending`, then, for `always`, `always_not_supported` (its
 * message says which condition `alwaysRefusal` found failing).
 */
export function decideApproval(store: Store, input: DecisionInput, now: Date, applier?: ApprovalApplier): ApprovalRow {
  const { id, decision, by } = input;
  if (decision !== "once" && decision !== "always" && decision !== "deny") {
    throw new ApprovalError("invalid_approval", `decision ${JSON.stringify(decision)} must be once, always or deny`);
  }
  const at = now.toISOString();
  let after: (() => void) | undefined;
  const decided = store.transaction(() => {
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
    const requested = requestedEvent(store, id);
    const source = requested?.payload.source;
    const rail = source === "rail" ? railCallOf(parsed(row.payload_json)) : undefined;
    let record: ApplyRecord | undefined;
    if (decision === "once" && requested !== null && rail !== undefined && isKernelApplied(rail.tool) && applier !== undefined) {
      const event = requested.payload;
      const approval: AppliedApproval = {
        id,
        sessionId: row.requesting_session,
        agent: typeof event.agent === "string" ? namedAgent(event.agent) : null,
        subjectVersion: typeof event.subject_version === "number" ? event.subject_version : null,
        requestedEventId: requested.eventId,
      };
      const outcome = applyHeld(store, applier, rail.tool, rail.call.input, approval, now);
      // The grant is spent by the kernel on every attempt, so no later agent call can use it.
      appendEvent(store, "approval_used", { sessionId: row.requesting_session, taskId: null }, { id, tool: rail.tool, by: "kernel" }, at);
      if ("applied" in outcome) {
        record = { applied: outcome.applied };
        after = outcome.after;
      } else {
        record = { apply_refused: outcome.refused, apply_detail: outcome.text };
      }
    }
    appendEvent(store, "approval_decided", { sessionId: row.requesting_session, taskId: null }, { id, decision, by, action: row.action, ...record }, at);
    enqueueEvent(
      store,
      {
        kind: "message",
        payload: { text: decisionText(row, decision, source, record), agent: messageAgent(store, row), approval_id: id },
        sourceRef: `approval:${id}`,
      },
      now,
    );
    return getApproval(store, id) as ApprovalRow;
  });
  if (after !== undefined) {
    try {
      after();
    } catch {
      // The decision is committed; a failed follow-up (the mirror rewrite) never fails it.
    }
  }
  return decided;
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
  /** The pre-hold check's text, stored on a NEW approval's `approval_requested` event only (`requestApproval`); never matched on. */
  readonly display?: string;
  /** The pre-hold check's subject version, likewise (`subject_version`). */
  readonly subjectVersion?: number;
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
 * the call is held: `requestApproval` with `source: "rail"` (and the call's
 * `display` / `subjectVersion`, when given). Neither of those takes part in
 * matching a grant.
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
    const row = requestApproval(
      store,
      {
        agent: call.agent,
        sessionId: call.sessionId,
        action: call.action,
        payload: call.payload,
        source: "rail",
        ...(call.display === undefined ? {} : { display: call.display }),
        ...(call.subjectVersion === undefined ? {} : { subjectVersion: call.subjectVersion }),
      },
      now,
    );
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
