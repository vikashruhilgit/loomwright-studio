// The window's keys in the built app against the composed fixture kernel (`./fixtures/phase-7-exit.ts`), phase 7
// item 13: the ⌘1 to ⌘9 and ⌘, screen shortcuts (AC1), the ⌘K palette and `/` (AC2), text fields keeping their keys
// (AC3), the Keyboard map opened by `?` and from the palette (AC4), J / K / Enter / Esc on Tasks, Playbooks and
// Memory (AC5), the one owner of each chord (AC7) and the kill confirm holding every key behind it (AC7b).
//
// Playwright dispatches keys to the page itself, so the application menu never sees them: AC7 reads
// `Menu.getApplicationMenu()` in the main process instead, which is where a competing accelerator would live.
// Every launch goes through `launchApp` (`e2e/electron-harness.ts`), so every window is hidden: the keys reach the
// page with the page's focus (Playwright's focus emulation, `document.hasFocus()`), not with the operating system's
// foreground window, which the harness never takes.
//
// Screenshots (AC8): with `KEYBOARD_EVIDENCE=1` the Keyboard map and the palette over Tasks, in light and dark, are
// written to the committed `docs/evidence/phase-7-polish/keyboard/`; otherwise to Playwright's per-test output dir,
// so CI never dirties tracked files, and a test asserts nothing under the tracked dir changed during the run and
// that the evidence README names every file. The spec asserts behaviour, never pixels: fonts differ between macOS
// and CI. Run `npm run build` first.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import type { Menu } from "electron";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { LESSONS_PATH } from "./fixtures/memory";
import { phase7ExitFixture } from "./fixtures/phase-7-exit";
import { BUDGET_TEST_IDS as BUDGET } from "../src/screens/budget/model";
import { MEMORY_TEST_IDS as MEMORY } from "../src/screens/memory/model";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/keyboard/", import.meta.url));
const README = join(EVIDENCE_DIR, "README.md");
const THEMES = ["light", "dark"] as const;
/** The mockup's views the shots are taken of (`gui-v2.html`), as the file names have them. */
const VIEWS = ["keymap", "tasks-populated-palette"] as const;
/** When this run began, for the guard that the tracked evidence dir is untouched without `KEYBOARD_EVIDENCE`. */
const RUN_START = Date.now();

/** The Keyboard map's test ids (`KEYMAP_TEST_IDS` in `src/screens/keymap/KeymapScreen.tsx`, which is a `.tsx` this project cannot type-check). */
const KEYMAP = { screen: "screen-keymap", back: "keymap-back", screens: "keymap-screens", anywhere: "keymap-anywhere", commands: "keymap-commands" } as const;
const KILL_CONFIRM_TITLE = "Engage the kill switch?";

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
let prefsDir: string | undefined;
const pageErrors: string[] = [];

test.afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  await fixture?.close().catch(() => undefined);
  fixture = undefined;
  if (prefsDir !== undefined) rmSync(prefsDir, { recursive: true, force: true });
  prefsDir = undefined;
  // Drained per test, so an error is reported against the test that caused it.
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

const byId = (page: Page, id: string): Locator => page.getByTestId(id);
const paletteOf = (page: Page): Locator => page.getByTestId("command-palette");
const paletteInput = (page: Page): Locator => page.getByRole("textbox", { name: "Command" });
const titleOf = (page: Page): Locator => page.locator("header h1.titlebar-title");
const hashOf = (page: Page): Promise<string> => page.evaluate(() => window.location.hash);

/** Launch the built app on the composed fixture kernel (Chat first), with a throwaway prefs dir and the fake OS. */
async function launch(): Promise<Page> {
  const exit = phase7ExitFixture();
  fixture = await startFixtureKernel({ routes: exit.routes });
  exit.attach(fixture);
  prefsDir = mkdtempSync(join(tmpdir(), "studio-app-prefs-"));
  app = await launchApp({ ...fixture.env, STUDIO_APP_PREFS_DIR: prefsDir, STUDIO_APP_FAKE_OS: "1" });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect(byId(page, "screen-chat")).toBeVisible();
  // The page has Playwright's focus: the keys below reach it as they would reach a focused window.
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  return page;
}

