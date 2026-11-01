// The Settings screen (phase 7 item 08) in the built app against the fixture kernel
// (`./fixtures/settings.ts`): the provider's facts, the three terminal commands and the kernel's
// rows with no secret anywhere (AC2), launch at login read back from the (fake) OS after a
// relaunch and an honest "needs approval" (AC4), the theme changing at once through the main
// process and kept on relaunch (AC5), Reveal in Finder opening the main process's own data dir
// and the notifications preference kept on relaunch (AC6), the kernel going away while the
// screen holds data (AC7: `fixture.stop()`, "last known" in the title bar, the last data kept
// across leaving Settings and coming back, `fixture.restart()` clearing it), the keyboard (AC8),
// a live update that moves nothing already shown (AC9), the accessible names (AC10), and a light
// and a dark screenshot of every state the mockup shows (AC11). Phase 7 item 18 adds `~/…` paths,
// the account's words, one-line commands and the theme row's help text. Run `npm run build` first.
//
// Every launch sets `STUDIO_APP_PREFS_DIR` to a temp dir and `STUDIO_APP_FAKE_OS=1` (the main
// process's unpackaged-only seams, `electron/settings.ts`): `prefs.json` and the fake OS's
// `os-calls.json` live there, so no run ever registers a real login item, opens Finder or writes
// the owner's own `prefs.json`.
//
// Screenshots: with `SETTINGS_EVIDENCE=1` they are written to the committed evidence dir
// `docs/evidence/phase-7-polish/settings/`; otherwise to Playwright's per-test output dir, so CI
// never dirties tracked files, and the last tests assert nothing under the tracked dir changed
// during the run and that the evidence README names every file. The spec asserts behaviour,
// never pixels: fonts differ between macOS and CI.
//
// The shell does not mount the ⌘K palette or bind ⌘, yet (the same as phases 5 to 7), so the
// screen is opened by its hash and the keyboard walk uses Tab, Enter and Space. The screen's
// commands are pinned in `SettingsScreen.test.tsx` (jsdom).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureAnswer, FixtureKernel, FixtureRequest } from "./fixture-kernel";
import { FIXTURE_SECRET, settingsFixture } from "./fixtures/settings";
import type { SettingsFixture, SettingsFixtureOptions } from "./fixtures/settings";
import { SETTINGS_TEST_IDS as IDS } from "../src/screens/settings/model";
import { BACKOFF_CAP_MS, SETTLE_MS } from "../src/store/store";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/settings/", import.meta.url));
const README = join(EVIDENCE_DIR, "README.md");
const THEMES = ["light", "dark"] as const;
/** The mockup's states (`settings-<state>`), as the file names have them. */
const STATES = ["empty", "loading", "populated", "waiting", "error", "unreachable"] as const;

/** The three commands of the first-run screen (`SETUP_STEPS`, `src/shell/KernelStates.tsx`; the unit test pins the screen to it). */
const COMMANDS = ["claude setup-token", "security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w", "studio service install"] as const;

/** The main process's test seams (`electron/settings.ts`: `PREFS_DIR_ENV`, `FAKE_OS_ENV`, `PREFS_FILENAME`, `OS_CALLS_FILENAME`). */
const PREFS_DIR_ENV = "STUDIO_APP_PREFS_DIR";
const FAKE_OS_ENV = "STUDIO_APP_FAKE_OS";

/** How long the shell takes to notice the kernel is back (`shell.spec.ts` uses the same bound). */
const STATE_TIMEOUT_MS = BACKOFF_CAP_MS + SETTLE_MS + 3_000;
/** The title bar's subtitle slot (`Titlebar.tsx`). */
const SUBTITLE = "titlebar-subtitle";
/** The shell's band for an unreachable or reconnecting kernel. */
const KERNEL_BAND = '[data-testid="kernel-unreachable-band"], [data-testid="kernel-reconnecting-band"]';

/** When this run began, for the guard that the tracked evidence dir is untouched without `SETTINGS_EVIDENCE`. */
const RUN_START = Date.now();

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
let prefsDir: string | undefined;
const pageErrors: string[] = [];

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
  if (prefsDir !== undefined) rmSync(prefsDir, { recursive: true, force: true });
  prefsDir = undefined;
  // Drained per test, so an error is reported against the test that caused it.
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

const byId = (page: Page, id: string): Locator => page.getByTestId(id);
const switchNamed = (page: Page, name: string): Locator => page.getByRole("switch", { name });

// ---- The fake OS and the preferences file, as the main process wrote them ----------------------------------------------

interface OsCalls {
  readonly loginItem: { readonly openAtLogin: boolean; readonly status: string };
  readonly calls: readonly ({ readonly op: "setLoginItemSettings"; readonly openAtLogin: boolean } | { readonly op: "reveal"; readonly path: string })[];
}

