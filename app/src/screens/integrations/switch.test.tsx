// @vitest-environment jsdom
// Switching GitHub from a token to the GitHub App (phase 7 item 09) at unit level, over the scripted kernel
// (`test-support.tsx`): the "Switch to GitHub App" button on the token detail and the palette's "Switch GitHub to
// the GitHub App", the setup dialog over the token (its switch copy, its steps, the one cancelled and the one
// failed view), the list row's token-aware words, and what must never happen: no `POST /connectors/github/disconnect`,
// no token write, and the token connection unchanged after a cancel or a failure. The real flow, in the built app
// against the fixture kernel, is `app/e2e/integrations-switch.spec.ts`.
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Connector, GitHubAppSetupRefusal } from "../../api/contract";
import { ok } from "../../store/fake-bridge";
import { switchRowMeta } from "./app-setup";
import { type IntegrationsView, INTEGRATIONS_TEST_IDS as IDS, switchToApp, viewOf } from "./model";
import { APP_SLUG, SETUP_URL, UNREACHABLE, appConnector, connector, deferred, emit, refused, requests, startScreen as startPlainScreen } from "./test-support";
import type { Kernel, Setup } from "./test-support";

afterEach(() => {
  cleanup();
});

/** What the kernel's own words must never reach the screen as. */
const RAW = "RAW-KERNEL-MESSAGE <b>not markup</b> /tmp/secret";

const REASONS: readonly GitHubAppSetupRefusal[] = ["setup_not_open", "state_mismatch", "setup_expired", "conversion_failed", "install_failed", "token_write_scoped"];

const withRows = (...rows: Connector[]): Kernel["connectors"] => () => ok({ connectors: rows });
const rowWords = (): string | null => screen.getByTestId(IDS.listMeta).textContent;
const dialog = (): HTMLElement => screen.getByTestId(IDS.appSetup);
const phase = (): string | null => dialog().getAttribute("data-phase");
const setupCalls = (kernel: Kernel) => requests(kernel, "POST /connectors/github/app/setup");
const cancelCalls = (kernel: Kernel) => requests(kernel, "POST /connectors/github/app/setup/cancel");
const disconnectCalls = (kernel: Kernel) => requests(kernel, "POST /connectors/github/disconnect");
const tokenCalls = (kernel: Kernel) => requests(kernel, "POST /connectors/github/token");
const command = (kernel: Kernel, id: string) => {
  const found = kernel.registry.get(id);
  if (found === undefined) throw new Error(`no command ${id}`);
  return found;
};
const SWITCH = "integrations.switch-to-app";

/** The screen over a scripted kernel, once its live feed is listening (an event emitted before that would be lost). */
async function startScreen(setup: Setup = {}): Promise<Kernel> {
  const kernel = await startPlainScreen(setup);
  await waitFor(() => expect(kernel.fake.listenerCount()).toBeGreaterThan(0));
  return kernel;
}

/** A token connection on screen, "Switch to GitHub App" pressed (as a keyboard user does: the button holds focus); resolves once the dialog is on step 1. */
async function startSwitch(setup: Setup = {}): Promise<Kernel> {
  const kernel = await startScreen(setup);
  const button = screen.getByTestId(IDS.switchToApp);
  button.focus();
  fireEvent.click(button);
  await waitFor(() => expect(phase()).toBe("create"));
  return kernel;
}

/** The kernel's `connector_status` event; a switch's step-2 signal is one with no `refused`. */
const event = (kernel: Kernel, payload: Record<string, unknown> = {}): void => emit(kernel, "connector_status", { connector_id: 1, kind: "github", status: "connected", ...payload });

/** After a cancel or a failure the token connection is exactly as it was: nothing was disconnected, nothing was written, and the screen says so. */
function expectTokenKept(kernel: Kernel): void {
  expect(disconnectCalls(kernel)).toHaveLength(0);
  expect(tokenCalls(kernel)).toHaveLength(0);
  expect(rowWords()).toBe("connected · octo-owner · token");
  expect(screen.getByTestId(IDS.listDot).getAttribute("data-state")).toBe("ok");
}

// ---- The pure model --------------------------------------------------------------------------------

