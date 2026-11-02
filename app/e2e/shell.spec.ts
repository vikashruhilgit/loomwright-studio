// The shell's frame in the built app against the fixture kernel (phase 7, shell item).
//
// AC1: the shared kernel-unreachable band. The fixture's listener is STOPPED under an open window
// (`fixture.stop()`, not a read faked to status 0), which is what the 2026-11-01 live run did with
// `launchctl bootout`: the store reads `reconnecting`, the shell shows the one red band, and the screen
// keeps its last data under it with its writes off. `fixture.restart()` (same port, same state) clears it.
//
// The band's "Kernel log" action sits at its right on every screen; pressed with no log on disk it says so and
// reveals nothing (the spec never presses it while a log file exists: that would open the real Finder).
//
// AC3/AC4/AC6/AC7: the frame the mockup draws (sidebar glyphs, divider, "Schedules & triggers", crew rows, the
// bottom status row and the ⌘K hint; the title bar), and its polish-gate screenshots of the mockup's
// `integrations-token` and `integrations-unreachable` views in light and dark, plus the band's "no log yet" note
// (`integrations-unreachable-kernel-log-missing`, which the mockup has no view for). With `SHELL_EVIDENCE=1` they are
// written to the committed `docs/evidence/phase-7-polish/shell/`; otherwise to Playwright's per-test output dir, so
// CI never dirties tracked files, and a test asserts nothing under the tracked dir changed during the run and that
// the evidence README names every file. The spec asserts behaviour, never pixels: fonts differ between macOS and CI.
// Run `npm run build` first.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { BACKOFF_CAP_MS, SETTLE_MS } from "../src/store/store";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { ACCOUNT, integrationsFixture } from "./fixtures/integrations";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/shell/", import.meta.url));
const README = join(EVIDENCE_DIR, "README.md");
const THEMES = ["light", "dark"] as const;
/** The mockup's views (`gui-v2.html`, `#view=<name>`), as the file names have them. */
const VIEWS = ["integrations-token", "integrations-unreachable", "integrations-unreachable-kernel-log-missing"] as const;
/** When this run began, for the guard that the tracked evidence dir is untouched without `SHELL_EVIDENCE`. */
const RUN_START = Date.now();

/** Above the backoff cap plus `SETTLE_MS`: every wait for the store to change state. */
const STATE_TIMEOUT_MS = BACKOFF_CAP_MS + SETTLE_MS + 3_000;

/** The band copy, exactly (`KERNEL_BAND_COPY` in `src/shell/KernelStates.tsx`). */
const BAND_COPY = "Couldn't reach the kernel. It may be restarting; this window reconnects on its own.";
/** The band's action, and what the band says when the press finds no log (`KERNEL_LOG_LABEL` and the note in `KernelStates.tsx`). */
const KERNEL_LOG = "Kernel log";
const NO_LOG_NOTE = "There is no kernel log yet.";

/**
 * The screen's test ids, copied as `integrations.spec.ts` copies them (`model.ts` pulls in `.tsx` the e2e project's
 * `tsconfig.node.json` cannot type-check).
 */
const IDS = {
  screen: "screen-integrations",
  listMeta: "integrations-row-meta",
  band: "integrations-band",
  replace: "integrations-replace",
  switchToApp: "integrations-switch-to-app",
  disconnect: "integrations-disconnect",
  refresh: "integrations-refresh",
} as const;

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

/** Launch the built app on `started` and wait until the store is live (the feed open and settled). */
async function launch(started: FixtureKernel): Promise<Page> {
  app = await launchApp(started.env);
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect.poll(() => started.requests.some((r) => r.path === "/events/stream"), { timeout: STATE_TIMEOUT_MS }).toBe(true);
  // `SETTLE_MS` more guarantees the store is live with no frame at all.
  await page.waitForTimeout(SETTLE_MS + 500);
  return page;
}

const byId = (page: Page, id: string): Locator => page.getByTestId(id);

/** Exactly one shared band, and neither the old reconnecting line nor Integrations' own band beside it. */
async function expectOneSharedBand(page: Page): Promise<void> {
  const band = byId(page, "kernel-unreachable-band");
  await expect(band).toHaveCount(1);
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("role", "alert");
  await expect(band).toHaveText(BAND_COPY + KERNEL_LOG);
  await expect(byId(page, "kernel-reconnecting-band")).toHaveCount(0);
  await expect(byId(page, IDS.band)).toHaveCount(0);
}

