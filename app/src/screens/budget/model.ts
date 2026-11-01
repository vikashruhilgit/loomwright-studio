// Budget & audit's view model (phase 7 item 07): the pure logic behind the screen built to
// `docs/design/mockups/gui-v2.html` (`budgetScreen`, `auditScreen`). Plain TypeScript: no React,
// no DOM, and no import that reaches a `.tsx` file, so the e2e project (`tsconfig.node.json`, no
// `jsx`) can import `BUDGET_TEST_IDS` instead of copying it.
//
// Every figure here is in tokens or sessions (D24, D26). A token count is `counted_tokens`
// (input + output + cache writes); cache reads are carried beside it and never added to it. The
// one dollar figure on the screen is today's estimate, written by `formatEstimate` as
// "≈$x at API rates"; nothing in this file builds a dollar string.
//
// Every string from the kernel (an event's kind and payload, a name, a slug, a cap status) is
// untrusted data (invariant 3): it passes through `safe` (the kernel's own escaping), nothing
// here builds markup, and the components render each value as a React text child.
import type {
  AuditResponse,
  BudgetLimitUsage,
  BudgetUsageResponse,
  BudgetUsageRow,
  PlaybookListing,
  RosterEntry,
} from "../../api/contract";
import { fireTime, safe } from "../schedules/model";
import type { Tone } from "../schedules/model";
import { auditSentence } from "./audit-sentences";
import type { SentenceRefs } from "./audit-sentences";

// The reply plumbing is Schedules': one bridge answer kept apart as ok / unreachable / refused / failed.
export { NOT_READ, failureDetail, nextRead, replyOf, safe } from "../schedules/model";
export type { Read, Reply, Tone } from "../schedules/model";

/** The ids the unit tests and the e2e spec target. */
export const BUDGET_TEST_IDS = {
  screen: "screen-budget",
  summary: "budget-summary",
  notice: "budget-notice",
  loading: "budget-loading",
  empty: "budget-empty",
  emptyAsk: "budget-ask",
  error: "budget-error",
  errorDetail: "budget-error-detail",
  retry: "budget-retry",
  unknown: "budget-unknown",
  band: "budget-band",
  openTeam: "budget-open-team",
  auditButton: "budget-audit-button",
  dayTable: "budget-day-table",
  dayRow: "budget-day-row",
  agentTable: "budget-agent-table",
  agentRow: "budget-agent-row",
  agentName: "budget-agent-name",
  agentLimit: "budget-agent-limit",
  agentSessions: "budget-agent-sessions",
  playbookTable: "budget-playbook-table",
  playbookRow: "budget-playbook-row",
  playbookLimit: "budget-playbook-limit",
  latest: "budget-latest",
  latestCard: "budget-latest-card",
  openLog: "budget-open-log",
  cap: "budget-cap",
  capWindow: "budget-cap-window",
  capStatus: "budget-cap-status",
  capStale: "budget-cap-stale",
  capText: "budget-cap-text",
  today: "budget-today",
  todayTokens: "budget-today-tokens",
  todayEstimate: "budget-today-estimate",
  audit: "budget-audit",
  back: "budget-back",
  filters: "budget-filters",
  filterKind: "budget-filter-kind",
  filterAgent: "budget-filter-agent",
  filterPlaybook: "budget-filter-playbook",
  filterRange: "budget-filter-range",
  clear: "budget-clear",
  filtered: "budget-filtered",
  table: "budget-audit-table",
  auditRow: "budget-audit-row",
  auditId: "budget-audit-id",
  auditKind: "budget-audit-kind",
  auditActor: "budget-audit-actor",
  auditCount: "budget-audit-count",
  kernelBand: "budget-kernel-band",
  auditDetail: "budget-audit-detail",
  auditEmpty: "budget-audit-empty",
  auditLoading: "budget-audit-loading",
  auditError: "budget-audit-error",
  auditRetry: "budget-audit-retry",
  footer: "budget-audit-footer",
  older: "budget-older",
  newer: "budget-newer",
} as const;

/** How many days the usage table covers, today included. */
export const USAGE_DAYS = 7;
/** The audit log's page size (the mockup's `PAGE`). */
export const AUDIT_PAGE_SIZE = 8;
/** How many events "Latest in the audit log" shows. */
export const LATEST_COUNT = 3;
/** At most one live refetch per this many ms. */
export const LIVE_THROTTLE_MS = 2000;

export const TEAM_HASH = "#/team";
export const CHAT_HASH = "#/chat";

// ---- Numbers ------------------------------------------------------------------------------------------

const TOKENS = new Intl.NumberFormat("en-US");

