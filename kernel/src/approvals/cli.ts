// The owner's approval subcommands, over the routes in `routes.ts`:
//
//   studio approvals [--all] [--json]   pending first (id, agent, session, time,
//                                       action, the exact payload); --all adds
//                                       decided ones; --json prints the API's JSON
//   studio approve <id> once|always     approve once (`always` is refused: phase 3)
//   studio deny <id>
//
// Approval text and payloads are untrusted (invariant 3): the payload is
// pretty-printed as JSON data, and every control character (C0, C1, DEL) is
// shown as `\xNN` and every bidi control as `\uNNNN`, so nothing an agent
// stored can move the cursor, recolour the terminal or fake a line of output.
// This module never imports `../cli/index.js` (that one imports the feature
// registry, which imports this).
import type { CliApiClient, CliSubcommandOutput, ContributedSubcommand } from "../features/contribution.js";
import { printable } from "../notifications/cli.js";
import { ALWAYS_REFUSED } from "./store.js";
import type { ApprovalView } from "./store.js";

export const APPROVALS_HELP = "studio approvals [--all] [--json]";
export const APPROVE_HELP = "studio approve <id> once|always";
export const DENY_HELP = "studio deny <id>";

const BIDI = /[‎‏‪-‮⁦-⁩]/g;

/** `text` safe for a terminal: control characters as `\xNN` (`\n` too), bidi controls as `\uNNNN`. */
export function shown(text: string): string {
  return printable(text).replace(BIDI, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * `value` as pretty-printed JSON for a terminal, every line indented by
 * `indent`. JSON's own escapes for control characters (`\u001b`, `\t`, `\r`,
 * `\b`, `\f`) are shown as `\xNN`, and the C1 and DEL characters JSON leaves
 * raw are escaped the same way; `\n` inside a string stays `\n`.
 */
export function payloadText(value: unknown, indent = ""): string {
  const json = JSON.stringify(value, null, 2) ?? "null";
  // Each escape is matched from its backslash, so an escaped backslash (`\\`) is never misread as the start of another.
  const escapes = json.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (whole, e: string) => {
    if (e.length === 5) {
      const code = parseInt(e.slice(1), 16);
      return code < 0x20 ? `\\x${code.toString(16).padStart(2, "0")}` : whole;
    }
    const short: Record<string, string> = { b: "\\x08", f: "\\x0c", r: "\\x0d", t: "\\x09" };
    return short[e] ?? whole;
  });
  return escapes
    .split("\n")
    .map((line) => `${indent}${shown(line)}`)
    .join("\n");
}

function field(value: unknown): string {
  return value === null || value === undefined ? "-" : shown(String(value));
}

/** The approval list: one block per approval. */
export function formatApprovals(approvals: readonly ApprovalView[], all: boolean): string {
  if (approvals.length === 0) return all ? "no approvals\n" : "no pending approvals (studio approvals --all lists decided ones too)\n";
  const blocks = approvals.map((a) => {
    const state = a.decision === null ? field(a.status) : `${field(a.status)} (${field(a.decision)})`;
    const lines = [
      `#${field(a.id)}  ${state}  requested ${field(a.requested_at)}  agent ${field(a.requesting_agent)}  session ${field(a.requesting_session)}`,
      `  action:  ${field(a.action)}`,
    ];
    if (a.decided_at !== null || a.decided_by !== null) lines.push(`  decided: by ${field(a.decided_by)} at ${field(a.decided_at)}`);
    lines.push("  payload:", payloadText(a.payload, "    "));
    return lines.join("\n");
  });
  return `${blocks.join("\n")}\n`;
}

function parseId(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^[1-9]\d{0,15}$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

function errorOf(body: unknown): string {
  const error = (typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined) ?? "unknown";
  return typeof error === "string" && /^[a-z_]{1,64}$/.test(error) ? error : "unknown";
}

async function list(args: readonly string[], client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
  const flags = new Set(args);
  if (flags.size !== args.length || ![...flags].every((f) => f === "--all" || f === "--json")) {
    out.stderr.write(`usage: ${APPROVALS_HELP}\n`);
    return 2;
  }
  const all = flags.has("--all");
  const path = all ? "/approvals?all=1" : "/approvals";
  const res = await client.request("GET", path);
  if (res.status !== 200) {
    out.stderr.write(`studio: kernel API answered ${res.status} to GET ${path}\n`);
    return 1;
  }
  const approvals = (res.body as { approvals?: unknown } | undefined)?.approvals;
  if (!Array.isArray(approvals)) {
    out.stderr.write(`studio: kernel API sent an unreadable answer to GET ${path}\n`);
    return 1;
  }
  out.stdout.write(flags.has("--json") ? `${JSON.stringify(res.body, null, 2)}\n` : formatApprovals(approvals as ApprovalView[], all));
  return 0;
}

/** A decision's answer, as one line on stdout (0) or stderr (1). */
async function decide(id: number, decision: "once" | "always" | "deny", client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
  const approve = decision !== "deny";
  const path = `/approvals/${id}/${approve ? "approve" : "deny"}`;
  const res = await client.request("POST", path, approve ? { decision } : {});
  const verb = approve ? "approved" : "denied";
  if (res.status === 200) {
    const action = (res.body as { approval?: { action?: unknown } } | undefined)?.approval?.action;
    out.stdout.write(`studio: approval ${id} ${verb}${approve ? " once" : ""}: ${field(action)}; the requesting agent gets a message\n`);
    return 0;
  }
  const error = errorOf(res.body);
  if (res.status === 404) out.stderr.write(`studio: no approval ${id}\n`);
  else if (res.status === 409 && error === "always_not_supported") {
    out.stderr.write(`studio: approval ${id} not approved: ${ALWAYS_REFUSED}\n`);
  } else if (res.status === 409 && error === "approval_not_pending") {
    const status = (res.body as { status?: unknown }).status;
    out.stderr.write(`studio: approval ${id} is not pending${typeof status === "string" ? ` (it is ${shown(status)})` : ""}: nothing changed\n`);
  } else if (res.status === 400 || res.status === 409) out.stderr.write(`studio: approval ${id} not ${verb}: ${error}\n`);
  else out.stderr.write(`studio: kernel API answered ${res.status} to POST ${path}\n`);
  return 1;
}

export const approvalsSubcommand: ContributedSubcommand = { name: "approvals", help: APPROVALS_HELP, run: list };

export const approveSubcommand: ContributedSubcommand = {
  name: "approve",
  help: APPROVE_HELP,
  async run(args, client, out) {
    const id = parseId(args[0]);
    const decision = args[1];
    if (args.length !== 2 || id === undefined || (decision !== "once" && decision !== "always")) {
      out.stderr.write(`usage: ${APPROVE_HELP}\n`);
      return 2;
    }
    return decide(id, decision, client, out);
  },
};

export const denySubcommand: ContributedSubcommand = {
  name: "deny",
  help: DENY_HELP,
  async run(args, client, out) {
    const id = parseId(args[0]);
    if (args.length !== 1 || id === undefined) {
      out.stderr.write(`usage: ${DENY_HELP}\n`);
      return 2;
    }
    return decide(id, "deny", client, out);
  },
};
