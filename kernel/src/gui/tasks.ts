// The `gui` feature's `tasks` part (phase 7, item 03): the read routes behind
// the Tasks screen, on the loopback API (bearer token, like every route):
//
//   GET /tasks[?limit=][&before=]   {groups, next_before}: tasks, playbook runs
//                                   and sessions, newest first, grouped by state
//   GET /tasks/:kind/:id            {item, events, runs, sessions, approvals}: one
//                                   card and everything that names it
//
// The routes live in one named array. Mechanism only (invariant 1): every
// card carries its source's own state word, verbatim, and the kernel never
// maps a state to a column (the app does). Every gui route is an owner route
// that needs the API token: none sets `unauthenticated`. A stored string (a
// task title, a run's `item_ref`, an event payload) is untrusted data
// (invariant 3): it is returned as stored, never interpreted.
//
// The `studio` CLI loads it, so it imports only types, the feature seam and
// helpers that load no SDK (`../console/events.js`, `../approvals/store.js`):
// never the Agent SDK, the session manager or `kernel.ts`
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import { approvalView } from "../approvals/store.js";
import type { ApprovalRow } from "../approvals/store.js";
import { eventFrameOf } from "../console/events.js";
import type { EventRow } from "../console/events.js";
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { positiveIntegerOf } from "./query.js";
import type { Store } from "../store/index.js";
import type { GuiPart } from "./types.js";

/** `GET /tasks`' `limit`: default and ceiling. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** A history keeps at most this many events (the newest). */
const MAX_HISTORY_EVENTS = 500;

/** The kinds a card can be, and the `:kind` a history route accepts. Sorted as the board's tie-break sorts them. */
const KINDS = ["playbook_run", "session", "task"] as const;
type BoardKind = (typeof KINDS)[number];

/** One card as the union query reads it: the contract's `TaskBoardItem` up to `updated`, in its field order. */
interface SelectedRow {
  readonly kind: BoardKind;
  readonly id: number;
  readonly title: string | null;
  readonly state: string;
  readonly agent: string | null;
  readonly playbook: number | null;
  readonly item_ref: string | null;
  readonly session: number | null;
  readonly tokens: number | null;
  readonly started: string | null;
  readonly ended: string | null;
  readonly updated: string;
}

/**
 * One card as served (the contract's `TaskBoardItem`, in its field order): the
 * selected columns, then the creator of a task. Not columns of the union: they
 * are read once per request for the page's tasks (`withCreators`), `null` for a
 * run and a session.
 */
interface BoardRow extends SelectedRow {
  readonly creator_agent: string | null;
  readonly creator_session: number | null;
}

/** The columns every source SELECT answers, in `BoardRow`'s order. */
const TASK_SELECT = `SELECT 'task' AS kind, t.id AS id, t.title AS title,
       t.state AS state,
       t.assignee_agent AS agent, NULL AS playbook, NULL AS item_ref, t.owner_session_id AS session,
       NULL AS tokens, t.created_at AS started, NULL AS ended, t.updated_at AS updated
  FROM tasks t`;

const RUN_SELECT = `SELECT 'playbook_run' AS kind, r.id AS id, p.name AS title, r.status AS state,
       p.owning_agent AS agent, r.playbook AS playbook, r.item_ref AS item_ref, r.session_id AS session,
       r.tokens AS tokens, r.started_at AS started, r.ended_at AS ended, coalesce(r.ended_at, r.started_at) AS updated
  FROM playbook_runs r JOIN playbooks p ON p.id = r.playbook`;

const SESSION_SELECT = `SELECT 'session' AS kind, s.id AS id, NULL AS title, s.status AS state,
       s.agent AS agent, s.playbook AS playbook, NULL AS item_ref, NULL AS session,
       (SELECT sum(b.counted_tokens) FROM budget b WHERE b.session_id = s.id) AS tokens,
       s.started_at AS started, s.ended_at AS ended, s.updated_at AS updated
  FROM sessions s`;

/** The board's sessions: one a task or a playbook run owns is part of that card, not its own. */
const BOARD_SESSION_SELECT = `${SESSION_SELECT}
 WHERE 1 = 1
   AND s.task_id IS NULL AND s.id NOT IN (SELECT owner_session_id FROM tasks WHERE owner_session_id IS NOT NULL)
   AND s.id NOT IN (SELECT session_id FROM playbook_runs WHERE session_id IS NOT NULL)`;

const invalidQuery = (message: string): ContributedRouteResponse => ({ status: 400, body: { error: "invalid_query", message } });

const isKind = (value: string): value is BoardKind => (KINDS as readonly string[]).includes(value);

// ---- The cursor ----------------------------------------------------------------

/** The keyset position of a page's last row. The format is the kernel's own: the app treats it as opaque. */
interface Cursor {
  readonly updated: string;
  readonly kind: BoardKind;
  readonly id: number;
}

