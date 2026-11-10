// Session and thread titles (phase 8 item 17, Part 5): the one place a title
// is derived. `GET /sessions` (`../console/output.ts`), `GET /tasks/:kind/:id`
// (`../gui/tasks.ts`) and `GET /threads/:agent` (`../console/threads.ts`) all
// read titles from here, never from a SQL copy of their own.
//
// - Derived at read time only, with no model call. No session start path
//   writes a title (so playbook-run code is untouched); the only stored title
//   is the owner's rename of a thread, `brain_threads.title` (migration 22),
//   and it wins over the derived one.
// - A session's title, first match wins: a playbook run is its playbook's
//   NAME (`sessions.playbook` → `playbooks.name`, never the bare id); a
//   session that answered a `brain_messages` row is that row's thread's title;
//   a task's session is the task's title; any other is `Session #<id>`.
// - A thread's title (`threadTitle`): the owner's rename when set; else from
//   its first row: a fresh thread started from a summary is the old thread's
//   title marked ` (continued)`; a delegation is `From <agent>: <first line>`;
//   a trigger's message `Trigger #<id>: <first line>`; an approval's
//   `Approval #<id>: <its action>`; any other message (Chat or Crew) its first
//   line. A reply is in its thread, so it carries the thread's title.
// - Every title is one line (`titleLine`): control and bidi characters
//   stripped, whitespace collapsed, at most `MAX_TITLE_CHARS` characters (a
//   longer derived line ends in `…`). Titles are untrusted text shown to the
//   owner: never fed back into a prompt, and no agent tool renames.
//
// Imports only its siblings and the store's type: the `studio` CLI loads the
// console part, so never the session manager or the Agent SDK.
import type { Store } from "../store/store.js";
import { cutChars } from "./memory.js";
import { getBrainMessage } from "./messages.js";
import type { BrainMessageRow } from "./messages.js";
import { threadIdOf, threadLinks } from "./threads.js";

/** A title's limit, in characters: a derived line past it is cut and ends in `…`; an owner's rename past it is refused. */
export const MAX_TITLE_CHARS = 80;

/** What a fresh thread's title adds to the title of the thread it was started fresh from. */
export const CONTINUED_MARK = " (continued)";

/** How many `continued_from` links a title follows before it stops (a chain of fresh starts, or a damaged loop). */
const MAX_CONTINUED_DEPTH = 8;

// C0/C1 controls, line and paragraph separators, and the bidi embedding, override and isolate marks.
const STRIPPED = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/** `text` as one line: controls and bidi marks become spaces, whitespace runs one space, trimmed. */
export function oneLine(text: string): string {
  return text.replace(STRIPPED, " ").replace(/\s+/g, " ").trim();
}

/** The first non-blank line of `text` as a title (`oneLine`), cut to `max` characters with `…`; empty when there is none. */
export function titleLine(text: string, max: number = MAX_TITLE_CHARS): string {
  const line = text.split(/\r\n|[\n\r\u0085\u2028\u2029]/).map(oneLine).find((l) => l !== "") ?? "";
  return line.length <= max ? line : `${cutChars(line, max - 1).trimEnd()}…`;
}

/** The owner's rename of `thread` (`brain_threads.title`), as one line, or null when unset (or blank). */
export function ownerTitle(store: Store, thread: number): string | null {
  const stored = store.prepare<[number], string | null>("SELECT title FROM brain_threads WHERE id = ?").pluck().get(thread);
  if (stored === undefined || stored === null) return null;
  const title = titleLine(stored);
  return title === "" ? null : title;
}

/** The `approvals.action` of approval `id`, or undefined. */
function approvalAction(store: Store, id: number): string | undefined {
  return store.prepare<[number], string>("SELECT action FROM approvals WHERE id = ?").pluck().get(id);
}

const SOURCE_ID = /^(trigger|approval):([1-9]\d{0,15})$/;

/** `label: line`, or the label alone when the line is empty, within `MAX_TITLE_CHARS`. */
function labelled(label: string, text: string): string {
  const line = titleLine(text, Math.max(1, MAX_TITLE_CHARS - label.length - 2));
  return line === "" ? label : `${label}: ${line}`;
}

