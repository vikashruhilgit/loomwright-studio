// DiffView: a unified diff in `mono` on `surface`, shown wherever the user must
// see exactly what will change before approving it
// (docs/design/design-system/components/DiffView/{README.md,preview.html}).
// File header (path in `mono`, scope label, +/− counts), hunk headers, two
// line-number gutters and a sign column that are `user-select: none`, every
// hunk expanded, long lines scrolling horizontally inside the diff only. No
// syntax highlighting: the add/del colour is the only colour. `onRendered` fires
// once per diff, after its hunk rows are in the DOM, so an approval can gate Allow on it.
// Every string (path, header, line text) is a React text child.
import { useEffect, useMemo, useRef } from "react";
import "./DiffView.css";

/** One parsed diff line. Context lines carry both numbers; added only the new, deleted only the old. */
export type DiffLine =
  | { readonly kind: "context"; readonly oldNumber: number; readonly newNumber: number; readonly text: string }
  | { readonly kind: "add"; readonly newNumber: number; readonly text: string }
  | { readonly kind: "del"; readonly oldNumber: number; readonly text: string };

export interface DiffHunk {
  /** The hunk header as written, e.g. `@@ -12,7 +12,15 @@ "hooks": {`. */
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

export interface DiffViewProps {
  /** The file path, always shown. */
  readonly path: string;
  /** Where the change applies, e.g. "project" or "global"; shown as "<scope> scope". */
  readonly scope: string;
  readonly hunks: readonly DiffHunk[];
  /** Fires once per diff (path + hunk content), after its hunk rows are in the DOM (the approval's Allow gate). */
  readonly onRendered?: () => void;
}

const SIGN: Readonly<Record<DiffLine["kind"], string>> = { context: "", add: "+", del: "−" };

function countLines(hunks: readonly DiffHunk[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") added += 1;
      else if (line.kind === "del") deleted += 1;
    }
  }
  return { added, deleted };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Line({ line }: { readonly line: DiffLine }) {
  const oldNumber = line.kind === "add" ? "" : String(line.oldNumber);
  const newNumber = line.kind === "del" ? "" : String(line.newNumber);
  return (
    <div className={`diffview-line diffview-${line.kind}`} data-line={line.kind}>
      <span className="diffview-gutter" data-gutter="old">
        {oldNumber}
      </span>
      <span className="diffview-gutter" data-gutter="new">
        {newNumber}
      </span>
      <span className="diffview-sign">{SIGN[line.kind]}</span>
      <span className="diffview-text">{line.text}</span>
    </div>
  );
}

export function DiffView({ path, scope, hunks, onRendered }: DiffViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // The diff the gate last fired for, by content: a different path or different hunk
  // content is a new diff that must gate its own Allow; the same content (even as a new
  // array) is the same diff and must not fire again.
  const firedForRef = useRef<string | null>(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const diffKey = useMemo(() => JSON.stringify([path, hunks]), [path, hunks]);

  // Runs after commit: fire once per diff, and only when at least one hunk row is actually in the DOM.
  useEffect(() => {
    if (firedForRef.current === diffKey) return;
    if (!bodyRef.current?.querySelector("[data-line]")) return;
    firedForRef.current = diffKey;
    onRenderedRef.current?.();
  }, [diffKey]);

  const { added, deleted } = countLines(hunks);
  const hasLines = hunks.some((h) => h.lines.length > 0);

  return (
    <div className="diffview" role="region" aria-label={`Diff of ${path}`}>
      <div className="diffview-file">
        <span className="diffview-path">{path}</span>
        <span className="diffview-scope">{`${scope} scope`}</span>
        <span className="diffview-counts" aria-label={`${plural(added, "addition", "additions")}, ${plural(deleted, "deletion", "deletions")}`}>
          <span className="diffview-count-add">{`+${added}`}</span> <span className="diffview-count-del">{`−${deleted}`}</span>
        </span>
      </div>
      {hasLines ? (
        // The only horizontal scroller: long lines scroll here, never the page. Focusable so keyboard users can scroll it.
        <div className="diffview-body" ref={bodyRef} tabIndex={0} role="group" aria-label={`Lines of ${path}`}>
          <div className="diffview-lines">
            {hunks.map((hunk, h) => (
              <div className="diffview-hunk" key={h}>
                <div className="diffview-hunk-header">{hunk.header}</div>
                {hunk.lines.map((line, i) => (
                  <Line line={line} key={i} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="diffview-empty">No changes in this diff.</p>
      )}
    </div>
  );
}
