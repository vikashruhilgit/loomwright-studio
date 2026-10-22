// The Sessions screen in the built app, against the fixture kernel
// (`./fixtures/sessions.ts`), phase 5 item 16. Run `npm run build` first.
//
// Each test launches the app through the harness (hidden window), opens
// `#/sessions` and drives it by keyboard: the list order, its words and the
// kernel's honest status (AC1), the live log read after the last seq and kept
// in place when scrolled up (AC2), decisions inline and the escaped log (AC3),
// Stop (AC4), Kill and its confirm (AC5), a failed kill (AC6), Abandon (AC7)
// and keyboard-only reach (AC9). The fixture records every control POST and
// every output read, so "exactly one request" and "after = last seq" are the
// kernel's own record.
//
// Screenshots (AC8): with `SESSIONS_EVIDENCE=1` every designed state, light
// and dark, is written to the committed `docs/evidence/phase-5-polish/sessions/`;
// otherwise to Playwright's per-test output dir, so CI and other lanes' e2e
// runs never dirty tracked files. The spec asserts behaviour, never pixels.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { appEnv, startFixtureKernel, unreachableDataDir } from "./fixture-kernel";
import type { FixtureKernel, FixtureRoute } from "./fixture-kernel";
import type { RouteKey } from "../src/api/contract";
import {
  ESC,
  RLO,
  ago,
  appendOutput,
  deferred,
  filler,
  finishedOutput,
  heldApproval,
  hostileOutput,
  lastSeq,
  outputRow,
  ownerStop,
  reviewOutput,
  sessionEvent,
  sessionsKernel,
  sessionsRoutes,
  summary,
} from "./fixtures/sessions";
import type { SessionsKernel, SessionsKernelInit } from "./fixtures/sessions";

const EVIDENCE = process.env.SESSIONS_EVIDENCE === "1";
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-5-polish/sessions/", import.meta.url));
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** Every designed state, in the README's order. */
const STATES = ["empty", "loading", "error", "waiting", "populated", "ended"] as const;
type State = (typeof STATES)[number];

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

/** A fixture kernel serving `kernel` (`overrides` replace its routes); every control's event is pushed through the feed. */
async function startKernel(
  init: SessionsKernelInit,
  overrides: Partial<Record<RouteKey, FixtureRoute>> = {},
): Promise<{ kernel: SessionsKernel; fixture: FixtureKernel; push: (kind: string, sessionId: number | null) => void }> {
  const kernel = sessionsKernel(init);
  const started = await startFixtureKernel({ routes: { ...sessionsRoutes(kernel), ...overrides } });
  fixture = started;
  let id = 0;
  const push = (kind: string, sessionId: number | null): void => {
    id += 1;
    started.appendEvent(sessionEvent(id, kind, sessionId));
  };
  kernel.onChange = push;
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

async function openSessions(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/sessions";
  });
  await expect(page.getByTestId("screen-sessions")).toBeVisible();
}

/** Launch against `started`, open Sessions, and wait for the feed and the first answer. */
async function openWith(started: FixtureKernel, state: "empty" | "populated" = "populated"): Promise<Page> {
  const page = await launch(started.env);
  await openSessions(page);
  await expect(page.getByTestId("screen-sessions")).toHaveAttribute("data-state", state);
  await expect.poll(() => started.requests.some((r) => r.path === "/events/stream")).toBe(true);
  return page;
}

function rows(page: Page) {
  return page.getByRole("listbox", { name: "Sessions" }).getByRole("option");
}

async function rowIds(page: Page): Promise<number[]> {
  return rows(page).evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-key"))));
}

function selectedRow(page: Page) {
  return page.getByRole("listbox", { name: "Sessions" }).locator('[role="option"][aria-selected="true"]');
}

function row(page: Page, id: number) {
  return page.getByTestId(`session-row-${id}`);
}

function statusOf(page: Page, id: number) {
  return row(page, id).getByTestId("session-status");
}

