// The menu bar in the built app, against the fixture kernel
// (`./fixtures/menubar.ts`), phase 5 item 17. Run `npm run build` first.
//
// Each test launches the app through the harness (hidden window) with the
// tray's e2e seam on (`TRAY_SEAM_ENV`, honoured only unpackaged). The native
// tray menu cannot be driven or screenshotted by Playwright, so the spec reads
// its model and presses its items through the seam
// (`globalThis.__studioTray` in the main process), and stands in for the
// native kill confirm by replacing `dialog.showMessageBox`. Links arrive the
// way macOS delivers them: an `open-url` event on `app`.
//
// The fixture records every request, so "exactly one POST" and "no request"
// are the kernel's own count. The window-closed steps (AC4b, AC5) run on
// macOS only: elsewhere `main.ts` quits on `window-all-closed`.
//
// The panel's Recent list reads `GET /notifications` (the fixture's map, newest
// first): its rows, opening one by click and by keyboard (the host's one
// `GET /notifications/:id`, as for a link), and a new row arriving through the
// feed without moving the rows on screen or the panel's height.
//
// Screenshots (AC6): with `MENUBAR_EVIDENCE=1` every designed state of the
// status panel, light and dark, is written to the committed
// `docs/evidence/phase-5-polish/menubar/`; otherwise to Playwright's per-test
// output dir, so CI and other lanes' e2e runs never dirty tracked files. The
// spec asserts behaviour, never pixels.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page, TestInfo } from "@playwright/test";
import { TRAY_SEAM_ENV, TRAY_SEAM_GLOBAL } from "../src/screens/menubar/state";
import type { TrayModel } from "../src/screens/menubar/state";
import { launchApp } from "./electron-harness";
import { FIXTURE_HOST, FIXTURE_TOKEN, appEnv, startFixtureKernel, unreachableDataDir } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import type { NotificationRow, RouteKey } from "../src/api/contract";
import type { FixtureRoute } from "./fixture-kernel";
import {
  cappedStatus,
  kernelEvent,
  killedStatus,
  menubarKernel,
  menubarRoutes,
  notification,
  pausedStatus,
  restingStatus,
  workingStatus,
} from "./fixtures/menubar";
import type { MenubarKernel, MenubarKernelInit } from "./fixtures/menubar";

const EVIDENCE = process.env.MENUBAR_EVIDENCE === "1";
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-5-polish/menubar/", import.meta.url));
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** Every designed state of the panel, and the kill confirm, in the README's order. */
const STATES = ["loading", "error", "idle", "recent", "working", "waiting", "paused", "cap", "killed", "kill-confirm"] as const;
type State = (typeof STATES)[number];

const LINK_NOTHING = "That notification link points to nothing Studio can open";
const IS_MAC = process.platform === "darwin";
const MAC_ONLY = "main.ts quits on window-all-closed off macOS, so the window-closed steps run on macOS only";

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

// ---- harness -------------------------------------------------------------------------------

async function startKernel(
  init: MenubarKernelInit = {},
  overrides: Partial<Record<RouteKey, FixtureRoute>> = {},
): Promise<{ kernel: MenubarKernel; fixture: FixtureKernel; push: (kind?: "event_done" | "approval_requested" | "notification_created") => void }> {
  const kernel = menubarKernel(init);
  const started = await startFixtureKernel({ routes: { ...menubarRoutes(kernel), ...overrides } });
  fixture = started;
  let id = 0;
  const push = (kind: "event_done" | "approval_requested" | "notification_created" = "event_done"): void => {
    id += 1;
    started.appendEvent(kernelEvent(id, kind));
  };
  return { kernel, fixture: started, push };
}

async function closeAll(started?: FixtureKernel): Promise<void> {
  await app?.close();
  app = undefined;
  if (started !== undefined) {
    await started.close();
    if (fixture === started) fixture = undefined;
  }
}

/** Launch with the tray seam on. */
async function launch(env: Readonly<Record<string, string>>): Promise<{ launched: ElectronApplication; page: Page }> {
  const launched = await launchApp({ ...env, [TRAY_SEAM_ENV]: "1" });
  app = launched;
  const page = await launched.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  return { launched, page };
}

async function openPanel(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/menubar";
  });
  await expect(page.getByTestId("screen-menubar")).toBeVisible();
}

