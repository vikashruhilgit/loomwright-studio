// Cron and IANA time-zone arithmetic for the triggers feature, with no
// dependency: Node's ICU (`Intl.DateTimeFormat` with `timeZone`) gives a
// zone's wall clock at any instant, and everything else is computed here.
//
// Every instant is computed from wall-clock parts in the trigger's own zone,
// one lookup per candidate instant, never from one offset fixed at
// registration: a reminder at 09:00 New York time is 14:00Z in winter and
// 13:00Z in summer. Across a daylight-saving change:
//
// - a wall-clock time skipped by a spring-forward gap (02:30 on the night New
//   York jumps from 02:00 to 03:00) does not exist, so it does not fire that
//   day;
// - a wall-clock time repeated by a fall-back overlap (01:30 on the night New
//   York goes back from 02:00 to 01:00) fires once, at its first instant.
//
// This module only computes; it never reads the store or the clock itself.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How far `nextCronFire` looks ahead before it answers "never": eight years
 * and a day, so a schedule that matches only on 29 February (once in four
 * years, or eight across a skipped century leap year) still has a next fire.
 */
const MAX_SEARCH_DAYS = 366 * 8 + 1;

/**
 * Candidates whose wall-clock time is this far before the search start's are
 * skipped without a zone lookup. Safe while no zone changes its offset by
 * more than this in one step (real changes are an hour, at most two).
 */
const SKIP_MARGIN_MS = 3 * HOUR_MS;

/** An IANA zone name's shape (`Asia/Kolkata`, `America/Argentina/Buenos_Aires`, `UTC`, `Etc/GMT+5`): never a bare offset. */
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const MAX_ZONE_NAME = 64;
/** Longest cron expression accepted. */
export const MAX_CRON_LENGTH = 200;

interface CronField {
  readonly name: string;
  readonly min: number;
  readonly max: number;
}

/** The five fields, in order (standard 5-field cron: no seconds, no year, no names, no `@` macros). */
const FIELDS: readonly CronField[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  // 0 and 7 are both Sunday.
  { name: "day-of-week", min: 0, max: 7 },
];

/** One item of a field: `*`, `n`, `n-m`, each optionally `/step`. */
const ITEM = /^(?:\*|(\d{1,2})(?:-(\d{1,2}))?)(?:\/(\d{1,2}))?$/;

/** A parsed 5-field cron expression. */
export interface CronSchedule {
  /** The expression, normalized to single spaces: what a trigger stores. */
  readonly expr: string;
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  /** 0-6, Sunday 0 (a 7 in the expression is stored as 0). */
  readonly daysOfWeek: ReadonlySet<number>;
  /**
   * The standard (Vixie) day rule: when both day fields are restricted (do
   * not start with `*`), a day matches if EITHER matches; otherwise both must.
   */
  readonly domRestricted: boolean;
  readonly dowRestricted: boolean;
}

/** The values of one field; throws `RangeError` naming the field and the item. */
function parseField(text: string, field: CronField): number[] {
  const values = new Set<number>();
  for (const item of text.split(",")) {
    const m = ITEM.exec(item);
    const bad = (why: string): RangeError =>
      new RangeError(`cron ${field.name} field ${JSON.stringify(text)}: ${JSON.stringify(item)} ${why}`);
    if (m === null) throw bad(`is not *, a number, a range or a step (${field.min}-${field.max})`);
    const [, a, b, s] = m;
    let lo = field.min;
    let hi = field.max;
    if (a !== undefined) {
      lo = Number(a);
      // `n/step` runs from n to the field's maximum, as in Vixie cron.
      hi = b !== undefined ? Number(b) : s !== undefined ? field.max : lo;
    }
    if (lo < field.min || hi > field.max) throw bad(`is outside ${field.min}-${field.max}`);
    if (lo > hi) throw bad("is a range whose start is after its end");
    const step = s === undefined ? 1 : Number(s);
    if (step < 1) throw bad("has a step below 1");
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return [...values].sort((x, y) => x - y);
}

/**
 * Parse a 5-field cron expression (`minute hour day-of-month month
 * day-of-week`; `*`, lists, ranges and steps; day-of-week 0-7, 0 and 7
 * Sunday). Throws `RangeError` naming the problem: the wrong number of
 * fields, or the field and item that is invalid.
 */
export function parseCron(expr: string): CronSchedule {
  if (typeof expr !== "string" || expr.trim() === "") throw new RangeError("a cron expression must be non-empty");
  if (expr.length > MAX_CRON_LENGTH) throw new RangeError(`a cron expression is at most ${MAX_CRON_LENGTH} characters`);
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== FIELDS.length) {
    throw new RangeError(
      `a cron expression has 5 fields (minute hour day-of-month month day-of-week); ${JSON.stringify(expr)} has ${parts.length}`,
    );
  }
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i] as CronField)) as [
    number[],
    number[],
    number[],
    number[],
    number[],
  ];
  return {
    expr: parts.join(" "),
    minutes: minute,
    hours: hour,
    daysOfMonth: new Set(dom),
    months: new Set(month),
    daysOfWeek: new Set(dow.map((d) => (d === 7 ? 0 : d))),
    domRestricted: !(parts[2] as string).startsWith("*"),
    dowRestricted: !(parts[4] as string).startsWith("*"),
  };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Cache bound: zone names come from tool input, so the cache never grows without limit. */
