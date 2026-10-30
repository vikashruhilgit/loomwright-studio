// The Memory screen (phase 7 item 06) in the built app against the fixture kernel
// (`./fixtures/memory.ts`): the tree with its root, folders and sizes and the overview (AC6), a
// file's view, the editor and its save with the hash it was opened at (AC7), the conflict an
// agent's write causes and the ways out of it, with the draft kept (AC8), the kernel going away
// while the screen holds data or a draft (AC9), the keyboard (AC10), a live update that moves
// nothing already shown and never touches a draft (AC11), the accessible names and the tokens
// (AC12), and a light and a dark screenshot of each state the mockup shows (AC13). Run
// `npm run build` first.
//
// Screenshots: with `MEMORY_EVIDENCE=1` they are written to the committed evidence dir
// `docs/evidence/phase-7-polish/memory/`; otherwise to Playwright's per-test output dir, so CI
// never dirties tracked files, and the last tests assert nothing under the tracked dir changed
// during the run and that the evidence README names every file. The spec asserts behaviour,
// never pixels: fonts differ between macOS and CI.
//
// The shell does not mount the ⌘K palette or bind ⌘9 yet (the same as phases 6 and 7's earlier
// screens), so the screen is opened by its hash and the keyboard walks use Tab, Enter, J, K, the
// arrows and Escape. The screen's two palette commands are pinned in `MemoryScreen.test.tsx`
// (jsdom).
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { LESSONS_AGENT, LESSONS_AGENT_LINE, LESSONS_BASE, LESSONS_MINE, LESSONS_MINE_LINE, LESSONS_PATH, hashOf, memoryFixture } from "./fixtures/memory";
import type { MemoryFixture, MemoryFixtureOptions } from "./fixtures/memory";
import { MEMORY_TEST_IDS as IDS } from "../src/screens/memory/model";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/memory/", import.meta.url));
const README = join(EVIDENCE_DIR, "README.md");
const THEMES = ["light", "dark"] as const;
/** The mockup's eight Memory states (`memory-<state>`), as the file names have them. */
const STATES = ["empty", "loading", "populated", "file", "edit", "conflict", "error", "unreachable"] as const;
const DATA_DIR = "/fixture/studio-data";

/** When this run began, for the guard that the tracked evidence dir is untouched without `MEMORY_EVIDENCE`. */
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
const fileButton = (page: Page, path: string): Locator => page.locator(`[data-testid="${IDS.fileButton}"][data-path="${path}"]`);

/** Launch the built app on a fixture kernel serving `fx`, and open Memory by its hash. */
async function open(fx: MemoryFixture): Promise<Page> {
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  app = await launchApp(fixture.env);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/memory";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  return page;
}

/** `open` for a fixture made from `options`, once the tree is up. */
async function openPopulated(options: MemoryFixtureOptions = {}): Promise<{ readonly fx: MemoryFixture; readonly page: Page }> {
  const fx = memoryFixture(options);
  const page = await open(fx);
  await expect(byId(page, IDS.tree)).toBeVisible();
  return { fx, page };
}

async function openFile(page: Page, path: string): Promise<void> {
  await fileButton(page, path).click();
  await expect(byId(page, IDS.contents)).toBeVisible();
}

