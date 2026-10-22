// The Approvals screen's escaping: the kernel's `printable` and the approvals
// CLI's `payloadText`, mirrored. Untrusted text must reach the DOM as plain
// characters: no control, no bidi override, no separator that breaks a line.
import { describe, expect, it } from "vitest";
import { payloadText, printable } from "./printable";

const ESC = "\u001b";
const RLO = "\u202e";

describe("printable", () => {
  it("writes ESC as \\x1b, so an ANSI colour shows as text", () => {
    expect(printable(`${ESC}[31mred${ESC}[0m`)).toBe("\\x1b[31mred\\x1b[0m");
  });

  it("writes every C0 control, DEL and the C1 range as \\xNN", () => {
    expect(printable("\u0000\u0007\u001a\u001f\u007f\u0080\u009f")).toBe("\\x00\\x07\\x1a\\x1f\\x7f\\x80\\x9f");
  });

  it("writes U+202E (and every bidi control) as \\u202e", () => {
    expect(printable(`a${RLO}b`)).toBe("a\\u202eb");
    expect(printable("\u202a\u202b\u202c\u202d\u2066\u2067\u2068\u2069\u061c\u200e\u200f")).toBe(
      "\\u202a\\u202b\\u202c\\u202d\\u2066\\u2067\\u2068\\u2069\\u061c\\u200e\\u200f",
    );
  });

  it("writes the line and paragraph separators as \\u2028 / \\u2029", () => {
    expect(printable("a\u2028b\u2029c")).toBe("a\\u2028b\\u2029c");
  });

  it("writes \\n literally by default, and keeps it as a line break with keepNewlines", () => {
    expect(printable("one\ntwo")).toBe("one\\ntwo");
    expect(printable("one\ntwo", true)).toBe("one\ntwo");
    // keepNewlines keeps only \n: \r and \t are still escaped.
    expect(printable("a\r\n\tb", true)).toBe("a\\x0d\n\\x09b");
  });

  it("leaves ordinary text, including non-Latin letters and emoji, alone", () => {
    expect(printable("Ship it — déjà vu, 日本語, ✓")).toBe("Ship it — déjà vu, 日本語, ✓");
  });

  it("leaves no raw control or bidi character in its output", () => {
    let all = "";
    for (let code = 0; code <= 0x9f; code += 1) all += String.fromCharCode(code);
    all += "\u061c\u200e\u200f\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069";
    expect(printable(all)).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
  });
});

describe("payloadText", () => {
  it("pretty-prints the payload and shows JSON's control escapes as \\xNN", () => {
    expect(payloadText({ tool: "Bash", command: `echo ${ESC}[31mhi` })).toBe('{\n  "tool": "Bash",\n  "command": "echo \\x1b[31mhi"\n}');
  });

  it("escapes the bidi override JSON leaves raw", () => {
    expect(payloadText({ text: `x${RLO}y` })).toBe('{\n  "text": "x\\u202ey"\n}');
  });

  it("keeps a string's \\n as the two characters, and JSON's \\t \\r \\b \\f as \\xNN", () => {
    expect(payloadText("a\nb\tc\rd\be\ff")).toBe('"a\\nb\\x09c\\x0dd\\x08e\\x0cf"');
  });

  it("never misreads an escaped backslash as the start of an escape", () => {
    // The string is a backslash followed by "u001b": JSON writes "\\u001b", which must stay as it is.
    expect(payloadText("\\u001b")).toBe('"\\\\u001b"');
  });

  it("shows an undefined payload as null", () => {
    expect(payloadText(undefined)).toBe("null");
  });
});
