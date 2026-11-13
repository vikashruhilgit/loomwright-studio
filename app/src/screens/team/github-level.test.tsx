// @vitest-environment jsdom
// The crew member's GitHub level in Team (phase 8 item 20): the pure reader
// `githubLevel`, the three-level Connectors row (None, Read, Write) with its
// Write line, the one `changeGithubGrant` every button and ⌘K command calls
// (`github:none` / `github` / `github:write`, never `none`), a refusal that
// leaves the row as it was, and the level-based `enabled` of the ⌘K commands,
// against a scripted bridge (`fake-bridge.ts`). Wright keeps the roster-based
// Grant GitHub / Revoke row. The older Connectors tests are `connectors.test.tsx`.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDetailResponse, ApiRequest, ApiResult, EventFrame, RosterEntry, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge, Responder } from "../../store/fake-bridge";
import { WRITE_LINE, changeGithubGrant, githubLevel } from "./Connectors";
import { TeamView } from "./TeamView";

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
  tokens_today: { day: "2026-10-28", agents: [] },
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

const WRIGHT = entry({ id: "wright", display_name: "Wright", avatar: { shape: "whale", hue: "accent" }, created_by: null, model: "claude-opus", connectors: [] });

/** What each crew member's settings file holds under `connectors` (the detail), keyed by agent id. */
type Held = Record<string, unknown>;

function detail(agent: RosterEntry, held: Held): AgentDetailResponse {
  const connectors = held[agent.id];
  return {
    agent,
    settings: {
      file: `/Users/o/.loomwright-studio/config/agents/${agent.id}.json`,
      content: { model: agent.model, permission_mode: "default", tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] }, never: [], limits: {}, workspaces: [], ...(connectors === undefined ? {} : { connectors }) },
      error: null,
    },
    never: [],
    workspaces: [],
    memory: { dir: `/Users/o/.loomwright-studio/memory/${agent.id}`, files: [] },
    charter: { persona: "Plain and brief.", duties: ["Review each PR"], boundaries: ["Ask first"] },
  };
}

function refused(status: number, body: { readonly error: string } & Record<string, unknown>): ApiResult<unknown> {
  return { ok: false, status, body };
}

interface Kernel {
  readonly fake: FakeBridge;
  readonly registry: CommandRegistry;
  roster: RosterEntry[];
  /** The settings files' `connectors`, by agent id; change it and emit a roster event to refetch. */
  held: Held;
  /** A refused `GET /agents/:id` for these ids. */
  detailRefused: Set<string>;
}

let nextEventId = 1;

function feedEvent(kind: string): EventFrame {
  const id = nextEventId;
  nextEventId += 1;
  return { type: "event", id, at: new Date(id * 1000).toISOString(), kind, session_id: null, task_id: null, payload: {} };
}

interface Setup {
  readonly roster: RosterEntry[];
  readonly held: Held;
  readonly set?: Responder;
  readonly detailRefused?: readonly string[];
}

async function startTeam(setup: Setup): Promise<Kernel> {
  const fake = fakeBridge();
  const kernel: Kernel = { fake, registry: createCommandRegistry(), roster: setup.roster, held: setup.held, detailRefused: new Set(setup.detailRefused ?? []) };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /agents", () => ok({ agents: kernel.roster }));
  fake.route("GET /approvals", () => ok({ approvals: [] }));
  fake.route("GET /messages", () => ok({ messages: [] }));
  fake.route("GET /sessions", () => ok({ sessions: [] }));
  fake.route("GET /connectors", () => ok({ connectors: [] }));
  fake.route("GET /agents/:id", (req) => {
    const id = String(req.params?.id);
    const found = kernel.roster.find((a) => a.id === id);
    if (id === "wright") return refused(409, { error: "reserved", message: "Wright is not a crew member" });
    if (kernel.detailRefused.has(id)) return refused(500, { error: "internal", message: "the detail failed" });
    return found === undefined ? refused(404, { error: "not_found" }) : ok(detail(found, kernel.held));
  });
  if (setup.set !== undefined) fake.route("POST /agents/:id/set", setup.set);
  render(<TeamView api={fake.bridge} registry={kernel.registry} />);
  await screen.findAllByTestId("team-card");
  return kernel;
}

function emit(kernel: Kernel, kind: string): void {
  act(() => kernel.fake.emit(feedEvent(kind)));
}

