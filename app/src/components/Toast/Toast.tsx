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
//
// Announcements. Each stacked toast keeps `role="status"` but with
// `aria-live="off"`, and the stack itself is not a live region, so a toast
// mounting (arriving, or resurfacing from the collapsed line) and the
// "N earlier" line are never announced by insertion. Instead the stack owns one
// visually hidden polite announcer that receives a toast's text once, the first
// time its id appears in `toasts`; a collapsed toast that resurfaces later is
// already announced and stays silent. A standalone `Toast` is its own polite
// status.
//
// Focus. A keyboard user is never dropped onto <body> while somewhere sensible
// survives. In a stack, the stack owns the hand-off, chosen from the ids that
// survive (never from the DOM, which during a removal commit still holds
// siblings that are leaving too): the nearest surviving toast's dismiss (the
// next newer, else the next older), else where focus was before it entered the
// stack, else the stack itself (`tabIndex={-1}`, named "Notifications"), so a
// screen reader lands on the region the toast left rather than on the page.
// It hands off when a focused toast is dismissed, and after any commit that
// removed or collapsed the focused toast. A standalone toast hands off to an
// adjacent open toast, else to where its focus came from, and re-checks after
// the commit in case that sibling left in the same update.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
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

/** Set by ToastStack on each toast it renders: the stack owns announcements and focus. */
interface StackWiring {
  readonly id: string;
  /** Called before a focused toast starts to leave, while it still holds focus. */
  readonly handOff: (id: string) => void;
}

/**
 * Each focused standalone toast's origin (where focus was before it entered),
 * so a toast that receives focus from a leaving sibling inherits that origin.
 */
const focusOrigins = new WeakMap<HTMLElement, HTMLElement>();

const isLost = () => document.activeElement === null || document.activeElement === document.body;

/**
 * Whether `el` sits in a toast that is playing its leave. Every focus hand-off
 * skips such a toast: it is about to be removed, so focusing it would only bounce.
 */
const isInLeavingToast = (el: Element | null | undefined): boolean =>
  el?.closest(".toast")?.getAttribute("data-state") === "leaving";

/**
 * Standalone toasts only: moves focus out of `toast` before it leaves the DOM,
 * to the adjacent open toast's dismiss (the next newer, else the next older),
 * else to `returnTo` when that is still in the page.
 */
