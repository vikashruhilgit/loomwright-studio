// The Tasks screen's views (phase 7 item 03): the frame every state is drawn in,
// the loading, error, empty and no-bridge states, and the board with its
// cards. Pure drawing: the data, the keys and the palette commands are
// `TasksScreen.tsx`'s. Every string a card carries (a title, an agent, a state
// word) is untrusted and passes through `./model.ts`'s escaping.
import { useCallback, useId } from "react";
import type { ReactNode, Ref } from "react";
import type { RosterEntry, TaskBoardItem } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarAgent, AvatarState } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { printable } from "../approvals/printable";
import { KIND_LABEL, agentText, cardLabel, cardOrder, cardTitle, metaText, reasonText, stateText, toneOf } from "./model";
import type { Board, BoardCard, ColumnId } from "./model";
import "./tasks.css";

export const EMPTY_TITLE = "No tasks yet.";
export const EMPTY_NOTE =
  "A task appears here when Wright or a crew member takes on work with more than one step. Sessions and playbook runs show up beside them. Ask Wright for something and the first card lands in Working.";

/** Why the last read of the board failed: the kernel did not answer, or it refused. */
export type ReadError = { readonly kind: "connection" } | { readonly kind: "refused"; readonly status: number; readonly code: string; readonly message: string | undefined };

// ---- small helpers ------------------------------------------------------------------------------

/** The avatar's agent: the roster's shape and hue when the agent is on it; a neutral one otherwise. */
export function avatarAgent(agent: string | null, roster: readonly RosterEntry[] | undefined): AvatarAgent {
  if (agent === null) return { id: "unknown-agent", name: "unknown agent" };
  const entry = roster?.find((a) => a.id === agent);
  const name = entry === undefined ? printable(agent) : printable(entry.display_name);
  return entry === undefined ? { id: agent, name } : { id: agent, name, shape: entry.avatar.shape, hue: entry.avatar.hue };
}

const COLUMN_AVATAR: Readonly<Record<ColumnId, AvatarState>> = { wait: "waiting", work: "working", park: "parked", done: "idle" };

export function avatarState(item: TaskBoardItem, column: ColumnId): AvatarState {
  const tone = toneOf(item.kind, item.state);
  if (tone === "danger") return "danger";
  if (tone === "ok") return "done";
  return COLUMN_AVATAR[column];
}


// ---- the frame and the states ---------------------------------------------------------------------

interface FrameProps {
  readonly state: "loading" | "error" | "empty" | "populated" | "detail";
  readonly subtitle: string;
  readonly rootRef?: Ref<HTMLDivElement>;
  readonly children: ReactNode;
}

/** The screen's root (`screen-tasks`) and its bar: every state is drawn inside it. */
export function TasksFrame({ state, subtitle, rootRef, children }: FrameProps) {
  return (
    <div className="tasks" data-testid="screen-tasks" data-state={state} ref={rootRef}>
      <div className="tasks-bar">
        <span className="tasks-subtitle" data-testid="tasks-subtitle">
          {subtitle}
        </span>
      </div>
      {children}
    </div>
  );
}

export function TasksEmpty() {
  return (
    <TasksFrame state="empty" subtitle="0 tasks">
      <div className="tasks-empty" data-testid="tasks-empty">
        <h2 className="tasks-empty-title">{EMPTY_TITLE}</h2>
        <p className="tasks-empty-note">{EMPTY_NOTE}</p>
        <Button
          variant="primary"
          onClick={() => {
            window.location.hash = "#/chat";
          }}
        >
          Ask Wright
        </Button>
      </div>
    </TasksFrame>
  );
}

