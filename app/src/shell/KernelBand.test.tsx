// @vitest-environment jsdom
// The shared kernel band and the screen contract (`last-known.ts`). The shell shows one red band
// (`KernelBand`, `role="alert"`) while the store reads `reconnecting` or `unreachable`; it never renders request
// text (method, path, connection state, reason, port). `useKernelReach` tells a screen when to keep its last data.
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import type { KernelConnectionState, KernelUnreachableReason, StatusBody, StudioBridge } from "../api/contract";
import { createCommandRegistry } from "../commands/registry";
import { fakeBridge, ok } from "../store/fake-bridge";
import type { FakeBridge } from "../store/fake-bridge";
import { KernelBand } from "./KernelStates";
import { LAST_KNOWN, useKernelReach, withLastKnown } from "./last-known";

/** The copy, pinned here on its own (not imported from the component). */
const COPY = "Couldn't reach the kernel. It may be restarting; this window reconnects on its own.";
/** The band's action label, and the band's whole text with it (pinned here on its own, not imported). */
const LABEL = "Kernel log";
const BAND_TEXT = COPY + LABEL;
const NOTE_MISSING = "There is no kernel log yet.";
const NOTE_FAILED = "Couldn't open the kernel log.";

const REASONS: readonly KernelUnreachableReason[] = ["api_info_unreadable", "daemon_not_running", "token_unavailable", "token_rejected", "connection_failed", "timeout"];

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-22T09:30:15Z"));
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
  delete (window as unknown as { api?: StudioBridge }).api;
  vi.useRealTimers();
});

async function renderApp(fake: FakeBridge): Promise<void> {
  render(<App api={fake.bridge} registry={createCommandRegistry()} />);
  await act(async () => undefined);
}

