// @vitest-environment jsdom
// The Schedules & triggers screen (phase 7 item 05, AC1-AC8) against a scripted
// bridge (`fake-bridge.ts`): the states (loading, empty, populated, a route failure,
// unreachable with and without data), the timeline in the order the route sends,
// the trigger list with its switches, the 409 confirm, the firing history (missed
// reasons verbatim, repeats grouped, "Load older", the filter), the live refetch,
// untrusted text shown literally and the ⌘K commands. The real kernel's routes are
// covered by `kernel/test/gui-schedules.test.ts`; the built app by `e2e/schedules.spec.ts`.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiRequest, ApiResult, PlaybookListing, ScheduleEntry, StatusBody, Trigger, TriggerFire } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { SCHEDULES_OWNER } from "./commands";
import { SCHEDULES_TEST_IDS as IDS } from "./model";
import { SchedulesScreen } from "./SchedulesScreen";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

// ---- A scripted kernel --------------------------------------------------------------------------------------

const STATUS: StatusBody = {
  kernel: { version: "1.0.0", uptime_s: 1, pid: 7 },
  kill_switch: { engaged: false, since: null },
  auth: [],
  sessions: [],
  kill_unconfirmed: [],
  orphaned: [],
  queue: { pending: 0, events: [] },
  wakeups: { pending: 0, items: [] },
  tokens_today: { day: "2026-10-30", agents: [] },
  cap_state: [],
};

const UNREACHABLE: ApiResult<unknown> = { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } };
const refused = (status: number, body: { readonly error: string } & Record<string, unknown>): ApiResult<unknown> => ({ ok: false, status, body });
const minutes = (n: number): string => new Date(Date.now() + n * 60_000).toISOString();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function trigger(id: number, o: Partial<Trigger> = {}): Trigger {
  return {
    id,
    owning_agent: "mason",
    playbook: null,
    kind: "poll",
    spec: { source: "github", repos: ["studio-sandbox"], filters: {}, interval_seconds: 600 },
    action: "run_playbook",
    text: `Trigger ${id}`,
    enabled: true,
    enabled_changed_by: null,
    enabled_changed_at: null,
    next_fire_at: minutes(10),
    last_fired_at: null,
    last_result: null,
    created_by: "wright",
    created_at: "2026-10-21T09:00:00.000Z",
    ...o,
  };
}

function entry(kind: ScheduleEntry["kind"], id: number, at: string, o: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return { kind, id, at, agent: kind === "trigger" ? "mason" : null, playbook: null, action: kind === "trigger" ? "run_playbook" : null, text: `Trigger ${id}`, task_id: null, ...o };
}

function playbook(slug: string, name: string): PlaybookListing {
  return {
    id: 1,
    slug,
    name,
    owning_agent: "mason",
    intent: "",
    status: "enabled",
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
  };
}

let fireClock = 0;
function fire(id: number, kind: TriggerFire["kind"], reason: string | null = null): TriggerFire {
  fireClock += 1;
  return { id, kind, at: new Date(Date.now() - (100 - fireClock) * 60_000).toISOString(), scheduled_at: null, reason, session_id: null };
}
const missed = (id: number, reason: string | null): TriggerFire => fire(id, "trigger_missed", reason);

type Answer = ApiResult<unknown> | Promise<ApiResult<unknown>>;

interface Kernel {
  readonly fake: FakeBridge;
  readonly registry: CommandRegistry;
  triggers: Trigger[];
  playbooks: PlaybookListing[];
  entries: ScheduleEntry[];
  /** Every fire of each trigger, newest first; the route pages them `pageSize` at a time. */
  fires: Map<number, TriggerFire[]>;
  pageSize: number;
  schedule: (req: ApiRequest) => Answer;
  toggle: (req: ApiRequest) => Answer;
  fireRoute: (req: ApiRequest) => Answer;
}

interface Setup {
  readonly triggers?: Trigger[];
  readonly playbooks?: PlaybookListing[];
  readonly entries?: ScheduleEntry[];
  readonly fires?: Map<number, TriggerFire[]>;
  readonly pageSize?: number;
  readonly schedule?: Kernel["schedule"];
  readonly toggle?: Kernel["toggle"];
}

