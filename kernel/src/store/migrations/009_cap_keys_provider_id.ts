import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/**
 * The provider ids the kernel registered when this migration was written:
 * `API_KEY_PROVIDER_ID` (src/auth/api-key.ts) and
 * `SUBSCRIPTION_TOKEN_PROVIDER_ID` (src/auth/subscription-token.ts), the two
 * src/auth/registry.ts can select. A literal on purpose: a migration is frozen
 * and must not follow a later rename. A provider without an `auth_providers`
 * row still keys its parks on its id (its label falls back to the id), so
 * this list, not the table alone, says which keys may belong to a provider.
 */
export const KNOWN_PROVIDER_IDS: readonly string[] = ["api-key", "subscription-token"];

/**
 * Key cap parks on the auth provider's stable id, never its account label
 * (F06-1). Until now the cap tracker and admission keyed `cap_state.account`
 * and the `cap_reset:<key>` / `cap_recheck:<key>` wake-up reasons on the
 * provider's live label, so relabelling the account (the first
 * `recordTokenCreated`, a setup or rotation flow) lifted a park in force and
 * the next rejection parked and notified a second time. The kernel now keys
 * on the id (`authProvider.id`); this carries the label-keyed state to it.
 *
 * For each label of an `auth_providers` row whose label differs from its id
 * (the providers sharing that label are its targets):
 *
 * - every `cap_state` row keyed on the label is merged into each target. On a
 *   primary-key conflict (a row already under the target for that
 *   `rate_limit_type`) the more conservative row is kept (fail closed): a
 *   `rejected` row beats a non-`rejected` one; between two `rejected` rows
 *   the later `resets_at` wins, `NULL` (unknown, unexpired) counting as
 *   latest; otherwise (a tie, or neither `rejected`) the target row stays.
 * - every `pending` wake-up `cap_reset:<label>` / `cap_recheck:<label>` the
 *   budget module wrote is carried to `cap_reset:<target>` /
 *   `cap_recheck:<target>`; a copy is skipped when the target already has a
 *   pending row with that reason and due time. A row with a
 *   `wakeup_scheduled` audit event was written by a session through
 *   `scheduleWakeup` (free text, before those prefixes were reserved) and is
 *   left as it is. Fired (and any other non-pending) rows are history and
 *   stay as they are.
 *
 * Move or copy, by whether the label could itself be a provider's key:
 *
 * - A label that is no provider's id (neither an `auth_providers` id nor in
 *   `KNOWN_PROVIDER_IDS`) belongs to its targets only: its `cap_state` rows
 *   are deleted after the merge, and each pending wake-up moves to the first
 *   target (a copy for every further target).
 * - A label that could be a provider's id (an `auth_providers` id or a known
 *   id, with or without a row) may hold that provider's own park: its rows
 *   are COPIED to the targets and KEPT, so neither the label's providers nor
 *   the id's provider loses a park (fail closed). A kept row that no provider
 *   uses is harmless once its reset passes; a kept wake-up fires once as
 *   "ask admission again".
 *
 * Rows keyed on a value that is no provider's label (today: the provider id
 * itself) are untouched. `events` (append-only) is never modified, and
 * `sessions.auth_account` stays the display label it was frozen as.
 *
 * Safe to re-run on a database it already migrated. A moved label leaves no
 * `cap_state` row and no budget-written pending wake-up behind (the kernel
 * writes only ids, and typed `cap_*:<id>:<type>` reasons never equal
 * `cap_*:<label>`), so a re-run finds nothing to move. A kept label's rows
 * are copied again: the conservative merge keeps the more conservative of
 * the kept row and the target's current one (never lifting a park), and the
 * wake-up copy is skipped while an identical pending one exists. The store's
 * integrity check relies on this when a deleted top `schema_migrations` row
 * makes migrations 8 and 9 run again.
 */
export const capKeysProviderId: Migration = {
  version: 9,
  name: "cap_keys_provider_id",
  up: (db) => {
    const providers = db.prepare("SELECT id, account FROM auth_providers ORDER BY id").all() as { id: string; account: string }[];
    const providerKeys = new Set([...KNOWN_PROVIDER_IDS, ...providers.map((p) => p.id)]);
    const byLabel = new Map<string, string[]>();
    for (const p of providers) {
      // A provider labelled with its own id already keys its rows on the id.
      if (p.account === p.id) continue;
      const list = byLabel.get(p.account) ?? [];
      list.push(p.id);
      byLabel.set(p.account, list);
    }
    for (const [label, targets] of byLabel) {
      // A label that could be a provider's own key is copied and kept, never moved (fail closed).
      const keep = providerKeys.has(label);
      mergeCapRows(db, label, targets, keep);
      carryWakeups(db, label, targets, keep);
    }
  },
};

