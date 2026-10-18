// `studio ask [--agent <id>] [--workspace <path>] "<text>" [--json]
// [--timeout <s>]`: send Wright (or, with `--agent`, a crew member) a message
// and print the reply, over the routes in `routes.ts`. It POSTs the text,
// then polls `GET /messages/:id` until the message is answered or the wait
// ends. `--workspace` names one of the agent's settings workspaces as its
// session's cwd.
//
// Exit codes:
//   0  replied: the reply on stdout
//   1  failed (the reason on stderr), or the kernel API answered unexpectedly
//   2  refused, nothing queued (model_unset, kill_switch_engaged,
//      settings_invalid, settings_missing, no_such_agent, agent_off,
//      workspace_not_listed), or parked by admission (the reason and retry
//      time), or a usage error
//   3  no answer within --timeout (default 120 s): prints the session id, if
//      one started, and "follow up with `studio status`". The session keeps
//      running: the CLI never stops it (invariant 2).
//
// `studio messages [--agent <id>] [--all] [--json]`: the message rows
// (`GET /messages`), newest last, one block per row: its id, agent, status,
// source, depth and `reply_to`, then its text and its reply or reason.
// Exit 0; 1 when the kernel API answers unexpectedly; 2 on bad usage.
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
export const ASK_HELP = 'studio ask [--agent <id>] [--workspace <path>] "<text>" [--json] [--timeout <s>]';

export const MESSAGES_SUBCOMMAND = "messages";
export const MESSAGES_HELP = "studio messages [--agent <id>] [--all] [--json]";

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
  /** Absent: Wright (the POST names no agent). */
  readonly agent?: string;
  readonly workspace?: string;
}

