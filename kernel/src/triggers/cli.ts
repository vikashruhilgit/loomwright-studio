// `studio triggers`: the owner's list of every trigger and its on/off switch,
// over the routes in `routes.ts`.
//
//   studio triggers [--all] [--json]   enabled triggers (--all: disabled too), or the raw JSON
//   studio triggers on <id> [--yes]    turn one on; a past-due `once` fires now, so this asks first
//   studio triggers off <id>           turn one off (an agent cannot turn it back on)
//
// Times are shown in the owner's local zone. Text an agent stored is data,
// never terminal control: it is printed JSON-quoted with control characters
// replaced.
//
// Turning on a past-due `once` mirrors `studio session abandon`: it asks on a
// terminal (`y`/`yes` proceeds; anything else, or stdin ending, is a no) and
// with no terminal and no `--yes` it refuses (exit 2) instead of waiting.
// The kernel decides what is past due: the first request carries no
// confirmation and changes nothing when it needs one. This module never
// imports `../cli/index.js` (that one imports the feature registry, which
// imports this).
import { createInterface } from "node:readline";
import type { CliApiClient, CliSubcommandOutput, ContributedSubcommand } from "../features/contribution.js";
import { formatZoned } from "./cron.js";

export const TRIGGERS_SUBCOMMAND = "triggers";
export const TRIGGERS_HELP = "studio triggers [--all] [--json] | studio triggers on|off <id> [--yes]";

export interface TriggersSubcommandDeps {
  /** Whether a person can answer the confirmation. Defaults to `process.stdin.isTTY === true`. */
  readonly isInteractive?: () => boolean;
  /** Ask, `true` to proceed. Defaults to a `node:readline` prompt on stdin/stderr (`y`/`yes`; EOF or an input error is a no). */
  readonly confirm?: (question: string) => Promise<boolean>;
  /** The zone times are shown in. Defaults to the host's local zone. */
  readonly timeZone?: string;
}

function defaultConfirm(question: string): Promise<boolean> {
  const input = process.stdin;
  if (input.readableEnded || input.destroyed) return Promise.resolve(false);
  const rl = createInterface({ input, output: process.stderr });
  return new Promise((resolve) => {
    // The first resolve wins: an answered question closes `rl` after resolving.
    rl.once("close", () => resolve(false));
    rl.once("error", () => {
      resolve(false);
      rl.close();
    });
    rl.question(question, (answer) => {
      const a = answer.trim().toLowerCase();
      resolve(a === "y" || a === "yes");
      rl.close();
    });
  });
}

type Command =
  | { readonly kind: "list"; readonly all: boolean; readonly json: boolean }
  | { readonly kind: "on"; readonly id: number; readonly yes: boolean }
  | { readonly kind: "off"; readonly id: number };

function parseId(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return undefined;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : undefined;
}

function parse(args: readonly string[]): Command | undefined {
  const [first, second, ...rest] = args;
  if (first === "on" || first === "off") {
    const id = parseId(second);
    if (id === undefined) return undefined;
    if (first === "off") return rest.length === 0 ? { kind: "off", id } : undefined;
    if (rest.length === 0) return { kind: "on", id, yes: false };
    return rest.length === 1 && rest[0] === "--yes" ? { kind: "on", id, yes: true } : undefined;
  }
  const flags = new Set(args);
  if (flags.size !== args.length || ![...flags].every((f) => f === "--all" || f === "--json")) return undefined;
  return { kind: "list", all: flags.has("--all"), json: flags.has("--json") };
}

