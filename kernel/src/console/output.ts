// The console's session-output part (phase 5 item 03): the bounded log of
// what each session said and did (`session_output`, migration 16), the two
// session routes (`GET /sessions`, `GET /sessions/:id/output`), the throttled
// `session_output_appended` feed event, and the `studio sessions` verbs.
// `recordSessionOutput` is what the kernel calls for every SDK message
// (`SessionManagerOptions.onOutput`, wired in `kernel.ts`).
//
// Every stored string is untrusted data (invariant 3): it is stored as JSON,
// never interpreted, and the CLI escapes it with `shown` before it reaches a
// terminal. Mechanism only (invariant 1): the caps are fixed bounds, and there
// is no retention policy beyond them. See docs/architecture/session-output.md.
//
// Type-only imports of the SDK and the store: the `studio` CLI loads this
// module through the feature registry.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { payloadText, shown } from "../approvals/cli.js";
import type {
  CliApiClient,
  CliSubcommandOutput,
  ContributedRoute,
  ContributedRouteRequest,
  ContributedRouteResponse,
  ContributedSubcommand,
} from "../features/contribution.js";
import type { Store } from "../store/store.js";
import type { ConsolePart } from "./types.js";

/**
 * Every `session_output.kind`, closed in code (migration 16 has no SQL
 * CHECK): a later item adds a kind here, never in SQL. The app's contract
 * (`app/src/api/contract.ts`) mirrors it as a union.
 */
export const SESSION_OUTPUT_KINDS = Object.freeze(["assistant_text", "tool_call", "tool_decision", "tool_result", "result", "system"] as const);
export type SessionOutputKind = (typeof SESSION_OUTPUT_KINDS)[number];

export function isSessionOutputKind(value: unknown): value is SessionOutputKind {
  return typeof value === "string" && (SESSION_OUTPUT_KINDS as readonly string[]).includes(value);
}

// ---- Bounds ------------------------------------------------------------------

/** Content rows kept per session; the one `output_cut` note is written beyond it. */
export const MAX_SESSION_OUTPUT_ROWS = 2_000;
/** Content bytes kept per session: the sum of `payload_json` lengths in UTF-8 bytes. */
export const MAX_SESSION_OUTPUT_BYTES = 2 * 1024 * 1024;
/** An `assistant_text` row's `text` is cut to this many characters. */
export const ASSISTANT_TEXT_CUT = 8_000;
/** A `tool_call` row's `input_json` and a `tool_result` row's `content` are cut to this many characters. */
export const TOOL_JSON_CUT = 4_000;
/** At most one `session_output_appended` event per session per this many milliseconds. */
export const OUTPUT_FEED_INTERVAL_MS = 250;
/** The feed event kind announcing new rows: payload `{from_seq, to_seq}`. */
export const SESSION_OUTPUT_APPENDED = "session_output_appended";

/** `GET /sessions`: the default and largest `limit`. */
export const DEFAULT_SESSIONS_LIMIT = 50;
export const MAX_SESSIONS_LIMIT = 500;
/** `GET /sessions/:id/output`: the default and largest `limit` (as `GET /events`). */
export const DEFAULT_OUTPUT_LIMIT = 500;
export const MAX_OUTPUT_LIMIT = 500;
/** `studio sessions output <id> --follow`: the poll interval. */
export const FOLLOW_INTERVAL_MS = 1_000;

// ---- The recorder ------------------------------------------------------------

/** A trailing timer's handle. */
export interface OutputTimer {
  cancel(): void;
}

export interface SessionOutputRecorderDeps {
  /** The clock for `created_at`, the feed event's `at` and the throttle. Default `new Date()`. */
  readonly now?: () => Date;
  /** Arms the trailing announcement. Default: an unref'd `setTimeout`, so it never keeps the process alive. */
  readonly setTimer?: (fn: () => void, ms: number) => OutputTimer;
  /** One line about a failed write, at most once per session. Default: stderr. */
  readonly warn?: (line: string) => void;
}

export interface SessionOutputRecorder {
  /** Record one SDK message of session `sessionId`. Never throws. */
  record(store: Store, sessionId: number, message: SDKMessage): void;
}

