// The Tasks screen's canned kernel (phase 7 item 03), for
// `startFixtureKernel({ routes })`. Every body is typed by the contract.
//
// It answers the two Tasks routes the way the kernel's `tasks` gui part does
// (the brief's "Kernel route rules"), so the screen is tested against the form
// the real kernel will send:
//
// - `GET /tasks`: every row is a `TaskBoardItem` with its source's own state,
//   verbatim; rows newest first by `updated`, then `kind`, then `id`
//   descending; grouped by `state` in the order each first appears; `limit`
//   defaults to 50, at most 200; `before` is an opaque cursor and `next_before`
//   is `null` once the oldest row is in the page; a bad `limit` or `before`
//   answers 400 `invalid_query`. A session a task or a run owns is not its own
//   card: the spec simply does not list one as an item.
// - `GET /tasks/:kind/:id`: the item, its sessions (a task's or a run's own, or
//   the session itself), the events that name it or one of its sessions
//   (oldest first, at most the newest 500, `session_output_appended` left out),
//   its playbook runs, and the approvals whose `requesting_session` is one of
//   its sessions, pending first (approvals named only by playbook are left out).
//   A `kind` outside task / playbook_run / session answers 400 `invalid_kind`, a
//   non-positive or non-integer id 400 `invalid_id`, a missing row 404 `not_found`.
//
// The session routes (`GET /sessions/:id/output`, Stop and Kill) are
// `./sessions.ts`'s, over the same `SessionsKernel`, so a Stop here ends the
// session the same way it does on the Sessions screen. The state is mutable:
// a spec changes `items`, then pushes the event the kernel would append.
import type { Approval, EventFrame, PlaybookRun, RouteKey, SessionOutputRow, SessionOutputKind, SessionSummary, TaskBoardGroup, TaskBoardItem, TaskBoardKind, TaskHistoryResponse, TasksResponse } from "../../src/api/contract";
import type { FixtureAnswer, FixtureRequest, FixtureRoute } from "../fixture-kernel";
import { ago, outputRow, sessionsKernel, sessionsRoutes, summary } from "./sessions";
import type { SessionsKernel } from "./sessions";

export { ago, deferred } from "./sessions";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const MAX_HISTORY_EVENTS = 500;

const KINDS: readonly TaskBoardKind[] = ["task", "playbook_run", "session"];
const MINUTE = 60_000;

/**
 * `minutes` ago as the kernel writes a time, but never before today's local midnight: every card in these
 * boards is "today", whenever the spec runs (a "Done today" card is dropped if it ended yesterday).
 */
export function stamp(minutes: number): string {
  const midnight = new Date();
  midnight.setHours(0, 0, 1, 0);
  return new Date(Math.max(Date.now() - minutes * MINUTE, midnight.getTime())).toISOString();
}

/** A board row: every field set, `overrides` replace. A session has no title; a task or run has `Title <id>`. */
export function item(kind: TaskBoardKind, id: number, state: string, overrides: Partial<TaskBoardItem> = {}): TaskBoardItem {
  return {
    kind,
    id,
    title: kind === "session" ? null : `Title ${id}`,
    state,
    agent: "mason",
    playbook: null,
    item_ref: null,
    session: null,
    tokens: null,
    started: stamp(30),
    ended: null,
    updated: stamp(5),
    ...overrides,
  };
}

/** The mockup's "Populated" view: eight cards, three of them working. Nothing waits on the owner. */
export function populatedItems(): TaskBoardItem[] {
  return [
    item("task", 9, "working", { title: "Review PR #3 on studio-sandbox", agent: "mason", session: 41, started: stamp(12), updated: stamp(2) }),
    item("playbook_run", 18, "running", { title: "Weekly changelog draft", agent: "ada", playbook: 2, session: 42, tokens: 4210, started: stamp(6), updated: stamp(3) }),
    item("session", 44, "running", { agent: "wright", started: stamp(3), updated: stamp(4) }),
    item("task", 7, "parked", { title: "Check studio-sandbox for new PRs", agent: "mason", started: stamp(140), updated: stamp(142) }),
    item("session", 38, "interrupted", { agent: "ada", started: stamp(180), ended: stamp(140), updated: stamp(140) }),
    item("task", 5, "done", { title: "Review PR #2 on studio-sandbox", agent: "mason", session: 37, started: stamp(72), updated: stamp(62) }),
    item("playbook_run", 16, "failed", { title: "Review PRs on studio-sandbox", agent: "mason", playbook: 1, session: 35, tokens: 2104, started: stamp(160), ended: stamp(159), updated: stamp(159) }),
    item("session", 40, "stopped", { agent: "mason", started: stamp(111), ended: stamp(102), updated: stamp(102) }),
  ];
}

