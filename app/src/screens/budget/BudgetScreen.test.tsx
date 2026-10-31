// @vitest-environment jsdom
// The Budget & audit screen (phase 7 item 07, AC2 to AC8) against a scripted bridge
// (`fake-bridge.ts`): the states (loading, empty, populated, waiting on you, a route failure,
// unreachable with and without data), the limit cells and the one dollar label, the cap windows,
// the audit log with its filters and paging, the live refetch, untrusted text shown literally,
// the keyboard and the ⌘K commands. The real kernel's routes are covered by
// `kernel/test/gui-budget-audit.test.ts`; the built app by `e2e/budget.spec.ts`.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ApiRequest, ApiResult, BudgetCapState, BudgetLimitUsage, BudgetUsageResponse, BudgetUsageRow, EventFrame, PlaybookListing, RosterEntry, StatusBody } from "../../api/contract";
import { createCommandRegistry } from "../../commands/registry";
import type { CommandRegistry } from "../../commands/registry";
import { fakeBridge, ok } from "../../store/fake-bridge";
import type { FakeBridge } from "../../store/fake-bridge";
import { BudgetScreen } from "./BudgetScreen";
import { BUDGET_OWNER } from "./commands";
import { BUDGET_TEST_IDS as IDS } from "./model";

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

// ---- A scripted kernel --------------------------------------------------------------------------------------

/** Fri 30 Oct 2026, 14:22 local time: the screen's "today". */
const NOW = new Date(2026, 9, 30, 14, 22, 0);
const NOW_DAYS = ["2026-10-30", "2026-10-29", "2026-10-28", "2026-10-27", "2026-10-26", "2026-10-25", "2026-10-24"];
const FIVE_HOUR_RESET = new Date(2026, 9, 30, 17, 0).toISOString();
const SEVEN_DAY_RESET = new Date(2026, 10, 2, 9, 0).toISOString();

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
  cap_state: [{ account: "personal subscription", provider: "subscription-token", limits: [] }],
};

const UNREACHABLE: ApiResult<unknown> = { ok: false, status: 0, connection: { state: "unreachable", reason: "daemon_not_running" } };
const refused = (status: number, body: { readonly error: string } & Record<string, unknown>): ApiResult<unknown> => ({ ok: false, status, body });
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function agent(id: string, name: string, shape: string, hue: string): RosterEntry {
  return { id, display_name: name, avatar: { shape, hue }, status: "active", created_by: null, approval_id: null, model: null, settings_error: null, tokens_today: 0, tokens_per_day: null, sessions_running: 0, sessions_at_once: null };
}

const ROSTER: RosterEntry[] = [agent("wright", "Wright", "whale", "accent"), agent("mason", "Mason", "shark", "crew-teal"), agent("ada", "Ada", "turtle", "crew-berry")];

function playbook(id: number, slug: string, name: string, owner: string, status = "enabled"): PlaybookListing {
  return {
    id,
    slug,
    name,
    owning_agent: owner,
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
  };
}

const PLAYBOOKS: PlaybookListing[] = [playbook(1, "review-prs", "Review PRs on studio-sandbox", "mason"), playbook(2, "weekly-changelog", "Weekly changelog draft", "ada", "draft")];

function row(day: string, o: Partial<BudgetUsageRow> = {}): BudgetUsageRow {
  return { day, agent: "mason", playbook: null, counted_tokens: 0, cache_read_tokens: 0, cost_estimate_usd: null, ...o };
}

function limit(id: string, o: Partial<BudgetLimitUsage> = {}): BudgetLimitUsage {
  return { scope: "agent", id, tokens_today: 0, tokens_per_day: null, sessions_running: 0, sessions_at_once: null, ...o };
}

const CAP: BudgetCapState = [
  {
    account: "subscription-token",
    provider: "subscription-token",
    limits: [
      { rate_limit_type: "five_hour", status: "allowed", resets_at: FIVE_HOUR_RESET, utilization: 0.41, reset_source: null },
      { rate_limit_type: "seven_day", status: "allowed_warning", resets_at: SEVEN_DAY_RESET, utilization: 0.83, reset_source: null },
    ],
  },
];

/** Three days of rows, two agents and the lead, with a cost on some rows; Ada is under her limit. */
function populatedUsage(): BudgetUsageResponse {
  return {
    rows: [
      row("2026-10-30", { agent: "mason", playbook: "review-prs", counted_tokens: 47844, cache_read_tokens: 1000, cost_estimate_usd: 0.5 }),
      row("2026-10-30", { agent: "wright", counted_tokens: 12380, cache_read_tokens: 204300, cost_estimate_usd: null }),
      row("2026-10-30", { agent: "ada", counted_tokens: 1700, cache_read_tokens: 0, cost_estimate_usd: 0.25 }),
      row("2026-10-29", { agent: "mason", counted_tokens: 138400, cache_read_tokens: 1488020 }),
      row("2026-10-27", { agent: "ada", counted_tokens: 96050, cache_read_tokens: 902600 }),
    ],
    limits: [
      limit("wright", { tokens_today: 12380, sessions_running: 1 }),
      limit("mason", { tokens_today: 47844, tokens_per_day: 150000, sessions_running: 1, sessions_at_once: 2 }),
      limit("ada", { tokens_today: 1700, tokens_per_day: 100000, sessions_running: 0, sessions_at_once: 2 }),
      limit("review-prs", { scope: "playbook", tokens_today: 47844, tokens_per_day: 60000 }),
      limit("weekly-changelog", { scope: "playbook", tokens_today: 0, tokens_per_day: null }),
    ],
    cap_state: CAP,
  };
}

/** Ada has used her whole daily limit. */
function waitingUsage(): BudgetUsageResponse {
  const usage = populatedUsage();
  return {
    ...usage,
    rows: usage.rows.map((r) => (r.agent === "ada" && r.day === "2026-10-30" ? { ...r, counted_tokens: 100000 } : r)),
    limits: usage.limits.map((l) => (l.id === "ada" ? { ...l, tokens_today: 100000 } : l)),
  };
}

function ev(id: number, kind: string, payload: unknown = {}, o: Partial<EventFrame> = {}): EventFrame {
  return { type: "event", id, at: new Date(2026, 9, 30, 14, 20 - (400 - id)).toISOString(), kind, session_id: null, task_id: null, payload, ...o };
}

