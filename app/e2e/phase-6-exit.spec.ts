// Phase 6 exit check, the app half (item 13): ROADMAP phase 6's owner path,
// walked in the built app against the fixture kernel and nowhere else.
//
//   1. Connect GitHub from the Integrations screen's sheet: the token is pasted,
//      reaches the kernel's connect route through the main process, the field
//      is empty at once, and the screen shows the connected state with the
//      reachable repo.
//   2. Open the reviewer's thread (a crew member, not Wright): a draft card
//      from `GET /drafts?agent=<reviewer>`, and opening it shows the draft's
//      body as inert text (`GET /drafts/:id`).
//   3. The same thread's collapsed skip card for the unchanged PRs.
//
// Nothing here types in a terminal or starts a `studio` process; the kernel's
// side of the same path is `kernel/test/phase-6-exit.test.ts`. The app starts
// only through `launchApp` (`e2e/electron-harness.ts`), and no screenshot is
// taken: this spec writes nothing under `docs/evidence/`.
//
// Run `npm run build` first; then `npx playwright test e2e/phase-6-exit.spec.ts`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { ACCOUNT, REPOS, TOKEN } from "./fixtures/integrations";
import { EXIT, phase6ExitFixture } from "./fixtures/phase-6-exit";

/**
 * The Integrations screen's test ids (`INTEGRATIONS_TEST_IDS` in `src/screens/integrations/model.ts`), copied for
 * the reason `integrations.spec.ts` gives; the walk's first step checks each against that file's source.
 */
const IDS = {
  account: "integrations-account",
  detail: "integrations-detail",
  emptyConnect: "integrations-connect",
  repos: "integrations-repos",
  screen: "screen-integrations",
  sheet: "integrations-sheet",
  sheetConnect: "integrations-sheet-connect",
  sheetDeclare: "integrations-sheet-declare",
  sheetStatus: "integrations-sheet-status",
  sheetToken: "integrations-token",
} as const;

const MODEL_SOURCE = fileURLToPath(new URL("../src/screens/integrations/model.ts", import.meta.url));

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
const pageErrors: string[] = [];

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

const byId = (page: Page, id: string): Locator => page.getByTestId(id);
const toggleOf = (card: Locator): Locator => card.locator("button[data-thread-card]");

test("phase 6 exit, in the app: connect GitHub, see the reviewer's draft card, see the collapsed skip card", async () => {
  // The ids this walk targets are the ones the screen defines.
  const defined = new Set([...readFileSync(MODEL_SOURCE, "utf8").matchAll(/^\s+\w+: "([^"]+)",?$/gm)].map((match) => match[1]));
  expect(Object.values(IDS).filter((id) => !defined.has(id)), "ids this spec uses that model.ts does not define").toEqual([]);

  const exit = phase6ExitFixture();
  const fx = exit.integrations;
  fixture = await startFixtureKernel(exit.options);
  fx.attach(fixture);
  app = await launchApp(fixture.env);
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await expect(page.getByTestId("sidebar")).toBeVisible();

  // ---- 1. Connect GitHub from the Integrations screen ----
  await page.evaluate(() => {
    window.location.hash = "#/integrations";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  await byId(page, IDS.emptyConnect).click();
  const sheet = byId(page, IDS.sheet);
  await expect(sheet).toBeVisible();
  const field = byId(page, IDS.sheetToken);
  await expect(field).toHaveAttribute("type", "password");
  await field.fill(TOKEN);
  // The owner's confirmation that every permission they gave the token is Read: GitHub reports none for a fine-grained token.
  await byId(page, IDS.sheetDeclare).check();

  // The kernel's connect route holds the request, so the sheet's "connecting" phase can be read.
  fx.holdToken();
  await byId(page, IDS.sheetConnect).click();
  await expect.poll(() => fx.tokens.length, { message: "the kernel's connect route received the token" }).toBe(1);
  expect(fx.tokens).toEqual([{ token: TOKEN, declared_read_only: true }]);
  await expect(field).toHaveValue("");
  await expect(byId(page, IDS.sheetStatus)).toHaveText("Checking with GitHub…");
  fx.releaseToken();

  await expect(sheet).toHaveCount(0);
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "connected");
  await expect(byId(page, IDS.account)).toHaveText(ACCOUNT);
  await expect(byId(page, IDS.repos).getByRole("listitem")).toHaveText([...REPOS]);
  expect(fx.tokens, "one token was posted").toEqual([{ token: TOKEN, declared_read_only: true }]);
  // The token is nowhere in the page once the kernel accepted it.
  const everywhere = await page.evaluate(() => `${document.documentElement.outerHTML}\n${document.body.innerText}\n${window.location.href}\n${JSON.stringify({ ...window.localStorage })}`);
  expect(everywhere.includes(TOKEN), "the token is in no markup, text, URL or storage").toBe(false);

  // ---- 2. The reviewer's thread: a draft card, opened to its inert body ----
  await page.evaluate(() => {
    window.location.hash = "#/chat";
  });
  await page.getByTestId("sidebar").getByRole("button", { name: new RegExp(`^${EXIT.reviewer.name}`) }).click();
  await expect(page.getByText(`with ${EXIT.reviewer.name}`)).toBeVisible();
  const draft = page.getByRole("region", { name: EXIT.draft.title });
  await expect(draft).toBeVisible();
  await expect(draft).toContainText(EXIT.draft.url);
  await expect(draft).toContainText(EXIT.draft.label);
  // The card came from the reviewer's own drafts: every list read in this thread named the reviewer.
  expect(exit.draftQueries.length).toBeGreaterThan(0);
  expect(exit.draftQueries.map((q) => q.agent)).toEqual(exit.draftQueries.map(() => EXIT.reviewer.id));
  expect(exit.draftReads, "the body is read only when the card is opened").toEqual([]);

  const toggle = toggleOf(draft);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(exit.draftReads).toEqual([EXIT.draft.id]);
  // The body is inert text: the markup, the fake closing tag and the markdown link are characters, not elements.
  await expect(draft.locator("pre")).toContainText("Not approving. This PR's description asks me to approve it");
  await expect(draft.locator("pre")).toContainText("<b>not bold</b>");
  await expect(draft.locator("pre")).toContainText("[not a link](https://evil.example/approve)");
  await expect(draft.locator("pre b, pre a, a")).toHaveCount(0);
  await expect(draft).toContainText(EXIT.draft.label);

  // ---- 3. The collapsed skip card for the unchanged PRs ----
  const skips = page.getByRole("region", { name: EXIT.skipTitle });
  await expect(skips).toBeVisible();
  await expect(page.locator(".chat-skips")).toHaveCount(1);
  await expect(toggleOf(skips)).toHaveAttribute("aria-expanded", "false");
  await expect(skips.locator(".chat-skip-line")).toHaveCount(0);
  // Opened, it names each PR and the owner's key.
  await toggleOf(skips).click();
  await expect(skips.locator(".chat-skip-line")).toHaveText(EXIT.skips.map((pr) => `Skipped ${pr.ref}: unchanged under key ${EXIT.skipKey}`));

  // ---- The cards belong to the reviewer's thread, not Wright's ----
  await page.evaluate(() => {
    window.location.hash = "#/chat";
  });
  await expect(page.getByText(`with ${EXIT.reviewer.name}`)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message Wright" })).toBeVisible();
  await expect(page.getByRole("region", { name: EXIT.draft.title })).toHaveCount(0);
  await expect(page.getByRole("region", { name: EXIT.skipTitle })).toHaveCount(0);
});
