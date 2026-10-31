// Memory (phase 7 item 06): the pure parts of the screen. Plain TypeScript, no React and
// no CSS import, so the e2e (`tsconfig.node.json`, no `jsx`) can import `MEMORY_TEST_IDS`
// instead of copying it, and the unit tests can pin each rule without a DOM.
//
// What lives here: the test ids; the feed kinds that make the screen read again; the line
// diff (`lineDiff`, the Changes inspector's hunks, which no other module computes) and the
// carry-over of the owner's added lines onto the text on disk (`carryOver`, the mockup's
// `mergeOnDisk`); the tree as rows and its keyboard order; and the size, time and version text.
//
// Every string from the kernel (a file name, a path, a file's text, a refusal's code) is
// untrusted data (invariant 3): a name or a code passes through `printable` before it is
// shown, and every component renders a value as a React text child, never as markup. A
// file's text is shown as written (it is the thing the owner is reading and editing), in a
// `<pre>` or a `<textarea>`, which are text.
import type { ApiResult, EventFrame, MemoryConflictError, MemoryFileEntry, MemoryFileResponse, MemoryTreeResponse, TruncatedEventFrame } from "../../api/contract";
import { printable } from "../approvals/printable";

/** The ids the unit tests and the e2e spec target. */
export const MEMORY_TEST_IDS = {
  screen: "screen-memory",
  subtitle: "memory-subtitle",
  root: "memory-root",
  tree: "memory-tree",
  folder: "memory-folder",
  fileButton: "memory-file",
  overview: "memory-overview",
  empty: "memory-empty",
  askWright: "memory-ask-wright",
  loading: "memory-loading",
  error: "memory-error",
  errorDetail: "memory-error-detail",
  retry: "memory-retry",
  stale: "memory-stale",
  fileView: "memory-file-view",
  fileTitle: "memory-file-title",
  filePath: "memory-file-path",
  fileSize: "memory-file-size",
  fileModified: "memory-file-modified",
  fileVersion: "memory-file-version",
  contents: "memory-contents",
  fileLoading: "memory-file-loading",
  fileError: "memory-file-error",
  edit: "memory-edit",
  editor: "memory-editor",
  textarea: "memory-textarea",
  changes: "memory-changes",
  cancel: "memory-cancel",
  save: "memory-save",
  saveError: "memory-save-error",
  conflict: "memory-conflict",
  conflictBand: "memory-conflict-band",
  onDisk: "memory-on-disk",
  mine: "memory-mine",
  discard: "memory-discard",
  copy: "memory-copy",
  onTop: "memory-on-top",
  backToEditing: "memory-back-to-editing",
  live: "memory-live",
} as const;

/** The feed kinds that make the screen read the tree again: an owner's write, and a session ending (when agents write their lessons). */
export const MEMORY_REFETCH_KINDS = ["memory_updated", "session_status"] as const;

type Frame = EventFrame | TruncatedEventFrame;

export function memoryRefetchWanted(kind: string): boolean {
  return (MEMORY_REFETCH_KINDS as readonly string[]).includes(kind);
}

/** The id of the newest event that makes the screen read again (0 when none): its refetch trigger. */
export function memoryRefetchMark(eventLog: readonly Frame[]): number {
  for (let i = eventLog.length - 1; i >= 0; i -= 1) {
    const frame = eventLog[i];
    if (frame !== undefined && memoryRefetchWanted(frame.kind)) return frame.id;
  }
  return 0;
}

// ---- the line diff ------------------------------------------------------------------------------------

// `DiffView`'s own shapes, written out again (they are structurally the same type) so this
// module imports no `.tsx` file and stays importable by the e2e project.
export type DiffLine =
  | { readonly kind: "context"; readonly oldNumber: number; readonly newNumber: number; readonly text: string }
  | { readonly kind: "add"; readonly newNumber: number; readonly text: string }
  | { readonly kind: "del"; readonly oldNumber: number; readonly text: string };

export interface DiffHunk {
  readonly header: string;
  readonly lines: readonly DiffLine[];
}

/** `lineDiff` refuses when the lines that differ, before × after, exceed this (the table is that many cells). */
export const MAX_DIFF_CELLS = 4_000_000;

/** The unchanged lines kept around a change in a hunk. */
const CONTEXT_LINES = 3;

