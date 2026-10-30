// Schedules & triggers' view model (phase 7 item 05): the pure logic behind the
// screen built to `docs/design/mockups/gui-v2.html` (`schedulesScreen`). Plain
// TypeScript: no React, no DOM, and no import that reaches a `.tsx` file, so the
// e2e project (`tsconfig.node.json`, no `jsx`) can import `SCHEDULES_TEST_IDS`
// instead of copying it.
//
// Every string from the kernel (a trigger's `text`, a wake-up's reason, a
// playbook's name, a fire's `reason`, a spec) is untrusted data (invariant 3):
// nothing here builds markup, and the components render each value as a React
// text child.
//
// What lives here: the test ids, the bridge's answer as a `Reply`, the labels and
// tones of the missed-fire reasons (a reason the table does not know is shown
// verbatim with a neutral tone), the grouping of consecutive repeats, the paging
// of the firing history (a refetch of the first page keeps the older pages that
// were loaded), the trigger's name and spec text, the time labels, and the
// event kinds that make the screen read again.
import type { ApiError, ApiResult, PlaybookListing, ScheduleEntry, Trigger, TriggerFire, TriggerFiresResponse } from "../../api/contract";

/** The ids the unit tests and the e2e spec target. */
export const SCHEDULES_TEST_IDS = {
  screen: "screen-schedules",
  summary: "schedules-summary",
  notice: "schedules-notice",
  loading: "schedules-loading",
  empty: "schedules-empty",
  emptyAsk: "schedules-ask",
  error: "schedules-error",
  errorDetail: "schedules-error-detail",
  retry: "schedules-retry",
  unknown: "schedules-unknown",
  list: "schedules-list",
  timeline: "schedules-timeline",
  timelineEmpty: "schedules-timeline-empty",
  entry: "schedules-entry",
  entryName: "schedules-entry-name",
  entrySpec: "schedules-entry-spec",
  triggersHeading: "schedules-triggers-heading",
  triggersLoading: "schedules-triggers-loading",
  triggers: "schedules-triggers",
  trigger: "schedules-trigger",
  select: "schedules-trigger-select",
  toggle: "schedules-trigger-toggle",
  rowError: "schedules-trigger-error",
  detail: "schedules-detail",
  detailName: "schedules-detail-name",
  detailNext: "schedules-detail-next",
  history: "schedules-history",
  filterAll: "schedules-filter-all",
  filterMissed: "schedules-filter-missed",
  table: "schedules-table",
  fire: "schedules-fire",
  fireReason: "schedules-fire-reason",
  fireBadge: "schedules-fire-badge",
  fireLink: "schedules-fire-integrations",
  historyEmpty: "schedules-history-empty",
  historyLoading: "schedules-history-loading",
  historyError: "schedules-history-error",
  loadOlder: "schedules-load-older",
} as const;

// ---- One call's answer ------------------------------------------------------------------------------

/**
 * The bridge's answer, kept apart where this screen must tell them apart:
 * `unreachable` (status 0: the kernel could not be asked, which is never "nothing
 * scheduled"), `refused` (the kernel answered no, with its `error` code) and
 * `failed` (the IPC call itself failed).
 */
export type Reply<R> =
  | { readonly kind: "ok"; readonly status: number; readonly body: R }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "refused"; readonly status: number; readonly error: string; readonly message: string | undefined; readonly body: ApiError }
  | { readonly kind: "failed"; readonly message: string };

export const UNREACHABLE_TEXT = "the kernel could not be reached";
export const NO_ANSWER_TEXT = "no answer from the kernel";

