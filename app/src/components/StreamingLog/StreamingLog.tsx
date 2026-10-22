// StreamingLog: the live output of a running session, from
// docs/design/design-system/components/StreamingLog/README.md + preview.html.
//
// A header bar (status slot, agent, task, running time, tokens, an optional
// cost estimate, Read latest, Stop, Kill) over a `mono` log on
// `surface-sunken`. The log is `role="log"` with `aria-live="off"`, so a
// running session never floods a screen reader; "Read latest" announces the
// last line on demand through a polite live region, and status changes are
// announced politely from the header.
//
// Live without jank: lines append with no transition. The log stays pinned to
// the bottom while the reader is there ("Following"); scrolling up pauses
// following and the pill becomes "Jump to latest".
//
// Every string here (agent, task, line text) may come from a model or a tool,
// so it is rendered as a React text child only (invariant 3).
//
// Kill never kills: it calls `onKillRequest`, and the Sessions screen confirms
// with its dialog. The status indicator is a slot (the StatusDot primitive is
// another lane's).
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./StreamingLog.css";

/** The README's line kinds. Mapping kernel `SessionOutputKind` rows onto these is the Sessions screen's job. */
export type StreamingLogLineKind = "tool" | "output" | "prose" | "error" | "ok";

export interface StreamingLogLine {
  /** Stable key; lines never change once appended. */
  readonly id: string;
  readonly kind: StreamingLogLineKind;
  /** The timestamp shown in the gutter, already formatted (for example `14:02:11`). */
  readonly time: string;
  /** For `tool` lines, the tool's name (shown after `▸`); `text` carries its arguments. */
  readonly tool?: string;
  readonly text: string;
}

/**
 * One session's log. Follow state and the last announcement belong to that session, so a
 * screen that shows another session in the same place keys this component by session id.
 */
export interface StreamingLogProps {
  /** The status indicator (a StatusDot from the screen). Decorative here; `statusLabel` carries the word. */
  readonly status?: ReactNode;
  /** The session state in words ("running", "stopped", "killed", "done"); announced politely when it changes. */
  readonly statusLabel: string;
  readonly agent: string;
  readonly task: string;
  /** Running time, already formatted (for example `4m 12s`). */
  readonly elapsed: string;
  /** Tokens used so far: the primary figure (D24). */
  readonly tokens: number;
  /**
   * Optional dollar estimate at API rates. Shown only as "≈$x at API rates",
   * never as a limit or a budget (D24); omitted when not passed (or not a finite number).
   */
  readonly cost?: number;
  readonly lines: readonly StreamingLogLine[];
  /** Whether the session is still running: shows the live-end caret and enables Stop and Kill. Default `true`. */
  readonly live?: boolean;
  /** Graceful stop (`⌘.`): the kernel writes the handoff. */
  readonly onStop: () => void;
  /** Asks to kill the session. The caller confirms; this component never kills by itself. */
  readonly onKillRequest: () => void;
}

/** Within this many pixels of the end counts as "at the bottom" (sub-pixel scroll positions). */
const BOTTOM_SLACK_PX = 2;

const KIND_CLASS: Readonly<Record<StreamingLogLineKind, string>> = {
  tool: "streaming-log__text--tool",
  output: "streaming-log__text--output",
  prose: "streaming-log__text--prose",
  error: "streaming-log__text--error",
  ok: "streaming-log__text--ok",
};

/** A word for the kinds whose colour carries meaning, so the meaning never rests on colour alone. */
const KIND_WORD: Readonly<Partial<Record<StreamingLogLineKind, string>>> = {
  error: "Error: ",
  ok: "Verified: ",
};

function formatTokens(tokens: number): string {
  return `${tokens.toLocaleString("en-US")} tokens`;
}

function formatCost(cost: number): string {
  return `≈$${cost.toFixed(2)} at API rates`;
}

/** The words "Read latest" announces for a line. */
function spokenLine(line: StreamingLogLine): string {
  const body = line.kind === "tool" ? `${line.tool ?? "Tool"} ${line.text}` : line.text;
  return `${KIND_WORD[line.kind] ?? ""}${body.trim()}`;
}

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
}

