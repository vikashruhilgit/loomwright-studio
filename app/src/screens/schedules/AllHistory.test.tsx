// @vitest-environment jsdom
// Schedules & triggers, the all-triggers parts (phase 7 item 16) against a scripted bridge: the firing history of
// every trigger as the default pane (merged newest first, its filter and "Load older" without a gap or a repeat), a
// trigger's own detail one click away and "All triggers" back, the "playbook off: fires are skipped" note, two-line
// titles that keep their full text as a tooltip, the title bar's count line (`Subtitle`), and the last data kept per
// bridge so a screen mounted again while the kernel is stopped still shows it. The pure merge is `all-fires.test.ts`.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiRequest, ApiResult, PlaybookListing, ScheduleEntry, StatusBody, Trigger, TriggerFire } from "../../api/contract";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { SCHEDULES_TEST_IDS as IDS, PLAYBOOK_OFF_TEXT } from "./model";
import { SchedulesScreen } from "./SchedulesScreen";
import { SubtitleFor } from "./Subtitle";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

const STATUS: StatusBody = {
  kernel: { version: "1.0.0", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-11-01", agents: [] },
  cap_state: [],
};

const UNREACHABLE: ApiResult<unknown> = { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } };
const minutes = (n: number): string => new Date(Date.now() + n * 60_000).toISOString();

function trigger(id: number, o: Partial<Trigger> = {}): Trigger {
  return {
    id,
    owning_agent: "mason",
    playbook: null,
    kind: "cron",
    spec: { cron: "0 9 * * 5", tz: "UTC" },
    action: "message",
    text: `Trigger ${id}`,
    enabled: true,
    enabled_changed_by: null,
    enabled_changed_at: null,
    next_fire_at: minutes(10 * id),
    last_fired_at: null,
    last_result: null,
    created_by: "wright",
    created_at: "2026-10-21T09:00:00.000Z",
    ...o,
  };
}

function entry(id: number, o: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return { kind: "trigger", id, at: minutes(10 * id), agent: "mason", playbook: null, action: "message", text: `Trigger ${id}`, task_id: null, ...o };
}

function playbook(slug: string, name: string, status = "enabled"): PlaybookListing {
  return {
    id: 1,
    slug,
    name,
    owning_agent: "mason",
    intent: "",
    status,
    version: 1,
    dedupe_key_spec: null,
    dedupe_key_set_by: null,
    priority: "normal",
    priority_set_by: null,
    model: null,
    model_set_by: null,
    effort: null,
    effort_set_by: null,
    token_limit_per_day: null,
    token_limit_set_by: null,
    api_key_fallback_json: null,
    api_key_fallback_set_by: null,
    created_at: "2026-10-21T09:00:00.000Z",
    updated_at: "2026-10-21T09:00:00.000Z",
    mode: "draft",
    mode_set_by: null,
    trigger_id: null,
    next_fire_at: null,
  } as PlaybookListing;
}

let clock = 0;
function fire(id: number, kind: TriggerFire["kind"] = "trigger_fired", reason: string | null = null): TriggerFire {
  clock += 1;
  return { id, kind, at: new Date(Date.now() - (1000 - clock) * 60_000).toISOString(), scheduled_at: null, reason, session_id: null };
}
const missed = (id: number, reason: string | null): TriggerFire => fire(id, "trigger_missed", reason);

interface Kernel {
  readonly fake: FakeBridge;
  triggers: Trigger[];
  playbooks: PlaybookListing[];
  entries: ScheduleEntry[];
  fires: Map<number, TriggerFire[]>;
  pageSize: number;
  down: boolean;
}

function createKernel(setup: Partial<Omit<Kernel, "fake" | "down">> = {}): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = { fake, triggers: [], playbooks: [], entries: [], fires: new Map(), pageSize: 50, down: false, ...setup };
  const answer = (body: () => ApiResult<unknown>) => (): ApiResult<unknown> => (kernel.down ? UNREACHABLE : body());
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /triggers", answer(() => ok({ triggers: kernel.triggers })));
  fake.route("GET /playbooks", answer(() => ok({ playbooks: kernel.playbooks })));
  fake.route("GET /schedule", answer(() => ok({ entries: kernel.entries })));
  fake.route("GET /triggers/:id/fires", (req: ApiRequest) =>
    answer(() => {
      const all = kernel.fires.get(Number(req.params?.id)) ?? [];
      const before = req.query?.before === undefined ? Infinity : Number(req.query.before);
      const page = all.filter((f) => f.id < before).slice(0, kernel.pageSize);
      const last = page[page.length - 1];
      return ok({ fires: page, next_before: page.length === kernel.pageSize && last !== undefined ? String(last.id) : null });
    })(),
  );
  return kernel;
}