/** 20 events, ids 400 down to 381: Mason's review events, Ada's, kernel ones that name no agent, and three refused starts. */
function auditEvents(): EventFrame[] {
  const kinds: [string, unknown][] = [
    ["memory_updated", { agent: "mason", playbook: "review-prs", text: "path: memory/mason/lessons.md" }],
    ["draft_output_recorded", { agent: "mason", playbook: "review-prs", text: "Draft review recorded for studio-sandbox #3." }],
    ["playbook_dry_run", { agent: "ada", playbook: "weekly-changelog", text: "Dry run of Weekly changelog draft v1 started" }],
    ["trigger_fired", { agent: "mason", playbook: "review-prs", text: "Poll found PR #3" }],
    ["admission_refused", { agent: "mason", reason: "agent_sessions_at_once" }],
    ["session_status", { agent: "ada", text: "Session 39 ended failed:auth." }],
    ["cap_warning", { reason: "rate_limit_type: seven_day · utilization 0.83" }],
    ["session_status", { agent: "mason", playbook: "review-prs", text: "Session 37 ended completed" }],
    ["admission_refused", { agent: "mason", reason: "agent_daily_limit" }],
    ["kill_switch_released", { text: "The kill switch was released." }],
    ["session_status", { agent: "mason", playbook: "review-prs", text: "Session 35 ended failed" }],
    ["trigger_missed", { text: "Rotate the sandbox token", reason: "kill_switch" }],
    ["playbook_updated", { agent: "mason", playbook: "review-prs", text: "v3 · priority low to normal" }],
    ["admission_refused", { agent: "ada", reason: "agent_sessions_at_once" }],
    ["playbook_updated", { agent: "ada", playbook: "weekly-changelog", text: "v2 · model sonnet to haiku" }],
    ["session_status", { agent: "mason", playbook: "review-prs", text: "Session 30 ended completed" }],
    ["playbook_updated", { agent: "mason", playbook: "review-prs", text: "v2 · intent" }],
    ["playbook_created", { agent: "mason", playbook: "review-prs", text: "v1 · Review PRs on studio-sandbox" }],
    ["task_created", { agent: "wright", text: "Pick the repos Mason reviews first" }],
    ["notify", { agent: "ada", text: "a notice" }],
  ];
  return kinds.map(([kind, payload], i) => ev(400 - i, kind, payload, i === 0 ? { task_id: 9, session_id: 41 } : {}));
}

type Answer = ApiResult<unknown> | Promise<ApiResult<unknown>>;

interface Kernel {
  readonly fake: FakeBridge;
  readonly registry: CommandRegistry;
  usage: BudgetUsageResponse;
  events: EventFrame[];
  roster: RosterEntry[];
  playbooks: PlaybookListing[];
  statusBody: StatusBody;
  usageRoute: (req: ApiRequest) => Answer;
  auditRoute: (req: ApiRequest) => Answer;
}

interface Setup {
  readonly usage?: BudgetUsageResponse;
  readonly events?: EventFrame[];
  readonly usageRoute?: Kernel["usageRoute"];
  readonly auditRoute?: Kernel["auditRoute"];
}

function createKernel(setup: Setup = {}): Kernel {
  const fake = fakeBridge();
  const kernel: Kernel = {
    fake,
    registry: createCommandRegistry(),
    usage: setup.usage ?? populatedUsage(),
    events: setup.events ?? auditEvents(),
    roster: ROSTER,
    playbooks: PLAYBOOKS,
    statusBody: STATUS,
    usageRoute: setup.usageRoute ?? (() => ok(kernel.usage)),
    // What the kernel's `GET /audit` answers for the filters this screen sends: newest first, `next_before` on a full page.
    auditRoute:
      setup.auditRoute ??
      ((req) => {
        const q = req.query ?? {};
        const size = Number(q.limit ?? 50);
        const before = q.before === undefined ? Infinity : Number(q.before);
        const payload = (e: EventFrame): { agent?: unknown; playbook?: unknown } => (typeof e.payload === "object" && e.payload !== null ? (e.payload as object) : {});
        const list = kernel.events
          .filter((e) => e.id < before)
          .filter((e) => q.kind === undefined || e.kind === q.kind)
          .filter((e) => q.agent === undefined || payload(e).agent === q.agent)
          .filter((e) => q.playbook === undefined || payload(e).playbook === q.playbook)
          .sort((a, b) => b.id - a.id);
        const page = list.slice(0, size);
        const last = page[page.length - 1];
        return ok({ events: page, next_before: page.length === size && last !== undefined ? String(last.id) : null });
      }),
  };
  fake.route("GET /status", () => ok(kernel.statusBody));
  fake.route("GET /agents", () => ok({ agents: kernel.roster }));
  fake.route("GET /playbooks", () => ok({ playbooks: kernel.playbooks }));
  fake.route("GET /budget/usage", (req) => kernel.usageRoute(req));
  fake.route("GET /audit", (req) => kernel.auditRoute(req));
  return kernel;
}

const THROTTLE = 40;

function view(kernel: Kernel) {
  return <BudgetScreen api={kernel.fake.bridge} registry={kernel.registry} now={() => NOW} liveThrottleMs={THROTTLE} />;
}

/** Render the screen over `kernel` and wait until the usage's first answer (or its failure) is on it. */
async function mount(kernel: Kernel): Promise<void> {
  render(view(kernel));
  await waitFor(() => expect(screen.queryByTestId(IDS.loading)).toBeNull());
}

async function start(setup: Setup = {}): Promise<Kernel> {
  const kernel = createKernel(setup);
  await mount(kernel);
  return kernel;
}

let nextEventId = 1000;
/** A feed event of `kind` (the screen follows the newest id only). */
function emit(kernel: Kernel, kind: string): void {
  nextEventId += 1;
  const id = nextEventId;
  act(() => kernel.fake.emit({ type: "event", id, at: new Date(id * 1000).toISOString(), kind, session_id: null, task_id: null, payload: {} }));
}

const reads = (kernel: Kernel, key: string): ApiRequest[] => kernel.fake.requestsTo(key).map((r) => r.req);
const texts = (testId: string): (string | null)[] => screen.getAllByTestId(testId).map((el) => el.textContent);

/** Click the "Audit log" button the way a user does (focused first) and wait for the log's first page. */
async function openLog(): Promise<void> {
  const button = await screen.findByTestId(IDS.auditButton);
  act(() => button.focus());
  fireEvent.click(button);
  await screen.findByTestId(IDS.table);
}

const command = (kernel: Kernel, id: string) => {
  const found = kernel.registry.get(id);
  if (found === undefined) throw new Error(`no command ${id}`);
  return found;
};

// ---- The states ---------------------------------------------------------------------------------------------

