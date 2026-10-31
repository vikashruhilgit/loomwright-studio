// Switching GitHub from a token to the GitHub App (phase 7 item 09) in the built app against the fixture kernel
// (`./fixtures/integrations.ts`). "Switch to GitHub App" on the token detail opens the setup dialog over the token:
// one `POST /connectors/github/app/setup`, the returned `setup_url` opened through the open-external channel, the
// window never navigating, and no `POST /connectors/github/disconnect` ever sent. The dialog follows the fixture
// kernel's events: `appStored()` is the kernel's `storeApp` over the token row (the slug recorded, one non-refusal
// `connector_status`, which is the step-2 signal) and `change("app-connected")` is `recordInstallation` (the token
// item gone). The spec never fakes step 2 with `app-created`, which is an App row and would hide a kernel that
// sent no event. A cancel or a failure leaves the token connection exactly as it was. Run `npm run build` first.
//
// `shell.openExternal` is replaced in the main process before any click, so no run can open a real browser, and
// the addresses the main process would have opened are read back from it.
//
// Screenshots: with `INTEGRATIONS_EVIDENCE=1` they are written to the committed evidence dir
// `docs/evidence/phase-7-polish/integrations/`, one light and one dark for each of the six mockup views of
// `docs/design/mockups/gui-v2.html` (12 files); otherwise to Playwright's per-test output dir, so CI never dirties
// tracked files, and a test asserts nothing under the tracked dir changed during the run. The spec asserts
// behaviour, never pixels: fonts differ between macOS and CI. The phase 6 evidence dir is never written here.
//
// The shell does not mount the ⌘K palette (probed in the built app), so the palette command is pinned in jsdom
// (`switch.test.tsx`) and the keyboard test here reaches the screen by its hash, then uses Tab, Enter and Escape only.
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { ACCOUNT, APP_INSTALLATION, APP_REPOS, APP_SLUG, RAW_REFUSAL_MESSAGE, REPOS, TOKEN, integrationsFixture } from "./fixtures/integrations";
import type { IntegrationsFixture, IntegrationsFixtureOptions } from "./fixtures/integrations";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/integrations/", import.meta.url));
const README = join(EVIDENCE_DIR, "README.md");
const THEMES = ["light", "dark"] as const;
/** The six mockup views (`docs/design/mockups/gui-v2.html`) this spec photographs; a screenshot is `<view>-<theme>.png`. */
const VIEWS = ["integrations-token", "integrations-token-to-app", "integrations-token-to-app-install", "integrations-token-to-app-failed", "integrations-app-connected", "integrations-unreachable"] as const;
/**
 * The screen's test ids, as `INTEGRATIONS_TEST_IDS` in `src/screens/integrations/model.ts` has them. They are copied, not
 * imported (that module pulls in Team's model and so a `.tsx` the e2e project's `tsconfig.node.json` cannot type-check);
 * the last test reads `model.ts` and fails if any id below is not one of its values.
 */
const IDS = {
  account: "integrations-account",
  appAccess: "integrations-app-access",
  appAgain: "integrations-app-again",
  appCancel: "integrations-app-cancel",
  appChecked: "integrations-app-checked",
  appClose: "integrations-app-close",
  appInstallation: "integrations-app-installation",
  appLink: "integrations-app-link",
  appName: "integrations-app-name",
  appOpenAgain: "integrations-app-open-again",
  appOutcome: "integrations-app-outcome",
  appPasteToken: "integrations-app-paste-token",
  appSetup: "integrations-app-setup",
  appStatus: "integrations-app-status",
  appStep1: "integrations-app-step-1",
  appStep2: "integrations-app-step-2",
  band: "integrations-band",
  detail: "integrations-detail",
  detailHeader: "integrations-detail-header",
  disconnect: "integrations-disconnect",
  empty: "integrations-empty",
  list: "integrations-list",
  listMeta: "integrations-row-meta",
  listRow: "integrations-row-github",
  loading: "integrations-loading",
  repos: "integrations-repos",
  reposHeading: "integrations-repos-heading",
  replace: "integrations-replace",
  screen: "screen-integrations",
  status: "integrations-status",
  switchToApp: "integrations-switch-to-app",
} as const;
const MODEL_SOURCE = fileURLToPath(new URL("../src/screens/integrations/model.ts", import.meta.url));

/** When this run began, for the guard that the tracked evidence dir is untouched without `INTEGRATIONS_EVIDENCE`. */
const RUN_START = Date.now();

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
const pageErrors: string[] = [];
/** Every console line the page logged and every line the main process wrote, for the secrecy check. */
const logs: string[] = [];

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
  logs.length = 0;
  // Drained per test, so an error is reported against the test that caused it.
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

