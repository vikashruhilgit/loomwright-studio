// Non-secret provider metadata in the `auth_providers` table (migration 2).
// Store is imported for its type only, so this module's runtime import graph
// has no package imports.
import type { Store } from "../store/store.js";

export interface ProviderMetadata {
  readonly id: string;
  /** Human label for the account. Never a secret. */
  readonly account: string;
  /**
   * When the owner created the credential, if recorded: as written by
   * `recordTokenCreated`, `YYYY-MM-DDTHH:mm:ss.sssZ`. The column has no CHECK,
   * so a reader validates it with `parseTokenCreatedAt` before using it.
   */
  readonly token_created_at: string | null;
  readonly updated_at: string;
}

// `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ`: the two forms
// `toISOString()` and a hand-typed UTC timestamp take. Nothing looser:
// `Date.parse` alone also accepts "9999", "12345" and local-time strings.
const STRICT_UTC_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/;

/**
 * The ONE parser for a credential creation date, shared by the writer
 * (`recordTokenCreated`) and the reader (`health()`), so the two can never
 * disagree. Returns epoch milliseconds, or `null` unless ALL of these hold:
 *
 * - `value` is a string in the strict ISO-8601 UTC shape above;
 * - it names a real calendar date and time: parsing it and reading the
 *   components back changes nothing (so `2030-02-30` and `T24:00:00` fail);
 * - `now` is a valid instant and the date is not after it.
 */
export function parseTokenCreatedAt(value: unknown, now: Date): number | null {
  if (typeof value !== "string") return null;
  const m = STRICT_UTC_ISO.exec(value);
  if (m === null) return null;
  const ms = Date.parse(value);
  const nowMs = now.getTime();
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return null;
  const d = new Date(ms);
  const roundTrips =
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() + 1 === Number(m[2]) &&
    d.getUTCDate() === Number(m[3]) &&
    d.getUTCHours() === Number(m[4]) &&
    d.getUTCMinutes() === Number(m[5]) &&
    d.getUTCSeconds() === Number(m[6]);
  if (!roundTrips) return null;
  return ms > nowMs ? null : ms;
}

/**
 * Record (or replace) when a provider's credential was created, together with
 * its account label. Expiry tracking starts from this date. Throws `RangeError`
 * unless `parseTokenCreatedAt` accepts `createdAtIso` at `now` (default: the
 * current time): a strict ISO-8601 UTC timestamp of a real calendar date, not
 * after `now`. Stores the date as `toISOString()` gives it.
 */
export function recordTokenCreated(
  store: Store,
  providerId: string,
  account: string,
  createdAtIso: string,
  now: Date = new Date(),
): void {
  const ms = parseTokenCreatedAt(createdAtIso, now);
  if (ms === null) {
    throw new RangeError(
      `token creation date for provider "${providerId}" must be an ISO-8601 UTC timestamp ` +
        "(YYYY-MM-DDTHH:mm:ss[.sss]Z) of a real calendar date, not after now",
    );
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
    .run(providerId, account, new Date(ms).toISOString(), now.toISOString());
}

/** The provider's metadata row, or `undefined` when none was recorded. */
export function readProviderMetadata(store: Store, providerId: string): ProviderMetadata | undefined {
  return store
    .prepare<[string], ProviderMetadata>(
      "SELECT id, account, token_created_at, updated_at FROM auth_providers WHERE id = ?",
    )
    .get(providerId);
}