/** `result` as a `Reply`; `undefined` is a failed IPC call. */
export function replyOf<R>(result: ApiResult<R> | undefined): Reply<R> {
  if (result === undefined) return { kind: "failed", message: NO_ANSWER_TEXT };
  if (result.ok) return { kind: "ok", status: result.status, body: result.body };
  if ("connection" in result) return { kind: "unreachable", message: UNREACHABLE_TEXT };
  const body: ApiError = typeof result.body === "object" && result.body !== null ? result.body : { error: `HTTP ${result.status}` };
  const error = typeof body.error === "string" && body.error !== "" ? body.error : `HTTP ${result.status}`;
  const message = typeof body.message === "string" && body.message !== "" ? body.message : undefined;
  return { kind: "refused", status: result.status, error, message, body };
}

/** What the screen has read of one route so far: the newest answer, and the newest `ok` answer (kept while a later one fails). */
export interface Read<R> {
  readonly latest: Reply<R> | undefined;
  readonly lastOk: R | undefined;
}

export const NOT_READ: Read<never> = Object.freeze({ latest: undefined, lastOk: undefined });

/** `prev` after `reply` landed: a good answer replaces the held one, a bad one never drops it. */
export function nextRead<R>(prev: Read<R>, reply: Reply<R>): Read<R> {
  return { latest: reply, lastOk: reply.kind === "ok" ? reply.body : prev.lastOk };
}

/** The route-failure card's words for a non-ok reply that is not "unreachable": `GET /schedule · 500 · the code`. */
export function failureDetail(request: string, reply: Exclude<Reply<unknown>, { readonly kind: "ok" } | { readonly kind: "unreachable" }>): string {
  if (reply.kind === "refused") return `${request} · ${reply.status} · ${reply.message ?? reply.error}`;
  return `${request} · ${reply.message}`;
}

// ---- Why a fire did not happen ------------------------------------------------------------------------

export type Tone = "ok" | "attention" | "danger" | "neutral";

export interface ReasonView {
  readonly label: string;
  readonly tone: Tone;
}

/**
 * The reasons the kernel records on a `trigger_missed` event (`kernel/src/triggers/store.ts` and `poll.ts`), with a
 * label and a tone. The code itself is always shown beneath the label, verbatim. The mockup's `missed_paused` and
 * `missed_kill_switch` are `triggers.last_result` codes; the events record `paused` and `kill_switch`.
 */
const KNOWN_REASONS: Readonly<Record<string, ReasonView>> = Object.freeze({
  paused: { label: "missed · paused", tone: "attention" },
  kill_switch: { label: "missed · kill switch", tone: "attention" },
  playbook_not_enabled: { label: "playbook not enabled", tone: "attention" },
  already_done: { label: "already done", tone: "neutral" },
  rate_limited: { label: "rate limited", tone: "attention" },
  connector_missing: { label: "no connector", tone: "danger" },
  source_error: { label: "source error", tone: "danger" },
});

/** The words under a missed fire whose kernel recorded no reason. */
export const NO_REASON_TEXT = "no reason recorded";

/** The label and tone of a missed fire's `reason`; a reason the table does not know is a neutral "missed". */
export function reasonView(reason: string | null): ReasonView {
  if (reason !== null && Object.hasOwn(KNOWN_REASONS, reason)) return KNOWN_REASONS[reason] as ReasonView;
  return { label: "missed", tone: "neutral" };
}

/** A fire's result badge: "fired", or the missed reason's label. */
export function fireView(fire: Pick<TriggerFire, "kind" | "reason">): ReasonView {
  return fire.kind === "trigger_fired" ? { label: "fired", tone: "ok" } : reasonView(fire.reason);
}

/** A missed poll that has no connector links to Integrations, whose own screen holds the action. */
export function linksToIntegrations(fire: Pick<TriggerFire, "kind" | "reason">): boolean {
  return fire.kind === "trigger_missed" && fire.reason === "connector_missing";
}

export const INTEGRATIONS_HASH = "#/integrations";

// ---- Repeats ------------------------------------------------------------------------------------------

