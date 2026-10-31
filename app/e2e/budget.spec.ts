// The Budget & audit screen (phase 7 item 07) in the built app against the fixture kernel
// (`./fixtures/budget.ts`): tokens per day, per agent and per playbook against their limits, an agent at
// its limit with the band that says so and the one dollar figure labelled "at API rates" (AC2), the cap
// windows (AC3), the audit log filtered by agent and playbook and paged Older and Newer (AC4), the kernel
// going away while the screen holds data (AC5), the keyboard walk (AC6), a live update that moves nothing
// already shown (AC7), the accessible names and the tokens-only stylesheet (AC8), and a light and a dark
// screenshot of every state the mockup shows (AC9). Run `npm run build` first.
//
// Screenshots: with `BUDGET_EVIDENCE=1` they are written to the committed evidence dir
// `docs/evidence/phase-7-polish/budget/`; otherwise to Playwright's per-test output dir, so CI never
// dirties tracked files, and the last tests assert nothing under the tracked dir changed during the run and
// that the evidence README names every file. The spec asserts behaviour, never pixels: fonts differ
// between macOS and CI.
//
// The shell does not mount the ⌘K palette yet (the same as phases 6 and 7, probed on 2026-10-30), so the
// screen is opened by its hash and the keyboard walks use Tab, Enter, Space, J, K and Escape. The screen's
// three commands are pinned in `BudgetScreen.test.tsx` (jsdom).
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { budgetFixture } from "./fixtures/budget";
import type { BudgetFixture, BudgetFixtureOptions } from "./fixtures/budget";
import { BUDGET_TEST_IDS as IDS } from "../src/screens/budget/model";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/budget/", import.meta.url));
const README = join(EVIDENCE_DIR, "README.md");
const THEMES = ["light", "dark"] as const;
/** The mockup's states (`budget-<state>`), as the file names have them. */
const STATES = ["empty", "loading", "populated", "waiting", "error", "unreachable", "audit", "audit-filtered"] as const;

/** When this run began, for the guard that the tracked evidence dir is untouched without `BUDGET_EVIDENCE`. */
const RUN_START = Date.now();

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
const pageErrors: string[] = [];

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
  // Drained per test, so an error is reported against the test that caused it.
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

const byId = (page: Page, id: string): Locator => page.getByTestId(id);

/** Launch the built app on a fixture kernel serving `fx`, and open Budget & audit by its hash. */
async function open(fx: BudgetFixture): Promise<Page> {
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  app = await launchApp(fixture.env);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/budget";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  return page;
}

