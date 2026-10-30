// The Schedules & triggers screen (phase 7 item 05) in the built app against the
// fixture kernel (`./fixtures/schedules.ts`): the upcoming timeline in the order
// the route sends (AC1), every missed fire's recorded reason and the repeats
// grouped across "Load older" (AC2, AC3), the switches and the confirm for a past
// `once` trigger, by keyboard (AC4, AC6), the kernel going away while the screen
// holds data (AC5), a live update that moves nothing already shown (AC7), the
// accessible names (AC8), and a light and a dark screenshot of every state the
// mockup shows (AC9). Run `npm run build` first.
//
// Screenshots: with `SCHEDULES_EVIDENCE=1` they are written to the committed
// evidence dir `docs/evidence/phase-7-polish/schedules/`; otherwise to
// Playwright's per-test output dir, so CI never dirties tracked files, and the
// last tests assert nothing under the tracked dir changed during the run and that
// the evidence README names every file. The spec asserts behaviour, never pixels:
// fonts differ between macOS and CI.
//
// The shell does not mount the ⌘K palette or bind ⌘8 yet (the same as phase 6,
// probed on 2026-10-30: neither key does anything), so the screen is opened by its
// hash and the keyboard walks use Tab, Enter, Space, J, K and Escape. The screen's
// two commands are pinned in `SchedulesScreen.test.tsx` (jsdom).
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { PAST_ONCE_ID, POLL_ID, schedulesFixture } from "./fixtures/schedules";
import type { SchedulesFixture, SchedulesFixtureOptions } from "./fixtures/schedules";
import { SCHEDULES_TEST_IDS as IDS } from "../src/screens/schedules/model";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/schedules/", import.meta.url));
const README = join(EVIDENCE_DIR, "README.md");
const THEMES = ["light", "dark"] as const;
/** The mockup's states (`schedules-<state>`) and the two this screen adds to them, as the file names have them. */
const STATES = ["empty", "loading", "populated", "not-fired", "confirm", "error", "unreachable"] as const;

/** When this run began, for the guard that the tracked evidence dir is untouched without `SCHEDULES_EVIDENCE`. */
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

/** Launch the built app on a fixture kernel serving `fx`, and open Schedules by its hash. */
async function open(fx: SchedulesFixture): Promise<Page> {
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  app = await launchApp(fixture.env);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/schedules";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  return page;
}

