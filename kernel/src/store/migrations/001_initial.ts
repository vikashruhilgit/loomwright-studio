import type { Migration } from "./types.js";

// ISO-8601 UTC text, millisecond precision.
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

/**
 * The phase-1 schema (docs/ARCHITECTURE.md §Data model, plus `wakeups` and
 * `cap_state`). No phase-2+ tables: agents, playbooks, triggers, approvals,
 * hooks_installed and connectors arrive with their phases, so columns that will
 * point at them (`assignee_agent`, `agent`, `playbook`) are plain text for now.
 */
export const initial: Migration = {
  version: 1,
  name: "initial",
  up: `
CREATE TABLE tasks (
  id               INTEGER PRIMARY KEY,
  title            TEXT NOT NULL,
  kind             TEXT,
  state            TEXT NOT NULL,
  assignee_agent   TEXT,
  owner_session_id INTEGER,
  parent_task_id   INTEGER REFERENCES tasks(id),
  links_json       TEXT,
  dedupe_key       TEXT,
  next_check_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT ${NOW},
  updated_at       TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE sessions (
  id               INTEGER PRIMARY KEY,
  agent            TEXT,
  task_id          INTEGER REFERENCES tasks(id),
  sdk_session_id   TEXT,
  status           TEXT NOT NULL,
  model            TEXT,
  -- Process group id, written before the session starts (Q5).
  pgid             INTEGER,
  -- The auth account whose cap this session counts against (D27, D28).
  auth_account     TEXT,
  -- The last result.modelUsage totals, verbatim, so a resume adds only the delta (Q3).
  model_usage_json TEXT,
  started_at       TEXT,
  ended_at         TEXT,
  created_at       TEXT NOT NULL DEFAULT ${NOW},
  updated_at       TEXT NOT NULL DEFAULT ${NOW}
);

-- The append-only audit log. No foreign keys on purpose: the log must outlive
-- whatever it mentions, and a cascading key would fire the triggers below.
CREATE TABLE events (
  id           INTEGER PRIMARY KEY,
  at           TEXT NOT NULL DEFAULT ${NOW},
  kind         TEXT NOT NULL,
  actor        TEXT,
  task_id      INTEGER,
  session_id   INTEGER,
  payload_json TEXT
);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END;

-- INSERT OR REPLACE deletes the old row without firing a DELETE trigger unless
-- recursive_triggers is on; refuse any insert that would hit an existing id.
CREATE TRIGGER events_no_replace BEFORE INSERT ON events
WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM events WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'events is append-only');
END;

-- Token usage per query end (D26): read from result.modelUsage per model.
-- A limit counts input + output + cache-write tokens; cache reads are recorded
-- but do not count.
CREATE TABLE budget (
  id                 INTEGER PRIMARY KEY,
  day                TEXT NOT NULL,
  session_id         INTEGER REFERENCES sessions(id),
  agent              TEXT,
  playbook           TEXT,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  counted_tokens     INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens + cache_write_tokens) VIRTUAL,
  cost_usd           REAL,
  recorded_at        TEXT NOT NULL DEFAULT ${NOW}
);

-- Makes each kernel tool's effect happen at most once across a crash (D2).
CREATE TABLE work_steps (
  id          INTEGER PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL CHECK (status IN ('started', 'done', 'failed')),
  result_json TEXT,
  created_at  TEXT NOT NULL DEFAULT ${NOW},
  updated_at  TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE wakeups (
  id         INTEGER PRIMARY KEY,
  due_at     TEXT NOT NULL,
  reason     TEXT NOT NULL,
  task_id    INTEGER REFERENCES tasks(id),
  status     TEXT NOT NULL DEFAULT 'pending',
  fired_at   TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE INDEX wakeups_status_due ON wakeups (status, due_at);

-- Subscription cap state per account and rate-limit type (D28).
CREATE TABLE cap_state (
  account         TEXT NOT NULL,
  rate_limit_type TEXT NOT NULL,
  status          TEXT NOT NULL,
  resets_at       TEXT,
  updated_at      TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (account, rate_limit_type)
);
`,
};
