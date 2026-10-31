// Phase 7 exit check, the app half (item 10): ROADMAP phase 7's criterion, "Each screen passes its polish gate",
// walked in the built app against ONE fixture kernel (`./fixtures/phase-7-exit.ts`) and nowhere else.
//
//   1. The tour (AC1): in one launch, each of the seven phase 7 screens is reached from the sidebar by keyboard
//      only (Tab / Shift+Tab to its button, Enter), shows its populated state in light and dark, and answers the
//      keys its own spec pins. The kernel is asked for nothing the composed table does not serve.
//   2. Every designed state (AC2): one test per screen walks that screen's shared states (empty, loading,
//      populated, waiting, error, unreachable, or the Integrations switch's five and its unreachable one) with the
//      mechanism the screen's own spec uses, in both themes, asserting the marker that spec asserts.
//   3. The coverage check (AC3): every view `docs/evidence/gui-v2-mockup/README.md` lists is a state AC2 walks, a
//      click-through the screen's own spec covers (checked by reading that spec's test titles), or a named gap.
//
// What this proves is the screens on fixture data, together. It does not prove them on the owner's real store or
// the packaged app: that is the live run in `docs/evidence/phase-7-exit-runbook.md`. The shell mounts neither the
// keyboard map nor the command palette (App.tsx), so no ⌘ key is pressed here. The app starts only through
// `launchApp` (`e2e/electron-harness.ts`), every launch gets a throwaway prefs dir and the fake OS (the main
// process's unpackaged-only seams, as `settings.spec.ts`), `shell.openExternal` is replaced before any click, and
// no screenshot is taken: this spec writes nothing under `docs/evidence/`. It asserts behaviour, never pixels.
//
// Run `npm run build` first; then `npx playwright test e2e/phase-7-exit.spec.ts`.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { PHASE_7_EXIT_ROUTE_KEYS, TASKS_INIT, phase7ExitFixture } from "./fixtures/phase-7-exit";
import type { Phase7ExitFixture, Phase7ExitInit } from "./fixtures/phase-7-exit";
import { ACCOUNT, APP_SLUG } from "./fixtures/integrations";
import { BUDGET_TEST_IDS as BUDGET } from "../src/screens/budget/model";
import { MEMORY_TEST_IDS as MEMORY } from "../src/screens/memory/model";
import { SCHEDULES_TEST_IDS as SCHEDULES } from "../src/screens/schedules/model";
import { SETTINGS_TEST_IDS as SETTINGS } from "../src/screens/settings/model";

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/**
 * The Integrations screen's test ids (`INTEGRATIONS_TEST_IDS` in `src/screens/integrations/model.ts`), copied for the
 * reason `integrations-switch.spec.ts` gives (that module pulls in a `.tsx` the e2e project cannot type-check); the
 * last static test reads `model.ts` and fails if any id below is not one of its values.
 */
const INTEGRATIONS = {
  appAgain: "integrations-app-again",
  appCancel: "integrations-app-cancel",
  appClose: "integrations-app-close",
  appName: "integrations-app-name",
  appOutcome: "integrations-app-outcome",
  appSetup: "integrations-app-setup",
  appStatus: "integrations-app-status",
  appStep1: "integrations-app-step-1",
  appStep2: "integrations-app-step-2",
  band: "integrations-band",
  detail: "integrations-detail",
  detailHeader: "integrations-detail-header",
  disconnect: "integrations-disconnect",
  listMeta: "integrations-row-meta",
  listRow: "integrations-row-github",
  replace: "integrations-replace",
  screen: "screen-integrations",
  status: "integrations-status",
  switchToApp: "integrations-switch-to-app",
} as const;
const INTEGRATIONS_MODEL = fileURLToPath(new URL("../src/screens/integrations/model.ts", import.meta.url));

/** The mockup README's view tables, and the specs the click-through views are covered by. */
const MOCKUP_README = fileURLToPath(new URL("../../docs/evidence/gui-v2-mockup/README.md", import.meta.url));
const SPEC_DIR = fileURLToPath(new URL("./", import.meta.url));

// ---- the session: one fixture kernel, one app ------------------------------------------------------------------------

interface Session {
  readonly exit: Phase7ExitFixture;
  readonly fixture: FixtureKernel;
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly prefsDir: string;
}

let session: Session | undefined;
const pageErrors: string[] = [];

/** Closes what is open without asserting anything (the safety net for a failed test). */
async function cleanup(): Promise<void> {
  const open = session;
  session = undefined;
  await open?.app.close().catch(() => undefined);
  await open?.fixture.close().catch(() => undefined);
  if (open !== undefined) rmSync(open.prefsDir, { recursive: true, force: true });
  pageErrors.length = 0;
}

test.afterEach(cleanup);

/** Whether `key` (`"GET /tasks/:kind/:id"`) serves `request`, `:param` standing for any one non-empty segment. */
function serves(key: string, request: { readonly method: string; readonly path: string }): boolean {
  const [method, pattern] = key.split(" ") as [string, string];
  if (method !== request.method) return false;
  const want = pattern.split("/");
  const got = request.path.split("/");
  return want.length === got.length && want.every((segment, i) => (segment.startsWith(":") ? got[i] !== "" : segment === got[i]));
}

/** Every request the kernel received that the composed table does not serve; the feed's upgrade is the one exemption. */
function unserved(fixture: FixtureKernel, keys: readonly string[]): string[] {
  return fixture.requests
    .filter((request) => !(request.method === "GET" && request.path === "/events/stream"))
    .filter((request) => !keys.some((key) => serves(key, request)))
    .map((request) => `${request.method} ${request.path}`);
}

/**
 * Starts the composed kernel (exactly its full route table), launches the app against it and returns once the
 * sidebar shows. `prepare` runs before the launch (a hold or a failure the screen's fixture switches on).
 */
