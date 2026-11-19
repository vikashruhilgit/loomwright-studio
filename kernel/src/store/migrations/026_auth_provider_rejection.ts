import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/** The columns migration 26 adds to `auth_providers`, in the order it adds them. */
const COLUMNS: ReadonlyArray<{ readonly column: string; readonly definition: string }> = [
  { column: "rejected_at", definition: "TEXT" },
  { column: "rejected_fingerprint", definition: "TEXT" },
];

/**
 * The server's last refusal of a provider's credential (2026-11-19: the
 * subscription token was revoked server-side, sessions 230 and 245 failed
 * `401`, and health still said `ok` because it read only the Keychain).
 * `rejected_at` is when a session on the provider was refused; 
 * `rejected_fingerprint` is `credentialFingerprint` of the credential that
 * session ran on, never the credential. Health reports `rejected` while the
 * Keychain holds that same credential. Both are null when nothing was refused,
 * and a later session on that credential that gets an answer sets both back to
 * null. Mechanism only: no policy reads them.
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger. Safe to
 * re-run: `up` adds a column only when `PRAGMA table_info` does not list it
 * (the pattern of migrations 15, 17, 18, 19, 21, 23 and 25).
 */
export const authProviderRejection: Migration = {
  version: 26,
  name: "auth_provider_rejection",
  up: (db: Database.Database) => {
    const existing = db.prepare<[string], string>("SELECT name FROM pragma_table_info(?)").pluck().all("auth_providers");
    for (const { column, definition } of COLUMNS) {
      if (existing.includes(column)) continue;
      db.exec(`ALTER TABLE auth_providers ADD COLUMN ${column} ${definition}`);
    }
  },
};
