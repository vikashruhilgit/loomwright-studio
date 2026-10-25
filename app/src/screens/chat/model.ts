// Chat's plain helpers: the bridge fallback, routing, writes, and the small
// parsers the screen needs. No React here, so each is tested on its own.
//
// Every kernel string is untrusted data (invariant 3): nothing here builds
// markup or an `href` from one; the parsers only read the kernel's own fixed
// phrasing (`retry at <ISO>`, `agent:<id>`).
import type { ApiResult, Approval, KernelConnectionState, RosterEntry, StudioBridge, Trigger } from "../../api/contract";
import { getBridge } from "../../api/bridge";
import type { AvatarState } from "../../components/Avatar/Avatar";
import type { EventKind } from "../../components/EventCard/EventCard";
import type { StatusState } from "../../components/StatusDot/StatusDot";
import { liveStoreFor } from "../../store/react";
import type { ResourceName } from "../../store/resources";
import type { ResourceError } from "../../store/store";

export const WRIGHT = "wright";

const UNREACHABLE: KernelConnectionState = { state: "unreachable", reason: "connection_failed" };

/**
 * The bridge used when there is none: no `api` prop and no `window.api` (the
 * shell's unit tests, before any preload). Every read answers "unreachable",
 * so the hooks run in their usual order, nothing throws, the Crew group shows
 * its empty line and the screen its error state.
 */
export const INERT_BRIDGE: StudioBridge = {
  connection: async () => UNREACHABLE,
  request: async <R>(): Promise<ApiResult<R>> => ({ ok: false, status: 0, connection: { state: "unreachable", reason: "connection_failed" } }),
  feed: {
    subscribe: async () => UNREACHABLE,
    unsubscribe: async () => undefined,
    onFrame: () => () => undefined,
  },
  onNavigate: () => () => undefined,
};

/** The bridge a Chat component uses: its prop, else `window.api`, else the inert one. */
export function resolveBridge(api: StudioBridge | undefined): StudioBridge {
  // `getBridge()` is typed non-null, but at runtime it is undefined when no preload ran (App.test.tsx): keep the `??`.
  return api ?? (getBridge() as StudioBridge | undefined) ?? INERT_BRIDGE;
}

// ---- routing ---------------------------------------------------------------------