/** Opens a screen by its hash (for the screens with no key, and to set a scene up). */
async function openByHash(page: Page, id: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, `#/${id}`);
  await expect(byId(page, `screen-${id}`)).toBeVisible();
}

/** From now on, record every `hashchange` (the hash it landed on) in `window.__hashes`. */
async function recordHashes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __hashes?: string[] };
    w.__hashes = [];
    window.addEventListener("hashchange", () => w.__hashes?.push(window.location.hash));
  });
}
const hashes = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __hashes?: string[] }).__hashes ?? []);

// ---- AC1: the screen shortcuts ------------------------------------------------------------------------------------------------

/** The sidebar's labels, as the mockup has them: Chat ⌘1 … Memory ⌘9, Settings ⌘, (Budget & audit has none). */
const SCREEN_KEYS = [
  ["1", "chat", "Chat"],
  ["2", "team", "Team"],
  ["3", "approvals", "Approvals"],
  ["4", "sessions", "Sessions"],
  ["5", "integrations", "Integrations"],
  ["6", "tasks", "Tasks"],
  ["7", "playbooks", "Playbooks"],
  ["8", "schedules", "Schedules & triggers"],
  ["9", "memory", "Memory"],
  [",", "settings", "Settings"],
] as const;

test("AC1: ⌘1 to ⌘9 and ⌘, open the screen the sidebar labels, one navigation per press", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await recordHashes(page);
  const sidebar = byId(page, "sidebar");
  for (const [index, [key, id, label]] of SCREEN_KEYS.entries()) {
    // The sidebar's own label shows the key it promises.
    await expect(sidebar.getByRole("button", { name: label, exact: true }).locator(".nav-key")).toHaveText(`⌘${key}`);
    await page.keyboard.press(`Meta+${key}`);
    await expect(byId(page, `screen-${id}`), `⌘${key} opens ${label}`).toBeVisible();
    await expect(titleOf(page)).toHaveText(label);
    await expect(sidebar.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    // The hash changed once for this press (the event lands a moment after the screen shows).
    await expect.poll(() => hashes(page), { message: `after ⌘${key}` }).toHaveLength(index + 1);
  }
  expect(await hashes(page)).toEqual(SCREEN_KEYS.map(([, id]) => `#/${id}`));
  // Budget & audit has no key: ⌘0 and ⌘10's first digit open nothing new.
  await page.keyboard.press("Meta+0");
  expect(await hashOf(page)).toBe("#/settings");
});

// ---- AC2: the palette ----------------------------------------------------------------------------------------------------------

