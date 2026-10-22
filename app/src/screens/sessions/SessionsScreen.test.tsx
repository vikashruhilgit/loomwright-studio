// @vitest-environment jsdom
// The Sessions screen over a scriptable bridge (`../../store/fake-bridge`):
// the bridge guard, the running-first list selected by id, the kernel's
// honest status (kill unconfirmed, orphans), the output read after the last
// seq on each announcement, the escaped log, Stop / Kill / Abandon with their
// in-flight guard and confirms, and the registered ⌘K commands.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ApiRequest,
  ApiResult,
  Approval,
  EventFrame,
  RosterEntry,
  SessionOutputKind,
  SessionOutputRow,
  SessionSummary,
  StatusBody,
  StudioBridge,
} from "../../api/contract";
import { installKeyboardMap } from "../../commands/keyboard";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { EMPTY_TITLE, SESSION_COMMANDS, SESSION_OUTPUT_APPENDED, SessionsScreen } from "./SessionsScreen";
import { screen as sessionsScreen } from "./index";

const ESC = "\u001b";
const RLO = "\u202e";
const OUTPUT = "GET /sessions/:id/output";
const RAW = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

function session(id: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    agent: "ada",
    status: "completed",
    model: "sonnet",
    started: "2026-10-22T08:00:00.000Z",
    ended: `2026-10-22T08:${String(10 + id).padStart(2, "0")}:00.000Z`,
    tokens: 1000 + id,
    cwd: `/work/${id}`,
    playbook: null,
    ...overrides,
  };
}

function running(id: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return session(id, { status: "running", ended: null, started: "2026-10-22T08:30:00.000Z", ...overrides });
}

function outRow(sessionId: number, seq: number, kind: SessionOutputKind = "assistant_text", payload: unknown = { text: `line ${seq}` }): SessionOutputRow {
  return { id: sessionId * 10_000 + seq, session_id: sessionId, seq, kind, payload, created_at: "2026-10-22T08:31:00.000Z" };
}

