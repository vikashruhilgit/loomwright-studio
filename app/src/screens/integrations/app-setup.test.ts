// @vitest-environment jsdom
// The GitHub App setup (GitHub App 4), at unit level: the pure model (refusal to
// view, event signals, GitHub links, the window's clock) and the dialog over the
// scripted kernel and its recording open-external channel. The channel itself and
// its allowlist are `app/electron/open-external.test.ts` and `main.test.ts`; the
// real flow against the fixture kernel is `app/e2e/integrations.spec.ts`.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Connector, EventFrame, GitHubAppSetupRefusal, TruncatedEventFrame } from "../../api/contract";
import { ok } from "../../store/fake-bridge";
import { IntegrationsView } from "./IntegrationsView";
import {
  APP_SETUP_REFUSALS,
  GITHUB_APPS_TEXT,
  INSTALLATIONS_URL,
  OUTCOME_OF_REFUSAL,
  appPageUrl,
  appRowMeta,
  closesAtText,
  msUntil,
  outcomeOfReply,
  outcomeOfRefusal,
  setupWindowOf,
  signalOfEvent,
  slugOf,
  stepOneDoneRow,
} from "./app-setup";
import { INTEGRATIONS_TEST_IDS as IDS, type Reply, replyOf } from "./model";
import { APP_SLUG, SETUP_URL, UNREACHABLE, appConnector, connector, createKernel, deferred, emit, refused, requests, startScreen as startPlainScreen } from "./test-support";
import type { Kernel, Setup } from "./test-support";

afterEach(() => {
  cleanup();
});

/** What the kernel's own words must never reach the screen as. */
const RAW = "RAW-KERNEL-MESSAGE <b>not markup</b> /tmp/secret";

const REASONS: readonly GitHubAppSetupRefusal[] = ["setup_not_open", "state_mismatch", "setup_expired", "conversion_failed", "install_failed", "token_write_scoped"];

// ---- The pure model ------------------------------------------------------------------------------

describe("outcomeOfRefusal", () => {
  it.each([
    ["setup_expired", "expired"],
    ["token_write_scoped", "write-scoped"],
    ["conversion_failed", "failed"],
    ["install_failed", "failed"],
    ["setup_not_open", "failed"],
    ["state_mismatch", "failed"],
    ["not_implemented", "failed"],
    ["something_new", "failed"],
    ["", "failed"],
    ["constructor", "failed"],
    ["__proto__", "failed"],
    ["toString", "failed"],
    [undefined, "failed"],
    [null, "failed"],
    [7, "failed"],
  ] as const)("%s shows the %s view", (reason, outcome) => {
    expect(outcomeOfRefusal(reason)).toBe(outcome);
  });

  it("maps every reason in the kernel's closed list, and the runtime list is exactly that list", () => {
    expect([...APP_SETUP_REFUSALS].sort()).toEqual([...REASONS].sort());
    for (const reason of REASONS) expect(OUTCOME_OF_REFUSAL[reason]).toBeDefined();
  });
});

