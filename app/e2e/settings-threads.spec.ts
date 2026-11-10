// Settings → Threads (phase 8 item 17c, AC7 Settings) in the built app against the fixture kernel
// (`./fixtures/settings.ts` with `agents`): each agent's size hint, read-only. A set hint reads "N tokens · set by you"
// with the file it is set in, an unset one "Not set: Summarize is never highlighted."; Wright is read from
// `GET /threads/wright` (its detail route is `409 reserved`), each crew member from `GET /agents/:id`; the section has
// no field, no Save, no Wright proposal, no reference limit, no tab stop and no dollar sign; its text is at least 4.5:1
// in both themes; and a light and a dark screenshot of each mockup view it builds. Run `npm run build` first.
//
// Screenshots: with `PHASE8_POLISH_EVIDENCE=1` they are written to the committed evidence dir
// `docs/evidence/phase-8-polish/settings-threads/` (after deleting any PNG there this spec no longer names);
// otherwise to Playwright's per-test output dir, so a plain run never dirties tracked files, and a test asserts nothing
// under the tracked dir changed during the run. The spec asserts behaviour, never pixels: fonts differ between macOS
// and CI. The last test holds the README, the folder and this spec's list of states to the same names.
//
// Regenerate (macOS): `cd app && npm run build && PHASE8_POLISH_EVIDENCE=1 npx playwright test e2e/settings-threads.spec.ts --workers=1`
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { settingsFixture } from "./fixtures/settings";
import type { ThreadsAgent } from "./fixtures/settings";
import { SETTINGS_TEST_IDS as IDS } from "../src/screens/settings/model";

const EVIDENCE = process.env.PHASE8_POLISH_EVIDENCE === "1";
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-8-polish/settings-threads/", import.meta.url));
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const SHOT_SIZE = { width: 1180, height: 900 } as const;
/** The states shot, each named for the mockup view it is compared with (`settings-threads`, `settings-threads-set`). */
const SHOT_STATES = ["not-set", "set"] as const;
type ShotState = (typeof SHOT_STATES)[number];
const shotName = (state: ShotState, theme: Theme): string => `settings-threads-${state}-${theme}.png`;
const EXPECTED = SHOT_STATES.flatMap((state) => THEMES.map((theme) => shotName(state, theme)));

/** The main process's test seams (`electron/settings.ts`), so no run touches the owner's own prefs or login item. */
const PREFS_DIR_ENV = "STUDIO_APP_PREFS_DIR";
const FAKE_OS_ENV = "STUDIO_APP_FAKE_OS";

/** Wright, then three crew members: one set, one unset, one set in a file the kernel refuses. */
const SET_AGENTS: readonly ThreadsAgent[] = [
  { id: "wright", name: "Wright", hint: 40_000 },
  { id: "mason", name: "Mason", hint: 120_000 },
  { id: "ada", name: "Ada" },
  { id: "pim", name: "Pim", hint: 30_000, error: { error: "settings_invalid", field: "permission_mode", message: "permission_mode must be one of default, acceptEdits, plan, dontAsk, auto" } },
];
/** The default: no agent has a hint (and one holds a value the kernel's schema refuses, which reads the same). */
const UNSET_AGENTS: readonly ThreadsAgent[] = [
  { id: "wright", name: "Wright", hint: null },
  { id: "mason", name: "Mason" },
  { id: "ada", name: "Ada", hint: "40k" },
];

/** When this run began, for the guard that the tracked evidence dir is untouched without `PHASE8_POLISH_EVIDENCE`. */
const RUN_START = Date.now();

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
let prefsDir: string | undefined;
const pageErrors: string[] = [];

// The evidence folder holds exactly this spec's screenshots: a renamed or removed state leaves no stale PNG.
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
  if (prefsDir !== undefined) rmSync(prefsDir, { recursive: true, force: true });
  prefsDir = undefined;
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

const byId = (scope: Page | Locator, id: string): Locator => scope.getByTestId(id);
const row = (page: Page, id: string): Locator => page.locator(`[data-testid="${IDS.threadsRow}"][data-agent="${id}"]`);

