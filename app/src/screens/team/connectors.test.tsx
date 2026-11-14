// @vitest-environment jsdom
// The inspector's Connectors row and its ⌘K commands (phase 6 item 08, AC8 and
// AC9) against a scripted bridge (`fake-bridge.ts`): the GitHub grant (Wright's
// from the roster's `connectors`, a crew member's level from its detail), the
// connector's state from `GET /connectors` (refetched on a `connector_status`
// event), the level buttons / Grant GitHub / Revoke through `POST /agents/:id/set
// {field: "connectors", value}`, and the row changing only when the feed's
// `agent_*` event refetches. The level reader, the Write line and the write
// command are in `github-level.test.tsx` (phase 8 item 20).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDetailResponse, ApiRequest, ApiResult, Connector, ConnectorStatus, EventFrame, McpCapability, McpConnection, RosterEntry, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge, Responder } from "../../store/fake-bridge";
import { CapabilityList, capabilityState, changeCapabilityGrant, changeMcpGrant, mcpGrantRows, otherToolsSummary } from "./Connectors";
import { type ConnectorsState, connectorStateText, githubGranted, mcpToolsHeld } from "./model";
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
const MASON = entry({ id: "mason", display_name: "Mason", connectors: ["github"] });
const PIM = entry({ id: "pim", display_name: "Pim", avatar: { shape: "octopus", hue: "crew-berry" }, connectors: [] });

function detail(agent: RosterEntry, extra: Record<string, unknown> = {}): AgentDetailResponse {
  return {
    agent,
    settings: {
      file: `/Users/o/.loomwright-studio/config/agents/${agent.id}.json`,
      // A crew member's level in its file follows the roster's grant (Mason Read, Pim None), as the kernel writes it.
      content: {
        model: agent.model,
        permission_mode: "default",
        tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] },
        never: [],
        limits: {},
        workspaces: [],
        ...(Array.isArray(agent.connectors) ? { connectors: agent.connectors } : {}),
        ...extra,
      },
      error: null,
    },
    never: [],
    workspaces: [],
    memory: { dir: `/Users/o/.loomwright-studio/memory/${agent.id}`, files: [] },
    charter: { persona: "Plain and brief.", duties: ["Review each PR"], boundaries: ["Ask first"] },
  };
}

function connector(status: ConnectorStatus): Connector {
  return {
    id: 1,
    kind: "github",
    status,
    account_login: "octo-owner",
    permissions: { pull_requests: "read" },
    permissions_source: "reported",
    permissions_declared_at: null,
    reachable_repos: ["octo-owner/site"],
    expires_at: null,
    verified_at: "2026-10-28T09:00:00.000Z",
    created_at: "2026-10-28T09:00:00.000Z",
    updated_at: "2026-10-28T09:00:00.000Z",
  };
}

function refused(status: number, body: { readonly error: string } & Record<string, unknown>): ApiResult<unknown> {
  return { ok: false, status, body };
}

interface Kernel {
  readonly fake: FakeBridge;
  readonly registry: CommandRegistry;
  roster: RosterEntry[];
  /** What `GET /connectors` answers; a function answers a refusal. */
  connectors: ApiResult<unknown>;
}

let nextEventId = 1;

function feedEvent(kind: string): EventFrame {
  const id = nextEventId;
  nextEventId += 1;
  return { type: "event", id, at: new Date(id * 1000).toISOString(), kind, session_id: null, task_id: null, payload: {} };
}

interface Setup {
  readonly roster?: RosterEntry[];
  readonly connectors?: ApiResult<unknown>;
  readonly set?: Responder;
  /** Keys merged into every crew member's settings `content` (e.g. the object-form `connectors`). */
  readonly content?: Record<string, unknown>;
}