function createKernel(setup: Setup = {}): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = {
    fake,
    registry: createCommandRegistry(),
    triggers: setup.triggers ?? [],
    playbooks: setup.playbooks ?? [],
    entries: setup.entries ?? [],
    fires: setup.fires ?? new Map(),
    pageSize: setup.pageSize ?? 50,
    schedule: setup.schedule ?? (() => ok({ entries: kernel.entries })),
    toggle:
      setup.toggle ??
      ((req) => {
        const id = Number(req.params?.id);
        const row = kernel.triggers.find((t) => t.id === id);
        if (row === undefined) return refused(404, { error: "not_found" });
        const next = { ...row, enabled: req.path.endsWith("/on") };
        kernel.triggers = kernel.triggers.map((t) => (t.id === id ? next : t));
        return ok({ trigger: next, changed: true });
      }),
    fireRoute: (req) => {
      const all = kernel.fires.get(Number(req.params?.id)) ?? [];
      const before = req.query?.before === undefined ? Infinity : Number(req.query.before);
      const page = all.filter((f) => f.id < before).slice(0, kernel.pageSize);
      const last = page[page.length - 1];
      return ok({ fires: page, next_before: page.length === kernel.pageSize && last !== undefined ? String(last.id) : null });
    },
  };
  fake.route("GET /status", () => ok(STATUS));
  fake.route("GET /triggers", () => ok({ triggers: kernel.triggers }));
  fake.route("GET /playbooks", () => ok({ playbooks: kernel.playbooks }));
  fake.route("GET /schedule", (req) => kernel.schedule(req));
  fake.route("GET /triggers/:id/fires", (req) => kernel.fireRoute(req));
  fake.route("POST /triggers/:id/on", (req) => kernel.toggle(req));
  fake.route("POST /triggers/:id/off", (req) => kernel.toggle(req));
  return kernel;
}

/** Render the screen over `kernel` and wait until the schedule's first answer (or its failure) is on it. */
async function mount(kernel: Kernel): Promise<void> {
  render(<SchedulesScreen api={kernel.fake.bridge} registry={kernel.registry} />);
  await waitFor(() => expect(screen.queryByTestId(IDS.loading)).toBeNull());
}

async function start(setup: Setup = {}): Promise<Kernel> {
  const kernel = createKernel(setup);
  await mount(kernel);
  return kernel;
}

let nextEventId = 1;
/** A feed event of `kind` (the screen follows `kind` only). */
function emit(kernel: Kernel, kind: string): void {
  const id = nextEventId;
  nextEventId += 1;
  act(() => kernel.fake.emit({ type: "event", id, at: new Date(id * 1000).toISOString(), kind, session_id: null, task_id: null, payload: {} }));
}

const reads = (kernel: Kernel, key: string): ApiRequest[] => kernel.fake.requestsTo(key).map((r) => r.req);
const names = (testId: string): (string | null)[] => screen.getAllByTestId(testId).map((el) => el.textContent);

/** Triggers: a poll with a playbook, two cron, a once, and a disabled cron; the route's timeline in a deliberately unsorted order. */
function populated(): Setup {
  const triggers = [
    trigger(1, { playbook: "review-prs", text: "review", next_fire_at: minutes(10) }),
    trigger(2, { kind: "cron", spec: { cron: "0 9 * * 5", tz: "UTC" }, text: "Weekly changelog draft" }),
    trigger(3, { kind: "once", spec: { at: minutes(300) }, text: "Rotate the sandbox token" }),
    trigger(4, { kind: "cron", spec: { cron: "0 8 * * 1-5", tz: "UTC" }, text: "Morning digest", enabled: false, next_fire_at: null }),
  ];
  const entries = [
    entry("trigger", 3, minutes(300), { text: "Rotate the sandbox token" }),
    entry("trigger", 1, minutes(10), { playbook: "review-prs", text: "review" }),
    entry("wakeup", 5, minutes(60), { text: "PR #3 review may be ready", task_id: 7 }),
    entry("trigger", 2, minutes(900), { text: "Weekly changelog draft" }),
  ];
  return { triggers, entries, playbooks: [playbook("review-prs", "Review PRs on studio-sandbox")] };
}

/** Eleven fires of trigger 1, newest first; at a page size of 6 the "rate limited" repeat runs across the two pages. */
function history(): Map<number, TriggerFire[]> {
  return new Map([
    [
      1,
      [
        missed(11, "paused"),
        missed(10, "paused"),
        missed(9, "paused"),
        fire(8, "trigger_fired"),
        missed(7, "connector_missing"),
        missed(6, "rate_limited"),
        missed(5, "rate_limited"),
        missed(4, "playbook_not_enabled"),
        missed(3, "kill_switch"),
        missed(2, "already_done"),
        missed(1, "brand_new_code"),
      ],
    ],
  ]);
}

const withHistory = (): Setup => ({ ...populated(), fires: history(), pageSize: 6 });

// ---- The states ---------------------------------------------------------------------------------------------