/** The editor on `path`, with `text` typed in. */
async function editWith(page: Page, path: string, text?: string): Promise<void> {
  await openFile(page, path);
  await byId(page, IDS.edit).click();
  await expect(byId(page, IDS.textarea)).toBeFocused();
  if (text !== undefined) await byId(page, IDS.textarea).fill(text);
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

/** `memory-<state>-light.png` and `-dark.png` of the whole window; the dark tokens must really apply. */
async function screenshots(page: Page, state: (typeof STATES)[number], testInfo: TestInfo): Promise<void> {
  const evidence = process.env.MEMORY_EVIDENCE === "1";
  if (evidence) mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const file = `memory-${state}-${theme}.png`;
    const path = evidence ? join(EVIDENCE_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
  }
  expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);
  await setTheme(page, undefined);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

/** Each element's text with `id`, in document order. */
async function texts(page: Page, id: string): Promise<string[]> {
  return (await byId(page, id).allTextContents()).map((t) => t.trim());
}

type Box = { x: number; y: number; width: number; height: number } | null;

/** Each file button's path and bounding box, in document order. */
async function rowBoxes(page: Page): Promise<{ path: string | null; box: Box }[]> {
  return Promise.all((await byId(page, IDS.fileButton).all()).map(async (el) => ({ path: await el.getAttribute("data-path"), box: await el.boundingBox() })));
}

/** Presses Tab until `target` has focus (at most `max` presses). */
async function tabTo(page: Page, target: Locator, max = 12): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

const bannerLocator = (page: Page): Locator => page.locator('[data-testid="kernel-unreachable-band"], [data-testid="kernel-reconnecting-band"]').first();

// ---- AC6: the tree and the paths -----------------------------------------------------------------------------------------

test("AC6: the tree lists every agent's files and the shared files under their folder with sizes, the memory root is above it, and the overview reads 'Pick a file'", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  const nav = page.getByRole("navigation", { name: "Memory files" });
  await expect(nav).toBeVisible();
  expect(await texts(page, IDS.folder)).toEqual(["Wrightwright/", "Adaada/", "Masonmason/", "Sharedshared/"]);
  const paths = await byId(page, IDS.fileButton).evaluateAll((els) => els.map((el) => el.getAttribute("data-path")));
  expect(paths).toEqual([
    "wright/role.md", "wright/preferences.md", "wright/people.md", "wright/lessons.md",
    "ada/role.md", "ada/preferences.md", "ada/people.md", "ada/lessons.md",
    "mason/role.md", "mason/preferences.md", "mason/people.md", "mason/lessons.md",
    "shared/README.md", "shared/about-me.md",
  ]);
  for (const path of paths as string[]) {
    const bytes = Buffer.byteLength(fx.contentOf(path) as string);
    await expect(fileButton(page, path).locator(".memory-file-size")).toHaveText(bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
  }
  // The root comes from GET /settings: the fixture's canned data dir.
  await expect(byId(page, IDS.root)).toHaveText(`${DATA_DIR}/memory/`);
  await expect(byId(page, IDS.overview).getByRole("heading", { level: 2 })).toHaveText("Pick a file");
  await expect(byId(page, IDS.subtitle)).toHaveText("14 files");
  // The shell draws the one heading; the screen's own are h2 and below.
  expect(await page.locator("h1").allTextContents()).toEqual(["Memory"]);
  await expect(page.getByRole("button", { name: /^Memory/ })).toHaveAttribute("aria-current", "page");
  await screenshots(page, "populated", testInfo);
});

test("AC6: opening a file shows its full path, size, modified time, version and its text in a focusable <pre>", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  await openFile(page, LESSONS_PATH);
  await expect(byId(page, IDS.filePath)).toHaveText(`${DATA_DIR}/memory/${LESSONS_PATH}`);
  await expect(byId(page, IDS.fileSize)).toHaveText(`${Buffer.byteLength(LESSONS_BASE)} B`);
  await expect(byId(page, IDS.fileModified)).toHaveText(/^today \d\d:\d\d$/);
  await expect(byId(page, IDS.fileVersion)).toHaveText(hashOf(LESSONS_BASE).slice(0, 8));
  const pre = byId(page, IDS.contents);
  expect(await pre.evaluate((el) => el.tagName)).toBe("PRE");
  await expect(pre).toHaveAttribute("tabindex", "0");
  await expect(pre).toHaveText(LESSONS_BASE);
  await expect(fileButton(page, LESSONS_PATH)).toHaveAttribute("aria-current", "true");
  expect(fx.fileReads).toEqual([LESSONS_PATH]);
  await screenshots(page, "file", testInfo);
});

test("the empty state: 'Nothing remembered yet.' with the note and one action, Ask Wright, never an empty tree", async ({}, testInfo) => {
  const fx = memoryFixture({ state: "empty" });
  const page = await open(fx);
  const empty = byId(page, IDS.empty);
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("heading", { level: 2 })).toHaveText("Nothing remembered yet.");
  await expect(empty).toContainText("Nothing here is hidden in a database.");
  await expect(empty.getByRole("button")).toHaveCount(1);
  await expect(byId(page, IDS.tree)).toHaveCount(0);
  await screenshots(page, "empty", testInfo);
  await empty.getByRole("button", { name: "Ask Wright" }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/chat");
});

