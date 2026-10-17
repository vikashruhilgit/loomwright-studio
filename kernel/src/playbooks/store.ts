// The playbooks feature's store: every read and write of `playbooks` and
// `playbook_versions` (migration 13). Wright's tools and the owner's routes
// (`./drafts.ts`) only call these functions. Mechanism only (invariant 1):
// every policy value an agent gives is a proposal (`*_set_by = 'wright'`), the
// owner sets any of them (`'owner'`), and an agent can never overwrite the
// owner's value or change a playbook the owner turned off.
//
// Every change runs in ONE transaction (a savepoint inside the caller's, such
// as a tool's work step) that writes the row, the version snapshot when it
// makes a version, the linked trigger (through the triggers feature's public
// index: `registerTrigger` / `updateTriggerSpec`, so a refused spec rolls the
// whole change back) and exactly one audit event of its own `playbook_*` kind
// (`PLAYBOOK_AUDIT_KINDS`), so all of it commits or rolls back together.
//
// Versions: a create is version 1 with its snapshot; every update or owner
// set that changes something makes the next version, with one
// `playbook_versions` row holding the full row after the change, and puts an
// `enabled` playbook back to `draft` (a `disabled` one stays `disabled`). A
// change that changes nothing writes nothing. Disabling makes no version.
//
// Who turned a playbook off is read from the append-only log (the newest
// `playbook_disabled` for it), as the triggers feature reads its toggles:
// there is no `disabled_by` column.
//
// The `studio` CLI loads this module (through `./drafts.ts`): it imports only
// `../loop/internal.js`, the triggers feature's public index and this
// feature's types, never the Agent SDK, the session manager or `kernel.ts`.
import { appendEvent } from "../loop/internal.js";
import type { EventRef } from "../loop/internal.js";
import type { Store } from "../store/store.js";
import { TRIGGER_KINDS, TriggerError, listTriggers, registerTrigger, updateTriggerSpec } from "../triggers/index.js";
import type { TriggerView } from "../triggers/index.js";
import { DEDUPE_KEY_FIELDS, PLAYBOOK_PRIORITIES } from "./types.js";
import type { PlaybookPriority, PolicySetter } from "./types.js";

/**
 * The audit event kinds the playbooks feature appends (actor `kernel`), one
 * per change: this store's, then the dry run's (`./dry-run.ts`) and the
 * owner-approved enable's (`enablePlaybook`).
 */
export const PLAYBOOK_AUDIT_KINDS = ["playbook_created", "playbook_updated", "playbook_disabled", "playbook_dry_run", "playbook_enabled"] as const;

/** The policy fields a playbook change names (`playbook_updated.fields`) and the owner's `set` takes. */
export const PLAYBOOK_POLICY_FIELDS = ["dedupe_key", "priority", "model", "token_limit"] as const;
export type PlaybookPolicyField = (typeof PLAYBOOK_POLICY_FIELDS)[number];

/** Every field `updatePlaybook` takes, in the order a `playbook_updated` event lists them. */
export const PLAYBOOK_CHANGE_FIELDS = ["name", "intent", "trigger", ...PLAYBOOK_POLICY_FIELDS] as const;
export type PlaybookChangeField = (typeof PLAYBOOK_CHANGE_FIELDS)[number];

export const MAX_PLAYBOOK_NAME = 200;
export const MAX_PLAYBOOK_INTENT = 2_000;
export const MAX_PLAYBOOK_MODEL = 200;
/** A slug is cut to this many characters before a `-2`, `-3`, … suffix. */
export const MAX_SLUG_BASE = 48;

/** The owner's word, on the CLI and the `set` route, for clearing a nullable policy field. */
export const CLEAR_VALUE = "none";

/** Why a playbook operation was refused; `message` starts with the field it is about, or names the problem. */
export type PlaybookErrorCode = "invalid_input" | "not_found" | "not_owner" | "owner_off";

export class PlaybookError extends Error {
  readonly code: PlaybookErrorCode;

  constructor(code: PlaybookErrorCode, message: string) {
    super(message);
    this.name = "PlaybookError";
    this.code = code;
  }
}

