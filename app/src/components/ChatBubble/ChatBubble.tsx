// ChatBubble: one chat turn (docs/design/design-system/components/ChatBubble/README.md + preview.html).
// Wright and specialists sit left on `surface` with a `hairline` edge; the user sits right on
// `accent-soft` with no edge. A reply can carry a drafted playbook card with its dry run.
//
// Every string here can come from the kernel or a model, so it is rendered as a React text
// child only. The body is plain text with paragraph and line breaks plus a hand-built safe
// subset (`inline code` and **bold**) made of React elements. No element's `href` is ever
// built from message text, so a `javascript:` link, raw or as markdown, stays text.
import type { KeyboardEvent, ReactNode } from "react";
import "./ChatBubble.css";

/** Who is speaking. `wright` and `specialist` sit left; `user` sits right. */
export type ChatSpeaker = "wright" | "specialist" | "user";

/** A drafted value. `proposed` marks a value Wright chose rather than the user (D4). */
export interface DraftValue {
  readonly value: string;
  readonly proposed?: boolean;
}

/** The playbook Wright drafted in this reply. Every field is shown; none is hidden. */
export interface PlaybookDraft {
  readonly name: DraftValue;
  /** The agent the playbook runs as, e.g. "Mason". */
  readonly runsAs: string;
  readonly trigger: DraftValue;
  readonly action: DraftValue;
  /** Shown in `mono`: dedupe keys are exact strings. */
  readonly dedupeKey: DraftValue;
  readonly model: DraftValue;
  readonly approval: DraftValue;
  /** Exactly what the playbook would have done, shown in `mono` and never behind a disclosure. */
  readonly dryRun: string;
  /** Optional dollar estimate for the dry run, e.g. "$0.60". Always labelled "≈ at API rates" (D24). */
  readonly costEstimate?: string;
}

interface ChatBubbleBaseProps {
  /** The speaker's name as shown in the caption, e.g. "Wright", "Mason" or "You". */
  readonly speaker: string;
  readonly from: ChatSpeaker;
  /** Pre-formatted time for the caption, e.g. "14:06". Replaced by "streaming" while streaming. */
  readonly time: string;
  /** The message text. Rendered as text: paragraphs, line breaks, `code` and **bold** only. */
  readonly body: string;
  /**
   * The 24px avatar (the Avatar primitive, passed in by the screen). Shown on the left for
   * Wright and specialists; the user's turn carries no avatar, as in preview.html.
   */
  readonly avatar?: ReactNode;
  /** While true the meta line reads "streaming" and a static caret marks the live end. */
  readonly streaming?: boolean;
}

interface WithoutDraft {
  readonly draft?: undefined;
}

interface WithDraft {
  readonly draft: PlaybookDraft;
  readonly onEnable: () => void;
  readonly onEditInEnglish: () => void;
  readonly onEditFields: () => void;
}

export type ChatBubbleProps = ChatBubbleBaseProps & (WithoutDraft | WithDraft);

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)/g;

function renderInline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    if (match[1] !== undefined) {
      out.push(<code key={`${key}-c${n}`}>{token.slice(1, -1)}</code>);
    } else {
      out.push(<strong key={`${key}-b${n}`}>{token.slice(2, -2)}</strong>);
    }
    last = at + token.length;
    n += 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function renderBody(body: string, streaming: boolean): ReactNode {
  const paragraphs = body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) paragraphs.push("");
  return paragraphs.map((paragraph, pi) => {
    const lines = paragraph.split("\n");
    const isLast = pi === paragraphs.length - 1;
    return (
      <p key={pi}>
        {lines.map((line, li) => (
          <span key={li}>
            {li > 0 ? <br /> : null}
            {renderInline(line, `${pi}-${li}`)}
          </span>
        ))}
        {streaming && isLast ? <span className="chat-bubble__caret" data-testid="chat-bubble-caret" aria-hidden="true" /> : null}
      </p>
    );
  });
}

function Proposed({ show }: { readonly show: boolean | undefined }) {
  return show ? <span className="chat-bubble__proposed">proposed</span> : null;
}

