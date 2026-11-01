// The open card's history as sentences (phase 7 item 03, reworked by the board-words item): each of the
// response's events is a kind, an actor and one sentence, never the stored JSON.
//
// - `task_created` reads `Created “<title>” · state <state>`; `task_updated` reads `Changed <fields> · state <state>`
//   (the state part only when the event carries one). These are the two payload shapes `kernel_task_create` and
//   `kernel_task_update` write. An event kind with no sentence here reads `<kind> recorded`: its payload is NOT
//   shown, so no JSON object can reach the screen.
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
    kind,
    actor: actorOf(event, ctx),
    time: secondsText(event.at),
    sentence: sentence.length > SENTENCE_LIMIT ? `${sentence.slice(0, SENTENCE_LIMIT)} … (cut)` : sentence,
  };
}
