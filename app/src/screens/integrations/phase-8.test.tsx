// @vitest-environment jsdom
// Integrations, phase 8 (`docs/design/mockups/phase-8.html`): Jira and ClickUp connect (R1, S1), the GitHub App
// "needs new permissions" upgrade (R2, S2), the repo policy card (R3, R4, S3), the empty case (R5) and the three palette
// commands (S5), over the scripted bridge of `test-support.tsx` plus this file's routes for the phase 8 calls. Every
// string here is invented fixture data. The main process's side of the two URLs is in `app/electron/*.test.ts`.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDetailResponse, ApiRequest, Connector, McpConnection, McpConnectionKind, RepoPolicy, RepoPolicySetBody, RosterEntry } from "../../api/contract";
import { ok } from "../../store/fake-bridge";
import { INTEGRATIONS_OWNER } from "./commands";
import { BILLING_PLANS_URL, INTEGRATIONS_TEST_IDS as IDS, acceptBody, detectionOf, mcpRefusalOfCode, mcpRefusalOfEvent, policyRowMeta, presetBody, repoSettingsUrl, splitRepo } from "./model";
import { UNREACHABLE, WRIGHT, agent, appConnector, connector, createKernel, deferred, emit, mountScreen, refused, requests, sleep } from "./test-support";
import type { Kernel } from "./test-support";

afterEach(() => {
  cleanup();
});

// ---- The fixture world ---------------------------------------------------------------------------

const CONNECT = "POST /connectors/mcp/:kind/connect";
const CANCEL = "POST /connectors/mcp/:kind/connect/cancel";
const DISCONNECT = "POST /connectors/mcp/:kind/disconnect";
const UPGRADE = "GET /connectors/github/app/upgrade";
const POLICIES = "GET /repos/policy";
const SET_POLICY = "POST /repos/policy/:owner/:repo";
const DETECT = "POST /repos/policy/:owner/:repo/detect";

const AUTHORIZE_URL = "https://auth.example.test/authorize?state=fixture-state-clickup";
const UPGRADE_URL = "https://github.com/settings/apps/loomwright-studio-fixture/permissions";
const WORKSPACE = "https://sandbox-workspace.example.test/mcp";
const CLICKUP_TOOLS = ["get_task", "search_tasks", "update_task"] as const;

const inSeconds = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString();

function mcpRow(kind: McpConnectionKind, status: McpConnection["status"] = "connected", overrides: Partial<McpConnection> = {}): McpConnection {
  return { kind, server_url: kind === "jira" ? "https://example.atlassian.test" : WORKSPACE, status, granted_tools: kind === "jira" ? ["getJiraIssue", "transitionJiraIssue"] : CLICKUP_TOOLS, token_expiry: null, ...overrides };
}

function detection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { repo: "octo-owner/site", protection: "protected", required_reviews: 1, required_checks: ["ci"], pushers: ["octo-owner", "octo-dev"], default_branch: "main", private: false, read_at: new Date().toISOString(), ...overrides };
}

function policyOf(repo: string, overrides: Partial<RepoPolicy> = {}): RepoPolicy {
  return { repo, kind: null, required_reviews: null, trust_unprotected: false, detected: detection({ repo }), proposal: null, set_by: null, set_at: null, ...overrides };
}

/** A private repo on GitHub Free: protection is unavailable, and the proposal carries the three choices and no kind. */
function unenforceable(repo = "octo-owner/scratch"): RepoPolicy {
  return policyOf(repo, {
    detected: detection({ repo, protection: "protection_unavailable", required_reviews: null, required_checks: [], private: true }),
    proposal: { kind: null, required_reviews: null, choices: ["make_public_or_upgrade", "trust_unprotected", "safe_mode"] },
  });
}

interface World {
  connectors: Connector[];
  mcp: McpConnection[];
  policies: RepoPolicy[];
  upgradeUrl: string | null;
  /** What `GET /agents/:id` answers, by id. */
  details: Record<string, AgentDetailResponse>;
}

function detailOf(entry: RosterEntry, connectors: unknown): AgentDetailResponse {
  return { agent: entry, settings: { file: `config/agents/${entry.id}.json`, content: { connectors }, error: null }, never: null, workspaces: null, memory: { dir: "", files: [] }, charter: null };
}

interface Started {
  readonly kernel: Kernel;
  readonly world: World;
  /** Each phase 8 route's answer, swappable per test. */
  readonly answer: {
    connect: (req: ApiRequest) => unknown;
    cancel: (req: ApiRequest) => unknown;
    disconnect: (req: ApiRequest) => unknown;
    upgrade: (req: ApiRequest) => unknown;
    set: (req: ApiRequest) => unknown;
    detect: (req: ApiRequest) => unknown;
  };
}

type Answered = ReturnType<typeof ok> | ReturnType<typeof refused> | typeof UNREACHABLE | Promise<ReturnType<typeof ok>>;

/** The screen over a kernel that answers the phase 8 routes from `world` (default: nothing connected, no repos reached). */
async function start(init: Partial<World> = {}, roster?: RosterEntry[]): Promise<Started> {
  const world: World = { connectors: [], mcp: [], policies: [], upgradeUrl: UPGRADE_URL, details: {}, ...init };
  const kernel = createKernel({ ...(roster === undefined ? {} : { roster }), connectors: () => ok({ connectors: world.connectors, mcp_connections: world.mcp }) });
  const answer: Started["answer"] = {
    connect: () => ok({ authorize_url: AUTHORIZE_URL, expires_at: inSeconds(600) }),
    cancel: () => ok({ cancelled: true }),
    disconnect: (req) => ok({ connector: connector("disconnected", { kind: String(req.params?.["kind"]) as "jira" }) }),
    upgrade: () => ok({ url: world.upgradeUrl }),
    set: (req) => {
      const body = req.body as RepoPolicySetBody;
      const repo = `${String(req.params?.["owner"])}/${String(req.params?.["repo"])}`;
      const before = world.policies.find((p) => p.repo === repo) ?? policyOf(repo);
      return ok(policyOf(repo, { ...before, kind: body.kind, required_reviews: body.required ?? null, trust_unprotected: body.trust_unprotected ?? before.trust_unprotected, set_by: "owner", set_at: new Date().toISOString() }));
    },
    detect: (req) => ok(world.policies.find((p) => p.repo === `${String(req.params?.["owner"])}/${String(req.params?.["repo"])}`) ?? policyOf("x/y")),
  };
  kernel.fake.route(CONNECT, (req) => answer.connect(req) as Answered);
  kernel.fake.route(CANCEL, (req) => answer.cancel(req) as Answered);
  kernel.fake.route(DISCONNECT, (req) => answer.disconnect(req) as Answered);
  kernel.fake.route(UPGRADE, (req) => answer.upgrade(req) as Answered);
  kernel.fake.route(POLICIES, () => ok({ repos: world.policies }));
  kernel.fake.route(SET_POLICY, (req) => answer.set(req) as Answered);
  kernel.fake.route(DETECT, (req) => answer.detect(req) as Answered);
  kernel.fake.route("GET /agents/:id", (req) => {
    const found = world.details[String(req.params?.["id"])];
    return found === undefined ? refused(404, { error: "unknown_agent" }) : ok(found);
  });
  await mountScreen(kernel);
  return { kernel, world, answer };
}

const select = (testId: string) => fireEvent.click(screen.getByTestId(testId));
/** Opens the Repo policy pane (the repos are read when it first opens) and waits for the first card. */
async function openPolicy(): Promise<void> {
  select(IDS.rowPolicy);
  await screen.findByTestId(IDS.policyCard);
}
const state = (): string | null => screen.getByTestId(IDS.mcp).getAttribute("data-state");
const feedLive = (kernel: Kernel) => waitFor(() => expect(kernel.fake.listenerCount()).toBeGreaterThan(0));
const command = (kernel: Kernel, id: string) => {
  const found = kernel.registry.get(id);
  if (found === undefined) throw new Error(`no command ${id}`);
  return found;
};

