// @vitest-environment jsdom
// The Integrations screen (phase 6 item 11, AC1, AC5-AC8 and AC13) against a
// scripted bridge (`fake-bridge.ts`): the empty state for each way of having
// no token, the connected / expiring / expired detail, Refresh, the Disconnect
// confirm, `connector_status` refetches (last answer kept, a stale answer
// dropped), the unreachable state, the Replace token path and the ⌘K commands.
// The Connect sheet's own behaviour and the token-secrecy pins are in
// `connect-sheet.test.tsx`.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Connector } from "../../api/contract";
import { ok } from "../../store/fake-bridge";
import { INTEGRATIONS_OWNER } from "./commands";
import { IntegrationsView } from "./IntegrationsView";
import { INTEGRATIONS_TEST_IDS as IDS } from "./model";
import {
  MASON,
  PIM,
  TOKEN,
  UNREACHABLE,
  WRIGHT,
  agent,
  connector,
  createKernel,
  deferred,
  emit,
  mountScreen,
  refused,
  requests,
  sleep,
  startScreen,
} from "./test-support";
import type { Kernel } from "./test-support";

afterEach(() => {
  cleanup();
});

const rowWords = (): string | null => screen.getByTestId(IDS.listMeta).textContent;
const withRows = (...rows: Connector[]): Kernel["connectors"] => () => ok({ connectors: rows });
const daysFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

// ---- AC1: the empty state ------------------------------------------------------------------------

describe("the empty state", () => {
  it.each([
    ["no row", []],
    ["only a disconnected row", [connector("disconnected")]],
    ["only a rejected row", [connector("rejected")]],
  ] as const)("%s: Connect GitHub, the no-connectors note, and a 'Not connected' list row", async (_name, rows) => {
    await startScreen({ connectors: withRows(...rows) });
    const empty = screen.getByTestId(IDS.empty);
    expect(within(empty).getByRole("heading", { level: 2 }).textContent).toBe("Connect GitHub so a playbook can read your PRs.");
    expect(empty.textContent).toContain("Studio works with no connectors.");
    expect(within(empty).getByRole("button", { name: "Connect GitHub" })).toBeTruthy();
    expect(rowWords()?.startsWith("not connected")).toBe(true);
    // Not the detail: no Replace, no Disconnect, no permissions.
    expect(screen.queryByTestId(IDS.replace)).toBeNull();
    expect(screen.queryByTestId(IDS.disconnect)).toBeNull();
    expect(screen.queryByTestId(IDS.permissions)).toBeNull();
  });

  it("a rejected row carries the last-token-was-refused note in the list row; a disconnected one does not", async () => {
    await startScreen({ connectors: withRows(connector("rejected")) });
    expect(rowWords()).toBe("not connected · the last token was refused");
    cleanup();
    await startScreen({ connectors: withRows(connector("disconnected")) });
    expect(rowWords()).toBe("not connected");
  });

  it("the Connect GitHub button opens the sheet in connect mode", async () => {
    await startScreen({ connectors: withRows() });
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    const sheet = screen.getByTestId(IDS.sheet);
    expect(sheet.getAttribute("data-mode")).toBe("connect");
    expect(sheet.textContent).not.toContain("The current token stays in use");
  });

  it("before the first answer nothing is claimed: a loading detail, not the empty state", async () => {
    const held = deferred<ReturnType<typeof ok>>();
    const kernel = createKernel({ connectors: () => held.promise });
    render(<IntegrationsView api={kernel.fake.bridge} registry={kernel.registry} />);
    expect(screen.getByTestId(IDS.loading)).toBeTruthy();
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(rowWords()).toBe("checking…");
    await act(async () => held.resolve(ok({ connectors: [] })));
    await waitFor(() => expect(screen.getByTestId(IDS.empty)).toBeTruthy());
  });
});

// ---- AC5: the connected detail ---------------------------------------------------------------------------