test("AC1: stopping the fixture's listener shows the one shared band over Integrations' last data, writes off; restarting clears it", async () => {
  test.setTimeout(90_000);
  const fx = integrationsFixture({ connector: "connected" });
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  const kernel = fixture;
  const page = await launch(kernel);
  await page.evaluate(() => {
    window.location.hash = "#/integrations";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0);
  const writes = [IDS.replace, IDS.switchToApp, IDS.disconnect, IDS.refresh];
  for (const id of writes) await expect(byId(page, id)).toBeEnabled();

  // The kernel goes away under the open window: the listener stops, the window and the fixture stay.
  await kernel.stop();
  await expectOneSharedBand(page);
  // The last row stays, read as unknown, and is never "not connected" or the empty state.
  await expect(byId(page, IDS.listMeta)).toHaveText("status unknown · kernel unreachable");
  await expect(byId(page, "integrations-account")).toHaveText(ACCOUNT);
  for (const id of writes) {
    await expect(byId(page, id)).toBeDisabled();
    await expect(byId(page, id)).toHaveAttribute("title", "Needs the kernel");
  }
  // Still exactly one band a moment later, once the store has retried against the dead port.
  await page.waitForTimeout(BACKOFF_CAP_MS / 5);
  await expectOneSharedBand(page);

  // Back on the same port with the same state: the band goes and the writes are enabled again.
  await kernel.restart();
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0, { timeout: STATE_TIMEOUT_MS });
  await expect(byId(page, "kernel-reconnecting-band")).toHaveCount(0);
  await expect(byId(page, IDS.band)).toHaveCount(0);
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
  for (const id of writes) await expect(byId(page, id)).toBeEnabled();
});

/** The seven screens that draw the shared band themselves or under the shell's, by route and title. */
const BAND_SCREENS = [
  ["#/tasks", "Tasks"],
  ["#/playbooks", "Playbooks"],
  ["#/schedules", "Schedules & triggers"],
  ["#/memory", "Memory"],
  ["#/budget", "Budget & audit"],
  ["#/settings", "Settings"],
  ["#/integrations", "Integrations"],
] as const;

test("AC1: on each of seven screens the one band ends with a Kernel log button at its right, after the sentence", async () => {
  test.setTimeout(120_000);
  const fx = integrationsFixture();
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  const kernel = fixture;
  const page = await launch(kernel);
  await kernel.stop();
  for (const [route, title] of BAND_SCREENS) {
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, route);
    await expect(page.locator("h1"), `${route} is showing`).toHaveText(title);
    const bands = page.locator(".band-danger");
    await expect(bands, `${route} has exactly one band`).toHaveCount(1, { timeout: STATE_TIMEOUT_MS });
    const action = bands.getByRole("button", { name: KERNEL_LOG });
    await expect(action, `${route}'s band has the action`).toBeVisible();
    await expect(bands).toHaveText(BAND_COPY + KERNEL_LOG);
    // Geometry: the action's right edge is within the band's padding of the band's right edge, and it starts right of the sentence.
    const box = await bands.evaluate((band) => {
      const sentence = band.querySelector("span")?.getBoundingClientRect();
      const button = band.querySelector("button")?.getBoundingClientRect();
      return {
        paddingRight: Number.parseFloat(getComputedStyle(band).paddingRight),
        bandRight: band.getBoundingClientRect().right,
        sentenceRight: sentence?.right ?? Number.NaN,
        buttonLeft: button?.left ?? Number.NaN,
        buttonRight: button?.right ?? Number.NaN,
      };
    });
    expect(box.paddingRight, `${route}: the band has right padding`).toBeGreaterThan(0);
    expect(box.bandRight - box.buttonRight, `${route}: the action's right edge is inside the band`).toBeGreaterThanOrEqual(-1);
    expect(box.bandRight - box.buttonRight, `${route}: the action's right edge is within the band's padding`).toBeLessThanOrEqual(box.paddingRight + 1);
    expect(box.buttonLeft, `${route}: the action starts right of the sentence`).toBeGreaterThan(box.sentenceRight);
  }
});