function readJson<T>(name: string): T | undefined {
  const file = join(prefsDir as string, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : undefined;
}
const osCalls = (): OsCalls | undefined => readJson<OsCalls>("os-calls.json");
const storedPrefs = (): { notifications: boolean; theme: string } | undefined => readJson("prefs.json");

// ---- Launching ----------------------------------------------------------------------------------------------------------

/** Launch the built app on the running fixture kernel with this test's prefs dir and the fake OS, and open Settings by its hash. */
async function launch(): Promise<Page> {
  app = await launchApp({ ...(fixture as FixtureKernel).env, [PREFS_DIR_ENV]: prefsDir as string, [FAKE_OS_ENV]: "1" });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  return page;
}

/** Close the app and launch it again over the same fixture kernel, prefs dir and fake OS: a relaunch. */
async function relaunch(): Promise<Page> {
  await app?.close();
  app = undefined;
  return launch();
}

interface OpenOptions {
  /** Written to `os-calls.json` before the app starts: the OS's state (for a "needs approval" login item). */
  readonly seedOs?: OsCalls["loginItem"];
}

/** Start the fixture kernel serving `fx` and a fresh prefs dir, launch the app and open Settings. */
async function open(fx: SettingsFixture, options: OpenOptions = {}): Promise<Page> {
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  prefsDir = mkdtempSync(join(tmpdir(), "studio-app-prefs-"));
  if (options.seedOs !== undefined) writeFileSync(join(prefsDir, "os-calls.json"), `${JSON.stringify({ loginItem: options.seedOs, calls: [] })}\n`);
  return launch();
}

/** `open` for a fixture made from `options`, once the provider's facts and the app's own settings are on screen. */
async function openPopulated(options: SettingsFixtureOptions = {}): Promise<{ readonly fx: SettingsFixture; readonly page: Page }> {
  const fx = settingsFixture(options);
  const page = await open(fx);
  await expect(byId(page, IDS.auth)).toBeVisible();
  await expect(byId(page, IDS.login)).toBeEnabled();
  return { fx, page };
}

// ---- Screenshots and small readers ----------------------------------------------------------------------------------------

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

/** `settings-<state>-light.png` and `-dark.png` of the whole window; the dark tokens must really apply. */
async function screenshots(page: Page, state: (typeof STATES)[number], testInfo: TestInfo): Promise<void> {
  const evidence = process.env.SETTINGS_EVIDENCE === "1";
  if (evidence) mkdirSync(EVIDENCE_DIR, { recursive: true });
  // The screen scrolls inside the window, and it is taller than the default one: grow the window for the shots so "This app" is in them.
  const size: { width: number; height: number } | undefined = await app?.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [width = 0, height = 0] = win?.getSize() ?? [];
    win?.setSize(width, 1100);
    return { width, height };
  });
  await settle(page);
  // A committed screenshot must not publish the machine's user name: the home folder reads `~`, never in full.
  const home = await homeOf();
  expect(await page.evaluate(() => document.body.innerText), "no home path in the text the screenshot shows").not.toContain(home);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const file = `settings-${state}-${theme}.png`;
    const path = evidence ? join(EVIDENCE_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
  }
  expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);
  await setTheme(page, undefined);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (size !== undefined && size.width > 0) {
    await app?.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0]?.setSize(width, height), size);
  }
}

/** The text of the element with `id`, trimmed. */
async function textOf(page: Page, id: string): Promise<string> {
  return ((await byId(page, id).textContent()) ?? "").trim();
}

/** The app's home folder as the main process sees it (what the screen shortens to `~`). */
async function homeOf(): Promise<string> {
  return (await app?.evaluate(({ app: electronApp }) => electronApp.getPath("home"))) as string;
}

/**
 * Make the fixture kernel serve its data location and Loomwright install under the app's own home folder, so the
 * screen (and every screenshot) reads `~/…` and publishes no user name. Spec-local: the fixture file is not edited.
 */
async function serveUnderHome(fx: SettingsFixture, page: Page): Promise<void> {
  const home = await homeOf();
  fx.update({
    data_dir: `${home}/.loomwright-studio`,
    loomwright: { status: "ok", install_path: `${home}/.claude/plugins/cache/atelier/loomwright/17.22.0`, plugin_version: "17.22.0", contract_schema_version: 1, host_switch: true },
  });
  await expect(byId(page, IDS.dataDir)).toContainText("~/.loomwright-studio");
  await expect(byId(page, IDS.loomwright)).toHaveText("~/.claude/plugins/cache/atelier/loomwright/17.22.0");
}

/** Each element's bounding box with `id`, in document order. */
async function boxes(page: Page, id: string): Promise<(({ x: number; y: number; width: number; height: number }) | null)[]> {
  const all = await byId(page, id).all();
  return Promise.all(all.map((el) => el.boundingBox()));
}

/** Whether the renderer's `prefers-color-scheme: dark` matches now. Playwright pins light on every page, so reset it first (`app.md`). */
const prefersDark = (page: Page): Promise<boolean> => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);

// ---- AC2: the facts, and no secret ---------------------------------------------------------------------------------------

