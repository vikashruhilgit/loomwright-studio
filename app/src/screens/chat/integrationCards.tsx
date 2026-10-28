// The phase 6 thread cards: a draft output (its body read on demand from
// `GET /drafts/:id`), a queued poll item, a run of unchanged (skipped) PRs and a
// connector line. All read-only: nothing here writes to the kernel.
//
// Every kernel string (a draft's body above all: it is model output built from
// PR text) is untrusted data. It passes through `printable` and renders as a
// React text child only: never `dangerouslySetInnerHTML`, never a markdown
// renderer, and an `href` is never built from one (the PR URL is shown as text,
// built from a strictly parsed `item_ref`).
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type {
  ApiResult,
  DraftDetailResponse,
  DraftOutput,
  DraftsResponse,
  EventFrame,
  EventsResponse,
  PlaybookListing,
  StudioBridge,
  ThreadItem,
  TruncatedEventFrame,
} from "../../api/contract";
import { EventCard } from "../../components/EventCard/EventCard";
import { liveStoreFor } from "../../store/react";
import { payloadText, printable } from "../approvals/printable";
import { clock, navigate, refId, refusalOf } from "./model";

export type EventItem = Extract<ThreadItem, { readonly type: "event" }>;

// ---- grouping ------------------------------------------------------------------

/** A run of consecutive `poll_item_skipped` items of one playbook, shown as one card. */
export interface SkipGroupRow {
  readonly type: "skips";
  /** The first skip's id: the group's key is that skip's own item key. */
  readonly id: number;
  readonly playbookId: number | undefined;
  readonly items: readonly EventItem[];
}

export type ThreadRow = ThreadItem | SkipGroupRow;

/**
 * Fold consecutive `poll_item_skipped` items with the same `playbook_id` into
 * one group row; every other item passes through. Position decides: any other
 * item between two skips, or a different playbook, starts a new group (the
 * skip payload carries no fire id, so "one poll" cannot be told apart from two
 * back-to-back polls).
 */
