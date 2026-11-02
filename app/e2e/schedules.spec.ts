// The Schedules & triggers screen (phase 7 items 05 and 16) in the built app against
// the fixture kernel (`./fixtures/schedules.ts`): the upcoming timeline in the order
// the route sends (AC1), the firing history of every trigger merged newest first and
// paged to the end without a gap or a repeat, one trigger's own history with every
// missed fire's recorded reason and the repeats grouped across "Load older" (AC2,
// AC3), the switches and the confirm for a past `once` trigger, by keyboard (AC4,
// AC6), the kernel stopping and restarting under the screen (AC5, and item 16's AC1),
// a live update that moves nothing already shown (AC7), the accessible names (AC8),
// and a light and a dark screenshot of every state the mockup shows (AC9). The count
// line is the title bar's (item 16's AC2); the playbook-off note is on trigger 2
// (AC5). Run `npm run build` first.
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
import { PAST_ONCE_ID, PLAYBOOK_OFF_ID, POLL_ID, ROTATE_ID, WRAPUP_ID, schedulesFixture } from "./fixtures/schedules";
import type { SchedulesFixture, SchedulesFixtureOptions } from "./fixtures/schedules";
import { SCHEDULES_TEST_IDS as IDS } from "../src/screens/schedules/model";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/schedules/", import.meta.url));
const README = join(EVIDENCE_DIR, "README.md");
const THEMES = ["light", "dark"] as const;
/** The mockup's states (`schedules-<state>`) and the ones this screen adds to them (the confirm, and the skipped fires' chip at the default and the minimum window size), as the file names have them. */
const STATES = ["empty", "loading", "populated", "populated-skipped", "populated-skipped-min", "not-fired", "confirm", "error", "unreachable"] as const;

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

/** `open` for a fixture made from `options`, once the populated screen (timeline and the all-triggers history) is up. */
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

/** Resize the already-launched window (the same path as `settings.spec.ts`) and wait until the page has that inner size. */
async function resizeWindow(page: Page, width: number, height: number): Promise<void> {
  await app?.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height), { width, height });
  await expect.poll(() => page.evaluate(() => [window.innerWidth, window.innerHeight]), { message: `the window is ${width}x${height}` }).toEqual([width, height]);
  await settle(page);
}

/** Page the all-triggers history twice, so the poll's four `playbook_not_enabled` misses (page two of the fixture) are rows. */
async function pageToSkipped(page: Page): Promise<Locator> {
  for (const shown of ["All · 23+", "All · 36+"]) {
    await byId(page, IDS.loadOlder).click();
    await expect(byId(page, IDS.filterAll)).toHaveText(shown);
  }
  const skipped = byId(page, IDS.allFire).and(page.locator('[data-reason="playbook_not_enabled"]'));
  await expect(skipped.first().getByTestId(IDS.fireBadge)).toHaveText("playbook off: fires are skipped");
  return skipped;
}

interface ChipReport {
  /** The `.badge` elements measured (one per `IDS.fireBadge`). */
  readonly measured: number;
  /** Of those, the ones on a `playbook_not_enabled` row. */
  readonly skipped: number;
  readonly problems: string[];
}

/**
 * The chip checks on the `.badge` inside every `IDS.fireBadge` on screen (both tables): the badge shows its whole text
 * (no scroll overflow, no ellipsis, the text's `Range` and the badge's box inside the `td`'s box), its `td` ends inside the
 * window, its row is no taller than the table's shortest (rows keep their fixed height), and the recorded-reason line under it (when there is one) is inside the same cell and does not overlap the badge.
 */
