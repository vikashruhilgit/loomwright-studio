// The Sessions screen (phase 5 item 16): every session the kernel lists, its
// output streaming, and Stop, Kill and Abandon, each showing the status the
// kernel answered.
//
// - The list pane (`--list-pane-width`, 360px): "Running", "Waiting on you"
//   (a running session with a pending approval it asked for), then "Recent".
//   Each row: the agent's avatar, the agent, the task (`playbook #<n>` or
//   `ad hoc session`: the contract has no task field), the running time, the
//   tokens and the kernel's status word; a `kill unconfirmed` badge for a
//   session in `/status` `kill_unconfirmed`, the orphan reason for one in
//   `orphaned`. The selection is a session id, never a list index.
// - The detail: the cwd and model, then the session's `StreamingLog`, read
//   from `GET /sessions/:id/output` after the last `seq` it has (`./output.ts`)
//   whenever the feed announces `session_output_appended` for it.
// - Controls: Stop (⌘.), Kill (asks first) and, for a `leader_unverified`
//   orphan only, Abandon (asks first). While a request is in flight the row
//   says `stopping…`, never `stopped`; then the kernel's answer; then the list.
// - ⌘K: `sessions.stop`, `sessions.kill`, `sessions.abandon`, registered while
//   the screen is mounted, `enabled` following the selection.
//
// The shell hands screens no bridge, so the exported component reads
// `window.api` itself and calls no store hook before that check: with no
// bridge (a unit test of the shell) it renders a plain state, never a throw.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type {
  AbandonResponse,
  ApiRequest,
  ApiResult,
  EventFrame,
  RosterEntry,
  SessionControlResponse,
  SessionSummary,
  StatusBody,
  StudioBridge,
  TruncatedEventFrame,
} from "../../api/contract";
import { isComposingKey, isEditableTarget } from "../../commands/keyboard";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarAgent, AvatarState } from "../../components/Avatar/Avatar";
import { Badge } from "../../components/Badge/Badge";
import { Button } from "../../components/Button/Button";
import { Dialog } from "../../components/Dialog/Dialog";
import { List } from "../../components/List/List";
import { StreamingLog } from "../../components/StreamingLog/StreamingLog";
import { liveStoreFor, useLiveStore, useResource } from "../../store/react";
import type { ResourceError } from "../../store/store";
import { printable } from "../approvals/printable";
import {
  type ControlState,
  type ControlVerb,
  agentText,
  displayOrder,
  effectiveStatus,
  elapsedText,
  groupSessions,
  isLive,
  rowToLine,
  statusLine,
  statusView,
  taskText,
  tokensText,
} from "./model";
import { SessionOutputReader } from "./output";
import type { OutputSnapshot } from "./output";
import "./sessions.css";

/** The command ids this screen registers (owner `sessions`). Never `screens.sessions`: that is the shell's. */
export const SESSION_COMMANDS = {
  stop: "sessions.stop",
  kill: "sessions.kill",
  abandon: "sessions.abandon",
} as const;

export const EMPTY_TITLE = "Nothing running.";

/** The feed event announcing new output rows (`SESSION_OUTPUT_APPENDED` in `kernel/src/console/output.ts`). */
export const SESSION_OUTPUT_APPENDED = "session_output_appended";

/** The one orphan reason the kernel lets the owner abandon (`abandonSession` in `kernel/src/sessions/manager.ts`). */
export const ABANDONABLE_REASON = "leader_unverified";