/** `open` for a fixture made from `options`, once the populated overview (tables and the latest events) is up. */
async function openPopulated(options: BudgetFixtureOptions = {}): Promise<{ readonly fx: BudgetFixture; readonly page: Page }> {
  const fx = budgetFixture(options);
  const page = await open(fx);
  await expect(byId(page, IDS.dayTable)).toBeVisible();
  await expect(byId(page, IDS.latestCard)).toHaveCount(3);
  return { fx, page };
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

/** `budget-<state>-light.png` and `-dark.png` of the whole window; the dark tokens must really apply. */
async function screenshots(page: Page, state: (typeof STATES)[number], testInfo: TestInfo): Promise<void> {
  const evidence = process.env.BUDGET_EVIDENCE === "1";
  if (evidence) mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const file = `budget-${state}-${theme}.png`;
    const path = evidence ? join(EVIDENCE_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
  }
  expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);
  await setTheme(page, undefined);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

/** The text of every element with `id`, in document order. */
async function texts(page: Page, id: string): Promise<string[]> {
  return (await byId(page, id).allTextContents()).map((t) => t.trim());
}

type Box = { x: number; y: number; width: number; height: number } | null;

/** Each element's bounding box with `id`, in document order. */
async function boxes(page: Page, id: string): Promise<Box[]> {
  const all = await byId(page, id).all();
  return Promise.all(all.map((el) => el.boundingBox()));
}

const tokens = (n: number): string => n.toLocaleString("en-US");
const agentRow = (page: Page, agent: string): Locator => page.locator(`[data-testid="${IDS.agentRow}"][data-agent="${agent}"]`);

/** Open the audit log from the toolbar button and wait for its table. */
async function openLog(page: Page): Promise<void> {
  await byId(page, IDS.auditButton).click();
  await expect(byId(page, IDS.table)).toBeVisible();
}

const auditIds = (page: Page): Promise<string[]> => texts(page, IDS.auditId);

// ---- The overview: AC2, AC3 -----------------------------------------------------------------------------------------

test("populated: seven days today first with zero days, the agents and playbooks against their limits, and the cap windows (AC3)", async ({}, testInfo) => {
  const { page } = await openPopulated();
  // The shell draws the one heading; the screen's own are h2 and below.
  expect(await page.locator("h1").allTextContents()).toEqual(["Budget & audit"]);
  await expect(page.getByRole("button", { name: /^Budget & audit/ })).toHaveAttribute("aria-current", "page");

  const days = byId(page, IDS.dayRow);
  await expect(days).toHaveCount(7);
  expect(await days.evaluateAll((els) => els.map((el) => el.getAttribute("data-today")))).toEqual(["true", null, null, null, null, null, null]);
  await expect(days.first()).toContainText("Today ·");
  // Today: Mason 47,844 + Wright 12,380 + Ada 61,900. A day with no rows (five days back) is 0.
  await expect(days.first().getByRole("cell").nth(1)).toHaveText(/^\s*122,124/);
  await expect(days.nth(5).getByRole("cell").nth(1)).toHaveText(/^\s*0/);
  await expect(byId(page, IDS.summary)).toHaveText("122,124 tokens today");

  await expect(byId(page, IDS.agentName)).toHaveText(["Wright", "Mason", "Ada"]);
  await expect(byId(page, IDS.agentLimit)).toHaveText(["12,380no limit set", "47,844 of 150,000", "61,900 of 100,000"]);
  await expect(byId(page, IDS.agentSessions)).toHaveText(["1 live · no limit set", "1 live of 2", "1 live of 2"]);
  await expect(page.getByRole("img", { name: "32 percent of the daily token limit" })).toBeVisible();
  await expect(byId(page, IDS.playbookRow)).toHaveCount(3);
  await expect(byId(page, IDS.playbookRow).nth(1)).toContainText("Ada · off");
  await expect(byId(page, IDS.playbookLimit).first()).toHaveText("47,844 of 60,000");
  await expect(byId(page, IDS.band)).toHaveCount(0);

  // AC3: each window shows its type, its status badge and 'N% used · resets <time>'.
  await expect(byId(page, IDS.capWindow)).toHaveCount(2);
  expect(await texts(page, IDS.capStatus)).toEqual(["allowed", "warning"]);
  const caps = await texts(page, IDS.capText);
  expect(caps[0]).toMatch(/^41% used · resets (today 17:00|[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} 17:00)$/);
  expect(caps[1]).toMatch(/^83% used · resets [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} 09:00$/);
  await expect(byId(page, IDS.cap)).toContainText("personal subscription");
  await expect(byId(page, IDS.cap)).toContainText("No window is rejected");
  await expect(byId(page, IDS.latestCard)).toHaveCount(3);
  await screenshots(page, "populated", testInfo);
});

test("AC2: an agent at its limit shows 'N of N' with an 'at limit' badge and a full meter, the band names it, and the only dollar figure is the 'at API rates' estimate", async ({}, testInfo) => {
  const { page } = await openPopulated({ state: "waiting" });
  const ada = agentRow(page, "ada");
  await expect(ada.getByTestId(IDS.agentLimit)).toHaveText("100,000 of 100,000at limit");
  await expect(ada.locator(".badge")).toHaveText("at limit");
  await expect(ada.getByRole("img", { name: "100 percent of the daily token limit" })).toHaveAttribute("data-full", "true");
  await expect(ada).toHaveAttribute("data-waiting", "true");
  await expect(page.locator(`[data-testid="${IDS.agentRow}"][data-waiting="true"]`)).toHaveCount(1);

  const band = byId(page, IDS.band);
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("role", "status");
  await expect(band).toContainText("1 agent waits on you: Ada used 100,000 of its 100,000 tokens today, so its new sessions wait until midnight. Raise its limit in Team to continue.");

  // The dollar rule: one dollar sign on the screen, inside the estimate that says 'at API rates'.
  const dollars = await byId(page, IDS.screen).evaluate((root) => {
    const found: { text: string; labelled: boolean }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!(node.textContent ?? "").includes("$")) continue;
      let labelled = false;
      for (let el = node.parentElement; el !== null && root.contains(el); el = el.parentElement) if ((el.textContent ?? "").includes("at API rates")) labelled = true;
      found.push({ text: node.textContent ?? "", labelled });
    }
    return found;
  });
  expect(dollars).toHaveLength(1);
  expect(dollars[0]?.labelled).toBe(true);
  expect(dollars[0]?.text).toMatch(/^≈\$\d+\.\d\d at API rates\./);
  for (const label of await byId(page, IDS.screen).locator('[role="img"]').evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""))) expect(label).not.toContain("$");
  await screenshots(page, "waiting", testInfo);

  // Open Team is a real button, reached by the keyboard.
  await byId(page, IDS.openTeam).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/team");
});

