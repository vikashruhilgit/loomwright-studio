// @vitest-environment jsdom
// Budget & audit on the shared shell (phase 7 item 17), through the real `App` over a scripted bridge in fake
// time: the count line is the title bar's subtitle (`ScreenDefinition.Subtitle`), the screen keeps its data under
// the shell's one band when the kernel goes away and reads again on its own when it returns, and the cap card
// marks a window past its reset as stale and names the account. `BudgetScreen.test.tsx` covers the screen alone.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import type { ApiRequest, ApiResult, BudgetUsageResponse, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { BACKOFF_INITIAL_MS, REFETCH_THROTTLE_MS } from "../../store/store";
import { useKernelReach } from "../../shell/last-known";
import { Titlebar } from "../../shell/Titlebar";
import { BudgetScreen } from "./BudgetScreen";
import { screen as budgetScreen } from "./index";
import { BUDGET_TEST_IDS as IDS, localDay } from "./model";
import { Subtitle } from "./Subtitle";

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
  cap_state: [{ account: "personal subscription", provider: "subscription-token", limits: [] }],
};

const UNREACHABLE: ApiResult<unknown> = { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } };
const BAND = "kernel-unreachable-band";
/** The shell's fixed system time: Thu 22 Oct 2026, 09:30 UTC. */
const SYSTEM_TIME = new Date("2026-10-22T09:30:15Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(SYSTEM_TIME);
});

afterEach(() => {
  cleanup();
  window.location.hash = "";
  Reflect.deleteProperty(window, "api");
  vi.useRealTimers();
});

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// ---- A scripted kernel ----------------------------------------------------------------------------------------------

const today = (): string => localDay(new Date());

function usage(o: Partial<BudgetUsageResponse> = {}): BudgetUsageResponse {
  return {
    rows: [{ day: today(), agent: "mason", playbook: null, counted_tokens: 61924, cache_read_tokens: 0, cost_estimate_usd: null }],
    limits: [{ scope: "agent", id: "mason", tokens_today: 61924, tokens_per_day: 150000, sessions_running: 0, sessions_at_once: 2 }],
    cap_state: [],
    ...o,
  };
}

function events(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    type: "event" as const,
    id: 100 - i,
    at: new Date(SYSTEM_TIME.getTime() - i * 60_000).toISOString(),
    kind: "task_created",
    session_id: null,
    task_id: 100 - i,
    payload: { title: `Task number ${100 - i}`, state: "waiting" },
    actor: "kernel",
  }));
}

interface Kernel {
  readonly fake: FakeBridge;
  body: BudgetUsageResponse;
  status: StatusBody;
  /** `GET /budget/usage` answers this while set (the kernel is gone). */
  down: boolean;
}

function createKernel(o: Partial<BudgetUsageResponse> = {}): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = { fake, body: usage(o), status: STATUS, down: false };
  const answer = (body: unknown): ApiResult<unknown> => (kernel.down ? UNREACHABLE : ok(body));
  fake.route("GET /status", () => ok(kernel.status));
  fake.route("GET /agents", () => ok({ agents: [] }));
  fake.route("GET /playbooks", () => ok({ playbooks: [] }));
  fake.route("GET /budget/usage", () => answer(kernel.body));
  fake.route("GET /audit", (req: ApiRequest) => {
    const all = events(20);
    const before = req.query?.before === undefined ? Infinity : Number(req.query.before);
    const page = all.filter((e) => e.id < before).slice(0, Number(req.query?.limit ?? 50));
    const last = page[page.length - 1];
    return answer({ events: page, next_before: page.length === Number(req.query?.limit ?? 50) && last !== undefined ? String(last.id) : null, matching: all.length, total: all.length });
  });
  return kernel;
}

/** Render the real shell on `#/budget` over `kernel`, live, with the first reads landed. */
async function openBudget(kernel: Kernel): Promise<void> {
  Object.defineProperty(window, "api", { value: kernel.fake.bridge, configurable: true });
  window.location.hash = "#/budget";
  render(<App api={kernel.fake.bridge} registry={createCommandRegistry()} />);
  await act(async () => undefined);
  act(() => kernel.fake.emit({ type: "heartbeat", latest_id: 0 }));
  await advance(REFETCH_THROTTLE_MS * 4);
}

/** The feed closes and the kernel does not answer: the shell reads `reconnecting`. */
async function stopKernel(kernel: Kernel): Promise<void> {
  kernel.down = true;
  kernel.fake.connectionAnswer = { state: "unreachable", reason: "daemon_not_running" };
  act(() => kernel.fake.emit({ type: "closed", code: 1006, reason: "" }));
  // A live event is what makes the screen read again; the read is what finds the kernel gone.
  act(() => kernel.fake.emit({ type: "event", id: 5000, at: new Date().toISOString(), kind: "session_status", session_id: null, task_id: null, payload: {} }));
  await advance(BACKOFF_INITIAL_MS);
}