/** The tray's model, read through the seam; `undefined` until the tray has set it. */
async function trayModel(launched: ElectronApplication): Promise<TrayModel | undefined> {
  return launched.evaluate((_electron, key) => (globalThis as unknown as Record<string, { model(): TrayModel } | undefined>)[key]?.model(), TRAY_SEAM_GLOBAL);
}

/** Presses a tray item through the seam; settles after its work and its re-read. */
async function trayClick(launched: ElectronApplication, id: string): Promise<void> {
  await launched.evaluate(
    async (_electron, [key, item]) => {
      await (globalThis as unknown as Record<string, { click(id: string): Promise<void> }>)[key as string]?.click(item as string);
    },
    [TRAY_SEAM_GLOBAL, id] as const,
  );
}

/** Replaces the native kill confirm: every later ask answers `response` (0 Cancel, 1 Engage) and is counted. */
async function answerKillConfirm(launched: ElectronApplication, response: 0 | 1): Promise<void> {
  await launched.evaluate(({ dialog }, answer) => {
    const g = globalThis as unknown as { __killAsks?: number };
    g.__killAsks = 0;
    dialog.showMessageBox = (() => {
      g.__killAsks = (g.__killAsks ?? 0) + 1;
      return Promise.resolve({ response: answer, checkboxChecked: false });
    }) as typeof dialog.showMessageBox;
  }, response);
}

async function killAsks(launched: ElectronApplication): Promise<number> {
  return launched.evaluate(() => (globalThis as unknown as { __killAsks?: number }).__killAsks ?? 0);
}

/** A link, delivered as macOS does: `open-url` on `app`. */
async function openUrl(launched: ElectronApplication, url: string): Promise<void> {
  await launched.evaluate(({ app: electronApp }, link) => {
    electronApp.emit("open-url", { preventDefault() {} }, link);
  }, url);
}

function postsTo(started: FixtureKernel, path: string): number {
  return started.requests.filter((r) => r.method === "POST" && r.path === path).length;
}

function toasts(page: Page) {
  return page.getByRole("region", { name: "Notifications" }).getByRole("status");
}

async function hash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash);
}

/** Tab until the focused element is inside the panel and its text starts with `label` (at most 40 stops). */
async function tabTo(page: Page, label: RegExp): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el === null || el.closest('[data-testid="screen-menubar"], [role="alertdialog"]') === null) return "";
      return el.getAttribute("aria-label") ?? el.textContent ?? "";
    });
    if (label.test(name)) return;
  }
  throw new Error(`Tab never reached ${String(label)}`);
}

/** `minutes` before now, as the kernel writes a time. */
function minutesAgo(minutes: number, seconds = 0): string {
  return new Date(Date.now() - minutes * 60_000 + seconds * 1000).toISOString();
}

/** Three notifications, one per settled delivery status, newest first: #9 failed, #8 unsupported, #7 (the approval's) delivered. */
function threeNotifications(): Map<number, NotificationRow> {
  return new Map<number, NotificationRow>([
    [7, { ...notification(7, "kernel:approval", "Approval 7: Bash"), created_at: minutesAgo(42), delivered_at: minutesAgo(42, 2) }],
    [
      8,
      {
        ...notification(8, "trigger:12", "Playbook review-prs fired", "unsupported"),
        created_at: minutesAgo(12),
        delivery_detail: "terminal-notifier not found: posted without a click action by /usr/bin/osascript",
      },
    ],
    [9, { ...notification(9, "agent:pim", "Couldn't post the standup note", "failed"), created_at: minutesAgo(1), delivery_detail: "/usr/bin/osascript exited 1" }],
  ]);
}

function recentRows(page: Page) {
  return page.getByTestId("menubar-recent").getByRole("option");
}

/** The Recent rows' ids, top to bottom. */
async function recentKeys(page: Page): Promise<(string | null)[]> {
  return recentRows(page).evaluateAll((rows) => rows.map((row) => row.getAttribute("data-key")));
}

// ---- screenshots ---------------------------------------------------------------------------

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
}

/** The ground behind the screen, to prove the dark tokens really applied. */
async function ground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector(".main") as Element).backgroundColor);
}

const written: string[] = [];

async function shoot(page: Page, state: State, testInfo: TestInfo): Promise<void> {
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    grounds.push(await ground(page));
    const file = `${state}-${theme}.png`;
    const path = EVIDENCE ? join(EVIDENCE_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
    written.push(file);
  }
  expect(grounds[0]).not.toBe(grounds[1]);
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });
}

