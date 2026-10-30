// The open card (phase 7 item 03), the mockup's `tasks-history` view: a crumb
// with Back, the title, the card's facts, then its history (the response's
// events, oldest first) beside its session's log. The log is `StreamingLog`,
// which carries Stop and Kill; Kill asks first (the screen's Dialog).
//
// A card with no session shows the mockup's "no log yet" note. Every string
// here (a title, an agent, an event payload, an approval's action) is untrusted
// data and is rendered as a text child only.
import { useEffect, useRef } from "react";
import type { Approval, PlaybookRun, SessionSummary, TaskBoardItem } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarAgent, AvatarState } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { StreamingLog } from "../../components/StreamingLog/StreamingLog";
import { printable } from "../approvals/printable";
import { elapsedText, statusLine, statusView, taskText } from "../sessions/model";
import { KIND_LABEL, agentText, cardTitle, eventLine, factsOf, toneOf } from "./model";
import type { OpenCard } from "./useOpenCard";

export interface TaskDetailProps {
  readonly item: TaskBoardItem;
  readonly card: OpenCard;
  /** Now, ms since the epoch: for "today" and the running time. */
  readonly now: number;
  /** The kernel is not answering: the log's Stop and Kill are off. Back is local and always works. */
  readonly offline: boolean;
  readonly avatar: AvatarAgent;
  readonly avatarState: AvatarState;
  readonly onBack: () => void;
  /** Kill never kills here: the screen asks first (its confirm), then sends. */
  readonly onKillRequest: () => void;
}

const KIND_WORD: Readonly<Record<TaskBoardItem["kind"], string>> = { task: "task", playbook_run: "playbook run", session: "session" };

function RunRow({ run }: { readonly run: PlaybookRun }) {
  return (
    <li className="tasks-side-row">
      <span>
        Run #{run.id} · {printable(run.kind)}
      </span>
      <Badge tone={toneOf("playbook_run", run.status)}>{printable(run.status)}</Badge>
    </li>
  );
}

function ApprovalRow({ approval }: { readonly approval: Approval }) {
  return (
    <li className="tasks-side-row">
      <span>
        Approval #{approval.id} · {printable(approval.action)}
      </span>
      <Badge tone={approval.status === "pending" ? "attention" : "neutral"}>{printable(approval.status)}</Badge>
    </li>
  );
}

