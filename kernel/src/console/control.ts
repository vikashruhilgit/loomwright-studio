// The console's session-control part (phase 5 item 04): a graceful stop and
// an immediate kill of one session, through the route request's `sessions`.
// Two routes, `POST /sessions/:id/stop` and `POST /sessions/:id/kill`, each
// run on the API server's one POST queue (the request's `serialized`), so
// they never interleave with the kill switch, resume or abandon. Mechanism
// only (invariant 1): the session manager's `stopSession` does the stopping.
//
// The `studio` CLI loads this module through the feature registry, so its only
// value imports are `./types.js` and the store helper `../loop/internal.js`
// (which itself imports only a type): the session manager and `SessionError`
// are types here, and a `SessionError` is told apart by its `code` alone
// (`kernel/test/feature-seams.test.ts` pins the registry's module graph).
import type { ContributedRoute, ContributedRouteRequest, ContributedRouteResponse } from "../features/contribution.js";
import { appendEvent } from "../loop/internal.js";
import type { SessionStatus } from "../sessions/types.js";
import type { Store } from "../store/store.js";
import { emptyConsolePart } from "./types.js";
import type { ConsolePart } from "./types.js";

/** The owner's two ways to end one session: `stop` is graceful, `kill` is immediate. */
export type SessionControlMode = "stop" | "kill";

/** The event each accepted request records (payload `{by: "owner", mode}`), before the stop begins. */
export const SESSION_STOP_REQUESTED = "session_stop_requested";

/** A `SessionError`'s stable code, read by duck typing (the class lives in a module the CLI must not load). */
function sessionErrorCode(err: unknown): string | undefined {
  if (!(err instanceof Error) || err.name !== "SessionError") return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** The reason of session `id`'s last `session_status` event, or `null` when it has none. */
function lastStatusReason(store: Store, id: number): string | null {
  const payload = store
    .prepare<[number], string>("SELECT payload_json FROM events WHERE kind = 'session_status' AND session_id = ? ORDER BY id DESC LIMIT 1")
    .pluck()
    .get(id);
  if (payload === undefined) return null;
  const reason = (JSON.parse(payload) as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/** A positive safe integer written in decimal digits, else `undefined`. */
function parseId(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return undefined;
  return id;
}

/**
 * Stop (`stop`) or kill (`kill`) session `:id` through the session manager,
 * on the server's POST queue. Answers:
 *
 * - `503 {error: "sessions_unavailable"}`: the composition gave no session
 *   manager or no queue;
 * - `400 {error: "invalid_id"}`: `:id` is not a positive integer;
 * - `404 {error: "not_found"}`: no such session;
 * - `409 {error: "not_running", status}`: the session has ended, or it has not
 *   ended but this kernel does not run it (`not_live`, for example a row left
 *   `interrupted` by a previous kernel); `status` is its current status;
 * - `200 {id, status, reason}`: the stop ran. `reason` is that of the
 *   session's last `session_status` event, whatever it is: `owner_stop`,
 *   `owner_kill`, `kill_incomplete` (status `failed`), or the session's own
 *   outcome when its stream had already ended (for example `completed` /
 *   `result_success`).
 *
 * Each accepted request records one `session_stop_requested` event (actor
 * `kernel`, payload `{by: "owner", mode}`) with the session's id and task,
 * right before the stop begins (`StopSessionOptions.onAccepted`); a 400, 404,
 * 409 or 503 records none. Any other throw is rethrown: the API answers 500
 * and records `route_failed`.
 */
async function controlSession(req: ContributedRouteRequest, mode: SessionControlMode): Promise<ContributedRouteResponse> {
  const sessions = req.sessions;
  const serialized = req.serialized;
  if (sessions === undefined || serialized === undefined) return { status: 503, body: { error: "sessions_unavailable" } };
  const id = parseId(req.params["id"]);
  if (id === undefined) return { status: 400, body: { error: "invalid_id" } };
  return serialized(async (): Promise<ContributedRouteResponse> => {
    const row = sessions.getSession(id);
    if (row === undefined) return { status: 404, body: { error: "not_found" } };
    let accepted = false;
    let status: SessionStatus;
    try {
      status = await sessions.stopSession(id, {
        mode,
        onAccepted: () => {
          appendEvent(req.store, SESSION_STOP_REQUESTED, { sessionId: id, taskId: row.task_id }, { by: "owner", mode }, req.now().toISOString());
          accepted = true;
        },
      });
    } catch (err) {
      const code = sessionErrorCode(err);
      if (code === "not_found") return { status: 404, body: { error: "not_found" } };
      if (code === "not_live") return { status: 409, body: { error: "not_running", status: sessions.getSession(id)?.status ?? row.status } };
      throw err;
    }
    // Ended before this request: nothing was stopped and nothing recorded.
    if (!accepted) return { status: 409, body: { error: "not_running", status } };
    return { status: 200, body: { id, status, reason: lastStatusReason(req.store, id) } };
  });
}

/** `POST /sessions/:id/stop` and `POST /sessions/:id/kill`, in that order; no tools, handlers or due work. */
export const controlPart: ConsolePart = Object.freeze({
  ...emptyConsolePart("control"),
  routes: Object.freeze([
    { method: "POST", path: "/sessions/:id/stop", handler: (req) => controlSession(req, "stop") },
    { method: "POST", path: "/sessions/:id/kill", handler: (req) => controlSession(req, "kill") },
  ] satisfies ContributedRoute[]),
});