/** The edit script as one list of lines, then cut into hunks of changes with `CONTEXT_LINES` around them. */
function hunksOf(lines: readonly DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let from = -1;
  let to = -1;
  const flush = (): void => {
    if (from < 0) return;
    const slice = lines.slice(from, to + 1);
    const hasOld = (l: DiffLine): l is Extract<DiffLine, { readonly oldNumber: number }> => l.kind !== "add";
    const hasNew = (l: DiffLine): l is Extract<DiffLine, { readonly newNumber: number }> => l.kind !== "del";
    const oldCount = slice.filter(hasOld).length;
    const newCount = slice.filter(hasNew).length;
    // A side with no line in the hunk starts at the line before it, as a unified diff writes it.
    const oldStart = slice.find(hasOld)?.oldNumber ?? lastNumber(lines, from, "oldNumber");
    const newStart = slice.find(hasNew)?.newNumber ?? lastNumber(lines, from, "newNumber");
    hunks.push({ header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: slice });
  };
  lines.forEach((line, at) => {
    if (line.kind === "context") return;
    const start = Math.max(0, at - CONTEXT_LINES);
    const end = Math.min(lines.length - 1, at + CONTEXT_LINES);
    if (from >= 0 && start <= to + 1) {
      to = Math.max(to, end);
      return;
    }
    flush();
    from = start;
    to = end;
  });
  flush();
  return hunks;
}

/** The highest `oldNumber` or `newNumber` on a line before index `at` (0 when none). */
function lastNumber(lines: readonly DiffLine[], at: number, side: "oldNumber" | "newNumber"): number {
  for (let k = at - 1; k >= 0; k -= 1) {
    const line = lines[k];
    if (line !== undefined && side in line) return (line as unknown as Record<string, number>)[side] as number;
  }
  return 0;
}

/**
 * The line diff of `before` to `after` as hunks for `DiffView` (none when the texts are equal).
 * Lines are compared whole; a common head and tail are trimmed first, so the table holds only the
 * lines in between. `null` when that table would pass `MAX_DIFF_CELLS`: the caller says the file
 * is too large to compare here (saving still works).
 */
export function lineDiff(before: string, after: string): readonly DiffHunk[] | null {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const n = a.length - tail;
  const m = b.length - tail;
  const width = m - head + 1;
  if ((n - head) * (m - head) > MAX_DIFF_CELLS) return null;
  // The longest common subsequence of the lines between head and tail, from the end.
  const table = new Uint32Array((n - head + 1) * width);
  const cell = (i: number, j: number): number => table[(i - head) * width + (j - head)] as number;
  for (let i = n - 1; i >= head; i -= 1) {
    for (let j = m - 1; j >= head; j -= 1) {
      table[(i - head) * width + (j - head)] = a[i] === b[j] ? cell(i + 1, j + 1) + 1 : Math.max(cell(i + 1, j), cell(i, j + 1));
    }
  }
  const out: DiffLine[] = [];
  for (let k = 0; k < head; k += 1) out.push({ kind: "context", oldNumber: k + 1, newNumber: k + 1, text: a[k] as string });
  let i = head;
  let j = head;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "context", oldNumber: i + 1, newNumber: j + 1, text: a[i] as string });
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && cell(i + 1, j) >= cell(i, j + 1))) {
      out.push({ kind: "del", oldNumber: i + 1, text: a[i] as string });
      i += 1;
    } else {
      out.push({ kind: "add", newNumber: j + 1, text: b[j] as string });
      j += 1;
    }
  }
  for (let k = 0; k < tail; k += 1) out.push({ kind: "context", oldNumber: n + k + 1, newNumber: m + k + 1, text: a[n + k] as string });
  return hunksOf(out);
}

/**
 * The owner's edit on top of the text now on disk (the mockup's `mergeOnDisk`): the disk text,
 * then each line the owner added to what they opened (`base` to `mine`). Lines the owner removed
 * are not carried over: the disk text stays whole, and the owner reads the result before saving.
 * `null` when the two texts are too large to compare.
 */
export function carryOver(base: string, mine: string, current: string): string | null {
  const hunks = lineDiff(base, mine);
  if (hunks === null) return null;
  const added = hunks.flatMap((h) => h.lines.filter((l) => l.kind === "add").map((l) => l.text));
  // A text that ends in a newline keeps it: the added lines follow its last line, with no blank line between.
  if (current.endsWith("\n")) return `${[...current.slice(0, -1).split("\n"), ...added].join("\n")}\n`;
  return [...current.split("\n"), ...added].join("\n");
}

