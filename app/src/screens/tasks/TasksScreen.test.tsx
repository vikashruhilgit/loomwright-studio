/// <reference types="node" />
// @vitest-environment jsdom
// The Tasks screen over a scriptable bridge (`../../store/fake-bridge`): the
// bridge guard, the four columns and honest badges, the empty state, the open
// card (facts, history, the session's log read after the last seq), Stop and
// Kill, the ⌘K commands, the live refetch, the kernel going away, the keys, and
// the token-only stylesheet.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import type {
  ApiRequest,
  ApiResult,
  EventFrame,
  RosterEntry,
  SessionOutputRow,
  SessionSummary,
  StudioBridge,
  TaskBoardGroup,
  TaskBoardItem,
  TaskHistoryResponse,
} from "../../api/contract";
import { installKeyboardMap } from "../../commands/keyboard";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { screen as tasksScreen } from "./index";
import { EMPTY_TITLE } from "./TasksViews";
import { TASKS_COMMANDS, TASKS_OWNER, TasksScreen } from "./TasksScreen";

const ESC = "\u001b";
const RLO = "‮";
const OUTPUT = "GET /sessions/:id/output";
const TASKS = "GET /tasks";
const HISTORY = "GET /tasks/:kind/:id";

/** `minutes` ago, but never before today's midnight: every fixture card is "today", whenever the suite runs. */
function stamp(minutes: number): string {
  const midnight = new Date();
  midnight.setHours(0, 0, 1, 0);
  return new Date(Math.max(Date.now() - minutes * 60_000, midnight.getTime())).toISOString();
}

function card(kind: TaskBoardItem["kind"], id: number, state: string, overrides: Partial<TaskBoardItem> = {}): TaskBoardItem {
  return { kind, id, title: kind === "session" ? null : `Title ${id}`, state, agent: "mason", playbook: null, item_ref: null, session: null, tokens: null, started: stamp(30), ended: null, updated: stamp(5), ...overrides };
}

function summary(id: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return { id, agent: "mason", status: "running", model: "sonnet", started: stamp(20), ended: null, tokens: 1234, cwd: "/work", playbook: null, ...overrides };
}

function outRow(sessionId: number, seq: number, text = `line ${seq}`): SessionOutputRow {
  return { id: sessionId * 10_000 + seq, session_id: sessionId, seq, kind: "assistant_text", payload: { text }, created_at: stamp(1) };
}

function roster(id: string): RosterEntry {
  return {
    id,
    display_name: id,
    avatar: { shape: "octopus", hue: "crew-teal" },
    status: "active",
    created_by: null,
    approval_id: null,
    model: null,
    settings_error: null,
    tokens_today: 0,
    tokens_per_day: null,
    sessions_running: 0,
    sessions_at_once: null,
  };
}

/** The kernel's grouping: the page ordered newest first, then grouped by state in order of first appearance. */
function groupsOf(items: readonly TaskBoardItem[]): TaskBoardGroup[] {
  const sorted = [...items].sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : b.id - a.id));
  const groups: { state: string; items: TaskBoardItem[] }[] = [];
  for (const item of sorted) {
    const group = groups.find((g) => g.state === item.state);
    if (group === undefined) groups.push({ state: item.state, items: [item] });
    else group.items.push(item);
  }
  return groups;
}

interface Kernel {
  items: TaskBoardItem[];
  sessions: SessionSummary[];
  output: Map<number, SessionOutputRow[]>;
  events: Map<string, EventFrame[]>;
}

function board(): TaskBoardItem[] {
  return [
    card("task", 12, "waiting", { agent: "wright", title: "Pick the repos Mason reviews first", updated: stamp(40) }),
    card("session", 39, "failed:auth", { agent: "ada", ended: stamp(30), updated: stamp(30) }),
    card("task", 9, "working", { title: "Review PR #3", session: 41, updated: stamp(2) }),
    card("playbook_run", 18, "running", { agent: "ada", title: "Weekly changelog draft", playbook: 2, session: 42, tokens: 4210, updated: stamp(3) }),
    card("session", 44, "running", { agent: "wright", updated: stamp(4) }),
    card("task", 7, "parked", { title: "Check for new PRs", updated: stamp(50) }),
    card("session", 38, "interrupted", { agent: "ada", ended: stamp(60), updated: stamp(60) }),
    card("task", 5, "done", { title: "Review PR #2", updated: stamp(70) }),
    card("playbook_run", 16, "failed", { title: "Review PRs", playbook: 1, ended: stamp(80), updated: stamp(80) }),
    card("session", 40, "stopped", { ended: stamp(90), updated: stamp(90) }),
  ];
}