/** Press J until session `id` is selected (at most 20 presses). */
async function selectById(page: Page, id: number): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if ((await selectedRow(page).getAttribute("data-key")) === String(id)) return;
    const order = await rowIds(page);
    const at = order.indexOf(Number(await selectedRow(page).getAttribute("data-key")));
    await page.keyboard.press(order.indexOf(id) > at ? "j" : "k");
  }
  await expect(selectedRow(page)).toHaveAttribute("data-key", String(id));
}

function postsTo(kernel: SessionsKernel, suffix: string) {
  return kernel.posts.filter((p) => p.path.endsWith(suffix));
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

/** The AC1 kernel: one running session, two ended, one kill-unconfirmed, two orphans. */
function listInit(): SessionsKernelInit {
  return {
    sessions: [
      summary(30, { agent: "ada", status: "stopped", started: ago(20), ended: ago(10), tokens: 3100 }),
      summary(31, { agent: "mason", status: "running", playbook: 4, started: ago(4.2), ended: null, tokens: 14_208 }),
      summary(29, { agent: "wright", status: "completed", playbook: 2, started: ago(60), ended: ago(50), tokens: 22_800 }),
      summary(28, { agent: "ada", status: "failed", started: ago(80), ended: ago(70), tokens: null }),
      summary(27, { agent: "mason", status: "orphaned", started: ago(120), ended: null }),
      summary(26, { agent: "ada", status: "orphaned", started: ago(130), ended: null }),
    ],
    output: new Map([
      [31, reviewOutput(31)],
      [30, finishedOutput(30)],
    ]),
    killUnconfirmed: [{ id: 28, agent: "ada", status: "failed", pgid: 4242, kill_incomplete_at: ago(70) }],
    orphaned: [
      { id: 27, agent: "mason", pgid: 4100, reason: "leader_unverified", updated_at: ago(100) },
      { id: 26, agent: "ada", pgid: 4101, reason: "reap_error", updated_at: ago(110) },
    ],
  };
}

test("AC1: running first and selected; each row's avatar, agent, task, time, tokens and the kernel's word; kill unconfirmed; the orphan reason", async () => {
  const { fixture: started } = await startKernel(listInit());
  const page = await openWith(started);
  await expect.poll(() => rowIds(page)).toEqual([31, 30, 29, 28, 27, 26]);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "31");

  const first = row(page, 31);
  await expect(first.getByRole("img", { name: /^mason · / })).toBeVisible();
  await expect(first.getByTestId("session-agent")).toHaveText("mason");
  await expect(first.getByTestId("session-task")).toHaveText("playbook #4");
  await expect(first.getByTestId("session-elapsed")).toHaveText(/^\d+m \d\ds$/);
  await expect(first.getByTestId("session-tokens")).toHaveText("14,208 tokens");
  await expect(first.getByTestId("session-status")).toHaveText("running");

  await expect(row(page, 30).getByTestId("session-task")).toHaveText("ad hoc session");
  await expect(row(page, 30).getByTestId("session-status")).toHaveText("stopped");
  await expect(row(page, 30).getByTestId("session-elapsed")).toHaveText("10m 00s");
  await expect(row(page, 29).getByTestId("session-status")).toHaveText("completed");
  await expect(row(page, 28).getByTestId("session-kill-unconfirmed")).toHaveText("kill unconfirmed");
  await expect(row(page, 28).getByTestId("session-tokens")).toHaveText("—");
  await expect(row(page, 27).getByTestId("session-orphan-reason")).toHaveText("leader_unverified");
  await expect(row(page, 26).getByTestId("session-orphan-reason")).toHaveText("reap_error");
  for (const id of [30, 29, 27, 26]) await expect(row(page, id).getByTestId("session-kill-unconfirmed")).toHaveCount(0);

  // #28 has no token count: the log header hides its figure rather than saying "0 tokens".
  await selectById(page, 28);
  await expect(page.getByTestId("session-detail")).toHaveAttribute("data-session-id", "28");
  await expect(page.getByTestId("session-log")).toHaveAttribute("data-output", "read");
  await expect(page.getByTestId("streaming-log-tokens")).toBeHidden();
  await selectById(page, 29);
  await expect(page.getByTestId("streaming-log-tokens")).toHaveText("22,800 tokens");
});

