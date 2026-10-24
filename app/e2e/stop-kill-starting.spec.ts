// Reproduction of the phase 5 live run's lost presses (Stop, then Kill, on
// `starting` Wright sessions 36 and 37: no `session_stop_requested`, no
// error, no change in the app). Evidence:
// docs/evidence/stop-kill-starting-session.md.
//
// It walks the runbook's flow 4 as the owner did it, through the app's UI,
// against a real kernel: in Chat, ask Wright twice, one after the other; while
// both sessions are still `starting` (their stand-in CLI is held before
// `system/init`, as a real Wright session is for its first 20-40 s), open
// Sessions, select the first and press Stop, select the second and press Kill,
// then confirm. Every effect is read from the kernel's own store.
//
// The kernel is `startKernel` (kernel/src/kernel.ts) IN THIS PLAYWRIGHT
// WORKER, as in phase-5-exit.spec.ts: the shipped contributions, the stub
// notifier, the brain's `message` handler, and the session fakes
// (kernel/test/session-fakes.ts) standing in for the SDK, so no real CLI,
// model or network is touched. The app gets the kernel's data dir and token
// through `STUDIO_DATA_DIR` and `STUDIO_APP_FIXTURE_TOKEN`, and is launched
// only through `launchApp` (app/e2e/electron-harness.ts).
//
// Run `npm run build` (and `cd ../kernel && npm ci`) first.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { KeychainError } from "../../kernel/src/auth/index.js";
import type { AuthProvider, KeychainReader, KeychainWriter } from "../../kernel/src/auth/index.js";
import { brainContribution, brainMessageHandler, defaultWrightSettingsJson, wrightSettingsPath } from "../../kernel/src/brain/index.js";
import { SESSION_STOP_REQUESTED } from "../../kernel/src/console/control.js";
import { SHIPPED_CONTRIBUTIONS } from "../../kernel/src/features/index.js";
import type { FeatureContribution } from "../../kernel/src/features/index.js";
import { startKernel } from "../../kernel/src/kernel.js";
import type { Kernel, KernelDeps } from "../../kernel/src/kernel.js";
import type { Store } from "../../kernel/src/store/index.js";
import { events } from "../../kernel/test/loop-helpers.js";
import { assertNoNotifierRefusals, installNotifierGuard } from "../../kernel/test/notifier-guard.js";
import { stubNotifierContributions } from "../../kernel/test/notifier-stub.js";
import type { FakeCall } from "../../kernel/test/session-fakes.js";
import { fakeMsg, fakeSessions, makePluginDir, stubProvider } from "../../kernel/test/session-fakes.js";
import { launchApp, processEnv } from "./electron-harness";

const WRIGHT_MODEL = "claude-haiku-4-5";
const ZONE = "Asia/Kolkata";
const START = "2026-10-24T05:58:00.000Z";
/** Distinct, so the injected scheduler can tell a stop's grace from any other timer. */
const STOP_GRACE_MS = 150;
const API_TOKEN_SERVICE = "loomwright-studio-api";
/** The runbook's flow 4 ask. */
const ASK_STORY = "Write me a 1500-word short story about a lighthouse keeper.";

function memoryKeychain() {
  const items = new Map<string, string>();
  const reader: KeychainReader = { read: (service) => items.get(service) };
  const writer: KeychainWriter = {
    add(service, _account, secret) {
      if (items.has(service)) throw new KeychainError(service, 45, null, "write");
      items.set(service, secret);
    },
  };
  return { items, reader, writer };
}

function writeWrightSettings(dataDir: string): void {
  const file = wrightSettingsPath(dataDir);
  mkdirSync(join(file, ".."), { recursive: true });
  const settings = JSON.parse(defaultWrightSettingsJson()) as Record<string, unknown>;
  writeFileSync(file, `${JSON.stringify({ ...settings, model: WRIGHT_MODEL }, null, 2)}\n`);
}