test("the empty state: 'No tokens used yet.' with limits named in tokens and sessions never dollars, and one action, Ask Wright", async ({}, testInfo) => {
  const fx = budgetFixture({ state: "empty" });
  const page = await open(fx);
  const empty = byId(page, IDS.empty);
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("heading", { level: 2 })).toHaveText("No tokens used yet.");
  await expect(empty).toContainText("Limits are in tokens and sessions at once, never dollars.");
  await expect(empty.getByRole("button")).toHaveCount(1);
  await expect(byId(page, IDS.dayTable)).toHaveCount(0);
  await screenshots(page, "empty", testInfo);
  await empty.getByRole("button", { name: "Ask Wright" }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/chat");
});

test("the loading state: four skeleton rows until the usage answers, then the screen", async ({}, testInfo) => {
  const fx = budgetFixture();
  fx.holdUsage();
  const page = await open(fx);
  const loading = byId(page, IDS.loading);
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading.locator(".budget-skel")).toHaveCount(4);
  await screenshots(page, "loading", testInfo);
  fx.releaseUsage();
  await expect(byId(page, IDS.dayTable)).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test("the error state: a route-failure card that names the usage request and its status, apart from the kernel band; Try again recovers", async ({}, testInfo) => {
  const fx = budgetFixture();
  fx.failUsage(true);
  const page = await open(fx);
  const card = byId(page, IDS.error);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("role", "alert");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Couldn't load usage");
  await expect(card).toContainText("usage request failed (500)");
  await expect(byId(page, IDS.errorDetail)).toHaveText("GET /budget/usage · 500 · store_unreadable");
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
  await expect(page.getByTestId("kernel-reconnecting-band")).toHaveCount(0);
  await screenshots(page, "error", testInfo);
  fx.failUsage(false);
  await byId(page, IDS.retry).click();
  await expect(byId(page, IDS.dayTable)).toBeVisible();
  await expect(card).toHaveCount(0);
});

// ---- The audit log: AC4 ----------------------------------------------------------------------------------------------

test("AC4: the audit log pages Older and Newer by cursor without overlap, to the last page", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  await openLog(page);
  await expect(byId(page, IDS.footer)).toHaveText("Showing rows 1–8 · page 1 · newest first");
  expect(await auditIds(page)).toEqual(["400", "399", "398", "397", "396", "395", "394", "393"]);
  await expect(byId(page, IDS.filtered)).toHaveCount(0);
  await expect(byId(page, IDS.newer)).toBeDisabled();
  await screenshots(page, "audit", testInfo);

  await byId(page, IDS.older).click();
  await expect(byId(page, IDS.footer)).toHaveText("Showing rows 9–16 · page 2 · newest first");
  expect(await auditIds(page)).toEqual(["392", "391", "390", "389", "388", "387", "386", "385"]);
  await byId(page, IDS.older).click();
  await expect(byId(page, IDS.footer)).toHaveText("Showing rows 17–20 · page 3 · newest first");
  expect(await auditIds(page)).toEqual(["384", "383", "382", "381"]);
  await expect(byId(page, IDS.older)).toBeDisabled();
  // After the last Older, focus did not fall to the page.
  await expect(byId(page, IDS.newer)).toBeFocused();

  await byId(page, IDS.newer).click();
  await expect(byId(page, IDS.footer)).toHaveText("Showing rows 9–16 · page 2 · newest first");
  await byId(page, IDS.newer).click();
  await expect(byId(page, IDS.footer)).toHaveText("Showing rows 1–8 · page 1 · newest first");
  await expect(byId(page, IDS.newer)).toBeDisabled();
  // Page 1 (the overview's three, then the log's page), then Older with each cursor, then Newer re-reading the cursors it came by.
  const log = fx.auditReads.filter((q) => q.limit === "8");
  expect(log.map((q) => q.before)).toEqual([undefined, "393", "385", "393", undefined]);
  expect(log.every((q) => q.since !== undefined)).toBe(true);
});

