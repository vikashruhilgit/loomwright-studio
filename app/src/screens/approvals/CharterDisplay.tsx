// A held charter create or update's display (phase 8 items 16, 18b and 18d;
// docs/DESIGN.md §"Charter card (phase 8 item 18a)", the mockup
// `docs/design/mockups/charter-card.html`). The kernel writes the display
// (`createDisplay` / `updateDisplay` in `kernel/src/agents/charter-tools.ts`)
// and stores it whole; `charterDisplayParts` and `charterBlocks` read it, and
// this draws, in Chat's charter card and on the Approvals screen alike:
//
// 1. the compact plain view, first: who the change is for; **Can do**, each
//    job's plain label with its purpose lines (the job labels alone in the
//    kernel's compact form; an update marks each job "Adds" or "Keeps", item
//    16), then the other tools and Bash prefixes in words; **Never does**, the
//    never list in words; **Limits** on one line; then the kernel's readiness
//    block (item 18b: one line per duty, then one per job prerequisite, each
//    status as a `Badge` in plain words, flagged and not-checked lines in the
//    `attention` tone). No `mcp__kernel__` name, JSON or file path shows here;
// 2. two icon buttons in the head: Copy all text (the display exactly as the
//    kernel stored it, `approval.display`) and Show full details;
// 3. the full details, hidden by default on both screens (the owner's
//    2026-11-10 decision) and rendered only when shown: a line giving the total
//    length and saying nothing is cut, then four blocks (kernel tools by job,
//    the enforced lines, the settings file, `role.md`), each scrolling inside
//    the card, with Show more and its own Copy.
//
// When the kernel's catalogue was unavailable it shows the kernel's own note
// and no grouping, never a guessed one. Copy shows a check for two seconds and
// says how many characters it copied; a clipboard that refused says so in an
// alert, never a silent success.
//
// Every part is untrusted text: it goes through `printable` and is rendered as
// a React text child, never markup. Copy writes the raw stored text, not HTML.
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "../../components/Badge/Badge";
import { copyText } from "../../components/copyText";
import { IconButton } from "../../components/IconButton/IconButton";
import { count } from "../chat/continuity";
import { charterBlocks } from "./charterBlocks";
import type { CharterBlock } from "./charterBlocks";
import { readinessIsOpen } from "./subject";
import type { CharterDisplayParts, CharterReadinessLine, CharterReadinessStatus } from "./subject";
import { printable } from "./printable";
import "./approvals.css";

/** The details disclosure's summary (hidden: the Show full details icon is its control). */
export const RAW_SUMMARY = "Full details";

/** The Can do heading (the mockup's `charterCard`). */
export const JOBS_HEADING = "Can do";

export const NEVER_HEADING = "Never does";
export const LIMITS_HEADING = "Limits";

/** An update's mark on a job (or a tool under a kept job) it adds. */
export const ADDS = "Adds";

/** An update's mark on a job the member already had that gains a tool, in the kernel's compact form (no purpose line to mark). */
export const ADDS_TOOLS = "Adds tools";

/** An update's mark on a job the member already had. */
export const KEEPS = "Keeps";

/** The readiness block's heading (the kernel's own heading line is `readiness: checked by the kernel before you see it`). */
export const READINESS_HEADING = "Checked by the kernel before you see it";

export const COPY_ALL = "Copy all text";
export const SHOW_DETAILS = "Show full details";
export const HIDE_DETAILS = "Hide full details";

/** The alert a refused clipboard write shows (AC9). */
export const COPY_FAILED = "Did not copy: the clipboard refused it. Nothing was copied; select the text in the details to copy it by hand.";

/** How long a copy control shows its check. */
export const COPIED_MS = 2000;

/** Each readiness line's status in plain words, on its badge. */
export const READINESS_STATUS_LABELS: Readonly<Record<CharterReadinessStatus, string>> = Object.freeze({
  covered: "Covered",
  ready: "Ready",
  flagged: "Flagged",
  not_checked: "Not checked",
});

/** `<n> characters, nothing cut`: the line above the details blocks. */
export function totalLine(total: number): string {
  return `${count(total)} ${total === 1 ? "character" : "characters"}, nothing cut`;
}

