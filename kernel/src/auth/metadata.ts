// Non-secret provider metadata in the `auth_providers` table (migration 2).
// Store is imported for its type only, so this module's runtime import graph
// has no package imports.
import type { Store } from "../store/store.js";

export interface ProviderMetadata {
  readonly id: string;
  /** Human label for the account. Never a secret. */
  readonly account: string;
  /** When the owner created the credential (ISO-8601 UTC), if recorded. */
  readonly token_created_at: string | null;
  readonly updated_at: string;
}

/**
 * Record (or replace) when a provider's credential was created, together with
 * its account label. Expiry tracking starts from this date. Throws `RangeError`
 * when `createdAtIso` is not a parseable date.
 */
export function recordTokenCreated(
  store: Store,
  providerId: string,
  account: string,
  createdAtIso: string,
): void {
  const ms = Date.parse(createdAtIso);
  if (Number.isNaN(ms)) {
    throw new RangeError(`token creation date for provider "${providerId}" is not a valid date`);
  }
  store
    .prepare(
      `INSERT INTO auth_providers (id, account, token_created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         account = excluded.account,
         token_created_at = excluded.token_created_at,
         updated_at = excluded.updated_at`,
    )
    .run(providerId, account, new Date(ms).toISOString(), new Date().toISOString());
}

/** The provider's metadata row, or `undefined` when none was recorded. */
export function readProviderMetadata(store: Store, providerId: string): ProviderMetadata | undefined {
  return store
    .prepare<[string], ProviderMetadata>(
      "SELECT id, account, token_created_at, updated_at FROM auth_providers WHERE id = ?",
    )
    .get(providerId);
}