// ---- the tray ------------------------------------------------------------------------------

test("AC1: two pending approvals, at rest: the tray reads count 2, title \"2\", state waiting; the panel agrees", async () => {
  const { fixture: started } = await startKernel();
  const { launched, page } = await launch(started.env);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("waiting");
  const model = await trayModel(launched);
  expect(model?.count).toBe(2);
  expect(model?.title).toBe("2");
  expect(model?.items.map((i) => i.id)).toEqual(["status", "open", "pause-all", "kill-switch", "resume", "quit"]);
  await openPanel(page);
  await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("menubar-meta")).toHaveText("0 running · 2 waiting on you");
});

test("AC2: Pause all sends exactly one POST /pause; the tray reads paused only from a later GET /status; Unpause sends POST /unpause", async () => {
  const { kernel, fixture: started } = await startKernel({ approvals: [] });
  const { launched } = await launch(started.env);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("idle");

  await trayClick(launched, "pause-all");
  expect(kernel.posts).toEqual(["/pause"]);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("paused");
  const pauseAt = started.requests.findIndex((r) => r.method === "POST" && r.path === "/pause");
  expect(started.requests.slice(pauseAt + 1).some((r) => r.method === "GET" && r.path === "/status"), "a GET /status after the POST").toBe(true);
  const items = (await trayModel(launched))?.items ?? [];
  expect(items.find((i) => i.id === "unpause")?.label).toBe("Unpause");
  expect(items.some((i) => i.id === "pause-all")).toBe(false);

  await trayClick(launched, "unpause");
  expect(kernel.posts).toEqual(["/pause", "/unpause"]);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("idle");
});

test("AC3 (tray): Kill switch… asks first; Cancel sends nothing; Engage sends exactly one POST /stop-all; Resume sends POST /resume", async () => {
  const { kernel, fixture: started } = await startKernel({ approvals: [] });
  const { launched } = await launch(started.env);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("idle");

  await answerKillConfirm(launched, 0);
  await trayClick(launched, "kill-switch");
  expect(await killAsks(launched)).toBe(1);
  expect(postsTo(started, "/stop-all")).toBe(0);
  expect((await trayModel(launched))?.state).toBe("idle");

  await answerKillConfirm(launched, 1);
  await trayClick(launched, "kill-switch");
  expect(await killAsks(launched)).toBe(1);
  expect(postsTo(started, "/stop-all")).toBe(1);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("killed");
  expect((await trayModel(launched))?.items.find((i) => i.id === "kill-switch")?.enabled).toBe(false);

  await trayClick(launched, "resume");
  expect(kernel.posts).toEqual(["/stop-all", "/resume"]);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("idle");
});

// ---- the window ----------------------------------------------------------------------------

test("AC3 (window): the panel's Kill switch… opens the confirm; Cancel sends nothing; Engage sends one POST /stop-all; Resume sends POST /resume", async () => {
  const { kernel, fixture: started } = await startKernel({ approvals: [] });
  const { page } = await launch(started.env);
  await openPanel(page);
  await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "idle");

  await page.getByRole("button", { name: "Kill switch…" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Engage the kill switch?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(postsTo(started, "/stop-all")).toBe(0);

  await page.getByRole("button", { name: "Kill switch…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Engage kill switch" }).click();
  await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "killed");
  expect(postsTo(started, "/stop-all")).toBe(1);

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "idle");
  expect(kernel.posts).toEqual(["/stop-all", "/resume"]);
});

test("AC4: a kernel:approval link opens #/approvals/7 selected, deciding nothing; an agent:pim link opens #/chat/pim", async () => {
  const { fixture: started } = await startKernel();
  const { launched, page } = await launch(started.env);
  await expect.poll(() => started.requests.some((r) => r.path === "/events/stream")).toBe(true);

  await openUrl(launched, "loomwright-studio://notifications/7");
  await expect.poll(() => hash(page)).toBe("#/approvals/7");
  await expect(page.getByTestId("screen-approvals")).toBeVisible();
  await expect(page.getByTestId("approval-detail")).toHaveAttribute("data-approval-id", "7");
  await expect(page.getByRole("listbox", { name: "Approvals, pending first" }).locator('[role="option"][aria-selected="true"]')).toHaveAttribute("data-key", "7");
  await page.waitForTimeout(300);
  expect(started.requests.filter((r) => r.method === "POST" && r.path.startsWith("/approvals/"))).toEqual([]);
  expect(started.requests.filter((r) => r.path === "/notifications/7")).toHaveLength(1);
  await expect(toasts(page)).toHaveCount(0);

  await openUrl(launched, "loomwright-studio://notifications/3");
  await expect.poll(() => hash(page)).toBe("#/chat/pim");
  await expect(page.getByTestId("screen-chat")).toBeVisible();
});