describe("signalOfEvent", () => {
  const frame = (kind: string, payload: unknown): EventFrame => ({ type: "event", id: 9, at: "2026-10-30T09:00:00.000Z", kind, session_id: null, task_id: null, payload });

  it("only reads a connector_status event", () => {
    expect(signalOfEvent(frame("session_started", { refused: "setup_expired" }))).toBeUndefined();
  });

  it("an event without a refusal is progress, and carries a well-formed slug only", () => {
    expect(signalOfEvent(frame("connector_status", { status: "rejected" }))).toEqual({ kind: "progress", slug: undefined });
    expect(signalOfEvent(frame("connector_status", { refused: null, app_slug: APP_SLUG }))).toEqual({ kind: "progress", slug: APP_SLUG });
    expect(signalOfEvent(frame("connector_status", { refused: "", app_slug: "Bad/Slug" }))).toEqual({ kind: "progress", slug: undefined });
    expect(signalOfEvent(frame("connector_status", "not an object"))).toEqual({ kind: "progress", slug: undefined });
    expect(signalOfEvent(frame("connector_status", null))).toEqual({ kind: "progress", slug: undefined });
  });

  it("a refused value is checked against the closed list; an unknown one reads as setup-failed", () => {
    expect(signalOfEvent(frame("connector_status", { refused: "setup_expired" }))).toMatchObject({ kind: "refused", outcome: "expired" });
    expect(signalOfEvent(frame("connector_status", { refused: "token_write_scoped", write_permissions: [{ permission: "contents", level: "write" }] }))).toEqual({
      kind: "refused",
      outcome: "write-scoped",
      drops: ["Contents: write → set to Read-only"],
      slug: undefined,
    });
    expect(signalOfEvent(frame("connector_status", { refused: "brand_new_reason" }))).toMatchObject({ kind: "refused", outcome: "failed" });
    expect(signalOfEvent(frame("connector_status", { refused: { nested: true } }))).toMatchObject({ kind: "refused", outcome: "failed" });
  });

  it("a frame too large to carry its payload is progress, never a crash", () => {
    const truncated: TruncatedEventFrame = { type: "event", id: 3, kind: "connector_status", truncated: true } as unknown as TruncatedEventFrame;
    expect(signalOfEvent(truncated)).toEqual({ kind: "progress", slug: undefined });
  });
});

describe("outcomeOfReply", () => {
  const refusedReply = (error: string): Reply<unknown> => replyOf({ ok: false, status: 422, body: { error, message: RAW } });

  it("a refusal's error code picks the view; its message is never read", () => {
    for (const reason of REASONS) {
      const reply = refusedReply(reason);
      if (reply.kind === "ok") throw new Error("unreachable");
      expect(outcomeOfReply(reply).outcome).toBe(OUTCOME_OF_REFUSAL[reason]);
    }
    const unimplemented = replyOf({ ok: false, status: 501, body: { error: "not_implemented" } });
    if (unimplemented.kind === "ok") throw new Error("unreachable");
    expect(outcomeOfReply(unimplemented)).toEqual({ outcome: "failed", drops: [] });
  });

  it("an unreachable kernel or a failed call is setup-failed", () => {
    const unreachable = replyOf(UNREACHABLE);
    const failed = replyOf(undefined);
    if (unreachable.kind === "ok" || failed.kind === "ok") throw new Error("unreachable");
    expect(outcomeOfReply(unreachable).outcome).toBe("failed");
    expect(outcomeOfReply(failed).outcome).toBe("failed");
  });
});

describe("the GitHub links", () => {
  it("builds the App's page only for a well-formed slug", () => {
    expect(appPageUrl("loomwright-studio-x")).toBe("https://github.com/settings/apps/loomwright-studio-x");
    expect(appPageUrl("a")).toBe("https://github.com/settings/apps/a");
    for (const bad of ["", "-a", "A", "a/b", "a..b", "..", "a%2Fb", "a b", "a?b", "a#b", "a\nb", undefined, null, 3]) expect(appPageUrl(bad)).toBeUndefined();
  });

  it("the installations page and the apps address are fixed", () => {
    expect(INSTALLATIONS_URL).toBe("https://github.com/settings/installations");
    expect(GITHUB_APPS_TEXT).toBe("github.com/settings/apps");
    expect(slugOf("ok-slug-1")).toBe("ok-slug-1");
  });
});

