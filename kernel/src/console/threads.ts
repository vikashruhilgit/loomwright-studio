// The console's threads part (phase 5 item 06): one agent's thread for the
// app's Chat and Crew views, its brain messages interleaved with one-line
// cards for what the kernel did about that agent.
//
//   GET /threads/:agent[?before=<cursor>][&limit=N]
//       200 {items, next_before, pending_approvals, thread_summarize_hint_tokens, threads}: the newest N items
//       (1-200, default 50) strictly older than the cursor, oldest first;
//       `next_before` is the cursor for the page before this one, null once
//       the oldest item is in this page; `pending_approvals` is every
//       pending approval the agent requested, oldest first
//       400 invalid_limit / invalid_before; 404 no_such_agent. The body also
//       carries `thread_summarize_hint_tokens`: the agent's settings value of
//       that name (the owner's, D34), null when unset or the file is refused.
//       Phase 8 item 17: each message item also carries `thread_id` (its
//       thread's first row id), `continuation` (`resumed` / `replayed` / null)
//       and `session_title` (its session's title, `../brain/titles.ts`; null
//       when it had no session), and `threads` is one `ThreadFigures` per
//       thread a message item of the page is in, by thread id: its title (the
//       owner's rename wins), message count, the tokens its latest reply read
//       (input + cache-read + cache-write of that session's
//       `sessions.model_usage_json`, D26's counting) and, when its summary
//       file exists, the summary's size in tokens ESTIMATED as characters / 4.
//       Tokens only, never dollars (D24)
//
// Phase 8 item 17's write routes (`:thread` is a thread id: its first row's
// id; 400 invalid_thread when it is not a positive integer, 404
// no_such_thread when it names no thread of the agent):
//
//   POST /threads/:agent/:thread/summarize
//       202 {message_id, queue_id, thread, file}: queues ONE `message` event
//       and its row (source `ask`, the kernel's `summarizeText`) continuing
//       the thread's newest started row, in one transaction; the reply is
//       written to `file` (`memory/<agent>/threads/<thread>.md`). The row is
//       in the old thread: no new thread starts. 409 kill_switch_engaged /
//       agent_off / summary_exists {file} (the owner's file is never
//       overwritten) / nothing_to_summarize (no row of it had a session)
//   GET  /threads/:agent/:thread/summary
//       200 {thread, file, text, truncated}: the file as it is on disk now
//       (`truncated` null, or `{chars_cut, at_least}` past
//       `MAX_THREAD_SUMMARY_CHARS`); 404 no_summary {file}; 409
//       summary_unreadable {file, problem}
//   POST /threads/:agent/:thread/start-fresh   body {summary?, text?}
//       202 {message_id, queue_id, thread, from, file}: `summary` (the owner's
//       edit) is written to `file` first when given; then ONE `message` event
//       and its row (`text`, else `startFreshText`) start a new thread whose
//       prompt quotes the summary file, read at send time, as data; the old
//       thread is marked `summarized_into` the new one, never deleted. 400
//       invalid_body; 409 kill_switch_engaged / agent_off /
//       already_started_fresh {summarized_into} / no_summary {file} (no
//       `summary` and no file) / history_too_large {thread, size, bound} /
//       summary_unwritable {file, code}
//   POST /threads/:agent/:thread/rename   body {title}
//       200 {thread, title, renamed}: the owner's title for the thread
//       (`brain_threads.title`), one line, at most `MAX_TITLE_CHARS`; `title:
//       null` clears it back to the derived title. Writes no event and queues
//       nothing; no agent tool renames. 400 invalid_body
//
// The write routes queue `message` events through `enqueueEvent` (rename
// only stores the owner's title) and never start a session (invariant 2: the loop's handler does). The agent's
// settings (its model) are the handler's to refuse, on the row.
//
// An item is a message (`{type: "message", …brain_messages row}`, every row
// the agent received or sent) or an event card (`{type: "event", id, at,
// kind, summary, ref}`, one `events` row of a kind in `THREAD_EVENT_KINDS`
// tied to the agent). Both sources share one order, `(at, type, id)`.
//
// Mechanism only (invariant 1); `GET /threads/:agent` is read-only. Payloads and stored names are
// untrusted data (invariant 3): a summary reads only typed fields, and every
// stored string in it passes through `shown`. The `studio` CLI loads this
// part through the feature registry, so its value imports are modules that
// registry already loads (approvals, agents, brain, sessions' types): never
// the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the module graph).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgent } from "../agents/registry.js";
import { threadSummarizeHintTokens } from "../agents/settings.js";
import { isKillSwitchEngaged } from "../api/kill-switch.js";
import { shown } from "../approvals/cli.js";
import { approvalView, getApproval } from "../approvals/store.js";
import type { ApprovalRow, ApprovalView } from "../approvals/store.js";
import { memoryDir, readMemoryFile, threadSummaryRelativePath, writeThreadSummary } from "../brain/memory.js";
import { ensureBrainMessage } from "../brain/messages.js";
import type { BrainMessageRow } from "../brain/messages.js";
import { ASK_AGENT, askTextProblem } from "../brain/routes.js";
import { ownerTitle, renameThread, renameTitleOf, sessionTitle, threadTitle } from "../brain/titles.js";
import {
  MAX_THREAD_SUMMARY_CHARS,
  getMessageThread,
  latestStartedRow,
  recordStartFresh,
  recordSummaryRequest,
  referencesHistory,
  startFreshText,
  summarizeText,
  threadLinks,
  threadProblem,
} from "../brain/threads.js";
import type { Continuation } from "../brain/threads.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { enqueueEvent } from "../loop/queue.js";
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

