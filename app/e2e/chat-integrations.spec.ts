// The phase 6 thread cards in the built app against the fixture kernel (phase 6
// item 12): a draft card, a run of skipped PRs, a queued poll line and a
// connector line in Wright's thread, reached with real J / K keys and opened
// with Enter (AC4), and one screenshot per designed state per theme, written to
// docs/evidence/phase-6-polish/chat-cards/ (AC5).
//
// `e2e/chat.spec.ts` stays the phase 5 suite and writes its own folder; nothing
// here touches `docs/evidence/phase-5-polish/chat/`.
//
// Run `npm run build` first; then `npx playwright test e2e/chat-integrations.spec.ts`.
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { APP_DIR, launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { CARDS, chatIntegrationsFixture } from "./fixtures/chat-integrations";
import type { ChatIntegrationsFixture } from "./fixtures/chat-integrations";

const EVIDENCE_DIR = resolve(APP_DIR, "..", "docs/evidence/phase-6-polish/chat-cards");
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
/** Tall enough that the whole thread, with a card open, is in view. */
const SHOT_SIZE = { width: 1180, height: 1500 } as const;

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

async function open(): Promise<{ readonly page: Page; readonly chat: ChatIntegrationsFixture }> {
  const chat = chatIntegrationsFixture();
  fixture = await startFixtureKernel(chat.options);
  app = await launchApp(fixture.env);
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/chat";
  });
  await app.evaluate(({ BrowserWindow }, size) => {
    for (const win of BrowserWindow.getAllWindows()) win.setContentSize(size.width, size.height);
  }, SHOT_SIZE);
  // Every card, and the collapsed draft's PR (read from GET /drafts), is in place.
  await expect(draftCard(page, "draft")).toBeVisible();
  await expect(draftCard(page, "longDraft")).toBeVisible();
  await expect(skipCard(page)).toBeVisible();
  await expect(page.getByText(`Reviewing ${CARDS.queued[0].ref} @ ${CARDS.queued[0].revision.slice(0, 7)}`)).toBeVisible();
  await expect(page.getByText(`Reviewing ${CARDS.queued[1].ref} @ ${CARDS.queued[1].revision.slice(0, 7)}`)).toBeVisible();
  return { page, chat };
}

function draftCard(page: Page, which: "draft" | "longDraft"): Locator {
  return page.getByRole("region", { name: CARDS[which].title });
}

function skipCard(page: Page): Locator {
  return page.getByRole("region", { name: CARDS.skipTitle });
}

function toggleOf(card: Locator): Locator {
  return card.locator("button[data-thread-card]");
}

/** Open or close a card by clicking its toggle; a no-op when it is already so. */
async function setOpen(card: Locator, wanted: boolean): Promise<void> {
  const toggle = toggleOf(card);
  if ((await toggle.getAttribute("aria-expanded")) === String(wanted)) return;
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", String(wanted));
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(theme);
}

/** The focused control's text without kbd hints and aria-hidden marks (a card toggle's chevron). */
async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el === null || el === document.body) return "";
    const copy = el.cloneNode(true) as HTMLElement;
    for (const hint of copy.querySelectorAll("kbd, [aria-hidden='true']")) hint.remove();
    return copy.textContent?.trim() ?? "";
  });
}

/** The cards and lines J and K visit, in display order. */
const STOPS = [
  CARDS.lines[0],
  CARDS.lines[1],
  `Reviewing ${CARDS.queued[0].ref} @ ${CARDS.queued[0].revision.slice(0, 7)}`,
  CARDS.draft.title,
  `Reviewing ${CARDS.queued[1].ref} @ ${CARDS.queued[1].revision.slice(0, 7)}`,
  CARDS.longDraft.title,
  CARDS.skipTitle,
  CARDS.connector,
] as const;

