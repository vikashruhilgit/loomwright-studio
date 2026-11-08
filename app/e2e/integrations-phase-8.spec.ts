// The Integrations screen's phase 8 views in the built app against the fixture kernel (`./fixtures/integrations.ts`):
// Jira and ClickUp connect (R1, S1), the GitHub App's "needs new permissions" upgrade (R2, S2), the repo policy card
// (R3, R4, S3) and the screen with nothing connected (R5, invariant 5). Run `npm run build` first.
//
// `shell.openExternal` is replaced in the main process before any click (`open` does it for every test), so no run can
// open a real browser; the addresses the main process would have opened are read back from it. That is what R2 and R1
// assert: the recorded address is exactly the one the fixture kernel answered (the MCP `authorize_url`, the App
// upgrade `url`), which the main process opens only because it remembered the kernel's `studio:request` answer. The
// window must never navigate: the page URL is asserted unchanged around every open.
//
// Screenshots (S9): with `PHASE8_POLISH_EVIDENCE=1` they are written to the committed evidence dir
// `docs/evidence/phase-8-polish/integrations/` (after deleting any PNG there this spec no longer names);
// otherwise to Playwright's per-test output dir, so a plain run never dirties tracked files, and a test asserts nothing
// under the tracked dir changed during the run. The spec asserts behaviour, never pixels: fonts differ between macOS and
// CI. The last tests hold the README, the folder and this spec's list of states to the same names.
//
// Regenerate (macOS): `cd app && npm run build && PHASE8_POLISH_EVIDENCE=1 npx playwright test e2e/integrations-phase-8.spec.ts --workers=1`
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { MASON_MCP_TOOLS, MCP_KINDS, MCP_REFUSAL_MESSAGE, MCP_SERVER, MCP_TOOLS, POLICY_REPOS, UPGRADE_URL, integrationsFixture, policyRepos } from "./fixtures/integrations";
import type { IntegrationsFixture, IntegrationsFixtureOptions, McpKind } from "./fixtures/integrations";

const EVIDENCE = process.env.PHASE8_POLISH_EVIDENCE === "1";
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-8-polish/integrations/", import.meta.url));
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** Tall enough that a repo policy card, with all three ways on listed or its presets open, is in view. */
const SHOT_SIZE = { width: 1180, height: 1140 } as const;

/** The views each of Jira and ClickUp is drawn in, then the App's, then the policy card's (the mockup's `phase-8.html` views). */
const MCP_VIEWS = ["empty", "connecting", "connected", "expired", "refused", "disconnect"] as const;
const SHOT_STATES = [
  ...MCP_KINDS.flatMap((kind) => MCP_VIEWS.map((view) => `${kind}-${view}`)),
  "app-needs-permissions",
  "policy-proposed",
  "policy-none",
  "policy-unenforceable",
  "policy-trust-confirm",
  "policy-accepted",
] as const;
type ShotState = (typeof SHOT_STATES)[number];
const shotName = (state: string, theme: Theme): string => `integrations-${state}-${theme}.png`;
const EXPECTED = SHOT_STATES.flatMap((state) => THEMES.map((theme) => shotName(state, theme)));

/**
 * The screen's test ids, as `INTEGRATIONS_TEST_IDS` in `src/screens/integrations/model.ts` has them. They are copied, not
 * imported: that module pulls in Team's model and so the Sessions screen's `.tsx`, which the e2e project's
 * `tsconfig.node.json` (no `jsx`) cannot type-check. The last test reads `model.ts` and fails if any id below is not one
 * of its values, so a renamed id cannot drift unnoticed.
 */
