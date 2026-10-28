// The Integrations screen (phase 6 item 11) in the built app against the fixture
// kernel (`./fixtures/integrations.ts`): connect with the token reaching the
// kernel through the main process and nowhere else (AC9), the refusals inline
// (AC9), the states from empty to connected to disconnected and a live update
// with no layout shift (AC10), the whole flow by keyboard alone (AC11), and a
// light and a dark screenshot of every designed state (AC12). Run `npm run
// build` first.
//
// Screenshots: with `INTEGRATIONS_EVIDENCE=1` they are written to the
// committed evidence dir `docs/evidence/phase-6-polish/integrations/`;
// otherwise to Playwright's per-test output dir, so CI never dirties tracked
// files, and the last test asserts nothing under the tracked dir changed during
// the run. The spec asserts behaviour, never pixels: fonts differ between macOS
// and CI.
//
// The shell does not mount the ⌘K palette or bind ⌘5 yet (probed in the built
// app: neither key does anything), so the keyboard-only walk opens the screen by
// its hash, as Team's does, then uses Tab, Enter, Escape and typing only. The
// ⌘K commands are pinned in `integrations.test.tsx` (jsdom).
import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page, TestInfo } from "@playwright/test";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { ACCOUNT, NEW_TOKEN, REFRESHED_REPO, REPOS, TOKEN, integrationsFixture } from "./fixtures/integrations";
import type { IntegrationsFixture, IntegrationsFixtureOptions } from "./fixtures/integrations";

const EVIDENCE_DIR = fileURLToPath(new URL("../../docs/evidence/phase-6-polish/integrations/", import.meta.url));
const THEMES = ["light", "dark"] as const;
/**
 * The screen's test ids, as `INTEGRATIONS_TEST_IDS` in `src/screens/integrations/model.ts` has them. They are
 * copied, not imported: that module pulls in Team's model and so the Sessions screen's `.tsx`, which the e2e
 * project's `tsconfig.node.json` (no `jsx`) cannot type-check. The last test reads `model.ts` and fails if any
 * id below is not one of its values, so a renamed id cannot drift unnoticed.
 */
const IDS = {
  account: "integrations-account",
  agentCard: "integrations-agent",
  agentsNote: "integrations-agents-note",
  band: "integrations-band",
  count: "integrations-count",
  detail: "integrations-detail",
  detailHeader: "integrations-detail-header",
  disconnect: "integrations-disconnect",
  empty: "integrations-empty",
  emptyConnect: "integrations-connect",
  expires: "integrations-expires",
  inBand: "integrations-in-band",
  list: "integrations-list",
  listMeta: "integrations-row-meta",
  loading: "integrations-loading",
  permissions: "integrations-permissions",
  refresh: "integrations-refresh",
  replace: "integrations-replace",
  repos: "integrations-repos",
  reposHeading: "integrations-repos-heading",
  screen: "screen-integrations",
  sheet: "integrations-sheet",
  sheetCancel: "integrations-sheet-cancel",
  sheetConnect: "integrations-sheet-connect",
  sheetError: "integrations-sheet-error",
  sheetStatus: "integrations-sheet-status",
  sheetToken: "integrations-token",
  status: "integrations-status",
} as const;
const MODEL_SOURCE = fileURLToPath(new URL("../src/screens/integrations/model.ts", import.meta.url));

/** When this run began, for the guard that the tracked evidence dir is untouched without `INTEGRATIONS_EVIDENCE`. */
const RUN_START = Date.now();

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;
const pageErrors: string[] = [];
/** Every console line the page logged and every line the main process wrote, for the secrecy checks. */
const logs: string[] = [];

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
  logs.length = 0;
  // Drained per test, so an error is reported against the test that caused it.
  expect(pageErrors.splice(0), "the window logged no uncaught page errors").toEqual([]);
});

/** Launch the built app on a fixture kernel serving `fx`, and open Integrations by its hash. */
async function open(fx: IntegrationsFixture): Promise<Page> {
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  app = await launchApp(fixture.env);
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on("data", (chunk: Buffer) => logs.push(String(chunk)));
  const page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => logs.push(message.text()));
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = "#/integrations";
  });
  await expect(page.getByTestId(IDS.screen)).toBeVisible();
  return page;
}

/** `open` for a fixture made from `options`. */
function launchWith(options: IntegrationsFixtureOptions = {}): { readonly fx: IntegrationsFixture; readonly page: Promise<Page> } {
  const fx = integrationsFixture(options);
  return { fx, page: open(fx) };
}

