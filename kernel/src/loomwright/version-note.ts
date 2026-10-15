// The version watcher (D32, with D13's goal): the `loomwright` feature's due
// work. At kernel start, then at most once a minute, it resolves the active
// Loomwright (the user-scope view `/status` uses) and compares its install
// path, plugin version and contract schema version with the latest
// `loomwright_contract_seen` row. The first observation ever is recorded
// silently (a baseline). A new plugin or schema version writes a markdown note
// of what the contract diff shows to
// `<dataDir>/memory/shared/loomwright-updates/<old>-to-<new>.md` (invariant 8)
// and creates one notification (`kernel:loomwright_version`). Breaking signals
// come first in both.
//
// Mechanism only (invariant 1): the note reports, it decides nothing. The
// contract is data (invariant 3): both versions are diffed field by field and
// nothing is spread from the raw JSON (unknown fields are ignored), a plugin
// version is sanitised before it names a file, and nothing a hook does (its
// script, matcher or write paths) reaches the note, which goes into Wright's
// context (the `capabilities.ts` rule).
//
// Crash safety (invariant 2): the note is written before the row and never
// over an existing file. A retry after a crash between the two finds its own
// note by the provenance marker on the note's first line and reuses it. The
// row and the notification commit in one transaction.
//
// Imports only `node:*`, its siblings, `../notifications/record.js` (and,
// through it, `../loop/internal.js`) and type-level kernel modules: never the
// Agent SDK (the `studio` CLI loads `loomwright/index.ts`).
import { randomBytes } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { DueWorkContext, LoomwrightInstallSettings } from "../loop/types.js";
import { MAX_NOTIFICATION_BODY, MAX_NOTIFICATION_TITLE, recordNotification } from "../notifications/record.js";
import type { Store } from "../store/store.js";
import { resolveLoomwrightInstall } from "./active-install.js";
import { CONTRACT_FILE, LoomwrightContractError, parseLoomwrightContract, readLoomwrightContractText } from "./contract.js";
import type { LoomwrightContractErrorReason } from "./contract.js";

/** The highest `contract_schema_version` this kernel was written against. A newer one is a breaking signal, never a refusal (D32). */
export const KNOWN_CONTRACT_SCHEMA_VERSION = 1;

/** The source of every notification the watcher creates. */
export const VERSION_NOTE_SOURCE = "kernel:loomwright_version";

/** The watcher checks at most this often per kernel (the first tick after start always checks). */
export const VERSION_CHECK_INTERVAL_MS = 60_000;

/** Where the notes go, under the data dir. */
export const VERSION_NOTES_DIR = join("memory", "shared", "loomwright-updates");

/** The title of the notification for an active install without a usable contract. */
export const NO_CONTRACT_TITLE = "The active Loomwright has no usable contract";

/** A version in a note's file name is cut to this many characters. */
const MAX_VERSION_COMPONENT = 64;

/** `<old>-to-<new>.md`, then `-2` … up to this suffix; beyond it the check throws. */
const MAX_NOTE_SUFFIX = 1_000;

// ---- The diff --------------------------------------------------------------

/** The contract lists whose entries are keyed by `name`, in the note's order. */
export const CONTRACT_ENTRY_GROUPS = ["agent", "command", "skill", "result_schema"] as const;
export type ContractEntryGroup = (typeof CONTRACT_ENTRY_GROUPS)[number];

const GROUP_FIELD: Readonly<Record<ContractEntryGroup, string>> = {
  agent: "agents",
  command: "commands",
  skill: "skills",
  result_schema: "result_schemas",
};

const GROUP_LABEL: Readonly<Record<ContractEntryGroup, string>> = {
  agent: "Agent",
  command: "Command",
  skill: "Skill",
  result_schema: "Result schema",
};

/** An entry added or removed: its group, name and one-line description (`null` when it has none). */
export interface ContractDiffEntry {
  readonly group: ContractEntryGroup;
  readonly name: string;
  readonly description: string | null;
}

export interface DescriptionChange {
  readonly group: ContractEntryGroup;
  readonly name: string;
  readonly from: string | null;
  readonly to: string | null;
}

export interface ResultSchemaVersionChange {
  readonly name: string;
  readonly from: number | null;
  readonly to: number | null;
}

