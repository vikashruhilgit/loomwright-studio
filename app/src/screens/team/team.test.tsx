// @vitest-environment jsdom
/// <reference types="node" />
// The Team screen (phase 5 item 14) against a scripted bridge (`fake-bridge.ts`):
// the cards (AC1, AC2), the inspector's enforced permissions (AC3), rename / set /
// off / on through the owner routes with the card updated only by the feed (AC4),
// Wright's inspector (AC5), the New crew member form and `POST /agents` (AC6),
// "Ask Wright to draft it" (AC7), the ⌘K commands (AC8), keyboard reachability
// and focus (AC9), and the kernel vocabularies the form offers, read from the
// kernel's own source as text (the `Avatar.test.tsx` pattern).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDetailResponse, ApiRequest, ApiResult, Approval, BrainMessage, EventFrame, RosterEntry, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge, Responder } from "../../store/fake-bridge";
import { screen as teamScreen } from "./index";
import { fetchAgentDetail } from "./actions";
import {
  AVATAR_HUES,
  AVATAR_SHAPES,
  EMPTY_FORM,
  NEVER_CATEGORIES,
  PERMISSION_MODES,
  WRIGHT_SET_FIELDS,
  charterOf,
  enforcedToolPolicy,
  limitOf,
  outcomeOf,
  rosterModel,
  settingText,
  settingsRead,
  taskLineFor,
} from "./model";
import { TeamView } from "./TeamView";

// Sources are read from disk: vitest stubs CSS imports, and the kernel lives outside the app's Vite root.
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(resolve(HERE, relative), "utf8");
const kernelAgentTypes = read("../../../../kernel/src/agents/types.ts");
const kernelPolicy = read("../../../../kernel/src/sessions/policy.ts");
const kernelCharterFiles = read("../../../../kernel/src/agents/charter-files.ts");
const teamCss = read("team.css");