test("AC2: the provider, its account, health, token created and life, the three commands, the data location, notifier and Loomwright install, and no secret anywhere", async ({}, testInfo) => {
  const { fx, page } = await openPopulated({ extra: { token: FIXTURE_SECRET, secret: FIXTURE_SECRET } });
  expect(await textOf(page, IDS.provider)).toBe("subscription-token");
  expect(await textOf(page, IDS.account)).toBe("personal subscription");
  expect(await textOf(page, IDS.health)).toBe("ok");
  expect(await textOf(page, IDS.tokenCreated)).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  expect(await textOf(page, IDS.tokenLife)).toMatch(/^365 days · 265 days left · ends \d{1,2} [A-Z][a-z]{2} \d{4}$/);
  expect(await textOf(page, IDS.token)).toBe("Kept in the Keychain as loomwright-studio-oauth. The value is never shown, and this app has no field for it.");
  expect(await textOf(page, IDS.dataDir)).toContain(fx.dataDir);
  expect(await textOf(page, IDS.notifier)).toContain("osascript");
  expect(await textOf(page, IDS.loomwright)).toBe("/Users/owner/.claude/plugins/cache/atelier/loomwright/17.22.0");
  await expect(byId(page, IDS.band)).toHaveCount(0);
  expect(await byId(page, IDS.command).allTextContents()).toEqual([...COMMANDS]);
  for (const command of COMMANDS) await expect(page.getByRole("button", { name: `Copy command: ${command}` })).toBeVisible();

  // The kernel's body carried a token-shaped field: it is in neither the DOM's text nor its markup.
  expect(await page.content()).not.toContain(FIXTURE_SECRET);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(FIXTURE_SECRET);
  // The shell draws the one heading; the screen's own are h2 and below.
  expect(await page.locator("h1").allTextContents()).toEqual(["Settings"]);
  await expect(page.getByRole("button", { name: /^Settings/ })).toHaveAttribute("aria-current", "page");
  // Populated has no subtitle: the title alone (the mockup's `R.sub` is ''); "last known" is only for the unreachable view.
  expect(await textOf(page, SUBTITLE)).toBe("");
  await expect(byId(page, IDS.lastKnown)).toHaveCount(0);
  // The paths above are outside the app's home folder, so they read in full; under it, the shot reads `~/…`.
  await serveUnderHome(fx, page);
  await screenshots(page, "populated", testInfo);
});

test("Copy puts the command on the clipboard and says so", async () => {
  const { page } = await openPopulated();
  await page.getByRole("button", { name: `Copy command: ${COMMANDS[0]}` }).click();
  await expect(byId(page, IDS.copied).first()).toHaveText("Copied");
  expect(await app?.evaluate(({ clipboard }) => clipboard.readText())).toBe(COMMANDS[0]);
  // The longest command is copied whole, however it is drawn.
  await page.getByRole("button", { name: `Copy command: ${COMMANDS[1]}` }).click();
  await expect(byId(page, IDS.copied).nth(1)).toHaveText("Copied");
  expect(await app?.evaluate(({ clipboard }) => clipboard.readText())).toBe(COMMANDS[1]);
});

