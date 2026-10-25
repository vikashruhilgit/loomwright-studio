// The Approvals screen in the built app, against the fixture kernel
// (`./fixtures/approvals.ts`), phase 5 item 15. Run `npm run build` first.
//
// Each test launches the app through the harness (hidden window), opens
// `#/approvals` and drives it by keyboard: the inbox order and the selection
// by id (AC1), the detail (AC1b), A / ⇧A / D and what the kernel answered
// (AC2, AC3), the escaped payload (AC4), the grants and a confirmed Revoke
// (AC5), keyboard-only reach (AC7), and the link from an approval to what it
// is about (Open playbook to its card in Chat, Open in Team). The fixture
// records every POST with its body, so "exactly one request" is the kernel's
// own count.
//
// Screenshots (AC6): with `APPROVALS_EVIDENCE=1` every designed state, light
// and dark, is written to the committed `docs/evidence/phase-5-polish/approvals/`;
// otherwise to Playwright's per-test output dir, so CI and other lanes' e2e
// runs never dirty tracked files. The spec asserts behaviour, never pixels.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { appEnv, startFixtureKernel, unreachableDataDir } from "./fixture-kernel";
import { chatFixture } from "./fixtures/chat";
import type { FixtureKernel, FixtureRoute } from "./fixture-kernel";
import type { RouteKey } from "../src/api/contract";
import {
  KERNEL_AGENT_CREATE,
  alwaysHeldMessage,
  approvalEvent,
  approvalsKernel,
  approvalsRoutes,
  cannedGrants,
  charterApproval,
  enableApproval,
  pagedWrightThread,
  hostileApproval,
  requestApproval,
  reviewApproval,
} from "./fixtures/approvals";
import type { ApprovalsKernel, ApprovalsKernelInit } from "./fixtures/approvals";

const EVIDENCE = process.env.APPROVALS_EVIDENCE === "1";
const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-5-polish/approvals/", import.meta.url));
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** Every designed state, in the README's order. */
const STATES = ["empty", "loading", "error", "waiting", "populated", "decided"] as const;
type State = (typeof STATES)[number];

const ALWAYS_SENTENCE = "always needs an approval the rail held from a playbook session; approve it once";
const APPLIED = "The kernel created crew member Sable (version 1).";
const AGENT_MESSAGE = "The owner allowed kernel_agent_create once. The kernel created crew member Sable; don't call it again.";

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

/** A fixture kernel serving `kernel` (`overrides` replace its routes); every decision and revoke is pushed through the feed. */
async function startKernel(
  init: ApprovalsKernelInit,
  overrides: Partial<Record<RouteKey, FixtureRoute>> = {},
): Promise<{ kernel: ApprovalsKernel; fixture: FixtureKernel; push: (kind: string) => void }> {
  const kernel = approvalsKernel(init);
  const started = await startFixtureKernel({ routes: { ...approvalsRoutes(kernel), ...overrides } });
  fixture = started;
  let id = 0;
  const push = (kind: string): void => {
    id += 1;
    started.appendEvent(approvalEvent(id, kind));
  };
  kernel.onChange = push;
  return { kernel, fixture: started, push };
}

/** Close the app (and the fixture, when one is passed) before the next launch in the same test. */
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

async function openApprovals(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/approvals";
  });
  await expect(page.getByTestId("screen-approvals")).toBeVisible();
}

/** Launch against `started`, open Approvals, and wait for the feed and the first answer. */
async function openWith(started: FixtureKernel, state: "empty" | "populated" = "populated"): Promise<Page> {
  const page = await launch(started.env);
  await openApprovals(page);
  await expect(page.getByTestId("screen-approvals")).toHaveAttribute("data-state", state);
  await expect.poll(() => started.requests.some((r) => r.path === "/events/stream")).toBe(true);
  return page;
}

function rows(page: Page) {
  return page.getByRole("listbox", { name: "Approvals, pending first" }).getByRole("option");
}

async function rowIds(page: Page): Promise<number[]> {
  return rows(page).evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-key"))));
}

function selectedRow(page: Page) {
  return page.getByRole("listbox", { name: "Approvals, pending first" }).locator('[role="option"][aria-selected="true"]');
}

