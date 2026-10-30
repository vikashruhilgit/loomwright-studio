// The Tasks screen in the built app, against the fixture kernel
// (`./fixtures/tasks.ts`), phase 7 item 03. Run `npm run build` first.
//
// Each test launches the app through the harness (hidden window), opens `#/tasks`
// and drives it by keyboard: the four columns and the honest badges (AC4), the
// empty state (AC5), the open card with its history and its session's log, Stop
// and Kill, Back and Esc (AC6), the kernel going away (AC7), the keys (AC8), the
// live refetch with unchanged cards staying put (AC9), the roles and the contrast
// (AC10) and the polish-gate screenshots with their README (AC11). The fixture
// records every read and every control POST, so "one refetch" and "after = last
// seq" are the kernel's own record.
//
// ⌘6 and the ⌘K palette are not exercised here: the shell mounts neither
// `CommandPaletteHost` nor the keyboard map (App.tsx), so a launched window has
// no ⌘ keys. `TasksScreen.test.tsx` pins ⌘6 (the shell's `screens.tasks`
// command, through `installKeyboardMap`) and `tasks.stop` / `tasks.kill` against
// the registry; this file reaches the screen through `#/tasks`, as the
// sidebar button does.
//
// Contrast (AC10): the title, the meta line, the kind line and each badge must be
// at least 4.5:1 against what they sit on, in both themes. The pair the check
// goes red for is `--ink-disabled` on `--surface` (about 2.3:1 light); the brief's
// mutation, `--ink` -> `--ink-tertiary` on the title, stays green because
// `--ink-tertiary` on `--surface` is itself above 4.5:1 in both themes.
//
// Screenshots (AC11): with `TASKS_EVIDENCE=1` every designed state, light and
// dark, is written to the committed `docs/evidence/phase-7-polish/tasks/`;
// otherwise to Playwright's per-test output dir, so CI and other lanes' e2e runs
// never dirty tracked files. The spec asserts behaviour, never pixels.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { appEnv, startFixtureKernel, unreachableDataDir } from "./fixture-kernel";
import type { FixtureKernel, FixtureRoute } from "./fixture-kernel";
import type { RouteKey } from "../src/api/contract";
import { feedEvent, item, populatedItems, reviewHistory, reviewLog, runningSessions, stamp, tasksKernel, tasksRoutes, waitingItems } from "./fixtures/tasks";
import type { TasksKernel, TasksKernelInit } from "./fixtures/tasks";
import { outputRow } from "./fixtures/sessions";

const EVIDENCE = process.env.TASKS_EVIDENCE === "1";
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/tasks/", import.meta.url));
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** The mockup's seven Tasks views, in the README's order: `tasks-<state>`. */
const STATES = ["empty", "loading", "populated", "waiting", "error", "unreachable", "history"] as const;
type State = (typeof STATES)[number];

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

interface Started {
  readonly kernel: TasksKernel;
  readonly fixture: FixtureKernel;
  /** Appends the event the kernel would, with the next id. */
  readonly push: (kind: string, ids?: { readonly session?: number | null; readonly task?: number | null }) => void;
}

/**
 * A fixture kernel serving `init`. One event is already in the feed, so the store proves itself live on its
 * first frame rather than after its settle timer (the refetch counts below then stay still).
 */
async function startKernel(init: TasksKernelInit, overrides: Partial<Record<RouteKey, FixtureRoute>> = {}): Promise<Started> {
  const kernel = tasksKernel(init);
  const started = await startFixtureKernel({ routes: { ...tasksRoutes(kernel), ...overrides }, events: [feedEvent(1, "task_created", { task: 9 })] });
  fixture = started;
  let id = 1;
  const push: Started["push"] = (kind, ids = {}) => {
    id += 1;
    started.appendEvent(feedEvent(id, kind, ids));
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

async function launch(env: Readonly<Record<string, string>>): Promise<Page> {
  app = await launchApp(env);
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  return page;
}

async function openTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/tasks";
  });
  await expect(page.getByTestId("screen-tasks")).toBeVisible();
}

/** Launch against `started`, open Tasks and wait for the first answer and for the feed. */
async function openWith(started: FixtureKernel, state: "empty" | "populated" = "populated"): Promise<Page> {
  const page = await launch(started.env);
  await openTasks(page);
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", state);
  await expect.poll(() => started.requests.some((r) => r.path === "/events/stream")).toBe(true);
  return page;
}