test("AC4: J and K walk every card and line in display order, and ↑/↓ never move between them", async () => {
  const { page } = await open();
  // Start in the thread list: the first phase 5 line's subject.
  await page.locator(".eventcard-subject", { hasText: CARDS.lines[0] }).focus();
  expect(await focusedText(page)).toBe(STOPS[0]);

  for (const stop of STOPS.slice(1)) {
    await page.keyboard.press("j");
    expect(await focusedText(page), `J reaches ${stop}`).toBe(stop);
  }
  // The last stop: J has nowhere to go and focus stays.
  await page.keyboard.press("j");
  expect(await focusedText(page)).toBe(STOPS[STOPS.length - 1]);
  for (const stop of [...STOPS].reverse().slice(1)) {
    await page.keyboard.press("k");
    expect(await focusedText(page), `K reaches ${stop}`).toBe(stop);
  }
  await page.keyboard.press("k");
  expect(await focusedText(page)).toBe(STOPS[0]);

  // Arrows keep their native behaviour: they never move focus between cards.
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  expect(await focusedText(page)).toBe(CARDS.draft.title);
  await page.keyboard.press("ArrowDown");
  expect(await focusedText(page)).toBe(CARDS.draft.title);
  await page.keyboard.press("ArrowUp");
  expect(await focusedText(page)).toBe(CARDS.draft.title);
});

test("AC4: J and K typed in the composer stay text", async () => {
  const { page } = await open();
  const composer = page.getByRole("textbox", { name: "Message Wright" });
  await composer.click();
  await page.keyboard.type("jk J K");
  await expect(composer).toHaveValue("jk J K");
  await expect(composer).toBeFocused();
});

test("AC4: Enter on a draft card's toggle expands it, reads GET /drafts/:id once, and Enter again collapses it", async () => {
  const { page, chat } = await open();
  const card = draftCard(page, "draft");
  const toggle = toggleOf(card);
  // The collapsed card says which PR it is, shows the URL as text, and always says nothing was posted.
  await expect(card).toContainText(CARDS.draft.url);
  await expect(card).toContainText(CARDS.label);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(chat.detailReads).toEqual([]);

  await page.locator(".eventcard-subject", { hasText: CARDS.lines[0] }).focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("j");
  await expect(toggle).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("pre")).toContainText("Review of vikashruhil/loomwright#401: 0 blocking, 3 nits.");
  expect(chat.detailReads).toEqual([CARDS.draft.id]);
  // The body is inert text: the markup and the markdown link are characters, not elements.
  await expect(card.locator("pre")).toContainText("<b>poll.ts</b>");
  await expect(card.locator("pre")).toContainText("[the style guide](https://evil.example/style)");
  await expect(card.locator("pre b, pre a, a")).toHaveCount(0);
  await expect(card).toContainText(CARDS.label);

  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(card.locator("pre")).toHaveCount(0);
  // A held Enter acts once: auto-repeat keydowns are swallowed, not turned into clicks.
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // Opened again: the detail is not read a second time.
  expect(chat.detailReads).toEqual([CARDS.draft.id]);
});

test("AC4: Enter on the skip group's toggle lists the five refs with the dedupe key, and Enter again collapses it", async () => {
  const { page, chat } = await open();
  const card = skipCard(page);
  const toggle = toggleOf(card);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // The five skips are one card, not five lines.
  await expect(page.locator(".chat-skips")).toHaveCount(1);

  await page.locator(".eventcard-subject", { hasText: CARDS.lines[0] }).focus();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press("j");
  await expect(toggle).toBeFocused();

  // The two queued lines were read on mount in one batched request, not one each.
  expect(chat.eventRequests).toHaveLength(1);
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator("li.chat-skip-line")).toHaveText(CARDS.skips.map((s) => `Skipped ${s.ref}: unchanged under key ${CARDS.skipKey}`));
  expect(chat.eventReads).toEqual(expect.arrayContaining(CARDS.skips.map((s) => s.id)));
  // Opening the five skips is one more request, not five.
  expect(chat.eventRequests).toHaveLength(2);

  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(card.locator("li.chat-skip-line")).toHaveCount(0);
});

test("AC4: the connector line's subject opens the Integrations screen with Enter", async () => {
  const { page } = await open();
  await page.locator(".eventcard-subject", { hasText: CARDS.lines[0] }).focus();
  for (let i = 0; i < STOPS.length - 1; i += 1) await page.keyboard.press("j");
  expect(await focusedText(page)).toBe(CARDS.connector);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/integrations");
});

// ---- AC5 evidence: every designed state, light and dark ---------------------------------

