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
// The phase 8 ticket -> PR cards (`ticketItems`, `ticketHistory`, `ticketSessions`, `waitingMergeApproval`) are new
// exports over the same routes; `populatedItems` and `waitingItems` are untouched (every plain row has `ticket_pr: null`).
//
// The session routes (`GET /sessions/:id/output`, Stop and Kill) are
// `./sessions.ts`'s, over the same `SessionsKernel`, so a Stop here ends the
// session the same way it does on the Sessions screen. The state is mutable:
// a spec changes `items`, then pushes the event the kernel would append.
import type { Approval, EventFrame, PlaybookRun, PrTrackState, RouteKey, SessionOutputRow, SessionOutputKind, SessionSummary, TaskBoardGroup, TaskBoardItem, TaskBoardKind, TaskHistoryResponse, TaskTicketPr, TasksResponse } from "../../src/api/contract";
import type { FixtureAnswer, FixtureRequest, FixtureRoute } from "../fixture-kernel";
import { mergeApproval } from "./approvals";
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
    creator_agent: null,
    creator_session: null,
    ticket_pr: null,
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
  /** Sessions a card owns beyond its `session` (the kernel's `sessions.task_id`), by card key: its history lists them all. */
  readonly sessionsOf?: ReadonlyMap<string, readonly number[]>;
}

export interface TasksKernel {
  items: TaskBoardItem[];
  events: Map<string, EventFrame[]>;
  runs: Map<string, PlaybookRun[]>;
  approvals: Approval[];
  /** Sessions a card owns beyond its `session`, by card key. */
  sessionsOf: Map<string, number[]>;
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
    sessionsOf: new Map([...(init.sessionsOf ?? [])].map(([k, v]) => [k, [...v]])),
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