function history(kernel: Kernel, req: ApiRequest): ApiResult<unknown> {
  const kind = String(req.params?.kind);
  const id = Number(req.params?.id);
  const item = kernel.items.find((i) => i.kind === kind && i.id === id);
  if (item === undefined) return { ok: false, status: 404, body: { error: "not_found" } };
  const sessionIds = item.kind === "session" ? [item.id] : item.session === null ? [] : [item.session];
  const body: TaskHistoryResponse = {
    item,
    events: kernel.events.get(`${kind}:${id}`) ?? [],
    runs: [],
    sessions: kernel.sessions.filter((s) => sessionIds.includes(s.id)),
    approvals: [],
  };
  return ok(body);
}

function setApi(api: StudioBridge | undefined): void {
  if (api === undefined) delete (window as unknown as { api?: StudioBridge }).api;
  else (window as unknown as { api?: StudioBridge }).api = api;
}

interface Mounted {
  readonly fake: FakeBridge;
  readonly kernel: Kernel;
  readonly registry: CommandRegistry;
  unmount(): void;
}

async function mount(initial: Partial<Kernel> = {}, registry: CommandRegistry = createCommandRegistry(), connection?: FakeBridge["connectionAnswer"]): Promise<Mounted> {
  const kernel: Kernel = { items: board(), sessions: [summary(41), summary(42), summary(44, { agent: "wright" })], output: new Map(), events: new Map(), ...initial };
  const fake = fakeBridge(connection);
  fake.route(TASKS, () => ok({ groups: groupsOf(kernel.items), next_before: null }));
  fake.route(HISTORY, (req) => history(kernel, req));
  fake.route("GET /agents", () => ok({ agents: [roster("mason"), roster("ada"), roster("wright")] }));
  fake.route("GET /status", () => ok({}));
  fake.route(OUTPUT, (req) => {
    const id = Number(req.params?.id);
    const after = Number(req.query?.after ?? "0");
    return ok({ rows: (kernel.output.get(id) ?? []).filter((r) => r.seq > after) });
  });
  setApi(fake.bridge);
  const view = render(<TasksScreen api={fake.bridge} registry={registry} />);
  await waitFor(() => expect(screen.getByTestId("screen-tasks").dataset.state).not.toBe("loading"));
  return { fake, kernel, registry, unmount: view.unmount };
}

let eventId = 0;
function event(kind: string, sessionId: number | null = null, taskId: number | null = null): EventFrame {
  eventId += 1;
  return { type: "event", id: eventId, at: new Date().toISOString(), kind, session_id: sessionId, task_id: taskId, payload: {} };
}

function reads(fake: FakeBridge, key: string): ApiRequest[] {
  return fake.requestsTo(key).map((r) => r.req);
}

function cardEl(key: string): HTMLElement {
  return screen.getByTestId(`task-card-${key}`);
}

function column(id: string): HTMLElement {
  return screen.getByTestId(`tasks-col-${id}`);
}

function keysIn(id: string): string[] {
  return within(column(id))
    .queryAllByRole("button")
    .map((b) => b.getAttribute("data-card-key") ?? "");
}

async function openCard(key: string): Promise<void> {
  await act(async () => {
    fireEvent.click(cardEl(key));
  });
  await waitFor(() => expect(screen.getByTestId("task-detail")).toBeTruthy());
}

afterEach(() => {
  cleanup();
  setApi(undefined);
  window.location.hash = "";
});

describe("the bridge guard", () => {
  it("with no window.api, renders a plain state and throws nothing", () => {
    setApi(undefined);
    const Component = tasksScreen.Component;
    expect(() => render(<Component />)).not.toThrow();
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("no-bridge");
    expect(screen.getByText("This window has no connection to the kernel, so there is nothing to show.")).toBeTruthy();
  });

  it("keeps the shell's screen definition", () => {
    expect(tasksScreen.id).toBe("tasks");
    expect(tasksScreen.title).toBe("Tasks");
    expect(tasksScreen.nav).toEqual({ label: "Tasks", order: 6, shortcut: "⌘6" });
  });
});

