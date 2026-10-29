// The default token reader of `studio connectors github set` (phase 6, item
// 03, AC5): `readStdinSecret`, which every other CLI test replaces through
// `deps.readSecret`, and (item 14) the owner's declaration read after it,
// `readStdinDeclaration`: the piped input's line 2, or a second prompt with
// echo on at a terminal; and which answers declare (`yes`/`y` only). `process.stdin` is swapped for a piped `Readable` or a
// fake terminal, and stdout/stderr writes are captured; all three are restored
// after each test, so nothing leaks into another test file. Raw mode is only
// ever set on the fake, never on the real terminal.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { CliApiClient } from "../src/features/index.js";
import { DECLARATION_PROMPT, MAX_STDIN_SECRET_BYTES, connectorsSubcommand, readStdinDeclaration, readStdinSecret } from "../src/integrations/cli.js";

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

/** Reads the token, then the declaration, the way `set` does. */
async function readBoth(): Promise<{ secret: Awaited<ReturnType<typeof readStdinSecret>>; answer: Awaited<ReturnType<typeof readStdinDeclaration>> }> {
  const secret = await readStdinSecret();
  const answer = await readStdinDeclaration();
  return { secret, answer };
}

describe("the declaration after the token: piped stdin", () => {
  it.each([
    ["token LF yes LF", [`${TOKEN}\nyes\n`], "yes"],
    ["token CRLF y CRLF", [`${TOKEN}\r\ny\r\n`], "y"],
    ["token LF yes, no final line end", [`${TOKEN}\nyes`], "yes"],
    ["split across chunks, mid-token and mid-answer", [TOKEN.slice(0, 10), `${TOKEN.slice(10)}\ny`, "es\n"], "yes"],
    ["an empty line 2", [`${TOKEN}\n\n`], ""],
    ["a further line is ignored", [`${TOKEN}\nyes\nnonsense\n`], "yes"],
  ])("%s: line 1 is the token, line 2 the answer, from one read", async (_name, chunks, answer) => {
    useStdin(Readable.from(chunks.map((c) => Buffer.from(c, "utf8"))));
    expect(await readBoth()).toEqual({ secret: { ok: true, token: TOKEN }, answer });
    // Nothing is printed at a pipe, and the answer is not kept for a second use.
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
    expect(await readStdinDeclaration()).toBeUndefined();
  });

  it.each([
    ["token LF", [`${TOKEN}\n`], ""],
    ["token CRLF", [`${TOKEN}\r\n`], ""],
    ["token alone", [TOKEN], undefined],
  ])("%s: no answer (an empty one declares nothing)", async (_name, chunks, answer) => {
    useStdin(Readable.from(chunks.map((c) => Buffer.from(c, "utf8"))));
    expect(await readBoth()).toEqual({ secret: { ok: true, token: TOKEN }, answer });
  });

  it("an answer from an earlier read is never reused: a new token read clears it", async () => {
    useStdin(Readable.from([Buffer.from(`${TOKEN}\nyes\n`)]));
    await readStdinSecret();
    useStdin(Readable.from([Buffer.from(TOKEN)]));
    await readStdinSecret();
    expect(await readStdinDeclaration()).toBeUndefined();
  });

  it(`the token and the answer share one ${MAX_STDIN_SECRET_BYTES}-byte cap: over it is refused unread, and no answer is kept`, async () => {
    const over = Readable.from([Buffer.from(`${TOKEN}\n`), Buffer.from("y".repeat(MAX_STDIN_SECRET_BYTES)), Buffer.from("never read")]);
    useStdin(over);
    expect(await readStdinSecret()).toEqual({ ok: false, reason: "too_long" });
    expect(over.destroyed).toBe(true);
    expect(await readStdinDeclaration()).toBeUndefined();
  });

  it("an empty token line is empty even when an answer follows", async () => {
    useStdin(Readable.from([Buffer.from("\nyes\n")]));
    expect(await readStdinSecret()).toEqual({ ok: false, reason: "empty" });
  });
});

