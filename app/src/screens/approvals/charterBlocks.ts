// A held charter's display, read for the charter card's compact view and its
// full details (phase 8 item 18d; docs/DESIGN.md §"Charter card (phase 8 item
// 18a)"). Pure: no React and no markup. Every string here is untrusted kernel
// text, returned raw; the card renders each through `printable` as a React
// text child.
//
// The kernel writes the display (`createDisplay` / `updateDisplay` in
// `kernel/src/agents/charter-tools.ts`) and stores it whole, up to 64,000
// characters. `charterBlocks` splits what follows the plain block
// (`charterDisplayParts`) into the four details blocks, in the kernel's order:
// the kernel tools by job (the job and purpose lines), the enforced lines (the
// field, `enforced:`, `limits:` and `workspaces:` lines), the settings file
// (under `config/agents/<id>.json:`) and `role.md` (under
// `memory/<id>/role.md:`). Every line of the display after the head and the
// readiness block is in exactly one block, so the details hold all of it.
//
// It also reads the compact view's plain words: the never list (each kernel
// category in words; an unknown one shown as its own text), the limits on one
// line, the other tools and Bash prefixes, plus the "what changed" sentence
// between two versions and the `owner/repo` names a workspace lookup may try.
import type { McpCapability, McpConnectionKind, OwnerGrant } from "../../api/contract";
import { count } from "../chat/continuity";
import { CHARTER_JOB_PREFIX, CHARTER_PURPOSE_PREFIX, CHARTER_READINESS_HEADING_PREFIX, charterDisplayParts } from "./subject";
import type { CharterDisplayParts } from "./subject";

/** The raw kernel tool prefix the compact view never shows. */
export const KERNEL_TOOL_PREFIX = "mcp__kernel__";

/** The kernel's flagged workspace line names this (`workspaceItem` in `kernel/src/agents/charter-readiness.ts`). */
export const WORKSPACE_FLAG = "no copy of a repo to work in";

/**
 * The kernel's flagged tracker line names this (`TRACKER_ACCESS_FLAG` in `kernel/src/agents/charter-readiness.ts`, byte for
 * byte): `<name> can't read <tracker> tickets yet: it has no <tracker> access` (or `only part of`). `trackerLine`'s
 * no-access pattern is built from it, so this byte-for-byte pin guards what the card matches (its tick-to-grant row).
 */
export const TRACKER_ACCESS_FLAG = "tickets yet: it has ";

/** The kernel's "tracker not connected" line names this (`TRACKER_NOT_CONNECTED_FLAG`); `trackerLine`'s not-connected pattern is built from it (the card offers Connect). */
export const TRACKER_NOT_CONNECTED_FLAG = "isn't connected on Integrations";

/** The MCP trackers the kernel's tracker lines name, by the label they print (`CONNECTOR_LABELS`). */
const TRACKER_LABELS: Readonly<Record<string, "clickup" | "jira">> = { ClickUp: "clickup", Jira: "jira" };

/** A literal as RegExp source. */
const reEscape = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The two anchored patterns, with the pinned flags spliced in so a pin on a flag is a pin on what is matched. */
const NOT_CONNECTED_LINE = new RegExp(`^duty \\d+: (ClickUp|Jira) ${reEscape(TRACKER_NOT_CONNECTED_FLAG)}, so .+ can't read its tickets yet \\(connect it there first; only you can grant access\\)$`);
const NO_ACCESS_LINE = new RegExp(`^duty \\d+: .+ can't read (ClickUp|Jira) ${reEscape(TRACKER_ACCESS_FLAG)}(?:no \\1 access|only part of the \\1 access to read them) \\(only you can grant it\\)$`);

/** What a readiness line says about a ticket duty's tracker, for the card's fix: which MCP tracker, and whether it lacks access or is not connected. */
export interface TrackerLine {
  readonly kind: "clickup" | "jira";
  readonly state: "no_access" | "not_connected";
}

