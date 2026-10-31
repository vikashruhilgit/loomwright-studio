// Budget & audit's canned kernel data (phase 7 item 07) for `startFixtureKernel({ routes })`.
// Every body is typed by the contract.
//
// It answers the way the kernel's routes do where the screen can tell (`kernel/src/gui/budget-audit.ts`):
//   GET /budget/usage   the last `days` days of per-agent, per-playbook counted tokens (cache reads beside
//                       them, never added), each limit against today's use, and the cap state with its resets
//   GET /audit          events newest first; `kind`, `agent` (the payload's `agent`), `playbook` (the payload's
//                       slug), `since` and `before` narrow them; `next_before` is the last id of a full page
//   GET /agents         the roster the screen names agents from (and the sidebar's Crew section)
//   GET /playbooks      the playbooks it names playbooks from
//   GET /status         a canned status whose `cap_state` labels the account ("personal subscription")
// Every query a spec's screen sends is recorded in `usageReads` and `auditReads`.
//
// The state is mutable and the fixture is a script for a spec: `holdUsage` keeps the next usage read open
// (the loading state), `failUsage` answers it 500 (the route-failure card), and `liveUpdate` changes the data
// AND appends the events the kernel would (`session_status`, `budget_limit_reached`), which is how the screen
// learns. Times and days are relative to the moment the fixture is made, so "today" and "17:00 today" hold
// whenever the spec runs. The two states: `populated` (nobody at a limit), `waiting` (Ada has used her whole
// daily limit), and `empty` (nothing used, nothing logged).
//
// Every value here is fixture data: no real repo, account or task.
import type { AuditResponse, BudgetLimitUsage, BudgetUsageResponse, BudgetUsageRow, EventFrame, PlaybookListing, RosterEntry, RouteKey } from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernel, FixtureKernelOptions, FixtureRequest, FixtureRoute } from "../fixture-kernel";
import { cannedStatus } from "../fixture-kernel";

const MINUTE = 60_000;

/** The audit log's page size the screen asks for; the fixture's 20 events take three pages. */
export const AUDIT_PAGE = 8;

export type BudgetState = "populated" | "waiting" | "empty";

export interface BudgetFixtureOptions {
  /** Default `populated`. */
  readonly state?: BudgetState;
}

export interface BudgetFixture {
  /** Pass to `startFixtureKernel`. */
  readonly options: FixtureKernelOptions;
  /** Every `GET /budget/usage` query the kernel received, in order. */
  readonly usageReads: Readonly<Record<string, string>>[];
  /** Every `GET /audit` query the kernel received, in order. */
  readonly auditReads: Readonly<Record<string, string>>[];
  /** Give the routes the started kernel, so they can append events. */
  attach(kernel: FixtureKernel): void;
  /** The next `GET /budget/usage` is not answered until `releaseUsage`: the screen shows its loading state. */
  holdUsage(): void;
  releaseUsage(): void;
  /** `GET /budget/usage` answers `500 {"error": "store_unreadable"}` from now on (`false`: it answers normally again). */
  failUsage(failing: boolean): void;
  /**
   * A session of Mason's ends (+4,456 counted tokens today, a new `session_status` row at the top of the log) and
   * the meter records that Ada's limit is reached (a `budget_limit_reached` event). Both events reach the feed.
   */
  liveUpdate(): void;
  /** Today's counted tokens (a copy of the current rows' sum). */
  todayTokens(): number;
}

const AT = "2026-10-21T09:00:00.000Z";

function entry(id: string, name: string, shape: string, hue: string, o: Partial<RosterEntry>): RosterEntry {
  return { id, display_name: name, avatar: { shape, hue }, status: "active", created_by: id === "wright" ? null : "owner", approval_id: null, model: null, settings_error: null, tokens_today: 0, tokens_per_day: null, sessions_running: 0, sessions_at_once: null, ...o };
}