const card = (page: Page, key: string): Locator => page.getByTestId(`task-card-${key}`);
const column = (page: Page, id: "wait" | "work" | "park" | "done"): Locator => page.getByTestId(`tasks-col-${id}`);

async function keysIn(page: Page, id: "wait" | "work" | "park" | "done"): Promise<string[]> {
  return column(page, id)
    .locator("[data-card-key]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-card-key") ?? ""));
}

async function focusedKey(page: Page): Promise<string | null> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-card-key") ?? null);
}

/** How many times the board has been read (`GET /tasks`). */
function boardReads(started: FixtureKernel): number {
  return started.requests.filter((r) => r.method === "GET" && r.path === "/tasks").length;
}

/** Waits until the board stops being read: the first load, the feed going live and the first event are done. */
async function settled(started: FixtureKernel): Promise<number> {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    const now = boardReads(started);
    if (now === last) return now;
    last = now;
    await new Promise((done) => setTimeout(done, 600));
  }
  throw new Error("the board never stopped being read");
}

/** Tab until the focused element's accessible text starts with `label` (at most 40 stops). */
async function tabTo(page: Page, label: RegExp): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute("aria-label") ?? el?.textContent ?? "";
    });
    if (label.test(name.trim())) return;
  }
  throw new Error(`Tab never reached ${String(label)}`);
}

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

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/** The mockup's `t9` card and its session's history and log, over the running sessions. */
function reviewInit(items = populatedItems()): TasksKernelInit {
  return {
    items,
    sessions: runningSessions(),
    output: new Map([[41, reviewLog(41)]]),
    events: new Map([["task:9", reviewHistory()]]),
  };
}

const YESTERDAY = new Date(Date.now() - 36 * 3_600_000).toISOString();

test("AC4: four columns in the mockup's order; every state is the kernel's word; green only for done / done / completed; an unknown task state sits in Working", async () => {
  const items = [
    ...waitingItems(),
    item("playbook_run", 17, "done", { title: "Morning digest", agent: "wright", playbook: 3, ended: stamp(95), updated: stamp(95) }),
    item("session", 31, "completed", { agent: "ada", ended: stamp(96), updated: stamp(96) }),
    item("task", 50, "Waiting On Review", { title: "Needs a human look", updated: stamp(7) }),
    // Ended yesterday: not on a "Done today" board.
    item("session", 30, "completed", { agent: "ada", started: YESTERDAY, ended: YESTERDAY, updated: YESTERDAY }),
    item("task", 3, "done", { title: "Old task", updated: YESTERDAY }),
  ];
  const { fixture: started } = await startKernel({ items, sessions: runningSessions() });
  const page = await openWith(started);

  await expect(page.getByTestId("tasks-board").getByRole("heading", { level: 2 })).toHaveText(["Waiting on you", "Working", "Parked", "Done today"]);
  for (const label of ["Waiting on you", "Working", "Parked", "Done today"]) await expect(page.getByRole("region", { name: label })).toBeVisible();
  expect((await keysIn(page, "wait")).sort()).toEqual(["session:39", "task:12"]);
  expect((await keysIn(page, "work")).sort()).toEqual(["playbook_run:18", "session:44", "task:50", "task:9"]);
  expect((await keysIn(page, "park")).sort()).toEqual(["session:38", "task:7"]);
  expect((await keysIn(page, "done")).sort()).toEqual(["playbook_run:16", "playbook_run:17", "session:31", "session:40", "task:5"]);
  await expect(card(page, "session:30")).toHaveCount(0);
  await expect(card(page, "task:3")).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Task 12: Pick the repos Mason reviews first, waiting" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Playbook run 18: Weekly changelog draft, running" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Session 39: ada · ad hoc session, failed:auth" })).toBeVisible();

  const tones = await page.locator("[data-card-key]").evaluateAll((els) =>
    els.map((el) => [el.getAttribute("data-card-key"), el.querySelector(".badge")?.getAttribute("data-tone"), el.querySelector(".badge")?.textContent] as const),
  );
  const byKey = new Map(tones.map(([k, tone, word]) => [k, { tone, word }]));
  expect(
    tones
      .filter(([, tone]) => tone === "ok")
      .map(([k]) => k)
      .sort(),
  ).toEqual(["playbook_run:17", "session:31", "task:5"]);
  expect(byKey.get("playbook_run:16")).toEqual({ tone: "danger", word: "failed" });
  expect(byKey.get("session:39")).toEqual({ tone: "danger", word: "failed:auth" });
  expect(byKey.get("session:40")).toEqual({ tone: "neutral", word: "stopped" });
  expect(byKey.get("task:12")).toEqual({ tone: "attention", word: "waiting" });
  expect(byKey.get("task:7")).toEqual({ tone: "parked", word: "parked" });
  // The unknown word is shown as the kernel wrote it, neutral, never green and never hidden.
  expect(byKey.get("task:50")).toEqual({ tone: "neutral", word: "Waiting On Review" });

  await expect(page.getByTestId("tasks-attention-band")).toHaveText("2 things wait on you.");
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("13 cards · 4 working");
});