test("the loading state: skeleton rows until the tree answers, then the tree", async ({}, testInfo) => {
  const fx = memoryFixture();
  fx.holdTree();
  const page = await open(fx);
  const loading = byId(page, IDS.loading);
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading.locator(".memory-skel")).toHaveCount(5);
  await screenshots(page, "loading", testInfo);
  fx.releaseTree();
  await expect(byId(page, IDS.tree)).toBeVisible();
  await expect(loading).toHaveCount(0);
});

test("the error state: a route-failure card that names the request and its status, apart from the kernel band; Try again recovers", async ({}, testInfo) => {
  const fx = memoryFixture();
  fx.failTree(true);
  const page = await open(fx);
  const card = byId(page, IDS.error);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("role", "alert");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Couldn't load memory");
  await expect(byId(page, IDS.errorDetail)).toHaveText("GET /memory · 500 · store_unreadable");
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
  await expect(page.getByTestId("kernel-reconnecting-band")).toHaveCount(0);
  await screenshots(page, "error", testInfo);
  fx.failTree(false);
  await byId(page, IDS.retry).click();
  await expect(byId(page, IDS.tree)).toBeVisible();
  await expect(card).toHaveCount(0);
});

// ---- AC7 and AC8: edit, save and the conflict -------------------------------------------------------------------------------

test("AC7: Edit shows a textarea and the Changes inspector; Save sends the opened hash as base_hash, returns to the file view with the new version, a toast and the new size; Cancel discards", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  await openFile(page, LESSONS_PATH);
  await byId(page, IDS.edit).click();
  const area = byId(page, IDS.textarea);
  await expect(area).toBeFocused();
  await expect(area).toHaveValue(LESSONS_BASE);
  const changes = page.getByRole("complementary", { name: "Changes" });
  await expect(changes).toContainText("Nothing changed. Edit the text to see it here.");
  await expect(byId(page, IDS.save)).toBeDisabled();
  await area.fill(LESSONS_MINE);
  await expect(byId(page, IDS.save)).toBeEnabled();
  await expect(changes.locator('[data-line="add"]')).toHaveCount(1);
  await expect(changes.locator('[data-line="add"]')).toContainText(LESSONS_MINE_LINE);
  await expect(changes).toContainText("Saving checks that nobody wrote to the file since you opened it.");
  await screenshots(page, "edit", testInfo);

  // Cancel discards.
  await byId(page, IDS.cancel).click();
  await expect(byId(page, IDS.contents)).toHaveText(LESSONS_BASE);
  expect(fx.puts).toEqual([]);

  await byId(page, IDS.edit).click();
  await byId(page, IDS.textarea).fill(LESSONS_MINE);
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.fileView)).toBeVisible();
  expect(fx.puts).toEqual([{ path: LESSONS_PATH, content: LESSONS_MINE, base_hash: hashOf(LESSONS_BASE) }]);
  await expect(byId(page, IDS.fileVersion)).toHaveText(hashOf(LESSONS_MINE).slice(0, 8));
  await expect(byId(page, IDS.contents)).toHaveText(LESSONS_MINE);
  await expect(page.locator(".toast-text")).toHaveText(`Saved memory/${LESSONS_PATH}. Version ${hashOf(LESSONS_MINE).slice(0, 8)}.`);
  // The kernel's memory_updated event and the screen's own read: the tree shows the new size.
  await expect(fileButton(page, LESSONS_PATH).locator(".memory-file-size")).toHaveText(`${Buffer.byteLength(LESSONS_MINE)} B`);
  await expect(byId(page, IDS.edit)).toBeFocused();
});

