// Toast and Band (docs/design/design-system/components/Toast): two kinds of feedback.
//
// - `Toast` confirms an outcome of the user's own action and goes away: 360px
//   on `surface-raised` with `shadow-2`, a StatusDot, one bold clause then one
//   plain clause, at most one `accent` action, and a dismiss. `role="status"`.
//   It auto-dismisses after `TOAST_DURATION_MS` (6 s); hovering it, or focusing
//   a control inside it, pauses the countdown and leaving resumes the remaining
//   time. `duration={null}` turns auto-dismiss off (gallery states). Dismissing
//   (timer or ×) plays the `duration-fast` leave, then calls `onDismiss`.
//   A toast that holds focus when it is dismissed or removed hands focus on
//   first (the adjacent toast's dismiss, else wherever focus came from), so a
//   keyboard user is never dropped onto <body>.
//   Never a toast for something that needs a decision: that is an approval.
// - `ToastStack` places toasts bottom-right with `position: fixed`, so a toast
//   arriving or leaving never moves the main content. Put it inside a
//   transformed main column to anchor it there instead of the window. It shows
//   at most `MAX_VISIBLE_TOASTS` (the newest); older ones collapse into an
//   "N earlier" line and wait, timer not running, until a slot frees. The
//   stack itself is the persistent polite live region: a toast inserted into
//   it is announced as an addition, while each toast keeps `role="status"`
//   with `aria-live="off"`, so it is not announced twice.
// - `Band` is persistent, full width at the top of the main column on a
//   `*-soft` ground: `danger` (kernel unreachable, `role="alert"`), `parked`
//   (paused at cap) and `attention` (approvals waiting). It has no timer; it
//   leaves when the caller's condition clears.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
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
  /**
   * Set by ToastStack: the stack is the live region, so the toast's own
   * `role="status"` is silenced (`aria-live="off"`) to avoid a double announcement.
   */
  readonly inLiveRegion?: boolean;
}

/**
 * Each focused toast's origin (where focus was before it entered the stack), so
 * a toast that receives focus from a leaving sibling inherits that origin.
 */
const focusOrigins = new WeakMap<HTMLElement, HTMLElement>();

/**
 * Moves focus out of `toast` before it leaves the DOM: to the adjacent open
 * toast's dismiss (the next newer, else the next older), else to `returnTo`
 * (where focus was before it entered the toast) when that is still in the page.
 */
function handOffFocus(toast: HTMLElement, returnTo: HTMLElement | null): void {
  const isOpenToast = (el: Element | null): el is HTMLElement =>
    el instanceof HTMLElement && el.classList.contains("toast") && el.dataset.state !== "leaving";
  let next: Element | null = toast.nextElementSibling;
  while (next && !isOpenToast(next)) next = next.nextElementSibling;
  let prev: Element | null = toast.previousElementSibling;
  while (prev && !isOpenToast(prev)) prev = prev.previousElementSibling;
  const sibling = (next ?? prev)?.querySelector<HTMLElement>(".toast-dismiss");
  if (sibling) {
    sibling.focus();
    return;
  }
  if (returnTo?.isConnected && !toast.contains(returnTo)) returnTo.focus();
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

export function Toast({
  status,
  title,
  body,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  duration = TOAST_DURATION_MS,
  inLiveRegion = false,
}: ToastProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  // Read by event handlers, which may run before the `leaving` render commits.
  const leavingRef = useRef(false);
  /** Where focus was before it entered this toast. */
  const returnToRef = useRef<HTMLElement | null>(null);
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
    leavingRef.current = true;
    const el = ref.current;
    if (el?.contains(document.activeElement)) handOffFocus(el, returnToRef.current);
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
    if (duration === null || leavingRef.current || hovered.current || focused.current) return;
    start();
  };

  useEffect(() => {
    if (duration === null) return;
    remaining.current = duration;
    if (!hovered.current && !focused.current) start();
    return clear;
  }, [duration, start]);

  // Removed by the caller while holding focus (an action that drops the toast,
  // or the stack collapsing it): hand focus on. Layout cleanups run during the
  // commit while the node is still attached; after a hand-off from `leave`
  // focus is already elsewhere and this is a no-op.
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.contains(document.activeElement)) handOffFocus(el, returnToRef.current);
    };
  }, []);

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
      aria-live={inLiveRegion ? "off" : undefined}
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
      onFocus={(event: FocusEvent<HTMLDivElement>) => {
        const from = event.relatedTarget;
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) {
          const fromToast = from.closest(".toast");
          const origin = fromToast instanceof HTMLElement ? (focusOrigins.get(fromToast) ?? null) : from;
          returnToRef.current = origin;
          if (origin) focusOrigins.set(event.currentTarget, origin);
          else focusOrigins.delete(event.currentTarget);
        }
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
    <section className="toast-stack" aria-label={label} aria-live="polite" aria-relevant="additions">
      {collapsed > 0 ? <div className="toast-collapsed">{collapsed} earlier</div> : null}
      {visible.map(({ id, ...toast }) => (
        <Toast key={id} {...toast} duration={duration} inLiveRegion onDismiss={() => onDismiss(id)} />
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
    <div className="toast-band" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      {glyph ? (
        <span className="toast-band-icon" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      <span className="toast-band-text">{children}</span>
      {action ? (
        <button type="button" className="toast-band-action" onClick={action.onAction}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