const ROSTER: RosterEntry[] = [
  entry("wright", "Wright", "whale", "accent", { tokens_today: 12_380, sessions_running: 1 }),
  entry("mason", "Mason", "shark", "crew-teal", { tokens_today: 47_844, tokens_per_day: 150_000, sessions_running: 1, sessions_at_once: 2 }),
  entry("ada", "Ada", "turtle", "crew-berry", { tokens_today: 61_900, tokens_per_day: 100_000, sessions_running: 1, sessions_at_once: 2 }),
];

function playbook(id: number, slug: string, name: string, owner: string, status: string): PlaybookListing {
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
    created_at: AT,
    updated_at: AT,
    mode: "draft",
    mode_set_by: null,
    trigger_id: null,
    next_fire_at: null,
  };
}

const PLAYBOOKS: PlaybookListing[] = [
  playbook(1, "review-prs", "Review PRs on studio-sandbox", "mason", "enabled"),
  playbook(2, "weekly-changelog", "Weekly changelog draft", "ada", "draft"),
  playbook(3, "morning-digest", "Morning digest", "wright", "enabled"),
];

const pad = (n: number): string => String(n).padStart(2, "0");

/** The host's local day `daysAgo` days back, as `YYYY-MM-DD` (what the kernel's `localDay` gives). */
function dayOf(daysAgo: number): string {
  const d = new Date();
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function usageRow(daysAgo: number, agent: string | null, playbookSlug: string | null, counted: number, cacheReads: number, cost: number | null): BudgetUsageRow {
  return { day: dayOf(daysAgo), agent, playbook: playbookSlug, counted_tokens: counted, cache_read_tokens: cacheReads, cost_estimate_usd: cost };
}

/** Seven days in the mockup's proportions: a quiet Sunday, a busy Wednesday, and today's three agents. */
function makeRows(state: BudgetState, adaFull: boolean): BudgetUsageRow[] {
  if (state === "empty") return [];
  return [
    usageRow(0, "mason", "review-prs", 47_844, 904_300, 0.39),
    usageRow(0, "wright", null, 12_380, 300_000, null),
    usageRow(0, "ada", "weekly-changelog", adaFull ? 100_000 : 61_900, 0, 0.5),
    usageRow(1, "mason", "review-prs", 98_400, 1_000_000, 0.8),
    usageRow(1, "wright", null, 40_000, 488_020, null),
    usageRow(2, "ada", "weekly-changelog", 171_200, 1_760_410, 1.4),
    usageRow(3, "mason", "review-prs", 96_050, 902_600, 0.7),
    usageRow(4, "wright", null, 54_300, 410_880, null),
    usageRow(6, "ada", null, 18_900, 120_300, 0.15),
  ];
}

function limit(scope: BudgetLimitUsage["scope"], id: string, today: number, perDay: number | null, running: number, atOnce: number | null): BudgetLimitUsage {
  return { scope, id, tokens_today: today, tokens_per_day: perDay, sessions_running: running, sessions_at_once: atOnce };
}

const todayOf = (rows: readonly BudgetUsageRow[], agent: string | null, pb?: string): number =>
  rows.filter((r) => r.day === dayOf(0) && (pb === undefined ? r.agent === agent : r.playbook === pb)).reduce((n, r) => n + r.counted_tokens, 0);

function makeLimits(state: BudgetState, rows: readonly BudgetUsageRow[]): BudgetLimitUsage[] {
  const empty = state === "empty";
  return [
    limit("agent", "wright", todayOf(rows, "wright"), null, empty ? 0 : 1, null),
    limit("agent", "mason", todayOf(rows, "mason"), 150_000, empty ? 0 : 1, 2),
    limit("agent", "ada", todayOf(rows, "ada"), 100_000, empty ? 0 : 1, 2),
    limit("playbook", "review-prs", todayOf(rows, null, "review-prs"), 60_000, 0, null),
    limit("playbook", "weekly-changelog", todayOf(rows, null, "weekly-changelog"), null, 0, null),
    limit("playbook", "morning-digest", 0, null, 0, null),
  ];
}

/** Two windows of the mockup's `budget-populated`: the five-hour one resets at 17:00 today, the seven-day one in three days at 09:00. */
function makeCap(state: BudgetState): BudgetUsageResponse["cap_state"] {
  if (state === "empty") return [];
  const now = new Date();
  return [
    {
      account: "subscription-token",
      provider: "subscription-token",
      limits: [
        { rate_limit_type: "five_hour", status: "allowed", resets_at: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0).toISOString(), utilization: 0.41, reset_source: null },
        { rate_limit_type: "seven_day", status: "allowed_warning", resets_at: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 9, 0).toISOString(), utilization: 0.83, reset_source: null },
      ],
    },
  ];
}