describe("switchToApp", () => {
  const view = (rows: Connector[]): IntegrationsView => {
    const lastOk = { connectors: rows };
    return viewOf({ latest: { kind: "ok", status: 200, body: lastOk }, lastOk });
  };

  it("is on for a token that is connected, expiring or expired, and for nothing else", () => {
    expect(switchToApp(view([connector("connected")]))).toBe(true);
    expect(switchToApp(view([connector("expiring")]))).toBe(true);
    expect(switchToApp(view([connector("expired")]))).toBe(true);
    expect(switchToApp(view([]))).toBe(false);
    expect(switchToApp(view([connector("rejected")]))).toBe(false);
    expect(switchToApp(view([connector("disconnected")]))).toBe(false);
    expect(switchToApp(view([appConnector("connected")]))).toBe(false);
    expect(switchToApp(view([appConnector("rejected")]))).toBe(false);
    // A token row that has recorded an App's slug (the kernel's step-2 state) is still a token in use.
    expect(switchToApp(view([connector("connected", { app_slug: APP_SLUG })]))).toBe(true);
  });
});

describe("switchRowMeta", () => {
  const token = { dot: "ok", text: "connected · octo-owner" } as const;

  it("adds `token · setting up the App` while the setup runs, and `token` once it ended, never `not connected`", () => {
    expect(switchRowMeta({ kind: "starting" }, token)).toEqual({ dot: "ok", text: "connected · octo-owner · token · setting up the App" });
    expect(switchRowMeta({ kind: "create" }, token).text).toBe("connected · octo-owner · token · setting up the App");
    expect(switchRowMeta({ kind: "install" }, token).text).toBe("connected · octo-owner · token · setting up the App");
    for (const outcome of ["expired", "cancelled", "write-scoped", "failed"] as const) {
      expect(switchRowMeta({ kind: "outcome", outcome }, token)).toEqual({ dot: "ok", text: "connected · octo-owner · token" });
    }
  });
});

// ---- The button -------------------------------------------------------------------------------------

describe("Switch to GitHub App on the token detail", () => {
  it.each(["connected", "expiring", "expired"] as const)("a %s token has the button, and pressing it makes one setup call and no disconnect", async (status) => {
    const kernel = await startScreen({ connectors: withRows(connector(status)) });
    const button = screen.getByTestId(IDS.switchToApp);
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("Switch to GitHub App");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(setupCalls(kernel)).toHaveLength(0);
    fireEvent.click(button);
    await waitFor(() => expect(phase()).toBe("create"));
    expect(setupCalls(kernel)).toHaveLength(1);
    expect(kernel.opened).toEqual([SETUP_URL]);
    expect(disconnectCalls(kernel)).toHaveLength(0);
    expect(tokenCalls(kernel)).toHaveLength(0);
  });

  it("sits between Replace token and Disconnect in the header", async () => {
    await startScreen();
    const names = [...screen.getByTestId(IDS.detailHeader).querySelectorAll("button")].map((b) => b.textContent);
    expect(names).toEqual(["Replace token", "Switch to GitHub App", "Disconnect"]);
  });

  it("is not on an empty detail, a rejected or disconnected row, or a GitHub App (connected or revoked)", async () => {
    for (const rows of [[], [connector("rejected")], [connector("disconnected")], [appConnector("connected")], [appConnector("rejected")]]) {
      await startScreen({ connectors: withRows(...rows) });
      expect(screen.queryByTestId(IDS.switchToApp)).toBeNull();
      cleanup();
    }
  });

  it("while the dialog runs the list row reads `connected · <account> · token · setting up the App` and the detail keeps the token's data", async () => {
    await startSwitch();
    expect(rowWords()).toBe("connected · octo-owner · token · setting up the App");
    // The connection is the token's: its detail pane is the one on screen, with the token's rows.
    const detail = screen.getByTestId(IDS.detail);
    expect(detail.getAttribute("data-state")).toBe("connected");
    expect(detail.getAttribute("data-method")).toBeNull();
    expect(screen.getByTestId(IDS.account).textContent).toBe("octo-owner");
    expect(screen.getByTestId(IDS.status).textContent).toContain("connected");
    expect(detail.textContent).toContain("loomwright-studio-github");
    expect(within(screen.getByTestId(IDS.repos)).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId(IDS.listDot).getAttribute("data-state")).toBe("ok");
  });

  it("an expiring token's row keeps its own words in front of the setup's", async () => {
    await startSwitch({ connectors: withRows(connector("expiring", { expires_at: new Date(Date.now() + 8 * 86_400_000).toISOString() })) });
    expect(rowWords()).toBe("expiring in 8 days · octo-owner · token · setting up the App");
  });

  it("renders the account as text, never as markup, in the switching row", async () => {
    await startSwitch({ connectors: withRows(connector("connected", { account_login: "<img src=x onerror=alert(1)>" })) });
    expect(rowWords()).toBe("connected · <img src=x onerror=alert(1)> · token · setting up the App");
    expect(document.querySelector("img")).toBeNull();
  });
});

