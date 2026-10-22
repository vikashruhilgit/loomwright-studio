// Chat: Wright's thread at `#/chat`, a specialist's at `#/chat/<agent-id>`
// (an id not in `GET /agents` falls back to Wright's). The thread is
// `GET /threads/:agent` through the live store, oldest first: message
// bubbles, one-line event cards, the playbook and trigger cards those events
// name, and the agent's pending approvals inline at the end, then the
// composer. Every kernel string is a React text child only.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Approval, RosterEntry, StudioBridge, ThreadItem, ThreadResponse } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import { Button } from "../../components/Button/Button";
import { ChatBubble } from "../../components/ChatBubble/ChatBubble";
import { EventCard } from "../../components/EventCard/EventCard";
import { StatusDot } from "../../components/StatusDot/StatusDot";
import { useResource } from "../../store/react";
import { threadResource } from "../../store/resources";
import { ApprovalCard, CharterCard, PlaybookCard, TriggerCard } from "./cards";
import { ChatComposer } from "./ChatComposer";
import { useHash } from "./CrewSection";
import {
  WRIGHT,
  agentAvatarState,
  chipFor,
  clock,
  eventKindOf,
  eventTarget,
  hashAgent,
  navigate,
  onComposerFocusRequest,
  parseRetryAt,
  readErrorText,
  refId,
  refusalOf,
  resolveBridge,
  when,
  writeSeen,
} from "./model";
import "./chat.css";

export const WRIGHT_EMPTY = "Ask Wright anything. It drafts playbooks and crew for you to approve.";

export interface ChatScreenProps {
  /** Defaults to `window.api`, else an inert bridge. */
  readonly api?: StudioBridge;
}

type MessageItem = Extract<ThreadItem, { readonly type: "message" }>;
type EventItem = Extract<ThreadItem, { readonly type: "event" }>;

function itemKey(item: ThreadItem): string {
  return `${item.type}:${item.id}`;
}

function nameOf(roster: readonly RosterEntry[] | undefined, id: string): string {
  if (id === WRIGHT) return roster?.find((a) => a.id === WRIGHT)?.display_name ?? "Wright";
  return roster?.find((a) => a.id === id)?.display_name ?? id;
}

function AgentAvatar({ agent, roster, size = 24 }: { readonly agent: string; readonly roster: readonly RosterEntry[] | undefined; readonly size?: number }) {
  const entry = roster?.find((a) => a.id === agent);
  return <Avatar agent={{ id: agent, name: nameOf(roster, agent), shape: entry?.avatar.shape, hue: entry?.avatar.hue }} state="idle" size={size} />;
}

/** One message row: the owner's turn (or a quoted delegation), then the agent's reply or the row's state. */
function MessageView({ item, agent, roster }: { readonly item: MessageItem; readonly agent: string; readonly roster: readonly RosterEntry[] | undefined }) {
  const name = nameOf(roster, item.agent);
  let outcome: ReactNode = null;
  if (item.status === "replied") {
    outcome = (
      <ChatBubble
        speaker={name}
        from={item.agent === WRIGHT ? "wright" : "specialist"}
        time={clock(item.updated_at)}
        body={item.reply_text ?? ""}
        avatar={<AgentAvatar agent={item.agent} roster={roster} />}
      />
    );
  } else if (item.status === "queued" || item.status === "running") {
    outcome = (
      <p className="chat-state pending" role="status">
        {name} is working on it
      </p>
    );
  } else if (item.status === "failed") {
    outcome = (
      <p className="chat-state failed">
        Failed: <span className="chat-detail">{item.detail ?? "the kernel gave no reason"}</span>
      </p>
    );
  } else if (item.status === "parked") {
    const retry = parseRetryAt(item.detail);
    outcome = (
      <p className="chat-state parked">
        {retry === null ? (
          "Paused: retry time unknown"
        ) : (
          <>
            Paused: retries at <time dateTime={retry}>{when(retry)}</time>
          </>
        )}
      </p>
    );
  } else {
    outcome = <p className="chat-state">{String(item.status)}</p>;
  }

  return (
    <div className="chat-message" data-message={item.id} data-status={item.status}>
      {item.from_agent === null ? (
        <ChatBubble speaker="You" from="user" time={clock(item.created_at)} body={item.text} />
      ) : (
        <blockquote className="chat-quote" data-from-agent={item.from_agent}>
          <p className="chat-quote-label">
            From {nameOf(roster, item.from_agent)} · {item.source}
            {item.agent === agent ? null : ` · to ${nameOf(roster, item.agent)}`}
          </p>
          <p className="chat-quote-text">{item.text}</p>
        </blockquote>
      )}
      {outcome}
    </div>
  );
}