const IDS = {
  screen: "screen-integrations",
  count: "integrations-count",
  empty: "integrations-empty",
  emptyConnect: "integrations-connect",
  choice: "integrations-choice",
  detail: "integrations-detail",
  appSessionScope: "integrations-app-session-scope",
  rowPolicy: "integrations-row-policy",
  rowJira: "integrations-row-jira",
  rowClickup: "integrations-row-clickup",
  mcp: "integrations-mcp",
  mcpStub: "integrations-mcp-stub",
  mcpConnect: "integrations-mcp-connect",
  mcpWait: "integrations-mcp-wait",
  mcpWaitCloses: "integrations-mcp-wait-closes",
  mcpOpenAgain: "integrations-mcp-open-again",
  mcpCancel: "integrations-mcp-cancel",
  mcpRefused: "integrations-mcp-refused",
  mcpRefusedMessage: "integrations-mcp-refused-message",
  mcpRetry: "integrations-mcp-retry",
  mcpDismiss: "integrations-mcp-dismiss",
  mcpExpired: "integrations-mcp-expired",
  mcpReconnect: "integrations-mcp-reconnect",
  mcpDisconnect: "integrations-mcp-disconnect",
  mcpDisconnectConfirm: "integrations-mcp-disconnect-confirm",
  mcpWorkspace: "integrations-mcp-workspace",
  mcpTool: "integrations-mcp-tool",
  mcpToolCell: "integrations-mcp-tool-cell",
  mcpTeam: "integrations-mcp-team",
  upgrade: "integrations-upgrade",
  upgradeAccept: "integrations-upgrade-accept",
  upgradeAddress: "integrations-upgrade-address",
  upgradeCheck: "integrations-upgrade-check",
  upgradeError: "integrations-upgrade-error",
  upgradeScope: "integrations-upgrade-scope",
  policy: "integrations-policy",
  policyEmpty: "integrations-policy-empty",
  policyChip: "integrations-policy-chip",
  policyCard: "integrations-policy-card",
  policyDetected: "integrations-policy-detected",
  policyRedetect: "integrations-policy-redetect",
  policyProposal: "integrations-policy-proposal",
  policyAccept: "integrations-policy-accept",
  policyNone: "integrations-policy-none",
  policyChoices: "integrations-policy-choices",
  policyMakePublic: "integrations-policy-make-public",
  policyUpgrade: "integrations-policy-upgrade",
  policyLinkError: "integrations-policy-link-error",
  policyTrust: "integrations-policy-trust",
  policyTrustConfirm: "integrations-policy-trust-confirm",
  policyTrusting: "integrations-policy-trusting",
  policySafe: "integrations-policy-safe",
  policySafeView: "integrations-policy-safe-view",
  policyPreset: "integrations-policy-preset",
  policyReviews: "integrations-policy-reviews",
  policySet: "integrations-policy-set",
  policyCurrent: "integrations-policy-current",
  policyChange: "integrations-policy-change",
  policyStatus: "integrations-policy-status",
} as const;
const MODEL_SOURCE = fileURLToPath(new URL("../src/screens/integrations/model.ts", import.meta.url));

/** When this run began, for the guard that the tracked evidence dir is untouched without `PHASE8_POLISH_EVIDENCE`. */
const RUN_START = Date.now();

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
const pageErrors: string[] = [];

// The evidence folder holds exactly this spec's screenshots: a renamed or removed state leaves no stale PNG. Only a PNG that
// is no longer one of the listed names goes, never one a state still writes, so a worker restart after a failed test (which
// runs this hook again) cannot delete the shots the earlier tests wrote.
test.beforeAll(() => {
  if (!EVIDENCE) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const file of readdirSync(EVIDENCE_DIR)) if (file.endsWith(".png") && !EXPECTED.includes(file)) rmSync(join(EVIDENCE_DIR, file));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
  // Drained per test, so an error is reported against the test that caused it.
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

/** Launch the built app on a fixture kernel serving `fx`, and open Integrations by its hash. */
async function open(fx: IntegrationsFixture): Promise<Page> {
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  app = await launchApp(fixture.env);
  await stubOpenExternal(app);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  // The shots are taken still, as under the owner's reduced-motion setting, in a window tall enough for a policy card.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await app.evaluate(({ BrowserWindow }, size) => {
    for (const win of BrowserWindow.getAllWindows()) win.setContentSize(size.width, size.height);
  }, SHOT_SIZE);
  await page.evaluate(() => {
    window.location.hash = "#/integrations";
  });
  await expect(page.getByTestId(IDS.screen)).toBeVisible();
  // The feed is up, so an event the kernel appends from here on reaches the screen.
  const running = fixture;
  await expect.poll(() => running.requests.some((request) => request.path === "/events/stream")).toBe(true);
  return page;
}

/**
 * Replaces `shell.openExternal` in the main process with a recorder, so the app can never open a real browser: the
 * address the main process would have opened is pushed onto `globalThis.__opened` instead, and `openedUrls` reads it.
 * Runs before any click. The stub resolves like the real call, so the channel answers `true` for an allowed address.
 */
async function stubOpenExternal(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __opened?: string[] };
    g.__opened = [];
    shell.openExternal = (url: string): Promise<void> => {
      g.__opened?.push(url);
      return Promise.resolve();
    };
  });
}

/** Every address the main process was asked to open since launch, in order. */
async function openedUrls(): Promise<string[]> {
  if (app === undefined) throw new Error("no app is running");
  return app.evaluate(() => (globalThis as unknown as { __opened?: string[] }).__opened ?? []);
}

/** `open` for a fixture made from `options`. */
function launchWith(options: IntegrationsFixtureOptions = {}): { readonly fx: IntegrationsFixture; readonly page: Promise<Page> } {
  const fx = integrationsFixture(options);
  return { fx, page: open(fx) };
}

const byId = (page: Page, id: string): Locator => page.getByTestId(id);
const connectorReads = (): number => fixture?.requests.filter((r) => r.method === "GET" && r.path === "/connectors").length ?? 0;

/** The first of `list`, or a failure naming `what`: a list the fixture was expected to have filled. */
function first(list: readonly string[], what: string): string {
  const [head] = list;
  if (head === undefined) throw new Error(`the fixture kernel recorded no ${what}`);
  return head;
}