test("AC2: new output appears; the next read is after the last seq, never 0 again; scrolled up, the view stays and the pill says Jump to latest", async () => {
  const { kernel, fixture: started, push } = await startKernel({
    sessions: [summary(31, { agent: "mason", status: "running", started: ago(4), ended: null })],
    output: new Map([[31, [...reviewOutput(31), ...filler(31, 18, 40)]]]),
  });
  const page = await openWith(started);
  const log = page.getByRole("log", { name: "Session output" });
  await expect(log).toContainText("Checked file 57 of the diff.");
  expect(kernel.outputReads.filter((r) => r.id === 31).map((r) => [r.after, r.limit])).toEqual([["0", "500"]]);

  const before = lastSeq(kernel, 31);
  appendOutput(kernel, 31, [outputRow(31, before + 1, "assistant_text", { text: "New line one." }), outputRow(31, before + 2, "tool_call", { name: "Read", input_json: '{"file_path":"a.ts"}' })]);
  push("session_output_appended", 31);
  await expect(log).toContainText("New line one.");
  await expect.poll(() => kernel.outputReads.filter((r) => r.id === 31).map((r) => r.after)).toEqual(["0", String(before)]);
  await expect(page.getByTestId("streaming-log-pill")).toHaveText("Following");

  // Scroll the log up: following pauses.
  const top = await log.evaluate((el) => {
    el.scrollTop = 40;
    if (el.scrollHeight <= el.clientHeight) throw new Error("the log does not scroll: it is not bounded by the pane");
    el.dispatchEvent(new Event("scroll"));
    return el.scrollTop;
  });
  await expect(page.getByTestId("streaming-log-pill")).toHaveText("Jump to latest");
  const next = lastSeq(kernel, 31);
  appendOutput(kernel, 31, filler(31, next + 1, 5));
  push("session_output_appended", 31);
  await expect(log).toContainText(`Checked file ${next + 5} of the diff.`);
  expect(await log.evaluate((el) => el.scrollTop)).toBe(top);
  await expect(page.getByTestId("streaming-log-pill")).toHaveText("Jump to latest");
  const afters = kernel.outputReads.filter((r) => r.id === 31).map((r) => r.after);
  expect(afters).toEqual(["0", String(before), String(next)]);
  expect(afters.slice(1)).not.toContain("0");
});

test("AC3: every kind shows inline, decisions with their reasons; ANSI and bidi show escaped; the cwd is shown, or cwd unknown", async () => {
  const { fixture: started } = await startKernel({
    sessions: [
      summary(31, { agent: `ma${RLO}son`, status: "running", started: ago(4), ended: null, cwd: `/Users/owner/src/${ESC}[31mstudio` }),
      summary(30, { status: "completed", cwd: null }),
    ],
    output: new Map([
      [31, [...reviewOutput(31), ...hostileOutput(31, 18), outputRow(31, 21, "result", { subtype: "success", counted_tokens: 14_208 })]],
      [30, finishedOutput(30, "error_max_turns")],
    ]),
  });
  const page = await openWith(started);
  const log = page.getByRole("log", { name: "Session output" });
  await expect(log).toContainText("Bash denied · never_category · git push --force origin main");
  await expect(log).toContainText("Bash held · approval #7 · approval_required");
  await expect(log).toContainText("Bash allowed · policy_allow");
  await expect(log).toContainText("init · model sonnet · 14 tools");
  await expect(log).toContainText("exit 0 · hook_success · no decision recorded");
  await expect(log).toContainText("success · 14208 tokens");
  await expect(log.locator('[data-kind="error"]', { hasText: "denied · never_category" })).toHaveCount(1);
  await expect(log.locator('[data-kind="error"]', { hasText: "held · approval #7" })).toHaveCount(1);
  await expect(log).toContainText("\\x1b[31mOK\\x1b[0m written to notes\\u202etxt.exe");
  await expect(page.getByTestId("session-cwd")).toHaveText("/Users/owner/src/\\x1b[31mstudio");
  await expect(row(page, 31).getByTestId("session-agent")).toHaveText("ma\\u202eson");
  const raw = await page.evaluate(() => {
    const text = document.body.textContent ?? "";
    return [...text].filter((c) => /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(c)).map((c) => c.charCodeAt(0));
  });
  expect(raw).toEqual([]);

  await page.keyboard.press("j");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "30");
  await expect(page.getByTestId("session-cwd")).toHaveText("cwd unknown");
  await expect(log).toContainText("error_max_turns · 22800 tokens");
});