/** What happened to one hook (identity: event, matcher and script). */
export const HOOK_CHANGE_KINDS = ["added", "removed", "host_mode_changed", "writes_changed"] as const;
export type HookChangeKind = (typeof HOOK_CHANGE_KINDS)[number];

/** One hook change: its event, kind, host modes and how many write paths came and went. Never its script, matcher or paths. */
export interface HookChange {
  readonly kind: HookChangeKind;
  readonly event: string;
  readonly host_mode_from: string | null;
  readonly host_mode_to: string | null;
  readonly writes_added: number;
  readonly writes_removed: number;
}

export const HOST_SWITCH_FIELDS = ["presence", "env", "state_dir_env", "effect"] as const;
export type HostSwitchField = (typeof HOST_SWITCH_FIELDS)[number];

export interface HostSwitchNames {
  readonly env: string | null;
  readonly state_dir_env: string | null;
}

export interface HostSwitchChange {
  /** `presence` when one side has no host switch; otherwise the fields that differ. */
  readonly fields: readonly HostSwitchField[];
  readonly from: HostSwitchNames | null;
  readonly to: HostSwitchNames | null;
}

/** The breaking signals, in the note's order. */
export const BREAKING_KINDS = ["command_removed", "agent_removed", "host_switch_changed", "schema_above_known"] as const;
export type BreakingKind = (typeof BREAKING_KINDS)[number];

export interface BreakingSignal {
  readonly kind: BreakingKind;
  /** The removed command or agent; `null` for the other kinds. */
  readonly name: string | null;
  readonly description: string | null;
}

export interface ContractVersion {
  readonly plugin_version: string | null;
  readonly contract_schema_version: number | null;
}

/** What changed between two contracts (see `diffLoomwrightContracts`). */
export interface LoomwrightContractDiff {
  readonly from: ContractVersion;
  readonly to: ContractVersion;
  readonly added: readonly ContractDiffEntry[];
  readonly removed: readonly ContractDiffEntry[];
  readonly description_changes: readonly DescriptionChange[];
  readonly result_schema_versions: readonly ResultSchemaVersionChange[];
  readonly hooks: readonly HookChange[];
  readonly host_switch: HostSwitchChange | null;
  readonly contract_schema_version: { readonly from: number | null; readonly to: number | null } | null;
  readonly breaking: readonly BreakingSignal[];
}

type Raw = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collapse text to one line; empty ⇒ `null`. */
function oneLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const line = value.replace(/\s+/g, " ").trim();
  return line === "" ? null : line;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

interface EntryView {
  readonly description: string | null;
  readonly schema_version: number | null;
}

interface HookView {
  readonly event: string;
  readonly host_mode: string | null;
  readonly writes: readonly string[];
}

interface HostSwitchView {
  readonly env: string | null;
  readonly state_dir_env: string | null;
  readonly effect: string | null;
}

/** The fields the diff reads, built field by field. */
interface ContractView {
  readonly version: ContractVersion;
  readonly entries: Readonly<Record<ContractEntryGroup, ReadonlyMap<string, EntryView>>>;
  /** Keyed by identity (event, matcher, script) plus an ordinal for duplicates. */
  readonly hooks: ReadonlyMap<string, HookView>;
  readonly host_switch: HostSwitchView | null;
}

/**
 * A tolerant view of a contract's text: what is missing or mistyped is
 * absent, never an error (text that is not a JSON object is an empty view).
 * An entry needs a non-empty string `name` (the first of two equal names
 * wins); a hook needs a string `event`.
 */
