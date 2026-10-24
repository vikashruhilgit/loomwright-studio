// @vitest-environment jsdom
// The menu bar's window side (item 17) over a scriptable bridge
// (`../../store/fake-bridge`): the screen definition, the host's deep-link
// queue (subscribed at module evaluation, a repeat inside 2 s dropped), where
// each notification lands (`./links.ts`), the one toast for a link that opens
// nothing, the four Kernel commands and their `enabled`, the kill confirm
// (Cancel and Escape send nothing, Confirm sends one `POST /stop-all`), and
// the status panel's designed states, and its Recent list (the newest
// notifications, each opened through the host's queue as a link is).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResult, Approval, NotificationRow, StatusBody, StudioBridge } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import { liveStoreFor } from "../../store/react";
import type { FakeBridge } from "../../store/fake-bridge";
import { screen as menubarScreen } from "./index";
import { APPROVAL_SOURCE, LINK_NOTHING_TITLE, approvalHash, linkTarget } from "./links";
import {
  ACTION_PATHS,
  KILL_CONFIRM,
  MENUBAR_COMMANDS,
  MENUBAR_GROUP,
  MenubarHost,
  ROUTE_DEDUPE_MS,
  actionEnabled,
  actionReached,
  createMenubarActions,
  createNavigateQueue,
} from "./MenubarHost";
import type { KernelAction, MenubarActions, NavigateQueue } from "./MenubarHost";
import { MenubarPanel, RECENT_EMPTY_TEXT, RECENT_LIMIT, TRAY_ONLY_NOTE, ageText, newAboveText, recentItem } from "./MenubarPanel";

// ---- fixtures ------------------------------------------------------------------------------

function statusBody(overrides: Partial<StatusBody> = {}): StatusBody {
  return {
    kernel: { version: "0.0.0-test", uptime_s: 1, pid: 1 },
    kill_switch: { engaged: false, since: null },
    paused: false,
    auth: [],
    sessions: [],
    kill_unconfirmed: [],
    orphaned: [],
    queue: { pending: 0, events: [] },
    wakeups: { pending: 0, items: [] },
    tokens_today: { day: "2026-10-23", agents: [] },
    cap_state: [],
    ...overrides,
  };
}

function runningSession(id: number): StatusBody["sessions"][number] {
  return { id, agent: "ada", model: null, pgid: 100 + id, started_at: "2026-10-23T08:00:00.000Z", status: "running", cwd: null };
}

const CAPPED: StatusBody["cap_state"] = [
  {
    account: "subscription",
    provider: "anthropic",
    limits: [{ rate_limit_type: "five_hour", status: "rejected", resets_at: "2026-10-23T13:00:00.000Z", utilization: 1, reset_source: "header" }],
  },
];

function approval(id: number): Approval {
  return {
    id,
    requesting_agent: "ada",
    requesting_session: null,
    action: `approval ${id}`,
    payload: {},
    requested_at: `2026-10-23T08:0${id}:00.000Z`,
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
  };
}

function notification(id: number, source: string, title: string, delivery_status = "delivered"): NotificationRow {
  return {
    id,
    source,
    title,
    body: "",
    deep_link: `loomwright-studio://notifications/${id}`,
    created_at: "2026-10-23T08:00:00.000Z",
    delivery_status,
    delivery_detail: null,
    delivered_at: null,
  };
}

// ---- the harness ---------------------------------------------------------------------------

interface Kernel {
  status: StatusBody;
  approvals: Approval[];
  notifications: Map<number, NotificationRow>;
  /** Whether a pause / unpause / stop-all / resume changes `status` (a kernel that does not shows the state is never optimistic). */
  applies: boolean;
}

interface Mounted {
  readonly fake: FakeBridge;
  readonly kernel: Kernel;
  readonly registry: CommandRegistry;
  readonly queue: NavigateQueue;
  readonly actions: MenubarActions;
  /** Delivers `route` as the main process's `CHANNELS.navigate` would. */
  navigate(route: unknown): void;
  /** Advances the queue's clock. */
  advance(ms: number): void;
  unmount(): void;
}

function setApi(api: StudioBridge | undefined): void {
  if (api === undefined) delete (window as unknown as { api?: StudioBridge }).api;
  else (window as unknown as { api?: StudioBridge }).api = api;
}