async function setTheme(page: Page, theme: Theme | undefined): Promise<void> {
  await page.evaluate((value) => {
    if (value === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  }, theme);
}

/** Resolves after two animation frames, so any pending React commit and layout have landed. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * `integrations-<state>-light.png` and `-dark.png` of the whole window; the dark tokens must really apply. `state` is one of
 * the spec's listed states, so a shot the README does not name cannot be written.
 */
async function shoot(page: Page, state: ShotState, testInfo: TestInfo): Promise<void> {
  const dir = EVIDENCE ? EVIDENCE_DIR : testInfo.outputPath("shots");
  mkdirSync(dir, { recursive: true });
  await page.mouse.move(0, 0);
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const path = join(dir, shotName(state, theme));
    await page.screenshot({ path, animations: "disabled", scale: "css" });
    expect(statSync(path).size, `${shotName(state, theme)} was written`).toBeGreaterThan(1000);
  }
  expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);
  await setTheme(page, undefined);
}

/** The address of `target` is exactly what the kernel answered: https, any host, the parser's own spelling. */
function expectHttps(url: string, what: string): void {
  const parsed = new URL(url);
  expect([parsed.protocol, parsed.username, parsed.hash, parsed.href], `${what} is a plain https address`).toEqual(["https:", "", "", url]);
}

const NAMES: Readonly<Record<McpKind, { readonly name: string; readonly vendor: string; readonly row: string }>> = {
  jira: { name: "Jira", vendor: "Atlassian", row: IDS.rowJira },
  clickup: { name: "ClickUp", vendor: "ClickUp", row: IDS.rowClickup },
};

// ---- R1, S1: Jira and ClickUp -----------------------------------------------------------------------------------

