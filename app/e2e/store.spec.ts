// The live store against the real fixture kernel (phase 5 item 12).
//
// AC1 and AC2 run in Node: the store from `src/store/store.ts` over a
// `StudioBridge` built from the real `createKernelConnection` (the main
// process's api.json / pid / token / `GET /status` path and its `ws` feed),
// through a local adapter that mirrors `electron/main.ts`'s feed handlers:
// the previous feed is closed before a new one opens, frames from a
// superseded socket are dropped, and every `after` is recorded.
//
// AC4 is an Electron launch: close the fixture and the reconnecting band
// appears; restart it in place and the band goes. Run `npm run build` first.
import { fileURLToPath } from "node:url";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { createKernelConnection } from "../electron/kernel-connection";
import type { FeedHandle } from "../electron/kernel-connection";
import type { ApiRequest, ApiResult, Approval, EventFrame, FeedRelayFrame, StudioBridge } from "../src/api/contract";
import { BACKOFF_CAP_MS, SETTLE_MS, createLiveStore } from "../src/store/store";
import type { LiveStore } from "../src/store/store";
import { FIXTURE_TOKEN, startFixtureKernel, tempDataDir } from "./fixture-kernel";
import type { FixtureKernel, FixtureKernelOptions } from "./fixture-kernel";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

/** Above the backoff cap plus `SETTLE_MS`: every wait for a state change. */
const STATE_TIMEOUT_MS = BACKOFF_CAP_MS + SETTLE_MS + 3_000;

function event(id: number, kind = "task_updated"): EventFrame {
  return { type: "event", id, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload: {} };
}

function events(from: number, to: number): EventFrame[] {
  return Array.from({ length: to - from + 1 }, (_, i) => event(from + i));
}

function approval(id: number): Approval {
  return {
    id,
    requesting_agent: "wright",
    requesting_session: null,
    action: "comment",
    payload: {},
    requested_at: new Date().toISOString(),
    status: "pending",
    decision: null,
    decided_by: null,
    decided_at: null,
    playbook: null,
  };
}