test("AC4: choosing Agent and Playbook shows only Mason's review events with the 'filtered' badge; a full last page's Older says there are none; Clear filters restores the log", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  await openLog(page);
  await page.getByLabel("Agent").selectOption({ label: "Mason" });
  await expect(byId(page, IDS.filtered)).toHaveText("filtered");
  await page.getByLabel("Playbook").selectOption({ label: "Review PRs on studio-sandbox" });
  await expect.poll(() => fx.auditReads.at(-1)).toMatchObject({ agent: "mason", playbook: "review-prs", limit: "8" });
  await expect.poll(() => auditIds(page)).toEqual(["400", "399", "397", "393", "391", "385", "382", "381"]);
  for (const actor of await texts(page, IDS.auditActor)) expect(actor).toBe("mason");
  for (const row of await byId(page, IDS.auditRow).all()) await expect(row).toContainText("playbook review-prs");
  await expect(byId(page, IDS.footer)).toHaveText("Showing rows 1–8 · page 1 · newest first");
  await expect(byId(page, IDS.clear)).toBeEnabled();
  await screenshots(page, "audit-filtered", testInfo);

  // The page is full, so the kernel sent a cursor; the page after it is empty.
  await byId(page, IDS.older).click();
  await expect(byId(page, IDS.auditEmpty)).toHaveText("No older events.");
  expect(fx.auditReads.at(-1)).toMatchObject({ before: "381", agent: "mason", playbook: "review-prs" });
  await byId(page, IDS.newer).click();
  await expect.poll(() => auditIds(page)).toHaveLength(8);

  // Kind narrows further to nothing, and says so.
  await page.getByLabel("Kind").selectOption("admission_refused");
  await expect(byId(page, IDS.auditEmpty)).toContainText("No events match.");
  await byId(page, IDS.auditEmpty).getByRole("button", { name: "Clear filters" }).click();
  await expect(byId(page, IDS.filtered)).toHaveCount(0);
  await expect.poll(() => auditIds(page)).toHaveLength(8);
  await expect(page.getByLabel("Agent")).toHaveValue("");
});

// ---- AC5: the kernel unreachable -----------------------------------------------------------------------------------------