function rows(sessionId: number, from: number, to: number): SessionOutputRow[] {
  const out: SessionOutputRow[] = [];
  for (let seq = from; seq <= to; seq += 1) out.push(outRow(sessionId, seq));
  return out;
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

interface Kernel {
  sessions: SessionSummary[];
  output: Map<number, SessionOutputRow[]>;
  killUnconfirmed: StatusBody["kill_unconfirmed"][number][];
  orphaned: StatusBody["orphaned"][number][];
  approvals: Approval[];
}

function statusBody(kernel: Kernel): StatusBody {
  return {
    kernel: { version: "0", uptime_s: 1, pid: 1 },
    kill_switch: { engaged: false, since: null },
    auth: [],
    sessions: [],
    kill_unconfirmed: kernel.killUnconfirmed,
    orphaned: kernel.orphaned,
    queue: { pending: 0, events: [] },
    wakeups: { pending: 0, items: [] },
    tokens_today: { day: "2026-10-22", agents: [] },
    cap_state: [],
  };
}

let eventId = 0;
function event(kind: string, sessionId: number | null): EventFrame {
  eventId += 1;
  return { type: "event", id: eventId, at: new Date().toISOString(), kind, session_id: sessionId, task_id: null, payload: {} };
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

async function mount(initial: Partial<Kernel> = {}, registry: CommandRegistry = createCommandRegistry()): Promise<Mounted> {
  const kernel: Kernel = { sessions: [], output: new Map(), killUnconfirmed: [], orphaned: [], approvals: [], ...initial };
  const fake = fakeBridge();
  fake.route("GET /status", () => ok(statusBody(kernel)));
  fake.route("GET /sessions", () => ok({ sessions: [...kernel.sessions] }));
  fake.route("GET /approvals", () => ok({ approvals: [...kernel.approvals] }));
  fake.route("GET /agents", () => ok({ agents: [roster("ada"), roster("mason")] }));
  fake.route(OUTPUT, (req) => {
    const id = Number(req.params?.id);
    const after = Number(req.query?.after ?? "0");
    const limit = Number(req.query?.limit ?? "500");
    return ok({ rows: (kernel.output.get(id) ?? []).filter((r) => r.seq > after).slice(0, limit) });
  });
  setApi(fake.bridge);
  const view = render(<SessionsScreen registry={registry} />);
  await waitFor(() => expect(screen.getByTestId("screen-sessions").dataset.state).not.toBe("loading"));
  return { fake, kernel, registry, unmount: view.unmount };
}

/** The rows' session ids, in display order. */
function rowIds(): number[] {
  return screen.queryAllByRole("option").map((row) => Number(row.getAttribute("data-key")));
}

function selectedId(): number | undefined {
  const row = screen.queryAllByRole("option").find((r) => r.getAttribute("aria-selected") === "true");
  return row === undefined ? undefined : Number(row.getAttribute("data-key"));
}

function rowOf(id: number): HTMLElement {
  return screen.getByTestId(`session-row-${id}`);
}

function statusOf(id: number): string {
  return within(rowOf(id)).getByTestId("session-status").textContent ?? "";
}

function press(key: string, init: KeyboardEventInit = {}, target: Element = document.body): void {
  fireEvent.keyDown(target, { key, ...init });
}

function posts(fake: FakeBridge, key: string): ApiRequest[] {
  return fake.requestsTo(key).map((r) => r.req);
}

/** The `after` of every output read of session `id`, in order. */
function readsOf(fake: FakeBridge, id: number): string[] {
  return posts(fake, OUTPUT)
    .filter((r) => Number(r.params?.id) === id)
    .map((r) => r.query?.after ?? "");
}

/** A held answer: the request stays in flight until `answer` is called. */
function held(): { readonly responder: () => Promise<ApiResult<unknown>>; answer(result: ApiResult<unknown>): void } {
  let settle: ((result: ApiResult<unknown>) => void) | undefined;
  return {
    responder: () =>
      new Promise((done) => {
        settle = done;
      }),
    answer(result) {
      settle?.(result);
    },
  };
}

afterEach(() => {
  cleanup();
  setApi(undefined);
  window.location.hash = "";
});

describe("the bridge guard", () => {
  it("with no window.api, renders the root testid without throwing and calls no store hook", () => {
    setApi(undefined);
    expect(() => render(<SessionsScreen registry={createCommandRegistry()} />)).not.toThrow();
    const root = screen.getByTestId("screen-sessions");
    expect(root.dataset.state).toBe("no-bridge");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("keeps the shell's screen definition", () => {
    expect(sessionsScreen.id).toBe("sessions");
    expect(sessionsScreen.title).toBe("Sessions");
    expect(sessionsScreen.nav).toEqual({ label: "Sessions", order: 4, shortcut: "⌘4" });
    expect(sessionsScreen.Component).toBe(SessionsScreen);
  });
});

describe("the list", () => {
  it("AC1: running first and selected; each row's agent, task, time, tokens and the kernel's word; kill unconfirmed and the orphan reason", async () => {
    const { fake, kernel } = await mount({
      sessions: [
        session(29, { agent: "wright", playbook: 3 }),
        session(30, { status: "stopped" }),
        running(31, { agent: "mason", playbook: 4, tokens: 14208 }),
        session(28, { status: "failed", tokens: null }),
        session(27, { status: "orphaned", ended: null, started: "2026-10-22T07:00:00.000Z", agent: null }),
      ],
      killUnconfirmed: [{ id: 28, agent: "ada", status: "failed", pgid: 99, kill_incomplete_at: "2026-10-22T08:20:00.000Z" }],
      orphaned: [{ id: 27, agent: null, pgid: 98, reason: "leader_unverified", updated_at: "2026-10-22T08:00:00.000Z" }],
    });
    await waitFor(() => expect(within(rowOf(28)).queryByTestId("session-kill-unconfirmed")).not.toBeNull());
    expect(rowIds()).toEqual([31, 30, 29, 28, 27]);
    expect(selectedId()).toBe(31);
    const first = within(rowOf(31));
    expect(first.getByTestId("session-agent").textContent).toBe("mason");
    expect(first.getByTestId("session-task").textContent).toBe("playbook #4");
    expect(first.getByTestId("session-status").textContent).toBe("running");
    expect(first.getByTestId("session-tokens").textContent).toBe("14,208 tokens");
    expect(first.getByTestId("session-elapsed").textContent).toMatch(/^\d+(m \d\ds|h \d\dm)$/);
    expect(first.getByRole("img").getAttribute("aria-label")).toMatch(/^mason · /);
    expect(within(rowOf(30)).getByTestId("session-task").textContent).toBe("ad hoc session");
    expect(within(rowOf(30)).getByTestId("session-elapsed").textContent).toBe("40m 00s");
    expect(within(rowOf(28)).getByTestId("session-tokens").textContent).toBe("—");
    expect(within(rowOf(28)).getByTestId("session-kill-unconfirmed").textContent).toBe("kill unconfirmed");
    expect(within(rowOf(27)).getByTestId("session-orphan-reason").textContent).toBe("leader_unverified");
    expect(within(rowOf(27)).getByTestId("session-agent").textContent).toBe("unknown agent");
    expect(screen.getByTestId("sessions-count").textContent).toBe("1 running");

    // A newer session arriving does not move the selection: it is an id.
    kernel.sessions.push(running(32, { started: "2026-10-22T08:45:00.000Z" }));
    act(() => fake.emit(event("session_started", 32)));
    await waitFor(() => expect(rowIds()).toEqual([32, 31, 30, 29, 28, 27]));
    expect(selectedId()).toBe(31);
  });

  it("J / K move the selection in display order; an unknown status renders as its own word", async () => {
    await mount({ sessions: [running(5), session(4, { status: "paused_new" }), session(3)] });
    expect(selectedId()).toBe(5);
    press("j");
    expect(selectedId()).toBe(4);
    expect(statusOf(4)).toBe("paused_new");
    press("j");
    press("j");
    expect(selectedId()).toBe(3);
    press("k");
    expect(selectedId()).toBe(4);
    expect(screen.getByTestId("session-detail").dataset.sessionId).toBe("4");
  });

  it("a running session with a pending approval it asked for is waiting on you", async () => {
    await mount({
      sessions: [running(5), running(6, { started: "2026-10-22T08:40:00.000Z" })],
      approvals: [
        {
          id: 9,
          requesting_agent: "ada",
          requesting_session: 6,
          action: "Bash",
          payload: {},
          requested_at: "2026-10-22T08:41:00.000Z",
          status: "pending",
          decision: null,
          decided_by: null,
          decided_at: null,
          playbook: null,
        },
      ],
    });
    await waitFor(() => expect(within(rowOf(6)).queryByTestId("session-waiting-badge")).not.toBeNull());
    expect(rowIds()).toEqual([5, 6]);
    press("j");
    expect(screen.getByTestId("session-waiting").textContent).toContain("Approval #9 is pending");
  });

  it("the empty state, with its words, when nothing ran", async () => {
    await mount();
    expect(screen.getByTestId("screen-sessions").dataset.state).toBe("empty");
    expect(screen.getByRole("heading", { name: EMPTY_TITLE })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("the error state names the kernel when it refuses the read", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok({ kernel: { version: "0", uptime_s: 1, pid: 1 } }));
    fake.route("GET /sessions", () => ({ ok: false, status: 500, body: { error: "route_failed", message: `bad${RLO}` } }));
    setApi(fake.bridge);
    render(<SessionsScreen registry={createCommandRegistry()} />);
    await waitFor(() => expect(screen.getByTestId("screen-sessions").dataset.state).toBe("error"));
    expect(screen.getByTestId("sessions-error").textContent).toContain("The kernel refused the read (500 route_failed): bad\\u202e.");
  });
});

describe("the output", () => {
  it("a follow read sends after = the last seq it has, never 0 again; another session's frame reads nothing", async () => {
    const { fake, kernel } = await mount({ sessions: [running(31), session(30)], output: new Map([[31, rows(31, 1, 3)]]) });
    await waitFor(() => expect(screen.getByText("line 3")).toBeTruthy());
    expect(readsOf(fake, 31)).toEqual(["0"]);

    kernel.output.set(31, rows(31, 1, 5));
    act(() => fake.emit(event(SESSION_OUTPUT_APPENDED, 31)));
    await waitFor(() => expect(screen.getByText("line 5")).toBeTruthy());
    expect(readsOf(fake, 31)).toEqual(["0", "3"]);
    expect(posts(fake, OUTPUT).every((r) => r.query?.limit === "500")).toBe(true);

    act(() => fake.emit(event(SESSION_OUTPUT_APPENDED, 30)));
    act(() => fake.emit(event("session_status", 31)));
    await act(async () => new Promise((done) => setTimeout(done, 50)));
    expect(readsOf(fake, 31)).toEqual(["0", "3"]);

    // A truncated frame carries no session_id: it may be this session's, so it reads (after the last seq).
    kernel.output.set(31, rows(31, 1, 6));
    act(() => fake.emit({ type: "event", id: ++eventId, kind: SESSION_OUTPUT_APPENDED, truncated: true }));
    await waitFor(() => expect(screen.getByText("line 6")).toBeTruthy());
    expect(readsOf(fake, 31).slice(0, 3)).toEqual(["0", "3", "5"]);
  });

  it("pages at 500 rows: the second page is read after the first page's last seq", async () => {
    const { fake } = await mount({ sessions: [running(31)], output: new Map([[31, rows(31, 1, 620)]]) });
    await waitFor(() => expect(screen.getByText("line 620")).toBeTruthy());
    expect(readsOf(fake, 31)).toEqual(["0", "500"]);
    expect(screen.getAllByText(/^line \d+$/)).toHaveLength(620);
  });

  it("more frames than the event log keeps arriving at once reads again (an unseen announcement may be among them)", async () => {
    const { fake, kernel } = await mount({ sessions: [running(31)], output: new Map([[31, rows(31, 1, 2)]]) });
    await waitFor(() => expect(screen.getByText("line 2")).toBeTruthy());
    kernel.output.set(31, rows(31, 1, 4));
    act(() => {
      for (let i = 0; i < 1_005; i += 1) fake.emit(event("event_done", null));
    });
    await waitFor(() => expect(screen.getByText("line 4")).toBeTruthy());
    expect(readsOf(fake, 31)).toEqual(["0", "2"]);
  });

  it("an ANSI / bidi payload reaches the DOM escaped, as do the agent and the cwd", async () => {
    await mount({
      sessions: [running(31, { agent: `ma${RLO}son`, cwd: `/tmp/${ESC}[31mwork` })],
      output: new Map([
        [
          31,
          [
            outRow(31, 1, "assistant_text", { text: `${ESC}[31mOK${ESC}[0m written to notes${RLO}txt.exe` }),
            outRow(31, 2, "tool_call", { tool_use_id: "t", name: "Bash", input_json: `{"command":"printf '${ESC}[31m'"}` }),
            outRow(31, 3, "tool_decision", { tool: "Bash", decision: "deny", reason: "never_category" }),
            outRow(31, 4, "tool_decision", { tool: "Bash", decision: "deny", reason: "approval_required", approval_id: 7 }),
          ],
        ],
      ]),
    });
    await waitFor(() => expect(screen.getByText(/written to notes/)).toBeTruthy());
    const log = screen.getByRole("log");
    expect(log.textContent).toContain("\\x1b[31mOK\\x1b[0m written to notes\\u202etxt.exe");
    expect(log.textContent).toContain("Bash denied · never_category");
    expect(log.textContent).toContain("Bash held · approval #7 · approval_required");
    expect(screen.getByTestId("session-cwd").textContent).toBe("/tmp/\\x1b[31mwork");
    expect(within(rowOf(31)).getByTestId("session-agent").textContent).toBe("ma\\u202eson");
    expect(RAW.test(document.body.textContent ?? "")).toBe(false);
  });

  it("a session with no cwd says so; the model is shown", async () => {
    await mount({ sessions: [running(31, { cwd: null, model: "opus" })] });
    expect(screen.getByTestId("session-cwd").textContent).toBe("cwd unknown");
    expect(screen.getByTestId("session-model").textContent).toBe("opus");
  });
});

describe("stop", () => {
  it("the row shows stopping…, not stopped, while the stop is in flight; stopped only once the kernel answers", async () => {
    const { fake } = await mount({ sessions: [running(31)] });
    const stop = held();
    fake.route("POST /sessions/:id/stop", stop.responder);
    press(".", { metaKey: true });
    await waitFor(() => expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(1));
    expect(posts(fake, "POST /sessions/:id/stop")[0]?.params).toEqual({ id: 31 });
    expect(statusOf(31)).toBe("stopping…");
    expect(within(rowOf(31)).queryByText("stopped")).toBeNull();
    expect(screen.getByTestId("session-log-status").textContent).toBe("stopping…");

    await act(async () => stop.answer(ok({ id: 31, status: "stopped", reason: "owner_stop" })));
    await waitFor(() => expect(statusOf(31)).toBe("stopped"));
    expect(within(rowOf(31)).getByTestId("session-reason").textContent).toBe(" · owner_stop");
    expect(screen.getByTestId("session-log-status").textContent).toBe("stopped · owner_stop");
  });

  it("a second ⌘. (or a Stop click) while the stop is pending sends nothing", async () => {
    const { fake } = await mount({ sessions: [running(31)] });
    const stop = held();
    fake.route("POST /sessions/:id/stop", stop.responder);
    press(".", { metaKey: true });
    await waitFor(() => expect(statusOf(31)).toBe("stopping…"));
    press(".", { metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: /^Stop/ }));
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(1);
    await act(async () => stop.answer(ok({ id: 31, status: "stopped", reason: "owner_stop" })));
    await waitFor(() => expect(statusOf(31)).toBe("stopped"));
    // Answered stopped: Stop no longer applies, even before the list catches up.
    press(".", { metaKey: true });
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(1);
  });

  it("a 409 not_running shows the status the kernel answered, and the refusal", async () => {
    const { fake } = await mount({ sessions: [running(31)] });
    fake.route("POST /sessions/:id/stop", () => ({ ok: false, status: 409, body: { error: "not_running", status: "completed" } }));
    press(".", { metaKey: true });
    await waitFor(() => expect(statusOf(31)).toBe("completed"));
    expect(screen.getByTestId("session-notice").textContent).toBe("The kernel refused (409 not_running).");
  });

  it("with the global keyboard map installed, ⌘. sends exactly one stop, from the body or inside the log", async () => {
    const registry = createCommandRegistry();
    const uninstall = installKeyboardMap({
      registry,
      openPalette: vi.fn(),
      isPaletteOpen: () => false,
      killSwitch: { confirm: async () => false, engage: vi.fn() },
      onCollision: vi.fn(),
    });
    try {
      const { fake } = await mount({ sessions: [running(31), running(32, { started: "2026-10-22T08:00:00.000Z" })] }, registry);
      const stop = held();
      fake.route("POST /sessions/:id/stop", stop.responder);
      press(".", { metaKey: true });
      await waitFor(() => expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(1));
      await act(async () => stop.answer(ok({ id: 31, status: "stopped", reason: "owner_stop" })));
      await waitFor(() => expect(statusOf(31)).toBe("stopped"));

      // Inside the log: the map runs the command, and StreamingLog's own ⌘. hits the shared guard.
      press("j");
      expect(selectedId()).toBe(32);
      fake.route("POST /sessions/:id/stop", held().responder);
      press(".", { metaKey: true }, screen.getByRole("log"));
      await waitFor(() => expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(2));
      await act(async () => new Promise((done) => setTimeout(done, 20)));
      expect(posts(fake, "POST /sessions/:id/stop").map((r) => r.params?.id)).toEqual([31, 32]);
    } finally {
      uninstall();
    }
  });
});

describe("kill", () => {
  it("Kill asks first: Escape keeps the confirm open, Cancel sends nothing, Confirm sends exactly one", async () => {
    const { fake } = await mount({ sessions: [running(31)] });
    fake.route("POST /sessions/:id/kill", () => ok({ id: 31, status: "stopped", reason: "owner_kill" }));
    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm.textContent).toContain("Kill session #31?");
    press("Escape");
    expect(screen.getByRole("alertdialog")).toBe(confirm);
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(posts(fake, "POST /sessions/:id/kill")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Kill" }));
    await waitFor(() => expect(statusOf(31)).toBe("stopped"));
    expect(posts(fake, "POST /sessions/:id/kill")).toHaveLength(1);
  });

  it("a kill answered {failed, kill_incomplete}: the row and the log header say failed and kill_incomplete with a danger badge, never stopped", async () => {
    const { fake, registry } = await mount({ sessions: [running(31)] });
    fake.route("POST /sessions/:id/kill", () => ok({ id: 31, status: "failed", reason: "kill_incomplete" }));
    await act(async () => registry.get(SESSION_COMMANDS.kill)?.run());
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Kill" }));
    await waitFor(() => expect(statusOf(31)).toBe("failed"));
    expect(within(rowOf(31)).getByTestId("session-danger").textContent).toBe("kill_incomplete");
    expect(screen.getByTestId("session-log-status").textContent).toBe("failed · kill_incomplete");
    expect(within(screen.getByTestId("session-log-status")).getByText("failed · kill_incomplete").closest("[data-tone]")?.getAttribute("data-tone")).toBe("danger");
    expect(rowOf(31).textContent).not.toContain("stopped");
  });
});

describe("abandon", () => {
  it("is offered only for a leader_unverified orphan; asks first; sends one abandon on Confirm; the row shows abandoned", async () => {
    const { fake, registry } = await mount({
      sessions: [session(27, { status: "orphaned" }), session(26, { status: "orphaned" }), session(25, { status: "completed" })],
      orphaned: [
        { id: 27, agent: "ada", pgid: 1, reason: "leader_unverified", updated_at: "2026-10-22T08:00:00.000Z" },
        { id: 26, agent: "ada", pgid: 2, reason: "reap_error", updated_at: "2026-10-22T08:00:00.000Z" },
      ],
    });
    fake.route("POST /sessions/:id/abandon", () => ok({ id: 27, status: "abandoned" }));
    await waitFor(() => expect(within(rowOf(26)).queryByTestId("session-orphan-reason")).not.toBeNull());
    expect(selectedId()).toBe(27);
    expect(screen.getByRole("button", { name: "Abandon" })).toBeTruthy();
    expect(registry.get(SESSION_COMMANDS.abandon)?.enabled?.()).toBe(true);
    press("j");
    expect(selectedId()).toBe(26);
    expect(screen.queryByRole("button", { name: "Abandon" })).toBeNull();
    expect(registry.get(SESSION_COMMANDS.abandon)?.enabled?.()).toBe(false);
    press("j");
    expect(screen.queryByRole("button", { name: "Abandon" })).toBeNull();
    press("k");
    press("k");

    fireEvent.click(screen.getByRole("button", { name: "Abandon" }));
    press("Escape");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(posts(fake, "POST /sessions/:id/abandon")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Abandon" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Abandon" }));
    await waitFor(() => expect(statusOf(27)).toBe("abandoned"));
    expect(posts(fake, "POST /sessions/:id/abandon").map((r) => r.params)).toEqual([{ id: 27 }]);
    expect(screen.queryByRole("button", { name: "Abandon" })).toBeNull();
  });
});

describe("a refused control", () => {
  it.each([
    ["a 404 with no status", () => ({ ok: false, status: 404, body: { error: "not_found" } }), "The kernel refused (404 not_found)."],
    [
      "a connection failure",
      () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } }),
      "Couldn't reach the kernel; nothing was stopped.",
    ],
    [
      "a request that throws",
      () => {
        throw new Error("ipc");
      },
      "The request failed before it reached the kernel; nothing was stopped.",
    ],
  ] as const)("%s: the notice says so and the row keeps the kernel's status", async (_why, responder, notice) => {
    const { fake } = await mount({ sessions: [running(31)] });
    fake.route("POST /sessions/:id/stop", responder as () => ApiResult<unknown>);
    press(".", { metaKey: true });
    await waitFor(() => expect(screen.getByTestId("session-notice").textContent).toBe(notice));
    expect(statusOf(31)).toBe("running");
    expect(screen.getByTestId("session-log-status").textContent).toBe("running");
    // Refused, not answered: Stop still applies.
    press(".", { metaKey: true });
    await waitFor(() => expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(2));
  });
});

