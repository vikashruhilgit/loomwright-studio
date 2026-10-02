import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migration 1).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

/**
 * Non-secret auth provider metadata: the account label and, for providers with
 * a limited life, when the credential was created (expiry warnings, D27).
 *
 * NEVER add a secret column to this table. Credentials live only in the macOS
 * Keychain and are read per use.
 */
export const authProviders: Migration = {
  version: 2,
  name: "auth_providers",
  up: `
CREATE TABLE auth_providers (
  id               TEXT PRIMARY KEY,
  account          TEXT NOT NULL,
  token_created_at TEXT,
  updated_at       TEXT NOT NULL DEFAULT ${NOW}
);
`,
};