function postsTo(kernel: ApprovalsKernel, suffix: string) {
  return kernel.posts.filter((p) => p.path.endsWith(suffix));
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

test("AC1: oldest first and selected; a third arriving keeps the selection; #2 stays selected when #1 leaves", async () => {
  const { kernel, fixture: started, push } = await startKernel({ approvals: [reviewApproval(2), charterApproval(1)] });
  const page = await openWith(started);
  await expect.poll(() => rowIds(page)).toEqual([1, 2]);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "1");

  kernel.approvals.push(requestApproval(3));
  push("approval_requested");
  await expect.poll(() => rowIds(page)).toEqual([1, 2, 3]);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "1");

  await page.keyboard.press("j");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "2");

  // #1 is decided elsewhere: the next GET /approvals no longer has it.
  kernel.approvals = kernel.approvals.filter((a) => a.id !== 1);
  push("approval_decided");
  await expect.poll(() => rowIds(page)).toEqual([2, 3]);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "2");
  await expect(page.getByTestId("approval-detail")).toHaveAttribute("data-approval-id", "2");
});

test("AC1b + AC2: a charter create's detail; A sends one approve once; the applied sentence, then the agent's message", async () => {
  const { kernel, fixture: started } = await startKernel({ approvals: [charterApproval(1), reviewApproval(2)] });
  kernel.applied.set(1, APPLIED);
  kernel.agentMessages.set(1, AGENT_MESSAGE);
  const page = await openWith(started);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "1");

  const detail = page.getByTestId("approval-detail");
  await expect(detail.getByTestId("approval-action")).toHaveText("kernel_agent_create");
  await expect(detail.getByTestId("approval-agent")).toHaveText("wright");
  await expect(detail.getByTestId("approval-session")).toHaveText("session #12");
  await expect(detail.getByTestId("approval-source")).toHaveText("Requested by playbook crew-setup v2");
  // The payload's cwd: the one the rail recorded, session #12's.
  await expect(detail.getByTestId("approval-cwd")).toHaveText("/Users/owner/src/studio");
  // Pending, the member does not exist yet: nothing to open.
  await expect(detail.getByTestId("approval-link")).toHaveCount(0);
  await expect(detail.getByTestId("approval-kernel-will")).toHaveText("The kernel creates this crew member when you allow it.");
  await expect(detail.getByTestId("approval-payload")).toContainText(KERNEL_AGENT_CREATE);

  await page.keyboard.press("a");
  await expect(detail.getByTestId("approval-applied")).toContainText(APPLIED);
  // Created: the link goes to the member in Team.
  await expect(detail.getByTestId("approval-link")).toHaveText("Open in Team");
  await expect(detail.getByTestId("approval-link")).toHaveAttribute("href", "#/team/sable");
  await expect(detail.getByTestId("approval-message")).toHaveText(AGENT_MESSAGE);
  const approves = postsTo(kernel, "/approve");
  expect(approves).toHaveLength(1);
  expect(approves[0]?.path).toBe("/approvals/1/approve");
  expect(JSON.stringify(approves[0]?.body)).toBe('{"decision":"once"}');
  const outcome = (await page.getByTestId("approval-outcome").textContent()) ?? "";
  expect(outcome.indexOf(APPLIED)).toBeLessThan(outcome.indexOf(AGENT_MESSAGE));
  // The decided approval stays selected; #2 stays pending.
  await expect.poll(() => rowIds(page)).toEqual([2, 1]);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "1");
  // A second A on the decided one sends nothing.
  await page.keyboard.press("a");
  await page.waitForTimeout(300);
  expect(postsTo(kernel, "/approve")).toHaveLength(1);
});

