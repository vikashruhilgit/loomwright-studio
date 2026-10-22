// EventCard: the thread is a timeline (docs/design/design-system/components/EventCard/README.md).
// Two forms: a one-line event (`role="status"`, one 14px Lucide icon per kind,
// the subject linking to what it names, a tabular timestamp) and the inline
// approval (`attention` edge, summary, the playbook's reason, Allow once `A`,
// Always `⇧A`, Deny `D`, Full payload). An approval requested by another agent
// renders nothing in this thread. Every kernel string is a React text child.
import type { KeyboardEvent, ReactElement } from "react";
import "./EventCard.css";

/** The README's six event kinds; each has its own icon. */
export type EventKind = "session" | "playbook" | "agent" | "memory" | "approval" | "hook";

/** One event line: "{before}{subject}{after}", the subject marked and linked. */
export interface EventLine {
  readonly kind: EventKind;
  /** Text before the subject, e.g. "Session started · review PR #401 · playbook ". */
  readonly before?: string;
  /** The thing the event names. For `memory` it is the file path, set in `mono`. */
  readonly subject: string;
  /** Text after the subject, e.g. " · runs as Mason". */
  readonly after?: string;
  /** The timestamp as shown, e.g. "13:40". */
  readonly time: string;
  /** Machine-readable time for `<time dateTime>`, e.g. an ISO string. */
  readonly dateTime?: string;
  /** What the subject links to (a session, playbook, agent or file id), passed back to `onOpen`. */
  readonly target: string;
}

/** A pending approval, as the inline card needs it. */
export interface InlineApproval {
  readonly id: string;
  /** The agent whose action waits on the user. */
  readonly requestingAgent: string;
  /** What the action is, shown in the header after "Waiting on you". */
  readonly title?: string;
  /** A one-line summary of the payload. */
  readonly summary: string;
  /** The playbook's reason for asking. */
  readonly reason: string;
}

export interface EventCardEventProps {
  readonly variant: "event";
  readonly event: EventLine;
  /** Opens the thing the subject names. */
  readonly onOpen: (target: string) => void;
}

export interface EventCardApprovalProps {
  readonly variant: "approval";
  readonly approval: InlineApproval;
  /** The agent this thread belongs to; another agent's approval renders nothing. */
  readonly threadAgent: string;
  readonly onAllowOnce: (id: string) => void;
  readonly onAlways: (id: string) => void;
  readonly onDeny: (id: string) => void;
  /** Opens the Approvals inbox on the exact payload. */
  readonly onFullPayload: (id: string) => void;
}

export type EventCardProps = EventCardEventProps | EventCardApprovalProps;

// 14px Lucide icons, stroke `currentColor`. terminal, file, plus and list are
// copied from EventCard/preview.html; users and check are Lucide's own paths.
const ICONS: Readonly<Record<EventKind, ReactElement>> = {
  session: (
    <>
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M8 9l3 3-3 3" />
    </>
  ),
  playbook: <path d="M12 5v14M5 12h14" />,
  agent: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  memory: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </>
  ),
  approval: <path d="M4 6h16M4 12h10M4 18h7" />,
  hook: <path d="M20 6 9 17l-5-5" />,
};

function Icon({ kind }: { readonly kind: EventKind }) {
  return (
    <svg className="eventcard-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-icon={kind}>
      {ICONS[kind]}
    </svg>
  );
}

function EventLineView({ event, onOpen }: { readonly event: EventLine; readonly onOpen: (target: string) => void }) {
  const subjectClass = event.kind === "memory" ? "eventcard-subject eventcard-mono" : "eventcard-subject";
  return (
    <div className="eventcard-event" role="status" data-kind={event.kind}>
      <Icon kind={event.kind} />
      <span className="eventcard-text">
        {event.before}
        <button type="button" className={subjectClass} onClick={() => onOpen(event.target)}>
          {event.subject}
        </button>
        {event.after}
      </span>
      <time className="eventcard-time" dateTime={event.dateTime}>
        {event.time}
      </time>
    </div>
  );
}

function InlineApprovalView(props: EventCardApprovalProps) {
  const { approval, onAllowOnce, onAlways, onDeny, onFullPayload } = props;
  const heading = approval.title ? `Waiting on you · ${approval.title}` : "Waiting on you";

  // Shortcuts work only while focus is inside the card; the global keymap is not this component's.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "a") {
      e.preventDefault();
      if (e.shiftKey) onAlways(approval.id);
      else onAllowOnce(approval.id);
    } else if (key === "d" && !e.shiftKey) {
      e.preventDefault();
      onDeny(approval.id);
    }
  }

  return (
    <div className="eventcard-approval" role="group" aria-label={`Approval: ${approval.title ? approval.title : approval.summary}`} onKeyDown={onKeyDown}>
      <div className="eventcard-approval-header">
        <Icon kind="approval" />
        <span>{heading}</span>
      </div>
      <div className="eventcard-approval-body">
        <p className="eventcard-approval-summary">{approval.summary}</p>
        <p className="eventcard-approval-reason">{approval.reason}</p>
      </div>
      <div className="eventcard-approval-actions">
        <button type="button" className="eventcard-btn eventcard-btn-primary" aria-keyshortcuts="A" onClick={() => onAllowOnce(approval.id)}>
          Allow once
          <kbd className="eventcard-kbd" aria-hidden="true">
            A
          </kbd>
        </button>
        <button type="button" className="eventcard-btn eventcard-btn-secondary" aria-keyshortcuts="Shift+A" onClick={() => onAlways(approval.id)}>
          Always
          <kbd className="eventcard-kbd" aria-hidden="true">
            ⇧A
          </kbd>
        </button>
        <button type="button" className="eventcard-btn eventcard-btn-danger" aria-keyshortcuts="D" onClick={() => onDeny(approval.id)}>
          Deny
          <kbd className="eventcard-kbd" aria-hidden="true">
            D
          </kbd>
        </button>
        <button type="button" className="eventcard-btn eventcard-btn-ghost" onClick={() => onFullPayload(approval.id)}>
          Full payload
        </button>
      </div>
    </div>
  );
}

export function EventCard(props: EventCardProps) {
  if (props.variant === "event") return <EventLineView event={props.event} onOpen={props.onOpen} />;
  // Never show an inline approval for another agent's action in this thread.
  if (props.approval.requestingAgent !== props.threadAgent) return null;
  return <InlineApprovalView {...props} />;
}
