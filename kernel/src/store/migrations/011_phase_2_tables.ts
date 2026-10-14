import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision (same as migration 7).
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

/**
 * The phase 2 tables. Each feature item that builds on one owns its writes and
 * validates its values: every value set below is closed in code (no SQL
 * CHECK), so a later item adds a value without a table rebuild.
 *
 * - `triggers`: a scheduled action an agent or the owner created. `kind` is
 *   `once` (`spec_json` `{at}`, an instant with a time zone) or `cron`
 *   (`{cron, tz}`, an IANA time zone); `action` is `notify` or `wake_agent`
 *   with its stored text in `action_payload`; `created_by` is `agent` or
 *   `owner`. `enabled_changed_by` (`owner` / `agent`, null until changed) is
 *   how the triggers item, in code, keeps an agent from undoing an owner's off.
 *   `playbook` stays null until playbooks exist (phase 3).
 * - `notifications`: one row per notification. `source` is `trigger:<id>`,
 *   `agent:<name>` or `kernel:<reason>`; `deep_link` is
 *   `loomwright-studio://notifications/<id>`; `delivery_status` is `pending`,
 *   `delivered`, `failed` or `unsupported`.
 * - `approvals`: an outward or persistent action waiting for the owner, with
 *   the exact payload. `status` is `pending`, `approved` or `denied`;
 *   `decision` is `once`, `always` or `deny`.
 * - `loomwright_contract_seen`: each Loomwright contract the kernel has read,
 *   as read, once per install path, plugin version and contract schema version.
 *
 * Creates no SQL trigger: the integrity check refuses any trigger the kernel
 * does not list. Safe to re-run (`IF NOT EXISTS`): the store's integrity check
 * re-runs the top migrations when their `schema_migrations` rows were deleted.
 */
export const phase2Tables: Migration = {
  version: 11,
  name: "phase_2_tables",
  up: `
CREATE TABLE IF NOT EXISTS triggers (
  id                 INTEGER PRIMARY KEY,
  owning_agent       TEXT NOT NULL,
  playbook           TEXT,
  kind               TEXT NOT NULL,
  spec_json          TEXT NOT NULL,
  action             TEXT NOT NULL,
  action_payload     TEXT NOT NULL,
  created_by         TEXT NOT NULL,
  enabled            INTEGER NOT NULL DEFAULT 1,
  enabled_changed_by TEXT,
  enabled_changed_at TEXT,
  next_fire_at       TEXT,
  last_fired_at      TEXT,
  last_result        TEXT,
  created_at         TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS triggers_enabled_next_fire ON triggers (enabled, next_fire_at);

CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY,
  source          TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  deep_link       TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT ${NOW},
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_detail TEXT,
  delivered_at    TEXT
);
CREATE INDEX IF NOT EXISTS notifications_delivery_status_id ON notifications (delivery_status, id);

CREATE TABLE IF NOT EXISTS approvals (
  id                 INTEGER PRIMARY KEY,
  requesting_agent   TEXT NOT NULL,
  requesting_session INTEGER REFERENCES sessions(id),
  action             TEXT NOT NULL,
  payload_json       TEXT NOT NULL,
  requested_at       TEXT NOT NULL DEFAULT ${NOW},
  status             TEXT NOT NULL DEFAULT 'pending',
  decision           TEXT,
  decided_by         TEXT,
  decided_at         TEXT
);
CREATE INDEX IF NOT EXISTS approvals_status_id ON approvals (status, id);

CREATE TABLE IF NOT EXISTS loomwright_contract_seen (
  id                      INTEGER PRIMARY KEY,
  install_path            TEXT NOT NULL,
  plugin_version          TEXT NOT NULL,
  contract_schema_version INTEGER NOT NULL,
  contract_json           TEXT NOT NULL,
  first_seen_at           TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (install_path, plugin_version, contract_schema_version)
);
`,
};