describe("the board", () => {
  it("shows the cards in the mockup's four columns, each a labelled region, in its order", async () => {
    await mount();
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"));
    expect(regions).toHaveLength(4);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Waiting on you", "Working", "Parked", "Done today"]);
    expect(screen.getByRole("region", { name: "Waiting on you" })).toBe(column("wait"));
    expect(keysIn("wait").sort()).toEqual(["session:39", "task:12"]);
    expect(keysIn("work").sort()).toEqual(["playbook_run:18", "session:44", "task:9"]);
    expect(keysIn("park").sort()).toEqual(["session:38", "task:7"]);
    expect(keysIn("done").sort()).toEqual(["playbook_run:16", "session:40", "task:5"]);
  });

  it("names every card button: kind, id, title and state, as the mockup's aria-label", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Task 12: Pick the repos Mason reviews first, waiting" })).toBe(cardEl("task:12"));
    expect(screen.getByRole("button", { name: "Playbook run 18: Weekly changelog draft, running" })).toBe(cardEl("playbook_run:18"));
    expect(screen.getByRole("button", { name: "Session 39: ada · ad hoc session, failed:auth" })).toBe(cardEl("session:39"));
  });

  it("is green only for task done, run done and session completed, and shows every state as the kernel's word", async () => {
    const items = [...board(), card("session", 31, "completed", { ended: stamp(95), updated: stamp(95) }), card("playbook_run", 17, "done", { ended: stamp(96), updated: stamp(96) }), card("task", 50, "Waiting On Review")];
    await mount({ items });
    const tone = (key: string): string | null => within(cardEl(key)).getByTestId("task-card-state").querySelector(".badge")?.getAttribute("data-tone") ?? null;
    const word = (key: string): string => within(cardEl(key)).getByTestId("task-card-state").textContent ?? "";
    const green = [...document.querySelectorAll<HTMLElement>("[data-card-key]")].filter((b) => tone(b.dataset.cardKey ?? "") === "ok").map((b) => b.dataset.cardKey);
    expect(green.sort()).toEqual(["playbook_run:17", "session:31", "task:5"]);
    expect(tone("playbook_run:16")).toBe("danger");
    expect(tone("session:39")).toBe("danger");
    expect(tone("session:40")).toBe("neutral");
    // An unknown task state: Working, neutral, and the kernel's own words (not lower-cased).
    expect(word("task:50")).toBe("Waiting On Review");
    expect(tone("task:50")).toBe("neutral");
    expect(keysIn("work")).toContain("task:50");
  });

  it("leaves a terminal card that ended before today off the board, and keeps an old parked one", async () => {
    const yesterday = new Date(Date.now() - 36 * 3_600_000).toISOString();
    await mount({ items: [...board(), card("session", 30, "completed", { ended: yesterday, updated: yesterday }), card("task", 3, "parked", { updated: yesterday })] });
    expect(screen.queryByTestId("task-card-session:30")).toBeNull();
    expect(keysIn("park")).toContain("task:3");
  });

  it("shows the attention band with the count while Waiting on you is not empty, and the subtitle counts", async () => {
    await mount();
    expect(screen.getByTestId("tasks-attention-band").textContent).toBe("2 things wait on you.");
    expect(screen.getByTestId("tasks-subtitle").textContent).toBe("10 cards · 3 working");
    expect(column("wait").className).toContain("tasks-col-wait");
    expect(cardEl("task:12").className).toContain("tasks-card-wait");
  });

  it("has no attention band and says so in the column when nothing waits", async () => {
    await mount({ items: board().filter((i) => i.state !== "waiting" && i.state !== "failed:auth") });
    expect(screen.queryByTestId("tasks-attention-band")).toBeNull();
    expect(within(column("wait")).getByText("Nothing waits on you.")).toBeTruthy();
    expect(column("wait").className).not.toContain("tasks-col-wait");
  });

  it("explains only failed:auth, as paused on the token", async () => {
    await mount();
    expect(within(cardEl("session:39")).getByText("Paused: the subscription token was refused.")).toBeTruthy();
    expect(within(cardEl("task:12")).queryByText(/Paused/)).toBeNull();
  });

  it("shows every untrusted string escaped", async () => {
    await mount({ items: [card("task", 1, "working", { title: `Pick${ESC}[31m${RLO}`, agent: `ma${RLO}son` })] });
    const el = cardEl("task:1");
    expect(el.textContent).toContain("Pick\\x1b[31m\\u202e");
    expect(el.getAttribute("aria-label")).toBe("Task 1: Pick\\x1b[31m\\u202e, working");
    // eslint-disable-next-line no-control-regex
    expect(document.body.textContent).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮]/);
  });

  it("reads GET /tasks once with the largest page", async () => {
    const { fake } = await mount();
    expect(reads(fake, TASKS)).toHaveLength(1);
    expect(reads(fake, TASKS)[0]?.query).toEqual({ limit: "200" });
  });
});

