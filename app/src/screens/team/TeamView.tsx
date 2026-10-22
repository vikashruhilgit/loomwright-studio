// Team's view (phase 5 item 14): the roster as agent cards (Wright first, the whale),
// a 320px inspector (`--inspector-width`) that shows and edits one agent
// through the owner's routes, the New crew member charter form, and ⌘K
// commands for every Team action.
//
// Data comes only from the live store (`useResource`: REST plus the one event
// feed) and, per crew member, `GET /agents/:id` (not a store resource: fetched
// here, and again when an `agent_*` event arrives). Wright has no detail route
// (`GET /agents/wright` answers `409 reserved`), so it is never requested.
// Every write goes through `./actions.ts`; its result reaches the cards through
// the feed, never a local edit of the roster.
//
// Contract gaps (no kernel or contract change here; Subtask 2 records them in
// the evidence README): `RosterEntry` has no role or current task, so a crew
// member's role is its charter persona from `GET /agents/:id` and the task is
// its running brain message; no route reports Wright's effort or delegation
// depth; and `AgentCard` needs a numeric limit and has no sessions or status
// slot, so the card is composed here from `CardGrid` and the `card-*` classes.
import { type KeyboardEvent, type Ref, useCallback, useEffect, useId, useRef, useState } from "react";
import type { RosterEntry, StudioBridge, WrightSetField } from "../../api/contract";
import { commandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { Avatar } from "../../components/Avatar/Avatar";
import type { AvatarState } from "../../components/Avatar/Avatar";
import { Button } from "../../components/Button/Button";
import { BUDGET_ATTENTION_PERCENT, CardGrid, budgetPercent, formatTokens } from "../../components/Card/Card";
import { Dialog } from "../../components/Dialog/Dialog";
import { TextField } from "../../components/Input/Input";
import { StatusDot } from "../../components/StatusDot/StatusDot";
import type { StatusState } from "../../components/StatusDot/StatusDot";
import { useLiveStore, useResource } from "../../store/react";
import type { ResourceError } from "../../store/store";
import { REFETCH_THROTTLE_MS } from "../../store/store";
import { fetchAgentDetail, renameAgent, turnAgent } from "./actions";
import { useTeamCommands } from "./commands";
import { type DetailState, Inspector, type WrightSetValues } from "./Inspector";
import { type TaskLine, agentSessionsText, crewIds, isWright, orderRoster, roleOf, rosterModel, taskLineFor, threadHash, tokensLimitWords } from "./model";
import { NewCrewMember } from "./NewCrewMember";
import "./team.css";

// ---- Details -----------------------------------------------------------------------------

/** The id of the newest roster event in the feed (`agent_*`, not `agent_message_*`), 0 when none. */
function useRosterEventId(api: StudioBridge): number {
  const { eventLog } = useLiveStore(api);
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const e = eventLog[i];
    if (e !== undefined && e.kind.startsWith("agent_") && !e.kind.startsWith("agent_message_")) return e.id;
  }
  return 0;
}

/**
 * Each crew member's `GET /agents/:id`, fetched when the crew changes and
 * again when a roster event arrives: trailing, `REFETCH_THROTTLE_MS` after the
 * last such event, so the feed's replay burst on subscribe is one round. An answer older than the
 * latest request for that id is dropped. Wright is never in `ids`.
 */