/**
 * The MCP tracker a flagged readiness line is about, or `undefined` for any other line (GitHub Issues are read through
 * the GitHub connector, so they have no tick-to-grant row). The kernel's text is untrusted: a member's display name
 * sits inside both sentences and could imitate the other one, so each form is anchored to the kernel's whole line shape
 * (`trackerItem` in `kernel/src/agents/charter-readiness.ts`, which always begins `duty <n>: `):
 * - not connected: `duty <n>: <tracker> isn't connected on Integrations, so <name> can't read its tickets yet (connect it
 *   there first; only you can grant access)`. The tracker label comes before the name, so the name cannot move it; tried first.
 * - no access: `duty <n>: <name> can't read <tracker> tickets yet: it has no|only part of the <tracker> access ... (only you
 *   can grant it)`. Anchored at both ends, so the last sentence (the kernel's own) is the one read, and a name cannot add one after it.
 * The two forms end differently, so one line cannot satisfy both. A duty's flagged line (`duty <n> not covered ...`) has no
 * colon after the number, so a duty excerpt that imitates either sentence matches neither.
 */
export function trackerLine(text: string): TrackerLine | undefined {
  const off = NOT_CONNECTED_LINE.exec(text);
  if (off?.[1] !== undefined) return { kind: TRACKER_LABELS[off[1]] as "clickup" | "jira", state: "not_connected" };
  const access = NO_ACCESS_LINE.exec(text);
  if (access?.[1] !== undefined) return { kind: TRACKER_LABELS[access[1]] as "clickup" | "jira", state: "no_access" };
  return undefined;
}

export type CharterBlockKind = "jobs" | "enforced" | "settings" | "role";

/** One details block: its kind, its title in words, the file it is (settings and `role.md`), and its text exactly as the kernel wrote it. */
export interface CharterBlock {
  readonly kind: CharterBlockKind;
  readonly title: string;
  /** The kernel's header line without its colon (`config/agents/<id>.json`), for the two file blocks. */
  readonly path?: string;
  readonly text: string;
}

export const BLOCK_TITLES: Readonly<Record<CharterBlockKind, string>> = Object.freeze({
  jobs: "Kernel tools by job",
  enforced: "Enforced lines",
  settings: "Settings file",
  role: "role.md",
});

/** What the compact view and the details read from a display. */
export interface CharterBlocks {
  /** The whole display's length in characters, as the kernel stored it. */
  readonly total: number;
  readonly blocks: readonly CharterBlock[];
  /** The never list in words; `[]` for the kernel's `none`; `undefined` when the display has no enforced line. */
  readonly never: readonly string[] | undefined;
  /** The limits on one line, in words; `undefined` when the display has no `limits:` line (an update's has none). */
  readonly limits: string | undefined;
  /** The granted tools that are not kernel tools (`Read`, `Bash`, …), as the kernel names them. */
  readonly otherTools: readonly string[];
  /** The Bash prefixes the member may run, unquoted. */
  readonly bashPrefixes: readonly string[];
}

const SETTINGS_HEADER = /^config\/agents\/[^/\s]+\.json:$/;
const ROLE_HEADER = /^memory\/[^/\s]+\/role\.md:$/;

/** The index of the first line after the head and the readiness block. */
function afterReadiness(lines: readonly string[], parts: CharterDisplayParts): number {
  if (parts.readiness === undefined || lines[1]?.startsWith(CHARTER_READINESS_HEADING_PREFIX) !== true) return 1;
  return 2 + parts.readiness.length;
}

/** The first line after the plain block's job lines, read as `charterDisplayParts` reads them (the rest is its `raw`). */
function rawStart(lines: readonly string[], parts: CharterDisplayParts, from: number): number {
  if (parts.note !== undefined) return from + 1;
  let i = from;
  while (i < lines.length && ((lines[i] as string).startsWith(CHARTER_JOB_PREFIX) || (lines[i] as string).startsWith(CHARTER_PURPOSE_PREFIX))) i += 1;
  return i;
}