export function TasksLoading() {
  return (
    <TasksFrame state="loading" subtitle="">
      <div className="tasks-scroll" aria-busy="true">
        <span className="tasks-vh" role="status">
          Loading tasks
        </span>
        <div className="tasks-board">
          {["Waiting on you", "Working", "Parked", "Done today"].map((label) => (
            <div key={label} className="tasks-col">
              <div className="tasks-col-head">
                <span className="tasks-col-label">{label}</span>
              </div>
              {[0, 1].map((n) => (
                <div key={n} className="tasks-skel" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </TasksFrame>
  );
}

export function TasksFailure({ error, onRetry }: { readonly error: ReadError | undefined; readonly onRetry: () => void }) {
  const connection = error?.kind === "connection";
  return (
    <TasksFrame state="error" subtitle="tasks">
      <div className="tasks-fail" role="alert" data-testid="tasks-error">
        <h2 className="tasks-fail-title">Couldn't load tasks</h2>
        <p className="tasks-fail-note">
          {connection
            ? "The kernel isn't answering, so tasks can't be read until it is back. This screen reads again on its own."
            : "The kernel answered, but the tasks request failed. Nothing on this screen was changed."}
        </p>
        {error === undefined || error.kind === "connection" ? null : (
          <p className="tasks-fail-detail" data-testid="tasks-error-detail">
            GET /tasks · {error.status} · {error.code}
            {error.message === undefined ? "" : ` · ${error.message}`}
          </p>
        )}
        <div>
          <Button size="row" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </div>
    </TasksFrame>
  );
}

/** The screen the shell mounts when there is no bridge (a window without a preload). */
export function TasksNoKernel() {
  return (
    <div className="tasks tasks-single" data-testid="screen-tasks" data-state="no-bridge">
      <div className="tasks-empty">
        <h2 className="tasks-empty-title">Tasks</h2>
        <p className="tasks-empty-note">This window has no connection to the kernel, so there is nothing to show.</p>
      </div>
    </div>
  );
}

// ---- the board ---------------------------------------------------------------------------------

interface CardViewProps {
  readonly card: BoardCard;
  readonly agent: AvatarAgent;
  readonly offline: boolean;
  readonly tabbable: boolean;
  readonly onOpen: (card: BoardCard) => void;
  readonly onFocused: (key: string) => void;
  readonly onFocusLost: (key: string) => void;
}

function CardView({ card, agent, offline, tabbable, onOpen, onFocused, onFocusLost }: CardViewProps) {
  const { item, key, column } = card;
  const why = reasonText(item);
  // Reports the card leaving the DOM while it holds focus (a card that moves column is a new element), so the screen hands focus to its new one.
  const watch = useCallback(
    (node: HTMLButtonElement | null) => {
      if (node === null) return undefined;
      return () => {
        if (node.contains(document.activeElement)) onFocusLost(key);
      };
    },
    [key, onFocusLost],
  );
  return (
    <li>
      <button
        type="button"
        ref={watch}
        className={column === "wait" ? "tasks-card tasks-card-wait" : "tasks-card"}
        data-card-key={key}
        data-column={column}
        data-testid={`task-card-${key}`}
        aria-label={cardLabel(item)}
        aria-disabled={offline ? true : undefined}
        tabIndex={tabbable ? 0 : -1}
        onFocus={() => onFocused(key)}
        onClick={() => {
          if (!offline) onOpen(card);
        }}
      >
        <span className="tasks-card-kind">
          <span>
            {KIND_LABEL[item.kind]} #{item.id}
          </span>
          <span className="tasks-card-state" data-testid="task-card-state">
            <Badge tone={toneOf(item.kind, item.state)}>{stateText(item)}</Badge>
          </span>
        </span>
        <span className="tasks-card-title">{cardTitle(item)}</span>
        {why === null ? null : <span className="tasks-card-why">{why}</span>}
        <span className="tasks-card-meta">
          <Avatar agent={agent} state={avatarState(item, column)} size={20} />
          <span>
            {agentText(item.agent)} · {metaText(card)}
          </span>
        </span>
      </button>
    </li>
  );
}

interface BoardViewProps {
  readonly board: Board;
  readonly roster: readonly RosterEntry[] | undefined;
  readonly offline: boolean;
  readonly activeKey: string | null;
  readonly onOpen: (card: BoardCard) => void;
  readonly onFocused: (key: string) => void;
  readonly onFocusLost: (key: string) => void;
}

export function BoardView({ board, roster, offline, activeKey, onOpen, onFocused, onFocusLost }: BoardViewProps) {
  const idBase = useId();
  const order = cardOrder(board);
  const tabKey = order.some((c) => c.key === activeKey) ? activeKey : (order[0]?.key ?? null);
  return (
    <div className="tasks-scroll">
      <div className="tasks-board" data-testid="tasks-board">
        {board.columns.map(({ column, cards }) => {
          const labelId = `${idBase}-${column.id}`;
          return (
            <section
              key={column.id}
              className={column.id === "wait" && cards.length > 0 ? "tasks-col tasks-col-wait" : "tasks-col"}
              aria-labelledby={labelId}
              data-column={column.id}
              data-testid={`tasks-col-${column.id}`}
            >
              <div className="tasks-col-head">
                <span className="tasks-dot" data-column={column.id} aria-hidden="true" />
                <h2 className="tasks-col-label" id={labelId}>
                  {column.label}
                </h2>
                <Badge>{String(cards.length)}</Badge>
              </div>
              {cards.length === 0 ? (
                <p className="tasks-none">{column.none}</p>
              ) : (
                <ul className="tasks-cards">
                  {cards.map((card) => (
                    <CardView
                      key={card.key}
                      card={card}
                      agent={avatarAgent(card.item.agent, roster)}
                      offline={offline}
                      tabbable={card.key === tabKey}
                      onOpen={onOpen}
                      onFocused={onFocused}
                      onFocusLost={onFocusLost}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

