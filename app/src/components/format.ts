// Number and date formatting with formatters made once (2026-11-17, measured live).
//
// `n.toLocaleString(locale)` and `date.toLocaleTimeString(locale, options)` build a new
// `Intl` formatter on every call: about 57 µs each against 0.7 µs for a kept formatter's
// `format`. The Tasks board formats each card's time on every render and renders all of its
// cards on every kernel event, so while a run session was working (a tool decision every few
// seconds) the board's renders took the renderer to 100% CPU and never caught up: a profile
// of the stuck page put ~70% of its time in that one call. Every formatting call in the app
// goes through here, so the cost no longer grows with the number of rows times the number
// of events.
//
// Honest limit: a kept date formatter keeps the locale and time zone it was made with, so a
// change of either while the app is open shows in times after a restart.

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** The kept `Intl.NumberFormat` for these arguments. */
function numberFormat(locale: string | undefined, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify([locale ?? null, options ?? null]);
  let format = numberFormats.get(key);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format;
}

/** The kept `Intl.DateTimeFormat` for these arguments (`undefined` or `[]` locale: the system's). */
function dateFormat(locale: string | readonly string[] | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify([locale ?? null, options]);
  let format = dateFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale as string | string[] | undefined, options);
    dateFormats.set(key, format);
  }
  return format;
}

/** `14,208`: what `n.toLocaleString("en-US")` gives, with a kept formatter. */
export function countText(n: number): string {
  return numberFormat("en-US").format(n);
}

/** What `at.toLocaleTimeString(locale, options)` gives, with a kept formatter. */
export function timeText(at: Date, options: Intl.DateTimeFormatOptions, locale?: string | readonly string[]): string {
  return dateFormat(locale, options).format(at);
}

/** What `at.toLocaleDateString(locale, options)` gives, with a kept formatter. */
export function dateText(at: Date, options: Intl.DateTimeFormatOptions, locale?: string | readonly string[]): string {
  return dateFormat(locale, options).format(at);
}

/** What `at.toLocaleString(locale, options)` gives, with a kept formatter. */
export function dateTimeText(at: Date, options: Intl.DateTimeFormatOptions, locale?: string | readonly string[]): string {
  return dateFormat(locale, options).format(at);
}