/** The screen over `kernel`, with the title bar's count line beside it (the shell draws that one). */
function mount(kernel: Kernel): void {
  render(
    <>
      <SubtitleFor api={kernel.fake.bridge} />
      <SchedulesScreen api={kernel.fake.bridge} />
    </>,
  );
}

async function start(setup: Partial<Omit<Kernel, "fake" | "down">>): Promise<Kernel> {
  const kernel = createKernel(setup);
  mount(kernel);
  await waitFor(() => expect(screen.queryByTestId(IDS.loading)).toBeNull());
  return kernel;
}

const fireReads = (kernel: Kernel) => kernel.fake.requestsTo("GET /triggers/:id/fires").map((r) => r.req);
const rowsOf = (): HTMLElement[] => screen.getAllByTestId(IDS.allFire);
const triggerNames = (): (string | null)[] => screen.getAllByTestId(IDS.fireTrigger).map((el) => el.textContent);

/** Four triggers: a poll whose playbook is enabled, one whose playbook is off, one with no playbook, one whose playbook is missing. */
function mixed(): Partial<Omit<Kernel, "fake" | "down">> {
  return {
    triggers: [
      trigger(1, { playbook: "review-prs", kind: "poll", spec: { source: "github", repos: ["sandbox"], filters: {}, interval_seconds: 600 }, text: "review" }),
      trigger(2, { playbook: "weekly", text: "weekly" }),
      trigger(3, { text: "Friday wrap-up" }),
      trigger(4, { playbook: "gone", text: "orphan" }),
    ],
    playbooks: [playbook("review-prs", "Review PRs", "enabled"), playbook("weekly", "Weekly changelog", "disabled")],
    entries: [entry(1, { playbook: "review-prs", text: "review" }), entry(2, { playbook: "weekly", text: "weekly" }), entry(3, { text: "Friday wrap-up" }), entry(4, { playbook: "gone", text: "orphan" })],
  };
}

// ---- The default pane is all triggers ------------------------------------------------------------------------------------

