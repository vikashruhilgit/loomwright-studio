// The Tasks screen's pure model (phase 7 item 03): the ONE home of the
// state -> column mapping, the badge tones, the "Done today" filter, the feed
// refetch predicate and the words a card and its facts show.
//
// Honest status. `GET /tasks` groups by each source's own state, verbatim, and
// the three vocabularies differ: `tasks.state` is free text (the kernel defines
// no states), a playbook run has `PLAYBOOK_RUN_STATUSES` and a session has
// `SessionStatus`. The board fixes four columns (the mockup's `COLS`) and this
// module maps every state onto one of them. A badge is green (`ok`) only for
// task `done`, run `done` and session `completed`: every other word is shown as
// the kernel wrote it and is never green. An unknown state is never hidden and
// never green: it sits in Working with a neutral badge and its own word.
//
// Every string a row carries (a title, an agent, an item ref, an event payload)
// is untrusted: it passes through `printable` (the kernel's own escaping,
// imported read-only from the Approvals screen) before it is shown.
//
// Plain TypeScript: no React.
import type { EventFrame, PlaybookRun, SessionSummary, TaskBoardGroup, TaskBoardItem, TaskBoardKind, TruncatedEventFrame } from "../../api/contract";
import type { BadgeTone } from "../../components/Badge/Badge";
import { payloadText, printable } from "../approvals/printable";

// ---- columns -----------------------------------------------------------------------------

export type ColumnId = "wait" | "work" | "park" | "done";

export interface BoardColumn {
  readonly id: ColumnId;
  /** The mockup's column label. */
  readonly label: string;
  /** Said in place of the cards when the column is empty (the mockup's `none`). */
  readonly none: string;
}

/** The mockup's `COLS`, in its order. */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { id: "wait", label: "Waiting on you", none: "Nothing waits on you." },
  { id: "work", label: "Working", none: "Nothing is running." },
  { id: "park", label: "Parked", none: "Nothing is parked." },
  { id: "done", label: "Done today", none: "Nothing finished yet." },
];

/** A table with no prototype: a state word like `constructor` or `__proto__` is just an unknown word. */
function table<V>(entries: Readonly<Record<string, V>>): Readonly<Record<string, V>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, V>, entries));
}

/** `tasks.state` (free text). Anything not listed goes to Working. */
const TASK_COLUMNS = table<ColumnId>({ waiting: "wait", working: "work", parked: "park", done: "done" });

/** `PLAYBOOK_RUN_STATUSES`. */
const RUN_COLUMNS = table<ColumnId>({
  running: "work",
  parked: "park",
  done: "done",
  failed: "done",
  skipped_duplicate: "done",
  skipped_not_enabled: "done",
});

/** `SessionStatus`. `failed:auth` is paused on the token: it waits on the owner. */
const SESSION_COLUMNS = table<ColumnId>({
  "failed:auth": "wait",
  starting: "work",
  running: "work",
  interrupted: "park",
  orphaned: "park",
  completed: "done",
  failed: "done",
  stopped: "done",
  abandoned: "done",
});

/**
 * The column a card sits in: the one mapping table above. A state this app has
 * not heard of (a task's free text; a run or session status a newer kernel adds)
 * goes to Working, shown verbatim with a neutral badge.
 */
export function columnOf(item: Pick<TaskBoardItem, "kind" | "state">): ColumnId {
  const { kind, state } = item;
  if (kind === "task") {
    return TASK_COLUMNS[state] ?? "work";
  }
  if (kind === "playbook_run") return RUN_COLUMNS[state] ?? "work";
  return SESSION_COLUMNS[state] ?? "work";
}

// ---- tones -----------------------------------------------------------------------------------

/** The mockup's `STATE_BADGE`, by the state word. `done` / `completed` are not here: `toneOf` decides green. */
const TONES = table<BadgeTone>({
  waiting: "attention",
  working: "accent",
  running: "accent",
  parked: "parked",
  interrupted: "parked",
  failed: "danger",
  "failed:auth": "danger",
});

