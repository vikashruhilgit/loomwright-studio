// The Playbooks screen in the built app against the fixture kernel (phase 7 item
// 04): the list and the playbook's own views (detail, field-level edit, version
// history) driven with real clicks and keys. It checks what the owner reads and what
// the kernel is sent: one `/set` per Set with no optimistic update, the kernel's
// refusal under its field, the On switch that never turns a playbook on, Run now,
// Edit in English (Wright's composer holds the line, nothing is asked), the kernel
// going away, the live feed updating rows in place, and WCAG AA contrast in both
// themes. It also captures one screenshot per designed state in light and dark.
//
// Screenshots: with `PLAYBOOKS_EVIDENCE=1` they are written to
// docs/evidence/phase-7-polish/playbooks/ (the committed evidence, named in its
// README); otherwise to Playwright's per-test output dir, so a plain run never
// dirties the tracked PNGs. A final test holds the README and the committed folder to
// the same twenty names.
//
// Run `npm run build` first; then `npx playwright test e2e/playbooks.spec.ts`.
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { APP_DIR, launchApp } from "./electron-harness";
import { appEnv, startFixtureKernel, unreachableDataDir } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { PLAYBOOKS, playbookEvent, playbooksFixture } from "./fixtures/playbooks";
import type { PlaybooksFixture, PlaybooksFixtureInit } from "./fixtures/playbooks";

const EVIDENCE = process.env.PLAYBOOKS_EVIDENCE === "1";
const EVIDENCE_DIR = resolve(APP_DIR, "..", "docs/evidence/phase-7-polish/playbooks");
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** The mockup's ten Playbooks states, in the README's order. */
const STATES = ["empty", "loading", "populated", "waiting", "error", "unreachable", "detail", "edit", "edit-refused", "history"] as const;
type State = (typeof STATES)[number];
/** Tall enough that the edit view's eight fields, with an editor open, are in view. */
const SHOT_SIZE = { width: 1180, height: 940 } as const;

const REVIEW = PLAYBOOKS.review;
const WEEKLY = PLAYBOOKS.weekly;
const HANDOFF = `About playbook ${REVIEW.id} (${REVIEW.slug}): `;

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

/** Close the app and the fixture kernel (what is open of them). */
async function closeAll(): Promise<void> {
  await app?.close();
  app = undefined;
  await closeKernel();
}

/** Close the fixture kernel alone, as the kernel going away. */
async function closeKernel(): Promise<void> {
  await fixture?.close();
  fixture = undefined;
}

test.afterEach(closeAll);

interface Opened {
  readonly page: Page;
  readonly fx: PlaybooksFixture;
  readonly kernel: FixtureKernel;
}

/** Launch the app against a fixture kernel in `init`'s state, open Playbooks, and size the window for the shots. */
async function open(init: PlaybooksFixtureInit = {}): Promise<Opened> {
  const fx = playbooksFixture(init);
  const started = await startFixtureKernel(fx.options);
  fixture = started;
  let id = 100;
  fx.kernel.onChange = (kind) => started.appendEvent(playbookEvent((id += 1), kind, REVIEW.id));
  app = await launchApp(started.env);
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await app.evaluate(({ BrowserWindow }, size) => {
    for (const win of BrowserWindow.getAllWindows()) win.setContentSize(size.width, size.height);
  }, SHOT_SIZE);
  await goToPlaybooks(page);
  return { page, fx, kernel: started };
}

async function goToPlaybooks(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/playbooks";
  });
  await expect(page.getByTestId("screen-playbooks")).toBeVisible();
}

function screenOf(page: Page): Locator {
  return page.getByTestId("screen-playbooks");
}

/** The crumb's back button of a playbook's own view (the sidebar's Playbooks entry is not it). */
function backButton(page: Page): Locator {
  return screenOf(page).locator("[data-pb-back]");
}