/** `Copied <n> characters`: what a copy that worked says. */
export function copiedLine(chars: number): string {
  return `Copied ${count(chars)} ${chars === 1 ? "character" : "characters"}`;
}

/** What a copy said: which control, and whether the clipboard took it. */
interface CopyNote {
  readonly key: string;
  readonly ok: boolean;
  readonly chars: number;
}

export interface CharterDisplayProps {
  readonly parts: CharterDisplayParts;
  /** The display exactly as the kernel stored it (`approval.display`): what Copy all text writes, and what the details split. */
  readonly display: string;
  /** A control on a readiness line (Chat's Choose workspace), after its text. */
  readonly readinessFix?: (line: CharterReadinessLine, index: number) => ReactNode;
  /** Drawn after the readiness block, ahead of the details (Chat's workspace question). */
  readonly afterReadiness?: ReactNode;
  /** Drawn after the details (the Ask or change box). */
  readonly children?: ReactNode;
}

function Block({ block, copied, onCopy }: { readonly block: CharterBlock; readonly copied: boolean; readonly onCopy: (key: string, text: string) => void }) {
  const [more, setMore] = useState(false);
  const titleId = useId();
  const name = block.path === undefined ? block.title : `${block.title} (${printable(block.path)})`;
  return (
    <section className={more ? "approvals-charter-block open" : "approvals-charter-block"} aria-labelledby={titleId} data-testid={`charter-block-${block.kind}`}>
      <div className="approvals-charter-block-head">
        <span className="approvals-charter-block-title" id={titleId}>
          {block.title}
        </span>
        {block.path === undefined ? null : <code className="approvals-charter-block-path">{printable(block.path)}</code>}
        <span className="approvals-spacer" />
        <IconButton icon={more ? "less" : "more"} label={more ? `Show less of ${name}` : `Show more of ${name}`} aria-expanded={more} onClick={() => setMore((m) => !m)} />
        <IconButton icon={copied ? "copied" : "copy"} done={copied} tipAlign="right" label={`Copy ${name}`} onClick={() => onCopy(block.kind, block.text)} />
      </div>
      {/* Focusable so the arrow keys scroll it; named so a screen reader says which block. */}
      <pre className="approvals-pre approvals-charter-block-text" tabIndex={0} role="region" aria-label={name} data-testid="charter-block-text">
        {printable(block.text, true)}
      </pre>
    </section>
  );
}

