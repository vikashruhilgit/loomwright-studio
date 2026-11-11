// @vitest-environment jsdom
// The Approvals screen over a scriptable bridge (`../../store/fake-bridge`):
// the bridge guard, the pending-first inbox selected by id, the detail
// fields, A / ⇧A / D and what the kernel answered, the escaped payload, the
// grants with a confirmed Revoke, the registered ⌘K commands, the source
// label and the link to what an approval is about, and the merge approval card
// (Allow once and Deny only).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, Approval, BrainMessage, EventFrame, Grant, PlaybookListing, SessionSummary, StudioBridge } from "../../api/contract";
import { installKeyboardMap } from "../../commands/keyboard";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { APPROVAL_COMMANDS, ApprovalsScreen, EMPTY_TITLE, MERGE_ALWAYS_REFUSED } from "./ApprovalsScreen";
import { screen as approvalsScreen } from "./index";
import { alwaysRefusalFor } from "./kernel-mirror";
import { NOT_IN_REQUEST } from "./MergeApprovalCard";
import { MERGE_APPROVAL_ACTION, mergeApprovalOf } from "./subject";

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

function playbookListing(id: number, slug: string): PlaybookListing {
  return {
    id,
    slug,
    name: `Playbook ${id}`,
    owning_agent: "wright",
    intent: "Review PRs where I am requested",
    status: "draft",
    version: 1,
    dedupe_key_spec: null,
    dedupe_key_set_by: null,
    priority: "normal",
    priority_set_by: null,
    model: null,
    model_set_by: null,
    effort: null,
    effort_set_by: null,
    token_limit_per_day: null,
    token_limit_set_by: null,
    api_key_fallback_json: null,
    api_key_fallback_set_by: null,
    mode: "draft",
    mode_set_by: null,
    merge_requirement: null,
    merge_requirement_set_by: null,
    created_at: "2026-10-22T08:00:00.000Z",
    updated_at: "2026-10-22T08:00:00.000Z",
    trigger_id: null,
    next_fire_at: null,
  };
}