describe("the empty and loading states", () => {
  it("shows the designed empty state when there are no rows, never an empty board", async () => {
    await mount({ items: [] });
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("empty");
    expect(screen.getByRole("heading", { name: EMPTY_TITLE })).toBeTruthy();
    expect(EMPTY_TITLE).toBe("No tasks yet.");
    expect(screen.getByText(/A task appears here when Wright or a crew member takes on work/)).toBeTruthy();
    expect(screen.queryByTestId("tasks-board")).toBeNull();
    expect(screen.getByTestId("tasks-subtitle").textContent).toBe("0 tasks");
  });

  it("shows the empty state too when every row finished before today", async () => {
    const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
    await mount({ items: [card("task", 1, "done", { updated: old })] });
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("empty");
  });

  it("is loading (skeleton columns, a status line) until the first read answers", async () => {
    const fake = fakeBridge();
    let release: ((r: ApiResult<unknown>) => void) | undefined;
    fake.route(TASKS, () => new Promise((done) => (release = done)));
    render(<TasksScreen api={fake.bridge} registry={createCommandRegistry()} />);
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("loading");
    expect(screen.getByRole("status").textContent).toBe("Loading tasks");
    await act(async () => release?.(ok({ groups: [], next_before: null })));
    await waitFor(() => expect(screen.getByTestId("screen-tasks").dataset.state).toBe("empty"));
  });

  it("shows the designed error when the kernel refuses the first read, and Try again reads it again", async () => {
    const fake = fakeBridge();
    let answer: ApiResult<unknown> = { ok: false, status: 500, body: { error: "store_unreadable", message: `boom${ESC}` } };
    fake.route(TASKS, () => answer);
    render(<TasksScreen api={fake.bridge} registry={createCommandRegistry()} />);
    await waitFor(() => expect(screen.getByTestId("screen-tasks").dataset.state).toBe("error"));
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load tasks");
    expect(screen.getByTestId("tasks-error-detail").textContent).toBe("GET /tasks · 500 · store_unreadable · boom\\x1b");
    answer = ok({ groups: groupsOf(board()), next_before: null });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    await waitFor(() => expect(screen.getByTestId("screen-tasks").dataset.state).toBe("populated"));
  });

  it("treats a body that is not a board as a failed read, never as data", async () => {
    const fake = fakeBridge();
    fake.route(TASKS, () => ok({ nope: true }));
    render(<TasksScreen api={fake.bridge} registry={createCommandRegistry()} />);
    await waitFor(() => expect(screen.getByTestId("screen-tasks").dataset.state).toBe("error"));
  });
});

