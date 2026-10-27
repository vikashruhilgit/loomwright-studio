// The triggers feature's mechanism over the `triggers` table (migration 11):
// register, remove, list, toggle and fire. Mechanism only (invariant 1): the
// kernel fires what an agent or the owner created and invents no trigger of
// its own; the "missed" rules below are kernel defaults that playbooks may
// make configurable later (phase 3).
//
// Every change appends exactly one audit event of its own `trigger_*` kind in
// the same transaction as the change (`TRIGGER_AUDIT_KINDS`), so the change
// and its record commit or roll back together.
//
// Firing (`fireDueTriggers`, the contribution's due work): each enabled
// trigger whose next fire has come fires at most once per scheduled instant.
// One `runStep` transaction keyed `trigger:<id>:<scheduled instant>` holds the
// effect (a `notifications` row, or a `message` queue row) and the bookkeeping
// (last fired, last result, the next fire or `enabled = 0`) and the
// `trigger_fired` event, so a `kill -9` at any point either committed all of
// it (the instant is never fired again) or none (the next tick fires it).
//
// Missed instants: a `once` trigger that came due while the kernel was down
// fires once on the first tick after; a `cron` trigger fires once for all the
// instants it missed (coalesced, `missed` in `trigger_fired`) and then
// schedules its next future instant. Nothing fires while the kill switch is
// engaged (the loop does not run, and this checks too); an instant that fell
// inside a kill-switch engagement is recorded `missed_kill_switch` with a
// `trigger_missed` event after the release and never fired.
//
// The owner's pause (`../console/pause.ts`) is read the same way, but the loop
// keeps running while paused, so due triggers are processed: an instant inside
// a pause window (from the first `pause_engaged` after a release to the next
// `pause_released`, open while paused), or any due instant while the kernel is
// paused, is recorded `missed_paused` with a `trigger_missed` event (reason
// `paused`) at once and never fired. An instant in both a kill-switch and a
// pause window counts as the kill switch's.
//
// A due instant whose work step is already done (the instant was fired or
// recorded before, and the clock or a toggle put it back) is never scheduled
// again: every next fire skips done instants, and a due trigger whose step
// replays a done result is moved past it (`trigger_missed`, reason
// `already_done`) instead of staying due at it for ever.
//
// The owner's off is final for agents: an agent cannot re-enable, re-register
// (same agent, kind, schedule, action and text), re-schedule or remove a
// trigger the owner turned off (`enabled = 0`, `enabled_changed_by = 'owner'`,
// and not a `once` that was spent after its last turn-on).
// Trigger ids are never reused.
//
// A trigger linked to a playbook (`triggers.playbook`, the playbook's slug)
// never starts work unless that playbook is `enabled`: its due instant is
// recorded as a miss (`trigger_missed`, reason `playbook_not_enabled`) in the
// same per-instant work step a fire would use, so it is never fired later.
// A fire of an enabled playbook's trigger, whatever its `action`, queues the
// playbook's message instead of the stored text: one `message` event with
// payload `{agent, playbook, version, trigger_id, scheduled_at}` (the
// playbook's owning agent, id and current version) at the playbook's
// priority, `sourceRef` `playbook:<id>:<scheduled instant>`; no
// notification. What the message does is the playbooks feature's
// (`../playbooks/runs.ts`).
// The status is read with raw SQL: this module never imports the playbooks
// feature (that one depends on this one).
//
// A `poll` trigger (phase 6) belongs to a playbook; its spec is validated and
// it is fired by `./poll.ts` (`checkPollSpec`, `firePollTriggers`), never by
// `fireDueTriggers`, whose due query leaves poll rows out.
import { isKillSwitchEngaged } from "../api/kill-switch.js";
import { appendEvent, clip, errorMessage, normalizeInstant } from "../loop/internal.js";
import { enqueueEvent } from "../loop/queue.js";
import type { EnqueueParams } from "../loop/queue.js";
import { getWorkStep, runStep } from "../loop/steps.js";
import { InvalidNotificationError, MAX_NOTIFICATION_TITLE, recordNotification } from "../notifications/record.js";
import type { PollSpec } from "../integrations/types.js";
import type { Store } from "../store/store.js";
import { canonicalZone, checkTimeZone, nextCronFire, parseCron, scheduleIdentity } from "./cron.js";
import type { CronSchedule } from "./cron.js";
import { TriggerError, fireStepKey, inKillSwitchWindow, inPauseWindow, killSwitchWindows, linkedPlaybook, pauseWindows } from "./fire-shared.js";
import type { KillSwitchWindow, LinkedPlaybook, PauseWindow } from "./fire-shared.js";
import { checkPollShape, checkPollSpec, nextPollFire, parsePollSpec, storedPollIdentity } from "./poll.js";

export { TriggerError } from "./fire-shared.js";
export type { TriggerErrorCode } from "./fire-shared.js";

/**
 * `triggers.kind`. `poll` (phase 6: list a source on an interval) belongs to
 * a playbook; `./poll.ts` validates and fires it.
 */
export const TRIGGER_KINDS = ["once", "cron", "poll"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** `triggers.action`: post the stored text as a notification, or queue it as a `message` to the owning agent. */
export const TRIGGER_ACTIONS = ["notify", "wake_agent"] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];

/** `triggers.created_by`. */
export const TRIGGER_CREATORS = ["agent", "owner"] as const;
export type TriggerCreator = (typeof TRIGGER_CREATORS)[number];

/** `triggers.enabled_changed_by`: who last turned it on or off (null until someone does; kept when a `once` is spent). */
export const TRIGGER_TOGGLERS = ["owner", "agent"] as const;
export type TriggerToggler = (typeof TRIGGER_TOGGLERS)[number];

/**
 * `triggers.last_result`: the closed set of what the last due instant came to.
 * The last three are a poll's (`./poll.ts`): its source answered
 * `rate_limited`, its GitHub connector (or the kernel's client) is missing,
 * or its source answered another failure.
 */
export const TRIGGER_RESULTS = ["fired", "missed_kill_switch", "missed_paused", "rate_limited", "connector_missing", "source_error"] as const;
export type TriggerResult = (typeof TRIGGER_RESULTS)[number];