/** The string literals of a kernel `export const NAME = Object.freeze([...])` list; throws when it is gone or empty. */
function kernelFrozenList(source: string, name: string): string[] {
  const body = new RegExp(`export const ${name} = Object\\.freeze\\(\\[([^\\]]*)\\]`).exec(source)?.[1];
  const values = [...(body ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  if (values.length === 0) throw new Error(`kernel source has no non-empty frozen list ${name}`);
  return values;
}

/** The keys of the charter validator's `const PERMISSION_MODES = { key: true, ... }` object literal; throws when none. */
function kernelPermissionModes(source: string): string[] {
  const body = /const PERMISSION_MODES = \{([^}]*)\}/.exec(source)?.[1];
  const keys = [...(body ?? "").matchAll(/^\s*([A-Za-z]+): true,?\s*$/gm)].map((m) => m[1] as string);
  if (keys.length === 0) throw new Error("kernel charter-files.ts has no PERMISSION_MODES object literal with `key: true` lines");
  return keys;
}

// ---- Fixtures -------------------------------------------------------------------------------

const STATUS: StatusBody = {
  kernel: { version: "1.0.0", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-10-22", agents: [] },
  cap_state: [],
};

function entry(overrides: Partial<RosterEntry> & Pick<RosterEntry, "id" | "display_name">): RosterEntry {
  return {
    avatar: { shape: "shark", hue: "crew-teal" },
    status: "active",
    created_by: "owner",
    approval_id: null,
    model: "claude-sonnet",
    settings_error: null,
    tokens_today: 0,
    tokens_per_day: null,
    sessions_running: 0,
    sessions_at_once: null,
    ...overrides,
  };
}

const WRIGHT = entry({
  id: "wright",
  display_name: "Wright",
  avatar: { shape: "whale", hue: "accent" },
  created_by: null,
  model: "claude-opus",
  tokens_today: 142_000,
  tokens_per_day: 375_000,
  sessions_running: 1,
  sessions_at_once: 2,
});
const MASON = entry({ id: "mason", display_name: "Mason", avatar: { shape: "shark", hue: "crew-teal" }, tokens_today: 9_400, tokens_per_day: null, sessions_at_once: null });
const PIM = entry({ id: "pim", display_name: "Pim", avatar: { shape: "octopus", hue: "crew-berry" }, status: "off", tokens_today: 0, tokens_per_day: 100_000, sessions_at_once: 1 });

const LONG_ROLE =
  "Reviews every pull request the owner opens on the personal repositories, leaving comments only, never pushing, never approving, and never closing anything, with a short summary of risk at the top of each review.";

function detail(agent: RosterEntry, overrides: Partial<AgentDetailResponse> = {}): AgentDetailResponse {
  return {
    agent,
    settings: {
      file: `/Users/o/.loomwright-studio/config/agents/${agent.id}.json`,
      content: {
        model: agent.model,
        permission_mode: "default",
        tool_policy: { allowedTools: ["Read", "Grep"], allowedBashPrefixes: ["git diff", "gh pr view"] },
        never: ["git_push", "gh_pr_create"],
        limits: { delegation_depth: 2 },
        workspaces: ["/Users/o/code/site"],
      },
      error: null,
    },
    never: ["git_push", "gh_pr_create"],
    workspaces: ["/Users/o/code/site"],
    memory: {
      dir: `/Users/o/.loomwright-studio/memory/${agent.id}`,
      files: [
        { name: "role.md", path: `/Users/o/.loomwright-studio/memory/${agent.id}/role.md`, present: true },
        { name: "lessons.md", path: `/Users/o/.loomwright-studio/memory/${agent.id}/lessons.md`, present: false },
      ],
    },
    charter: { persona: agent.id === "mason" ? LONG_ROLE : "Plain and brief.", duties: ["Review each PR"], boundaries: ["Ask before anything outward"] },
    ...overrides,
  };
}

function approval(overrides: Partial<Approval> & Pick<Approval, "id" | "requesting_agent">): Approval {
  return {
    requesting_session: null,
    action: "gh_pr_comment",
    payload: {},
    requested_at: new Date(0).toISOString(),
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
    ...overrides,
  };
}

function message(overrides: Partial<BrainMessage> & Pick<BrainMessage, "id" | "agent" | "text">): BrainMessage {
  return {
    queue_id: overrides.id,
    source: "ask",
    status: "running",
    session_id: null,
    reply_text: null,
    detail: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    from_agent: null,
    depth: 0,
    reply_to: null,
    workspace: null,
    ...overrides,
  };
}

function refused(status: number, body: Record<string, unknown>): ApiResult<unknown> {
  return { ok: false, status, body: { error: "refused", ...body } };
}

interface Kernel {
  readonly fake: FakeBridge;
  readonly registry: CommandRegistry;
  roster: RosterEntry[];
  approvals: Approval[];
  messages: BrainMessage[];
  details: Record<string, AgentDetailResponse>;
}

let nextEventId = 1;

function feedEvent(kind: string): EventFrame {
  const id = nextEventId;
  nextEventId += 1;
  return { type: "event", id, at: new Date(id * 1000).toISOString(), kind, session_id: null, task_id: null, payload: {} };
}

/** Answers for `GET /approvals` and `GET /messages` in place of the kernel's lists (a refusal, or one that never comes). */
interface Answers {
  readonly approvals?: Responder;
  readonly messages?: Responder;
}

async function startTeam(setup: Partial<Omit<Kernel, "fake" | "registry">> = {}, answers: Answers = {}): Promise<Kernel> {
  const fake = fakeBridge();
  const kernel: Kernel = {
    fake,
    registry: createCommandRegistry(),
    // The kernel lists Wright first; the fixture does not, so the view's own ordering is what puts Wright first.
    roster: setup.roster ?? [MASON, WRIGHT, PIM],
    approvals: setup.approvals ?? [],
    messages: setup.messages ?? [],
    details: setup.details ?? { mason: detail(MASON), pim: detail(PIM) },
  };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /agents", () => ok({ agents: kernel.roster }));
  fake.route("GET /approvals", answers.approvals ?? (() => ok({ approvals: kernel.approvals })));
  fake.route("GET /messages", answers.messages ?? (() => ok({ messages: kernel.messages })));
  fake.route("GET /agents/:id", (req) => {
    const id = String(req.params?.id);
    if (id === "wright") return refused(409, { error: "reserved", message: "Wright is not a crew member" });
    const d = kernel.details[id];
    return d === undefined ? refused(404, { error: "not_found", message: `no crew member ${id}` }) : ok(d);
  });
  render(<TeamView api={fake.bridge} registry={kernel.registry} />);
  await screen.findAllByTestId("team-card");
  return kernel;
}

function emit(kernel: Kernel, kind: string): void {
  act(() => kernel.fake.emit(feedEvent(kind)));
}

function cards(): HTMLElement[] {
  return screen.getAllByTestId("team-card");
}

function card(name: string): HTMLElement {
  const found = cards().find((c) => within(c).queryByText(name, { selector: ".card-name" }) !== null);
  if (found === undefined) throw new Error(`no card named ${name}`);
  return found;
}

async function openInspector(name: string): Promise<HTMLElement> {
  fireEvent.click(card(name));
  return screen.findByTestId("team-inspector");
}

function requests(kernel: Kernel, key: string): ApiRequest[] {
  return kernel.fake.requestsTo(key).map((r) => r.req);
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

// ---- AC1, AC2: the cards ---------------------------------------------------------------------

describe("the cards", () => {
  it("shows three cards in the CardGrid, Wright first as the whale", async () => {
    await startTeam();
    const grid = screen.getByRole("group", { name: "Agents" });
    expect(grid.classList.contains("card-grid")).toBe(true);
    const all = cards();
    expect(all.map((c) => c.querySelector(".card-name")?.textContent)).toEqual(["Wright", "Mason", "Pim"]);
    const whale = all[0]?.querySelector(".bot");
    expect(whale?.classList.contains("lead")).toBe(true);
    expect(whale?.querySelector(".crown")).not.toBeNull();
    expect(all[0]?.getAttribute("data-agent-id")).toBe("wright");
  });

  it("shows avatar, name, role, task, tokens against the daily limit, sessions against sessions at once, and status", async () => {
    await startTeam();
    const wright = card("Wright");
    expect(within(wright).getByTestId("team-card-role").textContent).toBe("Lead agent");
    expect(within(wright).getByTestId("team-card-task").textContent).toBe("idle");
    expect(within(wright).getByTestId("team-card-budget").textContent).toBe("142k of 375k today");
    expect(within(wright).getByTestId("team-card-sessions").textContent).toBe("1 of 2 sessions");
    expect(within(wright).getByTestId("team-card-status").textContent).toBe("active");
    expect(within(wright).getByRole("img", { name: /^Wright · / })).toBeTruthy();
    const pim = card("Pim");
    expect(within(pim).getByTestId("team-card-status").textContent).toBe("off");
    expect(within(pim).getByTestId("team-card-sessions").textContent).toBe("0 of 1 session");
    await waitFor(() => expect(within(pim).getByTestId("team-card-role").textContent).toBe("Plain and brief."));
  });

  it('says "no limit" when tokens_per_day (and sessions_at_once) is null', async () => {
    await startTeam();
    const mason = card("Mason");
    expect(within(mason).getByTestId("team-card-budget").textContent).toBe("9.4k today · no limit");
    expect(within(mason).getByTestId("team-card-sessions").textContent).toBe("0 sessions · no limit");
  });

  it('a pending approval for the agent makes its task line "Waiting on you · …", with the waiting dot', async () => {
    await startTeam({
      approvals: [
        approval({ id: 4, requesting_agent: "mason", display: "Comment on PR #12" }),
        approval({ id: 5, requesting_agent: "pim", action: "git_push", status: "approved" }),
      ],
      messages: [message({ id: 9, agent: "mason", text: "Reviewing PR #12" })],
    });
    const mason = card("Mason");
    expect(within(mason).getByTestId("team-card-task").textContent).toBe("Waiting on you · Comment on PR #12");
    expect(mason.querySelector(".card-task-line .status-dot")?.getAttribute("data-state")).toBe("waiting");
    // A decided approval is not waiting.
    expect(within(card("Pim")).getByTestId("team-card-task").textContent).toBe("idle");
  });

  it("an approval with no display reads its action; otherwise the running brain message is the task, with the working dot", async () => {
    await startTeam({
      approvals: [approval({ id: 6, requesting_agent: "pim", action: "gh_issue_comment" })],
      messages: [message({ id: 1, agent: "wright", text: "Planning the week" }), message({ id: 2, agent: "mason", text: "done", status: "replied" })],
    });
    expect(within(card("Pim")).getByTestId("team-card-task").textContent).toBe("Waiting on you · gh_issue_comment");
    const wright = card("Wright");
    expect(within(wright).getByTestId("team-card-task").textContent).toBe("Planning the week");
    expect(wright.querySelector(".card-task-line .status-dot")?.getAttribute("data-state")).toBe("working");
    expect(within(card("Mason")).getByTestId("team-card-task").textContent).toBe("idle");
  });

  it("clamps a long role at two lines with the full text as the card's tooltip, and shows it unclamped in the inspector", async () => {
    await startTeam();
    const mason = card("Mason");
    await waitFor(() => expect(within(mason).getByTestId("team-card-role").textContent).toBe(LONG_ROLE));
    expect(within(mason).getByTestId("team-card-role").classList.contains("card-role")).toBe(true);
    expect(mason.getAttribute("title")).toBe(LONG_ROLE);
    const cardCss = read("../../components/Card/Card.css");
    expect(/\.card-role \{[^}]*-webkit-line-clamp: 2;[^}]*\}/.exec(cardCss)).not.toBeNull();
    const inspector = await openInspector("Mason");
    const role = within(inspector).getByTestId("team-insp-role");
    expect(role.textContent).toBe(LONG_ROLE);
    expect(role.classList.contains("card-role")).toBe(false);
  });

  it("renders kernel strings as text, never markup", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    await startTeam({
      roster: [WRIGHT, { ...MASON, display_name: hostile }],
      messages: [message({ id: 3, agent: "mason", text: hostile })],
      details: { mason: detail(MASON, { charter: { persona: hostile, duties: [hostile], boundaries: [] } }) },
    });
    const mason = card(hostile);
    expect(mason.querySelector("img")).toBeNull();
    expect(within(mason).getByTestId("team-card-task").textContent).toBe(hostile);
    const inspector = await openInspector(hostile);
    await waitFor(() => expect(within(inspector).getByTestId("team-insp-role").textContent).toBe(hostile));
    expect(document.querySelector("img")).toBeNull();
  });

  it('a refused GET /approvals reads every task line "status unavailable" with no dot, and says so in an alert, never "idle"', async () => {
    await startTeam({ messages: [message({ id: 1, agent: "wright", text: "Planning the week" })] }, { approvals: () => refused(500, { error: "internal", message: "approvals down" }) });
    await waitFor(() => expect(within(card("Mason")).getByTestId("team-card-task").textContent).toBe("status unavailable"));
    for (const c of cards()) {
      expect(within(c).getByTestId("team-card-task").textContent).toBe("status unavailable");
      expect(within(c).getByTestId("team-card-task").getAttribute("data-unknown")).toBe("true");
      expect(c.querySelector(".card-task-line .status-dot")).toBeNull();
    }
    // A running message is not shown as working: a pending approval would outrank it, and approvals were not read.
    expect(screen.getByTestId("team-tasks-error").textContent).toBe("Couldn't read what the agents are doing (approvals: internal: approvals down)");
    expect(screen.getByTestId("team-tasks-error").getAttribute("role")).toBe("alert");
  });

  it("a refused GET /messages still shows a pending approval as waiting; every other card is unavailable, never idle", async () => {
    await startTeam({ approvals: [approval({ id: 4, requesting_agent: "mason", display: "Comment on PR #12" })] }, { messages: () => refused(500, { error: "internal", message: "messages down" }) });
    await waitFor(() => expect(within(card("Wright")).getByTestId("team-card-task").textContent).toBe("status unavailable"));
    expect(within(card("Mason")).getByTestId("team-card-task").textContent).toBe("Waiting on you · Comment on PR #12");
    expect(within(card("Pim")).getByTestId("team-card-task").textContent).toBe("status unavailable");
    expect(screen.getByTestId("team-tasks-error").textContent).toContain("messages: internal: messages down");
  });

  it('approvals and messages still loading read "checking status…", with no dot and no alert, never "idle"', async () => {
    const never = () => new Promise<ApiResult<unknown>>(() => undefined);
    await startTeam({}, { approvals: never, messages: never });
    for (const c of cards()) {
      expect(within(c).getByTestId("team-card-task").textContent).toBe("checking status…");
      expect(c.querySelector(".card-task-line .status-dot")).toBeNull();
    }
    expect(screen.queryByTestId("team-tasks-error")).toBeNull();
  });

  it("taskLineFor claims a state only from the lists it was read from", () => {
    const pending = [approval({ id: 1, requesting_agent: "mason", display: "Push" })];
    const running = [message({ id: 2, agent: "mason", text: "Working" })];
    expect(taskLineFor("mason", pending, undefined)).toEqual({ state: "waiting", text: "Waiting on you · Push" });
    expect(taskLineFor("mason", undefined, running)).toEqual({ state: "unknown", text: "status unavailable" });
    expect(taskLineFor("mason", [], undefined, "checking status…")).toEqual({ state: "unknown", text: "checking status…" });
    expect(taskLineFor("mason", [], running)).toEqual({ state: "working", text: "Working" });
    expect(taskLineFor("mason", [], [])).toEqual({ state: "idle", text: "idle" });
  });

  it('Wright\'s model_unset: its limits were read (null is "no limit") and its model is "not set"', async () => {
    const unset = { ...WRIGHT, model: null, settings_error: "model_unset", tokens_per_day: null, sessions_at_once: null };
    await startTeam({ roster: [unset, MASON, PIM] });
    const wright = card("Wright");
    expect(within(wright).getByTestId("team-card-sessions").textContent).toBe("1 session · no limit");
    expect(within(wright).getByTestId("team-card-budget").textContent).toBe("142k today · no limit");
    expect(wright.textContent).toContain("model not set");
    expect(wright.textContent).not.toContain("unknown");
    const inspector = await openInspector("Wright");
    const limits = within(inspector).getByTestId("team-insp-limits");
    expect(limits.textContent).toContain("Modelnot set");
    expect(limits.textContent).toContain("1 session · no limit");
  });

  it("a crew member's model_unset: the roster sends no limits for it, so they stay unknown; its model is \"not set\"", () => {
    const unset = { ...MASON, model: null, settings_error: "model_unset" };
    expect(settingsRead(unset)).toBe(false);
    expect(rosterModel(unset)).toBe("not set");
    expect(settingsRead({ ...WRIGHT, settings_error: "model_unset" })).toBe(true);
    expect(settingsRead({ ...WRIGHT, settings_error: "settings_invalid" })).toBe(false);
    expect(rosterModel({ ...WRIGHT, model: null, settings_error: "settings_invalid" })).toBe("unknown");
  });
});

