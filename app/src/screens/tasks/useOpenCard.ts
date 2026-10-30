// The open card's data (phase 7 item 03): its history (`GET /tasks/:kind/:id`),
// its session's log (`SessionOutputReader`, read after the last `seq` whenever the
// feed announces `session_output_appended` for it) and Stop / Kill (phase 5's
// `POST /sessions/:id/stop` and `/kill`), each showing the status the kernel answered.
//
// Reused as-is from the Sessions screen: `isLive`, `effectiveStatus`, `ControlState`
// (`../sessions/model`) and `SessionOutputReader` (`../sessions/output`). The small
// `send` wrapper is local: the Sessions screen's is private to a file this item does not touch.
//
// A hook, not a component: the screen registers the palette commands from what it
// returns, and the detail view only draws it.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ApiRequest, ApiResult, EventFrame, SessionControlResponse, SessionSummary, StudioBridge, TaskBoardItem, TaskHistoryResponse, TruncatedEventFrame } from "../../api/contract";
import type { StreamingLogLine } from "../../components/StreamingLog/StreamingLog";
import { printable } from "../approvals/printable";
import { type ControlState, effectiveStatus, isLive, rowToLine } from "../sessions/model";
import { SessionOutputReader } from "../sessions/output";
import type { OutputSnapshot } from "../sessions/output";
import { logSessionOf, outputAnnounced } from "./model";

/** What the open card is: the board's `kind` and `id`. */
export interface OpenTarget {
  readonly kind: TaskBoardItem["kind"];
  readonly id: number;
}

type ControlVerb = "stop" | "kill";

const IDLE_OUTPUT: OutputSnapshot = { rows: [], lastSeq: 0, reading: false, loaded: false, error: undefined };
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

async function send<R>(api: StudioBridge, req: ApiRequest): Promise<ApiResult<R> | undefined> {
  try {
    return await api.request<R>(req);
  } catch {
    return undefined;
  }
}

const VERB_DONE: Readonly<Record<ControlVerb, string>> = { stop: "stopped", kill: "killed" };

/** A refusal's words, escaped: the kernel's `error` and, when it gave one, its `message`. */
function refusalText(result: ApiResult<unknown> | undefined, verb: ControlVerb): string {
  if (result === undefined) return `The request failed before it reached the kernel; nothing was ${VERB_DONE[verb]}.`;
  if (result.ok) return "";
  if ("connection" in result) return `Couldn't reach the kernel; nothing was ${VERB_DONE[verb]}.`;
  const code = printable(String(result.body.error));
  const message = typeof result.body.message === "string" ? `: ${printable(result.body.message)}` : "";
  return `The kernel refused (${result.status} ${code})${message}.`;
}

function historyFailure(result: ApiResult<unknown> | undefined): string {
  if (result === undefined) return "The history read failed before it reached the kernel.";
  if (result.ok) return "The kernel's history answer was not the shape this window reads.";
  if ("connection" in result) return "Couldn't reach the kernel to read this card's history.";
  const message = typeof result.body.message === "string" ? `: ${printable(result.body.message)}` : "";
  return `The kernel refused the history read (${result.status} ${printable(String(result.body.error))})${message}.`;
}

function isHistory(body: unknown): body is TaskHistoryResponse {
  const h = body as Partial<TaskHistoryResponse> | null;
  return typeof h === "object" && h !== null && typeof h.item === "object" && h.item !== null && Array.isArray(h.events) && Array.isArray(h.sessions) && Array.isArray(h.runs) && Array.isArray(h.approvals);
}

/** Whether Stop and Kill apply: the kernel says it runs, and no answer from this window has said it ended since. */
function runsNow(status: string | undefined, control: ControlState | undefined): boolean {
  return status !== undefined && isLive(status) && !(control?.phase === "answered" && !isLive(control.status));
}

export interface OpenCard {
  /** The kernel's answer for the open card; `undefined` until the first one. Kept (never blanked) while a later read fails. */
  readonly history: TaskHistoryResponse | undefined;
  /** The last history read's failure, escaped; cleared by the next good answer. */
  readonly historyError: string | undefined;
  /** The kernel answered 404 for this card: it is no longer there. */
  readonly gone: boolean;
  /** The session whose log is shown, or `null`: the card has none. */
  readonly sessionId: number | null;
  readonly session: SessionSummary | undefined;
  readonly output: OutputSnapshot;
  readonly lines: readonly StreamingLogLine[];
  /** Stop and Kill apply. */
  readonly live: boolean;
  /** The status shown: the kernel's own word, or `stopping…` / `killing…` while a request is on its way. */
  readonly status: string | undefined;
  readonly reason: string | null;
  readonly pending: boolean;
  /** A refusal, or the note that the session had already ended, in words. */
  readonly notice: string | undefined;
  stop(): void;
  kill(): void;
  readAgain(): void;
}

/**
 * The data of the open card, or an inert one for `open === null`.
 * `feedMark` changes whenever the feed delivers an event that makes the board refetch; the history refetches with it.
 * `onControlled` runs after a Stop or Kill answered, so the board can refetch too.
 */
