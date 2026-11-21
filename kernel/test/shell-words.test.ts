import { describe, expect, it } from "vitest";
import { matchLoomwrightScript } from "../src/sessions/loomwright-scripts.js";
import { shellWords } from "../src/sessions/policy.js";
import { parseBashCommand, scanShellWords } from "../src/sessions/shell-words.js";
import type { BashParse, ShellQuoting } from "../src/sessions/shell-words.js";

const words = (...w: string[]): BashParse => ({ kind: "words", words: w });
const METACHARACTER: BashParse = { kind: "metacharacter" };
const UNPARSED: BashParse = { kind: "unparsed" };

// Phase 8 item 25b (D48): the kernel's one quote-aware tokenizer. A parser bug here is a safety bug (a quote read
// differently from bash would let a chained command through the policy), so the tricky inputs are pinned one by one.
describe("parseBashCommand: a pinned table of tricky inputs (AC7)", () => {
  const table: readonly (readonly [string, BashParse])[] = [
    // The brief's required rows.
    [`'a'"$b"`, METACHARACTER],
    [`"\\""`, words('"')],
    [`'it''s'`, words("its")],
    [`"a'b"`, words("a'b")],
    [`'a"b'`, words('a"b')],
    [`"a\\\\"`, words("a\\")],
    [`"a\\$b"`, METACHARACTER],
    [`$'x'`, UNPARSED],
    [`'unterminated`, UNPARSED],
    [`"unterminated`, UNPARSED],
    [`a\\`, UNPARSED],
    [`a\\;b`, UNPARSED],
    [`\\"hi\\"`, words('"hi"')],
    [`a\\ b`, words("a b")],
    [`cat <<EOF`, UNPARSED],
    [`cat <<<x`, UNPARSED],
    [`a'b;c'd`, words("ab;cd")],
    [`''`, words("")],
    // Quoting and joining.
    [``, words()],
    [`""`, words("")],
    [`a '' b`, words("a", "", "b")],
    [`a"b"c'd'e`, words("abcde")],
    [`"a b"\tc  d`, words("a b", "c", "d")],
    [`"a\\b"`, words("a\\b")],
    [`a\\\\b`, words("a\\b")],
    [`\\'x`, words("'x")],
    [`a\\*b`, words("a*b")],
    // Every metacharacter inside single quotes is text, and inside double quotes all but `$` and a backtick.
    [`'; & | < > ( ) $ \`'`, words("; & | < > ( ) $ `")],
    [`"; & | < > ( )"`, words("; & | < > ( )")],
    [`'$(id)'`, words("$(id)")],
    [`'<<EOF'`, words("<<EOF")],
    [`"\`id\`"`, METACHARACTER],
    [`"$'x'"`, METACHARACTER],
    // Unquoted metacharacters, alone or glued to a quoted part.
    [`a;b`, METACHARACTER],
    [`'a';b`, METACHARACTER],
    [`a&&b`, METACHARACTER],
    [`a <b`, METACHARACTER],
    [`a$b`, METACHARACTER],
    [`a\`b\``, METACHARACTER],
    // Line breaks, quoted or not.
    [`a\nb`, METACHARACTER],
    [`'a\nb'`, METACHARACTER],
    [`"a\rb"`, METACHARACTER],
    // Forms not modelled: fail closed, and they win over a metacharacter elsewhere.
    [`$"x"`, UNPARSED],
    [`cat <<-EOF`, UNPARSED],
    [`a\\\nb`, UNPARSED],
    [`a\\\rb`, UNPARSED],
    [`a\\$b`, UNPARSED],
    [`a\\|b`, UNPARSED],
    [`a; 'b`, UNPARSED],
    [`"a\\`, UNPARSED],
  ];
  for (const [input, outcome] of table) {
    it(`${JSON.stringify(input)} → ${outcome.kind === "words" ? JSON.stringify(outcome.words) : outcome.kind}`, () => {
      expect(parseBashCommand(input)).toEqual(outcome);
    });
  }
});

describe("scanShellWords: the shared scan behind every reader", () => {
  it("reports how the text ended: closed, an open quote, or a trailing backslash", () => {
    expect(scanShellWords("a 'b' \"c\" d\\ e").open).toBe("none");
    expect(scanShellWords("a 'b")).toEqual({ words: ["a", "b"], open: "single" });
    expect(scanShellWords('a "b\\"c')).toEqual({ words: ["a", 'b"c'], open: "double" });
    expect(scanShellWords("a b\\")).toEqual({ words: ["a", "b"], open: "backslash" });
  });

  it("visits each word character with its quoting, never an opening or closing quote or an escaping backslash", () => {
    const seen: [string, ShellQuoting][] = [];
    scanShellWords(`a'b'"c\\"d"\\e`, (c, q) => seen.push([c, q]));
    expect(seen).toEqual([["a", "unquoted"], ["b", "single"], ["c", "double"], ['"', "double"], ["d", "double"], ["e", "escaped"]]);
  });
});

describe("the two wrapped splitters keep their outputs (AC7)", () => {
  it("policy.ts shellWords stays lenient: an open quote runs to the end, a trailing backslash adds nothing", () => {
    expect(shellWords("echo 'unterminated here")).toEqual(["echo", "unterminated here"]);
    expect(shellWords('echo "a\\"b')).toEqual(["echo", 'a"b']);
    expect(shellWords("echo a\\")).toEqual(["echo", "a"]);
    expect(shellWords("cat ~/.claude/x 'a b' c\\ d")).toEqual(["cat", "~/.claude/x", "a b", "c d"]);
    // It never refuses: the policy decides first, and the rail reads the same words for every command it admits.
    expect(shellWords("a;b $x")).toEqual(["a;b", "$x"]);
  });

  it("the Loomwright-script reader fails closed on an unquoted expansion character, an open quote or a trailing backslash, and reads quoted text as text", () => {
    const helpers = "/lw/scripts/automate-helpers.sh";
    const next = "/lw/scripts/automate-next-step.sh";
    const admitted = [helpers, next];
    for (const args of ["meta-entry x*", "meta-entry x?", "meta-entry [x]", "meta-entry {a,b}", "meta-entry ~", "meta-entry ^x", "meta-entry #", "meta-entry !x", "meta-entry 'a", 'meta-entry "a', "meta-entry a\\"]) {
      expect(matchLoomwrightScript(`bash ${helpers} ${args}`, admitted), args).toBeUndefined();
    }
    for (const args of ["meta-entry 'x*'", 'meta-entry "x?"', "meta-entry x\\*", "progress-append /w/r.md 'a (b); c | d $e'", `progress-append /w/r.md "a (b); c"`]) {
      expect(matchLoomwrightScript(`bash ${helpers} ${args}`, admitted), args).toBe(helpers);
    }
    expect(matchLoomwrightScript(`bash ${next} --result '{"a": 1}`, admitted)).toBeUndefined();
    expect(matchLoomwrightScript(`bash ${next} /w/r.md --result '{"note": "a; b (c) $d"}' --session-id s1`, admitted)).toBe(next);
  });
});
