// Settings → Workspaces (phase 8 item 18c; the app side of AC1, AC3, AC4, AC5 and AC6) in the built app against the
// fixture kernel (`./fixtures/settings.ts` with `workspaces`). The folder picker runs through the real bridge: the
// renderer calls `window.api.chooseFolder()`, the preload forwards `studio:choose-folder`, and the main process's
// handler calls `dialog.showOpenDialog`, which this spec replaces (in the main process, before any click) with a
// recorder that answers a scripted folder, so no native dialog ever opens. The spec asserts behaviour, never pixels.
// Run `npm run build` first.
//
// The e2e project has no `jsx`, so it can't import `WORKSPACES_TEST_IDS` from `WorkspacesSection.tsx`; the ids it
// uses are repeated below and must match that object.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import type { SavedWorkspace } from "../src/api/contract";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { FIXTURE_HOME, settingsFixture } from "./fixtures/settings";
import type { SettingsFixture } from "./fixtures/settings";

/** `WORKSPACES_TEST_IDS` in `src/screens/settings/WorkspacesSection.tsx`. */
const IDS = {
  section: "settings-workspaces",
  table: "settings-workspaces-table",
  row: "settings-workspaces-row",
  repo: "settings-workspaces-repo",
  path: "settings-workspaces-path",
  state: "settings-workspaces-state",
  used: "settings-workspaces-used",
  gone: "settings-workspaces-gone",
  undo: "settings-workspaces-undo",
  add: "settings-workspaces-add",
  notice: "settings-workspaces-notice",
  empty: "settings-workspaces-empty",
} as const;

/** The main process's test seams (`electron/settings.ts`), so no run touches the owner's own prefs or login item. */
const PREFS_DIR_ENV = "STUDIO_APP_PREFS_DIR";
const FAKE_OS_ENV = "STUDIO_APP_FAKE_OS";

const minutesAgo = (n: number): string => new Date(Date.now() - n * 60_000).toISOString();
const saved = (id: number, path: string, repo: string | null, state: SavedWorkspace["state"], lastUsed: string): SavedWorkspace => ({ id, path, repo, added_at: lastUsed, last_used_at: lastUsed, state });

/** Two `o/r` checkouts (one since moved) and one `o/s`, most recently used first. */
const SAVED: readonly SavedWorkspace[] = [
  saved(1, `${FIXTURE_HOME}/code/studio-sandbox`, "o/r", "ready", minutesAgo(5)),
  saved(2, `${FIXTURE_HOME}/src/studio-sandbox-old`, "o/r", "missing", new Date(2026, 9, 2, 10, 0).toISOString()),
  saved(3, `${FIXTURE_HOME}/code/ntfs-tool`, "o/s", "ready", new Date(2026, 10, 6, 10, 0).toISOString()),
];

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
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

const byId = (scope: Page | Locator, id: string): Locator => scope.getByTestId(id);
const rowOf = (page: Page, id: number): Locator => page.locator(`[data-testid="${IDS.row}"][data-id="${id}"]`);

/** Replace the main process's `dialog.showOpenDialog` with a recorder answering `answer` (a path, or `null` for a cancel). */
async function scriptPicker(electronApp: ElectronApplication, answer: string | null): Promise<void> {
  await electronApp.evaluate(({ dialog }, chosen) => {
    const g = globalThis as unknown as { __picks?: unknown[] };
    g.__picks ??= [];
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      g.__picks?.push(args.at(-1));
      return { canceled: chosen === null, filePaths: chosen === null ? [] : [chosen] };
    }) as typeof dialog.showOpenDialog;
  }, answer);
}

/** The options each picker call was given, in order. */
async function picks(): Promise<unknown[]> {
  if (app === undefined) throw new Error("no app is running");
  return app.evaluate(() => (globalThis as unknown as { __picks?: unknown[] }).__picks ?? []);
}

/** Start the fixture kernel holding `workspaces`, launch the built app, open Settings and wait for the list. */
async function open(workspaces: readonly SavedWorkspace[], notCheckout: readonly string[] = []): Promise<{ readonly fx: SettingsFixture; readonly page: Page }> {
  const fx = settingsFixture({ workspaces, notCheckout });
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
  const section = byId(page, IDS.section);
  await expect(section).toBeVisible();
  await expect(section.getByRole("heading", { level: 2 })).toHaveText("Workspaces");
  await expect(byId(page, IDS.add)).toBeEnabled();
  return { fx, page };
}

