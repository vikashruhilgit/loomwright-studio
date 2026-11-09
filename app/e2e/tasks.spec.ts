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
// The board words item adds: the Other group for a state word the board does not
// read, the creator on a card, the history as sentences with actors, the creator
// link, the shared band over the last board with the fixture's listener stopped
// and restarted, and the count line in the title bar.
//
// Screenshots (AC11): with `TASKS_EVIDENCE=1` every designed state, light and
// dark, is written to the committed `docs/evidence/phase-7-polish/tasks/`;
// otherwise to Playwright's per-test output dir, so CI and other lanes' e2e runs
// never dirty tracked files. The spec asserts behaviour, never pixels.
//
// Phase 8 (item 14, the tests after the phase 7 ones): a ticket's pull request as a card on the board and in its
// history. The columns and honest tones of the ticket cards, the "Waiting on you" link to the pending merge approval
// (only with a matching pending approval), the history as one sentence per PR state change with a link to each
// session's log, the last-known board, the keys and the contrast. Its screenshots go to
// `docs/evidence/phase-8-polish/tasks/` with `PHASE8_POLISH_EVIDENCE=1` (the switch every phase 8 polish spec
// shares), else to the per-test output dir; a test fails if the tracked folder changed during a plain run.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { appEnv, startFixtureKernel, unreachableDataDir } from "./fixture-kernel";
import type { FixtureKernel, FixtureRoute } from "./fixture-kernel";
import type { RouteKey } from "../src/api/contract";
import {
  PENDING_TICKET,
  TICKET_REPO,
  WAITING_TICKET,
  feedEvent,
  item,
  populatedItems,
  reviewHistory,
  reviewLog,
  runningSessions,
  stamp,
  tasksKernel,
  tasksRoutes,
  ticketInit,
  ticketItem,
  ticketItems,
  ticketPr,
  waitingItems,
} from "./fixtures/tasks";
import type { TasksKernel, TasksKernelInit } from "./fixtures/tasks";
import { mergeApproval } from "./fixtures/approvals";
import { outputRow } from "./fixtures/sessions";

const EVIDENCE = process.env.TASKS_EVIDENCE === "1";
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-7-polish/tasks/", import.meta.url));
/** Phase 8's evidence switch, shared by every phase 8 polish spec; its own dir for this screen. */
const PHASE8_EVIDENCE = process.env.PHASE8_POLISH_EVIDENCE === "1";
const PHASE8_DIR = fileURLToPath(new URL("../../docs/evidence/phase-8-polish/tasks/", import.meta.url));
/** When this run began, for the guard that the tracked phase 8 dir is untouched without `PHASE8_POLISH_EVIDENCE`. */
const RUN_START = Date.now();
/** The ticket -> PR views, named for the mockup's `tasks-populated`, `tasks-waiting`, `tasks-history` and `tasks-unreachable`. */
const TICKET_SHOTS = ["ticket-populated", "ticket-waiting", "ticket-pending", "ticket-history", "ticket-unreachable"] as const;
type TicketShot = (typeof TICKET_SHOTS)[number];
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** The mockup's eight Tasks views, in the README's order: `tasks-<state>`. */
const STATES = ["empty", "loading", "populated", "waiting", "other", "error", "unreachable", "history"] as const;
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
type ColumnId = "wait" | "work" | "park" | "done" | "other";
const column = (page: Page, id: ColumnId): Locator => page.getByTestId(`tasks-col-${id}`);