async function setTheme(page: Page, theme: (typeof THEMES)[number] | undefined): Promise<void> {
  await page.evaluate((value) => {
    if (value === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
  }, theme);
}

/** Resolves after two animation frames, so any pending React commit and layout have landed. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** `integrations-<state>-light.png` and `-dark.png` of the whole window; the dark tokens must really apply. */
async function screenshots(page: Page, state: string, testInfo: TestInfo): Promise<void> {
  const evidence = process.env.INTEGRATIONS_EVIDENCE === "1";
  if (evidence) mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grounds: string[] = [];
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await settle(page);
    grounds.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ground").trim()));
    const file = `integrations-${state}-${theme}.png`;
    const path = evidence ? join(EVIDENCE_DIR, file) : testInfo.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    expect(statSync(path).size, `${file} was written`).toBeGreaterThan(1000);
  }
  expect(grounds[0], "the dark tokens applied").not.toBe(grounds[1]);
  await setTheme(page, undefined);
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

/**
 * Where `needles` are in the page right now: its markup (every attribute), its
 * text, the URL, every field's value and both storages. Names the place, never
 * the value, so a failure does not print the token.
 */
async function whereIn(page: Page, needles: readonly string[]): Promise<string[]> {
  return page.evaluate((list) => {
    const places: string[] = [];
    const scan = (where: string, text: string | null | undefined): void => {
      if (text !== null && text !== undefined && list.some((needle) => text.includes(needle))) places.push(where);
    };
    scan("markup", document.documentElement.outerHTML);
    scan("text", document.body.innerText);
    scan("title", document.title);
    scan("url", window.location.href);
    document.querySelectorAll("input, textarea").forEach((el, i) => scan(`field ${i} value`, (el as HTMLInputElement).value));
    scan("localStorage", JSON.stringify({ ...window.localStorage }));
    scan("sessionStorage", JSON.stringify({ ...window.sessionStorage }));
    return places;
  }, needles);
}

/** No page, URL, storage or console line (the page's and the main process's) holds any of `tokens`. */
async function expectNoToken(page: Page, what: string, tokens: readonly string[] = [TOKEN, NEW_TOKEN]): Promise<void> {
  expect(await whereIn(page, tokens), `${what}: the token is nowhere in the page`).toEqual([]);
  expect(logs.filter((line) => tokens.some((token) => line.includes(token))).length, `${what}: no console or main-process line has the token`).toBe(0);
}

/** Counts pointer input from here on: the keyboard-only test asserts it stays 0. */
async function countPointer(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __pointerInput?: number };
    w.__pointerInput = 0;
    for (const type of ["pointerdown", "mousedown", "click"]) {
      window.addEventListener(
        type,
        (event) => {
          // A keyboard activation of a button fires a synthetic click with detail 0; a pointer's has detail >= 1.
          if (event.type !== "click" || (event as MouseEvent).detail > 0) w.__pointerInput = (w.__pointerInput ?? 0) + 1;
        },
        true,
      );
    }
  });
  return () => page.evaluate(() => (window as unknown as { __pointerInput?: number }).__pointerInput ?? -1);
}