async function chipReport(page: Page): Promise<ChipReport> {
  return page.evaluate(
    ({ badgeId, reasonId }) => {
      const problems: string[] = [];
      let measured = 0;
      let skipped = 0;
      const within = (inner: DOMRect, outer: DOMRect) => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
      for (const wrapper of document.querySelectorAll(`[data-testid="${badgeId}"]`)) {
        const badge = wrapper.querySelector<HTMLElement>(".badge");
        const cell = wrapper.closest("td");
        const row = wrapper.closest("tr");
        if (badge === null || cell === null || row === null) {
          problems.push("a fire badge has no .badge, td or tr");
          continue;
        }
        measured += 1;
        const reason = row.getAttribute("data-reason") ?? "";
        if (reason === "playbook_not_enabled") skipped += 1;
        const name = `${row.getAttribute("data-kind")}/${reason || "-"} "${badge.textContent?.trim() ?? ""}"`;
        const box = badge.getBoundingClientRect();
        const cellBox = cell.getBoundingClientRect();
        if (badge.scrollWidth > badge.clientWidth || badge.scrollHeight > badge.clientHeight) problems.push(`${name}: the badge scrolls (${badge.scrollWidth}x${badge.scrollHeight} in ${badge.clientWidth}x${badge.clientHeight})`);
        if (getComputedStyle(badge).textOverflow === "ellipsis") problems.push(`${name}: the badge ends its text in an ellipsis`);
        const range = document.createRange();
        range.selectNodeContents(badge);
        if (!within(range.getBoundingClientRect(), cellBox)) problems.push(`${name}: the text is outside its cell`);
        if (!within(box, cellBox)) problems.push(`${name}: the badge is outside its cell`);
        if (cellBox.right > window.innerWidth + 0.5) problems.push(`${name}: the cell ends at ${cellBox.right}, past the window's ${window.innerWidth}`);
        // Rows are a fixed height (a row is only as tall as that height unless its content outgrows it), so a row taller than the shortest in its table is a chip that did not fit its row.
        const rowHeights = [...(row.closest("tbody")?.querySelectorAll("tr") ?? [])].map((r) => r.getBoundingClientRect().height);
        if (row.getBoundingClientRect().height > Math.min(...rowHeights) + 0.5) problems.push(`${name}: the row is ${row.getBoundingClientRect().height}px tall, taller than the table's shortest row (${Math.min(...rowHeights)}px)`);
        const line = row.querySelector<HTMLElement>(`[data-testid="${reasonId}"]`);
        if (line !== null) {
          const lineBox = line.getBoundingClientRect();
          if (!within(lineBox, cellBox)) problems.push(`${name}: the reason line is outside its cell`);
          if (lineBox.top < box.bottom - 0.5 && lineBox.bottom > box.top + 0.5 && lineBox.left < box.right && lineBox.right > box.left) problems.push(`${name}: the reason line overlaps the badge`);
        }
      }
      return { measured, skipped, problems };
    },
    { badgeId: IDS.fireBadge, reasonId: IDS.fireReason },
  );
}

/** What each header cell shares with its column: for each of When, Trigger and Result, every cell's left and right x differ from the header's by no more than half a pixel. */
async function columnMisalignments(page: Page): Promise<string[]> {
  return page.evaluate((tableId) => {
    const table = document.querySelector(`[data-testid="${tableId}"]`);
    const problems: string[] = [];
    const heads = [...(table?.querySelectorAll("thead th") ?? [])];
    if (heads.length !== 3) return [`the table has ${heads.length} header cells, not 3`];
    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])];
    if (rows.length === 0) return ["the table has no rows"];
    heads.forEach((th, column) => {
      const head = th.getBoundingClientRect();
      for (const row of rows) {
        const cell = row.children[column]?.getBoundingClientRect();
        if (cell === undefined) problems.push(`a row has no cell ${column}`);
        else if (Math.abs(cell.left - head.left) > 0.5 || Math.abs(cell.right - head.right) > 0.5) problems.push(`${th.textContent}: header ${head.left}-${head.right}, cell ${cell.left}-${cell.right}`);
      }
    });
    return problems;
  }, IDS.table);
}

/** The `Page`'s two themes, one after the other (reset to the app's own afterwards), each `settle`d. */
async function inEachTheme(page: Page, check: (theme: (typeof THEMES)[number]) => Promise<void>): Promise<void> {
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    await check(theme);
  }
  await setTheme(page, undefined);
}

/** The pane and table fit checks of the minimum window: no horizontal scroll, the table inside its parent, and a Trigger column that still reads. */
async function paneFit(page: Page): Promise<{ readonly paneScroll: number; readonly paneClient: number; readonly tableWidth: number; readonly parentClient: number; readonly triggerHead: number; readonly names: number[] }> {
  return page.evaluate((tableId) => {
    const table = document.querySelector<HTMLElement>(`[data-testid="${tableId}"]`);
    const pane = table?.closest<HTMLElement>(".schedules-pane");
    if (table === null || table === undefined || pane === null || pane === undefined || table.parentElement === null) throw new Error("no table in a .schedules-pane");
    return {
      paneScroll: pane.scrollWidth,
      paneClient: pane.clientWidth,
      tableWidth: table.offsetWidth,
      parentClient: table.parentElement.clientWidth,
      triggerHead: table.querySelectorAll("thead th")[1]?.getBoundingClientRect().width ?? 0,
      names: [...table.querySelectorAll("tbody tr td:nth-child(2) b")].map((b) => b.getBoundingClientRect().width),
    };
  }, IDS.table);
}

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
  // The list is headed "Upcoming · Today"; the weekly trigger is a week away, so it is always under "Later" in the same region.
  await expect(byId(page, IDS.todayHeading)).toHaveText("Upcoming · Today");
  await expect(byId(page, IDS.timeline)).toHaveCount(1);
  await expect(byId(page, IDS.laterHeading)).toHaveText("Later");
  await expect(page.getByRole("list", { name: "Later" }).getByTestId(IDS.entryName)).toHaveText(["Weekly changelog draft"]);
  // The shell draws the one heading; the screen's own are h2 and below.
  expect(await page.locator("h1").allTextContents()).toEqual(["Schedules & triggers"]);
  await expect(page.getByRole("button", { name: /^Schedules/ })).toHaveAttribute("aria-current", "page");
  await screenshots(page, "populated", testInfo);
});

