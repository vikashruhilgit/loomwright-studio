// The shell's frame in the built app against the fixture kernel (phase 7, shell item).
//
// AC1: the shared kernel-unreachable band. The fixture's listener is STOPPED under an open window
// (`fixture.stop()`, not a read faked to status 0), which is what the 2026-11-01 live run did with
// `launchctl bootout`: the store reads `reconnecting`, the shell shows the one red band, and the screen
// keeps its last data under it with its writes off. `fixture.restart()` (same port, same state) clears it.
// Run `npm run build` first.
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { BACKOFF_CAP_MS, SETTLE_MS } from "../src/store/store";
import { launchApp } from "./electron-harness";
import { startFixtureKernel } from "./fixture-kernel";
import type { FixtureKernel } from "./fixture-kernel";
import { ACCOUNT, integrationsFixture } from "./fixtures/integrations";

/** Above the backoff cap plus `SETTLE_MS`: every wait for the store to change state. */
const STATE_TIMEOUT_MS = BACKOFF_CAP_MS + SETTLE_MS + 3_000;

/** The band copy, exactly (`KERNEL_BAND_COPY` in `src/shell/KernelStates.tsx`). */
const BAND_COPY = "Couldn't reach the kernel. It may be restarting; this window reconnects on its own.";

/**
 * The screen's test ids, copied as `integrations.spec.ts` copies them (`model.ts` pulls in `.tsx` the e2e project's
 * `tsconfig.node.json` cannot type-check).
 */
const IDS = {
  screen: "screen-integrations",
  listMeta: "integrations-row-meta",
  band: "integrations-band",
  replace: "integrations-replace",
  switchToApp: "integrations-switch-to-app",
  disconnect: "integrations-disconnect",
  refresh: "integrations-refresh",
} as const;

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

/** Launch the built app on `started` and wait until the store is live (the feed open and settled). */
async function launch(started: FixtureKernel): Promise<Page> {
  app = await launchApp(started.env);
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  await expect.poll(() => started.requests.some((r) => r.path === "/events/stream"), { timeout: STATE_TIMEOUT_MS }).toBe(true);
  // `SETTLE_MS` more guarantees the store is live with no frame at all.
  await page.waitForTimeout(SETTLE_MS + 500);
  return page;
}

const byId = (page: Page, id: string): Locator => page.getByTestId(id);

/** Exactly one shared band, and neither the old reconnecting line nor Integrations' own band beside it. */
async function expectOneSharedBand(page: Page): Promise<void> {
  const band = byId(page, "kernel-unreachable-band");
  await expect(band).toHaveCount(1);
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("role", "alert");
  await expect(band).toHaveText(BAND_COPY);
  await expect(byId(page, "kernel-reconnecting-band")).toHaveCount(0);
  await expect(byId(page, IDS.band)).toHaveCount(0);
}

test("AC1: stopping the fixture's listener shows the one shared band over Integrations' last data, writes off; restarting clears it", async () => {
  test.setTimeout(90_000);
  const fx = integrationsFixture({ connector: "connected" });
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  const kernel = fixture;
  const page = await launch(kernel);
  await page.evaluate(() => {
    window.location.hash = "#/integrations";
  });
  await expect(byId(page, IDS.screen)).toBeVisible();
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0);
  const writes = [IDS.replace, IDS.switchToApp, IDS.disconnect, IDS.refresh];
  for (const id of writes) await expect(byId(page, id)).toBeEnabled();

  // The kernel goes away under the open window: the listener stops, the window and the fixture stay.
  await kernel.stop();
  await expectOneSharedBand(page);
  // The last row stays, read as unknown, and is never "not connected" or the empty state.
  await expect(byId(page, IDS.listMeta)).toHaveText("status unknown · kernel unreachable");
  await expect(byId(page, "integrations-account")).toHaveText(ACCOUNT);
  for (const id of writes) {
    await expect(byId(page, id)).toBeDisabled();
    await expect(byId(page, id)).toHaveAttribute("title", "Needs the kernel");
  }
  // Still exactly one band a moment later, once the store has retried against the dead port.
  await page.waitForTimeout(BACKOFF_CAP_MS / 5);
  await expectOneSharedBand(page);

  // Back on the same port with the same state: the band goes and the writes are enabled again.
  await kernel.restart();
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0, { timeout: STATE_TIMEOUT_MS });
  await expect(byId(page, "kernel-reconnecting-band")).toHaveCount(0);
  await expect(byId(page, IDS.band)).toHaveCount(0);
  await expect(byId(page, IDS.listMeta)).toHaveText(`connected · ${ACCOUNT}`);
  for (const id of writes) await expect(byId(page, id)).toBeEnabled();
});

test("AC1: the same band shows over any screen (Chat, the default) and goes when the listener is back", async () => {
  test.setTimeout(90_000);
  const fx = integrationsFixture();
  fixture = await startFixtureKernel(fx.options);
  fx.attach(fixture);
  const kernel = fixture;
  const page = await launch(kernel);
  await expect(byId(page, "screen-chat")).toBeVisible();
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0);

  await kernel.stop();
  await expectOneSharedBand(page);
  // The screen stays under the band.
  await expect(byId(page, "screen-chat")).toBeVisible();

  await kernel.restart();
  await expect(byId(page, "kernel-unreachable-band")).toHaveCount(0, { timeout: STATE_TIMEOUT_MS });
  await expect(byId(page, "kernel-reconnecting-band")).toHaveCount(0);
});