describe("the setup window", () => {
  it("reads the clock without trusting the answer", () => {
    expect(msUntil("2026-10-30T09:10:00.000Z", Date.parse("2026-10-30T09:00:00.000Z"))).toBe(600_000);
    expect(msUntil("2026-10-30T08:00:00.000Z", Date.parse("2026-10-30T09:00:00.000Z"))).toBe(-3_600_000);
    expect(msUntil("not a time", 0)).toBeUndefined();
    expect(msUntil(null, 0)).toBeUndefined();
    expect(closesAtText("not a time")).toBeUndefined();
    expect(closesAtText(undefined)).toBeUndefined();
    expect(closesAtText("2026-10-30T09:10:00.000Z")).toMatch(/^\d\d:\d\d$/);
  });

  it("takes the setup route's answer only with a setup_url string", () => {
    expect(setupWindowOf({ setup_url: SETUP_URL, expires_at: "2026-10-30T09:10:00.000Z" })).toEqual({ setupUrl: SETUP_URL, expiresAt: "2026-10-30T09:10:00.000Z" });
    expect(setupWindowOf({ setup_url: SETUP_URL })).toEqual({ setupUrl: SETUP_URL, expiresAt: undefined });
    for (const bad of [undefined, null, "x", {}, { setup_url: "" }, { setup_url: 4 }]) expect(setupWindowOf(bad)).toBeUndefined();
  });

  it("step 1 is done on an App row with a slug and no installation yet", () => {
    expect(stepOneDoneRow(appConnector("rejected", { installation_id: null }))).toBe(true);
    expect(stepOneDoneRow(appConnector("rejected", { installation_id: undefined }))).toBe(true);
    expect(stepOneDoneRow(appConnector("connected"))).toBe(false);
    expect(stepOneDoneRow(appConnector("rejected", { installation_id: null, app_slug: null }))).toBe(false);
    expect(stepOneDoneRow(connector("rejected"))).toBe(false);
    expect(stepOneDoneRow(undefined)).toBe(false);
  });

  it("the list row's words follow the mockup's setup rows", () => {
    expect(appRowMeta({ kind: "create" })).toEqual({ dot: "working", text: "setting up the GitHub App · waiting for you on GitHub" });
    expect(appRowMeta({ kind: "outcome", outcome: "expired" }).text).toBe("not connected · setup timed out");
    expect(appRowMeta({ kind: "outcome", outcome: "cancelled" }).text).toBe("not connected · setup cancelled");
    expect(appRowMeta({ kind: "outcome", outcome: "write-scoped" }).text).toBe("not connected · the App can write");
    expect(appRowMeta({ kind: "outcome", outcome: "failed" }).text).toBe("not connected · setup did not finish");
  });
});

// ---- The dialog over the scripted kernel -----------------------------------------------------------------------

/** The screen over a scripted kernel, once its live feed is listening (an event emitted before that would be lost). */
async function startScreen(setup: Setup = {}): Promise<Kernel> {
  const kernel = await startPlainScreen(setup);
  await waitFor(() => expect(kernel.fake.listenerCount()).toBeGreaterThan(0));
  return kernel;
}

const none: Setup["connectors"] = () => ok({ connectors: [] });
const dialog = (): HTMLElement => screen.getByTestId(IDS.appSetup);
const phase = (): string | null => dialog().getAttribute("data-phase");
const setupCalls = (kernel: Kernel) => requests(kernel, "POST /connectors/github/app/setup");
const cancelCalls = (kernel: Kernel) => requests(kernel, "POST /connectors/github/app/setup/cancel");

/** The empty screen, the choice, and "Install GitHub App" pressed; resolves once the dialog is on step 1. */
async function startSetup(setup: Setup = {}): Promise<Kernel> {
  const kernel = await startScreen({ connectors: none, ...setup });
  fireEvent.click(screen.getByTestId(IDS.emptyConnect));
  fireEvent.click(screen.getByTestId(IDS.choiceApp));
  await waitFor(() => expect(phase()).not.toBe("starting"));
  return kernel;
}

const event = (kernel: Kernel, payload: Record<string, unknown> = {}): void => emit(kernel, "connector_status", { connector_id: 1, kind: "github", status: "rejected", ...payload });

