// A held charter create or update's display in plain language (phase 8 item
// 16, AC3; the approved mockup `docs/design/mockups/chat-threads.html`,
// `charterCard` and `rawHTML`). The kernel writes the display
// (`createDisplay` / `updateDisplay` in `kernel/src/agents/charter-tools.ts`);
// `charterDisplayParts` splits it, and this draws:
//
// 1. who the change is for; the kernel's readiness block when it wrote one
//    (phase 8 item 18b: one line per duty, covered or flagged, then one per
//    job prerequisite, ready, flagged or not checked), each line's status as a
//    `Badge` in plain words, flagged and not-checked lines in the `attention`
//    tone (a kernel state the owner should see before approving); then the
//    granted kernel tools grouped by job, each
//    with its purpose line (the job labels alone when the kernel wrote its
//    compact form, for a charter granting too many tools to list each),
//    ahead of any `mcp__kernel__` name. An update marks each job "Adds" (the
//    member held no tool of it) or "Keeps", and a new tool under a kept job
//    "Adds"; in the compact form, which lists no tool, such a kept job is
//    "Adds tools" instead of "Keeps" (docs/DESIGN.md: "An update shows the
//    jobs it adds and the jobs it keeps");
// 2. beneath, in a disclosure "Kernel tool names, as enforced", every other
//    line exactly as the kernel wrote it: the field lines, the `enforced:`
//    line (non-kernel tools and Bash prefixes as they always were), limits,
//    workspaces and the files.
//
// The disclosure starts open: it carries more than the raw names (the non-kernel
// tools, Bash prefixes, limits and workspaces the owner has always seen), so
// nothing the owner approves is hidden by default; the owner may close it.
// When the kernel's catalogue was unavailable it shows the kernel's own note
// and no grouping, never a guessed one (AC9). A display with no readiness
// block (an approval held before the kernel wrote one) draws exactly as it
// did before; one whose charter grants no kernel tool shows the readiness
// block alone, with no empty jobs heading.
//
// Every part is untrusted text: it goes through `printable` and is rendered as
// a React text child, never markup.
import { useId } from "react";
import { Badge } from "../../components/Badge/Badge";
import { readinessIsOpen } from "./subject";
import type { CharterDisplayParts, CharterReadinessStatus } from "./subject";
import { printable } from "./printable";
import "./approvals.css";

/** The disclosure's summary (the mockup's `rawHTML`). */
export const RAW_SUMMARY = "Kernel tool names, as enforced";

/** The plain block's heading (the mockup's `charterCard`). */
export const JOBS_HEADING = "What it may do in the kernel";

/** An update's mark on a job (or a tool under a kept job) it adds. */
export const ADDS = "Adds";

/** An update's mark on a job the member already had that gains a tool, in the kernel's compact form (no purpose line to mark). */
export const ADDS_TOOLS = "Adds tools";

/** An update's mark on a job the member already had. */
export const KEEPS = "Keeps";

/** The readiness block's heading (the kernel's own heading line is `readiness: checked by the kernel before you see it`). */
export const READINESS_HEADING = "Checked by the kernel before you see it";

/** Each readiness line's status in plain words, on its badge. */
export const READINESS_STATUS_LABELS: Readonly<Record<CharterReadinessStatus, string>> = Object.freeze({
  covered: "Covered",
  ready: "Ready",
  flagged: "Flagged",
  not_checked: "Not checked",
});

export interface CharterDisplayProps {
  readonly parts: CharterDisplayParts;
}

export function CharterDisplay({ parts }: CharterDisplayProps) {
  const headingId = useId();
  const readinessId = useId();
  const readiness = parts.readiness;
  // No job line and no catalogue note: the charter grants no kernel tool, so the readiness block is the whole plain block.
  const jobsShown = parts.jobs.length > 0 || parts.note !== undefined;
  return (
    <div className="approvals-well" data-testid="approval-display">
      <div className="approvals-well-head">
        <span>Display</span>
        <span className="approvals-spacer" />
        <span className="approvals-well-note">untrusted text</span>
      </div>
      <section className="approvals-charter-plain" aria-labelledby={jobsShown ? headingId : readinessId} data-testid="charter-plain">
        <p className="approvals-charter-who" data-testid="charter-head">
          {printable(parts.head)}
        </p>
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
                </li>
              ))}
            </ul>
          </>
        )}
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
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="approvals-charter-note" data-testid="charter-note">
            {printable(parts.note)}
          </p>
        )}
      </section>
      {parts.raw === "" ? null : (
        <details className="approvals-charter-raw" open data-testid="charter-raw">
          <summary className="approvals-charter-raw-summary">{RAW_SUMMARY}</summary>
          <pre className="approvals-pre">{printable(parts.raw, true)}</pre>
        </details>
      )}
    </div>
  );
}
