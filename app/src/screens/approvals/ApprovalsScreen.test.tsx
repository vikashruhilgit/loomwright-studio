// @vitest-environment jsdom
// The Approvals screen over a scriptable bridge (`../../store/fake-bridge`):
// the bridge guard, the pending-first inbox selected by id, the detail
// fields, A / ⇧A / D and what the kernel answered, the escaped payload, the
// grants with a confirmed Revoke, and the registered ⌘K commands.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, Approval, BrainMessage, EventFrame, Grant, SessionSummary, StudioBridge } from "../../api/contract";
import { installKeyboardMap } from "../../commands/keyboard";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { APPROVAL_COMMANDS, ApprovalsScreen, EMPTY_TITLE } from "./ApprovalsScreen";
import { screen as approvalsScreen } from "./index";

const ESC = "\u001b";
const RLO = "\u202e";
const ALWAYS_SENTENCE = "always needs an approval the rail held from a playbook session; approve it once";

function approval(id: number, overrides: Partial<Approval> = {}): Approval {
  return {
    id,
    requesting_agent: "ada",
    requesting_session: null,
    action: `comment on #${id}`,
    payload: { tool: "mcp__github__comment", body: `review ${id}` },
    requested_at: `2026-10-22T08:0${id}:00.000Z`,
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: { id: 9, slug: "review-prs", version: 3 },
    ...overrides,
  };
}

function grant(id: number, overrides: Partial<Grant> = {}): Grant {
  return {
    id,
    playbook: { id: 9, slug: "review-prs", version: 3 },
    action: "post review",
    payload: { tool: "mcp__github__review" },
    requesting_agent: "ada",
    granted_at: "2026-10-21T09:00:00.000Z",
    current: true,
    ...overrides,
  };
}

function session(id: number, cwd: string | null): SessionSummary {
  return { id, agent: "wright", status: "running", model: null, started: null, ended: null, tokens: null, cwd, playbook: null };
}

function brainMessage(id: number, source: string, text: string): BrainMessage {
  return {
    id,
    queue_id: id,
    agent: "wright",
    source,
    text,
    status: "queued",
    session_id: null,
    reply_text: null,
    detail: null,
    created_at: "2026-10-22T08:10:00.000Z",
    updated_at: "2026-10-22T08:10:00.000Z",
    from_agent: null,
    depth: 0,
    reply_to: null,
    workspace: null,
  };
}

interface Kernel {
  approvals: Approval[];
  decided: Approval[];
  grants: Grant[];
  messages: BrainMessage[];
  sessions: SessionSummary[];
}

let eventId = 0;
function event(kind: string): EventFrame {
  eventId += 1;
  return { type: "event", id: eventId, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload: {} };
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
  const kernel: Kernel = { approvals: [], decided: [], grants: [], messages: [], sessions: [], ...initial };
  const fake = fakeBridge();
  fake.route("GET /status", () => ok({ kernel: { version: "0", uptime_s: 1, pid: 1 } }));
  fake.route("GET /approvals", (req) => ok({ approvals: req.query?.all === "1" ? [...kernel.approvals, ...kernel.decided] : [...kernel.approvals] }));
  fake.route("GET /approvals/grants", () => ok({ grants: [...kernel.grants] }));
  fake.route("GET /messages", () => ok({ messages: [...kernel.messages] }));
  fake.route("GET /sessions", () => ok({ sessions: [...kernel.sessions] }));
  setApi(fake.bridge);
  const view = render(<ApprovalsScreen registry={registry} />);
  await waitFor(() => expect(screen.getByTestId("screen-approvals").dataset.state).not.toBe("loading"));
  return { fake, kernel, registry, unmount: view.unmount };
}

/** The rows' approval ids, in order. */
function rowIds(): number[] {
  return screen.queryAllByRole("option").map((row) => Number(row.getAttribute("data-key")));
}

function selectedId(): number | undefined {
  const row = screen.queryAllByRole("option").find((r) => r.getAttribute("aria-selected") === "true");
  return row === undefined ? undefined : Number(row.getAttribute("data-key"));
}

function press(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(document.body, { key, ...init });
}

function posts(fake: FakeBridge, key: string): ApiRequest[] {
  return fake.requestsTo(key).map((r) => r.req);
}

afterEach(() => {
  cleanup();
  setApi(undefined);
  window.location.hash = "";
});