test("AC3: ⇧A with no playbook is disabled with the kernel's reason and sends nothing; a 409 shows the kernel's message and stays pending", async () => {
  const { kernel, fixture: started } = await startKernel({ approvals: [charterApproval(1), requestApproval(3)] });
  kernel.alwaysRefused.set(1, alwaysHeldMessage(KERNEL_AGENT_CREATE));
  const page = await openWith(started);

  await page.keyboard.press("j");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "3");
  const always = page.getByRole("button", { name: /^Always for this playbook/ });
  await expect(always).toBeDisabled();
  await expect(page.getByTestId("always-reason")).toHaveText(ALWAYS_SENTENCE);
  await page.keyboard.press("Shift+A");
  await page.waitForTimeout(300);
  expect(kernel.posts).toHaveLength(0);

  await page.keyboard.press("k");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "1");
  await expect(always).toBeEnabled();
  await page.keyboard.press("Shift+A");
  await expect(page.getByTestId("approval-notice")).toHaveText(alwaysHeldMessage(KERNEL_AGENT_CREATE));
  expect(postsTo(kernel, "/approve").map((p) => p.body)).toEqual([{ decision: "always" }]);
  await expect(page.getByTestId("approval-outcome")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Allow once/ })).toBeEnabled();
  expect(kernel.approvals.find((a) => a.id === 1)?.status).toBe("pending");
});

test("AC4: an ANSI escape and a bidi override show escaped, in monospace, and never reach the DOM raw", async () => {
  const { fixture: started } = await startKernel({ approvals: [hostileApproval(4)] });
  const page = await openWith(started);
  const payload = page.getByTestId("approval-payload");
  const display = page.getByTestId("approval-display");
  await expect(payload).toContainText("\\x1b[31m");
  await expect(payload).toContainText("\\u202e");
  await expect(display).toContainText("\\x1b[31mOK\\x1b[0m");
  await expect(display).toContainText("\\u202e");
  for (const pre of [payload, display]) {
    expect(await pre.evaluate((el) => el.tagName)).toBe("PRE");
    expect(await pre.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
  }
  const raw = await page.evaluate(() => {
    const text = document.body.textContent ?? "";
    return [...text].filter((c) => /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(c)).map((c) => c.charCodeAt(0));
  });
  expect(raw).toEqual([]);
});

test("AC5: not current is marked; Revoke asks first; Cancel sends nothing; Confirm sends exactly one revoke", async () => {
  const { kernel, fixture: started } = await startKernel({ approvals: [reviewApproval(2)], grants: cannedGrants() });
  const page = await openWith(started);
  const stale = page.getByTestId("grant-17");
  await expect(stale.getByText("not current", { exact: true })).toBeVisible();
  await expect(page.getByTestId("grant-21").getByText("not current", { exact: true })).toHaveCount(0);

  await stale.getByRole("button", { name: "Revoke grant #17" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Revoke this grant?");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(postsTo(kernel, "/revoke")).toHaveLength(0);

  await stale.getByRole("button", { name: "Revoke grant #17" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /^Revoke/ }).click();
  await expect(page.getByTestId("grant-notice")).toContainText("Revoked grant #17");
  await expect(page.getByTestId("grant-17")).toHaveCount(0);
  const revokes = postsTo(kernel, "/revoke");
  expect(revokes).toHaveLength(1);
  expect(revokes[0]?.path).toBe("/approvals/grants/17/revoke");
});

test("an enable approval links to its playbook's card: Open playbook pr-review opens Wright's thread with the card in view", async () => {
  // The chat fixture serves Wright's thread with playbook 3 (pr-review) and its card; the approvals kernel's
  // routes come second, so its GET /approvals and GET /messages replace the chat fixture's own.
  const kernel = approvalsKernel({ approvals: [enableApproval(6)] });
  const started = await startFixtureKernel({ routes: { ...chatFixture("populated").options.routes, ...approvalsRoutes(kernel) } });
  fixture = started;
  const page = await openWith(started);
  const detail = page.getByTestId("approval-detail");
  await expect(detail).toHaveAttribute("data-approval-id", "6");
  await expect(detail.getByTestId("approval-source")).toHaveText("Requested by Wright in chat");
  const link = detail.getByRole("link", { name: "Open playbook pr-review" });
  await expect(link).toHaveAttribute("href", "#/chat?playbook=3");

  // By keyboard: the link unmounts with the Approvals screen, so focus must move into the card, not fall to <body>.
  await link.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/chat?playbook=3");
  await expect(page.getByTestId("screen-chat")).toHaveAttribute("data-agent", "wright");
  const card = page.locator('[data-playbook="3"]');
  await expect(card).toBeVisible();
  await expect(card).toBeInViewport();
  await expect.poll(() => card.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  // A playbook the thread has no card for: the line saying so is in view, though the thread opens at its end.
  await page.evaluate(() => {
    window.location.hash = "#/chat?playbook=99";
  });
  const missing = page.getByTestId("chat-card-missing");
  await expect(missing).toContainText("#99");
  await expect(missing).toBeInViewport();
  // A link only navigates: nothing was decided.
  expect(kernel.posts).toEqual([]);
});

test("a card one page back: Load earlier brings it, and the view stays on the card, not the old reading position", async () => {
  // Wright's first page lacks playbook 3's card; page c1 has it, with twelve older messages around it.
  const kernel = approvalsKernel({ approvals: [enableApproval(6)] });
  const routes = { ...chatFixture("populated").options.routes, ...approvalsRoutes(kernel), "GET /threads/:agent": pagedWrightThread() };
  const started = await startFixtureKernel({ routes });
  fixture = started;
  const page = await launch(started.env);
  await page.evaluate(() => {
    window.location.hash = "#/chat?playbook=3";
  });
  await expect(page.getByTestId("chat-card-missing")).toContainText("Load earlier to find it.");
  // Load earlier restores the old reading position in an animation frame, which may run before or after React
  // commits the page (and the card scroll). Hold each frame's callbacks until after the commit, the order that
  // put the card off screen, so this check never passes by the luck of the other order.
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => setTimeout(() => cb(performance.now()), 50));
  });
  await page.getByRole("button", { name: /^Load earlier/ }).click();
  const card = page.locator('[data-playbook="3"]');
  await expect(card).toBeVisible();
  await expect(page.getByTestId("chat-card-missing")).toHaveCount(0);
  // Past the held frame Load earlier restores the old reading position in: the card must still be in view.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(card).toBeInViewport();
  expect(kernel.posts).toEqual([]);
});

/** Tab until the focused element's accessible text starts with `label` (at most 40 stops). */
async function tabTo(page: Page, label: RegExp): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute("aria-label") ?? el?.textContent ?? "";
    });
    if (label.test(name)) return;
  }
  throw new Error(`Tab never reached ${String(label)}`);
}