/** A `playbooks` row as stored (every column of migration 13). */
export interface PlaybookRow {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly owning_agent: string;
  readonly intent: string;
  readonly status: string;
  readonly version: number;
  /** A JSON array of `DEDUPE_KEY_FIELDS` values, or null. */
  readonly dedupe_key_spec: string | null;
  readonly dedupe_key_set_by: string | null;
  readonly priority: string;
  readonly priority_set_by: string | null;
  readonly model: string | null;
  readonly model_set_by: string | null;
  readonly effort: string | null;
  readonly effort_set_by: string | null;
  readonly token_limit_per_day: number | null;
  readonly token_limit_set_by: string | null;
  readonly api_key_fallback_json: string | null;
  readonly api_key_fallback_set_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** A playbook as listed: its row, its linked trigger's id and next fire (null when it has none). */
export interface PlaybookListing extends PlaybookRow {
  readonly trigger_id: number | null;
  readonly next_fire_at: string | null;
}

/** What a change came to: the row after it, its linked trigger, and whether anything was written. */
export interface PlaybookChange {
  readonly playbook: PlaybookRow;
  readonly trigger: TriggerView | null;
  /** `false`: it already was so (nothing written, no version, no event). */
  readonly changed: boolean;
}

/** A playbook's trigger as an agent gives it: `once` with an instant, or `cron` with an expression and an IANA zone. */
export interface PlaybookTriggerInput {
  readonly kind: string;
  readonly spec: string;
  readonly tz?: string | undefined;
}

/** Each policy field's value column and who-set-it column. */
const POLICY_COLUMNS: Readonly<Record<PlaybookPolicyField, { readonly value: keyof PlaybookRow; readonly setBy: keyof PlaybookRow }>> = {
  dedupe_key: { value: "dedupe_key_spec", setBy: "dedupe_key_set_by" },
  priority: { value: "priority", setBy: "priority_set_by" },
  model: { value: "model", setBy: "model_set_by" },
  token_limit: { value: "token_limit_per_day", setBy: "token_limit_set_by" },
};

type ColumnValue = string | number | null;

const WRIGHT: PolicySetter = "wright";
const OWNER: PolicySetter = "owner";

function invalid(message: string): PlaybookError {
  return new PlaybookError("invalid_input", message);
}

function isOneOf<T extends string>(set: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (set as readonly string[]).includes(value);
}

/** A value from the input, short and quoted, for a refusal's message. */
function shown(value: unknown): string {
  const s = JSON.stringify(typeof value === "string" ? value : (value ?? null)) ?? "undefined";
  return s.length > 66 ? `${s.slice(0, 64)}…` : s;
}

// ---- Validation (before any write) -------------------------------------------

function checkAgent(agent: unknown): string {
  if (typeof agent !== "string" || agent === "" || agent.includes("\u0000")) throw invalid("a playbook needs an owning agent");
  return agent;
}

function checkName(name: unknown): string {
  if (typeof name !== "string" || name.trim() === "" || name.length > MAX_PLAYBOOK_NAME) {
    throw invalid(`name must be 1-${MAX_PLAYBOOK_NAME} characters, not blank`);
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) throw invalid("name must be one line, with no NUL or other control character");
  return name;
}

function checkIntent(intent: unknown): string {
  if (typeof intent !== "string" || intent.trim() === "") throw invalid("intent must not be empty");
  if (intent.length > MAX_PLAYBOOK_INTENT) throw invalid(`intent must be at most ${MAX_PLAYBOOK_INTENT} characters`);
  if (intent.includes("\u0000")) throw invalid("intent must not contain a NUL character");
  return intent;
}

function checkTriggerInput(trigger: unknown): PlaybookTriggerInput {
  const t = trigger as { kind?: unknown; spec?: unknown; tz?: unknown } | null;
  if (typeof t !== "object" || t === null || typeof t.kind !== "string" || typeof t.spec !== "string" || (t.tz !== undefined && typeof t.tz !== "string")) {
    throw invalid(`trigger must be {kind: once, spec} or {kind: cron, spec, tz}`);
  }
  return { kind: t.kind, spec: t.spec, ...(t.tz === undefined ? {} : { tz: t.tz }) };
}

/**
 * `value` for policy field `field` as its column stores it, or a refusal
 * (`invalid_input`, message starting with the field name). `null` clears a
 * nullable field, and only when `allowClear` (the owner's `none`); `priority`
 * cannot be cleared.
 */
export function checkPolicyValue(field: PlaybookPolicyField, value: unknown, allowClear: boolean): ColumnValue {
  if (value === null && allowClear && field !== "priority") return null;
  switch (field) {
    case "dedupe_key": {
      if (!Array.isArray(value) || value.length === 0) {
        throw invalid(`dedupe_key must be a non-empty list of distinct fields from ${DEDUPE_KEY_FIELDS.join(", ")}`);
      }
      const seen = new Set<string>();
      for (const f of value) {
        if (!isOneOf(DEDUPE_KEY_FIELDS, f)) throw invalid(`dedupe_key: unknown field ${shown(f)} (the fields are ${DEDUPE_KEY_FIELDS.join(", ")})`);
        if (seen.has(f)) throw invalid(`dedupe_key: field ${f} is listed twice`);
        seen.add(f);
      }
      return JSON.stringify(value);
    }
    case "priority":
      if (!isOneOf(PLAYBOOK_PRIORITIES, value)) throw invalid(`priority must be one of ${PLAYBOOK_PRIORITIES.join(", ")} (got ${shown(value)})`);
      return value;
    case "model":
      if (typeof value !== "string" || !/^[^\s\u0000-\u001f\u007f]{1,200}$/.test(value)) {
        throw invalid(`model must be 1-${MAX_PLAYBOOK_MODEL} characters with no whitespace, NUL or other control character`);
      }
      return value;
    case "token_limit":
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw invalid("token_limit must be a positive whole number of tokens per day");
      return value;
  }
}

/**
 * The owner's typed `<value>` for `<field>` (`studio playbooks set`, the
 * `set` route) as the value `setPlaybookPolicy` takes: `none` clears a
 * nullable field; a dedupe key is comma-separated fields; a token limit is a
 * decimal integer. Throws `invalid_input` naming the field (an unknown field
 * names `field`). Pure: the CLI checks with it before calling the API.
 */
export function parseOwnerPolicyValue(field: string, raw: string): { readonly field: PlaybookPolicyField; readonly value: unknown } {
  if (!isOneOf(PLAYBOOK_POLICY_FIELDS, field)) throw invalid(`field must be one of ${PLAYBOOK_POLICY_FIELDS.join(", ")} (got ${shown(field)})`);
  if (typeof raw !== "string") throw invalid(`${field}: the value must be a string`);
  let value: unknown = raw;
  if (raw === CLEAR_VALUE) {
    if (field === "priority") throw invalid(`priority cannot be cleared: it is one of ${PLAYBOOK_PRIORITIES.join(", ")}`);
    value = null;
  } else if (field === "dedupe_key") value = raw.split(",").map((f) => f.trim());
  else if (field === "token_limit") {
    if (!/^[1-9]\d{0,15}$/.test(raw)) throw invalid("token_limit must be a positive whole number of tokens per day");
    value = Number(raw);
  }
  checkPolicyValue(field, value, true);
  return { field, value };
}

/** The policy values given among `values`, each checked, as column values (absent ⇒ not given). */
function checkGivenPolicy(values: Partial<Record<PlaybookPolicyField, unknown>>): Map<PlaybookPolicyField, ColumnValue> {
  const given = new Map<PlaybookPolicyField, ColumnValue>();
  for (const field of PLAYBOOK_POLICY_FIELDS) {
    if (values[field] !== undefined) given.set(field, checkPolicyValue(field, values[field], false));
  }
  return given;
}

// ---- Reads -----------------------------------------------------------------

function readRow(store: Store, id: number): PlaybookRow | undefined {
  return store.prepare<[number], PlaybookRow>("SELECT * FROM playbooks WHERE id = ?").get(id);
}

/** A playbook by id, or by slug (a decimal string is an id); `undefined` when there is none. */
export function getPlaybook(store: Store, ref: number | string): PlaybookRow | undefined {
  if (typeof ref === "number") return Number.isSafeInteger(ref) ? readRow(store, ref) : undefined;
  if (/^[1-9]\d{0,15}$/.test(ref)) return readRow(store, Number(ref));
  return store.prepare<[string], PlaybookRow>("SELECT * FROM playbooks WHERE slug = ?").get(ref);
}

/** The trigger linked to `row` (`triggers.playbook` = its slug, owned by its agent; the first by id), or `null`. */
export function linkedTriggerOf(store: Store, row: Pick<PlaybookRow, "slug" | "owning_agent">): TriggerView | null {
  return listTriggers(store, { all: true, agent: row.owning_agent }).find((t) => t.playbook === row.slug) ?? null;
}

export interface ListPlaybooksParams {
  /** Include `disabled` playbooks (default: `draft` and `enabled` only). */
  readonly all?: boolean;
  /** Only this agent's playbooks (default: every agent's). */
  readonly agent?: string;
}

/** Playbooks in id order, each with its linked trigger's id and next fire. */
export function listPlaybooks(store: Store, params: ListPlaybooksParams = {}): PlaybookListing[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.all !== true) where.push("status <> 'disabled'");
  if (params.agent !== undefined) {
    where.push("owning_agent = ?");
    args.push(params.agent);
  }
  const rows = store
    .prepare<unknown[], PlaybookRow>(`SELECT * FROM playbooks ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`} ORDER BY id`)
    .all(...args);
  if (rows.length === 0) return [];
  const linked = new Map<string, TriggerView>();
  for (const t of listTriggers(store, { all: true })) {
    if (t.playbook !== null && !linked.has(`${t.owning_agent}\u0000${t.playbook}`)) linked.set(`${t.owning_agent}\u0000${t.playbook}`, t);
  }
  return rows.map((row) => {
    const t = linked.get(`${row.owning_agent}\u0000${row.slug}`);
    return { ...row, trigger_id: t?.id ?? null, next_fire_at: t?.next_fire_at ?? null };
  });
}

/** One stored version of a playbook. */
export interface PlaybookVersion {
  readonly version: number;
  /** The full row at that version. */
  readonly snapshot: unknown;
  readonly created_at: string;
}

/** Playbook `id`'s versions, oldest first. */
export function listPlaybookVersions(store: Store, id: number): PlaybookVersion[] {
  return store
    .prepare<[number], { version: number; snapshot_json: string; created_at: string }>(
      "SELECT version, snapshot_json, created_at FROM playbook_versions WHERE playbook = ? ORDER BY version",
    )
    .all(id)
    .map((v) => {
      let snapshot: unknown = null;
      try {
        snapshot = JSON.parse(v.snapshot_json) as unknown;
      } catch {
        // Unreadable: null.
      }
      return { version: v.version, snapshot, created_at: v.created_at };
    });
}

/**
 * Who last turned playbook `id` off: the `by` of the newest
 * `playbook_disabled` event for it, or `null` when there is none.
 */
function lastDisabledBy(store: Store, id: number): string | null {
  const last = store
    .prepare<[number], { by: unknown }>(
      `SELECT json_extract(payload_json, '$.by') AS by FROM events
        WHERE kind = 'playbook_disabled' AND json_valid(payload_json) AND json_extract(payload_json, '$.playbook_id') = ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(id);
  return typeof last?.by === "string" ? last.by : null;
}