describe("the bridge guard", () => {
  it("with no window.api, renders the root testid without throwing and calls no store hook", () => {
    setApi(undefined);
    expect(() => render(<ApprovalsScreen registry={createCommandRegistry()} />)).not.toThrow();
    const root = screen.getByTestId("screen-approvals");
    expect(root.dataset.state).toBe("no-bridge");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("keeps the shell's screen definition", () => {
    expect(approvalsScreen.id).toBe("approvals");
    expect(approvalsScreen.title).toBe("Approvals");
    expect(approvalsScreen.nav).toEqual({ label: "Approvals", order: 3, shortcut: "⌘3" });
  });
});

describe("the inbox", () => {
  it("AC1: oldest first and selected; a third arriving keeps the selection and the order; the selection is an id", async () => {
    const { fake, kernel } = await mount({ approvals: [approval(2), approval(1)] });
    expect(rowIds()).toEqual([1, 2]);
    expect(selectedId()).toBe(1);
    expect(screen.getByTestId("approvals-count").textContent).toBe("2 pending");

    kernel.approvals.push(approval(3));
    act(() => fake.emit(event("approval_requested")));
    await waitFor(() => expect(rowIds()).toEqual([1, 2, 3]));
    expect(selectedId()).toBe(1);

    press("j");
    expect(selectedId()).toBe(2);
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("2");

    // #1 is decided elsewhere: the next read no longer has it.
    kernel.approvals.splice(
      kernel.approvals.findIndex((a) => a.id === 1),
      1,
    );
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(rowIds()).toEqual([2, 3]));
    expect(selectedId()).toBe(2);
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("2");
  });

  it("the selected approval leaving the list never hands A / ⇧A / D to another; the owner picks one first", async () => {
    const { fake, kernel, registry } = await mount({ approvals: [approval(1), approval(2)] });
    fake.route("POST /approvals/:id/approve", (req) => ok({ approval: { ...approval(Number(req.params?.id)), status: "approved", decision: "once" } }));
    press("j");
    expect(selectedId()).toBe(2);
    kernel.approvals = [approval(1)];
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(rowIds()).toEqual([1]));
    expect(selectedId()).toBeUndefined();
    expect(screen.getByTestId("approval-gone").textContent).toContain("#2 is no longer waiting on you");
    expect(screen.queryByTestId("approval-detail")).toBeNull();
    press("a");
    press("A", { shiftKey: true });
    press("d");
    for (const id of [APPROVAL_COMMANDS.approveOnce, APPROVAL_COMMANDS.approveAlways, APPROVAL_COMMANDS.deny]) {
      expect(registry.get(id)?.enabled?.()).toBe(false);
      await act(async () => registry.get(id)?.run());
    }
    expect(fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(0);
    // An explicit move selects again, and only then does A decide.
    press("j");
    expect(selectedId()).toBe(1);
    press("a");
    await waitFor(() => expect(posts(fake, "POST /approvals/:id/approve")).toHaveLength(1));
    expect(posts(fake, "POST /approvals/:id/approve")[0]?.params).toEqual({ id: 1 });
  });

  it("an approval_not_pending notice stays with its approval after it leaves the list", async () => {
    const { fake, kernel } = await mount({ approvals: [approval(1)] });
    fake.route("POST /approvals/:id/deny", () => {
      kernel.approvals = [];
      return { ok: false, status: 409, body: { error: "approval_not_pending", message: "approval 1 is not pending" } };
    });
    press("d");
    await waitFor(() => expect(screen.getByTestId("screen-approvals").dataset.state).toBe("empty"));
    kernel.approvals = [approval(2)];
    act(() => fake.emit(event("approval_requested")));
    await waitFor(() => expect(rowIds()).toEqual([2]));
    expect(screen.getByTestId("approval-gone").dataset.approvalId).toBe("1");
    expect(screen.getByTestId("approval-notice").textContent).toBe("approval 1 is not pending");
    press("a");
    expect(fake.requests.filter((r) => r.req.method === "POST" && r.req.path === "/approvals/:id/approve")).toHaveLength(0);
  });

  it("the only approval dropped by a read while A is in flight, then refused: the empty state still shows the refusal", async () => {
    const { fake, kernel } = await mount({ approvals: [approval(1)] });
    let release: (() => void) | undefined;
    fake.route(
      "POST /approvals/:id/approve",
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: false, status: 409, body: { error: "approval_not_pending", message: "approval 1 is not pending" } });
        }),
    );
    press("a");
    await waitFor(() => expect(posts(fake, "POST /approvals/:id/approve")).toHaveLength(1));
    kernel.approvals = [];
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(rowIds()).toEqual([]));
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("1");
    await act(async () => release?.());
    await waitFor(() => expect(screen.getByTestId("screen-approvals").dataset.state).toBe("empty"));
    expect(screen.getByTestId("approval-notice").textContent).toBe("approval 1 is not pending");
  });

  it("the empty state, with its words, when nothing waits", async () => {
    await mount();
    expect(screen.getByTestId("screen-approvals").dataset.state).toBe("empty");
    expect(screen.getByRole("heading", { name: EMPTY_TITLE })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("a failed refetch after a good read keeps the list and says it is the older answer; the next good read clears it", async () => {
    const { fake, kernel } = await mount({ approvals: [approval(1)] });
    expect(screen.queryByTestId("approvals-stale")).toBeNull();
    fake.route("GET /approvals", () => ({ ok: false, status: 500, body: { error: "internal", message: "db locked" } }));
    act(() => fake.emit(event("approval_requested")));
    await waitFor(() => expect(screen.getByTestId("approvals-stale").textContent).toContain("The kernel refused the read (500 internal): db locked."));
    expect(screen.getByTestId("screen-approvals").dataset.state).toBe("populated");
    expect(rowIds()).toEqual([1]);
    fake.route("GET /approvals", () => ok({ approvals: [...kernel.approvals] }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    act(() => fake.emit(event("approval_requested")));
    await waitFor(() => expect(screen.queryByTestId("approvals-stale")).toBeNull());
  });

  it("a refetch that fails because the kernel isn't connected adds no stale note: the shell's band says that", async () => {
    const { fake } = await mount({ approvals: [approval(1)] });
    const before = fake.requestsTo("GET /approvals").length;
    fake.route("GET /approvals", () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } }));
    act(() => fake.emit(event("approval_requested")));
    await waitFor(() => expect(fake.requestsTo("GET /approvals").length).toBeGreaterThan(before));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByTestId("approvals-stale")).toBeNull();
    expect(rowIds()).toEqual([1]);
  });

  it("Hide decided with a decided row selected says it is no longer listed, not that it was waiting", async () => {
    const decided = approval(5, { status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T08:20:00.000Z" });
    await mount({ approvals: [approval(2)], decided: [decided] });
    fireEvent.click(screen.getByRole("button", { name: "Show decided" }));
    await waitFor(() => expect(rowIds()).toEqual([2, 5]));
    press("j");
    expect(selectedId()).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "Hide decided" }));
    const gone = screen.getByTestId("approval-gone");
    expect(gone.textContent).toContain("#5 is decided and no longer in the list.");
    expect(gone.textContent).not.toContain("waiting on you");
    expect(gone.textContent).not.toContain("decided elsewhere");
  });

  it("the last pending row leaving moves focus from the removed list to the empty state, never to <body>", async () => {
    const { fake, kernel } = await mount({ approvals: [approval(1)] });
    screen.getByRole("button", { name: /^Allow once/ }).focus();
    kernel.approvals = [];
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(screen.getByTestId("screen-approvals").dataset.state).toBe("empty"));
    expect(document.activeElement).toBe(screen.getByTestId("approvals-empty"));
  });

  it("the error state names the kernel when it isn't answering", async () => {
    const fake = fakeBridge({ state: "unreachable", reason: "daemon_not_running" });
    for (const key of ["GET /status", "GET /approvals", "GET /approvals/grants", "GET /messages", "GET /sessions"]) {
      fake.route(key, () => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } }));
    }
    setApi(fake.bridge);
    render(<ApprovalsScreen registry={createCommandRegistry()} />);
    await waitFor(() => expect(screen.getByTestId("screen-approvals").dataset.state).toBe("error"));
    expect(screen.getByTestId("approvals-error").textContent).toContain("The kernel isn't answering");
  });
});