/** The audit event kinds this feature appends (actor `kernel`), one per change. */
export const TRIGGER_AUDIT_KINDS = ["trigger_registered", "trigger_removed", "trigger_fired", "trigger_missed", "trigger_toggled", "trigger_updated"] as const;

/** Longest stored text (a notification body or a message). */
export const MAX_TRIGGER_TEXT = 2_000;

/**
 * How many due instants of one trigger a fire counts at most: a `* * * * *`
 * trigger after a month down has 43 200, and counting them all would hold the
 * tick. Beyond it the audit event says `missed_at_least: true`.
 */
export const MAX_COUNTED_INSTANTS = 10_000;

/** A `triggers` row as stored. */
interface TriggerRow {
  readonly id: number;
  readonly owning_agent: string;
  readonly playbook: string | null;
  readonly kind: string;
  readonly spec_json: string;
  readonly action: string;
  readonly action_payload: string;
  readonly created_by: string;
  readonly enabled: number;
  readonly enabled_changed_by: string | null;
  readonly enabled_changed_at: string | null;
  readonly next_fire_at: string | null;
  readonly last_fired_at: string | null;
  readonly last_result: string | null;
  readonly created_at: string;
}

const COLUMNS =
  "id, owning_agent, playbook, kind, spec_json, action, action_payload, created_by, enabled, enabled_changed_by, enabled_changed_at, next_fire_at, last_fired_at, last_result, created_at";

/**
 * A `once` spec: the instant as the creator gave it (with its offset). A `cron` spec: the normalized expression and the IANA zone as given.
 * A `poll` spec: the `PollSpec` (`{source, repos, filters, interval_seconds}`, repos and filter values as given).
 */
export type TriggerSpec = { readonly at: string } | { readonly cron: string; readonly tz: string } | PollSpec;

/** A trigger as the tools, the API and the CLI report it. */
export interface TriggerView {
  readonly id: number;
  readonly owning_agent: string;
  readonly playbook: string | null;
  readonly kind: string;
  readonly spec: unknown;
  readonly action: string;
  readonly text: string;
  readonly enabled: boolean;
  readonly enabled_changed_by: string | null;
  readonly enabled_changed_at: string | null;
  /** UTC ISO-8601, or `null` when it is off or will not fire again. */
  readonly next_fire_at: string | null;
  readonly last_fired_at: string | null;
  readonly last_result: string | null;
  readonly created_by: string;
  readonly created_at: string;
}