function isTextEntry(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function isControl(target: EventTarget): boolean {
  return target instanceof HTMLElement && ["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function DraftCard({ draft, onEnable, onEditInEnglish, onEditFields }: Omit<WithDraft, "draft"> & { readonly draft: PlaybookDraft }) {
  // Shortcuts apply only while focus is inside the card; the global keymap is the shell's.
  // Enter on a focused button is left to the button's own activation.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target)) return;
    if ((event.key === "e" || event.key === "E") && !event.shiftKey) {
      event.preventDefault();
      onEditInEnglish();
    } else if (event.key === "Enter" && !isControl(event.target)) {
      event.preventDefault();
      onEnable();
    }
  }

  return (
    <section className="chat-bubble__draft" aria-label="Drafted playbook" onKeyDown={onKeyDown}>
      <div className="chat-bubble__draft-head">
        <b className="chat-bubble__draft-name">{draft.name.value}</b>
        <Proposed show={draft.name.proposed} />
        <span className="chat-bubble__badge">draft</span>
        <span className="chat-bubble__badge">runs as {draft.runsAs}</span>
      </div>
      <dl className="chat-bubble__kv">
        <dt>Trigger</dt>
        <dd data-field="trigger">
          {draft.trigger.value} <Proposed show={draft.trigger.proposed} />
        </dd>
        <dt>Action</dt>
        <dd data-field="action">
          {draft.action.value} <Proposed show={draft.action.proposed} />
        </dd>
        <dt>Dedupe key</dt>
        <dd data-field="dedupe-key">
          <span className="chat-bubble__mono">{draft.dedupeKey.value}</span> <Proposed show={draft.dedupeKey.proposed} />
        </dd>
        <dt>Model</dt>
        <dd data-field="model">
          {draft.model.value} <Proposed show={draft.model.proposed} />
        </dd>
        <dt>Approval</dt>
        <dd data-field="approval">
          {draft.approval.value} <Proposed show={draft.approval.proposed} />
        </dd>
      </dl>
      <div className="chat-bubble__dry" data-testid="chat-bubble-dry-run">
        <span className="chat-bubble__dry-label">dry run · </span>
        {draft.dryRun}
        {draft.costEstimate !== undefined ? (
          <span className="chat-bubble__dry-label">
            {" · "}
            <span className="chat-bubble__estimate">{draft.costEstimate} ≈ at API rates</span>
          </span>
        ) : null}
      </div>
      <div className="chat-bubble__actions">
        <button type="button" className="chat-bubble__btn chat-bubble__btn--primary" aria-keyshortcuts="Enter" onClick={onEnable}>
          Enable
          <kbd className="chat-bubble__kbd" aria-hidden="true">
            ⏎
          </kbd>
        </button>
        <button type="button" className="chat-bubble__btn" aria-keyshortcuts="E" onClick={onEditInEnglish}>
          Edit in English
          <kbd className="chat-bubble__kbd" aria-hidden="true">
            E
          </kbd>
        </button>
        <button type="button" className="chat-bubble__btn" onClick={onEditFields}>
          Edit fields
        </button>
      </div>
    </section>
  );
}

export function ChatBubble(props: ChatBubbleProps) {
  const { speaker, from, time, body, avatar, streaming = false } = props;
  const side = from === "user" ? "right" : "left";
  return (
    <article
      className={`chat-bubble chat-bubble--${side}`}
      data-from={from}
      data-side={side}
      aria-label={`${speaker}, ${streaming ? "streaming" : time}`}
      aria-busy={streaming || undefined}
    >
      {side === "left" ? <div className="chat-bubble__avatar">{avatar}</div> : null}
      <div className="chat-bubble__column">
        <div className="chat-bubble__meta" data-testid="chat-bubble-meta">
          <span className="chat-bubble__speaker">{speaker}</span>
          {side === "right" ? <span aria-hidden="true">·</span> : null}
          <span className="chat-bubble__time">{streaming ? "streaming" : time}</span>
        </div>
        <div className="chat-bubble__bubble" data-testid="chat-bubble-bubble">
          {renderBody(body, streaming)}
          {props.draft !== undefined ? (
            <DraftCard draft={props.draft} onEnable={props.onEnable} onEditInEnglish={props.onEditInEnglish} onEditFields={props.onEditFields} />
          ) : null}
        </div>
      </div>
    </article>
  );
}