describe("Install GitHub App", () => {
  it("calls the setup route once, opens the setup_url through the channel, and the window does not navigate", async () => {
    const before = window.location.href;
    const kernel = await startSetup();
    expect(setupCalls(kernel)).toHaveLength(1);
    expect(kernel.opened).toEqual([SETUP_URL]);
    expect(window.location.href).toBe(before);
    expect(screen.queryByTestId(IDS.choice)).toBeNull();
    expect(phase()).toBe("create");
    expect(screen.getByRole("dialog").textContent).toContain("Set up the GitHub App");
    expect(screen.getByTestId(IDS.appSteps).getAttribute("data-step")).toBe("1");
    // The list row follows the dialog.
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("setting up the GitHub App · waiting for you on GitHub");
  });

  it("makes one setup call even when React mounts the dialog twice (StrictMode)", async () => {
    const kernel = createKernel({ connectors: none });
    render(createElement(StrictMode, null, createElement(IntegrationsView, { api: kernel.fake.bridge, registry: kernel.registry })));
    await waitFor(() => expect(screen.getByTestId(IDS.emptyConnect)).toBeTruthy());
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(setupCalls(kernel)).toHaveLength(1);
    expect(kernel.opened).toEqual([SETUP_URL]);
  });

  it("moves to step 2 on a connector_status event that is not a refusal, and ignores events from before the dialog", async () => {
    const kernel = await startScreen({ connectors: none });
    event(kernel, {});
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(screen.getByTestId(IDS.appSteps).getAttribute("data-step")).toBe("1");
    event(kernel, {});
    await waitFor(() => expect(phase()).toBe("install"));
    expect(screen.getByTestId(IDS.appSteps).getAttribute("data-step")).toBe("2");
    expect(screen.getByTestId(IDS.appStep1).textContent).toContain("done");
    expect(screen.getByTestId(IDS.appStep2).textContent).toContain("waiting for you");
    expect(dialog().textContent).toContain("choose the repos Studio may read, then click Install");
  });

  it("shows when the window closes, from the setup route's expires_at", async () => {
    await startSetup({ appSetup: () => ok({ setup_url: SETUP_URL, expires_at: "2026-10-30T09:12:00.000Z" }) });
    expect(screen.getByTestId(IDS.appCloses).textContent).toMatch(/^This setup window closes at \d\d:\d\d\.$/);
  });

  it("closes the dialog and shows the App's detail once the connector reads connected as an App", async () => {
    const kernel = await startSetup();
    kernel.connectors = () => ok({ connectors: [appConnector("connected")] });
    event(kernel, { status: "connected", method: "app" });
    await waitFor(() => expect(screen.queryByTestId(IDS.appSetup)).toBeNull());
    await waitFor(() => expect(screen.getByTestId(IDS.detail).getAttribute("data-method")).toBe("app"));
    // A finished setup is never cancelled afterwards.
    expect(cancelCalls(kernel)).toHaveLength(0);
  });
});

describe("Cancel, Escape and the backdrop", () => {
  it("Cancel calls the cancel route once and shows setup-cancelled; Set up again starts a fresh setup", async () => {
    const kernel = await startSetup();
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    expect(phase()).toBe("cancelled");
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    expect(dialog().textContent).toContain("Setup cancelled");
    expect(dialog().textContent).toContain("Nothing was connected, and the setup window is closed.");
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("not connected · setup cancelled");

    fireEvent.click(screen.getByTestId(IDS.appAgain));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(setupCalls(kernel)).toHaveLength(2);
    expect(kernel.opened).toEqual([SETUP_URL, SETUP_URL]);
    expect(cancelCalls(kernel)).toHaveLength(1);
  });

  it("Escape cancels the same way, once", async () => {
    const kernel = await startSetup();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(phase()).toBe("cancelled");
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    // A second Escape, on the cancelled view, only closes it: no second cancel.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
    expect(cancelCalls(kernel)).toHaveLength(1);
  });

  it("a press on the backdrop cancels; a press inside the panel does not", async () => {
    const kernel = await startSetup();
    fireEvent.mouseDown(dialog());
    expect(phase()).toBe("create");
    fireEvent.mouseDown(dialog().parentElement as HTMLElement);
    expect(phase()).toBe("cancelled");
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
  });

  it("Close on the cancelled view returns to the screen with nothing connected", async () => {
    const kernel = await startSetup();
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    fireEvent.click(screen.getByTestId(IDS.appClose));
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("not connected");
    expect(cancelCalls(kernel)).toHaveLength(1);
  });

  it("cancelling before the setup call is answered opens nothing, and cancels the window the answer opened", async () => {
    const answer = deferred<ReturnType<typeof ok>>();
    const kernel = await startScreen({ connectors: none, appSetup: () => answer.promise });
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    expect(phase()).toBe("starting");
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    expect(phase()).toBe("cancelled");
    expect(cancelCalls(kernel)).toHaveLength(0);
    await act(async () => answer.resolve(ok({ setup_url: SETUP_URL, expires_at: new Date(Date.now() + 600_000).toISOString() })));
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    expect(kernel.opened).toEqual([]);
  });

  it("says so when the kernel could not be told to close the window", async () => {
    const kernel = await startSetup({ appCancel: () => UNREACHABLE });
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    await waitFor(() => expect(dialog().textContent).toContain("couldn't reach the kernel to close the setup window"));
    expect(cancelCalls(kernel)).toHaveLength(1);
  });

  it("a dialog that goes away while the setup runs cancels its window", async () => {
    const kernel = await startSetup();
    cleanup();
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
  });
});

