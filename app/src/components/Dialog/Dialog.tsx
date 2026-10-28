// Dialog (docs/design/design-system/components/Dialog): interrupts for one
// decision. 360px (480px with `wide`, for a diff) on `surface-raised`,
// `radius-lg`, `shadow-3`, `space-5` padding, over `overlay`. Opens on
// `duration-slow` `ease-enter` from scale 0.98; closes on `duration-fast`.
//
// Two kinds:
// - `confirm` (destructive): `role="alertdialog"`, a 32px `danger-soft` icon
//   disc, a question, the consequence in numbers, then Cancel and a `danger`
//   button whose label repeats the verb. Escape does NOT close it: a
//   destructive confirm is only left through one of its two buttons
//   (requirement Scope 2; the README's "Esc cancels" applies to `decision`).
//   Its Cancel therefore carries no `Esc` chip.
// - `decision`: `role="dialog"`, the exact action in a `mono` well
//   (`payload`), an optional narrowing `checkbox`, then Cancel (`Esc`) and the
//   primary. Escape calls `onCancel`.
//
// The action row is always exactly two buttons, Cancel and `action`, so "at
// most two buttons" holds by construction. `action.kbd` is the primary's chip
// only; wiring that shortcut is the caller's job.
//
// Focus: on open, focus moves to the first non-destructive control (never a
// `danger` button; the panel itself if nothing else qualifies), Tab and
// Shift+Tab cycle inside the panel, and on close (Cancel, a handler, Escape,
// or unmount) focus returns to the element that had it when the dialog opened.
//
// Contract: one dialog at a time. Dialogs never stack; the caller must not
// open a second while one is open (README "Don't: stack dialogs").
//
// Closing: pass `open={false}` to play the `duration-fast` exit before the
// panel leaves the DOM; unmounting directly skips the exit animation.
//
// `inline` renders the panel in flow: no overlay, no portal, no focus trap, no
// initial-focus move and no Escape handling. It exists only for the component
// gallery's static states.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../Button/Button";
import "./Dialog.css";
import { useModalFocus } from "./useModalFocus";

export type DialogKind = "confirm" | "decision";

export interface DialogAction {
  /** Sentence case; for `confirm`, repeat the verb of the question ("Kill all"). */
  readonly label: string;
  readonly onAction: () => void;
  /** The primary's shortcut chip, for example "⌘⏎". */
  readonly kbd?: string;
  /** Announces the shortcut, for example "Meta+Enter". */
  readonly keyshortcuts?: string;
}

export interface DialogCheckbox {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export interface DialogProps {
  readonly kind: DialogKind;
  readonly title: string;
  readonly description: ReactNode;
  /** The exact action, shown in a mono well. */
  readonly payload?: string;
  /** An optional narrowing checkbox (decision dialogs). */
  readonly checkbox?: DialogCheckbox;
  /** The primary action: `danger` for `confirm`, `primary` for `decision`. */
  readonly action: DialogAction;
  /** Called by Cancel, and by Escape on a `decision` dialog. */
  readonly onCancel: () => void;
  readonly cancelLabel?: string;
  /** Body content for rename and create dialogs (a text field). */
  readonly children?: ReactNode;
  /** 480px instead of 360px, for a payload that is a diff. */
  readonly wide?: boolean;
  /** Replaces the default × in the confirm icon disc. */
  readonly icon?: ReactNode;
  /** Defaults to true. `false` plays the exit animation, then unmounts. */
  readonly open?: boolean;
  /** Gallery only: in flow, no overlay, no trap, no focus move. */
  readonly inline?: boolean;
}

/** The longest computed animation duration of `el`, in ms (0 when none, as in jsdom). */
function animationMs(el: HTMLElement | null): number {
  if (!el) return 0;
  const value = getComputedStyle(el).getPropertyValue("animation-duration");
  return value
    .split(",")
    .map((part) => part.trim())
    .reduce((max, part) => {
      const ms = part.endsWith("ms") ? parseFloat(part) : part.endsWith("s") ? parseFloat(part) * 1000 : 0;
      return Number.isFinite(ms) && ms > max ? ms : max;
    }, 0);
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.4 5.6 5.6 18.4M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

export function Dialog({
  kind,
  title,
  description,
  payload,
  checkbox,
  action,
  onCancel,
  cancelLabel = "Cancel",
  children,
  wide = false,
  icon,
  open = true,
  inline = false,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const checkboxId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  // The document listeners read the latest kind and handler without re-subscribing.
  const latest = useRef({ kind, onCancel });
  useLayoutEffect(() => {
    latest.current = { kind, onCancel };
  });

  const modal = open && !inline;
  // Escape closes a decision only; a confirm is left through its two buttons.
  useModalFocus(panelRef, modal, () => {
    if (latest.current.kind === "decision") latest.current.onCancel();
  });

  // Exit: keep the panel for its `duration-fast` animation, then unmount.
  useEffect(() => {
    if (open || !mounted) return;
    const ms = animationMs(panelRef.current);
    if (ms <= 0) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), ms);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  if (!mounted) return null;

  const panel = (
    <div
      ref={panelRef}
      className="dialog-panel"
      role={kind === "confirm" ? "alertdialog" : "dialog"}
      aria-modal={inline ? undefined : "true"}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-kind={kind}
      data-wide={wide ? "true" : undefined}
      data-inline={inline ? "true" : undefined}
      tabIndex={-1}
    >
      {kind === "confirm" ? (
        <span className="dialog-icon" aria-hidden="true">
          {icon ?? <CloseIcon />}
        </span>
      ) : null}
      <h2 className="dialog-title" id={titleId}>
        {title}
      </h2>
      <div className="dialog-description" id={descriptionId}>
        {description}
      </div>
      {payload !== undefined ? <pre className="dialog-well">{payload}</pre> : null}
      {checkbox ? (
        <div className="dialog-check">
          <input
            id={checkboxId}
            type="checkbox"
            className="dialog-checkbox"
            checked={checkbox.checked}
            onChange={(event) => checkbox.onChange(event.target.checked)}
          />
          <label htmlFor={checkboxId}>{checkbox.label}</label>
        </div>
      ) : null}
      {children}
      <div className="dialog-actions">
        <Button variant="secondary" kbd={kind === "decision" ? "Esc" : undefined} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          variant={kind === "confirm" ? "danger" : "primary"}
          kbd={action.kbd}
          aria-keyshortcuts={action.keyshortcuts}
          onClick={action.onAction}
        >
          {action.label}
        </Button>
      </div>
    </div>
  );

  if (inline) return panel;
  return createPortal(
    <div className="dialog-overlay" data-state={open ? "open" : "closing"} inert={!open}>
      {panel}
    </div>,
    document.body,
  );
}