/**
 * `display` split into its four details blocks (each present only when it has
 * a line), with the plain words the compact view reads. `parts` is
 * `charterDisplayParts(display)`; when it is `undefined` (not the kernel's
 * charter format) every line after the head is one enforced block, so nothing
 * is lost.
 */
export function charterBlocks(display: string, parts: CharterDisplayParts | undefined = charterDisplayParts(display)): CharterBlocks {
  const lines = display.split("\n");
  const blocks: CharterBlock[] = [];
  let raw: readonly string[];
  if (parts === undefined) {
    raw = lines.slice(1);
  } else {
    const jobsFrom = afterReadiness(lines, parts);
    const rawFrom = rawStart(lines, parts, jobsFrom);
    const jobLines = lines.slice(jobsFrom, rawFrom);
    if (jobLines.length > 0) blocks.push({ kind: "jobs", title: BLOCK_TITLES.jobs, text: jobLines.join("\n") });
    raw = lines.slice(rawFrom);
  }
  const settingsAt = raw.findIndex((l) => SETTINGS_HEADER.test(l));
  const roleAt = raw.findIndex((l, i) => i > settingsAt && ROLE_HEADER.test(l));
  const enforcedEnd = settingsAt >= 0 ? settingsAt : roleAt >= 0 ? roleAt : raw.length;
  const enforced = raw.slice(0, enforcedEnd);
  if (enforced.length > 0) blocks.push({ kind: "enforced", title: BLOCK_TITLES.enforced, text: enforced.join("\n") });
  if (settingsAt >= 0) {
    const end = roleAt >= 0 ? roleAt : raw.length;
    blocks.push({ kind: "settings", title: BLOCK_TITLES.settings, path: (raw[settingsAt] as string).slice(0, -1), text: raw.slice(settingsAt + 1, end).join("\n") });
  }
  if (roleAt >= 0) blocks.push({ kind: "role", title: BLOCK_TITLES.role, path: (raw[roleAt] as string).slice(0, -1), text: raw.slice(roleAt + 1).join("\n") });

  const enforcedLine = enforced.find((l) => l.startsWith(ENFORCED_PREFIX));
  const limitsLine = enforced.find((l) => l.startsWith(LIMITS_PREFIX));
  const fields = enforcedLine === undefined ? undefined : enforcedFields(enforcedLine);
  return {
    total: display.length,
    blocks,
    never: fields === undefined ? undefined : fields.never.map(neverWords),
    limits: limitsLine === undefined ? undefined : limitsWords(limitsLine.slice(LIMITS_PREFIX.length)),
    otherTools: fields === undefined ? [] : fields.tools.filter((t) => !t.startsWith(KERNEL_TOOL_PREFIX)),
    bashPrefixes: fields?.prefixes ?? [],
  };
}

// ---- the enforced line ------------------------------------------------------------------

/** Mirrors `enforcedLine` in `kernel/src/agents/charter-tools.ts`: `enforced: never: …; tools: …; bash prefixes: …[; connectors: …]`. */
const ENFORCED_PREFIX = "enforced: never: ";
const TOOLS_SEP = "; tools: ";
const PREFIXES_SEP = "; bash prefixes: ";
const CONNECTORS_SEP = "; connectors: ";
const LIMITS_PREFIX = "limits: ";

function listOf(text: string): string[] {
  return text === "none" || text === "" ? [] : text.split(", ");
}

/** The JSON-quoted Bash prefixes, unquoted; a token that is not a JSON string is kept as its own text. */
function prefixesOf(text: string): string[] {
  if (text === "none" || text === "") return [];
  const out: string[] = [];
  const quoted = /"(?:[^"\\]|\\.)*"/g;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(text)) !== null) {
    try {
      const value: unknown = JSON.parse(match[0]);
      out.push(typeof value === "string" ? value : match[0]);
    } catch {
      out.push(match[0]);
    }
  }
  return out.length === 0 ? [text] : out;
}