export function CharterDisplay({ parts, display, readinessFix, afterReadiness, children }: CharterDisplayProps) {
  const headingId = useId();
  const readinessId = useId();
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [note, setNote] = useState<CopyNote | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const readiness = parts.readiness;
  const read = charterBlocks(display, parts);
  // No job line and no catalogue note: the charter grants no kernel tool.
  const jobsShown = parts.jobs.length > 0 || parts.note !== undefined;

  const copy = async (key: string, text: string): Promise<void> => {
    const copied = await copyText(text);
    clearTimeout(timer.current);
    if (!copied) {
      setNote({ key, ok: false, chars: 0 });
      return;
    }
    setNote({ key, ok: true, chars: text.length });
    timer.current = setTimeout(() => setNote((n) => (n?.key === key && n.ok ? null : n)), COPIED_MS);
  };
  const copiedOn = (key: string): boolean => note !== null && note.ok && note.key === key;
  const others = [
    read.otherTools.length === 0 ? "" : `Also uses ${read.otherTools.join(", ")}`,
    read.bashPrefixes.length === 0 ? "" : `runs commands that start with ${read.bashPrefixes.map((p) => `“${p}”`).join(", ")}`,
  ].filter((s) => s !== "");

  return (
    <div className="approvals-well approvals-charter" data-testid="approval-display">
      <div className="approvals-well-head">
        <span>Display</span>
        <span className="approvals-spacer" />
        <span className="approvals-well-note">untrusted text</span>
        <span className="approvals-charter-icons">
          <IconButton icon={copiedOn("all") ? "copied" : "copy"} done={copiedOn("all")} label={COPY_ALL} onClick={() => void copy("all", display)} />
          <IconButton
            icon={detailsOpen ? "collapse" : "expand"}
            tipAlign="right"
            label={detailsOpen ? HIDE_DETAILS : SHOW_DETAILS}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => setDetailsOpen((o) => !o)}
          />
        </span>
      </div>
      {note === null ? null : note.ok ? (
        <p className="approvals-charter-copied" role="status" data-testid="charter-copied">
          {copiedLine(note.chars)}
        </p>
      ) : (
        <p className="approvals-charter-copy-failed" role="alert" data-testid="charter-copy-failed">
          {COPY_FAILED}
        </p>
      )}
      <section className="approvals-charter-plain" aria-labelledby={jobsShown ? headingId : readinessId} data-testid="charter-plain">
        <p className="approvals-charter-who" data-testid="charter-head">
          {printable(parts.head)}
        </p>
        {jobsShown ? (
          <h3 className="approvals-label approvals-charter-heading" id={headingId}>
            {JOBS_HEADING}
          </h3>
        ) : null}
        {!jobsShown ? null : parts.note === undefined ? (
          <ul className="approvals-charter-jobs" data-testid="charter-jobs">
            {parts.jobs.map((job, i) => (
              // Labels may repeat in a malformed display; the position keeps keys unique.
              <li className="approvals-charter-job" key={i} data-testid="charter-job">
                <span className="approvals-charter-job-head">
                  <span className="approvals-charter-job-label">{printable(job.label)}</span>
                  {parts.update ? <Badge>{job.added ? ADDS : job.gainsTools === true ? ADDS_TOOLS : KEEPS}</Badge> : null}
                </span>
                {job.purposes.length === 0 ? null : (
                  <>
                    <span className="approvals-charter-usedfor">Used for:</span>
                    <ul className="approvals-charter-purposes">
                      {job.purposes.map((purpose, j) => (
                        <li key={j}>
                          {printable(purpose.text)}
                          {purpose.added ? (
                            <>
                              {" "}
                              <Badge>{ADDS}</Badge>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="approvals-charter-note" data-testid="charter-note">
            {printable(parts.note)}
          </p>
        )}
        {others.length === 0 ? null : (
          <p className="approvals-charter-others" data-testid="charter-others">
            {printable(`${others.join("; ")}.`)}
          </p>
        )}
        {read.never === undefined ? null : (
          <>
            <h3 className="approvals-label approvals-charter-heading">{NEVER_HEADING}</h3>
            <p className="approvals-charter-never" data-testid="charter-never">
              {read.never.length === 0 ? "Nothing listed" : printable(read.never.join("; "))}
            </p>
          </>
        )}
        {read.limits === undefined ? null : (
          <>
            <h3 className="approvals-label approvals-charter-heading">{LIMITS_HEADING}</h3>
            <p className="approvals-charter-limits" data-testid="charter-limits">
              {printable(read.limits)}
            </p>
          </>
        )}
        {readiness === undefined ? null : (
          <>
            <h3 className="approvals-label approvals-charter-heading" id={readinessId}>
              {READINESS_HEADING}
            </h3>
            <ul className="approvals-charter-readiness" aria-labelledby={readinessId} data-testid="charter-readiness">
              {readiness.map((line, i) => (
                // Lines may repeat (two duties with the same text); the position keeps keys unique.
                <li className="approvals-charter-readiness-line" key={i} data-testid="charter-readiness-line" data-status={line.status}>
                  <Badge tone={readinessIsOpen(line.status) ? "attention" : "neutral"}>{READINESS_STATUS_LABELS[line.status]}</Badge>
                  <span className="approvals-charter-readiness-text">{printable(line.text)}</span>
                  {readinessFix?.(line, i) ?? null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {afterReadiness}
      {/* The Show full details icon is the control; the summary stays for the element's semantics only (hidden). */}
      <details className="approvals-charter-raw" id={detailsId} open={detailsOpen} data-testid="charter-raw" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary className="approvals-charter-raw-summary" tabIndex={-1}>
          {RAW_SUMMARY}
        </summary>
        {/* Rendered only when shown: a display may be 64,000 characters. */}
        {detailsOpen ? (
          <div className="approvals-charter-details">
            <p className="approvals-charter-total" data-testid="charter-total">
              {totalLine(read.total)}
            </p>
            {read.blocks.map((block) => (
              <Block key={block.kind} block={block} copied={copiedOn(block.kind)} onCopy={(key, text) => void copy(key, text)} />
            ))}
          </div>
        ) : null}
      </details>
      {children}
    </div>
  );
}