async function openLoaded(init: PlaybooksFixtureInit = {}): Promise<Opened> {
  const opened = await open(init);
  const state = init.state ?? "populated";
  await expect(screenOf(opened.page)).toHaveAttribute("data-state", state === "empty" ? "empty" : state);
  // The feed is up (a later event reaches the screen) and every last run has answered.
  await expect.poll(() => opened.kernel.requests.some((r) => r.path === "/events/stream")).toBe(true);
  if (state !== "empty") await expect(screenOf(opened.page)).not.toContainText("reading…");
  return opened;
}

function rowOf(page: Page, name: string): Locator {
  return page.getByTestId("playbook-row").filter({ hasText: name });
}

async function openDetail(page: Page, name: string): Promise<void> {
  await rowOf(page, name).getByTestId("playbook-open").click();
  await expect(page.getByTestId("playbook-detail")).toBeVisible();
}

async function openEdit(page: Page, name: string): Promise<void> {
  await openDetail(page, name);
  await page.getByTestId("playbook-edit-fields").click();
  await expect(page.getByTestId("playbook-edit")).toBeVisible();
}

function fieldOf(page: Page, key: string): Locator {
  return page.getByTestId("playbook-field").and(page.locator(`[data-field="${key}"]`));
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
}

/** The writes the fixture kernel recorded to `path`. */
function postsTo(fx: PlaybooksFixture, path: string) {
  return fx.kernel.posts.filter((p) => p.path === path);
}

// ---- the list ---------------------------------------------------------------------------------------------

test("AC4: the list shows every field of the mockup, the poll spec and dedupe key in full, who set each value, and no dollar figure", async () => {
  const { page } = await openLoaded();
  await expect(page.getByTestId("playbooks-count")).toHaveText("3 playbooks · 2 on");
  const review = rowOf(page, REVIEW.name);
  await expect(review).toContainText("When a PR opens or gets a new commit on studio-sandbox, read it and save a draft review for me.");
  await expect(review).toContainText("poll every 600s · vikashruhilgit/studio-sandbox · state=open");
  await expect(review).toContainText("item.id, item.revision");
  await expect(review).toContainText("sonnet");
  // The newest run is still running: it has no counted tokens yet, and the cell says so rather than inventing a figure.
  await expect(review).toContainText("not counted yet");
  await expect(review).toContainText("set by you");
  await expect(review).toContainText("proposed by Wright");
  await expect(review.getByRole("switch", { name: `${REVIEW.name} is on` })).toHaveAttribute("aria-checked", "true");
  await expect(rowOf(page, PLAYBOOKS.morning.name).getByRole("switch", { name: `${PLAYBOOKS.morning.name} is off` })).toHaveAttribute("aria-checked", "false");
  // Never truncated: no cell clips its text or ends it in an ellipsis. (The intent's two-line clamp is the mockup's own; the whole intent is in the detail.)
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".pb-table td *")]
      .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() !== "" && !el.classList.contains("pb-intent"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === "ellipsis")
      .map((el) => el.textContent),
  );
  expect(clipped).toEqual([]);
  // Tokens are counted figures; a dollar figure would come only through "≈ … at API rates", and a run carries none.
  await expect(screenOf(page)).not.toContainText("$");
});

test("AC4: a value nobody set reads 'not set', never a default", async () => {
  const { page, fx } = await openLoaded();
  const weekly = fx.kernel.playbooks.find((p) => p.id === WEEKLY.id);
  expect(weekly?.model).toBe("sonnet");
  // Clear the weekly playbook's model and dedupe key through the kernel, as a refetch would find them.
  fx.kernel.playbooks = fx.kernel.playbooks.map((p) => (p.id === WEEKLY.id ? { ...p, model: null, model_set_by: null, dedupe_key_spec: null, dedupe_key_set_by: null } : p));
  fx.kernel.onChange("playbook_updated");
  await expect(rowOf(page, WEEKLY.name)).toContainText("not set");
  await expect(rowOf(page, WEEKLY.name).locator("td").nth(2)).toContainText("not set");
  await expect(rowOf(page, WEEKLY.name).locator("td").nth(4)).toContainText("not set");
});

// ---- the playbook's views --------------------------------------------------------------------------------------