interface CapStateRow {
  readonly rate_limit_type: string;
  readonly status: string;
  readonly resets_at: string | null;
  readonly updated_at: string;
  readonly utilization: number | null;
  readonly unified_windows_json: string | null;
  readonly reset_source: string | null;
  readonly notified_resets_at: string | null;
  readonly warned_resets_at: string | null;
}

const CAP_COLUMNS =
  "rate_limit_type, status, resets_at, updated_at, utilization, unified_windows_json, reset_source, notified_resets_at, warned_resets_at";

/** Whether `candidate` is more conservative than `current` (the merge rule in the header). */
function moreConservative(candidate: CapStateRow, current: CapStateRow): boolean {
  const a = candidate.status === "rejected";
  const b = current.status === "rejected";
  if (a !== b) return a;
  if (!a) return false;
  if (current.resets_at === null) return false;
  if (candidate.resets_at === null) return true;
  return candidate.resets_at > current.resets_at;
}

function mergeCapRows(db: Database.Database, label: string, targets: readonly string[], keep: boolean): void {
  const rows = db.prepare(`SELECT ${CAP_COLUMNS} FROM cap_state WHERE account = ?`).all(label) as CapStateRow[];
  const find = db.prepare(`SELECT ${CAP_COLUMNS} FROM cap_state WHERE account = ? AND rate_limit_type = ?`);
  const write = db.prepare(
    `INSERT INTO cap_state (account, ${CAP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account, rate_limit_type) DO UPDATE SET
       status = excluded.status, resets_at = excluded.resets_at, updated_at = excluded.updated_at,
       utilization = excluded.utilization, unified_windows_json = excluded.unified_windows_json,
       reset_source = excluded.reset_source, notified_resets_at = excluded.notified_resets_at,
       warned_resets_at = excluded.warned_resets_at`,
  );
  for (const row of rows) {
    for (const id of targets) {
      const current = find.get(id, row.rate_limit_type) as CapStateRow | undefined;
      if (current !== undefined && !moreConservative(row, current)) continue;
      write.run(
        id,
        row.rate_limit_type,
        row.status,
        row.resets_at,
        row.updated_at,
        row.utilization,
        row.unified_windows_json,
        row.reset_source,
        row.notified_resets_at,
        row.warned_resets_at,
      );
    }
  }
  if (!keep) db.prepare("DELETE FROM cap_state WHERE account = ?").run(label);
}

/** A pending wake-up the budget module wrote: `scheduleWakeup` audits every row it writes with `wakeup_scheduled`. */
const BUDGET_WRITTEN = `NOT EXISTS (SELECT 1 FROM events e WHERE e.kind = 'wakeup_scheduled'
  AND json_extract(e.payload_json, '$.wakeup_id') = wakeups.id)`;

function carryWakeups(db: Database.Database, label: string, targets: readonly string[], keep: boolean): void {
  const [first, ...rest] = targets;
  if (first === undefined) return;
  const copy = db.prepare(
    `INSERT INTO wakeups (due_at, reason, task_id, status, created_at, updated_at)
     SELECT ?, ?, ?, 'pending', ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM wakeups WHERE status = 'pending' AND reason = ? AND due_at = ?)`,
  );
  const move = db.prepare("UPDATE wakeups SET reason = ? WHERE id = ? AND status = 'pending'");
  for (const kind of ["cap_reset", "cap_recheck"]) {
    const pending = db
      .prepare(
        `SELECT id, due_at, task_id, created_at, updated_at FROM wakeups
          WHERE status = 'pending' AND reason = ? AND ${BUDGET_WRITTEN} ORDER BY id`,
      )
      .all(`${kind}:${label}`) as { id: number; due_at: string; task_id: number | null; created_at: string; updated_at: string }[];
    // Kept: a copy for every target. Moved: a copy for every further target, then the row itself moves to the first.
    for (const id of keep ? targets : rest) {
      const reason = `${kind}:${id}`;
      for (const w of pending) copy.run(w.due_at, reason, w.task_id, w.created_at, w.updated_at, reason, w.due_at);
    }
    if (!keep) for (const w of pending) move.run(`${kind}:${first}`, w.id);
  }
}