test("AC8: an agent's write after the file was opened makes a save a conflict: both versions are shown, nothing was overwritten, and the owner's edit survives every way out", async ({}, testInfo) => {
  const { fx, page } = await openPopulated();
  await editWith(page, LESSONS_PATH, LESSONS_MINE);
  // An agent writes during a session: the kernel records no event for it.
  fx.agentWrites(LESSONS_PATH, LESSONS_AGENT);
  await byId(page, IDS.save).click();

  const band = byId(page, IDS.conflictBand);
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("role", "alert");
  await expect(band).toHaveText(`${LESSONS_PATH} changed since you opened it. Your save was refused, nothing was overwritten and nothing of yours is lost.`);
  await expect(byId(page, IDS.onDisk)).toHaveText(LESSONS_AGENT);
  await expect(byId(page, IDS.mine)).toHaveText(LESSONS_MINE);
  const diff = page.getByRole("region", { name: `Diff of ${LESSONS_PATH}` });
  await expect(diff.locator('[data-line="del"]')).toContainText(LESSONS_AGENT_LINE);
  await expect(diff.locator('[data-line="add"]')).toContainText(LESSONS_MINE_LINE);
  expect(fx.contentOf(LESSONS_PATH), "nothing was overwritten").toBe(LESSONS_AGENT);
  expect(fx.puts).toHaveLength(1);
  await screenshots(page, "conflict", testInfo);

  // Back to editing: the draft is still there.
  await byId(page, IDS.backToEditing).click();
  await expect(byId(page, IDS.textarea)).toHaveValue(LESSONS_MINE);
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.conflict)).toBeVisible();

  // Edit on top of the current version: the disk's text plus the lines the owner added, based on the disk's version.
  await byId(page, IDS.onTop).click();
  const area = byId(page, IDS.textarea);
  await expect(area).toHaveValue(`${LESSONS_AGENT}\n${LESSONS_MINE_LINE}`);
  await expect(area).toBeFocused();
  await expect(byId(page, IDS.editor)).toContainText(`opened at version ${hashOf(LESSONS_AGENT).slice(0, 8)}`);
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.fileView)).toBeVisible();
  expect(fx.puts.at(-1)).toEqual({ path: LESSONS_PATH, content: `${LESSONS_AGENT}\n${LESSONS_MINE_LINE}`, base_hash: hashOf(LESSONS_AGENT) });
  expect(fx.contentOf(LESSONS_PATH)).toBe(`${LESSONS_AGENT}\n${LESSONS_MINE_LINE}`);
});

test("AC8: Discard my edit shows the text on disk, and Copy my version puts the draft on the clipboard", async () => {
  const { fx, page } = await openPopulated();
  await app?.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await editWith(page, LESSONS_PATH, LESSONS_MINE);
  fx.agentWrites(LESSONS_PATH, LESSONS_AGENT);
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.conflict)).toBeVisible();

  await byId(page, IDS.copy).click();
  await expect(byId(page, IDS.live)).toHaveText(/^(Copied your version to the clipboard\.|Could not copy\.)/);
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (copied !== null) expect(copied).toBe(LESSONS_MINE);

  await byId(page, IDS.discard).click();
  await expect(byId(page, IDS.fileView)).toBeVisible();
  await expect(byId(page, IDS.contents)).toHaveText(LESSONS_AGENT);
  await expect(byId(page, IDS.fileVersion)).toHaveText(hashOf(LESSONS_AGENT).slice(0, 8));
  expect(fx.contentOf(LESSONS_PATH)).toBe(LESSONS_AGENT);
});

test("AC8: a refusal other than a conflict (a 400, the 404, the API server's 413) keeps the draft and says it was not saved, naming the code", async () => {
  const { fx, page } = await openPopulated();
  await editWith(page, LESSONS_PATH, LESSONS_MINE);
  for (const [status, code] of [
    [400, "not_markdown"],
    [404, "not_found"],
    [413, "body_too_large"],
  ] as const) {
    fx.refuse({ status, code });
    await byId(page, IDS.save).click();
    await expect(byId(page, IDS.saveError)).toHaveText(`Not saved: the kernel refused it (${status} · ${code}). Your edit is kept here.`);
    await expect(byId(page, IDS.saveError)).toHaveAttribute("role", "alert");
    await expect(byId(page, IDS.textarea)).toHaveValue(LESSONS_MINE);
    await expect(byId(page, IDS.conflict)).toHaveCount(0);
  }
  expect(fx.puts).toHaveLength(3);
  expect(fx.contentOf(LESSONS_PATH)).toBe(LESSONS_BASE);
  // Once the kernel accepts it again the same draft saves.
  fx.refuse(undefined);
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.fileView)).toBeVisible();
  expect(fx.contentOf(LESSONS_PATH)).toBe(LESSONS_MINE);
});

test("AC8: a save that gets no answer keeps the draft and says so", async () => {
  const { fx, page } = await openPopulated();
  await editWith(page, LESSONS_PATH, LESSONS_MINE);
  fx.holdWrites(true);
  await byId(page, IDS.save).click();
  await expect.poll(() => fx.puts.length).toBe(1);
  // The kernel goes away with the save open: the main process reports no answer.
  await fixture?.close();
  await expect(byId(page, IDS.saveError)).toContainText("Not saved: the kernel did not answer", { timeout: 20_000 });
  await expect(byId(page, IDS.textarea)).toHaveValue(LESSONS_MINE);
});