/** Launch the built app on a fixture kernel serving `fx`, and open Integrations by its hash. */
async function open(fx: IntegrationsFixture): Promise<Page> {
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  app = await launchApp(fixture.env);
  await stubOpenExternal(app);
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on("data", (chunk: Buffer) => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => logs.push(message.text()));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/integrations";
  });
  await expect(page.getByTestId(IDS.screen)).toBeVisible();
  return page;
}

/** Replaces `shell.openExternal` in the main process with a recorder: the address it would have opened goes onto `globalThis.__opened`. */
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

async function setTheme(page: Page, theme: (typeof THEMES)[number] | undefined): Promise<void> {
  await page.evaluate((value) => {
    if (value === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  }, theme);
}

/** Resolves after two animation frames, so any pending React commit and layout have landed. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** `<view>-light.png` and `<view>-dark.png` of the whole window; the dark tokens must really apply. */
async function screenshots(page: Page, view: (typeof VIEWS)[number], testInfo: TestInfo): Promise<void> {
  const evidence = process.env.INTEGRATIONS_EVIDENCE === "1";
  if (evidence) mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const file = `${view}-${theme}.png`;
    const path = evidence ? join(EVIDENCE_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
  }
  expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);
  await setTheme(page, undefined);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

/** Where `needles` are in the page right now (markup, text, URL, field values, storages); names the place, never the value. */
async function whereIn(page: Page, needles: readonly string[]): Promise<string[]> {
  return page.evaluate((list) => {
    const places: string[] = [];
    const scan = (where: string, text: string | null | undefined): void => {
      if (text !== null && text !== undefined && list.some((needle) => text.includes(needle))) places.push(where);
    };
    scan("markup", document.documentElement.outerHTML);
    scan("text", document.body.innerText);
    scan("title", document.title);
    scan("url", window.location.href);
    scan("localStorage", JSON.stringify({ ...window.localStorage }));
    scan("sessionStorage", JSON.stringify({ ...window.sessionStorage }));
    return places;
  }, needles);
}

/** Press Tab until `target` has focus; fails when it never does. */
async function tabTo(page: Page, target: Locator, what: string, max = 60): Promise<void> {
  await expect(target, `${what} is on the page`).toHaveCount(1);
  for (let i = 0; i <= max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    if (i < max) await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${what} in ${max} presses`);
}

/** Counts pointer input from here on: the keyboard-only test asserts it stays 0. */
async function countPointer(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __pointerInput?: number };
    w.__pointerInput = 0;
    for (const type of ["pointerdown", "mousedown", "click"]) {
      window.addEventListener(
        type,
        (event) => {
          // A keyboard activation of a button fires a synthetic click with detail 0; a pointer's has detail >= 1.
          if (event.type !== "click" || (event as MouseEvent).detail > 0) w.__pointerInput = (w.__pointerInput ?? 0) + 1;
        },
        true,
      );
    }
  });
  return () => page.evaluate(() => (window as unknown as { __pointerInput?: number }).__pointerInput ?? -1);
}

const byId = (page: Page, id: string): Locator => page.getByTestId(id);
const reads = (): number => fixture?.requests.filter((r) => r.method === "GET" && r.path === "/connectors").length ?? 0;

/** The token detail on a fixture with a token in `state`, and the Switch button pressed; resolves once the dialog is on step 1 and its URL was opened. */
async function startSwitch(page: Page): Promise<Locator> {
  const button = byId(page, IDS.switchToApp);
  await button.focus();
  await button.click();
  const setup = byId(page, IDS.appSetup);
  await expect(setup).toHaveAttribute("data-phase", "create");
  await expect.poll(async () => (await openedUrls()).length, { message: "the setup URL was opened" }).toBeGreaterThanOrEqual(1);
  return setup;
}

/** The token connection as the owner sees it: connected, the account and repos, the token's Keychain row and its buttons; nothing of an App. */
async function expectTokenKept(page: Page, fx: IntegrationsFixture, what: string): Promise<void> {
  expect(fx.disconnects, `${what}: no disconnect was sent`).toEqual([]);
  expect(fx.tokens, `${what}: no token was written`).toEqual([]);
  const detail = byId(page, IDS.detail);
  await expect(detail, `${what}: still the token's detail`).toHaveAttribute("data-state", "connected");
  await expect(detail).not.toHaveAttribute("data-method", "app");
  await expect(byId(page, IDS.account)).toHaveText(ACCOUNT);
  await expect(detail).toContainText("loomwright-studio-github");
  await expect(byId(page, IDS.repos).getByRole("listitem")).toHaveText([...REPOS]);
  await expect(byId(page, IDS.replace)).toBeVisible();
  await expect(byId(page, IDS.disconnect)).toBeVisible();
}

test("AC1, AC3, AC6: Switch to GitHub App opens the dialog over the token with one setup call and no disconnect; the kernel's step-2 event and the install move it on with no reload, no flash and no shift; the App's detail replaces the token's", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  const home = page.url();
  const detail = byId(page, IDS.detail);
  await expect(detail).toHaveAttribute("data-state", "connected");
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
  const button = byId(page, IDS.switchToApp);
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(button).toHaveText("Switch to GitHub App");
  await expect(byId(page, IDS.detailHeader).getByRole("button")).toHaveText(["Replace token", "Switch to GitHub App", "Disconnect"]);
  await screenshots(page, "integrations-token", testInfo);

  // AC1: one setup call, the returned setup_url through the channel, the window stays put, and nothing is disconnected.
  const setup = await startSwitch(page);
  expect(fx.setups, "exactly one setup call").toHaveLength(1);
  const [url] = fx.setupUrls;
  expect(url, "the kernel answered a setup_url").toBeDefined();
  expect(await openedUrls(), "the main process was asked to open exactly the returned setup_url").toEqual([url]);
  expect(page.url(), "the Studio window did not navigate").toBe(home);
  expect(app?.windows().length, "no second window opened").toBe(1);
  expect(fx.disconnects, "no disconnect was sent").toEqual([]);
  expect(fx.tokens, "no token was written").toEqual([]);
  await expect(setup.getByRole("heading", { level: 2 })).toHaveText("Switch GitHub to the GitHub App");
  await expect(setup).toContainText("GitHub stays connected through your token while this runs, and keeps working if you cancel or setup fails.");
  await expect(byId(page, IDS.appStep1)).toContainText("Step 1 of 2 · Create the App on GitHub");
  await expect(byId(page, IDS.appStep1)).toContainText("waiting for you");
  await expect(byId(page, IDS.appStep2)).toContainText("next");
  await expect(byId(page, IDS.appStatus)).toHaveText("Setting up the GitHub App. Waiting for you on GitHub: step 1 of 2, Create. GitHub stays connected through the token.");
  // While the dialog runs the row reads the token's words, and the detail keeps the token's data.
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT} · token · setting up the App`);
  await expect(detail).toHaveAttribute("data-state", "connected");
  await expect(byId(page, IDS.account)).toHaveText(ACCOUNT);
  await expect(detail).toContainText("loomwright-studio-github");
  await screenshots(page, "integrations-token-to-app", testInfo);

  // Without the kernel's event the dialog stays on step 1: the screen has no other signal (the fixture mirrors the real port).
  await settle(page);
  await expect(setup).toHaveAttribute("data-phase", "create");

  // A marker on the window (a reload would drop it), a watcher for the loading skeleton (a flash would set it), and the boxes that must not move.
  await page.evaluate((loadingId) => {
    const w = window as unknown as { __marker?: string; __loadingSeen?: boolean };
    w.__marker = "same-window";
    w.__loadingSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(`[data-testid="${loadingId}"]`) !== null) w.__loadingSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, IDS.loading);
  const boxes = async () => ({ list: await byId(page, IDS.list).boundingBox(), header: await byId(page, IDS.detailHeader).boundingBox() });
  const before = await boxes();
  expect(before.list, "the list pane has a box").not.toBeNull();
  expect(before.header, "the detail header has a box").not.toBeNull();
  const readsBefore = reads();

  // The kernel's `storeApp` over the token row: one connector_status, the step-2 signal. The row stays a token.
  fx.appStored();
  await expect(setup).toHaveAttribute("data-phase", "install");
  await expect(byId(page, IDS.appStep1)).toContainText("done");
  await expect(byId(page, IDS.appStep2)).toContainText("Step 2 of 2 · Pick the repos and install it");
  await expect(byId(page, IDS.appStep2)).toContainText("waiting for you");
  await expect(byId(page, IDS.appStatus)).toHaveText("Step 2 of 2, Install. GitHub stays connected through the token.");
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT} · token · setting up the App`);
  await expect.poll(reads, { message: "the event made the screen read GET /connectors again" }).toBeGreaterThan(readsBefore);
  await settle(page);
  await expect(detail, "the row is still a token").not.toHaveAttribute("data-method", "app");
  expect(await boxes(), "the list pane and the detail header did not move or resize").toEqual(before);
  expect(fx.cancels, "moving to step 2 cancels nothing").toEqual([]);
  expect(fx.disconnects).toEqual([]);
  await screenshots(page, "integrations-token-to-app-install", testInfo);

  // The install lands (`recordInstallation`): the dialog closes and the detail is the App's, with the token's item gone.
  const listBefore = await byId(page, IDS.list).boundingBox();
  fx.change("app-connected");
  await expect(setup).toHaveCount(0);
  await expect(detail).toHaveAttribute("data-state", "connected");
  await expect(detail).toHaveAttribute("data-method", "app");
  await expect(byId(page, IDS.detailHeader)).toContainText("GitHub App");
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT} · GitHub App`);
  await expect(byId(page, IDS.appName)).toHaveText(APP_SLUG);
  await expect(byId(page, IDS.appInstallation)).toHaveText(String(APP_INSTALLATION));
  await expect(byId(page, IDS.appAccess)).toContainText("renews automatically");
  await expect(byId(page, IDS.appChecked)).toHaveText("Read-only, checked by GitHub.");
  await expect(byId(page, IDS.reposHeading)).toHaveText(`Repos chosen at install · ${APP_REPOS.length}`);
  await expect(byId(page, IDS.repos).getByRole("listitem")).toHaveText([...APP_REPOS]);
  await expect(byId(page, IDS.switchToApp), "an App has no Switch").toHaveCount(0);
  await expect(byId(page, IDS.replace), "an App has no Replace token").toHaveCount(0);
  await expect(detail, "the token item is gone: no Keychain row for it").not.toContainText("loomwright-studio-github");
  await expect(byId(page, IDS.disconnect)).toBeVisible();
  await settle(page);
  expect(page.url(), "the window never navigated").toBe(home);
  expect(fx.disconnects, "the whole switch sent no disconnect").toEqual([]);
  expect(fx.tokens, "and no token").toEqual([]);
  expect(fx.setups, "and one setup call").toHaveLength(1);
  expect(await byId(page, IDS.list).boundingBox(), "the list pane did not move or resize").toEqual(listBefore);
  const seen = await page.evaluate(() => ({ marker: (window as unknown as { __marker?: string }).__marker, loading: (window as unknown as { __loadingSeen?: boolean }).__loadingSeen }));
  expect(seen.marker, "the window was not reloaded").toBe("same-window");
  expect(seen.loading, "the screen never flashed its loading state").toBe(false);
  // The connector row has focus once the Switch button that opened the dialog is gone.
  await expect(byId(page, IDS.listRow)).toBeFocused();
  await screenshots(page, "integrations-app-connected", testInfo);
});

test("AC2: Cancel, Escape and the backdrop each make one cancel call and say GitHub is still connected through the token; nothing is disconnected and Close returns focus to Switch", async () => {
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  const ways: readonly (readonly [string, () => Promise<void>])[] = [
    ["Cancel", () => byId(page, IDS.appCancel).click()],
    ["Escape", () => page.keyboard.press("Escape")],
    ["the backdrop", () => page.locator(".dialog-overlay").click({ position: { x: 6, y: 6 } })],
  ];
  let cancels = 0;
  for (const [name, cancel] of ways) {
    const setup = await startSwitch(page);
    await cancel();
    await expect(setup, `${name}: the cancelled view`).toHaveAttribute("data-phase", "cancelled");
    cancels += 1;
    await expect.poll(() => fx.cancels.length, { message: `${name}: one cancel call` }).toBe(cancels);
    await expect(setup.getByRole("heading", { level: 2 })).toHaveText("Setup cancelled");
    await expect(setup).toContainText("Setup cancelled. GitHub is still connected through your token.");
    await expect(setup).not.toContainText("Nothing was connected");
    await expect(byId(page, IDS.appStatus)).toHaveText("Setup cancelled. GitHub is still connected through your token.");
    await expect(byId(page, IDS.appPasteToken)).toHaveCount(0);
    await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT} · token`);
    await expect(byId(page, IDS.listMeta)).not.toContainText("not connected");
    await expectTokenKept(page, fx, name);
    await byId(page, IDS.appClose).click();
    await expect(setup).toHaveCount(0);
    await expect(byId(page, IDS.switchToApp), `${name}: focus is back on the button that opened the dialog`).toBeFocused();
    await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
  }
  expect(fx.setups, "one setup call for each switch").toHaveLength(3);
  expect(fx.cancels, "one cancel call for each").toHaveLength(3);
});