test("AC2 (item 16): the count line sits in the title bar beside the title, and the screen draws none of its own", async () => {
  const { page } = await openPopulated();
  const subtitle = byId(page, "titlebar-subtitle");
  await expect(subtitle).toHaveText("5 upcoming · 4 triggers on");
  await expect(subtitle.getByTestId(IDS.summary)).toHaveCount(1);
  await expect(byId(page, IDS.screen).getByTestId(IDS.summary)).toHaveCount(0);
  // Beside the title: the same bar, right after the one h1.
  expect(await page.locator("h1").evaluate((h1) => h1.nextElementSibling?.getAttribute("data-testid"))).toBe("titlebar-subtitle");
});

test("AC5 (item 16): the playbook-off note is on the row and the upcoming entry of the trigger that is on whose playbook is off, and on no other", async ({}, testInfo) => {
  const { page } = await openPopulated();
  const note = "playbook off: fires are skipped";
  const rowOf = (id: number) => byId(page, IDS.trigger).and(page.locator(`[data-id="${id}"]`));
  const entryOf = (id: number) => byId(page, IDS.entry).and(page.locator(`[data-id="${id}"]`));
  await expect(rowOf(PLAYBOOK_OFF_ID).getByTestId(IDS.playbookOff)).toHaveText(note);
  await expect(entryOf(PLAYBOOK_OFF_ID).getByTestId(IDS.playbookOff)).toHaveText(note);
  // The enabled playbook (the poll) and the triggers with no playbook show none; nor does a trigger that is off.
  await expect(byId(page, IDS.playbookOff)).toHaveCount(2);
  await expect(rowOf(POLL_ID).getByTestId(IDS.playbookOff)).toHaveCount(0);
  await expect(rowOf(WRAPUP_ID).getByTestId(IDS.playbookOff)).toHaveCount(0);
  await expect(entryOf(POLL_ID).getByTestId(IDS.playbookOff)).toHaveCount(0);
  // The skipped fires the poll's history recorded read the same way, with the recorded code beneath.
  const skipped = byId(page, IDS.allFire).and(page.locator('[data-reason="playbook_not_enabled"]'));
  for (const shown of ["All · 23+", "All · 36+"]) {
    await byId(page, IDS.loadOlder).click();
    await expect(byId(page, IDS.filterAll)).toHaveText(shown);
  }
  await expect(skipped.first().getByTestId(IDS.fireBadge)).toHaveText(note);
  await expect(skipped.first().getByTestId(IDS.fireReason)).toHaveText("playbook_not_enabled");
  await page.screenshot({ path: testInfo.outputPath("playbook-off.png") });
});

