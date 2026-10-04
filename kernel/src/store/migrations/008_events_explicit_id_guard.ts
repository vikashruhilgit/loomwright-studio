import type { Migration } from "./types.js";

/**
 * Keep `events` ids in append order (invariant 3: the kill switch's state is
 * the latest of its events `ORDER BY id`). Without this, an insert with an
 * explicit id (up to 9223372036854775807) is accepted, and every later
 * auto-assigned id would then sort before it.
 *
 * A guard trigger rather than an AUTOINCREMENT rebuild: the audit table is
 * never rebuilt, its rows are untouched by construction, and it is strictly
 * stronger (AUTOINCREMENT still accepts an explicit id into a gap below the
 * maximum). In a BEFORE INSERT trigger an auto-assigned id reads as -1
 * (migration 1), so `NEW.id > 0` means "an explicit id was given"; an explicit
 * NULL stays allowed, and the `CHECK (id > 0)` still refuses 0 and negatives.
 * Rows already stored are left exactly as they are (no kernel writer has ever
 * given an explicit id).
 */
export const eventsExplicitIdGuard: Migration = {
  version: 8,
  name: "events_explicit_id_guard",
  up: `
CREATE TRIGGER events_no_explicit_id BEFORE INSERT ON events
WHEN NEW.id > 0
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END;
`,
};