/**
 * Whether the owner turned this playbook off: it is `disabled` and the newest
 * `playbook_disabled` for it is not an agent's. Without an agent's event to
 * show otherwise, a `disabled` playbook counts as the owner's off (a gap in
 * the evidence never unlocks it).
 */
function ownerTurnedOff(store: Store, row: PlaybookRow): boolean {
  return row.status === "disabled" && lastDisabledBy(store, row.id) !== WRIGHT;
}

function ownerOff(id: number): PlaybookError {
  return new PlaybookError("owner_off", `playbook ${id} was turned off by the owner; an agent cannot change, disable or re-enable it`);
}

/**
 * Throws `PlaybookError("owner_off")` when the owner turned playbook `id` off
 * (a missing playbook passes). Every agent path that changes, disables or
 * enables a playbook calls it, including a repeated tool call whose stored
 * first result predates the owner's off.
 */
export function refuseIfOwnerTurnedOff(store: Store, id: number): void {
  const row = readRow(store, id);
  if (row !== undefined && ownerTurnedOff(store, row)) throw ownerOff(id);
}

// ---- Writes ----------------------------------------------------------------

/**
 * The slug `name` derives: lowercase, runs of non-`[a-z0-9]` as `-`, trimmed
 * of `-`, cut to `MAX_SLUG_BASE`; `playbook` when empty, and `playbook-<digits>`
 * when it is all digits (a ref of only digits is read as an id, so a slug must
 * never be one: `getPlaybook`).
 */