test("AC7: keyboard only reaches J/K, A, ⇧A, D, show grants, Revoke and its confirm, and show decided", async () => {
  test.setTimeout(60_000);
  const { kernel, fixture: started } = await startKernel({
    approvals: [charterApproval(1), reviewApproval(2), requestApproval(3)],
    grants: cannedGrants(),
  });
  kernel.applied.set(1, APPLIED);
  kernel.alwaysRefused.set(1, alwaysHeldMessage(KERNEL_AGENT_CREATE));
  const page = await openWith(started);

  // J / K move the selection.
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "3");
  await page.keyboard.press("k");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "2");

  // ⇧A on a playbook approval the kernel accepts always for: one request.
  await page.keyboard.press("Shift+A");
  await expect(page.getByTestId("approval-outcome")).toContainText("Always allowed for this playbook");
  expect(postsTo(kernel, "/approve").map((p) => [p.path, p.body])).toEqual([["/approvals/2/approve", { decision: "always" }]]);

  // #2 is decided and moves below the pending ones (rows 1, 3, 2), still selected. D on #3.
  await expect.poll(() => rowIds(page)).toEqual([1, 3, 2]);
  await expect(selectedRow(page)).toHaveAttribute("data-key", "2");
  await page.keyboard.press("k");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "3");
  await page.keyboard.press("d");
  await expect(page.getByTestId("approval-outcome")).toContainText("Denied by owner");
  expect(postsTo(kernel, "/deny").map((p) => p.path)).toEqual(["/approvals/3/deny"]);

  // A on #1, selected with the keyboard.
  await page.keyboard.press("k");
  await expect(selectedRow(page)).toHaveAttribute("data-key", "1");
  await page.keyboard.press("a");
  await expect(page.getByTestId("approval-applied")).toContainText(APPLIED);
  expect(postsTo(kernel, "/approve")).toHaveLength(2);

  // Show grants: a button in the bar moves focus to the grants heading.
  await tabTo(page, /^Show grants/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /^Standing grants/ })).toBeFocused();

  // Revoke and its confirm, by keyboard: Cancel first (focus lands on it), then Revoke.
  await tabTo(page, /^Revoke grant #17/);
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveCount(0);
  expect(postsTo(kernel, "/revoke")).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Revoke grant #17" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: /^Revoke/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("grant-17")).toHaveCount(0);
  expect(postsTo(kernel, "/revoke").map((p) => p.path)).toEqual(["/approvals/grants/17/revoke"]);

  // Show decided: the kernel's decided list joins the inbox.
  kernel.approvals.push({ ...requestApproval(9), status: "denied", decision: "deny", decided_by: "owner", decided_at: "2026-10-21T10:00:00.000Z" });
  await tabTo(page, /^Show decided/);
  await page.keyboard.press("Enter");
  await expect.poll(() => rowIds(page)).toContain(9);
});

