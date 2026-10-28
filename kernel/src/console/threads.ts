// The console's threads part (phase 5 item 06): one agent's thread for the
// app's Chat and Crew views, its brain messages interleaved with one-line
// cards for what the kernel did about that agent.
//
//   GET /threads/:agent[?before=<cursor>][&limit=N]
//       200 {items, next_before, pending_approvals}: the newest N items
//       (1-200, default 50) strictly older than the cursor, oldest first;
//       `next_before` is the cursor for the page before this one, null once
//       the oldest item is in this page; `pending_approvals` is every
//       pending approval the agent requested, oldest first
//       400 invalid_limit / invalid_before; 404 no_such_agent
//
// An item is a message (`{type: "message", …brain_messages row}`, every row
// the agent received or sent) or an event card (`{type: "event", id, at,
// kind, summary, ref}`, one `events` row of a kind in `THREAD_EVENT_KINDS`
// tied to the agent). Both sources share one order, `(at, type, id)`.
//
// Mechanism only (invariant 1), and read-only. Payloads and stored names are
// untrusted data (invariant 3): a summary reads only typed fields, and every
// stored string in it passes through `shown`. The `studio` CLI loads this
// part through the feature registry, so its value imports are modules that
// registry already loads (approvals, agents, brain, sessions' types): never
// the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the module graph).
import { getAgent } from "../agents/registry.js";
import { shown } from "../approvals/cli.js";
import { approvalView, getApproval } from "../approvals/store.js";
import type { ApprovalRow, ApprovalView } from "../approvals/store.js";
import type { BrainMessageRow } from "../brain/messages.js";
import { ASK_AGENT } from "../brain/routes.js";
import type { ContributedRoute, ContributedRouteResponse } from "../features/contribution.js";
import { TERMINAL_STATUSES, isTerminalStatus } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { emptyConsolePart } from "./types.js";
import type { ConsolePart } from "./types.js";

/** `GET /threads/:agent`'s largest `limit`. */
export const MAX_THREAD_LIMIT = 200;

/** `GET /threads/:agent`'s `limit` when none is given. */
export const DEFAULT_THREAD_LIMIT = 50;

/**
 * How an event kind names the agent it is about: `session` the event's own
 * `session_id` (that session's `sessions.agent`), `playbook` its payload's
 * `playbook_id` (`playbooks.owning_agent`), `approval` its payload's `id`
 * (`approvals.requesting_agent`), `agent` its payload's `id` (the agent
 * itself), `trigger` its payload's `trigger_id` (`triggers.owning_agent`) and
 * `owner` no agent: the event is the owner's (a connector's status), shown in
 * Wright's thread (`ASK_AGENT`) only.
 */
export type ThreadEventTie = "session" | "playbook" | "approval" | "agent" | "trigger" | "owner";

/**
 * The closed list of event kinds a thread shows, each with its tie; any
 * other kind is never a card. A `session_status` card is shown only for a
 * session starting (`to: "running"`) or ending (`to` a terminal status,
 * `isTerminalStatus`). Phase 6's four kinds are listed before their writers
 * land, so each tie is fixed now: `draft_output_recorded` (a draft-mode
 * session recorded an outward call: `{draft_output_id, tool}`, item 07),
 * `poll_item_queued` (item 04) / `poll_item_skipped` (item 05) (a poll's
 * item: at least `{playbook_id, item_ref}`) and `connector_status`
 * (`{connector_id, kind, status}`, item 03).
 */
export const THREAD_EVENT_KINDS: Readonly<Record<string, ThreadEventTie>> = Object.freeze({
  session_status: "session",
  playbook_created: "playbook",
  playbook_updated: "playbook",
  playbook_enabled: "playbook",
  playbook_disabled: "playbook",
  approval_requested: "approval",
  approval_decided: "approval",
  agent_created: "agent",
  agent_renamed: "agent",
  agent_settings_set: "agent",
  agent_status_changed: "agent",
  trigger_registered: "trigger",
  trigger_fired: "trigger",
  draft_output_recorded: "session",
  poll_item_skipped: "playbook",
  poll_item_queued: "playbook",
  connector_status: "owner",
});