/** The first audit id; the log holds 20 events, ids 381 to 400, and a live one is 401. */
const FIRST_ID = 400;

function makeEvents(state: BudgetState): EventFrame[] {
  if (state === "empty") return [];
  const rows: [string, Record<string, unknown>, Partial<EventFrame>?][] = [
    ["memory_updated", { agent: "mason", playbook: "review-prs", text: "path: memory/mason/lessons.md" }, { session_id: 41 }],
    ["draft_output_recorded", { agent: "mason", playbook: "review-prs", text: "Draft review recorded for studio-sandbox #3. Recorded, not sent." }, { task_id: 9, session_id: 41 }],
    ["playbook_dry_run", { agent: "ada", playbook: "weekly-changelog", text: "Dry run of Weekly changelog draft v1 started" }, { session_id: 42 }],
    ["trigger_fired", { agent: "mason", playbook: "review-prs", text: "Poll found PR #3 · dedupe studio-sandbox#3@a1b2c3d" }],
    ["wakeup_scheduled", { agent: "mason", text: "Wake-up #5 due 15:30: PR #3 review may be ready" }, { task_id: 7 }],
    ["session_status", { agent: "ada", text: "Session 39 ended failed:auth. Parked, not retried." }, { session_id: 39 }],
    ["task_created", { agent: "wright", text: "Pick the repos Mason reviews first · state waiting" }, { task_id: 12 }],
    ["session_status", { agent: "mason", playbook: "review-prs", text: "Session 37 ended completed · playbook run 17 · 31,870 tokens" }, { session_id: 37 }],
    ["session_status", { text: "Session 38 interrupted: the kernel that ran it restarted" }, { session_id: 38 }],
    ["session_status", { agent: "mason", playbook: "review-prs", text: "Session 35 ended failed · playbook run 16 · 2,104 tokens" }, { session_id: 35 }],
    ["admission_refused", { agent: "mason", reason: "agent_sessions_at_once · live 2 of 2 · retry in 60 s" }],
    ["cap_warning", { reason: "rate_limit_type: seven_day · utilization 0.83" }],
    ["kill_switch_released", { text: "The kill switch was released. The event loop restarted." }],
    ["trigger_missed", { text: "Rotate the sandbox token", reason: "kill_switch" }],
    ["kill_switch_engaged", { text: "Every session was stopped. No trigger fires while it is on." }],
    ["playbook_updated", { agent: "mason", playbook: "review-prs", text: "v3 · priority low to normal, token_limit_per_day 150000 to 200000" }],
    ["playbook_updated", { agent: "wright", playbook: "morning-digest", text: "v2 · model sonnet to haiku" }],
    ["session_status", { agent: "wright", playbook: "morning-digest", text: "Session 30 ended completed · playbook run 15 · 6,120 tokens" }, { session_id: 30 }],
    ["playbook_updated", { agent: "mason", playbook: "review-prs", text: "v2 · intent, model haiku to sonnet" }],
    ["playbook_created", { agent: "mason", playbook: "review-prs", text: "v1 · Review PRs on studio-sandbox" }],
  ];
  return rows.map(([kind, payload, extra], i) => ({
    type: "event" as const,
    id: FIRST_ID - i,
    at: new Date(Date.now() - (i * 11 + 2) * MINUTE).toISOString(),
    kind,
    session_id: null,
    task_id: null,
    payload,
    ...extra,
  }));
}