async function restartKernel(kernel: Kernel): Promise<void> {
  kernel.down = false;
  kernel.fake.connectionAnswer = { state: "connected", port: 1 };
  kernel.fake.subscribeAnswer = { state: "connected", port: 1 };
  await advance(BACKOFF_INITIAL_MS * 4);
  act(() => kernel.fake.emit({ type: "heartbeat", latest_id: 0 }));
  await advance(REFETCH_THROTTLE_MS * 4);
}

const subtitle = (): HTMLElement => screen.getByTestId("titlebar-subtitle");
const reads = (kernel: Kernel, key: string): number => kernel.fake.requestsTo(key).length;

// ---- The title bar's subtitle -------------------------------------------------------------------------------------------

describe("the count line is the title bar's subtitle", () => {
  it("the screen declares a Subtitle; the overview's line renders beside the title, and the screen draws none of its own", async () => {
    expect(budgetScreen.Subtitle).toBe(Subtitle);
    await openBudget(createKernel());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Budget & audit");
    expect(subtitle().textContent).toBe("61,924 tokens today");
    expect(within(subtitle()).getByTestId(IDS.summary)).toBeTruthy();
    // After the title, in the same bar.
    const bar = subtitle().parentElement as HTMLElement;
    expect([...bar.children].map((c) => c.tagName)).toEqual(["H1", "SPAN"]);
    expect(within(screen.getByTestId(IDS.screen)).queryByTestId(IDS.summary)).toBeNull();
    expect(screen.getByTestId(IDS.screen).querySelector(".budget-tbar")?.textContent).toBe("Audit log");
  });

  it("the audit view's subtitle reads 'Audit log', and the overview's returns with Back", async () => {
    await openBudget(createKernel());
    fireEvent.click(screen.getByTestId(IDS.auditButton));
    await advance(10);
    expect(subtitle().textContent).toBe("Audit log");
    expect(within(screen.getByTestId(IDS.screen)).queryByTestId(IDS.summary)).toBeNull();
    fireEvent.click(screen.getByTestId(IDS.back));
    await advance(10);
    expect(subtitle().textContent).toBe("61,924 tokens today");
  });

  it("with no usage to count (empty, or not read yet) the subtitle is empty", async () => {
    await openBudget(createKernel({ rows: [], limits: [] }));
    expect(screen.getByTestId(IDS.empty)).toBeTruthy();
    expect(subtitle().textContent).toBe("");
  });

  it("a window with no bridge says so, and the subtitle renders nothing and never throws", () => {
    // `window.api` is unset (a shell rendered without a preload).
    const Route = budgetScreen.Component;
    render(
      <>
        <Titlebar screen={budgetScreen} />
        <Route />
      </>,
    );
    expect(screen.getByTestId(IDS.screen).textContent).toContain("This window has no connection to the kernel.");
    expect(subtitle().textContent).toBe("");
    expect(render(<Subtitle />).container.textContent).toBe("");
  });

  it("under <StrictMode> (effects run twice) the line is published once and cleared on unmount", async () => {
    const kernel = createKernel();
    const view = render(
      <StrictMode>
        <Titlebar screen={budgetScreen} />
        <BudgetScreen api={kernel.fake.bridge} registry={createCommandRegistry()} />
      </StrictMode>,
    );
    await act(async () => undefined);
    act(() => kernel.fake.emit({ type: "heartbeat", latest_id: 0 }));
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(subtitle().textContent).toBe("61,924 tokens today");
    view.unmount();
    expect(render(<Subtitle />).container.textContent).toBe("");
  });

  it("leaving the screen clears the line", async () => {
    const kernel = createKernel();
    await openBudget(kernel);
    expect(subtitle().textContent).toBe("61,924 tokens today");
    act(() => {
      window.location.hash = "#/team";
    });
    await advance(10);
    expect(screen.queryByTestId(IDS.summary)).toBeNull();
    // Team declares no subtitle: the title bar shows the title alone.
    expect(screen.queryByTestId("titlebar-subtitle")).toBeNull();
  });
});

// ---- The kernel goes away -------------------------------------------------------------------------------------------------

