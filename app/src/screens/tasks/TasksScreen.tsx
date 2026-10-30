// The Tasks screen (phase 7 item 03): today's work as the mockup's four columns
// ("Waiting on you", "Working", "Parked", "Done today"), each card opening to its
// history and its session's log.
//
// - The cards are the kernel's rows (`GET /tasks`): tasks, playbook runs and the
//   sessions no task or run owns. `./model.ts` holds the one state -> column table;
//   a badge is green only for what the kernel recorded as done.
// - Live: the feed's events (every kind but `session_output_appended`) refetch the
//   board, so a card moves without a reload. Cards are keyed `kind:id`, column
//   order is fixed, and nothing else re-renders wholesale, so an unchanged card
//   and the column headers keep their place.
// - The kernel going away: the screen keeps its last data (subtitle "last known")
//   with the cards and Stop / Kill off, and never falls back to the empty state.
// - The keys: J / K and the arrows move between cards across the columns, Enter
//   opens one, Esc (or Back) returns with focus on the card that opened it.
// - ⌘K: `tasks.stop` and `tasks.kill`, registered only while a card with a live
//   session is open (the Open Tasks command is the shell's `screens.tasks`).
//
// `index.tsx` hands this screen the bridge, so no store hook runs without one.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ApiResult, StudioBridge, TasksResponse } from "../../api/contract";
import { isComposingKey, isEditableTarget } from "../../commands/keyboard";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { useLiveStore, useResource } from "../../store/react";
import { printable } from "../approvals/printable";
import { TaskDetail } from "./TaskDetail";
import { KIND_LABEL, agentText, buildBoard, cardOrder, refetchMark } from "./model";
import type { BoardCard } from "./model";
import { useOpenCard } from "./useOpenCard";
import type { OpenTarget } from "./useOpenCard";
import { BoardView, TasksEmpty, TasksFailure, TasksFrame, TasksLoading, avatarAgent, avatarState } from "./TasksViews";
import type { ReadError } from "./TasksViews";

/** The owner of the palette commands this screen registers. Never `screens.tasks`: that is the shell's. */
export const TASKS_OWNER = "tasks";

export const TASKS_COMMANDS = { stop: "tasks.stop", kill: "tasks.kill" } as const;

/** The board reads the newest this many rows (the kernel's largest page). */
export const TASKS_LIMIT = "200";

// ---- reading the board --------------------------------------------------------------------------

/** One read of `GET /tasks`. A throw, or a body that is not the response, is a failed read, never data. */
async function readTasks(api: StudioBridge): Promise<ApiResult<TasksResponse>> {
  let result: ApiResult<TasksResponse>;
  try {
    result = await api.request<TasksResponse>({ method: "GET", path: "/tasks", query: { limit: TASKS_LIMIT } });
  } catch {
    return { ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } };
  }
  if (result.ok && !Array.isArray((result.body as Partial<TasksResponse> | null)?.groups)) {
    return { ok: false, status: result.status, body: { error: "invalid_response" } };
  }
  return result;
}

function errorOf(result: ApiResult<unknown>): ReadError | undefined {
  if (result.ok) return undefined;
  if ("connection" in result) return { kind: "connection" };
  return { kind: "refused", status: result.status, code: printable(String(result.body.error)), message: typeof result.body.message === "string" ? printable(result.body.message) : undefined };
}

function useNow(): [number, () => void] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return [now, useCallback(() => setNow(Date.now()), [])];
}

// ---- the screen -----------------------------------------------------------------------------------

export interface TasksScreenProps {
  readonly api: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

export function TasksScreen({ api, registry = commandRegistry }: TasksScreenProps) {
  const { connection, eventLog } = useLiveStore(api);
  const agents = useResource("agents", api);
  const roster = agents?.data?.agents;
  const [now, touchNow] = useNow();

  const [data, setData] = useState<TasksResponse | undefined>();
  const [readError, setReadError] = useState<ReadError | undefined>();
  const [open, setOpen] = useState<OpenTarget | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);
  const mounted = useRef(true);
  const seq = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  /** The card key focus goes to once the board is drawn: the card that opened the detail, or one that moved column. */
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- reads -----------------------------------------------------------------------------------