describe("the states", () => {
  it("loading: four skeleton rows while the schedule has not answered, then the screen", async () => {
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    const held = new Promise<ApiResult<unknown>>((resolve) => {
      release = resolve;
    });
    const kernel = createKernel({ ...populated(), schedule: () => held });
    render(<SchedulesScreen api={kernel.fake.bridge} registry={kernel.registry} />);
    const loading = await screen.findByTestId(IDS.loading);
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.querySelectorAll(".schedules-skel")).toHaveLength(4);
    expect(within(loading).getByRole("status").textContent).toBe("Loading the schedule");
    expect(screen.queryByTestId(IDS.timeline)).toBeNull();
    release(ok({ entries: kernel.entries }));
    await screen.findByTestId(IDS.timeline);
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
  });

  it("empty: 'Nothing is scheduled.' and one action, Ask Wright to schedule something", async () => {
    await start();
    const empty = await screen.findByTestId(IDS.empty);
    expect(within(empty).getByRole("heading", { level: 2 }).textContent).toBe("Nothing is scheduled.");
    expect(empty.textContent).toContain("Studio ships none.");
    expect(within(empty).getAllByRole("button").map((b) => b.textContent)).toEqual(["Ask Wright to schedule something"]);
    expect(screen.queryByTestId(IDS.timeline)).toBeNull();
    fireEvent.click(screen.getByTestId(IDS.emptyAsk));
    expect(window.location.hash).toBe("#/chat");
  });

  it("is not 'empty' while a trigger exists, even with nothing upcoming (every trigger off)", async () => {
    await start({ triggers: [trigger(4, { enabled: false, next_fire_at: null })], entries: [] });
    await screen.findByTestId(IDS.triggers);
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.getByTestId(IDS.timelineEmpty)).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("populated: the timeline, 'Triggers · N', the open trigger's detail and its firing history; no h1 of its own", async () => {
    const { container } = render(<SchedulesScreen api={createKernel(populated()).fake.bridge} />);
    await screen.findByTestId(IDS.timeline);
    await screen.findByTestId(IDS.triggers);
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Upcoming" })).toBeTruthy();
    expect(screen.getByTestId(IDS.triggersHeading).textContent).toBe("Triggers · 4");
    expect(screen.getByTestId(IDS.summary).textContent).toBe("4 upcoming · 3 triggers on");
    expect(screen.getByRole("heading", { level: 3, name: "Firing history" })).toBeTruthy();
    expect(screen.getByTestId(IDS.detailName).textContent).toBe("Review PRs on studio-sandbox");
  });

  it("a route failure with no data: a card naming the schedule request and its status, distinct from the band; Try again reads once more", async () => {
    const kernel = await start({ ...populated(), schedule: () => refused(500, { error: "store_unreadable" }) });
    const card = await screen.findByTestId(IDS.error);
    expect(card.getAttribute("role")).toBe("alert");
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe("Couldn't load the schedule");
    expect(card.textContent).toContain("schedule request failed (500)");
    expect(screen.getByTestId(IDS.errorDetail).textContent).toBe("GET /schedule · 500 · store_unreadable");
    expect(screen.queryByRole("alert", { name: /reach the kernel/i })).toBeNull();
    kernel.schedule = () => ok({ entries: kernel.entries });
    fireEvent.click(screen.getByTestId(IDS.retry));
    await screen.findByTestId(IDS.timeline);
    expect(screen.queryByTestId(IDS.error)).toBeNull();
  });

  it("Try again hands focus to Refresh when the card it sat on is replaced by the schedule", async () => {
    const kernel = await start({ ...populated(), schedule: () => refused(500, { error: "store_unreadable" }) });
    const retry = await screen.findByTestId(IDS.retry);
    retry.focus();
    kernel.schedule = () => ok({ entries: kernel.entries });
    fireEvent.click(retry);
    await screen.findByTestId(IDS.timeline);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Refresh" }));
  });

  it("a route failure with data: the rows stay and a notice says what was not refreshed", async () => {
    const kernel = await start(populated());
    await screen.findByTestId(IDS.timeline);
    kernel.schedule = () => refused(500, { error: "store_unreadable" });
    emit(kernel, "trigger_fired");
    const notice = await screen.findByTestId(IDS.notice);
    expect(notice.textContent).toContain("GET /schedule · 500 · store_unreadable");
    expect(screen.getAllByTestId(IDS.entry)).toHaveLength(4);
    expect(screen.queryByTestId(IDS.error)).toBeNull();
  });
});

// ---- AC1: the timeline ---------------------------------------------------------------------------------------