for (const kind of MCP_KINDS) {
  const { name, vendor, row } = NAMES[kind];

  test(`R1, S1: ${name} Connect makes one connect call, waits with the window's close time and opens exactly the authorize_url; Cancel calls the cancel route once; the connected pane shows the workspace and the granted tools; Disconnect asks first`, async ({}, testInfo) => {
    const { fx, page: opening } = launchWith({ masonTools: MASON_MCP_TOOLS });
    const page = await opening;
    const home = page.url();
    const pane = byId(page, IDS.mcp);
    const wait = byId(page, IDS.mcpWait);

    // Not connected: one Connect, and Jira always carries the stub note.
    await byId(page, row).click();
    await expect(pane).toHaveAttribute("data-kind", kind);
    await expect(pane).toHaveAttribute("data-state", "none");
    await expect(pane.getByRole("heading", { level: 2 })).toHaveText(`Connect ${name} so a playbook can read your tickets.`);
    await expect(byId(page, IDS.mcpConnect)).toHaveCount(1);
    await expect(byId(page, IDS.mcpConnect)).toHaveText(`Connect ${name}`);
    await expect(byId(page, row)).toContainText("not connected");
    if (kind === "jira") await expect(byId(page, IDS.mcpStub)).toContainText("Work account · stub only");
    else await expect(byId(page, IDS.mcpStub)).toHaveCount(0);
    expect(fx.mcpConnects, "nothing is connected by looking").toEqual([]);
    await shoot(page, `${kind}-empty`, testInfo);

    // R1: one connect call; the wait shows the window's expires_at; the returned authorize_url opens through the channel, and only that.
    await byId(page, IDS.mcpConnect).click();
    await expect(wait).toHaveAttribute("data-phase", "waiting");
    expect(fx.mcpConnects, "exactly one connect call").toEqual([kind]);
    const url = first(fx.mcpUrls, "authorize_url");
    expectHttps(url, "the authorize_url");
    await expect.poll(openedUrls, { message: "the main process was asked to open exactly the returned authorize_url" }).toEqual([url]);
    await expect(wait).toHaveAttribute("data-expires-at", first(fx.mcpExpiries, "expires_at"));
    await expect(byId(page, IDS.mcpWaitCloses)).toContainText("This window closes at");
    await expect(wait).toContainText(`Waiting for you at ${vendor}`);
    await expect(pane).toHaveAttribute("data-state", "connecting");
    await expect(byId(page, row)).toContainText("connecting");
    expect(page.url(), "the Studio window did not navigate").toBe(home);
    expect(app?.windows().length, "no second window opened").toBe(1);
    await shoot(page, `${kind}-connecting`, testInfo);

    // "Open again" reopens the same address with no second connect call.
    await byId(page, IDS.mcpOpenAgain).click();
    await expect.poll(openedUrls).toEqual([url, url]);
    expect(fx.mcpConnects, "no second connect call").toEqual([kind]);

    // Cancel during the wait: one cancel call, nothing connected.
    await byId(page, IDS.mcpCancel).click();
    await expect(pane).toHaveAttribute("data-state", "none");
    await expect.poll(() => fx.mcpCancels.length, { message: "the kernel received the cancel" }).toBe(1);
    expect(fx.mcpCancels).toEqual([kind]);
    await expect(byId(page, IDS.mcpConnect)).toHaveCount(1);

    // A fresh press is a fresh window with its own address.
    await byId(page, IDS.mcpConnect).click();
    await expect(wait).toHaveAttribute("data-phase", "waiting");
    expect(fx.mcpConnects).toEqual([kind, kind]);
    const [, second] = fx.mcpUrls;
    expect(second, "the second window has its own authorize_url").not.toBe(url);
    await expect.poll(openedUrls).toEqual([url, url, second]);

    // An event alone is not success: the screen reads GET /connectors again, and the row is what it shows.
    const readsBefore = connectorReads();
    fx.changeMcp(kind, "connected");
    await expect(pane).toHaveAttribute("data-state", "connected");
    expect(connectorReads(), "the event made the screen read GET /connectors again").toBeGreaterThan(readsBefore);
    await expect(byId(page, IDS.mcpWorkspace)).toHaveText(MCP_SERVER[kind]);
    await expect(byId(page, row)).toContainText(`connected · ${MCP_SERVER[kind]}`);
    const tools = await byId(page, IDS.mcpTool).evaluateAll((rows) => rows.map((r) => r.getAttribute("data-tool")));
    expect(tools, "the granted tools are the row's, in its order").toEqual([...MCP_TOOLS[kind]]);
    // Mason holds the reads, not the tool that changes things (his GET /agents/mason carries connectors[<kind>]).
    for (const tool of MCP_TOOLS[kind]) {
      const cell = page.locator(`[data-testid="${IDS.mcpTool}"][data-tool="${tool}"] [data-testid="${IDS.mcpToolCell}"][data-agent-id="mason"]`);
      await expect(cell, `Mason and ${tool}`).toHaveAttribute("data-state", MASON_MCP_TOOLS[kind].includes(tool) ? "granted" : "not_granted");
    }
    await expect(byId(page, IDS.mcpTeam)).toHaveAttribute("href", "#/team");
    expect(fx.mcpConnects, "the connect was one call per press, none for the success").toEqual([kind, kind]);
    expect(fx.mcpCancels, "a connected window is not cancelled").toEqual([kind]);
    await shoot(page, `${kind}-connected`, testInfo);

    // Disconnect asks first: no request until the owner confirms.
    await byId(page, IDS.mcpDisconnect).click();
    const confirm = page.getByRole("alertdialog", { name: `Disconnect ${name}?` });
    await expect(confirm).toBeVisible();
    await expect(byId(page, IDS.mcpDisconnectConfirm)).toContainText(`Studio can't remove its access at ${vendor}`);
    expect(fx.mcpDisconnects, "nothing is sent while the confirm is open").toEqual([]);
    await shoot(page, `${kind}-disconnect`, testInfo);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    expect(fx.mcpDisconnects, "Cancel sends nothing").toEqual([]);
    await expect(pane).toHaveAttribute("data-state", "connected");

    await byId(page, IDS.mcpDisconnect).click();
    await confirm.getByRole("button", { name: "Disconnect" }).click();
    await expect.poll(() => fx.mcpDisconnects.length, { message: "the kernel received the disconnect" }).toBe(1);
    expect(fx.mcpDisconnects).toEqual([kind]);
    await expect(confirm).toHaveCount(0);
    await expect(pane).toHaveAttribute("data-state", "none");
    await expect(byId(page, row)).toContainText("not connected");
    expect(page.url()).toBe(home);
  });

  test(`S1: ${name} expired shows its own band and Reconnect; a refused connect shows the vendor's own copy with the kernel's message as text, and any other refusal the generic copy and its code`, async ({}, testInfo) => {
    const { fx, page: opening } = launchWith({ mcp: { [kind]: "connected" }, masonTools: MASON_MCP_TOOLS });
    const page = await opening;
    const pane = byId(page, IDS.mcp);
    await byId(page, row).click();
    await expect(pane).toHaveAttribute("data-state", "connected");

    // The kernel marks the connection expired (the vendor refused a refresh): the screen follows the event.
    fx.changeMcp(kind, "expired");
    await expect(pane).toHaveAttribute("data-state", "expired");
    await expect(byId(page, IDS.mcpExpired)).toContainText(`${vendor} no longer accepts Studio's token`);
    await expect(byId(page, IDS.mcpExpired)).toHaveAttribute("role", "alert");
    await expect(byId(page, IDS.mcpReconnect)).toBeVisible();
    await expect(byId(page, row)).toContainText("expired");
    await expect(byId(page, IDS.mcpWorkspace), "the last-read workspace is kept").toHaveText(MCP_SERVER[kind]);
    await shoot(page, `${kind}-expired`, testInfo);

    // Reconnect is a connect; the vendor then answers Deny, as a connector_status event naming the refusal.
    await byId(page, IDS.mcpReconnect).click();
    await expect(byId(page, IDS.mcpWait)).toHaveAttribute("data-phase", "waiting");
    expect(fx.mcpConnects).toEqual([kind]);
    await expect.poll(openedUrls).toEqual([first(fx.mcpUrls, "authorize_url")]);
    fx.refuseMcpEvent(kind, "authorization_denied");
    const refused = byId(page, IDS.mcpRefused);
    await expect(refused).toHaveAttribute("data-refusal", "denied");
    await expect(pane).toHaveAttribute("data-state", "refused");
    await expect(refused).toContainText(`${vendor} refused access`);
    await expect(refused).toContainText("authorization_denied");
    await expect(refused.getByRole("alert")).toBeVisible();
    // The message is the server's text: shown as characters beside the code, never as elements.
    const message = byId(page, IDS.mcpRefusedMessage);
    await expect(message).toHaveText(MCP_REFUSAL_MESSAGE);
    await expect(message.locator("b"), "the message's markup is not markup").toHaveCount(0);
    await shoot(page, `${kind}-refused`, testInfo);

    // Close leaves the refusal; the row is still expired. Try again is a new connect, and any non-2xx answer is one refused state.
    await byId(page, IDS.mcpDismiss).click();
    await expect(pane).toHaveAttribute("data-state", "expired");
    expect(fx.mcpCancels, "a refused window is already closed").toEqual([]);
    await byId(page, IDS.mcpReconnect).click();
    await expect(byId(page, IDS.mcpWait)).toHaveAttribute("data-phase", "waiting");
    fx.refuseMcpEvent(kind, "window_expired");
    await expect(refused).toHaveAttribute("data-refusal", "window_expired");
    await expect(refused).toContainText("The sign-in window closed");
    await byId(page, IDS.mcpDismiss).click();

    fx.refuseMcpConnect({ status: 409, error: "connect_in_progress" });
    const opened = (await openedUrls()).length;
    await byId(page, IDS.mcpReconnect).click();
    await expect(refused).toHaveAttribute("data-refusal", "connect_in_progress");
    await expect(refused).toContainText(`Studio couldn't connect ${name} (connect_in_progress)`);
    await expect(byId(page, IDS.mcpRefusedMessage), "this refusal sent no message").toHaveCount(0);
    expect((await openedUrls()).length, "a refused connect opens nothing").toBe(opened);

    // The kernel accepts again: Try again opens a new window.
    fx.refuseMcpConnect(undefined);
    await byId(page, IDS.mcpRetry).click();
    await expect(byId(page, IDS.mcpWait)).toHaveAttribute("data-phase", "waiting");
    await expect.poll(async () => (await openedUrls()).length).toBe(opened + 1);
    await expect(refused).toHaveCount(0);
  });
}