async function start(init: Phase7ExitInit = {}, prepare?: (exit: Phase7ExitFixture) => void): Promise<Session> {
  await cleanup();
  const exit = phase7ExitFixture(init);
  prepare?.(exit);
  const fixture = await startFixtureKernel({ routes: exit.routes });
  exit.attach(fixture);
  const prefsDir = mkdtempSync(join(tmpdir(), "studio-app-prefs-"));
  const app = await launchApp({ ...fixture.env, STUDIO_APP_PREFS_DIR: prefsDir, STUDIO_APP_FAKE_OS: "1" });
  // No run opens a real browser: the setup URL the Integrations switch opens is read back from here, never followed.
  await app.evaluate(({ shell }) => {
    shell.openExternal = (): Promise<void> => Promise.resolve();
  });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  session = { exit, fixture, app, page, prefsDir };
  return session;
}

/** Closes the session and holds it to the two rules every launch obeys: nothing outside the table was asked, and the window threw nothing. */
async function finish(): Promise<void> {
  const open = session;
  if (open === undefined) throw new Error("no session is open");
  const outside = unserved(open.fixture, Object.keys(open.exit.routes));
  const errors = [...pageErrors];
  await cleanup();
  expect(outside, "requests the composed fixture's route table does not serve").toEqual([]);
  expect(errors, "the window logged no uncaught page errors").toEqual([]);
}

/** Opens a screen by its hash (the states are reached this way, as each screen's own spec does; the tour uses the keyboard). */
async function openByHash(page: Page, id: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/${id}`);
  await expect(page.getByTestId(`screen-${id}`)).toBeVisible();
}

// ---- themes -----------------------------------------------------------------------------------------------------------

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
}

async function clearTheme(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });
}

/** The ground behind the screen, to prove the dark tokens really applied. */
async function ground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector(".main") as Element).backgroundColor);
}

/** Runs `check` in light and in dark, and shows the two themes really differ behind the screen. */
async function inBothThemes(page: Page, check: () => Promise<void>): Promise<void> {
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await check();
    grounds.push(await ground(page));
  }
  expect(grounds[0], "the dark tokens applied: the ground differs between the themes").not.toBe(grounds[1]);
  await clearTheme(page);
}

// ---- the keyboard -------------------------------------------------------------------------------------------------------

const NAV = 'nav[aria-label="Screens"]';

/** Where focus is: the sidebar button's index, -2 on the page body, -1 anywhere else. */
async function navIndex(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const el = document.activeElement as HTMLElement | null;
    const nav = el?.closest(selector);
    if (el === null || nav === null || nav === undefined) return el === null || el.tagName === "BODY" ? -2 : -1;
    return [...nav.querySelectorAll("button")].indexOf(el as HTMLButtonElement);
  }, NAV);
}

/** Tab / Shift+Tab until focus is on the sidebar button labelled `label` (at most 60 presses); returns that button. */
async function tabToNav(page: Page, label: string): Promise<Locator> {
  const labels = (await page.locator(`${NAV} .nav-text`).allTextContents()).map((text) => text.trim());
  const want = labels.indexOf(label);
  expect(want, `the sidebar has a ${label} button`).toBeGreaterThanOrEqual(0);
  for (let presses = 0; presses <= 60; presses += 1) {
    const at = await navIndex(page);
    if (at === want) return page.locator(`${NAV} button`).nth(want);
    // On the body or before the wanted button: forward. After it, or in the screen's own controls: back.
    await page.keyboard.press(at === -2 || (at >= 0 && at < want) ? "Tab" : "Shift+Tab");
  }
  throw new Error(`Tab never reached the ${label} button in the sidebar`);
}

/** The test id of the focused element ("" when it has none). */
const focusedId = (page: Page): Promise<string> => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? "");

/** Tab until the focused element has `testId` (at most 60 presses). */
async function tabToId(page: Page, testId: string): Promise<void> {
  for (let presses = 0; presses <= 60; presses += 1) {
    if ((await focusedId(page)) === testId) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${testId}`);
}

/** The `data-<attribute>` of the focused element, or `null`. */
const focusedAttr = (page: Page, attribute: string): Promise<string | null> => page.evaluate((a) => document.activeElement?.getAttribute(a) ?? null, attribute);

const byId = (page: Page, id: string): Locator => page.getByTestId(id);

// ---- the seven screens: the tour -------------------------------------------------------------------------------------------

interface TourStop {
  readonly id: string;
  /** The sidebar button's text (`nav.label`). */
  readonly nav: string;
  /** The title bar's `h1` (`title`). */
  readonly title: string;
  /** The designed marker of the screen populated, the one its own spec asserts. */
  readonly populated: (page: Page) => Promise<void>;
  /** The in-screen keys its own spec pins, and where focus lands. */
  readonly keys: (page: Page) => Promise<void>;
}

const card = (page: Page, key: string): Locator => page.getByTestId(`task-card-${key}`);

async function focusedCard(page: Page): Promise<string | null> {
  return focusedAttr(page, "data-card-key");
}

