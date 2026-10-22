// The ⌘K palette in Electron (phase 5 item 11, AC6): the gallery page
// (src/components/CommandPalette/gallery.html) served by a Vite dev server this
// spec starts, loaded by a throwaway Electron main it writes to a temp dir. No
// Playwright or Vite config edit, no new dependency, and `vite build` never
// sees the gallery. Every state renders in light and dark, plus the open state
// under reduced motion. Screenshots are written to
// docs/evidence/phase-5-polish/components/palette/ only when
// PALETTE_SCREENSHOTS=1, so a plain `npm run e2e` never dirties the tree.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { createServer } from "vite";
import type { ViteDevServer } from "vite";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-5-polish/components/palette/", import.meta.url));
const SCREENSHOTS = process.env.PALETTE_SCREENSHOTS === "1";
const GALLERY = "src/components/CommandPalette/gallery.html";

// The throwaway main: one sandboxed window on the gallery URL, nothing else.
const MAIN = `const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 960, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  void win.loadURL(process.env.PALETTE_GALLERY_URL);
});
app.on("window-all-closed", () => app.quit());
`;

let app: ElectronApplication | undefined;
let server: ViteDevServer | undefined;
let tempDir: string | undefined;

type Theme = "light" | "dark";

async function openGallery(theme: Theme): Promise<Page> {
  server = await createServer({
    root: APP_DIR,
    logLevel: "error",
    clearScreen: false,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    // Pre-bundle the gallery's dependencies up front, so no mid-test optimizer reload.
    optimizeDeps: { entries: [GALLERY] },
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (base === undefined) throw new Error("the Vite dev server reported no local URL");
  tempDir = mkdtempSync(join(tmpdir(), "palette-e2e-"));
  const main = join(tempDir, "main.cjs");
  writeFileSync(main, MAIN);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.PALETTE_GALLERY_URL = `${base}${GALLERY}?theme=${theme}`;
  app = await electron.launch({ args: [main], cwd: APP_DIR, env });
  const page = await app.firstWindow();
  await expect(page.getByRole("heading", { name: "CommandPalette gallery" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  return page;
}

async function snap(page: Page, name: string): Promise<void> {
  if (!SCREENSHOTS) return;
  await page.screenshot({ path: join(EVIDENCE_DIR, `${name}.png`), animations: "disabled" });
}

const palette = (page: Page) => ({
  shell: page.getByRole("combobox", { name: "Command palette" }),
  input: page.getByRole("textbox", { name: "Command" }),
  options: page.getByRole("option"),
  headers: page.getByRole("listbox").locator('[role="presentation"].cp-group'),
  selected: page.locator('[role="option"][aria-selected="true"]'),
});

async function expectActiveDescendant(input: Locator, option: Locator): Promise<void> {
  const id = await option.getAttribute("id");
  expect(id).not.toBeNull();
  await expect(input).toHaveAttribute("aria-activedescendant", id as string);
}

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await server?.close();
  server = undefined;
  if (tempDir !== undefined) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: every palette state renders`, async () => {
    test.setTimeout(90_000);
    const page = await openGallery(theme);
    const p = palette(page);

    // Open: every group in order, the first row selected, kbd chips, footer and attribution.
    await page.getByRole("button", { name: "Opener" }).focus();
    await page.keyboard.press("Meta+K");
    await expect(p.shell).toBeVisible();
    await expect(p.input).toBeFocused();
    await expect(p.headers).toHaveText(["Actions", "Screens", "Agents", "Playbooks", "Sessions", "Tasks"]);
    await expect(p.selected).toHaveText(/^Review approval: Mason · post review on #412/);
    await expectActiveDescendant(p.input, p.selected);
    await expect(p.shell.getByText("Wright, powered by Claude")).toBeVisible();
    await expect(page.getByRole("option", { name: /^Approvals/ })).toContainText("⌘3");
    await snap(page, `${theme}-open`);

    // Query (preview.html's "rev"): groups kept in order; in Actions the title prefix
    // ("Review approval…") ranks above the word start ("New duty: review PRs…").
    await p.input.fill("rev");
    await expect(p.headers).toHaveText(["Actions", "Playbooks", "Sessions", "Tasks"]);
    await expect(p.selected).toHaveText(/^Review approval/);
    await page.keyboard.press("ArrowDown");
    await expect(p.selected).toHaveText(/^New duty: review PRs…/);
    await expectActiveDescendant(p.input, p.selected);
    await page.keyboard.press("ArrowUp");
    await snap(page, `${theme}-query`);

    // Disabled: aria-disabled, and Enter does nothing.
    await p.input.fill("retry");
    const retry = page.getByRole("option", { name: "Retry failed session" });
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(p.shell).toBeVisible();
    await expect(page.getByTestId("last-run")).toHaveText("Last run: nothing yet");
    await snap(page, `${theme}-disabled`);

    // Show all: eight rows of the Tasks group, then the Show all row.
    await p.input.fill("task");
    await expect(p.options).toHaveCount(9);
    await expect(page.getByRole("option", { name: "Show all 11 Tasks" })).toBeVisible();
    await snap(page, `${theme}-show-all`);

    // Expanded: Enter on Show all lists all eleven.
    await page.keyboard.press("ArrowUp");
    await expect(p.selected).toHaveAttribute("aria-label", "Show all 11 Tasks");
    await page.keyboard.press("Enter");
    await expect(p.options).toHaveCount(11);
    await expect(p.selected).toHaveText(/^Task LW-109/);
    await snap(page, `${theme}-expanded`);

    // Empty: no options, the empty-state line.
    await p.input.fill("zzzz");
    await expect(p.options).toHaveCount(0);
    await expect(p.shell.getByRole("status")).toHaveText("No commands match “zzzz”.");
    await snap(page, `${theme}-empty`);

    // Esc clears, then closes, and focus returns to the opener.
    await page.keyboard.press("Escape");
    await expect(p.input).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(p.shell).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Opener" })).toBeFocused();
  });
}

test("keyboard only: run, open in inspector, registry shortcuts, kill switch", async () => {
  test.setTimeout(90_000);
  const page = await openGallery("light");
  const p = palette(page);

  // Enter runs the best match for a linked id and closes.
  await page.keyboard.press("Meta+K");
  await p.input.fill("412");
  await expect(p.selected).toHaveText(/^Review approval/);
  await page.keyboard.press("Enter");
  await expect(p.shell).toHaveCount(0);
  await expect(page.getByTestId("last-run")).toHaveText("Last run: approvals.review-412");

  // ⌘Enter opens in the inspector instead of running.
  await page.keyboard.press("Meta+K");
  await p.input.fill("lw-104");
  await page.keyboard.press("Meta+Enter");
  await expect(p.shell).toHaveCount(0);
  await expect(page.getByTestId("inspected")).toHaveText("Inspected: tasks.lw-104");
  await expect(page.getByTestId("last-run")).toHaveText("Last run: approvals.review-412");

  // A shortcut a registered command carries runs it, with the palette closed.
  await page.keyboard.press("Meta+3");
  await expect(page.getByTestId("last-run")).toHaveText("Last run: screens.approvals");

  // ⌘⇧K: the confirm opens and nothing engages; Cancel never engages; confirming engages once.
  await page.keyboard.press("Meta+Shift+K");
  const confirm = page.getByRole("alertdialog", { name: "Stop every session?" });
  await expect(confirm).toBeVisible();
  await expect(page.getByTestId("engaged")).toHaveText("Engaged: 0");
  await page.keyboard.press("Meta+Shift+K");
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId("engaged")).toHaveText("Engaged: 0");
  await page.keyboard.press("Meta+Shift+K");
  await confirm.getByRole("button", { name: "Stop everything" }).click();
  await expect(page.getByTestId("engaged")).toHaveText("Engaged: 1");
});

test("reduced motion: the open state fades only, with no scale", async () => {
  test.setTimeout(90_000);
  const page = await openGallery("light");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Meta+K");
  const p = palette(page);
  await expect(p.shell).toBeVisible();
  const motion = await page.evaluate(() => {
    const shell = document.querySelector(".cp-shell");
    const overlay = document.querySelector(".cp-overlay");
    if (shell === null || overlay === null) throw new Error("palette not rendered");
    return {
      shellAnimation: getComputedStyle(shell).animationName,
      shellTransform: getComputedStyle(shell).transform,
      overlayAnimation: getComputedStyle(overlay).animationName,
      overlayDuration: getComputedStyle(overlay).animationDuration,
    };
  });
  expect(motion).toEqual({ shellAnimation: "none", shellTransform: "none", overlayAnimation: "cp-fade-in", overlayDuration: "0.08s" });
  await snap(page, "light-open-reduced-motion");
});