describe("the open card", () => {
  it("opens on click: its facts, its history (events) and its session's log through StreamingLog", async () => {
    const kernel: Partial<Kernel> = {
      output: new Map([[41, [outRow(41, 1), outRow(41, 2, `done${ESC}[31m`)]]]),
      events: new Map([
        [
          "task:9",
          [
            { type: "event", id: 1, at: "2026-10-30T12:00:00.000Z", kind: "task_created", session_id: null, task_id: 9, payload: { title: "Review PR #3" } },
            { type: "event", id: 2, at: "2026-10-30T12:05:00.000Z", kind: "draft_output_recorded", session_id: 41, task_id: 9, payload: {} },
          ],
        ],
      ]),
    };
    const { fake } = await mount(kernel);
    await openCard("task:9");
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("detail");
    expect(reads(fake, HISTORY)[0]?.params).toEqual({ kind: "task", id: 9 });
    await waitFor(() => expect(screen.getByTestId("task-history").textContent).toContain("History · 2"));
    expect(within(screen.getByTestId("task-history")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("task_created"),
      expect.stringContaining("draft_output_recorded"),
    ]);
    expect(screen.getByTestId("task-facts").textContent).toContain("Assignee");
    expect(screen.getByRole("heading", { level: 2, name: "Review PR #3" })).toBeTruthy();
    const log = await screen.findByRole("log", { name: "Session output" });
    await waitFor(() => expect(log.textContent).toContain("line 1"));
    expect(log.textContent).toContain("done\\x1b[31m");
    expect(reads(fake, OUTPUT).map((r) => [r.params?.id, r.query?.after])).toEqual([[41, "0"]]);
    expect(screen.getByTestId("task-log").getAttribute("data-session-id")).toBe("41");
  });

  it("shows the mockup's 'no log yet' note for a card with no session", async () => {
    await mount();
    await openCard("task:12");
    expect(screen.getByTestId("task-nolog").textContent).toContain("No session is attached to this task. Nothing has run for it, so there is no log yet.");
    expect(screen.queryByRole("log")).toBeNull();
  });

  it("opens with Enter on the focused card", async () => {
    await mount();
    cardEl("task:12").focus();
    // A button opens on Enter's click; fireEvent models the browser's own activation.
    await act(async () => {
      fireEvent.click(document.activeElement as HTMLElement);
    });
    expect(screen.getByTestId("task-detail").getAttribute("data-card-key")).toBe("task:12");
  });

  it("Back (and Esc) return to the board with focus on the card that opened it", async () => {
    await mount();
    await openCard("task:9");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("populated");
    expect(document.activeElement).toBe(cardEl("task:9"));

    await openCard("playbook_run:18");
    expect(document.activeElement).toBe(screen.getByTestId("task-detail"));
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("populated");
    expect(document.activeElement).toBe(cardEl("playbook_run:18"));
  });

  it("says a card is gone when the kernel answers 404, and Back still works", async () => {
    const { fake } = await mount();
    await openCard("task:7");
    fake.route(HISTORY, () => ({ ok: false, status: 404, body: { error: "not_found" } }));
    await act(async () => {
      fake.emit(event("task_updated", null, 7));
    });
    await waitFor(() => expect(screen.getByTestId("task-gone").textContent).toContain("Task #7 is no longer in the kernel's history"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("populated");
  });

  it("keeps the history it had when a later read fails", async () => {
    const { fake } = await mount({ events: new Map([["task:7", [{ type: "event", id: 1, at: "2026-10-30T12:00:00.000Z", kind: "task_created", session_id: null, task_id: 7, payload: {} }]]]) });
    await openCard("task:7");
    await waitFor(() => expect(screen.getByTestId("task-history").textContent).toContain("History · 1"));
    fake.route(HISTORY, () => ({ ok: false, status: 500, body: { error: "boom" } }));
    await act(async () => {
      fake.emit(event("task_updated", null, 7));
    });
    await waitFor(() => expect(screen.getByTestId("task-history-error").textContent).toContain("last read that answered"));
    expect(screen.getByTestId("task-history").textContent).toContain("History · 1");
  });
});

describe("a running session's log", () => {
  it("appends new rows when the feed announces session_output_appended for it, reading after the last seq", async () => {
    const { fake, kernel } = await mount({ output: new Map([[41, [outRow(41, 1), outRow(41, 2)]]]) });
    await openCard("task:9");
    const log = await screen.findByRole("log", { name: "Session output" });
    await waitFor(() => expect(log.textContent).toContain("line 2"));
    kernel.output.set(41, [outRow(41, 1), outRow(41, 2), outRow(41, 3, "fresh line")]);
    await act(async () => {
      fake.emit(event("session_output_appended", 41));
    });
    await waitFor(() => expect(log.textContent).toContain("fresh line"));
    expect(reads(fake, OUTPUT).map((r) => r.query?.after)).toEqual(["0", "2"]);
  });

  it("ignores output announced for another session", async () => {
    const { fake } = await mount({ output: new Map([[41, [outRow(41, 1)]]]) });
    await openCard("task:9");
    await screen.findByRole("log", { name: "Session output" });
    await act(async () => {
      fake.emit(event("session_output_appended", 99));
    });
    expect(reads(fake, OUTPUT)).toHaveLength(1);
  });
});

describe("live", () => {
  it("refetches GET /tasks on an event of any kind but session_output_appended, and moves the card", async () => {
    const { fake, kernel } = await mount();
    expect(keysIn("work")).toContain("task:9");
    expect(reads(fake, TASKS)).toHaveLength(1);

    kernel.items = kernel.items.map((i) => (i.id === 9 && i.kind === "task" ? { ...i, state: "done", updated: stamp(0) } : i));
    await act(async () => {
      fake.emit(event("task_updated", null, 9));
    });
    await waitFor(() => expect(keysIn("done")).toContain("task:9"));
    expect(keysIn("work")).not.toContain("task:9");
    expect(reads(fake, TASKS)).toHaveLength(2);

    await act(async () => {
      fake.emit(event("session_output_appended", 44));
    });
    expect(reads(fake, TASKS)).toHaveLength(2);
    await act(async () => {
      fake.emit(event("session_status", 44));
    });
    await waitFor(() => expect(reads(fake, TASKS)).toHaveLength(3));
  });

  it("keeps an unchanged card in the same element and place when another card moves (keyed by kind:id)", async () => {
    const { fake, kernel } = await mount();
    const parked = cardEl("task:7");
    kernel.items = kernel.items.map((i) => (i.id === 9 && i.kind === "task" ? { ...i, state: "done", updated: stamp(0) } : i));
    await act(async () => {
      fake.emit(event("task_updated", null, 9));
    });
    await waitFor(() => expect(keysIn("done")).toContain("task:9"));
    expect(cardEl("task:7")).toBe(parked);
  });
});

describe("the kernel going away", () => {
  it("keeps the last data with the cards disabled and the subtitle 'last known' when a read gets no answer, and never shows the empty state", async () => {
    const { fake } = await mount();
    fake.route(TASKS, () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }));
    await act(async () => {
      fake.emit(event("task_updated", null, 9));
    });
    await waitFor(() => expect(screen.getByTestId("tasks-subtitle").textContent).toBe("10 cards · 3 working · last known"));
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("populated");
    expect(screen.queryByTestId("tasks-empty")).toBeNull();
    expect(keysIn("work")).toContain("task:9");
    for (const el of document.querySelectorAll<HTMLElement>("[data-card-key]")) expect(el.getAttribute("aria-disabled")).toBe("true");
    // A disabled card does not open.
    await act(async () => {
      fireEvent.click(cardEl("task:9"));
    });
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("populated");
  });

  it("does the same when the bridge says the kernel is unreachable, without throwing", async () => {
    const { fake } = await mount({}, createCommandRegistry(), { state: "unreachable", reason: "daemon_not_running" });
    await waitFor(() => expect(screen.getByTestId("tasks-subtitle").textContent).toContain("last known"));
    expect(fake.requestsTo(TASKS).length).toBeGreaterThan(0);
    expect(keysIn("work")).toContain("task:9");
  });

  it("keeps the board and says the latest read failed when the kernel refuses a later read", async () => {
    const { fake } = await mount();
    fake.route(TASKS, () => ({ ok: false, status: 500, body: { error: "store_unreadable" } }));
    await act(async () => {
      fake.emit(event("task_updated", null, 9));
    });
    await waitFor(() => expect(screen.getByTestId("tasks-stale").textContent).toContain("GET /tasks · 500 · store_unreadable"));
    expect(keysIn("work")).toContain("task:9");
  });

  it("disables Stop and Kill in an open card's log, and Back still works", async () => {
    const { fake } = await mount();
    await openCard("task:9");
    await screen.findByRole("log", { name: "Session output" });
    expect(screen.getByRole("button", { name: /^Stop/ }).getAttribute("aria-disabled")).toBeNull();
    fake.route(TASKS, () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }));
    await act(async () => {
      fake.emit(event("task_updated", null, 9));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Stop/ }).getAttribute("aria-disabled")).toBe("true"));
    expect(screen.getByRole("button", { name: "Kill" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("tasks-subtitle").textContent).toBe("Task #9 · last known");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("populated");
  });
});

