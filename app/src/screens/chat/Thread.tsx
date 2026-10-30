// Chat: Wright's thread at `#/chat`, a specialist's at `#/chat/<agent-id>`
// (an id not in `GET /agents` falls back to Wright's). The thread is
// `GET /threads/:agent` through the live store, oldest first: message
// bubbles, one-line event cards, the playbook and trigger cards those events
// name, and the agent's pending approvals inline at the end, then the
// composer. `#/chat?playbook=<id>` (an approval's Open playbook link) opens
// Wright's thread scrolled to that playbook's card, or says the card is not in
// what is loaded. Every kernel string is a React text child only.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Approval, DraftOutput, RosterEntry, StudioBridge, ThreadItem, ThreadResponse } from "../../api/contract";
import { Avatar } from "../../components/Avatar/Avatar";
import { Button } from "../../components/Button/Button";
import { ChatBubble } from "../../components/ChatBubble/ChatBubble";
import { EventCard } from "../../components/EventCard/EventCard";
import { StatusDot } from "../../components/StatusDot/StatusDot";
import { isEditableTarget, listMove } from "../../commands/keyboard";
import { useResource } from "../../store/react";
import { threadResource } from "../../store/resources";
import { printable } from "../approvals/printable";
import { sharedNames } from "../team/model";
import { ApprovalCard, CharterCard, PlaybookCard, TriggerCard } from "./cards";
import { ChatComposer } from "./ChatComposer";
import { useHash } from "./CrewSection";
import { takeComposerHandoff } from "./handoff";
import { ConnectorLine, DraftCard, PollQueuedLine, SkipGroupCard, groupThreadRows, useDraftList } from "./integrationCards";
import type { ThreadRow } from "./integrationCards";
import {
  WRIGHT,
  agentAvatarState,
  chipFor,
  clock,
  eventKindOf,
  eventTarget,
  focusLost,
  hashAgent,
  navigate,
  onComposerFocusRequest,
  parseRetryAt,
  playbookFromHash,
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

  // A kernel approval decision is queued with `source` `approval:<id>` (kernel/src/approvals/store.ts): the
  // kernel's words, never the owner's. Decided by `source` alone, never by the text.
  const decision = item.from_agent === null && item.source.startsWith("approval:") ? item.source.slice("approval:".length) : null;
  return (
    <div className="chat-message" data-message={item.id} data-status={item.status}>
      {decision !== null ? (
        <section className="chat-kernel" aria-label={`Kernel decision, approval ${decision}`} data-source={item.source}>
          <p className="chat-kernel-label">
            Kernel · approval {decision} · <time dateTime={item.created_at}>{clock(item.created_at)}</time>
          </p>
          <p className="chat-kernel-text">{item.text}</p>
        </section>
      ) : item.from_agent === null ? (
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

/** The phase 6 kinds as cards; every other kind (and a draft event with no usable id) stays a one-line `EventView`. */
function IntegrationEvent({ api, item, drafts }: { readonly api: StudioBridge; readonly item: EventItem; readonly drafts: ReadonlyMap<number, DraftOutput> | undefined }) {
  if (item.kind === "draft_output_recorded") {
    const draftId = refId(item.ref, "draft_output_id");
    if (draftId !== undefined) return <DraftCard api={api} draftId={draftId} at={item.at} listed={drafts?.get(draftId)} />;
  } else if (item.kind === "poll_item_queued") {
    return <PollQueuedLine api={api} item={item} />;
  } else if (item.kind === "connector_status") {
    return <ConnectorLine item={item} />;
  }
  return <EventView item={item} />;
}

/** The controls J and K move between: the phase 6 cards' toggles, and the phase 5 event lines' subjects. */
const CARD_STOPS = "[data-thread-card], .eventcard-event .eventcard-subject";

/** Merge pages oldest first, each item once; an item in both keeps `current`'s copy (it is the fresher read). */
function mergeItems(older: readonly ThreadItem[], current: readonly ThreadItem[]): ThreadItem[] {
  const seen = new Set<string>(current.map(itemKey));
  const out: ThreadItem[] = [];
  for (const item of older) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  seen.clear();
  for (const item of current) {
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
  // A ref, not state: two clicks in one tick must not both send the same cursor.
  const pagingNow = useRef(false);
  const [text, setText] = useState("");
  // Skip ids of the groups the owner opened. A group is open if any of its skips is here, so it stays open when
  // Load earlier or a live skip extends the run (its first skip, and so its key, can change). Per thread: this
  // component is keyed by agent, so a thread switch starts empty; ids are never reused, so none go stale.
  const [openSkips, setOpenSkips] = useState<ReadonlySet<number>>(() => new Set());
  const toggleSkips = (ids: readonly number[]): void =>
    setOpenSkips((prev) => {
      const next = new Set(prev);
      if (ids.some((id) => prev.has(id))) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);
  /** The last control focused inside the thread, and which part of it held the control. */
  const lastFocus = useRef<{ readonly el: HTMLElement; readonly zone: "approval" | "earlier" | "other" } | null>(null);
  /** The live first page as last read, to catch items that slide off it. */
  const lastLive = useRef<readonly ThreadItem[]>([]);
  /** Items that slid off the live page while a Load earlier was in flight, merged in when it answers. */
  const slid = useRef<readonly ThreadItem[]>([]);
  // `#/chat?playbook=<id>`: the card to scroll to, once per hash value (a refetch never scrolls again).
  const hash = useHash();
  const wantedCard = playbookFromHash(hash);
  /** The `#/chat?playbook=<id>` hash already scrolled to; cleared off the route and by a repeated hashchange. */
  const handledHash = useRef<string | null>(null);
  /** The `#/chat?playbook=<id>` hash whose card could not be shown, already given focus; cleared like `handledHash`. */
  const missingHash = useRef<string | null>(null);
  const missingRef = useRef<HTMLParagraphElement>(null);
  /** How many times a wanted card was scrolled to: a Load earlier's restore stands aside if one ran after it measured. */
  const cardScrolls = useRef(0);
  const [, setHashTick] = useState(0);
  useEffect(() => {
    // The same link followed again dispatches a hashchange with no new hash (`rehashIfCurrent`): scroll again.
    // A browser never fires one with `oldURL === newURL` itself, so a navigation that did change the hash
    // (whose new value the handled-hash check already tells apart) never clears it.
    const onHashChange = (event: HashChangeEvent): void => {
      if (event.oldURL !== event.newURL) return;
      handledHash.current = null;
      missingHash.current = null;
      setHashTick((n) => n + 1);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const isWright = agent === WRIGHT;
  const name = nameOf(roster, agent);
  const entry = roster?.find((a) => a.id === agent);
  const chip = chipFor(agentAvatarState(entry, approvals));
  // Two agents of the same name: the header shows which one this thread is with.
  const idShown = sharedNames(roster ?? []).has(agent);
  const data: ThreadResponse | undefined = thread?.data;
  const items = useMemo(() => mergeItems(older?.items ?? [], data?.items ?? []), [older, data]);
  const cursor = older === null ? (data?.next_before ?? null) : older.next;
  const pending = (data?.pending_approvals ?? []).filter((a) => a.requesting_agent === agent);
  const rows = useMemo(() => groupThreadRows(items), [items]);
  const draftIds = useMemo(() => {
    const ids: number[] = [];
    for (const item of items) {
      const id = item.type === "event" && item.kind === "draft_output_recorded" ? refId(item.ref, "draft_output_id") : undefined;
      if (id !== undefined) ids.push(id);
    }
    return ids;
  }, [items]);
  const drafts = useDraftList(api, agent, draftIds);

  const focusComposer = useCallback(() => inputRef.current?.focus(), []);
  useEffect(() => onComposerFocusRequest(agent, focusComposer), [agent, focusComposer]);
  // A line another screen handed off for this agent (Playbooks' Edit in English) fills the composer once, on
  // mount, and takes focus. Sends nothing. An effect, not a state initializer: StrictMode runs initializers twice,
  // and the second would find the line already taken; the state it sets survives StrictMode's effect re-run.
  useLayoutEffect(() => {
    const handedOff = takeComposerHandoff(agent);
    if (handedOff === undefined) return;
    setText(handedOff);
    focusComposer();
  }, [agent, focusComposer]);

  // The live store refetches only the newest page. Once older pages are loaded, an item that slides
  // off that page (a newer one pushed it out) would be in neither list: keep it with the older ones.
  // Before then the cursor still reaches it, unless a Load earlier is in flight: its page ends at the
  // cursor sent, before the item, and may be the last. So while one is in flight, hold dropped items
  // until it answers.
  useLayoutEffect(() => {
    const previous = lastLive.current;
    const live = data?.items ?? [];
    lastLive.current = live;
    const still = new Set(live.map(itemKey));
    const dropped = previous.filter((item) => !still.has(itemKey(item)));
    if (dropped.length === 0) return;
    if (pagingNow.current) slid.current = mergeItems(slid.current, dropped);
    setOlder((prev) => (prev === null ? prev : { items: mergeItems(prev.items, dropped), next: prev.next }));
  }, [data]);

  // A focused control that unmounted (a decided approval's card, the last Load earlier) leaves focus
  // on <body>: move it to the next thing the owner would act on. Runs after every render of the thread.
  useLayoutEffect(() => {
    const last = lastFocus.current;
    if (last === null || last.el.isConnected || !focusLost()) return;
    lastFocus.current = null;
    if (last.zone === "approval") {
      const next = scrollRef.current?.querySelector<HTMLElement>('[data-testid="chat-pending-approval"] button');
      if (next) {
        next.focus();
        return;
      }
    } else if (last.zone === "earlier" && listRef.current !== null) {
      listRef.current.focus({ preventScroll: true });
      return;
    }
    focusComposer();
  });

  // The thread is open: its newest message is seen.
  useEffect(() => {
    let newest = 0;
    for (const item of items) if (item.type === "message" && item.id > newest) newest = item.id;
    if (newest > 0) writeSeen(agent, newest);
  }, [agent, items]);

  // Keep the end in view when new items land or a row changes (a queued row turning into a taller
  // reply bubble keeps the count), only if the owner was already there.
  const shape = items.map((item) => (item.type === "message" ? `${item.id}:${item.status}` : `e${item.id}`)).join(",");
  const pendingShape = pending.map((a) => a.id).join(",");
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el !== null && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [shape, pendingShape]);

  // Scroll to the wanted playbook's card once it is rendered: after the keep-the-end-in-view effect, which
  // then stands aside (`atEnd` false) until the owner scrolls back to the end. Runs after every render.
  useLayoutEffect(() => {
    if (wantedCard === undefined) {
      // Off the route: coming back to the same `#/chat?playbook=<id>` scrolls again.
      handledHash.current = null;
      missingHash.current = null;
      return;
    }
    if (handledHash.current === hash) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-playbook="${wantedCard}"]`);
    if (card === null || card === undefined) return;
    handledHash.current = hash;
    atEnd.current = false;
    card.scrollIntoView({ block: "center" });
    cardScrolls.current += 1;
    // Start the keyboard in the card, so a Tab reaches Run now, when a link led here: one that unmounted with its
    // screen (focus fell to <body>), or the thread's own inline link, still focused, whose href is this hash. Focus
    // anywhere else is there on purpose and stays, so a refetch that renders the card later never takes it.
    const active = document.activeElement;
    const followed = active instanceof HTMLAnchorElement && active.getAttribute("href") === hash && listRef.current?.contains(active) === true;
    if (focusLost() || followed) card.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  });

  const loadEarlier = async (): Promise<void> => {
    if (cursor === null || pagingNow.current) return;
    pagingNow.current = true;
    slid.current = [];
    setPaging(true);
    const el = scrollRef.current;
    const fromBottom = el === null ? 0 : el.scrollHeight - el.scrollTop;
    // A scroll to the wanted card after this measure (the page brought it, or a refetch did) is the newer intent.
    const scrollsAtMeasure = cardScrolls.current;
    let result;
    try {
      result = await api.request<ThreadResponse>({ method: "GET", path: "/threads/:agent", params: { agent }, query: { before: cursor } });
    } catch {
      result = undefined;
    } finally {
      pagingNow.current = false;
    }
    // Read and cleared in the same tick the guard drops: no refetch's effect runs in between.
    const held = slid.current;
    slid.current = [];
    setPaging(false);
    if (result?.ok !== true) {
      // Nothing was added: the cursor shown is still the live page's, which reaches the held items.
      setPageError(refusalOf(result).text);
      return;
    }
    const page = result.body;
    setPageError("");
    atEnd.current = false;
    // Held items are newer than every older page (they left the live page's oldest end).
    setOlder((prev) => ({ items: mergeItems(mergeItems(page.items, prev?.items ?? []), held), next: page.next_before }));
    // Keep what the owner was reading where it was, unless the view has since moved to the wanted card.
    requestAnimationFrame(() => {
      if (el !== null && cardScrolls.current === scrollsAtMeasure) el.scrollTop = el.scrollHeight - fromBottom;
    });
  };

  // Cards: each playbook once, after its newest created/updated event; each trigger once, after its newest registered or fired event.
  const playbookList = playbooks?.data?.playbooks;
  const playbooksAnswered = playbookList !== undefined || playbooks?.error !== undefined;
  const triggerList = triggers?.data?.triggers;
  const playbookAt = new Map<number, number>();
  const triggerAt = new Map<number, number>();
  items.forEach((item, index) => {
    if (item.type !== "event") return;
    if (item.kind === "playbook_created" || item.kind === "playbook_updated") {
      const id = refId(item.ref, "playbook_id");
      if (id !== undefined) playbookAt.set(id, index);
    } else if (item.kind === "trigger_fired" || item.kind === "trigger_registered") {
      const id = refId(item.ref, "trigger_id");
      if (id !== undefined) triggerAt.set(id, index);
    }
  });
  // The wanted card is not rendered: its event is older than the loaded pages, or the playbook is not this thread's.
  const wantedListed = wantedCard === undefined ? undefined : playbookList?.find((p) => p.id === wantedCard);
  const cardMissing = wantedCard !== undefined && data !== undefined && playbooksAnswered && !(playbookAt.has(wantedCard) && wantedListed !== undefined);
  const wantedName = wantedListed === undefined ? `#${wantedCard ?? ""}` : printable(wantedListed.slug);
  let missingText: string;
  if (playbookList === undefined) missingText = `Playbook ${wantedName}'s card can't be shown: the kernel's playbook list didn't load.`;
  else if (wantedListed === undefined) missingText = `Playbook ${wantedName} isn't in the kernel's playbook list.`;
  else if (cursor === null) missingText = `Playbook ${wantedName}'s card isn't in this thread.`;
  else missingText = `Playbook ${wantedName}'s card isn't in the part of this thread that's loaded. Load earlier to find it.`;
  const loadEarlierNext = playbookList !== undefined && wantedListed !== undefined && cursor !== null;
  const threadFailed = data === undefined && thread?.error !== undefined;
  // No card takes focus (`chat-card-missing` is shown, or the thread did not load): when focus fell to <body> with
  // the link's screen, start the keyboard on the next thing to do (the composer when the thread did not load, Load
  // earlier when the line points at it, else the line itself), once per hash, so a refetch or a Load earlier never takes it.
  useLayoutEffect(() => {
    if (wantedCard === undefined || !(cardMissing || threadFailed) || missingHash.current === hash) return;
    missingHash.current = hash;
    if (!focusLost()) return;
    if (threadFailed) focusComposer();
    else if (loadEarlierNext) scrollRef.current?.querySelector<HTMLElement>(".chat-earlier button")?.focus();
    else missingRef.current?.focus();
  });
  const shownInPlaybook = new Set<number>();
  for (const id of playbookAt.keys()) {
    const tid = playbookList?.find((p) => p.id === id)?.trigger_id;
    if (tid !== null && tid !== undefined) shownInPlaybook.add(tid);
  }
  // Each card is keyed by what it shows (one playbook, one trigger: both maps hold an id once), never
  // by its position: Load earlier prepends items, and a positional key would remount every card,
  // dropping its refusal, a row's open editor, an open confirm and the in-flight guard of a pending write.
  const cardsAfter = (index: number): { readonly key: string; readonly node: ReactNode }[] => {
    const out: { readonly key: string; readonly node: ReactNode }[] = [];
    for (const [id, at] of playbookAt) {
      if (at !== index) continue;
      const playbook = playbookList?.find((p) => p.id === id);
      const trigger = playbook?.trigger_id === null || playbook === undefined ? undefined : triggerList?.find((t) => t.id === playbook.trigger_id);
      out.push({ key: `card:pb:${id}`, node: <PlaybookCard api={api} playbookId={id} playbook={playbook} trigger={trigger} agent={agent} /> });
    }
    for (const [id, at] of triggerAt) {
      if (at !== index || shownInPlaybook.has(id)) continue;
      const trigger = triggerList?.find((t) => t.id === id);
      if (trigger !== undefined) out.push({ key: `card:tr:${id}`, node: <TriggerCard api={api} trigger={trigger} agent={agent} /> });
    }
    return out;
  };

  const rowView = (row: ThreadRow): ReactNode => {
    if (row.type === "skips") {
      const ids = row.items.map((i) => i.id);
      return (
        <SkipGroupCard
          api={api}
          items={row.items}
          playbook={row.playbookId === undefined ? undefined : playbookList?.find((p) => p.id === row.playbookId)}
          open={ids.some((id) => openSkips.has(id))}
          onToggle={() => toggleSkips(ids)}
        />
      );
    }
    if (row.type === "message") return <MessageView item={row} agent={agent} roster={roster} />;
    return <IntegrationEvent api={api} item={row} drafts={drafts} />;
  };

  // J and K move focus between the cards and event lines in display order. The thread list owns the keys, so the
  // composer (outside it) is never taken; arrows keep their native scroll; a key typed in a field, or one a nested
  // handler already took (an approval's A/D, an editor's Escape), is left alone.
  const onListKeyDown = (event: KeyboardEvent<HTMLOListElement>): void => {
    if (event.defaultPrevented) return;
    if (isEditableTarget(event.target)) return;
    const letter = event.key.toLowerCase();
    if (letter !== "j" && letter !== "k") return;
    // The field check is made above, on the real target; `listMove` here reads the key and modifiers only.
    const step = listMove({
      key: event.key,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
      target: event.currentTarget,
    });
    if (step === 0 || !(event.target instanceof Node)) return;
    const from = event.target;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(CARD_STOPS)];
    const next =
      step === 1
        ? stops.find((el) => (from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
        : stops.findLast((el) => (from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 && !el.contains(from));
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
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
      <ol className="chat-items" aria-label={`Thread with ${name}`} ref={listRef} tabIndex={-1} onKeyDown={onListKeyDown}>
        {/* One flat keyed list (no Fragment per item), so a card whose newest event moves keeps its state. */}
        {rows.flatMap((row) => {
          const last: ThreadItem = row.type === "skips" ? (row.items[row.items.length - 1] as ThreadItem) : row;
          // A skip group is keyed by its first skip's item key, which Load earlier can change (an older page of the same
          // run). Its open state lives in `openSkips` (any member id), so it survives that remount, not the key.
          const key = itemKey(row.type === "skips" ? (row.items[0] as ThreadItem) : row);
          return [
            <li key={key} className="chat-item" data-item={key}>
              {rowView(row)}
            </li>,
            ...cardsAfter(items.indexOf(last)).map((card) => (
              <li key={card.key} className="chat-item chat-item-card">
                {card.node}
              </li>
            )),
          ];
        })}
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
              <ApprovalCard api={api} approval={approval} agent={agent} playbooks={playbookList} />
            )}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div
      className="chat"
      data-testid="screen-chat"
      data-agent={agent}
      onFocus={(event) => {
        const el = event.target;
        const zone = el.closest('[data-testid="chat-pending-approval"]') !== null ? "approval" : el.closest(".chat-earlier") !== null ? "earlier" : "other";
        lastFocus.current = { el, zone };
      }}
      onBlur={(event) => {
        // Focus left for somewhere else on purpose: nothing to restore.
        const to = event.relatedTarget;
        if (to instanceof Node && !event.currentTarget.contains(to)) lastFocus.current = null;
      }}
    >
      <div className="chat-titlerow">
        <span className="chat-with" title={agent}>
          with {name}
        </span>
        {idShown ? <span className="chat-with-id" data-testid="thread-id">{agent}</span> : null}
        <StatusDot state={chip.dot} label={chip.word} />
        <span className="chat-spacer" />
        {isWright ? null : (
          <Button variant="ghost" size="row" onClick={() => navigate("#/team")}>
            Open in Team
          </Button>
        )}
      </div>
      {/* Outside the scroll: the thread opens at its end, and this line must be seen wherever the view is. */}
      {cardMissing ? (
        <p className="chat-card-missing" role="status" data-testid="chat-card-missing" ref={missingRef} tabIndex={-1}>
          {missingText}
        </p>
      ) : null}
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