export function slugBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_BASE)
    .replace(/-+$/, "");
  if (base === "") return "playbook";
  return /^\d+$/.test(base) ? `playbook-${base}` : base;
}

/** `slugBase(name)`, or the first of `-2`, `-3`, … appended to it that no playbook has. */
function freeSlug(store: Store, name: string): string {
  const base = slugBase(name);
  const taken = store.prepare<[string], number>("SELECT 1 FROM playbooks WHERE slug = ?").pluck();
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (taken.get(slug) === undefined) return slug;
  }
}

/** A trigger refusal as the playbook's: `trigger: <message>`. Anything else is rethrown as it is. */
function asTriggerRefusal(err: unknown): unknown {
  return err instanceof TriggerError ? invalid(`trigger: ${err.message}`) : err;
}

/** Register `slug`'s linked trigger: `wake_agent` with text `Playbook <slug>` (what a fire does is item 08's). */
function registerLinked(store: Store, agent: string, slug: string, trigger: PlaybookTriggerInput, sessionId: number | null, now: Date): number {
  try {
    return registerTrigger(
      store,
      { agent, kind: trigger.kind as (typeof TRIGGER_KINDS)[number], spec: trigger.spec, tz: trigger.tz, action: "wake_agent", text: `Playbook ${slug}`, playbook: slug, sessionId },
      now,
    ).id;
  } catch (err) {
    throw asTriggerRefusal(err);
  }
}

