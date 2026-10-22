// Toast and Band (docs/design/design-system/components/Toast): two kinds of feedback.
//
// - `Toast` confirms an outcome of the user's own action and goes away: 360px
//   on `surface-raised` with `shadow-2`, a StatusDot, one bold clause then one
//   plain clause, at most one `accent` action, and a dismiss. `role="status"`.
//   It auto-dismisses after `TOAST_DURATION_MS` (6 s); hovering it, or focusing
//   a control inside it, pauses the countdown and leaving resumes the remaining
//   time. `duration={null}` turns auto-dismiss off (gallery states). Dismissing
//   (timer or ×) plays the `duration-fast` leave, then calls `onDismiss`.
//   Never a toast for something that needs a decision: that is an approval.
// - `ToastStack` places toasts bottom-right with `position: fixed`, so a toast
//   arriving or leaving never moves the main content. Put it inside a
//   transformed main column to anchor it there instead of the window. It shows
//   at most `MAX_VISIBLE_TOASTS` (the newest); older ones collapse into an
//   "N earlier" line and wait, timer not running, until a slot frees.
// - `Band` is persistent, full width at the top of the main column on a
//   `*-soft` ground: `danger` (kernel unreachable, `role="alert"`), `parked`
//   (paused at cap) and `attention` (approvals waiting). It has no timer; it
//   leaves when the caller's condition clears.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StatusDot, type StatusDotProps } from "../StatusDot/StatusDot";
import "./Toast.css";

export const MAX_VISIBLE_TOASTS = 3;
export const TOAST_DURATION_MS = 6000;

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void;
}

export interface ToastProps {
  /** The StatusDot beside the text. `ok` needs `verified` to show as ok (honest status). */
  readonly status: Omit<StatusDotProps, "hideLabel" | "meta">;
  /** The bold clause: what happened. */
  readonly title: string;
  /** The plain clause: what follows. */
  readonly body?: string;
  /** At most one action, in accent. */
  readonly action?: ToastAction;
  readonly onDismiss: () => void;
  readonly dismissLabel?: string;
  /** Auto-dismiss delay in ms; `null` turns auto-dismiss off. */
  readonly duration?: number | null;
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

export function Toast({ status, title, body, action, onDismiss, dismissLabel = "Dismiss", duration = TOAST_DURATION_MS }: ToastProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  const timer = useRef<number | undefined>(undefined);
  const remaining = useRef(0);
  const startedAt = useRef(0);
  const hovered = useRef(false);
  const focused = useRef(false);

  const clear = () => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  };
  const leave = useCallback(() => {
    clear();
    setLeaving(true);
  }, []);
  const start = useCallback(() => {
    clear();
    startedAt.current = Date.now();
    timer.current = window.setTimeout(leave, Math.max(0, remaining.current));
  }, [leave]);
  const pause = () => {
    if (timer.current === undefined) return;
    clear();
    remaining.current -= Date.now() - startedAt.current;
  };
  const resume = () => {
    if (duration === null || leaving || hovered.current || focused.current) return;
    start();
  };

  useEffect(() => {
    if (duration === null) return;
    remaining.current = duration;
    if (!hovered.current && !focused.current) start();
    return clear;
  }, [duration, start]);

  // Leave: play the duration-fast exit, then hand the toast back to the caller.
  useEffect(() => {
    if (!leaving) return;
    const ms = animationMs(ref.current);
    if (ms <= 0) {
      onDismissRef.current();
      return;
    }
    const exit = window.setTimeout(() => onDismissRef.current(), ms);
    return () => window.clearTimeout(exit);
  }, [leaving]);

  return (
    <div
      ref={ref}
      className="toast"
      role="status"
      data-state={leaving ? "leaving" : "open"}
      data-auto-dismiss={duration === null ? "off" : "on"}
      onMouseEnter={() => {
        hovered.current = true;
        pause();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        resume();
      }}
      onFocus={() => {
        focused.current = true;
        pause();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        focused.current = false;
        resume();
      }}
    >
      <StatusDot {...status} hideLabel />
      <span className="toast-text">
        <b className="toast-title">{title}</b>
        {body ? ` ${body}` : null}
      </span>
      {action ? (
        <button type="button" className="toast-action" onClick={action.onAction}>
          {action.label}
        </button>
      ) : null}
      <button type="button" className="toast-dismiss" aria-label={dismissLabel} onClick={leave}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export interface ToastItem extends Omit<ToastProps, "onDismiss" | "duration"> {
  /** Stable id, in arrival order (the array's last item is the newest). */
  readonly id: string;
}

export interface ToastStackProps {
  /** Oldest first. */
  readonly toasts: ReadonlyArray<ToastItem>;
  readonly onDismiss: (id: string) => void;
  /** Auto-dismiss delay for every toast; `null` turns it off (gallery states). */
  readonly duration?: number | null;
  readonly label?: string;
}

export function ToastStack({ toasts, onDismiss, duration = TOAST_DURATION_MS, label = "Notifications" }: ToastStackProps) {
  const collapsed = Math.max(0, toasts.length - MAX_VISIBLE_TOASTS);
  const visible = toasts.slice(collapsed);
  return (
    <section className="toast-stack" aria-label={label}>
      {collapsed > 0 ? <div className="toast-collapsed">{collapsed} earlier</div> : null}
      {visible.map(({ id, ...toast }) => (
        <Toast key={id} {...toast} duration={duration} onDismiss={() => onDismiss(id)} />
      ))}
    </section>
  );
}

export type BandTone = "danger" | "parked" | "attention";

export interface BandProps {
  readonly tone: BandTone;
  readonly children: ReactNode;
  /** A 14px `currentColor` icon; `danger` and `parked` have a default. */
  readonly icon?: ReactNode;
  readonly action?: ToastAction;
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8v5M12 16h.01M4.9 19h14.2a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.2 16a2 2 0 0 0 1.7 3Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

const DEFAULT_BAND_ICONS: Readonly<Record<BandTone, (() => ReactNode) | undefined>> = {
  danger: () => <AlertIcon />,
  parked: () => <PauseIcon />,
  attention: undefined,
};

export function Band({ tone, children, icon, action }: BandProps) {
  const glyph = icon ?? DEFAULT_BAND_ICONS[tone]?.();
  return (
    <div className="band" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      {glyph ? (
        <span className="band-icon" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      <span className="band-text">{children}</span>
      {action ? (
        <button type="button" className="band-action" onClick={action.onAction}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