function viewOf(text: string): ContractView {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const raw: Raw = isObject(parsed) ? parsed : {};
  const list = (field: string): readonly unknown[] => {
    const value = raw[field];
    return Array.isArray(value) ? value : [];
  };

  const entries = {} as Record<ContractEntryGroup, Map<string, EntryView>>;
  for (const group of CONTRACT_ENTRY_GROUPS) {
    const map = new Map<string, EntryView>();
    for (const entry of list(GROUP_FIELD[group])) {
      if (!isObject(entry) || typeof entry.name !== "string" || entry.name.trim() === "" || map.has(entry.name)) continue;
      map.set(entry.name, { description: oneLine(entry.description), schema_version: integerOrNull(entry.schema_version) });
    }
    entries[group] = map;
  }

  const hooks = new Map<string, HookView>();
  const ordinals = new Map<string, number>();
  for (const hook of list("hooks")) {
    if (!isObject(hook) || typeof hook.event !== "string") continue;
    const identity = JSON.stringify([hook.event, stringOrNull(hook.matcher), stringOrNull(hook.script)]);
    const ordinal = (ordinals.get(identity) ?? 0) + 1;
    ordinals.set(identity, ordinal);
    const writes = Array.isArray(hook.writes) ? [...new Set(hook.writes.filter((w): w is string => typeof w === "string"))].sort() : [];
    hooks.set(`${identity}#${ordinal}`, { event: hook.event, host_mode: stringOrNull(hook.host_mode), writes });
  }

  const rawSwitch = raw.host_switch;
  const hostSwitch: HostSwitchView | null = isObject(rawSwitch)
    ? { env: stringOrNull(rawSwitch.env), state_dir_env: stringOrNull(rawSwitch.state_dir_env), effect: stringOrNull(rawSwitch.effect) }
    : null;

  return {
    version: { plugin_version: stringOrNull(raw.plugin_version), contract_schema_version: integerOrNull(raw.contract_schema_version) },
    entries,
    hooks,
    host_switch: hostSwitch,
  };
}

function hookChanges(from: ReadonlyMap<string, HookView>, to: ReadonlyMap<string, HookView>): HookChange[] {
  const changes: HookChange[] = [];
  for (const [key, old] of from) {
    const now = to.get(key);
    if (now === undefined) {
      changes.push({ kind: "removed", event: old.event, host_mode_from: old.host_mode, host_mode_to: null, writes_added: 0, writes_removed: old.writes.length });
      continue;
    }
    if (old.host_mode !== now.host_mode) {
      changes.push({ kind: "host_mode_changed", event: old.event, host_mode_from: old.host_mode, host_mode_to: now.host_mode, writes_added: 0, writes_removed: 0 });
    }
    const oldWrites = new Set(old.writes);
    const newWrites = new Set(now.writes);
    const added = now.writes.filter((w) => !oldWrites.has(w)).length;
    const removed = old.writes.filter((w) => !newWrites.has(w)).length;
    if (added > 0 || removed > 0) {
      changes.push({ kind: "writes_changed", event: old.event, host_mode_from: old.host_mode, host_mode_to: now.host_mode, writes_added: added, writes_removed: removed });
    }
  }
  for (const [key, now] of to) {
    if (from.has(key)) continue;
    changes.push({ kind: "added", event: now.event, host_mode_from: null, host_mode_to: now.host_mode, writes_added: now.writes.length, writes_removed: 0 });
  }
  // By event, then by kind; the sort is stable, so contract order holds within a pair.
  return changes.sort((a, b) => (a.event < b.event ? -1 : a.event > b.event ? 1 : HOOK_CHANGE_KINDS.indexOf(a.kind) - HOOK_CHANGE_KINDS.indexOf(b.kind)));
}

function hostSwitchChange(from: HostSwitchView | null, to: HostSwitchView | null): HostSwitchChange | null {
  const names = (s: HostSwitchView | null): HostSwitchNames | null => (s === null ? null : { env: s.env, state_dir_env: s.state_dir_env });
  if (from === null && to === null) return null;
  if (from === null || to === null) return { fields: ["presence"], from: names(from), to: names(to) };
  const fields = (["env", "state_dir_env", "effect"] as const).filter((f) => from[f] !== to[f]);
  return fields.length === 0 ? null : { fields, from: names(from), to: names(to) };
}

/**
 * What changed from the contract text `oldText` to `newText`. Both are read
 * tolerantly and field by field (unknown fields at every level are ignored,
 * so a contract carrying extra fields diffs the same as one without them):
 * agents, commands, skills and result schemas keyed by `name` (added,
 * removed, description changed; a result schema's `schema_version` too);
 * hooks keyed by event, matcher and script, duplicates by ordinal (added,
 * removed, `host_mode` changed, `writes` changed as a set); the host switch
 * (`env`, `state_dir_env`, `effect`, or presence); `contract_schema_version`.
 *
 * Breaking: a removed command or agent, any host-switch change, and a new
 * `contract_schema_version` above `KNOWN_CONTRACT_SCHEMA_VERSION`.
 */
