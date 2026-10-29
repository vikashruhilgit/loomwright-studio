// `studio connectors`: the owner's connectors from a terminal, over the routes
// in `github/routes.ts`.
//
//   studio connectors [--json]                every connector, one line each (or the API's JSON)
//   studio connectors github status [--json]  the GitHub connector in full: account, permissions, expiry, repos
//   studio connectors github set              read the token from stdin (then the owner's declaration), then POST /connectors/github/token
//   studio connectors github disconnect       POST /connectors/github/disconnect
//
// The token is read ONLY from stdin: piped, or typed at a terminal with echo
// off. `set` with any argument exits 2 before the kernel is contacted, and
// this verb never echoes an argument (one may be a pasted token) or what it
// read. Nothing it prints holds the token: the kernel never answers it.
//
// The owner's declaration (that a fine-grained token's every permission is
// Read, which GitHub cannot say) is read AFTER the token, from the same input:
// at a terminal a second prompt (echo on) asks for it; piped, line 1 is the
// token and an optional line 2 is the answer. Both come from one capped read
// (`MAX_STDIN_SECRET_BYTES`); `readDeclaration` never reads the stream again.
// Only `yes` or `y` declares: any other answer, or none, sends the token
// alone, so a token whose permissions GitHub does not report is refused. It is
// never an argument: `set` with any argument still exits 2.
//
// Text from GitHub (the login, permission and repo names) is untrusted data:
// it is printed through `shown`, so no control character reaches the
// terminal. This module never imports `../cli/index.js` (that one imports the
// feature registry, which imports this), the Agent SDK, the session manager
// or `kernel.ts`.
import { shown } from "../approvals/cli.js";
import type { CliApiClient, CliSubcommandOutput, ContributedSubcommand } from "../features/contribution.js";

export const CONNECTORS_SUBCOMMAND = "connectors";
export const CONNECTORS_HELP = "studio connectors [--json] | studio connectors github status [--json] | disconnect | set (the token on stdin, never an argument)";

/** The most bytes of stdin `set` reads: far more than any token, so a longer input is refused unread. */
export const MAX_STDIN_SECRET_BYTES = 4096;

/** What reading the token gave: the token, or why there is none (never the input itself). */
export type SecretRead = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly reason: "empty" | "too_long" | "aborted" };

/** The owner's answer to the declaration question, as typed (`undefined`: none was given). Never printed. */
export type DeclarationRead = string | undefined;

export interface ConnectorsSubcommandDeps {
  /** Read the token. Default: `readStdinSecret` (stdin; echo off at a terminal). */
  readonly readSecret?: () => Promise<SecretRead>;
  /** Read the owner's declaration answer, after the token. Default: `readStdinDeclaration` (the piped input's line 2; a prompt, echo on, at a terminal). */
  readonly readDeclaration?: () => Promise<DeclarationRead>;
}

/** The question asked at a terminal. */
export const DECLARATION_PROMPT = "Is this a fine-grained token, and is every permission you gave it Read? Type yes to declare it: ";

/** Whether `answer` declares: `yes` or `y`, trimmed, any case. Anything else (or none) does not. */
export function isDeclaration(answer: DeclarationRead): boolean {
  const a = answer?.trim().toLowerCase();
  return a === "yes" || a === "y";
}

/** `raw` without its trailing line ending(s): a piped `echo` adds one. */
function trimLineEnd(raw: string): string {
  return raw.replace(/[\r\n]+$/, "");
}

/** The answer line that followed the token on piped stdin, kept for `readStdinDeclaration` (which never reads the stream again). Cleared by each token read. */
let pipedAnswer: DeclarationRead;

function secretOf(raw: string, over: boolean): SecretRead {
  if (over) return { ok: false, reason: "too_long" };
  const token = trimLineEnd(raw);
  return token === "" ? { ok: false, reason: "empty" } : { ok: true, token };
}