// ---- The dialog over a token -------------------------------------------------------------------------

describe("the setup dialog over a token", () => {
  it("is the mockup's switch dialog: named and described, with steps, and it says the token stays connected", async () => {
    await startSwitch();
    const panel = dialog();
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(panel.getAttribute("aria-labelledby") ?? "");
    const description = document.getElementById(panel.getAttribute("aria-describedby") ?? "");
    expect(title?.textContent).toBe("Switch GitHub to the GitHub App");
    expect(description?.textContent).toContain("GitHub stays connected through your token while this runs, and keeps working if you cancel or setup fails.");
    expect(panel.textContent).toContain("When it connects, the token item is removed.");
    expect(screen.getByTestId(IDS.appSteps).getAttribute("data-step")).toBe("1");
    expect(screen.getByTestId(IDS.appStep1).textContent).toContain("Step 1 of 2 · Create the App on GitHub");
    expect(screen.getByTestId(IDS.appStatus).textContent).toBe("Setting up the GitHub App. Waiting for you on GitHub: step 1 of 2, Create. GitHub stays connected through the token.");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open GitHub again" })).toBeTruthy();
  });

  it("the no-token dialog keeps its own words", async () => {
    await startPlainScreen({ connectors: withRows() });
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(screen.getByRole("heading", { name: "Set up the GitHub App" })).toBeTruthy();
    expect(dialog().textContent).not.toContain("token");
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("setting up the GitHub App · waiting for you on GitHub");
  });

  it("a connector_status event that is not a refusal moves it to step 2, which says so, with no reload and the token still shown", async () => {
    const kernel = await startSwitch();
    event(kernel, { app_slug: APP_SLUG });
    await waitFor(() => expect(phase()).toBe("install"));
    expect(screen.getByTestId(IDS.appSteps).getAttribute("data-step")).toBe("2");
    expect(screen.getByTestId(IDS.appStep1).textContent).toContain("done");
    expect(screen.getByTestId(IDS.appStep2).textContent).toContain("waiting for you");
    expect(screen.getByTestId(IDS.appStatus).textContent).toBe("Step 2 of 2, Install. GitHub stays connected through the token.");
    expect(rowWords()).toBe("connected · octo-owner · token · setting up the App");
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(cancelCalls(kernel)).toHaveLength(0);
  });

  it("an event from before the dialog opened is not the step-2 signal", async () => {
    const kernel = await startScreen();
    event(kernel);
    fireEvent.click(screen.getByTestId(IDS.switchToApp));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(screen.getByTestId(IDS.appSteps).getAttribute("data-step")).toBe("1");
  });

  it("the install landing closes it: the detail is the App's, the token's buttons are gone, and focus goes to the connector row", async () => {
    const kernel = await startSwitch();
    event(kernel, { app_slug: APP_SLUG });
    await waitFor(() => expect(phase()).toBe("install"));
    kernel.connectors = withRows(appConnector("connected"));
    event(kernel, { status: "connected", method: "app" });
    await waitFor(() => expect(screen.queryByTestId(IDS.appSetup)).toBeNull());
    await waitFor(() => expect(screen.getByTestId(IDS.detail).getAttribute("data-method")).toBe("app"));
    expect(screen.queryByTestId(IDS.switchToApp)).toBeNull();
    expect(screen.queryByTestId(IDS.replace)).toBeNull();
    expect(screen.getByTestId(IDS.appName).textContent).toBe(APP_SLUG);
    expect(rowWords()).toBe("connected · octo-owner · GitHub App");
    // A finished setup is never cancelled afterwards, and nothing disconnected.
    expect(cancelCalls(kernel)).toHaveLength(0);
    expect(disconnectCalls(kernel)).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(IDS.listRow)));
  });

  it("focus is trapped in the dialog and starts on Open GitHub again", async () => {
    await startSwitch();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(IDS.appOpenAgain)));
    expect(dialog().contains(document.activeElement)).toBe(true);
  });
});