describe("the firing history of every trigger", () => {
  /** Trigger 1 and 3 interleave by id; trigger 2 (playbook off) has two skipped fires; page size 3. */
  function interleaved(): Partial<Omit<Kernel, "fake" | "down">> {
    return {
      ...mixed(),
      pageSize: 3,
      fires: new Map([
        [1, [fire(12), fire(10), fire(8), fire(6), fire(4), fire(2)]],
        [2, [missed(11, "playbook_not_enabled"), missed(9, "playbook_not_enabled")]],
        [3, [fire(7), fire(5), fire(3), fire(1)]],
      ]),
    };
  }

  it("the default pane is all triggers and 'All triggers' returns from a trigger's detail", async () => {
    const kernel = await start(interleaved());
    await screen.findAllByTestId(IDS.allFire);
    // No trigger is open: the history is the whole pane's content, with no detail and no way back.
    expect(screen.queryByTestId(IDS.detail)).toBeNull();
    expect(screen.queryByTestId(IDS.allTriggers)).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Firing history" })).toBeTruthy();
    expect(screen.getAllByTestId(IDS.select).every((b) => b.getAttribute("aria-current") === null)).toBe(true);
    // Every trigger's first page was read once.
    expect(fireReads(kernel).map((r) => [r.params?.id, r.query])).toEqual(expect.arrayContaining([[1, undefined], [2, undefined], [3, undefined], [4, undefined]]));

    const select = screen.getAllByTestId(IDS.select)[2] as HTMLElement;
    fireEvent.click(select);
    expect((await screen.findByTestId(IDS.detailName)).textContent).toBe("Friday wrap-up");
    expect(select.getAttribute("aria-current")).toBe("true");
    await screen.findAllByTestId(IDS.fire);
    expect(screen.queryByTestId(IDS.allFire)).toBeNull();

    fireEvent.click(screen.getByTestId(IDS.allTriggers));
    await screen.findAllByTestId(IDS.allFire);
    expect(screen.queryByTestId(IDS.detail)).toBeNull();
    expect(screen.queryByTestId(IDS.allTriggers)).toBeNull();
    expect(select.getAttribute("aria-current")).toBeNull();
    // Focus goes back to the row that opened the trigger, not to the page.
    expect(document.activeElement).toBe(select);
  });

  it("lists every trigger's fires newest first by event id, each row naming its trigger", async () => {
    await start(interleaved());
    await screen.findAllByTestId(IDS.allFire);
    // Page one per trigger: 12 10 8 | 11 9 | 7 5 3; the horizon is the newest of the unfinished triggers' oldest loaded
    // fires (trigger 1's 8 and trigger 3's 3), so everything down to 8 shows.
    expect(triggerNames()).toEqual(["Review PRs", "Weekly changelog", "Review PRs", "Weekly changelog", "Review PRs"]);
    expect(rowsOf().map((r) => r.getAttribute("data-trigger"))).toEqual(["1", "2", "1", "2", "1"]);
    expect(screen.getByTestId(IDS.table)).toBeTruthy();
    expect(within(screen.getByTestId(IDS.table)).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["When", "Trigger", "Result"]);
  });

  it("Load older extends the list without dropping or repeating a fire, down to the last page", async () => {
    await start(interleaved());
    await screen.findAllByTestId(IDS.allFire);
    const shown = () => rowsOf().flatMap((r) => Array(Number(r.getAttribute("data-count"))).fill(r.getAttribute("data-trigger")));
    expect(screen.getByTestId(IDS.filterAll).textContent).toBe("All · 5+");
    let guard = 0;
    while (screen.queryByTestId(IDS.loadOlder) !== null && guard < 10) {
      const before = shown().length;
      fireEvent.click(screen.getByTestId(IDS.loadOlder));
      await waitFor(() => expect(shown().length).toBeGreaterThanOrEqual(before));
      await waitFor(() => expect((screen.queryByTestId(IDS.loadOlder) as HTMLButtonElement | null)?.disabled ?? false).toBe(false));
      guard += 1;
    }
    expect(screen.queryByTestId(IDS.loadOlder)).toBeNull();
    // 6 + 2 + 4 fires, each once, in id order: trigger 1 at 12 10 8 6 4 2, trigger 2 at 11 9, trigger 3 at 7 5 3 1.
    expect(shown()).toEqual(["1", "2", "1", "2", "1", "3", "1", "3", "1", "3", "1", "3"]);
    expect(screen.getByTestId(IDS.filterAll).textContent).toBe("All · 12");
    expect(screen.getByTestId(IDS.filterMissed).textContent).toBe("Not fired · 2");
  });

  it("'All · N' and 'Not fired · N' filter it, and Not fired keeps only the missed rows", async () => {
    await start(interleaved());
    await screen.findAllByTestId(IDS.allFire);
    expect(screen.getByTestId(IDS.filterMissed).textContent).toBe("Not fired · 2+");
    fireEvent.click(screen.getByTestId(IDS.filterMissed));
    expect(screen.getByTestId(IDS.filterMissed).getAttribute("aria-pressed")).toBe("true");
    expect(rowsOf().map((r) => r.getAttribute("data-kind"))).toEqual(["trigger_missed", "trigger_missed"]);
    fireEvent.click(screen.getByTestId(IDS.filterAll));
    expect(rowsOf().length).toBeGreaterThan(2);
  });

  it("folds consecutive repeats of one trigger into one row with a count, never across two triggers", async () => {
    await start({
      ...mixed(),
      fires: new Map([
        [1, [missed(9, "paused"), missed(7, "paused"), missed(3, "paused")]],
        [3, [missed(8, "paused"), missed(2, "paused")]],
      ]),
    });
    await screen.findAllByTestId(IDS.allFire);
    // By id: 9 (trigger 1), 8 (trigger 3), 7 and 3 (trigger 1, back to back, so one row), 2 (trigger 3).
    expect(rowsOf().map((r) => [r.getAttribute("data-trigger"), r.getAttribute("data-count")])).toEqual([
      ["1", "1"],
      ["3", "1"],
      ["1", "2"],
      ["3", "1"],
    ]);
    expect(rowsOf()[2]?.textContent).toContain("×2");
  });

  it("a playbook-off trigger's own skipped fires read 'playbook off: fires are skipped' with the code beneath", async () => {
    await start({ ...mixed(), fires: new Map([[2, [missed(5, "playbook_not_enabled"), missed(4, "playbook_not_enabled"), fire(1)]]]) });
    await screen.findAllByTestId(IDS.allFire);
    const skipped = rowsOf().find((r) => r.getAttribute("data-reason") === "playbook_not_enabled") as HTMLElement;
    expect(skipped.getAttribute("data-count")).toBe("2");
    expect(within(skipped).getByTestId(IDS.fireBadge).textContent).toBe(PLAYBOOK_OFF_TEXT);
    expect(within(skipped).getByTestId(IDS.fireReason).textContent).toBe("playbook_not_enabled");
    expect(within(skipped).getByTestId(IDS.fireTrigger).textContent).toBe("Weekly changelog");
    // Its own history, one click away, says the same.
    fireEvent.click(screen.getAllByTestId(IDS.select)[1] as HTMLElement);
    const own = await screen.findAllByTestId(IDS.fire);
    expect(within(own[0] as HTMLElement).getByTestId(IDS.fireBadge).textContent).toBe(PLAYBOOK_OFF_TEXT);
  });

  it("says so when nothing has fired, and when the history cannot be read", async () => {
    await start(mixed());
    expect((await screen.findByTestId(IDS.historyEmpty)).textContent).toBe("Nothing has fired or been missed yet.");
    cleanup();
    const down = createKernel(mixed());
    down.down = true;
    mount(down);
    expect((await screen.findByTestId(IDS.unknown)).textContent).toContain("Status unknown");
  });
});