/** Press Connect on ClickUp and wait until the vendor's page is open and being waited on. */
async function connectClickup(started: Started): Promise<void> {
  select(IDS.rowClickup);
  fireEvent.click(screen.getByTestId(IDS.mcpConnect));
  await waitFor(() => expect(screen.getByTestId(IDS.mcpWait).getAttribute("data-phase")).toBe("waiting"));
  await feedLive(started.kernel);
}

// ---- R1, S1: Jira and ClickUp ---------------------------------------------------------------------------------

describe("Connect on ClickUp (R1)", () => {
  it("calls POST /connectors/mcp/clickup/connect once, shows the wait with the window's close time, and opens the returned authorize_url", async () => {
    const started = await start();
    const { kernel } = started;
    select(IDS.rowClickup);
    expect(state()).toBe("none");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Connect ClickUp so a playbook can read your tickets.");
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(screen.getByTestId(IDS.mcpWait).getAttribute("data-phase")).toBe("waiting"));
    expect(requests(kernel, CONNECT)).toEqual([{ method: "POST", path: "/connectors/mcp/:kind/connect", params: { kind: "clickup" } }]);
    expect(kernel.opened).toEqual([AUTHORIZE_URL]);
    expect(state()).toBe("connecting");
    const wait = screen.getByTestId(IDS.mcpWait);
    expect(wait.getAttribute("data-expires-at")).not.toBeNull();
    expect(screen.getByTestId(IDS.mcpWaitCloses).textContent).toMatch(/^This window closes at \d\d:\d\d, or when ClickUp answers\.$/);
    expect(within(wait).getByRole("button", { name: "Cancel" })).toBeTruthy();
    // The list row follows the attempt.
    expect(screen.getByTestId(IDS.rowClickup).textContent).toContain("connecting");
  });

  it("shows the workspace and the granted tools once a connector_status event is followed by a read that shows the row connected", async () => {
    const started = await start();
    await connectClickup(started);
    started.world.mcp = [mcpRow("clickup", "connected")];
    emit(started.kernel, "connector_status", { connector_id: 2, kind: "clickup", status: "connected" });
    await waitFor(() => expect(state()).toBe("connected"));
    expect(screen.getByTestId(IDS.mcpWorkspace).textContent).toBe(WORKSPACE);
    expect(screen.getAllByTestId(IDS.mcpTool).map((row) => row.getAttribute("data-tool"))).toEqual([...CLICKUP_TOOLS]);
    expect(screen.getByTestId(IDS.rowClickup).textContent).toContain(`connected · ${WORKSPACE}`);
    // Success is the read, not the event: the one connect call is all the pane ever sent.
    expect(requests(started.kernel, CONNECT)).toHaveLength(1);
    expect(requests(started.kernel, CANCEL)).toHaveLength(0);
  });

  it("does not take an event alone as success", async () => {
    const started = await start();
    await connectClickup(started);
    emit(started.kernel, "connector_status", { connector_id: 2, kind: "clickup", status: "connected" });
    await sleep(400);
    expect(state()).toBe("connecting");
  });

  it("Cancel during the wait calls POST …/connect/cancel once, and the pane is not connected again", async () => {
    const started = await start();
    await connectClickup(started);
    fireEvent.click(screen.getByTestId(IDS.mcpCancel));
    await waitFor(() => expect(requests(started.kernel, CANCEL)).toHaveLength(1));
    expect(requests(started.kernel, CANCEL)).toEqual([{ method: "POST", path: "/connectors/mcp/:kind/connect/cancel", params: { kind: "clickup" } }]);
    expect(state()).toBe("none");
    expect(screen.getByTestId(IDS.mcpConnect)).toBeTruthy();
  });

  it("Cancel before the connect call is answered cancels the window that answer opens, and never opens its URL", async () => {
    const started = await start();
    const slow = deferred<ReturnType<typeof ok>>();
    started.answer.connect = () => slow.promise;
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(screen.getByTestId(IDS.mcpWait).getAttribute("data-phase")).toBe("starting"));
    fireEvent.click(screen.getByTestId(IDS.mcpCancel));
    expect(requests(started.kernel, CANCEL)).toHaveLength(0);
    await act(async () => slow.resolve(ok({ authorize_url: AUTHORIZE_URL, expires_at: inSeconds(600) })));
    await waitFor(() => expect(requests(started.kernel, CANCEL)).toHaveLength(1));
    expect(started.kernel.opened).toEqual([]);
    expect(state()).toBe("none");
  });

  it("'Open ClickUp again' reopens the same address with no second connect call", async () => {
    const started = await start();
    await connectClickup(started);
    fireEvent.click(screen.getByTestId(IDS.mcpOpenAgain));
    await waitFor(() => expect(started.kernel.opened).toEqual([AUTHORIZE_URL, AUTHORIZE_URL]));
    expect(requests(started.kernel, CONNECT)).toHaveLength(1);
  });

  it("cancels the open window when the screen goes away", async () => {
    const started = await start();
    await connectClickup(started);
    cleanup();
    await waitFor(() => expect(requests(started.kernel, CANCEL)).toHaveLength(1));
  });
});