/** `open` for a fixture made from `options`, once the populated screen (timeline and the open history) is up. */
async function openPopulated(options: SchedulesFixtureOptions = {}): Promise<{ readonly fx: SchedulesFixture; readonly page: Page }> {
  const fx = schedulesFixture(options);
  const page = await open(fx);
  await expect(byId(page, IDS.timeline)).toBeVisible();
  await expect(byId(page, IDS.table)).toBeVisible();
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

/** `schedules-<state>-light.png` and `-dark.png` of the whole window; the dark tokens must really apply. */
async function screenshots(page: Page, state: (typeof STATES)[number], testInfo: TestInfo): Promise<void> {
  const evidence = process.env.SCHEDULES_EVIDENCE === "1";
  if (evidence) mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const file = `schedules-${state}-${theme}.png`;
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

/** Each element's bounding box with `id`, in document order. */
async function boxes(page: Page, id: string): Promise<(({ x: number; y: number; width: number; height: number }) | null)[]> {
  const all = await byId(page, id).all();
  return Promise.all(all.map((el) => el.boundingBox()));
}

const switchNamed = (page: Page, name: string): Locator => page.getByRole("switch", { name });

// ---- AC1: the timeline ---------------------------------------------------------------------------------------

test("AC1: the upcoming timeline shows the once, cron and poll triggers and the pending wake-up in the order the route sends, and a disabled trigger is not on it", async ({}, testInfo) => {
  const { page } = await openPopulated();
  expect(await texts(page, IDS.entryName)).toEqual([
    "Review PRs on studio-sandbox",
    "Wake-up #5 · task #7",
    "Rotate the sandbox token",
    "Friday wrap-up",
    "Weekly changelog draft",
  ]);
  expect(await byId(page, IDS.entry).evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).toEqual(["trigger", "wakeup", "trigger", "trigger", "trigger"]);
  await expect.poll(() => texts(page, IDS.entrySpec)).toEqual([
    "poll · every 10 min · studio-sandbox",
    "Reason: PR #3 review may be ready",
    expect.stringMatching(/^once · (today |\d{1,2} [A-Z][a-z]{2} )\d\d:\d\d$/) as unknown as string,
    "cron · 0 18 * * 5 · UTC",
    "cron · 0 9 * * 5 · UTC",
  ]);
  for (const off of ["Morning digest", "Archive the old sandbox"]) expect(await texts(page, IDS.entryName), `${off} is off`).not.toContain(off);

  await expect(byId(page, IDS.triggersHeading)).toHaveText("Triggers · 6");
  await expect(byId(page, IDS.summary)).toHaveText("5 upcoming · 4 triggers on");
  await expect(page.getByRole("list", { name: "Upcoming" })).toBeVisible();
  // The shell draws the one heading; the screen's own are h2 and below.
  expect(await page.locator("h1").allTextContents()).toEqual(["Schedules & triggers"]);
  await expect(page.getByRole("button", { name: /^Schedules/ })).toHaveAttribute("aria-current", "page");
  await screenshots(page, "populated", testInfo);
});

test("the empty state: 'Nothing is scheduled.' with one action, Ask Wright to schedule something", async ({}, testInfo) => {
  const fx = schedulesFixture({ state: "empty" });
  const page = await open(fx);
  const empty = byId(page, IDS.empty);
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("heading", { level: 2 })).toHaveText("Nothing is scheduled.");
  await expect(empty.getByRole("button")).toHaveCount(1);
  await expect(byId(page, IDS.timeline)).toHaveCount(0);
  await screenshots(page, "empty", testInfo);
  await empty.getByRole("button", { name: "Ask Wright to schedule something" }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/chat");
});

test("the loading state: four skeleton rows until the schedule answers, then the screen", async ({}, testInfo) => {
  const fx = schedulesFixture();
  fx.holdSchedule();
  const page = await open(fx);
  const loading = byId(page, IDS.loading);
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading.locator(".schedules-skel")).toHaveCount(4);
  await screenshots(page, "loading", testInfo);
  fx.releaseSchedule();
  await expect(byId(page, IDS.timeline)).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test("the error state: a route-failure card that names the schedule request and its status, apart from the kernel band; Try again recovers", async ({}, testInfo) => {
  const fx = schedulesFixture();
  fx.failSchedule(true);
  const page = await open(fx);
  const card = byId(page, IDS.error);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("role", "alert");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Couldn't load the schedule");
  await expect(card).toContainText("schedule request failed (500)");
  await expect(byId(page, IDS.errorDetail)).toHaveText("GET /schedule · 500 · store_unreadable");
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
  await expect(page.getByTestId("kernel-reconnecting-band")).toHaveCount(0);
  await screenshots(page, "error", testInfo);
  fx.failSchedule(false);
  await byId(page, IDS.retry).click();
  await expect(byId(page, IDS.timeline)).toBeVisible();
  await expect(card).toHaveCount(0);
});

// ---- AC2, AC3: the firing history -----------------------------------------------------------------------------

test("AC2/AC3: every missed fire shows its recorded reason, repeats are one row with a count, Load older pages without overlap to the last page, and a connector_missing row links to Integrations", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  const rows = byId(page, IDS.fire);
  const kinds = async () => rows.evaluateAll((els) => els.map((el) => `${el.getAttribute("data-kind")}:${el.getAttribute("data-reason")}:${el.getAttribute("data-count")}`));

  // Page one (ids 28 to 19): two fired in a row, a rate limit, four polls missed while paused, a fire, a kill switch, a missing connector.
  expect(await kinds()).toEqual([
    "trigger_fired::2",
    "trigger_missed:rate_limited:1",
    "trigger_missed:paused:4",
    "trigger_fired::1",
    "trigger_missed:kill_switch:1",
    "trigger_missed:connector_missing:1",
  ]);
  await expect(byId(page, IDS.fireReason)).toHaveText(["rate_limited", "paused", "kill_switch", "connector_missing"]);
  await expect(byId(page, IDS.fireBadge)).toHaveText(["fired", "rate limited", "missed · paused", "fired", "missed · kill switch", "no connector"]);
  await expect(rows.nth(2)).toContainText("×4");
  await expect(rows.nth(2)).toContainText("4 times");
  await expect(byId(page, IDS.filterAll)).toHaveText("All · 10+");
  await expect(byId(page, IDS.filterMissed)).toHaveText("Not fired · 7+");

  // The filter keeps the missed groups; the screenshot is of this view.
  await byId(page, IDS.filterMissed).click();
  await expect(byId(page, IDS.filterMissed)).toHaveAttribute("aria-pressed", "true");
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).toEqual(Array(4).fill("trigger_missed"));
  await screenshots(page, "not-fired", testInfo);
  await byId(page, IDS.filterAll).click();

  // Load older twice: the connector repeat runs across the first two pages, and nothing repeats or is skipped.
  await byId(page, IDS.loadOlder).click();
  await expect(byId(page, IDS.filterAll)).toHaveText("All · 20+");
  await expect(rows.nth(5)).toHaveAttribute("data-count", "2");
  await expect(rows.nth(5)).toHaveAttribute("data-reason", "connector_missing");
  // A reason the screen has no label for is shown verbatim with a neutral 'missed'.
  const unknown = page.locator('tr[data-reason="queue_overflow"]');
  await expect(unknown).toHaveCount(1);
  await expect(unknown.getByTestId(IDS.fireReason)).toHaveText("queue_overflow");
  await expect(unknown.locator(".badge")).toHaveText("missed");
  await expect(unknown.locator(".badge")).toHaveAttribute("data-tone", "neutral");
  await byId(page, IDS.loadOlder).click();
  await expect(byId(page, IDS.loadOlder)).toHaveCount(0);
  await expect(byId(page, IDS.filterAll)).toHaveText("All · 28");
  await expect(byId(page, IDS.filterMissed)).toHaveText("Not fired · 19");
  expect(fx.fireReads.map((r) => [r.id, r.before])).toEqual([
    [String(POLL_ID), undefined],
    [String(POLL_ID), "19"],
    [String(POLL_ID), "9"],
  ]);
  // 28 fires in 10 + 10 + 8: the counts of the rows add up to every fire once.
  const counts = await rows.evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-count"))));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(28);

  // Only the missing connector links to Integrations.
  const links = byId(page, IDS.fireLink);
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "#/integrations");
  await expect(links.locator("xpath=ancestor::tr")).toHaveAttribute("data-reason", "connector_missing");
});

