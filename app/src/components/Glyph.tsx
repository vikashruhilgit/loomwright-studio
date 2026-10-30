// Glyph and WarnGlyph: the 24px line-icon frame and the warning triangle that screens draw beside
// a message. Decorative (`aria-hidden`): the text beside each one names the thing. The component
// carries no CSS of its own; the caller passes the class its screen styles (`budget-glyph`).
import type { ReactNode } from "react";

export interface GlyphProps {
  /** The screen's own class for the svg, for example `budget-glyph`. */
  readonly className: string;
  readonly children: ReactNode;
}

export function Glyph({ className, children }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function WarnGlyph({ className }: { readonly className: string }) {
  return (
    <Glyph className={className}>
      <path d="M12 8v5M12 16h.01M4.9 19h14.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.2 16a2 2 0 0 0 1.7 3Z" />
    </Glyph>
  );
}
