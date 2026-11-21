// The one quote-aware reading of a Bash command line in the kernel (phase 8 item 25b, D48).
//
// `scanShellWords` splits text into the words bash passes, and reports how each
// character was quoted and whether the text left a quote or an escape open. Three
// readers build on it, so no second splitter exists:
// - `parseBashCommand`: the policy's Bash gate (`decideToolUse`, `policy.ts`). A
//   metacharacter inside quotes is text; an unquoted one, a `$` or backtick inside
//   double quotes, and a newline or CR anywhere are refused; a form this reading
//   does not model is refused as unparsed (fail closed).
// - `shellWords` in `policy.ts`: the rail's lenient reading (an open quote runs to
//   the end), for a command the policy already allowed.
// - the Loomwright-script argument reader in `loomwright-scripts.ts`, which refuses
//   an open quote, a trailing backslash or an unquoted expansion character.
//
// Pure: string scanning only, no I/O, no imports. The text is untrusted data:
// read, never executed or interpolated.

/** How one character of the scanned text was read: outside quotes, inside `'…'`, inside `"…"`, or escaped by an unquoted backslash. */
export type ShellQuoting = "unquoted" | "single" | "double" | "escaped";

/** How the scanned text ended: closed, inside an open `'` or `"`, or on an unquoted backslash with nothing after it. */
export type ShellOpen = "none" | "single" | "double" | "backslash";

/** `scanShellWords`'s answer: the words, and whether the text left a quote or an escape open. */
export interface ShellScan {
  readonly words: string[];
  readonly open: ShellOpen;
}

/**
 * `text` split into the words bash passes, for inspection only. A space or tab
 * separates words (as in bash); single quotes keep everything up to the next
 * `'`; double quotes keep everything up to the next unescaped `"`, where a
 * backslash escapes only `"` and `\` (any other `\x` stays two characters); an
 * unquoted backslash escapes the next character (`Application\ Support` is one
 * word). Adjacent quoted and unquoted parts join into one word, and an empty
 * quoted part is a word (`''`). An open quote runs to the end of the text, and
 * a trailing unquoted backslash adds nothing; `open` says which, so a strict
 * reader can refuse them. No expansion is done here.
 *
 * `visit`, when given, sees every character that becomes part of a word, in
 * order, with how it was quoted and its index in `text`: a backslash that
 * escapes is not visited itself, the character it escapes is (`escaped`);
 * quote characters that open or close a quote are not visited.
 */
export function scanShellWords(text: string, visit?: (c: string, quoting: ShellQuoting, index: number) => void): ShellScan {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let open: ShellOpen = "none";
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "'") {
      inWord = true;
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      if (visit !== undefined) for (let j = i + 1; j < stop; j++) visit(text[j] as string, "single", j);
      word += text.slice(i + 1, stop);
      if (end === -1) open = "single";
      i = stop;
    } else if (c === '"') {
      inWord = true;
      for (i++; i < text.length && text[i] !== '"'; i++) {
        // As in bash, a backslash in double quotes escapes `"` and `\` (`$` and a backtick there are refused by the policy).
        if (text[i] === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) i++;
        visit?.(text[i] as string, "double", i);
        word += text[i];
      }
      if (i >= text.length) open = "double";
    } else if (c === "\\") {
      inWord = true;
      if (i + 1 < text.length) {
        i++;
        visit?.(text[i] as string, "escaped", i);
        word += text[i];
      } else {
        open = "backslash";
      }
    } else if (c === " " || c === "\t") {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      inWord = true;
      visit?.(c, "unquoted", i);
      word += c;
    }
  }
  if (inWord) words.push(word);
  return { words, open };
}

/**
 * `parseBashCommand`'s answer: the command's words, or why the policy refuses
 * to read it (`metacharacter`: `bash_shell_metacharacter`; `unparsed`:
 * `bash_unparsed`).
 */
export type BashParse =
  | { readonly kind: "words"; readonly words: string[] }
  | { readonly kind: "metacharacter" }
  | { readonly kind: "unparsed" };

/** Shell control and substitution characters: `;` `&` `|` `<` `>` `(` `)` `$` backtick. */
const METACHARACTERS = ";&|<>()$`";

/** Whether `c` is one of `METACHARACTERS` (one UTF-16 code unit, never empty). */
const isMetacharacter = (c: string): boolean => c.length === 1 && METACHARACTERS.includes(c);

/** Whether `c` is a line break: newline or carriage return. */
const isLineBreak = (c: string): boolean => c === "\n" || c === "\r";

/**
 * A Bash command read as the policy judges it (`decideToolUse`). The first
 * outcome that applies anywhere in the command wins:
 *
 * 1. `unparsed` (fail closed, a form this reading does not model): an
 *    unterminated `'` or `"`; an unquoted trailing `\`; an unquoted `\` before
 *    a metacharacter, a newline or a CR; `$'…'` or `$"…"` (ANSI-C or locale
 *    quoting); an unquoted heredoc or here-string marker `<<` (`<<-` and
 *    `<<<` included).
 * 2. `metacharacter`: an unquoted `;` `&` `|` `<` `>` `(` `)` `$` or backtick;
 *    a `$` or backtick anywhere inside double quotes (bash expands them there,
 *    escaped or not: `"a\$b"` is refused too); a newline or CR anywhere,
 *    quoted or not (the rail refuses every control character but tab, so a
 *    quoted line break is refused here with the same reason).
 * 3. `words` otherwise: the words `scanShellWords` reads. A metacharacter
 *    inside single quotes, or inside double quotes other than `$` and a
 *    backtick, is text. Globs, braces, `~` and `#` are left to the readers
 *    after this one, which fail closed on them (`classifyToolCall`, the
 *    Loomwright-script reader).
 *
 * Only `words` lets a command through, and then the text is one program and
 * its arguments: no chain, pipe, redirect, substitution or expansion of a
 * variable, and no quoting the scan reads differently from bash.
 */
export function parseBashCommand(command: string): BashParse {
  let unparsed = false;
  let metacharacter = false;
  const scan = scanShellWords(command, (c, quoting, i) => {
    if (quoting === "escaped") {
      // `\;`, `\$`, a backslash-newline: an escape this reading does not model.
      if (isMetacharacter(c) || isLineBreak(c)) unparsed = true;
      return;
    }
    if (isLineBreak(c)) {
      metacharacter = true;
      return;
    }
    if (quoting === "double") {
      if (c === "$" || c === "`") metacharacter = true;
      return;
    }
    if (quoting !== "unquoted" || !isMetacharacter(c)) return;
    metacharacter = true;
    // The next character is read unquoted too, so a quote there opens one: `$'…'` / `$"…"`; `<<`, `<<-`, `<<<`.
    const next = command[i + 1];
    if (c === "$" && (next === "'" || next === '"')) unparsed = true;
    if (c === "<" && next === "<") unparsed = true;
  });
  if (unparsed || scan.open !== "none") return { kind: "unparsed" };
  if (metacharacter) return { kind: "metacharacter" };
  return { kind: "words", words: scan.words };
}