describe("the designed states", () => {
  it("loading: skeleton cards while GET /agents has not answered", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /agents", () => new Promise<ApiResult<unknown>>(() => undefined));
    render(<TeamView api={fake.bridge} registry={createCommandRegistry()} />);
    expect(await screen.findByTestId("team-loading")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading the team…");
    expect(screen.queryAllByTestId("team-card")).toEqual([]);
  });

  it("error: the refusal's error and message, as text", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /agents", () => refused(500, { error: "internal", message: "<b>boom</b>" }));
    render(<TeamView api={fake.bridge} registry={createCommandRegistry()} />);
    const error = await screen.findByTestId("team-error");
    expect(error.textContent).toContain("Couldn't load the team");
    expect(error.textContent).toContain("internal: <b>boom</b>");
    expect(error.querySelector("b")).toBeNull();
  });

  it("empty: Wright alone, with the note on creating a crew member", async () => {
    await startTeam({ roster: [WRIGHT], details: {} });
    expect(cards().length).toBe(1);
    expect(screen.getByTestId("team-empty").textContent).toContain("No crew members yet");
  });
});

// ---- AC3, AC4: a crew member's inspector -----------------------------------------------------------

describe("a crew member's inspector", () => {
  it("labels the allowed tools and Bash prefixes enforced, from the settings file, apart from the prose boundaries", async () => {
    await startTeam();
    const inspector = await openInspector("Mason");
    const enforced = await within(inspector).findByTestId("team-enforced");
    const tools = within(enforced).getByTestId("team-enforced-tools");
    expect(within(tools).getByText("enforced")).toBeTruthy();
    expect(within(tools).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Read", "Grep"]);
    const bash = within(enforced).getByTestId("team-enforced-bash");
    expect(within(bash).getByText("enforced")).toBeTruthy();
    expect(within(bash).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["git diff", "gh pr view"]);
    const guidance = within(inspector).getByTestId("team-guidance");
    expect(guidance.textContent).toContain("guidance");
    expect(guidance.textContent).toContain("Ask before anything outward");
    expect(enforced.contains(guidance)).toBe(false);
    expect(guidance.contains(enforced)).toBe(false);
  });

  it("labels the never list enforced", async () => {
    await startTeam();
    const inspector = await openInspector("Mason");
    const never = await within(inspector).findByTestId("team-enforced-never");
    expect(within(never).getByText("enforced")).toBeTruthy();
    expect(within(never).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["git_push", "gh_pr_create"]);
  });

  it("shows model, limits, workspaces and the memory files as plain paths", async () => {
    await startTeam();
    const inspector = await openInspector("Mason");
    const memory = await within(inspector).findByTestId("team-insp-memory");
    expect(memory.querySelector("a")).toBeNull();
    expect(memory.textContent).toContain("/Users/o/.loomwright-studio/config/agents/mason.json");
    expect(memory.textContent).toContain("/Users/o/.loomwright-studio/memory/mason/lessons.md (missing)");
    expect(inspector.textContent).toContain("/Users/o/code/site");
    const limits = within(inspector).getByTestId("team-insp-limits");
    expect(limits.textContent).toContain("claude-sonnet");
    expect(limits.textContent).toContain("9.4k tokens today · no limit");
    expect(limits.textContent).toContain("Delegation2");
  });

  it('says "settings file unreadable" with the settings error when the content is null', async () => {
    await startTeam({
      details: {
        mason: detail(MASON, { settings: { file: "/x.json", content: null, error: { error: "settings_invalid", message: "not JSON" } }, never: null }),
        pim: detail(PIM),
      },
    });
    const inspector = await openInspector("Mason");
    expect((await within(inspector).findByTestId("team-settings-unreadable")).textContent).toBe("settings file unreadable: not JSON");
    // An unread file states no value: Mason's delegation depth may be enforced, so it is not "no limit".
    const limits = within(inspector).getByTestId("team-insp-limits");
    expect(limits.textContent).toContain("Effortunknown");
    expect(limits.textContent).toContain("Delegationunknown");
    expect(limits.textContent).toContain("Permissionunknown");
    expect(limits.textContent).not.toContain("not set");
    expect(limits.textContent).toContain("Modelclaude-sonnet");
  });

  it("a settings file the kernel refused shows no enforced policy and no setting, even when its content parses", async () => {
    const rejected = { ...MASON, model: null, settings_error: "settings_invalid" };
    const content = {
      model: "claude-opus",
      permission_mode: "acceptEdits",
      tool_policy: { allowedTools: ["Bash", "Write"], allowedBashPrefixes: ["rm"] },
      limits: {},
      colour: "red",
    };
    await startTeam({
      roster: [WRIGHT, rejected, PIM],
      details: {
        mason: detail(rejected, {
          settings: { file: "/x.json", content, error: { error: "settings_invalid", field: "the file", message: 'unknown key "colour"' } },
          never: null,
          workspaces: null,
        }),
        pim: detail(PIM),
      },
    });
    const inspector = await openInspector("Mason");
    expect((await within(inspector).findByTestId("team-settings-unreadable")).textContent).toBe('settings file unreadable: unknown key "colour"');
    expect(within(inspector).queryByTestId("team-enforced-tools")).toBeNull();
    expect(within(inspector).queryByTestId("team-enforced-bash")).toBeNull();
    expect(inspector.textContent).not.toContain("Bash");
    const limits = within(inspector).getByTestId("team-insp-limits");
    expect(limits.textContent).toContain("Modelunknown");
    expect(limits.textContent).toContain("Effortunknown");
    expect(limits.textContent).toContain("Delegationunknown");
    expect(limits.textContent).toContain("Permissionunknown");
    expect(limits.textContent).not.toContain("claude-opus");
    expect(limits.textContent).not.toContain("acceptEdits");
    expect(limits.textContent).not.toContain("no limit");
  });

  it("a charter whose duties or boundaries do not parse reads them as not read, never \"None stated\"", async () => {
    await startTeam({ details: { mason: detail(MASON, { charter: { persona: "Plain.", duties: "review", boundaries: [3] } }), pim: detail(PIM, { charter: null }) } });
    let inspector = await openInspector("Mason");
    await within(inspector).findByTestId("team-enforced");
    expect(within(inspector).getAllByText("Not read: the charter does not parse.")).toHaveLength(2);
    expect(inspector.textContent).not.toContain("None stated");
    inspector = await openInspector("Pim");
    await within(inspector).findByTestId("team-enforced");
    expect(within(inspector).getAllByText("Not read: the charter does not parse.")).toHaveLength(2);
    expect(within(card("Pim")).getByTestId("team-card-role").textContent).toBe("Role unavailable");
  });

  it('a refused detail reads its settings as "unknown", never "no limit" or "not set"', async () => {
    await startTeam({ details: { pim: detail(PIM) } });
    const inspector = await openInspector("Mason");
    await within(inspector).findByTestId("team-detail-error");
    const limits = within(inspector).getByTestId("team-insp-limits");
    expect(limits.textContent).toContain("Effortunknown");
    expect(limits.textContent).toContain("Delegationunknown");
    expect(limits.textContent).toContain("Permissionunknown");
    expect(limits.textContent).not.toContain("not set");
    expect(limits.textContent).not.toContain("Delegationno limit");
  });

  it("an unread settings file reads the roster's limits and model as unknown, on the card and in the inspector", async () => {
    const unread = { ...MASON, model: null, settings_error: "settings_invalid" };
    await startTeam({ roster: [WRIGHT, unread, PIM], details: { mason: detail(unread, { settings: { file: "/x.json", content: null, error: { error: "settings_invalid", message: "not JSON" } }, never: null }), pim: detail(PIM) } });
    const mason = card("Mason");
    expect(within(mason).getByTestId("team-card-budget").textContent).toBe("9.4k today · limit unknown");
    expect(within(mason).getByTestId("team-card-sessions").textContent).toBe("0 sessions · limit unknown");
    expect(mason.textContent).toContain("model unknown");
    expect(mason.textContent).not.toContain("no limit");
    const inspector = await openInspector("Mason");
    const limits = within(inspector).getByTestId("team-insp-limits");
    expect(limits.textContent).toContain("Modelunknown");
    expect(limits.textContent).toContain("9.4k tokens today · limit unknown");
    expect(limits.textContent).toContain("0 sessions · limit unknown");
    expect(limits.textContent).not.toContain("no limit");
  });

  it("renames through POST /agents/:id/rename; the card changes only when the feed reports it", async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /agents/:id/rename", (req) => ok({ agent: { id: req.params?.id }, changed: true }));
    const inspector = await openInspector("Mason");
    fireEvent.click(within(inspector).getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename Mason" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Mason R." } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Rename/ }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/rename")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/rename")[0]).toMatchObject({ params: { id: "mason" }, body: { display_name: "Mason R." } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // No local edit: the card still reads the kernel's last answer.
    expect(card("Mason")).toBeTruthy();
    kernel.roster = kernel.roster.map((a) => (a.id === "mason" ? { ...a, display_name: "Mason R." } : a));
    emit(kernel, "agent_renamed");
    await waitFor(() => expect(card("Mason R.")).toBeTruthy());
  });

  it("shows a rename refusal's error and message in the dialog, as text", async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /agents/:id/rename", () => refused(400, { error: "invalid_input", message: "display_name: must not be blank", field: "display_name" }));
    await openInspector("Mason");
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename Mason" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: " " } });
    fireEvent.keyDown(within(dialog).getByLabelText("Name"), { key: "Enter" });
    expect(await within(dialog).findByText("invalid_input: display_name: must not be blank")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("sets a scalar field through POST /agents/:id/set with {field, value} as strings, and shows a refusal as text", async () => {
    const kernel = await startTeam();
    let answer: ApiResult<unknown> = ok({ agent: {}, field: "limits.tokens_per_day", old: null, new: 250000, changed: true });
    kernel.fake.route("POST /agents/:id/set", () => answer);
    const inspector = await openInspector("Mason");
    const fields = within(inspector).getByLabelText("Field") as HTMLSelectElement;
    expect([...fields.options].map((o) => o.value)).toEqual(["model", "effort", "permission_mode", "limits.tokens_per_day", "limits.sessions_at_once", "limits.delegation_depth"]);
    fireEvent.change(fields, { target: { value: "limits.tokens_per_day" } });
    fireEvent.change(within(inspector).getByLabelText("Value"), { target: { value: "250000" } });
    fireEvent.click(within(inspector).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "limits.tokens_per_day", value: "250000" } });
    expect((await within(inspector).findByTestId("team-insp-notice")).textContent).toBe("Tokens per day set to 250000.");

    answer = refused(400, { error: "invalid_input", message: "limits.sessions_at_once must be a positive whole number, or none (no limit)" });
    fireEvent.change(fields, { target: { value: "limits.sessions_at_once" } });
    fireEvent.change(within(inspector).getByLabelText("Value"), { target: { value: "lots" } });
    fireEvent.click(within(inspector).getByRole("button", { name: "Set" }));
    await waitFor(() =>
      expect(within(inspector).getByRole("alert").textContent).toBe("invalid_input: limits.sessions_at_once must be a positive whole number, or none (no limit)"),
    );
    expect(requests(kernel, "POST /agents/:id/set")[1]).toMatchObject({ body: { field: "limits.sessions_at_once", value: "lots" } });
  });

  it("turns a member off through POST /agents/:id/off and an off member on through /on; the card follows the feed", async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /agents/:id/off", () => ok({ agent: {}, changed: true }));
    kernel.fake.route("POST /agents/:id/on", () => refused(409, { error: "settings_invalid", message: "the settings file does not read ok" }));
    let inspector = await openInspector("Mason");
    fireEvent.click(within(inspector).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/off")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/off")[0]).toMatchObject({ params: { id: "mason" } });
    expect(within(card("Mason")).getByTestId("team-card-status").textContent).toBe("active");
    kernel.roster = kernel.roster.map((a) => (a.id === "mason" ? { ...a, status: "off" } : a));
    emit(kernel, "agent_status_changed");
    await waitFor(() => expect(within(card("Mason")).getByTestId("team-card-status").textContent).toBe("off"));

    inspector = await openInspector("Pim");
    expect(within(inspector).queryByRole("button", { name: "Turn off" })).toBeNull();
    fireEvent.click(within(inspector).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(within(inspector).getByRole("alert").textContent).toBe("settings_invalid: the settings file does not read ok"));
  });
});