// ---- Cancel: the token is unchanged -------------------------------------------------------------------

describe("cancelling the switch", () => {
  const says = (): string => dialog().textContent ?? "";

  const expectCancelledView = (): void => {
    expect(phase()).toBe("cancelled");
    expect(screen.getByRole("heading", { name: "Setup cancelled" })).toBeTruthy();
    expect(says()).toContain("Setup cancelled. GitHub is still connected through your token.");
    expect(says()).not.toContain("Nothing was connected");
    expect(screen.getByTestId(IDS.appStatus).textContent).toBe("Setup cancelled. GitHub is still connected through your token.");
    expect(screen.queryByTestId(IDS.appPasteToken)).toBeNull();
    expect(screen.getByTestId(IDS.appClose)).toBeTruthy();
    expect(screen.getByTestId(IDS.appAgain)).toBeTruthy();
  };

  it("Cancel makes one cancel call and says GitHub is still connected through the token", async () => {
    const kernel = await startSwitch();
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    expectCancelledView();
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    expectTokenKept(kernel);
  });

  it("Escape does the same, once", async () => {
    const kernel = await startSwitch();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expectCancelledView();
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    expectTokenKept(kernel);
  });

  it("a press on the backdrop does the same, once", async () => {
    const kernel = await startSwitch();
    fireEvent.mouseDown(dialog().parentElement as HTMLElement);
    expectCancelledView();
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    expectTokenKept(kernel);
  });

  it("Close returns to the token detail, and focus returns to the Switch button that opened it", async () => {
    const kernel = await startSwitch();
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    fireEvent.click(screen.getByTestId(IDS.appClose));
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
    // With the dialog gone the row is the token's ordinary words again.
    expect(rowWords()).toBe("connected · octo-owner");
    expect(screen.getByTestId(IDS.detail).getAttribute("data-state")).toBe("connected");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(IDS.switchToApp)));
    expect(cancelCalls(kernel)).toHaveLength(1);
    expect(disconnectCalls(kernel)).toHaveLength(0);
  });

  it("Set up again from the cancelled view is a fresh switch: a new setup call, still over the token", async () => {
    const kernel = await startSwitch();
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    fireEvent.click(screen.getByTestId(IDS.appAgain));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(setupCalls(kernel)).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Switch GitHub to the GitHub App" })).toBeTruthy();
    expect(rowWords()).toBe("connected · octo-owner · token · setting up the App");
    expect(disconnectCalls(kernel)).toHaveLength(0);
  });

  it("cancelling before the setup call is answered opens nothing, cancels the window the answer opened, and keeps the token", async () => {
    const answer = deferred<ReturnType<typeof ok>>();
    const kernel = await startScreen({ appSetup: () => answer.promise });
    fireEvent.click(screen.getByTestId(IDS.switchToApp));
    expect(phase()).toBe("starting");
    expect(rowWords()).toBe("connected · octo-owner · token · setting up the App");
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    expectCancelledView();
    await act(async () => answer.resolve(ok({ setup_url: SETUP_URL, expires_at: new Date(Date.now() + 600_000).toISOString() })));
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    expect(kernel.opened).toEqual([]);
    expectTokenKept(kernel);
  });
});

// ---- A failure: the token is unchanged ----------------------------------------------------------------

