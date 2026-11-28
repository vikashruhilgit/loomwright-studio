// Wright's memory files (invariant 8): plain markdown under
// `<dataDir>/memory/`, which the owner reads and edits. The kernel creates a
// file only when it is absent, with exclusive create (`flag: "wx"`), so an
// existing file (the owner's edit included) is never overwritten, even by a
// second kernel racing the first. A thread's summary file
// (`memory/<agent>/threads/<thread>.md`, `writeThreadSummary`) is created the
// same way from a summarize session's reply; the one overwrite is start-fresh
// writing the owner's own edited text back (an explicit owner action). An
// agent's session runs with its memory folder as cwd, so it can plant a
// symbolic link there: every thread-summary write and read refuses a link at
// `memory/<agent>`, at `threads/` and at the file itself
// (`symlink_refused`), so the kernel never writes or reads through one
// (invariant 3). Reads are bounded: a huge file never loads whole into memory.
//
// The one kernel rewrite of a memory file (wa-b): Wright's `role.md`, when its
// bytes are exactly a `ROLE_TEMPLATE` the kernel once shipped (its sha256 is
// in `PAST_ROLE_TEMPLATE_HASHES`, `./past-templates.ts`), is replaced with the
// current template by `ensureMemoryFiles`, with a backup and one audit event,
// and only while a kernel's audit sink is registered for the data dir. Any
// other text, a link and every crew member's `role.md` are never written.
//
// Imports only `node:*`, its siblings and
// `../tools/handoff.ts` (itself `node:*` only): the `studio` CLI loads this
// module.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNASSIGNED_AGENT_DIR } from "../tools/handoff.js";
import { MAX_ROLE_UPGRADE_BYTES, PAST_ROLE_TEMPLATE_HASHES, roleUpgradeRegistration } from "./past-templates.js";
import type { RoleUpgradeAuditKind, RoleUpgradeAuditSink } from "./past-templates.js";
import { LESSONS_TEMPLATE, PEOPLE_TEMPLATE, PREFERENCES_TEMPLATE, ROLE_TEMPLATE, SHARED_README_TEMPLATE } from "./templates.js";

/** `memory/playbooks/`: the playbook mirrors' folder (`../playbooks/mirror.ts`). */
export const PLAYBOOK_MIRROR_DIR = "playbooks";

/**
 * The `memory/` folders the kernel owns, the one list: Wright's, the shared
 * one, the handoff folder of a session with no agent (`../tools/handoff.ts`)
 * and the playbook mirrors'. A crew member's memory folder is `memory/<id>`,
 * so no crew id may be one of these (`RESERVED_AGENT_IDS`,
 * `../agents/types.ts`, is this list).
 */
export const KERNEL_MEMORY_DIRS = Object.freeze(["wright", "shared", UNASSIGNED_AGENT_DIR, PLAYBOOK_MIRROR_DIR] as const);

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
 * (a read-only disk, a directory where a file should be) is thrown. Then it
 * replaces Wright's `role.md` when it is an unedited past template
 * (`upgradeWrightRole`), which never throws and is never in the returned
 * paths.
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
  upgradeWrightRole(dataDir);
  return created;
}

// ---- wa-b: an unedited past `role.md` becomes the current template --------------------

/** Wright's `role.md`, relative to `memory/`: the one file the upgrade may write. */
const WRIGHT_ROLE = "wright/role.md";

/**
 * Wright's `role.md` bytes, read only when it is safe to replace: `memory/wright`
 * is a real directory and `role.md` a regular file with one link, no larger
 * than `MAX_ROLE_UPGRADE_BYTES`. Both are checked with `lstat`, so a symbolic
 * link at either is refused (`symlink_refused`) before anything opens it, and
 * the file is opened with `O_NOFOLLOW | O_NONBLOCK` (a link planted after the
 * check fails the open; a FIFO never blocks) and checked again with `fstat`.
 * Anything else throws.
 */