describe("the kernel stopped", () => {
  it("keeps the data under the shell's one band, marked last known, with every kernel control off; no 'Status unknown', no request text", async () => {
    const kernel = createKernel();
    await openBudget(kernel);
    await advance(10);
    expect(screen.queryByTestId(BAND)).toBeNull();
    expect(screen.getAllByTestId(IDS.latestCard).length).toBeGreaterThan(0);

    await stopKernel(kernel);
    // One band, the shell's; the screen draws none of its own.
    expect(screen.getAllByTestId(BAND)).toHaveLength(1);
    expect(screen.queryByTestId(IDS.kernelBand)).toBeNull();
    expect(screen.queryByTestId(IDS.unknown)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(screen.getAllByTestId(IDS.dayRow)).toHaveLength(7);
    expect(subtitle().textContent).toBe("61,924 tokens today · last known");
    const audit = screen.getByTestId(IDS.auditButton) as HTMLButtonElement;
    expect(audit.disabled).toBe(true);
    expect(audit.title).toBe("Needs the kernel");
    const openLog = screen.getByTestId(IDS.openLog) as HTMLButtonElement;
    expect(openLog.disabled).toBe(true);
    expect(openLog.title).toBe("Needs the kernel");
    const text = screen.getByTestId(IDS.screen).textContent ?? "";
    expect(text).not.toContain("Status unknown");
    expect(text).not.toMatch(/GET |\/budget\/usage|daemon_not_running|unreachable/);
  });

  it("reads again on its own when the listener restarts", async () => {
    const kernel = createKernel();
    await openBudget(kernel);
    await stopKernel(kernel);
    expect(subtitle().textContent).toContain("last known");
    kernel.body = usage({ rows: [{ day: today(), agent: "mason", playbook: null, counted_tokens: 70000, cache_read_tokens: 0, cost_estimate_usd: null }] });
    const before = reads(kernel, "GET /budget/usage");
    await restartKernel(kernel);
    expect(reads(kernel, "GET /budget/usage")).toBeGreaterThan(before);
    expect(screen.queryByTestId(BAND)).toBeNull();
    expect(subtitle().textContent).toBe("70,000 tokens today");
    expect((screen.getByTestId(IDS.auditButton) as HTMLButtonElement).disabled).toBe(false);
  });

  it("in the audit log the rows stay as last read and the filters and paging are off", async () => {
    const kernel = createKernel();
    await openBudget(kernel);
    fireEvent.click(screen.getByTestId(IDS.auditButton));
    await advance(10);
    expect(screen.getAllByTestId(IDS.auditRow)).toHaveLength(8);
    await stopKernel(kernel);
    expect(screen.getAllByTestId(BAND)).toHaveLength(1);
    expect(screen.getAllByTestId(IDS.auditRow)).toHaveLength(8);
    expect(screen.getByTestId(IDS.footer).textContent).toBe("Showing 1–8 of 20 · page 1 of 3 · newest first · last known");
    for (const id of [IDS.older, IDS.newer, IDS.clear]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
    for (const label of ["Kind", "Agent", "Playbook", "Time range"]) expect((screen.getByLabelText(label) as HTMLSelectElement).disabled, label).toBe(true);
    expect(screen.queryByTestId(IDS.auditError)).toBeNull();
    expect(subtitle().textContent).toBe("Audit log");
  });

  it("'Status unknown' is for a screen that has never had data, and it shows no request text", async () => {
    const kernel = createKernel();
    kernel.down = true;
    kernel.fake.connectionAnswer = { state: "unreachable", reason: "daemon_not_running" };
    kernel.fake.subscribeAnswer = { state: "unreachable", reason: "daemon_not_running" };
    await openBudget(kernel);
    expect(screen.getAllByTestId(BAND)).toHaveLength(1);
    expect(screen.getByTestId(IDS.unknown).textContent).toContain("Status unknown");
    expect(screen.queryByTestId(IDS.dayTable)).toBeNull();
    expect(screen.getByTestId(IDS.screen).textContent).not.toMatch(/GET |\/budget\/usage|daemon_not_running/);
    expect(subtitle().textContent).toBe("");
  });

  it("returning to the screen while the kernel is still stopped keeps what this window last read", async () => {
    const kernel = createKernel({ cap_state: [{ account: "subscription-token", provider: "subscription-token", limits: [] }] });
    const api = kernel.fake.bridge;
    // The probe keeps the live store (and so the shell's connection view) alive while the screen is away.
    const Probe = () => <span data-testid="probe">{String(useKernelReach(api).shellBand)}</span>;
    const Host = ({ shown }: { readonly shown: boolean }) => (
      <>
        <Probe />
        {shown ? <BudgetScreen api={api} registry={createCommandRegistry()} /> : null}
      </>
    );
    const view = render(<Host shown />);
    await act(async () => undefined);
    act(() => kernel.fake.emit({ type: "heartbeat", latest_id: 0 }));
    await advance(REFETCH_THROTTLE_MS * 4);
    expect(screen.getAllByTestId(IDS.dayRow)).toHaveLength(7);

    view.rerender(<Host shown={false} />);
    await stopKernel(kernel);
    expect(screen.getByTestId("probe").textContent).toBe("true");
    view.rerender(<Host shown />);
    await advance(50);
    expect(screen.queryByTestId(IDS.unknown)).toBeNull();
    expect(screen.getAllByTestId(IDS.dayRow)).toHaveLength(7);
    expect((screen.getByTestId(IDS.auditButton) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(IDS.cap).textContent).toContain("last known");
  });
});

// ---- The cap card ----------------------------------------------------------------------------------------------------------------

describe("the subscription cap card", () => {
  const past = new Date(2026, 9, 20, 0, 30).toISOString();
  const read = new Date(2026, 9, 19, 21, 5).toISOString();
  const ahead = new Date(2026, 9, 23, 17, 0).toISOString();

  it("a window past its reset reads stale with its last-read time; the past reset is never shown as current", async () => {
    const kernel = createKernel({
      cap_state: [
        {
          account: "subscription-token",
          provider: "subscription-token",
          limits: [
            { rate_limit_type: "five_hour", status: "allowed", resets_at: past, utilization: null, reset_source: null, updated_at: read },
            { rate_limit_type: "seven_day", status: "allowed_warning", resets_at: past, utilization: 0.83, reset_source: null, updated_at: read },
            { rate_limit_type: "opus", status: "allowed", resets_at: ahead, utilization: 0.2, reset_source: null, updated_at: read },
          ],
        },
      ],
    });
    await openBudget(kernel);
    const windows = screen.getAllByTestId(IDS.capWindow);
    expect(windows.map((w) => w.getAttribute("data-stale"))).toEqual(["true", "true", null]);
    const seven = windows[1] as HTMLElement;
    expect(within(seven).getByTestId(IDS.capStatus).textContent).toBe("warning");
    expect(within(seven).getByTestId(IDS.capStatus).querySelector(".badge")?.getAttribute("data-tone")).toBe("neutral");
    expect(within(seven).getByTestId(IDS.capStale).textContent).toBe("stale");
    expect(within(seven).getByTestId(IDS.capText).textContent).toBe("last read Mon 19 Oct 21:05 · window ended Tue 20 Oct 00:30");
    expect(within(seven).queryByRole("img")).toBeNull();
    expect(within(seven).getByTestId(IDS.capText).textContent).not.toContain("resets");
    // A live window is unchanged.
    const live = windows[2] as HTMLElement;
    expect(within(live).queryByTestId(IDS.capStale)).toBeNull();
    expect(within(live).getByTestId(IDS.capText).textContent).toContain("20% used · resets");
    // Nothing is parked on a stale warning.
    expect(screen.getByTestId(IDS.cap).textContent).toContain("No window is rejected, so nothing is parked on the cap.");
  });

  it("a stale window from an older kernel (no updated_at) says its last-read time is unknown", async () => {
    const kernel = createKernel({
      cap_state: [{ account: "subscription-token", provider: "subscription-token", limits: [{ rate_limit_type: "five_hour", status: "allowed", resets_at: past, utilization: null, reset_source: null }] }],
    });
    await openBudget(kernel);
    expect(screen.getByTestId(IDS.capText).textContent).toBe("last read time unknown · window ended Tue 20 Oct 00:30");
  });

  it("a rejected window past its reset is neutral and not a park", async () => {
    const kernel = createKernel({
      cap_state: [{ account: "subscription-token", provider: "subscription-token", limits: [{ rate_limit_type: "five_hour", status: "rejected", resets_at: past, utilization: null, reset_source: null, updated_at: read }] }],
    });
    await openBudget(kernel);
    expect(screen.getByTestId(IDS.capStatus).querySelector(".badge")?.getAttribute("data-tone")).toBe("neutral");
    expect(screen.getByTestId(IDS.cap).textContent).toContain("A rejected window has ended, so nothing is parked on the cap.");
  });

  it("the subscription provider with no account label reads 'personal subscription', not its id; a provider with a label reads the label", async () => {
    const kernel = createKernel({ cap_state: [{ account: "subscription-token", provider: "subscription-token", limits: [] }] });
    kernel.status = { ...STATUS, cap_state: [{ account: "subscription-token", provider: "subscription-token", limits: [] }] };
    await openBudget(kernel);
    expect(screen.getByTestId(IDS.cap).textContent).toContain("personal subscription");
    expect(screen.getByTestId(IDS.cap).textContent).not.toContain("subscription-token");
    cleanup();

    const labelled = createKernel({ cap_state: [{ account: "subscription-token", provider: "subscription-token", limits: [] }] });
    labelled.status = { ...STATUS, cap_state: [{ account: "work seat", provider: "subscription-token", limits: [] }] };
    await openBudget(labelled);
    expect(screen.getByTestId(IDS.cap).textContent).toContain("work seat");
    expect(screen.getByTestId(IDS.cap).textContent).not.toContain("personal subscription");
  });
});