describe("a setup that fails over a token", () => {
  const says = (): string => dialog().textContent ?? "";

  /** The mockup's `swf`, whatever the reason: one title, the token still connected, Close and Set up again, no Paste a token. */
  function expectFailedView(reason: GitHubAppSetupRefusal): void {
    const outcome = reason === "setup_expired" ? "expired" : reason === "token_write_scoped" ? "write-scoped" : "failed";
    expect(phase()).toBe(outcome);
    expect(screen.getByRole("heading", { name: "Setup didn't finish" })).toBeTruthy();
    const refusal = screen.getByTestId(IDS.appOutcome);
    expect(refusal.getAttribute("role")).toBe("alert");
    expect(refusal.textContent).toContain("GitHub didn't finish setting the App up, so nothing changed. GitHub is still connected through your token.");
    expect(says()).toContain("Try again. If it keeps failing, keep using the token: it works as before.");
    expect(says()).not.toContain("Nothing was connected");
    expect(says()).not.toContain("paste a token instead");
    expect(screen.queryByTestId(IDS.appPasteToken)).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up again" })).toBeTruthy();
    // The kernel's own words are untrusted data: not shown, and nothing parsed from them became markup.
    expect(says()).not.toContain("RAW-KERNEL-MESSAGE");
    expect(says()).not.toContain("/tmp/secret");
    expect(dialog().querySelector("b")).toBeNull();
  }

  it.each(REASONS)("%s as the refused field of a connector_status event", async (reason) => {
    const kernel = await startSwitch();
    event(kernel, { status: "connected", refused: reason, message: RAW });
    await waitFor(() => expect(phase()).not.toBe("create"));
    expectFailedView(reason);
    expect(rowWords()).toBe("connected · octo-owner · token");
    await waitFor(() => expect(requests(kernel, "GET /connectors").length).toBeGreaterThan(1));
    expectTokenKept(kernel);
  });

  it.each(REASONS)("%s as the setup route's refusal", async (reason) => {
    const kernel = await startScreen({ appSetup: () => refused(409, { error: reason, message: RAW }) });
    fireEvent.click(screen.getByTestId(IDS.switchToApp));
    await waitFor(() => expect(phase()).not.toBe("starting"));
    expectFailedView(reason);
    expect(kernel.opened).toEqual([]);
    expectTokenKept(kernel);
  });

  it("write-scoped lists the write permissions the refusal names, as text from GitHub", async () => {
    const kernel = await startSwitch();
    event(kernel, { refused: "token_write_scoped", write_permissions: [{ permission: "contents", level: "write" }, { permission: 5 }] });
    await waitFor(() => expect(phase()).toBe("write-scoped"));
    expect(within(dialog()).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Contents: write → set to Read-only"]);
    expect(says()).toContain("can write");
    expectTokenKept(kernel);
  });

  it("an unreachable kernel while starting is the same view, and no window is cancelled that was never opened", async () => {
    const kernel = await startScreen({ appSetup: () => UNREACHABLE });
    fireEvent.click(screen.getByTestId(IDS.switchToApp));
    await waitFor(() => expect(phase()).toBe("failed"));
    expect(says()).toContain("GitHub is still connected through your token.");
    expect(cancelCalls(kernel)).toHaveLength(0);
    expect(disconnectCalls(kernel)).toHaveLength(0);
  });

  it("a setup_url the channel refuses is the same view, and the window is not left open", async () => {
    const kernel = await startScreen();
    kernel.openAnswer = () => false;
    fireEvent.click(screen.getByTestId(IDS.switchToApp));
    await waitFor(() => expect(phase()).toBe("failed"));
    expect(says()).toContain("GitHub is still connected through your token.");
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    expectTokenKept(kernel);
  });

  it("Close leaves the token detail with focus back on Switch; Set up again is a fresh switch", async () => {
    const kernel = await startSwitch();
    event(kernel, { refused: "install_failed" });
    await waitFor(() => expect(phase()).toBe("failed"));
    fireEvent.click(screen.getByTestId(IDS.appAgain));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(setupCalls(kernel)).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Switch GitHub to the GitHub App" })).toBeTruthy();
    event(kernel, { refused: "conversion_failed" });
    await waitFor(() => expect(phase()).toBe("failed"));
    fireEvent.click(screen.getByTestId(IDS.appClose));
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId(IDS.switchToApp)));
    expect(disconnectCalls(kernel)).toHaveLength(0);
  });

  it("the token going away while the dialog is open (disconnected elsewhere) takes the token words off it", async () => {
    const kernel = await startSwitch();
    kernel.connectors = withRows(connector("disconnected"));
    event(kernel, { status: "disconnected" });
    await waitFor(() => expect(screen.getByTestId(IDS.empty)).toBeTruthy());
    expect(rowWords()).toBe("setting up the GitHub App · waiting for you on GitHub");
    expect(screen.getByRole("heading", { name: "Set up the GitHub App" })).toBeTruthy();
  });
});