// ---- A playbook that is off ------------------------------------------------------------------------------------------------

describe("a trigger that is on whose playbook is off", () => {
  it("AC5: the note shows on a playbook-off trigger's row and upcoming entry, and not for an enabled or null playbook", async () => {
    await start(mixed());
    await waitFor(() => expect(screen.getAllByTestId(IDS.playbookOff).length).toBeGreaterThan(0));
    const rowOf = (id: number) => screen.getAllByTestId(IDS.trigger).find((li) => li.getAttribute("data-id") === String(id)) as HTMLElement;
    const entryOf = (id: number) => screen.getAllByTestId(IDS.entry).find((li) => li.getAttribute("data-id") === String(id)) as HTMLElement;
    // Trigger 2 (playbook disabled) and trigger 4 (playbook missing: the kernel's gate skips it as well) say so, on the row and in the upcoming list.
    for (const id of [2, 4]) {
      expect(within(rowOf(id)).getByTestId(IDS.playbookOff).textContent).toBe(PLAYBOOK_OFF_TEXT);
      expect(within(entryOf(id)).getByTestId(IDS.playbookOff).textContent).toBe(PLAYBOOK_OFF_TEXT);
    }
    // An enabled playbook and no playbook at all: no note.
    for (const id of [1, 3]) {
      expect(within(rowOf(id)).queryByTestId(IDS.playbookOff)).toBeNull();
      expect(within(entryOf(id)).queryByTestId(IDS.playbookOff)).toBeNull();
    }
    expect(screen.getAllByTestId(IDS.playbookOff)).toHaveLength(4);
    // The words are the accessible name of the row's description, not colour alone.
    expect(rowOf(2).querySelector("[aria-describedby]")?.getAttribute("aria-describedby")).toContain("schedules-off-2");
  });

  it("claims nothing while the playbooks have not loaded", async () => {
    const kernel = createKernel(mixed());
    kernel.fake.route("GET /playbooks", () => new Promise<never>(() => undefined));
    mount(kernel);
    await screen.findByTestId(IDS.timeline);
    await screen.findByTestId(IDS.triggers);
    expect(screen.queryByTestId(IDS.playbookOff)).toBeNull();
  });

  it("shows no note on a trigger that is off: it fires nothing, so there is nothing to skip", async () => {
    const setup = mixed();
    setup.triggers = setup.triggers?.map((t) => (t.id === 2 ? { ...t, enabled: false, next_fire_at: null } : t));
    setup.entries = setup.entries?.filter((e) => e.id !== 2);
    await start(setup);
    await screen.findByTestId(IDS.triggers);
    await waitFor(() => expect(screen.getAllByTestId(IDS.playbookOff).length).toBeGreaterThan(0));
    const row = screen.getAllByTestId(IDS.trigger).find((li) => li.getAttribute("data-id") === "2") as HTMLElement;
    expect(within(row).queryByTestId(IDS.playbookOff)).toBeNull();
  });
});

