// Thread continuity's canned kernel (phase 8 item 17c), for
// `app/e2e/chat-threads.spec.ts`: Wright and one crew member (Pim), each with
// threads as 17b's kernel answers them (`thread_id`, `continuation`,
// `session_title` on each message; `threads` figures and the size hint on the
// page), and the four thread routes. Writes are recorded. As the kernel does,
// `POST /ask` appends a `queued` row (joined to the thread its `continues`
// names), start-fresh starts a new thread from the summary, and rename sets
// the thread's title and marks it the owner's.
//
// Every string here stands in for untrusted kernel text; the summary holds
// markup on purpose, to show it renders inert.
import type {
  AgentDetailResponse,
  AskBody,
  BrainMessage,
  RosterEntry,
  SessionSummary,
  ThreadFigures,
  ThreadItem,
  ThreadMessageFields,
  ThreadRenameResponse,
  ThreadResponse,
  ThreadStartFreshResponse,
  ThreadSummarizeResponse,
  ThreadSummaryResponse,
} from "../../src/api/contract";
import type { FixtureKernelOptions, FixtureRequest } from "../fixture-kernel";
import { rosterEntry } from "./chat";

export interface RecordedWrite {
  /** The route, as in `CONTRACT_ROUTES` (`/threads/:agent/:thread/rename`). */
  readonly route: string;
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface ChatThreadsFixture {
  readonly options: FixtureKernelOptions;
  /** Every `POST /ask` body, in order. */
  readonly asks: AskBody[];
  /** Every thread-route write, in order. */
  readonly writes: RecordedWrite[];
}

type Message = Extract<ThreadItem, { readonly type: "message" }>;

const AT = (minute: number): string => `2026-11-10T08:${String(minute).padStart(2, "0")}:00.000Z`;

export const SUMMARY = [
  "## Decisions",
  "- Ship the release on Friday, from main at the tagged commit.",
  "- The changelog lists every merged PR since v1.4.",
  "## Open",
  "- Who signs the build: the owner, by hand.",
  "Kept as text: <img src=x onerror=alert(1)>",
].join("\n");

function row(id: number, agent: string, thread: number, text: string, reply: string | null, overrides: Partial<BrainMessage & ThreadMessageFields> = {}): Message {
  return {
    type: "message",
    id,
    queue_id: id,
    agent,
    source: "ask",
    text,
    status: reply === null ? "queued" : "replied",
    session_id: reply === null ? null : id + 100,
    reply_text: reply,
    detail: null,
    created_at: AT(id % 60),
    updated_at: AT((id % 60) + 1),
    from_agent: null,
    depth: 0,
    reply_to: null,
    workspace: null,
    thread_id: thread,
    continuation: null,
    session_title: null,
    ...overrides,
  };
}

export function chatThreadsFixture(): ChatThreadsFixture {
  const asks: AskBody[] = [];
  const writes: RecordedWrite[] = [];
  const roster: RosterEntry[] = [rosterEntry("wright", "Wright", "whale", "accent"), rosterEntry("pim", "Pim", "octopus", "crew-teal")];
  const workspaces: Record<string, readonly string[] | null> = { wright: null, pim: ["~/work/site"] };

  const items: Record<string, Message[]> = {
    wright: [
      row(4, "wright", 4, "Plan the v1.5 release.", "Here is the plan: freeze Thursday, tag Friday, publish the changelog.", { session_title: "Plan the v1.5 release" }),
      row(6, "wright", 4, "Who signs the build?", "You do, by hand: the signing key stays on your machine.", { continuation: "resumed", session_title: "Plan the v1.5 release" }),
      row(8, "wright", 8, "What changed overnight?", "Two PRs merged and one review is waiting on you.", { session_title: "What changed overnight?" }),
    ],
    pim: [row(90, "pim", 90, "Skip the docs-only PRs this week.", "Done. I'll note it in my handoff.", { continuation: "replayed", session_title: "Skip the docs-only PRs this week" })],
  };
  const figures: Record<string, ThreadFigures[]> = {
    wright: [
      { id: 4, agent: "wright", title: "Plan the v1.5 release", renamed: false, messages: 4, latest_reply_tokens: 52000, summary_estimated_tokens: null },
      { id: 8, agent: "wright", title: "What changed overnight?", renamed: false, messages: 2, latest_reply_tokens: 3100, summary_estimated_tokens: 420 },
    ],
    pim: [{ id: 90, agent: "pim", title: "Skip the docs-only PRs this week", renamed: false, messages: 2, latest_reply_tokens: 1800, summary_estimated_tokens: null }],
  };
  const hints: Record<string, number | null> = { wright: 40000, pim: null };
  const summaries = new Map<string, string>();
  let nextId = 200;

  const record = (route: string, req: FixtureRequest): void => {
    writes.push({ route, params: req.params, body: req.body });
  };
  const fileOf = (agent: string, thread: number): string => `memory/${agent}/threads/${thread}.md`;

  const sessions = (): SessionSummary[] =>
    Object.values(items)
      .flat()
      .filter((m) => m.session_id !== null)
      .map((m) => ({
        id: m.session_id as number,
        agent: m.agent,
        status: "ended",
        model: "sonnet",
        started: m.created_at,
        ended: m.updated_at,
        tokens: 1000,
        cwd: null,
        playbook: null,
        title: figures[m.agent]?.find((f) => f.id === m.thread_id)?.title ?? `Session #${String(m.session_id)}`,
      }));

  const options: FixtureKernelOptions = {
    routes: {
      "GET /agents": () => ({ status: 200, body: { agents: roster } }),
      "GET /agents/:id": (req) => {
        const agent = roster.find((a) => a.id === req.params.id);
        if (agent === undefined) return { status: 404, body: { error: "not_found" } };
        const body: AgentDetailResponse = {
          agent,
          settings: { file: `config/agents/${agent.id}.json`, content: {}, error: null },
          never: null,
          workspaces: workspaces[agent.id] ?? null,
          memory: { dir: `memory/${agent.id}`, files: [] },
          charter: {},
        };
        return { status: 200, body };
      },
      "GET /threads/:agent": (req) => {
        const agent = req.params.agent ?? "";
        const list = items[agent];
        if (list === undefined) return { status: 404, body: { error: "no_such_agent" } };
        const body: ThreadResponse = { items: list, next_before: null, pending_approvals: [], threads: figures[agent] ?? [], thread_summarize_hint_tokens: hints[agent] ?? null };
        return { status: 200, body };
      },
      "GET /messages": () => ({ status: 200, body: { messages: Object.values(items).flat().map(({ type: _type, thread_id: _t, continuation: _c, session_title: _s, ...m }) => m) } }),
      "GET /approvals": () => ({ status: 200, body: { approvals: [] } }),
      "GET /playbooks": () => ({ status: 200, body: { playbooks: [] } }),
      "GET /triggers": () => ({ status: 200, body: { triggers: [] } }),
      "GET /notifications": () => ({ status: 200, body: { notifications: [] } }),
      "GET /sessions": () => ({ status: 200, body: { sessions: sessions() } }),
      "POST /ask": (req) => {
        const body = req.body as AskBody | undefined;
        if (body === undefined || typeof body.text !== "string" || body.text.trim() === "") return { status: 400, body: { error: "invalid_body" } };
        const agent = body.agent ?? "wright";
        const list = items[agent];
        if (list === undefined) return { status: 404, body: { error: "no_such_agent" } };
        asks.push(body);
        nextId += 1;
        const continued = body.continues === undefined ? undefined : list.find((m) => m.id === body.continues);
        if (body.continues !== undefined && continued === undefined) return { status: 409, body: { error: "continues_invalid", reason: "no_such_message", continues: body.continues } };
        const thread = continued?.thread_id ?? nextId;
        list.push(row(nextId, agent, thread, body.text, null, { created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
        const f = figures[agent] ?? [];
        const existing = f.findIndex((x) => x.id === thread);
        if (existing >= 0) f[existing] = { ...f[existing]!, messages: f[existing]!.messages + 1 };
        else f.push({ id: thread, agent, title: body.text.split("\n")[0] ?? "", renamed: false, messages: 1, latest_reply_tokens: null, summary_estimated_tokens: null });
        return { status: 202, body: { message_id: nextId, queue_id: nextId } };
      },
      "POST /threads/:agent/:thread/summarize": (req) => {
        record("/threads/:agent/:thread/summarize", req);
        const agent = req.params.agent ?? "";
        const thread = Number(req.params.thread);
        summaries.set(`${agent} ${thread}`, SUMMARY);
        const body: ThreadSummarizeResponse = { message_id: 300, queue_id: 300, thread, file: fileOf(agent, thread) };
        return { status: 202, body };
      },
      "GET /threads/:agent/:thread/summary": (req) => {
        const agent = req.params.agent ?? "";
        const thread = Number(req.params.thread);
        const text = summaries.get(`${agent} ${thread}`);
        if (text === undefined) return { status: 404, body: { error: "no_summary", file: fileOf(agent, thread) } };
        const body: ThreadSummaryResponse = { thread, file: fileOf(agent, thread), text, truncated: null };
        return { status: 200, body };
      },
      "POST /threads/:agent/:thread/start-fresh": (req) => {
        record("/threads/:agent/:thread/start-fresh", req);
        const agent = req.params.agent ?? "";
        const from = Number(req.params.thread);
        const list = items[agent] ?? [];
        const old = figures[agent]?.find((f) => f.id === from);
        nextId += 1;
        list.push(row(nextId, agent, nextId, "Continue from the summary.", null, { created_at: new Date().toISOString(), updated_at: new Date().toISOString() }));
        figures[agent]?.push({ id: nextId, agent, title: `${old?.title ?? `Thread #${from}`} (continued)`, renamed: false, messages: 1, latest_reply_tokens: null, summary_estimated_tokens: 110 });
        const body: ThreadStartFreshResponse = { message_id: nextId, queue_id: nextId, thread: nextId, from, file: fileOf(agent, from) };
        return { status: 202, body };
      },
      "POST /threads/:agent/:thread/rename": (req) => {
        record("/threads/:agent/:thread/rename", req);
        const agent = req.params.agent ?? "";
        const thread = Number(req.params.thread);
        const list = figures[agent] ?? [];
        const at = list.findIndex((f) => f.id === thread);
        if (at < 0) return { status: 404, body: { error: "no_such_thread" } };
        const title = (req.body as { title?: unknown } | undefined)?.title;
        const renamed = typeof title === "string" && title.trim() !== "";
        const derived = items[agent]?.find((m) => m.id === thread)?.text.split("\n")[0] ?? `Thread #${thread}`;
        list[at] = { ...list[at]!, title: renamed ? title.trim() : derived, renamed };
        const body: ThreadRenameResponse = { thread, title: list[at]!.title, renamed };
        return { status: 200, body };
      },
    },
  };
  return { options, asks, writes };
}