/** Reads piped stdin to its end, at most `MAX_STDIN_SECRET_BYTES` bytes: line 1 is the token, the next line (if any) is kept as the declaration answer. */
async function readPiped(stdin: NodeJS.ReadStream): Promise<SecretRead> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stdin) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : (chunk as Buffer);
    total += buf.byteLength;
    if (total > MAX_STDIN_SECRET_BYTES) {
      stdin.destroy();
      return secretOf("", true);
    }
    chunks.push(buf);
  }
  const [first = "", second] = Buffer.concat(chunks).toString("utf8").split(/\r\n|\n|\r/, 2);
  pipedAnswer = second;
  return secretOf(first, false);
}

/** Reads one line at a terminal with echo ON (cooked mode: the terminal edits and shows it); EOF ends it. At most `MAX_STDIN_SECRET_BYTES` bytes, else none. */
function readVisible(stdin: NodeJS.ReadStream, prompt: (text: string) => void): Promise<DeclarationRead> {
  return new Promise((resolve) => {
    prompt(DECLARATION_PROMPT);
    let line = "";
    const finish = (answer: DeclarationRead): void => {
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.pause();
      resolve(answer);
    };
    const onEnd = (): void => finish(line);
    const onData = (text: string): void => {
      line += text;
      if (Buffer.byteLength(line, "utf8") > MAX_STDIN_SECRET_BYTES) return finish(undefined);
      const end = line.search(/[\r\n]/);
      if (end !== -1) finish(line.slice(0, end));
    };
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.resume();
  });
}

