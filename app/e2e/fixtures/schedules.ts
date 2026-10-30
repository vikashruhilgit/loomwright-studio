// Schedules & triggers' canned kernel data (phase 7 item 05) for
// `startFixtureKernel({ routes })`. Every body is typed by the contract.
//
// It answers the way the kernel's routes do where the screen can tell
// (`kernel/src/gui/schedules.ts`, `kernel/src/triggers/routes.ts`):
//   GET  /schedule             every enabled trigger with a next fire and every pending wake-up, soonest first
//   GET  /triggers             the triggers, disabled ones too (the store reads `?all=1`)
//   GET  /playbooks            the playbooks the trigger names come from
//   GET  /triggers/:id/fires   one page of the trigger's firing history, newest first; `next_before` is the
//                              last id of a full page, else `null` (the page size is `PAGE_SIZE`, not 50,
//                              so three pages show "Load older")
//   POST /triggers/:id/on|off  the owner's toggle; a `once` whose time has passed answers
//                              `409 needs_confirmation` until the body carries `{"confirm": true}`
// Every body a spec sends is recorded in `toggles`, so the spec can read what the main process posted.
//
// The state is mutable and the fixture is a script for a spec: `holdSchedule` keeps the next schedule read
// open (the loading state), `failSchedule` answers it 500 (the route-failure card), and `fireOnPoll` and
// `scheduleWakeup` change the data AND append the event the kernel would (`trigger_fired`,
// `wakeup_scheduled`), which is how the screen learns. The fixture's times are relative to the moment it is
// made, so "today 17:00" and "in 4 minutes" hold whenever the spec runs.
//
// Every value here is fixture data: no real repo, account or task.
import type { EventFrame, PlaybookListing, RouteKey, ScheduleEntry, ScheduleResponse, Trigger, TriggerFire, TriggerFiresResponse, TriggerToggleResponse } from "../../src/api/contract";
import type { FixtureAnswer, FixtureKernel, FixtureKernelOptions, FixtureRequest, FixtureRoute } from "../fixture-kernel";
import { cannedStatus } from "../fixture-kernel";

const MINUTE = 60_000;

/** Fires per page: small, so the fixture's 28 fires take three pages. */
export const PAGE_SIZE = 10;

/** The trigger whose history the screen opens first (the poll on the sandbox repo). */
export const POLL_ID = 1;
/** A `once` trigger whose time has passed: off, and turning it on asks first. */
export const PAST_ONCE_ID = 6;

export type ScheduleState = "populated" | "empty";

export interface SchedulesFixtureOptions {
  /** `empty`: no triggers, no wake-ups, no history. Default `populated`. */
  readonly state?: ScheduleState;
}

export interface RecordedToggle {
  readonly path: string;
  readonly id: string;
  readonly body: unknown;
}

export interface SchedulesFixture {
  /** Pass to `startFixtureKernel`. */
  readonly options: FixtureKernelOptions;
  /** Every `POST /triggers/:id/on|off` the kernel received, in order. */
  readonly toggles: RecordedToggle[];
  /** Every `GET /triggers/:id/fires` query, in order (the `before` cursor of a "Load older"). */
  readonly fireReads: { readonly id: string; readonly before: string | undefined }[];
  /** Give the routes the started kernel, so they can append events. */
  attach(kernel: FixtureKernel): void;
  /** The next `GET /schedule` is not answered until `releaseSchedule`: the screen shows its loading state. */
  holdSchedule(): void;
  releaseSchedule(): void;
  /** `GET /schedule` answers `500 {"error": "store_unreadable"}` from now on (`undefined`: it answers normally again). */
  failSchedule(failing: boolean): void;
  /** The poll fires once more: a new `fired` row at the top of its history, and a `trigger_fired` event. */
  fireOnPoll(): void;
  /** A wake-up due after everything else: a new last timeline entry, and a `wakeup_scheduled` event. */
  scheduleWakeup(): void;
  /** An owner toggle done elsewhere (the CLI): the trigger flips and a `trigger_toggled` event follows. */
  toggleElsewhere(id: number): void;
  /** The current triggers (a copy). */
  triggers(): Trigger[];
}

/** A `PlaybookListing` for `slug`: the fields the screen reads, the rest at their defaults. */
function playbook(id: number, slug: string, name: string): PlaybookListing {
  return {
    id,
    slug,
    name,
    owning_agent: "mason",
    intent: "",
    status: "enabled",
    version: 1,
    dedupe_key_spec: null,
    dedupe_key_set_by: null,
    priority: "normal",
    priority_set_by: null,
    model: null,
    model_set_by: null,
    effort: null,
    effort_set_by: null,
    token_limit_per_day: null,
    token_limit_set_by: null,
    api_key_fallback_json: null,
    api_key_fallback_set_by: null,
    created_at: "2026-10-21T09:00:00.000Z",
    updated_at: "2026-10-21T09:00:00.000Z",
    mode: "draft",
    mode_set_by: null,
    trigger_id: null,
    next_fire_at: null,
  };
}