/** The refusals over a token: each as the `refused` field of a `connector_status` event. */
const REFUSALS = [
  { reason: "install_failed", outcome: "failed" },
  { reason: "token_write_scoped", outcome: "write-scoped" },
  { reason: "setup_expired", outcome: "expired" },
  { reason: "conversion_failed", outcome: "failed" },
] as const;

test("AC2: every failure (install_failed, token_write_scoped, setup_expired and any other reason) shows the one `Setup didn't finish` view with the token still connected, never the kernel's message, and Set up again is a fresh switch", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  for (const [index, refusal] of REFUSALS.entries()) {
    const setup = await startSwitch(page);
    expect(fx.setups, "each switch makes one setup call, and each Set up again one more").toHaveLength(index * 2 + 1);
    const readsBefore = reads();
    fx.refuseEvent(refusal.reason);
    await expect(setup, `${refusal.reason}: its outcome`).toHaveAttribute("data-phase", refusal.outcome);
    await expect(setup.getByRole("heading", { level: 2 })).toHaveText("Setup didn't finish");
    const outcome = byId(page, IDS.appOutcome);
    await expect(outcome).toHaveAttribute("role", "alert");
    await expect(outcome).toContainText("GitHub didn't finish setting the App up, so nothing changed. GitHub is still connected through your token.");
    await expect(setup).toContainText("Try again. If it keeps failing, keep using the token: it works as before.");
    await expect(setup).not.toContainText("Nothing was connected");
    await expect(byId(page, IDS.appPasteToken), "no Paste a token instead over a token").toHaveCount(0);
    await expect(byId(page, IDS.appClose)).toBeVisible();
    await expect(byId(page, IDS.appAgain)).toBeVisible();
    await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT} · token`);
    expect(await whereIn(page, [RAW_REFUSAL_MESSAGE]), "the kernel's own message is nowhere in the page").toEqual([]);
    if (refusal.reason === "token_write_scoped") await expect(outcome).toContainText("Contents: write → set to Read-only");
    await expect.poll(reads, { message: "the screen read the connectors after the refusal" }).toBeGreaterThan(readsBefore);
    await expectTokenKept(page, fx, refusal.reason);
    if (index === 0) await screenshots(page, "integrations-token-to-app-failed", testInfo);

    if (index < REFUSALS.length - 1) {
      // Set up again is a fresh switch: a new setup call, step 1 again, still over the token.
      await byId(page, IDS.appAgain).click();
      await expect(setup).toHaveAttribute("data-phase", "create");
      await expect(setup.getByRole("heading", { level: 2 })).toHaveText("Switch GitHub to the GitHub App");
      await expect.poll(() => fx.setups.length).toBe(index * 2 + 2);
      await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT} · token · setting up the App`);
      await byId(page, IDS.appCancel).click();
      await expect(setup).toHaveAttribute("data-phase", "cancelled");
      await byId(page, IDS.appClose).click();
      await expect(setup).toHaveCount(0);
    } else {
      await byId(page, IDS.appClose).click();
      await expect(setup).toHaveCount(0);
      await expect(byId(page, IDS.switchToApp)).toBeFocused();
    }
  }
});

