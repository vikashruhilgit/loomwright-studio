// The Sessions screen's pure model (phase 5 item 16): the list order and
// groups, the words a row shows, the status the kernel answered, and each
// `session_output` row as one `StreamingLog` line.
//
// Honest status: every status word here is the kernel's own (`SessionStatus`
// is open, so an unknown one renders as its own text). The only words the app
// adds are for a control request still on its way (`stopping…`, `killing…`,
// `abandoning…`), never an assumed outcome.
//
// Every string a session or an output row carries (the agent, the cwd, a
// payload field) is untrusted: it passes through `printable` (the kernel's own
// escaping, imported read-only from the Approvals screen) before it is shown.
import type { SessionOutputRow, SessionStatus, SessionSummary } from "../../api/contract";
import type { StreamingLogLine } from "../../components/StreamingLog/StreamingLog";
import { payloadText, printable } from "../approvals/printable";

/** The statuses in which a session is still running: Stop and Kill apply, the log is live. */
export const LIVE_STATUSES: readonly SessionStatus[] = ["starting", "running"];

export function isLive(status: SessionStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

// ---- order and groups ---------------------------------------------------------------

/** `iso` as ms since the epoch, or `-Infinity` when absent or not a time (sorts last). */
function timeOf(iso: string | null): number {
  if (iso === null) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Newest first by `at`, then the higher id first. */
function newestFirst(a: number, b: number, idA: number, idB: number): number {
  if (a !== b) return a < b ? 1 : -1;
  return idB - idA;
}

/**
 * Running first (`starting` / `running`, newest `started` first), then every
 * other session by `ended ?? started`, newest first. Ties: the higher id first.
 */
export function sortSessions(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort((a, b) => {
    const liveA = isLive(a.status);
    const liveB = isLive(b.status);
    if (liveA !== liveB) return liveA ? -1 : 1;
    if (liveA) return newestFirst(timeOf(a.started), timeOf(b.started), a.id, b.id);
    return newestFirst(timeOf(a.ended ?? a.started), timeOf(b.ended ?? b.started), a.id, b.id);
  });
}

export type GroupId = "running" | "waiting" | "recent";

export interface SessionGroup {
  readonly id: GroupId;
  readonly label: string;
  readonly sessions: readonly SessionSummary[];
}

/**
 * The list pane's groups, in order (gui-v1.html §Sessions: "Running", "Waiting
 * on you", then the ended ones). A running session with a pending approval it
 * asked for is waiting on you; everything not running is "Recent" (an
 * `orphaned` row is not finished, so the group never says it is).
 */
export function groupSessions(sessions: readonly SessionSummary[], waiting: ReadonlySet<number>): SessionGroup[] {
  const sorted = sortSessions(sessions);
  const running = sorted.filter((s) => isLive(s.status) && !waiting.has(s.id));
  const waitingOn = sorted.filter((s) => isLive(s.status) && waiting.has(s.id));
  const recent = sorted.filter((s) => !isLive(s.status));
  return [
    { id: "running", label: `Running · ${running.length}`, sessions: running },
    { id: "waiting", label: "Waiting on you", sessions: waitingOn },
    { id: "recent", label: "Recent", sessions: recent },
  ];
}

/** The rows in display order (the groups flattened): what J / K walk. */
export function displayOrder(groups: readonly SessionGroup[]): SessionSummary[] {
  return groups.flatMap((g) => g.sessions);
}

// ---- the words on a row ---------------------------------------------------------------

/** The agent, escaped, or `unknown agent`. */
export function agentText(session: Pick<SessionSummary, "agent">): string {
  return session.agent === null ? "unknown agent" : printable(session.agent);
}

/**
 * What the session is doing. The contract carries no task for a session
 * (`SessionSummary` has none, nor does `/status`): the playbook it ran from,
 * else `ad hoc session` (a finding recorded in the evidence README).
 */
export function taskText(session: Pick<SessionSummary, "playbook">): string {
  return session.playbook === null ? "ad hoc session" : `playbook #${session.playbook}`;
}

/** `14,208 tokens`, or `—` when the kernel has no count. */
export function tokensText(tokens: number | null): string {
  return tokens === null ? "—" : `${tokens.toLocaleString("en-US")} tokens`;
}

/** A duration: `4m 07s` under an hour, `1h 02m` from there; `—` when unknown. */
export function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** The running time: live from `started` while running, `started` → `ended` otherwise. */
export function elapsedText(session: Pick<SessionSummary, "status" | "started" | "ended">, now: number): string {
  const start = timeOf(session.started);
  if (!Number.isFinite(start)) return "—";
  if (isLive(session.status)) return durationText(now - start);
  const end = timeOf(session.ended);
  return Number.isFinite(end) ? durationText(end - start) : "—";
}

// ---- status -------------------------------------------------------------------------------

export type ControlVerb = "stop" | "kill" | "abandon";

/** A control request on one session, as this window knows it. */
export type ControlState =
  | { readonly phase: "pending"; readonly verb: ControlVerb }
  /** The kernel answered a status: a 200, or a 409 `not_running` that carries the current one (`notice` then says so). */
  | { readonly phase: "answered"; readonly verb: ControlVerb; readonly status: SessionStatus; readonly reason: string | null; readonly notice?: string }
  /** The kernel (or the bridge) refused with no status: the row keeps the kernel's list status. */
  | { readonly phase: "refused"; readonly verb: ControlVerb; readonly notice: string };

const PENDING_WORD: Readonly<Record<ControlVerb, string>> = { stop: "stopping…", kill: "killing…", abandon: "abandoning…" };

export interface EffectiveStatus {
  /** The kernel's status, or the in-flight word. Unescaped: pass it to `statusView`. */
  readonly status: SessionStatus;
  readonly reason: string | null;
  readonly pending: boolean;
}

/**
 * The status a row shows. While a request is in flight: `stopping…` (never
 * `stopped`). Once answered: the answered status, for as long as the kernel's
 * list still has the session where the request found it (a list read that left
 * before the answer); then whatever the list says.
 */
export function effectiveStatus(listStatus: SessionStatus, control: ControlState | undefined): EffectiveStatus {
  if (control === undefined || control.phase === "refused") return { status: listStatus, reason: null, pending: false };
  if (control.phase === "pending") return { status: PENDING_WORD[control.verb], reason: null, pending: true };
  const unchanged = isLive(listStatus) || (control.verb === "abandon" && listStatus === "orphaned");
  if (unchanged) return { status: control.status, reason: control.reason, pending: false };
  return { status: listStatus, reason: listStatus === control.status ? control.reason : null, pending: false };
}

export interface StatusView {
  /** The status word, escaped, exactly as the kernel reports it. */
  readonly word: string;
  /** The reason, escaped, or `null`. */
  readonly reason: string | null;
  /** `failed` (any `failed…` status) or a `kill_incomplete` reason: a danger badge. */
  readonly danger: boolean;
}

/** The status as shown: the kernel's own word (never mapped to another), plus whether it is a failure. */
export function statusView(status: SessionStatus, reason: string | null): StatusView {
  return {
    word: printable(status),
    reason: reason === null ? null : printable(reason),
    danger: status === "failed" || status.startsWith("failed:") || reason === "kill_incomplete",
  };
}

/** `failed · kill_incomplete`: the word and the reason, as the log header and a danger badge say them. */
export function statusLine(view: StatusView): string {
  return view.reason === null ? view.word : `${view.word} · ${view.reason}`;
}

// ---- output rows → StreamingLog lines --------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A payload field as escaped text: a string as is, a number or boolean as text, anything else `-`. */
function field(value: unknown, keepNewlines = false): string {
  if (typeof value === "string") return printable(value, keepNewlines);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "-";
}

/** The kernel cut this field to size (`cut: {original_chars}`). */
function cutSuffix(payload: Record<string, unknown>): string {
  return payload.cut === undefined ? "" : " … (cut)";
}

/** `HH:MM:SS` in the owner's locale; empty when not a time. */
export function lineTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
}

/** A `tool_decision` row: the kernel's decision and its reason, inline. */
function decisionLine(p: Record<string, unknown>): Pick<StreamingLogLine, "kind" | "text"> {
  const tool = typeof p.tool === "string" ? `${printable(p.tool)} ` : "";
  const reason = field(p.reason);
  const command = typeof p.command === "string" ? ` · ${printable(p.command)}` : "";
  if (p.decision === "allow") return { kind: "ok", text: `${tool}allowed · ${reason}${command}` };
  if (p.decision === "deny") {
    if (p.reason === "approval_required") {
      const approval = p.approval_id === undefined ? "" : ` · approval #${field(p.approval_id)}`;
      return { kind: "error", text: `${tool}held${approval} · ${reason}${command}` };
    }
    return { kind: "error", text: `${tool}denied · ${reason}${command}` };
  }
  return { kind: "output", text: `${tool}${field(p.decision)} · ${reason}${command}` };
}

/** One stored row as one log line, keyed by the row id. Every payload string is escaped. */
export function rowToLine(row: SessionOutputRow): StreamingLogLine {
  const p = asRecord(row.payload);
  const base = { id: String(row.id), time: lineTime(row.created_at) };
  switch (row.kind) {
    case "assistant_text":
      return { ...base, kind: "prose", text: `${field(p.text, true)}${cutSuffix(p)}` };
    case "tool_call":
      return { ...base, kind: "tool", tool: field(p.name), text: `${field(p.input_json)}${cutSuffix(p)}` };
    case "tool_result":
      return { ...base, kind: p.is_error === true ? "error" : "output", text: `${field(p.content, true)}${cutSuffix(p)}` };
    case "tool_decision":
      return { ...base, ...decisionLine(p) };
    case "result":
      return { ...base, kind: p.subtype === "success" ? "ok" : "error", text: `${field(p.subtype)} · ${field(p.counted_tokens)} tokens` };
    case "system":
      if (p.subtype === "output_cut") return { ...base, kind: "output", text: `output cut (${field(p.reason)}): nothing more is kept` };
      if (p.subtype === "init") return { ...base, kind: "output", text: `init · model ${field(p.model)} · ${field(p.tool_count)} tools` };
      return { ...base, kind: "output", text: field(p.subtype) };
    default:
      // A kind this app does not know: its payload as escaped JSON data, on one line.
      return { ...base, kind: "output", text: `${printable(String(row.kind))} ${payloadText(row.payload).split("\n").join(" ")}` };
  }
}