const PLAYBOOKS: readonly PlaybookListing[] = [playbook(1, "review-prs", "Review PRs on studio-sandbox"), playbook(2, "weekly-changelog", "Weekly changelog draft")];

function trigger(id: number, o: Partial<Trigger>): Trigger {
  return {
    id,
    owning_agent: "mason",
    playbook: null,
    kind: "cron",
    spec: { cron: "0 9 * * 5", tz: "UTC" },
    action: "message",
    text: `Trigger ${id}`,
    enabled: true,
    enabled_changed_by: null,
    enabled_changed_at: null,
    next_fire_at: null,
    last_fired_at: null,
    last_result: null,
    created_by: "wright",
    created_at: "2026-10-21T09:00:00.000Z",
    ...o,
  };
}

const at = (minutes: number): string => new Date(Date.now() + minutes * MINUTE).toISOString();

/** The fixture's triggers: the mockup's five, and a sixth `once` whose time has passed (the confirm). */
function makeTriggers(): Trigger[] {
  return [
    trigger(POLL_ID, {
      playbook: "review-prs",
      kind: "poll",
      spec: { source: "github", repos: ["studio-sandbox"], filters: {}, interval_seconds: 600 },
      action: "run_playbook",
      text: "Review PRs",
      next_fire_at: at(4),
      last_fired_at: at(-2),
      last_result: "fired",
    }),
    trigger(2, { playbook: "weekly-changelog", spec: { cron: "0 9 * * 5", tz: "UTC" }, action: "run_playbook", text: "Weekly changelog", next_fire_at: at(7 * 24 * 60), last_result: "fired" }),
    trigger(3, { text: "Friday wrap-up", spec: { cron: "0 18 * * 5", tz: "UTC" }, next_fire_at: at(300) }),
    trigger(4, { kind: "once", text: "Rotate the sandbox token", spec: { at: at(180) }, next_fire_at: at(180) }),
    trigger(5, { text: "Morning digest", spec: { cron: "0 8 * * 1-5", tz: "UTC" }, enabled: false, next_fire_at: null, last_result: "missed_paused" }),
    trigger(PAST_ONCE_ID, { kind: "once", text: "Archive the old sandbox", spec: { at: at(-60) }, enabled: false, next_fire_at: null }),
  ];
}

function makeWakeup(): ScheduleEntry {
  return { kind: "wakeup", id: 5, at: at(60), agent: null, playbook: null, action: null, text: "PR #3 review may be ready", task_id: 7 };
}

/**
 * The poll's 28 fires, newest first (ids 28 down to 1, ten minutes apart): a repeat of fired rows at the top,
 * four polls missed while paused, a connector repeat that runs across the first two pages, a reason the screen
 * does not know, and a last page of eight.
 */
function makeFires(): TriggerFire[] {
  const kinds: readonly (string | null)[] = [
    // 28 .. 19: page one
    null, null, "rate_limited", "paused", "paused", "paused", "paused", null, "kill_switch", "connector_missing",
    // 18 .. 9: page two
    "connector_missing", "source_error", "already_done", "queue_overflow", "playbook_not_enabled", "playbook_not_enabled", "playbook_not_enabled", "playbook_not_enabled", null, null,
    // 8 .. 1: page three
    "paused", "paused", null, "rate_limited", null, null, "source_error", null,
  ];
  return kinds.map((reason, index) => {
    const id = 28 - index;
    const when = new Date(Date.now() - (28 - id + 1) * 10 * MINUTE).toISOString();
    return reason === null
      ? { id, kind: "trigger_fired", at: when, scheduled_at: when, reason: null, session_id: 100 + id }
      : { id, kind: "trigger_missed", at: when, scheduled_at: when, reason, session_id: null };
  });
}