/** Consecutive fires of one kind and reason, shown as one row. */
export interface FireGroup {
  /** The oldest fire's id: it stays put when newer fires join the group at the top, so the row is not remounted. */
  readonly key: string;
  readonly kind: TriggerFire["kind"];
  readonly reason: string | null;
  readonly count: number;
  /** The most recent fire of the group. */
  readonly newest: TriggerFire;
  /** The earliest fire of the group. */
  readonly oldest: TriggerFire;
}

/**
 * `fires` (newest first) with each run of consecutive rows of one kind and reason folded into one group. A fired
 * row and a missed one never merge, and neither do two missed rows with different reasons.
 */
export function groupFires(fires: readonly TriggerFire[]): FireGroup[] {
  const groups: { kind: TriggerFire["kind"]; reason: string | null; count: number; newest: TriggerFire; oldest: TriggerFire }[] = [];
  for (const fire of fires) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.kind === fire.kind && last.reason === fire.reason) {
      last.count += 1;
      last.oldest = fire;
    } else {
      groups.push({ kind: fire.kind, reason: fire.reason, count: 1, newest: fire, oldest: fire });
    }
  }
  return groups.map((g) => ({ ...g, key: `fire-${g.oldest.id}` }));
}

export type HistoryFilter = "all" | "missed";

/** The groups the filter shows ("Not fired" keeps the missed ones). Groups are made first, so one never spans a fired row. */
export function filterGroups(groups: readonly FireGroup[], filter: HistoryFilter): FireGroup[] {
  return filter === "all" ? [...groups] : groups.filter((g) => g.kind === "trigger_missed");
}

/** How many fires the filter counts: every loaded one, or the missed ones. */
export function countFires(fires: readonly TriggerFire[], filter: HistoryFilter): number {
  return filter === "all" ? fires.length : fires.filter((f) => f.kind === "trigger_missed").length;
}

// ---- Paging -------------------------------------------------------------------------------------------

/** The firing history loaded for one trigger: newest first, and the cursor for the next older page (`null`: the oldest is loaded). */
export interface History {
  readonly fires: readonly TriggerFire[];
  readonly cursor: string | null;
}

function isFire(value: unknown): value is TriggerFire {
  if (typeof value !== "object" || value === null) return false;
  const fire = value as { id?: unknown; kind?: unknown; at?: unknown };
  return typeof fire.id === "number" && Number.isSafeInteger(fire.id) && (fire.kind === "trigger_fired" || fire.kind === "trigger_missed") && typeof fire.at === "string";
}