// ---- Upcoming · Today and titles ------------------------------------------------------------------------------------------

describe("the upcoming list", () => {
  it("is headed 'Upcoming · Today' with the entries due today, and later ones under 'Later'", async () => {
    const todayAt = new Date();
    todayAt.setHours(23, 59, 0, 0);
    const tomorrow = new Date(todayAt.getTime() + 24 * 3_600_000);
    await start({
      triggers: [trigger(1), trigger(2)],
      entries: [entry(1, { at: todayAt.toISOString() }), entry(2, { at: tomorrow.toISOString() })],
    });
    expect((await screen.findByTestId(IDS.todayHeading)).textContent).toBe("Upcoming · Today");
    const region = screen.getByTestId(IDS.timeline);
    const [today, later] = within(region).getAllByRole("list");
    expect(within(today as HTMLElement).getAllByTestId(IDS.entry).map((e) => e.getAttribute("data-id"))).toEqual(["1"]);
    expect(screen.getByTestId(IDS.laterHeading).textContent).toBe("Later");
    expect(within(later as HTMLElement).getAllByTestId(IDS.entry).map((e) => e.getAttribute("data-id"))).toEqual(["2"]);
    expect(screen.getAllByTestId(IDS.entry)).toHaveLength(2);
    expect(screen.getAllByTestId(IDS.timeline)).toHaveLength(1);
  });

  it("with nothing due today still shows the heading and says so in one line", async () => {
    const tomorrow = new Date(Date.now() + 36 * 3_600_000);
    await start({ triggers: [trigger(1)], entries: [entry(1, { at: tomorrow.toISOString() })] });
    expect((await screen.findByTestId(IDS.todayHeading)).textContent).toBe("Upcoming · Today");
    expect(screen.getByTestId(IDS.todayEmpty).textContent).toBe("Nothing else is due today.");
    expect(screen.getByTestId(IDS.laterHeading)).toBeTruthy();
    expect(screen.getAllByTestId(IDS.entry)).toHaveLength(1);
  });

  it("AC4: a clamped title carries its full text as `title`, on the upcoming entry and the trigger row", async () => {
    const long = `${"A very long trigger title that will not fit on two lines ".repeat(4)}end`;
    await start({ triggers: [trigger(1, { text: long })], entries: [entry(1, { text: long })] });
    const entryName = await screen.findByTestId(IDS.entryName);
    expect(entryName.textContent).toBe(long);
    expect(entryName.getAttribute("title")).toBe(long);
    expect(entryName.classList.contains("schedules-clamp")).toBe(true);
    const select = screen.getByTestId(IDS.select);
    expect(select.getAttribute("title")).toBe(long);
    expect(select.classList.contains("schedules-clamp")).toBe(true);
  });
});

// ---- The title bar's count line --------------------------------------------------------------------------------------------