function parse(args: readonly string[]): AskCommand | undefined {
  let text: string | undefined;
  let json = false;
  let timeoutS: number | undefined;
  let agent: string | undefined;
  let workspace: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--json") {
      if (json) return undefined;
      json = true;
    } else if (a === "--agent") {
      const v = args[++i];
      if (agent !== undefined || v === undefined || v === "") return undefined;
      agent = v;
    } else if (a === "--workspace") {
      const v = args[++i];
      if (workspace !== undefined || v === undefined || v === "") return undefined;
      workspace = v;
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
  if (text === undefined) return undefined;
  return { text, json, timeoutS: timeoutS ?? DEFAULT_ASK_TIMEOUT_S, ...(agent === undefined ? {} : { agent }), ...(workspace === undefined ? {} : { workspace }) };
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

/** The agent a message went to, as the CLI names it: `Wright`, or the crew id (escaped). */
function agentName(c: AskCommand): string {
  return c.agent === undefined || c.agent === "wright" ? "Wright" : oneLine(c.agent);
}

/** The POST refusals: one line, exit 2 (nothing was queued); anything else, exit 1. */
function refused(c: AskCommand, res: { status: number; body: unknown }, out: CliSubcommandOutput): number {
  const error = errorOf(res.body);
  const name = agentName(c);
  if (res.status === 409 && error === "model_unset") {
    const [set, file] = [oneLine(field(res.body, "field") ?? "model"), oneLine(field(res.body, "file"))];
    out.stderr.write(
      name === "Wright"
        ? `studio: Wright has no model: set "${set}" in ${file}; nothing was queued\n`
        : `studio: ${name} has no model: set "${set}" in ${file}; nothing was queued\n`,
    );
    return 2;
  }
  if (res.status === 409 && error === "kill_switch_engaged") {
    out.stderr.write("studio: the kill switch is engaged (studio resume releases it); nothing was queued\n");
    return 2;
  }
  if (res.status === 409 && error === "settings_invalid") {
    const why = `${oneLine(field(res.body, "message"))}; nothing was queued`;
    out.stderr.write(name === "Wright" ? `studio: Wright's settings file is invalid: ${why}\n` : `studio: ${name}'s settings file is invalid: ${why}\n`);
    return 2;
  }
  if (res.status === 409 && error === "settings_missing") {
    out.stderr.write(`studio: ${name} has no settings file: ${oneLine(field(res.body, "file"))}; nothing was queued\n`);
    return 2;
  }
  if (res.status === 404 && error === "no_such_agent") {
    out.stderr.write(`studio: no agent ${name} (neither wright nor a registered crew member); nothing was queued\n`);
    return 2;
  }
  if (res.status === 409 && error === "agent_off") {
    out.stderr.write(`studio: ${name} is off: it takes no messages; nothing was queued\n`);
    return 2;
  }
  if (res.status === 409 && error === "workspace_not_listed") {
    out.stderr.write(`studio: ${oneLine(c.workspace ?? "")} is not one of ${name}'s settings workspaces; nothing was queued\n`);
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
    const body = { text: c.text, ...(c.agent === undefined ? {} : { agent: c.agent }), ...(c.workspace === undefined ? {} : { workspace: c.workspace }) };
    const posted = await client.request("POST", "/ask", body);
    if (posted.status !== 202) return refused(c, posted, out);
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
            ? `studio: ${agentName(c)} could not answer message ${id}: ${detail}\n`
            : `studio: message ${id} is parked: ${detail}; it stays queued and runs when admission allows\n`,
        );
        return status === "failed" ? 1 : 2;
      }
      const left = deadline - now();
      if (left <= 0) {
        if (c.json) json();
        const session = positiveId(field(res.body, "session_id"));
        const where = session === undefined ? `message ${id} is still queued` : `${agentName(c)}'s session ${session} is still running`;
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

// ---- studio messages ----------------------------------------------------------------

interface MessagesCommand {
  readonly agent?: string;
  readonly all: boolean;
  readonly json: boolean;
}

function parseMessages(args: readonly string[]): MessagesCommand | undefined {
  let agent: string | undefined;
  let all = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--json" && !json) json = true;
    else if (a === "--all" && !all) all = true;
    else if (a === "--agent" && agent === undefined) {
      const v = args[++i];
      if (v === undefined || v === "") return undefined;
      agent = v;
    } else return undefined;
  }
  return { ...(agent === undefined ? {} : { agent }), all, json };
}

/** One row as a block: `#<id> <agent> <status> from <source> depth <n>[ reply_to #<id>]`, then its text and its reply or reason, every stored value escaped. */
function formatMessage(m: Record<string, unknown>): string {
  const replyTo = positiveId(m.reply_to);
  const lines = [
    `#${oneLine(m.id)} ${oneLine(m.agent)} ${oneLine(m.status)} from ${oneLine(m.source)} depth ${oneLine(m.depth)}${replyTo === undefined ? "" : ` reply_to #${replyTo}`}`,
    `  text: ${oneLine(m.text)}`,
  ];
  if (m.reply_text !== null && m.reply_text !== undefined) lines.push(`  reply: ${oneLine(m.reply_text)}`);
  if (m.detail !== null && m.detail !== undefined) lines.push(`  detail: ${oneLine(m.detail)}`);
  return `${lines.join("\n")}\n`;
}

/** The `studio messages` subcommand. */
export function messagesSubcommand(): ContributedSubcommand {
  return {
    name: MESSAGES_SUBCOMMAND,
    help: MESSAGES_HELP,
    async run(args, client, out) {
      const c = parseMessages(args);
      if (c === undefined) {
        out.stderr.write(`usage: ${MESSAGES_HELP}\n`);
        return 2;
      }
      const query = [...(c.agent === undefined ? [] : [`agent=${encodeURIComponent(c.agent)}`]), ...(c.all ? ["all=1"] : [])];
      const path = query.length === 0 ? "/messages" : `/messages?${query.join("&")}`;
      const res = await client.request("GET", path);
      const list = field(res.body, "messages");
      if (res.status !== 200) {
        out.stderr.write(`studio: kernel API answered ${res.status} to GET ${path}\n`);
        return 1;
      }
      if (!Array.isArray(list) || !list.every((m) => typeof m === "object" && m !== null)) {
        out.stderr.write(`studio: kernel API sent an unreadable answer to GET ${path}\n`);
        return 1;
      }
      if (c.json) out.stdout.write(`${JSON.stringify(res.body, null, 2)}\n`);
      else out.stdout.write(list.length === 0 ? "no messages\n" : (list as Record<string, unknown>[]).map(formatMessage).join(""));
      return 0;
    },
  };
}
