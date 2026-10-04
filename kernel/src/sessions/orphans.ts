// Why a session row is `orphaned`, read from the kernel's own record. A leaf
// module (no SDK), shared by the session manager's abandon check and the
// loopback API's `/status`.
import type { Store } from "../store/store.js";

/**
 * The latest orphaning reason of the `sessions` row aliased `s`: the `reason`
 * in the payload of its newest event among `session_status` (to `orphaned`),
 * `session_reap_deferred` and `session_resume_refused`, by `id DESC`. `NULL`
 * when there is none.
 */
const LATEST_ORPHAN_REASON = `(
  SELECT json_extract(e.payload_json, '$.reason') FROM events e
   WHERE e.session_id = s.id
     AND (e.kind IN ('session_reap_deferred', 'session_resume_refused')
          OR (e.kind = 'session_status' AND json_extract(e.payload_json, '$.to') = 'orphaned'))
   ORDER BY e.id DESC LIMIT 1)`;

/** One `orphaned` row and its latest orphaning reason. */
export interface OrphanedSession {
  readonly id: number;
  readonly agent: string | null;
  readonly pgid: number | null;
  /** `null` when no event records one (a row written outside the kernel). */
  readonly reason: string | null;
  readonly updated_at: string;
}

/** The latest orphaning reason of session `id` (see `LATEST_ORPHAN_REASON`), or `null`. Whatever its status. */
export function latestOrphanReason(store: Store, id: number): string | null {
  const reason = store.prepare<[number], unknown>(`SELECT ${LATEST_ORPHAN_REASON} FROM sessions s WHERE s.id = ?`).pluck().get(id);
  return typeof reason === "string" ? reason : null;
}

/** Every `orphaned` row, by id, with its latest orphaning reason. */
export function orphanedSessions(store: Store): OrphanedSession[] {
  return store
    .prepare<[], { id: number; agent: string | null; pgid: number | null; reason: unknown; updated_at: string }>(
      `SELECT s.id, s.agent, s.pgid, ${LATEST_ORPHAN_REASON} AS reason, s.updated_at FROM sessions s WHERE s.status = 'orphaned' ORDER BY s.id`,
    )
    .all()
    .map((r) => ({ ...r, reason: typeof r.reason === "string" ? r.reason : null }));
}