describe("a connect that ends refused (S1)", () => {
  it("is one refused state for any non-2xx answer, with the error code and the kernel's message as plain text, never markup", async () => {
    const started = await start();
    const markup = "<img src=x onerror=alert(1)>";
    started.answer.connect = () => refused(502, { error: "discovery_failed", message: markup });
    select(IDS.rowJira);
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(state()).toBe("refused"));
    const view = screen.getByTestId(IDS.mcpRefused);
    expect(view.getAttribute("data-refusal")).toBe("discovery_failed");
    expect(view.textContent).toContain("Studio couldn't connect Jira (discovery_failed).");
    expect(screen.getByTestId(IDS.mcpRefusedMessage).textContent).toBe(markup);
    expect(screen.getByTestId(IDS.mcp).querySelector("img")).toBeNull();
    // Nothing was opened, and no window is left to cancel.
    expect(started.kernel.opened).toEqual([]);
    expect(requests(started.kernel, CANCEL)).toHaveLength(0);
  });

  it("gives authorization_denied and window_expired a sentence each, from the feed", async () => {
    const started = await start();
    await connectClickup(started);
    emit(started.kernel, "connector_status", { connector_id: 2, kind: "clickup", status: null, refused: "authorization_denied" });
    await waitFor(() => expect(state()).toBe("refused"));
    expect(screen.getByTestId(IDS.mcpRefused).textContent).toContain("ClickUp didn't grant access (authorization_denied). You chose Deny there");

    fireEvent.click(screen.getByTestId(IDS.mcpRetry));
    await waitFor(() => expect(screen.getByTestId(IDS.mcpWait).getAttribute("data-phase")).toBe("waiting"));
    expect(requests(started.kernel, CONNECT)).toHaveLength(2);
    emit(started.kernel, "connector_status", { connector_id: 2, kind: "clickup", status: null, refused: "window_expired" });
    await waitFor(() => expect(state()).toBe("refused"));
    expect(screen.getByTestId(IDS.mcpRefused).textContent).toContain("(window_expired) before ClickUp came back to Studio");
  });

  it("gives every other code the generic sentence plus the code, and ignores a refusal that is another kind's", async () => {
    const started = await start();
    await connectClickup(started);
    emit(started.kernel, "connector_status", { connector_id: 1, kind: "jira", status: null, refused: "token_exchange_failed" });
    await sleep(100);
    expect(state()).toBe("connecting");
    emit(started.kernel, "connector_status", { connector_id: 2, kind: "clickup", status: null, refused: "token_exchange_failed" });
    await waitFor(() => expect(state()).toBe("refused"));
    expect(screen.getByTestId(IDS.mcpRefused).textContent).toContain("Studio couldn't connect ClickUp (token_exchange_failed).");
  });

  it("ends in the same refused state when the window's expires_at passes", async () => {
    const started = await start();
    started.answer.connect = () => ok({ authorize_url: AUTHORIZE_URL, expires_at: inSeconds(0.2) });
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(state()).toBe("refused"), { timeout: 3000 });
    expect(screen.getByTestId(IDS.mcpRefused).getAttribute("data-refusal")).toBe("window_expired");
  });

  it("treats an address the system browser would not open as a refusal, and closes the window it opened", async () => {
    const started = await start();
    started.kernel.openAnswer = () => false;
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(state()).toBe("refused"));
    expect(screen.getByTestId(IDS.mcpRefused).getAttribute("data-refusal")).toBe("not_opened");
    await waitFor(() => expect(requests(started.kernel, CANCEL)).toHaveLength(1));
  });

  it("treats an answer with no authorize_url as a refusal and closes the window it opened", async () => {
    const started = await start();
    started.answer.connect = () => ok({ authorize_url: "", expires_at: inSeconds(600) });
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(state()).toBe("refused"));
    expect(screen.getByTestId(IDS.mcpRefused).getAttribute("data-refusal")).toBe("not_opened");
    await waitFor(() => expect(requests(started.kernel, CANCEL)).toHaveLength(1));
    expect(started.kernel.opened).toEqual([]);
  });

  it("says the kernel could not be asked when the connect call never reaches it", async () => {
    const started = await start();
    started.answer.connect = () => UNREACHABLE;
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(state()).toBe("refused"));
    expect(screen.getByTestId(IDS.mcpRefused).getAttribute("data-refusal")).toBe("unanswered");
    expect(screen.getByTestId(IDS.mcpRefused).textContent).toContain("couldn't reach the kernel to connect ClickUp");
    expect(screen.queryByTestId(IDS.mcpRefusedMessage)).toBeNull();
  });

  it("refuses when 'Open ClickUp again' cannot open the address, and closes the window", async () => {
    const started = await start();
    await connectClickup(started);
    started.kernel.openAnswer = () => false;
    fireEvent.click(screen.getByTestId(IDS.mcpOpenAgain));
    await waitFor(() => expect(state()).toBe("refused"));
    await waitFor(() => expect(requests(started.kernel, CANCEL)).toHaveLength(1));
  });

  it("cancels the window a late answer opens when the screen has gone away, and opens nothing", async () => {
    const started = await start();
    const slow = deferred<ReturnType<typeof ok>>();
    started.answer.connect = () => slow.promise;
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(requests(started.kernel, CONNECT)).toHaveLength(1));
    cleanup();
    expect(requests(started.kernel, CANCEL)).toHaveLength(0);
    await act(async () => slow.resolve(ok({ authorize_url: AUTHORIZE_URL, expires_at: inSeconds(600) })));
    await waitFor(() => expect(requests(started.kernel, CANCEL)).toHaveLength(1));
    expect(started.kernel.opened).toEqual([]);
  });

  it("Close leaves the refused state, and Try again makes a new connect call", async () => {
    const started = await start();
    started.answer.connect = () => refused(409, { error: "connect_in_progress", message: "a connect window is already open" });
    select(IDS.rowJira);
    fireEvent.click(screen.getByTestId(IDS.mcpConnect));
    await waitFor(() => expect(state()).toBe("refused"));
    fireEvent.click(screen.getByTestId(IDS.mcpRetry));
    await waitFor(() => expect(requests(started.kernel, CONNECT)).toHaveLength(2));
    await waitFor(() => expect(state()).toBe("refused"));
    fireEvent.click(screen.getByTestId(IDS.mcpDismiss));
    expect(state()).toBe("none");
  });
});

describe("a connected or expired MCP row (S1)", () => {
  it("shows the workspace, the tools, and which crew member holds each (Wright's per-tool grant is unknown, not 'not granted')", async () => {
    const wrightWithClickup = agent("wright", "Wright", ["clickup"]);
    const mason = agent("mason", "Mason", ["github", "clickup"]);
    const pim = agent("pim", "Pim", []);
    const started = await start(
      {
        mcp: [mcpRow("clickup")],
        details: { mason: detailOf(mason, { clickup: ["get_task", "search_tasks"] }) },
      },
      [wrightWithClickup, mason, pim],
    );
    select(IDS.rowClickup);
    await waitFor(() => expect(requests(started.kernel, "GET /agents/:id")).toEqual([{ method: "GET", path: "/agents/:id", params: { id: "mason" } }]));
    const cell = (tool: string, id: string): string | null => {
      const row = screen.getAllByTestId(IDS.mcpTool).find((r) => r.getAttribute("data-tool") === tool);
      return within(row as HTMLElement).getAllByTestId(IDS.mcpToolCell).find((c) => c.getAttribute("data-agent-id") === id)?.getAttribute("data-state") ?? null;
    };
    await waitFor(() => expect(cell("get_task", "mason")).toBe("granted"));
    expect(cell("search_tasks", "mason")).toBe("granted");
    expect(cell("update_task", "mason")).toBe("not_granted");
    expect(cell("get_task", "pim")).toBe("not_granted");
    expect(cell("get_task", "wright")).toBe("unknown");
    expect(screen.getByTestId(IDS.mcpTeam).getAttribute("href")).toBe("#/team");
    expect(screen.getByTestId(IDS.mcpTools).closest("section")?.textContent).toContain("Wright's per-tool grant is read in Team");
    // Studio shows no "Read / Changes things" badge the contract cannot back.
    expect(screen.getByTestId(IDS.mcpTools).textContent).not.toMatch(/Changes things/);
  });

  it("reads a crew member's tools as unknown, not 'not granted', when its detail cannot be read", async () => {
    const mason = agent("mason", "Mason", ["clickup"]);
    await start({ mcp: [mcpRow("clickup")] }, [WRIGHT, mason]);
    select(IDS.rowClickup);
    await waitFor(() => expect(screen.getAllByTestId(IDS.mcpToolCell).length).toBeGreaterThan(0));
    await sleep(50);
    const masonCells = screen.getAllByTestId(IDS.mcpToolCell).filter((c) => c.getAttribute("data-agent-id") === "mason");
    expect(masonCells.map((c) => c.getAttribute("data-state"))).toEqual(["unknown", "unknown", "unknown"]);
  });

  it("an expired connection has its own copy, a Reconnect, and Disconnect", async () => {
    const started = await start({ mcp: [mcpRow("clickup", "expired")] });
    select(IDS.rowClickup);
    expect(state()).toBe("expired");
    expect(screen.getByTestId(IDS.mcpExpired).textContent).toContain("ClickUp no longer accepts Studio's token");
    expect(screen.getByTestId(IDS.rowClickup).textContent).toContain("expired");
    expect(screen.getByTestId(IDS.mcpDisconnect)).toBeTruthy();
    fireEvent.click(screen.getByTestId(IDS.mcpReconnect));
    await waitFor(() => expect(requests(started.kernel, CONNECT)).toHaveLength(1));
    expect(requests(started.kernel, CONNECT)[0]?.params).toEqual({ kind: "clickup" });
  });

  it("Disconnect asks first, then calls POST …/disconnect once and re-reads the connectors", async () => {
    const started = await start({ mcp: [mcpRow("clickup")] });
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpDisconnect));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Disconnect ClickUp?");
    expect(screen.getByTestId(IDS.mcpDisconnectConfirm).textContent).toContain("Studio can't remove its access at ClickUp.");
    expect(requests(started.kernel, DISCONNECT)).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(requests(started.kernel, DISCONNECT)).toHaveLength(0);

    fireEvent.click(screen.getByTestId(IDS.mcpDisconnect));
    started.world.mcp = [mcpRow("clickup", "disconnected", { granted_tools: [] })];
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(requests(started.kernel, DISCONNECT)).toHaveLength(1));
    expect(requests(started.kernel, DISCONNECT)).toEqual([{ method: "POST", path: "/connectors/mcp/:kind/disconnect", params: { kind: "clickup" } }]);
    await waitFor(() => expect(state()).toBe("none"));
  });

  it("Escape leaves the Disconnect confirm without sending, and the confirm closes if the row goes away", async () => {
    const started = await start({ mcp: [mcpRow("clickup")] });
    await feedLive(started.kernel);
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpDisconnect));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(requests(started.kernel, DISCONNECT)).toHaveLength(0);

    fireEvent.click(screen.getByTestId(IDS.mcpDisconnect));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    started.world.mcp = [];
    emit(started.kernel, "connector_status", { kind: "clickup", status: "disconnected" });
    await waitFor(() => expect(state()).toBe("none"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requests(started.kernel, DISCONNECT)).toHaveLength(0);
  });

  it("says why when a disconnect is refused, and changes nothing", async () => {
    const started = await start({ mcp: [mcpRow("clickup")] });
    started.answer.disconnect = () => refused(500, { error: "keychain_failed", message: "the connector's Keychain item could not be changed; nothing else changed" });
    select(IDS.rowClickup);
    fireEvent.click(screen.getByTestId(IDS.mcpDisconnect));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(screen.getByTestId(IDS.mcpNotice).textContent).toContain("Couldn't disconnect ClickUp"));
    expect(state()).toBe("connected");
  });

  it("Jira always carries the 'Work account · stub only' note, and ClickUp does not", async () => {
    await start({ mcp: [mcpRow("jira")] });
    select(IDS.rowJira);
    expect(screen.getByTestId(IDS.mcpStub).textContent).toContain("Work account · stub only");
    select(IDS.rowClickup);
    expect(screen.queryByTestId(IDS.mcpStub)).toBeNull();
    // The not-connected Jira pane carries it too.
    cleanup();
    await start();
    select(IDS.rowJira);
    expect(screen.getByTestId(IDS.mcpStub)).toBeTruthy();
  });

  it("only one kind connects at a time: the kernel's window is single", async () => {
    const started = await start();
    await connectClickup(started);
    select(IDS.rowJira);
    expect((screen.getByTestId(IDS.mcpConnect) as HTMLButtonElement).disabled).toBe(true);
    expect(requests(started.kernel, CONNECT)).toHaveLength(1);
  });
});