/** A finite number, else 0: the kernel's figures are data, and a damaged one reads as nothing used. */
export function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** "61,900". */
export function formatTokens(value: number): string {
  return TOKENS.format(count(value));
}

/** The share of `limit` that `used` is, whole percent, 0 to 100; a limit of 0 (or less) is full. */
export function percentOf(used: number, limit: number): number {
  if (!(limit > 0)) return 100;
  return Math.min(100, Math.max(0, Math.round((count(used) / limit) * 100)));
}

/** One limit against today's use. At or past the limit is "at limit" (equality counts). */
export interface LimitFigure {
  readonly tokens: number;
  /** `null`: the owner never set one. */
  readonly limit: number | null;
  readonly percent: number;
  readonly atLimit: boolean;
}

export function limitFigure(tokens: number, limit: number | null): LimitFigure {
  const used = count(tokens);
  if (limit === null || !Number.isFinite(limit)) return { tokens: used, limit: null, percent: 0, atLimit: false };
  return { tokens: used, limit, percent: percentOf(used, limit), atLimit: used >= limit };
}

/** "61,900 of 100,000", or just the number when there is no limit. */
export function limitLabel(figure: LimitFigure): string {
  return figure.limit === null ? formatTokens(figure.tokens) : `${formatTokens(figure.tokens)} of ${formatTokens(figure.limit)}`;
}

export function limitMeterLabel(figure: LimitFigure): string {
  return `${figure.percent} percent of the daily token limit`;
}

/** "1 live of 2", or "1 live · no limit set". */
export function sessionsLabel(running: number, atOnce: number | null): string {
  return atOnce === null ? `${count(running)} live · no limit set` : `${count(running)} live of ${atOnce}`;
}

// ---- Days -----------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const pad = (n: number): string => String(n).padStart(2, "0");

/** The host's local day as `YYYY-MM-DD`, the kernel's own "today" (`localDay`). */
export function localDay(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The window's days, today first. Built from calendar fields so a DST change never skips or repeats a day. */
export function windowDays(now: Date, days: number = USAGE_DAYS): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) out.push(localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  return out;
}