describe("refusals and unreadable answers", () => {
  it("a crew member whose GET /agents/:id is refused: the card says role unavailable, the inspector shows the refusal", async () => {
    await startTeam({ details: { pim: detail(PIM) } });
    const mason = card("Mason");
    await waitFor(() => expect(within(mason).getByTestId("team-card-role").textContent).toBe("Role unavailable"));
    const inspector = await openInspector("Mason");
    expect(within(inspector).getByTestId("team-detail-error").textContent).toBe("not_found: no crew member mason");
  });

  it("outcomeOf names the connection, a failed IPC call, and a refusal with no message", () => {
    expect(outcomeOf({ ok: false, status: 0, connection: { state: "unreachable", reason: "timeout" } })).toEqual({ ok: false, message: "Couldn't reach the kernel (timeout)." });
    expect(outcomeOf({ ok: false, status: 0, connection: { state: "not_installed", dataDir: "/d" } })).toEqual({ ok: false, message: "The kernel isn't installed." });
    expect(outcomeOf(undefined)).toEqual({ ok: false, message: "The request did not reach the kernel." });
    expect(outcomeOf({ ok: false, status: 409, body: { error: "files_exist", file: "/d/x.json" } })).toEqual({ ok: false, message: "files_exist", field: "/d/x.json" });
  });

  it("a bridge call that throws is reported, never swallowed", async () => {
    const fake = fakeBridge();
    const throwing = { ...fake.bridge, request: async () => Promise.reject(new Error("ipc down")) };
    expect(await fetchAgentDetail(throwing, "mason")).toEqual({ ok: false, message: "The request did not reach the kernel." });
  });

  it("reads the settings file's tool policy defensively", () => {
    expect(enforcedToolPolicy(null)).toBeNull();
    expect(enforcedToolPolicy([])).toBeNull();
    expect(enforcedToolPolicy({ tool_policy: { allowedTools: ["Read", 3], allowedBashPrefixes: [] } })).toBeNull();
    expect(enforcedToolPolicy({ tool_policy: { allowedTools: ["Read"] } })).toBeNull();
    expect(enforcedToolPolicy({ tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: ["ls"] } })).toEqual({ allowedTools: ["Read"], allowedBashPrefixes: ["ls"] });
  });

  it('reads an unread setting as "unknown", and "no limit" only when the content parsed without it', () => {
    expect(settingText(null, "limits.delegation_depth", "no limit")).toBe("unknown");
    expect(settingText(undefined, "effort", "not set")).toBe("unknown");
    expect(settingText([], "permission_mode", "not set")).toBe("unknown");
    expect(settingText({ limits: "x" }, "limits.delegation_depth", "no limit")).toBe("unknown");
    expect(settingText({ limits: { delegation_depth: { n: 2 } } }, "limits.delegation_depth", "no limit")).toBe("unknown");
    expect(settingText({}, "limits.delegation_depth", "no limit")).toBe("no limit");
    expect(settingText({ limits: {} }, "limits.delegation_depth", "no limit")).toBe("no limit");
    expect(settingText({ limits: { delegation_depth: null } }, "limits.delegation_depth", "no limit")).toBe("no limit");
    expect(settingText({ limits: { delegation_depth: 2 } }, "limits.delegation_depth", "no limit")).toBe("2");
    expect(settingText({}, "effort", "not set")).toBe("not set");
  });

  it("sends a typed limit as a number only when a double holds it exactly; otherwise as the typed text", () => {
    expect(limitOf("")).toBeUndefined();
    expect(limitOf(" 250000 ")).toBe(250000);
    expect(limitOf("9007199254740991")).toBe(9007199254740991);
    expect(limitOf("9007199254740992")).toBe("9007199254740992");
    expect(limitOf("9007199254740993")).toBe("9007199254740993");
    expect(limitOf("1234567890123456789")).toBe("1234567890123456789");
    expect(limitOf("lots")).toBe("lots");
    expect(charterOf({ ...EMPTY_FORM, delegationDepth: "9007199254740993" }).limits).toEqual({ delegation_depth: "9007199254740993" });
  });
});