// ---- AC9: the kernel unreachable ----------------------------------------------------------------------------------------------

test("AC9: when the kernel goes away the shared band shows, the screen keeps its last data marked last known, Edit is disabled and nothing throws", async ({}, testInfo) => {
  const { page } = await openPopulated();
  const paths = await byId(page, IDS.fileButton).evaluateAll((els) => els.map((el) => el.getAttribute("data-path")));
  await openFile(page, LESSONS_PATH);
  await page.keyboard.press("Escape");
  await expect(byId(page, IDS.overview)).toBeVisible();
  await fixture?.close();
  await expect(bannerLocator(page)).toBeVisible({ timeout: 20_000 });
  await expect(byId(page, IDS.subtitle)).toHaveText("14 files · last known");
  expect(await byId(page, IDS.fileButton).evaluateAll((els) => els.map((el) => el.getAttribute("data-path"))), "the tree is the last read").toEqual(paths);
  await expect(byId(page, IDS.empty)).toHaveCount(0);
  await expect(byId(page, IDS.error)).toHaveCount(0);
  await expect(fileButton(page, LESSONS_PATH)).toHaveAttribute("aria-disabled", "true");
  await screenshots(page, "unreachable", testInfo);
});

test("AC9: the editor and the conflict view keep the draft through an outage, with Save and the conflict's actions disabled", async () => {
  const { fx, page } = await openPopulated();
  await editWith(page, LESSONS_PATH, LESSONS_MINE);
  fx.agentWrites(LESSONS_PATH, LESSONS_AGENT);
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.conflict)).toBeVisible();
  await fixture?.close();
  await expect(bannerLocator(page)).toBeVisible({ timeout: 20_000 });
  await expect(byId(page, IDS.subtitle)).toContainText("last known");
  await expect(byId(page, IDS.mine)).toHaveText(LESSONS_MINE);
  await expect(byId(page, IDS.onDisk)).toHaveText(LESSONS_AGENT);
  for (const id of [IDS.discard, IDS.copy, IDS.onTop]) await expect(byId(page, id)).toBeDisabled();
  await expect(byId(page, IDS.empty)).toHaveCount(0);
  // Back to the editor: the text is there and Save is off.
  await byId(page, IDS.backToEditing).click();
  await expect(byId(page, IDS.textarea)).toHaveValue(LESSONS_MINE);
  await expect(byId(page, IDS.save)).toBeDisabled();
});

// ---- AC10: the keyboard ---------------------------------------------------------------------------------------------------------

test("AC10: J and K and the arrows move between files, Enter opens one, Esc returns to the tree with focus on that file, Tab reaches Edit, the textarea, Cancel and Save", async () => {
  const { page } = await openPopulated();
  // The tab stop is the first file; J and K and the arrows move from it.
  await fileButton(page, "wright/role.md").focus();
  await page.keyboard.press("j");
  await expect(fileButton(page, "wright/preferences.md")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(fileButton(page, "wright/people.md")).toBeFocused();
  await page.keyboard.press("k");
  await expect(fileButton(page, "wright/preferences.md")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(fileButton(page, "wright/role.md")).toBeFocused();

  // Enter opens the focused file.
  await fileButton(page, "mason/preferences.md").focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.fileTitle)).toHaveText("preferences.md");
  // Esc returns to the tree with focus on that file's button.
  await page.keyboard.press("Escape");
  await expect(byId(page, IDS.overview)).toBeVisible();
  await expect(fileButton(page, "mason/preferences.md")).toBeFocused();

  // Tab reaches Edit from the tree, then the textarea, Cancel and Save.
  await fileButton(page, LESSONS_PATH).focus();
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.contents)).toBeVisible();
  await tabTo(page, byId(page, IDS.edit));
  await page.keyboard.press("Enter");
  await expect(byId(page, IDS.textarea)).toBeFocused();
  await page.keyboard.type(`\n${LESSONS_MINE_LINE}`);
  await tabTo(page, byId(page, IDS.cancel));
  await page.keyboard.press("Tab");
  await expect(byId(page, IDS.save)).toBeFocused();
  // Esc from a changed editor keeps its text; from an unchanged one it returns to the file view.
  await byId(page, IDS.textarea).focus();
  await page.keyboard.press("Escape");
  await expect(byId(page, IDS.editor)).toBeVisible();
  await byId(page, IDS.textarea).fill(LESSONS_BASE);
  await page.keyboard.press("Escape");
  await expect(byId(page, IDS.fileView)).toBeVisible();
  await expect(byId(page, IDS.edit)).toBeFocused();
});