/** A `tool_decision` event drained from `events`, waiting for its `tool_call` row. */
interface PendingDecision {
  readonly tool: string | null;
  readonly payload: unknown;
}

/** One row a message maps to, before the caps and decision matching. */
interface MappedRow {
  readonly kind: SessionOutputKind;
  readonly payload: Record<string, unknown>;
  /** A `tool_call` row's tool name (what a decision is matched on). */
  readonly tool?: string;
}

/** Per-session state, loaded from `session_output` and `events` on a session's first message. */
interface SessionState {
  nextSeq: number;
  /** Content rows (the cut note is not one). */
  rows: number;
  /** Content bytes (UTF-8 length of each `payload_json`). */
  bytes: number;
  cut: boolean;
  /** The last `events.id` the `tool_decision` drain has read past. */
  cursor: number;
  pending: PendingDecision[];
  /** Per tool name: `tool_call` rows written that have no decision yet. */
  unmatched: Map<string, number>;
  /** The last seq a `session_output_appended` event covered. */
  announcedTo: number;
  /** When that event was written (ms), `undefined` when none was. */
  lastAnnouncedAt: number | undefined;
  /** The last row written is a `result`: the state is dropped once it is announced. */
  ended: boolean;
  timer: OutputTimer | undefined;
}

function defaultSetTimer(fn: () => void, ms: number): OutputTimer {
  const t = setTimeout(fn, ms);
  t.unref();
  return { cancel: () => clearTimeout(t) };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `text` cut to `max` UTF-16 units (never splitting a surrogate pair), with the original length when cut. */
function cutText(text: string, max: number): { readonly text: string; readonly cut?: { readonly original_chars: number } } {
  if (text.length <= max) return { text };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), cut: { original_chars: text.length } };
}

function nonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** A `tool_result` block's content as text: a string as is, text blocks joined, any other block as `[<type>]`. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined || content === null ? "" : (JSON.stringify(content) ?? "");
  return content
    .map((block) => {
      const b = asRecord(block);
      if (b?.type === "text" && typeof b.text === "string") return b.text;
      return `[${typeof b?.type === "string" ? b.type : "block"}]`;
    })
    .join("\n");
}

/** Whether a message can map to a row: any other (stream events, status) returns before touching the store. */
function isRecordedType(message: SDKMessage): boolean {
  const m = asRecord(message);
  if (m === undefined) return false;
  return m.type === "assistant" || m.type === "user" || m.type === "result" || (m.type === "system" && m.subtype === "init");
}

/** The content rows one SDK message maps to, in order. The message is untrusted data: every field is checked. */
function mapMessage(message: SDKMessage): MappedRow[] {
  const m = message as unknown as Record<string, unknown>;
  if (m.type === "system" && m.subtype === "init") {
    return [{ kind: "system", payload: { subtype: "init", model: typeof m.model === "string" ? m.model : null, tool_count: Array.isArray(m.tools) ? m.tools.length : 0 } }];
  }
  if (m.type === "assistant" || m.type === "user") {
    const content = asRecord(m.message)?.content;
    if (!Array.isArray(content)) return [];
    const rows: MappedRow[] = [];
    for (const raw of content) {
      const block = asRecord(raw);
      if (block === undefined) continue;
      if (m.type === "assistant" && block.type === "text" && typeof block.text === "string") {
        rows.push({ kind: "assistant_text", payload: { ...cutText(block.text, ASSISTANT_TEXT_CUT) } });
      } else if (m.type === "assistant" && block.type === "tool_use") {
        const name = typeof block.name === "string" ? block.name : "";
        const { text, cut } = cutText(JSON.stringify(block.input ?? null) ?? "null", TOOL_JSON_CUT);
        rows.push({
          kind: "tool_call",
          payload: { tool_use_id: typeof block.id === "string" ? block.id : null, name, input_json: text, ...(cut === undefined ? {} : { cut }) },
          tool: name,
        });
      } else if (m.type === "user" && block.type === "tool_result") {
        const { text, cut } = cutText(toolResultText(block.content), TOOL_JSON_CUT);
        rows.push({
          kind: "tool_result",
          payload: {
            tool_use_id: typeof block.tool_use_id === "string" ? block.tool_use_id : null,
            is_error: block.is_error === true,
            content: text,
            ...(cut === undefined ? {} : { cut }),
          },
        });
      }
    }
    return rows;
  }
  if (m.type === "result") {
    // The budget meter's counted tokens: input + output + cache-write. Thinking and cache reads are excluded.
    const usage = asRecord(m.usage) ?? {};
    const counted = nonNegativeInt(usage.input_tokens) + nonNegativeInt(usage.output_tokens) + nonNegativeInt(usage.cache_creation_input_tokens);
    return [{ kind: "result", payload: { subtype: typeof m.subtype === "string" ? m.subtype : null, counted_tokens: counted } }];
  }
  return [];
}