describe("Open GitHub again", () => {
  it("opens the same setup_url again with no second setup call", async () => {
    const kernel = await startSetup();
    fireEvent.click(screen.getByTestId(IDS.appOpenAgain));
    await waitFor(() => expect(kernel.opened).toEqual([SETUP_URL, SETUP_URL]));
    expect(setupCalls(kernel)).toHaveLength(1);
    expect(phase()).toBe("create");
  });
});

describe("setup-expired", () => {
  it("shows once the window's expires_at passes, and Set up again starts a fresh setup", async () => {
    const kernel = await startSetup({ appSetup: () => ok({ setup_url: SETUP_URL, expires_at: new Date(Date.now() + 150).toISOString() }) });
    await waitFor(() => expect(phase()).toBe("expired"));
    expect(dialog().textContent).toContain("Setup timed out");
    expect(dialog().textContent).toMatch(/The setup window closed at \d\d:\d\d, before GitHub came back to Studio\. Nothing was connected\./);
    kernel.appSetup = () => ok({ setup_url: SETUP_URL, expires_at: new Date(Date.now() + 600_000).toISOString() });
    fireEvent.click(screen.getByTestId(IDS.appAgain));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(setupCalls(kernel)).toHaveLength(2);
    // The kernel closed that window itself: nothing to cancel.
    expect(cancelCalls(kernel)).toHaveLength(0);
  });

  it("shows on a connector_status event refusing setup_expired", async () => {
    const kernel = await startSetup();
    event(kernel, { refused: "setup_expired", message: RAW });
    await waitFor(() => expect(phase()).toBe("expired"));
    expect(dialog().textContent).not.toContain("RAW-KERNEL");
    fireEvent.click(screen.getByTestId(IDS.appAgain));
    await waitFor(() => expect(setupCalls(kernel)).toHaveLength(2));
  });
});

