import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migrations 7, 11, 12, 13, 14, 16 and 17).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

const TABLES = `
CREATE TABLE IF NOT EXISTS repo_policies (
  id                INTEGER PRIMARY KEY,
  repo              TEXT NOT NULL UNIQUE,
  policy_kind       TEXT NOT NULL,
  required_reviews  INTEGER,
  trust_unprotected INTEGER NOT NULL DEFAULT 0,
  detected_json     TEXT,
  set_by            TEXT,
  set_at            TEXT
);

CREATE TABLE IF NOT EXISTS pr_tracks (
  id              INTEGER PRIMARY KEY,
  repo            TEXT NOT NULL,
  number          INTEGER NOT NULL,
  head_sha        TEXT,
  state           TEXT NOT NULL,
  ticket_ref      TEXT,
  approvals       INTEGER NOT NULL DEFAULT 0,
  required        INTEGER,
  ci_state        TEXT,
  owner_kind      TEXT,
  run_file        TEXT,
  item_id         TEXT,
  merged_by_gate  INTEGER NOT NULL DEFAULT 0,
  updated         TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (repo, number)
);

CREATE TABLE IF NOT EXISTS mcp_connections (
  id             INTEGER PRIMARY KEY,
  kind           TEXT NOT NULL UNIQUE,
  server_url     TEXT,
  status         TEXT NOT NULL,
  granted_tools  TEXT,
  token_expiry   TEXT
);
`;

/**
 * The phase 8 foundation schema: the tables every later phase 8 item codes
 * against. Each later item fills its own table and validates its own values:
 * every value set below is closed in code (no SQL CHECK), so an item adds a
 * value without a table rebuild.
 *
 * - `repo_policies`: one row per repo (`repo` is `<owner>/<repo>`, UNIQUE).
 *   `policy_kind` is the repo's merge policy kind (`solo`, `studio_approval`
 *   or `reviews`, D40); `required_reviews` the approvals it needs (null when
 *   the kind has no count); `trust_unprotected` is 0 or 1 (the owner trusts a
 *   repo whose branch has no protection); `detected_json` is what the kernel
 *   detected from the host (JSON text, null until it has); `set_by` is
 *   `wright` or `owner` like the other `*_set_by` columns, with `set_at` the
 *   ISO instant it was set.
 * - `pr_tracks`: one row per tracked pull request (UNIQUE on `repo` and
 *   `number`): its head SHA, `state`, the `ticket_ref` it is for, its
 *   `approvals` against the `required` count, `ci_state`, `owner_kind`
 *   (who holds it: an `/automate` run live or parked, the owner or someone
 *   else), the `run_file` and `item_id` of the `/automate` run that parked
 *   it, `merged_by_gate` (0 or 1: Loomwright's gate merged it; the kernel
 *   never merges, D40) and the `updated` instant.
 * - `mcp_connections`: one row per MCP connector kind (UNIQUE): the
 *   `server_url`, `status`, the `granted_tools` as JSON text and the
 *   `token_expiry`. It never holds a secret: a connector's token lives only
 *   in the Keychain.
 *
 * Does not touch `events` or its triggers. Creates no SQL trigger: the
 * integrity check refuses any trigger the kernel does not list. Safe to
 * re-run: every table uses `IF NOT EXISTS`.
 */
export const phase8Foundation: Migration = {
  version: 20,
  name: "phase_8_foundation",
  up: (db: Database.Database) => {
    db.exec(TABLES);
  },
};
