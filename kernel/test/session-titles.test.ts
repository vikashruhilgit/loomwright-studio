// Session and thread titles and thread figures (phase 8 item 17, Part 5:
// AC6, AC12). Titles are derived at read time by one module
// (`src/brain/titles.ts`) and carried by `GET /sessions`, `GET
// /tasks/:kind/:id` and `GET /threads/:agent`; the owner's rename (`POST
// /threads/:agent/:thread/rename`, stored in `brain_threads.title`) wins.
// A temp data dir and a real `Store`; rows are seeded with the real writers
// where they are cheap (`ensureBrainMessage`, `recordMessageThread`,
// `recordStartFresh`, `setContinuation`) and direct INSERTs for sessions,
// playbooks, tasks, approvals and agents. Routes are reached through
// `compileRoutePath` / `matchRoutePath`, as the API server reaches them.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryDir, threadSummaryRelativePath } from "../src/brain/memory.js";
import { ensureBrainMessage } from "../src/brain/messages.js";
import { recordMessageThread, recordStartFresh, setContinuation } from "../src/brain/threads.js";
import { CONTINUED_MARK, MAX_TITLE_CHARS, sessionTitle, threadTitle, titleLine } from "../src/brain/titles.js";
import { outputPart } from "../src/console/output.js";
import { readTokensOf, threadsPart } from "../src/console/threads.js";
import { compileRoutePath, matchRoutePath } from "../src/features/index.js";
import type { ContributedRoute, ContributedRouteResponse } from "../src/features/index.js";
import { tasksRoutes } from "../src/gui/tasks.js";
import { Store } from "../src/store/index.js";

const T0 = Date.UTC(2026, 10, 9, 8, 0, 0);
const at = (seconds: number): Date => new Date(T0 + seconds * 1000);

let tmp: string;
let store: Store;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "studio-session-titles-"));
  store = new Store({ dataDir: join(tmp, "data") });
});

afterEach(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

// ---- Seeding ------------------------------------------------------------------------

function addAgent(id: string): void {
  store.prepare("INSERT INTO agents (id, display_name, avatar_shape, avatar_hue, created_by, charter_json) VALUES (?, ?, 'crab', 'crew-teal', 'owner', '{}')").run(id, id);
}

function addSession(fields: { agent?: string; playbook?: number; task?: number; usage?: unknown } = {}): number {
  return Number(
    store
      .prepare("INSERT INTO sessions (agent, status, playbook, task_id, model_usage_json) VALUES (?, 'completed', ?, ?, ?)")
      .run(fields.agent ?? "wright", fields.playbook ?? null, fields.task ?? null, fields.usage === undefined ? null : JSON.stringify(fields.usage)).lastInsertRowid,
  );
}

let clock = 0;

/** One `brain_messages` row, answered by `session` with `reply` when given. */
function addMessage(fields: { agent?: string; text: string; source?: string; from?: string; session?: number; reply?: string }): number {
  const queueId = Number(store.prepare("INSERT INTO event_queue (kind, payload_json) VALUES ('message', '{}')").run().lastInsertRowid);
  const id = ensureBrainMessage(
    store,
    { queueId, agent: fields.agent ?? "wright", source: fields.source ?? (fields.from === undefined ? "ask" : `agent:${fields.from}`), text: fields.text, fromAgent: fields.from ?? null, depth: fields.from === undefined ? 0 : 1 },
    at(++clock),
  ).id;
  if (fields.session !== undefined) {
    store.prepare("UPDATE brain_messages SET session_id = ?, status = ?, reply_text = ? WHERE id = ?").run(fields.session, fields.reply === undefined ? "running" : "replied", fields.reply ?? null, id);
  }
  return id;
}

/** A reply in `thread`, continuing row `continues`. */
function addReply(thread: number, continues: number, fields: Parameters<typeof addMessage>[0]): number {
  const id = addMessage(fields);
  recordMessageThread(store, { messageId: id, threadId: thread, continues, references: [] }, at(clock));
  return id;
}

async function call(routes: readonly ContributedRoute[], method: string, pathWithQuery: string, body?: unknown): Promise<ContributedRouteResponse> {
  const url = new URL(pathWithQuery, "http://127.0.0.1");
  const parts = url.pathname.slice(1).split("/");
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchRoutePath(compileRoutePath(route.path), parts);
    if (params === undefined) continue;
    return route.handler({ params, query: Object.fromEntries(url.searchParams), body, store, now: () => at(1000) });
  }
  return { status: 404, body: { error: "no_route" } };
}