describe("Stop and Kill", () => {
  it("Stop posts /sessions/:id/stop and the status shown is the kernel's answer", async () => {
    const { fake, kernel } = await mount({ output: new Map([[41, [outRow(41, 1)]]]) });
    let answer: ((r: ApiResult<unknown>) => void) | undefined;
    fake.route("POST /sessions/:id/stop", () => new Promise((done) => (answer = done)));
    await openCard("task:9");
    await screen.findByRole("log", { name: "Session output" });
    await waitFor(() => expect(screen.getByTestId("task-log-status").textContent).toBe("running"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Stop/ }));
    });
    // In flight: never `stopped`.
    expect(screen.getByTestId("task-log-status").textContent).toBe("stopping…");
    // A second click while it is pending sends nothing.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Stop/ }));
    });
    expect(reads(fake, "POST /sessions/:id/stop").map((r) => r.params)).toEqual([{ id: 41 }]);
    kernel.sessions = kernel.sessions.map((s) => (s.id === 41 ? { ...s, status: "stopped", ended: stamp(0) } : s));
    await act(async () => answer?.(ok({ id: 41, status: "stopped", reason: "owner_stop" })));
    await waitFor(() => expect(screen.getByTestId("task-log-status").textContent).toBe("stopped · owner_stop"));
  });

  it("Kill asks first; Cancel sends nothing; Kill sends one POST /sessions/:id/kill and shows the kernel's answer, never an assumed one", async () => {
    const { fake } = await mount({ output: new Map([[41, [outRow(41, 1)]]]) });
    fake.route("POST /sessions/:id/kill", () => ok({ id: 41, status: "failed", reason: "kill_incomplete" }));
    await openCard("task:9");
    await screen.findByRole("log", { name: "Session output" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Kill session #41?");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    expect(reads(fake, "POST /sessions/:id/kill")).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Kill" }));
    });
    await waitFor(() => expect(reads(fake, "POST /sessions/:id/kill")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("task-log-status").textContent).toBe("failed · kill_incomplete"));
  });

  it("shows the kernel's refusal and keeps the status the kernel named on a 409", async () => {
    const { fake } = await mount({ output: new Map([[41, [outRow(41, 1)]]]) });
    fake.route("POST /sessions/:id/stop", () => ({ ok: false, status: 409, body: { error: "not_running", status: "completed" } }));
    await openCard("task:9");
    await screen.findByRole("log", { name: "Session output" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Stop/ }));
    });
    await waitFor(() => expect(screen.getByTestId("task-notice").textContent).toContain("The kernel refused (409 not_running)"));
    expect(screen.getByTestId("task-log-status").textContent).toBe("completed");
  });

  it("offers neither for a card whose session has ended", async () => {
    await mount({ output: new Map([[40, [outRow(40, 1)]]]), sessions: [summary(40, { status: "stopped", ended: stamp(1) })] });
    await openCard("session:40");
    await screen.findByRole("log", { name: "Session output" });
    expect(screen.getByRole("button", { name: /^Stop/ }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "Kill" }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("the ⌘K commands", () => {
  it("registers tasks.stop and tasks.kill (group Tasks, owner tasks) only while a card with a live session is open, and unregisters on Back and on unmount", async () => {
    const registry = createCommandRegistry();
    const { unmount } = await mount({ output: new Map([[41, [outRow(41, 1)]]]) }, registry);
    expect(registry.get(TASKS_COMMANDS.stop)).toBeUndefined();
    expect(registry.get(TASKS_COMMANDS.kill)).toBeUndefined();

    // A card with no live session: none.
    await openCard("task:12");
    expect(registry.list().filter((c) => c.owner === TASKS_OWNER)).toEqual([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });

    await openCard("task:9");
    await waitFor(() => expect(registry.get(TASKS_COMMANDS.stop)).toBeDefined());
    for (const id of [TASKS_COMMANDS.stop, TASKS_COMMANDS.kill]) {
      const command = registry.get(id);
      expect(command?.owner).toBe("tasks");
      expect(command?.group).toBe("Tasks");
      expect(command?.id.startsWith("screens.")).toBe(false);
    }
    expect(registry.list().filter((c) => c.owner === TASKS_OWNER).map((c) => c.id)).toEqual(["tasks.stop", "tasks.kill"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    });
    expect(registry.list().filter((c) => c.owner === TASKS_OWNER)).toEqual([]);

    await openCard("task:9");
    await waitFor(() => expect(registry.get(TASKS_COMMANDS.stop)).toBeDefined());
    unmount();
    expect(registry.list().filter((c) => c.owner === TASKS_OWNER)).toEqual([]);
  });

  it("tasks.stop sends one stop, and tasks.kill opens the confirm instead of killing", async () => {
    const registry = createCommandRegistry();
    const { fake } = await mount({ output: new Map([[41, [outRow(41, 1)]]]) }, registry);
    fake.route("POST /sessions/:id/stop", () => ok({ id: 41, status: "stopped", reason: "owner_stop" }));
    await openCard("task:9");
    await waitFor(() => expect(registry.get(TASKS_COMMANDS.kill)).toBeDefined());
    await screen.findByRole("log", { name: "Session output" });
    await act(async () => {
      registry.get(TASKS_COMMANDS.kill)?.run();
    });
    expect(screen.getByRole("alertdialog").textContent).toContain("Kill session #41?");
    expect(reads(fake, "POST /sessions/:id/kill")).toHaveLength(0);
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    });
    await act(async () => {
      registry.get(TASKS_COMMANDS.stop)?.run();
    });
    await waitFor(() => expect(reads(fake, "POST /sessions/:id/stop")).toHaveLength(1));
  });

  it("is disabled while the kernel is away", async () => {
    const registry = createCommandRegistry();
    const { fake } = await mount({ output: new Map([[41, [outRow(41, 1)]]]) }, registry);
    await openCard("task:9");
    await waitFor(() => expect(registry.get(TASKS_COMMANDS.stop)?.enabled?.()).toBe(true));
    fake.route(TASKS, () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }));
    await act(async () => {
      fake.emit(event("task_updated", null, 9));
    });
    await waitFor(() => expect(registry.get(TASKS_COMMANDS.stop)?.enabled?.()).toBe(false));
  });
});