/** A `StudioBridge` over the real `createKernelConnection`, with `electron/main.ts`'s feed handling. */
function nodeBridge(dataDir: string): { readonly bridge: StudioBridge; readonly afters: number[] } {
  const kernel = createKernelConnection({ dataDir, readToken: async () => FIXTURE_TOKEN });
  const listeners = new Set<(frame: FeedRelayFrame) => void>();
  const afters: number[] = [];
  let feed: FeedHandle | undefined;
  let generation = 0;
  const closeFeed = (): void => {
    generation += 1;
    feed?.close();
    feed = undefined;
  };
  const bridge: StudioBridge = {
    connection: () => kernel.connection(),
    request: <R>(req: ApiRequest) => kernel.request(req) as Promise<ApiResult<R>>,
    feed: {
      async subscribe(after) {
        afters.push(after);
        closeFeed();
        const mine = generation;
        const from = typeof after === "number" && Number.isSafeInteger(after) && after >= 0 ? after : 0;
        const opened = await kernel.openFeed(from, (frame) => {
          if (mine === generation) for (const listener of [...listeners]) listener(frame);
        });
        if (mine !== generation) {
          opened.handle?.close();
          return opened.state;
        }
        feed = opened.handle;
        return opened.state;
      },
      async unsubscribe() {
        closeFeed();
      },
      onFrame(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    onNavigate: () => () => undefined,
  };
  return { bridge, afters };
}

/** Start a fixture; on a restart in place, retry the listen once on EADDRINUSE. */
async function startFixture(options: FixtureKernelOptions): Promise<FixtureKernel> {
  try {
    return await startFixtureKernel(options);
  } catch (err) {
    if ((err as { code?: unknown }).code !== "EADDRINUSE") throw err;
    await new Promise((done) => setTimeout(done, 250));
    return startFixtureKernel(options);
  }
}

let store: LiveStore | undefined;
let fixture: FixtureKernel | undefined;
let app: ElectronApplication | undefined;

test.afterEach(async () => {
  // The store (or the app) first, then the fixture.
  store?.dispose();
  store = undefined;
  await app?.close();
  app = undefined;
  await fixture?.close();
  fixture = undefined;
});

test("AC1: an approval_requested event refetches GET /approvals, and a 20-event burst is throttled", async () => {
  const approvals: Approval[] = [];
  fixture = await startFixture({ routes: { "GET /approvals": () => ({ status: 200, body: { approvals: [...approvals] } }) } });
  const { bridge } = nodeBridge(fixture.dataDir);
  store = createLiveStore(bridge);
  store.load("approvals");
  store.start();
  const current = store;
  await expect.poll(() => current.getSnapshot().connection.state, { timeout: STATE_TIMEOUT_MS }).toBe("live");
  await expect.poll(() => current.resource("approvals")?.data?.approvals.length, { timeout: 2_000 }).toBe(0);

  approvals.push(approval(1));
  fixture.appendEvent(event(1, "approval_requested"));
  await expect.poll(() => current.resource("approvals")?.data?.approvals.map((a) => a.id), { timeout: 2_000 }).toEqual([1]);

  const kernel = fixture;
  const approvalReads = (): number => kernel.requests.filter((r) => r.method === "GET" && r.path === "/approvals").length;
  // Let the last read's throttle window pass, so the burst starts on a leading edge.
  await new Promise((done) => setTimeout(done, 300));
  const before = approvalReads();
  const burstStart = Date.now();
  for (let id = 2; id <= 21; id += 1) {
    approvals.push(approval(id));
    kernel.appendEvent(event(id, id % 2 === 0 ? "approval_requested" : "approval_decided"));
  }
  // The resource ends on an answer issued after the last event.
  await expect.poll(() => current.resource("approvals")?.data?.approvals.length, { timeout: 2_000 }).toBe(21);
  await new Promise((done) => setTimeout(done, 600));
  const elapsed = Date.now() - burstStart;
  const reads = approvalReads() - before;
  expect(reads).toBeGreaterThanOrEqual(1);
  expect(reads).toBeLessThanOrEqual(Math.ceil(elapsed / 250) + 1);
  expect(current.getSnapshot().lastEventId).toBe(21);
});

test("AC2: a fixture restart mid-stream resumes from the last id, exactly once", async () => {
  test.setTimeout(60_000);
  const N = 5;
  const M = 10;
  const dataDir = tempDataDir();
  fixture = await startFixture({ dataDir, events: events(1, N) });
  const port = fixture.port;
  const { bridge, afters } = nodeBridge(dataDir);
  store = createLiveStore(bridge);
  store.start();
  const current = store;
  await expect.poll(() => current.getSnapshot().lastEventId, { timeout: STATE_TIMEOUT_MS }).toBe(N);
  await expect.poll(() => current.getSnapshot().connection.state, { timeout: STATE_TIMEOUT_MS }).toBe("live");

  await fixture.close();
  fixture = undefined;
  await expect.poll(() => current.getSnapshot().connection.state, { timeout: STATE_TIMEOUT_MS }).toBe("reconnecting");
  expect(current.resource("status")?.stale).toBe(true);

  // Back on the same port and data dir, with the events appended while it was down.
  fixture = await startFixture({ dataDir, port, events: events(1, M - 2) });
  await expect.poll(() => current.getSnapshot().connection.state, { timeout: STATE_TIMEOUT_MS }).toBe("live");
  await expect.poll(() => current.getSnapshot().lastEventId, { timeout: STATE_TIMEOUT_MS }).toBe(M - 2);
  // And new ones after it is back.
  fixture.appendEvent(event(M - 1));
  fixture.appendEvent(event(M));
  await expect.poll(() => current.getSnapshot().lastEventId, { timeout: 2_000 }).toBe(M);

  const snap = current.getSnapshot();
  expect(snap.eventLog.map((e) => e.id)).toEqual(events(1, M).map((e) => e.id));
  expect(snap.duplicatesDropped).toBe(0);
  expect(snap.connection).toEqual({ state: "live" });
  expect(afters[0]).toBe(0);
  expect(afters.length).toBeGreaterThanOrEqual(2);
  // Every resubscribe after the close asked for the ids above N (the last id seen before the close).
  for (const after of afters.slice(1)) expect(after).toBe(N);
  expect(current.resource("status")?.stale).toBe(false);
});

test("AC4: the window shows the reconnecting band while the fixture is down, and drops it when it is back", async () => {
  test.setTimeout(60_000);
  const dataDir = tempDataDir();
  fixture = await startFixture({ dataDir, events: events(1, 3) });
  const port = fixture.port;
  app = await electron.launch({ args: [APP_DIR], cwd: APP_DIR, env: { ...fixture.env } });
  const page = await app.firstWindow();
  await expect(page.getByTestId("sidebar")).toBeVisible();
  const kernel = fixture;
  await expect.poll(() => kernel.requests.some((r) => r.path === "/events/stream"), { timeout: STATE_TIMEOUT_MS }).toBe(true);
  // The replayed events make the store live at once; SETTLE_MS more guarantees it with no frame at all.
  await page.waitForTimeout(SETTLE_MS + 500);
  await expect(page.getByTestId("kernel-reconnecting-band")).toHaveCount(0);

  await fixture.close();
  fixture = undefined;
  const band = page.getByTestId("kernel-reconnecting-band");
  await expect(band).toBeVisible({ timeout: STATE_TIMEOUT_MS });
  await expect(band).toHaveAttribute("role", "status");
  await expect(band).toContainText(/Reconnecting to the kernel… Last updated \d{2}:\d{2}:\d{2}\./);
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);

  fixture = await startFixture({ dataDir, port, events: events(1, 4) });
  await expect(band).toHaveCount(0, { timeout: STATE_TIMEOUT_MS });
  await expect(page.getByTestId("kernel-unreachable-band")).toHaveCount(0);
});