async function openInspector(name: string): Promise<HTMLElement> {
  const card = screen.getAllByTestId("team-card").find((c) => within(c).queryByText(name, { selector: ".card-name" }) !== null);
  if (card === undefined) throw new Error(`no card named ${name}`);
  fireEvent.click(card);
  return screen.findByTestId("team-inspector");
}

function requests(kernel: Kernel, key: string): ApiRequest[] {
  return kernel.fake.requestsTo(key).map((r) => r.req);
}

const posted = (kernel: Kernel): string[] => requests(kernel, "POST /agents/:id/set").map((r) => (r.body as { value: string }).value);
const grantWords = (inspector: HTMLElement): string | null => within(inspector).getByTestId("team-connector-grant").textContent;
const levelButtons = (inspector: HTMLElement): string[] => within(inspector).queryAllByTestId(/^team-connector-level-/).map((b) => b.textContent ?? "");
const writeLine = (inspector: HTMLElement): HTMLElement | null => within(inspector).queryByTestId("team-connector-write-line");
const setOk = (field: string, oldValue: unknown, newValue: unknown): Responder => () => ok({ agent: {}, field, old: oldValue, new: newValue, changed: true });

const MASON_READ = entry({ id: "mason", display_name: "Mason", connectors: ["github"] });
const PIM_NONE = entry({ id: "pim", display_name: "Pim", avatar: { shape: "octopus", hue: "crew-berry" }, connectors: [] });