test("AC5: with no rows the designed empty state shows, never an empty board", async () => {
  const { fixture: started } = await startKernel({});
  const page = await openWith(started, "empty");
  await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();
  await expect(page.getByText(/A task appears here when Wright or a crew member takes on work/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask Wright" })).toBeVisible();
  await expect(page.getByTestId("tasks-board")).toHaveCount(0);
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("0 tasks");
});

test("AC6: a card opens with its facts, its history and its session's log; Stop shows the kernel's answer; Kill asks first; Back and Esc return with focus on the card", async () => {
  const { kernel, fixture: started, push } = await startKernel(reviewInit());
  const page = await openWith(started);

  // Open the working task by keyboard (Enter on the focused card).
  await card(page, "task:9").focus();
  await page.keyboard.press("Enter");
  const detail = page.getByTestId("task-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toBeFocused();
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "detail");
  await expect(detail.getByRole("heading", { level: 2, name: "Review PR #3 on studio-sandbox" })).toBeVisible();
  await expect(page.getByTestId("task-facts")).toContainText("Assignee");
  await expect(page.getByTestId("task-facts")).toContainText("mason");
  await expect(page.getByTestId("task-facts")).toContainText("#41");
  expect(kernel.historyReads.at(-1)).toEqual({ kind: "task", id: "9" });

  // History: the response's events, oldest first.
  const events = page.getByRole("list", { name: "History" }).getByRole("listitem");
  await expect(events).toHaveCount(4);
  await expect(events.first()).toContainText("trigger_fired");
  await expect(events.last()).toContainText("draft_output_recorded");
  await expect(page.getByTestId("task-history")).toContainText("History · 4");

  // The log: StreamingLog, read from the kernel; a running session shows live.
  const log = page.getByRole("log", { name: "Session output" });
  await expect(log).toContainText("The new retry loop never resets its counter after a success.");
  await expect(page.getByTestId("task-log-status")).toHaveText("running");
  expect(kernel.sessions.outputReads.filter((r) => r.id === 41).map((r) => [r.after, r.limit])).toEqual([["0", "500"]]);

  // A running session's log appends when the feed announces output for it.
  const before = kernel.sessions.output.get(41)?.at(-1)?.seq ?? 0;
  kernel.sessions.output.set(41, [...(kernel.sessions.output.get(41) ?? []), outputRow(41, before + 1, "assistant_text", { text: "A freshly announced line." })]);
  push("session_output_appended", { session: 41 });
  await expect(log).toContainText("A freshly announced line.");
  expect(kernel.sessions.outputReads.filter((r) => r.id === 41).map((r) => r.after)).toEqual(["0", String(before)]);

  // Stop: exactly one POST, and the status shown is the kernel's answer.
  await page.getByRole("button", { name: /^Stop/ }).click();
  await expect(page.getByTestId("task-log-status")).toHaveText("stopped · owner_stop");
  expect(kernel.sessions.posts.filter((p) => p.path.endsWith("/stop")).map((p) => p.path)).toEqual(["/sessions/41/stop"]);

  // Back returns to the board with focus on the card that opened it.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(card(page, "task:9")).toBeFocused();

  // A card with no session shows the "no log yet" note, and Esc goes back.
  await card(page, "task:7").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-nolog")).toContainText("No session is attached to this task. Nothing has run for it, so there is no log yet.");
  await expect(page.getByRole("log")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(card(page, "task:7")).toBeFocused();
});

test("AC6: Kill asks first: Cancel sends nothing; confirming sends one POST /sessions/:id/kill and shows the kernel's answer", async () => {
  const { kernel, fixture: started } = await startKernel(reviewInit());
  const page = await openWith(started);
  await card(page, "session:44").click();
  await expect(page.getByTestId("task-log-status")).toHaveText("running");
  await page.getByRole("button", { name: "Kill", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Kill session #44?");
  // Esc does not leave a destructive confirm, nor the card behind it.
  await page.keyboard.press("Escape");
  await expect(confirm).toBeVisible();
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "detail");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect(kernel.sessions.posts.filter((p) => p.path.endsWith("/kill"))).toEqual([]);
  await page.getByRole("button", { name: "Kill", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Kill" }).click();
  await expect(page.getByTestId("task-log-status")).toHaveText("stopped · owner_kill");
  expect(kernel.sessions.posts.filter((p) => p.path.endsWith("/kill")).map((p) => p.path)).toEqual(["/sessions/44/kill"]);
});

test("AC7: when the kernel goes away the board keeps its last data (last known), the cards are disabled, and it never falls back to the empty state", async () => {
  test.setTimeout(60_000);
  const { fixture: started } = await startKernel(reviewInit());
  const page = await openWith(started);
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working");
  // The kernel goes away under the open window: the fixture closes, the app stays.
  await started.close();
  fixture = undefined;

  await expect(page.getByTestId("kernel-reconnecting-band")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working · last known");
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(page.getByTestId("tasks-empty")).toHaveCount(0);
  await expect(card(page, "task:9")).toBeVisible();
  for (const key of await page.locator("[data-card-key]").evaluateAll((els) => els.map((el) => el.getAttribute("data-card-key") ?? ""))) {
    await expect(card(page, key)).toBeDisabled();
  }
  // A disabled card does not open.
  await card(page, "task:9").click({ force: true });
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
});

test("AC7: with the kernel unreachable the shell's band shows over the screen, which keeps its data (last known) with every card disabled", async () => {
  const { fixture: started } = await startKernel(reviewInit(waitingItems()), { "GET /status": () => ({ status: 503, body: { error: "unavailable" } }) });
  const page = await launch(started.env);
  await openTasks(page);
  const band = page.getByTestId("kernel-unreachable-band");
  await expect(band).toBeVisible();
  await expect(band).toContainText("Couldn't reach the kernel");
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("10 cards · 3 working · last known");
  await expect(page.getByTestId("tasks-empty")).toHaveCount(0);
  await expect(card(page, "task:12")).toBeDisabled();
  await expect(card(page, "task:9")).toBeDisabled();

  // The whole kernel is absent (api.json names a port nothing listens on): the board has nothing to keep, and says so, never "No tasks yet".
  const gone = await launchSecond(await unreachableDataDir());
  await expect(gone.getByTestId("kernel-unreachable-band")).toBeVisible();
  await expect(gone.getByTestId("screen-tasks")).toHaveAttribute("data-state", "error");
  await expect(gone.getByTestId("tasks-error")).toContainText("The kernel isn't answering");
  await expect(gone.getByTestId("tasks-empty")).toHaveCount(0);
});

/** Replace the running app with one launched on `dataDir`, on Tasks. */
async function launchSecond(dataDir: string): Promise<Page> {
  await app?.close();
  app = undefined;
  const page = await launch(appEnv(dataDir));
  await openTasks(page);
  return page;
}

test("AC8: J / K and the arrows move between cards across the columns, Enter opens, Tab reaches Back, Stop and Kill, Esc returns", async () => {
  const { fixture: started } = await startKernel(reviewInit(waitingItems()));
  const page = await openWith(started);
  const order = await page.locator("[data-card-key]").evaluateAll((els) => els.map((el) => el.getAttribute("data-card-key") ?? ""));
  expect(order).toHaveLength(10);
  // DOM order is column by column: Waiting on you, Working, Parked, Done today.
  const inColumns = [...(await keysIn(page, "wait")), ...(await keysIn(page, "work")), ...(await keysIn(page, "park")), ...(await keysIn(page, "done"))];
  expect(order).toEqual(inColumns);

  await page.keyboard.press("j");
  expect(await focusedKey(page)).toBe(order[0]);
  await page.keyboard.press("j");
  expect(await focusedKey(page)).toBe(order[1]);
  await page.keyboard.press("ArrowDown");
  expect(await focusedKey(page)).toBe(order[2]);
  await page.keyboard.press("k");
  expect(await focusedKey(page)).toBe(order[1]);
  await page.keyboard.press("ArrowUp");
  expect(await focusedKey(page)).toBe(order[0]);
  // Across the first column boundary: the last card of Waiting on you, then the first of Working.
  const waiting = (await keysIn(page, "wait")).length;
  for (let i = 0; i < waiting; i += 1) await page.keyboard.press("j");
  expect(await focusedKey(page)).toBe(order[waiting]);
  expect((await keysIn(page, "work")).includes(order[waiting] ?? "")).toBe(true);

  // Enter on a card with a live session opens it; Tab reaches Back, then the log's controls.
  await card(page, "session:44").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-detail")).toBeFocused();
  await tabTo(page, /^Back$/);
  await expect(page.getByRole("button", { name: "Back" })).toBeFocused();
  await tabTo(page, /^Stop/);
  await expect(page.getByRole("button", { name: /^Stop/ })).toBeFocused();
  await tabTo(page, /^Kill$/);
  await expect(page.getByRole("button", { name: "Kill", exact: true })).toBeFocused();
  // J / K do nothing inside a card; Esc returns with focus on the card that opened it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("j");
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "detail");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(card(page, "session:44")).toBeFocused();
});

test("AC9: an event refetches the board and moves the card without a reload; unchanged cards and the column headers keep their place; new session output refetches nothing", async () => {
  const { kernel, fixture: started, push } = await startKernel(reviewInit());
  const page = await openWith(started);
  const base = await settled(started);

  const heads = page.getByTestId("tasks-board").getByRole("heading", { level: 2 });
  const parked = card(page, "task:7");
  const headsBefore = await heads.evaluateAll((els) => els.map((el) => JSON.stringify(el.getBoundingClientRect())));
  const parkedBefore = await parked.boundingBox();
  await expect(column(page, "work").locator('[data-card-key="task:9"]')).toBeVisible();
  const parkedHandle = await parked.elementHandle();

  // Task 9 finishes: it leaves Working and lands in Done today.
  kernel.items = kernel.items.map((i) => (i.kind === "task" && i.id === 9 ? { ...i, state: "done", ended: null, updated: stamp(0) } : i));
  push("task_updated", { task: 9 });
  await expect(column(page, "done").locator('[data-card-key="task:9"]')).toBeVisible();
  await expect(column(page, "work").locator('[data-card-key="task:9"]')).toHaveCount(0);
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 2 working");
  expect(boardReads(started)).toBe(base + 1);

  // Unchanged: the parked card (same element, same box) and the four column headers.
  expect(await parked.boundingBox()).toEqual(parkedBefore);
  expect(await parkedHandle?.evaluate((el) => el.isConnected)).toBe(true);
  expect(await heads.evaluateAll((els) => els.map((el) => JSON.stringify(el.getBoundingClientRect())))).toEqual(headsBefore);

  // New output for a session: the log reads it; the board does not.
  push("session_output_appended", { session: 44 });
  await new Promise((done) => setTimeout(done, 900));
  expect(boardReads(started)).toBe(base + 1);
  // Any other event does.
  push("session_status", { session: 44 });
  await expect.poll(() => boardReads(started)).toBe(base + 2);
});

test("AC10: every card has an accessible name; every column is a labelled region; the log is a labelled role=log; text is at least 4.5:1 in both themes", async () => {
  const { fixture: started } = await startKernel(reviewInit(waitingItems()));
  const page = await openWith(started);

  // Every card button is named: kind, id, title and state.
  const unnamed = await page.locator("[data-card-key]").evaluateAll((els) => els.filter((el) => !/^(Task|Playbook run|Session) \d+: .+, .+$/.test(el.getAttribute("aria-label") ?? "")).length);
  expect(unnamed).toBe(0);
  await expect(page.getByTestId("tasks-board").getByRole("region")).toHaveCount(4);
  // A badge's state is text, never colour alone.
  const wordless = await page.locator(".tasks-card .badge").evaluateAll((els) => els.filter((el) => (el.textContent ?? "").trim() === "").length);
  expect(wordless).toBe(0);

  const checks = ".tasks-card-title, .tasks-card-meta, .tasks-card-kind, .tasks-card .badge";
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const rows = await page.evaluate((selector) => {
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
    }, checks);
    expect(rows.length, `${theme}: elements checked`).toBeGreaterThan(30);
    const low = rows.filter((r) => r.ratio < 4.5);
    expect(low, `${theme}: text under 4.5:1`).toEqual([]);
  }
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });

  // The log of an open card: a role=log with a label.
  await card(page, "task:9").click();
  await expect(page.getByRole("log", { name: "Session output" })).toBeVisible();
});

test("AC11: every designed state, in light and dark", async ({}, testInfo) => {
  test.setTimeout(180_000);
  if (EVIDENCE) {
    // The folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    for (const file of readdirSync(EVIDENCE_DIR)) if (file.endsWith(".png")) rmSync(join(EVIDENCE_DIR, file));
  }

  // Empty: the kernel has no row.
  {
    const { fixture: started } = await startKernel({});
    const page = await openWith(started, "empty");
    await expect(page.getByRole("heading", { name: "No tasks yet." })).toBeVisible();
    await blur(page);
    await shoot(page, "empty", testInfo);
    await closeAll(started);
  }

  // Loading: GET /tasks never answers, so the first read stays in flight (skeleton columns, never a spinner). The main
  // process times a read out after REQUEST_TIMEOUT_MS (10 s); the asserts run well inside it.
  {
    let held = 0;
    const { fixture: started } = await startKernel(reviewInit(), {
      "GET /tasks": () => {
        held += 1;
        return new Promise<never>(() => undefined);
      },
    });
    const page = await launch(started.env);
    await openTasks(page);
    await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "loading");
    await expect(page.locator(".tasks-skel").first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Loading tasks" })).toHaveCount(1);
    expect(held, "the screen's read reached the kernel and is still unanswered").toBeGreaterThan(0);
    await shoot(page, "loading", testInfo);
    await closeAll(started);
  }

  // Populated: three working, one parked, one interrupted, three done today; nothing waits on the owner.
  {
    const { fixture: started } = await startKernel(reviewInit());
    const page = await openWith(started);
    await expect(page.getByTestId("tasks-attention-band")).toHaveCount(0);
    await blur(page);
    await shoot(page, "populated", testInfo);
    await closeAll(started);
  }

  // Waiting on you: a task waiting on an answer and a session paused on the token, with the attention band.
  {
    const { fixture: started } = await startKernel(reviewInit(waitingItems()));
    const page = await openWith(started);
    await expect(page.getByTestId("tasks-attention-band")).toHaveText("2 things wait on you.");
    await blur(page);
    await shoot(page, "waiting", testInfo);
    await closeAll(started);
  }

  // Error: the kernel answers, but the tasks request fails: the failure card inside the screen, no band.
  {
    const { fixture: started } = await startKernel(reviewInit(), { "GET /tasks": () => ({ status: 500, body: { error: "store_unreadable", message: "the kernel could not read its store" } }) });
    const page = await launch(started.env);
    await openTasks(page);
    await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "error");
    await expect(page.getByTestId("tasks-error-detail")).toHaveText("GET /tasks · 500 · store_unreadable · the kernel could not read its store");
    await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
    await blur(page);
    await shoot(page, "error", testInfo);
    await closeAll(started);
  }

  // Unreachable: the shell's band over the board, which keeps its data, last known, every card disabled.
  {
    const { fixture: started } = await startKernel(reviewInit(), { "GET /status": () => ({ status: 503, body: { error: "unavailable" } }) });
    const page = await launch(started.env);
    await openTasks(page);
    await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible();
    await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working · last known");
    await expect(card(page, "task:9")).toBeDisabled();
    await blur(page);
    await shoot(page, "unreachable", testInfo);
    await closeAll(started);
  }

  // History: the click-through of the working task, its history beside its session's live log.
  {
    const { fixture: started } = await startKernel(reviewInit());
    const page = await openWith(started);
    await card(page, "task:9").click();
    await expect(page.getByRole("list", { name: "History" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("log", { name: "Session output" })).toContainText("writing the summary comment");
    await expect(page.getByTestId("task-log-status")).toHaveText("running");
    await blur(page);
    await shoot(page, "history", testInfo);
  }

  expect([...new Set(written)].sort()).toEqual(STATES.flatMap((s) => THEMES.map((t) => `${s}-${t}.png`)).sort());
});

test("the evidence README lists every state's screenshot in both themes, and the folder holds nothing else", () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const expected = STATES.flatMap((s) => THEMES.map((t) => `${s}-${t}.png`)).sort();
  expect(expected).toHaveLength(14);
  const listed = [...new Set(readme.match(/\b[a-z]+-(?:light|dark)\.png/g) ?? [])].sort();
  expect(listed).toEqual(expected);
  // Each pair is named against its mockup view id.
  for (const state of STATES) expect(readme, `tasks-${state}`).toContain(`tasks-${state}`);
  // Nothing else in the folder: the fourteen PNGs and the README.
  const onDisk = readdirSync(EVIDENCE_DIR).sort();
  expect(onDisk).toEqual([...expected, "README.md"].sort());
});
