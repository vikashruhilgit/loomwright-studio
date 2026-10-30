// The `gui` feature's `schedules` part (phase 7, item 05): the two read routes
// the Schedules & triggers screen calls. Mechanism only (invariant 1): the
// kernel reports what is scheduled and what happened, and sets no policy.
// Every gui route is an owner route that needs the API token: none sets
// `unauthenticated`. Both routes are read-only: nothing is written.
//
//   GET /schedule?limit=                 {entries: [...]}: enabled triggers' next fires and pending wake-ups, soonest first
//   GET /triggers/:id/fires?before=&limit=  {fires: [...], next_before}: a trigger's fired and missed events, newest first
//
// The shapes mirror `app/src/api/contract.ts` (`ScheduleEntry`, `TriggerFire`,
// `TriggerFiresResponse`). Event payloads are untrusted JSON: a row whose
// payload does not parse is skipped, never a throw.
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { getTrigger } from "../triggers/store.js";
import type { GuiPart } from "./types.js";

const ID = /^[1-9]\d*$/;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** A whole number from 1 to `MAX_LIMIT`, or `DEFAULT_LIMIT` when absent; `undefined` when it is anything else. */
function limitOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  return ID.test(raw) && Number.isSafeInteger(n) && n <= MAX_LIMIT ? n : undefined;
}

interface TriggerEntryRow {
  readonly id: number;
  readonly next_fire_at: string;
  readonly owning_agent: string;
  readonly playbook: string | null;
  readonly action: string;
  readonly action_payload: string;
}

interface WakeupEntryRow {
  readonly id: number;
  readonly due_at: string;
  readonly reason: string;
  readonly task_id: number | null;
}

interface ScheduleEntryOut {
  readonly kind: "trigger" | "wakeup";
  readonly id: number;
  readonly at: string;
  readonly agent: string | null;
  readonly playbook: string | null;
  readonly action: string | null;
  readonly text: string;
  readonly task_id: number | null;
}

/** Earlier instant first; an instant that does not parse falls back to text order. */
function compareAt(a: string, b: string): number {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (Number.isNaN(x) || Number.isNaN(y) || x === y) return a < b ? -1 : a > b ? 1 : 0;
  return x - y;
}

async function schedule(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const limit = limitOf(req.query.limit);
  if (limit === undefined) return { status: 400, body: { error: "invalid_limit" } };
  // Each source is cut to `limit` in its own order first: the merged first `limit` entries can only come from there.
  const triggers = req.store
    .prepare<[number], TriggerEntryRow>(
      `SELECT id, next_fire_at, owning_agent, playbook, action, action_payload FROM triggers
        WHERE enabled = 1 AND next_fire_at IS NOT NULL
        ORDER BY next_fire_at ASC, id ASC LIMIT ?`,
    )
    .all(limit);
  const wakeups = req.store
    .prepare<[number], WakeupEntryRow>(
      `SELECT id, due_at, reason, task_id FROM wakeups
        WHERE status = 'pending'
        ORDER BY due_at ASC, id ASC LIMIT ?`,
    )
    .all(limit);
  const entries: ScheduleEntryOut[] = [
    ...triggers.map((t): ScheduleEntryOut => ({ kind: "trigger", id: t.id, at: t.next_fire_at, agent: t.owning_agent, playbook: t.playbook, action: t.action, text: t.action_payload, task_id: null })),
    ...wakeups.map((w): ScheduleEntryOut => ({ kind: "wakeup", id: w.id, at: w.due_at, agent: null, playbook: null, action: null, text: w.reason, task_id: w.task_id })),
  ];
  // By time, then trigger before wake-up, then id.
  entries.sort((a, b) => compareAt(a.at, b.at) || (a.kind === b.kind ? 0 : a.kind === "trigger" ? -1 : 1) || a.id - b.id);
  return { status: 200, body: { entries: entries.slice(0, limit) } };
}

interface FireRow {
  readonly id: number;
  readonly at: string;
  readonly kind: "trigger_fired" | "trigger_missed";
  readonly session_id: number | null;
  readonly payload_json: string | null;
}

/** The payload as an object, or `undefined` when it is missing, not JSON, or not an object. */
function payloadOf(json: string | null): Record<string, unknown> | undefined {
  if (json === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

async function fires(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const raw = req.params.id ?? "";
  const id = Number(raw);
  if (!ID.test(raw) || !Number.isSafeInteger(id)) return { status: 400, body: { error: "invalid_id" } };
  if (getTrigger(req.store, id) === undefined) return { status: 404, body: { error: "not_found" } };
  let before: number | undefined;
  if (req.query.before !== undefined) {
    const n = Number(req.query.before);
    if (!ID.test(req.query.before) || !Number.isSafeInteger(n)) return { status: 400, body: { error: "invalid_cursor" } };
    before = n;
  }
  const limit = limitOf(req.query.limit);
  if (limit === undefined) return { status: 400, body: { error: "invalid_limit" } };
  // `json_extract` raises on malformed JSON, so the filter guards it with `json_valid`: such a row never matches.
  const rows = req.store
    .prepare<[number, number, number], FireRow>(
      `SELECT id, at, kind, session_id, payload_json FROM events
        WHERE kind IN ('trigger_fired', 'trigger_missed')
          AND CASE WHEN json_valid(payload_json) THEN json_extract(payload_json, '$.trigger_id') END = ?
          AND id < ?
        ORDER BY id DESC LIMIT ?`,
    )
    .all(id, before ?? Number.MAX_SAFE_INTEGER, limit);
  const out = rows.flatMap((row) => {
    const payload = payloadOf(row.payload_json);
    if (payload === undefined) return [];
    const scheduled = payload.scheduled_at;
    const reason = payload.reason;
    return [
      {
        id: row.id,
        kind: row.kind,
        at: row.at,
        scheduled_at: typeof scheduled === "string" ? scheduled : null,
        reason: row.kind === "trigger_missed" && typeof reason === "string" ? reason : null,
        session_id: row.session_id,
      },
    ];
  });
  // The cursor is the last row read (a skipped row still counts, so a page never repeats it); `null` once a page comes back short.
  const last = rows.at(-1);
  return { status: 200, body: { fires: out, next_before: rows.length === limit && last !== undefined ? String(last.id) : null } };
}

export const schedulesRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "GET", path: "/schedule", handler: schedule },
  { method: "GET", path: "/triggers/:id/fires", handler: fires },
]);

export const schedulesPart: GuiPart = Object.freeze({
  name: "schedules",
  tools: Object.freeze([]),
  routes: schedulesRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