test("AC4 (item 16): an upcoming title and a trigger-row title wrap to at most two lines, clamped with an ellipsis, and carry their full text as a tooltip", async () => {
  const { page } = await openPopulated();
  for (const id of [IDS.entryName, IDS.select]) {
    const titles = await byId(page, id).all();
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      await expect(title).toHaveAttribute("title", /\S/);
      expect((await title.getAttribute("title")) ?? "", "the tooltip is the title's own text").toBe((await title.textContent())?.trim());
      const clamp = await title.evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-line-clamp"));
      expect(clamp, "two lines, then an ellipsis").toBe("2");
    }
  }
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

/** A row's `<trigger>:<kind>:<reason>:<count>`, in document order, for the rows `id` marks. */
async function rowKinds(page: Page, id: string): Promise<string[]> {
  return byId(page, id).evaluateAll((els) => els.map((el) => `${el.getAttribute("data-trigger") ?? ""}:${el.getAttribute("data-kind")}:${el.getAttribute("data-reason")}:${el.getAttribute("data-count")}`));
}

test("AC3 (item 16): the firing history of every trigger is merged newest first, filters, folds a repeat only within one trigger, and every interleaved fire appears exactly once after paging to the end", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  const rows = byId(page, IDS.allFire);
  const T = String(WRAPUP_ID);
  const P = String(POLL_ID);
  const U = String(ROTATE_ID);

  // The fixture has 46 fires (the poll's 28, "Friday wrap-up"'s 12 and "Rotate the sandbox token"'s 6, ids interleaved); the first pages
  // hold ten of each trigger that has that many. The merge shows down to the horizon, the newest of the unfinished triggers' oldest
  // loaded fires: "Friday wrap-up"'s tenth (id 28), so 19 fires, and "Rotate the sandbox token"'s older fires wait below it.
  await expect(byId(page, IDS.filterAll)).toHaveText("All · 19+");
  await expect(byId(page, IDS.filterMissed)).toHaveText("Not fired · 7+");
  expect(await rowKinds(page, IDS.allFire)).toEqual([
    `${P}:trigger_fired::1`,
    `${T}:trigger_fired::2`,
    `${P}:trigger_fired::1`,
    `${T}:trigger_missed:paused:1`,
    `${T}:trigger_fired::1`,
    `${U}:trigger_missed:already_done:1`,
    `${P}:trigger_missed:rate_limited:1`,
    `${T}:trigger_fired::2`,
    // The poll's four polls missed while paused are three rows: the other triggers' fires sit between them, and a repeat never folds across two triggers.
    `${P}:trigger_missed:paused:1`,
    `${T}:trigger_fired::2`,
    `${P}:trigger_missed:paused:1`,
    `${T}:trigger_fired::1`,
    `${U}:trigger_fired::1`,
    `${P}:trigger_missed:paused:2`,
    `${T}:trigger_fired::1`,
  ]);
  // Each row names its trigger; a trigger is named by its playbook, else its text.
  const names = await texts(page, IDS.fireTrigger);
  expect(names.slice(0, 6)).toEqual(["Review PRs on studio-sandbox", "Friday wrap-up", "Review PRs on studio-sandbox", "Friday wrap-up", "Friday wrap-up", "Rotate the sandbox token"]);
  await expect(byId(page, IDS.table)).toHaveCount(1);
  await expect(byId(page, IDS.detail)).toHaveCount(0);

  // The filter keeps the missed rows; the screenshot is of this view.
  await byId(page, IDS.filterMissed).click();
  await expect(byId(page, IDS.filterMissed)).toHaveAttribute("aria-pressed", "true");
  // Seven missed fires, in six rows (the last two paused polls are one).
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).toEqual(Array(6).fill("trigger_missed"));
  await screenshots(page, "not-fired", testInfo);
  await byId(page, IDS.filterAll).click();

  // "Load older" three times: each click reads the next page of the trigger holding the horizon, so the list grows from 19 to 23, 36 and 46, and nothing is skipped or repeated.
  const step = async (all: string, missed: string) => {
    await byId(page, IDS.loadOlder).click();
    await expect(byId(page, IDS.filterAll)).toHaveText(all);
    await expect(byId(page, IDS.filterMissed)).toHaveText(missed);
  };
  await step("All · 23+", "Not fired · 9+");
  await step("All · 36+", "Not fired · 19+");
  // The poll's connector repeat folds across its first two pages, in one row.
  await expect(page.locator(`[data-testid="${IDS.allFire}"][data-reason="connector_missing"]`)).toHaveAttribute("data-count", "2");
  await step("All · 46", "Not fired · 23");
  await expect(byId(page, IDS.loadOlder)).toHaveCount(0);

  // 46 fires, each once: the counts of the rows add up per trigger to the fixture's 28, 12 and 6.
  const perTrigger = await rows.evaluateAll((els) => {
    const total: Record<string, number> = {};
    for (const el of els) total[el.getAttribute("data-trigger") ?? ""] = (total[el.getAttribute("data-trigger") ?? ""] ?? 0) + Number(el.getAttribute("data-count"));
    return total;
  });
  expect(perTrigger).toEqual({ [P]: 28, [T]: 12, [U]: 6 });
  // One first page for each of the six triggers (the fan-out, in no fixed order), then the pages the horizon asked for: "Friday wrap-up" first, then the poll twice.
  const reads = fx.fireReads.map((r) => [r.id, r.before] as const);
  expect(reads.slice(0, 6).map(([id]) => id).sort()).toEqual(["1", "2", "3", "4", "5", "6"]);
  expect(reads.slice(0, 6).every(([, before]) => before === undefined)).toBe(true);
  expect(reads.slice(6)).toEqual([
    [T, "28"],
    [P, "24"],
    [P, "11"],
  ]);
  // Only the missing connector links to Integrations.
  const links = byId(page, IDS.fireLink);
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "#/integrations");
});