describe("the connected detail", () => {
  it("shows status, account, each permission with its level, expiry, the reachable repos and the agents with the grant", async () => {
    await startScreen();
    expect(rowWords()).toBe("connected · octo-owner");
    expect(screen.getByTestId(IDS.status).textContent).toContain("connected");
    expect(screen.getByTestId(IDS.account).textContent).toBe("octo-owner");
    expect(screen.getByTestId(IDS.expires).textContent).toContain("88 days left");
    const permissions = within(screen.getByTestId(IDS.permissions)).getAllByRole("listitem");
    expect(permissions.map((li) => li.textContent)).toEqual(["MetadataRead-only", "ContentsRead-only", "Pull requestsRead-only"]);
    expect(screen.getByTestId(IDS.reposHeading).textContent).toBe("Reachable repos · 2");
    expect(within(screen.getByTestId(IDS.repos)).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["octo-owner/site", "octo-owner/docs"]);
    expect(screen.getByRole("heading", { name: "Permissions" })).toBeTruthy();
  });

  it("lists exactly the agents whose roster entry says GitHub (githubGranted === true), and names the rest", async () => {
    await startScreen({ roster: [WRIGHT, MASON, PIM, agent("ada", "Ada", null)] });
    await waitFor(() => expect(screen.getAllByTestId(IDS.agentCard)).toHaveLength(1));
    const cards = screen.getAllByTestId(IDS.agentCard);
    expect(cards.map((c) => c.getAttribute("data-agent-id"))).toEqual(["mason"]);
    expect(cards[0]?.textContent).toContain("Mason");
    expect(cards[0]?.getAttribute("href")).toBe("#/team/mason");
    expect(screen.getByRole("heading", { name: "Agents with the GitHub grant · 1" })).toBeTruthy();
    // Ada's grant was not reported: she is in neither list.
    expect(screen.getByTestId(IDS.agentsNote).textContent).toBe("Wright and Pim don't have it. The grant is set per agent in Team.");
  });

  it("with no grant at all it says so, and a roster that failed to read is not 'no agent'", async () => {
    await startScreen({ roster: [WRIGHT, PIM] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Agents with the GitHub grant · 0" })).toBeTruthy());
    expect(screen.queryByTestId(IDS.agentCard)).toBeNull();
    expect(screen.getByTestId(IDS.agentsNote).textContent).toContain("No agent has it.");
  });

  it("renders every GitHub-sourced string as text, never as markup", async () => {
    const hostile = connector("connected", {
      account_login: "<img src=x onerror=alert(1)>",
      permissions: { "<b>pull_requests</b>": "read" },
      reachable_repos: ["<script>alert(1)</script>/repo"],
    });
    await startScreen({ connectors: withRows(hostile) });
    expect(screen.getByTestId(IDS.account).textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByTestId(IDS.repos).textContent).toBe("<script>alert(1)</script>/repo");
  });

  it("Refresh reads GET /connectors/github/repos?refresh=1 once and renders the repos it answers", async () => {
    const kernel = await startScreen({ repos: () => ok({ repos: ["octo-owner/site", "octo-owner/docs", "octo-owner/new"], verified_at: new Date().toISOString() }) });
    expect(requests(kernel, "GET /connectors/github/repos")).toHaveLength(0);
    fireEvent.click(screen.getByTestId(IDS.refresh));
    await waitFor(() => expect(screen.getByTestId(IDS.reposHeading).textContent).toBe("Reachable repos · 3"));
    expect(requests(kernel, "GET /connectors/github/repos")).toEqual([{ method: "GET", path: "/connectors/github/repos", query: { refresh: "1" } }]);
    expect(within(screen.getByTestId(IDS.repos)).getAllByRole("listitem").map((li) => li.textContent)).toContain("octo-owner/new");
  });

  it("a refused Refresh leaves the list as it was and says why", async () => {
    await startScreen({ repos: () => refused(502, { error: "github_unreachable", message: "GitHub did not answer" }) });
    fireEvent.click(screen.getByTestId(IDS.refresh));
    const notice = await screen.findByTestId(IDS.notice);
    expect(notice.textContent).toBe("Couldn't refresh the repos: GitHub did not answer");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(screen.getByTestId(IDS.reposHeading).textContent).toBe("Reachable repos · 2");
  });

  it("a connectors answer that lands after a refresh replaces the refreshed list with the kernel's copy", async () => {
    const kernel = await startScreen({ repos: () => ok({ repos: ["a/one"], verified_at: null }) });
    fireEvent.click(screen.getByTestId(IDS.refresh));
    await waitFor(() => expect(screen.getByTestId(IDS.reposHeading).textContent).toBe("Reachable repos · 1"));
    kernel.connectors = withRows(connector("connected", { reachable_repos: ["b/one", "b/two", "b/three", "b/four"] }));
    emit(kernel, "connector_status");
    await waitFor(() => expect(screen.getByTestId(IDS.reposHeading).textContent).toBe("Reachable repos · 4"));
  });
});

describe("the expiring and expired variants", () => {
  it("expiring: the renew-soon badge, the in-band warning, and Replace token as the primary button", async () => {
    await startScreen({ connectors: withRows(connector("expiring", { expires_at: daysFromNow(8) })) });
    expect(rowWords()).toBe("expiring in 8 days · octo-owner");
    expect(screen.getByTestId(IDS.status).textContent).toContain("expiring");
    expect(screen.getByTestId(IDS.expires).textContent).toContain("renew soon");
    const band = screen.getByTestId(IDS.inBand);
    expect(band.getAttribute("role")).toBe("status");
    expect(band.textContent).toContain("The token expires in 8 days");
    expect(screen.getByTestId(IDS.replace).getAttribute("data-variant")).toBe("primary");
    expect(screen.getByTestId(IDS.disconnect).getAttribute("data-variant")).toBe("danger");
  });

  it("expired: the expired badge, an alert, 'checked' not 'verified', and Replace token as the primary button", async () => {
    await startScreen({ connectors: withRows(connector("expired", { expires_at: daysFromNow(-2) })) });
    expect(rowWords()).toBe("expired · octo-owner");
    expect(screen.getByTestId(IDS.expires).textContent).toContain("expired 2 days ago");
    expect(screen.getByTestId(IDS.expires).textContent).toContain("expired");
    expect(screen.getByTestId(IDS.status).textContent).toContain("checked");
    const band = screen.getByTestId(IDS.inBand);
    expect(band.getAttribute("role")).toBe("alert");
    expect(band.textContent).toContain("The token expired on");
    expect(screen.getByTestId(IDS.replace).getAttribute("data-variant")).toBe("primary");
  });

  it("connected: Replace token is the secondary button, with no in-band warning", async () => {
    await startScreen();
    expect(screen.getByTestId(IDS.replace).getAttribute("data-variant")).toBe("secondary");
    expect(screen.queryByTestId(IDS.inBand)).toBeNull();
  });
});

describe("sparse rows", () => {
  it("no account, no permissions, no repos and no expiry read as such, never as null or blank", async () => {
    await startScreen({ connectors: withRows(connector("connected", { account_login: null, permissions: {}, reachable_repos: [], expires_at: null })) });
    expect(rowWords()).toBe("connected");
    expect(screen.getByTestId(IDS.account).textContent).toBe("unknown");
    expect(screen.getByTestId(IDS.expires).textContent).toBe("No expiry");
    expect(screen.queryByTestId(IDS.permissions)).toBeNull();
    expect(screen.getByText("No permissions reported.")).toBeTruthy();
    expect(screen.getByTestId(IDS.reposHeading).textContent).toBe("Reachable repos · 0");
    expect(screen.getByText("No repos reachable with this token.")).toBeTruthy();
  });

  it("an expired row with no expiry date still says it expired", async () => {
    await startScreen({ connectors: withRows(connector("expired", { expires_at: null })) });
    expect(screen.getByTestId(IDS.inBand).textContent).toContain("The token has expired.");
  });

  it("a roster that failed to read is said so, not shown as 'no agent has it'", async () => {
    const kernel = createKernel();
    kernel.fake.route("GET /agents", () => refused(500, { error: "internal" }));
    await mountScreen(kernel);
    await waitFor(() => expect(screen.getByTestId(IDS.agentsNote).textContent).toBe("Couldn't read the team."));
    expect(screen.queryByTestId(IDS.agentCard)).toBeNull();
  });
});

// ---- AC6: Disconnect asks first --------------------------------------------------------------------------------

describe("Disconnect", () => {
  it("opens a confirm and makes no request; Cancel and Escape close it with none", async () => {
    const kernel = await startScreen();
    fireEvent.click(screen.getByTestId(IDS.disconnect));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("heading", { name: "Disconnect GitHub?" })).toBeTruthy();
    expect(requests(kernel, "POST /connectors/github/disconnect")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    fireEvent.click(screen.getByTestId(IDS.disconnect));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(requests(kernel, "POST /connectors/github/disconnect")).toHaveLength(0);
  });

  it("confirming makes exactly one POST, then the screen reads 'not connected' and focus lands on the connector row", async () => {
    const kernel = await startScreen();
    kernel.disconnect = () => {
      kernel.connectors = withRows(connector("disconnected"));
      return ok({ connector: connector("disconnected") });
    };
    fireEvent.click(screen.getByTestId(IDS.disconnect));
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId(IDS.empty)).toBeTruthy());
    expect(requests(kernel, "POST /connectors/github/disconnect")).toEqual([{ method: "POST", path: "/connectors/github/disconnect" }]);
    expect(rowWords()).toBe("not connected");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(IDS.listRow)));
  });

  it("says the playbooks are already parked for an expired token, and keeps the grants", async () => {
    await startScreen({ connectors: withRows(connector("expired")) });
    fireEvent.click(screen.getByTestId(IDS.disconnect));
    const text = screen.getByRole("alertdialog").textContent;
    expect(text).toContain("Deletes the token from the Keychain.");
    expect(text).toContain("already parked");
    expect(text).toContain("Agents keep their grant.");
    cleanup();
    await startScreen();
    fireEvent.click(screen.getByTestId(IDS.disconnect));
    expect(screen.getByRole("alertdialog").textContent).toContain("Playbooks that need GitHub park until you connect again.");
  });

  it("closes by itself if the token goes away while it is open", async () => {
    const kernel = await startScreen();
    fireEvent.click(screen.getByTestId(IDS.disconnect));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    kernel.connectors = withRows(connector("disconnected"));
    emit(kernel, "connector_status");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requests(kernel, "POST /connectors/github/disconnect")).toHaveLength(0);
  });

  it("a refused disconnect closes the confirm, keeps the detail and says why", async () => {
    await startScreen({ disconnect: () => refused(500, { error: "keychain_failed", message: "the Keychain refused" }) });
    fireEvent.click(screen.getByTestId(IDS.disconnect));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
    const notice = await screen.findByTestId(IDS.notice);
    expect(notice.textContent).toBe("Couldn't disconnect GitHub: the Keychain refused");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId(IDS.replace)).toBeTruthy();
  });
});