async function sessionsList(): Promise<Map<number, string>> {
  const res = await call(outputPart.routes, "GET", "/sessions?limit=200");
  expect(res.status).toBe(200);
  return new Map((res.body as { sessions: { id: number; title: string }[] }).sessions.map((s) => [s.id, s.title]));
}

const rename = (agent: string, thread: number, body: unknown): Promise<ContributedRouteResponse> => call(threadsPart.routes, "POST", `/threads/${agent}/${thread}/rename`, body);

interface Figures {
  readonly id: number;
  readonly agent: string;
  readonly title: string;
  readonly renamed: boolean;
  readonly messages: number;
  readonly latest_reply_tokens: number | null;
  readonly summary_estimated_tokens: number | null;
}

interface ThreadBody {
  readonly items: { type: string; id: number; thread_id?: number; continuation?: string | null; session_title?: string | null }[];
  readonly threads: Figures[];
}

async function threadPage(agent: string): Promise<ThreadBody> {
  const res = await call(threadsPart.routes, "GET", `/threads/${agent}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ThreadBody;
}

/** Every start kind of AC12, seeded once: the session ids and the title each must carry. */
function seedEveryKind(): { readonly expected: ReadonlyArray<readonly [string, number, string]>; readonly chatThread: number; readonly chatReplySession: number; readonly freshSession: number } {
  addAgent("mason");
  const chatSession = addSession();
  const chat = addMessage({ text: "  Ship the release notes  \nwith the changelog", session: chatSession, reply: "on it" });
  const chatReplySession = addSession();
  addReply(chat, chat, { text: "and tag v2", session: chatReplySession, reply: "tagged" });
  const crewSession = addSession({ agent: "mason" });
  addMessage({ agent: "mason", text: "Review PR 12 today", session: crewSession, reply: "done" });
  const longSession = addSession();
  addMessage({ text: "x".repeat(200), session: longSession });
  const playbook = Number(store.prepare("INSERT INTO playbooks (slug, name, owning_agent, intent) VALUES ('daily-digest', 'Daily digest', 'wright', 'do it')").run().lastInsertRowid);
  const playbookSession = addSession({ playbook });
  const delegationSession = addSession({ agent: "mason" });
  addMessage({ agent: "mason", from: "wright", text: "Check the build\nthen report", session: delegationSession });
  const trigger = Number(
    store.prepare("INSERT INTO triggers (owning_agent, kind, spec_json, action, action_payload, created_by) VALUES ('wright', 'once', '{}', 'wake_agent', 'Morning check-in', 'owner')").run().lastInsertRowid,
  );
  const triggerSession = addSession();
  addMessage({ source: `trigger:${trigger}`, text: "Morning check-in", session: triggerSession });
  const approval = Number(store.prepare("INSERT INTO approvals (requesting_agent, action, payload_json) VALUES ('wright', 'open_pr', '{}')").run().lastInsertRowid);
  const approvalSession = addSession();
  addMessage({ source: `approval:${approval}`, text: "The owner approved.", session: approvalSession });
  const freshSession = addSession();
  const fresh = addMessage({ text: "Continue from the summary of thread above.", session: freshSession });
  expect(recordStartFresh(store, { messageId: fresh, from: chat, agent: "wright" }, at(clock))).toBe(true);
  const task = Number(store.prepare("INSERT INTO tasks (title, state) VALUES ('Fix flaky test', 'working')").run().lastInsertRowid);
  const taskSession = addSession({ task });
  const bareSession = addSession();
  return {
    chatThread: chat,
    chatReplySession,
    freshSession,
    expected: [
      ["Chat message: its first line, trimmed", chatSession, "Ship the release notes"],
      ["a reply: the thread's title", chatReplySession, "Ship the release notes"],
      ["Crew message: its first line", crewSession, "Review PR 12 today"],
      ["a long first line: cut to the limit with an ellipsis", longSession, `${"x".repeat(MAX_TITLE_CHARS - 1)}…`],
      ["a playbook run: the playbook's name, not its id", playbookSession, "Daily digest"],
      ["a delegation: From <agent>: <first line>", delegationSession, "From wright: Check the build"],
      ["a trigger with no playbook: its label", triggerSession, `Trigger #${trigger}: Morning check-in`],
      ["an approval with no playbook: its label and action", approvalSession, `Approval #${approval}: open_pr`],
      ["a fresh thread from a summary: the old title marked continued", freshSession, `Ship the release notes${CONTINUED_MARK}`],
      ["a task's session: the task's title", taskSession, "Fix flaky test"],
      ["a session with nothing to name it: its id, labelled", bareSession, `Session #${bareSession}`],
    ],
  };
}