test("AC5: when the kernel goes away the shared band shows, the screen keeps its last data marked last known, and Audit log and Open the full log are disabled", async ({}, testInfo) => {
  const { page } = await openPopulated();
  const days = await texts(page, IDS.dayRow);
  const agents = await texts(page, IDS.agentLimit);
  expect(days).toHaveLength(7);
  await fixture?.close();
  await expect(page.locator('[data-testid="kernel-unreachable-band"], [data-testid="kernel-reconnecting-band"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(byId(page, IDS.summary)).toContainText("last known");
  await expect(byId(page, IDS.cap)).toContainText("last known");
  expect(await texts(page, IDS.dayRow), "the days are the last read").toEqual(days);
  expect(await texts(page, IDS.agentLimit), "the limits are the last read").toEqual(agents);
  await expect(byId(page, IDS.empty)).toHaveCount(0);
  await expect(byId(page, IDS.error)).toHaveCount(0);
  await expect(byId(page, IDS.auditButton)).toBeDisabled();
  await expect(byId(page, IDS.openLog)).toBeDisabled();
  await screenshots(page, "unreachable", testInfo);
});

// ---- AC6: the keyboard ------------------------------------------------------------------------------------------------------

test("AC6: the audit log is walked by Tab, Enter, Space, type-ahead, J, K and Escape, and focus returns to the control that opened it", async () => {
  const { page } = await openPopulated();

  // J and K move between a table's rows.
  const agents = byId(page, IDS.agentRow);
  await agents.first().focus();
  await page.keyboard.press("j");
  await expect(agents.nth(1)).toBeFocused();
  await page.keyboard.press("j");
  await expect(agents.nth(2)).toBeFocused();
  await page.keyboard.press("k");
  await expect(agents.nth(1)).toBeFocused();

  // Open the log from the toolbar button with Enter: focus goes to Back.
  await byId(page, IDS.auditButton).focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.table)).toBeVisible();
  await expect(byId(page, IDS.back)).toBeFocused();

  // Tab reaches every filter, a row of the table and Older, in that order (Clear filters and Newer are disabled).
  const reached: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    reached.push(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? ""));
  }
  expect(reached).toEqual([IDS.filterKind, IDS.filterAgent, IDS.filterPlaybook, IDS.filterRange, IDS.auditRow, IDS.older]);

  // Change the Agent filter by typing the agent's name on the focused select (type-ahead; macOS opens the list on the arrow keys), then clear it with Enter.
  await byId(page, IDS.filterAgent).focus();
  await page.keyboard.type("Mason");
  await expect(page.getByLabel("Agent")).toHaveValue("mason");
  await expect(byId(page, IDS.filtered)).toBeVisible();
  await byId(page, IDS.clear).focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.filtered)).toHaveCount(0);
  await expect(byId(page, IDS.filterKind)).toBeFocused();

  // Older with Enter, Newer with Enter.
  await expect.poll(() => auditIds(page)).toHaveLength(8);
  await byId(page, IDS.older).focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.footer)).toContainText("page 2");
  await byId(page, IDS.newer).focus();
  await page.keyboard.press("Space");
  await expect(byId(page, IDS.footer)).toContainText("page 1");

  // J and K between the audit rows; Escape returns to the overview with focus on the button that opened the log.
  const rows = byId(page, IDS.auditRow);
  await rows.first().focus();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(byId(page, IDS.dayTable)).toBeVisible();
  await expect(byId(page, IDS.audit)).toHaveCount(0);
  await expect(byId(page, IDS.auditButton)).toBeFocused();

  // 'Open the full log' opens it too, and Back returns focus to it.
  await byId(page, IDS.openLog).focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.table)).toBeVisible();
  await byId(page, IDS.back).focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.openLog)).toBeFocused();
});

// ---- AC7: live updates -----------------------------------------------------------------------------------------------------