describe("the keys", () => {
  function press(key: string, init: KeyboardEventInit = {}): void {
    fireEvent.keyDown(document.body, { key, ...init });
  }

  it("J / K and the arrows move focus between cards across the columns, in order; Enter-activation opens", async () => {
    await mount();
    const order = [...document.querySelectorAll<HTMLElement>("[data-card-key]")].map((el) => el.dataset.cardKey);
    expect(order).toHaveLength(10);
    press("j");
    expect((document.activeElement as HTMLElement).dataset.cardKey).toBe(order[0]);
    press("j");
    expect((document.activeElement as HTMLElement).dataset.cardKey).toBe(order[1]);
    press("ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.cardKey).toBe(order[2]);
    press("k");
    expect((document.activeElement as HTMLElement).dataset.cardKey).toBe(order[1]);
    press("ArrowUp");
    expect((document.activeElement as HTMLElement).dataset.cardKey).toBe(order[0]);
    // The ends hold.
    press("k");
    expect((document.activeElement as HTMLElement).dataset.cardKey).toBe(order[0]);
    for (let i = 0; i < 20; i += 1) press("j");
    expect((document.activeElement as HTMLElement).dataset.cardKey).toBe(order[9]);
  });

  it("leaves modified keys and typing alone", async () => {
    await mount();
    press("j", { metaKey: true });
    press("j", { shiftKey: true });
    expect(document.activeElement).toBe(document.body);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("does nothing behind an open dialog, and Esc does not leave the card under a confirm", async () => {
    await mount({ output: new Map([[41, [outRow(41, 1)]]]) });
    await openCard("task:9");
    await screen.findByRole("log", { name: "Session output" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    });
    press("Escape");
    expect(screen.getByTestId("screen-tasks").dataset.state).toBe("detail");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("⌘6 opens Tasks through the shell's own command", async () => {
    const registry = createCommandRegistry();
    const fake = fakeBridge();
    fake.route(TASKS, () => ok({ groups: groupsOf(board()), next_before: null }));
    setApi(fake.bridge);
    const uninstall = installKeyboardMap({ registry, openPalette: vi.fn(), isPaletteOpen: () => false, killSwitch: { confirm: async () => false, engage: vi.fn() }, onCollision: vi.fn() });
    try {
      render(<App api={fake.bridge} registry={registry} />);
      expect(registry.get("screens.tasks")?.shortcut).toBe("⌘6");
      expect(registry.get("screens.tasks")?.title).toBe("Tasks");
      await act(async () => {
        fireEvent.keyDown(window, { key: "6", metaKey: true });
      });
      await waitFor(() => expect(screen.getByTestId("screen-tasks")).toBeTruthy());
      await waitFor(() => expect(screen.getByTestId("screen-tasks").dataset.state).toBe("populated"));
    } finally {
      uninstall();
    }
  });
});

describe("the stylesheet", () => {
  // The file name goes through a variable: Vite rewrites `new URL("<literal>", import.meta.url)` into an asset URL.
  const read = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  const css = read("./tasks.css");

  it("uses only design tokens: no hex, rgb( or hsl( colour", () => {
    expect(css.length).toBeGreaterThan(1000);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/i);
    expect(css).not.toMatch(/\bhsla?\(/i);
  });
});