/** "Thu 29 Oct" for a `YYYY-MM-DD`; a string that is not a day is shown as it came. */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (m === null) return safe(day);
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${WEEKDAYS[at.getDay()] ?? ""} ${at.getDate()} ${MONTHS[at.getMonth()] ?? ""}`;
}

/** One day of the window. */
export interface DayFigure {
  readonly day: string;
  /** "Today · Fri 30 Oct", else "Thu 29 Oct". */
  readonly label: string;
  readonly today: boolean;
  readonly counted: number;
  /** Shown, never counted. */
  readonly cacheReads: number;
  /** The sum of the day's estimates; `null` when none was recorded. */
  readonly cost: number | null;
}

/** Every day of the window, today first; a day with no rows is 0. Rows outside the window are ignored. */
export function daySeries(rows: readonly BudgetUsageRow[], now: Date, days: number = USAGE_DAYS): DayFigure[] {
  return windowDays(now, days).map((day, index) => {
    let counted = 0;
    let cacheReads = 0;
    let cost: number | null = null;
    for (const row of rows) {
      if (row.day !== day) continue;
      counted += count(row.counted_tokens);
      cacheReads += count(row.cache_read_tokens);
      if (typeof row.cost_estimate_usd === "number" && Number.isFinite(row.cost_estimate_usd)) cost = (cost ?? 0) + row.cost_estimate_usd;
    }
    return { day, label: index === 0 ? `Today · ${dayLabel(day)}` : dayLabel(day), today: index === 0, counted, cacheReads, cost };
  });
}

/** A day's share of the busiest day, whole percent; 0 when no day used anything. */
export function busiestShare(counted: number, busiest: number): number {
  return busiest > 0 ? Math.min(100, Math.round((count(counted) / busiest) * 100)) : 0;
}

export function busiestMeterLabel(percent: number): string {
  return `${percent} percent of the busiest day`;
}

// ---- Limits and the waiting-on-you band ---------------------------------------------------------------------

export function agentLimits(usage: Pick<BudgetUsageResponse, "limits">): BudgetLimitUsage[] {
  return usage.limits.filter((l) => l.scope === "agent");
}

export function playbookLimits(usage: Pick<BudgetUsageResponse, "limits">): BudgetLimitUsage[] {
  return usage.limits.filter((l) => l.scope === "playbook");
}

/** True when nothing was counted in the window and no limit holds tokens today: the empty state. */
export function isEmptyUsage(usage: BudgetUsageResponse): boolean {
  return usage.rows.length === 0 && usage.limits.every((l) => count(l.tokens_today) === 0);
}

/** The agents at their daily limit: their new sessions wait until midnight. */
export function waitingAgents(usage: Pick<BudgetUsageResponse, "limits">): BudgetLimitUsage[] {
  return agentLimits(usage).filter((l) => l.tokens_per_day !== null && count(l.tokens_today) >= l.tokens_per_day);
}

/** An agent's display name from the roster, else its id; both are kernel text, made inert. */
export function agentName(id: string, roster: readonly Pick<RosterEntry, "id" | "display_name">[] | undefined): string {
  const entry = roster?.find((a) => a.id === id);
  return safe(entry !== undefined && entry.display_name.trim() !== "" ? entry.display_name : id);
}

export function playbookName(slug: string, playbooks: readonly Pick<PlaybookListing, "slug" | "name">[] | undefined): string {
  const entry = playbooks?.find((p) => p.slug === slug);
  return safe(entry !== undefined && entry.name.trim() !== "" ? entry.name : slug);
}

export interface WaitingAgent {
  readonly name: string;
  readonly used: number;
  readonly limit: number;
}

/**
 * The band's words. One agent: "1 agent waits on you: Ada used 100,000 of its 100,000 tokens today, so its new sessions
 * wait until midnight. Raise its limit in Team to continue." Several: each is named with its figures.
 */
export function bandText(waiting: readonly WaitingAgent[]): string {
  const used = (w: WaitingAgent): string => `${w.name} used ${formatTokens(w.used)} of its ${formatTokens(w.limit)} tokens today`;
  const [only] = waiting;
  if (waiting.length === 1 && only !== undefined) return `1 agent waits on you: ${used(only)}, so its new sessions wait until midnight. Raise its limit in Team to continue.`;
  return `${waiting.length} agents wait on you: ${waiting.map(used).join("; ")}, so their new sessions wait until midnight. Raise their limits in Team to continue.`;
}

/** The title bar's count line: "61,900 tokens today". The screen's subtitle adds " · last known" while the kernel cannot be asked. */
export function summaryText(todayTokens: number): string {
  return `${formatTokens(todayTokens)} tokens today`;
}

// ---- The subscription cap -----------------------------------------------------------------------------------

export interface CapStatusView {
  readonly label: string;
  readonly tone: Tone;
}

/** `allowed` is ok, `allowed_warning` reads "warning", `rejected` is danger; anything else is shown verbatim, neutral. */
export function capStatusView(status: string): CapStatusView {
  if (status === "allowed") return { label: "allowed", tone: "ok" };
  if (status === "allowed_warning") return { label: "warning", tone: "attention" };
  if (status === "rejected") return { label: "rejected", tone: "danger" };
  return { label: safe(status), tone: "neutral" };
}

/**
 * The window's utilization as a whole percent, 0 to 100, or `null` when the kernel reported none. The scale is
 * unverified for the top-level field (`docs/OPEN_QUESTIONS.md` Q6 saw `unifiedWindows` as 0 to 1 fractions): it is
 * treated as a fraction, so 0.41 reads 41%.
 */
export function utilizationPercent(utilization: number | null): number | null {
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return null;
  return Math.round(Math.min(1, Math.max(0, utilization)) * 100);
}

function dateOf(iso: string | null): Date | undefined {
  if (iso === null) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

/** "today 17:00", else "Mon 2 Nov 09:00" (local time); a time that does not parse is shown as it came. */
export function resetLabel(iso: string, now: Date): string {
  const at = dateOf(iso);
  if (at === undefined) return safe(iso);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return localDay(at) === localDay(now) ? `today ${clock}` : `${WEEKDAYS[at.getDay()] ?? ""} ${at.getDate()} ${MONTHS[at.getMonth()] ?? ""} ${clock}`;
}

export function capMeterLabel(type: string, percent: number): string {
  return `${percent} percent of the ${safe(type)} window used`;
}

// ---- The audit log ---------------------------------------------------------------------------------------------

export type AuditRange = "7d" | "24h" | "1h";

export interface AuditFilter {
  readonly kind: string;
  /** An agent's id. */
  readonly agent: string;
  /** A playbook's slug. */
  readonly playbook: string;
  readonly range: AuditRange;
}

export const NO_FILTER: AuditFilter = Object.freeze({ kind: "", agent: "", playbook: "", range: "7d" });

export const RANGES: readonly { readonly value: AuditRange; readonly label: string; readonly ms: number }[] = Object.freeze([
  { value: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { value: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { value: "1h", label: "Last hour", ms: 3_600_000 },
]);

export function isAuditRange(value: string): value is AuditRange {
  return RANGES.some((r) => r.value === value);
}

/** A filter is on when anything differs from the default (the default range counts as "off"). */
export function filterActive(filter: AuditFilter): boolean {
  return filter.kind !== "" || filter.agent !== "" || filter.playbook !== "" || filter.range !== "7d";
}

/** A stable identity of a filter, so a paging state can tell which filter it belongs to. */
export function filterKey(filter: AuditFilter): string {
  return JSON.stringify([filter.kind, filter.agent, filter.playbook, filter.range]);
}

/** `GET /audit`'s query for `filter`: `since` is `nowMs` minus the range, no `until`; `before` is the cursor of an older page. */
export function auditQuery(filter: AuditFilter, limit: number, before: string | undefined, nowMs: number): Record<string, string> {
  const range = RANGES.find((r) => r.value === filter.range) ?? (RANGES[0] as (typeof RANGES)[number]);
  const query: Record<string, string> = { limit: String(limit), since: new Date(nowMs - range.ms).toISOString() };
  if (filter.kind !== "") query.kind = filter.kind;
  if (filter.agent !== "") query.agent = filter.agent;
  if (filter.playbook !== "") query.playbook = filter.playbook;
  if (before !== undefined) query.before = before;
  return query;
}

/** The overview's "Latest in the audit log": the newest events, whatever their age. */
export function latestQuery(limit: number = LATEST_COUNT): Record<string, string> {
  return { limit: String(limit) };
}

// ---- Paging (keyset cursor, with the route's counts) ------------------------------------------------------------

/**
 * The cursors that opened the pages visited, oldest first: page 1 has none (`undefined`). "Older" pushes the page's
 * `next_before`, "Newer" pops, so going back never asks the kernel to guess.
 */
export interface Paging {
  readonly cursors: readonly (string | undefined)[];
}

export const FIRST_PAGE: Paging = Object.freeze({ cursors: Object.freeze([undefined]) });

export function pageNumber(paging: Paging): number {
  return paging.cursors.length;
}

export function currentCursor(paging: Paging): string | undefined {
  return paging.cursors[paging.cursors.length - 1];
}

export function isFirstPage(paging: Paging): boolean {
  return paging.cursors.length <= 1;
}

/** The paging after "Older" with the page's `next_before`. */
export function pageOlder(paging: Paging, cursor: string): Paging {
  return { cursors: [...paging.cursors, cursor] };
}

/** The paging after "Newer": one page back, never before the first. */
export function pageNewer(paging: Paging): Paging {
  return isFirstPage(paging) ? FIRST_PAGE : { cursors: paging.cursors.slice(0, -1) };
}

/** A count the kernel sent: a non-negative whole number, else `undefined` (an older kernel sends none). */
export function countOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** The badge beside "Audit log": "20 of 20 events". `undefined` (no badge) when the kernel sent no counts. */
export function countBadge(page: Pick<Partial<AuditResponse>, "matching" | "total"> | undefined): string | undefined {
  const matching = countOf(page?.matching);
  const total = countOf(page?.total);
  if (matching === undefined || total === undefined) return undefined;
  return `${formatTokens(matching)} of ${formatTokens(total)} ${total === 1 ? "event" : "events"}`;
}

/**
 * The pager's words. With the route's `matching` count: "Showing 1–8 of 20 · page 1 of 3 · newest first" (or "0 events ·
 * newest first"). Without it (an older kernel): "Showing rows 9–16 · page 2 · newest first".
 */
export function footerText(page: number, shown: number, matching?: number, pageSize: number = AUDIT_PAGE_SIZE): string {
  if (shown <= 0) return "0 events · newest first";
  const from = (page - 1) * pageSize + 1;
  const to = from + shown - 1;
  const known = countOf(matching);
  if (known === undefined) return `Showing rows ${from}–${to} · page ${page} · newest first`;
  return `Showing ${from}–${to} of ${known} · page ${page} of ${Math.max(1, Math.ceil(known / pageSize), page)} · newest first`;
}

// ---- An event as a row -----------------------------------------------------------------------------------------

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

/**
 * Who did it, from the route's `actor`: the event's session's agent id (shown by its roster display name), "you" (the
 * owner, through the API) or "kernel". An answer with no actor (an older kernel) reads "kernel": the screen never
 * guesses an agent from the payload, and never shows "—".
 */
export function actorOf(actor: unknown, roster: readonly Pick<RosterEntry, "id" | "display_name">[] | undefined): string {
  return typeof actor === "string" && actor.trim() !== "" ? agentName(actor, roster) : "kernel";
}

/** "task 9 · session 41 · playbook review-prs": the refs an event names. A playbook given as an id is shown when the roster of playbooks resolves it to a slug. */
export function refsOf(
  event: { readonly task_id: number | null; readonly session_id: number | null; readonly payload: unknown },
  playbooks: readonly Pick<PlaybookListing, "id" | "slug">[] | undefined,
): string {
  const named = record(event.payload)?.playbook;
  let slug: string | undefined;
  if (typeof named === "string" && named.trim() !== "") slug = safe(named);
  else if (typeof named === "number") slug = playbooks?.find((p) => p.id === named)?.slug;
  const refs = [
    typeof event.task_id === "number" ? `task ${event.task_id}` : "",
    typeof event.session_id === "number" ? `session ${event.session_id}` : "",
    slug === undefined ? "" : `playbook ${safe(slug)}`,
  ];
  return refs.filter((r) => r !== "").join(" · ");
}

/** The playbooks the sentences may name: a slug or an id, with a name when the listing has one. */
export type NamedPlaybook = Pick<PlaybookListing, "id" | "slug"> & Partial<Pick<PlaybookListing, "name">>;

/** What a sentence may look up: playbook names, agent display names and times, as this screen writes them. */
export function sentenceRefs(
  event: { readonly task_id: number | null; readonly session_id: number | null },
  playbooks: readonly NamedPlaybook[] | undefined,
  roster: readonly Pick<RosterEntry, "id" | "display_name">[] | undefined,
  now: Date,
): SentenceRefs {
  return {
    taskId: event.task_id,
    sessionId: event.session_id,
    playbook: (value) => {
      const found = typeof value === "string" ? playbooks?.find((p) => p.slug === value) : typeof value === "number" ? playbooks?.find((p) => p.id === value) : undefined;
      if (found === undefined) return undefined;
      return found.name !== undefined && found.name.trim() !== "" ? found.name : found.slug;
    },
    agent: (id) => agentName(id, roster),
    time: (iso) => resetLabel(iso, now),
  };
}

/** One audit row, ready to draw. */
export interface AuditRow {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
  readonly actor: string;
  /** The Detail sentence (`./audit-sentences.ts`). */
  readonly summary: string;
  readonly refs: string;
}

function isEvent(value: unknown): value is AuditResponse["events"][number] {
  if (typeof value !== "object" || value === null) return false;
  const e = value as { id?: unknown; kind?: unknown; at?: unknown };
  return typeof e.id === "number" && Number.isSafeInteger(e.id) && typeof e.kind === "string" && typeof e.at === "string";
}

/** The page's events as rows, newest first, each id once; anything that is not an event is dropped. */
export function auditRows(
  page: Partial<AuditResponse> | undefined,
  playbooks: readonly NamedPlaybook[] | undefined,
  roster: readonly Pick<RosterEntry, "id" | "display_name">[] | undefined,
  now: Date,
): AuditRow[] {
  const listed: unknown = page?.events;
  if (!Array.isArray(listed)) return [];
  const seen = new Set<number>();
  const rows: AuditRow[] = [];
  for (const item of listed as unknown[]) {
    if (!isEvent(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    const ids = { task_id: item.task_id ?? null, session_id: item.session_id ?? null };
    rows.push({
      id: item.id,
      at: item.at,
      kind: safe(item.kind),
      actor: actorOf(item.actor, roster),
      summary: auditSentence(item.kind, item.payload, sentenceRefs(ids, playbooks, roster, now)),
      refs: refsOf({ ...ids, payload: item.payload }, playbooks),
    });
  }
  return rows.sort((a, b) => b.id - a.id);
}

/** The cursor of the next older page, or `null` when this is the last. */
export function nextCursor(page: Pick<AuditResponse, "next_before"> | undefined): string | null {
  const cursor: unknown = page?.next_before;
  return typeof cursor === "string" && cursor !== "" ? cursor : null;
}

/** The kinds in `seen`, plus `selected`, sorted: the Kind select's options. */
export function kindOptions(seen: ReadonlySet<string>, selected: string): string[] {
  const all = new Set(seen);
  if (selected !== "") all.add(selected);
  return [...all].sort();
}

/** The When column's text (`fireTime`): "14:20" today, "Thu 22:40" within the last six days, else "24 Oct 09:12". */
export function whenText(iso: string, now: Date): string {
  return fireTime(iso, now);
}

/** The id of the newest event in the feed, 0 when none. */
export function newestEventId(eventLog: readonly { readonly id: number }[]): number {
  return eventLog[eventLog.length - 1]?.id ?? 0;
}