export function StreamingLog({
  status,
  statusLabel,
  agent,
  task,
  elapsed,
  tokens,
  cost,
  lines,
  live = true,
  onStop,
  onKillRequest,
}: StreamingLogProps) {
  const logRef = useRef<HTMLDivElement>(null);
  // The ref is what the append effect reads (no stale closure); the state drives the pill.
  const followingRef = useRef(true);
  const [following, setFollowingState] = useState(true);
  const [announcement, setAnnouncement] = useState<{ readonly text: string; readonly nonce: number } | null>(null);

  const setFollowing = useCallback((next: boolean) => {
    followingRef.current = next;
    setFollowingState(next);
  }, []);

  // New lines: keep the view pinned only when the reader was at the bottom.
  // Runs before paint, so a pinned log never shows a frame scrolled short.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && followingRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = isAtBottom(el);
    if (atBottom !== followingRef.current) setFollowing(atBottom);
  }, [setFollowing]);

  const jumpToLatest = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setFollowing(true);
    // The pill stops being a button once following resumes; land focus in the log, not on <body>.
    el.focus();
  }, [setFollowing]);

  const readLatest = useCallback(() => {
    const last = lines[lines.length - 1];
    const text = last ? spokenLine(last) : "No output yet";
    // A fresh nonce re-mounts the live text, so pressing twice on the same line announces twice.
    setAnnouncement((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [lines]);

  const stop = useCallback(() => {
    if (live) onStop();
  }, [live, onStop]);

  const requestKill = useCallback(() => {
    if (live) onKillRequest();
  }, [live, onKillRequest]);

  // `⌘.` stops the session while focus is inside this component; the global keymap is the shell's.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.metaKey && event.key === ".") {
        event.preventDefault();
        stop();
      }
    },
    [stop],
  );

  const lastIndex = lines.length - 1;

  return (
    <section className="streaming-log" aria-label={`Session output: ${agent}`} onKeyDown={onKeyDown} data-following={following}>
      <header className="streaming-log__bar">
        {status !== undefined && (
          <span className="streaming-log__status" aria-hidden="true">
            {status}
          </span>
        )}
        <span className="streaming-log__sr" role="status" aria-live="polite" data-testid="streaming-log-status">
          {statusLabel}
        </span>
        <b className="streaming-log__agent">{agent}</b>
        <span className="streaming-log__meta">
          <span className="streaming-log__task">{task}</span>
          <span aria-hidden="true"> · </span>
          <span className="streaming-log__num">{elapsed}</span>
          <span aria-hidden="true"> · </span>
          <span className="streaming-log__num" data-testid="streaming-log-tokens">
            {formatTokens(tokens)}
          </span>
          {cost !== undefined && Number.isFinite(cost) && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="streaming-log__num" data-testid="streaming-log-cost">
                {formatCost(cost)}
              </span>
            </>
          )}
        </span>
        <span className="streaming-log__actions">
          <button type="button" className="streaming-log__btn" onClick={readLatest}>
            Read latest
          </button>
          <button
            type="button"
            className="streaming-log__btn"
            onClick={stop}
            aria-disabled={live ? undefined : true}
            aria-keyshortcuts="Meta+Period"
          >
            Stop{" "}
            <kbd className="streaming-log__kbd" aria-hidden="true">
              ⌘.
            </kbd>
          </button>
          <button
            type="button"
            className="streaming-log__btn streaming-log__btn--danger"
            onClick={requestKill}
            aria-disabled={live ? undefined : true}
          >
            Kill
          </button>
        </span>
      </header>
      <div className="streaming-log__viewport">
        <div
          ref={logRef}
          className="streaming-log__body"
          role="log"
          aria-live="off"
          aria-label="Session output"
          // Focusable so the keyboard can scroll it (↑ pauses following).
          tabIndex={0}
          onScroll={onScroll}
        >
          {lines.length === 0 && !live && <p className="streaming-log__empty">No output</p>}
          {lines.map((line, index) => (
            <div key={line.id} className="streaming-log__line" data-kind={line.kind}>
              <time className="streaming-log__time">{line.time}</time>
              <span className={`streaming-log__text ${KIND_CLASS[line.kind]}`}>
                {KIND_WORD[line.kind] !== undefined && <span className="streaming-log__sr">{KIND_WORD[line.kind]}</span>}
                {line.kind === "tool" ? (
                  <>
                    <span className="streaming-log__prompt" aria-hidden="true">
                      ▸{" "}
                    </span>
                    <span className="streaming-log__tool">{line.tool ?? "Tool"}</span>
                    {"  "}
                    {line.text}
                  </>
                ) : (
                  line.text
                )}
                {live && index === lastIndex && <span className="streaming-log__caret" aria-hidden="true" data-testid="streaming-log-caret" />}
              </span>
            </div>
          ))}
          {live && lines.length === 0 && (
            <div className="streaming-log__line">
              <span className="streaming-log__time" />
              <span className="streaming-log__text">
                <span className="streaming-log__caret" aria-hidden="true" data-testid="streaming-log-caret" />
              </span>
            </div>
          )}
        </div>
        <div className="streaming-log__pin">
          {following ? (
            <span className="streaming-log__pill" data-testid="streaming-log-pill">
              Following
            </span>
          ) : (
            <button type="button" className="streaming-log__pill streaming-log__pill--action" onClick={jumpToLatest} data-testid="streaming-log-pill">
              Jump to latest
            </button>
          )}
        </div>
      </div>
      <div className="streaming-log__sr" role="status" aria-live="polite" data-testid="streaming-log-latest">
        {announcement && <span key={announcement.nonce}>{announcement.text}</span>}
      </div>
    </section>
  );
}