/** Text from the store as one safe terminal token: JSON-quoted, C0/C1 controls and bidi overrides replaced. */
function quoted(value: unknown): string {
  return JSON.stringify(String(value)).replace(/[\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "?");
}

/** A name or code from the store, printed bare unless it needs quoting. */
function bare(value: unknown): string {
  const s = String(value ?? "-");
  return /^[\w.:@/+-]{1,200}$/.test(s) ? s : quoted(s);
}

interface TriggerLike {
  readonly id?: unknown;
  readonly owning_agent?: unknown;
  readonly kind?: unknown;
  readonly spec?: unknown;
  readonly action?: unknown;
  readonly text?: unknown;
  readonly enabled?: unknown;
  readonly enabled_changed_by?: unknown;
  readonly enabled_changed_at?: unknown;
  readonly next_fire_at?: unknown;
  readonly last_fired_at?: unknown;
  readonly last_result?: unknown;
  readonly created_by?: unknown;
  readonly created_at?: unknown;
}

function specText(t: TriggerLike): string {
  const spec = (typeof t.spec === "object" && t.spec !== null ? t.spec : {}) as { at?: unknown; cron?: unknown; tz?: unknown };
  if (t.kind === "once") return `once at ${bare(spec.at)}`;
  if (t.kind === "cron") return `cron ${quoted(spec.cron)} in ${bare(spec.tz)}`;
  return `${bare(t.kind)} ${quoted(JSON.stringify(t.spec ?? null))}`;
}

/** The trigger list, one block per trigger, times in zone `tz`. */
export function formatTriggers(triggers: readonly TriggerLike[], tz: string, all: boolean): string {
  if (triggers.length === 0) return all ? "no triggers\n" : "no enabled triggers (studio triggers --all lists disabled ones too)\n";
  const time = (value: unknown): string => {
    if (typeof value !== "string") return "-";
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? formatZoned(ms, tz) : quoted(value);
  };
  const lines: string[] = [];
  for (const t of triggers) {
    const toggled = t.enabled_changed_by == null ? "never toggled" : `last toggled by ${bare(t.enabled_changed_by)} at ${time(t.enabled_changed_at)}`;
    lines.push(`#${bare(t.id)} ${bare(t.owning_agent)}: ${specText(t)}, ${bare(t.action)} ${quoted(t.text)}`);
    lines.push(`  ${t.enabled === true ? "on" : "off"}; next fire ${time(t.next_fire_at)}; last fired ${time(t.last_fired_at)} (${t.last_result == null ? "-" : bare(t.last_result)})`);
    lines.push(`  created by ${bare(t.created_by)} at ${time(t.created_at)}; ${toggled}`);
  }
  return `${lines.join("\n")}\n`;
}

function errorOf(body: unknown): string {
  const error = (typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined) ?? "unknown";
  return typeof error === "string" && /^[a-z_]{1,64}$/.test(error) ? error : "unknown";
}

/**
 * The `studio triggers` subcommand. `deps` replace the terminal checks and
 * the owner's time zone (tests build it with fakes; the shipped contribution
 * uses the defaults).
 */
export function triggersSubcommand(deps: TriggersSubcommandDeps = {}): ContributedSubcommand {
  const isInteractive = deps.isInteractive ?? (() => process.stdin.isTTY === true);
  const confirm = deps.confirm ?? defaultConfirm;
  const zone = (): string => deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function list(c: Extract<Command, { kind: "list" }>, client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
    const path = c.all ? "/triggers?all=1" : "/triggers";
    const res = await client.request("GET", path);
    const triggers = (res.body as { triggers?: unknown } | undefined)?.triggers;
    if (res.status !== 200) {
      out.stderr.write(`studio: kernel API answered ${res.status} to GET ${path}\n`);
      return 1;
    }
    if (!Array.isArray(triggers)) {
      out.stderr.write(`studio: kernel API sent an unreadable answer to GET ${path}\n`);
      return 1;
    }
    out.stdout.write(c.json ? `${JSON.stringify(res.body, null, 2)}\n` : formatTriggers(triggers as TriggerLike[], zone(), c.all));
    return 0;
  }

  /** The answer to a toggle, as one line on stdout (0) or stderr (1). */
  function report(id: number, enabled: boolean, path: string, res: { status: number; body: unknown }, out: CliSubcommandOutput): number {
    if (res.status === 200) {
      const { trigger, changed } = (res.body ?? {}) as { trigger?: TriggerLike; changed?: unknown };
      const state = enabled ? "on" : "off";
      const next = enabled && typeof trigger?.next_fire_at === "string" ? `; next fire ${formatZoned(Date.parse(trigger.next_fire_at), zone())}` : "";
      out.stdout.write(`studio: trigger ${id} ${changed === false ? `was already ${state}` : `turned ${state}`}${next}\n`);
      return 0;
    }
    if (res.status === 404) out.stderr.write(`studio: no trigger ${id}\n`);
    else if (res.status === 400 || res.status === 409) out.stderr.write(`studio: trigger ${id} not turned ${enabled ? "on" : "off"}: ${errorOf(res.body)}\n`);
    else out.stderr.write(`studio: kernel API answered ${res.status} to POST ${path}\n`);
    return 1;
  }

  async function on(c: Extract<Command, { kind: "on" }>, client: CliApiClient, out: CliSubcommandOutput): Promise<number> {
    const path = `/triggers/${c.id}/on`;
    let res = await client.request("POST", path, c.yes ? { confirm: true } : {});
    if (res.status === 409 && errorOf(res.body) === "needs_confirmation") {
      if (!isInteractive()) {
        // Nobody can answer the question: refuse rather than wait for stdin.
        out.stderr.write(`studio: trigger ${c.id} is past due and would fire now: confirm on a terminal, or pass --yes\nusage: ${TRIGGERS_HELP}\n`);
        return 2;
      }
      const question = `Trigger ${c.id}'s time has passed: turning it on fires it now. Turn it on? [y/N] `;
      if (!(await confirm(question))) {
        out.stderr.write(`studio: trigger ${c.id} not turned on (not confirmed)\n`);
        return 1;
      }
      res = await client.request("POST", path, { confirm: true });
    }
    return report(c.id, true, path, res, out);
  }

  return {
    name: TRIGGERS_SUBCOMMAND,
    help: TRIGGERS_HELP,
    async run(args, client, out) {
      const c = parse(args);
      if (c === undefined) {
        out.stderr.write(`usage: ${TRIGGERS_HELP}\n`);
        return 2;
      }
      if (c.kind === "list") return list(c, client, out);
      if (c.kind === "on") return on(c, client, out);
      const path = `/triggers/${c.id}/off`;
      return report(c.id, false, path, await client.request("POST", path), out);
    },
  };
}