test("AC2: a setup the kernel refuses (the route's own refusal) is the same view, opens nothing, and leaves the token connected", async () => {
  const { fx, page: opening } = launchWith({ connector: "expiring" });
  const page = await opening;
  fx.refuseSetup("install_failed");
  const before = (await openedUrls()).length;
  await byId(page, IDS.switchToApp).click();
  const setup = byId(page, IDS.appSetup);
  await expect(setup).toHaveAttribute("data-phase", "failed");
  await expect(setup.getByRole("heading", { level: 2 })).toHaveText("Setup didn't finish");
  await expect(setup).toContainText("GitHub is still connected through your token.");
  await expect(byId(page, IDS.appPasteToken)).toHaveCount(0);
  expect((await openedUrls()).length, "a refused setup opens nothing").toBe(before);
  expect(await whereIn(page, [RAW_REFUSAL_MESSAGE])).toEqual([]);
  await expect(byId(page, IDS.listMeta)).toHaveText(`expiring in 8 days · ${ACCOUNT} · token`);
  expect(fx.disconnects).toEqual([]);
  expect(fx.cancels, "nothing was open, so nothing is cancelled").toEqual([]);
  await byId(page, IDS.appClose).click();
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "expiring");
});

test("AC1: an expiring and an expired token can switch too, with the token's own state in the row words", async () => {
  for (const [state, words] of [
    ["expiring", `expiring in 8 days · ${ACCOUNT} · token · setting up the App`],
    ["expired", `expired · ${ACCOUNT} · token · setting up the App`],
  ] as const) {
    const { fx, page: opening } = launchWith({ connector: state });
    const page = await opening;
    await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", state);
    const setup = await startSwitch(page);
    expect(fx.setups).toHaveLength(1);
    await expect(byId(page, IDS.listMeta)).toHaveText(words);
    expect(fx.disconnects).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(setup).toHaveAttribute("data-phase", "cancelled");
    await app?.close();
    app = undefined;
    await fixture?.close();
    fixture = undefined;
  }
});