test("AC2/AC3: one trigger's own history shows every missed fire's recorded reason, repeats are one row with a count, Load older pages without overlap to the last page, and a connector_missing row links to Integrations", async () => {
  const { fx, page } = await openPopulated();
  await page.getByTestId(IDS.select).filter({ hasText: "Review PRs on studio-sandbox" }).click();
  await expect(byId(page, IDS.detailName)).toHaveText("Review PRs on studio-sandbox");
  const rows = byId(page, IDS.fire);
  const kinds = async () => rows.evaluateAll((els) => els.map((el) => `${el.getAttribute("data-kind")}:${el.getAttribute("data-reason")}:${el.getAttribute("data-count")}`));
  await expect(rows.first()).toBeVisible();
  await expect(byId(page, IDS.allFire)).toHaveCount(0);

  // Page one (the poll's ten newest): two fired in a row, a rate limit, four polls missed while paused, a fire, a kill switch, a missing connector.
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

  await byId(page, IDS.filterMissed).click();
  await expect(byId(page, IDS.filterMissed)).toHaveAttribute("aria-pressed", "true");
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-kind")))).toEqual(Array(4).fill("trigger_missed"));
  await byId(page, IDS.filterAll).click();

  // Load older twice: the connector repeat runs across the first two pages, and nothing repeats or is skipped.
  await byId(page, IDS.loadOlder).click();
  await expect(byId(page, IDS.filterAll)).toHaveText("All · 20+");
  await expect(rows.nth(5)).toHaveAttribute("data-count", "2");
  await expect(rows.nth(5)).toHaveAttribute("data-reason", "connector_missing");
  // A reason the screen has no label for is shown verbatim with a neutral 'missed'; a playbook that was off reads as such.
  const unknown = page.locator('tr[data-reason="queue_overflow"]');
  await expect(unknown).toHaveCount(1);
  await expect(unknown.getByTestId(IDS.fireReason)).toHaveText("queue_overflow");
  await expect(unknown.locator(".badge")).toHaveText("missed");
  await expect(unknown.locator(".badge")).toHaveAttribute("data-tone", "neutral");
  const off = page.locator('tr[data-reason="playbook_not_enabled"]');
  await expect(off.getByTestId(IDS.fireBadge)).toHaveText("playbook off: fires are skipped");
  await expect(off.getByTestId(IDS.fireReason)).toHaveText("playbook_not_enabled");
  await byId(page, IDS.loadOlder).click();
  await expect(byId(page, IDS.loadOlder)).toHaveCount(0);
  await expect(byId(page, IDS.filterAll)).toHaveText("All · 28");
  await expect(byId(page, IDS.filterMissed)).toHaveText("Not fired · 19");
  // The poll's own pages carry the cursors of its own ids: the tenth and the twentieth of its fires.
  expect(fx.fireReads.filter((r) => r.before !== undefined).map((r) => [r.id, r.before])).toEqual([
    [String(POLL_ID), "24"],
    [String(POLL_ID), "11"],
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

test("choosing a trigger in the list opens its detail and its own history, a trigger without fires says so, and 'All triggers' returns to the history of every trigger", async () => {
  const { page } = await openPopulated();
  await expect(byId(page, IDS.allTriggers)).toHaveCount(0);
  await page.getByTestId(IDS.select).filter({ hasText: "Weekly changelog draft" }).click();
  await expect(byId(page, IDS.detailName)).toHaveText("Weekly changelog draft");
  await expect(byId(page, IDS.historyEmpty)).toHaveText("Nothing has fired or been missed yet.");
  await expect(byId(page, IDS.table)).toHaveCount(0);
  await expect(page.getByTestId(IDS.select).filter({ hasText: "Weekly changelog draft" })).toHaveAttribute("aria-current", "true");
  await byId(page, IDS.allTriggers).click();
  await expect(byId(page, IDS.detail)).toHaveCount(0);
  await expect(byId(page, IDS.table)).toBeVisible();
  await expect(byId(page, IDS.allFire).first()).toBeVisible();
  await expect(page.getByTestId(IDS.select).filter({ hasText: "Weekly changelog draft" })).toBeFocused();
  await expect(page.getByTestId(IDS.select).filter({ hasText: "Weekly changelog draft" })).not.toHaveAttribute("aria-current", "true");
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

// ---- AC5, and item 16's AC1: the kernel stopping and restarting ---------------------------------------------------

const bands = (page: Page): Locator => page.locator('[data-testid="kernel-unreachable-band"], [data-testid="kernel-reconnecting-band"]');

test("AC1 (item 16): when the kernel stops the shared band shows and the screen keeps its timeline, trigger list and firing history as last read, marked last known, with every kernel control disabled; after restart it reads again by itself", async ({}, testInfo) => {
  const { page } = await openPopulated();
  const timeline = await texts(page, IDS.entryName);
  const triggers = await texts(page, IDS.select);
  const history = await rowKinds(page, IDS.allFire);
  expect(timeline).toHaveLength(5);
  expect(triggers).toHaveLength(6);
  await fixture?.stop();
  await expect(bands(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(bands(page)).toHaveCount(1);
  await expect(byId(page, "titlebar-subtitle")).toHaveText("5 upcoming · 4 triggers on · last known");
  expect(await texts(page, IDS.entryName), "the timeline is the last read").toEqual(timeline);
  expect(await texts(page, IDS.select), "the trigger list is the last read").toEqual(triggers);
  expect(await rowKinds(page, IDS.allFire), "the firing history is the last read").toEqual(history);
  await expect(byId(page, IDS.empty)).toHaveCount(0);
  await expect(byId(page, IDS.error)).toHaveCount(0);
  await expect(byId(page, IDS.unknown)).toHaveCount(0);
  // Every control that needs the kernel is off and says why.
  for (const sw of await page.getByRole("switch").all()) {
    await expect(sw).toBeDisabled();
    await expect(sw).toHaveAttribute("title", "Needs the kernel");
  }
  await expect(byId(page, IDS.loadOlder)).toBeDisabled();
  await expect(byId(page, IDS.loadOlder)).toHaveAttribute("title", "Needs the kernel");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveAttribute("title", "Needs the kernel");
  // No raw request text: no method, path or connection state in the screen.
  expect(await byId(page, IDS.screen).innerText()).not.toMatch(/\b(GET|POST)\b|\/schedule|\/triggers|reconnecting|unreachable|ECONN/i);
  // What only changes the view of data held stays usable.
  await expect(byId(page, IDS.filterMissed)).toBeEnabled();
  await byId(page, IDS.filterMissed).click();
  await expect(byId(page, IDS.filterMissed)).toHaveAttribute("aria-pressed", "true");
  await byId(page, IDS.filterAll).click();
  await screenshots(page, "unreachable", testInfo);

  // Leaving the screen and coming back while the kernel is stopped still shows the last data: the answers are held per bridge.
  await page.evaluate(() => {
    window.location.hash = "#/chat";
  });
  await expect(byId(page, IDS.screen)).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = "#/schedules";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  expect(await texts(page, IDS.entryName), "the timeline survives a remount").toEqual(timeline);
  expect(await rowKinds(page, IDS.allFire), "the history survives a remount").toEqual(history);
  await expect(byId(page, IDS.unknown)).toHaveCount(0);
  await expect(byId(page, "titlebar-subtitle")).toHaveText("5 upcoming · 4 triggers on · last known");
  await expect(bands(page)).toHaveCount(1);

  // The kernel comes back: the screen reads again by itself (no click, no event) and the mark goes away.
  const reads = () => fixture?.requests.filter((r) => r.method === "GET" && r.path === "/schedule").length ?? 0;
  const before = reads();
  await fixture?.restart();
  await expect(bands(page)).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(reads, { timeout: 30_000 }).toBeGreaterThan(before);
  await expect(byId(page, "titlebar-subtitle")).toHaveText("5 upcoming · 4 triggers on");
  for (const sw of await page.getByRole("switch").all()) await expect(sw).toBeEnabled();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await expect(byId(page, IDS.loadOlder)).toBeEnabled();
});

// ---- AC7: live updates ---------------------------------------------------------------------------------------------

test("AC7: a trigger_fired and a wakeup_scheduled event update the timeline and the firing history with no reload, no loading state, and no row already shown moving", async () => {
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
    fires: await boxes(page, IDS.allFire),
  });
  const before = await shown();
  expect(before.entries, "five timeline entries have a box").toHaveLength(5);
  expect(before.fires, "fifteen history rows have a box").toHaveLength(15);
  expect([...before.entries, ...before.triggers, ...before.fires].every((b) => b !== null)).toBe(true);
  const reads = () => fixture?.requests.filter((r) => r.method === "GET" && r.path === "/schedule").length ?? 0;
  const readsBefore = reads();

  fx.fireOnPoll();
  fx.scheduleWakeup();
  await expect(byId(page, IDS.entry)).toHaveCount(6);
  // The poll's new fire joins the top group (a fired row of the same trigger): the same row, one more in its count.
  await expect(byId(page, IDS.allFire).first()).toHaveAttribute("data-count", "2");
  await expect(byId(page, IDS.summary)).toHaveText("6 upcoming · 4 triggers on");
  expect(await texts(page, IDS.entryName)).toContain("Wake-up #9 · task #12");
  await settle(page);

  expect(reads(), "the events made the screen read GET /schedule again").toBeGreaterThan(readsBefore);
  const after = await shown();
  expect(after.entries.slice(0, 5), "the timeline entries already shown did not move or resize").toEqual(before.entries);
  expect(after.triggers, "the trigger rows did not move or resize").toEqual(before.triggers);
  expect(after.fires, "the history rows did not move or resize (the new fire joined the top group)").toEqual(before.fires);
  const seen = await page.evaluate(() => ({ marker: (window as unknown as { __marker?: string }).__marker, loading: (window as unknown as { __loadingSeen?: boolean }).__loadingSeen }));
  expect(seen.marker, "the window was not reloaded").toBe("same-window");
  expect(seen.loading, "the screen never flashed a loading state").toBe(false);

  // A toggle done elsewhere: the switch follows, and the trigger joins the timeline.
  fx.toggleElsewhere(5);
  await expect(switchNamed(page, "Morning digest trigger is on")).toHaveAttribute("aria-checked", "true");
  await expect(byId(page, IDS.entry)).toHaveCount(7);
});

// ---- The Result chip fits its column (phase 7 polish, item 25) ---------------------------------------------------------

test("AC1 (item 25): at the default window size every Result chip shows its whole text inside its cell, light and dark, in the all-triggers table and in the poll's own history", async ({}, testInfo) => {
  const { page } = await openPopulated();
  expect(await page.evaluate(() => [window.innerWidth, window.innerHeight]), "the default window size (main.ts)").toEqual([1180, 760]);
  const skipped = await pageToSkipped(page);
  const skippedRows = await skipped.count();
  expect(skippedRows, "the history shows playbook_not_enabled rows").toBeGreaterThan(0);
  await inEachTheme(page, async (theme) => {
    const report = await chipReport(page);
    expect(report.measured, `${theme}: every row of the all-triggers table has a chip to measure`).toBe(await byId(page, IDS.allFire).count());
    expect(report.skipped, `${theme}: the playbook_not_enabled rows are among those measured`).toBe(skippedRows);
    expect(report.problems, `${theme}: no chip is clipped`).toEqual([]);
    for (const row of await skipped.all()) await expect(row.getByTestId(IDS.fireReason), "the recorded reason is still under the chip").toHaveText("playbook_not_enabled");
  });
  expect(await columnMisalignments(page), "the columns line up with their headers").toEqual([]);
  await skipped.first().scrollIntoViewIfNeeded();
  await screenshots(page, "populated-skipped", testInfo);

  // The poll's own history: its four skipped polls are one row with a count, "×4", beside the chip.
  await page.getByTestId(IDS.select).filter({ hasText: "Review PRs on studio-sandbox" }).click();
  await expect(byId(page, IDS.detailName)).toHaveText("Review PRs on studio-sandbox");
  await byId(page, IDS.loadOlder).click();
  await expect(byId(page, IDS.filterAll)).toHaveText("All · 20+");
  const own = byId(page, IDS.fire).and(page.locator('[data-reason="playbook_not_enabled"]'));
  await expect(own).toHaveCount(1);
  await expect(own).toContainText("×4");
  await inEachTheme(page, async (theme) => {
    const report = await chipReport(page);
    expect(report.measured, `${theme}: every row of the poll's table has a chip to measure`).toBe(await byId(page, IDS.fire).count());
    expect(report.skipped, `${theme}: the skipped row is among them`).toBe(1);
    expect(report.problems, `${theme}: no chip is clipped`).toEqual([]);
  });
  expect(await columnMisalignments(page), "the columns line up with their headers").toEqual([]);
});

test("AC2 (item 25): at the minimum window size (900x560) no Result chip is clipped, the table fits its pane, and the Trigger column keeps a usable width, light and dark", async ({}, testInfo) => {
  const { page } = await openPopulated();
  await resizeWindow(page, 900, 560);
  const skipped = await pageToSkipped(page);
  const skippedRows = await skipped.count();
  expect(skippedRows, "the history shows playbook_not_enabled rows").toBeGreaterThan(0);
  await inEachTheme(page, async (theme) => {
    const report = await chipReport(page);
    expect(report.measured, `${theme}: every row of the all-triggers table has a chip to measure`).toBe(await byId(page, IDS.allFire).count());
    expect(report.skipped, `${theme}: the playbook_not_enabled rows are among those measured`).toBe(skippedRows);
    expect(report.problems, `${theme}: no chip is clipped`).toEqual([]);
    const fit = await paneFit(page);
    expect(fit.paneScroll, `${theme}: the pane has no horizontal scroll`).toBeLessThanOrEqual(fit.paneClient);
    expect(fit.tableWidth, `${theme}: the table fits its parent`).toBeLessThanOrEqual(fit.parentClient);
    expect(fit.triggerHead, `${theme}: the Trigger column keeps a usable width`).toBeGreaterThanOrEqual(96);
    expect(fit.names.length).toBeGreaterThan(0);
    for (const width of fit.names) expect(width, `${theme}: a trigger name has width`).toBeGreaterThan(0);
  });
  await skipped.first().scrollIntoViewIfNeeded();
  await screenshots(page, "populated-skipped-min", testInfo);

  // The poll's own history at this size: the "×4" row, chip and count side by side.
  await page.getByTestId(IDS.select).filter({ hasText: "Review PRs on studio-sandbox" }).click();
  await expect(byId(page, IDS.detailName)).toHaveText("Review PRs on studio-sandbox");
  await byId(page, IDS.loadOlder).click();
  await expect(byId(page, IDS.filterAll)).toHaveText("All · 20+");
  await expect(byId(page, IDS.fire).and(page.locator('[data-reason="playbook_not_enabled"]'))).toContainText("×4");
  await inEachTheme(page, async (theme) => {
    const report = await chipReport(page);
    expect(report.skipped, `${theme}: the skipped row is measured`).toBe(1);
    expect(report.problems, `${theme}: no chip is clipped`).toEqual([]);
    const fit = await paneFit(page);
    expect(fit.paneScroll, `${theme}: the pane has no horizontal scroll`).toBeLessThanOrEqual(fit.paneClient);
    expect(fit.tableWidth, `${theme}: the table fits its parent`).toBeLessThanOrEqual(fit.parentClient);
    expect(fit.triggerHead, `${theme}: the Trigger column keeps a usable width`).toBeGreaterThanOrEqual(96);
    for (const width of fit.names) expect(width, `${theme}: a trigger name has width`).toBeGreaterThan(0);
  });
});

test("AC3 (item 25): each header cell shares its left and right x with its column's cells at the default and the minimum window size, with a skipped row shown", async () => {
  const { page } = await openPopulated();
  await pageToSkipped(page);
  for (const [width, height] of [[1180, 760], [900, 560]] as const) {
    await resizeWindow(page, width, height);
    await inEachTheme(page, async (theme) => {
      expect(await columnMisalignments(page), `${theme} at ${width}px: the columns line up with their headers`).toEqual([]);
    });
  }
});

test("AC3 (item 25): at the minimum window size a refetch that raises a shown row's count moves no row already shown, a skipped row included", async () => {
  const { fx, page } = await openPopulated();
  await resizeWindow(page, 900, 560);
  await pageToSkipped(page);
  await settle(page);
  const before = await boxes(page, IDS.allFire);
  expect(before.length, "the paged history has rows with boxes").toBeGreaterThan(15);
  expect(before.every((b) => b !== null)).toBe(true);
  const top = byId(page, IDS.allFire).first();
  await expect(top).toHaveAttribute("data-count", "1");
  fx.fireOnPoll();
  // The poll's new fire joins the top fired row: its count goes 1 -> 2 and its "×2" appears.
  await expect(top).toHaveAttribute("data-count", "2");
  await expect(top).toContainText("×2");
  await settle(page);
  expect(await boxes(page, IDS.allFire), "no history row already shown moved or resized").toEqual(before);
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
  await expect(screenRoot.getByRole("list", { name: "Later" })).toBeVisible();
  await expect(screenRoot.getByRole("heading", { level: 2, name: "Upcoming · Today" })).toBeVisible();
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
