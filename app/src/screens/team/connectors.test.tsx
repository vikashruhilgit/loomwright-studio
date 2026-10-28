// @vitest-environment jsdom
// The inspector's Connectors row and its ⌘K commands (phase 6 item 08, AC8 and
// AC9) against a scripted bridge (`fake-bridge.ts`): the GitHub grant from the
// roster's `connectors`, the connector's state from `GET /connectors`
// (refetched on a `connector_status` event), Grant GitHub / Revoke through
// `POST /agents/:id/set {field: "connectors", value}`, and the row changing
// only when the feed's `agent_*` event refetches the roster.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDetailResponse, ApiRequest, ApiResult, Connector, ConnectorStatus, EventFrame, RosterEntry, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge, Responder } from "../../store/fake-bridge";
import { type ConnectorsState, connectorStateText, githubGranted } from "./model";
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

function detail(agent: RosterEntry): AgentDetailResponse {
  return {
    agent,
    settings: {
      file: `/Users/o/.loomwright-studio/config/agents/${agent.id}.json`,
      content: { model: agent.model, permission_mode: "default", tool_policy: { allowedTools: ["Read"], allowedBashPrefixes: [] }, never: [], limits: {}, workspaces: [] },
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
    return found === undefined ? refused(404, { error: "not_found" }) : ok(detail(found));
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
    expect(grantWords(mason)).toBe("granted");
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
    // The grant itself is still the roster's.
    expect(grantWords(again)).toBe("granted");
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

  it("an agent whose connectors the roster did not report reads grant unknown, with neither Grant nor Revoke", async () => {
    await startTeam({ roster: [WRIGHT, { ...MASON, connectors: null }, entry({ id: "pim", display_name: "Pim", status: "off" })] });
    const mason = await openInspector("Mason");
    expect(grantWords(mason)).toBe("grant unknown");
    expect(within(mason).queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(within(mason).queryByRole("button", { name: "Grant GitHub" })).toBeNull();
    const pim = await openInspector("Pim");
    expect(grantWords(pim)).toBe("grant unknown");
  });
});

// ---- AC9: Grant and Revoke -----------------------------------------------------------------------

describe("Grant GitHub and Revoke", () => {
  it("Revoke posts value none, and the row changes only when the feed's agent_* event refetches the roster", async () => {
    const kernel = await startTeam({ set: setOk("connectors", ["github"], null) });
    const mason = await openInspector("Mason");
    expect(within(mason).queryByRole("button", { name: "Grant GitHub" })).toBeNull();
    fireEvent.click(within(mason).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "none" } });
    expect((await within(mason).findByTestId("team-insp-notice")).textContent).toBe("GitHub revoked from Mason.");

    // Not a local edit: past the store's refetch throttle, the row still says granted.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(grantWords(mason)).toBe("granted");
    expect(within(mason).getByRole("button", { name: "Revoke" })).toBeTruthy();

    kernel.roster = kernel.roster.map((a) => (a.id === "mason" ? { ...a, connectors: [] } : a));
    emit(kernel, "agent_settings_set");
    await waitFor(() => expect(grantWords(mason)).toBe("not granted"));
    expect(within(mason).getByRole("button", { name: "Grant GitHub" })).toBeTruthy();
    expect(within(mason).queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("Grant GitHub posts value github for a non-granted agent, and Wright's grant goes to /agents/wright/set", async () => {
    const kernel = await startTeam({ set: setOk("connectors", null, ["github"]) });
    const pim = await openInspector("Pim");
    fireEvent.click(within(pim).getByRole("button", { name: "Grant GitHub" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(1));
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "pim" }, body: { field: "connectors", value: "github" } });
    expect((await within(pim).findByTestId("team-insp-notice")).textContent).toBe("GitHub granted to Pim.");
    expect(grantWords(pim)).toBe("not granted");

    const wright = await openInspector("Wright");
    fireEvent.click(within(wright).getByRole("button", { name: "Grant GitHub" }));
    await waitFor(() => expect(requests(kernel, "POST /agents/:id/set")).toHaveLength(2));
    expect(requests(kernel, "POST /agents/:id/set")[1]).toMatchObject({ params: { id: "wright" }, body: { field: "connectors", value: "github" } });
  });

  it("says so when the grant was already in place, and shows the kernel's refusal as text without changing the row", async () => {
    const kernel = await startTeam({ set: () => ok({ agent: {}, field: "connectors", old: ["github"], new: ["github"], changed: false }) });
    const pim = await openInspector("Pim");
    fireEvent.click(within(pim).getByRole("button", { name: "Grant GitHub" }));
    expect((await within(pim).findByTestId("team-insp-notice")).textContent).toBe("Pim already has GitHub.");

    kernel.fake.route("POST /agents/:id/set", () => refused(400, { error: "invalid_input", field: "connectors", message: "connectors must be github or none" }));
    fireEvent.click(within(pim).getByRole("button", { name: "Grant GitHub" }));
    await waitFor(() => expect(within(pim).getByTestId("team-insp-notice").textContent).toBe("invalid_input: connectors must be github or none"));
    expect(grantWords(pim)).toBe("not granted");
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
    // Mason holds GitHub: only Revoke is enabled. Pim and Wright hold none: only Grant is.
    expect(kernel.registry.get("team.revoke-github.mason")?.enabled?.()).toBe(true);
    expect(kernel.registry.get("team.grant-github.mason")?.enabled?.()).toBe(false);
    expect(kernel.registry.get("team.grant-github.pim")?.enabled?.()).toBe(true);
    expect(kernel.registry.get("team.revoke-github.pim")?.enabled?.()).toBe(false);
    expect(kernel.registry.get("team.grant-github.wright")?.enabled?.()).toBe(true);
    expect(kernel.registry.get("team.revoke-github.wright")?.enabled?.()).toBe(false);
  });

  it("are enabled in neither state while the roster did not report the agent's connectors", async () => {
    const kernel = await startTeam({ roster: [WRIGHT, { ...MASON, connectors: null }, entry({ id: "pim", display_name: "Pim" })] });
    for (const id of ["mason", "pim"]) {
      expect(kernel.registry.get(`team.grant-github.${id}`)?.enabled?.()).toBe(false);
      expect(kernel.registry.get(`team.revoke-github.${id}`)?.enabled?.()).toBe(false);
    }
  });

  it("run the same route as the buttons: Revoke posts none, Grant posts github, and the answer is the screen's notice", async () => {
    const kernel = await startTeam({ set: setOk("connectors", ["github"], null) });
    await act(async () => {
      await kernel.registry.get("team.revoke-github.mason")?.run();
    });
    expect(requests(kernel, "POST /agents/:id/set")[0]).toMatchObject({ params: { id: "mason" }, body: { field: "connectors", value: "none" } });
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

  it("re-register when an agent's connectors change, so enabled follows the roster", async () => {
    const kernel = await startTeam();
    expect(kernel.registry.get("team.grant-github.pim")?.enabled?.()).toBe(true);
    kernel.roster = kernel.roster.map((a) => (a.id === "pim" ? { ...a, connectors: ["github"] as const } : a));
    emit(kernel, "agent_settings_set");
    await waitFor(() => expect(kernel.registry.get("team.grant-github.pim")?.enabled?.()).toBe(false));
    expect(kernel.registry.get("team.revoke-github.pim")?.enabled?.()).toBe(true);
    expect(kernel.registry.list().filter((c) => c.id === "team.revoke-github.pim")).toHaveLength(1);
  });
});