test("a trigger without fires says so, and the history follows the trigger chosen in the list", async () => {
  const { page } = await openPopulated();
  await page.getByTestId(IDS.select).filter({ hasText: "Friday wrap-up" }).click();
  await expect(byId(page, IDS.detailName)).toHaveText("Friday wrap-up");
  await expect(byId(page, IDS.historyEmpty)).toHaveText("Nothing has fired or been missed yet.");
  await expect(byId(page, IDS.table)).toHaveCount(0);
  await expect(page.getByTestId(IDS.select).filter({ hasText: "Friday wrap-up" })).toHaveAttribute("aria-current", "true");
});

// ---- AC4, AC6: the switches and the confirm, by keyboard -----------------------------------------------------------

test("AC4/AC6: a switch calls the on/off route; a past once trigger asks first, Escape sends nothing and returns focus, and confirming resends {confirm: true}", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  const archive = switchNamed(page, "Archive the old sandbox trigger is off");
  await expect(archive).toHaveAttribute("aria-checked", "false");

  // A plain toggle: Space on the focused switch, and no body.
  const digest = switchNamed(page, "Morning digest trigger is off");
  await digest.focus();
  await page.keyboard.press("Space");
  await expect(switchNamed(page, "Morning digest trigger is on")).toHaveAttribute("aria-checked", "true");
  expect(fx.toggles.map((t) => [t.path, t.id, t.body])).toEqual([["/triggers/5/on", "5", undefined]]);
  await page.keyboard.press("Space");
  await expect(switchNamed(page, "Morning digest trigger is off")).toHaveAttribute("aria-checked", "false");
  expect(fx.toggles.map((t) => t.path)).toEqual(["/triggers/5/on", "/triggers/5/off"]);

  // A past once trigger: the kernel answers 409 and the screen asks.
  await archive.focus();
  await page.keyboard.press("Space");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Archive the old sandbox");
  await expect(dialog).toContainText("would fire it at once");
  await expect(archive).toHaveAttribute("aria-checked", "false");
  expect(fx.toggles.at(-1)).toMatchObject({ path: `/triggers/${PAST_ONCE_ID}/on`, body: undefined });
  await screenshots(page, "confirm", testInfo);

  // Escape: nothing more is sent, the switch is unchanged and has focus again.
  const sent = fx.toggles.length;
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(archive).toBeFocused();
  expect(fx.toggles).toHaveLength(sent);

  // Again, and confirm with the keyboard: Tab from Cancel to the primary button, Enter.
  await page.keyboard.press("Space");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Turn on and fire now" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(switchNamed(page, "Archive the old sandbox trigger is on")).toHaveAttribute("aria-checked", "true");
  expect(fx.toggles.at(-1)).toMatchObject({ path: `/triggers/${PAST_ONCE_ID}/on`, body: { confirm: true } });
  expect(fx.toggles).toHaveLength(sent + 2);
  await expect(switchNamed(page, "Archive the old sandbox trigger is on")).toBeFocused();
});

