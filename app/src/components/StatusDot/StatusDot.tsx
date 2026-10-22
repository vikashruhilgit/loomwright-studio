// StatusDot (docs/design/design-system/components/StatusDot): an 8px dot plus
// a word, the same mark everywhere so the user learns it once. Four kernel
// states (idle, working, waiting on you, paused at cap) and two verified
// outcomes (ok, failed / killed / denied). Only `working` animates.
//
// Honest status: `ok` renders its dot only when the caller passes
// `verified={{ at }}`, the time the kernel verified the fact, and that time is
// shown in the meta. `state="ok"` without `verified` is a guess, so it renders
// the README's guess form: the word in `ink-tertiary`, no dot. The guess form
// always shows its word, even with `hideLabel`, since there is no dot to carry it.
//
// The state word is always present: visibly, or as the `aria-label` of the
// dot when `hideLabel` is set (the menu bar). Exported for reuse by Toast and List.
import "./StatusDot.css";

export type StatusState = "idle" | "working" | "waiting" | "paused" | "ok" | "failed";

/**
 * The README's words for each state, used when the caller passes no `label`.
 * `ok`'s word never says "verified": the guess form reuses it, and a verified
 * `ok` carries "verified <time>" in its meta instead.
 */
export const STATUS_WORDS: Readonly<Record<StatusState, string>> = {
  idle: "idle",
  working: "working",
  waiting: "waiting on you",
  paused: "paused at cap",
  ok: "ok",
  failed: "failed",
};

export interface StatusDotProps {
  readonly state: StatusState;
  /** The state word ("CI green", "killed"); defaults to the README's word for the state. */
  readonly label?: string;
  /** Move the word into the dot's `aria-label` when space forbids showing it. */
  readonly hideLabel?: boolean;
  /** What makes the state actionable, in caption: the count, the reset time. */
  readonly meta?: string;
  /** Required for `ok` to render as ok: the kernel-verified fact's verification time. */
  readonly verified?: { readonly at: string };
}

export function StatusDot({ state, label, hideLabel = false, meta, verified }: StatusDotProps) {
  const word = label ?? STATUS_WORDS[state];
  // A verification without a time is not a verification: the meta must name it.
  const verifiedAt = verified?.at.trim() ? verified.at.trim() : undefined;
  const metaParts = [meta, state === "ok" && verifiedAt ? `verified ${verifiedAt}` : undefined].filter(
    (part): part is string => Boolean(part),
  );
  const metaText = metaParts.length > 0 ? metaParts.join(" · ") : undefined;
  const metaNode = metaText ? (
    <span className="status-meta">
      <span aria-hidden="true">· </span>
      {metaText}
    </span>
  ) : null;

  if (state === "ok" && !verifiedAt) {
    return (
      <span className="status status-guess" data-state="ok" data-verified="false">
        <span className="status-label">{word}</span>
        {metaNode}
      </span>
    );
  }

  return (
    <span className="status" data-state={state} data-verified={state === "ok" ? "true" : undefined}>
      {hideLabel ? (
        <span className="status-dot" data-state={state} role="img" aria-label={word} />
      ) : (
        <>
          <span className="status-dot" data-state={state} aria-hidden="true" />
          <span className="status-label">{word}</span>
        </>
      )}
      {metaNode}
    </span>
  );
}