describe("the declaration after the token: at a terminal, echo on", () => {
  /** A token typed with echo off, then the declaration prompt, answered with `keys`. */
  async function typeDeclaration(...keys: string[]): Promise<{ tty: FakeTty; answer: Awaited<ReturnType<typeof readStdinDeclaration>> }> {
    const tty = new FakeTty();
    useStdin(tty);
    const pendingSecret = readStdinSecret();
    tty.emit("data", `${TOKEN}\r`);
    expect(await pendingSecret).toEqual({ ok: true, token: TOKEN });
    stderrWrite.mockClear();
    const pending = readStdinDeclaration();
    for (const k of keys) tty.emit("data", k);
    return { tty, answer: await pending };
  }

  it("asks the question on stderr, reads one visible line (no raw mode), and leaves the terminal paused with no listener", async () => {
    const { tty, answer } = await typeDeclaration("yes\n");
    expect(answer).toBe("yes");
    expect(stderrText()).toBe(DECLARATION_PROMPT);
    // Raw mode was only the token's (on, then off); the declaration never turns it on.
    expect(tty.rawModes).toEqual([true, false]);
    expect(tty.listenerCount("data")).toBe(0);
    expect(tty.listenerCount("end")).toBe(0);
    expect(tty.flow.at(-1)).toBe("pause");
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it.each([
    ["Enter as CR", ["y\r"], "y"],
    ["a line split across events", ["ye", "s\n"], "yes"],
    ["text after the line end is ignored", ["yes\nmore"], "yes"],
    ["an empty line", ["\n"], ""],
  ])("%s", async (_name, keys, expected) => {
    expect((await typeDeclaration(...keys)).answer).toBe(expected);
  });

  it("end of input after text ends the line; end of input on nothing is an empty answer", async () => {
    const tty = new FakeTty();
    useStdin(tty);
    const pendingSecret = readStdinSecret();
    tty.emit("data", `${TOKEN}\r`);
    await pendingSecret;
    const pending = readStdinDeclaration();
    tty.emit("data", "ye");
    tty.emit("end");
    expect(await pending).toBe("ye");
    expect(tty.listenerCount("end")).toBe(0);
  });

  it(`a line over ${MAX_STDIN_SECRET_BYTES} bytes is no answer`, async () => {
    const { tty, answer } = await typeDeclaration("y".repeat(MAX_STDIN_SECRET_BYTES + 1));
    expect(answer).toBeUndefined();
    expect(tty.listenerCount("data")).toBe(0);
  });

  it("the token never reaches stderr or stdout through the prompt", async () => {
    await typeDeclaration("yes\n");
    expect(stderrText()).not.toContain(TOKEN.slice(0, 20));
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

describe("studio connectors github set: argv --declared-read-only never connects (AC4)", () => {
  it("exits 2 with nothing read and nothing sent, and prints no argument", async () => {
    const requests: string[] = [];
    const client: CliApiClient = {
      request: async (method, path) => {
        requests.push(`${method} ${path}`);
        return { status: 200, body: {} };
      },
    };
    let reads = 0;
    const out: string[] = [];
    const sub = connectorsSubcommand({
      readSecret: async () => {
        reads += 1;
        return { ok: true, token: TOKEN };
      },
      readDeclaration: async () => {
        reads += 1;
        return "yes";
      },
    });
    const code = await sub.run(["github", "set", "--declared-read-only"], client, { stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => out.push(c) } });
    expect(code).toBe(2);
    expect(requests).toEqual([]);
    expect(reads).toBe(0);
    expect(out.join("")).not.toContain("--declared-read-only");
    expect(out.join("")).not.toContain(TOKEN);
  });
});

describe("studio connectors github set: only yes or y declares (AC2)", () => {
  async function bodyFor(answer: string | undefined): Promise<unknown> {
    const bodies: unknown[] = [];
    const client: CliApiClient = {
      request: async (_method, _path, body) => {
        bodies.push(body);
        return { status: 200, body: { connector: { account_login: "o", reachable_repos: [], expires_at: null } } };
      },
    };
    const sub = connectorsSubcommand({ readSecret: async () => ({ ok: true, token: TOKEN }), readDeclaration: async () => answer });
    expect(await sub.run(["github", "set"], client, { stdout: { write: () => true }, stderr: { write: () => true } })).toBe(0);
    return bodies[0];
  }

  it.each(["yes", "y", "YES", " Y ", "Yes\n"])("%j sends declared_read_only: true", async (answer) => {
    expect(await bodyFor(answer)).toEqual({ token: TOKEN, declared_read_only: true });
  });

  it.each([undefined, "", "n", "no", "yess", "true", "1", "sure", "yes please", "ok"])("%j sends the token alone", async (answer) => {
    expect(await bodyFor(answer)).toEqual({ token: TOKEN });
  });
});