  const refetch = useCallback(async (): Promise<void> => {
    seq.current += 1;
    const mine = seq.current;
    const result = await readTasks(api);
    if (!mounted.current || mine !== seq.current) return;
    // A read the kernel did not answer (or refused) never replaces what is on screen.
    setData((last) => (result.status === 0 ? last : result.ok ? result.body : last));
    setReadError(errorOf(result));
    touchNow();
  }, [api, touchNow]);

  // Any feed event but new session output (and a change of connection) reads the board again.
  const feedMark = `${refetchMark(eventLog)}:${connection.state}`;
  useEffect(() => { void refetch(); }, [refetch, feedMark]);

  const board = useMemo(() => (data === undefined ? undefined : buildBoard(data.groups, now)), [data, now]);
  const offline = connection.state === "unreachable" || connection.state === "reconnecting" || readError?.kind === "connection";
  const boardItem = open === null ? undefined : board === undefined ? undefined : cardOrder(board).find((c) => c.item.kind === open.kind && c.item.id === open.id)?.item;
  const card = useOpenCard(api, open, boardItem, eventLog, feedMark, refetch);
  const openItem = card.history?.item ?? boardItem;

  // ---- opening and closing a card -----------------------------------------------------------------

  const openCard = useCallback((c: BoardCard): void => {
    pendingFocus.current = c.key;
    setOpen({ kind: c.item.kind, id: c.item.id });
  }, []);
  const closeCard = useCallback((): void => {
    setOpen((current) => {
      if (current !== null) pendingFocus.current = `${current.kind}:${current.id}`;
      return null;
    });
    setConfirmKill(false);
  }, []);
  const onFocusLost = useCallback((key: string): void => {
    pendingFocus.current ??= key;
  }, []);

