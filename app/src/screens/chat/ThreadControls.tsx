// Thread continuity in a thread view (phase 8 item 17c; docs/DESIGN.md
// §"Thread continuity", docs/design/mockups/chat-threads.html). Chat and every
// Crew thread mount the same controls (D25):
//
// - the thread header (`ThreadControls`): the kernel's title (marked "renamed
//   by you" when it is the owner's), the message count, Rename in place (⏎
//   saves, Esc cancels, empty clears to the derived name) and Copy reference;
//   and, once the app saw it summarized, "Summarized: continued in …";
// - under each agent reply, Reply; under a thread's latest reply, Summarize &
//   start fresh (highlighted past the owner's size hint) and its ⓘ panel of the
//   thread's figures in tokens;
// - the summary preview (`SummaryDialog`) and the composer's Reply strip and
//   reference chip, whose state lives here.
//
// The controls show only when the kernel's thread answer carries `threads`
// (17b's figures, which the kernel always sends): a kernel without threads gets
// the thread view as before. Reply, Summarize and Rename are disabled while the
// kernel is unreachable. Every kernel string is a React text child only.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type {
  AskReference,
  StudioBridge,
  ThreadFigures,
  ThreadItem,
  ThreadRenameResponse,
  ThreadResponse,
  ThreadStartFreshResponse,
  ThreadSummarizeResponse,
  ThreadSummaryResponse,
} from "../../api/contract";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { useKernelReach } from "../../shell/last-known";
import { threadResource } from "../../store/resources";
import {
  count,
  firstLine,
  hintOf,
  messagesText,
  pastHint,
  referenceLink,
  refusalWords,
  rememberSummarized,
  setOpenThread,
  summarizedInto,
  summaryPoll,
  threadOf,
  threadTitle,
} from "./continuity";
import type { MessageItem, RefusalInput, ThreadRef } from "./continuity";
import { inFlightGuard, clock, navigate, refusalOf, write } from "./model";
import { ClipIcon } from "./ReferenceChip";
import type { ChipState } from "./ReferenceChip";
import { SummaryDialog } from "./SummaryDialog";
import type { SummaryPreview } from "./SummaryDialog";
import "./threads.css";

/** The agent message a Reply continues. */
export interface ReplyTarget {
  readonly message: number;
  readonly thread: number;
  readonly firstLine: string;
}

const NEEDS_KERNEL = "Needs the kernel";

function ReplyIcon() {
  return (
    <svg className="chat-thread-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function FreshIcon() {
  return (
    <svg className="chat-thread-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg className="chat-thread-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
    </svg>
  );
}

/** Copy `text` to the clipboard: the async clipboard, else the selection's copy. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection's copy.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    active?.focus();
    return done;
  } catch {
    return false;
  }
}

function focusIn(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.focus();
}

// ---- the thread header ------------------------------------------------------------------------

export interface ThreadControlsProps {
  readonly thread: number;
  readonly figures: ThreadFigures;
  readonly offline: boolean;
  /** The rename field's text while renaming this thread, else `null`. */
  readonly renaming: string | null;
  readonly renameRefusal: string;
  readonly onRenameStart: () => void;
  readonly onRenameText: (text: string) => void;
  readonly onRenameSave: () => void;
  readonly onRenameCancel: () => void;
  readonly onCopyReference: () => void;
  /** The thread this one was summarized into, as the app saw it, with its title. */
  readonly summarizedInto?: { readonly thread: number; readonly title: string };
}

