// Marks the Schedules screen draws: the kind icons of the timeline and the trigger
// list (once, cron, poll, wake-up, and the generic trigger icon used until a
// trigger's kind is known) and two small glyphs. Each is decorative (`aria-hidden`):
// the text beside it names the thing.
import type { ReactNode } from "react";
import type { TriggerIcon } from "./model";

function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg className="schedules-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const CLOCK = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
);

/** The icon for a kind: a bell for a one-off, a pulse for a poll, a bolt for a trigger whose kind is not known yet, else a clock (cron and wake-up). */
export function KindIcon({ kind }: { readonly kind: TriggerIcon }) {
  if (kind === "once") {
    return (
      <Glyph>
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16ZM10 21h4" />
      </Glyph>
    );
  }
  if (kind === "poll") {
    return (
      <Glyph>
        <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
      </Glyph>
    );
  }
  if (kind === "trigger") {
    return (
      <Glyph>
        <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
      </Glyph>
    );
  }
  return <Glyph>{CLOCK}</Glyph>;
}

export const WarnGlyph = () => (
  <Glyph>
    <path d="M12 8v5M12 16h.01M4.9 19h14.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.2 16a2 2 0 0 0 1.7 3Z" />
  </Glyph>
);

export const RefreshGlyph = () => (
  <Glyph>
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" />
  </Glyph>
);

/** Four placeholder rows while a read is in flight; `what` is the status text's object ("Loading the schedule"). */
export function Skeleton({ testId, what }: { readonly testId: string; readonly what: string }) {
  return (
    <div className="schedules-skels" data-testid={testId} aria-busy="true">
      <span className="schedules-sr-only" role="status">
        {`Loading ${what}`}
      </span>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="schedules-skel" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