async function startTeam(setup: Setup = {}): Promise<Kernel> {
  const fake = fakeBridge();
  const kernel: Kernel = {
    fake,
    registry: createCommandRegistry(),
    roster: setup.roster ?? [WRIGHT, MASON, PIM],
    connectors: setup.connectors ?? ok({ connectors: [connector("connected")] }),
  };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /agents", () => ok({ agents: kernel.roster }));
  fake.route("GET /approvals", () => ok({ approvals: [] }));
  fake.route("GET /messages", () => ok({ messages: [] }));
  fake.route("GET /sessions", () => ok({ sessions: [] }));
  fake.route("GET /connectors", () => kernel.connectors);
  fake.route("GET /agents/:id", (req) => {
    const id = String(req.params?.id);
    const found = kernel.roster.find((a) => a.id === id);
    if (id === "wright") return refused(409, { error: "reserved", message: "Wright is not a crew member" });
    return found === undefined ? refused(404, { error: "not_found" }) : ok(detail(found, setup.content));
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

const grantWords = (inspector: HTMLElement): string | null => within(inspector).getByTestId("team-connector-grant").textContent;
const stateWords = (inspector: HTMLElement): string | null => within(inspector).getByTestId("team-connector-state").textContent;

const setOk = (field: string, oldValue: unknown, newValue: unknown): Responder => () => ok({ agent: {}, field, old: oldValue, new: newValue, changed: true });

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

// ---- The pure helpers ---------------------------------------------------------------------------

describe("githubGranted and connectorStateText", () => {
  it("reads a grant as true, false, or unknown (never as no grant)", () => {
    expect(githubGranted({ connectors: ["github"] })).toBe(true);
    expect(githubGranted({ connectors: [] })).toBe(false);
    expect(githubGranted({ connectors: null })).toBeUndefined();
    expect(githubGranted({})).toBeUndefined();
  });

  it("words the connector: connected and expiring from the row, not connected for no row or a dead one, state unknown for a failed read", () => {
    const ofRows = (...statuses: ConnectorStatus[]): ConnectorsState => ({ status: "ok", connectors: { connectors: statuses.map(connector) } });
    expect(connectorStateText(ofRows("connected"))).toBe("connected");
    expect(connectorStateText(ofRows("expiring"))).toBe("expiring");
    expect(connectorStateText(ofRows())).toBe("not connected");
    for (const dead of ["rejected", "disconnected", "expired"] as const) expect(connectorStateText(ofRows(dead))).toBe("not connected");
    expect(connectorStateText({ status: "error" })).toBe("state unknown");
    expect(connectorStateText({ status: "loading" })).toBe("checking…");
  });
});

// ---- AC8: the Connectors row ---------------------------------------------------------------------

describe("the Connectors row", () => {
  it("shows GitHub, granted, and the connector's state read from GET /connectors, for a crew member and for Wright", async () => {
    const kernel = await startTeam({ roster: [{ ...WRIGHT, connectors: ["github"] }, MASON, PIM] });
    const mason = await openInspector("Mason");
    const row = within(mason).getByTestId("team-insp-connectors");
    expect(within(row).getByRole("heading", { level: 3 }).textContent).toContain("Connectors");
    expect(within(row).getByText("GitHub")).toBeTruthy();
    // A crew member's level is read from its detail: Mason's file holds ["github"], which is Read.
    await waitFor(() => expect(grantWords(mason)).toBe("Read"));
    await waitFor(() => expect(stateWords(mason)).toBe("connected"));
    expect(requests(kernel, "GET /connectors")).toHaveLength(1);

    const wright = await openInspector("Wright");
    expect(grantWords(wright)).toBe("granted");
    expect(stateWords(wright)).toBe("connected");
    // Wright's grant comes from the roster: its detail is never requested.
    expect(requests(kernel, "GET /agents/:id").filter((r) => r.params?.id === "wright")).toEqual([]);
  });

  it.each([
    ["expiring", "expiring"],
    ["rejected", "not connected"],
    ["disconnected", "not connected"],
    ["expired", "not connected"],
  ] as const)("a %s row reads %s", async (status, words) => {
    await startTeam({ connectors: ok({ connectors: [connector(status)] }) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(stateWords(mason)).toBe(words));
  });

  it("no github row reads not connected, and a failed read reads state unknown (not not connected)", async () => {
    await startTeam({ connectors: ok({ connectors: [] }) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(stateWords(mason)).toBe("not connected"));
    cleanup();

    await startTeam({ connectors: refused(500, { error: "internal" }) });
    const again = await openInspector("Mason");
    await waitFor(() => expect(stateWords(again)).toBe("state unknown"));
    // The grant itself is still the file's level.
    await waitFor(() => expect(grantWords(again)).toBe("Read"));
  });

  it("refetches GET /connectors on a connector_status event, and on no other", async () => {
    const kernel = await startTeam();
    const mason = await openInspector("Mason");
    await waitFor(() => expect(stateWords(mason)).toBe("connected"));
    expect(requests(kernel, "GET /connectors")).toHaveLength(1);

    kernel.connectors = ok({ connectors: [connector("expired")] });
    emit(kernel, "session_started");
    emit(kernel, "agent_updated");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(requests(kernel, "GET /connectors")).toHaveLength(1);
    expect(stateWords(mason)).toBe("connected");

    emit(kernel, "connector_status");
    await waitFor(() => expect(stateWords(mason)).toBe("not connected"));
    expect(requests(kernel, "GET /connectors")).toHaveLength(2);
  });

  it("an agent whose connectors the roster did not report reads grant unknown, with no level control, Grant or Revoke", async () => {
    await startTeam({ roster: [WRIGHT, { ...MASON, connectors: null }, entry({ id: "pim", display_name: "Pim", status: "off" })] });
    const mason = await openInspector("Mason");
    expect(grantWords(mason)).toBe("grant unknown");
    expect(within(mason).queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(within(mason).queryByRole("button", { name: "Grant GitHub" })).toBeNull();
    // Mason's detail holds no connectors, which would read None: the roster's unknown comes first.
    await waitFor(() => expect(within(mason).getByTestId("team-insp-role")).toBeTruthy());
    expect(grantWords(mason)).toBe("grant unknown");
    expect(within(mason).queryByTestId("team-connector-levels")).toBeNull();
    for (const name of ["None", "Read", "Write"]) expect(within(mason).queryByRole("button", { name })).toBeNull();
    const pim = await openInspector("Pim");
    expect(grantWords(pim)).toBe("grant unknown");
  });
});

// ---- AC9: Grant and Revoke -----------------------------------------------------------------------

describe("the level buttons, Grant GitHub and Revoke", () => {
  it("choosing None posts github:none (not none), and the row changes only when the feed's agent_* event refetches", async () => {
    const kernel = await startTeam({ set: setOk("connectors", ["github"], null) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(grantWords(mason)).toBe("Read"));
    expect(within(mason).queryByRole("button", { name: "Grant GitHub" })).toBeNull();
    expect(within(mason).queryByRole("button", { name: "Revoke" })).toBeNull();
    fireEvent.click(within(mason).getByRole("button", { name: "None" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "github:none" } });
    expect((await within(mason).findByTestId("team-insp-notice")).textContent).toBe("GitHub revoked from Mason.");

    // Not a local edit: past the store's refetch throttle, the row still says Read.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(grantWords(mason)).toBe("Read");
    expect(within(mason).getByRole("button", { name: "None" })).toBeTruthy();

    kernel.roster = kernel.roster.map((a) => (a.id === "mason" ? { ...a, connectors: [] } : a));
    emit(kernel, "agent_settings_set");
    await waitFor(() => expect(grantWords(mason)).toBe("None"));
    expect(within(mason).getByRole("button", { name: "Read" })).toBeTruthy();
    expect(within(mason).queryByRole("button", { name: "None" })).toBeNull();
  });

  it("choosing Read posts github for a member at None, and Wright's Grant GitHub goes to /agents/wright/set", async () => {
    const kernel = await startTeam({ set: setOk("connectors", null, ["github"]) });
    const pim = await openInspector("Pim");
    fireEvent.click(await within(pim).findByRole("button", { name: "Read" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "pim" }, body: { field: "connectors", value: "github" } });
    expect((await within(pim).findByTestId("team-insp-notice")).textContent).toBe("GitHub granted to Pim.");
    expect(grantWords(pim)).toBe("None");

    const wright = await openInspector("Wright");
    fireEvent.click(within(wright).getByRole("button", { name: "Grant GitHub" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(2));
    expect(requests(kernel, "POST /agents/:id/set")[1]).toMatchObject({ params: { id: "wright" }, body: { field: "connectors", value: "github" } });
  });

  it("Wright's Revoke posts github:none, so a GitHub revoke never drops the MCP grant Team cannot read", async () => {
    const kernel = await startTeam({ roster: [{ ...WRIGHT, connectors: ["github"] }, MASON, PIM], set: setOk("connectors", ["github"], null) });
    const wright = await openInspector("Wright");
    fireEvent.click(within(wright).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "wright" }, body: { field: "connectors", value: "github:none" } });
    expect((await within(wright).findByTestId("team-insp-notice")).textContent).toBe("GitHub revoked from Wright.");
  });

  it("says so when the grant was already in place, and shows the kernel's refusal as text without changing the row", async () => {
    const kernel = await startTeam({ set: () => ok({ agent: {}, field: "connectors", old: ["github"], new: ["github"], changed: false }) });
    const pim = await openInspector("Pim");
    fireEvent.click(await within(pim).findByRole("button", { name: "Read" }));
    expect((await within(pim).findByTestId("team-insp-notice")).textContent).toBe("Pim already has GitHub.");

    kernel.fake.route("POST /agents/:id/set", () => refused(400, { error: "invalid_input", field: "connectors", message: "connectors must be github or none" }));
    fireEvent.click(within(pim).getByRole("button", { name: "Read" }));
    await waitFor(() => expect(within(pim).getByTestId("team-insp-notice").textContent).toBe("invalid_input: connectors must be github or none"));
    expect(grantWords(pim)).toBe("None");
  });
});

// ---- AC9: the ⌘K commands --------------------------------------------------------------------------

describe("Grant GitHub and Revoke GitHub commands", () => {
  it("are registered for every agent, Wright included, titled for the agent, and enabled only in their matching state", async () => {
    const kernel = await startTeam();
    const ids = kernel.registry.list().map((c) => c.id);
    for (const id of ["wright", "mason", "pim"]) {
      expect(ids).toContain(`team.grant-github.${id}`);
      expect(ids).toContain(`team.revoke-github.${id}`);
    }
    expect(kernel.registry.get("team.revoke-github.mason")?.title).toBe("Revoke GitHub from Mason");
    expect(kernel.registry.get("team.grant-github.pim")?.title).toBe("Grant GitHub to Pim");
    // Mason is at Read (once its detail is read): Revoke is enabled, Grant (read) is not. Pim is at None: only Grant is.
    await waitFor(() => expect(kernel.registry.get("team.revoke-github.mason")?.enabled?.()).toBe(true));
    expect(kernel.registry.get("team.grant-github.mason")?.enabled?.()).toBe(false);
    await waitFor(() => expect(kernel.registry.get("team.grant-github.pim")?.enabled?.()).toBe(true));
    expect(kernel.registry.get("team.revoke-github.pim")?.enabled?.()).toBe(false);
    // Wright holds none by the roster: only Grant is enabled.
    expect(kernel.registry.get("team.grant-github.wright")?.enabled?.()).toBe(true);
    expect(kernel.registry.get("team.revoke-github.wright")?.enabled?.()).toBe(false);
  });

  it("are enabled in neither state while the roster did not report the agent's connectors", async () => {
    const kernel = await startTeam({ roster: [WRIGHT, { ...MASON, connectors: null }, entry({ id: "pim", display_name: "Pim" })] });
    await waitFor(() => expect(requests(kernel, "GET /agents/:id")).toHaveLength(2));
    for (const id of ["mason", "pim"]) {
      expect(kernel.registry.get(`team.grant-github.${id}`)?.enabled?.()).toBe(false);
      expect(kernel.registry.get(`team.revoke-github.${id}`)?.enabled?.()).toBe(false);
    }
  });

  it("run the same route as the buttons: Revoke posts github:none, Grant posts github, and the answer is the screen's notice", async () => {
    const kernel = await startTeam({ set: setOk("connectors", ["github"], null) });
    await act(async () => {
      await kernel.registry.get("team.revoke-github.mason")?.run();
    });
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "github:none" } });
    expect(screen.getByTestId("team-notice").textContent).toBe("GitHub revoked from Mason.");

    kernel.fake.route("POST /agents/:id/set", setOk("connectors", null, ["github"]));
    await act(async () => {
      await kernel.registry.get("team.grant-github.wright")?.run();
    });
    expect(requests(kernel, "POST /agents/:id/set")[1]).toMatchObject({ params: { id: "wright" }, body: { field: "connectors", value: "github" } });
    expect(screen.getByTestId("team-notice").textContent).toBe("GitHub granted to Wright.");
  });

  it("a refusal is the screen's error notice, named for the agent", async () => {
    const kernel = await startTeam({ set: () => refused(409, { error: "concurrent_edit", message: "the file changed while it was being written" }) });
    await act(async () => {
      await kernel.registry.get("team.grant-github.pim")?.run();
    });
    const notice = screen.getByTestId("team-notice");
    expect(notice.textContent).toBe("Pim: concurrent_edit: the file changed while it was being written");
    expect(notice.getAttribute("role")).toBe("alert");
  });

  it("re-register when an agent's connectors change, so enabled follows the roster and the file's level", async () => {
    const kernel = await startTeam();
    await waitFor(() => expect(kernel.registry.get("team.grant-github.pim")?.enabled?.()).toBe(true));
    kernel.roster = kernel.roster.map((a) => (a.id === "pim" ? { ...a, connectors: ["github"] as const } : a));
    emit(kernel, "agent_settings_set");
    await waitFor(() => expect(kernel.registry.get("team.grant-github.pim")?.enabled?.()).toBe(false));
    expect(kernel.registry.get("team.revoke-github.pim")?.enabled?.()).toBe(true);
    expect(kernel.registry.list().filter((c) => c.id === "team.revoke-github.pim")).toHaveLength(1);
  });
});

// ---- Phase 8 (S4): the per-tool MCP grant ------------------------------------------------------------

function mcpRow(kind: "jira" | "clickup", grantedTools: readonly string[], status: ConnectorStatus = "connected"): McpConnection {
  return { kind, server_url: `https://${kind}.example.test/mcp`, status, granted_tools: grantedTools, token_expiry: null };
}

const JIRA_TOOLS = ["getJiraIssue", "searchJiraIssuesUsingJql", "createJiraIssue"] as const;
const mcpTools = (inspector: HTMLElement, kind: string): HTMLElement => within(inspector).getByTestId(`team-connector-mcp-${kind}-tools`);
const mcpWords = (inspector: HTMLElement, kind: string): string | null => within(inspector).getByTestId(`team-connector-mcp-${kind}-grant`).textContent;
const ticked = (inspector: HTMLElement, kind: string): string[] =>
  within(mcpTools(inspector, kind))
    .getAllByRole("checkbox")
    .filter((box) => (box as HTMLInputElement).checked)
    .map((box) => box.closest("label")?.textContent?.trim() ?? "");

describe("mcpToolsHeld and mcpGrantRows", () => {
  it("reads a kind's tools from the object form, none from the array form or a missing key, and unknown from a shape the kernel does not write", () => {
    expect(mcpToolsHeld({ connectors: { github: "read", jira: ["a", "b"] } }, "jira")).toEqual(["a", "b"]);
    expect(mcpToolsHeld({ connectors: { jira: ["a"] } }, "clickup")).toEqual([]);
    expect(mcpToolsHeld({ connectors: ["github"] }, "jira")).toEqual([]);
    expect(mcpToolsHeld({}, "jira")).toEqual([]);
    expect(mcpToolsHeld({ connectors: null }, "jira")).toEqual([]);
    expect(mcpToolsHeld(undefined, "jira")).toBeUndefined();
    expect(mcpToolsHeld("not an object", "jira")).toBeUndefined();
    expect(mcpToolsHeld({ connectors: "jira" }, "jira")).toBeUndefined();
    expect(mcpToolsHeld({ connectors: { jira: "a" } }, "jira")).toBeUndefined();
    expect(mcpToolsHeld({ connectors: { jira: ["a", 3, null] } }, "jira")).toEqual(["a"]);
  });

  it("lists one row per connected or expiring MCP kind, none for a dead row, a failed read or a response without mcp_connections", () => {
    const content = { connectors: { jira: ["getJiraIssue", "retiredTool"] } };
    const state = (mcp: McpConnection[] | undefined): ConnectorsState => ({ status: "ok", connectors: mcp === undefined ? { connectors: [] } : { connectors: [], mcp_connections: mcp } });
    const rows = mcpGrantRows(state([mcpRow("jira", JIRA_TOOLS), mcpRow("clickup", ["get_task"], "expiring")]), content);
    expect(rows.map((r) => r.kind)).toEqual(["jira", "clickup"]);
    // A held tool the connection no longer lists is still shown (so it can be taken away), after the listed ones.
    expect(rows[0]?.tools).toEqual([...JIRA_TOOLS, "retiredTool"]);
    expect(rows[0]?.held).toEqual(["getJiraIssue", "retiredTool"]);
    expect(rows[1]?.held).toEqual([]);
    expect(mcpGrantRows(state([mcpRow("jira", JIRA_TOOLS, "expired"), mcpRow("clickup", ["t"], "disconnected")]), content)).toEqual([]);
    expect(mcpGrantRows(state(undefined), content)).toEqual([]);
    expect(mcpGrantRows({ status: "error" }, content)).toEqual([]);
    expect(mcpGrantRows({ status: "loading" }, content)).toEqual([]);
    // Settings not read: the grant is unknown, never empty.
    expect(mcpGrantRows(state([mcpRow("jira", JIRA_TOOLS)]), undefined)[0]?.held).toBeUndefined();
  });
});

describe("changeMcpGrant", () => {
  const agent = { id: "mason", display_name: "Mason" };

  it("posts <kind>:<tool>[,<tool>] for tools and <kind>:none for no tools, to the same route as the GitHub grant", async () => {
    const fake = fakeBridge();
    fake.route("POST /agents/:id/set", () => ok({ agent: {}, field: "connectors", old: null, new: null, changed: true }));
    expect(await changeMcpGrant(fake.bridge, agent, "jira", ["getJiraIssue", "searchJiraIssuesUsingJql"])).toEqual({ ok: true, text: "Jira: 2 tools granted to Mason." });
    expect(await changeMcpGrant(fake.bridge, agent, "clickup", ["get_task"])).toEqual({ ok: true, text: "ClickUp: 1 tool granted to Mason." });
    expect(await changeMcpGrant(fake.bridge, agent, "jira", [])).toEqual({ ok: true, text: "Jira tools revoked from Mason." });
    const sent = fake.requestsTo("POST /agents/:id/set").map((r) => r.req);
    expect(sent.map((r) => r.body)).toEqual([
      { field: "connectors", value: "jira:getJiraIssue,searchJiraIssuesUsingJql" },
      { field: "connectors", value: "clickup:get_task" },
      { field: "connectors", value: "jira:none" },
    ]);
    expect(sent.every((r) => r.params?.id === "mason")).toBe(true);
  });

  it("says so when nothing changed, shows a refusal as text, and sends nothing for a tool name holding a comma", async () => {
    const fake = fakeBridge();
    fake.route("POST /agents/:id/set", () => ok({ agent: {}, field: "connectors", old: null, new: null, changed: false }));
    expect((await changeMcpGrant(fake.bridge, agent, "jira", ["a"])).text).toBe("Mason's Jira tools were already as set.");
    fake.route("POST /agents/:id/set", () => refused(400, { error: "invalid_input", field: "connectors", message: "an MCP grant is <kind>:<tool>" }));
    expect(await changeMcpGrant(fake.bridge, agent, "jira", ["a"])).toEqual({ ok: false, text: "invalid_input: an MCP grant is <kind>:<tool>" });
    const before = fake.requestsTo("POST /agents/:id/set").length;
    const comma = await changeMcpGrant(fake.bridge, agent, "jira", ["a", "b,c"]);
    expect(comma.ok).toBe(false);
    expect(fake.requestsTo("POST /agents/:id/set")).toHaveLength(before);
  });
});

describe("the Connectors row's MCP grant", () => {
  const withJira = (extra: Partial<Parameters<typeof startTeam>[0]> = {}) =>
    startTeam({
      connectors: ok({ connectors: [connector("connected")], mcp_connections: [mcpRow("jira", JIRA_TOOLS), mcpRow("clickup", ["get_task"], "disconnected")] }),
      content: { connectors: { github: "read", jira: ["getJiraIssue"] } },
      ...extra,
    });

  it("shows, per connected MCP kind, which of its granted tools the agent holds, and no row for a kind that is not connected", async () => {
    await withJira();
    const mason = await openInspector("Mason");
    await waitFor(() => expect(mcpWords(mason, "jira")).toBe("1 of 3 tools granted"));
    expect(within(mason).getByTestId("team-connector-mcp-jira").textContent).toContain("Jira");
    expect(ticked(mason, "jira")).toEqual(["getJiraIssue"]);
    expect(within(mcpTools(mason, "jira")).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(mason).queryByTestId("team-connector-mcp-clickup")).toBeNull();
    // The GitHub row is untouched: the file's {github: read} is Read.
    expect(grantWords(mason)).toBe("Read");
  });

  it("shows an agent with no grant for the kind as no tools granted", async () => {
    await withJira({ content: {} });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(mcpWords(mason, "jira")).toBe("no tools granted"));
    expect(ticked(mason, "jira")).toEqual([]);
  });

  it("shows Wright's per-tool grant as unknown, with no checkboxes, and never requests its detail", async () => {
    const kernel = await withJira();
    const wright = await openInspector("Wright");
    await waitFor(() => expect(mcpWords(wright, "jira")).toBe("grant unknown"));
    expect(within(wright).queryByTestId("team-connector-mcp-jira-tools")).toBeNull();
    expect(within(wright).queryAllByRole("checkbox")).toEqual([]);
    expect(requests(kernel, "GET /agents/:id").filter((r) => r.params?.id === "wright")).toEqual([]);
  });

  it("shows no MCP row while GET /connectors failed or lists no mcp_connections", async () => {
    await startTeam({ connectors: refused(500, { error: "internal" }) });
    let mason = await openInspector("Mason");
    await waitFor(() => expect(stateWords(mason)).toBe("state unknown"));
    expect(within(mason).queryByTestId("team-connector-mcp-jira")).toBeNull();
    cleanup();
    await startTeam({ connectors: ok({ connectors: [connector("connected")] }) });
    mason = await openInspector("Mason");
    await waitFor(() => expect(stateWords(mason)).toBe("connected"));
    expect(within(mason).queryByTestId("team-connector-mcp-jira")).toBeNull();
  });

  it("ticking a tool posts the whole next list, unticking the last posts <kind>:none, and the row changes only when the feed refetches the detail", async () => {
    const kernel = await withJira({ set: setOk("connectors", null, null) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(mcpWords(mason, "jira")).toBe("1 of 3 tools granted"));

    fireEvent.click(within(mcpTools(mason, "jira")).getByRole("checkbox", { name: "createJiraIssue" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "jira:getJiraIssue,createJiraIssue" } });
    expect((await within(mason).findByTestId("team-insp-notice")).textContent).toBe("Jira: 2 tools granted to Mason.");
    // Not a local edit: the box is still as the detail read it.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(ticked(mason, "jira")).toEqual(["getJiraIssue"]);

    fireEvent.click(within(mcpTools(mason, "jira")).getByRole("checkbox", { name: "getJiraIssue" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(2));
    expect(requests(kernel, "POST /agents/:id/set")[1]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "jira:none" } });
    expect((await within(mason).findByTestId("team-insp-notice")).textContent).toBe("Jira tools revoked from Mason.");
    // No GitHub grant call was made.
    expect(requests(kernel, "POST /agents/:id/set").map((r) => (r.body as { value: string }).value)).not.toContain("github");
  });

  it("a refusal is the notice as text, and the row keeps what the detail read", async () => {
    await withJira({ set: () => refused(400, { error: "invalid_input", field: "connectors", message: "<b>bad</b> tool" }) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(mcpWords(mason, "jira")).toBe("1 of 3 tools granted"));
    fireEvent.click(within(mcpTools(mason, "jira")).getByRole("checkbox", { name: "createJiraIssue" }));
    const notice = await within(mason).findByTestId("team-insp-notice");
    expect(notice.textContent).toBe("invalid_input: <b>bad</b> tool");
    expect(notice.querySelector("b")).toBeNull();
    expect(ticked(mason, "jira")).toEqual(["getJiraIssue"]);
  });
});

// ---- Phase 8 item 21b: the grant by capability, in words ----------------------------------------------

const CLICKUP_CAPABILITIES: readonly McpCapability[] = [
  { id: "read", label: "Read tickets", changes: false, tools: ["clickup_get_task", "clickup_filter_tasks"] },
  { id: "comment", label: "Comment on tickets", changes: false, tools: ["clickup_create_task_comment"] },
  { id: "create", label: "Create tickets", changes: true, tools: ["clickup_create_task"] },
  { id: "delete", label: "Delete tickets", changes: true, tools: ["clickup_delete_task", "clickup_merge_tasks"] },
];
const CLICKUP_OTHER = ["clickup_oddity"];
const CLICKUP_LISTED = [...CLICKUP_CAPABILITIES.flatMap((c) => c.tools), ...CLICKUP_OTHER];

function clickupWithCapabilities(extra: Partial<McpConnection> = {}): McpConnection {
  return { ...mcpRow("clickup", CLICKUP_LISTED), capabilities: CLICKUP_CAPABILITIES, other_tools: CLICKUP_OTHER, ...extra };
}

describe("capabilityState", () => {
  const read = CLICKUP_CAPABILITIES[0] as McpCapability;
  it("reads all, some or none of a capability's listed tools as granted, partly granted (n of m) or not granted", () => {
    expect(capabilityState(read, ["clickup_get_task", "clickup_filter_tasks", "other"])).toMatchObject({ status: "granted", words: "granted" });
    expect(capabilityState(read, ["clickup_filter_tasks"])).toMatchObject({ status: "partly", held: 1, of: 2, words: "partly granted (1 of 2)" });
    expect(capabilityState(read, [])).toMatchObject({ status: "none", words: "not granted" });
    expect(capabilityState(read, ["clickup_oddity"])).toMatchObject({ status: "none", words: "not granted" });
  });
});

describe("changeCapabilityGrant", () => {
  const agent = { id: "mason", display_name: "Mason" };
  const changed = () => ok({ agent: {}, field: "connectors", old: null, new: null, changed: true });
  const del = CLICKUP_CAPABILITIES[3] as McpCapability;
  const read = CLICKUP_CAPABILITIES[0] as McpCapability;

  it("ticking adds exactly that capability's tools to what the member holds, and names the capability in the result", async () => {
    const fake = fakeBridge();
    fake.route("POST /agents/:id/set", changed);
    const held = ["clickup_create_task", "clickup_oddity"];
    expect(await changeCapabilityGrant(fake.bridge, agent, "clickup", read, held, true)).toEqual({ ok: true, text: "ClickUp: Read tickets granted to Mason." });
    expect(fake.requestsTo("POST /agents/:id/set").map((r) => r.req.body)).toEqual([{ field: "connectors", value: "clickup:clickup_create_task,clickup_oddity,clickup_get_task,clickup_filter_tasks" }]);
  });

  it("a partly held capability's tick grants only the rest; an untick takes away only that capability's tools", async () => {
    const fake = fakeBridge();
    fake.route("POST /agents/:id/set", changed);
    await changeCapabilityGrant(fake.bridge, agent, "clickup", read, ["clickup_filter_tasks", "clickup_oddity"], true);
    expect((await changeCapabilityGrant(fake.bridge, agent, "clickup", del, ["clickup_delete_task", "clickup_merge_tasks", "clickup_oddity"], false)).text).toBe("ClickUp: Delete tickets revoked from Mason.");
    await changeCapabilityGrant(fake.bridge, agent, "clickup", del, ["clickup_delete_task", "clickup_merge_tasks"], false);
    expect(fake.requestsTo("POST /agents/:id/set").map((r) => (r.req.body as { value: string }).value)).toEqual([
      "clickup:clickup_filter_tasks,clickup_oddity,clickup_get_task",
      "clickup:clickup_oddity",
      "clickup:none",
    ]);
  });

  it("sends nothing when the member's grant is unknown, and shows a refusal as text", async () => {
    const fake = fakeBridge();
    fake.route("POST /agents/:id/set", () => refused(400, { error: "invalid_input", message: "<b>no</b>" }));
    const unknown = await changeCapabilityGrant(fake.bridge, agent, "clickup", read, undefined, true);
    expect(unknown.ok).toBe(false);
    expect(fake.requestsTo("POST /agents/:id/set")).toHaveLength(0);
    expect(await changeCapabilityGrant(fake.bridge, agent, "clickup", read, [], true)).toEqual({ ok: false, text: "invalid_input: <b>no</b>" });
  });
});

describe("CapabilityList", () => {
  it("shows each capability's words and state, marks the ones that change things, and keeps raw names one expand away", () => {
    render(<CapabilityList kind="clickup" capabilities={CLICKUP_CAPABILITIES} otherTools={CLICKUP_OTHER} held={["clickup_get_task", "clickup_delete_task"]} />);
    const list = screen.getByTestId("team-connector-mcp-clickup-capabilities");
    const state = (id: string) => within(list).getByTestId(`team-connector-mcp-clickup-capabilities-${id}-state`).textContent;
    expect(state("read")).toBe("partly granted (1 of 2)");
    expect(state("comment")).toBe("not granted");
    expect(state("delete")).toBe("partly granted (1 of 2)");
    expect(within(list).queryByTestId("team-connector-mcp-clickup-capabilities-read-changes")).toBeNull();
    expect(within(list).getByTestId("team-connector-mcp-clickup-capabilities-create-changes").textContent).toBe("changes things");
    expect(within(list).getByTestId("team-connector-mcp-clickup-capabilities-delete-changes").textContent).toBe("changes things");
    const names = within(list).getByTestId("team-connector-mcp-clickup-capabilities-delete-tools");
    expect(names.textContent).toBe("clickup_delete_taskclickup_merge_tasks");
    expect((names.closest("details") as HTMLDetailsElement).open).toBe(false);
    // Read-only without a handler: no box can be ticked.
    expect(within(list).getAllByRole("checkbox").every((box) => (box as HTMLInputElement).disabled)).toBe(true);
  });

  it("lists a listed tool no capability names, and a held tool the connection no longer lists, under Other tools, by name", () => {
    render(<CapabilityList kind="clickup" capabilities={CLICKUP_CAPABILITIES} otherTools={CLICKUP_OTHER} held={["clickup_oddity", "clickup_retired"]} />);
    const other = screen.getByTestId("team-connector-mcp-clickup-capabilities-other");
    expect(within(other).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["clickup_oddity (granted)", "clickup_retired (granted)"]);
    expect(within(other).queryAllByRole("checkbox")).toEqual([]);
  });

  it("folds Other tools under a line in words, closed until the owner opens it, so no raw name shows above it (21b Validation 2, step 2)", () => {
    render(<CapabilityList kind="clickup" capabilities={CLICKUP_CAPABILITIES} otherTools={CLICKUP_OTHER} held={["clickup_oddity", "clickup_retired"]} />);
    const other = screen.getByTestId("team-connector-mcp-clickup-capabilities-other");
    expect(other.tagName).toBe("DETAILS");
    expect((other as HTMLDetailsElement).open).toBe(false);
    const summary = screen.getByTestId("team-connector-mcp-clickup-capabilities-other-summary");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.textContent).toBe("2 other tools · no capability covers these, so a tick never grants them · 2 granted");
    expect(summary.textContent).not.toMatch(/clickup_/);
  });

  it("otherToolsSummary counts in words, one or many, and names how many are held only when some are", () => {
    expect(otherToolsSummary(21, 0)).toBe("21 other tools · no capability covers these, so a tick never grants them");
    expect(otherToolsSummary(1, 1)).toBe("1 other tool · no capability covers it, so a tick never grants it · 1 granted");
  });

  it("a tick reports the capability and the way, and a partly held capability is indeterminate until ticked", () => {
    const calls: Array<[string, boolean]> = [];
    render(<CapabilityList kind="clickup" capabilities={CLICKUP_CAPABILITIES} otherTools={[]} held={["clickup_get_task"]} onToggle={(c, on) => calls.push([c.id, on])} />);
    const box = screen.getByRole("checkbox", { name: "Read tickets" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("checkbox", { name: "Create tickets" }));
    expect(calls).toEqual([["read", true], ["create", true]]);
    expect(screen.queryByTestId("team-connector-mcp-clickup-capabilities-other")).toBeNull();
  });

  it("renders kernel strings as text, never markup", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    render(<CapabilityList kind="jira" capabilities={[{ id: "read", label: hostile, changes: false, tools: [hostile] }]} otherTools={[hostile]} held={[]} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("checkbox", { name: hostile })).toBeTruthy();
  });
});

describe("the Connectors row's capability grant", () => {
  const withClickup = (extra: Partial<Parameters<typeof startTeam>[0]> = {}, connection: McpConnection = clickupWithCapabilities()) =>
    startTeam({
      connectors: ok({ connectors: [connector("connected")], mcp_connections: [connection] }),
      content: { connectors: { github: "read", clickup: ["clickup_get_task", "clickup_oddity"] } },
      ...extra,
    });
  const capState = (inspector: HTMLElement, id: string): string | null => within(inspector).getByTestId(`team-connector-mcp-clickup-capabilities-${id}-state`).textContent;

  it("offers the grant as capabilities in words, with nothing ticked by a tick-less member and the raw per-tool list not shown", async () => {
    await withClickup({ content: {} });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(capState(mason, "read")).toBe("not granted"));
    expect(within(mason).getAllByRole("checkbox").filter((b) => (b as HTMLInputElement).checked)).toEqual([]);
    expect(within(mason).queryByTestId("team-connector-mcp-clickup-tools")).toBeNull();
    expect(within(mason).queryByTestId("team-connector-mcp-clickup-plain-unavailable")).toBeNull();
    expect(mcpWords(mason, "clickup")).toBe("no tools granted");
  });

  it("reads a member holding some of a capability as partly granted (n of m), and other tools by name, never ticked", async () => {
    await withClickup();
    const mason = await openInspector("Mason");
    await waitFor(() => expect(capState(mason, "read")).toBe("partly granted (1 of 2)"));
    expect(capState(mason, "delete")).toBe("not granted");
    const other = within(mason).getByTestId("team-connector-mcp-clickup-capabilities-other");
    expect(other.textContent).toContain("clickup_oddity");
  });

  it("ticking a partly held capability posts the whole next set (what it holds plus the rest), names the capability, and changes the row only through the feed", async () => {
    const kernel = await withClickup({ set: setOk("connectors", null, null) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(capState(mason, "read")).toBe("partly granted (1 of 2)"));
    fireEvent.click(within(mason).getByRole("checkbox", { name: "Read tickets" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "clickup:clickup_get_task,clickup_oddity,clickup_filter_tasks" } });
    expect((await within(mason).findByTestId("team-insp-notice")).textContent).toBe("ClickUp: Read tickets granted to Mason.");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(capState(mason, "read")).toBe("partly granted (1 of 2)");
  });

  it("ticking a capability never grants an other tool, and unticking a granted one keeps the rest", async () => {
    const kernel = await withClickup({ content: { connectors: { clickup: ["clickup_create_task", "clickup_get_task", "clickup_filter_tasks"] } }, set: setOk("connectors", null, null) });
    const mason = await openInspector("Mason");
    await waitFor(() => expect(capState(mason, "create")).toBe("granted"));
    fireEvent.click(within(mason).getByRole("checkbox", { name: "Comment on tickets" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    fireEvent.click(within(mason).getByRole("checkbox", { name: "Create tickets" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(2));
    const values = requests(kernel, "POST /agents/:id/set").map((r) => (r.body as { value: string }).value);
    expect(values).toEqual([
      "clickup:clickup_create_task,clickup_get_task,clickup_filter_tasks,clickup_create_task_comment",
      "clickup:clickup_get_task,clickup_filter_tasks",
    ]);
    expect(values.join()).not.toContain("clickup_oddity");
    expect(values.join()).not.toContain("clickup_delete_task");
  });

  it("falls back to the raw per-tool list with a line saying the plain list is unavailable when capabilities is null or absent, and changes no grant", async () => {
    for (const connection of [clickupWithCapabilities({ capabilities: null, other_tools: null }), mcpRow("clickup", CLICKUP_LISTED)]) {
      const kernel = await withClickup({}, connection);
      const mason = await openInspector("Mason");
      await waitFor(() => expect(mcpWords(mason, "clickup")).toBe(`2 of ${CLICKUP_LISTED.length} tools granted`));
      expect(within(mason).getByTestId("team-connector-mcp-clickup-plain-unavailable").textContent).toContain("unavailable");
      expect(within(mcpTools(mason, "clickup")).getAllByRole("checkbox")).toHaveLength(CLICKUP_LISTED.length);
      expect(ticked(mason, "clickup")).toEqual(["clickup_get_task", "clickup_oddity"]);
      expect(within(mason).queryByTestId("team-connector-mcp-clickup-capabilities")).toBeNull();
      expect(requests(kernel, "POST /agents/:id/set")).toEqual([]);
      cleanup();
    }
  });

  it("shows Wright's capability grant as unknown, with no list to tick", async () => {
    await withClickup();
    const wright = await openInspector("Wright");
    await waitFor(() => expect(mcpWords(wright, "clickup")).toBe("grant unknown"));
    expect(within(wright).queryByTestId("team-connector-mcp-clickup-capabilities")).toBeNull();
    expect(within(wright).queryAllByRole("checkbox")).toEqual([]);
  });
});
