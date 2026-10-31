// The `gui` feature's `budget-audit` part (phase 7, item 07): the two read
// routes behind the Budget & audit screen. Mechanism only (invariant 1): the
// kernel reports what was used and what happened, and sets no policy. Every
// gui route is an owner route that needs the API token: none sets
// `unauthenticated`. Both routes are read-only: nothing is written.
//
//   GET /budget/usage[?days=]   {rows, limits, cap_state}: tokens per day, agent
//                               and playbook, every limit against today's use,
//                               and the subscription cap's windows
//   GET /audit[?kind=&agent=&playbook=&since=&until=&before=&limit=]
//                               {events, next_before}: events, newest first
//
// The shapes mirror `app/src/api/contract.ts` (`BudgetUsageResponse`,
// `AuditResponse`); `docs/architecture/budget.md` "Reading usage" is the
// reference for the semantics. Tokens are counted per D26 through the
// `budget.counted_tokens` generated column (cache reads are reported beside,
// never added). An event payload is untrusted JSON (invariant 3): it is
// returned as stored, never interpreted, and a malformed one never raises.
//
// The `cap_state` SELECT and its grouping by `account` are the ones
// `readStatus` runs in `kernel/src/api/server.ts` (the one shared text; that
// file is not edited, and a contributed route has no auth-provider list, so
// `account` carries the provider id where `GET /status` shows the label).
//
// The `studio` CLI loads it, so it imports only types, the feature seam and
// helpers that load no SDK: never the Agent SDK, the session manager or
// `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the registry's module
// graph).
import { rosterOf } from "../agents/roster.js";
import { localDay, playbookCountedTokens, playbookTokenLimit } from "../budget/internal.js";
import { eventFrameOf } from "../console/events.js";
import type { EventRow } from "../console/events.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { normalizeInstant } from "../loop/internal.js";
import { limitOf, positiveIntegerOf } from "./query.js";
import type { GuiPart } from "./types.js";

/** `GET /budget/usage`'s `days`: default and ceiling. */
const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

/** `GET /audit`'s `limit`: default and ceiling. */
const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 200;

const refusal = (error: string): ContributedRouteResponse => ({ status: 400, body: { error } });

// ---- GET /budget/usage -------------------------------------------------------------

/** One (day, agent, playbook) group, as the contract's `BudgetUsageRow`. */
interface UsageRow {
  readonly day: string;
  readonly agent: string | null;
  readonly playbook: string | null;
  readonly counted_tokens: number;
  readonly cache_read_tokens: number;
  readonly cost_estimate_usd: number | null;
}

/** One limit against today's use, as the contract's `BudgetLimitUsage`. */
interface LimitUsage {
  readonly scope: "agent" | "playbook";
  readonly id: string;
  readonly tokens_today: number;
  readonly tokens_per_day: number | null;
  readonly sessions_running: number;
  readonly sessions_at_once: number | null;
}

interface CapRow {
  readonly account: string;
  readonly rate_limit_type: string;
  readonly status: string;
  readonly resets_at: string | null;
  readonly utilization: number | null;
  readonly reset_source: string | null;
}

interface PlaybookRow {
  readonly id: number;
  readonly slug: string;
  readonly token_limit_per_day: unknown;
}

/** The local day `n` days before `at`'s, `YYYY-MM-DD` (built from a local date, so a DST change never shifts it). */
function dayBefore(at: Date, n: number): string {
  return localDay(new Date(at.getFullYear(), at.getMonth(), at.getDate() - n));
}

/**
 * The usage rows for the window. `cost_estimate_usd` is `SUM(cost_usd)`: SQLite
 * answers `NULL` when every row's is. The playbook is the slug through a LEFT
 * JOIN (`budget.playbook` holds the id as text); a value that names no
 * playbook keeps its stored text, so the day totals still equal the `budget`
 * rows. Agent and playbook `NULL`s sort first.
 */
function usageRows(req: ContributedRouteRequest, first: string, last: string): UsageRow[] {
  return req.store
    .prepare<[string, string], UsageRow>(
      `SELECT b.day AS day, b.agent AS agent, coalesce(p.slug, b.playbook) AS playbook,
              SUM(b.counted_tokens) AS counted_tokens, SUM(b.cache_read_tokens) AS cache_read_tokens,
              SUM(b.cost_usd) AS cost_estimate_usd
         FROM budget b LEFT JOIN playbooks p ON b.playbook = CAST(p.id AS TEXT)
        WHERE b.day >= ? AND b.day <= ?
        GROUP BY b.day, b.agent, b.playbook
        ORDER BY b.day DESC, b.agent, playbook`,
    )
    .all(first, last);
}

/** Every agent's limit (Wright first, then members in id order, as the roster has them), then every playbook's (id order). */
function limitsOf(req: ContributedRouteRequest, now: Date): LimitUsage[] {
  const agents = rosterOf(req.store, now).map(
    (entry): LimitUsage => ({
      scope: "agent",
      id: entry.id,
      tokens_today: entry.tokens_today,
      tokens_per_day: entry.tokens_per_day,
      sessions_running: entry.sessions_running,
      sessions_at_once: entry.sessions_at_once,
    }),
  );
  const today = localDay(now);
  const running = req.store.prepare<[number], number>("SELECT COUNT(*) FROM sessions WHERE playbook = ? AND status IN ('starting', 'running')").pluck();
  const playbooks = req.store
    .prepare<[], PlaybookRow>("SELECT id, slug, token_limit_per_day FROM playbooks ORDER BY id")
    .all()
    .map(
      (row): LimitUsage => ({
        scope: "playbook",
        id: row.slug,
        tokens_today: playbookCountedTokens(req.store, row.id, today),
        // A damaged stored limit reads as none, never a throw.
        tokens_per_day: playbookTokenLimit(row.token_limit_per_day) ?? null,
        sessions_running: running.get(row.id) ?? 0,
        sessions_at_once: null,
      }),
    );
  return [...agents, ...playbooks];
}