/** Start the fixture kernel serving `agents`, launch the built app and open Settings, once every hint has answered. */
async function open(agents: readonly ThreadsAgent[]): Promise<Page> {
  const fx = settingsFixture({ agents });
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  prefsDir = mkdtempSync(join(tmpdir(), "studio-app-prefs-"));
  app = await launchApp({ ...fixture.env, [PREFS_DIR_ENV]: prefsDir, [FAKE_OS_ENV]: "1" });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await expect(byId(page, IDS.threads)).toBeVisible();
  await expect(byId(page, IDS.threadsRow)).toHaveCount(agents.length);
  await expect(byId(byId(page, IDS.threads), IDS.threadsHint).filter({ hasText: "Reading…" })).toHaveCount(0);
  return page;
}

async function setTheme(page: Page, theme: Theme | undefined): Promise<void> {
  await page.evaluate((value) => {
    if (value === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  }, theme);
}

/**
 * Resolves after two animation frames and once no CSS transition is running, so any pending React commit and layout
 * have landed and a theme switch's colour transitions (`.btn` has one, `--duration-instant`) have ended: a colour read
 * mid-transition is neither theme's.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  // Transitions only: the shell runs infinite animations (a live dot's pulse) that never end.
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition)));
}

/** `settings-threads-<state>-light.png` and `-dark.png` of the window with the Threads section in view; the dark tokens must really apply. */
async function screenshots(page: Page, state: ShotState, testInfo: TestInfo): Promise<void> {
  await app?.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height), SHOT_SIZE);
  await settle(page);
  await byId(page, IDS.threads).scrollIntoViewIfNeeded();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const file = shotName(state, theme);
    const path = EVIDENCE ? join(EVIDENCE_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
  }
  expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);
  await setTheme(page, undefined);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

/** The WCAG contrast of every element `selector` matches, text on what it sits on, in the page's current theme (as `tasks.spec.ts` measures it). */
async function contrastRows(page: Page, selector: string): Promise<{ readonly selector: string; readonly text: string; readonly ratio: number }[]> {
  return page.evaluate((selector) => {
    type Rgba = readonly [number, number, number, number];
    const parse = (css: string): Rgba => {
      const n = (css.match(/[-\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
      return css.startsWith("color(") ? [(n[0] ?? 0) * 255, (n[1] ?? 0) * 255, (n[2] ?? 0) * 255, n[3] ?? 1] : [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const over = (top: Rgba, bottom: readonly [number, number, number]): [number, number, number] => [0, 1, 2].map((i) => (top[i] as number) * top[3] + (bottom[i] as number) * (1 - top[3])) as [number, number, number];
    const channel = (v: number): number => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]: readonly [number, number, number]): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const backdrop = (el: Element): [number, number, number] => {
      const layers: Rgba[] = [];
      for (let e: Element | null = el; e !== null; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor);
        if (bg[3] > 0) layers.push(bg);
        if (bg[3] >= 1) break;
      }
      let base: [number, number, number] = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i -= 1) base = over(layers[i] as Rgba, base);
      return base;
    };
    return [...document.querySelectorAll(selector)].map((el) => {
      const bg = backdrop(el);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
      return { selector: el.className, text: (el.textContent ?? "").slice(0, 40), ratio: (hi + 0.05) / (lo + 0.05) };
    });
  }, selector);
}

// ---- The hints ---------------------------------------------------------------------------------------------------------

test("a set hint reads 'N tokens · set by you' with its file; Wright first; a file the kernel refuses says its hint does not apply", async ({}, testInfo) => {
  const page = await open(SET_AGENTS);
  expect(await byId(page, IDS.threadsRow).evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.agent))).toEqual(["wright", "mason", "ada", "pim"]);
  await expect(byId(row(page, "wright"), IDS.threadsHint)).toHaveText("40,000 tokens · set by you");
  await expect(byId(row(page, "wright"), IDS.threadsFile)).toHaveText("in config/agents/wright.json");
  await expect(byId(row(page, "mason"), IDS.threadsHint)).toHaveText("120,000 tokens · set by you");
  await expect(byId(row(page, "mason"), IDS.threadsFile)).toHaveText("in config/agents/mason.json");
  await expect(byId(row(page, "ada"), IDS.threadsHint)).toHaveText("Not set: Summarize is never highlighted.");
  await expect(byId(row(page, "ada"), IDS.threadsFile)).toHaveText("Set one in config/agents/ada.json");
  await expect(byId(row(page, "pim"), IDS.threadsHint)).toHaveText("30,000 tokens · set by you");
  await expect(byId(row(page, "pim"), IDS.threadsNote)).toHaveText(
    "Not applied: the kernel refuses this file (permission_mode must be one of default, acceptEdits, plan, dontAsk, auto), so Summarize is never highlighted.",
  );
  await expect(byId(page, IDS.threadsSample)).toContainText("past your size hint");

  // Wright through its thread page (the kernel's own reading); never its detail route, which the kernel refuses.
  const paths = (fixture as FixtureKernel).requests.map((r) => `${r.method} ${r.path}`);
  expect(paths).toContain("GET /threads/wright");
  expect(paths).not.toContain("GET /agents/wright");
  for (const id of ["mason", "ada", "pim"]) expect(paths).toContain(`GET /agents/${id}`);
  await screenshots(page, "set", testInfo);
});

