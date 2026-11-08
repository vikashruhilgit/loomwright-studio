// The one text rule of the automate feature: what a string may not contain when it
// reaches an owner-facing display, a requirement item, the _BACKLOG, an invocation
// or a tool answer. Control characters (C0, DEL, C1 including U+0085), the line
// and paragraph separators (U+2028/9) and the bidirectional controls (U+200E/F,
// U+202A-E, U+2066-9) can fake a line or reorder text in the prompt that gates a
// merge. Validated inputs are refused; title-style values are cleaned.

/** One char of the excluded set. */
// eslint-disable-next-line no-control-regex
export const UNSAFE_TEXT_CHAR = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/** The same set, global, for replacing. */
// eslint-disable-next-line no-control-regex
export const UNSAFE_TEXT_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Like UNSAFE_TEXT_CHARS but keeps tab and newline (a quoted body is split on them). */
// eslint-disable-next-line no-control-regex
export const UNSAFE_BODY_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A string of one or more characters, none of them excluded. */
// eslint-disable-next-line no-control-regex
export const ONE_SAFE_LINE = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/;

/** `text` on one line: every excluded character and run of space becomes one space. */
export function oneLine(text: string): string {
  return text.replace(UNSAFE_TEXT_CHARS, " ").replace(/\s+/g, " ").trim();
}