export function TaskDetail({ item, card, now, offline, avatar, avatarState, onBack, onKillRequest }: TaskDetailProps) {
  const { history, session, sessionId } = card;
  const regionRef = useRef<HTMLElement>(null);
  // The card the owner opened has left the DOM: focus lands here, so Tab reaches Back first.
  useEffect(() => {
    regionRef.current?.focus();
  }, []);

  const title = cardTitle(item);
  const facts = factsOf(item, now, session, history?.runs.find((r) => item.kind === "playbook_run" && r.id === item.id));
  const events = (history?.events ?? []).map(eventLine);
  const runs = item.kind === "playbook_run" ? [] : (history?.runs ?? []);
  const approvals = history?.approvals ?? [];

  const status = statusView(card.status ?? "unknown", card.reason);
  const header = card.status === undefined ? "status unknown" : statusLine(status);
  const logSummary: Pick<SessionSummary, "status" | "started" | "ended"> = session ?? { status: item.kind === "session" ? item.state : "unknown", started: item.started, ended: item.ended };
  const tokens = session?.tokens ?? (item.kind === "session" ? item.tokens : null);
  const live = card.live && !offline;

  return (
    <section
      className="tasks-detail"
      data-testid="task-detail"
      data-card-key={`${item.kind}:${item.id}`}
      aria-label={`${KIND_LABEL[item.kind]} #${item.id}`}
      tabIndex={-1}
      ref={regionRef}
    >
      <div className="tasks-detail-head">
        <div className="tasks-crumb">
          <Button variant="ghost" size="row" onClick={onBack} data-testid="task-back">
            Back
          </Button>
          <span aria-hidden="true">/</span>
          <span>Tasks</span>
          <span aria-hidden="true">/</span>
          <span>
            {KIND_LABEL[item.kind]} #{item.id}
          </span>
        </div>
        <div className="tasks-detail-title">
          <Avatar agent={avatar} state={avatarState} size={24} />
          <h2 className="tasks-detail-h">{title}</h2>
        </div>
        <dl className="tasks-facts" data-testid="task-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="tasks-fact">
              <dt>{fact.label}</dt>
              <dd>{fact.tone === undefined ? fact.text : <Badge tone={fact.tone}>{fact.text}</Badge>}</dd>
            </div>
          ))}
        </dl>
      </div>

      {card.gone ? (
        <p className="tasks-note" role="status" data-testid="task-gone">
          {KIND_LABEL[item.kind]} #{item.id} is no longer in the kernel's history. Back returns to the board.
        </p>
      ) : card.historyError === undefined ? null : (
        <p className="tasks-note" role="status" data-testid="task-history-error">
          {card.historyError}
          {history === undefined ? "" : " The history shown is the last read that answered."}
        </p>
      )}
      {card.notice === undefined ? null : (
        <p className="tasks-note" role="status" data-testid="task-notice">
          {card.notice}
        </p>
      )}

      <div className="tasks-split">
        <div className="tasks-history" data-testid="task-history">
          <div className="tasks-history-head">History · {history === undefined ? "…" : events.length}</div>
          {history === undefined ? (
            <p className="tasks-note">{card.historyError === undefined ? "Reading this card's history…" : "No history has been read."}</p>
          ) : events.length === 0 ? (
            <p className="tasks-note">No events are recorded for this card.</p>
          ) : (
            <ol className="tasks-events" aria-label="History">
              {events.map((event) => (
                <li key={event.id} className="tasks-event">
                  <div className="tasks-event-top">
                    <b>{event.kind}</b>
                    <time>{event.time}</time>
                  </div>
                  {event.text === "" ? null : <p className="tasks-event-text">{event.text}</p>}
                </li>
              ))}
            </ol>
          )}
          {runs.length === 0 ? null : (
            <>
              <div className="tasks-history-head">Playbook runs · {runs.length}</div>
              <ul className="tasks-side" aria-label="Playbook runs">
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </ul>
            </>
          )}
          {approvals.length === 0 ? null : (
            <>
              <div className="tasks-history-head">Approvals · {approvals.length}</div>
              <ul className="tasks-side" aria-label="Approvals">
                {approvals.map((approval) => (
                  <ApprovalRow key={approval.id} approval={approval} />
                ))}
              </ul>
            </>
          )}
        </div>

        {sessionId === null ? (
          <div className="tasks-nolog" data-testid="task-nolog">
            <div className="tasks-nolog-bar">Session log</div>
            <p className="tasks-nolog-note">
              No session is attached to this {KIND_WORD[item.kind]}. Nothing has run for it, so there is no log yet.
            </p>
          </div>
        ) : (
          <div
            // Keyed by session: StreamingLog's follow state is one session's.
            key={sessionId}
            className="tasks-log"
            data-testid="task-log"
            data-session-id={sessionId}
            data-status={header}
            data-output={card.output.loaded ? "read" : "unread"}
            data-tokens={tokens === null ? "unknown" : undefined}
          >
            {card.output.error === undefined ? null : (
              <p className="tasks-note tasks-log-error" role="status" data-testid="task-output-error">
                <span>{card.output.error}</span>
                <Button size="row" variant="secondary" loading={card.output.reading} onClick={card.readAgain}>
                  Read again
                </Button>
              </p>
            )}
            <StreamingLog
              status={
                <span data-testid="task-log-status">
                  <Badge tone={status.danger ? "danger" : card.pending ? "attention" : live ? "accent" : "neutral"}>{header}</Badge>
                </span>
              }
              statusLabel={header}
              agent={agentText(session?.agent ?? item.agent)}
              task={item.kind === "session" ? taskText({ playbook: item.playbook }) : title}
              elapsed={elapsedText(logSummary, now)}
              tokens={tokens ?? 0}
              lines={card.lines}
              live={live}
              onStop={card.stop}
              onKillRequest={onKillRequest}
            />
          </div>
        )}
      </div>
    </section>
  );
}
