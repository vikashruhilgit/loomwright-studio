// The open card (phase 7 item 03), the mockup's `tasks-history` view: the shell's
// crumb ("‹ Tasks / Task #9", `../../shell/Crumb.tsx`), the title, the card's facts, then its history (the response's
// events, oldest first) beside its session's log. The log is `StreamingLog`,
// which carries Stop and Kill; Kill asks first (the screen's Dialog).
//
// A card with no session shows the mockup's "no log yet" note. The history reads
// as sentences with actors (`./history.ts`), never as the stored JSON. A task's
// "Created in" fact links the session that created it (its own card, when the
// board has one); that session's Stop and Kill are never wired to the task.
// A ticket's PR card (`item.ticket_pr`, phase 8 item 14) adds the ticket's facts, the "Waiting on you" band with its link
// to the pending merge approval, a link from each event to its session's log, the history's sessions and a link on each
// pending approval (`./TicketPrCard.tsx` owns the words). A plain card is drawn as before.
// Every string here (a title, an agent, an event's words, an approval's action)
// is untrusted data and is rendered as a text child only.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { Approval, PlaybookRun, SessionSummary, TaskBoardItem } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarAgent, AvatarState } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { StreamingLog } from "../../components/StreamingLog/StreamingLog";
import { Crumb } from "../../shell/Crumb";
import { printable } from "../approvals/printable";
import { elapsedText, statusLine, statusView } from "../sessions/model";
import { historyLine } from "./history";
import { KIND_LABEL, agentText, cardTitle, factsOf, sessionTitles, toneOf } from "./model";
import type { SessionTitles } from "./model";
import { OpenApprovalButton, TicketWaitingBand, ticketFacts } from "./TicketPrCard";
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
  /** The pending merge approval a parked ticket PR waits on (`waitingApprovalOf`), if any. */
  readonly approvalId?: number | undefined;
  /** The kernel's session titles by id from `GET /sessions` (the screen's); this card's history `sessions` win over it. */
  readonly titles?: SessionTitles | undefined;
  readonly onBack: () => void;
  /** Opens the creator session's own card; `undefined` when it is not on the board (or the kernel is away): the fact is plain text. */
  readonly onOpenCreator?: (() => void) | undefined;
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

/** A ticket card's session row: the session, its status, and the button that shows its log. */
function SessionRow({ session, shown, onPick }: { readonly session: SessionSummary; readonly shown: boolean; readonly onPick: () => void }) {
  return (
    <li className="tasks-side-row ticket-link-row" data-testid="task-session-row">
      <span>
        Session #{session.id} · {agentText(session.agent)}
      </span>
      <Badge tone={toneOf("session", session.status)}>{printable(session.status)}</Badge>
      <Button size="row" variant="ghost" aria-label={`Show session ${session.id} log`} aria-pressed={shown} onClick={onPick}>
        Show log
      </Button>
    </li>
  );
}

function ApprovalRow({ approval, link }: { readonly approval: Approval; readonly link?: ReactNode }) {
  return (
    <li className="tasks-side-row">
      <span>
        Approval #{approval.id} · {printable(approval.action)}
      </span>
      <Badge tone={approval.status === "pending" ? "attention" : "neutral"}>{printable(approval.status)}</Badge>
      {link}
    </li>
  );
}

export function TaskDetail({ item, card, now, offline, avatar, avatarState, approvalId, titles, onBack, onOpenCreator, onKillRequest }: TaskDetailProps) {
  const { history, session, sessionId } = card;
  const regionRef = useRef<HTMLElement>(null);
  // The card the owner opened has left the DOM: focus lands here, so Tab reaches Back first.
  useEffect(() => {
    regionRef.current?.focus();
  }, []);

  // A session card's title (also the log's task): the kernel's, from this card's history (`GET /tasks/:kind/:id` carries
  // each `SessionSummary` with its title) over the screen's `GET /sessions` list; else `Session #<id>` (`cardTitle`).
  const known = new Map(titles ?? []);
  for (const [id, t] of sessionTitles(history?.sessions)) known.set(id, t);
  const title = cardTitle(item, known);
  const ticket = item.ticket_pr;
  const plainFacts = factsOf(item, now, session, history?.runs.find((r) => item.kind === "playbook_run" && r.id === item.id));
  // A ticket card's State is its PR's (the kernel's `pr_tracks` row), not the task row's word.
  const facts = ticket === null ? plainFacts : [...ticketFacts(ticket, approvalId), ...plainFacts.filter((f) => f.label !== "State")];
  const events = (history?.events ?? []).map((event) => historyLine(event, { sessions: history?.sessions ?? [], card: item }));
  const runs = item.kind === "playbook_run" ? [] : (history?.runs ?? []);
  const approvals = history?.approvals ?? [];
  // Oldest first, as the events are.
  const sessions = ticket === null ? [] : [...(history?.sessions ?? [])].sort((a, b) => a.id - b.id);

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
        <Crumb className="tasks-crumb" glyphClassName="tasks-glyph" parent="Tasks" current={`${KIND_LABEL[item.kind]} #${item.id}`} onBack={onBack} testId="task-back" />
        <div className="tasks-detail-title">
          <Avatar agent={avatar} state={avatarState} size={24} />
          <h2 className="tasks-detail-h">{title}</h2>
        </div>
        <dl className="tasks-facts" data-testid="task-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="tasks-fact">
              <dt>{fact.label}</dt>
              <dd>
                {fact.session !== undefined && onOpenCreator !== undefined ? (
                  <button type="button" className="tasks-link" onClick={onOpenCreator} data-testid="task-created-in">
                    {fact.text}
                  </button>
                ) : fact.tone === undefined ? (
                  fact.text
                ) : (
                  <Badge tone={fact.tone}>{fact.text}</Badge>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {ticket === null || approvalId === undefined ? null : <TicketWaitingBand approvalId={approvalId} pr={ticket.number} offline={offline} />}
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
              {events.map((event) => {
                const at = ticket === null ? null : event.session;
                return (
                  <li key={event.id} className="tasks-event">
                    <div className="tasks-event-top">
                      <b>{event.kind}</b>
                      <span data-testid="task-event-actor">{event.actor}</span>
                      <time>{event.time}</time>
                    </div>
                    <p className="tasks-event-text" data-testid="task-event-sentence">
                      {event.sentence}
                    </p>
                    {at === null ? null : (
                      <div className="ticket-event-links">
                        <Button size="row" variant="ghost" data-testid="task-event-session" onClick={() => card.pickSession(at)}>
                          {`Session ${at} log`}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
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
          {sessions.length === 0 ? null : (
            <>
              <div className="tasks-history-head">Sessions · {sessions.length}</div>
              <ul className="tasks-side" aria-label="Sessions">
                {sessions.map((s) => (
                  <SessionRow key={s.id} session={s} shown={card.sessionId === s.id} onPick={() => card.pickSession(s.id)} />
                ))}
              </ul>
            </>
          )}
          {approvals.length === 0 ? null : (
            <>
              <div className="tasks-history-head">Approvals · {approvals.length}</div>
              <ul className="tasks-side" aria-label="Approvals">
                {approvals.map((approval) => (
                  <ApprovalRow
                    key={approval.id}
                    approval={approval}
                    link={ticket !== null && approval.status === "pending" ? <OpenApprovalButton approvalId={approval.id} offline={offline} /> : undefined}
                  />
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
              task={title}
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