/** The mockup's "Waiting on you" view: the populated board plus a task waiting on an answer and a session paused on the token. */
export function waitingItems(): TaskBoardItem[] {
  return [
    ...populatedItems(),
    item("task", 12, "waiting", { title: "Pick the repos Mason reviews first", agent: "wright", started: stamp(41), updated: stamp(41) }),
    item("session", 39, "failed:auth", { agent: "ada", started: stamp(34), ended: stamp(27), updated: stamp(27) }),
  ];
}

/** A feed event: the kernel appends one per change, and the board refetches on each (but not `session_output_appended`). */
export function feedEvent(id: number, kind: string, ids: { readonly session?: number | null; readonly task?: number | null } = {}, payload: unknown = {}): EventFrame {
  return { type: "event", id, at: new Date().toISOString(), kind, session_id: ids.session ?? null, task_id: ids.task ?? null, payload };
}

export interface TasksKernelInit {
  readonly items?: readonly TaskBoardItem[];
  /** Events by card key (`task:9`): the history's events, oldest first. */
  readonly events?: ReadonlyMap<string, readonly EventFrame[]>;
  readonly runs?: ReadonlyMap<string, readonly PlaybookRun[]>;
  readonly approvals?: readonly Approval[];
  readonly sessions?: readonly SessionSummary[];
  readonly output?: ReadonlyMap<number, readonly SessionOutputRow[]>;
}

export interface TasksKernel {
  items: TaskBoardItem[];
  events: Map<string, EventFrame[]>;
  runs: Map<string, PlaybookRun[]>;
  approvals: Approval[];
  /** The session side: summaries, output rows, Stop and Kill, `/status`, `/agents`. */
  readonly sessions: SessionsKernel;
  /** Every `GET /tasks` read, in order. */
  readonly listReads: { readonly query: Readonly<Record<string, string>> }[];
  /** Every `GET /tasks/:kind/:id` read, in order. */
  readonly historyReads: { readonly kind: string; readonly id: string }[];
}

export function tasksKernel(init: TasksKernelInit = {}): TasksKernel {
  const sessions = sessionsKernel({
    sessions: init.sessions ?? [],
    ...(init.output === undefined ? {} : { output: init.output }),
    ...(init.approvals === undefined ? {} : { approvals: init.approvals }),
  });
  return {
    items: [...(init.items ?? [])],
    events: new Map([...(init.events ?? [])].map(([k, v]) => [k, [...v]])),
    runs: new Map([...(init.runs ?? [])].map(([k, v]) => [k, [...v]])),
    approvals: [...(init.approvals ?? [])],
    sessions,
    listReads: [],
    historyReads: [],
  };
}

const ok = (body: unknown): FixtureAnswer => ({ status: 200, body });
const refused = (status: number, error: string): FixtureAnswer => ({ status, body: { error } });

function timeOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** The kernel's order: newest `updated` first, then `kind`, then `id` descending. */
function newestFirst(a: TaskBoardItem, b: TaskBoardItem): number {
  const ta = timeOf(a.updated);
  const tb = timeOf(b.updated);
  if (ta !== tb) return ta < tb ? 1 : -1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return b.id - a.id;
}

/** The opaque cursor: this fixture's own format (the app never reads it). */
function cursorOf(row: TaskBoardItem): string {
  return `${row.updated}|${row.kind}|${row.id}`;
}

function listHandler(kernel: TasksKernel, req: FixtureRequest): FixtureAnswer {
  kernel.listReads.push({ query: req.query });
  const rawLimit = req.query.limit;
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    if (!/^[1-9][0-9]*$/.test(rawLimit) || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) > MAX_LIMIT) return refused(400, "invalid_query");
    limit = Number(rawLimit);
  }
  const ordered = [...kernel.items].sort(newestFirst);
  let rows = ordered;
  const before = req.query.before;
  if (before !== undefined) {
    const at = ordered.findIndex((row) => cursorOf(row) === before);
    if (at === -1) return refused(400, "invalid_query");
    rows = ordered.slice(at + 1);
  }
  const page = rows.slice(0, limit);
  // Grouped by state, in the order each first appears in the page.
  const groups: { state: string; items: TaskBoardItem[] }[] = [];
  for (const row of page) {
    const group = groups.find((g) => g.state === row.state);
    if (group === undefined) groups.push({ state: row.state, items: [row] });
    else group.items.push(row);
  }
  const last = page[page.length - 1];
  const body: TasksResponse = { groups: groups satisfies TaskBoardGroup[], next_before: rows.length > limit && last !== undefined ? cursorOf(last) : null };
  return ok(body);
}