/** The one state word per source that is green: what the kernel recorded as done. */
const OK_STATE: Readonly<Record<TaskBoardKind, string>> = { task: "done", playbook_run: "done", session: "completed" };

/** The badge tone for a state: `ok` only for task `done`, run `done` and session `completed`; anything unlisted is neutral. */
export function toneOf(kind: TaskBoardKind, state: string): BadgeTone {
  if (state === OK_STATE[kind]) return "ok";
  return TONES[state] ?? "neutral";
}

// ---- today -----------------------------------------------------------------------------------

/** Whether `iso` is on the same local calendar day as `now` (ms since the epoch). A time that does not parse is not known to be earlier, so it counts. */
export function isToday(iso: string | null, now: number): boolean {
  if (iso === null) return true;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return true;
  const today = new Date(now);
  return at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate();
}

// ---- the board ---------------------------------------------------------------------------------

export interface BoardCard {
  /** `kind:id`: the React key and the focus target. Never an index. */
  readonly key: string;
  readonly item: TaskBoardItem;
  readonly column: ColumnId;
}

export interface BoardColumnView {
  readonly column: BoardColumn;
  readonly cards: readonly BoardCard[];
}

export interface Board {
  /** The four columns, always, in order. */
  readonly columns: readonly BoardColumnView[];
  /** The cards on the board (a card that finished before today is not one). */
  readonly total: number;
  /** Cards in Working. */
  readonly working: number;
  /** Cards in Waiting on you. */
  readonly waiting: number;
}

export function cardKey(item: Pick<TaskBoardItem, "kind" | "id">): string {
  return `${item.kind}:${item.id}`;
}

function timeOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** The kernel's own order: newest `updated` first, then `kind`, then `id` descending. */
function newestFirst(a: TaskBoardItem, b: TaskBoardItem): number {
  const ta = timeOf(a.updated);
  const tb = timeOf(b.updated);
  if (ta !== tb) return ta < tb ? 1 : -1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return b.id - a.id;
}

/**
 * The response's groups as the four columns. Every card lands in one column; a
 * terminal card that ended before today (local time) is not on the board. Each
 * column is newest first, as the kernel orders the rows.
 */
export function buildBoard(groups: readonly TaskBoardGroup[], now: number): Board {
  const seen = new Set<string>();
  const byColumn = new Map<ColumnId, BoardCard[]>(BOARD_COLUMNS.map((c) => [c.id, []]));
  for (const group of groups) {
    for (const item of group.items) {
      const key = cardKey(item);
      if (seen.has(key)) continue;
      const column = columnOf(item);
      if (column === "done" && !isToday(item.ended ?? item.updated, now)) continue;
      seen.add(key);
      byColumn.get(column)?.push({ key, item, column });
    }
  }
  const columns = BOARD_COLUMNS.map((column) => ({
    column,
    cards: [...(byColumn.get(column.id) ?? [])].sort((a, b) => newestFirst(a.item, b.item)),
  }));
  const count = (id: ColumnId): number => columns.find((c) => c.column.id === id)?.cards.length ?? 0;
  return { columns, total: columns.reduce((sum, c) => sum + c.cards.length, 0), working: count("work"), waiting: count("wait") };
}

/** The cards in the order J / K walk them: column by column, top to bottom. */
export function cardOrder(board: Board): BoardCard[] {
  return board.columns.flatMap((c) => c.cards);
}

// ---- the words on a card ------------------------------------------------------------------------

export const KIND_LABEL: Readonly<Record<TaskBoardKind, string>> = { task: "Task", playbook_run: "Playbook run", session: "Session" };

/** The agent, escaped, or `unknown agent`. */
export function agentText(agent: string | null): string {
  return agent === null ? "unknown agent" : printable(agent);
}

/** What the card is called: a task's title, a run's playbook name, else (a session has none) its agent and what it ran from. */
export function cardTitle(item: TaskBoardItem): string {
  if (item.title !== null && item.title.trim() !== "") return printable(item.title);
  if (item.kind === "session") return `${agentText(item.agent)} · ${item.playbook === null ? "ad hoc session" : `playbook #${item.playbook}`}`;
  return `${KIND_LABEL[item.kind]} #${item.id}`;
}