test("AC4/AC12: the detail shows the policy with who set each value, the trigger, the tokens counted and each run with its status in words", async () => {
  const { page } = await openLoaded();
  await openDetail(page, REVIEW.name);
  const detail = page.getByTestId("playbook-detail");
  await expect(detail).toContainText("item.id, item.revision");
  await expect(detail).toContainText("200,000");
  await expect(detail).toContainText("poll every 600s · vikashruhilgit/studio-sandbox · state=open");
  // Counted tokens of the runs that have them (31,870 + 2,104); the running one is not counted yet, never guessed.
  await expect(page.getByTestId("playbook-tokens")).toContainText("33,974 tokens counted in the last 3 runs");
  await expect(page.getByTestId("playbook-tokens")).toContainText("1 run: not counted yet");
  const runs = page.getByTestId("playbook-run");
  await expect(runs).toHaveCount(3);
  await expect(runs.nth(0)).toContainText("running");
  await expect(runs.nth(0)).toContainText("not counted yet");
  await expect(runs.nth(1)).toContainText("done");
  await expect(runs.nth(1)).toContainText("31,870 tokens");
  await expect(runs.nth(2)).toContainText("failed");
  await expect(page.getByRole("switch", { name: `${REVIEW.name} is on` })).toBeVisible();
});

test("AC5: a field edit is one /set, nothing changes until the kernel answers, and the version named is the kernel's", async () => {
  const { page, fx } = await openLoaded();
  await openEdit(page, REVIEW.name);
  await expect(page.getByText("v3 now")).toBeVisible();
  // Said before any Set: an enabled playbook becomes a draft again, and no version is predicted.
  await expect(page.getByText("Any change makes this playbook a draft again, as the kernel does.")).toBeVisible();
  await expect(page.getByText(/Save as v/)).toHaveCount(0);

  await fieldOf(page, "priority").getByRole("button", { name: "Edit priority" }).click();
  await page.getByLabel("New priority").selectOption("high");
  await page.getByRole("button", { name: "Set priority" }).click();
  await expect(page.getByTestId("playbook-field-status")).toContainText("Priority: saved as v4.");
  await expect(page.getByTestId("playbook-field-status")).toContainText("a draft again");
  await expect(page.getByText("v4 now")).toBeVisible();
  await expect(fieldOf(page, "priority")).toContainText("high");
  await expect(fieldOf(page, "priority")).toContainText("set by you");
  expect(postsTo(fx, "/playbooks/:id/set")).toEqual([{ path: "/playbooks/:id/set", params: { id: String(REVIEW.id) }, body: { field: "priority", value: "high" } }]);

  // An unchanged value: the kernel writes no version and says so, still naming v4.
  await fieldOf(page, "priority").getByRole("button", { name: "Edit priority" }).click();
  await page.getByRole("button", { name: "Set priority" }).click();
  await expect(fieldOf(page, "priority").getByTestId("playbook-field-status")).toContainText("No change");
  await expect(fieldOf(page, "priority").getByTestId("playbook-field-status")).toContainText("still v4");
  expect(postsTo(fx, "/playbooks/:id/set")).toHaveLength(2);

  // The history now shows the version the kernel wrote, and only that one.
  await backButton(page).click();
  await page.getByTestId("playbook-history").click();
  await expect(page.getByTestId("playbook-version")).toHaveCount(4);
  await expect(page.getByTestId("playbook-version").first()).toContainText("v4");
});

test("AC5: a refusal shows under its field in the kernel's words and code, the editor keeps its text, and nothing changed", async () => {
  const { page, fx } = await openLoaded();
  await openEdit(page, REVIEW.name);
  await fieldOf(page, "dedupe_key").getByRole("button", { name: "Edit dedupe key" }).click();
  await page.getByLabel("New dedupe key").fill("{repo}#{pr}");
  await page.getByRole("button", { name: "Set dedupe key" }).click();
  const refusal = fieldOf(page, "dedupe_key").getByTestId("playbook-field-refusal");
  await expect(refusal).toContainText('dedupe_key: unknown field "{repo}#{pr}" (the fields are playbook.id, playbook.version');
  await expect(refusal).toContainText("(invalid_input)");
  await expect(page.getByLabel("New dedupe key")).toHaveValue("{repo}#{pr}");
  await expect(page.getByText("v3 now")).toBeVisible();
  expect(fx.kernel.playbooks.find((p) => p.id === REVIEW.id)?.version).toBe(3);
  expect(postsTo(fx, "/playbooks/:id/set")).toHaveLength(1);
  // Name, intent and effort have no owner write route: read-only, with the way to change them.
  for (const key of ["name", "intent", "effort"]) {
    await expect(fieldOf(page, key)).toContainText("Change this with Edit in English");
    await expect(fieldOf(page, key).getByRole("button")).toHaveCount(0);
  }
  // Mode offers draft, with live shown and disabled.
  await fieldOf(page, "mode").getByRole("button", { name: "Edit mode" }).click();
  await expect(page.getByRole("option", { name: "live (not available yet)" })).toBeDisabled();
});