describe("every refusal shows the mockup's copy, never the kernel's message", () => {
  const COPY = {
    expired: { title: "Setup timed out", text: "Nothing was connected." },
    "write-scoped": { title: "The App can write", text: "GitHub reports that the App you installed can write" },
    failed: { title: "Setup didn't finish", text: "GitHub didn't finish setting the App up." },
  } as const;

  /** A refusal's view is never `cancelled`: that one is the owner's own. */
  const viewOf = (reason: GitHubAppSetupRefusal): keyof typeof COPY => OUTCOME_OF_REFUSAL[reason] as keyof typeof COPY;

  const expectCopy = (outcome: keyof typeof COPY): void => {
    expect(phase()).toBe(outcome);
    const text = dialog().textContent ?? "";
    expect(screen.getByRole("heading", { name: COPY[outcome].title })).toBeTruthy();
    expect(text).toContain(COPY[outcome].text);
    // The kernel's words are untrusted data: not shown, and nothing parsed from them became markup.
    expect(text).not.toContain("RAW-KERNEL-MESSAGE");
    expect(text).not.toContain("/tmp/secret");
    expect(dialog().querySelector("b")).toBeNull();
  };

  it.each(REASONS)("as the refused field of a connector_status event: %s", async (reason) => {
    const kernel = await startSetup();
    event(kernel, { refused: reason, message: RAW });
    await waitFor(() => expect(phase()).toBe(viewOf(reason)));
    expectCopy(viewOf(reason));
  });

  it.each(REASONS)("as the setup route's refusal: %s", async (reason) => {
    await startScreen({ connectors: none, appSetup: () => refused(409, { error: reason, message: RAW }) });
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe(viewOf(reason)));
    expectCopy(viewOf(reason));
  });

  it("not_implemented (the route before the kernel item lands) and an unknown code show setup-failed's copy", async () => {
    await startScreen({ connectors: none, appSetup: () => refused(501, { error: "not_implemented", message: RAW }) });
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("failed"));
    expectCopy("failed");
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("not connected · setup did not finish");

    cleanup();
    const kernel = await startSetup();
    event(kernel, { refused: "a_reason_the_app_does_not_know", message: RAW });
    await waitFor(() => expect(phase()).toBe("failed"));
    expectCopy("failed");
  });

  it("an unreachable kernel while starting is setup-failed, and no window is cancelled that was never opened", async () => {
    const kernel = await startScreen({ connectors: none, appSetup: () => UNREACHABLE });
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("failed"));
    expect(kernel.opened).toEqual([]);
    expect(cancelCalls(kernel)).toHaveLength(0);
  });

  it("the first outcome stands: a refusal after Cancel does not replace the cancelled view", async () => {
    const kernel = await startSetup();
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    event(kernel, { refused: "install_failed" });
    await waitFor(() => expect(requests(kernel, "GET /connectors").length).toBeGreaterThan(1));
    expect(phase()).toBe("cancelled");
  });

  it("write-scoped lists the permissions the event names, from GitHub", async () => {
    const kernel = await startSetup();
    event(kernel, { refused: "token_write_scoped", write_permissions: [{ permission: "contents", level: "write" }, { permission: 5 }] });
    await waitFor(() => expect(phase()).toBe("write-scoped"));
    expect(within(dialog()).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Contents: write → set to Read-only"]);
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("not connected · the App can write");
    fireEvent.click(screen.getByTestId(IDS.appAgain));
    await waitFor(() => expect(setupCalls(kernel)).toHaveLength(2));
  });
});

describe("the channel refuses the setup_url", () => {
  it("shows setup-failed's copy, never nothing, and does not leave the window open", async () => {
    const kernel = await startScreen({ connectors: none });
    kernel.openAnswer = () => false;
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("failed"));
    expect(dialog().textContent).toContain("GitHub didn't finish setting the App up.");
    expect(kernel.opened).toEqual([SETUP_URL]);
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
  });

  it("a bridge without the channel is the same", async () => {
    const kernel = await startScreen({ connectors: none });
    delete kernel.fake.bridge.openExternal;
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("failed"));
    expect(setupCalls(kernel)).toHaveLength(1);
  });

  it("Open GitHub again being refused is setup-failed too", async () => {
    const kernel = await startSetup();
    kernel.openAnswer = () => false;
    fireEvent.click(screen.getByTestId(IDS.appOpenAgain));
    await waitFor(() => expect(phase()).toBe("failed"));
    expect(setupCalls(kernel)).toHaveLength(1);
  });

  it("a setup answer without a usable setup_url is setup-failed and opens nothing", async () => {
    const kernel = await startScreen({ connectors: none, appSetup: () => ok({ expires_at: "2026-10-30T09:12:00.000Z" }) });
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("failed"));
    expect(kernel.opened).toEqual([]);
  });
});