/** What a message item adds to its row (phase 8 item 17): its thread, how its session continued it, and its session's title. */
export interface ThreadMessageFields {
  readonly thread_id: number;
  readonly continuation: Continuation | null;
  /** The title its session carries (`sessionTitle`), null when the row had no session. */
  readonly session_title: string | null;
}

/** A message item: the row, marked, then its thread fields. */
export type ThreadMessageItem = { readonly type: "message" } & BrainMessageRow & ThreadMessageFields;

/** One thread's figures in a page (phase 8 item 17), all in tokens (D24). */
export interface ThreadFigures {
  /** The thread id: its first row's. */
  readonly id: number;
  /** The agent the thread talks to (its first row's). */
  readonly agent: string;
  /** The thread's title (`threadTitle`: the owner's rename, else derived). */
  readonly title: string;
  /** Whether `title` is the owner's rename. */
  readonly renamed: boolean;
  /** How many `brain_messages` rows the thread holds. */
  readonly messages: number;
  /** Input + cache-read + cache-write tokens of the session of the thread's newest replied row (D26's counting, from its `model_usage_json`); null when none has a reading. */
  readonly latest_reply_tokens: number | null;
  /** The summary file's size in tokens, an ESTIMATE (characters / 4, rounded up); null when the thread has no summary file. */
  readonly summary_estimated_tokens: number | null;
}

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
  /** The agent's `thread_summarize_hint_tokens` setting (the owner's), null when unset. */
  readonly thread_summarize_hint_tokens: number | null;
  /** The figures of each thread a message item of `items` is in, by thread id. */
  readonly threads: readonly ThreadFigures[];
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

// ---- Thread fields and figures (phase 8 item 17) ----------------------------------

/** `row` as a message item: marked, then its thread, its continuation and its session's title. */
function messageItemOf(store: Store, row: BrainMessageRow): ThreadMessageItem {
  const thread = getMessageThread(store, row.id);
  return {
    type: "message",
    ...row,
    thread_id: thread?.thread_id ?? row.id,
    continuation: thread?.continuation ?? null,
    session_title: row.session_id === null ? null : sessionTitle(store, row.session_id),
  };
}

/** A non-negative integer token count from a stored usage field, else 0 (D26 reads a bad number as nothing). */
const tokenField = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);