test("the empty state (missing): a danger band as an alert, no token rows, the set-up heading over the three commands", async ({}, testInfo) => {
  const fx = settingsFixture({ state: "missing" });
  const page = await open(fx);
  const band = byId(page, IDS.band);
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("role", "alert");
  await expect(band).toHaveText("There is no token in the Keychain. Without one the crew can't start sessions.");
  expect(await textOf(page, IDS.health)).toBe("missingno token in the Keychain item");
  await expect(byId(page, IDS.tokenCreated)).toHaveCount(0);
  await expect(byId(page, IDS.tokenLife)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Set it up in your terminal" })).toBeVisible();
  await expect(byId(page, IDS.command)).toHaveCount(3);
  await expect(byId(page, IDS.login)).toBeEnabled();
  await serveUnderHome(fx, page);
  await screenshots(page, "empty", testInfo);
});

test("the waiting state (expiring): an attention band naming the days, a renew soon badge and the days left beside the dot", async ({}, testInfo) => {
  const fx = settingsFixture({ state: "expiring" });
  const page = await open(fx);
  const band = byId(page, IDS.band);
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("role", "status");
  await expect(band).toHaveText(/^The subscription token expires in 18 days, on \d{1,2} [A-Z][a-z]{2} \d{4}\. Create a new one with the commands below, or sessions stop with failed:auth\.$/);
  expect(await textOf(page, IDS.health)).toBe("expiring18 days left");
  await expect(byId(page, IDS.renewSoon)).toHaveText("renew soon");
  await expect(byId(page, IDS.tokenLife)).toContainText("18 days left");
  await serveUnderHome(fx, page);
  await screenshots(page, "waiting", testInfo);
});

test("the loading state: skeleton rows for the auth provider and the kernel, the app's own settings already there, then the screen", async ({}, testInfo) => {
  const fx = settingsFixture();
  fx.holdSettings();
  const page = await open(fx);
  const loading = byId(page, IDS.loading);
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading.locator(".settings-skel")).toHaveCount(2);
  await expect(byId(page, `${IDS.loading}-kernel`)).toBeVisible();
  // The app's own settings do not wait for the kernel.
  await expect(byId(page, IDS.login)).toBeEnabled();
  await screenshots(page, "loading", testInfo);
  fx.releaseSettings();
  await expect(byId(page, IDS.auth)).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test("the error state: a route-failure card that names the settings request and its status, apart from the kernel band; the app's own settings still work; Try again recovers", async ({}, testInfo) => {
  const fx = settingsFixture();
  fx.failSettings(true);
  const page = await open(fx);
  const card = byId(page, IDS.error);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("role", "alert");
  await expect(card.getByRole("heading", { level: 3 })).toHaveText("Couldn't load the auth provider");
  await expect(card).toContainText("settings request failed (500)");
  await expect(byId(page, IDS.errorDetail)).toHaveText("GET /settings · 500 · store_unreadable");
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
  await expect(page.getByTestId("kernel-reconnecting-band")).toHaveCount(0);
  await expect(byId(page, IDS.commands)).toHaveCount(0);
  await expect(byId(page, IDS.kernel)).toHaveCount(0);
  await expect(byId(page, IDS.login)).toBeEnabled();
  await screenshots(page, "error", testInfo);
  fx.failSettings(false);
  await byId(page, IDS.retry).click();
  await expect(byId(page, IDS.auth)).toBeVisible();
  await expect(card).toHaveCount(0);
});

// ---- AC4: launch at login is the OS's, not a stored value -------------------------------------------------------------------

test("AC4: launch at login calls the OS with the new value, and after a relaunch the switch reads the OS's state, not a stored one", async () => {
  const { page } = await openPopulated();
  await expect(switchNamed(page, "Launch at login is off")).toHaveAttribute("aria-checked", "false");
  await switchNamed(page, "Launch at login is off").click();
  await expect(switchNamed(page, "Launch at login is on")).toHaveAttribute("aria-checked", "true");
  expect(osCalls()?.calls).toEqual([{ op: "setLoginItemSettings", openAtLogin: true }]);
  expect(JSON.stringify(storedPrefs() ?? {}), "launch at login is never stored in prefs.json").not.toContain("launchAtLogin");

  // A relaunch over the same OS state: still on.
  let again = await relaunch();
  await expect(byId(again, IDS.login)).toBeEnabled();
  await expect(switchNamed(again, "Launch at login is on")).toHaveAttribute("aria-checked", "true");

  // The owner turned it off in System Settings while the app was closed (the fake OS's own file): the switch follows the OS.
  await app?.close();
  app = undefined;
  const state = osCalls() as OsCalls;
  writeFileSync(join(prefsDir as string, "os-calls.json"), `${JSON.stringify({ ...state, loginItem: { openAtLogin: false, status: "not-registered" } })}\n`);
  again = await launch();
  await expect(byId(again, IDS.login)).toBeEnabled();
  await expect(switchNamed(again, "Launch at login is off")).toHaveAttribute("aria-checked", "false");
});

test("AC4: a login item that needs approval is said as such, and the switch stays off when asked", async () => {
  const page = await open(settingsFixture(), { seedOs: { openAtLogin: false, status: "requires-approval" } });
  await expect(byId(page, IDS.login)).toBeEnabled();
  await expect(byId(page, IDS.loginNote)).toContainText("Needs your approval");
  await expect(switchNamed(page, "Launch at login is off")).toHaveAttribute("aria-checked", "false");
  await switchNamed(page, "Launch at login is off").click();
  await expect.poll(() => osCalls()?.calls).toEqual([{ op: "setLoginItemSettings", openAtLogin: true }]);
  await expect(switchNamed(page, "Launch at login is off")).toHaveAttribute("aria-checked", "false");
  await expect(byId(page, IDS.loginNote)).toContainText("Needs your approval");
});

// ---- AC5: the theme ----------------------------------------------------------------------------------------------------

test("AC5: the theme re-themes at once through the main process with no reload, and is kept on relaunch before the window shows", async () => {
  const { page } = await openPopulated();
  await page.emulateMedia({ colorScheme: null });
  // A marker: a reload would drop it.
  await page.evaluate(() => {
    (window as unknown as { __marker?: string }).__marker = "same-window";
  });

  await byId(page, IDS.themeLight).click();
  await expect(byId(page, IDS.themeLight)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => prefersDark(page)).toBe(false);
  await byId(page, IDS.themeDark).click();
  await expect(byId(page, IDS.themeDark)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => prefersDark(page)).toBe(true);
  // The renderer's tokens follow the media query, not an attribute the screen set: the dark ground really applies.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  const darkGround = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim());
  await byId(page, IDS.themeLight).click();
  await expect.poll(() => prefersDark(page)).toBe(false);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim())).not.toBe(darkGround);
  expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker), "the window was not reloaded").toBe("same-window");

  await byId(page, IDS.themeDark).click();
  await expect.poll(() => prefersDark(page)).toBe(true);
  expect(storedPrefs()).toEqual({ notifications: true, theme: "dark" });

  // Relaunch over the same prefs dir: the first read of the media query, before any click, is dark.
  const again = await relaunch();
  await again.emulateMedia({ colorScheme: null });
  expect(await prefersDark(again), "the stored theme was applied before the window showed").toBe(true);
  await expect(byId(again, IDS.themeDark)).toHaveAttribute("aria-pressed", "true");
  await byId(again, IDS.themeLight).click();
  await expect.poll(() => prefersDark(again)).toBe(false);
  expect(storedPrefs()?.theme).toBe("light");
  const third = await relaunch();
  await third.emulateMedia({ colorScheme: null });
  expect(await prefersDark(third)).toBe(false);
  await expect(byId(third, IDS.themeLight)).toHaveAttribute("aria-pressed", "true");
});