interface Shot {
  readonly state: string;
  /** Put the cards in this state (clicks, not keys: the key paths are the tests above). */
  readonly prepare: (page: Page) => Promise<void>;
  readonly ready: (page: Page) => Promise<void>;
}

const SHOTS: readonly Shot[] = [
  {
    // Every card closed: each draft says which PR it is for, shows its URL, and says nothing was posted.
    state: "draft-collapsed",
    prepare: async (page) => {
      await setOpen(draftCard(page, "draft"), false);
      await setOpen(draftCard(page, "longDraft"), false);
      await setOpen(skipCard(page), false);
    },
    ready: async (page) => {
      await expect(draftCard(page, "draft")).toContainText(CARDS.label);
      await expect(draftCard(page, "longDraft")).toContainText(CARDS.label);
      await expect(page.locator(".chat-draft-text")).toHaveCount(0);
    },
  },
  {
    // The short draft open: the review body as inert text under the card's head.
    state: "draft-expanded",
    prepare: async (page) => {
      await setOpen(draftCard(page, "longDraft"), false);
      await setOpen(draftCard(page, "draft"), true);
    },
    ready: async (page) => {
      await expect(draftCard(page, "draft").locator("pre")).toContainText("Review of vikashruhil/loomwright#401");
      await expect(draftCard(page, "draft").locator("pre")).toContainText("<b>poll.ts</b>");
    },
  },
  {
    // The 120-line draft open: the body scrolls inside the card (a fake closing tag and markup stay text).
    state: "draft-long-body",
    prepare: async (page) => {
      await setOpen(draftCard(page, "draft"), false);
      await setOpen(draftCard(page, "longDraft"), true);
    },
    ready: async (page) => {
      const body = draftCard(page, "longDraft").locator("pre");
      await expect(body).toContainText("</untrusted-data>");
      await expect(body).toContainText("114. ");
      await draftCard(page, "longDraft").scrollIntoViewIfNeeded();
    },
  },
  {
    // The five skips as one collapsed card.
    state: "skips-collapsed",
    prepare: async (page) => {
      await setOpen(draftCard(page, "longDraft"), false);
      await setOpen(skipCard(page), false);
    },
    ready: async (page) => {
      await expect(toggleOf(skipCard(page))).toHaveAttribute("aria-expanded", "false");
      await skipCard(page).scrollIntoViewIfNeeded();
    },
  },
  {
    // The same card open: the five refs and the dedupe key.
    state: "skips-expanded",
    prepare: async (page) => {
      await setOpen(skipCard(page), true);
    },
    ready: async (page) => {
      await expect(skipCard(page).locator("li.chat-skip-line")).toHaveCount(5);
      await skipCard(page).scrollIntoViewIfNeeded();
    },
  },
];

function shotName(state: string, theme: Theme): string {
  return `chat-cards-${state}-${theme}.png`;
}

const EXPECTED = SHOTS.flatMap((s) => THEMES.map((t) => shotName(s.state, t)));

test("every designed state is screenshot in light and dark", async () => {
  test.setTimeout(180_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  // The folder holds exactly this run's screenshots: a renamed or removed state leaves no stale PNG.
  for (const file of readdirSync(EVIDENCE_DIR)) if (file.endsWith(".png")) rmSync(join(EVIDENCE_DIR, file));
  const { page } = await open();
  for (const shot of SHOTS) {
    await shot.prepare(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await shot.ready(page);
      await page.screenshot({ path: join(EVIDENCE_DIR, shotName(shot.state, theme)), scale: "css" });
    }
  }
  const written = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png"));
  expect(written.sort()).toEqual([...EXPECTED].sort());
});

test("the evidence README lists every screenshot, and nothing else", async () => {
  const readme = readFileSync(join(EVIDENCE_DIR, "README.md"), "utf8");
  const listed = new Set(readme.match(/chat-cards-[a-z-]+-(?:light|dark)\.png/g) ?? []);
  expect([...listed].sort()).toEqual([...EXPECTED].sort());
  // ...and the folder holds those files: the README and the folder do not drift apart.
  const onDisk = readdirSync(EVIDENCE_DIR).filter((f) => f.endsWith(".png"));
  expect(onDisk.sort()).toEqual([...EXPECTED].sort());
});
