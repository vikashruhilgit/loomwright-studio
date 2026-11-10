// Thread continuity in the built app against the fixture kernel (phase 8 item
// 17c): a Reply sends `continues` and is drawn on its thread's rail; Esc on
// the strip returns focus to that Reply; Summarize & start fresh previews the
// summary and sends the owner's edit; Copy reference writes a link that pastes
// into a Crew composer as a chip and sends as `references`; a thread is renamed
// in place. One screenshot per designed view per theme, compared against
// docs/design/mockups/chat-threads.html, written to
// docs/evidence/phase-8-polish/chat-threads/ only when PHASE8_POLISH_EVIDENCE=1.
//
// Run `npm run build` first; then `npx playwright test e2e/chat-threads.spec.ts`.
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { APP_DIR, launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { chatThreadsFixture } from "./fixtures/chat-threads";
import type { ChatThreadsFixture } from "./fixtures/chat-threads";

const EVIDENCE_DIR = resolve(APP_DIR, "..", "docs/evidence/phase-8-polish/chat-threads");
const WRITE_EVIDENCE = process.env.PHASE8_POLISH_EVIDENCE === "1";
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const SHOT_SIZE = { width: 1180, height: 1100 } as const;

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

async function launch(hash = "#/chat"): Promise<{ readonly page: Page; readonly threads: ChatThreadsFixture }> {
  const threads = chatThreadsFixture();
  fixture = await startFixtureKernel(threads.options);
  app = await launchApp(fixture.env);
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  return { page, threads };
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
}

async function resize(size: { readonly width: number; readonly height: number }): Promise<void> {
  await app?.evaluate(({ BrowserWindow }, s) => {
    for (const win of BrowserWindow.getAllWindows()) win.setContentSize(s.width, s.height);
  }, size);
}

/** Paste `text` into the focused field, as ⌘V does (a paste event carrying the clipboard's text). */
async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const target = document.activeElement;
    if (target === null) throw new Error("nothing focused");
    const data = new DataTransfer();
    data.setData("text/plain", t);
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const replyButtons = (page: Page) => page.getByRole("button", { name: /^Reply to Wright's message of/ });

test("Reply sends continues and joins the thread; Esc returns focus to Reply; a plain send carries none (AC1, AC2)", async () => {
  const { page, threads } = await launch();
  await expect(page.getByRole("heading", { name: "Plan the v1.5 release" })).toBeVisible();
  await expect(replyButtons(page)).toHaveCount(3);
  await expect(page.getByText("continued", { exact: true })).toBeVisible();

  const reply = replyButtons(page).nth(1);
  await reply.click();
  await expect(page.getByRole("group", { name: "Reply" })).toContainText("Replying to: You do, by hand: the signing key stays on your machine.");
  await expect(page.getByRole("textbox", { name: "Reply to Wright" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Reply" })).toHaveCount(0);
  await expect(reply).toBeFocused();

  await reply.click();
  await page.getByRole("textbox", { name: "Reply to Wright" }).fill("And the changelog?");
  await page.keyboard.press("Enter");
  await expect.poll(() => threads.asks.length).toBe(1);
  expect(threads.asks[0]).toEqual({ text: "And the changelog?", agent: "wright", continues: 6 });
  const sent = page.locator("li", { hasText: "And the changelog?" });
  await expect(sent).toHaveClass(/chat-thread-joined/);
  await expect(sent).toContainText("Reply to Wright ·");

  await page.getByRole("textbox", { name: "Message Wright" }).fill("A new topic");
  await page.keyboard.press("Enter");
  await expect.poll(() => threads.asks.length).toBe(2);
  expect(threads.asks[1]).toEqual({ text: "A new topic", agent: "wright" });
});

test("Summarize & start fresh previews the summary, sends the owner's edit, and marks the old thread (AC3, AC4)", async () => {
  const { page, threads } = await launch();
  const summarize = page.getByRole("button", { name: /^Summarize & start fresh/ }).first();
  await expect(summarize).toBeVisible();
  await expect(page.getByText("past your size hint")).toBeVisible();
  await page.getByRole("button", { name: "About Summarize & start fresh: this thread in tokens" }).first().click();
  const panel = page.getByRole("region", { name: "Summarize & start fresh: this thread in tokens" });
  await expect(panel).toContainText("52,000 tokens");
  await expect(panel).toContainText("40,000 tokens");
  expect(await panel.textContent()).not.toContain("$");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  await summarize.click();
  const dialog = page.getByRole("dialog", { name: "Summary of “Plan the v1.5 release”" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Kept as text: <img src=x onerror=alert(1)>")).toBeVisible();
  expect(threads.writes.map((w) => w.route)).toEqual(["/threads/:agent/:thread/summarize"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(summarize).toBeFocused();

  await summarize.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Edit" }).click();
  await dialog.getByRole("textbox", { name: "Summary text" }).fill("## Decisions\n- Ship on Monday instead.");
  await dialog.getByRole("button", { name: "Start fresh with this" }).click();
  await expect(dialog).toHaveCount(0);
  const fresh = threads.writes.filter((w) => w.route === "/threads/:agent/:thread/start-fresh");
  expect(fresh.map((w) => [w.params, w.body])).toEqual([[{ agent: "wright", thread: "4" }, { summary: "## Decisions\n- Ship on Monday instead." }]]);
  await expect(page.getByText("Summarized: continued in Plan the v1.5 release (continued).")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Plan the v1.5 release (continued)" })).toBeVisible();
});

test("Copy reference pastes into a Crew composer as a chip and sends as references (AC5)", async () => {
  const { page, threads } = await launch();
  await page.getByRole("button", { name: "Copy reference to the thread What changed overnight?" }).click();
  await expect(page.getByTestId("chat-thread-notice")).toContainText("Copied a reference to “What changed overnight?”.");
  const copied = await app!.evaluate(({ clipboard }) => clipboard.readText());
  expect(copied).toBe("loomwright-studio://thread/wright/8");

  await page.evaluate(() => {
    window.location.hash = "#/chat/pim";
  });
  await expect(page.getByText("Continuing from the saved conversation")).toBeVisible();
  const field = page.getByRole("textbox", { name: "Message Pim" });
  await field.fill("Use what changed overnight");
  await field.focus();
  await paste(page, copied);
  const chip = page.getByRole("group", { name: "Attached thread reference" });
  await expect(chip).toContainText("What changed overnight?");
  await expect(chip).toContainText("(2 messages)");
  await expect(chip).toContainText("· Wright");
  await chip.getByRole("button", { name: "Summary" }).click();
  await expect(chip).toContainText("about 420 tokens");
  await expect(field).toHaveValue("Use what changed overnight");
  await page.getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => threads.asks.length).toBe(1);
  expect(threads.asks[0]).toEqual({ text: "Use what changed overnight", agent: "pim", workspace: "~/work/site", references: [{ thread: 8, use: "summary" }] });
  await expect(chip).toHaveCount(0);
});

test("a thread is renamed in place and marked renamed by you (AC8)", async () => {
  const { page, threads } = await launch();
  await page.getByRole("button", { name: "Rename the thread What changed overnight?" }).click();
  const name = page.getByRole("textbox", { name: "Thread name" });
  await expect(name).toBeFocused();
  await name.fill("Overnight digest");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Overnight digest" })).toBeVisible();
  await expect(page.getByText("renamed by you")).toBeVisible();
  expect(threads.writes.filter((w) => w.route === "/threads/:agent/:thread/rename").map((w) => w.body)).toEqual([{ title: "Overnight digest" }]);
  expect(await page.locator("body").textContent()).not.toMatch(/ad hoc session|playbook #\d+/);
});

test("evidence: every thread view in light and dark (AC7)", async ({}, testInfo) => {
  const dir = WRITE_EVIDENCE ? EVIDENCE_DIR : testInfo.outputPath("chat-threads");
  mkdirSync(dir, { recursive: true });
  if (WRITE_EVIDENCE) for (const file of readdirSync(dir)) if (file.endsWith(".png")) rmSync(join(dir, file));
  const { page } = await launch();
  await resize(SHOT_SIZE);
  const shoot = async (view: string): Promise<void> => {
    for (const theme of THEMES) {
      await setTheme(page, theme);
      // Let every finite animation (the strip's and chip's fade, the Dialog's entry) finish first.
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
      await page.screenshot({ path: join(dir, `${view}-${theme}.png`) });
    }
  };
  await expect(page.getByRole("heading", { name: "Plan the v1.5 release" })).toBeVisible();

  // chat-threads: threads with headers, Reply, Summarize past the hint and the ⓘ panel open; the Reply strip.
  await page.getByRole("button", { name: "About Summarize & start fresh: this thread in tokens" }).first().click();
  await replyButtons(page).nth(1).click();
  await shoot("chat-threads");
  // Esc closes the ⓘ panel first; the Reply strip stays, and the preview opens over it.
  await page.keyboard.press("Escape");

  // chat-preview: the summary preview Dialog.
  await page.getByRole("button", { name: /^Summarize & start fresh/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await shoot("chat-preview");
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  await shoot("chat-preview-edit");
  await page.getByRole("dialog").getByRole("button", { name: "Start fresh with this" }).click();
  await expect(page.getByText(/^Summarized: continued in/)).toBeVisible();
  await shoot("chat-summarized");

  // chat-rename: the rename field in place.
  await page.getByRole("button", { name: "Rename the thread What changed overnight?" }).click();
  await shoot("chat-rename");
  await page.keyboard.press("Escape");

  // crew-reference: a Crew thread (the replayed note) with a pasted chip of Wright's thread.
  await page.evaluate(() => {
    window.location.hash = "#/chat/pim";
  });
  await expect(page.getByText("Continuing from the saved conversation")).toBeVisible();
  const field = page.getByRole("textbox", { name: "Message Pim" });
  await field.fill("Use what changed overnight");
  await field.focus();
  await paste(page, "loomwright-studio://thread/wright/8");
  await page.getByRole("group", { name: "Attached thread reference" }).getByRole("button", { name: "Summary" }).click();
  await shoot("crew-reference");

  // crew-unreachable: the shared band; Reply and Rename are disabled.
  await fixture!.stop();
  await expect(page.getByTestId("kernel-unreachable-band")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /^Reply to Pim's message of/ })).toBeDisabled();
  await shoot("crew-unreachable");

  const shots = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
  expect(shots).toHaveLength(14);
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  for (const shot of shots) expect(readme).toContain(shot);
});
