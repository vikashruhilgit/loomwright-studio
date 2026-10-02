// Store is imported for its type only, so this module's runtime import graph
// has no package imports.
import type { Store } from "../store/store.js";
import type { AuthHealth, AuthProvider } from "./types.js";

export const AUTH_EXPIRING_REASON = "auth_token_expiring";

/**
 * Check `provider.health()` and, when it is `expiring`, append one `notify`
 * event to the audit log — at most once per provider per UTC day. A mechanism
 * only: whatever schedules this call decides how often it runs.
 *
 * The row's `at` comes from the injected clock, and the same-day dedupe reads
 * that same clock, so an injected date never disagrees with SQLite's wall
 * clock. The payload never contains the credential.
 */
export function checkAuthHealth(
  store: Store,
  provider: AuthProvider,
  now: () => Date = () => new Date(),
): AuthHealth {
  const health = provider.health();
  if (health.status !== "expiring") return health;

  const at = now().toISOString();
  const day = at.slice(0, 10);
  store.transaction(() => {
    const already = store
      .prepare(
        `SELECT 1 FROM events
          WHERE kind = 'notify'
            AND substr(at, 1, 10) = ?
            AND json_extract(payload_json, '$.reason') = ?
            AND json_extract(payload_json, '$.provider') = ?
          LIMIT 1`,
      )
      .get(day, AUTH_EXPIRING_REASON, provider.id);
    if (already !== undefined) return;
    const payload = JSON.stringify({
      reason: AUTH_EXPIRING_REASON,
      provider: provider.id,
      account: provider.account,
      days: health.days,
    });
    store
      .prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, 'notify', 'kernel', ?)")
      .run(at, payload);
  });
  return health;
}