describe("the list's other states", () => {
  it("a list read that fails after one answered keeps the list and says it is stale", async () => {
    const { fake } = await mount({ sessions: [running(31)] });
    fake.route("GET /sessions", () => ({ ok: false, status: 500, body: { error: "route_failed" } }));
    act(() => fake.emit(event("session_status", 31)));
    await waitFor(() => expect(screen.queryByTestId("sessions-stale")).not.toBeNull());
    expect(screen.getByTestId("sessions-stale").textContent).toContain("The kernel refused the read (500 route_failed).");
    expect(rowIds()).toEqual([31]);
  });

  it("a selected session that leaves the kernel's list shows the gone note, and nothing acts on it", async () => {
    const { fake, kernel } = await mount({ sessions: [running(31), session(30)] });
    kernel.sessions = [session(30)];
    act(() => fake.emit(event("session_status", 31)));
    await waitFor(() => expect(screen.queryByTestId("session-gone")).not.toBeNull());
    expect(screen.getByTestId("session-gone").dataset.sessionId).toBe("31");
    expect(screen.getByTestId("session-gone").textContent).toContain("Session #31 is no longer in the kernel's list.");
    expect(selectedId()).toBeUndefined();
    press(".", { metaKey: true });
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(0);
  });

  it("while /approvals has not answered, the Waiting on you group says so instead of None", async () => {
    await mount({ sessions: [running(31)] });
    await waitFor(() => expect(screen.getByTestId("sessions-none-waiting").textContent).toBe("None"));
    cleanup();

    const kernel: Kernel = { sessions: [running(31)], output: new Map(), killUnconfirmed: [], orphaned: [], approvals: [] };
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(statusBody(kernel)));
    fake.route("GET /sessions", () => ok({ sessions: [...kernel.sessions] }));
    fake.route("GET /agents", () => ok({ agents: [] }));
    fake.route(OUTPUT, () => ok({ rows: [] }));
    const approvals = held();
    fake.route("GET /approvals", approvals.responder);
    setApi(fake.bridge);
    render(<SessionsScreen registry={createCommandRegistry()} />);
    await waitFor(() => expect(screen.getByTestId("sessions-none-waiting").textContent).toBe("Reading approvals…"));
    await act(async () => approvals.answer({ ok: false, status: 500, body: { error: "route_failed" } }));
    await waitFor(() => expect(screen.getByTestId("sessions-none-waiting").textContent).toBe("Couldn't read approvals, so who is waiting on you isn't known."));
    expect(screen.getByTestId("sessions-none-recent").textContent).toBe("None");
  });
});

