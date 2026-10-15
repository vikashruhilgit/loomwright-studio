// `studio ask "<text>" [--json] [--timeout <s>]`: send Wright a message and
// print the reply, over the routes in `routes.ts`. It POSTs the text, then
// polls `GET /messages/:id` until the message is answered or the wait ends.
//
// Exit codes:
//   0  replied: the reply on stdout
//   1  failed (the reason on stderr), or the kernel API answered unexpectedly
//   2  refused, nothing queued (model_unset, kill_switch_engaged,
//      settings_invalid), or parked by admission (the reason and retry time),
//      or a usage error
//   3  no answer within --timeout (default 120 s): prints the session id, if
//      one started, and "follow up with `studio status`". The session keeps
//      running: the CLI never stops it (invariant 2).
//
// Text from the store (a reply, a reason) is data, never terminal control: in
// the plain output (`terminalText`), control characters other than newline
// and tab, and bidi overrides, are printed escaped (`\u001b`). `--json`
// prints the last message row as standard `JSON.stringify` output on stdout,
// like every `--json` in the CLI (the exit code is the same): it escapes
// only what JSON requires (U+0000 to U+001F, `"` and `\`; and lone
// surrogates), so DEL, a C1 control or a bidi override (U+009B, U+202E) in a
// reply is left raw for the reader to handle. This module never imports
// `../cli/index.js` (that one imports the feature registry, which imports this).
import type { CliApiClient, CliSubcommandOutput, ContributedSubcommand } from "../features/contribution.js";
import { askTextProblem } from "./routes.js";

export const ASK_SUBCOMMAND = "ask";
export const ASK_HELP = 'studio ask "<text>" [--json] [--timeout <s>]';

/** How long `studio ask` waits for the reply, in seconds, without `--timeout`. */
export const DEFAULT_ASK_TIMEOUT_S = 120;
/** `--timeout` above this is refused (one day). */
export const MAX_ASK_TIMEOUT_S = 86_400;
/** The wait between two polls of the message row. */
export const ASK_POLL_MS = 500;

export interface AskSubcommandDeps {
  /** Milliseconds; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Defaults to `ASK_POLL_MS`. */
  readonly pollMs?: number;
}

interface AskCommand {
  readonly text: string;
  readonly json: boolean;
  readonly timeoutS: number;
}

function parse(args: readonly string[]): AskCommand | undefined {
  let text: string | undefined;
  let json = false;
  let timeoutS: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--json") {
      if (json) return undefined;
      json = true;
    } else if (a === "--timeout") {
      const v = args[++i];
      if (timeoutS !== undefined || v === undefined || !/^\d+(\.\d+)?$/.test(v)) return undefined;
      timeoutS = Number(v);
      if (!(timeoutS > 0) || timeoutS > MAX_ASK_TIMEOUT_S) return undefined;
    } else if (a.startsWith("--") || text !== undefined) {
      return undefined;
    } else {
      text = a;
    }
  }
  return text === undefined ? undefined : { text, json, timeoutS: timeoutS ?? DEFAULT_ASK_TIMEOUT_S };
}

/**
 * Text from the store, safe for a terminal: C0 controls other than newline
 * and tab, DEL, C1 controls and bidi overrides printed as `\uXXXX`.
 */
export function terminalText(value: unknown): string {
  return String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Text from the store on one line: `terminalText`, with newlines and tabs escaped too. */
function oneLine(value: unknown): string {
  return terminalText(value).replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
}

function errorOf(body: unknown): string {
  const error = field(body, "error");
  return typeof error === "string" && /^[a-z_]{1,64}$/.test(error) ? error : "unknown";
}

function positiveId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** The POST refusals: one line, exit 2 (nothing was queued); anything else, exit 1. */
function refused(res: { status: number; body: unknown }, out: CliSubcommandOutput): number {
  const error = errorOf(res.body);
  if (res.status === 409 && error === "model_unset") {
    out.stderr.write(`studio: Wright has no model: set "${oneLine(field(res.body, "field") ?? "model")}" in ${oneLine(field(res.body, "file"))}; nothing was queued\n`);
    return 2;
  }
  if (res.status === 409 && error === "kill_switch_engaged") {
    out.stderr.write("studio: the kill switch is engaged (studio resume releases it); nothing was queued\n");
    return 2;
  }
  if (res.status === 409 && error === "settings_invalid") {
    out.stderr.write(`studio: Wright's settings file is invalid: ${oneLine(field(res.body, "message"))}; nothing was queued\n`);
    return 2;
  }
  if (res.status === 400 || res.status === 409) {
    out.stderr.write(`studio: ask refused: ${error}\n`);
    return 1;
  }
  out.stderr.write(`studio: kernel API answered ${res.status} to POST /ask\n`);
  return 1;
}

/** The `studio ask` subcommand. `deps` replace the clock and the wait (tests); the shipped contribution uses the defaults. */
export function askSubcommand(deps: AskSubcommandDeps = {}): ContributedSubcommand {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = deps.pollMs ?? ASK_POLL_MS;

  async function run(c: AskCommand, client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
    const posted = await client.request("POST", "/ask", { text: c.text });
    if (posted.status !== 202) return refused(posted, out);
    const id = positiveId(field(posted.body, "message_id"));
    if (id === undefined) {
      out.stderr.write("studio: kernel API sent an unreadable answer to POST /ask\n");
      return 1;
    }
    const path = `/messages/${id}`;
    const started = now();
    const deadline = started + c.timeoutS * 1_000;
    for (;;) {
      const res = await client.request("GET", path);
      const status = field(res.body, "status");
      if (res.status !== 200 || typeof status !== "string") {
        out.stderr.write(res.status === 200 ? `studio: kernel API sent an unreadable answer to GET ${path}\n` : `studio: kernel API answered ${res.status} to GET ${path}\n`);
        return 1;
      }
      const json = (): void => void out.stdout.write(`${JSON.stringify(res.body, null, 2)}\n`);
      if (status === "replied") {
        if (c.json) json();
        else out.stdout.write(`${terminalText(field(res.body, "reply_text") ?? "")}\n`);
        return 0;
      }
      if (status === "failed" || status === "parked") {
        if (c.json) json();
        const detail = oneLine(field(res.body, "detail") ?? "no reason recorded");
        out.stderr.write(
          status === "failed"
            ? `studio: Wright could not answer message ${id}: ${detail}\n`
            : `studio: message ${id} is parked: ${detail}; it stays queued and runs when admission allows\n`,
        );
        return status === "failed" ? 1 : 2;
      }
      const left = deadline - now();
      if (left <= 0) {
        if (c.json) json();
        const session = positiveId(field(res.body, "session_id"));
        const where = session === undefined ? `message ${id} is still queued` : `Wright's session ${session} is still running`;
        out.stderr.write(`studio: no reply within ${c.timeoutS} s; ${where}: follow up with studio status\n`);
        return 3;
      }
      await sleep(Math.min(pollMs, left));
    }
  }

  return {
    name: ASK_SUBCOMMAND,
    help: ASK_HELP,
    async run(args, client, out) {
      const c = parse(args);
      if (c === undefined) {
        out.stderr.write(`usage: ${ASK_HELP}\n`);
        return 2;
      }
      const problem = askTextProblem(c.text);
      if (problem !== undefined) {
        out.stderr.write(`studio: ${problem}\nusage: ${ASK_HELP}\n`);
        return 2;
      }
      return run(c, client, out);
    },
  };
}
