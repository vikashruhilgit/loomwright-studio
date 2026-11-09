// The open card's history as sentences (phase 7 item 03, reworked by the board-words item): each of the
// response's events is a kind, an actor and one sentence, never the stored JSON.
//
// - `task_created` reads `Created “<title>” · state <state>`; `task_updated` reads `Changed <fields> · state <state>`
//   (the state part only when the event carries one). These are the two payload shapes `kernel_task_create` and
//   `kernel_task_update` write. An event kind with no sentence here reads `<kind> recorded`: its payload is NOT
//   shown, so no JSON object can reach the screen.
// - `pr_state_changed` (the PR tracker's one event per change, phase 8 item 10) reads
//   `PR #<pr>: <from> → <to> · CI <ci> · approvals <n>`, with ` · reason <reason>` when the event carries one and `opened`
//   for a `from` of `null`. Only the payload keys the tracker writes are read (`pr`, `from`, `to`, `ci`, `approvals`,
//   `reason`); a part whose field is missing or the wrong type is left out. `approvals` is the count the tracker records
//   (not the repo policy's `n/N` word, which the event does not carry).
// - The actor is the agent of the event's session (from the history's sessions, else the card's `creator_agent`
//   when the session is the card's `creator_session`: that session is not in the history's sessions), `kernel`
//   when the event has no session, else `session #N`.
//
// Every string an event carries (a title, a state, a field name, a kind, an agent) is untrusted: it passes
// through `printable` and is shown as a text child only.
//
// Plain TypeScript: no React.
import type { EventFrame, SessionSummary, TaskBoardItem } from "../../api/contract";
import { printable } from "../approvals/printable";

/** One event as a history line. */
export interface HistoryLine {
  readonly id: number;
  /** The session the event happened under, or `null`: the open card links it. */
  readonly session: number | null;
  /** The event kind, escaped. */
  readonly kind: string;
  /** Who it happened under, escaped: an agent, `kernel`, or `session #N`. */
  readonly actor: string;
  readonly time: string;
  /** One sentence, escaped and cut to size. */
  readonly sentence: string;
}

/** What the actor is looked up in: the history's sessions and the card's creator. */
export interface HistoryContext {
  readonly sessions: readonly Pick<SessionSummary, "id" | "agent">[];
  readonly card: Pick<TaskBoardItem, "creator_agent" | "creator_session">;
}

const SENTENCE_LIMIT = 240;

/** `HH:MM:SS` in the owner's locale; empty when not a time. */
function secondsText(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
}

function fieldOf(payload: unknown, name: string): unknown {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>)[name] : undefined;
}

/** A payload field that is a string with something in it, escaped; else `undefined`. */
function textOf(payload: unknown, name: string): string | undefined {
  const value = fieldOf(payload, name);
  return typeof value === "string" && value.trim() !== "" ? printable(value) : undefined;
}

function stateSuffix(payload: unknown): string {
  const state = textOf(payload, "state");
  return state === undefined ? "" : ` · state ${state}`;
}

/** A non-negative safe integer payload field, as text; else `undefined`. */
function countOf(payload: unknown, name: string): string | undefined {
  const value = fieldOf(payload, name);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
}

/** `PR #<pr>: <from> → <to> · CI <ci> · approvals <n> · reason <reason>`: each part only when the payload carries it. */
function prStateSentence(payload: unknown): string {
  const pr = countOf(payload, "pr");
  const head = pr === undefined ? "PR" : `PR #${pr}`;
  const to = textOf(payload, "to");
  // A `from` of `null` is the first read of the PR: it opened.
  const from = fieldOf(payload, "from") === null ? "opened" : textOf(payload, "from");
  const parts = [to === undefined ? `${head} changed` : `${head}: ${from === undefined ? "" : `${from} → `}${to}`];
  const ci = textOf(payload, "ci");
  if (ci !== undefined) parts.push(`CI ${ci}`);
  const approvals = countOf(payload, "approvals") ?? textOf(payload, "approvals");
  if (approvals !== undefined) parts.push(`approvals ${approvals}`);
  const reason = textOf(payload, "reason");
  if (reason !== undefined) parts.push(`reason ${reason}`);
  return parts.join(" · ");
}

/** The sentence for an event kind that has one, else `undefined`. */
function sentenceOf(kind: string, payload: unknown): string | undefined {
  if (kind === "task_created") {
    const title = textOf(payload, "title");
    return `${title === undefined ? "Created the task" : `Created “${title}”`}${stateSuffix(payload)}`;
  }
  if (kind === "task_updated") {
    const raw = fieldOf(payload, "fields");
    const fields = Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string" && f.trim() !== "").map((f) => printable(f)) : [];
    return `${fields.length === 0 ? "Changed the task" : `Changed ${fields.join(", ")}`}${stateSuffix(payload)}`;
  }
  if (kind === "pr_state_changed") return prStateSentence(payload);
  return undefined;
}

/** The actor of an event: see the file comment. */
export function actorOf(event: Pick<EventFrame, "session_id">, ctx: HistoryContext): string {
  const id = event.session_id;
  if (id === null) return "kernel";
  const agent = ctx.sessions.find((s) => s.id === id)?.agent ?? (id === ctx.card.creator_session ? ctx.card.creator_agent : null);
  return agent === null || agent === undefined ? `session #${id}` : printable(agent);
}

/** One event as a history line: a sentence and an actor, never its payload. */
export function historyLine(event: EventFrame, ctx: HistoryContext): HistoryLine {
  const kind = printable(event.kind);
  const sentence = sentenceOf(event.kind, event.payload) ?? `${kind} recorded`;
  return {
    id: event.id,
    session: event.session_id,
    kind,
    actor: actorOf(event, ctx),
    time: secondsText(event.at),
    sentence: sentence.length > SENTENCE_LIMIT ? `${sentence.slice(0, SENTENCE_LIMIT)} … (cut)` : sentence,
  };
}