test("AC6: every designed state, in light and dark", async ({}, testInfo) => {
  test.setTimeout(120_000);
  if (EVIDENCE) {
    // The folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    for (const file of readdirSync(EVIDENCE_DIR)) if (file.endsWith(".png")) rmSync(join(EVIDENCE_DIR, file));
  }

  // Empty: nothing waits, no grants.
  {
    const { fixture: started } = await startKernel({});
    const page = await openWith(started, "empty");
    await expect(page.getByRole("heading", { name: "Nothing waiting on you." })).toBeVisible();
    await shoot(page, "empty", testInfo);
    await closeAll(started);
  }

  // Loading: GET /approvals never answers. The fixture holds every read of it
  // from launch on, whichever component asks first (the shell's sidebar reads
  // approvals too), so the screen's first read stays in flight (the skeleton
  // rows, never a spinner). The main process times a read out after
  // REQUEST_TIMEOUT_MS (10 s); the asserts below run well inside that.
  {
    let held = 0;
    const { fixture: started } = await startKernel(
      { approvals: [charterApproval(1)] },
      {
        "GET /approvals": () => {
          held += 1;
          return new Promise<never>(() => undefined);
        },
      },
    );
    const page = await launch(started.env);
    await openApprovals(page);
    await expect(page.getByTestId("screen-approvals")).toHaveAttribute("data-state", "loading");
    await expect(page.locator(".list-skeleton").first()).toBeVisible();
    expect(held, "the screen's read reached the kernel and is still unanswered").toBeGreaterThan(0);
    await shoot(page, "loading", testInfo);
    await closeAll(started);
  }

  // Error: api.json names a port nothing listens on: the kernel-unreachable band over the screen's error.
  {
    const page = await launch(appEnv(await unreachableDataDir()));
    await openApprovals(page);
    await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible();
    await expect(page.getByTestId("screen-approvals")).toHaveAttribute("data-state", "error");
    await expect(page.getByTestId("approvals-error")).toContainText("The kernel isn't answering");
    await shoot(page, "error", testInfo);
    await closeAll();
  }

  // Waiting on you, populated (detail + grants) and decided: one kernel.
  {
    const { kernel, fixture: started } = await startKernel({
      approvals: [charterApproval(1), reviewApproval(2), requestApproval(3)],
      grants: cannedGrants(),
    });
    kernel.applied.set(1, APPLIED);
    kernel.agentMessages.set(1, AGENT_MESSAGE);
    kernel.approvals.push({ ...requestApproval(8), action: "post a weekly summary", status: "approved", decision: "once", decided_by: "owner", decided_at: "2026-10-21T17:00:00.000Z" });
    const page = await openWith(started);
    await expect(page.getByTestId("approval-kernel-will")).toBeVisible();
    await shoot(page, "waiting", testInfo);

    await page.keyboard.press("j");
    await expect(selectedRow(page)).toHaveAttribute("data-key", "2");
    await expect(page.getByTestId("grant-17")).toBeVisible();
    await shoot(page, "populated", testInfo);

    await page.keyboard.press("k");
    await page.keyboard.press("a");
    await expect(page.getByTestId("approval-message")).toHaveText(AGENT_MESSAGE);
    await page.getByRole("button", { name: "Show decided" }).press("Enter");
    await expect.poll(() => rowIds(page)).toEqual([2, 3, 1, 8]);
    await expect(selectedRow(page)).toHaveAttribute("data-key", "1");
    // Focus off the button, so no focus ring is in the shot.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await shoot(page, "decided", testInfo);
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