async function mount(initial: Partial<Kernel> = {}, options: { readonly panel?: boolean } = {}): Promise<Mounted> {
  const kernel: Kernel = { status: statusBody(), approvals: [], notifications: new Map(), applies: true, ...initial };
  const fake = fakeBridge();
  fake.route("GET /status", () => ok(kernel.status));
  fake.route("GET /approvals", () => ok({ approvals: [...kernel.approvals] }));
  // The kernel's list: newest first (`ORDER BY id DESC`), at most 50 by default.
  fake.route("GET /notifications", () => ok({ notifications: [...kernel.notifications.values()].sort((a, b) => b.id - a.id).slice(0, 50) }));
  fake.route("GET /notifications/:id", (req) => {
    const row = kernel.notifications.get(Number(req.params?.id));
    return row === undefined ? { ok: false, status: 404, body: { error: "not_found" } } : ok({ notification: row });
  });
  const apply = (change: Partial<StatusBody>): void => {
    if (kernel.applies) kernel.status = { ...kernel.status, ...change };
  };
  fake.route("POST /pause", () => (apply({ paused: true }), ok({ paused: true })));
  fake.route("POST /unpause", () => (apply({ paused: false }), ok({ paused: false })));
  fake.route("POST /stop-all", () => (apply({ kill_switch: { engaged: true, since: "2026-10-23T09:00:00.000Z" } }), ok({ engaged: true, sessions: [] })));
  fake.route("POST /resume", () => (apply({ kill_switch: { engaged: false, since: null }, paused: false }), ok({ engaged: false })));

  const listeners = new Set<(route: string) => void>();
  const bridge: StudioBridge = {
    ...fake.bridge,
    onNavigate: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  setApi(bridge);
  let now = 1_000_000;
  const queue = createNavigateQueue(() => now);
  const actions = createMenubarActions();
  const registry = createCommandRegistry();
  const view = render(
    <>
      <aside data-testid="sidebar">
        <MenubarHost queue={queue} actions={actions} registry={registry} />
      </aside>
      {options.panel === false ? null : (
        <main>
          <MenubarPanel actions={actions} queue={queue} />
        </main>
      )}
    </>,
  );
  await waitFor(() => expect(fake.requestsTo("GET /status").length).toBeGreaterThan(0));
  await settle();
  return {
    fake,
    kernel,
    registry,
    queue,
    actions,
    navigate: (route) => {
      act(() => {
        for (const listener of [...listeners]) listener(route as string);
      });
    },
    advance: (ms) => {
      now += ms;
    },
    unmount: view.unmount,
  };
}

/** Lets every pending answer land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

function toasts(): HTMLElement[] {
  const stack = screen.queryByRole("region", { name: "Notifications" });
  return stack === null ? [] : within(stack).queryAllByRole("status");
}

function requestsAfter(fake: FakeBridge, from: number): ApiRequest[] {
  return fake.requests.slice(from).map((r) => r.req);
}

function posts(fake: FakeBridge): string[] {
  return fake.requests.filter((r) => r.req.method === "POST").map((r) => r.req.path);
}

function panelState(): string | undefined {
  return screen.getByTestId("screen-menubar").dataset.state;
}

afterEach(() => {
  cleanup();
  setApi(undefined);
  window.location.hash = "";
  vi.restoreAllMocks();
});

// ---- the screen definition -----------------------------------------------------------------

describe("the screen definition", () => {
  it("is #/menubar, titled Menu bar, with no sidebar entry, the panel and the host", () => {
    expect(menubarScreen.id).toBe("menubar");
    expect(menubarScreen.title).toBe("Menu bar");
    expect(menubarScreen.nav).toBeUndefined();
    expect(menubarScreen.Component).toBe(MenubarPanel);
    expect(menubarScreen.SidebarSection).toBe(MenubarHost);
  });
});

// ---- the host ------------------------------------------------------------------------------

describe("the host", () => {
  it("with no window.api renders nothing and throws nothing", () => {
    setApi(undefined);
    const { container } = render(<MenubarHost registry={createCommandRegistry()} queue={createNavigateQueue()} actions={createMenubarActions()} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing inside the sidebar: no button, no text", async () => {
    await mount({}, { panel: false });
    const sidebar = screen.getByTestId("sidebar");
    expect(within(sidebar).queryAllByRole("button")).toEqual([]);
    expect(sidebar.textContent).toBe("");
  });

  it("subscribes window.api.onNavigate when the module is evaluated, before anything mounts", async () => {
    vi.resetModules();
    const listeners = new Set<(route: string) => void>();
    setApi({
      ...fakeBridge().bridge,
      onNavigate: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    const fresh = await import("./MenubarHost");
    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener("notification/7");
    expect(fresh.navigateQueue.drain()).toEqual([{ kind: "notification", id: 7 }]);
  });
});

describe("notification links", () => {
  it("AC4: a kernel:approval titled `Approval 7: …` opens #/approvals/7; its only request is GET /notifications/7", async () => {
    const m = await mount({ notifications: new Map([[7, notification(7, APPROVAL_SOURCE, "Approval 7: Bash")]]) }, { panel: false });
    const from = m.fake.requests.length;
    m.navigate("notification/7");
    await waitFor(() => expect(window.location.hash).toBe("#/approvals/7"));
    expect(requestsAfter(m.fake, from)).toEqual([{ method: "GET", path: "/notifications/:id", params: { id: 7 } }]);
    expect(toasts()).toEqual([]);
  });

  it("an agent:pim notification opens #/chat/pim; agent:wright opens #/chat", async () => {
    const m = await mount(
      {
        notifications: new Map([
          [3, notification(3, "agent:pim", "PR #412 reviewed")],
          [4, notification(4, "agent:wright", "Done")],
        ]),
      },
      { panel: false },
    );
    m.navigate("notification/3");
    await waitFor(() => expect(window.location.hash).toBe("#/chat/pim"));
    m.navigate("notification/4");
    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
  });

  it("a trigger notification opens Wright's thread; another kernel notification opens nothing and toasts nothing", async () => {
    const m = await mount(
      {
        notifications: new Map([
          [5, notification(5, "trigger:12", "Playbook fired")],
          [6, notification(6, "kernel:cap", "Paused at cap")],
        ]),
      },
      { panel: false },
    );
    window.location.hash = "#/team";
    m.navigate("notification/5");
    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
    window.location.hash = "#/team";
    m.navigate("notification/6");
    await waitFor(() => expect(m.fake.requestsTo("GET /notifications/:id")).toHaveLength(2));
    await settle();
    expect(window.location.hash).toBe("#/team");
    expect(toasts()).toEqual([]);
  });

  it("a 404, a body of the wrong shape, or an approval title that isn't the kernel's: one toast, no route change", async () => {
    const m = await mount(
      {
        notifications: new Map([
          [8, notification(8, APPROVAL_SOURCE, "Approval #8: Bash")],
          [9, notification(9, "agent:", "no name")],
        ]),
      },
      { panel: false },
    );
    m.fake.route("GET /notifications/:id", (req) => {
      const id = Number(req.params?.id);
      if (id === 10) return ok({});
      const row = m.kernel.notifications.get(id);
      return row === undefined ? { ok: false, status: 404, body: { error: "not_found" } } : ok({ notification: row });
    });
    window.location.hash = "#/team";
    for (const id of [404, 8, 9, 10]) {
      m.navigate(`notification/${id}`);
      await waitFor(() => expect(toasts()).toHaveLength(1));
      expect(toasts()[0]?.textContent).toContain(LINK_NOTHING_TITLE);
      expect(window.location.hash).toBe("#/team");
      fireEvent.click(within(toasts()[0] as HTMLElement).getByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(toasts()).toHaveLength(0));
    }
    expect(m.fake.requestsTo("GET /notifications/:id")).toHaveLength(4);
    expect(posts(m.fake)).toEqual([]);
  });

  it("AC4: an invalid link toasts once and makes no request at all", async () => {
    const m = await mount({}, { panel: false });
    window.location.hash = "#/team";
    const from = m.fake.requests.length;
    m.navigate("invalid-link");
    await waitFor(() => expect(toasts()).toHaveLength(1));
    await settle();
    expect(toasts()[0]?.textContent).toContain(LINK_NOTHING_TITLE);
    expect(requestsAfter(m.fake, from)).toEqual([]);
    expect(window.location.hash).toBe("#/team");
  });

  it("a route the main process never sends (approve/7, a raw URL, a number) reads as invalid: one toast each, no request", async () => {
    const m = await mount({}, { panel: false });
    const from = m.fake.requests.length;
    let shown = 0;
    for (const route of ["approve/7", "loomwright-studio://notifications/7", 7]) {
      m.advance(ROUTE_DEDUPE_MS);
      m.navigate(route);
      shown += 1;
      await waitFor(() => expect(toasts()).toHaveLength(shown));
    }
    await settle();
    expect(requestsAfter(m.fake, from)).toEqual([]);
  });

  it("AC4b: the same route delivered twice in a row is handled once: one GET /notifications/7, at most one toast", async () => {
    const m = await mount({}, { panel: false });
    m.navigate("notification/7");
    m.navigate("notification/7");
    await waitFor(() => expect(toasts()).toHaveLength(1));
    await settle();
    expect(m.fake.requestsTo("GET /notifications/:id")).toHaveLength(1);
    expect(toasts()).toHaveLength(1);
  });

  it("the same route again after 2 s, or a different one in between, is handled again", async () => {
    const m = await mount({ notifications: new Map([[7, notification(7, APPROVAL_SOURCE, "Approval 7: Bash")]]) }, { panel: false });
    m.navigate("notification/7");
    m.advance(ROUTE_DEDUPE_MS);
    m.navigate("notification/7");
    await settle();
    expect(m.fake.requestsTo("GET /notifications/:id")).toHaveLength(2);
    m.navigate("invalid-link");
    m.navigate("notification/7");
    await settle();
    expect(m.fake.requestsTo("GET /notifications/:id")).toHaveLength(3);
  });

  it("a wall clock stepped back never holds a repeat of the last route: it is handled again", async () => {
    const m = await mount({ notifications: new Map([[7, notification(7, APPROVAL_SOURCE, "Approval 7: Bash")]]) }, { panel: false });
    m.navigate("notification/7");
    m.advance(-60 * 60 * 1000);
    m.navigate("notification/7");
    await settle();
    expect(m.fake.requestsTo("GET /notifications/:id")).toHaveLength(2);
  });

  it("a route received before the host mounts is delivered on mount", async () => {
    const queue = createNavigateQueue();
    queue.receive("notification/7");
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(statusBody()));
    fake.route("GET /notifications/:id", () => ok({ notification: notification(7, APPROVAL_SOURCE, "Approval 7: Bash") }));
    setApi(fake.bridge);
    render(<MenubarHost queue={queue} actions={createMenubarActions()} registry={createCommandRegistry()} />);
    await waitFor(() => expect(window.location.hash).toBe("#/approvals/7"));
  });

  it("only the newest link navigates: an older one answering later is dropped", async () => {
    const m = await mount({}, { panel: false });
    let releaseSeven: ((r: ApiResult<unknown>) => void) | undefined;
    m.fake.route("GET /notifications/:id", (req) => {
      const id = Number(req.params?.id);
      if (id === 7) return new Promise((done) => (releaseSeven = done));
      return ok({ notification: notification(id, APPROVAL_SOURCE, `Approval ${id}: Bash`) });
    });
    m.navigate("notification/7");
    m.navigate("notification/8");
    await waitFor(() => expect(window.location.hash).toBe("#/approvals/8"));
    await act(async () => releaseSeven?.(ok({ notification: notification(7, APPROVAL_SOURCE, "Approval 7: Bash") })));
    await settle();
    expect(window.location.hash).toBe("#/approvals/8");
  });

  it("a link to the approval already open tells the screen again (a hashchange), so it re-selects", async () => {
    const m = await mount({ notifications: new Map([[7, notification(7, APPROVAL_SOURCE, "Approval 7: Bash")]]) }, { panel: false });
    window.location.hash = "#/approvals/7";
    const changes = vi.fn();
    window.addEventListener("hashchange", changes);
    m.navigate("notification/7");
    await waitFor(() => expect(changes).toHaveBeenCalled());
    window.removeEventListener("hashchange", changes);
    expect(window.location.hash).toBe("#/approvals/7");
  });
});

describe("linkTarget", () => {
  it("maps only the closed list; anything else opens nothing", () => {
    const answer = (body: unknown): ApiResult<unknown> => ({ ok: true, status: 200, body });
    expect(linkTarget(answer({ notification: { source: APPROVAL_SOURCE, title: "Approval 12: Bash" } }))).toEqual({ kind: "open", hash: approvalHash(12) });
    expect(linkTarget(answer({ notification: { source: "agent:a b", title: "x" } }))).toEqual({ kind: "open", hash: "#/chat/a%20b" });
    expect(linkTarget(answer({ notification: { source: "trigger:4", title: "x" } }))).toEqual({ kind: "open", hash: "#/chat" });
    expect(linkTarget(answer({ notification: { source: "kernel:service", title: "x" } }))).toEqual({ kind: "stay" });
    for (const body of [
      null,
      "x",
      { notification: null },
      { notification: { source: 7, title: "Approval 1: x" } },
      { notification: { source: APPROVAL_SOURCE, title: 7 } },
      { notification: { source: APPROVAL_SOURCE, title: "Approval 0: x" } },
      { notification: { source: APPROVAL_SOURCE, title: " Approval 1: x" } },
      { notification: { source: "trigger:abc", title: "x" } },
      { notification: { source: "kernel:", title: "x" } },
      { notification: { source: "webhook:1", title: "Approval 1: x" } },
    ]) {
      expect(linkTarget(answer(body)), JSON.stringify(body)).toEqual({ kind: "nothing" });
    }
    expect(linkTarget(undefined)).toEqual({ kind: "nothing" });
    expect(linkTarget({ ok: false, status: 404, body: { error: "not_found" } })).toEqual({ kind: "nothing" });
    expect(linkTarget({ ok: false, status: 0, connection: { state: "unreachable", reason: "timeout" } })).toEqual({ kind: "nothing" });
  });
});

// ---- commands and actions ------------------------------------------------------------------

const ACTIONS: readonly KernelAction[] = ["pause-all", "unpause", "kill-switch", "resume"];

function enabledOf(registry: CommandRegistry): Record<KernelAction, boolean | undefined> {
  return Object.fromEntries(ACTIONS.map((a) => [a, registry.get(MENUBAR_COMMANDS[a])?.enabled?.()])) as Record<KernelAction, boolean | undefined>;
}

describe("the commands", () => {
  it("AC7: the four menubar.* commands, group Kernel, no shortcut; removed on unmount", async () => {
    const m = await mount({}, { panel: false });
    const listed = m.registry.list().filter((c) => c.owner === "menubar");
    expect(listed.map((c) => c.id)).toEqual(["menubar.pause-all", "menubar.unpause", "menubar.kill-switch", "menubar.resume"]);
    for (const command of listed) {
      expect(command.group).toBe(MENUBAR_GROUP);
      expect(command.shortcut).toBeUndefined();
    }
    m.unmount();
    expect(m.registry.list().filter((c) => c.owner === "menubar")).toEqual([]);
  });

  it("AC7: enabled follows the kernel's status, as each GET /status answers", async () => {
    const m = await mount({}, { panel: false });
    expect(enabledOf(m.registry)).toEqual({ "pause-all": true, unpause: false, "kill-switch": true, resume: false });
    let eventId = 0;
    const kernelSays = async (status: StatusBody): Promise<void> => {
      m.kernel.status = status;
      eventId += 1;
      // An event the store routes to `status` (an `event_*` kind): the store reads GET /status again.
      act(() => m.fake.emit({ type: "event", id: eventId, at: "2026-10-23T09:00:00.000Z", kind: "event_done", session_id: null, task_id: null, payload: {} }));
      await settle();
      await act(async () => new Promise((done) => setTimeout(done, 300)));
    };
    await kernelSays(statusBody({ paused: true }));
    expect(enabledOf(m.registry)).toEqual({ "pause-all": false, unpause: true, "kill-switch": true, resume: true });
    await kernelSays(statusBody({ kill_switch: { engaged: true, since: null } }));
    expect(enabledOf(m.registry)).toEqual({ "pause-all": true, unpause: false, "kill-switch": false, resume: true });
    // A disabled command's run sends nothing.
    await act(async () => m.registry.get(MENUBAR_COMMANDS["kill-switch"])?.run());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () => m.registry.get(MENUBAR_COMMANDS.unpause)?.run());
    await settle();
    expect(posts(m.fake)).toEqual([]);
  });

  it("actionEnabled: the rules for each state, and nothing before the kernel has answered", () => {
    const at = (status: StatusBody | undefined) => Object.fromEntries(ACTIONS.map((a) => [a, actionEnabled(status, a)]));
    expect(at(undefined)).toEqual({ "pause-all": false, unpause: false, "kill-switch": false, resume: false });
    expect(at(statusBody())).toEqual({ "pause-all": true, unpause: false, "kill-switch": true, resume: false });
    expect(at(statusBody({ paused: true }))).toEqual({ "pause-all": false, unpause: true, "kill-switch": true, resume: true });
    expect(at(statusBody({ kill_switch: { engaged: true, since: null } }))).toEqual({ "pause-all": true, unpause: false, "kill-switch": false, resume: true });
    const { paused: _omit, ...older } = statusBody();
    expect(at(older as StatusBody)).toEqual({ "pause-all": true, unpause: false, "kill-switch": true, resume: false });
  });

  it("AC2: Pause all sends exactly one POST /pause, then reads GET /status; the state follows only that read", async () => {
    const m = await mount({ applies: false });
    const reads = m.fake.requestsTo("GET /status").length;
    await act(async () => m.registry.get(MENUBAR_COMMANDS["pause-all"])?.run());
    await settle();
    expect(posts(m.fake)).toEqual(["/pause"]);
    await waitFor(() => expect(m.fake.requestsTo("GET /status").length).toBeGreaterThan(reads));
    // The kernel still says paused: false, so nothing reads paused.
    expect(panelState()).toBe("idle");
    expect(screen.getByRole("button", { name: "Pause all" })).toBeTruthy();
    expect(enabledOf(m.registry).unpause).toBe(false);
  });

  it("AC2: once GET /status says paused, the panel and the commands say Unpause, which sends POST /unpause", async () => {
    const m = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Pause all" }));
    await waitFor(() => expect(panelState()).toBe("paused"));
    expect(enabledOf(m.registry)).toEqual({ "pause-all": false, unpause: true, "kill-switch": true, resume: true });
    fireEvent.click(screen.getByRole("button", { name: "Unpause" }));
    await waitFor(() => expect(panelState()).toBe("idle"));
    expect(posts(m.fake)).toEqual(["/pause", "/unpause"]);
  });

  it("AC3: the kill-switch command opens the confirm and sends nothing; Cancel and Escape send nothing; Confirm sends one POST /stop-all", async () => {
    const m = await mount();
    await act(async () => m.registry.get(MENUBAR_COMMANDS["kill-switch"])?.run());
    let dialog = screen.getByRole("alertdialog", { name: KILL_CONFIRM.title });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBe(document.activeElement);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Kill switch…" }));
    dialog = screen.getByRole("alertdialog", { name: KILL_CONFIRM.title });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await settle();
    expect(posts(m.fake)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Kill switch…" }));
    dialog = screen.getByRole("alertdialog", { name: KILL_CONFIRM.title });
    const engage = within(dialog).getByRole("button", { name: KILL_CONFIRM.action });
    fireEvent.click(engage);
    fireEvent.click(engage);
    await waitFor(() => expect(panelState()).toBe("killed"));
    expect(posts(m.fake)).toEqual(["/stop-all"]);
  });

  it("AC3: Resume sends POST /resume", async () => {
    const m = await mount({ status: statusBody({ kill_switch: { engaged: true, since: "2026-10-23T09:00:00.000Z" } }) });
    expect(panelState()).toBe("killed");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(panelState()).toBe("idle"));
    expect(posts(m.fake)).toEqual(["/resume"]);
  });

  it("a refused action toasts why, escaped, and the state stays as read", async () => {
    const m = await mount();
    m.fake.route("POST /pause", () => ({ ok: false, status: 409, body: { error: "conflict", message: "already\u001b[31m paused" } }));
    fireEvent.click(screen.getByRole("button", { name: "Pause all" }));
    await waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0]?.textContent).toContain("Pause all didn't go through.");
    expect(toasts()[0]?.textContent).toContain("already\\x1b[31m paused");
    expect(panelState()).toBe("idle");
  });

  it("a refused POST /stop-all leaves a persistent alert beside the buttons after its toast closes; the next action that goes through clears it", async () => {
    const m = await mount();
    m.fake.route("POST /stop-all", () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }));
    fireEvent.click(screen.getByRole("button", { name: "Kill switch…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: KILL_CONFIRM.title })).getByRole("button", { name: KILL_CONFIRM.action }));
    await waitFor(() => expect(toasts()).toHaveLength(1));
    // The toast closes (as ToastStack does after 6 s); the alert line stays.
    act(() => {
      for (const t of m.actions.getSnapshot().toasts) m.actions.dismiss(t.id);
    });
    await waitFor(() => expect(toasts()).toHaveLength(0));
    const alert = screen.getByTestId("menubar-failure");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe("The kill switch didn't go through. Couldn't reach the kernel; nothing changed.");
    expect(panelState()).toBe("idle");

    // A later action that goes through clears it.
    m.fake.route("POST /stop-all", () => (Object.assign(m.kernel, { status: statusBody({ kill_switch: { engaged: true, since: null } }) }), ok({ engaged: true, sessions: [] })));
    fireEvent.click(screen.getByRole("button", { name: "Kill switch…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: KILL_CONFIRM.title })).getByRole("button", { name: KILL_CONFIRM.action }));
    await waitFor(() => expect(panelState()).toBe("killed"));
    expect(screen.queryByTestId("menubar-failure")).toBeNull();
  });

  it("a failed action's line clears when a GET /status answer shows its goal reached, and only then", async () => {
    const m = await mount({ applies: false }, { panel: false });
    m.fake.route("POST /pause", () => ({ ok: false, status: 409, body: { error: "conflict" } }));
    const actions = createMenubarActions();
    {
      await act(async () => actions.run(m.fake.bridge, "pause-all"));
      expect(actions.getSnapshot().lastFailure?.action).toBe("pause-all");
      actions.observeStatus(statusBody({ paused: false }));
      expect(actions.getSnapshot().lastFailure?.action).toBe("pause-all");
      actions.observeStatus(undefined);
      expect(actions.getSnapshot().lastFailure?.action).toBe("pause-all");
      actions.observeStatus(statusBody({ paused: true }));
      expect(actions.getSnapshot().lastFailure).toBeUndefined();
    }
  });

  it("actionReached: each action's goal, reached and not", () => {
    const killed = statusBody({ kill_switch: { engaged: true, since: null } });
    const paused = statusBody({ paused: true });
    const rest = statusBody();
    expect(actionReached(paused, "pause-all")).toBe(true);
    expect(actionReached(rest, "pause-all")).toBe(false);
    expect(actionReached(rest, "unpause")).toBe(true);
    expect(actionReached(paused, "unpause")).toBe(false);
    expect(actionReached(rest, "resume")).toBe(true);
    expect(actionReached(paused, "resume")).toBe(false);
    expect(actionReached(killed, "resume")).toBe(false);
    expect(actionReached(killed, "kill-switch")).toBe(true);
    expect(actionReached(rest, "kill-switch")).toBe(false);
  });

  it("another action going through leaves a refused kill switch's line standing", async () => {
    const m = await mount();
    m.fake.route("POST /stop-all", () => ({ ok: false, status: 409, body: { error: "conflict" } }));
    fireEvent.click(screen.getByRole("button", { name: "Kill switch…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: KILL_CONFIRM.title })).getByRole("button", { name: KILL_CONFIRM.action }));
    await waitFor(() => expect(screen.getByTestId("menubar-failure")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Pause all" }));
    await waitFor(() => expect(panelState()).toBe("paused"));
    await settle();
    expect(m.actions.getSnapshot().lastFailure?.action).toBe("kill-switch");
    expect(screen.getByTestId("menubar-failure").textContent).toContain("The kill switch didn't go through.");
  });

  it("an older action answering after a newer failure does not clear it", async () => {
    const m = await mount({ applies: false });
    let releasePause: ((r: ApiResult<unknown>) => void) | undefined;
    m.fake.route("POST /pause", () => new Promise((done) => (releasePause = done)));
    m.fake.route("POST /stop-all", () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }));
    fireEvent.click(screen.getByRole("button", { name: "Pause all" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Kill switch…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: KILL_CONFIRM.title })).getByRole("button", { name: KILL_CONFIRM.action }));
    await waitFor(() => expect(m.actions.getSnapshot().lastFailure?.action).toBe("kill-switch"));
    await act(async () => releasePause?.(ok({ paused: true })));
    await settle();
    expect(m.actions.getSnapshot().lastFailure?.action).toBe("kill-switch");
    expect(screen.getByTestId("menubar-failure")).toBeTruthy();
  });

  it("a mounted host clears the failure line when a store refetch of GET /status shows its goal reached", async () => {
    const m = await mount({ applies: false });
    m.fake.route("POST /stop-all", () => ({ ok: false, status: 409, body: { error: "conflict" } }));
    fireEvent.click(screen.getByRole("button", { name: "Kill switch…" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: KILL_CONFIRM.title })).getByRole("button", { name: KILL_CONFIRM.action }));
    await waitFor(() => expect(screen.getByTestId("menubar-failure")).toBeTruthy());
    // Someone else engages it (the tray, a terminal): the store reads GET /status again on a feed event.
    m.kernel.status = statusBody({ kill_switch: { engaged: true, since: null } });
    act(() => m.fake.emit({ type: "event", id: 1, at: "2026-10-23T09:00:00.000Z", kind: "event_done", session_id: null, task_id: null, payload: {} }));
    await waitFor(() => expect(panelState()).toBe("killed"));
    await waitFor(() => expect(screen.queryByTestId("menubar-failure")).toBeNull());
    expect(posts(m.fake)).toEqual(["/stop-all"]);
  });

  it("a second press while the request is in flight sends nothing more", async () => {
    const m = await mount();
    let release: ((r: ApiResult<unknown>) => void) | undefined;
    m.fake.route("POST /pause", () => new Promise((done) => (release = done)));
    const button = screen.getByRole("button", { name: "Pause all" });
    fireEvent.click(button);
    await settle();
    fireEvent.click(button);
    await act(async () => m.actions.run(m.fake.bridge, "pause-all"));
    expect(posts(m.fake)).toEqual(["/pause"]);
    await act(async () => release?.(ok({ paused: true })));
    await settle();
  });

  it("each action's path is its contract route", () => {
    expect(ACTION_PATHS).toEqual({ "pause-all": "/pause", unpause: "/unpause", "kill-switch": "/stop-all", resume: "/resume" });
  });
});

// ---- the panel -----------------------------------------------------------------------------

describe("the status panel", () => {
  it("with no window.api renders its root and no store read", () => {
    setApi(undefined);
    render(<MenubarPanel actions={createMenubarActions()} />);
    expect(panelState()).toBe("no-bridge");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("loading while GET /status has not answered", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => new Promise<never>(() => undefined));
    setApi(fake.bridge);
    render(<MenubarPanel actions={createMenubarActions()} />);
    await settle();
    expect(panelState()).toBe("loading");
    expect(screen.getByTestId("menubar-loading").textContent).toContain("Reading the kernel's state");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("error when GET /status is refused, with the kernel's code", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    setApi(fake.bridge);
    render(<MenubarPanel actions={createMenubarActions()} />);
    await waitFor(() => expect(panelState()).toBe("error"));
    expect(screen.getByTestId("menubar-error").textContent).toContain("Couldn't read the kernel's state.");
    expect(screen.getByTestId("menubar-error").textContent).toContain("500 internal");
  });

  const STATES: readonly { readonly name: string; readonly kernel: Partial<Kernel>; readonly state: string; readonly word: string; readonly meta: string }[] = [
    { name: "idle", kernel: {}, state: "idle", word: "idle", meta: "0 running · 0 waiting on you" },
    { name: "working", kernel: { status: statusBody({ sessions: [runningSession(1), runningSession(2)] }) }, state: "working", word: "working", meta: "2 running · 0 waiting on you" },
    { name: "waiting", kernel: { approvals: [approval(1), approval(2)] }, state: "waiting", word: "waiting on you", meta: "0 running · 2 waiting on you" },
    { name: "paused", kernel: { status: statusBody({ paused: true }) }, state: "paused", word: "paused", meta: "0 running · 0 waiting on you" },
    { name: "cap", kernel: { status: statusBody({ cap_state: CAPPED }) }, state: "cap", word: "paused at cap", meta: "0 running · 0 waiting on you · resets " },
    {
      name: "killed",
      kernel: { status: statusBody({ kill_switch: { engaged: true, since: "2026-10-23T09:00:00.000Z" } }) },
      state: "killed",
      word: "killed",
      meta: "0 running · 0 waiting on you",
    },
  ];

  for (const row of STATES) {
    it(`${row.name}: the word, the dot, and "N running · N waiting on you"`, async () => {
      await mount(row.kernel);
      await waitFor(() => expect(panelState()).toBe(row.state));
      const status = screen.getByTestId("menubar-status");
      expect(status.querySelector(".status-label")?.textContent).toBe(row.word);
      expect(screen.getByTestId("menubar-meta").textContent).toContain(row.meta);
      expect(screen.getByText(TRAY_ONLY_NOTE)).toBeTruthy();
      expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    });
  }

  it("the dots: cap and paused park, killed is a stop (failed)", async () => {
    await mount({ status: statusBody({ kill_switch: { engaged: true, since: null } }) });
    expect(screen.getByTestId("menubar-status").querySelector(".status-dot")?.getAttribute("data-state")).toBe("failed");
    cleanup();
    await mount({ status: statusBody({ cap_state: CAPPED }) });
    expect(screen.getByTestId("menubar-status").querySelector(".status-dot")?.getAttribute("data-state")).toBe("paused");
  });

  it("AC7: Approvals, Pause all, Kill switch… and Resume are native buttons, enabled by the same rules as the commands", async () => {
    await mount({ approvals: [approval(1), approval(2)] });
    const approvals = screen.getByRole("button", { name: /^Approvals/ });
    expect(within(approvals).getByRole("img", { name: "2 pending" })).toBeTruthy();
    for (const name of ["Pause all", "Kill switch…", "Resume"]) expect(screen.getByRole("button", { name }).tagName).toBe("BUTTON");
    expect((screen.getByRole("button", { name: "Pause all" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Kill switch…" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Resume" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(approvals);
    expect(window.location.hash).toBe("#/approvals");
  });

  it("the kill switch disabling its own focused button hands focus to Resume, never to <body>", async () => {
    await mount();
    const kill = screen.getByRole("button", { name: "Kill switch…" });
    kill.focus();
    fireEvent.click(kill);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: KILL_CONFIRM.action }));
    await waitFor(() => expect(panelState()).toBe("killed"));
    await settle();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Resume" }));
  });

  it("a failed read after a good one keeps the state and says it is the last one reported", async () => {
    const m = await mount({ status: statusBody({ paused: true }) });
    m.fake.route("GET /status", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    fireEvent.click(screen.getByRole("button", { name: "Unpause" }));
    await waitFor(() => expect(screen.getByTestId("menubar-stale")).toBeTruthy());
    expect(panelState()).toBe("paused");
  });

  it("a failed GET /approvals after a good one says the count shown is the last one reported", async () => {
    const m = await mount({ approvals: [approval(1), approval(2)] });
    expect(screen.queryByTestId("menubar-stale")).toBeNull();
    m.fake.route("GET /approvals", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    await act(async () => {
      liveStoreFor((window as unknown as { api: StudioBridge }).api).refetch("approvals");
    });
    await waitFor(() => expect(screen.getByTestId("menubar-stale")).toBeTruthy());
    expect(screen.getByTestId("menubar-meta").textContent).toContain("2 waiting on you");
  });
});

// ---- the Recent list -----------------------------------------------------------------------

/** `minutes` before now, as the kernel writes a time. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** The Recent rows on screen, top to bottom. */
function recentRows(): HTMLElement[] {
  return within(screen.getByTestId("menubar-recent")).queryAllByRole("option");
}

function rowKeys(): (string | undefined)[] {
  return recentRows().map((row) => row.dataset.key);
}

/** Notifications #1..#n, each `n - id` minutes old (the newest is #n). */
function manyNotifications(n: number): Map<number, NotificationRow> {
  return new Map(Array.from({ length: n }, (_, i) => i + 1).map((id) => [id, { ...notification(id, "agent:pim", `Note ${id}`), created_at: minutesAgo(n - id) }]));
}

describe("the Recent list", () => {
  it("AC1: three notifications show newest first, each with its title, its age and its delivery status", async () => {
    await mount({
      notifications: new Map([
        [1, { ...notification(1, "agent:pim", "PR #412 reviewed"), created_at: minutesAgo(90), delivered_at: "2026-10-23T08:00:02.000Z" }],
        [2, { ...notification(2, "trigger:4", "Playbook fired", "unsupported"), created_at: minutesAgo(5), delivery_detail: "no click-capable notifier: posted without a click action" }],
        [3, { ...notification(3, APPROVAL_SOURCE, "Approval 3: Bash", "failed"), created_at: minutesAgo(0) }],
      ]),
    });
    await waitFor(() => expect(recentRows()).toHaveLength(3));
    expect(rowKeys()).toEqual(["3", "2", "1"]);
    const [failed, unsupported, delivered] = recentRows() as [HTMLElement, HTMLElement, HTMLElement];
    expect(failed.querySelector(".list-subject")?.textContent).toBe("Approval 3: Bash");
    expect(failed.querySelector(".list-aside")?.textContent).toBe("just now");
    expect(within(failed).getByRole("img", { name: "failed" }).dataset.state).toBe("failed");
    expect(failed.querySelector(".list-meta")?.textContent).toBe("failed");
    expect(unsupported.querySelector(".list-subject")?.textContent).toBe("Playbook fired");
    expect(unsupported.querySelector(".list-aside")?.textContent).toBe("5m ago");
    expect(within(unsupported).getByRole("img", { name: "unsupported" }).dataset.state).toBe("paused");
    expect(unsupported.querySelector(".list-meta")?.textContent).toBe("unsupported · no click-capable notifier: posted without a click action");
    expect(delivered.querySelector(".list-subject")?.textContent).toBe("PR #412 reviewed");
    expect(delivered.querySelector(".list-aside")?.textContent).toBe("1h ago");
    // Delivered is at rest: the idle dot, its word in the meta line, and no "verified" text beside the dot.
    expect(within(delivered).getByRole("img", { name: "delivered" }).dataset.state).toBe("idle");
    expect(delivered.querySelector(".list-meta")?.textContent).toBe("delivered");
    expect(delivered.querySelector(".status-meta")).toBeNull();
    // No row is an action button the panel's focus hand-off would walk.
    for (const row of recentRows()) expect(row.hasAttribute("data-action")).toBe(false);
  });

  it("AC2: opening an approval's notification by click makes one GET /notifications/7, lands on #/approvals/7, and sends no POST", async () => {
    const m = await mount({ notifications: new Map([[7, notification(7, APPROVAL_SOURCE, "Approval 7: Bash")]]) });
    await waitFor(() => expect(recentRows()).toHaveLength(1));
    const from = m.fake.requests.length;
    fireEvent.click(recentRows()[0] as HTMLElement);
    await waitFor(() => expect(window.location.hash).toBe("#/approvals/7"));
    await settle();
    expect(requestsAfter(m.fake, from).filter((r) => r.path === "/notifications/:id")).toEqual([{ method: "GET", path: "/notifications/:id", params: { id: 7 } }]);
    expect(posts(m.fake)).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it("AC2: opening by keyboard (arrow to the row, Enter) lands where the deep link does, with one GET /notifications/7", async () => {
    const m = await mount({
      notifications: new Map([
        [7, notification(7, APPROVAL_SOURCE, "Approval 7: Bash")],
        [8, notification(8, "agent:pim", "PR #412 reviewed")],
      ]),
    });
    await waitFor(() => expect(rowKeys()).toEqual(["8", "7"]));
    const from = m.fake.requests.length;
    const first = recentRows()[0] as HTMLElement;
    expect(first.tabIndex).toBe(0);
    act(() => first.focus());
    // Nothing is selected yet: the List's first ArrowDown selects the first row, the second moves to #7.
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(first.getAttribute("aria-selected")).toBe("true"));
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const seventh = recentRows()[1] as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(seventh));
    fireEvent.keyDown(seventh, { key: "Enter" });
    await waitFor(() => expect(window.location.hash).toBe("#/approvals/7"));
    await settle();
    expect(requestsAfter(m.fake, from).filter((r) => r.path === "/notifications/:id")).toEqual([{ method: "GET", path: "/notifications/:id", params: { id: 7 } }]);
    expect(posts(m.fake)).toEqual([]);

    // The same as the link: a fresh mount, the route as the main process sends it.
    cleanup();
    window.location.hash = "";
    const link = await mount({ notifications: new Map([[7, notification(7, APPROVAL_SOURCE, "Approval 7: Bash")]]) }, { panel: false });
    const linkFrom = link.fake.requests.length;
    link.navigate("notification/7");
    await waitFor(() => expect(window.location.hash).toBe("#/approvals/7"));
    expect(requestsAfter(link.fake, linkFrom)).toEqual([{ method: "GET", path: "/notifications/:id", params: { id: 7 } }]);
  });

  it("a row opens only through the queue: the panel's queue receives notification/<id>, and nothing else is requested", async () => {
    const m = await mount({ notifications: new Map([[3, notification(3, "agent:pim", "PR #412 reviewed")]]) });
    await waitFor(() => expect(recentRows()).toHaveLength(1));
    const received = vi.spyOn(m.queue, "receive");
    fireEvent.click(recentRows()[0] as HTMLElement);
    expect(received.mock.calls).toEqual([["notification/3"]]);
    await waitFor(() => expect(window.location.hash).toBe("#/chat/pim"));
  });

  it("AC3: an empty list shows No notifications yet and no row", async () => {
    await mount({ notifications: new Map() });
    await waitFor(() => expect(within(screen.getByTestId("menubar-recent")).getByText("No notifications yet")).toBeTruthy());
    expect(RECENT_EMPTY_TEXT).toBe("No notifications yet");
    expect(recentRows()).toEqual([]);
  });

  it("AC4: a notification_created event adds the new row at the top, without a remount of the rows already shown", async () => {
    const m = await mount({ notifications: manyNotifications(3) });
    await waitFor(() => expect(rowKeys()).toEqual(["3", "2", "1"]));
    // The feed's first frame makes the store live, which refetches every resource; only then is a refetch the event's own.
    act(() => m.fake.emit({ type: "event", id: 1, at: "2026-10-23T09:00:00.000Z", kind: "event_done", session_id: null, task_id: null, payload: {} }));
    await settle();
    await act(async () => new Promise((done) => setTimeout(done, 300)));
    const before = recentRows();
    const reads = m.fake.requestsTo("GET /notifications").length;
    m.kernel.notifications.set(4, { ...notification(4, APPROVAL_SOURCE, "Approval 4: Bash"), created_at: minutesAgo(0) });
    act(() => m.fake.emit({ type: "event", id: 2, at: "2026-10-23T09:00:01.000Z", kind: "notification_created", session_id: null, task_id: null, payload: {} }));
    await waitFor(() => expect(m.fake.requestsTo("GET /notifications").length).toBeGreaterThan(reads));
    await waitFor(() => expect(rowKeys()).toEqual(["4", "3", "2", "1"]));
    // The same nodes: React kept the rows (keyed by id), so the List's scroll anchoring has its anchor.
    expect(recentRows().slice(1)).toEqual(before);
  });

  /** Makes the store live, then stubs the Recent list's `scrollTop` (jsdom has no layout) at `top`; returns the list. */
  async function liveWithScroll(m: Mounted, top: number): Promise<{ readonly list: HTMLElement; readonly scroll: { top: number } }> {
    act(() => m.fake.emit({ type: "event", id: 1, at: "2026-10-23T09:00:00.000Z", kind: "event_done", session_id: null, task_id: null, payload: {} }));
    await settle();
    await act(async () => new Promise((done) => setTimeout(done, 300)));
    const list = screen.getByTestId("menubar-recent").querySelector<HTMLElement>(".menubar-recent-list") as HTMLElement;
    const scroll = { top };
    Object.defineProperty(list, "scrollTop", { configurable: true, get: () => scroll.top, set: (value: number) => (scroll.top = value) });
    return { list, scroll };
  }

  async function arrive(m: Mounted, id: number, eventId: number): Promise<void> {
    const reads = m.fake.requestsTo("GET /notifications").length;
    m.kernel.notifications.set(id, { ...notification(id, APPROVAL_SOURCE, `Approval ${id}: Bash`), created_at: minutesAgo(0) });
    act(() => m.fake.emit({ type: "event", id: eventId, at: "2026-10-23T09:00:01.000Z", kind: "notification_created", session_id: null, task_id: null, payload: {} }));
    await waitFor(() => expect(m.fake.requestsTo("GET /notifications").length).toBeGreaterThan(reads));
    await waitFor(() => expect(rowKeys()[0]).toBe(String(id)));
  }

  it("AC4: a row that lands above the view (list not at its top) shows the new-above hint; activating it scrolls to the top, clears it and focuses the new row", async () => {
    const m = await mount({ notifications: manyNotifications(6) });
    await waitFor(() => expect(recentRows()).toHaveLength(6));
    const { list, scroll } = await liveWithScroll(m, 44);
    const before = recentRows();
    await arrive(m, 7, 2);
    const hint = await screen.findByTestId("menubar-recent-new");
    expect(hint.textContent).toBe("1 new notification above");
    expect(newAboveText(2)).toBe("2 new notifications above");
    // Anchoring is untouched: the same row nodes, and the hint is no action the focus hand-off walks, nor a panel state.
    expect(recentRows().slice(1)).toEqual(before);
    expect(hint.hasAttribute("data-action")).toBe(false);
    expect(hint.closest("[aria-live='polite']")).not.toBeNull();
    expect(panelState()).toBe("idle");
    expect(screen.queryByTestId("menubar-stale")).toBeNull();
    // A second arrival while the hint shows counts up.
    await arrive(m, 8, 3);
    await waitFor(() => expect(screen.getByTestId("menubar-recent-new").textContent).toBe("2 new notifications above"));
    fireEvent.click(screen.getByTestId("menubar-recent-new"));
    expect(scroll.top).toBe(0);
    expect(document.activeElement).toBe(recentRows()[0]);
    // The browser's scroll event (jsdom fires none for a scrollTop write) is what clears the hint.
    fireEvent.scroll(list);
    await waitFor(() => expect(screen.queryByTestId("menubar-recent-new")).toBeNull());
    expect(document.activeElement).toBe(recentRows()[0]);
    expect(recentRows()[0]?.dataset.key).toBe("8");
  });

  it("AC4: scrolling the list to its top clears the hint; a row arriving while the list is at its top shows no hint", async () => {
    const m = await mount({ notifications: manyNotifications(6) });
    await waitFor(() => expect(recentRows()).toHaveLength(6));
    const { list, scroll } = await liveWithScroll(m, 88);
    await arrive(m, 7, 2);
    await screen.findByTestId("menubar-recent-new");
    // Scrolled part way up: the new row is still above the view, the hint stays.
    scroll.top = 20;
    fireEvent.scroll(list);
    expect(screen.queryByTestId("menubar-recent-new")).not.toBeNull();
    scroll.top = 0;
    fireEvent.scroll(list);
    await waitFor(() => expect(screen.queryByTestId("menubar-recent-new")).toBeNull());
    // At the top the new row is in view: no hint.
    await arrive(m, 8, 3);
    await settle();
    expect(screen.queryByTestId("menubar-recent-new")).toBeNull();
  });

  it(`AC5: more than ${RECENT_LIMIT} notifications show exactly the newest ${RECENT_LIMIT}`, async () => {
    await mount({ notifications: manyNotifications(25) });
    await waitFor(() => expect(recentRows()).toHaveLength(RECENT_LIMIT));
    expect(rowKeys()).toEqual(Array.from({ length: RECENT_LIMIT }, (_, i) => String(25 - i)));
    // The rows sit in the List's own scroll container, which menubar.css bounds.
    expect(recentRows()[0]?.closest(".list")?.classList.contains("menubar-recent-list")).toBe(true);
  });

  it("AC6: while GET /notifications has not answered, skeleton rows show and never a spinner; the panel's state is the status read's", async () => {
    const m = await mount({}, { panel: false });
    m.fake.route("GET /notifications", () => new Promise<never>(() => undefined));
    render(<MenubarPanel actions={m.actions} queue={m.queue} />);
    await settle();
    expect(panelState()).toBe("idle");
    const recent = screen.getByTestId("menubar-recent");
    await waitFor(() => expect(recent.querySelectorAll(".list-skeleton").length).toBeGreaterThan(0));
    expect(recent.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(recent.querySelector(".btn-spinner, [role='progressbar']")).toBeNull();
    expect(recentRows()).toEqual([]);
    expect(within(recent).queryByText(RECENT_EMPTY_TEXT)).toBeNull();
  });

  it("AC6: with the kernel unreachable the panel shows its error view, and no row is invented", async () => {
    const fake = fakeBridge({ state: "unreachable", reason: "connection_failed" });
    fake.route("GET /status", () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }));
    fake.route("GET /notifications", () => ok({ notifications: [notification(7, APPROVAL_SOURCE, "Approval 7: Bash")] }));
    setApi(fake.bridge);
    render(<MenubarPanel actions={createMenubarActions()} queue={createNavigateQueue()} />);
    await waitFor(() => expect(panelState()).toBe("error"));
    await settle();
    expect(screen.getByTestId("menubar-error")).toBeTruthy();
    expect(screen.queryByTestId("menubar-recent")).toBeNull();
    expect(screen.queryAllByRole("option")).toEqual([]);
  });

  it("AC10: a failed GET /notifications shows Recent's own line; the panel's state is the status read's and it is not stale", async () => {
    const m = await mount({ approvals: [approval(1)] }, { panel: false });
    m.fake.route("GET /notifications", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    render(<MenubarPanel actions={m.actions} queue={m.queue} />);
    await waitFor(() => expect(screen.getByTestId("menubar-recent-error")).toBeTruthy());
    expect(screen.getByTestId("menubar-recent-error").textContent).toContain("Couldn't read the notifications.");
    expect(screen.getByTestId("menubar-recent-error").textContent).toContain("500 internal");
    expect(panelState()).toBe("waiting");
    expect(screen.queryByTestId("menubar-stale")).toBeNull();
    expect(recentRows()).toEqual([]);
  });

  it("AC10: a failed refetch after a good one keeps the rows read, says so, and leaves the panel's stale line alone", async () => {
    const m = await mount({ notifications: manyNotifications(2) });
    await waitFor(() => expect(recentRows()).toHaveLength(2));
    m.fake.route("GET /notifications", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    await act(async () => {
      liveStoreFor((window as unknown as { api: StudioBridge }).api).refetch("notifications");
    });
    await waitFor(() => expect(screen.getByTestId("menubar-recent-error").textContent).toContain("the latest read failed"));
    expect(recentRows()).toHaveLength(2);
    expect(panelState()).toBe("idle");
    expect(screen.queryByTestId("menubar-stale")).toBeNull();
  });

  it("kernel text in a row is escaped; a status outside the closed set shows its word on an idle dot", () => {
    const item = recentItem({ ...notification(5, "agent:pim", "bad\u001b[31m title", "bounced\u0007"), delivery_detail: "why\u001b" }, Date.now());
    expect(item.subject).toBe("bad\\x1b[31m title");
    expect(item.status).toBe("idle");
    expect(item.statusLabel).toBe("bounced\\x07");
    expect(item.meta).toBe("bounced\\x07 · why\\x1b");
    // No row is an `ok` dot, so none carries StatusDot's "verified" text in the status column.
    expect(recentItem({ ...notification(6, "agent:pim", "x"), delivered_at: "2026-10-23T08:00:02.000Z" }, Date.now()).verified).toBeUndefined();
  });

  it("ageText: just now, minutes, hours, days; a clock behind the kernel is just now; not a time is a dash", () => {
    const now = Date.parse("2026-10-24T12:00:00.000Z");
    expect(ageText("2026-10-24T11:59:30.000Z", now)).toBe("just now");
    expect(ageText("2026-10-24T12:05:00.000Z", now)).toBe("just now");
    expect(ageText("2026-10-24T11:59:00.000Z", now)).toBe("1m ago");
    expect(ageText("2026-10-24T11:00:01.000Z", now)).toBe("59m ago");
    expect(ageText("2026-10-24T11:00:00.000Z", now)).toBe("1h ago");
    expect(ageText("2026-10-23T12:00:01.000Z", now)).toBe("23h ago");
    expect(ageText("2026-10-23T12:00:00.000Z", now)).toBe("1d ago");
    expect(ageText("not a time", now)).toBe("—");
  });
});
