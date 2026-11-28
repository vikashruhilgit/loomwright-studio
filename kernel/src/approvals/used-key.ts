// The idempotency-key rule shared by the always-held, kernel-applied tools
// (`kernel_agent_create`, `kernel_agent_update`, `kernel_memory_propose`): a
// key this session already used for the same tool is refused before the hold
// (`idempotency_key_used`), so a retried call never files a second approval of
// one request, and a second Allow once never applies it twice. A new key asks
// the owner again.
//
// This module imports only a type, so the `studio` CLI can load every feature
// that uses it without the Agent SDK (`kernel/test/feature-seams.test.ts`).
import type { Store } from "../store/store.js";

/** The refusal token for a reused key. */
export const IDEMPOTENCY_KEY_USED = "idempotency_key_used";

/** The refusal's one-line detail. */
export const IDEMPOTENCY_KEY_USED_MESSAGE = "this idempotency_key was already used for a request in this session; use a new key to ask the owner again";

/**
 * Whether session `sessionId` already has an approval (any status) whose rail
 * payload is for `fullName` (the tool's full SDK name) with this
 * `idempotency_key`.
 */
export function idempotencyKeyUsed(store: Store, sessionId: number, fullName: string, key: string): boolean {
  const used = store
    .prepare<[number, string, string], number>(
      "SELECT 1 FROM approvals WHERE requesting_session = ? AND json_extract(payload_json, '$.tool') = ? AND json_extract(payload_json, '$.input.idempotency_key') = ? LIMIT 1",
    )
    .pluck()
    .get(sessionId, fullName, key);
  return used !== undefined;
}
