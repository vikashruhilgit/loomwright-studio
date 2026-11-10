// Thread continuity's plain helpers (phase 8 item 17c, docs/DESIGN.md
// §"Thread continuity"): the `POST /ask` body a Reply or a reference chip
// sends, the reference link Copy reference writes and the composer's paste
// reads, each refusal code in plain words, the size-hint check, the thread
// grouping the list draws, the per-bridge memory of which thread was
// summarized into which, and the open thread the ⌘K commands act on. No React
// here, so each is tested on its own.
//
// Every kernel string (titles, summaries, refusal messages, file paths) is
// untrusted data (invariant 3): nothing here builds markup or an `href` from one.
import type { AskBody, AskReference, StudioBridge, ThreadFigures, ThreadItem } from "../../api/contract";
import { hintValue } from "../settings/model";

export type MessageItem = Extract<ThreadItem, { readonly type: "message" }>;

/** A thread a link names: an agent id and a thread id (its first message's). */
export interface ThreadRef {
  readonly agent: string;
  readonly thread: number;
}

// ---- the ask body ---------------------------------------------------------------------------

export interface AskInput {
  readonly text: string;
  readonly agent: string;
  readonly workspace?: string;
  /** The agent message a Reply continues. */
  readonly continues?: number;
  /** The reference chips attached. */
  readonly references?: readonly AskReference[];
}

/**
 * The `POST /ask` body. A plain send (no Reply, no chip) is exactly the body
 * sent before threads: `{text, agent[, workspace]}`, with no `continues` and no
 * `references` key at all.
 */
export function askBodyOf(input: AskInput): AskBody {
  return {
    text: input.text,
    agent: input.agent,
    ...(input.workspace === undefined ? {} : { workspace: input.workspace }),
    ...(input.continues === undefined ? {} : { continues: input.continues }),
    ...(input.references === undefined || input.references.length === 0 ? {} : { references: input.references.map((r) => ({ thread: r.thread, use: r.use })) }),
  };
}

// ---- the reference link -------------------------------------------------------------------