export function diffLoomwrightContracts(oldText: string, newText: string): LoomwrightContractDiff {
  const from = viewOf(oldText);
  const to = viewOf(newText);
  const added: ContractDiffEntry[] = [];
  const removed: ContractDiffEntry[] = [];
  const descriptionChanges: DescriptionChange[] = [];
  const resultSchemaVersions: ResultSchemaVersionChange[] = [];

  for (const group of CONTRACT_ENTRY_GROUPS) {
    const before = from.entries[group];
    const after = to.entries[group];
    for (const [name, entry] of after) if (!before.has(name)) added.push({ group, name, description: entry.description });
    for (const [name, entry] of before) {
      const now = after.get(name);
      if (now === undefined) {
        removed.push({ group, name, description: entry.description });
        continue;
      }
      if (entry.description !== now.description) descriptionChanges.push({ group, name, from: entry.description, to: now.description });
      if (group === "result_schema" && entry.schema_version !== now.schema_version) {
        resultSchemaVersions.push({ name, from: entry.schema_version, to: now.schema_version });
      }
    }
  }

  const hostSwitch = hostSwitchChange(from.host_switch, to.host_switch);
  const schemaFrom = from.version.contract_schema_version;
  const schemaTo = to.version.contract_schema_version;

  const breaking: BreakingSignal[] = [];
  for (const kind of ["command", "agent"] as const) {
    for (const e of removed) if (e.group === kind) breaking.push({ kind: `${kind}_removed`, name: e.name, description: e.description });
  }
  if (hostSwitch !== null) breaking.push({ kind: "host_switch_changed", name: null, description: null });
  if (schemaTo !== null && schemaTo > KNOWN_CONTRACT_SCHEMA_VERSION) breaking.push({ kind: "schema_above_known", name: null, description: null });

  return {
    from: from.version,
    to: to.version,
    added,
    removed,
    description_changes: descriptionChanges,
    result_schema_versions: resultSchemaVersions,
    hooks: hookChanges(from.hooks, to.hooks),
    host_switch: hostSwitch,
    contract_schema_version: schemaFrom === schemaTo ? null : { from: schemaFrom, to: schemaTo },
    breaking,
  };
}

// ---- The note --------------------------------------------------------------

/** What the note says about itself besides the diff. */
export interface VersionNoteMeta {
  /** The note's heading (the notification's title). */
  readonly title: string;
  /** The provenance marker line (`versionNoteMarker`): always the note's first line. */
  readonly marker: string;
  readonly fromInstallPath: string;
  readonly toInstallPath: string;
  /** When the change was seen (ISO). */
  readonly at: string;
}

/** Inline code that a backtick in `text` cannot end early. */
function code(text: string | null): string {
  const t = oneLine(text) ?? "(none)";
  return t.includes("`") ? `\`\` ${t} \`\`` : `\`${t}\``;
}

function described(name: string, description: string | null): string {
  return `${code(name)} — ${description ?? "(no description)"}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function versionLabel(v: ContractVersion): string {
  return `Loomwright ${oneLine(v.plugin_version) ?? "(unknown)"} (contract ${v.contract_schema_version ?? "unknown"})`;
}

function breakingLine(signal: BreakingSignal, diff: LoomwrightContractDiff): string {
  switch (signal.kind) {
    case "command_removed":
      return `- Command removed: ${described(signal.name ?? "", signal.description)}`;
    case "agent_removed":
      return `- Agent removed: ${described(signal.name ?? "", signal.description)}`;
    case "host_switch_changed": {
      const change = diff.host_switch;
      const names = (n: HostSwitchNames | null): string => (n === null ? "none" : `${code(n.env)} / ${code(n.state_dir_env)}`);
      const what = change === null ? "" : ` (${change.fields.join(", ")})`;
      return `- Host switch changed${what}: ${names(change?.from ?? null)} → ${names(change?.to ?? null)}. Sessions use the new contract's switch; a session without one is refused.`;
    }
    case "schema_above_known":
      return (
        `- Contract schema version ${diff.to.contract_schema_version ?? "unknown"} is newer than this kernel knows (${KNOWN_CONTRACT_SCHEMA_VERSION}). ` +
        "The adapter still reads the contract and does not refuse sessions; fields it does not know are ignored."
      );
  }
}