test("AC7: a budget_limit_reached event updates the totals, the agent row and the latest events with no reload, no loading state, and no row already shown moving", async () => {
  // Ada has used her whole limit, so the band is already up: what is measured is the rows, not the band's own arrival.
  const { fx, page } = await openPopulated({ state: "waiting" });
  await settle(page);
  // A marker (a reload would drop it) and a watcher for the skeleton (a flash would set it).
  await page.evaluate(
    ({ loading, auditLoading }) => {
      const w = window as unknown as { __marker?: string; __loadingSeen?: boolean };
      w.__marker = "same-window";
      w.__loadingSeen = false;
      new MutationObserver(() => {
        if (document.querySelector(`[data-testid="${loading}"], [data-testid="${auditLoading}"]`) !== null) w.__loadingSeen = true;
      }).observe(document.body, { childList: true, subtree: true });
    },
    { loading: IDS.loading, auditLoading: IDS.auditLoading },
  );
  const shown = async () => ({
    days: await boxes(page, IDS.dayRow),
    agents: await boxes(page, IDS.agentRow),
    playbooks: await boxes(page, IDS.playbookRow),
    latest: await boxes(page, IDS.latestCard),
    windows: await boxes(page, IDS.capWindow),
    band: await byId(page, IDS.band).boundingBox(),
  });
  const before = await shown();
  expect(before.days, "seven day rows have a box").toHaveLength(7);
  expect(before.latest, "three latest events have a box").toHaveLength(3);
  expect(Object.values(before).flat().every((b) => b !== null)).toBe(true);
  const firstCard = await byId(page, IDS.latestCard).first().getAttribute("data-id");
  expect(firstCard).toBe("400");
  const readsBefore = fx.usageReads.length;
  const todayBefore = fx.todayTokens();

  fx.liveUpdate();
  await expect(byId(page, IDS.summary)).toHaveText(`${tokens(fx.todayTokens())} tokens today`, { timeout: 10_000 });
  expect(fx.todayTokens()).toBe(todayBefore + 4_456);
  await expect(byId(page, IDS.latestCard).first()).toHaveAttribute("data-id", "402", { timeout: 10_000 });
  await expect(agentRow(page, "mason").getByTestId(IDS.agentLimit)).toHaveText("52,300 of 150,000");
  await settle(page);

  expect(fx.usageReads.length, "the events made the screen read GET /budget/usage again").toBeGreaterThan(readsBefore);
  const after = await shown();
  expect(after.days, "the day rows did not move or resize").toEqual(before.days);
  expect(after.agents, "the agent rows did not move or resize").toEqual(before.agents);
  expect(after.playbooks, "the playbook rows did not move or resize").toEqual(before.playbooks);
  expect(after.latest, "the latest events did not move or resize (the new ones took the same cards)").toEqual(before.latest);
  expect(after.windows, "the cap windows did not move").toEqual(before.windows);
  expect(after.band, "the band did not move").toEqual(before.band);
  const seen = await page.evaluate(() => ({ marker: (window as unknown as { __marker?: string }).__marker, loading: (window as unknown as { __loadingSeen?: boolean }).__loadingSeen }));
  expect(seen.marker, "the window was not reloaded").toBe("same-window");
  expect(seen.loading, "the screen never flashed a loading state").toBe(false);
});

// ---- AC8: names, and tokens only -----------------------------------------------------------------------------------------------

