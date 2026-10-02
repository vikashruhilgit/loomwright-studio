// The kill switch's state (invariant 3): derived from the append-only
// `events` log, never held in memory, so no restart (launchd KeepAlive,
// item 09) can silently release it.
import type { Store } from "../store/store.js";

export const KILL_SWITCH_ENGAGED = "kill_switch_engaged";
export const KILL_SWITCH_RELEASED = "kill_switch_released";

export interface KillSwitchState {
  readonly engaged: boolean;
  /** When the current engagement began (its first `kill_switch_engaged` since the last release), or `null`. */
  readonly since: string | null;
}

interface SwitchEvent {
  readonly id: number;
  readonly at: string;
  readonly kind: string;
}

/** Engaged exactly when the latest of the two switch events is `kill_switch_engaged`. */
export function killSwitchState(store: Store): KillSwitchState {
  const latest = store
    .prepare<[string, string], SwitchEvent>("SELECT id, at, kind FROM events WHERE kind IN (?, ?) ORDER BY id DESC LIMIT 1")
    .get(KILL_SWITCH_ENGAGED, KILL_SWITCH_RELEASED);
  if (latest === undefined || latest.kind !== KILL_SWITCH_ENGAGED) return { engaged: false, since: null };
  const lastRelease =
    store
      .prepare<[string], number>("SELECT id FROM events WHERE kind = ? ORDER BY id DESC LIMIT 1")
      .pluck()
      .get(KILL_SWITCH_RELEASED) ?? 0;
  const first = store
    .prepare<[string, number], string>("SELECT at FROM events WHERE kind = ? AND id > ? ORDER BY id LIMIT 1")
    .pluck()
    .get(KILL_SWITCH_ENGAGED, lastRelease);
  return { engaged: true, since: first ?? latest.at };
}

export function isKillSwitchEngaged(store: Store): boolean {
  return killSwitchState(store).engaged;
}

function append(store: Store, kind: string, at: string, payload: Record<string, unknown>): void {
  store
    .prepare("INSERT INTO events (at, kind, actor, payload_json) VALUES (?, ?, 'api', ?)")
    .run(at, kind, JSON.stringify(payload));
}

/** Append `kill_switch_engaged`. Engaging an engaged switch appends again: every call is audited. */
export function engageKillSwitch(store: Store, at: string, payload: Record<string, unknown> = {}): void {
  append(store, KILL_SWITCH_ENGAGED, at, payload);
}

/** Append `kill_switch_released`. The caller checks it was engaged (a no-op release appends nothing). */
export function releaseKillSwitch(store: Store, at: string, payload: Record<string, unknown> = {}): void {
  append(store, KILL_SWITCH_RELEASED, at, payload);
}
