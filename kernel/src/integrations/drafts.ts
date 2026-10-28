// The `integrations` feature's drafts part (phase 6, item 07): draft mode
// records a draft-mode session's outward call in `draft_outputs` instead of
// sending it (`recordDraftOutput`, called by the session gate), and the owner
// reads the rows through two routes on the loopback API (bearer token, like
// every route):
//
//   GET /drafts[?agent=][&playbook=][&item=][&limit=]   {drafts}, newest first
//   GET /drafts/:id                                     {draft}, or 404 `no_draft`
//
// A draft's payload is model output built from PR text: untrusted data, stored
// as JSON text, never interpreted. A row never holds a secret (the connector's
// token lives only in the Keychain, and sessions get no `GH_TOKEN`).
//
// The `studio` CLI loads it, so it imports only types, `../loop/internal.js`
// and the feature seam: never the Agent SDK, the session manager or
// `kernel.ts` (`kernel/test/feature-seams.test.ts` pins the registry's module
// graph). The session manager imports this file, never the other way round.
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { appendEvent, clip } from "../loop/internal.js";
import type { Store } from "../store/store.js";
import type { DraftOutputRow, IntegrationsPart } from "./types.js";

/** The event kind a recorded draft appends (a thread card, `console/threads.ts`). */
const DRAFT_EVENT_KIND = "draft_output_recorded";

/** The `summary` of a `draft_output_recorded` event is cut to this many characters (the action and its target, no body text). */
const MAX_DRAFT_SUMMARY_CHARS = 200;

/** A longer `agent` or `item` filter answers 400 `invalid_query`. */
const MAX_FILTER_CHARS = 512;