const INSERT_ROW = "INSERT INTO session_output (session_id, seq, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)";
const INSERT_APPENDED = "INSERT INTO events (at, kind, actor, session_id, payload_json) VALUES (?, 'session_output_appended', 'kernel', ?, ?)";
const IS_CUT_ROW = "kind = 'system' AND json_extract(payload_json, '$.subtype') = 'output_cut'";

/** A session's state from what is on disk, so a daemon restart that resumes a session continues its log. */
function loadState(store: Store, sessionId: number): SessionState {
  const totals = store
    .prepare<[number], { max_seq: number | null; rows: number | null; bytes: number | null; cuts: number; decisions: number }>(
      `SELECT max(seq) AS max_seq,
              count(CASE WHEN NOT (${IS_CUT_ROW}) THEN 1 END) AS rows,
              sum(CASE WHEN ${IS_CUT_ROW} THEN 0 ELSE length(CAST(payload_json AS BLOB)) END) AS bytes,
              count(CASE WHEN ${IS_CUT_ROW} THEN 1 END) AS cuts,
              count(CASE WHEN kind = 'tool_decision' THEN 1 END) AS decisions
         FROM session_output WHERE session_id = ?`,
    )
    .get(sessionId);
  const decisions = totals?.decisions ?? 0;
  // Each copied decision is one row, so the cursor is the id of the last event copied. A decision drained but never
  // written (a kill mid-step, a dropped state) is after it, so it is drained again.
  const cursor =
    decisions === 0
      ? 0
      : (store
          .prepare<[number, number], number>("SELECT id FROM events WHERE kind = 'tool_decision' AND session_id = ? ORDER BY id LIMIT 1 OFFSET ?")
          .pluck()
          .get(sessionId, decisions - 1) ??
        store.prepare<[], number | null>("SELECT max(id) FROM events").pluck().get() ??
        0);
  const last = store
    .prepare<[number], { at: string; payload_json: string | null }>(
      "SELECT at, payload_json FROM events WHERE kind = 'session_output_appended' AND session_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(sessionId);
  let announcedTo = 0;
  let lastAnnouncedAt: number | undefined;
  if (last !== undefined) {
    const at = Date.parse(last.at);
    lastAnnouncedAt = Number.isFinite(at) ? at : undefined;
    try {
      announcedTo = nonNegativeInt(asRecord(JSON.parse(last.payload_json ?? "null"))?.to_seq);
    } catch {
      announcedTo = 0;
    }
  }
  return {
    nextSeq: (totals?.max_seq ?? 0) + 1,
    rows: totals?.rows ?? 0,
    bytes: totals?.bytes ?? 0,
    cut: (totals?.cuts ?? 0) > 0,
    cursor,
    pending: [],
    unmatched: new Map(),
    announcedTo,
    lastAnnouncedAt,
    ended: false,
    timer: undefined,
  };
}

/** A copy of `state` that a failed transaction can throw away. */
function draftOf(state: SessionState): SessionState {
  return { ...state, pending: [...state.pending], unmatched: new Map(state.unmatched) };
}

/**
 * A recorder of SDK messages into `session_output`, with its own per-session
 * state (keyed by store, then session id). Each message is one transaction:
 *
 * - its rows (`docs/architecture/session-output.md` lists each kind's payload);
 * - the kernel's own `tool_decision` events for the session, drained before
 *   and after the message is mapped and copied whole. A decision is written
 *   directly after the oldest `tool_call` row of its tool that has no decision
 *   yet (FIFO per tool name), whichever of the two arrived first; a decision
 *   with no call is written before the next `result` row;
 * - the caps: when the next content row would pass `MAX_SESSION_OUTPUT_ROWS`
 *   or `MAX_SESSION_OUTPUT_BYTES`, one `system` `output_cut` row is written
 *   and nothing more is kept;
 * - one `session_output_appended` event when `OUTPUT_FEED_INTERVAL_MS` has
 *   passed since the session's last one; otherwise one trailing timer
 *   announces the range when the interval is up.
 *
 * Never throws: the first failure for a session calls `warn` once, later
 * ones are silent, and the session is never failed by its log.
 */
export function createSessionOutputRecorder(deps: SessionOutputRecorderDeps = {}): SessionOutputRecorder {
  const now = deps.now ?? (() => new Date());
  const setTimer = deps.setTimer ?? defaultSetTimer;
  const warn = deps.warn ?? ((line: string) => void process.stderr.write(`${line}\n`));
  const states = new WeakMap<Store, Map<number, SessionState>>();
  const warned = new WeakMap<Store, Set<number>>();

  const sessionsOf = (store: Store): Map<number, SessionState> => {
    let map = states.get(store);
    if (map === undefined) {
      map = new Map();
      states.set(store, map);
    }
    return map;
  };

  const fail = (store: Store, sessionId: number, err: unknown): void => {
    try {
      let set = warned.get(store);
      if (set === undefined) {
        set = new Set();
        warned.set(store, set);
      }
      if (set.has(sessionId)) return;
      set.add(sessionId);
      warn(`studio: session ${sessionId} output log write failed: ${shown(errorText(err))}`);
    } catch {
      // A warn that throws must not break the session either.
    }
  };

  /** Move every new `tool_decision` event of the session into `state.pending`, oldest first. */
  const drain = (store: Store, sessionId: number, state: SessionState): void => {
    // `events` is append-only with rowid ids, so every decision at or below `top` is visible now: the cursor can
    // move to `top`, and the next drain reads only newer rows.
    const top = store.prepare<[], number | null>("SELECT max(id) FROM events").pluck().get() ?? 0;
    if (top <= state.cursor) return;
    const events = store
      .prepare<[number, number, number], { id: number; payload_json: string | null }>(
        "SELECT id, payload_json FROM events WHERE kind = 'tool_decision' AND session_id = ? AND id > ? AND id <= ? ORDER BY id",
      )
      .all(sessionId, state.cursor, top);
    for (const e of events) {
      let payload: unknown;
      try {
        payload = JSON.parse(e.payload_json ?? "null");
      } catch {
        payload = null;
      }
      const tool = asRecord(payload)?.tool;
      state.pending.push({ tool: typeof tool === "string" ? tool : null, payload });
    }
    state.cursor = top;
  };

  /** One `session_output_appended` event for every row after `announcedTo`. */
  const announce = (store: Store, sessionId: number, state: SessionState, at: Date): void => {
    store.prepare(INSERT_APPENDED).run(at.toISOString(), sessionId, JSON.stringify({ from_seq: state.announcedTo + 1, to_seq: state.nextSeq - 1 }));
    state.announcedTo = state.nextSeq - 1;
    state.lastAnnouncedAt = at.getTime();
  };

  /** Arm the session's one trailing timer: it announces what is unannounced when it fires (its own one-statement write). */
  const arm = (store: Store, sessionId: number, state: SessionState, ms: number): void => {
    let handle: OutputTimer | undefined;
    const fire = (): void => {
      const sessions = sessionsOf(store);
      const current = sessions.get(sessionId);
      if (current === undefined || current.timer !== handle) return;
      current.timer = undefined;
      try {
        if (!store.isOpen) return;
        if (current.nextSeq - 1 > current.announcedTo) announce(store, sessionId, current, now());
        if (current.ended) sessions.delete(sessionId);
      } catch (err) {
        fail(store, sessionId, err);
      }
    };
    handle = setTimer(fire, Math.max(0, ms));
    state.timer = handle;
  };

  const record = (store: Store, sessionId: number, message: SDKMessage): void => {
    try {
      if (!isRecordedType(message)) return;
      const sessions = sessionsOf(store);
      let state = sessions.get(sessionId);
      if (state === undefined) {
        state = loadState(store, sessionId);
        sessions.set(sessionId, state);
      }
      // Cut: nothing more is kept, and nothing touches the store.
      if (state.cut) return;
      const at = now();
      const atIso = at.toISOString();
      const draft = draftOf(state);
      const outcome = store.transaction((): { readonly cancel: boolean; readonly armIn: number | undefined } => {
        const firstSeq = draft.nextSeq;
        const insert = store.prepare(INSERT_ROW);
        /** Write one content row; `false` once the log is cut (the cut note is written here, beyond the caps). */
        const put = (kind: SessionOutputKind, payload: unknown): boolean => {
          if (draft.cut) return false;
          const json = JSON.stringify(payload) ?? "null";
          const size = Buffer.byteLength(json, "utf8");
          const overRows = draft.rows + 1 > MAX_SESSION_OUTPUT_ROWS;
          if (overRows || draft.bytes + size > MAX_SESSION_OUTPUT_BYTES) {
            insert.run(sessionId, draft.nextSeq++, "system", JSON.stringify({ subtype: "output_cut", reason: overRows ? "rows" : "bytes" }), atIso);
            draft.cut = true;
            draft.pending = [];
            draft.unmatched.clear();
            draft.ended = false;
            return false;
          }
          insert.run(sessionId, draft.nextSeq++, kind, json, atIso);
          draft.rows += 1;
          draft.bytes += size;
          draft.ended = kind === "result";
          return true;
        };
        /** Write the oldest pending decision for `tool`; `undefined` when none is pending. */
        const putDecisionFor = (tool: string): boolean | undefined => {
          const i = draft.pending.findIndex((d) => d.tool === tool);
          if (i < 0) return undefined;
          const [decision] = draft.pending.splice(i, 1);
          return put("tool_decision", (decision as PendingDecision).payload);
        };

        drain(store, sessionId, draft);
        const rows = mapMessage(message);
        drain(store, sessionId, draft);
        // Decisions whose calls an earlier message recorded: directly after those rows, before this message's.
        for (const [tool, count] of [...draft.unmatched]) {
          let left = count;
          while (left > 0 && !draft.cut && putDecisionFor(tool) !== undefined) left -= 1;
          if (left === 0) draft.unmatched.delete(tool);
          else draft.unmatched.set(tool, left);
        }
        for (const row of rows) {
          if (draft.cut) break;
          if (row.kind === "result") {
            // A decision whose call never arrived is kept, before the result.
            while (draft.pending.length > 0 && !draft.cut) put("tool_decision", (draft.pending.shift() as PendingDecision).payload);
          }
          if (!put(row.kind, row.payload)) break;
          if (row.kind === "tool_call" && row.tool !== undefined && putDecisionFor(row.tool) === undefined) {
            draft.unmatched.set(row.tool, (draft.unmatched.get(row.tool) ?? 0) + 1);
          }
        }
        if (draft.nextSeq === firstSeq) return { cancel: false, armIn: undefined };
        const elapsed = draft.lastAnnouncedAt === undefined ? Number.POSITIVE_INFINITY : at.getTime() - draft.lastAnnouncedAt;
        if (elapsed >= OUTPUT_FEED_INTERVAL_MS) {
          announce(store, sessionId, draft, at);
          return { cancel: true, armIn: undefined };
        }
        return { cancel: false, armIn: OUTPUT_FEED_INTERVAL_MS - elapsed };
      });
      // Committed: the draft is the state now (the timer is not part of the transaction).
      const timer = state.timer;
      Object.assign(state, draft, { timer });
      if (outcome.cancel && state.timer !== undefined) {
        state.timer.cancel();
        state.timer = undefined;
      }
      if (outcome.armIn !== undefined && state.timer === undefined) arm(store, sessionId, state, outcome.armIn);
      // A finished turn, fully announced: drop the state (it is reloaded from disk if the session goes on).
      if (state.ended && state.timer === undefined && state.announcedTo === state.nextSeq - 1) sessions.delete(sessionId);
    } catch (err) {
      fail(store, sessionId, err);
    }
  };

  return { record };
}

const defaultRecorder = createSessionOutputRecorder();

/**
 * Record one SDK message of session `sessionId` into `session_output`, through
 * the kernel's default recorder (`createSessionOutputRecorder()`: the real
 * clock, an unref'd timer, warnings on stderr). The session manager calls it
 * for every message as its `onOutput` observer. It never throws: a failing
 * store warns once per session and never fails the session, so the manager
 * writes no `observer_error` for it.
 */
export function recordSessionOutput(store: Store, sessionId: number, message: SDKMessage): void {
  defaultRecorder.record(store, sessionId, message);
}

// ---- Routes ------------------------------------------------------------------

/** One `GET /sessions` entry (the contract's `SessionSummary`). */
export interface SessionSummary {
  readonly id: number;
  readonly agent: string | null;
  readonly status: string;
  readonly model: string | null;
  readonly started: string | null;
  readonly ended: string | null;
  readonly tokens: number | null;
  readonly cwd: string | null;
  readonly playbook: number | null;
}

/** One `GET /sessions/:id/output` row (the contract's `SessionOutputRow`). Every string in `payload` is untrusted. */
export interface SessionOutputRow {
  readonly id: number;
  readonly session_id: number;
  readonly seq: number;
  readonly kind: SessionOutputKind;
  readonly payload: unknown;
  readonly created_at: string;
}

const POSITIVE_ID = /^[1-9]\d{0,15}$/;
const COUNT = /^(0|[1-9]\d{0,15})$/;

/** A query integer in `[min, max]`: `fallback` when absent, `undefined` when malformed or out of range. */
function queryInt(raw: string | undefined, fallback: number, min: number, max: number): number | undefined {
  if (raw === undefined) return fallback;
  if (!COUNT.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined;
}

const INVALID_QUERY: ContributedRouteResponse = Object.freeze({ status: 400, body: { error: "invalid_query" } });

/** `GET /sessions?status=<s>&limit=<n>`: newest first. */
async function listSessions(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const limit = queryInt(req.query.limit, DEFAULT_SESSIONS_LIMIT, 1, MAX_SESSIONS_LIMIT);
  if (limit === undefined) return INVALID_QUERY;
  const status = req.query.status;
  const sessions = req.store
    .prepare<unknown[], SessionSummary>(
      `SELECT s.id, s.agent, s.status, s.model, s.started_at AS started, s.ended_at AS ended,
              (SELECT sum(b.counted_tokens) FROM budget b WHERE b.session_id = s.id) AS tokens,
              s.cwd, s.playbook
         FROM sessions s ${status === undefined ? "" : "WHERE s.status = ?"}
        ORDER BY s.id DESC LIMIT ?`,
    )
    .all(...(status === undefined ? [] : [status]), limit);
  return { status: 200, body: { sessions } };
}

/** `GET /sessions/:id/output?after=<seq>&limit=<n>`: in `seq` order, `payload` parsed. */
async function sessionOutput(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const raw = req.params.id ?? "";
  const id = Number(raw);
  if (!POSITIVE_ID.test(raw) || !Number.isSafeInteger(id)) return { status: 400, body: { error: "invalid_id" } };
  const after = queryInt(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = queryInt(req.query.limit, DEFAULT_OUTPUT_LIMIT, 1, MAX_OUTPUT_LIMIT);
  if (after === undefined || limit === undefined) return INVALID_QUERY;
  const exists = req.store.prepare<[number], number>("SELECT 1 FROM sessions WHERE id = ?").pluck().get(id);
  if (exists === undefined) return { status: 404, body: { error: "not_found" } };
  const rows = req.store
    .prepare<[number, number, number], { id: number; session_id: number; seq: number; kind: SessionOutputKind; payload_json: string; created_at: string }>(
      "SELECT id, session_id, seq, kind, payload_json, created_at FROM session_output WHERE session_id = ? AND seq > ? ORDER BY seq LIMIT ?",
    )
    .all(id, after, limit)
    .map((row): SessionOutputRow => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        payload = null;
      }
      // The contract's field order.
      return { id: row.id, session_id: row.session_id, seq: row.seq, kind: row.kind, payload, created_at: row.created_at };
    });
  return { status: 200, body: { rows } };
}

export const sessionOutputRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "GET", path: "/sessions", handler: listSessions },
  { method: "GET", path: "/sessions/:id/output", handler: sessionOutput },
]);