function hookLine(h: HookChange): string {
  const event = code(h.event);
  switch (h.kind) {
    case "added":
      return `- Hook ${event} added: host mode ${code(h.host_mode_to)}, ${plural(h.writes_added, "write path")}`;
    case "removed":
      return `- Hook ${event} removed: host mode ${code(h.host_mode_from)}, ${plural(h.writes_removed, "write path")}`;
    case "host_mode_changed":
      return `- Hook ${event} host mode changed: ${code(h.host_mode_from)} → ${code(h.host_mode_to)}`;
    case "writes_changed":
      return `- Hook ${event} writes changed: ${plural(h.writes_added, "path")} added, ${h.writes_removed} removed`;
  }
}

/** The Changed section's lines: hooks, result-schema versions, the contract schema version (never description changes). */
function changedLines(diff: LoomwrightContractDiff): string[] {
  return [
    ...diff.hooks.map(hookLine),
    ...diff.result_schema_versions.map((s) => `- Result schema ${code(s.name)} schema version: ${s.from ?? "none"} → ${s.to ?? "none"}`),
    ...(diff.contract_schema_version === null
      ? []
      : [`- Contract schema version: ${diff.contract_schema_version.from ?? "unknown"} → ${diff.contract_schema_version.to ?? "unknown"}`]),
  ];
}

function section(heading: string, lines: readonly string[]): string[] {
  return ["", `## ${heading}`, "", ...(lines.length === 0 ? ["- (none)"] : lines)];
}

/**
 * The note's markdown. Its first line is `meta.marker`; then the heading, the
 * two versions, and the sections in this order: Breaking (only when there is
 * a breaking signal), Added, Removed, Changed (hooks, result-schema versions,
 * the contract schema version), Description changes (last). Each entry shows
 * its name and one-line description, or `(no description)`. A hook is shown by
 * its event and change kind with counts of write paths, never its script,
 * matcher or paths.
 */
export function renderVersionNote(diff: LoomwrightContractDiff, meta: VersionNoteMeta): string {
  const lines = [
    meta.marker,
    `# ${oneLine(meta.title) ?? "Loomwright"}`,
    "",
    `- From: ${versionLabel(diff.from)} at ${code(meta.fromInstallPath)}`,
    `- To: ${versionLabel(diff.to)} at ${code(meta.toInstallPath)}`,
    `- Seen: ${meta.at}`,
    "",
    `Built only from the two versions' \`${CONTRACT_FILE}\` contracts.`,
  ];
  if (diff.breaking.length > 0) lines.push(...section("Breaking", diff.breaking.map((b) => breakingLine(b, diff))));
  lines.push(...section("Added", diff.added.map((e) => `- ${GROUP_LABEL[e.group]} ${described(e.name, e.description)}`)));
  lines.push(...section("Removed", diff.removed.map((e) => `- ${GROUP_LABEL[e.group]} ${described(e.name, e.description)}`)));
  lines.push(...section("Changed", changedLines(diff)));
  lines.push(
    ...section(
      "Description changes",
      diff.description_changes.map((d) => `- ${GROUP_LABEL[d.group]} ${code(d.name)}: ${d.from ?? "(no description)"} → ${d.to ?? "(no description)"}`),
    ),
  );
  return `${lines.join("\n")}\n`;
}

/**
 * The counts a notification carries: breaking signals, additions, removals,
 * and the lines of the note's Changed section (hooks, result-schema versions,
 * the contract schema version). Description changes are never counted.
 */
export function versionNoteCounts(diff: LoomwrightContractDiff): {
  readonly breaking: number;
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
} {
  return { breaking: diff.breaking.length, added: diff.added.length, removed: diff.removed.length, changed: changedLines(diff).length };
}

/**
 * The notification body: `[<b> breaking, ]<a> added, <r> removed[, <c> changed]. Note: <path>`.
 * The changed clause appears only when the note's Changed section is non-empty.
 */
