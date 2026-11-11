// Withdraw on replace (phase 8 item 18d, the owner's 2026-11-11 decision 1):
// a held call may name its subject (`HeldToolVerdict.subject`, e.g. a charter
// call's `agent:<member id>`), recorded on its `approval_requested` event as
// `subject` (never in `payload_json`, so grant matching is unchanged). When a
// new call with a subject is held, every OTHER pending approval whose event
// names the same subject is withdrawn in the same transaction: the kernel
// denies it (`decided_by: "kernel"`), and its one `approval_decided` event
// records `replaced_by: <the new approval's id>`.
//
// Mechanism only (invariant 1): the kernel matches the subject exactly and
// never interprets it; which holds name a subject is the pre-hold check's
// (the two charter tools name the member). A withdraw only ever denies
// (invariant 3): it never approves, never uses or consumes a grant, and
// queues no decision message (the agent that held the new call is the one
// replacing the old one, so there is nothing to tell it).
//
// This module imports only the loop's audit helper and types, so `store.ts`
// can call it without an import cycle and the `studio` CLI can still load the
// feature without the Agent SDK.
import { appendEvent } from "../loop/internal.js";
import type { Store } from "../store/store.js";

/** Who decides a withdrawn approval: the kernel, as `approval_used` records a kernel-applied grant's use. */
export const WITHDRAWN_BY = "kernel";

/**
 * The pending approvals other than `?` (the new one) whose `approval_requested`
 * event names subject `?`, oldest first. It starts from the pending rows (a
 * short list), so it never scans the decided history.
 */
const SAME_SUBJECT = `WITH pending AS (
    SELECT a.id, a.action, a.requesting_session,
           (SELECT json_extract(r.payload_json, '$.subject') FROM events r
             WHERE r.kind = 'approval_requested' AND json_extract(r.payload_json, '$.id') = a.id
             ORDER BY r.id LIMIT 1) AS subject
      FROM approvals a
     WHERE a.status = 'pending' AND a.id <> ?
  )
  SELECT id, action, requesting_session FROM pending WHERE subject = ? ORDER BY id`;

/**
 * Withdraw every pending approval, other than `newId`, whose
 * `approval_requested` event names `subject`: each becomes `denied` with
 * `decision: "deny"`, `decided_by: "kernel"` and `decided_at: at`, and gets
 * one `approval_decided` event `{id, decision: "deny", by: "kernel", action,
 * replaced_by: newId}` linked to its requesting session. No decision message is
 * queued, no grant is used and nothing is approved. The update keeps
 * `decideApproval`'s `status = 'pending'` guard, so a row decided in between
 * is left as it is. Runs in one transaction (nested in a caller's, it joins
 * it). Returns the withdrawn ids, oldest first.
 */
export function withdrawReplaced(store: Store, subject: string, newId: number, at: string): number[] {
  return store.transaction(() => {
    const older = store.prepare<[number, string], { id: number; action: string; requesting_session: number | null }>(SAME_SUBJECT).all(newId, subject);
    const withdrawn: number[] = [];
    for (const row of older) {
      const changed = store
        .prepare("UPDATE approvals SET status = 'denied', decision = 'deny', decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
        .run(WITHDRAWN_BY, at, row.id).changes;
      if (changed !== 1) continue;
      appendEvent(
        store,
        "approval_decided",
        { sessionId: row.requesting_session, taskId: null },
        { id: row.id, decision: "deny", by: WITHDRAWN_BY, action: row.action, replaced_by: newId },
        at,
      );
      withdrawn.push(row.id);
    }
    return withdrawn;
  });
}