// ---- AC6: Reveal, and the notifications preference ---------------------------------------------------------------------------

test("AC6: Reveal in Finder opens the main process's own data dir (never one the renderer names), and the notifications preference survives a relaunch", async () => {
  const { fx, page } = await openPopulated();
  // The view shows the kernel's own account of its data dir; the main process opens the one it resolved, the fixture kernel's.
  expect(await textOf(page, IDS.dataDir)).toContain(fx.dataDir);
  expect((fixture as FixtureKernel).dataDir).not.toBe(fx.dataDir);
  await page.getByRole("button", { name: "Reveal in Finder" }).click();
  await expect.poll(() => osCalls()?.calls).toEqual([{ op: "reveal", path: (fixture as FixtureKernel).dataDir }]);
  await expect(byId(page, IDS.revealNote)).toHaveCount(0);

  await switchNamed(page, "Notifications is on").click();
  await expect(switchNamed(page, "Notifications is off")).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => storedPrefs()).toEqual({ notifications: false, theme: "system" });
  const again = await relaunch();
  await expect(byId(again, IDS.notifications)).toBeEnabled();
  await expect(switchNamed(again, "Notifications is off")).toHaveAttribute("aria-checked", "false");
  expect(osCalls()?.calls.filter((c) => c.op === "reveal"), "the relaunch revealed nothing").toHaveLength(1);
});

// ---- AC7: the kernel unreachable ----------------------------------------------------------------------------------------------

test("AC7: when the kernel stops the shared band shows over the last data, 'last known' sits in the title bar, Reveal is disabled, the data survives leaving Settings and coming back, the app's own controls still work, and restarting clears it", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const { fx, page } = await openPopulated();
  await serveUnderHome(fx, page);
  const rows = async () => ({ provider: await textOf(page, IDS.provider), account: await textOf(page, IDS.account), health: await textOf(page, IDS.health), dataDir: await textOf(page, IDS.dataDir), loomwright: await textOf(page, IDS.loomwright) });
  const before = await rows();
  expect(await textOf(page, SUBTITLE), "populated: no subtitle").toBe("");

  await (fixture as FixtureKernel).stop();
  await expect(page.locator(KERNEL_BAND).first()).toBeVisible({ timeout: 20_000 });
  await expect(byId(page, SUBTITLE)).toHaveText("last known");
  await expect(byId(page, IDS.lastKnown), "the section heads carry no mark").toHaveCount(0);
  expect(await rows(), "the rows are the last read").toEqual(before);
  await expect(byId(page, IDS.unknown)).toHaveCount(0);
  await expect(byId(page, IDS.error)).toHaveCount(0);
  await expect(byId(page, IDS.notice)).toHaveCount(0);
  await expect(page.getByText("GET /settings")).toHaveCount(0);
  const reveal = page.getByRole("button", { name: "Reveal in Finder" });
  await expect(reveal).toBeDisabled();
  await expect(reveal).toHaveAttribute("title", "Needs the kernel");
  // What needs only the app stays usable: the preferences are the main process's.
  for (const id of [IDS.login, IDS.notifications, IDS.themeSystem, IDS.themeLight, IDS.themeDark]) await expect(byId(page, id)).toBeEnabled();
  await switchNamed(page, "Launch at login is off").click();
  await expect(switchNamed(page, "Launch at login is on")).toHaveAttribute("aria-checked", "true");
  await byId(page, IDS.themeDark).click();
  await expect(byId(page, IDS.themeDark)).toHaveAttribute("aria-pressed", "true");
  expect(osCalls()?.calls.filter((c) => c.op === "reveal"), "a disabled Reveal opened nothing").toEqual([]);
  await screenshots(page, "unreachable", testInfo);

  // Leave Settings and come back while the kernel is still down: a new mount that starts from the last data, never 'Status unknown'.
  await page.evaluate(() => {
    window.location.hash = "#/tasks";
  });
  await expect(byId(page, IDS.screen)).toHaveCount(0);
  await expect(page.locator("h1")).toHaveText("Tasks");
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await expect(byId(page, IDS.auth)).toBeVisible();
  await expect(byId(page, IDS.unknown), "a remount while the kernel is down is not 'Status unknown'").toHaveCount(0);
  await expect(byId(page, IDS.error)).toHaveCount(0);
  await expect(byId(page, SUBTITLE)).toHaveText("last known");
  expect(await rows(), "the remounted rows are the last read").toEqual(before);
  await expect(reveal).toBeDisabled();
  await expect(reveal).toHaveAttribute("title", "Needs the kernel");

  // The listener is back on the same port with the same state: the band goes, the subtitle clears, Reveal works again.
  await (fixture as FixtureKernel).restart();
  await expect(page.locator(KERNEL_BAND)).toHaveCount(0, { timeout: STATE_TIMEOUT_MS });
  await expect(byId(page, SUBTITLE)).toHaveText("");
  await expect(reveal).toBeEnabled({ timeout: STATE_TIMEOUT_MS });
  expect(await rows()).toEqual(before);
});