function useAgentDetails(api: StudioBridge, ids: readonly string[], eventId: number): ReadonlyMap<string, DetailState> {
  const [details, setDetails] = useState<ReadonlyMap<string, DetailState>>(() => new Map());
  const generation = useRef(new Map<string, number>());
  const idsKey = ids.join("\n");
  const latestIds = useRef(ids);
  latestIds.current = ids;

  const fetchAll = useCallback(
    (list: readonly string[]) => {
      for (const id of list) {
        const mine = (generation.current.get(id) ?? 0) + 1;
        generation.current.set(id, mine);
        void fetchAgentDetail(api, id).then((outcome) => {
          if (generation.current.get(id) !== mine) return;
          setDetails((prev) => new Map(prev).set(id, outcome.ok ? { status: "ok", detail: outcome.body } : { status: "error", message: outcome.message }));
        });
      }
    },
    [api],
  );

  useEffect(() => {
    const list = idsKey === "" ? [] : idsKey.split("\n");
    setDetails((prev) => new Map(list.map((id) => [id, prev.get(id) ?? { status: "loading" }])));
    fetchAll(list);
    return () => {
      // Answers for this round are dropped once the crew changes or the screen unmounts.
      for (const id of list) generation.current.set(id, (generation.current.get(id) ?? 0) + 1);
    };
  }, [idsKey, fetchAll]);

  useEffect(() => {
    if (eventId === 0) return;
    const timer = window.setTimeout(() => fetchAll(latestIds.current), REFETCH_THROTTLE_MS);
    return () => window.clearTimeout(timer);
  }, [eventId, fetchAll]);

  return details;
}

// ---- The card ----------------------------------------------------------------------------

const DOT_STATE: Readonly<Record<TaskLine["state"], StatusState>> = { waiting: "waiting", working: "working", idle: "idle" };
const AVATAR_STATE: Readonly<Record<TaskLine["state"], AvatarState>> = { waiting: "waiting", working: "working", idle: "idle" };

/** Today's tokens against the daily limit, "no limit" when it is unset, or "limit unknown" when the settings file did not read ok. */
function budgetText(agent: RosterEntry): string {
  if (agent.tokens_per_day === null) return `${formatTokens(agent.tokens_today)} today · ${tokensLimitWords(agent)}`;
  return `${formatTokens(agent.tokens_today)} of ${formatTokens(agent.tokens_per_day)} today`;
}

interface TeamCardProps {
  readonly agent: RosterEntry;
  /** Undefined while a crew member's detail loads. */
  readonly role: string | undefined;
  readonly task: TaskLine;
  readonly selected: boolean;
  readonly onOpen: () => void;
  readonly cardRef: Ref<HTMLDivElement>;
}

/**
 * One agent: avatar, name, role (two-line clamp, full text as the card's
 * tooltip), the task line, then the budget block pinned to the bottom (the
 * meter is the only divider), sessions against sessions at once, and status.
 * The whole card is the one action: Enter, Space or a click opens it.
 */
function TeamCard({ agent, role, task, selected, onOpen, cardRef }: TeamCardProps) {
  const id = useId();
  const limited = agent.tokens_per_day !== null;
  const percent = limited ? budgetPercent(agent.tokens_today, agent.tokens_per_day ?? 0) : 0;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };
  return (
    <div
      ref={cardRef}
      className={selected ? "card team-card selected" : "card team-card"}
      data-kind="agent"
      data-agent-id={agent.id}
      data-testid="team-card"
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      aria-labelledby={`${id}-name`}
      aria-describedby={`${id}-role ${id}-task ${id}-budget ${id}-sessions ${id}-status`}
      title={role}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      <div className="card-head">
        <span className="card-avatar">
          <Avatar
            agent={{ id: agent.id, name: agent.display_name, shape: agent.avatar.shape, hue: agent.avatar.hue }}
            state={agent.status === "off" ? "idle" : AVATAR_STATE[task.state]}
            size={36}
          />
        </span>
        <div className="card-heading">
          <div className="card-name" id={`${id}-name`}>
            {agent.display_name}
          </div>
          <div className="card-role" id={`${id}-role`} data-testid="team-card-role">
            {role ?? ""}
          </div>
        </div>
      </div>
      <div className="card-task-line">
        <span className="card-task-dot">
          <StatusDot state={DOT_STATE[task.state]} hideLabel />
        </span>
        <span className="card-task" id={`${id}-task`} data-idle={task.state === "idle" ? "true" : undefined} title={task.text} data-testid="team-card-task">
          {task.text}
        </span>
      </div>
      <div className="card-budget">
        <span className="card-meter" data-level={percent >= BUDGET_ATTENTION_PERCENT ? "high" : "normal"} aria-hidden="true">
          <span className="card-meter-fill" style={{ width: `${percent}%` }} />
        </span>
        <div className="card-meta">
          <span className="card-meta-label" id={`${id}-budget`} data-testid="team-card-budget">
            {budgetText(agent)}
          </span>
          <span className="card-meta-model">{agent.model ?? `model ${rosterModel(agent)}`}</span>
        </div>
        <div className="card-meta">
          <span className="card-meta-label" id={`${id}-sessions`} data-testid="team-card-sessions">
            {agentSessionsText(agent)}
          </span>
          <span className="team-card-status" id={`${id}-status`} data-status={agent.status} data-testid="team-card-status">
            {agent.status}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- Rename --------------------------------------------------------------------------------

function RenameDialog({ api, agent, onClose }: { readonly api: StudioBridge; readonly agent: RosterEntry; readonly onClose: () => void }) {
  const [name, setName] = useState(agent.display_name);
  const [error, setError] = useState<string | undefined>(undefined);
  const busy = useRef(false);
  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setError(undefined);
    try {
      const outcome = await renameAgent(api, agent.id, name);
      if (outcome.ok) onClose();
      else setError(outcome.message);
    } finally {
      busy.current = false;
    }
  };
  return (
    <Dialog
      kind="decision"
      title={`Rename ${agent.display_name}`}
      description="The new name is used in chat, the menu bar and the handoff notes. Memory files keep their folder."
      action={{ label: "Rename", onAction: () => void submit(), kbd: "⏎", keyshortcuts: "Enter" }}
      onCancel={onClose}
    >
      <TextField
        label="Name"
        value={name}
        error={error}
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
    </Dialog>
  );
}

