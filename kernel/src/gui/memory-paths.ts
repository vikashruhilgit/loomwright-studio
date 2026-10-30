// The one path guard behind `GET /memory/file` and `PUT /memory/file` (phase 7,
// item 06). The write route is the first owner route that writes a file the
// caller names, so every check that decides which file a path may name lives
// here, in one place, and both routes call it. Nothing else copies it.
//
// A path is `<folder>/<file>` relative to `<dataDir>/memory/`. The guard runs
// its checks in a fixed order (first refusal wins):
//
//   1. lexical shape      not a string, empty, a NUL, a backslash, over 512 characters
//   2. absolute           `/etc/x.md`
//   3. segments           an empty, `.` or `..` segment
//   4. `checkShape`       the kernel-written folders, then the depth, the
//                         extension, then the first segment (see below)
//   5. existence          the real path (`realpath`); absent or dangling is `not_found`
//   6. protected set      the real path inside `<dataDir>/config/`, `<dataDir>/app/`
//                         or one of `PROTECTED_DATA_FILES`
//   7. the boundary       the real path inside the real `memory/`
//   8. the real shape     the real path, relative to the real `memory/`, run back
//                         through `checkShape`, so a link that stays inside
//                         `memory/` can never reach a file a typed path could not
//   9. a regular file     a real path that is not a regular file is `not_found`
//
// The protected set comes from `../sessions/policy.js` (a leaf), never a copy.
// Size and hash belong to the handlers. Imports only `node:*`, the kernel's
// memory layout and the agent id grammar: the `studio` CLI loads the registry
// that holds the `gui` feature, so never the Agent SDK or the session manager.
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isValidAgentId } from "../agents/types.js";
import { PLAYBOOK_MIRROR_DIR, memoryDir } from "../brain/memory.js";
import { PROTECTED_DATA_DIRS, PROTECTED_DATA_FILES } from "../sessions/policy.js";
import { UNASSIGNED_AGENT_DIR } from "../tools/handoff.js";

/** The most text one memory file may carry (UTF-8 bytes), to read and to write. */
export const MAX_MEMORY_FILE_BYTES = 256 * 1024;

/** The longest `path` the routes accept, in characters. */
export const MAX_MEMORY_PATH_LENGTH = 512;

/** The event kind the kernel records for an owner's memory write. */
export const MEMORY_UPDATED = "memory_updated";

/**
 * Why `PUT /memory/file` refuses: the `error` code. It is exactly the app
 * contract's `MemoryWriteRefusal` union (`kernel/test/gui-memory.test.ts` reads
 * `app/src/api/contract.ts` as text and compares the two).
 */
export const MEMORY_WRITE_REFUSALS = [
  "invalid_body",
  "invalid_path",
  "path_outside_memory",
  "path_protected",
  "not_markdown",
  "too_large",
  "not_found",
  "changed_since_read",
] as const;

export type MemoryWriteRefusalCode = (typeof MEMORY_WRITE_REFUSALS)[number];

/** `memory/` folders the kernel writes itself (handoffs, playbook mirrors): the owner's routes never read or write there. */
const KERNEL_WRITTEN_DIRS = [UNASSIGNED_AGENT_DIR, PLAYBOOK_MIRROR_DIR];

/** A refusal: the HTTP status and the contract's `error` code. Nothing was read past the check that refused. */
export interface MemoryPathRefusal {
  readonly ok: false;
  readonly status: 400 | 404;
  readonly error: MemoryWriteRefusalCode;
}

/** A path that passed the guard: `relative` as typed (`mason/lessons.md`), `target` the real path to read or write. */
export interface MemoryPathOk {
  readonly ok: true;
  readonly relative: string;
  readonly target: string;
}

export type MemoryPathResult = MemoryPathOk | MemoryPathRefusal;

function refuse(status: 400 | 404, error: MemoryWriteRefusalCode): MemoryPathRefusal {
  return { ok: false, status, error };
}

/**
 * The shape rules both a typed path and a link's real path must meet: the
 * kernel-written folders first (so a link to `_unassigned/handoffs/x.md` is
 * `path_protected`, not a depth refusal), then exactly `<folder>/<file>`, then
 * a `.md` file name, then a folder that is `shared`, `wright` or a valid agent id.
 */
function checkShape(segments: readonly string[]): { readonly ok: true } | MemoryPathRefusal {
  const folder = segments[0] ?? "";
  if (KERNEL_WRITTEN_DIRS.includes(folder)) return refuse(400, "path_protected");
  if (segments.length !== 2) return refuse(400, "invalid_path");
  const name = segments[1] as string;
  if (!name.endsWith(".md")) return refuse(400, "not_markdown");
  if (folder !== "shared" && folder !== "wright" && !isValidAgentId(folder)) return refuse(400, "invalid_path");
  return { ok: true };
}

/** Whether `real` is a data-dir location the kernel owns: a protected folder (and everything in it) or a protected file. */
function isProtected(real: string, dataRoot: string): boolean {
  for (const dir of PROTECTED_DATA_DIRS) {
    const base = join(dataRoot, dir);
    if (real === base || real.startsWith(base + sep)) return true;
  }
  return PROTECTED_DATA_FILES.some((file) => real === join(dataRoot, file));
}

/** The real path of `path`, or undefined when it cannot be resolved (absent, dangling, a loop, a denied folder). */
function realOf(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a caller-named memory path under `<dataDir>/memory/`. Pure of side
 * effects: it reads the file system's metadata only and writes nothing. The
 * target it answers is the real path, so a write lands on the file itself and
 * never replaces a link inside `memory/`.
 */
export function resolveMemoryPath(dataDir: string, path: unknown): MemoryPathResult {
  if (typeof path !== "string" || path === "" || path.length > MAX_MEMORY_PATH_LENGTH || path.includes("\0") || path.includes("\\")) {
    return refuse(400, "invalid_path");
  }
  if (isAbsolute(path)) return refuse(400, "path_outside_memory");
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return refuse(400, "invalid_path");
  const shape = checkShape(segments);
  if (!shape.ok) return shape;

  const root = realOf(memoryDir(dataDir));
  const dataRoot = realOf(dataDir);
  if (root === undefined || dataRoot === undefined) return refuse(404, "not_found");
  const real = realOf(join(root, ...segments));
  if (real === undefined) return refuse(404, "not_found");
  if (isProtected(real, dataRoot)) return refuse(400, "path_protected");
  if (!real.startsWith(root + sep)) return refuse(400, "path_outside_memory");
  const realShape = checkShape(relative(root, real).split(sep)); if (!realShape.ok) return realShape;
  try {
    if (!statSync(real).isFile()) return refuse(404, "not_found");
  } catch {
    return refuse(404, "not_found");
  }
  return { ok: true, relative: segments.join("/"), target: real };
}