  // Focus goes back to the card that opened the detail (or the card that moved column) once the board is drawn.
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null || open !== null) return;
    const root = rootRef.current;
    // Not on a board (loading, error, empty): there is no card to hand focus to, and it is not owed later.
    const el = root === null ? null : (root.querySelector<HTMLElement>(`[data-card-key="${CSS.escape(key)}"]`) ?? root.querySelector<HTMLElement>("[data-card-key]"));
    pendingFocus.current = null;
    el?.focus();
  });

  // ---- Stop and Kill ------------------------------------------------------------------------------

  const stopApplies = card.live && !offline && !card.pending;
  const requestKill = useCallback((): void => {
    if (stopApplies) setConfirmKill(true);
  }, [stopApplies]);
  // A confirm lives only while its target does.
  const killOpen = confirmKill && stopApplies;
  useEffect(() => {
    if (confirmKill && !stopApplies) setConfirmKill(false);
  }, [confirmKill, stopApplies]);

  const latest = useRef({ stopApplies, stop: card.stop, requestKill, kill: card.kill, killOpen });
  useLayoutEffect(() => {
    latest.current = { stopApplies, stop: card.stop, requestKill, kill: card.kill, killOpen };
  });

  const liveOpen = open !== null && card.live;
  useEffect(() => {
    if (!liveOpen) return undefined;
    const unregister = registry.register(TASKS_OWNER, [
      {
        id: TASKS_COMMANDS.stop,
        title: "Stop the open card's session",
        group: "Tasks",
        keywords: ["stop", "session", "task", "graceful"],
        enabled: () => latest.current.stopApplies && !latest.current.killOpen,
        run: () => latest.current.stop(),
      },
      {
        id: TASKS_COMMANDS.kill,
        title: "Kill the open card's session",
        group: "Tasks",
        keywords: ["kill", "session", "task", "abort"],
        enabled: () => latest.current.stopApplies && !latest.current.killOpen,
        run: () => latest.current.requestKill(),
      },
    ]);
    return () => unregister();
  }, [registry, liveOpen]);

  // ---- the keys ----------------------------------------------------------------------------------------

  const open$ = useRef(open);
  useLayoutEffect(() => {
    open$.current = open;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isComposingKey(event) || isEditableTarget(event.target)) return;
      // Nothing runs behind an open dialog (the kill confirm, the kill switch: both `aria-modal`) or the ⌘K palette.
      if (document.querySelector('[aria-modal="true"], [data-testid="command-palette"]') !== null) return;
      if (open$.current !== null) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeCard();
        }
        return;
      }
      let delta: 1 | -1;
      switch (event.key) {
        case "j":
        case "ArrowDown":
          delta = 1;
          break;
        case "k":
        case "ArrowUp":
          delta = -1;
          break;
        default:
          return;
      }
      const root = rootRef.current;
      if (root === null) return;
      const cards = [...root.querySelectorAll<HTMLElement>("[data-card-key]")];
      if (cards.length === 0) return;
      event.preventDefault();
      const at = cards.findIndex((el) => el === document.activeElement);
      const next = at === -1 ? cards[0] : cards[Math.min(cards.length - 1, Math.max(0, at + delta))];
      next?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCard]);

  // ---- render --------------------------------------------------------------------------------------------

  if (data === undefined || board === undefined) {
    if (readError === undefined) return <TasksLoading />;
    return <TasksFailure error={readError} onRetry={() => void refetch()} />;
  }

  const lastKnown = offline ? " · last known" : "";
  const stale =
    readError === undefined || readError.kind === "connection" ? null : (
      <p className="tasks-stale" role="status" data-testid="tasks-stale">
        This board is from the last read that answered; the latest one failed (GET /tasks · {readError.status} · {readError.code}).
      </p>
    );

  if (open !== null && openItem === undefined) {
    // The card left the board before its history answered: nothing to show but the way back.
    return (
      <TasksFrame state="detail" subtitle={`${KIND_LABEL[open.kind]} #${open.id}${lastKnown}`} rootRef={rootRef}>
        <div className="tasks-detail" data-testid="task-detail" data-card-key={`${open.kind}:${open.id}`}>
          <div className="tasks-crumb">
            <Button variant="ghost" size="row" onClick={closeCard} data-testid="task-back">
              Back
            </Button>
          </div>
          <p className="tasks-note" role="status" data-testid="task-gone">
            {KIND_LABEL[open.kind]} #{open.id} is no longer on the board. Back returns to it.
          </p>
        </div>
      </TasksFrame>
    );
  }

  if (open !== null && openItem !== undefined) {
    const column = board.columns.find((c) => c.cards.some((k) => k.item.kind === openItem.kind && k.item.id === openItem.id))?.column.id ?? "work";
    return (
      <TasksFrame state="detail" subtitle={`${KIND_LABEL[openItem.kind]} #${openItem.id}${lastKnown}`} rootRef={rootRef}>
        {stale}
        <TaskDetail
          key={`${openItem.kind}:${openItem.id}`}
          item={openItem}
          card={card}
          now={now}
          offline={offline}
          avatar={avatarAgent(openItem.agent, roster)}
          avatarState={avatarState(openItem, column)}
          onBack={closeCard}
          onKillRequest={requestKill}
        />
        {killOpen && card.sessionId !== null ? (
          <Dialog
            kind="confirm"
            title={`Kill session #${card.sessionId}?`}
            description={
              <>
                Kills {agentText(card.session?.agent ?? openItem.agent)}'s session at once: its process group and every tool it started, with no grace. The current
                step is lost. Stop is gentler: it lets the session end its turn first.
              </>
            }
            action={{
              label: "Kill",
              onAction: () => {
                setConfirmKill(false);
                latest.current.kill();
              },
            }}
            onCancel={() => setConfirmKill(false)}
          />
        ) : null}
      </TasksFrame>
    );
  }

  if (board.total === 0) return <TasksEmpty />;

  const count = `${board.total} ${board.total === 1 ? "card" : "cards"} · ${board.working} working${lastKnown}`;
  return (
    <TasksFrame state="populated" subtitle={count} rootRef={rootRef}>
      {board.waiting > 0 ? (
        <div className="tasks-band" role="status" data-testid="tasks-attention-band">
          <span className="tasks-band-dot" aria-hidden="true" />
          <span>{board.waiting === 1 ? "1 thing waits on you." : `${board.waiting} things wait on you.`}</span>
        </div>
      ) : null}
      {stale}
      {data.next_before === null ? null : (
        <p className="tasks-stale" data-testid="tasks-more">
          Showing the newest {TASKS_LIMIT} cards; older ones are not shown.
        </p>
      )}
      <BoardView board={board} roster={roster} offline={offline} activeKey={activeKey} onOpen={openCard} onFocused={setActiveKey} onFocusLost={onFocusLost} />
    </TasksFrame>
  );
}