  const key = `${row.kind}:${row.id}`;
  const owned = kernel.sessionsOf.get(key) ?? [];
  const ownIds = row.kind === "session" ? [row.id] : [...(row.session === null ? [] : [row.session]), ...owned.filter((id) => id !== row.session)];
  const sessions = kernel.sessions.sessions.filter((s) => ownIds.includes(s.id));
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

/**
 * The history and log of the mockup's `t9`, `r18` and `s44` cards: sessions 41, 42 and 44, running. Each carries the
 * title the kernel derives for it (`kernel/src/brain/titles.ts`): a task's session its task's title, a playbook run's
 * session its playbook's name, a chat session its thread's first line; session 40 has none of those (`Session #40`).
 */
export function runningSessions(): SessionSummary[] {
  return [
    summary(41, { agent: "mason", status: "running", started: ago(12), ended: null, tokens: 5310, cwd: "/Users/owner/worktrees/studio-sandbox", title: "Review PR #3 on studio-sandbox" }),
    summary(42, { agent: "ada", status: "running", playbook: 2, started: ago(6), ended: null, tokens: 4210, cwd: "/Users/owner/worktrees/changelog", title: "Weekly changelog draft" }),
    summary(44, { agent: "wright", status: "running", model: "opus", started: ago(3), ended: null, tokens: 1800, title: "Why is the studio-sandbox build red?" }),
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

// ---- phase 8: a ticket's pull request on the board ---------------------------------------------------------

/** The repo the mockup's PRs are in (the owner's own sandbox). */
export const TICKET_REPO = "vikashruhilgit/studio-sandbox";
const HEAD_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

/** A `ticket_pr` as the kernel's `GET /tasks` writes it: every field set, `overrides` replace. */
export function ticketPr(number: number, state: PrTrackState, overrides: Partial<TaskTicketPr> = {}): TaskTicketPr {
  return {
    ticket: null,
    repo: TICKET_REPO,
    number,
    url: `https://github.com/${overrides.repo ?? TICKET_REPO}/pull/${number}`,
    state,
    head_sha: HEAD_SHA,
    approvals: "solo",
    ci: "green",
    owner_kind: "owner",
    merged_by_gate: false,
    updated: stamp(5),
    ...overrides,
  };
}

/** A ticket task: the board row of a task whose links name a PR the tracker follows. Its `state` is the PR's, as the tracker writes it. */
export function ticketItem(id: number, title: string, pr: TaskTicketPr, overrides: Partial<TaskBoardItem> = {}): TaskBoardItem {
  return item("task", id, pr.state, { title, agent: "ada", ticket_pr: pr, ...overrides });
}

/** The ticket task whose PR #21 is parked, waiting on the merge approval `waitingMergeApproval` (the mockup's `p21`). */
export const WAITING_TICKET = 61;
/** The ticket task whose PR #22 is open, CI pending, 0 of 2 approvals (the mockup's `p22`): nothing on it is green. */
export const PENDING_TICKET = 62;

/** The mockup's seven ticket -> PR cards and the plain task beside them. Nothing here is waiting until `waitingMergeApproval` is pending. */
export function ticketItems(): TaskBoardItem[] {
  return [
    ticketItem(WAITING_TICKET, "Add retry reset to the queue loop", ticketPr(21, "parked", { ticket: `github:${TICKET_REPO}#14`, approvals: "studio_approval", owner_kind: "automate_parked" }), { session: 54, started: stamp(160), updated: stamp(40) }),
    ticketItem(PENDING_TICKET, "Document the retry policy in the README", ticketPr(22, "open", { ticket: "clickup:CU-8a41", approvals: "0/2", ci: "pending", owner_kind: "automate_live", head_sha: "5e6f7a8b9c0d1e2f30415263748596a7b8c9d0e1" }), { session: 55, started: stamp(14), updated: stamp(3) }),
    ticketItem(63, "Fix the flaky timeout test", ticketPr(19, "ready", { ticket: `github:${TICKET_REPO}#12`, approvals: "solo", owner_kind: "owner" }), { started: stamp(70), updated: stamp(10) }),
    ticketItem(64, "Bump the test runner", ticketPr(23, "draft", { ticket: `github:${TICKET_REPO}#15`, approvals: "0/2", ci: "failing", owner_kind: "other" }), { agent: "mason", started: stamp(52), updated: stamp(20) }),
    ticketItem(65, "Handle a missing volume label", ticketPr(4, "parked", { repo: "vikashruhilgit/ntfs-tool", ticket: "github:vikashruhilgit/ntfs-tool#3", approvals: "no_policy", owner_kind: "owner" }), { started: stamp(100), updated: stamp(60) }),
    ticketItem(66, "Rename the config key", ticketPr(17, "merged", { ticket: `github:${TICKET_REPO}#9`, approvals: "solo", owner_kind: "automate_live", merged_by_gate: true }), { started: stamp(130), ended: stamp(30), updated: stamp(30) }),
    ticketItem(67, "Drop the unused retry flag", ticketPr(16, "closed", { ticket: `github:${TICKET_REPO}#7`, approvals: "solo", ci: "failing", owner_kind: "owner" }), { started: stamp(190), ended: stamp(100), updated: stamp(100) }),
    item("task", 20, "working", { title: "Review PR #20 on studio-sandbox", agent: "mason", session: 56, started: stamp(12), updated: stamp(8) }),
  ];
}

/** The pending approval the parked PR #21 waits on: #7, naming `TICKET_REPO` PR 21, requested from its merge-item session (54). */
export function waitingMergeApproval(id = 7): Approval {
  return mergeApproval(id, { fields: { repo: TICKET_REPO, pr: 21, head_sha: HEAD_SHA.slice(0, 40) }, overrides: { requesting_session: 54 } });
}

/** The ticket tasks' sessions: the /automate run (51), the fix-now run (53), the merge-item run (54) and the live one of PR #22 (55). */
export function ticketSessions(): SessionSummary[] {
  return [
    summary(51, { agent: "ada", status: "completed", started: ago(160), ended: ago(130), tokens: 8120 }),
    summary(53, { agent: "ada", status: "completed", started: ago(100), ended: ago(90), tokens: 2400 }),
    summary(54, { agent: "ada", status: "completed", started: ago(45), ended: ago(40), tokens: 1900 }),
    summary(55, { agent: "ada", status: "running", started: ago(14), ended: null, tokens: 3300 }),
    summary(56, { agent: "mason", status: "running", started: ago(12), ended: null, tokens: 5310 }),
  ];
}

/** Each ticket session's log: the mockup's `SESS` lines as stored rows. */
export function ticketLogs(): Map<number, SessionOutputRow[]> {
  const rows = (sessionId: number, lines: readonly [SessionOutputKind, unknown, number][]): SessionOutputRow[] => lines.map(([kind, payload, minutes], i) => outputRow(sessionId, i + 1, kind, payload, ago(minutes)));
  return new Map([
    [51, rows(51, [["assistant_text", { text: "The retry loop never resets its counter after a success." }, 140], ["assistant_text", { text: "opened PR #21 · CI pending" }, 130]])],
    [53, rows(53, [["assistant_text", { text: "pushed a1b2c3d to the PR branch" }, 90]])],
    [54, rows(54, [["assistant_text", { text: "READY at 11:40. The repo policy is Approve in Studio, so the item parks as awaiting_merge." }, 42], ["assistant_text", { text: "approval #7 requested · parked" }, 40]])],
    [55, rows(55, [["assistant_text", { text: "opened PR #22 · CI pending" }, 5], ["assistant_text", { text: "waiting for CI" }, 1]])],
  ]);
}

/** The history of the parked PR's task, oldest first: the events the tracker writes, with sessions and a kind the app has no sentence for. */
export function ticketHistory(): EventFrame[] {
  const at = (minutes: number): string => stamp(minutes);
  const pr = { repo: TICKET_REPO, pr: 21, head_sha: HEAD_SHA };
  return [
    { type: "event", id: 301, at: at(160), kind: "task_created", session_id: null, task_id: WAITING_TICKET, payload: { title: "Add retry reset to the queue loop", state: "open" } },
    { type: "event", id: 302, at: at(159), kind: "session_started", session_id: 51, task_id: WAITING_TICKET, payload: { model: "sonnet" } },
    { type: "event", id: 303, at: at(130), kind: "pr_state_changed", session_id: null, task_id: WAITING_TICKET, payload: { ...pr, from: null, to: "open", approvals: 0, ci: "pending", owner_kind: "automate_live" } },
    { type: "event", id: 304, at: at(95), kind: "comment_routed", session_id: 53, task_id: WAITING_TICKET, payload: { route: "fix_now", note: "The counter is never reset" } },
    { type: "event", id: 305, at: at(60), kind: "pr_state_changed", session_id: null, task_id: WAITING_TICKET, payload: { ...pr, from: "open", to: "open", approvals: 0, ci: "green", owner_kind: "automate_live" } },
    { type: "event", id: 306, at: at(45), kind: "session_started", session_id: 54, task_id: WAITING_TICKET, payload: { model: "sonnet" } },
    { type: "event", id: 307, at: at(40), kind: "pr_state_changed", session_id: 54, task_id: WAITING_TICKET, payload: { ...pr, from: "open", to: "parked", approvals: 0, ci: "green", owner_kind: "automate_parked", reason: "awaiting_merge" } },
  ];
}

/** `ticketItems` served with their histories: the board, the waiting PR's history (events, sessions, its merge approval) and the logs. */
export function ticketInit(options: { readonly waiting?: boolean } = {}): TasksKernelInit {
  return {
    items: ticketItems(),
    sessions: ticketSessions(),
    output: ticketLogs(),
    approvals: options.waiting === false ? [] : [waitingMergeApproval()],
    events: new Map([[`task:${WAITING_TICKET}`, ticketHistory()]]),
    sessionsOf: new Map([[`task:${WAITING_TICKET}`, [51, 53]]]),
  };
}