const MAX_FORMATTERS = 64;

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    if (formatters.size >= MAX_FORMATTERS) formatters.clear();
    formatters.set(tz, f);
  }
  return f;
}

/**
 * `tz` itself when it is an IANA zone the runtime knows, else a `RangeError`
 * naming it. Returned as given, never as ICU resolves it: ICU 2026 resolves
 * `Asia/Kolkata` to its legacy alias `Asia/Calcutta`, and the owner should see
 * the zone the trigger was created with. A bare offset (`+05:30`, which V8
 * accepts) is refused: it has no daylight-saving rules, so it is not a zone.
 */
export function checkTimeZone(tz: unknown): string {
  const refused = (): RangeError => new RangeError(`unknown time zone ${JSON.stringify(tz)}: give an IANA zone name such as Asia/Kolkata`);
  if (typeof tz !== "string" || tz.length > MAX_ZONE_NAME || !ZONE_NAME.test(tz)) throw refused();
  try {
    formatter(tz);
  } catch {
    throw refused();
  }
  return tz;
}

/**
 * The zone ICU resolves `tz` to (`Asia/Kolkata` and `asia/kolkata` both give
 * `Asia/Calcutta`; `US/Eastern` gives `America/New_York`): for comparing two
 * zones, never for storing or showing one. Throws `RangeError` for a zone the
 * runtime does not know.
 */
export function canonicalZone(tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
}

/**
 * A parsed schedule's value sets as one string: two expressions that parse to
 * the same sets and the same day rule (`1-5` and `1,2,3,4,5`, `*\/30` and
 * `0,30`, day-of-week 7 and 0) give the same string. Equal strings mean the
 * same instants; the converse is not promised (two expressions that differ
 * in their sets can still fire at the same instants).
 */
export function scheduleIdentity(s: CronSchedule): string {
  const list = (values: Iterable<number>): string => [...values].sort((x, y) => x - y).join(",");
  // The day rule only matters when both day fields are restricted (OR); otherwise both sets must match (AND).
  const rule = s.domRestricted && s.dowRestricted ? "or" : "and";
  return `${list(s.minutes)} ${list(s.hours)} ${list(s.daysOfMonth)} ${list(s.months)} ${list(s.daysOfWeek)} ${rule}`;
}

/** A wall-clock reading in a zone. `month` is 1-12. */
export interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** The wall clock in zone `tz` at instant `ms` (to the second). */
export function wallClock(tz: string, ms: number): WallClock {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year ?? NaN,
    month: parts.month ?? NaN,
    day: parts.day ?? NaN,
    hour: parts.hour ?? NaN,
    minute: parts.minute ?? NaN,
    second: parts.second ?? NaN,
  };
}

/** The wall clock read as if it were UTC, in ms (what `Date.UTC` gives for those parts). */
function asUtc(w: WallClock): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** Zone `tz`'s offset from UTC at instant `ms`, in ms (`+05:30` ⇒ 19 800 000). */
export function zoneOffsetMs(tz: string, ms: number): number {
  return asUtc(wallClock(tz, ms)) - Math.floor(ms / 1_000) * 1_000;
}

/**
 * The instants at which zone `tz` reads wall-clock `localMs` (a wall clock
 * read as UTC, whole minutes), ascending: one normally, none inside a
 * spring-forward gap, two inside a fall-back overlap. The offsets a day
 * either side cover both sides of any change near that time.
 */