/** The page's fires, newest first, each id once; anything that is not a fire is dropped. */
function firesOf(page: TriggerFiresResponse): TriggerFire[] {
  const listed: unknown = page.fires;
  if (!Array.isArray(listed)) return [];
  const seen = new Set<number>();
  const fires: TriggerFire[] = [];
  for (const item of listed as unknown[]) {
    if (!isFire(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    fires.push(item);
  }
  return fires.sort((a, b) => b.id - a.id);
}

function cursorOf(page: TriggerFiresResponse): string | null {
  return typeof page.next_before === "string" && page.next_before !== "" ? page.next_before : null;
}

/**
 * The history after a fresh first page landed. The older pages already loaded stay when the fresh page touches
 * them (it reaches back to a fire that was already loaded), so a live refetch never throws away what the owner paged
 * to. When newer fires than a page can hold arrived, the fresh page no longer touches them and the history restarts
 * from it: a gap would hide fires.
 */
export function mergeFirstPage(prev: History | undefined, page: TriggerFiresResponse): History {
  const fresh = firesOf(page);
  const cursor = cursorOf(page);
  if (prev === undefined || cursor === null || fresh.length === 0) return { fires: fresh, cursor };
  const oldestFresh = (fresh[fresh.length - 1] as TriggerFire).id;
  if (!prev.fires.some((f) => f.id >= oldestFresh)) return { fires: fresh, cursor };
  const older = prev.fires.filter((f) => f.id < oldestFresh);
  return { fires: [...fresh, ...older], cursor: older.length > 0 ? prev.cursor : cursor };
}

/** The history after an older page landed: its fires follow the loaded ones, and its cursor is the next. */
export function appendOlderPage(prev: History, page: TriggerFiresResponse): History {
  const have = new Set(prev.fires.map((f) => f.id));
  const older = firesOf(page).filter((f) => !have.has(f.id));
  return { fires: [...prev.fires, ...older], cursor: cursorOf(page) };
}

// ---- Names and specs ------------------------------------------------------------------------------------

/** A trigger's name: its playbook's name when it has one, else its action's text, else its playbook slug, else "Trigger #id". */
export function triggerName(trigger: Pick<Trigger, "id" | "playbook" | "text">, playbooks: readonly Pick<PlaybookListing, "slug" | "name">[] | undefined): string {
  const playbook = trigger.playbook === null ? undefined : playbooks?.find((p) => p.slug === trigger.playbook);
  if (playbook !== undefined && playbook.name.trim() !== "") return playbook.name;
  if (trigger.text.trim() !== "") return trigger.text;
  if (trigger.playbook !== null && trigger.playbook.trim() !== "") return trigger.playbook;
  return `Trigger #${trigger.id}`;
}

/** An upcoming entry's name: a trigger's as `triggerName`, a wake-up's "Wake-up #5 · task #7". */
export function entryName(entry: ScheduleEntry, playbooks: readonly Pick<PlaybookListing, "slug" | "name">[] | undefined): string {
  if (entry.kind === "wakeup") return entry.task_id === null ? `Wake-up #${entry.id}` : `Wake-up #${entry.id} · task #${entry.task_id}`;
  return triggerName({ id: entry.id, playbook: entry.playbook, text: entry.text }, playbooks);
}

/** The line under a wake-up's name: its recorded reason. */
export function wakeupNote(entry: ScheduleEntry): string {
  return entry.text.trim() === "" ? "No reason recorded" : `Reason: ${entry.text}`;
}

/** The trigger kinds the kernel has (`once`, `cron`, `poll`); anything else is shown as its own text. */
export type TriggerIcon = "once" | "cron" | "poll" | "wakeup" | "trigger";

/** The icon for a trigger's kind; the generic trigger icon until the kind is known. */
export function iconOf(kind: string | undefined): TriggerIcon {
  return kind === "once" || kind === "cron" || kind === "poll" ? kind : "trigger";
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

function everyText(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `every ${seconds / 3600} h`;
  if (seconds >= 60 && seconds % 60 === 0) return `every ${seconds / 60} min`;
  return `every ${seconds} s`;
}

/**
 * The spec in words: a `once` trigger's moment, a `cron` expression with its zone, a `poll`'s interval and repos.
 * The spec is untrusted JSON: a shape this does not know reads as the empty string, never a throw.
 */
export function specSummary(kind: string, spec: unknown, now: Date): string {
  const s = record(spec);
  if (s === undefined) return "";
  if (kind === "once") return typeof s.at === "string" ? whenLabel(s.at, now) : "";
  if (kind === "cron") return typeof s.cron === "string" ? (typeof s.tz === "string" && s.tz !== "" ? `${s.cron} · ${s.tz}` : s.cron) : "";
  if (kind === "poll") {
    const every = typeof s.interval_seconds === "number" && Number.isFinite(s.interval_seconds) && s.interval_seconds > 0 ? everyText(s.interval_seconds) : "";
    const repos = Array.isArray(s.repos) ? (s.repos as unknown[]).filter((r): r is string => typeof r === "string").join(", ") : "";
    return [every, repos].filter((part) => part !== "").join(" · ");
  }
  return "";
}

/** "poll · every 10 min · studio-sandbox": the trigger's kind, then its spec when there is one. */
export function specLine(trigger: Pick<Trigger, "kind" | "spec">, now: Date): string {
  const spec = specSummary(trigger.kind, trigger.spec, now);
  return spec === "" ? trigger.kind : `${trigger.kind} · ${spec}`;
}

// ---- Times --------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const DAY_MS = 86_400_000;

function dateOf(iso: string | null | undefined): Date | undefined {
  if (iso === null || iso === undefined) return undefined;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

function clock(at: Date): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The timeline's time column: "14:30" for a time on `now`'s day, else "6 Nov" (local time). A time that does not parse is shown as it came. */
export function timelineTime(iso: string, now: Date): string {
  const at = dateOf(iso);
  if (at === undefined) return iso;
  return sameDay(at, now) ? clock(at) : `${at.getDate()} ${MONTHS[at.getMonth()] ?? ""}`;
}

/** "today 17:00", else "6 Nov 09:00" (local time); "never" with no time. */
export function whenLabel(iso: string | null, now: Date): string {
  const at = dateOf(iso);
  if (at === undefined) return iso === null ? "never" : iso;
  return sameDay(at, now) ? `today ${clock(at)}` : `${at.getDate()} ${MONTHS[at.getMonth()] ?? ""} ${clock(at)}`;
}

/** The history's When column: "14:20" today, "Thu 22:40" within the last six days, else "24 Oct 09:12" (local time). */
export function fireTime(iso: string, now: Date): string {
  const at = dateOf(iso);
  if (at === undefined) return iso;
  if (sameDay(at, now)) return clock(at);
  const ago = now.getTime() - at.getTime();
  if (ago > 0 && ago < 6 * DAY_MS) return `${WEEKDAYS[at.getDay()] ?? ""} ${clock(at)}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()] ?? ""} ${clock(at)}`;
}

// ---- The feed ---------------------------------------------------------------------------------------------

/** The event kinds that change what the screen shows: a trigger, a wake-up or a playbook (its trigger) moved. */
export function isScheduleKind(kind: string): boolean {
  return kind.startsWith("trigger_") || kind.startsWith("wakeup_") || kind.startsWith("playbook_");
}

/** The id of the newest event in the feed that makes the screen read again, 0 when none. */
export function newestScheduleEventId(eventLog: readonly { readonly id: number; readonly kind: string }[]): number {
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const e = eventLog[i];
    if (e !== undefined && isScheduleKind(e.kind)) return e.id;
  }
  return 0;
}

// ---- Turning a trigger on or off ------------------------------------------------------------------------

export type ToggleOutcome =
  | { readonly kind: "done" }
  /** A `once` trigger whose time has passed: turning it on fires it at once, so the owner is asked first. */
  | { readonly kind: "confirm" }
  | { readonly kind: "refused"; readonly text: string };

/**
 * What a toggle's answer means. A `409 needs_confirmation` asks; the same answer to a request that already carried
 * `confirm` is a refusal like any other. A refusal is the kernel's `error` code, shown in the row.
 */
export function toggleOutcome(reply: Reply<unknown>, confirmed: boolean): ToggleOutcome {
  if (reply.kind === "ok") return { kind: "done" };
  if (reply.kind === "refused") {
    if (reply.status === 409 && reply.error === "needs_confirmation" && !confirmed) return { kind: "confirm" };
    return { kind: "refused", text: reply.error };
  }
  return { kind: "refused", text: reply.message };
}

/** The line the row shows for a refused toggle. */
export function toggleFailure(wantOn: boolean, text: string): string {
  return `Couldn't turn it ${wantOn ? "on" : "off"}: ${text}`;
}

/** "3 upcoming · 2 triggers on", with " · last known" while the kernel cannot be asked. */
export function summaryText(upcoming: number, triggersOn: number, lastKnown: boolean): string {
  return `${upcoming} upcoming · ${triggersOn} ${triggersOn === 1 ? "trigger" : "triggers"} on${lastKnown ? " · last known" : ""}`;
}
