// The Playwright Electron smoke (phase 5 foundation, Criterion 6): the built
// app opens its window against the fixture kernel and shows the sidebar's
// six entries (Integrations on ⌘5 since the phase 6 foundation); with no
// kernel answering it shows the "kernel unreachable" band; with no api.json
// at all it shows the setup state. Run `npm run build` first (`npm run e2e`
// launches dist-electron/main.cjs).
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { appEnv, startFixtureKernel, tempDataDir, unreachableDataDir } from "./fixture-kernel";
import { launchApp } from "./electron-harness";
import type { FixtureKernel } from "./fixture-kernel";

let app: ElectronApplication | undefined;
let fixture: FixtureKernel | undefined;

async function launch(env: Readonly<Record<string, string>>): Promise<Page> {
  app = await launchApp(env);
  return app.firstWindow();
}

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

test("against the fixture kernel, the window shows the sidebar's six entries, Integrations on ⌘5, and no band", async () => {
  fixture = await startFixtureKernel();
  const page = await launch(fixture.env);
  const sidebar = page.getByTestId("sidebar");
  for (const entry of ["Chat", "Team", "Approvals", "Sessions", "Integrations"]) {
    await expect(sidebar.getByRole("button", { name: new RegExp(`^${entry}`) })).toBeVisible();
  }
  // The screen entries in order, each with its shortcut: Integrations is the fifth, on ⌘5.
  await expect(sidebar.getByRole("navigation", { name: "Screens" }).getByRole("button")).toHaveText(["Chat⌘1", "Team⌘2", "Approvals⌘3", "Sessions⌘4", "Integrations⌘5"]);
  await expect(sidebar.getByRole("heading", { name: "Crew" })).toBeVisible();
  // The main process called the fixture (with the token, which the fixture checks before routing).
  await expect.poll(() => fixture?.requests.some((r) => r.method === "GET" && r.path === "/status")).toBe(true);
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
  await expect(page.getByTestId("kernel-not-installed")).toHaveCount(0);

  // The renderer's whole view of the kernel: one `api` key, no Node.
  const exposed = await page.evaluate(() => ({
    api: Object.keys((window as unknown as { api: object }).api).sort(),
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
  }));
  expect(exposed).toEqual({ api: ["connection", "feed", "onNavigate", "request"], require: "undefined", process: "undefined" });
});

test("with no kernel answering, the window shows the kernel unreachable band", async () => {
  const page = await launch(appEnv(await unreachableDataDir()));
  const band = page.getByTestId("kernel-unreachable-band");
  await expect(band).toBeVisible();
  await expect(band).toContainText("Couldn't reach the kernel");
  await expect(page.getByTestId("sidebar").getByRole("button", { name: /^Chat/ })).toBeVisible();
});

test("with no api.json, the window shows the setup commands", async () => {
  const page = await launch(appEnv(tempDataDir()));
  const setup = page.getByTestId("kernel-not-installed");
  await expect(setup).toBeVisible();
  await expect(setup).toContainText("studio service install");
  await expect(setup).toContainText("claude setup-token");
});
