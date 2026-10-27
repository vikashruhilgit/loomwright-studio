// The default token reader of `studio connectors github set` (phase 6, item
// 03, AC5): `readStdinSecret`, which every other CLI test replaces through
// `deps.readSecret`. `process.stdin` is swapped for a piped `Readable` or a
// fake terminal, and stdout/stderr writes are captured; all three are restored
// after each test, so nothing leaks into another test file. Raw mode is only
// ever set on the fake, never on the real terminal.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { MAX_STDIN_SECRET_BYTES, readStdinSecret } from "../src/integrations/cli.js";

const TOKEN = `github_pat_11STDIN${"Q".repeat(70)}`;

const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");
let stdoutWrite: MockInstance;
let stderrWrite: MockInstance;

function useStdin(stream: unknown): void {
  Object.defineProperty(process, "stdin", { configurable: true, enumerable: realStdin?.enumerable ?? true, get: () => stream });
}

/** Every text written to stderr (the prompt), joined. */
function stderrText(): string {
  return stderrWrite.mock.calls.map((c) => String(c[0])).join("");
}

beforeEach(() => {
  stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  if (realStdin !== undefined) Object.defineProperty(process, "stdin", realStdin);
  stdoutWrite.mockRestore();
  stderrWrite.mockRestore();
});

describe("readStdinSecret: piped stdin", () => {
  it.each([
    ["a trailing LF", [`${TOKEN}\n`]],
    ["a trailing CRLF", [`${TOKEN}\r\n`]],
    ["no line ending", [TOKEN]],
    ["split across chunks", [TOKEN.slice(0, 10), TOKEN.slice(10), "\r\n"]],
  ])("reads the token to the end, trimming the line end: %s", async (_name, chunks) => {
    useStdin(Readable.from(chunks.map((c) => Buffer.from(c, "utf8"))));
    expect(await readStdinSecret()).toEqual({ ok: true, token: TOKEN });
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it("reads string chunks too", async () => {
    useStdin(Readable.from([`${TOKEN}\n`], { objectMode: true }));
    expect(await readStdinSecret()).toEqual({ ok: true, token: TOKEN });
  });

  it.each([
    ["nothing", []],
    ["only a line end", ["\r\n"]],
  ])("refuses %s as empty", async (_name, chunks) => {
    useStdin(Readable.from(chunks.map((c) => Buffer.from(c, "utf8"))));
    expect(await readStdinSecret()).toEqual({ ok: false, reason: "empty" });
  });

  it(`takes exactly ${MAX_STDIN_SECRET_BYTES} bytes, and refuses one more unread, destroying the stream`, async () => {
    const atCap = "a".repeat(MAX_STDIN_SECRET_BYTES);
    useStdin(Readable.from([Buffer.from(atCap)]));
    expect(await readStdinSecret()).toEqual({ ok: true, token: atCap });

    const over = Readable.from([Buffer.from("a".repeat(MAX_STDIN_SECRET_BYTES)), Buffer.from("b"), Buffer.from("never read")]);
    useStdin(over);
    const res = await readStdinSecret();
    expect(res).toEqual({ ok: false, reason: "too_long" });
    expect(JSON.stringify(res)).not.toContain("aaaa");
    expect(over.destroyed).toBe(true);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

/** A terminal stdin: records raw mode, pause/resume and its `data` listeners. */
class FakeTty extends EventEmitter {
  readonly isTTY = true;
  readonly rawModes: boolean[] = [];
  readonly flow: string[] = [];
  encoding: string | undefined;
  setRawMode(mode: boolean): this {
    this.rawModes.push(mode);
    return this;
  }
  setEncoding(enc: string): this {
    this.encoding = enc;
    return this;
  }
  resume(): this {
    this.flow.push("resume");
    return this;
  }
  pause(): this {
    this.flow.push("pause");
    return this;
  }
}

/** Starts the reader on a fake terminal, types `keys` (one `data` event each), and returns what it read. */
async function typeAtTty(...keys: string[]): Promise<{ tty: FakeTty; res: Awaited<ReturnType<typeof readStdinSecret>> }> {
  const tty = new FakeTty();
  useStdin(tty);
  const pending = readStdinSecret();
  expect(tty.rawModes).toEqual([true]);
  expect(tty.listenerCount("data")).toBe(1);
  for (const k of keys) tty.emit("data", k);
  const res = await pending;
  return { tty, res };
}

describe("readStdinSecret: at a terminal, echo off", () => {
  it("reads one line with raw mode on, then turns raw mode off, pauses and removes its listener", async () => {
    const { tty, res } = await typeAtTty(TOKEN.slice(0, 20), TOKEN.slice(20), "\r");
    expect(res).toEqual({ ok: true, token: TOKEN });
    expect(tty.rawModes).toEqual([true, false]);
    expect(tty.encoding).toBe("utf8");
    expect(tty.flow).toEqual(["resume", "pause"]);
    expect(tty.listenerCount("data")).toBe(0);
    // Echo is off: nothing typed reaches either stream; stderr holds only the prompt and its line end.
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrText()).toBe("GitHub token (echo is off): \n");
  });

  it("Enter as LF ends the line too, and keys after it are ignored", async () => {
    const { res } = await typeAtTty(`${TOKEN}\nextra`);
    expect(res).toEqual({ ok: true, token: TOKEN });
  });

  it("Backspace (DEL or BS) removes the last character", async () => {
    const { res } = await typeAtTty("abX\u007fc", "dY\bE", "\r");
    expect(res).toEqual({ ok: true, token: "abcdE" });
  });

  it("Ctrl-C aborts, whatever was typed, and restores the terminal", async () => {
    const { tty, res } = await typeAtTty(TOKEN.slice(0, 30), "\u0003");
    expect(res).toEqual({ ok: false, reason: "aborted" });
    expect(tty.rawModes).toEqual([true, false]);
    expect(tty.listenerCount("data")).toBe(0);
    expect(stderrText()).not.toContain(TOKEN.slice(0, 30));
  });

  it("Ctrl-D on an empty line aborts; after text it ends the line", async () => {
    expect((await typeAtTty("\u0004")).res).toEqual({ ok: false, reason: "aborted" });
    expect((await typeAtTty("ab", "\u0004")).res).toEqual({ ok: true, token: "ab" });
    expect((await typeAtTty("a\u007f", "\u0004")).res).toEqual({ ok: false, reason: "aborted" });
  });

  it("Enter on an empty line is empty", async () => {
    expect((await typeAtTty("\r")).res).toEqual({ ok: false, reason: "empty" });
  });

  it(`a line over ${MAX_STDIN_SECRET_BYTES} bytes is refused at once, before Enter`, async () => {
    const { tty, res } = await typeAtTty("a".repeat(MAX_STDIN_SECRET_BYTES), "b");
    expect(res).toEqual({ ok: false, reason: "too_long" });
    expect(tty.rawModes).toEqual([true, false]);
    expect(tty.listenerCount("data")).toBe(0);
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});