/** The cursor naming `row` (the last row of a page), or null for none. */
function cursorOf(row: SelectedRow | undefined): string | null {
  if (row === undefined) return null;
  return Buffer.from(JSON.stringify([row.updated, row.kind, row.id]), "utf8").toString("base64url");
}

/** The cursor `text` names, or undefined when it is not one `cursorOf` wrote. */
function parseCursor(text: string): Cursor | undefined {
  if (text === "" || text.length > 512 || !/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [updated, kind, id] = value as unknown[];
  if (typeof updated !== "string" || typeof kind !== "string" || !isKind(kind)) return undefined;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1) return undefined;
  return { updated, kind, id };
}

// ---- The creator of a task ---------------------------------------------------------

/**
 * The creators of `rows`' tasks, merged in: `creator_agent` / `creator_session`
 * are the agent / session of the task's FIRST `task_created` event (lowest
 * `events.id`), and `null` for a run, a session, a task with no such event, an
 * event with no session, or a session row that is gone. The store has no index
 * on `events.task_id`, so this is ONE query per request for the page's task ids,
 * never a subquery per row. The creator is a fact about the card only: its
 * session never joins a history's `sessions`, and its events never join the
 * task's history.
 */
function withCreators(store: Store, rows: readonly SelectedRow[]): BoardRow[] {
  const taskIds = rows.filter((row) => row.kind === "task").map((row) => row.id);
  const creators = new Map<number, { agent: string | null; session: number | null }>();
  if (taskIds.length > 0) {
    const found = store
      .prepare<[string], { task_id: number; session_id: number | null; agent: string | null }>(
        `SELECT e.task_id AS task_id, e.session_id AS session_id, s.agent AS agent
           FROM events e LEFT JOIN sessions s ON s.id = e.session_id
          WHERE e.id IN (SELECT min(id) FROM events
                          WHERE kind = 'task_created' AND task_id IN (SELECT value FROM json_each(?))
                          GROUP BY task_id)`,
      )
      .all(JSON.stringify(taskIds));
    for (const row of found) creators.set(row.task_id, { agent: row.agent, session: row.session_id });
  }
  return rows.map((row) => {
    const creator = row.kind === "task" ? creators.get(row.id) : undefined;
    return { ...row, creator_agent: creator?.agent ?? null, creator_session: creator?.session ?? null };
  });
}

// ---- GET /tasks ----------------------------------------------------------------

/** `GET /tasks`: validate the query, read one page of the union, group it by state. */
function listHandler(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const { limit: rawLimit, before: rawBefore } = req.query;
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const n = positiveIntegerOf(rawLimit);
    if (n === undefined || n > MAX_LIMIT) return Promise.resolve(invalidQuery(`limit must be an integer from 1 to ${MAX_LIMIT}`));
    limit = n;
  }
  let cursor: Cursor | undefined;
  if (rawBefore !== undefined) {
    cursor = parseCursor(rawBefore);
    if (cursor === undefined) return Promise.resolve(invalidQuery("before must be a cursor from next_before"));
  }
  // The keyset for `updated DESC, kind ASC, id DESC`: the rows after the cursor's.
  const after = cursor === undefined ? "" : "WHERE updated < ? OR (updated = ? AND kind > ?) OR (updated = ? AND kind = ? AND id < ?)";
  const rows = req.store
    .prepare<unknown[], SelectedRow>(
      `SELECT * FROM (
         ${TASK_SELECT}
         UNION ALL
         ${RUN_SELECT}
         UNION ALL
         ${BOARD_SESSION_SELECT}
       ) ${after}
       ORDER BY updated DESC, kind, id DESC LIMIT ${limit + 1}`,
    )
    .all(...(cursor === undefined ? [] : [cursor.updated, cursor.updated, cursor.kind, cursor.updated, cursor.kind, cursor.id]));
  const selected = rows.slice(0, limit);
  const page = withCreators(req.store, selected);
  // Rows are already newest first; a state's group opens where its first row appears.
  const byState = new Map<string, BoardRow[]>();
  const groups: { state: string; items: BoardRow[] }[] = [];
  for (const row of page) {
    let items = byState.get(row.state);
    if (items === undefined) {
      items = [];
      byState.set(row.state, items);
      const group = { state: row.state, items };
      groups.push(group);
    }
    items.push(row);
  }
  return Promise.resolve({
    status: 200,
    body: {
      groups,
      next_before: rows.length > limit ? cursorOf(selected[selected.length - 1]) : null,
    },
  });
}

// ---- GET /tasks/:kind/:id --------------------------------------------------------

/** A session as the contract's `SessionSummary` (the same columns `GET /sessions` reads). */
const SESSION_SUMMARY = `SELECT s.id AS id, s.agent AS agent, s.status AS status, s.model AS model,
       s.started_at AS started, s.ended_at AS ended,
       (SELECT sum(b.counted_tokens) FROM budget b WHERE b.session_id = s.id) AS tokens,
       s.cwd AS cwd, s.playbook AS playbook
  FROM sessions s`;