/** The kernel's state word, escaped, exactly as it came. */
export function stateText(item: Pick<TaskBoardItem, "state">): string {
  return printable(item.state);
}

/** The card button's accessible name: the mockup's `aria-label`, `Kind id: title, state`. */
export function cardLabel(item: TaskBoardItem): string {
  return `${KIND_LABEL[item.kind]} ${item.id}: ${cardTitle(item)}, ${stateText(item)}`;
}

/** `HH:MM` in the owner's locale; empty when not a time. */
export function clockText(iso: string | null): string {
  if (iso === null) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** `today 14:10`, or the date and time for an earlier day; `-` when not a time. */
export function whenText(iso: string | null, now: number): string {
  if (iso === null) return "-";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return printable(iso);
  if (isToday(iso, now)) return `today ${clockText(iso)}`;
  return `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${clockText(iso)}`;
}

/** The card's last line after the agent: `since 14:10` while it works, else the time it last changed. */
export function metaText(card: BoardCard): string {
  const { item, column } = card;
  if (column === "work") return `since ${clockText(item.started ?? item.updated)}`;
  return clockText(item.ended ?? item.updated);
}

/**
 * A one-line note for the states whose word alone is not enough. Only what the
 * mapping above states: `failed:auth` is a session paused on the token.
 */
export function reasonText(item: Pick<TaskBoardItem, "kind" | "state">): string | null {
  if (item.kind === "session" && item.state === "failed:auth") return "Paused: the subscription token was refused.";
  return null;
}

/** `14,208 tokens`, or `-` when the kernel has no count. */
export function tokensText(tokens: number | null): string {
  return tokens === null ? "-" : `${tokens.toLocaleString("en-US")} tokens`;
}

// ---- the open card's facts ------------------------------------------------------------------------

export interface Fact {
  readonly label: string;
  /** Escaped text. */
  readonly text: string;
  /** When set the value is shown as a badge of this tone (the state). */
  readonly tone?: BadgeTone;
}

/**
 * The facts for the open card, from its row and what its history carries (the
 * session's summary, the run's own row). A fact the kernel has no value for is left out, never guessed.
 */
export function factsOf(item: TaskBoardItem, now: number, session?: SessionSummary, run?: PlaybookRun): Fact[] {
  const facts: Fact[] = [];
  const add = (label: string, text: string | null | undefined, tone?: BadgeTone): void => {
    if (text === null || text === undefined || text === "") return;
    facts.push(tone === undefined ? { label, text } : { label, text, tone });
  };
  if (item.kind === "task") {
    add("State", stateText(item), toneOf(item.kind, item.state));
    add("Assignee", item.agent === null ? null : printable(item.agent));
    add("Session", item.session === null ? null : `#${item.session}`);
    add("Created", whenText(item.started, now));
    add("Updated", whenText(item.updated, now));
  } else if (item.kind === "playbook_run") {
    add("Playbook", `${cardTitle(item)}${item.playbook === null ? "" : ` (#${item.playbook})`}`);
    add("Status", stateText(item), toneOf(item.kind, item.state));
    add("Run kind", run === undefined ? null : printable(run.kind));
    add("Version", run === undefined ? null : `v${run.version}`);
    add("Tokens", item.tokens === null ? null : tokensText(item.tokens));
    add("Item", item.item_ref === null ? null : printable(item.item_ref));
    add("Revision", run?.item_revision == null ? null : printable(run.item_revision));
    add("Session", item.session === null ? null : `#${item.session}`);
    add("Started", whenText(item.started, now));
    add("Ended", item.ended === null ? (item.state === "running" ? "still running" : null) : whenText(item.ended, now));
  } else {
    add("Agent", item.agent === null ? null : printable(item.agent));
    add("Status", stateText(item), toneOf(item.kind, item.state));
    add("Model", session?.model == null ? null : printable(session.model));
    add("Playbook", item.playbook === null ? null : `#${item.playbook}`);
    add("Tokens", item.tokens === null ? null : tokensText(item.tokens));
    add("Started", whenText(item.started, now));
    add("Ended", item.ended === null ? (item.state === "running" || item.state === "starting" ? "still running" : null) : whenText(item.ended, now));
  }
  return facts;
}

// ---- the history's events -----------------------------------------------------------------------

export interface EventLine {
  readonly id: number;
  /** The event kind, escaped. */
  readonly kind: string;
  readonly time: string;
  /** The payload as escaped data on one line, cut to size; empty when there is nothing in it. */
  readonly text: string;
}

const EVENT_TEXT_LIMIT = 240;

/** `HH:MM:SS` in the owner's locale; empty when not a time. */
function secondsText(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
}

/** One event as a history line. The payload is the stored JSON, untrusted: shown as escaped data, never interpreted. */
export function eventLine(event: EventFrame): EventLine {
  const payload = event.payload;
  const empty = payload === null || payload === undefined || (typeof payload === "object" && Object.keys(payload as object).length === 0);
  const flat = empty ? "" : payloadText(payload).split("\n").map((l) => l.trim()).join(" ");
  const text = flat.length > EVENT_TEXT_LIMIT ? `${flat.slice(0, EVENT_TEXT_LIMIT)} … (cut)` : flat;
  return { id: event.id, kind: printable(event.kind), time: secondsText(event.at), text };
}

// ---- the feed -------------------------------------------------------------------------------------

type Frame = EventFrame | TruncatedEventFrame;

/** The feed event announcing new output rows: the log reads those, the board does not. */
export const SESSION_OUTPUT_APPENDED = "session_output_appended";

/** Whether an event of this kind makes the board refetch `GET /tasks`: every kind except new session output. */
export function refetchWanted(kind: string): boolean {
  return kind !== "session_output_appended";
}

/** The id of the newest event that makes the board refetch (0 when none): the screen's refetch trigger. */
export function refetchMark(eventLog: readonly Frame[]): number {
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const frame = eventLog[i];
    if (frame !== undefined && refetchWanted(frame.kind)) return frame.id;
  }
  return 0;
}

/** A truncated frame carries no `session_id`: it may be anyone's. */
function isTruncated(frame: Frame): frame is TruncatedEventFrame {
  return (frame as { truncated?: unknown }).truncated === true;
}

/**
 * Whether the open session's log should be read again: a frame above `prev` announces output for it, or the
 * log lost frames unseen (more arrived at once than it keeps, or it was reset by a wiped event table).
 * `prev` is the last event id this screen acted on, never a list length or an index.
 */
export function outputAnnounced(eventLog: readonly Frame[], prev: number, sessionId: number): boolean {
  const last = eventLog[eventLog.length - 1]?.id ?? 0;
  if (last < prev) return true;
  if (last === prev) return false;
  // Before any event has been seen (`prev` 0) the first id says nothing about what was missed.
  const first = eventLog[0]?.id;
  if (prev > 0 && first !== undefined && first > prev + 1) return true;
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const frame = eventLog[i];
    if (frame === undefined || frame.id <= prev) break;
    if (frame.kind !== SESSION_OUTPUT_APPENDED) continue;
    if (isTruncated(frame) || frame.session_id === sessionId) return true;
  }
  return false;
}

// ---- the open card's session ----------------------------------------------------------------------

/**
 * The session whose log the open card shows: a session card's own id; a task's owner or a run's session
 * (`item.session`); else, for a task a session owns through `sessions.task_id`, the running one, else the newest.
 */
export function logSessionOf(item: TaskBoardItem, sessions: readonly SessionSummary[], isLive: (status: string) => boolean): number | null {
  if (item.kind === "session") return item.id;
  if (item.session !== null) return item.session;
  const live = sessions.filter((s) => isLive(s.status)).sort((a, b) => b.id - a.id)[0];
  return (live ?? [...sessions].sort((a, b) => b.id - a.id)[0])?.id ?? null;
}