test("AC4: an invalid link only toasts: no route change, no GET /notifications/*, no POST", async () => {
  test.setTimeout(60_000);
  const { fixture: started } = await startKernel();
  const { launched, page } = await launch(started.env);
  await openPanel(page);
  await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "waiting");

  for (const link of ["loomwright-studio://approve/7", "loomwright-studio://notifications/abc", "loomwright-studio://notifications/7?x=1", "https://example.com/notifications/7"]) {
    const from = started.requests.length;
    await openUrl(launched, link);
    await expect(toasts(page), link).toHaveCount(1);
    await expect(toasts(page)).toContainText(LINK_NOTHING);
    expect(await hash(page), link).toBe("#/menubar");
    // Past the renderer's 2 s repeat window, so the next invalid link is a new route, not a repeat.
    await page.waitForTimeout(2_100);
    const after = started.requests.slice(from);
    expect(after.filter((r) => r.path.startsWith("/notifications/") || r.method === "POST"), link).toEqual([]);
    await toasts(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(toasts(page)).toHaveCount(0);
  }
});

test("AC4b + AC5 (macOS): with the window closed the app and the tray keep running, and a link opens a new window on #/approvals/7", async () => {
  test.skip(!IS_MAC, MAC_ONLY);
  const { fixture: started } = await startKernel();
  const { launched } = await launch(started.env);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("waiting");

  await launched.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
  await expect.poll(() => launched.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  await new Promise((done) => setTimeout(done, 500));
  expect(launched.process().exitCode).toBeNull();
  expect((await trayModel(launched))?.count).toBe(2);

  const from = started.requests.length;
  const opened = launched.waitForEvent("window");
  await openUrl(launched, "loomwright-studio://notifications/7");
  const page = await opened;
  await expect.poll(() => hash(page)).toBe("#/approvals/7");
  await expect(page.getByTestId("approval-detail")).toHaveAttribute("data-approval-id", "7");
  await expect.poll(() => launched.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  // The no-window path may deliver the route twice; the renderer handles it once.
  await page.waitForTimeout(1_000);
  expect(started.requests.slice(from).filter((r) => r.path === "/notifications/7")).toHaveLength(1);
  await expect(toasts(page)).toHaveCount(0);
});

test("AC5: Quit from the tray exits the app; the kernel still answers and got no stop, pause or session call from the quit", async () => {
  const { fixture: started } = await startKernel();
  const { launched } = await launch(started.env);
  await expect.poll(async () => (await trayModel(launched))?.state).toBe("waiting");
  const from = started.requests.length;

  const closed = launched.waitForEvent("close");
  // Deferred, so this evaluate answers before the app starts quitting.
  await launched.evaluate((_electron, key) => {
    setTimeout(() => void (globalThis as unknown as Record<string, { click(id: string): Promise<void> }>)[key]?.click("quit"), 50);
  }, TRAY_SEAM_GLOBAL);
  await closed;
  app = undefined;

  const answer = await fetch(`http://${FIXTURE_HOST}:${started.port}/status`, { headers: { Authorization: `Bearer ${FIXTURE_TOKEN}` } });
  expect(answer.status).toBe(200);
  expect(((await answer.json()) as { kill_switch: { engaged: boolean } }).kill_switch.engaged).toBe(false);
  const fromQuit = started.requests.slice(from).filter((r) => r.method === "POST" && (r.path === "/stop-all" || r.path === "/pause" || r.path.startsWith("/sessions/")));
  expect(fromQuit).toEqual([]);
});

test("AC7: keyboard only reaches Approvals, Pause all / Unpause, Kill switch… (Escape cancels) and Resume, and Enter or Space runs each", async () => {
  test.setTimeout(60_000);
  const { kernel, fixture: started } = await startKernel();
  const { page } = await launch(started.env);
  await openPanel(page);
  const panel = page.getByTestId("screen-menubar");
  await expect(panel).toHaveAttribute("data-state", "waiting");

  // Pause all, by Space; the same button then reads Unpause and keeps focus.
  await tabTo(page, /^Pause all/);
  await page.keyboard.press("Space");
  await expect(panel).toHaveAttribute("data-state", "paused");
  expect(kernel.posts).toEqual(["/pause"]);
  await expect(page.getByRole("button", { name: "Unpause" })).toBeFocused();

  // Resume (enabled while paused), by Enter.
  await tabTo(page, /^Resume/);
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("data-state", "waiting");
  expect(kernel.posts).toEqual(["/pause", "/resume"]);

  // Kill switch…: Escape cancels, Enter on the focused Cancel cancels, then Tab + Enter engages once.
  await tabTo(page, /^Kill switch/);
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Kill switch…" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(postsTo(started, "/stop-all")).toBe(0);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "Engage kill switch" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("data-state", "killed");
  expect(postsTo(started, "/stop-all")).toBe(1);
  // Kill switch… is now disabled; focus moved on to Resume, never to <body>.
  await expect(page.getByRole("button", { name: "Resume" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel).toHaveAttribute("data-state", "waiting");

  // Approvals, by Enter.
  await tabTo(page, /^Approvals/);
  await page.keyboard.press("Enter");
  await expect.poll(() => hash(page)).toBe("#/approvals");
  expect(kernel.posts).toEqual(["/pause", "/resume", "/stop-all", "/resume"]);
});

// ---- the Recent list -----------------------------------------------------------------------

test("AC1 + AC2 (Recent): three rows newest first with title, age and delivery status; a row opened by click and by Enter makes one GET /notifications/7 and lands on #/approvals/7", async () => {
  test.setTimeout(60_000);
  const { fixture: started } = await startKernel({ approvals: menubarKernel().approvals.approvals, notifications: threeNotifications() });
  const { page } = await launch(started.env);
  await openPanel(page);
  await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "waiting");

  await expect(recentRows(page)).toHaveCount(3);
  expect(await recentKeys(page)).toEqual(["9", "8", "7"]);
  const expected = [
    { title: "Couldn't post the standup note", age: "1m ago", status: "failed" },
    { title: "Playbook review-prs fired", age: "12m ago", status: "unsupported" },
    { title: "Approval 7: Bash", age: "42m ago", status: "delivered" },
  ];
  for (const [i, row] of expected.entries()) {
    const option = recentRows(page).nth(i);
    await expect(option.locator(".list-subject")).toHaveText(row.title);
    await expect(option.locator(".list-aside")).toHaveText(row.age);
    await expect(option.getByRole("img", { name: row.status })).toBeVisible();
    await expect(option.locator(".list-meta")).toContainText(row.status);
  }

  // Click: the host's one GET /notifications/7, exactly as the deep link (AC4 above), and no POST.
  const from = started.requests.length;
  await recentRows(page).nth(2).click();
  await expect.poll(() => hash(page)).toBe("#/approvals/7");
  await expect(page.getByTestId("approval-detail")).toHaveAttribute("data-approval-id", "7");
  await page.waitForTimeout(300);
  expect(started.requests.slice(from).filter((r) => r.path.startsWith("/notifications/"))).toEqual([expect.objectContaining({ method: "GET", path: "/notifications/7" })]);
  expect(started.requests.slice(from).filter((r) => r.method === "POST")).toEqual([]);
  await expect(toasts(page)).toHaveCount(0);

  // Keyboard: Tab to the list, arrow down to #7, Enter. Past the queue's 2 s repeat window first: the same route inside it is dropped.
  await page.waitForTimeout(2_100);
  await openPanel(page);
  await expect(recentRows(page)).toHaveCount(3);
  const fromKeys = started.requests.length;
  await tabTo(page, /^Couldn't post the standup note/);
  for (const key of ["9", "8", "7"]) {
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("menubar-recent").locator(`[role="option"][data-key="${key}"]`)).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect.poll(() => hash(page)).toBe("#/approvals/7");
  await page.waitForTimeout(300);
  expect(started.requests.slice(fromKeys).filter((r) => r.path.startsWith("/notifications/"))).toEqual([expect.objectContaining({ method: "GET", path: "/notifications/7" })]);
  expect(started.requests.slice(fromKeys).filter((r) => r.method === "POST")).toEqual([]);
});

test("AC4 + AC5 (Recent): of 25 notifications 20 rows show and scroll inside the panel; a new one arrives at the top through the feed, and the rows on screen and the panel's height do not move", async () => {
  const many = new Map<number, NotificationRow>(
    Array.from({ length: 25 }, (_, i) => i + 1).map((id) => [id, { ...notification(id, "agent:pim", `Note ${id}`), created_at: minutesAgo(30 - id) }]),
  );
  const { kernel, fixture: started, push } = await startKernel({ approvals: [], notifications: many });
  const { page } = await launch(started.env);
  await openPanel(page);
  await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "idle");
  await expect.poll(() => started.requests.some((r) => r.path === "/events/stream")).toBe(true);

  await expect(recentRows(page)).toHaveCount(20);
  expect(await recentKeys(page)).toEqual(Array.from({ length: 20 }, (_, i) => String(25 - i)));
  const list = page.getByTestId("menubar-recent").locator(".list");
  const scroll = await list.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(scroll.scrollHeight, "the rows scroll inside the list").toBeGreaterThan(scroll.clientHeight);
  const card = page.locator(".menubar-card");
  const viewport = await page.evaluate(() => window.innerHeight);
  const cardBefore = await card.boundingBox();
  expect((cardBefore?.y ?? 0) + (cardBefore?.height ?? 0), "the panel fits the window").toBeLessThanOrEqual(viewport);
  const rowBefore = await recentRows(page).first().boundingBox();

  kernel.notifications.set(26, { ...notification(26, "kernel:approval", "Approval 26: Bash"), created_at: minutesAgo(0) });
  push("notification_created");
  await expect.poll(() => recentKeys(page).then((keys) => keys[0])).toBe("26");
  await expect(recentRows(page)).toHaveCount(20);
  // The row that was on top keeps its place on screen (the List's scroll anchoring), and the panel keeps its height.
  const rowAfter = await page.getByTestId("menubar-recent").locator('[role="option"][data-key="25"]').boundingBox();
  expect(Math.abs((rowAfter?.y ?? -1) - (rowBefore?.y ?? -2)), "row #25 did not move").toBeLessThan(1);
  const cardAfter = await card.boundingBox();
  expect(cardAfter?.height).toBe(cardBefore?.height);

  // So the new row is above the view: the hint says so, floating over the list (the height above already includes it).
  const newRow = page.getByTestId("menubar-recent").locator('[role="option"][data-key="26"]');
  const listBox = await list.boundingBox();
  const hiddenRow = await newRow.boundingBox();
  expect((hiddenRow?.y ?? 0) + (hiddenRow?.height ?? 0), "row #26 landed above the list's view").toBeLessThanOrEqual((listBox?.y ?? 0) + 1);
  const hint = page.getByTestId("menubar-recent-new");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText("1 new notification above");
  expect(await hint.getAttribute("data-action")).toBeNull();
  await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "idle");
  await expect(page.getByTestId("menubar-stale")).toHaveCount(0);
  // Activating it brings the new row into view, clears the hint, and puts focus on the row.
  await hint.click();
  await expect(hint).toHaveCount(0);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
  const shownRow = await newRow.boundingBox();
  expect(shownRow?.y ?? -1, "row #26 is in the list's view").toBeGreaterThanOrEqual((listBox?.y ?? 0) - 1);
  await expect(newRow).toBeFocused();
  expect((await card.boundingBox())?.height).toBe(cardBefore?.height);
});

// ---- evidence ------------------------------------------------------------------------------

test("AC6: every designed state of the status panel, and the kill confirm, in light and dark", async ({}, testInfo) => {
  test.setTimeout(120_000);
  if (EVIDENCE) {
    // The folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    for (const file of readdirSync(EVIDENCE_DIR)) if (file.endsWith(".png")) rmSync(join(EVIDENCE_DIR, file));
  }

  // Loading: GET /status never answers. The main process times a read out
  // after REQUEST_TIMEOUT_MS (10 s); the asserts below run well inside that.
  {
    let held = 0;
    const { fixture: started } = await startKernel({}, {
      "GET /status": () => {
        held += 1;
        return new Promise<never>(() => undefined);
      },
    });
    const { page } = await launch(started.env);
    await openPanel(page);
    await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "loading");
    await expect(page.getByTestId("menubar-loading")).toBeVisible();
    expect(held, "the read reached the kernel and is still unanswered").toBeGreaterThan(0);
    await shoot(page, "loading", testInfo);
    await closeAll(started);
  }

  // Error: api.json names a port nothing listens on: the kernel-unreachable band over the panel's error.
  {
    const { page } = await launch(appEnv(await unreachableDataDir()));
    await openPanel(page);
    await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible();
    await expect(page.getByTestId("screen-menubar")).toHaveAttribute("data-state", "error");
    await expect(page.getByTestId("menubar-error")).toContainText("The kernel isn't answering");
    await shoot(page, "error", testInfo);
    await closeAll();
  }

  // Idle (Recent empty), Recent with three rows, working, waiting on you, paused, paused at cap, killed and the kill
  // confirm: one kernel, re-read through the feed.
  {
    const { kernel, fixture: started, push } = await startKernel({ approvals: [], notifications: new Map() });
    const { page } = await launch(started.env);
    await openPanel(page);
    const panel = page.getByTestId("screen-menubar");
    await expect.poll(() => started.requests.some((r) => r.path === "/events/stream")).toBe(true);

    await expect(panel).toHaveAttribute("data-state", "idle");
    await expect(page.getByTestId("menubar-recent")).toContainText("No notifications yet");
    await shoot(page, "idle", testInfo);

    for (const [id, row] of threeNotifications()) kernel.notifications.set(id, row);
    push("notification_created");
    await expect(recentRows(page)).toHaveCount(3);
    await expect(panel).toHaveAttribute("data-state", "idle");
    await shoot(page, "recent", testInfo);

    kernel.status = workingStatus();
    push();
    await expect(panel).toHaveAttribute("data-state", "working");
    await expect(page.getByTestId("menubar-meta")).toHaveText("2 running · 0 waiting on you");
    await shoot(page, "working", testInfo);

    kernel.status = restingStatus();
    kernel.approvals.approvals.push(...menubarKernel().approvals.approvals);
    push("approval_requested");
    push();
    await expect(panel).toHaveAttribute("data-state", "waiting");
    await expect(page.getByTestId("menubar-meta")).toHaveText("0 running · 2 waiting on you");
    await expect(page.getByRole("img", { name: "2 pending" })).toBeVisible();
    await shoot(page, "waiting", testInfo);

    kernel.approvals.approvals.length = 0;
    kernel.status = pausedStatus();
    push("approval_requested");
    push();
    await expect(panel).toHaveAttribute("data-state", "paused");
    await expect(page.getByRole("button", { name: "Unpause" })).toBeVisible();
    await shoot(page, "paused", testInfo);

    kernel.status = cappedStatus();
    push();
    await expect(panel).toHaveAttribute("data-state", "cap");
    await expect(page.getByTestId("menubar-meta")).toContainText("resets");
    await shoot(page, "cap", testInfo);

    kernel.status = killedStatus();
    push();
    await expect(panel).toHaveAttribute("data-state", "killed");
    await expect(page.getByRole("button", { name: "Kill switch…" })).toBeDisabled();
    await shoot(page, "killed", testInfo);

    kernel.status = workingStatus();
    push();
    await expect(panel).toHaveAttribute("data-state", "working");
    await page.getByRole("button", { name: "Kill switch…" }).click();
    await expect(page.getByRole("alertdialog", { name: "Engage the kill switch?" })).toBeVisible();
    await expect(page.getByRole("alertdialog")).toContainText("2 are running now");
    await shoot(page, "kill-confirm", testInfo);
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    expect(postsTo(started, "/stop-all")).toBe(0);
  }

  expect([...new Set(written)].sort()).toEqual(STATES.flatMap((s) => THEMES.map((t) => `${s}-${t}.png`)).sort());
});

test("the evidence README lists every state's screenshot in both themes, and the folder holds nothing else", () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const expected = STATES.flatMap((s) => THEMES.map((t) => `${s}-${t}.png`)).sort();
  const listed = [...new Set(readme.match(/\b[a-z]+(?:-[a-z]+)*-(?:light|dark)\.png/g) ?? [])].sort();
  expect(listed).toEqual(expected);
  const onDisk = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png")).sort();
  expect(onDisk).toEqual(expected);
});