// ---- AC5: Wright's inspector ------------------------------------------------------------------

describe("Wright's inspector", () => {
  it("sets Wright's model through POST /agents/wright/set", async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /agents/:id/set", () => ok({ agent: WRIGHT, field: "model", old: "claude-opus", new: "claude-sonnet", changed: true }));
    const inspector = await openInspector("Wright");
    fireEvent.change(within(inspector).getByLabelText("Field"), { target: { value: "model" } });
    fireEvent.change(within(inspector).getByLabelText("Value"), { target: { value: "claude-sonnet" } });
    fireEvent.click(within(inspector).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ method: "POST", path: "/agents/:id/set", params: { id: "wright" }, body: { field: "model", value: "claude-sonnet" } });
  });

  it("offers no tool_policy or permission_mode control: only the WrightSetField fields, the rest read-only with edit wright.json", async () => {
    await startTeam();
    const inspector = await openInspector("Wright");
    const fields = within(inspector).getByLabelText("Field") as HTMLSelectElement;
    expect([...fields.options].map((o) => o.value)).toEqual(["model", "effort", "limits.tokens_per_day", "limits.sessions_at_once", "limits.delegation_depth"]);
    expect([...fields.options].map((o) => o.value)).toEqual([...WRIGHT_SET_FIELDS]);
    expect(within(inspector).getByTestId("team-wright-readonly").textContent).toBe("read-only · edit wright.json");
    expect(inspector.textContent).toContain("Tool policyread-only · edit wright.json");
    expect(within(inspector).queryByRole("button", { name: "Rename" })).toBeNull();
    expect(within(inspector).queryByRole("button", { name: /Turn (on|off)/ })).toBeNull();
    // No route reports Wright's effort or delegation depth: both say so rather than guess.
    expect(within(inspector).getAllByText("not reported", { selector: "dd" })).toHaveLength(2);
  });

  it("shows the effort Wright was set to this session, since no route reports it", async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /agents/:id/set", () => ok({ agent: WRIGHT, field: "effort", old: null, new: "high", changed: true }));
    const inspector = await openInspector("Wright");
    fireEvent.change(within(inspector).getByLabelText("Field"), { target: { value: "effort" } });
    fireEvent.change(within(inspector).getByLabelText("Value"), { target: { value: "high" } });
    fireEvent.click(within(inspector).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(within(inspector).getAllByText("not reported", { selector: "dd" })).toHaveLength(1));
    expect(within(inspector).getByText("high", { selector: "dd" })).toBeTruthy();
  });

  it("never requests GET /agents/wright, on open or after a roster event", async () => {
    const kernel = await startTeam();
    await openInspector("Wright");
    emit(kernel, "agent_settings_set");
    // The event's detail refetch is trailing (REFETCH_THROTTLE_MS): wait for the crew's second round.
    await waitFor(() => expect(requests(kernel, "GET /agents/:id").filter((r) => r.params?.id === "mason").length).toBeGreaterThanOrEqual(2));
    expect(requests(kernel, "GET /agents/:id").filter((r) => r.params?.id === "wright")).toEqual([]);
    expect(requests(kernel, "GET /agents/:id").length).toBeGreaterThan(0);
  });
});