function contributions(now: () => Date): readonly FeatureContribution[] {
  const brain: FeatureContribution = Object.freeze({
    ...brainContribution,
    handlers: Object.freeze({ message: brainMessageHandler({ now, timeZone: () => ZONE }) }),
  });
  return stubNotifierContributions(Object.freeze(SHIPPED_CONTRIBUTIONS.map((c) => (c === brainContribution ? brain : c))));
}

/** As phase-5-exit.spec.ts: the guard recurses in a Playwright worker unless `execFile`'s self-reference is removed first. */
function installGuardInThisWorker(): void {
  const cp = createRequire(import.meta.url)("node:child_process") as Record<string, Record<symbol, unknown> | undefined>;
  const custom = cp.execFile?.[promisify.custom] as Record<symbol, unknown> | undefined;
  if (custom !== undefined && custom[promisify.custom] === custom) delete custom[promisify.custom];
  installNotifierGuard();
}

interface SessionRow {
  readonly id: number;
  readonly agent: string;
  readonly status: string;
}
const sessionRows = (store: Store): SessionRow[] => store.prepare<[], SessionRow>("SELECT id, agent, status FROM sessions ORDER BY id").all();

/** Every `session_status` `to` of session `id`, in order. */
const statusTrail = (store: Store, id: number): unknown[] =>
  events(store, "session_status")
    .filter((e) => e.session_id === id)
    .map((e) => e.payload.to);

function endOf(store: Store, id: number): { to: unknown; reason: unknown } | undefined {
  const last = events(store, "session_status")
    .filter((e) => e.session_id === id)
    .at(-1);
  return last === undefined || last.payload.to === "starting" || last.payload.to === "running" ? undefined : { to: last.payload.to, reason: last.payload.reason };
}

const sidebar = (page: Page) => page.getByTestId("sidebar");

async function openScreen(page: Page, name: "Chat" | "Sessions"): Promise<void> {
  await sidebar(page).getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByTestId(`screen-${name.toLowerCase()}`)).toBeVisible();
}

async function send(page: Page, text: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message Wright" });
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

let tmp: string | undefined;
let kernel: Kernel | undefined;
let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await kernel?.stop();
  kernel = undefined;
  if (tmp !== undefined) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  assertNoNotifierRefusals();
});