describe("the upcoming timeline", () => {
  it("shows the entries in the order the route sent them and sorts nothing", async () => {
    await start(populated());
    await screen.findByTestId(IDS.timeline);
    expect(names(IDS.entryName)).toEqual(["Rotate the sandbox token", "Review PRs on studio-sandbox", "Wake-up #5 · task #7", "Weekly changelog draft"]);
    expect(screen.getAllByTestId(IDS.entry).map((e) => e.getAttribute("data-kind"))).toEqual(["trigger", "trigger", "wakeup", "trigger"]);
  });

  it("is a labelled list; a trigger's kind and spec come from its own row, a wake-up shows its reason", async () => {
    await start(populated());
    const list = await screen.findByRole("list", { name: "Upcoming" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    await waitFor(() => expect(names(IDS.entrySpec)[1]).toBe("poll · every 10 min · studio-sandbox"));
    const specs = names(IDS.entrySpec);
    // 300 minutes ahead may be tomorrow, so either form of the moment is right.
    expect(specs[0]).toMatch(/^once · (today |\d{1,2} [A-Z][a-z]{2} )\d\d:\d\d$/);
    expect(specs[2]).toBe("Reason: PR #3 review may be ready");
    expect(specs[3]).toBe("cron · 0 9 * * 5 · UTC");
  });

  it("has a generic icon and no spec for a trigger whose row has not loaded", async () => {
    const kernel = createKernel({ ...populated() });
    kernel.fake.route("GET /triggers", () => new Promise<never>(() => undefined));
    await mount(kernel);
    await screen.findByTestId(IDS.timeline);
    expect(names(IDS.entrySpec)[0]).toBe("");
    expect(names(IDS.entrySpec)[2]).toBe("Reason: PR #3 review may be ready");
  });
});

// ---- AC4: the trigger list and its switches --------------------------------------------------------------------

describe("the trigger list", () => {
  it("names each trigger by its playbook's name, else its text, with a switch named '<name> trigger is on|off'", async () => {
    await start(populated());
    await screen.findByTestId(IDS.triggers);
    const switches = screen.getAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-label"))).toEqual([
      "Review PRs on studio-sandbox trigger is on",
      "Weekly changelog draft trigger is on",
      "Rotate the sandbox token trigger is on",
      "Morning digest trigger is off",
    ]);
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "true", "true", "false"]);
  });

  it("a disabled trigger shows its switch off and is absent from the upcoming timeline", async () => {
    await start(populated());
    await screen.findByTestId(IDS.triggers);
    expect(screen.getByRole("switch", { name: "Morning digest trigger is off" }).getAttribute("aria-checked")).toBe("false");
    expect(names(IDS.entryName)).not.toContain("Morning digest");
  });

  it("turning a trigger off calls POST /triggers/:id/off with no body, then reads the new state", async () => {
    const kernel = await start(populated());
    await screen.findByTestId(IDS.triggers);
    fireEvent.click(screen.getByRole("switch", { name: "Weekly changelog draft trigger is on" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Weekly changelog draft trigger is off" }).getAttribute("aria-checked")).toBe("false"));
    const posts = kernel.fake.requests.filter((r) => r.req.method === "POST");
    expect(posts.map((p) => [p.req.path, p.req.params, p.req.body])).toEqual([["/triggers/:id/off", { id: 2 }, undefined]]);
    expect(reads(kernel, "GET /schedule").length).toBeGreaterThanOrEqual(2);
  });

  it("turning a trigger on calls POST /triggers/:id/on", async () => {
    const kernel = await start(populated());
    await screen.findByTestId(IDS.triggers);
    fireEvent.click(screen.getByRole("switch", { name: "Morning digest trigger is off" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Morning digest trigger is on" })).toBeTruthy());
    expect(kernel.fake.requests.filter((r) => r.req.method === "POST").map((p) => [p.req.path, p.req.params, p.req.body])).toEqual([["/triggers/:id/on", { id: 4 }, undefined]]);
  });

  it("shows a refusal as the kernel's error code in the row, never a throw", async () => {
    await start({ ...populated(), toggle: () => refused(404, { error: "not_found" }) });
    await screen.findByTestId(IDS.triggers);
    fireEvent.click(screen.getByRole("switch", { name: "Weekly changelog draft trigger is on" }));
    const error = await screen.findByTestId(IDS.rowError);
    expect(error.textContent).toBe("Couldn't turn it off: not_found");
    expect(error.getAttribute("role")).toBe("alert");
    // The switch still says what the kernel last reported.
    expect(screen.getByRole("switch", { name: "Weekly changelog draft trigger is on" }).getAttribute("aria-checked")).toBe("true");
  });

  it("a toggle the kernel could not be asked is a refusal in words", async () => {
    await start({ ...populated(), toggle: () => UNREACHABLE });
    await screen.findByTestId(IDS.triggers);
    fireEvent.click(screen.getByRole("switch", { name: "Weekly changelog draft trigger is on" }));
    expect((await screen.findByTestId(IDS.rowError)).textContent).toBe("Couldn't turn it off: the kernel could not be reached");
  });

  it("sends one request for a double click while the first is unanswered", async () => {
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    const held = new Promise<ApiResult<unknown>>((resolve) => {
      release = resolve;
    });
    const kernel = await start({ ...populated(), toggle: () => held });
    await screen.findByTestId(IDS.triggers);
    const sw = screen.getByRole("switch", { name: "Weekly changelog draft trigger is on" });
    fireEvent.click(sw);
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-busy")).toBe("true");
    expect(kernel.fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(1);
    release(ok({ trigger: kernel.triggers[1], changed: true }));
    await waitFor(() => expect(sw.getAttribute("aria-busy")).toBeNull());
  });
});

describe("the confirm for a once trigger whose time has passed", () => {
  const needsConfirm: Setup["toggle"] = (req) => {
    if ((req.body as { confirm?: unknown } | undefined)?.confirm === true) return ok({ trigger: trigger(4, { enabled: true }), changed: true });
    return refused(409, { error: "needs_confirmation", message: "this once trigger's time has passed", fires_at: new Date().toISOString() });
  };

  it("a 409 needs_confirmation opens a dialog that says it would fire at once; confirming resends with {confirm: true}", async () => {
    const kernel = await start({ ...populated(), toggle: needsConfirm });
    await screen.findByTestId(IDS.triggers);
    const sw = screen.getByRole("switch", { name: "Morning digest trigger is off" });
    sw.focus();
    fireEvent.click(sw);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("would fire it at once");
    expect(dialog.textContent).toContain("Morning digest");
    // Nothing was confirmed yet: the first request carried no body.
    expect(kernel.fake.requests.filter((r) => r.req.method === "POST").map((p) => p.req.body)).toEqual([undefined]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn on and fire now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(kernel.fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(2));
    expect(kernel.fake.requests.filter((r) => r.req.method === "POST").map((p) => [p.req.path, p.req.body])).toEqual([
      ["/triggers/:id/on", undefined],
      ["/triggers/:id/on", { confirm: true }],
    ]);
  });

  it("Escape closes it with nothing sent, and focus returns to the switch that opened it", async () => {
    const kernel = await start({ ...populated(), toggle: needsConfirm });
    await screen.findByTestId(IDS.triggers);
    const sw = screen.getByRole("switch", { name: "Morning digest trigger is off" });
    sw.focus();
    fireEvent.click(sw);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(sw));
    expect(kernel.fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(1);
  });

  it("Cancel closes it the same way", async () => {
    const kernel = await start({ ...populated(), toggle: needsConfirm });
    await screen.findByTestId(IDS.triggers);
    fireEvent.click(screen.getByRole("switch", { name: "Morning digest trigger is off" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(kernel.fake.requests.filter((r) => r.req.method === "POST")).toHaveLength(1);
  });
});

// ---- AC2, AC3: the firing history -------------------------------------------------------------------------------

describe("the firing history", () => {
  const reasons = (): (string | null)[] => screen.getAllByTestId(IDS.fireReason).map((el) => el.textContent);
  const rows = (): HTMLElement[] => screen.getAllByTestId(IDS.fire);

  it("is a captioned table of When, Trigger and Result", async () => {
    await start(withHistory());
    const table = await screen.findByRole("table", { name: "Firing history" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["When", "Trigger", "Result"]);
  });

  it("shows each missed fire's recorded reason verbatim beneath its label, newest first; a fired one has no reason line", async () => {
    await start(withHistory());
    await screen.findByTestId(IDS.table);
    expect(rows().map((r) => r.getAttribute("data-kind"))).toEqual(["trigger_missed", "trigger_fired", "trigger_missed", "trigger_missed"]);
    expect(reasons()).toEqual(["paused", "connector_missing", "rate_limited"]);
    const badges = screen.getAllByTestId(IDS.fireBadge).map((b) => b.textContent);
    expect(badges).toEqual(["missed · paused", "fired", "no connector", "rate limited"]);
  });

  it("shows a reason it does not know verbatim, with a neutral 'missed' badge", async () => {
    await start(withHistory());
    await screen.findByTestId(IDS.table);
    fireEvent.click(screen.getByTestId(IDS.loadOlder));
    await waitFor(() => expect(reasons()).toContain("brand_new_code"));
    const odd = rows().find((r) => r.getAttribute("data-reason") === "brand_new_code");
    expect(odd?.querySelector(".badge")?.textContent).toBe("missed");
    expect(odd?.querySelector(".badge")?.getAttribute("data-tone")).toBe("neutral");
    expect(within(odd as HTMLElement).getByTestId(IDS.fireReason).textContent).toBe("brand_new_code");
  });

  it("links a missed fire with no connector to Integrations, and no other row", async () => {
    await start(withHistory());
    await screen.findByTestId(IDS.table);
    const links = screen.getAllByTestId(IDS.fireLink);
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("#/integrations");
    expect(links[0]?.tagName).toBe("A");
    expect(links[0]?.closest("tr")?.getAttribute("data-reason")).toBe("connector_missing");
  });

  it("groups consecutive repeats into one row with a count and the first and last time", async () => {
    await start(withHistory());
    await screen.findByTestId(IDS.table);
    const first = rows()[0] as HTMLElement;
    expect(first.getAttribute("data-count")).toBe("3");
    expect(first.textContent).toContain("×3");
    expect(first.textContent).toContain("3 times");
    expect(first.textContent).toMatch(/poll · 3 times, .+ to .+/);
    // Eleven fires, six loaded: four rows.
    expect(rows()).toHaveLength(4);
  });

  it("'Load older' fetches the next page with next_before, continues a repeat across the pages, and goes away at the last page", async () => {
    const kernel = await start(withHistory());
    await screen.findByTestId(IDS.table);
    const rate = () => rows().find((r) => r.getAttribute("data-reason") === "rate_limited") as HTMLElement;
    expect(rate().getAttribute("data-count")).toBe("1");
    fireEvent.click(screen.getByTestId(IDS.loadOlder));
    await waitFor(() => expect(rows()).toHaveLength(8));
    expect(rate().getAttribute("data-count")).toBe("2");
    expect(reads(kernel, "GET /triggers/:id/fires").map((r) => [r.params, r.query])).toEqual([
      [{ id: 1 }, undefined],
      [{ id: 1 }, { before: "6" }],
    ]);
    expect(screen.queryByTestId(IDS.loadOlder)).toBeNull();
    expect(reasons()).toEqual(["paused", "connector_missing", "rate_limited", "playbook_not_enabled", "kill_switch", "already_done", "brand_new_code"]);
  });

  it("'Load older' unmounting at the last page hands focus to the first row it added, not to the page", async () => {
    await start(withHistory());
    await screen.findByTestId(IDS.table);
    const button = screen.getByTestId(IDS.loadOlder);
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    await waitFor(() => expect(rows()).toHaveLength(8));
    expect(screen.queryByTestId(IDS.loadOlder)).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(rows()[4]);
  });

  it("'Load older' does not move focus when the user has moved on, nor when a refetch lands", async () => {
    const kernel = await start(withHistory());
    await screen.findByTestId(IDS.table);
    const button = screen.getByTestId(IDS.loadOlder);
    button.focus();
    fireEvent.click(button);
    const chip = screen.getByTestId(IDS.filterAll);
    chip.focus();
    await waitFor(() => expect(rows()).toHaveLength(8));
    expect(document.activeElement).toBe(chip);
    emit(kernel, "trigger_fired");
    await sleep(30);
    expect(document.activeElement).toBe(chip);
  });

  it("filters to 'Not fired' with counts of the fires loaded, '+' while older pages exist", async () => {
    await start(withHistory());
    await screen.findByTestId(IDS.table);
    expect(screen.getByTestId(IDS.filterAll).textContent).toBe("All · 6+");
    expect(screen.getByTestId(IDS.filterMissed).textContent).toBe("Not fired · 5+");
    expect(screen.getByTestId(IDS.filterAll).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId(IDS.filterMissed));
    expect(screen.getByTestId(IDS.filterMissed).getAttribute("aria-pressed")).toBe("true");
    expect(rows().map((r) => r.getAttribute("data-kind"))).toEqual(["trigger_missed", "trigger_missed", "trigger_missed"]);
    fireEvent.click(screen.getByTestId(IDS.loadOlder));
    await waitFor(() => expect(screen.getByTestId(IDS.filterMissed).textContent).toBe("Not fired · 10"));
    expect(screen.getByTestId(IDS.filterAll).textContent).toBe("All · 11");
  });

  it("opens the history of the trigger chosen in the list", async () => {
    const setup = withHistory();
    setup.fires?.set(2, [missed(40, "source_error")]);
    const kernel = await start(setup);
    await screen.findByTestId(IDS.table);
    fireEvent.click(screen.getAllByTestId(IDS.select)[1] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId(IDS.detailName).textContent).toBe("Weekly changelog draft"));
    await waitFor(() => expect(reasons()).toEqual(["source_error"]));
    expect(reads(kernel, "GET /triggers/:id/fires").at(-1)?.params).toEqual({ id: 2 });
    expect(screen.getAllByTestId(IDS.select)[1]?.getAttribute("aria-current")).toBe("true");
  });

  it("says so when nothing has fired or been missed", async () => {
    await start(populated());
    expect((await screen.findByTestId(IDS.historyEmpty)).textContent).toBe("Nothing has fired or been missed yet.");
  });

  it("a history that cannot load says why and keeps the rest of the screen", async () => {
    const setup = populated();
    const kernel = createKernel(setup);
    kernel.fireRoute = () => refused(404, { error: "not_found" });
    await mount(kernel);
    const error = await screen.findByTestId(IDS.historyError);
    expect(error.textContent).toContain("GET /triggers/1/fires · 404 · not_found");
    expect(screen.getAllByTestId(IDS.entry)).toHaveLength(4);
  });
});

// ---- AC5: the kernel unreachable -------------------------------------------------------------------------------------

describe("the kernel unreachable", () => {
  it("keeps the last data, marks it last known and disables every control that needs the kernel", async () => {
    const kernel = await start(withHistory());
    await screen.findByTestId(IDS.table);
    kernel.schedule = () => UNREACHABLE;
    emit(kernel, "trigger_fired");
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("4 upcoming · 3 triggers on · last known"));
    expect(screen.getAllByTestId(IDS.entry)).toHaveLength(4);
    expect(screen.getAllByTestId(IDS.fire)).toHaveLength(4);
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    for (const sw of screen.getAllByRole("switch")) expect((sw as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(IDS.loadOlder) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);
    // The filter only changes what is shown of data held, so it stays usable.
    expect((screen.getByTestId(IDS.filterMissed) as HTMLButtonElement).disabled).toBe(false);
    // A click on a disabled switch sends nothing.
    fireEvent.click(screen.getAllByRole("switch")[0] as HTMLElement);
    expect(kernel.fake.requests.filter((r) => r.req.method === "POST")).toEqual([]);
  });

  it("recovers by itself when the next event brings an answer", async () => {
    const kernel = await start(populated());
    await screen.findByTestId(IDS.timeline);
    kernel.schedule = () => UNREACHABLE;
    emit(kernel, "trigger_fired");
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toContain("last known"));
    kernel.schedule = () => ok({ entries: kernel.entries });
    emit(kernel, "trigger_fired");
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("4 upcoming · 3 triggers on"));
    for (const sw of screen.getAllByRole("switch")) expect((sw as HTMLButtonElement).disabled).toBe(false);
  });

  it("with no data at all it says the status is unknown, never 'nothing is scheduled'", async () => {
    await start({ ...populated(), schedule: () => UNREACHABLE });
    expect(await screen.findByTestId(IDS.unknown)).toBeTruthy();
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

// ---- AC7: live updates ---------------------------------------------------------------------------------------------

describe("live updates", () => {
  it.each(["trigger_fired", "trigger_toggled", "wakeup_scheduled", "playbook_enabled"])("a %s event reads the schedule again", async (kind) => {
    const kernel = await start(populated());
    await screen.findByTestId(IDS.timeline);
    const before = reads(kernel, "GET /schedule").length;
    emit(kernel, kind);
    await waitFor(() => expect(reads(kernel, "GET /schedule").length).toBe(before + 1));
  });

  it("an event of another kind reads nothing", async () => {
    const kernel = await start(populated());
    await screen.findByTestId(IDS.timeline);
    const before = reads(kernel, "GET /schedule").length;
    emit(kernel, "session_started");
    emit(kernel, "connector_status");
    await sleep(500);
    expect(reads(kernel, "GET /schedule")).toHaveLength(before);
  });

  it("a burst of events is throttled to a read or two", async () => {
    const kernel = await start(populated());
    await screen.findByTestId(IDS.timeline);
    const before = reads(kernel, "GET /schedule").length;
    for (let i = 0; i < 6; i += 1) emit(kernel, "trigger_fired");
    await sleep(700);
    const extra = reads(kernel, "GET /schedule").length - before;
    expect(extra).toBeGreaterThanOrEqual(1);
    expect(extra).toBeLessThanOrEqual(2);
  });

  it("shows the new entry and the changed history with no loading state in between, and keeps the older pages loaded", async () => {
    const kernel = await start(withHistory());
    await screen.findByTestId(IDS.table);
    fireEvent.click(screen.getByTestId(IDS.loadOlder));
    await waitFor(() => expect(screen.getAllByTestId(IDS.fire)).toHaveLength(8));
    const before = screen.getAllByTestId(IDS.fire);
    // The route answers slowly this time: the rows on screen must stay until it does.
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    kernel.schedule = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    kernel.entries = [...kernel.entries, entry("wakeup", 9, minutes(1200), { text: "later" })];
    kernel.fires.set(1, [missed(12, "paused"), ...(kernel.fires.get(1) ?? [])]);
    emit(kernel, "trigger_missed");
    await waitFor(() => expect(reads(kernel, "GET /schedule").length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(screen.getAllByTestId(IDS.entry)).toHaveLength(4);
    release(ok({ entries: kernel.entries }));
    await waitFor(() => expect(screen.getAllByTestId(IDS.entry)).toHaveLength(5));
    expect(names(IDS.entryName).at(-1)).toBe("Wake-up #9");
    // The top group took the new fire (same row, count 4); the second page's rows are still loaded.
    await waitFor(() => expect(screen.getAllByTestId(IDS.fire)[0]?.getAttribute("data-count")).toBe("4"));
    expect(screen.getAllByTestId(IDS.fire)).toHaveLength(8);
    // Rows already shown were updated in place, not remounted.
    expect(screen.getAllByTestId(IDS.fire)[0]).toBe(before[0]);
    expect(screen.getAllByTestId(IDS.fire)[1]).toBe(before[1]);
  });
});

// ---- Untrusted text ---------------------------------------------------------------------------------------------

describe("untrusted text", () => {
  it("shows a trigger's text, a wake-up's reason and a playbook's name literally, never as markup", async () => {
    const markup = "<img src=x onerror=alert(1)>";
    const bold = "<b>loud</b>";
    const { container } = render(
      <SchedulesScreen
        api={
          createKernel({
            triggers: [trigger(1, { text: markup }), trigger(2, { playbook: "p", text: "x" })],
            playbooks: [playbook("p", bold)],
            entries: [entry("trigger", 1, minutes(5), { text: markup }), entry("wakeup", 3, minutes(9), { text: markup })],
          }).fake.bridge
        }
      />,
    );
    await screen.findByTestId(IDS.timeline);
    await screen.findByTestId(IDS.triggers);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b:not(.schedules-clip)")).toBeNull();
    expect(names(IDS.entryName)[0]).toBe(markup);
    expect(names(IDS.entrySpec)[1]).toBe(`Reason: ${markup}`);
    expect(names(IDS.select)).toEqual([markup, bold]);
    expect(screen.getByRole("switch", { name: `${markup} trigger is on` })).toBeTruthy();
  });

  it("shows a fire's reason literally", async () => {
    const markup = "<script>alert(1)</script>";
    const kernel = createKernel({ ...populated(), fires: new Map([[1, [missed(2, markup)]]]) });
    const { container } = render(<SchedulesScreen api={kernel.fake.bridge} />);
    await screen.findByTestId(IDS.table);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId(IDS.fireReason).textContent).toBe(markup);
  });
});

// ---- AC6: the keyboard and the palette ---------------------------------------------------------------------------------

describe("the keyboard", () => {
  it("every control is a real button or link", async () => {
    await start(withHistory());
    await screen.findByTestId(IDS.table);
    for (const el of [...screen.getAllByRole("switch"), ...screen.getAllByTestId(IDS.select), screen.getByTestId(IDS.filterAll), screen.getByTestId(IDS.filterMissed), screen.getByTestId(IDS.loadOlder)]) {
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("tabindex")).not.toBe("-1");
    }
    expect(screen.getByTestId(IDS.fireLink).tagName).toBe("A");
  });

  it("J and K move focus between the triggers, and stop at the ends", async () => {
    await start(populated());
    await screen.findByTestId(IDS.triggers);
    const selects = screen.getAllByTestId(IDS.select);
    selects[0]?.focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(document.activeElement).toBe(selects[1]);
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(document.activeElement).toBe(selects[3]);
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(document.activeElement).toBe(selects[2]);
    selects[0]?.focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(document.activeElement).toBe(selects[0]);
  });

  it("J and K also move from a trigger's switch to the next trigger's row", async () => {
    await start(populated());
    await screen.findByTestId(IDS.triggers);
    const selects = screen.getAllByTestId(IDS.select);
    (screen.getAllByRole("switch")[0] as HTMLElement).focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(document.activeElement).toBe(selects[1]);
  });

  it("J and K move between the history's rows, and are left alone with a modifier", async () => {
    await start(withHistory());
    await screen.findByTestId(IDS.table);
    const rows = screen.getAllByTestId(IDS.fire);
    expect(rows[0]?.getAttribute("tabindex")).toBe("0");
    expect(rows[1]?.getAttribute("tabindex")).toBe("-1");
    rows[0]?.focus();
    fireEvent.keyDown(document.activeElement as Element, { key: "j", metaKey: true });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("the link to Integrations is reached by Tab: it is a real anchor inside its row", async () => {
    await start(withHistory());
    const link = await screen.findByTestId(IDS.fireLink);
    expect(link.closest("tr")?.getAttribute("data-reason")).toBe("connector_missing");
    expect(link.getAttribute("tabindex")).toBeNull();
  });
});

describe("the ⌘K commands", () => {
  const owned = (kernel: Kernel): string[] => kernel.registry.list().filter((c) => c.owner === SCHEDULES_OWNER).map((c) => c.id);
  const command = (kernel: Kernel, id: string) => {
    const found = kernel.registry.get(id);
    if (found === undefined) throw new Error(`no command ${id}`);
    return found;
  };

  it("registers Show missed fires and Refresh schedule under owner schedules while mounted, and unregisters them on unmount", async () => {
    const kernel = await start(populated());
    expect(owned(kernel)).toEqual(["schedules.show-missed", "schedules.refresh"]);
    expect(kernel.registry.list().map((c) => c.title)).toEqual(["Show missed fires", "Refresh schedule"]);
    cleanup();
    expect(owned(kernel)).toEqual([]);
  });

  it("Show missed fires opens the history on the 'Not fired' filter", async () => {
    const kernel = await start(withHistory());
    await screen.findByTestId(IDS.table);
    expect(screen.getByTestId(IDS.filterAll).getAttribute("aria-pressed")).toBe("true");
    act(() => {
      void command(kernel, "schedules.show-missed").run();
    });
    expect(screen.getByTestId(IDS.filterMissed).getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(screen.getByTestId(IDS.filterMissed));
    expect(screen.getAllByTestId(IDS.fire).every((r) => r.getAttribute("data-kind") === "trigger_missed")).toBe(true);
  });

  it("Refresh schedule reads the schedule and the open history again, and is disabled while the kernel is unreachable", async () => {
    const kernel = await start(withHistory());
    await screen.findByTestId(IDS.table);
    const refresh = command(kernel, "schedules.refresh");
    expect(refresh.enabled?.()).toBe(true);
    const schedules = reads(kernel, "GET /schedule").length;
    const fires = reads(kernel, "GET /triggers/:id/fires").length;
    await act(async () => {
      await refresh.run();
    });
    await waitFor(() => expect(reads(kernel, "GET /schedule")).toHaveLength(schedules + 1));
    await waitFor(() => expect(reads(kernel, "GET /triggers/:id/fires")).toHaveLength(fires + 1));
    kernel.schedule = () => UNREACHABLE;
    emit(kernel, "trigger_fired");
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toContain("last known"));
    expect(command(kernel, "schedules.refresh").enabled?.()).toBe(false);
    expect(command(kernel, "schedules.show-missed").enabled?.() ?? true).toBe(true);
  });
});