/** The agent id a `#/chat/<id>` hash names; `undefined` for `#/chat` or anything else. */
export function hashAgent(hash: string): string | undefined {
  const match = /^#\/chat\/([^/?#]+)/.exec(hash);
  if (match?.[1] === undefined) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/** The route for `agent`'s thread: Wright's is always `#/chat`. */
export function threadHash(agent: string): string {
  return agent === WRIGHT ? "#/chat" : `#/chat/${encodeURIComponent(agent)}`;
}

/** The route to playbook `id`'s card in Wright's thread (`hashAgent` reads it as Wright's, the shell as Chat). */
export function playbookCardHash(id: number): string {
  return `#/chat?playbook=${id}`;
}

const PLAYBOOK_CARD_ROUTE = /^#\/chat\?playbook=([1-9][0-9]{0,15})$/;

/** The playbook a `#/chat?playbook=<id>` route names, or `undefined`. */
export function playbookFromHash(hash: string): number | undefined {
  const match = PLAYBOOK_CARD_ROUTE.exec(hash);
  const id = match === null ? Number.NaN : Number(match[1]);
  return Number.isSafeInteger(id) ? id : undefined;
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

/**
 * A link's click: following an `href` equal to the current hash fires no
 * `hashchange`, so say it again (the screen scrolls or selects once more).
 * The link itself still navigates; nothing else is done.
 */
export function rehashIfCurrent(href: string): void {
  if (window.location.hash === href) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** The roster's specialists: every entry but Wright, who never appears under Crew (D25). */
export function specialists(roster: readonly RosterEntry[] | undefined): readonly RosterEntry[] {
  return (roster ?? []).filter((a) => a.id !== WRIGHT);
}

// ---- agent state -----------------------------------------------------------------------

/** An agent's avatar state from the roster and the pending approvals. */
export function agentAvatarState(agent: RosterEntry | undefined, approvals: readonly Approval[] | undefined): AvatarState {
  if (agent === undefined) return "idle";
  if (agent.status === "off") return "danger";
  if ((approvals ?? []).some((a) => a.status === "pending" && a.requesting_agent === agent.id)) return "waiting";
  if (agent.sessions_running > 0) return "working";
  return "idle";
}

/** The title row's chip: the StatusDot state and its word. */
export function chipFor(state: AvatarState): { readonly dot: StatusState; readonly word: string } {
  switch (state) {
    case "danger":
      return { dot: "failed", word: "off" };
    case "waiting":
      return { dot: "waiting", word: "waiting on you" };
    case "working":
      return { dot: "working", word: "working" };
    default:
      return { dot: "idle", word: "idle" };
  }
}

// ---- thread items -------------------------------------------------------------------------

/** A thread event's kind on EventCard's six (`trigger_fired` and `trigger_registered` read as a playbook line). */
export function eventKindOf(kind: string): EventKind {
  if (kind === "session_status" || kind.startsWith("session_")) return "session";
  if (kind.startsWith("playbook_") || kind === "trigger_fired" || kind === "trigger_registered") return "playbook";
  if (kind.startsWith("agent_")) return "agent";
  if (kind.startsWith("approval_")) return "approval";
  return "hook";
}

/** Where an event line's subject opens. */
export function eventTarget(kind: EventKind): string {
  switch (kind) {
    case "session":
      return "#/sessions";
    case "agent":
      return "#/team";
    case "approval":
      return "#/approvals";
    default:
      return "#/chat";
  }
}

/** The kernel's parked detail ends `retry at <ISO>` (kernel/src/brain/handler.ts); anything else is unknown. */
const RETRY_AT = /(?:^|;\s*)retry at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)\s*$/;

/** The retry time inside a parked message's `detail`, or `null` when it does not name one. */
export function parseRetryAt(detail: string | null): string | null {
  if (detail === null) return null;
  const iso = RETRY_AT.exec(detail)?.[1];
  if (iso === undefined || Number.isNaN(Date.parse(iso))) return null;
  return iso;
}

/** A ref field (`ref` is `unknown` on the wire) as a positive integer id. */
export function refId(ref: unknown, field: string): number | undefined {
  if (typeof ref !== "object" || ref === null) return undefined;
  const value = (ref as Record<string, unknown>)[field];
  const n = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

// ---- triggers ------------------------------------------------------------------------------

/**
 * A trigger's schedule in words. `spec` is `unknown` and untrusted: it is read
 * by type checks only. `{at}` reads `once at <when>`, `{cron, tz}` reads
 * `cron <cron> (<tz>)`, and anything else reads as the trigger's kind alone.
 */
export function triggerSchedule(trigger: Trigger): string {
  const spec = trigger.spec;
  if (typeof spec === "object" && spec !== null) {
    const { at, cron, tz } = spec as { readonly at?: unknown; readonly cron?: unknown; readonly tz?: unknown };
    if (typeof at === "string") return `once at ${when(at)}`;
    if (typeof cron === "string" && typeof tz === "string") return `cron ${cron} (${tz})`;
  }
  return trigger.kind;
}

export type TriggerState = "on" | "off" | "spent";

/**
 * A trigger's state: `on`, `off`, or `spent` (a `once` that is off because its
 * instant came: fired, or recorded as a miss). It mirrors the kernel's
 * `spentOnce` (kernel/src/triggers/store.ts) as far as `GET /triggers` lets the
 * app see: an off `once` nobody ever toggled, or one that fired after its
 * newest toggle, is spent. The kernel also reads the newest `trigger_toggled`
 * event, which the row does not carry, so a `once` someone turned on that was
 * then missed (not fired) reads `off` here, though the kernel counts it spent.
 */
export function triggerState(trigger: Trigger): TriggerState {
  if (trigger.enabled) return "on";
  if (trigger.kind !== "once") return "off";
  if (trigger.enabled_changed_by === null) return "spent";
  if (trigger.last_fired_at !== null && trigger.enabled_changed_at !== null && Date.parse(trigger.last_fired_at) > Date.parse(trigger.enabled_changed_at)) return "spent";
  return "off";
}

// ---- time --------------------------------------------------------------------------------

/** `HH:MM` local, or the raw text when it is not a time. */
export function clock(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** A date and time, for a retry or a next fire. */
export function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

// ---- writes -------------------------------------------------------------------------------

export type WriteOutcome<R> = { readonly ok: true; readonly status: number; readonly body: R } | { readonly ok: false; readonly status: number; readonly code: string; readonly text: string };

/** A refusal as the owner reads it: the kernel's `message` and its `error` code, as text. */
export function refusalOf(result: ApiResult<unknown> | undefined): { readonly status: number; readonly code: string; readonly text: string } {
  if (result === undefined) return { status: 0, code: "bridge_failed", text: "The request did not reach the kernel." };
  if (result.ok) return { status: result.status, code: "", text: "" };
  if ("connection" in result) return { status: 0, code: result.connection.state, text: "The kernel is not reachable." };
  const code = typeof result.body?.error === "string" ? result.body.error : "refused";
  const message = typeof result.body?.message === "string" ? result.body.message : "";
  return { status: result.status, code, text: message === "" ? code : `${message} (${code})` };
}

/**
 * One write through the bridge (`path` exactly as in `CONTRACT_ROUTES`), then
 * a refetch of each resource it changes once the kernel said yes.
 */
export async function write<R = unknown>(
  api: StudioBridge,
  path: string,
  params: Readonly<Record<string, string | number>> | undefined,
  body: unknown,
  refetch: readonly ResourceName[],
): Promise<WriteOutcome<R>> {
  let result: ApiResult<R> | undefined;
  try {
    result = await api.request<R>({ method: "POST", path, ...(params === undefined ? {} : { params }), ...(body === undefined ? {} : { body }) });
  } catch {
    result = undefined;
  }
  if (result?.ok === true) {
    const store = liveStoreFor(api);
    for (const name of refetch) store.refetch(name);
    return { ok: true, status: result.status, body: result.body };
  }
  return { ok: false, ...refusalOf(result) };
}

/**
 * An in-flight guard: `run(fn)` calls `fn` unless an earlier call is still
 * pending, in which case it drops the call and resolves `false`. The guard is
 * synchronous (two clicks in one tick cannot both pass) and is released when
 * `fn` settles, a throw included.
 */
export interface InFlightGuard {
  readonly pending: () => boolean;
  readonly run: (fn: () => Promise<void>) => Promise<boolean>;
}

export function inFlightGuard(): InFlightGuard {
  let pending = false;
  return {
    pending: () => pending,
    run: async (fn) => {
      if (pending) return false;
      pending = true;
      try {
        await fn();
      } finally {
        pending = false;
      }
      return true;
    },
  };
}

/** Why a read failed, in words. */
export function readErrorText(error: ResourceError | undefined): string {
  if (error === undefined) return "";
  if (error.kind === "not_connected") return "The kernel is not reachable, so the thread can't load.";
  if (error.kind === "bridge_failed") return "The app could not ask the kernel for this thread.";
  const message = typeof error.body.message === "string" ? `${error.body.message} ` : "";
  return `The kernel refused the thread: ${message}(${error.body.error}).`;
}

// ---- the composer's focus -----------------------------------------------------------------

const FOCUS_EVENT = "studio-chat-focus-composer";
/** The agent whose composer is owed focus, if any. */
let focusOwedTo: string | null = null;

/**
 * Ask `agent`'s Chat composer for focus: now if it is mounted, else as soon as
 * it mounts. The request names the agent because navigation lands later than
 * this call (the hashchange is async): the composer still on screen belongs to
 * the thread being left and must not take a request meant for the next one.
 */
export function requestComposerFocus(agent: string): void {
  focusOwedTo = agent;
  window.dispatchEvent(new Event(FOCUS_EVENT));
}

/** `agent`'s composer side: run `focus` on each request for `agent`, and once at mount if one is owed to it. */
export function onComposerFocusRequest(agent: string, focus: () => void): () => void {
  const run = (): void => {
    if (focusOwedTo !== agent) return;
    focusOwedTo = null;
    focus();
  };
  window.addEventListener(FOCUS_EVENT, run);
  run();
  return () => window.removeEventListener(FOCUS_EVENT, run);
}

/** True when nothing holds focus: the focused control unmounted (focus fell to <body>). */
export function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

// ---- last seen, per agent ------------------------------------------------------------------

const SEEN_PREFIX = "studio.chat.lastSeen.";
const seenMemory = new Map<string, number>();
const seenListeners = new Set<() => void>();
let seenVersion = 0;

/** The newest message id the owner saw in `agent`'s thread (0 when none). Works with no storage at all. */
export function readSeen(agent: string): number {
  try {
    const stored = window.localStorage.getItem(SEEN_PREFIX + agent);
    if (stored !== null && /^[0-9]+$/.test(stored)) return Math.max(Number(stored), seenMemory.get(agent) ?? 0);
  } catch {
    // No storage (or it refuses): the in-memory copy is the record.
  }
  return seenMemory.get(agent) ?? 0;
}

export function writeSeen(agent: string, id: number): void {
  if (id <= readSeen(agent)) return;
  seenMemory.set(agent, id);
  try {
    window.localStorage.setItem(SEEN_PREFIX + agent, String(id));
  } catch {
    // Kept in memory only.
  }
  seenVersion += 1;
  for (const listener of [...seenListeners]) listener();
}

export function subscribeSeen(listener: () => void): () => void {
  seenListeners.add(listener);
  return () => {
    seenListeners.delete(listener);
  };
}

export function seenSnapshot(): number {
  return seenVersion;
}

/** Test-only: forget the in-memory copy. */
export function resetSeenMemory(): void {
  seenMemory.clear();
  seenVersion += 1;
}