test("item 18 AC1: with the kernel down from the start and no data ever read, 'Status unknown' stays and there is no subtitle", async () => {
  test.setTimeout(120_000);
  const fx = settingsFixture();
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  prefsDir = mkdtempSync(join(tmpdir(), "studio-app-prefs-"));
  await fixture.stop();
  app = await launchApp({ ...fixture.env, [PREFS_DIR_ENV]: prefsDir, [FAKE_OS_ENV]: "1" });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await expect(byId(page, IDS.unknown)).toBeVisible({ timeout: 20_000 });
  await expect(byId(page, IDS.health)).toHaveCount(0);
  expect(await textOf(page, SUBTITLE)).toBe("");
});

// ---- Item 18: `~` paths, the account, one-line commands, the theme's words ----------------------------------------------------

test("item 18 AC3: a data location and a Loomwright install under the app's home read ~/…, a path outside it reads in full, and Reveal still opens the main process's own dir", async () => {
  const { fx, page } = await openPopulated();
  const home = await homeOf();
  // The fixture's own paths are outside the home folder: in full.
  expect(await textOf(page, IDS.dataDir)).toContain(fx.dataDir);
  expect(await textOf(page, IDS.loomwright)).toBe("/Users/owner/.claude/plugins/cache/atelier/loomwright/17.22.0");
  fx.update({
    data_dir: `${home}/.loomwright-studio`,
    loomwright: { status: "ok", install_path: `${home}/.claude/plugins/loomwright`, plugin_version: "17.23.0", contract_schema_version: 1, host_switch: true },
  });
  await expect(byId(page, IDS.dataDir)).toContainText("~/.loomwright-studio");
  await expect(byId(page, IDS.loomwright)).toHaveText("~/.claude/plugins/loomwright");
  expect(await page.evaluate(() => document.body.innerText), "the home folder is never printed in full").not.toContain(home);
  // The commands are not paths: untouched.
  expect(await byId(page, IDS.command).allTextContents()).toEqual([...COMMANDS]);
  await page.getByRole("button", { name: "Reveal in Finder" }).click();
  await expect.poll(() => osCalls()?.calls).toEqual([{ op: "reveal", path: (fixture as FixtureKernel).dataDir }]);
});

test("item 18 AC4: an account equal to the provider's id reads 'personal subscription', never the id", async () => {
  const fx = settingsFixture();
  const routes = fx.options.routes as Record<string, (req: FixtureRequest) => Promise<FixtureAnswer>>;
  const inner = routes["GET /settings"] as (req: FixtureRequest) => Promise<FixtureAnswer>;
  // What the real kernel answers when no label is recorded: the account is the provider's id.
  routes["GET /settings"] = async (req) => {
    const answer = await inner(req);
    const body = answer.body as { provider: { id: string } };
    return answer.status !== 200 ? answer : { ...answer, body: { ...body, provider: { ...body.provider, account: body.provider.id } } };
  };
  const page = await open(fx);
  await expect(byId(page, IDS.auth)).toBeVisible();
  expect(await textOf(page, IDS.provider)).toBe("subscription-token");
  expect(await textOf(page, IDS.account)).toBe("personal subscription");
});

test("item 18 AC5: each command block is one line at the default window size and at the smallest, and scrolls sideways rather than wrapping", async () => {
  const { page } = await openPopulated();
  const measure = () =>
    byId(page, IDS.command).evaluateAll((codes) =>
      codes.map((code) => {
        const style = getComputedStyle(code);
        const block = code.parentElement as HTMLElement;
        return {
          height: code.getBoundingClientRect().height,
          line: Number.parseFloat(style.lineHeight),
          blockHeight: block.getBoundingClientRect().height,
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
          overflowX: style.overflowX,
          overflows: code.scrollWidth > code.clientWidth,
        };
      }),
    );
  const size = await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getSize());
  expect(size, "the default window size (main.ts)").toEqual([1180, 760]);
  for (const width of [1180, 900]) {
    await app?.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]?.setSize(w, 760), width);
    await settle(page);
    const blocks = await measure();
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block.height, `a command is one line at ${width}px`).toBeLessThanOrEqual(block.line + 1);
      expect(block.whiteSpace).toBe("pre");
      expect(block.overflowWrap).toBe("normal");
      // Scrolling is allowed only because the block says so.
      if (block.overflows) expect(block.overflowX).toBe("auto");
    }
    expect(new Set(blocks.map((b) => Math.round(b.blockHeight))).size, `the three command blocks are equally tall at ${width}px`).toBe(1);
  }
});