// ---- R2, S2: the App's upgrade -----------------------------------------------------------------------------------

test("R2, S2: needs_permissions shows the upgrade, Accept on GitHub opens exactly the url the kernel returned, the session scope is stated, and when GitHub reports the new permissions the pane returns to the connected App with no reload", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith({ connector: "app-needs-permissions" });
  const page = await opening;
  const home = page.url();
  const detail = byId(page, IDS.detail);
  await expect(detail).toHaveAttribute("data-method", "app");
  const upgrade = byId(page, IDS.upgrade);
  await expect(upgrade).toBeVisible();
  await expect(upgrade.getByRole("heading", { level: 3, name: "Needs new permissions" })).toBeVisible();
  await expect(byId(page, IDS.upgradeAddress), "the address shown is the one the kernel gave").toHaveText(UPGRADE_URL);
  expect(fx.upgradeReads.length, "the address is read from the kernel").toBeGreaterThanOrEqual(1);
  await expect(byId(page, IDS.upgradeScope)).toContainText("Pull requests, Contents, Issues and Checks");
  await expect(byId(page, IDS.appSessionScope), "the connected App's own pane is still there under it").toBeVisible();
  await shoot(page, "app-needs-permissions", testInfo);

  // Nothing opens an address the kernel did not answer, whoever asks (the renderer's bridge included).
  const asked = await page.evaluate(() => (window as unknown as { api: { openExternal(url: string): Promise<boolean> } }).api.openExternal("https://example.test/not-answered-by-the-kernel"));
  expect(asked, "an address the kernel never answered is refused").toBe(false);
  expect(await openedUrls(), "and opens nothing").toEqual([]);

  // R2: the recorded shell.openExternal address is exactly the fixture's url.
  await byId(page, IDS.upgradeAccept).click();
  await expect.poll(openedUrls, { message: "the main process was asked to open exactly the kernel's upgrade url" }).toEqual([UPGRADE_URL]);
  await expect(byId(page, IDS.upgradeError), "the open was not refused").toHaveCount(0);
  expect(page.url(), "the window did not navigate").toBe(home);
  expect(app?.windows().length, "no second window opened").toBe(1);

  // Check now reads again, and nothing changes until GitHub reports the new permissions.
  const readsBefore = connectorReads();
  await byId(page, IDS.upgradeCheck).click();
  await expect.poll(connectorReads).toBeGreaterThan(readsBefore);
  await expect(upgrade).toBeVisible();

  // S2: the later GET /connectors reads the App row connected; the pane returns, with the window the same.
  await page.evaluate(() => {
    (window as unknown as { __marker?: string }).__marker = "same-window";
  });
  fx.change("app-connected");
  await expect(upgrade).toHaveCount(0);
  await expect(detail).toHaveAttribute("data-state", "connected");
  await expect(detail).toHaveAttribute("data-method", "app");
  await expect(byId(page, IDS.appSessionScope)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker), "the window was not reloaded").toBe("same-window");
});

// ---- R3, R4, S3: the repo policy card ----------------------------------------------------------------------------