test("AC1: the same band shows over any screen (Chat, the default) and goes when the listener is back", async () => {
  test.setTimeout(90_000);
  const fx = integrationsFixture();
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  const kernel = fixture;
  const page = await launch(kernel);
  await expect(byId(page, "screen-chat")).toBeVisible();
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0);

  await kernel.stop();
  await expectOneSharedBand(page);
  // The screen stays under the band.
  await expect(byId(page, "screen-chat")).toBeVisible();

  await kernel.restart();
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0, { timeout: STATE_TIMEOUT_MS });
  await expect(byId(page, "kernel-reconnecting-band")).toHaveCount(0);
});

// ---- AC3, AC4, AC6, AC7: the frame -------------------------------------------------------------------------------------------

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

/** `<view>-light.png` and `-dark.png` of the whole window; the dark tokens must really apply. */
async function screenshots(page: Page, view: (typeof VIEWS)[number], testInfo: TestInfo): Promise<void> {
  const evidence = process.env.SHELL_EVIDENCE === "1";
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

const NAV_LABELS = ["Chat", "Team", "Approvals", "Sessions", "Integrations", "Tasks", "Playbooks", "Schedules & triggers", "Memory", "Budget & audit", "Settings"] as const;

test("AC3/AC4/AC6/AC7: the sidebar and title bar match the mockup, at rest and with the kernel stopped, in light and dark", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fx = integrationsFixture({ connector: "connected" });
  // Mason has a thread, so his crew row shows a last line; Ada is off (dimmed, saying so).
  const options = {
    ...fx.options,
    routes: {
      ...fx.options.routes,
      "GET /messages": () => ({
        status: 200,
        body: {
          messages: [
            {
              id: 1,
              queue_id: 1,
              agent: "mason",
              source: "ask",
              text: "Review the open PRs",
              status: "replied",
              session_id: null,
              reply_text: "Two PRs need you: one blocking finding in site#14.",
              detail: null,
              created_at: "2026-10-22T08:30:00.000Z",
              updated_at: "2026-10-22T08:31:00.000Z",
              from_agent: null,
              depth: 0,
              reply_to: null,
              workspace: null,
            },
          ],
        },
      }),
    },
  };
  fixture = await startFixtureKernel(options);
  fx.attach(fixture);
  const kernel = fixture;
  const page = await launch(kernel);
  await page.evaluate(() => {
    window.location.hash = "#/integrations";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);

  const sidebar = byId(page, "sidebar");
  const nav = sidebar.getByRole("navigation", { name: "Screens" });
  // AC3/AC6: eleven entries, each named for its label alone, each with a decorative glyph, "Schedules & triggers" in place.
  const entries = nav.getByRole("button");
  await expect(entries).toHaveCount(NAV_LABELS.length);
  for (const [index, label] of NAV_LABELS.entries()) {
    const entry = entries.nth(index);
    await expect(entry, `${label} is named for its label`).toHaveAccessibleName(label);
    await expect(entry.locator("svg"), `${label} has one glyph`).toHaveCount(1);
    await expect(entry.locator("svg"), `${label}'s glyph is decorative`).toHaveAttribute("aria-hidden", "true");
  }
  await expect(nav.getByRole("button", { name: "Integrations" })).toHaveAttribute("aria-current", "page");
  // One divider, between Integrations and Tasks.
  await expect(nav.getByRole("separator")).toHaveCount(1);
  const dividerAt = await nav.evaluate((el) => {
    const hr = el.querySelector("hr");
    return [hr?.previousElementSibling?.querySelector(".nav-text")?.textContent, hr?.nextElementSibling?.querySelector(".nav-text")?.textContent];
  });
  expect(dividerAt).toEqual(["Integrations", "Tasks"]);
  // The crew rows: avatar, name and one last line, and no time.
  const mason = sidebar.locator('[data-agent="mason"]');
  await expect(mason).toBeVisible();
  await expect(mason.locator(".chat-crew-last")).toHaveText("Two PRs need you: one blocking finding in site#14.");
  await expect(sidebar.locator(".chat-crew-row time")).toHaveCount(0);
  await expect(sidebar.locator('[data-agent="ada"]').getByTestId("crew-off")).toHaveText("off");
  // The bottom row: a labelled status, the ⌘K hint outside it.
  const status = sidebar.getByRole("status", { name: "Kernel: idle" });
  await expect(status).toBeVisible();
  await expect(status).toHaveText("idle");
  await expect(sidebar.getByRole("img", { name: "Command palette" })).toHaveText("⌘K");
  // AC4: no screen declares a count line yet, so the bar is the title alone and no empty subtitle element.
  await expect(page.locator("h1")).toHaveText(["Integrations"]);
  await expect(byId(page, "titlebar-subtitle")).toHaveCount(0);
  await screenshots(page, "integrations-token", testInfo);

  // The kernel goes away: the one band, and the status row says so.
  await kernel.stop();
  await expectOneSharedBand(page);
  const gone = sidebar.getByRole("status", { name: "Kernel: kernel unreachable" });
  await expect(gone).toBeVisible({ timeout: STATE_TIMEOUT_MS });
  await expect(gone).toHaveText("kernel unreachable");
  await expect(byId(page, IDS.listMeta)).toHaveText("status unknown · kernel unreachable");
  // The action sits at the band's right (the full geometry is pinned on all seven screens above).
  await expect(byId(page, "kernel-unreachable-band").getByRole("button", { name: KERNEL_LOG })).toBeVisible();
  await screenshots(page, "integrations-unreachable", testInfo);

  // AC3: the fixture's data dir holds no kernel log, so the press reveals nothing and the band says so. Pressed only
  // after asserting the file is absent: with one on disk it would open the real Finder.
  expect(existsSync(join(kernel.dataDir, "logs", "kernel.err.log")), "the fixture's data dir has no kernel log").toBe(false);
  await expect(byId(page, "kernel-log-note")).toHaveCount(0);
  await byId(page, "kernel-unreachable-band").getByRole("button", { name: KERNEL_LOG }).click();
  const note = byId(page, "kernel-log-note");
  await expect(note).toHaveText(NO_LOG_NOTE);
  await expect(note).toHaveAttribute("role", "status");
  await expect(byId(page, "kernel-unreachable-band")).toHaveText(BAND_COPY + KERNEL_LOG + NO_LOG_NOTE);
  await screenshots(page, "integrations-unreachable-kernel-log-missing", testInfo);

  // And back.
  await kernel.restart();
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0, { timeout: STATE_TIMEOUT_MS });
  await expect(sidebar.getByRole("status", { name: "Kernel: idle" })).toBeVisible();
});

