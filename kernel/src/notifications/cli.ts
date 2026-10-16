// `studio notifications`: the CLI list and detail view (a contributed
// subcommand), over `GET /notifications` and `GET /notifications/:id`.
//
//   studio notifications [--limit N] [--json]   newest first: id, time, source,
//                                               title, delivery status, deep link
//   studio notifications show <id>              the full record, plus the
//                                               trigger or session it came from
//
// Notification text is untrusted (invariant 3): it is printed as plain text
// with every control character, bidi control and line or paragraph separator
// escaped, so a title or body can never move the cursor, recolour the
// terminal, reorder what it shows or fake a line of output. `--json` prints
// the API's JSON as `JSON.stringify` writes it, which leaves the C1
// characters, the bidi controls and U+2028/U+2029 raw.
import type { CliApiClient, CliSubcommandOutput, ContributedSubcommand } from "../features/contribution.js";
import type { NotificationRow } from "./record.js";
import type { NotificationDetail } from "./routes.js";
import { MAX_NOTIFICATION_LIST } from "./routes.js";

export const NOTIFICATIONS_HELP = "studio notifications [--limit N] [--json] | studio notifications show <id>";

const POSITIVE_INT = /^[1-9][0-9]{0,15}$/;

type Parsed = { readonly kind: "list"; readonly limit?: number; readonly json: boolean } | { readonly kind: "show"; readonly id: number };

function parse(args: readonly string[]): Parsed | undefined {
  if (args[0] === "show") {
    const raw = args[1];
    if (args.length !== 2 || raw === undefined || !POSITIVE_INT.test(raw) || !Number.isSafeInteger(Number(raw))) return undefined;
    return { kind: "show", id: Number(raw) };
  }
  let limit: number | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json" && !json) json = true;
    else if (arg === "--limit" && limit === undefined) {
      const raw = args[++i];
      if (raw === undefined || !POSITIVE_INT.test(raw) || Number(raw) > MAX_NOTIFICATION_LIST) return undefined;
      limit = Number(raw);
    } else return undefined;
  }
  return { kind: "list", json, ...(limit === undefined ? {} : { limit }) };
}

// The bidi controls (U+202A-U+202E, U+2066-U+2069, U+061C, U+200E, U+200F),
// which reorder what a terminal shows, and the line and paragraph separators
// (U+2028, U+2029), which some terminals and editors break a line on.
const BIDI_AND_SEPARATORS = /[\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * `text` with every C0/C1 control character (and DEL) written as `\xNN`, and
 * every bidi control and U+2028/U+2029 as `\uNNNN` (lower-case hex), so it
 * prints as plain text. With `keepNewlines`, `\n` stays a line break
 * (indented by `indent`); otherwise it is written `\n` too.
 */
export function printable(text: string, keepNewlines = false, indent = ""): string {
  const escaped = text
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (c) => {
      if (c === "\n" && keepNewlines) return `\n${indent}`;
      if (c === "\n") return "\\n";
      return `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
    })
    .replace(BIDI_AND_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return escaped;
}

function listLine(n: NotificationRow): string {
  return `#${n.id}  ${n.created_at}  ${printable(n.source)}  ${n.delivery_status}  ${printable(n.title)}  ${n.deep_link}`;
}

/** `studio notifications show`'s text. */
export function formatNotification(detail: NotificationDetail): string {
  const n = detail.notification;
  const lines = [
    `notification #${n.id}`,
    `  created:   ${n.created_at}`,
    `  source:    ${printable(n.source)}`,
    `  delivery:  ${n.delivery_status}${n.delivery_detail === null ? "" : ` (${printable(n.delivery_detail)})`}`,
    `  delivered: ${n.delivered_at ?? "-"}`,
    `  deep link: ${n.deep_link}`,
    `  title:     ${printable(n.title)}`,
    "  body:",
    `    ${printable(n.body, true, "    ")}`,
  ];
  if (detail.trigger !== undefined) {
    const t = detail.trigger;
    lines.push(
      t === null
        ? `  trigger:   ${printable(n.source.slice("trigger:".length))} (no longer exists)`
        : `  trigger:   #${t.id}, action ${printable(t.action)}, next fire ${t.next_fire_at ?? "none"}`,
    );
  }
  if (detail.session !== undefined) {
    const s = detail.session;
    lines.push(s === null ? "  session:   unknown" : `  session:   #${s.id}, status ${s.status === null ? "unknown (no such row)" : printable(s.status)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function run(args: readonly string[], client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
  const command = parse(args);
  if (command === undefined) {
    out.stderr.write(`usage: ${NOTIFICATIONS_HELP}\n`);
    return 2;
  }
  const path = command.kind === "show" ? `/notifications/${command.id}` : `/notifications${command.limit === undefined ? "" : `?limit=${command.limit}`}`;
  const answer = await client.request("GET", path);
  if (command.kind === "show" && answer.status === 404) {
    out.stderr.write(`studio: no such notification ${command.id}\n`);
    return 1;
  }
  if (answer.status !== 200 || typeof answer.body !== "object" || answer.body === null) {
    out.stderr.write(`studio: kernel API answered ${answer.status} to GET ${path}\n`);
    return 1;
  }
  if (command.kind === "show") {
    out.stdout.write(formatNotification(answer.body as NotificationDetail));
    return 0;
  }
  const list = (answer.body as { notifications?: unknown }).notifications;
  if (!Array.isArray(list)) {
    out.stderr.write(`studio: kernel API sent an unreadable answer to GET ${path}\n`);
    return 1;
  }
  if (command.json) out.stdout.write(`${JSON.stringify(answer.body, null, 2)}\n`);
  else out.stdout.write(list.length === 0 ? "no notifications\n" : `${(list as NotificationRow[]).map(listLine).join("\n")}\n`);
  return 0;
}

export const notificationsSubcommand: ContributedSubcommand = { name: "notifications", help: NOTIFICATIONS_HELP, run };
