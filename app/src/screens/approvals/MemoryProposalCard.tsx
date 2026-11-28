// The memory proposal card (wa-f): what a pending `kernel_memory_propose`
// approval asks, drawn so the owner reads it before allowing it. An agent
// proposes one entry for its own lessons, preferences or people file; on Allow
// once the kernel appends it, dated, to `memory/<agent>/<file>.md`.
//
// - The facts come from `memoryProposalOf`, read from the rail payload's
//   `input` by type only (the kernel's applier reads the same fields); the
//   agent is the approval's `requesting_agent` (the session's, never the input).
// - The entry is plain text; the evidence sits in a well marked as untrusted
//   data. Every payload string goes through `printable` and is rendered as
//   React text, never as markup.
// - A proposal is asked every time: the screen offers Allow once and Deny only
//   (`isMemoryProposal` is the screen's no-Always gate, keyed on the action).
import { useId } from "react";
import type { Approval } from "../../api/contract";
import { payloadTool } from "./kernel-mirror";
import { printable } from "./printable";
import "./approvals.css";

/** The action the rail files a memory proposal under (the kernel's `MEMORY_PROPOSE_TOOL_NAME`). */
export const MEMORY_PROPOSAL_ACTION = "kernel_memory_propose";

/** Why `always` is never sent for a memory proposal. */
export const MEMORY_ALWAYS_REFUSED = "A memory entry is asked every time, so there is no standing allowance for it. Nothing was sent; allow it once or deny it.";

/** What a memory proposal says. Raw text: rendered through `printable`. */
export interface MemoryProposal {
  /** `memory/<agent>/<file>.md`. */
  readonly path: string;
  readonly entry: string;
  readonly evidence: string;
}

/** Whether `a` is a memory proposal, by its action alone: the no-Always gate keys on this, never on whether the fields read. */
export function isMemoryProposal(a: Approval): boolean {
  return a.action === MEMORY_PROPOSAL_ACTION;
}

const FILES: readonly string[] = ["lessons", "preferences", "people"];

/** The proposal an approval carries, or `undefined` when it is not one or a field does not read (no card then; the payload well still shows it). */
export function memoryProposalOf(a: Approval): MemoryProposal | undefined {
  if (!isMemoryProposal(a) || payloadTool(a.payload) !== `mcp__kernel__${MEMORY_PROPOSAL_ACTION}`) return undefined;
  const input = (a.payload as { input?: unknown }).input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const { file, entry, evidence } = input as Record<string, unknown>;
  if (typeof file !== "string" || !FILES.includes(file) || typeof entry !== "string" || typeof evidence !== "string") return undefined;
  return { path: `memory/${a.requesting_agent}/${file}.md`, entry, evidence };
}

export interface MemoryProposalCardProps {
  readonly proposal: MemoryProposal;
}

export function MemoryProposalCard({ proposal }: MemoryProposalCardProps) {
  const titleId = useId();
  return (
    <section className="approvals-merge" aria-labelledby={titleId} data-testid="memory-card">
      <header className="approvals-merge-head">
        <h3 className="approvals-merge-title" id={titleId}>
          Add an entry to <code className="approvals-mono" data-testid="memory-path">{printable(proposal.path)}</code>
        </h3>
      </header>
      <dl className="approvals-merge-body">
        <div className="approvals-merge-row">
          <dt className="approvals-label">Entry</dt>
          <dd className="approvals-merge-value">
            <p className="approvals-merge-text" data-testid="memory-entry">
              {printable(proposal.entry)}
            </p>
          </dd>
        </div>
      </dl>
      <div className="approvals-well">
        <div className="approvals-well-head">
          <span>Evidence</span>
          <span className="approvals-spacer" />
          <span className="approvals-well-note">untrusted text</span>
        </div>
        <pre className="approvals-pre" data-testid="memory-evidence">
          {printable(proposal.evidence, true)}
        </pre>
      </div>
      <p className="approvals-merge-gate" data-testid="memory-gate">
        <strong>Nothing is written until you allow it.</strong> On Allow once the kernel appends this entry, dated, to the file. A memory entry is asked every time.
      </p>
    </section>
  );
}
