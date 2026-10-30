// Marks and small parts the Budget & audit screen draws: the meter, the limit cell, the loading
// skeleton and three glyphs. The glyphs are decorative (`aria-hidden`): the text beside each one
// names the thing. Every meter is in tokens (a share of a limit, the busiest day or a cap window),
// never in dollars, and carries `role="img"` with an `aria-label` that says what it measures.
import type { ReactNode } from "react";
import { Badge } from "../../components/Badge/Badge";
import type { LimitFigure } from "./model";
import { formatTokens, limitLabel, limitMeterLabel } from "./model";

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg className="budget-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const WarnGlyph = () => (
  <Glyph>
    <path d="M12 8v5M12 16h.01M4.9 19h14.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.2 16a2 2 0 0 0 1.7 3Z" />
  </Glyph>
);

export const HistoryGlyph = () => (
  <Glyph>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
  </Glyph>
);

export const BackGlyph = () => (
  <Glyph>
    <path d="m15 18-6-6 6-6" />
  </Glyph>
);

/** A bar: `percent` of its track, `full` when it is at a limit. The width is the only inline style; every colour is a token in the stylesheet. */
export function Meter({ percent, label, full = false }: { readonly percent: number; readonly label: string; readonly full?: boolean }) {
  return (
    <div className="budget-meter" role="img" aria-label={label} data-full={full ? "true" : undefined}>
      <i style={{ width: `${percent}%` }} />
    </div>
  );
}

/** "61,900 of 100,000" with its meter and, at the limit, an "at limit" badge and a full meter; "no limit set" under a bare number otherwise. */
export function LimitCell({ figure, testId }: { readonly figure: LimitFigure; readonly testId: string }) {
  if (figure.limit === null) {
    return (
      <div className="budget-limit" data-testid={testId}>
        <span className="budget-tn">
          <b>{limitLabel(figure)}</b>
        </span>
        <span className="budget-cap">no limit set</span>
      </div>
    );
  }
  return (
    <div className="budget-limit" data-testid={testId} data-at-limit={figure.atLimit ? "true" : "false"}>
      <span className="budget-limit-line">
        <span className="budget-tn">
          <b>{formatTokens(figure.tokens)}</b> of {formatTokens(figure.limit)}
        </span>
        {figure.atLimit ? <Badge tone="attention">at limit</Badge> : null}
      </span>
      <Meter percent={figure.percent} label={limitMeterLabel(figure)} full={figure.atLimit} />
    </div>
  );
}

/** Four placeholder rows while a read is in flight; `what` is the status text's object ("Loading usage"). */
export function Skeleton({ testId, what }: { readonly testId: string; readonly what: string }) {
  return (
    <div className="budget-skels" data-testid={testId} aria-busy="true">
      <span className="budget-sr-only" role="status">
        {`Loading ${what}`}
      </span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="budget-skel" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
