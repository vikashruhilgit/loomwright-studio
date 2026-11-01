// Crumb: the one Back control of a click-through view, drawn "‹ Parent / Current" as the mockup's
// `.crumb` does. The chevron and the parent's name are ONE button (the only focusable part); a `/`
// separator (`aria-hidden`) and the current view's name, plain text, follow it. The button's
// accessible name says where Back goes ("Back" plus the parent), so the visible
// label (the parent) is inside it.
//
// Settled props (Tasks, Playbooks and Memory adopt this in their own items, so none is added,
// renamed or made optional here): `parent`, `current`, `onBack`, the screen's own `className` and
// `glyphClassName` (like `Glyph`, the crumb carries no CSS of its own), and the optional `testId`
// and `ref` (React 19 takes `ref` as a prop; a screen focuses the button when its view opens).
import type { Ref } from "react";
import { Icon } from "../components/icons";
import { Button } from "../components/Button/Button";

export interface CrumbProps {
  /** The view Back returns to, for example "Budget & audit". */
  readonly parent: string;
  /** The view the owner is in, for example "Audit log". Plain text, not focusable. */
  readonly current: string;
  readonly onBack: () => void;
  /** The screen's own class for the crumb row, for example `budget-crumb`. */
  readonly className: string;
  /** The screen's own class for the chevron svg, for example `budget-glyph`. */
  readonly glyphClassName: string;
  readonly testId?: string;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Crumb({ parent, current, onBack, className, glyphClassName, testId, ref }: CrumbProps) {
  return (
    <div className={className}>
      <Button ref={ref} size="row" variant="ghost" icon={<Icon name="back" className={glyphClassName} />} aria-label={`Back to ${parent}`} data-testid={testId} onClick={onBack}>
        {parent}
      </Button>
      <span aria-hidden="true">/</span>
      <span>{current}</span>
    </div>
  );
}