test("item 18 AC6: the theme row's help text describes the pressed theme and changes when another is pressed", async () => {
  const { page } = await openPopulated();
  const help = async (): Promise<string> => ((await page.locator("#settings-theme-label + span").textContent()) ?? "").trim();
  expect(await help()).toBe("System follows your Mac.");
  await byId(page, IDS.themeDark).click();
  await expect(byId(page, IDS.themeDark)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(help).toBe("Always dark, whatever your Mac uses.");
  await byId(page, IDS.themeLight).click();
  await expect.poll(help).toBe("Always light, whatever your Mac uses.");
  await byId(page, IDS.themeSystem).click();
  await expect.poll(help).toBe("System follows your Mac.");
});

// ---- AC8: the keyboard -----------------------------------------------------------------------------------------------------------

test("AC8: every action is reached by Tab in order and done with Enter or Space: each Copy, Reveal, both switches and the three theme buttons", async () => {
  const { page } = await openPopulated();
  const focused = (): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null);
  await byId(page, IDS.copy).first().focus();
  expect(await focused()).toBe(IDS.copy);
  const seen: (string | null)[] = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    seen.push(await focused());
  }
  // Two more Copy buttons, Reveal, both switches, then the three theme buttons: a command that scrolls is not a tab stop.
  expect(seen).toEqual([IDS.copy, IDS.copy, IDS.reveal, IDS.login, IDS.notifications, IDS.themeSystem, IDS.themeLight, IDS.themeDark]);

  // Enter on a theme button, Space on a switch.
  await byId(page, IDS.themeLight).focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.themeLight)).toHaveAttribute("aria-pressed", "true");
  await byId(page, IDS.notifications).focus();
  await page.keyboard.press("Space");
  await expect(switchNamed(page, "Notifications is off")).toHaveAttribute("aria-checked", "false");
  await byId(page, IDS.login).focus();
  await page.keyboard.press("Space");
  await expect(switchNamed(page, "Launch at login is on")).toHaveAttribute("aria-checked", "true");
  // Enter on Reveal, and on a Copy.
  await byId(page, IDS.reveal).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => osCalls()?.calls.filter((c) => c.op === "reveal").length).toBe(1);
  await byId(page, IDS.copy).first().focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.copied).first()).toHaveText("Copied");
});

// ---- AC9: live updates ------------------------------------------------------------------------------------------------------------

test("AC9: an auth_ event with a changed view updates the screen with no reload, no loading state, and no row already shown moving", async () => {
  const { fx, page } = await openPopulated();
  await settle(page);
  // A marker (a reload would drop it) and a watcher for the skeleton (a flash would set it).
  await page.evaluate(
    ({ loading }) => {
      const w = window as unknown as { __marker?: string; __loadingSeen?: boolean };
      w.__marker = "same-window";
      w.__loadingSeen = false;
      new MutationObserver(() => {
        if (document.querySelector(`[data-testid^="${loading}"]`) !== null) w.__loadingSeen = true;
      }).observe(document.body, { childList: true, subtree: true });
    },
    { loading: IDS.loading },
  );
  const before = await boxes(page, IDS.row);
  expect(before.length, "the provider's six rows and the kernel's three have boxes").toBe(9);
  expect(before.every((b) => b !== null)).toBe(true);
  const readsBefore = fx.reads();

  fx.update({ data_dir: "/Users/owner/.loomwright-studio-new", notifier: "terminal-notifier", loomwright: { status: "ok", install_path: "/Users/owner/.claude/plugins/loomwright-next", plugin_version: "17.23.0", contract_schema_version: 1, host_switch: true } });
  await expect(byId(page, IDS.loomwright)).toHaveText("/Users/owner/.claude/plugins/loomwright-next");
  await expect(byId(page, IDS.notifier)).toContainText("terminal-notifier");
  await expect(byId(page, IDS.dataDir)).toContainText("/Users/owner/.loomwright-studio-new");
  await settle(page);

  expect(fx.reads(), "the event made the screen read GET /settings again").toBeGreaterThan(readsBefore);
  expect(await boxes(page, IDS.row), "the rows already shown did not move or resize").toEqual(before);
  const seen = await page.evaluate(() => ({ marker: (window as unknown as { __marker?: string }).__marker, loading: (window as unknown as { __loadingSeen?: boolean }).__loadingSeen }));
  expect(seen.marker, "the window was not reloaded").toBe("same-window");
  expect(seen.loading, "the screen never flashed a loading state").toBe(false);

  // The kernel's own `notify` for an expiring token (what it appends today) moves the provider to expiring: the band and the badge appear.
  fx.update({ state: "expiring" }, "notify", { reason: "auth_token_expiring", provider: "subscription-token", days: 18 });
  await expect(byId(page, IDS.band)).toBeVisible();
  await expect(byId(page, IDS.renewSoon)).toHaveText("renew soon");
  await expect(byId(page, IDS.health)).toContainText("18 days left");
  fx.update({ state: "ok" }, "auth_health_changed");
  await expect(byId(page, IDS.band)).toHaveCount(0);
  await expect(byId(page, IDS.renewSoon)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __loadingSeen?: boolean }).__loadingSeen), "no loading state on any of the three updates").toBe(false);
});