test("AC3: the sidebar runs entries, then Chat's Crew group, then the status row", async () => {
  fixture = await startFixtureKernel();
  const page = await launch(fixture);
  const order = await byId(page, "sidebar").evaluate((el) => [...el.children].map((child) => child.className));
  expect(order.indexOf("nav")).toBeGreaterThan(-1);
  expect(order.indexOf("nav-group")).toBeGreaterThan(order.indexOf("nav"));
  expect(order.indexOf("sidebar-foot")).toBeGreaterThan(order.indexOf("nav-group"));
});

// ---- AC7: the evidence -------------------------------------------------------------------------------------------------------

test("AC7: without SHELL_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", async () => {
  test.skip(process.env.SHELL_EVIDENCE === "1", "an evidence run writes the tracked dir on purpose");
  const files = existsSync(EVIDENCE_DIR) ? readdirSync(EVIDENCE_DIR) : [];
  const touched = files.filter((name) => statSync(join(EVIDENCE_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-7-polish/shell/ is newer than this run's start").toEqual([]);
});

test("AC7: the evidence README names each screenshot against its mockup view, in light and dark, and every one exists", () => {
  const readme = readFileSync(README, "utf8");
  const files = new Set(readdirSync(EVIDENCE_DIR));
  for (const view of VIEWS) {
    expect(readme, `the README names the mockup view ${view}`).toContain(view);
    for (const theme of THEMES) {
      const file = `${view}-${theme}.png`;
      expect(readme, `the README links ${file}`).toContain(`(${file})`);
      expect(files.has(file), `${file} is committed`).toBe(true);
    }
  }
  expect([...files].filter((f) => f.endsWith(".png")).length, "no screenshot the README does not know").toBe(VIEWS.length * THEMES.length);
  expect(readme).toContain("SHELL_EVIDENCE=1");
  for (const departure of ["Kernel log", "Schedules & triggers"]) expect(readme, `the README records: ${departure}`).toContain(departure);
});