test("AC10: Escape cancels an open editor and then leaves the view, and Tab reaches each field's Edit, Set and Cancel", async () => {
  const { page } = await openLoaded();
  await openEdit(page, REVIEW.name);
  const edit = fieldOf(page, "model").getByRole("button", { name: "Edit model" });
  await edit.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("New model")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Set model" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.getByLabel("New model").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("New model")).toHaveCount(0);
  await expect(edit).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("playbook-detail")).toBeVisible();
  await expect(page.getByTestId("playbook-edit-fields")).toBeFocused();
});

test("AC6: the switch off reveals the held approval and links to it; it sends nothing and turns nothing on", async () => {
  const { page, fx, kernel } = await openLoaded({ state: "waiting" });
  await expect(page.getByTestId("playbooks-band")).toContainText(`1 playbook waits on you: ${WEEKLY.name} is a draft`);
  await expect(rowOf(page, WEEKLY.name)).toContainText("draft · waiting on you");
  await rowOf(page, WEEKLY.name).getByRole("switch", { name: `${WEEKLY.name} is off` }).click();
  const note = page.getByTestId("playbook-turn-on");
  await expect(note).toContainText(PLAYBOOKS.enableApproval.display);
  const link = note.getByTestId("playbook-turn-on-link");
  await expect(link).toHaveAttribute("href", "#/approvals");
  // Still off, and not one write reached the kernel.
  await expect(rowOf(page, WEEKLY.name).getByRole("switch")).toHaveAttribute("aria-checked", "false");
  expect(fx.kernel.posts).toEqual([]);
  expect(kernel.requests.filter((r) => r.method === "POST")).toEqual([]);
  await link.click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/approvals");
});

test("AC6: with no approval held the switch says Wright asks and the owner approves; Turn off sends POST /playbooks/:id/off", async () => {
  const { page, fx } = await openLoaded();
  await rowOf(page, PLAYBOOKS.morning.name).getByRole("switch").click();
  const note = page.getByTestId("playbook-turn-on");
  await expect(note).toContainText("No approval is waiting.");
  await expect(note).toContainText("turns on when Wright asks and you approve it");
  expect(fx.kernel.posts).toEqual([]);

  await rowOf(page, REVIEW.name).getByRole("switch", { name: `${REVIEW.name} is on` }).click();
  await expect(rowOf(page, REVIEW.name).getByRole("switch", { name: `${REVIEW.name} is off` })).toBeVisible();
  expect(fx.kernel.posts).toEqual([{ path: "/playbooks/:id/off", params: { id: String(REVIEW.id) }, body: undefined }]);
  await expect(page.getByTestId("playbooks-count")).toHaveText("3 playbooks · 1 on");
});

test("AC7: Edit in English opens Wright's thread with the composer holding a line that names the playbook, focused, and asks nothing", async () => {
  const { page, kernel } = await openLoaded();
  await openDetail(page, REVIEW.name);
  await page.getByTestId("playbook-edit-english").click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/chat");
  const composer = page.getByRole("textbox", { name: "Message Wright" });
  await expect(composer).toHaveValue(HANDOFF);
  await expect(composer).toBeFocused();
  // Nothing is sent until the owner sends it: no POST /ask reached the kernel.
  await page.waitForTimeout(300);
  expect(kernel.requests.filter((r) => r.method === "POST")).toEqual([]);
  expect(kernel.requests.some((r) => r.path === "/ask")).toBe(false);
});

