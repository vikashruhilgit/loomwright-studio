// Wright's memory files (invariant 8): plain markdown under
// `<dataDir>/memory/`, which the owner reads and edits. The kernel creates a
// file only when it is absent, with exclusive create (`flag: "wx"`), so an
// existing file (the owner's edit included) is never overwritten, even by a
// second kernel racing the first. Reads are bounded: a huge file never loads
// whole into memory. Imports only `node:*` and its siblings (the `studio` CLI
// loads this module).
import { closeSync, mkdirSync, openSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LESSONS_TEMPLATE, PEOPLE_TEMPLATE, PREFERENCES_TEMPLATE, ROLE_TEMPLATE, SHARED_README_TEMPLATE } from "./templates.js";

/** `<dataDir>/memory`. */
export function memoryDir(dataDir: string): string {
  return join(dataDir, "memory");
}

/** `<dataDir>/memory/wright`: Wright's own files, and its session's working directory. */
export function wrightMemoryDir(dataDir: string): string {
  return join(memoryDir(dataDir), "wright");
}

/** One memory file: its path relative to `<dataDir>/memory`, and its first-run text. */
export interface MemoryFile {
  readonly relativePath: string;
  readonly template: string;
}

/** Every file the kernel creates on the first Wright message, in context order (role first). */
export const MEMORY_FILES: readonly MemoryFile[] = Object.freeze([
  { relativePath: "wright/role.md", template: ROLE_TEMPLATE },
  { relativePath: "wright/preferences.md", template: PREFERENCES_TEMPLATE },
  { relativePath: "wright/people.md", template: PEOPLE_TEMPLATE },
  { relativePath: "wright/lessons.md", template: LESSONS_TEMPLATE },
  { relativePath: "shared/README.md", template: SHARED_README_TEMPLATE },
]);

/** True for a Node error whose `code` is `code`. */
function hasCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/**
 * Create every memory file that is absent, from its template. Exclusive
 * create (`wx`): a file that exists, whatever its content, is left as it is.
 * Returns the paths (relative to `memory/`) it created. Any other write error
 * (a read-only disk, a directory where a file should be) is thrown.
 */
export function ensureMemoryFiles(dataDir: string): string[] {
  const root = memoryDir(dataDir);
  const created: string[] = [];
  for (const file of MEMORY_FILES) {
    const path = join(root, file.relativePath);
    mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, file.template, { flag: "wx", mode: 0o600 });
      created.push(file.relativePath);
    } catch (err) {
      if (!hasCode(err, "EEXIST")) throw err;
    }
  }
  return created;
}

/** A memory file as read for the context: its text, cut to the limit. */
export interface MemoryRead {
  readonly relativePath: string;
  /** At most `maxChars` characters; empty when the file is missing or unreadable. */
  readonly text: string;
  /** Characters cut from the end (a lower bound when `atLeast`). */
  readonly cut: number;
  /** The file was larger than the bytes read, so `cut` is a lower bound. */
  readonly atLeast: boolean;
  /** Why the file gave no text: `missing`, or an error code. */
  readonly problem: string | null;
}

/** UTF-8 needs at most 4 bytes a character: reading this many bytes covers `maxChars` characters and one more. */
function byteBudget(maxChars: number): number {
  return (maxChars + 1) * 4;
}

/** Cut `text` to `max` characters, never ending on half a surrogate pair. */
export function cutChars(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut;
}

/**
 * Read one memory file for the context, at most `maxChars` characters. Reads
 * at most `(maxChars + 1) * 4` bytes, so a huge file costs no more than that;
 * when the file had more, the cut is reported as a lower bound. A missing or
 * unreadable file is empty text with its `problem`, never a throw.
 */
export function readMemoryFile(dataDir: string, relativePath: string, maxChars: number): MemoryRead {
  const path = join(memoryDir(dataDir), relativePath);
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (err) {
    const problem = hasCode(err, "ENOENT") ? "missing" : String((err as { code?: unknown }).code ?? "unreadable");
    return { relativePath, text: "", cut: 0, atLeast: false, problem };
  }
  try {
    const budget = byteBudget(maxChars);
    const buf = Buffer.alloc(budget + 1);
    let size = 0;
    while (size < buf.length) {
      const n = readSync(fd, buf, size, buf.length - size, null);
      if (n === 0) break;
      size += n;
    }
    const more = size > budget;
    // A byte cut can split a character: decoding replaces the partial tail, which is past `maxChars` anyway.
    const decoded = buf.subarray(0, Math.min(size, budget)).toString("utf8");
    const text = cutChars(decoded, maxChars);
    return { relativePath, text, cut: decoded.length - text.length, atLeast: more, problem: null };
  } catch (err) {
    return { relativePath, text: "", cut: 0, atLeast: false, problem: String((err as { code?: unknown }).code ?? "unreadable") };
  } finally {
    closeSync(fd);
  }
}