describe("the detail", () => {
  it("AC1b: action, agent, session, playbook, the session's cwd and what the kernel will do", async () => {
    await mount({
      approvals: [
        approval(5, {
          action: "kernel_agent_create",
          requesting_agent: "wright",
          requesting_session: 7,
          payload: { tool: "mcp__kernel__kernel_agent_create", input: { name: "Sable" } },
          playbook: { id: 2, slug: "crew-setup", version: 4 },
        }),
      ],
      sessions: [session(6, "/elsewhere"), session(7, "/Users/o/src/app")],
    });
    await waitFor(() => expect(screen.getByTestId("approval-cwd").textContent).toBe("/Users/o/src/app"));
    expect(screen.getByTestId("approval-action").textContent).toBe("kernel_agent_create");
    expect(screen.getByTestId("approval-agent").textContent).toBe("wright");
    expect(screen.getByTestId("approval-session").textContent).toBe("session #7");
    expect(screen.getByTestId("approval-playbook").textContent).toBe("from playbook crew-setup v4");
    expect(screen.getByTestId("approval-kernel-will").textContent).toBe("The kernel creates this crew member when you allow it.");
    expect(screen.getByTestId("approval-action").tagName).toBe("H2");
  });

  it("the payload's own cwd wins; with neither, the cwd is unknown; no session says so", async () => {
    const { fake } = await mount({
      approvals: [approval(1, { payload: { tool: "Bash", command: "ls", cwd: "/repo\u202e" }, requesting_session: 7 }), approval(2)],
      sessions: [session(7, "/Users/o/src/app")],
    });
    await waitFor(() => expect(fake.requestsTo("GET /sessions").length).toBeGreaterThan(0));
    expect(screen.getByTestId("approval-cwd").textContent).toBe("/repo\\u202e");
    press("j");
    expect(screen.getByTestId("approval-cwd").textContent).toBe("cwd unknown");
    expect(screen.getByTestId("approval-session").textContent).toBe("no session");
    expect(screen.queryByTestId("approval-kernel-will")).toBeNull();
  });

  it("AC4: an ANSI escape and a bidi override show escaped, in monospace, and never raw", async () => {
    const { fake } = await mount({
      approvals: [
        approval(1, {
          action: `post${RLO}`,
          requesting_agent: `ada${ESC}`,
          payload: { tool: "Bash", command: `echo ${ESC}[31mred${RLO}txt.exe` },
          display: `${ESC}[31mWARNING${ESC}[0m\nline two ${RLO}fdp.exe`,
          playbook: { id: 1, slug: `slug${RLO}`, version: 1 },
        }),
      ],
      messages: [brainMessage(1, "approval:1", `told ${ESC}[2J${RLO}`)],
    });
    const payload = screen.getByTestId("approval-payload");
    const display = screen.getByTestId("approval-display");
    expect(payload.tagName).toBe("PRE");
    expect(display.tagName).toBe("PRE");
    expect(payload.textContent).toContain("\\x1b[31m");
    expect(payload.textContent).toContain("\\u202e");
    expect(display.textContent).toContain("\\x1b[31mWARNING\\x1b[0m");
    expect(display.textContent).toContain("\\u202e");
    // The display keeps its line break; the payload keeps its pretty-printing.
    expect(display.textContent).toContain("\nline two");
    expect(payload.textContent).toContain('\n  "command": ');
    expect(screen.getByTestId("approval-playbook").textContent).toBe("from playbook slug\\u202e v1");
    const text = screen.getByTestId("screen-approvals").textContent ?? "";
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
    expect(fake.requests.length).toBeGreaterThan(0);
  });
});