// ---- AC12: titles ----------------------------------------------------------------------

describe("session titles (AC12): one derivation, read time only", () => {
  it("titles every start kind, the same through sessionTitle and GET /sessions, never 'ad hoc session' or a bare id", async () => {
    const { expected } = seedEveryKind();
    const listed = await sessionsList();
    for (const [kind, session, title] of expected) {
      expect(sessionTitle(store, session), kind).toBe(title);
      expect(listed.get(session), kind).toBe(title);
    }
    for (const title of listed.values()) {
      expect(title).not.toMatch(/ad hoc session/i);
      expect(title).not.toMatch(/^(playbook #?)?\d+$/i);
      expect(title).not.toMatch(/[\n\r]/);
    }
  });

  it("GET /tasks/:kind/:id carries the same title on each session", async () => {
    const { expected } = seedEveryKind();
    for (const [kind, session, title] of expected) {
      const res = await call(tasksRoutes, "GET", `/tasks/session/${session}`);
      expect(res.status, kind).toBe(200);
      expect((res.body as { sessions: { id: number; title: string }[] }).sessions, kind).toEqual([expect.objectContaining({ id: session, title })]);
    }
  });

  it("GET /threads/:agent: each message item carries its session's title, and each thread its title", async () => {
    const { chatThread } = seedEveryKind();
    const body = await threadPage("wright");
    const chatItems = body.items.filter((i) => i.type === "message" && i.thread_id === chatThread);
    expect(chatItems.map((i) => i.session_title)).toEqual(["Ship the release notes", "Ship the release notes"]);
    expect(body.threads.find((t) => t.id === chatThread)).toMatchObject({ title: "Ship the release notes", renamed: false });
    const unstarted = addMessage({ text: "not yet" });
    expect((await threadPage("wright")).items.find((i) => i.id === unstarted)?.session_title).toBeNull();
  });

  it("one line: control and bidi characters stripped, whitespace collapsed, the first non-blank line", () => {
    expect(titleLine("\n\n  \tDeploy\u0007 the\u202e app\u0000 \nsecond")).toBe("Deploy the app");
    expect(titleLine("\u2028\u2029")).toBe("");
    const s = addSession();
    addMessage({ text: "\u0000\n\t", session: s });
    expect(sessionTitle(store, s)).toMatch(/^Message #\d+$/);
  });

  it("damaged rows never throw or loop: a continued_from cycle stops, a stored title with a newline reads as one line, a cut never splits a surrogate pair", () => {
    const a = addMessage({ text: "Alpha" });
    const b = addMessage({ text: "Beta" });
    store.prepare("INSERT INTO brain_threads (id, agent, continued_from) VALUES (?, 'wright', ?), (?, 'wright', ?)").run(a, b, b, a);
    expect(threadTitle(store, a)).toMatch(/^(Alpha|Beta)( \(continued\))?$/);
    store.prepare("UPDATE brain_threads SET title = ? WHERE id = ?").run("\n\u001b[31mRed\u202e\nsecond", a);
    expect(threadTitle(store, a)).toBe("[31mRed");
    const cut = titleLine(`${"a".repeat(MAX_TITLE_CHARS - 2)}\u{1F600}tail`);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(/[\uD800-\uDBFF]…$/.test(cut)).toBe(false);
  });

  it("no start path writes a title: sessions and brain_threads hold none until the owner renames", () => {
    seedEveryKind();
    expect(store.prepare("SELECT name FROM pragma_table_info('sessions') WHERE name = 'title'").all()).toEqual([]);
    expect(store.prepare("SELECT count(*) FROM brain_threads WHERE title IS NOT NULL").pluck().get()).toBe(0);
  });
});

describe("POST /threads/:agent/:thread/rename (AC12): the owner's rename wins", () => {
  it("wins over the derived title on the thread, its reply's session and the fresh thread's continued mark; null clears it", async () => {
    const { chatThread, chatReplySession, freshSession } = seedEveryKind();
    const events = store.prepare("SELECT count(*) FROM events").pluck().get();
    const queued = store.prepare("SELECT count(*) FROM event_queue").pluck().get();
    const res = await rename("wright", chatThread, { title: "Release\u202e notes\n\tv2" });
    expect(res).toEqual({ status: 200, body: { thread: chatThread, title: "Release notes v2", renamed: true } });
    expect(store.prepare("SELECT title FROM brain_threads WHERE id = ?").pluck().get(chatThread)).toBe("Release notes v2");
    expect(threadTitle(store, chatThread)).toBe("Release notes v2");
    expect(sessionTitle(store, chatReplySession)).toBe("Release notes v2");
    expect(sessionTitle(store, freshSession)).toBe(`Release notes v2${CONTINUED_MARK}`);
    expect((await sessionsList()).get(chatReplySession)).toBe("Release notes v2");
    expect((await threadPage("wright")).threads.find((t) => t.id === chatThread)).toMatchObject({ title: "Release notes v2", renamed: true });
    // An owner metadata edit: no event, nothing queued, no session.
    expect(store.prepare("SELECT count(*) FROM events").pluck().get()).toBe(events);
    expect(store.prepare("SELECT count(*) FROM event_queue").pluck().get()).toBe(queued);

    expect(await rename("wright", chatThread, { title: null })).toEqual({ status: 200, body: { thread: chatThread, title: "Ship the release notes", renamed: false } });
    expect(sessionTitle(store, chatReplySession)).toBe("Ship the release notes");
  });

  it("renames a thread with no thread data yet (its brain_threads row is created)", async () => {
    const s = addSession();
    const only = addMessage({ text: "first", session: s });
    expect((await rename("wright", only, { title: "Named" })).status).toBe(200);
    expect(sessionTitle(store, s)).toBe("Named");
    expect(store.prepare("SELECT agent FROM brain_threads WHERE id = ?").pluck().get(only)).toBe("wright");
  });

  it("refuses a body without a title, a blank or over-long title, another agent's thread and a row inside a thread", async () => {
    addAgent("mason");
    const s = addSession();
    const thread = addMessage({ text: "first", session: s });
    const reply = addReply(thread, thread, { text: "second" });
    const masons = addMessage({ agent: "mason", text: "hers" });
    expect(await rename("wright", thread, {})).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    expect(await rename("wright", thread, ["x"])).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    expect(await rename("wright", thread, { title: 7 })).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    expect(await rename("wright", thread, { title: " \u0007\n " })).toMatchObject({ status: 400, body: { error: "invalid_body", message: "title must not be blank" } });
    const long = await rename("wright", thread, { title: "y".repeat(MAX_TITLE_CHARS + 1) });
    expect(long).toMatchObject({ status: 400, body: { error: "invalid_body" } });
    expect((long.body as { message: string }).message).toContain(`${MAX_TITLE_CHARS + 1} characters; the bound is ${MAX_TITLE_CHARS}`);
    expect(await rename("wright", masons, { title: "mine" })).toMatchObject({ status: 404, body: { error: "no_such_thread" } });
    expect(await rename("wright", reply, { title: "mine" })).toMatchObject({ status: 404, body: { error: "no_such_thread" } });
    expect(await rename("nobody", thread, { title: "mine" })).toMatchObject({ status: 404, body: { error: "no_such_agent" } });
    expect(await rename("wright", 0, { title: "mine" })).toMatchObject({ status: 400, body: { error: "invalid_thread" } });
    expect(store.prepare("SELECT count(*) FROM brain_threads WHERE title IS NOT NULL").pluck().get()).toBe(0);
  });
});

// ---- AC6: thread fields and figures ----------------------------------------------------

describe("GET /threads/:agent thread fields and figures (AC6), in tokens", () => {
  it("each message item carries thread_id and continuation; each thread its message count, latest reply's read tokens and the summary estimate", async () => {
    const first = addSession({ usage: { "claude-sonnet-4-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 1, costUSD: 0.5 } } });
    const thread = addMessage({ text: "Plan the launch", session: first, reply: "plan" });
    const second = addSession({
      usage: {
        "claude-sonnet-4-5": { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 20, costUSD: 1.25 },
        "claude-haiku-4-5": { inputTokens: 3, outputTokens: 9, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      },
    });
    const reply = addReply(thread, thread, { text: "and the date?", session: second, reply: "Friday" });
    setContinuation(store, reply, "resumed", at(clock));
    // A newer row with no reply yet: the figure stays the newest REPLIED row's.
    const pending = addReply(thread, reply, { text: "and the venue?" });
    const plain = addMessage({ text: "unrelated" });

    let body = await threadPage("wright");
    const byId = new Map(body.items.filter((i) => i.type === "message").map((i) => [i.id, i]));
    expect(byId.get(thread)).toMatchObject({ thread_id: thread, continuation: null });
    expect(byId.get(reply)).toMatchObject({ thread_id: thread, continuation: "resumed" });
    expect(byId.get(pending)).toMatchObject({ thread_id: thread, continuation: null });
    expect(byId.get(plain)).toMatchObject({ thread_id: plain, continuation: null });
    expect(body.threads).toEqual([
      { id: thread, agent: "wright", title: "Plan the launch", renamed: false, messages: 3, latest_reply_tokens: 1123, summary_estimated_tokens: null },
      { id: plain, agent: "wright", title: "unrelated", renamed: false, messages: 1, latest_reply_tokens: null, summary_estimated_tokens: null },
    ]);
    // Tokens only (D24): no cost or dollar figure anywhere in the figures.
    expect(JSON.stringify(body.threads)).not.toMatch(/cost|usd|\$/i);

    const file = join(memoryDir(store.dataDir), threadSummaryRelativePath("wright", thread));
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "0123456789");
    body = await threadPage("wright");
    expect(body.threads.find((t) => t.id === thread)?.summary_estimated_tokens).toBe(3);
  });

  it("reads input + cache-read + cache-write (never output) from model_usage_json; null for none or damaged text", () => {
    expect(readTokensOf(JSON.stringify({ m: { inputTokens: 7, outputTokens: 1000, cacheReadInputTokens: 2, cacheCreationInputTokens: 1 } }))).toBe(10);
    expect(readTokensOf(JSON.stringify({ m: { inputTokens: -5, cacheReadInputTokens: "9", cacheCreationInputTokens: Number.NaN }, n: null }))).toBe(0);
    expect(readTokensOf(null)).toBeNull();
    expect(readTokensOf("not json")).toBeNull();
    expect(readTokensOf("[1,2]")).toBeNull();
  });
});