export function groupThreadRows(items: readonly ThreadItem[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let open: { id: number; playbookId: number | undefined; items: EventItem[] } | undefined;
  const close = (): void => {
    if (open !== undefined) rows.push({ type: "skips", id: open.id, playbookId: open.playbookId, items: open.items });
    open = undefined;
  };
  for (const item of items) {
    if (item.type === "event" && item.kind === "poll_item_skipped") {
      const playbookId = refId(item.ref, "playbook_id");
      if (open !== undefined && open.playbookId === playbookId) {
        open.items.push(item);
        continue;
      }
      close();
      open = { id: item.id, playbookId, items: [item] };
      continue;
    }
    close();
    rows.push(item);
  }
  close();
  return rows;
}

// ---- the PR a draft is for -----------------------------------------------------

interface PrRef {
  readonly label: string;
  readonly url: string;
}

function prRefOf(itemRef: string | null | undefined): PrRef | undefined {
  if (typeof itemRef !== "string") return undefined;
  const match = /^github:([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)#([1-9][0-9]*)$/.exec(itemRef);
  if (match === null) return undefined;
  const [, owner, repo, number] = match;
  return { label: `${owner}/${repo}#${number}`, url: `https://github.com/${owner}/${repo}/pull/${number}` };
}

/** The PR's URL for an `item_ref` of the exact shape `github:<owner>/<repo>#<n>`; `undefined` for anything else. */
export function prUrlOf(itemRef: string | null | undefined): string | undefined {
  return prRefOf(itemRef)?.url;
}

// ---- reading an event's stored payload ----------------------------------------------

type Fields = Readonly<Record<string, unknown>>;

export type PayloadRead = { readonly status: "pending" } | { readonly status: "ready"; readonly fields: Fields } | { readonly status: "missing" };

const PENDING: PayloadRead = { status: "pending" };
const MISSING: PayloadRead = { status: "missing" };

/** Per bridge: an event id's payload fields, or `null` when its row is gone or carries no object. */
const settled = new WeakMap<StudioBridge, Map<number, Fields | null>>();
const inflight = new WeakMap<StudioBridge, Map<number, Promise<boolean>>>();

function mapFor<V>(table: WeakMap<StudioBridge, Map<number, V>>, api: StudioBridge): Map<number, V> {
  let found = table.get(api);
  if (found === undefined) {
    found = new Map<number, V>();
    table.set(api, found);
  }
  return found;
}

function fieldsOf(payload: unknown): Fields | null {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? (payload as Fields) : null;
}

function isTruncatedFrame(frame: EventFrame | TruncatedEventFrame): frame is TruncatedEventFrame {
  return "truncated" in frame;
}

/** What is known about event `id`'s payload right now, without asking the kernel. */
function readNow(api: StudioBridge, id: number): PayloadRead {
  const cache = mapFor(settled, api);
  if (cache.has(id)) {
    const fields = cache.get(id) ?? null;
    return fields === null ? MISSING : { status: "ready", fields };
  }
  const frame = liveStoreFor(api)
    .getSnapshot()
    .eventLog.find((e) => e.id === id);
  if (frame !== undefined && !isTruncatedFrame(frame)) {
    const fields = fieldsOf(frame.payload);
    return fields === null ? MISSING : { status: "ready", fields };
  }
  return PENDING;
}

/** The widest id span one `GET /events` batch asks for (the kernel caps `limit` at 500). */
const BATCH_SPAN = 500;

/** Ids asked for since the last flush, per bridge, with the resolver of each one's promise. */
const waiting = new WeakMap<StudioBridge, Map<number, (done: boolean) => void>>();

/** Read every id asked for in this tick: one `GET /events?after=<min-1>&limit=<span>` per run of ids within the span cap. */
function flushPayloads(api: StudioBridge): void {
  const queue = mapFor(waiting, api);
  const running = mapFor(inflight, api);
  const ids = [...queue.keys()].sort((x, y) => x - y);
  const resolvers = new Map(queue);
  queue.clear();
  const batches: number[][] = [];
  for (const id of ids) {
    const last = batches[batches.length - 1];
    if (last !== undefined && id - (last[0] as number) + 1 <= BATCH_SPAN) last.push(id);
    else batches.push([id]);
  }
  for (const batch of batches) {
    const first = batch[0] as number;
    // Events come back in id order, so a span of `n` ids holds at most `n` rows.
    const span = (batch[batch.length - 1] as number) - first + 1;
    void (async (): Promise<void> => {
      let result: ApiResult<EventsResponse> | undefined;
      try {
        result = await api.request<EventsResponse>({ method: "GET", path: "/events", query: { after: String(first - 1), limit: String(span) } });
      } catch {
        result = undefined;
      }
      const done = result?.ok === true;
      if (result?.ok === true) {
        const events = Array.isArray(result.body?.events) ? result.body.events : [];
        const cache = mapFor(settled, api);
        for (const id of batch) {
          const row = events.find((e) => e.id === id && !isTruncatedFrame(e));
          cache.set(id, row === undefined || isTruncatedFrame(row) ? null : fieldsOf(row.payload));
        }
      }
      for (const id of batch) {
        running.delete(id);
        resolvers.get(id)?.(done);
      }
    })();
  }
}

/**
 * Ask for the stored payloads of `ids`. Everything asked for in the same tick (a thread of queued lines
 * mounts them together) goes out as batched `GET /events` reads. Cached per bridge and id; an id already
 * being read shares that read. Each id's promise resolves `false` when the read failed (nothing is cached).
 */
function loadPayloads(api: StudioBridge, ids: readonly number[]): Map<number, Promise<boolean>> {
  const running = mapFor(inflight, api);
  const queue = mapFor(waiting, api);
  const out = new Map<number, Promise<boolean>>();
  for (const id of ids) {
    let run = running.get(id);
    if (run === undefined) {
      run = new Promise<boolean>((resolve) => {
        queue.set(id, resolve);
      });
      running.set(id, run);
    }
    out.set(id, run);
  }
  if (queue.size > 0) queueMicrotask(() => flushPayloads(api));
  return out;
}

/**
 * Each event id's stored payload: from the live store's `eventLog` when it holds
 * the frame, else one batched `GET /events?after=<min-1>&limit=<span>` for all the
 * ids still missing. Cached per bridge and id.
 * A read that failed is not retried until the component remounts.
 */
export function useEventPayloads(api: StudioBridge, ids: readonly number[]): ReadonlyMap<number, PayloadRead> {
  const [, setTick] = useState(0);
  const failed = useRef(new Set<number>());
  const wanted = ids.join(",");
  useEffect(() => {
    let live = true;
    const need = ids.filter((id) => !failed.current.has(id) && readNow(api, id).status === "pending");
    if (need.length > 0) {
      const runs = loadPayloads(api, need);
      void Promise.all(
        need.map(async (id) => {
          if (!(await (runs.get(id) as Promise<boolean>))) failed.current.add(id);
        }),
      ).then(() => {
        if (live) setTick((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
    // `wanted` is `ids` by value.
  }, [api, wanted]);
  const out = new Map<number, PayloadRead>();
  for (const id of ids) out.set(id, failed.current.has(id) ? MISSING : readNow(api, id));
  return out;
}

// ---- the poll lines ---------------------------------------------------------------

function textField(fields: Fields, name: string): string | undefined {
  const value = fields[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A playbook's dedupe key spec (a JSON list of field names) as its fields; anything else counts as no spec. */
function dedupeFields(spec: string | null | undefined): string[] | undefined {
  if (typeof spec !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(spec);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((f): f is string => typeof f === "string")) return parsed;
  } catch {
    // Not JSON: no spec.
  }
  return undefined;
}

/** "Reviewing <ref> @ <first 7 chars of the revision>"; the kernel's summary when the payload is not there. */
function queuedText(item: EventItem, read: PayloadRead | undefined): string {
  if (read?.status !== "ready") return printable(item.summary);
  const ref = textField(read.fields, "item_ref");
  if (ref === undefined) return printable(item.summary);
  const revision = textField(read.fields, "revision");
  return printable(revision === undefined ? `Reviewing ${ref}` : `Reviewing ${ref} @ ${revision.slice(0, 7)}`);
}

/** "Skipped <ref>: unchanged under key <fields>"; the kernel's summary when the payload is not there. */
function skipText(item: EventItem, read: PayloadRead | undefined, spec: string | null | undefined): string {
  if (read?.status !== "ready") return printable(item.summary);
  const ref = textField(read.fields, "item_ref");
  if (ref === undefined) return printable(item.summary);
  const fields = dedupeFields(spec);
  const key = fields !== undefined ? fields.join(", ") : textField(read.fields, "dedupe_key");
  return printable(key === undefined ? `Skipped ${ref}: unchanged` : `Skipped ${ref}: unchanged under key ${key}`);
}

/** One event line in the phase 5 style (icon, subject, time). */
function Line({ item, text, target }: { readonly item: EventItem; readonly text: string; readonly target: string }) {
  return <EventCard variant="event" event={{ kind: "playbook", subject: text, time: clock(item.at), dateTime: item.at, target }} onOpen={(to) => navigate(to)} />;
}

export function PollQueuedLine({ api, item }: { readonly api: StudioBridge; readonly item: EventItem }) {
  const read = useEventPayloads(api, [item.id]).get(item.id);
  return <Line item={item} text={queuedText(item, read)} target="#/chat" />;
}

/** A `connector_status` line: the kernel's summary, its subject linking to the Integrations screen. */
export function ConnectorLine({ item }: { readonly item: EventItem }) {
  return <EventCard variant="event" event={{ kind: "hook", subject: printable(item.summary), time: clock(item.at), dateTime: item.at, target: "#/integrations" }} onOpen={(to) => navigate(to)} />;
}

// ---- a card's header ------------------------------------------------------------------

function CardToggle({ label, open, controls, onToggle }: { readonly label: string; readonly open: boolean; readonly controls: string; readonly onToggle: () => void }) {
  // A button's Enter is its click in a browser; handling the key here keeps it one toggle whichever way the key arrives.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // Taken even when ignored: left alone, the browser's Enter-to-click would toggle on every auto-repeat.
    event.preventDefault();
    if (event.repeat) return;
    onToggle();
  };
  return (
    <button type="button" className="chat-card-toggle" data-thread-card="" aria-expanded={open} aria-controls={controls} onClick={onToggle} onKeyDown={onKeyDown}>
      <span className="chat-card-title">{label}</span>
      <span className="chat-card-chevron" aria-hidden="true">
        {open ? "▾" : "▸"}
      </span>
    </button>
  );
}

// ---- the skip group ----------------------------------------------------------------

export function SkipGroupCard({
  api,
  items,
  playbook,
  open,
  onToggle,
}: {
  readonly api: StudioBridge;
  readonly items: readonly EventItem[];
  readonly playbook: PlaybookListing | undefined;
  /** Held by the thread, not here: a group's key (its first skip) changes when Load earlier extends the run. */
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const bodyId = useId();
  const single = items.length === 1;
  // A run's lines are read when they are shown: a single skip at once, a group when it is opened.
  const reads = useEventPayloads(api, single || open ? items.map((i) => i.id) : []);
  const spec = playbook?.dedupe_key_spec;
  if (single) {
    const only = items[0] as EventItem;
    return <Line item={only} text={skipText(only, reads.get(only.id), spec)} target="#/chat" />;
  }
  const newest = items[items.length - 1] as EventItem;
  return (
    <section className="chat-card chat-integration chat-skips" aria-label={`${items.length} unchanged PRs skipped`}>
      <div className="chat-card-head">
        <CardToggle label={`${items.length} unchanged PRs skipped`} open={open} controls={bodyId} onToggle={onToggle} />
        <time className="chat-card-meta" dateTime={newest.at}>
          {clock(newest.at)}
        </time>
      </div>
      <div id={bodyId} hidden={!open}>
        {open ? (
          <ul className="chat-skip-list">
            {items.map((item) => (
              <li key={item.id} className="chat-skip-line">
                {skipText(item, reads.get(item.id), spec)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

// ---- the draft card -------------------------------------------------------------------

type Detail =
  | { readonly phase: "idle" }
  | { readonly phase: "loading" }
  | { readonly phase: "done"; readonly draft: DraftOutput }
  | { readonly phase: "failed"; readonly text: string };

/** The text a draft's payload would have sent: the review/comment body, the command, or the tool's input JSON. */
function draftBodyText(payload: unknown): string {
  const fields = fieldsOf(payload);
  if (fields === null) return payloadText(payload);
  const kind = fields["kind"];
  const body = textField(fields, "body");
  const command = textField(fields, "command");
  const input = textField(fields, "input_json");
  if (kind === "gh_pr_review" || kind === "gh_pr_comment") return body ?? command ?? payloadText(payload);
  if (kind === "command") return command ?? payloadText(payload);
  if (kind === "input") return input ?? payloadText(payload);
  return payloadText(payload);
}

/**
 * One draft a draft-mode session recorded instead of sending. The collapsed card
 * says which PR it is for and, always, that nothing was posted; opening it reads
 * `GET /drafts/:id` once and shows the body as inert text.
 */
export function DraftCard({ api, draftId, at, listed }: { readonly api: StudioBridge; readonly draftId: number; readonly at: string; readonly listed: DraftOutput | undefined }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail>({ phase: "idle" });
  const asked = useRef(false);
  const alive = useRef(true);
  const bodyId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = async (): Promise<void> => {
    let result: ApiResult<DraftDetailResponse> | undefined;
    try {
      result = await api.request<DraftDetailResponse>({ method: "GET", path: "/drafts/:id", params: { id: draftId } });
    } catch {
      result = undefined;
    }
    if (!alive.current) return;
    if (result?.ok === true) {
      const draft = (result.body as Partial<DraftDetailResponse> | undefined)?.draft;
      setDetail(draft === undefined ? { phase: "failed", text: "The kernel's answer had no draft." } : { phase: "done", draft });
    } else {
      setDetail({ phase: "failed", text: refusalOf(result).text });
    }
  };

  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    if (next && !asked.current) {
      asked.current = true;
      setDetail({ phase: "loading" });
      void load();
    }
  };

  const row = detail.phase === "done" ? detail.draft : listed;
  const itemRef = row?.item_ref;
  const pr = prRefOf(itemRef);
  let title: string;
  if (pr !== undefined) title = `Draft review for ${pr.label} (not sent)`;
  else if (typeof itemRef === "string" && itemRef !== "") title = `Draft review for ${printable(itemRef)} (not sent)`;
  else title = "Draft review (not sent)";

  let body: ReactNode = null;
  if (open) {
    if (detail.phase === "failed") {
      body = (
        <p className="chat-card-refusal" role="alert">
          {printable(detail.text)}
        </p>
      );
    } else if (detail.phase === "done") {
      const payload = detail.draft.payload;
      const cut = fieldsOf(payload)?.["truncated"] === true;
      body = (
        <>
          <pre className="chat-draft-text">{printable(draftBodyText(payload), true)}</pre>
          {cut ? <p className="chat-card-meta">The kernel cut this text to fit.</p> : null}
        </>
      );
    } else {
      body = (
        <p className="chat-card-meta" role="status">
          Reading the draft
        </p>
      );
    }
  }

  return (
    <section className="chat-card chat-integration chat-draft" aria-label={title} data-draft={draftId}>
      <div className="chat-card-head">
        <CardToggle label={title} open={open} controls={bodyId} onToggle={toggle} />
        <time className="chat-card-meta" dateTime={at}>
          {clock(at)}
        </time>
      </div>
      {pr === undefined ? (
        <p className="chat-card-meta">Draft {draftId}</p>
      ) : (
        <p className="chat-card-meta chat-mono">{pr.url}</p>
      )}
      <p className="chat-card-dry">Draft mode: nothing was posted</p>
      <div id={bodyId} hidden={!open}>
        {body}
      </div>
    </section>
  );
}

/**
 * The thread agent's recent drafts: the collapsed card's PR comes from here. Read when the thread first
 * shows a draft event, and once more for each draft id the last read did not carry (one that arrived live,
 * or fell outside the newest 200). Each id triggers at most one read, so a draft the list never holds
 * cannot loop; its card falls back to its title until opened.
 */
export function useDraftList(api: StudioBridge, agent: string, draftIds: readonly number[]): ReadonlyMap<number, DraftOutput> | undefined {
  const [rows, setRows] = useState<ReadonlyMap<number, DraftOutput> | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const covered = useRef(new Set<number>());
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const wanted = draftIds.join(",");
  useEffect(() => {
    if (busy.current) return;
    const missing = draftIds.filter((id) => !covered.current.has(id) && rows?.has(id) !== true);
    if (missing.length === 0) return;
    for (const id of missing) covered.current.add(id);
    busy.current = true;
    void (async () => {
      let result: ApiResult<DraftsResponse> | undefined;
      try {
        result = await api.request<DraftsResponse>({ method: "GET", path: "/drafts", query: { agent, limit: "200" } });
      } catch {
        result = undefined;
      }
      busy.current = false;
      if (!alive.current) return;
      if (result?.ok === true && Array.isArray(result.body?.drafts)) {
        const drafts = result.body.drafts;
        setRows((prev) => new Map([...(prev ?? []), ...drafts.map((d): [number, DraftOutput] => [d.id, d])]));
      }
      // Ids that arrived while this read was in flight get their own pass.
      setTick((n) => n + 1);
    })();
    // `wanted` is `draftIds` by value; `tick` re-runs the pass after a read.
  }, [api, agent, wanted, tick]);
  return rows;
}
