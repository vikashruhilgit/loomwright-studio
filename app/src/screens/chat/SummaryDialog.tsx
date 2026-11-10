// The summary preview (docs/design/mockups/chat-threads.html, view
// `chat-preview`): the summary a Summarize & start fresh wrote, read before
// anything starts. Start fresh with this, Edit and Cancel, in that order after
// the summary text (the Tab order DESIGN.md states); Escape or Cancel closes it
// and starts nothing. Built on Dialog's panel CSS and its modal focus hook
// rather than `Dialog` itself, whose action row is exactly two buttons.
//
// The summary is the owner-editable markdown file (untrusted text): shown as
// text only, with "## " lines as headings and "- " lines as list items, never
// as HTML (invariant 3).
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { useModalFocus } from "../../components/Dialog/useModalFocus";
import "../../components/Dialog/Dialog.css";
import { count, messagesText } from "./continuity";
import "./threads.css";

export interface SummaryPreview {
  readonly thread: number;
  /** The thread's title. */
  readonly title: string;
  readonly text: string;
  readonly file: string;
  /** Characters the read cut, when the file is longer than what was shown. */
  readonly cut: number | null;
  readonly estimatedTokens: number | null;
  readonly messages: number | null;
}

export interface SummaryDialogProps {
  readonly preview: SummaryPreview;
  readonly agentName: string;
  /** Start fresh: `summary` is the owner's edit, `undefined` when the text was not changed. */
  readonly onStart: (summary: string | undefined) => void;
  readonly onCancel: () => void;
  readonly starting: boolean;
  readonly refusal: string;
}

/** The summary's markdown as text-only blocks: "## " headings, "- " list items, other lines paragraphs. */
export function summaryBlocks(markdown: string): ReactNode[] {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = (): void => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    out.push(
      <ul key={`ul${out.length}`}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>,
    );
  };
  for (const line of markdown.split("\n")) {
    if (line.startsWith("- ")) {
      list.push(line.slice(2));
      continue;
    }
    flush();
    if (line.startsWith("## ")) out.push(<h3 key={`h${out.length}`}>{line.slice(3)}</h3>);
    else if (line.trim() !== "") out.push(<p key={`p${out.length}`}>{line}</p>);
  }
  flush();
  return out;
}

export function SummaryDialog({ preview, agentName, onStart, onCancel, starting, refusal }: SummaryDialogProps) {
  const titleId = useId();
  const descId = useId();
  const editId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  useModalFocus(panelRef, true, onCancel);
  const text = edit ?? preview.text;
  const edited = edit !== null && edit !== preview.text;
  // A cut read is not the whole file: an edit of it would overwrite the rest, so Edit stays off.
  const canEdit = preview.cut === null;
  const size = preview.estimatedTokens === null ? null : `about ${count(preview.estimatedTokens)} tokens, an estimate`;
  const facts = [`Saved as ${preview.file}`, size, preview.messages === null ? null : `in place of ${messagesText(preview.messages)}`].filter((f): f is string => f !== null);
  return (
    <div className="dialog-overlay" data-state="open">
      <div ref={panelRef} className="dialog-panel chat-summary-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} data-wide="true" tabIndex={-1} data-testid="summary-preview">
        <div className="chat-summary-head">
          <h2 className="dialog-title" id={titleId}>
            Summary of “{preview.title}”
          </h2>
          <Badge>{edited ? "edited by you" : `by ${agentName}`}</Badge>
        </div>
        <p className="dialog-description" id={descId}>
          Read it before anything starts. Start fresh with this begins a new thread with the summary at its top. This thread stays as it is, and Reply still continues it.
        </p>
        {editing ? (
          <div className="field chat-summary-edit">
            <textarea id={editId} className="field-control" aria-label="Summary text" value={text} onChange={(event) => setEdit(event.target.value)} />
          </div>
        ) : (
          <div className="chat-summary-text" tabIndex={0} role="region" aria-label="Summary text">
            {summaryBlocks(text)}
          </div>
        )}
        <p className="chat-thread-cap">
          {facts.join(" · ")}
          {preview.cut === null ? null : `. The file is longer than shown (${count(preview.cut)} characters not shown), so Edit is off: open the file to change it.`}
          {editing ? ". Your edit is written to this file when you start fresh; Cancel or Esc drops it." : null}
        </p>
        {refusal === "" ? null : (
          <p className="chat-card-refusal" role="alert">
            {refusal}
          </p>
        )}
        <div className="dialog-actions chat-summary-actions">
          <Button variant="primary" loading={starting} onClick={() => onStart(edited ? text : undefined)}>
            Start fresh with this
          </Button>
          <Button variant="secondary" aria-pressed={editing} disabled={!canEdit} onClick={() => setEditing((e) => !e)}>
            {editing ? "Done editing" : "Edit"}
          </Button>
          <Button variant="ghost" kbd="Esc" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