/** The cap windows grouped by `account` (which holds the provider id since migration 9), as `readStatus` groups them. */
function capStateOf(req: ContributedRouteRequest): { account: string; provider: string; limits: Omit<CapRow, "account">[] }[] {
  const rows = req.store
    .prepare<[], CapRow>("SELECT account, rate_limit_type, status, resets_at, utilization, reset_source FROM cap_state ORDER BY account, rate_limit_type")
    .all();
  const byKey = new Map<string, Omit<CapRow, "account">[]>();
  for (const { account: key, ...limit } of rows) {
    const list = byKey.get(key) ?? [];
    list.push(limit);
    byKey.set(key, list);
  }
  return [...byKey].map(([key, limits]) => ({ account: key, provider: key, limits }));
}

function usage(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const days = limitOf(req.query.days, DEFAULT_DAYS, MAX_DAYS);
  if (days === undefined) return Promise.resolve(refusal("invalid_days"));
  const now = req.now();
  // Today and the `days - 1` local days before it; `YYYY-MM-DD` compares as text with `budget.day`.
  const rows = usageRows(req, dayBefore(now, days - 1), localDay(now));
  return Promise.resolve({ status: 200, body: { rows, limits: limitsOf(req, now), cap_state: capStateOf(req) } });
}

// ---- GET /audit --------------------------------------------------------------------

/**
 * `GET /audit`: every filter optional, combined with AND; events newest first by id.
 *
 * - `kind`: exact match on `events.kind`.
 * - `agent`: the event's session has that agent, or the payload's `agent` key equals it.
 * - `playbook` (a slug): the event's session runs that playbook, or the payload's
 *   `playbook` key is the playbook's id or its slug. An unknown slug matches nothing.
 * - `since` / `until`: inclusive ISO-8601 instants, compared as text with `events.at`
 *   (both `%Y-%m-%dT%H:%M:%fZ`).
 * - `before`: an event id; only ids below it.
 *
 * `json_extract` raises on malformed JSON, so each payload condition is guarded
 * with `json_valid`: such a row never matches a payload condition but still
 * matches `kind` and time filters.
 */
function audit(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const { kind, agent, playbook: slug } = req.query;
  const limit = limitOf(req.query.limit, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT);
  if (limit === undefined) return Promise.resolve(refusal("invalid_limit"));
  let before: number | undefined;
  if (req.query.before !== undefined) {
    before = positiveIntegerOf(req.query.before);
    if (before === undefined) return Promise.resolve(refusal("invalid_cursor"));
  }
  let since: string | undefined;
  if (req.query.since !== undefined) {
    since = normalizeInstant(req.query.since);
    if (since === undefined) return Promise.resolve(refusal("invalid_since"));
  }
  let until: string | undefined;
  if (req.query.until !== undefined) {
    until = normalizeInstant(req.query.until);
    if (until === undefined) return Promise.resolve(refusal("invalid_until"));
  }
  if (since !== undefined && until !== undefined && since > until) return Promise.resolve(refusal("invalid_range"));

  const where: string[] = [];
  const params: (string | number)[] = [];
  if (kind !== undefined) {
    where.push("e.kind = ?");
    params.push(kind);
  }
  if (agent !== undefined) {
    where.push("(s.agent = ? OR CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json, '$.agent') END = ?)");
    params.push(agent, agent);
  }
  if (slug !== undefined) {
    const id = req.store.prepare<[string], number>("SELECT id FROM playbooks WHERE slug = ?").pluck().get(slug);
    if (id === undefined) return Promise.resolve({ status: 200, body: { events: [], next_before: null } });
    where.push("(s.playbook = ? OR CASE WHEN json_valid(e.payload_json) THEN json_extract(e.payload_json, '$.playbook') END IN (?, ?))");
    params.push(id, id, slug);
  }
  if (since !== undefined) {
    where.push("e.at >= ?");
    params.push(since);
  }
  if (until !== undefined) {
    where.push("e.at <= ?");
    params.push(until);
  }
  if (before !== undefined) {
    where.push("e.id < ?");
    params.push(before);
  }
  const rows = req.store
    .prepare<(string | number)[], EventRow>(
      `SELECT e.id AS id, e.at AS at, e.kind AS kind, e.session_id AS session_id, e.task_id AS task_id, e.payload_json AS payload_json
         FROM events e LEFT JOIN sessions s ON s.id = e.session_id
        ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`}
        ORDER BY e.id DESC LIMIT ?`,
    )
    .all(...params, limit);
  // The cursor is the last id on a full page; a short page is the last one.
  const last = rows.at(-1);
  return Promise.resolve({
    status: 200,
    body: { events: rows.map(eventFrameOf), next_before: rows.length === limit && last !== undefined ? String(last.id) : null },
  });
}

export const budgetAuditRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "GET", path: "/budget/usage", handler: usage },
  { method: "GET", path: "/audit", handler: audit },
] satisfies ContributedRoute[]);

export const budgetAuditPart: GuiPart = Object.freeze({
  name: "budget-audit",
  tools: Object.freeze([]),
  routes: budgetAuditRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