test("AC8: Run now sends POST /playbooks/:id/run once, and the kernel's refusal shows in its words", async () => {
  const { page, fx } = await openLoaded();
  await openDetail(page, REVIEW.name);
  const runNow = page.getByTestId("playbook-run-now");
  // Two quick presses: the in-flight guard drops the repeat.
  await runNow.dblclick();
  await expect(page.getByTestId("playbook-run-now-status")).toContainText("Run queued (#101).");
  expect(postsTo(fx, "/playbooks/:id/run")).toHaveLength(1);

  fx.kernel.runRefusal = { error: "kill_switch_engaged", message: "the kill switch is engaged" };
  await runNow.click();
  await expect(page.getByTestId("playbook-run-now-status")).toHaveText("Run now: the kill switch is engaged (kill_switch_engaged)");
  expect(postsTo(fx, "/playbooks/:id/run")).toHaveLength(2);

  // A playbook that is off: Run now is not offered.
  fx.kernel.runRefusal = undefined;
  await backButton(page).click();
  await openDetail(page, PLAYBOOKS.morning.name);
  await expect(page.getByTestId("playbook-run-now")).toBeDisabled();
});

// ---- the kernel going away ----------------------------------------------------------------------------------------

test("AC9: when the kernel goes away the shared band shows and the screen keeps its last data, marked last known, with its writes off", async () => {
  const { page } = await openLoaded();
  await closeKernel();
  await expect(screenOf(page)).toHaveAttribute("data-offline", "true");
  await expect(page.locator('[data-testid="kernel-unreachable-band"], [data-testid="kernel-reconnecting-band"]')).toBeVisible();
  await expect(page.getByTestId("playbooks-count")).toHaveText("3 playbooks · 2 on · last known");
  await expect(page.getByTestId("playbook-row")).toHaveCount(3);
  await expect(rowOf(page, REVIEW.name)).toContainText("item.id, item.revision");
  for (const sw of await page.getByRole("switch").all()) await expect(sw).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ask Wright for a playbook" })).toBeDisabled();
});

test("AC9: with the kernel unreachable from the start the band shows over the screen's error state, and Try again is offered", async () => {
  app = await launchApp(appEnv(await unreachableDataDir()));
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await goToPlaybooks(page);
  await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible();
  await expect(screenOf(page)).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("playbooks-error")).toContainText("The kernel is not reachable");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("AC9: a failing first read shows the error state with the kernel's refusal and a retry", async () => {
  const { page } = await open({ failList: true });
  await expect(screenOf(page)).toHaveAttribute("data-state", "error");
  await expect(page.getByTestId("playbooks-error")).toContainText("GET /playbooks · 500 · store_unreadable · the kernel could not read its store");
  await expect(page.locator('[data-testid="kernel-unreachable-band"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

// ---- the keyboard and the live feed ---------------------------------------------------------------------------------

test("AC10: J and K move focus between the rows, and Enter opens the focused one", async () => {
  const { page } = await openLoaded();
  const opens = page.getByTestId("playbook-open");
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("j");
  await expect(opens.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(opens.nth(1)).toBeFocused();
  await page.keyboard.press("j");
  await expect(opens.nth(2)).toBeFocused();
  await page.keyboard.press("k");
  await expect(opens.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("playbook-detail")).toHaveAttribute("data-playbook", String(WEEKLY.id));
  // Back returns focus to the row the owner came from.
  await backButton(page).click();
  await expect(rowOf(page, WEEKLY.name).getByTestId("playbook-open")).toBeFocused();
});

/** From now on, count every moment the screen shows a skeleton, a busy region or a "reading…" line. */
async function watchForLoading(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __loading: number; __observer?: MutationObserver };
    w.__observer?.disconnect();
    w.__loading = 0;
    w.__observer = new MutationObserver(() => {
      const root = document.querySelector('[data-testid="screen-playbooks"]');
      if (root !== null && (root.querySelector(".pb-skeleton, [aria-busy='true']") !== null || (root.textContent ?? "").includes("reading…"))) w.__loading += 1;
    });
    w.__observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  });
}

async function loadingSeen(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __loading: number }).__loading);
}

