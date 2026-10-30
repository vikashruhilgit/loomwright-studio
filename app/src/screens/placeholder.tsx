// The shared "coming in this phase" placeholder of phase 7's six screens
// (Tasks, Playbooks, Schedules, Memory, Budget & audit, Settings) until each
// item builds its own. It lives here, not in a screen directory, because the
// shell globs only `./screens/*/index.tsx`, so this module is never mounted as
// a screen. A screen item replaces its `index.tsx` Component and leaves this file.
import type { CSSProperties } from "react";

export interface ScreenPlaceholderProps {
  /** The screen's id; the test id is `screen-<id>`, as every screen's root. */
  readonly id: string;
  /** The screen's name, shown as the placeholder's title. */
  readonly title: string;
  /** What the screen will show, in one plain sentence. */
  readonly note: string;
}

const wrap: CSSProperties = { padding: "var(--space-12) var(--space-6)", maxWidth: 640 };
const heading: CSSProperties = {
  margin: "0 0 var(--space-2)",
  fontSize: "var(--type-display-size)",
  lineHeight: "var(--type-display-line)",
  fontWeight: "var(--type-display-weight)",
  letterSpacing: "var(--type-display-tracking)",
};
const note: CSSProperties = { margin: 0, color: "var(--ink-secondary)" };

/** The screen body: its name, "Coming in this phase", and what it will show. */
export function ScreenPlaceholder({ id, title, note: what }: ScreenPlaceholderProps) {
  return (
    <section style={wrap} data-testid={`screen-${id}`} data-state="placeholder" aria-label={title}>
      <p style={heading}>Coming in this phase</p>
      <p style={note}>{what}</p>
    </section>
  );
}