export function versionNoteBody(diff: LoomwrightContractDiff, notePath: string): string {
  const counts = versionNoteCounts(diff);
  return clipText(
    `${counts.breaking > 0 ? `${counts.breaking} breaking, ` : ""}${counts.added} added, ${counts.removed} removed` +
      `${counts.changed > 0 ? `, ${counts.changed} changed` : ""}. Note: ${notePath}`,
    MAX_NOTIFICATION_BODY,
  );
}

// ---- The note file ---------------------------------------------------------

/** One observed (install path, plugin version, contract schema version). */
export interface ObservedContract {
  readonly install_path: string;
  readonly plugin_version: string;
  readonly contract_schema_version: number;
}

/**
 * The note's provenance marker: the row it diffs from, and the observed
 * triple (percent-encoded, so it is one line and cannot end the comment).
 */
export function versionNoteMarker(fromRowId: number, to: ObservedContract): string {
  const triple = [encodeURIComponent(to.install_path), encodeURIComponent(to.plugin_version), String(to.contract_schema_version)].join("|");
  return `<!-- loomwright-version-note from:${fromRowId} to:${triple} -->`;
}

/** A version as one file-name component: `[A-Za-z0-9._-]` only (any other character → `_`), no leading `.`, at most 64 characters; empty ⇒ `unknown`. */
export function safeVersionComponent(version: string): string {
  const safe = version.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, MAX_VERSION_COMPONENT);
  return safe === "" ? "unknown" : safe;
}

/** `<dir>/<name>`, resolved; throws when it would not sit directly inside `dir`. */
export function containedNotePath(dir: string, name: string): string {
  const base = resolve(dir);
  const path = resolve(base, name);
  if (dirname(path) !== base) throw new Error(`version note name ${JSON.stringify(name)} leaves ${base}`);
  return path;
}

/**
 * Create `path` with `content` only if nothing is there: a temp file in the
 * same directory, hard-linked to `path` (the link fails when `path` exists),
 * then removed. So `path` is either absent or complete, never torn, and never
 * overwritten. Returns false when `path` already exists.
 */
function createExclusive(path: string, content: string): boolean {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      linkSync(tmp, path);
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === "EEXIST") return false;
      throw err;
    }
    return true;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * Whether the first line of the file at `path` is exactly `marker`. Reads
 * `marker`'s UTF-8 length plus one byte (its newline), however long the
 * marker is: the marker carries the percent-encoded install path and plugin
 * version, which only the contract's size bounds. `false` when the file
 * cannot be read.
 */
function startsWithMarkerLine(path: string, marker: string): boolean {
  const line = firstLineOf(path, Buffer.byteLength(marker, "utf8") + 1);
  return line === marker;
}

/** The first line within the first `maxBytes` bytes of the file at `path`, or `undefined` when it cannot be read. */
function firstLineOf(path: string, maxBytes: number): string | undefined {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(maxBytes);
    let n = 0;
    // A read may return fewer bytes than asked: read until full or end of file.
    while (n < buffer.length) {
      const got = readSync(fd, buffer, n, buffer.length - n, n);
      if (got === 0) break;
      n += got;
    }
    const text = buffer.subarray(0, n).toString("utf8");
    const end = text.indexOf("\n");
    return end === -1 ? text : text.slice(0, end);
  } catch {
    return undefined;
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Nothing to do: the read already has its answer.
    }
  }
}

/**
 * Write the note into `dir` (created, mode 0700) as `<base>.md`, or the first
 * free `<base>-2.md`, `<base>-3.md`, … ; an existing file is never
 * overwritten. A file whose first line is `marker` is this transition's own
 * note from a run that crashed before its row committed: it is reused, and its
 * path returned.
 */
export function writeVersionNote(dir: string, base: string, content: string, marker: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (let n = 1; n <= MAX_NOTE_SUFFIX; n++) {
    const path = containedNotePath(dir, n === 1 ? `${base}.md` : `${base}-${n}.md`);
    if (createExclusive(path, content)) return path;
    if (startsWithMarkerLine(path, marker)) return path;
  }
  throw new Error(`no free version note name for ${base}.md in ${dir} (tried ${MAX_NOTE_SUFFIX})`);
}