function readWrightRoleForUpgrade(dataDir: string): Buffer {
  const dir = wrightMemoryDir(dataDir);
  const dirStat = lstatOrUndefined(dir);
  if (dirStat === undefined) throw codedError("ENOENT", `${dir} does not exist`);
  if (dirStat.isSymbolicLink()) throw codedError("symlink_refused", `${dir} is a symbolic link`);
  if (!dirStat.isDirectory()) throw codedError("not_a_directory", `${dir} is not a directory`);
  const path = join(dir, "role.md");
  const st = lstatOrUndefined(path);
  if (st === undefined) throw codedError("ENOENT", `${path} does not exist`);
  if (st.isSymbolicLink()) throw codedError("symlink_refused", `${path} is a symbolic link`);
  // O_NOFOLLOW: a link planted at `role.md` after the check fails the open (ELOOP) instead of being followed.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) throw codedError("not_a_file", `${path} is not a regular file`);
    if (opened.nlink > 1) throw codedError("hard_link_refused", `${path} has more than one link`);
    // One byte past the bound: a file that grew past it is refused, never read whole.
    const buf = Buffer.alloc(MAX_ROLE_UPGRADE_BYTES + 1);
    let size = 0;
    while (size < buf.length) {
      const n = readSync(fd, buf, size, buf.length - size, null);
      if (n === 0) break;
      size += n;
    }
    if (size > MAX_ROLE_UPGRADE_BYTES) throw codedError("too_large", `${path} is over ${MAX_ROLE_UPGRADE_BYTES} bytes`);
    return Buffer.from(buf.subarray(0, size));
  } finally {
    closeSync(fd);
  }
}

/** The steps an upgrade can fail at, as the `wright_role_upgrade_failed` event's `step` names them. */
type RoleUpgradeStep = "backup" | "write" | "rename" | "record";

/** An upgrade step that failed, with the error's code (`ENOSPC`, `EACCES`; `error` when it has none). */
class RoleStepError extends Error {
  constructor(
    readonly step: RoleUpgradeStep,
    readonly code: string,
  ) {
    super(`${step}: ${code}`);
  }
}

/** Thrown inside the transaction when `role.md` changed (or went, or became a link) since it was read: the owner's edit wins. */
class RoleChangedError extends Error {}

function codeOf(err: unknown): string {
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return typeof code === "string" && code !== "" ? code.slice(0, 64) : "error";
}

/** `fn`, with a throw turned into the failure of `step`. */
function atStep<T>(step: RoleUpgradeStep, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new RoleStepError(step, codeOf(err));
  }
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Already renamed or gone.
  }
}

/** `record` through the sink, swallowing a sink that throws (the message must still run). */
function recordQuietly(sink: RoleUpgradeAuditSink, kind: RoleUpgradeAuditKind, payload: Record<string, unknown>): void {
  try {
    sink.record(kind, payload);
  } catch {
    // A sink that throws is swallowed.
  }
}

/**
 * The upgrade, run by `ensureMemoryFiles` after its create loop, for
 * `wright/role.md` only (a crew member's `role.md` is its approved charter and
 * is never looked at here). It runs only under a registration
 * (`roleUpgradeRegistration`: a sink registered for the data dir and no store
 * transaction open), and only when the file passes `readWrightRoleForUpgrade`
 * and its bytes' sha256 is in `PAST_ROLE_TEMPLATE_HASHES` and has not already
 * failed under this registration. Then: the old bytes go to
 * `role.bak-<UTC stamp>-<random hex>.md` beside it (exclusive create, mode
 * 0600), `ROLE_TEMPLATE` to a temporary sibling, and inside the sink's
 * transaction `role.md` is re-read (changed since the first read: no rename,
 * no event, the backup stays), `wright_role_upgraded` is appended and the
 * rename runs last. A failed step before the rename leaves `role.md` byte for
 * byte, removes the temporary file and the backup, remembers the bytes'
 * sha256 and records `wright_role_upgrade_failed {file, step, code}`. Never
 * throws.
 */