test("AC11: a live event updates the rows and the open detail in place: the rows keep their size and nothing is replaced by a loading line", async () => {
  const { page, fx, kernel } = await openLoaded();
  const heights = async (): Promise<number[]> => page.getByTestId("playbook-row").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  const before = await heights();
  const widths = await page.getByTestId("playbook-row").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  await watchForLoading(page);
  const rows = fx.kernel.runs.get(REVIEW.id) ?? [];
  fx.kernel.runs.set(REVIEW.id, [{ ...(rows[0] as (typeof rows)[number]), id: 18, status: "done", tokens: 4321, ended: rows[0]?.started ?? null }, ...rows]);
  fx.kernel.playbooks = fx.kernel.playbooks.map((p) => (p.id === REVIEW.id ? { ...p, model: "opus", model_set_by: "owner" } : p));
  kernel.appendEvent({ type: "event", id: 500, at: "2026-10-30T15:00:00.000Z", kind: "session_status", session_id: 40, task_id: null, payload: {} });
  kernel.appendEvent(playbookEvent(501, "playbook_updated", REVIEW.id));
  await expect(rowOf(page, REVIEW.name)).toContainText("4,321 tokens");
  await expect(rowOf(page, REVIEW.name)).toContainText("opus");
  expect(await heights()).toEqual(before);
  expect(await page.getByTestId("playbook-row").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)))).toEqual(widths);

  expect(await loadingSeen(page), "the list").toBe(0);

  await openDetail(page, REVIEW.name);
  await expect(page.getByTestId("playbook-run")).toHaveCount(4);
  // The detail's own first read is done; from here a live event must not bring a loading line back.
  await watchForLoading(page);
  const box = await page.getByTestId("playbook-detail").boundingBox();
  const next = fx.kernel.runs.get(REVIEW.id) ?? [];
  fx.kernel.runs.set(REVIEW.id, [{ ...(next[0] as (typeof next)[number]), id: 19, status: "running", tokens: null }, ...next]);
  kernel.appendEvent({ type: "event", id: 502, at: "2026-10-30T15:01:00.000Z", kind: "event_done", session_id: null, task_id: null, payload: {} });
  await expect(page.getByTestId("playbook-run")).toHaveCount(5);
  expect((await page.getByTestId("playbook-detail").boundingBox())?.x).toBe(box?.x);
  expect(await loadingSeen(page), "the detail").toBe(0);
});

// ---- AA contrast ----------------------------------------------------------------------------------------------------------

/**
 * The text on the screen whose colour against its own background is under WCAG 2.1 AA (4.5, or 3 for large text), by
 * the computed colours of each element that holds text itself. Disabled controls are exempt, as WCAG exempts them.
 */
async function contrastFailures(page: Page): Promise<string[]> {
  // A theme change runs the controls' colour transitions: measure once they have settled, never mid-fade.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
  return page.evaluate(() => {
    type Rgba = readonly [number, number, number, number];
    const parse = (value: string): Rgba | undefined => {
      const m = /rgba?\(([^)]+)\)/.exec(value) ?? /color\(srgb ([^)]+)\)/.exec(value);
      if (m === null) return undefined;
      const parts = (m[1] ?? "").split(/[\s,/]+/).filter(Boolean).map(Number);
      const scale = value.startsWith("color(") ? 255 : 1;
      return [(parts[0] ?? 0) * scale, (parts[1] ?? 0) * scale, (parts[2] ?? 0) * scale, parts[3] ?? 1];
    };
    const over = (top: Rgba, under: Rgba): Rgba => {
      const a = top[3] + under[3] * (1 - top[3]);
      const mix = (i: 0 | 1 | 2): number => (a === 0 ? 0 : (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a);
      return [mix(0), mix(1), mix(2), a];
    };
    const luminance = (c: Rgba): number => {
      const ch = (v: number): number => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
    };
    const backgroundOf = (el: Element): Rgba => {
      const stack: Rgba[] = [];
      for (let node: Element | null = el; node !== null; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg !== undefined && bg[3] > 0) stack.push(bg);
        if (bg !== undefined && bg[3] >= 1) break;
      }
      return stack.reduceRight<Rgba>((under, top) => over(top, under), [255, 255, 255, 1]);
    };
    const failures: string[] = [];
    const root = document.querySelector('[data-testid="screen-playbooks"]');
    if (root === null) return ["no screen"];
    for (const el of [root, ...root.querySelectorAll("*")]) {
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
      if (!own) continue;
      if ((el as HTMLButtonElement).disabled === true || el.closest("[disabled], [aria-disabled='true']") !== null) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || el.closest(".pb-vh") !== null) continue;
      const fg = parse(style.color);
      if (fg === undefined) continue;
      const bg = backgroundOf(el);
      const text = over(fg, bg);
      const l1 = luminance(text);
      const l2 = luminance(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) failures.push(`${ratio.toFixed(2)} ${style.color} on ${style.backgroundColor}: ${(el.textContent ?? "").trim().slice(0, 40)}`);
    }
    return failures;
  });
}