export const REFERENCE_PREFIX = "loomwright-studio://thread/";
const REFERENCE = /^loomwright-studio:\/\/thread\/([^/\s?#]+)\/([1-9][0-9]{0,15})$/;

/** What Copy reference writes to the clipboard: `loomwright-studio://thread/<agent>/<thread>`. */
export function referenceLink(ref: ThreadRef): string {
  return `${REFERENCE_PREFIX}${encodeURIComponent(ref.agent)}/${ref.thread}`;
}

/** The thread a pasted text names, when the whole text (trimmed) is one reference link; anything else is `undefined`. */
export function parseReference(text: string): ThreadRef | undefined {
  const match = REFERENCE.exec(text.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  const thread = Number(match[2]);
  if (!Number.isSafeInteger(thread)) return undefined;
  let agent: string;
  try {
    agent = decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
  if (agent === "" || /[\s/]/.test(agent)) return undefined;
  return { agent, thread };
}

// ---- words ---------------------------------------------------------------------------------

/** A whole number with thousands separators; never a currency. */
export function count(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** `n messages` (`1 message`). */
export function messagesText(n: number): string {
  return `${count(n)} ${n === 1 ? "message" : "messages"}`;
}

/** The first non-blank line of `text`, trimmed, at most 80 characters. */
export function firstLine(text: string | null | undefined): string {
  const line = (text ?? "").split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** A thread's title as the kernel names it; `Session #<id>` is the kernel's own fallback for any other session. */
export function threadTitle(figures: ThreadFigures | undefined, thread: number, sessionTitle?: string | null): string {
  if (figures !== undefined && figures.title.trim() !== "") return figures.title;
  if (typeof sessionTitle === "string" && sessionTitle.trim() !== "") return sessionTitle;
  return `Thread #${thread}`;
}

/** Where a refusal came from: a send, Summarize, Start fresh or a rename. */
export type RefusalContext = "send" | "summarize" | "start-fresh" | "rename";

/** A refusal as `write()` / `refusalOf()` give it, with the kernel's body when there was one. */
export interface RefusalInput {
  readonly status: number;
  readonly code: string;
  readonly text: string;
  readonly body?: unknown;
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const NOTHING = { send: "nothing was sent", summarize: "nothing was summarized", "start-fresh": "nothing started", rename: "the name is unchanged" } as const;

/**
 * A refusal in one plain sentence, never the bare code: each thread-continuity
 * code, and the unreachable kernel, has its own words; any other code keeps
 * `refusalOf`'s text (the kernel's message and its code). Sizes in
 * `history_too_large` are characters, as the kernel counts them.
 */
export function refusalWords(refusal: RefusalInput, context: RefusalContext = "send"): string {
  const nothing = NOTHING[context];
  const body = refusal.body;
  if (refusal.status === 0) {
    if (refusal.code === "bridge_failed") return `The app couldn't ask the kernel, so ${nothing}. Your text is kept; try again.`;
    return `The kernel isn't reachable, so ${nothing}. Your text is kept; try again once it's back.`;
  }
  switch (refusal.code) {
    case "continues_invalid": {
      const reason = field(body, "reason");
      if (reason === "no_such_message") return "The message you replied to isn't in the kernel any more, so nothing was sent. Cancel the reply to send this as a new topic.";
      if (reason === "other_agent") return "The message you replied to is another agent's, so this thread can't continue it. Nothing was sent; cancel the reply to send this as a new topic.";
      if (reason === "never_started") return "The message you replied to never had a session, so there is no conversation to continue. Nothing was sent; cancel the reply to send this as a new topic.";
      return "The kernel couldn't continue that thread, so nothing was sent. Cancel the reply to send this as a new topic.";
    }
    case "history_too_large": {
      const size = num(field(body, "size"));
      const bound = num(field(body, "bound"));
      const thread = num(field(body, "thread"));
      const sized = size !== undefined && bound !== undefined ? ` is ${count(size)} characters, past the kernel's limit of ${count(bound)} characters` : " is past the kernel's size limit";
      if (context === "start-fresh") return `The summary${sized}. Nothing was cut and nothing started; shorten it and try again.`;
      const what = thread === undefined ? "The history this message would carry" : `The referenced thread #${thread}`;
      return `${what}${sized}. Nothing was cut and nothing was sent. Remove the reference, or attach its summary instead.`;
    }
    case "already_started_fresh":
      return "This thread was already summarized and continued in a new thread, so nothing started. Reply still continues this one.";
    case "summary_exists":
      return "A summary of this thread already exists, so a new one wasn't written.";
    case "no_summary":
      return "This thread has no summary yet, so nothing started. Summarize it first.";
    case "nothing_to_summarize":
      return "No message of this thread has had a session yet, so there is nothing to summarize.";
    case "summary_unreadable":
      return `The summary file can't be read, so ${nothing}. Check the file and try again.`;
    case "summary_unwritable":
      return "The summary file couldn't be written, so nothing started. Check the file and try again.";
    case "agent_off":
      return `This agent is off, so ${nothing}. Turn it on in Team first.`;
    case "kill_switch_engaged":
      return `The kill switch is engaged, so ${nothing}. Release it first.`;
    case "workspace_not_listed": {
      const message = field(body, "message");
      const said = typeof message === "string" && message.trim() !== "" ? ` The kernel says: ${message}.` : "";
      return `That workspace isn't one this agent may use, so nothing was sent. Pick another workspace.${said}`;
    }
    case "no_such_thread":
      return `That thread isn't in the kernel, so ${nothing}.`;
    default:
      return refusal.text;
  }
}

// ---- the size hint --------------------------------------------------------------------------

/**
 * The owner's size hint from a thread answer's `thread_summarize_hint_tokens`, when set: Settings' rule (`hintValue`,
 * a positive safe integer as the kernel's schema has it), so Chat and Settings → Threads agree on what is set.
 */
export function hintFromThreads(value: unknown): number | null {
  return hintValue(value) ?? null;
}

/** A thread is past the hint when the tokens its latest reply read are more than the hint. Unset never highlights. */
export function pastHint(figures: ThreadFigures | undefined, hint: number | null): boolean {
  if (hint === null || figures === undefined || figures.latest_reply_tokens === null) return false;
  return figures.latest_reply_tokens > hint;
}

// ---- threads in the list --------------------------------------------------------------------

/** A message's thread: the kernel's `thread_id`, else its own id (a message before threads starts its own). */
export function threadOf(item: MessageItem): number {
  return typeof item.thread_id === "number" && item.thread_id > 0 ? item.thread_id : item.id;
}

/**
 * Rows with each thread's messages drawn together on one rail: a message whose
 * thread already has a row goes right after that thread's last row; anything
 * else (a new thread's first message, an event, a card) stays in order.
 */
export function joinThreads<R>(rows: readonly R[], threadIdOf: (row: R) => number | undefined): R[] {
  const out: R[] = [];
  const lastAt = new Map<number, number>();
  for (const row of rows) {
    const thread = threadIdOf(row);
    const at = thread === undefined ? undefined : lastAt.get(thread);
    if (at === undefined) {
      out.push(row);
      if (thread !== undefined) lastAt.set(thread, out.length - 1);
      continue;
    }
    out.splice(at + 1, 0, row);
    for (const [t, i] of lastAt) if (i > at) lastAt.set(t, i + 1);
    lastAt.set(thread as number, at + 1);
  }
  return out;
}

// ---- which thread was summarized into which (per bridge, for the app's lifetime) -------------

// The kernel exposes no `summarized_into` on read: this is what Start fresh's `202` (`from`, `thread`) and an
// `already_started_fresh {summarized_into}` refusal said, kept like the composer's workspace memory.
const summarized = new WeakMap<StudioBridge, Map<string, number>>();

function summarizedFor(api: StudioBridge): Map<string, number> {
  let map = summarized.get(api);
  if (map === undefined) {
    map = new Map();
    summarized.set(api, map);
  }
  return map;
}

export function rememberSummarized(api: StudioBridge, agent: string, from: number, into: number): void {
  summarizedFor(api).set(`${agent} ${from}`, into);
}

export function summarizedInto(api: StudioBridge, agent: string, thread: number): number | undefined {
  return summarizedFor(api).get(`${agent} ${thread}`);
}

// ---- the open thread, for the ⌘K commands ---------------------------------------------------

/** What the open thread offers the palette. Each acts on the thread view on screen. */
export interface OpenThreadActions {
  readonly agent: string;
  /** Open the Reply strip on the newest agent reply. */
  readonly replyLast: () => void;
  /** Summarize & start fresh on the newest reply's thread. */
  readonly summarizeLast: () => Promise<void>;
  /** Copy a reference to the newest message's thread. */
  readonly copyReference: () => Promise<void>;
}

let openThread: OpenThreadActions | null = null;
const openListeners = new Set<() => void>();

/** The thread view on screen registers its actions; the returned function unregisters exactly these. */
export function setOpenThread(actions: OpenThreadActions): () => void {
  openThread = actions;
  for (const listener of [...openListeners]) listener();
  return () => {
    if (openThread !== actions) return;
    openThread = null;
    for (const listener of [...openListeners]) listener();
  };
}

export function subscribeOpenThread(listener: () => void): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

export function openThreadSnapshot(): OpenThreadActions | null {
  return openThread;
}

// ---- waiting for a summary ------------------------------------------------------------------

/** How long to wait between two reads of a summary not written yet. Tests set `ms` to 0. */
export const summaryPoll = { ms: 1000, tries: 600 };
