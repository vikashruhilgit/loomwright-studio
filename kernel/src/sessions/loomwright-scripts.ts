// The Loomwright driver and helper scripts a kernel run policy admits, by exact
// path (phase 8 item 22g, AC15/AC16). A run policy constant names its scripts
// by basename (`ToolPolicy.loomwrightScripts`, for example `AUTOMATE_RUN_POLICY`
// in `automate/launch.ts`); the session manager turns those names plus the
// install the session itself loads (its `loomwrightPath`, the one passed to
// `plugins: [{ type: "local", path }]`) into the exact paths
// `ToolPolicy.admittedScriptPaths` holds, at start and at each resume (a resume
// reuses the row's recorded `loomwright_path`, so an update is picked up at the
// next launch, never mid-session). `decideToolUse` (`policy.ts`) then admits
// `bash <path>` or `bash "<path>"`, optionally followed by arguments, only for a
// path in that set, and only after its shell-metacharacter check.
//
// It never admits a prefix: not `bash`, and not `bash <install>/scripts/`. A
// name is kept only when its path has no `..` segment, is a regular file, and
// resolves (`resolvedPath`, symlinks and the macOS firmlink) to exactly
// `<resolved install>/scripts/<name>`, so no symlink and no `..` escapes the
// directory and no renamed file stands in for a listed one. `isInsidePath` is
// never used here: it over-approximates on purpose so that a refusal fails
// closed, which would make an admission fail open.
//
// A leaf module: it imports node's `fs` and `path` and the one path resolution
// in `../protected-paths.ts`, so `policy.ts` stays light for its importers.
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { resolvedPath } from "../protected-paths.js";

/** The install's directory of driver and helper scripts: `<install>/scripts/`. */
export const LOOMWRIGHT_SCRIPTS_DIR = "scripts";

/**
 * `loomwrightScriptPaths`'s answer: the admitted paths (frozen, in the order
 * named, without repeats; a missing or escaping name is left out), or why the
 * install's `scripts/` directory itself cannot be read (`path` names it).
 */
export type LoomwrightScriptPathsResult =
  | { readonly ok: true; readonly paths: readonly string[] }
  | { readonly ok: false; readonly path: string; readonly message: string };

const NONE: readonly string[] = Object.freeze([]);

/** True when `path` is a regular file (symlinks followed); false for anything else or a failed stat. */
function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The `code` of a node `fs` error (`ENOENT`, `EACCES`, ...), else its message. */
function fsReason(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return err instanceof Error ? err.message : String(err);
}

/**
 * The exact paths `names` admit under `installPath`'s `scripts/` directory.
 *
 * No names (absent or empty) ⇒ `{ok: true, paths: []}` without touching the
 * disk, so a policy that runs no script never depends on the install's layout.
 * Otherwise `installPath` must be absolute and `<installPath>/scripts` a directory the kernel can read
 * and search, else `{ok: false}` names it (the manager refuses the start or
 * resume: `install_path_invalid`). Each candidate is the lexical
 * `join(installPath, "scripts", name)` (the form the session sees, from the
 * same `installPath` string), kept only when:
 * - no segment of `<installPath>/scripts/<name>` is `..`;
 * - it is a regular file;
 * - its `resolvedPath` equals `join(resolvedPath(installPath), "scripts", name)`.
 */
export function loomwrightScriptPaths(installPath: string, names: readonly string[] | undefined): LoomwrightScriptPathsResult {
  const wanted = [...new Set(names ?? [])].filter((n) => typeof n === "string" && n !== "");
  if (wanted.length === 0) return { ok: true, paths: NONE };
  // A relative install would admit relative paths, which the session's cwd would resolve: never.
  if (!isAbsolute(installPath)) return { ok: false, path: installPath, message: `the Loomwright install path ${JSON.stringify(installPath)} is not absolute` };
  const dir = join(installPath, LOOMWRIGHT_SCRIPTS_DIR);
  try {
    if (!statSync(dir).isDirectory()) return { ok: false, path: dir, message: `the Loomwright install's scripts directory ${dir} is not a directory` };
    accessSync(dir, constants.R_OK | constants.X_OK);
  } catch (err) {
    return { ok: false, path: dir, message: `the Loomwright install's scripts directory ${dir} cannot be read (${fsReason(err)})` };
  }
  const root = join(resolvedPath(installPath), LOOMWRIGHT_SCRIPTS_DIR);
  const paths: string[] = [];
  for (const name of wanted) {
    // Before `join`, which would fold a `..` away: `../x.sh` must never name a file beside `scripts/`.
    if (`${installPath}${sep}${LOOMWRIGHT_SCRIPTS_DIR}${sep}${name}`.split(sep).includes("..")) continue;
    const candidate = join(installPath, LOOMWRIGHT_SCRIPTS_DIR, name);
    if (!isRegularFile(candidate)) continue;
    // No symlink out of `scripts/` and no rename: the file itself must be `<resolved install>/scripts/<name>`.
    if (resolvedPath(candidate) !== join(root, name)) continue;
    paths.push(candidate);
  }
  return { ok: true, paths: Object.freeze(paths) };
}

/** The program word a driver call starts with, and the one space after it. */
const BASH_WORD = "bash ";

/**
 * An unquoted path word bash reads as written: absolute, and only characters
 * that no expansion touches (no quote, backslash, glob, brace, tilde, `!`,
 * `#`, space or tab).
 */
const PLAIN_PATH = /^\/[A-Za-z0-9_./@%+=:,-]*$/;

/**
 * The admitted path `command` runs, or `undefined`. Pure: no I/O.
 *
 * `command` is `bash <path>` or `bash "<path>"`, then nothing or a space and
 * arguments (read as the prefix rule reads them), where `<path>` equals one of
 * `admitted` exactly. An unquoted path must be a `PLAIN_PATH` word; a
 * double-quoted one is absolute too (the session's cwd never picks the file)
 * and holds no backslash, `$` or backtick. A single-quoted path,
 * another program, a flag before the path (`bash -c`, `bash -x`), a second
 * space, or anything glued to the closing quote is no match. The caller runs
 * the shell-metacharacter check first (`decideToolUse`): this does not read
 * the arguments.
 */
export function matchLoomwrightScript(command: string, admitted: readonly string[]): string | undefined {
  if (admitted.length === 0 || !command.startsWith(BASH_WORD)) return undefined;
  const rest = command.slice(BASH_WORD.length);
  let path: string;
  let after: string;
  if (rest.startsWith('"')) {
    const close = rest.indexOf('"', 1);
    if (close === -1) return undefined;
    path = rest.slice(1, close);
    if (!path.startsWith("/") || /[\\$`]/.test(path)) return undefined;
    after = rest.slice(close + 1);
  } else {
    const space = rest.indexOf(" ");
    path = space === -1 ? rest : rest.slice(0, space);
    if (!PLAIN_PATH.test(path)) return undefined;
    after = space === -1 ? "" : rest.slice(space);
  }
  if (after !== "" && !after.startsWith(" ")) return undefined;
  return admitted.includes(path) ? path : undefined;
}