test("an ended session's No output stays hidden while its first read is in flight, and shows once an empty read answers (sessions.css, applied)", async () => {
  const { kernel, fixture: started } = await startKernel({ sessions: [summary(30, { status: "completed", tokens: null })] });
  const gate = deferred<void>();
  kernel.holdOutput = () => gate.promise;
  const page = await openWith(started);
  const empty = page.locator(".streaming-log__empty");
  await expect.poll(() => kernel.outputReads.filter((r) => r.id === 30).length).toBe(1);
  await expect(page.getByTestId("session-output-reading")).toBeVisible();
  await expect(page.getByTestId("session-log")).toHaveAttribute("data-output", "unread");
  // In the DOM (StreamingLog renders it for an ended session with no lines), but hidden by the stylesheet.
  await expect(empty).toHaveCount(1);
  await expect(empty).toBeHidden();
  // The token figure (and the separator before it) is hidden too: the kernel has no count, never "0 tokens".
  await expect(page.getByTestId("streaming-log-tokens")).toBeHidden();
  const separator = await page.getByTestId("streaming-log-tokens").evaluate((el) => {
    const before = el.previousElementSibling;
    return before === null ? null : { text: before.textContent, display: getComputedStyle(before).display };
  });
  expect(separator).toEqual({ text: " · ", display: "none" });

  gate.release();
  await expect(page.getByTestId("session-log")).toHaveAttribute("data-output", "read");
  await expect(empty).toBeVisible();
  await expect(empty).toHaveText("No output");
  await expect(page.getByTestId("session-output-reading")).toHaveCount(0);
});

test("AC4: ⌘. sends exactly one stop; the row says stopping… while the kernel holds it, stopped only after it answers; a 409 shows the answered status", async () => {
  const { kernel, fixture: started } = await startKernel({
    sessions: [summary(31, { agent: "mason", status: "running", started: ago(4), ended: null }), summary(32, { status: "running", started: ago(30), ended: null })],
    output: new Map([[31, reviewOutput(31)]]),
  });
  const gate = deferred<void>();
  kernel.stop = async (req) => {
    if (req.params.id === "32") return { status: 409, body: { error: "not_running", status: "completed" } };
    await gate.promise;
    return ownerStop(kernel, req, "owner_stop");
  };
  const page = await openWith(started);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "31");

  await page.keyboard.press("Meta+.");
  await expect(statusOf(page, 31)).toHaveText("stopping…");
  await page.keyboard.press("Meta+.");
  await page.waitForTimeout(500);
  await expect(statusOf(page, 31)).toHaveText("stopping…");
  expect(postsTo(kernel, "/stop").map((p) => p.path)).toEqual(["/sessions/31/stop"]);

  gate.release();
  await expect(statusOf(page, 31)).toHaveText("stopped");
  await expect(row(page, 31).getByTestId("session-reason")).toHaveText(" · owner_stop");
  expect(postsTo(kernel, "/stop")).toHaveLength(1);

  // #31 has ended, so #32 (running) now sorts above it: select it by id.
  await selectById(page, 32);
  await page.keyboard.press("Meta+.");
  await expect(statusOf(page, 32)).toHaveText("completed");
  await expect(page.getByTestId("session-notice")).toHaveText("The kernel refused (409 not_running).");
});