const TOUR: readonly TourStop[] = [
  {
    id: "integrations",
    nav: "Integrations",
    title: "Integrations",
    populated: async (page) => {
      await expect(byId(page, INTEGRATIONS.detail)).toHaveAttribute("data-state", "connected");
      await expect(byId(page, INTEGRATIONS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
    },
    keys: async (page) => {
      // Tab through the screen's controls: the connector row, then Replace token, Switch and Disconnect (integrations-switch.spec AC5).
      await tabToId(page, INTEGRATIONS.listRow);
      await page.keyboard.press("Tab");
      await expect(byId(page, INTEGRATIONS.replace)).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(byId(page, INTEGRATIONS.switchToApp)).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(byId(page, INTEGRATIONS.disconnect)).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(byId(page, INTEGRATIONS.switchToApp)).toBeFocused();
    },
  },
  {
    id: "tasks",
    nav: "Tasks",
    title: "Tasks",
    populated: async (page) => {
      await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
      await expect(byId(page, "tasks-subtitle")).toHaveText("8 cards · 3 working");
      await expect(byId(page, "tasks-attention-band")).toHaveCount(0);
    },
    keys: async (page) => {
      // J / K move between the cards in DOM order, Enter opens the focused one, Esc returns with focus on it (tasks.spec AC8, AC6).
      const order = await page.locator("[data-card-key]").evaluateAll((els) => els.map((el) => el.getAttribute("data-card-key") ?? ""));
      expect(order).toHaveLength(8);
      await page.keyboard.press("j");
      expect(await focusedCard(page)).toBe(order[0]);
      await page.keyboard.press("j");
      expect(await focusedCard(page)).toBe(order[1]);
      await page.keyboard.press("k");
      expect(await focusedCard(page)).toBe(order[0]);
      await page.keyboard.press("j");
      await page.keyboard.press("Enter");
      await expect(byId(page, "task-detail")).toBeFocused();
      await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "detail");
      await page.keyboard.press("Escape");
      await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
      await expect(card(page, order[1] ?? "")).toBeFocused();
    },
  },
  {
    id: "playbooks",
    nav: "Playbooks",
    title: "Playbooks",
    populated: async (page) => {
      await expect(byId(page, "screen-playbooks")).toHaveAttribute("data-state", "populated");
      await expect(byId(page, "playbooks-count")).toHaveText("3 playbooks · 2 on");
      await expect(byId(page, "playbook-row")).toHaveCount(3);
    },
    keys: async (page) => {
      // J / K move between the rows, Enter opens the focused one, Back returns focus to its row (playbooks.spec AC10).
      const opens = byId(page, "playbook-open");
      await page.keyboard.press("j");
      await expect(opens.nth(0)).toBeFocused();
      await page.keyboard.press("j");
      await expect(opens.nth(1)).toBeFocused();
      await page.keyboard.press("j");
      await expect(opens.nth(2)).toBeFocused();
      await page.keyboard.press("k");
      await expect(opens.nth(1)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(byId(page, "playbook-detail")).toHaveAttribute("data-playbook", "2");
      const back = byId(page, "screen-playbooks").locator("[data-pb-back]");
      await expect(back).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(byId(page, "playbook-detail")).toHaveCount(0);
      await expect(opens.nth(1)).toBeFocused();
    },
  },
  {
    id: "schedules",
    nav: "Schedules",
    title: "Schedules & triggers",
    populated: async (page) => {
      // Names are not read: the composed `GET /playbooks` is the Playbooks fixture's, so a trigger shows its text, not its playbook's name.
      await expect(byId(page, SCHEDULES.timeline)).toBeVisible();
      await expect(byId(page, SCHEDULES.table)).toBeVisible();
      await expect(byId(page, SCHEDULES.entry)).toHaveCount(5);
      await expect(byId(page, SCHEDULES.summary)).toHaveText("5 upcoming · 4 triggers on");
    },
    keys: async (page) => {
      // Tab to the triggers, J / K move between them and Enter opens the focused one (schedules.spec AC6).
      const selects = byId(page, SCHEDULES.select);
      await tabToId(page, SCHEDULES.select);
      await expect(selects.first()).toBeFocused();
      await page.keyboard.press("j");
      await expect(selects.nth(1)).toBeFocused();
      await page.keyboard.press("j");
      await expect(selects.nth(2)).toBeFocused();
      await page.keyboard.press("k");
      await expect(selects.nth(1)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(selects.nth(1)).toHaveAttribute("aria-current", "true");
      await expect(selects.first()).not.toHaveAttribute("aria-current", "true");
      // That trigger has not fired, so its history is empty; back to the first, whose firing history is the populated screen.
      await expect(byId(page, SCHEDULES.historyEmpty)).toHaveText("Nothing has fired or been missed yet.");
      await page.keyboard.press("k");
      await expect(selects.first()).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(selects.first()).toHaveAttribute("aria-current", "true");
      await expect(byId(page, SCHEDULES.table)).toBeVisible();
    },
  },
  {
    id: "memory",
    nav: "Memory",
    title: "Memory",
    populated: async (page) => {
      await expect(byId(page, MEMORY.tree)).toBeVisible();
      await expect(byId(page, MEMORY.subtitle)).toHaveText("14 files");
      await expect(byId(page, MEMORY.fileButton)).toHaveCount(14);
    },
    keys: async (page) => {
      // J / K move between the files, Enter opens the focused one, Esc returns to the tree with focus on it (memory.spec AC10).
      const file = (path: string): Locator => page.locator(`[data-testid="${MEMORY.fileButton}"][data-path="${path}"]`);
      await page.keyboard.press("j");
      await expect(file("wright/role.md")).toBeFocused();
      await page.keyboard.press("j");
      await expect(file("wright/preferences.md")).toBeFocused();
      await page.keyboard.press("k");
      await expect(file("wright/role.md")).toBeFocused();
      await page.keyboard.press("j");
      await page.keyboard.press("Enter");
      await expect(byId(page, MEMORY.fileTitle)).toHaveText("preferences.md");
      await page.keyboard.press("Escape");
      await expect(byId(page, MEMORY.overview)).toBeVisible();
      await expect(file("wright/preferences.md")).toBeFocused();
    },
  },
  {
    id: "budget",
    nav: "Budget & audit",
    title: "Budget & audit",
    populated: async (page) => {
      await expect(byId(page, BUDGET.dayTable)).toBeVisible();
      await expect(byId(page, BUDGET.dayRow)).toHaveCount(7);
      await expect(byId(page, BUDGET.latestCard)).toHaveCount(3);
      await expect(byId(page, BUDGET.summary)).toHaveText("122,124 tokens today");
    },
    keys: async (page) => {
      // The audit log: Enter on its button opens it with focus on Back, Tab reaches the filters, a row and Older, Escape returns to the button (budget.spec AC6).
      await tabToId(page, BUDGET.auditButton);
      await page.keyboard.press("Enter");
      await expect(byId(page, BUDGET.table)).toBeVisible();
      await expect(byId(page, BUDGET.back)).toBeFocused();
      const reached: string[] = [];
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press("Tab");
        reached.push(await focusedId(page));
      }
      expect(reached).toEqual([BUDGET.filterKind, BUDGET.filterAgent, BUDGET.filterPlaybook, BUDGET.filterRange, BUDGET.auditRow, BUDGET.older]);
      await page.keyboard.press("Escape");
      await expect(byId(page, BUDGET.dayTable)).toBeVisible();
      await expect(byId(page, BUDGET.audit)).toHaveCount(0);
      await expect(byId(page, BUDGET.auditButton)).toBeFocused();
    },
  },
  {
    id: "settings",
    nav: "Settings",
    title: "Settings",
    populated: async (page) => {
      await expect(byId(page, SETTINGS.auth)).toBeVisible();
      await expect(byId(page, SETTINGS.provider)).toHaveText("subscription-token");
      await expect(byId(page, SETTINGS.band)).toHaveCount(0);
      await expect(byId(page, SETTINGS.login)).toBeEnabled();
    },
    keys: async (page) => {
      // Tab reaches each Copy, Reveal, both switches and the three theme buttons, in that order (settings.spec AC8).
      await tabToId(page, SETTINGS.copy);
      const seen: string[] = [];
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press("Tab");
        seen.push(await focusedId(page));
      }
      expect(seen).toEqual([SETTINGS.copy, SETTINGS.copy, SETTINGS.reveal, SETTINGS.login, SETTINGS.notifications, SETTINGS.themeSystem, SETTINGS.themeLight, SETTINGS.themeDark]);
    },
  },
];

test("AC1: one launch, the seven screens by keyboard only, each populated in light and dark, each answering its own keys, and the kernel asked for nothing outside the composed table", async () => {
  test.setTimeout(180_000);
  const { page, fixture, exit } = await start();

  // The table the spec hands the fixture kernel is the full one: exactly the listed keys, and nothing else.
  expect.soft(Object.keys(exit.routes).sort(), "the table holds exactly the listed keys").toEqual([...PHASE_7_EXIT_ROUTE_KEYS].sort());

  // The app opens on Chat, not on a phase 7 screen, and no click or hash change below reaches a screen.
  await expect(page.locator("header h1.titlebar-title")).toHaveText("Chat");
  expect(TOUR.map((stop) => stop.nav)).toEqual(["Integrations", "Tasks", "Playbooks", "Schedules", "Memory", "Budget & audit", "Settings"]);
  const hashes: string[] = [];
  await page.evaluate(() => {
    window.addEventListener("hashchange", () => ((window as unknown as { __hashes?: string[] }).__hashes ??= []).push(window.location.hash));
  });

  for (const stop of TOUR) {
    const button = await tabToNav(page, stop.nav);
    await page.keyboard.press("Enter");
    await expect(button, `${stop.nav}: the button is the current page`).toHaveAttribute("aria-current", "page");
    await expect(page.locator(`${NAV} [aria-current="page"]`), `${stop.nav}: it is the only current page`).toHaveCount(1);
    await expect(page.locator("header h1.titlebar-title")).toHaveText(stop.title);
    await expect(byId(page, `screen-${stop.id}`)).toBeVisible();
    await stop.populated(page);
    hashes.push(await page.evaluate(() => window.location.hash));

    await stop.keys(page);
    // The populated state again, in light and in dark.
    await inBothThemes(page, () => stop.populated(page));
  }
  // Each Enter changed the hash to its own screen, in order: the sidebar did it, not the spec.
  expect(hashes).toEqual(TOUR.map((stop) => `#/${stop.id}`));
  expect(await page.evaluate(() => (window as unknown as { __hashes?: string[] }).__hashes)).toEqual(TOUR.map((stop) => `#/${stop.id}`));

  // The kernel was asked for nothing the composed table does not serve (the feed's upgrade aside).
  expect(unserved(fixture, Object.keys(exit.routes)), "requests the table (the one handed to the fixture kernel) does not serve").toEqual([]);
  await finish();
});

// ---- every designed state, one test per screen -------------------------------------------------------------------------------

/** A route the kernel never answers (the loading state), as `tasks.spec.ts` AC11 holds `GET /tasks`. */
const hang = (): Promise<never> => new Promise<never>(() => undefined);
const refused500 = () => ({ status: 500, body: { error: "store_unreadable", message: "the kernel could not read its store" } });

interface StateCase {
  /** The mockup view's suffix: the view id is `<screen>-<state>`. */
  readonly state: string;
  readonly init: Phase7ExitInit;
  readonly prepare?: (exit: Phase7ExitFixture) => void;
  /** The marker the screen's own spec asserts for this state. */
  readonly check: (page: Page) => Promise<void>;
}

const BAND = "kernel-unreachable-band";

const CASES = {
  tasks: [
    {
      state: "empty",
      init: { tasks: TASKS_INIT.empty() },
      check: async (page) => {
        await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "empty");
        await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();
        await expect(page.getByRole("button", { name: "Ask Wright" })).toBeVisible();
        await expect(byId(page, "tasks-board")).toHaveCount(0);
      },
    },
    {
      state: "loading",
      init: { overrides: { "GET /tasks": hang } },
      check: async (page) => {
        await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "loading");
        await expect(page.locator(".tasks-skel").first()).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: "Loading tasks" })).toHaveCount(1);
      },
    },
    {
      state: "populated",
      init: {},
      check: async (page) => {
        await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
        await expect(byId(page, "tasks-board").getByRole("heading", { level: 2 })).toHaveText(["Waiting on you", "Working", "Parked", "Done today"]);
        await expect(byId(page, "tasks-attention-band")).toHaveCount(0);
      },
    },
    {
      state: "waiting",
      init: { tasks: TASKS_INIT.waiting() },
      check: async (page) => {
        await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
        await expect(byId(page, "tasks-attention-band")).toHaveText("2 things wait on you.");
      },
    },
    {
      state: "error",
      init: { overrides: { "GET /tasks": refused500 } },
      check: async (page) => {
        await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "error");
        await expect(byId(page, "tasks-error-detail")).toHaveText("GET /tasks · 500 · store_unreadable · the kernel could not read its store");
        await expect(byId(page, BAND)).toHaveCount(0);
      },
    },
    {
      state: "unreachable",
      init: { unreachable: true },
      check: async (page) => {
        await expect(byId(page, BAND)).toContainText("Couldn't reach the kernel");
        await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
        await expect(byId(page, "tasks-subtitle")).toHaveText("8 cards · 3 working · last known");
        await expect(card(page, "task:9")).toBeDisabled();
      },
    },
  ],
  playbooks: [
    {
      state: "empty",
      init: { playbooks: { state: "empty" } },
      check: async (page) => {
        await expect(byId(page, "screen-playbooks")).toHaveAttribute("data-state", "empty");
        await expect(page.getByRole("heading", { name: "No playbooks yet." })).toBeVisible();
      },
    },
    {
      state: "loading",
      init: { playbooks: { holdList: true } },
      check: async (page) => {
        await expect(byId(page, "screen-playbooks")).toHaveAttribute("data-state", "loading");
        await expect(page.locator(".pb-skeleton").first()).toBeVisible();
      },
    },
    {
      state: "populated",
      init: {},
      check: async (page) => {
        await expect(byId(page, "screen-playbooks")).toHaveAttribute("data-state", "populated");
        await expect(byId(page, "playbooks-count")).toHaveText("3 playbooks · 2 on");
        await expect(byId(page, "playbook-row")).toHaveCount(3);
      },
    },
    {
      state: "waiting",
      init: { playbooks: { state: "waiting" } },
      check: async (page) => {
        await expect(byId(page, "screen-playbooks")).toHaveAttribute("data-state", "waiting");
        await expect(byId(page, "playbooks-band")).toContainText("1 playbook waits on you: Weekly changelog draft is a draft");
      },
    },
    {
      state: "error",
      init: { playbooks: { failList: true } },
      check: async (page) => {
        await expect(byId(page, "screen-playbooks")).toHaveAttribute("data-state", "error");
        await expect(byId(page, "playbooks-error")).toContainText("GET /playbooks · 500 · store_unreadable · the kernel could not read its store");
        await expect(byId(page, BAND)).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      },
    },
    {
      state: "unreachable",
      init: { unreachable: true },
      check: async (page) => {
        await expect(byId(page, BAND)).toContainText("Couldn't reach the kernel");
        await expect(byId(page, "screen-playbooks")).toHaveAttribute("data-offline", "true");
        await expect(byId(page, "playbooks-count")).toHaveText("3 playbooks · 2 on · last known");
        for (const toggle of await page.getByRole("switch").all()) await expect(toggle).toBeDisabled();
      },
    },
  ],
  schedules: [
    {
      state: "empty",
      init: { schedules: { state: "empty" } },
      check: async (page) => {
        await expect(byId(page, SCHEDULES.empty).getByRole("heading", { level: 2 })).toHaveText("Nothing is scheduled.");
        await expect(byId(page, SCHEDULES.timeline)).toHaveCount(0);
      },
    },
    {
      state: "loading",
      init: {},
      prepare: (exit) => exit.schedules.holdSchedule(),
      check: async (page) => {
        await expect(byId(page, SCHEDULES.loading)).toHaveAttribute("aria-busy", "true");
        await expect(byId(page, SCHEDULES.loading).locator(".schedules-skel")).toHaveCount(4);
      },
    },
    {
      state: "populated",
      init: {},
      check: async (page) => {
        await expect(byId(page, SCHEDULES.timeline)).toBeVisible();
        await expect(byId(page, SCHEDULES.table)).toBeVisible();
        await expect(byId(page, SCHEDULES.summary)).toHaveText("5 upcoming · 4 triggers on");
      },
    },
    {
      state: "error",
      init: {},
      prepare: (exit) => exit.schedules.failSchedule(true),
      check: async (page) => {
        await expect(byId(page, SCHEDULES.error)).toHaveAttribute("role", "alert");
        await expect(byId(page, SCHEDULES.errorDetail)).toHaveText("GET /schedule · 500 · store_unreadable");
        await expect(byId(page, BAND)).toHaveCount(0);
      },
    },
    {
      state: "unreachable",
      init: { unreachable: true },
      check: async (page) => {
        await expect(byId(page, BAND)).toContainText("Couldn't reach the kernel");
        await expect(byId(page, SCHEDULES.screen)).toHaveAttribute("data-offline", "true");
        await expect(byId(page, SCHEDULES.summary)).toHaveText("5 upcoming · 4 triggers on · last known");
        for (const toggle of await page.getByRole("switch").all()) await expect(toggle).toBeDisabled();
      },
    },
  ],
  memory: [
    {
      state: "empty",
      init: { memory: { state: "empty" } },
      check: async (page) => {
        await expect(byId(page, MEMORY.empty).getByRole("heading", { level: 2 })).toHaveText("Nothing remembered yet.");
        await expect(byId(page, MEMORY.tree)).toHaveCount(0);
      },
    },
    {
      state: "loading",
      init: {},
      prepare: (exit) => exit.memory.holdTree(),
      check: async (page) => {
        await expect(byId(page, MEMORY.loading)).toHaveAttribute("aria-busy", "true");
        await expect(byId(page, MEMORY.loading).locator(".memory-skel")).toHaveCount(5);
      },
    },
    {
      state: "populated",
      init: {},
      check: async (page) => {
        await expect(byId(page, MEMORY.tree)).toBeVisible();
        await expect(byId(page, MEMORY.subtitle)).toHaveText("14 files");
        await expect(byId(page, MEMORY.overview).getByRole("heading", { level: 2 })).toHaveText("Pick a file");
      },
    },
    {
      state: "error",
      init: {},
      prepare: (exit) => exit.memory.failTree(true),
      check: async (page) => {
        await expect(byId(page, MEMORY.error)).toHaveAttribute("role", "alert");
        await expect(byId(page, MEMORY.errorDetail)).toHaveText("GET /memory · 500 · store_unreadable");
        await expect(byId(page, BAND)).toHaveCount(0);
      },
    },
    {
      state: "unreachable",
      init: { unreachable: true },
      check: async (page) => {
        await expect(byId(page, BAND)).toContainText("Couldn't reach the kernel");
        await expect(byId(page, MEMORY.subtitle)).toHaveText("14 files · last known");
        await expect(page.locator(`[data-testid="${MEMORY.fileButton}"][data-path="mason/lessons.md"]`)).toHaveAttribute("aria-disabled", "true");
      },
    },
  ],
  budget: [
    {
      state: "empty",
      init: { budget: { state: "empty" } },
      check: async (page) => {
        await expect(byId(page, BUDGET.empty).getByRole("heading", { level: 2 })).toHaveText("No tokens used yet.");
        await expect(byId(page, BUDGET.dayTable)).toHaveCount(0);
      },
    },
    {
      state: "loading",
      init: {},
      prepare: (exit) => exit.budget.holdUsage(),
      check: async (page) => {
        await expect(byId(page, BUDGET.loading)).toHaveAttribute("aria-busy", "true");
        await expect(byId(page, BUDGET.loading).locator(".budget-skel")).toHaveCount(4);
      },
    },
    {
      state: "populated",
      init: {},
      check: async (page) => {
        await expect(byId(page, BUDGET.dayTable)).toBeVisible();
        await expect(byId(page, BUDGET.latestCard)).toHaveCount(3);
        await expect(byId(page, BUDGET.band)).toHaveCount(0);
      },
    },
    {
      state: "waiting",
      init: { budget: { state: "waiting" } },
      check: async (page) => {
        await expect(byId(page, BUDGET.band)).toHaveAttribute("role", "status");
        await expect(byId(page, BUDGET.band)).toContainText("1 agent waits on you: Ada used 100,000 of its 100,000 tokens today");
      },
    },
    {
      state: "error",
      init: {},
      prepare: (exit) => exit.budget.failUsage(true),
      check: async (page) => {
        await expect(byId(page, BUDGET.error)).toHaveAttribute("role", "alert");
        await expect(byId(page, BUDGET.errorDetail)).toHaveText("GET /budget/usage · 500 · store_unreadable");
        await expect(byId(page, BAND)).toHaveCount(0);
      },
    },
    {
      state: "unreachable",
      init: { unreachable: true },
      check: async (page) => {
        await expect(byId(page, BAND)).toContainText("Couldn't reach the kernel");
        await expect(byId(page, BUDGET.summary)).toContainText("last known");
        await expect(byId(page, BUDGET.auditButton)).toBeDisabled();
        await expect(byId(page, BUDGET.openLog)).toBeDisabled();
      },
    },
  ],
  settings: [
    {
      // The empty state is a missing token: the Keychain item is not there yet.
      state: "empty",
      init: { settings: { state: "missing" } },
      check: async (page) => {
        await expect(byId(page, SETTINGS.band)).toHaveAttribute("role", "alert");
        await expect(byId(page, SETTINGS.band)).toHaveText("There is no token in the Keychain. Without one the crew can't start sessions.");
        await expect(byId(page, SETTINGS.command)).toHaveCount(3);
      },
    },
    {
      state: "loading",
      init: {},
      prepare: (exit) => exit.settings.holdSettings(),
      check: async (page) => {
        await expect(byId(page, SETTINGS.loading)).toHaveAttribute("aria-busy", "true");
        await expect(byId(page, SETTINGS.loading).locator(".settings-skel")).toHaveCount(2);
        // The app's own settings do not wait for the kernel.
        await expect(byId(page, SETTINGS.login)).toBeEnabled();
      },
    },
    {
      state: "populated",
      init: {},
      check: async (page) => {
        await expect(byId(page, SETTINGS.auth)).toBeVisible();
        await expect(byId(page, SETTINGS.health)).toHaveText("ok");
        await expect(byId(page, SETTINGS.band)).toHaveCount(0);
        await expect(byId(page, SETTINGS.login)).toBeEnabled();
      },
    },
    {
      // The waiting state is a token that expires in 18 days.
      state: "waiting",
      init: { settings: { state: "expiring" } },
      check: async (page) => {
        await expect(byId(page, SETTINGS.band)).toHaveAttribute("role", "status");
        await expect(byId(page, SETTINGS.band)).toHaveText(/^The subscription token expires in 18 days, on \d{1,2} [A-Z][a-z]{2} \d{4}\./);
        await expect(byId(page, SETTINGS.renewSoon)).toHaveText("renew soon");
      },
    },
    {
      state: "error",
      init: {},
      prepare: (exit) => exit.settings.failSettings(true),
      check: async (page) => {
        await expect(byId(page, SETTINGS.error)).toHaveAttribute("role", "alert");
        await expect(byId(page, SETTINGS.errorDetail)).toHaveText("GET /settings · 500 · store_unreadable");
        await expect(byId(page, SETTINGS.commands)).toHaveCount(0);
        await expect(byId(page, SETTINGS.login)).toBeEnabled();
      },
    },
    {
      state: "unreachable",
      init: { unreachable: true },
      check: async (page) => {
        await expect(byId(page, BAND)).toContainText("Couldn't reach the kernel");
        await expect(byId(page, SETTINGS.lastKnown)).toHaveCount(2);
        await expect(page.getByRole("button", { name: "Reveal in Finder" })).toBeDisabled();
      },
    },
  ],
} as const satisfies Record<string, readonly StateCase[]>;