/** A thread's header: title (or the rename field), count, Rename and Copy reference; then the summarized mark. */
export function ThreadControls({ thread, figures, offline, renaming, renameRefusal, onRenameStart, onRenameText, onRenameSave, onRenameCancel, onCopyReference, summarizedInto: into }: ThreadControlsProps) {
  const title = threadTitle(figures, thread);
  const onRenameKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onRenameSave();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel();
    }
  };
  return (
    <div className="chat-thread-headwrap">
      <div className="chat-thread-head" data-thread-head={thread}>
        {renaming === null ? (
          <>
            <h2 className="chat-thread-title" tabIndex={-1} data-thread-title={thread}>
              {title}
            </h2>
            {figures.renamed ? <Badge>renamed by you</Badge> : null}
          </>
        ) : (
          <div className="chat-rename" role="group" aria-label={`Rename the thread ${title}`}>
            <div className="field chat-rename-field">
              <input className="field-control" aria-label="Thread name" maxLength={80} autoComplete="off" autoFocus value={renaming} onChange={(event) => onRenameText(event.target.value)} onKeyDown={onRenameKey} />
            </div>
            <Button variant="primary" size="row" kbd="⏎" disabled={offline} title={offline ? NEEDS_KERNEL : undefined} onClick={onRenameSave}>
              Save
            </Button>
            <Button variant="ghost" size="row" kbd="Esc" onClick={onRenameCancel}>
              Cancel
            </Button>
            <span className="chat-thread-cap">Empty brings back the name from your first line.</span>
          </div>
        )}
        <span className="chat-thread-cap chat-thread-num">{messagesText(figures.messages)}</span>
        {into === undefined ? null : <Badge tone="parked">Summarized</Badge>}
        <span className="chat-spacer" />
        {renaming === null ? (
          <Button variant="ghost" size="row" icon={<PencilIcon />} aria-label={`Rename the thread ${title}`} data-rename={thread} disabled={offline} title={offline ? NEEDS_KERNEL : undefined} onClick={onRenameStart}>
            Rename
          </Button>
        ) : null}
        <Button variant="ghost" size="row" icon={<ClipIcon />} aria-label={`Copy reference to the thread ${title}`} data-copy-reference={thread} onClick={onCopyReference}>
          Copy reference
        </Button>
      </div>
      {renameRefusal === "" ? null : (
        <p className="chat-card-refusal" role="alert">
          {renameRefusal}
        </p>
      )}
      {into === undefined ? null : (
        <div className="chat-thread-sumbar" role="note">
          <span>
            Summarized: continued in{" "}
            <button type="button" className="chat-thread-link" onClick={() => focusIn(`[data-thread-title="${into.thread}"]`)}>
              {into.title}
            </button>
            .
          </span>
          <span className="chat-thread-cap">This thread stays, and Reply still continues it.</span>
        </div>
      )}
    </div>
  );
}

// ---- the ⓘ panel ----------------------------------------------------------------------------

export interface InfoPanelProps {
  readonly id: string;
  readonly agent: string;
  readonly figures: ThreadFigures;
  readonly hint: number | null;
  readonly offline: boolean;
}

/** This thread in tokens: messages, what the latest reply read, the summary's estimate and the size hint. Never a currency. */
export function InfoPanel({ id, agent, figures, hint, offline }: InfoPanelProps) {
  const past = pastHint(figures, hint);
  return (
    <div className="chat-thread-info" id={id} role="region" aria-label="Summarize & start fresh: this thread in tokens">
      <dl className="chat-thread-kv">
        <dt>Messages so far</dt>
        <dd className="chat-thread-num">{count(figures.messages)}</dd>
        <dt>Each reply now reads</dt>
        <dd>
          {figures.latest_reply_tokens === null ? (
            <span className="chat-thread-cap">No reading yet.</span>
          ) : (
            <>
              <span className="chat-thread-num">{count(figures.latest_reply_tokens)} tokens</span>
              <span className="chat-thread-cap">what the latest reply read: input and cache{offline ? " · last known" : ""}</span>
            </>
          )}
        </dd>
        <dt>With a summary</dt>
        <dd>
          {figures.summary_estimated_tokens === null ? (
            <span className="chat-thread-cap">Not written yet. The preview shows its size before anything starts.</span>
          ) : (
            <>
              <span className="chat-thread-num">about {count(figures.summary_estimated_tokens)} tokens</span>
              <Badge>estimate</Badge>
            </>
          )}
        </dd>
        <dt>Size hint</dt>
        <dd>
          {hint === null ? (
            <span className="chat-thread-cap">Not set, so Summarize is never highlighted. Set it in config/agents/{agent}.json.</span>
          ) : (
            <>
              <span className="chat-thread-num">{count(hint)} tokens</span>
              <span className="chat-thread-cap">set by you</span>
              {past ? <Badge tone="attention">this thread is past it</Badge> : null}
            </>
          )}
        </dd>
      </dl>
      <p>A summary keeps exact values (names, paths, ids, settings) word for word and drops the back-and-forth. You read it, and can edit it, before anything starts. This thread stays, and Reply still continues it.</p>
    </div>
  );
}