interface Kernel {
  approvals: Approval[];
  decided: Approval[];
  grants: Grant[];
  messages: BrainMessage[];
  sessions: SessionSummary[];
  /** `GET /playbooks`; `null` answers it refused. */
  playbooks: PlaybookListing[] | null;
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
  const kernel: Kernel = { approvals: [], decided: [], grants: [], messages: [], sessions: [], playbooks: [], ...initial };
  const fake = fakeBridge();
  fake.route("GET /status", () => ok({ kernel: { version: "0", uptime_s: 1, pid: 1 } }));
  fake.route("GET /approvals", (req) => ok({ approvals: req.query?.all === "1" ? [...kernel.approvals, ...kernel.decided] : [...kernel.approvals] }));
  fake.route("GET /approvals/grants", () => ok({ grants: [...kernel.grants] }));
  fake.route("GET /messages", () => ok({ messages: [...kernel.messages] }));
  fake.route("GET /sessions", () => ok({ sessions: [...kernel.sessions] }));
  fake.route("GET /playbooks", () => (kernel.playbooks === null ? { ok: false, status: 500, body: { error: "internal" } } : ok({ playbooks: [...kernel.playbooks] })));
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
    expect(screen.getByTestId("approval-source").textContent).toBe("Requested by playbook crew-setup v4");
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
    expect(screen.getByTestId("approval-source").textContent).toBe("Requested by playbook slug\\u202e v1");
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

describe("the #/approvals/<id> route (item 17's notification links)", () => {
  function writes(fake: FakeBridge): ApiRequest[] {
    return fake.requests.map((r) => r.req).filter((req) => req.method !== "GET");
  }

  it("on mount, selects the id the route names, not the oldest; nothing is sent", async () => {
    window.location.hash = "#/approvals/2";
    const { fake } = await mount({ approvals: [approval(1), approval(2), approval(3)] });
    await waitFor(() => expect(selectedId()).toBe(2));
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("2");
    expect(writes(fake)).toEqual([]);
  });

  it("on hashchange, selects the new id; nothing is sent", async () => {
    const { fake } = await mount({ approvals: [approval(1), approval(2), approval(3)] });
    expect(selectedId()).toBe(1);
    act(() => {
      window.location.hash = "#/approvals/3";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(selectedId()).toBe(3);
    expect(screen.getByTestId("approval-detail").dataset.approvalId).toBe("3");
    expect(writes(fake)).toEqual([]);
  });

  it("an id not in the list takes the gone path, and A decides nothing", async () => {
    window.location.hash = "#/approvals/9";
    const { fake } = await mount({ approvals: [approval(1), approval(2)] });
    await waitFor(() => expect(screen.getByTestId("approval-gone").dataset.approvalId).toBe("9"));
    expect(selectedId()).toBeUndefined();
    press("a");
    expect(writes(fake)).toEqual([]);
  });

  it("#/approvals, or a malformed id, keeps the oldest-row default", async () => {
    for (const hash of ["#/approvals", "#/approvals/0", "#/approvals/2x", "#/approvals/2/deny"]) {
      window.location.hash = hash;
      const { unmount } = await mount({ approvals: [approval(1), approval(2)] });
      expect(selectedId(), hash).toBe(1);
      unmount();
    }
  });
});

describe("what an approval is about (the source label and the link)", () => {
  /** Approval 6 of the phase 5 live run: Wright's chat session asking to enable playbook 3. */
  function enableApproval(): Approval {
    return approval(6, {
      requesting_agent: "wright",
      requesting_session: 12,
      action: "kernel_playbook_enable",
      playbook: null,
      payload: { tool: "mcp__kernel__kernel_playbook_enable", input: { id: 3, idempotency_key: "k" }, cwd: "/" },
    });
  }

  function charterCreate(): Approval {
    return approval(4, {
      requesting_agent: "wright",
      action: "kernel_agent_create",
      playbook: null,
      payload: { tool: "mcp__kernel__kernel_agent_create", input: { charter: { id: "sable", display_name: "Sable" }, idempotency_key: "k" }, cwd: "/" },
    });
  }

  /** The list row's meta line. */
  function rowMeta(id: number): string {
    const row = screen.queryAllByRole("option").find((r) => r.getAttribute("data-key") === String(id));
    return row?.querySelector(".list-meta")?.textContent ?? "";
  }

  it("AC1: approval 6 reads Requested by Wright in chat and links to playbook 3's card by slug, pending and after Allow once", async () => {
    const six = enableApproval();
    const { fake } = await mount({ approvals: [six], playbooks: [playbookListing(3, "phase5-exit-1024")] });
    fake.route("POST /approvals/:id/approve", () =>
      ok({ approval: { ...six, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z", applied: "The kernel enabled playbook 3." } }),
    );
    const check = async (): Promise<void> => {
      expect(screen.getByTestId("approval-source").textContent).toBe("Requested by Wright in chat");
      await waitFor(() => expect(screen.getByTestId("approval-link").textContent).toBe("Open playbook phase5-exit-1024"));
      const link = screen.getByTestId("approval-link");
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBe("#/chat?playbook=3");
      expect(screen.getByTestId("screen-approvals").textContent).not.toContain("Not from a playbook");
    };
    await check();
    expect(rowMeta(6)).toBe("wright · in chat");
    press("a");
    await waitFor(() => expect(screen.getByTestId("approval-applied").textContent).toContain("The kernel enabled playbook 3."));
    await check();
    expect(rowMeta(6)).toBe("wright · in chat · allowed once");
  });

  it("AC1: with GET /playbooks refused, the link names the playbook by its id", async () => {
    const { fake } = await mount({ approvals: [enableApproval()], playbooks: null });
    await waitFor(() => expect(fake.requestsTo("GET /playbooks").length).toBeGreaterThan(0));
    expect(screen.getByTestId("approval-link").textContent).toBe("Open playbook #3");
    expect(screen.getByTestId("approval-link").getAttribute("href")).toBe("#/chat?playbook=3");
  });

  it("an approval about nothing the app can open has no link", async () => {
    await mount({ approvals: [approval(1)] });
    expect(screen.getByTestId("approval-source").textContent).toBe("Requested by playbook review-prs v3");
    expect(screen.queryByTestId("approval-link")).toBeNull();
  });

  it("AC2: a create has no link while pending; Open in Team to its member once allowed and applied", async () => {
    const create = charterCreate();
    const { fake } = await mount({ approvals: [create] });
    expect(screen.getByTestId("approval-source").textContent).toBe("Requested by Wright in chat");
    expect(screen.queryByTestId("approval-link")).toBeNull();
    fake.route("POST /approvals/:id/approve", () =>
      ok({ approval: { ...create, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z", applied: "The kernel created crew member sable (Sable) on approval 4." } }),
    );
    press("a");
    await waitFor(() => expect(screen.getByTestId("approval-applied").textContent).toContain("The kernel created crew member sable"));
    const link = screen.getByTestId("approval-link");
    expect(link.textContent).toBe("Open in Team");
    expect(link.getAttribute("href")).toBe("#/team/sable");
  });

  it("AC2: a denied create, and an allowed one the kernel refused to apply, have no link", async () => {
    const create = charterCreate();
    const { fake } = await mount({ approvals: [create] });
    fake.route("POST /approvals/:id/deny", () => ok({ approval: { ...create, status: "denied", decision: "deny", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }));
    press("d");
    await waitFor(() => expect(screen.getByTestId("approval-outcome").textContent).toContain("Denied by owner"));
    expect(screen.queryByTestId("approval-link")).toBeNull();
    cleanup();

    const again = charterCreate();
    const second = await mount({ approvals: [again] });
    second.fake.route("POST /approvals/:id/approve", () =>
      ok({
        approval: { ...again, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z", apply_refused: "agent_exists", apply_detail: "sable exists" },
      }),
    );
    press("a");
    await waitFor(() => expect(screen.getByTestId("approval-refused")).toBeTruthy());
    expect(screen.queryByTestId("approval-link")).toBeNull();
  });
});

// ---- the merge approval card (phase 8 item 13) -------------------------------------------------

const SHA = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

/**
 * A `kernel_merge_approval_request`, held through the rail from a playbook session (so `alwaysRefusalFor`
 * has nothing to say and only the merge card's own guard keeps `always` from being sent). `fields` replace
 * the default ones; a key set to `undefined` is dropped. The rail payload is `{tool, input, cwd}`; `flat`
 * puts the fields at the top level.
 */
function mergeApproval(id: number, fields: Record<string, unknown> = {}, shape: "rail" | "flat" = "rail", overrides: Partial<Approval> = {}): Approval {
  const merged: Record<string, unknown> = {
    repo: "acme/widgets",
    pr: 21,
    head_sha: SHA,
    ci: "green · 5 of 5 checks passed",
    ready_at: "2026-10-22T08:20:00.000Z",
    policy: "Approve in Studio",
    ...fields,
  };
  const kept = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
  return approval(id, {
    requesting_agent: "ada",
    requesting_session: 2,
    action: MERGE_APPROVAL_ACTION,
    playbook: { id: 7, slug: "tickets-to-prs", version: 2 },
    payload: shape === "flat" ? kept : { tool: "mcp__kernel__kernel_merge_approval_request", input: kept, cwd: "/work/widgets" },
    ...overrides,
  });
}

describe("mergeApprovalOf", () => {
  const FULL = {
    repo: "acme/widgets",
    pr: 21,
    headSha: SHA,
    ci: "green · 5 of 5 checks passed",
    readyAt: "2026-10-22T08:20:00.000Z",
    policy: "Approve in Studio",
  };

  it("reads the fields from payload.input of the rail's {tool, input, cwd}, as the kernel's hasMergeApproval does", () => {
    expect(mergeApprovalOf(mergeApproval(1))).toEqual(FULL);
  });

  it("never reads the payload's top level: a flat payload draws no card, because the kernel would never count its Allow", () => {
    expect(mergeApprovalOf(mergeApproval(1, {}, "flat"))).toBeUndefined();
    const top = { repo: "acme/widgets", pr: 21, head_sha: SHA };
    expect(mergeApprovalOf(mergeApproval(1, {}, "rail", { payload: { tool: "mcp__kernel__kernel_merge_approval_request", ...top, input: {} } }))).toBeUndefined();
  });

  it("a top-level field never changes the PR shown: the card names what payload.input names, the PR the kernel authorises", () => {
    const input = { repo: "acme/widgets", pr: 21, head_sha: SHA };
    const decoy = mergeApproval(1, {}, "rail", { payload: { tool: "mcp__kernel__kernel_merge_approval_request", repo: "evil/top", pr: 1, head_sha: "abcdef0", input, cwd: "/" } });
    expect(mergeApprovalOf(decoy)).toMatchObject({ repo: "acme/widgets", pr: 21, headSha: SHA });
  });

  it("draws no card unless payload.tool is the merge-approval tool, as the kernel requires", () => {
    const input = { repo: "acme/widgets", pr: 21, head_sha: SHA };
    for (const tool of [undefined, "t", "kernel_merge_approval_request", "mcp__kernel__kernel_playbook_enable", 5]) {
      expect(mergeApprovalOf(mergeApproval(1, {}, "rail", { payload: { tool, input, cwd: "/" } })), String(tool)).toBeUndefined();
    }
  });

  it("is undefined for any other action, whatever the fields", () => {
    expect(mergeApprovalOf(mergeApproval(1, {}, "rail", { action: "kernel_merge_approval" }))).toBeUndefined();
    expect(mergeApprovalOf(mergeApproval(1, {}, "rail", { action: "mcp__kernel__kernel_merge_approval_request" }))).toBeUndefined();
    expect(mergeApprovalOf(approval(1))).toBeUndefined();
  });

  it("is undefined for a repo that is not owner/name, so no URL is built", () => {
    for (const repo of ["acme", "acme/", "/widgets", "a b/widgets", "acme/wid gets", "acme/widgets/extra", "acme/..", "acme/.", "ac_me/widgets", "https://evil.test/x", "acme/widgets\n", 5, null, undefined]) {
      expect(mergeApprovalOf(mergeApproval(1, { repo })), String(repo)).toBeUndefined();
    }
    for (const repo of ["acme/widgets", "Acme-Co/widgets.v2_x-y", "a/.github"]) expect(mergeApprovalOf(mergeApproval(1, { repo })), repo).toMatchObject({ repo });
  });

  it("is undefined for a pr that is not a positive safe integer", () => {
    for (const pr of [0, -3, 1.5, "21", null, undefined, 2 ** 53, Number.POSITIVE_INFINITY]) {
      expect(mergeApprovalOf(mergeApproval(1, { pr })), String(pr)).toBeUndefined();
    }
  });

  it("is undefined for a head_sha that is not 7 to 40 lowercase hex characters", () => {
    for (const head_sha of ["1a2b3c", `${SHA}0`, SHA.toUpperCase(), "xyz1234", "1a2b3c4 ", 1234567, null, undefined]) {
      expect(mergeApprovalOf(mergeApproval(1, { head_sha })), String(head_sha)).toBeUndefined();
    }
    expect(mergeApprovalOf(mergeApproval(1, { head_sha: "1a2b3c4" }))?.headSha).toBe("1a2b3c4");
  });

  it("is undefined for a payload that is not an object", () => {
    for (const payload of [null, [], "repo", 5, undefined]) {
      expect(mergeApprovalOf(mergeApproval(1, {}, "rail", { payload })), String(payload)).toBeUndefined();
    }
  });

  it("reads a missing or wrongly typed ci, ready_at or policy as undefined, never a default", () => {
    const bare = mergeApprovalOf(mergeApproval(1, { ci: undefined, ready_at: undefined, policy: undefined }));
    expect(bare).toEqual({ repo: "acme/widgets", pr: 21, headSha: SHA, ci: undefined, readyAt: undefined, policy: undefined });
    const typed = mergeApprovalOf(mergeApproval(1, { ci: 5, ready_at: { at: "now" }, policy: ["x"] }));
    expect(typed?.ci).toBeUndefined();
    expect(typed?.readyAt).toBeUndefined();
    expect(typed?.policy).toBeUndefined();
  });
});

describe("the merge approval card", () => {
  const card = (): HTMLElement => screen.getByTestId("merge-card");
  const buttonNames = (): string[] => screen.getAllByRole("button").map((b) => b.textContent ?? "");

  it("shows the repo, the PR with its URL as text, the 7-character head with the full SHA as its title, CI, READY and the policy", async () => {
    await mount({ approvals: [mergeApproval(1)] });
    expect(within(card()).getByRole("heading", { name: "Allow PR #21 to go to Loomwright's gate" })).toBeTruthy();
    expect(screen.getByTestId("merge-repo").textContent).toBe("acme/widgets");
    expect(screen.getByTestId("merge-pr").textContent).toContain("#21");
    expect(screen.getByTestId("merge-url").textContent).toBe("https://github.com/acme/widgets/pull/21");
    const head = screen.getByTestId("merge-head-sha");
    expect(head.textContent).toBe("1a2b3c4");
    expect(head.getAttribute("title")).toBe(SHA);
    expect(screen.getByTestId("merge-ci").textContent).toBe("green · 5 of 5 checks passed");
    expect(screen.getByTestId("merge-ready").textContent).toBe("2026-10-22T08:20:00.000Z");
    expect(screen.getByTestId("merge-policy").textContent).toBe("Approve in Studio");
    expect(card().textContent).not.toContain(SHA);
  });

  it("the PR URL is text, never a link: no anchor and no href anywhere in the card", async () => {
    await mount({ approvals: [mergeApproval(1)] });
    expect(card().querySelector("a")).toBeNull();
    expect(card().querySelector("[href]")).toBeNull();
    expect(screen.queryAllByRole("link").filter((link) => (link.getAttribute("href") ?? "").includes("github.com"))).toEqual([]);
  });

  it("draws no merge card for the flat payload shape, which the kernel's reader never counts", async () => {
    await mount({ approvals: [mergeApproval(1, {}, "flat")] });
    expect(screen.queryByTestId("merge-url")).toBeNull();
    expect(screen.queryByTestId("merge-head-sha")).toBeNull();
  });

  it("a missing or wrongly typed ci, ready_at or policy reads 'not in the request'", async () => {
    await mount({ approvals: [mergeApproval(1, { ci: undefined, ready_at: 1761120000, policy: { name: "Approve in Studio" } })] });
    for (const id of ["merge-ci", "merge-ready", "merge-policy"]) expect(screen.getByTestId(id).textContent, id).toBe(NOT_IN_REQUEST);
    expect(NOT_IN_REQUEST).toBe("not in the request");
    // The fields the request did carry are still read.
    expect(screen.getByTestId("merge-repo").textContent).toBe("acme/widgets");
  });

  it("escapes a payload string: an ANSI escape and a bidi override show as text, never raw", async () => {
    await mount({ approvals: [mergeApproval(1, { ci: `${ESC}[31mred${ESC}[0m${RLO}`, policy: `ok${RLO}` })] });
    expect(screen.getByTestId("merge-ci").textContent).toContain("\\x1b[31mred");
    expect(card().textContent).not.toContain(ESC);
    expect(card().textContent).not.toContain(RLO);
    expect(screen.getByTestId("merge-policy").textContent).toContain("\\u202e");
  });

  it("says approving does not merge, and no control's text says merge", async () => {
    await mount({ approvals: [mergeApproval(1)] });
    expect(screen.getByTestId("merge-gate").textContent).toContain("Approving does not merge.");
    expect(screen.getByTestId("merge-gate").textContent).toContain("Loomwright's gate merges the PR when its own checks pass.");
    for (const name of buttonNames()) expect(name, name).not.toMatch(/merge/i);
  });

  it("offers Allow once and Deny only: no 'Always for this playbook' button, and no always reason", async () => {
    const merge = mergeApproval(1);
    expect(alwaysRefusalFor(merge)).toBeUndefined();
    await mount({ approvals: [merge] });
    expect(screen.getByRole("button", { name: /^Allow once/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Deny/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Always/ })).toBeNull();
    expect(within(screen.getByTestId("approval-detail")).queryByText(/Always for this playbook/)).toBeNull();
    expect(screen.queryByTestId("always-reason")).toBeNull();
  });

  it("the ⇧A command is disabled for a merge approval, and enabled again for one that is not", async () => {
    const { registry } = await mount({ approvals: [mergeApproval(1), approval(2)] });
    expect(selectedId()).toBe(1);
    expect(registry.get(APPROVAL_COMMANDS.approveAlways)?.enabled?.()).toBe(false);
    expect(registry.get(APPROVAL_COMMANDS.approveOnce)?.enabled?.()).toBe(true);
    expect(registry.get(APPROVAL_COMMANDS.deny)?.enabled?.()).toBe(true);
    press("j");
    expect(selectedId()).toBe(2);
    expect(screen.getByRole("button", { name: /^Always for this playbook/ })).toBeTruthy();
    expect(registry.get(APPROVAL_COMMANDS.approveAlways)?.enabled?.()).toBe(true);
  });

  it("Shift+A on a pending, rail-held merge approval sends no request and says a merge is asked every time", async () => {
    const merge = mergeApproval(1);
    expect(alwaysRefusalFor(merge)).toBeUndefined();
    const { fake } = await mount({ approvals: [merge] });
    press("A", { shiftKey: true });
    await act(async () => undefined);
    expect(fake.requests.filter((r) => r.req.method === "POST")).toEqual([]);
    expect(screen.getByTestId("approval-notice").textContent).toBe(MERGE_ALWAYS_REFUSED);
    expect(screen.getByTestId("approval-notice").getAttribute("data-tone")).toBe("attention");
    expect(MERGE_ALWAYS_REFUSED).toContain("A merge is asked every time");
    // Still pending, still decidable.
    expect(screen.getByRole("button", { name: /^Allow once/ }).hasAttribute("disabled")).toBe(false);
  });

  it("running the ⇧A command directly (the palette) sends no request either", async () => {
    const merge = mergeApproval(1);
    expect(alwaysRefusalFor(merge)).toBeUndefined();
    const { fake, registry } = await mount({ approvals: [merge] });
    await act(async () => registry.get(APPROVAL_COMMANDS.approveAlways)?.run());
    expect(fake.requests.filter((r) => r.req.method === "POST")).toEqual([]);
    expect(screen.getByTestId("approval-notice").textContent).toBe(MERGE_ALWAYS_REFUSED);
  });

  it("Allow once sends one approve once; Deny sends one deny; the card stays beside the outcome", async () => {
    const merge = mergeApproval(1);
    const { fake } = await mount({ approvals: [merge] });
    fake.route("POST /approvals/:id/approve", () =>
      ok({ approval: { ...merge, status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Allow once/ }));
    await waitFor(() => expect(screen.getByTestId("approval-outcome").textContent).toContain("Allowed once by owner"));
    const approves = posts(fake, "POST /approvals/:id/approve");
    expect(approves).toHaveLength(1);
    expect(JSON.stringify(approves[0]?.body)).toBe('{"decision":"once"}');
    expect(posts(fake, "POST /approvals/:id/deny")).toHaveLength(0);
    expect(card()).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Allow once/ })).toBeNull();
    cleanup();

    const again = mergeApproval(3);
    const second = await mount({ approvals: [again] });
    second.fake.route("POST /approvals/:id/deny", () =>
      ok({ approval: { ...again, status: "denied", decision: "deny", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Deny/ }));
    await waitFor(() => expect(screen.getByTestId("approval-outcome").textContent).toContain("Denied by owner"));
    expect(posts(second.fake, "POST /approvals/:id/deny")).toHaveLength(1);
    expect(posts(second.fake, "POST /approvals/:id/approve")).toHaveLength(0);
    expect(card()).toBeTruthy();
  });

  it("keeps the generic header, the exact payload and the display under the card", async () => {
    await mount({ approvals: [mergeApproval(1, {}, "rail", { display: "Allow PR #21 on acme/widgets" })] });
    expect(screen.getByTestId("approval-action").textContent).toBe("kernel_merge_approval_request");
    expect(screen.getByTestId("approval-payload").textContent).toContain(SHA);
    expect(screen.getByTestId("approval-display").textContent).toBe("Allow PR #21 on acme/widgets");
    const detail = screen.getByTestId("approval-detail");
    expect(card().compareDocumentPosition(screen.getByTestId("approval-payload")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(detail.contains(card())).toBe(true);
  });

  it("a merge-action approval whose repo, pr or head_sha does not validate gets no card and builds no PR URL", async () => {
    await mount({ approvals: [mergeApproval(1, { head_sha: "not-a-sha" })] });
    expect(screen.queryByTestId("merge-card")).toBeNull();
    expect(screen.queryByTestId("merge-url")).toBeNull();
    expect(screen.getByTestId("screen-approvals").textContent).not.toContain("https://github.com/");
  });

  it("a merge-action approval whose fields do not validate still has no Always button, ⇧A is disabled, and Shift+A sends nothing", async () => {
    const bad = [
      mergeApproval(1, { head_sha: SHA.toUpperCase() }),
      mergeApproval(2, { pr: "21" }),
      mergeApproval(3, {}, "rail", { payload: { repo: "evil/top", pr: 1, head_sha: "abcdef0", input: { repo: "acme/widgets", pr: 21, head_sha: SHA } } }),
    ];
    for (const one of bad) {
      expect(mergeApprovalOf(one)).toBeUndefined();
      const { fake, registry } = await mount({ approvals: [one] });
      expect(screen.queryByTestId("merge-card")).toBeNull();
      expect(screen.getByRole("button", { name: /^Allow once/ })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Deny/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Always/ })).toBeNull();
      expect(registry.get(APPROVAL_COMMANDS.approveAlways)?.enabled?.()).toBe(false);
      press("A", { shiftKey: true });
      await act(async () => registry.get(APPROVAL_COMMANDS.approveAlways)?.run());
      expect(fake.requests.filter((r) => r.req.method === "POST")).toEqual([]);
      cleanup();
    }
  });

  it("a non-merge approval renders and decides as before: no card, Always offered and sent", async () => {
    const plain = approval(5);
    const { fake } = await mount({ approvals: [plain] });
    expect(screen.queryByTestId("merge-card")).toBeNull();
    fake.route("POST /approvals/:id/approve", () =>
      ok({ approval: { ...plain, status: "approved", decision: "always", decided_by: "owner", decided_at: "2026-10-22T09:00:00.000Z" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Always for this playbook/ }));
    await waitFor(() => expect(screen.getByTestId("approval-outcome").textContent).toContain("Always allowed for this playbook"));
    expect(posts(fake, "POST /approvals/:id/approve").map((r) => r.body)).toEqual([{ decision: "always" }]);
  });
});

// ---- Phase 8 item 18d: the charter card's Ask or change and Copy all text on this screen ----

describe("the charter card (phase 8 item 18d)", () => {
  const DISPLAY = [
    'Create crew member mason ("Mason", crab crew-teal), proposed by Wright',
    "job: Read a PR",
    "  - Read one pull request.",
    "enforced: never: git_push; tools: Read, mcp__kernel__kernel_github_pr_get; bash prefixes: none",
    "workspaces: none",
  ].join("\n");
  const held = (overrides: Partial<Approval> = {}): Approval =>
    approval(5, {
      requesting_agent: "wright",
      requesting_session: 31,
      action: "kernel_agent_create",
      payload: { tool: "mcp__kernel__kernel_agent_create", input: { charter: { id: "mason" } } },
      playbook: null,
      display: DISPLAY,
      ...overrides,
    });
  const drafting = { type: "message", ...brainMessage(4, "ask", "Draft me Mason."), session_id: 31, reply_text: "Here it is.", thread_id: 4 };

  it("AC1: the details start hidden; Copy all text writes the stored display exactly", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void written.push(t) } });
    try {
      await mount({ approvals: [held()] });
      const card = screen.getByTestId("approval-display");
      expect((within(card).getByTestId("charter-raw") as HTMLDetailsElement).open).toBe(false);
      expect(card.textContent).not.toContain("mcp__kernel__");
      await act(async () => {
        fireEvent.click(within(card).getByRole("button", { name: "Copy all text" }));
      });
      await waitFor(() => expect(written).toEqual([DISPLAY]));
    } finally {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("AC4: a pending charter's Ask or change posts a Reply into its drafting thread and links to that thread in Chat", async () => {
    const m = await mount({ approvals: [held()] });
    m.fake.route("GET /threads/:agent", () => ok({ items: [drafting], next_before: null, pending_approvals: [], threads: [{ id: 4, agent: "wright", title: "Mason", renamed: false, messages: 1, latest_reply_tokens: null, summary_estimated_tokens: null }] }));
    m.fake.route("POST /ask", () => ({ ok: true, status: 202, body: { message_id: 100, queue_id: 100 } }));
    // The thread is read through the live store once the card mounted; nudge a refetch with the route in place.
    cleanup();
    setApi(m.fake.bridge);
    render(<ApprovalsScreen registry={createCommandRegistry()} />);
    const field = await screen.findByRole("textbox", { name: "Ask or change" });
    await waitFor(() => expect(screen.getByTestId("charter-ask-where").textContent).toContain("“Mason”"));
    expect(screen.getByTestId("charter-ask-thread").getAttribute("href")).toBe("#/chat");
    await act(async () => {
      fireEvent.change(field, { target: { value: "why Read a PR?" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    await waitFor(() => expect(posts(m.fake, "POST /ask")).toHaveLength(1));
    expect(posts(m.fake, "POST /ask")[0]?.body).toEqual({ text: "From the card's Ask or change (approval 5): why Read a PR?", agent: "wright", continues: 4 });
    expect(posts(m.fake, "POST /approvals/:id/approve")).toHaveLength(0);
  });

  it("a decided charter has no Ask or change box", async () => {
    await mount({ approvals: [], decided: [held({ status: "denied", decision: "deny", decided_by: "kernel", replaced_by: 6 })] });
    fireEvent.click(screen.getByRole("button", { name: /Show decided/ }));
    await waitFor(() => expect(screen.queryByTestId("approval-detail")).not.toBeNull());
    expect(screen.queryByRole("textbox", { name: "Ask or change" })).toBeNull();
  });
});