// ---- AC6, AC7: New crew member ------------------------------------------------------------------

async function openNewForm(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "New crew member" }));
  return screen.findByTestId("team-new");
}

function type(form: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });
}

describe("New crew member", () => {
  it("starts empty, with no presets", async () => {
    await startTeam();
    const form = await openNewForm();
    for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")) {
      expect(field.value, field.getAttribute("id") ?? "").toBe("");
    }
    expect(within(form).getByTestId("team-tool-summary").textContent).toBe("None chosen: it may use no tool and no Bash command.");
    expect(within(form).getByTestId("team-pick-shape").textContent).toBe("Pick a shape…");
  });

  it("creates with POST /agents, once, with the charter; the new card appears only from the feed", async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /agents", () => ({ ok: true, status: 201, body: { agent: { id: "scout" }, files: [], files_error: null } }));
    const form = await openNewForm();
    type(form, "Id", "scout");
    type(form, "Name", "Scout");
    fireEvent.click(within(form).getByTestId("team-pick-shape"));
    const shapes = await screen.findByRole("dialog", { name: "Shape" });
    fireEvent.click(within(shapes).getByRole("radio", { name: /crab/ }));
    fireEvent.click(within(shapes).getByRole("button", { name: "Use shape" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    type(form, "Hue", "crew-sky");
    type(form, "Persona", "Curious and terse.");
    type(form, "Duties", "Watch the release notes\n\nSummarise them weekly");
    type(form, "Boundaries", "Never post publicly");
    type(form, "Model", "claude-haiku");
    type(form, "Permission mode", "plan");
    fireEvent.click(within(form).getByTestId("team-choose-tools"));
    const picker = await screen.findByRole("dialog", { name: "Tools Scout may use" });
    fireEvent.change(within(picker).getByLabelText("Allowed tools"), { target: { value: "Read, WebFetch" } });
    fireEvent.change(within(picker).getByLabelText("Bash prefixes"), { target: { value: "git log" } });
    fireEvent.click(within(picker).getByRole("checkbox", { name: "gh_pr_create" }));
    fireEvent.click(within(picker).getByRole("checkbox", { name: "git_push" }));
    fireEvent.click(within(picker).getByRole("button", { name: "Use these" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    type(form, "Tokens per day", "200000");
    type(form, "Workspaces", "/Users/o/code/notes");
    fireEvent.click(within(form).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.queryByTestId("team-new")).toBeNull());
    const creates = requests(kernel, "POST /agents");
    expect(creates).toHaveLength(1);
    expect(creates[0]).toEqual({
      method: "POST",
      path: "/agents",
      body: {
        id: "scout",
        display_name: "Scout",
        avatar: { shape: "crab", hue: "crew-sky" },
        persona: "Curious and terse.",
        duties: ["Watch the release notes", "Summarise them weekly"],
        boundaries: ["Never post publicly"],
        model: "claude-haiku",
        permission_mode: "plan",
        tool_policy: { allowedTools: ["Read", "WebFetch"], allowedBashPrefixes: ["git log"], never: ["git_push", "gh_pr_create"] },
        limits: { tokens_per_day: 200000 },
        workspaces: ["/Users/o/code/notes"],
      },
    });
    // No local insert: the card is absent until the feed's agent_created arrives.
    expect(cards().map((c) => c.getAttribute("data-agent-id"))).toEqual(["wright", "mason", "pim"]);
    expect(screen.getByTestId("team-notice").textContent).toContain("Scout was created");
    kernel.roster = [...kernel.roster, entry({ id: "scout", display_name: "Scout", avatar: { shape: "crab", hue: "crew-sky" } })];
    emit(kernel, "agent_created");
    await waitFor(() => expect(card("Scout")).toBeTruthy());
  });

  it("a double activation of Create sends one POST /agents", async () => {
    const kernel = await startTeam();
    let answer: (value: ApiResult<unknown>) => void = () => undefined;
    kernel.fake.route("POST /agents", () => new Promise<ApiResult<unknown>>((resolve) => (answer = resolve)));
    const form = await openNewForm();
    const create = within(form).getByRole("button", { name: "Create" });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(requests(kernel, "POST /agents")).toHaveLength(1));
    await act(async () => answer(refused(400, { error: "charter_invalid", field: "id", message: "id: bad" })));
    expect(requests(kernel, "POST /agents")).toHaveLength(1);
  });

  it("shows a 400 refusal's field and message, and keeps the form", async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /agents", () => refused(400, { error: "charter_invalid", field: "duties", message: "duties: Array must contain at least 1 element(s)" }));
    const form = await openNewForm();
    fireEvent.click(within(form).getByRole("button", { name: "Create" }));
    const error = await within(form).findByTestId("team-create-error");
    expect(error.textContent).toBe("duties · charter_invalid: duties: Array must contain at least 1 element(s)");
    expect(screen.getByTestId("team-new")).toBeTruthy();
    expect(requests(kernel, "POST /agents")).toHaveLength(1);
  });

  it("the never-category list equals the kernel's NEVER_CATEGORIES", async () => {
    const kernelNever = kernelFrozenList(kernelPolicy, "NEVER_CATEGORIES");
    expect([...NEVER_CATEGORIES]).toEqual(kernelNever);
    await startTeam();
    const form = await openNewForm();
    fireEvent.click(within(form).getByTestId("team-choose-tools"));
    const picker = await screen.findByRole("dialog");
    expect(within(picker).getAllByRole("checkbox").map((c) => (c as HTMLInputElement).value)).toEqual(kernelNever);
  });

  it("the shape picker offers exactly the kernel's AVATAR_SHAPES", async () => {
    const kernelShapes = kernelFrozenList(kernelAgentTypes, "AVATAR_SHAPES");
    expect([...AVATAR_SHAPES]).toEqual(kernelShapes);
    await startTeam();
    const form = await openNewForm();
    fireEvent.click(within(form).getByTestId("team-pick-shape"));
    const picker = await screen.findByRole("dialog", { name: "Shape" });
    expect(within(picker).getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual(kernelShapes);
    expect(within(picker).getAllByRole("radio").some((r) => (r as HTMLInputElement).checked)).toBe(false);
  });

  it("the hue picker offers exactly the kernel's AVATAR_HUES", async () => {
    const kernelHues = kernelFrozenList(kernelAgentTypes, "AVATAR_HUES");
    expect([...AVATAR_HUES]).toEqual(kernelHues);
    await startTeam();
    const form = await openNewForm();
    const hue = within(form).getByLabelText("Hue") as HTMLSelectElement;
    expect([...hue.options].map((o) => o.value)).toEqual(["", ...kernelHues]);
  });

  it("the permission-mode select offers exactly the keys of the kernel's charter PERMISSION_MODES", async () => {
    const kernelModes = kernelPermissionModes(kernelCharterFiles);
    expect([...PERMISSION_MODES]).toEqual(kernelModes);
    await startTeam();
    const form = await openNewForm();
    const modes = within(form).getByLabelText("Permission mode") as HTMLSelectElement;
    expect([...modes.options].map((o) => o.value)).toEqual(["", ...kernelModes]);
  });

  it('"Ask Wright to draft it" sends the request through POST /ask and opens Chat; nothing is created', async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /ask", () => ({ ok: true, status: 202, body: { message_id: 1, queue_id: 1 } }));
    const form = await openNewForm();
    fireEvent.click(within(form).getByRole("button", { name: "Ask Wright to draft it" }));
    expect((await within(form).findByTestId("team-ask-error")).textContent).toContain("Describe what it should do first");
    expect(requests(kernel, "POST /ask")).toEqual([]);
    type(form, "What should it do?", "Handle my social profiles");
    fireEvent.click(within(form).getByRole("button", { name: "Ask Wright to draft it" }));
    await waitFor(() => expect(window.location.hash).toBe("#/chat"));
    const asks = requests(kernel, "POST /ask");
    expect(asks).toHaveLength(1);
    expect((asks[0]?.body as { text: string }).text).toContain("Handle my social profiles");
    expect((asks[0]?.body as { agent?: string }).agent).toBeUndefined();
    expect(requests(kernel, "POST /agents")).toEqual([]);
  });
});

// ---- AC8: the ⌘K commands -------------------------------------------------------------------------

describe("the ⌘K commands", () => {
  it("registers owner team, ids team.*, for every Team action while mounted, and unregisters on unmount", async () => {
    const kernel = await startTeam();
    const ids = kernel.registry.list().map((c) => c.id);
    expect(kernel.registry.list().every((c) => c.owner === "team" && c.id.startsWith("team."))).toBe(true);
    expect(ids).toEqual([
      "team.new-crew-member",
      "team.set.wright",
      "team.thread.wright",
      "team.rename.mason",
      "team.set.mason",
      "team.on.mason",
      "team.off.mason",
      "team.thread.mason",
      "team.rename.pim",
      "team.set.pim",
      "team.on.pim",
      "team.off.pim",
      "team.thread.pim",
    ]);
    expect(kernel.registry.get("team.on.mason")?.enabled?.()).toBe(false);
    expect(kernel.registry.get("team.off.mason")?.enabled?.()).toBe(true);
    expect(kernel.registry.get("team.on.pim")?.enabled?.()).toBe(true);
    expect(kernel.registry.get("team.off.pim")?.enabled?.()).toBe(false);
    cleanup();
    expect(kernel.registry.list()).toEqual([]);
  });

  it("each command runs the same route as its button", async () => {
    const kernel = await startTeam();
    kernel.fake.route("POST /agents/:id/off", () => ok({ agent: {}, changed: true }));
    kernel.fake.route("POST /agents/:id/rename", () => ok({ agent: {}, changed: true }));
    await act(async () => {
      await kernel.registry.get("team.off.mason")?.run();
    });
    expect(requests(kernel, "POST /agents/:id/off")[0]).toMatchObject({ params: { id: "mason" } });
    expect(screen.getByTestId("team-notice").textContent).toBe("Mason: turned off.");

    act(() => void kernel.registry.get("team.rename.pim")?.run());
    const dialog = await screen.findByRole("dialog", { name: "Rename Pim" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Pimm" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Rename/ }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/rename")[0]).toMatchObject({ params: { id: "pim" }, body: { display_name: "Pimm" } }));

    act(() => void kernel.registry.get("team.set.wright")?.run());
    const inspector = await screen.findByTestId("team-inspector");
    await waitFor(() => expect(document.activeElement).toBe(within(inspector).getByLabelText("Field")));

    act(() => void kernel.registry.get("team.new-crew-member")?.run());
    expect(await screen.findByTestId("team-new")).toBeTruthy();

    act(() => void kernel.registry.get("team.thread.mason")?.run());
    expect(window.location.hash).toBe("#/chat/mason");
  });

  it("re-registers when a member's status changes, so enabled follows the kernel", async () => {
    const kernel = await startTeam();
    kernel.roster = kernel.roster.map((a) => (a.id === "pim" ? { ...a, status: "active" } : a));
    emit(kernel, "agent_status_changed");
    await waitFor(() => expect(kernel.registry.get("team.on.pim")?.enabled?.()).toBe(false));
    expect(kernel.registry.get("team.off.pim")?.enabled?.()).toBe(true);
    expect(kernel.registry.list().filter((c) => c.id === "team.on.pim")).toHaveLength(1);
  });
});