export function useOpenCard(
  api: StudioBridge,
  open: OpenTarget | null,
  boardItem: TaskBoardItem | undefined,
  eventLog: readonly (EventFrame | TruncatedEventFrame)[],
  feedMark: string,
  onControlled: () => void,
): OpenCard {
  const key = open === null ? null : `${open.kind}:${open.id}`;
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly body: TaskHistoryResponse } | undefined>();
  const [failure, setFailure] = useState<{ readonly key: string; readonly text: string; readonly gone: boolean } | undefined>();
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const kind = open?.kind;
  const id = open?.id;
  const refetchHistory = useCallback(async (): Promise<void> => {
    if (kind === undefined || id === undefined) return;
    const mine = `${kind}:${id}`;
    seq.current += 1;
    const n = seq.current;
    const result = await send<TaskHistoryResponse>(api, { method: "GET", path: "/tasks/:kind/:id", params: { kind, id } });
    if (!mounted.current || n !== seq.current) return;
    if (result?.ok === true && isHistory(result.body)) {
      const body = result.body;
      setLoaded({ key: mine, body });
      setFailure(undefined);
      return;
    }
    const gone = result !== undefined && !result.ok && result.status === 404;
    setFailure({ key: mine, text: historyFailure(result), gone });
  }, [api, kind, id]);
  useEffect(() => {
    void refetchHistory();
  }, [refetchHistory, feedMark]);

  const history = loaded?.key === key ? loaded.body : undefined;
  const failed = failure?.key === key ? failure : undefined;
  const item = history?.item ?? boardItem;

  // ---- the session whose log is shown ----------------------------------------------------------
  const sessionId = item === undefined ? null : logSessionOf(item, history?.sessions ?? [], isLive);
  const session = sessionId === null ? undefined : history?.sessions.find((s) => s.id === sessionId);
  /** A session card knows its status from its row until the history answers; any other card needs the session's summary. */
  const listStatus = session?.status ?? (item?.kind === "session" ? item.state : undefined);

  const [reader, setReader] = useState<SessionOutputReader | undefined>();
  useEffect(() => {
    if (sessionId === null) {
      setReader(undefined);
      return undefined;
    }
    const next = new SessionOutputReader(api, sessionId);
    setReader(next);
    next.read();
    return () => next.dispose();
  }, [api, sessionId]);
  const current = reader !== undefined && reader.sessionId === sessionId ? reader : undefined;
  const subscribe = useMemo(() => (current === undefined ? NO_SUBSCRIBE : (listener: () => void) => current.subscribe(listener)), [current]);
  const output = useSyncExternalStore(subscribe, () => (current === undefined ? IDLE_OUTPUT : current.snapshot()));

  // New output is read when the feed announces it for this session, never by a timer.
  const lastActed = useRef<number | null>(null);
  useEffect(() => {
    const last = eventLog[eventLog.length - 1]?.id ?? 0;
    const prev = lastActed.current;
    lastActed.current = last;
    if (prev === null || current === undefined) return;
    if (outputAnnounced(eventLog, prev, current.sessionId)) current.read();
  }, [eventLog, current]);
  const lines = useMemo(() => output.rows.map(rowToLine), [output.rows]);

  // ---- Stop and Kill -------------------------------------------------------------------------------
  const [control, setControl] = useState<{ readonly sessionId: number; readonly state: ControlState } | undefined>();
  const inFlight = useRef(new Set<number>());
  const known = control !== undefined && control.sessionId === sessionId ? control.state : undefined;
  const live = runsNow(listStatus, known);
  const latest = useRef({ sessionId, live });
  useLayoutEffect(() => {
    latest.current = { sessionId, live };
  });

  const act = useCallback(
    (verb: ControlVerb): void => {
      const { sessionId: target, live: applies } = latest.current;
      if (target === null || !applies || inFlight.current.has(target)) return;
      inFlight.current.add(target);
      setControl({ sessionId: target, state: { phase: "pending", verb } });
      void (async () => {
        const result = await send<SessionControlResponse>(api, { method: "POST", path: `/sessions/:id/${verb}`, params: { id: target } });
        inFlight.current.delete(target);
        if (!mounted.current) return;
        if (result?.ok === true) {
          const reason = typeof result.body.reason === "string" ? result.body.reason : null;
          setControl({ sessionId: target, state: { phase: "answered", verb, status: String(result.body.status), reason } });
        } else if (result !== undefined && !result.ok && "body" in result && typeof result.body.status === "string") {
          // A 409 `not_running` names the session's current status: it is shown.
          setControl({ sessionId: target, state: { phase: "answered", verb, status: result.body.status, reason: null, notice: refusalText(result, verb) } });
        } else {
          setControl({ sessionId: target, state: { phase: "refused", verb, notice: refusalText(result, verb) } });
        }
        // The feed's `session_*` events refetch these too; asking now shows the kernel's answer sooner.
        void refetchHistory();
        onControlled();
      })();
    },
    [api, refetchHistory, onControlled],
  );
  const stop = useCallback(() => act("stop"), [act]);
  const kill = useCallback(() => act("kill"), [act]);
  const readAgain = useCallback(() => current?.read(), [current]);

  const effective = listStatus === undefined ? undefined : effectiveStatus(listStatus, known);
  const notice = known === undefined || known.phase === "pending" ? undefined : known.notice;

  return {
    history,
    historyError: failed?.text,
    gone: failed?.gone === true,
    sessionId,
    session,
    output,
    lines,
    live,
    status: effective?.status,
    reason: effective?.reason ?? null,
    pending: effective?.pending ?? false,
    notice,
    stop,
    kill,
    readAgain,
  };
}