describe("decisions", () => {
  it("AC2: A sends exactly one approve once, then shows the kernel's applied sentence and the agent's message", async () => {
    const charter = approval(4, {
      action: "kernel_agent_create",
      payload: { tool: "mcp__kernel__kernel_agent_create", input: { name: "Sable" } },
      requesting_session: 2,
    });
    const { fake, kernel } = await mount({ approvals: [charter] });
    fake.route("POST /approvals/:id/approve", (req) => {
      const decided: Approval = {
        ...charter,
        status: "approved",
        decision: (req.body as { decision: "once" }).decision,
        decided_by: "owner",
        decided_at: "2026-10-22T08:30:00.000Z",
        applied: "The kernel created crew member Sable.",
      };
      kernel.approvals = [];
      kernel.decided = [decided];
      kernel.messages = [brainMessage(11, "approval:4", "The owner allowed it once. The kernel created crew member Sable.")];
      return ok({ approval: decided });
    });

    press("a");
    await waitFor(() => expect(screen.getByTestId("approval-applied").textContent).toContain("The kernel created crew member Sable."));
    const approves = posts(fake, "POST /approvals/:id/approve");
    expect(approves).toHaveLength(1);
    expect(approves[0]?.params).toEqual({ id: 4 });
    expect(JSON.stringify(approves[0]?.body)).toBe('{"decision":"once"}');
    await waitFor(() => expect(screen.getByTestId("approval-message").textContent).toBe("The owner allowed it once. The kernel created crew member Sable."));
    // The applied sentence comes before the agent's message.
    const outcome = screen.getByTestId("approval-outcome");
    const order = (outcome.textContent ?? "").indexOf("The kernel created crew member Sable.") < (outcome.textContent ?? "").indexOf("The owner allowed it once.");
    expect(order).toBe(true);
    // A second A on a decided approval sends nothing.
    press("a");
    expect(posts(fake, "POST /approvals/:id/approve")).toHaveLength(1);
  });

  it("D sends one deny", async () => {
    const one = approval(1);
    const { fake } = await mount({ approvals: [one] });
    fake.route("POST /approvals/:id/deny", () => ok({ approval: { ...one, status: "denied", decision: "deny", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }));
    press("d");
    await waitFor(() => expect(screen.getByTestId("approval-outcome").textContent).toContain("Denied by owner"));
    expect(posts(fake, "POST /approvals/:id/deny")).toHaveLength(1);
    expect(posts(fake, "POST /approvals/:id/deny")[0]?.body).toBeUndefined();
  });

  it("AC3: with no playbook, Always is disabled with the kernel's reason, and ⇧A sends nothing", async () => {
    const { fake, registry } = await mount({ approvals: [approval(1, { playbook: null })] });
    const always = screen.getByRole("button", { name: /^Always for this playbook/ });
    expect((always as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("always-reason").textContent).toBe(ALWAYS_SENTENCE);
    expect(always.getAttribute("aria-describedby")).toBe(screen.getByTestId("always-reason").id);
    press("A", { shiftKey: true });
    fireEvent.click(always);
    await act(async () => registry.get(APPROVAL_COMMANDS.approveAlways)?.run());
    expect(registry.get(APPROVAL_COMMANDS.approveAlways)?.enabled?.()).toBe(false);
    expect(fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(0);
  });

  it("AC3: a 409 always_not_supported shows the kernel's message, escaped, and the approval stays pending", async () => {
    const { fake } = await mount({ approvals: [approval(1)] });
    fake.route("POST /approvals/:id/approve", () => ({
      ok: false,
      status: 409,
      body: { error: "always_not_supported", message: `always never covers mcp__github__comment${RLO}: the owner decides every call to it; approve it once` },
    }));
    press("A", { shiftKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("approval-notice").textContent).toBe(
        "always never covers mcp__github__comment\\u202e: the owner decides every call to it; approve it once",
      ),
    );
    const sent = posts(fake, "POST /approvals/:id/approve");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({ decision: "always" });
    expect(screen.queryByTestId("approval-outcome")).toBeNull();
    expect(screen.getByRole("button", { name: /^Allow once/ })).toBeTruthy();
  });
  it("a decision asked for while another is in flight sends nothing and says so", async () => {
    const { fake } = await mount({ approvals: [approval(1), approval(2)] });
    let release: (() => void) | undefined;
    fake.route(
      "POST /approvals/:id/approve",
      (req) =>
        new Promise((resolve) => {
          release = () => resolve(ok({ approval: { ...approval(Number(req.params?.id)), status: "approved", decision: "once" } }));
        }),
    );
    press("a");
    await waitFor(() => expect(posts(fake, "POST /approvals/:id/approve")).toHaveLength(1));
    press("j");
    expect(selectedId()).toBe(2);
    press("a");
    expect(screen.getByTestId("approval-notice").textContent).toBe("Nothing was sent for #2: the decision on #1 was still on its way to the kernel. Decide again.");
    expect(posts(fake, "POST /approvals/:id/approve")).toHaveLength(1);
    await act(async () => release?.());
  });

  it("D in flight marks Deny busy, never Allow once; the others are disabled", async () => {
    const { fake } = await mount({ approvals: [approval(1)] });
    fake.route("POST /approvals/:id/deny", () => new Promise(() => undefined));
    press("d");
    await waitFor(() => expect(screen.getByRole("button", { name: /^Deny/ }).getAttribute("aria-busy")).toBe("true"));
    const once = screen.getByRole("button", { name: /^Allow once/ }) as HTMLButtonElement;
    const always = screen.getByRole("button", { name: /^Always for this playbook/ }) as HTMLButtonElement;
    const deny = screen.getByRole("button", { name: /^Deny/ }) as HTMLButtonElement;
    expect(once.getAttribute("aria-busy")).toBeNull();
    expect(once.disabled).toBe(true);
    expect(always.getAttribute("aria-busy")).toBeNull();
    expect(always.disabled).toBe(true);
    expect(deny.disabled).toBe(false);
  });

  it("⇧A in flight marks Always busy, never Allow once", async () => {
    const { fake } = await mount({ approvals: [approval(1)] });
    fake.route("POST /approvals/:id/approve", () => new Promise(() => undefined));
    press("A", { shiftKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Always for this playbook/ }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByRole("button", { name: /^Allow once/ }).getAttribute("aria-busy")).toBeNull();
  });

  it("clicking Allow once moves focus to the outcome that replaces the buttons, never to <body>", async () => {
    const one = approval(1);
    const { fake } = await mount({ approvals: [one] });
    fake.route("POST /approvals/:id/approve", () => ok({ approval: { ...one, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }));
    const once = screen.getByRole("button", { name: /^Allow once/ });
    once.focus();
    fireEvent.click(once);
    await waitFor(() => expect(screen.getByTestId("approval-outcome")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByTestId("approval-outcome"));
  });

  it("a decision with focus elsewhere (the list) leaves focus where it is", async () => {
    const one = approval(1);
    const { fake } = await mount({ approvals: [one] });
    fake.route("POST /approvals/:id/approve", () => ok({ approval: { ...one, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }));
    const row = screen.getAllByRole("option")[0] as HTMLElement;
    row.tabIndex = -1;
    row.focus();
    press("a");
    await waitFor(() => expect(screen.getByTestId("approval-outcome")).toBeTruthy());
    expect(document.activeElement).toBe(row);
  });

  it("a read that drops the approval while its decision is in flight keeps the detail, busy, not gone", async () => {
    const one = approval(1);
    const { fake, kernel } = await mount({ approvals: [one, approval(2)] });
    let release: (() => void) | undefined;
    fake.route(
      "POST /approvals/:id/approve",
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok({ approval: { ...one, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }));
        }),
    );
    press("a");
    await waitFor(() => expect(posts(fake, "POST /approvals/:id/approve")).toHaveLength(1));
    kernel.approvals = [approval(2)];
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(rowIds()).toEqual([2]));
    expect(screen.queryByTestId("approval-gone")).toBeNull();
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("1");
    expect(screen.getByRole("button", { name: /^Allow once/ }).getAttribute("aria-busy")).toBe("true");
    await act(async () => release?.());
    await waitFor(() => expect(screen.getByTestId("approval-outcome")).toBeTruthy());
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("1");
  });

  it("the selected approval leaving the list moves focus from a removed decision button to the placeholder", async () => {
    const { fake, kernel } = await mount({ approvals: [approval(1), approval(2)] });
    screen.getByRole("button", { name: /^Allow once/ }).focus();
    kernel.approvals = [approval(2)];
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(screen.getByTestId("approval-gone")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByTestId("approval-gone"));
    expect(screen.getByTestId("approval-gone").textContent).not.toContain("decided elsewhere");
  });

  it("J from the focused placeholder hands focus to the detail that replaces it, never to <body>", async () => {
    const { fake, kernel } = await mount({ approvals: [approval(1), approval(2)] });
    screen.getByRole("button", { name: /^Allow once/ }).focus();
    kernel.approvals = [approval(2)];
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("approval-gone")));
    press("j");
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("2");
    expect(document.activeElement).toBe(screen.getByTestId("approval-detail"));
  });

  it("with Show decided on, an approval decided elsewhere going gone and coming back decided keeps focus off <body>", async () => {
    const one = approval(1);
    const { fake, kernel } = await mount({ approvals: [one, approval(2)] });
    fireEvent.click(screen.getByRole("button", { name: "Show decided" }));
    await waitFor(() => expect(fake.requestsTo("GET /approvals").some((r) => r.req.query?.all === "1")).toBe(true));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    let releaseAll: (() => void) | undefined;
    fake.route("GET /approvals", (req) =>
      req.query?.all === "1"
        ? new Promise((resolve) => {
            releaseAll = () => resolve(ok({ approvals: [...kernel.approvals, ...kernel.decided] }));
          })
        : ok({ approvals: [...kernel.approvals] }),
    );
    screen.getByRole("button", { name: /^Allow once/ }).focus();
    kernel.approvals = [approval(2)];
    kernel.decided = [{ ...one, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" }];
    await new Promise((resolve) => setTimeout(resolve, 300));
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("approval-gone")));
    await waitFor(() => expect(releaseAll).toBeDefined());
    await act(async () => releaseAll?.());
    await waitFor(() => expect(screen.getByTestId("approval-outcome")).toBeTruthy());
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("1");
    expect(document.activeElement).toBe(screen.getByTestId("approval-outcome"));
  });

  it("a messages read that fails after a decision says the agent's message couldn't be read", async () => {
    const one = approval(1);
    const { fake } = await mount({ approvals: [one] });
    fake.route("POST /approvals/:id/approve", () => ok({ approval: { ...one, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }));
    fake.route("GET /messages", () => ({ ok: false, status: 500, body: { error: "internal", message: "db locked" } }));
    press("a");
    await waitFor(() => expect(screen.getByTestId("approval-message-error").textContent).toContain("Couldn't read the agent's messages."));
    expect(screen.getByTestId("approval-message-error").textContent).toContain("The kernel refused the read (500 internal): db locked.");
    expect(screen.queryByTestId("approval-message-pending")).toBeNull();
  });

  it("no decision key runs behind the open ⌘K palette", async () => {
    const { fake } = await mount({ approvals: [approval(1)] });
    const palette = document.createElement("div");
    palette.setAttribute("data-testid", "command-palette");
    document.body.appendChild(palette);
    try {
      press("a");
      press("d");
      press("j");
      expect(fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(0);
      expect(selectedId()).toBe(1);
    } finally {
      palette.remove();
    }
  });
});

describe("grants", () => {
  it("AC5: not current is marked; Revoke asks first; Cancel sends nothing; Confirm sends one revoke", async () => {
    const { fake } = await mount({ grants: [grant(3), grant(8, { current: false })] });
    const section = within(screen.getByTestId("approvals-grants"));
    expect(within(screen.getByTestId("grant-8")).getByText("not current")).toBeTruthy();
    expect(within(screen.getByTestId("grant-3")).queryByText("not current")).toBeNull();
    fake.route("POST /approvals/grants/:id/revoke", () => ok({ grant: grant(8, { current: false }) }));

    fireEvent.click(section.getByRole("button", { name: "Revoke grant #8" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Revoke this grant?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await act(async () => undefined);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts(fake, "POST /approvals/grants/:id/revoke")).toHaveLength(0);

    fireEvent.click(section.getByRole("button", { name: "Revoke grant #8" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Revoke/ }));
    await waitFor(() => expect(screen.getByTestId("grant-notice").textContent).toContain("Revoked grant #8"));
    const revokes = posts(fake, "POST /approvals/grants/:id/revoke");
    expect(revokes).toHaveLength(1);
    expect(revokes[0]?.params).toEqual({ id: 8 });
  });

  it("a revoke confirmed while another is in flight is sent, not dropped; the in-flight grant's Revoke is busy", async () => {
    const { fake } = await mount({ grants: [grant(17), grant(21)] });
    const held: Array<() => void> = [];
    fake.route(
      "POST /approvals/grants/:id/revoke",
      (req) =>
        new Promise((resolve) => {
          held.push(() => resolve(ok({ grant: grant(Number(req.params?.id)) })));
        }),
    );
    const section = within(screen.getByTestId("approvals-grants"));
    fireEvent.click(section.getByRole("button", { name: "Revoke grant #17" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Revoke/ }));
    await waitFor(() => expect(posts(fake, "POST /approvals/grants/:id/revoke")).toHaveLength(1));
    await waitFor(() => expect(section.getByRole("button", { name: "Revoke grant #17" }).getAttribute("aria-busy")).toBe("true"));

    fireEvent.click(section.getByRole("button", { name: "Revoke grant #21" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Revoke/ }));
    await waitFor(() => expect(posts(fake, "POST /approvals/grants/:id/revoke").map((r) => r.params)).toEqual([{ id: 17 }, { id: 21 }]));
    await act(async () => {
      for (const release of held) release();
    });
    await waitFor(() => expect(screen.getByTestId("grant-notice").textContent).toContain("Revoked grant #"));
    expect(section.getByRole("button", { name: "Revoke grant #17" }).getAttribute("aria-busy")).toBeNull();
  });

  it("a confirmed revoke moves focus to the grants heading, so the refetch removing its row never drops focus to <body>", async () => {
    const { fake, kernel } = await mount({ approvals: [approval(1)], grants: [grant(3), grant(4)] });
    fake.route("POST /approvals/grants/:id/revoke", () => {
      kernel.grants = [grant(4)];
      return ok({ grant: grant(3) });
    });
    fireEvent.click(screen.getByRole("button", { name: "Revoke grant #3" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Revoke/ }));
    await waitFor(() => expect(screen.queryByTestId("grant-3")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /^Standing grants/ }));
  });

  it("a revoke answering after the owner moved focus to another grant's Revoke leaves focus there", async () => {
    const { fake } = await mount({ approvals: [approval(1)], grants: [grant(3), grant(4)] });
    let release: (() => void) | undefined;
    fake.route(
      "POST /approvals/grants/:id/revoke",
      () =>
        new Promise((resolve) => {
          release = () => resolve(ok({ grant: grant(3) }));
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoke grant #3" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Revoke/ }));
    await waitFor(() => expect(posts(fake, "POST /approvals/grants/:id/revoke")).toHaveLength(1));
    const four = screen.getByRole("button", { name: "Revoke grant #4" });
    four.focus();
    await act(async () => release?.());
    await waitFor(() => expect(screen.getByTestId("grant-notice").textContent).toContain("Revoked grant #3"));
    expect(document.activeElement).toBe(four);
  });

  it("a failed grants refetch after a good read keeps the grants and says they are the older answer", async () => {
    const { fake } = await mount({ approvals: [approval(1)], grants: [grant(3)] });
    expect(screen.queryByTestId("grants-stale")).toBeNull();
    fake.route("GET /approvals/grants", () => ({ ok: false, status: 500, body: { error: "internal" } }));
    act(() => fake.emit(event("approval_decided")));
    await waitFor(() => expect(screen.getByTestId("grants-stale").textContent).toContain("The kernel refused the read (500 internal)"));
    expect(screen.getByTestId("grant-3")).toBeTruthy();
  });

  it("no decision key runs behind the open confirm", async () => {
    const { fake } = await mount({ approvals: [approval(1)], grants: [grant(3)] });
    fireEvent.click(screen.getByRole("button", { name: "Revoke grant #3" }));
    press("a");
    press("d");
    expect(fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(0);
  });
});

describe("show decided", () => {
  it("reads GET /approvals?all=1 on request and lists the decided ones after the pending", async () => {
    const decided = approval(1, { status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T08:20:00.000Z" });
    const { fake } = await mount({ approvals: [approval(2)], decided: [decided] });
    expect(rowIds()).toEqual([2]);
    fireEvent.click(screen.getByRole("button", { name: "Show decided" }));
    await waitFor(() => expect(rowIds()).toEqual([2, 1]));
    expect(fake.requestsTo("GET /approvals").some((r) => r.req.query?.all === "1")).toBe(true);
  });
});

describe("commands", () => {
  it("AC7: A, ⇧A, D and show grants are palette commands under approvals.*, removed on unmount", async () => {
    const { registry, unmount } = await mount({ approvals: [approval(1)] });
    const mine = registry.list().filter((c) => c.owner === "approvals");
    expect(mine.map((c) => [c.id, c.shortcut ?? null])).toEqual([
      [APPROVAL_COMMANDS.approveOnce, "A"],
      [APPROVAL_COMMANDS.approveAlways, "⇧A"],
      [APPROVAL_COMMANDS.deny, "D"],
      [APPROVAL_COMMANDS.showGrants, null],
      [APPROVAL_COMMANDS.showDecided, null],
    ]);
    expect(mine.every((c) => c.id.startsWith("approvals.") && c.group === "Approvals")).toBe(true);
    expect(registry.get("screens.approvals")).toBeUndefined();
    expect(registry.get(APPROVAL_COMMANDS.approveOnce)?.enabled?.()).toBe(true);
    unmount();
    expect(registry.list().filter((c) => c.owner === "approvals")).toEqual([]);
  });

  it("the decision commands are disabled with nothing selected", async () => {
    const { registry } = await mount();
    for (const id of [APPROVAL_COMMANDS.approveOnce, APPROVAL_COMMANDS.approveAlways, APPROVAL_COMMANDS.deny]) {
      expect(registry.get(id)?.enabled?.()).toBe(false);
    }
  });

  it("with the global keyboard map installed, A runs the command once (the screen's own key handler stands aside)", async () => {
    const registry = createCommandRegistry();
    const uninstall = installKeyboardMap({
      registry,
      openPalette: vi.fn(),
      isPaletteOpen: () => false,
      killSwitch: { confirm: async () => false, engage: vi.fn() },
      onCollision: vi.fn(),
    });
    try {
      const one = approval(1);
      const { fake } = await mount({ approvals: [one] }, registry);
      fake.route("POST /approvals/:id/approve", () => ok({ approval: { ...one, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }));
      press("a");
      await waitFor(() => expect(screen.getByTestId("approval-outcome")).toBeTruthy());
      expect(posts(fake, "POST /approvals/:id/approve")).toHaveLength(1);
    } finally {
      uninstall();
    }
  });

  it("show grants moves focus to the grants heading", async () => {
    const { registry } = await mount({ approvals: [approval(1)], grants: [grant(3)] });
    const heading = screen.getByRole("heading", { name: /^Standing grants/ });
    heading.scrollIntoView = vi.fn();
    await act(async () => registry.get(APPROVAL_COMMANDS.showGrants)?.run());
    expect(document.activeElement).toBe(heading);
  });
});