describe("the output, before and after a read answers", () => {
  it("an ended session never says No output while its first read is in flight or failed; Read again reads after the last seq", async () => {
    const fake = fakeBridge();
    const kernel: Kernel = { sessions: [session(30, { tokens: null })], output: new Map(), killUnconfirmed: [], orphaned: [], approvals: [] };
    fake.route("GET /status", () => ok(statusBody(kernel)));
    fake.route("GET /sessions", () => ok({ sessions: [...kernel.sessions] }));
    fake.route("GET /approvals", () => ok({ approvals: [] }));
    fake.route("GET /agents", () => ok({ agents: [] }));
    const first = held();
    fake.route(OUTPUT, first.responder);
    setApi(fake.bridge);
    render(<SessionsScreen registry={createCommandRegistry()} />);
    await waitFor(() => expect(screen.queryByTestId("session-detail")).not.toBeNull());

    // In flight: reading, and the log is marked unread (sessions.css hides StreamingLog's "No output").
    expect(screen.getByTestId("session-output-reading").textContent).toBe("Reading this session's output…");
    expect(screen.getByTestId("session-log").dataset.output).toBe("unread");
    // The kernel has no token count: the header's figure is marked unknown (hidden), never "0 tokens".
    expect(screen.getByTestId("session-log").dataset.tokens).toBe("unknown");
    expect(within(rowOf(30)).getByTestId("session-tokens").textContent).toBe("—");

    // Failed: an honest note for an ended session, a Read again, and still unread.
    await act(async () => first.answer({ ok: false, status: 500, body: { error: "route_failed" } }));
    const failure = await screen.findByTestId("session-output-error");
    expect(failure.textContent).toContain("The kernel refused the output read (500 route_failed).");
    expect(failure.textContent).toContain("This session has ended, so nothing announces more output");
    expect(failure.textContent).not.toContain("when more output is announced");
    expect(screen.queryByTestId("session-output-reading")).toBeNull();
    expect(screen.getByTestId("session-log").dataset.output).toBe("unread");

    // Read again: one read, after the last seq (0: none read yet); then the rows, and the log is read.
    kernel.output.set(30, rows(30, 1, 2));
    fake.route(OUTPUT, (req) => ok({ rows: (kernel.output.get(Number(req.params?.id)) ?? []).filter((r) => r.seq > Number(req.query?.after ?? "0")) }));
    const again = within(failure).getByRole("button", { name: "Read again" });
    again.focus();
    fireEvent.click(again);
    await waitFor(() => expect(screen.getByText("line 2")).toBeTruthy());
    expect(readsOf(fake, 30)).toEqual(["0", "0"]);
    expect(screen.getByTestId("session-log").dataset.output).toBe("read");
    expect(screen.queryByTestId("session-output-error")).toBeNull();
    // The note (and its focused button) left with the failure: focus is on the detail, never <body>.
    expect(document.activeElement).toBe(screen.getByTestId("session-detail"));
  });

  it("an event log reset (a wiped event table) reads again after the last seq", async () => {
    const { fake, kernel } = await mount({ sessions: [running(31)], output: new Map([[31, rows(31, 1, 3)]]) });
    await waitFor(() => expect(screen.getByText("line 3")).toBeTruthy());
    // A frame opens the feed; the log now has an id to compare against (the first frame after none may read once).
    act(() => fake.emit(event("session_status", null)));
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    const before = readsOf(fake, 31).length;

    // The kernel restarts with a wiped event table: on reconnect the store empties its event log. No
    // announcement arrives, so only the reset itself can cause the read.
    kernel.output.set(31, rows(31, 1, 4));
    fake.route("GET /status", () => ok({ ...statusBody(kernel), kernel: { version: "0", uptime_s: 1, pid: 2 } }));
    fake.route("GET /events", () => ok({ events: [] }));
    act(() => fake.emit({ type: "closed", code: 1006, reason: "" }));
    await waitFor(() => expect(screen.getByText("line 4")).toBeTruthy(), { timeout: 3_000 });
    expect(readsOf(fake, 31).slice(before)).toEqual(["3"]);
  });
});

