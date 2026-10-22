// Untrusted text as plain, inert text: the app's mirror of the kernel's own
// escaping, so the Approvals screen shows exactly what `studio approvals`
// prints. Every field an agent, a PR body or a tool could have written passes
// through here before it reaches the DOM, and is rendered as a React text
// child (never `dangerouslySetInnerHTML`).
//
// - `printable` mirrors `printable` in `kernel/src/notifications/cli.ts`.
// - `payloadText` mirrors `payloadText` in `kernel/src/approvals/cli.ts`
//   (without its indent): JSON's own `\u001b`-style escapes are shown as
//   `\xNN`, so an ANSI escape reads the same in a payload as in a display.
//
// `kernel-mirror.test.ts` fails if the kernel's character classes drift from
// these.

// The bidi controls (U+202A-U+202E, U+2066-U+2069, U+061C, U+200E, U+200F),
// which reorder what is shown, and the line and paragraph separators (U+2028,
// U+2029), which some renderers break a line on.
export const BIDI_AND_SEPARATORS = /[\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** Every C0/C1 control character, and DEL. */
export const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;

function hex(c: string, width: number): string {
  return c.charCodeAt(0).toString(16).padStart(width, "0");
}

/**
 * `text` with every C0/C1 control character (and DEL) written as `\xNN`, and
 * every bidi control and U+2028/U+2029 as `\uNNNN` (lower-case hex). With
 * `keepNewlines`, `\n` stays a line break; otherwise it is written `\n` too.
 */
export function printable(text: string, keepNewlines = false): string {
  return text
    .replace(CONTROLS, (c) => {
      if (c === "\n" && keepNewlines) return "\n";
      if (c === "\n") return "\\n";
      return `\\x${hex(c, 2)}`;
    })
    .replace(BIDI_AND_SEPARATORS, (c) => `\\u${hex(c, 4)}`);
}

const JSON_SHORT_ESCAPES: Readonly<Record<string, string>> = { b: "\\x08", f: "\\x0c", r: "\\x0d", t: "\\x09" };

/**
 * `value` as pretty-printed JSON, escaped for display. JSON's escapes for
 * control characters (`\u001b`, `\t`, `\r`, `\b`, `\f`) are shown as `\xNN`,
 * and the C1, DEL and bidi characters JSON leaves raw are escaped by
 * `printable`; `\n` inside a string stays the two characters `\n`, and the
 * pretty-printing's own line breaks are kept.
 */
export function payloadText(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? "null";
  // Each escape is matched from its backslash, so an escaped backslash (`\\`) is never misread as the start of another.
  const escapes = json.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (whole, e: string) => {
    if (e.length === 5) {
      const code = parseInt(e.slice(1), 16);
      return code < 0x20 ? `\\x${code.toString(16).padStart(2, "0")}` : whole;
    }
    return JSON_SHORT_ESCAPES[e] ?? whole;
  });
  return printable(escapes, true);
}