describe("the states", () => {
  it("loading: four skeleton rows while the usage has not answered, then the screen", async () => {
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    const held = new Promise<ApiResult<unknown>>((resolve) => {
      release = resolve;
    });
    const kernel = createKernel({ usageRoute: () => held });
    render(view(kernel));
    const loading = await screen.findByTestId(IDS.loading);
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.querySelectorAll(".budget-skel")).toHaveLength(4);
    expect(within(loading).getByRole("status").textContent).toBe("Loading usage");
    expect(screen.queryByTestId(IDS.dayTable)).toBeNull();
    release(ok(kernel.usage));
    await screen.findByTestId(IDS.dayTable);
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
  });

  it("empty: 'No tokens used yet.', limits named in tokens and sessions never dollars, and one action, Ask Wright", async () => {
    await start({ usage: { rows: [], limits: [limit("wright"), limit("mason", { tokens_per_day: 1000 })], cap_state: [] } });
    const empty = await screen.findByTestId(IDS.empty);
    expect(within(empty).getByRole("heading", { level: 2 }).textContent).toBe("No tokens used yet.");
    expect(empty.textContent).toContain("Limits are in tokens and sessions at once, never dollars.");
    expect(within(empty).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByTestId(IDS.auditButton)).toBeNull();
    expect(screen.queryByTestId(IDS.dayTable)).toBeNull();
    fireEvent.click(within(empty).getByRole("button", { name: "Ask Wright" }));
    expect(window.location.hash).toBe("#/chat");
  });

  it("is not empty while any limit holds tokens today", async () => {
    await start({ usage: { rows: [], limits: [limit("wright", { tokens_today: 5 })], cap_state: [] } });
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(await screen.findByTestId(IDS.dayTable)).toBeTruthy();
  });

  it("populated: every day of the window, today first, days without rows as 0; no h1 of its own", async () => {
    await start();
    const days = screen.getAllByTestId(IDS.dayRow);
    expect(days.map((d) => d.getAttribute("data-day"))).toEqual(NOW_DAYS);
    expect(days[0]?.getAttribute("data-today")).toBe("true");
    expect(days[0]?.textContent).toContain("Today · Fri 30 Oct");
    expect(days[0]?.textContent).toContain("61,924");
    expect(days[1]?.textContent).toContain("138,400");
    expect(days[2]?.textContent).toContain("Wed 28 Oct0");
    expect(within(days[3] as HTMLElement).getAllByRole("cell")[1]?.textContent).toBe("96,050");
    expect(screen.getByRole("table", { name: "Tokens counted per day" })).toBeTruthy();
    expect(within(days[0] as HTMLElement).getAllByRole("cell")[2]?.textContent).toBe("205,300");
    expect(document.querySelector("h1")).toBeNull();
    expect(screen.getByTestId(IDS.summary).textContent).toBe("61,924 tokens today");
  });

  it("each day's meter is a share of the busiest day", async () => {
    await start();
    const meters = screen.getAllByTestId(IDS.dayRow).map((d) => within(d).getByRole("img").getAttribute("aria-label"));
    expect(meters[1]).toBe("100 percent of the busiest day");
    expect(meters[0]).toBe("45 percent of the busiest day");
    expect(meters[2]).toBe("0 percent of the busiest day");
  });

  it("by agent: the display name and avatar, tokens against the daily limit, sessions at once", async () => {
    await start();
    const rows = screen.getAllByTestId(IDS.agentRow);
    expect(rows.map((r) => r.getAttribute("data-agent"))).toEqual(["wright", "mason", "ada"]);
    expect(texts(IDS.agentName)).toEqual(["Wright", "Mason", "Ada"]);
    expect(within(rows[1] as HTMLElement).getByRole("img", { name: /^Mason · / })).toBeTruthy();
    // No limit set: the bare number and 'no limit set'.
    expect(within(rows[0] as HTMLElement).getByTestId(IDS.agentLimit).textContent).toBe("12,380no limit set");
    expect(within(rows[0] as HTMLElement).getByTestId(IDS.agentSessions).textContent).toBe("1 live · no limit set");
    // A limit: 'N of L' and a labelled meter.
    expect(within(rows[1] as HTMLElement).getByTestId(IDS.agentLimit).textContent).toBe("47,844 of 150,000");
    expect(within(rows[1] as HTMLElement).getByRole("img", { name: "32 percent of the daily token limit" })).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByTestId(IDS.agentSessions).textContent).toBe("1 live of 2");
    expect(screen.getByRole("table", { name: "Tokens today by agent" })).toBeTruthy();
  });

  it("by playbook: its name, owning agent and '· off' when not enabled, tokens against its limit", async () => {
    await start();
    const rows = screen.getAllByTestId(IDS.playbookRow);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Review PRs on studio-sandbox");
    expect(rows[0]?.textContent).toContain("Mason");
    expect(within(rows[0] as HTMLElement).getByTestId(IDS.playbookLimit).textContent).toBe("47,844 of 60,000");
    expect(rows[1]?.textContent).toContain("Weekly changelog draft");
    expect(rows[1]?.textContent).toContain("Ada · off");
    expect(within(rows[1] as HTMLElement).getByTestId(IDS.playbookLimit).textContent).toBe("0no limit set");
  });

  it("falls back to the id and slug until the agents and playbooks resources answer", async () => {
    const kernel = createKernel();
    kernel.roster = [];
    kernel.playbooks = [];
    await mount(kernel);
    expect(texts(IDS.agentName)).toEqual(["wright", "mason", "ada"]);
    expect(screen.getAllByTestId(IDS.playbookRow)[0]?.textContent).toContain("review-prs");
  });

  it("a route failure with no data: a card naming the usage request and its status, distinct from the band; Try again reads once more", async () => {
    let failing = true;
    const kernel = await start({ usageRoute: () => (failing ? refused(500, { error: "store_unreadable" }) : ok(populatedUsage())) });
    const card = await screen.findByTestId(IDS.error);
    expect(card.getAttribute("role")).toBe("alert");
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toBe("Couldn't load usage");
    expect(card.textContent).toContain("usage request failed (500)");
    expect(screen.getByTestId(IDS.errorDetail).textContent).toBe("GET /budget/usage · 500 · store_unreadable");
    expect(screen.queryByTestId(IDS.dayTable)).toBeNull();
    failing = false;
    fireEvent.click(screen.getByTestId(IDS.retry));
    await screen.findByTestId(IDS.dayTable);
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(reads(kernel, "GET /budget/usage")).toHaveLength(2);
  });

  it("a route failure with data: the rows stay and a notice says what was not refreshed", async () => {
    const kernel = await start();
    kernel.usageRoute = () => refused(500, { error: "store_unreadable" });
    emit(kernel, "session_status");
    const notice = await screen.findByTestId(IDS.notice);
    expect(notice.textContent).toContain("Couldn't refresh the usage: GET /budget/usage · 500 · store_unreadable");
    expect(screen.getAllByTestId(IDS.dayRow)).toHaveLength(7);
    expect(screen.queryByTestId(IDS.error)).toBeNull();
  });

  it("kernel unreachable with no data: 'Status unknown', never 'No tokens used yet.'", async () => {
    await start({ usageRoute: () => UNREACHABLE });
    expect(await screen.findByTestId(IDS.unknown)).toBeTruthy();
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.queryByTestId(IDS.dayTable)).toBeNull();
  });
});