// ---- The check -------------------------------------------------------------

const RELEASE = /^(\d{1,15})\.(\d{1,15})\.(\d{1,15})$/;

/** Whether `to` is a lower `MAJOR.MINOR.PATCH` than `from`. A version that is not three numbers is never a downgrade. */
export function isDowngrade(from: string, to: string): boolean {
  const a = RELEASE.exec(from);
  const b = RELEASE.exec(to);
  if (a === null || b === null) return false;
  for (let i = 1; i <= 3; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (x !== y) return y < x;
  }
  return false;
}

function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  // Never end on half a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** What one check did. */
export type VersionCheckOutcome =
  /** The table was empty: the first observation, recorded silently. */
  | { readonly kind: "baseline"; readonly row_id: number }
  /** The latest row is the active contract. */
  | { readonly kind: "unchanged" }
  /** Only the install path changed: recorded silently. */
  | { readonly kind: "recorded"; readonly row_id: number }
  /** A new plugin or schema version: a note, a row and one notification. */
  | { readonly kind: "noted"; readonly row_id: number; readonly note_path: string; readonly notification_id: number }
  /** The active install has no usable contract; `notification_id` is `null` when that notification already exists. */
  | { readonly kind: "no_contract"; readonly notification_id: number | null }
  /** No install was found (`/status` reports why): nothing done. */
  | { readonly kind: "unresolved"; readonly reason: LoomwrightContractErrorReason };

interface SeenRow {
  readonly id: number;
  readonly install_path: string;
  readonly plugin_version: string;
  readonly contract_schema_version: number;
  readonly contract_json: string;
}

/**
 * Record `observed` with `text` (the contract as read) as the latest row. An
 * older row with the same triple is deleted first (the triple is UNIQUE), so a
 * re-activated triple becomes the latest row. Run inside a transaction.
 */
function recordSeen(store: Store, observed: ObservedContract, text: string, at: string): number {
  store
    .prepare("DELETE FROM loomwright_contract_seen WHERE install_path = ? AND plugin_version = ? AND contract_schema_version = ?")
    .run(observed.install_path, observed.plugin_version, observed.contract_schema_version);
  const inserted = store
    .prepare("INSERT INTO loomwright_contract_seen (install_path, plugin_version, contract_schema_version, contract_json, first_seen_at) VALUES (?, ?, ?, ?, ?)")
    .run(observed.install_path, observed.plugin_version, observed.contract_schema_version, text, at);
  return Number(inserted.lastInsertRowid);
}

/** One notification per (source, title, body): looked up in the table, so a restart does not repeat it. */
function notifyNoContract(store: Store, err: LoomwrightContractError, now: Date): VersionCheckOutcome {
  const body = clipText(
    `Install: ${err.path}\n${err.message}\nSessions with this Loomwright are refused until its ${CONTRACT_FILE} is valid.`,
    MAX_NOTIFICATION_BODY,
  );
  return store.transaction((): VersionCheckOutcome => {
    const existing = store
      .prepare<[string, string, string], number>("SELECT id FROM notifications WHERE source = ? AND title = ? AND body = ? LIMIT 1")
      .pluck()
      .get(VERSION_NOTE_SOURCE, NO_CONTRACT_TITLE, body);
    if (existing !== undefined) return { kind: "no_contract", notification_id: null };
    const row = recordNotification(store, { source: VERSION_NOTE_SOURCE, title: NO_CONTRACT_TITLE, body }, now);
    return { kind: "no_contract", notification_id: row.id };
  });
}

/**
 * One check (the due work's body; see the header). Resolves the active
 * install with `settings` and no project (the user-scope view `/status`
 * uses), reads its contract once and validates that same text, so the stored
 * `contract_json` is exactly the validated bytes. Then, against the latest
 * row (highest `id`): none ⇒ baseline; same triple ⇒ nothing; only the
 * install path differs ⇒ recorded silently; otherwise the note is written,
 * then the row and one notification commit together.
 *
 * A `contract_*` refusal: no note, no row, and one notification naming the
 * install, unless the same one exists. Any other refusal (no install found):
 * nothing, since `/status` reports it. An unexpected error throws (the loop
 * records `due_work_failed`).
 */