test("AC2: ⌘K opens the palette with the Screens group and the current screen's own commands; typing filters, Enter runs the selection, Esc closes with focus back", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await openByHash(page, "budget");
  await expect(byId(page, BUDGET.dayTable)).toBeVisible();
  const audit = byId(page, BUDGET.auditButton);
  await audit.focus();

  await page.keyboard.press("Meta+k");
  await expect(paletteOf(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  // The Screens group lists every sidebar screen; the current screen's commands are there beside the shell's.
  const groups = await paletteOf(page).locator(".cp-group").allTextContents();
  expect(groups).toContain("Screens");
  expect(groups).toContain("Budget & audit");
  const titles = await paletteOf(page).locator(".cp-row .cp-label").allTextContents();
  // A group shows its first eight rows and a "Show all" row, so the last Screens entries are behind it.
  expect(titles).toEqual(expect.arrayContaining(["Chat", "Tasks", "Open the audit log", "Keyboard map"]));

  // Esc closes it and focus is back on the control that had it.
  await page.keyboard.press("Escape");
  await expect(paletteOf(page)).toHaveCount(0);
  await expect(audit).toBeFocused();

  // Typing filters; Enter runs the selected command (the audit log opens).
  await page.keyboard.press("Meta+k");
  await expect(paletteInput(page)).toBeFocused();
  await page.keyboard.type("audit");
  const rows = paletteOf(page).locator(".cp-row");
  expect(await rows.count()).toBeLessThan(titles.length);
  await expect(paletteOf(page).locator(".cp-row .cp-label", { hasText: "Open the audit log" })).toHaveCount(1);
  // The selected row is the best match: a title that starts with the whole query.
  await paletteInput(page).fill("Open the audit");
  await expect(rows.first()).toHaveText(/Open the audit log/);
  await expect(paletteOf(page).locator('.cp-row[aria-selected="true"] .cp-label')).toHaveText("Open the audit log");
  await page.keyboard.press("Enter");
  await expect(paletteOf(page)).toHaveCount(0);
  await expect(byId(page, BUDGET.table)).toBeVisible();

  // A Screens command navigates too.
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("Team");
  await page.keyboard.press("Enter");
  await expect(byId(page, "screen-team")).toBeVisible();
  expect(await hashOf(page)).toBe("#/team");
});

test("AC2: / outside a text field opens the palette, types nothing into it, and Esc closes it", async () => {
  const page = await launch();
  await openByHash(page, "tasks");
  await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
  await page.keyboard.press("/");
  await expect(paletteOf(page)).toBeVisible();
  await expect(paletteInput(page)).toBeFocused();
  await expect(paletteInput(page)).toHaveValue("");
  // With the palette open, `/` is a character in its input.
  await page.keyboard.type("a/b");
  await expect(paletteInput(page)).toHaveValue("a/b");
  await page.keyboard.press("Escape");
  await expect(paletteInput(page)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(paletteOf(page)).toHaveCount(0);
  expect(await hashOf(page)).toBe("#/tasks");
});

// ---- AC3: text fields keep their keys ----------------------------------------------------------------------------------------------

test("AC3: J, K, / and ? typed into the Chat composer and the Memory edit textarea are typed, and nothing navigates or opens", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await recordHashes(page);
  const typed = "jk/?J";

  const composer = page.getByRole("textbox", { name: "Message Wright" });
  await composer.click();
  await page.keyboard.type(typed);
  await expect(composer).toHaveValue(typed);
  await expect(paletteOf(page)).toHaveCount(0);
  await expect(byId(page, "screen-chat")).toBeVisible();

  await page.keyboard.press("Meta+9");
  await expect(byId(page, MEMORY.tree)).toBeVisible();
  await page.locator(`[data-testid="${MEMORY.fileButton}"][data-path="${LESSONS_PATH}"]`).click();
  await expect(byId(page, MEMORY.contents)).toBeVisible();
  await byId(page, MEMORY.edit).click();
  const textarea = byId(page, MEMORY.textarea);
  await expect(textarea).toBeFocused();
  const before = await textarea.inputValue();
  await page.keyboard.type(typed);
  // The characters went into the text (at the caret), and the file's own text is all still there.
  await expect.poll(() => textarea.inputValue()).toHaveLength(before.length + typed.length);
  const after = await textarea.inputValue();
  expect(after.replace(typed, "")).toBe(before);
  await expect(paletteOf(page)).toHaveCount(0);
  await expect(byId(page, MEMORY.editor)).toBeVisible();
  // The only navigation was the ⌘9 above.
  expect(await hashes(page)).toEqual(["#/memory"]);
});

// ---- AC4: the Keyboard map ----------------------------------------------------------------------------------------------------------

/** The cells of a keymap table's body rows. */
async function tableRows(page: Page, id: string): Promise<string[][]> {
  return byId(page, id)
    .locator("tbody tr")
    .evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())));
}