describe("focus", () => {
  const ORPHAN = { id: 27, agent: "ada", pgid: 1, reason: "leader_unverified", updated_at: "2026-10-22T08:00:00.000Z" };

  it("after Abandon's confirm, focus is on Abandon (aria-disabled, not disabled) while pending, then on the detail once it is gone", async () => {
    const { fake } = await mount({ sessions: [session(27, { status: "orphaned" })], orphaned: [ORPHAN] });
    const abandon = held();
    fake.route("POST /sessions/:id/abandon", abandon.responder);
    const button = await screen.findByRole("button", { name: "Abandon" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Abandon" }));
    await waitFor(() => expect(statusOf(27)).toBe("abandoning…"));
    await waitFor(() => expect(document.activeElement).toBe(button));
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    // A click while pending sends nothing more.
    fireEvent.click(button);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await act(async () => abandon.answer(ok({ id: 27, status: "abandoned" })));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Abandon" })).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("session-detail"));
    expect(posts(fake, "POST /sessions/:id/abandon")).toHaveLength(1);
  });

  it("a confirm whose session left the list closes, sends nothing, and hands focus to the region in its place", async () => {
    const { fake, kernel } = await mount({ sessions: [session(27, { status: "orphaned" }), session(25)], orphaned: [ORPHAN] });
    const button = await screen.findByRole("button", { name: "Abandon" });
    button.focus();
    fireEvent.click(button);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    kernel.sessions = [session(25)];
    act(() => fake.emit(event("session_status", 27)));
    await waitFor(() => expect(screen.queryByTestId("session-gone")).not.toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("session-gone")));
    expect(posts(fake, "POST /sessions/:id/abandon")).toHaveLength(0);
  });

  it("a Kill confirm whose list goes empty closes (focus on the empty state) and never comes back when the list repopulates", async () => {
    const { fake, kernel } = await mount({ sessions: [running(31)] });
    fake.route("POST /sessions/:id/kill", () => ok({ id: 31, status: "stopped", reason: "owner_kill" }));
    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }).focus();

    kernel.sessions = [];
    act(() => fake.emit(event("session_status", 31)));
    await waitFor(() => expect(screen.getByTestId("screen-sessions").dataset.state).toBe("empty"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("sessions-empty")));
    expect(document.activeElement).not.toBe(document.body);

    kernel.sessions = [running(32)];
    act(() => fake.emit(event("session_status", 32)));
    await waitFor(() => expect(screen.getByTestId("screen-sessions").dataset.state).toBe("populated"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("Kill session #31?")).toBeNull();
    // #31 is gone: nothing acts on it, and no kill was sent.
    expect(screen.getByTestId("session-gone").dataset.sessionId).toBe("31");
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(posts(fake, "POST /sessions/:id/kill")).toHaveLength(0);
  });

  it("a Kill confirm whose session ended while it was open closes and sends nothing", async () => {
    const { fake, kernel } = await mount({ sessions: [running(31)] });
    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    kernel.sessions = [session(31, { status: "stopped" })];
    act(() => fake.emit(event("session_status", 31)));
    await waitFor(() => expect(statusOf(31)).toBe("stopped"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(posts(fake, "POST /sessions/:id/kill")).toHaveLength(0);
  });

  it("an Abandon confirm whose row is no longer a leader_unverified orphan closes and sends nothing", async () => {
    const { fake, kernel } = await mount({ sessions: [session(27, { status: "orphaned" })], orphaned: [ORPHAN] });
    fireEvent.click(await screen.findByRole("button", { name: "Abandon" }));
    kernel.orphaned = [{ ...ORPHAN, reason: "reap_error" }];
    act(() => fake.emit(event("session_status", 27)));
    await waitFor(() => expect(within(rowOf(27)).getByTestId("session-orphan-reason").textContent).toBe("reap_error"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(posts(fake, "POST /sessions/:id/abandon")).toHaveLength(0);
  });

  it("a refetch that still lists the session with its action applying keeps the confirm open, and Confirm sends one", async () => {
    const { fake } = await mount({ sessions: [running(31), session(30)] });
    fake.route("POST /sessions/:id/kill", () => ok({ id: 31, status: "stopped", reason: "owner_kill" }));
    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    const confirm = screen.getByRole("alertdialog");
    const before = posts(fake, "GET /sessions").length;
    act(() => fake.emit(event("session_status", 30)));
    await waitFor(() => expect(posts(fake, "GET /sessions").length).toBeGreaterThan(before));
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(screen.getByRole("alertdialog")).toBe(confirm);
    fireEvent.click(within(confirm).getByRole("button", { name: "Kill" }));
    await waitFor(() => expect(statusOf(31)).toBe("stopped"));
    expect(posts(fake, "POST /sessions/:id/kill").map((r) => r.params)).toEqual([{ id: 31 }]);
  });

  it("a focused row that moves to another group (Running to Recent) keeps focus on that row", async () => {
    const { fake, kernel } = await mount({ sessions: [running(31), session(30)] });
    fake.route("POST /sessions/:id/stop", () => {
      kernel.sessions = [session(31, { status: "stopped", ended: "2026-10-22T08:50:00.000Z" }), session(30)];
      return ok({ id: 31, status: "stopped", reason: "owner_stop" });
    });
    const before = rowOf(31);
    before.focus();
    press(".", { metaKey: true });
    await waitFor(() => expect(rowOf(31).closest("[data-group]")?.getAttribute("data-group")).toBe("recent"));
    expect(rowOf(31)).not.toBe(before);
    expect(document.activeElement).toBe(rowOf(31));
  });

  it("a focused row whose session leaves the list hands focus to the gone note; a list gone empty, to the empty state", async () => {
    const { fake, kernel } = await mount({ sessions: [running(31), session(30)] });
    rowOf(31).focus();
    kernel.sessions = [session(30)];
    act(() => fake.emit(event("session_status", 31)));
    await waitFor(() => expect(screen.queryByTestId("session-gone")).not.toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("session-gone"));

    rowOf(30).focus();
    kernel.sessions = [];
    act(() => fake.emit(event("session_status", 30)));
    await waitFor(() => expect(screen.getByTestId("screen-sessions").dataset.state).toBe("empty"));
    expect(document.activeElement).toBe(screen.getByTestId("sessions-empty"));
  });

  it("J with focus in the log (which is remounted for the next session) moves focus to the detail, not <body>", async () => {
    await mount({ sessions: [running(31), session(30)], output: new Map([[31, rows(31, 1, 2)]]) });
    await waitFor(() => expect(screen.getByText("line 2")).toBeTruthy());
    const log = screen.getByRole("log");
    log.focus();
    press("j", {}, log);
    expect(selectedId()).toBe(30);
    expect(document.activeElement).toBe(screen.getByTestId("session-detail"));
  });
});

describe("commands", () => {
  it("stop, kill and abandon are palette commands under sessions.*, enabled with the selection, removed on unmount", async () => {
    const { registry, unmount } = await mount({ sessions: [running(31), session(30)] });
    const mine = registry.list().filter((c) => c.owner === "sessions");
    expect(mine.map((c) => [c.id, c.shortcut ?? null])).toEqual([
      [SESSION_COMMANDS.stop, "⌘."],
      [SESSION_COMMANDS.kill, null],
      [SESSION_COMMANDS.abandon, null],
    ]);
    expect(mine.every((c) => c.id.startsWith("sessions.") && c.group === "Sessions")).toBe(true);
    expect(registry.get("screens.sessions")).toBeUndefined();
    expect(registry.get(SESSION_COMMANDS.stop)?.enabled?.()).toBe(true);
    expect(registry.get(SESSION_COMMANDS.kill)?.enabled?.()).toBe(true);
    expect(registry.get(SESSION_COMMANDS.abandon)?.enabled?.()).toBe(false);
    press("j");
    expect(registry.get(SESSION_COMMANDS.stop)?.enabled?.()).toBe(false);
    expect(registry.get(SESSION_COMMANDS.kill)?.enabled?.()).toBe(false);
    unmount();
    expect(registry.list().filter((c) => c.owner === "sessions")).toEqual([]);
  });

  it("sessions.stop shares the in-flight guard; it is disabled while the stop is pending", async () => {
    const { fake, registry } = await mount({ sessions: [running(31)] });
    fake.route("POST /sessions/:id/stop", held().responder);
    await act(async () => registry.get(SESSION_COMMANDS.stop)?.run());
    expect(registry.get(SESSION_COMMANDS.stop)?.enabled?.()).toBe(false);
    await act(async () => registry.get(SESSION_COMMANDS.stop)?.run());
    press(".", { metaKey: true });
    await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(1);
  });

  it("no key runs behind the open confirm", async () => {
    const { fake } = await mount({ sessions: [running(31), running(30)] });
    fireEvent.click(screen.getByRole("button", { name: "Kill" }));
    press("j");
    press(".", { metaKey: true });
    expect(selectedId()).toBe(31);
    expect(posts(fake, "POST /sessions/:id/stop")).toHaveLength(0);
  });
});