/** The `session_status` targets a thread shows: the start and every end. */
const SHOWN_SESSION_STATUSES: readonly string[] = Object.freeze(["running", ...TERMINAL_STATUSES]);

/** One thread item's place in the merged order. `event` sorts before `message` at the same instant. */
interface ThreadKey {
  readonly at: string;
  readonly type: "event" | "message";
  readonly id: number;
}

/** A message item: the row, marked. */
export type ThreadMessageItem = { readonly type: "message" } & BrainMessageRow;

/** An event card: one kernel-written line about one `events` row. */
export interface ThreadEventItem {
  readonly type: "event";
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  /** One line (no newline); every stored string inside it is escaped by `shown`. */
  readonly summary: string;
  /** The row the event is about (`{session_id}`, `{playbook_id}`, `{approval_id}`, `{agent_id}`, `{trigger_id}` or `{connector_id}`; a draft's card adds `draft_output_id`), never the payload. */
  readonly ref: Readonly<Record<string, number | string | null>>;
}

export type ThreadItem = ThreadMessageItem | ThreadEventItem;

/** `GET /threads/:agent`'s answer (the contract's `ThreadResponse`). */
export interface ThreadPage {
  readonly items: readonly ThreadItem[];
  readonly next_before: string | null;
  readonly pending_approvals: readonly ApprovalView[];
}

// The `brain_messages` columns (the same list as `../brain/messages.ts`'s, typed as its `BrainMessageRow`).
const MESSAGE_COLUMNS = "id, queue_id, agent, source, text, status, session_id, reply_text, detail, created_at, updated_at, from_agent, depth, reply_to, workspace";

/** An `events` row as the thread reads it: the payload only when it is valid JSON, and the playbook's slug for a playbook kind. */
interface ThreadEventRow {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly session_id: number | null;
  readonly payload_json: string | null;
  readonly slug: string | null;
}

/** `(at, type, id)` strictly before the cursor, as SQL over the row's own time and id columns. */
function beforeCursor(atColumn: string, type: ThreadKey["type"], idColumn: string): string {
  return `(${atColumn}, '${type}', ${idColumn}) < (?, ?, ?)`;
}

const placeholders = (n: number): string => Array.from({ length: n }, () => "?").join(", ");

function kindsTiedBy(tie: ThreadEventTie): string[] {
  return Object.keys(THREAD_EVENT_KINDS).filter((kind) => THREAD_EVENT_KINDS[kind] === tie);
}

/**
 * The newest `limit` messages `agent` received or sent, before `cursor`
 * (all when null), newest first.
 */
function newestMessages(store: Store, agent: string, cursor: ThreadKey | null, limit: number): BrainMessageRow[] {
  const params: unknown[] = [agent, agent];
  let where = "(agent = ? OR from_agent = ?)";
  if (cursor !== null) {
    where += ` AND ${beforeCursor("created_at", "message", "id")}`;
    params.push(cursor.at, cursor.type, cursor.id);
  }
  return store
    .prepare<unknown[], BrainMessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM brain_messages WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params, limit);
}

/**
 * The newest `limit` events of a `THREAD_EVENT_KINDS` kind tied to `agent`,
 * before `cursor` (all when null), newest first. A payload that is not valid
 * JSON reads as null (no writer produces one; `json_extract` would throw on
 * it). The tie is the kind's; a kind with no payload tie is tied by its
 * session, so the closed list alone decides which kinds are cards.
 */