test("AC6: J and K move between the triggers and between the history's rows, and the link to Integrations is followed with Enter", async () => {
  const { page } = await openPopulated();
  const selects = byId(page, IDS.select);
  await selects.first().focus();
  await page.keyboard.press("j");
  await expect(selects.nth(1)).toBeFocused();
  await page.keyboard.press("j");
  await expect(selects.nth(2)).toBeFocused();
  await page.keyboard.press("k");
  await expect(selects.nth(1)).toBeFocused();
  // Enter on the focused trigger opens it.
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.detailName)).toHaveText("Weekly changelog draft");
  await selects.first().click();
  await expect(byId(page, IDS.detailName)).toHaveText("Review PRs on studio-sandbox");
  await expect(byId(page, IDS.table)).toBeVisible();

  const rows = byId(page, IDS.fire);
  await expect(rows.first()).toHaveAttribute("tabindex", "0");
  await rows.first().focus();
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.first()).toBeFocused();

  // The missing connector's link: the last row of page one, then Enter goes to Integrations.
  const link = byId(page, IDS.fireLink);
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/integrations");
  await expect(page.getByTestId("screen-integrations")).toBeVisible();
});

// ---- AC5: the kernel unreachable -----------------------------------------------------------------------------------

test("AC5: when the kernel goes away the shared band shows, the screen keeps its last data marked last known, every kernel control is disabled and nothing throws", async ({}, testInfo) => {
  const { page } = await openPopulated();
  const timeline = await texts(page, IDS.entryName);
  const history = await texts(page, IDS.fireReason);
  expect(timeline).toHaveLength(5);
  await fixture?.close();
  await expect(page.locator('[data-testid="kernel-unreachable-band"], [data-testid="kernel-reconnecting-band"]').first()).toBeVisible({ timeout: 20_000 });
  await expect(byId(page, IDS.summary)).toContainText("last known");
  expect(await texts(page, IDS.entryName), "the timeline is the last read").toEqual(timeline);
  expect(await texts(page, IDS.fireReason), "the history is the last read").toEqual(history);
  await expect(byId(page, IDS.empty)).toHaveCount(0);
  await expect(byId(page, IDS.error)).toHaveCount(0);
  for (const sw of await page.getByRole("switch").all()) await expect(sw).toBeDisabled();
  await expect(byId(page, IDS.loadOlder)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  // What only changes the view of data held stays usable.
  await expect(byId(page, IDS.filterMissed)).toBeEnabled();
  await byId(page, IDS.filterMissed).click();
  await expect(byId(page, IDS.filterMissed)).toHaveAttribute("aria-pressed", "true");
  await byId(page, IDS.filterAll).click();
  await screenshots(page, "unreachable", testInfo);
});

// ---- AC7: live updates ---------------------------------------------------------------------------------------------

test("AC7: a trigger_fired and a wakeup_scheduled event update the timeline and the open history with no reload, no loading state, and no row already shown moving", async () => {
  const { fx, page } = await openPopulated();
  await settle(page);
  // A marker (a reload would drop it) and a watcher for either skeleton (a flash would set it).
  await page.evaluate(
    ({ loading, historyLoading }) => {
      const w = window as unknown as { __marker?: string; __loadingSeen?: boolean };
      w.__marker = "same-window";
      w.__loadingSeen = false;
      new MutationObserver(() => {
        if (document.querySelector(`[data-testid="${loading}"], [data-testid="${historyLoading}"]`) !== null) w.__loadingSeen = true;
      }).observe(document.body, { childList: true, subtree: true });
    },
    { loading: IDS.loading, historyLoading: IDS.historyLoading },
  );
  const shown = async () => ({
    entries: await boxes(page, IDS.entry),
    triggers: await boxes(page, IDS.trigger),
    fires: await boxes(page, IDS.fire),
    detail: await byId(page, IDS.detail).boundingBox(),
  });
  const before = await shown();
  expect(before.entries, "five timeline entries have a box").toHaveLength(5);
  expect(before.fires, "six history rows have a box").toHaveLength(6);
  expect([...before.entries, ...before.triggers, ...before.fires].every((b) => b !== null)).toBe(true);
  const reads = () => fixture?.requests.filter((r) => r.method === "GET" && r.path === "/schedule").length ?? 0;
  const readsBefore = reads();

  fx.fireOnPoll();
  fx.scheduleWakeup();
  await expect(byId(page, IDS.entry)).toHaveCount(6);
  await expect(byId(page, IDS.fire).first()).toHaveAttribute("data-count", "3");
  await expect(byId(page, IDS.summary)).toHaveText("6 upcoming · 4 triggers on");
  expect(await texts(page, IDS.entryName)).toContain("Wake-up #9 · task #12");
  await settle(page);

  expect(reads(), "the events made the screen read GET /schedule again").toBeGreaterThan(readsBefore);
  const after = await shown();
  expect(after.entries.slice(0, 5), "the timeline entries already shown did not move or resize").toEqual(before.entries);
  expect(after.triggers, "the trigger rows did not move or resize").toEqual(before.triggers);
  expect(after.fires, "the history rows did not move or resize (the new fire joined the top group)").toEqual(before.fires);
  expect(after.detail, "the detail did not move").toEqual(before.detail);
  const seen = await page.evaluate(() => ({ marker: (window as unknown as { __marker?: string }).__marker, loading: (window as unknown as { __loadingSeen?: boolean }).__loadingSeen }));
  expect(seen.marker, "the window was not reloaded").toBe("same-window");
  expect(seen.loading, "the screen never flashed a loading state").toBe(false);

  // A toggle done elsewhere: the switch follows, and the trigger joins the timeline.
  fx.toggleElsewhere(5);
  await expect(switchNamed(page, "Morning digest trigger is on")).toHaveAttribute("aria-checked", "true");
  await expect(byId(page, IDS.entry)).toHaveCount(7);
});

// ---- AC8: names, and tokens only ---------------------------------------------------------------------------------------

test("AC8: every switch, chip, button, badge, list and table has an accessible name", async () => {
  const { page } = await openPopulated();
  const screenRoot = byId(page, IDS.screen);

  const switches = screenRoot.getByRole("switch");
  await expect(switches).toHaveCount(6);
  for (const name of [
    "Review PRs on studio-sandbox trigger is on",
    "Weekly changelog draft trigger is on",
    "Friday wrap-up trigger is on",
    "Rotate the sandbox token trigger is on",
    "Morning digest trigger is off",
    "Archive the old sandbox trigger is off",
  ]) {
    await expect(screenRoot.getByRole("switch", { name }), name).toHaveCount(1);
  }
  await expect(screenRoot.getByRole("group", { name: "Filter history" })).toBeVisible();
  await expect(screenRoot.getByRole("button", { name: /^All · \d+\+?$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(screenRoot.getByRole("button", { name: /^Not fired · \d+\+?$/ })).toHaveAttribute("aria-pressed", "false");
  await expect(screenRoot.getByRole("button", { name: "Load older" })).toBeVisible();
  await expect(screenRoot.getByRole("button", { name: "Refresh" })).toBeVisible();
  await expect(screenRoot.getByRole("list", { name: "Upcoming" })).toBeVisible();
  await expect(screenRoot.getByRole("list", { name: "Triggers" })).toBeVisible();
  await expect(screenRoot.getByRole("table", { name: "Firing history" })).toBeVisible();
  await expect(screenRoot.getByRole("columnheader")).toHaveText(["When", "Trigger", "Result"]);
  await expect(screenRoot.getByRole("region", { name: "Firing history" })).toBeVisible();

  for (const button of await screenRoot.getByRole("button").all()) await expect(button).toHaveAccessibleName(/\S/);
  for (const badge of await screenRoot.locator(".badge").all()) await expect(badge).toHaveText(/\S/);
  expect(await screenRoot.locator(".badge").count(), "the history and the detail have badges").toBeGreaterThan(6);
  // Every time on the screen is a <time> with its instant.
  for (const time of await screenRoot.locator("time").all()) await expect(time).toHaveAttribute("datetime", /^\d{4}-\d\d-\d\dT/);
});

test("AC8: the screen's stylesheet takes every colour from the design tokens", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/screens/schedules/schedules.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "no hex colour").toEqual([]);
  expect(css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/g) ?? [], "no colour function").toEqual([]);
  const named = css.match(/(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline|fill|stroke)\s*:\s*(?:white|black|red|green|blue|gray|grey|yellow|orange|purple|transparent)\b/gi) ?? [];
  // `transparent` on a border is not a colour choice; any other named colour is.
  expect(named.filter((m) => !/transparent/i.test(m)), "no named colour").toEqual([]);
});

// ---- AC9: the evidence -----------------------------------------------------------------------------------------------

test("AC9: without SCHEDULES_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", async () => {
  test.skip(process.env.SCHEDULES_EVIDENCE === "1", "an evidence run writes the tracked dir on purpose");
  let files: string[] = [];
  try {
    files = readdirSync(EVIDENCE_DIR);
  } catch {
    // No committed evidence dir at all: nothing could have been written to it.
  }
  const touched = files.filter((name) => statSync(join(EVIDENCE_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-7-polish/schedules/ is newer than this run's start").toEqual([]);
});

test("AC9: the evidence README names a light and a dark screenshot of every state, and every one exists", () => {
  const readme = readFileSync(README, "utf8");
  const files = new Set(readdirSync(EVIDENCE_DIR));
  for (const state of STATES) {
    for (const theme of THEMES) {
      const file = `schedules-${state}-${theme}.png`;
      expect(readme, `the README links ${file}`).toContain(`(${file})`);
      expect(files.has(file), `${file} is committed`).toBe(true);
    }
  }
  expect([...files].filter((f) => f.endsWith(".png")).length, "no screenshot the README does not know").toBe(STATES.length * THEMES.length);
  expect(readme).toContain("SCHEDULES_EVIDENCE=1");
  for (const mockup of ["schedules-empty", "schedules-loading", "schedules-populated", "schedules-error", "schedules-unreachable"]) expect(readme, `the README names the mockup view ${mockup}`).toContain(mockup);
});