/** The derived title of a thread whose first row is `first` (no rename). */
function derivedThreadTitle(store: Store, first: BrainMessageRow, depth: number): string {
  const from = threadLinks(store, first.id)?.continued_from ?? null;
  if (from !== null && from !== first.id && depth < MAX_CONTINUED_DEPTH) {
    const old = threadTitle(store, from, depth + 1);
    if (old.endsWith(CONTINUED_MARK)) return old;
    return `${titleLine(old, MAX_TITLE_CHARS - CONTINUED_MARK.length)}${CONTINUED_MARK}`;
  }
  if (first.from_agent !== null) return labelled(`From ${first.from_agent}`, first.text);
  const source = SOURCE_ID.exec(first.source);
  if (source?.[1] === "trigger") return labelled(`Trigger #${source[2]}`, first.text);
  if (source?.[1] === "approval") {
    const id = Number(source[2]);
    return labelled(`Approval #${id}`, approvalAction(store, id) ?? first.text);
  }
  const line = titleLine(first.text);
  return line === "" ? `Message #${first.id}` : line;
}

/** Thread `thread`'s title: the owner's rename when set, else derived from its first row. */
export function threadTitle(store: Store, thread: number, depth = 0): string {
  const renamed = ownerTitle(store, thread);
  if (renamed !== null) return renamed;
  const first = getBrainMessage(store, thread);
  return first === undefined ? `Thread #${thread}` : derivedThreadTitle(store, first, depth);
}

/** The title of message `row`'s session: its thread's (a reply carries its thread's title). */
export function messageTitle(store: Store, row: BrainMessageRow): string {
  return threadTitle(store, threadIdOf(store, row.id));
}

interface SessionTitleRow {
  readonly playbook: number | null;
  readonly playbook_name: string | number | null;
  readonly message: number | null;
  readonly task_title: string | null;
}

/** Session `sessionId`'s title (see the header for the order). */
export function sessionTitle(store: Store, sessionId: number): string {
  const row = store
    .prepare<[number], SessionTitleRow>(
      `SELECT s.playbook AS playbook, p.name AS playbook_name,
              (SELECT min(m.id) FROM brain_messages m WHERE m.session_id = s.id) AS message,
              (SELECT t.title FROM tasks t WHERE t.id = s.task_id OR t.owner_session_id = s.id ORDER BY t.id = s.task_id DESC, t.id LIMIT 1) AS task_title
         FROM sessions s LEFT JOIN playbooks p ON p.id = s.playbook
        WHERE s.id = ?`,
    )
    .get(sessionId);
  if (row === undefined) return `Session #${sessionId}`;
  if (row.playbook !== null) {
    const name = row.playbook_name === null ? "" : titleLine(String(row.playbook_name));
    return name === "" ? "Playbook run" : name;
  }
  if (row.message !== null) {
    const message = getBrainMessage(store, row.message);
    if (message !== undefined) return messageTitle(store, message);
  }
  const task = row.task_title === null ? "" : titleLine(row.task_title);
  return task === "" ? `Session #${sessionId}` : task;
}

/** Each row with `title` (its session's) added last, in `SessionSummary`'s order. */
export function withSessionTitles<T extends { readonly id: number }>(store: Store, rows: readonly T[]): (T & { readonly title: string })[] {
  return rows.map((row) => ({ ...row, title: sessionTitle(store, row.id) }));
}

// ---- The owner's rename -------------------------------------------------------------

/** The owner's new title as stored (`oneLine`), or why it is refused: not a string, blank, or past `MAX_TITLE_CHARS`. `null` clears the rename. */
export function renameTitleOf(value: unknown): { readonly ok: true; readonly title: string | null } | { readonly ok: false; readonly message: string } {
  if (value === null) return { ok: true, title: null };
  if (typeof value !== "string") return { ok: false, message: "title must be a string, or null to clear the rename" };
  const title = oneLine(value);
  if (title === "") return { ok: false, message: "title must not be blank" };
  if (title.length > MAX_TITLE_CHARS) return { ok: false, message: `title is ${title.length} characters; the bound is ${MAX_TITLE_CHARS}` };
  return { ok: true, title };
}

/** Store the owner's rename of `thread` (`agent`'s), or clear it with null: the thread's `brain_threads` row, created when absent. */
export function renameThread(store: Store, params: { readonly thread: number; readonly agent: string; readonly title: string | null }, at: Date): void {
  const iso = at.toISOString();
  store
    .prepare(
      `INSERT INTO brain_threads (id, agent, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
    )
    .run(params.thread, params.agent, params.title, iso, iso);
}