/** A crew whose Mason holds `mason` and Pim holds `pim` in their settings files (roster `connectors` follows, as the kernel reports it). */
function crew(mason: unknown, pim: unknown): Setup {
  const rostered = (agent: RosterEntry, held: unknown): RosterEntry => {
    const none = held === undefined || held === null || (Array.isArray(held) && held.length === 0);
    return { ...agent, connectors: none ? [] : ["github"] };
  };
  return { roster: [WRIGHT, rostered(MASON_READ, mason), rostered(PIM_NONE, pim)], held: { mason, pim } };
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

// ---- The level reader ---------------------------------------------------------------------------

describe("githubLevel", () => {
  const rostered = { connectors: ["github"] } as const;

  it("reads absent, null and [] as none; [github] and {github: read} as read; {github: write} as write", () => {
    for (const none of [{}, { connectors: null }, { connectors: [] }, { connectors: {} }]) expect(githubLevel(none, rostered), JSON.stringify(none)).toBe("none");
    expect(githubLevel({ connectors: ["github"] }, rostered)).toBe("read");
    expect(githubLevel({ connectors: { github: "read" } }, rostered)).toBe("read");
    expect(githubLevel({ connectors: { github: "write" } }, rostered)).toBe("write");
  });

  it("reads an object holding only MCP tools as none, and keeps the level beside them", () => {
    expect(githubLevel({ connectors: { jira: ["getJiraIssue"] } }, rostered)).toBe("none");
    expect(githubLevel({ connectors: { github: "write", jira: ["getJiraIssue"] } }, rostered)).toBe("write");
    expect(githubLevel({ connectors: { github: "read", clickup: ["get_task"] } }, rostered)).toBe("read");
  });

  it("reads content not read, or a shape the kernel does not write, as unknown (never none)", () => {
    expect(githubLevel(undefined, rostered)).toBeUndefined();
    expect(githubLevel(null, rostered)).toBeUndefined();
    expect(githubLevel("not an object", rostered)).toBeUndefined();
    expect(githubLevel([], rostered)).toBeUndefined();
    for (const odd of ["github", ["gitlab"], ["github", "github"], [1], { github: "admin" }, { github: true }, { github: ["write"] }, 7]) {
      expect(githubLevel({ connectors: odd }, rostered), JSON.stringify(odd)).toBeUndefined();
    }
  });

  it("checks the roster first: a roster connectors null or missing is unknown whatever the detail holds", () => {
    for (const unread of [{ connectors: null }, {}] as const) {
      expect(githubLevel({ connectors: { github: "write" } }, unread)).toBeUndefined();
      expect(githubLevel({ connectors: ["github"] }, unread)).toBeUndefined();
      expect(githubLevel({}, unread)).toBeUndefined();
    }
    expect(githubLevel({}, { connectors: [] })).toBe("none");
  });
});

// ---- changeGithubGrant ----------------------------------------------------------------------------

describe("changeGithubGrant", () => {
  const agent = { id: "mason", display_name: "Mason" };

  it("posts github:none, github and github:write for the three levels, in words, and never sends none", async () => {
    const fake = fakeBridge();
    fake.route("POST /agents/:id/set", () => ok({ agent: {}, field: "connectors", old: null, new: null, changed: true }));
    expect(await changeGithubGrant(fake.bridge, agent, "none")).toEqual({ ok: true, text: "GitHub revoked from Mason." });
    expect(await changeGithubGrant(fake.bridge, agent, "read")).toEqual({ ok: true, text: "GitHub granted to Mason." });
    expect(await changeGithubGrant(fake.bridge, agent, "write")).toEqual({ ok: true, text: "GitHub write granted to Mason." });
    const sent = fake.requestsTo("POST /agents/:id/set").map((r) => r.req);
    expect(sent.map((r) => r.body)).toEqual([
      { field: "connectors", value: "github:none" },
      { field: "connectors", value: "github" },
      { field: "connectors", value: "github:write" },
    ]);
    expect(sent.every((r) => r.params?.id === "mason")).toBe(true);
  });

  it("says so when nothing changed and shows a refusal as the kernel's text", async () => {
    const fake = fakeBridge();
    fake.route("POST /agents/:id/set", () => ok({ agent: {}, field: "connectors", old: null, new: null, changed: false }));
    expect((await changeGithubGrant(fake.bridge, agent, "none")).text).toBe("Mason already has no GitHub.");
    expect((await changeGithubGrant(fake.bridge, agent, "read")).text).toBe("Mason already has GitHub.");
    expect((await changeGithubGrant(fake.bridge, agent, "write")).text).toBe("Mason already has GitHub write.");
    fake.route("POST /agents/:id/set", () => refused(400, { error: "invalid_input", field: "connectors", message: "connectors must be github or none" }));
    expect(await changeGithubGrant(fake.bridge, agent, "write")).toEqual({ ok: false, text: "invalid_input: connectors must be github or none" });
  });
});

// ---- The three-level row --------------------------------------------------------------------------

describe("the crew member's GitHub row", () => {
  it.each([
    ["none", undefined, "None", ["Read", "Write"]],
    ["none", [], "None", ["Read", "Write"]],
    ["read", ["github"], "Read", ["None", "Write"]],
    ["read", { github: "read" }, "Read", ["None", "Write"]],
    ["write", { github: "write" }, "Write", ["None", "Read"]],
  ] as const)("a member at %s (%j) shows %s and offers the other two levels in place", async (_level, held, words, offered) => {
    await startTeam(crew(held, held));
    const mason = await openInspector("Mason");
    await waitFor(() => expect(grantWords(mason)).toBe(words));
    expect(levelButtons(mason)).toEqual(offered);
    for (const name of offered) expect(within(mason).getByRole("button", { name })).toBeTruthy();
    expect(within(mason).queryByRole("button", { name: words })).toBeNull();
  });

  it("says in one line what Write lets the playbooks do, at Write only", async () => {
    await startTeam(crew({ github: "write" }, ["github"]));
    const mason = await openInspector("Mason");
    await waitFor(() => expect(grantWords(mason)).toBe("Write"));
    expect(writeLine(mason)?.textContent).toBe(WRITE_LINE);
    expect(WRITE_LINE).toContain("push and comment on GitHub");
    expect(WRITE_LINE).toContain("approval gate");
    cleanup();

    await startTeam(crew({ github: "write" }, ["github"]));
    const pim = await openInspector("Pim");
    await waitFor(() => expect(grantWords(pim)).toBe("Read"));
    expect(writeLine(pim)).toBeNull();
    cleanup();

    await startTeam(crew(undefined, undefined));
    const none = await openInspector("Pim");
    await waitFor(() => expect(grantWords(none)).toBe("None"));
    expect(writeLine(none)).toBeNull();
  });

  it("choosing a level posts github:none, github or github:write for that member only, never none and never an MCP value", async () => {
    const kernel = await startTeam({ ...crew({ github: "read", jira: ["getJiraIssue"] }, undefined), set: setOk("connectors", null, null) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(grantWords(mason)).toBe("Read"));

    fireEvent.click(within(mason).getByRole("button", { name: "None" }));
    await waitFor(() => expect(posted(kernel)).toEqual(["github:none"]));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "github:none" } });
    expect((await within(mason).findByTestId("team-insp-notice")).textContent).toBe("GitHub revoked from Mason.");

    fireEvent.click(within(mason).getByRole("button", { name: "Write" }));
    await waitFor(() => expect(posted(kernel)).toEqual(["github:none", "github:write"]));
    expect((await within(mason).findByTestId("team-insp-notice")).textContent).toBe("GitHub write granted to Mason.");

    const pim = await openInspector("Pim");
    await waitFor(() => expect(grantWords(pim)).toBe("None"));
    fireEvent.click(within(pim).getByRole("button", { name: "Read" }));
    await waitFor(() => expect(posted(kernel)).toEqual(["github:none", "github:write", "github"]));
    expect(requests(kernel, "POST /agents/:id/set")[2]).toMatchObject({ params: { id: "pim" } });
    expect(posted(kernel)).not.toContain("none");
    expect(posted(kernel).some((value) => value.startsWith("jira") || value.startsWith("clickup"))).toBe(false);
  });

  it("changes only when the feed's agent_* event refetches: not from the answer, then None, Read and Write follow the file", async () => {
    const kernel = await startTeam({ ...crew(["github"], undefined), set: setOk("connectors", ["github"], { github: "write" }) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(grantWords(mason)).toBe("Read"));
    fireEvent.click(within(mason).getByRole("button", { name: "Write" }));
    await waitFor(() => expect(posted(kernel)).toEqual(["github:write"]));
    await within(mason).findByTestId("team-insp-notice");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(grantWords(mason)).toBe("Read");
    expect(writeLine(mason)).toBeNull();

    kernel.held = { ...kernel.held, mason: { github: "write" } };
    emit(kernel, "agent_settings_set");
    await waitFor(() => expect(grantWords(mason)).toBe("Write"));
    expect(writeLine(mason)).not.toBeNull();

    kernel.held = { ...kernel.held, mason: undefined };
    kernel.roster = kernel.roster.map((a) => (a.id === "mason" ? { ...a, connectors: [] } : a));
    emit(kernel, "agent_settings_set");
    await waitFor(() => expect(grantWords(mason)).toBe("None"));
    expect(levelButtons(mason)).toEqual(["Read", "Write"]);
    expect(writeLine(mason)).toBeNull();
  });

  it("keeps keyboard focus in the level group when the refetch swaps the chosen button out", async () => {
    const kernel = await startTeam({ ...crew({ github: "read" }, ["github"]), set: setOk("connectors", null, null) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(grantWords(mason)).toBe("Read"));
    const write = within(mason).getByRole("button", { name: "Write" });
    write.focus();
    expect(document.activeElement).toBe(write);
    fireEvent.click(write);
    await waitFor(() => expect(posted(kernel)).toEqual(["github:write"]));
    kernel.held = { ...kernel.held, mason: { github: "write" } };
    emit(kernel, "agent_settings_set");
    await waitFor(() => expect(grantWords(mason)).toBe("Write"));
    expect(levelButtons(mason)).toEqual(["None", "Read"]);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(within(mason).getByTestId("team-connector-levels"));
  });

  it("a refusal shows the kernel's message in words and the row keeps the old level", async () => {
    const kernel = await startTeam({ ...crew(["github"], undefined), set: () => refused(409, { error: "settings_changed", message: "<b>the file changed</b> while it was being set" }) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(grantWords(mason)).toBe("Read"));
    fireEvent.click(within(mason).getByRole("button", { name: "Write" }));
    const notice = await within(mason).findByTestId("team-insp-notice");
    await waitFor(() => expect(notice.textContent).toBe("settings_changed: <b>the file changed</b> while it was being set"));
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.querySelector("b")).toBeNull();
    // Not even briefly edited, and still unchanged past the refetch throttle.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(grantWords(mason)).toBe("Read");
    expect(levelButtons(mason)).toEqual(["None", "Write"]);
    expect(writeLine(mason)).toBeNull();
    expect(posted(kernel)).toEqual(["github:write"]);
  });

  it("a roster connectors null reads grant unknown with no level control, even with a detail holding a grant", async () => {
    const roster = [WRIGHT, { ...MASON_READ, connectors: null }, PIM_NONE];
    const kernel = await startTeam({ roster, held: { mason: { github: "write" }, pim: [] } });
    const mason = await openInspector("Mason");
    // The detail is in (its Role section is drawn), and still the grant is unknown.
    await waitFor(() => expect(within(mason).getByTestId("team-insp-role")).toBeTruthy());
    expect(grantWords(mason)).toBe("grant unknown");
    expect(levelButtons(mason)).toEqual([]);
    expect(writeLine(mason)).toBeNull();
    expect(within(mason).queryByRole("group", { name: "Change the GitHub grant" })).toBeNull();
  });

  it("a detail that is loading, refused, or in a shape the kernel does not write reads grant unknown with no level control", async () => {
    const kernel = await startTeam({ ...crew({ github: "admin" }, ["github"]), detailRefused: ["pim"] });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(within(mason).getByTestId("team-insp-role")).toBeTruthy());
    expect(requests(kernel, "GET /agents/:id")).toHaveLength(2);
    expect(grantWords(mason)).toBe("grant unknown");
    expect(levelButtons(mason)).toEqual([]);
    const pim = await openInspector("Pim");
    await waitFor(() => expect(within(pim).getByTestId("team-detail-error")).toBeTruthy());
    expect(grantWords(pim)).toBe("grant unknown");
    expect(levelButtons(pim)).toEqual([]);
  });

  it("Wright keeps the roster row: granted words, Grant GitHub (github) or Revoke (github:none), no Write option", async () => {
    const kernel = await startTeam({ ...crew(undefined, undefined), set: setOk("connectors", null, null) });
    const wright = await openInspector("Wright");
    expect(grantWords(wright)).toBe("not granted");
    expect(levelButtons(wright)).toEqual([]);
    expect(within(wright).queryByRole("button", { name: "Write" })).toBeNull();
    fireEvent.click(within(wright).getByRole("button", { name: "Grant GitHub" }));
    await waitFor(() => expect(posted(kernel)).toEqual(["github"]));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "wright" } });
    cleanup();

    const granted = await startTeam({ ...crew(undefined, undefined), roster: [{ ...WRIGHT, connectors: ["github"] }, MASON_READ, PIM_NONE], held: {}, set: setOk("connectors", ["github"], null) });
    const again = await openInspector("Wright");
    expect(grantWords(again)).toBe("granted");
    expect(levelButtons(again)).toEqual([]);
    expect(writeLine(again)).toBeNull();
    fireEvent.click(within(again).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(posted(granted)).toEqual(["github:none"]));
    expect(requests(granted, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "wright" }, body: { field: "connectors", value: "github:none" } });
    expect(requests(granted, "GET /agents/:id").filter((r) => r.params?.id === "wright")).toEqual([]);
  });
});