function newestEvents(store: Store, agent: string, cursor: ThreadKey | null, limit: number): ThreadEventRow[] {
  const kinds = Object.keys(THREAD_EVENT_KINDS);
  const playbookKinds = kindsTiedBy("playbook");
  const approvalKinds = kindsTiedBy("approval");
  const agentKinds = kindsTiedBy("agent");
  const triggerKinds = kindsTiedBy("trigger");
  const ownerKinds = kindsTiedBy("owner");
  const inner: unknown[] = [...kinds];
  let innerWhere = `kind IN (${placeholders(kinds.length)})`;
  if (cursor !== null) {
    innerWhere += ` AND ${beforeCursor("at", "event", "id")}`;
    inner.push(cursor.at, cursor.type, cursor.id);
  }
  const sql = `
    SELECT e.id, e.at, e.kind, e.session_id, e.pj AS payload_json,
           CASE WHEN e.kind IN (${placeholders(playbookKinds.length)})
                THEN (SELECT p.slug FROM playbooks p WHERE p.id = json_extract(e.pj, '$.playbook_id')) END AS slug
      FROM (SELECT id, at, kind, session_id, CASE WHEN json_valid(payload_json) THEN payload_json END AS pj
              FROM events WHERE ${innerWhere}) e
     WHERE (e.kind <> 'session_status' OR json_extract(e.pj, '$.to') IN (${placeholders(SHOWN_SESSION_STATUSES.length)}))
       AND CASE
             WHEN e.kind IN (${placeholders(playbookKinds.length)})
               THEN EXISTS (SELECT 1 FROM playbooks p WHERE p.id = json_extract(e.pj, '$.playbook_id') AND p.owning_agent = ?)
             WHEN e.kind IN (${placeholders(approvalKinds.length)})
               THEN EXISTS (SELECT 1 FROM approvals a WHERE a.id = json_extract(e.pj, '$.id') AND a.requesting_agent = ?)
             WHEN e.kind IN (${placeholders(agentKinds.length)})
               THEN json_extract(e.pj, '$.id') = ?
             WHEN e.kind IN (${placeholders(triggerKinds.length)})
               THEN EXISTS (SELECT 1 FROM triggers t WHERE t.id = json_extract(e.pj, '$.trigger_id') AND t.owning_agent = ?)
             WHEN e.kind IN (${placeholders(ownerKinds.length)})
               THEN ?
             ELSE EXISTS (SELECT 1 FROM sessions s WHERE s.id = e.session_id AND s.agent = ?)
           END
     ORDER BY e.at DESC, e.id DESC
     LIMIT ?`;
  const params: unknown[] = [
    ...playbookKinds,
    ...inner,
    ...SHOWN_SESSION_STATUSES,
    ...playbookKinds,
    agent,
    ...approvalKinds,
    agent,
    ...agentKinds,
    agent,
    ...triggerKinds,
    agent,
    ...ownerKinds,
    agent === ASK_AGENT ? 1 : 0,
    agent,
    limit,
  ];
  return store.prepare<unknown[], ThreadEventRow>(sql).all(...params);
}

// ---- Event summaries: one line from the kind and typed stored fields -------------

const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