test("AC4: ? opens the Keyboard map from Tasks, its three tables match the keys, and Back returns to Tasks", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await recordHashes(page);
  await page.keyboard.press("Meta+6");
  await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");

  await page.keyboard.press("?");
  await expect(byId(page, KEYMAP.screen)).toBeVisible();
  // One navigation for one press, to the map; the title bar says what the screen is.
  expect(await hashes(page)).toEqual(["#/tasks", "#/keymap"]);
  await expect(titleOf(page)).toHaveText("Keyboard map");
  await expect(byId(page, "titlebar-subtitle")).toHaveText("every shortcut and palette command");
  await expect(byId(page, KEYMAP.back)).toBeFocused();
  // It is no sidebar entry: eleven buttons, none current.
  const nav = byId(page, "sidebar").getByRole("navigation", { name: "Screens" });
  await expect(nav.getByRole("button")).toHaveCount(11);
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);

  // "Go to a screen": the sidebar's own labels and keys, in order, and none / palette only for Budget & audit.
  const sidebarKeys = await nav.getByRole("button").evaluateAll((buttons) =>
    buttons.map((b) => [(b.querySelector(".nav-text")?.textContent ?? "").trim(), (b.querySelector(".nav-key")?.textContent ?? "").trim()]),
  );
  const screensTable = await tableRows(page, KEYMAP.screens);
  expect(screensTable.map((r) => [r[0], r[1] === "none" ? "" : r[1]])).toEqual(sidebarKeys);
  expect(screensTable.find((r) => r[0] === "Budget & audit")).toEqual(["Budget & audit", "none", "palette only"]);
  expect(screensTable.find((r) => r[0] === "Memory")).toEqual(["Memory", "⌘9", "shortcut, or the palette"]);

  // "Anywhere": ⌘K or /, ?, J K, Enter, Esc and Tab, and the kill switch's own chord.
  const anywhere = (await tableRows(page, KEYMAP.anywhere)).map((r) => r[0]);
  expect(anywhere).toHaveLength(7);
  expect(anywhere[0]).toBe("⌘K or /");
  expect(anywhere[1]).toBe("?");
  expect(anywhere.at(-1)).toBe("⌘⇧K");

  // "Palette commands by screen": what the registry holds now, which is what the palette lists.
  const listed = (await tableRows(page, KEYMAP.commands)).map((r) => r[1]);
  expect(listed).toEqual(expect.arrayContaining(["Chat", "Settings", "Keyboard map", "Pause all", "Kill switch…"]));
  await page.keyboard.press("Meta+k");
  const palette = (await paletteOf(page).locator(".cp-row:not(.cp-show-all) .cp-label").allTextContents()).filter(Boolean);
  await page.keyboard.press("Escape");
  expect(palette.length).toBeGreaterThan(8);
  expect(palette.filter((title) => !listed.includes(title)), "every command the palette shows is in the table").toEqual([]);

  // Back returns to Tasks, the screen the map was opened from.
  await byId(page, KEYMAP.back).click();
  await expect(byId(page, "screen-tasks")).toBeVisible();
  expect(await hashOf(page)).toBe("#/tasks");
});

test("AC4: the palette's Keyboard map command opens it, ? opens it once from a screen with no key, and Back returns there", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await openByHash(page, "budget");
  await page.keyboard.press("Meta+k");
  await page.keyboard.type("keyboard");
  await expect(paletteOf(page).locator(".cp-row .cp-label")).toHaveText(["Keyboard map"]);
  await expect(paletteOf(page).locator(".cp-row kbd")).toHaveText("?");
  await page.keyboard.press("Enter");
  await expect(byId(page, KEYMAP.screen)).toBeVisible();
  await byId(page, KEYMAP.back).press("Enter");
  await expect(byId(page, "screen-budget")).toBeVisible();

  // ? with Shift held, as a US layout sends it (key "?", shiftKey), opens it exactly once.
  await recordHashes(page);
  await page.keyboard.down("Shift");
  await page.keyboard.press("?");
  await page.keyboard.up("Shift");
  await expect(byId(page, KEYMAP.screen)).toBeVisible();
  await expect.poll(() => hashes(page)).toEqual(["#/keymap"]);
  await page.keyboard.press("Escape");
  await byId(page, KEYMAP.back).click();
  await expect(byId(page, "screen-budget")).toBeVisible();
});

// ---- AC5: J / K / Enter / Esc ---------------------------------------------------------------------------------------------------------