export function zonedInstants(tz: string, localMs: number): number[] {
  const offsets = new Set([zoneOffsetMs(tz, localMs - DAY_MS), zoneOffsetMs(tz, localMs + DAY_MS)]);
  const found = new Set<number>();
  for (const offset of offsets) {
    const candidate = localMs - offset;
    if (asUtc(wallClock(tz, candidate)) === localMs) found.add(candidate);
  }
  return [...found].sort((x, y) => x - y);
}

/** Whether a local date (year, month 1-12, day, weekday 0-6) matches the schedule's day fields. */
function dayMatches(s: CronSchedule, month: number, day: number, weekday: number): boolean {
  if (!s.months.has(month)) return false;
  const dom = s.daysOfMonth.has(day);
  const dow = s.daysOfWeek.has(weekday);
  return s.domRestricted && s.dowRestricted ? dom || dow : dom && dow;
}

/**
 * The first instant strictly after `after` at which `cron` fires in IANA zone
 * `tz`, or `undefined` when it never does within eight years (`0 0 31 2 *`).
 * `cron` is an expression (parsed with `parseCron`, which may throw a
 * `RangeError`) or an already parsed schedule. Each candidate's instant is
 * looked up from its own wall-clock time in `tz`: a time skipped by a
 * spring-forward gap does not fire that day, a time repeated by a fall-back
 * overlap fires at its first instant only.
 */
export function nextCronFire(cron: string | CronSchedule, tz: string, after: Date): Date | undefined {
  const s = typeof cron === "string" ? parseCron(cron) : cron;
  const afterMs = after.getTime();
  if (!Number.isFinite(afterMs)) throw new RangeError("nextCronFire needs a valid instant");
  const startWall = wallClock(tz, afterMs);
  const offsetAfter = asUtc(startWall) - Math.floor(afterMs / 1_000) * 1_000;
  // Steady: the same offset a day before and two days after, so no change
  // falls in between (a zone changes at most twice a year) and, for an
  // instant in that span, wall clock minus this offset IS the instant: no
  // lookup per candidate (a `* * * * *` trigger's coalesced count calls this
  // once per missed minute). Anything else takes the exact path.
  const steady = zoneOffsetMs(tz, afterMs - DAY_MS) === offsetAfter && zoneOffsetMs(tz, afterMs + 2 * DAY_MS) === offsetAfter;
  const steadyUntil = afterMs + DAY_MS;
  // From the day before when not steady: an overlap that spans midnight can
  // put an earlier local date's time after `after`.
  let dayMs = Date.UTC(startWall.year, startWall.month - 1, startWall.day) - (steady ? 0 : DAY_MS);
  for (let i = 0; i <= MAX_SEARCH_DAYS; i++, dayMs += DAY_MS) {
    const date = new Date(dayMs);
    if (!dayMatches(s, date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCDay())) continue;
    for (const hour of s.hours) {
      for (const minute of s.minutes) {
        const localMs = dayMs + hour * HOUR_MS + minute * MINUTE_MS;
        const estimate = localMs - offsetAfter;
        if (estimate <= afterMs - SKIP_MARGIN_MS) continue;
        if (steady && estimate <= steadyUntil) {
          if (estimate > afterMs) return new Date(estimate);
          continue;
        }
        // The exact path. The first instant only: a repeated wall-clock time fires once.
        const first = zonedInstants(tz, localMs)[0];
        if (first !== undefined && first > afterMs) return new Date(first);
      }
    }
  }
  return undefined;
}

function pad(n: number, width = 2): string {
  return String(Math.trunc(Math.abs(n))).padStart(width, "0");
}

/**
 * Instant `ms` as wall-clock time in zone `tz` with its offset, to the minute:
 * `2026-10-14 17:00 +05:30`. Deterministic (no locale), for the owner's CLI.
 */
export function formatZoned(ms: number, tz: string): string {
  const w = wallClock(tz, ms);
  const offsetMin = Math.round(zoneOffsetMs(tz, ms) / MINUTE_MS);
  const sign = offsetMin < 0 ? "-" : "+";
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)} ${sign}${pad(Math.abs(offsetMin) / 60)}:${pad(Math.abs(offsetMin) % 60)}`;
}