test("AC10: Tab reaches every conflict action", async () => {
  const { fx, page } = await openPopulated();
  await editWith(page, LESSONS_PATH, LESSONS_MINE);
  fx.agentWrites(LESSONS_PATH, LESSONS_AGENT);
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.conflict)).toBeVisible();
  for (const id of [IDS.backToEditing, IDS.discard, IDS.copy, IDS.onTop]) await tabTo(page, byId(page, id), 20);
  await expect(byId(page, IDS.onTop)).toBeFocused();
});

// ---- AC11: live updates -----------------------------------------------------------------------------------------------------------

test("AC11: a memory_updated and a session_status event update the tree with no reload, no loading state, and no row already shown moving", async () => {
  const { fx, page } = await openPopulated();
  await settle(page);
  // A marker (a reload would drop it) and a watcher for the skeleton (a flash would set it).
  await page.evaluate((loading) => {
    const w = window as unknown as { __marker?: string; __loadingSeen?: boolean };
    w.__marker = "same-window";
    w.__loadingSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(`[data-testid="${loading}"]`) !== null) w.__loadingSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, IDS.loading);
  const before = { rows: await rowBoxes(page), folders: await byId(page, IDS.folder).evaluateAll((els) => els.map((el) => JSON.stringify(el.getBoundingClientRect()))) };
  expect(before.rows, "fourteen rows have a box").toHaveLength(14);
  expect(before.rows.every((r) => r.box !== null)).toBe(true);
  const readsBefore = fx.treeReads();

  // An agent writes its lesson (no event), its session ends (an event): the size changes. A new shared file appears.
  fx.agentWrites("wright/lessons.md", `${fx.contentOf("wright/lessons.md")}\n- Quote the line.`);
  fx.sessionEnds();
  fx.addFile("shared/team-notes.md", "# Team notes\n");
  await expect(byId(page, IDS.fileButton)).toHaveCount(15);
  await expect(byId(page, IDS.subtitle)).toHaveText("15 files");
  await expect(fileButton(page, "wright/lessons.md").locator(".memory-file-size")).toHaveText(`${Buffer.byteLength(fx.contentOf("wright/lessons.md") as string)} B`);
  await settle(page);
  expect(fx.treeReads(), "the events made the screen read GET /memory again").toBeGreaterThan(readsBefore);

  const after = await rowBoxes(page);
  expect(after.slice(0, 14), "the rows already shown did not move or resize, and kept their order").toEqual(before.rows);
  expect(await byId(page, IDS.folder).evaluateAll((els) => els.slice(0, 4).map((el) => JSON.stringify(el.getBoundingClientRect()))), "the folder headers did not move").toEqual(before.folders);
  const seen = await page.evaluate(() => ({ marker: (window as unknown as { __marker?: string }).__marker, loading: (window as unknown as { __loadingSeen?: boolean }).__loadingSeen }));
  expect(seen.marker, "the window was not reloaded").toBe("same-window");
  expect(seen.loading, "the screen never flashed a loading state").toBe(false);
});

test("AC11: a file view that is not being edited reads its file again; an editor's draft is never replaced", async () => {
  const { fx, page } = await openPopulated();
  await openFile(page, LESSONS_PATH);
  fx.touch(LESSONS_PATH, LESSONS_AGENT);
  await expect(byId(page, IDS.contents)).toHaveText(LESSONS_AGENT);
  await expect(byId(page, IDS.fileVersion)).toHaveText(hashOf(LESSONS_AGENT).slice(0, 8));

  await byId(page, IDS.edit).click();
  await byId(page, IDS.textarea).fill(`${LESSONS_AGENT}\nmy line`);
  const reads = fx.fileReads.length;
  fx.touch(LESSONS_PATH, `${LESSONS_AGENT}\n- written again`);
  fx.sessionEnds();
  await expect.poll(() => fx.treeReads()).toBeGreaterThan(1);
  await settle(page);
  await expect(byId(page, IDS.textarea)).toHaveValue(`${LESSONS_AGENT}\nmy line`);
  expect(fx.fileReads, "the editor's file is not read again").toHaveLength(reads);
  // The save is still checked against the version the owner opened.
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.conflict)).toBeVisible();
});