test("AC5: Kill asks first; Escape keeps the confirm open; Cancel sends nothing; Confirm sends exactly one kill", async () => {
  const { kernel, fixture: started } = await startKernel({
    sessions: [summary(31, { agent: "mason", status: "running", started: ago(4), ended: null })],
    output: new Map([[31, reviewOutput(31)]]),
  });
  const page = await openWith(started);
  await page.getByRole("button", { name: "Kill", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Kill session #31?");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await expect(confirm).toBeVisible();
  expect(postsTo(kernel, "/kill")).toHaveLength(0);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(postsTo(kernel, "/kill")).toHaveLength(0);
  await expect(statusOf(page, 31)).toHaveText("running");

  await page.getByRole("button", { name: "Kill", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Kill" }).click();
  await expect(statusOf(page, 31)).toHaveText("stopped");
  await expect(row(page, 31).getByTestId("session-reason")).toHaveText(" · owner_kill");
  expect(postsTo(kernel, "/kill").map((p) => p.path)).toEqual(["/sessions/31/kill"]);
});

test("AC6: a kill answered {failed, kill_incomplete}: the row and the log header say failed and kill_incomplete with a danger badge, never stopped", async () => {
  const { kernel, fixture: started, push } = await startKernel({
    sessions: [summary(31, { agent: "mason", status: "running", started: ago(4), ended: null })],
    output: new Map([[31, reviewOutput(31)]]),
  });
  kernel.kill = (req) => {
    const id = Number(req.params.id);
    kernel.sessions = kernel.sessions.map((s) => (s.id === id ? { ...s, status: "failed", ended: new Date().toISOString() } : s));
    kernel.killUnconfirmed = [{ id, agent: "mason", status: "failed", pgid: 4242, kill_incomplete_at: new Date().toISOString() }];
    push("session_status", id);
    return { status: 200, body: { id, status: "failed", reason: "kill_incomplete" } };
  };
  const page = await openWith(started);
  await page.getByRole("button", { name: "Kill", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Kill" }).click();
  await expect(statusOf(page, 31)).toHaveText("failed");
  await expect(row(page, 31).getByTestId("session-danger")).toHaveText("kill_incomplete");
  await expect(row(page, 31).getByTestId("session-danger").locator("[data-tone]")).toHaveAttribute("data-tone", "danger");
  await expect(page.getByTestId("session-log-status")).toHaveText("failed · kill_incomplete");
  await expect(row(page, 31).getByTestId("session-kill-unconfirmed")).toHaveText("kill unconfirmed");
  // After the list catches up, still failed: never shown as stopped.
  await page.waitForTimeout(600);
  await expect(row(page, 31)).not.toContainText("stopped");
  await expect(page.getByTestId("session-log-status")).toHaveText("failed · kill_incomplete");
});

test("AC7: Abandon is offered only for a leader_unverified orphan; Escape and Cancel send nothing; Confirm sends exactly one; the row says abandoned", async () => {
  const { kernel, fixture: started } = await startKernel(listInit());
  const page = await openWith(started);
  const abandon = page.getByRole("button", { name: "Abandon", exact: true });
  for (const id of [31, 30, 29, 28, 26]) {
    await selectById(page, id);
    await expect(page.getByTestId("session-detail")).toHaveAttribute("data-session-id", String(id));
    await expect(abandon).toHaveCount(0);
  }
  await selectById(page, 27);
  await expect(abandon).toBeVisible();

  await abandon.click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Abandon session #27?");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(postsTo(kernel, "/abandon")).toHaveLength(0);

  await abandon.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Abandon" }).click();
  await expect(statusOf(page, 27)).toHaveText("abandoned");
  await expect(abandon).toHaveCount(0);
  expect(postsTo(kernel, "/abandon").map((p) => p.path)).toEqual(["/sessions/27/abandon"]);
  // Abandon left the DOM holding the focus the confirm handed back: the detail has it, never <body>.
  await expect(page.getByTestId("session-detail")).toBeFocused();
});

test("AC9: keyboard only reaches J/K, ⌘. Stop, Kill and its confirm, Abandon and its confirm, Jump to latest and Read latest", async () => {
  test.setTimeout(60_000);
  const init = listInit();
  const { kernel, fixture: started } = await startKernel({
    ...init,
    sessions: [...(init.sessions ?? []), summary(33, { agent: "ada", status: "running", started: ago(2), ended: null })],
    output: new Map([
      [31, [...reviewOutput(31), ...filler(31, 18, 40)]],
      [33, reviewOutput(33)],
    ]),
  });
  const page = await openWith(started);
  await expect.poll(() => rowIds(page)).toEqual([33, 31, 30, 29, 28, 27, 26]);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "33");

  // J / K.
  await page.keyboard.press("j");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "31");
  await page.keyboard.press("k");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "33");
  await page.keyboard.press("j");

  // Read latest and Jump to latest on #31's log.
  const log = page.getByRole("log", { name: "Session output" });
  await expect(log).toContainText("Checked file 57 of the diff.");
  await tabTo(page, /^Read latest/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("streaming-log-latest")).toHaveText("Checked file 57 of the diff.");
  await tabTo(page, /^Session output$/);
  await expect(log).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("streaming-log-pill")).toHaveText("Jump to latest");
  // Chromium animates a keyboard scroll: let Home finish, or its remaining frames undo the jump below.
  await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBe(0);
  await tabTo(page, /^Jump to latest/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("streaming-log-pill")).toHaveText("Following");

  // ⌘. stops #31.
  await page.keyboard.press("Meta+.");
  await expect(statusOf(page, 31)).toHaveText("stopped");
  expect(postsTo(kernel, "/stop").map((p) => p.path)).toEqual(["/sessions/31/stop"]);

  // Kill #33 and its confirm: focus lands on Cancel; Tab, then Enter kills once.
  await page.locator("body").focus();
  await selectById(page, 33);
  await tabTo(page, /^Kill$/);
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "Kill" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(statusOf(page, 33)).toHaveText("stopped");
  expect(postsTo(kernel, "/kill").map((p) => p.path)).toEqual(["/sessions/33/kill"]);

  // Abandon #27 and its confirm.
  await page.locator("body").focus();
  await selectById(page, 27);
  await tabTo(page, /^Abandon$/);
  await page.keyboard.press("Enter");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(statusOf(page, 27)).toHaveText("abandoned");
  expect(postsTo(kernel, "/abandon").map((p) => p.path)).toEqual(["/sessions/27/abandon"]);
});

test("AC8: every designed state, in light and dark", async ({}, testInfo) => {
  test.setTimeout(120_000);
  if (EVIDENCE) {
    // The folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    for (const file of readdirSync(EVIDENCE_DIR)) if (file.endsWith(".png")) rmSync(join(EVIDENCE_DIR, file));
  }

  // Empty: the kernel has run nothing.
  {
    const { fixture: started } = await startKernel({});
    const page = await openWith(started, "empty");
    await expect(page.getByRole("heading", { name: "Nothing running." })).toBeVisible();
    await shoot(page, "empty", testInfo);
    await closeAll(started);
  }

  // Loading: GET /sessions never answers, so the screen's first read stays in flight (skeleton rows, never a
  // spinner). The main process times a read out after REQUEST_TIMEOUT_MS (10 s); the asserts run well inside it.
  {
    let held = 0;
    const { fixture: started } = await startKernel(listInit(), {
      "GET /sessions": () => {
        held += 1;
        return new Promise<never>(() => undefined);
      },
    });
    const page = await launch(started.env);
    await openSessions(page);
    await expect(page.getByTestId("screen-sessions")).toHaveAttribute("data-state", "loading");
    await expect(page.locator(".list-skeleton").first()).toBeVisible();
    expect(held, "the screen's read reached the kernel and is still unanswered").toBeGreaterThan(0);
    await shoot(page, "loading", testInfo);
    await closeAll(started);
  }

  // Error: api.json names a port nothing listens on: the kernel-unreachable band over the screen's error.
  {
    const page = await launch(appEnv(await unreachableDataDir()));
    await openSessions(page);
    await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible();
    await expect(page.getByTestId("screen-sessions")).toHaveAttribute("data-state", "error");
    await expect(page.getByTestId("sessions-error")).toContainText("The kernel isn't answering");
    await shoot(page, "error", testInfo);
    await closeAll();
  }

  // Waiting on you, populated (running with its log streaming) and ended (a kill the kernel couldn't confirm): one kernel.
  {
    const { kernel, fixture: started, push } = await startKernel({
      sessions: [
        summary(34, { agent: "ada", status: "running", playbook: 5, started: ago(3.4), ended: null, tokens: 9020 }),
        summary(31, { agent: "mason", status: "running", playbook: 4, started: ago(4.2), ended: null, tokens: 14_208, cwd: "/Users/owner/src/loomwright" }),
        summary(35, { agent: "wright", status: "running", started: ago(1.3), ended: null, tokens: 3100, model: "opus", cwd: "/Users/owner/src/studio" }),
        summary(30, { agent: "mason", status: "stopped", playbook: 4, started: ago(40), ended: ago(31), tokens: 22_800 }),
        summary(29, { agent: "wright", status: "completed", started: ago(90), ended: ago(84), tokens: 5400, model: "opus" }),
        summary(27, { agent: "ada", status: "orphaned", started: ago(300), ended: null, tokens: 1200 }),
      ],
      output: new Map([
        [31, reviewOutput(31)],
        [34, [...reviewOutput(34).slice(0, 13), outputRow(34, 14, "tool_decision", { tool: "Bash", decision: "deny", reason: "approval_required", approval_id: 7, command: "gh pr comment 405 --body-file summary.md" })]],
        [35, reviewOutput(35).slice(0, 9)],
        [30, finishedOutput(30)],
      ]),
      approvals: [heldApproval(7, 34)],
      orphaned: [{ id: 27, agent: "ada", pgid: 4100, reason: "leader_unverified", updated_at: ago(200) }],
    });
    kernel.kill = (req) => {
      const id = Number(req.params.id);
      kernel.sessions = kernel.sessions.map((s) => (s.id === id ? { ...s, status: "failed", ended: new Date().toISOString() } : s));
      kernel.killUnconfirmed = [{ id, agent: "wright", status: "failed", pgid: 4242, kill_incomplete_at: new Date().toISOString() }];
      push("session_status", id);
      return { status: 200, body: { id, status: "failed", reason: "kill_incomplete" } };
    };
    const page = await openWith(started);
    await expect.poll(() => rowIds(page)).toEqual([35, 31, 34, 30, 29, 27]);

    await selectById(page, 34);
    await expect(page.getByTestId("session-waiting")).toContainText("Approval #7 is pending");
    await expect(page.getByRole("log", { name: "Session output" })).toContainText("held · approval #7");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shoot(page, "waiting", testInfo);

    await selectById(page, 31);
    await expect(page.getByRole("log", { name: "Session output" })).toContainText("Review drafted. Waiting for approval before posting.");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shoot(page, "populated", testInfo);

    await selectById(page, 35);
    await page.getByRole("button", { name: "Kill", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Kill" }).click();
    await expect(statusOf(page, 35)).toHaveText("failed");
    await expect(row(page, 35).getByTestId("session-kill-unconfirmed")).toBeVisible();
    await expect(page.getByTestId("session-log-status")).toHaveText("failed · kill_incomplete");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shoot(page, "ended", testInfo);
  }

  expect([...new Set(written)].sort()).toEqual(STATES.flatMap((s) => THEMES.map((t) => `${s}-${t}.png`)).sort());
});

test("the evidence README lists every state's screenshot in both themes, and the folder holds nothing else", () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const expected = STATES.flatMap((s) => THEMES.map((t) => `${s}-${t}.png`)).sort();
  const listed = [...new Set(readme.match(/\b[a-z]+-(?:light|dark)\.png/g) ?? [])].sort();
  expect(listed).toEqual(expected);
  const onDisk = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png")).sort();
  expect(onDisk).toEqual(expected);
});