test("AC5: Tasks, J / K move the selection across the cards, Enter opens the focused one, Esc returns with focus on it", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await page.keyboard.press("Meta+6");
  await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  const focusedCard = (): Promise<string | null> => page.evaluate(() => document.activeElement?.getAttribute("data-card-key") ?? null);
  const order = await page.locator("[data-card-key]").evaluateAll((els) => els.map((el) => el.getAttribute("data-card-key") ?? ""));
  expect(order).toHaveLength(8);
  await page.keyboard.press("j");
  expect(await focusedCard()).toBe(order[0]);
  await page.keyboard.press("j");
  expect(await focusedCard()).toBe(order[1]);
  await page.keyboard.press("k");
  expect(await focusedCard()).toBe(order[0]);
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(byId(page, "task-detail")).toBeFocused();
  await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "detail");
  await page.keyboard.press("Escape");
  await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(byId(page, `task-card-${order[1] ?? ""}`)).toBeFocused();
});

test("AC5: Playbooks, J / K move the selection across the rows, Enter opens the focused one, Back returns with focus on its row", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await page.keyboard.press("Meta+7");
  await expect(byId(page, "screen-playbooks")).toHaveAttribute("data-state", "populated");
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
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
  await expect(byId(page, "playbook-detail")).toBeVisible();
  const back = byId(page, "screen-playbooks").locator("[data-pb-back]");
  await expect(back).toBeFocused();
  // Esc does not leave a playbook's detail view: only its edit and history views handle it (`PlaybookEdit.tsx`,
  // `PlaybookHistory.tsx`), and `screens/playbooks/` is outside this item. Back (Enter on the focused control)
  // returns to the list with focus on the row; the missing Esc is a follow-up in `docs/OPEN_QUESTIONS.md`.
  await page.keyboard.press("Enter");
  await expect(byId(page, "playbook-detail")).toHaveCount(0);
  await expect(opens.nth(1)).toBeFocused();
});

test("AC5: Memory, J / K move the selection across the files, Enter opens the focused one, Esc returns to the tree with focus on that file", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await page.keyboard.press("Meta+9");
  await expect(byId(page, MEMORY.tree)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
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
});

// ---- AC7: one owner for each chord -----------------------------------------------------------------------------------------------------

/** The keys the renderer owns: ⌘1 to ⌘9, ⌘, and ⌘K (and ⌘⇧K, the kill switch). */
function isRendererChord(accelerator: string): boolean {
  const parts = accelerator.toLowerCase().split("+").map((part) => part.trim());
  const key = parts.at(-1) ?? "";
  const mods = parts.slice(0, -1);
  const command = mods.some((m) => ["cmd", "command", "cmdorctrl", "commandorcontrol", "ctrl", "control", "meta", "super"].includes(m));
  return command && (/^[1-9]$/.test(key) || key === "," || key === "comma" || key === "k");
}

test("AC7: no item of the application menu, in any submenu, has an accelerator for ⌘1 to ⌘9, ⌘, or ⌘K; the renderer's keyboard map is their one owner", async () => {
  await launch();
  const found = await (app as ElectronApplication).evaluate(({ Menu: ElectronMenu }) => {
    type Row = { readonly path: string; readonly accelerator: string | null; readonly role: string | null };
    const walk = (menu: Menu | null, path = ""): Row[] =>
      menu === null
        ? []
        : menu.items.flatMap((item): Row[] => {
            const here = `${path}/${item.label}`;
            const row: Row = { path: here, accelerator: item.accelerator === undefined || item.accelerator === null ? null : String(item.accelerator), role: item.role ?? null };
            return [row, ...(item.submenu ? walk(item.submenu, here) : [])];
          });
    // The same walk over a menu that does claim a chord, so a walk that finds nothing cannot be a walk that sees nothing.
    const claims = ElectronMenu.buildFromTemplate([{ label: "Probe", submenu: [{ label: "Claimed", accelerator: "CmdOrCtrl+1" }] }]);
    return { real: walk(ElectronMenu.getApplicationMenu()), probe: walk(claims) };
  });
  const probe = found.probe.filter((row) => row.accelerator !== null && isRendererChord(row.accelerator));
  expect(probe.map((row) => row.path), "the walk sees an accelerator that is claimed").toEqual(["/Probe/Claimed"]);
  const claimed = found.real.filter((row) => row.accelerator !== null && isRendererChord(row.accelerator));
  expect(claimed, "menu items that claim a chord the renderer owns").toEqual([]);
  // A role's built-in accelerator is not in `accelerator`; none of Electron's roles binds a digit, ⌘, or ⌘K.
  expect(found.real.filter((row) => row.role !== null && /^(preferences|settings)$/i.test(row.role)), "roles that open settings").toEqual([]);
});