type CaseScreen = keyof typeof CASES;

for (const screen of Object.keys(CASES) as CaseScreen[]) {
  test(`AC2: ${screen}: every designed state, in light and dark, with the mechanism its own spec uses`, async () => {
    test.setTimeout(240_000);
    for (const state of CASES[screen] as readonly StateCase[]) {
      const { page } = await start(state.init, state.prepare);
      await openByHash(page, screen);
      await inBothThemes(page, async () => {
        await state.check(page);
      });
      await finish();
    }
  });
}

/** The Integrations screen's states, in the order the switch walks them: the token detail, then the dialog's views, then the App. */
const INTEGRATIONS_STATES = ["token", "token-to-app", "token-to-app-install", "token-to-app-failed", "app-connected", "unreachable"] as const;

test("AC2: integrations: the token, the switch's two steps and its failure, the App, and the kernel unreachable, in light and dark", async () => {
  test.setTimeout(240_000);
  const { page, exit } = await start({ integrations: { connector: "connected" } });
  const fx = exit.integrations;
  await openByHash(page, "integrations");
  const detail = byId(page, INTEGRATIONS.detail);
  const setup = byId(page, INTEGRATIONS.appSetup);
  const checks: Record<Exclude<(typeof INTEGRATIONS_STATES)[number], "unreachable">, () => Promise<void>> = {
    token: async () => {
      await expect(detail).toHaveAttribute("data-state", "connected");
      await expect(byId(page, INTEGRATIONS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
      await expect(byId(page, INTEGRATIONS.detailHeader).getByRole("button")).toHaveText(["Replace token", "Switch to GitHub App", "Disconnect"]);
    },
    "token-to-app": async () => {
      await expect(setup).toHaveAttribute("data-phase", "create");
      await expect(setup.getByRole("heading", { level: 2 })).toHaveText("Switch GitHub to the GitHub App");
      await expect(byId(page, INTEGRATIONS.appStep1)).toContainText("Step 1 of 2 · Create the App on GitHub");
      await expect(byId(page, INTEGRATIONS.appStep1)).toContainText("waiting for you");
      await expect(byId(page, INTEGRATIONS.listMeta)).toHaveText(`connected · ${ACCOUNT} · token · setting up the App`);
    },
    "token-to-app-install": async () => {
      await expect(setup).toHaveAttribute("data-phase", "install");
      await expect(byId(page, INTEGRATIONS.appStep1)).toContainText("done");
      await expect(byId(page, INTEGRATIONS.appStep2)).toContainText("Step 2 of 2 · Pick the repos and install it");
      await expect(byId(page, INTEGRATIONS.listMeta)).toHaveText(`connected · ${ACCOUNT} · token · setting up the App`);
    },
    "token-to-app-failed": async () => {
      await expect(setup).toHaveAttribute("data-phase", "failed");
      await expect(setup.getByRole("heading", { level: 2 })).toHaveText("Setup didn't finish");
      await expect(byId(page, INTEGRATIONS.appOutcome)).toHaveAttribute("role", "alert");
      await expect(byId(page, INTEGRATIONS.appOutcome)).toContainText("GitHub is still connected through your token.");
      await expect(byId(page, INTEGRATIONS.listMeta)).toHaveText(`connected · ${ACCOUNT} · token`);
    },
    "app-connected": async () => {
      await expect(detail).toHaveAttribute("data-state", "connected");
      await expect(detail).toHaveAttribute("data-method", "app");
      await expect(byId(page, INTEGRATIONS.listMeta)).toHaveText(`connected · ${ACCOUNT} · GitHub App`);
      await expect(byId(page, INTEGRATIONS.appName)).toHaveText(APP_SLUG);
      await expect(byId(page, INTEGRATIONS.switchToApp)).toHaveCount(0);
    },
  };

  // The token detail.
  await inBothThemes(page, checks.token);

  // Step 1: Switch to GitHub App, pressed with the keyboard. One setup call, the window stays put, nothing is disconnected.
  await byId(page, INTEGRATIONS.switchToApp).focus();
  await page.keyboard.press("Enter");
  await expect(setup).toBeVisible();
  await inBothThemes(page, checks["token-to-app"]);
  expect(fx.setups, "exactly one setup call").toHaveLength(1);
  expect(fx.disconnects, "no disconnect was sent").toEqual([]);

  // Step 2: the kernel's `storeApp` over the token row, the one event the dialog moves on.
  fx.appStored();
  await inBothThemes(page, checks["token-to-app-install"]);

  // The failure: the kernel refuses the running setup. The token is still connected, and the kernel's own message is not shown.
  fx.refuseEvent("install_failed");
  await inBothThemes(page, checks["token-to-app-failed"]);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain("RAW-KERNEL-MESSAGE");
  expect(fx.disconnects, "the failure disconnected nothing").toEqual([]);

  // The install lands: the dialog is closed and the App's detail replaces the token's.
  await byId(page, INTEGRATIONS.appClose).click();
  await expect(setup).toHaveCount(0);
  fx.change("app-connected");
  await inBothThemes(page, checks["app-connected"]);
  expect(fx.disconnects, "the whole switch sent no disconnect").toEqual([]);
  expect(fx.tokens, "and no token").toEqual([]);
  await finish();

  // Unreachable: the kernel goes away while the screen asks (the integrations spec's own mechanism, which closes the kernel).
  const gone = await start({ integrations: { connector: "connected" } });
  await openByHash(gone.page, "integrations");
  await expect(byId(gone.page, INTEGRATIONS.detail)).toHaveAttribute("data-state", "connected");
  gone.exit.integrations.dropNextRead();
  gone.exit.integrations.change("connected");
  await inBothThemes(gone.page, async () => {
    await expect(byId(gone.page, INTEGRATIONS.band)).toContainText("Couldn't reach the kernel");
    await expect(byId(gone.page, INTEGRATIONS.listMeta)).toHaveText("status unknown · kernel unreachable");
    await expect(byId(gone.page, INTEGRATIONS.detail)).toHaveAttribute("data-state", "connected");
    await expect(byId(gone.page, INTEGRATIONS.status)).toContainText("Unknown while the kernel is unreachable");
    for (const id of [INTEGRATIONS.replace, INTEGRATIONS.switchToApp, INTEGRATIONS.disconnect]) await expect(byId(gone.page, id)).toBeDisabled();
  });
  await finish();
});

// ---- the coverage of the mockup ---------------------------------------------------------------------------------------------------

/**
 * Mockup views with no screen in the app, found by this check and not fixed in it: the Keyboard map (`keymap`) has no
 * screen in `app/src`, and the shell mounts no global keyboard map or command palette (`App.tsx`), so the sidebar's ⌘ labels
 * and ⌘K do nothing in a launched window. Both are findings for new phase 7 items, recorded in the "Phase 7 exit: live run"
 * entry of `docs/OPEN_QUESTIONS.md`.
 */
const KNOWN_GAPS: readonly string[] = ["keymap"];

/** Click-through views: not a shared state AC2 walks, but a test in the screen's own spec covers it (found by its title prefix). */
const CLICK_THROUGH: Readonly<Record<string, { readonly spec: string; readonly title: string }>> = {
  "tasks-history": { spec: "tasks.spec.ts", title: "AC6: a card opens with its facts, its history" },
  "playbooks-detail": { spec: "playbooks.spec.ts", title: "AC4/AC12: the detail shows the policy" },
  "playbooks-edit": { spec: "playbooks.spec.ts", title: "AC5: a field edit is one /set" },
  "playbooks-edit-refused": { spec: "playbooks.spec.ts", title: "AC5: a refusal shows under its field" },
  "playbooks-history": { spec: "playbooks.spec.ts", title: "AC5: a field edit is one /set" },
  "memory-file": { spec: "memory.spec.ts", title: "AC6: opening a file shows its full path" },
  "memory-edit": { spec: "memory.spec.ts", title: "AC7: Edit shows a textarea" },
  "memory-conflict": { spec: "memory.spec.ts", title: "AC8: an agent's write after the file was opened makes a save a conflict" },
  "budget-audit": { spec: "budget.spec.ts", title: "AC4: the audit log pages Older and Newer" },
  "budget-audit-filtered": { spec: "budget.spec.ts", title: "AC4: choosing Agent and Playbook" },
};

/** The views the AC2 tests walk: `<screen>-<state>` for each state in `CASES` and in the Integrations walk. */
function walkedViews(): string[] {
  return [
    ...(Object.keys(CASES) as CaseScreen[]).flatMap((screen) => (CASES[screen] as readonly StateCase[]).map((c) => `${screen}-${c.state}`)),
    ...INTEGRATIONS_STATES.map((state) => `integrations-${state}`),
  ];
}

/** The view ids of the README's view tables: the first column of each row in `## Screenshots`, before the next `##` section. */
function mockupViews(): string[] {
  const readme = readFileSync(MOCKUP_README, "utf8");
  const start = readme.indexOf("\n## Screenshots");
  expect(start, "the README has a ## Screenshots section").toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const end = rest.indexOf("\n## ", 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/^\| `([a-z][a-z0-9-]*)` \|/gm)].map((match) => match[1] as string);
}

test("AC3: every view in the mockup README is a state the walk covers, a click-through its own spec covers, or a named gap", () => {
  const views = mockupViews();
  const walked = walkedViews();
  const clicked = Object.keys(CLICK_THROUGH);

  // The README lists 51 views, `tasks-empty` first and `keymap` last, each once.
  expect.soft(views, "the README's view tables list 51 views").toHaveLength(51);
  expect.soft(views[0]).toBe("tasks-empty");
  expect.soft(views.at(-1)).toBe("keymap");
  expect.soft(new Set(views).size, "no view is listed twice").toBe(views.length);

  // Each view is exactly one of: walked, mapped to a spec's test, or a known gap.
  const classes = (id: string): string[] => [walked.includes(id) ? "walked" : "", clicked.includes(id) ? "click-through" : "", KNOWN_GAPS.includes(id) ? "gap" : ""].filter(Boolean);
  expect.soft(views.filter((id) => classes(id).length === 0), "views no test covers and no gap names").toEqual([]);
  expect.soft(views.filter((id) => classes(id).length > 1), "views counted twice (walked, mapped or a gap, not two of them)").toEqual([]);

  // A stale gap or mapping goes red: everything this spec names is a view the README lists.
  expect.soft(KNOWN_GAPS.filter((id) => !views.includes(id)), "known gaps that are not views in the README").toEqual([]);
  expect.soft(clicked.filter((id) => !views.includes(id)), "mapped views that are not views in the README").toEqual([]);
  expect.soft(walked.filter((id) => !views.includes(id)), "walked states that are not views in the README").toEqual([]);

  // The one gap is the Keyboard map.
  expect.soft(KNOWN_GAPS, "the known gaps are exactly the Keyboard map").toEqual(["keymap"]);
  expect.soft(walked, "40 states are walked").toHaveLength(40);
  expect.soft(clicked, "10 views are mapped to a click-through").toHaveLength(10);
});

test("AC3: each click-through view's test exists, by its title prefix, in the spec that covers it", () => {
  const sources = new Map<string, string>();
  const missing: string[] = [];
  for (const [view, { spec, title }] of Object.entries(CLICK_THROUGH)) {
    if (!sources.has(spec)) sources.set(spec, readFileSync(join(SPEC_DIR, spec), "utf8"));
    if (!(sources.get(spec) as string).includes(`test("${title}`)) missing.push(`${view}: ${spec} has no test("${title}…`);
  }
  expect(missing).toEqual([]);
});

test("the Integrations ids this spec targets are the ones INTEGRATIONS_TEST_IDS in model.ts defines", () => {
  const source = readFileSync(INTEGRATIONS_MODEL, "utf8");
  const defined = new Set([...source.matchAll(/^\s+\w+: "([^"]+)",?$/gm)].map((match) => match[1]));
  expect(defined.size, "model.ts's test-id table was read").toBeGreaterThan(20);
  expect(Object.values(INTEGRATIONS).filter((id) => !defined.has(id)), "ids the spec uses that model.ts does not define").toEqual([]);
});