function handOffFocus(toast: HTMLElement, returnTo: HTMLElement | null): void {
  const isOpenToast = (el: Element | null): el is HTMLElement =>
    el instanceof HTMLElement && el.classList.contains("toast") && !isInLeavingToast(el);
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

/**
 * The id nearest to `from` in `order` that `alive` accepts: the first one
 * after it (newer), else the last one before it (older).
 */
function survivingNeighbour(order: readonly string[], from: string, alive: (id: string) => boolean): string | undefined {
  const index = order.indexOf(from);
  if (index < 0) return undefined;
  for (let i = index + 1; i < order.length; i++) {
    const id = order[i];
    if (id !== undefined && alive(id)) return id;
  }
  for (let i = index - 1; i >= 0; i--) {
    const id = order[i];
    if (id !== undefined && alive(id)) return id;
  }
  return undefined;
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

export function Toast(props: ToastProps) {
  return <ToastView {...props} />;
}

function ToastView({
  status,
  title,
  body,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  duration = TOAST_DURATION_MS,
  stack,
}: ToastProps & { readonly stack?: StackWiring }) {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  // Read by event handlers, which may run before the `leaving` render commits.
  const leavingRef = useRef(false);
  /** Standalone only: where focus was before it entered this toast. */
  const returnToRef = useRef<HTMLElement | null>(null);
  const onDismissRef = useRef(onDismiss);
  const stackRef = useRef(stack);
  useEffect(() => {
    onDismissRef.current = onDismiss;
    stackRef.current = stack;
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
    if (leavingRef.current) return;
    clear();
    leavingRef.current = true;
    const el = ref.current;
    if (el?.contains(document.activeElement)) {
      const wiring = stackRef.current;
      if (wiring) wiring.handOff(wiring.id);
      else handOffFocus(el, returnToRef.current);
    }
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

  // Standalone only (a stack re-homes focus after its own commit): removed by
  // the caller while holding focus, hand focus on. Layout cleanups run during
  // the commit while the node is still attached, but a sibling chosen here may
  // be removed later in the same commit, and React dispatches no focus events
  // during a commit, so a microtask re-checks and falls back to the origin.
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (stackRef.current || !el?.contains(document.activeElement)) return;
      const returnTo = returnToRef.current;
      handOffFocus(el, returnTo);
      queueMicrotask(() => {
        if (isLost() && returnTo?.isConnected) returnTo.focus();
      });
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
      aria-live={stack ? "off" : undefined}
      data-toast-id={stack?.id}
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
        if (!stack && from instanceof HTMLElement && !event.currentTarget.contains(from)) {
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

interface Announcement {
  readonly id: string;
  readonly text: string;
}

export function ToastStack({ toasts, onDismiss, duration = TOAST_DURATION_MS, label = "Notifications" }: ToastStackProps) {
  const collapsed = Math.max(0, toasts.length - MAX_VISIBLE_TOASTS);
  const visible = toasts.slice(collapsed);
  const sectionRef = useRef<HTMLElement>(null);

  // Announcements: every id is announced once, the first time it appears.
  const announcedRef = useRef(new Set<string>());
  const [announcements, setAnnouncements] = useState<readonly Announcement[]>([]);
  useEffect(() => {
    const present = new Set(toasts.map((toast) => toast.id));
    const announced = announcedRef.current;
    // Forget ids that left, so a later toast reusing an id is announced as new.
    for (const id of announced) if (!present.has(id)) announced.delete(id);
    const fresh: Announcement[] = [];
    for (const toast of toasts) {
      if (announced.has(toast.id)) continue;
      announced.add(toast.id);
      fresh.push({ id: toast.id, text: toast.body ? `${toast.title} ${toast.body}` : toast.title });
    }
    setAnnouncements((prev) => {
      // Lines for toasts that left are dropped (a removal is not announced).
      const kept = prev.filter((entry) => present.has(entry.id));
      return fresh.length === 0 && kept.length === prev.length ? prev : [...kept, ...fresh];
    });
  }, [toasts]);

  // Focus: the toast that holds it while focus is inside the stack, where it
  // came from, the visible ids at the last commit, and the ids playing their leave.
  const focusedIdRef = useRef<string | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const prevIdsRef = useRef<readonly string[]>([]);
  const leavingRef = useRef(new Set<string>());

  const dismissOf = (id: string): HTMLElement | null => {
    const section = sectionRef.current;
    if (!section) return null;
    for (const toast of section.querySelectorAll<HTMLElement>(".toast")) {
      if (toast.dataset.toastId === id) return toast.querySelector<HTMLElement>(".toast-dismiss");
    }
    return null;
  };

  /** Focuses the nearest toast that `alive` accepts, else the origin, else the stack. */
  const rehome = (from: string, order: readonly string[], alive: (id: string) => boolean) => {
    const section = sectionRef.current;
    // `leavingRef` holds toasts that began leaving while focused (before their
    // `leaving` render commits); the DOM check covers the rest, such as a
    // neighbour playing its timer-driven leave.
    const targetId = survivingNeighbour(
      order,
      from,
      (id) => id !== from && !leavingRef.current.has(id) && alive(id) && !isInLeavingToast(dismissOf(id)),
    );
    const target = targetId === undefined ? null : dismissOf(targetId);
    if (target) {
      target.focus();
      return;
    }
    const origin = originRef.current;
    if (origin?.isConnected && !section?.contains(origin)) {
      origin.focus();
      return;
    }
    section?.focus();
  };

  /** A focused toast is about to leave: mark it, and move focus before it goes. */
  const handOff = (id: string) => {
    leavingRef.current.add(id);
    const ids = prevIdsRef.current;
    rehome(id, ids, (other) => ids.includes(other));
  };

  // After every commit: if the focused toast was removed or collapsed, focus
  // fell to <body>; re-home it from the ids that survive.
  useLayoutEffect(() => {
    const ids = visible.map((toast) => toast.id);
    const focusedId = focusedIdRef.current;
    if (focusedId !== null && !ids.includes(focusedId)) {
      focusedIdRef.current = null;
      if (isLost()) rehome(focusedId, prevIdsRef.current, (id) => ids.includes(id));
    }
    for (const id of leavingRef.current) if (!ids.includes(id)) leavingRef.current.delete(id);
    prevIdsRef.current = ids;
  });

  return (
    <section
      ref={sectionRef}
      className="toast-stack"
      aria-label={label}
      tabIndex={-1}
      onFocus={(event) => {
        const from = event.relatedTarget;
        if (from instanceof HTMLElement && !event.currentTarget.contains(from)) originRef.current = from;
        focusedIdRef.current = (event.target as HTMLElement).closest<HTMLElement>("[data-toast-id]")?.dataset.toastId ?? null;
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        // A focused toast that is being removed keeps its id, so the commit can re-home focus.
        if (!(event.target as Node).isConnected) return;
        focusedIdRef.current = null;
        originRef.current = null;
      }}
    >
      {collapsed > 0 ? <div className="toast-collapsed">{collapsed} earlier</div> : null}
      {visible.map(({ id, ...toast }) => (
        <ToastView key={id} {...toast} duration={duration} stack={{ id, handOff }} onDismiss={() => onDismiss(id)} />
      ))}
      <div className="toast-announcer" aria-live="polite">
        {announcements.map((entry) => (
          <p key={entry.id}>{entry.text}</p>
        ))}
      </div>
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
