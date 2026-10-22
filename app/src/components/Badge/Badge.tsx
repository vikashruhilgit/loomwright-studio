// Badge and its family of marks (docs/design/design-system/components/Badge).
//
// - `Badge`: a short fact in a colour. Semantic tones (`ok`, `attention`,
//   `danger`, `parked`, `accent`) put the strong colour on its `*-soft` ground;
//   `neutral` is `ink-secondary` on `surface-sunken`. Semantic colour is only
//   for a kernel state or a verified outcome; everything else is neutral.
//   `icon` is a 12px `currentColor` slot (no icon library ships here).
// - `CountPill`: the attention-filled count on Approvals. `aria-label` is
//   required and carries the unit ("3 pending").
// - `Chip`: an agent (pass the 14px avatar in the `avatar` slot) or a linked PR
//   or ticket, on `surface` with a `hairline` edge.
// - `Kbd`: a shortcut chip. `Mono`: an inline dedupe key or path.
// None of these is a button.
import type { ReactNode } from "react";
import "./Badge.css";

export type BadgeTone = "ok" | "attention" | "danger" | "parked" | "accent" | "neutral";

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
}

export function Badge({ tone = "neutral", icon, children }: BadgeProps) {
  return (
    <span className="badge" data-tone={tone}>
      {icon ? (
        <span className="badge-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export interface CountPillProps {
  readonly count: number;
  /** Required: the count with its unit, for example "3 pending". */
  readonly "aria-label": string;
}

export function CountPill({ count, "aria-label": label }: CountPillProps) {
  return (
    <span className="count-pill" role="img" aria-label={label}>
      {count}
    </span>
  );
}

export interface ChipProps {
  /** The agent's 14px avatar. A slot: this component never imports Avatar. */
  readonly avatar?: ReactNode;
  readonly children: ReactNode;
}

export function Chip({ avatar, children }: ChipProps) {
  return (
    <span className="chip">
      {avatar ? <span className="chip-avatar">{avatar}</span> : null}
      <span className="chip-label">{children}</span>
    </span>
  );
}

export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Mono({ children }: { readonly children: ReactNode }) {
  return <code className="mono">{children}</code>;
}
