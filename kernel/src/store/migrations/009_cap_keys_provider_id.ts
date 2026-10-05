import type Database from "better-sqlite3";
import type { Migration } from "./types.js";

/**
 * Key cap parks on the auth provider's stable id, never its account label
 * (F06-1). Until now the cap tracker and admission keyed `cap_state.account`
 * and the `cap_reset:<key>` / `cap_recheck:<key>` wake-up reasons on the
 * provider's live label, so relabelling the account (the first
 * `recordTokenCreated`, a setup or rotation flow) lifted a park in force and
 * the next rejection parked and notified a second time. The kernel now keys
 * on the id (`authProvider.id`); this moves the label-keyed state to it.
 *
 * For each `auth_providers` row whose label differs from its id:
 *
 * - every `cap_state` row keyed on the label moves to the id, then the label
 *   row is deleted. On a primary-key conflict (a row already under the id for
 *   that `rate_limit_type`) the more conservative row is kept (fail closed):
 *   a `rejected` row beats a non-`rejected` one; between two `rejected` rows
 *   the later `resets_at` wins, `NULL` (unknown, unexpired) counting as
 *   latest; otherwise (a tie, or neither `rejected`) the id row stays.
 * - every `pending` wake-up `cap_reset:<label>` / `cap_recheck:<label>` is
 *   rewritten to `cap_reset:<id>` / `cap_recheck:<id>`. Fired (and any other
 *   non-pending) rows are history and stay as they are.
 *
 * A label shared by several providers is copied to each of them (fail
 * closed: every provider that may have been parked stays parked). A label
 * that equals ANY provider's id is skipped entirely: its rows already belong
 * to that provider (the label's fallback is the id itself), and moving them
 * would lift that provider's park (fail open). Rows keyed on a value that is
 * no provider's label (today: the provider id itself) are untouched.
 *
 * `events` (append-only) is never modified, and `sessions.auth_account`
 * stays the display label it was frozen as. In practice a label row is only
 * ever this kernel's one provider's.
 *
 * Safe to re-run on a database it already migrated (a no-op): afterwards no
 * `cap_state` row and no pending wake-up is keyed on a label (the kernel
 * writes only ids, and typed `cap_*:<id>:<type>` reasons never equal
 * `cap_*:<label>`), so a re-run finds nothing to move. The store's integrity
 * check relies on this when a deleted top `schema_migrations` row makes
 * migrations 8 and 9 run again.
 */
export const capKeysProviderId: Migration = {
  version: 9,
  name: "cap_keys_provider_id",
  up: (db) => {
    const providers = db.prepare("SELECT id, account FROM auth_providers ORDER BY id").all() as { id: string; account: string }[];
    const ids = new Set(providers.map((p) => p.id));
    const byLabel = new Map<string, string[]>();
    for (const p of providers) {
      // A label equal to any provider id (its own included) already names that provider: skipped.
      if (ids.has(p.account)) continue;
      const list = byLabel.get(p.account) ?? [];
      list.push(p.id);
      byLabel.set(p.account, list);
    }
    for (const [label, targets] of byLabel) {
      moveCapRows(db, label, targets);
      moveWakeups(db, label, targets);
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

function moveCapRows(db: Database.Database, label: string, targets: readonly string[]): void {
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
  db.prepare("DELETE FROM cap_state WHERE account = ?").run(label);
}

function moveWakeups(db: Database.Database, label: string, targets: readonly string[]): void {
  const [first, ...rest] = targets;
  if (first === undefined) return;
  for (const kind of ["cap_reset", "cap_recheck"]) {
    const from = `${kind}:${label}`;
    const pending = db
      .prepare("SELECT due_at, task_id, created_at, updated_at FROM wakeups WHERE status = 'pending' AND reason = ? ORDER BY id")
      .all(from) as { due_at: string; task_id: number | null; created_at: string; updated_at: string }[];
    // A copy for every further provider sharing the label (fail closed), then the row itself moves to the first.
    const copy = db.prepare(
      "INSERT INTO wakeups (due_at, reason, task_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)",
    );
    for (const id of rest) for (const w of pending) copy.run(w.due_at, `${kind}:${id}`, w.task_id, w.created_at, w.updated_at);
    db.prepare("UPDATE wakeups SET reason = ? WHERE status = 'pending' AND reason = ?").run(`${kind}:${first}`, from);
  }
}