// ---- the draft --------------------------------------------------------------------------------------------

/**
 * The owner's edit. `baseHash` is the version it was opened at (what a save sends as `base_hash`),
 * `baseText` that version's text. A `<textarea>` holds line breaks as `\n`, so both texts are kept that
 * way and `eol` remembers what the file used: a save puts it back (`contentToSend`).
 */
export interface MemoryDraft {
  readonly path: string;
  readonly text: string;
  readonly baseHash: string;
  readonly baseText: string;
  readonly eol: "\n" | "\r\n";
}

/** `text` with every line break as `\n`, as a `<textarea>` holds it. */
export function lf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function eolOf(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** A draft that starts as the file as read (nothing changed yet). */
export function openDraft(file: { readonly path: string; readonly content: string; readonly content_hash: string }): MemoryDraft {
  return { path: file.path, text: lf(file.content), baseHash: file.content_hash, baseText: lf(file.content), eol: eolOf(file.content) };
}

/** A draft on top of the text now on disk: the owner's added lines carried over, based on the disk's version. `null` when too large to compare. */
export function draftOnTop(draft: MemoryDraft, conflict: MemoryConflictError): MemoryDraft | null {
  const disk = lf(conflict.current_content);
  const text = carryOver(draft.baseText, draft.text, disk);
  if (text === null) return null;
  return { path: draft.path, text, baseHash: conflict.current_hash, baseText: disk, eol: eolOf(conflict.current_content) };
}

export function isDirty(draft: MemoryDraft): boolean {
  return draft.text !== draft.baseText;
}

/** The text a save sends: the draft with the file's own line breaks. */
export function contentToSend(draft: MemoryDraft): string {
  return draft.eol === "\r\n" ? draft.text.replace(/\n/g, "\r\n") : draft.text;
}

/** A kernel's `409` body is a conflict only when it carries both versions. */
export function isConflictBody(body: unknown): body is MemoryConflictError {
  const b = body as Partial<MemoryConflictError> | null;
  return typeof b === "object" && b !== null && b.error === "changed_since_read" && typeof b.current_content === "string" && typeof b.current_hash === "string";
}

// ---- the tree ---------------------------------------------------------------------------------------------

/** One folder of the tree: an agent's files, or the shared ones. */
export interface MemoryGroup {
  /** The folder under `memory/` (an agent id, or `shared`). */
  readonly folder: string;
  /** The name shown: the folder, capitalised. */
  readonly label: string;
  readonly files: readonly MemoryFileEntry[];
}

function labelOf(folder: string): string {
  const text = printable(folder);
  return text === "" ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** Each agent's files in the order the kernel sent them, then the shared files; a folder with no file is left out. */
export function groupsOf(tree: MemoryTreeResponse): readonly MemoryGroup[] {
  const groups: MemoryGroup[] = tree.agents.map((a) => ({ folder: a.agent, label: labelOf(a.agent), files: a.files }));
  groups.push({ folder: "shared", label: "Shared", files: tree.shared });
  return groups.filter((g) => g.files.length > 0);
}

export function fileCount(tree: MemoryTreeResponse): number {
  return groupsOf(tree).reduce((n, g) => n + g.files.length, 0);
}

/** Every file path in the order the tree shows them: the order J and K walk. */
export function fileOrder(tree: MemoryTreeResponse): readonly string[] {
  return groupsOf(tree).flatMap((g) => g.files.map((f) => f.path));
}

export function entryOf(tree: MemoryTreeResponse | undefined, path: string): MemoryFileEntry | undefined {
  return tree === undefined ? undefined : groupsOf(tree).flatMap((g) => g.files).find((f) => f.path === path);
}

/** A path's last segment (`mason/lessons.md` is `lessons.md`). */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The folder of a path (`mason/lessons.md` is `mason`). */
export function folderOf(path: string): string {
  const at = path.indexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** The memory root as shown: `<data_dir>/memory/`, or `memory/` until `GET /settings` has answered. */
export function memoryRoot(dataDir: string | undefined): string {
  return dataDir === undefined || dataDir === "" ? "memory/" : `${printable(dataDir).replace(/\/+$/, "")}/memory/`;
}

/** A file's full path as shown: the root, then its path under `memory/`. */
export function fullPath(dataDir: string | undefined, path: string): string {
  return `${memoryRoot(dataDir)}${printable(path)}`;
}

// ---- size, time, version -----------------------------------------------------------------------------------

export function sizeText(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The first 8 characters of a content hash: the version the owner reads. */
export function versionOf(hash: string): string {
  return printable(hash).slice(0, 8);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const two = (n: number): string => String(n).padStart(2, "0");

/** "today 13:10", or "Wed 28 Oct" (with the year when it is not this one), in the owner's time zone; the text itself when it is no date. */
export function modifiedText(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return printable(iso);
  const today = new Date(now);
  if (at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()) return `today ${two(at.getHours())}:${two(at.getMinutes())}`;
  const year = at.getFullYear() === today.getFullYear() ? "" : ` ${at.getFullYear()}`;
  return `${DAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}${year}`;
}

/** A file button's accessible name: "<path>, <size>, modified <time>". */
export function fileLabel(entry: MemoryFileEntry, now: number = Date.now()): string {
  return `${printable(entry.path)}, ${sizeText(entry.size)}, modified ${modifiedText(entry.modified, now)}`;
}

/** The count in the subtitle and the overview: "12 files". */
export function countText(count: number): string {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

/** What the file view says under the contents, by file (the mockup's three notes). */
export function helpText(path: string): string {
  const name = fileName(path);
  if (name === "lessons.md") return "Agents write lessons during sessions. If one writes while you edit, your save is refused and you see both versions.";
  if (name === "role.md") return "The charter the agent reads. The settings the kernel enforces are not here: they live in config/agents/<id>.json, which Team owns.";
  return "Plain markdown. Only files under memory/ can be edited here.";
}

// ---- reading an answer -------------------------------------------------------------------------------------

/** Why a read or a write did not succeed, in words: the status and the code, or what kept the kernel from answering. */
export interface Refusal {
  /** `0` when the kernel did not answer. */
  readonly status: number;
  /** The kernel's `error` code, or the reason it did not answer. */
  readonly code: string;
}

export function refusalOf(result: ApiResult<unknown>): Refusal | undefined {
  if (result.ok) return undefined;
  if ("connection" in result) {
    const reason = result.connection.state === "unreachable" ? result.connection.reason : result.connection.state;
    return { status: 0, code: printable(reason) };
  }
  const code = (result.body as { error?: unknown } | null)?.error;
  return { status: result.status, code: printable(typeof code === "string" ? code : "unknown_error") };
}

/** `<METHOD> <path> · <status> · <code>` for a detail line. */
export function refusalLine(route: string, refusal: Refusal): string {
  return refusal.status === 0 ? `${route} · no answer · ${refusal.code}` : `${route} · ${refusal.status} · ${refusal.code}`;
}

/** A save that did not go through, in words: the draft is kept, and the code is named. */
export function notSavedText(refusal: Refusal): string {
  if (refusal.status === 0) return `Not saved: the kernel did not answer (${refusal.code}). Your edit is kept here; save again when it is back.`;
  return `Not saved: the kernel refused it (${refusal.status} · ${refusal.code}). Your edit is kept here.`;
}

// ---- checking a body -----------------------------------------------------------------------------------------

function isEntry(value: unknown): value is MemoryFileEntry {
  const e = value as Partial<MemoryFileEntry> | null;
  return typeof e === "object" && e !== null && typeof e.path === "string" && typeof e.size === "number" && typeof e.modified === "string";
}

/** `GET /memory`'s body, when it has the shape the screen draws; anything else is a failed read, never data. */
export function isTreeBody(body: unknown): body is MemoryTreeResponse {
  const t = body as Partial<MemoryTreeResponse> | null;
  if (typeof t !== "object" || t === null || !Array.isArray(t.agents) || !Array.isArray(t.shared)) return false;
  return t.shared.every(isEntry) && t.agents.every((a) => typeof a === "object" && a !== null && typeof a.agent === "string" && Array.isArray(a.files) && a.files.every(isEntry));
}

/** `GET /memory/file`'s body, when it carries the text and its hash. */
export function isFileBody(body: unknown): body is MemoryFileResponse {
  const f = body as Partial<MemoryFileResponse> | null;
  return typeof f === "object" && f !== null && typeof f.path === "string" && typeof f.content === "string" && typeof f.content_hash === "string";
}