function parseSpec(json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function view(row: TriggerRow): TriggerView {
  return {
    id: row.id,
    owning_agent: row.owning_agent,
    playbook: row.playbook,
    kind: row.kind,
    spec: parseSpec(row.spec_json),
    action: row.action,
    text: row.action_payload,
    enabled: row.enabled === 1,
    enabled_changed_by: row.enabled_changed_by,
    enabled_changed_at: row.enabled_changed_at,
    next_fire_at: row.next_fire_at,
    last_fired_at: row.last_fired_at,
    last_result: row.last_result,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

function readRow(store: Store, id: number): TriggerRow | undefined {
  return store.prepare<[number], TriggerRow>(`SELECT ${COLUMNS} FROM triggers WHERE id = ?`).get(id);
}

function isOneOf<T extends string>(set: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (set as readonly string[]).includes(value);
}

/**
 * Whether the last `trigger_toggled` of trigger `id` turned it on. Read from
 * the append-only log, newest first: a toggle writes its event in the same
 * transaction as `enabled_changed_by`, so the newest one is the toggle the
 * columns record.
 */
function lastToggleTurnedOn(store: Store, id: number): boolean {
  const last = store
    .prepare<[number], { enabled: number | null }>(
      `SELECT json_extract(payload_json, '$.enabled') AS enabled FROM events
        WHERE kind = 'trigger_toggled' AND json_valid(payload_json) AND json_extract(payload_json, '$.trigger_id') = ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(id);
  return last?.enabled === 1;
}

/**
 * Who turned this trigger off, or `null` when it is on, nobody toggled it, or
 * it is a `once` that was spent (fired or missed) after someone last turned it
 * on: a spent `once` keeps `enabled_changed_by` / `enabled_changed_at` (who
 * last toggled it), so the columns alone cannot tell a spend from an off.
 * Without a turn-on event to show otherwise, the columns' toggler is the one
 * who turned it off (closed for the owner's off).
 */
function turnedOffBy(store: Store, row: TriggerRow): string | null {
  if (row.enabled !== 0 || row.enabled_changed_by === null) return null;
  if (spentOnce(store, row)) return null;
  return row.enabled_changed_by;
}

/**
 * Whether this trigger is a `once` that is off only because it was spent
 * (fired, or its instant recorded as a miss: kill switch, pause, `already_done`,
 * `playbook_not_enabled`), not because someone turned it off. Only a toggle
 * turns a trigger off with a `trigger_toggled` event, and a spend never
 * writes one, so an off `once` that nobody toggled, or whose newest toggle
 * turned it on, was spent. (`last_result` cannot tell: a
 * `playbook_not_enabled` or `already_done` miss leaves it as it was.)
 */
function spentOnce(store: Store, row: TriggerRow): boolean {
  if (row.kind !== "once" || row.enabled !== 0) return false;
  return row.enabled_changed_by === null || lastToggleTurnedOn(store, row.id);
}

/** Whether the owner turned this trigger off (the state no agent may undo). */
function ownerTurnedOff(store: Store, row: TriggerRow): boolean {
  return turnedOffBy(store, row) === "owner";
}

/**
 * Throws `owner_off` when the owner turned trigger `id` off (a missing
 * trigger passes): for a repeated tool call, whose stored first result
 * predates the owner's off.
 */
export function refuseIfOwnerOff(store: Store, id: number): void {
  const row = readRow(store, id);
  if (row !== undefined && ownerTurnedOff(store, row)) throw ownerOff(id);
}

function ownerOff(id: number): TriggerError {
  return new TriggerError("owner_off", `trigger ${id} was turned off by the owner; an agent cannot turn it back on, re-register or remove it`);
}

/** A validated spec: what is stored and when it first fires. */
interface CheckedSpec {
  readonly spec: TriggerSpec;
  /**
   * Compared to find a re-registration of a trigger the owner turned off:
   * built from what the spec means, not how it is written (`cronIdentity`).
   */
  readonly identity: string;
  readonly nextFireAt: string;
}

/**
 * Validate a spec at `now`. `once`: an ISO-8601 instant with an explicit `Z`
 * or offset, strictly after `now`, and no `tz`. `cron`: a 5-field expression
 * and an IANA `tz`, with a next fire within eight years. `poll`: the
 * `PollSpec` as JSON text (`checkPollSpec`, which also reads the connector).
 * Throws `TriggerError("invalid_spec")` naming the problem, or a poll's
 * own `poll_*` code.
 */
function checkSpec(store: Store, kind: TriggerKind, spec: string, tz: string | undefined, now: Date): CheckedSpec {
  const invalid = (why: string): TriggerError => new TriggerError("invalid_spec", why);
  if (kind === "poll") return checkPollSpec(store, spec, tz, now);
  if (kind === "once") {
    if (tz !== undefined) throw invalid("a once spec carries its own offset (2026-10-14T17:00:00+05:30); tz is for cron");
    const at = normalizeInstant(spec);
    if (at === undefined) throw invalid(`once spec ${JSON.stringify(spec)} is not an ISO-8601 instant with a time zone (2026-10-14T17:00:00+05:30)`);
    if (Date.parse(at) <= now.getTime()) throw invalid(`once spec ${JSON.stringify(spec)} (${at}) is in the past (now ${now.toISOString()})`);
    return { spec: { at: spec }, identity: `once ${at}`, nextFireAt: at };
  }
  if (tz === undefined) throw invalid("a cron trigger needs an IANA time zone (tz, e.g. Asia/Kolkata)");
  let zone: string;
  let next: Date | undefined;
  let schedule: CronSchedule;
  let identity: string;
  try {
    zone = checkTimeZone(tz);
    schedule = parseCron(spec);
    identity = cronIdentity(schedule, zone);
    next = nextCronFire(schedule, zone, now);
  } catch (err) {
    throw invalid(errorMessage(err));
  }
  if (next === undefined) throw invalid(`cron ${JSON.stringify(spec)} never fires (no matching day within eight years)`);
  return { spec: { cron: schedule.expr, tz: zone }, identity, nextFireAt: next.toISOString() };
}

/**
 * A cron trigger's identity: the schedule's value sets and the zone as ICU
 * resolves it, so `1-5` and `1,2,3,4,5`, or `Asia/Calcutta` and
 * `Asia/Kolkata`, are the same trigger. A spec that differs in meaning is a
 * different trigger (the owner sees every trigger, and can turn it off too).
 */
function cronIdentity(schedule: CronSchedule, zone: string): string {
  return `cron ${scheduleIdentity(schedule)} ${canonicalZone(zone)}`;
}

/** The stored spec's identity (see `CheckedSpec.identity`), or `undefined` when it cannot be read. */
function storedIdentity(row: TriggerRow): string | undefined {
  if (row.kind === "poll") return storedPollIdentity(row.spec_json);
  const spec = parseSpec(row.spec_json) as { at?: unknown; cron?: unknown; tz?: unknown } | null;
  if (spec === null || typeof spec !== "object") return undefined;
  if (row.kind === "once") {
    const at = normalizeInstant(spec.at);
    return at === undefined ? undefined : `once ${at}`;
  }
  if (typeof spec.cron !== "string" || typeof spec.tz !== "string") return undefined;
  try {
    return cronIdentity(parseCron(spec.cron), spec.tz);
  } catch {
    return undefined;
  }
}

export interface RegisterParams {
  /** The owning agent: the calling session's `sessions.agent`. */
  readonly agent: string;
  readonly kind: TriggerKind;
  /** `once`: the instant with its offset; `cron`: the 5-field expression. */
  readonly spec: string;
  /** `cron` only: the IANA zone. */
  readonly tz?: string | undefined;
  readonly action: TriggerAction;
  readonly text: string;
  /** The session that asked, for the audit row. */
  readonly sessionId?: number | null;
  /**
   * The slug of the playbook this trigger belongs to (`triggers.playbook`):
   * set only by the playbooks feature. Absent: an ordinary trigger (null).
   */
  readonly playbook?: string | undefined;
}

export interface Registered {
  readonly id: number;
  /** UTC ISO-8601: when it will first fire. */
  readonly next_fire_at: string;
}

function checkText(text: unknown): string {
  if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TRIGGER_TEXT) {
    throw new TriggerError("invalid_input", `a trigger's text must be 1-${MAX_TRIGGER_TEXT} characters`);
  }
  // `recordNotification` refuses a NUL (a `notify` body is this text): refused here, before anything is stored.
  if (text.includes("\u0000")) throw new TriggerError("invalid_input", "a trigger's text must not contain a NUL character");
  return text;
}

/**
 * The id a new trigger gets: one above the highest any trigger ever had, from
 * the rows and from the append-only `trigger_registered` / `trigger_removed`
 * events. `id INTEGER PRIMARY KEY` alone would hand a removed highest id to
 * the next row, and old notifications (`source` `trigger:<id>`), audit events,
 * work-step keys (`trigger:<id>:<instant>`) and the owner's `studio triggers
 * off <id>` would then point at a trigger the owner never saw.
 */
function nextTriggerId(store: Store): number {
  const row = store
    .prepare<[], { id: number }>(
      `SELECT max(
         coalesce((SELECT max(id) FROM triggers), 0),
         coalesce((SELECT max(CAST(json_extract(payload_json, '$.trigger_id') AS INTEGER)) FROM events
                    WHERE kind IN ('trigger_registered', 'trigger_removed') AND json_valid(payload_json)), 0)
       ) + 1 AS id`,
    )
    .get();
  return Number(row?.id ?? 1);
}

/**
 * Create an agent's trigger (`created_by` `agent`, enabled) and append
 * `trigger_registered`, in one transaction (a savepoint inside the caller's).
 * Throws `TriggerError` before any write: `invalid_input` for an unknown kind
 * or action, an empty agent or text; `invalid_spec` for a spec `checkSpec`
 * refuses; `owner_off` when the owner turned off a trigger of this agent with
 * the same kind, schedule (`CheckedSpec.identity`), action and text.
 */
export function registerTrigger(store: Store, params: RegisterParams, now: Date): Registered {
  if (typeof params.agent !== "string" || params.agent === "") throw new TriggerError("invalid_input", "a trigger needs an owning agent");
  if (params.agent.includes("\u0000")) throw new TriggerError("invalid_input", "a trigger's owning agent must not contain a NUL character");
  if (!isOneOf(TRIGGER_KINDS, params.kind)) throw new TriggerError("invalid_input", `kind must be one of ${TRIGGER_KINDS.join(", ")}`);
  if (!isOneOf(TRIGGER_ACTIONS, params.action)) throw new TriggerError("invalid_input", `action must be one of ${TRIGGER_ACTIONS.join(", ")}`);
  const text = checkText(params.text);
  const playbook = checkPlaybook(params.playbook);
  if (params.kind === "poll" && playbook === null) throw pollNeedsPlaybook();
  const checked = checkSpec(store, params.kind, params.spec, params.tz, now);
  const at = now.toISOString();
  return store.transaction((): Registered => {
    const offByOwner = store
      .prepare<[string, string, string, string], TriggerRow>(
        `SELECT ${COLUMNS} FROM triggers
          WHERE owning_agent = ? AND kind = ? AND action = ? AND action_payload = ? AND enabled = 0 AND enabled_changed_by = 'owner'
          ORDER BY id`,
      )
      .all(params.agent, params.kind, params.action, text)
      .find((row) => storedIdentity(row) === checked.identity && ownerTurnedOff(store, row));
    if (offByOwner !== undefined) throw ownerOff(offByOwner.id);
    const id = nextTriggerId(store);
    store
      .prepare(
        `INSERT INTO triggers (id, owning_agent, playbook, kind, spec_json, action, action_payload, created_by, enabled, next_fire_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'agent', 1, ?, ?)`,
      )
      .run(id, params.agent, playbook, params.kind, JSON.stringify(checked.spec), params.action, text, checked.nextFireAt, at);
    appendEvent(
      store,
      "trigger_registered",
      { sessionId: params.sessionId ?? null, taskId: null },
      {
        trigger_id: id,
        owning_agent: params.agent,
        ...(playbook === null ? {} : { playbook }),
        kind: params.kind,
        spec: checked.spec,
        action: params.action,
        text,
        created_by: "agent",
        next_fire_at: checked.nextFireAt,
      },
      at,
    );
    return { id, next_fire_at: checked.nextFireAt };
  });
}

/** A `poll` with no playbook link: its fire's `source_ref` is the playbook's (`playbook:<id>:<instant>:<item>`). */
function pollNeedsPlaybook(): TriggerError {
  return new TriggerError("invalid_input", "a poll trigger must belong to a playbook; create it through a playbook's trigger");
}

/** A playbook link as stored: `null` when absent; otherwise 1-200 characters, no control character. */
function checkPlaybook(playbook: unknown): string | null {
  if (playbook === undefined || playbook === null) return null;
  if (typeof playbook !== "string" || playbook === "" || playbook.length > 200 || /[\u0000-\u001f\u007f]/.test(playbook)) {
    throw new TriggerError("invalid_input", "a trigger's playbook must be 1-200 characters with no control character");
  }
  return playbook;
}

export interface UpdateSpecParams {
  readonly id: number;
  /** The calling agent: only its own triggers can be re-scheduled. */
  readonly agent: string;
  readonly kind: TriggerKind;
  /** `once`: the instant with its offset; `cron`: the 5-field expression. */
  readonly spec: string;
  /** `cron` only: the IANA zone. */
  readonly tz?: string | undefined;
  readonly sessionId?: number | null;
}

export interface SpecUpdated {
  readonly id: number;
  /** UTC ISO-8601, or `null` when the trigger is off (turning it on computes it). */
  readonly next_fire_at: string | null;
  /** `false` when the stored kind and spec already were these (nothing written, no event). */
  readonly changed: boolean;
}

/**
 * Re-schedule an agent's own trigger in place (same id): rewrite `kind`,
 * `spec_json` and, when it is on, `next_fire_at`, and append one
 * `trigger_updated`, in one transaction (a savepoint inside the caller's). A
 * `once` that is off only because it was spent (`spentOnce`) is re-armed:
 * turned back on with the new schedule's next fire (an instant it already
 * fired or recorded is refused). A trigger that someone turned off stays off
 * with no next fire (turning it on computes it). The spec is validated like a registration's (`checkSpec`). Throws
 * `TriggerError` before any write: `invalid_input` for an unknown kind;
 * `invalid_spec`; `not_found`; `not_owner` (another agent's); `owner_off`
 * when the owner turned this trigger off, or turned off another trigger of
 * this agent with the same action, text and the new schedule (re-scheduling
 * onto it would re-register it).
 */
export function updateTriggerSpec(store: Store, params: UpdateSpecParams, now: Date): SpecUpdated {
  if (!isOneOf(TRIGGER_KINDS, params.kind)) throw new TriggerError("invalid_input", `kind must be one of ${TRIGGER_KINDS.join(", ")}`);
  // A poll's own checks run here; its connector checks only once the spec is known to change (below).
  const pollShape = params.kind === "poll" ? checkPollShape(params.spec, params.tz) : undefined;
  const checkedFirst = pollShape === undefined ? checkSpec(store, params.kind, params.spec, params.tz, now) : undefined;
  const at = now.toISOString();
  return store.transaction((): SpecUpdated => {
    const row = readRow(store, params.id);
    if (row === undefined) throw new TriggerError("not_found", `no trigger ${params.id}`);
    if (row.owning_agent !== params.agent) {
      throw new TriggerError("not_owner", `trigger ${row.id} belongs to agent ${row.owning_agent}; an agent can change only its own triggers`);
    }
    if (ownerTurnedOff(store, row)) throw ownerOff(row.id);
    if (params.kind === "poll" && row.playbook === null) throw pollNeedsPlaybook();
    const specJson = JSON.stringify(pollShape ?? checkedFirst?.spec);
    if (row.kind === params.kind && row.spec_json === specJson) return { id: row.id, next_fire_at: row.next_fire_at, changed: false };
    // Reads only: still before any write.
    const checked = checkedFirst ?? checkSpec(store, params.kind, params.spec, params.tz, now);
    const offByOwner = store
      .prepare<[string, string, string, string, number], TriggerRow>(
        `SELECT ${COLUMNS} FROM triggers
          WHERE owning_agent = ? AND kind = ? AND action = ? AND action_payload = ? AND enabled = 0 AND enabled_changed_by = 'owner' AND id <> ?
          ORDER BY id`,
      )
      .all(row.owning_agent, params.kind, row.action, row.action_payload, row.id)
      .find((other) => storedIdentity(other) === checked.identity && ownerTurnedOff(store, other));
    if (offByOwner !== undefined) throw ownerOff(offByOwner.id);
    // A spent `once` is re-armed by its new schedule (same id); an off that someone chose stays off.
    const armed = row.enabled === 1 || spentOnce(store, row);
    let next: string | null = null;
    if (armed) {
      if ("at" in checked.spec) {
        // An instant this trigger already fired or recorded (the clock stepped back) would only replay its step.
        if (instantTaken(store, row.id, checked.nextFireAt)) {
          throw new TriggerError("invalid_spec", `once spec ${JSON.stringify(params.spec)}: trigger ${row.id} already fired or recorded that instant`);
        }
        next = checked.nextFireAt;
      } else if ("cron" in checked.spec) {
        next = nextFreeCronFire(store, row.id, parseCron(checked.spec.cron), checked.spec.tz, now);
      } else {
        // A poll: `now + interval_seconds` (a step already done there is moved past when it comes due).
        next = checked.nextFireAt;
      }
    }
    // A re-armed cron with no instant left stays off, as a spent trigger.
    const enabled = armed && next !== null ? 1 : row.enabled;
    store
      .prepare("UPDATE triggers SET kind = ?, spec_json = ?, enabled = ?, next_fire_at = ? WHERE id = ?")
      .run(params.kind, specJson, enabled, next, row.id);
    appendEvent(
      store,
      "trigger_updated",
      { sessionId: params.sessionId ?? null, taskId: null },
      {
        trigger_id: row.id,
        ...(row.playbook === null ? {} : { playbook: row.playbook }),
        kind: params.kind,
        spec: checked.spec,
        previous_kind: row.kind,
        previous_spec: parseSpec(row.spec_json),
        enabled: enabled === 1,
        ...(enabled === 1 && row.enabled === 0 ? { rearmed: true } : {}),
        next_fire_at: next,
        by: "agent",
      },
      at,
    );
    return { id: row.id, next_fire_at: next, changed: true };
  });
}

export interface RemoveParams {
  readonly id: number;
  /** The calling agent: only its own triggers can be removed. */
  readonly agent: string;
  readonly sessionId?: number | null;
}

/**
 * Delete an agent's own trigger and append `trigger_removed` (with what it
 * was), in one transaction. Throws `TriggerError`: `not_found`, `not_owner`
 * (another agent's), `owner_off` (removing it, then re-registering it, would
 * undo the owner's off).
 */
export function removeTrigger(store: Store, params: RemoveParams, now: Date): { readonly id: number; readonly removed: true } {
  const at = now.toISOString();
  return store.transaction(() => {
    const row = readRow(store, params.id);
    if (row === undefined) throw new TriggerError("not_found", `no trigger ${params.id}`);
    if (row.owning_agent !== params.agent) {
      throw new TriggerError("not_owner", `trigger ${row.id} belongs to agent ${row.owning_agent}; an agent can remove only its own triggers`);
    }
    if (ownerTurnedOff(store, row)) throw ownerOff(row.id);
    store.prepare("DELETE FROM triggers WHERE id = ?").run(row.id);
    appendEvent(
      store,
      "trigger_removed",
      { sessionId: params.sessionId ?? null, taskId: null },
      { trigger_id: row.id, owning_agent: row.owning_agent, kind: row.kind, spec: parseSpec(row.spec_json), action: row.action, enabled: row.enabled === 1, by: "agent" },
      at,
    );
    return { id: row.id, removed: true as const };
  });
}

export interface ListParams {
  /** Include disabled triggers (default: enabled only). */
  readonly all?: boolean;
  /** Only this agent's triggers (default: every agent's). */
  readonly agent?: string;
}

/** Triggers in id order. */
export function listTriggers(store: Store, params: ListParams = {}): TriggerView[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.all !== true) where.push("enabled = 1");
  if (params.agent !== undefined) {
    where.push("owning_agent = ?");
    args.push(params.agent);
  }
  return store
    .prepare<unknown[], TriggerRow>(`SELECT ${COLUMNS} FROM triggers ${where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`} ORDER BY id`)
    .all(...args)
    .map(view);
}

/** One trigger, or `undefined`. */
export function getTrigger(store: Store, id: number): TriggerView | undefined {
  const row = readRow(store, id);
  return row === undefined ? undefined : view(row);
}

export interface ToggleParams {
  readonly id: number;
  readonly enabled: boolean;
  readonly by: TriggerToggler;
  /**
   * Turning on a `once` trigger whose time has passed fires it on the next
   * tick: refused with `needs_confirmation` unless this is true.
   */
  readonly confirm?: boolean;
}

export interface Toggled {
  readonly trigger: TriggerView;
  /** `false` when it already was in that state (nothing written, no event). */
  readonly changed: boolean;
}

/**
 * Whether trigger `id`'s instant `iso` already has a work step: it was fired
 * or recorded, and scheduling it again would only replay that result (the
 * work never runs twice for one key), leaving the trigger due at it for ever.
 */
function instantTaken(store: Store, id: number, iso: string): boolean {
  return getWorkStep(store, fireStepKey(id, iso)) !== undefined;
}

/**
 * The first instant of `schedule` in `tz` strictly after `after` that trigger
 * `id` has not already fired or recorded (a clock stepped back can put such
 * an instant in the future again), or `null` when it never fires again.
 */
function nextFreeCronFire(store: Store, id: number, schedule: CronSchedule, tz: string, after: Date): string | null {
  for (let next = nextCronFire(schedule, tz, after); next !== undefined; next = nextCronFire(schedule, tz, next)) {
    const iso = next.toISOString();
    if (!instantTaken(store, id, iso)) return iso;
  }
  return null;
}

/**
 * The next fire of a trigger being turned on at `now`; throws
 * `needs_confirmation` for a past `once` unless confirmed. An instant already
 * fired or recorded is never given back, even when the clock now reads it as
 * the future: a `once` whose instant is taken counts as past, and a `cron`
 * skips taken instants.
 */
function nextFireOnEnable(store: Store, row: TriggerRow, now: Date, confirm: boolean): string | null {
  const spec = parseSpec(row.spec_json) as { at?: unknown; cron?: unknown; tz?: unknown } | null;
  if (row.kind === "once") {
    const at = normalizeInstant(spec?.at);
    if (at === undefined) throw new TriggerError("invalid_spec", `trigger ${row.id} has an unreadable spec`);
    if (Date.parse(at) > now.getTime() && !instantTaken(store, row.id, at)) return at;
    if (!confirm) {
      throw new TriggerError("needs_confirmation", `trigger ${row.id} was due at ${at}; turning it on fires it now`);
    }
    // "Fires now": its own new instant, so its work step is a new key.
    return now.toISOString();
  }
  if (row.kind === "poll") {
    // From now: one interval after it is turned on, like a registration.
    let interval: number;
    try {
      interval = parsePollSpec(row.spec_json).interval_seconds;
    } catch {
      throw new TriggerError("invalid_spec", `trigger ${row.id} has an unreadable spec`);
    }
    return nextPollFire(now, interval);
  }
  if (typeof spec?.cron !== "string" || typeof spec.tz !== "string") throw new TriggerError("invalid_spec", `trigger ${row.id} has an unreadable spec`);
  // From now: the instants it missed while off are not fired.
  return nextFreeCronFire(store, row.id, parseCron(spec.cron), spec.tz, now);
}

/**
 * Turn a trigger on or off as `by`, setting `enabled_changed_by` and
 * `enabled_changed_at` and appending `trigger_toggled` (`by`, the new state),
 * in one transaction. Turning one off clears its next fire; turning one on
 * computes it from now (a `cron` does not fire the instants it missed while
 * off; a past `once` needs `confirm` and then fires on the next tick).
 * Already in that state ⇒ `changed: false`, nothing written, except that the
 * owner's off of a trigger that is off for another reason (a spent `once`,
 * even one the owner had turned on; an agent's off) records the owner as the
 * one who turned it off.
 * Throws `TriggerError`: `not_found`; `owner_off` when `by` is `agent` and the
 * owner turned it off (on or off: either would undo the owner's say);
 * `needs_confirmation` (see `confirm`).
 */
export function setTriggerEnabled(store: Store, params: ToggleParams, now: Date): Toggled {
  const at = now.toISOString();
  return store.transaction((): Toggled => {
    const row = readRow(store, params.id);
    if (row === undefined) throw new TriggerError("not_found", `no trigger ${params.id}`);
    const wasEnabled = row.enabled === 1;
    // Any agent change, on or off: an agent's off would overwrite `enabled_changed_by` and unlock it.
    if (params.by === "agent" && ownerTurnedOff(store, row)) throw ownerOff(row.id);
    if (wasEnabled === params.enabled && (params.enabled || turnedOffBy(store, row) === params.by)) return { trigger: view(row), changed: false };
    const next = params.enabled ? nextFireOnEnable(store, row, now, params.confirm === true) : null;
    store
      .prepare("UPDATE triggers SET enabled = ?, enabled_changed_by = ?, enabled_changed_at = ?, next_fire_at = ? WHERE id = ?")
      .run(params.enabled ? 1 : 0, params.by, at, next, row.id);
    appendEvent(
      store,
      "trigger_toggled",
      { sessionId: null, taskId: null },
      { trigger_id: row.id, enabled: params.enabled, was_enabled: wasEnabled, by: params.by, next_fire_at: next },
      at,
    );
    return { trigger: view(readRow(store, row.id) as TriggerRow), changed: true };
  });
}

// ---- Firing ------------------------------------------------------------------

/** The kill-switch and pause windows a fire is planned against. */
interface FireWindows {
  readonly killSwitch: readonly KillSwitchWindow[];
  readonly pause: readonly PauseWindow[];
}

/** What one due trigger comes to at `now`: computed from its spec before the work step. */
interface FirePlan {
  /** The due instants outside every kill-switch and pause window: fired once, together. */
  readonly toFire: number;
  /** The due instants inside a kill-switch window: recorded, never fired. */
  readonly missedKillSwitch: number;
  /** The due instants inside a pause window (and no kill-switch one): recorded, never fired. */
  readonly missedPaused: number;
  /** Counting stopped at `MAX_COUNTED_INSTANTS`. */
  readonly atLeast: boolean;
  readonly latestDue: string;
  /** The next instant after `now` (`cron`), or `null` (`once`, or a cron that never fires again). */
  readonly next: string | null;
}

/**
 * Every due instant from `row.next_fire_at` up to `now` (one for `once`; for
 * `cron`, each scheduled instant, looked up in its zone), split by the
 * kill-switch windows first, then the pause windows, and the next future instant not already fired or
 * recorded. Throws when the stored
 * spec cannot be evaluated (`parkUnreadable` handles that).
 */
function planFire(store: Store, row: TriggerRow, first: string, now: Date, windows: FireWindows): FirePlan {
  const nowMs = now.getTime();
  let toFire = 0;
  let missedKillSwitch = 0;
  let missedPaused = 0;
  const count = (iso: string): void => {
    if (inKillSwitchWindow(windows.killSwitch, iso)) missedKillSwitch++;
    else if (inPauseWindow(windows.pause, iso)) {
      missedPaused++;
    } else toFire++;
  };
  if (row.kind === "once") {
    count(first);
    return { toFire, missedKillSwitch, missedPaused, atLeast: false, latestDue: first, next: null };
  }
  if (row.kind !== "cron") throw new Error(`trigger ${row.id} has unknown kind ${JSON.stringify(row.kind)}`);
  const spec = JSON.parse(row.spec_json) as { cron?: unknown; tz?: unknown };
  if (typeof spec.cron !== "string" || typeof spec.tz !== "string") throw new Error(`trigger ${row.id} has an unreadable cron spec`);
  const schedule = parseCron(spec.cron);
  // Each instant is counted, never fired: the coalesced fire is one effect.
  let latestDue = first;
  let counted = 0;
  let atLeast = false;
  for (let instant: Date | undefined = new Date(first); instant !== undefined && instant.getTime() <= nowMs; instant = nextCronFire(schedule, spec.tz, instant)) {
    if (counted === MAX_COUNTED_INSTANTS) {
      atLeast = true;
      break;
    }
    latestDue = instant.toISOString();
    count(latestDue);
    counted++;
  }
  return { toFire, missedKillSwitch, missedPaused, atLeast, latestDue, next: nextFreeCronFire(store, row.id, schedule, spec.tz, now) };
}

/** A `notify` fire's title: `Trigger <id> (<agent>)`, clipped to `MAX_NOTIFICATION_TITLE`. */
function notifyTitle(id: number, agent: string): string {
  return clip(`Trigger ${id} (${agent})`, MAX_NOTIFICATION_TITLE - 1);
}

/** What `fireDueTriggers` did for one trigger. */
export interface TriggerFireOutcome {
  readonly trigger_id: number;
  /** The first due instant: the work step's key (`trigger:<id>:<scheduled_at>`). */
  readonly scheduled_at: string;
  /**
   * `already_done`: the instant's work step was already done, so the trigger was moved past it (see `movePastDone`).
   * `skipped`: it was no longer due there, or its linked playbook is not `enabled` (the instant recorded as a miss).
   */
  readonly result: TriggerResult | "skipped" | "already_done";
  readonly notification_id?: number;
  readonly queue_id?: number;
}

/**
 * The work step of one due trigger: its effect, its bookkeeping and its one
 * audit event, all inside `runStep`'s transaction. Re-reads the row first
 * and does nothing (`skipped`) unless it is still enabled and still due at
 * `scheduledAt`.
 */
function fireOne(store: Store, id: number, scheduledAt: string, plan: FirePlan, now: Date): TriggerFireOutcome {
  const row = readRow(store, id);
  if (row === undefined || row.enabled !== 1 || row.next_fire_at !== scheduledAt) return { trigger_id: id, scheduled_at: scheduledAt, result: "skipped" };
  const at = now.toISOString();
  const once = row.kind === "once";
  const counts = {
    ...(plan.atLeast ? { missed_at_least: true } : {}),
    latest_due_at: plan.latestDue,
    next_fire_at: plan.next,
  };

  // Set only for a linked trigger whose playbook is `enabled` (the branch below records every other linked one).
  let playbook: LinkedPlaybook | undefined;
  if (row.playbook !== null) {
    const linked = linkedPlaybook(store, row.playbook);
    const status = linked === undefined ? null : linked.status;
    if (status !== "enabled") {
      // A linked trigger of a playbook that is not enabled never starts work: the
      // instant is recorded (this step is its key, so it is never fired later)
      // and the next one scheduled as after a fire. `last_result` stays.
      store.prepare("UPDATE triggers SET next_fire_at = ? WHERE id = ?").run(plan.next, id);
      if (once) store.prepare("UPDATE triggers SET enabled = 0 WHERE id = ?").run(id);
      appendEvent(
        store,
        "trigger_missed",
        { sessionId: null, taskId: null },
        { trigger_id: id, reason: "playbook_not_enabled", playbook: row.playbook, playbook_status: status, scheduled_at: scheduledAt, enabled: !once, ...counts },
        at,
      );
      return { trigger_id: id, scheduled_at: scheduledAt, result: "skipped" };
    }
    playbook = linked;
  }

  const missedPaused = plan.missedPaused > 0 ? { missed_paused: plan.missedPaused } : {};
  if (plan.toFire === 0) {
    // Every due instant fell inside a kill-switch engagement or a pause: recorded, not fired.
    // Any instant in a kill-switch window makes it the kill switch's miss; otherwise the pause's.
    const killSwitch = plan.missedKillSwitch > 0;
    const result: TriggerResult = killSwitch ? "missed_kill_switch" : "missed_paused";
    store.prepare("UPDATE triggers SET last_result = ?, next_fire_at = ? WHERE id = ?").run(result, plan.next, id);
    // A `once` is spent: off. Who last toggled it stays (`turnedOffBy` tells a spend from an off).
    if (once) store.prepare("UPDATE triggers SET enabled = 0 WHERE id = ?").run(id);
    appendEvent(
      store,
      "trigger_missed",
      { sessionId: null, taskId: null },
      {
        trigger_id: id,
        reason: killSwitch ? "kill_switch" : "paused",
        scheduled_at: scheduledAt,
        ...(killSwitch ? { missed_kill_switch: plan.missedKillSwitch } : {}),
        ...missedPaused,
        enabled: !once,
        ...counts,
      },
      at,
    );
    return { trigger_id: id, scheduled_at: scheduledAt, result };
  }

  let effect: { notification_id: number } | { queue_id: number };
  if (playbook !== undefined) {
    // The playbook's message, whatever the action. A stored priority outside the
    // closed set makes `enqueueEvent` throw: this step fails, never a guessed priority.
    const queued = enqueueEvent(
      store,
      {
        kind: "message",
        payload: { agent: playbook.owning_agent, playbook: playbook.id, version: playbook.version, trigger_id: id, scheduled_at: scheduledAt },
        priority: playbook.priority as EnqueueParams["priority"],
        sourceRef: `playbook:${playbook.id}:${scheduledAt}`,
      },
      now,
    );
    effect = { queue_id: queued.id };
  } else if (row.action === "notify") {
    effect = { notification_id: recordNotification(store, { source: `trigger:${id}`, title: notifyTitle(id, row.owning_agent), body: row.action_payload }, now).id };
  } else if (row.action === "wake_agent") {
    const queued = enqueueEvent(
      store,
      { kind: "message", payload: { text: row.action_payload, agent: row.owning_agent, trigger_id: id }, sourceRef: `trigger:${id}:${scheduledAt}` },
      now,
    );
    effect = { queue_id: queued.id };
  } else {
    throw new Error(`trigger ${id} has unknown action ${JSON.stringify(row.action)}`);
  }
  store.prepare("UPDATE triggers SET last_fired_at = ?, last_result = 'fired', next_fire_at = ? WHERE id = ?").run(at, plan.next, id);
  // A fired `once` is spent: off. Who last toggled it stays (`turnedOffBy` tells a spend from an off).
  if (once) store.prepare("UPDATE triggers SET enabled = 0 WHERE id = ?").run(id);
  appendEvent(
    store,
    "trigger_fired",
    { sessionId: null, taskId: null },
    {
      trigger_id: id,
      action: row.action,
      ...(playbook === undefined ? {} : { playbook: row.playbook, playbook_id: playbook.id }),
      scheduled_at: scheduledAt,
      // How many due instants this one fire coalesces; 0 for a single one (an ordinary fire, however late).
      missed: plan.toFire > 1 ? plan.toFire : 0,
      ...(plan.missedKillSwitch > 0 ? { missed_kill_switch: plan.missedKillSwitch } : {}),
      ...missedPaused,
      enabled: !once,
      ...counts,
      ...effect,
    },
    at,
  );
  return { trigger_id: id, scheduled_at: scheduledAt, result: "fired", ...effect };
}

/**
 * A due trigger whose work step for `scheduledAt` was already done: `runStep`
 * replayed the stored result without running `fireOne`, so nothing moved it
 * and it would stay due at that instant, never firing again. Moves it past
 * the instant in one transaction with one `trigger_missed` (reason
 * `already_done`): a `cron` to its next instant not already taken, a `once`
 * is spent (its instant already fired or was recorded). Re-checks the row
 * first and does nothing (`skipped`) unless it is still enabled and due there.
 */
function movePastDone(store: Store, id: number, scheduledAt: string, plan: FirePlan, now: Date): TriggerFireOutcome {
  const at = now.toISOString();
  return store.transaction((): TriggerFireOutcome => {
    const row = readRow(store, id);
    if (row === undefined || row.enabled !== 1 || row.next_fire_at !== scheduledAt) return { trigger_id: id, scheduled_at: scheduledAt, result: "skipped" };
    const once = row.kind === "once";
    const next = once ? null : plan.next;
    store.prepare("UPDATE triggers SET enabled = ?, next_fire_at = ? WHERE id = ?").run(once ? 0 : 1, next, id);
    appendEvent(
      store,
      "trigger_missed",
      { sessionId: null, taskId: null },
      { trigger_id: id, reason: "already_done", scheduled_at: scheduledAt, enabled: !once, next_fire_at: next },
      at,
    );
    return { trigger_id: id, scheduled_at: scheduledAt, result: "already_done" };
  });
}

/**
 * A trigger whose stored spec cannot be evaluated (a corrupt row, a zone the
 * runtime no longer knows) is parked: its next fire is cleared, so it stops
 * coming due and the failure is reported once (the loop's `due_work_failed`)
 * instead of every tick. It stays listed; the owner's off/on recomputes it.
 */
function parkUnreadable(store: Store, id: number, scheduledAt: string): void {
  try {
    store.prepare("UPDATE triggers SET next_fire_at = NULL WHERE id = ? AND next_fire_at = ?").run(id, scheduledAt);
  } catch {
    // The store is failing too: the next tick tries again.
  }
}

/**
 * Fire every enabled `once` / `cron` trigger whose next fire is at or before `now`, earliest
 * first, each at most once per scheduled instant (see the header). Nothing
 * fires while the kill switch is engaged; while paused, each due instant is
 * recorded `missed_paused`. Returns what each due trigger came
 * to. One trigger's failure never stops the others: they all run, then the
 * failures are thrown as one error naming each (one `due_work_failed` from the loop).
 */
export function fireDueTriggers(store: Store, now: Date = new Date()): TriggerFireOutcome[] {
  if (isKillSwitchEngaged(store)) return [];
  const due = store
    .prepare<[string], TriggerRow>(
      // A poll is fired by `firePollTriggers` (`./poll.ts`), never here.
      `SELECT ${COLUMNS} FROM triggers WHERE kind <> 'poll' AND enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ? ORDER BY next_fire_at, id`,
    )
    .all(now.toISOString());
  if (due.length === 0) return [];
  const windows: FireWindows = { killSwitch: killSwitchWindows(store), pause: pauseWindows(store) };
  const outcomes: TriggerFireOutcome[] = [];
  const failures: string[] = [];
  for (const row of due) {
    const scheduledAt = row.next_fire_at as string;
    let plan: FirePlan;
    try {
      plan = planFire(store, row, scheduledAt, now, windows);
    } catch (err) {
      parkUnreadable(store, row.id, scheduledAt);
      failures.push(`trigger ${row.id}: ${errorMessage(err)} (parked: no next fire)`);
      continue;
    }
    try {
      const outcome = runStep(store, fireStepKey(row.id, scheduledAt), () => fireOne(store, row.id, scheduledAt, plan, now), { now: () => now });
      // `fireOne` always moves a trigger it fires or records off `scheduledAt` (a
      // cron's next is after now): still enabled and due there means the step
      // replayed an earlier done result and nothing moved it.
      const after = readRow(store, row.id);
      outcomes.push(after?.enabled === 1 && after.next_fire_at === scheduledAt ? movePastDone(store, row.id, scheduledAt, plan, now) : outcome);
    } catch (err) {
      // A stored row the notification record refuses (a NUL from before registration
      // refused one) fails the same way on every tick: parked, like an unreadable spec.
      if (err instanceof InvalidNotificationError) {
        parkUnreadable(store, row.id, scheduledAt);
        failures.push(`trigger ${row.id}: ${errorMessage(err)} (parked: no next fire)`);
      } else {
        failures.push(`trigger ${row.id}: ${errorMessage(err)}`);
      }
    }
  }
  if (failures.length > 0) throw new Error(clip(failures.join("; ")));
  return outcomes;
}