// ---- AC7b: the kill confirm holds the keys ------------------------------------------------------------------------------------------------

test("AC7b: with the kill confirm open, ⌘K, /, ?, ⌘3 and a screen's own key do nothing behind it; Esc closes it, sends no stop, and the keys work again", async () => {
  test.setTimeout(90_000);
  const page = await launch();
  await openByHash(page, "approvals");
  await recordHashes(page);
  const kernel = fixture as FixtureKernel;

  await page.keyboard.press("Meta+Shift+K");
  await expect(page.getByText(KILL_CONFIRM_TITLE)).toBeVisible();
  for (const chord of ["Meta+k", "/", "Shift+/", "Meta+3", "Meta+9", "a"]) await page.keyboard.press(chord);
  await expect(paletteOf(page)).toHaveCount(0);
  expect(await hashes(page), "nothing navigated behind the confirm").toEqual([]);
  expect(await hashOf(page)).toBe("#/approvals");
  await expect(page.getByText(KILL_CONFIRM_TITLE)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByText(KILL_CONFIRM_TITLE)).toHaveCount(0);
  expect(kernel.requests.filter((r) => r.method === "POST" && r.path === "/stop-all"), "closing the confirm sends no stop").toEqual([]);
  await page.keyboard.press("Meta+3");
  await page.keyboard.press("Meta+k");
  await expect(paletteOf(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+6");
  await expect(byId(page, "screen-tasks")).toBeVisible();
});

// ---- AC8: the evidence --------------------------------------------------------------------------------------------------------------------

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
  const evidence = process.env.KEYBOARD_EVIDENCE === "1";
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

test("AC8: the Keyboard map, and the palette open over Tasks, in light and dark", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const page = await launch();
  // The store is live (the status row has left "connecting") before anything is shot.
  await expect(byId(page, "sidebar").getByRole("status", { name: "Kernel: idle" })).toBeVisible({ timeout: 15_000 });

  await page.keyboard.press("Meta+6");
  await expect(byId(page, "screen-tasks")).toHaveAttribute("data-state", "populated");
  await page.keyboard.press("Meta+k");
  await expect(paletteInput(page)).toBeFocused();
  await settle(page);
  await screenshots(page, "tasks-populated-palette", testInfo);
  await page.keyboard.press("Escape");
  await expect(paletteOf(page)).toHaveCount(0);

  // Tall enough that the map's three tables are mostly in view.
  await (app as ElectronApplication).evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.setContentSize(1180, 1500);
  });
  await page.keyboard.press("?");
  await expect(byId(page, KEYMAP.screen)).toBeVisible();
  await expect(byId(page, KEYMAP.back)).toBeFocused();
  await screenshots(page, "keymap", testInfo);
});

test("AC8: without KEYBOARD_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", async () => {
  test.skip(process.env.KEYBOARD_EVIDENCE === "1", "an evidence run writes the tracked dir on purpose");
  const files = existsSync(EVIDENCE_DIR) ? readdirSync(EVIDENCE_DIR) : [];
  const touched = files.filter((name) => statSync(join(EVIDENCE_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-7-polish/keyboard/ is newer than this run's start").toEqual([]);
});

test("AC8: the evidence README names each screenshot against its mockup view, in light and dark, and every one exists", () => {
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
  expect(readme).toContain("KEYBOARD_EVIDENCE=1");
});