/** A run as the contract's `PlaybookRun`, in its field order. */
const RUN_VIEW = `SELECT r.id AS id, r.playbook AS playbook, r.version AS version, r.kind AS kind, r.status AS status,
       r.item_ref AS item_ref, r.item_revision AS item_revision, r.tokens AS tokens, r.session_id AS session,
       r.started_at AS started, r.ended_at AS ended
  FROM playbook_runs r`;

const APPROVAL_COLUMNS = "id, requesting_agent, requesting_session, action, payload_json, requested_at, status, decision, decided_by, decided_at, playbook";

/**
 * `GET /tasks/:kind/:id`: the card (owned or not), its sessions (a task's own
 * and its owner session, a run's session, or the session itself), the events
 * that name the item or one of its sessions (oldest first, the newest
 * `MAX_HISTORY_EVENTS`, never `session_output_appended`: the log shows output),
 * its playbook runs (a run's own row, or its sessions' runs), and the approvals
 * whose `requesting_session` is one of its sessions, pending first. An approval
 * named only by playbook is left out: a playbook spans many runs.
 */
function historyHandler(req: ContributedRouteRequest): Promise<ContributedRouteResponse> {
  const kind = req.params["kind"] ?? "";
  if (!isKind(kind)) return Promise.resolve({ status: 400, body: { error: "invalid_kind", message: `kind must be one of ${KINDS.join(", ")}` } });
  const id = positiveIntegerOf(req.params["id"] ?? "");
  if (id === undefined) return Promise.resolve({ status: 400, body: { error: "invalid_id", message: "id must be a positive integer" } });

  const { store } = req;
  const source = kind === "task" ? TASK_SELECT : kind === "playbook_run" ? RUN_SELECT : SESSION_SELECT;
  const alias = kind === "task" ? "t" : kind === "playbook_run" ? "r" : "s";
  const selectedItem = store.prepare<[number], SelectedRow>(`${source} WHERE ${alias}.id = ?`).get(id);
  if (selectedItem === undefined) return Promise.resolve({ status: 404, body: { error: "not_found" } });
  const item = withCreators(store, [selectedItem])[0];

  const sessions =
    kind === "task"
      ? store
          .prepare<[number, number], Record<string, unknown> & { id: number }>(
            `${SESSION_SUMMARY} WHERE s.task_id = ? OR s.id = (SELECT owner_session_id FROM tasks WHERE id = ?) ORDER BY s.id DESC`,
          )
          .all(id, id)
      : kind === "playbook_run"
        ? store
            .prepare<[number], Record<string, unknown> & { id: number }>(`${SESSION_SUMMARY} WHERE s.id = (SELECT session_id FROM playbook_runs WHERE id = ?)`)
            .all(id)
        : store.prepare<[number], Record<string, unknown> & { id: number }>(`${SESSION_SUMMARY} WHERE s.id = ?`).all(id);
  // The ids go in as one JSON array, so a task with many sessions never hits the bound-variable limit.
  const sessionIds = JSON.stringify(sessions.map((s) => s.id));

  const events = store
    .prepare<[number | null, string, number], EventRow>(
      `SELECT id, at, kind, session_id, task_id, payload_json FROM events
        WHERE (task_id = ? OR session_id IN (SELECT value FROM json_each(?)))
          AND kind <> 'session_output_appended'
        ORDER BY id DESC LIMIT ?`,
    )
    .all(kind === "task" ? id : null, sessionIds, MAX_HISTORY_EVENTS)
    .reverse()
    .map(eventFrameOf);

  const runs =
    kind === "playbook_run"
      ? store.prepare<[number], unknown>(`${RUN_VIEW} WHERE r.id = ?`).all(id)
      : store.prepare<[string], unknown>(`${RUN_VIEW} WHERE r.session_id IN (SELECT value FROM json_each(?)) ORDER BY r.id DESC`).all(sessionIds);

  const approvals = store
    .prepare<[string], ApprovalRow>(
      `SELECT ${APPROVAL_COLUMNS} FROM approvals
        WHERE requesting_session IN (SELECT value FROM json_each(?))
        ORDER BY status = 'pending' DESC, id DESC`,
    )
    .all(sessionIds)
    .map((row) => approvalView(store, row));

  return Promise.resolve({ status: 200, body: { item, events, runs, sessions, approvals } });
}

export const tasksRoutes: readonly ContributedRoute[] = Object.freeze([
  { method: "GET", path: "/tasks", handler: listHandler },
  { method: "GET", path: "/tasks/:kind/:id", handler: historyHandler },
] satisfies ContributedRoute[]);

export const tasksPart: GuiPart = Object.freeze({
  name: "tasks",
  tools: Object.freeze([]),
  routes: tasksRoutes,
  subcommands: Object.freeze([]),
  handlers: Object.freeze({}),
  dueWork: Object.freeze([]),
});