async function keysIn(page: Page, id: ColumnId): Promise<string[]> {
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

/** `reviewInit` with task 9 created in Wright's session 44 (a card on the board): its first event is Wright's. */
function createdInit(): TasksKernelInit {
  const init = reviewInit(populatedItems().map((i) => (i.kind === "task" && i.id === 9 ? { ...i, creator_agent: "wright", creator_session: 44 } : i)));
  return { ...init, events: new Map([["task:9", reviewHistory().map((e) => (e.id === 102 ? { ...e, session_id: 44 } : e))]]) };
}

const YESTERDAY = new Date(Date.now() - 36 * 3_600_000).toISOString();

test("AC4: four columns in the mockup's order; every state is the kernel's word; green only for done / done / completed; an unknown task state sits in Other", async () => {
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

  await expect(page.getByTestId("tasks-board").getByRole("heading", { level: 2 })).toHaveText(["Waiting on you", "Working", "Parked", "Done today", "Other"]);
  for (const label of ["Waiting on you", "Working", "Parked", "Done today", "Other"]) await expect(page.getByRole("region", { name: label })).toBeVisible();
  expect((await keysIn(page, "wait")).sort()).toEqual(["session:39", "task:12"]);
  expect((await keysIn(page, "work")).sort()).toEqual(["playbook_run:18", "session:44", "task:9"]);
  expect(await keysIn(page, "other")).toEqual(["task:50"]);
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
  // The unknown word is shown as the kernel wrote it, in Other, neutral, never green and never hidden.
  expect(byKey.get("task:50")).toEqual({ tone: "neutral", word: "Waiting On Review" });

  await expect(page.getByTestId("tasks-attention-band")).toHaveText("2 things wait on you.");
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("13 cards · 3 working");
});

test("the fixture refuses what the kernel route refuses: limit and id outside the rules answer 400, an unknown card 404", async () => {
  const routes = tasksRoutes(tasksKernel({ items: populatedItems() }));
  const answer = async (key: RouteKey, query: Record<string, string>, params: Record<string, string> = {}): Promise<number> => {
    const route = routes[key];
    if (typeof route !== "function") throw new Error(`no handler for ${key}`);
    return (await route({ method: "GET", path: "/", params, query, body: undefined })).status;
  };
  for (const limit of ["201", "0", "-1", "1.5", "abc", "", "050", "9007199254740993"]) expect(await answer("GET /tasks", { limit }), `limit=${limit}`).toBe(400);
  for (const limit of ["1", "200"]) expect(await answer("GET /tasks", { limit }), `limit=${limit}`).toBe(200);
  expect(await answer("GET /tasks", { before: "not-a-cursor" })).toBe(400);
  const history = (kind: string, id: string): Promise<number> => answer("GET /tasks/:kind/:id", {}, { kind, id });
  expect(await history("nope", "1")).toBe(400);
  for (const id of ["0", "-1", "1.5", "abc", "01"]) expect(await history("task", id), `id=${id}`).toBe(400);
  expect(await history("task", "999999")).toBe(404);
});

test("the Other group: a task in state `waiting on owner` shows under Other with its raw word, a creator on the card, and the group is absent when empty", async () => {
  const noOne = item("task", 14, "needs a human", { title: "Nobody recorded", agent: null, updated: stamp(9) });
  const made = item("task", 13, "waiting on owner", { title: "Decide how often Mason checks", agent: null, creator_agent: "wright", creator_session: 44, started: stamp(8), updated: stamp(8) });
  const { fixture: started } = await startKernel({ items: [...waitingItems(), made, noOne], sessions: runningSessions() });
  const page = await openWith(started);

  await expect(page.getByTestId("tasks-board").getByRole("heading", { level: 2 })).toHaveText(["Waiting on you", "Working", "Parked", "Done today", "Other"]);
  expect((await keysIn(page, "other")).sort()).toEqual(["task:13", "task:14"]);
  expect(await keysIn(page, "work")).not.toContain("task:13");
  expect(await keysIn(page, "wait")).not.toContain("task:13");
  await expect(card(page, "task:13").getByTestId("task-card-state")).toHaveText("waiting on owner");
  await expect(card(page, "task:13").locator(".badge")).toHaveAttribute("data-tone", "neutral");
  // The creator is named when there is no assignee; with neither, the card says so.
  await expect(card(page, "task:13").locator(".tasks-card-meta")).toContainText(/wright/i);
  await expect(card(page, "task:14").locator(".tasks-card-meta")).toContainText("No agent recorded");
  await expect(page.getByTestId("tasks-board")).not.toContainText("unknown agent");
  // Waiting is its own word: the band counts the two that wait, never the Other card.
  await expect(page.getByTestId("tasks-attention-band")).toHaveText("2 things wait on you.");
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("12 cards · 3 working");

  // The group is absent when no card is in it.
  await closeAll(started);
  const { fixture: plain } = await startKernel({ items: waitingItems(), sessions: runningSessions() });
  const again = await openWith(plain);
  await expect(column(again, "other")).toHaveCount(0);
  await expect(again.getByTestId("tasks-board").getByRole("heading", { level: 2 })).toHaveText(["Waiting on you", "Working", "Parked", "Done today"]);
});

test("the title bar draws the count line beside the title, and the screen draws no band of its own for it", async () => {
  const { fixture: started } = await startKernel(reviewInit());
  const page = await openWith(started);
  const subtitle = page.getByTestId("titlebar-subtitle");
  await expect(subtitle).toHaveText("8 cards · 3 working");
  await expect(subtitle.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working");
  await expect(page.getByTestId("screen-tasks").getByTestId("tasks-subtitle")).toHaveCount(0);
  await expect(page.locator(".tasks-bar")).toHaveCount(0);
  // Beside the title: the bar's h1 first, then the line.
  await expect(page.locator("header.titlebar > h1 + [data-testid=titlebar-subtitle]")).toHaveCount(1);
});

test("the cap line shows only when the board holds the cap: 201 rows leave 'Showing the newest 200 cards'; fewer rows show none", async () => {
  test.setTimeout(60_000);
  const many = Array.from({ length: 201 }, (_, i) => item("task", i + 1, "working", { title: `Task ${i + 1}`, updated: stamp(i % 90) }));
  const { fixture: started } = await startKernel({ items: many });
  const page = await openWith(started);
  await expect(page.getByTestId("tasks-more")).toHaveText("Showing the newest 200 cards; older ones are not shown.");
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("200 cards · 200 working");

  await closeAll(started);
  const { fixture: few } = await startKernel({ items: many.slice(0, 20) });
  const again = await openWith(few);
  await expect(again.getByTestId("tasks-subtitle")).toHaveText("20 cards · 20 working");
  await expect(again.getByTestId("tasks-more")).toHaveCount(0);
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
  // Each entry is a sentence and an actor, never the stored JSON.
  await expect(events.nth(1).getByTestId("task-event-sentence")).toHaveText("Created “Review PR #3 on studio-sandbox” · state working");
  await expect(events.nth(1).getByTestId("task-event-actor")).toHaveText("kernel");
  await expect(events.nth(2).getByTestId("task-event-actor")).toHaveText("mason");
  await expect(events.first().getByTestId("task-event-sentence")).toHaveText("trigger_fired recorded");
  const history = (await page.getByTestId("task-history").textContent()) ?? "";
  expect(history).not.toContain("{");
  expect(history).not.toContain('"title":');

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

  // The store reads `reconnecting` (it was live); the shell shows the one shared red band for it, not the old small line.
  await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible({ timeout: 20_000 });
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

test("the creator: a task's detail shows 'Created in' as a link to the creator session's own card; its history names Wright; the task's own log note stays", async () => {
  const items = [...populatedItems(), item("task", 13, "waiting on owner", { title: "Decide how often Mason checks", agent: null, creator_agent: "wright", creator_session: 44, started: stamp(8), updated: stamp(8) })];
  const events = new Map([["task:13", [feedEvent(201, "task_created", { task: 13, session: 44 }, { title: "Decide how often Mason checks", state: "waiting on owner" })]]]);
  const { kernel, fixture: started } = await startKernel({ items, sessions: runningSessions(), events, output: new Map([[44, reviewLog(44)]]) });
  const page = await openWith(started);

  await card(page, "task:13").click();
  const facts = page.getByTestId("task-facts");
  await expect(facts).toContainText("Created in");
  await expect(facts).not.toContainText("Assignee");
  // The creator is an actor in the history; the task has no session of its own, so its log note stays and Stop / Kill are not offered.
  const first = page.getByRole("list", { name: "History" }).getByRole("listitem").first();
  await expect(first.getByTestId("task-event-sentence")).toHaveText("Created “Decide how often Mason checks” · state waiting on owner");
  await expect(first.getByTestId("task-event-actor")).toHaveText("wright");
  await expect(page.getByTestId("task-nolog")).toContainText("No session is attached to this task.");
  await expect(page.getByRole("button", { name: /^Stop/ })).toHaveCount(0);
  expect(kernel.sessions.outputReads.filter((r) => r.id === 44)).toEqual([]);

  // The link opens session 44's own card (its log), where Stop and Kill belong to that session.
  await facts.getByTestId("task-created-in").click();
  await expect(page.getByTestId("task-detail")).toHaveAttribute("data-card-key", "session:44");
  await expect(page.getByTestId("task-log")).toHaveAttribute("data-session-id", "44");
  await expect(page.getByTestId("task-log-status")).toHaveText("running");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
});

test("AC1: stopping the fixture's listener keeps the last board under the shell's one band, writes off, no request text; restarting reads the board again", async () => {
  test.setTimeout(90_000);
  const { fixture: started } = await startKernel(reviewInit());
  const page = await openWith(started);
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
  await expect(card(page, "task:9")).toBeEnabled();
  const base = await settled(started);

  await started.stop();
  const band = page.getByTestId("kernel-unreachable-band");
  await expect(band).toBeVisible({ timeout: 20_000 });
  await expect(band).toHaveCount(1);
  // The screen's own band is for a read that failed before the shell noticed: the shell's is the only one.
  await expect(page.getByTestId("tasks-kernel-band")).toHaveCount(0);
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working · last known");
  await expect(card(page, "task:9")).toBeVisible();
  await expect(card(page, "task:9")).toBeDisabled();
  await expect(page.getByTestId("tasks-empty")).toHaveCount(0);
  await expect(page.getByTestId("tasks-error")).toHaveCount(0);
  const text = (await page.getByTestId("screen-tasks").textContent()) ?? "";
  expect(text).not.toMatch(/GET \/tasks|connection_failed|ECONNREFUSED|\b50[0-9]\b/);
  expect((await band.textContent()) ?? "").not.toMatch(/GET|\/tasks|ECONN|status/);

  await started.restart();
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working", { timeout: 30_000 });
  await expect(card(page, "task:9")).toBeEnabled();
  expect(boardReads(started)).toBeGreaterThan(base);
});

test("AC1: opening Tasks again with the listener stopped shows the last board, marked last known, cards disabled; restarting the listener reads it again (AC2)", async () => {
  test.setTimeout(90_000);
  const { fixture: started } = await startKernel(reviewInit());
  const page = await openWith(started);
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working");
  const base = await settled(started);

  await started.stop();
  const band = page.getByTestId("kernel-unreachable-band");
  await expect(band).toBeVisible({ timeout: 20_000 });

  // Leave Tasks (the screen really unmounts), then open it again with the kernel still away.
  await page.evaluate(() => {
    window.location.hash = "#/chat";
  });
  await expect(page.getByTestId("screen-tasks")).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = "#/tasks";
  });
  await expect(page.getByTestId("screen-tasks")).toBeVisible();

  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working · last known");
  await expect(card(page, "task:9")).toBeVisible();
  await expect(card(page, "task:9")).toBeDisabled();
  // A disabled card opens nothing, so no Stop or Kill is reachable.
  await card(page, "task:9").click({ force: true });
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
  await expect(page.getByTestId("tasks-error")).toHaveCount(0);
  await expect(page.getByTestId("tasks-empty")).toHaveCount(0);
  await expect(band).toHaveCount(1);

  // AC2: the listener comes back; the next read replaces the remembered board and the mark goes.
  await started.restart();
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 3 working", { timeout: 30_000 });
  await expect(card(page, "task:9")).toBeEnabled();
  expect(boardReads(started)).toBeGreaterThan(base);
});

test("kind icons: every card's kind line starts with its kind icon, ahead of the label text, and the card's name is unchanged", async () => {
  const { fixture: started } = await startKernel(reviewInit());
  const page = await openWith(started);
  const rows = await page.locator("[data-card-key]").evaluateAll((els) =>
    els.map((el) => {
      const line = el.querySelector(".tasks-card-kind") as HTMLElement;
      const svgs = [...line.querySelectorAll("svg")];
      const label = line.querySelector(".tasks-card-label") as HTMLElement;
      const text = [...label.childNodes].find((n) => n.nodeType === Node.TEXT_NODE) as Text;
      const range = document.createRange();
      range.selectNodeContents(text);
      const words = range.getBoundingClientRect();
      const icon = svgs[0]?.getBoundingClientRect();
      return {
        key: el.getAttribute("data-card-key"),
        icons: svgs.length,
        hidden: svgs[0]?.getAttribute("aria-hidden"),
        markup: svgs[0]?.innerHTML ?? "",
        text: text.textContent,
        width: icon?.width ?? 0,
        before: icon === undefined ? false : icon.right <= words.left,
        name: el.getAttribute("aria-label") ?? "",
      };
    }),
  );
  expect(rows).toHaveLength(8);
  for (const row of rows) {
    expect(row.icons, `${row.key}: one icon`).toBe(1);
    expect(row.hidden, `${row.key}: decorative`).toBe("true");
    expect(row.width, `${row.key}: drawn`).toBeGreaterThan(0);
    expect(row.before, `${row.key}: icon before the text`).toBe(true);
    expect(row.text).toMatch(/^(Task|Playbook run|Session) #\d+$/);
    expect(row.name).toMatch(/^(Task|Playbook run|Session) \d+: .+, .+$/);
  }
  expect(rows.find((r) => r.key === "task:9")?.text).toBe("Task #9");
  // The icon matches the kind: one drawing per kind, shared by its cards and different from the other kinds'.
  const byKind = new Map<string, Set<string>>();
  for (const row of rows) {
    const kind = (row.key ?? "").split(":")[0] ?? "";
    byKind.set(kind, (byKind.get(kind) ?? new Set()).add(row.markup));
  }
  expect([...byKind.keys()].sort()).toEqual(["playbook_run", "session", "task"]);
  for (const [kind, drawings] of byKind) expect(drawings.size, `${kind}: one icon drawing`).toBe(1);
  expect(new Set([...byKind.values()].map((d) => [...d][0])).size, "three kinds, three drawings").toBe(3);
});

test("the crumb: a card's detail draws the shell's crumb, ‹ Tasks / Task #9, and activating it returns to the board with focus on the card", async () => {
  const { fixture: started } = await startKernel(reviewInit());
  const page = await openWith(started);
  await card(page, "task:9").click();
  const back = page.getByTestId("task-back");
  await expect(back).toHaveAccessibleName("Back to Tasks");
  await expect(back).toHaveText("Tasks");
  const row = back.locator("xpath=..");
  const visible = (await row.evaluate((el) => (el as HTMLElement).innerText)).replace(/\s+/g, "");
  expect(visible).toBe("Tasks/Task#9");
  expect(visible).not.toContain("Back");
  // The chevron is inside the one button and sits before the word.
  const chevron = await back.evaluate((el) => {
    const svgs = el.querySelectorAll("svg");
    // The label sits in the Button's own wrapper, so walk to its text node.
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Text;
    const range = document.createRange();
    range.selectNodeContents(text);
    return { icons: svgs.length, width: svgs[0]?.getBoundingClientRect().width ?? 0, before: (svgs[0]?.getBoundingClientRect().right ?? Infinity) <= range.getBoundingClientRect().left };
  });
  expect(chevron.icons).toBe(1);
  expect(chevron.width).toBeGreaterThan(0);
  expect(chevron.before).toBe(true);
  await back.click();
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(card(page, "task:9")).toBeFocused();
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
  await tabTo(page, /^Back to Tasks$/);
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

/** The WCAG contrast of every element `selector` matches, text on what it sits on, in the page's current theme. */
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
    const rows = await contrastRows(page, checks);
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

  // Other: the populated board plus a task in state `waiting on owner` (a word the board does not read) and no agent
  // recorded for it, as the mockup's `tasks-other` view. It is not in Working and not hidden.
  {
    const made = item("task", 13, "waiting on owner", { title: "Decide how often Mason checks studio-sandbox", agent: null, started: stamp(8), updated: stamp(8) });
    const { fixture: started } = await startKernel(reviewInit([...populatedItems(), made]));
    const page = await openWith(started);
    await expect(page.getByRole("heading", { level: 2, name: "Other" })).toBeVisible();
    await expect(column(page, "other").getByTestId("task-card-state")).toHaveText("waiting on owner");
    await expect(column(page, "other").locator(".tasks-card-meta")).toContainText("No agent recorded");
    await expect(page.getByTestId("tasks-attention-band")).toHaveCount(0);
    await expect(page.getByTestId("tasks-subtitle")).toHaveText("9 cards · 3 working");
    await blur(page);
    await shoot(page, "other", testInfo);
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

  // History: the click-through of the working task, its history as sentences with actors beside its session's live log.
  {
    const { fixture: started } = await startKernel(createdInit());
    const page = await openWith(started);
    await card(page, "task:9").click();
    await expect(page.getByRole("list", { name: "History" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByTestId("task-facts")).toContainText("Created in");
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
  expect(expected).toHaveLength(16);
  const listed = [...new Set(readme.match(/\b[a-z]+-(?:light|dark)\.png/g) ?? [])].sort();
  expect(listed).toEqual(expected);
  // Each pair is named against its mockup view id.
  for (const state of STATES) expect(readme, `tasks-${state}`).toContain(`tasks-${state}`);
  // Nothing else in the folder: the sixteen PNGs and the README.
  const onDisk = readdirSync(EVIDENCE_DIR).sort();
  expect(onDisk).toEqual([...expected, "README.md"].sort());
});

// ---- phase 8: a ticket's pull request on the board ------------------------------------------------------------------

/** The text and tone of one badge on a ticket card: `testid` is `task-card-state`, `ticket-approvals` or `ticket-ci`. */
async function pill(page: Page, key: string, testid: "task-card-state" | "ticket-approvals" | "ticket-ci"): Promise<readonly [string | null, string | null]> {
  const badge = card(page, key).getByTestId(testid).locator(".badge");
  return [await badge.textContent(), await badge.getAttribute("data-tone")];
}

test("phase 8 AC1, AC3, AC7: ticket cards read their ticket, PR, state, approvals, CI and owner; the column follows the PR's state; green only for what the kernel recorded", async () => {
  const { fixture: started } = await startKernel(ticketInit({ waiting: false }));
  const page = await openWith(started);

  // AC7: open / draft / ready are Working, parked is Parked, merged / closed are Done today; the plain task keeps its column.
  expect(await keysIn(page, "wait")).toEqual([]);
  expect((await keysIn(page, "work")).sort()).toEqual(["task:20", "task:62", "task:63", "task:64"]);
  expect((await keysIn(page, "park")).sort()).toEqual(["task:61", "task:65"]);
  expect((await keysIn(page, "done")).sort()).toEqual(["task:66", "task:67"]);
  await expect(page.getByTestId("tasks-attention-band")).toHaveCount(0);
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 4 working");

  // Each card: its ticket (from the ref's prefix), PR, state, approvals, CI and owner words, in the kernel's tones.
  const expected: Record<string, { line: string; state: readonly [string, string]; approvals: readonly [string, string]; ci: readonly [string, string]; owner: RegExp }> = {
    "task:61": { line: "Issue #14→PR #21", state: ["parked", "parked"], approvals: ["Approve in Studio", "neutral"], ci: ["CI green", "ok"], owner: /^ada · parked \/automate item$/i },
    "task:62": { line: "ClickUp CU-8a41→PR #22", state: ["open", "neutral"], approvals: ["0/2 approvals", "neutral"], ci: ["CI pending", "neutral"], owner: /^ada · live \/automate run$/i },
    "task:63": { line: "Issue #12→PR #19", state: ["ready", "accent"], approvals: ["Solo", "neutral"], ci: ["CI green", "ok"], owner: /^ada · you or the App$/i },
    "task:64": { line: "Issue #15→PR #23", state: ["draft", "neutral"], approvals: ["0/2 approvals", "neutral"], ci: ["CI failing", "danger"], owner: /^mason · someone else$/i },
    "task:65": { line: "Issue #3→PR #4", state: ["parked", "parked"], approvals: ["No policy", "parked"], ci: ["CI green", "ok"], owner: /^ada · you or the App$/i },
    "task:66": { line: "Issue #9→PR #17", state: ["merged", "ok"], approvals: ["Solo", "neutral"], ci: ["CI green", "ok"], owner: /^ada · live \/automate run$/i },
    "task:67": { line: "Issue #7→PR #16", state: ["closed", "neutral"], approvals: ["Solo", "neutral"], ci: ["CI failing", "danger"], owner: /^ada · you or the App$/i },
  };
  for (const [key, want] of Object.entries(expected)) {
    await expect(card(page, key).locator(".ticket-kind"), key).toHaveText(want.line);
    expect(await pill(page, key, "task-card-state"), `${key} state`).toEqual(want.state);
    expect(await pill(page, key, "ticket-approvals"), `${key} approvals`).toEqual(want.approvals);
    expect(await pill(page, key, "ticket-ci"), `${key} CI`).toEqual(want.ci);
    await expect(card(page, key).getByTestId("ticket-owner"), key).toHaveText(want.owner);
  }

  // AC3: nothing on a pending-CI card is green; a null CI and a "none" are never green either.
  await expect(card(page, "task:62").locator('.badge[data-tone="ok"]')).toHaveCount(0);
  await expect(card(page, "task:62").locator(".ticket-dot[data-dot='idle']")).toHaveCount(1);
  await expect(card(page, "task:64").locator(".ticket-dot[data-dot='danger']")).toHaveCount(1);
  // Green is exactly: merged, and CI green. A parked PR with Approve in Studio is not green.
  const greens = await page.locator("[data-card-key] .badge").evaluateAll((els) =>
    els.filter((el) => el.getAttribute("data-tone") === "ok").map((el) => `${el.closest("[data-card-key]")?.getAttribute("data-card-key")}:${el.textContent}`),
  );
  expect(greens.sort()).toEqual(["task:61:CI green", "task:63:CI green", "task:65:CI green", "task:66:CI green", "task:66:merged"].sort());

  // The parked No policy PR shows the mockup's note and a link to Integrations; nothing on a card writes.
  await expect(page.getByTestId("ticket-card-task:65").getByTestId("ticket-policy-note")).toContainText("Set this repo's merge policy to move it on.");
  await expect(card(page, "task:66").getByTestId("ticket-meta")).toContainText("by Loomwright's gate");
  // The kernel serves no triage tally, so none is drawn: no comment counts anywhere on the board.
  expect((await page.getByTestId("tasks-board").textContent()) ?? "").not.toMatch(/\d+ (fix|reply|answer)|comments?:/i);

  // A plain task is drawn exactly as before.
  await expect(card(page, "task:20").locator(".tasks-card-label")).toHaveText("Task #20");
  await expect(page.getByTestId("ticket-card-task:20")).toHaveCount(0);
});

test("phase 8 AC1: a PR on a reviews: 2 repo with one approval and CI green reads '1/2 approvals' (neutral) and 'CI green' (ok)", async () => {
  const pr = ticketPr(30, "open", { ticket: "github:vikashruhilgit/studio-sandbox#14", approvals: "1/2", ci: "green", owner_kind: "automate_live" });
  const { fixture: started } = await startKernel({ items: [ticketItem(70, "Wire the queue", pr)] });
  const page = await openWith(started);
  await expect(card(page, "task:70").locator(".ticket-kind")).toHaveText("Issue #14→PR #30");
  expect(await pill(page, "task:70", "ticket-approvals")).toEqual(["1/2 approvals", "neutral"]);
  expect(await pill(page, "task:70", "ticket-ci")).toEqual(["CI green", "ok"]);
  expect(await pill(page, "task:70", "task-card-state")).toEqual(["open", "neutral"]);
  await expect(card(page, "task:70")).toHaveAccessibleName("Task 70: Wire the queue, open. GitHub Issue #14. PR 30 open. 1/2 approvals. CI green. live /automate run.");
});

test("phase 8 AC1: the ticket's source is read only from the ref's prefix: ClickUp and Jira by their own, any other ref shown raw with no icon, no ticket for null", async () => {
  const at = (n: number, ticket: string | null) => ticketItem(80 + n, `Ticket ${n}`, ticketPr(40 + n, "open", { ticket, ci: "none", approvals: "solo" }));
  const items = [at(1, "github:vikashruhilgit/ntfs-tool#3"), at(2, "clickup:86abc12"), at(3, "jira:acme.atlassian.net/PROJ-12"), at(4, "linear:ENG-4"), at(5, null)];
  const { fixture: started } = await startKernel({ items });
  const page = await openWith(started);
  await expect(card(page, "task:81").locator(".ticket-kind")).toHaveText("Issue #3→PR #41");
  await expect(card(page, "task:82").locator(".ticket-kind")).toHaveText("ClickUp 86abc12→PR #42");
  await expect(card(page, "task:83").locator(".ticket-kind")).toHaveText("Jira PROJ-12→PR #43");
  await expect(card(page, "task:84").locator(".ticket-kind")).toHaveText("linear:ENG-4→PR #44");
  await expect(card(page, "task:84").locator(".ticket-src svg")).toHaveCount(0);
  await expect(card(page, "task:85").locator(".ticket-kind")).toHaveText("PR #45");
  await expect(card(page, "task:85").locator(".ticket-src")).toHaveCount(0);
  // CI "none" is not green either.
  expect(await pill(page, "task:81", "ticket-ci")).toEqual(["No CI checks", "neutral"]);
});

test("phase 8 AC2: a parked PR with a matching pending merge approval sits in Waiting on you with 'Open approval #7', which opens #/approvals/7; the open card shows the same band and link", async () => {
  const { fixture: started } = await startKernel(ticketInit());
  const page = await openWith(started);

  expect(await keysIn(page, "wait")).toEqual(["task:61"]);
  expect(await keysIn(page, "park")).toEqual(["task:65"]);
  await expect(page.getByTestId("tasks-attention-band")).toHaveText("1 thing waits on you.");
  const face = page.getByTestId("ticket-card-task:61");
  await expect(face.getByTestId("ticket-waiting")).toContainText("Waiting on you");
  expect(await pill(page, "task:61", "ticket-approvals")).toEqual(["Approve in Studio", "attention"]);
  await expect(card(page, "task:61")).toHaveAccessibleName(/^Task 61: Add retry reset to the queue loop, parked\. GitHub Issue #14\. PR 21 parked\. Approve in Studio\. CI green\. parked \/automate item\. Waiting on you\.$/);
  // The link is a sibling of the card button, never inside it.
  await expect(card(page, "task:61").getByRole("button")).toHaveCount(0);
  // The other parked card has no pending approval, so it does not wait.
  await expect(page.getByTestId("ticket-card-task:65").getByTestId("ticket-waiting")).toHaveCount(0);

  // The open card: the same band and link.
  await card(page, "task:61").click();
  const band = page.getByTestId("ticket-waiting-band");
  await expect(band).toContainText("Waiting on you: approval #7 for PR #21.");
  await expect(page.getByTestId("task-facts")).toContainText("Approve in Studio");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");

  // The link goes to the approval, which the Approvals screen selects.
  await face.getByRole("button", { name: "Open approval #7" }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/approvals/7");
  await expect(page.getByTestId("screen-approvals")).toBeVisible();
  await expect(page.getByTestId("merge-card")).toBeVisible();
});

test("phase 8 AC2: with no matching pending approval the card shows no 'waiting on you', whatever its state word says", async () => {
  // Pending approvals that name another PR, and the same PR number in another repo, and a decided one (which the kernel does not list as pending).
  const at54 = { requesting_session: 54 };
  const approvals = [
    mergeApproval(5, { fields: { repo: TICKET_REPO, pr: 99 }, overrides: at54 }),
    mergeApproval(6, { fields: { repo: "vikashruhilgit/ntfs-tool", pr: 21 }, overrides: at54 }),
    mergeApproval(8, { fields: { repo: TICKET_REPO, pr: 21 }, overrides: { ...at54, status: "approved", decision: "once" } }),
  ];
  const { fixture: started } = await startKernel({ ...ticketInit(), approvals });
  const page = await openWith(started);
  expect(await keysIn(page, "wait")).toEqual([]);
  expect((await keysIn(page, "park")).sort()).toEqual(["task:61", "task:65"]);
  await expect(page.getByTestId("ticket-waiting")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open approval/ })).toHaveCount(0);
  await expect(card(page, "task:61")).not.toHaveAccessibleName(/Waiting on you/);
  await expect(page.getByTestId("tasks-attention-band")).toHaveCount(0);
});

test("phase 8 AC4: the history lists each PR state change once, oldest first, as a sentence; each event with a session links that session's log; the sessions and approvals are listed with their links", async () => {
  const { kernel, fixture: started } = await startKernel(ticketInit());
  const page = await openWith(started);
  await card(page, "task:61").click();
  await expect(page.getByTestId("task-detail")).toBeVisible();
  expect(kernel.historyReads.at(-1)).toEqual({ kind: "task", id: String(WAITING_TICKET) });

  const events = page.getByRole("list", { name: "History" }).getByRole("listitem");
  await expect(events).toHaveCount(7);
  await expect(page.getByTestId("task-history")).toContainText("History · 7");
  const sentences = await events.getByTestId("task-event-sentence").allTextContents();
  expect(sentences).toEqual([
    "Created “Add retry reset to the queue loop” · state open",
    "session_started recorded",
    "PR #21: opened → open · CI pending · approvals 0",
    "comment_routed recorded",
    "PR #21: open → open · CI green · approvals 0",
    "session_started recorded",
    "PR #21: open → parked · CI green · approvals 0 · reason awaiting_merge",
  ]);
  // Each PR state change once, never the stored JSON.
  expect(sentences.filter((s) => s.startsWith("PR #21:"))).toHaveLength(3);
  const text = (await page.getByTestId("task-history").textContent()) ?? "";
  expect(text).not.toContain("{");
  expect(text).not.toContain("head_sha");
  expect(text).not.toContain(TICKET_REPO);
  // The actor is the agent of the event's session, or the kernel.
  expect(await events.getByTestId("task-event-actor").allTextContents()).toEqual(["kernel", "ada", "kernel", "ada", "kernel", "ada", "ada"]);

  // Every event with a session links that session; the kernel's own events do not.
  expect(await page.getByTestId("task-event-session").allTextContents()).toEqual(["Session 51 log", "Session 53 log", "Session 54 log", "Session 54 log"]);
  await expect(events.nth(2).getByTestId("task-event-session")).toHaveCount(0);
  // The default log is the merge-item run (the task's own session, 54); a link shows another's.
  await expect(page.getByTestId("task-log")).toHaveAttribute("data-session-id", "54");
  await expect(page.getByRole("log", { name: "Session output" })).toContainText("the item parks as awaiting_merge");
  await events.nth(1).getByTestId("task-event-session").click();
  await expect(page.getByTestId("task-log")).toHaveAttribute("data-session-id", "51");
  await expect(page.getByRole("log", { name: "Session output" })).toContainText("The retry loop never resets its counter after a success.");

  // The history's sessions and approvals are listed with their links.
  const sessions = page.getByRole("list", { name: "Sessions" }).getByTestId("task-session-row");
  await expect(sessions).toHaveCount(3);
  expect(await sessions.evaluateAll((rows) => rows.map((row) => /Session #(\d+)/.exec(row.textContent ?? "")?.[1]))).toEqual(["51", "53", "54"]);
  await sessions.filter({ hasText: "Session #53" }).getByRole("button", { name: "Show session 53 log" }).click();
  await expect(page.getByTestId("task-log")).toHaveAttribute("data-session-id", "53");
  await expect(sessions.filter({ hasText: "Session #53" }).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  const approvals = page.getByRole("list", { name: "Approvals" });
  await expect(approvals).toContainText("Approval #7 · kernel_merge_approval_request");
  await approvals.getByRole("button", { name: "Open approval #7" }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/approvals/7");
});

test("phase 8 AC4: a plain task's history is unchanged: no session links, no Sessions list", async () => {
  const { fixture: started } = await startKernel(ticketInit());
  const page = await openWith(started);
  await card(page, "task:20").click();
  await expect(page.getByTestId("task-detail")).toBeVisible();
  await expect(page.getByTestId("task-event-session")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Sessions" })).toHaveCount(0);
  await expect(page.getByTestId("ticket-waiting-band")).toHaveCount(0);
});

test("phase 8 AC5: opening Tasks again with the listener stopped shows the last known ticket cards with their approvals, CI and owner words, marked, every card disabled, and no request text", async () => {
  test.setTimeout(90_000);
  const { fixture: started } = await startKernel(ticketInit());
  const page = await openWith(started);
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 4 working");
  await settled(started);

  await started.stop();
  await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible({ timeout: 20_000 });
  // Leave Tasks (the screen really unmounts), then open it again with the kernel still away.
  await page.evaluate(() => {
    window.location.hash = "#/chat";
  });
  await expect(page.getByTestId("screen-tasks")).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = "#/tasks";
  });
  await expect(page.getByTestId("screen-tasks")).toBeVisible();

  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 4 working · last known");
  const keys = ["task:61", "task:62", "task:63", "task:64", "task:65", "task:66", "task:67"];
  for (const key of keys) {
    await expect(card(page, key), key).toBeVisible();
    await expect(card(page, key), key).toBeDisabled();
    await expect(card(page, key).getByTestId("ticket-last-known"), key).toHaveText("Last known");
    await expect(card(page, key), key).toHaveAccessibleName(/Last known\.$/);
  }
  // The words are the last read ones: approvals, CI and owner.
  expect(await pill(page, "task:62", "ticket-approvals")).toEqual(["0/2 approvals", "neutral"]);
  expect(await pill(page, "task:62", "ticket-ci")).toEqual(["CI pending", "neutral"]);
  await expect(card(page, "task:62").getByTestId("ticket-owner")).toHaveText(/live \/automate run/);
  expect(await pill(page, "task:66", "ticket-ci")).toEqual(["CI green", "ok"]);
  // The shared approvals resource kept its last data, so PR #21 still waits on #7, and its link is off.
  await expect(card(page, "task:61").getByTestId("ticket-last-known")).toBeVisible();
  const link = page.getByRole("button", { name: "Open approval #7" });
  await expect(link).toHaveAttribute("aria-disabled", "true");
  // A disabled card opens nothing, and no request text is shown.
  await card(page, "task:61").click({ force: true });
  await expect(page.getByTestId("task-detail")).toHaveCount(0);
  await link.click({ force: true });
  expect(await page.evaluate(() => window.location.hash)).toBe("#/tasks");
  const text = (await page.getByTestId("screen-tasks").textContent()) ?? "";
  expect(text).not.toMatch(/GET \/tasks|connection_failed|ECONNREFUSED|\b50[0-9]\b/);
  await expect(page.getByTestId("tasks-empty")).toHaveCount(0);
  await expect(page.getByTestId("tasks-error")).toHaveCount(0);
});

test("phase 8 AC8: ticket cards keep the board's accessible name and keys; the footer link is beside the card button, never inside it; text is at least 4.5:1 in both themes", async () => {
  const { fixture: started } = await startKernel(ticketInit());
  const page = await openWith(started);

  // Every card (ticket or plain) is a named button of the board's form; no button sits inside another.
  const unnamed = await page.locator("[data-card-key]").evaluateAll((els) => els.filter((el) => !/^(Task|Playbook run|Session) \d+: .+, .+$/.test(el.getAttribute("aria-label") ?? "")).length);
  expect(unnamed).toBe(0);
  expect(await page.locator("[data-card-key] button, button button").count()).toBe(0);
  expect(await page.locator("[data-card-key]").evaluateAll((els) => els.every((el) => el.tagName === "BUTTON" && el.getAttribute("type") === "button"))).toBe(true);

  // J / K walk the ticket cards in column order, Enter opens one, Esc returns with focus on it. The footer link is not a card.
  const order = await page.locator("[data-card-key]").evaluateAll((els) => els.map((el) => el.getAttribute("data-card-key") ?? ""));
  expect(order).toEqual(["task:61", "task:62", "task:63", "task:64", "task:20", "task:65", "task:66", "task:67"].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  expect(order).toHaveLength(8);
  await page.keyboard.press("j");
  expect(await focusedKey(page)).toBe(order[0]);
  await page.keyboard.press("j");
  expect(await focusedKey(page)).toBe(order[1]);
  await page.keyboard.press("k");
  expect(await focusedKey(page)).toBe(order[0]);
  await card(page, "task:62").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("task-detail")).toHaveAttribute("data-card-key", "task:62");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("screen-tasks")).toHaveAttribute("data-state", "populated");
  await expect(card(page, "task:62")).toBeFocused();

  // Contrast: the card's words, badges, the footer note and the link, in both themes.
  const checks = ".tasks-card-title, .tasks-card-meta, .tasks-card-kind, .ticket-src, .ticket-pr, .ticket-foot-note, .ticket-card .badge, .ticket-foot .btn";
  for (const theme of THEMES) {
    await setTheme(page, theme);
    const rows = await contrastRows(page, checks);
    expect(rows.length, `${theme}: elements checked`).toBeGreaterThan(40);
    expect(rows.filter((r) => r.ratio < 4.5), `${theme}: text under 4.5:1`).toEqual([]);
  }
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });
});

// ---- phase 8 screenshots ---------------------------------------------------------------------------------------------

const ticketWritten: string[] = [];

/** Both themes of one ticket view, to the committed phase 8 dir with `PHASE8_POLISH_EVIDENCE=1`, else to the per-test dir. */
async function shootTicket(page: Page, shot: TicketShot, testInfo: TestInfo, height = 1100): Promise<void> {
  // Taller than the default window, so every card of the board is in one shot.
  await app?.evaluate(({ BrowserWindow }, h) => BrowserWindow.getAllWindows()[0]?.setContentSize(1180, h), height);
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBeGreaterThanOrEqual(height - 40);
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    grounds.push(await ground(page));
    const file = `tasks-${shot}-${theme}.png`;
    const path = PHASE8_EVIDENCE ? join(PHASE8_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
    ticketWritten.push(file);
  }
  expect(grounds[0]).not.toBe(grounds[1]);
  await page.evaluate(() => {
    delete document.documentElement.dataset.theme;
  });
}

test("phase 8 AC9: every ticket card and history state, in light and dark", async ({}, testInfo) => {
  test.setTimeout(180_000);
  if (PHASE8_EVIDENCE) {
    // The folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
    mkdirSync(PHASE8_DIR, { recursive: true });
    for (const file of readdirSync(PHASE8_DIR)) if (file.endsWith(".png")) rmSync(join(PHASE8_DIR, file));
  }

  // Populated: the seven ticket cards and a plain task; PR #21 is parked, with no approval waiting yet.
  {
    const { fixture: started } = await startKernel(ticketInit({ waiting: false }));
    const page = await openWith(started);
    await expect(card(page, "task:61")).toBeVisible();
    await expect(page.getByTestId("tasks-attention-band")).toHaveCount(0);
    await blur(page);
    await shootTicket(page, "ticket-populated", testInfo);
    await closeAll(started);
  }

  // Waiting on you: PR #21 waits on approval #7, with its footer link and the attention band.
  {
    const { fixture: started } = await startKernel(ticketInit());
    const page = await openWith(started);
    await expect(page.getByTestId("tasks-attention-band")).toHaveText("1 thing waits on you.");
    await expect(page.getByTestId("ticket-waiting")).toContainText("Waiting on you");
    await blur(page);
    await shootTicket(page, "ticket-waiting", testInfo);
    await closeAll(started);
  }

  // Pending: a PR with CI pending and 0/2 approvals, beside a draft whose CI failed: nothing is green.
  {
    const init = ticketInit({ waiting: false });
    const items = ticketItems().filter((i) => [PENDING_TICKET, 64, 20].includes(i.id));
    const { fixture: started } = await startKernel({ ...init, items });
    const page = await openWith(started);
    await expect(card(page, "task:62")).toBeVisible();
    await expect(page.locator('[data-card-key] .badge[data-tone="ok"]')).toHaveCount(0);
    await blur(page);
    await shootTicket(page, "ticket-pending", testInfo, 620);
    await closeAll(started);
  }

  // Unreachable: the shell's band over the board, which keeps its ticket cards, last known, every card disabled.
  {
    const { fixture: started } = await startKernel(ticketInit(), { "GET /status": () => ({ status: 503, body: { error: "unavailable" } }) });
    const page = await launch(started.env);
    await openTasks(page);
    await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible();
    await expect(page.getByTestId("tasks-subtitle")).toHaveText("8 cards · 4 working · last known");
    await expect(card(page, "task:61")).toBeDisabled();
    await expect(card(page, "task:61").getByTestId("ticket-last-known")).toBeVisible();
    await blur(page);
    await shootTicket(page, "ticket-unreachable", testInfo);
    await closeAll(started);
  }

  // History: the waiting PR opened, its PR state changes as sentences with session links, its sessions, its approval and its log.
  {
    const { fixture: started } = await startKernel(ticketInit());
    const page = await openWith(started);
    await card(page, "task:61").click();
    await expect(page.getByRole("list", { name: "History" }).getByRole("listitem")).toHaveCount(7);
    await expect(page.getByTestId("ticket-waiting-band")).toBeVisible();
    await expect(page.getByRole("log", { name: "Session output" })).toContainText("approval #7 requested");
    await blur(page);
    await shootTicket(page, "ticket-history", testInfo, 1500);
  }

  expect([...new Set(ticketWritten)].sort()).toEqual(TICKET_SHOTS.flatMap((s) => THEMES.map((t) => `tasks-${s}-${t}.png`)).sort());
});

test("phase 8 AC9: without PHASE8_POLISH_EVIDENCE nothing under the tracked phase 8 tasks dir changed during the run", () => {
  test.skip(PHASE8_EVIDENCE, "an evidence run writes the tracked dir on purpose");
  const touched = readdirSync(PHASE8_DIR).filter((name) => statSync(join(PHASE8_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-8-polish/tasks/ is newer than this run's start").toEqual([]);
});

test("phase 8 AC9: the evidence README lists every ticket screenshot in both themes with the views they match, how to regenerate them and the deviations, and the folder holds nothing else", () => {
  const readme = readFileSync(join(PHASE8_DIR, "README.md"), "utf8");
  const expected = TICKET_SHOTS.flatMap((s) => THEMES.map((t) => `tasks-${s}-${t}.png`)).sort();
  expect(expected).toHaveLength(10);
  const listed = [...new Set(readme.match(/\btasks-ticket-[a-z]+-(?:light|dark)\.png/g) ?? [])].sort();
  expect(listed).toEqual(expected);
  // Nothing else in the folder: the ten PNGs and the README.
  expect(readdirSync(PHASE8_DIR).sort()).toEqual([...expected, "README.md"].sort());
  // Each shot is named against the mockup view it matches.
  for (const view of ["tasks-populated", "tasks-waiting", "tasks-history", "tasks-unreachable"]) expect(readme, `the README names the mockup view ${view}`).toContain(`\`${view}\``);
  expect(readme).toContain("PHASE8_POLISH_EVIDENCE=1");
  expect(readme).toContain("npx playwright test e2e/tasks.spec.ts");
  // The deviations: the tally the kernel does not serve (AC6), and the label prefix the board keeps (AC8).
  expect(readme).toContain("Deviations from the mockup");
  for (const word of ["comment_tally", "comment_routed", "Task <id>:"]) expect(readme, `the README names ${word}`).toContain(word);
});
