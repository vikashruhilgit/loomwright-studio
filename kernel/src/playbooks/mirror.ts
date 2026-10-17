// The read-only markdown mirror of a playbook (invariant 8: memory is
// inspectable files): `<dataDir>/memory/playbooks/<slug>.md`, rendered from
// the `playbooks` row, rewritten after every change and resynced from the
// rows after a restart (`./drafts.ts`). The row is the truth: the kernel never
// reads this file back, so an edit here changes nothing.
//
// Inert rendering (invariant 3): every stored string (name, intent, model,
// the trigger's spec, each policy value) is data. A one-line value is a
// CommonMark code span whose backtick fence is one longer than its longest
// backtick run, so no markdown in it is live; the multi-line intent is a
// fenced code block whose fence is longer than any backtick run inside it.
// Control characters (except the intent's line breaks and tabs) and bidi
// overrides are shown as `?`, so a `cat` of the file cannot drive the
// owner's terminal.
//
// The `studio` CLI loads this module (through `./drafts.ts`): it imports only
// `node:` builtins, `../tools/handoff.js` (itself `node:` builtins only) and
// the triggers feature's public index.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../tools/handoff.js";
import { formatZoned } from "../triggers/index.js";
import type { TriggerView } from "../triggers/index.js";
import type { PlaybookRow } from "./store.js";

/** A playbook slug: one path segment, no separator, no leading dot or dash, so no traversal. */
export const PLAYBOOK_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** What the mirror shows of a playbook's linked trigger (a `TriggerView`, or the same fields from the API). */
export type MirrorTrigger = Pick<TriggerView, "id" | "kind" | "spec" | "next_fire_at">;

export class PlaybookMirrorPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaybookMirrorPathError";
  }
}

/** `memory/playbooks/<slug>.md`: the mirror's path relative to the data dir. Throws for a slug that is not `PLAYBOOK_SLUG_PATTERN`. */
export function mirrorRelativePath(slug: string): string {
  if (typeof slug !== "string" || !PLAYBOOK_SLUG_PATTERN.test(slug)) {
    throw new PlaybookMirrorPathError(`playbook slug ${JSON.stringify(slug)} cannot be used as a file name`);
  }
  return `memory/playbooks/${slug}.md`;
}

/** `<dataDir>/memory/playbooks/<slug>.md`. Throws `PlaybookMirrorPathError` for a slug that could escape the directory. */
export function mirrorPath(dataDir: string, slug: string): string {
  mirrorRelativePath(slug);
  return join(dataDir, "memory", "playbooks", `${slug}.md`);
}

/** C0/C1 controls and bidi overrides: never written as themselves. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** One line of stored text, safe to show: line breaks and tabs become spaces, other controls `?`. */
function oneLine(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(UNSAFE, "?");
}

/** Multi-line stored text, safe to show: CRLF becomes LF, tabs stay, other controls `?`. */
function lines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(UNSAFE, (c) => (c === "\n" || c === "\t" ? c : "?"));
}

/** The longest run of consecutive backticks in `text` (0 when there is none). */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * `text` as a CommonMark code span (the `codeSpan` rule of
 * `../loomwright/version-note.ts`, copied: that module pulls notifications).
 * The fence is one backtick longer than the longest run inside; one space pads
 * each side when it holds a backtick or starts or ends with a space, since
 * CommonMark strips exactly one space from each side.
 */