const chip = (page: Page, repo: string): Locator => page.locator(`[data-testid="${IDS.policyChip}"][data-repo="${repo}"]`);
const preset = (page: Page, kind: string): Locator => page.locator(`[data-testid="${IDS.policyPreset}"][data-kind="${kind}"]`);

/** Open the Repo policy pane and wait for the first card. */
async function openPolicy(page: Page): Promise<void> {
  await byId(page, IDS.rowPolicy).click();
  await expect(byId(page, IDS.policyCard)).toBeVisible();
}

test("R4, S3: a proposal shows its detection and Accept sends exactly one POST with the proposal's kind and N; Re-detect sends one detect; the presets each send one POST", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith({ connector: "app-connected", policies: policyRepos() });
  const page = await opening;
  expect(fx.policyReads, "the repos are read when the pane is first opened, not on mount").toEqual([]);
  await openPolicy(page);
  expect(fx.policyReads.length).toBeGreaterThanOrEqual(1);
  const card = byId(page, IDS.policyCard);
  await expect(card).toHaveAttribute("data-repo", POLICY_REPOS.proposed);
  await expect(card).toHaveAttribute("data-state", "none");
  expect(await byId(page, IDS.policyChip).evaluateAll((chips) => chips.map((c) => c.getAttribute("data-repo")))).toEqual(Object.values(POLICY_REPOS));

  // What GitHub enforces, from the detection: protection, required reviews and checks, who can push, and when it was read.
  const detected = byId(page, IDS.policyDetected);
  await expect(detected).toContainText("On, on main");
  await expect(detected).toContainText("2 approving reviews");
  await expect(detected).toContainText("ci");
  await expect(detected).toContainText("studio-fixture, studio-dev");
  await expect(detected).toContainText(/read (today|\d+ \w+) \d\d:\d\d/);

  // The proposal is waiting: nothing has been sent.
  const proposal = byId(page, IDS.policyProposal);
  await expect(proposal).toHaveAttribute("data-kind", "reviews");
  await expect(proposal).toContainText("2 GitHub reviews");
  await expect(byId(page, IDS.policyNone)).toHaveText("No policy: PRs park");
  expect(fx.policySets, "a proposal is never applied by itself").toEqual([]);
  await shoot(page, "policy-proposed", testInfo);

  // Re-detect: one POST …/detect for this repo and no policy write.
  await byId(page, IDS.policyRedetect).click();
  await expect.poll(() => fx.policyDetects.length).toBe(1);
  expect(fx.policyDetects).toEqual([POLICY_REPOS.proposed]);
  expect(fx.policySets).toEqual([]);

  // R4: Accept sends one POST with {kind: proposal.kind} plus required (the kind is reviews).
  await byId(page, IDS.policyAccept).click();
  await expect.poll(() => fx.policySets.length).toBe(1);
  expect(fx.policySets, "exactly one POST, the proposal's kind and N").toEqual([{ repo: POLICY_REPOS.proposed, body: { kind: "reviews", required: 2 } }]);
  await expect(card).toHaveAttribute("data-state", "set");
  const current = byId(page, IDS.policyCurrent);
  await expect(current).toContainText("2 GitHub reviews");
  await expect(current).toContainText("set by owner");
  await expect(byId(page, IDS.policyProposal)).toHaveCount(0);
  await expect(byId(page, IDS.policyStatus)).toContainText("Policy set.");
  await shoot(page, "policy-accepted", testInfo);

  // S3: the presets. N GitHub reviews needs a valid N; each Set policy is one POST.
  await byId(page, IDS.policyChange).click();
  await expect(byId(page, IDS.policyPreset)).toHaveCount(3);
  await preset(page, "reviews").check();
  await expect(byId(page, IDS.policySet), "no N yet").toBeDisabled();
  await byId(page, IDS.policyReviews).fill("0");
  await expect(byId(page, IDS.policySet), "0 is not a number of reviews").toBeDisabled();
  await byId(page, IDS.policyReviews).fill("3");
  await byId(page, IDS.policySet).click();
  await expect.poll(() => fx.policySets.length).toBe(2);
  expect(fx.policySets[1]).toEqual({ repo: POLICY_REPOS.proposed, body: { kind: "reviews", required: 3 } });
  await expect(current).toContainText("3 GitHub reviews");

  await byId(page, IDS.policyChange).click();
  await preset(page, "studio_approval").check();
  await byId(page, IDS.policySet).click();
  await expect.poll(() => fx.policySets.length).toBe(3);
  expect(fx.policySets[2], "a preset without N sends its kind alone").toEqual({ repo: POLICY_REPOS.proposed, body: { kind: "studio_approval" } });
  await expect(current).toContainText("Approve in Studio");

  await byId(page, IDS.policyChange).click();
  await preset(page, "solo").check();
  await byId(page, IDS.policySet).click();
  await expect.poll(() => fx.policySets.length).toBe(4);
  expect(fx.policySets[3]).toEqual({ repo: POLICY_REPOS.proposed, body: { kind: "solo" } });
  await expect(current).toContainText("Solo");
  expect(fx.policyDetects, "no further detect").toHaveLength(1);
});