/** `GET /drafts`' `limit`: default and ceiling. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** What `recordDraftOutput` stores. The session manager looks the run and the agent up; this does no lookup. */
export interface DraftOutputInput {
  readonly session: number;
  readonly agent: string;
  readonly playbook: number | null;
  readonly playbookRun: number | null;
  readonly itemRef: string | null;
  /** The rail's action label (`gh pr review`, `git push`, `kernel_playbook_enable`, …). */
  readonly tool: string;
  /** The bounded payload (`draftPayloadOf`), stored as JSON text. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface DraftRecord {
  readonly id: number;
}

/**
 * Insert one `draft_outputs` row and append its one `draft_output_recorded`
 * event `{draft_output_id, tool, summary}` (session-tied). It opens no
 * transaction: the caller runs it inside its own, with the call's decision
 * event, so a throw rolls all of it back. `at` is the ISO instant of both.
 */
export function recordDraftOutput(store: Store, input: DraftOutputInput, at: string): DraftRecord {
  const info = store
    .prepare(
      `INSERT INTO draft_outputs (session, agent, playbook, playbook_run, item_ref, tool, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(input.session, input.agent, input.playbook, input.playbookRun, input.itemRef, input.tool, JSON.stringify(input.payload), at);
  const id = Number(info.lastInsertRowid);
  const target = typeof input.payload["target"] === "string" && input.payload["target"] !== "" ? ` ${input.payload["target"]}` : "";
  appendEvent(
    store,
    DRAFT_EVENT_KIND,
    { sessionId: input.session, taskId: null },
    { draft_output_id: id, tool: input.tool, summary: clip(`${input.tool}${target}`, MAX_DRAFT_SUMMARY_CHARS) },
    at,
  );
  return { id };
}

/** `listDrafts`' filters, each optional. */
export interface DraftFilters {
  readonly agent?: string;
  readonly playbook?: number;
  readonly item?: string;
  readonly limit?: number;
}

/** The drafts matching `filters`, newest first (`limit` rows, default `DEFAULT_LIMIT`). */
export function listDrafts(store: Store, filters: DraftFilters = {}): DraftOutputRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filters.agent !== undefined) {
    where.push("agent = ?");
    params.push(filters.agent);
  }
  if (filters.playbook !== undefined) {
    where.push("playbook = ?");
    params.push(filters.playbook);
  }
  if (filters.item !== undefined) {
    where.push("item_ref = ?");
    params.push(filters.item);
  }
  const clause = where.length === 0 ? "" : `WHERE ${where.join(" AND ")} `;
  return store
    .prepare<(string | number)[], DraftOutputRow>(`SELECT * FROM draft_outputs ${clause}ORDER BY id DESC LIMIT ?`)
    .all(...params, filters.limit ?? DEFAULT_LIMIT);
}

/** One draft by id, or `undefined`. */
export function getDraft(store: Store, id: number): DraftOutputRow | undefined {
  return store.prepare<[number], DraftOutputRow>("SELECT * FROM draft_outputs WHERE id = ?").get(id);
}

/** A row's `payload_json` parsed, or null when it is not JSON. */
function payloadOf(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** A row as the contract's `DraftOutput`: exactly its keys, built one by one. */
export function draftView(row: DraftOutputRow): Record<string, unknown> {
  return { id: row.id, session: row.session,
    agent: row.agent,
    playbook: row.playbook,
    playbook_run: row.playbook_run,
    item_ref: row.item_ref,
    tool: row.tool,
    payload: payloadOf(row.payload_json),
    created_at: row.created_at,
  };
}

const invalidQuery = (message: string): ContributedRouteResponse => ({ status: 400, body: { error: "invalid_query", message } });

/** A filter text: non-empty and at most `MAX_FILTER_CHARS` characters. */
const isFilterText = (value: string): boolean => value !== "" && value.length <= MAX_FILTER_CHARS;

/** A positive integer written in digits only (no sign, no leading zero, within the safe range). */
function positiveInteger(text: string): number | undefined {
  if (!/^[1-9]\d*$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** `GET /drafts`: validate the query, then list. */
function listHandler(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const { agent, playbook, item, limit } = req.query;
  const filters: { agent?: string; playbook?: number; item?: string; limit?: number } = {};
  if (agent !== undefined) {
    if (!isFilterText(agent)) return Promise.resolve(invalidQuery(`agent must be 1-${MAX_FILTER_CHARS} characters`));
    filters.agent = agent;
  }
  if (item !== undefined) {
    if (!isFilterText(item)) return Promise.resolve(invalidQuery(`item must be 1-${MAX_FILTER_CHARS} characters`));
    filters.item = item;
  }
  if (playbook !== undefined) {
    const n = positiveInteger(playbook);
    if (n === undefined) return Promise.resolve(invalidQuery("playbook must be a positive integer"));
    filters.playbook = n;
  }
  if (limit !== undefined) {
    const n = positiveInteger(limit);
    if (n === undefined || n > MAX_LIMIT) return Promise.resolve(invalidQuery(`limit must be an integer from 1 to ${MAX_LIMIT}`));
    filters.limit = n;
  }
  return Promise.resolve({ status: 200, body: { drafts: listDrafts(req.store, filters).map(draftView) } });
}

/** `GET /drafts/:id`: one draft, 400 for a non-integer id, 404 `no_draft` for none. */
function detailHandler(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const id = positiveInteger(req.params["id"] ?? "");
  if (id === undefined) return Promise.resolve(invalidQuery("id must be a positive integer"));
  const row = getDraft(req.store, id);
  if (row === undefined) return Promise.resolve({ status: 404, body: { error: "no_draft", message: `no draft ${id}` } });
  return Promise.resolve({ status: 200, body: { draft: draftView(row) } });
}

export const draftsPart: IntegrationsPart = Object.freeze({
  name: "drafts",
  tools: Object.freeze([]),
  routes: Object.freeze([
    { method: "GET", path: "/drafts", handler: listHandler },
    { method: "GET", path: "/drafts/:id", handler: detailHandler },
  ] satisfies ContributedRoute[]),
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
