// The merge approval card (phase 8 item 13): what a pending
// `kernel_merge_approval_request` approval says, drawn so the owner can read it
// before allowing it. The facts come from `mergeApprovalOf` (read from the
// payload by type only); a field the request did not carry, or carried in the
// wrong type, reads "not in the request", never a guess.
//
// - The PR URL is text, never a link: Electron's open-external allowlist does
//   not admit PR addresses, and an `href` is never built from a payload value
//   (Chat's convention for a PR in its integration cards).
// - Every payload string goes through `printable`.
// - Approving does not merge: Loomwright's gate merges the PR when its own
//   checks pass (invariant 4). The only decisions are the screen's Allow once
//   and Deny, and no control's text says merge; there is no standing allowance
//   for a merge, so the screen offers no "Always".
import { useId } from "react";
import type { ReactNode } from "react";
import type { MergeApproval } from "./subject";
import { printable } from "./printable";
import "./approvals.css";

/** What a field the request did not carry reads. */
export const NOT_IN_REQUEST = "not in the request";

export interface MergeApprovalCardProps {
  readonly merge: MergeApproval;
}

/** The PR's address, shown as text. `merge.repo` and `merge.pr` were validated by `mergeApprovalOf`, so it is always `https://github.com/<owner>/<repo>/pull/<n>`. */
function prUrl(merge: MergeApproval): string {
  return `https://github.com/${merge.repo}/pull/${merge.pr}`;
}

function Row({ label, testId, children }: { readonly label: string; readonly testId: string; readonly children: ReactNode }) {
  return (
    <div className="approvals-merge-row">
      <dt className="approvals-label">{label}</dt>
      <dd className="approvals-merge-value" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/** A free-text fact: its escaped text, or "not in the request". */
function Fact({ value }: { readonly value: string | undefined }) {
  return value === undefined ? (
    <span className="approvals-merge-missing" data-missing="true">
      {NOT_IN_REQUEST}
    </span>
  ) : (
    <span className="approvals-merge-text">{printable(value)}</span>
  );
}

export function MergeApprovalCard({ merge }: MergeApprovalCardProps) {
  const titleId = useId();
  return (
    <section className="approvals-merge" aria-labelledby={titleId} data-testid="merge-card">
      <header className="approvals-merge-head">
        <h3 className="approvals-merge-title" id={titleId}>
          Allow PR #{merge.pr} to go to Loomwright's gate
        </h3>
      </header>
      <dl className="approvals-merge-body">
        <Row label="Pull request" testId="merge-pr">
          <span className="approvals-merge-pr">#{merge.pr}</span>
          <code className="approvals-mono" data-testid="merge-url">
            {prUrl(merge)}
          </code>
        </Row>
        <Row label="Repo" testId="merge-repo">
          <code className="approvals-mono">{printable(merge.repo)}</code>
        </Row>
        <Row label="Head commit" testId="merge-head">
          {/* The short form is what is read; the full SHA is its title (hover and accessible description). */}
          <code className="approvals-mono" title={merge.headSha} data-testid="merge-head-sha">
            {merge.headSha.slice(0, 7)}
          </code>
          <span className="approvals-merge-note">this approval names this commit</span>
        </Row>
        <Row label="CI" testId="merge-ci">
          <Fact value={merge.ci} />
        </Row>
        <Row label="Loomwright READY" testId="merge-ready">
          <Fact value={merge.readyAt} />
        </Row>
        <Row label="Repo policy" testId="merge-policy">
          <Fact value={merge.policy} />
        </Row>
      </dl>
      <p className="approvals-merge-gate" data-testid="merge-gate">
        <strong>Approving does not merge.</strong> Loomwright's gate merges the PR when its own checks pass. A merge is asked every time, so there is no standing allowance for it.
      </p>
    </section>
  );
}
