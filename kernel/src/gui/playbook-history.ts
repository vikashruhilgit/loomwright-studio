// The `gui` feature's `playbook-history` part (phase 7, item 04): the two read
// routes behind the Playbooks screen's run and version history. The routes live
// in one named array, so the item edits one array in this one file. Mechanism
// only (invariant 1). Every gui route is an owner route that needs the API token:
// none sets `unauthenticated`.
//
//   GET /playbooks/:id/runs[?limit=&before=]  {runs, next_before}: newest first
//   GET /playbooks/:id/versions               {versions}: newest first
//
// Both answer the shapes of `app/src/api/contract.ts` (`PlaybookRunsResponse`,
// `PlaybookVersionsResponse`). Stored text (a run's `item_ref`, a snapshot's
// `name` and `intent`) is untrusted data and is passed through as data, never
// interpreted. A request is checked in this order: the id (400 `invalid_id`),
// the query (400 `invalid_query`), then the playbook (404 `not_found`).
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { getPlaybook, listPlaybookVersions } from "../playbooks/store.js";
import type { GuiPart } from "./types.js";

/** `limit` when the request names none. */
const DEFAULT_RUNS_LIMIT = 50;
/** The most runs one page holds: a larger `limit` is clamped to it. */
const MAX_RUNS_LIMIT = 200;

const ID = /^[1-9]\d{0,15}$/;
const LIMIT = /^[1-9]\d{0,2}$/;

/** A positive safe integer from `raw`, or `undefined` when it is not one. */
function positiveInt(raw: string | undefined, pattern: RegExp): number | undefined {
  if (raw === undefined || !pattern.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

const invalidId: ContributedRouteResponse = Object.freeze({ status: 400, body: Object.freeze({ error: "invalid_id" }) });
const notFound: ContributedRouteResponse = Object.freeze({ status: 404, body: Object.freeze({ error: "not_found" }) });

function invalidQuery(message: string): ContributedRouteResponse {
  return { status: 400, body: { error: "invalid_query", message } };
}

/** The `playbook_runs` columns the contract's `PlaybookRun` is built from. */
interface RunRow {
  readonly id: number;
  readonly playbook: number;
  readonly version: number;
  readonly kind: string;
  readonly status: string;
  readonly item_ref: string | null;
  readonly item_revision: string | null;
  readonly tokens: number | null;
  readonly session_id: number | null;
  readonly started_at: string;
  readonly ended_at: string | null;
}

/** Exactly the contract's `PlaybookRun`: `result_json` and `dedupe_key` are not exposed. */
function runOf(r: RunRow) {
  return {
    id: r.id,
    playbook: r.playbook,
    version: r.version,
    kind: r.kind,
    status: r.status,
    item_ref: r.item_ref,
    item_revision: r.item_revision,
    tokens: r.tokens,
    session: r.session_id,
    started: r.started_at,
    ended: r.ended_at,
  };
}

/** A snapshot that parsed to a plain object as it is; anything else (null, an array, a string, a number) reads as `{}`. */
function snapshotOf(raw: unknown): Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

async function runsOf(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const id = positiveInt(req.params.id, ID);
  if (id === undefined) return invalidId;

  let limit = DEFAULT_RUNS_LIMIT;
  if (req.query.limit !== undefined) {
    const n = positiveInt(req.query.limit, LIMIT);
    if (n === undefined) return invalidQuery("limit is a whole number from 1 to 200");
    limit = Math.min(n, MAX_RUNS_LIMIT);
  }
  let before: number | undefined;
  if (req.query.before !== undefined) {
    before = positiveInt(req.query.before, ID);
    if (before === undefined) return invalidQuery("before is the next_before of a previous page");
  }

  if (getPlaybook(req.store, id) === undefined) return notFound;

  // One row past the page says whether another page exists.
  const columns = "id, playbook, version, kind, status, item_ref, item_revision, tokens, session_id, started_at, ended_at";
  const rows =
    before === undefined
      ? req.store.prepare<[number, number], RunRow>(`SELECT ${columns} FROM playbook_runs WHERE playbook = ? ORDER BY id DESC LIMIT ?`).all(id, limit + 1)
      : req.store
          .prepare<[number, number, number], RunRow>(`SELECT ${columns} FROM playbook_runs WHERE playbook = ? AND id < ? ORDER BY id DESC LIMIT ?`)
          .all(id, before, limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { status: 200, body: { runs: page.map(runOf), next_before: rows.length > limit && last !== undefined ? String(last.id) : null } };
}

async function versionsOf(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const id = positiveInt(req.params.id, ID);
  if (id === undefined) return invalidId;
  if (getPlaybook(req.store, id) === undefined) return notFound;
  // `listPlaybookVersions` is oldest first (and reads an unparseable snapshot as null).
  const versions = listPlaybookVersions(req.store, id)
    .reverse()
    .map((v) => ({ playbook: id, version: v.version, snapshot: snapshotOf(v.snapshot), created_at: v.created_at }));
  return { status: 200, body: { versions } };
}

export const playbookHistoryRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "GET", path: "/playbooks/:id/runs", handler: runsOf },
  { method: "GET", path: "/playbooks/:id/versions", handler: versionsOf },
]);

export const playbookHistoryPart: GuiPart = Object.freeze({
  name: "playbook-history",
  tools: Object.freeze([]),
  routes: playbookHistoryRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