test("AC4: with the kernel unreachable the band shows, the token's last data stays, and Switch is disabled with the kernel's title, like Replace and Disconnect", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "connected");
  fx.dropNextRead();
  fx.change("connected");
  const band = byId(page, IDS.band);
  await expect(band).toBeVisible();
  await expect(band).toContainText("Couldn't reach the kernel");
  await expect(byId(page, IDS.listMeta)).toHaveText("status unknown · kernel unreachable");
  await expect(byId(page, IDS.empty)).toHaveCount(0);
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "connected");
  await expect(byId(page, IDS.account)).toHaveText(ACCOUNT);
  await expect(byId(page, IDS.status)).toContainText("Unknown while the kernel is unreachable");
  for (const id of [IDS.replace, IDS.switchToApp, IDS.disconnect]) {
    await expect(byId(page, id)).toBeDisabled();
    await expect(byId(page, id)).toHaveAttribute("title", "Needs the kernel");
  }
  await byId(page, IDS.switchToApp).click({ force: true });
  await expect(byId(page, IDS.appSetup)).toHaveCount(0);
  expect(fx.setups, "a disabled Switch makes no setup call").toEqual([]);
  await screenshots(page, "integrations-unreachable", testInfo);
});

test("AC5: by keyboard alone Switch is reached by Tab between Replace token and Disconnect, opens the dialog, which traps focus and returns it to Switch on Close", async () => {
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  const kb = page.keyboard;
  const pointer = await countPointer(page);
  const setup = byId(page, IDS.appSetup);

  // Tab order in the detail header: Replace token, Switch to GitHub App, Disconnect.
  await tabTo(page, byId(page, IDS.replace), "Replace token");
  await kb.press("Tab");
  await expect(byId(page, IDS.switchToApp)).toBeFocused();
  await kb.press("Tab");
  await expect(byId(page, IDS.disconnect)).toBeFocused();
  await kb.press("Shift+Tab");
  await expect(byId(page, IDS.switchToApp)).toBeFocused();

  // Enter opens the dialog with "Open GitHub again" focused, and Tab stays inside it.
  await kb.press("Enter");
  await expect(setup).toHaveAttribute("data-phase", "create");
  await expect(byId(page, IDS.appOpenAgain)).toBeFocused();
  for (let i = 0; i < 4; i += 1) {
    await kb.press("Tab");
    expect(await setup.evaluate((el) => el.contains(document.activeElement)), "focus stays in the dialog").toBe(true);
  }
  await tabTo(page, byId(page, IDS.appCancel), "Cancel");
  await kb.press("Enter");
  await expect(setup).toHaveAttribute("data-phase", "cancelled");
  await expect(byId(page, IDS.appAgain)).toBeFocused();

  // Close, by Tab and Enter, returns focus to the button that opened the dialog.
  await tabTo(page, byId(page, IDS.appClose), "Close");
  await kb.press("Enter");
  await expect(setup).toHaveCount(0);
  await expect(byId(page, IDS.switchToApp)).toBeFocused();

  // Escape on a running dialog cancels it; a second Escape closes the view, and focus is back on Switch.
  await kb.press("Enter");
  await expect(setup).toHaveAttribute("data-phase", "create");
  await kb.press("Escape");
  await expect(setup).toHaveAttribute("data-phase", "cancelled");
  await kb.press("Escape");
  await expect(setup).toHaveCount(0);
  await expect(byId(page, IDS.switchToApp)).toBeFocused();

  // The install lands while the keyboard owner is in the dialog: it closes, and focus goes to the connector row (Switch is gone).
  await kb.press("Enter");
  await expect(setup).toHaveAttribute("data-phase", "create");
  fx.appStored();
  await expect(setup).toHaveAttribute("data-phase", "install");
  fx.change("app-connected");
  await expect(setup).toHaveCount(0);
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-method", "app");
  await expect(byId(page, IDS.listRow)).toBeFocused();
  expect(await pointer(), "no pointer input").toBe(0);
  expect(fx.disconnects).toEqual([]);
});