function upgradeWrightRole(dataDir: string): void {
  const registration = roleUpgradeRegistration(dataDir);
  if (registration === undefined) return;
  const { sink, failed } = registration;
  let base: Buffer;
  try {
    base = readWrightRoleForUpgrade(dataDir);
  } catch {
    // Absent, a link, not a regular file, too large or unreadable: never a candidate, nothing recorded.
    return;
  }
  const digest = createHash("sha256").update(base).digest("hex");
  if (!PAST_ROLE_TEMPLATE_HASHES.includes(digest)) return;
  if (failed.has(digest)) return;
  const dir = wrightMemoryDir(dataDir);
  const file = join(dir, "role.md");
  const backupName = `role.bak-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(4).toString("hex")}.md`;
  const backup = join(dir, backupName);
  const temp = join(dir, `.role.md.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const upgraded = { file: WRIGHT_ROLE, old_hash: digest, backup: `wright/${backupName}` };
  let backedUp = false;
  let renamed = false;
  try {
    atStep("backup", () => writeFileSync(backup, base, { flag: "wx", mode: 0o600 }));
    backedUp = true;
    try {
      atStep("write", () => writeFileSync(temp, ROLE_TEMPLATE, { flag: "wx", mode: 0o600 }));
      sink.transaction(() => {
        // Re-read just before the rename: an owner's edit since the first read wins.
        let now: Buffer;
        try {
          now = readWrightRoleForUpgrade(dataDir);
        } catch {
          throw new RoleChangedError();
        }
        if (!now.equals(base)) throw new RoleChangedError();
        sink.record("wright_role_upgraded", upgraded);
        atStep("rename", () => renameSync(temp, file));
        renamed = true;
      });
    } catch (err) {
      removeQuietly(temp);
      if (err instanceof RoleStepError || err instanceof RoleChangedError) throw err;
      // The sink's record or its COMMIT threw.
      throw new RoleStepError("record", codeOf(err));
    }
  } catch (err) {
    // The owner's edit is not a failure: no event, the backup stays, and the next call leaves the edited file alone.
    if (err instanceof RoleChangedError) return;
    if (renamed) {
      // The rename ran but the COMMIT did not: `role.md` holds the new template, so the event is recorded on its own.
      recordQuietly(sink, "wright_role_upgraded", upgraded);
      return;
    }
    // Before the rename: `role.md` still holds the old bytes, so their backup is redundant.
    if (backedUp) removeQuietly(backup);
    // Remembered before recording, so a sink that throws is not retried on every message either.
    failed.add(digest);
    const failure = err instanceof RoleStepError ? err : new RoleStepError("record", codeOf(err));
    recordQuietly(sink, "wright_role_upgrade_failed", { file: WRIGHT_ROLE, step: failure.step, code: failure.code });
  }
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

/** A thread's summary file, relative to `memory/`: `<agent>/threads/<thread>.md` (`agent` is `wright` or a crew id; the caller checks it). */
export function threadSummaryRelativePath(agent: string, thread: number): string {
  return `${agent}/threads/${thread}.md`;
}

/** An error with a Node-style `code`, for the refusals below. */
function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * `memory/<agent>/threads`, checked one component at a time with `lstat`: a
 * symbolic link at `memory/<agent>` or at `threads/` is refused
 * (`symlink_refused`), and so is anything that is not a directory
 * (`not_a_directory`). With `create`, a missing component is created (never
 * through a link: each `mkdir` is one level under a checked directory); else
 * a missing one throws `ENOENT`. `memory/` itself is the kernel's own folder.
 */
function threadsDir(dataDir: string, agent: string, create: boolean): string {
  let dir = memoryDir(dataDir);
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const part of [agent, "threads"]) {
    dir = join(dir, part);
    let st = lstatOrUndefined(dir);
    if (st === undefined) {
      if (!create) throw codedError("ENOENT", `${dir} does not exist`);
      try {
        mkdirSync(dir, { mode: 0o700 });
      } catch (err) {
        if (!hasCode(err, "EEXIST")) throw err;
      }
      st = lstatSync(dir);
    }
    if (st.isSymbolicLink()) throw codedError("symlink_refused", `${dir} is a symbolic link`);
    if (!st.isDirectory()) throw codedError("not_a_directory", `${dir} is not a directory`);
  }
  return dir;
}

function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (err) {
    if (hasCode(err, "ENOENT")) return undefined;
    throw err;
  }
}

/**
 * Write a thread's summary file (`threadSummaryRelativePath`), its folder
 * created when absent. Owner-editable, so it is never overwritten except by
 * an explicit owner action: `replace: false` (a summarize session's reply) is
 * exclusive create (`wx`) and returns `false` when the file already exists;
 * `replace: true` is only for the owner's own text (start-fresh's `summary`),
 * written to a fresh temporary file (`wx`) renamed over the path, so a link
 * there is replaced, never written through. Neither path opens an existing
 * node, so a FIFO planted at the path never blocks: exclusive create answers
 * `false` (EEXIST) and the rename replaces it. A symbolic link at the folder or
 * the file throws `symlink_refused`; any other write error is thrown.
 */
export function writeThreadSummary(dataDir: string, agent: string, thread: number, text: string, replace: boolean): boolean {
  const dir = threadsDir(dataDir, agent, true);
  const path = join(dir, `${thread}.md`);
  if (lstatOrUndefined(path)?.isSymbolicLink() === true) throw codedError("symlink_refused", `${path} is a symbolic link`);
  if (!replace) {
    try {
      // `wx` is O_CREAT|O_EXCL: it never follows a link planted after the check above.
      writeFileSync(path, text, { flag: "wx", mode: 0o600 });
      return true;
    } catch (err) {
      if (hasCode(err, "EEXIST")) return false;
      throw err;
    }
  }
  const tmp = join(dir, `.${thread}.md.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return true;
}

/**
 * Read a thread's summary file for a prompt or a route, at most `maxChars`
 * characters (`readMemoryFile`'s bounded read). Never through a link: a
 * symbolic link at the folder or the file, or a file with more than one hard
 * link, gives `problem` `symlink_refused` / `hard_link_refused`; anything at
 * the path that is not a regular file (a FIFO, a directory, a socket) is
 * `not_a_file`, refused without blocking (the open is non-blocking); a folder
 * component that is not a directory is `not_a_directory`; a missing folder or
 * file is `missing`; any other open error is its code; never a throw.
 */
export function readThreadSummary(dataDir: string, agent: string, thread: number, maxChars: number): MemoryRead {
  const relativePath = threadSummaryRelativePath(agent, thread);
  const none = (problem: string): MemoryRead => ({ relativePath, text: "", cut: 0, atLeast: false, problem });
  let fd: number;
  try {
    const dir = threadsDir(dataDir, agent, false);
    // O_NOFOLLOW: a link at the file itself fails the open (ELOOP) instead of being followed.
    // O_NONBLOCK: a FIFO planted at the path opens at once instead of blocking the
    // kernel's event loop until a writer appears; `fstat` then refuses it
    // (`not_a_file`). It changes nothing for a regular file's reads.
    fd = openSync(join(dir, `${thread}.md`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    if (hasCode(err, "ENOENT")) return none("missing");
    if (hasCode(err, "ELOOP")) return none("symlink_refused");
    return none(String((err as { code?: unknown }).code ?? "unreadable"));
  }
  let refused: string | null;
  try {
    const st = fstatSync(fd);
    refused = !st.isFile() ? "not_a_file" : st.nlink > 1 ? "hard_link_refused" : null;
  } catch (err) {
    refused = String((err as { code?: unknown }).code ?? "unreadable");
  }
  if (refused !== null) {
    closeSync(fd);
    return none(refused);
  }
  return readOpened(fd, relativePath, maxChars);
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
  return readOpened(fd, relativePath, maxChars);
}

/** The bounded read of an open file (closed here), as `readMemoryFile` describes it. */
function readOpened(fd: number, relativePath: string, maxChars: number): MemoryRead {
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