test("no hint set: every row reads not set, including a value the kernel's schema would refuse", async ({}, testInfo) => {
  const page = await open(UNSET_AGENTS);
  for (const id of ["wright", "mason", "ada"]) await expect(byId(row(page, id), IDS.threadsHint), id).toHaveText("Not set: Summarize is never highlighted.");
  await expect(byId(page, IDS.threadsNote)).toHaveCount(0);
  await screenshots(page, "not-set", testInfo);
});

// ---- Read-only, keyboard, contrast --------------------------------------------------------------------------------------

test("read-only: no field, no Save, no Wright proposal, no reference limit, no tab stop and no dollar sign in the section", async () => {
  const page = await open(SET_AGENTS);
  const section = byId(page, IDS.threads);
  await expect(section.locator("input, textarea, select, [contenteditable]:not([contenteditable='false'])")).toHaveCount(0);
  await expect(section.getByRole("button")).toHaveCount(0);
  await expect(section.getByRole("link")).toHaveCount(0);
  await expect(section.locator("a[href], button, [tabindex]:not([tabindex='-1'])")).toHaveCount(0);
  const text = (await section.textContent()) ?? "";
  expect(text).not.toMatch(/\bSave\b|proposed by Wright|Wright's proposal|Reference limit/i);
  expect(text).not.toContain("$");
  await expect(page.getByRole("region", { name: "Threads" })).toBeVisible();
  await expect(section.getByRole("heading", { name: "Threads" })).toBeVisible();
});

test("the section's text is at least 4.5:1 against what it sits on, in both themes", async () => {
  const page = await open(SET_AGENTS);
  const scope = `[data-testid="${IDS.threads}"]`;
  const checks = [`${scope} h2`, `${scope} p`, `${scope} dt`, `${scope} dd > span:not(.settings-sr-only)`, `${scope} .settings-mono`, `${scope} .badge`].join(", ");
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    const rows = await contrastRows(page, checks);
    expect(rows.length, `${theme}: elements checked`).toBeGreaterThan(15);
    expect(
      rows.filter((r) => r.ratio < 4.5),
      `${theme}: text under 4.5:1`,
    ).toEqual([]);
  }
  await setTheme(page, undefined);
});

// ---- Evidence ----------------------------------------------------------------------------------------------------------

test("without PHASE8_POLISH_EVIDENCE nothing under the tracked evidence dir changed during the run", () => {
  test.skip(EVIDENCE, "an evidence run writes the tracked dir on purpose");
  let files: string[] = [];
  try {
    files = readdirSync(EVIDENCE_DIR);
  } catch {
    // No committed evidence dir at all: nothing could have been written to it.
  }
  const touched = files.filter((file) => statSync(join(EVIDENCE_DIR, file)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-8-polish/settings-threads/ is newer than this run's start").toEqual([]);
});

test("the evidence README lists every screenshot, and nothing else, and the folder holds those files", () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const listed = new Set(readme.match(/settings-threads-[a-z-]+-(?:light|dark)\.png/g) ?? []);
  expect([...listed].sort(), "the README names exactly this spec's screenshots").toEqual([...EXPECTED].sort());
  const onDisk = readdirSync(EVIDENCE_DIR).filter((file) => file.endsWith(".png"));
  expect(onDisk.sort(), "the folder holds exactly those files").toEqual([...EXPECTED].sort());
  expect(readme).toContain("PHASE8_POLISH_EVIDENCE=1");
  expect(readme).toContain("e2e/settings-threads.spec.ts");
});