test("R3, S3: where GitHub cannot enforce protection the card offers exactly Make public / Upgrade, Trust unprotected and Safe mode; the links open the two GitHub pages and send no POST; Trust unprotected sends nothing until a confirm; Safe mode sends nothing", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith({ connector: "app-connected", policies: policyRepos() });
  const page = await opening;
  const home = page.url();
  await openPolicy(page);
  const card = byId(page, IDS.policyCard);

  // A repo with a detection and no proposal: "No policy: PRs park", the presets, no Accept.
  await chip(page, POLICY_REPOS.none).click();
  await expect(card).toHaveAttribute("data-repo", POLICY_REPOS.none);
  await expect(byId(page, IDS.policyNone)).toHaveText("No policy: PRs park");
  await expect(byId(page, IDS.policyDetected)).toContainText("None on main");
  await expect(byId(page, IDS.policyProposal)).toHaveCount(0);
  await expect(byId(page, IDS.policyAccept)).toHaveCount(0);
  await expect(byId(page, IDS.policyPreset)).toHaveCount(3);
  await expect(byId(page, IDS.policySet), "nothing is picked for the owner").toBeDisabled();
  await shoot(page, "policy-none", testInfo);

  // R3: protection_unavailable: exactly three ways on, in the kernel's order, and no preset, no proposal.
  await chip(page, POLICY_REPOS.trust).click();
  await expect(card).toHaveAttribute("data-repo", POLICY_REPOS.trust);
  const choices = byId(page, IDS.policyChoices);
  await expect(choices).toBeVisible();
  expect(await choices.locator("li[data-choice]").evaluateAll((items) => items.map((item) => item.getAttribute("data-choice")))).toEqual(["make_public_or_upgrade", "trust_unprotected", "safe_mode"]);
  await expect(byId(page, IDS.policyPreset), "no other preset is offered").toHaveCount(0);
  await expect(byId(page, IDS.policyProposal)).toHaveCount(0);
  await expect(byId(page, IDS.policyAccept)).toHaveCount(0);
  await expect(byId(page, IDS.policyNone)).toBeVisible();
  await expect(byId(page, IDS.policyDetected)).toContainText("GitHub can't enforce it");
  await expect(byId(page, IDS.policyDetected)).toContainText("Can't be required");
  await shoot(page, "policy-unenforceable", testInfo);

  // Make public / Upgrade are two links, each opened through the channel, neither a POST.
  const settings = `https://github.com/${POLICY_REPOS.trust}/settings`;
  const plans = "https://github.com/settings/billing/plans";
  await byId(page, IDS.policyMakePublic).click();
  await expect.poll(openedUrls).toEqual([settings]);
  await byId(page, IDS.policyUpgrade).click();
  await expect.poll(openedUrls).toEqual([settings, plans]);
  await expect(byId(page, IDS.policyLinkError), "both opened").toHaveCount(0);
  expect(fx.policySets, "the links send no POST").toEqual([]);
  expect(fx.policyDetects).toEqual([]);
  expect(page.url(), "the links opened in the system browser, not in the window").toBe(home);
  expect(app?.windows().length).toBe(1);

  // Trust unprotected asks first, naming what it waives; Cancel sends nothing.
  await byId(page, IDS.policyTrust).click();
  const confirm = page.getByRole("alertdialog", { name: `Trust ${POLICY_REPOS.trust} unprotected?` });
  await expect(confirm).toBeVisible();
  const waives = byId(page, IDS.policyTrustConfirm);
  await expect(waives).toContainText("Waives condition 4 only");
  await expect(waives).toContainText("Does not waive the high-risk park");
  expect(fx.policySets, "nothing is sent while the confirm is open").toEqual([]);
  await shoot(page, "policy-trust-confirm", testInfo);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expect(fx.policySets, "Cancel sends nothing").toEqual([]);
  await expect(choices).toBeVisible();

  // Confirmed: still nothing sent. The owner then picks a preset (not reviews: GitHub cannot enforce them here) and Set policy sends it with the trust.
  await byId(page, IDS.policyTrust).click();
  await confirm.getByRole("button", { name: "Trust unprotected" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(byId(page, IDS.policyTrusting)).toBeVisible();
  expect(fx.policySets, "the confirm alone records nothing").toEqual([]);
  await expect(byId(page, IDS.policyPreset)).toHaveCount(3);
  await expect(preset(page, "reviews")).toBeDisabled();
  await preset(page, "solo").check();
  await byId(page, IDS.policySet).click();
  await expect.poll(() => fx.policySets.length).toBe(1);
  expect(fx.policySets).toEqual([{ repo: POLICY_REPOS.trust, body: { kind: "solo", trust_unprotected: true } }]);
  await expect(card).toHaveAttribute("data-state", "set");
  await expect(byId(page, IDS.policyCurrent)).toContainText("Unprotected, for this repo only");

  // Safe mode records nothing: the repo stays with no policy, and says so.
  await chip(page, POLICY_REPOS.safe).click();
  await expect(card).toHaveAttribute("data-repo", POLICY_REPOS.safe);
  await byId(page, IDS.policySafe).click();
  const safe = byId(page, IDS.policySafeView);
  await expect(safe).toBeVisible();
  await expect(safe).toContainText("the repo stays with no policy, so its PRs park");
  await expect(card).toHaveAttribute("data-state", "none");
  await expect(byId(page, IDS.policyNone)).toBeVisible();
  expect(fx.policySets, "Safe mode sends no POST").toHaveLength(1);
  expect(fx.policyDetects).toEqual([]);
});

// ---- R5: nothing connected ---------------------------------------------------------------------------------------

test("R5: with no connector at all the GitHub empty state and its Connect choice are as before, Jira and ClickUp list as not connected with one Connect each, and the repo policy area reads No repos reached yet", async () => {
  const { fx, page: opening } = launchWith();
  const page = await opening;
  const home = page.url();
  await expect(byId(page, IDS.count)).toHaveText("1 connector · all optional");

  // GitHub: the same empty state, and Connect opens the same choice.
  await expect(byId(page, IDS.empty)).toBeVisible();
  await expect(byId(page, IDS.empty).getByRole("heading", { level: 2 })).toHaveText("Connect GitHub so a playbook can read your PRs.");
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "none");
  await expect(byId(page, IDS.upgrade), "no upgrade without an App").toHaveCount(0);
  await byId(page, IDS.emptyConnect).click();
  await expect(byId(page, IDS.choice)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(byId(page, IDS.choice)).toHaveCount(0);

  // Jira and ClickUp: not connected, one Connect each.
  for (const kind of MCP_KINDS) {
    const { name, row } = NAMES[kind];
    await expect(byId(page, row)).toContainText("not connected");
    await byId(page, row).click();
    await expect(byId(page, IDS.mcp)).toHaveAttribute("data-kind", kind);
    await expect(byId(page, IDS.mcp)).toHaveAttribute("data-state", "none");
    await expect(byId(page, IDS.mcpConnect)).toHaveCount(1);
    await expect(byId(page, IDS.mcpConnect)).toHaveText(`Connect ${name}`);
  }

  // The repo policy area: its own empty state.
  await byId(page, IDS.rowPolicy).click();
  await expect(byId(page, IDS.policyEmpty)).toBeVisible();
  await expect(byId(page, IDS.policyEmpty).getByRole("heading", { level: 2 })).toHaveText("No repos reached yet.");
  await expect(byId(page, IDS.policyCard)).toHaveCount(0);
  await expect(byId(page, IDS.policyChip)).toHaveCount(0);

  // Looking changed nothing and opened nothing: no connect, no cancel, no write, no browser, and the kernel's upgrade address is not openable
  // by anyone, because the kernel was never asked for it.
  expect(fx.mcpConnects).toEqual([]);
  expect(fx.mcpCancels).toEqual([]);
  expect(fx.mcpDisconnects).toEqual([]);
  expect(fx.policySets).toEqual([]);
  expect(fx.policyDetects).toEqual([]);
  expect(fx.upgradeReads, "the upgrade address is read only for an App that needs permissions").toEqual([]);
  const asked = await page.evaluate((url) => (window as unknown as { api: { openExternal(url: string): Promise<boolean> } }).api.openExternal(url), UPGRADE_URL);
  expect(asked, "an address the kernel never answered in this session is refused").toBe(false);
  expect(await openedUrls()).toEqual([]);
  expect(page.url()).toBe(home);
});

// ---- Evidence ----------------------------------------------------------------------------------------------------

test("S9: without PHASE8_POLISH_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", () => {
  test.skip(EVIDENCE, "an evidence run writes the tracked dir on purpose");
  let files: string[] = [];
  try {
    files = readdirSync(EVIDENCE_DIR);
  } catch {
    // No committed evidence dir at all: nothing could have been written to it.
  }
  const touched = files.filter((file) => statSync(join(EVIDENCE_DIR, file)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-8-polish/integrations/ is newer than this run's start").toEqual([]);
});

test("S9: the evidence README lists every screenshot, and nothing else, and the folder holds those files", () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const listed = new Set(readme.match(/integrations-[a-z-]+-(?:light|dark)\.png/g) ?? []);
  expect([...listed].sort(), "the README names exactly this spec's screenshots").toEqual([...EXPECTED].sort());
  const onDisk = readdirSync(EVIDENCE_DIR).filter((file) => file.endsWith(".png"));
  expect(onDisk.sort(), "the folder holds exactly those files").toEqual([...EXPECTED].sort());
  for (const state of SHOT_STATES) expect(readme, `the README names the ${state} state`).toContain(`\`${state}\``);
});

test("the test ids this spec targets are the ones INTEGRATIONS_TEST_IDS in model.ts defines", () => {
  const source = readFileSync(MODEL_SOURCE, "utf8");
  const defined = new Set([...source.matchAll(/^\s+\w+: "([^"]+)",?$/gm)].map((match) => match[1]));
  expect(defined.size, "model.ts's test-id table was read").toBeGreaterThan(20);
  expect(Object.values(IDS).filter((id) => !defined.has(id)), "ids the spec uses that model.ts does not define").toEqual([]);
});