// ---- AC7: live updates --------------------------------------------------------------------------------------------

describe("live updates", () => {
  it("refetches GET /connectors on a connector_status event, and on no other", async () => {
    const kernel = await startScreen();
    expect(requests(kernel, "GET /connectors")).toHaveLength(1);
    kernel.connectors = withRows(connector("expired", { expires_at: daysFromNow(-1) }));
    emit(kernel, "session_started");
    emit(kernel, "agent_updated");
    await sleep(400);
    expect(requests(kernel, "GET /connectors")).toHaveLength(1);
    expect(rowWords()).toBe("connected · octo-owner");

    emit(kernel, "connector_status");
    await waitFor(() => expect(rowWords()).toBe("expired · octo-owner"));
    expect(requests(kernel, "GET /connectors")).toHaveLength(2);
  });

  it("keeps the last answer on screen while the refetch is in flight (no loading flash)", async () => {
    const kernel = await startScreen();
    const slow = deferred<ReturnType<typeof ok>>();
    kernel.connectors = () => slow.promise;
    emit(kernel, "connector_status");
    await waitFor(() => expect(requests(kernel, "GET /connectors")).toHaveLength(2));
    // The request is out and unanswered: the detail is still the connected one.
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(rowWords()).toBe("connected · octo-owner");
    expect(screen.getByTestId(IDS.permissions)).toBeTruthy();
    await act(async () => slow.resolve(ok({ connectors: [connector("expiring", { expires_at: daysFromNow(5) })] })));
    await waitFor(() => expect(rowWords()).toBe("expiring in 5 days · octo-owner"));
  });

  it("drops an answer older than the latest request", async () => {
    const kernel = await startScreen();
    const oldAnswer = deferred<ReturnType<typeof ok>>();
    kernel.connectors = () => oldAnswer.promise;
    emit(kernel, "connector_status");
    await waitFor(() => expect(requests(kernel, "GET /connectors")).toHaveLength(2));

    kernel.connectors = withRows(connector("expiring", { expires_at: daysFromNow(3) }));
    emit(kernel, "connector_status");
    await waitFor(() => expect(rowWords()).toBe("expiring in 3 days · octo-owner"));

    // The slow first answer finally lands: it is older than the latest request and changes nothing.
    await act(async () => oldAnswer.resolve(ok({ connectors: [] })));
    await sleep(20);
    expect(rowWords()).toBe("expiring in 3 days · octo-owner");
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
  });

  it("status 0 with a connection is the kernel-unreachable state, never 'not connected'", async () => {
    await startScreen({ connectors: () => UNREACHABLE });
    expect(screen.getByTestId(IDS.band).textContent).toContain("Couldn't reach the kernel.");
    expect(screen.getByTestId(IDS.band).getAttribute("role")).toBe("alert");
    expect(rowWords()).toBe("status unknown · kernel unreachable");
    expect(document.body.textContent).not.toContain("not connected");
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Status unknown" })).toBeTruthy();
  });

  it("a failed IPC call is a read error in Team's words, not 'not connected'", async () => {
    await startScreen({
      connectors: () => {
        throw new Error("ipc closed");
      },
    });
    expect(screen.getByTestId(IDS.readError).textContent).toBe("Couldn't read the connectors: The request did not reach the kernel.");
    expect(rowWords()).toBe("status unknown");
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.getByRole("heading", { name: "Status unknown" })).toBeTruthy();
  });

  it("from the empty state, an unreachable kernel leaves Connect GitHub shown but off", async () => {
    const kernel = await startScreen({ connectors: withRows() });
    kernel.connectors = () => UNREACHABLE;
    emit(kernel, "connector_status");
    await waitFor(() => expect(screen.getByTestId(IDS.band)).toBeTruthy());
    expect((screen.getByTestId(IDS.emptyConnect) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    expect(screen.queryByTestId(IDS.sheet)).toBeNull();
  });

  it("unreachable after a good answer keeps that detail, with every write disabled", async () => {
    const kernel = await startScreen();
    kernel.connectors = () => UNREACHABLE;
    emit(kernel, "connector_status");
    await waitFor(() => expect(screen.getByTestId(IDS.band)).toBeTruthy());
    expect(rowWords()).toBe("status unknown · kernel unreachable");
    expect(screen.getByTestId(IDS.status).textContent).toContain("Unknown while the kernel is unreachable");
    for (const id of [IDS.replace, IDS.disconnect, IDS.refresh]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(IDS.account).textContent).toBe("octo-owner");
  });

  it("a refused read says so, keeps the last answer, and is not 'not connected'", async () => {
    const kernel = await startScreen();
    kernel.connectors = () => refused(500, { error: "connector_failed", message: "the connector could not answer" });
    emit(kernel, "connector_status");
    const alert = await screen.findByTestId(IDS.readError);
    expect(alert.textContent).toBe("Couldn't read the connectors: the connector could not answer");
    expect(rowWords()).toBe("connected · octo-owner");
  });
});

// ---- AC13: Replace token ------------------------------------------------------------------------------------------------

describe("Replace token", () => {
  it.each([["connected"], ["expiring"], ["expired"]] as const)("a %s row has the button, which opens the sheet in replace mode", async (status) => {
    await startScreen({ connectors: withRows(connector(status)) });
    fireEvent.click(screen.getByTestId(IDS.replace));
    const sheet = screen.getByTestId(IDS.sheet);
    expect(sheet.getAttribute("data-mode")).toBe("replace");
    expect(sheet.textContent).toContain(status === "expired" ? "The new token replaces the expired one once it passes the check." : "The current token stays in use until the new one passes the check.");
  });

  it("is absent from the empty state", async () => {
    await startScreen({ connectors: withRows() });
    expect(screen.queryByTestId(IDS.replace)).toBeNull();
  });

  it("posts the new token to the same route, and a refusal leaves the current row rendered unchanged", async () => {
    const kernel = await startScreen({ token: () => refused(422, { error: "token_write_scoped", message: "write", connector: {}, write_permissions: [{ permission: "pull_requests", level: "write" }] }) });
    const before = screen.getByTestId(IDS.detail).textContent;
    fireEvent.click(screen.getByTestId(IDS.replace));
    fireEvent.change(screen.getByTestId(IDS.sheetToken), { target: { value: TOKEN } });
    fireEvent.click(screen.getByTestId(IDS.sheetConnect));
    await screen.findByTestId(IDS.sheetError);
    expect(requests(kernel, "POST /connectors/github/token")).toEqual([{ method: "POST", path: "/connectors/github/token", body: { token: TOKEN } }]);
    expect(screen.getByTestId(IDS.detail).textContent).toBe(before);
    expect(rowWords()).toBe("connected · octo-owner");
    // The sheet is still the replace one.
    expect(screen.getByTestId(IDS.sheet).getAttribute("data-mode")).toBe("replace");
  });

  it("a replace the kernel takes closes the sheet and re-reads the row, with focus back on Replace token", async () => {
    const kernel = await startScreen();
    kernel.token = () => {
      kernel.connectors = withRows(connector("connected", { account_login: "new-owner" }));
      return ok({ connector: connector("connected", { account_login: "new-owner" }) });
    };
    // As a keyboard user reaches it: the button holds focus when it is pressed.
    screen.getByTestId(IDS.replace).focus();
    fireEvent.click(screen.getByTestId(IDS.replace));
    fireEvent.change(screen.getByTestId(IDS.sheetToken), { target: { value: TOKEN } });
    fireEvent.click(screen.getByTestId(IDS.sheetConnect));
    await waitFor(() => expect(screen.queryByTestId(IDS.sheet)).toBeNull());
    await waitFor(() => expect(screen.getByTestId(IDS.account).textContent).toBe("new-owner"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(IDS.replace)));
  });
});

// ---- AC8: ⌘K commands ----------------------------------------------------------------------------------------------------------------

describe("the ⌘K commands", () => {
  const owned = (kernel: Kernel): string[] => kernel.registry.list().filter((c) => c.owner === INTEGRATIONS_OWNER).map((c) => c.id);
  const command = (kernel: Kernel, id: string) => {
    const found = kernel.registry.get(id);
    if (found === undefined) throw new Error(`no command ${id}`);
    return found;
  };

  it("registers Connect GitHub, Disconnect GitHub and Refresh reachable repos under owner integrations, and unregisters them on unmount", async () => {
    const kernel = await startScreen();
    expect(owned(kernel)).toEqual(["integrations.connect-github", "integrations.disconnect-github", "integrations.refresh-repos"]);
    expect(kernel.registry.list().map((c) => c.title)).toEqual(["Connect GitHub", "Disconnect GitHub", "Refresh reachable repos"]);
    cleanup();
    expect(owned(kernel)).toEqual([]);
  });

  it.each([
    ["no row", [], { connect: true, disconnect: false, refresh: false }],
    ["a rejected row", [connector("rejected")], { connect: true, disconnect: false, refresh: false }],
    ["a disconnected row", [connector("disconnected")], { connect: true, disconnect: false, refresh: false }],
    ["connected", [connector("connected")], { connect: true, disconnect: true, refresh: true }],
    ["expiring", [connector("expiring")], { connect: true, disconnect: true, refresh: true }],
    // Expired too, as the detail pane's Refresh button (off only while offline).
    ["expired", [connector("expired")], { connect: true, disconnect: true, refresh: true }],
  ] as const)("with %s: enabled follows the state", async (_name, rows, want) => {
    const kernel = await startScreen({ connectors: withRows(...rows) });
    expect(command(kernel, "integrations.connect-github").enabled?.()).toBe(want.connect);
    expect(command(kernel, "integrations.disconnect-github").enabled?.()).toBe(want.disconnect);
    expect(command(kernel, "integrations.refresh-repos").enabled?.()).toBe(want.refresh);
  });

  it("while the kernel is unreachable all three are disabled, and they follow the state as it changes", async () => {
    const kernel = await startScreen();
    expect(command(kernel, "integrations.disconnect-github").enabled?.()).toBe(true);
    kernel.connectors = () => UNREACHABLE;
    emit(kernel, "connector_status");
    await waitFor(() => expect(command(kernel, "integrations.connect-github").enabled?.()).toBe(false));
    expect(command(kernel, "integrations.disconnect-github").enabled?.()).toBe(false);
    expect(command(kernel, "integrations.refresh-repos").enabled?.()).toBe(false);
  });

  it("Connect GitHub opens the connect sheet with no token, and the replace sheet when one exists", async () => {
    const kernel = await startScreen({ connectors: withRows() });
    act(() => void command(kernel, "integrations.connect-github").run());
    expect(screen.getByTestId(IDS.sheet).getAttribute("data-mode")).toBe("connect");
    cleanup();

    const withToken = await startScreen();
    act(() => void command(withToken, "integrations.connect-github").run());
    expect(screen.getByTestId(IDS.sheet).getAttribute("data-mode")).toBe("replace");
  });

  it("Disconnect GitHub opens the same confirm as the button (no request until confirmed)", async () => {
    const kernel = await startScreen();
    act(() => void command(kernel, "integrations.disconnect-github").run());
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(requests(kernel, "POST /connectors/github/disconnect")).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(requests(kernel, "POST /connectors/github/disconnect")).toHaveLength(1));
  });

  it("Refresh reachable repos runs the same route as the Refresh button", async () => {
    const kernel = await startScreen({ repos: () => ok({ repos: ["x/one"], verified_at: null }) });
    await act(async () => {
      await command(kernel, "integrations.refresh-repos").run();
    });
    expect(requests(kernel, "GET /connectors/github/repos")).toEqual([{ method: "GET", path: "/connectors/github/repos", query: { refresh: "1" } }]);
    expect(screen.getByTestId(IDS.reposHeading).textContent).toBe("Reachable repos · 1");
  });
});