/**
 * The tokens a session read: input + cache-read + cache-write over every
 * model in its `model_usage_json` (`{<model>: {inputTokens, …}}`, the SDK's
 * `result.modelUsage` as stored). Null for no reading, or text that is not
 * a JSON object.
 */
export function readTokensOf(modelUsageJson: string | null): number | null {
  if (modelUsageJson === null) return null;
  let usage: unknown;
  try {
    usage = JSON.parse(modelUsageJson) as unknown;
  } catch {
    return null;
  }
  if (typeof usage !== "object" || usage === null || Array.isArray(usage)) return null;
  let total = 0;
  for (const u of Object.values(usage as Record<string, unknown>)) {
    if (typeof u !== "object" || u === null) continue;
    const m = u as Record<string, unknown>;
    total += tokenField(m.inputTokens) + tokenField(m.cacheReadInputTokens) + tokenField(m.cacheCreationInputTokens);
  }
  return total;
}

/** The row ids of thread `thread`: its first row and every row recorded in it. */
const THREAD_ROWS = "SELECT ? AS id UNION SELECT message_id FROM brain_message_threads WHERE thread_id = ?";

/** Thread `thread`'s figures (`ThreadFigures`). */
export function threadFiguresOf(store: Store, thread: number): ThreadFigures {
  const counted = store
    .prepare<number[], { messages: number; agent: string | null; usage: string | null }>(
      `SELECT (SELECT count(*) FROM brain_messages m WHERE m.id IN (${THREAD_ROWS})) AS messages,
              (SELECT agent FROM brain_messages WHERE id = ?) AS agent,
              (SELECT s.model_usage_json FROM brain_messages m JOIN sessions s ON s.id = m.session_id
                WHERE m.id IN (${THREAD_ROWS}) AND m.reply_text IS NOT NULL ORDER BY m.id DESC LIMIT 1) AS usage`,
    )
    .get(thread, thread, thread, thread, thread) as { messages: number; agent: string | null; usage: string | null };
  const agent = counted.agent ?? ASK_AGENT;
  const read = readMemoryFile(store.dataDir, threadSummaryRelativePath(agent, thread), MAX_THREAD_SUMMARY_CHARS);
  const summaryChars = read.problem === null ? read.text.length + read.cut : null;
  return {
    id: thread,
    agent,
    title: threadTitle(store, thread),
    renamed: ownerTitle(store, thread) !== null,
    messages: counted.messages,
    latest_reply_tokens: readTokensOf(counted.usage),
    summary_estimated_tokens: summaryChars === null ? null : Math.ceil(summaryChars / 4),
  };
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
  const messages: ThreadItem[] = newestMessages(store, agent, cursor, limit + 1).map((row) => messageItemOf(store, row));
  const events: ThreadItem[] = newestEvents(store, agent, cursor, limit + 1).map(eventItemOf);
  const newestFirst = [...messages, ...events].sort((a, b) => compareKeys(keyOf(b), keyOf(a)));
  const page = newestFirst.slice(0, limit).reverse();
  const oldest = page[0];
  return {
    items: page,
    next_before: newestFirst.length > limit && oldest !== undefined ? encodeThreadCursor(keyOf(oldest)) : null,
    pending_approvals: pendingApprovals(store, agent),
    thread_summarize_hint_tokens: threadSummarizeHintTokens(store.dataDir, agent),
    threads: [...new Set(page.flatMap((item) => (item.type === "message" ? [item.thread_id] : [])))].sort((a, b) => a - b).map((thread) => threadFiguresOf(store, thread)),
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

// ---- Summarize and start fresh (phase 8 item 17) -----------------------------------

/** The route's agent and thread, or the refusal: 404 no_such_agent, 400 invalid_thread, 404 no_such_thread. */
function threadTarget(req: ContributedRouteRequest): { readonly agent: string; readonly thread: number; readonly file: string } | ContributedRouteResponse {
  const agent = req.params.agent;
  if (agent === undefined || (agent !== ASK_AGENT && getAgent(req.store, agent) === undefined)) return { status: 404, body: { error: "no_such_agent" } };
  const raw = req.params.thread ?? "";
  if (!POSITIVE_INT.test(raw) || !Number.isSafeInteger(Number(raw))) return { status: 400, body: { error: "invalid_thread" } };
  const thread = Number(raw);
  const problem = threadProblem(req.store, agent, thread);
  if (problem !== undefined) return { status: 404, body: { error: "no_such_thread", message: problem } };
  return { agent, thread, file: `memory/${threadSummaryRelativePath(agent, thread)}` };
}

/** The write routes' shared refusals, before anything is written: the kill switch, and a crew member that is off. */
function writeRefusal(req: ContributedRouteRequest, agent: string): ContributedRouteResponse | undefined {
  if (isKillSwitchEngaged(req.store)) return { status: 409, body: { error: "kill_switch_engaged" } };
  if (agent !== ASK_AGENT && getAgent(req.store, agent)?.status !== "active") return { status: 409, body: { error: "agent_off" } };
  return undefined;
}

/** Queue one owner message for `agent` and write its row (source `ask`), the queue row first. Call inside a transaction. */
function queueOwnerMessage(req: ContributedRouteRequest, agent: string, text: string, at: Date): { readonly messageId: number; readonly queueId: number } {
  const queued = enqueueEvent(req.store, { kind: "message", payload: { text, agent } }, at);
  const row = ensureBrainMessage(req.store, { queueId: queued.id, agent, source: "ask", text, fromAgent: null, depth: 0, workspace: null }, at);
  return { messageId: row.id, queueId: queued.id };
}

const summarizeRoute: ContributedRoute = {
  method: "POST",
  path: "/threads/:agent/:thread/summarize",
  handler: async (req): Promise<ContributedRouteResponse> => {
    const target = threadTarget(req);
    if (!("agent" in target)) return target;
    const { agent, thread, file } = target;
    const refused = writeRefusal(req, agent);
    if (refused !== undefined) return refused;
    if (existsSync(join(memoryDir(req.store.dataDir), threadSummaryRelativePath(agent, thread)))) return { status: 409, body: { error: "summary_exists", file } };
    const latest = latestStartedRow(req.store, thread);
    if (latest === undefined) return { status: 409, body: { error: "nothing_to_summarize", message: `no message of thread ${thread} had a session` } };
    const at = req.now();
    const queued = req.store.transaction(() => {
      const q = queueOwnerMessage(req, agent, summarizeText(agent, thread), at);
      recordSummaryRequest(req.store, { messageId: q.messageId, thread, continues: latest.id }, at);
      return q;
    });
    return { status: 202, body: { message_id: queued.messageId, queue_id: queued.queueId, thread, file } };
  },
};

const summaryRoute: ContributedRoute = {
  method: "GET",
  path: "/threads/:agent/:thread/summary",
  handler: async (req): Promise<ContributedRouteResponse> => {
    const target = threadTarget(req);
    if (!("agent" in target)) return target;
    const { agent, thread, file } = target;
    // Read now, never cached: the owner's edit on disk is what is answered.
    const read = readMemoryFile(req.store.dataDir, threadSummaryRelativePath(agent, thread), MAX_THREAD_SUMMARY_CHARS);
    if (read.problem === "missing") return { status: 404, body: { error: "no_summary", file } };
    if (read.problem !== null) return { status: 409, body: { error: "summary_unreadable", file, problem: read.problem } };
    const truncated = read.cut > 0 || read.atLeast ? { chars_cut: read.cut, at_least: read.atLeast } : null;
    return { status: 200, body: { thread, file, text: read.text, truncated } };
  },
};

/** Thrown inside start-fresh's transaction when the thread was already started fresh, to roll it back. */
class StartedFreshRace extends Error {}

const startFreshRoute: ContributedRoute = {
  method: "POST",
  path: "/threads/:agent/:thread/start-fresh",
  handler: async (req): Promise<ContributedRouteResponse> => {
    const target = threadTarget(req);
    if (!("agent" in target)) return target;
    const { agent, thread, file } = target;
    const body = req.body ?? {};
    if (typeof body !== "object" || body === null || Array.isArray(body)) return { status: 400, body: { error: "invalid_body", message: "the body must be a JSON object {summary?, text?}" } };
    const { summary, text } = body as { summary?: unknown; text?: unknown };
    if (summary !== undefined && (typeof summary !== "string" || summary.trim() === "")) return { status: 400, body: { error: "invalid_body", message: "summary must be a string that is not blank" } };
    const textProblem = text === undefined ? undefined : askTextProblem(text);
    if (textProblem !== undefined) return { status: 400, body: { error: "invalid_body", message: textProblem } };
    const refused = writeRefusal(req, agent);
    if (refused !== undefined) return refused;
    const linked = threadLinks(req.store, thread)?.summarized_into ?? null;
    if (linked !== null) return { status: 409, body: { error: "already_started_fresh", summarized_into: linked } };
    if (typeof summary === "string") {
      if (summary.length > MAX_THREAD_SUMMARY_CHARS) return { status: 409, body: { error: "history_too_large", thread, size: summary.length, bound: MAX_THREAD_SUMMARY_CHARS } };
      try {
        // The owner's edited text: the one overwrite of a summary file (an explicit owner action).
        writeThreadSummary(req.store.dataDir, agent, thread, summary, true);
      } catch (err) {
        return { status: 409, body: { error: "summary_unwritable", file, code: String((err as { code?: unknown }).code ?? "error") } };
      }
    } else if (!existsSync(join(memoryDir(req.store.dataDir), threadSummaryRelativePath(agent, thread)))) {
      return { status: 409, body: { error: "no_summary", file } };
    }
    const sized = referencesHistory(req.store, [{ thread, use: "summary" }]);
    if (!sized.ok) return { status: 409, body: { error: "history_too_large", ...sized.tooLarge } };
    const at = req.now();
    let queued: { readonly messageId: number; readonly queueId: number };
    try {
      queued = req.store.transaction(() => {
        const q = queueOwnerMessage(req, agent, typeof text === "string" ? text : startFreshText(thread), at);
        // Another start-fresh of this thread won: roll back (the row and its queue row with it).
        if (!recordStartFresh(req.store, { messageId: q.messageId, from: thread, agent }, at)) throw new StartedFreshRace();
        return q;
      });
    } catch (err) {
      if (!(err instanceof StartedFreshRace)) throw err;
      return { status: 409, body: { error: "already_started_fresh", summarized_into: threadLinks(req.store, thread)?.summarized_into ?? null } };
    }
    return { status: 202, body: { message_id: queued.messageId, queue_id: queued.queueId, thread: queued.messageId, from: thread, file } };
  },
};

const renameRoute: ContributedRoute = {
  method: "POST",
  path: "/threads/:agent/:thread/rename",
  handler: async (req): Promise<ContributedRouteResponse> => {
    const target = threadTarget(req);
    if (!("agent" in target)) return target;
    const { agent, thread } = target;
    const body = req.body ?? {};
    if (typeof body !== "object" || body === null || Array.isArray(body) || !("title" in body)) {
      return { status: 400, body: { error: "invalid_body", message: "the body must be a JSON object {title}" } };
    }
    const parsed = renameTitleOf((body as { title?: unknown }).title);
    if (!parsed.ok) return { status: 400, body: { error: "invalid_body", message: parsed.message } };
    renameThread(req.store, { thread, agent, title: parsed.title }, req.now());
    return { status: 200, body: { thread, title: threadTitle(req.store, thread), renamed: parsed.title !== null } };
  },
};

export const threadsPart: ConsolePart = Object.freeze({ ...emptyConsolePart("threads"), routes: Object.freeze([threadRoute, summarizeRoute, summaryRoute, startFreshRoute, renameRoute]) });