// ---- the hook ---------------------------------------------------------------------------------

export interface UseThreadContinuityArgs {
  readonly api: StudioBridge;
  readonly agent: string;
  /** A roster id's display name. */
  readonly nameOf: (id: string) => string;
  readonly data: ThreadResponse | undefined;
  readonly items: readonly ThreadItem[];
  readonly focusComposer: () => void;
}

export interface ThreadContinuity {
  /** The kernel speaks threads (its answer carries `threads`): the controls are drawn. */
  readonly on: boolean;
  /** A row's thread, for grouping (`undefined` for anything but a message, or when off). */
  readonly threadIdOf: (item: ThreadItem) => number | undefined;
  /** The header drawn before a thread's first row, or `null`. */
  readonly header: (item: MessageItem, first: boolean) => ReactNode;
  /** "Reply to <agent> · <time>" over an owner message that continues a thread. */
  readonly replyLabel: (item: MessageItem) => string | undefined;
  /** The note under a reply that continued its thread. */
  readonly note: (item: MessageItem) => ReactNode;
  /** Reply, and on a thread's latest reply Summarize & start fresh and its ⓘ, under an agent reply. */
  readonly actions: (item: MessageItem) => ReactNode;
  /** Whether a row sits on a thread rail that continues the row before it. */
  readonly joined: (item: MessageItem, first: boolean) => boolean;
  readonly composer: {
    readonly replyTo: ReplyTarget | null;
    readonly onCancelReply: () => void;
    readonly chip: ChipState | null;
    readonly chipOtherAgent: string | undefined;
    readonly onChipUse: (use: AskReference["use"]) => void;
    readonly onChipRemove: () => void;
    readonly onPasteReference: (ref: ThreadRef) => void;
    readonly onSent: () => void;
    /** The id of the line saying why Send waits, while a summary is being written. */
    readonly waitingOn: string | undefined;
  };
  /** The preview Dialog and the copy notice. */
  readonly overlay: ReactNode;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

type ReadSummary = { readonly ok: true; readonly body: ThreadSummaryResponse } | { readonly ok: false; readonly refusal: RefusalInput };

export function useThreadContinuity({ api, agent, nameOf, data, items, focusComposer }: UseThreadContinuityArgs): ThreadContinuity {
  const reach = useKernelReach(api);
  const offline = reach.offline;
  const on = Array.isArray(data?.threads);
  const hint = hintOf(data?.thread_summarize_hint_tokens);
  const figures = useMemo(() => new Map<number, ThreadFigures>((data?.threads ?? []).map((f) => [f.id, f])), [data]);
  const name = nameOf(agent);

  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [chip, setChip] = useState<ChipState | null>(null);
  const [infoOpen, setInfoOpen] = useState<number | null>(null);
  const [summarizing, setSummarizing] = useState<number | null>(null);
  const [threadNotice, setThreadNotice] = useState<{ readonly thread: number; readonly text: string } | null>(null);
  const [preview, setPreview] = useState<SummaryPreview | null>(null);
  const [starting, setStarting] = useState(false);
  const [previewRefusal, setPreviewRefusal] = useState("");
  const [renaming, setRenaming] = useState<{ readonly thread: number; readonly text: string } | null>(null);
  const [renameRefusal, setRenameRefusal] = useState<{ readonly thread: number; readonly text: string } | null>(null);
  const [notice, setNotice] = useState("");
  // Re-render after the summarized-into memory changes (it is a per-bridge map, not state).
  const [, setMarks] = useState(0);
  const guards = useRef({ summarize: inFlightGuard(), start: inFlightGuard(), rename: inFlightGuard() });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Per thread: its latest replied message, and each message's previous one in the same thread.
  const { latestReply, previous, newestReply, newestMessage } = useMemo(() => {
    const latest = new Map<number, number>();
    const prev = new Map<number, MessageItem>();
    const lastOf = new Map<number, MessageItem>();
    let newest: MessageItem | undefined;
    let newestAny: MessageItem | undefined;
    for (const item of items) {
      if (item.type !== "message") continue;
      const thread = threadOf(item);
      const before = lastOf.get(thread);
      if (before !== undefined) prev.set(item.id, before);
      lastOf.set(thread, item);
      newestAny = item;
      if (item.status === "replied") {
        latest.set(thread, item.id);
        newest = item;
      }
    }
    return { latestReply: latest, previous: prev, newestReply: newest, newestMessage: newestAny };
  }, [items]);

  const threadIdOf = useCallback((item: ThreadItem): number | undefined => (on && item.type === "message" ? threadOf(item) : undefined), [on]);
  const titleOf = useCallback((thread: number): string => threadTitle(figures.get(thread), thread), [figures]);

  const remember = useCallback(
    (from: number, into: unknown): void => {
      if (typeof into !== "number" || !Number.isSafeInteger(into) || into <= 0) return;
      rememberSummarized(api, agent, from, into);
      setMarks((n) => n + 1);
    },
    [api, agent],
  );

  // ---- Reply ----
  const startReply = useCallback(
    (item: MessageItem): void => {
      if (offline) return;
      setReplyTo({ message: item.id, thread: threadOf(item), firstLine: firstLine(item.reply_text) });
      focusComposer();
    },
    [offline, focusComposer],
  );
  const cancelReply = useCallback((): void => {
    const was = replyTo;
    setReplyTo(null);
    if (was !== null) focusIn(`[data-reply="${was.message}"]`);
  }, [replyTo]);

  // ---- Summarize & start fresh ----
  const readSummary = useCallback(
    async (thread: number): Promise<ReadSummary> => {
      for (let i = 0; i < summaryPoll.tries; i += 1) {
        let result;
        try {
          result = await api.request<ThreadSummaryResponse>({ method: "GET", path: "/threads/:agent/:thread/summary", params: { agent, thread } });
        } catch {
          result = undefined;
        }
        if (result?.ok === true) return { ok: true, body: result.body };
        const refusal = refusalOf(result);
        const body = result !== undefined && !result.ok && "body" in result ? result.body : undefined;
        // `no_summary`: the summary session has not written the file yet. Read again.
        if (refusal.code !== "no_summary" || !alive.current) return { ok: false, refusal: { ...refusal, body } };
        await new Promise((resolve) => window.setTimeout(resolve, summaryPoll.ms));
      }
      return { ok: false, refusal: { status: 409, code: "summary_slow", text: "The summary is taking longer than expected. Press Summarize & start fresh again to look for it." } };
    },
    [api, agent],
  );

  const summarize = useCallback(
    async (thread: number): Promise<void> => {
      if (offline) return;
      await guards.current.summarize.run(async () => {
        setThreadNotice(null);
        setSummarizing(thread);
        try {
          const out = await write<ThreadSummarizeResponse>(api, "/threads/:agent/:thread/summarize", { agent, thread }, undefined, [threadResource(agent)]);
          // `summary_exists`: a summary file is already there (an earlier Cancel kept it). Preview that file.
          if (!out.ok && out.code !== "summary_exists") {
            if (out.code === "already_started_fresh") remember(thread, (out.body as { summarized_into?: unknown } | undefined)?.summarized_into);
            if (alive.current) setThreadNotice({ thread, text: refusalWords(out, "summarize") });
            return;
          }
          const read = await readSummary(thread);
          if (!alive.current) return;
          if (!read.ok) {
            setThreadNotice({ thread, text: refusalWords(read.refusal, "summarize") });
            return;
          }
          const f = figures.get(thread);
          setPreviewRefusal("");
          setPreview({
            thread,
            title: titleOf(thread),
            text: read.body.text,
            file: read.body.file,
            cut: read.body.truncated === null ? null : read.body.truncated.chars_cut,
            // The kernel's estimate is characters / 4; before the figures refetch, the same from the text read.
            estimatedTokens: f?.summary_estimated_tokens ?? Math.ceil(read.body.text.length / 4),
            messages: f?.messages ?? null,
          });
        } finally {
          if (alive.current) setSummarizing(null);
        }
      });
    },
    [offline, api, agent, figures, readSummary, remember, titleOf],
  );

  const closePreview = useCallback((): void => {
    const thread = preview?.thread;
    setPreview(null);
    setPreviewRefusal("");
    // Esc or Cancel returns focus to Summarize (after the dialog's own focus return).
    if (thread !== undefined) window.setTimeout(() => focusIn(`[data-summarize="${thread}"]`), 0);
  }, [preview]);

  const startFresh = useCallback(
    async (summary: string | undefined): Promise<void> => {
      const shown = preview;
      if (shown === null) return;
      await guards.current.start.run(async () => {
        setStarting(true);
        let out;
        try {
          out = await write<ThreadStartFreshResponse>(api, "/threads/:agent/:thread/start-fresh", { agent, thread: shown.thread }, summary === undefined ? {} : { summary }, [threadResource(agent), "sessions", "messages"]);
        } finally {
          if (alive.current) setStarting(false);
        }
        if (!alive.current) return;
        if (!out.ok) {
          if (out.code === "already_started_fresh") remember(shown.thread, (out.body as { summarized_into?: unknown } | undefined)?.summarized_into);
          setPreviewRefusal(refusalWords(out, "start-fresh"));
          return;
        }
        remember(out.body.from, out.body.thread);
        setPreview(null);
        setPreviewRefusal("");
        // Start fresh ends an open Reply strip and an unsaved rename of the old thread; a chip stays.
        setReplyTo((r) => (r !== null && r.thread === shown.thread ? null : r));
        setRenaming((r) => (r !== null && r.thread === shown.thread ? null : r));
        focusComposer();
      });
    },
    [preview, api, agent, remember, focusComposer],
  );

  // ---- Copy reference and the chip ----
  const copyReference = useCallback(
    async (thread: number): Promise<void> => {
      const link = referenceLink({ agent, thread });
      const copied = await copyText(link);
      if (!alive.current) return;
      setNotice(copied ? `Copied a reference to “${titleOf(thread)}”. Paste it into any composer with ⌘V.` : `The clipboard refused the reference. Copy this link by hand: ${link}`);
    },
    [agent, titleOf],
  );

  const pasteReference = useCallback(
    (ref: ThreadRef): void => {
      const own = ref.agent === agent ? figures.get(ref.thread) : undefined;
      setChip({ agent: ref.agent, thread: ref.thread, use: "exchanges", ...(own === undefined ? {} : { figures: own }) });
      if (own !== undefined) return;
      // Another agent's thread (or one off this page): read its figures from that agent's thread answer.
      void api
        .request<ThreadResponse>({ method: "GET", path: "/threads/:agent", params: { agent: ref.agent } })
        .then((result) => {
          const found = result.ok && Array.isArray(result.body.threads) ? result.body.threads.find((f) => f.id === ref.thread) : undefined;
          if (found === undefined || !alive.current) return;
          setChip((c) => (c !== null && c.agent === ref.agent && c.thread === ref.thread ? { ...c, figures: found } : c));
        })
        .catch(() => undefined);
    },
    [api, agent, figures],
  );

  // ---- Rename ----
  const saveRename = useCallback(async (): Promise<void> => {
    const current = renaming;
    if (current === null || offline) return;
    await guards.current.rename.run(async () => {
      const title = current.text.trim();
      const out = await write<ThreadRenameResponse>(api, "/threads/:agent/:thread/rename", { agent, thread: current.thread }, { title: title === "" ? null : title }, [threadResource(agent), "sessions", "messages"]);
      if (!alive.current) return;
      if (!out.ok) {
        setRenameRefusal({ thread: current.thread, text: refusalWords(out, "rename") });
        return;
      }
      setRenameRefusal(null);
      setRenaming(null);
      window.setTimeout(() => focusIn(`[data-thread-title="${current.thread}"]`), 0);
    });
  }, [renaming, offline, api, agent]);

  // ---- ⌘K: the open thread's three commands ----
  const latest = useRef({ startReply, summarize, copyReference, newestReply, newestMessage });
  useLayoutEffect(() => {
    latest.current = { startReply, summarize, copyReference, newestReply, newestMessage };
  });
  const offered = on && newestReply !== undefined;
  useEffect(() => {
    if (!offered) return;
    return setOpenThread({
      agent,
      replyLast: () => {
        const item = latest.current.newestReply;
        if (item !== undefined) latest.current.startReply(item);
      },
      summarizeLast: async () => {
        const item = latest.current.newestReply;
        if (item !== undefined) await latest.current.summarize(threadOf(item));
      },
      copyReference: async () => {
        const item = latest.current.newestMessage;
        if (item !== undefined) await latest.current.copyReference(threadOf(item));
      },
    });
  }, [offered, agent]);

  // ---- rendering ----
  const statusId = `chat-summarizing-${agent}`;

  const header = (item: MessageItem, first: boolean): ReactNode => {
    if (!on || !first) return null;
    const thread = threadOf(item);
    const f = figures.get(thread);
    if (f === undefined) return null;
    const into = summarizedInto(api, agent, thread);
    return (
      <ThreadControls
        thread={thread}
        figures={f}
        offline={offline}
        renaming={renaming !== null && renaming.thread === thread ? renaming.text : null}
        renameRefusal={renameRefusal !== null && renameRefusal.thread === thread ? renameRefusal.text : ""}
        onRenameStart={() => {
          setRenameRefusal(null);
          setRenaming({ thread, text: f.title });
        }}
        onRenameText={(text) => setRenaming({ thread, text })}
        onRenameSave={() => void saveRename()}
        onRenameCancel={() => {
          setRenaming(null);
          setRenameRefusal(null);
          window.setTimeout(() => focusIn(`[data-rename="${thread}"]`), 0);
        }}
        onCopyReference={() => void copyReference(thread)}
        {...(into === undefined ? {} : { summarizedInto: { thread: into, title: titleOf(into) } })}
      />
    );
  };

  const replyLabel = (item: MessageItem): string | undefined => {
    if (!on || item.from_agent !== null || threadOf(item) === item.id) return undefined;
    const prev = previous.get(item.id);
    return prev === undefined ? `Reply to ${name}` : `Reply to ${nameOf(prev.agent)} · ${clock(prev.updated_at)}`;
  };

  const note = (item: MessageItem): ReactNode => {
    if (!on) return null;
    if (item.continuation === "replayed") {
      return (
        <div className="chat-thread-fallback" role="note">
          <p className="chat-thread-fallback-title">Continuing from the saved conversation</p>
          <p className="chat-thread-cap">The earlier session can't be continued, so {nameOf(item.agent)} reads this thread's saved messages, quoted as data, in a new session. Nothing in the thread is lost.</p>
        </div>
      );
    }
    if (item.continuation === "resumed") return <p className="chat-thread-cap chat-thread-path">continued</p>;
    return null;
  };

  const actions = (item: MessageItem): ReactNode => {
    if (!on || item.status !== "replied") return null;
    const thread = threadOf(item);
    const isLatest = latestReply.get(thread) === item.id;
    const f = figures.get(thread);
    const past = pastHint(f, hint);
    const busy = summarizing === thread;
    const infoId = `chat-thread-info-${agent}-${thread}`;
    const time = clock(item.updated_at);
    return (
      <div className="chat-thread-actions-wrap">
        <div className="chat-thread-actions">
          <Button variant="ghost" size="row" icon={<ReplyIcon />} aria-label={`Reply to ${nameOf(item.agent)}'s message of ${time}`} data-reply={item.id} disabled={offline} title={offline ? NEEDS_KERNEL : undefined} onClick={() => startReply(item)}>
            Reply
          </Button>
          {isLatest && f !== undefined ? (
            <>
              <Button
                variant={past ? "secondary" : "ghost"}
                size="row"
                icon={<FreshIcon />}
                className={past ? "chat-thread-hl" : undefined}
                data-summarize={thread}
                loading={busy}
                disabled={offline}
                title={offline ? NEEDS_KERNEL : undefined}
                onClick={() => void summarize(thread)}
              >
                Summarize &amp; start fresh
              </Button>
              <Button
                variant="ghost"
                size="row"
                className="chat-thread-ic"
                data-info={thread}
                aria-expanded={infoOpen === thread}
                aria-controls={infoId}
                aria-label="About Summarize & start fresh: this thread in tokens"
                onClick={() => setInfoOpen((open) => (open === thread ? null : thread))}
              >
                <InfoIcon />
              </Button>
              {past ? <Badge tone="attention">past your size hint</Badge> : null}
            </>
          ) : null}
        </div>
        {busy ? (
          <p className="chat-thread-pending" id={statusId} role="status">
            {nameOf(item.agent)} is writing a summary of this thread: one short session. Nothing new starts until you choose, so Send waits.
          </p>
        ) : null}
        {threadNotice !== null && threadNotice.thread === thread && isLatest ? (
          <p className="chat-card-refusal" role="alert">
            {threadNotice.text}
          </p>
        ) : null}
        {isLatest && f !== undefined && infoOpen === thread ? <InfoPanel id={infoId} agent={agent} figures={f} hint={hint} offline={offline} /> : null}
      </div>
    );
  };

  const joined = (item: MessageItem, first: boolean): boolean => on && !first && figures.has(threadOf(item));

  const chipFigures = chip === null ? undefined : chip.agent === agent ? (figures.get(chip.thread) ?? chip.figures) : chip.figures;
  const shownChip: ChipState | null = chip === null ? null : { ...chip, ...(chipFigures === undefined ? {} : { figures: chipFigures }) };

  const overlay = (
    <>
      {notice === "" ? null : (
        <p className="chat-thread-notice" role="status" data-testid="chat-thread-notice">
          {notice}
        </p>
      )}
      {preview === null ? null : <SummaryDialog preview={preview} agentName={name} starting={starting} refusal={previewRefusal} onStart={(summary) => void startFresh(summary)} onCancel={closePreview} />}
    </>
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented || preview !== null) return;
    if (infoOpen !== null) {
      event.preventDefault();
      const thread = infoOpen;
      setInfoOpen(null);
      focusIn(`[data-info="${thread}"]`);
      return;
    }
    if (replyTo !== null) {
      event.preventDefault();
      cancelReply();
    }
  };

  return {
    on,
    threadIdOf,
    header,
    replyLabel,
    note,
    actions,
    joined,
    composer: {
      replyTo,
      onCancelReply: cancelReply,
      chip: shownChip,
      chipOtherAgent: chip !== null && chip.agent !== agent ? nameOf(chip.agent) : undefined,
      onChipUse: (use) => setChip((c) => (c === null ? c : { ...c, use })),
      onChipRemove: () => {
        setChip(null);
        focusComposer();
      },
      onPasteReference: pasteReference,
      onSent: () => {
        setReplyTo(null);
        setChip(null);
      },
      waitingOn: summarizing === null ? undefined : statusId,
    },
    overlay,
    onKeyDown,
  };
}