test("AC12: every view meets WCAG 2.1 AA contrast in light and dark, from the design tokens", async () => {
  const { page } = await openLoaded({ state: "waiting" });
  const views: readonly (readonly [string, () => Promise<void>])[] = [
    ["list", async () => undefined],
    ["detail", async () => openDetail(page, REVIEW.name)],
    ["edit", async () => {
      await page.getByTestId("playbook-edit-fields").click();
      await fieldOf(page, "priority").getByRole("button", { name: "Edit priority" }).click();
    }],
    ["history", async () => {
      await backButton(page).click();
      await page.getByTestId("playbook-history").click();
      await expect(page.getByTestId("playbook-version").first()).toBeVisible();
    }],
  ];
  for (const [name, go] of views) {
    await go();
    for (const theme of THEMES) {
      await setTheme(page, theme);
      expect(await contrastFailures(page), `${name} in ${theme}`).toEqual([]);
    }
  }
});

test("AC12: every control and status has an accessible name", async () => {
  const { page } = await openLoaded();
  // The list: a switch per playbook named "<name> is on|off", each row's open button, a caption on the table.
  for (const name of [REVIEW.name, WEEKLY.name, PLAYBOOKS.morning.name]) await expect(page.getByRole("switch", { name: new RegExp(`^${name} is (on|off)$`) })).toHaveCount(1);
  await expect(page.getByRole("table", { name: "Playbooks" })).toBeVisible();
  await openEdit(page, REVIEW.name);
  for (const field of ["dedupe key", "priority", "model", "token limit per day", "mode"]) await expect(page.getByRole("button", { name: `Edit ${field}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit model", exact: true }).click();
  await expect(page.getByRole("button", { name: "Set model", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(page.getByLabel("New model")).toBeVisible();
});

// ---- the screenshots ---------------------------------------------------------------------------------------------------------

function shotName(state: State, theme: Theme): string {
  return `playbooks-${state}-${theme}.png`;
}

const EXPECTED = STATES.flatMap((s) => THEMES.map((t) => shotName(s, t)));

/** Where a screenshot goes: the committed evidence with `PLAYBOOKS_EVIDENCE=1`, else this run's own output. */
function shotDir(testInfo: TestInfo): string {
  return EVIDENCE ? EVIDENCE_DIR : testInfo.outputPath("shots");
}

async function shoot(page: Page, state: State, dir: string, ready: () => Promise<void>): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await ready();
    // The controls fade between themes: capture once they have settled, never mid-fade.
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    });
    await page.screenshot({ path: join(dir, shotName(state, theme)), scale: "css" });
  }
}

test("every designed state is screenshot in light and dark", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const dir = shotDir(testInfo);
  mkdirSync(dir, { recursive: true });
  // The evidence folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
  if (EVIDENCE) for (const file of readdirSync(dir)) if (file.endsWith(".png")) rmSync(join(dir, file));

  // Empty.
  {
    const { page } = await open({ state: "empty" });
    await expect(screenOf(page)).toHaveAttribute("data-state", "empty");
    await shoot(page, "empty", dir, async () => expect(page.getByRole("heading", { name: "No playbooks yet." })).toBeVisible());
    await closeAll();
  }

  // Loading: the first read is held, so the skeleton rows stay.
  {
    const { page } = await open({ holdList: true });
    await expect(screenOf(page)).toHaveAttribute("data-state", "loading");
    await shoot(page, "loading", dir, async () => expect(page.locator(".pb-skeleton")).toBeVisible());
    await closeAll();
  }

  // Error: the kernel answers the list with a 500.
  {
    const { page } = await open({ failList: true });
    await expect(screenOf(page)).toHaveAttribute("data-state", "error");
    await shoot(page, "error", dir, async () => expect(page.getByTestId("playbooks-error")).toBeVisible());
    await closeAll();
  }

  // Waiting on you: a draft whose enable is held in Approvals; its switch revealed.
  {
    const { page } = await openLoaded({ state: "waiting" });
    await shoot(page, "waiting", dir, async () => expect(page.getByTestId("playbooks-band")).toBeVisible());
    await closeAll();
  }

  // The populated list, then one playbook's views, then the kernel going away.
  {
    const { page } = await openLoaded();
    await shoot(page, "populated", dir, async () => expect(page.getByTestId("playbook-row")).toHaveCount(3));

    await openDetail(page, REVIEW.name);
    await expect(page.getByTestId("playbook-run")).toHaveCount(3);
    await shoot(page, "detail", dir, async () => expect(page.getByTestId("playbook-detail")).toBeVisible());

    await page.getByTestId("playbook-history").click();
    await expect(page.getByTestId("playbook-version")).toHaveCount(3);
    await shoot(page, "history", dir, async () => expect(page.getByTestId("playbook-version-diff")).toContainText("Changes in v3"));

    await backButton(page).click();
    await page.getByTestId("playbook-edit-fields").click();
    await fieldOf(page, "priority").getByRole("button", { name: "Edit priority" }).click();
    await page.getByLabel("New priority").selectOption("high");
    await shoot(page, "edit", dir, async () => expect(page.getByLabel("New priority")).toHaveValue("high"));

    // Refused: the dedupe key the kernel's closed set does not have, under its field in the kernel's words.
    await page.getByRole("button", { name: "Cancel" }).click();
    await fieldOf(page, "dedupe_key").getByRole("button", { name: "Edit dedupe key" }).click();
    await page.getByLabel("New dedupe key").fill("{repo}#{pr}");
    await page.getByRole("button", { name: "Set dedupe key" }).click();
    await expect(page.getByTestId("playbook-field-refusal")).toContainText("(invalid_input)");
    await shoot(page, "edit-refused", dir, async () => expect(page.getByTestId("playbook-field-refusal")).toBeVisible());

    // Unreachable: the kernel goes away; the last-known list stays under the shared band.
    await page.getByLabel("New dedupe key").press("Escape");
    await page.keyboard.press("Escape");
    await backButton(page).click();
    await expect(page.getByTestId("playbook-row")).toHaveCount(3);
    await closeKernel();
    await expect(screenOf(page)).toHaveAttribute("data-offline", "true");
    await expect(page.getByTestId("playbooks-count")).toContainText("last known");
    await shoot(page, "unreachable", dir, async () =>
      expect(page.locator('[data-testid="kernel-unreachable-band"], [data-testid="kernel-reconnecting-band"]')).toBeVisible(),
    );
  }

  const written = readdirSync(dir).filter((f) => f.endsWith(".png"));
  expect(written.sort()).toEqual([...EXPECTED].sort());
});

test("the evidence README lists every screenshot, and nothing else, and the folder holds those files", async () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const listed = new Set(readme.match(/playbooks-[a-z-]+-(?:light|dark)\.png/g) ?? []);
  expect([...listed].sort()).toEqual([...EXPECTED].sort());
  const onDisk = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png"));
  expect(onDisk.sort()).toEqual([...EXPECTED].sort());
  for (const state of STATES) expect(readme, `the README names the ${state} state`).toContain(`\`playbooks-${state}\``);
});