/** A bridge whose store was live and then lost its feed: it reads `reconnecting`. */
async function reconnecting(): Promise<FakeBridge> {
  const fake = fakeBridge();
  fake.route("GET /status", () => ok(STATUS));
  await renderApp(fake);
  act(() => fake.emit({ type: "heartbeat", latest_id: 0 }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  act(() => fake.emit({ type: "closed", code: 1006, reason: "" }));
  return fake;
}

/** Nothing of a request or of the connection's own vocabulary: no method, no path, no state word, no reason, no port. */
function expectNoRequestText(text: string): void {
  expect(text).not.toMatch(/\b(GET|POST|PUT|PATCH|DELETE)\b/);
  expect(text).not.toContain("/");
  expect(text).not.toMatch(/\d/);
  for (const word of ["reconnecting", "unreachable", "not_installed", "connection_failed", "connected", "connecting", ...REASONS]) {
    expect(text.toLowerCase()).not.toContain(word);
  }
}

describe("KernelBand", () => {
  it("is a red alert with the fixed copy and the warning glyph, under the default test id", () => {
    render(<KernelBand />);
    const band = screen.getByTestId("kernel-unreachable-band");
    expect(band.getAttribute("role")).toBe("alert");
    expect(band.textContent).toBe(BAND_TEXT);
    expect(band.className).toContain("band-danger");
    expect(band.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("takes only a test id (a screen's own pin), never text", () => {
    render(<KernelBand testId="integrations-band" />);
    expect(screen.getByTestId("integrations-band").textContent).toBe(BAND_TEXT);
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
  });

  it("the shell renders exactly the copy for unreachable, whatever the reason: never request text", async () => {
    for (const reason of REASONS) {
      const fake = fakeBridge({ state: "unreachable", reason });
      await renderApp(fake);
      const bands = screen.getAllByTestId("kernel-unreachable-band");
      expect(bands, reason).toHaveLength(1);
      expect(bands[0]?.textContent, reason).toBe(BAND_TEXT);
      expectNoRequestText(bands[0]?.textContent ?? "");
      cleanup();
    }
  });

  it("the shell renders exactly the copy for reconnecting too, with no small reconnecting line", async () => {
    await reconnecting();
    const bands = screen.getAllByTestId("kernel-unreachable-band");
    expect(bands).toHaveLength(1);
    expect(bands[0]?.getAttribute("role")).toBe("alert");
    expect(bands[0]?.textContent).toBe(BAND_TEXT);
    expectNoRequestText(bands[0]?.textContent ?? "");
    expect(screen.queryByTestId("kernel-reconnecting-band")).toBeNull();
    expect(screen.getByTestId("screen-chat")).toBeTruthy();
  });

  it("no band while connecting or live, and the setup state (not installed) has none either", async () => {
    const live = fakeBridge();
    live.route("GET /status", () => ok(STATUS));
    await renderApp(live);
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
    act(() => live.emit({ type: "heartbeat", latest_id: 0 }));
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
    cleanup();

    await renderApp(fakeBridge({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" }));
    expect(screen.queryByTestId("kernel-unreachable-band")).toBeNull();
    expect(screen.getByTestId("kernel-not-installed")).toBeTruthy();
  });
});

describe("KernelBand's Kernel log action", () => {
  function install(fake: FakeBridge): void {
    (window as unknown as { api?: StudioBridge }).api = fake.bridge;
  }
  async function press(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: LABEL }));
    });
  }

  it("holds exactly one button, named Kernel log, after the sentence, and still no request text", () => {
    render(<KernelBand />);
    const band = screen.getByTestId("kernel-unreachable-band");
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe(LABEL);
    expect(buttons[0]?.getAttribute("type")).toBe("button");
    expect(buttons[0]?.className).toContain("toast-band-action");
    expect(band.lastElementChild).toBe(buttons[0]);
    expect(band.textContent).toBe(BAND_TEXT);
    expectNoRequestText(band.textContent ?? "");
    expect(screen.queryByTestId("kernel-log-note")).toBeNull();
  });

  it("is on the shell's band, on whichever screen is showing", async () => {
    await renderApp(fakeBridge({ state: "unreachable", reason: "daemon_not_running" }));
    expect(screen.getByTestId("kernel-unreachable-band").querySelectorAll("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: LABEL })).toBeTruthy();
  });

  it("a press asks the bridge to reveal the log once, with no argument, and a revealed answer shows no note", async () => {
    const fake = fakeBridge();
    const reveal = vi.spyOn(fake.bridge, "revealKernelLog");
    install(fake);
    render(<KernelBand />);
    await press();
    expect(fake.kernelLogReveals).toBe(1);
    expect(reveal).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith();
    expect(screen.queryByTestId("kernel-log-note")).toBeNull();
    expect(screen.getByTestId("kernel-unreachable-band").textContent).toBe(BAND_TEXT);
  });

  it("a missing log shows the note after the action, as a status", async () => {
    const fake = fakeBridge();
    fake.kernelLogAnswer = "missing";
    install(fake);
    render(<KernelBand />);
    await press();
    const note = screen.getByTestId("kernel-log-note");
    expect(note.textContent).toBe(NOTE_MISSING);
    expect(note.getAttribute("role")).toBe("status");
    expect(screen.getByTestId("kernel-unreachable-band").textContent).toBe(BAND_TEXT + NOTE_MISSING);
    expect(screen.getByRole("button", { name: LABEL }).nextElementSibling).toBe(note);
    expectNoRequestText(NOTE_MISSING);
  });

  it("a failed answer, a rejected call and a bridge without the member all show the failure note", async () => {
    const failed = fakeBridge();
    failed.kernelLogAnswer = "failed";
    install(failed);
    render(<KernelBand />);
    await press();
    expect(screen.getByTestId("kernel-log-note").textContent).toBe(NOTE_FAILED);
    cleanup();

    const rejecting = fakeBridge();
    rejecting.bridge.revealKernelLog = async () => {
      throw new Error("refused");
    };
    install(rejecting);
    render(<KernelBand />);
    await press();
    expect(screen.getByTestId("kernel-log-note").textContent).toBe(NOTE_FAILED);
    cleanup();

    const without = fakeBridge();
    delete without.bridge.revealKernelLog;
    install(without);
    render(<KernelBand />);
    await press();
    expect(screen.getByTestId("kernel-log-note").textContent).toBe(NOTE_FAILED);
    cleanup();

    // No bridge at all (no preload ran).
    delete (window as unknown as { api?: StudioBridge }).api;
    render(<KernelBand />);
    await press();
    expect(screen.getByTestId("kernel-log-note").textContent).toBe(NOTE_FAILED);
    expectNoRequestText(NOTE_FAILED);
  });

  it("the next press replaces the note, and a revealed answer clears it", async () => {
    const fake = fakeBridge();
    fake.kernelLogAnswer = "missing";
    install(fake);
    render(<KernelBand />);
    await press();
    expect(screen.getByTestId("kernel-log-note").textContent).toBe(NOTE_MISSING);
    fake.kernelLogAnswer = "failed";
    await press();
    expect(screen.getByTestId("kernel-log-note").textContent).toBe(NOTE_FAILED);
    fake.kernelLogAnswer = "revealed";
    await press();
    expect(screen.queryByTestId("kernel-log-note")).toBeNull();
    expect(fake.kernelLogReveals).toBe(3);
  });

  it("the note goes when the band unmounts", async () => {
    const fake = fakeBridge();
    fake.kernelLogAnswer = "missing";
    install(fake);
    const first = render(<KernelBand />);
    await press();
    expect(screen.getByTestId("kernel-log-note")).toBeTruthy();
    first.unmount();
    render(<KernelBand />);
    expect(screen.queryByTestId("kernel-log-note")).toBeNull();
  });
});

describe("the screen contract: useKernelReach and withLastKnown", () => {
  async function reach(state: KernelConnectionState) {
    const fake = fakeBridge(state);
    const hook = renderHook(() => useKernelReach(fake.bridge));
    await act(async () => undefined);
    return { fake, hook };
  }

  it("unreachable: the shell shows the band and the screen is offline", async () => {
    const { hook } = await reach({ state: "unreachable", reason: "daemon_not_running" });
    expect(hook.result.current).toEqual({ shellBand: true, offline: true });
  });

  it("not installed: no band (the setup state replaces the screen), but offline", async () => {
    const { hook } = await reach({ state: "not_installed", dataDir: "/Users/o/.loomwright-studio" });
    expect(hook.result.current).toEqual({ shellBand: false, offline: true });
  });

  it("connecting and live: neither", async () => {
    const { fake, hook } = await reach({ state: "connected", port: 1 });
    expect(hook.result.current).toEqual({ shellBand: false, offline: false });
    act(() => fake.emit({ type: "heartbeat", latest_id: 0 }));
    expect(hook.result.current).toEqual({ shellBand: false, offline: false });
  });

  it("reconnecting (was live, is not now): the shell shows the band and the screen is offline", async () => {
    const fake = fakeBridge();
    fake.route("GET /status", () => ok(STATUS));
    const hook = renderHook(() => useKernelReach(fake.bridge));
    await act(async () => undefined);
    act(() => fake.emit({ type: "heartbeat", latest_id: 0 }));
    expect(hook.result.current).toEqual({ shellBand: false, offline: false });
    act(() => fake.emit({ type: "closed", code: 1006, reason: "" }));
    expect(hook.result.current).toEqual({ shellBand: true, offline: true });
  });

  it("withLastKnown appends ' · last known' only while offline", () => {
    expect(LAST_KNOWN).toBe("last known");
    expect(withLastKnown("8 cards · 3 working", true)).toBe("8 cards · 3 working · last known");
    expect(withLastKnown("8 cards · 3 working", false)).toBe("8 cards · 3 working");
  });
});