/** Press Tab until `target` has focus; fails when it never does. */
async function tabTo(page: Page, target: Locator, what: string, max = 60): Promise<void> {
  await expect(target, `${what} is on the page`).toHaveCount(1);
  for (let i = 0; i <= max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    if (i < max) await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${what} in ${max} presses`);
}

const byId = (page: Page, id: string): Locator => page.getByTestId(id);
const reads = (): number => fixture?.requests.filter((r) => r.method === "GET" && r.path === "/connectors").length ?? 0;

test("AC9: the pasted token reaches the kernel through the main process, the field is empty at once, and the token is in no page text, storage, URL or console line", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith();
  const page = await opening;
  await expect(byId(page, IDS.empty)).toBeVisible();
  await expect(byId(page, IDS.empty).getByRole("heading", { level: 2 })).toHaveText("Connect GitHub so a playbook can read your PRs.");
  await expect(byId(page, IDS.listMeta)).toHaveText("not connected");
  await screenshots(page, "not-connected", testInfo);

  await byId(page, IDS.emptyConnect).click();
  const sheet = byId(page, IDS.sheet);
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-mode", "connect");
  const field = byId(page, IDS.sheetToken);
  const connect = byId(page, IDS.sheetConnect);
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toBeFocused();
  await expect(connect).toBeDisabled();
  await screenshots(page, "sheet", testInfo);

  await field.fill(TOKEN);
  await expect(connect).toBeEnabled();
  // Not vacuous: the scan does find the token while it is still in the field.
  expect(await whereIn(page, [TOKEN]), "the scan sees the token in the field before Connect").toEqual(["field 0 value"]);

  fx.holdToken();
  await connect.click();
  await expect.poll(() => fx.tokens.length, { message: "the kernel received the token" }).toBe(1);
  // The main process posted exactly the pasted value, and the field is already empty while the kernel checks.
  expect(fx.tokens).toEqual([{ token: TOKEN }]);
  await expect(field).toHaveValue("");
  await expect(field).toBeDisabled();
  await expect(byId(page, IDS.sheetStatus)).toHaveText("Checking with GitHub…");
  await expect(connect).toHaveAttribute("aria-busy", "true");
  await expect(byId(page, IDS.listMeta)).toHaveText("connecting · checking the token with GitHub");
  await expectNoToken(page, "while the kernel checks");
  await screenshots(page, "connecting", testInfo);

  fx.releaseToken();
  await expect(sheet).toHaveCount(0);
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "connected");
  await expect(byId(page, IDS.account)).toHaveText(ACCOUNT);
  expect(fx.tokens, "one token was posted").toEqual([{ token: TOKEN }]);
  await expectNoToken(page, "after the kernel accepted it");
});

test("AC9: a write-scoped token is refused inline, naming the permission, and the field is empty; an invalid one is refused in its own words; a good one then connects", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith();
  const page = await opening;
  fx.refuse("token_write_scoped");
  await byId(page, IDS.emptyConnect).click();
  const sheet = byId(page, IDS.sheet);
  const field = byId(page, IDS.sheetToken);
  await field.fill(TOKEN);
  await byId(page, IDS.sheetConnect).click();

  const alert = byId(page, IDS.sheetError);
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("Pull requests: write → set to Read-only");
  await expect(alert).toContainText("edit the token");
  await expect(alert).toContainText("paste it here again");
  await expect(sheet, "the sheet stays open").toBeVisible();
  await expect(field).toHaveValue("");
  await expect(field).toBeEnabled();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(fx.tokens).toEqual([{ token: TOKEN }]);
  // The kernel wrote a rejected row: the list reads it, and the empty state stays under the sheet.
  await expect(byId(page, IDS.listMeta)).toHaveText("not connected · the last token was refused");
  await expect(byId(page, IDS.empty)).toBeVisible();
  await expectNoToken(page, "after the write-scoped refusal");
  await screenshots(page, "rejected-write", testInfo);

  fx.refuse("token_invalid");
  await field.fill(NEW_TOKEN);
  await byId(page, IDS.sheetConnect).click();
  await expect.poll(() => fx.tokens.length).toBe(2);
  expect(fx.tokens[1]).toEqual({ token: NEW_TOKEN });
  await expect(alert).toContainText("GitHub didn't accept this token");
  await expect(alert).not.toContainText("Pull requests");
  await expect(field).toHaveValue("");
  await expect(sheet).toBeVisible();
  await expectNoToken(page, "after the invalid-token refusal");
  await screenshots(page, "rejected-invalid", testInfo);

  fx.refuse(undefined);
  await field.fill(TOKEN);
  await byId(page, IDS.sheetConnect).click();
  await expect(sheet).toHaveCount(0);
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "connected");
  expect(fx.tokens).toEqual([{ token: TOKEN }, { token: NEW_TOKEN }, { token: TOKEN }]);
  await expectNoToken(page, "after the good token");
});

test("AC10: empty, then connected with its account, permissions, expiry, repos and granted agents, then Disconnect asks first and ends at not connected", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith();
  const page = await opening;
  await expect(byId(page, IDS.empty)).toBeVisible();
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "none");
  await expect(byId(page, IDS.count)).toHaveText("1 connector · all optional");

  // The kernel connects GitHub (not this window): the feed's connector_status is how the screen learns.
  fx.change("connected");
  const detail = byId(page, IDS.detail);
  await expect(detail).toHaveAttribute("data-state", "connected");
  await expect(byId(page, IDS.empty)).toHaveCount(0);
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
  await expect(byId(page, IDS.status)).toContainText("connected");
  await expect(byId(page, IDS.account)).toHaveText(ACCOUNT);
  await expect(byId(page, IDS.expires)).toContainText("88 days left");
  await expect(byId(page, IDS.permissions).getByRole("listitem")).toHaveText([/^Metadata\s*Read-only$/, /^Pull requests\s*Read-only$/, /^Contents\s*Read-only$/]);
  await expect(byId(page, IDS.reposHeading)).toHaveText(`Reachable repos · ${REPOS.length}`);
  await expect(byId(page, IDS.repos).getByRole("listitem")).toHaveText([...REPOS]);
  await expect(detail.getByRole("heading", { level: 3, name: "Agents with the GitHub grant · 1" })).toBeVisible();
  const cards = byId(page, IDS.agentCard);
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-agent-id", "mason");
  await expect(cards).toContainText("Mason");
  await expect(byId(page, IDS.agentsNote)).toContainText("Wright and Ada don't have it.");
  await expect(byId(page, IDS.replace)).toBeVisible();
  await expect(byId(page, IDS.disconnect)).toBeVisible();
  await screenshots(page, "connected", testInfo);

  // Disconnect asks first: no request until the owner confirms.
  await byId(page, IDS.disconnect).click();
  const confirm = page.getByRole("alertdialog", { name: "Disconnect GitHub?" });
  await expect(confirm).toBeVisible();
  expect(fx.disconnects, "nothing is sent while the confirm is open").toEqual([]);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  expect(fx.disconnects, "Cancel sends nothing").toEqual([]);
  await expect(detail).toHaveAttribute("data-state", "connected");

  await byId(page, IDS.disconnect).click();
  await confirm.getByRole("button", { name: "Disconnect" }).click();
  await expect.poll(() => fx.disconnects.length, { message: "the kernel received the disconnect" }).toBe(1);
  await expect(confirm).toHaveCount(0);
  await expect(byId(page, IDS.empty)).toBeVisible();
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "none");
  await expect(byId(page, IDS.listMeta)).toHaveText("not connected");
  await expect(byId(page, IDS.replace)).toHaveCount(0);
  expect(fx.disconnects).toHaveLength(1);
});

test("AC10: a connector_status event with a changed GET /connectors answer updates the screen with no reload, no loading flash and no layout shift", async () => {
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  const detail = byId(page, IDS.detail);
  await expect(detail).toHaveAttribute("data-state", "connected");
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
  await settle(page);

  // A marker on the window (a reload would drop it) and a watcher for the loading skeleton (a flash would set it).
  await page.evaluate((loadingId) => {
    const w = window as unknown as { __marker?: string; __loadingSeen?: boolean };
    w.__marker = "same-window";
    w.__loadingSeen = false;
    new MutationObserver(() => {
      if (document.querySelector(`[data-testid="${loadingId}"]`) !== null) w.__loadingSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, IDS.loading);

  const boxes = async () => ({ list: await byId(page, IDS.list).boundingBox(), header: await byId(page, IDS.detailHeader).boundingBox() });
  const before = await boxes();
  expect(before.list, "the list pane has a box").not.toBeNull();
  expect(before.header, "the detail header has a box").not.toBeNull();
  const readsBefore = reads();
  expect(readsBefore, "GET /connectors was read on mount (non-vacuous)").toBeGreaterThanOrEqual(1);

  fx.change("expiring");
  await expect(detail).toHaveAttribute("data-state", "expiring");
  await expect(byId(page, IDS.listMeta)).toHaveText(`expiring in 8 days · ${ACCOUNT}`);
  await expect(byId(page, IDS.inBand)).toBeVisible();
  await expect(byId(page, IDS.expires)).toContainText("renew soon");
  await settle(page);

  expect(reads(), "the event made the screen read GET /connectors again").toBeGreaterThan(readsBefore);
  expect(await boxes(), "the list pane and the detail header did not move or resize").toEqual(before);
  const seen = await page.evaluate(() => ({ marker: (window as unknown as { __marker?: string }).__marker, loading: (window as unknown as { __loadingSeen?: boolean }).__loadingSeen }));
  expect(seen.marker, "the window was not reloaded").toBe("same-window");
  expect(seen.loading, "the screen never flashed its loading state").toBe(false);
});

test("expiring: the attention band, the renew soon badge and Replace token as the primary button", async ({}, testInfo) => {
  const { page: opening } = launchWith({ connector: "expiring" });
  const page = await opening;
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "expiring");
  const band = byId(page, IDS.inBand);
  await expect(band).toContainText("The token expires in 8 days");
  await expect(band).toHaveAttribute("data-tone", "attention");
  await expect(byId(page, IDS.expires)).toContainText("renew soon");
  await expect(byId(page, IDS.listMeta)).toHaveText(`expiring in 8 days · ${ACCOUNT}`);
  await expect(byId(page, IDS.replace)).toHaveAttribute("data-variant", "primary");
  await expect(byId(page, IDS.disconnect)).toHaveAttribute("data-variant", "danger");
  await screenshots(page, "expiring", testInfo);
});

test("expired: the danger band, the expired badge, the last read repos, and Replace token as the primary button that opens the replace sheet", async ({}, testInfo) => {
  const { page: opening } = launchWith({ connector: "expired" });
  const page = await opening;
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "expired");
  const band = byId(page, IDS.inBand);
  await expect(band).toContainText("The token expired on");
  await expect(band).toHaveAttribute("role", "alert");
  await expect(band).toHaveAttribute("data-tone", "danger");
  await expect(byId(page, IDS.expires)).toContainText("expired 3 days ago");
  await expect(byId(page, IDS.listMeta)).toHaveText(`expired · ${ACCOUNT}`);
  await expect(byId(page, IDS.repos).getByRole("listitem")).toHaveText([...REPOS]);
  await expect(byId(page, IDS.replace)).toHaveAttribute("data-variant", "primary");
  await screenshots(page, "expired", testInfo);

  await byId(page, IDS.replace).click();
  await expect(byId(page, IDS.sheet)).toHaveAttribute("data-mode", "replace");
  await expect(byId(page, IDS.sheet)).toContainText("The new token replaces the expired one once it passes the check.");
});

test("unreachable: when the kernel goes away mid-read the last answer stays, the writes are disabled and it never reads not connected", async ({}, testInfo) => {
  const { fx, page: opening } = launchWith({ connector: "connected" });
  const page = await opening;
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "connected");

  // The next read gets no answer (the kernel closes under it), which the bridge reports as status 0.
  fx.dropNextRead();
  fx.change("connected");
  const band = byId(page, IDS.band);
  await expect(band).toBeVisible();
  await expect(band).toContainText("Couldn't reach the kernel");
  await expect(byId(page, IDS.listMeta)).toHaveText("status unknown · kernel unreachable");
  // The last good answer stays, read-only; it is never the empty state.
  await expect(byId(page, IDS.empty)).toHaveCount(0);
  await expect(byId(page, IDS.detail)).toHaveAttribute("data-state", "connected");
  await expect(byId(page, IDS.account)).toHaveText(ACCOUNT);
  await expect(byId(page, IDS.status)).toContainText("Unknown while the kernel is unreachable");
  for (const id of [IDS.replace, IDS.disconnect, IDS.refresh]) await expect(byId(page, id)).toBeDisabled();
  await screenshots(page, "unreachable", testInfo);
});

// AC11 GAP, recorded as an open owner decision: AC11 says "the screen via ⌘5 ... ⌘K". The shell mounts neither the
// command palette nor the screen shortcuts (CommandPaletteHost is mounted only by the palette gallery), and wiring them
// is a shell change outside this screen's PR. So this test is keyboard-only and never clicks (a pointer-event counter
// must read 0), but it reaches the screen by hash and drives Tab/Enter/Escape; ⌘5 and ⌘K are NOT exercised in the built
// app. The three ⌘K commands are pinned in jsdom (`integrations.test.tsx`, `connect-sheet.test.tsx`). See the README's
// "AC11: what is and is not met".
test("AC11: by keyboard alone, connect, cancel, refuse, replace the token, refresh the repos and disconnect with a confirm", async () => {
  const { fx, page: opening } = launchWith();
  const page = await opening;
  const kb = page.keyboard;
  const pointer = await countPointer(page);
  const sheet = byId(page, IDS.sheet);
  const field = byId(page, IDS.sheetToken);
  const detail = byId(page, IDS.detail);

  // Connect GitHub opens the sheet with the field focused; Escape cancels it and focus returns to the opener.
  const connect = byId(page, IDS.emptyConnect);
  await tabTo(page, connect, "Connect GitHub");
  await kb.press("Enter");
  await expect(sheet).toBeVisible();
  await expect(field).toBeFocused();
  await kb.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(connect).toBeFocused();
  expect(fx.tokens, "Escape sends nothing").toEqual([]);

  // Cancel, reached by Tab, closes it too.
  await kb.press("Enter");
  await expect(field).toBeFocused();
  await kb.press("Tab");
  await expect(byId(page, IDS.sheetCancel)).toBeFocused();
  await kb.press("Enter");
  await expect(sheet).toHaveCount(0);
  expect(fx.tokens, "Cancel sends nothing").toEqual([]);

  // Typing a token and pressing Enter submits it; a refusal leaves the field empty and focused.
  fx.refuse("token_invalid");
  await kb.press("Enter");
  await expect(field).toBeFocused();
  await kb.type(TOKEN);
  await kb.press("Enter");
  await expect(byId(page, IDS.sheetError)).toContainText("GitHub didn't accept this token");
  expect(fx.tokens).toEqual([{ token: TOKEN }]);
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();

  // The good token connects.
  fx.refuse(undefined);
  await kb.type(TOKEN);
  await kb.press("Enter");
  await expect(sheet).toHaveCount(0);
  await expect(detail).toHaveAttribute("data-state", "connected");
  expect(fx.tokens).toEqual([{ token: TOKEN }, { token: TOKEN }]);

  // Replace token: the sheet in replace mode; the new token is posted and the field is empty afterwards.
  await tabTo(page, byId(page, IDS.replace), "Replace token");
  await kb.press("Enter");
  await expect(sheet).toHaveAttribute("data-mode", "replace");
  await expect(sheet).toContainText("The current token stays in use until the new one passes the check.");
  await expect(field).toBeFocused();
  fx.holdToken();
  await kb.type(NEW_TOKEN);
  await kb.press("Enter");
  await expect.poll(() => fx.tokens.length).toBe(3);
  expect(fx.tokens[2]).toEqual({ token: NEW_TOKEN });
  await expect(field).toHaveValue("");
  fx.releaseToken();
  await expect(sheet).toHaveCount(0);
  await expect(detail).toHaveAttribute("data-state", "connected");
  await expectNoToken(page, "after the keyboard-driven connect and replace");

  // Refresh re-reads the repos from GitHub (`?refresh=1`) and shows the answer.
  await expect(byId(page, IDS.reposHeading)).toHaveText(`Reachable repos · ${REPOS.length}`);
  await tabTo(page, byId(page, IDS.refresh), "Refresh");
  await kb.press("Enter");
  await expect(byId(page, IDS.reposHeading)).toHaveText(`Reachable repos · ${REPOS.length + 1}`);
  await expect(byId(page, IDS.repos)).toContainText(REFRESHED_REPO);
  expect(fx.repoReads).toContainEqual({ refresh: "1" });

  // Disconnect asks first: Escape closes the confirm with nothing sent, then Enter on its Disconnect button sends it.
  const disconnect = byId(page, IDS.disconnect);
  await tabTo(page, disconnect, "Disconnect");
  await kb.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: "Disconnect GitHub?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await kb.press("Escape");
  await expect(confirm).toHaveCount(0);
  expect(fx.disconnects, "Escape on the confirm sends nothing").toEqual([]);
  await expect(disconnect).toBeFocused();

  await kb.press("Enter");
  await expect(confirm).toBeVisible();
  await kb.press("Tab");
  await expect(confirm.getByRole("button", { name: "Disconnect" })).toBeFocused();
  await kb.press("Enter");
  await expect.poll(() => fx.disconnects.length).toBe(1);
  await expect(confirm).toHaveCount(0);
  await expect(byId(page, IDS.empty)).toBeVisible();
  await expect(byId(page, IDS.listMeta)).toHaveText("not connected");
  expect(await pointer(), "no pointer input").toBe(0);
});

test("AC12: without INTEGRATIONS_EVIDENCE the screenshots went to the output dir and nothing under the tracked evidence dir changed during the run", async () => {
  test.skip(process.env.INTEGRATIONS_EVIDENCE === "1", "an evidence run writes the tracked dir on purpose");
  let files: string[] = [];
  try {
    files = readdirSync(EVIDENCE_DIR);
  } catch {
    // No committed evidence dir at all: nothing could have been written to it.
  }
  const touched = files.filter((name) => statSync(join(EVIDENCE_DIR, name)).mtimeMs > RUN_START);
  expect(touched, "no file under docs/evidence/phase-6-polish/integrations/ is newer than this run's start").toEqual([]);
});

test("the test ids this spec targets are the ones INTEGRATIONS_TEST_IDS in model.ts defines", () => {
  const source = readFileSync(MODEL_SOURCE, "utf8");
  const defined = new Set([...source.matchAll(/^\s+\w+: "([^"]+)",?$/gm)].map((match) => match[1]));
  expect(defined.size, "model.ts's test-id table was read").toBeGreaterThan(20);
  expect(Object.values(IDS).filter((id) => !defined.has(id)), "ids the spec uses that model.ts does not define").toEqual([]);
});
