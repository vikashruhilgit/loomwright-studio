// What the time-based fire (`store.ts`) and the poll fire (`poll.ts`) share:
// the refusal type, the per-instant work-step key, the kill-switch and pause
// windows read from the append-only `events` log, and the linked playbook
// read with raw SQL. Both modules import this one and never each other at
// runtime, so `store.ts` ↔ `poll.ts` form no import cycle.
//
// The playbook is read with raw SQL over `playbooks` (migration 13): the
// triggers feature never imports the playbooks feature, which depends on it.
import { KILL_SWITCH_ENGAGED, KILL_SWITCH_RELEASED } from "../api/kill-switch.js";
import { PAUSE_ENGAGED, PAUSE_RELEASED } from "../console/pause.js";
import type { Store } from "../store/store.js";

/**
 * Why a trigger operation was refused; `message` names the problem for the agent or the owner.
 * The `poll_*` codes refuse a `poll` spec (`poll.ts`): its interval is under
 * the 60 s floor, a repo is outside what the GitHub connector reaches, the
 * connector is missing, or a filter key is unknown. Their message leads with
 * the code, so a re-wrapped refusal (`trigger: <message>`) still names it.
 */
export type TriggerErrorCode =
  | "invalid_spec"
  | "invalid_input"
  | "not_found"
  | "not_owner"
  | "owner_off"
  | "needs_confirmation"
  | "poll_interval_below_floor"
  | "poll_repo_not_reachable"
  | "poll_connector_missing"
  | "poll_filter_unknown";

export class TriggerError extends Error {
  readonly code: TriggerErrorCode;

  constructor(code: TriggerErrorCode, message: string) {
    super(message);
    this.name = "TriggerError";
    this.code = code;
  }
}

/** The work step key of trigger `id`'s scheduled instant `iso`. */
export function fireStepKey(id: number, iso: string): string {
  return `trigger:${id}:${iso}`;
}

/** A kill-switch engagement: from its first `kill_switch_engaged` to the `kill_switch_released` after it (`null`: still engaged). */
export interface KillSwitchWindow {
  readonly from: string;
  readonly to: string | null;
}

/** Engage/release windows from the `events` log, in order: the first engage after a release opens one, the next release closes it. */
function windowsOf(store: Store, engaged: string, released: string): KillSwitchWindow[] {
  const rows = store.prepare<[string, string], { kind: string; at: string }>("SELECT kind, at FROM events WHERE kind IN (?, ?) ORDER BY id").all(engaged, released);
  const windows: KillSwitchWindow[] = [];
  let open: string | null = null;
  for (const r of rows) {
    if (r.kind === engaged) open ??= r.at;
    else if (open !== null) {
      windows.push({ from: open, to: r.at });
      open = null;
    }
  }
  if (open !== null) windows.push({ from: open, to: null });
  return windows;
}

/** Every engagement window, from the append-only `events` log (the kill switch's only state). */
export function killSwitchWindows(store: Store): KillSwitchWindow[] {
  return windowsOf(store, KILL_SWITCH_ENGAGED, KILL_SWITCH_RELEASED);
}

export function inKillSwitchWindow(windows: readonly KillSwitchWindow[], iso: string): boolean {
  return windows.some((w) => w.from <= iso && (w.to === null || iso < w.to));
}

/** A pause: from its first `pause_engaged` to the `pause_released` after it (`null`: still paused). */
export type PauseWindow = KillSwitchWindow;

/** Every pause window, from the append-only `events` log (the pause's only state), read like `killSwitchWindows`. */
export function pauseWindows(store: Store): PauseWindow[] {
  return windowsOf(store, PAUSE_ENGAGED, PAUSE_RELEASED);
}

/**
 * Whether instant `iso` is paused: inside a pause window, or due at all while
 * the kernel is paused (the last window is open). The second keeps an instant
 * that came due just before the pause, and was not yet processed, from firing
 * during it.
 */
export function inPauseWindow(windows: readonly PauseWindow[], iso: string): boolean {
  if (windows.at(-1)?.to === null) return true;
  return windows.some((w) => w.from <= iso && (w.to === null || iso < w.to));
}

/** What a fire reads of a linked playbook. */
export interface LinkedPlaybook {
  readonly id: number;
  readonly status: string;
  readonly version: number;
  readonly priority: string;
  readonly owning_agent: string;
}

/**
 * The playbook with slug `slug`, or `undefined` when there is none. Raw SQL
 * over `playbooks` (migration 13): this module must not import the playbooks
 * feature, which depends on it.
 */
export function linkedPlaybook(store: Store, slug: string): LinkedPlaybook | undefined {
  return store.prepare<[string], LinkedPlaybook>("SELECT id, status, version, priority, owning_agent FROM playbooks WHERE slug = ?").get(slug);
}