test("AC1: the saved list shows each repo, path and last used; Add folder… saves the folder the picker answers and lists it with its repo", async () => {
  const { fx, page } = await open(SAVED);
  await expect(byId(page, IDS.row)).toHaveCount(3);
  await expect(byId(page, IDS.table).getByRole("columnheader")).toHaveText(["Repo", "Path", "Last used", "Remove"]);
  await expect(byId(rowOf(page, 1), IDS.repo)).toHaveText("o/r");
  await expect(byId(rowOf(page, 1), IDS.path)).toHaveText(`${FIXTURE_HOME}/code/studio-sandbox`);
  await expect(byId(rowOf(page, 1), IDS.used)).toHaveText(/^Today, \d{2}:\d{2}$/);
  await expect(byId(rowOf(page, 2), IDS.used)).toHaveText("2 Oct");

  const chosen = `${FIXTURE_HOME}/code/new-checkout`;
  await scriptPicker(app as ElectronApplication, chosen);
  await byId(page, IDS.add).click();
  await expect(byId(page, IDS.row)).toHaveCount(4);
  const added = byId(page, IDS.row).first();
  await expect(byId(added, IDS.repo)).toHaveText("o/r");
  await expect(byId(added, IDS.path)).toHaveText(chosen);
  await expect(byId(added, IDS.used)).toHaveText(/^Today, \d{2}:\d{2}$/);
  // The main process opened a choose-a-folder dialog with its own options, and the kernel holds the folder.
  expect(await picks()).toEqual([{ properties: ["openDirectory"] }]);
  expect(fx.savedWorkspaces().map((w) => w.path)).toContain(chosen);
  await expect(byId(page, IDS.notice)).toHaveCount(0);
});

test("AC4: a saved folder that has moved reads 'Missing' in words, never as ready", async () => {
  const { page } = await open(SAVED);
  await expect(byId(rowOf(page, 2), IDS.state)).toContainText("Missing");
  await expect(rowOf(page, 2)).toHaveAttribute("data-state", "missing");
  await expect(byId(rowOf(page, 1), IDS.state)).toHaveCount(0);
});

test("AC3: remove forgets the row only and shows it removed in place with Undo; Undo saves the path again", async () => {
  const { fx, page } = await open(SAVED);
  await page.getByRole("button", { name: `Remove ${FIXTURE_HOME}/src/studio-sandbox-old` }).click();
  const gone = byId(page, IDS.gone);
  await expect(gone).toContainText("The folder is still on disk, and no crew member's settings change.");
  await expect(byId(page, IDS.undo)).toBeFocused();
  expect(fx.savedWorkspaces().map((w) => w.id)).toEqual([1, 3]);
  // In place, between the rows it was between.
  await expect(byId(page, IDS.table).locator("tbody tr")).toHaveCount(3);
  await expect(byId(page, IDS.table).locator("tbody tr").nth(1)).toHaveAttribute("data-testid", IDS.gone);

  await byId(page, IDS.undo).press("Enter");
  await expect(gone).toHaveCount(0);
  await expect(byId(page, IDS.row)).toHaveCount(3);
  await expect(page.getByRole("button", { name: `Remove ${FIXTURE_HOME}/src/studio-sandbox-old` })).toBeFocused();
  expect(fx.savedWorkspaces().map((w) => w.path)).toContain(`${FIXTURE_HOME}/src/studio-sandbox-old`);
});

test("AC5: a checkout with no GitHub remote is saved with no repo, and the kernel's note is shown", async () => {
  const { page } = await open([]);
  await expect(byId(page, IDS.empty)).toHaveText("No saved workspaces yet. Add folder… saves one.");
  await scriptPicker(app as ElectronApplication, `${FIXTURE_HOME}/code/no-remote`);
  await byId(page, IDS.add).click();
  await expect(byId(page, IDS.notice)).toHaveText(`${FIXTURE_HOME}/code/no-remote has no GitHub remote, so it won't be matched to a repo; it is saved, but a lookup by repo won't offer it.`);
  await expect(byId(byId(page, IDS.row).first(), IDS.repo)).toHaveText("No GitHub remote");
});

test("AC6: a protected folder and a folder that is not a git checkout are refused in plain words, and nothing is saved", async () => {
  const notCheckout = `${FIXTURE_HOME}/notes`;
  const { fx, page } = await open(SAVED, [notCheckout]);
  const protectedPick = `${FIXTURE_HOME}/Documents/work/studio-sandbox`;
  await scriptPicker(app as ElectronApplication, protectedPick);
  await byId(page, IDS.add).click();
  await expect(byId(page, IDS.notice)).toHaveText(
    `Not saved: ${protectedPick}. ${protectedPick} is inside a macOS-protected folder (~/Documents, ~/Desktop, ~/Downloads, ~/Library/Mobile Documents), so it can't be used: macOS blocks the kernel, which runs in the background, from reading anything there (D31); use a copy of the repo outside those folders.`,
  );
  await expect(byId(page, IDS.row)).toHaveCount(3);

  await scriptPicker(app as ElectronApplication, notCheckout);
  await byId(page, IDS.add).click();
  await expect(byId(page, IDS.notice)).toHaveText(`Not saved: ${notCheckout}. ${notCheckout} can't be saved: it is not a git checkout (no .git).`);
  await expect(byId(page, IDS.row)).toHaveCount(3);
  expect(fx.savedWorkspaces().map((w) => w.id)).toEqual([1, 2, 3]);
});

test("a cancelled picker saves nothing and says nothing", async () => {
  const { fx, page } = await open(SAVED);
  await scriptPicker(app as ElectronApplication, null);
  await byId(page, IDS.add).click();
  await expect.poll(async () => (await picks()).length).toBe(1);
  await expect(byId(page, IDS.add)).not.toHaveAttribute("aria-busy", "true");
  await expect(byId(page, IDS.notice)).toHaveCount(0);
  expect(fixture?.requests.filter((r) => r.method === "POST" && r.path === "/workspaces")).toEqual([]);
  expect(fx.savedWorkspaces()).toHaveLength(3);
});