// ---- The ⌘K commands -------------------------------------------------------------------------------

describe("the GitHub level commands", () => {
  const enabled = (kernel: Kernel, id: string): boolean | undefined => kernel.registry.get(id)?.enabled?.();
  /** [grant (read), revoke (none), write] enabled, for `id`. */
  const states = (kernel: Kernel, id: string): (boolean | undefined)[] => [`team.grant-github.${id}`, `team.revoke-github.${id}`, `team.github-write.${id}`].map((c) => enabled(kernel, c));

  it.each([
    ["none", undefined, [true, false, true]],
    ["read", ["github"], [false, true, true]],
    ["write", { github: "write" }, [true, true, false]],
  ] as const)("at %s a crew member's commands are enabled as [grant, revoke, write] = %j", async (_level, held, expected) => {
    const kernel = await startTeam(crew(held, held));
    await waitFor(() => expect(states(kernel, "mason")).toEqual(expected));
    expect(states(kernel, "pim")).toEqual(expected);
  });

  it("registers Grant GitHub write for every crew member and not for Wright, titled for the member, after its Revoke", async () => {
    const kernel = await startTeam(crew(["github"], undefined));
    const ids = kernel.registry.list().map((c) => c.id);
    expect(ids).toContain("team.github-write.mason");
    expect(ids).toContain("team.github-write.pim");
    expect(ids).not.toContain("team.github-write.wright");
    expect(ids.indexOf("team.github-write.mason")).toBe(ids.indexOf("team.revoke-github.mason") + 1);
    expect(kernel.registry.get("team.github-write.mason")?.title).toBe("Grant GitHub write to Mason");
    expect(kernel.registry.get("team.github-write.mason")?.owner).toBe("team");
    // Wright keeps its two, titled as before.
    expect(kernel.registry.get("team.grant-github.wright")?.title).toBe("Grant GitHub to Wright");
    expect(kernel.registry.get("team.revoke-github.wright")?.title).toBe("Revoke GitHub from Wright");
  });

  it("are disabled while the level is unknown: the roster's connectors null, a detail refused or still loading, or an unwritten shape", async () => {
    const roster = [WRIGHT, { ...MASON_READ, connectors: null }, PIM_NONE];
    const kernel = await startTeam({ roster, held: { mason: { github: "write" }, pim: { github: "admin" } } });
    // Loading: the first commands are registered before any detail answered.
    expect(states(kernel, "mason")).toEqual([false, false, false]);
    expect(states(kernel, "pim")).toEqual([false, false, false]);
    await waitFor(() => expect(requests(kernel, "GET /agents/:id")).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(states(kernel, "mason")).toEqual([false, false, false]);
    expect(states(kernel, "pim")).toEqual([false, false, false]);
    cleanup();

    const refusedDetail = await startTeam({ ...crew(["github"], undefined), detailRefused: ["mason", "pim"] });
    await waitFor(() => expect(requests(refusedDetail, "GET /agents/:id")).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(states(refusedDetail, "mason")).toEqual([false, false, false]);
    expect(states(refusedDetail, "pim")).toEqual([false, false, false]);
  });

  it("Wright's two commands keep the roster-based enabled and there is no write command to enable", async () => {
    const kernel = await startTeam(crew(undefined, undefined));
    expect(enabled(kernel, "team.grant-github.wright")).toBe(true);
    expect(enabled(kernel, "team.revoke-github.wright")).toBe(false);
    cleanup();
    const granted = await startTeam({ roster: [{ ...WRIGHT, connectors: ["github"] }, MASON_READ, PIM_NONE], held: {} });
    expect(enabled(granted, "team.grant-github.wright")).toBe(false);
    expect(enabled(granted, "team.revoke-github.wright")).toBe(true);
    cleanup();
    const unread = await startTeam({ roster: [{ ...WRIGHT, connectors: null }, MASON_READ, PIM_NONE], held: {} });
    expect(enabled(unread, "team.grant-github.wright")).toBe(false);
    expect(enabled(unread, "team.revoke-github.wright")).toBe(false);
  });

  it("each runs the same changeGithubGrant as the row: github, github:none and github:write, the answer is the screen's notice", async () => {
    const kernel = await startTeam({ ...crew(["github"], undefined), set: setOk("connectors", null, null) });
    await waitFor(() => expect(enabled(kernel, "team.github-write.mason")).toBe(true));
    await act(async () => {
      await kernel.registry.get("team.github-write.mason")?.run();
    });
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "github:write" } });
    expect(screen.getByTestId("team-notice").textContent).toBe("GitHub write granted to Mason.");

    await act(async () => {
      await kernel.registry.get("team.revoke-github.mason")?.run();
    });
    expect(posted(kernel)).toEqual(["github:write", "github:none"]);
    expect(screen.getByTestId("team-notice").textContent).toBe("GitHub revoked from Mason.");

    await act(async () => {
      await kernel.registry.get("team.grant-github.pim")?.run();
    });
    expect(posted(kernel)).toEqual(["github:write", "github:none", "github"]);
    expect(posted(kernel)).not.toContain("none");
  });

  it("a refusal is the screen's error notice, named for the member", async () => {
    const kernel = await startTeam({ ...crew(undefined, undefined), set: () => refused(409, { error: "settings_changed", message: "the file changed" }) });
    await act(async () => {
      await kernel.registry.get("team.github-write.pim")?.run();
    });
    const notice = screen.getByTestId("team-notice");
    expect(notice.textContent).toBe("Pim: settings_changed: the file changed");
    expect(notice.getAttribute("role")).toBe("alert");
  });

  it("re-register when the level changes in the detail, so enabled follows it", async () => {
    const kernel = await startTeam(crew(["github"], undefined));
    await waitFor(() => expect(states(kernel, "mason")).toEqual([false, true, true]));
    // The roster still says github is held; only the level in the file moves to write.
    kernel.held = { ...kernel.held, mason: { github: "write" } };
    emit(kernel, "agent_settings_set");
    await waitFor(() => expect(states(kernel, "mason")).toEqual([true, true, false]));
    expect(kernel.registry.list().filter((c) => c.id === "team.github-write.mason")).toHaveLength(1);
  });
});