test("AC7: the Switch button, the dialog, each step and each outcome carry names, the live region states each step, and nothing in the token is on the page", async () => {
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  await expect(page.getByRole("button", { name: "Switch to GitHub App" })).toBeVisible();
  await byId(page, IDS.switchToApp).click();
  const setup = byId(page, IDS.appSetup);
  await expect(setup).toHaveAttribute("data-phase", "create");

  // The dialog is named by its title and described by its first paragraph.
  const named = await setup.evaluate((el) => {
    const text = (id: string | null): string => (id === null ? "" : (document.getElementById(id)?.textContent ?? ""));
    return { role: el.getAttribute("role"), modal: el.getAttribute("aria-modal"), name: text(el.getAttribute("aria-labelledby")), description: text(el.getAttribute("aria-describedby")) };
  });
  expect(named.role).toBe("dialog");
  expect(named.modal).toBe("true");
  expect(named.name).toBe("Switch GitHub to the GitHub App");
  expect(named.description).toContain("GitHub stays connected through your token");
  await expect(page.getByRole("dialog", { name: "Switch GitHub to the GitHub App" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Setup steps" })).toBeVisible();

  // The polite live region states each step and each outcome.
  const live = byId(page, IDS.appStatus);
  await expect(live).toHaveAttribute("role", "status");
  await expect(live).toContainText("step 1 of 2, Create");
  await expect(live).toContainText("GitHub stays connected through the token");
  fx.appStored();
  await expect(live).toHaveText("Step 2 of 2, Install. GitHub stays connected through the token.");
  await page.keyboard.press("Escape");
  await expect(live).toHaveText("Setup cancelled. GitHub is still connected through your token.");
  await byId(page, IDS.appClose).click();

  await byId(page, IDS.switchToApp).click();
  await expect(setup).toHaveAttribute("data-phase", "create");
  fx.refuseEvent("install_failed");
  await expect(setup).toHaveAttribute("data-phase", "failed");
  await expect(page.getByRole("dialog", { name: "Setup didn't finish" })).toBeVisible();
  await expect(byId(page, IDS.appOutcome)).toHaveAttribute("role", "alert");
  expect(await whereIn(page, [TOKEN]), "no token string is on the page at any point").toEqual([]);
  expect(logs.filter((line) => line.includes(TOKEN)).length, "nor in any console or main-process line").toBe(0);
});

/**
 * The text on the screen and in the open dialog whose colour against its own background is under WCAG 2.1 AA (4.5, or 3 for
 * large text), by the computed colours of each element that holds text itself. Disabled controls are exempt, as WCAG exempts them.
 */
async function contrastFailures(page: Page): Promise<string[]> {
  // A theme change runs the controls' colour transitions: measure once they have settled, never mid-fade. A waiting dot
  // pulses for ever, so only the animations that end are awaited.
  await page.evaluate(async () => {
    const ending = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(ending.map((a) => a.finished.catch(() => undefined)));
  });
  return page.evaluate(() => {
    type Rgba = readonly [number, number, number, number];
    const parse = (value: string): Rgba | undefined => {
      const m = /rgba?\(([^)]+)\)/.exec(value) ?? /color\(srgb ([^)]+)\)/.exec(value);
      if (m === null) return undefined;
      const parts = (m[1] ?? "").split(/[\s,/]+/).filter(Boolean).map(Number);
      const scale = value.startsWith("color(") ? 255 : 1;
      return [(parts[0] ?? 0) * scale, (parts[1] ?? 0) * scale, (parts[2] ?? 0) * scale, parts[3] ?? 1];
    };
    const over = (top: Rgba, under: Rgba): Rgba => {
      const a = top[3] + under[3] * (1 - top[3]);
      const mix = (i: 0 | 1 | 2): number => (a === 0 ? 0 : (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a);
      return [mix(0), mix(1), mix(2), a];
    };
    const luminance = (c: Rgba): number => {
      const ch = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
    };
    const backgroundOf = (el: Element): Rgba => {
      const stack: Rgba[] = [];
      for (let node: Element | null = el; node !== null; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg !== undefined && bg[3] > 0) stack.push(bg);
        if (bg !== undefined && bg[3] >= 1) break;
      }
      return stack.reduceRight<Rgba>((under, top) => over(top, under), [255, 255, 255, 1]);
    };
    const failures: string[] = [];
    const roots = [document.querySelector('[data-testid="screen-integrations"]'), document.querySelector('[data-testid="integrations-app-setup"]')].filter((r): r is Element => r !== null);
    if (roots.length === 0) return ["no screen"];
    for (const root of roots) {
      for (const el of [root, ...root.querySelectorAll("*")]) {
        const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
        if (!own) continue;
        if ((el as HTMLButtonElement).disabled === true || el.closest("[disabled], [aria-disabled='true']") !== null) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || el.closest(".integrations-sr-only") !== null) continue;
        const fg = parse(style.color);
        if (fg === undefined) continue;
        const bg = backgroundOf(el);
        const text = over(fg, bg);
        const l1 = luminance(text);
        const l2 = luminance(bg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const size = parseFloat(style.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) failures.push(`${ratio.toFixed(2)} ${style.color} on ${style.backgroundColor}: ${(el.textContent ?? "").trim().slice(0, 40)}`);
      }
    }
    return failures;
  });
}

test("AC7: the token detail with Switch, each dialog view and the App's detail meet WCAG 2.1 AA contrast in light and dark, from the design tokens", async () => {
  // Six views in two themes, each measured once its colour transitions have settled.
  test.setTimeout(120_000);
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  const views: readonly (readonly [string, () => Promise<void>])[] = [
    ["the token detail", async () => undefined],
    ["step 1", async () => void (await startSwitch(page))],
    [
      "step 2",
      async () => {
        fx.appStored();
        await expect(byId(page, IDS.appSetup)).toHaveAttribute("data-phase", "install");
      },
    ],
    [
      "cancelled",
      async () => {
        await page.keyboard.press("Escape");
        await expect(byId(page, IDS.appSetup)).toHaveAttribute("data-phase", "cancelled");
      },
    ],
    [
      "failed",
      async () => {
        await byId(page, IDS.appAgain).click();
        await expect(byId(page, IDS.appSetup)).toHaveAttribute("data-phase", "create");
        fx.refuseEvent("token_write_scoped");
        await expect(byId(page, IDS.appSetup)).toHaveAttribute("data-phase", "write-scoped");
      },
    ],
    [
      "the App's detail",
      async () => {
        await byId(page, IDS.appClose).click();
        fx.change("app-connected");
        await expect(byId(page, IDS.detail)).toHaveAttribute("data-method", "app");
      },
    ],
  ];
  for (const [name, go] of views) {
    await go();
    for (const theme of THEMES) {
      await setTheme(page, theme);
      expect(await contrastFailures(page), `${name} in ${theme}`).toEqual([]);
    }
    await setTheme(page, undefined);
  }
});

test("without INTEGRATIONS_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", async () => {
  test.skip(process.env.INTEGRATIONS_EVIDENCE === "1", "an evidence run writes the tracked dir on purpose");
  let files: string[] = [];
  try {
    files = readdirSync(EVIDENCE_DIR);
  } catch {
    // No committed evidence dir at all: nothing could have been written to it.
  }
  const touched = files.filter((name) => statSync(join(EVIDENCE_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-7-polish/integrations/ is newer than this run's start").toEqual([]);
});

test("the evidence README names a light and a dark screenshot for each mockup view, and every file in the dir is named", () => {
  const readme = readFileSync(README, "utf8");
  const files = new Set(readdirSync(EVIDENCE_DIR));
  const expected = VIEWS.flatMap((view) => THEMES.map((theme) => `${view}-${theme}.png`));
  expect(expected, "12 screenshots").toHaveLength(12);
  for (const view of VIEWS) expect(readme, `the README names the view ${view}`).toContain(`\`${view}\``);
  for (const file of expected) {
    expect(files.has(file), `${file} is committed`).toBe(true);
    expect(readme, `the README links ${file}`).toContain(`(${file})`);
  }
  expect([...files].filter((name) => name.endsWith(".png") && !expected.includes(name)), "a screenshot the README does not name").toEqual([]);
  expect(readme).toContain("INTEGRATIONS_EVIDENCE=1");
});

test("the test ids this spec targets are the ones INTEGRATIONS_TEST_IDS in model.ts defines", () => {
  const source = readFileSync(MODEL_SOURCE, "utf8");
  const defined = new Set([...source.matchAll(/^\s+\w+: "([^"]+)",?$/gm)].map((match) => match[1]));
  expect(defined.size, "model.ts's test-id table was read").toBeGreaterThan(20);
  expect(Object.values(IDS).filter((id) => !defined.has(id)), "ids the spec uses that model.ts does not define").toEqual([]);
});