export interface SessionsScreenProps {
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

/** The screen. Reads `window.api` defensively: the shell does not pass the bridge to screens. */
export function SessionsScreen({ registry = commandRegistry }: SessionsScreenProps) {
  const api = (window as unknown as { api?: StudioBridge }).api;
  if (api === undefined) {
    return (
      <div className="sessions sessions-single" data-testid="screen-sessions" data-state="no-bridge">
        <div className="sessions-empty">
          <h2 className="sessions-empty-title">Sessions</h2>
          <p className="sessions-empty-note">This window has no connection to the kernel, so there is nothing to show.</p>
        </div>
      </div>
    );
  }
  return <SessionsView api={api} registry={registry} />;
}

// ---- helpers ---------------------------------------------------------------------------

async function send<R>(api: StudioBridge, req: ApiRequest): Promise<ApiResult<R> | undefined> {
  try {
    return await api.request<R>(req);
  } catch {
    return undefined;
  }
}

const VERB_DONE: Readonly<Record<ControlVerb, string>> = { stop: "stopped", kill: "killed", abandon: "abandoned" };

/** A refusal's words, escaped: the kernel's `error` and, when it gave one, its `message`. */
function refusalText(result: ApiResult<unknown> | undefined, verb: ControlVerb): string {
  if (result === undefined) return `The request failed before it reached the kernel; nothing was ${VERB_DONE[verb]}.`;
  if (result.ok) return "";
  if ("connection" in result) return `Couldn't reach the kernel; nothing was ${VERB_DONE[verb]}.`;
  const code = printable(String(result.body.error));
  const message = typeof result.body.message === "string" ? `: ${printable(result.body.message)}` : "";
  return `The kernel refused (${result.status} ${code})${message}.`;
}

function errorText(error: ResourceError): string {
  if (error.kind === "not_connected") return "The kernel isn't answering, so no session can be read or stopped from here until it is back.";
  if (error.kind === "bridge_failed") return "The request failed before it reached the kernel.";
  const message = typeof error.body.message === "string" ? `: ${printable(error.body.message)}` : "";
  return `The kernel refused the read (${error.status} ${printable(String(error.body.error))})${message}.`;
}

/** A read that failed after an earlier one answered: the data on screen is the older answer. Not for `not_connected`: the shell's band says that. */
function staleError(data: unknown, error: ResourceError | undefined): ResourceError | undefined {
  return data !== undefined && error !== undefined && error.kind !== "not_connected" ? error : undefined;
}

function isTruncated(frame: EventFrame | TruncatedEventFrame): frame is TruncatedEventFrame {
  return (frame as { truncated?: unknown }).truncated === true;
}

/** The avatar's pose for a row: its state from the status the row shows. */
function avatarState(status: string, waiting: boolean, danger: boolean, killUnconfirmed: boolean): AvatarState {
  if (danger || killUnconfirmed) return "danger";
  if (waiting) return "waiting";
  if (isLive(status) || status.endsWith("…")) return "working";
  if (status === "completed") return "done";
  if (status === "orphaned" || status === "interrupted") return "parked";
  return "idle";
}

/** The avatar's agent: the roster's shape and hue when the agent is on it; a neutral one otherwise. */
function avatarAgent(session: SessionSummary, roster: readonly RosterEntry[] | undefined): AvatarAgent {
  if (session.agent === null) return { id: "unknown-agent", name: "unknown agent" };
  const entry = roster?.find((a) => a.id === session.agent);
  const name = printable(session.agent);
  return entry === undefined ? { id: session.agent, name } : { id: session.agent, name, shape: entry.avatar.shape, hue: entry.avatar.hue };
}

/** A clock that ticks every second while `on` (a running session's time moves). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

/**
 * Whether Stop and Kill apply: the kernel's list says it runs, and no answer from this window has said it
 * ended since (a list read that left before the answer may still say `running`).
 */
function runsNow(session: SessionSummary, control: ControlState | undefined): boolean {
  return isLive(session.status) && !(control?.phase === "answered" && !isLive(control.status));
}

/** The orphan rule: `orphaned` in the kernel's list, `leader_unverified` in `/status`, and not already answered here. */
function canAbandon(session: SessionSummary | undefined, body: StatusBody | undefined, done: ControlState | undefined): boolean {
  if (session === undefined || session.status !== "orphaned" || done?.phase === "answered") return false;
  const orphan = body?.orphaned?.find((o) => o.id === session.id);
  return orphan !== undefined && orphan.reason === ABANDONABLE_REASON;
}

/**
 * The listed session a confirm still acts on, or `undefined` once it can't: its session left the kernel's
 * list (or there is no answered list: loading, error), or its action no longer applies (a Kill for a session
 * that ended, an Abandon for a row no longer a `leader_unverified` orphan). Read against the newest list, so
 * a refetch that still lists the session with the action applying never closes the confirm.
 */
function confirmTarget(
  dialog: DialogTarget | null,
  ordered: readonly SessionSummary[],
  body: StatusBody | undefined,
  controls: ReadonlyMap<number, ControlState>,
): SessionSummary | undefined {
  if (dialog === null) return undefined;
  const listed = ordered.find((s) => s.id === dialog.session.id);
  if (listed === undefined) return undefined;
  const done = controls.get(listed.id);
  return (dialog.verb === "kill" ? runsNow(listed, done) : canAbandon(listed, body, done)) ? listed : undefined;
}

const IDLE_OUTPUT: OutputSnapshot = { rows: [], lastSeq: 0, reading: false, loaded: false, error: undefined };
const NO_SUBSCRIBE = (): (() => void) => () => undefined;

/**
 * A callback ref that reports an element leaving the DOM while it (or a descendant) holds focus. Stable per
 * screen: a new identity would detach and re-attach it on every render, which reads as a removal.
 */
type FocusWatch = (node: HTMLElement | null) => (() => void) | undefined;

/** Where focus goes once a watched element took it with it: the row it was on, or the region in its place. */
type FocusLoss = "row" | "region";

/** One reader per session id this screen has shown (an ended session's log is kept), disposed on unmount. */
function useOutputReaders(api: StudioBridge): (id: number) => SessionOutputReader {
  const readers = useRef(new Map<number, SessionOutputReader>());
  useEffect(() => {
    const all = readers.current;
    return () => {
      for (const reader of all.values()) reader.dispose();
      all.clear();
    };
  }, []);
  return useCallback(
    (id: number) => {
      let reader = readers.current.get(id);
      if (reader === undefined) {
        reader = new SessionOutputReader(api, id);
        readers.current.set(id, reader);
      }
      return reader;
    },
    [api],
  );
}

// ---- the view ----------------------------------------------------------------------------

type DialogTarget = { readonly verb: "kill" | "abandon"; readonly session: SessionSummary };

interface Row {
  readonly session: SessionSummary;
  readonly agent: string;
  readonly task: string;
  readonly elapsed: string;
  readonly tokens: string;
  readonly status: ReturnType<typeof statusView>;
  readonly pending: boolean;
  readonly waitingOn: number | undefined;
  readonly killUnconfirmed: boolean;
  readonly orphanReason: string | null | undefined;
  readonly avatar: AvatarAgent;
  readonly avatarState: AvatarState;
}

function SessionsView({ api, registry }: { readonly api: StudioBridge; readonly registry: CommandRegistry }) {
  const sessions = useResource("sessions", api);
  const status = useResource("status", api);
  const approvals = useResource("approvals", api);
  const agents = useResource("agents", api);
  const { eventLog } = useLiveStore(api);
  const store = liveStoreFor(api);
  const readerFor = useOutputReaders(api);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [controls, setControls] = useState<ReadonlyMap<number, ControlState>>(new Map());
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  /** The sessions with a control request in flight: the one guard Stop, ⌘. and the commands share. */
  const inFlight = useRef(new Set<number>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- the rows --------------------------------------------------------------------------

  const list = sessions?.data?.sessions;
  const statusBody: StatusBody | undefined = status?.data;
  /** Session id -> the pending approval it asked for. */
  const waitingOn = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of approvals?.data?.approvals ?? []) if (a.status === "pending" && a.requesting_session !== null && !map.has(a.requesting_session)) map.set(a.requesting_session, a.id);
    return map;
  }, [approvals?.data]);
  const groups = useMemo(() => groupSessions(list ?? [], new Set(waitingOn.keys())), [list, waitingOn]);
  const ordered = useMemo(() => displayOrder(groups), [groups]);
  const anyLive = ordered.some((s) => isLive(s.status));
  const now = useNow(anyLive);

  const rowFor = useCallback(
    (session: SessionSummary): Row => {
      const effective = effectiveStatus(session.status, controls.get(session.id));
      const view = statusView(effective.status, effective.reason);
      const killUnconfirmed = statusBody?.kill_unconfirmed?.some((k) => k.id === session.id) ?? false;
      const orphan = statusBody?.orphaned?.find((o) => o.id === session.id);
      const waiting = waitingOn.get(session.id);
      return {
        session,
        agent: agentText(session),
        task: taskText(session),
        elapsed: elapsedText(session, now),
        tokens: tokensText(session.tokens),
        status: view,
        pending: effective.pending,
        waitingOn: waiting,
        killUnconfirmed,
        orphanReason: orphan === undefined ? undefined : orphan.reason,
        avatar: avatarAgent(session, agents?.data?.agents),
        avatarState: avatarState(effective.status, waiting !== undefined && isLive(session.status), view.danger, killUnconfirmed),
      };
    },
    [controls, statusBody, waitingOn, now, agents?.data],
  );

  // Selected by id. Before the owner has picked one, the first row (the newest running session) is it.
  const lastShown = useRef<SessionSummary | undefined>(undefined);
  const found = ordered.find((s) => s.id === selectedId);
  const selected = found ?? (selectedId === null ? ordered[0] : undefined);
  const goneId = selectedId !== null && found === undefined ? selectedId : null;
  useEffect(() => {
    if (selectedId === null && selected !== undefined) setSelectedId(selected.id);
  }, [selected, selectedId]);
  useLayoutEffect(() => {
    if (selected !== undefined) lastShown.current = selected;
  });

  // ---- the output: read on selection, then after the last seq on each announcement ----------------

  const selectedSessionId = selected?.id ?? null;
  const reader = selectedSessionId === null ? undefined : readerFor(selectedSessionId);
  const subscribeOutput = useMemo(() => (reader === undefined ? NO_SUBSCRIBE : (listener: () => void) => reader.subscribe(listener)), [reader]);
  const output = useSyncExternalStore(subscribeOutput, () => (reader === undefined ? IDLE_OUTPUT : reader.snapshot()));
  useEffect(() => {
    if (selectedSessionId !== null) readerFor(selectedSessionId).read();
  }, [selectedSessionId, readerFor]);

  /** The last event id this screen acted on: never a list length or an index (the log is capped and can be reset). */
  const lastActed = useRef<number | null>(null);
  useEffect(() => {
    const last = eventLog[eventLog.length - 1]?.id ?? 0;
    const prev = lastActed.current;
    lastActed.current = last;
    if (prev === null || selectedSessionId === null) return;
    let wanted = false;
    if (last < prev) wanted = true; // the log was reset (a wiped event table): read from the last seq.
    else if (last > prev) {
      // More frames than the log keeps arrived at once: some are gone unseen, so read.
      const first = eventLog[0]?.id;
      if (first !== undefined && first > prev + 1) wanted = true;
      for (let i = eventLog.length - 1; i >= 0 && !wanted; i -= 1) {
        const frame = eventLog[i];
        if (frame === undefined || frame.id <= prev) break;
        if (frame.kind !== SESSION_OUTPUT_APPENDED) continue;
        // A truncated frame carries no session_id: it may be this session's.
        if (isTruncated(frame) || frame.session_id === selectedSessionId) wanted = true;
      }
    }
    if (wanted) readerFor(selectedSessionId).read();
  }, [eventLog, selectedSessionId, readerFor]);

  const lines = useMemo(() => output.rows.map(rowToLine), [output.rows]);

  // ---- actions ------------------------------------------------------------------------------

  const setControl = useCallback((id: number, next: ControlState) => {
    setControls((current) => new Map(current).set(id, next));
  }, []);

  /** Sends one control request. The callers hold the in-flight guard. */
  const control = useCallback(
    async (session: SessionSummary, verb: ControlVerb): Promise<void> => {
      inFlight.current.add(session.id);
      setControl(session.id, { phase: "pending", verb });
      const result = await send<SessionControlResponse | AbandonResponse>(api, { method: "POST", path: `/sessions/:id/${verb}`, params: { id: session.id } });
      inFlight.current.delete(session.id);
      if (!mounted.current) return;
      if (result?.ok === true) {
        const reason = "reason" in result.body && typeof result.body.reason === "string" ? result.body.reason : null;
        setControl(session.id, { phase: "answered", verb, status: String(result.body.status), reason });
      } else if (result !== undefined && !result.ok && "body" in result && typeof result.body.status === "string") {
        // A 409 `not_running` names the session's current status: the row shows it.
        setControl(session.id, { phase: "answered", verb, status: result.body.status, reason: null, notice: refusalText(result, verb) });
      } else {
        setControl(session.id, { phase: "refused", verb, notice: refusalText(result, verb) });
      }
      // The feed's `session_*` events refetch these too; asking now shows the kernel's list sooner.
      store.refetch("sessions");
      store.refetch("status");
    },
    [api, store, setControl],
  );

  // A confirm lives only while its target does: rendered, counted open and confirmable only while
  // `confirmTarget` still finds it. Otherwise it is cleared, so it never comes back when the list
  // repopulates, and the close runs the focus recovery below (the layout it was in may be gone too).
  const dialogApplies = confirmTarget(dialog, ordered, statusBody, controls) !== undefined;
  const dialogOpen = dialog !== null && dialogApplies;
  useEffect(() => {
    if (dialog !== null && !dialogApplies) setDialog(null);
  }, [dialog, dialogApplies]);

  // ---- focus: never lost to <body> --------------------------------------------------------
  // A focused control can leave the DOM under the owner: Abandon once the kernel answers, a row that moves to
  // another group or leaves the list, the log on a session switch, the detail on the gone note, a whole layout
  // on populated <-> empty / error. Its ref says so as it detaches (before removal, so it still holds focus),
  // and this view's layout effect, after the commit, hands focus to what took its place. Only a removal that
  // took focus with it moves focus: focus the owner put anywhere else is never touched.
  const rootRef = useRef<HTMLDivElement>(null);
  const focusLost = useRef<FocusLoss | null>(null);
  const watchFor = useCallback(
    (loss: FocusLoss): FocusWatch =>
      (node) => {
        if (node === null) return undefined;
        return () => {
          if (node.contains(document.activeElement)) focusLost.current ??= loss;
        };
      },
    [],
  );
  const watchRegion = useMemo(() => watchFor("region"), [watchFor]);
  const watchRow = useMemo(() => watchFor("row"), [watchFor]);
  /** Focus the region in the lost element's place (or the selected row, for a row), only if focus is on <body>. */
  const recoverFocus = useCallback((loss: FocusLoss): void => {
    const focused = document.activeElement;
    const root = rootRef.current;
    if ((focused !== null && focused !== document.body) || root === null) return;
    const region = root.querySelector<HTMLElement>("[data-focus-region]");
    const row = root.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    (loss === "row" ? (row ?? region) : (region ?? row))?.focus();
  }, []);
  useLayoutEffect(() => {
    const loss = focusLost.current;
    if (loss === null) return;
    focusLost.current = null;
    recoverFocus(loss);
  });
  // The confirm hands focus back to its opener in its own cleanup; an opener removed while it was open
  // (Abandon after the session left the list) leaves focus on <body>. Passive: runs after that cleanup.
  const dialogWasOpen = useRef(false);
  useEffect(() => {
    const was = dialogWasOpen.current;
    dialogWasOpen.current = dialogOpen;
    if (was && !dialogOpen) recoverFocus("region");
  }, [dialogOpen, recoverFocus]);

  const latest = useRef({ selected, ordered, dialogOpen, statusBody, controls });
  useLayoutEffect(() => {
    latest.current = { selected, ordered, dialogOpen, statusBody, controls };
  });

  const canStop = useCallback((): boolean => {
    const { selected: current, dialogOpen: open, controls: known } = latest.current;
    return current !== undefined && runsNow(current, known.get(current.id)) && !inFlight.current.has(current.id) && !open;
  }, []);

  const onStop = useCallback((): void => {
    const { selected: current, controls: known } = latest.current;
    if (current === undefined || !runsNow(current, known.get(current.id))) return;
    // One stop per session: a second ⌘., click or command while it is pending sends nothing.
    if (inFlight.current.has(current.id)) return;
    void control(current, "stop");
  }, [control]);

  const requestKill = useCallback((): void => {
    const { selected: current, dialogOpen: open, controls: known } = latest.current;
    if (current === undefined || open || !runsNow(current, known.get(current.id)) || inFlight.current.has(current.id)) return;
    setDialog({ verb: "kill", session: current });
  }, []);

  const requestAbandon = useCallback((): void => {
    const { selected: current, dialogOpen: open, statusBody: body, controls: known } = latest.current;
    if (current === undefined || open || inFlight.current.has(current.id) || !canAbandon(current, body, known.get(current.id))) return;
    setDialog({ verb: "abandon", session: current });
  }, []);

  const confirmDialog = useCallback((): void => {
    if (dialog === null) return;
    setDialog(null);
    // Re-checked against the newest list at the moment of the click: never sends for a target the kernel
    // no longer lists, or whose action no longer applies.
    const { ordered: rows, statusBody: body, controls: known } = latest.current;
    const target = confirmTarget(dialog, rows, body, known);
    if (target === undefined || inFlight.current.has(target.id)) return;
    void control(target, dialog.verb);
  }, [dialog, control]);

  // ---- commands and keys ------------------------------------------------------------------

  const actions = useRef({ onStop, requestKill, requestAbandon, canStop, canAbandon });
  useLayoutEffect(() => {
    actions.current = { onStop, requestKill, requestAbandon, canStop, canAbandon };
  });

  useEffect(
    () =>
      registry.register("sessions", [
        {
          id: SESSION_COMMANDS.stop,
          title: "Stop the selected session",
          group: "Sessions",
          shortcut: "⌘.",
          keywords: ["stop", "session", "graceful"],
          enabled: () => actions.current.canStop(),
          run: () => actions.current.onStop(),
        },
        {
          id: SESSION_COMMANDS.kill,
          title: "Kill the selected session",
          group: "Sessions",
          keywords: ["kill", "session", "abort"],
          enabled: () => actions.current.canStop(),
          run: () => actions.current.requestKill(),
        },
        {
          id: SESSION_COMMANDS.abandon,
          title: "Abandon the selected orphaned session",
          group: "Sessions",
          keywords: ["abandon", "orphan", "release", "session"],
          enabled: () => {
            const { selected: current, dialogOpen: open, statusBody: body, controls: known } = latest.current;
            return !open && current !== undefined && !inFlight.current.has(current.id) && actions.current.canAbandon(current, body, known.get(current.id));
          },
          run: () => actions.current.requestAbandon(),
        },
      ]),
    [registry],
  );

  const moveSelection = useCallback((delta: 1 | -1): boolean => {
    const { selected: current, ordered: rows } = latest.current;
    if (rows.length === 0) return false;
    const at = current === undefined ? -1 : rows.findIndex((s) => s.id === current.id);
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + delta))];
    if (next !== undefined) setSelectedId(next.id);
    return true;
  }, []);

  // The keys, for while no global keyboard map claims them. The map listens on
  // `window` in the capture phase and prevents the default of every key it runs,
  // and StreamingLog prevents its own ⌘., so this bubble-phase listener never
  // runs a key twice: it acts only on a key nothing else handled.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      if (isComposingKey(event) || isEditableTarget(event.target)) return;
      // Nothing runs behind an open dialog (this screen's confirm, the kill switch: both `aria-modal`) or the ⌘K palette.
      if (document.querySelector('[aria-modal="true"], [data-testid="command-palette"]') !== null) return;
      if (event.key === "." && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        if (latest.current.selected === undefined) return;
        event.preventDefault();
        if (event.repeat) return;
        actions.current.onStop();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === "j" || event.key === "k") {
        if (moveSelection(event.key === "j" ? 1 : -1)) event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSelection]);

  // ---- render ---------------------------------------------------------------------------------

  let state: "loading" | "error" | "empty" | "populated";
  if (list === undefined) state = sessions?.error === undefined ? "loading" : "error";
  else state = ordered.length === 0 ? "empty" : "populated";
  const stale = staleError(list, sessions?.error);
  const runningCount = ordered.filter((s) => isLive(s.status)).length;

  const bar = (
    <div className="sessions-bar">
      <span className="sessions-count" data-testid="sessions-count">
        {state === "populated" ? `${runningCount} running` : "sessions"}
      </span>
    </div>
  );

  const staleNote =
    stale === undefined ? null : (
      <p className="sessions-stale" role="status" data-testid="sessions-stale">
        This list is from the last read that answered; the latest one failed. {errorText(stale)}
      </p>
    );

  // Never rendered without a target (`dialogOpen`), so the single-column empty / error layout, where no
  // session is listed, never has one to render.
  const confirm =
    dialog === null || !dialogOpen ? null : dialog.verb === "kill" ? (
      <Dialog
        kind="confirm"
        title={`Kill session #${dialog.session.id}?`}
        description={
          <>
            Kills {agentText(dialog.session)}'s session ({taskText(dialog.session)}) at once: its process group and every tool it started, with no grace.
            The current step is lost. Stop is gentler: it lets the session end its turn first.
          </>
        }
        action={{ label: "Kill", onAction: confirmDialog }}
        onCancel={() => setDialog(null)}
      />
    ) : (
      <Dialog
        kind="confirm"
        title={`Abandon session #${dialog.session.id}?`}
        description={
          <>
            The kernel releases this orphaned session for good: it never resumes it, re-examines it or signals its process group again, because it can't tell
            that group from someone else's. Nothing is killed.
          </>
        }
        action={{ label: "Abandon", onAction: confirmDialog }}
        onCancel={() => setDialog(null)}
      />
    );

  if (state === "error" || state === "empty") {
    return (
      <div className="sessions sessions-single" data-testid="screen-sessions" data-state={state} ref={rootRef}>
        {bar}
        {staleNote}
        <div className="sessions-column">
          {state === "error" ? (
            <div className="sessions-empty" role="alert" data-testid="sessions-error" data-focus-region="" tabIndex={-1} ref={watchRegion}>
              <h2 className="sessions-empty-title">Couldn't load sessions.</h2>
              <p className="sessions-empty-note">{sessions?.error === undefined ? "" : errorText(sessions.error)}</p>
              <p className="sessions-empty-note">This screen reloads on its own once the kernel answers.</p>
            </div>
          ) : (
            <div className="sessions-empty" data-testid="sessions-empty" data-focus-region="" tabIndex={-1} ref={watchRegion}>
              <h2 className="sessions-empty-title">{EMPTY_TITLE}</h2>
              <p className="sessions-empty-note">
                Sessions are short-lived by design. When a trigger fires or you ask for something, the kernel starts one here and you can watch it, stop it, or
                kill it.
              </p>
              <Button
                onClick={() => {
                  window.location.hash = "#/chat";
                }}
              >
                Ask Wright for something
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const selectedRow = selected === undefined ? undefined : rowFor(selected);
  const selectedControl = selected === undefined ? undefined : controls.get(selected.id);
  // Until `/approvals` answers, nobody is known to be waiting on you: never say "None" for that.
  const waitingNote =
    approvals?.data !== undefined
      ? undefined
      : approvals?.error === undefined
        ? "Reading approvals…"
        : "Couldn't read approvals, so who is waiting on you isn't known.";

  return (
    <div className="sessions" data-testid="screen-sessions" data-state={state} ref={rootRef}>
      {bar}
      {staleNote}
      <div className="sessions-split">
        <div className="sessions-list-pane">
          {state === "loading" ? (
            <List label="Sessions" items={[]} loading />
          ) : (
            <SessionList
              groups={groups}
              rowFor={rowFor}
              selectedId={selected?.id ?? null}
              waitingNote={waitingNote}
              watchRow={watchRow}
              onSelect={setSelectedId}
              onMove={moveSelection}
            />
          )}
        </div>
        <div className="sessions-detail-pane">
          {state === "loading" ? (
            <div className="sessions-detail" aria-hidden="true" />
          ) : goneId !== null ? (
            <section
              className="sessions-detail"
              data-testid="session-gone"
              data-session-id={goneId}
              role="status"
              data-focus-region=""
              tabIndex={-1}
              ref={watchRegion}
            >
              <p className="sessions-note">
                Session #{goneId} is no longer in the kernel's list. Pick a session (J / K or a click); nothing here acts until you do.
              </p>
            </section>
          ) : selectedRow === undefined ? (
            <div className="sessions-detail" aria-hidden="true" />
          ) : (
            <SessionDetail
              row={selectedRow}
              control={selectedControl}
              output={output}
              lines={lines}
              abandonable={canAbandon(selectedRow.session, statusBody, selectedControl)}
              abandonDisabled={dialogOpen || selectedControl?.phase === "pending"}
              watch={watchRegion}
              onStop={onStop}
              onKillRequest={requestKill}
              onAbandon={requestAbandon}
              onReadAgain={() => readerFor(selectedRow.session.id).read()}
            />
          )}
        </div>
      </div>
      {confirm}
    </div>
  );
}

// ---- the list --------------------------------------------------------------------------------

interface SessionListProps {
  readonly groups: ReturnType<typeof groupSessions>;
  readonly rowFor: (session: SessionSummary) => Row;
  readonly selectedId: number | null;
  /** Said in the "Waiting on you" group instead of "None" while `/approvals` has not answered. */
  readonly waitingNote: string | undefined;
  readonly watchRow: FocusWatch;
  readonly onSelect: (id: number) => void;
  readonly onMove: (delta: 1 | -1) => boolean;
}

/**
 * One `listbox` over the three groups, so J / K and the arrows walk every row in display order. A roving
 * tabindex: Tab reaches the selected row; focus follows a selection that moves while it is inside.
 */
function SessionList({ groups, rowFor, selectedId, waitingNote, watchRow, onSelect, onMove }: SessionListProps) {
  const idBase = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  /** Stable for the list's life: a row's ref callback must keep its identity (see `FocusWatch`). */
  const onRowRef = useCallback((id: number, node: HTMLDivElement | null): void => {
    if (node === null) rowRefs.current.delete(id);
    else rowRefs.current.set(id, node);
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null || selectedId === null || !list.contains(document.activeElement)) return;
    const row = rowRefs.current.get(selectedId);
    if (row !== undefined && document.activeElement !== row) row.focus();
  }, [selectedId]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const delta = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    onMove(delta);
  };

  return (
    <div className="sessions-list" role="listbox" aria-label="Sessions" ref={listRef} onKeyDown={onKeyDown} data-testid="sessions-list">
      {groups.map((group) => {
        const labelId = `${idBase}-${group.id}`;
        return (
          <div key={group.id} role="group" aria-labelledby={labelId} className="sessions-group" data-group={group.id}>
            <div className="sessions-group-label" id={labelId} role="presentation">
              {group.label}
            </div>
            {group.sessions.length === 0 ? (
              <div className="sessions-none" role="presentation" data-testid={`sessions-none-${group.id}`}>
                {group.id === "waiting" && waitingNote !== undefined ? waitingNote : "None"}
              </div>
            ) : (
              group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  row={rowFor(session)}
                  selected={session.id === selectedId}
                  onRowRef={onRowRef}
                  watchRow={watchRow}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

interface SessionRowProps {
  readonly row: Row;
  readonly selected: boolean;
  readonly onRowRef: (id: number, node: HTMLDivElement | null) => void;
  readonly watchRow: FocusWatch;
  readonly onSelect: (id: number) => void;
}

function SessionRow({ row, selected, onRowRef, watchRow, onSelect }: SessionRowProps) {
  const { session, status } = row;
  const id = session.id;
  // Keyed by session id, so `id` never changes for this row: the ref keeps its identity across renders.
  const rowRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) return undefined;
      onRowRef(id, node);
      const unwatch = watchRow(node);
      return () => {
        unwatch?.();
        onRowRef(id, null);
      };
    },
    [id, onRowRef, watchRow],
  );
  return (
    <div
      ref={rowRef}
      className="sessions-row"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-key={session.id}
      data-testid={`session-row-${session.id}`}
      onClick={() => onSelect(session.id)}
    >
      <span className="sessions-row-avatar">
        <Avatar agent={row.avatar} state={row.avatarState} size={24} />
      </span>
      <span className="sessions-row-text">
        <span className="sessions-row-title">
          <span className="sessions-row-agent" data-testid="session-agent">
            {row.agent}
          </span>
          <span aria-hidden="true"> · </span>
          <span data-testid="session-task">{row.task}</span>
        </span>
        <span className="sessions-row-meta">
          <span className="sessions-row-status" data-testid="session-status" data-danger={status.danger ? "true" : undefined}>
            {status.word}
          </span>
          {status.reason === null || status.danger ? null : <span data-testid="session-reason"> · {status.reason}</span>}
          <span aria-hidden="true"> · </span>
          <span data-testid="session-elapsed">{row.elapsed}</span>
          <span aria-hidden="true"> · </span>
          <span data-testid="session-tokens">{row.tokens}</span>
        </span>
        {status.danger || row.killUnconfirmed || row.orphanReason !== undefined || row.waitingOn !== undefined ? (
          <span className="sessions-row-badges">
            {status.danger ? (
              <span data-testid="session-danger">
                <Badge tone="danger">{status.reason ?? status.word}</Badge>
              </span>
            ) : null}
            {row.killUnconfirmed ? (
              <span data-testid="session-kill-unconfirmed">
                <Badge tone="danger">kill unconfirmed</Badge>
              </span>
            ) : null}
            {row.orphanReason === undefined ? null : (
              <span data-testid="session-orphan-reason">
                <Badge tone="attention">{row.orphanReason === null ? "orphaned · reason unknown" : printable(row.orphanReason)}</Badge>
              </span>
            )}
            {row.waitingOn === undefined ? null : (
              <span data-testid="session-waiting-badge">
                <Badge tone="attention">approval #{row.waitingOn}</Badge>
              </span>
            )}
          </span>
        ) : null}
      </span>
      <span className="sessions-row-aside">{session.model === null ? "" : printable(session.model)}</span>
    </div>
  );
}

// ---- the detail --------------------------------------------------------------------------------

interface SessionDetailProps {
  readonly row: Row;
  readonly control: ControlState | undefined;
  readonly output: OutputSnapshot;
  readonly lines: ReturnType<typeof rowToLine>[];
  readonly abandonable: boolean;
  readonly abandonDisabled: boolean;
  /** Reports a control (or the log) leaving the DOM with focus, so the view can hand focus to this detail. */
  readonly watch: FocusWatch;
  readonly onStop: () => void;
  readonly onKillRequest: () => void;
  readonly onAbandon: () => void;
  /** Reads the selected session's output again, after the last seq (the reader's own in-flight guard holds). */
  readonly onReadAgain: () => void;
}

function SessionDetail({ row, control, output, lines, abandonable, abandonDisabled, watch, onStop, onKillRequest, onAbandon, onReadAgain }: SessionDetailProps) {
  const { session, status } = row;
  const notice = control === undefined || control.phase === "pending" ? undefined : control.notice;
  const header = statusLine(status);
  const live = runsNow(session, control);
  return (
    <section
      className="sessions-detail"
      data-testid="session-detail"
      data-session-id={session.id}
      aria-label={`Session #${session.id}`}
      data-focus-region=""
      tabIndex={-1}
      ref={watch}
    >
      <div className="sessions-detail-meta">
        <span className="sessions-label">cwd</span>
        <code className="sessions-mono" data-testid="session-cwd">
          {session.cwd === null ? "cwd unknown" : printable(session.cwd)}
        </code>
        <span aria-hidden="true">·</span>
        <span data-testid="session-model">{session.model === null ? "model unknown" : printable(session.model)}</span>
        <span aria-hidden="true">·</span>
        <span>#{session.id}</span>
        {abandonable ? (
          <>
            <span className="sessions-spacer" />
            {/* `aria-disabled`, never native `disabled`: the confirm hands focus back here, and a disabled
                button can't take it. `requestAbandon` refuses while a request or the confirm is open. */}
            <Button
              variant="danger"
              size="row"
              className="sessions-abandon"
              aria-disabled={abandonDisabled ? true : undefined}
              onClick={onAbandon}
              ref={watch}
            >
              Abandon
            </Button>
          </>
        ) : null}
      </div>
      {row.waitingOn === undefined || !isLive(session.status) ? null : (
        <p className="sessions-waiting" data-testid="session-waiting" ref={watch}>
          <Badge tone="attention">waiting on you</Badge>
          <span>Approval #{row.waitingOn} is pending: the session asked for it and the kernel holds that call until you decide.</span>
          <Button
            size="row"
            variant="secondary"
            kbd="⌘3"
            onClick={() => {
              window.location.hash = "#/approvals";
            }}
          >
            Review approval
          </Button>
        </p>
      )}
      {notice === undefined ? null : (
        <p className="sessions-notice" role="status" data-testid="session-notice">
          {notice}
        </p>
      )}
      {output.error === undefined ? null : (
        <p className="sessions-note sessions-output-error" role="status" data-testid="session-output-error" ref={watch}>
          <span>
            {output.error}{" "}
            {live ? "It is read again when more output is announced." : "This session has ended, so nothing announces more output: it is read again only when you ask."}
          </span>
          <Button size="row" variant="secondary" loading={output.reading} onClick={onReadAgain}>
            Read again
          </Button>
        </p>
      )}
      {!output.loaded && output.error === undefined ? (
        <p className="sessions-note" data-testid="session-output-reading">
          Reading this session's output…
        </p>
      ) : null}
      {/* Keyed by session: StreamingLog's follow state is one session's. `data-output="unread"` hides its
          "No output" until a read has answered (sessions.css), so loading and a failed read never look empty;
          `data-tokens="unknown"` hides its token figure, which takes a number, so an unknown count never says 0. */}
      <div
        key={session.id}
        className="sessions-log"
        data-testid="session-log"
        data-status={header}
        data-output={output.loaded ? "read" : "unread"}
        data-tokens={session.tokens === null ? "unknown" : undefined}
        ref={watch}
      >
        <StreamingLog
          status={
            <span data-testid="session-log-status">
              <Badge tone={status.danger ? "danger" : row.pending ? "attention" : live ? "accent" : "neutral"}>{header}</Badge>
            </span>
          }
          statusLabel={header}
          agent={row.agent}
          task={row.task}
          elapsed={row.elapsed}
          tokens={session.tokens ?? 0}
          lines={lines}
          live={live}
          onStop={onStop}
          onKillRequest={onKillRequest}
        />
      </div>
    </section>
  );
}