/** The payload's fields; none for a null payload, one that is not an object, or text `JSON.parse` refuses (SQLite's `json_valid` may be laxer). */
function payloadOf(json: string | null): Readonly<Record<string, unknown>> {
  if (json === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return {};
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const DECISIONS: Readonly<Record<string, string>> = Object.freeze({ once: "approved once", always: "approved always", deny: "denied" });

const PLAYBOOK_VERBS: Readonly<Record<string, string>> = Object.freeze({
  playbook_created: "created",
  playbook_updated: "updated",
  playbook_enabled: "enabled",
  playbook_disabled: "disabled",
});

const POLL_ITEM_VERBS: Readonly<Record<string, string>> = Object.freeze({ poll_item_skipped: "skipped", poll_item_queued: "queued" });

/** The card for `row`: a one-line summary and the referenced row. Absent or mistyped fields fall back to a generic sentence, never a throw. */
function eventItemOf(row: ThreadEventRow): ThreadEventItem {
  const p = payloadOf(row.payload_json);
  const card = (summary: string, ref: ThreadEventItem["ref"]): ThreadEventItem => ({ type: "event", id: row.id, at: row.at, kind: row.kind, summary, ref });
  switch (THREAD_EVENT_KINDS[row.kind]) {
    case "session": {
      const session = isId(row.session_id) ? `Session ${row.session_id}` : "A session";
      if (row.kind === "draft_output_recorded") {
        const draft = isId(p.draft_output_id) ? p.draft_output_id : null;
        return card(isText(p.tool) ? `${session} recorded a draft: ${shown(p.tool)}` : `${session} recorded a draft`, { session_id: row.session_id, draft_output_id: draft });
      }
      const to = isText(p.to) ? p.to : "";
      if (to === "running") return card(`${session} started`, { session_id: row.session_id });
      const reason = isText(p.reason) ? ` (${shown(p.reason)})` : "";
      return card(isTerminalStatus(to) ? `${session} ended: ${shown(to)}${reason}` : `${session} changed status`, { session_id: row.session_id });
    }
    case "playbook": {
      const id = isId(p.playbook_id) ? p.playbook_id : null;
      const name = isText(row.slug) ? `Playbook ${shown(row.slug)}` : id !== null ? `Playbook ${id}` : "A playbook";
      const version = isId(p.version) ? ` (version ${p.version})` : "";
      const pollVerb = POLL_ITEM_VERBS[row.kind];
      if (pollVerb !== undefined) return card(isText(p.item_ref) ? `${name} ${pollVerb} item ${shown(p.item_ref)}` : `${name} ${pollVerb} an item`, { playbook_id: id });
      return card(`${name} ${PLAYBOOK_VERBS[row.kind] ?? "changed"}${version}`, { playbook_id: id });
    }
    case "approval": {
      const id = isId(p.id) ? p.id : null;
      const name = id !== null ? `Approval ${id}` : "An approval";
      const action = isText(p.action) ? `: ${shown(p.action)}` : "";
      if (row.kind === "approval_requested") return card(`${name} requested${action}`, { approval_id: id });
      const decided = isText(p.decision) ? (DECISIONS[p.decision] ?? `decided ${shown(p.decision)}`) : "decided";
      return card(`${name} ${decided}${action}`, { approval_id: id });
    }
    case "agent": {
      const id = isText(p.id) ? p.id : null;
      const name = id !== null ? `Agent ${shown(id)}` : "An agent";
      if (row.kind === "agent_created") return card(`${name} created`, { agent_id: id });
      if (row.kind === "agent_renamed") {
        return card(isText(p.old) && isText(p.new) ? `${name} renamed from ${shown(p.old)} to ${shown(p.new)}` : `${name} renamed`, { agent_id: id });
      }
      if (row.kind === "agent_settings_set") return card(isText(p.field) ? `${name} setting ${shown(p.field)} set` : `${name} settings set`, { agent_id: id });
      return card(isText(p.new) ? `${name} status set to ${shown(p.new)}` : `${name} status changed`, { agent_id: id });
    }
    case "trigger": {
      const id = isId(p.trigger_id) ? p.trigger_id : null;
      const name = id !== null ? `Trigger ${id}` : "A trigger";
      if (row.kind === "trigger_registered") return card(`${name} registered`, { trigger_id: id });
      return card(isText(p.action) ? `${name} fired (${shown(p.action)})` : `${name} fired`, { trigger_id: id });
    }
    case "owner": {
      const id = isId(p.connector_id) ? p.connector_id : null;
      const name = isText(p.kind) ? `Connector ${shown(p.kind)}` : "A connector";
      return card(isText(p.status) ? `${name}: ${shown(p.status)}` : `${name} changed status`, { connector_id: id });
    }
    default:
      // Unreachable: the query reads only closed-list kinds.
      return card(`Event ${shown(row.kind)}`, {});
  }
}

// ---- The page ---------------------------------------------------------------------

const keyOf = (item: ThreadItem): ThreadKey => ({ at: item.type === "message" ? item.created_at : item.at, type: item.type, id: item.id });

/** Negative when `a` is older than `b` in the merged order. */
function compareKeys(a: ThreadKey, b: ThreadKey): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  return a.id - b.id;
}

/** `key` as an opaque cursor: base64url of `[at, type, id]` as JSON. */
export function encodeThreadCursor(key: ThreadKey): string {
  return Buffer.from(JSON.stringify([key.at, key.type, key.id]), "utf8").toString("base64url");
}

const BASE64URL = /^[A-Za-z0-9_-]{1,1024}$/;

/** The key `raw` encodes, or `undefined` when it is not a cursor `encodeThreadCursor` could have written. */
export function decodeThreadCursor(raw: string): ThreadKey | undefined {
  if (!BASE64URL.test(raw)) return undefined;
  const bytes = Buffer.from(raw, "base64url");
  // Only the canonical spelling: Node skips stray characters and a bad tail, and invalid UTF-8 turns into U+FFFD.
  if (bytes.toString("base64url") !== raw) return undefined;
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").toString("base64url") !== raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [at, type, id] = value as unknown[];
  if (typeof at !== "string" || at === "") return undefined;
  if (type !== "event" && type !== "message") return undefined;
  if (!isId(id)) return undefined;
  return { at, type, id };
}

/** Every pending approval `agent` requested, oldest first, as the API shows one. */
function pendingApprovals(store: Store, agent: string): ApprovalView[] {
  return store
    .prepare<[string], number>("SELECT id FROM approvals WHERE status = 'pending' AND requesting_agent = ? ORDER BY id")
    .pluck()
    .all(agent)
    .map((id) => getApproval(store, id))
    .filter((row): row is ApprovalRow => row !== undefined)
    .map((row) => approvalView(store, row));
}

/**
 * The page of `agent`'s thread before `cursor` (from the newest when null):
 * the newest `limit` items in `(at, type, id)` order, returned oldest first.
 * Each source is read `limit + 1` deep, so the merged cut always knows
 * whether an older item remains.
 */
export function readThreadPage(store: Store, agent: string, cursor: ThreadKey | null, limit: number): ThreadPage {
  const messages: ThreadItem[] = newestMessages(store, agent, cursor, limit + 1).map((row) => ({ type: "message", ...row }));
  const events: ThreadItem[] = newestEvents(store, agent, cursor, limit + 1).map(eventItemOf);
  const newestFirst = [...messages, ...events].sort((a, b) => compareKeys(keyOf(b), keyOf(a)));
  const page = newestFirst.slice(0, limit).reverse();
  const oldest = page[0];
  return {
    items: page,
    next_before: newestFirst.length > limit && oldest !== undefined ? encodeThreadCursor(keyOf(oldest)) : null,
    pending_approvals: pendingApprovals(store, agent),
  };
}

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;

const threadRoute: ContributedRoute = {
  method: "GET",
  path: "/threads/:agent",
  handler: async (req): Promise<ContributedRouteResponse> => {
    const rawLimit = req.query.limit;
    if (rawLimit !== undefined && (!POSITIVE_INT.test(rawLimit) || Number(rawLimit) > MAX_THREAD_LIMIT)) {
      return { status: 400, body: { error: "invalid_limit" } };
    }
    const rawBefore = req.query.before;
    const cursor = rawBefore === undefined ? null : decodeThreadCursor(rawBefore);
    if (cursor === undefined) return { status: 400, body: { error: "invalid_before" } };
    const agent = req.params.agent;
    if (agent === undefined || (agent !== ASK_AGENT && getAgent(req.store, agent) === undefined)) {
      return { status: 404, body: { error: "no_such_agent" } };
    }
    const limit = rawLimit === undefined ? DEFAULT_THREAD_LIMIT : Number(rawLimit);
    return { status: 200, body: readThreadPage(req.store, agent, cursor, limit) };
  },
};

export const threadsPart: ConsolePart = Object.freeze({ ...emptyConsolePart("threads"), routes: Object.freeze([threadRoute]) });