function enforcedFields(line: string): { never: string[]; tools: string[]; prefixes: string[] } {
  const rest = line.slice(ENFORCED_PREFIX.length);
  const toolsAt = rest.indexOf(TOOLS_SEP);
  if (toolsAt < 0) return { never: listOf(rest), tools: [], prefixes: [] };
  const never = listOf(rest.slice(0, toolsAt));
  const afterTools = rest.slice(toolsAt + TOOLS_SEP.length);
  const prefixesAt = afterTools.indexOf(PREFIXES_SEP);
  if (prefixesAt < 0) return { never, tools: listOf(afterTools), prefixes: [] };
  const tools = listOf(afterTools.slice(0, prefixesAt));
  const afterPrefixes = afterTools.slice(prefixesAt + PREFIXES_SEP.length);
  const connectorsAt = afterPrefixes.indexOf(CONNECTORS_SEP);
  return { never, tools, prefixes: prefixesOf(connectorsAt < 0 ? afterPrefixes : afterPrefixes.slice(0, connectorsAt)) };
}

/**
 * Each kernel `never` category in words. Keyed by the kernel's
 * `NEVER_CATEGORIES` (`kernel/src/sessions/policy.ts`, mirrored in
 * `app/src/screens/team/model.ts`); `charterBlocks.test.ts` fails if a
 * category has no words here.
 */
export const NEVER_WORDS: Readonly<Record<string, string>> = Object.freeze({
  git_push: "Push to a git remote",
  alias_define: "Define shell aliases",
  gh_pr_create: "Open pull requests",
  gh_pr_comment: "Comment on pull requests",
  gh_pr_review: "Review pull requests",
  gh_pr_edit: "Edit pull requests",
  gh_pr_close: "Close pull requests",
  gh_pr_request_reviewers: "Ask for reviewers on pull requests",
  gh_pr_comment_reply: "Reply to pull request comments",
  gh_issue_create: "Open issues",
  gh_issue_comment: "Comment on issues",
  gh_issue_edit: "Edit issues",
  gh_issue_close: "Close issues",
  gh_api_write: "Write through the GitHub API",
  mcp_write: "Write through MCP tools",
  settings_write: "Change its settings files",
  hooks_write: "Change hooks",
});

/** A `never` category in words; one the app does not know is shown as its own text. */
export function neverWords(category: string): string {
  return Object.hasOwn(NEVER_WORDS, category) ? (NEVER_WORDS[category] as string) : category;
}

// ---- the limits line --------------------------------------------------------------------

/** Mirrors `limitsLine` in `kernel/src/agents/charter-tools.ts`: `<key> <n> (proposed)` or `<key> not set (no limit)`. */
const LIMIT_PART = /^([a-z_]+) (?:([0-9]+) \(proposed\)|not set \(no limit\))$/;

const LIMIT_WORDS: Readonly<Record<string, { readonly set: (n: number) => string; readonly unset: string }>> = Object.freeze({
  tokens_per_day: { set: (n) => `${count(n)} ${n === 1 ? "token" : "tokens"} a day`, unset: "no daily token limit" },
  sessions_at_once: { set: (n) => `${count(n)} ${n === 1 ? "session" : "sessions"} at once`, unset: "no limit on sessions at once" },
  delegation_depth: { set: (n) => `delegates ${count(n)} ${n === 1 ? "level" : "levels"} deep`, unset: "no delegation depth limit" },
});

/** The limits on one line, each in words (`200,000 tokens a day · 1 session at once · …`); a part the app does not know is its own text. */
export function limitsWords(text: string): string {
  return text
    .split("; ")
    .map((part) => {
      const match = LIMIT_PART.exec(part);
      const words = match?.[1] === undefined || !Object.hasOwn(LIMIT_WORDS, match[1]) ? undefined : LIMIT_WORDS[match[1]];
      if (match === null || words === undefined) return part;
      return match[2] === undefined ? words.unset : words.set(Number(match[2]));
    })
    .join(" · ");
}

// ---- what changed between two versions ---------------------------------------------------