/** Snapshot playbook `id` as it is now (every column) as version `version`. */
function writeSnapshot(store: Store, id: number, version: number, at: string): void {
  const row = readRow(store, id);
  store.prepare("INSERT INTO playbook_versions (playbook, version, snapshot_json, created_at) VALUES (?, ?, ?, ?)").run(id, version, JSON.stringify(row), at);
}

function refOf(sessionId: number | null | undefined): EventRef {
  return { sessionId: sessionId ?? null, taskId: null };
}

export interface CreatePlaybookParams {
  /** The owning agent: the calling session's `sessions.agent`. */
  readonly agent: string;
  readonly name: string;
  readonly intent: string;
  readonly trigger: PlaybookTriggerInput;
  readonly dedupe_key?: readonly string[] | undefined;
  readonly priority?: string | undefined;
  readonly model?: string | undefined;
  readonly token_limit?: number | undefined;
  /** The session that asked, for the audit rows. */
  readonly sessionId?: number | null;
}

/**
 * Create a `draft` playbook at version 1 owned by `agent`, every given policy
 * value proposed (`*_set_by = 'wright'`), with its linked trigger, its version
 * 1 snapshot and `playbook_created`, in one transaction. The slug is derived
 * from the name once. Throws `PlaybookError("invalid_input")` naming the field
 * before anything is stored (`trigger: …` for a spec the triggers feature
 * refuses).
 */