function codeSpan(text: string): string {
  const fence = "`".repeat(longestBacktickRun(text) + 1);
  const pad = text.includes("`") || text.startsWith(" ") || text.endsWith(" ") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A stored one-line value as inert inline code. */
function inline(value: unknown): string {
  return codeSpan(oneLine(String(value)));
}

/** Stored multi-line text as an inert fenced code block (the fence longer than any backtick run inside, at least three). */
function fenced(text: string): string {
  const body = lines(text);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
  return `${fence}\n${body}${body.endsWith("\n") ? "" : "\n"}${fence}`;
}

/** A stored instant in zone `timeZone` (`formatZoned`), or inert inline code when it is not one; `none` for null. */
function instant(value: string | null, timeZone: string): string {
  if (value === null) return "none";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? formatZoned(ms, timeZone) : inline(value);
}

function schedule(trigger: MirrorTrigger): string {
  const spec = (typeof trigger.spec === "object" && trigger.spec !== null ? trigger.spec : {}) as { at?: unknown; cron?: unknown; tz?: unknown };
  if (trigger.kind === "once" && typeof spec.at === "string") return `once at ${inline(spec.at)}`;
  if (trigger.kind === "cron" && typeof spec.cron === "string" && typeof spec.tz === "string") return `cron ${inline(spec.cron)} in ${inline(spec.tz)}`;
  return `${inline(trigger.kind)} ${inline(JSON.stringify(trigger.spec ?? null))}`;
}

/** The dedupe key's fields (`dedupe_key_spec`, a JSON array), joined; the raw text when it is not one. */
function dedupeKeyText(spec: string): string {
  try {
    const fields = JSON.parse(spec) as unknown;
    if (Array.isArray(fields) && fields.every((f) => typeof f === "string")) return fields.join(", ");
  } catch {
    // Unreadable: shown as stored.
  }
  return spec;
}

/**
 * What the mirror's last line says about dry runs (phase 3 item 07): the
 * summary of the newest finished dry run of the CURRENT version, or that the
 * playbook has dry runs only of earlier versions (an edit made a new one).
 * Absent: no dry run at all.
 */
export type MirrorDryRun = { readonly summary: string } | { readonly onlyEarlierVersions: true };

/** The mirror's last line. With no dry run it is exactly the line item 02 wrote (`No dry run yet.`). */
function lastDryRunLine(row: PlaybookRow, dryRun: MirrorDryRun | undefined): string {
  if (dryRun === undefined) return "Last dry run: No dry run yet.";
  if ("summary" in dryRun) return `Last dry run: ${inline(dryRun.summary)}`;
  return `Last dry run: No dry run of version ${row.version} yet.`;
}

/** One policy line: the value as inert code, or `not set`; ` (proposed)` when Wright set it. */
function policyLine(label: string, value: string | number | null, setBy: string | null): string {
  return `- ${label}: ${value === null ? "not set" : inline(value)}${setBy === "wright" ? " (proposed)" : ""}`;
}

/**
 * The mirror of `row` (pure): its name, a line saying the file is generated
 * and edits are not read, status, version, intent, the linked trigger and its
 * next fire in `timeZone`, one line per policy field (`(proposed)` when
 * Wright set it), and the last dry run (`dryRun`; its summary is untrusted
 * text, shown as one inert code span).
 */
export function renderPlaybookMirror(row: PlaybookRow, trigger: MirrorTrigger | null, timeZone: string, dryRun?: MirrorDryRun): string {
  const out = [
    `# ${inline(row.name)}`,
    "",
    `This file is generated by the Studio kernel from its \`playbooks\` table (playbook ${row.id}, ${inline(row.slug)}). Edits here are not read: the owner changes a playbook with \`studio playbooks set\` and turns it off with \`studio playbooks off\`.`,
    "",
    `- Status: ${inline(row.status)}`,
    `- Version: ${row.version}`,
    "",
    "## Intent",
    "",
    fenced(row.intent),
    "",
    "## Trigger",
    "",
  ];
  if (trigger === null) out.push("- Schedule: no linked trigger");
  else {
    out.push(`- Schedule: ${schedule(trigger)} (trigger ${trigger.id})`);
    out.push(`- Next fire when this file was written: ${instant(trigger.next_fire_at, timeZone)} (\`studio triggers\` shows the live schedule)`);
  }
  out.push(
    "",
    "## Policy",
    "",
    "A value marked (proposed) was proposed by an agent; the owner can change any value.",
    "",
    policyLine("Dedupe key", row.dedupe_key_spec === null ? null : dedupeKeyText(row.dedupe_key_spec), row.dedupe_key_set_by),
    policyLine("Priority", row.priority, row.priority_set_by),
    policyLine("Model", row.model, row.model_set_by),
    policyLine("Token limit per day", row.token_limit_per_day, row.token_limit_set_by),
    policyLine("Effort", row.effort, row.effort_set_by),
    policyLine("API-key fallback", row.api_key_fallback_json, row.api_key_fallback_set_by),
    "",
    lastDryRunLine(row, dryRun),
    "",
  );
  return out.join("\n");
}

/**
 * Write `row`'s mirror atomically (`writeFileAtomic`: a temp file, then a
 * rename), unless the file already holds exactly these bytes. Returns whether
 * it wrote. Throws `PlaybookMirrorPathError` for a bad slug, or the file
 * system's error.
 */
export function writePlaybookMirror(dataDir: string, row: PlaybookRow, trigger: MirrorTrigger | null, timeZone: string, dryRun?: MirrorDryRun): boolean {
  const path = mirrorPath(dataDir, row.slug);
  const content = renderPlaybookMirror(row, trigger, timeZone, dryRun);
  if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
  writeFileAtomic(path, content);
  return true;
}