// ---- AC9: keyboard and focus ---------------------------------------------------------------------

describe("keyboard and focus", () => {
  it("opens a card with Enter or Space; Escape closes the inspector and focus returns to the card", async () => {
    await startTeam();
    const mason = card("Mason");
    expect(mason.tabIndex).toBe(0);
    mason.focus();
    fireEvent.keyDown(mason, { key: "Enter" });
    const inspector = await screen.findByTestId("team-inspector");
    expect(document.activeElement).toBe(within(inspector).getByRole("heading", { level: 2 }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("team-inspector")).toBeNull());
    expect(document.activeElement).toBe(card("Mason"));
    fireEvent.keyDown(card("Pim"), { key: " " });
    expect(await screen.findByTestId("team-inspector")).toBeTruthy();
  });

  it("every inspector and form control is a tab stop (none taken out of the order)", async () => {
    await startTeam();
    const inspector = await openInspector("Mason");
    await within(inspector).findByTestId("team-enforced");
    const controls = inspector.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea");
    expect(controls.length).toBeGreaterThan(4);
    for (const control of controls) expect(control.tabIndex, control.outerHTML.slice(0, 60)).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "New crew member" }));
    const form = await screen.findByTestId("team-new");
    const formControls = form.querySelectorAll<HTMLElement>("button, input, select, textarea");
    for (const control of formControls) {
      expect(control.tabIndex, control.outerHTML.slice(0, 60)).toBe(0);
      expect((control as HTMLButtonElement).disabled).toBe(false);
    }
    expect(within(form).getByRole("button", { name: "Create" }).getAttribute("type")).toBe("submit");
  });

  it("Escape in the tool picker closes the dialog, not the form; Escape in the form cancels it and focus returns to New crew member", async () => {
    await startTeam();
    const form = await openNewForm();
    expect(document.activeElement).toBe(within(form).getByRole("heading", { name: "New crew member" }));
    const choose = within(form).getByTestId("team-choose-tools");
    choose.focus();
    fireEvent.click(choose);
    const picker = await screen.findByRole("dialog");
    expect(picker.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("team-new")).toBeTruthy();
    expect(document.activeElement).toBe(choose);
    fireEvent.keyDown(choose, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("team-new")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New crew member" }));
  });

  it("team.css never removes the focus ring", () => {
    expect(/outline\s*:\s*(none|0)\b/.test(teamCss)).toBe(false);
  });
});

// ---- The screen module -------------------------------------------------------------------------------

describe("the screen module", () => {
  it("keeps the one export: id team, title Team, nav Team at order 2 with ⌘2", () => {
    expect(teamScreen.id).toBe("team");
    expect(teamScreen.title).toBe("Team");
    expect(teamScreen.nav).toEqual({ label: "Team", order: 2, shortcut: "⌘2" });
    expect(read("index.tsx").match(/^export /gm) ?? []).toHaveLength(1);
  });

  it("renders screen-team without a preload bridge (the shell in App.test.tsx)", () => {
    const Component = teamScreen.Component;
    render(<Component />);
    expect(screen.getByTestId("screen-team").textContent).toContain("no connection to the kernel");
  });

  it("with a bridge on window.api, the screen is the Team view", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /agents", () => ok({ agents: [WRIGHT] }));
    Object.defineProperty(window, "api", { value: fake.bridge, configurable: true });
    try {
      const Component = teamScreen.Component;
      render(<Component />);
      expect(await screen.findByTestId("team-card")).toBeTruthy();
      expect(screen.getByTestId("screen-team")).toBeTruthy();
    } finally {
      cleanup();
      Reflect.deleteProperty(window, "api");
    }
  });
});