function lineOf(display: string, prefix: string): string | undefined {
  return display.split("\n").find((l) => l.startsWith(prefix));
}

function labels(parts: CharterDisplayParts | undefined): string[] {
  return parts === undefined ? [] : parts.jobs.map((j) => j.label);
}

/** The workspaces a display names: its `workspaces:` line, or an update's `workspaces: <old> → <new>` field line. */
function workspacesOf(display: string): string | undefined {
  return lineOf(display, "workspaces: ");
}

/**
 * What a newer version changes, in words, for the older card's "Replaced by"
 * line: the jobs it adds or removes, "workspace set" when its workspaces line
 * changed, "limits changed" when its limits did. Read from the two displays'
 * parts only; never a guess beyond them.
 */
export function whatChanged(older: string, newer: string): string {
  const before = labels(charterDisplayParts(older));
  const after = labels(charterDisplayParts(newer));
  const out: string[] = [];
  const added = after.filter((l) => !before.includes(l));
  const removed = before.filter((l) => !after.includes(l));
  if (added.length > 0) out.push(`adds ${added.join(", ")}`);
  if (removed.length > 0) out.push(`removes ${removed.join(", ")}`);
  if (workspacesOf(older) !== workspacesOf(newer)) out.push("workspace set");
  const limitsBefore = lineOf(older, LIMITS_PREFIX) ?? older.split("\n").filter((l) => l.startsWith("limits.")).join("\n");
  const limitsAfter = lineOf(newer, LIMITS_PREFIX) ?? newer.split("\n").filter((l) => l.startsWith("limits.")).join("\n");
  if (limitsBefore !== limitsAfter) out.push("limits changed");
  return out.length === 0 ? "no change to its jobs, workspace or limits" : out.join("; ");
}

// ---- the repo a workspace lookup may try ------------------------------------------------

/** An `owner/repo` token standing alone (not part of a longer path or URL). */
const REPO_TOKEN = /(?<![\w./:@-])([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})(?![\w/-])/g;

/** At most this many repo names are looked up. */
export const MAX_REPO_CANDIDATES = 3;

/**
 * The `owner/repo` names the display's duty lines (its readiness block) and
 * its `role.md` name, in order, each once, at most `MAX_REPO_CANDIDATES`. Only
 * a lookup query: the kernel validates the format and refuses anything else,
 * and a name that matches no saved workspace finds nothing.
 */
export function repoCandidates(display: string, parts: CharterDisplayParts | undefined = charterDisplayParts(display), blocks?: CharterBlocks): string[] {
  const sources = [...(parts?.readiness ?? []).map((l) => l.text), (blocks ?? charterBlocks(display, parts)).blocks.find((b) => b.kind === "role")?.text ?? ""];
  const out: string[] = [];
  for (const text of sources) {
    for (const match of text.matchAll(REPO_TOKEN)) {
      const repo = (match[1] as string).replace(/[.]+$/, "");
      if (repo.endsWith("/") || out.includes(repo)) continue;
      out.push(repo);
      if (out.length === MAX_REPO_CANDIDATES) return out;
    }
  }
  return out;
}

/**
 * The owner's tracker ticks after one capability is ticked (`on`) or cleared on a held charter card: the kind's tools
 * the owner chose, as the `owner_grant` the approve posts. One MCP kind at a time (the approve body carries one), so a
 * tick for another kind while one holds ticks changes nothing; clearing the last tool answers `undefined` (nothing to
 * grant: the approve posts no `owner_grant`). The order is the order ticked, so the posted list is stable.
 */
export function nextOwnerGrant(current: OwnerGrant | undefined, kind: McpConnectionKind, capability: McpCapability, on: boolean): OwnerGrant | undefined {
  if (current !== undefined && current.kind !== kind) return current;
  const held = current?.tools ?? [];
  const tools = on ? [...held, ...capability.tools.filter((tool) => !held.includes(tool))] : held.filter((tool) => !capability.tools.includes(tool));
  return tools.length === 0 ? undefined : { kind, tools };
}