// ---- The `studio sessions` subcommand -------------------------------------------

export const SESSIONS_HELP = "studio sessions [--json] | output <id> [--follow]";

/** A stored value for a terminal: a string escaped with `shown`, a number or boolean as is, `-` for none, anything else as escaped JSON. */
function field(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return shown(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return shown(JSON.stringify(value) ?? "-");
}

function cutNote(payload: Record<string, unknown>): string {
  const original = asRecord(payload.cut)?.original_chars;
  return original === undefined ? "" : ` [cut from ${field(original)} chars]`;
}

/** One stored row as one terminal line. Every stored string goes through `shown` (or `payloadText`). */
export function formatOutputRow(row: Partial<SessionOutputRow>): string {
  const p = asRecord(row.payload) ?? {};
  const head = `${field(row.seq)}  ${field(row.kind)}`;
  switch (row.kind) {
    case "assistant_text":
      return `${head}  ${typeof p.text === "string" ? shown(p.text) : "-"}${cutNote(p)}`;
    case "tool_call":
      return `${head}  ${field(p.name)} ${field(p.input_json)}${cutNote(p)}`;
    case "tool_decision": {
      const extra = [
        p.approval_id === undefined ? "" : `  approval ${field(p.approval_id)}`,
        p.category === undefined ? "" : `  category ${field(p.category)}`,
        p.command === undefined ? "" : `  command ${field(p.command)}`,
      ].join("");
      return `${head}  ${field(p.tool)} ${field(p.decision)} (${field(p.reason)})${extra}`;
    }
    case "tool_result":
      return `${head}  ${field(p.tool_use_id)}${p.is_error === true ? " error" : ""} ${field(p.content)}${cutNote(p)}`;
    case "result":
      return `${head}  ${field(p.subtype)}  tokens ${field(p.counted_tokens)}`;
    case "system":
      if (p.subtype === "output_cut") return `${head}  output cut (${field(p.reason)}): nothing more is kept`;
      return `${head}  ${field(p.subtype)}  model ${field(p.model)}  tools ${field(p.tool_count)}`;
    default:
      // A kind this CLI does not know: its payload as escaped JSON data, on one line.
      return `${head}  ${payloadText(row.payload).split("\n").join(" ")}`;
  }
}

/** One `GET /sessions` entry as one terminal line. Every stored string goes through `shown`. */
export function formatSessionLine(s: Partial<SessionSummary>): string {
  return (
    `#${field(s.id)}  ${field(s.status)}  agent ${field(s.agent)}  model ${field(s.model)}  started ${field(s.started)}` +
    `  ended ${field(s.ended)}  tokens ${field(s.tokens)}  playbook ${field(s.playbook)}  cwd ${field(s.cwd)}`
  );
}

/** Bidi controls, C1 controls and DEL: JSON leaves them raw, so `--json` escapes them as `\uNNNN` (still valid JSON). */
const JSON_UNSAFE = /[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** `value` as pretty JSON a terminal can show safely (JSON already escapes the C0 controls). */
function safeJson(value: unknown): string {
  return (JSON.stringify(value, null, 2) ?? "null").replace(JSON_UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** A refusal's error code, safe to print. */
function errorOf(body: unknown): string {
  const error = asRecord(body)?.error;
  return typeof error === "string" ? shown(error) : "unknown";
}

/** An API refusal or unreadable answer: one stderr line, exit 1. */
class ApiRefusal extends Error {}

async function getList(client: CliApiClient, path: string, key: "rows" | "sessions"): Promise<unknown[]> {
  const res = await client.request("GET", path);
  if (res.status !== 200) throw new ApiRefusal(`studio: kernel API answered ${res.status} to GET ${shown(path)}: ${errorOf(res.body)}`);
  const list = asRecord(res.body)?.[key];
  if (!Array.isArray(list)) throw new ApiRefusal(`studio: kernel API sent an unreadable answer to GET ${shown(path)}`);
  return list;
}

export interface FollowOptions {
  /** Keep polling while the session is starting or running. */
  readonly follow: boolean;
  /** The poll interval. Default `FOLLOW_INTERVAL_MS`. */
  readonly intervalMs?: number;
  /** Waits `ms`. Default a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Print every output row of session `id`, one line each, then (with
 * `follow`) poll `GET /sessions/:id/output?after=<last>` every `intervalMs`.
 * It stops once the session is in neither `GET /sessions?status=starting`
 * nor `GET /sessions?status=running` and a final read returns no rows.
 * Resolves to the exit code: 0, or 1 after one escaped stderr line for an API
 * refusal. A request that gets no answer rejects (the CLI prints it, exit 1).
 */
export async function followSessionOutput(client: CliApiClient, out: CliSubcommandOutput, id: number, options: FollowOptions): Promise<number> {
  const intervalMs = options.intervalMs ?? FOLLOW_INTERVAL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let after = 0;
  /** Print every row after `after`, page by page; the number printed. */
  const readAll = async (): Promise<number> => {
    let printed = 0;
    for (;;) {
      const rows = (await getList(client, `/sessions/${id}/output?after=${after}&limit=${MAX_OUTPUT_LIMIT}`, "rows")) as Partial<SessionOutputRow>[];
      for (const row of rows) {
        out.stdout.write(`${formatOutputRow(row)}\n`);
        if (typeof row.seq === "number" && row.seq > after) after = row.seq;
      }
      printed += rows.length;
      if (rows.length < MAX_OUTPUT_LIMIT) return printed;
    }
  };
  const live = async (): Promise<boolean> => {
    for (const status of ["starting", "running"]) {
      const sessions = (await getList(client, `/sessions?status=${status}&limit=${MAX_SESSIONS_LIMIT}`, "sessions")) as Partial<SessionSummary>[];
      if (sessions.some((s) => s.id === id)) return true;
    }
    return false;
  };
  try {
    await readAll();
    if (!options.follow) return 0;
    for (;;) {
      if (!(await live())) {
        // Not starting or running: one last read, and stop once it brings nothing new.
        if ((await readAll()) === 0) return 0;
        continue;
      }
      await sleep(intervalMs);
      await readAll();
    }
  } catch (err) {
    if (!(err instanceof ApiRefusal)) throw err;
    out.stderr.write(`${err.message}\n`);
    return 1;
  }
}

function usage(out: CliSubcommandOutput): number {
  out.stderr.write(`usage: ${SESSIONS_HELP}\n`);
  return 2;
}

/** `studio sessions [--json]` and `studio sessions output <id> [--follow]`. */
async function runSessions(args: readonly string[], client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
  if (args[0] === "output") {
    const raw = args[1];
    const rest = args.slice(2);
    const id = raw !== undefined && POSITIVE_ID.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(id) || rest.length > 1 || (rest.length === 1 && rest[0] !== "--follow")) return usage(out);
    return followSessionOutput(client, out, id, { follow: rest.length === 1 });
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) return usage(out);
  const path = `/sessions?limit=${MAX_SESSIONS_LIMIT}`;
  let sessions: unknown[];
  try {
    sessions = await getList(client, path, "sessions");
  } catch (err) {
    if (!(err instanceof ApiRefusal)) throw err;
    out.stderr.write(`${err.message}\n`);
    return 1;
  }
  if (args[0] === "--json") {
    out.stdout.write(`${safeJson({ sessions })}\n`);
    return 0;
  }
  out.stdout.write(sessions.length === 0 ? "no sessions\n" : `${(sessions as Partial<SessionSummary>[]).map(formatSessionLine).join("\n")}\n`);
  return 0;
}

export const sessionsSubcommand: ContributedSubcommand = Object.freeze({ name: "sessions", help: SESSIONS_HELP, run: runSessions });

/** The output part: the two session routes and the `studio sessions` verbs. */
export const outputPart: ConsolePart = Object.freeze({
  name: "output",
  tools: Object.freeze([]),
  routes: sessionOutputRoutes,
  handlers: Object.freeze({}),
  subcommands: Object.freeze([sessionsSubcommand]),
});