// ---- The screen ------------------------------------------------------------------------------

function errorText(error: ResourceError): string {
  if (error.kind === "refused") return typeof error.body.message === "string" ? `${error.body.error}: ${error.body.message}` : error.body.error;
  if (error.kind === "not_connected") return error.connection.state === "not_installed" ? "The kernel isn't installed." : `Couldn't reach the kernel (${error.connection.reason}).`;
  return "The request did not reach the kernel.";
}

export interface TeamViewProps {
  readonly api: StudioBridge;
  /** Defaults to the app's one registry. */
  readonly registry?: CommandRegistry;
}

type Notice = { readonly kind: "ok" | "error"; readonly text: string } | undefined;

export function TeamView({ api, registry = commandRegistry }: TeamViewProps) {
  const agents = useResource("agents", api);
  const approvals = useResource("approvals", api);
  const messages = useResource("messages", api);
  const roster = orderRoster(agents?.data?.agents ?? []);
  const crew = crewIds(roster);
  const details = useAgentDetails(api, crew, useRosterEventId(api));

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [focusSet, setFocusSet] = useState(0);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<RosterEntry | undefined>(undefined);
  const [wrightSet, setWrightSet] = useState<WrightSetValues>({});
  const [notice, setNotice] = useState<Notice>(undefined);

  const newButton = useRef<HTMLButtonElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  /** Where focus goes after the next commit (a closed inspector's card, the New crew member button). */
  const pendingFocus = useRef<(() => HTMLElement | null | undefined) | undefined>(undefined);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === undefined) return;
    pendingFocus.current = undefined;
    target()?.focus();
  });

  const selected = selectedId === undefined ? undefined : roster.find((a) => a.id === selectedId);

  const open = (agent: RosterEntry) => {
    setCreating(false);
    setFocusSet(0);
    setSelectedId(agent.id);
  };
  const closeInspector = () => {
    const id = selectedId;
    setSelectedId(undefined);
    if (id !== undefined) pendingFocus.current = () => cards.current.get(id);
  };
  const newCrewMember = () => {
    setSelectedId(undefined);
    setNotice(undefined);
    setCreating(true);
  };
  const cancelNew = () => {
    setCreating(false);
    pendingFocus.current = () => newButton.current;
  };
  const created = (name: string) => {
    setCreating(false);
    setNotice({ kind: "ok", text: `${name || "The crew member"} was created. Its card appears as soon as the kernel's feed reports it.` });
    pendingFocus.current = () => newButton.current;
  };
  const turn = async (agent: RosterEntry, to: "on" | "off") => {
    const outcome = await turnAgent(api, agent.id, to);
    setNotice(outcome.ok ? { kind: "ok", text: `${agent.display_name}: ${outcome.body.changed ? `turned ${to}` : `already ${to}`}.` } : { kind: "error", text: `${agent.display_name}: ${outcome.message}` });
  };

  useTeamCommands(registry, roster, {
    newCrewMember,
    rename: (agent) => {
      open(agent);
      setRenaming(agent);
    },
    setField: (agent) => {
      setCreating(false);
      setSelectedId(agent.id);
      setFocusSet((n) => n + 1);
    },
    turn,
    openThread: (agent) => {
      window.location.hash = threadHash(agent.id);
    },
  });

  const loading = agents === undefined || (agents.data === undefined && agents.error === undefined);
  const failed = agents?.data === undefined && agents?.error !== undefined ? agents.error : undefined;
  const approvalList = approvals?.data?.approvals ?? [];
  const messageList = messages?.data?.messages ?? [];
  const inspectorOpen = selected !== undefined && !creating;

  let body;
  if (creating) {
    body = <NewCrewMember api={api} onCancel={cancelNew} onCreated={created} />;
  } else if (failed !== undefined) {
    body = (
      <div className="team-state" role="alert" data-testid="team-error">
        <p className="team-state-title">Couldn't load the team</p>
        <p className="team-state-note">{errorText(failed)}</p>
      </div>
    );
  } else if (loading) {
    body = (
      <>
        <p className="team-sr-only" role="status">
          Loading the team…
        </p>
        <div className="card-grid" aria-hidden="true" data-testid="team-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card team-skeleton">
              <span className="team-skel team-skel-avatar" />
              <span className="team-skel team-skel-line" />
              <span className="team-skel team-skel-line team-skel-short" />
            </div>
          ))}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <CardGrid label="Agents">
          {roster.map((agent) => {
            const detail = details.get(agent.id);
            const role = roleOf(agent, detail?.status === "ok" ? detail.detail : undefined) ?? (detail?.status === "error" ? "Role unavailable" : undefined);
            return (
              <TeamCard
                key={agent.id}
                agent={agent}
                role={role}
                task={taskLineFor(agent.id, approvalList, messageList)}
                selected={agent.id === selectedId}
                onOpen={() => open(agent)}
                cardRef={(el) => {
                  if (el === null) cards.current.delete(agent.id);
                  else cards.current.set(agent.id, el);
                }}
              />
            );
          })}
        </CardGrid>
        {crew.length === 0 ? (
          <p className="team-empty" data-testid="team-empty">
            No crew members yet. Create one from a charter, or ask Wright to propose one from a duty.
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className={inspectorOpen ? "team with-inspector" : "team"} data-testid="screen-team">
      <div className="team-main">
        <div className="team-toolbar">
          <span className="team-count">{loading || failed !== undefined ? "" : `${roster.length} ${roster.length === 1 ? "agent" : "agents"}`}</span>
          <Button ref={newButton} size="row" variant="secondary" onClick={newCrewMember} disabled={creating}>
            New crew member
          </Button>
        </div>
        {notice === undefined ? null : (
          <p className={notice.kind === "error" ? "team-notice team-notice-error" : "team-notice"} role={notice.kind === "error" ? "alert" : "status"} data-testid="team-notice">
            {notice.text}
          </p>
        )}
        {body}
      </div>
      {inspectorOpen ? (
        <Inspector
          key={`${selected.id}:${focusSet}`}
          api={api}
          agent={selected}
          detail={isWright(selected) ? undefined : details.get(selected.id)}
          wrightSet={wrightSet}
          onWrightSet={(field: WrightSetField, value: string) => setWrightSet((w) => ({ ...w, [field]: value }))}
          onRename={() => setRenaming(selected)}
          onClose={closeInspector}
          focusSet={focusSet > 0}
        />
      ) : null}
      {renaming === undefined ? null : <RenameDialog key={renaming.id} api={api} agent={renaming} onClose={() => setRenaming(undefined)} />}
    </div>
  );
}