describe("the title bar's count line", () => {
  it("shows 'N upcoming · M triggers on' from what the screen read, and nothing before any answer", async () => {
    const kernel = createKernel(mixed());
    let release: () => void = () => undefined;
    const held = new Promise<ApiResult<unknown>>((resolve) => {
      release = () => resolve(ok({ entries: kernel.entries }));
    });
    kernel.fake.route("GET /schedule", () => held);
    mount(kernel);
    await screen.findByTestId(IDS.loading);
    expect(screen.queryByTestId(IDS.summary)).toBeNull();
    release();
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("4 upcoming · 4 triggers on"));
  });

  it("ends in '· last known' while the kernel cannot be asked, and loses the mark when it answers again", async () => {
    const kernel = await start(mixed());
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("4 upcoming · 4 triggers on"));
    kernel.down = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("4 upcoming · 4 triggers on · last known"));
    kernel.down = false;
    kernel.fake.emit({ type: "event", id: 900, at: new Date().toISOString(), kind: "trigger_fired", session_id: null, task_id: null, payload: {} });
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("4 upcoming · 4 triggers on"));
  });

  it("draws no count line of its own inside the screen body", async () => {
    const kernel = createKernel(mixed());
    const { container } = render(<SchedulesScreen api={kernel.fake.bridge} />);
    await screen.findByTestId(IDS.timeline);
    expect(container.querySelector(`[data-testid="${IDS.summary}"]`)).toBeNull();
  });
});

// ---- The kernel stops ------------------------------------------------------------------------------------------------------

describe("when the kernel stops", () => {
  it("a remount while offline still shows the last data", async () => {
    const kernel = await start({ ...mixed(), fires: new Map([[1, [fire(5), fire(3)]], [3, [missed(4, "paused")]]]) });
    await screen.findAllByTestId(IDS.allFire);
    const names = screen.getAllByTestId(IDS.entryName).map((e) => e.textContent);
    const rows = rowsOf().length;
    expect(names).toHaveLength(4);
    cleanup();
    kernel.down = true;
    mount(kernel);
    // The data is on screen at once, from the holder, not a loading state and not "Status unknown".
    expect(screen.queryByTestId(IDS.unknown)).toBeNull();
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(screen.getAllByTestId(IDS.entryName).map((e) => e.textContent)).toEqual(names);
    expect(rowsOf()).toHaveLength(rows);
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("4 upcoming · 4 triggers on · last known"));
    // It stays after the reads were refused: the rows, the band, every control that needs the kernel off.
    expect(screen.getAllByTestId(IDS.entryName).map((e) => e.textContent)).toEqual(names);
    expect(rowsOf()).toHaveLength(rows);
    expect(screen.getByTestId(IDS.band)).toBeTruthy();
    for (const sw of screen.getAllByRole("switch")) {
      expect((sw as HTMLButtonElement).disabled).toBe(true);
      expect(sw.getAttribute("title")).toBe("Needs the kernel");
    }
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(IDS.screen).textContent).not.toMatch(/HTTP|GET \/|reconnecting|unreachable/);
  });

  it("AC1: 'Status unknown' only for a window that never had an answer", async () => {
    const kernel = createKernel(mixed());
    kernel.down = true;
    mount(kernel);
    expect((await screen.findByTestId(IDS.unknown)).textContent).toContain("Status unknown");
    expect(screen.queryByTestId(IDS.timeline)).toBeNull();
    cleanup();
    // The same bridge, once it has answered, never says it again.
    kernel.down = false;
    mount(kernel);
    await screen.findByTestId(IDS.timeline);
    cleanup();
    kernel.down = true;
    mount(kernel);
    await waitFor(() => expect(screen.getByTestId(IDS.band)).toBeTruthy());
    expect(screen.queryByTestId(IDS.unknown)).toBeNull();
    expect(screen.getAllByTestId(IDS.entry)).toHaveLength(4);
  });

  it("re-reads by itself once the feed is live again after a read the kernel could not answer", async () => {
    const kernel = await start(mixed());
    await screen.findByTestId(IDS.timeline);
    kernel.down = true;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByTestId(IDS.band)).toBeTruthy());
    expect(fireReads(kernel).length).toBeGreaterThan(0);
    kernel.down = false;
    // The next event brings an answer; the band goes and the controls come back.
    kernel.fake.emit({ type: "event", id: 901, at: new Date().toISOString(), kind: "trigger_toggled", session_id: null, task_id: null, payload: {} });
    await waitFor(() => expect(screen.queryByTestId(IDS.band)).toBeNull());
    for (const sw of screen.getAllByRole("switch")) expect((sw as HTMLButtonElement).disabled).toBe(false);
  });
});