export function schedulesFixture(options: SchedulesFixtureOptions = {}): SchedulesFixture {
  const empty = options.state === "empty";
  let triggers: Trigger[] = empty ? [] : makeTriggers();
  let wakeups: ScheduleEntry[] = empty ? [] : [makeWakeup()];
  const fires = new Map<number, TriggerFire[]>(empty ? [] : [[POLL_ID, makeFires()]]);
  const toggles: RecordedToggle[] = [];
  const fireReads: { id: string; before: string | undefined }[] = [];
  let kernel: FixtureKernel | undefined;
  let nextEvent = 1;
  let nextFire = 29;
  let hold: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let failing = false;

  const event = (kind: string, payload: unknown): EventFrame => ({ type: "event", id: nextEvent++, at: new Date().toISOString(), kind, session_id: null, task_id: null, payload });
  const refresh = (id: number, change: Partial<Trigger>): void => {
    triggers = triggers.map((t) => (t.id === id ? { ...t, ...change } : t));
  };

  /** What the kernel puts in `GET /schedule`: the enabled triggers with a next fire and the pending wake-ups, soonest first, a trigger before a wake-up at one instant. */
  const entries = (): ScheduleEntry[] => {
    const rows: ScheduleEntry[] = [
      ...triggers
        .filter((t) => t.enabled && t.next_fire_at !== null)
        .map((t): ScheduleEntry => ({ kind: "trigger", id: t.id, at: t.next_fire_at as string, agent: t.owning_agent, playbook: t.playbook, action: t.action, text: t.text, task_id: null })),
      ...wakeups,
    ];
    return rows.sort((a, b) => a.at.localeCompare(b.at) || (a.kind === b.kind ? a.id - b.id : a.kind === "trigger" ? -1 : 1));
  };

  const schedule = async (): Promise<FixtureAnswer> => {
    if (hold !== undefined) await hold;
    if (failing) return { status: 500, body: { error: "store_unreadable" } };
    return { status: 200, body: { entries: entries() } satisfies ScheduleResponse };
  };

  const firesRoute = (req: FixtureRequest): FixtureAnswer => {
    fireReads.push({ id: req.params.id ?? "", before: req.query.before });
    const id = Number(req.params.id);
    if (!triggers.some((t) => t.id === id)) return { status: 404, body: { error: "not_found" } };
    const before = req.query.before === undefined ? Infinity : Number(req.query.before);
    const page = (fires.get(id) ?? []).filter((f) => f.id < before).slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    return { status: 200, body: { fires: page, next_before: page.length === PAGE_SIZE && last !== undefined ? String(last.id) : null } satisfies TriggerFiresResponse };
  };

  const toggle = (req: FixtureRequest): FixtureAnswer => {
    toggles.push({ path: req.path, id: req.params.id ?? "", body: req.body });
    const id = Number(req.params.id);
    const row = triggers.find((t) => t.id === id);
    if (row === undefined) return { status: 404, body: { error: "not_found" } };
    const enabled = req.path.endsWith("/on");
    const confirmed = (req.body as { confirm?: unknown } | undefined)?.confirm === true;
    if (enabled && row.kind === "once" && row.next_fire_at === null && Date.parse((row.spec as { at: string }).at) <= Date.now() && !confirmed) {
      return { status: 409, body: { error: "needs_confirmation", message: "this once trigger's time has passed; turning it on fires it at once", fires_at: new Date().toISOString() } };
    }
    const changed = row.enabled !== enabled;
    refresh(id, { enabled, enabled_changed_by: "owner", enabled_changed_at: new Date().toISOString(), next_fire_at: enabled ? (row.kind === "once" ? at(0) : (row.next_fire_at ?? at(30))) : null });
    if (changed) kernel?.appendEvent(event("trigger_toggled", { trigger_id: id, enabled, by: "owner" }));
    return { status: 200, body: { trigger: triggers.find((t) => t.id === id) as Trigger, changed } satisfies TriggerToggleResponse };
  };

  const routes: Partial<Record<RouteKey, FixtureRoute>> = {
    "GET /status": () => ({ status: 200, body: cannedStatus() }),
    "GET /schedule": schedule,
    "GET /triggers": () => ({ status: 200, body: { triggers } }),
    "GET /playbooks": () => ({ status: 200, body: { playbooks: empty ? [] : PLAYBOOKS } }),
    "GET /triggers/:id/fires": firesRoute,
    "POST /triggers/:id/on": toggle,
    "POST /triggers/:id/off": toggle,
    // The sidebar's Crew section reads these; nothing here is about them.
    "GET /agents": () => ({ status: 200, body: { agents: [] } }),
    "GET /approvals": () => ({ status: 200, body: { approvals: [] } }),
    "GET /messages": () => ({ status: 200, body: { messages: [] } }),
    "GET /notifications": () => ({ status: 200, body: { notifications: [] } }),
  };

  return {
    options: { routes },
    toggles,
    fireReads,
    attach(started) {
      kernel = started;
    },
    holdSchedule() {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseSchedule() {
      release?.();
      hold = undefined;
      release = undefined;
    },
    failSchedule(value) {
      failing = value;
    },
    fireOnPoll() {
      const id = nextFire;
      nextFire += 1;
      const when = new Date().toISOString();
      fires.set(POLL_ID, [{ id, kind: "trigger_fired", at: when, scheduled_at: when, reason: null, session_id: 100 + id }, ...(fires.get(POLL_ID) ?? [])]);
      refresh(POLL_ID, { last_fired_at: when, last_result: "fired" });
      kernel?.appendEvent(event("trigger_fired", { trigger_id: POLL_ID, scheduled_at: when }));
    },
    scheduleWakeup() {
      wakeups = [...wakeups, { kind: "wakeup", id: 9, at: at(14 * 24 * 60), agent: null, playbook: null, action: null, text: "Check the changelog went out", task_id: 12 }];
      kernel?.appendEvent(event("wakeup_scheduled", { wakeup_id: 9, task_id: 12 }));
    },
    toggleElsewhere(id) {
      const row = triggers.find((t) => t.id === id);
      if (row === undefined) return;
      refresh(id, { enabled: !row.enabled, next_fire_at: row.enabled ? null : (row.next_fire_at ?? at(30)) });
      kernel?.appendEvent(event("trigger_toggled", { trigger_id: id, enabled: !row.enabled, by: "owner" }));
    },
    triggers: () => triggers.map((t) => ({ ...t })),
  };
}