export function checkLoomwrightVersion(ctx: DueWorkContext, settings: LoomwrightInstallSettings = ctx.loomwright ?? {}): VersionCheckOutcome {
  const { store } = ctx;
  let observed: ObservedContract;
  let text: string;
  try {
    const { installPath } = resolveLoomwrightInstall({ configured: settings.configured, installedPluginsPath: settings.installedPluginsPath });
    text = readLoomwrightContractText(installPath);
    const contract = parseLoomwrightContract(text, installPath);
    observed = { install_path: installPath, plugin_version: contract.plugin_version, contract_schema_version: contract.contract_schema_version };
  } catch (err) {
    if (!(err instanceof LoomwrightContractError)) throw err;
    if (!err.reason.startsWith("contract_")) return { kind: "unresolved", reason: err.reason };
    return notifyNoContract(store, err, ctx.now());
  }

  const now = ctx.now();
  const at = now.toISOString();
  const latest = store
    .prepare<[], SeenRow>("SELECT id, install_path, plugin_version, contract_schema_version, contract_json FROM loomwright_contract_seen ORDER BY id DESC LIMIT 1")
    .get();
  // The first observation ever: a baseline, never a note.
  if (latest === undefined) return { kind: "baseline", row_id: store.transaction(() => recordSeen(store, observed, text, at)) };
  const sameVersion = latest.plugin_version === observed.plugin_version && latest.contract_schema_version === observed.contract_schema_version;
  if (sameVersion && latest.install_path === observed.install_path) return { kind: "unchanged" };
  if (sameVersion) return { kind: "recorded", row_id: store.transaction(() => recordSeen(store, observed, text, at)) };

  const diff = diffLoomwrightContracts(latest.contract_json, text);
  const from = oneLine(latest.plugin_version) ?? "(unknown)";
  const to = oneLine(observed.plugin_version) ?? "(unknown)";
  const title = clipText(`Loomwright ${isDowngrade(latest.plugin_version, observed.plugin_version) ? "downgrade " : ""}${from} → ${to}`, MAX_NOTIFICATION_TITLE);
  const marker = versionNoteMarker(latest.id, observed);
  const content = renderVersionNote(diff, { title, marker, fromInstallPath: latest.install_path, toInstallPath: observed.install_path, at });
  const notePath = writeVersionNote(
    join(store.dataDir, VERSION_NOTES_DIR),
    `${safeVersionComponent(latest.plugin_version)}-to-${safeVersionComponent(observed.plugin_version)}`,
    content,
    marker,
  );

  const body = versionNoteBody(diff, notePath);
  return store.transaction((): VersionCheckOutcome => {
    const rowId = recordSeen(store, observed, text, at);
    const notification = recordNotification(store, { source: VERSION_NOTE_SOURCE, title, body }, now);
    return { kind: "noted", row_id: rowId, note_path: notePath, notification_id: notification.id };
  });
}

// ---- The due work ----------------------------------------------------------

export interface VersionWatchOptions {
  /** The least time between two checks of one kernel's store. Default `VERSION_CHECK_INTERVAL_MS`. */
  readonly minIntervalMs?: number;
}

/**
 * The due-work function: `checkLoomwrightVersion` at most once per
 * `minIntervalMs` per store, by the loop's clock. The last-check time is kept
 * in memory per store, so a kernel's first tick always checks; a clock that
 * went back checks again.
 */
export function createVersionWatchDueWork(options: VersionWatchOptions = {}): (ctx: DueWorkContext) => void {
  const interval = options.minIntervalMs ?? VERSION_CHECK_INTERVAL_MS;
  if (!Number.isFinite(interval) || interval < 0) throw new RangeError("minIntervalMs must be a finite number of at least 0");
  const lastCheck = new WeakMap<Store, number>();
  return (ctx) => {
    const now = ctx.now().getTime();
    const last = lastCheck.get(ctx.store);
    if (last !== undefined && now >= last && now - last < interval) return;
    lastCheck.set(ctx.store, now);
    checkLoomwrightVersion(ctx, ctx.loomwright ?? {});
  };
}

/** The shipped due work: a check at kernel start, then at most once a minute. */
export const versionWatchDueWork = createVersionWatchDueWork();