// ---- AC8: keyboard alone --------------------------------------------------------------------------------------------------------------------

describe("keyboard", () => {
  it("every control is a real button or link, in the tab order: Replace token, Disconnect, Refresh, the agent link", async () => {
    await startScreen();
    await waitFor(() => expect(screen.getAllByTestId(IDS.agentCard)).toHaveLength(1));
    for (const id of [IDS.listRow, IDS.replace, IDS.disconnect, IDS.refresh]) {
      const el = screen.getByTestId(id);
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("tabindex")).not.toBe("-1");
    }
    expect(screen.getByTestId(IDS.agentCard).tagName).toBe("A");
  });

  it("the Disconnect confirm is reached, cancelled and re-opened without a pointer, with focus returning to the opener", async () => {
    await startScreen();
    const disconnect = screen.getByTestId(IDS.disconnect);
    disconnect.focus();
    fireEvent.click(disconnect);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(disconnect));
  });
});

// ---- Mount ------------------------------------------------------------------------------------------------------------------------------------

describe("mounting", () => {
  it("fetches GET /connectors once on mount and GET /agents for the grant, and nothing is written", async () => {
    const kernel = createKernel();
    await mountScreen(kernel);
    expect(requests(kernel, "GET /connectors")).toHaveLength(1);
    await waitFor(() => expect(requests(kernel, "GET /agents").length).toBeGreaterThan(0));
    expect(kernel.fake.requests.filter((r) => r.req.method !== "GET")).toEqual([]);
  });
});
