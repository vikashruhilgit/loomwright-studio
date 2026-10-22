// @vitest-environment jsdom
// The shell's designed kernel states, driven by the live store, rendered as
// `<App api={fakeBridge}>` in fake time: no api.json -> the setup commands
// (AC3a), a dead port -> the unreachable band (AC3b), both retrying until a
// kernel answers; a feed that closes after live -> the reconnecting band with
// the last-updated time, every loaded resource stale until live again (AC4).
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { Approval, StatusBody } from "../api/contract";
import { createCommandRegistry } from "../commands/registry";
import { ReconnectingBand, SETUP_STEPS, formatLastUpdated } from "../shell/KernelStates";
import { fakeBridge, ok } from "./fake-bridge";
import type { FakeBridge } from "./fake-bridge";
import { liveStoreFor, useResource } from "./react";
import { BACKOFF_INITIAL_MS, REFETCH_THROTTLE_MS } from "./store";

const STATUS: StatusBody = {
  kernel: { version: "1.2.3", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-10-22", agents: [] },
  cap_state: [],
};

const APPROVAL: Approval = {
  id: 3,
  requesting_agent: "wright",
  requesting_session: null,
  action: "comment",
  payload: {},
  requested_at: new Date(0).toISOString(),
  status: "pending",
  decision: null,
  decided_by: null,
  decided_at: null,
  playbook: null,
};

async function renderApp(fake: FakeBridge): Promise<void> {
  render(<App api={fake.bridge} registry={createCommandRegistry()} />);
  await act(async () => undefined);
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function emit(fake: FakeBridge, frame: Parameters<FakeBridge["emit"]>[0]): void {
  act(() => fake.emit(frame));
}

function diffs(times: readonly number[]): number[] {
  return times.slice(1).map((t, i) => t - (times[i] as number));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-22T09:30:15Z"));
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
  vi.useRealTimers();
});

describe("the shell's kernel states, from the live store", () => {
  it("(a) no api.json: the exact setup commands in place of the screen, retried until a kernel answers", async () => {
    const fake = fakeBridge({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" });
    await renderApp(fake);
    const setup = within(screen.getByTestId("kernel-not-installed"));
    expect(setup.getAllByText(/./, { selector: "code.setup-command" }).map((c) => c.textContent)).toEqual(SETUP_STEPS.map((s) => s.command));
    expect(setup.getAllByText(/./, { selector: "code.setup-command" }).map((c) => c.textContent)).toEqual([
      "claude setup-token",
      "security add-generic-password -a loomwright-studio -s loomwright-studio-oauth -w",
      "studio service install",
    ]);
    expect(setup.getByText("/Users/o/.loomwright-studio/api.json")).toBeTruthy();
    expect(screen.queryByTestId("screen-chat")).toBeNull();

    await advance(500 + 1_000 + 2_000);
    expect(diffs(fake.connectionCalls)).toEqual([500, 1_000, 2_000]);
    expect(screen.getByTestId("kernel-not-installed")).toBeTruthy();

    fake.connectionAnswer = { state: "connected", port: 1 };
    fake.subscribeAnswer = { state: "connected", port: 1 };
    await advance(4_000);
    emit(fake, { type: "heartbeat", latest_id: 0 });
    expect(liveStoreFor(fake.bridge).getSnapshot().connection).toEqual({ state: "live" });
    expect(screen.queryByTestId("kernel-not-installed")).toBeNull();
    expect(screen.getByTestId("screen-chat")).toBeTruthy();
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
    expect(screen.queryByTestId("kernel-reconnecting-band")).toBeNull();
  });

  it("(b) api.json with a dead port: the unreachable band, retried until a kernel answers", async () => {
    const fake = fakeBridge({ state: "unreachable", reason: "connection_failed" });
    await renderApp(fake);
    const band = screen.getByTestId("kernel-unreachable-band");
    expect(band.textContent).toContain("Couldn't reach the kernel");
    expect(screen.getByTestId("screen-chat")).toBeTruthy();

    await advance(500 + 1_000);
    expect(diffs(fake.connectionCalls)).toEqual([500, 1_000]);
    fake.connectionAnswer = { state: "connected", port: 1 };
    fake.subscribeAnswer = { state: "connected", port: 1 };
    await advance(2_000);
    emit(fake, { type: "heartbeat", latest_id: 0 });
    expect(liveStoreFor(fake.bridge).getSnapshot().connection).toEqual({ state: "live" });
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
  });

  it("live, then the feed closes: the reconnecting band with the last-updated time, data stale until live again", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /approvals", () => ok({ approvals: [APPROVAL] }));
    await renderApp(fake);
    const store = liveStoreFor(fake.bridge);
    act(() => store.load("approvals"));
    emit(fake, { type: "heartbeat", latest_id: 0 });
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(store.getSnapshot().connection).toEqual({ state: "live" });
    expect(screen.queryByTestId("kernel-reconnecting-band")).toBeNull();
    expect(store.resource("approvals")).toMatchObject({ stale: false, data: { approvals: [APPROVAL] } });
    const lastUpdated = store.getSnapshot().lastUpdated as number;
    expect(lastUpdated).toBeGreaterThan(Date.now() - REFETCH_THROTTLE_MS * 4);

    await advance(7_000);
    emit(fake, { type: "closed", code: 1006, reason: "" });
    const band = screen.getByTestId("kernel-reconnecting-band");
    expect(band.getAttribute("role")).toBe("status");
    expect(band.className).toBe("band");
    expect(band.textContent).toBe(`Reconnecting to the kernel… Last updated ${formatLastUpdated(lastUpdated)}.`);
    expect(formatLastUpdated(lastUpdated)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(band.querySelector("time")?.getAttribute("dateTime")).toBe(new Date(lastUpdated).toISOString());
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
    expect(screen.getByTestId("screen-chat")).toBeTruthy();
    expect(store.resource("approvals")).toMatchObject({ stale: true, data: { approvals: [APPROVAL] } });
    expect(store.resource("status")?.stale).toBe(true);

    // Still down on the next attempt: still reconnecting, never the unreachable band.
    fake.connectionAnswer = { state: "unreachable", reason: "connection_failed" };
    await advance(BACKOFF_INITIAL_MS);
    expect(screen.getByTestId("kernel-reconnecting-band")).toBeTruthy();
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
    expect(store.resource("approvals")?.stale).toBe(true);

    fake.connectionAnswer = { state: "connected", port: 1 };
    const approvalsBefore = fake.requestsTo("GET /approvals").length;
    await advance(BACKOFF_INITIAL_MS * 2);
    emit(fake, { type: "heartbeat", latest_id: 0 });
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(screen.queryByTestId("kernel-reconnecting-band")).toBeNull();
    expect(store.resource("approvals")?.stale).toBe(false);
    expect(fake.requestsTo("GET /approvals").length).toBe(approvalsBefore + 1);
  });

  it("the reconnecting band with no data ever received says no last-updated time", () => {
    render(<ReconnectingBand lastUpdated={null} />);
    const band = screen.getByTestId("kernel-reconnecting-band");
    expect(band.textContent).toBe("Reconnecting to the kernel…");
    expect(band.querySelector("time")).toBeNull();
  });

  it("under <StrictMode>, App and a useResource probe share one store: one listener, one subscribe, live; nothing left after unmount", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    fake.route("GET /approvals", () => ok({ approvals: [APPROVAL] }));
    function Probe() {
      const approvals = useResource("approvals", fake.bridge);
      return <p data-testid="probe">{approvals?.data?.approvals.length ?? "none"}</p>;
    }
    render(
      <StrictMode>
        <App api={fake.bridge} registry={createCommandRegistry()} />
        <Probe />
      </StrictMode>,
    );
    await act(async () => undefined);
    // The double effect disposed and restarted the store: the first attempt was dropped before it subscribed.
    expect(fake.listenerCount()).toBe(1);
    expect(fake.subscribeCalls.length).toBe(1);
    emit(fake, { type: "heartbeat", latest_id: 0 });
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(liveStoreFor(fake.bridge).getSnapshot().connection).toEqual({ state: "live" });
    expect(screen.getByTestId("probe").textContent).toBe("1");

    cleanup();
    expect(fake.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    // One unsubscribe for StrictMode's simulated unmount, one for the real one.
    expect(fake.unsubscribes).toBe(2);
  });

  it("useResource loads a resource on its first use and re-renders on its answer", async () => {
    const fake = fakeBridge();
    fake.route("GET /approvals", () => ok({ approvals: [APPROVAL] }));
    function Probe() {
      const approvals = useResource("approvals", fake.bridge);
      if (approvals?.data === undefined) return <p data-testid="probe">none yet</p>;
      return <p data-testid="probe">{approvals.data.approvals.map((a) => a.requesting_agent).join(",")}</p>;
    }
    render(<Probe />);
    await act(async () => undefined);
    expect(screen.getByTestId("probe").textContent).toBe("wright");
    expect(fake.requestsTo("GET /approvals").length).toBe(1);
    cleanup();
    expect(fake.unsubscribes).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
