// The reference chip a pasted `loomwright-studio://thread/<agent>/<thread>`
// link becomes in a composer (docs/design/mockups/chat-threads.html, view
// `reference`): the thread's title and message count, the agent when it is
// another's, a Full thread / Summary toggle when the thread has a summary, the
// size, and ×. The send carries it as `references: [{thread, use}]`, never in
// the text.
//
// Size: the Summary view shows the kernel's estimate of the summary in tokens;
// Full thread shows none, since no kernel field gives a thread's full size
// before the send (DESIGN.md open point 1; a reference past the kernel's bound
// is refused by the send itself, in characters).
import type { AskReference, ThreadFigures } from "../../api/contract";
import { count, messagesText, threadTitle } from "./continuity";
import "./threads.css";

export interface ChipState {
  readonly agent: string;
  readonly thread: number;
  readonly use: AskReference["use"];
  /** The thread's figures, once read; `undefined` until then (or when the kernel has none for it). */
  readonly figures?: ThreadFigures;
}

export interface ReferenceChipProps {
  readonly chip: ChipState;
  /** The referenced thread's agent's name when it is not the composer's agent; `undefined` for the same agent. */
  readonly otherAgent?: string;
  readonly onUse: (use: AskReference["use"]) => void;
  readonly onRemove: () => void;
}

export function ClipIcon() {
  return (
    <svg className="chat-thread-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function ReferenceChip({ chip, otherAgent, onUse, onRemove }: ReferenceChipProps) {
  const figures = chip.figures;
  const title = threadTitle(figures, chip.thread);
  const hasSummary = figures !== undefined && figures.summary_estimated_tokens !== null;
  const summary = hasSummary && chip.use === "summary";
  return (
    <div className="chat-ref-chips">
      <div className="chat-ref-chip" role="group" aria-label="Attached thread reference" data-thread={chip.thread} data-use={chip.use}>
        <ClipIcon />
        <span className="chat-ref-title">
          Thread: <b>{title}</b>
          {figures === undefined ? null : <span className="chat-thread-num"> ({messagesText(figures.messages)})</span>}
          {otherAgent === undefined ? null : ` · ${otherAgent}`}
        </span>
        {hasSummary ? (
          <span className="chat-seg" role="group" aria-label="Attach as">
            <button type="button" aria-pressed={!summary} onClick={() => onUse("exchanges")}>
              Full thread
            </button>
            <button type="button" aria-pressed={summary} onClick={() => onUse("summary")}>
              Summary
            </button>
          </span>
        ) : null}
        {summary && figures?.summary_estimated_tokens != null ? <span className="chat-thread-cap chat-thread-num">about {count(figures.summary_estimated_tokens)} tokens</span> : null}
        <button type="button" className="chat-x" aria-label={`Remove the reference to ${title}`} onClick={onRemove}>
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