// ---- AC12: names, and tokens only ------------------------------------------------------------------------------------------------------

test("AC12: the tree is a nav, each file button is named '<path>, <size>, modified <time>', the textarea and every <pre> are labelled and the conflict band is an alert", async () => {
  const { fx, page } = await openPopulated();
  await expect(page.getByRole("navigation", { name: "Memory files" })).toBeVisible();
  for (const button of await byId(page, IDS.fileButton).all()) {
    const path = (await button.getAttribute("data-path")) as string;
    const bytes = Buffer.byteLength(fx.contentOf(path) as string);
    await expect(button).toHaveAccessibleName(new RegExp(`^${path.replace(/[.]/g, "\\.")}, ${bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`}, modified (today \\d\\d:\\d\\d|\\w{3} \\d{1,2} \\w{3})$`));
  }
  await expect(byId(page, IDS.live)).toHaveAttribute("aria-live", "polite");
  await openFile(page, LESSONS_PATH);
  await expect(page.getByLabel(`Contents of ${LESSONS_PATH}`)).toHaveJSProperty("tagName", "PRE");
  await byId(page, IDS.edit).click();
  await expect(page.getByLabel(`Contents of ${LESSONS_PATH}`)).toHaveJSProperty("tagName", "TEXTAREA");
  await byId(page, IDS.textarea).fill(LESSONS_MINE);
  fx.agentWrites(LESSONS_PATH, LESSONS_AGENT);
  await byId(page, IDS.save).click();
  await expect(byId(page, IDS.conflict)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "changed since you opened it" })).toBeVisible();
  for (const pre of await byId(page, IDS.conflict).locator("pre").all()) await expect(pre).toHaveAttribute("aria-label", /\S/);
  for (const button of await byId(page, IDS.screen).getByRole("button").all()) if (await button.isVisible()) await expect(button).toHaveAccessibleName(/\S/);
});

test("AC12: a file's text with markup in it is shown as text, never as an element", async () => {
  const hostile = '# Notes\n<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script>\n';
  const { fx, page } = await openPopulated();
  fx.agentWrites("shared/README.md", hostile);
  await openFile(page, "shared/README.md");
  await expect(byId(page, IDS.contents)).toHaveText(hostile);
  expect(await byId(page, IDS.contents).locator("img, script").count()).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
});

test("AC12: the screen's stylesheet takes every colour from the design tokens", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/screens/memory/memory.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "no hex colour").toEqual([]);
  expect(css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|color-mix)\(/g) ?? [], "no colour function").toEqual([]);
});

// ---- AC13: the evidence ---------------------------------------------------------------------------------------------------------------------

test("AC13: without MEMORY_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", async () => {
  test.skip(process.env.MEMORY_EVIDENCE === "1", "an evidence run writes the tracked dir on purpose");
  let files: string[] = [];
  try {
    files = readdirSync(EVIDENCE_DIR);
  } catch {
    // No committed evidence dir at all: nothing could have been written to it.
  }
  const touched = files.filter((name) => statSync(join(EVIDENCE_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-7-polish/memory/ is newer than this run's start").toEqual([]);
});

test("AC13: the evidence README lists exactly the 16 screenshots, each against its mockup view, and the folder holds nothing else", () => {
  const readme = readFileSync(README, "utf8");
  const expected = STATES.flatMap((state) => THEMES.map((theme) => `memory-${state}-${theme}.png`)).sort();
  expect(expected).toHaveLength(16);
  for (const file of expected) expect(readme, `the README links ${file}`).toContain(`(${file})`);
  const linked = [...readme.matchAll(/\(([\w-]+\.png)\)/g)].map((m) => m[1] as string);
  expect([...new Set(linked)].sort(), "the README links exactly the 16 files").toEqual(expected);
  expect(readdirSync(EVIDENCE_DIR).sort(), "the folder holds the README and the 16 screenshots, nothing else").toEqual(["README.md", ...expected].sort());
  expect(readme).toContain("MEMORY_EVIDENCE=1");
  for (const state of STATES) expect(readme, `the README names the mockup view memory-${state}`).toContain(`memory-${state}`);
});