test("AC8: every select, button, meter, badge, table and group has an accessible name", async () => {
  const { page } = await openPopulated({ state: "waiting" });
  const root = byId(page, IDS.screen);

  for (const name of ["Tokens counted per day", "Tokens today by agent", "Tokens today by playbook"]) await expect(root.getByRole("table", { name }), name).toBeVisible();
  await expect(root.getByRole("columnheader")).toHaveText(["Day", "Counted tokens", "Cache reads (not counted)", "Agent", "Tokens against its daily limit", "Sessions at once", "Playbook", "Tokens against its daily limit"]);
  await expect(root.getByRole("complementary", { name: "Cap and estimate" })).toBeVisible();
  for (const name of ["Audit log", "Open the full log", "Open Team"]) await expect(root.getByRole("button", { name }), name).toBeVisible();
  for (const button of await root.getByRole("button").all()) await expect(button).toHaveAccessibleName(/\S/);
  for (const badge of await root.locator(".badge").all()) await expect(badge).toHaveText(/\S/);
  // The meters and avatars are `role="img"` elements with a label of their own.
  const meters = await root.locator('[role="img"]').all();
  expect(meters.length, "every meter and avatar is an image with a name").toBeGreaterThan(10);
  for (const meter of meters) await expect(meter).toHaveAccessibleName(/\S/);
  await expect(root.getByRole("img", { name: /percent of the busiest day$/ })).toHaveCount(7);
  await expect(root.getByRole("img", { name: /percent of the (five_hour|seven_day) window used$/ })).toHaveCount(2);
  for (const time of await root.locator("time").all()) await expect(time).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);

  await openLog(page);
  await expect(root.getByRole("group", { name: "Filter the audit log" })).toBeVisible();
  for (const label of ["Kind", "Agent", "Playbook", "Time range"]) await expect(root.getByRole("combobox", { name: label }), label).toBeVisible();
  await expect(root.getByRole("table", { name: "Audit log, newest first" })).toBeVisible();
  await expect(root.getByRole("columnheader")).toHaveText(["Id", "When", "Kind", "Actor", "Detail"]);
  for (const name of ["Back", "Clear filters", "Newer", "Older"]) await expect(root.getByRole("button", { name }), name).toBeVisible();
  await expect(root.getByRole("heading", { level: 2, name: "Audit log" })).toBeVisible();
  expect(await page.locator("h1").allTextContents(), "the shell's heading is the only h1").toEqual(["Budget & audit"]);
});

test("AC8: the screen's stylesheet takes every colour from the design tokens", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/screens/budget/budget.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "no hex colour").toEqual([]);
  expect(css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/g) ?? [], "no colour function").toEqual([]);
  const named = css.match(/(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline|fill|stroke)\s*:\s*(?:white|black|red|green|blue|gray|grey|yellow|orange|purple|transparent)\b/gi) ?? [];
  // `transparent` on a border is not a colour choice; any other named colour is.
  expect(named.filter((m) => !/transparent/i.test(m)), "no named colour").toEqual([]);
});

// ---- AC9: the evidence ------------------------------------------------------------------------------------------------------------

test("AC9: without BUDGET_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", async () => {
  test.skip(process.env.BUDGET_EVIDENCE === "1", "an evidence run writes the tracked dir on purpose");
  let files: string[] = [];
  try {
    files = readdirSync(EVIDENCE_DIR);
  } catch {
    // No committed evidence dir at all: nothing could have been written to it.
  }
  const touched = files.filter((name) => statSync(join(EVIDENCE_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-7-polish/budget/ is newer than this run's start").toEqual([]);
});

test("AC9: the evidence README names a light and a dark screenshot of every state, and every one exists", () => {
  const readme = readFileSync(README, "utf8");
  const files = new Set(readdirSync(EVIDENCE_DIR));
  for (const state of STATES) {
    for (const theme of THEMES) {
      const file = `budget-${state}-${theme}.png`;
      expect(readme, `the README links ${file}`).toContain(`(${file})`);
      expect(files.has(file), `${file} is committed`).toBe(true);
    }
  }
  expect([...files].filter((f) => f.endsWith(".png")).length, "no screenshot the README does not know").toBe(STATES.length * THEMES.length);
  expect(readme).toContain("BUDGET_EVIDENCE=1");
  for (const mockup of ["budget-empty", "budget-loading", "budget-populated", "budget-waiting", "budget-error", "budget-unreachable", "budget-audit", "budget-audit-filtered"]) {
    expect(readme, `the README names the mockup view ${mockup}`).toContain(mockup);
  }
});
