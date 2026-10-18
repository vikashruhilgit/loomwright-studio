// Read-only lookups on the `agents` table (migration 14). The writes (create,
// update, `off`) are the roster's and the charter tools' (phase 4 items 02 and
// 07), never here. The table's values are TEXT, closed in code
// (`./types.ts`): a row reads back as stored. The `studio` CLI loads this
// module, so it imports only types: never the Agent SDK, the session manager
// or `kernel.ts`.
import type { Store } from "../store/store.js";
import { isValidAgentId } from "./types.js";

/** One `agents` row, every column as stored. */
export interface AgentRow {
  readonly id: string;
  readonly display_name: string;
  /** One of `AVATAR_SHAPES`. */
  readonly avatar_shape: string;
  /** One of `AVATAR_HUES`. */
  readonly avatar_hue: string;
  /** One of `AGENT_STATUSES`. */
  readonly status: string;
  /** One of `AGENT_CREATED_BY`. */
  readonly created_by: string;
  /** The approval that created the row; null for an owner-made one. */
  readonly approval_id: number | null;
  /** The charter the owner saw, as JSON. */
  readonly charter_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The registered crew member `id`, or undefined (always for an invalid or reserved id: Wright has no row). */
export function getAgent(store: Store, id: string): AgentRow | undefined {
  if (!isValidAgentId(id)) return undefined;
  return store.prepare<[string], AgentRow>("SELECT * FROM agents WHERE id = ?").get(id);
}

/** Every registered crew member, `active` and `off`, ordered by `created_at`, then `id`. */
export function listAgents(store: Store): AgentRow[] {
  return store.prepare<[], AgentRow>("SELECT * FROM agents ORDER BY created_at, id").all();
}

/**
 * Whether a message may be routed to `id`: true for `wright`, true for a
 * registered crew member whose `status` is `active`, false otherwise (an
 * `off` member, an unknown id, an invalid or reserved id).
 */
export function isRoutable(store: Store, id: string): boolean {
  if (id === "wright") return true;
  if (!isValidAgentId(id)) return false;
  return store.prepare<[string], 1>("SELECT 1 FROM agents WHERE id = ? AND status = 'active'").pluck().get(id) !== undefined;
}