export function createPlaybook(store: Store, params: CreatePlaybookParams, now: Date): PlaybookChange {
  const agent = checkAgent(params.agent);
  const name = checkName(params.name);
  const intent = checkIntent(params.intent);
  const trigger = checkTriggerInput(params.trigger);
  const policy = checkGivenPolicy(params);
  const at = now.toISOString();
  const sessionId = params.sessionId ?? null;
  const proposed = (field: PlaybookPolicyField): PolicySetter | null => (policy.has(field) ? WRIGHT : null);
  return store.transaction((): PlaybookChange => {
    const slug = freeSlug(store, name);
    // The trigger first: its own validation refuses before the playbook is written.
    const triggerId = registerLinked(store, agent, slug, trigger, sessionId, now);
    const id = Number(
      store
        .prepare(
          `INSERT INTO playbooks (slug, name, owning_agent, intent, status, version,
             dedupe_key_spec, dedupe_key_set_by, priority, priority_set_by, model, model_set_by, token_limit_per_day, token_limit_set_by,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          slug,
          name,
          agent,
          intent,
          policy.get("dedupe_key") ?? null,
          proposed("dedupe_key"),
          policy.get("priority") ?? "normal",
          proposed("priority"),
          policy.get("model") ?? null,
          proposed("model"),
          policy.get("token_limit") ?? null,
          proposed("token_limit"),
          at,
          at,
        ).lastInsertRowid,
    );
    writeSnapshot(store, id, 1, at);
    appendEvent(store, "playbook_created", refOf(sessionId), { playbook_id: id, slug, owning_agent: agent, version: 1, by: WRIGHT, trigger_id: triggerId }, at);
    const row = readRow(store, id) as PlaybookRow;
    return { playbook: row, trigger: linkedTriggerOf(store, row), changed: true };
  });
}

/**
 * The shared update path: write `sets` (column → value) to `row` as its next
 * version (`enabled` goes back to `draft`), snapshot it, and append one
 * `playbook_updated` naming `fields`. No field ⇒ nothing written,
 * `changed: false`. Column names come only from this module, never input.
 */
function writeVersion(
  store: Store,
  row: PlaybookRow,
  sets: ReadonlyMap<string, ColumnValue>,
  fields: readonly PlaybookChangeField[],
  by: PolicySetter,
  sessionId: number | null,
  at: string,
): PlaybookChange {
  if (fields.length === 0) return { playbook: row, trigger: linkedTriggerOf(store, row), changed: false };
  const version = row.version + 1;
  // A changed playbook is a draft again: the owner reviews it before it runs.
  const status = row.status === "enabled" ? "draft" : row.status;
  const columns = [...sets.keys()];
  store
    .prepare(`UPDATE playbooks SET ${[...columns.map((c) => `${c} = ?`), "status = ?", "version = ?", "updated_at = ?"].join(", ")} WHERE id = ?`)
    .run(...columns.map((c) => sets.get(c) ?? null), status, version, at, row.id);
  writeSnapshot(store, row.id, version, at);
  appendEvent(store, "playbook_updated", refOf(sessionId), { playbook_id: row.id, version, by, fields: [...fields] }, at);
  const after = readRow(store, row.id) as PlaybookRow;
  return { playbook: after, trigger: linkedTriggerOf(store, after), changed: true };
}

/** What `updatePlaybook` may change; every key optional, at least one given. */
export interface PlaybookChanges {
  readonly name?: string | undefined;
  readonly intent?: string | undefined;
  readonly trigger?: PlaybookTriggerInput | undefined;
  readonly dedupe_key?: readonly string[] | undefined;
  readonly priority?: string | undefined;
  readonly model?: string | undefined;
  readonly token_limit?: number | undefined;
}

export interface UpdatePlaybookParams {
  readonly id: number;
  /** The calling agent: only its own playbooks. */
  readonly agent: string;
  readonly changes: PlaybookChanges;
  readonly sessionId?: number | null;
}

/** Whether `trigger` is exactly what `linked` stores (so re-scheduling would change nothing). */
function sameTrigger(linked: TriggerView, trigger: PlaybookTriggerInput): boolean {
  const spec = (linked.spec ?? {}) as { at?: unknown; cron?: unknown; tz?: unknown };
  if (linked.kind !== trigger.kind) return false;
  return trigger.kind === "once" ? trigger.tz === undefined && spec.at === trigger.spec : spec.cron === trigger.spec && spec.tz === trigger.tz;
}

/**
 * An agent's change to its own playbook: each given value that differs is
 * written as the next version (policy values proposed: `*_set_by =
 * 'wright'`), a trigger change re-schedules the SAME linked trigger
 * (`updateTriggerSpec`), all in one transaction. Throws `PlaybookError`:
 * `invalid_input` (empty `changes`; a refused value, naming the field; a
 * policy field the owner set); `not_found`; `not_owner`; `owner_off`.
 */
export function updatePlaybook(store: Store, params: UpdatePlaybookParams, now: Date): PlaybookChange {
  const agent = checkAgent(params.agent);
  const changes = (params.changes ?? {}) as PlaybookChanges;
  if (!PLAYBOOK_CHANGE_FIELDS.some((f) => changes[f] !== undefined)) throw invalid(`changes must give at least one of ${PLAYBOOK_CHANGE_FIELDS.join(", ")}`);
  const name = changes.name === undefined ? undefined : checkName(changes.name);
  const intent = changes.intent === undefined ? undefined : checkIntent(changes.intent);
  const trigger = changes.trigger === undefined ? undefined : checkTriggerInput(changes.trigger);
  const policy = checkGivenPolicy(changes);
  const at = now.toISOString();
  const sessionId = params.sessionId ?? null;
  return store.transaction((): PlaybookChange => {
    const row = readRow(store, params.id);
    if (row === undefined) throw new PlaybookError("not_found", `no playbook ${params.id}`);
    if (row.owning_agent !== agent) throw new PlaybookError("not_owner", `playbook ${row.id} belongs to agent ${row.owning_agent}; an agent can change only its own playbooks`);
    refuseIfOwnerTurnedOff(store, row.id);
    for (const field of policy.keys()) {
      // Invariant 1: Wright only proposes; the owner's value is changed only by the owner.
      if (row[POLICY_COLUMNS[field].setBy] === OWNER) throw invalid(`${field}: the owner set this value; only the owner can change it`);
    }
    const sets = new Map<string, ColumnValue>();
    const fields: PlaybookChangeField[] = [];
    if (name !== undefined && name !== row.name) {
      sets.set("name", name);
      fields.push("name");
    }
    if (intent !== undefined && intent !== row.intent) {
      sets.set("intent", intent);
      fields.push("intent");
    }
    if (trigger !== undefined) {
      const linked = linkedTriggerOf(store, row);
      if (linked === null) {
        // Its trigger was removed: a new one is linked (still one per playbook).
        registerLinked(store, row.owning_agent, row.slug, trigger, sessionId, now);
        fields.push("trigger");
      } else if (!sameTrigger(linked, trigger)) {
        let updated: { readonly changed: boolean };
        try {
          updated = updateTriggerSpec(
            store,
            { id: linked.id, agent: row.owning_agent, kind: trigger.kind as (typeof TRIGGER_KINDS)[number], spec: trigger.spec, tz: trigger.tz, sessionId },
            now,
          );
        } catch (err) {
          throw asTriggerRefusal(err);
        }
        if (updated.changed) fields.push("trigger");
      }
    }
    for (const [field, value] of policy) {
      const { value: column, setBy } = POLICY_COLUMNS[field];
      if (row[column] === value && row[setBy] === WRIGHT) continue;
      sets.set(column, value);
      sets.set(setBy, WRIGHT);
      fields.push(field);
    }
    return writeVersion(store, row, sets, fields, WRIGHT, sessionId, at);
  });
}

export interface SetPlaybookPolicyParams {
  readonly id: number;
  readonly field: string;
  /** The field's value (`parseOwnerPolicyValue` turns the owner's text into one); `null` clears a nullable field. */
  readonly value: unknown;
}

/**
 * The owner sets one policy field of any playbook (`*_set_by = 'owner'`) as
 * its next version, in one transaction; a `disabled` playbook stays disabled.
 * The same value the owner already set ⇒ `changed: false`. Throws
 * `PlaybookError`: `invalid_input` naming the field; `not_found`.
 */
export function setPlaybookPolicy(store: Store, params: SetPlaybookPolicyParams, now: Date): PlaybookChange {
  if (!isOneOf(PLAYBOOK_POLICY_FIELDS, params.field)) throw invalid(`field must be one of ${PLAYBOOK_POLICY_FIELDS.join(", ")} (got ${shown(params.field)})`);
  const field = params.field;
  const value = checkPolicyValue(field, params.value, true);
  const at = now.toISOString();
  return store.transaction((): PlaybookChange => {
    const row = readRow(store, params.id);
    if (row === undefined) throw new PlaybookError("not_found", `no playbook ${params.id}`);
    const { value: column, setBy } = POLICY_COLUMNS[field];
    const unchanged = row[column] === value && row[setBy] === OWNER;
    const sets = new Map<string, ColumnValue>([
      [column, value],
      [setBy, OWNER],
    ]);
    return writeVersion(store, row, unchanged ? new Map() : sets, unchanged ? [] : [field], OWNER, null, at);
  });
}

export interface EnablePlaybookParams {
  readonly id: number;
  /** The version the owner approved: the row must still be at it. */
  readonly version: number;
  /** The session whose retry consumed the approval, for the audit row. */
  readonly sessionId: number | null;
  /** The owner's approval the enable runs on. */
  readonly approvalId: number;
}

/**
 * Enable playbook `id` at exactly `version` (phase 3 item 07): in one
 * transaction, `status = 'enabled'` only while the row is a `draft` at that
 * version, and one `playbook_enabled` event `{playbook_id, version,
 * approval_id, by: "owner"}` (the owner approved it; the agent's retry only
 * carried it out). Makes no version. Throws `PlaybookError`: `not_found`;
 * `invalid_input` naming why otherwise (`version changed` when the row moved
 * on, or the status it has instead of `draft`). Callers check ownership and
 * the owner's off before.
 */
export function enablePlaybook(store: Store, params: EnablePlaybookParams, now: Date): PlaybookChange {
  const at = now.toISOString();
  return store.transaction((): PlaybookChange => {
    const row = readRow(store, params.id);
    if (row === undefined) throw new PlaybookError("not_found", `no playbook ${params.id}`);
    if (row.version !== params.version) {
      throw invalid(`version changed: playbook ${row.id} is at version ${row.version}, not the approved version ${params.version}`);
    }
    if (row.status !== "draft") throw invalid(`playbook ${row.id} is ${row.status}, not draft: only a draft is enabled`);
    store.prepare("UPDATE playbooks SET status = 'enabled', updated_at = ? WHERE id = ? AND version = ? AND status = 'draft'").run(at, row.id, params.version);
    appendEvent(store, "playbook_enabled", refOf(params.sessionId), { playbook_id: row.id, version: params.version, approval_id: params.approvalId, by: OWNER }, at);
    const after = readRow(store, row.id) as PlaybookRow;
    return { playbook: after, trigger: linkedTriggerOf(store, after), changed: true };
  });
}

export interface DisablePlaybookParams {
  readonly id: number;
  readonly by: PolicySetter;
  /** `by: "wright"`: the calling agent (only its own playbooks). */
  readonly agent?: string;
  readonly sessionId?: number | null;
}

/**
 * Turn a playbook off (`status = 'disabled'`) and append `playbook_disabled`
 * with `by`, in one transaction; no version. Already off ⇒ `changed: false`,
 * except that the owner's off of a playbook an agent turned off records the
 * owner as the one who turned it off (so it becomes final for agents).
 * Throws `PlaybookError`: `not_found`; for an agent, `not_owner` and
 * `owner_off`.
 */
export function disablePlaybook(store: Store, params: DisablePlaybookParams, now: Date): PlaybookChange {
  if (!isOneOf(["wright", "owner"] as const, params.by)) throw invalid("by must be wright or owner");
  const agent = params.by === WRIGHT ? checkAgent(params.agent) : null;
  const at = now.toISOString();
  return store.transaction((): PlaybookChange => {
    const row = readRow(store, params.id);
    if (row === undefined) throw new PlaybookError("not_found", `no playbook ${params.id}`);
    if (agent !== null) {
      if (row.owning_agent !== agent) throw new PlaybookError("not_owner", `playbook ${row.id} belongs to agent ${row.owning_agent}; an agent can disable only its own playbooks`);
      refuseIfOwnerTurnedOff(store, row.id);
    }
    if (row.status === "disabled" && (params.by === WRIGHT || lastDisabledBy(store, row.id) === OWNER)) {
      return { playbook: row, trigger: linkedTriggerOf(store, row), changed: false };
    }
    store.prepare("UPDATE playbooks SET status = 'disabled', updated_at = ? WHERE id = ?").run(at, row.id);
    appendEvent(store, "playbook_disabled", refOf(params.sessionId), { playbook_id: row.id, by: params.by }, at);
    const after = readRow(store, row.id) as PlaybookRow;
    return { playbook: after, trigger: linkedTriggerOf(store, after), changed: true };
  });
}