// ---- R2, S2: the App upgrade ----------------------------------------------------------------------------------

describe("the GitHub App's 'needs new permissions' (R2, S2)", () => {
  const needs = () => [appConnector("needs_permissions")];

  it("shows the upgrade view over the connected App detail, and its button opens exactly the url the kernel returned", async () => {
    const started = await start({ connectors: needs() });
    await waitFor(() => expect(screen.getByTestId(IDS.upgrade)).toBeTruthy());
    expect(screen.getByTestId(IDS.detail).getAttribute("data-method")).toBe("app");
    expect(screen.getByTestId(IDS.upgrade).textContent).toContain("Needs new permissions");
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("needs new permissions · octo-owner · GitHub App");
    await waitFor(() => expect((screen.getByTestId(IDS.upgradeAccept) as HTMLButtonElement).disabled).toBe(false));
    expect(requests(started.kernel, UPGRADE)).toEqual([{ method: "GET", path: "/connectors/github/app/upgrade" }]);
    expect(screen.getByTestId(IDS.upgradeAddress).textContent).toBe(UPGRADE_URL);
    fireEvent.click(screen.getByTestId(IDS.upgradeAccept));
    await waitFor(() => expect(started.kernel.opened).toEqual([UPGRADE_URL]));
    // Studio changes nothing on GitHub: no write was sent.
    expect(started.kernel.fake.requests.filter((r) => r.req.method !== "GET")).toEqual([]);
  });

  it("states that session tokens are down-scoped to Pull requests, Contents, Issues and Checks", async () => {
    await start({ connectors: needs() });
    await waitFor(() => expect(screen.getByTestId(IDS.upgradeScope)).toBeTruthy());
    expect(screen.getByTestId(IDS.upgradeScope).textContent).toContain("Pull requests, Contents, Issues and Checks");
    expect(within(screen.getByTestId(IDS.upgrade)).getByRole("list", { name: "What a session token holds" }).textContent).toBe("Pull requestsContentsIssuesChecks");
  });

  it("returns to the connected App detail with no reload when a later read shows the App connected", async () => {
    const started = await start({ connectors: needs() });
    await waitFor(() => expect(screen.getByTestId(IDS.upgrade)).toBeTruthy());
    await feedLive(started.kernel);
    started.world.connectors = [appConnector("connected")];
    emit(started.kernel, "connector_status", { kind: "github", status: "connected" });
    await waitFor(() => expect(screen.queryByTestId(IDS.upgrade)).toBeNull());
    expect(screen.getByTestId(IDS.detail).getAttribute("data-method")).toBe("app");
    expect(screen.getByTestId(IDS.status).textContent).toContain("connected");
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("connected · octo-owner · GitHub App");
  });

  it("Check now re-reads the connectors", async () => {
    const started = await start({ connectors: needs() });
    await waitFor(() => expect((screen.getByTestId(IDS.upgradeAccept) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId(IDS.upgradeCheck));
    await waitFor(() => expect(requests(started.kernel, "GET /connectors")).toHaveLength(2));
    await waitFor(() => expect(requests(started.kernel, UPGRADE)).toHaveLength(2));
  });

  it("says so when the system browser would not open the address, and when the kernel gave none", async () => {
    const started = await start({ connectors: needs() });
    started.kernel.openAnswer = () => false;
    await waitFor(() => expect((screen.getByTestId(IDS.upgradeAccept) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId(IDS.upgradeAccept));
    await waitFor(() => expect(screen.getByTestId(IDS.upgradeError).textContent).toContain("couldn't open that address"));
    cleanup();

    await start({ connectors: needs(), upgradeUrl: null });
    await waitFor(() => expect(screen.getByTestId(IDS.upgradeError).textContent).toContain("no address to accept at"));
    expect((screen.getByTestId(IDS.upgradeAccept) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a failed upgrade read inside its own section, never the screen's read error", async () => {
    const started = await start({ connectors: needs() });
    await waitFor(() => expect((screen.getByTestId(IDS.upgradeAccept) as HTMLButtonElement).disabled).toBe(false));
    started.answer.upgrade = () => refused(502, { error: "github_failed", message: "GitHub did not answer" });
    fireEvent.click(screen.getByTestId(IDS.upgradeCheck));
    await waitFor(() => expect(screen.getByTestId(IDS.upgradeError).textContent).toContain("GitHub did not answer"));
    expect(screen.queryByTestId(IDS.readError)).toBeNull();
  });

  it("is absent for a connected App, and the upgrade address is never read", async () => {
    const started = await start({ connectors: [appConnector("connected")] });
    expect(screen.queryByTestId(IDS.upgrade)).toBeNull();
    expect(requests(started.kernel, UPGRADE)).toHaveLength(0);
  });
});

// ---- R3, R4, S3: the repo policy card -------------------------------------------------------------------------

describe("the repo policy pane and its empty state (R5)", () => {
  it("reads GET /repos/policy when the pane is first opened, not on mount, and shows 'No repos reached yet.' when there are none", async () => {
    const started = await start();
    await sleep(50);
    expect(requests(started.kernel, POLICIES)).toHaveLength(0);
    expect(screen.getByTestId(IDS.rowPolicy).textContent).toContain("open to read the repos");
    select(IDS.rowPolicy);
    await waitFor(() => expect(screen.getByTestId(IDS.policyEmpty).textContent).toContain("No repos reached yet."));
    expect(requests(started.kernel, POLICIES)).toHaveLength(1);
    expect(screen.getByTestId(IDS.rowPolicy).textContent).toContain("no repos reached yet");
    // Leaving the pane and coming back does not read again.
    select(IDS.listRow);
    select(IDS.rowPolicy);
    await sleep(50);
    expect(requests(started.kernel, POLICIES)).toHaveLength(1);
  });

  it("lists a chip per reached repo and one card for the selected one", async () => {
    await start({ policies: [policyOf("octo-owner/site"), policyOf("octo-owner/docs", { kind: "solo", set_by: "owner", set_at: new Date().toISOString() })] });
    await openPolicy();
    await waitFor(() => expect(screen.getAllByTestId(IDS.policyChip).map((c) => c.textContent)).toEqual(["octo-owner/site", "octo-owner/docs"]));
    expect(screen.getByTestId(IDS.rowPolicy).textContent).toContain("1 of 2 repos set");
    expect(screen.getByTestId(IDS.policyCard).getAttribute("data-repo")).toBe("octo-owner/site");
    fireEvent.click(screen.getAllByTestId(IDS.policyChip)[1] as HTMLElement);
    expect(screen.getByTestId(IDS.policyCard).getAttribute("data-repo")).toBe("octo-owner/docs");
    expect(screen.getByTestId(IDS.policyCurrent).textContent).toContain("Solo");
  });

  it("keeps a failed policy read inside the policy pane, never the screen's read error", async () => {
    const kernel = createKernel({ connectors: () => ok({ connectors: [] }) });
    // The other suites' fake kernel answers no policy route at all (404).
    await mountScreen(kernel);
    expect(requests(kernel, POLICIES)).toHaveLength(0);
    select(IDS.rowPolicy);
    await waitFor(() => expect(screen.getByTestId(IDS.policyError).textContent).toContain("Couldn't read the repo policies"));
    expect(screen.getByTestId(IDS.rowPolicy).textContent).toBe("Repo policystatus unknown");
    expect(screen.queryByTestId(IDS.readError)).toBeNull();
    select(IDS.listRow);
    expect(screen.getByTestId(IDS.empty)).toBeTruthy();
  });
});

describe("a card for a detected repo (S3)", () => {
  const SITE = "octo-owner/site";

  const pane = async (policy: RepoPolicy, init: Partial<World> = {}) => {
    const started = await start({ policies: [policy], ...init });
    await openPolicy();
    return started;
  };
  const bodiesOf = (kernel: Kernel, key: string) => requests(kernel, key).map((r) => r.body);

  it("shows the detection: protection, required reviews, required checks, who can push and when it was read", async () => {
    await pane(policyOf(SITE));
    const detected = screen.getByTestId(IDS.policyDetected);
    expect(within(detected).getByText("Branch protection").nextElementSibling?.textContent).toContain("On, on main");
    expect(within(detected).getByText("Required reviews").nextElementSibling?.textContent).toContain("1 approving review");
    expect(within(detected).getByText("Required checks").nextElementSibling?.textContent).toContain("ci");
    expect(within(detected).getByText("Who can push").nextElementSibling?.textContent).toContain("octo-owner, octo-dev");
    expect(detected.textContent).toContain("read today");
  });

  it("a repo with kind null and a detection shows 'No policy: PRs park'", async () => {
    await pane(policyOf(SITE));
    expect(screen.getByTestId(IDS.policyNone).textContent).toBe("No policy: PRs park");
    expect(screen.getByTestId(IDS.policyStatus).textContent).toContain("PRs on this repo park");
  });

  it("sends nothing on mount or on choosing a preset: a write is one press of a button", async () => {
    const started = await pane(policyOf(SITE));
    fireEvent.click(screen.getAllByTestId(IDS.policyPreset)[0] as HTMLElement);
    expect(started.kernel.fake.requests.filter((r) => r.req.method !== "GET")).toEqual([]);
  });

  it.each([
    ["solo", "Solo", { kind: "solo" }],
    ["studio_approval", "Approve in Studio", { kind: "studio_approval" }],
  ] as const)("the %s preset sends one POST /repos/policy/:owner/:repo with just its kind", async (kind, _label, body) => {
    const started = await pane(policyOf(SITE));
    const radio = screen.getAllByTestId(IDS.policyPreset).find((r) => r.getAttribute("data-kind") === kind) as HTMLElement;
    fireEvent.click(radio);
    fireEvent.click(screen.getByTestId(IDS.policySet));
    await waitFor(() => expect(requests(started.kernel, SET_POLICY)).toHaveLength(1));
    expect(requests(started.kernel, SET_POLICY)).toEqual([{ method: "POST", path: "/repos/policy/:owner/:repo", params: { owner: "octo-owner", repo: "site" }, body }]);
    await waitFor(() => expect(screen.getByTestId(IDS.policyCurrent)).toBeTruthy());
    expect(screen.getByTestId(IDS.policyCurrent).textContent).toContain(kind === "solo" ? "Solo" : "Approve in Studio");
  });

  it("N GitHub reviews needs a whole number from 1 up, and sends it as required", async () => {
    const started = await pane(policyOf(SITE));
    fireEvent.click(screen.getAllByTestId(IDS.policyPreset).find((r) => r.getAttribute("data-kind") === "reviews") as HTMLElement);
    const set = screen.getByTestId(IDS.policySet) as HTMLButtonElement;
    expect(set.disabled).toBe(true);
    const n = screen.getByTestId(IDS.policyReviews) as HTMLInputElement;
    for (const bad of ["0", "-1", "1.5", "two", "1000"]) {
      fireEvent.change(n, { target: { value: bad } });
      expect(set.disabled).toBe(true);
    }
    fireEvent.change(n, { target: { value: "3" } });
    expect(set.disabled).toBe(false);
    fireEvent.click(set);
    await waitFor(() => expect(requests(started.kernel, SET_POLICY)).toHaveLength(1));
    expect(bodiesOf(started.kernel, SET_POLICY)).toStrictEqual([{ kind: "reviews", required: 3 }]);
  });

  it("Re-detect sends one POST …/detect and shows the new detection", async () => {
    const started = await pane(policyOf(SITE, { detected: detection({ protection: "unprotected", required_reviews: null, required_checks: [] }) }));
    expect(screen.getByTestId(IDS.policyDetected).textContent).toContain("None on main");
    started.world.policies = [policyOf(SITE)];
    fireEvent.click(screen.getByTestId(IDS.policyRedetect));
    await waitFor(() => expect(requests(started.kernel, DETECT)).toHaveLength(1));
    expect(requests(started.kernel, DETECT)).toEqual([{ method: "POST", path: "/repos/policy/:owner/:repo/detect", params: { owner: "octo-owner", repo: "site" } }]);
    await waitFor(() => expect(screen.getByTestId(IDS.policyDetected).textContent).toContain("On, on main"));
    // Detecting is a read of GitHub: no policy was set.
    expect(requests(started.kernel, SET_POLICY)).toHaveLength(0);
  });

  it("says why when a write is refused, and sets nothing", async () => {
    const started = await pane(policyOf(SITE));
    started.answer.set = () => refused(409, { error: "policy_refused", message: "the kernel said no" });
    fireEvent.click(screen.getAllByTestId(IDS.policyPreset)[0] as HTMLElement);
    fireEvent.click(screen.getByTestId(IDS.policySet));
    await waitFor(() => expect(screen.getByTestId(IDS.policyNotice).textContent).toContain("Couldn't set the policy: the kernel said no"));
    expect(screen.queryByTestId(IDS.policyCurrent)).toBeNull();
  });

  it("with the kernel unreachable every write is off", async () => {
    const started = await pane(policyOf(SITE));
    await feedLive(started.kernel);
    started.kernel.connectors = () => UNREACHABLE;
    emit(started.kernel, "connector_status");
    await waitFor(() => expect(screen.getByTestId(IDS.band)).toBeTruthy());
    expect((screen.getByTestId(IDS.policyRedetect) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(IDS.policySet) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("changing a policy that is set (S3)", () => {
  const SITE = "octo-owner/site";

  it("Change policy shows the presets again, and a new pick sends one POST; Keep it as it is sends nothing", async () => {
    const started = await start({ policies: [policyOf(SITE, { kind: "solo", set_by: "owner", set_at: new Date().toISOString() })] });
    await openPolicy();
    expect(screen.queryAllByTestId(IDS.policyPreset)).toHaveLength(0);
    expect(screen.getByTestId(IDS.policyCurrent).textContent).toContain("set by owner");
    fireEvent.click(screen.getByTestId(IDS.policyChange));
    expect(screen.getAllByTestId(IDS.policyPreset)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Keep it as it is" }));
    expect(screen.queryAllByTestId(IDS.policyPreset)).toHaveLength(0);
    expect(requests(started.kernel, SET_POLICY)).toHaveLength(0);

    fireEvent.click(screen.getByTestId(IDS.policyChange));
    fireEvent.click(screen.getAllByTestId(IDS.policyPreset).find((r) => r.getAttribute("data-kind") === "studio_approval") as HTMLElement);
    fireEvent.click(screen.getByTestId(IDS.policySet));
    await waitFor(() => expect(requests(started.kernel, SET_POLICY)).toHaveLength(1));
    expect(requests(started.kernel, SET_POLICY)[0]?.body).toStrictEqual({ kind: "studio_approval" });
    await waitFor(() => expect(screen.getByTestId(IDS.policyCurrent).textContent).toContain("Approve in Studio"));
  });

  it("re-reads GET /repos/policy on a connector_status event once it has been opened, so a newly reached repo appears", async () => {
    const started = await start();
    await feedLive(started.kernel);
    select(IDS.rowPolicy);
    await waitFor(() => expect(screen.getByTestId(IDS.policyEmpty)).toBeTruthy());
    expect(requests(started.kernel, POLICIES)).toHaveLength(1);
    started.world.policies = [policyOf(SITE)];
    emit(started.kernel, "connector_status", { kind: "github", status: "connected" });
    await waitFor(() => expect(requests(started.kernel, POLICIES)).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId(IDS.rowPolicy).textContent).toContain("0 of 1 repos set"));
  });

  it("does not read twice for an event that was in the feed before the pane opened", async () => {
    const started = await start();
    await feedLive(started.kernel);
    emit(started.kernel, "connector_status", { kind: "github", status: "connected" });
    await waitFor(() => expect(requests(started.kernel, "GET /connectors")).toHaveLength(2));
    select(IDS.rowPolicy);
    await sleep(500);
    expect(requests(started.kernel, POLICIES)).toHaveLength(1);
  });

  it("'Don't trust it' goes back to the three ways without sending", async () => {
    const started = await start({ policies: [unenforceable()] });
    await openPolicy();
    fireEvent.click(screen.getByTestId(IDS.policyTrust));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Trust unprotected" }));
    expect(screen.getByTestId(IDS.policyTrusting)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Don't trust it" }));
    expect(screen.getByTestId(IDS.policyChoices)).toBeTruthy();
    expect(screen.queryAllByTestId(IDS.policyPreset)).toHaveLength(0);
    expect(started.kernel.fake.requests.filter((r) => r.req.method !== "GET")).toEqual([]);
  });
});

describe("Accept on a proposal (R4)", () => {
  const TEAM = "octo-owner/team-service";

  it("sends exactly one POST with {kind: proposal.kind} for a solo proposal", async () => {
    const started = await start({ policies: [policyOf(TEAM, { proposal: { kind: "solo", required_reviews: null } })] });
    await openPolicy();
    expect(screen.getByTestId(IDS.policyProposal).textContent).toContain("Solo");
    fireEvent.click(screen.getByTestId(IDS.policyAccept));
    await waitFor(() => expect(requests(started.kernel, SET_POLICY)).toHaveLength(1));
    expect(requests(started.kernel, SET_POLICY)).toStrictEqual([{ method: "POST", path: "/repos/policy/:owner/:repo", params: { owner: "octo-owner", repo: "team-service" }, body: { kind: "solo" } }]);
  });

  it("adds required: proposal.required_reviews when the kind is reviews, and a double press sends one", async () => {
    const started = await start({ policies: [policyOf(TEAM, { proposal: { kind: "reviews", required_reviews: 2 } })] });
    await openPolicy();
    expect(screen.getByTestId(IDS.policyProposal).textContent).toContain("2 GitHub reviews");
    const accept = screen.getByTestId(IDS.policyAccept);
    fireEvent.click(accept);
    fireEvent.click(accept);
    await waitFor(() => expect(requests(started.kernel, SET_POLICY)).toHaveLength(1));
    await sleep(50);
    expect(requests(started.kernel, SET_POLICY)).toStrictEqual([{ method: "POST", path: "/repos/policy/:owner/:repo", params: { owner: "octo-owner", repo: "team-service" }, body: { kind: "reviews", required: 2 } }]);
    await waitFor(() => expect(screen.getByTestId(IDS.policyCurrent).textContent).toContain("2 GitHub reviews"));
  });

  it("offers no Accept where the detection made no proposal", async () => {
    await start({ policies: [policyOf(TEAM)] });
    await openPolicy();
    expect(screen.queryByTestId(IDS.policyAccept)).toBeNull();
  });
});

describe("a repo GitHub cannot protect (R3)", () => {
  const SCRATCH = "octo-owner/scratch";
  const open = async (init: Partial<World> = {}) => {
    const started = await start({ policies: [unenforceable(SCRATCH)], ...init });
    await openPolicy();
    return started;
  };
  const writes = (kernel: Kernel) => kernel.fake.requests.filter((r) => r.req.method !== "GET");

  it("offers exactly Make public / Upgrade, Trust unprotected and Safe mode, and no preset", async () => {
    await open();
    const ways = within(screen.getByTestId(IDS.policyChoices)).getByRole("list", { name: "Ways to go on" });
    expect(within(ways).getAllByRole("listitem").map((li) => li.getAttribute("data-choice"))).toEqual(["make_public_or_upgrade", "trust_unprotected", "safe_mode"]);
    expect(screen.getByTestId(IDS.policyMakePublic).textContent).toBe("Make public on GitHub");
    expect(screen.getByTestId(IDS.policyUpgrade).textContent).toBe("Upgrade on GitHub");
    expect(screen.getByTestId(IDS.policyTrust).textContent).toBe("Trust unprotected…");
    expect(screen.getByTestId(IDS.policySafe).textContent).toBe("Use safe mode");
    expect(screen.queryAllByTestId(IDS.policyPreset)).toHaveLength(0);
    expect(screen.queryByTestId(IDS.policyAccept)).toBeNull();
    expect(screen.queryByTestId(IDS.policySet)).toBeNull();
  });

  it("offers only the choices the proposal names", async () => {
    await start({ policies: [policyOf(SCRATCH, { detected: detection({ protection: "protection_unavailable" }), proposal: { kind: null, required_reviews: null, choices: ["safe_mode", "trust_unprotected"] } })] });
    await openPolicy();
    expect(within(screen.getByTestId(IDS.policyChoices)).getAllByRole("listitem").map((li) => li.getAttribute("data-choice"))).toEqual(["trust_unprotected", "safe_mode"]);
  });

  it("Trust unprotected sends nothing until a confirm naming what it waives is confirmed, and Cancel sends nothing", async () => {
    const started = await open();
    fireEvent.click(screen.getByTestId(IDS.policyTrust));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(`Trust ${SCRATCH} unprotected?`);
    expect(screen.getByTestId(IDS.policyTrustConfirm).textContent).toContain("Waives condition 4 only");
    expect(screen.getByTestId(IDS.policyTrustConfirm).textContent).toContain("Does not waive the high-risk park");
    expect(writes(started.kernel)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(writes(started.kernel)).toEqual([]);
    expect(screen.queryAllByTestId(IDS.policyPreset)).toHaveLength(0);
  });

  it("Escape leaves the confirm without sending", async () => {
    const started = await open();
    fireEvent.click(screen.getByTestId(IDS.policyTrust));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(writes(started.kernel)).toEqual([]);
  });

  it("after the confirm the owner picks a preset, and Set policy sends {kind: <the preset>, trust_unprotected: true} once", async () => {
    const started = await open();
    fireEvent.click(screen.getByTestId(IDS.policyTrust));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Trust unprotected" }));
    // The confirm is only the owner's yes: nothing is sent until a preset is picked and Set policy is pressed.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(writes(started.kernel)).toEqual([]);
    expect(screen.getByTestId(IDS.policyTrusting)).toBeTruthy();
    // GitHub cannot enforce reviews here, so that preset is off.
    const radios = screen.getAllByTestId(IDS.policyPreset) as HTMLInputElement[];
    expect(radios.map((r) => [r.getAttribute("data-kind"), r.disabled])).toEqual([
      ["solo", false],
      ["studio_approval", false],
      ["reviews", true],
    ]);
    fireEvent.click(radios[1] as HTMLElement);
    fireEvent.click(screen.getByTestId(IDS.policySet));
    await waitFor(() => expect(requests(started.kernel, SET_POLICY)).toHaveLength(1));
    expect(requests(started.kernel, SET_POLICY)).toStrictEqual([
      { method: "POST", path: "/repos/policy/:owner/:repo", params: { owner: "octo-owner", repo: "scratch" }, body: { kind: "studio_approval", trust_unprotected: true } },
    ]);
    await waitFor(() => expect(screen.getByTestId(IDS.policyCurrent).textContent).toContain("Unprotected, for this repo only"));
  });

  it("Safe mode sends no POST, leaves the repo with no policy and says its PRs park", async () => {
    const started = await open();
    fireEvent.click(screen.getByTestId(IDS.policySafe));
    expect(writes(started.kernel)).toEqual([]);
    expect(screen.getByTestId(IDS.policySafeView).textContent).toContain("the repo stays with no policy, so its PRs park");
    expect(screen.getByTestId(IDS.policyNone)).toBeTruthy();
    expect(screen.getByTestId(IDS.policyStatus).textContent).toContain("Safe mode");
    fireEvent.click(screen.getByTestId(IDS.policySafeAgain));
    expect(screen.getByTestId(IDS.policyChoices)).toBeTruthy();
  });

  it("Make public / Upgrade are two links through the open-external channel: the repo's settings page and the plans page, no POST", async () => {
    const started = await open();
    fireEvent.click(screen.getByTestId(IDS.policyMakePublic));
    await waitFor(() => expect(started.kernel.opened).toEqual(["https://github.com/octo-owner/scratch/settings"]));
    fireEvent.click(screen.getByTestId(IDS.policyUpgrade));
    await waitFor(() => expect(started.kernel.opened).toEqual(["https://github.com/octo-owner/scratch/settings", "https://github.com/settings/billing/plans"]));
    expect(writes(started.kernel)).toEqual([]);
  });

  it("shows a failure line, never a silent no-op, when the channel answers false", async () => {
    const started = await open();
    started.kernel.openAnswer = () => false;
    fireEvent.click(screen.getByTestId(IDS.policyUpgrade));
    await waitFor(() => expect(screen.getByTestId(IDS.policyLinkError).textContent).toContain("couldn't open GitHub's plans page"));
    fireEvent.click(screen.getByTestId(IDS.policyMakePublic));
    await waitFor(() => expect(screen.getByTestId(IDS.policyLinkError).textContent).toContain("couldn't open the repo's settings"));
  });

  it("never builds a settings link from a repo name that is not GitHub's shape", async () => {
    const started = await start({ policies: [unenforceable("octo owner/scratch?x=1")] });
    await openPolicy();
    fireEvent.click(screen.getByTestId(IDS.policyMakePublic));
    await waitFor(() => expect(screen.getByTestId(IDS.policyLinkError)).toBeTruthy());
    expect(started.kernel.opened).toEqual([]);
  });
});

// ---- R5: nothing connected ------------------------------------------------------------------------------------

describe("with no connector at all (R5)", () => {
  it("keeps the GitHub empty state and its Connect, and lists Jira and ClickUp as not connected with one Connect each", async () => {
    const started = await start();
    expect(screen.getByTestId(IDS.empty).textContent).toContain("Connect GitHub so a playbook can read your PRs.");
    expect(screen.getByRole("button", { name: "Connect GitHub" })).toBeTruthy();
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("not connected");
    expect(screen.getByTestId(IDS.rowJira).textContent).toContain("not connected");
    expect(screen.getByTestId(IDS.rowClickup).textContent).toContain("not connected");
    select(IDS.rowJira);
    expect(screen.getAllByRole("button", { name: "Connect Jira" })).toHaveLength(1);
    select(IDS.rowClickup);
    expect(screen.getAllByRole("button", { name: "Connect ClickUp" })).toHaveLength(1);
    // Mounting writes nothing and reads each phase 8 route at most once.
    expect(started.kernel.fake.requests.filter((r) => r.req.method !== "GET")).toEqual([]);
    expect(requests(started.kernel, POLICIES)).toHaveLength(0);
    expect(requests(started.kernel, UPGRADE)).toHaveLength(0);
  });

  it("reads a connectors answer with no mcp_connections field as no MCP row", async () => {
    const kernel = createKernel({ connectors: () => ok({ connectors: [] }) });
    await mountScreen(kernel);
    expect(screen.getByTestId(IDS.rowJira).textContent).toContain("not connected");
    expect(screen.getByTestId(IDS.rowClickup).textContent).toContain("not connected");
  });

  it("selecting GitHub's row returns to GitHub's pane", async () => {
    await start();
    select(IDS.rowJira);
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    select(IDS.listRow);
    expect(screen.getByTestId(IDS.empty)).toBeTruthy();
    expect(screen.getByTestId(IDS.listRow).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId(IDS.rowJira).getAttribute("aria-selected")).toBe("false");
  });
});

// ---- The list is one tab stop ---------------------------------------------------------------------------------

describe("the connector list by keyboard", () => {
  const rows = [IDS.listRow, IDS.rowPolicy, IDS.rowJira, IDS.rowClickup];
  const tabIndexes = (): (string | null)[] => rows.map((id) => screen.getByTestId(id).getAttribute("tabindex"));

  it("is one tab stop, the selected row, so Tab from GitHub's row still goes to the detail's controls", async () => {
    await start({ connectors: [connector("connected")] });
    expect(tabIndexes()).toEqual(["0", "-1", "-1", "-1"]);
    select(IDS.rowJira);
    expect(tabIndexes()).toEqual(["-1", "-1", "0", "-1"]);
  });

  it("moves focus between the rows with Up, Down, Home and End, and selects only on Enter or a click", async () => {
    await start();
    const github = screen.getByTestId(IDS.listRow);
    github.focus();
    fireEvent.keyDown(github, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId(IDS.rowPolicy));
    fireEvent.keyDown(document.activeElement ?? github, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId(IDS.rowJira));
    fireEvent.keyDown(document.activeElement ?? github, { key: "End" });
    expect(document.activeElement).toBe(screen.getByTestId(IDS.rowClickup));
    fireEvent.keyDown(document.activeElement ?? github, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId(IDS.rowClickup));
    // Moving focus selected nothing.
    expect(screen.getByTestId(IDS.listRow).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId(IDS.empty)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? github, { key: "Home" });
    expect(document.activeElement).toBe(github);
    fireEvent.keyDown(github, { key: "ArrowUp" });
    expect(document.activeElement).toBe(github);
    fireEvent.click(screen.getByTestId(IDS.rowClickup));
    expect(state()).toBe("none");
  });
});

// ---- S5: the palette ------------------------------------------------------------------------------------------

describe("the phase 8 palette commands (S5)", () => {
  const IDS_OF = ["integrations.connect-jira", "integrations.connect-clickup", "integrations.repo-policy"] as const;

  it("registers three more commands under owner integrations, and unregisters them on unmount", async () => {
    const started = await start();
    const owned = (): string[] => started.kernel.registry.list().filter((c) => c.owner === INTEGRATIONS_OWNER).map((c) => c.id);
    for (const id of IDS_OF) expect(owned()).toContain(id);
    expect(started.kernel.registry.list().filter((c) => c.owner === INTEGRATIONS_OWNER)).toHaveLength(7);
    cleanup();
    expect(owned()).toEqual([]);
  });

  it("Connect Jira and Connect ClickUp press the pane's Connect: the pane, and one connect call", async () => {
    const started = await start();
    act(() => void command(started.kernel, "integrations.connect-clickup").run());
    await waitFor(() => expect(screen.getByTestId(IDS.mcpWait).getAttribute("data-phase")).toBe("waiting"));
    expect(screen.getByTestId(IDS.mcp).getAttribute("data-kind")).toBe("clickup");
    expect(requests(started.kernel, CONNECT)).toEqual([{ method: "POST", path: "/connectors/mcp/:kind/connect", params: { kind: "clickup" } }]);
    expect(started.kernel.opened).toEqual([AUTHORIZE_URL]);
    // A second run while a window is open is the same press: no second call.
    act(() => void command(started.kernel, "integrations.connect-clickup").run());
    act(() => void command(started.kernel, "integrations.connect-jira").run());
    await sleep(50);
    expect(requests(started.kernel, CONNECT)).toHaveLength(1);
  });

  it("Connect Jira on a connected Jira only shows its pane", async () => {
    const started = await start({ mcp: [mcpRow("jira")] });
    act(() => void command(started.kernel, "integrations.connect-jira").run());
    expect(state()).toBe("connected");
    expect(requests(started.kernel, CONNECT)).toHaveLength(0);
  });

  it("Open repo policy shows the repo policy pane", async () => {
    const started = await start();
    act(() => void command(started.kernel, "integrations.repo-policy").run());
    expect(screen.getByTestId(IDS.policy)).toBeTruthy();
  });

  it("all three are disabled while the kernel is unreachable, and do nothing", async () => {
    const started = await start();
    for (const id of IDS_OF) expect(command(started.kernel, id).enabled?.()).toBe(true);
    await feedLive(started.kernel);
    started.kernel.connectors = () => UNREACHABLE;
    emit(started.kernel, "connector_status");
    await waitFor(() => expect(command(started.kernel, "integrations.connect-jira").enabled?.()).toBe(false));
    for (const id of IDS_OF) expect(command(started.kernel, id).enabled?.()).toBe(false);
    act(() => void command(started.kernel, "integrations.connect-jira").run());
    expect(requests(started.kernel, CONNECT)).toHaveLength(0);
  });
});

// ---- The pure model behind the views ---------------------------------------------------------------------------

describe("the phase 8 view model", () => {
  it("acceptBody sends the proposal's kind, and required only for reviews", () => {
    expect(acceptBody({ kind: "solo", required_reviews: null })).toStrictEqual({ kind: "solo" });
    expect(acceptBody({ kind: "studio_approval", required_reviews: 4 })).toStrictEqual({ kind: "studio_approval" });
    expect(acceptBody({ kind: "reviews", required_reviews: 2 })).toStrictEqual({ kind: "reviews", required: 2 });
    expect(acceptBody({ kind: null, required_reviews: null, choices: ["safe_mode"] })).toBeUndefined();
  });

  it("presetBody checks N and adds trust_unprotected only when asked", () => {
    expect(presetBody("solo", "", false)).toStrictEqual({ kind: "solo" });
    expect(presetBody("solo", "", true)).toStrictEqual({ kind: "solo", trust_unprotected: true });
    expect(presetBody("reviews", " 3 ", false)).toStrictEqual({ kind: "reviews", required: 3 });
    for (const bad of ["", "0", "03", "1.5", "-2", "1e2", "1000", "x"]) expect(presetBody("reviews", bad, false)).toBeUndefined();
  });

  it("builds a settings link only from GitHub-shaped names, and the plans address is fixed", () => {
    expect(repoSettingsUrl("octo-owner/site")).toBe("https://github.com/octo-owner/site/settings");
    expect(repoSettingsUrl("octo-owner/my.repo_2")).toBe("https://github.com/octo-owner/my.repo_2/settings");
    for (const bad of ["", "octo-owner", "a/b/c", "-bad/site", "bad-/site", "octo owner/site", "octo-owner/site?x=1", "octo-owner/..", "octo-owner/a#b", "octo-owner/a/../b"]) expect(repoSettingsUrl(bad)).toBeUndefined();
    expect(BILLING_PLANS_URL).toBe("https://github.com/settings/billing/plans");
    expect(splitRepo("octo-owner/site")).toEqual({ owner: "octo-owner", name: "site" });
    expect(splitRepo("/site")).toBeUndefined();
  });

  it("reads a detection defensively: an unreadable branch, missing lists and a non-record all give plain words", () => {
    const now = new Date();
    expect(detectionOf(null, now)).toBeUndefined();
    expect(detectionOf({ protection: "unreadable" }, now)?.lines.map((l) => l.value)).toEqual(["Couldn't be read", "None", "None", "GitHub would not say"]);
    expect(detectionOf({ protection: 7, required_reviews: "2", required_checks: "ci", pushers: [] }, now)?.lines.map((l) => l.value)).toEqual(["Not reported", "None", "None", "No one reported"]);
    expect(detectionOf({ protection: "protected", required_reviews: 2, required_checks: ["ci", "lint"], pushers: ["a"], read_at: "never" }, now)?.lines.map((l) => l.value)).toEqual(["On", "2 approving reviews", "ci, lint", "a"]);
  });

  it("maps a refusal's code to its view, and an event's only when it is this kind's and names a code", () => {
    expect(mcpRefusalOfCode("authorization_denied").refusal).toEqual({ kind: "denied" });
    expect(mcpRefusalOfCode("window_expired").refusal).toEqual({ kind: "window_expired" });
    expect(mcpRefusalOfCode("x".repeat(500)).refusal).toEqual({ kind: "code", code: `${"x".repeat(80)}…` });
    expect(mcpRefusalOfEvent({ kind: "jira", refused: "cancelled" }, "jira")?.refusal).toEqual({ kind: "code", code: "cancelled" });
    expect(mcpRefusalOfEvent({ kind: "jira", refused: "cancelled" }, "clickup")).toBeUndefined();
    for (const payload of [null, "text", [], { kind: "jira" }, { kind: "jira", refused: "" }, { kind: "jira", refused: 3 }]) expect(mcpRefusalOfEvent(payload, "jira")).toBeUndefined();
  });

  it("words the policy row from the reads", () => {
    const set = policyOf("a/b", { kind: "solo" });
    expect(policyRowMeta({ phase: "idle", repos: [], error: undefined }, false).text).toBe("open to read the repos");
    expect(policyRowMeta({ phase: "loading", repos: [], error: undefined }, false).text).toBe("checking…");
    expect(policyRowMeta({ phase: "ready", repos: [set], error: undefined }, false)).toEqual({ dot: "ok", text: "all repos set" });
    expect(policyRowMeta({ phase: "ready", repos: [set, policyOf("a/c")], error: undefined }, false)).toEqual({ dot: "waiting", text: "1 of 2 repos set" });
    expect(policyRowMeta({ phase: "ready", repos: [set], error: undefined }, true).text).toBe("status unknown · kernel unreachable");
  });
});