// ---- AC2: the limit, the band, and the one dollar figure ---------------------------------------------------------------

describe("an agent at its limit", () => {
  it("its row shows 'N of N' with an 'at limit' badge and a full meter, and the row is marked", async () => {
    await start({ usage: waitingUsage() });
    const ada = screen.getAllByTestId(IDS.agentRow).find((r) => r.getAttribute("data-agent") === "ada") as HTMLElement;
    expect(within(ada).getByTestId(IDS.agentLimit).textContent).toBe("100,000 of 100,000at limit");
    expect(within(ada).getByText("at limit").className).toBe("badge");
    expect(within(ada).getByText("at limit").getAttribute("data-tone")).toBe("attention");
    const meter = within(ada).getByRole("img", { name: "100 percent of the daily token limit" });
    expect(meter.getAttribute("data-full")).toBe("true");
    expect(ada.getAttribute("data-waiting")).toBe("true");
    // Another agent is not marked.
    expect(screen.getAllByTestId(IDS.agentRow).filter((r) => r.getAttribute("data-waiting") === "true")).toHaveLength(1);
  });

  it("the band names the agent, its figures and where to raise the limit; Open Team goes to Team", async () => {
    await start({ usage: waitingUsage() });
    const band = await screen.findByTestId(IDS.band);
    expect(band.getAttribute("role")).toBe("status");
    expect(band.textContent).toContain(
      "1 agent waits on you: Ada used 100,000 of its 100,000 tokens today, so its new sessions wait until midnight. Raise its limit in Team to continue.",
    );
    fireEvent.click(within(band).getByRole("button", { name: "Open Team" }));
    expect(window.location.hash).toBe("#/team");
  });

  it("an agent exactly at its limit counts; one token under does not", async () => {
    const usage = populatedUsage();
    await start({ usage: { ...usage, limits: usage.limits.map((l) => (l.id === "ada" ? { ...l, tokens_today: 99_999 } : l)) } });
    expect(screen.queryByTestId(IDS.band)).toBeNull();
    expect(screen.getAllByTestId(IDS.agentRow).some((r) => r.getAttribute("data-waiting") === "true")).toBe(false);
  });

  it("no band when nobody is at a limit", async () => {
    await start();
    expect(screen.queryByTestId(IDS.band)).toBeNull();
    expect(screen.queryByText("at limit")).toBeNull();
  });
});

describe("the dollar rule", () => {
  /** Every text node containing a dollar sign, with whether an ancestor inside the screen says 'at API rates'. */
  function dollarNodes(): { text: string; labelled: boolean }[] {
    const root = screen.getByTestId(IDS.screen);
    const found: { text: string; labelled: boolean }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!(node.textContent ?? "").includes("$")) continue;
      let labelled = false;
      for (let el = node.parentElement; el !== null && root.contains(el); el = el.parentElement) {
        if ((el.textContent ?? "").includes("at API rates")) labelled = true;
      }
      found.push({ text: node.textContent ?? "", labelled });
    }
    return found;
  }

  it("the only dollar figure is today's estimate, 'at API rates', and no meter or limit cell carries one", async () => {
    await start({ usage: waitingUsage() });
    const estimate = screen.getByTestId(IDS.todayEstimate);
    expect(estimate.textContent).toBe("≈$0.75 at API rates. An estimate from list prices, not a bill.");
    const nodes = dollarNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes.every((n) => n.labelled)).toBe(true);
    for (const meter of screen.getAllByRole("img")) expect(meter.getAttribute("aria-label") ?? "").not.toContain("$");
    for (const cell of [...screen.getAllByTestId(IDS.agentLimit), ...screen.getAllByTestId(IDS.playbookLimit)]) expect(cell.textContent).not.toContain("$");
  });

  it("with no estimate recorded, no dollar figure at all", async () => {
    const usage = populatedUsage();
    await start({ usage: { ...usage, rows: usage.rows.map((r) => ({ ...r, cost_estimate_usd: null })) } });
    expect(screen.queryByTestId(IDS.todayEstimate)).toBeNull();
    expect(dollarNodes()).toEqual([]);
  });

  it("today's tokens and the cache-read note: cache reads are shown, never counted", async () => {
    await start();
    expect(screen.getByTestId(IDS.todayTokens).textContent).toBe("61,924 tokens counted");
    expect(screen.getByTestId(IDS.today).textContent).toContain("Cache reads (205,300) are shown, never counted.");
  });
});

// ---- AC3: the subscription cap --------------------------------------------------------------------------------------

describe("the subscription cap", () => {
  const windows = () => screen.getAllByTestId(IDS.capWindow);

  it("each window shows its type, its status badge and 'N% used · resets <time>'", async () => {
    await start();
    expect(windows().map((w) => w.getAttribute("data-window"))).toEqual(["five_hour", "seven_day"]);
    expect(texts(IDS.capText)).toEqual(["41% used · resets today 17:00", "83% used · resets Mon 2 Nov 09:00"]);
    const badges = screen.getAllByTestId(IDS.capStatus).map((el) => el.querySelector(".badge"));
    expect(badges.map((b) => [b?.textContent, b?.getAttribute("data-tone")])).toEqual([
      ["allowed", "ok"],
      ["warning", "attention"],
    ]);
    expect(within(windows()[0] as HTMLElement).getByRole("img", { name: "41 percent of the five_hour window used" })).toBeTruthy();
    expect(screen.getByTestId(IDS.cap).textContent).toContain("No window is rejected, so nothing is parked on the cap.");
  });

  it("labels the account from the live status for the same provider", async () => {
    await start();
    await waitFor(() => expect(screen.getByTestId(IDS.cap).textContent).toContain("personal subscription"));
    expect(screen.getByTestId(IDS.cap).textContent).not.toContain("subscription-token");
  });

  it("a rejected window is a danger badge; an unknown status is shown verbatim and neutral", async () => {
    const usage = populatedUsage();
    await start({
      usage: {
        ...usage,
        cap_state: [
          {
            account: "subscription-token",
            provider: "subscription-token",
            limits: [
              { rate_limit_type: "five_hour", status: "rejected", resets_at: FIVE_HOUR_RESET, utilization: 1, reset_source: null },
              { rate_limit_type: "opus", status: "surprise", resets_at: FIVE_HOUR_RESET, utilization: 0.1, reset_source: null },
            ],
          },
        ],
      },
    });
    const badges = screen.getAllByTestId(IDS.capStatus).map((el) => el.querySelector(".badge"));
    expect(badges.map((b) => [b?.textContent, b?.getAttribute("data-tone")])).toEqual([
      ["rejected", "danger"],
      ["surprise", "neutral"],
    ]);
    expect(screen.getByTestId(IDS.cap).textContent).toContain("A window is rejected");
  });

  it("a recheck reads 'reset unknown'; no reset time and no utilization say so, with no meter for the latter", async () => {
    const usage = populatedUsage();
    await start({
      usage: {
        ...usage,
        cap_state: [
          {
            account: "subscription-token",
            provider: "subscription-token",
            limits: [
              { rate_limit_type: "five_hour", status: "allowed", resets_at: FIVE_HOUR_RESET, utilization: 0.5, reset_source: "recheck" },
              { rate_limit_type: "seven_day", status: "allowed", resets_at: null, utilization: 0.5, reset_source: null },
              { rate_limit_type: "opus", status: "allowed", resets_at: FIVE_HOUR_RESET, utilization: null, reset_source: null },
            ],
          },
        ],
      },
    });
    expect(texts(IDS.capText)).toEqual(["50% used · reset unknown · rechecked today 17:00", "50% used · no reset time", "usage not reported · resets today 17:00"]);
    expect(within(windows()[2] as HTMLElement).queryByRole("img")).toBeNull();
    expect(within(windows()[0] as HTMLElement).getByRole("img")).toBeTruthy();
  });

  it("no cap state yet says so", async () => {
    const usage = populatedUsage();
    await start({ usage: { ...usage, cap_state: [] } });
    expect(screen.getByTestId(IDS.cap).textContent).toContain("No cap state has been reported yet.");
    expect(screen.queryAllByTestId(IDS.capWindow)).toHaveLength(0);
  });
});