function EventView({ item }: { readonly item: EventItem }) {
  const kind = eventKindOf(item.kind);
  return (
    <EventCard
      variant="event"
      event={{ kind, subject: item.summary, time: clock(item.at), dateTime: item.at, target: eventTarget(kind) }}
      onOpen={(target) => navigate(target)}
    />
  );
}

/** Merge pages oldest first, each item once. */
function mergeItems(older: readonly ThreadItem[], current: readonly ThreadItem[]): ThreadItem[] {
  const seen = new Set<string>();
  const out: ThreadItem[] = [];
  for (const item of [...older, ...current]) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function Skeleton() {
  return (
    <div className="chat-skeleton" aria-busy="true" aria-label="Loading the thread" data-testid="chat-loading">
      {[60, 80, 45].map((w) => (
        <div key={w} className="chat-skeleton-row">
          <i className="chat-skeleton-dot" />
          <i className="chat-skeleton-line" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

interface AgentThreadProps {
  readonly api: StudioBridge;
  readonly agent: string;
  readonly roster: readonly RosterEntry[] | undefined;
  readonly approvals: readonly Approval[] | undefined;
}

function AgentThread({ api, agent, roster, approvals }: AgentThreadProps) {
  const thread = useResource(threadResource(agent), api);
  const playbooks = useResource("playbooks", api);
  const triggers = useResource("triggers", api);
  const [older, setOlder] = useState<{ readonly items: readonly ThreadItem[]; readonly next: string | null } | null>(null);
  const [pageError, setPageError] = useState("");
  const [paging, setPaging] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);

  const isWright = agent === WRIGHT;
  const name = nameOf(roster, agent);
  const entry = roster?.find((a) => a.id === agent);
  const chip = chipFor(agentAvatarState(entry, approvals));
  const data: ThreadResponse | undefined = thread?.data;
  const items = useMemo(() => mergeItems(older?.items ?? [], data?.items ?? []), [older, data]);
  const cursor = older === null ? (data?.next_before ?? null) : older.next;
  const pending = (data?.pending_approvals ?? []).filter((a) => a.requesting_agent === agent);

  const focusComposer = useCallback(() => inputRef.current?.focus(), []);
  useEffect(() => onComposerFocusRequest(focusComposer), [focusComposer]);

  // The thread is open: its newest message is seen.
  useEffect(() => {
    let newest = 0;
    for (const item of items) if (item.type === "message" && item.id > newest) newest = item.id;
    if (newest > 0) writeSeen(agent, newest);
  }, [agent, items]);

  // Keep the end in view when new items land, only if the owner was already there.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el !== null && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [items.length, pending.length]);

  const loadEarlier = async (): Promise<void> => {
    if (cursor === null || paging) return;
    setPaging(true);
    const el = scrollRef.current;
    const fromBottom = el === null ? 0 : el.scrollHeight - el.scrollTop;
    let result;
    try {
      result = await api.request<ThreadResponse>({ method: "GET", path: "/threads/:agent", params: { agent }, query: { before: cursor } });
    } catch {
      result = undefined;
    }
    setPaging(false);
    if (result?.ok !== true) {
      setPageError(refusalOf(result).text);
      return;
    }
    const page = result.body;
    setPageError("");
    atEnd.current = false;
    setOlder((prev) => ({ items: mergeItems(page.items, prev?.items ?? []), next: page.next_before }));
    // Keep what the owner was reading where it was.
    requestAnimationFrame(() => {
      if (el !== null) el.scrollTop = el.scrollHeight - fromBottom;
    });
  };

  // Cards: each playbook once, after its newest created/updated event; each fired trigger once, after its newest firing.
  const playbookList = playbooks?.data?.playbooks;
  const triggerList = triggers?.data?.triggers;
  const playbookAt = new Map<number, number>();
  const triggerAt = new Map<number, number>();
  items.forEach((item, index) => {
    if (item.type !== "event") return;
    if (item.kind === "playbook_created" || item.kind === "playbook_updated") {
      const id = refId(item.ref, "playbook_id");
      if (id !== undefined) playbookAt.set(id, index);
    } else if (item.kind === "trigger_fired") {
      const id = refId(item.ref, "trigger_id");
      if (id !== undefined) triggerAt.set(id, index);
    }
  });
  const shownInPlaybook = new Set<number>();
  for (const id of playbookAt.keys()) {
    const tid = playbookList?.find((p) => p.id === id)?.trigger_id;
    if (tid !== null && tid !== undefined) shownInPlaybook.add(tid);
  }
  const cardsAfter = (index: number): ReactNode[] => {
    const out: ReactNode[] = [];
    for (const [id, at] of playbookAt) {
      if (at !== index) continue;
      const playbook = playbookList?.find((p) => p.id === id);
      const trigger = playbook?.trigger_id === null || playbook === undefined ? undefined : triggerList?.find((t) => t.id === playbook.trigger_id);
      out.push(<PlaybookCard key={`pb:${id}`} api={api} playbookId={id} playbook={playbook} trigger={trigger} agent={agent} />);
    }
    for (const [id, at] of triggerAt) {
      if (at !== index || shownInPlaybook.has(id)) continue;
      const trigger = triggerList?.find((t) => t.id === id);
      if (trigger !== undefined) out.push(<TriggerCard key={`tr:${id}`} api={api} trigger={trigger} agent={agent} />);
    }
    return out;
  };

  let body: ReactNode;
  if (data === undefined && thread?.error !== undefined) {
    body = (
      <div className="chat-empty chat-error" data-testid="chat-error">
        <p className="chat-empty-title">The thread is unavailable.</p>
        <p className="chat-empty-note">{readErrorText(thread.error)}</p>
      </div>
    );
  } else if (data === undefined) {
    body = <Skeleton />;
  } else if (items.length === 0 && pending.length === 0) {
    body = (
      <div className="chat-empty" data-testid="chat-empty">
        <p className="chat-empty-title">{isWright ? WRIGHT_EMPTY : `Nothing yet with ${name}.`}</p>
        {isWright ? null : <p className="chat-empty-note">Message {name} directly to steer one task. Wright delegates to it for you.</p>}
      </div>
    );
  } else {
    body = (
      <ol className="chat-items" aria-label={`Thread with ${name}`}>
        {items.map((item, index) => (
          <Fragment key={itemKey(item)}>
            <li className="chat-item" data-item={itemKey(item)}>
              {item.type === "message" ? <MessageView item={item} agent={agent} roster={roster} /> : <EventView item={item} />}
            </li>
            {cardsAfter(index).map((card, i) => (
              <li key={`card:${index}:${i}`} className="chat-item chat-item-card">
                {card}
              </li>
            ))}
          </Fragment>
        ))}
        {pending.map((approval) => (
          <li key={`approval:${approval.id}`} className="chat-item chat-item-approval" data-testid="chat-pending-approval">
            {approval.action === "kernel_agent_create" ? (
              <CharterCard
                api={api}
                approval={approval}
                agent={agent}
                onEditInEnglish={(prefill) => {
                  setText(prefill);
                  focusComposer();
                }}
              />
            ) : (
              <ApprovalCard api={api} approval={approval} agent={agent} />
            )}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="chat" data-testid="screen-chat" data-agent={agent}>
      <div className="chat-titlerow">
        <span className="chat-with">with {name}</span>
        <StatusDot state={chip.dot} label={chip.word} />
        <span className="chat-spacer" />
        {isWright ? null : (
          <Button variant="ghost" size="row" onClick={() => navigate("#/team")}>
            Open in Team
          </Button>
        )}
      </div>
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
        }}
      >
        {cursor !== null && data !== undefined ? (
          <div className="chat-earlier">
            <Button variant="ghost" size="row" onClick={() => void loadEarlier()} loading={paging}>
              Load earlier
            </Button>
          </div>
        ) : null}
        {pageError === "" ? null : (
          <p className="chat-card-refusal" role="alert">
            {pageError}
          </p>
        )}
        {body}
      </div>
      <ChatComposer api={api} agent={agent} agentName={name} text={text} onTextChange={setText} inputRef={inputRef} />
    </div>
  );
}

/** The Chat screen: resolves the thread's agent from the hash and the roster. */
export function ChatScreen({ api: apiProp }: ChatScreenProps) {
  const api = useMemo(() => resolveBridge(apiProp), [apiProp]);
  const agents = useResource("agents", api);
  const approvals = useResource("approvals", api);
  const hash = useHash();
  const roster = agents?.data?.agents;
  const wanted = hashAgent(hash);
  // Only a roster id opens a specialist's thread; anything else is Wright's.
  const agent = wanted !== undefined && wanted !== WRIGHT && (roster ?? []).some((a) => a.id === wanted) ? wanted : WRIGHT;
  return <AgentThread key={agent} api={api} agent={agent} roster={roster} approvals={approvals?.data?.approvals} />;
}