/** Reads one line at a terminal with echo off (raw mode): Enter ends it, Backspace edits it, Ctrl-C or Ctrl-D on an empty line aborts. */
function readHidden(stdin: NodeJS.ReadStream, prompt: (text: string) => void): Promise<SecretRead> {
  return new Promise((resolve) => {
    prompt("GitHub token (echo is off): ");
    let line = "";
    const finish = (result: SecretRead): void => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      prompt("\n");
      resolve(result);
    };
    const onData = (text: string): void => {
      for (const ch of text) {
        if (ch === "\u0003" || (ch === "\u0004" && line === "")) return finish({ ok: false, reason: "aborted" });
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish(secretOf(line, false));
        if (ch === "\u007f" || ch === "\b") line = line.slice(0, -1);
        else line += ch;
        if (Buffer.byteLength(line, "utf8") > MAX_STDIN_SECRET_BYTES) return finish(secretOf("", true));
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

/** The default token reader: stdin, with echo off when it is a terminal (the prompt goes to stderr). */
export function readStdinSecret(): Promise<SecretRead> {
  const stdin = process.stdin;
  pipedAnswer = undefined;
  return stdin.isTTY === true ? readHidden(stdin, (t) => void process.stderr.write(t)) : readPiped(stdin);
}

/** The default declaration reader: at a terminal a visible prompt (on stderr); piped, the line that followed the token (the stream is not read again). */
export function readStdinDeclaration(): Promise<DeclarationRead> {
  const stdin = process.stdin;
  if (stdin.isTTY === true) return readVisible(stdin, (t) => void process.stderr.write(t));
  const answer = pipedAnswer;
  pipedAnswer = undefined;
  return Promise.resolve(answer);
}

type Command =
  | { readonly kind: "list"; readonly json: boolean }
  | { readonly kind: "status"; readonly json: boolean }
  | { readonly kind: "set" }
  | { readonly kind: "set-with-argument" }
  | { readonly kind: "disconnect" };

function parse(args: readonly string[]): Command | undefined {
  if (args.length === 0) return { kind: "list", json: false };
  if (args.length === 1 && args[0] === "--json") return { kind: "list", json: true };
  if (args[0] !== "github") return undefined;
  const [, verb, ...rest] = args;
  if (verb === undefined || verb === "status") {
    if (rest.length === 0) return { kind: "status", json: false };
    return rest.length === 1 && rest[0] === "--json" ? { kind: "status", json: true } : undefined;
  }
  if (verb === "--json" && rest.length === 0) return { kind: "status", json: true };
  if (verb === "set") return rest.length === 0 ? { kind: "set" } : { kind: "set-with-argument" };
  if (verb === "disconnect") return rest.length === 0 ? { kind: "disconnect" } : undefined;
  return undefined;
}

interface ConnectorLike {
  readonly kind?: unknown;
  readonly status?: unknown;
  readonly account_login?: unknown;
  readonly permissions?: unknown;
  readonly reachable_repos?: unknown;
  readonly expires_at?: unknown;
  readonly verified_at?: unknown;
  readonly permissions_source?: unknown;
  readonly permissions_declared_at?: unknown;
}

/** A value from the API as one safe terminal token. */
function text(value: unknown): string {
  return value === null || value === undefined ? "-" : shown(String(value));
}

function reposOf(c: ConnectorLike): string[] {
  return Array.isArray(c.reachable_repos) ? c.reachable_repos.filter((r): r is string => typeof r === "string") : [];
}

function permissionsText(c: ConnectorLike): string {
  // The owner's word, not GitHub's: said so, with when.
  if (c.permissions_source === "declared") return `read-only, declared by the owner at ${text(c.permissions_declared_at)}`;
  if (typeof c.permissions !== "object" || c.permissions === null || Array.isArray(c.permissions)) return "-";
  const entries = Object.entries(c.permissions as Record<string, unknown>);
  return entries.length === 0 ? "-" : entries.map(([name, level]) => `${shown(name)}: ${text(level)}`).join(", ");
}

/** One line per connector. */
export function formatConnectors(connectors: readonly ConnectorLike[]): string {
  if (connectors.length === 0) return "no connectors (studio connectors github set connects GitHub)\n";
  return connectors
    .map((c) => {
      const account = c.account_login == null ? "" : ` as ${text(c.account_login)}`;
      return `${text(c.kind)}: ${text(c.status)}${account}; expires ${text(c.expires_at)}; verified ${text(c.verified_at)}; ${reposOf(c).length} reachable repos\n`;
    })
    .join("");
}

/** The GitHub connector in full, or a line saying there is none. */
export function formatGitHubStatus(c: ConnectorLike | undefined): string {
  if (c === undefined) return "github: not connected (studio connectors github set connects it)\n";
  const repos = reposOf(c);
  return [
    `github: ${text(c.status)}`,
    `  account: ${text(c.account_login)}`,
    `  permissions: ${permissionsText(c)}`,
    `  expires: ${text(c.expires_at)}`,
    `  verified: ${text(c.verified_at)}`,
    `  reachable repos (${repos.length}): ${repos.length === 0 ? "-" : repos.map(shown).join(", ")}`,
  ]
    .map((l) => `${l}\n`)
    .join("");
}

/** A refusal's code (a known shape only) and message, as one safe line. */
function refusalText(body: unknown): string {
  const b = (typeof body === "object" && body !== null ? body : {}) as { error?: unknown; message?: unknown };
  const code = typeof b.error === "string" && /^[a-z_]{1,64}$/.test(b.error) ? b.error : "unknown";
  return typeof b.message === "string" ? `${code}: ${shown(b.message)}` : code;
}

const SECRET_REFUSALS: Record<Exclude<SecretRead, { ok: true }>["reason"], string> = {
  empty: "studio: no token on stdin: pipe it in, or type it at the prompt",
  too_long: `studio: what was read is longer than any token (over ${MAX_STDIN_SECRET_BYTES} bytes); nothing was sent`,
  aborted: "studio: no token entered; nothing was sent",
};

/**
 * The `studio connectors` subcommand. `deps.readSecret` replaces the stdin
 * reader (tests pass the token directly; the shipped part reads stdin).
 */
export function connectorsSubcommand(deps: ConnectorsSubcommandDeps = {}): ContributedSubcommand {
  const readSecret = deps.readSecret ?? readStdinSecret;
  const readDeclaration = deps.readDeclaration ?? readStdinDeclaration;

  async function getConnectors(client: CliApiClient, out: CliSubcommandOutput): Promise<ConnectorLike[] | undefined> {
    const res = await client.request("GET", "/connectors");
    const connectors = (res.body as { connectors?: unknown } | undefined)?.connectors;
    if (res.status !== 200) {
      out.stderr.write(`studio: kernel API answered ${res.status} to GET /connectors\n`);
      return undefined;
    }
    if (!Array.isArray(connectors)) {
      out.stderr.write("studio: kernel API sent an unreadable answer to GET /connectors\n");
      return undefined;
    }
    return connectors as ConnectorLike[];
  }

  async function change(path: string, body: unknown, client: CliApiClient, out: CliSubcommandOutput, done: (c: ConnectorLike) => string, failed: string): Promise<number> {
    const res = await client.request("POST", path, body);
    if (res.status === 200) {
      const connector = (res.body as { connector?: unknown } | undefined)?.connector;
      out.stdout.write(done(typeof connector === "object" && connector !== null ? (connector as ConnectorLike) : {}));
      return 0;
    }
    out.stderr.write(`studio: ${failed}: ${refusalText(res.body)}\n`);
    return 1;
  }

  return {
    name: CONNECTORS_SUBCOMMAND,
    help: CONNECTORS_HELP,
    async run(args, client, out) {
      const command = parse(args);
      if (command === undefined) {
        // Never the arguments themselves: one may be a pasted token.
        out.stderr.write(`studio: unknown connectors command\nusage: ${CONNECTORS_HELP}\n`);
        return 2;
      }
      if (command.kind === "set-with-argument") {
        out.stderr.write(
          "studio: connectors github set takes no argument: a token on the command line is kept in your shell history and shown by ps. Nothing was sent, and the argument is not shown here. Pipe the token in, or type it at the prompt.\n" +
            `usage: ${CONNECTORS_HELP}\n`,
        );
        return 2;
      }
      if (command.kind === "list") {
        const connectors = await getConnectors(client, out);
        if (connectors === undefined) return 1;
        out.stdout.write(command.json ? `${JSON.stringify({ connectors }, null, 2)}\n` : formatConnectors(connectors));
        return 0;
      }
      if (command.kind === "status") {
        const connectors = await getConnectors(client, out);
        if (connectors === undefined) return 1;
        const github = connectors.find((c) => c.kind === "github");
        out.stdout.write(command.json ? `${JSON.stringify({ connector: github ?? null }, null, 2)}\n` : formatGitHubStatus(github));
        return 0;
      }
      if (command.kind === "disconnect") {
        return change("/connectors/github/disconnect", undefined, client, out, () => "studio: GitHub disconnected: the Keychain item is deleted and the connector row is kept\n", "GitHub not disconnected");
      }
      const secret = await readSecret();
      if (!secret.ok) {
        out.stderr.write(`${SECRET_REFUSALS[secret.reason]}\n`);
        return 1;
      }
      // The declaration comes after the token, from the same input. A failed read is no answer.
      let answer: DeclarationRead;
      try {
        answer = await readDeclaration();
      } catch {
        answer = undefined;
      }
      const body = isDeclaration(answer) ? { token: secret.token, declared_read_only: true } : { token: secret.token };
      return change(
        "/connectors/github/token",
        body,
        client,
        out,
        (c) =>
          `studio: GitHub connected as ${text(c.account_login)}: ${reposOf(c).length} reachable repos; expires ${text(c.expires_at)}` +
          `${c.permissions_source === "declared" ? "; permissions read-only as declared by you (GitHub did not report them)" : ""}\n`,
        "token not stored",
      );
    },
  };
}