// ---- The latest events and the audit log ---------------------------------------------------------------------------------

describe("latest in the audit log", () => {
  it("shows the three newest events, asked with limit=3", async () => {
    const kernel = await start();
    await waitFor(() => expect(screen.getAllByTestId(IDS.latestCard)).toHaveLength(3));
    expect(screen.getAllByTestId(IDS.latestCard).map((c) => c.getAttribute("data-id"))).toEqual(["400", "399", "398"]);
    expect(screen.getAllByTestId(IDS.latestCard)[0]?.textContent).toContain("memory_updated");
    expect(screen.getAllByTestId(IDS.latestCard)[0]?.textContent).toContain("mason");
    expect(reads(kernel, "GET /audit")[0]?.query).toEqual({ limit: "3" });
  });
});

describe("the audit log", () => {
  it("opens from the toolbar button with the crumb, a captioned table and the append-only note; the shell's h1 stays the only one", async () => {
    await start();
    await openLog();
    expect(screen.getByRole("heading", { level: 2, name: "Audit log" })).toBeTruthy();
    expect(screen.getByTestId(IDS.audit).textContent).toContain("Budget & audit");
    expect(screen.getByRole("table", { name: "Audit log, newest first" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Id", "When", "Kind", "Actor", "Detail"]);
    expect(screen.getAllByTestId(IDS.auditRow)).toHaveLength(8);
    expect(screen.getAllByTestId(IDS.auditId).map((c) => c.textContent)).toEqual(["400", "399", "398", "397", "396", "395", "394", "393"]);
    expect(screen.getByTestId(IDS.audit).textContent).toContain("The log is append-only: no event can be changed or deleted.");
    expect(screen.getByRole("group", { name: "Filter the audit log" })).toBeTruthy();
    expect(document.querySelector("h1")).toBeNull();
  });

  it("Actor is the payload's agent, else '—'; Detail is the payload's text with the task, session and playbook refs", async () => {
    await start();
    await openLog();
    const actors = texts(IDS.auditActor);
    expect(actors[0]).toBe("mason");
    expect(actors[6]).toBe("—");
    const first = screen.getAllByTestId(IDS.auditRow)[0] as HTMLElement;
    expect(within(first).getByTestId(IDS.auditDetail).textContent).toBe("path: memory/mason/lessons.md");
    expect(first.textContent).toContain("task 9 · session 41 · playbook review-prs");
  });

  it("asks for a page of 8 with a 7 day since and no other filter, and shows no 'filtered' badge", async () => {
    const kernel = await start();
    await openLog();
    const query = reads(kernel, "GET /audit").at(-1)?.query ?? {};
    expect(query.limit).toBe("8");
    expect(Number.isNaN(Date.parse(query.since ?? ""))).toBe(false);
    expect(Date.now() - Date.parse(query.since ?? "")).toBeGreaterThan(6.9 * 86_400_000);
    expect(query).not.toHaveProperty("until");
    expect(query).not.toHaveProperty("kind");
    expect(screen.queryByTestId(IDS.filtered)).toBeNull();
    expect((screen.getByTestId(IDS.clear) as HTMLButtonElement).disabled).toBe(true);
  });

  it("choosing an agent and a playbook shows only the matching rows with a 'filtered' badge; Clear filters restores the log", async () => {
    const kernel = await start();
    await openLog();
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "mason" } });
    await waitFor(() => expect(screen.getAllByTestId(IDS.auditActor).every((a) => a.textContent === "mason")).toBe(true));
    expect(screen.getByTestId(IDS.filtered).textContent).toBe("filtered");
    expect((screen.getByTestId(IDS.clear) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Playbook"), { target: { value: "review-prs" } });
    await waitFor(() => {
      const query = reads(kernel, "GET /audit").at(-1)?.query ?? {};
      expect(query).toMatchObject({ agent: "mason", playbook: "review-prs" });
    });
    await waitFor(() => expect(screen.getAllByTestId(IDS.auditRow).every((r) => (r.textContent ?? "").includes("playbook review-prs"))).toBe(true));
    fireEvent.click(screen.getByTestId(IDS.clear));
    await waitFor(() => expect(screen.queryByTestId(IDS.filtered)).toBeNull());
    await waitFor(() => expect(texts(IDS.auditActor)).toContain("—"));
    expect((screen.getByLabelText("Agent") as HTMLSelectElement).value).toBe("");
    expect(document.activeElement).toBe(screen.getByLabelText("Kind"));
  });

  it("Kind offers the kinds seen so far, Agent and Playbook offer the roster and the playbooks by slug, Time range its three", async () => {
    await start();
    await openLog();
    const options = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => [o.value, o.textContent]);
    expect(options("Kind")[0]).toEqual(["", "All kinds"]);
    expect(options("Kind").map((o) => o[0])).toContain("admission_refused");
    expect(options("Agent")).toEqual([
      ["", "Any agent"],
      ["wright", "Wright"],
      ["mason", "Mason"],
      ["ada", "Ada"],
    ]);
    expect(options("Playbook")).toEqual([
      ["", "Any playbook"],
      ["review-prs", "Review PRs on studio-sandbox"],
      ["weekly-changelog", "Weekly changelog draft"],
    ]);
    expect(options("Time range")).toEqual([
      ["7d", "Last 7 days"],
      ["24h", "Last 24 hours"],
      ["1h", "Last hour"],
    ]);
  });

  it("the time range is sent as since = now minus the range", async () => {
    const kernel = await start();
    await openLog();
    fireEvent.change(screen.getByLabelText("Time range"), { target: { value: "1h" } });
    await waitFor(() => {
      const since = Date.parse(reads(kernel, "GET /audit").at(-1)?.query?.since ?? "");
      expect(Math.abs(Date.now() - 3_600_000 - since)).toBeLessThan(5_000);
    });
    expect(screen.getByTestId(IDS.filtered)).toBeTruthy();
  });

  it("no match: 'No events match.' with Clear filters", async () => {
    await start();
    await openLog();
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "admission_refused" } });
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "wright" } });
    const empty = await screen.findByTestId(IDS.auditEmpty);
    expect(within(empty).getByRole("heading", { level: 2 }).textContent).toBe("No events match.");
    expect(screen.getByTestId(IDS.footer).textContent).toBe("0 events · newest first");
    fireEvent.click(within(empty).getByRole("button", { name: "Clear filters" }));
    await screen.findByTestId(IDS.table);
  });

  it("pages Older and Newer by cursor: Older sends before=next_before, Newer pops, nothing overlaps or is skipped, the last page disables Older", async () => {
    const kernel = await start();
    await openLog();
    expect(screen.getByTestId(IDS.footer).textContent).toBe("Showing rows 1–8 · page 1 · newest first");
    expect((screen.getByTestId(IDS.newer) as HTMLButtonElement).disabled).toBe(true);
    const ids = (): string[] => texts(IDS.auditId).map(String);

    fireEvent.click(screen.getByTestId(IDS.older));
    await waitFor(() => expect(screen.getByTestId(IDS.footer).textContent).toBe("Showing rows 9–16 · page 2 · newest first"));
    expect(ids()).toEqual(["392", "391", "390", "389", "388", "387", "386", "385"]);
    expect(reads(kernel, "GET /audit").at(-1)?.query?.before).toBe("393");

    fireEvent.click(screen.getByTestId(IDS.older));
    await waitFor(() => expect(screen.getByTestId(IDS.footer).textContent).toBe("Showing rows 17–20 · page 3 · newest first"));
    expect(ids()).toEqual(["384", "383", "382", "381"]);
    expect(reads(kernel, "GET /audit").at(-1)?.query?.before).toBe("385");
    expect((screen.getByTestId(IDS.older) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId(IDS.newer));
    await waitFor(() => expect(screen.getByTestId(IDS.footer).textContent).toBe("Showing rows 9–16 · page 2 · newest first"));
    expect(reads(kernel, "GET /audit").at(-1)?.query?.before).toBe("393");
    fireEvent.click(screen.getByTestId(IDS.newer));
    await waitFor(() => expect(screen.getByTestId(IDS.footer).textContent).toBe("Showing rows 1–8 · page 1 · newest first"));
    expect(reads(kernel, "GET /audit").at(-1)?.query).not.toHaveProperty("before");
    expect((screen.getByTestId(IDS.newer) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a full last page's Older leads to an empty page that says 'No older events.', and Newer returns", async () => {
    // Exactly 8 events: the kernel sends a cursor on a full page, and the page after it is empty.
    await start({ events: auditEvents().slice(0, 8) });
    await openLog();
    fireEvent.click(screen.getByTestId(IDS.older));
    const empty = await screen.findByTestId(IDS.auditEmpty);
    expect(empty.textContent).toBe("No older events.");
    expect(screen.getByTestId(IDS.footer).textContent).toBe("0 events · newest first");
    expect((screen.getByTestId(IDS.newer) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId(IDS.newer));
    await waitFor(() => expect(screen.getAllByTestId(IDS.auditRow)).toHaveLength(8));
  });

  it("the footer never shows a total", async () => {
    await start();
    await openLog();
    expect(screen.getByTestId(IDS.footer).textContent).not.toMatch(/\bof\b/);
  });

  it("a failed read says which request, keeps the rows already shown", async () => {
    const kernel = await start();
    await openLog();
    kernel.auditRoute = () => refused(500, { error: "store_unreadable" });
    emit(kernel, "session_status");
    const notice = await screen.findByTestId(IDS.auditError);
    expect(notice.textContent).toContain("Couldn't refresh the audit log: GET /audit · 500 · store_unreadable");
    expect(screen.getAllByTestId(IDS.auditRow)).toHaveLength(8);
  });

  it("an audit failure with nothing shown names the audit request", async () => {
    await start({ auditRoute: () => refused(500, { error: "store_unreadable" }) });
    fireEvent.click(await screen.findByTestId(IDS.auditButton));
    const card = await screen.findByTestId(IDS.auditError);
    expect(card.textContent).toContain("audit request failed (500)");
    expect(card.textContent).toContain("GET /audit · 500 · store_unreadable");
  });
});

// ---- AC5: the kernel unreachable ----------------------------------------------------------------------------------------

describe("the kernel unreachable", () => {
  it("keeps the last data, marks it last known and disables Audit log, Open the full log and nothing throws", async () => {
    const kernel = await start();
    await waitFor(() => expect(screen.getAllByTestId(IDS.latestCard)).toHaveLength(3));
    kernel.usageRoute = () => UNREACHABLE;
    emit(kernel, "session_status");
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("61,924 tokens today · last known"));
    expect(screen.getAllByTestId(IDS.dayRow)).toHaveLength(7);
    expect(screen.getAllByTestId(IDS.agentRow)).toHaveLength(3);
    expect(screen.getByTestId(IDS.cap).textContent).toContain("last known");
    expect(screen.queryByTestId(IDS.empty)).toBeNull();
    expect(screen.queryByTestId(IDS.error)).toBeNull();
    expect(screen.queryByTestId(IDS.unknown)).toBeNull();
    expect((screen.getByTestId(IDS.auditButton) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(IDS.openLog) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByTestId(IDS.latestCard)).toHaveLength(3);
    const opens = reads(kernel, "GET /audit").length;
    fireEvent.click(screen.getByTestId(IDS.auditButton));
    expect(screen.queryByTestId(IDS.audit)).toBeNull();
    expect(reads(kernel, "GET /audit")).toHaveLength(opens);
  });

  it("in the audit log the filters and paging are disabled and the rows are the last read", async () => {
    const kernel = await start();
    await openLog();
    kernel.usageRoute = () => UNREACHABLE;
    kernel.auditRoute = () => UNREACHABLE;
    emit(kernel, "session_status");
    await waitFor(() => expect(screen.getByTestId(IDS.footer).textContent).toContain("last known"));
    for (const label of ["Kind", "Agent", "Playbook", "Time range"]) expect((screen.getByLabelText(label) as HTMLSelectElement).disabled, label).toBe(true);
    expect((screen.getByTestId(IDS.older) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(IDS.newer) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(IDS.clear) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByTestId(IDS.auditRow)).toHaveLength(8);
    // Back only changes the view of data held.
    expect((screen.getByTestId(IDS.back) as HTMLButtonElement).disabled).toBe(false);
  });

  it("recovers by itself when the next event brings an answer", async () => {
    const kernel = await start();
    kernel.usageRoute = () => UNREACHABLE;
    emit(kernel, "session_status");
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toContain("last known"));
    kernel.usageRoute = () => ok(kernel.usage);
    emit(kernel, "session_status");
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("61,924 tokens today"));
    expect((screen.getByTestId(IDS.auditButton) as HTMLButtonElement).disabled).toBe(false);
  });
});

// ---- AC7: live updates ------------------------------------------------------------------------------------------------------

describe("live updates", () => {
  it("a new event reads the usage and the latest events again, with no loading state, and the rows already shown are the same elements", async () => {
    const kernel = await start();
    await waitFor(() => expect(screen.getAllByTestId(IDS.latestCard)).toHaveLength(3));
    const days = screen.getAllByTestId(IDS.dayRow);
    const agents = screen.getAllByTestId(IDS.agentRow);
    const usageReads = reads(kernel, "GET /budget/usage").length;
    const auditReads = reads(kernel, "GET /audit").length;

    kernel.usage = {
      ...kernel.usage,
      rows: kernel.usage.rows.map((r) => (r.day === "2026-10-30" && r.agent === "mason" ? { ...r, counted_tokens: 60000 } : r)),
      limits: kernel.usage.limits.map((l) => (l.id === "mason" ? { ...l, tokens_today: 60000 } : l)),
    };
    kernel.events = [ev(401, "budget_limit_reached", { agent: "mason", text: "Mason reached its limit" }), ...kernel.events];
    emit(kernel, "budget_limit_reached");

    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toBe("74,080 tokens today"));
    await waitFor(() => expect(screen.getAllByTestId(IDS.latestCard)[0]?.getAttribute("data-id")).toBe("401"));
    expect(within(screen.getAllByTestId(IDS.agentRow)[1] as HTMLElement).getByTestId(IDS.agentLimit).textContent).toBe("60,000 of 150,000");
    expect(reads(kernel, "GET /budget/usage").length).toBe(usageReads + 1);
    expect(reads(kernel, "GET /audit").length).toBe(auditReads + 1);
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(screen.getAllByTestId(IDS.dayRow)[0]).toBe(days[0]);
    expect(screen.getAllByTestId(IDS.agentRow)[1]).toBe(agents[1]);
  });

  it("keeps the rows on screen while the answer is slow (no skeleton, no empty state)", async () => {
    const kernel = await start();
    let release: (value: ApiResult<unknown>) => void = () => undefined;
    kernel.usageRoute = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    emit(kernel, "session_status");
    await waitFor(() => expect(reads(kernel, "GET /budget/usage").length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId(IDS.loading)).toBeNull();
    expect(screen.getAllByTestId(IDS.dayRow)).toHaveLength(7);
    release(ok(kernel.usage));
    await sleep(20);
    expect(screen.getAllByTestId(IDS.dayRow)).toHaveLength(7);
  });

  it("a burst of events is throttled to a read or two", async () => {
    const kernel = await start();
    const before = reads(kernel, "GET /budget/usage").length;
    for (let i = 0; i < 8; i += 1) emit(kernel, "session_status");
    await sleep(THROTTLE * 5);
    const extra = reads(kernel, "GET /budget/usage").length - before;
    expect(extra).toBeGreaterThanOrEqual(1);
    expect(extra).toBeLessThanOrEqual(2);
  });

  it("the audit log's first page follows the feed; an older page does not move", async () => {
    const kernel = await start();
    await openLog();
    kernel.events = [ev(401, "budget_limit_reached", { agent: "mason", text: "new" }), ...kernel.events];
    emit(kernel, "budget_limit_reached");
    await waitFor(() => expect(texts(IDS.auditId)[0]).toBe("401"));
    expect(screen.getAllByTestId(IDS.auditRow)).toHaveLength(8);

    fireEvent.click(screen.getByTestId(IDS.older));
    await waitFor(() => expect(screen.getByTestId(IDS.footer).textContent).toContain("page 2"));
    const ids = texts(IDS.auditId);
    const auditReads = reads(kernel, "GET /audit").length;
    kernel.events = [ev(402, "budget_limit_reached", { agent: "mason", text: "newer still" }), ...kernel.events];
    emit(kernel, "budget_limit_reached");
    await sleep(THROTTLE * 4);
    expect(reads(kernel, "GET /audit")).toHaveLength(auditReads);
    expect(texts(IDS.auditId)).toEqual(ids);
  });
});

// ---- Untrusted text -------------------------------------------------------------------------------------------------------

describe("untrusted text", () => {
  const hostile = '<img src=x onerror="window.__pwned=1"><b>bold</b> & more';

  it("shows an event's payload, an agent name and a playbook name literally, never as markup", async () => {
    const kernel = createKernel({
      events: [ev(10, `kind${hostile}`, { agent: hostile, text: hostile, playbook: hostile }), ev(9, "x", { text: "a‮\u001b[31mb" })],
    });
    kernel.roster = [agent("mason", hostile, "shark", "crew-teal")];
    kernel.playbooks = [playbook(1, "review-prs", hostile, "mason")];
    await mount(kernel);
    await waitFor(() => expect(screen.getAllByTestId(IDS.latestCard)).toHaveLength(2));
    await openLog();
    const first = screen.getAllByTestId(IDS.auditRow)[0] as HTMLElement;
    expect(within(first).getByTestId(IDS.auditDetail).textContent).toBe(hostile);
    expect(within(first).getByTestId(IDS.auditActor).textContent).toBe(hostile);
    expect(within(first).getByTestId(IDS.auditKind).textContent).toBe(`kind${hostile}`);
    expect(screen.getByTestId(IDS.screen).querySelector("img[src='x']")).toBeNull();
    expect(screen.getByTestId(IDS.screen).querySelector("b")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // A control character and a bidi override are written out, not interpreted.
    expect(texts(IDS.auditDetail)[1]).toBe("a\\u202e\\x1b[31mb");
  });

  it("an unparseable payload (passed through as a string) is shown as text", async () => {
    await start({ events: [ev(10, "weird", "not json {")] });
    await openLog();
    expect(texts(IDS.auditDetail)).toEqual(["not json {"]);
    expect(texts(IDS.auditActor)).toEqual(["—"]);
  });
});

// ---- AC6: the keyboard and the ⌘K commands ---------------------------------------------------------------------------------

describe("the keyboard", () => {
  it("every control is a real button, link or select, with an accessible name", async () => {
    await start({ usage: waitingUsage() });
    await waitFor(() => expect(screen.getAllByTestId(IDS.latestCard)).toHaveLength(3));
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(expect.arrayContaining(["Audit log", "Open the full log", "Open Team"]));
    for (const button of screen.getAllByRole("button")) expect(button.getAttribute("aria-label") ?? button.textContent).toMatch(/\S/);
    for (const meter of screen.getAllByRole("img")) expect(meter.getAttribute("aria-label")).toMatch(/\S/);
    for (const badge of document.querySelectorAll(".badge")) expect(badge.textContent).toMatch(/\S/);
    for (const table of screen.getAllByRole("table")) expect(table.querySelector("caption")?.textContent).toMatch(/\S/);
  });

  it("J and K move between a table's rows, stop at the ends and are left alone with a modifier", async () => {
    await start();
    const rows = screen.getAllByTestId(IDS.dayRow);
    expect(rows[0]?.getAttribute("tabindex")).toBe("0");
    expect(rows[1]?.getAttribute("tabindex")).toBe("-1");
    act(() => rows[0]?.focus());
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "j" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1] as HTMLElement, { key: "J" });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(rows[2] as HTMLElement, { key: "k" });
    expect(document.activeElement).toBe(rows[1]);
    act(() => rows[0]?.focus());
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "k" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "j", metaKey: true });
    expect(document.activeElement).toBe(rows[0]);
    const agents = screen.getAllByTestId(IDS.agentRow);
    act(() => agents[0]?.focus());
    fireEvent.keyDown(agents[0] as HTMLElement, { key: "j" });
    expect(document.activeElement).toBe(agents[1]);
  });

  it("J and K move between the audit rows, and are not taken from a select", async () => {
    await start();
    await openLog();
    const rows = screen.getAllByTestId(IDS.auditRow);
    act(() => rows[0]?.focus());
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "j" });
    expect(document.activeElement).toBe(rows[1]);
    const select = screen.getByLabelText("Agent");
    act(() => select.focus());
    fireEvent.keyDown(select, { key: "j" });
    expect(document.activeElement).toBe(select);
  });

  it("opening the log puts focus on Back; Escape returns to the overview and focus returns to the control that opened it", async () => {
    await start();
    const opener = await screen.findByTestId(IDS.auditButton);
    act(() => opener.focus());
    fireEvent.click(opener);
    await screen.findByTestId(IDS.audit);
    expect(document.activeElement).toBe(screen.getByTestId(IDS.back));
    fireEvent.keyDown(screen.getByTestId(IDS.back), { key: "Escape" });
    await screen.findByTestId(IDS.dayTable);
    expect(screen.queryByTestId(IDS.audit)).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId(IDS.auditButton));
  });

  it("focus returns to 'Open the full log' when that opened it, and Back does the same as Escape", async () => {
    await start();
    const opener = await screen.findByTestId(IDS.openLog);
    act(() => opener.focus());
    fireEvent.click(opener);
    await screen.findByTestId(IDS.audit);
    fireEvent.click(screen.getByTestId(IDS.back));
    await screen.findByTestId(IDS.dayTable);
    expect(document.activeElement).toBe(screen.getByTestId(IDS.openLog));
  });

  it("Escape on the overview does nothing", async () => {
    await start();
    fireEvent.keyDown(screen.getByTestId(IDS.dayTable), { key: "Escape" });
    expect(screen.getByTestId(IDS.dayTable)).toBeTruthy();
  });

  it("after the last Older the focus does not fall to the page: it moves to Newer", async () => {
    await start();
    await openLog();
    const older = screen.getByTestId(IDS.older);
    act(() => older.focus());
    fireEvent.click(older);
    await waitFor(() => expect(screen.getByTestId(IDS.footer).textContent).toContain("page 2"));
    act(() => screen.getByTestId(IDS.older).focus());
    fireEvent.click(screen.getByTestId(IDS.older));
    await waitFor(() => expect(screen.getByTestId(IDS.footer).textContent).toContain("page 3"));
    expect(document.activeElement).toBe(screen.getByTestId(IDS.newer));
  });
});