test("flow 4 on starting sessions: Stop and Kill pressed in Sessions on two starting Wright sessions are each recorded and end them", async () => {
  test.setTimeout(120_000);
  installGuardInThisWorker();

  tmp = mkdtempSync(join(tmpdir(), "studio-stop-kill-starting-"));
  const dataDir = join(tmp, "data");
  const home = join(tmp, "home");
  mkdirSync(home);
  writeWrightSettings(dataDir);
  const now = (): Date => new Date(START);
  const keychain = memoryKeychain();
  const graces: number[] = [];
  const schedule = (fn: () => void, ms: number): (() => void) => {
    if (ms === STOP_GRACE_MS) graces.push(ms);
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  };
  // Held before `system/init`: the session stays `starting` until the test releases it.
  const held: FakeCall[] = [];
  const fakes = fakeSessions({ script: (call) => void held.push(call) });
  const deps: KernelDeps = {
    keychain: keychain.reader,
    keychainWriter: keychain.writer,
    sessionDeps: { ...fakes.deps, schedule, homeDir: home },
    selectAuthProvider: async (): Promise<AuthProvider> => stubProvider(),
    availableProviderIds: async () => ["api-key"],
    now,
    loopDeps: { tickMs: 10, now },
  };
  kernel = await startKernel(
    { dataDir, env: { PATH: "/usr/bin" }, sessions: { loomwrightPath: makePluginDir(tmp), stopGraceMs: STOP_GRACE_MS }, contributions: contributions(now) },
    deps,
  );
  const store = kernel.store;
  const token = keychain.items.get(API_TOKEN_SERVICE);
  expect(token).toMatch(/^[0-9a-f]{64}$/);

  app = await launchApp({ ...processEnv(), STUDIO_DATA_DIR: dataDir, STUDIO_APP_FIXTURE_TOKEN: token as string });
  const page = await app.firstWindow();
  await expect(sidebar(page)).toBeVisible();
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);

  // In Chat, ask Wright twice, one after the other: two Wright sessions, both held `starting`.
  await openScreen(page, "Chat");
  await send(page, ASK_STORY);
  await expect.poll(() => sessionRows(store).filter((r) => r.agent === "wright" && r.status === "starting").length).toBe(1);
  await send(page, ASK_STORY);
  await expect.poll(() => sessionRows(store).filter((r) => r.agent === "wright" && r.status === "starting").length).toBe(2);
  const [first, second] = sessionRows(store).filter((r) => r.agent === "wright") as [SessionRow, SessionRow];
  expect(held).toHaveLength(2);

  // Sessions lists both as `starting`, in the Running group.
  await openScreen(page, "Sessions");
  for (const s of [first, second]) await expect(page.getByTestId(`session-row-${s.id}`).getByTestId("session-status")).toHaveText("starting");

  // 1. Select the first and press Stop.
  await page.getByTestId(`session-row-${first.id}`).click();
  await expect(page.getByTestId("session-detail")).toHaveAttribute("data-session-id", String(first.id));
  const stop = page.getByTestId("session-detail").getByRole("button", { name: "Stop", exact: true });
  await expect(stop).not.toHaveAttribute("aria-disabled", "true");
  await stop.click();
  await expect.poll(() => endOf(store, first.id)).toEqual({ to: "stopped", reason: "owner_stop" });
  expect(events(store, SESSION_STOP_REQUESTED).filter((e) => e.session_id === first.id).map((e) => e.payload)).toEqual([{ by: "owner", mode: "stop" }]);
  expect(statusTrail(store, first.id)).toEqual(["starting", "stopped"]);
  await expect(page.getByTestId(`session-row-${first.id}`).getByTestId("session-status")).toHaveText("stopped");
  await expect(page.getByTestId(`session-row-${first.id}`).getByTestId("session-reason")).toHaveText(" · owner_stop");

  // 2. Select the second and press Kill, then confirm.
  const gracesBeforeKill = graces.length;
  await page.getByTestId(`session-row-${second.id}`).click();
  await expect(page.getByTestId("session-detail")).toHaveAttribute("data-session-id", String(second.id));
  const kill = page.getByTestId("session-detail").getByRole("button", { name: "Kill", exact: true });
  await expect(kill).not.toHaveAttribute("aria-disabled", "true");
  await kill.click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(`Kill session #${second.id}?`);
  await confirm.getByRole("button", { name: "Kill" }).click();
  await expect.poll(() => endOf(store, second.id)).toEqual({ to: "stopped", reason: "owner_kill" });
  expect(events(store, SESSION_STOP_REQUESTED).filter((e) => e.session_id === second.id).map((e) => e.payload)).toEqual([{ by: "owner", mode: "kill" }]);
  expect(statusTrail(store, second.id)).toEqual(["starting", "stopped"]);
  expect(graces.length).toBe(gracesBeforeKill);
  await expect(page.getByTestId(`session-row-${second.id}`).getByTestId("session-status")).toHaveText("stopped");
  await expect(page.getByTestId(`session-row-${second.id}`).getByTestId("session-reason")).toHaveText(" · owner_kill");

  // A late `system/init` from either stand-in moves nothing: both stay stopped, with no `running`.
  for (const call of held) call.stream.push(fakeMsg.init(call.options.sessionId ?? "unknown"));
  await page.waitForTimeout(100);
  expect(statusTrail(store, first.id)).toEqual(["starting", "stopped"]);
  expect(statusTrail(store, second.id)).toEqual(["starting", "stopped"]);
  // Every stand-in group is gone: nothing left alive.
  expect(fakes.allGroupsGone()).toBe(true);
});