describe("the links in the outcome views", () => {
  it("link to the App's page when the event carries its slug, through the channel", async () => {
    const kernel = await startSetup();
    event(kernel, { refused: "setup_expired", app_slug: APP_SLUG });
    await waitFor(() => expect(phase()).toBe("expired"));
    const link = screen.getByTestId(IDS.appLink);
    expect(link.tagName).toBe("A");
    expect(link.textContent).toContain("Open your GitHub Apps");
    expect(fireEvent.click(link)).toBe(false);
    await waitFor(() => expect(kernel.opened.at(-1)).toBe(`https://github.com/settings/apps/${APP_SLUG}`));
  });

  it("show the address as text when no slug is known, and never link the bare apps page", async () => {
    const kernel = await startSetup();
    event(kernel, { refused: "setup_expired", app_slug: "Not/A/Slug" });
    await waitFor(() => expect(phase()).toBe("expired"));
    expect(within(dialog()).queryByRole("link")).toBeNull();
    expect(screen.getByTestId(IDS.appLink).textContent).toContain("github.com/settings/apps");
    expect(kernel.opened).toEqual([SETUP_URL]);
  });
});

describe("Paste a token instead", () => {
  it("leaves setup for the token form, unticked and empty", async () => {
    const kernel = await startSetup();
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    fireEvent.click(screen.getByTestId(IDS.appPasteToken));
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
    expect((screen.getByTestId(IDS.sheetToken) as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId(IDS.sheetDeclare) as HTMLInputElement).checked).toBe(false);
    expect(requests(kernel, "POST /connectors/github/token")).toHaveLength(0);
  });
});

describe("the kernel unreachable", () => {
  it("turns Install GitHub App off with the shared band, makes no setup call and opens nothing", async () => {
    const kernel = await startScreen({ connectors: none });
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    kernel.connectors = () => UNREACHABLE;
    event(kernel, {});
    await waitFor(() => expect(screen.getByTestId(IDS.band)).toBeTruthy());
    const button = screen.getByTestId(IDS.choiceApp) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(setupCalls(kernel)).toHaveLength(0);
    expect(kernel.opened).toEqual([]);
    expect(screen.queryByTestId(IDS.appSetup)).toBeNull();
  });
});

describe("a connector the setup left behind", () => {
  it("a rejected App row without an installation reads as not connected, not as a revoked App", async () => {
    await startScreen({ connectors: () => ok({ connectors: [appConnector("rejected", { installation_id: null })] }) });
    expect(screen.getByTestId(IDS.empty)).toBeTruthy();
    expect(screen.getByTestId(IDS.listMeta).textContent).not.toContain("GitHub no longer accepts");
  });
});

describe("the list row and the dialog are one state", () => {
  /** Every DOM change while the dialog is on `view`, the row's words as they were at that moment. */
  function watchRow(view: string): string[] {
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      if (screen.queryByTestId(IDS.appSetup)?.getAttribute("data-phase") === view) seen.push(screen.getByTestId(IDS.listMeta).textContent ?? "");
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    cleanups.push(() => observer.disconnect());
    return seen;
  }
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const stop of cleanups.splice(0)) stop();
  });

  it("the row never lags the dialog, even for one commit (a refused setup)", async () => {
    await startScreen({ connectors: none, appSetup: () => refused(501, { error: "not_implemented" }) });
    const seen = watchRow("failed");
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("failed"));
    expect(screen.getByTestId(IDS.listMeta).textContent).toBe("not connected · setup did not finish");
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(["not connected · setup did not finish"]));
  });

  it("nor on Cancel, nor from the first commit of the dialog", async () => {
    const kernel = await startScreen({ connectors: none });
    const waiting = "setting up the GitHub App · waiting for you on GitHub";
    const starting = watchRow("starting");
    fireEvent.click(screen.getByTestId(IDS.emptyConnect));
    fireEvent.click(screen.getByTestId(IDS.choiceApp));
    await waitFor(() => expect(phase()).toBe("create"));
    expect(new Set(starting)).toEqual(new Set([waiting]));
    const cancelled = watchRow("cancelled");
    fireEvent.click(screen.getByTestId(IDS.appCancel));
    await waitFor(() => expect(cancelCalls(kernel)).toHaveLength(1));
    expect(cancelled.length).toBeGreaterThan(0);
    expect(new Set(cancelled)).toEqual(new Set(["not connected · setup cancelled"]));
  });
});
