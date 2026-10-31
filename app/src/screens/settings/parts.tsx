// Marks the Settings screen draws: the warning glyph of the band and the failure card, the
// status dot, the loading skeleton and the on/off switch. Each glyph is decorative
// (`aria-hidden`): the text beside it names the thing.
import type { ReactNode } from "react";
import type { Tone } from "./model";

export const WarnGlyph = () => (
  <svg className="settings-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 8v5M12 16h.01M4.9 19h14.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.2 16a2 2 0 0 0 1.7 3Z" />
  </svg>
);

/** A status dot: its colour is the tone, and the word beside it (always present) is the signal. */
export function Dot({ tone }: { readonly tone: Tone }) {
  return <span className="settings-dot" data-tone={tone} aria-hidden="true" />;
}

/** `rows` placeholder rows while a read is in flight; `what` is the status text's object ("Loading the auth provider"). */
export function Skeleton({ testId, what, rows }: { readonly testId: string; readonly what: string; readonly rows: number }) {
  return (
    <div className="settings-skels" data-testid={testId} aria-busy="true">
      <span className="settings-sr-only" role="status">
        {`Loading ${what}`}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="settings-skel" aria-hidden="true">
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

export interface SwitchProps {
  readonly checked: boolean;
  /** The accessible name, which says the state ("Launch at login is on"). */
  readonly label: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly testId: string;
  readonly onToggle: () => void;
}

/** A `role="switch"` button: Tab reaches it, Space and Enter flip it. */
export function Switch({ checked, label, busy, disabled, testId, onToggle }: SwitchProps): ReactNode {
  return (
    <button type="button" role="switch" className="settings-sw" aria-checked={checked} aria-label={label} aria-busy={busy ? "true" : undefined} disabled={disabled} data-testid={testId} onClick={onToggle} />
  );
}