describe("the ⌘K commands", () => {
  const owned = (kernel: Kernel): string[] => kernel.registry.list().filter((c) => c.owner === BUDGET_OWNER).map((c) => c.id);

  it("registers the three commands under owner budget while mounted and unregisters them on unmount", async () => {
    const kernel = await start();
    expect(owned(kernel)).toEqual(["budget.open-audit", "budget.show-refused", "budget.clear-filters"]);
    expect(kernel.registry.list().map((c) => c.title)).toEqual(["Open the audit log", "Show refused starts in the audit log", "Clear audit filters"]);
    cleanup();
    expect(owned(kernel)).toEqual([]);
  });

  it("Open the audit log opens the log", async () => {
    const kernel = await start();
    act(() => {
      void command(kernel, "budget.open-audit").run();
    });
    await screen.findByTestId(IDS.table);
    expect(screen.queryByTestId(IDS.filtered)).toBeNull();
  });

  it("Show refused starts opens the log filtered to admission_refused", async () => {
    const kernel = await start();
    act(() => {
      void command(kernel, "budget.show-refused").run();
    });
    await screen.findByTestId(IDS.table);
    await waitFor(() => expect(reads(kernel, "GET /audit").at(-1)?.query?.kind).toBe("admission_refused"));
    await waitFor(() => expect(screen.getAllByTestId(IDS.auditRow).every((r) => r.getAttribute("data-kind") === "admission_refused")).toBe(true));
    expect(screen.getByTestId(IDS.filtered)).toBeTruthy();
    expect((screen.getByLabelText("Kind") as HTMLSelectElement).value).toBe("admission_refused");
    expect(screen.getAllByTestId(IDS.auditRow)).toHaveLength(3);
  });

  it("Clear audit filters is enabled only while a filter is on, and clears it", async () => {
    const kernel = await start();
    const clear = () => command(kernel, "budget.clear-filters");
    expect(clear().enabled?.()).toBe(false);
    await openLog();
    expect(clear().enabled?.()).toBe(false);
    fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "ada" } });
    await waitFor(() => expect(clear().enabled?.()).toBe(true));
    act(() => {
      void clear().run();
    });
    await waitFor(() => expect(screen.queryByTestId(IDS.filtered)).toBeNull());
    expect(clear().enabled?.()).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText("Kind"));
  });

  it("Open the audit log and Show refused starts are disabled while the kernel is unreachable", async () => {
    const kernel = await start();
    expect(command(kernel, "budget.open-audit").enabled?.()).toBe(true);
    expect(command(kernel, "budget.show-refused").enabled?.()).toBe(true);
    kernel.usageRoute = () => UNREACHABLE;
    emit(kernel, "session_status");
    await waitFor(() => expect(screen.getByTestId(IDS.summary).textContent).toContain("last known"));
    expect(command(kernel, "budget.open-audit").enabled?.()).toBe(false);
    expect(command(kernel, "budget.show-refused").enabled?.()).toBe(false);
  });
});