// ---- The kernel unreachable ---------------------------------------------------------------------------

describe("the kernel unreachable on the token detail", () => {
  it("shows the band, keeps the last data, and disables Switch with the kernel's title like Replace and Disconnect", async () => {
    const kernel = await startScreen();
    kernel.connectors = () => UNREACHABLE;
    emit(kernel, "connector_status");
    await waitFor(() => expect(screen.getByTestId(IDS.band)).toBeTruthy());
    const button = screen.getByTestId(IDS.switchToApp) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Needs the kernel");
    for (const id of [IDS.replace, IDS.disconnect]) expect((screen.getByTestId(id) as HTMLButtonElement).title).toBe("Needs the kernel");
    expect(screen.getByTestId(IDS.account).textContent).toBe("octo-owner");
    fireEvent.click(button);
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
    expect(setupCalls(kernel)).toHaveLength(0);
  });
});

// ---- ⌘K ------------------------------------------------------------------------------------------------

describe("Switch GitHub to the GitHub App in the palette", () => {
  it("is registered under group Integrations with its title", async () => {
    const kernel = await startScreen();
    const found = command(kernel, SWITCH);
    expect(found.title).toBe("Switch GitHub to the GitHub App");
    expect(found.group).toBe("Integrations");
  });

  it.each([
    ["no row", [], false],
    ["a rejected row", [connector("rejected")], false],
    ["a disconnected row", [connector("disconnected")], false],
    ["connected", [connector("connected")], true],
    ["expiring", [connector("expiring")], true],
    ["expired", [connector("expired")], true],
    ["a connected App", [appConnector("connected")], false],
    ["a revoked App", [appConnector("rejected")], false],
  ] as const)("with %s: enabled is %s", async (_name, rows, want) => {
    const kernel = await startScreen({ connectors: withRows(...rows) });
    expect(command(kernel, SWITCH).enabled?.()).toBe(want);
  });

  it("follows the kernel: off while it is unreachable, on again when it answers", async () => {
    const kernel = await startScreen();
    expect(command(kernel, SWITCH).enabled?.()).toBe(true);
    kernel.connectors = () => UNREACHABLE;
    emit(kernel, "connector_status");
    await waitFor(() => expect(command(kernel, SWITCH).enabled?.()).toBe(false));
    kernel.connectors = withRows(connector("connected"));
    emit(kernel, "connector_status");
    await waitFor(() => expect(command(kernel, SWITCH).enabled?.()).toBe(true));
  });

  it("runs the same switch as the button: one setup call, no disconnect, and a second run while the dialog is open does nothing", async () => {
    const kernel = await startScreen();
    act(() => void command(kernel, SWITCH).run());
    await waitFor(() => expect(phase()).toBe("create"));
    expect(rowWords()).toBe("connected · octo-owner · token · setting up the App");
    act(() => void command(kernel, SWITCH).run());
    expect(setupCalls(kernel)).toHaveLength(1);
    expect(disconnectCalls(kernel)).toHaveLength(0);
    expect(kernel.opened).toEqual([SETUP_URL]);
  });

  it("does nothing when run while it is disabled (an App, no connection, an unreachable kernel)", async () => {
    const app = await startScreen({ connectors: withRows(appConnector("connected")) });
    act(() => void command(app, SWITCH).run());
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
    expect(setupCalls(app)).toHaveLength(0);
    cleanup();

    const empty = await startScreen({ connectors: withRows() });
    act(() => void command(empty, SWITCH).run());
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
    expect(setupCalls(empty)).toHaveLength(0);
  });
});
