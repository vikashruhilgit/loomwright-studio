// Query-string parsing the `gui` parts share (phase 7): the "positive whole
// number" check that `tasks`, `schedules` and `budget-audit` each need.
// Pure functions of their input, no store and no I/O, so the `studio` CLI
// (which loads the gui registry) pulls nothing in through this file.
//
// `playbook-history.ts` keeps its own `positiveInt(raw, pattern)` on purpose:
// it takes caller-specific digit-count patterns (an id of at most 16 digits, a
// limit of at most 3), so it is not the same helper.

/** A positive integer written in digits only (no sign, no leading zero, no decimal point, within the safe range); `undefined` otherwise. */
export function positiveIntegerOf(raw: string): number | undefined {
  if (!/^[1-9]\d*$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** A page-size `limit`: `fallback` when absent; else a positive whole number of at most `max`; `undefined` when it is anything else. */
export function limitOf(raw: string | undefined, fallback: number, max: number): number | undefined {
  if (raw === undefined) return fallback;
  const n = positiveIntegerOf(raw);
  return n !== undefined && n <= max ? n : undefined;
}