export function budgetFixture(options: BudgetFixtureOptions = {}): BudgetFixture {
  const state = options.state ?? "populated";
  let rows = makeRows(state, state === "waiting");
  let events = makeEvents(state);
  const usageReads: Record<string, string>[] = [];
  const auditReads: Record<string, string>[] = [];
  let kernel: FixtureKernel | undefined;
  let hold: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let failing = false;

  const usage = async (req: FixtureRequest): Promise<FixtureAnswer> => {
    usageReads.push({ ...req.query });
    if (hold !== undefined) await hold;
    if (failing) return { status: 500, body: { error: "store_unreadable" } };
    const days = Number(req.query.days ?? 7);
    const oldest = dayOf(days - 1);
    const inWindow = rows.filter((r) => r.day >= oldest);
    return { status: 200, body: { rows: inWindow, limits: makeLimits(state, rows), cap_state: makeCap(state) } satisfies BudgetUsageResponse };
  };

  const payloadOf = (e: EventFrame): { agent?: unknown; playbook?: unknown } => (typeof e.payload === "object" && e.payload !== null ? (e.payload as { agent?: unknown; playbook?: unknown }) : {});

  const audit = (req: FixtureRequest): FixtureAnswer => {
    auditReads.push({ ...req.query });
    const q = req.query;
    const size = Number(q.limit ?? 50);
    const before = q.before === undefined ? Infinity : Number(q.before);
    const since = q.since === undefined ? -Infinity : Date.parse(q.since);
    const list = events
      .filter((e) => e.id < before && Date.parse(e.at) >= since)
      .filter((e) => q.kind === undefined || e.kind === q.kind)
      .filter((e) => q.agent === undefined || payloadOf(e).agent === q.agent)
      .filter((e) => q.playbook === undefined || payloadOf(e).playbook === q.playbook)
      .sort((a, b) => b.id - a.id);
    const page = list.slice(0, size);
    const last = page[page.length - 1];
    return { status: 200, body: { events: page, next_before: page.length === size && last !== undefined ? String(last.id) : null } satisfies AuditResponse };
  };

  const routes: Partial<Record<RouteKey, FixtureRoute>> = {
    "GET /status": () => ({ status: 200, body: cannedStatus({ cap_state: [{ account: "personal subscription", provider: "subscription-token", limits: [] }] }) }),
    "GET /budget/usage": usage,
    "GET /audit": audit,
    "GET /agents": () => ({ status: 200, body: { agents: ROSTER } }),
    "GET /playbooks": () => ({ status: 200, body: { playbooks: PLAYBOOKS } }),
    "GET /approvals": () => ({ status: 200, body: { approvals: [] } }),
    "GET /messages": () => ({ status: 200, body: { messages: [] } }),
    "GET /notifications": () => ({ status: 200, body: { notifications: [] } }),
  };

  const append = (event: EventFrame): void => {
    events = [event, ...events];
    kernel?.appendEvent(event);
  };

  return {
    options: { routes },
    usageReads,
    auditReads,
    attach(started) {
      kernel = started;
    },
    holdUsage() {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseUsage() {
      release?.();
      hold = undefined;
      release = undefined;
    },
    failUsage(value) {
      failing = value;
    },
    liveUpdate() {
      const now = new Date().toISOString();
      rows = rows.map((r) => (r.day === dayOf(0) && r.agent === "mason" ? { ...r, counted_tokens: r.counted_tokens + 4_456, cache_read_tokens: r.cache_read_tokens + 120_000 } : r));
      // The rows change first, so the screen's read after the first event already sees both.
      append({ type: "event", id: FIRST_ID + 1, at: now, kind: "session_status", session_id: 44, task_id: null, payload: { agent: "mason", playbook: "review-prs", text: "Session 44 ended completed · playbook run 18 · 4,456 tokens" } });
      append({ type: "event", id: FIRST_ID + 2, at: now, kind: "budget_limit_reached", session_id: null, task_id: null, payload: { agent: "ada", text: "ada reached its daily token limit of 100,000" } });
    },
    todayTokens: () => rows.filter((r) => r.day === dayOf(0)).reduce((n, r) => n + r.counted_tokens, 0),
  };
}