// ---- AC10: names, and tokens only ---------------------------------------------------------------------------------------------------

test("AC10: every switch, button, group and status has an accessible name, the sections are labelled, and there is no input or sign-in control", async () => {
  const { page } = await openPopulated();
  const root = byId(page, IDS.screen);
  await expect(root.getByRole("switch")).toHaveCount(2);
  for (const name of ["Launch at login is off", "Notifications is on"]) await expect(root.getByRole("switch", { name }), name).toHaveCount(1);
  const group = root.getByRole("group", { name: "Theme" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("button")).toHaveText(["System", "Light", "Dark"]);
  await expect(group.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
  for (const name of ["Auth provider", "Change it in your terminal", "Kernel", "This app"]) await expect(root.getByRole("region", { name }), name).toBeVisible();
  await expect(root.getByRole("heading", { level: 2 })).toHaveText(["Auth provider", "Change it in your terminal", "Kernel", "This app"]);
  await expect(root.getByRole("button", { name: "Reveal in Finder" })).toBeVisible();
  for (const command of COMMANDS) await expect(root.getByRole("button", { name: `Copy command: ${command}` })).toHaveCount(1);
  for (const button of await root.getByRole("button").all()) await expect(button).toHaveAccessibleName(/\S/);
  // Every status dot has its word beside it: the dot is hidden from assistive tech, the word is the signal.
  for (const dot of await root.locator(".settings-dot").all()) await expect(dot).toHaveAttribute("aria-hidden", "true");
  expect(await textOf(page, IDS.health)).toMatch(/\S/);

  // No place to type a secret and no sign-in: no input, no textarea, no control or link named sign in / log in / claude.ai, no "Claude Code".
  await expect(root.locator("input, textarea, select, [contenteditable]:not([contenteditable='false'])")).toHaveCount(0);
  const controls = await root.locator("button, a, [role='button'], [role='link'], [role='switch']").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent ?? ""));
  expect(controls.filter((name) => /(sign|log)[\s-]*in\b|claude\.ai/i.test(name) && !/^Launch at login is (on|off)$/.test(name))).toEqual([]);
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/claude code/i);
});

test("AC10: the screen's stylesheet takes every colour from the design tokens", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/screens/settings/settings.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "no hex colour").toEqual([]);
  expect(css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/g) ?? [], "no colour function").toEqual([]);
  const named = css.match(/(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline|fill|stroke)\s*:\s*(?:white|black|red|green|blue|gray|grey|yellow|orange|purple|transparent)\b/gi) ?? [];
  // `transparent` on a border is not a colour choice; any other named colour is.
  expect(named.filter((m) => !/transparent/i.test(m)), "no named colour").toEqual([]);
});

// ---- AC11: the evidence ---------------------------------------------------------------------------------------------------------------

test("AC11: without SETTINGS_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", async () => {
  test.skip(process.env.SETTINGS_EVIDENCE === "1", "an evidence run writes the tracked dir on purpose");
  let files: string[] = [];
  try {
    files = readdirSync(EVIDENCE_DIR);
  } catch {
    // No committed evidence dir at all: nothing could have been written to it.
  }
  const touched = files.filter((name) => statSync(join(EVIDENCE_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-7-polish/settings/ is newer than this run's start").toEqual([]);
});

test("AC11: the evidence README names a light and a dark screenshot of every state, and every one exists", () => {
  const readme = readFileSync(README, "utf8");
  const files = new Set(readdirSync(EVIDENCE_DIR));
  for (const state of STATES) {
    for (const theme of THEMES) {
      const file = `settings-${state}-${theme}.png`;
      expect(readme, `the README links ${file}`).toContain(`(${file})`);
      expect(files.has(file), `${file} is committed`).toBe(true);
    }
  }
  expect([...files].filter((f) => f.endsWith(".png")).length, "no screenshot the README does not know").toBe(STATES.length * THEMES.length);
  expect(readme).toContain("SETTINGS_EVIDENCE=1");
  for (const mockup of ["settings-empty", "settings-loading", "settings-populated", "settings-waiting", "settings-error", "settings-unreachable"]) expect(readme, `the README names the mockup view ${mockup}`).toContain(mockup);
  for (const departure of ["Keyboard map", "studio auth", "Notifications"]) expect(readme, `the README records the departure: ${departure}`).toContain(departure);
});