function historyHandler(kernel: TasksKernel, req: FixtureRequest): FixtureAnswer {
  const kind = req.params.kind ?? "";
  const rawId = req.params.id ?? "";
  kernel.historyReads.push({ kind, id: rawId });
  if (!KINDS.includes(kind as TaskBoardKind)) return refused(400, "invalid_kind");
  if (!/^[1-9][0-9]*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))) return refused(400, "invalid_id");
  const id = Number(rawId);
  const row = kernel.items.find((i) => i.kind === kind && i.id === id);
  if (row === undefined) return refused(404, "not_found");

  const ownIds = row.kind === "session" ? [row.id] : row.session === null ? [] : [row.session];
  const sessions = kernel.sessions.sessions.filter((s) => ownIds.includes(s.id));
  const key = `${row.kind}:${row.id}`;
  const named = [...(kernel.events.get(key) ?? [])];
  for (const sessionId of ownIds) named.push(...(kernel.events.get(`session:${sessionId}`) ?? []));
  const events = named
    .filter((e) => e.kind !== "session_output_appended")
    .sort((a, b) => a.id - b.id)
    .slice(-MAX_HISTORY_EVENTS);
  const approvals = kernel.approvals
    .filter((a) => a.requesting_session !== null && ownIds.includes(a.requesting_session))
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.id - a.id);
  const body: TaskHistoryResponse = { item: row, events, runs: kernel.runs.get(key) ?? [], sessions, approvals };
  return ok(body);
}

/** The routes, over `kernel`'s live state: the Tasks pair, then the session routes. */
export function tasksRoutes(kernel: TasksKernel): Partial<Record<RouteKey, FixtureRoute>> {
  return {
    ...sessionsRoutes(kernel.sessions),
    "GET /tasks": (req) => listHandler(kernel, req),
    "GET /tasks/:kind/:id": (req) => historyHandler(kernel, req),
  };
}

// ---- the mockup's histories and logs ----------------------------------------------------------------------

/** The history and log of the mockup's `t9`, `r18` and `s44` cards: sessions 41, 42 and 44, running. */
export function runningSessions(): SessionSummary[] {
  return [
    summary(41, { agent: "mason", status: "running", started: ago(12), ended: null, tokens: 5310, cwd: "/Users/owner/worktrees/studio-sandbox" }),
    summary(42, { agent: "ada", status: "running", playbook: 2, started: ago(6), ended: null, tokens: 4210, cwd: "/Users/owner/worktrees/changelog" }),
    summary(44, { agent: "wright", status: "running", model: "opus", started: ago(3), ended: null, tokens: 1800 }),
    summary(40, { agent: "mason", status: "stopped", started: ago(111), ended: ago(102), tokens: 3900 }),
  ];
}

/** Session 41's log: the mockup's `t9` lines as stored rows. */
export function reviewLog(sessionId: number): SessionOutputRow[] {
  const rows: [SessionOutputKind, unknown, number][] = [
    ["tool_call", { tool_use_id: "a1", name: "Read", input_json: '{"file_path":"PR #3 · 3 files changed"}' }, 12],
    ["tool_call", { tool_use_id: "a2", name: "Read", input_json: '{"file_path":"src/queue.ts, src/queue.test.ts, README.md"}' }, 11],
    ["assistant_text", { text: "The new retry loop never resets its counter after a success." }, 8],
    ["assistant_text", { text: "Test covers the failure path only; the success path is untested." }, 4],
    ["tool_decision", { tool: "Bash", decision: "allow", reason: "policy_allow", tool_use_id: "a3" }, 2],
    ["assistant_text", { text: "writing the summary comment" }, 0.5],
  ];
  return rows.map(([kind, payload, minutes], i) => outputRow(sessionId, i + 1, kind, payload, ago(minutes)));
}

/** The history events of the mockup's `t9`, oldest first. */
export function reviewHistory(): EventFrame[] {
  const at = (minutes: number): string => stamp(minutes);
  return [
    { type: "event", id: 101, at: at(12), kind: "trigger_fired", session_id: null, task_id: 9, payload: { trigger: "poll", found: "PR #3 on studio-sandbox" } },
    { type: "event", id: 102, at: at(12), kind: "task_created", session_id: null, task_id: 9, payload: { title: "Review PR #3 on studio-sandbox", state: "working" } },
    { type: "event", id: 103, at: at(12), kind: "session_started", session_id: 41, task_id: 9, payload: { model: "sonnet" } },
    { type: "event", id: 104, at: at(2), kind: "draft_output_recorded", session_id: 41, task_id: 9, payload: { note: "Draft review recorded for studio-sandbox #3. Recorded, not sent." } },
  ];
}
